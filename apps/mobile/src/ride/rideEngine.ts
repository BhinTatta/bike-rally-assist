/**
 * The ride, as a singleton that outlives the UI.
 *
 * Android can tear the React UI down while the ride continues: the screen
 * locks, the app is swiped away, the launcher reclaims memory. The location
 * foreground service keeps the JS context alive and delivers batches of fixes
 * to a background task, which calls straight into this module. Nothing here
 * touches React.
 *
 * It can also be revived from nothing: if the process was restarted, the first
 * batch of locations rehydrates the engine from the active-ride record in
 * storage. Re-announcing is not a risk, because the co-driver marks every
 * corner behind the first fix as already called.
 *
 * A *preview* is the same engine fed by a simulated rider instead of the GPS:
 * same co-driver, same voice, same screen. What you hear at your desk is what
 * you would hear on the road.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CoDriver,
  EMPTY_RIDE_STATS,
  RideSimulator,
  RideStatsTracker,
  rideMode,
} from "@rally/engine";
import type {
  AnalysedRoute,
  Call,
  CoDriverState,
  GpsFix,
  RideModeId,
  RideStats,
} from "@rally/engine";

import { loadRoute, markRidden } from "../storage/routes";
import {
  loadSettings,
  saveSettings,
  toEngineConfig,
  type Settings,
} from "../storage/settings";
import { CallQueue, TtsVoice, type CallQueueOptions } from "./speech";
import { RideLogger, type RideLog } from "./rideLogger";
import { breadcrumb, heartbeat, lastCrashWasAudio } from "../diagnostics";

const ACTIVE_RIDE_KEY = "rally.activeRide.v1";

interface ActiveRideRecord {
  routeId: string;
  rideId: string;
  startedAt: number;
  /** Saved every so often so a restarted process does not lose the numbers. */
  stats?: RideStats;
}

export interface PreviewState {
  /** How many times faster than real time the preview runs. */
  multiplier: number;
  paused: boolean;
}

export interface RideSnapshot {
  active: boolean;
  routeId: string | null;
  routeName: string;
  startedAt: number | null;
  /** Latest co-driver state, or null before the first fix. */
  state: CoDriverState | null;
  /** The most recent thing said. */
  lastCall: Call | null;
  /** Everything said this ride, newest first, capped for the UI. */
  recentCalls: Call[];
  fixCount: number;
  /** Set when something stopped the ride from starting. */
  error: string | null;
  mode: RideModeId;
  stats: RideStats;
  muted: boolean;
  /** Set while this is a simulated ride rather than a real one. */
  preview: PreviewState | null;
}

const EMPTY: RideSnapshot = {
  active: false,
  routeId: null,
  routeName: "",
  startedAt: null,
  state: null,
  lastCall: null,
  recentCalls: [],
  fixCount: 0,
  error: null,
  mode: "sport",
  stats: EMPTY_RIDE_STATS,
  muted: false,
  preview: null,
};

/** What is left when a ride ends, for the summary screen. */
export interface RideResult {
  routeId: string;
  routeName: string;
  startedAt: number;
  endedAt: number;
  stats: RideStats;
  mode: RideModeId;
  /** Present when the ride was logged to disk. */
  log: RideLog | null;
  preview: boolean;
}

type Listener = (snapshot: RideSnapshot) => void;

interface LocationLike {
  coords: {
    latitude: number;
    longitude: number;
    speed: number | null;
    heading: number | null;
    accuracy: number | null;
  };
  timestamp: number;
}

class RideEngine {
  private route: AnalysedRoute | null = null;
  private codriver: CoDriver | null = null;
  private logger: RideLogger | null = null;
  private settings: Settings | null = null;
  private queue: CallQueue | null = null;
  private voice: TtsVoice | null = null;
  private record: ActiveRideRecord | null = null;
  private tracker: RideStatsTracker | null = null;
  private snapshot: RideSnapshot = EMPTY;
  private listeners = new Set<Listener>();
  private gpsWatchdog: ReturnType<typeof setInterval> | null = null;
  private watchdogTicks = 0;
  private hydrating: Promise<void> | null = null;
  /** Set when the previous run died inside the audio stack. */
  private audioDisabled = false;
  private muted = false;
  private lastResult: RideResult | null = null;

