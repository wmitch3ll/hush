#!/bin/sh
# Downloads real filter lists into src-tauri/lists/ (needs network). Re-run to update.
set -e; D="$(dirname "$0")/../src-tauri/lists"; mkdir -p "$D"
curl -fsSL https://easylist.to/easylist/easylist.txt        -o "$D/easylist.txt"
curl -fsSL https://easylist.to/easylist/easyprivacy.txt     -o "$D/easyprivacy.txt"
curl -fsSL https://secure.fanboy.co.nz/fanboy-cookiemonster.txt -o "$D/easylist-cookie.txt"   # cookie-consent banners
curl -fsSL https://ublockorigin.github.io/uAssets/filters/filters.min.txt     -o "$D/ubo-filters.txt"      # uBO (GPLv3)
curl -fsSL https://ublockorigin.github.io/uAssets/filters/quick-fixes.min.txt -o "$D/ubo-quick-fixes.txt"
# Optional extras (then add include_str! entries in lib.rs load_lists()):
# curl -fsSL https://ublockorigin.github.io/uAssets/filters/filters.min.txt -o "$D/ubo-filters.txt"
# curl -fsSL https://ublockorigin.github.io/uAssets/filters/privacy.min.txt -o "$D/ubo-privacy.txt"
echo "lists updated"; wc -c "$D"/*.txt
