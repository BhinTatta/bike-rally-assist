/**
 * The ride screen.
 *
 * Everything here is sized for a glance at 60 km/h with a tinted visor: one
 * enormous direction arrow, the grade, the distance, and three small numbers
 * that only matter when something is wrong (speed, GPS accuracy, service
 * state). No scrolling, no gestures, one deliberately awkward stop button.
 */

import { useCallback, useEffect, useState } from "react";
import { Alert, BackHandler, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useKeepAwake } from "expo-keep-awake";
import * as Haptics from "expo-haptics";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { Corner } from "@rally/engine";

import { Button } from "../ui/components";
import { colors, gradeColor, spacing } from "../ui/theme";
import { rideEngine, type RideSnapshot } from "../ride/rideEngine";
import { stopLocationUpdates } from "../ride/locationTask";
import {
  markRideScreenHealthy,
  markRideScreenOpened,
  setPhase,
} from "../diagnostics";
import type { RootStackParamList } from "../navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Ride">;

/** Big arrow glyphs, picked for weight rather than prettiness. */
const ARROW = { left: "←", right: "→", ahead: "↑" } as const;

export function RideScreen({ navigation }: Props) {
  useKeepAwake();
  const [snapshot, setSnapshot] = useState<RideSnapshot>(rideEngine.getSnapshot());

  useEffect(() => rideEngine.subscribe(setSnapshot), []);

  /**
   * Crash-loop guard. The marker written here is cleared only once the screen
   * has survived long enough to be trusted; if the app dies in between - even
   * from a native crash, which no JavaScript handler can see - the next launch
   * finds the marker and refuses to walk straight back in.
   */
  useEffect(() => {
    setPhase("ride-screen");
    markRideScreenOpened(rideEngine.getSnapshot().routeName || "route");
    const healthy = setTimeout(markRideScreenHealthy, 8000);
    return () => {
      clearTimeout(healthy);
      markRideScreenHealthy();
      setPhase("app");
    };
  }, []);

  const stop = useCallback(() => {
    Alert.alert("Stop the ride?", "The ride will be saved and the corner calls will stop.", [
      { text: "Keep riding", style: "cancel" },
      {
        text: "Stop",
        style: "destructive",
        onPress: () => {
          void (async () => {
            await stopLocationUpdates();
            await rideEngine.end();
            navigation.navigate("Routes");
          })();
        },
      },
    ]);
  }, [navigation]);

  // The hardware back button must not drop you out of a ride by accident.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      stop();
      return true;
    });
    return () => subscription.remove();
  }, [stop]);

  // A short buzz when a call fires: confirmation the app is alive even if the
  // headset has dropped out.
  useEffect(() => {
    if (!snapshot.lastCall) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [snapshot.lastCall]);

  const state = snapshot.state;
  const next: Corner | null = state?.nextCorner ?? null;
  const distance = state?.distanceToNextCorner ?? null;
  const speedKmh = state ? Math.round(state.speed * 3.6) : 0;
  const accuracy = state?.accuracy ?? null;
  const offRoute = state !== null && !state.onRoute;
  const gpsBad = state !== null && (!state.gpsOk || (accuracy !== null && accuracy > 25));

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.main}>
        {next ? (
          <>
            <Text style={[styles.arrow, { color: gradeColor(next.grade) }]}>
              {ARROW[next.direction]}
            </Text>
            <Text style={[styles.grade, { color: gradeColor(next.grade) }]} numberOfLines={1}>
              {next.grade} {next.direction}
            </Text>
            <Text style={styles.distance}>
              {distance !== null && distance > 0 ? `${Math.round(distance / 10) * 10} m` : "now"}
            </Text>
            {next.modifiers.length > 0 ? (
              <Text style={styles.modifiers}>{next.modifiers.join(" · ")}</Text>
            ) : null}
          </>
        ) : (
          <>
            <Text style={[styles.arrow, styles.dimArrow]}>{ARROW.ahead}</Text>
            <Text style={styles.grade}>
              {state === null ? "waiting for GPS" : state.finished ? "route finished" : "clear"}
            </Text>
          </>
        )}
      </View>

      {offRoute ? (
        <View style={[styles.banner, styles.bannerBad]}>
          <Text style={styles.bannerText}>OFF ROUTE</Text>
        </View>
      ) : null}

      <View style={styles.footer}>
        <View style={styles.readouts}>
          <Readout label="km/h" value={String(speedKmh)} />
          <Readout
            label="GPS"
            value={accuracy === null ? "—" : `±${Math.round(accuracy)} m`}
            tint={gpsBad ? colors.bad : colors.good}
          />
          <Readout
            label="called"
            value={`${state?.calledCornerIds.length ?? 0}`}
          />
        </View>
        <Text style={styles.lastCall} numberOfLines={1}>
          {snapshot.lastCall ? `“${snapshot.lastCall.text}”` : " "}
        </Text>
        <Button label="STOP" kind="danger" big onPress={stop} />
      </View>
    </SafeAreaView>
  );
}

function Readout({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View style={styles.readout}>
      <Text style={[styles.readoutValue, tint ? { color: tint } : null]}>{value}</Text>
      <Text style={styles.readoutLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  main: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  arrow: { fontSize: 190, lineHeight: 200, fontWeight: "900" },
  dimArrow: { color: colors.border },
  grade: { color: colors.text, fontSize: 40, fontWeight: "800", textTransform: "uppercase" },
  distance: { color: colors.text, fontSize: 86, fontWeight: "900", lineHeight: 96 },
  modifiers: { color: colors.textDim, fontSize: 20, textTransform: "uppercase", letterSpacing: 2 },
  banner: { backgroundColor: colors.bad, paddingVertical: spacing.sm, alignItems: "center" },
  bannerBad: { backgroundColor: colors.bad },
  bannerText: { color: "#fff", fontSize: 24, fontWeight: "900", letterSpacing: 3 },
  footer: { padding: spacing.md, gap: spacing.sm },
  readouts: { flexDirection: "row", justifyContent: "space-between" },
  readout: { alignItems: "center", flex: 1 },
  readoutValue: { color: colors.text, fontSize: 30, fontWeight: "700" },
  readoutLabel: { color: colors.textDim, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  lastCall: { color: colors.textDim, fontSize: 16, textAlign: "center", minHeight: 20 },
});
