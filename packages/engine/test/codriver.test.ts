import { describe, expect, it } from "vitest";
import { CoDriver } from "../src/codriver.js";
import { analyseRoute } from "../src/route.js";
import { simulateRide, pointAtDistance } from "../src/simulate.js";
import { destination } from "../src/geo.js";
import type { AnalysedRoute, Call, GpsFix } from "../src/types.js";
import { arc, headingAfterArc, join, last, noisy, ORIGIN, straight } from "./helpers.js";

/** A 600 m lead-in, one right-hand corner, a long run-out. */
function singleCornerRoute(radius: number, sweep = 90): AnalysedRoute {
  const lead = straight(ORIGIN, 0, 600, 20);
  const bend = arc(last(lead), 0, radius, sweep);
  const tail = straight(last(bend), headingAfterArc(0, sweep), 400, 20);
  return analyseRoute(join(lead, bend, tail));
}

/** Drive the route at a constant speed, 1 Hz, with no noise. */
function ride(
  route: AnalysedRoute,
  speedKmh: number,
  config?: Parameters<typeof simulateRide>[2],
): Call[] {
  return simulateRide(route, { speedKmh, rateHz: 1 }, config).calls;
}

const cornerCalls = (calls: Call[]): Call[] => calls.filter((c) => c.kind === "corner");

