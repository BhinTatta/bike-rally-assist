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
 * Ride the route and collect every call the co-driver makes.
 */
export function simulateRide(
  route: AnalysedRoute,
  options: SimulationOptions = {},
  configOverride?: DeepPartial<EngineConfig>,
): SimulationResult {
  const {
    speedKmh = 40,
    rateHz = 1,
    noiseMeters = 0,
    startTime = Date.UTC(2024, 0, 1, 6, 0, 0),
    seed = 1,
    lateralG = 0,
  } = options;

  const rand = mulberry32(seed);
  const codriver = new CoDriver(route, configOverride);
  const dt = 1 / rateHz;
  const cruise = speedKmh / 3.6;

  const fixes: GpsFix[] = [];
  const calls: Call[] = [];
  let dist = 0;
  let t = 0;

  while (dist <= route.length) {
    // Brake for what is coming, like a human: look a few seconds up the road.
    const radius = radiusAhead(route, dist, Math.max(25, cruise * 3));
    const limit =
      lateralG > 0 && Number.isFinite(radius)
        ? Math.sqrt(lateralG * 9.81 * radius)
        : Infinity;
    const speed = Math.max(2, Math.min(cruise, limit));

    const truth = pointAtDistance(route, dist);
    const ahead = pointAtDistance(route, Math.min(route.length, dist + 1));
    let observed = truth;
    if (noiseMeters > 0) {
      observed = destination(
        truth,
        Math.abs(gaussian(rand)) * noiseMeters,
        rand() * 360,
      );
    }
    const fix: GpsFix = {
      lat: observed.lat,
      lon: observed.lon,
      speed,
      heading: haversine(truth, ahead) > 0 ? bearing(truth, ahead) : 0,
      accuracy: noiseMeters > 0 ? Math.max(3, noiseMeters) : 3,
      time: startTime + Math.round(t * 1000),
    };
    fixes.push(fix);
    calls.push(...codriver.update(fix));

    dist += speed * dt;
    t += dt;
  }

  return { fixes, calls, durationSeconds: t };
}
