#!/bin/sh

set -eu

OST_DEBUG_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OST_DEBUG_PROJECT_ROOT="$(cd "$OST_DEBUG_SCRIPT_DIR/.." && pwd)"
OST_DEBUG_APP_PATH="$OST_DEBUG_PROJECT_ROOT/src-tauri/target/debug/bundle/macos/OpenScreenTranslate.app"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Debug app bundles can only be built on macOS." >&2
  exit 1
fi

for command in node npm cargo codesign; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 1
  fi
done

if [ ! -x "$OST_DEBUG_PROJECT_ROOT/node_modules/.bin/tauri" ]; then
  echo "Tauri CLI is missing; run npm install first." >&2
  exit 1
fi

cd "$OST_DEBUG_PROJECT_ROOT"

echo "Synchronizing project version..."
node scripts/sync-version.mjs

echo "Building local Debug app bundle..."
"$OST_DEBUG_PROJECT_ROOT/node_modules/.bin/tauri" build \
  --debug \
  --bundles app \
  --no-sign

echo "Applying local ad-hoc signature..."
OST_FORCE_ADHOC_SIGNING=1 \
  "$OST_DEBUG_PROJECT_ROOT/scripts/sign-macos-app.sh" "$OST_DEBUG_APP_PATH"

echo
echo "Debug app is ready:"
echo "$OST_DEBUG_APP_PATH"
echo "This build is for local testing only and has not been notarized."
echo "If an older ad-hoc build was already authorized for screen recording, run:"
echo "npm run reset:macos:screen-capture"
