/**
 * `rally simulate <gpx>` - ride the route and print the calls as they fire.
 *
 * Two modes:
 *   synthetic  - ride at a constant speed (optionally with GPS noise),
 *   replay     - feed a recorded ride GPX (from the app) through the co-driver,
 *                which is how engine thresholds get tuned against real rides.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { CoDriver, parseGpx, simulateRide } from "@rally/engine";
import type { Call, GpsFix } from "@rally/engine";
import {
  bold,
  clock,
  configFromFlags,
  describeSnap,
  dim,
  green,
  kmh,
  loadRouteMaybeOsm,
  metres,
  red,
  yellow,
} from "../util.js";

function colourCall(call: Call): string {
  switch (call.kind) {
    case "corner":
      return green(`"${call.text}"`);
    case "off-route":
    case "gps-lost":
      return red(`"${call.text}"`);
    default:
      return yellow(`"${call.text}"`);
  }
}

/** Replay a recorded ride: real fix times, real noise, real stops. */
async function replay(routeFile: string, rideFile: string, values: Record<string, unknown>) {
  const { route, snap } = await loadRouteMaybeOsm(routeFile, values, configFromFlags(values));
  const parsed = parseGpx(readFileSync(rideFile, "utf8"));
  const points = parsed.points.filter((p) => p.time !== undefined);
  if (points.length < 2) {
    throw new Error(`${rideFile} has no timestamped track points to replay`);
  }
  const codriver = new CoDriver(route, configFromFlags(values));
  const calls: Call[] = [];
  const start = points[0]!.time!;
  for (const p of points) {
    const fix: GpsFix = { lat: p.lat, lon: p.lon, time: p.time! };
    calls.push(...codriver.update(fix));
  }
  return { route, calls, start, fixes: points.length, snap };
}

export async function simulateCommand(
  file: string,
  values: Record<string, unknown>,
): Promise<void> {
  const overrides = configFromFlags(values);
  const rideFile = typeof values["replay"] === "string" ? values["replay"] : undefined;

  let calls: Call[];
  let start: number;
  let header: string;
  let route;
  let snap;

  if (rideFile) {
    const result = await replay(file, rideFile, values);
    ({ route, calls, start, snap } = result);
    header = `replaying ${rideFile} (${result.fixes} fixes)`;
  } else {
    ({ route, snap } = await loadRouteMaybeOsm(file, values, overrides));
    const speedKmh = Number(values["speed"] ?? 40);
    const noise = Number(values["noise"] ?? 0);
    const rate = Number(values["rate"] ?? 1);
    const result = simulateRide(
      route,
      {
        speedKmh,
        noiseMeters: noise,
        rateHz: rate,
        seed: Number(values["seed"] ?? 1),
        lateralG: Number(values["lateral-g"] ?? 0),
      },
      overrides,
    );
    calls = result.calls;
    start = result.fixes[0]?.time ?? 0;
    header =
      `${speedKmh} km/h, ${rate} Hz fixes, ${noise} m noise` +
      (Number(values["lateral-g"] ?? 0) > 0
        ? `, slowing for corners at ${values["lateral-g"]} g`
        : "");
  }

  console.log(bold(`\n${route.name ?? file}`));
  const snapLine = describeSnap(snap);
  if (snapLine) console.log(snapLine);
  console.log(
    dim(
      `${(route.length / 1000).toFixed(2)} km, ${route.corners.length} corners - ${header}`,
    ),
  );
  console.log("");

  for (const call of calls) {
    const t = clock((call.time - start) / 1000);
    const where = call.riderDist !== undefined ? metres(call.riderDist).padStart(7) : "      -";
    const speed = call.speed !== undefined ? kmh(call.speed).padStart(7) : "      -";
    const ahead =
      call.distance !== undefined
        ? dim(` (${metres(call.distance)} / ${call.timeToCorner!.toFixed(1)} s ahead)`)
        : "";
    console.log(`${dim(t.padStart(6))}  ${where}  ${speed}  ${colourCall(call)}${ahead}`);
  }

  const cornerCalls = calls.filter((c) => c.kind === "corner");
  const announced = new Set(cornerCalls.flatMap((c) => c.cornerIds));
  const missed = route.corners.filter((c) => !announced.has(c.id));
  console.log(bold("\nSummary"));
  console.log(`  calls           ${calls.length} (${cornerCalls.length} corner calls)`);
  console.log(`  corners called  ${announced.size} of ${route.corners.length}`);
  if (missed.length > 0) {
    console.log(
      dim(
        `  not called      ${missed.map((c) => `#${c.id} ${c.grade} ${c.direction}`).join(", ")}`,
      ),
    );
  }

  if (typeof values["out"] === "string") {
    writeFileSync(values["out"], JSON.stringify(calls, null, 2));
    console.log(dim(`\nWrote ${values["out"]}`));
  }
}
