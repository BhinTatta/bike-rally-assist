/**
 * Synthetic riding, used by the tests and the CLI simulator.
 *
 * Lives in the engine (not the CLI) because it is pure maths and the mobile app
 * will want it too, for the "preview the calls for this route" feature.
 */

import { bearing, destination, haversine } from "./geo.js";
import type { AnalysedRoute, Call, GeoPoint, GpsFix } from "./types.js";
import { CoDriver } from "./codriver.js";
import type { DeepPartial, EngineConfig } from "./config.js";

export interface SimulationOptions {
  /** Target speed in km/h. */
  speedKmh?: number;
  /** Fix rate, Hz. */
  rateHz?: number;
  /** Gaussian-ish GPS noise, metres (1 sigma). */
  noiseMeters?: number;
  /** Start time, epoch ms. */
  startTime?: number;
  /** Deterministic noise seed. */
  seed?: number;
  /**
   * Slow down for corners: speed is capped at sqrt(lateralG * 9.81 * radius).
   * Set to 0 to ride at a constant speed.
   */
  lateralG?: number;
}

export interface SimulationResult {
  fixes: GpsFix[];
  calls: Call[];
  /** How long the simulated ride took, seconds. */
  durationSeconds: number;
}

/** Tiny deterministic PRNG so noisy tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller normal sample from a uniform generator. */
function gaussian(rand: () => number): number {
  const u = Math.max(1e-9, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Position on the route at a given distance along it. */
export function pointAtDistance(route: AnalysedRoute, dist: number): GeoPoint {
  const pts = route.points;
  if (pts.length === 0) throw new Error("empty route");
  if (dist <= 0) return pts[0]!;
  const last = pts[pts.length - 1]!;
  if (dist >= last.dist) return last;
  // Points are evenly spaced, so the index is a good first guess.
  let i = Math.min(pts.length - 2, Math.floor(dist / route.spacing));
  while (i > 0 && pts[i]!.dist > dist) i--;
  while (i < pts.length - 2 && pts[i + 1]!.dist < dist) i++;
  const a = pts[i]!;
  const b = pts[i + 1]!;
  const span = b.dist - a.dist;
  const t = span > 0 ? (dist - a.dist) / span : 0;
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
  };
}

/** Tightest radius anywhere in the next `ahead` metres of road. */
function radiusAhead(route: AnalysedRoute, dist: number, ahead: number): number {
  const first = Math.max(0, Math.round(dist / route.spacing));
  const last = Math.min(
    route.points.length - 1,
    Math.round((dist + ahead) / route.spacing),
  );
  let peak = 0;
  for (let i = first; i <= last; i++) {
    peak = Math.max(peak, Math.abs(route.points[i]!.curvature));
  }
  return peak > 0 ? 1 / peak : Infinity;
}

/**
 * A speed for every point of the route, for a rider who cruises at `cruise`,
 * slows for corners, and can only brake and accelerate so hard.
 *
 * One backwards pass makes sure every corner is reachable under braking, one
 * forwards pass limits how quickly speed comes back afterwards. The result is
 * what a real ride looks like on a graph, which is what a preview should feel
 * like.
 */
export function speedProfile(
  route: AnalysedRoute,
  cruise: number,
  lateralG: number,
  accel = 2.2,
  decel = 3.5,
): number[] {
  const pts = route.points;
  const n = pts.length;
  const profile = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const k = Math.abs(pts[i]!.curvature);
    const limit = k > 0 && lateralG > 0 ? Math.sqrt((lateralG * 9.81) / k) : Infinity;
    profile[i] = Math.max(2, Math.min(cruise, limit));
  }
  for (let i = n - 2; i >= 0; i--) {
    const step = pts[i + 1]!.dist - pts[i]!.dist;
    const reachable = Math.sqrt(profile[i + 1]! ** 2 + 2 * decel * step);
    if (profile[i]! > reachable) profile[i] = reachable;
  }
  for (let i = 1; i < n; i++) {
    const step = pts[i]!.dist - pts[i - 1]!.dist;
    const reachable = Math.sqrt(profile[i - 1]! ** 2 + 2 * accel * step);
    if (profile[i]! > reachable) profile[i] = reachable;
  }
  return profile;
}

