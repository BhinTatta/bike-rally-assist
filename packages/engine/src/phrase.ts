/**
 * Turning a corner into words.
 *
 * Two voices:
 *   plain  - "Sharp right, 80 metres"          (what a pillion would say)
 *   rally  - "Right 3, 80"                     (pacenote style, fewer syllables)
 *
 * Every phrase is produced as both a `text` string (for TTS) and a `tokens`
 * array (for stitching pre-recorded clips later - "sharp", "right", "80").
 * Keep the token vocabulary small and stable: it is the clip library.
 */

import type { RuntimeConfig } from "./config.js";
import type { Call, Corner } from "./types.js";

const capitalise = (s: string): string =>
  s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);

/** Round a distance for speech: 83 m -> "80". */
export function roundDistance(meters: number, step: number): number {
  return Math.max(0, Math.round(meters / step) * step);
}

/**
 * Describe a corner without the distance: "sharp right", "long left 4".
 * `includeModifiers` is off for chained corners to keep the call short.
 */
export function describeCorner(
  corner: Corner,
  rallyMode: boolean,
  includeModifiers = true,
): { text: string; tokens: string[] } {
  const tokens: string[] = [];
  const isLong = includeModifiers && corner.modifiers.includes("long");
  if (isLong) tokens.push("long");

  if (rallyMode) {
    tokens.push(corner.direction, String(corner.rallyNumber));
  } else {
    // "hairpin right" reads better than "hairpin grade right"; the grade words
    // are already written as the adjective they should be spoken as.
    tokens.push(...corner.grade.split(" "), corner.direction);
  }

  if (includeModifiers) {
    if (corner.modifiers.includes("tightens")) tokens.push("tightens");
    else if (corner.modifiers.includes("opens")) tokens.push("opens");
  }
  return { text: tokens.join(" "), tokens };
}

export interface CornerCallInput {
  /** The corner being announced, plus any chained "into" corners after it. */
  corners: Corner[];
  /** Distance from the rider to the first corner's entry, metres. */
  distance: number;
  /** Seconds to that entry at the current speed. */
  timeToCorner: number;
  time: number;
  riderDist: number;
  speed: number;
}

/** Build the full call for one corner (plus chained corners). */
export function buildCornerCall(
  input: CornerCallInput,
  runtime: RuntimeConfig,
): Call {
  const [first, ...chained] = input.corners;
  if (!first) throw new Error("buildCornerCall needs at least one corner");

  const head = describeCorner(first, runtime.rallyMode);
  const tokens: string[] = [];
  const parts: string[] = [];

  if (input.distance < runtime.immediateMeters) {
    // No point announcing "20 metres" - by the time it is spoken, it is now.
    tokens.push("immediate", ...head.tokens);
    parts.push(`immediate ${head.text}`);
  } else {
    const rounded = roundDistance(input.distance, runtime.distanceRoundingMeters);
    tokens.push(...head.tokens, String(rounded));
    if (runtime.rallyMode) {
      parts.push(`${head.text}, ${rounded}`);
    } else {
      tokens.push("metres");
      parts.push(`${head.text}, ${rounded} metres`);
    }
  }

  for (const next of chained) {
    const desc = describeCorner(next, runtime.rallyMode, false);
    tokens.push("into", ...desc.tokens);
    parts.push(`into ${desc.text}`);
  }

  return {
    kind: "corner",
    cornerIds: input.corners.map((c) => c.id),
    text: capitalise(parts.join(", ")),
    tokens,
    time: input.time,
    distance: input.distance,
    timeToCorner: input.timeToCorner,
    riderDist: input.riderDist,
    speed: input.speed,
  };
}

/** Fixed phrases for the non-corner events. */
const STATUS_PHRASES: Record<string, { text: string; tokens: string[] }> = {
  "off-route": { text: "Off route", tokens: ["off", "route"] },
  "back-on-route": { text: "Back on route", tokens: ["back", "on", "route"] },
  "gps-lost": { text: "GPS lost", tokens: ["gps", "lost"] },
  "gps-restored": { text: "GPS back", tokens: ["gps", "back"] },
  "route-start": { text: "Route started", tokens: ["route", "started"] },
  "route-end": { text: "Route finished", tokens: ["route", "finished"] },
};

export function buildStatusCall(
  kind: keyof typeof STATUS_PHRASES,
  time: number,
  riderDist?: number,
): Call {
  const phrase = STATUS_PHRASES[kind]!;
  const call: Call = {
    kind: kind as Call["kind"],
    cornerIds: [],
    text: phrase.text,
    tokens: phrase.tokens,
    time,
  };
  if (riderDist !== undefined) call.riderDist = riderDist;
  return call;
}
