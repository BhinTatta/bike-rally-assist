import { describe, expect, it, vi } from "vitest";
import {
  buildQuery,
  cacheKey,
  corridorBoxes,
  fetchRoadNetwork,
  padBox,
  parseOverpass,
} from "../src/overpass.js";
import { DEFAULT_OSM_CONFIG, resolveOsmConfig } from "../src/config.js";
import { MemoryStore } from "../src/cache.js";
import { snapRouteToOsm } from "../src/index.js";
import type { FetchLike } from "../src/types.js";
import { haversine, destination } from "@rally/engine";
import { asWays, roughPlannerGpx, trueGhatRoad } from "./fixtures.js";

const config = resolveOsmConfig();

/** Format a road as the Overpass JSON an `out geom` query returns. */
function overpassJson(ways: ReturnType<typeof asWays>): string {
  return JSON.stringify({
    version: 0.6,
    generator: "Overpass API test",
    elements: ways.map((w) => ({
      type: "way",
      id: w.id,
      bounds: { minlat: 0, minlon: 0, maxlat: 1, maxlon: 1 },
      nodes: w.geometry.map((_, i) => 10_000 + i),
      geometry: w.geometry.map((p) => ({ lat: p.lat, lon: p.lon })),
      tags: w.tags,
    })),
  });
}

describe("corridor boxes", () => {
  it("pads a box by the requested distance", () => {
    const box = padBox({ south: 18.45, west: 73.41, north: 18.46, east: 73.42 }, 150);
    const grown = haversine({ lat: 18.45, lon: 73.41 }, { lat: box.south, lon: 73.41 });
    expect(grown).toBeCloseTo(150, -1);
  });

  it("uses one box for a short route", () => {
    expect(corridorBoxes(trueGhatRoad(), config)).toHaveLength(1);
  });

  it("chunks a long route so one ride does not ask for a whole district", () => {
    // 60 km straight: at 5 km chunks that is a dozen boxes.
    const long = Array.from({ length: 200 }, (_, i) =>
      destination({ lat: 18.45, lon: 73.41 }, i * 300, 45),
    );
    const boxes = corridorBoxes(long, config);
    expect(boxes.length).toBeGreaterThanOrEqual(11);
    for (const box of boxes) {
      const diagonal = haversine(
        { lat: box.south, lon: box.west },
        { lat: box.north, lon: box.east },
      );
      expect(diagonal).toBeLessThan(9000);
    }
  });
});

describe("query building", () => {
  it("asks only for rideable highways, with geometry", () => {
    const query = buildQuery(corridorBoxes(trueGhatRoad(), config), config);
    expect(query).toContain("[out:json][timeout:90]");
    expect(query).toContain('way["highway"~"^(motorway|trunk|primary');
    expect(query.trimEnd().endsWith("out geom;")).toBe(true);
  });

  it("emits one clause per box", () => {
    const boxes = corridorBoxes(trueGhatRoad(), config);
    const query = buildQuery([...boxes, ...boxes], config);
    expect(query.match(/way\["highway"/g)).toHaveLength(2);
  });

  it("keys the cache by boxes and highway filter", () => {
    const boxes = corridorBoxes(trueGhatRoad(), config);
    expect(cacheKey(boxes, config)).toBe(cacheKey(boxes, config));
    expect(cacheKey(boxes, config)).not.toBe(
      cacheKey(boxes, { ...config, highwayTypes: ["primary"] }),
    );
  });
});

describe("response parsing", () => {
  const ways = asWays(trueGhatRoad(), 3);

  it("reads ways and tags out of an Overpass response", () => {
    const network = parseOverpass(overpassJson(ways), []);
    expect(network.ways).toHaveLength(3);
    expect(network.ways[0]!.tags["highway"]).toBe("secondary");
    expect(network.ways[0]!.geometry.length).toBeGreaterThan(10);
  });

  it("skips nodes, relations and degenerate ways", () => {
    const json = JSON.stringify({
      elements: [
        { type: "node", id: 1, lat: 18, lon: 73 },
        { type: "relation", id: 2 },
        { type: "way", id: 3, geometry: [{ lat: 18, lon: 73 }], tags: {} },
        { type: "way", id: 4 },
      ],
    });
    expect(parseOverpass(json, []).ways).toHaveLength(0);
  });

  it("deduplicates ways that appear in two overlapping boxes", () => {
    const doubled = JSON.parse(overpassJson(ways)) as { elements: unknown[] };
    doubled.elements = [...doubled.elements, ...doubled.elements];
    expect(parseOverpass(JSON.stringify(doubled), []).ways).toHaveLength(3);
  });
});

describe("fetching", () => {
  const road = trueGhatRoad();
  const body = overpassJson(asWays(road, 3));

  it("posts the query and parses the result", async () => {
    const calls: { url: string; body?: string }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, ...(init?.body !== undefined ? { body: init.body } : {}) });
      return { ok: true, status: 200, text: async () => body };
    };
    const network = await fetchRoadNetwork(road, { fetch: fetchImpl });
    expect(network.ways).toHaveLength(3);
    expect(calls[0]!.url).toBe(DEFAULT_OSM_CONFIG.endpoints[0]);
    expect(decodeURIComponent(calls[0]!.body!)).toContain("out geom;");
  });

  it("retries, then moves to the next endpoint", async () => {
    let attempts = 0;
    const fetchImpl: FetchLike = async (url) => {
      attempts++;
      if (url === DEFAULT_OSM_CONFIG.endpoints[0]) {
        return { ok: false, status: 429, text: async () => "rate limited" };
      }
      return { ok: true, status: 200, text: async () => body };
    };
    const network = await fetchRoadNetwork(road, {
      fetch: fetchImpl,
      config: { retries: 1, retryBackoffMs: 1 },
    });
    expect(attempts).toBe(3); // two tries on the first endpoint, one on the second
    expect(network.ways).toHaveLength(3);
  });

  it("gives up with a clear message when every endpoint fails", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("network unreachable");
    };
    await expect(
      fetchRoadNetwork(road, { fetch: fetchImpl, config: { retries: 0 } }),
    ).rejects.toThrow(/network unreachable/);
  });
});

