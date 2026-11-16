/**
 * Everything about the road that is not a corner.
 *
 * A pacenote is more than "left 3": it also says the road goes over a crest,
 * drops steeply, turns to gravel, or that the next four kilometres are one
 * hairpin after another. This module finds those things:
 *
 *   elevation  -> crests, dips, steep descents and climbs, total ascent
 *   corners    -> approach length, gradient, and which ones deserve "caution"
 *   the lot    -> sections: straight / flowing / twisty / technical
 *
 * Features that need map tags (surface, bridges, speed breakers) are found by
 * `@rally/osm` and merged in with `mergeFeatures`; this package stays pure.
 */

import type { FeatureConfig } from "./config.js";
import type {
  AnalysedRoute,
  Corner,
  RoadFeature,
  RoutePoint,
  RouteSection,
  SectionKind,
} from "./types.js";

export type NewFeature = Omit<RoadFeature, "id">;

// ---------------------------------------------------------------- elevation

/**
 * A smoothed elevation value for every point, or null when the route has no
 * usable elevation. Gaps (points without `ele`) are filled by interpolation.
 */
export function elevationProfile(
  points: RoutePoint[],
  spacing: number,
  smoothMeters: number,
): number[] | null {
  const n = points.length;
  if (n < 3) return null;
  let known = 0;
  for (const p of points) if (p.ele !== undefined && Number.isFinite(p.ele)) known++;
  // A handful of stray values is not a profile.
  if (known < n * 0.5 || known < 3) return null;

  // Fill gaps: carry the nearest known values inwards and interpolate.
  const raw = new Array<number>(n);
  let lastKnown = -1;
  for (let i = 0; i < n; i++) {
    const ele = points[i]!.ele;
    if (ele === undefined || !Number.isFinite(ele)) continue;
    if (lastKnown < 0) {
      for (let j = 0; j < i; j++) raw[j] = ele;
    } else {
      const from = raw[lastKnown]!;
      for (let j = lastKnown + 1; j < i; j++) {
        raw[j] = from + ((ele - from) * (j - lastKnown)) / (i - lastKnown);
      }
    }
    raw[i] = ele;
    lastKnown = i;
  }
  for (let j = lastKnown + 1; j < n; j++) raw[j] = raw[lastKnown]!;

  // Moving average through prefix sums. Planner elevation comes from a 30 m
  // terrain model and steps like a staircase; without this every step reads
  // as a cliff.
  const half = Math.max(1, Math.round(smoothMeters / spacing / 2));
  const prefix = new Array<number>(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + raw[i]!;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n - 1, i + half);
    out[i] = (prefix[b + 1]! - prefix[a]!) / (b - a + 1);
  }
  return out;
}

/** Gradient in percent at every point, from a smoothed profile. */
export function gradientProfile(
  points: RoutePoint[],
  elevation: number[],
  spacing: number,
  spanMeters: number,
): number[] {
  const n = points.length;
  const half = Math.max(1, Math.round(spanMeters / spacing / 2));
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n - 1, i + half);
    const run = points[b]!.dist - points[a]!.dist;
    out[i] = run > 0 ? ((elevation[b]! - elevation[a]!) / run) * 100 : 0;
  }
  return out;
}

interface Run {
  start: number;
  end: number;
}

/** Runs of consecutive points passing a test, with short gaps bridged. */
function runsWhere(
  n: number,
  test: (i: number) => boolean,
  bridge: number,
): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  for (let i = 0; i < n; i++) {
    if (test(i)) {
      if (current) current.end = i;
      else current = { start: i, end: i };
    } else if (current && i - current.end > bridge) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  return runs;
}

