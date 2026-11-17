/**
 * The look of the app, in one place.
 *
 * Everything is chosen for a phone clamped to a handlebar in Indian daylight,
 * read through a visor in a half-second glance: near-black backgrounds (which
 * also cost nothing on an OLED), a few saturated colours that each mean one
 * thing, and numbers heavy enough to read at arm's length.
 *
 * Colour is information here, never decoration:
 *   - the corner grade colours run from blue (barely a bend) to magenta
 *     (hairpin), and are the same on the map, the roadbook and the ride screen;
 *   - each ride mode has its own colour, so the mode is readable from the
 *     tint of the screen alone.
 */

import type { CornerGrade, RideModeId, RoadFeatureKind, SectionKind } from "@rally/engine";

export const colors = {
  bg: "#07090c",
  surface: "#0f1318",
  surfaceHigh: "#171c24",
  surfaceTop: "#202733",
  border: "#232a35",
  borderStrong: "#364050",
  text: "#f2f5f9",
  textDim: "#98a3b3",
  textFaint: "#5d6878",
  accent: "#ffc400",
  onAccent: "#0b0d10",
  good: "#4ade80",
  warn: "#ff9d1f",
  bad: "#ff4438",
  info: "#4aa8ff",
  road: "#3a4352",
  roadEdge: "#11151b",
} as const;

/** Corner grade -> colour. Shared by the map, the lists and the ride screen. */
export const gradeColors: Record<CornerGrade, string> = {
  hairpin: "#ff2e93",
  "very sharp": "#ff4d3d",
  sharp: "#ff8a1f",
  medium: "#ffc400",
  gentle: "#7adb5b",
  slight: "#4aa8ff",
};

export const gradeColor = (grade: string): string =>
  (gradeColors as Record<string, string>)[grade] ?? colors.textDim;

/** Tightest first: the order grades are listed in everywhere. */
export const GRADE_ORDER: CornerGrade[] = [
  "hairpin",
  "very sharp",
  "sharp",
  "medium",
  "gentle",
  "slight",
];

export const modeColors: Record<RideModeId, string> = {
  cruise: "#2dd4bf",
  sport: "#ffc400",
  duke: "#ff5a1f",
};

export const sectionColors: Record<SectionKind, string> = {
  straight: "#2b3340",
  flowing: "#3f8f63",
  twisty: "#d98a1c",
  technical: "#e0356f",
};

export const sectionNames: Record<SectionKind, string> = {
  straight: "Open road",
  flowing: "Flowing bends",
  twisty: "Twisty",
  technical: "Technical",
};

export const featureColors: Record<RoadFeatureKind, string> = {
  crest: "#c4b5fd",
  dip: "#c4b5fd",
  "steep-descent": "#ff9d1f",
  "steep-climb": "#7dd3fc",
  surface: "#ff4438",
  bridge: "#98a3b3",
  tunnel: "#98a3b3",
  narrow: "#ff9d1f",
  bump: "#ff4438",
  "rail-crossing": "#ff4438",
  town: "#7dd3fc",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 18, xl: 26, pill: 999 } as const;

/** Type scale. `tabular` keeps changing numbers from jiggling sideways. */
export const type = {
  hero: { fontSize: 34, fontWeight: "800", letterSpacing: -0.6 },
  title: { fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: "700" },
  body: { fontSize: 15, fontWeight: "400", lineHeight: 21 },
  small: { fontSize: 13, fontWeight: "400", lineHeight: 18 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1.1, textTransform: "uppercase" },
} as const;

export const tabular = { fontVariant: ["tabular-nums" as const] };

/** A colour with alpha, from a #rrggbb hex. */
export function alpha(hex: string, opacity: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}
