/**
 * Home: pick how you want to ride, pick a road, go.
 *
 * Importing works two ways - the document picker, and "open with" / share from
 * any other app, which is how a GPX actually arrives (Gmail attachment,
 * Telegram, a planner's export button).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as Linking from "expo-linking";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { rideMode } from "@rally/engine";
import type { RideModeId } from "@rally/engine";

import {
  Banner,
  Button,
  Card,
  Chip,
  Empty,
  IconButton,
  Label,
  Meter,
  Row,
  Screen,
  Small,
} from "../ui/components";
import { inform, notify } from "../ui/dialog";
import { formatDuration, km, twistiness, TWISTINESS_WORDS } from "../ui/format";
import { Icon } from "../ui/icons";
import { ModePicker } from "../ui/ModePicker";
import { RouteThumbnail } from "../ui/StageMap";
import { colors, gradeColor, GRADE_ORDER, modeColors, radius, spacing, tabular, type } from "../ui/theme";
import { readExternal } from "../storage/files";
import {
  backfillSummaries,
  importDemoRoute,
  importGpx,
  listRoutes,
  type RouteSummary,
} from "../storage/routes";
import { loadSettings, toEngineConfig } from "../storage/settings";
import { rideEngine } from "../ride/rideEngine";
import type { RootStackParamList } from "../navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

export function HomeScreen({ navigation }: Props) {
  const [routes, setRoutes] = useState<RouteSummary[] | null>(null);
  const [mode, setMode] = useState<RideModeId>("sport");
  const [progress, setProgress] = useState<string | null>(null);
  const [rideActive, setRideActive] = useState(rideEngine.getSnapshot().active);
  // Road data is a bonus, never a blocker: the rider can always walk away from
  // it and keep the import.
  const importAbort = useRef<AbortController | null>(null);
  const importing = progress !== null;

  const refresh = useCallback(async () => {
    setRoutes(await listRoutes());
    const settings = await loadSettings();
    setMode(settings.mode);
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => void refresh());
    void refresh();
    // Routes imported by an older version get their thumbnails once.
    void backfillSummaries().then((changed) => {
      if (changed) void refresh();
    });
    return unsubscribe;
  }, [navigation, refresh]);

  useEffect(() => rideEngine.subscribe((snapshot) => setRideActive(snapshot.active)), []);

  const chooseMode = useCallback((next: RideModeId) => {
    setMode(next);
    void rideEngine.setMode(next);
  }, []);

  const importFromUri = useCallback(
    async (uri: string, name: string) => {
      if (importAbort.current) return; // one import at a time
      const abort = new AbortController();
      importAbort.current = abort;
      setProgress("Opening the file…");
      try {
        const xml = await readExternal(uri);
        const settings = await loadSettings();
        const result = await importGpx(xml, name.replace(/\.gpx$/i, ""), {
          useOsm: settings.useOsmSnapping,
          engineConfig: toEngineConfig(settings),
          onProgress: setProgress,
          signal: abort.signal,
        });
        await refresh();
        navigation.navigate("Route", { routeId: result.summary.id });
        if (result.osmNote) {
          notify("Imported from the GPX as-is — road data was not used");
        }
      } catch (error) {
        void inform("Could not import that file", (error as Error).message);
      } finally {
        importAbort.current = null;
        setProgress(null);
      }
    },
    [navigation, refresh],
  );

  /** Files opened from other apps ("open with", share sheet). */
  useEffect(() => {
    if (Platform.OS === "web") return;
    const handle = (url: string | null): void => {
      if (!url) return;
      if (!/\.gpx($|\?)/i.test(url) && !url.startsWith("content://")) return;
      let name = "Shared route";
      try {
        name = decodeURIComponent(url.split("/").pop() ?? name);
      } catch {
        // A file name that is not valid URI encoding still imports fine.
      }
      void importFromUri(url, name);
    };
    void Linking.getInitialURL().then(handle).catch(() => undefined);
    const subscription = Linking.addEventListener("url", (event) => handle(event.url));
    return () => subscription.remove();
  }, [importFromUri]);

  const pickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        // Android file managers label GPX inconsistently, so accept anything and
        // let the parser decide.
        type: ["application/gpx+xml", "application/xml", "text/xml", "*/*"],
        copyToCacheDirectory: true,
      });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;
      await importFromUri(asset.uri, asset.name);
    } catch (error) {
      void inform("Could not open the file picker", (error as Error).message);
    }
  }, [importFromUri]);

  const addDemo = useCallback(async () => {
    try {
      const summary = await importDemoRoute();
      await refresh();
      navigation.navigate("Route", { routeId: summary.id });
    } catch (error) {
      void inform("Could not add the demo stage", (error as Error).message);
    }
  }, [navigation, refresh]);

  const tint = modeColors[mode];

  return (
    <Screen
      footer={
        <Button
          label="Import a GPX route"
          icon="import"
          kind="primary"
          big
          tint={tint}
          busy={importing}
          onPress={() => void pickFile()}
        />
      }
    >
      <View style={styles.top}>
        <View style={styles.flex}>
          <Text style={[styles.wordmark, { color: tint }]}>RALLY CO-DRIVER</Text>
          <Text style={styles.hero}>Where to today?</Text>
        </View>
        <IconButton icon="history" label="Past rides" filled onPress={() => navigation.navigate("Rides")} />
        <IconButton icon="settings" label="Settings" filled onPress={() => navigation.navigate("Settings")} />
      </View>

      {rideActive ? (
        <Banner
          text="A ride is running. Tap to go back to it."
          color={colors.good}
          icon="play"
          onPress={() => navigation.navigate("Ride", { routeId: rideEngine.getSnapshot().routeId ?? "" })}
        />
      ) : null}

      {importing ? (
        <Card tint={tint}>
          <Row gap={spacing.md}>
            <ActivityIndicator color={tint} />
            <View style={styles.flex}>
              <Text style={styles.importTitle}>Importing route</Text>
              <Small>{progress}</Small>
            </View>
          </Row>
          <Button
            label="Skip road data, use the file as it is"
            kind="ghost"
            onPress={() => importAbort.current?.abort()}
          />
        </Card>
      ) : null}

      <View style={styles.group}>
        <Label>Ride mode</Label>
        <Card>
          <ModePicker value={mode} onChange={chooseMode} />
        </Card>
      </View>

      <View style={styles.group}>
        <Row style={styles.between}>
          <Label>Your routes</Label>
          {routes && routes.length > 0 ? <Label>{`${routes.length}`}</Label> : null}
        </Row>

        {routes === null ? (
          <ActivityIndicator color={tint} style={styles.loading} />
        ) : routes.length === 0 ? (
          <Card>
            <Empty
              icon="route"
              title="No routes yet"
              body="Import a GPX from any route planner, or share one to this app from WhatsApp, Gmail or your file manager."
            >
              <Button label="Try the demo stage" icon="sparkle" onPress={() => void addDemo()} />
            </Empty>
          </Card>
        ) : (
          routes.map((route) => (
            <RouteCard
              key={route.id}
              route={route}
              mode={mode}
              onPress={() => navigation.navigate("Route", { routeId: route.id })}
            />
          ))
        )}
      </View>

      {routes && routes.length > 0 && !routes.some((r) => r.demo) ? (
        <Pressable onPress={() => void addDemo()} style={({ pressed }) => [styles.demoLink, pressed && styles.pressed]}>
          <Icon name="sparkle" size={16} color={colors.textDim} />
          <Text style={styles.demoText}>Add the demo stage</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

function RouteCard({
  route,
  mode,
  onPress,
}: {
  route: RouteSummary;
  mode: RideModeId;
  onPress: () => void;
}) {
  const lengthKm = Math.max(0.001, route.lengthMeters / 1000);
  const score = twistiness(route.stats.cornersPerKm, route.stats.hairpinCount / lengthKm);
  // A rough ride time: the mode's cruising speed, knocked back by how twisty it is.
  const pace = (rideMode(mode).typicalSpeedKmh / 3.6) * (1 - score * 0.07);
  const grades = GRADE_ORDER.filter((grade) => (route.stats.byGrade[grade] ?? 0) > 0);
  const total = Math.max(1, route.stats.cornerCount);

  return (
    <Card onPress={onPress} padded={false}>
      <View style={styles.routeRow}>
        <RouteThumbnail thumb={route.thumb ?? []} size={84} color={modeColors[mode]} />
        <View style={styles.routeBody}>
          <Text style={styles.routeName} numberOfLines={2}>
            {route.name}
          </Text>
          <Text style={styles.routeMeta} numberOfLines={1}>
            {km(route.lengthMeters)} km · {route.stats.cornerCount} corners · ~{formatDuration(route.lengthMeters / pace)}
          </Text>
          <Row gap={spacing.sm} style={styles.routeTags}>
            <Meter value={score} color={modeColors[mode]} />
            <Text style={styles.routeScore}>{TWISTINESS_WORDS[score]}</Text>
            {route.stats.hairpinCount > 0 ? (
              <Chip label={`${route.stats.hairpinCount} hairpin${route.stats.hairpinCount === 1 ? "" : "s"}`} color={gradeColor("hairpin")} />
            ) : null}
            {route.demo ? <Chip label="demo" color={colors.info} /> : null}
          </Row>
        </View>
        <Icon name="forward" size={18} color={colors.textFaint} />
      </View>
      {/* The mix of corners, as one stacked bar along the bottom of the card. */}
      <View style={styles.mix}>
        {grades.length === 0 ? (
          <View style={[styles.mixPart, { flex: 1, backgroundColor: colors.surfaceTop }]} />
        ) : (
          grades.map((grade) => (
            <View
              key={grade}
              style={[
                styles.mixPart,
                { flex: (route.stats.byGrade[grade] ?? 0) / total, backgroundColor: gradeColor(grade) },
              ]}
            />
          ))
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  wordmark: { ...type.label, letterSpacing: 2.2 },
  hero: { color: colors.text, ...type.hero },
  group: { gap: spacing.sm },
  between: { justifyContent: "space-between" },
  loading: { paddingVertical: spacing.xxl },
  importTitle: { color: colors.text, ...type.heading },
  pressed: { opacity: 0.6 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  routeBody: { flex: 1, gap: 3, minWidth: 0 },
  routeName: { color: colors.text, fontSize: 17, fontWeight: "700", lineHeight: 21 },
  routeMeta: { color: colors.textDim, fontSize: 13, ...tabular },
  routeTags: { flexWrap: "wrap", marginTop: 3 },
  routeScore: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  mix: { flexDirection: "row", height: 4, gap: 1 },
  mixPart: { height: 4 },
  demoLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 44,
    borderRadius: radius.md,
  },
  demoText: { color: colors.textDim, fontSize: 14, fontWeight: "600" },
});
