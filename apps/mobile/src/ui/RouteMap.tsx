/**
 * The route map: MapLibre, no API key, corners coloured by grade.
 *
 * Tiles come from OpenFreeMap, which serves a full planet vector style free
 * and without registration. If it cannot be reached (no signal in the ghats)
 * the map falls back to a plain dark background and the route still draws -
 * the shape of the road is the useful part anyway.
 */

import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Camera, GeoJSONSource, Layer, Map } from "@maplibre/maplibre-react-native";
import type { AnalysedRoute } from "@rally/engine";
import type { FeatureCollection, LineString, Point } from "geojson";

import { colors, gradeColor, radius, spacing } from "./theme";

const TILE_STYLE = "https://tiles.openfreemap.org/styles/liberty";

/** A style with no tiles at all, for when there is no connection. */
const OFFLINE_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: "bg", type: "background" as const, paint: { "background-color": colors.bg } }],
};

/** Split the route into one line feature per corner, plus the straights. */
function toFeatures(route: AnalysedRoute): {
  lines: FeatureCollection<LineString>;
  apexes: FeatureCollection<Point>;
} {
  const between = (from: number, to: number): [number, number][] =>
    route.points
      .filter((p) => p.dist >= from && p.dist <= to)
      .map((p) => [p.lon, p.lat] as [number, number]);

  const features: FeatureCollection<LineString>["features"] = [];
  let cursor = 0;
  for (const corner of route.corners) {
    if (corner.startDist > cursor) {
      const coordinates = between(cursor, corner.startDist);
      if (coordinates.length > 1) {
        features.push({
          type: "Feature",
          properties: { color: colors.textDim, width: 3 },
          geometry: { type: "LineString", coordinates },
        });
      }
    }
    const coordinates = between(corner.startDist, corner.endDist);
    if (coordinates.length > 1) {
      features.push({
        type: "Feature",
        properties: { color: gradeColor(corner.grade), width: 6, grade: corner.grade },
        geometry: { type: "LineString", coordinates },
      });
    }
    cursor = corner.endDist;
  }
  if (cursor < route.length) {
    const coordinates = between(cursor, route.length);
    if (coordinates.length > 1) {
      features.push({
        type: "Feature",
        properties: { color: colors.textDim, width: 3 },
        geometry: { type: "LineString", coordinates },
      });
    }
  }

  return {
    lines: { type: "FeatureCollection", features },
    apexes: {
      type: "FeatureCollection",
      features: route.corners.map((corner) => ({
        type: "Feature",
        properties: { color: gradeColor(corner.grade) },
        geometry: { type: "Point", coordinates: [corner.apex.lon, corner.apex.lat] },
      })),
    },
  };
}

function boundsOf(route: AnalysedRoute): [number, number, number, number] {
  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;
  for (const p of route.points) {
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
  }
  return [west, south, east, north];
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
  const { lines, apexes } = useMemo(() => toFeatures(route), [route]);
  const bounds = useMemo(() => boundsOf(route), [route]);
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
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={tilesFailed ? OFFLINE_STYLE : TILE_STYLE}
        logo={false}
        attributionPosition={{ bottom: 8, right: 8 }}
        onDidFailLoadingMap={() => setTilesFailed(true)}
      >
        <Camera
          initialViewState={{ bounds, padding: { top: 40, right: 40, bottom: 40, left: 40 } }}
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
      </Map>
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
