/**
 * End-to-end guard over the committed fixtures: the wobbly planner GPX that
 * ships in `fixtures/` must still snap onto the surveyed road that ships
 * beside it, and corner detection must agree with the clean route afterwards.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyseGpx, analyseRoute, parseGpx } from "@rally/engine";
import { matchToRoads, parseOverpass } from "../src/index.js";

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url)), "utf8");

describe("committed fixtures", () => {
  const planner = parseGpx(fixture("sample-ghat-planner.gpx"));
  const roads = parseOverpass(fixture("sample-ghat-osm.json"), []);
  const clean = analyseGpx(fixture("sample-ghat.gpx"));

  it("has a surveyed road split into joined ways", () => {
    expect(roads.ways).toHaveLength(5);
    expect(roads.ways[0]!.tags["name"]).toBe("Tamhini Ghat Road");
  });

  it("reads too many corners from the raw planner line", () => {
    const rough = analyseRoute(planner.points);
    expect(rough.corners.length).toBeGreaterThan(clean.corners.length + 3);
  });

  it("recovers the real corners once snapped to OSM", () => {
    const match = matchToRoads(planner.points, roads);
    expect(match.usedOsm).toBe(true);
    expect(match.quality.meanOffset).toBeLessThan(6);

    const snapped = analyseRoute(match.geometry);
    expect(snapped.corners).toHaveLength(clean.corners.length);
    for (let i = 0; i < snapped.corners.length; i++) {
      expect(snapped.corners[i]!.grade).toBe(clean.corners[i]!.grade);
      expect(snapped.corners[i]!.direction).toBe(clean.corners[i]!.direction);
    }
    expect(snapped.corners.filter((c) => c.grade === "hairpin")).toHaveLength(2);
  });
});
