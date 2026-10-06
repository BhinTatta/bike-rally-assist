import { describe, expect, it } from "vitest";
import { buildCornerCall, describeCorner, roundDistance } from "../src/phrase.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { Corner } from "../src/types.js";

const corner = (over: Partial<Corner> = {}): Corner => ({
  id: 0,
  direction: "right",
  startDist: 100,
  endDist: 160,
  apexDist: 130,
  apex: { lat: 18, lon: 73 },
  minRadius: 35,
  meanRadius: 50,
  headingChange: 90,
  length: 60,
  sustainedLength: 45,
  grade: "sharp",
  rallyNumber: 3,
  modifiers: [],
  ...over,
});

const runtime = DEFAULT_CONFIG.runtime;
const rally = { ...runtime, rallyMode: true };

describe("phrasing", () => {
  it("rounds spoken distances to the nearest 10 m", () => {
    expect(roundDistance(83, 10)).toBe(80);
    expect(roundDistance(85, 10)).toBe(90);
    expect(roundDistance(4, 10)).toBe(0);
  });

  it("speaks modifiers", () => {
    expect(describeCorner(corner({ modifiers: ["tightens"] }), false).text).toBe(
      "sharp right tightens",
    );
    expect(describeCorner(corner({ modifiers: ["long"] }), false).text).toBe(
      "long sharp right",
    );
    expect(
      describeCorner(corner({ modifiers: ["long", "opens"] }), true).text,
    ).toBe("long right 3 opens");
  });

  it("drops modifiers for chained corners to keep the call short", () => {
    expect(
      describeCorner(corner({ modifiers: ["long", "tightens"] }), false, false)
        .text,
    ).toBe("sharp right");
  });

  it("builds a plain call", () => {
    const call = buildCornerCall(
      { corners: [corner()], distance: 83, timeToCorner: 5, time: 0, riderDist: 17, speed: 16 },
      runtime,
    );
    expect(call.text).toBe("Sharp right, 80 metres");
    expect(call.tokens).toEqual(["sharp", "right", "80", "metres"]);
  });

  it("builds a rally call", () => {
    const call = buildCornerCall(
      { corners: [corner()], distance: 83, timeToCorner: 5, time: 0, riderDist: 17, speed: 16 },
      rally,
    );
    expect(call.text).toBe("Right 3, 80");
    expect(call.tokens).toEqual(["right", "3", "80"]);
  });

  it("builds an immediate call without a distance", () => {
    const call = buildCornerCall(
      { corners: [corner({ grade: "hairpin", rallyNumber: 1 })], distance: 12, timeToCorner: 1, time: 0, riderDist: 88, speed: 10 },
      runtime,
    );
    expect(call.text).toBe("Immediate hairpin right");
    expect(call.tokens).toEqual(["immediate", "hairpin", "right"]);
  });

  it("chains corners with 'into'", () => {
    const call = buildCornerCall(
      {
        corners: [
          corner({ modifiers: ["into"] }),
          corner({ id: 1, direction: "left", grade: "medium", rallyNumber: 4 }),
        ],
        distance: 100,
        timeToCorner: 5,
        time: 0,
        riderDist: 0,
        speed: 20,
      },
      runtime,
    );
    expect(call.text).toBe("Sharp right, 100 metres, into medium left");
    expect(call.cornerIds).toEqual([0, 1]);
  });
});
