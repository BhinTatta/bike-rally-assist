/**
 * Tunables for OSM fetching and map matching. Same idea as the engine's
 * config: one object, nothing hard-coded elsewhere.
 */

export interface OsmConfig {
  /** Overpass endpoints, tried in order. */
  endpoints: string[];
  /** Overpass `timeout:` value, seconds. */
  queryTimeoutSeconds: number;
  /** Abort a request that takes longer than this, milliseconds. */
  requestTimeoutMs: number;
  /** Retries per endpoint before moving to the next one. */
  retries: number;
  /** Base delay for the retry backoff, milliseconds. */
  retryBackoffMs: number;
  /**
   * How far either side of the route to look for roads, metres. Wide enough
   * to cover a badly drawn planner line, narrow enough not to drag in the
   * parallel road down in the valley.
   */
  corridorMeters: number;
  /** The route is split into chunks of this length, one bbox each. Metres. */
  corridorChunkMeters: number;
  /** OSM `highway=*` values worth riding. */
  highwayTypes: string[];
  /** Cache entries older than this are refetched. Milliseconds. */
  cacheMaxAgeMs: number;

  // --- matching ---
  /** GPX is resampled to this spacing before matching. Metres. */
  sampleSpacingMeters: number;
  /** Candidates are road points within this distance of a sample. Metres. */
  searchRadiusMeters: number;
  /** Most candidates kept per sample (the nearest ones win). */
  maxCandidates: number;
  /** Emission noise: how far a GPX point is expected to sit from the road. Metres. */
  gpsSigmaMeters: number;
  /** Transition scale: tolerance on "distance travelled along the road". Metres. */
  transitionBetaMeters: number;
  /** Extra cost for hopping to a different way mid-step. */
  wayChangePenalty: number;
  /** Extra cost for hopping to a way that shares no node with the current one. */
  disconnectedPenalty: number;
  /** Cost multiplier for travelling along a way against the GPS heading. */
  headingPenalty: number;

  // --- acceptance ---
  /** Reject the match below this matched fraction. */
  minMatchedFraction: number;
  /** Reject the match above this mean offset. Metres. */
  maxMeanOffsetMeters: number;
  /** Reject the match outside this length ratio band. */
  minLengthRatio: number;
  maxLengthRatio: number;
}

export const DEFAULT_OSM_CONFIG: OsmConfig = {
  endpoints: [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ],
  queryTimeoutSeconds: 90,
  requestTimeoutMs: 120_000,
  retries: 2,
  retryBackoffMs: 1500,
  corridorMeters: 150,
  corridorChunkMeters: 5000,
  highwayTypes: [
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
    "living_street",
    "road",
    "motorway_link",
    "trunk_link",
    "primary_link",
    "secondary_link",
    "tertiary_link",
    "track",
  ],
  cacheMaxAgeMs: 180 * 24 * 60 * 60 * 1000, // six months; roads move slowly

  sampleSpacingMeters: 15,
  searchRadiusMeters: 35,
  maxCandidates: 6,
  gpsSigmaMeters: 12,
  transitionBetaMeters: 12,
  wayChangePenalty: 1.5,
  disconnectedPenalty: 6,
  headingPenalty: 4,

  minMatchedFraction: 0.8,
  maxMeanOffsetMeters: 20,
  minLengthRatio: 0.85,
  maxLengthRatio: 1.2,
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function resolveOsmConfig(partial?: Partial<OsmConfig>): OsmConfig {
  return { ...DEFAULT_OSM_CONFIG, ...(partial ?? {}) };
}
