/**
 * Permissions, explained before they are asked for.
 *
 * Android splits what this app needs into three separate grants, and the third
 * one (background location) can only be asked for *after* the second, and on
 * Android 11+ only takes the rider to a settings screen. Explaining why,
 * before the dialog, is the difference between a granted permission and a
 * confused "Deny".
 */

import { Platform } from "react-native";
import * as Location from "expo-location";
import * as IntentLauncher from "expo-intent-launcher";
import Constants from "expo-constants";

export interface PermissionState {
  foreground: boolean;
  background: boolean;
  servicesEnabled: boolean;
}

export async function checkPermissions(): Promise<PermissionState> {
  const [foreground, background, servicesEnabled] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    Location.hasServicesEnabledAsync(),
  ]);
  return {
    foreground: foreground.granted,
    background: background.granted,
    servicesEnabled,
  };
}

/** Ask for "while using the app" location. */
export async function requestForeground(): Promise<boolean> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  return granted;
}

/**
 * Ask for background location. Android requires the foreground grant first,
 * and from Android 11 shows a settings screen rather than a dialog.
 */
export async function requestBackground(): Promise<boolean> {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) {
    const result = await Location.requestForegroundPermissionsAsync();
    if (!result.granted) return false;
  }
  const { granted } = await Location.requestBackgroundPermissionsAsync();
  return granted;
}

/**
 * Open the battery-optimisation exemption screen.
 *
 * Xiaomi (MIUI/HyperOS), Oppo/Realme (ColorOS), Vivo (FuntouchOS) and OnePlus
 * all kill background apps far more aggressively than stock Android, and a
 * killed app means silence in the middle of a ghat. The exemption is the
 * single most effective thing a rider can do about it; some ROMs additionally
 * need "Autostart" enabled in their own settings app, which no API can reach.
 */
export async function openBatteryOptimisationSettings(): Promise<void> {
  if (Platform.OS !== "android") return;
  const packageName =
    (Constants.expoConfig?.android?.package as string | undefined) ??
    "com.bhintatta.rallycodriver";
  try {
    await IntentLauncher.startActivityAsync(
      "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
      { data: `package:${packageName}` },
    );
  } catch {
    // Some ROMs refuse that intent; fall back to the app's settings page.
    try {
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
        { data: `package:${packageName}` },
      );
    } catch {
      // Nothing more we can do from here.
    }
  }
}

/** Open the system location settings, for when GPS itself is switched off. */
export async function openLocationSettings(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS,
    );
  } catch {
    // Ignore.
  }
}
