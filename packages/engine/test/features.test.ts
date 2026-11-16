import { describe, expect, it } from "vitest";
import { CoDriver } from "../src/codriver.js";
import { analyseRoute } from "../src/route.js";
import { mergeFeatures } from "../src/features.js";
import { RideSimulator, simulateRide, speedProfile } from "../src/simulate.js";
import { RIDE_MODES, brakingDistance, cornerSpeed, leanAngle } from "../src/modes.js";
import { RideStatsTracker, averageMovingSpeed } from "../src/rideStats.js";
import { buildStraightCall, spokenLength } from "../src/phrase.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { AnalysedRoute, Call, GeoPoint } from "../src/types.js";
import { arc, headingAfterArc, join, last, ORIGIN, straight } from "./helpers.js";

/** Give a flat polyline a height profile: `ele(d)` at d metres along it. */
function withElevation(points: GeoPoint[], ele: (dist: number) => number): GeoPoint[] {
  let dist = 0;
  return points.map((p, i) => {
    if (i > 0) dist += 10; // helpers sample straights every 10 m here
    return { ...p, ele: ele(dist) };
  });
}

/** A long straight, a hairpin, a run-out. */
function hairpinAfterStraight(lead = 800): AnalysedRoute {
  const a = straight(ORIGIN, 0, lead, 10);
  const bend = arc(last(a), 0, 14, 170);
  const b = straight(last(bend), headingAfterArc(0, 170), 500, 10);
  return analyseRoute(join(a, bend, b));
}

const kinds = (calls: Call[], kind: Call["kind"]): Call[] => calls.filter((c) => c.kind === kind);

describe("elevation features", () => {
  // Flat, 600 m up at 9%, 600 m down at 9%, flat: one crest, one climb, one
  // descent.
  const hill = analyseRoute(
    withElevation(straight(ORIGIN, 0, 1800, 10), (d) =>
      d <= 300 ? 100 : d <= 900 ? 100 + (d - 300) * 0.09 : d <= 1500 ? 154 - (d - 900) * 0.09 : 100,
    ),
  );

  it("finds the crest where the road stops climbing", () => {
    const crests = hill.features!.filter((f) => f.kind === "crest");
    expect(crests).toHaveLength(1);
    expect(Math.abs(crests[0]!.dist - 900)).toBeLessThan(40);
  });

  it("finds the steep climb and the steep descent either side", () => {
    const climb = hill.features!.find((f) => f.kind === "steep-climb")!;
    const descent = hill.features!.find((f) => f.kind === "steep-descent")!;
    expect(climb.dist).toBeGreaterThan(250);
    expect(climb.dist).toBeLessThan(400);
    expect(climb.gradientPercent!).toBeGreaterThan(8);
    expect(descent.dist).toBeGreaterThan(850);
    expect(descent.gradientPercent!).toBeLessThan(-7);
    expect(descent.endDist! - descent.dist).toBeGreaterThan(400);
  });

  it("adds up the climbing", () => {
    expect(hill.ascent!).toBeGreaterThan(45);
    expect(hill.ascent!).toBeLessThan(60);
    expect(hill.descent!).toBeGreaterThan(45);
  });

  it("finds nothing on a route with no elevation, and nothing on a gentle one", () => {
    const flat = analyseRoute(straight(ORIGIN, 0, 1200, 10));
    expect(flat.features).toEqual([]);
    expect(flat.ascent).toBeUndefined();
    const gentle = analyseRoute(
      withElevation(straight(ORIGIN, 0, 1200, 10), (d) => 100 + d * 0.02),
    );
    expect(gentle.features).toEqual([]);
  });

  it("is not fooled by stepped terrain-model elevation", () => {
    // 30 m steps of 1.5 m: a 5% slope as a staircase, the way planners export it.
    const stepped = analyseRoute(
      withElevation(straight(ORIGIN, 0, 1500, 10), (d) => 100 + Math.floor(d / 30) * 1.5),
    );
    expect(stepped.features!.filter((f) => f.kind === "crest" || f.kind === "dip")).toEqual([]);
  });

  it("calls the crest once, ahead of time, and mirrors climbs when riding back", () => {
    const calls = simulateRide(hill, { speedKmh: 50 }, { runtime: { announceFeatures: true } }).calls;
    const spoken = kinds(calls, "feature").map((c) => c.text);
    expect(spoken.filter((t) => t.startsWith("Crest"))).toHaveLength(1);
    expect(spoken.some((t) => t.startsWith("Steep descent"))).toBe(true);

    // Ride it from the far end: the descent is now the first thing, as a climb.
    const reversed: AnalysedRoute = hill;
    const codriver = new CoDriver(reversed, { runtime: { announceFeatures: true } });
    const back = new RideSimulator(hill, { speedKmh: 50 });
    const fixes = [];
    for (;;) {
      const fix = back.step(1);
      if (!fix) break;
      fixes.push(fix);
    }
    fixes.reverse();
    const said: string[] = [];
    fixes.forEach((fix, i) => {
      for (const call of codriver.update({ ...fix, time: 1_000_000 + i * 1000 })) {
        if (call.kind === "feature") said.push(call.text);
      }
    });
    expect(said.some((t) => t.startsWith("Steep climb"))).toBe(true);
    expect(said.filter((t) => t.startsWith("Crest"))).toHaveLength(1);
  });
});

