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
import {
  buildCornerCall,
  buildFeatureCall,
  buildSectionCall,
  buildStatusCall,
  buildStraightCall,
} from "./phrase.js";
import { brakingDistance, cornerSpeed, leanAngle } from "./modes.js";
import type {
  AnalysedRoute,
  Call,
  Corner,
  GpsFix,
  RoadFeature,
  RouteSection,
  SnapResult,
} from "./types.js";

/** A corner still ahead (or under the wheels), as the rider will meet it. */
export interface UpcomingCorner {
  /** Mirrored when riding the route backwards. */
  corner: Corner;
  /** Metres to the corner entry; zero or less once the rider is inside it. */
  distance: number;
  /** Estimated comfortable speed through it, m/s. */
  advisorySpeed: number;
}

/** A road feature still ahead, as the rider will meet it. */
export interface UpcomingFeature {
  feature: RoadFeature;
  /** Metres to where it starts; zero or less once the rider is on it. */
  distance: number;
}

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
  /**
   * The next few corners ahead by position alone, nearest first - what a ride
   * display should draw. Unlike `nextCorner` a corner stays here after it has
   * been called, right up until the rider leaves it.
   */
  upcoming: UpcomingCorner[];
  /** The nearest road feature ahead, if any is within a couple of kilometres. */
  nextFeature: UpcomingFeature | null;
  /** The stretch of road the rider is on. */
  section: RouteSection | null;
  /** Metres left to ride in the current direction. */
  remaining: number | null;
  /** 0-1 along the route in the current direction. */
  progress: number | null;
  /** Estimated lean angle right now, degrees, from speed and road curvature. */
  lean: number;
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
  /** Road features already announced or passed. */
  private readonly announcedFeatures = new Set<number>();
  /** The section whose character was last announced (or silently entered). */
  private sectionId: number | null = null;
  /** The corner whose exit last had its following straight considered. */
  private straightAfterCorner: number | null = null;
  /**
   * Furthest point up the road whose character has been looked at. Only ever
   * moves forward, so slowing down cannot make the probe fall back across a
   * section boundary and announce the same change twice.
   */
  private sectionProbe: number | null = null;

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
    this.announcedFeatures.clear();
    this.sectionId = null;
    this.straightAfterCorner = null;
    this.sectionProbe = null;
  }

  getState(): CoDriverState {
    const next = this.findNextCorner();
    const dist = this.lastDist;
    const length = this.route.length;
    const remaining =
      dist === null ? null : this.travelDirection === 1 ? length - dist : dist;
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
      upcoming: dist === null || !this.onRoute ? [] : this.upcomingCorners(dist, 4),
      nextFeature: dist === null || !this.onRoute ? null : this.upcomingFeature(dist),
      section: dist === null ? null : this.sectionAt(dist),
      remaining,
      progress:
        remaining === null || length <= 0
          ? null
          : Math.max(0, Math.min(1, 1 - remaining / length)),
      lean:
        dist === null || !this.onRoute
          ? 0
          : leanAngle(this.speed, this.curvatureAt(dist)),
    };
  }

  /** Estimated comfortable speed through a corner in the current mode, m/s. */
  advisorySpeedFor(corner: Corner): number {
    return cornerSpeed(corner.minRadius, this.config.runtime.lateralG);
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
    if (isFirstFix) {
      this.silenceCornersBehind(projected);
      // The road the rider starts on is not news either.
      this.sectionId = this.sectionAt(snap.dist)?.id ?? null;
    }

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

    // 10. Everything that is not a corner: hazards first, then commentary.
    //     Commentary is skipped when a corner was just called - a rider being
    //     told about a hairpin does not also need to hear the scenery.
    const featureCall = this.maybeCallFeature(projected, fix.time, snap.dist);
    if (featureCall) calls.push(featureCall);
    const sectionCall = this.maybeCallSection(projected, fix.time, snap.dist, cornerCall !== null);
    if (sectionCall) calls.push(sectionCall);
    const straightCall = this.maybeCallStraight(snap.dist, fix.time, cornerCall !== null);
    if (straightCall) calls.push(straightCall);
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
    this.announcedFeatures.clear();
    this.silenceCornersBehind(dist);
    this.sectionId = this.sectionAt(dist)?.id ?? null;
    this.sectionProbe = null;
    this.straightAfterCorner = null;
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
    for (const feature of this.route.features ?? []) {
      if (this.featureEntry(feature) * this.travelDirection < projected * this.travelDirection) {
        this.announcedFeatures.add(feature.id);
      }
    }
  }

  /**
   * How a corner reads when ridden the other way: a right becomes a left, and
   * a corner that tightened on the way up opens on the way down.
   */
  private asTravelled(corner: Corner): Corner {
    if (this.travelDirection === 1) return corner;
    const mirrored: Corner = {
      ...corner,
      direction: corner.direction === "left" ? "right" : "left",
      modifiers: corner.modifiers
        // "into" points at the next corner in route order, which is behind us
        // now; the chaining logic re-derives it for this direction.
        .filter((m) => m !== "into")
        .map((m) => (m === "tightens" ? "opens" : m === "opens" ? "tightens" : m)),
    };
    // What was a climb is now a descent, and the approach is the gap on the
    // other side - so the caution flag has to be judged afresh.
    if (corner.gradientPercent !== undefined) mirrored.gradientPercent = -corner.gradientPercent;
    const following = this.route.corners[corner.id + 1];
    mirrored.approachMeters =
      (following ? following.startDist : this.route.length) - corner.endDist;
    const features = this.config.features;
    const tight = corner.rallyNumber <= features.cautionMaxRallyNumber;
    const steepDown =
      mirrored.gradientPercent !== undefined &&
      mirrored.gradientPercent <= -features.cautionDescentPercent;
    if (tight && (mirrored.approachMeters >= features.cautionApproachMeters || steepDown)) {
      mirrored.caution = true;
    } else {
      delete mirrored.caution;
    }
    return mirrored;
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
    let trigger = Math.min(
      runtime.maxLeadMeters,
      Math.max(runtime.minLeadMeters, this.speed * runtime.leadSeconds),
    );
    const advisory = this.advisorySpeedFor(next);
    if (runtime.brakingAwareLead) {
      // Five seconds is plenty for a sweeper and nowhere near enough for a
      // hairpin at the end of a straight: call early enough to slow down.
      const needed = brakingDistance(
        this.speed,
        advisory,
        runtime.brakingG,
        runtime.reactionSeconds,
      );
      trigger = Math.min(runtime.maxLeadMeters * 1.5, Math.max(trigger, needed));
    }
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

    const travelled = group.map((c) => this.asTravelled(c));
    // "Too fast" does not mean faster than the corner - everyone is, five
    // seconds out. It means that even braking harder than usual and reacting
    // at once, the road left is not enough to get down to the corner's speed.
    const overspeed =
      runtime.speedWarnings &&
      next.rallyNumber <= 4 &&
      brakingDistance(
        this.speed,
        advisory,
        runtime.brakingG * (1 + runtime.overspeedMargin),
        runtime.reactionSeconds * 0.5,
      ) > Math.max(0, distance);
    return buildCornerCall(
      {
        corners: travelled,
        distance,
        timeToCorner: this.speed > 0 ? distance / this.speed : Infinity,
        time,
        riderDist,
        speed: this.speed,
        caution: runtime.cautionCalls && travelled[0]!.caution === true,
        overspeed,
        advisorySpeed: advisory,
      },
      runtime,
    );
  }

  // ------------------------------------------------------- beyond the corners

  /** Where a feature begins, in the direction of travel. */
  private featureEntry(feature: RoadFeature): number {
    return this.travelDirection === 1 ? feature.dist : (feature.endDist ?? feature.dist);
  }

  /** How a feature reads in the direction of travel: a climb becomes a descent. */
  private featureAsTravelled(feature: RoadFeature): RoadFeature {
    if (this.travelDirection === 1) return feature;
    const flipped: RoadFeature = { ...feature };
    if (feature.kind === "steep-climb") flipped.kind = "steep-descent";
    else if (feature.kind === "steep-descent") flipped.kind = "steep-climb";
    if (feature.gradientPercent !== undefined) {
      flipped.gradientPercent = -feature.gradientPercent;
    }
    return flipped;
  }

  private maybeCallFeature(projected: number, time: number, riderDist: number): Call | null {
    const features = this.route.features;
    if (!features || features.length === 0) return null;
    const { runtime } = this.config;
    const direction = this.travelDirection;
    const trigger = Math.min(
      runtime.maxLeadMeters,
      Math.max(60, this.speed * runtime.leadSeconds),
    );

    let due: RoadFeature | null = null;
    let dueDistance = Infinity;
    for (const feature of features) {
      if (this.announcedFeatures.has(feature.id)) continue;
      const distance = (this.featureEntry(feature) - projected) * direction;
      if (distance < 0) {
        // Ridden past without saying it (stopped, off route): never say it late.
        this.announcedFeatures.add(feature.id);
        continue;
      }
      if (distance <= trigger && distance < dueDistance) {
        due = feature;
        dueDistance = distance;
      }
    }
    if (!due) return null;
    this.announcedFeatures.add(due.id);
    if (!runtime.announceFeatures || this.speed < runtime.minSpeedForCalls) return null;
    return buildFeatureCall(
      {
        feature: this.featureAsTravelled(due),
        distance: dueDistance,
        time,
        riderDist,
        speed: this.speed,
      },
      runtime,
    );
  }

  private sectionAt(dist: number): RouteSection | null {
    const sections = this.route.sections;
    if (!sections || sections.length === 0) return null;
    for (const section of sections) {
      if (dist >= section.startDist && dist < section.endDist) return section;
    }
    return sections[sections.length - 1] ?? null;
  }

  /**
   * Say what kind of road is coming when it changes.
   *
   * Only changes worth hearing: arriving at something twisty, or the road
   * opening up after it. A flowing stretch between two straights is not news.
   */
  private maybeCallSection(
    projected: number,
    time: number,
    riderDist: number,
    cornerJustCalled: boolean,
  ): Call | null {
    const { runtime } = this.config;
    // Look a little further up the road than the corner calls do, so "twisty
    // section" arrives before its first corner rather than on top of it.
    const lookahead = Math.max(80, this.speed * (runtime.leadSeconds + 3));
    let probe = Math.max(
      0,
      Math.min(this.route.length, projected + lookahead * this.travelDirection),
    );
    if (this.sectionProbe !== null) {
      probe =
        this.travelDirection === 1
          ? Math.max(probe, this.sectionProbe)
          : Math.min(probe, this.sectionProbe);
    }
    this.sectionProbe = probe;
    const section = this.sectionAt(probe);
    if (!section || section.id === this.sectionId) return null;

    const previous =
      this.sectionId === null
        ? null
        : (this.route.sections?.find((s) => s.id === this.sectionId) ?? null);
    this.sectionId = section.id;
    if (!runtime.announceSections || cornerJustCalled) return null;
    if (this.speed < runtime.minSpeedForCalls) return null;

    const length = section.endDist - section.startDist;
    const wasBusy = previous?.kind === "twisty" || previous?.kind === "technical";
    const isBusy = section.kind === "twisty" || section.kind === "technical";
    const worthSaying = isBusy
      ? // Arriving at the twisties, or twisty turning properly technical.
        length >= 500 && (!wasBusy || (section.kind === "technical" && previous?.kind === "twisty"))
      : section.kind === "straight"
        ? wasBusy && length >= 1000
        : previous?.kind === "straight" && length >= 1000;
    if (!worthSaying) return null;
    return buildSectionCall(section, time, riderDist);
  }

  /** After a corner, count out a long clear stretch: "Straight 600". */
  private maybeCallStraight(dist: number, time: number, cornerJustCalled: boolean): Call | null {
    const { runtime } = this.config;
    const corners = this.route.corners;
    if (corners.length === 0) return null;
    const direction = this.travelDirection;

    // The corner most recently left behind, and the next one still to come.
    let exited: Corner | undefined;
    let ahead: Corner | undefined;
    if (direction === 1) {
      for (const corner of corners) {
        if (corner.endDist <= dist) exited = corner;
        else if (corner.startDist > dist) {
          ahead = corner;
          break;
        } else return null; // inside a corner
      }
    } else {
      for (let i = corners.length - 1; i >= 0; i--) {
        const corner = corners[i]!;
        if (corner.startDist >= dist) exited = corner;
        else if (corner.endDist < dist) {
          ahead = corner;
          break;
        } else return null;
      }
    }
    if (!exited || exited.id === this.straightAfterCorner) return null;
    this.straightAfterCorner = exited.id;
    if (!runtime.callStraights || cornerJustCalled) return null;
    if (this.speed < runtime.minSpeedForCalls) return null;

    const end = ahead
      ? direction === 1
        ? ahead.startDist
        : ahead.endDist
      : direction === 1
        ? this.route.length
        : 0;
    const clear = (end - dist) * direction;
    if (clear < runtime.straightMinMeters) return null;
    return buildStraightCall(clear, time, dist, runtime);
  }

  // --------------------------------------------------------- for the display

  private upcomingCorners(dist: number, limit: number): UpcomingCorner[] {
    const { runtime } = this.config;
    const corners = this.route.corners;
    const out: UpcomingCorner[] = [];
    const worth = (c: Corner): boolean => c.rallyNumber <= runtime.maxRallyNumberToCall;
    if (this.travelDirection === 1) {
      // Corners are in route order: binary search for the first not yet left.
      let lo = 0;
      let hi = corners.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (corners[mid]!.endDist <= dist) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < corners.length && out.length < limit; i++) {
        const corner = corners[i]!;
        if (!worth(corner)) continue;
        out.push({
          corner,
          distance: corner.startDist - dist,
          advisorySpeed: this.advisorySpeedFor(corner),
        });
      }
    } else {
      let lo = 0;
      let hi = corners.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (corners[mid]!.startDist < dist) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo - 1; i >= 0 && out.length < limit; i--) {
        const corner = corners[i]!;
        if (!worth(corner)) continue;
        out.push({
          corner: this.asTravelled(corner),
          distance: dist - corner.endDist,
          advisorySpeed: this.advisorySpeedFor(corner),
        });
      }
    }
    return out;
  }

  private upcomingFeature(dist: number): UpcomingFeature | null {
    const features = this.route.features;
    if (!features) return null;
    let best: UpcomingFeature | null = null;
    for (const feature of features) {
      const entry = this.featureEntry(feature);
      const exit =
        this.travelDirection === 1 ? (feature.endDist ?? feature.dist) : feature.dist;
      const toEntry = (entry - dist) * this.travelDirection;
      const toExit = (exit - dist) * this.travelDirection;
      if (toExit < 0 || toEntry > 2000) continue;
      if (!best || toEntry < best.distance) {
        best = { feature: this.featureAsTravelled(feature), distance: toEntry };
      }
    }
    return best;
  }

  /** Road curvature under the rider, 1/m, unsigned. */
  private curvatureAt(dist: number): number {
    const points = this.route.points;
    if (points.length === 0) return 0;
    const index = Math.max(
      0,
      Math.min(points.length - 1, Math.round(dist / this.route.spacing)),
    );
    return Math.abs(points[index]!.curvature);
  }
}
