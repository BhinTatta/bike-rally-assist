/**
 * Talking to Overpass.
 *
 * The route is chopped into chunks and each chunk gets a padded bounding box,
 * so a 100 km ride does not ask for every road inside one enormous rectangle.
 * All the boxes go into a single union query, which is one request and one
 * chance for Overpass to rate-limit us.
 */

import { cumulativeDistances, haversine, EARTH_RADIUS_M } from "@rally/engine";
import type { GeoPoint } from "@rally/engine";
import { resolveOsmConfig, type OsmConfig } from "./config.js";
import type { BoundingBox, FetchLike, OsmWay, RoadNetwork } from "./types.js";

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Pad a bounding box by `meters` on every side. */
export function padBox(box: BoundingBox, meters: number): BoundingBox {
  const latPad = (meters / EARTH_RADIUS_M) * (180 / Math.PI);
  const midLat = (box.north + box.south) / 2;
  const lonPad = latPad / Math.max(0.05, Math.cos(toRad(midLat)));
  return {
    south: box.south - latPad,
    west: box.west - lonPad,
    north: box.north + latPad,
    east: box.east + lonPad,
  };
}

function boxOf(points: GeoPoint[]): BoundingBox {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return {
    south: Math.min(...lats),
    west: Math.min(...lons),
    north: Math.max(...lats),
    east: Math.max(...lons),
  };
}

/**
 * Split the route into chunks of at most `chunkMeters` and return one padded
 * bounding box per chunk.
 */
export function corridorBoxes(
  points: GeoPoint[],
  config: OsmConfig,
): BoundingBox[] {
  if (points.length === 0) return [];
  const cum = cumulativeDistances(points);
  const boxes: BoundingBox[] = [];
  let chunkStart = 0;
  for (let i = 1; i < points.length; i++) {
    const spanned = cum[i]! - cum[chunkStart]!;
    const isLast = i === points.length - 1;
    if (spanned >= config.corridorChunkMeters || isLast) {
      boxes.push(
        padBox(boxOf(points.slice(chunkStart, i + 1)), config.corridorMeters),
      );
      // Overlap chunks by one point so a road crossing the seam stays covered.
      chunkStart = i;
    }
  }
  return boxes.length > 0 ? boxes : [padBox(boxOf(points), config.corridorMeters)];
}

const fixed = (n: number): string => n.toFixed(6);

/** Build the Overpass QL for a set of boxes. */
export function buildQuery(boxes: BoundingBox[], config: OsmConfig): string {
  const filter = `["highway"~"^(${config.highwayTypes.join("|")})$"]`;
  const clauses = boxes
    .map(
      (b) =>
        `  way${filter}(${fixed(b.south)},${fixed(b.west)},${fixed(b.north)},${fixed(b.east)});`,
    )
    .join("\n");
  // `out geom` gives each way's node coordinates inline, so no second request
  // is needed to resolve node ids into positions.
  return `[out:json][timeout:${config.queryTimeoutSeconds}];\n(\n${clauses}\n);\nout geom;`;
}

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

