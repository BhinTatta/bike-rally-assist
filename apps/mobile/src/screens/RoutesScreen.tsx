/**
 * The route list: import a GPX, see what you have, delete what you do not.
 *
 * Importing works two ways - the document picker, and "open with" / share from
 * any other app, which is how a GPX actually arrives (Gmail attachment,
 * Telegram, a planner's export button).
 */

import { useCallback, useEffect, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as Linking from "expo-linking";
import { File } from "expo-file-system";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import {
  Body,
  Button,
  Card,
  Empty,
  GradeBadge,
  Row,
  Subtitle,
  Title,
} from "../ui/components";
import { colors, spacing } from "../ui/theme";
import { deleteRoute, importGpx, listRoutes, type RouteSummary } from "../storage/routes";
import { loadSettings, toEngineConfig } from "../storage/settings";
import type { RootStackParamList } from "../navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Routes">;

export function RoutesScreen({ navigation }: Props) {
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  // Road data is a bonus, never a blocker: the rider can always walk away from
  // it and keep the import.
  const [importAbort, setImportAbort] = useState<AbortController | null>(null);

  const refresh = useCallback(async () => {
    setRoutes(await listRoutes());
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => void refresh());
    void refresh();
    return unsubscribe;
  }, [navigation, refresh]);

  const importFromUri = useCallback(
    async (uri: string, name: string) => {
      setBusy(true);
      setProgress("Reading file…");
      const abort = new AbortController();
      setImportAbort(abort);
      try {
        const xml = await new File(uri).text();
        const settings = await loadSettings();
        const result = await importGpx(xml, name.replace(/\.gpx$/i, ""), {
          useOsm: settings.useOsmSnapping,
          engineConfig: toEngineConfig(settings),
          onProgress: setProgress,
          signal: abort.signal,
        });
        await refresh();
        if (result.osmNote) {
          Alert.alert(
            "Imported from the GPX as-is",
            `Road data was not used — ${result.osmNote}.\n\nCorners came from the file itself. That works fine; it is just less precise if the route was drawn by hand. Re-import with a connection to improve it.`,
          );
        }
        navigation.navigate("RoutePreview", { routeId: result.summary.id });
      } catch (error) {
        Alert.alert("Could not import that file", (error as Error).message);
      } finally {
        setBusy(false);
        setProgress(null);
        setImportAbort(null);
      }
    },
    [navigation, refresh],
  );

  /** Files opened from other apps ("open with", share sheet). */
  useEffect(() => {
    const handle = (url: string | null): void => {
      if (!url) return;
      if (!/\.gpx($|\?)/i.test(url) && !url.startsWith("content://")) return;
      const name = decodeURIComponent(url.split("/").pop() ?? "Shared route");
      void importFromUri(url, name);
    };
    void Linking.getInitialURL().then(handle);
    const subscription = Linking.addEventListener("url", (event) => handle(event.url));
    return () => subscription.remove();
  }, [importFromUri]);

  const pickFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      // Android file managers label GPX inconsistently, so accept anything and
      // let the parser decide.
      type: ["application/gpx+xml", "application/xml", "text/xml", "*/*"],
      copyToCacheDirectory: true,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    await importFromUri(asset.uri, asset.name);
  }, [importFromUri]);

  const confirmDelete = useCallback(
    (route: RouteSummary) => {
      Alert.alert("Delete route?", `"${route.name}" will be removed from this phone.`, [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteRoute(route.id).then(refresh);
          },
        },
      ]);
    },
    [refresh],
  );

  return (
    <SafeAreaView style={styles.screen} edges={["left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={() => void refresh()} tintColor={colors.textDim} />
        }
      >
        <Row>
          <Button label="Import GPX" kind="primary" onPress={() => void pickFile()} busy={busy} style={styles.grow} />
          <Button label="Rides" onPress={() => navigation.navigate("RideLogs")} />
          <Button label="Settings" onPress={() => navigation.navigate("Settings")} />
        </Row>
        {progress ? (
          <Card>
            <Subtitle>{progress}</Subtitle>
            {importAbort ? (
              <Button
                label="Skip road data"
                kind="ghost"
                onPress={() => importAbort.abort()}
              />
            ) : null}
          </Card>
        ) : null}

        {routes.length === 0 && !busy ? (
          <Empty
            title="No routes yet"
            body={
              "Import a GPX from a route planner, or share one to this app from Gmail, Telegram or your file manager."
            }
          />
        ) : null}

        {routes.map((route) => (
          <Card key={route.id} onPress={() => navigation.navigate("RoutePreview", { routeId: route.id })}>
            <Row>
              <View style={styles.grow}>
                <Title>{route.name}</Title>
                <Subtitle>
                  {(route.lengthMeters / 1000).toFixed(1)} km ·{" "}
                  {route.stats.cornerCount} corners ·{" "}
                  {route.stats.cornersPerKm.toFixed(1)}/km
                  {route.source === "osm-snapped" ? " · OSM" : ""}
                </Subtitle>
              </View>
              <Button label="Delete" kind="ghost" onPress={() => confirmDelete(route)} />
            </Row>
            <Row style={styles.badges}>
              {Object.entries(route.stats.byGrade)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([grade, count]) => (
                  <GradeBadge key={grade} grade={grade} count={count} />
                ))}
            </Row>
            {route.roadNames.length > 0 ? (
              <Text style={styles.roads} numberOfLines={1}>
                {route.roadNames.join(" · ")}
              </Text>
            ) : null}
          </Card>
        ))}

        {routes.length > 0 ? (
          <Body dim>Pull down to refresh. Tap a route to preview it and start a ride.</Body>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  grow: { flex: 1 },
  badges: { flexWrap: "wrap", marginTop: spacing.xs },
  roads: { color: colors.textDim, fontSize: 12, marginTop: 2 },
});
