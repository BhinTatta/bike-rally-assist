/**
 * The app's icon set: a couple of dozen line icons drawn on a 24 px grid.
 *
 * Drawn here rather than pulled from an icon font so that there is no font
 * file to load, nothing to fall back to a tofu box when it fails, and each
 * icon is exactly as heavy as the stroke the rest of the UI uses.
 */

import Svg, { Circle, Path } from "react-native-svg";

import { colors } from "./theme";

const PATHS = {
  back: ["M15 5l-7 7 7 7"],
  forward: ["M9 5l7 7-7 7"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  plus: ["M12 5v14", "M5 12h14"],
  import: ["M12 3v12", "M7.5 10.5L12 15l4.5-4.5", "M4 17v2.5A1.5 1.5 0 005.5 21h13a1.5 1.5 0 001.5-1.5V17"],
  share: ["M12 15V3", "M7.5 7.5L12 3l4.5 4.5", "M4 13v6.5A1.5 1.5 0 005.5 21h13a1.5 1.5 0 001.5-1.5V13"],
  trash: ["M4 7h16", "M9 7V4.5h6V7", "M6.5 7l1 13h9l1-13", "M10 11v5.5", "M14 11v5.5"],
  settings: [
    "M4 7h9",
    "M17 7h3",
    "M4 17h3",
    "M11 17h9",
    "M15 4.8a2.2 2.2 0 100 4.4 2.2 2.2 0 000-4.4z",
    "M9 14.8a2.2 2.2 0 100 4.4 2.2 2.2 0 000-4.4z",
  ],
  history: ["M4 12a8 8 0 108-8 8 8 0 00-6.2 3", "M4 4v4h4", "M12 8v4.5l3 1.8"],
  play: ["M8 5.5v13l10.5-6.5z"],
  pause: ["M8 5v14", "M16 5v14"],
  stop: ["M7 7h10v10H7z"],
  volume: ["M4 10v4h3.5L12 18V6L7.5 10z", "M15.5 9a4 4 0 010 6", "M18 6.5a7.5 7.5 0 010 11"],
  mute: ["M4 10v4h3.5L12 18V6L7.5 10z", "M16 9.5l5 5", "M21 9.5l-5 5"],
  repeat: ["M4 11V9.5A3.5 3.5 0 017.5 6H19", "M16 3l3 3-3 3", "M20 13v1.5a3.5 3.5 0 01-3.5 3.5H5", "M8 21l-3-3 3-3"],
  alert: ["M12 4L2.8 19.5h18.4z", "M12 10v4.5", "M12 17.2v.3"],
  info: ["M12 3.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17z", "M12 11v5.5", "M12 7.6v.3"],
  flag: ["M6 21V4", "M6 4.5h11l-2.2 4 2.2 4H6"],
  pin: ["M12 21s6.5-6.2 6.5-11a6.5 6.5 0 10-13 0c0 4.8 6.5 11 6.5 11z", "M12 7.8a2.2 2.2 0 100 4.4 2.2 2.2 0 000-4.4z"],
  mountain: ["M2.5 19L9 7.5l4 6.5 2.5-3.5 6 8.5z"],
  route: [
    "M6 17.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z",
    "M18 1.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z",
    "M8.5 20H15a3.5 3.5 0 000-7H9a3.5 3.5 0 010-7h6.5",
  ],
  gauge: ["M4.5 17a8.5 8.5 0 1115 0", "M12 13.5l4-5.5", "M12 12.5a1 1 0 100 2 1 1 0 000-2z"],
  list: ["M9 6h11", "M9 12h11", "M9 18h11", "M4.5 6h.5", "M4.5 12h.5", "M4.5 18h.5"],
  clock: ["M12 3.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17z", "M12 7.5V12l3 2"],
  bolt: ["M13 2.5L5 13.5h6l-1 8 8-11h-6z"],
  layers: ["M12 3.5L3 8.5l9 5 9-5z", "M3 13l9 5 9-5", "M3 17l9 5 9-5"],
  edit: ["M4 20h4L19.5 8.5l-4-4L4 16z", "M13.5 6.5l4 4"],
  locate: ["M12 2.5v3", "M12 18.5v3", "M2.5 12h3", "M18.5 12h3", "M12 6.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11z"],
  eye: ["M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z", "M12 9.2a2.8 2.8 0 100 5.6 2.8 2.8 0 000-5.6z"],
  headset: ["M4.5 14v-2a7.5 7.5 0 0115 0v2", "M4.5 13.5H7v5.5H5.5a1 1 0 01-1-1z", "M19.5 13.5H17v5.5h1.5a1 1 0 001-1z"],
  battery: ["M3 8.5h15v7H3z", "M21 11v2", "M6 11v2"],
  bug: ["M9 8a3 3 0 016 0", "M7.5 10h9v5a4.5 4.5 0 01-9 0z", "M3.5 13h4", "M16.5 13h4", "M5 7l3 3", "M19 7l-3 3", "M5 20l3-3", "M19 20l-3-3"],
  sparkle: ["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z", "M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z"],
} as const;

export type IconName = keyof typeof PATHS;

/** Icons that read better solid than outlined. */
const FILLED = new Set<IconName>(["play", "stop", "bolt"]);

export function Icon({
  name,
  size = 22,
  color = colors.text,
  strokeWidth = 1.9,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const filled = FILLED.has(name);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {PATHS[name].map((d, index) => (
        <Path
          key={index}
          d={d}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={filled ? color : "none"}
        />
      ))}
    </Svg>
  );
}

/** A filled dot, for legends and list bullets. */
export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 10 10">
      <Circle cx={5} cy={5} r={5} fill={color} />
    </Svg>
  );
}
