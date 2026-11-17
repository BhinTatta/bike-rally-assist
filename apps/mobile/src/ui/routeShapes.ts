/**
 * Turning a route into things that can be drawn.
 *
 * Long routes are the hard case. A 127 km import is 25,000 points and 750
 * corners; the map needs a few thousand points and a handful of paths. So the
 * points are walked exactly once, straights are thinned hard, gentle corners a
 * little, and tight corners not at all - a hairpin is only a dozen points long
 * and is the one shape on the map that has to be right.
 *
 * Everything is projected into a flat frame in metres with y pointing down the
 * screen, so the same numbers work as SVG coordinates.
 */

import type { AnalysedRoute, CornerGrade, RoadFeature } from "@rally/engine";

export interface WorldPoint {
  x: number;
  y: number;
}

export interface RouteShapes {
  /** The whole route as one path. */
  base: string;
  /** One multi-segment path per corner grade present on the route. */
  grades: { grade: CornerGrade; d: string }[];
  start: WorldPoint;
  finish: WorldPoint;
  features: { feature: RoadFeature; at: WorldPoint }[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Project any lat/lon into this frame. */
  project: (lat: number, lon: number) => WorldPoint;
  /** Position at a distance along the route, and the heading there (degrees). */
  at: (dist: number) => WorldPoint & { heading: number };
}

const METRES_PER_DEGREE = 111_320;

/** Most points to draw on the straights; corners add their own on top. */
const MAX_STRAIGHT_POINTS = 2200;

const f = (n: number): string => n.toFixed(1);

export function buildRouteShapes(route: AnalysedRoute): RouteShapes {
  const { points, corners } = route;
  const origin = points[0] ?? { lat: 0, lon: 0 };
  const lonScale = METRES_PER_DEGREE * Math.cos((origin.lat * Math.PI) / 180);
  const project = (lat: number, lon: number): WorldPoint => ({
    x: (lon - origin.lon) * lonScale,
    y: -(lat - origin.lat) * METRES_PER_DEGREE,
  });

  const stride = Math.max(1, Math.ceil(points.length / MAX_STRAIGHT_POINTS));
  const base: string[] = [];
  const gradeRuns = new Map<CornerGrade, string[]>();

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  let cornerIndex = 0;
  let activeCorner = -1;
  let run: string[] = [];
  const closeRun = (): void => {
    if (activeCorner >= 0 && run.length >= 2) {
      const grade = corners[activeCorner]!.grade;
      const list = gradeRuns.get(grade);
      const segment = `M${run.join("L")}`;
      if (list) list.push(segment);
      else gradeRuns.set(grade, [segment]);
    }
    run = [];
  };

  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    // Corners are in route order, so one forward-moving cursor is enough.
    while (cornerIndex < corners.length && corners[cornerIndex]!.endDist < point.dist) cornerIndex++;
    const corner = corners[cornerIndex];
    const inCorner = corner !== undefined && point.dist >= corner.startDist;
    const here = inCorner ? cornerIndex : -1;

    const world = project(point.lat, point.lon);
    const text = `${f(world.x)} ${f(world.y)}`;
    const boundary = here !== activeCorner;
    const keepEvery = inCorner ? (corner.rallyNumber <= 3 ? 1 : Math.max(1, stride >> 1)) : stride;
    const keep = boundary || i % keepEvery === 0 || i === points.length - 1;

    if (boundary) {
      // Close the old run on this point so the colours meet without a gap.
      if (activeCorner >= 0) run.push(text);
      closeRun();
      activeCorner = here;
    }
    if (!keep) continue;
    base.push(text);
    if (inCorner) run.push(text);
    if (world.x < minX) minX = world.x;
    if (world.x > maxX) maxX = world.x;
    if (world.y < minY) minY = world.y;
    if (world.y > maxY) maxY = world.y;
  }
  closeRun();

  if (!Number.isFinite(minX)) {
    minX = minY = 0;
    maxX = maxY = 1;
  }

  const at = (dist: number): WorldPoint & { heading: number } => {
    if (points.length === 0) return { x: 0, y: 0, heading: 0 };
    const index = Math.max(0, Math.min(points.length - 1, Math.round(dist / route.spacing)));
    const point = points[index]!;
    return { ...project(point.lat, point.lon), heading: point.heading };
  };

  const first = points[0];
  const last = points[points.length - 1];
  return {
    base: base.length >= 2 ? `M${base.join("L")}` : "",
    grades: [...gradeRuns.entries()].map(([grade, runs]) => ({ grade, d: runs.join("") })),
    start: first ? project(first.lat, first.lon) : { x: 0, y: 0 },
    finish: last ? project(last.lat, last.lon) : { x: 0, y: 0 },
    features: (route.features ?? []).map((feature) => ({ feature, at: at(feature.dist) })),
    bounds: { minX, minY, maxX, maxY },
    project,
    at,
  };
}

/**
 * A tiny version of the route's shape for list thumbnails: up to `count`
 * points, flattened to [x0, y0, x1, y1, ...] in a 0-1 box, north up.
 * Stored in the route index so the list never has to open a route file.
 */
export function routeThumbnail(route: AnalysedRoute, count = 90): number[] {
  const { points } = route;
  if (points.length < 2) return [];
  const origin = points[0]!;
  const lonScale = Math.cos((origin.lat * Math.PI) / 180);
  const step = Math.max(1, Math.floor(points.length / count));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < points.length; i += step) {
    xs.push((points[i]!.lon - origin.lon) * lonScale);
    ys.push(-(points[i]!.lat - origin.lat));
  }
  const last = points[points.length - 1]!;
  xs.push((last.lon - origin.lon) * lonScale);
  ys.push(-(last.lat - origin.lat));

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const size = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 1e-9);
  // Centre the shorter axis.
  const padX = (size - (Math.max(...xs) - minX)) / 2;
  const padY = (size - (Math.max(...ys) - minY)) / 2;
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    out.push(
      Math.round(((xs[i]! - minX + padX) / size) * 1000) / 1000,
      Math.round(((ys[i]! - minY + padY) / size) * 1000) / 1000,
    );
  }
  return out;
}

