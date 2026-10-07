/**
 * Every tunable number in the engine lives here.
 *
 * Nothing else in the engine hard-codes a threshold: if you want to change how
 * the co-driver behaves, change a value here (or pass a partial override).
 */

import type { CornerGrade } from "./types.js";

export interface GeometryConfig {
  /** Points closer together than this are dropped as duplicates. Metres. */
  dedupeMeters: number;
  /** Fixed spacing used when resampling the track. Metres. */
  resampleMeters: number;
  /** "moving-average" is cheap; "savitzky-golay" preserves corner sharpness. */
  smoothing: "savitzky-golay" | "moving-average" | "none";
  /**
   * Smoothing window in samples; forced odd. At the default 5 m spacing, 13
   * samples cover 60 m of road. That is wide enough to swallow +/-5 m GPS
   * jitter (which otherwise invents a phantom corner every 50 m on a recorded
   * ride) and to turn the 2-3 point hairpins of sparse Indian ghat map data
   * into a believable arc, while still resolving hairpins stacked 40 m apart.
   */
  smoothWindow: number;
  /** Polynomial order for Savitzky-Golay (2 = quadratic, follows arcs). */
  smoothPolyOrder: number;
  /**
   * Half-span used for the 3-point circumradius, metres. The curvature at a
   * point is measured from the points this far before and after it.
   */
  curvatureSpanMeters: number;
  /** Radii above this are reported as straight (Infinity). Metres. */
  maxRadiusMeters: number;
}

export interface CornerDetectionConfig {
  /** A point counts as "in a corner" below this radius. Metres. */
  cornerRadiusMeters: number;
  /** Gaps shorter than this between same-direction corners are merged. Metres. */
  mergeGapMeters: number;
  /** Corners shorter than this are discarded as noise. Metres. */
  minCornerLengthMeters: number;
  /** Corners that bend less than this are discarded as noise. Degrees. */
  minHeadingChangeDeg: number;
  /**
   * A corner shorter than `minCornerLengthMeters` survives anyway if it bends
   * at least this much. Sparse map data turns a real hairpin into a handful of
   * samples, and "171 degrees in 10 metres" is never noise.
   */
  shortCornerHeadingChangeDeg: number;
  /**
   * A corner whose *sustained* part is longer than this gets "long". Metres.
   * (Using the sustained part matters: the detected extent of any corner is
   * padded by the smoothing blend into the straights either side.)
   */
  longCornerMeters: number;
  /**
   * Which points count as the sustained part of a corner: those whose curvature
   * is at least this fraction of the apex curvature.
   */
  sustainedCurvatureFraction: number;
  /** Next corner starting within this distance gets chained with "into". Metres. */
  intoGapMeters: number;
  /** Second half tighter than firstHalf * this => "tightens". */
  tightensRatio: number;
  /** Second half wider than firstHalf * this => "opens". */
  opensRatio: number;
}

export interface GradingConfig {
  /** Upper radius bound for each grade, metres, tightest first. */
  thresholds: { grade: CornerGrade; maxRadius: number }[];
  /** A corner is a hairpin if it bends more than this AND is tighter than hairpinRadius. */
  hairpinHeadingChangeDeg: number;
  hairpinRadiusMeters: number;
  /** Rally number (1 = tightest) for each grade. */
  rallyNumbers: Record<CornerGrade, number>;
}

export interface RuntimeConfig {
  /** Seconds of system + speech latency to compensate for by projecting ahead. */
  lagSeconds: number;
  /** Target warning time before the corner entry. Seconds. */
  leadSeconds: number;
  /** Never call closer than this, even when crawling. Metres. */
  minLeadMeters: number;
  /** Never call further out than this, even at speed. Metres. */
  maxLeadMeters: number;
  /** Closer than this and the call becomes "Immediate ...". Metres. */
  immediateMeters: number;
  /** Perpendicular distance that counts as off-route. Metres. */
  offRouteMeters: number;
  /** How far along the route to search around the last known position. Metres. */
  snapSearchMeters: number;
  /** Fixes with accuracy worse than this are ignored. Metres. */
  maxAccuracyMeters: number;
  /** Below this speed the rider counts as stopped; no calls. m/s. */
  minSpeedForCalls: number;
  /** Speed assumed before anything better is known. m/s. */
  fallbackSpeed: number;
  /**
   * Smoothing factor (0-1) for speed derived from positions, used when the
   * platform does not report speed. GPS noise of a few metres at 1 Hz adds
   * several m/s of garbage to a raw position difference, which would make the
   * co-driver call far too early, so derived speed is low-passed.
   */
  derivedSpeedSmoothing: number;
  /** No fix for this long => "GPS lost". Seconds. */
  gpsLostSeconds: number;
  /** Only announce corners at least this tight (rally number <= this). */
  maxRallyNumberToCall: number;
  /** "Sharp right, 80 metres" vs rally "Right 3, 80". */
  rallyMode: boolean;
  /** Distances are rounded to a multiple of this before being spoken. Metres. */
  distanceRoundingMeters: number;
  /** Chain the following corner into the same call when it is "into". */
  chainIntoCorners: boolean;
  /** Most corners allowed in one chained call, including the first. */
  maxChainedCorners: number;
  /** Say "back on route" after an off-route excursion ends. */
  announceBackOnRoute: boolean;
  /**
   * Sustained travel against the route direction before a U-turn is accepted
   * and the route starts being called backwards. Metres.
   *
   * Big enough that GPS jitter, a stop, or rolling back at a junction never
   * triggers it; small enough that turning round at a viewpoint is picked up
   * before the next corner arrives.
   */
  uTurnMeters: number;
  /** Say something when the route starts being called in reverse. */
  announceUTurn: boolean;
  /** Say "route finished" within this distance of the end. Metres. */
  routeEndMeters: number;
}

