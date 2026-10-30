#!/bin/sh
# Cheap outline of ui/mobile.html: prints line numbers for CSS rules, element ids and JS functions.
# Usage: tools/map.sh [file]   -> then `sed -n 'START,ENDp' file` to read only what you need.
F=${1:-ui/mobile.html}
echo "== CSS rules =="; grep -nE '^(:root|html|body|#|\.|h1|button|@media|@keyframes|\*)' "$F" | cut -c1-90
echo "== HTML ids =="; grep -noE 'id="[a-z-]+"' "$F" | sort -u -t: -k2
echo "== JS functions/handlers =="; grep -nE '^(function |const [A-Za-z]+=|let |\$\(")' "$F" | cut -c1-90
