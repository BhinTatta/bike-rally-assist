import { describe, expect, it } from "vitest";
import { parseGpx, toGpx } from "../src/gpx.js";

const TRACK_GPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="test">
  <metadata><name>File name</name></metadata>
  <trk><name>Tamhini &amp; back</name><trkseg>
    <trkpt lat="18.4521" lon="73.4123"><ele>612.0</ele><time>2024-01-01T06:00:00Z</time></trkpt>
    <trkpt lat="18.4523" lon="73.4125"/>
  </trkseg><trkseg>
    <trkpt lat="18.4525" lon="73.4127"></trkpt>
  </trkseg></trk>
</gpx>`;

const ROUTE_GPX = `<gpx version="1.1"><rte><name>Planner route</name>
  <rtept lat="18.1" lon="73.1"/><rtept lat="18.2" lon="73.2"/></rte></gpx>`;

describe("gpx", () => {
  it("reads track points across segments, with ele and time", () => {
    const parsed = parseGpx(TRACK_GPX);
    expect(parsed.source).toBe("track");
    expect(parsed.points).toHaveLength(3);
    expect(parsed.name).toBe("Tamhini & back");
    expect(parsed.points[0]!.ele).toBe(612);
    expect(parsed.points[0]!.time).toBe(Date.parse("2024-01-01T06:00:00Z"));
    expect(parsed.points[1]!.ele).toBeUndefined();
  });

  it("falls back to route points", () => {
    const parsed = parseGpx(ROUTE_GPX);
    expect(parsed.source).toBe("route");
    expect(parsed.points).toHaveLength(2);
    expect(parsed.name).toBe("Planner route");
  });

  it("reports nothing usable for an empty gpx", () => {
    expect(parseGpx("<gpx></gpx>").points).toHaveLength(0);
  });

  it("round-trips through the writer", () => {
    const points = [
      { lat: 18.4521, lon: 73.4123, ele: 612, time: Date.parse("2024-01-01T06:00:00Z") },
      { lat: 18.4523, lon: 73.4125, ele: 613, time: Date.parse("2024-01-01T06:00:01Z") },
    ];
    const reparsed = parseGpx(toGpx(points, "Ride <1>"));
    expect(reparsed.name).toBe("Ride <1>");
    expect(reparsed.points[1]!.lat).toBeCloseTo(18.4523, 6);
    expect(reparsed.points[1]!.time).toBe(points[1]!.time);
  });
});
