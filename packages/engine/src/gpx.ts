/**
 * A deliberately small GPX reader/writer.
 *
 * GPX is a simple, flat format and we only care about four things: latitude,
 * longitude, elevation and time. Rather than pull an XML library into a package
 * that must run on React Native, we scan for the handful of tags we need.
 *
 * Handles `<trkpt>` (tracks, possibly several segments), `<rtept>` (planner
 * routes) and falls back to `<wpt>` if the file has nothing else.
 */

import type { GeoPoint } from "./types.js";

export interface ParsedGpx {
  name?: string;
  points: GeoPoint[];
  /** Which element the points came from - useful for warning about rough routes. */
  source: "track" | "route" | "waypoints" | "none";
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m);
}

/** Pull the text content of the first `<tag>` inside `xml`. */
function firstTagText(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(
    xml,
  );
  return m?.[1] !== undefined ? decodeEntities(m[1].trim()) : undefined;
}

/**
 * Match every point element of the given name, capturing its attributes and
 * (if it is not self-closing) its body.
 */
function matchPoints(xml: string, tag: string): GeoPoint[] {
  const re = new RegExp(
    `<${tag}\\s([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`,
    "gi",
  );
  const points: GeoPoint[] = [];
  for (const m of xml.matchAll(re)) {
    const attrs = m[1] ?? "";
    const body = m[2] ?? "";
    const lat = Number(/\blat\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]);
    const lon = Number(/\blon\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const point: GeoPoint = { lat, lon };

    const eleText = body ? firstTagText(body, "ele") : undefined;
    if (eleText !== undefined) {
      const ele = Number(eleText);
      if (Number.isFinite(ele)) point.ele = ele;
    }

    const timeText = body ? firstTagText(body, "time") : undefined;
    if (timeText !== undefined) {
      const t = Date.parse(timeText);
      if (Number.isFinite(t)) point.time = t;
    }
    points.push(point);
  }
  return points;
}

export function parseGpx(xml: string): ParsedGpx {
  const trackPoints = matchPoints(xml, "trkpt");
  if (trackPoints.length > 0) {
    return { name: gpxName(xml), points: trackPoints, source: "track" };
  }
  const routePoints = matchPoints(xml, "rtept");
  if (routePoints.length > 0) {
    return { name: gpxName(xml), points: routePoints, source: "route" };
  }
  const waypoints = matchPoints(xml, "wpt");
  if (waypoints.length > 0) {
    return { name: gpxName(xml), points: waypoints, source: "waypoints" };
  }
  return { name: gpxName(xml), points: [], source: "none" };
}

/** Prefer the track/route name over the file-level metadata name. */
function gpxName(xml: string): string | undefined {
  const container =
    /<trk(?:\s[^>]*)?>[\s\S]*?<\/trk>/i.exec(xml)?.[0] ??
    /<rte(?:\s[^>]*)?>[\s\S]*?<\/rte>/i.exec(xml)?.[0] ??
    /<metadata(?:\s[^>]*)?>[\s\S]*?<\/metadata>/i.exec(xml)?.[0];
  return container ? firstTagText(container, "name") : undefined;
}

const escapeXml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[
        c
      ] ?? c,
  );

/**
 * Write points back out as a GPX track. Used by the ride logger (so a ride can
 * be replayed through the CLI simulator) and by the test fixtures.
 */
export function toGpx(points: GeoPoint[], name = "Ride"): string {
  const body = points
    .map((p) => {
      const parts = [
        `    <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">`,
      ];
      if (p.ele !== undefined) parts.push(`      <ele>${p.ele.toFixed(1)}</ele>`);
      if (p.time !== undefined)
        parts.push(`      <time>${new Date(p.time).toISOString()}</time>`);
      parts.push("    </trkpt>");
      return parts.join("\n");
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="bike-rally-assist" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${body}
    </trkseg>
  </trk>
</gpx>
`;
}
