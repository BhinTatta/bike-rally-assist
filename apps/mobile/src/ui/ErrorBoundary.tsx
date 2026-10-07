/**
 * Catches a render error anywhere below it and shows what happened instead of
 * taking the app down with it.
 *
 * In a debug build React would show a red screen; in the release build the
 * rider installs, there is nothing at all - the app simply closes. This turns
 * that into a readable message that can be shared.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Title } from "./components";
import { colors, radius, spacing } from "./theme";
import { recordCrash } from "../diagnostics";

interface Props {
  children: ReactNode;
  /** Called before the fallback is shown, to put the app back in a safe state. */
  onError?: () => void;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    recordCrash(error, false);
    this.setState({ componentStack: info.componentStack ?? null });
    this.props.onError?.();
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}>
          <Title>Something broke</Title>
          <Text style={styles.body}>
            The ride has been stopped. Please send this to whoever is fixing the app.
          </Text>
          <ScrollView style={styles.box}>
            <Text style={styles.mono}>{error.name}: {error.message}</Text>
            {error.stack ? <Text style={styles.monoDim}>{error.stack}</Text> : null}
            {this.state.componentStack ? (
              <Text style={styles.monoDim}>{this.state.componentStack}</Text>
            ) : null}
          </ScrollView>
          <Button
            label="Try again"
            kind="primary"
            onPress={() => this.setState({ error: null, componentStack: null })}
          />
        </View>
      </SafeAreaView>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, padding: spacing.md, gap: spacing.md },
  body: { color: colors.textDim, fontSize: 15 },
  box: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  mono: { color: colors.bad, fontFamily: "monospace", fontSize: 12 },
  monoDim: { color: colors.textDim, fontFamily: "monospace", fontSize: 11, marginTop: spacing.sm },
});
