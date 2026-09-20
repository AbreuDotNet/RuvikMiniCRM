/**
 * Metro resolves this app's own `node_modules` first.
 *
 * `apps/mobile` sits inside the Ruvik monorepo but deliberately outside the
 * npm workspaces: hoisting React Native next to the web app's React 18 is a
 * good way to break both. That isolation comes from the workspace list, not
 * from here — this file only puts the app's own tree at the front of the
 * search path so its copy of React always wins.
 *
 * Hierarchical lookup stays on. Turning it off also disables resolution into
 * *nested* `node_modules`, and several Expo packages keep their dependencies
 * there — `@expo/metro-runtime` under `expo-router`, for one — so disabling it
 * stops the bundle building at the entry point.
 */
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  ...(config.resolver.nodeModulesPaths ?? []),
];

module.exports = config;