export interface AheadShapes {
  /** The road, as a path in a frame where the rider is at (0,0) heading up. */
  road: string;
  corners: { grade: CornerGrade; d: string }[];
  features: { feature: RoadFeature; x: number; y: number }[];
  /** Furthest point drawn, metres ahead of the rider along the road. */
  reach: number;
}

/**
 * The next stretch of road as seen from the saddle: rider at the origin,
 * direction of travel straight up the screen.
 */
export function buildAheadShapes(
  route: AnalysedRoute,
  dist: number,
  direction: 1 | -1,
  ahead: number,
  behind: number,
): AheadShapes {
  const { points, corners, spacing } = route;
  if (points.length < 2) return { road: "", corners: [], features: [], reach: 0 };
  const clampIndex = (i: number): number => Math.max(0, Math.min(points.length - 1, i));
  const here = clampIndex(Math.round(dist / spacing));
  const from = clampIndex(Math.round((dist - (direction === 1 ? behind : ahead)) / spacing));
  const to = clampIndex(Math.round((dist + (direction === 1 ? ahead : behind)) / spacing));

  const origin = points[here]!;
  const lonScale = METRES_PER_DEGREE * Math.cos((origin.lat * Math.PI) / 180);
  // Smooth the heading over a few samples so one noisy point cannot spin the view.
  const a = points[clampIndex(here - 2 * direction)]!;
  const b = points[clampIndex(here + 3 * direction)]!;
  const east = (b.lon - a.lon) * lonScale;
  const north = (b.lat - a.lat) * METRES_PER_DEGREE;
  const length = Math.hypot(east, north) || 1;
  // Unit vector of travel; rotate so it becomes screen-up (0, -1).
  const ux = east / length;
  const uy = north / length;
  const transform = (lat: number, lon: number): WorldPoint => {
    const e = (lon - origin.lon) * lonScale;
    const n = (lat - origin.lat) * METRES_PER_DEGREE;
    return { x: e * uy - n * ux, y: -(e * ux + n * uy) };
  };

  const step = Math.max(1, Math.round((to - from) / 220));
  const road: string[] = [];
  const cornerRuns = new Map<CornerGrade, string[]>();
  let run: string[] = [];
  let runGrade: CornerGrade | null = null;
  const closeRun = (): void => {
    if (runGrade && run.length >= 2) {
      const list = cornerRuns.get(runGrade);
      const segment = `M${run.join("L")}`;
      if (list) list.push(segment);
      else cornerRuns.set(runGrade, [segment]);
    }
    run = [];
  };

  let cornerIndex = 0;
  for (let i = from; i <= to; i += step) {
    const point = points[i]!;
    while (cornerIndex < corners.length && corners[cornerIndex]!.endDist < point.dist) cornerIndex++;
    const corner = corners[cornerIndex];
    const grade = corner !== undefined && point.dist >= corner.startDist ? corner.grade : null;
    const local = transform(point.lat, point.lon);
    const text = `${f(local.x)} ${f(local.y)}`;
    road.push(text);
    if (grade !== runGrade) {
      if (runGrade) run.push(text);
      closeRun();
      runGrade = grade;
    }
    if (grade) run.push(text);
  }
  closeRun();

  const lo = points[from]!.dist;
  const hi = points[to]!.dist;
  const features = (route.features ?? [])
    .filter((feature) => feature.dist >= lo && feature.dist <= hi)
    .map((feature) => {
      const point = points[clampIndex(Math.round(feature.dist / spacing))]!;
      return { feature, ...transform(point.lat, point.lon) };
    });

  return {
    road: road.length >= 2 ? `M${road.join("L")}` : "",
    corners: [...cornerRuns.entries()].map(([grade, runs]) => ({ grade, d: runs.join("") })),
    features,
    reach: direction === 1 ? hi - dist : dist - lo,
  };
}

export interface ProfileShapes {
  /** Elevation as a filled area path in a `width` x `height` box, or null. */
  elevation: string | null;
  minEle: number;
  maxEle: number;
}

/** The elevation profile, thinned to a few hundred samples. */
export function buildProfile(route: AnalysedRoute, width: number, height: number): ProfileShapes {
  const { points } = route;
  const step = Math.max(1, Math.floor(points.length / 240));
  const samples: { dist: number; ele: number }[] = [];
  for (let i = 0; i < points.length; i += step) {
    const point = points[i]!;
    if (point.ele !== undefined && Number.isFinite(point.ele)) {
      samples.push({ dist: point.dist, ele: point.ele });
    }
  }
  if (samples.length < 8 || route.length <= 0) return { elevation: null, minEle: 0, maxEle: 0 };
  let minEle = Infinity;
  let maxEle = -Infinity;
  for (const sample of samples) {
    if (sample.ele < minEle) minEle = sample.ele;
    if (sample.ele > maxEle) maxEle = sample.ele;
  }
  // A route that is flat to within a few metres would otherwise be drawn as
  // mountains made of GPS noise.
  const range = Math.max(30, maxEle - minEle);
  const xy = samples.map(
    (sample) =>
      `${f((sample.dist / route.length) * width)} ${f(
        height - ((sample.ele - minEle) / range) * (height - 4) - 2,
      )}`,
  );
  return {
    elevation: `M0 ${height}L${xy.join("L")}L${width} ${height}Z`,
    minEle,
    maxEle,
  };
}
