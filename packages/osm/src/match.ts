/**
 * Map matching: put a rough GPX line onto the road network.
 *
 * This is a Hidden Markov Model matcher in the style of Newson & Krumm (2009),
 * trimmed to what a phone can afford:
 *
 *   states       - candidate projections of each GPX sample onto nearby roads,
 *   emission     - how far the sample sits from that bit of road,
 *   transition   - how well "distance travelled along the road" agrees with
 *                  "distance travelled by the GPX", plus penalties for hopping
 *                  between ways that do not touch, and for travelling a way
 *                  against the direction the GPX is going,
 *   Viterbi      - pick the cheapest path through all of that.
 *
 * The output is not the sampled points snapped sideways: it is the *OSM
 * geometry itself*, sliced between the matched positions. That is the whole
 * point - OSM has the dense, surveyed shape of the hairpin that the planner's
 * GPX drew with three points.
 */

import {
  cumulativeDistances,
  dedupe,
  haversine,
  headingDelta,
  bearing,
  resample,
} from "@rally/engine";
import type { GeoPoint } from "@rally/engine";
import { resolveOsmConfig, type OsmConfig } from "./config.js";
import { IndexedNetwork, type RoadPosition } from "./network.js";
import type { MatchQuality, MatchResult, RoadNetwork } from "./types.js";

interface Node {
  position: RoadPosition;
  cost: number;
  /** Index of the chosen node in the previous layer, -1 for the first layer. */
  previous: number;
  /** Which GPX sample this layer belongs to (layers skip unmatched samples). */
  sampleIndex: number;
}

/** Cost of a sample sitting `offset` metres from the road. */
const emissionCost = (offset: number, sigma: number): number =>
  0.5 * (offset / sigma) ** 2;

/**
 * Cost of moving from one road position to another between two GPX samples.
 */
function transitionCost(
  from: RoadPosition,
  to: RoadPosition,
  gpsStep: number,
  gpsBearing: number,
  network: IndexedNetwork,
  config: OsmConfig,
): number {
  let travelled: number;
  let cost = 0;

  if (from.wayIndex === to.wayIndex) {
    const delta = to.along - from.along;
    travelled = Math.abs(delta);
    // Which way are we going along this way, and does the road agree with the
    // GPX? Going the wrong way down a way is how a matcher ends up riding a
    // hairpin backwards.
    const travelBearing = delta >= 0 ? to.bearing : (to.bearing + 180) % 360;
    const misalignment = Math.abs(headingDelta(travelBearing, gpsBearing));
    cost += config.headingPenalty * (1 - Math.cos((misalignment * Math.PI) / 180)) * 0.5;
  } else {
    travelled = haversine(from.point, to.point);
    cost += config.wayChangePenalty;
    if (!network.connected(from.wayIndex, to.wayIndex)) {
      cost += config.disconnectedPenalty;
    }
  }

  cost += Math.abs(travelled - gpsStep) / config.transitionBetaMeters;
  return cost;
}

export interface MatchOptions {
  config?: Partial<OsmConfig>;
}

/**
 * Match a GPX track onto the network and return the road geometry to use.
 * Falls back to the raw points whenever the match is not convincingly good.
 */
