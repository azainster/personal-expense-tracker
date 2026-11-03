// Expo configures Metro for npm-workspace monorepos automatically (SDK 52+), so no
// watchFolders / nodeModulesPaths overrides are needed for @expense/core.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Browser preview only (`npm run web`): expo-sqlite's web build is WebAssembly and needs
// SharedArrayBuffer, which requires these isolation headers. iOS builds are unaffected.
config.resolver.assetExts.push('wasm');
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  return middleware(req, res, next);
};

module.exports = config;