describe("caution", () => {
  it("flags a hairpin at the end of a long straight", () => {
    const route = hairpinAfterStraight(800);
    expect(route.corners[0]!.caution).toBe(true);
    expect(route.corners[0]!.approachMeters!).toBeGreaterThan(700);
  });

  it("does not flag the same hairpin after a short approach, or a gentle corner", () => {
    expect(hairpinAfterStraight(150).corners[0]!.caution).toBeUndefined();
    const a = straight(ORIGIN, 0, 800, 10);
    const bend = arc(last(a), 0, 120, 60);
    const gentle = analyseRoute(join(a, bend, straight(last(bend), 60, 300, 10)));
    expect(gentle.corners[0]!.caution).toBeUndefined();
  });

  it("is spoken only when the mode asks for it", () => {
    const route = hairpinAfterStraight(800);
    const plain = kinds(simulateRide(route, { speedKmh: 50 }).calls, "corner")[0]!;
    expect(plain.text).toMatch(/^Hairpin right/);
    const cautious = kinds(
      simulateRide(route, { speedKmh: 50 }, { runtime: { cautionCalls: true } }).calls,
      "corner",
    )[0]!;
    expect(cautious.text).toMatch(/^Caution, hairpin right, \d+ metres$/);
    expect(cautious.tokens[0]).toBe("caution");
    expect(cautious.caution).toBe(true);
  });
});

describe("braking-aware calls", () => {
  const route = hairpinAfterStraight(800);

  it("calls a hairpin earlier than the lead time alone when arriving fast", () => {
    const timed = kinds(simulateRide(route, { speedKmh: 100 }).calls, "corner")[0]!;
    const braking = kinds(
      simulateRide(route, { speedKmh: 100 }, { runtime: { brakingAwareLead: true } }).calls,
      "corner",
    )[0]!;
    expect(braking.distance!).toBeGreaterThan(timed.distance! + 20);
    // ...and that distance really is enough to slow down in.
    const speed = 100 / 3.6;
    const needed = brakingDistance(
      speed,
      cornerSpeed(route.corners[0]!.minRadius, DEFAULT_CONFIG.runtime.lateralG),
      DEFAULT_CONFIG.runtime.brakingG,
      DEFAULT_CONFIG.runtime.reactionSeconds,
    );
    expect(braking.distance!).toBeGreaterThan(needed - speed);
  });

  it("leaves a gentle corner's timing alone", () => {
    const a = straight(ORIGIN, 0, 800, 10);
    const bend = arc(last(a), 0, 200, 40);
    const sweeper = analyseRoute(join(a, bend, straight(last(bend), 40, 300, 10)));
    const timed = kinds(simulateRide(sweeper, { speedKmh: 70 }).calls, "corner")[0]!;
    const braking = kinds(
      simulateRide(sweeper, { speedKmh: 70 }, { runtime: { brakingAwareLead: true } }).calls,
      "corner",
    )[0]!;
    expect(braking.distance).toBeCloseTo(timed.distance!, 5);
  });

  it("does not cry wolf: a call made in good time carries no speed warning", () => {
    for (const mode of Object.values(RIDE_MODES)) {
      const calls = kinds(
        simulateRide(route, { speedKmh: mode.typicalSpeedKmh }, { runtime: mode.runtime }).calls,
        "corner",
      );
      expect(calls[0]!.overspeed).toBeUndefined();
    }
  });

  it("warns when there is no longer room to slow down", () => {
    // Joining the road 60 m before a hairpin at 100 km/h: nothing gentle left.
    const codriver = new CoDriver(route, { runtime: RIDE_MODES.sport.runtime });
    const simulator = new RideSimulator(route, {
      speedKmh: 100,
      startDist: route.corners[0]!.startDist - 60,
    });
    const calls = [...codriver.update(simulator.step(1)!), ...codriver.update(simulator.step(1)!)];
    const corner = kinds(calls, "corner")[0]!;
    expect(corner.overspeed).toBe(true);
    expect(corner.text).toMatch(/^Slow, /);

    const duke = new CoDriver(route, { runtime: RIDE_MODES.duke.runtime });
    const again = new RideSimulator(route, {
      speedKmh: 110,
      startDist: route.corners[0]!.startDist - 60,
    });
    const dukeCall = kinds(
      [...duke.update(again.step(1)!), ...duke.update(again.step(1)!)],
      "corner",
    )[0]!;
    expect(dukeCall.text).toMatch(/^Brake, (immediate )?right 1/);
  });
});

