import { describe, expect, it } from "vitest";
import { analyseRoute, routeStats } from "../src/route.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { destination } from "../src/geo.js";
import { arc, headingAfterArc, join, last, ORIGIN, straight } from "./helpers.js";

describe("corner detection", () => {
  it("finds no corners on a straight", () => {
    expect(analyseRoute(straight(ORIGIN, 30, 800, 20)).corners).toHaveLength(0);
  });

  it("grades arcs by radius", () => {
    const cases: [number, string][] = [
      [20, "very sharp"],
      [35, "sharp"],
      [60, "medium"],
      [120, "gentle"],
      [250, "slight"],
    ];
    for (const [radius, grade] of cases) {
      const lead = straight(ORIGIN, 0, 150, 10);
      const bend = arc(last(lead), 0, radius, 90);
      const tail = straight(last(bend), 90, 150, 10);
      const route = analyseRoute(join(lead, bend, tail));
      expect(route.corners, `radius ${radius}`).toHaveLength(1);
      expect(route.corners[0]!.grade, `radius ${radius}`).toBe(grade);
      expect(route.corners[0]!.direction).toBe("right");
    }
  });

  it("calls a 180 degree switchback a hairpin, with rally number 1", () => {
    const lead = straight(ORIGIN, 0, 150, 10);
    const bend = arc(last(lead), 0, 18, 180);
    const tail = straight(last(bend), 180, 150, 10);
    const route = analyseRoute(join(lead, bend, tail));
    expect(route.corners).toHaveLength(1);
    const hairpin = route.corners[0]!;
    expect(hairpin.grade).toBe("hairpin");
    expect(hairpin.rallyNumber).toBe(1);
    expect(hairpin.direction).toBe("right");
    expect(hairpin.headingChange).toBeGreaterThan(170);
    expect(hairpin.minRadius).toBeLessThan(25);
    // The apex should sit in the middle of the bend, not at its edges.
    expect(hairpin.apexDist).toBeGreaterThan(hairpin.startDist + 10);
    expect(hairpin.apexDist).toBeLessThan(hairpin.endDist - 10);
  });

  it("handles a sparse 3-point hairpin from a rough planner GPX", () => {
    // What a ghat hairpin often looks like in OSM-derived planner output:
    // in, apex, out - three points, nothing else.
    const apex = destination(ORIGIN, 300, 0);
    // Up one leg, round the top, back down a leg 20 m to the east.
    const sparse = [
      ORIGIN,
      destination(ORIGIN, 150, 0),
      apex,
      destination(destination(ORIGIN, 150, 0), 20, 90),
      destination(ORIGIN, 20, 90),
    ];
    const route = analyseRoute(sparse);
    expect(route.corners.length).toBeGreaterThanOrEqual(1);
    const tightest = [...route.corners].sort((a, b) => a.minRadius - b.minRadius)[0]!;
    expect(tightest.headingChange).toBeGreaterThan(135);
    expect(tightest.grade).toBe("hairpin");
  });

  it("separates an S-bend into two corners and marks the first 'into'", () => {
    const lead = straight(ORIGIN, 0, 150, 10);
    const right = arc(last(lead), 0, 40, 70);
    const link = straight(last(right), headingAfterArc(0, 70), 15, 5);
    const left = arc(last(link), headingAfterArc(0, 70), 40, -70);
    const tail = straight(last(left), 0, 150, 10);
    const route = analyseRoute(join(lead, right, link, left, tail));

    expect(route.corners).toHaveLength(2);
    expect(route.corners[0]!.direction).toBe("right");
    expect(route.corners[1]!.direction).toBe("left");
    expect(route.corners[0]!.modifiers).toContain("into");
    expect(route.corners[1]!.modifiers).not.toContain("into");
  });

  it("merges a wobble inside one long corner instead of splitting it", () => {
    const lead = straight(ORIGIN, 0, 100, 10);
    const first = arc(last(lead), 0, 50, 45);
    // A brief near-straight in the middle - map noise, not a real exit.
    const flat = straight(last(first), headingAfterArc(0, 45), 12, 4);
    const second = arc(last(flat), headingAfterArc(0, 45), 50, 45);
    const tail = straight(last(second), 90, 100, 10);
    const route = analyseRoute(join(lead, first, flat, second, tail));
    expect(route.corners).toHaveLength(1);
    expect(route.corners[0]!.headingChange).toBeGreaterThan(80);
  });

  it("marks a decreasing-radius corner as tightening and the reverse as opening", () => {
    const lead = straight(ORIGIN, 0, 120, 10);
    const wide = arc(last(lead), 0, 90, 60);
    const tight = arc(last(wide), headingAfterArc(0, 60), 25, 70);
    const tail = straight(last(tight), headingAfterArc(0, 130), 120, 10);
    const tightens = analyseRoute(join(lead, wide, tight, tail));
    expect(tightens.corners[0]!.modifiers).toContain("tightens");

    const openLead = straight(ORIGIN, 0, 120, 10);
    const openTight = arc(last(openLead), 0, 25, 70);
    const openWide = arc(last(openTight), headingAfterArc(0, 70), 90, 60);
    const openTail = straight(last(openWide), headingAfterArc(0, 130), 120, 10);
    const opens = analyseRoute(join(openLead, openTight, openWide, openTail));
    expect(opens.corners[0]!.modifiers).toContain("opens");
  });

  it("marks a sustained bend as long", () => {
    const lead = straight(ORIGIN, 0, 100, 10);
    const bend = arc(last(lead), 0, 120, 120); // ~250 m of corner
    const route = analyseRoute(join(lead, bend));
    expect(route.corners[0]!.modifiers).toContain("long");
    expect(route.corners[0]!.length).toBeGreaterThan(
      DEFAULT_CONFIG.detection.longCornerMeters,
    );
  });

  it("respects an overridden threshold config", () => {
    const lead = straight(ORIGIN, 0, 150, 10);
    const bend = arc(last(lead), 0, 60, 90);
    const tail = straight(last(bend), 90, 150, 10);
    const points = join(lead, bend, tail);
    expect(analyseRoute(points).corners[0]!.grade).toBe("medium");
    // Tighten the buckets: the same 60 m corner should now read as "sharp".
    const strict = analyseRoute(points, {
      grading: {
        thresholds: [
          { grade: "very sharp", maxRadius: 30 },
          { grade: "sharp", maxRadius: 70 },
          { grade: "medium", maxRadius: 120 },
          { grade: "gentle", maxRadius: 200 },
          { grade: "slight", maxRadius: 400 },
        ],
      },
    });
    expect(strict.corners[0]!.grade).toBe("sharp");
  });

  it("ignores corners below the minimum heading change", () => {
    const lead = straight(ORIGIN, 0, 200, 10);
    const kink = arc(last(lead), 0, 280, 5); // a 5 degree kink
    const tail = straight(last(kink), 5, 200, 10);
    expect(analyseRoute(join(lead, kink, tail)).corners).toHaveLength(0);
  });
});

describe("route stats", () => {
  it("summarises a twisty route", () => {
    const parts = [straight(ORIGIN, 0, 100, 10)];
    let heading = 0;
    for (let i = 0; i < 4; i++) {
      const sweep = i % 2 === 0 ? 150 : -150;
      parts.push(arc(last(parts[parts.length - 1]!), heading, 18, sweep));
      heading = headingAfterArc(heading, sweep);
      parts.push(straight(last(parts[parts.length - 1]!), heading, 60, 10));
    }
    const route = analyseRoute(join(...parts));
    const stats = routeStats(route);
    expect(stats.cornerCount).toBe(4);
    expect(stats.hairpinCount).toBe(4);
    expect(stats.cornersPerKm).toBeGreaterThan(1);
    expect(stats.twistiestSection).toBeDefined();
    expect(stats.twistiestSection!.headingChange).toBeGreaterThan(300);
  });
});
