/**
 * The building blocks every screen uses.
 *
 * Plain React Native views and the app's own icons: no animation library, no
 * theme provider. Touch targets are at least 48 px because half of these are
 * pressed with a glove on.
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
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { Icon, type IconName } from "./icons";
import { alpha, colors, gradeColor, radius, spacing, tabular, type } from "./theme";

// ------------------------------------------------------------------ layout

export function Screen({
  children,
  scroll = true,
  style,
  edges = ["top", "left", "right"],
  footer,
}: {
  children?: ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  edges?: Edge[];
  /** Pinned under the content, above the system navigation bar. */
  footer?: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={footer ? [...edges, "bottom"] : edges}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, style]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, style]}>{children}</View>
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

/** The bar at the top of a pushed screen: back, title, actions. */
export function Header({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      {onBack ? <IconButton icon="back" label="Back" onPress={onBack} /> : null}
      <View style={styles.headerTitles}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.headerRight}>{right}</View> : null}
    </View>
  );
}

export function Row({
  children,
  style,
  gap = spacing.sm,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  gap?: number;
}) {
  return <View style={[styles.row, { gap }, style]}>{children}</View>;
}

export function Card({
  children,
  style,
  onPress,
  tint,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  /** A colour to wash the card with, for selected or flagged states. */
  tint?: string;
  padded?: boolean;
}) {
  const tinted: ViewStyle | null = tint
    ? { borderColor: alpha(tint, 0.55), backgroundColor: alpha(tint, 0.09) }
    : null;
  const base = [styles.card, padded && styles.cardPadded, tinted, style];
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [...base, pressed && styles.pressed]}>
        {children}
      </Pressable>
    );
  }
  return <View style={base}>{children}</View>;
}

// -------------------------------------------------------------------- text

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text style={styles.heading}>{children}</Text>;
}

export function Body({
  children,
  dim = false,
  style,
}: {
  children: ReactNode;
  dim?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[styles.body, dim && styles.dim, style]}>{children}</Text>;
}

export function Small({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.small, style]}>{children}</Text>;
}

/** The small capitalised label above a group. */
export function Label({ children, color }: { children: ReactNode; color?: string }) {
  return <Text style={[styles.label, color ? { color } : null]}>{children}</Text>;
}

// ----------------------------------------------------------------- buttons

export type ButtonKind = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  label,
  onPress,
  kind = "secondary",
  icon,
  disabled = false,
  busy = false,
  big = false,
  tint,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  big?: boolean;
  /** Overrides the fill of a primary button (the ride mode colour). */
  tint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const kindStyle = {
    primary: styles.buttonPrimary,
    secondary: styles.buttonSecondary,
    danger: styles.buttonDanger,
    ghost: styles.buttonGhost,
  }[kind];
  const foreground =
    kind === "primary" ? colors.onAccent : kind === "danger" ? "#ffffff" : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        kindStyle,
        kind === "primary" && tint ? { backgroundColor: tint } : null,
        big && styles.buttonBig,
        (disabled || busy) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={big ? 24 : 20} color={foreground} /> : null}
          <Text
            style={[styles.buttonLabel, { color: foreground }, big && styles.buttonLabelBig]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  color = colors.text,
  filled = false,
  size = 44,
  disabled = false,
}: {
  icon: IconName;
  /** Read by screen readers; never shown. */
  label: string;
  onPress: () => void;
  color?: string;
  filled?: boolean;
  size?: number;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        { width: size, height: size, borderRadius: size / 2 },
        filled && styles.iconButtonFilled,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} color={color} />
    </Pressable>
  );
}

// ------------------------------------------------------------------ inputs