describe("ride modes", () => {
  const a = straight(ORIGIN, 0, 500, 10);
  const slight = arc(last(a), 0, 220, 30);
  const b = straight(last(slight), 30, 400, 10);
  const sharp = arc(last(b), 30, 35, 90);
  const route = analyseRoute(join(a, slight, b, sharp, straight(last(sharp), 120, 900, 10)));

  it("cruise skips the slight corner that sport and duke call", () => {
    const said = (id: keyof typeof RIDE_MODES): string[] =>
      kinds(
        simulateRide(route, { speedKmh: 50 }, { runtime: RIDE_MODES[id].runtime }).calls,
        "corner",
      ).map((c) => c.text);
    expect(said("cruise")).toHaveLength(1);
    expect(said("duke")).toHaveLength(2);
    expect(said("cruise")[0]).toMatch(/sharp right/i);
    expect(said("duke")[1]).toMatch(/right 3, \d+$/i);
  });

  it("cruise warns earlier than duke", () => {
    const first = (id: keyof typeof RIDE_MODES): Call =>
      kinds(
        simulateRide(route, { speedKmh: 60 }, { runtime: RIDE_MODES[id].runtime }).calls,
        "corner",
      ).at(-1)!;
    expect(first("cruise").distance!).toBeGreaterThan(first("duke").distance!);
  });

  it("duke counts out a long straight after a corner, once", () => {
    const calls = simulateRide(route, { speedKmh: 60 }, { runtime: RIDE_MODES.duke.runtime }).calls;
    const straights = kinds(calls, "straight");
    expect(straights).toHaveLength(1);
    expect(straights[0]!.text).toMatch(/^Straight \d+$/);
    expect(straights[0]!.distance!).toBeGreaterThan(700);
    expect(kinds(simulateRide(route, { speedKmh: 60 }, { runtime: RIDE_MODES.sport.runtime }).calls, "straight")).toEqual([]);
  });
});

describe("sections", () => {
  // 3 km of nothing, then a dozen tight bends, then nothing again.
  const parts: GeoPoint[][] = [straight(ORIGIN, 0, 3000, 20)];
  let heading = 0;
  for (let i = 0; i < 12; i++) {
    const sweep = i % 2 === 0 ? 100 : -100;
    const bend = arc(last(parts[parts.length - 1]!), heading, 30, sweep);
    heading = headingAfterArc(heading, sweep);
    parts.push(bend, straight(last(bend), heading, 60, 10));
  }
  parts.push(straight(last(parts[parts.length - 1]!), heading, 3000, 20));
  const route = analyseRoute(join(...parts));

  it("cuts the route into straight, busy, straight", () => {
    const names = route.sections!.map((s) => s.kind);
    expect(names[0]).toBe("straight");
    expect(names.at(-1)).toBe("straight");
    expect(names.some((k) => k === "twisty" || k === "technical")).toBe(true);
    // Sections tile the route with no gaps.
    expect(route.sections![0]!.startDist).toBe(0);
    for (let i = 1; i < route.sections!.length; i++) {
      expect(route.sections![i]!.startDist).toBe(route.sections![i - 1]!.endDist);
    }
    expect(route.sections!.at(-1)!.endDist).toBeCloseTo(route.length, 3);
  });

  it("announces arriving at the twisties and the road opening up after, once each", () => {
    const calls = simulateRide(route, { speedKmh: 60, lateralG: 0.4 }, { runtime: RIDE_MODES.sport.runtime }).calls;
    const spoken = kinds(calls, "section").map((c) => c.text);
    expect(spoken.filter((t) => /^(Twisty|Technical) section/.test(t))).toHaveLength(1);
    expect(spoken.filter((t) => t.startsWith("Road opens up"))).toHaveLength(1);
    // The announcement lands before the first corner call of the section.
    const section = calls.findIndex((c) => c.kind === "section");
    const corner = calls.findIndex((c) => c.kind === "corner");
    expect(section).toBeLessThan(corner);
  });

  it("stays quiet about sections unless the mode wants them", () => {
    expect(kinds(simulateRide(route, { speedKmh: 60 }).calls, "section")).toEqual([]);
  });
});

