/**
 * What this route is going to be like, and the button that starts it.
 *
 * The map is the headline, but the numbers underneath are what decides whether
 * you ride it before or after lunch: how many hairpins, where the twistiest
 * kilometre is.
 */

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useIsFocused } from "@react-navigation/native";
import type { AnalysedRoute } from "@rally/engine";

import { Body, Button, Card, GradeBadge, Row, SectionHeader, Stat, Subtitle, Title, Screen } from "../ui/components";
import { RouteMap } from "../ui/RouteMap";
import { colors, spacing } from "../ui/theme";
import { listRoutes, loadRoute, type RouteSummary } from "../storage/routes";
import { checkPermissions, requestBackground, requestForeground } from "../ride/permissions";
import { breadcrumb } from "../diagnostics";
import { rideEngine } from "../ride/rideEngine";
import { startLocationUpdates } from "../ride/locationTask";
import type { RootStackParamList } from "../navigation";

type Props = NativeStackScreenProps<RootStackParamList, "RoutePreview">;

export function RoutePreviewScreen({ navigation, route: navRoute }: Props) {
  const { routeId } = navRoute.params;
  const [route, setRoute] = useState<AnalysedRoute | null>(null);
  const [summary, setSummary] = useState<RouteSummary | null>(null);
  const [starting, setStarting] = useState(false);
  // A native-stack screen stays mounted underneath the one pushed on top of
  // it. A MapLibre surface holding a long route is far too expensive to leave
  // running behind the ride screen, so it is torn down when not on screen.
  //
  // `mapVisible` tears it down a beat *before* the ride starts rather than
  // during the navigation transition: unmounting a map surface while the
  // screen animates and a foreground service starts is a well-known way to
  // crash natively, and none of it is worth racing.
  const isFocused = useIsFocused();
  const [mapVisible, setMapVisible] = useState(true);

  useEffect(() => {
    void (async () => {
      const [loaded, index] = await Promise.all([loadRoute(routeId), listRoutes()]);
      setRoute(loaded);
      setSummary(index.find((r) => r.id === routeId) ?? null);
      if (loaded?.name) navigation.setOptions({ title: loaded.name });
    })();
  }, [routeId, navigation]);

  const startRide = useCallback(async () => {
    setStarting(true);
    try {
      breadcrumb("start:pressed");
      setMapVisible(false);
      await new Promise((resolve) => setTimeout(resolve, 350));
      // Permissions, in the order Android insists on, each with a reason.
      const state = await checkPermissions();
      breadcrumb("start:permissions");
      if (!state.foreground && !(await requestForeground())) {
        Alert.alert(
          "Location is required",
          "Without your location the co-driver has no idea which corner is next.",
        );
        return;
      }
      if (!state.background) {
        const granted = await requestBackground();
        if (!granted) {
          const proceed = await new Promise<boolean>((resolve) => {
            Alert.alert(
              "Calls will stop when the screen locks",
              'Android needs "Allow all the time" to keep calling corners with the phone in your pocket. You can still ride with the screen on.',
              [
                { text: "Go back", style: "cancel", onPress: () => resolve(false) },
                { text: "Ride anyway", onPress: () => resolve(true) },
              ],
            );
          });
          if (!proceed) return;
        }
      }
      if (!state.servicesEnabled) {
        Alert.alert("Turn on GPS", "Location services are switched off on this phone.");
        return;
      }

      // Hand over the route we already have rather than reading and parsing
      // the whole thing a second time - it is 3.7 MB for a 127 km import.
      breadcrumb("start:engine-begin");
      const begun = await rideEngine.begin(routeId, route ?? undefined);
      if (!begun.ok) {
        Alert.alert("Could not start the ride", begun.error);
        return;
      }
      breadcrumb("start:location-service");
      await startLocationUpdates(route?.name ?? "your route");
      breadcrumb("start:navigate");
      navigation.navigate("Ride", { routeId });
    } catch (error) {
      Alert.alert("Could not start the ride", (error as Error).message);
    } finally {
      setStarting(false);
      setMapVisible(true);
    }
  }, [navigation, routeId, route?.name]);

  if (!route) {
    return (
      <Screen scroll={false} style={styles.centre}>
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );
  }

  const stats = summary?.stats;
  const twistiest = stats?.twistiestSection;

  return (
    <Screen>
      {isFocused && mapVisible ? (
        <RouteMap route={route} style={styles.map} />
      ) : (
        <View style={styles.map} />
      )}

      <Card>
        <Row>
          <Stat label="distance" value={`${(route.length / 1000).toFixed(1)} km`} />
          <Stat label="corners" value={String(route.corners.length)} />
          <Stat
            label="hairpins"
            value={String(stats?.hairpinCount ?? 0)}
            tint={(stats?.hairpinCount ?? 0) > 0 ? colors.warn : undefined}
          />
          <Stat label="per km" value={(stats?.cornersPerKm ?? 0).toFixed(1)} />
        </Row>
      </Card>

      <Card>
        <SectionHeader>What you are riding into</SectionHeader>
        <Row style={styles.badges}>
          {Object.entries(stats?.byGrade ?? {}).map(([grade, count]) => (
            <GradeBadge key={grade} grade={grade} count={count} />
          ))}
        </Row>
        {twistiest ? (
          <Body dim>
            {`Twistiest kilometre: ${(twistiest.startDist / 1000).toFixed(1)}–${(
              twistiest.endDist / 1000
            ).toFixed(1)} km, ${twistiest.cornerCount} corners and ${twistiest.headingChange.toFixed(
              0,
            )}° of turning.`}
          </Body>
        ) : null}
        {summary?.source === "osm-snapped" ? (
          <Subtitle>
            {`Snapped to OpenStreetMap road geometry${
              summary.roadNames.length > 0 ? ` (${summary.roadNames.join(", ")})` : ""
            }.`}
          </Subtitle>
        ) : (
          <Subtitle>Corners found from the GPX file itself.</Subtitle>
        )}
      </Card>

      <Button label="Start ride" kind="primary" big busy={starting} onPress={() => void startRide()} />
      <Body dim>
        Assistive only. The co-driver describes the road from map data, which can be wrong. Ride to
        what you can see.
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  map: { height: 300 },
  centre: { alignItems: "center", justifyContent: "center" },
  badges: { flexWrap: "wrap" },
});
