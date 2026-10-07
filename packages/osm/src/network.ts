/**
 * An indexed view of the road network: fast "which roads are near this point"
 * lookups, plus which ways are joined to which.
 *
 * A grid hash is enough here. A ride corridor holds a few thousand segments at
 * most, and a grid avoids pulling in an R-tree dependency for a package that
 * has to run on a phone.
 */

import {
  cumulativeDistances,
  haversine,
  makeFrame,
  toLocal,
  bearing,
} from "@rally/engine";
import type { GeoPoint } from "@rally/engine";
import type { OsmWay, RoadNetwork } from "./types.js";

/** Grid cell size in degrees of latitude (~110 m). */
const CELL_DEGREES = 0.001;

/**
 * Two projections onto the same way closer together than this are treated as
 * one candidate; further apart, they are genuinely different places on the road.
 */
const ALONG_SEPARATION = 40;

export interface IndexedWay {
  way: OsmWay;
  /** Cumulative distance to each node, metres. */
  cumulative: number[];
  /** Total way length, metres. */
  length: number;
}

/** A point on the network: "x metres along way y". */
export interface RoadPosition {
  wayIndex: number;
  /** Distance from the start of the way, metres. */
  along: number;
  point: GeoPoint;
  /** Perpendicular distance from the query point, metres. */
  offset: number;
  /** Bearing of the way at this point, in way order. */
  bearing: number;
}

export class IndexedNetwork {
  readonly ways: IndexedWay[];
  /** cell key -> segment references that touch that cell. */
  private readonly grid = new Map<string, { wayIndex: number; segIndex: number }[]>();
  /** rounded node coordinate -> way indices that touch it. */
  private readonly nodeToWays = new Map<string, Set<number>>();

  constructor(network: RoadNetwork) {
    this.ways = network.ways.map((way) => {
      const cumulative = cumulativeDistances(way.geometry);
      return { way, cumulative, length: cumulative[cumulative.length - 1] ?? 0 };
    });

    this.ways.forEach((indexed, wayIndex) => {
      const geometry = indexed.way.geometry;
      for (let segIndex = 0; segIndex < geometry.length - 1; segIndex++) {
        for (const key of cellsForSegment(geometry[segIndex]!, geometry[segIndex + 1]!)) {
          const bucket = this.grid.get(key);
          if (bucket) bucket.push({ wayIndex, segIndex });
          else this.grid.set(key, [{ wayIndex, segIndex }]);
        }
      }
      // Junctions: OSM ways share nodes, so matching coordinates means joined.
      for (const node of geometry) {
        const key = nodeKey(node);
        const set = this.nodeToWays.get(key);
        if (set) set.add(wayIndex);
        else this.nodeToWays.set(key, new Set([wayIndex]));
      }
    });
  }

  get isEmpty(): boolean {
    return this.ways.length === 0;
  }

  /** Do these two ways touch at a shared node? */
  connected(a: number, b: number): boolean {
    if (a === b) return true;
    for (const node of this.ways[a]!.way.geometry) {
      const set = this.nodeToWays.get(nodeKey(node));
      if (set?.has(b)) return true;
    }
    return false;
  }

  /**
   * Every road position within `radius` of `query`, nearest first.
   *
   * A way may contribute more than one candidate when it passes the query point
   * twice far apart along its own length - which is exactly a hairpin, where
   * both legs are usually the same OSM way only 20 m apart. Keeping just the
   * nearest projection there would hide the correct leg from the matcher.
   * Projections closer together than `ALONG_SEPARATION` are the same place.
   */
  candidates(query: GeoPoint, radius: number, limit: number): RoadPosition[] {
    const found: RoadPosition[] = [];
    const seen = new Set<string>();
    for (const key of cellsAround(query, radius)) {
      for (const ref of this.grid.get(key) ?? []) {
        const id = `${ref.wayIndex}:${ref.segIndex}`;
        if (seen.has(id)) continue; // a segment can span several cells
        seen.add(id);
        const position = this.project(query, ref.wayIndex, ref.segIndex);
        if (position.offset <= radius) found.push(position);
      }
    }
    found.sort((a, b) => a.offset - b.offset);

    const kept: RoadPosition[] = [];
    for (const position of found) {
      const duplicate = kept.some(
        (k) =>
          k.wayIndex === position.wayIndex &&
          Math.abs(k.along - position.along) < ALONG_SEPARATION,
      );
      if (!duplicate) kept.push(position);
      if (kept.length >= limit) break;
    }
    return kept;
  }

