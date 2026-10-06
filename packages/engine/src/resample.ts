/**
 * Cleaning and resampling: raw GPX in, evenly spaced points out.
 *
 * Planner GPX files are wildly uneven - a straight can be one 400 m segment and
 * a hairpin three points 8 m apart. Everything downstream (smoothing windows,
 * curvature spans, corner lengths) assumes a known constant spacing, so we fix
 * that here first.
 */

import { haversine, interpolate } from "./geo.js";
import type { GeoPoint } from "./types.js";

/**
 * Drop points that repeat the previous one (or sit within `minGap` metres of
 * it). GPS traces parked at a chai stall produce hundreds of these and they
 * generate nonsense curvature.
 */
export function dedupe(points: GeoPoint[], minGap: number): GeoPoint[] {
  const out: GeoPoint[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    const prev = out[out.length - 1];
    if (prev && haversine(prev, p) < minGap) continue;
    out.push(p);
  }
  return out;
}

/** Cumulative along-track distance for each point, metres. Starts at 0. */
export function cumulativeDistances(points: GeoPoint[]): number[] {
  const dists = new Array<number>(points.length);
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (i > 0) total += haversine(points[i - 1]!, p);
    dists[i] = total;
  }
  return dists;
}

/**
 * Walk the polyline and emit a point every `spacing` metres.
 *
 * The result is a polyline through the *same* corridor as the input - no
 * geometry is invented. Sparse corners come out as a sharp polygon vertex,
 * which the smoothing stage then rounds into a plausible arc.
 */
export function resample(points: GeoPoint[], spacing: number): GeoPoint[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [{ ...points[0]! }];
  if (spacing <= 0) throw new Error("resample spacing must be > 0");

  const cum = cumulativeDistances(points);
  const total = cum[cum.length - 1]!;
  if (total === 0) return [{ ...points[0]! }];

  const out: GeoPoint[] = [];
  let seg = 0;
  const count = Math.floor(total / spacing);
  for (let i = 0; i <= count; i++) {
    const target = i * spacing;
    while (seg < points.length - 2 && cum[seg + 1]! < target) seg++;
    const d0 = cum[seg]!;
    const d1 = cum[seg + 1]!;
    const span = d1 - d0;
    const t = span > 0 ? (target - d0) / span : 0;
    out.push(interpolate(points[seg]!, points[seg + 1]!, t));
  }
  // Always finish exactly on the last point so the route length is honest.
  const last = points[points.length - 1]!;
  if (total - count * spacing > spacing * 0.25) out.push({ ...last });
  else if (out.length > 0) out[out.length - 1] = { ...last };
  return out;
}
