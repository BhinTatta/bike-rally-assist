/**
 * The road ahead, as seen from the saddle.
 *
 * A strip of the next few hundred metres with the direction of travel pointing
 * up the screen, so a left-hander is drawn bending left whichever way the
 * route happens to run on the compass. Corners are coloured by grade and the
 * rider sits at the bottom. It answers the question a pacenote cannot: what
 * comes after the corner being called.
 */

import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Polygon, Rect, Stop } from "react-native-svg";
import type { AnalysedRoute } from "@rally/engine";

import { buildAheadShapes } from "./routeShapes";
import { colors, featureColors, gradeColor, radius } from "./theme";

export function RoadAhead({
  route,
  dist,
  direction,
  speed,
  width,
  height,
}: {
  route: AnalysedRoute;
  /** Rider's distance along the route, metres. */
  dist: number;
  direction: 1 | -1;
  /** m/s; the faster you go, the further ahead the strip looks. */
  speed: number;
  width: number;
  height: number;
}) {
  // Roughly fifteen seconds of road, within sensible limits. Rounded so the
  // scale steps occasionally rather than breathing with every fix.
  const ahead = Math.max(250, Math.min(700, Math.round((speed * 15) / 50) * 50));
  const behind = 30;
  // Rebuild only when the rider has moved a few metres.
  const bucket = Math.round(dist / 4);
  const shapes = useMemo(
    () => buildAheadShapes(route, bucket * 4, direction, ahead, behind),
    [route, bucket, direction, ahead],
  );

  // The road ahead fills the height; x is given a fixed half-width in metres
  // and anything swinging wider than that simply leaves the strip.
  const metresPerPixel = (ahead + behind) / height;
  const viewWidth = width * metresPerPixel;
  const viewBox = `${-viewWidth / 2} ${-ahead} ${viewWidth} ${ahead + behind}`;
  const px = metresPerPixel;

  return (
    <View style={[styles.container, { width, height }]}>
      <Svg width={width} height={height} viewBox={viewBox}>
        <Defs>
          <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.surface} stopOpacity={1} />
            <Stop offset="0.22" stopColor={colors.surface} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path
          d={shapes.road}
          stroke={colors.roadEdge}
          strokeWidth={17 * px}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <Path
          d={shapes.road}
          stroke={colors.road}
          strokeWidth={11 * px}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {shapes.corners.map(({ grade, d }) => (
          <Path
            key={grade}
            d={d}
            stroke={gradeColor(grade)}
            strokeWidth={11 * px}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
        {shapes.features.map(({ feature, x, y }) => (
          <Circle
            key={feature.id}
            cx={x}
            cy={y}
            r={7 * px}
            fill={featureColors[feature.kind]}
            stroke={colors.bg}
            strokeWidth={2 * px}
          />
        ))}
        {/* Fade the far end out, so the road dissolves instead of stopping. */}
        <Rect x={-viewWidth / 2} y={-ahead} width={viewWidth} height={ahead + behind} fill="url(#fade)" />
        <Polygon
          points={`0,${-13 * px} ${9 * px},${9 * px} 0,${4 * px} ${-9 * px},${9 * px}`}
          fill={colors.text}
          stroke={colors.bg}
          strokeWidth={2 * px}
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
});
