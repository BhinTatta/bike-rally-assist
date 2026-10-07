/**
 * The background location task.
 *
 * `defineTask` must run at module scope and before anything else, because
 * Android may start this JS context headlessly - app swiped away, screen off,
 * phone in a tank bag - purely to hand over a batch of locations. The task
 * then drives the ride engine, which rebuilds itself from storage if this is a
 * fresh process.
 */

import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { rideEngine } from "./rideEngine";

export const LOCATION_TASK = "rally-location-updates";

interface LocationTaskData {
  locations: Location.LocationObject[];
}

TaskManager.defineTask<LocationTaskData>(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    // Nothing to do but wait for the next batch: the engine's own GPS
    // watchdog says "GPS lost" if the silence goes on.
    return;
  }
  const locations = data?.locations ?? [];
  if (locations.length === 0) return;
  await rideEngine.handleLocations(locations);
});

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
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // Already stopped, or the task was never registered in this process.
  }
}

export async function isRideServiceRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}
