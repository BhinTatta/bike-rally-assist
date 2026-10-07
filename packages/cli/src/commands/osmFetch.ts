/**
 * `rally osm-fetch <gpx>` - download the OSM roads along a route and save them.
 *
 * Useful on its own (warm the cache at home before a ride where there is no
 * signal) and useful for development: the saved file can be replayed into
 * `--osm-file` so matching can be worked on without touching Overpass.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseGpx } from "@rally/engine";
import {
  buildQuery,
  cacheKey,
  corridorBoxes,
  fetchRoadNetwork,
  resolveOsmConfig,
  writeCachedNetwork,
} from "@rally/osm";
import { bold, dim, green } from "../util.js";
import { FileStore, defaultCacheDir } from "../osmStore.js";

export async function osmFetchCommand(
  file: string,
  values: Record<string, unknown>,
): Promise<void> {
  const parsed = parseGpx(readFileSync(file, "utf8"));
  if (parsed.points.length < 2) throw new Error("GPX contains fewer than 2 usable points");

  const config = resolveOsmConfig();
  const boxes = corridorBoxes(parsed.points, config);
  console.log(bold(`\n${parsed.name ?? file}`));
  console.log(dim(`${boxes.length} corridor box(es), ${config.corridorMeters} m either side`));

  if (values["print-query"] === true) {
    console.log("\n" + buildQuery(boxes, config));
    return;
  }

  const network = await fetchRoadNetwork(parsed.points, {
    onProgress: (message) => console.log(dim(`  ${message}`)),
  });

  const cacheDir =
    typeof values["cache-dir"] === "string" ? values["cache-dir"] : defaultCacheDir();
  await writeCachedNetwork(new FileStore(cacheDir), cacheKey(boxes, config), network);
  console.log(green(`Cached ${network.ways.length} ways in ${cacheDir}`));

  if (typeof values["out"] === "string") {
    // Saved in Overpass's own shape so it can be fed back in with --osm-file.
    writeFileSync(
      values["out"],
      JSON.stringify({
        version: 0.6,
        generator: "rally osm-fetch",
        elements: network.ways.map((way) => ({
          type: "way",
          id: way.id,
          tags: way.tags,
          geometry: way.geometry.map((p) => ({ lat: p.lat, lon: p.lon })),
        })),
      }),
    );
    console.log(dim(`Wrote ${values["out"]}`));
  }
}
