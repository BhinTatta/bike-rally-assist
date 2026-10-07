/**
 * Caching, so a route imported at home works on a ghat with no signal.
 *
 * The store is injected: the CLI passes a directory on disk, the app passes an
 * AsyncStorage-backed one. This package only knows about get/set of strings.
 */

import type { KeyValueStore, RoadNetwork } from "./types.js";

/** An in-memory store. Useful for tests and as a default. */
export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  get size(): number {
    return this.map.size;
  }
}

interface CachedNetwork {
  version: number;
  network: RoadNetwork;
}

/** Bump when the stored shape changes, so old entries are ignored. */
const CACHE_VERSION = 1;

export async function readCachedNetwork(
  store: KeyValueStore,
  key: string,
  maxAgeMs: number,
): Promise<RoadNetwork | null> {
  let raw: string | null;
  try {
    raw = await store.get(key);
  } catch {
    return null; // a broken cache must never break an import
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedNetwork;
    if (parsed.version !== CACHE_VERSION || !parsed.network?.ways) return null;
    if (Date.now() - parsed.network.fetchedAt > maxAgeMs) return null;
    return parsed.network;
  } catch {
    return null;
  }
}

export async function writeCachedNetwork(
  store: KeyValueStore,
  key: string,
  network: RoadNetwork,
): Promise<void> {
  try {
    await store.set(key, JSON.stringify({ version: CACHE_VERSION, network }));
  } catch {
    // Out of disk, quota exceeded, read-only store: not worth failing over.
  }
}
