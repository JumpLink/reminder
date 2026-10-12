#!/usr/bin/env bash
# Opt-in live EDS check for the priorities model (docs/adr/0002). Builds the script, then runs it on
# a private session bus with private XDG dirs: the EDS services start empty and die with the bus,
# so the run never sees or changes the calendars of whoever runs it.
#
# Needs: gjsify, gjs, dbus-run-session, evolution-data-server (the same packages CI installs).
# Run from anywhere: `app/tests/integration/eds-roundtrip.sh`.
set -euo pipefail

app="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out="$app/dist/eds-roundtrip.gjs.mjs"
sandbox="$(mktemp -d)"
mkdir -m 700 "$sandbox/run"
# gvfs mounts a FUSE dir under XDG_RUNTIME_DIR; the cleanup must not decide the exit status.
trap 'fusermount -u "$sandbox/run/gvfs" 2>/dev/null || true; rm -rf "$sandbox" 2>/dev/null || true' EXIT

(cd "$app" && gjsify build tests/integration/eds-roundtrip.ts --app gjs --outfile "$out")

env -u DBUS_SESSION_BUS_ADDRESS \
  XDG_DATA_HOME="$sandbox/data" XDG_CONFIG_HOME="$sandbox/config" XDG_CACHE_HOME="$sandbox/cache" \
  XDG_RUNTIME_DIR="$sandbox/run" \
  dbus-run-session -- timeout 60 gjsify run "$out"
