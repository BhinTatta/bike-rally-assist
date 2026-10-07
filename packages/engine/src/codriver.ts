/**
 * The runtime co-driver: GPS fixes in, spoken calls out.
 *
 * It is a plain stateful class with no timers, no I/O and no platform APIs, so
 * the exact same object runs in a Vitest test, in the CLI simulator and inside
 * the Android background location task.
 *
 * Each `update(fix)` returns zero or more calls that should be spoken *now*.
 */

import {
  resolveConfig,
  type DeepPartial,
  type EngineConfig,
} from "./config.js";
import { haversine, pointToSegment } from "./geo.js";
import { buildCornerCall, buildStatusCall } from "./phrase.js";
import type {
  AnalysedRoute,
  Call,
  Corner,
  GpsFix,
  SnapResult,
} from "./types.js";

export interface CoDriverState {
  /** Distance along the route, metres; null before the first usable fix. */
  dist: number | null;
  /** +1 riding the route as drawn, -1 riding back along it after a U-turn. */
  travelDirection: 1 | -1;
  /** Lag-compensated distance used for triggering, metres. */
  projectedDist: number | null;
  /** Perpendicular distance from the route, metres. */
  offset: number | null;
  onRoute: boolean;
  /** Current speed, m/s (measured, or derived from consecutive fixes). */
  speed: number;
  /** Reported horizontal accuracy of the last fix, metres. */
  accuracy: number | null;
  /** Epoch ms of the last accepted fix. */
  lastFixTime: number | null;
  gpsOk: boolean;
  /** The next corner ahead that has not been called yet. */
  nextCorner: Corner | null;
  /** Distance to that corner's entry, metres. */
  distanceToNextCorner: number | null;
  /** Corners announced so far. */
  calledCornerIds: number[];
  finished: boolean;
}

export class CoDriver {
  readonly route: AnalysedRoute;
  readonly config: EngineConfig;

  private lastIndex: number | null = null;
  private lastDist: number | null = null;
  private projectedDist: number | null = null;
  private offset: number | null = null;
  private onRoute = true;
  private offRouteAnnounced = false;
  private speed = 0;
  /** Low-passed speed derived from positions, when the platform gives none. */
  private derivedSpeed: number | null = null;
  private accuracy: number | null = null;
  private lastFix: GpsFix | null = null;
  private lastFixTime: number | null = null;
  private gpsOk = true;
  private gpsLostAnnounced = false;
  private finished = false;
  /** +1 riding the route as drawn, -1 riding back along it. */
  private travelDirection: 1 | -1 = 1;
  /** Signed metres of consistent travel, used to decide a U-turn happened. */
  private directionEvidence = 0;
  private readonly called = new Set<number>();

  constructor(route: AnalysedRoute, configOverride?: DeepPartial<EngineConfig>) {
    this.route = route;
    this.config = resolveConfig(configOverride);
  }

  /**
   * Mark a corner as already announced.
   *
   * Used when the co-driver has to be rebuilt mid-ride (the rider changed the
   * lead time or verbosity, or the app process was restarted) so that nothing
   * is called twice.
   */
  markCalled(cornerId: number): void {
    this.called.add(cornerId);
  }

  /** Forget everything except the route - used when a ride is restarted. */
  reset(): void {
    this.lastIndex = null;
    this.lastDist = null;
    this.projectedDist = null;
    this.offset = null;
    this.onRoute = true;
    this.offRouteAnnounced = false;
    this.speed = 0;
    this.derivedSpeed = null;
    this.accuracy = null;
    this.lastFix = null;
    this.lastFixTime = null;
    this.gpsOk = true;
    this.gpsLostAnnounced = false;
    this.finished = false;
    this.travelDirection = 1;
    this.directionEvidence = 0;
    this.called.clear();
  }

  getState(): CoDriverState {
    const next = this.findNextCorner();
    return {
      dist: this.lastDist,
      travelDirection: this.travelDirection,
      projectedDist: this.projectedDist,
      offset: this.offset,
      onRoute: this.onRoute,
      speed: this.speed,
      accuracy: this.accuracy,
      lastFixTime: this.lastFixTime,
      gpsOk: this.gpsOk,
      nextCorner: next ?? null,
      distanceToNextCorner:
        next && this.projectedDist !== null
          ? next.startDist - this.projectedDist
          : null,
      calledCornerIds: [...this.called],
      finished: this.finished,
    };
  }

