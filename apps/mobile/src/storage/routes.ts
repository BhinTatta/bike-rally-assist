/**
 * Saved routes.
 *
 * An analysed route is megabytes for a long ride (one point every 5 m), which
 * is far too big for AsyncStorage. So the route itself lives in a file and
 * AsyncStorage only holds a small index - small enough that the route list,
 * thumbnails included, never opens a route file at all.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  analyseRoute,
  annotateRoute,
  DEFAULT_CONFIG,
  mergeFeatures,
  parseGpx,
  resolveConfig,
  routeStats,
} from "@rally/engine";
import type { AnalysedRoute, DeepPartial, EngineConfig, RouteStats } from "@rally/engine";
import { applyMapFeatures, snapRouteToOsm } from "@rally/osm";

import { DEMO_ROUTE_GPX, DEMO_ROUTE_NAME } from "../demo/sampleRoute";
import { routeThumbnail } from "../ui/routeShapes";
import { readText, removeFile, writeText } from "./files";
import { FileStore } from "./osmStore";

export interface RouteSummary {
  id: string;
  name: string;
  /** Epoch ms. */
  importedAt: number;
  lengthMeters: number;
  stats: RouteStats;
  /** How the geometry was obtained. */
  source: "gpx" | "osm-snapped";
  /** Road names from OSM, when snapping worked. */
  roadNames: string[];
  /** The route's outline for the list, [x0, y0, x1, y1, ...] in a 0-1 box. */
  thumb?: number[];
  /** Total climb, metres, when the GPX had elevation. */
  ascent?: number;
  /** Crests, speed breakers, surface changes... found along the route. */
  hazardCount?: number;
  /** The bundled demo stage rather than something the rider imported. */
  demo?: boolean;
  /** Epoch ms of the last ride on it. */
  lastRiddenAt?: number;
}

const INDEX_KEY = "rally.routes.index.v1";

const routePath = (id: string): string => `routes/${id}.json`;

export async function listRoutes(): Promise<RouteSummary[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const list = raw ? (JSON.parse(raw) as RouteSummary[]) : [];
    return list.sort((a, b) => b.importedAt - a.importedAt);
  } catch {
    return [];
  }
}