export function matchToRoads(
  rawPoints: GeoPoint[],
  roadNetwork: RoadNetwork,
  options: MatchOptions = {},
): MatchResult {
  const config = resolveOsmConfig(options.config);
  const cleaned = dedupe(rawPoints, 1);
  const fallback = (reason: string, quality?: Partial<MatchQuality>): MatchResult => ({
    geometry: cleaned,
    usedOsm: false,
    wayIds: [],
    roadNames: [],
    quality: {
      matchedFraction: 0,
      meanOffset: Infinity,
      p90Offset: Infinity,
      lengthRatio: 0,
      wayCount: 0,
      accepted: false,
      reason,
      ...quality,
    },
  });

  if (cleaned.length < 2) return fallback("fewer than two usable points");
  const network = new IndexedNetwork(roadNetwork);
  if (network.isEmpty) return fallback("no roads returned for this corridor");

  const samples = resample(cleaned, config.sampleSpacingMeters);
  if (samples.length < 2) return fallback("route too short to match");

  // --- forward pass -------------------------------------------------------
  const layers: Node[][] = [];
  let unmatched = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]!;
    const candidates = network.candidates(
      sample,
      config.searchRadiusMeters,
      config.maxCandidates,
    );
    if (candidates.length === 0) {
      unmatched++;
      continue; // a gap: the next matched sample simply transitions further
    }

    const previousLayer = layers[layers.length - 1];
    const previousSample = previousLayer
      ? samples[previousLayer[0]!.sampleIndex]
      : undefined;
    const gpsStep = previousSample ? haversine(previousSample, sample) : 0;
    const gpsBearing = previousSample ? bearing(previousSample, sample) : 0;

    const layer: Node[] = candidates.map((position) => {
      let bestCost = emissionCost(position.offset, config.gpsSigmaMeters);
      let bestPrevious = -1;
      if (previousLayer) {
        let best = Infinity;
        for (let p = 0; p < previousLayer.length; p++) {
          const previous = previousLayer[p]!;
          const total =
            previous.cost +
            transitionCost(previous.position, position, gpsStep, gpsBearing, network, config);
          if (total < best) {
            best = total;
            bestPrevious = p;
          }
        }
        bestCost += best;
      }
      return { position, cost: bestCost, previous: bestPrevious, sampleIndex: i };
    });
    layers.push(layer);
  }

  if (layers.length < 2) return fallback("not enough road candidates along the route");

  // --- backtrace ----------------------------------------------------------
  const lastLayer = layers[layers.length - 1]!;
  let bestIndex = 0;
  for (let i = 1; i < lastLayer.length; i++) {
    if (lastLayer[i]!.cost < lastLayer[bestIndex]!.cost) bestIndex = i;
  }
  const path: RoadPosition[] = [];
  for (let layerIndex = layers.length - 1; layerIndex >= 0; layerIndex--) {
    const node = layers[layerIndex]![bestIndex]!;
    path.push(node.position);
    bestIndex = node.previous;
    if (bestIndex < 0 && layerIndex > 0) {
      // Should not happen, but never crash a ride import over it.
      bestIndex = 0;
    }
  }
  path.reverse();

  // --- stitch the OSM geometry back together ------------------------------
  const geometry = stitch(path, network);
  const matchedCount = path.length;
  const totalSamples = matchedCount + unmatched;
  const offsets = path.map((p) => p.offset).sort((a, b) => a - b);
  const rawLength = cumulativeDistances(cleaned).at(-1) ?? 0;
  const matchedLength = cumulativeDistances(geometry).at(-1) ?? 0;

  const wayIds: number[] = [];
  const roadNames: string[] = [];
  for (const position of path) {
    const id = network.ways[position.wayIndex]!.way.id;
    if (wayIds[wayIds.length - 1] !== id) wayIds.push(id);
    const name = network.nameOf(position.wayIndex);
    if (name && roadNames[roadNames.length - 1] !== name) roadNames.push(name);
  }

  const quality: MatchQuality = {
    matchedFraction: totalSamples > 0 ? matchedCount / totalSamples : 0,
    meanOffset: offsets.reduce((a, b) => a + b, 0) / Math.max(1, offsets.length),
    p90Offset: offsets[Math.floor(offsets.length * 0.9)] ?? Infinity,
    lengthRatio: rawLength > 0 ? matchedLength / rawLength : 0,
    wayCount: new Set(wayIds).size,
    accepted: false,
  };

  const reason = rejectionReason(quality, config);
  if (reason) return fallback(reason, quality);

  quality.accepted = true;
  return { geometry, usedOsm: true, quality, wayIds, roadNames };
}

function rejectionReason(quality: MatchQuality, config: OsmConfig): string | undefined {
  if (quality.matchedFraction < config.minMatchedFraction) {
    return `only ${(quality.matchedFraction * 100).toFixed(0)}% of the route is near a road`;
  }
  if (quality.meanOffset > config.maxMeanOffsetMeters) {
    return `mean offset ${quality.meanOffset.toFixed(0)} m is too far from the matched roads`;
  }
  if (
    quality.lengthRatio < config.minLengthRatio ||
    quality.lengthRatio > config.maxLengthRatio
  ) {
    return `matched road length is ${(quality.lengthRatio * 100).toFixed(0)}% of the GPX length`;
  }
  return undefined;
}

/**
 * Turn the matched sequence of road positions into one continuous polyline.
 *
 * Between two positions on the same way we take the real way geometry in
 * between - every surveyed node of the hairpin, not just the two matched
 * points. Across a way change we join straight through, which is a junction
 * and therefore a few metres at most.
 *
 * Working pair by pair (rather than per run of one way) means an out-and-back
 * on a single way is drawn out and back, instead of collapsing to nothing.
 */
function stitch(path: RoadPosition[], network: IndexedNetwork): GeoPoint[] {
  const out: GeoPoint[] = [];
  const push = (point: GeoPoint): void => {
    const last = out[out.length - 1];
    if (!last || haversine(last, point) > 0.05) out.push(point);
  };

  push(path[0]!.point);
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1]!;
    const to = path[i]!;
    if (from.wayIndex === to.wayIndex) {
      for (const point of network.slice(from.wayIndex, from.along, to.along)) push(point);
    } else {
      push(to.point);
    }
  }
  return out;
}
