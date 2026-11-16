/**
 * Reading the road from its map tags.
 *
 * Once a route has been matched onto OSM ways we know, for every metre of it,
 * which way it is on - and a way carries tags: its surface, whether it is a
 * bridge or a tunnel, how many lanes it has. Nodes carry the point hazards:
 * speed breakers, railway crossings, fords.
 *
 * Coverage is whatever local mappers have added. A speed breaker that is not
 * on the map is not announced, so none of this is ever a reason to stop
 * looking at the road.
 */

import { cumulativeDistances, haversine, makeFrame, pointToSegment, toLocal } from "@rally/engine";
import type { GeoPoint, NewFeature } from "@rally/engine";
import type { OsmNode } from "./types.js";

/** A stretch of the matched route that lies on one OSM way. */
export interface WaySpan {
  wayId: number;
  tags: Record<string, string>;
  /** Metres along the matched geometry. */
  start: number;
  end: number;
}

const UNPAVED = new Set([
  "unpaved",
  "gravel",
  "fine_gravel",
  "dirt",
  "ground",
  "earth",
  "mud",
  "sand",
  "compacted",
  "pebblestone",
  "grass",
  "rock",
  "cobblestone",
  "sett",
  "unhewn_cobblestone",
]);

/** The word to say for a surface tag. */
function surfaceWord(tags: Record<string, string>): string | null {
  const surface = tags["surface"];
  if (surface && UNPAVED.has(surface)) {
    if (surface === "gravel" || surface === "fine_gravel" || surface === "pebblestone") {
      return "gravel";
    }
    if (surface === "cobblestone" || surface === "sett" || surface === "unhewn_cobblestone") {
      return "cobbles";
    }
    if (surface === "sand") return "sand";
    if (surface === "mud") return "mud";
    return "unpaved road";
  }
  // A track with no surface tag is unpaved far more often than not.
  if (!surface && tags["highway"] === "track") return "unpaved road";
  const smoothness = tags["smoothness"];
  if (smoothness === "bad" || smoothness === "very_bad" || smoothness === "horrible") {
    return "broken road";
  }
  return null;
}

const isYes = (value: string | undefined): boolean =>
  value !== undefined && value !== "no" && value !== "false" && value !== "0";

function isNarrow(tags: Record<string, string>): boolean {
  if (tags["narrow"] === "yes") return true;
  const width = Number.parseFloat(tags["width"] ?? "");
  if (Number.isFinite(width) && width > 0 && width < 3.5) return true;
  return tags["lanes"] === "1" && tags["oneway"] !== "yes" && tags["highway"] !== "track";
}

interface StretchRule {
  kind: NewFeature["kind"];
  /** The label to speak, or null when this span does not qualify. */
  test: (tags: Record<string, string>) => string | null;
  /** Shorter than this is not worth a call. Metres. */
  minMeters: number;
}

const STRETCH_RULES: StretchRule[] = [
  { kind: "surface", test: surfaceWord, minMeters: 40 },
  {
    kind: "tunnel",
    test: (t) => (isYes(t["tunnel"]) && t["tunnel"] !== "culvert" ? "tunnel" : null),
    minMeters: 20,
  },
  {
    kind: "bridge",
    test: (t) => (isYes(t["bridge"]) ? (isNarrow(t) ? "narrow bridge" : "bridge") : null),
    minMeters: 30,
  },
  {
    kind: "narrow",
    // A narrow bridge is already announced as one.
    test: (t) => (isNarrow(t) && !isYes(t["bridge"]) ? "road narrows" : null),
    minMeters: 150,
  },
  {
    kind: "town",
    test: (t) =>
      t["highway"] === "residential" || t["highway"] === "living_street"
        ? "village ahead"
        : null,
    minMeters: 250,
  },
];

/** Gaps shorter than this between two qualifying spans are bridged. Metres. */
const BRIDGE_GAP = 30;
/** Nothing in the first stretch of a ride is worth announcing. Metres. */
const START_QUIET = 60;

/** Features that come from the tags of the ways the route runs along. */
export function featuresFromWays(spans: WaySpan[]): NewFeature[] {
  const features: NewFeature[] = [];
  for (const rule of STRETCH_RULES) {
    let current: { start: number; end: number; label: string } | null = null;
    const flush = (): void => {
      if (!current) return;
      if (current.end - current.start >= rule.minMeters && current.start >= START_QUIET) {
        features.push({
          kind: rule.kind,
          dist: current.start,
          endDist: current.end,
          label: current.label,
          source: "osm",
        });
      }
      current = null;
    };
    for (const span of spans) {
      const label = rule.test(span.tags);
      if (label === null) {
        if (current && span.end - current.end > BRIDGE_GAP) flush();
        continue;
      }
      if (current && span.start - current.end <= BRIDGE_GAP && current.label === label) {
        current.end = span.end;
      } else {
        flush();
        current = { start: span.start, end: span.end, label };
      }
    }
    flush();
  }
  return features;
}

