import type { ExpoConfig } from "expo/config";

/**
 * Expo app config.
 *
 * This is a dev-build app, not an Expo Go app: it uses background location, a
 * foreground service and MapLibre, none of which exist in Expo Go.
 */
const config: ExpoConfig = {
  name: "Rally Co-Driver",
  slug: "rally-codriver",
  scheme: "rallycodriver",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  backgroundColor: "#0b0d10",
  assetBundlePatterns: ["**/*"],

  android: {
    package: "com.bhintatta.rallycodriver",
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: "./assets/icon.png",
      backgroundColor: "#0b0d10",
    },
    permissions: [
      "ACCESS_COARSE_LOCATION",
      "ACCESS_FINE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_LOCATION",
      "WAKE_LOCK",
      // Asked for explicitly, with an explanation: Xiaomi/Oppo/Vivo kill
      // background apps aggressively and the ride would go silent.
      "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
      // Needed to duck music and to hold an audio stream open for the headset.
      "MODIFY_AUDIO_SETTINGS",
      // Android 13+ needs this for the ride's foreground-service notification
      // to actually appear. The service runs either way, but a rider who
      // cannot see it has no way to tell the app is still working.
      "POST_NOTIFICATIONS",
    ],
    intentFilters: [
      {
        // "Open with" from a file manager, Gmail attachment, Telegram, etc.
        action: "VIEW",
        category: ["DEFAULT", "BROWSABLE"],
        data: [
          { scheme: "content", mimeType: "application/gpx+xml" },
          { scheme: "content", mimeType: "application/octet-stream" },
          { scheme: "file", mimeType: "*/*", pathPattern: ".*\\.gpx" },
          { scheme: "content", mimeType: "*/*", pathPattern: ".*\\.gpx" },
        ],
      },
      {
        // Share sheet.
        action: "SEND",
        category: ["DEFAULT"],
        data: [{ mimeType: "application/gpx+xml" }, { mimeType: "application/octet-stream" }],
      },
    ],
  },

  ios: {
    bundleIdentifier: "com.bhintatta.rallycodriver",
    supportsTablet: false,
    infoPlist: {
      UIBackgroundModes: ["location", "audio"],
      NSLocationWhenInUseUsageDescription:
        "Rally Co-Driver needs your location to tell you what the road ahead does.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Rally Co-Driver needs your location while the screen is off so it can keep calling corners with the phone in your pocket or on the mount.",
    },
  },

  plugins: [
    "expo-dev-client",
    [
      "expo-location",
      {
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        locationAlwaysAndWhenInUsePermission:
          "Rally Co-Driver calls corners while the phone is locked in your pocket, so it needs location in the background.",
      },
    ],
    // Required, not optional. expo-audio ships no service in its own library
    // manifest: `AudioControlsService` (and FOREGROUND_SERVICE_MEDIA_PLAYBACK)
    // exist only if this plugin runs. Without it, the first play() with
    // background playback enabled tries to start a service Android cannot
    // find and the app dies natively, with no JavaScript error to show for it.
    [
      "expo-audio",
      {
        // The keep-alive stream is playback only - never ask for the mic.
        microphonePermission: false,
        recordAudioAndroid: false,
        // Declares AudioControlsService so that background playback *can* be
        // turned on from settings. It is off by default: see the comment on
        // `backgroundAudio` in storage/settings.ts.
        enableBackgroundPlayback: true,
      },
    ],
    "@maplibre/maplibre-react-native",
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 26,
          compileSdkVersion: 36,
          targetSdkVersion: 36,
        },
      },
    ],
    // Signs release builds with a keystore from the environment when one is
    // provided; a no-op otherwise, so local builds keep working.
    "./plugins/withReleaseSigning",
  ],

  experiments: { typedRoutes: false },
};

export default config;
