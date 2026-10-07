/**
 * Synthetic OSM data for the matcher tests.
 *
 * The idea: build a "true" road the way OSM would have it (dense, surveyed,
 * split into several ways that share junction nodes), then degrade it into the
 * kind of GPX a route planner produces (sparse, corners cut, drawn 10-15 m off
 * the real centreline). A good matcher recovers the true road from the rough
 * line; that is exactly what this layer exists to do.
 */

import { destination, haversine } from "@rally/engine";
import type { GeoPoint } from "@rally/engine";
import type { OsmWay, RoadNetwork } from "../src/types.js";

export const ORIGIN: GeoPoint = { lat: 18.4521, lon: 73.4123 };

export function straight(
  from: GeoPoint,
  heading: number,
  length: number,
  step = 10,
): GeoPoint[] {
  const out: GeoPoint[] = [];
  for (let d = step; d <= length + 1e-9; d += step) out.push(destination(from, d, heading));
  return out;
}

export function arc(
  from: GeoPoint,
  heading: number,
  radius: number,
  sweepDeg: number,
  step = 4,
): GeoPoint[] {
  const sign = Math.sign(sweepDeg) || 1;
  const centre = destination(from, radius, heading + 90 * sign);
  const startBearing = (heading - 90 * sign + 360) % 360;
  const arcLength = (Math.abs(sweepDeg) * Math.PI * radius) / 180;
  const steps = Math.max(2, Math.round(arcLength / step));
  const out: GeoPoint[] = [];
  for (let i = 1; i <= steps; i++) {
    out.push(destination(centre, radius, startBearing + (sweepDeg * i) / steps));
  }
  return out;
}

export const last = (points: GeoPoint[]): GeoPoint => {
  const p = points[points.length - 1];
  if (!p) throw new Error("empty");
  return p;
};

/**
 * A surveyed ghat road: straights, sweepers and two tight hairpins, sampled
 * every ~4 m the way a GPS survey or a careful OSM tracer would.
 */
export function trueGhatRoad(): GeoPoint[] {
  let cursor = ORIGIN;
  let heading = 15;
  const points: GeoPoint[] = [cursor];
  const push = (piece: GeoPoint[]): void => {
    points.push(...piece);
    cursor = last(piece);
  };
  const run = (length: number): void => push(straight(cursor, heading, length, 10));
  const bend = (radius: number, sweep: number): void => {
    push(arc(cursor, heading, radius, sweep));
    heading = (heading + sweep + 360) % 360;
  };

  run(250);
  bend(55, 65);
  run(120);
  bend(14, 168); // hairpin right
  run(140);
  bend(16, -170); // hairpin left
  run(160);
  bend(90, 55);
  run(220);
  bend(32, -85);
  run(180);
  return points;
}

/** Split a polyline into `count` OSM ways that share their junction nodes. */
export function asWays(
  points: GeoPoint[],
  count: number,
  startId = 1000,
  tags: Record<string, string> = { highway: "secondary", name: "Ghat Road" },
): OsmWay[] {
  const ways: OsmWay[] = [];
  const per = Math.ceil(points.length / count);
  for (let i = 0; i < count; i++) {
    const from = i * per;
    const to = Math.min(points.length, from + per + 1); // share the junction node
    if (to - from < 2) break;
    ways.push({ id: startId + i, geometry: points.slice(from, to).map((p) => ({ ...p })), tags });
  }
  return ways;
}

/** Wrap ways in a RoadNetwork. */
export const asNetwork = (ways: OsmWay[]): RoadNetwork => ({
  ways,
  boxes: [],
  fetchedAt: Date.now(),
});

/**
 * Degrade a surveyed road into a planner's GPX: keep roughly every `keepEvery`
 * metres, shift each kept point sideways by a few metres, and - crucially -
 * cut the corners, which is what planners actually do.
 */
export function roughPlannerGpx(
  road: GeoPoint[],
  { keepEvery = 45, offsetMeters = 9, seed = 5 } = {},
): GeoPoint[] {
  let a = seed >>> 0;
  const rand = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: GeoPoint[] = [];
  let sinceKept = Infinity;
  for (let i = 0; i < road.length; i++) {
    const point = road[i]!;
    if (i > 0) sinceKept += haversine(road[i - 1]!, point);
    const isEnd = i === 0 || i === road.length - 1;
    if (!isEnd && sinceKept < keepEvery) continue;
    sinceKept = 0;
    out.push(destination(point, rand() * offsetMeters, rand() * 360));
  }
  return out;
}

/** A decoy road running parallel 60 m away, to tempt the matcher. */
export function parallelDecoy(road: GeoPoint[], offset = 60): OsmWay {
  return {
    id: 9000,
    geometry: road
      .filter((_, i) => i % 3 === 0)
      .map((p) => destination(p, offset, 90)),
    tags: { highway: "track", name: "Decoy track" },
  };
}
