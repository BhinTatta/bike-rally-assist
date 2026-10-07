/**
 * Core data types shared by every stage of the engine.
 *
 * Everything here is plain data (JSON-serialisable) so routes can be cached on
 * disk / in AsyncStorage and shipped between the CLI, the app and the tests.
 */

/** A raw geographic point, as it comes out of a GPX file or a GPS receiver. */
export interface GeoPoint {
  lat: number;
  lon: number;
  /** Metres above sea level, if the source provided it. */
  ele?: number;
  /** Unix epoch milliseconds, if the source provided it. */
  time?: number;
}

/** A point after resampling: still geographic, but with route-relative info. */
export interface RoutePoint extends GeoPoint {
  /** Distance along the route from the start, in metres. */
  dist: number;
  /**
   * Signed curvature, 1/metres. Positive = turning left, negative = right.
   * (Right-hand rule in a local east/north frame.)
   */
  curvature: number;
  /** Course over ground at this point, degrees clockwise from north. */
  heading: number;
}

/** Which way the bars go. */
export type Direction = "left" | "right";

/**
 * Severity buckets, tightest first. These are the words the co-driver speaks,
 * so keep them pronounceable.
 */
export type CornerGrade =
  | "hairpin"
  | "very sharp"
  | "sharp"
  | "medium"
  | "gentle"
  | "slight";

/** Extra descriptions appended to a call. */
export type CornerModifier = "tightens" | "opens" | "long" | "into";

export interface Corner {
  /** Stable index within the route, 0-based, in route order. */
  id: number;
  direction: Direction;
  /** Distance along the route where the corner starts, metres. */
  startDist: number;
  /** Distance along the route where the corner ends, metres. */
  endDist: number;
  /** Distance along the route of the tightest point, metres. */
  apexDist: number;
  /** Position of the tightest point (handy for drawing maps). */
  apex: GeoPoint;
  /** Tightest radius inside the corner, metres. */
  minRadius: number;
  /** Mean radius across the corner, metres (used for "tightens"/"opens"). */
  meanRadius: number;
  /** Total heading change through the corner, degrees, always positive. */
  headingChange: number;
  /** endDist - startDist, metres: includes the entry and exit blend. */
  length: number;
  /**
   * Length of the part of the corner that is actually tight - where the radius
   * is within `sustainedCurvatureFraction` of the apex. This is "how long you
   * are leaned over", and is what the "long" modifier is based on.
   */
  sustainedLength: number;
  grade: CornerGrade;
  /** Rally-style number: 1 = tightest, 6 = barely a corner. */
  rallyNumber: number;
  modifiers: CornerModifier[];
}

/** A route that has been resampled, smoothed and analysed. */
export interface AnalysedRoute {
  /** Optional name from the GPX `<name>` element. */
  name?: string;
  /** Resampled + smoothed points, evenly spaced along the route. */
  points: RoutePoint[];
  corners: Corner[];
  /** Total route length, metres. */
  length: number;
  /** Spacing actually used between points, metres. */
  spacing: number;
}

/** One GPS fix handed to the runtime co-driver. */
export interface GpsFix {
  lat: number;
  lon: number;
  /** Ground speed in metres per second. Negative/NaN is treated as unknown. */
  speed?: number;
  /** Course over ground, degrees from north. Optional; only used as a hint. */
  heading?: number;
  /** Horizontal accuracy in metres, if the platform reports it. */
  accuracy?: number;
  /** Unix epoch milliseconds. */
  time: number;
}

/** What kind of thing the co-driver is saying. */
export type CallKind =
  | "corner"
  | "off-route"
  | "back-on-route"
  | "gps-lost"
  | "gps-restored"
  | "route-start"
  | "route-end"
  | "reversed";

/**
 * A single utterance. `text` is for TTS; `tokens` is the same thing split into
 * atoms so it can be stitched from pre-recorded clips later.
 */
export interface Call {
  kind: CallKind;
  /** Corner ids covered by this call (chained "into" corners give 2+). */
  cornerIds: number[];
  text: string;
  tokens: string[];
  /** Fix time that produced the call, epoch ms. */
  time: number;
  /** Distance from the (lag-compensated) rider to the corner entry, metres. */
  distance?: number;
  /** Seconds to the corner entry at the current speed. */
  timeToCorner?: number;
  /** Rider's distance along the route when the call fired, metres. */
  riderDist?: number;
  /** Rider's speed when the call fired, m/s. */
  speed?: number;
}

/** Where the rider currently is, relative to the route. */
export interface SnapResult {
  /** Index of the nearest resampled point. */
  index: number;
  /** Distance along the route, metres. */
  dist: number;
  /** Perpendicular distance from the route, metres. */
  offset: number;
  onRoute: boolean;
}
