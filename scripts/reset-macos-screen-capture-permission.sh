#!/bin/sh

set -eu

OST_BUNDLE_ID="com.openscreentranslate.desktop"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Screen capture permission can only be reset on macOS." >&2
  exit 1
fi

if ! command -v tccutil >/dev/null 2>&1; then
  echo "Required command not found: tccutil" >&2
  exit 1
fi

echo "Resetting screen recording permission for $OST_BUNDLE_ID..."
tccutil reset ScreenCapture "$OST_BUNDLE_ID"

echo
echo "Permission was reset."
echo "1. Completely quit every running OpenScreenTranslate process."
echo "2. Start the newly built app."
echo "3. Trigger screenshot translation and enable the app in System Settings when prompted."
echo "4. Quit and reopen the app once after granting permission."