/** Parse an Overpass JSON response into a road network. */
export function parseOverpass(json: string, boxes: BoundingBox[]): RoadNetwork {
  const parsed = JSON.parse(json) as { elements?: OverpassElement[] };
  const ways: OsmWay[] = [];
  const seen = new Set<number>();
  for (const element of parsed.elements ?? []) {
    if (element.type !== "way" || !element.geometry || seen.has(element.id)) continue;
    const geometry = element.geometry
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map((p) => ({ lat: p.lat, lon: p.lon }));
    // A way needs two distinct points to be a piece of road.
    if (geometry.length < 2) continue;
    if (haversine(geometry[0]!, geometry[geometry.length - 1]!) === 0 && geometry.length === 2) {
      continue;
    }
    seen.add(element.id);
    ways.push({ id: element.id, geometry, tags: element.tags ?? {} });
  }
  return { ways, boxes, fetchedAt: Date.now() };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Turn a transport-level failure into something a rider can act on.
 *
 * "fetch failed: java.net.UnknownHostException: Unable to resolve host" is a
 * true and completely useless thing to show someone on a hillside.
 */
export function describeFetchError(error: Error): string {
  const message = error.message;
  if (
    /UnknownHost|ENOTFOUND|EAI_AGAIN|Unable to resolve host|Network request failed|ECONNREFUSED|ENETUNREACH|fetch failed/i.test(
      message,
    )
  ) {
    return "no internet connection";
  }
  if (/abort|ETIMEDOUT|timeout/i.test(message)) {
    return "the road data server did not answer in time";
  }
  if (/HTTP 429/.test(message)) return "the road data server is rate-limiting us";
  if (/HTTP 50\d/.test(message)) return "the road data server is overloaded";
  return message;
}

export interface FetchOptions {
  fetch?: FetchLike;
  config?: Partial<OsmConfig>;
  /** Called with progress messages, e.g. for a "Fetching roads..." UI. */
  onProgress?: (message: string) => void;
}

/**
 * Fetch the road network for a route corridor.
 *
 * Tries each endpoint in turn, with a backoff between retries. Overpass is a
 * free, shared, frequently overloaded service: 429 and 504 are normal, and the
 * right response is to wait rather than hammer it.
 */
export async function fetchRoadNetwork(
  points: GeoPoint[],
  options: FetchOptions = {},
): Promise<RoadNetwork> {
  const config = resolveOsmConfig(options.config);
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!doFetch) {
    throw new Error("no fetch implementation available; pass options.fetch");
  }
  const boxes = corridorBoxes(points, config);

  // Long routes go in several smaller requests and the results are merged.
  const batches: BoundingBox[][] = [];
  for (let i = 0; i < boxes.length; i += config.maxBoxesPerRequest) {
    batches.push(boxes.slice(i, i + config.maxBoxesPerRequest));
  }

  const ways = new Map<number, OsmWay>();
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]!;
    const label = batches.length > 1 ? ` (part ${b + 1} of ${batches.length})` : "";
    const network = await fetchOneBatch(doFetch, batch, config, label, options.onProgress);
    for (const way of network.ways) ways.set(way.id, way);
  }
  options.onProgress?.(`Got ${ways.size} ways`);
  return { ways: [...ways.values()], boxes, fetchedAt: Date.now() };
}

/** One Overpass request, with retries and endpoint failover. */
async function fetchOneBatch(
  doFetch: FetchLike,
  boxes: BoundingBox[],
  config: OsmConfig,
  label: string,
  onProgress?: (message: string) => void,
): Promise<RoadNetwork> {
  const query = buildQuery(boxes, config);

  let lastError: Error | undefined;
  for (const endpoint of config.endpoints) {
    for (let attempt = 0; attempt <= config.retries; attempt++) {
      try {
        onProgress?.(
          `Fetching roads from ${hostOf(endpoint)}${label}`,
        );
        const controller =
          typeof AbortController !== "undefined" ? new AbortController() : undefined;
        const timer = controller
          ? setTimeout(() => controller.abort(), config.requestTimeoutMs)
          : undefined;
        let response;
        try {
          response = await doFetch(endpoint, {
            method: "POST",
            body: `data=${encodeURIComponent(query)}`,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            ...(controller ? { signal: controller.signal } : {}),
          });
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
        if (!response.ok) {
          throw new Error(`Overpass returned HTTP ${response.status}`);
        }
        return parseOverpass(await response.text(), boxes);
      } catch (error) {
        lastError = error as Error;
        if (attempt < config.retries) {
          await sleep(config.retryBackoffMs * Math.pow(2, attempt));
        }
      }
    }
  }
  throw new Error(
    lastError ? describeFetchError(lastError) : "the road data request failed",
  );
}

/** Host name for progress messages, without assuming URL is available. */
function hostOf(endpoint: string): string {
  const match = /^https?:\/\/([^/]+)/i.exec(endpoint);
  return match?.[1] ?? endpoint;
}

/** Stable cache key for a corridor query: same route and settings, same key. */
export function cacheKey(boxes: BoundingBox[], config: OsmConfig): string {
  const payload = JSON.stringify([
    boxes.map((b) => [fixed(b.south), fixed(b.west), fixed(b.north), fixed(b.east)]),
    config.highwayTypes,
  ]);
  // FNV-1a: tiny, dependency-free, and collisions do not matter here because a
  // wrong hit would only mean refetching.
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `osm-${hash.toString(16).padStart(8, "0")}-${boxes.length}`;
}
