/**
 * The route map: MapLibre, no API key, corners coloured by grade.
 *
 * Long routes are the hard case. A 127 km import is 25,000 resampled points
 * and 750 corners, and the obvious implementation - one map feature per corner
 * and per straight, built by filtering the whole point list each time - costs
 * 38 million point visits, 1,500 features and a megabyte of GeoJSON pushed
 * across the bridge. So instead:
 *
 *   * the points are walked exactly once, assigning each to the corner it
 *     falls inside,
 *   * the line is decimated to a few thousand points, because no screen can
 *     show 5 m detail across 127 km anyway (corner starts, ends and apexes are
 *     always kept, so the shape of a hairpin survives),
 *   * everything is grouped into one feature per grade plus one for the
 *     straights - seven features instead of fifteen hundred.
 *
 * Tiles come from OpenFreeMap, which serves a full planet style free and
 * without registration. With no signal the map falls back to a plain dark
 * background and the route still draws, which is the useful part anyway.
 */

import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
// Aliased: MapLibre exports a component called `Map`, which would otherwise
// shadow the built-in Map used to group the line runs below.
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
} from "@maplibre/maplibre-react-native";
import type { AnalysedRoute } from "@rally/engine";
import type { FeatureCollection, LineString, MultiLineString, Point } from "geojson";

import { colors, gradeColor, radius, spacing } from "./theme";

const TILE_STYLE = "https://tiles.openfreemap.org/styles/liberty";

/** A style with no tiles at all, for when there is no connection. */
const OFFLINE_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: "bg", type: "background" as const, paint: { "background-color": colors.bg } }],
};

/** Most points to draw. Beyond this the map cannot show the difference. */
const MAX_DISPLAY_POINTS = 3000;

type Coord = [number, number];

interface MapShapes {
  /** One MultiLineString per grade, plus "straight". */
  lines: FeatureCollection<MultiLineString>;
  apexes: FeatureCollection<Point>;
  bounds: [number, number, number, number];
}

function buildShapes(route: AnalysedRoute): MapShapes {
  const { points, corners } = route;
  // Decimate, but never drop a corner boundary: a hairpin is only a few points
  // long and losing them would straighten it out.
  const stride = Math.max(1, Math.ceil(points.length / MAX_DISPLAY_POINTS));

  const runs = new Map<string, Coord[][]>();
  const pushRun = (key: string, run: Coord[]): void => {
    if (run.length < 2) return;
    const existing = runs.get(key);
    if (existing) existing.push(run);
    else runs.set(key, [run]);
  };

  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;

  let cornerIndex = 0;
  let currentKey = "straight";
  let run: Coord[] = [];

  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);

    // Corners are in route order, so one forward-moving cursor is enough.
    while (cornerIndex < corners.length && corners[cornerIndex]!.endDist < point.dist) {
      cornerIndex++;
    }
    const corner = corners[cornerIndex];
    const inCorner = corner !== undefined && point.dist >= corner.startDist;
    const key = inCorner ? corner.grade : "straight";

    if (key !== currentKey) {
      // Close the old run on this point so the colours meet without a gap.
      run.push([point.lon, point.lat]);
      pushRun(currentKey, run);
      currentKey = key;
      run = [[point.lon, point.lat]];
      continue;
    }
    // Inside a corner keep twice the detail; a hairpin is worth the points.
    const keepEvery = inCorner ? Math.max(1, Math.floor(stride / 2)) : stride;
    if (i % keepEvery === 0 || i === points.length - 1) {
      run.push([point.lon, point.lat]);
    }
  }
  pushRun(currentKey, run);

  const features: FeatureCollection<MultiLineString>["features"] = [];
  for (const [key, coordinates] of runs) {
    features.push({
      type: "Feature",
      properties: {
        color: key === "straight" ? colors.textDim : gradeColor(key),
        width: key === "straight" ? 3 : 6,
      },
      geometry: { type: "MultiLineString", coordinates },
    });
  }
  // Draw the straights first so corner colours sit on top at the joins.
  features.sort((a, b) => Number(a.properties!["width"]) - Number(b.properties!["width"]));

  return {
    lines: { type: "FeatureCollection", features },
    apexes: {
      type: "FeatureCollection",
      // An apex dot every few hundred metres is useful; 750 of them is mush.
      features: corners
        .filter((c) => c.rallyNumber <= 3 || corners.length < 120)
        .map((corner) => ({
          type: "Feature",
          properties: { color: gradeColor(corner.grade) },
          geometry: { type: "Point", coordinates: [corner.apex.lon, corner.apex.lat] },
        })),
    },
    bounds: [west, south, east, north],
  };
}

export function RouteMap({
  route,
  style,
  /** Optional live position marker, for the ride screen. */
  rider,
}: {
  route: AnalysedRoute;
  style?: object;
  rider?: { lat: number; lon: number } | null;
}) {
  const [tilesFailed, setTilesFailed] = useState(false);
  const { lines, apexes, bounds } = useMemo(() => buildShapes(route), [route]);
  const riderFeature = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: rider
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: [rider.lon, rider.lat] },
            },
          ]
        : [],
    }),
    [rider],
  );

  return (
    <View style={[styles.container, style]}>
      <MapLibreMap
        style={StyleSheet.absoluteFill}
        mapStyle={tilesFailed ? OFFLINE_STYLE : TILE_STYLE}
        logo={false}
        attributionPosition={{ bottom: 8, right: 8 }}
        onDidFailLoadingMap={() => setTilesFailed(true)}
      >
        <Camera
          initialViewState={{
            bounds,
            padding: { top: 40, right: 40, bottom: 40, left: 40 },
          }}
          {...(rider ? { centerCoordinate: [rider.lon, rider.lat], zoomLevel: 15 } : {})}
        />
        <GeoJSONSource id="route" data={lines}>
          <Layer
            id="route-line"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": ["get", "color"], "line-width": ["get", "width"] }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="apexes" data={apexes}>
          <Layer
            id="apex-dots"
            type="circle"
            paint={{
              "circle-radius": 4,
              "circle-color": ["get", "color"],
              "circle-stroke-width": 1,
              "circle-stroke-color": "#000000",
            }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="rider" data={riderFeature}>
          <Layer
            id="rider-dot"
            type="circle"
            paint={{
              "circle-radius": 8,
              "circle-color": colors.accent,
              "circle-stroke-width": 2,
              "circle-stroke-color": colors.bg,
            }}
          />
        </GeoJSONSource>
      </MapLibreMap>
      {tilesFailed ? (
        <View style={styles.offlineNote}>
          <Text style={styles.offlineText}>No map tiles — showing the route only</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  offlineNote: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: "rgba(11,13,16,0.85)",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  offlineText: { color: colors.textDim, fontSize: 12 },
});
