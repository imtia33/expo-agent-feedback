const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Monorepo setup: expo-eyes-app is symlinked from ../../packages/expo-eyes-app.
// Metro resolves modules relative to the REAL file path (not the symlink path),
// so `import 'react'` inside packages/expo-eyes-app/dist/* would walk up the
// packages tree and miss examples/demo-app/node_modules/react entirely.
//
// Fix: declare the package as a watchFolder and add the demo-app's node_modules
// to the resolver's search paths.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../../');

const config = getDefaultConfig(projectRoot);

// 1. Watch the expo-eyes-app SOURCE + DIST only (not its node_modules, which
//    is huge and blows past the inotify limit). When we rebuild dist, Metro
//    picks up the change automatically.
config.watchFolders = [
  path.resolve(workspaceRoot, 'packages/expo-eyes-app/src'),
  path.resolve(workspaceRoot, 'packages/expo-eyes-app/dist'),
];

// 2. When resolving bare imports (react, react-native, etc.) from inside the
//    symlinked package, also look in the demo-app's node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Make sure Metro follows the SAME single copy of react/react-native for
//    both the host app and the symlinked library (dedupe by version).
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
