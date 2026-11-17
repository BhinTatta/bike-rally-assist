/**
 * One route: what it is going to be like, and the buttons that start it.
 *
 * The map is the headline, but the rest is what decides whether you ride it
 * before or after lunch: how long, how twisty, where it climbs, what is
 * waiting on it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useIsFocused } from "@react-navigation/native";
import { rideMode, speedProfile } from "@rally/engine";
import type { AnalysedRoute, RideModeId, RouteSection } from "@rally/engine";

import {
  Button,
  Card,
  Header,
  Heading,
  IconButton,
  Label,
  Row,
  Screen,
  Small,
  Stat,
} from "../ui/components";
import { confirm, notify } from "../ui/dialog";
import { formatDistance, formatDuration, km } from "../ui/format";
import { Dot, Icon } from "../ui/icons";
import { ModePill } from "../ui/ModePicker";
import { FeatureRow, PacenoteRow } from "../ui/Pacenote";
import { StageMap } from "../ui/StageMap";
import { StageProfile } from "../ui/StageProfile";
import {
  alpha,
  colors,
  gradeColor,
  GRADE_ORDER,
  modeColors,
  radius,
  sectionColors,
  sectionNames,
  spacing,
  tabular,
  type,
} from "../ui/theme";
import {
  deleteRoute,
  getRouteSummary,
  loadRoute,
  renameRoute,
  type RouteSummary,
} from "../storage/routes";
import { loadSettings, runtimeFor, type Settings } from "../storage/settings";
import { startPreview, startRide } from "../ride/startRide";
import type { RootStackParamList } from "../navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Route">;

/** How long the route takes in a mode: the simulated rider's time, end to end. */
function estimateSeconds(route: AnalysedRoute, mode: RideModeId): number {
  const preset = rideMode(mode);
  const profile = speedProfile(
    route,
    preset.typicalSpeedKmh / 3.6,
    (preset.runtime.lateralG ?? 0.35) * 1.15,
  );
  let seconds = 0;
  for (let i = 1; i < profile.length; i++) {
    const step = route.points[i]!.dist - route.points[i - 1]!.dist;
    seconds += step / Math.max(1, (profile[i]! + profile[i - 1]!) / 2);
  }
  return seconds;
}

