#!/bin/bash

set -euo pipefail

OST_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OST_PROJECT_ROOT="$(cd "$OST_SCRIPT_DIR/.." && pwd)"
OST_NOTARY_PROFILE="${OST_NOTARY_PROFILE:-OpenScreenTranslate-notary}"
OST_MACOS_TARGET="${OST_MACOS_TARGET:-native}"
OST_NOTARY_TIMEOUT="${OST_NOTARY_TIMEOUT:-6h}"
OST_SKIP_CHECKS=0
OST_ACTION="release"
OST_DMG_PATH=""
OST_SUBMISSION_ID=""
OST_DMG_LAYOUT_WORK_DIR=""

usage() {
  cat <<'EOF'
Usage:
  ./scripts/release-macos-dmg.sh setup
  ./scripts/release-macos-dmg.sh [release] [options]
  ./scripts/release-macos-dmg.sh resume [options]

Commands:
  setup                    Store Apple notarization credentials in Keychain.
  release                  Build, sign, notarize, staple, and verify a DMG.
  resume                   Resume waiting/stapling the latest submitted DMG.

Options:
  --target TARGET          native (default), apple-silicon, intel, or universal.
  --profile NAME           notarytool Keychain profile name.
  --skip-checks            Skip format, build, test, and Clippy checks.
  --dmg PATH               DMG to finish when using resume.
  --submission ID          Apple submission ID to use with --dmg.
  -h, --help               Show this help.

Environment variables:
  APPLE_SIGNING_IDENTITY   Exact Developer ID Application identity. Required
                           only when more than one matching identity is installed.
  OST_NOTARY_PROFILE       Alternative to --profile.
  OST_MACOS_TARGET         Alternative to --target.
  OST_NOTARY_TIMEOUT       notarytool wait timeout (default: 6h).
EOF
}

die() {
  echo "Error: $*" >&2
  exit 1
}

cleanup_release_temporary_files() {
  if [ -n "${OST_DMG_MOUNT_POINT:-}" ]; then
    hdiutil detach "$OST_DMG_MOUNT_POINT" >/dev/null 2>&1 || true
    rmdir "$OST_DMG_MOUNT_POINT" >/dev/null 2>&1 || true
  fi
  if [ -n "${OST_RELEASE_MARKER:-}" ]; then
    rm -f "$OST_RELEASE_MARKER"
  fi
  if [ -n "$OST_DMG_LAYOUT_WORK_DIR" ]; then
    rm -f \
      "$OST_DMG_LAYOUT_WORK_DIR/layout-rw.dmg" \
      "$OST_DMG_LAYOUT_WORK_DIR/layout-final.dmg"
    rmdir "$OST_DMG_LAYOUT_WORK_DIR/mount" >/dev/null 2>&1 || true
    rmdir "$OST_DMG_LAYOUT_WORK_DIR" >/dev/null 2>&1 || true
  fi
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

json_field() {
  local field="$1"
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(0,"utf8")); const v=o[process.argv[1]]; if (v !== undefined && v !== null) process.stdout.write(String(v));' "$field"
}

verify_release_versions() {
  node scripts/sync-version.mjs --check
  printf 'Release version: '
  sed -n '1p' VERSION
}

prepare_release_dmg_layout() {
  local dmg_path="$1"
  local rw_path
  local final_path

  OST_DMG_LAYOUT_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/openscreentranslate-dmg-layout.XXXXXX")"
  rw_path="$OST_DMG_LAYOUT_WORK_DIR/layout-rw.dmg"
  final_path="$OST_DMG_LAYOUT_WORK_DIR/layout-final.dmg"
  OST_DMG_MOUNT_POINT="$OST_DMG_LAYOUT_WORK_DIR/mount"
  mkdir "$OST_DMG_MOUNT_POINT"

  hdiutil convert "$dmg_path" -format UDRW -o "$rw_path" >/dev/null
  hdiutil attach "$rw_path" \
    -readwrite \
    -noverify \
    -nobrowse \
    -mountpoint "$OST_DMG_MOUNT_POINT" >/dev/null

  "$OST_PROJECT_ROOT/scripts/prepare-macos-dmg-volume.sh" "$OST_DMG_MOUNT_POINT"

  hdiutil detach "$OST_DMG_MOUNT_POINT" >/dev/null
  OST_DMG_MOUNT_POINT=""

  hdiutil convert "$rw_path" \
    -format UDZO \
    -imagekey zlib-level=9 \
    -o "$final_path" >/dev/null
  mv -f "$final_path" "$dmg_path"

  rm -f "$rw_path"
  rmdir "$OST_DMG_LAYOUT_WORK_DIR/mount"
  rmdir "$OST_DMG_LAYOUT_WORK_DIR"
  OST_DMG_LAYOUT_WORK_DIR=""
}