/** A horizontal set of choices; big enough to hit with gloves on. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  tint = colors.accent,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  tint?: string;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              selected && { backgroundColor: tint },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>
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
  tint = colors.accent,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  tint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
    >
      <View style={styles.flex}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {description ? <Text style={styles.toggleDescription}>{description}</Text> : null}
      </View>
      <View style={[styles.toggleTrack, value && { backgroundColor: tint }]}>
        <View style={[styles.toggleKnob, value && styles.toggleKnobOn]} />
      </View>
    </Pressable>
  );
}

/** A row that leads somewhere: icon, label, value, chevron. */
export function ListItem({
  icon,
  label,
  description,
  value,
  onPress,
  tint,
}: {
  icon?: IconName;
  label: string;
  description?: string;
  value?: string;
  onPress?: () => void;
  tint?: string;
}) {
  const content = (
    <>
      {icon ? (
        <View style={styles.listIcon}>
          <Icon name={icon} size={20} color={tint ?? colors.textDim} />
        </View>
      ) : null}
      <View style={styles.flex}>
        <Text style={[styles.toggleLabel, tint ? { color: tint } : null]}>{label}</Text>
        {description ? <Text style={styles.toggleDescription}>{description}</Text> : null}
      </View>
      {value ? <Text style={styles.listValue}>{value}</Text> : null}
      {onPress ? <Icon name="forward" size={18} color={colors.textFaint} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.listItem}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.listItem, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

// ------------------------------------------------------------------- data

/** A labelled number, for the stats rows. */
export function Stat({
  label,
  value,
  unit,
  tint,
  align = "left",
}: {
  label: string;
  value: string;
  unit?: string;
  tint?: string;
  align?: "left" | "center";
}) {
  return (
    <View style={[styles.stat, align === "center" && styles.statCentre]}>
      <Text style={[styles.statValue, tint ? { color: tint } : null]} numberOfLines={1}>
        {value}
        {unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A small rounded tag. */
export function Chip({
  label,
  color = colors.textDim,
  icon,
  solid = false,
}: {
  label: string;
  color?: string;
  icon?: IconName;
  solid?: boolean;
}) {
  return (
    <View
      style={[
        styles.chip,
        solid
          ? { backgroundColor: color, borderColor: color }
          : { backgroundColor: alpha(color, 0.14), borderColor: alpha(color, 0.4) },
      ]}
    >
      {icon ? <Icon name={icon} size={13} color={solid ? colors.onAccent : color} /> : null}
      <Text style={[styles.chipLabel, { color: solid ? colors.onAccent : color }]}>{label}</Text>
    </View>
  );
}

/** A coloured pill naming a corner grade, with a count. */
export function GradeBadge({ grade, count }: { grade: string; count?: number }) {
  return (
    <Chip label={count === undefined ? grade : `${count} ${grade}`} color={gradeColor(grade)} />
  );
}

/** Five bars, some of them lit. */
export function Meter({ value, color = colors.accent }: { value: number; color?: string }) {
  return (
    <View style={styles.meter} accessibilityLabel={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((step) => (
        <View
          key={step}
          style={[
            styles.meterBar,
            { height: 5 + step * 3, backgroundColor: step <= value ? color : colors.surfaceTop },
          ]}
        />
      ))}
    </View>
  );
}

export function ProgressBar({
  value,
  color = colors.accent,
  height = 6,
}: {
  /** 0-1. */
  value: number;
  color?: string;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View style={[styles.progressTrack, { height, borderRadius: height / 2 }]}>
      <View
        style={{
          width: `${clamped * 100}%`,
          height,
          borderRadius: height / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

export function Empty({
  icon,
  title,
  body,
  children,
}: {
  icon?: IconName;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      {icon ? (
        <View style={styles.emptyIcon}>
          <Icon name={icon} size={30} color={colors.accent} />
        </View>
      ) : null}
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {children}
    </View>
  );
}

/** A strip across the screen that says something is wrong, or just different. */
export function Banner({
  text,
  color,
  icon = "alert",
  onPress,
}: {
  text: string;
  color: string;
  icon?: IconName;
  onPress?: () => void;
}) {
  const content = (
    <>
      <Icon name={icon} size={18} color={color} />
      <Text style={[styles.bannerText, { color }]}>{text}</Text>
    </>
  );
  const style = [styles.banner, { backgroundColor: alpha(color, 0.13), borderColor: alpha(color, 0.5) }];
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [...style, pressed && styles.pressed]}>
        {content}
      </Pressable>
    );
  }
  return <View style={style}>{content}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 56,
  },
  headerTitles: { flex: 1, paddingHorizontal: spacing.sm },
  headerTitle: { color: colors.text, ...type.heading },
  headerSubtitle: { color: colors.textDim, ...type.small },
  headerRight: { flexDirection: "row", alignItems: "center" },
  row: { flexDirection: "row", alignItems: "center" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  cardPadded: { padding: spacing.lg, gap: spacing.md },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.4 },
  title: { color: colors.text, ...type.title },
  heading: { color: colors.text, ...type.heading },
  body: { color: colors.text, ...type.body },
  small: { color: colors.textDim, ...type.small },
  dim: { color: colors.textDim },
  label: { color: colors.textDim, ...type.label },
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  buttonBig: { minHeight: 64, borderRadius: radius.lg },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: { backgroundColor: colors.surfaceTop },
  buttonDanger: { backgroundColor: colors.bad },
  buttonGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.borderStrong },
  buttonLabel: { fontSize: 16, fontWeight: "700" },
  buttonLabelBig: { fontSize: 20, fontWeight: "800", letterSpacing: 0.3 },
  iconButton: { alignItems: "center", justifyContent: "center" },
  iconButtonFilled: { backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.border },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm + 1,
    paddingHorizontal: spacing.xs,
  },
  segmentLabel: { color: colors.textDim, fontSize: 14, fontWeight: "600", textAlign: "center" },
  segmentLabelSelected: { color: colors.onAccent, fontWeight: "800" },
  toggle: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 },
  toggleLabel: { color: colors.text, fontSize: 15, fontWeight: "600" },
  toggleDescription: { color: colors.textDim, ...type.small, marginTop: 2 },
  toggleTrack: {
    width: 50,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceTop,
    padding: 3,
    justifyContent: "center",
  },
  toggleKnob: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.textDim },
  toggleKnobOn: { backgroundColor: colors.onAccent, alignSelf: "flex-end" },
  listItem: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 },
  listIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  listValue: { color: colors.textDim, fontSize: 14, fontWeight: "600" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  stat: { flex: 1, gap: 2, minWidth: 0 },
  statCentre: { alignItems: "center" },
  statValue: { color: colors.text, fontSize: 22, fontWeight: "800", ...tabular },
  statUnit: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  statLabel: { color: colors.textDim, ...type.label, fontSize: 10 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  chipLabel: { fontSize: 12, fontWeight: "700" },
  meter: { flexDirection: "row", alignItems: "flex-end", gap: 3 },
  meterBar: { width: 5, borderRadius: 2 },
  progressTrack: { backgroundColor: colors.surfaceTop, overflow: "hidden" },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: alpha(colors.accent, 0.12),
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  emptyTitle: { color: colors.text, ...type.title, textAlign: "center" },
  emptyBody: { color: colors.textDim, ...type.body, textAlign: "center", marginBottom: spacing.md },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  bannerText: { flex: 1, fontSize: 14, fontWeight: "600", lineHeight: 19 },
});