  // Preview (simulated ride) state.
  private simulator: RideSimulator | null = null;
  private previewTimer: ReturnType<typeof setInterval> | null = null;
  private preview: PreviewState | null = null;

  /** True when this ride is running without ducking or the keep-alive stream. */
  get isAudioDisabled(): boolean {
    return this.audioDisabled;
  }

  // ------------------------------------------------------------------- state

  getSnapshot(): RideSnapshot {
    return this.snapshot;
  }

  /** The route being ridden, for the screen to draw. */
  getRoute(): AnalysedRoute | null {
    return this.route;
  }

  /** The most recently finished ride, for the summary screen. */
  getLastResult(): RideResult | null {
    return this.lastResult;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private publish(patch: Partial<RideSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot);
      } catch {
        // A broken listener must not stop the ride for everyone else.
      }
    }
  }

  // ----------------------------------------------------------------- control

  /**
   * Prepare everything for a ride. The caller starts the location updates
   * (which needs permissions, and therefore the UI) once this resolves.
   */
  async begin(
    routeId: string,
    /** Pass an already-loaded route to avoid parsing megabytes twice. */
    preloaded?: AnalysedRoute,
    options: { preview?: boolean } = {},
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.record) await this.end();
    breadcrumb("ride:load-route");
    const route = preloaded ?? (await loadRoute(routeId));
    if (!route) return { ok: false, error: "That route could not be loaded." };
    if (route.points.length < 2) return { ok: false, error: "That route has no road in it." };

    // If the audio stack is what took the app down last time, run without it.
    this.audioDisabled = lastCrashWasAudio();
    const settings = await loadSettings();
    const rideId = `${Date.now().toString(36)}`;
    const record: ActiveRideRecord = { routeId, rideId, startedAt: Date.now() };
    const isPreview = options.preview === true;
    // A preview is never resumed after a restart, so it leaves no record.
    if (!isPreview) await AsyncStorage.setItem(ACTIVE_RIDE_KEY, JSON.stringify(record));

    this.muted = false;
    this.install(route, settings, record, !isPreview);
    breadcrumb("ride:audio-start");
    await this.queue?.start();
    breadcrumb("ride:watchdog");
    if (isPreview) this.startPreview(route, settings);
    else this.startGpsWatchdog();
    breadcrumb("ride:ready");
    this.publish({
      active: true,
      routeId,
      routeName: route.name ?? "Route",
      startedAt: record.startedAt,
      state: null,
      lastCall: null,
      recentCalls: [],
      fixCount: 0,
      error: null,
      mode: settings.mode,
      stats: EMPTY_RIDE_STATS,
      muted: false,
      preview: this.preview,
    });
    if (!isPreview) void markRidden(routeId).catch(() => undefined);
    return { ok: true };
  }

  /** Tear the ride down and return what there is to show for it. */
  async end(): Promise<RideResult | null> {
    const record = this.record;
    const route = this.route;
    this.stopGpsWatchdog();
    this.stopPreview();
    try {
      await this.queue?.stop();
    } catch {
      // The ride ends whether or not the audio session lets go cleanly.
    }

    let result: RideResult | null = null;
    if (record && route) {
      const stats = this.tracker?.snapshot() ?? EMPTY_RIDE_STATS;
      const mode = this.settings?.mode ?? "sport";
      let log: RideLog | null = null;
      if (this.logger) {
        this.logger.setStats(stats, mode);
        log = this.logger.finish();
      }
      result = {
        routeId: record.routeId,
        routeName: route.name ?? "Route",
        startedAt: record.startedAt,
        endedAt: Date.now(),
        stats,
        mode,
        log,
        preview: this.preview !== null,
      };
      this.lastResult = result;
    }

    try {
      await AsyncStorage.removeItem(ACTIVE_RIDE_KEY);
    } catch {
      // Worst case the next launch finds a stale record and ignores it.
    }
    this.route = null;
    this.codriver = null;
    this.logger = null;
    this.queue = null;
    this.voice = null;
    this.record = null;
    this.tracker = null;
    this.preview = null;
    this.publish({ ...EMPTY });
    return result;
  }

  get isActive(): boolean {
    return this.record !== null;
  }

  get rideId(): string | null {
    return this.record?.rideId ?? null;
  }

  /** Apply changed settings mid-ride (the settings screen is reachable). */
  async applySettings(settings: Settings): Promise<void> {
    this.settings = settings;
    this.voice?.setOptions(this.voiceOptions(settings));
    this.queue?.setOptions(this.queueOptions(settings));
    // Lead time and verbosity live in the CoDriver's config, which is fixed at
    // construction - rebuild it, keeping the corners already called.
    if (this.route && this.codriver) {
      const called = new Set(this.codriver.getState().calledCornerIds);
      const rebuilt = new CoDriver(this.route, toEngineConfig(settings));
      // Replay the "already said" set so nothing is announced twice.
      for (const id of called) rebuilt.markCalled(id);
      this.codriver = rebuilt;
    }
    this.publish({ mode: settings.mode });
  }

  /** Switch ride mode, mid-ride or not, and remember it. */
  async setMode(mode: RideModeId): Promise<void> {
    const settings = { ...(this.settings ?? (await loadSettings())), mode };
    await saveSettings(settings);
    if (this.record) {
      await this.applySettings(settings);
      this.say(`${rideMode(mode).name} mode`);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.settings) this.queue?.setOptions(this.queueOptions(this.settings));
    this.publish({ muted });
  }

  /** Say the last corner call again. */
  repeatLast(): void {
    const last = this.snapshot.recentCalls.find((call) => call.kind === "corner") ?? this.snapshot.lastCall;
    if (last && !this.muted) void this.queue?.sayNow(last);
  }

  /** Speak a line that is not a call (mode changes, and the like). */
  private say(text: string): void {
    this.queue?.enqueue({ kind: "route-start", cornerIds: [], text, tokens: [], time: Date.now() });
  }

  // -------------------------------------------------------------- the fixes

  /**
   * Called by the background location task. Must tolerate being the first
   * thing that runs in a brand new JS context.
   */
  async handleLocations(locations: LocationLike[]): Promise<void> {
    await this.ensureHydrated();
    // A preview drives itself; real fixes arriving during one are ignored.
    if (this.preview) return;
    const fixes: GpsFix[] = locations.map((location) => ({
      lat: location.coords.latitude,
      lon: location.coords.longitude,
      time: location.timestamp,
      ...(location.coords.speed !== null && location.coords.speed >= 0
        ? { speed: location.coords.speed }
        : {}),
      ...(location.coords.heading !== null && location.coords.heading >= 0
        ? { heading: location.coords.heading }
        : {}),
      ...(location.coords.accuracy !== null ? { accuracy: location.coords.accuracy } : {}),
    }));
    this.handleFixes(fixes);
  }

  private handleFixes(fixes: GpsFix[]): void {
    const codriver = this.codriver;
    if (!codriver || fixes.length === 0) return;

    const calls: Call[] = [];
    for (const fix of fixes) {
      this.logger?.addFix(fix);
      for (const call of codriver.update(fix)) {
        calls.push(call);
        this.tracker?.addCall(call);
        this.logger?.addCall(call, { lat: fix.lat, lon: fix.lon });
        this.queue?.enqueue(call);
      }
      this.tracker?.addFix(fix, codriver.getState());
    }

    const stats = this.tracker?.snapshot() ?? EMPTY_RIDE_STATS;
    this.publish({
      state: codriver.getState(),
      fixCount: this.snapshot.fixCount + fixes.length,
      stats,
      ...(calls.length > 0
        ? {
            lastCall: calls[calls.length - 1]!,
            recentCalls: [...[...calls].reverse(), ...this.snapshot.recentCalls].slice(0, 30),
          }
        : {}),
    });
  }

  // ----------------------------------------------------------------- preview

  private startPreview(route: AnalysedRoute, settings: Settings): void {
    const mode = rideMode(settings.mode);
    this.simulator = new RideSimulator(route, {
      speedKmh: mode.typicalSpeedKmh,
      // A touch more than the mode's comfort figure, or the preview would
      // crawl round every sweeper.
      lateralG: (mode.runtime.lateralG ?? 0.35) * 1.15,
      smooth: true,
      startTime: Date.now(),
    });
    this.preview = { multiplier: 1, paused: false };
    this.schedulePreview();
  }

  private schedulePreview(): void {
    if (this.previewTimer) clearInterval(this.previewTimer);
    this.previewTimer = null;
    const preview = this.preview;
    if (!preview || preview.paused) return;
    // One simulated second per tick; a faster preview just ticks more often.
    this.previewTimer = setInterval(() => this.previewTick(), 1000 / preview.multiplier);
  }

  private previewTick(): void {
    const simulator = this.simulator;
    if (!simulator) return;
    const fix = simulator.step(1);
    if (!fix) {
      if (this.previewTimer) clearInterval(this.previewTimer);
      this.previewTimer = null;
      return;
    }
    this.handleFixes([fix]);
  }

  private stopPreview(): void {
    if (this.previewTimer) clearInterval(this.previewTimer);
    this.previewTimer = null;
    this.simulator = null;
  }

  /** Run the preview faster, slower, or not at all. */
  setPreview(patch: Partial<PreviewState>): void {
    if (!this.preview) return;
    this.preview = { ...this.preview, ...patch };
    this.schedulePreview();
    this.publish({ preview: this.preview });
  }

  /** Jump the preview to a fraction of the way along the route. */
  seekPreview(fraction: number): void {
    const simulator = this.simulator;
    const route = this.route;
    if (!simulator || !route || !this.settings) return;
    simulator.seek(Math.max(0, Math.min(0.995, fraction)) * route.length);
    // A jump is not riding: start the co-driver afresh from the new place so
    // it neither announces everything skipped nor reports a U-turn.
    this.codriver = new CoDriver(route, toEngineConfig(this.settings));
    void this.queue?.clear();
    this.previewTick();
  }

  // ------------------------------------------------------------- internals

  /** Rebuild from storage if the process restarted mid-ride. */
  private async ensureHydrated(): Promise<void> {
    if (this.codriver) return;
    if (this.hydrating) return this.hydrating;
    this.hydrating = (async () => {
      try {
        const raw = await AsyncStorage.getItem(ACTIVE_RIDE_KEY);
        if (!raw) return;
        const record = JSON.parse(raw) as ActiveRideRecord;
        const [route, settings] = await Promise.all([
          loadRoute(record.routeId),
          loadSettings(),
        ]);
        if (!route) return;
        this.audioDisabled = lastCrashWasAudio();
        this.install(route, settings, record, true);
        await this.queue?.start();
        this.startGpsWatchdog();
        this.publish({
          active: true,
          routeId: record.routeId,
          routeName: route.name ?? "Route",
          startedAt: record.startedAt,
          mode: settings.mode,
          stats: this.tracker?.snapshot() ?? EMPTY_RIDE_STATS,
          preview: null,
        });
      } catch {
        // A ride we cannot rebuild is a ride that quietly ends; the UI shows
        // no active ride and the rider can start again.
      } finally {
        this.hydrating = null;
      }
    })();
    return this.hydrating;
  }

  /** Resume a ride the service kept alive while the UI was gone. */
  async resume(): Promise<boolean> {
    await this.ensureHydrated();
    return this.record !== null;
  }

  private install(
    route: AnalysedRoute,
    settings: Settings,
    record: ActiveRideRecord,
    logged: boolean,
  ): void {
    this.route = route;
    this.settings = settings;
    this.record = record;
    this.codriver = new CoDriver(route, toEngineConfig(settings));
    this.tracker = new RideStatsTracker(record.stats);
    this.voice = new TtsVoice(this.voiceOptions(settings));
    this.queue = new CallQueue(this.voice, this.queueOptions(settings));
    this.logger =
      logged && settings.logRides
        ? new RideLogger(record.rideId, record.routeId, route.name ?? "Route", record.startedAt)
        : null;
  }

  private voiceOptions(settings: Settings) {
    return { rate: settings.speechRate, language: "en-IN", voiceId: settings.voiceId };
  }

  private queueOptions(settings: Settings): CallQueueOptions {
    return {
      keepHeadsetAwake: settings.keepHeadsetAwake && !this.audioDisabled,
      skipAudioSession: this.audioDisabled,
      playInBackground: settings.backgroundAudio && !this.audioDisabled,
      volume: settings.voiceVolume,
      muted: this.muted,
      /** A corner call is stale once the rider is past the corner entry. */
      isStale: (call: Call): boolean => {
        if (call.kind !== "corner" || !this.codriver || call.cornerIds.length === 0) return false;
        const state = this.codriver.getState();
        if (state.dist === null) return false;
        const first = this.route?.corners[call.cornerIds[0]!];
        if (!first) return false;
        return state.travelDirection === 1
          ? state.dist > first.startDist + 10
          : state.dist < first.endDist - 10;
      },
    };
  }

  /**
   * The co-driver only notices a dead GPS when asked, and no fixes means
   * nothing is asking. Poll so "GPS lost" is actually said.
   */
  private startGpsWatchdog(): void {
    this.stopGpsWatchdog();
    this.gpsWatchdog = setInterval(() => {
      // Doubles as the ride's proof of life: the last value written is how far
      // the ride got before the process disappeared.
      heartbeat();
      this.watchdogTicks++;
      const codriver = this.codriver;
      if (!codriver) return;
      for (const call of codriver.tick(Date.now())) {
        this.queue?.enqueue(call);
        this.publish({ lastCall: call, state: codriver.getState() });
      }
      // Every half minute, save the numbers so a restart does not zero them.
      if (this.watchdogTicks % 15 === 0 && this.record && this.tracker) {
        this.record = { ...this.record, stats: this.tracker.snapshot() };
        void AsyncStorage.setItem(ACTIVE_RIDE_KEY, JSON.stringify(this.record)).catch(
          () => undefined,
        );
      }
    }, 2000);
  }

  private stopGpsWatchdog(): void {
    if (this.gpsWatchdog) {
      clearInterval(this.gpsWatchdog);
      this.gpsWatchdog = null;
    }
  }

  /** Used by the settings screen's "test voice" button. */
  async testVoice(settings: Settings): Promise<void> {
    const voice = new TtsVoice(this.voiceOptions(settings));
    const pacenotes = toEngineConfig(settings).runtime?.rallyMode === true;
    const call: Call = {
      kind: "corner",
      cornerIds: [],
      text: pacenotes ? "Right 3, 80, into left 2" : "Sharp right, 80 metres, into hairpin left",
      tokens: [],
      time: Date.now(),
    };
    // Mid-ride, borrow the live queue rather than fighting it for the session.
    if (this.queue) {
      this.voice?.setOptions(this.voiceOptions(settings));
      await this.queue.sayNow(call);
      return;
    }
    await voice.stop();
    await voice.speak(call);
  }
}

export const rideEngine = new RideEngine();
