import { describe, expect, it } from "vitest";
import { analyseRoute, haversine, destination } from "@rally/engine";
import type { GeoPoint } from "@rally/engine";
import { matchToRoads } from "../src/match.js";
import { IndexedNetwork } from "../src/network.js";
import {
  asNetwork,
  asWays,
  parallelDecoy,
  roughPlannerGpx,
  trueGhatRoad,
  ORIGIN,
} from "./fixtures.js";

/** Mean distance from each point of `line` to the nearest point of `road`. */
function meanDistanceTo(line: GeoPoint[], road: GeoPoint[]): number {
  const network = new IndexedNetwork(asNetwork([{ id: 1, geometry: road, tags: {} }]));
  let total = 0;
  for (const point of line) {
    const [nearest] = network.candidates(point, 200, 1);
    total += nearest ? nearest.offset : 200;
  }
  return total / line.length;
}

describe("map matching", () => {
  const road = trueGhatRoad();
  const network = asNetwork([...asWays(road, 5), parallelDecoy(road)]);
  const gpx = roughPlannerGpx(road);

  it("recovers the surveyed road from a rough planner line", () => {
    const before = meanDistanceTo(gpx, road);
    const result = matchToRoads(gpx, network);

    expect(result.usedOsm).toBe(true);
    expect(result.quality.accepted).toBe(true);
    // The rough GPX sits several metres off; the matched geometry should be
    // essentially on the road.
    expect(before).toBeGreaterThan(3);
    expect(meanDistanceTo(result.geometry, road)).toBeLessThan(1);
  });

  it("returns dense OSM geometry rather than the sparse input", () => {
    const result = matchToRoads(gpx, network);
    expect(result.geometry.length).toBeGreaterThan(gpx.length * 3);
  });

  it("ignores a parallel decoy road", () => {
    const result = matchToRoads(gpx, network);
    expect(result.wayIds).not.toContain(9000);
    expect(result.roadNames).toEqual(["Ghat Road"]);
  });

  it("keeps the route length honest", () => {
    const result = matchToRoads(gpx, network);
    expect(result.quality.lengthRatio).toBeGreaterThan(0.95);
    expect(result.quality.lengthRatio).toBeLessThan(1.15);
  });

  it("walks through all the ways in travel order", () => {
    const result = matchToRoads(gpx, network);
    expect(result.wayIds).toEqual([1000, 1001, 1002, 1003, 1004]);
  });

  it("makes corner detection agree with the surveyed road", () => {
    // This is the whole point of the package. The engine copes with a rough
    // planner line, but it can only describe the line it is given: a hand-drawn
    // GPX wobbles, so it reads as a dozen corners with the wrong radii.
    const truth = analyseRoute(road);
    const rough = analyseRoute(gpx);
    const matched = analyseRoute(matchToRoads(gpx, network).geometry);

    expect(truth.corners).toHaveLength(5);
    expect(matched.corners).toHaveLength(5);
    expect(rough.corners.length).toBeGreaterThan(8); // phantom corners

    const radiusError = (r: typeof truth): number => {
      let total = 0;
      for (let i = 0; i < truth.corners.length; i++) {
        const mine = r.corners[i];
        if (!mine) return Infinity;
        total +=
          Math.abs(mine.minRadius - truth.corners[i]!.minRadius) /
          truth.corners[i]!.minRadius;
      }
      return total / truth.corners.length;
    };
    expect(radiusError(matched)).toBeLessThan(0.1);
    expect(radiusError(rough)).toBeGreaterThan(0.5);

    // Grades and apex positions should line up with the real road. On a long
    // constant-radius sweeper the "tightest point" is genuinely ill-defined and
    // can slide along the arc, so only tight corners get a tight apex bound.
    let apexError = 0;
    for (let i = 0; i < truth.corners.length; i++) {
      const mine = matched.corners[i]!;
      const real = truth.corners[i]!;
      expect(mine.grade).toBe(real.grade);
      expect(mine.direction).toBe(real.direction);
      const error = haversine(mine.apex, real.apex);
      apexError += error;
      if (real.minRadius < 50) expect(error).toBeLessThan(10);
    }
    expect(apexError / truth.corners.length).toBeLessThan(8);
  });

  it("handles a hairpin whose legs are both on one way", () => {
    // Both legs 20 m apart inside a single way: the nearest projection to a
    // point on the way up can easily be the way down.
    const up = [
      ORIGIN,
      ...Array.from({ length: 30 }, (_, i) => destination(ORIGIN, (i + 1) * 10, 0)),
    ];
    const top = Array.from({ length: 12 }, (_, i) =>
      destination(destination(ORIGIN, 300, 0), 10, (i + 1) * 15),
    );
    const down = Array.from({ length: 30 }, (_, i) =>
      destination(destination(ORIGIN, 300 - i * 10, 0), 20, 90),
    );
    const single = [...up, ...top, ...down];
    const oneWay = asNetwork([{ id: 7, geometry: single, tags: { highway: "tertiary" } }]);
    const rough = roughPlannerGpx(single, { keepEvery: 40, offsetMeters: 6 });

    const result = matchToRoads(rough, oneWay);
    expect(result.usedOsm).toBe(true);
    // Must not short-circuit across the hairpin: the matched line keeps its length.
    expect(result.quality.lengthRatio).toBeGreaterThan(0.9);
    expect(meanDistanceTo(result.geometry, single)).toBeLessThan(1);
  });
});

describe("falling back to the raw GPX", () => {
  const road = trueGhatRoad();

  it("falls back when the GPX is nowhere near a mapped road", () => {
    const gpx = roughPlannerGpx(road).map((p) => destination(p, 600, 90));
    const result = matchToRoads(gpx, asNetwork(asWays(road, 4)));
    expect(result.usedOsm).toBe(false);
    expect(result.geometry).toHaveLength(gpx.length);
    expect(result.quality.reason).toMatch(/near a road/);
  });

  it("falls back when only part of the route is mapped", () => {
    // Road data for the first third only: a very common Indian ghat situation.
    const partial = asNetwork(asWays(road.slice(0, Math.floor(road.length / 3)), 2));
    const result = matchToRoads(roughPlannerGpx(road), partial);
    expect(result.usedOsm).toBe(false);
    expect(result.quality.matchedFraction).toBeLessThan(0.8);
  });

  it("falls back when the corridor has no roads at all", () => {
    const result = matchToRoads(roughPlannerGpx(road), asNetwork([]));
    expect(result.usedOsm).toBe(false);
    expect(result.quality.reason).toMatch(/no roads/);
  });

  it("falls back rather than throwing on junk input", () => {
    expect(matchToRoads([], asNetwork(asWays(road, 2))).usedOsm).toBe(false);
    expect(matchToRoads([ORIGIN], asNetwork(asWays(road, 2))).usedOsm).toBe(false);
  });
});
