/**
 * The roadbook: every corner and hazard on the route, in order, as a
 * co-driver's notes would list them.
 */

import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AnalysedRoute, Corner, RoadFeature } from "@rally/engine";

import { Header, Screen, Segmented, Small } from "../ui/components";
import { FeatureRow, PacenoteRow } from "../ui/Pacenote";
import { colors, spacing } from "../ui/theme";
import { loadRoute } from "../storage/routes";
import { loadSettings, runtimeFor } from "../storage/settings";
import type { RootStackParamList } from "../navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Roadbook">;

type Filter = "all" | "tight" | "hazards";

type Entry =
  | { key: string; dist: number; corner: Corner; gapAfter: number | null }
  | { key: string; dist: number; feature: RoadFeature };

export function RoadbookScreen({ navigation, route: navRoute }: Props) {
  const { routeId } = navRoute.params;
  const [route, setRoute] = useState<AnalysedRoute | null>(null);
  const [pacenotes, setPacenotes] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    void loadRoute(routeId).then(setRoute);
    void loadSettings().then((settings) => setPacenotes(runtimeFor(settings).rallyMode === true));
  }, [routeId]);

  const entries = useMemo<Entry[]>(() => {
    if (!route) return [];
    const corners: Entry[] = route.corners.map((corner, index) => {
      const next = route.corners[index + 1];
      return {
        key: `c${corner.id}`,
        dist: corner.startDist,
        corner,
        gapAfter: next ? next.startDist - corner.endDist : null,
      };
    });
    const features: Entry[] = (route.features ?? []).map((feature) => ({
      key: `f${feature.id}`,
      dist: feature.dist,
      feature,
    }));
    const wanted =
      filter === "hazards"
        ? features
        : filter === "tight"
          ? corners.filter((entry) => "corner" in entry && entry.corner.rallyNumber <= 3)
          : [...corners, ...features];
    return wanted.sort((a, b) => a.dist - b.dist);
  }, [route, filter]);

  return (
    <Screen scroll={false}>
      <Header
        title="Roadbook"
        {...(route?.name ? { subtitle: route.name } : {})}
        onBack={() => navigation.goBack()}
      />
      <View style={styles.filters}>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Everything" },
            { value: "tight", label: "Sharp & tighter" },
            { value: "hazards", label: "Hazards" },
          ]}
        />
      </View>
      {!route ? (
        <ActivityIndicator color={colors.accent} style={styles.loading} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(entry) => entry.key}
          contentContainerStyle={styles.list}
          initialNumToRender={14}
          windowSize={9}
          ItemSeparatorComponent={Separator}
          ListEmptyComponent={
            <Small style={styles.empty}>
              {filter === "hazards"
                ? "No hazards found on this route. That means none were mapped, not that there are none."
                : "Nothing to list."}
            </Small>
          }
          renderItem={({ item }) =>
            "corner" in item ? (
              <PacenoteRow corner={item.corner} gapAfter={item.gapAfter} pacenotes={pacenotes} />
            ) : (
              <FeatureRow feature={item.feature} />
            )
          }
        />
      )}
    </Screen>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  filters: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  loading: { marginTop: spacing.xxl },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 46 },
  empty: { textAlign: "center", paddingVertical: spacing.xxl },
});
