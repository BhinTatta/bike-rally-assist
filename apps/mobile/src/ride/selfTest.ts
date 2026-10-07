/**
 * A 20-second reproduction of everything a ride start does to the phone,
 * without needing a route, a GPS fix or a ghat.
 *
 * Chasing a native crash means asking the rider to reproduce it over and over.
 * Importing a 127 km GPX and tapping through a preview each time is a bad way
 * to spend somebody's afternoon, so this runs the same native calls - audio
 * session, keep-alive stream, location foreground service - leaves them
 * running long enough for Android's five-second foreground-service deadline to
 * bite, then shuts them down.
 *
 * Each step leaves a breadcrumb, so if the app dies the recovery screen names
 * the step exactly as it would during a real ride.
 */

import { breadcrumb, clearBreadcrumb, heartbeat } from "../diagnostics";
import { loadSettings } from "../storage/settings";
import { CallQueue, TtsVoice } from "./speech";
import { startLocationUpdates, startForegroundWatch, stopRideLocation } from "./locationTask";

export interface SelfTestResult {
  audioOk: boolean;
  locationOk: boolean;
  notes: string[];
}

export async function runSelfTest(
  onProgress: (message: string) => void,
): Promise<SelfTestResult> {
  const settings = await loadSettings();
  const notes: string[] = [];
  let audioOk = false;
  let locationOk = false;
  let queue: CallQueue | null = null;

  try {
    onProgress("Starting the audio session…");
    breadcrumb("selftest:audio");
    queue = new CallQueue(new TtsVoice({ rate: settings.speechRate, language: "en-IN" }), {
      keepHeadsetAwake: settings.keepHeadsetAwake,
      playInBackground: settings.backgroundAudio,
      volume: settings.voiceVolume,
    });
    await queue.start();
    audioOk = true;
    notes.push(
      settings.backgroundAudio
        ? "Audio session started with background playback (second foreground service)."
        : "Audio session started, foreground only.",
    );
  } catch (error) {
    notes.push(`Audio failed: ${(error as Error).message}`);
  }

  try {
    onProgress("Starting the location service…");
    breadcrumb("selftest:location");
    await startLocationUpdates("Self-test");
    locationOk = true;
    notes.push("Background location service started — rides survive the screen locking.");
  } catch (error) {
    const message = (error as Error).message;
    notes.push(`Background location service unavailable: ${message}`);
    // The interesting half: does the foreground fallback work on this phone?
    try {
      onProgress("Falling back to foreground location…");
      breadcrumb("selftest:location-foreground");
      await startForegroundWatch();
      locationOk = true;
      notes.push(
        'Foreground location works. Rides run with the screen on. For the phone-in-pocket mode, grant "Allow all the time" in Android location settings.',
      );
    } catch (fallbackError) {
      notes.push(`Foreground location also failed: ${(fallbackError as Error).message}`);
    }
  }

  // Android kills a process whose foreground service has not settled within
  // five seconds. Sit here long enough for that to happen if it is going to.
  onProgress("Holding for 12 seconds — this is when a crash would happen…");
  for (let i = 0; i < 12; i++) {
    heartbeat();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    onProgress(`Holding… ${11 - i}s`);
  }

  onProgress("Shutting down…");
  breadcrumb("selftest:done");
  await stopRideLocation().catch(() => undefined);
  await queue?.stop().catch(() => undefined);
  clearBreadcrumb();

  notes.push("Survived the full 12 seconds — nothing here crashed the app.");
  return { audioOk, locationOk, notes };
}