function elevationFeatures(
  points: RoutePoint[],
  gradient: number[],
  spacing: number,
  config: FeatureConfig,
): NewFeature[] {
  const n = points.length;
  const features: NewFeature[] = [];
  const bridge = Math.round(50 / spacing);

  const steep = (
    kind: "steep-descent" | "steep-climb",
    test: (g: number) => boolean,
  ): void => {
    for (const run of runsWhere(n, (i) => test(gradient[i]!), bridge)) {
      const start = points[run.start]!;
      const end = points[run.end]!;
      if (end.dist - start.dist < config.steepMinMeters) continue;
      let sum = 0;
      for (let i = run.start; i <= run.end; i++) sum += gradient[i]!;
      features.push({
        kind,
        dist: start.dist,
        endDist: end.dist,
        gradientPercent: sum / (run.end - run.start + 1),
        source: "elevation",
      });
    }
  };
  steep("steep-descent", (g) => g <= -config.steepDescentPercent);
  steep("steep-climb", (g) => g >= config.steepClimbPercent);

  // Crests and dips: the gradient changes sign, and is properly steep on both
  // sides. A crest is where you cannot see what the road does next.
  const reach = Math.max(2, Math.round(100 / spacing));
  let lastCrest = -Infinity;
  let lastDip = -Infinity;
  for (let i = 1; i < n; i++) {
    const before = gradient[i - 1]!;
    const here = gradient[i]!;
    const isCrest = before > 0 && here <= 0;
    const isDip = before < 0 && here >= 0;
    if (!isCrest && !isDip) continue;
    let maxBefore = -Infinity;
    let minBefore = Infinity;
    for (let j = Math.max(0, i - reach); j < i; j++) {
      maxBefore = Math.max(maxBefore, gradient[j]!);
      minBefore = Math.min(minBefore, gradient[j]!);
    }
    let maxAfter = -Infinity;
    let minAfter = Infinity;
    for (let j = i; j <= Math.min(n - 1, i + reach); j++) {
      maxAfter = Math.max(maxAfter, gradient[j]!);
      minAfter = Math.min(minAfter, gradient[j]!);
    }
    const dist = points[i]!.dist;
    const g = config.crestGradientPercent;
    if (isCrest && maxBefore >= g && minAfter <= -g) {
      if (dist - lastCrest >= config.crestMinSpacingMeters) {
        features.push({ kind: "crest", dist, source: "elevation" });
        lastCrest = dist;
      }
    } else if (isDip && minBefore <= -g && maxAfter >= g) {
      if (dist - lastDip >= config.crestMinSpacingMeters) {
        features.push({ kind: "dip", dist, source: "elevation" });
        lastDip = dist;
      }
    }
  }
  return features;
}

// ------------------------------------------------------------------ corners

/** Fill in approach length, gradient and the caution flag on every corner. */
function enrichCorners(
  corners: Corner[],
  points: RoutePoint[],
  gradient: number[] | null,
  spacing: number,
  config: FeatureConfig,
): void {
  for (let i = 0; i < corners.length; i++) {
    const corner = corners[i]!;
    const previous = corners[i - 1];
    corner.approachMeters = corner.startDist - (previous ? previous.endDist : 0);

    if (gradient) {
      const a = Math.max(0, Math.round(corner.startDist / spacing));
      const b = Math.min(points.length - 1, Math.round(corner.endDist / spacing));
      let sum = 0;
      let count = 0;
      for (let j = a; j <= b; j++) {
        sum += gradient[j]!;
        count++;
      }
      if (count > 0) corner.gradientPercent = sum / count;
    }

    const tight = corner.rallyNumber <= config.cautionMaxRallyNumber;
    const fastApproach = corner.approachMeters >= config.cautionApproachMeters;
    const steepDown =
      corner.gradientPercent !== undefined &&
      corner.gradientPercent <= -config.cautionDescentPercent;
    // A hairpin in a stack of hairpins is expected; the one that ends a long
    // straight, or that waits at the bottom of a hill, is the one that bites.
    if (tight && (fastApproach || steepDown)) corner.caution = true;
    else delete corner.caution;
  }
}

// ----------------------------------------------------------------- sections

const SECTION_ORDER: SectionKind[] = ["straight", "flowing", "twisty", "technical"];

function sectionKindFor(turnPerKm: number, config: FeatureConfig): SectionKind {
  if (turnPerKm >= config.technicalTurnPerKm) return "technical";
  if (turnPerKm >= config.twistyTurnPerKm) return "twisty";
  if (turnPerKm >= config.flowingTurnPerKm) return "flowing";
  return "straight";
}

/**
 * Cut the route into stretches of similar character.
 *
 * Heading change is binned along the route, averaged over a window, classified
 * and then tidied: a 200 m "straight" in the middle of a ghat is not a section
 * anyone would name, so short ones fold into whichever neighbour is closer in
 * character.
 */
