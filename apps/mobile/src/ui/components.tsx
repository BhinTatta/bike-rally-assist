/**
 * The small set of building blocks every screen uses.
 *
 * Deliberately plain: no animation library, no theme provider, no styled
 * components. A rider needs the app to start fast and be readable in sunlight.
 */

import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, gradeColor, radius, spacing } from "./theme";

export function Screen({
  children,
  scroll = true,
  style,
}: {
  children?: ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, style]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, style]}>{children}</View>
  );
  return <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>{content}</SafeAreaView>;
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Subtitle({ children }: { children: ReactNode }) {
  return <Text style={styles.subtitle}>{children}</Text>;
}

export function Body({ children, dim = false }: { children: ReactNode; dim?: boolean }) {
  return <Text style={[styles.body, dim && styles.dim]}>{children}</Text>;
}

export function SectionHeader({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionHeader}>{children}</Text>;
}

export type ButtonKind = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  label,
  onPress,
  kind = "secondary",
  disabled = false,
  busy = false,
  big = false,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  big?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const kindStyle = {
    primary: styles.buttonPrimary,
    secondary: styles.buttonSecondary,
    danger: styles.buttonDanger,
    ghost: styles.buttonGhost,
  }[kind];
  const labelStyle = kind === "primary" ? styles.buttonLabelDark : styles.buttonLabel;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        kindStyle,
        big && styles.buttonBig,
        (disabled || busy) && styles.buttonDisabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={kind === "primary" ? colors.bg : colors.text} />
      ) : (
        <Text style={[labelStyle, big && styles.buttonLabelBig]}>{label}</Text>
      )}
    </Pressable>
  );
}

/** A labelled number, for the stats rows. */
export function Stat({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tint ? { color: tint } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

/** A coloured pill naming a corner grade. */
export function GradeBadge({ grade, count }: { grade: string; count?: number }) {
  return (
    <View style={[styles.badge, { backgroundColor: gradeColor(grade) }]}>
      <Text style={styles.badgeText}>
        {count === undefined ? grade : `${count} ${grade}`}
      </Text>
    </View>
  );
}

/** A horizontal set of choices; big enough to hit with gloves on. */
export function Choice<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.choice}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.choiceItem,
              selected && styles.choiceItemSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
    >
      <View style={styles.flex}>
        <Text style={styles.body}>{label}</Text>
        {description ? <Text style={styles.toggleDescription}>{description}</Text> : null}
      </View>
      <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
        <View style={[styles.toggleKnob, value && styles.toggleKnobOn]} />
      </View>
    </Pressable>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  pressed: { opacity: 0.7 },
  title: { color: colors.text, fontSize: 22, fontWeight: "700" },
  subtitle: { color: colors.textDim, fontSize: 14 },
  body: { color: colors.text, fontSize: 16 },
  dim: { color: colors.textDim },
  sectionHeader: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: spacing.sm,
  },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  buttonBig: { minHeight: 72, borderRadius: radius.lg },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: { backgroundColor: colors.surfaceHigh },
  buttonDanger: { backgroundColor: colors.bad },
  buttonGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { color: colors.text, fontSize: 16, fontWeight: "600" },
  buttonLabelDark: { color: colors.bg, fontSize: 16, fontWeight: "700" },
  buttonLabelBig: { fontSize: 24, fontWeight: "800" },
  stat: { flex: 1, gap: 2 },
  statValue: { color: colors.text, fontSize: 20, fontWeight: "700" },
  statLabel: { color: colors.textDim, fontSize: 12 },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  badge: { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: "#10131a", fontSize: 12, fontWeight: "700" },
  choice: {
    flexDirection: "row",
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  choiceItem: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  choiceItemSelected: { backgroundColor: colors.accent },
  choiceLabel: { color: colors.textDim, fontSize: 14, fontWeight: "600" },
  choiceLabelSelected: { color: colors.bg },
  toggle: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 },
  toggleDescription: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  toggleTrack: {
    width: 52,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceHigh,
    padding: 3,
    justifyContent: "center",
  },
  toggleTrackOn: { backgroundColor: colors.accent },
  toggleKnob: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.textDim,
  },
  toggleKnobOn: { backgroundColor: colors.bg, alignSelf: "flex-end" },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "600" },
  emptyBody: { color: colors.textDim, fontSize: 14, textAlign: "center" },
});
