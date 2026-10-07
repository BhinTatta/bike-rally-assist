/**
 * AsyncStorage-backed cache for fetched OSM road networks, so a route imported
 * at home still has its roads on a ghat with no signal.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { KeyValueStore } from "@rally/osm";

export class AsyncStorageStore implements KeyValueStore {
  constructor(private readonly prefix = "rally.osm.") {}

  async get(key: string): Promise<string | null> {
    return AsyncStorage.getItem(this.prefix + key);
  }

  async set(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(this.prefix + key, value);
  }
}
