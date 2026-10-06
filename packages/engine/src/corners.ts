/**
 * Corner detection: a curvature profile in, a list of corners out.
 *
 * The pipeline is deliberately boring:
 *   1. mark every point tighter than `cornerRadiusMeters` as "cornering",
 *   2. group consecutive marks of the same direction into runs,
 *   3. merge runs of the same direction separated by a short gap (a hairpin
 *      often reads as two runs with a wobble in the middle),
 *   4. throw away runs too short or too straight to be worth saying out loud,
 *   5. measure, grade and label what is left.
 */

import type {
  CornerDetectionConfig,
  EngineConfig,
  GradingConfig,
} from "./config.js";
import { headingDelta } from "./geo.js";
import { radiusOf } from "./curvature.js";
import type {
  Corner,
  CornerGrade,
  CornerModifier,
  Direction,
  RoutePoint,
} from "./types.js";

interface Run {
  start: number;
  end: number;
  direction: Direction;
}

/** Group consecutive above-threshold points of the same sign into runs. */
function findRuns(points: RoutePoint[], minCurvature: number): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  for (let i = 0; i < points.length; i++) {
    const k = points[i]!.curvature;
    const active = Math.abs(k) >= minCurvature;
    const direction: Direction = k > 0 ? "left" : "right";
    if (active) {
      if (current && current.direction === direction) {
        current.end = i;
      } else {
        if (current) runs.push(current);
        current = { start: i, end: i, direction };
      }
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  return runs;
}

/** Merge same-direction runs separated by less than `mergeGapMeters`. */
function mergeRuns(
  runs: Run[],
  points: RoutePoint[],
  mergeGapMeters: number,
): Run[] {
  const merged: Run[] = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.direction === run.direction &&
      points[run.start]!.dist - points[prev.end]!.dist <= mergeGapMeters
    ) {
      prev.end = run.end;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

/** Sum of the absolute heading change between the first and last point. */
function headingChangeDeg(points: RoutePoint[], start: number, end: number): number {
  let total = 0;
  for (let i = start + 1; i <= end; i++) {
    total += Math.abs(headingDelta(points[i - 1]!.heading, points[i]!.heading));
  }
  return total;
}

export function gradeFor(
  minRadius: number,
  headingChange: number,
  grading: GradingConfig,
): CornerGrade {
  if (
    headingChange > grading.hairpinHeadingChangeDeg &&
    minRadius < grading.hairpinRadiusMeters
  ) {
    return "hairpin";
  }
  for (const t of grading.thresholds) {
    if (minRadius < t.maxRadius) return t.grade;
  }
  // Wider than every bucket: report the loosest grade we have a word for.
  return grading.thresholds[grading.thresholds.length - 1]!.grade;
}

/**
 * Length of the stretch where the corner is genuinely tight, i.e. within
 * `sustainedCurvatureFraction` of the apex curvature. The full detected extent
 * is always longer, because smoothing blends the corner into the straights.
 */
function sustainedLength(
  points: RoutePoint[],
  start: number,
  end: number,
  peakCurvature: number,
  fraction: number,
): number {
  const floor = Math.abs(peakCurvature) * fraction;
  let first = -1;
  let last = -1;
  for (let i = start; i <= end; i++) {
    if (Math.abs(points[i]!.curvature) >= floor) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return 0;
  return points[last]!.dist - points[first]!.dist;
}

function modifiersFor(
  points: RoutePoint[],
  start: number,
  end: number,
  sustained: number,
  detection: CornerDetectionConfig,
  maxRadius: number,
): CornerModifier[] {
  const mods: CornerModifier[] = [];
  if (sustained >= detection.longCornerMeters) mods.push("long");

  // "tightens" / "opens": compare the mean radius of each half. Use the mean of
  // curvature (not of radius) so a brief straight-ish sample does not dominate.
  const mid = Math.floor((start + end) / 2);
  const meanRadius = (from: number, to: number): number => {
    let sum = 0;
    let n = 0;
    for (let i = from; i <= to; i++) {
      sum += Math.abs(points[i]!.curvature);
      n++;
    }
    if (n === 0 || sum === 0) return Infinity;
    return radiusOf(sum / n, maxRadius);
  };
  const first = meanRadius(start, mid);
  const second = meanRadius(mid, end);
  if (Number.isFinite(first) && Number.isFinite(second) && first > 0) {
    const ratio = second / first;
    if (ratio <= detection.tightensRatio) mods.push("tightens");
    else if (ratio >= detection.opensRatio) mods.push("opens");
  }
  return mods;
}

/**
 * Detect corners on an already resampled, smoothed and curvature-annotated
 * route.
 */
export function detectCorners(
  points: RoutePoint[],
  config: EngineConfig,
): Corner[] {
  const { detection, grading, geometry } = config;
  if (points.length < 3) return [];

  const minCurvature = 1 / detection.cornerRadiusMeters;
  const runs = mergeRuns(
    findRuns(points, minCurvature),
    points,
    detection.mergeGapMeters,
  );

  const corners: Corner[] = [];
  for (const run of runs) {
    const startPoint = points[run.start]!;
    const endPoint = points[run.end]!;
    const length = endPoint.dist - startPoint.dist;
    const heading = headingChangeDeg(points, run.start, run.end);
    // Noise filter: too little bend is never a corner, and a very short run is
    // only kept when it bends hard (that is what a sparse hairpin looks like).
    const tooStraight = heading < detection.minHeadingChangeDeg;
    const tooShort =
      length < detection.minCornerLengthMeters &&
      heading < detection.shortCornerHeadingChangeDeg;
    if (tooStraight || tooShort) continue;

    // Apex = tightest point in the run.
    let apexIndex = run.start;
    let maxCurvature = 0;
    let curvatureSum = 0;
    for (let i = run.start; i <= run.end; i++) {
      const k = Math.abs(points[i]!.curvature);
      curvatureSum += k;
      if (k > maxCurvature) {
        maxCurvature = k;
        apexIndex = i;
      }
    }
    const apexPoint = points[apexIndex]!;
    const count = run.end - run.start + 1;
    const sustained = sustainedLength(
      points,
      run.start,
      run.end,
      maxCurvature,
      detection.sustainedCurvatureFraction,
    );
    const minRadius = radiusOf(maxCurvature, geometry.maxRadiusMeters);
    const meanRadius = radiusOf(curvatureSum / count, geometry.maxRadiusMeters);
    const grade = gradeFor(minRadius, heading, grading);

    corners.push({
      id: corners.length,
      direction: run.direction,
      startDist: startPoint.dist,
      endDist: endPoint.dist,
      apexDist: apexPoint.dist,
      apex: { lat: apexPoint.lat, lon: apexPoint.lon },
      minRadius,
      meanRadius,
      headingChange: heading,
      length,
      sustainedLength: sustained,
      grade,
      rallyNumber: grading.rallyNumbers[grade],
      modifiers: modifiersFor(
        points,
        run.start,
        run.end,
        sustained,
        detection,
        geometry.maxRadiusMeters,
      ),
    });
  }

  // "into" is a property of the gap to the *next* corner, so it needs a second
  // pass once every corner is known.
  for (let i = 0; i < corners.length - 1; i++) {
    const gap = corners[i + 1]!.startDist - corners[i]!.endDist;
    if (gap <= detection.intoGapMeters) corners[i]!.modifiers.push("into");
  }
  return corners;
}
