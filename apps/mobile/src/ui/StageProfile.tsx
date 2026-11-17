/**
 * The whole route on one line: what kind of road it is, where it climbs, and
 * where the corners are.
 *
 * Three bands, top to bottom:
 *   - a tick for every corner, coloured by grade (the dense patches are where
 *     the fun is),
 *   - the elevation profile, when the GPX had one,
 *   - the character of the road, as coloured blocks.
 */

import { useMemo, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Line, Path, Rect } from "react-native-svg";
import type { AnalysedRoute } from "@rally/engine";

import { buildProfile } from "./routeShapes";
import { alpha, colors, gradeColor, sectionColors, tabular } from "./theme";

const TICKS_HEIGHT = 20;
const SECTION_HEIGHT = 8;
const GAP = 5;

export function StageProfile({
  route,
  height = 104,
  position = null,
}: {
  route: AnalysedRoute;
  height?: number;
  /** Where the rider is, metres along the route. */
  position?: number | null;
}) {
  const [width, setWidth] = useState(0);
  const elevationHeight = height - TICKS_HEIGHT - SECTION_HEIGHT - GAP * 2;
  const profile = useMemo(
    () => (width > 0 ? buildProfile(route, width, elevationHeight) : null),
    [route, width, elevationHeight],
  );
  const onLayout = (event: LayoutChangeEvent): void => setWidth(event.nativeEvent.layout.width);
  const x = (dist: number): number => (route.length > 0 ? (dist / route.length) * width : 0);
  const sections = route.sections ?? [];
  const kmMarks = useMemo(() => {
    const total = route.length / 1000;
    const step = total > 120 ? 50 : total > 60 ? 20 : total > 25 ? 10 : total > 10 ? 5 : total > 4 ? 2 : 1;
    const marks: number[] = [];
    for (let k = step; k < total - step * 0.3; k += step) marks.push(k);
    return marks;
  }, [route.length]);

  return (
    <View>
      <View style={{ height }} onLayout={onLayout}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            {route.corners.map((corner) => (
              <Line
                key={corner.id}
                x1={x(corner.apexDist)}
                x2={x(corner.apexDist)}
                // Tighter corners stand taller.
                y1={TICKS_HEIGHT - 4 - (7 - corner.rallyNumber) * 2.4}
                y2={TICKS_HEIGHT}
                stroke={gradeColor(corner.grade)}
                strokeWidth={corner.rallyNumber <= 2 ? 2 : 1.3}
                strokeOpacity={0.95}
              />
            ))}
            {profile?.elevation ? (
              <Path
                d={profile.elevation}
                transform={`translate(0 ${TICKS_HEIGHT + GAP})`}
                fill={alpha(colors.info, 0.2)}
                stroke={colors.info}
                strokeWidth={1.4}
                strokeLinejoin="round"
              />
            ) : (
              <Rect
                x={0}
                y={TICKS_HEIGHT + GAP + elevationHeight - 1}
                width={width}
                height={1}
                fill={colors.border}
              />
            )}
            {sections.map((section) => (
              <Rect
                key={section.id}
                x={x(section.startDist)}
                y={height - SECTION_HEIGHT}
                width={Math.max(1, x(section.endDist) - x(section.startDist) - 1)}
                height={SECTION_HEIGHT}
                rx={2}
                fill={sectionColors[section.kind]}
              />
            ))}
            {position !== null ? (
              <Line
                x1={x(position)}
                x2={x(position)}
                y1={0}
                y2={height}
                stroke={colors.text}
                strokeWidth={2}
              />
            ) : null}
          </Svg>
        ) : null}
      </View>
      <View style={styles.axis}>
        <Text style={styles.axisLabel}>0</Text>
        {kmMarks.map((mark) => (
          <Text
            key={mark}
            style={[styles.axisLabel, styles.axisMark, { left: x(mark * 1000) - 14 }]}
          >
            {mark}
          </Text>
        ))}
        <Text style={styles.axisLabel}>{(route.length / 1000).toFixed(route.length < 20_000 ? 1 : 0)} km</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: 4, height: 16 },
  axisLabel: { color: colors.textFaint, fontSize: 10, fontWeight: "600", ...tabular },
  axisMark: { position: "absolute", width: 28, textAlign: "center" },
});