  /**
   * Call this on a timer (even when no fix arrives) so a dead GPS is noticed.
   * Returns a "GPS lost" call the first time the fix age passes the threshold.
   */
  tick(now: number): Call[] {
    if (this.lastFixTime === null) return [];
    const age = (now - this.lastFixTime) / 1000;
    if (age > this.config.runtime.gpsLostSeconds && !this.gpsLostAnnounced) {
      this.gpsOk = false;
      this.gpsLostAnnounced = true;
      return [buildStatusCall("gps-lost", now, this.lastDist ?? undefined)];
    }
    return [];
  }

  /** Feed one GPS fix. Returns the calls to speak, in order. */
  update(fix: GpsFix): Call[] {
    const { runtime } = this.config;
    const calls: Call[] = [];

    // 1. Reject junk fixes outright - a 200 m-accuracy fix under a ghat cliff
    //    would otherwise throw the snap halfway across a switchback.
    if (
      !Number.isFinite(fix.lat) ||
      !Number.isFinite(fix.lon) ||
      (fix.accuracy !== undefined &&
        Number.isFinite(fix.accuracy) &&
        fix.accuracy > runtime.maxAccuracyMeters)
    ) {
      return this.tick(fix.time);
    }

    // 2. A fix after a long silence means the GPS came back.
    if (!this.gpsOk) {
      this.gpsOk = true;
      this.gpsLostAnnounced = false;
      calls.push(buildStatusCall("gps-restored", fix.time, this.lastDist ?? undefined));
    } else if (
      this.lastFixTime !== null &&
      (fix.time - this.lastFixTime) / 1000 > runtime.gpsLostSeconds
    ) {
      // A gap we only notice on the far side (no tick() was running).
      calls.push(buildStatusCall("gps-lost", fix.time, this.lastDist ?? undefined));
      calls.push(buildStatusCall("gps-restored", fix.time, this.lastDist ?? undefined));
    }

    this.accuracy = fix.accuracy ?? null;

    // 3. Where are we on the route?
    const snap = this.snap(fix);
    this.speed = this.estimateSpeed(fix, snap);
    const wasOnRoute = this.onRoute;
    const previousDist = this.lastDist;
    this.lastIndex = snap.index;
    this.lastDist = snap.dist;
    this.offset = snap.offset;
    this.onRoute = snap.onRoute;

    if (!snap.onRoute) {
      if (!this.offRouteAnnounced) {
        this.offRouteAnnounced = true;
        calls.push(buildStatusCall("off-route", fix.time, snap.dist));
      }
      this.lastFix = fix;
      this.lastFixTime = fix.time;
      this.projectedDist = null;
      return calls;
    }

    if (!wasOnRoute && this.offRouteAnnounced) {
      this.offRouteAnnounced = false;
      if (runtime.announceBackOnRoute) {
        calls.push(buildStatusCall("back-on-route", fix.time, snap.dist));
      }
    }

    // 4. Which way along the route are we actually going? A ghat ride is very
    //    often out and back, and after turning round every corner is a mirror
    //    image of the one in the file.
    const reversedCall = this.trackDirection(previousDist, snap.dist, fix.time);
    if (reversedCall) calls.push(reversedCall);

    // 5. Lag compensation: by the time the words land in the rider's ear, the
    //    bike has moved. Trigger from where it will be, not where it was.
    const projected = snap.dist + this.speed * runtime.lagSeconds * this.travelDirection;
    const isFirstFix = this.projectedDist === null;
    this.projectedDist = projected;
    this.lastFix = fix;
    this.lastFixTime = fix.time;

    // 6. Starting mid-route: never announce corners that are already behind.
    if (isFirstFix) this.silenceCornersBehind(projected);

    // 7. Corners we have driven through without calling (too slow, bad fixes,
    //    off-route detour) must not pop out late.
    for (const corner of this.route.corners) {
      if (!this.called.has(corner.id) && this.isPastEntry(corner, projected)) {
        this.called.add(corner.id);
      }
    }

    // 8. Route end - whichever end we are heading for.
    const toEnd =
      this.travelDirection === 1 ? this.route.length - snap.dist : snap.dist;
    if (!this.finished && toEnd <= runtime.routeEndMeters) {
      this.finished = true;
      calls.push(buildStatusCall("route-end", fix.time, snap.dist));
    } else if (this.finished && toEnd > runtime.routeEndMeters) {
      // Rode away from the end again (a U-turn at the top): allow it to fire
      // once more when the other end arrives.
      this.finished = false;
    }

    // 9. The actual corner call.
    const cornerCall = this.maybeCallCorner(projected, fix.time, snap.dist);
    if (cornerCall) calls.push(cornerCall);
    return calls;
  }

