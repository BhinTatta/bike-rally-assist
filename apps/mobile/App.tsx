/**
 * App shell: crash guard, first-run gate, then a plain native stack.
 *
 * Reopening while a ride is running goes straight back to the ride screen -
 * that is what happens every time the rider taps the foreground-service
 * notification. Unless the previous run *died* in there, in which case walking
 * back in would crash again, and again, on every launch. That case gets the
 * recovery screen instead.
 */

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StatusBar, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, type Theme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { OnboardingScreen } from "./src/screens/OnboardingScreen";
import { RecoveryScreen } from "./src/screens/RecoveryScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { RouteScreen } from "./src/screens/RouteScreen";
import { RoadbookScreen } from "./src/screens/RoadbookScreen";
import { RideScreen } from "./src/screens/RideScreen";
import { SummaryScreen } from "./src/screens/SummaryScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { RidesScreen } from "./src/screens/RidesScreen";
import { DialogHost } from "./src/ui/dialog";
import { ErrorBoundary } from "./src/ui/ErrorBoundary";
import type { RootStackParamList } from "./src/navigation";
import { loadSettings, updateSettings } from "./src/storage/settings";
import { isRideServiceRunning, stopRideLocation } from "./src/ride/locationTask";
import { rideEngine } from "./src/ride/rideEngine";
import {
  clearLastCrash,
  installCrashHandler,
  markRideScreenHealthy,
  readBreadcrumb,
  readHeartbeat,
  readLastCrash,
  rideScreenCrashedLastTime,
  setPhase,
  type Breadcrumb,
  type CrashRecord,
} from "./src/diagnostics";
import { colors } from "./src/ui/theme";

installCrashHandler();

const Stack = createNativeStackNavigator<RootStackParamList>();

const theme: Theme = {
  dark: true,
  colors: {
    primary: colors.accent,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
  },
  fonts: {
    regular: { fontFamily: "System", fontWeight: "400" },
    medium: { fontFamily: "System", fontWeight: "500" },
    bold: { fontFamily: "System", fontWeight: "700" },
    heavy: { fontFamily: "System", fontWeight: "900" },
  },
};

interface Recovery {
  crash: CrashRecord | null;
  /** The last native call attempted before the process died. */
  breadcrumb: Breadcrumb | null;
  /** How long the ride kept running after that call. */
  survivedMs: number | null;
  routeName: string;
  switchedToScreenOn: boolean;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [resumeRide, setResumeRide] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [settings, riding] = await Promise.all([loadSettings(), isRideServiceRunning()]);
        setAccepted(settings.disclaimerAccepted);

        const died = rideScreenCrashedLastTime();
        if (died && died.locationMode !== "demo") {
          // Last run went into the ride screen and never came out cleanly. Shut
          // the ride down before anything else can touch it.
          const trail = readBreadcrumb();
          const lastAlive = readHeartbeat();
          // The marker only exists for the first seconds of a ride, so this
          // was a death at ride start. If the background service was in play
          // and the audio stack is not the suspect, take the service out of
          // the picture next time rather than let it happen twice.
          const audioSuspected = trail?.step.startsWith("audio:") === true;
          const switchToScreenOn =
            died.locationMode === "background" &&
            !audioSuspected &&
            settings.locationMode === "auto";
          if (switchToScreenOn) await updateSettings({ locationMode: "screen-on" });
          setRecovery({
            crash: readLastCrash(),
            breadcrumb: trail,
            survivedMs: trail && lastAlive ? Math.max(0, lastAlive - trail.at) : null,
            routeName: died.routeName,
            switchedToScreenOn: switchToScreenOn,
          });
          markRideScreenHealthy();
          await stopRideLocation();
          await rideEngine.end().catch(() => undefined);
        } else {
          if (died) markRideScreenHealthy();
          setResumeRide(riding);
        }
      } catch {
        // Whatever went wrong reading state, the app must still open.
      }
      setPhase("app");
      setReady(true);
    })();
  }, []);

  const accept = useCallback(() => {
    setAccepted(true);
    void updateSettings({ disclaimerAccepted: true });
  }, []);

  /** A render error anywhere: stop the ride so the phone is not left running one. */
  const handleRenderError = useCallback(() => {
    void stopRideLocation();
    void rideEngine.end().catch(() => undefined);
  }, []);

  let content;
  if (!ready) {
    content = (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  } else if (recovery) {
    content = (
      <RecoveryScreen
        crash={recovery.crash}
        breadcrumb={recovery.breadcrumb}
        survivedMs={recovery.survivedMs}
        routeName={recovery.routeName}
        switchedToScreenOn={recovery.switchedToScreenOn}
        onDismiss={() => {
          clearLastCrash();
          // The breadcrumb is deliberately kept: the ride engine reads it to
          // decide whether to start the next ride without audio.
          setRecovery(null);
        }}
      />
    );
  } else if (!accepted) {
    content = <OnboardingScreen onAccept={accept} />;
  } else {
    content = (
      <ErrorBoundary onError={handleRenderError}>
        <NavigationContainer theme={theme}>
          <Stack.Navigator
            initialRouteName={resumeRide ? "Ride" : "Home"}
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
              animation: "slide_from_right",
            }}
          >
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Route" component={RouteScreen} />
            <Stack.Screen name="Roadbook" component={RoadbookScreen} />
            <Stack.Screen
              name="Ride"
              component={RideScreen}
              options={{ gestureEnabled: false, animation: "fade", contentStyle: { backgroundColor: "#000000" } }}
              initialParams={{ routeId: "" }}
            />
            <Stack.Screen name="Summary" component={SummaryScreen} options={{ animation: "fade" }} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="Rides" component={RidesScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </ErrorBoundary>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      {content}
      <DialogHost />
    </SafeAreaProvider>
  );
}
