/**
 * One dark, high-contrast palette.
 *
 * Everything here is chosen for a phone clamped to a handlebar in Indian
 * daylight: near-black backgrounds, saturated accents, and type that can be
 * read in the half-second glance a corner allows.
 */

export const colors = {
  bg: "#0b0d10",
  surface: "#161a20",
  surfaceHigh: "#222831",
  border: "#2d343f",
  text: "#f5f7fa",
  textDim: "#9aa4b2",
  accent: "#ffd400",
  good: "#5ad469",
  warn: "#ff8c00",
  bad: "#ff2d2d",
} as const;

/** Corner grade -> colour. Shared by the map, the lists and the ride screen. */
export const gradeColors: Record<string, string> = {
  hairpin: "#ff00c8",
  "very sharp": "#ff2d2d",
  sharp: "#ff8c00",
  medium: "#ffd400",
  gentle: "#5ad469",
  slight: "#49a0ff",
};

export const gradeColor = (grade: string): string => gradeColors[grade] ?? colors.textDim;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 20 } as const;