describe("co-driver calls", () => {
  it("announces a corner once, ahead of time, in plain language", () => {
    const route = singleCornerRoute(35);
    const calls = cornerCalls(ride(route, 50));
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.text).toMatch(/^Sharp right, \d+0 metres$/);
    expect(call.tokens).toEqual(["sharp", "right", expect.any(String), "metres"]);
    expect(call.cornerIds).toEqual([0]);
  });

  it("warns roughly the lead time ahead, in distance proportional to speed", () => {
    const route = singleCornerRoute(60);
    const slow = cornerCalls(ride(route, 30))[0]!;
    const fast = cornerCalls(ride(route, 70))[0]!;
    expect(fast.distance!).toBeGreaterThan(slow.distance!);
    // 5 s of lead time, give or take one fix interval.
    for (const call of [slow, fast]) {
      expect(call.timeToCorner!).toBeGreaterThan(3.5);
      expect(call.timeToCorner!).toBeLessThan(6.5);
    }
  });

  it("never calls closer than the minimum lead distance when crawling", () => {
    const route = singleCornerRoute(25);
    const call = cornerCalls(ride(route, 12))[0]!;
    // 12 km/h x 5 s is only 17 m, so the 30 m floor should apply.
    expect(call.distance!).toBeGreaterThan(25);
  });

  it("speaks rally pacenotes when asked", () => {
    const route = singleCornerRoute(35);
    const calls = cornerCalls(ride(route, 50, { runtime: { rallyMode: true } }));
    expect(calls[0]!.text).toMatch(/^Right 3, \d+0$/);
    expect(calls[0]!.tokens).toEqual(["right", "3", expect.any(String)]);
  });

  it("says 'immediate' when the corner is right there", () => {
    const route = singleCornerRoute(30);
    const codriver = new CoDriver(route);
    // Jump straight to 20 m before the corner at walking pace.
    const corner = route.corners[0]!;
    const here = pointAtDistance(route, corner.startDist - 22);
    const calls = codriver.update({ ...here, speed: 2, time: 1000 });
    expect(calls.some((c) => c.text.startsWith("Immediate"))).toBe(true);
  });

  it("chains an S-bend into a single call", () => {
    const lead = straight(ORIGIN, 0, 600, 20);
    const right = arc(last(lead), 0, 40, 70);
    const link = straight(last(right), headingAfterArc(0, 70), 15, 5);
    const left = arc(last(link), headingAfterArc(0, 70), 40, -70);
    const tail = straight(last(left), 0, 400, 20);
    const route = analyseRoute(join(lead, right, link, left, tail));
    expect(route.corners).toHaveLength(2);

    const calls = cornerCalls(ride(route, 45));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cornerIds).toEqual([0, 1]);
    expect(calls[0]!.text).toMatch(/^Sharp right, \d+0 metres, into sharp left$/);
    expect(calls[0]!.tokens).toContain("into");
  });

  it("filters out gentle corners when verbosity is 'sharp and above'", () => {
    const lead = straight(ORIGIN, 0, 600, 20);
    const gentle = arc(last(lead), 0, 130, 60);
    const mid = straight(last(gentle), headingAfterArc(0, 60), 300, 20);
    const sharp = arc(last(mid), headingAfterArc(0, 60), 30, 90);
    const tail = straight(last(sharp), headingAfterArc(0, 150), 400, 20);
    const route = analyseRoute(join(lead, gentle, mid, sharp, tail));
    expect(route.corners).toHaveLength(2);

    const all = cornerCalls(ride(route, 50));
    expect(all).toHaveLength(2);
    const sharpOnly = cornerCalls(
      ride(route, 50, { runtime: { maxRallyNumberToCall: 3 } }),
    );
    expect(sharpOnly).toHaveLength(1);
    expect(sharpOnly[0]!.text).toMatch(/right/);
  });

  it("calls every corner exactly once over a twisty route", () => {
    const parts = [straight(ORIGIN, 0, 300, 20)];
    let heading = 0;
    for (let i = 0; i < 6; i++) {
      const sweep = i % 2 === 0 ? 120 : -120;
      parts.push(arc(last(parts[parts.length - 1]!), heading, 22, sweep));
      heading = headingAfterArc(heading, sweep);
      parts.push(straight(last(parts[parts.length - 1]!), heading, 120, 20));
    }
    const route = analyseRoute(join(...parts));
    const calls = cornerCalls(ride(route, 35));
    const announced = calls.flatMap((c) => c.cornerIds);
    expect(new Set(announced).size).toBe(announced.length); // no duplicates
    expect(new Set(announced)).toEqual(new Set(route.corners.map((c) => c.id)));
  });

  it("survives noisy GPS without duplicate or missed calls", () => {
    const route = singleCornerRoute(30, 120);
    const twisty = analyseRoute(
      join(
        straight(ORIGIN, 0, 400, 20),
        arc(destination(ORIGIN, 400, 0), 0, 30, 100),
        straight(
          last(arc(destination(ORIGIN, 400, 0), 0, 30, 100)),
          100,
          200,
          20,
        ),
      ),
    );
    for (const target of [route, twisty]) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const calls = cornerCalls(
          simulateRide(target, { speedKmh: 45, noiseMeters: 5, seed }).calls,
        );
        const ids = calls.flatMap((c) => c.cornerIds);
        expect(new Set(ids).size, `seed ${seed}`).toBe(ids.length);
        expect(new Set(ids), `seed ${seed}`).toEqual(
          new Set(target.corners.map((c) => c.id)),
        );
      }
    }
  });

  it("derives a sane speed when fixes carry no speed field", () => {
    // Recorded ride GPX files have position and time but no speed; differencing
    // noisy positions naively would inflate the speed and call far too early.
    const route = singleCornerRoute(35, 100);
    const { fixes } = simulateRide(route, { speedKmh: 40, noiseMeters: 4, seed: 11 });
    const codriver = new CoDriver(route);
    const calls: Call[] = [];
    for (const fix of fixes) {
      calls.push(...codriver.update({ lat: fix.lat, lon: fix.lon, time: fix.time }));
    }
    const corner = cornerCalls(calls);
    expect(corner).toHaveLength(1);
    expect(corner[0]!.speed!).toBeGreaterThan(40 / 3.6 - 3);
    expect(corner[0]!.speed!).toBeLessThan(40 / 3.6 + 3);
    expect(corner[0]!.timeToCorner!).toBeGreaterThan(3);
    expect(corner[0]!.timeToCorner!).toBeLessThan(7);
  });

  it("does not call corners while stopped", () => {
    const route = singleCornerRoute(30);
    const codriver = new CoDriver(route);
    const corner = route.corners[0]!;
    const here = pointAtDistance(route, corner.startDist - 40);
    const calls = codriver.update({ ...here, speed: 0, time: 1000 });
    expect(cornerCalls(calls)).toHaveLength(0);
  });

  it("does not announce corners that are already behind when starting mid-route", () => {
    const route = singleCornerRoute(30);
    const codriver = new CoDriver(route);
    const corner = route.corners[0]!;
    const past = pointAtDistance(route, corner.endDist + 50);
    const calls = codriver.update({ ...past, speed: 15, time: 1000 });
    expect(cornerCalls(calls)).toHaveLength(0);
    expect(codriver.getState().nextCorner).toBeNull();
  });
});