describe("map features in the co-driver", () => {
  const base = (): AnalysedRoute => {
    const route = analyseRoute(straight(ORIGIN, 0, 2000, 10));
    mergeFeatures(route, [
      { kind: "bump", dist: 600, label: "speed breaker", source: "osm" },
      { kind: "surface", dist: 1200, endDist: 1500, label: "gravel", source: "osm" },
      { kind: "bridge", dist: 5000, source: "osm" }, // beyond the end: dropped
    ]);
    return route;
  };

  it("keeps features in route order and drops ones off the end", () => {
    const route = base();
    expect(route.features!.map((f) => f.kind)).toEqual(["bump", "surface"]);
    expect(route.features!.map((f) => f.id)).toEqual([0, 1]);
  });

  it("calls each hazard once, with a distance, in both voices", () => {
    const plain = kinds(
      simulateRide(base(), { speedKmh: 60 }, { runtime: { announceFeatures: true } }).calls,
      "feature",
    ).map((c) => c.text);
    expect(plain).toHaveLength(2);
    expect(plain[0]).toMatch(/^Caution, speed breaker, \d+ metres$/);
    expect(plain[1]).toMatch(/^Caution, gravel, \d+ metres$/);

    const rally = kinds(
      simulateRide(base(), { speedKmh: 60 }, { runtime: { announceFeatures: true, rallyMode: true } }).calls,
      "feature",
    ).map((c) => c.text);
    expect(rally[0]).toMatch(/^Caution, speed breaker, \d+$/);
  });

  it("never announces a hazard that is already behind at the start", () => {
    const route = base();
    const codriver = new CoDriver(route, { runtime: { announceFeatures: true } });
    const simulator = new RideSimulator(route, { speedKmh: 60, startDist: 800 });
    const said: string[] = [];
    for (;;) {
      const fix = simulator.step(1);
      if (!fix) break;
      for (const call of codriver.update(fix)) if (call.kind === "feature") said.push(call.text);
    }
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/gravel/);
  });

  it("shows the next hazard and the next corners to the display", () => {
    const route = hairpinAfterStraight(800);
    mergeFeatures(route, [{ kind: "bump", dist: 300, label: "speed breaker", source: "osm" }]);
    const codriver = new CoDriver(route);
    const simulator = new RideSimulator(route, { speedKmh: 50 });
    codriver.update(simulator.step(1)!);
    const state = codriver.getState();
    expect(state.nextFeature!.feature.kind).toBe("bump");
    expect(state.nextFeature!.distance).toBeCloseTo(300, -1);
    expect(state.upcoming[0]!.corner.grade).toBe("hairpin");
    expect(state.upcoming[0]!.advisorySpeed).toBeGreaterThan(4);
    expect(state.progress).toBeCloseTo(0, 2);
    expect(state.remaining).toBeCloseTo(route.length, -1);
  });

  it("keeps a corner on the display after it has been called, until it is behind", () => {
    const route = hairpinAfterStraight(800);
    const codriver = new CoDriver(route);
    const simulator = new RideSimulator(route, { speedKmh: 50 });
    let called = false;
    let shownAfterCall = 0;
    let insideSeen = false;
    for (;;) {
      const fix = simulator.step(1);
      if (!fix) break;
      if (codriver.update(fix).some((c) => c.kind === "corner")) called = true;
      const state = codriver.getState();
      if (called && state.upcoming.length > 0) {
        shownAfterCall++;
        if (state.upcoming[0]!.distance <= 0) insideSeen = true;
      }
    }
    expect(shownAfterCall).toBeGreaterThan(3);
    expect(insideSeen).toBe(true);
    expect(codriver.getState().upcoming).toEqual([]);
  });
});

