#!/bin/bash

set -euo pipefail

OST_DEBUG_DMG_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OST_DEBUG_DMG_PROJECT_ROOT="$(cd "$OST_DEBUG_DMG_SCRIPT_DIR/.." && pwd)"
OST_DEBUG_DMG_MARKER=""
OST_DEBUG_DMG_WORK_DIR=""
OST_DEBUG_DMG_MOUNT_POINT=""

cleanup_debug_dmg() {
  if [ -n "$OST_DEBUG_DMG_MOUNT_POINT" ]; then
    hdiutil detach "$OST_DEBUG_DMG_MOUNT_POINT" >/dev/null 2>&1 || true
    rmdir "$OST_DEBUG_DMG_MOUNT_POINT" >/dev/null 2>&1 || true
  fi

  if [ -n "$OST_DEBUG_DMG_MARKER" ]; then
    rm -f "$OST_DEBUG_DMG_MARKER"
  fi

  if [ -n "$OST_DEBUG_DMG_WORK_DIR" ]; then
    rm -f \
      "$OST_DEBUG_DMG_WORK_DIR/debug-rw.dmg" \
      "$OST_DEBUG_DMG_WORK_DIR/debug-final.dmg" \
      "$OST_DEBUG_DMG_WORK_DIR/unsigned.dmg"
    rm -rf "$OST_DEBUG_DMG_WORK_DIR/signed-app"
    rmdir "$OST_DEBUG_DMG_WORK_DIR/mount" >/dev/null 2>&1 || true
    rmdir "$OST_DEBUG_DMG_WORK_DIR" >/dev/null 2>&1 || true
  fi
}

