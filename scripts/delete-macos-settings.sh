#!/bin/sh

set -eu

if [ "$(uname -s)" != "Darwin" ]; then
  echo "OpenScreenTranslate settings can only be removed with this script on macOS." >&2
  exit 1
fi

if [ -z "${HOME:-}" ] || [ "$HOME" = "/" ]; then
  echo "Unable to determine a safe user home directory." >&2
  exit 1
fi

if ! command -v security >/dev/null 2>&1; then
  echo "Required macOS command not found: security" >&2
  exit 1
fi

if command -v pgrep >/dev/null 2>&1 && pgrep -x openscreentranslate >/dev/null 2>&1; then
  echo "OpenScreenTranslate is still running." >&2
  echo "Completely quit the app before deleting its settings." >&2
  exit 1
fi

OST_CURRENT_SETTINGS="$HOME/Library/Application Support/com.openscreentranslate.desktop/settings.json"
OST_LEGACY_SETTINGS="$HOME/Library/Application Support/com.openscreentranslate.app/settings.json"
OST_KEYCHAIN_ACCOUNT="api-key"
OST_KEYCHAIN_SERVICES="
com.openscreentranslate.deepseek
com.openscreentranslate.openai
com.openscreentranslate.anthropic
com.openscreentranslate.google-gemini
"

echo "The following OpenScreenTranslate data will be permanently deleted if present:"
echo
echo "Settings files:"
echo "- $OST_CURRENT_SETTINGS"
echo "- $OST_LEGACY_SETTINGS"
echo
echo "macOS Keychain API Keys (account: $OST_KEYCHAIN_ACCOUNT):"
for OST_KEYCHAIN_SERVICE in $OST_KEYCHAIN_SERVICES; do
  echo "- $OST_KEYCHAIN_SERVICE"
done

if [ "${1:-}" != "--yes" ]; then
  printf "Continue? [y/N] "
  read -r OST_CONFIRMATION
  case "$OST_CONFIRMATION" in
    y|Y|yes|YES|Yes) ;;
    *)
      echo "Cancelled."
      exit 0
      ;;
  esac
fi

OST_DELETED_COUNT=0
OST_ERROR_COUNT=0

if [ -f "$OST_CURRENT_SETTINGS" ]; then
  rm -- "$OST_CURRENT_SETTINGS"
  echo "Deleted: $OST_CURRENT_SETTINGS"
  OST_DELETED_COUNT=$((OST_DELETED_COUNT + 1))
fi

if [ -f "$OST_LEGACY_SETTINGS" ]; then
  rm -- "$OST_LEGACY_SETTINGS"
  echo "Deleted: $OST_LEGACY_SETTINGS"
  OST_DELETED_COUNT=$((OST_DELETED_COUNT + 1))
fi

for OST_KEYCHAIN_SERVICE in $OST_KEYCHAIN_SERVICES; do
  if security find-generic-password \
    -a "$OST_KEYCHAIN_ACCOUNT" \
    -s "$OST_KEYCHAIN_SERVICE" >/dev/null 2>&1; then
    if security delete-generic-password \
      -a "$OST_KEYCHAIN_ACCOUNT" \
      -s "$OST_KEYCHAIN_SERVICE" >/dev/null; then
      echo "Deleted Keychain API Key: $OST_KEYCHAIN_SERVICE"
      OST_DELETED_COUNT=$((OST_DELETED_COUNT + 1))
    else
      echo "Failed to delete Keychain API Key: $OST_KEYCHAIN_SERVICE" >&2
      OST_ERROR_COUNT=$((OST_ERROR_COUNT + 1))
    fi
  fi
done

if [ "$OST_ERROR_COUNT" -ne 0 ]; then
  echo "Cleanup completed with $OST_ERROR_COUNT error(s)." >&2
  exit 1
fi

if [ "$OST_DELETED_COUNT" -eq 0 ]; then
  echo "No OpenScreenTranslate settings or API Keys were found."
else
  echo "OpenScreenTranslate settings and saved API Keys were deleted."
fi

echo "The settings window will open on the next app launch."
