/**
 * `rally corners <gpx>` - analyse a GPX file and print its corners.
 *
 * Also writes corners.json so the numbers can be diffed between engine tweaks.
 */

import { writeFileSync } from "node:fs";
import { routeStats } from "@rally/engine";
import {
  bold,
  colourGrade,
  configFromFlags,
  describeSnap,
  dim,
  loadRouteMaybeOsm,
  metres,
  table,
} from "../util.js";

export async function cornersCommand(
  file: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { route, snap } = await loadRouteMaybeOsm(file, values, configFromFlags(values));
  const stats = routeStats(route);

  console.log(bold(`\n${route.name ?? file}`));
  const snapLine = describeSnap(snap);
  if (snapLine) console.log(snapLine);
  console.log(
    dim(
      `${(route.length / 1000).toFixed(2)} km, ${route.points.length} samples at ${route.spacing} m spacing`,
    ),
  );

  const rows = route.corners.map((c) => [
    String(c.id),
    `${(c.startDist / 1000).toFixed(2)}`,
    metres(c.length),
    c.direction,
    colourGrade(c.grade),
    String(c.rallyNumber),
    Number.isFinite(c.minRadius) ? metres(c.minRadius) : "-",
    `${c.headingChange.toFixed(0)}°`,
    c.modifiers.join(", "),
  ]);

  if (rows.length === 0) {
    console.log(dim("\nNo corners found. Is this a highway?"));
  } else {
    console.log(
      "\n" +
        table(
          ["#", "km", "length", "dir", "grade", "no.", "min R", "turn", "modifiers"],
          rows,
        ),
    );
  }

  console.log(bold("\nSummary"));
  console.log(`  corners         ${stats.cornerCount} (${stats.cornersPerKm.toFixed(1)} per km)`);
  for (const [grade, count] of Object.entries(stats.byGrade)) {
    console.log(`  ${grade.padEnd(15)} ${count}`);
  }
  if (stats.twistiestSection) {
    const t = stats.twistiestSection;
    console.log(
      `  twistiest 1 km  ${(t.startDist / 1000).toFixed(2)}-${(t.endDist / 1000).toFixed(2)} km ` +
        `(${t.cornerCount} corners, ${t.headingChange.toFixed(0)}° of turning)`,
    );
  }

  const out = typeof values["out"] === "string" ? values["out"] : "corners.json";
  writeFileSync(
    out,
    JSON.stringify(
      { name: route.name, length: route.length, stats, corners: route.corners },
      null,
      2,
    ),
  );
  console.log(dim(`\nWrote ${out}`));
}
