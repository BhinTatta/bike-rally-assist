/**
 * Crash capture and the ride-screen watchdog.
 *
 * Two jobs:
 *
 * 1. **Record why the app died.** A release build has no red screen and no
 *    console: an unhandled error just closes the app, and the rider is left
 *    with "it crashes". So every JS error is written to a file before the
 *    process goes, and shown on the next launch where it can be shared.
 *
 * 2. **Stop a crash loop.** The app reopens straight into a running ride,
 *    which is right when you tap the notification - and catastrophic if the
 *    ride screen is what crashed, because every launch then dies the same way.
 *    A marker is written when the ride screen opens and cleared once it has
 *    survived a few seconds; finding it still set on launch means last time
 *    did not survive, so we stay out of the ride screen and say why.
 *
 * The marker also catches *native* crashes, which no JavaScript error handler
 * can see.
 */

import { readTextSync, removeFile, writeText } from "./storage/files";

export interface CrashRecord {
  time: number;
  name: string;
  message: string;
  stack?: string;
  /** What the app was doing, set by setPhase(). */
  phase: string;
  fatal: boolean;
}

const CRASH_FILE = "last-crash.json";
const RIDE_MARKER_FILE = "ride-screen-marker.json";
const BREADCRUMB_FILE = "breadcrumb.json";
const HEARTBEAT_FILE = "heartbeat.json";

let phase = "startup";

/** Note what the app is doing, so a crash report says where it happened. */
export function setPhase(next: string): void {
  phase = next;
}

function writeJson(path: string, value: unknown): void {
  try {
    writeText(path, JSON.stringify(value));
  } catch {
    // If we cannot even write the crash log there is nothing left to try.
  }
}

function readJson<T>(path: string): T | null {
  try {
    const text = readTextSync(path);
    return text === null ? null : (JSON.parse(text) as T);
  } catch {
    return null;
  }
}

export function recordCrash(error: unknown, fatal: boolean): void {
  const err = error instanceof Error ? error : new Error(String(error));
  writeJson(CRASH_FILE, {
    time: Date.now(),
    name: err.name,
    message: err.message,
    ...(err.stack ? { stack: err.stack } : {}),
    phase,
    fatal,
  } satisfies CrashRecord);
}

export const readLastCrash = (): CrashRecord | null => readJson<CrashRecord>(CRASH_FILE);

export function clearLastCrash(): void {
  removeFile(CRASH_FILE);
}

// ------------------------------------------------------------- breadcrumbs

export interface Breadcrumb {
  step: string;
  at: number;
}

/**
 * Record the native call we are about to make.
 *
 * A native crash leaves no JavaScript error - the process is simply gone - so
 * the only way to learn where it happened is to write down where we were
 * going *before* we go there. Each of these is a synchronous file write, which
 * is why they only wrap the handful of calls that cross into native code at
 * ride start, and not the per-fix hot path.
 */
export function breadcrumb(step: string): void {
  writeJson(BREADCRUMB_FILE, { step, at: Date.now() } satisfies Breadcrumb);
}

export const readBreadcrumb = (): Breadcrumb | null => readJson<Breadcrumb>(BREADCRUMB_FILE);

export function clearBreadcrumb(): void {
  removeFile(BREADCRUMB_FILE);
}

/**
 * Did the last run die inside the audio stack? If so the next ride starts
 * without it: no ducking and no headset keep-alive, but a ride that runs.
 */
export function lastCrashWasAudio(): boolean {
  return readBreadcrumb()?.step.startsWith("audio:") === true;
}

// -------------------------------------------------------------- heartbeat

/**
 * How long the ride survived.
 *
 * The breadcrumb says *where* it died; this says *when*. The difference
 * matters: Android kills a process whose foreground service fails to post its
 * notification within five seconds, so "survived about five seconds after the
 * screen appeared" points somewhere very specific, and "survived two minutes"
 * points somewhere else entirely.
 */
export function heartbeat(): void {
  writeJson(HEARTBEAT_FILE, { at: Date.now() });
}

export function readHeartbeat(): number | null {
  return readJson<{ at: number }>(HEARTBEAT_FILE)?.at ?? null;
}

export function clearHeartbeat(): void {
  removeFile(HEARTBEAT_FILE);
}

/**
 * Install a global handler for errors React never sees - anything thrown from
 * a timer, a promise, or the background location task.
 */
export function installCrashHandler(): void {
  const globals = globalThis as {
    ErrorUtils?: {
      getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
      setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
    };
  };
  const errorUtils = globals.ErrorUtils;
  if (!errorUtils) return;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    recordCrash(error, isFatal === true);
    previous(error, isFatal);
  });
}

// ----------------------------------------------------------- ride watchdog

export interface RideMarker {
  openedAt: number;
  routeName: string;
  /**
   * How the ride was getting its positions. If a ride start dies while the
   * background service is in play, the next one runs without it.
   */
  locationMode?: "background" | "foreground" | "demo";
}

/** Called as the ride screen mounts. */
export function markRideScreenOpened(
  routeName: string,
  locationMode?: RideMarker["locationMode"],
): void {
  writeJson(RIDE_MARKER_FILE, {
    openedAt: Date.now(),
    routeName,
    ...(locationMode ? { locationMode } : {}),
  } satisfies RideMarker);
}

/** Called once the ride screen has survived long enough to be trusted. */
export function markRideScreenHealthy(): void {
  removeFile(RIDE_MARKER_FILE);
}

/**
 * Did the previous run die with the ride screen open? If so we must not walk
 * straight back into it.
 */
export function rideScreenCrashedLastTime(): RideMarker | null {
  return readJson<RideMarker>(RIDE_MARKER_FILE);
}
