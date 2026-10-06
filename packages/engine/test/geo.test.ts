import { describe, expect, it } from "vitest";
import {
  bearing,
  destination,
  haversine,
  headingDelta,
  pointToSegment,
} from "../src/geo.js";
import { ORIGIN } from "./helpers.js";

describe("geodesy", () => {
  it("measures a known distance", () => {
    const a = { lat: 18.5, lon: 73.8 };
    const b = { lat: 18.5, lon: 73.81 };
    // 0.01 degrees of longitude at 18.5N is ~1054 m.
    expect(haversine(a, b)).toBeCloseTo(1054, -1);
  });

  it("round-trips destination and bearing", () => {
    const target = destination(ORIGIN, 250, 37);
    expect(haversine(ORIGIN, target)).toBeCloseTo(250, 3);
    expect(bearing(ORIGIN, target)).toBeCloseTo(37, 3);
  });

  it("wraps heading differences the short way", () => {
    expect(headingDelta(350, 10)).toBeCloseTo(20);
    expect(headingDelta(10, 350)).toBeCloseTo(-20);
    expect(headingDelta(0, 180)).toBeCloseTo(180);
  });

  it("projects a point onto a segment", () => {
    const a = ORIGIN;
    const b = destination(ORIGIN, 100, 90);
    const p = destination(destination(ORIGIN, 50, 90), 20, 0);
    const { distance, t } = pointToSegment(p, a, b);
    expect(distance).toBeCloseTo(20, 1);
    expect(t).toBeCloseTo(0.5, 2);
  });
});
