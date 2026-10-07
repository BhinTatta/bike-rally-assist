/**
 * Getting words into the rider's ear.
 *
 * Three problems this solves, in order of how much they hurt:
 *
 * 1. **Bluetooth headsets sleep.** With no audio for a few seconds the headset
 *    powers its receiver down, and the first ~300 ms of the next sound is
 *    clipped - which is exactly the word "sharp" or "left". The fix is to hold
 *    a near-silent stream open for the whole ride.
 * 2. **Calls must not overlap.** Two corners arriving together must queue, not
 *    talk over each other, and a call whose corner has already been passed is
 *    worse than no call at all - it gets dropped.
 * 3. **Music must duck, not stop.** The audio session asks for transient
 *    ducking, so the rider's playlist dips and comes back.
 *
 * Everything here is written against an interface, not against expo-speech, so
 * the pre-recorded clip player can be dropped in later without the ride code
 * changing. `tokens` on every Call is already the clip vocabulary.
 */

import * as Speech from "expo-speech";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import type { Call } from "@rally/engine";

import { breadcrumb } from "../diagnostics";

/** A thing that can say a call out loud. */
export interface Voice {
  speak(call: Call): Promise<void>;
  stop(): Promise<void>;
}

export interface VoiceOptions {
  /** Speaking rate; 1.0 is normal. */
  rate: number;
  /** BCP 47 language tag. */
  language: string;
}

/** Device text-to-speech. */
export class TtsVoice implements Voice {
  constructor(private options: VoiceOptions) {}

  setOptions(options: VoiceOptions): void {
    this.options = options;
  }

  speak(call: Call): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      // A long call is ~3 s; this is a safety net for a TTS engine that never
      // fires onDone (which happens on some Chinese ROMs) rather than a timing
      // mechanism, so the queue can never wedge.
      const timeout = setTimeout(done, 8000);
      const finish = (): void => {
        clearTimeout(timeout);
        done();
      };
      Speech.speak(call.text, {
        language: this.options.language,
        rate: this.options.rate,
        onDone: finish,
        onStopped: finish,
        onError: finish,
      });
    });
  }

  async stop(): Promise<void> {
    await Speech.stop();
  }
}

export interface CallQueueOptions {
  /** Hold a near-silent stream open so the headset stays awake. */
  keepHeadsetAwake: boolean;
  /** 0-1, applied to the keep-alive stream and to clip playback. */
  volume: number;
  /**
   * Leave the audio session and the keep-alive stream alone entirely.
   *
   * Speech still works - this only gives up ducking other apps and keeping the
   * headset awake. Used when the audio stack is what killed the last ride.
   */
  skipAudioSession?: boolean;
  /** Decides whether a queued call is still worth saying. */
  isStale?: (call: Call) => boolean;
}

/**
 * Serialises calls through a voice, one at a time.
 */
export class CallQueue {
  private queue: Call[] = [];
  private speaking = false;
  private keepAlive: AudioPlayer | null = null;
  private keepAliveWatchdog: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(
    private voice: Voice,
    private options: CallQueueOptions,
  ) {}

  setVoice(voice: Voice): void {
    this.voice = voice;
  }

  setOptions(options: CallQueueOptions): void {
    const wasKeepingAwake = this.options.keepHeadsetAwake;
    this.options = options;
    if (this.keepAlive) this.keepAlive.volume = keepAliveVolume(options.volume);
    if (this.started && wasKeepingAwake !== options.keepHeadsetAwake) {
      if (options.keepHeadsetAwake) this.startKeepAlive();
      else this.stopKeepAlive();
    }
  }

  /**
   * Claim the audio session for the ride: duck other apps rather than stopping
   * them, keep playing with the screen off, and ignore the silent switch -
   * a rider who silenced their phone still wants the corner calls.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (this.options.skipAudioSession) {
      breadcrumb("audio:skipped");
      return;
    }
    try {
      breadcrumb("audio:set-mode");
      await setAudioModeAsync({
        playsInSilentMode: true,
        interruptionMode: "duckOthers",
        shouldPlayInBackground: true,
        shouldRouteThroughEarpiece: false,
      });
    } catch {
      // An audio mode we cannot set is not a reason to abandon the ride; TTS
      // will still come out, it just may not duck music politely.
    }
    if (this.options.keepHeadsetAwake) this.startKeepAlive();
    breadcrumb("audio:ready");
  }

  async stop(): Promise<void> {
    this.started = false;
    this.queue = [];
    this.speaking = false;
    this.stopKeepAlive();
    await this.voice.stop();
    try {
      await setAudioModeAsync({ shouldPlayInBackground: false });
    } catch {
      // Nothing useful to do on the way out.
    }
  }

  /** Queue a call. Returns immediately; speaking happens in the background. */
  enqueue(call: Call): void {
    this.queue.push(call);
    void this.drain();
  }

  /** Say something right now, jumping the queue (used by "test voice"). */
  async sayNow(call: Call): Promise<void> {
    await this.voice.stop();
    this.queue = [];
    this.speaking = false;
    this.enqueue(call);
  }

  get pending(): number {
    return this.queue.length;
  }

  private async drain(): Promise<void> {
    if (this.speaking) return;
    this.speaking = true;
    try {
      while (this.queue.length > 0) {
        const call = this.queue.shift()!;
        // By the time we get to it, the corner may be behind us. Saying
        // "sharp right, 80" as you exit the corner is actively dangerous.
        if (this.options.isStale?.(call) === true) continue;
        await this.voice.speak(call);
      }
    } finally {
      this.speaking = false;
    }
  }

  // ------------------------------------------------------------- keep-alive

  private startKeepAlive(): void {
    this.stopKeepAlive();
    try {
      breadcrumb("audio:create-player");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const player = createAudioPlayer(require("../../assets/keepalive.wav"));
      player.loop = true;
      player.volume = keepAliveVolume(this.options.volume);
      breadcrumb("audio:play");
      player.play();
      this.keepAlive = player;
      breadcrumb("audio:playing");
    } catch {
      // Without it the headset may clip the first word; the ride still works.
      this.keepAlive = null;
      return;
    }
    // Android stops background playback after a few minutes in some states,
    // and a headset reconnect can leave the player paused. Nudge it.
    this.keepAliveWatchdog = setInterval(() => {
      const player = this.keepAlive;
      if (!player) return;
      try {
        if (!player.playing) player.play();
      } catch {
        // Player died (headset switch): rebuild it next tick.
        this.keepAlive = null;
        this.startKeepAlive();
      }
    }, 30_000);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveWatchdog) {
      clearInterval(this.keepAliveWatchdog);
      this.keepAliveWatchdog = null;
    }
    const player = this.keepAlive;
    this.keepAlive = null;
    if (!player) return;
    try {
      player.pause();
      player.remove();
    } catch {
      // Already gone.
    }
  }
}

/**
 * The keep-alive stream must be audible to the headset's silence detector but
 * not to the rider, so it is pinned very low regardless of the voice volume.
 */
const keepAliveVolume = (voiceVolume: number): number =>
  Math.max(0.01, Math.min(0.05, voiceVolume * 0.05));
