# Hush — Build Guide (step by step)

Read this first. Everything here was written without a compiler, so expect to fix a few errors on the first build.
That is normal: the loop is **build → copy the first error → fix → repeat**. See section 9.

Order: **A. Desktop (do this first) → B. Android → C. iOS → D. Release builds.** Do not start B or C until A runs.

---
## 0. What you need to know
- Project root = the folder containing `src-tauri/`, `ui/`, `tools/`, `REFERENCE.md`.
- `REFERENCE.md` = map of the code + roadmap. `README.md` = architecture.
- Commands below are run from the project root unless they say `cd src-tauri`.

## 1. Install prerequisites (once)
**All systems:** Rust via https://rustup.rs (then restart the terminal), Git.

**Windows 10/11**
1. Visual Studio Build Tools 2022 → workload “Desktop development with C++”.
2. WebView2 Runtime (already on Windows 11; install “Evergreen” on Windows 10).
3. `rustup default stable-msvc`.
4. Use **Git Bash** for the `./tools/*.sh` scripts (or run the commands inside them by hand).

**macOS 11+:** `xcode-select --install`.

**Linux (Debian/Ubuntu):**
```
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## 2. Unpack and prepare
1. Unzip `hush.zip`, open a terminal in the `hush/` folder.
2. `./tools/setup.sh` — it installs the Tauri CLI, downloads EasyList/EasyPrivacy, generates icons, then runs `cargo check` and `cargo test`.
   - If it stops at `cargo check`, that is expected the first time: go to section 9.
   - Manual equivalent: `cargo install tauri-cli --version "^2" --locked`, `./tools/fetch-lists.sh`, `cd src-tauri && cargo tauri icon icons/source.png && cargo check && cargo test`.

---
## A. Desktop
1. `cd src-tauri && cargo tauri dev` — a window opens with the Hush interface.
2. Smoke test (tick each):
   - [ ] Type `example.com`, Enter → page loads in a tab (circle “1” on the left rail).
   - [ ] Type a phrase → search results from DuckDuckGo.
   - [ ] ＋ opens a second tab; click circles to switch; middle- or right-click a tab closes it (Ctrl+W too).
   - [ ] Back / forward / reload buttons work.
   - [ ] Visit an ad-heavy page: ads missing; the shield shows a blocked-count badge (Windows only for now).
   - [ ] Shield button toggles blocking for the site (reload to see the difference).
   - [ ] scissors button → click an element → Block → it disappears and stays hidden after reload.
   - [ ] `http://` addresses end up on `https://`.
   - [ ] Click a `target=_blank` link → opens in the same tab; no popup windows appear.
   - [ ] Open devtools on a tab page and check `window.__TAURI__` is **undefined** (remote pages must have no app access).
3. Run unit tests: `cargo test` (7 blocker tests should pass).
4. Desktop installer: `cargo tauri build` → output in `src-tauri/target/release/bundle/` (MSI/NSIS on Windows, .dmg/.app on macOS, .deb/.AppImage on Linux).

Known desktop gaps: real request blocking only exists on **Windows**. macOS/Linux currently block navigations + cosmetic only (roadmap R-11, R-12).

---
## B. Android (debug APK)
**B1. Install tools (once)**
1. Android Studio (includes SDK Manager). In SDK Manager install: Android SDK Platform 34, Build-Tools 34, **NDK (Side by side)**, Command-line Tools.
2. JDK 17 (Android Studio’s bundled `jbr` is fine).
3. Environment variables (restart the terminal after):
   - macOS/Linux (add to `~/.zshrc` or `~/.bashrc`):
     ```
     export JAVA_HOME=/path/to/jdk17
     export ANDROID_HOME=$HOME/Android/Sdk          # macOS: $HOME/Library/Android/sdk
     export NDK_HOME=$ANDROID_HOME/ndk/<version-folder>
     ```
   - Windows (PowerShell): `setx JAVA_HOME "C:\Path\to\jdk17"`, `setx ANDROID_HOME "%LOCALAPPDATA%\Android\Sdk"`, `setx NDK_HOME "%LOCALAPPDATA%\Android\Sdk\ndk\<version>"`.
4. Rust targets: `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`.
5. Check: `cd src-tauri && cargo tauri info` shows the Android section green.

**B2. Create and prepare the Android project**
```
cd src-tauri
cargo tauri android init            # creates gen/android
cd ..
./tools/android-post-init.sh        # copies Kotlin plugin, R8 keep rules, manifest hardening
```
(Re-run the post-init script whenever you edit `android-plugin/*.kt`.)

**B3. Build and install**
```
cd src-tauri
cargo tauri android build --debug --apk --target aarch64     # real phone
# emulator instead:  --target x86_64
adb install -r gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```
(If the path differs, run `find gen/android -name "*.apk"`.) Phone: enable Developer options + USB debugging, check `adb devices`.
Live dev loop: `cargo tauri android dev`.

**B4. Debug crashes**
`adb logcat | grep -iE "hush|tauri|WebView|FATAL|UnsatisfiedLink|ClassNotFound"`

**B5. Android smoke test**
- [ ] App opens showing the start page, address bar at the top.
- [ ] Enter `example.com` → the page appears **below** the top bar.
- [ ] Tab button → grid shows; opening it hides the page (sheet is visible), Done brings it back.
- [ ] Menu → Bookmark this page; start page shows the bookmark tile after restart.
- [ ] Menu → Update filter lists → “2 lists updated”.
- [ ] Ads blocked on a test page; popups blocked; shield toggle reloads the page.