/** What a hazard node is, or null when it is not one we announce. */
function nodeHazard(tags: Record<string, string>): { kind: NewFeature["kind"]; label: string } | null {
  const calming = tags["traffic_calming"];
  if (calming) {
    if (calming === "rumble_strip") return { kind: "bump", label: "rumble strips" };
    if (calming === "no") return null;
    return { kind: "bump", label: "speed breaker" };
  }
  if (tags["railway"] === "level_crossing") {
    return { kind: "rail-crossing", label: "railway crossing" };
  }
  if (isYes(tags["ford"])) return { kind: "surface", label: "water crossing" };
  return null;
}

/** A hazard must sit this close to the matched line to count as on it. Metres. */
const NODE_ON_ROUTE = 12;
/** Speed breakers closer together than this are one call. Metres. */
const NODE_CLUSTER = 60;

/** Features that come from hazard nodes lying on the matched route. */
export function featuresFromNodes(nodes: OsmNode[], geometry: GeoPoint[]): NewFeature[] {
  if (nodes.length === 0 || geometry.length < 2) return [];
  const cumulative = cumulativeDistances(geometry);
  // Degrees that certainly cover NODE_ON_ROUTE, for a cheap first rejection.
  const latPad = 0.0003;
  const frame = makeFrame(geometry[0]!);
  const lonPad = latPad * (frame.mPerDegLat / Math.max(1, frame.mPerDegLon));

  const found: NewFeature[] = [];
  for (const node of nodes) {
    const hazard = nodeHazard(node.tags);
    if (!hazard) continue;
    let bestOffset = Infinity;
    let bestDist = 0;
    for (let i = 0; i < geometry.length - 1; i++) {
      const a = geometry[i]!;
      const b = geometry[i + 1]!;
      if (
        node.lat < Math.min(a.lat, b.lat) - latPad ||
        node.lat > Math.max(a.lat, b.lat) + latPad ||
        node.lon < Math.min(a.lon, b.lon) - lonPad ||
        node.lon > Math.max(a.lon, b.lon) + lonPad
      ) {
        continue;
      }
      const projection = pointToSegment(node, a, b);
      if (projection.distance < bestOffset) {
        bestOffset = projection.distance;
        bestDist = cumulative[i]! + (cumulative[i + 1]! - cumulative[i]!) * projection.t;
      }
    }
    if (bestOffset > NODE_ON_ROUTE || bestDist < START_QUIET) continue;
    found.push({ kind: hazard.kind, dist: bestDist, label: hazard.label, source: "osm" });
  }

  found.sort((a, b) => a.dist - b.dist);
  const clustered: NewFeature[] = [];
  for (const feature of found) {
    const previous = clustered[clustered.length - 1];
    if (
      previous &&
      previous.kind === feature.kind &&
      previous.label === feature.label &&
      feature.dist - (previous.endDist ?? previous.dist) <= NODE_CLUSTER
    ) {
      previous.endDist = feature.dist;
      continue;
    }
    clustered.push({ ...feature });
  }
  return clustered;
}

/**
 * Carry elevation from the raw GPX onto the matched road geometry.
 *
 * OSM ways have no elevation, so snapping would otherwise throw away the one
 * thing the GPX had that the map did not. Both lines follow the same road in
 * the same order, so a single pointer walking forward along the raw track is
 * enough to find the nearest raw point for every matched one - and never
 * looking backwards is what keeps a hairpin stack from borrowing the height of
 * the leg below.
 */
export function transferElevation(raw: GeoPoint[], geometry: GeoPoint[]): GeoPoint[] {
  const source = raw.filter((p) => p.ele !== undefined && Number.isFinite(p.ele));
  if (source.length < 2 || source.length < raw.length * 0.5) return geometry;
  const frame = makeFrame(source[0]!);
  const local = source.map((p) => toLocal(frame, p));
  const LOOKAHEAD = 12;

  let pointer = 0;
  return geometry.map((point) => {
    const q = toLocal(frame, point);
    let best = pointer;
    let bestDistance = Infinity;
    const limit = Math.min(source.length - 1, pointer + LOOKAHEAD);
    for (let i = pointer; i <= limit; i++) {
      const d = Math.hypot(local[i]!.x - q.x, local[i]!.y - q.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    pointer = best;
    // Interpolate between the nearest raw point and whichever neighbour the
    // matched point lies towards, so sparse elevation does not step.
    const here = source[best]!;
    const next = source[Math.min(source.length - 1, best + 1)]!;
    const previous = source[Math.max(0, best - 1)]!;
    const toNext = haversine(point, next);
    const toPrevious = haversine(point, previous);
    const other = toNext <= toPrevious ? next : previous;
    const span = haversine(here, other);
    const toHere = haversine(point, here);
    const t = span > 0 ? Math.max(0, Math.min(1, toHere / span)) : 0;
    const ele = here.ele! + (other.ele! - here.ele!) * t;
    return { ...point, ele };
  });
}
