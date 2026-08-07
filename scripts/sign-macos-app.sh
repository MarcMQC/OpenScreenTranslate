#!/bin/sh

set -eu

OST_APP_PATH="${1:-src-tauri/target/release/bundle/macos/OpenScreenTranslate.app}"
OST_BUNDLE_ID="com.openscreentranslate.desktop"
OST_LOCAL_DESIGNATED_REQUIREMENT="=designated => identifier \"$OST_BUNDLE_ID\""

if [ ! -d "$OST_APP_PATH" ]; then
  echo "macOS app bundle not found: $OST_APP_PATH" >&2
  exit 1
fi

if [ "${OST_FORCE_ADHOC_SIGNING:-0}" = "1" ]; then
  echo "Applying a local ad-hoc bundle signature."
  codesign \
    --force \
    --deep \
    --sign - \
    --identifier "$OST_BUNDLE_ID" \
    --requirements "$OST_LOCAL_DESIGNATED_REQUIREMENT" \
    "$OST_APP_PATH"
elif [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "Apple signing identity is configured; verifying Tauri's signed app bundle."
else
  echo "No Apple signing identity found; applying local ad-hoc bundle signature."
  echo "Using a stable local designated requirement for macOS privacy permissions."
  codesign \
    --force \
    --deep \
    --sign - \
    --identifier "$OST_BUNDLE_ID" \
    --requirements "$OST_LOCAL_DESIGNATED_REQUIREMENT" \
    "$OST_APP_PATH"
fi

codesign --verify --deep --strict --verbose=2 "$OST_APP_PATH"
codesign --display --verbose=2 "$OST_APP_PATH" 2>&1
