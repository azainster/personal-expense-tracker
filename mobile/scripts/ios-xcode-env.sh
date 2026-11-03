#!/bin/sh
# Xcode opened from the Dock or Finder doesn't inherit your Terminal PATH, so React Native's
# build phases can't find Homebrew's `node` ("node: command not found"). This records the
# absolute path in ios/.xcode.env.local, which those build phases read. The ios/ folder is
# generated and git-ignored, so this is per-machine and re-created by `npm run ios:prebuild`.
set -e

NODE_PATH="$(command -v node || true)"
if [ -z "$NODE_PATH" ]; then
  echo "node was not found on PATH. Install Node.js 22+ and run this again." >&2
  exit 1
fi

if [ ! -d ios ]; then
  echo "No ios/ folder yet. Run: npm run ios:prebuild" >&2
  exit 1
fi

printf 'export NODE_BINARY=%s\n' "$NODE_PATH" > ios/.xcode.env.local
echo "Wrote ios/.xcode.env.local (NODE_BINARY=$NODE_PATH)"
