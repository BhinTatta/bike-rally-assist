import { describe, expect, it } from "vitest";
import { analyseRoute, cumulativeDistances, destination } from "@rally/engine";
import type { GeoPoint } from "@rally/engine";
import { applyMapFeatures } from "../src/index.js";
import { matchToRoads } from "../src/match.js";
import { buildQuery, parseOverpass } from "../src/overpass.js";
import { resolveOsmConfig } from "../src/config.js";
import { featuresFromNodes, featuresFromWays, transferElevation } from "../src/tags.js";
import type { OsmNode, OsmWay } from "../src/types.js";
import { asNetwork, ORIGIN, straight } from "./fixtures.js";

const road = (length: number): GeoPoint[] => [ORIGIN, ...straight(ORIGIN, 20, length, 10)];

describe("hazards from way tags", () => {
  const span = (start: number, end: number, tags: Record<string, string>, wayId = start) => ({
    wayId,
    tags,
    start,
    end,
  });

  it("announces where tarmac turns to gravel, and for how long", () => {
    const features = featuresFromWays([
      span(0, 800, { highway: "secondary", surface: "asphalt" }),
      span(800, 1000, { highway: "secondary", surface: "gravel" }),
      span(1000, 1100, { highway: "secondary", surface: "gravel" }),
      span(1100, 2000, { highway: "secondary", surface: "asphalt" }),
    ]);
    expect(features).toEqual([
      { kind: "surface", dist: 800, endDist: 1100, label: "gravel", source: "osm" },
    ]);
  });

  it("treats an untagged track as unpaved but trusts a paved one", () => {
    const words = (tags: Record<string, string>): string[] =>
      featuresFromWays([span(0, 500, { highway: "secondary" }), span(500, 900, tags)]).map(
        (f) => f.label!,
      );
    expect(words({ highway: "track" })).toEqual(["unpaved road"]);
    expect(words({ highway: "track", surface: "asphalt" })).toEqual([]);
    expect(words({ highway: "tertiary", smoothness: "very_bad" })).toEqual(["broken road"]);
  });

  it("finds bridges and tunnels, and ignores culverts and short spans", () => {
    const features = featuresFromWays([
      span(0, 400, { highway: "primary" }),
      span(400, 480, { highway: "primary", bridge: "yes", lanes: "1" }),
      span(480, 900, { highway: "primary" }),
      span(900, 910, { highway: "primary", bridge: "yes" }), // a 10 m culvert bridge
      span(910, 1500, { highway: "primary" }),
      span(1500, 1900, { highway: "primary", tunnel: "yes" }),
      span(1900, 2000, { highway: "primary", tunnel: "culvert" }),
    ]);
    expect(features.map((f) => [f.kind, f.label, f.dist])).toEqual([
      ["tunnel", "tunnel", 1500],
      ["bridge", "narrow bridge", 400],
    ]);
  });

  it("says nothing about the first few metres of a ride", () => {
    expect(featuresFromWays([span(0, 500, { highway: "track" })])).toEqual([]);
  });
});

describe("hazards from nodes", () => {
  const line = road(2000);
  const at = (dist: number, sideways = 0): GeoPoint => {
    const along = destination(ORIGIN, dist, 20);
    return sideways === 0 ? along : destination(along, sideways, 110);
  };
  const node = (id: number, point: GeoPoint, tags: Record<string, string>): OsmNode => ({
    id,
    lat: point.lat,
    lon: point.lon,
    tags,
  });

  it("places a speed breaker at its distance along the route", () => {
    const features = featuresFromNodes([node(1, at(750, 3), { traffic_calming: "bump" })], line);
    expect(features).toHaveLength(1);
    expect(features[0]!.kind).toBe("bump");
    expect(features[0]!.label).toBe("speed breaker");
    expect(features[0]!.dist).toBeCloseTo(750, -1);
  });

  it("ignores hazards on a side road, and tags it does not understand", () => {
    const features = featuresFromNodes(
      [
        node(1, at(750, 40), { traffic_calming: "bump" }),
        node(2, at(900), { highway: "bus_stop" }),
        node(3, at(950), { traffic_calming: "no" }),
      ],
      line,
    );
    expect(features).toEqual([]);
  });

  it("makes one call of a row of speed breakers, and keeps separate ones separate", () => {
    const features = featuresFromNodes(
      [
        node(1, at(500), { traffic_calming: "hump" }),
        node(2, at(530), { traffic_calming: "hump" }),
        node(3, at(560), { traffic_calming: "hump" }),
        node(4, at(1400), { traffic_calming: "hump" }),
        node(5, at(1000), { railway: "level_crossing" }),
        node(6, at(1700), { ford: "yes" }),
      ],
      line,
    );
    expect(features.map((f) => f.label)).toEqual([
      "speed breaker",
      "railway crossing",
      "speed breaker",
      "water crossing",
    ]);
    expect(features[0]!.endDist).toBeCloseTo(560, -1);
  });
});

