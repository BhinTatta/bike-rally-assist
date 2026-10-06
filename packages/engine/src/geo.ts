/**
 * Geodesy helpers. Everything is plain arithmetic - no dependencies.
 *
 * Distances use the haversine formula on a sphere; over the few-kilometre
 * scales a ghat road covers, that is well inside GPS noise.
 */

import type { GeoPoint } from "./types.js";

/** Mean Earth radius (IUGG), metres. */
export const EARTH_RADIUS_M = 6371008.8;

export const toRad = (deg: number): number => (deg * Math.PI) / 180;
export const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Great-circle distance between two points, metres. */
export function haversine(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north, in [0, 360). */
export function bearing(a: GeoPoint, b: GeoPoint): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest signed difference b - a in degrees, in (-180, 180]. */
export function headingDelta(a: number, b: number): number {
  let d = ((b - a + 540) % 360) - 180;
  if (d === -180) d = 180;
  return d;
}

/** A point `distance` metres from `from` along `bearingDeg`. */
export function destination(
  from: GeoPoint,
  distance: number,
  bearingDeg: number,
): GeoPoint {
  const d = distance / EARTH_RADIUS_M;
  const brg = toRad(bearingDeg);
  const lat1 = toRad(from.lat);
  const lon1 = toRad(from.lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

/**
 * A flat local frame in metres, anchored at an origin.
 *
 * Curvature maths is far easier (and faster) in metres than in degrees, and an
 * equirectangular projection is exact enough over a corner-sized patch of road.
 */
export interface LocalFrame {
  origin: GeoPoint;
  /** Metres per degree of longitude at the origin latitude. */
  mPerDegLon: number;
  /** Metres per degree of latitude. */
  mPerDegLat: number;
}

export function makeFrame(origin: GeoPoint): LocalFrame {
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  return {
    origin,
    mPerDegLat,
    mPerDegLon: mPerDegLat * Math.cos(toRad(origin.lat)),
  };
}

export interface Vec2 {
  /** Metres east of the frame origin. */
  x: number;
  /** Metres north of the frame origin. */
  y: number;
}

export function toLocal(frame: LocalFrame, p: GeoPoint): Vec2 {
  return {
    x: (p.lon - frame.origin.lon) * frame.mPerDegLon,
    y: (p.lat - frame.origin.lat) * frame.mPerDegLat,
  };
}

export function fromLocal(frame: LocalFrame, v: Vec2): GeoPoint {
  return {
    lat: frame.origin.lat + v.y / frame.mPerDegLat,
    lon: frame.origin.lon + v.x / frame.mPerDegLon,
  };
}

/**
 * Interpolate between two points. `t` is a fraction of the way from a to b.
 * Linear in lat/lon, which at the scales we resample at (metres) is fine.
 */
export function interpolate(a: GeoPoint, b: GeoPoint, t: number): GeoPoint {
  const p: GeoPoint = {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
  };
  if (a.ele !== undefined && b.ele !== undefined) {
    p.ele = a.ele + (b.ele - a.ele) * t;
  }
  if (a.time !== undefined && b.time !== undefined) {
    p.time = Math.round(a.time + (b.time - a.time) * t);
  }
  return p;
}

/**
 * Perpendicular distance from point p to segment a-b, plus how far along the
 * segment the closest point lies (0..1).
 */
export function pointToSegment(
  p: GeoPoint,
  a: GeoPoint,
  b: GeoPoint,
): { distance: number; t: number } {
  const frame = makeFrame(a);
  const pv = toLocal(frame, p);
  const bv = toLocal(frame, b);
  const len2 = bv.x * bv.x + bv.y * bv.y;
  if (len2 === 0) return { distance: Math.hypot(pv.x, pv.y), t: 0 };
  let t = (pv.x * bv.x + pv.y * bv.y) / len2;
  t = Math.max(0, Math.min(1, t));
  const dx = pv.x - bv.x * t;
  const dy = pv.y - bv.y * t;
  return { distance: Math.hypot(dx, dy), t };
}
