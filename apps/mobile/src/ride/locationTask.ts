/**
 * The background location task.
 *
 * `defineTask` must run at module scope and before anything else, because
 * Android may start this JS context headlessly - app swiped away, screen off,
 * phone in a tank bag - purely to hand over a batch of locations. The task
 * then drives the ride engine, which rebuilds itself from storage if this is a
 * fresh process.
 */

import { Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { rideEngine } from "./rideEngine";
import { breadcrumb, recordCrash, setPhase } from "../diagnostics";

export const LOCATION_TASK = "rally-location-updates";

interface LocationTaskData {
  locations: Location.LocationObject[];
}

let firstBatchSeen = false;

/** The browser build has no background tasks; it only ever previews rides. */
const TASKS_AVAILABLE = Platform.OS !== "web";

const defineLocationTask = (): void =>
  TaskManager.defineTask<LocationTaskData>(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    // Nothing to do but wait for the next batch: the engine's own GPS
    // watchdog says "GPS lost" if the silence goes on.
    return;
  }
  const locations = data?.locations ?? [];
  if (locations.length === 0) return;
  try {
    setPhase("location-task");
    // Only the first batch is worth a breadcrumb: it proves the service can
    // deliver. After that this runs every second for hours.
    if (!firstBatchSeen) {
      firstBatchSeen = true;
      breadcrumb("task:first-batch");
    }
    await rideEngine.handleLocations(locations);
  } catch (taskError) {
    // An exception escaping a TaskManager callback takes the whole app down in
    // a release build. Record it and drop the batch: the next fix is a second
    // away, and a ride that misses one call beats a ride that ends.
    recordCrash(taskError, false);
  }
});

if (TASKS_AVAILABLE) {
  try {
    defineLocationTask();
  } catch (defineError) {
    // Without the task there is no background mode, but screen-on riding
    // still works - far better than failing to launch.
    recordCrash(defineError, false);
  }
}

/**
 * Start the foreground service and the 1 Hz location stream.
 *
 * The notification is not decoration: on Android 14+ a foreground service of
 * type `location` is the only way to keep getting fixes with the screen off,
 * and the rider should be able to see at a glance that the app is running.
 */
export async function startLocationUpdates(routeName: string): Promise<void> {
  const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (alreadyRunning) await Location.stopLocationUpdatesAsync(LOCATION_TASK);

  firstBatchSeen = false;
  breadcrumb("location:start-updates");
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 1000,
    distanceInterval: 0,
    // Android will otherwise "helpfully" stop updates when it thinks you have
    // stopped moving - which is every time you wait at a ghat traffic jam.
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Rally Co-Driver",
      notificationBody: `Calling corners on ${routeName}`,
      notificationColor: "#ffd400",
      killServiceOnDestroy: false,
    },
  });
}

export async function stopLocationUpdates(): Promise<void> {
  if (!TASKS_AVAILABLE) return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // Already stopped, or the task was never registered in this process.
  }
}

export async function isRideServiceRunning(): Promise<boolean> {
  if (!TASKS_AVAILABLE) return false;
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

// --------------------------------------------------------- foreground mode

/**
 * The fallback for a rider who granted "While using the app" but not
 * "Allow all the time".
 *
 * `startLocationUpdatesAsync` flatly rejects without the background grant - so
 * offering to "ride anyway" and then calling it was a promise the app could
 * not keep. A plain position watch needs no background permission and no
 * foreground service. It works perfectly with the screen on and the app in
 * front, which is a real way to ride; it just stops when the phone locks.
 */
let foregroundWatch: Location.LocationSubscription | null = null;

export async function startForegroundWatch(): Promise<void> {
  await stopForegroundWatch();
  foregroundWatch = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 1000,
      distanceInterval: 0,
    },
    (location) => {
      rideEngine.handleLocations([location]).catch((error: unknown) => recordCrash(error, false));
    },
  );
}

export async function stopForegroundWatch(): Promise<void> {
  try {
    foregroundWatch?.remove();
  } catch {
    // Already gone.
  }
  foregroundWatch = null;
}

export type RideLocationMode = "background" | "foreground";

/**
 * Start location updates the best way this phone will allow, and say which
 * way that turned out to be.
 */
export async function startRideLocation(
  routeName: string,
  /** Skip the background service: the rider chose screen-on, or it crashed before. */
  screenOnOnly = false,
): Promise<RideLocationMode> {
  if (screenOnOnly || !TASKS_AVAILABLE) {
    breadcrumb("location:foreground-chosen");
    await startForegroundWatch();
    return "foreground";
  }
  try {
    await startLocationUpdates(routeName);
    return "background";
  } catch {
    // Expected when only the foreground grant exists; also covers an OEM that
    // refuses the service for its own reasons. Either way, keep riding.
    breadcrumb("location:foreground-fallback");
    await startForegroundWatch();
    return "foreground";
  }
}

export async function stopRideLocation(): Promise<void> {
  await stopForegroundWatch();
  await stopLocationUpdates();
}
