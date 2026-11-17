/**
 * One line of the roadbook: a corner the way a co-driver's notes would have it.
 */

import { StyleSheet, Text, View } from "react-native";
import type { Corner, RoadFeature } from "@rally/engine";
import { featureLabel } from "@rally/engine";

import { CornerGlyph } from "./CornerGlyph";
import { Chip } from "./components";
import { formatDistance } from "./format";
import { Icon } from "./icons";
import { colors, featureColors, gradeColor, spacing, tabular } from "./theme";

/** "R3", "L1": the pacenote shorthand. */
export const cornerCode = (corner: Corner): string =>
  `${corner.direction === "left" ? "L" : "R"}${corner.rallyNumber}`;

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export function PacenoteRow({
  corner,
  /** Clear road after this corner before the next one, metres. */
  gapAfter,
  pacenotes,
}: {
  corner: Corner;
  gapAfter: number | null;
  /** Lead with the code ("R3") rather than the words ("Sharp right"). */
  pacenotes: boolean;
}) {
  const color = gradeColor(corner.grade);
  const modifiers = corner.modifiers.filter((m) => m !== "into");
  const into = corner.modifiers.includes("into");
  return (
    <View style={styles.row}>
      <Text style={styles.km}>{(corner.startDist / 1000).toFixed(1)}</Text>
      <View style={[styles.rail, { backgroundColor: color }]} />
      <CornerGlyph rallyNumber={corner.rallyNumber} direction={corner.direction} size={40} color={color} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color }]}>
            {pacenotes ? cornerCode(corner) : capitalise(`${corner.grade} ${corner.direction}`)}
          </Text>
          <Text style={styles.sub}>
            {pacenotes ? `${corner.grade} ${corner.direction}` : cornerCode(corner)}
          </Text>
        </View>
        <View style={styles.tags}>
          {corner.caution ? <Chip label="caution" color={colors.bad} icon="alert" /> : null}
          {modifiers.map((modifier) => (
            <Chip key={modifier} label={modifier} color={colors.textDim} />
          ))}
          <Text style={styles.detail}>
            r {Math.round(corner.minRadius)} m · {Math.round(corner.headingChange)}°
          </Text>
        </View>
      </View>
      <Text style={styles.gap}>
        {into ? "into" : gapAfter !== null && gapAfter > 0 ? formatDistance(gapAfter) : ""}
      </Text>
    </View>
  );
}

/** A hazard, as a line in the same list. */
export function FeatureRow({ feature }: { feature: RoadFeature }) {
  const color = featureColors[feature.kind];
  const length = feature.endDist !== undefined ? feature.endDist - feature.dist : 0;
  return (
    <View style={styles.row}>
      <Text style={styles.km}>{(feature.dist / 1000).toFixed(1)}</Text>
      <View style={[styles.rail, { backgroundColor: color }]} />
      <View style={styles.featureIcon}>
        <Icon
          name={feature.kind === "crest" || feature.kind === "dip" || feature.kind.startsWith("steep") ? "mountain" : "alert"}
          size={22}
          color={color}
        />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color }]}>{capitalise(featureLabel(feature))}</Text>
        <Text style={styles.detail}>
          {[
            length >= 50 ? `for ${formatDistance(length)}` : null,
            feature.gradientPercent !== undefined
              ? `${Math.abs(Math.round(feature.gradientPercent))}% ${feature.gradientPercent < 0 ? "down" : "up"}`
              : null,
            feature.source === "osm" ? "from map data" : "from elevation",
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 56, paddingVertical: 6 },
  km: { width: 38, color: colors.textFaint, fontSize: 12, fontWeight: "700", textAlign: "right", ...tabular },
  rail: { width: 3, alignSelf: "stretch", borderRadius: 2 },
  featureIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, gap: 3, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  title: { fontSize: 17, fontWeight: "800" },
  sub: { color: colors.textDim, fontSize: 12, fontWeight: "600" },
  tags: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  detail: { color: colors.textFaint, fontSize: 12, ...tabular },
  gap: { width: 56, color: colors.textDim, fontSize: 12, fontWeight: "700", textAlign: "right", ...tabular },
});