describe("the preview rider", () => {
  const route = hairpinAfterStraight(800);

  it("never exceeds the corner speed, and never brakes impossibly hard", () => {
    const cruise = 90 / 3.6;
    const profile = speedProfile(route, cruise, 0.35, 2.2, 3.5);
    let hardest = 0;
    profile.forEach((v, i) => {
      const k = Math.abs(route.points[i]!.curvature);
      if (k > 0) expect(v).toBeLessThanOrEqual(Math.sqrt((0.35 * 9.81) / k) + 1e-6);
      expect(v).toBeLessThanOrEqual(cruise + 1e-9);
      if (i > 0) {
        const step = route.points[i]!.dist - route.points[i - 1]!.dist;
        hardest = Math.max(hardest, (profile[i - 1]! ** 2 - v ** 2) / (2 * step));
      }
    });
    expect(hardest).toBeLessThanOrEqual(3.5 + 1e-6);
    expect(Math.min(...profile)).toBeLessThan(10); // it did slow for the hairpin
  });

  it("can be stepped, sought and run to the end", () => {
    const simulator = new RideSimulator(route, { speedKmh: 60, smooth: true });
    const first = simulator.step(1)!;
    expect(first.speed).toBeGreaterThan(0);
    simulator.seek(route.length - 5);
    expect(simulator.position).toBeCloseTo(route.length - 5, 5);
    let steps = 0;
    while (simulator.step(1) && steps < 100) steps++;
    expect(simulator.finished).toBe(true);
    expect(simulator.step(1)).toBeNull();
  });
});

describe("ride stats", () => {
  it("adds up distance, time, top speed and the corners called", () => {
    const route = hairpinAfterStraight(800);
    const codriver = new CoDriver(route, { runtime: RIDE_MODES.sport.runtime });
    const simulator = new RideSimulator(route, { speedKmh: 72, lateralG: 0.35, smooth: true });
    const tracker = new RideStatsTracker();
    for (;;) {
      const fix = simulator.step(1);
      if (!fix) break;
      for (const call of codriver.update(fix)) tracker.addCall(call);
      tracker.addFix(fix, codriver.getState());
    }
    const stats = tracker.snapshot();
    expect(stats.distanceMeters).toBeGreaterThan(route.length * 0.95);
    expect(stats.distanceMeters).toBeLessThan(route.length * 1.05);
    expect(stats.maxSpeed).toBeCloseTo(20, 0);
    expect(stats.cornersCalled).toBe(1);
    expect(stats.maxLean).toBeGreaterThan(10);
    expect(stats.maxLean).toBeLessThanOrEqual(55);
    expect(averageMovingSpeed(stats)).toBeGreaterThan(8);
    expect(stats.offRouteSeconds).toBe(0);
  });

  it("ignores a GPS teleport and resumes from a saved snapshot", () => {
    const route = analyseRoute(straight(ORIGIN, 0, 2000, 10));
    const codriver = new CoDriver(route);
    const tracker = new RideStatsTracker({ ...new RideStatsTracker().snapshot(), distanceMeters: 5000 });
    const simulator = new RideSimulator(route, { speedKmh: 36 });
    const a = simulator.step(1)!;
    codriver.update(a);
    tracker.addFix(a, codriver.getState());
    simulator.seek(1500); // 1.5 km in one second
    const b = simulator.step(1)!;
    codriver.update(b);
    tracker.addFix(b, codriver.getState());
    expect(tracker.snapshot().distanceMeters).toBe(5000);
  });
});

describe("small maths", () => {
  it("speaks lengths the way a person would", () => {
    expect(spokenLength(430).text).toBe("450 metres");
    expect(spokenLength(1000).text).toBe("1 kilometre");
    expect(spokenLength(2600).text).toBe("2.5 kilometres");
    expect(buildStraightCall(1600, 0, 0, DEFAULT_CONFIG.runtime).text).toBe("Straight, 1.5 kilometres");
  });

  it("estimates corner speed, braking distance and lean sensibly", () => {
    // 50 m radius at 0.35 g is about 47 km/h.
    expect(cornerSpeed(50, 0.35) * 3.6).toBeCloseTo(47.2, 0);
    expect(brakingDistance(10, 20, 0.35, 1.5)).toBe(0);
    // 100 -> 30 km/h at 0.35 g with 1.5 s of reaction: a bit over 140 m.
    expect(brakingDistance(100 / 3.6, 30 / 3.6, 0.35, 1.5)).toBeGreaterThan(130);
    expect(brakingDistance(100 / 3.6, 30 / 3.6, 0.35, 1.5)).toBeLessThan(160);
    // 1 g of lateral acceleration is 45 degrees.
    expect(leanAngle(Math.sqrt(9.81 * 30), 1 / 30)).toBeCloseTo(45, 5);
    expect(leanAngle(20, 0)).toBe(0);
  });
});