  /** Project a point onto one segment of one way. */
  private project(query: GeoPoint, wayIndex: number, segIndex: number): RoadPosition {
    const indexed = this.ways[wayIndex]!;
    const a = indexed.way.geometry[segIndex]!;
    const b = indexed.way.geometry[segIndex + 1]!;
    const frame = makeFrame(a);
    const q = toLocal(frame, query);
    const v = toLocal(frame, b);
    const len2 = v.x * v.x + v.y * v.y;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (q.x * v.x + q.y * v.y) / len2));
    const point: GeoPoint = {
      lat: a.lat + (b.lat - a.lat) * t,
      lon: a.lon + (b.lon - a.lon) * t,
    };
    const segmentLength = Math.sqrt(len2);
    return {
      wayIndex,
      along: indexed.cumulative[segIndex]! + segmentLength * t,
      point,
      offset: haversine(query, point),
      bearing: segmentLength > 0 ? bearing(a, b) : 0,
    };
  }

  /**
   * The slice of a way's geometry between two distances along it, in travel
   * order (reversed when `to` is before `from`).
   */
  slice(wayIndex: number, from: number, to: number): GeoPoint[] {
    const indexed = this.ways[wayIndex]!;
    const reversed = to < from;
    const start = Math.max(0, Math.min(from, to));
    const end = Math.min(indexed.length, Math.max(from, to));
    const out: GeoPoint[] = [pointAt(indexed, start)];
    for (let i = 0; i < indexed.way.geometry.length; i++) {
      const d = indexed.cumulative[i]!;
      if (d > start && d < end) out.push({ ...indexed.way.geometry[i]! });
    }
    if (end > start) out.push(pointAt(indexed, end));
    return reversed ? out.reverse() : out;
  }

  nameOf(wayIndex: number): string | undefined {
    const tags = this.ways[wayIndex]!.way.tags;
    return tags["name"] ?? tags["ref"];
  }
}

/** Interpolated position `distance` metres along a way. */
export function pointAt(indexed: IndexedWay, distance: number): GeoPoint {
  const { geometry } = indexed.way;
  if (distance <= 0) return { ...geometry[0]! };
  if (distance >= indexed.length) return { ...geometry[geometry.length - 1]! };
  let i = 0;
  while (i < geometry.length - 2 && indexed.cumulative[i + 1]! < distance) i++;
  const a = geometry[i]!;
  const b = geometry[i + 1]!;
  const span = indexed.cumulative[i + 1]! - indexed.cumulative[i]!;
  const t = span > 0 ? (distance - indexed.cumulative[i]!) / span : 0;
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

const cellKey = (lat: number, lon: number): string =>
  `${Math.floor(lat / CELL_DEGREES)}:${Math.floor(lon / CELL_DEGREES)}`;

/** Nodes within ~0.1 m of each other are the same junction. */
const nodeKey = (p: GeoPoint): string => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

function cellsForSegment(a: GeoPoint, b: GeoPoint): string[] {
  const keys: string[] = [];
  const latMin = Math.floor(Math.min(a.lat, b.lat) / CELL_DEGREES);
  const latMax = Math.floor(Math.max(a.lat, b.lat) / CELL_DEGREES);
  const lonMin = Math.floor(Math.min(a.lon, b.lon) / CELL_DEGREES);
  const lonMax = Math.floor(Math.max(a.lon, b.lon) / CELL_DEGREES);
  for (let la = latMin; la <= latMax; la++) {
    for (let lo = lonMin; lo <= lonMax; lo++) keys.push(`${la}:${lo}`);
  }
  return keys;
}

function cellsAround(p: GeoPoint, radius: number): string[] {
  // One cell is ~110 m; widen the ring until it certainly covers the radius.
  const latCells = Math.max(1, Math.ceil(radius / 110));
  const lonCells = Math.max(
    1,
    Math.ceil(radius / (110 * Math.max(0.05, Math.cos((p.lat * Math.PI) / 180)))),
  );
  const keys: string[] = [];
  const baseLat = Math.floor(p.lat / CELL_DEGREES);
  const baseLon = Math.floor(p.lon / CELL_DEGREES);
  for (let dLat = -latCells; dLat <= latCells; dLat++) {
    for (let dLon = -lonCells; dLon <= lonCells; dLon++) {
      keys.push(`${baseLat + dLat}:${baseLon + dLon}`);
    }
  }
  return keys;
}

export { cellKey };
