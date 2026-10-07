/**
 * Rider settings, persisted to AsyncStorage.
 *
 * These map onto the engine's RuntimeConfig; `toEngineConfig` is the single
 * place that translation happens.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DeepPartial, EngineConfig } from "@rally/engine";

export type Verbosity = "all" | "sharp-and-above" | "hairpins-only";

export interface Settings {
  /** Seconds of warning before a corner. */
  leadSeconds: number;
  /** Speech + system latency compensation, seconds. */
  lagSeconds: number;
  /** Which corners are worth saying out loud. */
  verbosity: Verbosity;
  /** "Sharp right, 80 metres" vs "Right 3, 80". */
  rallyMode: boolean;
  /** 0-1. Applies to recorded clips; device TTS follows the media volume. */
  voiceVolume: number;
  /** Speaking rate for device TTS. 1.0 is normal. */
  speechRate: number;
  /** Hold a near-silent stream open so Bluetooth headsets stay awake. */
  keepHeadsetAwake: boolean;
  /** Snap imported GPX files onto OSM roads when there is a connection. */
  useOsmSnapping: boolean;
  /** Record every ride as GPX + a call log. */
  logRides: boolean;
  /** Has the safety disclaimer been accepted? */
  disclaimerAccepted: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  leadSeconds: 5,
  lagSeconds: 1,
  verbosity: "all",
  rallyMode: false,
  voiceVolume: 1,
  speechRate: 1,
  keepHeadsetAwake: true,
  useOsmSnapping: true,
  logRides: true,
  disclaimerAccepted: false,
};

const KEY = "rally.settings.v1";

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}

/** Rally numbers: 1 hairpin ... 6 slight. */
const VERBOSITY_TO_MAX_NUMBER: Record<Verbosity, number> = {
  all: 6,
  "sharp-and-above": 3,
  "hairpins-only": 1,
};

export function toEngineConfig(settings: Settings): DeepPartial<EngineConfig> {
  return {
    runtime: {
      leadSeconds: settings.leadSeconds,
      lagSeconds: settings.lagSeconds,
      rallyMode: settings.rallyMode,
      maxRallyNumberToCall: VERBOSITY_TO_MAX_NUMBER[settings.verbosity],
    },
  };
}