describe("Overpass with hazard nodes", () => {
  it("asks for them alongside the roads, unless told not to", () => {
    const box = { south: 18.4, west: 73.4, north: 18.5, east: 73.5 };
    const query = buildQuery([box], resolveOsmConfig());
    expect(query).toContain('node["traffic_calming"]');
    expect(query).toContain('node["railway"="level_crossing"]');
    expect(buildQuery([box], resolveOsmConfig({ fetchHazardNodes: false }))).not.toContain("node[");
  });

  it("reads tagged nodes out of the response and skips bare ones", () => {
    const network = parseOverpass(
      JSON.stringify({
        elements: [
          { type: "node", id: 7, lat: 18.45, lon: 73.41, tags: { traffic_calming: "bump" } },
          { type: "node", id: 7, lat: 18.45, lon: 73.41, tags: { traffic_calming: "bump" } },
          { type: "node", id: 8, lat: 18.46, lon: 73.42 },
          {
            type: "way",
            id: 1,
            tags: { highway: "primary" },
            geometry: [
              { lat: 18.45, lon: 73.41 },
              { lat: 18.46, lon: 73.42 },
            ],
          },
        ],
      }),
      [],
    );
    expect(network.nodes).toHaveLength(1);
    expect(network.ways).toHaveLength(1);
  });
});

describe("a matched route carries what the map knows", () => {
  const line = road(3000);
  const cut = (from: number, to: number): GeoPoint[] =>
    line.slice(from / 10, to / 10 + 1).map((p) => ({ ...p }));
  const ways: OsmWay[] = [
    { id: 1, geometry: cut(0, 1200), tags: { highway: "secondary", surface: "asphalt" } },
    { id: 2, geometry: cut(1200, 1800), tags: { highway: "secondary", surface: "unpaved" } },
    { id: 3, geometry: cut(1800, 3000), tags: { highway: "secondary", surface: "asphalt" } },
  ];
  const bump = destination(ORIGIN, 600, 20);
  const network = {
    ...asNetwork(ways),
    nodes: [{ id: 9, lat: bump.lat, lon: bump.lon, tags: { traffic_calming: "bump" } }],
  };
  // A sparse GPX of the same road with a hill in it.
  const gpx = line
    .filter((_, i) => i % 6 === 0)
    .map((p, i) => ({ ...p, ele: 200 + Math.sin(i / 8) * 40 }));

  const match = matchToRoads(gpx, network);

  it("reports the surface change and the speed breaker along the match", () => {
    expect(match.usedOsm).toBe(true);
    const byKind = Object.fromEntries(match.features!.map((f) => [f.kind, f]));
    expect(byKind["surface"]!.dist).toBeCloseTo(1200, -2);
    expect(byKind["surface"]!.endDist).toBeCloseTo(1800, -2);
    expect(byKind["bump"]!.dist).toBeCloseTo(600, -1);
  });

  it("carries the GPX elevation onto the dense road geometry", () => {
    expect(match.geometry.every((p) => p.ele !== undefined)).toBe(true);
    const cumulative = cumulativeDistances(match.geometry);
    // Spot-check against the profile the GPX was given (one sample per 60 m).
    for (const i of [50, 120, 200]) {
      const expected = 200 + Math.sin(cumulative[i]! / 60 / 8) * 40;
      expect(Math.abs(match.geometry[i]!.ele! - expected)).toBeLessThan(4);
    }
  });

  it("puts those hazards on the analysed route, scaled to its length", () => {
    const route = analyseRoute(match.geometry);
    applyMapFeatures(route, match);
    const kinds = route.features!.map((f) => f.kind);
    expect(kinds).toContain("surface");
    expect(kinds).toContain("bump");
    expect(route.ascent!).toBeGreaterThan(30);
    for (const feature of route.features!) expect(feature.dist).toBeLessThanOrEqual(route.length);
  });

  it("leaves elevation alone when the GPX has none", () => {
    const bare = [ORIGIN, destination(ORIGIN, 100, 0)];
    expect(transferElevation(bare, bare)).toBe(bare);
  });
});