describe("snapRouteToOsm", () => {
  const road = trueGhatRoad();
  const gpx = roughPlannerGpx(road);
  const body = overpassJson(asWays(road, 4));

  it("fetches once and serves the second import from cache", async () => {
    const store = new MemoryStore();
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => body }));

    const first = await snapRouteToOsm(gpx, { store, fetch: fetchImpl as unknown as FetchLike });
    const second = await snapRouteToOsm(gpx, { store, fetch: fetchImpl as unknown as FetchLike });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first.usedOsm).toBe(true);
    expect(first.fromCache).toBe(false);
    expect(second.usedOsm).toBe(true);
    expect(second.fromCache).toBe(true);
    expect(second.geometry).toEqual(first.geometry);
  });

  it("works offline from the cache, and says so when there is nothing cached", async () => {
    const store = new MemoryStore();
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, text: async () => body });
    await snapRouteToOsm(gpx, { store, fetch: fetchImpl });

    const offline = await snapRouteToOsm(gpx, { store, cacheOnly: true });
    expect(offline.usedOsm).toBe(true);
    expect(offline.fromCache).toBe(true);

    const cold = await snapRouteToOsm(gpx, { store: new MemoryStore(), cacheOnly: true });
    expect(cold.usedOsm).toBe(false);
    expect(cold.quality.reason).toMatch(/offline/);
  });

  it("never throws when Overpass is down - it just uses the raw GPX", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("ETIMEDOUT");
    };
    const result = await snapRouteToOsm(gpx, {
      fetch: fetchImpl,
      config: { retries: 0 },
    });
    expect(result.usedOsm).toBe(false);
    expect(result.geometry).toHaveLength(gpx.length);
    expect(result.error).toMatch(/ETIMEDOUT/);
  });

  it("ignores a corrupt cache entry instead of failing the import", async () => {
    const store = new MemoryStore();
    await store.set(cacheKey(corridorBoxes(gpx, config), config), "{not json");
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, text: async () => body });
    const result = await snapRouteToOsm(gpx, { store, fetch: fetchImpl });
    expect(result.usedOsm).toBe(true);
  });

  it("reports progress for a UI", async () => {
    const messages: string[] = [];
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, text: async () => body });
    await snapRouteToOsm(gpx, { fetch: fetchImpl, onProgress: (m) => messages.push(m) });
    expect(messages.join("\n")).toMatch(/Fetching roads/);
    expect(messages.join("\n")).toMatch(/Matched to/);
  });
});