resolve_target() {
  case "$OST_MACOS_TARGET" in
    native)
      OST_TARGET_TRIPLE=""
      ;;
    apple-silicon|aarch64|aarch64-apple-darwin)
      OST_TARGET_TRIPLE="aarch64-apple-darwin"
      ;;
    intel|x86_64|x86_64-apple-darwin)
      OST_TARGET_TRIPLE="x86_64-apple-darwin"
      ;;
    universal|universal-apple-darwin)
      OST_TARGET_TRIPLE="universal-apple-darwin"
      ;;
    *)
      die "unsupported target '$OST_MACOS_TARGET'; use native, apple-silicon, intel, or universal"
      ;;
  esac
}

require_rust_target() {
  local target="$1"
  if ! rustup target list --installed | grep -Fx "$target" >/dev/null; then
    die "Rust target '$target' is not installed. Run: rustup target add $target"
  fi
}

resolve_signing_identity() {
  local line
  local identity
  local configured_identity="${APPLE_SIGNING_IDENTITY:-}"
  OST_DEVELOPER_IDENTITIES=()

  while IFS= read -r line; do
    identity="$(printf '%s\n' "$line" | sed -n 's/.*"\(Developer ID Application:.*\)".*/\1/p')"
    if [ -n "$identity" ]; then
      OST_DEVELOPER_IDENTITIES[${#OST_DEVELOPER_IDENTITIES[@]}]="$identity"
    fi
  done < <(security find-identity -v -p codesigning 2>/dev/null)

  if [ -n "$configured_identity" ]; then
    for identity in "${OST_DEVELOPER_IDENTITIES[@]:-}"; do
      if [ "$identity" = "$configured_identity" ]; then
        export APPLE_SIGNING_IDENTITY="$configured_identity"
        return
      fi
    done
    die "APPLE_SIGNING_IDENTITY is not an installed Developer ID Application identity: $configured_identity"
  fi

  case "${#OST_DEVELOPER_IDENTITIES[@]}" in
    0)
      die "no valid Developer ID Application identity was found in Keychain. Install the certificate and its private key first"
      ;;
    1)
      export APPLE_SIGNING_IDENTITY="${OST_DEVELOPER_IDENTITIES[0]}"
      ;;
    *)
      echo "Multiple Developer ID Application identities were found:" >&2
      for identity in "${OST_DEVELOPER_IDENTITIES[@]}"; do
        echo "  $identity" >&2
      done
      die "set APPLE_SIGNING_IDENTITY to the exact identity to use"
      ;;
  esac
}

team_id_from_identity() {
  printf '%s\n' "$APPLE_SIGNING_IDENTITY" | sed -n 's/.*(\([A-Z0-9][A-Z0-9]*\))$/\1/p'
}

setup_notary_profile() {
  local apple_id
  local team_id

  resolve_signing_identity
  team_id="$(team_id_from_identity)"

  echo "Signing identity: $APPLE_SIGNING_IDENTITY"
  echo "Keychain profile: $OST_NOTARY_PROFILE"
  echo
  echo "Generate an app-specific password at https://account.apple.com before continuing."
  printf "Apple Account email: "
  IFS= read -r apple_id
  [ -n "$apple_id" ] || die "Apple Account email cannot be empty"

  if [ -z "$team_id" ]; then
    printf "Apple Developer Team ID: "
    IFS= read -r team_id
  else
    echo "Team ID: $team_id"
  fi
  [ -n "$team_id" ] || die "Team ID cannot be empty"

  echo
  echo "notarytool will securely prompt for the app-specific password."
  xcrun notarytool store-credentials "$OST_NOTARY_PROFILE" \
    --apple-id "$apple_id" \
    --team-id "$team_id"

  echo
  echo "Notarization credentials are ready. Run: npm run release:macos"
}

