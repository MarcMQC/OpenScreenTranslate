#!/bin/bash

set -euo pipefail

OST_METADATA_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OST_METADATA_PROJECT_ROOT="$(cd "$OST_METADATA_SCRIPT_DIR/.." && pwd)"
OST_METADATA_REMOVED=0

while IFS= read -r -d '' metadata_path; do
  case "$metadata_path" in
    "$OST_METADATA_PROJECT_ROOT/"*)
      ;;
    *)
      echo "Refusing to remove metadata outside the project: $metadata_path" >&2
      exit 1
      ;;
  esac

  rm -f -- "$metadata_path"
  printf '  Removed %s\n' "${metadata_path#"$OST_METADATA_PROJECT_ROOT/"}"
  OST_METADATA_REMOVED=$((OST_METADATA_REMOVED + 1))
done < <(
  find "$OST_METADATA_PROJECT_ROOT" \
    -path "$OST_METADATA_PROJECT_ROOT/.git" -prune -o \
    -type f -name .DS_Store -print0
)

if [ "$OST_METADATA_REMOVED" -eq 0 ]; then
  echo "  No .DS_Store files found."
else
  echo "  Removed $OST_METADATA_REMOVED .DS_Store file(s)."
fi
