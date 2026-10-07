/**
 * Shown once, before anything else.
 *
 * Not legal boilerplate for its own sake: a rider who expects this app to know
 * the road will get hurt. It has to be clear that the calls come from map data
 * and can be wrong, late, or missing entirely.
 */

import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Body, Button, Card, Title } from "../ui/components";
import { colors, spacing } from "../ui/theme";

export function DisclaimerGate({ onAccept }: { onAccept: () => void }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Title>Before you ride</Title>
        <Card>
          <Body>
            This is an assistant, not a guide. It reads corners out of map data and GPS, and both
            can be wrong:
          </Body>
          <Body dim>• map geometry can be inaccurate, outdated or missing</Body>
          <Body dim>• GPS drifts, and under cliffs and tree cover it drops out</Body>
          <Body dim>• roadworks, landslides, livestock and oncoming traffic are invisible to it</Body>
          <Body>
            Ride to what you can see. Never enter a corner faster than your eyes justify because a
            call said it was gentle.
          </Body>
        </Card>
        <Card>
          <Body>
            It is also not navigation. It never tells you where to go — only what the road is about
            to do on a route you loaded yourself.
          </Body>
        </Card>
        <View style={styles.spacer} />
        <Button label="I understand" kind="primary" big onPress={onAccept} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, padding: spacing.md, gap: spacing.md },
  spacer: { flex: 1 },
});
