#!/usr/bin/env bash
#
# app/dev/screenshots.sh -- render the listing screenshots on the demo data (window alone, with shadow).
#
#   app/dev/screenshots.sh [--check]
#
# Needs a built bundle (`gjsify workspace reminder-cli build`). Runs `gui --demo` with a scratch
# XDG_CONFIG_HOME, never the real configuration. Output: docs/screenshots/<motif>.<lang>.png.
# TODO: calendar and board views are still placeholders; add their motifs when they have content.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HEADLESS="${HEADLESS_RUN:-$HOME/Projekte/werkstatt/scripts/headless-run}"
OUT="$ROOT/docs/screenshots"
# motif | window size (logical, Flathub maximum is 1000x700) | view | languages
MOTIFS=(
  "tasks|1000x700|tasks|en de"
  "tasks-narrow|400x760|tasks|en de"
)

if [ "${1:-}" = "--check" ]; then
  rc=0
  for m in "${MOTIFS[@]}"; do
    IFS='|' read -r name _ _ langs <<<"$m"
    for l in $langs; do [ -s "$OUT/$name.$l.png" ] || { echo "missing: $name.$l.png" >&2; rc=1; }; done
  done
  exit "$rc"
fi

cd "$ROOT"
[ -f app/dist/reminder.gjs.mjs ] || { echo "no app/dist/reminder.gjs.mjs: run the build first" >&2; exit 1; }
mkdir -p "$OUT"
for m in "${MOTIFS[@]}"; do
  IFS='|' read -r name size view langs <<<"$m"
  for l in $langs; do
    locale="en_US.UTF-8"; [ "$l" = de ] && locale="de_DE.UTF-8"
    file="$OUT/$name.$l.png"
    rm -f "$file"
    cfg="$(mktemp -d)"
    # headless-run may exit non-zero even when the image is written, so the file is the verdict.
    env XDG_CONFIG_HOME="$cfg" REMINDER_APP_SIZE="${size%%x*} ${size#*x}" REMINDER_APP_VIEW="$view" \
      LC_ALL="$locale" LANG="$locale" LANGUAGE="$l" \
      timeout 170 "$HEADLESS" --size 1300x1000 --shot-delay 6 --window-shot "$file" -- \
      gjsify run app/dist/reminder.gjs.mjs gui --demo >/dev/null 2>&1 || true
    rm -rf "$cfg"
    if [ -s "$file" ]; then
      box="$(magick "$file" -alpha extract -threshold 99% -format '%@' info:)"
      magick "$file" -crop "$box" +repage -strip "$file"
      echo "ok   $name.$l.png"
    else
      echo "FAIL $name.$l.png" >&2
    fi
  done
done
