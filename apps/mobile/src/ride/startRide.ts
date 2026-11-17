/**
 * Starting a ride: permissions in the order Android insists on, then the
 * engine, then the location stream.
 *
 * Pulled out of the screen because every step here either talks to native code
 * or asks the rider a question, and each one is breadcrumbed so that if the
 * app dies the next launch can say exactly where.
 */

import { Platform } from "react-native";
import type { AnalysedRoute } from "@rally/engine";

import { breadcrumb } from "../diagnostics";
import { confirm, inform } from "../ui/dialog";
import { loadSettings } from "../storage/settings";
import { startRideLocation, type RideLocationMode } from "./locationTask";
import {
  checkPermissions,
  openLocationSettings,
  requestBackground,
  requestForeground,
  requestNotifications,
} from "./permissions";
import { rideEngine } from "./rideEngine";

export type StartResult =
  | { started: true; mode: RideLocationMode | "preview" }
  | { started: false };

/** A simulated ride: no permissions, no GPS, same co-driver. */
export async function startPreview(routeId: string, route: AnalysedRoute): Promise<StartResult> {
  const begun = await rideEngine.begin(routeId, route, { preview: true });
  if (!begun.ok) {
    await inform("Could not start the preview", begun.error);
    return { started: false };
  }
  return { started: true, mode: "preview" };
}

export async function startRide(routeId: string, route: AnalysedRoute): Promise<StartResult> {
  if (Platform.OS === "web") {
    await inform(
      "Rides need the phone app",
      "The browser has no background GPS. Use Preview to hear this route here.",
    );
    return { started: false };
  }
  breadcrumb("start:pressed");
  const settings = await loadSettings();
  const state = await checkPermissions();
  breadcrumb("start:permissions");

  if (!state.foreground && !(await requestForeground())) {
    await inform(
      "Location is required",
      "Without your location the co-driver has no idea which corner is next. Allow it in Android settings and try again.",
    );
    return { started: false };
  }
  if (!state.servicesEnabled) {
    const open = await confirm({
      title: "GPS is switched off",
      body: "Turn on location on this phone, then start the ride again.",
      confirmLabel: "Open location settings",
    });
    if (open) await openLocationSettings();
    return { started: false };
  }
  // Worth asking even though a refusal is survivable: without it the ride
  // notification never appears, and that notification is the only sign the
  // app is still running with the screen off.
  await requestNotifications();

  let screenOnOnly = settings.locationMode === "screen-on";
  if (!screenOnOnly && !state.background) {
    const wantsPocket = await confirm({
      title: "Ride with the screen off?",
      body: 'To keep calling corners with the phone locked or in a pocket, Android needs location set to "Allow all the time".\n\nOn a handlebar mount with the screen on, you do not need it.',
      confirmLabel: "Allow all the time",
      cancelLabel: "Screen stays on — skip",
    });
    if (wantsPocket) screenOnOnly = !(await requestBackground());
    else screenOnOnly = true;
  }

  // Hand over the route we already have rather than reading and parsing
  // the whole thing a second time - it is megabytes for a long import.
  breadcrumb("start:engine-begin");
  const begun = await rideEngine.begin(routeId, route);
  if (!begun.ok) {
    await inform("Could not start the ride", begun.error);
    return { started: false };
  }
  try {
    breadcrumb("start:location-service");
    const mode = await startRideLocation(route.name ?? "your route", screenOnOnly);
    breadcrumb("start:navigate");
    return { started: true, mode };
  } catch (error) {
    await rideEngine.end().catch(() => undefined);
    await inform("Could not start the GPS", (error as Error).message);
    return { started: false };
  }
}