  // ---------------------------------------------------------------- internals

  /**
   * Speed from the fix if the platform reports one (Android does, and it comes
   * from Doppler, which is far better than differencing positions).
   *
   * Otherwise derive it from progress *along the route* rather than from the
   * straight-line distance between fixes: perpendicular GPS noise is projected
   * away by the snap, and what is left is low-passed.
   */
  private estimateSpeed(fix: GpsFix, snap: SnapResult): number {
    if (fix.speed !== undefined && Number.isFinite(fix.speed) && fix.speed >= 0) {
      return fix.speed;
    }
    let raw: number | null = null;
    if (this.lastFix && fix.time > this.lastFix.time) {
      const dt = (fix.time - this.lastFix.time) / 1000;
      if (dt > 0 && dt < 10) {
        raw =
          snap.onRoute && this.lastDist !== null && this.onRoute
            ? Math.abs(snap.dist - this.lastDist) / dt
            : haversine(this.lastFix, fix) / dt;
      }
    }
    if (raw === null) return this.derivedSpeed ?? this.config.runtime.fallbackSpeed;
    const alpha = this.config.runtime.derivedSpeedSmoothing;
    this.derivedSpeed =
      this.derivedSpeed === null ? raw : alpha * raw + (1 - alpha) * this.derivedSpeed;
    return this.derivedSpeed;
  }

  /**
   * Snap the fix onto the route.
   *
   * Searching a window around the last known position is what stops a hairpin
   * stack - two legs of road 20 m apart but 400 m apart along the route - from
   * teleporting the rider between legs. Once off-route we search the whole
   * route so a rider who rejoins is picked up again.
   */
  private snap(fix: GpsFix): SnapResult {
    const { points } = this.route;
    const { runtime } = this.config;
    const n = points.length;
    if (n === 0) {
      return { index: 0, dist: 0, offset: Infinity, onRoute: false };
    }

    let from = 0;
    let to = n - 1;
    if (this.lastIndex !== null && this.onRoute) {
      const windowPoints = Math.max(
        2,
        Math.round(runtime.snapSearchMeters / this.route.spacing),
      );
      // Allow a little backwards travel (stopping, rolling back, U-turn) but
      // much more forwards travel (a dropped fix at speed).
      from = Math.max(0, this.lastIndex - Math.round(windowPoints / 2));
      to = Math.min(n - 1, this.lastIndex + windowPoints);
    }

    let bestIndex = from;
    let bestDist = Infinity;
    for (let i = from; i <= to; i++) {
      const d = haversine(fix, points[i]!);
      if (d < bestDist) {
        bestDist = d;
        bestIndex = i;
      }
    }

    // Refine against the two adjacent segments so `dist` is continuous rather
    // than quantised to the 5 m sample spacing.
    let dist = points[bestIndex]!.dist;
    let offset = bestDist;
    for (const i of [bestIndex - 1, bestIndex]) {
      if (i < 0 || i + 1 >= n) continue;
      const a = points[i]!;
      const b = points[i + 1]!;
      const proj = pointToSegment(fix, a, b);
      if (proj.distance < offset) {
        offset = proj.distance;
        dist = a.dist + (b.dist - a.dist) * proj.t;
      }
    }

    return {
      index: bestIndex,
      dist,
      offset,
      onRoute: offset <= runtime.offRouteMeters,
    };
  }

  // --------------------------------------------------------- travel direction

  /**
   * Work out whether the rider is still going the way the route was drawn.
   *
   * Evidence accumulates: every metre forward cancels a metre back. Only when
   * `uTurnMeters` of *consistent* travel the other way has piled up is the
   * U-turn accepted - a stop, a wobble, or GPS drift never gets there.
   */
  private trackDirection(
    previousDist: number | null,
    dist: number,
    time: number,
  ): Call | null {
    const { runtime } = this.config;
    if (previousDist === null || this.speed < runtime.minSpeedForCalls) return null;

    const delta = dist - previousDist;
    const limit = runtime.uTurnMeters;
    // Evidence only ever measures travel *against* the current direction, and
    // travel with it pays that debt back down to zero - never into credit.
    // Otherwise an hour of riding forwards would bank so much credit that a
    // genuine U-turn took a kilometre to notice.
    const raw = this.directionEvidence + delta;
    this.directionEvidence =
      this.travelDirection === 1
        ? Math.max(-limit * 1.5, Math.min(0, raw))
        : Math.min(limit * 1.5, Math.max(0, raw));

    const goingBackwards = this.travelDirection === 1 && this.directionEvidence <= -limit;
    const goingForwards = this.travelDirection === -1 && this.directionEvidence >= limit;
    if (!goingBackwards && !goingForwards) return null;

    this.travelDirection = goingBackwards ? -1 : 1;
    this.directionEvidence = 0;
    // The whole route is new again from this direction, and every corner is
    // mirrored, so nothing that was called before applies.
    this.called.clear();
    this.silenceCornersBehind(dist);
    this.finished = false;
    return runtime.announceUTurn ? buildStatusCall("reversed", time, dist) : null;
  }

