/**
 * Signed curvature along a resampled polyline.
 *
 * For each point we take the sample `span` metres behind and `span` metres
 * ahead and fit the unique circle through those three points (its circumradius
 * is the Menger curvature). The cross product of the two chords gives the sign:
 * positive = turning left, negative = turning right.
 *
 * Measuring over a ~10 m baseline rather than adjacent samples is what makes
 * this robust: at 5 m spacing, adjacent-sample angles are dominated by noise.
 */

import { bearing, makeFrame, toLocal, type Vec2 } from "./geo.js";
import { cumulativeDistances } from "./resample.js";
import type { GeoPoint, RoutePoint } from "./types.js";

/** Signed curvature (1/m) of the circle through three local-frame points. */
export function mengerCurvature(a: Vec2, b: Vec2, c: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  // Twice the signed triangle area: positive when a->b->c turns left.
  const cross = abx * bcy - aby * bcx;
  const ab = Math.hypot(abx, aby);
  const bc = Math.hypot(bcx, bcy);
  const ac = Math.hypot(acx, acy);
  const denom = ab * bc * ac;
  if (denom === 0) return 0;
  return (2 * cross) / denom;
}

/** Radius in metres for a signed curvature; Infinity for a straight. */
export function radiusOf(curvature: number, maxRadius: number): number {
  const k = Math.abs(curvature);
  if (k === 0) return Infinity;
  const r = 1 / k;
  return r > maxRadius ? Infinity : r;
}

/**
 * Turn evenly spaced geographic points into RoutePoints carrying distance,
 * heading and signed curvature.
 */
export function computeCurvature(
  points: GeoPoint[],
  spacing: number,
  spanMeters: number,
): RoutePoint[] {
  const n = points.length;
  if (n === 0) return [];
  const frame = makeFrame(points[0]!);
  const local: Vec2[] = points.map((p) => toLocal(frame, p));
  // Measured rather than assumed: the last resampled gap can be short.
  const cum = cumulativeDistances(points);
  // How many samples away the curvature probes sit.
  const k = Math.max(1, Math.round(spanMeters / spacing));

  const out: RoutePoint[] = [];
  for (let i = 0; i < n; i++) {
    const src = points[i]!;
    // Keep the probes symmetric; near the ends shrink the span instead of
    // clamping, so an end point does not get a fake corner from a repeated point.
    const kk = Math.min(k, i, n - 1 - i);
    let curvature = 0;
    if (kk >= 1) {
      curvature = mengerCurvature(local[i - kk]!, local[i]!, local[i + kk]!);
    }
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(n - 1, i + 1)]!;
    const heading = n > 1 ? bearing(prev, next) : 0;
    const p: RoutePoint = {
      lat: src.lat,
      lon: src.lon,
      dist: cum[i]!,
      curvature,
      heading,
    };
    if (src.ele !== undefined) p.ele = src.ele;
    if (src.time !== undefined) p.time = src.time;
    out.push(p);
  }
  // The shrinking span at the ends under-reads curvature; fill the first and
  // last k points with the nearest fully measured value instead of a fake zero.
  if (n > 2 * k + 1) {
    for (let i = 0; i < k; i++) out[i]!.curvature = out[k]!.curvature;
    for (let i = n - k; i < n; i++) out[i]!.curvature = out[n - k - 1]!.curvature;
  }
  return out;
}
