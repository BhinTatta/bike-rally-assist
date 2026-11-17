/**
 * The corner, drawn.
 *
 * Not a generic arrow: the bend in the glyph is as tight as the corner it
 * stands for. A "6" barely leans, a "3" is a right angle, a hairpin doubles
 * back on itself. At 60 km/h the shape is read before the word next to it is.
 */

import { useMemo } from "react";
import Svg, { Path, Polygon } from "react-native-svg";
import type { Direction } from "@rally/engine";

import { colors } from "./theme";

/** How far each rally number turns, degrees, and how tight the arc is drawn. */
const SHAPES: Record<number, { turn: number; radius: number }> = {
  1: { turn: 178, radius: 8 },
  2: { turn: 128, radius: 9 },
  3: { turn: 92, radius: 11 },
  4: { turn: 62, radius: 16 },
  5: { turn: 40, radius: 24 },
  6: { turn: 22, radius: 38 },
};

interface GlyphGeometry {
  path: string;
  head: string;
}

function buildGlyph(rallyNumber: number, direction: Direction, box: number, stroke: number): GlyphGeometry {
  const shape = SHAPES[Math.max(1, Math.min(6, Math.round(rallyNumber)))]!;
  const theta = (shape.turn * Math.PI) / 180;
  const r = shape.radius;
  // Drawn turning right in a y-up frame, then fitted to the box and mirrored.
  const lead = shape.turn > 150 ? 22 : 16;
  const tail = shape.turn > 150 ? 14 : shape.turn > 100 ? 12 : 13;
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 0, y: lead };
  const centre = { x: r, y: lead };
  const p2 = { x: centre.x + r * Math.cos(Math.PI - theta), y: centre.y + r * Math.sin(Math.PI - theta) };
  const dir = { x: Math.sin(theta), y: Math.cos(theta) };
  const p3 = { x: p2.x + dir.x * tail, y: p2.y + dir.y * tail };
  const headLength = 9;
  const headWidth = 7.5;
  const tip = { x: p3.x + dir.x * headLength, y: p3.y + dir.y * headLength };
  const normal = { x: -dir.y, y: dir.x };
  const h1 = { x: p3.x + normal.x * headWidth, y: p3.y + normal.y * headWidth };
  const h2 = { x: p3.x - normal.x * headWidth, y: p3.y - normal.y * headWidth };

  // Bounding box, including the top of the arc.
  const xs = [p0.x, p1.x, p2.x, p3.x, tip.x, h1.x, h2.x];
  const ys = [p0.y, p1.y, p2.y, p3.y, tip.y, h1.y, h2.y];
  if (theta > Math.PI / 2) ys.push(centre.y + r);
  if (theta >= Math.PI - 0.05) xs.push(centre.x + r);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const pad = stroke / 2 + 1;
  const scale = Math.min((box - pad * 2) / (maxX - minX), (box - pad * 2) / (maxY - minY));
  const offsetX = (box - (maxX - minX) * scale) / 2;
  const offsetY = (box - (maxY - minY) * scale) / 2;
  const mirror = direction === "left";
  const tx = (x: number): number => {
    const fitted = offsetX + (x - minX) * scale;
    return mirror ? box - fitted : fitted;
  };
  const ty = (y: number): number => box - (offsetY + (y - minY) * scale);
  const f = (n: number): string => n.toFixed(2);
  const point = (p: { x: number; y: number }): string => `${f(tx(p.x))} ${f(ty(p.y))}`;

  const sweep = mirror ? 0 : 1;
  const path =
    `M${point(p0)} L${point(p1)} ` +
    `A${f(r * scale)} ${f(r * scale)} 0 0 ${sweep} ${point(p2)} ` +
    `L${point(p3)}`;
  const head = `${point(tip)} ${point(h1)} ${point(h2)}`;
  return { path, head };
}

export function CornerGlyph({
  rallyNumber,
  direction,
  size = 64,
  color = colors.text,
  /** Stroke as a fraction of the size; heavier reads better from further away. */
  weight = 0.13,
  dim = false,
}: {
  rallyNumber: number;
  direction: Direction;
  size?: number;
  color?: string;
  weight?: number;
  dim?: boolean;
}) {
  const stroke = Math.max(3, size * weight);
  const glyph = useMemo(
    () => buildGlyph(rallyNumber, direction, 100, (stroke / size) * 100),
    [rallyNumber, direction, stroke, size],
  );
  const strokeUnits = (stroke / size) * 100;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" opacity={dim ? 0.45 : 1}>
      <Path
        d={glyph.path}
        stroke={color}
        strokeWidth={strokeUnits}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Polygon
        points={glyph.head}
        fill={color}
        stroke={color}
        strokeWidth={strokeUnits * 0.45}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Straight ahead: nothing coming. */
export function AheadGlyph({ size = 64, color = colors.textFaint }: { size?: number; color?: string }) {
  const stroke = size * 0.13;
  const units = (stroke / size) * 100;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d="M50 92 L50 34" stroke={color} strokeWidth={units} strokeLinecap="round" fill="none" />
      <Polygon points="50,10 31,36 69,36" fill={color} stroke={color} strokeWidth={units * 0.45} strokeLinejoin="round" />
    </Svg>
  );
}
