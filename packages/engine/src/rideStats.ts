/**
 * Numbers for the end of a ride: how far, how fast, how many corners.
 *
 * Fed one fix at a time alongside the co-driver, so it costs nothing and
 * survives the same process restarts the co-driver does (it can be rebuilt
 * from a saved snapshot).
 */

import type { CoDriverState } from "./codriver.js";
import { haversine } from "./geo.js";
import type { Call, GpsFix } from "./types.js";

export interface RideStats {
  /** Distance actually covered, metres. */
  distanceMeters: number;
  /** First fix to last fix, seconds. */
  durationSeconds: number;
  /** Time spent above walking pace, seconds. */
  movingSeconds: number;
  /** Top speed, m/s. */
  maxSpeed: number;
  /** Corners announced. */
  cornersCalled: number;
  /** Corner calls that opened with "slow" or "brake". */
  overspeedCalls: number;
  /** Hazards announced: crests, speed breakers, surface changes... */
  hazardsCalled: number;
  /** Largest estimated lean angle, degrees. */
  maxLean: number;
  /** Time spent off the route, seconds. */
  offRouteSeconds: number;
}

export const EMPTY_RIDE_STATS: RideStats = {
  distanceMeters: 0,
  durationSeconds: 0,
  movingSeconds: 0,
  maxSpeed: 0,
  cornersCalled: 0,
  overspeedCalls: 0,
  hazardsCalled: 0,
  maxLean: 0,
  offRouteSeconds: 0,
};

/** Average speed while moving, m/s. */
export const averageMovingSpeed = (stats: RideStats): number =>
  stats.movingSeconds > 0 ? stats.distanceMeters / stats.movingSeconds : 0;

/** Anything faster than this between two fixes is a GPS jump, not riding. m/s. */
const MAX_PLAUSIBLE_SPEED = 85;
/** Below this the bike counts as stopped. m/s. */
const MOVING_SPEED = 1.5;
/** A phone's idea of lean from map curvature is rough; never claim more. */
const MAX_LEAN = 55;

export class RideStatsTracker {
  private stats: RideStats;
  private last: GpsFix | null = null;
  private first: GpsFix | null = null;
  private previousLean = 0;

  constructor(resumeFrom?: RideStats) {
    this.stats = { ...EMPTY_RIDE_STATS, ...(resumeFrom ?? {}) };
  }

  addFix(fix: GpsFix, state: CoDriverState): void {
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return;
    if (fix.accuracy !== undefined && fix.accuracy > 50) return;
    const stats = this.stats;
    if (!this.first) this.first = fix;

    const last = this.last;
    if (last && fix.time > last.time) {
      const dt = (fix.time - last.time) / 1000;
      const step = haversine(last, fix);
      const implied = step / dt;
      // A gap (tunnel, GPS loss) is counted as time but not as moving time,
      // and a teleport is not counted as distance.
      if (dt <= 10 && implied <= MAX_PLAUSIBLE_SPEED) {
        const speed = state.speed;
        if (speed >= MOVING_SPEED) {
          stats.distanceMeters += step;
          stats.movingSeconds += dt;
        }
        if (!state.onRoute) stats.offRouteSeconds += dt;
      }
      stats.durationSeconds += dt;
    }
    this.last = fix;

    if (Number.isFinite(state.speed) && state.speed <= MAX_PLAUSIBLE_SPEED) {
      stats.maxSpeed = Math.max(stats.maxSpeed, state.speed);
    }
    // Two samples in a row must agree before a lean counts: one noisy fix on
    // a hairpin apex would otherwise report a knee-down that never happened.
    const lean = Math.min(MAX_LEAN, state.lean);
    stats.maxLean = Math.max(stats.maxLean, Math.min(lean, this.previousLean));
    this.previousLean = lean;
  }

  addCall(call: Call): void {
    if (call.kind === "corner") {
      this.stats.cornersCalled += Math.max(1, call.cornerIds.length);
      if (call.overspeed) this.stats.overspeedCalls++;
    } else if (call.kind === "feature") {
      this.stats.hazardsCalled++;
    }
  }

  snapshot(): RideStats {
    return { ...this.stats };
  }
}