validate_release_environment() {
  local target

  [ "$(uname -s)" = "Darwin" ] || die "macOS releases must be built on macOS"
  require_command node
  require_command npm
  require_command cargo
  require_command rustup
  require_command security
  require_command xcrun
  require_command codesign
  require_command hdiutil
  require_command SetFile
  require_command spctl
  require_command shasum

  [ -x "$OST_PROJECT_ROOT/node_modules/.bin/tauri" ] || die "Tauri CLI is missing; run npm install first"
  xcrun --find notarytool >/dev/null 2>&1 || die "notarytool is unavailable; install current Xcode Command Line Tools"
  xcrun --find stapler >/dev/null 2>&1 || die "stapler is unavailable; install current Xcode Command Line Tools"

  resolve_target
  case "$OST_TARGET_TRIPLE" in
    universal-apple-darwin)
      require_rust_target aarch64-apple-darwin
      require_rust_target x86_64-apple-darwin
      ;;
    aarch64-apple-darwin|x86_64-apple-darwin)
      require_rust_target "$OST_TARGET_TRIPLE"
      ;;
    "")
      target="$(rustc -vV | sed -n 's/^host: //p')"
      require_rust_target "$target"
      ;;
  esac

  resolve_signing_identity

  echo "Checking notarization credentials in Keychain profile '$OST_NOTARY_PROFILE'..."
  xcrun notarytool history \
    --keychain-profile "$OST_NOTARY_PROFILE" \
    --output-format json >/dev/null
}

validate_resume_environment() {
  [ "$(uname -s)" = "Darwin" ] || die "macOS releases must be finalized on macOS"
  require_command node
  require_command xcrun
  require_command hdiutil
  require_command spctl
  require_command shasum

  xcrun --find notarytool >/dev/null 2>&1 || die "notarytool is unavailable; install current Xcode Command Line Tools"
  xcrun --find stapler >/dev/null 2>&1 || die "stapler is unavailable; install current Xcode Command Line Tools"

  echo "Checking notarization credentials in Keychain profile '$OST_NOTARY_PROFILE'..."
  xcrun notarytool history \
    --keychain-profile "$OST_NOTARY_PROFILE" \
    --output-format json >/dev/null
}

print_resume_command() {
  local dmg_path="$1"
  local submission_id="$2"

  echo "Apple will continue processing this submission. Resume without rebuilding:"
  printf '  ./scripts/release-macos-dmg.sh resume --dmg %q --submission %q\n' \
    "$dmg_path" "$submission_id"
}

finalize_notarized_dmg() {
  local dmg_path="$1"
  local submission_id="$2"
  local info_json
  local status
  local wait_exit=0
  local checksum
  local log_path="$dmg_path.notary-log.json"

  [ -f "$dmg_path" ] || die "DMG was not found: $dmg_path"

  info_json="$(xcrun notarytool info "$submission_id" \
    --keychain-profile "$OST_NOTARY_PROFILE" \
    --output-format json)"
  status="$(printf '%s' "$info_json" | json_field status)"

  if [ "$status" = "In Progress" ]; then
    echo
    echo "Waiting for Apple notarization (submission $submission_id)..."
    xcrun notarytool wait "$submission_id" \
      --keychain-profile "$OST_NOTARY_PROFILE" \
      --timeout "$OST_NOTARY_TIMEOUT" || wait_exit=$?

    info_json="$(xcrun notarytool info "$submission_id" \
      --keychain-profile "$OST_NOTARY_PROFILE" \
      --output-format json)"
    status="$(printf '%s' "$info_json" | json_field status)"
  fi

  printf '%s\n' "$info_json" > "$dmg_path.notary-info.json"

  case "$status" in
    Accepted)
      ;;
    Invalid|Rejected)
      xcrun notarytool log "$submission_id" "$log_path" \
        --keychain-profile "$OST_NOTARY_PROFILE" || true
      die "Apple notarization status is $status. Diagnostic log: $log_path"
      ;;
    "In Progress")
      echo
      echo "Notarization is still in progress (wait exit code: $wait_exit)."
      print_resume_command "$dmg_path" "$submission_id"
      return 2
      ;;
    *)
      die "unexpected Apple notarization status '$status' for submission $submission_id"
      ;;
  esac

  echo
  echo "Stapling notarization ticket..."
  xcrun stapler staple "$dmg_path"

  echo
  echo "Verifying final distributable DMG..."
  xcrun stapler validate "$dmg_path"
  hdiutil verify "$dmg_path"
  spctl --assess --type open --context context:primary-signature --verbose=4 "$dmg_path"

  checksum="$(shasum -a 256 "$dmg_path" | awk '{print $1}')"
  printf '%s  %s\n' "$checksum" "$(basename "$dmg_path")" > "$dmg_path.sha256"

  echo
  echo "Release is ready:"
  echo "  DMG:    $dmg_path"
  echo "  SHA256: $dmg_path.sha256"
  echo "  Apple:  Accepted ($submission_id)"
}

