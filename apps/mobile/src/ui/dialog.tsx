/**
 * In-app dialogs: a confirm sheet and a short-lived notice.
 *
 * The system alert is a small grey box with small grey buttons, which is the
 * wrong thing to aim a gloved thumb at. These are the app's own: full-width
 * buttons, the destructive one clearly red, and the same on every platform.
 *
 * Usage is imperative so it works from anywhere, not only from components:
 *
 *   if (await confirm({ title: "Delete route?", confirmLabel: "Delete", destructive: true })) ...
 *   notify("Route imported");
 */

import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "./components";
import { colors, radius, spacing, type } from "./theme";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string | null;
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface Notice {
  id: number;
  text: string;
  tone: "info" | "good" | "bad";
}

let showConfirm: ((pending: PendingConfirm) => void) | null = null;
let showNotice: ((notice: Notice) => void) | null = null;
let noticeId = 0;

/** Ask a yes/no question. Resolves false if the host is not mounted. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!showConfirm) {
      resolve(false);
      return;
    }
    showConfirm({ ...options, resolve });
  });
}

/** Tell the rider something that needs no answer. */
export function inform(title: string, body?: string): Promise<boolean> {
  return confirm({ title, ...(body ? { body } : {}), confirmLabel: "OK", cancelLabel: null });
}

/** A line of text that appears at the bottom for a few seconds. */
export function notify(text: string, tone: Notice["tone"] = "info"): void {
  showNotice?.({ id: ++noticeId, text, tone });
}

export function DialogHost() {
  const insets = useSafeAreaInsets();
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    showConfirm = (next) => setPending(next);
    showNotice = (next) => setNotice(next);
    return () => {
      showConfirm = null;
      showNotice = null;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice((current) => (current?.id === notice.id ? null : current)), 3200);
    return () => clearTimeout(timer);
  }, [notice]);

  const answer = (value: boolean): void => {
    pending?.resolve(value);
    setPending(null);
  };

  const noticeColor =
    notice?.tone === "good" ? colors.good : notice?.tone === "bad" ? colors.bad : colors.text;

  return (
    <>
      <Modal
        visible={pending !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => answer(false)}
      >
        <Pressable style={styles.scrim} onPress={() => answer(false)}>
          <Pressable
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.sm }]}
            onPress={() => undefined}
          >
            <View style={styles.grabber} />
            <Text style={styles.title}>{pending?.title}</Text>
            {pending?.body ? <Text style={styles.body}>{pending.body}</Text> : null}
            <View style={styles.actions}>
              <Button
                label={pending?.confirmLabel ?? "OK"}
                kind={pending?.destructive ? "danger" : "primary"}
                onPress={() => answer(true)}
              />
              {pending?.cancelLabel !== null ? (
                <Button label={pending?.cancelLabel ?? "Cancel"} kind="ghost" onPress={() => answer(false)} />
              ) : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      {notice ? (
        <View pointerEvents="none" style={[styles.noticeWrap, { bottom: insets.bottom + 96 }]}>
          <View style={styles.notice}>
            <Text style={[styles.noticeText, { color: noticeColor }]}>{notice.text}</Text>
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.66)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surfaceHigh,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.sm,
  },
  title: { color: colors.text, ...type.title },
  body: { color: colors.textDim, ...type.body },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  noticeWrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  notice: {
    maxWidth: "88%",
    backgroundColor: colors.surfaceTop,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  noticeText: { fontSize: 14, fontWeight: "600", textAlign: "center" },
});
