/**
 * What a ride added up to.
 *
 * Shown straight after stopping, and again from the ride history. The numbers
 * are the reward; the two share buttons are the tuning loop - the GPX and the
 * call log replay through the command-line simulator.
 */

import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { averageMovingSpeed, EMPTY_RIDE_STATS } from "@rally/engine";
import type { RideModeId, RideStats } from "@rally/engine";

import { Button, Card, Heading, Header, Row, Screen, Small, Stat } from "../ui/components";
import { formatClock, formatDate, km, kmh } from "../ui/format";
import { Icon } from "../ui/icons";
import { ModePill } from "../ui/ModePicker";
import { shareFile } from "../ui/share";
import { colors, modeColors, spacing, type } from "../ui/theme";
import { rideEngine } from "../ride/rideEngine";
import { loadRideLog, rideGpxUri, rideJsonUri, type RideLog } from "../ride/rideLogger";
import type { RootStackParamList } from "../navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Summary">;

interface Shown {
  routeName: string;
  startedAt: number;
  endedAt: number | null;
  stats: RideStats;
  mode: RideModeId | null;
  log: RideLog | null;
  preview: boolean;
}

function fromLog(log: RideLog): Shown {
  return {
    routeName: log.routeName,
    startedAt: log.startedAt,
    endedAt: log.endedAt ?? null,
    // Rides logged by the first version of the app only recorded distance.
    stats: log.stats ?? {
      ...EMPTY_RIDE_STATS,
      distanceMeters: log.distanceMeters,
      durationSeconds: log.endedAt ? (log.endedAt - log.startedAt) / 1000 : 0,
      cornersCalled: log.calls.filter((call) => call.kind === "corner").length,
    },
    mode: log.mode ?? null,
    log,
    preview: false,
  };
}

export function SummaryScreen({ navigation, route: navRoute }: Props) {
  const rideId = navRoute.params?.rideId;
  const shown = useMemo<Shown | null>(() => {
    if (rideId) {
      const log = loadRideLog(rideId);
      return log ? fromLog(log) : null;
    }
    const result = rideEngine.getLastResult();
    return result
      ? {
          routeName: result.routeName,
          startedAt: result.startedAt,
          endedAt: result.endedAt,
          stats: result.stats,
          mode: result.mode,
          log: result.log,
          preview: result.preview,
        }
      : null;
  }, [rideId]);

  const done = (): void => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.reset({ index: 0, routes: [{ name: "Home" }] });
  };

  if (!shown) {
    return (
      <Screen scroll={false}>
        <Header title="Ride" onBack={done} />
        <View style={styles.centre}>
          <Small>That ride is no longer on the phone.</Small>
        </View>
      </Screen>
    );
  }

  const { stats } = shown;
  const tint = shown.mode ? modeColors[shown.mode] : colors.accent;
  const average = averageMovingSpeed(stats);
  const calls = shown.log?.calls ?? [];
  const hasMotion = stats.distanceMeters > 20;

  return (
    <Screen
      footer={<Button label="Done" kind="primary" big tint={tint} onPress={done} />}
    >
      <View style={styles.hero}>
        <View style={[styles.badge, { backgroundColor: tint }]}>
          <Icon name={shown.preview ? "eye" : "flag"} size={30} color={colors.onAccent} />
        </View>
        <Text style={styles.kicker}>{shown.preview ? "PREVIEW FINISHED" : "RIDE COMPLETE"}</Text>
        <Text style={styles.title} numberOfLines={2}>
          {shown.routeName}
        </Text>
        <Row gap={spacing.sm}>
          {shown.mode ? <ModePill mode={shown.mode} /> : null}
          <Small>{formatDate(shown.startedAt)}</Small>
        </Row>
      </View>

      <Card>
        <Row gap={spacing.md}>
          <Stat label="distance" value={km(stats.distanceMeters)} unit="km" />
          <Stat label="moving time" value={formatClock(stats.movingSeconds)} />
          <Stat label="corners called" value={String(stats.cornersCalled)} />
        </Row>
        <Row gap={spacing.md}>
          <Stat label="average" value={hasMotion ? String(kmh(average)) : "—"} unit="km/h" />
          <Stat label="top speed" value={hasMotion ? String(kmh(stats.maxSpeed)) : "—"} unit="km/h" />
          <Stat label="max lean (est.)" value={hasMotion ? `${Math.round(stats.maxLean)}°` : "—"} />
        </Row>
      </Card>

      {stats.overspeedCalls > 0 || stats.hazardsCalled > 0 || stats.offRouteSeconds > 30 ? (
        <Card>
          <Heading>Worth knowing</Heading>
          {stats.overspeedCalls > 0 ? (
            <Note
              color={colors.bad}
              text={`${stats.overspeedCalls} corner${stats.overspeedCalls === 1 ? "" : "s"} arrived at too fast to slow comfortably.`}
            />
          ) : null}
          {stats.hazardsCalled > 0 ? (
            <Note color={colors.warn} text={`${stats.hazardsCalled} hazard call${stats.hazardsCalled === 1 ? "" : "s"}.`} />
          ) : null}
          {stats.offRouteSeconds > 30 ? (
            <Note
              color={colors.textDim}
              text={`${formatClock(stats.offRouteSeconds)} spent off the route.`}
            />
          ) : null}
        </Card>
      ) : null}

      {shown.preview ? (
        <Small style={styles.centreText}>
          That was a simulated rider at {shown.mode ? "the mode's" : "a"} typical pace. On the road the
          calls follow your real speed.
        </Small>
      ) : shown.log ? (
        <Card>
          <Heading>Ride files</Heading>
          <Small>
            The track and the log of every call ({calls.length}). Replay them on a computer to tune
            the co-driver.
          </Small>
          <Row gap={spacing.sm}>
            <Button
              label="Share GPX"
              icon="share"
              onPress={() => void shareFile(rideGpxUri(shown.log!.id), "application/gpx+xml")}
              style={styles.flex}
            />
            <Button
              label="Share call log"
              icon="list"
              onPress={() => void shareFile(rideJsonUri(shown.log!.id), "application/json")}
              style={styles.flex}
            />
          </Row>
        </Card>
      ) : (
        <Small style={styles.centreText}>Ride logging is off, so this ride was not saved.</Small>
      )}

      {hasMotion ? (
        <Small style={styles.centreText}>
          Lean is estimated from your speed and the map's corner radius. It is a party number, not a
          measurement.
        </Small>
      ) : null}
    </Screen>
  );
}

function Note({ color, text }: { color: string; text: string }) {
  return (
    <Row gap={spacing.sm}>
      <Icon name="info" size={17} color={color} />
      <Text style={styles.note}>{text}</Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  centreText: { textAlign: "center", paddingHorizontal: spacing.lg },
  hero: { alignItems: "center", gap: spacing.sm, paddingTop: spacing.xl, paddingBottom: spacing.sm },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  kicker: { color: colors.textDim, ...type.label, letterSpacing: 2.2, marginTop: spacing.sm },
  title: { color: colors.text, ...type.hero, fontSize: 28, textAlign: "center" },
  note: { flex: 1, color: colors.text, ...type.small },
});