export interface EngineConfig {
  geometry: GeometryConfig;
  detection: CornerDetectionConfig;
  grading: GradingConfig;
  runtime: RuntimeConfig;
}

export const DEFAULT_CONFIG: EngineConfig = {
  geometry: {
    dedupeMeters: 1,
    resampleMeters: 5,
    smoothing: "savitzky-golay",
    smoothWindow: 13,
    smoothPolyOrder: 2,
    curvatureSpanMeters: 10,
    maxRadiusMeters: 5000,
  },
  detection: {
    cornerRadiusMeters: 300,
    mergeGapMeters: 20,
    minCornerLengthMeters: 10,
    minHeadingChangeDeg: 12,
    shortCornerHeadingChangeDeg: 45,
    longCornerMeters: 80,
    sustainedCurvatureFraction: 0.5,
    intoGapMeters: 30,
    tightensRatio: 0.7,
    opensRatio: 1.4,
  },
  grading: {
    // Tightest first; the first bucket a corner fits into wins.
    thresholds: [
      { grade: "very sharp", maxRadius: 25 },
      { grade: "sharp", maxRadius: 45 },
      { grade: "medium", maxRadius: 80 },
      { grade: "gentle", maxRadius: 150 },
      { grade: "slight", maxRadius: 300 },
    ],
    hairpinHeadingChangeDeg: 135,
    hairpinRadiusMeters: 25,
    rallyNumbers: {
      hairpin: 1,
      "very sharp": 2,
      sharp: 3,
      medium: 4,
      gentle: 5,
      slight: 6,
    },
  },
  runtime: {
    lagSeconds: 1.0,
    leadSeconds: 5.0,
    minLeadMeters: 30,
    maxLeadMeters: 300,
    immediateMeters: 30,
    offRouteMeters: 50,
    snapSearchMeters: 150,
    maxAccuracyMeters: 50,
    minSpeedForCalls: 1.5,
    fallbackSpeed: 11,
    derivedSpeedSmoothing: 0.35,
    gpsLostSeconds: 5,
    maxRallyNumberToCall: 6,
    rallyMode: false,
    distanceRoundingMeters: 10,
    chainIntoCorners: true,
    maxChainedCorners: 3,
    announceBackOnRoute: true,
    uTurnMeters: 60,
    announceUTurn: true,
    routeEndMeters: 50,
  },
};

/** Deep-ish merge of a partial override onto the defaults (one level per section). */
export function resolveConfig(partial?: DeepPartial<EngineConfig>): EngineConfig {
  if (!partial) return DEFAULT_CONFIG;
  return {
    geometry: { ...DEFAULT_CONFIG.geometry, ...(partial.geometry ?? {}) },
    detection: { ...DEFAULT_CONFIG.detection, ...(partial.detection ?? {}) },
    grading: {
      ...DEFAULT_CONFIG.grading,
      ...(partial.grading ?? {}),
      thresholds: partial.grading?.thresholds
        ? (partial.grading.thresholds as GradingConfig["thresholds"])
        : DEFAULT_CONFIG.grading.thresholds,
      rallyNumbers: {
        ...DEFAULT_CONFIG.grading.rallyNumbers,
        ...(partial.grading?.rallyNumbers ?? {}),
      },
    },
    runtime: { ...DEFAULT_CONFIG.runtime, ...(partial.runtime ?? {}) },
  };
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