export function RouteScreen({ navigation, route: navRoute }: Props) {
  const { routeId } = navRoute.params;
  const [route, setRoute] = useState<AnalysedRoute | null>(null);
  const [summary, setSummary] = useState<RouteSummary | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [missing, setMissing] = useState(false);
  const [starting, setStarting] = useState<"ride" | "preview" | null>(null);
  const [highlight, setHighlight] = useState<RouteSection | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  // A screen stays mounted underneath the one pushed on top of it. There is no
  // reason to keep a long route's drawing alive behind the ride screen.
  const isFocused = useIsFocused();

  const load = useCallback(async () => {
    const [loaded, entry, current] = await Promise.all([
      loadRoute(routeId),
      getRouteSummary(routeId),
      loadSettings(),
    ]);
    setRoute(loaded);
    setSummary(entry);
    setSettings(current);
    setMissing(loaded === null);
  }, [routeId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The mode may have been changed in Settings while this screen was behind it.
  useEffect(() => {
    if (isFocused) void loadSettings().then(setSettings);
  }, [isFocused]);

  const mode = settings?.mode ?? "sport";
  const tint = modeColors[mode];
  const pacenotes = settings ? runtimeFor(settings).rallyMode === true : false;
  const estimate = useMemo(() => (route ? estimateSeconds(route, mode) : 0), [route, mode]);

  const begin = useCallback(
    async (kind: "ride" | "preview") => {
      if (!route || starting) return;
      setStarting(kind);
      try {
        const result =
          kind === "preview" ? await startPreview(routeId, route) : await startRide(routeId, route);
        if (result.started) navigation.navigate("Ride", { routeId, mode: result.mode });
      } catch (error) {
        notify((error as Error).message, "bad");
      } finally {
        setStarting(null);
      }
    },
    [navigation, route, routeId, starting],
  );

  const remove = useCallback(async () => {
    const ok = await confirm({
      title: "Delete this route?",
      body: `"${summary?.name ?? "This route"}" will be removed from this phone. Rides you logged on it are kept.`,
      confirmLabel: "Delete route",
      cancelLabel: "Keep it",
      destructive: true,
    });
    if (!ok) return;
    await deleteRoute(routeId);
    navigation.goBack();
  }, [navigation, routeId, summary?.name]);

  const saveName = useCallback(async () => {
    setRenaming(false);
    const name = draftName.trim();
    if (!name || name === summary?.name) return;
    await renameRoute(routeId, name);
    await load();
  }, [draftName, load, routeId, summary?.name]);

  if (missing) {
    return (
      <Screen scroll={false}>
        <Header title="Route" onBack={() => navigation.goBack()} />
        <View style={styles.centre}>
          <Heading>This route is no longer on the phone</Heading>
          <Small>Its file is missing. Import the GPX again.</Small>
          <Button label="Remove it from the list" onPress={() => void deleteRoute(routeId).then(() => navigation.goBack())} />
        </View>
      </Screen>
    );
  }

  if (!route || !settings) {
    return (
      <Screen scroll={false}>
        <Header title="Route" onBack={() => navigation.goBack()} />
        <View style={styles.centre}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </Screen>
    );
  }

  const stats = summary?.stats;
  const name = summary?.name ?? route.name ?? "Route";
  const features = route.features ?? [];
  const sections = (route.sections ?? []).filter((s) => s.endDist - s.startDist >= 300);
  const cornerTotal = Math.max(1, route.corners.length);
  const cautions = route.corners.filter((c) => c.caution).length;
  const previewNotes = route.corners.slice(0, 4);

  return (
    <View style={styles.flex}>
      <Screen
        footer={
          <Row gap={spacing.md}>
            <Button
              label="Preview"
              icon="eye"
              big
              busy={starting === "preview"}
              disabled={starting === "ride"}
              onPress={() => void begin("preview")}
            />
            <Button
              label="Start ride"
              icon="play"
              kind="primary"
              big
              tint={tint}
              busy={starting === "ride"}
              disabled={starting === "preview"}
              onPress={() => void begin("ride")}
              style={styles.flex}
            />
          </Row>
        }
        style={styles.content}
      >
        <Header
          title={name}
          subtitle={summary?.roadNames.length ? summary.roadNames.slice(0, 3).join(" · ") : undefined}
          onBack={() => navigation.goBack()}
          right={
            <>
              <IconButton
                icon="edit"
                label="Rename"
                onPress={() => {
                  setDraftName(name);
                  setRenaming(true);
                }}
              />
              <IconButton icon="trash" label="Delete route" onPress={() => void remove()} />
            </>
          }
        />

        <View style={styles.padded}>
          {isFocused ? (
            <StageMap route={route} height={300} interactive highlight={highlight} />
          ) : (
            <View style={styles.mapPlaceholder} />
          )}
          <View style={styles.legend}>
            {GRADE_ORDER.filter((grade) => (stats?.byGrade[grade] ?? 0) > 0).map((grade) => (
              <View key={grade} style={styles.legendItem}>
                <Dot color={gradeColor(grade)} size={8} />
                <Text style={styles.legendText}>{grade}</Text>
              </View>
            ))}
          </View>

          <Card>
            <Row gap={spacing.md}>
              <Stat label="distance" value={km(route.length)} unit="km" />
              <Stat label={`time · ${rideMode(mode).name}`} value={formatDuration(estimate)} />
              <Stat label="corners" value={String(route.corners.length)} />
            </Row>
            <Row gap={spacing.md}>
              <Stat
                label="hairpins"
                value={String(stats?.hairpinCount ?? 0)}
                {...((stats?.hairpinCount ?? 0) > 0 ? { tint: gradeColor("hairpin") } : {})}
              />
              <Stat
                label="climb"
                value={route.ascent !== undefined ? String(Math.round(route.ascent)) : "—"}
                {...(route.ascent !== undefined ? { unit: "m" } : {})}
              />
              <Stat
                label="hazards"
                value={String(features.length)}
                {...(features.length > 0 ? { tint: colors.warn } : {})}
              />
            </Row>
          </Card>

          <Card>
            <Row style={styles.between}>
              <Heading>Stage profile</Heading>
              <ModePill mode={mode} onPress={() => navigation.navigate("Settings")} />
            </Row>
            <StageProfile route={route} />
            <View style={styles.legend}>
              {(["straight", "flowing", "twisty", "technical"] as const).map((kind) => (
                <View key={kind} style={styles.legendItem}>
                  <View style={[styles.swatch, { backgroundColor: sectionColors[kind] }]} />
                  <Text style={styles.legendText}>{sectionNames[kind]}</Text>
                </View>
              ))}
            </View>
          </Card>

          <Card>
            <Heading>Corner mix</Heading>
            <View style={styles.bars}>
              {GRADE_ORDER.map((grade, index) => {
                const count = stats?.byGrade[grade] ?? 0;
                return (
                  <View key={grade} style={styles.barRow}>
                    <Text style={styles.barCode}>{index + 1}</Text>
                    <Text style={styles.barLabel}>{grade}</Text>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            width: `${(count / cornerTotal) * 100}%`,
                            backgroundColor: gradeColor(grade),
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.barCount}>{count}</Text>
                  </View>
                );
              })}
            </View>
            {cautions > 0 ? (
              <Row gap={spacing.sm}>
                <Icon name="alert" size={16} color={colors.bad} />
                <Small style={styles.flex}>
                  {`${cautions} corner${cautions === 1 ? "" : "s"} flagged caution: tight, after a fast approach or on a steep descent.`}
                </Small>
              </Row>
            ) : null}
          </Card>

          {sections.length > 1 ? (
            <Card>
              <Heading>How the road changes</Heading>
              <Small>Tap a stretch to find it on the map.</Small>
              <View>
                {sections.map((section) => {
                  const active = highlight?.id === section.id;
                  return (
                    <Pressable
                      key={section.id}
                      onPress={() => setHighlight(active ? null : section)}
                      style={({ pressed }) => [
                        styles.sectionRow,
                        active && { backgroundColor: alpha(sectionColors[section.kind], 0.22) },
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={[styles.sectionBar, { backgroundColor: sectionColors[section.kind] }]} />
                      <View style={styles.flex}>
                        <Text style={styles.sectionName}>{sectionNames[section.kind]}</Text>
                        <Text style={styles.sectionMeta}>
                          km {(section.startDist / 1000).toFixed(1)}–{(section.endDist / 1000).toFixed(1)}
                          {section.cornerCount > 0
                            ? ` · ${section.cornerCount} corner${section.cornerCount === 1 ? "" : "s"}`
                            : ""}
                          {section.hairpinCount > 0
                            ? ` · ${section.hairpinCount} hairpin${section.hairpinCount === 1 ? "" : "s"}`
                            : ""}
                        </Text>
                      </View>
                      <Text style={styles.sectionLength}>
                        {formatDistance(section.endDist - section.startDist)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>
          ) : null}

          {features.length > 0 ? (
            <Card>
              <Heading>Hazards on this road</Heading>
              <View>
                {features.slice(0, 5).map((feature) => (
                  <FeatureRow key={feature.id} feature={feature} />
                ))}
              </View>
              {features.length > 5 ? (
                <Small>{`…and ${features.length - 5} more in the roadbook.`}</Small>
              ) : null}
              <Small>
                Hazards come from the map and the GPX elevation. Anything nobody has mapped is not
                here - keep looking at the road.
              </Small>
            </Card>
          ) : null}

          <Card>
            <Row style={styles.between}>
              <Heading>Roadbook</Heading>
              <Label>{`${route.corners.length} notes`}</Label>
            </Row>
            {previewNotes.length === 0 ? (
              <Small>No corners found on this route: it is straight, or the GPX is too coarse.</Small>
            ) : (
              <View>
                {previewNotes.map((corner, index) => {
                  const next = route.corners[index + 1];
                  return (
                    <PacenoteRow
                      key={corner.id}
                      corner={corner}
                      gapAfter={next ? next.startDist - corner.endDist : null}
                      pacenotes={pacenotes}
                    />
                  );
                })}
              </View>
            )}
            {route.corners.length > 0 ? (
              <Button
                label="Open the full roadbook"
                icon="list"
                onPress={() => navigation.navigate("Roadbook", { routeId })}
              />
            ) : null}
          </Card>

          <Small style={styles.source}>
            {summary?.source === "osm-snapped"
              ? "Geometry snapped to OpenStreetMap roads, so corners come from surveyed road shape rather than the planner's line."
              : "Corners found from the GPX file itself. Import with a connection and road snapping on for sharper results."}
            {"\n\n"}
            Assistive only. The co-driver describes the road from map data, which can be wrong.
            Ride to what you can see.
          </Small>
        </View>
      </Screen>

      <Modal visible={renaming} transparent animationType="fade" onRequestClose={() => setRenaming(false)}>
        <Pressable style={styles.scrim} onPress={() => setRenaming(false)}>
          <Pressable style={styles.renameBox} onPress={() => undefined}>
            <Heading>Rename route</Heading>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              autoFocus
              selectTextOnFocus
              maxLength={80}
              placeholder="Route name"
              placeholderTextColor={colors.textFaint}
              returnKeyType="done"
              onSubmitEditing={() => void saveName()}
              style={styles.input}
            />
            <Row gap={spacing.sm}>
              <Button label="Cancel" kind="ghost" onPress={() => setRenaming(false)} style={styles.flex} />
              <Button label="Save" kind="primary" onPress={() => void saveName()} style={styles.flex} />
            </Row>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 0, paddingBottom: spacing.xl, gap: 0 },
  padded: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  mapPlaceholder: { height: 300 },
  between: { justifyContent: "space-between" },
  pressed: { opacity: 0.6 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, rowGap: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendText: { color: colors.textDim, fontSize: 12, fontWeight: "600" },
  swatch: { width: 12, height: 8, borderRadius: 2 },
  bars: { gap: 7 },
  barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  barCode: { width: 12, color: colors.textFaint, fontSize: 12, fontWeight: "800", ...tabular },
  barLabel: { width: 76, color: colors.textDim, fontSize: 13, fontWeight: "600" },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.surfaceTop, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4, minWidth: 0 },
  barCount: { width: 34, color: colors.text, fontSize: 13, fontWeight: "700", textAlign: "right", ...tabular },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  sectionBar: { width: 5, height: 34, borderRadius: 3 },
  sectionName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  sectionMeta: { color: colors.textDim, fontSize: 12, ...tabular },
  sectionLength: { color: colors.textDim, fontSize: 13, fontWeight: "700", ...tabular },
  source: { textAlign: "center", paddingHorizontal: spacing.md },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: spacing.xl },
  renameBox: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  input: {
    color: colors.text,
    ...type.body,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    minHeight: 50,
  },
});
