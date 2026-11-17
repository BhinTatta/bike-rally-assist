/**
 * Choosing how the co-driver talks.
 *
 * Three cards rather than a dropdown: the modes are the single most important
 * choice in the app, and each needs a line of explanation and an example of
 * what it sounds like before the names mean anything.
 */

import { Pressable, StyleSheet, Text, View } from "react-native";
import { RIDE_MODE_IDS, rideMode } from "@rally/engine";
import type { RideModeId } from "@rally/engine";

import { Icon, type IconName } from "./icons";
import { alpha, colors, modeColors, radius, spacing, type } from "./theme";

export const MODE_ICONS: Record<RideModeId, IconName> = {
  cruise: "route",
  sport: "gauge",
  duke: "bolt",
};

/** The full picker: one tall card per mode. */
export function ModePicker({
  value,
  onChange,
}: {
  value: RideModeId;
  onChange: (mode: RideModeId) => void;
}) {
  const selected = rideMode(value);
  const tint = modeColors[value];
  return (
    <View style={styles.wrap}>
      <View style={styles.row} accessibilityRole="radiogroup">
        {RIDE_MODE_IDS.map((id) => {
          const mode = rideMode(id);
          const active = id === value;
          const color = modeColors[id];
          return (
            <Pressable
              key={id}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${mode.name}: ${mode.tagline}`}
              onPress={() => onChange(id)}
              style={({ pressed }) => [
                styles.option,
                active && { borderColor: color, backgroundColor: alpha(color, 0.13) },
                pressed && styles.pressed,
              ]}
            >
              <Icon name={MODE_ICONS[id]} size={24} color={active ? color : colors.textDim} />
              <Text style={[styles.name, active && { color }]}>{mode.name}</Text>
              <Text style={styles.tagline} numberOfLines={1}>
                {mode.tagline}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.detail, { borderLeftColor: tint }]}>
        <Text style={styles.description}>{selected.description}</Text>
        <Text style={[styles.example, { color: tint }]}>“{selected.example}”</Text>
      </View>
    </View>
  );
}

/** The mode as a small pill, for headers and the ride screen. */
export function ModePill({ mode, onPress }: { mode: RideModeId; onPress?: () => void }) {
  const color = modeColors[mode];
  const content = (
    <>
      <Icon name={MODE_ICONS[mode]} size={15} color={colors.onAccent} />
      <Text style={styles.pillLabel}>{rideMode(mode).name}</Text>
    </>
  );
  if (!onPress) return <View style={[styles.pill, { backgroundColor: color }]}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ride mode: ${rideMode(mode).name}. Tap to change.`}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.pill, { backgroundColor: color }, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  row: { flexDirection: "row", gap: spacing.sm },
  option: {
    flex: 1,
    alignItems: "center",
    gap: 3,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceHigh,
    minHeight: 92,
    justifyContent: "center",
  },
  pressed: { opacity: 0.65 },
  name: { color: colors.text, fontSize: 16, fontWeight: "800", marginTop: 2 },
  tagline: { color: colors.textDim, fontSize: 11, fontWeight: "600" },
  detail: { borderLeftWidth: 3, paddingLeft: spacing.md, gap: 4 },
  description: { color: colors.textDim, ...type.small },
  example: { fontSize: 14, fontWeight: "700", fontStyle: "italic" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  pillLabel: {
    color: colors.onAccent,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
});
