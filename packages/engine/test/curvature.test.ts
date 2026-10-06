import { describe, expect, it } from "vitest";
import { analyseRoute } from "../src/route.js";
import { arc, headingAfterArc, join, last, ORIGIN, straight } from "./helpers.js";

/** Median absolute radius over the middle of a route, ignoring the lead-in. */
function medianRadius(curvatures: number[]): number {
  const radii = curvatures
    .filter((k) => Math.abs(k) > 1e-6)
    .map((k) => 1 / Math.abs(k))
    .sort((a, b) => a - b);
  return radii[Math.floor(radii.length / 2)] ?? Infinity;
}

describe("curvature", () => {
  it("reads a straight line as straight", () => {
    const route = analyseRoute(straight(ORIGIN, 45, 500, 25));
    for (const p of route.points) {
      expect(1 / Math.abs(p.curvature)).toBeGreaterThan(1000);
    }
    expect(route.corners).toHaveLength(0);
  });

  for (const radius of [20, 50, 100, 200]) {
    it(`recovers a ${radius} m arc radius within 20%`, () => {
      const lead = straight(ORIGIN, 0, 150, 10);
      const bend = arc(last(lead), 0, radius, 90);
      const tail = straight(last(bend), 90, 150, 10);
      const route = analyseRoute(join(lead, bend, tail));
      // Only look at the middle of the arc: the ends are blended into the
      // straights by the smoothing window, which is correct but not circular.
      const arcLength = (Math.PI * radius) / 2;
      const inside = route.points
        .filter(
          (p) =>
            p.dist > 150 + arcLength * 0.3 && p.dist < 150 + arcLength * 0.7,
        )
        .map((p) => p.curvature);
      expect(inside.length).toBeGreaterThan(0);
      const measured = medianRadius(inside);
      expect(measured).toBeGreaterThan(radius * 0.8);
      expect(measured).toBeLessThan(radius * 1.2);
    });
  }

  it("signs left turns positive and right turns negative", () => {
    const lead = straight(ORIGIN, 0, 100, 10);
    const right = arc(last(lead), 0, 60, 90);
    const left = arc(last(right), headingAfterArc(0, 90), 60, -90);
    const route = analyseRoute(join(lead, right, left));
    const inRight = route.points.find((p) => p.dist > 140 && p.dist < 160)!;
    const inLeft = route.points.find(
      (p) => p.dist > 100 + (Math.PI * 60) / 2 + 40,
    )!;
    expect(inRight.curvature).toBeLessThan(0);
    expect(inLeft.curvature).toBeGreaterThan(0);
  });
});
