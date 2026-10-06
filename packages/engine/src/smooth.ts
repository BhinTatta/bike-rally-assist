/**
 * Smoothing. Run after resampling, so the window is a known number of metres.
 *
 * Why it matters: raw GPS jitter is a few metres, and a 5 m sample spacing turns
 * that jitter into curvature noise that looks like a 15 m-radius corner. It also
 * does the opposite favour on sparse map data, rounding the single sharp vertex
 * of a 3-point hairpin into an arc a motorcycle could actually ride.
 */

import { makeFrame, toLocal, fromLocal, type Vec2 } from "./geo.js";
import type { GeoPoint } from "./types.js";

/** Force a window to be odd and at least 3, and no longer than the data. */
function normaliseWindow(window: number, n: number): number {
  let w = Math.max(3, Math.round(window));
  if (w % 2 === 0) w += 1;
  if (w > n) w = n % 2 === 0 ? n - 1 : n;
  return Math.max(3, w);
}

/** Clamp an index into [0, n-1] so windows can run off the ends. */
const clampIndex = (i: number, n: number): number =>
  i < 0 ? 0 : i >= n ? n - 1 : i;

/**
 * Savitzky-Golay coefficients for the smoothed value at the centre of the
 * window, for a polynomial of the given order on evenly spaced samples.
 *
 * Solved directly from the normal equations of the least-squares fit; for the
 * centre point only the first row of (A^T A)^-1 A^T is needed.
 */
export function savitzkyGolayCoefficients(
  window: number,
  order: number,
): number[] {
  const half = (window - 1) / 2;
  const p = Math.min(order, window - 1);
  // Moment matrix M[i][j] = sum_k k^(i+j).
  const m: number[][] = [];
  for (let i = 0; i <= p; i++) {
    const row: number[] = [];
    for (let j = 0; j <= p; j++) {
      let s = 0;
      for (let k = -half; k <= half; k++) s += Math.pow(k, i + j);
      row.push(s);
    }
    m.push(row);
  }
  // Solve M c = e0 by Gaussian elimination; c then weights the sums of k^i*y.
  const n = p + 1;
  const aug = m.map((row, i) => [...row, i === 0 ? 1 : 0]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r]![col]!) > Math.abs(aug[pivot]![col]!)) pivot = r;
    }
    [aug[col], aug[pivot]] = [aug[pivot]!, aug[col]!];
    const pv = aug[col]![col]!;
    if (Math.abs(pv) < 1e-12) continue;
    for (let c = col; c <= n; c++) aug[col]![c]! /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = aug[r]![col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) aug[r]![c]! -= f * aug[col]![c]!;
    }
  }
  const c = aug.map((row) => row[n]!);
  // Weight for sample k is sum_i c_i * k^i.
  const coeffs: number[] = [];
  for (let k = -half; k <= half; k++) {
    let w = 0;
    for (let i = 0; i <= p; i++) w += c[i]! * Math.pow(k, i);
    coeffs.push(w);
  }
  return coeffs;
}

function smoothWithKernel(points: GeoPoint[], kernel: number[]): GeoPoint[] {
  const n = points.length;
  if (n < 3) return points.map((p) => ({ ...p }));
  const half = (kernel.length - 1) / 2;
  const frame = makeFrame(points[0]!);
  const local: Vec2[] = points.map((p) => toLocal(frame, p));
  const out: GeoPoint[] = [];
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    for (let k = -half; k <= half; k++) {
      const w = kernel[k + half]!;
      const v = local[clampIndex(i + k, n)]!;
      x += w * v.x;
      y += w * v.y;
    }
    const geo = fromLocal(frame, { x, y });
    const src = points[i]!;
    const p: GeoPoint = { lat: geo.lat, lon: geo.lon };
    if (src.ele !== undefined) p.ele = src.ele;
    if (src.time !== undefined) p.time = src.time;
    out.push(p);
  }
  return out;
}

export function movingAverage(points: GeoPoint[], window: number): GeoPoint[] {
  const w = normaliseWindow(window, points.length);
  return smoothWithKernel(points, new Array<number>(w).fill(1 / w));
}

export function savitzkyGolay(
  points: GeoPoint[],
  window: number,
  order = 2,
): GeoPoint[] {
  const w = normaliseWindow(window, points.length);
  return smoothWithKernel(points, savitzkyGolayCoefficients(w, order));
}

export function smooth(
  points: GeoPoint[],
  mode: "savitzky-golay" | "moving-average" | "none",
  window: number,
  order = 2,
): GeoPoint[] {
  switch (mode) {
    case "none":
      return points.map((p) => ({ ...p }));
    case "moving-average":
      return movingAverage(points, window);
    case "savitzky-golay":
      return savitzkyGolay(points, window, order);
  }
}
