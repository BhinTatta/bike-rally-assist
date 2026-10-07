/**
 * App shell: the disclaimer gate, then a plain native stack.
 *
 * If the app is reopened while a ride is running (which happens every time the
 * rider taps the foreground-service notification), it goes straight back to the
 * ride screen rather than the route list.
 */

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StatusBar, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, type Theme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { DisclaimerGate } from "./src/screens/DisclaimerGate";
import { RoutesScreen } from "./src/screens/RoutesScreen";
import { RoutePreviewScreen } from "./src/screens/RoutePreviewScreen";
import { RideScreen } from "./src/screens/RideScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { RideLogsScreen } from "./src/screens/RideLogsScreen";
import type { RootStackParamList } from "./src/navigation";
import { loadSettings, saveSettings } from "./src/storage/settings";
import { isRideServiceRunning } from "./src/ride/locationTask";
import { colors } from "./src/ui/theme";

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

export default function App() {
  const [ready, setReady] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [resumeRide, setResumeRide] = useState(false);

  useEffect(() => {
    void (async () => {
      const [settings, riding] = await Promise.all([loadSettings(), isRideServiceRunning()]);
      setAccepted(settings.disclaimerAccepted);
      setResumeRide(riding);
      setReady(true);
    })();
  }, []);

  const accept = useCallback(() => {
    setAccepted(true);
    void loadSettings().then((settings) =>
      saveSettings({ ...settings, disclaimerAccepted: true }),
    );
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}>
        <ActivityIndicator color={colors.accent} />
      </View>
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
    </SafeAreaProvider>
  );
}
