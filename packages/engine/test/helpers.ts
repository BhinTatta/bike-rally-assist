/**
 * Shared synthetic-geometry helpers for the tests.
 *
 * Building routes from exact maths (straights, circular arcs) means a test can
 * assert "this is a 50 m radius corner" and know it to the metre.
 */

import { destination, haversine } from "../src/geo.js";
import type { GeoPoint } from "../src/types.js";

/** Somewhere on the Tamhini ghat, near Pune - a real-ish latitude matters. */
export const ORIGIN: GeoPoint = { lat: 18.4521, lon: 73.4123 };

/** A straight run of `length` metres on `heading`, sampled every `step` m. */
export function straight(
  from: GeoPoint,
  heading: number,
  length: number,
  step = 10,
): GeoPoint[] {
  const points: GeoPoint[] = [];
  for (let d = 0; d <= length + 1e-9; d += step) {
    points.push(destination(from, d, heading));
  }
  return points;
}

/**
 * A circular arc of the given radius sweeping `sweepDeg` (positive = right
 * turn, negative = left), starting at `from` heading `heading`.
 */
export function arc(
  from: GeoPoint,
  heading: number,
  radius: number,
  sweepDeg: number,
  step = 5,
): GeoPoint[] {
  const sign = Math.sign(sweepDeg) || 1;
  // Centre is 90 degrees to the side we are turning towards.
  const centre = destination(from, radius, heading + 90 * sign);
  // Bearing from the centre back out to the rider.
  const startBearing = (heading - 90 * sign + 360) % 360;
  const totalArc = (Math.abs(sweepDeg) * Math.PI * radius) / 180;
  const steps = Math.max(1, Math.round(totalArc / step));
  const points: GeoPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    const sweep = sweepDeg * frac;
    points.push(destination(centre, radius, startBearing + sweep));
  }
  return points;
}

/** Heading at the end of an arc. */
export const headingAfterArc = (heading: number, sweepDeg: number): number =>
  (heading + sweepDeg + 360) % 360;

/** Join point lists, dropping the duplicated junction points. */
export function join(...parts: GeoPoint[][]): GeoPoint[] {
  const out: GeoPoint[] = [];
  for (const part of parts) {
    for (const p of part) {
      const prev = out[out.length - 1];
      if (prev && haversine(prev, p) < 0.5) continue;
      out.push(p);
    }
  }
  return out;
}

/** The last point of a list (throws rather than returning undefined). */
export function last(points: GeoPoint[]): GeoPoint {
  const p = points[points.length - 1];
  if (!p) throw new Error("empty point list");
  return p;
}

/** Deterministic noise so "noisy GPS" tests are reproducible. */
export function noisy(points: GeoPoint[], sigma: number, seed = 7): GeoPoint[] {
  let a = seed >>> 0;
  const rand = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return points.map((p) =>
    destination(p, Math.abs(rand() - 0.5) * 2 * sigma, rand() * 360),
  );
}
