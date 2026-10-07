/**
 * `rally gen-sample <out.gpx>` - build the synthetic ghat road fixtures.
 *
 * One road, two representations:
 *
 *   the GPX   - what a route planner exports: sparse, with hairpins drawn as
 *               three points, which is exactly how Indian ghat roads arrive.
 *   --osm-out - what OSM has for the same road: dense surveyed geometry, split
 *               into several ways that share their junction nodes.
 *
 * Having both lets `--osm-file` demonstrate (and test) the whole Phase 2
 * snapping path with no network and no load on the Overpass servers.
 */

import { writeFileSync } from "node:fs";
import { destination, toGpx } from "@rally/engine";
import type { GeoPoint } from "@rally/engine";
import { dim } from "../util.js";

/** One piece of road: a straight run or a constant-radius bend. */
type Piece =
  | { kind: "run"; length: number; gpxStep: number }
  | { kind: "bend"; radius: number; sweep: number; gpxStep: number };

/**
 * The road itself. `gpxStep` is how far apart the planner's points are for
 * that piece - tight corners deliberately get very few points.
 */
const ROAD: Piece[] = [
  { kind: "run", length: 400, gpxStep: 50 },
  { kind: "bend", radius: 60, sweep: 70, gpxStep: 10 }, // medium right onto the climb
  { kind: "run", length: 150, gpxStep: 25 },
  { kind: "bend", radius: 45, sweep: -80, gpxStep: 10 }, // sharp left
  { kind: "run", length: 60, gpxStep: 25 },
  { kind: "bend", radius: 16, sweep: 170, gpxStep: 18 }, // hairpin right, 3 points
  { kind: "run", length: 120, gpxStep: 25 },
  { kind: "bend", radius: 18, sweep: -165, gpxStep: 20 }, // hairpin left, 3 points
  { kind: "run", length: 90, gpxStep: 25 },
  { kind: "bend", radius: 110, sweep: 50, gpxStep: 10 }, // gentle sweeper
  { kind: "bend", radius: 35, sweep: -75, gpxStep: 8 }, //  ... straight into a sharp left
  { kind: "run", length: 200, gpxStep: 25 },
  { kind: "bend", radius: 250, sweep: 40, gpxStep: 10 }, // slight right
  { kind: "run", length: 300, gpxStep: 60 },
  { kind: "bend", radius: 30, sweep: 150, gpxStep: 9 }, // very sharp right
  { kind: "run", length: 80, gpxStep: 25 },
  { kind: "bend", radius: 70, sweep: -60, gpxStep: 10 }, // S-bend...
  { kind: "bend", radius: 70, sweep: 60, gpxStep: 10 }, // ...and back
  { kind: "run", length: 250, gpxStep: 50 },
  { kind: "bend", radius: 120, sweep: 90, gpxStep: 10 }, // long gentle right
  { kind: "run", length: 400, gpxStep: 80 },
];

/** Roughly the Tamhini ghat, west of Pune. */
const START: GeoPoint = { lat: 18.4521, lon: 73.4123, ele: 620 };
const START_HEADING = 20;

function straight(from: GeoPoint, heading: number, length: number, step: number): GeoPoint[] {
  const out: GeoPoint[] = [];
  for (let d = step; d <= length + 1e-9; d += step) out.push(destination(from, d, heading));
  const end = destination(from, length, heading);
  if (out.length === 0 || out[out.length - 1]!.lat !== end.lat) out.push(end);
  return out;
}

function arc(
  from: GeoPoint,
  heading: number,
  radius: number,
  sweepDeg: number,
  step: number,
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

/** Walk the road, sampling each piece at `stepFor` metres. */
function buildRoad(stepFor: (piece: Piece) => number): GeoPoint[] {
  let cursor: GeoPoint = { ...START };
  let heading = START_HEADING;
  let elevation = START.ele ?? 0;
  const points: GeoPoint[] = [{ ...cursor }];

  for (const piece of ROAD) {
    const step = stepFor(piece);
    const segment =
      piece.kind === "run"
        ? straight(cursor, heading, piece.length, step)
        : arc(cursor, heading, piece.radius, piece.sweep, step);
    for (const point of segment) {
      elevation += piece.kind === "run" ? 0.4 : 0.5;
      points.push({ ...point, ele: Math.round(elevation * 10) / 10 });
    }
    const end = segment[segment.length - 1];
    if (end) cursor = end;
    if (piece.kind === "bend") heading = (heading + piece.sweep + 360) % 360;
  }
  return points;
}

/** Split a polyline into OSM-style ways that share their junction nodes. */
function asOverpassJson(road: GeoPoint[], wayCount: number): string {
  const per = Math.ceil(road.length / wayCount);
  const elements = [];
  for (let i = 0; i < wayCount; i++) {
    const from = i * per;
    const to = Math.min(road.length, from + per + 1); // overlap one node = a junction
    if (to - from < 2) break;
    elements.push({
      type: "way",
      id: 100_000 + i,
      tags: {
        highway: "secondary",
        name: "Tamhini Ghat Road",
        surface: "asphalt",
      },
      geometry: road.slice(from, to).map((p) => ({
        lat: Number(p.lat.toFixed(7)),
        lon: Number(p.lon.toFixed(7)),
      })),
    });
  }
  return JSON.stringify({ version: 0.6, generator: "rally gen-sample", elements }, null, 1);
}

/**
 * Deterministic hand-drawn wobble: a planner line is traced over a basemap by
 * eye, so it sits a few metres off the real centreline and wanders.
 */
function wobble(points: GeoPoint[], sigma: number, seed = 17): GeoPoint[] {
  let a = seed >>> 0;
  const rand = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // A slowly turning offset direction, so the error drifts rather than jitters:
  // that is what a traced line actually looks like.
  let bearingDeg = rand() * 360;
  let magnitude = rand() * sigma;
  return points.map((p) => {
    bearingDeg = (bearingDeg + (rand() - 0.5) * 120 + 360) % 360;
    magnitude = Math.max(0, Math.min(sigma, magnitude + (rand() - 0.5) * sigma));
    const moved = destination(p, magnitude, bearingDeg);
    return p.ele !== undefined ? { ...moved, ele: p.ele } : moved;
  });
}

export function genSampleCommand(out: string, values: Record<string, unknown>): void {
  const sigma = values["wobble"] === undefined ? 0 : Number(values["wobble"]);
  const plannerRoad =
    sigma > 0 ? wobble(buildRoad((piece) => piece.gpxStep), sigma) : buildRoad((piece) => piece.gpxStep);

  // Plausible timestamps at ~35 km/h, so the file also works as a replay source.
  let t = Date.UTC(2024, 10, 17, 2, 30, 0);
  const timed = plannerRoad.map((p, i) => {
    if (i > 0) t += 1000;
    return { ...p, time: t };
  });
  writeFileSync(out, toGpx(timed, "Sample ghat climb"));
  console.log(dim(`Wrote ${out} (${timed.length} points)`));

  if (typeof values["osm-out"] === "string") {
    // The same road as OSM would have it: surveyed every 4 m.
    const surveyed = buildRoad(() => 4);
    writeFileSync(values["osm-out"], asOverpassJson(surveyed, 5));
    console.log(
      dim(`Wrote ${values["osm-out"]} (${surveyed.length} nodes across 5 ways)`),
    );
  }
}