**B6. Signed release APK (to share/sideload)**
1. Create a keystore once and keep it OUTSIDE the repo; back it up (you cannot update installed apps without it):
   `keytool -genkeypair -v -keystore ~/hush-release.jks -alias hush -keyalg RSA -keysize 4096 -validity 10000`
2. Create `src-tauri/gen/android/keystore.properties` (never commit):
   ```
   storeFile=/absolute/path/hush-release.jks
   storePassword=...
   keyAlias=hush
   keyPassword=...
   ```
3. In `src-tauri/gen/android/app/build.gradle.kts` add a `signingConfigs { create("release") { ... } }` block that reads those properties and set `buildTypes.release.signingConfig` to it (Tauri’s Android docs show the exact snippet under “Signing”).
4. Build: `cargo tauri android build --apk --target aarch64` → `.../apk/universal/release/…-release.apk`.
5. Verify: `apksigner verify --print-certs <apk>`; publish its SHA-256 next to the download.
6. Play Store later: `cargo tauri android build --aab`.

---
## C. iOS / iPadOS (needs a Mac)
1. Install Xcode (App Store), open it once, accept the license. `xcode-select -p` should print a path.
2. `rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios`
3. Apple ID in Xcode (Settings → Accounts). Free account = 7-day installs on your own device; paid ($99/yr) = TestFlight/App Store.
4. Team id: `export APPLE_DEVELOPMENT_TEAM=<your 10-char team id>` (or set `bundle.iOS.developmentTeam` in tauri.conf.json).
5. Create the project and install the plugin:
   ```
   cd src-tauri && cargo tauri ios init && cd ..
   ./tools/ios-post-init.sh
   ```
6. Run on a simulator/device: `cd src-tauri && cargo tauri ios dev` (pick a device when asked).
7. Smoke test: same as Android, plus swipe from the left edge = back, safe areas around the notch/Dynamic Island look right.
8. App Store build: `cargo tauri ios build` → open in Xcode (Product → Archive) → TestFlight. Check: privacy manifest included (section in script), no private APIs, `isInspectable` off in release.
9. Known iOS limits: static rule lists only; scriptlets/procedural filters limited (README, REFERENCE section 7).

---
## D. Release checklist (short)
- [ ] Real filter lists present (`./tools/fetch-lists.sh`); licences reviewed (R-60).
- [ ] `cargo test` green; smoke tests above pass on each platform.
- [ ] Version bumped in `tauri.conf.json`.
- [ ] Desktop: installers signed (Windows cert / macOS notarization).
- [ ] Android: signed APK/AAB; iOS: archived + TestFlight.

---
## 9. When the build fails (the loop)
1. Copy the **first** error (not the last; later ones are usually fallout).
2. Match it below, or send me the first ~30 lines of output plus the file/line it names.

| Error contains | Likely cause → fix |
|---|---|
| `no method named on_new_window` / `NewWindowResponse` | Tauri too old → `cargo update -p tauri`, or build with `--no-default-features` (turns off feature `new-window-api`) |
| `add_child`, `WindowBuilder`, `webviews` not found | Tauri feature `unstable` missing → keep `features=["unstable"]` in Cargo.toml |
| unknown feature `content-blocking` / `embedded-domain-resolver` | adblock’s feature names changed → look at its docs.rs features list; or remove `default-features = false` |
| `RefCell`/`cannot be shared between threads` on `Engine` | In blocker.rs change `RwLock<Engine>` to `parking_lot::Mutex<Engine>` and `.read()/.write()` to `.lock()` |
| `no method ... url_cosmetic_resources` / unknown field | adblock API drift → check docs.rs for the pinned version; adjust `cosmetic_js()` |
| `into_content_blocking` mismatched types | same; returns `(Vec<CbRule>, Vec<String>)` in recent versions |
| Windows: two versions of `webview2-com`/`windows` | `cargo tree -i webview2-com`; set the same versions in Cargo.toml `[target.'cfg(windows)'.dependencies]` |
| Windows: `EventRegistrationToken` mismatch | use the type the compiler suggests (`windows::Win32::System::WinRT::EventRegistrationToken`) |
| `include_str!` file not found (`lists/…`) | run `./tools/fetch-lists.sh` |
| icon file not found | `cd src-tauri && cargo tauri icon icons/source.png` |
| Android `ClassNotFoundException … TabsPlugin` | run `./tools/android-post-init.sh`, rebuild |
| Android `UnsatisfiedLinkError` | JNI names must match package `app.hush.browser` + class `Native`; library name `hush_lib` |
| Android Kotlin: unresolved `InvokeArg`/`Command` | plugin API package names differ by Tauri version → open generated `tauri-android` sources and match imports |
| iOS `Undefined symbol _hush_cosmetic_js` | build must be for iOS target (module `ios_ffi` is iOS-only); check LTO didn’t strip it (keep `#[no_mangle]`) |
| iOS: Swift can’t find `Plugin`/`Invoke` | plugin Swift API differs → compare with generated `gen/apple` Tauri package; consider converting to a proper plugin crate |

Still stuck? Tell me: OS, command run, the first error block. I’ll fix the code and update REFERENCE.md.
