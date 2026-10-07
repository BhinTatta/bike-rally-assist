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
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { CoDriver } from "@rally/engine";
import type { AnalysedRoute, Call, CoDriverState, GpsFix } from "@rally/engine";
import { loadRoute } from "../storage/routes";
import { loadSettings, toEngineConfig, type Settings } from "../storage/settings";
import { CallQueue, TtsVoice } from "./speech";
import { RideLogger } from "./rideLogger";

const ACTIVE_RIDE_KEY = "rally.activeRide.v1";

interface ActiveRideRecord {
  routeId: string;
  rideId: string;
  startedAt: number;
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
};

type Listener = (snapshot: RideSnapshot) => void;

class RideEngine {
  private route: AnalysedRoute | null = null;
  private codriver: CoDriver | null = null;
  private logger: RideLogger | null = null;
  private settings: Settings | null = null;
  private queue: CallQueue | null = null;
  private voice: TtsVoice | null = null;
  private record: ActiveRideRecord | null = null;
  private snapshot: RideSnapshot = EMPTY;
  private listeners = new Set<Listener>();
  private gpsWatchdog: ReturnType<typeof setInterval> | null = null;
  private hydrating: Promise<void> | null = null;

  // ------------------------------------------------------------------- state

  getSnapshot(): RideSnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private publish(patch: Partial<RideSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
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
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const route = preloaded ?? (await loadRoute(routeId));
    if (!route) return { ok: false, error: "That route could not be loaded." };

    const settings = await loadSettings();
    const rideId = `${Date.now().toString(36)}`;
    const record: ActiveRideRecord = { routeId, rideId, startedAt: Date.now() };
    await AsyncStorage.setItem(ACTIVE_RIDE_KEY, JSON.stringify(record));

    this.install(route, settings, record);
    await this.queue?.start();
    this.startGpsWatchdog();
    this.publish({
      active: true,
      routeId,
      routeName: route.name ?? "Route",
      startedAt: record.startedAt,
      state: this.codriver?.getState() ?? null,
      lastCall: null,
      recentCalls: [],
      fixCount: 0,
      error: null,
    });
    return { ok: true };
  }

  /** Tear the ride down and return the finished log. */
  async end(): Promise<void> {
    this.stopGpsWatchdog();
    await this.queue?.stop();
    this.logger?.finish();
    await AsyncStorage.removeItem(ACTIVE_RIDE_KEY);
    this.route = null;
    this.codriver = null;
    this.logger = null;
    this.queue = null;
    this.voice = null;
    this.record = null;
    this.publish({ ...EMPTY });
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
    this.voice?.setOptions({ rate: settings.speechRate, language: "en-IN" });
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
  }

  // -------------------------------------------------------------- the fixes

  /**
   * Called by the background location task. Must tolerate being the first
   * thing that runs in a brand new JS context.
   */
  async handleLocations(
    locations: {
      coords: {
        latitude: number;
        longitude: number;
        speed: number | null;
        heading: number | null;
        accuracy: number | null;
      };
      timestamp: number;
    }[],
  ): Promise<void> {
    await this.ensureHydrated();
    const codriver = this.codriver;
    if (!codriver) return;

    const calls: Call[] = [];
    for (const location of locations) {
      const fix: GpsFix = {
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
      };
      this.logger?.addFix(fix);
      for (const call of codriver.update(fix)) {
        calls.push(call);
        this.logger?.addCall(call, { lat: fix.lat, lon: fix.lon });
        this.queue?.enqueue(call);
      }
    }

    const state = codriver.getState();
    this.publish({
      state,
      fixCount: this.snapshot.fixCount + locations.length,
      ...(calls.length > 0
        ? {
            lastCall: calls[calls.length - 1]!,
            recentCalls: [...calls.reverse(), ...this.snapshot.recentCalls].slice(0, 30),
          }
        : {}),
    });
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
        this.install(route, settings, record);
        await this.queue?.start();
        this.startGpsWatchdog();
        this.publish({
          active: true,
          routeId: record.routeId,
          routeName: route.name ?? "Route",
          startedAt: record.startedAt,
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

  private install(route: AnalysedRoute, settings: Settings, record: ActiveRideRecord): void {
    this.route = route;
    this.settings = settings;
    this.record = record;
    this.codriver = new CoDriver(route, toEngineConfig(settings));
    this.voice = new TtsVoice({ rate: settings.speechRate, language: "en-IN" });
    this.queue = new CallQueue(this.voice, this.queueOptions(settings));
    this.logger = settings.logRides
      ? new RideLogger(record.rideId, record.routeId, route.name ?? "Route", record.startedAt)
      : null;
  }

  private queueOptions(settings: Settings) {
    return {
      keepHeadsetAwake: settings.keepHeadsetAwake,
      volume: settings.voiceVolume,
      /** A corner call is stale once the rider is past the corner entry. */
      isStale: (call: Call): boolean => {
        if (call.kind !== "corner" || !this.codriver) return false;
        const state = this.codriver.getState();
        if (state.projectedDist === null) return false;
        const corners = this.route?.corners ?? [];
        const first = corners.find((c) => c.id === call.cornerIds[0]);
        return first !== undefined && state.projectedDist > first.startDist;
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
      const codriver = this.codriver;
      if (!codriver) return;
      for (const call of codriver.tick(Date.now())) {
        this.queue?.enqueue(call);
        this.publish({ lastCall: call, state: codriver.getState() });
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
    const voice = new TtsVoice({ rate: settings.speechRate, language: "en-IN" });
    const queue = new CallQueue(voice, this.queueOptions(settings));
    await queue.start();
    const call: Call = settings.rallyMode
      ? { kind: "corner", cornerIds: [], text: "Right 3, 80, into left 2", tokens: [], time: Date.now() }
      : {
          kind: "corner",
          cornerIds: [],
          text: "Sharp right, 80 metres, into hairpin left",
          tokens: [],
          time: Date.now(),
        };
    await queue.sayNow(call);
    // Give the sentence time to finish before releasing the audio session.
    setTimeout(() => void queue.stop(), 6000);
  }
}

export const rideEngine = new RideEngine();
