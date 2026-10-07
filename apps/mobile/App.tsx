/**
 * App shell: crash guard, disclaimer gate, then a plain native stack.
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

import { DisclaimerGate } from "./src/screens/DisclaimerGate";
import { RecoveryScreen } from "./src/screens/RecoveryScreen";
import { RoutesScreen } from "./src/screens/RoutesScreen";
import { RoutePreviewScreen } from "./src/screens/RoutePreviewScreen";
import { RideScreen } from "./src/screens/RideScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { RideLogsScreen } from "./src/screens/RideLogsScreen";
import { ErrorBoundary } from "./src/ui/ErrorBoundary";
import type { RootStackParamList } from "./src/navigation";
import { loadSettings, saveSettings } from "./src/storage/settings";
import { isRideServiceRunning, stopLocationUpdates } from "./src/ride/locationTask";
import { rideEngine } from "./src/ride/rideEngine";
import {
  clearLastCrash,
  installCrashHandler,
  markRideScreenHealthy,
  readBreadcrumb,
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
  routeName: string;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [resumeRide, setResumeRide] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);

  useEffect(() => {
    void (async () => {
      const [settings, riding] = await Promise.all([loadSettings(), isRideServiceRunning()]);
      setAccepted(settings.disclaimerAccepted);

      const died = rideScreenCrashedLastTime();
      if (died) {
        // Last run went into the ride screen and never came out cleanly. Shut
        // the ride down before anything else can touch it.
        setRecovery({
          crash: readLastCrash(),
          breadcrumb: readBreadcrumb(),
          routeName: died.routeName,
        });
        markRideScreenHealthy();
        await stopLocationUpdates();
        await rideEngine.end().catch(() => undefined);
      } else {
        setResumeRide(riding);
      }
      setPhase("app");
      setReady(true);
    })();
  }, []);

  const accept = useCallback(() => {
    setAccepted(true);
    void loadSettings().then((settings) =>
      saveSettings({ ...settings, disclaimerAccepted: true }),
    );
  }, []);

  /** A render error anywhere: stop the ride so the phone is not left running one. */
  const handleRenderError = useCallback(() => {
    void stopLocationUpdates();
    void rideEngine.end().catch(() => undefined);
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (recovery) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <RecoveryScreen
          crash={recovery.crash}
          breadcrumb={recovery.breadcrumb}
          routeName={recovery.routeName}
          onDismiss={() => {
            clearLastCrash();
            // The breadcrumb is deliberately kept: the ride engine reads it to
            // decide whether to start the next ride without audio.
            setRecovery(null);
          }}
        />
      </SafeAreaProvider>
    );
  }

  if (!accepted) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <DisclaimerGate onAccept={accept} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <ErrorBoundary onError={handleRenderError}>
        <NavigationContainer theme={theme}>
          <Stack.Navigator
            initialRouteName={resumeRide ? "Ride" : "Routes"}
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="Routes" component={RoutesScreen} options={{ title: "Routes" }} />
            <Stack.Screen
              name="RoutePreview"
              component={RoutePreviewScreen}
              options={{ title: "Route" }}
            />
            <Stack.Screen
              name="Ride"
              component={RideScreen}
              options={{ headerShown: false, gestureEnabled: false }}
              initialParams={{ routeId: "" }}
            />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
            <Stack.Screen name="RideLogs" component={RideLogsScreen} options={{ title: "Rides" }} />
          </Stack.Navigator>
        </NavigationContainer>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
