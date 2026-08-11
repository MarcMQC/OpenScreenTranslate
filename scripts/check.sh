#!/bin/sh

set -eu

OST_CHECK_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OST_CHECK_PROJECT_ROOT="$(cd "$OST_CHECK_SCRIPT_DIR/.." && pwd)"

cd "$OST_CHECK_PROJECT_ROOT"

echo "Cleaning macOS Finder metadata..."
"$OST_CHECK_PROJECT_ROOT/scripts/clean-macos-metadata.sh"

echo "Checking version synchronization..."
node scripts/sync-version.mjs --check

echo "Checking for sensitive files and secrets..."
node scripts/check-sensitive-files.mjs

echo "Checking Rust formatting..."
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check

echo "Building frontend..."
npm run build

echo "Running Rust tests..."
cargo test --manifest-path src-tauri/Cargo.toml

echo "Running Clippy..."
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

echo "All checks passed."
