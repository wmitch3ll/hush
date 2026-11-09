#!/bin/sh
# All UI tests. Needs node, python3 + playwright (with chromium). From the repo root: sh tests/run.sh
set -e
cd "$(dirname "$0")/.."
for f in ui/*.js src-tauri/src/harden.js src-tauri/src/page.js src-tauri/src/tools.js; do node --check "$f"; done
out=$(mktemp)
{ node tests/vault.test.js; node tests/autopilot.test.js; node tests/sim.js; node tests/sim2.js; node tests/sim3.js; python3 tests/browser.py; } 2>&1 | tee "$out"
if grep -q '^FAIL' "$out"; then echo "Some UI tests failed"; exit 1; fi
