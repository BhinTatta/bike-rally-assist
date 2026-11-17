/**
 * Settings.
 *
 * Grouped by what the rider is trying to change - how it talks, what it
 * mentions, how it sounds, how reliable it is on this phone - and every
 * control says what it does in a sentence, because "lead adjust: +1" means
 * nothing on its own.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { rideMode } from "@rally/engine";

import {
  Button,
  Card,
  Divider,
  Header,
  Heading,
  Label,
  ListItem,
  Screen,
  Segmented,
  Small,
  Toggle,
} from "../ui/components";
import { confirm, inform, notify } from "../ui/dialog";
import { Icon } from "../ui/icons";
import { ModePicker } from "../ui/ModePicker";
import { shareFile } from "../ui/share";
import { colors, modeColors, radius, spacing } from "../ui/theme";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  runtimeFor,
  saveSettings,
  type Phrasing,
  type Settings,
  type Verbosity,
} from "../storage/settings";
import { writeTemp } from "../storage/files";
import { rideEngine } from "../ride/rideEngine";
import { listEnglishVoices, type InstalledVoice } from "../ride/speech";
import {
  checkPermissions,
  openBatteryOptimisationSettings,
  requestBackground,
  type PermissionState,
} from "../ride/permissions";
import { clearLastCrash, readBreadcrumb, readLastCrash, type CrashRecord } from "../diagnostics";
import { runSelfTest } from "../ride/selfTest";
import type { RootStackParamList } from "../navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Settings">;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Label>{title}</Label>
      <Card>{children}</Card>
    </View>
  );
}

function Field({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Heading>{title}</Heading>
      {hint ? <Small>{hint}</Small> : null}
      {children}
    </View>
  );
}

export function SettingsScreen({ navigation }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [crash, setCrash] = useState<CrashRecord | null>(null);
  const [testing, setTesting] = useState(false);
  const [testProgress, setTestProgress] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<PermissionState | null>(null);
  const [voices, setVoices] = useState<InstalledVoice[]>([]);
  const [showVoices, setShowVoices] = useState(false);
  const native = Platform.OS !== "web";

  useEffect(() => {
    void loadSettings().then(setSettings);
    if (native) void checkPermissions().then(setPermissions).catch(() => undefined);
    void listEnglishVoices().then(setVoices);
    setCrash(readLastCrash());
  }, [native]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      void saveSettings(next);
      // A ride may be in progress; apply immediately rather than next time.
      if (rideEngine.isActive) void rideEngine.applySettings(next);
      return next;
    });
  }, []);

  const selfTest = useCallback(() => {
    setTesting(true);
    void runSelfTest(setTestProgress)
      .then((result) =>
        inform(
          "Self-test finished",
          `${result.audioOk ? "Audio OK" : "Audio FAILED"} · ${
            result.locationOk ? "Location OK" : "Location FAILED"
          }\n\n${result.notes.join("\n\n")}`,
        ),
      )
      .catch((error: Error) => inform("Self-test failed", error.message))
      .finally(() => {
        setTesting(false);
        setTestProgress(null);
      });
  }, []);

  const shareDiagnostics = useCallback(() => {
    const trail = readBreadcrumb();
    const text = [
      `Rally Co-Driver diagnostics, ${new Date().toISOString()}`,
      `platform: ${Platform.OS} ${String(Platform.Version)}`,
      `settings: ${JSON.stringify(settings)}`,
      `permissions: ${JSON.stringify(permissions)}`,
      trail ? `last step: ${trail.step} at ${new Date(trail.at).toISOString()}` : "last step: none",
      crash
        ? `last error (${new Date(crash.time).toISOString()}, during ${crash.phase}): ${crash.name}: ${crash.message}\n${crash.stack ?? ""}`
        : "last error: none",
    ].join("\n");
    try {
      void shareFile(writeTemp("rally-diagnostics.txt", text), "text/plain");
    } catch {
      notify("Could not write the report", "bad");
    }
  }, [crash, permissions, settings]);

  if (!settings) {
    return (
      <Screen scroll={false}>
        <Header title="Settings" onBack={() => navigation.goBack()} />
      </Screen>
    );
  }

  const mode = rideMode(settings.mode);
  const tint = modeColors[settings.mode];
  const runtime = runtimeFor(settings);
  const voiceName =
    voices.find((voice) => voice.id === settings.voiceId)?.name ?? "System default";

  return (
    <Screen style={styles.content}>
      <Header title="Settings" onBack={() => navigation.goBack()} />
      <View style={styles.padded}>
        <Group title="Ride mode">
          <ModePicker value={settings.mode} onChange={(next) => void rideEngine.setMode(next).then(() => update({ mode: next }))} />
        </Group>

        <Group title={`Fine-tune ${mode.name}`}>
          <Field
            title="Call timing"
            hint={`${mode.name} calls about ${runtime.leadSeconds?.toFixed(1)} s before a corner, and earlier still when you need room to brake.`}
          >
            <Segmented<number>
              tint={tint}
              value={settings.leadAdjustSeconds}
              onChange={(leadAdjustSeconds) => update({ leadAdjustSeconds })}
              options={[
                { value: -1, label: "Later" },
                { value: 0, label: "Standard" },
                { value: 1.5, label: "Earlier" },
                { value: 3, label: "Earliest" },
              ]}
            />
          </Field>
          <Divider />
          <Field title="Which corners" hint="On a road you know, only the tight ones are worth hearing.">
            <Segmented<Verbosity>
              tint={tint}
              value={settings.verbosity}
              onChange={(verbosity) => update({ verbosity })}
              options={[
                { value: "mode", label: "By mode" },
                { value: "all", label: "All" },
                { value: "sharp-and-above", label: "Sharp +" },
                { value: "hairpins-only", label: "Hairpins" },
              ]}
            />
          </Field>
          <Divider />
          <Field
            title="Wording"
            hint={
              runtime.rallyMode
                ? 'Pacenotes: "Right 3, 80". 1 is a hairpin, 6 barely a bend.'
                : 'Plain words: "Sharp right, 80 metres".'
            }
          >
            <Segmented<Phrasing>
              tint={tint}
              value={settings.phrasing}
              onChange={(phrasing) => update({ phrasing })}
              options={[
                { value: "mode", label: "By mode" },
                { value: "plain", label: "Plain" },
                { value: "pacenotes", label: "Pacenotes" },
              ]}
            />
          </Field>
        </Group>

        <Group title="What it mentions">
          <Toggle
            tint={tint}
            label="Road hazards"
            description="Crests, steep descents, surface changes, speed breakers, railway crossings - where the map or the GPX knows about them."
            value={settings.announceHazards}
            onChange={(announceHazards) => update({ announceHazards })}
          />
          <Divider />
          <Toggle
            tint={tint}
            label="Caution corners"
            description='Says "caution" before a tight corner at the end of a fast stretch or on a steep descent.'
            value={settings.cautionCalls}
            onChange={(cautionCalls) => update({ cautionCalls })}
          />
          <Divider />
          <Toggle
            tint={tint}
            label="Too-fast warning"
            description={`Says "${mode.runtime.overspeedWord ?? "slow"}" when there is no longer room to slow comfortably for the corner.`}
            value={settings.speedWarnings}
            onChange={(speedWarnings) => update({ speedWarnings })}
          />
          <Divider />
          <Toggle
            tint={tint}
            label="Road character"
            description='"Twisty section, 3 kilometres" when the road changes. Cruise and Sport only.'
            value={settings.announceSections}
            onChange={(announceSections) => update({ announceSections })}
          />
        </Group>

        <Group title="Voice">
          <ListItem
            icon="volume"
            label="Voice"
            value={voiceName}
            onPress={() => setShowVoices((open) => !open)}
          />
          {showVoices ? (
            <View style={styles.voices}>
              <VoiceOption
                name="System default"
                detail="Whatever the phone normally speaks with"
                selected={settings.voiceId === null}
                onPress={() => update({ voiceId: null })}
              />
              {voices.slice(0, 24).map((voice) => (
                <VoiceOption
                  key={voice.id}
                  name={voice.name}
                  detail={voice.language}
                  selected={settings.voiceId === voice.id}
                  onPress={() => update({ voiceId: voice.id })}
                />
              ))}
              {voices.length === 0 ? (
                <Small>No other English voices are installed. Add some in Android's text-to-speech settings.</Small>
              ) : null}
            </View>
          ) : null}
          <Divider />
          <Field title="Speaking rate">
            <Segmented<number>
              tint={tint}
              value={settings.speechRate}
              onChange={(speechRate) => update({ speechRate })}
              options={[
                { value: 0.9, label: "Slow" },
                { value: 1, label: "Normal" },
                { value: 1.15, label: "Quick" },
                { value: 1.3, label: "Rally" },
              ]}
            />
          </Field>
          <Divider />
          <Field
            title="Timing correction"
            hint="Raise it if calls feel late - some Bluetooth headsets buffer deeply."
          >
            <Segmented<number>
              tint={tint}
              value={settings.lagSeconds}
              onChange={(lagSeconds) => update({ lagSeconds })}
              options={[
                { value: 0.5, label: "0.5 s" },
                { value: 1, label: "1 s" },
                { value: 1.5, label: "1.5 s" },
                { value: 2, label: "2 s" },
              ]}
            />
          </Field>
          <Button label="Test the voice" icon="play" onPress={() => void rideEngine.testVoice(settings)} />
          <Small>Loudness follows the phone's media volume: press the volume keys while it speaks.</Small>
        </Group>

        <Group title="Ride screen">
          <Toggle
            tint={tint}
            label="Show estimated corner speed"
            description="A rough figure from the corner's radius on the map. It knows nothing about grip, camber or traffic."
            value={settings.showCornerSpeed}
            onChange={(showCornerSpeed) => update({ showCornerSpeed })}
          />
          <Divider />
          <Toggle
            tint={tint}
            label="Vibrate on each call"
            description="Proof the app is alive even if the headset has dropped out."
            value={settings.haptics}
            onChange={(haptics) => update({ haptics })}
          />
        </Group>

        <Group title="Routes and rides">
          <Toggle
            tint={tint}
            label="Snap imports to road maps"
            description="Matches an imported GPX onto surveyed OpenStreetMap roads: sharper corners, plus surface and speed-breaker data. Needs a connection at import."
            value={settings.useOsmSnapping}
            onChange={(useOsmSnapping) => update({ useOsmSnapping })}
          />
          <Divider />
          <Toggle
            tint={tint}
            label="Record rides"
            description="Saves each ride's track and every call made."
            value={settings.logRides}
            onChange={(logRides) => update({ logRides })}
          />
        </Group>

        <Group title="Reliability on this phone">
          <Field
            title="Riding with the screen off"
            hint={
              settings.locationMode === "screen-on"
                ? "Screen-on mode: no background service at all. The most dependable way to ride with the phone on a mount; calls stop if the phone locks."
                : permissions === null
                  ? "Uses Android's background location service when it is allowed."
                  : permissions.background
                    ? 'Location is set to "Allow all the time", so rides keep calling corners with the phone locked or in a pocket.'
                    : 'Location is "While using the app": rides work with the screen on. Allow all the time to ride with it locked.'
            }
          >
            <Segmented<Settings["locationMode"]>
              tint={tint}
              value={settings.locationMode}
              onChange={(locationMode) => update({ locationMode })}
              options={[
                { value: "auto", label: "Pocket if allowed" },
                { value: "screen-on", label: "Screen on only" },
              ]}
            />
            {native && permissions !== null && !permissions.background && settings.locationMode === "auto" ? (
              <Button
                label='Allow location "all the time"'
                onPress={() => {
                  void requestBackground().then(() => checkPermissions().then(setPermissions));
                }}
              />
            ) : null}
          </Field>
          <Divider />
          <Toggle
            tint={tint}
            label="Keep the headset awake"
            description="Holds a near-silent stream open during a ride, so Bluetooth headsets do not clip the first word of a call."
            value={settings.keepHeadsetAwake}
            onChange={(keepHeadsetAwake) => update({ keepHeadsetAwake })}
          />
          <Divider />
          <Toggle
            tint={tint}
            label="Keep audio alive in the background"
            description="Starts a second Android service so that stream survives the screen locking. Leave off unless you need it."
            value={settings.backgroundAudio}
            onChange={(backgroundAudio) => update({ backgroundAudio })}
          />
          {native ? (
            <>
              <Divider />
              <ListItem
                icon="battery"
                label="Battery optimisation"
                description="Xiaomi, Oppo, Vivo, Realme and OnePlus kill background apps hard. Exempt this app, and enable Autostart in the phone's security app."
                onPress={() => void openBatteryOptimisationSettings()}
              />
              <Divider />
              <ListItem
                icon="bug"
                label={testing ? (testProgress ?? "Running…") : "Run a self-test"}
                description="Does everything a ride start does - audio, headset stream, location - for twelve seconds, with no route needed."
                {...(testing ? {} : { onPress: selfTest })}
              />
            </>
          ) : null}
        </Group>

        <Group title="Diagnostics">
          {crash ? (
            <View style={styles.crash}>
              <Text style={styles.crashTitle}>{`${crash.name}: ${crash.message}`}</Text>
              <Small>{`${new Date(crash.time).toLocaleString()} · during ${crash.phase}`}</Small>
            </View>
          ) : (
            <Small>No errors recorded.</Small>
          )}
          <Button label="Share a diagnostics report" icon="share" onPress={shareDiagnostics} />
          {crash ? (
            <Button
              label="Clear the recorded error"
              kind="ghost"
              onPress={() => {
                clearLastCrash();
                setCrash(null);
              }}
            />
          ) : null}
          <Button
            label="Reset all settings"
            kind="ghost"
            onPress={() => {
              void confirm({
                title: "Reset settings?",
                body: "Everything on this screen goes back to its default. Routes and rides are kept.",
                confirmLabel: "Reset",
                destructive: true,
              }).then((yes) => {
                if (yes) update({ ...DEFAULT_SETTINGS, disclaimerAccepted: settings.disclaimerAccepted });
              });
            }}
          />
        </Group>

        <Small style={styles.footnote}>
          Rally Co-Driver is assistive only. It describes the road from map data, which is sometimes
          wrong, using GPS, which is sometimes late. Ride to what you can see.
        </Small>
      </View>
    </Screen>
  );
}

function VoiceOption({
  name,
  detail,
  selected,
  onPress,
}: {
  name: string;
  detail: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.voice, selected && styles.voiceSelected, pressed && styles.pressed]}
    >
      <View style={styles.flex}>
        <Text style={styles.voiceName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.voiceDetail}>{detail}</Text>
      </View>
      {selected ? <Icon name="check" size={18} color={colors.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 0, gap: 0, paddingBottom: spacing.xxl },
  padded: { paddingHorizontal: spacing.lg, gap: spacing.xl },
  group: { gap: spacing.sm },
  field: { gap: spacing.sm },
  pressed: { opacity: 0.6 },
  voices: { gap: 4 },
  voice: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
  },
  voiceSelected: { borderWidth: 1, borderColor: colors.accent },
  voiceName: { color: colors.text, fontSize: 14, fontWeight: "600" },
  voiceDetail: { color: colors.textDim, fontSize: 12 },
  crash: { gap: 4 },
  crashTitle: { color: colors.bad, fontSize: 14, fontWeight: "600" },
  footnote: { textAlign: "center", paddingHorizontal: spacing.md },
});