describe("snapping and route state", () => {
  it("reports going off route once, then back on route", () => {
    const route = singleCornerRoute(40);
    const codriver = new CoDriver(route);
    const onRoute = pointAtDistance(route, 100);
    codriver.update({ ...onRoute, speed: 12, time: 0 });

    const detour: Call[] = [];
    for (let i = 1; i <= 5; i++) {
      const away = destination(pointAtDistance(route, 100 + i * 10), 120, 90);
      detour.push(...codriver.update({ ...away, speed: 12, time: i * 1000 }));
    }
    expect(detour.filter((c) => c.kind === "off-route")).toHaveLength(1);
    expect(codriver.getState().onRoute).toBe(false);

    const back = codriver.update({
      ...pointAtDistance(route, 180),
      speed: 12,
      time: 6000,
    });
    expect(back.filter((c) => c.kind === "back-on-route")).toHaveLength(1);
    expect(codriver.getState().onRoute).toBe(true);
  });

  it("stays on the correct leg of a hairpin instead of jumping across", () => {
    // Two legs 25 m apart joined by a hairpin: the classic snapping trap.
    const up = straight(ORIGIN, 0, 300, 10);
    const top = arc(last(up), 0, 12, 180);
    const down = straight(last(top), 180, 300, 10);
    const route = analyseRoute(join(up, top, down));
    const codriver = new CoDriver(route);
    let previous = 0;
    for (let d = 0; d < route.length; d += 10) {
      const here = pointAtDistance(route, d);
      codriver.update({ ...here, speed: 10, time: d * 100 });
      const state = codriver.getState();
      expect(state.dist!).toBeGreaterThanOrEqual(previous - 15);
      expect(Math.abs(state.dist! - d)).toBeLessThan(15);
      previous = state.dist!;
    }
  });

  it("ignores fixes with hopeless accuracy", () => {
    const route = singleCornerRoute(40);
    const codriver = new CoDriver(route);
    codriver.update({ ...pointAtDistance(route, 100), speed: 12, time: 0 });
    const before = codriver.getState().dist;
    codriver.update({
      ...pointAtDistance(route, 400),
      speed: 12,
      accuracy: 120,
      time: 1000,
    });
    expect(codriver.getState().dist).toBe(before);
  });

  it("says 'GPS lost' once when fixes stop, and notices when they return", () => {
    const route = singleCornerRoute(40);
    const codriver = new CoDriver(route);
    codriver.update({ ...pointAtDistance(route, 100), speed: 12, time: 0 });
    expect(codriver.tick(3000)).toHaveLength(0);
    const lost = codriver.tick(9000);
    expect(lost.map((c) => c.kind)).toEqual(["gps-lost"]);
    expect(codriver.tick(12000)).toHaveLength(0); // only once
    const back = codriver.update({
      ...pointAtDistance(route, 160),
      speed: 12,
      time: 13000,
    });
    expect(back.some((c) => c.kind === "gps-restored")).toBe(true);
  });

  it("announces the end of the route once", () => {
    const route = singleCornerRoute(40);
    const calls = ride(route, 50).filter((c) => c.kind === "route-end");
    expect(calls).toHaveLength(1);
  });

  it("tolerates a noisy raw track being used as the route itself", () => {
    const lead = straight(ORIGIN, 0, 400, 10);
    const bend = arc(last(lead), 0, 35, 110);
    const tail = straight(last(bend), 110, 300, 10);
    const route = analyseRoute(noisy(join(lead, bend, tail), 4));
    // Smoothing should stop GPS jitter from inventing a forest of corners.
    expect(route.corners.length).toBeLessThanOrEqual(3);
    expect(route.corners.some((c) => c.direction === "right")).toBe(true);
  });
});

describe("state for the ride screen", () => {
  it("exposes the next corner and the distance to it", () => {
    const route = singleCornerRoute(40);
    const codriver = new CoDriver(route);
    const fix: GpsFix = { ...pointAtDistance(route, 200), speed: 15, time: 0 };
    codriver.update(fix);
    const state = codriver.getState();
    expect(state.onRoute).toBe(true);
    expect(state.nextCorner?.id).toBe(0);
    expect(state.distanceToNextCorner).toBeGreaterThan(300);
    expect(state.speed).toBe(15);
    expect(state.gpsOk).toBe(true);
  });

  it("resets cleanly", () => {
    const route = singleCornerRoute(40);
    const codriver = new CoDriver(route);
    ride(route, 50);
    codriver.update({ ...pointAtDistance(route, 300), speed: 15, time: 0 });
    codriver.reset();
    const state = codriver.getState();
    expect(state.dist).toBeNull();
    expect(state.calledCornerIds).toEqual([]);
  });
});
