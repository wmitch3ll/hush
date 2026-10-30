#!/bin/sh
# One-shot first-time setup (run from repo root, needs network + Rust + Node-free). Safe to re-run.
set -e
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android 2>/dev/null || true
cargo install tauri-cli --version "^2" --locked
./tools/fetch-lists.sh
cd src-tauri
cargo tauri icon icons/source.png          # generates all icon sizes from the 1024px source
cargo update                                # resolve latest compatible versions
cargo check                                 # desktop compile check (R-02/R-05)
cargo test                                  # blocker unit tests
echo "Desktop OK. Mobile: cargo tauri android init | cargo tauri ios init, then see README."