export interface SimulatorOptions extends SimulationOptions {
  /** Where on the route to start, metres. */
  startDist?: number;
  /**
   * Brake and accelerate like a rider instead of changing speed instantly.
   * Used by the in-app preview; the tests keep the simpler instant model.
   */
  smooth?: boolean;
}

/**
 * A ride you can step through: ask for the next fix whenever you want one.
 *
 * `simulateRide` runs one of these to the end in a loop; the app's preview
 * steps it on a timer and feeds the fixes to the real ride engine, so what you
 * hear at your desk is exactly what you would hear on the road.
 */
export class RideSimulator {
  private readonly rand: () => number;
  private readonly cruise: number;
  private readonly lateralG: number;
  private readonly noiseMeters: number;
  private readonly profile: number[] | null;
  private dist: number;
  private t = 0;
  private readonly startTime: number;

  constructor(
    private readonly route: AnalysedRoute,
    options: SimulatorOptions = {},
  ) {
    this.rand = mulberry32(options.seed ?? 1);
    this.cruise = (options.speedKmh ?? 40) / 3.6;
    this.lateralG = options.lateralG ?? 0;
    this.noiseMeters = options.noiseMeters ?? 0;
    this.startTime = options.startTime ?? Date.UTC(2024, 0, 1, 6, 0, 0);
    this.dist = Math.max(0, options.startDist ?? 0);
    this.profile = options.smooth
      ? speedProfile(route, this.cruise, this.lateralG > 0 ? this.lateralG : 0.35)
      : null;
  }

  /** Metres along the route. */
  get position(): number {
    return this.dist;
  }

  get finished(): boolean {
    return this.dist > this.route.length;
  }

  /** Jump to a distance along the route (the preview's scrubber). */
  seek(dist: number): void {
    this.dist = Math.max(0, Math.min(this.route.length, dist));
  }

  private speedHere(): number {
    if (this.profile) {
      const index = Math.max(
        0,
        Math.min(this.profile.length - 1, Math.round(this.dist / this.route.spacing)),
      );
      return this.profile[index]!;
    }
    // Brake for what is coming, like a human: look a few seconds up the road.
    const radius = radiusAhead(this.route, this.dist, Math.max(25, this.cruise * 3));
    const limit =
      this.lateralG > 0 && Number.isFinite(radius)
        ? Math.sqrt(this.lateralG * 9.81 * radius)
        : Infinity;
    return Math.max(2, Math.min(this.cruise, limit));
  }

  /**
   * The fix for the current position, then advance `dt` seconds.
   * Returns null once the end of the route has been passed.
   */
  step(dt: number): GpsFix | null {
    if (this.finished) return null;
    const speed = this.speedHere();
    const truth = pointAtDistance(this.route, this.dist);
    const ahead = pointAtDistance(this.route, Math.min(this.route.length, this.dist + 1));
    let observed = truth;
    if (this.noiseMeters > 0) {
      observed = destination(
        truth,
        Math.abs(gaussian(this.rand)) * this.noiseMeters,
        this.rand() * 360,
      );
    }
    const fix: GpsFix = {
      lat: observed.lat,
      lon: observed.lon,
      speed,
      heading: haversine(truth, ahead) > 0 ? bearing(truth, ahead) : 0,
      accuracy: this.noiseMeters > 0 ? Math.max(3, this.noiseMeters) : 3,
      time: this.startTime + Math.round(this.t * 1000),
    };
    this.dist += speed * dt;
    this.t += dt;
    return fix;
  }

  /** Seconds of simulated time elapsed. */
  get elapsed(): number {
    return this.t;
  }
}

/**
 * Ride the route and collect every call the co-driver makes.
 */
export function simulateRide(
  route: AnalysedRoute,
  options: SimulationOptions = {},
  configOverride?: DeepPartial<EngineConfig>,
): SimulationResult {
  const simulator = new RideSimulator(route, options);
  const codriver = new CoDriver(route, configOverride);
  const dt = 1 / (options.rateHz ?? 1);

  const fixes: GpsFix[] = [];
  const calls: Call[] = [];
  for (;;) {
    const fix = simulator.step(dt);
    if (!fix) break;
    fixes.push(fix);
    calls.push(...codriver.update(fix));
  }
  return { fixes, calls, durationSeconds: simulator.elapsed };
}
