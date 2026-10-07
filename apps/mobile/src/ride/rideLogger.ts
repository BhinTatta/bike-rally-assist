/**
 * Ride logging: every ride is saved as a GPX track plus a JSON log of the
 * calls that were made.
 *
 * The point is tuning. Replay the pair through the CLI simulator
 * (`rally simulate route.gpx --replay ride.gpx`) and you can see exactly what
 * the co-driver said, where, and at what speed - then change a threshold and
 * see what it would have said instead.
 */

import { Directory, File, Paths } from "expo-file-system";
import { toGpx } from "@rally/engine";
import type { Call, GpsFix } from "@rally/engine";

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
}

export function ridesDirectory(): Directory {
  const dir = new Directory(Paths.document, RIDES_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export const rideGpxFile = (id: string): File => new File(ridesDirectory(), `${id}.gpx`);
export const rideJsonFile = (id: string): File => new File(ridesDirectory(), `${id}.json`);

/**
 * Accumulates a ride in memory and flushes to disk periodically, so a crash
 * (or a vendor battery killer) loses seconds of data rather than the ride.
 */
export class RideLogger {
  private readonly fixes: GpsFix[] = [];
  private readonly calls: LoggedCall[] = [];
  private lastFlush = 0;
  private dirty = false;

  constructor(
    readonly id: string,
    private readonly routeId: string,
    private readonly routeName: string,
    private readonly startedAt = Date.now(),
    /** How often to write to disk, milliseconds. */
    private readonly flushIntervalMs = 15_000,
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

  /** Write the GPX and the call log. Safe to call often; cheap when clean. */
  flush(): void {
    if (!this.dirty) return;
    this.lastFlush = Date.now();
    this.dirty = false;
    try {
      const gpx = rideGpxFile(this.id);
      gpx.create({ overwrite: true });
      gpx.write(
        toGpx(
          this.fixes.map((f) => ({ lat: f.lat, lon: f.lon, time: f.time })),
          `${this.routeName} - ${new Date(this.startedAt).toLocaleString()}`,
        ),
      );
      const json = rideJsonFile(this.id);
      json.create({ overwrite: true });
      json.write(JSON.stringify(this.summary(), null, 1));
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
      distanceMeters: this.distance(),
      fixCount: this.fixes.length,
      calls: this.calls,
    };
    if (ended) log.endedAt = Date.now();
    return log;
  }

  finish(): RideLog {
    this.dirty = true;
    this.flush();
    const log = this.summary(true);
    try {
      const json = rideJsonFile(this.id);
      json.create({ overwrite: true });
      json.write(JSON.stringify(log, null, 1));
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
  try {
    return ridesDirectory()
      .list()
      .filter((entry): entry is File => entry instanceof File && entry.uri.endsWith(".json"))
      .map((file) => {
        try {
          return JSON.parse(file.textSync()) as RideLog;
        } catch {
          return null;
        }
      })
      .filter((log): log is RideLog => log !== null)
      .sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

export function deleteRideLog(id: string): void {
  for (const file of [rideGpxFile(id), rideJsonFile(id)]) {
    try {
      if (file.exists) file.delete();
    } catch {
      // Nothing useful to do.
    }
  }
}