die() {
  echo "Error: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

if [ "$(uname -s)" != "Darwin" ]; then
  die "Debug DMG bundles can only be built on macOS"
fi

for command in node npm cargo codesign ditto hdiutil SetFile shasum; do
  require_command "$command"
done

if [ ! -x "$OST_DEBUG_DMG_PROJECT_ROOT/node_modules/.bin/tauri" ]; then
  die "Tauri CLI is missing; run npm install first"
fi

case "${CARGO_TARGET_DIR:-}" in
  "")
    OST_DEBUG_DMG_TARGET_DIR="$OST_DEBUG_DMG_PROJECT_ROOT/src-tauri/target"
    ;;
  /*)
    OST_DEBUG_DMG_TARGET_DIR="$CARGO_TARGET_DIR"
    ;;
  *)
    OST_DEBUG_DMG_TARGET_DIR="$OST_DEBUG_DMG_PROJECT_ROOT/$CARGO_TARGET_DIR"
    ;;
esac

OST_DEBUG_DMG_BUNDLE_DIR="$OST_DEBUG_DMG_TARGET_DIR/debug/bundle/dmg"

cd "$OST_DEBUG_DMG_PROJECT_ROOT"

OST_DEBUG_DMG_PRODUCT_NAME="$(node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8")); process.stdout.write(c.productName)')"
[ -n "$OST_DEBUG_DMG_PRODUCT_NAME" ] \
  || die "bundle productName is missing from src-tauri/tauri.conf.json"

echo "Synchronizing project version..."
node scripts/sync-version.mjs

OST_DEBUG_DMG_MARKER="$(mktemp "${TMPDIR:-/tmp}/openscreentranslate-debug-dmg.XXXXXX")"
OST_DEBUG_DMG_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/openscreentranslate-debug-dmg-work.XXXXXX")"
OST_DEBUG_DMG_MOUNT_POINT="$OST_DEBUG_DMG_WORK_DIR/mount"
mkdir "$OST_DEBUG_DMG_MOUNT_POINT"
trap cleanup_debug_dmg EXIT

echo "Building unsigned Debug DMG with Tauri..."
"$OST_DEBUG_DMG_PROJECT_ROOT/node_modules/.bin/tauri" build \
  --debug \
  --bundles dmg \
  --no-sign

OST_DEBUG_DMG_FILES=()
if [ -d "$OST_DEBUG_DMG_BUNDLE_DIR" ]; then
  while IFS= read -r -d '' dmg_path; do
    OST_DEBUG_DMG_FILES[${#OST_DEBUG_DMG_FILES[@]}]="$dmg_path"
  done < <(find "$OST_DEBUG_DMG_BUNDLE_DIR" -maxdepth 1 -type f -name '*.dmg' -newer "$OST_DEBUG_DMG_MARKER" -print0)
fi

[ "${#OST_DEBUG_DMG_FILES[@]}" -eq 1 ] \
  || die "expected one newly built DMG in $OST_DEBUG_DMG_BUNDLE_DIR, found ${#OST_DEBUG_DMG_FILES[@]}"

OST_DEBUG_DMG_UNSIGNED_PATH="${OST_DEBUG_DMG_FILES[0]}"
OST_DEBUG_DMG_FINAL_PATH="${OST_DEBUG_DMG_UNSIGNED_PATH%.dmg}_debug.dmg"
OST_DEBUG_DMG_RW_PATH="$OST_DEBUG_DMG_WORK_DIR/debug-rw.dmg"
OST_DEBUG_DMG_TEMP_FINAL_PATH="$OST_DEBUG_DMG_WORK_DIR/debug-final.dmg"

echo "Converting DMG to a writable image for local ad-hoc signing..."
hdiutil convert "$OST_DEBUG_DMG_UNSIGNED_PATH" \
  -format UDRW \
  -o "$OST_DEBUG_DMG_RW_PATH" >/dev/null

hdiutil attach "$OST_DEBUG_DMG_RW_PATH" \
  -readwrite \
  -noverify \
  -nobrowse \
  -mountpoint "$OST_DEBUG_DMG_MOUNT_POINT" >/dev/null

OST_DEBUG_DMG_APP_PATH="$OST_DEBUG_DMG_MOUNT_POINT/$OST_DEBUG_DMG_PRODUCT_NAME.app"
[ -d "$OST_DEBUG_DMG_APP_PATH" ] \
  || die "the Debug DMG does not contain $OST_DEBUG_DMG_PRODUCT_NAME.app"

OST_DEBUG_DMG_SIGNED_APP_DIR="$OST_DEBUG_DMG_WORK_DIR/signed-app"
OST_DEBUG_DMG_SIGNED_APP_PATH="$OST_DEBUG_DMG_SIGNED_APP_DIR/$OST_DEBUG_DMG_PRODUCT_NAME.app"
mkdir "$OST_DEBUG_DMG_SIGNED_APP_DIR"
ditto "$OST_DEBUG_DMG_APP_PATH" "$OST_DEBUG_DMG_SIGNED_APP_PATH"

echo "Applying stable local ad-hoc signature to the app..."
OST_FORCE_ADHOC_SIGNING=1 \
  "$OST_DEBUG_DMG_PROJECT_ROOT/scripts/sign-macos-app.sh" "$OST_DEBUG_DMG_SIGNED_APP_PATH"

case "$OST_DEBUG_DMG_APP_PATH" in
  "$OST_DEBUG_DMG_MOUNT_POINT/"*.app)
    ;;
  *)
    die "refusing to replace an app outside the temporary DMG mount point"
    ;;
esac

rm -rf "$OST_DEBUG_DMG_APP_PATH"
ditto "$OST_DEBUG_DMG_SIGNED_APP_PATH" "$OST_DEBUG_DMG_APP_PATH"
codesign --verify --deep --strict --verbose=2 "$OST_DEBUG_DMG_APP_PATH"

echo "Removing visible DMG support files and scroll overflow..."
"$OST_DEBUG_DMG_PROJECT_ROOT/scripts/prepare-macos-dmg-volume.sh" \
  "$OST_DEBUG_DMG_MOUNT_POINT"

hdiutil detach "$OST_DEBUG_DMG_MOUNT_POINT" >/dev/null
OST_DEBUG_DMG_MOUNT_POINT=""

echo "Compressing the signed Debug DMG..."
hdiutil convert "$OST_DEBUG_DMG_RW_PATH" \
  -format UDZO \
  -imagekey zlib-level=9 \
  -o "$OST_DEBUG_DMG_TEMP_FINAL_PATH" >/dev/null

mv -f "$OST_DEBUG_DMG_UNSIGNED_PATH" "$OST_DEBUG_DMG_WORK_DIR/unsigned.dmg"
mv -f "$OST_DEBUG_DMG_TEMP_FINAL_PATH" "$OST_DEBUG_DMG_FINAL_PATH"

echo "Verifying the final Debug DMG and embedded app signature..."
hdiutil verify "$OST_DEBUG_DMG_FINAL_PATH" >/dev/null

OST_DEBUG_DMG_MOUNT_POINT="$OST_DEBUG_DMG_WORK_DIR/mount"
hdiutil attach "$OST_DEBUG_DMG_FINAL_PATH" \
  -readonly \
  -nobrowse \
  -mountpoint "$OST_DEBUG_DMG_MOUNT_POINT" >/dev/null
codesign --verify --deep --strict --verbose=2 \
  "$OST_DEBUG_DMG_MOUNT_POINT/$OST_DEBUG_DMG_PRODUCT_NAME.app"
hdiutil detach "$OST_DEBUG_DMG_MOUNT_POINT" >/dev/null
OST_DEBUG_DMG_MOUNT_POINT=""

OST_DEBUG_DMG_CHECKSUM="$(shasum -a 256 "$OST_DEBUG_DMG_FINAL_PATH" | awk '{print $1}')"
printf '%s  %s\n' \
  "$OST_DEBUG_DMG_CHECKSUM" \
  "$(basename "$OST_DEBUG_DMG_FINAL_PATH")" \
  > "$OST_DEBUG_DMG_FINAL_PATH.sha256"

echo
echo "Debug DMG is ready:"
echo "  DMG:     $OST_DEBUG_DMG_FINAL_PATH"
echo "  SHA256:  $OST_DEBUG_DMG_FINAL_PATH.sha256"
echo "  Signing: local ad-hoc"
echo "  Apple:   not submitted for notarization"
echo "This artifact is for local testing only and must not be publicly distributed."
