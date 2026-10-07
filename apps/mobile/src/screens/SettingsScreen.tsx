/**
 * Settings.
 *
 * Every control here changes how the calls sound or when they arrive, and each
 * one says what it does in a sentence, because "lead time: 5" means nothing
 * on its own.
 */

import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet } from "react-native";

import {
  Body,
  Button,
  Card,
  Choice,
  Row,
  SectionHeader,
  Screen,
  Subtitle,
  Title,
  Toggle,
} from "../ui/components";
import { spacing } from "../ui/theme";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Settings,
  type Verbosity,
} from "../storage/settings";
import { rideEngine } from "../ride/rideEngine";
import { openBatteryOptimisationSettings } from "../ride/permissions";
import { clearLastCrash, readLastCrash, type CrashRecord } from "../diagnostics";
import { runSelfTest } from "../ride/selfTest";

export function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [crash, setCrash] = useState<CrashRecord | null>(null);
  const [testing, setTesting] = useState(false);
  const [testProgress, setTestProgress] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings().then(setSettings);
    setCrash(readLastCrash());
  }, []);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((current) => {
        if (!current) return current;
        const next = { ...current, ...patch };
        void saveSettings(next);
        // A ride may be in progress; apply immediately rather than next time.
        if (rideEngine.isActive) void rideEngine.applySettings(next);
        return next;
      });
    },
    [],
  );

  if (!settings) return <Screen />;

  return (
    <Screen>
      <SectionHeader>Calls</SectionHeader>
      <Card>
        <Title>Lead time</Title>
        <Subtitle>
          How far ahead of a corner the call arrives. Shorter feels urgent; longer gives you time
          to set up, but on a twisty ghat the calls start running together.
        </Subtitle>
        <Choice<number>
          value={settings.leadSeconds}
          onChange={(leadSeconds) => update({ leadSeconds })}
          options={[
            { value: 3, label: "3 s" },
            { value: 4, label: "4 s" },
            { value: 5, label: "5 s" },
            { value: 6, label: "6 s" },
            { value: 8, label: "8 s" },
          ]}
        />
      </Card>

      <Card>
        <Title>What to call</Title>
        <Subtitle>
          Every corner is useful on an unknown road. On a road you know, only the tight ones are
          worth hearing.
        </Subtitle>
        <Choice<Verbosity>
          value={settings.verbosity}
          onChange={(verbosity) => update({ verbosity })}
          options={[
            { value: "all", label: "All" },
            { value: "sharp-and-above", label: "Sharp +" },
            { value: "hairpins-only", label: "Hairpins" },
          ]}
        />
      </Card>

      <Card>
        <Title>Style</Title>
        <Subtitle>
          {settings.rallyMode
            ? 'Rally pacenotes: "Right 3, 80". Fewer syllables, quicker to hear once you know the numbers (1 is tightest).'
            : 'Plain language: "Sharp right, 80 metres".'}
        </Subtitle>
        <Choice<string>
          value={settings.rallyMode ? "rally" : "plain"}
          onChange={(value) => update({ rallyMode: value === "rally" })}
          options={[
            { value: "plain", label: "Plain" },
            { value: "rally", label: "Rally" },
          ]}
        />
      </Card>

      <Card>
        <Title>Timing correction</Title>
        <Subtitle>
          Compensates for the delay between deciding to speak and you hearing it. Raise it if calls
          feel late - some Bluetooth codecs buffer deeply.
        </Subtitle>
        <Choice<number>
          value={settings.lagSeconds}
          onChange={(lagSeconds) => update({ lagSeconds })}
          options={[
            { value: 0.5, label: "0.5 s" },
            { value: 1, label: "1 s" },
            { value: 1.5, label: "1.5 s" },
            { value: 2, label: "2 s" },
          ]}
        />
      </Card>

      <SectionHeader>Voice</SectionHeader>
      <Card>
        <Title>Speaking rate</Title>
        <Choice<number>
          value={settings.speechRate}
          onChange={(speechRate) => update({ speechRate })}
          options={[
            { value: 0.9, label: "Slow" },
            { value: 1, label: "Normal" },
            { value: 1.15, label: "Quick" },
            { value: 1.3, label: "Rally" },
          ]}
        />
      </Card>

      <Card>
        <Title>Volume</Title>
        <Subtitle>
          Device speech comes out at the phone's media volume, so use the volume keys while a call
          plays to set it. This slider sets the level of the headset keep-alive stream, and of
          recorded voice clips when those arrive.
        </Subtitle>
        <Choice<number>
          value={settings.voiceVolume}
          onChange={(voiceVolume) => update({ voiceVolume })}
          options={[
            { value: 0.25, label: "25%" },
            { value: 0.5, label: "50%" },
            { value: 0.75, label: "75%" },
            { value: 1, label: "100%" },
          ]}
        />
        <Button
          label="Test voice"
          onPress={() => void rideEngine.testVoice(settings)}
          style={styles.spaced}
        />
      </Card>

      <Card>
        <Toggle
          label="Keep audio alive in the background"
          description="Lets the keep-alive stream carry on with the screen off. This starts a second Android foreground service alongside the location one; leave it off unless you need it, and turn it off again if rides stop crashing only when it is off."
          value={settings.backgroundAudio}
          onChange={(backgroundAudio) => update({ backgroundAudio })}
        />
      </Card>

      <Card>
        <Toggle
          label="Keep the headset awake"
          description="Holds a near-silent stream open during a ride. Without it, Bluetooth headsets power down between calls and clip the first word."
          value={settings.keepHeadsetAwake}
          onChange={(keepHeadsetAwake) => update({ keepHeadsetAwake })}
        />
      </Card>

      <SectionHeader>Routes and rides</SectionHeader>
      <Card>
        <Toggle
          label="Snap imports to OpenStreetMap"
          description="Matches an imported GPX onto surveyed road geometry, which makes corner radii far more accurate. Needs a connection at import time; cached afterwards."
          value={settings.useOsmSnapping}
          onChange={(useOsmSnapping) => update({ useOsmSnapping })}
        />
      </Card>
      <Card>
        <Toggle
          label="Record rides"
          description="Saves each ride as a GPX plus a log of every call, so you can replay it and tune the thresholds."
          value={settings.logRides}
          onChange={(logRides) => update({ logRides })}
        />
      </Card>

      <SectionHeader>Android</SectionHeader>
      <Card>
        <Title>Self-test</Title>
        <Subtitle>
          Runs everything a ride start does to the phone — audio session, headset keep-alive,
          location service — and holds it for twelve seconds, which is long enough for Android
          to object if it is going to. No route or GPS fix needed. If the app closes during
          this, reopen it and the report will name the exact step.
        </Subtitle>
        {testProgress ? <Body dim>{testProgress}</Body> : null}
        <Button
          label="Run self-test"
          busy={testing}
          style={styles.spaced}
          onPress={() => {
            setTesting(true);
            void runSelfTest(setTestProgress)
              .then((result) => {
                Alert.alert(
                  "Self-test finished",
                  `${result.audioOk ? "Audio OK" : "Audio FAILED"}\n${
                    result.locationOk ? "Location service OK" : "Location service FAILED"
                  }\n\n${result.notes.join("\n")}`,
                );
              })
              .catch((error: Error) =>
                Alert.alert("Self-test failed", error.message),
              )
              .finally(() => {
                setTesting(false);
                setTestProgress(null);
              });
          }}
        />
      </Card>

      <Card>
        <Title>Battery optimisation</Title>
        <Subtitle>
          Xiaomi, Oppo, Vivo, Realme and OnePlus phones kill background apps hard. If the calls go
          silent after a few minutes with the screen off, exempt this app - and on those phones also
          turn on "Autostart" in the phone's own security app, which no app can do for you.
        </Subtitle>
        <Button
          label="Open battery settings"
          onPress={() => void openBatteryOptimisationSettings()}
          style={styles.spaced}
        />
      </Card>

      {crash ? (
        <>
          <SectionHeader>Diagnostics</SectionHeader>
          <Card>
            <Title>Last error</Title>
            <Subtitle>
              {`${new Date(crash.time).toLocaleString()} — during ${crash.phase}`}
            </Subtitle>
            <Body>{`${crash.name}: ${crash.message}`}</Body>
            {crash.stack ? <Body dim>{crash.stack.split("\n").slice(0, 6).join("\n")}</Body> : null}
            <Button
              label="Clear"
              kind="ghost"
              style={styles.spaced}
              onPress={() => {
                clearLastCrash();
                setCrash(null);
              }}
            />
          </Card>
        </>
      ) : null}

      <Card>
        <Title>Reset</Title>
        <Row>
          <Button
            label="Back to defaults"
            kind="ghost"
            onPress={() =>
              Alert.alert("Reset settings?", "All of the above goes back to its default.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Reset",
                  style: "destructive",
                  onPress: () =>
                    update({ ...DEFAULT_SETTINGS, disclaimerAccepted: settings.disclaimerAccepted }),
                },
              ])
            }
          />
        </Row>
      </Card>

      <Body dim>
        Rally Co-Driver is assistive only. It describes the road from map data, which is sometimes
        wrong, using GPS, which is sometimes late. Ride to what you can see.
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  spaced: { marginTop: spacing.sm },
});