async function writeIndex(list: RouteSummary[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

export async function getRouteSummary(id: string): Promise<RouteSummary | null> {
  return (await listRoutes()).find((route) => route.id === id) ?? null;
}

/**
 * Routes saved by the first version of the app have no sections, hazards or
 * caution flags. They are worked out again on load, from geometry already on
 * disk, so an old import behaves exactly like a fresh one.
 */
function upgrade(route: AnalysedRoute): AnalysedRoute {
  if (route.sections === undefined) annotateRoute(route, DEFAULT_CONFIG.features);
  return route;
}

export async function loadRoute(id: string): Promise<AnalysedRoute | null> {
  try {
    const text = await readText(routePath(id));
    if (text === null) return null;
    return upgrade(JSON.parse(text) as AnalysedRoute);
  } catch {
    return null;
  }
}

/**
 * Write a route with the precision it actually has.
 *
 * A double prints as seventeen digits; a position is good to a centimetre at
 * seven decimals. Trimming roughly halves the file, which is half the time
 * spent parsing it back on every ride start.
 */
function serialise(route: AnalysedRoute): string {
  const round = (value: number, places: number): number => {
    const scale = 10 ** places;
    return Math.round(value * scale) / scale;
  };
  return JSON.stringify({
    ...route,
    points: route.points.map((p) => ({
      lat: round(p.lat, 7),
      lon: round(p.lon, 7),
      dist: round(p.dist, 2),
      curvature: round(p.curvature, 6),
      heading: round(p.heading, 1),
      ...(p.ele !== undefined ? { ele: round(p.ele, 1) } : {}),
    })),
  });
}

function summarise(
  id: string,
  route: AnalysedRoute,
  extra: Pick<RouteSummary, "name" | "importedAt" | "source" | "roadNames"> & { demo?: boolean },
): RouteSummary {
  const summary: RouteSummary = {
    id,
    name: extra.name,
    importedAt: extra.importedAt,
    lengthMeters: route.length,
    stats: routeStats(route),
    source: extra.source,
    roadNames: extra.roadNames,
    thumb: routeThumbnail(route),
    hazardCount: route.features?.length ?? 0,
  };
  if (route.ascent !== undefined) summary.ascent = route.ascent;
  if (extra.demo) summary.demo = true;
  return summary;
}

/** Fill in thumbnails for routes imported before the list drew them. */
export async function backfillSummaries(): Promise<boolean> {
  const index = await listRoutes();
  let changed = false;
  for (let i = 0; i < index.length; i++) {
    const entry = index[i]!;
    if (entry.thumb !== undefined) continue;
    const route = await loadRoute(entry.id);
    if (!route) continue;
    index[i] = {
      ...summarise(entry.id, route, entry),
      ...(entry.lastRiddenAt !== undefined ? { lastRiddenAt: entry.lastRiddenAt } : {}),
    };
    changed = true;
  }
  if (changed) await writeIndex(index);
  return changed;
}

export async function deleteRoute(id: string): Promise<void> {
  removeFile(routePath(id));
  await writeIndex((await listRoutes()).filter((r) => r.id !== id));
}

export async function renameRoute(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const route = await loadRoute(id);
  if (route) {
    route.name = trimmed;
    writeText(routePath(id), serialise(route));
  }
  await writeIndex(
    (await listRoutes()).map((r) => (r.id === id ? { ...r, name: trimmed } : r)),
  );
}

export async function markRidden(id: string): Promise<void> {
  await writeIndex(
    (await listRoutes()).map((r) => (r.id === id ? { ...r, lastRiddenAt: Date.now() } : r)),
  );
}

export interface ImportOptions {
  /** Try to snap the GPX onto OSM road geometry first. */
  useOsm: boolean;
  engineConfig?: DeepPartial<EngineConfig>;
  onProgress?: (message: string) => void;
  /** Lets the rider skip the road-data step without losing the import. */
  signal?: AbortSignal;
}

export interface ImportResult {
  summary: RouteSummary;
  route: AnalysedRoute;
  /** Set when OSM snapping was attempted but not used. */
  osmNote?: string;
}

/** Let the screen draw the progress message before the next heavy step. */
const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

const newId = (): string =>
  `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

/**
 * Parse a GPX file, optionally snap it to OSM, analyse it and save it.
 */
export async function importGpx(
  xml: string,
  fallbackName: string,
  options: ImportOptions,
): Promise<ImportResult> {
  options.onProgress?.("Reading the track…");
  await breathe();
  const parsed = parseGpx(xml);
  if (parsed.points.length < 2) {
    throw new Error(
      "That file has no track or route in it. Export it again as a GPX track from your planner.",
    );
  }

  let geometry = parsed.points;
  let source: RouteSummary["source"] = "gpx";
  let roadNames: string[] = [];
  let osmNote: string | undefined;
  let snap: Awaited<ReturnType<typeof snapRouteToOsm>> | null = null;

  if (options.useOsm) {
    options.onProgress?.("Looking for road data…");
    await breathe();
    snap = await snapRouteToOsm(parsed.points, {
      store: new FileStore(),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (snap.usedOsm) {
      geometry = snap.geometry;
      source = "osm-snapped";
      roadNames = [...new Set(snap.roadNames)].slice(0, 6);
    } else {
      osmNote = snap.quality.reason ?? snap.error;
    }
  }

  options.onProgress?.("Finding corners…");
  await breathe();
  const name = (parsed.name ?? fallbackName).trim() || "Untitled route";
  const route = analyseRoute(geometry, options.engineConfig, name);
  if (route.length < 50) {
    throw new Error("That track is only a few metres long - there is nothing to call.");
  }
  if (snap?.usedOsm) applyMapFeatures(route, snap);

  options.onProgress?.("Saving…");
  await breathe();
  const id = newId();
  const summary = summarise(id, route, { name, importedAt: Date.now(), source, roadNames });
  writeText(routePath(id), serialise(route));
  await writeIndex([summary, ...(await listRoutes())]);

  const result: ImportResult = { summary, route };
  if (osmNote !== undefined) result.osmNote = osmNote;
  return result;
}

/**
 * Install the bundled demo stage (once), and return it.
 *
 * It is the synthetic ghat climb the engine is tested against, with a speed
 * breaker and a stretch of broken road added so that a first preview shows
 * what a hazard call sounds like.
 */
export async function importDemoRoute(): Promise<RouteSummary> {
  const existing = (await listRoutes()).find((route) => route.demo);
  if (existing) return existing;
  const parsed = parseGpx(DEMO_ROUTE_GPX);
  const route = analyseRoute(parsed.points, undefined, DEMO_ROUTE_NAME);
  mergeFeatures(route, [
    { kind: "bump", dist: 240, label: "speed breaker", source: "osm" },
    { kind: "surface", dist: 1440, endDist: 1620, label: "broken road", source: "osm" },
  ]);
  const id = `demo-${newId()}`;
  const summary = summarise(id, route, {
    name: DEMO_ROUTE_NAME,
    importedAt: Date.now(),
    source: "gpx",
    roadNames: [],
    demo: true,
  });
  writeText(routePath(id), serialise(route));
  await writeIndex([summary, ...(await listRoutes())]);
  return summary;
}

/** Re-analyse a stored route after the engine or its thresholds changed. */
export async function rebuildRoute(
  id: string,
  engineConfig?: DeepPartial<EngineConfig>,
): Promise<AnalysedRoute | null> {
  const route = await loadRoute(id);
  if (!route) return null;
  const rebuilt = analyseRoute(route.points, engineConfig, route.name);
  // Map-derived hazards cannot be recomputed from points alone: carry them over.
  const kept = (route.features ?? []).filter((f) => f.source === "osm");
  if (kept.length > 0) {
    rebuilt.features = [...(rebuilt.features ?? []), ...kept];
    annotateRoute(rebuilt, resolveConfig(engineConfig).features);
  }
  writeText(routePath(id), serialise(rebuilt));
  const index = await listRoutes();
  await writeIndex(
    index.map((r) =>
      r.id === id
        ? {
            ...r,
            stats: routeStats(rebuilt),
            lengthMeters: rebuilt.length,
            thumb: routeThumbnail(rebuilt),
            hazardCount: rebuilt.features?.length ?? 0,
          }
        : r,
    ),
  );
  return rebuilt;
}
