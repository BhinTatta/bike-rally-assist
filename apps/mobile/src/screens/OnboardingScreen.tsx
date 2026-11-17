/**
 * First launch: what this is, what it is not, and the one promise the rider
 * has to make before using it.
 */

import { StyleSheet, Text, View } from "react-native";

import { Button, Screen } from "../ui/components";
import { CornerGlyph } from "../ui/CornerGlyph";
import { Icon, type IconName } from "../ui/icons";
import { alpha, colors, gradeColors, radius, spacing, type } from "../ui/theme";

const POINTS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "headset",
    title: "It talks, you ride",
    body: "Load a route and it calls every corner into your headset before you reach it: how tight, which way, how far.",
  },
  {
    icon: "bolt",
    title: "Three ways to ride",
    body: "Cruise for touring, Sport for a spirited run, Duke for full rally pacenotes.",
  },
  {
    icon: "alert",
    title: "It can be wrong",
    body: "Calls come from map data and GPS. Maps are sometimes wrong and GPS is sometimes late. It cannot see traffic, gravel or what is round the bend.",
  },
];

export function OnboardingScreen({ onAccept }: { onAccept: () => void }) {
  return (
    <Screen
      edges={["top", "left", "right"]}
      footer={<Button label="I understand — let's ride" kind="primary" big onPress={onAccept} />}
    >
      <View style={styles.hero}>
        <View style={styles.glyphs}>
          <CornerGlyph rallyNumber={5} direction="left" size={54} color={gradeColors.gentle} />
          <CornerGlyph rallyNumber={3} direction="right" size={78} color={gradeColors.sharp} />
          <CornerGlyph rallyNumber={1} direction="left" size={54} color={gradeColors.hairpin} />
        </View>
        <Text style={styles.wordmark}>RALLY CO-DRIVER</Text>
        <Text style={styles.title}>Know the road before you see it</Text>
      </View>

      <View style={styles.points}>
        {POINTS.map((point) => (
          <View key={point.title} style={styles.point}>
            <View style={styles.pointIcon}>
              <Icon name={point.icon} size={22} color={colors.accent} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.pointTitle}>{point.title}</Text>
              <Text style={styles.pointBody}>{point.body}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.promise}>
        <Text style={styles.promiseTitle}>Ride to what you can see</Text>
        <Text style={styles.promiseBody}>
          This is an aid, not an instruction. The corner speeds it shows are rough estimates from
          map geometry, never a safe speed. You are responsible for how you ride, on every corner.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { alignItems: "center", gap: spacing.sm, paddingTop: spacing.xl },
  glyphs: { flexDirection: "row", alignItems: "flex-end", gap: spacing.lg, marginBottom: spacing.md },
  wordmark: { color: colors.accent, ...type.label, letterSpacing: 2.4 },
  title: { color: colors.text, ...type.hero, fontSize: 30, textAlign: "center" },
  points: { gap: spacing.lg },
  point: { flexDirection: "row", gap: spacing.md },
  pointIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: alpha(colors.accent, 0.12),
    alignItems: "center",
    justifyContent: "center",
  },
  pointTitle: { color: colors.text, ...type.heading },
  pointBody: { color: colors.textDim, ...type.body, marginTop: 2 },
  promise: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: alpha(colors.warn, 0.5),
    backgroundColor: alpha(colors.warn, 0.09),
    padding: spacing.lg,
    gap: spacing.xs,
  },
  promiseTitle: { color: colors.warn, ...type.heading },
  promiseBody: { color: colors.text, ...type.body },
});
