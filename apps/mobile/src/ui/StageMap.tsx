/**
 * The route map.
 *
 * Drawn by the app itself, as vectors: the road in grey, every corner coloured
 * by how tight it is, hazards as dots, start and finish marked. There is no
 * map SDK underneath and no tiles to fetch, which buys three things at once -
 * it works with no signal on a ghat, it starts instantly, and there is no
 * native GL surface to crash the app, which is what the previous map did.
 *
 * Interaction is deliberately simple: drag to pan, pinch to zoom, and three
 * large buttons that do the same for a gloved hand.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, G, Path, Polygon } from "react-native-svg";
import type { AnalysedRoute } from "@rally/engine";

import { IconButton } from "./components";
import { buildRouteShapes } from "./routeShapes";
import { colors, featureColors, gradeColor, radius, spacing } from "./theme";

interface Camera {
  /** World coordinates of the centre of the view, metres. */
  cx: number;
  cy: number;
  /** Metres per screen pixel. */
  scale: number;
}

export interface StageMapProps {
  route: AnalysedRoute;
  height: number;
  /** Drag, pinch and zoom buttons. Off for small previews. */
  interactive?: boolean;
  /** Where the rider is, metres along the route. */
  riderDist?: number | null;
  /** A stretch to pick out, e.g. the twistiest kilometre. */
  highlight?: { startDist: number; endDist: number } | null;
  /** Keep the rider centred as they move. */
  follow?: boolean;
}

const PADDING = 28;

