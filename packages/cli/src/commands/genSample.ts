/**
 * `rally gen-sample <out.gpx>` - build a synthetic ghat road.
 *
 * This is how fixtures/sample-ghat.gpx was made: a climb with hairpins,
 * sweepers, an S-bend and a couple of straights, at a realistic Western Ghats
 * latitude. Having it as a command (rather than a one-off script) means the
 * fixture can be regenerated after any geometry change.
 */

import { writeFileSync } from "node:fs";
import { destination, toGpx } from "@rally/engine";
import type { GeoPoint } from "@rally/engine";
import { dim } from "../util.js";

/** Sprinkle points along a straight. */
function straight(from: GeoPoint, heading: number, length: number, step: number): GeoPoint[] {
  const out: GeoPoint[] = [];
  for (let d = step; d <= length + 1e-9; d += step) out.push(destination(from, d, heading));
  return out;
}

/** Sprinkle points along a circular arc (positive sweep = right). */
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

export function genSampleCommand(out: string): void {
  // Roughly the Tamhini ghat, west of Pune.
  let cursor: GeoPoint = { lat: 18.4521, lon: 73.4123, ele: 620 };
  let heading = 20;
  const points: GeoPoint[] = [{ ...cursor }];
  let elevation = 620;

  /** Append a piece of road, climbing as it goes. */
  const push = (piece: GeoPoint[], climbPerPoint: number): void => {
    for (const p of piece) {
      elevation += climbPerPoint;
      points.push({ ...p, ele: Math.round(elevation * 10) / 10 });
    }
    const end = piece[piece.length - 1];
    if (end) cursor = end;
  };

  const run = (length: number, step = 25): void => {
    push(straight(cursor, heading, length, step), 0.4);
  };
  /**
   * `step` is how far apart the GPX points are: hairpins get sparse points on
   * purpose, because that is exactly what planner exports look like.
   */
  const bend = (radius: number, sweep: number, step = 10): void => {
    push(arc(cursor, heading, radius, sweep, step), 0.5);
    heading = (heading + sweep + 360) % 360;
  };

  run(400, 50);            // approach along the river
  bend(60, 70);            // medium right onto the climb
  run(150);
  bend(45, -80);           // sharp left
  run(60);
  bend(16, 170, 18);       // hairpin right - only 3 points, like real map data
  run(120);
  bend(18, -165, 20);      // hairpin left, equally sparse
  run(90);
  bend(110, 50);           // gentle right sweeper
  bend(35, -75, 8);        // straight into a sharp left: an "into" pair
  run(200);
  bend(250, 40);           // slight right
  run(300, 60);
  bend(30, 150, 9);        // very sharp right, almost a hairpin
  run(80);
  bend(70, -60);           // medium left
  bend(70, 60);            // ... and back: an S-bend
  run(250, 50);
  bend(120, 90);           // long gentle right around the shoulder
  run(400, 80);            // run to the top

  // Give the track plausible timestamps at ~35 km/h so it replays nicely.
  let t = Date.UTC(2024, 10, 17, 2, 30, 0);
  const timed = points.map((p, i) => {
    if (i > 0) t += 1000;
    return { ...p, time: t };
  });

  writeFileSync(out, toGpx(timed, "Sample ghat climb"));
  console.log(dim(`Wrote ${out} (${timed.length} points)`));
}
