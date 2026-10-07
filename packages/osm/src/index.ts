/**
 * @rally/osm - optional OSM snapping layer.
 *
 * The engine stays pure and knows nothing about this package. The app calls
 * `snapRouteToOsm` once, at import time, and feeds the resulting geometry into
 * `analyseRoute`. If anything at all goes wrong - no signal, Overpass down,
 * the GPX is nowhere near a mapped road - it returns the raw GPX points and
 * the import carries on.
 */

export * from "./types.js";
export * from "./config.js";
export * from "./overpass.js";
export * from "./network.js";
export * from "./match.js";
export * from "./cache.js";

import { analyseRoute } from "@rally/engine";
import type { AnalysedRoute, DeepPartial, EngineConfig, GeoPoint } from "@rally/engine";
import { resolveOsmConfig, type OsmConfig } from "./config.js";
import { cacheKey, corridorBoxes, fetchRoadNetwork } from "./overpass.js";
import { matchToRoads } from "./match.js";
import { MemoryStore, readCachedNetwork, writeCachedNetwork } from "./cache.js";
import type { FetchLike, KeyValueStore, MatchResult, RoadNetwork } from "./types.js";

export interface SnapOptions {
  /** Where to cache the fetched road network. Defaults to a memory store. */
  store?: KeyValueStore;
  /** Injected so this package never reaches for a global. */
  fetch?: FetchLike;
  config?: Partial<OsmConfig>;
  /** Skip the network entirely and use whatever is cached (offline mode). */
  cacheOnly?: boolean;
  onProgress?: (message: string) => void;
  /** Lets the rider give up on road data without abandoning the import. */
  signal?: AbortSignal;
}

export interface SnapResult extends MatchResult {
  /** Did the road network come from the cache rather than the network? */
  fromCache: boolean;
  /** Set when the fetch failed; the result then falls back to the raw GPX. */
  error?: string;
}

/**
 * Fetch (or load from cache) the roads around a route and match the route onto
 * them. Never throws: a failure returns the raw points with `usedOsm: false`.
 */
export async function snapRouteToOsm(
  rawPoints: GeoPoint[],
  options: SnapOptions = {},
): Promise<SnapResult> {
  const config = resolveOsmConfig(options.config);
  const store = options.store ?? new MemoryStore();
  const key = cacheKey(corridorBoxes(rawPoints, config), config);

  let network: RoadNetwork | null = await readCachedNetwork(
    store,
    key,
    config.cacheMaxAgeMs,
  );
  let fromCache = network !== null;

  if (!network) {
    if (options.cacheOnly) {
      return { ...rawFallback(rawPoints, "offline and nothing cached"), fromCache: false };
    }
    try {
      network = await fetchRoadNetwork(rawPoints, {
        config,
        ...(options.fetch ? { fetch: options.fetch } : {}),
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      await writeCachedNetwork(store, key, network);
    } catch (error) {
      const message =
        (error as Error).name === "CancelledError"
          ? "skipped at your request"
          : (error as Error).message;
      options.onProgress?.(`OSM snapping skipped: ${message}`);
      return { ...rawFallback(rawPoints, message), fromCache: false, error: message };
    }
  } else {
    options.onProgress?.(`Using cached roads (${network.ways.length} ways)`);
  }

  const matchConfig = options.config ? { config: options.config } : {};
  const match = matchToRoads(rawPoints, network, matchConfig);
  options.onProgress?.(
    match.usedOsm
      ? `Matched to ${match.quality.wayCount} OSM way(s), mean offset ${match.quality.meanOffset.toFixed(1)} m`
      : `Keeping raw GPX: ${match.quality.reason}`,
  );
  return { ...match, fromCache };
}

/**
 * The whole import in one call: snap to OSM when possible, then analyse.
 * `route.points` is OSM geometry on a good match and the raw GPX otherwise.
 */
export async function importRoute(
  rawPoints: GeoPoint[],
  options: SnapOptions & { engineConfig?: DeepPartial<EngineConfig>; name?: string } = {},
): Promise<{ route: AnalysedRoute; snap: SnapResult }> {
  const snap = await snapRouteToOsm(rawPoints, options);
  const route = analyseRoute(snap.geometry, options.engineConfig, options.name);
  return { route, snap };
}

function rawFallback(points: GeoPoint[], reason: string): MatchResult {
  return {
    geometry: points,
    usedOsm: false,
    wayIds: [],
    roadNames: [],
    quality: {
      matchedFraction: 0,
      meanOffset: Infinity,
      p90Offset: Infinity,
      lengthRatio: 0,
      wayCount: 0,
      accepted: false,
      reason,
    },
  };
}
