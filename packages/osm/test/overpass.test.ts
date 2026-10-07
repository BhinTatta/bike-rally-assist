import { describe, expect, it, vi } from "vitest";
import {
  buildQuery,
  cacheKey,
  corridorBoxes,
  describeFetchError,
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
    expect(query).toContain("[out:json][timeout:60]");
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

  it("gives up with a message a rider can act on", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error(
        "fetch failed: java.net.UnknownHostException: Unable to resolve host \"overpass.kumi.systems\"",
      );
    };
    await expect(
      fetchRoadNetwork(road, { fetch: fetchImpl, config: { retries: 0 } }),
    ).rejects.toThrow(/no internet connection/);
  });

  it("translates the failures that actually happen on a hillside", () => {
    const cases: [string, RegExp][] = [
      ["fetch failed: java.net.UnknownHostException", /no internet/],
      ["Network request failed", /no internet/],
      ["The operation was aborted", /did not answer in time/],
      ["Overpass returned HTTP 429", /rate-limiting/],
      ["Overpass returned HTTP 504", /overloaded/],
    ];
    for (const [message, expected] of cases) {
      expect(describeFetchError(new Error(message))).toMatch(expected);
    }
  });

  it("splits a long route over several requests and merges the results", async () => {
    // 60 km: 12 corridor boxes, which at 6 per request is two Overpass calls.
    const long = Array.from({ length: 200 }, (_, i) =>
      destination({ lat: 18.45, lon: 73.41 }, i * 300, 45),
    );
    const queries: string[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const query = decodeURIComponent((init?.body ?? "").replace(/^data=/, ""));
      queries.push(query);
      // Each request answers with a way whose id depends on the request, so a
      // merge failure would show up as a missing way.
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            elements: [
              {
                type: "way",
                id: 500 + queries.length,
                tags: { highway: "primary" },
                geometry: [
                  { lat: 18.45, lon: 73.41 },
                  { lat: 18.46, lon: 73.42 },
                ],
              },
            ],
          }),
      };
    };

    const network = await fetchRoadNetwork(long, { fetch: fetchImpl });
    expect(queries.length).toBeGreaterThan(1);
    for (const query of queries) {
      expect(query.match(/way\["highway"/g)!.length).toBeLessThanOrEqual(6);
    }
    // One way per request, all merged into the result.
    expect(network.ways.map((w) => w.id)).toEqual(
      queries.map((_, i) => 501 + i),
    );
    expect(network.boxes.length).toBeGreaterThan(6);
  });

  it("stops after the first batch when the phone has no connection", async () => {
    // The failure that actually happened: five batches, two endpoints and a
    // retry each is twenty pointless requests when DNS does not resolve.
    const long = Array.from({ length: 200 }, (_, i) =>
      destination({ lat: 18.45, lon: 73.41 }, i * 300, 45),
    );
    let attempts = 0;
    const fetchImpl: FetchLike = async () => {
      attempts++;
      throw new Error("fetch failed: java.net.UnknownHostException: Unable to resolve host");
    };
    await expect(fetchRoadNetwork(long, { fetch: fetchImpl })).rejects.toThrow(
      /no internet connection/,
    );
    // One try per endpoint - the second is worth a single lookup, because an
    // ISP blocking one Overpass domain is not the same as having no data -
    // and then it stops. Not five batches of two endpoints with a retry each.
    expect(attempts).toBe(2);
  });

  it("keeps the batches that worked when one fails", async () => {
    const long = Array.from({ length: 200 }, (_, i) =>
      destination({ lat: 18.45, lon: 73.41 }, i * 300, 45),
    );
    let call = 0;
    const fetchImpl: FetchLike = async () => {
      call++;
      if (call === 1) return { ok: false, status: 504, text: async () => "gateway timeout" };
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            elements: [
              {
                type: "way",
                id: 900 + call,
                tags: { highway: "primary" },
                geometry: [
                  { lat: 18.45, lon: 73.41 },
                  { lat: 18.46, lon: 73.42 },
                ],
              },
            ],
          }),
      };
    };
    const network = await fetchRoadNetwork(long, {
      fetch: fetchImpl,
      config: { retries: 0, retryBackoffMs: 1 },
    });
    expect(network.ways.length).toBeGreaterThan(0);
  });

  it("gives up once the overall budget is spent", async () => {
    const long = Array.from({ length: 400 }, (_, i) =>
      destination({ lat: 18.45, lon: 73.41 }, i * 300, 45),
    );
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 60));
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            elements: [
              {
                type: "way",
                id: 1000 + calls,
                tags: { highway: "primary" },
                geometry: [
                  { lat: 18.45, lon: 73.41 },
                  { lat: 18.46, lon: 73.42 },
                ],
              },
            ],
          }),
      };
    };
    const network = await fetchRoadNetwork(long, {
      fetch: fetchImpl,
      config: { totalBudgetMs: 120 },
    });
    // It stopped early and kept what it had rather than running to the end.
    expect(calls).toBeLessThan(10);
    expect(network.ways.length).toBeGreaterThan(0);
  });

  it("can be cancelled by the rider", async () => {
    const long = Array.from({ length: 200 }, (_, i) =>
      destination({ lat: 18.45, lon: 73.41 }, i * 300, 45),
    );
    const controller = new AbortController();
    const fetchImpl: FetchLike = async () => {
      controller.abort(); // the rider taps "Skip road data" mid-request
      return { ok: true, status: 200, text: async () => JSON.stringify({ elements: [] }) };
    };
    await expect(
      fetchRoadNetwork(long, { fetch: fetchImpl, signal: controller.signal }),
    ).rejects.toThrow(/cancelled/);
  });

  it("falls back to the raw GPX when the rider cancels", async () => {
    const controller = new AbortController();
    const fetchImpl: FetchLike = async () => {
      controller.abort();
      return { ok: true, status: 200, text: async () => JSON.stringify({ elements: [] }) };
    };
    const result = await snapRouteToOsm(roughPlannerGpx(trueGhatRoad()), {
      fetch: fetchImpl,
      signal: controller.signal,
    });
    expect(result.usedOsm).toBe(false);
    expect(result.quality.reason).toMatch(/skipped at your request/);
  });

  it("deduplicates ways that two batches both return", async () => {
    const long = Array.from({ length: 200 }, (_, i) =>
      destination({ lat: 18.45, lon: 73.41 }, i * 300, 45),
    );
    const same = JSON.stringify({
      elements: [
        {
          type: "way",
          id: 77,
          tags: { highway: "primary" },
          geometry: [
            { lat: 18.45, lon: 73.41 },
            { lat: 18.46, lon: 73.42 },
          ],
        },
      ],
    });
    const network = await fetchRoadNetwork(long, {
      fetch: async () => ({ ok: true, status: 200, text: async () => same }),
    });
    expect(network.ways).toHaveLength(1);
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
    expect(result.error).toMatch(/did not answer in time/);
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
