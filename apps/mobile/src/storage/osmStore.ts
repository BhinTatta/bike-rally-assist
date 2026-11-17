/**
 * File-backed cache for fetched OSM road networks, so a route imported at home
 * still has its roads on a ghat with no signal.
 *
 * Files rather than AsyncStorage: a long corridor's road network runs to
 * several megabytes, and Android's AsyncStorage cannot read back a single
 * value larger than about two.
 */

import type { KeyValueStore } from "@rally/osm";

import { readText, writeText } from "./files";

export class FileStore implements KeyValueStore {
  constructor(private readonly dir = "osm") {}

  async get(key: string): Promise<string | null> {
    return readText(`${this.dir}/${key}.json`);
  }

  async set(key: string, value: string): Promise<void> {
    writeText(`${this.dir}/${key}.json`, value);
  }
}
