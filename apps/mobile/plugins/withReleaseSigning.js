/**
 * Expo config plugin: sign release builds with a real keystore when one is
 * supplied through the environment, and otherwise leave the project alone.
 *
 * Why this exists: `expo prebuild` regenerates android/ from scratch, so any
 * signing config hand-edited into build.gradle is thrown away on every build.
 * A config plugin is the supported way to make a change that survives.
 *
 * With no environment variables set, React Native's default applies and
 * `assembleRelease` is signed with the template debug keystore. That APK
 * installs and runs perfectly well for personal use - it just cannot be
 * uploaded to Play, and its signature only stays stable because the template
 * keystore is the same every time.
 *
 * Set all four to sign properly (see .github/workflows/android-apk.yml):
 *   RALLY_KEYSTORE_PATH, RALLY_KEYSTORE_PASSWORD,
 *   RALLY_KEY_ALIAS,     RALLY_KEY_PASSWORD
 */
const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// rally: release signing";

/** The signingConfigs block we inject, reading its secrets from gradle properties. */
const SIGNING_CONFIG = `        release {
            ${MARKER}
            storeFile file(project.property("RALLY_KEYSTORE_PATH"))
            storePassword project.property("RALLY_KEYSTORE_PASSWORD")
            keyAlias project.property("RALLY_KEY_ALIAS")
            keyPassword project.property("RALLY_KEY_PASSWORD")
        }
`;

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    const hasKeystore = Boolean(
      process.env.RALLY_KEYSTORE_PATH &&
        process.env.RALLY_KEYSTORE_PASSWORD &&
        process.env.RALLY_KEY_ALIAS &&
        process.env.RALLY_KEY_PASSWORD,
    );
    if (!hasKeystore) return gradleConfig;

    let contents = gradleConfig.modResults.contents;
    if (contents.includes(MARKER)) return gradleConfig;

    // 1. Add a `release` entry to signingConfigs, next to the debug one.
    contents = contents.replace(
      /(signingConfigs\s*\{\s*\n)/,
      `$1${SIGNING_CONFIG}`,
    );
    // 2. Point the release build type at it instead of at the debug config.
    contents = contents.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?signingConfig\s+signingConfigs\.)debug/,
      "$1release",
    );

    if (!contents.includes(MARKER)) {
      throw new Error(
        "withReleaseSigning: could not find signingConfigs in app/build.gradle. " +
          "The React Native template changed; update this plugin.",
      );
    }
    gradleConfig.modResults.contents = contents;
    return gradleConfig;
  });
}

module.exports = withReleaseSigning;