find_latest_submission_state() {
  local state_file
  local latest=""

  if [ -d "$OST_PROJECT_ROOT/src-tauri/target" ]; then
    while IFS= read -r -d '' state_file; do
      if [ -z "$latest" ] || [ "$state_file" -nt "$latest" ]; then
        latest="$state_file"
      fi
    done < <(find "$OST_PROJECT_ROOT/src-tauri/target" -type f -name '*.dmg.notary-id' -print0)
  fi

  [ -n "$latest" ] || die "no saved notarization submission was found; provide --dmg and --submission"
  printf '%s' "$latest"
}

run_resume() {
  local state_file

  validate_resume_environment

  if [ -z "$OST_DMG_PATH" ]; then
    state_file="$(find_latest_submission_state)"
    OST_DMG_PATH="${state_file%.notary-id}"
  else
    OST_DMG_PATH="$(cd "$(dirname "$OST_DMG_PATH")" 2>/dev/null && pwd)/$(basename "$OST_DMG_PATH")"
    state_file="$OST_DMG_PATH.notary-id"
  fi

  if [ -z "$OST_SUBMISSION_ID" ]; then
    [ -f "$state_file" ] || die "submission state was not found: $state_file"
    OST_SUBMISSION_ID="$(sed -n '1p' "$state_file")"
  fi

  [ -n "$OST_SUBMISSION_ID" ] || die "submission ID is empty"
  finalize_notarized_dmg "$OST_DMG_PATH" "$OST_SUBMISSION_ID"
}

