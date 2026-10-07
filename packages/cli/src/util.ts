/** Small shared helpers for the CLI commands. */

import { readFileSync } from "node:fs";
import { analyseGpx, analyseRoute, parseGpx } from "@rally/engine";
import type { AnalysedRoute, DeepPartial, EngineConfig } from "@rally/engine";
import {
  corridorBoxes,
  matchToRoads,
  parseOverpass,
  resolveOsmConfig,
  snapRouteToOsm,
  type SnapResult,
} from "@rally/osm";
import { FileStore, defaultCacheDir } from "./osmStore.js";

/** ANSI colours, skipped when the output is not a terminal. */
const useColour = process.stdout.isTTY === true && !process.env["NO_COLOR"];
const code = (n: number) => (s: string) => (useColour ? `\u001b[${n}m${s}\u001b[0m` : s);
export const bold = code(1);
export const dim = code(2);
export const red = code(31);
export const green = code(32);
export const yellow = code(33);
export const cyan = code(36);
export const magenta = code(35);

function readGpx(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read GPX file ${path}: ${(error as Error).message}`);
  }
}

export function loadRoute(
  path: string,
  overrides?: DeepPartial<EngineConfig>,
): AnalysedRoute {
  return analyseGpx(readGpx(path), overrides);
}

/**
 * Load a route, optionally snapping it onto OSM road geometry first.
 *
 * Without `--osm` this is identical to `loadRoute`. With it, the corridor's
 * roads are fetched once (then cached on disk, so later runs are offline) and
 * the GPX is map-matched onto them; a poor match falls back to the raw GPX and
 * says why.
 */
export async function loadRouteMaybeOsm(
  path: string,
  values: Record<string, unknown>,
  overrides?: DeepPartial<EngineConfig>,
): Promise<{ route: AnalysedRoute; snap?: SnapResult }> {
  const osmFile = typeof values["osm-file"] === "string" ? values["osm-file"] : undefined;
  if (values["osm"] !== true && !osmFile) return { route: loadRoute(path, overrides) };

  const parsed = parseGpx(readGpx(path));
  if (parsed.points.length < 2) {
    throw new Error("GPX contains fewer than 2 usable points");
  }

  // A saved Overpass response: lets you work on matching without hammering
  // (or needing) the Overpass API. `rally osm-fetch` writes these.
  if (osmFile) {
    const config = resolveOsmConfig();
    const network = parseOverpass(readGpx(osmFile), corridorBoxes(parsed.points, config));
    console.error(dim(`  Loaded ${network.ways.length} ways from ${osmFile}`));
    const match = matchToRoads(parsed.points, network);
    return {
      route: analyseRoute(match.geometry, overrides, parsed.name),
      snap: { ...match, fromCache: true },
    };
  }

  const cacheDir =
    typeof values["cache-dir"] === "string" ? values["cache-dir"] : defaultCacheDir();
  const snap = await snapRouteToOsm(parsed.points, {
    store: new FileStore(cacheDir),
    cacheOnly: values["offline"] === true,
    onProgress: (message) => console.error(dim(`  ${message}`)),
  });
  const route = analyseRoute(snap.geometry, overrides, parsed.name);
  return { route, snap };
}

/** One line summarising what the OSM layer did, for every command. */
export function describeSnap(snap: SnapResult | undefined): string | undefined {
  if (!snap) return undefined;
  if (!snap.usedOsm) return yellow(`OSM snapping not used: ${snap.quality.reason}`);
  const source = snap.fromCache ? "cached" : "fetched";
  const names = snap.roadNames.length > 0 ? ` via ${snap.roadNames.join(", ")}` : "";
  return green(
    `Snapped to ${snap.quality.wayCount} OSM way(s) (${source}), ` +
      `mean offset ${snap.quality.meanOffset.toFixed(1)} m${names}`,
  );
}

/** Render rows as a fixed-width table. */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: string[]): string =>
    cells.map((c, i) => (c ?? "").padEnd(widths[i]!)).join("  ").trimEnd();
  const divider = widths.map((w) => "-".repeat(w)).join("  ");
  return [bold(line(headers)), dim(divider), ...rows.map(line)].join("\n");
}

/** "1:23.4" from seconds. */
export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export const metres = (m: number): string => `${Math.round(m)} m`;
export const kmh = (mps: number): string => `${(mps * 3.6).toFixed(0)} km/h`;

/** Colour a grade so a long corner table is scannable. */
export function colourGrade(grade: string): string {
  switch (grade) {
    case "hairpin":
      return magenta(grade);
    case "very sharp":
      return red(grade);
    case "sharp":
      return yellow(grade);
    case "medium":
      return cyan(grade);
    default:
      return dim(grade);
  }
}

/**
 * Build a config override from the common CLI flags, so every command tunes the
 * engine the same way.
 */
export function configFromFlags(values: Record<string, unknown>): DeepPartial<EngineConfig> {
  const geometry: Record<string, unknown> = {};
  const runtime: Record<string, unknown> = {};
  const num = (v: unknown): number | undefined =>
    v === undefined ? undefined : Number(v);

  if (values["spacing"] !== undefined) geometry["resampleMeters"] = num(values["spacing"]);
  if (values["smooth"] !== undefined) geometry["smoothWindow"] = num(values["smooth"]);
  if (values["span"] !== undefined) geometry["curvatureSpanMeters"] = num(values["span"]);
  if (values["lead"] !== undefined) runtime["leadSeconds"] = num(values["lead"]);
  if (values["lag"] !== undefined) runtime["lagSeconds"] = num(values["lag"]);
  if (values["rally"] === true) runtime["rallyMode"] = true;
  if (values["max-number"] !== undefined)
    runtime["maxRallyNumberToCall"] = num(values["max-number"]);

  const override: DeepPartial<EngineConfig> = {};
  if (Object.keys(geometry).length > 0) override.geometry = geometry as never;
  if (Object.keys(runtime).length > 0) override.runtime = runtime as never;
  return override;
}

export const COMMON_FLAG_HELP = `
  --osm              snap the GPX onto OSM road geometry before analysing
  --osm-file <file>  match against a saved Overpass response instead of fetching
  --offline          with --osm, use only what is already cached
  --cache-dir <dir>  where to cache fetched roads (default ./.rally-cache)
  --spacing <m>      resample spacing (default 5)
  --smooth <n>       smoothing window in samples, odd (default 13)
  --span <m>         curvature measurement half-span (default 10)
  --lead <s>         warning lead time (default 5)
  --lag <s>          speech/system lag compensation (default 1)
  --rally            rally pacenote mode ("Right 3, 80")
  --max-number <n>   only call corners with rally number <= n (1 = tightest)`;