export function detectSections(
  corners: Corner[],
  length: number,
  config: FeatureConfig,
): RouteSection[] {
  if (length <= 0) return [];
  const bin = 100;
  const bins = Math.max(1, Math.ceil(length / bin));
  const turn = new Array<number>(bins).fill(0);
  for (const corner of corners) {
    const span = Math.max(1, corner.endDist - corner.startDist);
    const first = Math.max(0, Math.floor(corner.startDist / bin));
    const last = Math.min(bins - 1, Math.floor(corner.endDist / bin));
    for (let b = first; b <= last; b++) {
      const overlap =
        Math.min(corner.endDist, (b + 1) * bin) - Math.max(corner.startDist, b * bin);
      if (overlap > 0) turn[b] = turn[b]! + (corner.headingChange * overlap) / span;
    }
  }

  const half = Math.max(1, Math.round(config.sectionWindowMeters / bin / 2));
  const kinds: SectionKind[] = [];
  for (let b = 0; b < bins; b++) {
    const a = Math.max(0, b - half);
    const z = Math.min(bins - 1, b + half);
    let sum = 0;
    for (let i = a; i <= z; i++) sum += turn[i]!;
    const perKm = (sum / ((z - a + 1) * bin)) * 1000;
    kinds.push(sectionKindFor(perKm, config));
  }

  interface Span {
    kind: SectionKind;
    start: number;
    end: number;
  }
  let spans: Span[] = [];
  for (let b = 0; b < bins; b++) {
    const last = spans[spans.length - 1];
    if (last && last.kind === kinds[b]) last.end = b;
    else spans.push({ kind: kinds[b]!, start: b, end: b });
  }

  // Fold short spans into the neighbour closest in character, shortest first,
  // until nothing short is left (or only one span remains).
  const minBins = Math.max(1, Math.round(config.sectionMinMeters / bin));
  const rank = (kind: SectionKind): number => SECTION_ORDER.indexOf(kind);
  for (;;) {
    if (spans.length <= 1) break;
    let shortest = -1;
    let shortestLength = Infinity;
    for (let i = 0; i < spans.length; i++) {
      const size = spans[i]!.end - spans[i]!.start + 1;
      if (size < minBins && size < shortestLength) {
        shortest = i;
        shortestLength = size;
      }
    }
    if (shortest < 0) break;
    const span = spans[shortest]!;
    const left = spans[shortest - 1];
    const right = spans[shortest + 1];
    const useLeft =
      left !== undefined &&
      (right === undefined ||
        Math.abs(rank(left.kind) - rank(span.kind)) <=
          Math.abs(rank(right.kind) - rank(span.kind)));
    if (useLeft && left) left.end = span.end;
    else if (right) right.start = span.start;
    spans.splice(shortest, 1);
    // Folding can leave two neighbours of the same kind side by side.
    const merged: Span[] = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last && last.kind === s.kind) last.end = s.end;
      else merged.push(s);
    }
    spans = merged;
  }

  return spans.map((span, id) => {
    const startDist = span.start * bin;
    const endDist = Math.min(length, (span.end + 1) * bin);
    let cornerCount = 0;
    let hairpinCount = 0;
    let heading = 0;
    for (const corner of corners) {
      if (corner.apexDist < startDist || corner.apexDist >= endDist) continue;
      cornerCount++;
      heading += corner.headingChange;
      if (corner.grade === "hairpin") hairpinCount++;
    }
    const km = Math.max(0.001, (endDist - startDist) / 1000);
    return {
      id,
      kind: span.kind,
      startDist,
      endDist,
      cornerCount,
      hairpinCount,
      turnPerKm: heading / km,
    };
  });
}

// ------------------------------------------------------------------- public

/** Sort features into route order and number them. */
function numbered(features: NewFeature[]): RoadFeature[] {
  return [...features]
    .sort((a, b) => a.dist - b.dist)
    .map((feature, id) => ({ ...feature, id }));
}

/**
 * Add everything this module knows how to find to an analysed route, in place.
 * Called by `analyseRoute`; safe to call again after corners change.
 */
export function annotateRoute(route: AnalysedRoute, config: FeatureConfig): void {
  const { points, corners, spacing } = route;
  const elevation = elevationProfile(points, spacing, config.elevationSmoothMeters);
  const gradient = elevation
    ? gradientProfile(points, elevation, spacing, config.gradientSpanMeters)
    : null;

  enrichCorners(corners, points, gradient, spacing, config);
  route.sections = detectSections(corners, route.length, config);

  const found: NewFeature[] = [];
  delete route.ascent;
  delete route.descent;
  if (elevation && gradient) {
    found.push(...elevationFeatures(points, gradient, spacing, config));
    let ascent = 0;
    let descent = 0;
    for (let i = 1; i < elevation.length; i++) {
      const delta = elevation[i]! - elevation[i - 1]!;
      if (delta > 0) ascent += delta;
      else descent -= delta;
    }
    route.ascent = ascent;
    route.descent = descent;
  }
  // Keep anything that came from map tags; only the elevation features are
  // recomputed here.
  const kept = (route.features ?? []).filter((f) => f.source !== "elevation");
  route.features = numbered([...kept, ...found]);
}

/** Merge features found elsewhere (map tags) into a route, in place. */
export function mergeFeatures(route: AnalysedRoute, extra: NewFeature[]): void {
  const clipped = extra
    .filter((f) => Number.isFinite(f.dist) && f.dist >= 0 && f.dist <= route.length)
    .map((f) =>
      f.endDist !== undefined ? { ...f, endDist: Math.min(route.length, f.endDist) } : f,
    );
  route.features = numbered([...(route.features ?? []), ...clipped]);
}

/** The section containing a distance along the route. */
export function sectionAt(route: AnalysedRoute, dist: number): RouteSection | undefined {
  const sections = route.sections ?? [];
  for (const section of sections) {
    if (dist >= section.startDist && dist < section.endDist) return section;
  }
  return sections[sections.length - 1];
}
