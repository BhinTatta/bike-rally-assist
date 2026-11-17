/**
 * Past rides.
 */

import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { Card, Empty, Header, IconButton, Screen } from "../ui/components";
import { confirm } from "../ui/dialog";
import { formatClock, formatDate, km } from "../ui/format";
import { Icon } from "../ui/icons";
import { MODE_ICONS } from "../ui/ModePicker";
import { colors, modeColors, radius, spacing, tabular } from "../ui/theme";
import { deleteRideLog, listRideLogs, type RideLog } from "../ride/rideLogger";
import type { RootStackParamList } from "../navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Rides">;

export function RidesScreen({ navigation }: Props) {
  const [rides, setRides] = useState<RideLog[] | null>(null);

  const refresh = useCallback(() => setRides(listRideLogs()), []);
  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", refresh);
    refresh();
    return unsubscribe;
  }, [navigation, refresh]);

  const remove = useCallback(
    async (ride: RideLog) => {
      const ok = await confirm({
        title: "Delete this ride?",
        body: `${ride.routeName}, ${formatDate(ride.startedAt)}. The track and call log will be removed.`,
        confirmLabel: "Delete ride",
        cancelLabel: "Keep it",
        destructive: true,
      });
      if (!ok) return;
      deleteRideLog(ride.id);
      refresh();
    },
    [refresh],
  );

  return (
    <Screen>
      <Header title="Past rides" onBack={() => navigation.goBack()} />
      {rides !== null && rides.length === 0 ? (
        <Card>
          <Empty
            icon="history"
            title="No rides yet"
            body="Every ride is saved here with its track and the calls that were made."
          />
        </Card>
      ) : null}
      {(rides ?? []).map((ride) => {
        const color = ride.mode ? modeColors[ride.mode] : colors.textDim;
        const corners = ride.stats?.cornersCalled ?? ride.calls.filter((c) => c.kind === "corner").length;
        const seconds =
          ride.stats?.movingSeconds ?? (ride.endedAt ? (ride.endedAt - ride.startedAt) / 1000 : 0);
        return (
          <Card key={ride.id} onPress={() => navigation.navigate("Summary", { rideId: ride.id })} padded={false}>
            <View style={styles.row}>
              <View style={[styles.icon, { backgroundColor: color }]}>
                <Icon name={ride.mode ? MODE_ICONS[ride.mode] : "flag"} size={20} color={colors.onAccent} />
              </View>
              <View style={styles.body}>
                <Text style={styles.name} numberOfLines={1}>
                  {ride.routeName}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {formatDate(ride.startedAt)}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {km(ride.distanceMeters)} km · {formatClock(seconds)} · {corners} corners
                </Text>
              </View>
              <IconButton icon="trash" label="Delete ride" color={colors.textDim} onPress={() => void remove(ride)} />
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  icon: { width: 42, height: 42, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, gap: 2, minWidth: 0 },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  meta: { color: colors.textDim, fontSize: 13, ...tabular },
});
