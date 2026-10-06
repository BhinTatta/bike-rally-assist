/**
 * `rally debug-map <gpx>` - write a standalone Leaflet page showing the route
 * with every corner coloured by grade.
 *
 * Deliberately a single self-contained HTML file: open it with a double click,
 * no server, no build step, no API key. Leaflet and the OSM tiles come from
 * their public CDNs, so it needs internet the first time you open it.
 */

import { writeFileSync } from "node:fs";
import { routeStats } from "@rally/engine";
import type { AnalysedRoute } from "@rally/engine";
import { configFromFlags, dim, loadRoute } from "../util.js";

/** Grade -> line colour. Hot colours for the corners that will hurt. */
const GRADE_COLOURS: Record<string, string> = {
  hairpin: "#ff00c8",
  "very sharp": "#ff2d2d",
  sharp: "#ff8c00",
  medium: "#ffd400",
  gentle: "#5ad469",
  slight: "#49a0ff",
};

interface Segment {
  coords: [number, number][];
  colour: string;
  label: string;
}

/** Split the route into straight segments and corner segments. */
function buildSegments(route: AnalysedRoute): Segment[] {
  const segments: Segment[] = [];
  const coordsBetween = (from: number, to: number): [number, number][] =>
    route.points
      .filter((p) => p.dist >= from && p.dist <= to)
      .map((p) => [p.lat, p.lon] as [number, number]);

  let cursor = 0;
  for (const corner of route.corners) {
    if (corner.startDist > cursor) {
      segments.push({
        coords: coordsBetween(cursor, corner.startDist),
        colour: "#8a8a8a",
        label: "",
      });
    }
    segments.push({
      coords: coordsBetween(corner.startDist, corner.endDist),
      colour: GRADE_COLOURS[corner.grade] ?? "#8a8a8a",
      label: [
        `<b>#${corner.id} ${corner.grade} ${corner.direction}</b> (rally ${corner.rallyNumber})`,
        `min radius: ${corner.minRadius.toFixed(0)} m`,
        `heading change: ${corner.headingChange.toFixed(0)}&deg;`,
        `length: ${corner.length.toFixed(0)} m`,
        `at ${(corner.startDist / 1000).toFixed(2)} km`,
        corner.modifiers.length > 0 ? `modifiers: ${corner.modifiers.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("<br>"),
    });
    cursor = corner.endDist;
  }
  if (cursor < route.length) {
    segments.push({ coords: coordsBetween(cursor, route.length), colour: "#8a8a8a", label: "" });
  }
  return segments.filter((s) => s.coords.length >= 2);
}

function renderHtml(route: AnalysedRoute, title: string): string {
  const segments = buildSegments(route);
  const stats = routeStats(route);
  const legend = Object.entries(GRADE_COLOURS)
    .map(
      ([grade, colour]) =>
        `<div><span class="swatch" style="background:${colour}"></span>${grade} (${stats.byGrade[grade] ?? 0})</div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - corners</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  html, body, #map { height: 100%; margin: 0; }
  body { font: 13px/1.4 system-ui, sans-serif; }
  .panel {
    position: absolute; z-index: 1000; top: 10px; right: 10px; width: 220px;
    background: rgba(255,255,255,.94); padding: 10px 12px; border-radius: 8px;
    box-shadow: 0 1px 6px rgba(0,0,0,.3);
  }
  .panel h1 { font-size: 14px; margin: 0 0 6px; }
  .panel div { margin: 2px 0; }
  .swatch { display: inline-block; width: 12px; height: 12px; border-radius: 2px;
            margin-right: 6px; vertical-align: -1px; }
  .stat { color: #555; }
</style>
</head>
<body>
<div id="map"></div>
<div class="panel">
  <h1>${title}</h1>
  <div class="stat">${(route.length / 1000).toFixed(2)} km &middot; ${stats.cornerCount} corners &middot; ${stats.cornersPerKm.toFixed(1)}/km</div>
  <hr>
  ${legend}
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const segments = ${JSON.stringify(segments)};
  const apexes = ${JSON.stringify(
    route.corners.map((c) => ({
      lat: c.apex.lat,
      lon: c.apex.lon,
      colour: GRADE_COLOURS[c.grade] ?? "#8a8a8a",
      label: `#${c.id} ${c.grade} ${c.direction}, apex radius ${c.minRadius.toFixed(0)} m`,
    })),
  )};
  const map = L.map('map');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  const group = L.featureGroup();
  for (const seg of segments) {
    const line = L.polyline(seg.coords, { color: seg.colour, weight: seg.label ? 6 : 3, opacity: 0.9 });
    if (seg.label) line.bindPopup(seg.label);
    line.addTo(group);
  }
  for (const apex of apexes) {
    L.circleMarker([apex.lat, apex.lon], {
      radius: 4, color: '#000', weight: 1, fillColor: apex.colour, fillOpacity: 1
    }).bindTooltip(apex.label).addTo(group);
  }
  group.addTo(map);
  map.fitBounds(group.getBounds(), { padding: [30, 30] });
</script>
</body>
</html>
`;
}

export function debugMapCommand(
  file: string,
  values: Record<string, unknown>,
): void {
  const route = loadRoute(file, configFromFlags(values));
  const out = typeof values["out"] === "string" ? values["out"] : "debug-map.html";
  writeFileSync(out, renderHtml(route, route.name ?? file));
  console.log(
    dim(
      `Wrote ${out} (${route.corners.length} corners over ${(route.length / 1000).toFixed(2)} km) - open it in a browser.`,
    ),
  );
}
