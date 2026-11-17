/**
 * A button that only fires when held.
 *
 * Stopping a ride by accident - a glove brushing the screen, rain on the
 * glass - is worse than stopping it slowly. Holding for a second is quick to
 * do on purpose and almost impossible to do by mistake, and it needs no
 * confirmation dialog to aim at afterwards.
 */

import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";

import { Icon, type IconName } from "./icons";
import { alpha, colors, radius, spacing } from "./theme";

export function HoldButton({
  label,
  hint = "hold",
  icon,
  onComplete,
  color = colors.bad,
  durationMs = 1100,
}: {
  label: string;
  hint?: string;
  icon?: IconName;
  onComplete: () => void;
  color?: string;
  durationMs?: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const fired = useRef(false);

  useEffect(() => () => progress.stopAnimation(), [progress]);

  const start = (): void => {
    fired.current = false;
    Animated.timing(progress, {
      toValue: 1,
      duration: durationMs,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && !fired.current) {
        fired.current = true;
        onComplete();
      }
    });
  };

  const cancel = (): void => {
    if (fired.current) return;
    Animated.timing(progress, { toValue: 0, duration: 160, useNativeDriver: false }).start();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Press and hold.`}
      onPressIn={start}
      onPressOut={cancel}
      style={[styles.button, { borderColor: alpha(color, 0.7), backgroundColor: alpha(color, 0.14) }]}
    >
      <Animated.View
        style={[
          styles.fill,
          {
            backgroundColor: color,
            width: progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
          },
        ]}
      />
      <View style={styles.content}>
        {icon ? <Icon name={icon} size={20} color={colors.text} /> : null}
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    minHeight: 60,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    overflow: "hidden",
    justifyContent: "center",
  },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0 },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  label: { color: colors.text, fontSize: 18, fontWeight: "800", letterSpacing: 1 },
  hint: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});
