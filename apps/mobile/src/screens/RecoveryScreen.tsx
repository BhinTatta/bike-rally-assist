/**
 * Shown instead of the ride screen when the previous run died with a ride open.
 *
 * Without this the app is unusable: it reopens into the ride, crashes, and
 * does it again on every launch. Here the rider gets the reason, a way to send
 * it on, and a way out.
 */

import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";

import { Body, Button, Card, Title } from "../ui/components";
import { colors, radius, spacing } from "../ui/theme";
import type { CrashRecord } from "../diagnostics";

export function RecoveryScreen({
  crash,
  routeName,
  onDismiss,
}: {
  crash: CrashRecord | null;
  routeName: string;
  onDismiss: () => void;
}) {
  const share = async (): Promise<void> => {
    const file = new File(Paths.cache, "rally-crash.txt");
    file.create({ overwrite: true });
    file.write(
      crash
        ? `${new Date(crash.time).toISOString()}\nphase: ${crash.phase}\n${crash.name}: ${crash.message}\n\n${crash.stack ?? ""}`
        : `The app closed during a ride on "${routeName}" without leaving a JavaScript error, which usually means a native crash.`,
    );
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType: "text/plain" });
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Title>The last ride ended badly</Title>
        <Card>
          <Body>
            {`The app closed while you were riding "${routeName}". It has not reopened the ride screen, so you are not stuck in a loop.`}
          </Body>
        </Card>

        {crash ? (
          <ScrollView style={styles.box}>
            <Text style={styles.mono}>
              {crash.name}: {crash.message}
            </Text>
            <Text style={styles.monoDim}>during: {crash.phase}</Text>
            {crash.stack ? <Text style={styles.monoDim}>{crash.stack}</Text> : null}
          </ScrollView>
        ) : (
          <Card>
            <Body dim>
              No JavaScript error was recorded, which usually means the crash came from the
              native side - out of memory, or a map or audio component. Sending the report
              still helps: it says which route and when.
            </Body>
          </Card>
        )}

        <View style={styles.spacer} />
        <Button label="Send the report" onPress={() => void share()} />
        <Button label="Continue" kind="primary" big onPress={onDismiss} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, padding: spacing.md, gap: spacing.md },
  box: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm },
  mono: { color: colors.bad, fontFamily: "monospace", fontSize: 12 },
  monoDim: { color: colors.textDim, fontFamily: "monospace", fontSize: 11, marginTop: spacing.sm },
  spacer: { flex: 1 },
});
