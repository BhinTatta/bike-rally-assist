/**
 * Rider settings, persisted to AsyncStorage.
 *
 * The ride mode does most of the work: it is a preset that decides how early
 * the co-driver speaks, which corners it bothers with and how it words them.
 * Everything else here either fine-tunes the mode or is about the phone
 * (voice, headset, battery) rather than the riding. `toEngineConfig` is the
 * single place settings become engine configuration.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { RIDE_MODE_IDS, rideMode } from "@rally/engine";
import type { DeepPartial, EngineConfig, RideModeId, RuntimeConfig } from "@rally/engine";

/** How many of the corners get called. "mode" leaves it to the ride mode. */
export type Verbosity = "mode" | "all" | "medium-and-above" | "sharp-and-above" | "hairpins-only";

/** How corners are worded. "mode" leaves it to the ride mode. */
export type Phrasing = "mode" | "plain" | "pacenotes";

export type LocationMode = "auto" | "screen-on";

export interface Settings {
  mode: RideModeId;
  /** Added to the mode's own lead time, seconds. Negative calls later. */
  leadAdjustSeconds: number;
  verbosity: Verbosity;
  phrasing: Phrasing;
  /** Speech + system latency compensation, seconds. */
  lagSeconds: number;

  /** Crests, descents, surface changes, speed breakers. */
  announceHazards: boolean;
  /** "Twisty section, 3 kilometres". */
  announceSections: boolean;
  /** "Caution" before corners that catch riders out. */
  cautionCalls: boolean;
  /** "Slow" / "brake" when arriving too fast to slow comfortably. */
  speedWarnings: boolean;

  /** Show the estimated corner speed on the ride screen. */
  showCornerSpeed: boolean;
  /** Buzz when a call fires. */
  haptics: boolean;

  /** Identifier of the chosen TTS voice, or null for the system default. */
  voiceId: string | null;
  /** Speaking rate for device TTS. 1.0 is normal. */
  speechRate: number;
  /** 0-1. Sets the level of the headset keep-alive stream. */
  voiceVolume: number;
  /** Hold a near-silent stream open so Bluetooth headsets stay awake. */
  keepHeadsetAwake: boolean;
  /**
   * Let the keep-alive stream keep playing with the app in the background.
   *
   * Off by default, and deliberately so. Turning it on makes Android start a
   * second foreground service (media playback) alongside the location one,
   * and that service has five seconds to post its notification or the system
   * kills the whole process. The location service alone keeps the ride alive;
   * this only buys the headset staying awake while the screen is off.
   */
  backgroundAudio: boolean;

  /**
   * "auto" uses the background location service when Android allows it;
   * "screen-on" never starts it, and rides on a plain position watch. The app
   * switches itself to "screen-on" if a ride start ever takes it down.
   */
  locationMode: LocationMode;
  /** Snap imported GPX files onto OSM roads when there is a connection. */
  useOsmSnapping: boolean;
  /** Record every ride as GPX + a call log. */
  logRides: boolean;
  /** Has the safety disclaimer been accepted? */
  disclaimerAccepted: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "sport",
  leadAdjustSeconds: 0,
  verbosity: "mode",
  phrasing: "mode",
  lagSeconds: 1,
  announceHazards: true,
  announceSections: true,
  cautionCalls: true,
  speedWarnings: true,
  showCornerSpeed: true,
  haptics: true,
  voiceId: null,
  speechRate: 1,
  voiceVolume: 1,
  keepHeadsetAwake: true,
  backgroundAudio: false,
  locationMode: "auto",
  useOsmSnapping: true,
  logRides: true,
  disclaimerAccepted: false,
};

const KEY = "rally.settings.v2";
const LEGACY_KEY = "rally.settings.v1";

/** What the first version of the app stored, as far as it still matters. */
interface LegacySettings {
  rallyMode?: boolean;
  verbosity?: string;
  lagSeconds?: number;
  speechRate?: number;
  voiceVolume?: number;
  keepHeadsetAwake?: boolean;
  backgroundAudio?: boolean;
  useOsmSnapping?: boolean;
  logRides?: boolean;
  disclaimerAccepted?: boolean;
}

function fromLegacy(old: LegacySettings): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  // Someone who had pacenotes switched on was already riding in duke mode.
  if (old.rallyMode) settings.mode = "duke";
  if (old.verbosity === "sharp-and-above" || old.verbosity === "hairpins-only") {
    settings.verbosity = old.verbosity;
  }
  for (const key of [
    "lagSeconds",
    "speechRate",
    "voiceVolume",
    "keepHeadsetAwake",
    "backgroundAudio",
    "useOsmSnapping",
    "logRides",
    "disclaimerAccepted",
  ] as const) {
    const value = old[key];
    if (value !== undefined) (settings as unknown as Record<string, unknown>)[key] = value;
  }
  return settings;
}

function sanitise(settings: Settings): Settings {
  const clean = { ...settings };
  if (!RIDE_MODE_IDS.includes(clean.mode)) clean.mode = DEFAULT_SETTINGS.mode;
  if (!Number.isFinite(clean.leadAdjustSeconds)) clean.leadAdjustSeconds = 0;
  clean.leadAdjustSeconds = Math.max(-2, Math.min(4, clean.leadAdjustSeconds));
  if (!Number.isFinite(clean.speechRate)) clean.speechRate = 1;
  if (!Number.isFinite(clean.lagSeconds)) clean.lagSeconds = 1;
  return clean;
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) return sanitise({ ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) });
    const legacy = await AsyncStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = fromLegacy(JSON.parse(legacy) as LegacySettings);
      await AsyncStorage.setItem(KEY, JSON.stringify(migrated));
      return migrated;
    }
    return DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}

/** Load, change, save: for callers that only want to flip one thing. */
export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await saveSettings(next);
  return next;
}

/** Rally numbers: 1 hairpin ... 6 slight. */
const VERBOSITY_TO_MAX_NUMBER: Record<Exclude<Verbosity, "mode">, number> = {
  all: 6,
  "medium-and-above": 4,
  "sharp-and-above": 3,
  "hairpins-only": 1,
};

/** The runtime configuration a ride will actually use. */
export function runtimeFor(settings: Settings): Partial<RuntimeConfig> {
  const mode = rideMode(settings.mode);
  const runtime: Partial<RuntimeConfig> = { ...mode.runtime, lagSeconds: settings.lagSeconds };
  runtime.leadSeconds = Math.max(
    2.5,
    (mode.runtime.leadSeconds ?? 5) + settings.leadAdjustSeconds,
  );
  if (settings.verbosity !== "mode") {
    runtime.maxRallyNumberToCall = VERBOSITY_TO_MAX_NUMBER[settings.verbosity];
  }
  if (settings.phrasing !== "mode") runtime.rallyMode = settings.phrasing === "pacenotes";
  // The switches can only turn things off: a mode that does not announce
  // sections stays quiet about them whatever the switch says.
  runtime.announceFeatures = (mode.runtime.announceFeatures ?? false) && settings.announceHazards;
  runtime.announceSections = (mode.runtime.announceSections ?? false) && settings.announceSections;
  runtime.cautionCalls = (mode.runtime.cautionCalls ?? false) && settings.cautionCalls;
  runtime.speedWarnings = (mode.runtime.speedWarnings ?? false) && settings.speedWarnings;
  return runtime;
}

export function toEngineConfig(settings: Settings): DeepPartial<EngineConfig> {
  return { runtime: runtimeFor(settings) };
}
