/**
 * A file-backed cache for fetched OSM road networks.
 *
 * Lives in the CLI (not in @rally/osm) so that package stays free of Node
 * APIs: the app plugs in an AsyncStorage-backed store instead.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KeyValueStore } from "@rally/osm";

export class FileStore implements KeyValueStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  async get(key: string): Promise<string | null> {
    try {
      return readFileSync(join(this.dir, `${key}.json`), "utf8");
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    writeFileSync(join(this.dir, `${key}.json`), value);
  }
}

/** Default cache location: `.rally-cache` beside wherever you ran the CLI. */
export const defaultCacheDir = (): string => join(process.cwd(), ".rally-cache");
