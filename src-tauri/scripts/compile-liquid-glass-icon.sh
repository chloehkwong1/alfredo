#!/usr/bin/env bash
# Compile the layered macOS app icon (icons/Alfredo.icon) into Assets.car
# so the bundled app picks up macOS Tahoe's Liquid Glass treatment instead of
# the washed-out fallback applied to flat .icns icons.
#
# Wired into tauri.conf.json as build.beforeBundleCommand (runs from project root).
# No-op on non-macOS platforms (Linux CI runners do not have actool).
#
# APP_ICON_NAME below must match (a) the source bundle directory name
# `icons/Alfredo.icon`, and (b) `CFBundleIconName` in src-tauri/Info.plist.
# All three must stay in sync if the icon is ever renamed.
#
# Soft-fails: any actool error logs a warning and exits 0 so the bundle still
# ships with the flat .icns icons (pre-Liquid-Glass behaviour). Better to lose
# the polish than to brick a release on an Xcode hiccup.
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "[liquid-glass] skipping on $(uname)" >&2
  exit 0
fi

# Resolve paths relative to this script so CWD doesn't matter.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ICONS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/icons"
SOURCE="$ICONS_DIR/Alfredo.icon"
APP_ICON_NAME="Alfredo"

if [[ ! -d "$SOURCE" ]]; then
  echo "[liquid-glass] $SOURCE missing — skipping" >&2
  exit 0
fi

if ! command -v actool >/dev/null 2>&1; then
  echo "[liquid-glass] actool not found (Xcode required) — skipping" >&2
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if ! actool --compile "$TMP" \
  --platform macosx \
  --minimum-deployment-target 26.0 \
  --app-icon "$APP_ICON_NAME" \
  --output-partial-info-plist "$TMP/partial.plist" \
  "$SOURCE" >/dev/null; then
  echo "[liquid-glass] actool failed — bundle will fall back to flat .icns" >&2
  exit 0
fi

if [[ ! -f "$TMP/Assets.car" ]]; then
  echo "[liquid-glass] actool produced no Assets.car — skipping" >&2
  exit 0
fi

cp "$TMP/Assets.car" "$ICONS_DIR/Assets.car"
echo "[liquid-glass] regenerated $ICONS_DIR/Assets.car" >&2
