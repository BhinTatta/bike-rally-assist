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
import type { Call, Corner, RoadFeature, RouteSection } from "./types.js";

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
  /** Open with "caution". */
  caution?: boolean;
  /** Open with the overspeed word instead ("slow" / "brake"). */
  overspeed?: boolean;
  /** Estimated corner speed, carried on the call for the display. m/s. */
  advisorySpeed?: number;
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

  // One warning word at most, and "too fast" outranks "this one is nasty":
  // the first is about what the rider is doing right now.
  const warning = input.overspeed ? runtime.overspeedWord : input.caution ? "caution" : null;
  if (warning) {
    tokens.unshift(warning);
    parts.unshift(warning);
  }

  const call: Call = {
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
  if (input.caution) call.caution = true;
  if (input.overspeed) call.overspeed = true;
  if (input.advisorySpeed !== undefined && Number.isFinite(input.advisorySpeed)) {
    call.advisorySpeed = input.advisorySpeed;
  }
  return call;
}

/**
 * A length for speech: "400 metres", "1 kilometre", "2.5 kilometres".
 * Rounded hard - nobody needs "1,340 metres" in their ear.
 */
export function spokenLength(meters: number): { text: string; tokens: string[] } {
  if (meters < 950) {
    const rounded = Math.max(50, Math.round(meters / 50) * 50);
    return { text: `${rounded} metres`, tokens: [String(rounded), "metres"] };
  }
  const km = Math.round(meters / 500) / 2;
  const unit = km === 1 ? "kilometre" : "kilometres";
  return { text: `${km} ${unit}`, tokens: [String(km), unit] };
}

/** Plain and pacenote wording for each kind of road feature. */
const FEATURE_WORDS: Record<
  RoadFeature["kind"],
  { plain: string; rally: string; caution?: boolean; noDistance?: boolean }
> = {
  crest: { plain: "crest", rally: "crest" },
  dip: { plain: "dip", rally: "dip" },
  "steep-descent": { plain: "steep descent", rally: "steep down", noDistance: true },
  "steep-climb": { plain: "steep climb", rally: "steep up", noDistance: true },
  surface: { plain: "rough surface", rally: "rough", caution: true },
  bridge: { plain: "bridge", rally: "bridge" },
  tunnel: { plain: "tunnel", rally: "tunnel" },
  narrow: { plain: "road narrows", rally: "narrows" },
  bump: { plain: "speed breaker", rally: "bump", caution: true },
  "rail-crossing": { plain: "railway crossing", rally: "rail crossing", caution: true },
  town: { plain: "village ahead", rally: "village", noDistance: true },
};

/** What a feature is called, for lists and the ride display. */
export function featureLabel(feature: RoadFeature): string {
  if (feature.label) return feature.label;
  return FEATURE_WORDS[feature.kind].plain;
}

export interface FeatureCallInput {
  feature: RoadFeature;
  /** Distance from the rider to where the feature starts, metres. */
  distance: number;
  time: number;
  riderDist: number;
  speed: number;
}

/** "Caution, gravel, 150 metres" / "Crest, 100 metres" / "Steep descent, 1 kilometre". */
export function buildFeatureCall(input: FeatureCallInput, runtime: RuntimeConfig): Call {
  const { feature } = input;
  const words = FEATURE_WORDS[feature.kind];
  const name = (feature.label ?? (runtime.rallyMode ? words.rally : words.plain)).toLowerCase();
  const tokens: string[] = [];
  const parts: string[] = [];
  if (words.caution) {
    tokens.push("caution");
    parts.push("caution");
  }
  tokens.push(...name.split(" "));
  parts.push(name);

  const length =
    feature.endDist !== undefined ? Math.abs(feature.endDist - feature.dist) : 0;
  if (words.noDistance) {
    // These are stretches, not points: how long matters more than how far.
    if (length >= 300) {
      const spoken = spokenLength(length);
      tokens.push(...spoken.tokens);
      parts.push(spoken.text);
    }
  } else if (input.distance >= runtime.immediateMeters) {
    const rounded = roundDistance(input.distance, runtime.distanceRoundingMeters);
    tokens.push(String(rounded));
    if (runtime.rallyMode) {
      parts.push(String(rounded));
    } else {
      tokens.push("metres");
      parts.push(`${rounded} metres`);
    }
  }

  return {
    kind: "feature",
    cornerIds: [],
    featureId: feature.id,
    text: capitalise(parts.join(", ")),
    tokens,
    time: input.time,
    distance: input.distance,
    riderDist: input.riderDist,
    speed: input.speed,
  };
}

const SECTION_WORDS: Record<RouteSection["kind"], string> = {
  straight: "road opens up",
  flowing: "flowing bends",
  twisty: "twisty section",
  technical: "technical section",
};

/** "Twisty section, 3 kilometres, 4 hairpins". */
export function buildSectionCall(
  section: RouteSection,
  time: number,
  riderDist: number,
): Call {
  const name = SECTION_WORDS[section.kind];
  const tokens = name.split(" ");
  const parts = [name];
  const spoken = spokenLength(section.endDist - section.startDist);
  tokens.push(...spoken.tokens);
  parts.push(spoken.text);
  if (section.hairpinCount > 0) {
    const word = section.hairpinCount === 1 ? "hairpin" : "hairpins";
    tokens.push(String(section.hairpinCount), word);
    parts.push(`${section.hairpinCount} ${word}`);
  }
  return {
    kind: "section",
    cornerIds: [],
    text: capitalise(parts.join(", ")),
    tokens,
    time,
    riderDist,
  };
}

/** "Straight, 600 metres" / pacenote "Straight 600". */
export function buildStraightCall(
  meters: number,
  time: number,
  riderDist: number,
  runtime: RuntimeConfig,
): Call {
  const spoken = spokenLength(meters);
  const rally = runtime.rallyMode && meters < 950;
  return {
    kind: "straight",
    cornerIds: [],
    text: rally ? `Straight ${spoken.tokens[0]}` : `Straight, ${spoken.text}`,
    tokens: rally ? ["straight", spoken.tokens[0]!] : ["straight", ...spoken.tokens],
    time,
    distance: meters,
    riderDist,
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
  reversed: { text: "Riding back", tokens: ["riding", "back"] },
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
