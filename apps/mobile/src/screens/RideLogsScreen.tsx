/**
 * Recorded rides.
 *
 * Each ride is a GPX plus a JSON log of every call. Share them to a computer
 * and replay them through the CLI:
 *
 *   pnpm rally simulate route.gpx --replay ride.gpx
 *
 * which is how the engine's thresholds get tuned against real riding rather
 * than against synthetic geometry.
 */

import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet } from "react-native";
import * as Sharing from "expo-sharing";

import { Body, Button, Card, Empty, Row, Screen, Subtitle, Title } from "../ui/components";
import { spacing } from "../ui/theme";
import {
  deleteRideLog,
  listRideLogs,
  rideGpxFile,
  rideJsonFile,
  type RideLog,
} from "../ride/rideLogger";

export function RideLogsScreen() {
  const [logs, setLogs] = useState<RideLog[]>([]);

  const refresh = useCallback(() => setLogs(listRideLogs()), []);
  useEffect(refresh, [refresh]);

  const share = useCallback(async (log: RideLog, what: "gpx" | "json") => {
    const file = what === "gpx" ? rideGpxFile(log.id) : rideJsonFile(log.id);
    if (!file.exists) {
      Alert.alert("Nothing to share", "That file is missing.");
      return;
    }
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert("Sharing unavailable", `The file is at:\n${file.uri}`);
      return;
    }
    await Sharing.shareAsync(file.uri, {
      mimeType: what === "gpx" ? "application/gpx+xml" : "application/json",
      dialogTitle: `${log.routeName} (${what.toUpperCase()})`,
    });
  }, []);

  const confirmDelete = useCallback(
    (log: RideLog) => {
      Alert.alert("Delete ride?", "The GPX and the call log will be removed.", [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteRideLog(log.id);
            refresh();
          },
        },
      ]);
    },
    [refresh],
  );

  return (
    <Screen>
      {logs.length === 0 ? (
        <Empty
          title="No rides recorded yet"
          body="Finish a ride with recording switched on and it will appear here, ready to export."
        />
      ) : null}

      {logs.map((log) => {
        const minutes = log.endedAt
          ? Math.round((log.endedAt - log.startedAt) / 60000)
          : null;
        const cornerCalls = log.calls.filter((c) => c.kind === "corner").length;
        return (
          <Card key={log.id}>
            <Title>{log.routeName}</Title>
            <Subtitle>
              {new Date(log.startedAt).toLocaleString()}
              {minutes !== null ? ` · ${minutes} min` : " · unfinished"}
            </Subtitle>
            <Body dim>
              {`${(log.distanceMeters / 1000).toFixed(1)} km · ${log.fixCount} fixes · ${cornerCalls} corner calls`}
            </Body>
            <Row style={styles.actions}>
              <Button label="Share GPX" onPress={() => void share(log, "gpx")} />
              <Button label="Share calls" onPress={() => void share(log, "json")} />
              <Button label="Delete" kind="ghost" onPress={() => confirmDelete(log)} />
            </Row>
          </Card>
        );
      })}

      {logs.length > 0 ? (
        <Body dim>
          Replay a ride on a computer with: rally simulate route.gpx --replay ride.gpx
        </Body>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { marginTop: spacing.sm, flexWrap: "wrap" },
});
