/**
 * The ride screen.
 *
 * Everything here is sized for a glance at 60 km/h through a tinted visor.
 * Top to bottom, in the order a rider needs it:
 *
 *   1. the next corner - its shape, its grade, how far - filling a third of
 *      the screen and coloured by how tight it is,
 *   2. the corners after it, small, so a sequence can be read as a sequence,
 *   3. the road ahead drawn heading-up, next to the speed,
 *   4. the controls, of which the only dangerous one has to be held.
 *
 * No scrolling and no small targets. The same screen runs a preview, with the
 * simulated rider's controls where the warnings would otherwise be.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as Haptics from "expo-haptics";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  averageMovingSpeed,
  brakingDistance,
  featureLabel,
  RIDE_MODE_IDS,
  rideMode,
} from "@rally/engine";
import type { UpcomingCorner } from "@rally/engine";

import { Button, Chip, IconButton, ProgressBar, Segmented } from "../ui/components";
import { AheadGlyph, CornerGlyph } from "../ui/CornerGlyph";
import { confirm } from "../ui/dialog";
import { countdown, countdownUnit, formatDistance, formatDuration, kmh, roundedSpeed } from "../ui/format";
import { HoldButton } from "../ui/HoldButton";
import { Icon } from "../ui/icons";
import { ModePill } from "../ui/ModePicker";
import { cornerCode } from "../ui/Pacenote";
import { RoadAhead } from "../ui/RoadAhead";
import {
  alpha,
  colors,
  featureColors,
  gradeColor,
  modeColors,
  radius,
  spacing,
  tabular,
} from "../ui/theme";
import { rideEngine, type RideSnapshot } from "../ride/rideEngine";
import { stopRideLocation } from "../ride/locationTask";
import { loadSettings, runtimeFor, DEFAULT_SETTINGS, type Settings } from "../storage/settings";
import {
  breadcrumb,
  clearBreadcrumb,
  markRideScreenHealthy,
  markRideScreenOpened,
  setPhase,
} from "../diagnostics";
import type { RootStackParamList } from "../navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Ride">;

const capitalise = (text: string): string => text.toUpperCase();
const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export function RideScreen({ navigation, route: navRoute }: Props) {
  const locationMode = navRoute.params?.mode ?? "background";
  // The screen must never sleep mid-ride. Done by hand rather than with the
  // hook so that a phone refusing the wake lock is not an unhandled error.
  useEffect(() => {
    void activateKeepAwakeAsync("ride").catch(() => undefined);
    return () => {
      void deactivateKeepAwake("ride").catch(() => undefined);
    };
  }, []);
  const [snapshot, setSnapshot] = useState<RideSnapshot>(rideEngine.getSnapshot());
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [resuming, setResuming] = useState(!rideEngine.getSnapshot().active);
  const [aheadSize, setAheadSize] = useState<{ width: number; height: number } | null>(null);
  const stopping = useRef(false);
  const { width: windowWidth } = useWindowDimensions();

  useEffect(() => rideEngine.subscribe(setSnapshot), []);
  useEffect(() => {
    void loadSettings().then(setSettings);
  }, [snapshot.mode]);

  // Opened from the notification after the UI was torn down: the service kept
  // the ride going, so pick it back up rather than showing an empty screen.
  useEffect(() => {
    if (rideEngine.getSnapshot().active) return;
    let cancelled = false;
    void rideEngine.resume().finally(() => {
      if (!cancelled) setResuming(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Crash-loop guard. The marker written here is cleared only once the screen
   * has survived long enough to be trusted; if the app dies in between - even
   * from a native crash, which no JavaScript handler can see - the next launch
   * finds the marker and refuses to walk straight back in.
   */
  useEffect(() => {
    setPhase("ride-screen");
    breadcrumb("ride:screen-mounted");
    markRideScreenOpened(
      rideEngine.getSnapshot().routeName || "route",
      locationMode === "preview" ? "demo" : locationMode,
    );
    const marks = [
      setTimeout(() => breadcrumb("ride:survived-2s"), 2000),
      setTimeout(() => breadcrumb("ride:survived-6s"), 6000),
    ];
    const healthy = setTimeout(() => {
      markRideScreenHealthy();
      // Survived long enough that the breadcrumb trail is no longer evidence
      // of anything; a later crash should not be blamed on ride start.
      clearBreadcrumb();
    }, 8000);
    return () => {
      clearTimeout(healthy);
      for (const mark of marks) clearTimeout(mark);
      markRideScreenHealthy();
      setPhase("app");
    };
  }, [locationMode]);

  const finish = useCallback(async () => {
    if (stopping.current) return;
    stopping.current = true;
    try {
      await stopRideLocation();
      await rideEngine.end();
    } finally {
      navigation.reset({ index: 1, routes: [{ name: "Home" }, { name: "Summary", params: {} }] });
    }
  }, [navigation]);

  // The hardware back button must not drop you out of a ride by accident.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      const question = snapshot.preview
        ? {
            title: "End the preview?",
            confirmLabel: "End preview",
            cancelLabel: "Keep watching",
            destructive: true,
          }
        : {
            title: "Stop the ride?",
            body: "The ride will be saved and the corner calls will stop.",
            confirmLabel: "Stop ride",
            cancelLabel: "Keep riding",
            destructive: true,
          };
      void confirm(question).then((yes) => {
        if (yes) void finish();
      });
      return true;
    });
    return () => subscription.remove();
  }, [finish, snapshot.preview]);

  // A short buzz and a flash when a corner call fires: confirmation the app is
  // alive even if the headset has dropped out.
  const flash = useRef(new Animated.Value(0)).current;
  const lastCall = snapshot.lastCall;
  useEffect(() => {
    if (!lastCall || lastCall.kind !== "corner") return;
    flash.setValue(1);
    Animated.timing(flash, { toValue: 0, duration: 900, useNativeDriver: false }).start();
    if (settings.haptics && Platform.OS !== "web") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    }
  }, [lastCall, flash, settings.haptics]);

  const cycleMode = useCallback(() => {
    const index = RIDE_MODE_IDS.indexOf(snapshot.mode);
    void rideEngine.setMode(RIDE_MODE_IDS[(index + 1) % RIDE_MODE_IDS.length]!);
  }, [snapshot.mode]);

  const onAheadLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setAheadSize((current) =>
      current && Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
        ? current
        : { width, height },
    );
  }, []);

  const route = rideEngine.getRoute();
  const state = snapshot.state;
  const modeTint = modeColors[snapshot.mode];
  const runtime = useMemo(() => runtimeFor(settings), [settings]);
  const pacenotes = runtime.rallyMode === true;

  if (!snapshot.active) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.idle}>
          <AheadGlyph size={96} />
          <Text style={styles.idleText}>
            {resuming ? "Picking the ride back up…" : "No ride is running"}
          </Text>
          {!resuming ? (
            <Button
              label="Back to routes"
              kind="primary"
              onPress={() => navigation.reset({ index: 0, routes: [{ name: "Home" }] })}
            />
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  const upcoming = state?.upcoming ?? [];
  const next: UpcomingCorner | undefined = upcoming[0];
  const after = upcoming.slice(1, 4);
  const speed = state?.speed ?? 0;
  const accuracy = state?.accuracy ?? null;
  const offRoute = state !== null && !state.onRoute;
  const gpsLost = state !== null && !state.gpsOk;
  const gpsWeak = accuracy !== null && accuracy > 25;
  const reversed = state?.travelDirection === -1;
  const tint = next ? gradeColor(next.corner.grade) : colors.textFaint;
  const inCorner = next !== undefined && next.distance <= 0;
  const calledNext =
    next !== undefined &&
    lastCall?.kind === "corner" &&
    lastCall.cornerIds.includes(next.corner.id);
  const warned = calledNext && lastCall?.overspeed === true;
  // The same test the voice uses: still approaching, and even braking harder
  // than usual there is not enough road left to get down to the corner's speed.
  const tooFast =
    next !== undefined &&
    next.distance > 0 &&
    next.corner.rallyNumber <= 4 &&
    settings.speedWarnings &&
    brakingDistance(
      speed,
      next.advisorySpeed,
      (runtime.brakingG ?? 0.35) * (1 + (runtime.overspeedMargin ?? 0.5)),
      0,
    ) >
      next.distance + next.corner.length * 0.3;
  const distanceText = next ? countdown(next.distance) : "";
  const distanceSize = distanceText === "NOW" ? 60 : distanceText.length >= 3 ? 80 : 104;
  // "VERY SHARP RIGHT" has to fit a small phone as surely as "SLIGHT LEFT"
  // fits a big one: size the name to the room there is.
  const nameText = next
    ? pacenotes
      ? cornerCode(next.corner)
      : capitalise(`${next.corner.grade} ${next.corner.direction}`)
    : "";
  const nameRoom = windowWidth - spacing.md * 2 - spacing.lg * 2 - 62;
  const nameSize = pacenotes
    ? 46
    : Math.max(20, Math.min(38, nameRoom / (Math.max(1, nameText.length) * 0.66)));

  const remaining = state?.remaining ?? null;
  const pace = Math.max(
    5,
    averageMovingSpeed(snapshot.stats) || rideMode(snapshot.mode).typicalSpeedKmh / 3.6,
  );
  const feature = state?.nextFeature ?? null;
  const modifiers = next
    ? next.corner.modifiers.filter((modifier) => modifier !== "into")
    : [];

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
      {/* ------------------------------------------------------- top bar */}
      <View style={styles.topBar}>
        <ModePill mode={snapshot.mode} onPress={cycleMode} />
        <View style={styles.progress}>
          <View style={styles.progressLabels}>
            <Text style={styles.progressText} numberOfLines={1}>
              {remaining === null
                ? snapshot.routeName
                : `${formatDistance(remaining)} left · ${formatDuration(remaining / pace)}`}
            </Text>
            {reversed ? <Text style={styles.progressText}>riding back</Text> : null}
          </View>
          <ProgressBar value={state?.progress ?? 0} color={modeTint} height={5} />
        </View>
        <View style={styles.gps}>
          <View
            style={[
              styles.gpsDot,
              {
                backgroundColor:
                  state === null ? colors.textFaint : gpsLost ? colors.bad : gpsWeak ? colors.warn : colors.good,
              },
            ]}
          />
          <Text style={styles.gpsText}>
            {snapshot.preview ? "SIM" : accuracy === null ? "GPS" : `±${Math.round(accuracy)}`}
          </Text>
        </View>
      </View>

      {/* ------------------------------------------------------ the corner */}
      <View
        style={[
          styles.main,
          { borderColor: alpha(tint, inCorner ? 0.9 : 0.45), backgroundColor: alpha(tint, 0.1) },
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: tint,
              opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.3] }),
            },
          ]}
        />
        {offRoute ? (
          <View style={styles.mainCentre}>
            <Icon name="alert" size={72} color={colors.bad} />
            <Text style={[styles.status, { color: colors.bad }]}>OFF ROUTE</Text>
            <Text style={styles.statusHint}>Calls resume when you rejoin the route</Text>
          </View>
        ) : next ? (
          <>
            <View style={styles.mainRow}>
              <CornerGlyph
                rallyNumber={next.corner.rallyNumber}
                direction={next.corner.direction}
                size={132}
                color={tint}
              />
              <View style={styles.distanceBlock}>
                <Text
                  style={[
                    styles.distance,
                    { fontSize: distanceSize, lineHeight: distanceSize + 6 },
                    inCorner && { color: tint },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {distanceText}
                </Text>
                <Text style={styles.distanceUnit}>
                  {inCorner ? "in the corner" : countdownUnit(next.distance) === "km" ? "kilometres" : "metres"}
                </Text>
              </View>
            </View>
            <View style={styles.nameRow}>
              <Text
                style={[styles.cornerName, { color: tint, fontSize: nameSize, lineHeight: nameSize + 6 }]}
                numberOfLines={1}
              >
                {nameText}
              </Text>
              {pacenotes ? (
                <Text style={styles.cornerSub} numberOfLines={1}>
                  {next.corner.grade} {next.corner.direction}
                </Text>
              ) : (
                <Text
                  numberOfLines={1}
                  style={[styles.cornerCodeBadge, { color: tint, borderColor: alpha(tint, 0.6) }]}
                >
                  {cornerCode(next.corner)}
                </Text>
              )}
            </View>
            <View style={styles.tagRow}>
              {(warned && !inCorner) || tooFast ? (
                <Chip label={settings.mode === "duke" ? "brake" : "slow down"} color={colors.bad} icon="alert" solid />
              ) : next.corner.caution ? (
                <Chip label="caution" color={colors.bad} icon="alert" />
              ) : null}
              {modifiers.map((modifier) => (
                <Chip key={modifier} label={modifier} color={colors.text} />
              ))}
              {settings.showCornerSpeed && next.corner.rallyNumber <= 5 ? (
                <Chip label={`≈ ${roundedSpeed(next.advisorySpeed)} km/h`} color={colors.textDim} icon="gauge" />
              ) : null}
            </View>
          </>
        ) : (
          <View style={styles.mainCentre}>
            <AheadGlyph size={130} color={state === null ? colors.textFaint : colors.good} />
            <Text style={styles.status}>
              {state === null
                ? snapshot.preview
                  ? "STARTING"
                  : "WAITING FOR GPS"
                : state.finished
                  ? "ROUTE FINISHED"
                  : "CLEAR ROAD"}
            </Text>
            {state === null && !snapshot.preview ? (
              <Text style={styles.statusHint}>Stand in the open for a few seconds</Text>
            ) : null}
          </View>
        )}
      </View>

      {/* --------------------------------------------------- what follows */}
      <View style={styles.thenRow}>
        <Text style={styles.thenLabel}>THEN</Text>
        {after.length === 0 ? (
          <Text style={styles.thenEmpty}>{next ? "nothing close" : "—"}</Text>
        ) : (
          after.map((item) => {
            const color = gradeColor(item.corner.grade);
            return (
              <View key={item.corner.id} style={[styles.thenItem, { borderColor: alpha(color, 0.45) }]}>
                <CornerGlyph
                  rallyNumber={item.corner.rallyNumber}
                  direction={item.corner.direction}
                  size={30}
                  color={color}
                  weight={0.16}
                />
                <View>
                  <Text style={[styles.thenCode, { color }]}>{cornerCode(item.corner)}</Text>
                  <Text style={styles.thenDistance}>{formatDistance(Math.max(0, item.distance))}</Text>
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* ------------------------------------------- road ahead and speed */}
      <View style={styles.lower}>
        <View style={styles.ahead} onLayout={onAheadLayout}>
          {route && aheadSize && state?.dist !== null && state?.dist !== undefined && !offRoute ? (
            <RoadAhead
              route={route}
              dist={state.dist}
              direction={state.travelDirection}
              speed={speed}
              width={aheadSize.width}
              height={aheadSize.height}
            />
          ) : (
            <View style={styles.aheadEmpty}>
              <Icon name="route" size={28} color={colors.textFaint} />
            </View>
          )}
        </View>
        <View style={styles.side}>
          <View style={styles.speedBox}>
            <Text style={[styles.speed, tooFast && { color: colors.bad }]}>{kmh(speed)}</Text>
            <Text style={styles.speedUnit}>km/h</Text>
          </View>
          {feature ? (
            <View
              style={[
                styles.hazard,
                { borderColor: alpha(featureColors[feature.feature.kind], 0.6) },
              ]}
            >
              <Icon name="alert" size={16} color={featureColors[feature.feature.kind]} />
              <View style={styles.flex}>
                <Text style={[styles.hazardName, { color: featureColors[feature.feature.kind] }]} numberOfLines={1}>
                  {sentence(featureLabel(feature.feature))}
                </Text>
                <Text style={styles.hazardDistance}>
                  {feature.distance <= 0 ? "now" : `in ${formatDistance(feature.distance)}`}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.miniStats}>
              <MiniStat label="lean" value={`${Math.round(state?.lean ?? 0)}°`} />
              <MiniStat label="called" value={String(snapshot.stats.cornersCalled)} />
            </View>
          )}
        </View>
      </View>

      {/* ------------------------------------------------------- messages */}
      {gpsLost ? (
        <Notice color={colors.bad} text="GPS LOST — no calls until it returns" />
      ) : locationMode === "foreground" ? (
        <Notice color={colors.warn} text="Keep this screen on — calls stop if the phone locks" />
      ) : rideEngine.isAudioDisabled ? (
        <Notice color={colors.warn} text="Audio extras are off after a crash — calls still play" />
      ) : (
        <Text style={styles.lastCall} numberOfLines={1}>
          {lastCall ? `“${lastCall.text}”` : snapshot.routeName}
        </Text>
      )}

      {/* ------------------------------------------------------- controls */}
      {snapshot.preview ? (
        <View style={styles.previewBar}>
          <IconButton
            icon={snapshot.preview.paused ? "play" : "pause"}
            label={snapshot.preview.paused ? "Resume preview" : "Pause preview"}
            filled
            size={50}
            onPress={() => rideEngine.setPreview({ paused: !snapshot.preview!.paused })}
          />
          <View style={styles.flex}>
            <Segmented<number>
              value={snapshot.preview.multiplier}
              onChange={(multiplier) => rideEngine.setPreview({ multiplier, paused: false })}
              tint={modeTint}
              options={[
                { value: 1, label: "1×" },
                { value: 2, label: "2×" },
                { value: 4, label: "4×" },
                { value: 8, label: "8×" },
              ]}
            />
          </View>
        </View>
      ) : null}
      <View style={styles.controls}>
        <IconButton
          icon={snapshot.muted ? "mute" : "volume"}
          label={snapshot.muted ? "Unmute calls" : "Mute calls"}
          filled
          size={60}
          color={snapshot.muted ? colors.bad : colors.text}
          onPress={() => rideEngine.setMuted(!snapshot.muted)}
        />
        <IconButton
          icon="repeat"
          label="Repeat the last call"
          filled
          size={60}
          disabled={snapshot.muted || snapshot.recentCalls.length === 0}
          onPress={() => rideEngine.repeatLast()}
        />
        <HoldButton
          label={snapshot.preview ? "END" : "STOP"}
          icon="stop"
          onComplete={() => void finish()}
        />
      </View>
    </SafeAreaView>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniValue}>{value}</Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </View>
  );
}

function Notice({ color, text }: { color: string; text: string }) {
  return (
    <View style={[styles.notice, { backgroundColor: alpha(color, 0.16), borderColor: alpha(color, 0.6) }]}>
      <Text style={[styles.noticeText, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: "#000000", paddingHorizontal: spacing.md, gap: spacing.sm },
  idle: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  idleText: { color: colors.textDim, fontSize: 18, fontWeight: "700" },

  topBar: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingTop: spacing.xs },
  progress: { flex: 1, gap: 5 },
  progressLabels: { flexDirection: "row", justifyContent: "space-between" },
  progressText: { color: colors.textDim, fontSize: 12, fontWeight: "700", ...tabular },
  gps: { flexDirection: "row", alignItems: "center", gap: 5 },
  gpsDot: { width: 9, height: 9, borderRadius: 5 },
  gpsText: { color: colors.textDim, fontSize: 12, fontWeight: "800", ...tabular },

  main: {
    flex: 5,
    minHeight: 220,
    borderRadius: radius.xl,
    borderWidth: 2,
    overflow: "hidden",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    justifyContent: "center",
    gap: spacing.xs,
  },
  mainCentre: { alignItems: "center", justifyContent: "center", gap: spacing.sm },
  mainRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  distanceBlock: { flex: 1, alignItems: "flex-end" },
  distance: {
    color: colors.text,
    fontSize: 104,
    lineHeight: 110,
    fontWeight: "900",
    letterSpacing: -3,
    ...tabular,
  },
  distanceUnit: {
    color: colors.textDim,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginTop: -2,
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  cornerName: { flexShrink: 1, fontSize: 38, fontWeight: "900", letterSpacing: 0.5 },
  cornerSub: { flexShrink: 1, color: colors.textDim, fontSize: 18, fontWeight: "700", textTransform: "uppercase" },
  cornerCodeBadge: {
    fontSize: 18,
    fontWeight: "900",
    borderWidth: 1.5,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 1,
    overflow: "hidden",
    flexShrink: 0,
  },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, minHeight: 26 },
  status: { color: colors.text, fontSize: 30, fontWeight: "900", letterSpacing: 2, textAlign: "center" },
  statusHint: { color: colors.textDim, fontSize: 15, fontWeight: "600", textAlign: "center" },

  thenRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 50 },
  thenLabel: { color: colors.textFaint, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  thenEmpty: { color: colors.textFaint, fontSize: 14, fontWeight: "600" },
  thenItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  thenCode: { fontSize: 17, fontWeight: "900" },
  thenDistance: { color: colors.textDim, fontSize: 12, fontWeight: "700", ...tabular },

  lower: { flex: 4, minHeight: 150, flexDirection: "row", gap: spacing.sm },
  ahead: { flex: 1 },
  aheadEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  side: { flex: 1, gap: spacing.sm },
  speedBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  speed: { color: colors.text, fontSize: 68, lineHeight: 72, fontWeight: "900", letterSpacing: -2, ...tabular },
  speedUnit: { color: colors.textDim, fontSize: 13, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" },
  hazard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    minHeight: 58,
  },
  hazardName: { fontSize: 15, fontWeight: "800" },
  hazardDistance: { color: colors.textDim, fontSize: 13, fontWeight: "700", ...tabular },
  miniStats: {
    flexDirection: "row",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 58,
  },
  miniStat: { flex: 1, alignItems: "center", justifyContent: "center" },
  miniValue: { color: colors.text, fontSize: 20, fontWeight: "800", ...tabular },
  miniLabel: { color: colors.textDim, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },

  lastCall: { color: colors.textDim, fontSize: 15, fontWeight: "600", textAlign: "center", minHeight: 30, lineHeight: 30 },
  notice: {
    minHeight: 30,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  noticeText: { fontSize: 13, fontWeight: "800", letterSpacing: 0.4 },

  previewBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  controls: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingBottom: spacing.sm },
});