  /** Where a corner begins, in the direction of travel. */
  private entryOf(corner: Corner): number {
    return this.travelDirection === 1 ? corner.startDist : corner.endDist;
  }

  /** Has the rider already crossed this corner's entry? */
  private isPastEntry(corner: Corner, projected: number): boolean {
    return this.travelDirection === 1
      ? corner.startDist < projected
      : corner.endDist > projected;
  }

  /** Mark everything behind the rider as already dealt with. */
  private silenceCornersBehind(projected: number): void {
    for (const corner of this.route.corners) {
      const exit = this.travelDirection === 1 ? corner.endDist : corner.startDist;
      const behind = this.travelDirection === 1 ? exit < projected : exit > projected;
      if (behind) this.called.add(corner.id);
    }
  }

  /**
   * How a corner reads when ridden the other way: a right becomes a left, and
   * a corner that tightened on the way up opens on the way down.
   */
  private asTravelled(corner: Corner): Corner {
    if (this.travelDirection === 1) return corner;
    return {
      ...corner,
      direction: corner.direction === "left" ? "right" : "left",
      modifiers: corner.modifiers
        // "into" points at the next corner in route order, which is behind us
        // now; the chaining logic re-derives it for this direction.
        .filter((m) => m !== "into")
        .map((m) => (m === "tightens" ? "opens" : m === "opens" ? "tightens" : m)),
    };
  }

  /** The corner chained onto `corner` in the current direction, if any. */
  private chainedAfter(corner: Corner): Corner | undefined {
    const corners = this.route.corners;
    if (this.travelDirection === 1) {
      return corner.modifiers.includes("into") ? corners[corner.id + 1] : undefined;
    }
    // Riding back: corner i is followed by corner i-1, and they are chained
    // when the gap between them was short enough in the first place.
    const previous = corners[corner.id - 1];
    return previous?.modifiers.includes("into") === true ? previous : undefined;
  }

  private findNextCorner(): Corner | undefined {
    const d = this.projectedDist;
    if (d === null) return undefined;
    const corners =
      this.travelDirection === 1 ? this.route.corners : [...this.route.corners].reverse();
    const found = corners.find(
      (c) => !this.called.has(c.id) && !this.isPastEntry(c, d),
    );
    return found ? this.asTravelled(found) : undefined;
  }

  /** Decide whether the next corner is due, and build the call if it is. */
  private maybeCallCorner(
    projected: number,
    time: number,
    riderDist: number,
  ): Call | null {
    const { runtime } = this.config;
    if (this.speed < runtime.minSpeedForCalls) return null;

    const corners =
      this.travelDirection === 1 ? this.route.corners : [...this.route.corners].reverse();
    const next = corners.find(
      (c) =>
        !this.called.has(c.id) &&
        !this.isPastEntry(c, projected) &&
        c.rallyNumber <= runtime.maxRallyNumberToCall,
    );
    if (!next) return null;

    const distance = (this.entryOf(next) - projected) * this.travelDirection;
    // Warn `leadSeconds` ahead, clamped so the call is neither a surprise at
    // walking pace nor a distant rumour at 90 km/h.
    const trigger = Math.min(
      runtime.maxLeadMeters,
      Math.max(runtime.minLeadMeters, this.speed * runtime.leadSeconds),
    );
    if (distance > trigger) return null;

    const group = [next];
    if (runtime.chainIntoCorners) {
      let current: Corner | undefined = next;
      while (group.length < runtime.maxChainedCorners && current) {
        const following: Corner | undefined = this.chainedAfter(current);
        if (!following) break;
        group.push(following);
        current = following;
      }
    }
    for (const c of group) this.called.add(c.id);

    return buildCornerCall(
      {
        corners: group.map((c) => this.asTravelled(c)),
        distance,
        timeToCorner: this.speed > 0 ? distance / this.speed : Infinity,
        time,
        riderDist,
        speed: this.speed,
      },
      runtime,
    );
  }
}
