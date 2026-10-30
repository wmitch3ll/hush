#!/bin/sh
# Run AFTER `cargo tauri ios init` (macOS). Copies the Swift plugin + privacy manifest into the Xcode project sources.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; G="$ROOT/src-tauri/gen/apple"
[ -d "$G/Sources" ] || { echo "gen/apple/Sources not found. Run: cd src-tauri && cargo tauri ios init"; exit 1; }
S="$(ls -d "$G"/Sources/*/ | head -1)"
cp "$ROOT/src-tauri/ios-plugin/TabsPlugin.swift" "$S"
cp "$ROOT/src-tauri/ios-plugin/PrivacyInfo.xcprivacy" "$S"
echo "Copied into $S"
echo "If Xcode doesn't list PrivacyInfo.xcprivacy under 'Copy Bundle Resources', add it (target > Build Phases)."
