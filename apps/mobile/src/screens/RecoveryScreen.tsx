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
import type { Breadcrumb, CrashRecord } from "../diagnostics";

/** Plain-English names for the steps the breadcrumb trail records. */
const STEP_NAMES: Record<string, string> = {
  "start:pressed": "starting the ride",
  "start:permissions": "checking location permissions",
  "start:engine-begin": "loading the route",
  "ride:load-route": "loading the route",
  "ride:audio-start": "setting up audio",
  "audio:set-mode": "claiming the audio session",
  "audio:create-player": "creating the headset keep-alive player",
  "audio:play": "starting the headset keep-alive stream",
  "audio:playing": "audio running",
  "audio:ready": "audio ready",
  "audio:skipped": "audio deliberately skipped",
  "ride:watchdog": "starting the GPS watchdog",
  "ride:ready": "ride engine ready",
  "start:location-service": "starting the location service",
  "location:start-updates": "starting the location service",
  "start:navigate": "opening the ride screen",
  "ride:screen-mounted": "ride screen opened",
  "ride:survived-2s": "running, 2 seconds in",
  "ride:survived-6s": "running, 6 seconds in",
  "task:batch": "handling a GPS update",
  "location:foreground-fallback": "falling back to foreground location",
  "selftest:audio": "self-test: audio",
  "selftest:location-foreground": "self-test: foreground location",
  "selftest:location": "self-test: location service",
  "selftest:done": "self-test finished",
};

export function RecoveryScreen({
  crash,
  breadcrumb,
  survivedMs,
  routeName,
  onDismiss,
}: {
  crash: CrashRecord | null;
  breadcrumb: Breadcrumb | null;
  /** Time between the last breadcrumb and the last proof of life. */
  survivedMs: number | null;
  routeName: string;
  onDismiss: () => void;
}) {
  const share = async (): Promise<void> => {
    const file = new File(Paths.cache, "rally-crash.txt");
    file.create({ overwrite: true });
    const trail =
      (breadcrumb
        ? `last step: ${breadcrumb.step} (${STEP_NAMES[breadcrumb.step] ?? "unknown step"})\nat: ${new Date(breadcrumb.at).toISOString()}\n`
        : "last step: not recorded\n") +
      (survivedMs === null
        ? "survived: unknown\n"
        : `survived: ${(survivedMs / 1000).toFixed(1)} s after that step\n`);
    file.write(
      crash
        ? `${new Date(crash.time).toISOString()}\nroute: ${routeName}\n${trail}phase: ${crash.phase}\n${crash.name}: ${crash.message}\n\n${crash.stack ?? ""}`
        : `The app closed during a ride on "${routeName}" without leaving a JavaScript error, which means a native crash.\n${trail}`,
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

        <Card>
          <Body>Last thing it did before closing:</Body>
          <Text style={styles.step}>
            {breadcrumb
              ? (STEP_NAMES[breadcrumb.step] ?? breadcrumb.step)
              : "not recorded"}
          </Text>
          {breadcrumb ? <Text style={styles.stepId}>{breadcrumb.step}</Text> : null}
          {survivedMs !== null ? (
            <Body dim>{`It kept running for ${(survivedMs / 1000).toFixed(1)} s after that.`}</Body>
          ) : null}
          {breadcrumb?.step.startsWith("audio:") ? (
            <Body dim>
              That is the audio stack, so the next ride will start without ducking and
              without the headset keep-alive. The calls themselves still work.
            </Body>
          ) : null}
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
  step: { color: colors.accent, fontSize: 20, fontWeight: "700" },
  stepId: { color: colors.textDim, fontFamily: "monospace", fontSize: 12 },
  mono: { color: colors.bad, fontFamily: "monospace", fontSize: 12 },
  monoDim: { color: colors.textDim, fontFamily: "monospace", fontSize: 11, marginTop: spacing.sm },
  spacer: { flex: 1 },
});
