// Metro config for a pnpm monorepo.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const packagesRoot = path.resolve(workspaceRoot, "packages");

const config = getDefaultConfig(projectRoot);

// Watch the whole workspace so edits in packages/engine and packages/osm
// hot-reload, and resolve from both node_modules trees.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

/**
 * The engine and OSM packages are ESM-with-NodeNext TypeScript, so their
 * relative imports carry a `.js` extension that points at a `.ts` file on
 * disk ("./geo.js" -> geo.ts). That is correct TypeScript and Node resolves it
 * after compilation, but Metro reads the source directly and looks for a file
 * that is not there.
 *
 * Rewriting the extension for imports *inside the workspace packages* lets the
 * app bundle the engine from source - which means editing a threshold in
 * packages/engine shows up in the app on the next fast refresh, with no build
 * step in between.
 */
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  const fromWorkspacePackage =
    typeof context.originModulePath === "string" &&
    context.originModulePath.startsWith(packagesRoot);

  if (fromWorkspacePackage && moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    try {
      return resolve(context, moduleName.replace(/\.js$/, ".ts"), platform);
    } catch {
      // Fall through: it really was a .js file.
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
