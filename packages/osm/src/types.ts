/**
 * Types for the OSM snapping layer.
 *
 * This package is the "optional improvement layer": planner GPX files are
 * rough (corners cut, points 50 m apart, drawn by hand over a basemap), while
 * OSM way geometry for the same road is usually surveyed and dense. If we can
 * confidently match the GPX onto OSM ways, corner detection gets much better
 * input. If we cannot, we fall back to the raw GPX and nothing is lost.
 */

import type { GeoPoint } from "@rally/engine";

/** One OSM way, as returned by an Overpass `out geom` query. */
export interface OsmWay {
  id: number;
  /** Node coordinates in way order. */
  geometry: GeoPoint[];
  tags: Record<string, string>;
}

/** The roads found along a route's corridor. */
export interface RoadNetwork {
  ways: OsmWay[];
  /** The bounding boxes that were queried, for cache keys and debugging. */
  boxes: BoundingBox[];
  /** When this was fetched (epoch ms), so a cache entry can be aged out. */
  fetchedAt: number;
}

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** How well the GPX matched the road network. */
export interface MatchQuality {
  /** Fraction of samples that found any road candidate at all, 0-1. */
  matchedFraction: number;
  /** Mean perpendicular distance from sample to matched road point, metres. */
  meanOffset: number;
  /** 90th percentile of the same, metres. */
  p90Offset: number;
  /** Matched geometry length / raw GPX length. 1.0 is perfect. */
  lengthRatio: number;
  /** Number of distinct OSM ways the route was matched onto. */
  wayCount: number;
  /** Did the match pass every acceptance threshold? */
  accepted: boolean;
  /** Human-readable reason when it did not. */
  reason?: string;
}

export interface MatchResult {
  /** The geometry to feed into corner detection. */
  geometry: GeoPoint[];
  /** True when `geometry` came from OSM, false when it is the raw GPX. */
  usedOsm: boolean;
  quality: MatchQuality;
  /** OSM way ids used, in travel order (deduplicated runs). */
  wayIds: number[];
  /** Road names encountered, in order, for display ("Tamhini Ghat Road"). */
  roadNames: string[];
}

/** Anything that can store strings by key: a file, AsyncStorage, a Map. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/** Injected so the package never imports node:fetch or a browser global. */
export type FetchLike = (
  url: string,
  init?: { method?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
