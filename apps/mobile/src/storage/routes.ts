/**
 * Saved routes.
 *
 * An analysed route is a few hundred kilobytes for a long ride (one point
 * every 5 m), which is far too big for AsyncStorage. So the route itself lives
 * in a file and AsyncStorage only holds a small index.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { analyseRoute, parseGpx, routeStats } from "@rally/engine";
import type { AnalysedRoute, DeepPartial, EngineConfig, RouteStats } from "@rally/engine";
import { snapRouteToOsm } from "@rally/osm";
import { AsyncStorageStore } from "./osmStore";

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
}

const INDEX_KEY = "rally.routes.index.v1";
const ROUTES_DIR = "routes";

function routesDirectory(): Directory {
  const dir = new Directory(Paths.document, ROUTES_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

const routeFile = (id: string): File => new File(routesDirectory(), `${id}.json`);

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

export async function loadRoute(id: string): Promise<AnalysedRoute | null> {
  try {
    const file = routeFile(id);
    if (!file.exists) return null;
    return JSON.parse(await file.text()) as AnalysedRoute;
  } catch {
    return null;
  }
}

export async function deleteRoute(id: string): Promise<void> {
  try {
    const file = routeFile(id);
    if (file.exists) file.delete();
  } catch {
    // The index entry still goes, so the route disappears from the list.
  }
  await writeIndex((await listRoutes()).filter((r) => r.id !== id));
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

/**
 * Parse a GPX file, optionally snap it to OSM, analyse it and save it.
 */
export async function importGpx(
  xml: string,
  fallbackName: string,
  options: ImportOptions,
): Promise<ImportResult> {
  const parsed = parseGpx(xml);
  if (parsed.points.length < 2) {
    throw new Error("That file has no usable track or route points.");
  }

  let geometry = parsed.points;
  let source: RouteSummary["source"] = "gpx";
  let roadNames: string[] = [];
  let osmNote: string | undefined;

  if (options.useOsm) {
    options.onProgress?.("Looking for OSM road data…");
    const snap = await snapRouteToOsm(parsed.points, {
      store: new AsyncStorageStore(),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (snap.usedOsm) {
      geometry = snap.geometry;
      source = "osm-snapped";
      roadNames = snap.roadNames;
    } else {
      osmNote = snap.quality.reason ?? snap.error;
    }
  }

  options.onProgress?.("Finding corners…");
  const route = analyseRoute(geometry, options.engineConfig, parsed.name ?? fallbackName);
  const summary: RouteSummary = {
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: route.name ?? fallbackName,
    importedAt: Date.now(),
    lengthMeters: route.length,
    stats: routeStats(route),
    source,
    roadNames,
  };

  const file = routeFile(summary.id);
  file.create({ overwrite: true });
  file.write(JSON.stringify(route));
  await writeIndex([summary, ...(await listRoutes())]);

  const result: ImportResult = { summary, route };
  if (osmNote !== undefined) result.osmNote = osmNote;
  return result;
}

/** Re-analyse a stored route after the engine or its thresholds changed. */
export async function rebuildRoute(
  id: string,
  engineConfig?: DeepPartial<EngineConfig>,
): Promise<AnalysedRoute | null> {
  const route = await loadRoute(id);
  if (!route) return null;
  const rebuilt = analyseRoute(route.points, engineConfig, route.name);
  const file = routeFile(id);
  file.create({ overwrite: true });
  file.write(JSON.stringify(rebuilt));
  const index = await listRoutes();
  await writeIndex(
    index.map((r) =>
      r.id === id ? { ...r, stats: routeStats(rebuilt), lengthMeters: rebuilt.length } : r,
    ),
  );
  return rebuilt;
}
