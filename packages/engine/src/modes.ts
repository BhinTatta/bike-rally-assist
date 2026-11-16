/**
 * Ride modes: one tap that changes how the co-driver talks.
 *
 * A mode is nothing more than a named bundle of runtime settings. The same
 * engine reads them all; what differs is how early it speaks, how much it
 * bothers to mention, and how terse the words are.
 *
 *   cruise  relaxed touring. Long warnings, only corners that matter, plain
 *           words, and a nudge when you are carrying too much speed.
 *   sport   a spirited ride. Every real corner, tighter timing.
 *   duke    attack. Rally pacenotes - "Right 3, 80, into left 2" - the lot,
 *           called late and short, with "brake" when you are over.
 */

import type { RuntimeConfig } from "./config.js";

export type RideModeId = "cruise" | "sport" | "duke";

export interface RideMode {
  id: RideModeId;
  name: string;
  /** Two or three words for a chip or a button. */
  tagline: string;
  /** One sentence for the mode picker. */
  description: string;
  /** What it sounds like. */
  example: string;
  /** Cruising speed used to estimate ride time and to drive previews, km/h. */
  typicalSpeedKmh: number;
  runtime: Partial<RuntimeConfig>;
}

export const RIDE_MODES: Record<RideModeId, RideMode> = {
  cruise: {
    id: "cruise",
    name: "Cruise",
    tagline: "Relaxed touring",
    description:
      "Early, unhurried calls for the corners that matter, plus road hazards and what kind of road is coming.",
    example: "Sharp right, 120 metres",
    typicalSpeedKmh: 50,
    runtime: {
      leadSeconds: 7,
      maxRallyNumberToCall: 4,
      rallyMode: false,
      maxChainedCorners: 2,
      lateralG: 0.25,
      brakingG: 0.25,
      reactionSeconds: 2,
      brakingAwareLead: true,
      speedWarnings: true,
      overspeedMargin: 0.5,
      overspeedWord: "slow",
      cautionCalls: true,
      announceFeatures: true,
      announceSections: true,
      callStraights: false,
    },
  },
  sport: {
    id: "sport",
    name: "Sport",
    tagline: "Spirited ride",
    description:
      "Every real corner with its grade and distance, called about five seconds out. The all-round default.",
    example: "Sharp right, 80 metres, into medium left",
    typicalSpeedKmh: 65,
    runtime: {
      leadSeconds: 5.5,
      maxRallyNumberToCall: 5,
      rallyMode: false,
      maxChainedCorners: 3,
      lateralG: 0.35,
      brakingG: 0.35,
      reactionSeconds: 1.5,
      brakingAwareLead: true,
      speedWarnings: true,
      overspeedMargin: 0.5,
      overspeedWord: "slow",
      cautionCalls: true,
      announceFeatures: true,
      announceSections: true,
      callStraights: false,
    },
  },
  duke: {
    id: "duke",
    name: "Duke",
    tagline: "Attack mode",
    description:
      "Rally pacenotes: numbers instead of words, everything called, late and terse, with long straights counted out.",
    example: "Right 3, 80, into left 2",
    typicalSpeedKmh: 80,
    runtime: {
      leadSeconds: 4.5,
      maxRallyNumberToCall: 6,
      rallyMode: true,
      maxChainedCorners: 4,
      lateralG: 0.45,
      brakingG: 0.45,
      reactionSeconds: 1,
      brakingAwareLead: true,
      speedWarnings: true,
      overspeedMargin: 0.6,
      overspeedWord: "brake",
      cautionCalls: true,
      announceFeatures: true,
      announceSections: false,
      callStraights: true,
      straightMinMeters: 400,
    },
  },
};

export const RIDE_MODE_IDS: RideModeId[] = ["cruise", "sport", "duke"];

export const rideMode = (id: RideModeId): RideMode => RIDE_MODES[id] ?? RIDE_MODES.sport;

const GRAVITY = 9.81;

/**
 * Estimated comfortable speed through a corner of this radius, m/s.
 *
 * It comes from the radius alone. It knows nothing about camber, surface,
 * traffic or what is round the bend, so it is only ever shown as a rough guide
 * and never as a target.
 */
export function cornerSpeed(radiusMeters: number, lateralG: number): number {
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return Infinity;
  return Math.sqrt(Math.max(0.05, lateralG) * GRAVITY * radiusMeters);
}

/** Distance needed to slow from `from` to `to` (m/s), including reaction time. */
export function brakingDistance(
  from: number,
  to: number,
  brakingG: number,
  reactionSeconds: number,
): number {
  if (from <= to) return 0;
  return (
    from * reactionSeconds +
    (from * from - to * to) / (2 * Math.max(0.05, brakingG) * GRAVITY)
  );
}

/** Lean angle, degrees, for a speed (m/s) and a curvature (1/m). */
export function leanAngle(speed: number, curvature: number): number {
  const lateral = speed * speed * Math.abs(curvature);
  return (Math.atan2(lateral, GRAVITY) * 180) / Math.PI;
}
