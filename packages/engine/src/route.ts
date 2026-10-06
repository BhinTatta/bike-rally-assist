/**
 * The analysis pipeline, end to end:
 *
 *   raw points -> dedupe -> resample -> smooth -> curvature -> corners
 *
 * This is the only function the app and CLI need for route import.
 */

import { resolveConfig, type DeepPartial, type EngineConfig } from "./config.js";
import { computeCurvature } from "./curvature.js";
import { detectCorners } from "./corners.js";
import { parseGpx } from "./gpx.js";
import { dedupe, resample } from "./resample.js";
import { smooth } from "./smooth.js";
import type { AnalysedRoute, Corner, GeoPoint } from "./types.js";

export function analyseRoute(
  raw: GeoPoint[],
  configOverride?: DeepPartial<EngineConfig>,
  name?: string,
): AnalysedRoute {
  const config = resolveConfig(configOverride);
  const { geometry } = config;

  const cleaned = dedupe(raw, geometry.dedupeMeters);
  const spaced = resample(cleaned, geometry.resampleMeters);
  const smoothed = smooth(
    spaced,
    geometry.smoothing,
    geometry.smoothWindow,
    geometry.smoothPolyOrder,
  );
  const points = computeCurvature(
    smoothed,
    geometry.resampleMeters,
    geometry.curvatureSpanMeters,
  );
  const corners = detectCorners(points, config);
  const route: AnalysedRoute = {
    points,
    corners,
    length: points.length > 0 ? points[points.length - 1]!.dist : 0,
    spacing: geometry.resampleMeters,
  };
  if (name !== undefined) route.name = name;
  return route;
}

/** Convenience: GPX text straight to an analysed route. */
export function analyseGpx(
  xml: string,
  configOverride?: DeepPartial<EngineConfig>,
): AnalysedRoute {
  const parsed = parseGpx(xml);
  if (parsed.points.length < 2) {
    throw new Error("GPX contains fewer than 2 usable points");
  }
  return analyseRoute(parsed.points, configOverride, parsed.name);
}

export interface RouteStats {
  lengthMeters: number;
  cornerCount: number;
  hairpinCount: number;
  /** Corners per kilometre - a decent "twistiness" headline number. */
  cornersPerKm: number;
  byGrade: Record<string, number>;
  /** The 1 km window with the most total heading change. */
  twistiestSection?: {
    startDist: number;
    endDist: number;
    headingChange: number;
    cornerCount: number;
  };
}

/** Summary numbers for the route preview screen. */
export function routeStats(route: AnalysedRoute, windowMeters = 1000): RouteStats {
  const byGrade: Record<string, number> = {};
  for (const c of route.corners) byGrade[c.grade] = (byGrade[c.grade] ?? 0) + 1;

  const stats: RouteStats = {
    lengthMeters: route.length,
    cornerCount: route.corners.length,
    hairpinCount: byGrade["hairpin"] ?? 0,
    cornersPerKm:
      route.length > 0 ? (route.corners.length / route.length) * 1000 : 0,
    byGrade,
  };

  // Slide a window over the route and keep the busiest one.
  let best: RouteStats["twistiestSection"];
  for (let i = 0; i < route.corners.length; i++) {
    const start = route.corners[i]!.startDist;
    let heading = 0;
    let count = 0;
    let end = start;
    for (let j = i; j < route.corners.length; j++) {
      const c = route.corners[j]!;
      if (c.endDist - start > windowMeters) break;
      heading += c.headingChange;
      count++;
      end = c.endDist;
    }
    if (!best || heading > best.headingChange) {
      best = { startDist: start, endDist: end, headingChange: heading, cornerCount: count };
    }
  }
  if (best) stats.twistiestSection = best;
  return stats;
}

/** First corner starting at or after `dist`, or undefined past the last one. */
export function nextCornerAfter(
  corners: Corner[],
  dist: number,
): Corner | undefined {
  return corners.find((c) => c.startDist >= dist);
}