run_release() {
  local marker
  local bundle_root
  local dmg_dir
  local app_path
  local mount_point
  local product_name
  local dmg_path
  local signature_info
  local submission_json
  local submission_id
  local -a build_args
  local -a dmg_files

  validate_release_environment
  cd "$OST_PROJECT_ROOT"

  product_name="$(node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8")); process.stdout.write(c.productName)')"
  [ -n "$product_name" ] || die "bundle productName is missing from src-tauri/tauri.conf.json"
  verify_release_versions

  if [ "$OST_SKIP_CHECKS" -eq 0 ]; then
    echo
    echo "Running release checks..."
    npm run check
  fi

  marker="$(mktemp "${TMPDIR:-/tmp}/openscreentranslate-release.XXXXXX")"
  OST_RELEASE_MARKER="$marker"
  OST_DMG_MOUNT_POINT=""
  trap cleanup_release_temporary_files EXIT

  build_args=(build --bundles dmg)
  if [ -n "$OST_TARGET_TRIPLE" ]; then
    build_args+=(--target "$OST_TARGET_TRIPLE")
    bundle_root="$OST_PROJECT_ROOT/src-tauri/target/$OST_TARGET_TRIPLE/release/bundle"
  else
    bundle_root="$OST_PROJECT_ROOT/src-tauri/target/release/bundle"
  fi

  # This script submits with notarytool using a Keychain profile. Prevent Tauri
  # from seeing unrelated shell credentials and submitting the DMG twice.
  unset APPLE_API_ISSUER APPLE_API_KEY APPLE_API_KEY_PATH
  unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID

  echo
  echo "Building signed DMG for ${OST_TARGET_TRIPLE:-native architecture}..."
  "$OST_PROJECT_ROOT/node_modules/.bin/tauri" "${build_args[@]}"

  dmg_dir="$bundle_root/dmg"
  dmg_files=()
  if [ -d "$dmg_dir" ]; then
    while IFS= read -r -d '' dmg_path; do
      dmg_files[${#dmg_files[@]}]="$dmg_path"
    done < <(find "$dmg_dir" -maxdepth 1 -type f -name '*.dmg' -newer "$marker" -print0)
  fi

  [ "${#dmg_files[@]}" -eq 1 ] \
    || die "expected one newly built DMG in $dmg_dir, found ${#dmg_files[@]}"
  dmg_path="${dmg_files[0]}"

  echo
  echo "Removing visible DMG support files and scroll overflow..."
  prepare_release_dmg_layout "$dmg_path"

  echo "Re-signing customized DMG with Developer ID..."
  codesign \
    --force \
    --sign "$APPLE_SIGNING_IDENTITY" \
    --timestamp \
    "$dmg_path"

  echo
  echo "Verifying Developer ID signatures..."
  codesign --verify --strict --verbose=2 "$dmg_path"

  mount_point="$(mktemp -d "${TMPDIR:-/tmp}/openscreentranslate-dmg.XXXXXX")"
  OST_DMG_MOUNT_POINT="$mount_point"
  hdiutil attach "$dmg_path" -readonly -nobrowse -mountpoint "$mount_point" >/dev/null
  app_path="$mount_point/$product_name.app"
  [ -d "$app_path" ] || die "the DMG does not contain $product_name.app"

  codesign --verify --deep --strict --verbose=2 "$app_path"
  signature_info="$(codesign --display --verbose=4 "$app_path" 2>&1)"
  printf '%s\n' "$signature_info"
  printf '%s\n' "$signature_info" | grep -F "Authority=Developer ID Application:" >/dev/null \
    || die "the app is not signed with a Developer ID Application certificate"

  hdiutil detach "$mount_point" >/dev/null
  rmdir "$mount_point"
  OST_DMG_MOUNT_POINT=""

  echo
  echo "Submitting DMG to Apple notarization service..."
  submission_json="$(xcrun notarytool submit "$dmg_path" \
    --keychain-profile "$OST_NOTARY_PROFILE" \
    --output-format json)"
  printf '%s\n' "$submission_json"
  submission_id="$(printf '%s' "$submission_json" | json_field id)"
  [ -n "$submission_id" ] || die "notarytool did not return a submission ID"

  # Save the ID before waiting so Ctrl-C or a timeout never requires a rebuild.
  printf '%s\n' "$submission_id" > "$dmg_path.notary-id"
  echo "Saved submission ID: $dmg_path.notary-id"

  finalize_notarized_dmg "$dmg_path" "$submission_id"
}

if [ "${1:-}" = "setup" ] || [ "${1:-}" = "release" ] || [ "${1:-}" = "resume" ]; then
  OST_ACTION="$1"
  shift
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      [ "$#" -ge 2 ] || die "--target requires a value"
      OST_MACOS_TARGET="$2"
      shift 2
      ;;
    --profile)
      [ "$#" -ge 2 ] || die "--profile requires a value"
      OST_NOTARY_PROFILE="$2"
      shift 2
      ;;
    --skip-checks)
      OST_SKIP_CHECKS=1
      shift
      ;;
    --dmg)
      [ "$#" -ge 2 ] || die "--dmg requires a path"
      OST_DMG_PATH="$2"
      shift 2
      ;;
    --submission)
      [ "$#" -ge 2 ] || die "--submission requires an ID"
      OST_SUBMISSION_ID="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

case "$OST_ACTION" in
  setup)
    [ "$(uname -s)" = "Darwin" ] || die "notarization setup must run on macOS"
    require_command security
    require_command xcrun
    resolve_target
    setup_notary_profile
    ;;
  release)
    run_release
    ;;
  resume)
    run_resume
    ;;
  *)
    die "unknown command: $OST_ACTION"
    ;;
esac
