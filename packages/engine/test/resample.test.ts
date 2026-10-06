import { describe, expect, it } from "vitest";
import { dedupe, resample, cumulativeDistances } from "../src/resample.js";
import { haversine } from "../src/geo.js";
import { arc, join, ORIGIN, straight } from "./helpers.js";

describe("dedupe", () => {
  it("drops points closer than the minimum gap", () => {
    const points = [
      ORIGIN,
      { lat: ORIGIN.lat + 0.0000001, lon: ORIGIN.lon },
      { lat: ORIGIN.lat + 0.001, lon: ORIGIN.lon },
    ];
    expect(dedupe(points, 1)).toHaveLength(2);
  });

  it("drops non-finite points", () => {
    expect(dedupe([ORIGIN, { lat: NaN, lon: 0 }], 1)).toHaveLength(1);
  });
});

describe("resample", () => {
  it("produces evenly spaced points along a straight", () => {
    const points = resample(straight(ORIGIN, 90, 100, 25), 5);
    expect(points).toHaveLength(21);
    for (let i = 1; i < points.length; i++) {
      expect(haversine(points[i - 1]!, points[i]!)).toBeCloseTo(5, 2);
    }
  });

  it("densifies sparse input without moving the corridor", () => {
    // Three points, 60 m apart: a planner's idea of a corner.
    const sparse = straight(ORIGIN, 0, 120, 60);
    const points = resample(sparse, 5);
    expect(points.length).toBeGreaterThan(20);
    expect(haversine(points[0]!, sparse[0]!)).toBeLessThan(0.01);
  });

  it("keeps total length within a sample of the input", () => {
    const route = join(straight(ORIGIN, 0, 200), arc({ ...ORIGIN }, 0, 50, 90));
    const raw = cumulativeDistances(route).at(-1)!;
    const sampled = cumulativeDistances(resample(route, 5)).at(-1)!;
    expect(Math.abs(sampled - raw)).toBeLessThan(5);
  });

  it("handles degenerate input", () => {
    expect(resample([], 5)).toHaveLength(0);
    expect(resample([ORIGIN], 5)).toHaveLength(1);
    expect(resample([ORIGIN, ORIGIN], 5)).toHaveLength(1);
  });
});