export function StageMap({
  route,
  height,
  interactive = false,
  riderDist = null,
  highlight = null,
  follow = false,
}: StageMapProps) {
  const shapes = useMemo(() => buildRouteShapes(route), [route]);
  const [width, setWidth] = useState(0);
  const [camera, setCamera] = useState<Camera | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  cameraRef.current = camera;

  const fit = useCallback((): Camera | null => {
    if (width <= 0) return null;
    const { minX, minY, maxX, maxY } = shapes.bounds;
    const spanX = Math.max(20, maxX - minX);
    const spanY = Math.max(20, maxY - minY);
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      scale: Math.max(spanX / Math.max(1, width - PADDING * 2), spanY / Math.max(1, height - PADDING * 2)),
    };
  }, [shapes, width, height]);

  // Fit whenever the route or the size of the view changes.
  useEffect(() => {
    setCamera(fit());
  }, [fit]);

  const fitted = useMemo(() => fit(), [fit]);
  const minScale = 0.25;
  const maxScale = (fitted?.scale ?? 100) * 1.3;
  const clampScale = useCallback(
    (scale: number): number => Math.max(minScale, Math.min(maxScale, scale)),
    [maxScale],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      setCamera((current) =>
        current ? { ...current, scale: clampScale(current.scale * factor) } : current,
      );
    },
    [clampScale],
  );

  // ----------------------------------------------------------- gestures
  const gesture = useRef<{
    camera: Camera;
    distance: number | null;
  } | null>(null);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => interactive,
        onMoveShouldSetPanResponder: () => interactive,
        onMoveShouldSetPanResponderCapture: (_event, state) =>
          interactive && (Math.abs(state.dx) > 4 || Math.abs(state.dy) > 4),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          if (cameraRef.current) gesture.current = { camera: cameraRef.current, distance: null };
        },
        onPanResponderMove: (event, state) => {
          const start = gesture.current;
          if (!start) return;
          const touches = event.nativeEvent.touches;
          let scale = start.camera.scale;
          if (touches.length >= 2) {
            const [a, b] = touches;
            const distance = Math.hypot(a!.pageX - b!.pageX, a!.pageY - b!.pageY);
            if (start.distance === null) start.distance = distance;
            else if (distance > 0) scale = clampScale(start.camera.scale * (start.distance / distance));
          } else {
            start.distance = null;
          }
          setCamera({
            cx: start.camera.cx - state.dx * scale,
            cy: start.camera.cy - state.dy * scale,
            scale,
          });
        },
        onPanResponderRelease: () => {
          gesture.current = null;
        },
        onPanResponderTerminate: () => {
          gesture.current = null;
        },
      }),
    [interactive, clampScale],
  );

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  // -------------------------------------------------------------- rider
  const rider = riderDist === null ? null : shapes.at(riderDist);
  useEffect(() => {
    if (!follow || !rider) return;
    setCamera((current) => (current ? { ...current, cx: rider.x, cy: rider.y } : current));
    // Position is what matters; the object identity changes every render.
  }, [follow, rider?.x, rider?.y]);

  const highlightPath = useMemo(() => {
    if (!highlight) return null;
    const step = Math.max(route.spacing, (highlight.endDist - highlight.startDist) / 80);
    const parts: string[] = [];
    for (let d = highlight.startDist; d <= highlight.endDist; d += step) {
      const p = shapes.at(d);
      parts.push(`${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
    }
    return parts.length >= 2 ? `M${parts.join("L")}` : null;
  }, [highlight, shapes, route.spacing]);

  if (!camera || width <= 0) {
    return <View style={[styles.container, { height }]} onLayout={onLayout} />;
  }

  // Sizes that should stay the same on screen whatever the zoom.
  const px = camera.scale;
  const viewBox = `${camera.cx - (width * px) / 2} ${camera.cy - (height * px) / 2} ${width * px} ${height * px}`;
  // Hazard dots are clutter when the whole of a long route is on screen.
  const showFeatures = px < 12;

  return (
    <View style={[styles.container, { height }]} onLayout={onLayout} {...responder.panHandlers}>
      <Svg width={width} height={height} viewBox={viewBox}>
        {highlightPath ? (
          <Path
            d={highlightPath}
            stroke={colors.text}
            strokeOpacity={0.22}
            strokeWidth={18 * px}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ) : null}
        <Path
          d={shapes.base}
          stroke={colors.roadEdge}
          strokeWidth={8 * px}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <Path
          d={shapes.base}
          stroke={colors.road}
          strokeWidth={4 * px}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {shapes.grades.map(({ grade, d }) => (
          <Path
            key={grade}
            d={d}
            stroke={gradeColor(grade)}
            strokeWidth={4.5 * px}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
        {showFeatures
          ? shapes.features.map(({ feature, at }) => (
              <Circle
                key={feature.id}
                cx={at.x}
                cy={at.y}
                r={4.5 * px}
                fill={featureColors[feature.kind]}
                stroke={colors.bg}
                strokeWidth={1.5 * px}
              />
            ))
          : null}
        <Circle
          cx={shapes.finish.x}
          cy={shapes.finish.y}
          r={7 * px}
          fill={colors.text}
          stroke={colors.bg}
          strokeWidth={2 * px}
        />
        <Circle cx={shapes.finish.x} cy={shapes.finish.y} r={2.6 * px} fill={colors.bg} />
        <Circle
          cx={shapes.start.x}
          cy={shapes.start.y}
          r={7 * px}
          fill={colors.good}
          stroke={colors.bg}
          strokeWidth={2 * px}
        />
        {rider ? (
          <G
            transform={`translate(${rider.x} ${rider.y}) rotate(${rider.heading}) scale(${px})`}
          >
            <Circle r={15} fill={colors.accent} fillOpacity={0.2} />
            <Polygon
              points="0,-11 8,8 0,4 -8,8"
              fill={colors.accent}
              stroke={colors.bg}
              strokeWidth={1.6}
              strokeLinejoin="round"
            />
          </G>
        ) : null}
      </Svg>
      {interactive ? (
        <View style={styles.controls}>
          <IconButton icon="plus" label="Zoom in" filled onPress={() => zoomBy(0.55)} />
          <IconButton icon="locate" label="Fit the whole route" filled onPress={() => setCamera(fit())} />
        </View>
      ) : null}
    </View>
  );
}

/** The route's outline, small, for a list row. Draws from the stored thumbnail. */
export function RouteThumbnail({
  thumb,
  size,
  color = colors.accent,
}: {
  /** [x0, y0, x1, y1, ...] in a 0-1 box. */
  thumb: number[];
  size: number;
  color?: string;
}) {
  const d = useMemo(() => {
    if (thumb.length < 4) return "";
    const pad = 0.1;
    const parts: string[] = [];
    for (let i = 0; i + 1 < thumb.length; i += 2) {
      const x = (pad + thumb[i]! * (1 - pad * 2)) * 100;
      const y = (pad + thumb[i + 1]! * (1 - pad * 2)) * 100;
      parts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return `M${parts.join("L")}`;
  }, [thumb]);
  const first = thumb.length >= 2 ? { x: thumb[0]!, y: thumb[1]! } : null;
  const pad = 0.1;
  return (
    <View style={[styles.thumb, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        {d ? (
          <>
            <Path d={d} stroke={colors.roadEdge} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <Path d={d} stroke={color} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </>
        ) : null}
        {first ? (
          <Circle
            cx={(pad + first.x * (1 - pad * 2)) * 100}
            cy={(pad + first.y * (1 - pad * 2)) * 100}
            r={6}
            fill={colors.good}
            stroke={colors.bg}
            strokeWidth={2}
          />
        ) : null}
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
  controls: { position: "absolute", right: spacing.sm, bottom: spacing.sm, gap: spacing.sm },
  thumb: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.md,
    overflow: "hidden",
  },
});
