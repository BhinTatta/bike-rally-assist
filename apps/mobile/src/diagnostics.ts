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

import { File, Paths } from "expo-file-system";

export interface CrashRecord {
  time: number;
  name: string;
  message: string;
  stack?: string;
  /** What the app was doing, set by setPhase(). */
  phase: string;
  fatal: boolean;
}

const crashFile = (): File => new File(Paths.document, "last-crash.json");
const rideMarkerFile = (): File => new File(Paths.document, "ride-screen-marker.json");
const breadcrumbFile = (): File => new File(Paths.document, "breadcrumb.json");
const heartbeatFile = (): File => new File(Paths.document, "heartbeat.json");

let phase = "startup";

/** Note what the app is doing, so a crash report says where it happened. */
export function setPhase(next: string): void {
  phase = next;
}

function writeJson(file: File, value: unknown): void {
  try {
    file.create({ overwrite: true });
    file.write(JSON.stringify(value));
  } catch {
    // If we cannot even write the crash log there is nothing left to try.
  }
}

function readJson<T>(file: File): T | null {
  try {
    if (!file.exists) return null;
    return JSON.parse(file.textSync()) as T;
  } catch {
    return null;
  }
}

export function recordCrash(error: unknown, fatal: boolean): void {
  const err = error instanceof Error ? error : new Error(String(error));
  writeJson(crashFile(), {
    time: Date.now(),
    name: err.name,
    message: err.message,
    stack: err.stack,
    phase,
    fatal,
  } satisfies CrashRecord);
}

export const readLastCrash = (): CrashRecord | null => readJson<CrashRecord>(crashFile());

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
  writeJson(breadcrumbFile(), { step, at: Date.now() } satisfies Breadcrumb);
}

export const readBreadcrumb = (): Breadcrumb | null => readJson<Breadcrumb>(breadcrumbFile());

export function clearBreadcrumb(): void {
  try {
    const file = breadcrumbFile();
    if (file.exists) file.delete();
  } catch {
    // Nothing useful to do.
  }
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
  writeJson(heartbeatFile(), { at: Date.now() });
}

export function readHeartbeat(): number | null {
  return readJson<{ at: number }>(heartbeatFile())?.at ?? null;
}

export function clearHeartbeat(): void {
  try {
    const file = heartbeatFile();
    if (file.exists) file.delete();
  } catch {
    // Nothing useful to do.
  }
}

export function clearLastCrash(): void {
  try {
    const file = crashFile();
    if (file.exists) file.delete();
  } catch {
    // Nothing useful to do.
  }
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

interface RideMarker {
  openedAt: number;
  routeName: string;
}

/** Called as the ride screen mounts. */
export function markRideScreenOpened(routeName: string): void {
  writeJson(rideMarkerFile(), { openedAt: Date.now(), routeName } satisfies RideMarker);
}

/** Called once the ride screen has survived long enough to be trusted. */
export function markRideScreenHealthy(): void {
  try {
    const file = rideMarkerFile();
    if (file.exists) file.delete();
  } catch {
    // Worst case the next launch is cautious for no reason.
  }
}

/**
 * Did the previous run die with the ride screen open? If so we must not walk
 * straight back into it.
 */
export function rideScreenCrashedLastTime(): RideMarker | null {
  return readJson<RideMarker>(rideMarkerFile());
}
