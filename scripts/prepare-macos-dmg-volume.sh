#!/bin/bash

set -euo pipefail

OST_DMG_VOLUME_PATH="${1:-}"
OST_DMG_LEGACY_ARROW_NAME=$'\342\200\213'

if [ -z "$OST_DMG_VOLUME_PATH" ] || [ ! -d "$OST_DMG_VOLUME_PATH" ]; then
  echo "Usage: $0 /absolute/path/to/mounted-dmg" >&2
  exit 1
fi

OST_DMG_VOLUME_PATH="$(cd "$OST_DMG_VOLUME_PATH" && pwd)"

case "$OST_DMG_VOLUME_PATH" in
  /Volumes/*|/private/tmp/*|/tmp/*|/private/var/folders/*|/var/folders/*)
    ;;
  *)
    echo "Refusing to modify a path outside a temporary DMG mount: $OST_DMG_VOLUME_PATH" >&2
    exit 1
    ;;
esac

command -v SetFile >/dev/null 2>&1 \
  || { echo "Required command not found: SetFile" >&2; exit 1; }

# Tauri's DMG builder adds this file to give the mounted volume a custom icon.
# Finder can reveal it when hidden files are shown, so remove it completely and
# clear the volume flag that refers to it.
rm -f "$OST_DMG_VOLUME_PATH/.VolumeIcon.icns"
SetFile -a c "$OST_DMG_VOLUME_PATH"

# A background image forces Tauri/create-dmg to add a hidden .background
# directory outside the window, which Finder still includes in horizontal
# scrolling. Remove any stale background and arrow files completely.
rm -rf "$OST_DMG_VOLUME_PATH/.background"
rm -f \
  "$OST_DMG_VOLUME_PATH/ .png" \
  "$OST_DMG_VOLUME_PATH/$OST_DMG_LEGACY_ARROW_NAME" \
  "$OST_DMG_VOLUME_PATH/$OST_DMG_LEGACY_ARROW_NAME.png"
