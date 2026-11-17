/**
 * Ride logging: every ride is saved as a GPX track plus a JSON log of the
 * calls that were made.
 *
 * The point is tuning. Replay the pair through the CLI simulator
 * (`rally simulate route.gpx --replay ride.gpx`) and you can see exactly what
 * the co-driver said, where, and at what speed - then change a threshold and
 * see what it would have said instead.
 */

import { toGpx } from "@rally/engine";
import type { Call, GpsFix, RideModeId, RideStats } from "@rally/engine";

import { fileUri, listFiles, readTextSync, removeFile, writeText } from "../storage/files";

const RIDES_DIR = "rides";

export interface LoggedCall extends Call {
  /** Where the rider was when the call fired. */
  lat: number;
  lon: number;
}

export interface RideLog {
  id: string;
  routeId: string;
  routeName: string;
  startedAt: number;
  endedAt?: number;
  distanceMeters: number;
  fixCount: number;
  calls: LoggedCall[];
  /** The ride mode it was ridden in. */
  mode?: RideModeId;
  /** Speed, lean and the rest; absent on rides logged by older versions. */
  stats?: RideStats;
}

const gpxPath = (id: string): string => `${RIDES_DIR}/${id}.gpx`;
const jsonPath = (id: string): string => `${RIDES_DIR}/${id}.json`;

/** URIs of a ride's two files, for the share sheet. */
export const rideGpxUri = (id: string): string => fileUri(gpxPath(id));
export const rideJsonUri = (id: string): string => fileUri(jsonPath(id));

/**
 * Accumulates a ride in memory and flushes to disk periodically, so a crash
 * (or a vendor battery killer) loses seconds of data rather than the ride.
 */
export class RideLogger {
  private readonly fixes: GpsFix[] = [];
  private readonly calls: LoggedCall[] = [];
  private lastFlush = 0;
  private dirty = false;
  private stats: RideStats | null = null;
  private mode: RideModeId | null = null;

  constructor(
    readonly id: string,
    private readonly routeId: string,
    private readonly routeName: string,
    private readonly startedAt = Date.now(),
    /** How often to write to disk, milliseconds. */
    private readonly flushIntervalMs = 60_000,
  ) {}

  addFix(fix: GpsFix): void {
    this.fixes.push(fix);
    this.dirty = true;
    if (Date.now() - this.lastFlush > this.flushIntervalMs) this.flush();
  }

  addCall(call: Call, at: { lat: number; lon: number }): void {
    this.calls.push({ ...call, lat: at.lat, lon: at.lon });
    this.dirty = true;
  }

  get fixCount(): number {
    return this.fixes.length;
  }

  /** Latest stats from the ride engine, saved alongside the log. */
  setStats(stats: RideStats, mode: RideModeId): void {
    this.stats = stats;
    this.mode = mode;
  }

  /** Write the GPX and the call log. Safe to call often; cheap when clean. */
  flush(): void {
    if (!this.dirty) return;
    this.lastFlush = Date.now();
    this.dirty = false;
    try {
      writeText(
        gpxPath(this.id),
        toGpx(
          this.fixes.map((f) => ({ lat: f.lat, lon: f.lon, time: f.time })),
          `${this.routeName} - ${new Date(this.startedAt).toISOString()}`,
        ),
      );
      writeText(jsonPath(this.id), JSON.stringify(this.summary()));
    } catch {
      // Out of space or the directory vanished: never take the ride down.
    }
  }

  summary(ended = false): RideLog {
    const log: RideLog = {
      id: this.id,
      routeId: this.routeId,
      routeName: this.routeName,
      startedAt: this.startedAt,
      distanceMeters: this.stats?.distanceMeters ?? this.distance(),
      fixCount: this.fixes.length,
      calls: this.calls,
    };
    if (this.mode) log.mode = this.mode;
    if (this.stats) log.stats = this.stats;
    if (ended) log.endedAt = Date.now();
    return log;
  }

  finish(): RideLog {
    this.dirty = true;
    this.flush();
    const log = this.summary(true);
    try {
      writeText(jsonPath(this.id), JSON.stringify(log));
    } catch {
      // As above.
    }
    return log;
  }

  /** Straight-line distance covered, metres. Good enough for a ride summary. */
  private distance(): number {
    let total = 0;
    for (let i = 1; i < this.fixes.length; i++) {
      const a = this.fixes[i - 1]!;
      const b = this.fixes[i]!;
      const dLat = (b.lat - a.lat) * 111_320;
      const dLon =
        (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
      total += Math.hypot(dLat, dLon);
    }
    return total;
  }
}

/** Every stored ride, newest first. */
export function listRideLogs(): RideLog[] {
  const logs: RideLog[] = [];
  for (const name of listFiles(RIDES_DIR)) {
    if (!name.endsWith(".json")) continue;
    try {
      const text = readTextSync(`${RIDES_DIR}/${name}`);
      if (text) logs.push(JSON.parse(text) as RideLog);
    } catch {
      // A half-written log from a killed process: skip it.
    }
  }
  return logs.sort((a, b) => b.startedAt - a.startedAt);
}

export function loadRideLog(id: string): RideLog | null {
  try {
    const text = readTextSync(jsonPath(id));
    return text ? (JSON.parse(text) as RideLog) : null;
  } catch {
    return null;
  }
}

export function deleteRideLog(id: string): void {
  removeFile(gpxPath(id));
  removeFile(jsonPath(id));
}
