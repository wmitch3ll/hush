# Hush — Reference Guide (read this INSTEAD of the source)

> Building it? Follow **BUILD_GUIDE.md** (step by step, per platform, with an error table).

Goal: find what to change and where, without opening big files.
Rule of thumb: run `tools/map.sh` (prints line numbers), then `sed -n 'A,Bp' file` for ONLY that range.
For the published demo page, change it with the Artifact tool, action "edit" (old_str/new_str), never a full rewrite.

## 1. Repo map
| Path | What it is | Size/Touch when |
|---|---|---|
| ui/index.html | Desktop chrome (left tab rail + top bar). Talks to Rust via window.__TAURI__ | desktop UI changes |
| ui/mobile.html | Mobile chrome (real app UI, no demo): bar top/bottom, tabs sheet, menu, settings, downloads. Receives native events via `window.__hushEvent(name,data)` (tabUrl, download, back) called by TabsPlugin.kt | mobile UI |
| src-tauri/src/blocker.rs | Shared blocking engine (adblock-rust wrapper) | filter logic, cosmetic JS, iOS rule shards |
| src-tauri/src/lib.rs | Entry point: AppState, `resolve()`, `toggle_shield`, builder wiring (desktop vs mobile via cfg) | new shared commands, state |
| src-tauri/src/desktop.rs | Desktop shell: window + chrome webview + tab child webviews, resize `relayout()`, all tab commands, nav gate, popup deny | desktop tab behaviour |
| src-tauri/src/mobile.rs | Mobile commands forwarding to the native plugin; iOS rule-shard push in `setup` | mobile command surface |
| src-tauri/src/store.rs | Persistent JSON store: settings, bookmarks, custom filters, allow list; list overrides dir | persistence, new settings |
| src-tauri/src/picker.js | Element picker injected on demand (desktop); returns via `hush-pick://` navigation | picker UX |
| src-tauri/src/ios_ffi.rs | C ABI used by Swift for cosmetic JS | iOS bridge |
| src-tauri/src/harden.js | Injected into every page: popup/open guard, param stripping, fingerprint tweaks | page-level hardening |
| src-tauri/src/intercept_win.rs | WebView2 subresource blocking (WebResourceRequested) | Windows blocking |
| src-tauri/src/android_jni.rs | JNI exports shouldBlock/cosmeticJs, global BLOCKER | Android blocking bridge |
| src-tauri/src/tabs_plugin.rs | Mobile native-tab plugin facade (Rust side) | mobile tab API |
| src-tauri/ios-plugin/TabsPlugin.swift | WKWebView tabs, rule lists, popup deny, private store | iOS behaviour |
| src-tauri/android-plugin/*.kt | WebView tabs, shouldInterceptRequest, discardBackground | Android behaviour |
| src-tauri/tauri.conf.json | App id, `withGlobalTauri`, CSP, NO windows (desktop creates its own in code) | packaging |
| src-tauri/tauri.android.conf.json, tauri.ios.conf.json | Mobile config window `main` loading `mobile.html` | mobile entry page |
| src-tauri/capabilities/{default,mobile}.json | IPC scope: desktop = only webview `chrome`; mobile = window `main` | security perms |
| src-tauri/icons/source.png | 1024px icon source; `cargo tauri icon icons/source.png` generates the rest | branding |
| BUILD_GUIDE.md | Step-by-step build/run/release instructions + common-error table | when build steps change |
| tools/android-post-init.sh, tools/ios-post-init.sh | Install Kotlin/Swift plugin into generated mobile projects (+R8 rules, manifest) | mobile setup |
| .github/workflows/ci.yml | CI: tests + debug APK | CI changes |
| tools/setup.sh, tools/fetch-lists.sh, tools/map.sh | First-time setup / download real lists / outline of mobile.html | workflow |
| src-tauri/lists/*.txt | Filter lists (placeholders: replace with real EasyList/EasyPrivacy) | list updates |
| README.md | Architecture, build steps, iOS/Android limits | docs |

## 2. mobile.html — where things live
Single file, three blocks: `<style>` (CSS) → `<body>` (HTML) → `<script>` (JS). Use grep anchors below.

### Design tokens (grayscale only) — grep `:root{--bg`
`--bg` page, `--card` surfaces, `--line` hairlines, `--ink` text/icons, `--mute` secondary, `--acc` primary (black/white),
`--glow` focus ring, `--bad` unused-gray. Three places hold values: light `:root{`, dark `:root:not([data-theme="light"])`,
forced dark `:root[data-theme="dark"]`. Private tabs: `body.priv{`. Change all of them together.

### Size/shape knobs
| Want to change | Grep anchor | Current |
|---|---|---|
| Address pill height/radius | `#pill{` | height 34px, radius 12px |
| Address text size | `#url{` | 14px |
| Icon button size | `.ib{` | 28px; svg 16px (`.ib svg`) |
| Tab counter size | `#tabs-btn{` | 28px, 1.5px border, radius 8px |
| Top bar padding/hairline | `#top{` | 6px 10px 8px, 1px bottom line |
| Load progress line | `#bar{` | 1px |
| Shield badge | `#cnt{` | 9px, 14px tall |
| Shield "off" look | `#shield.off{` | opacity .4 |
| Start page wordmark | `.home h1{` | 64px, weight 200 |
| Bookmark tiles | `.bm i{` | 54px circle, monogram = first letter |
| Tab cards | `.card{` / `.card.cur{` | radius 16, min-height 120 |
| Buttons / menu rows | `.btn{` / `.menu button{` | radius 12 |
| Toast | `#toast{` | pill |
| Sheet animation | `.sheet.on{` / `@keyframes up` | .22s slide-up |

### HTML ids (grep `id="x"`)
`top` bar · `pill` address pill · `shield` (+ `cnt` badge) · `url` input · `reload` · `tabs-btn` · `menu-btn` · `bar` progress ·
`view` page area · `switcher` (+ `cards`, `priv-toggle`, `new-tab`, `close-sw`) · `menu` (+ `m-back` `m-fwd` `m-priv` `m-clear`
`m-theme` `theme-lbl` `m-sound` `m-close`) · `toast`.
Icons are inline SVG inside `.ib` buttons (stroke=currentColor, so they follow `--ink`). Add icons the same way.

### JS functions (grep `function name`)
| Function | Does |
|---|---|
| `newTab(url,isPriv)` / `select(id)` / `closeTab(id)` | tab lifecycle; state in `tabs[]`, `cur` |
| `resolve(v)` | address-bar text → https URL or DuckDuckGo search (HTTPS-first) |
| `go(v,push)` / `step(d)` | navigate / back-forward within a tab's `hist[]` |
| `load()` | RENDERS the current page into `#view` and updates shield/badge/tab count. Page demos live here (`hush://new`, daily/news, search, generic) |
| `popup()` | demo popup: blocked (toast) if shield on, fake modal if off |
| `drawCards()` | tab switcher; "asleep" after 15s inactivity (demo of discard) |
| `show(id)` | opens/closes sheets `switcher`/`menu` |
| `progress()` / `toast(t)` | load line / message |
State: `shieldOff` Set of hosts; `priv` next-tab-private flag; `themeI` theme index; `BM` bookmark array [glyph,name,host].
Gestures: edge-swipe back = `touchstart/touchend` block near end of script. Shortcut: Ctrl/Cmd+L.

## 3. Wiring mobile.html to the real app (not done yet)
Replace demo logic with Tauri calls (`window.__TAURI__.core.invoke`): `newTab→open_tab`, `go→navigate`, `step→nav{action}`,
`select→switch_tab`, `closeTab→close_tab`, shield click→`toggle_shield{host}`, clear→`clear_data`. On mobile the native
plugin (tabs_plugin.rs → Swift/Kotlin) owns web views; chrome UI stays in this page. Keep `load()`'s demo renderers only for `hush://new`.

## 4. Rust core API (blocker.rs)
`Blocker::from_lists(lists,custom)` build · `reload(...)` hot-swap · `check_request(url,source,type)->bool` block?
· `cosmetic_js(page_url)->String` CSS+scriptlets · `webkit_rules()/webkit_rule_shards()` Safari JSON (≤40k rules/shard,
+block-cookies +make-https) · `allow_sites` per-site shield allowlist · `is_allowed_site(host)`.
Resource type strings: script image stylesheet xmlhttprequest media font document websocket other.

## 5. Tauri commands exposed to chrome UI (desktop.rs / mobile.rs; `toggle_shield` in lib.rs)
`open_tab(input)->label` · `switch_tab(label)` · `close_tab(label)` · `navigate(input)` · `nav(action: back|fwd|reload)` ·
`toggle_shield(host)` · `clear_data()`. Shared (lib.rs): `toggle_shield(host)` · `get_state()` · `set_setting(key,value)` · `bookmark_add(title,url)` · `bookmark_remove(url)` · `add_custom_filter(filter)` · `export_data()` · `import_data(json)` · `update_lists()`. Desktop only: `start_picker()`. Mobile only: `set_chrome_inset(px)`.
All commands are `async` on purpose (sync commands run on the main thread → webview creation / plugin calls can deadlock). Desktop and mobile expose the SAME names; edit both when changing a signature.
Layout (desktop.rs): no constants. ui/index.html `layout()` places the address bar + tab bar (any side, auto-hide or pinned, density) and calls `set_layout{top,right,bottom,left}`; `relayout()` sizes tab webviews to what's left. `show_content(false)` hides tabs while a chrome panel (Settings/Downloads) is open. UI prefs persist as `set_setting('ui.<name>', value)` → `Settings.ui` map. Windows: `intercept_win::install_shortcuts` catches Ctrl+T/W/L/D/B/J/,/Tab natively and emits `shortcut{key}` to the chrome.
Hooks inside `open_tab`: `.on_navigation` (block/https gate), `.on_new_window` (deny), `.on_page_load` (cosmetic eval), `.initialization_script(harden.js)`.

## 6. Common tasks → exact place
| Task | Where |
|---|---|
| Make address bar smaller/larger | mobile.html `#pill{` height, `#url{` font-size, `.ib{` |
| Change icon | the `<svg>` inside that button's HTML (ids above) |
| Add a menu item | HTML inside `id="menu"` + handler `$("#m-xxx").onclick` near the other `m-` handlers |
| Change colors | tokens in 3 places (+ `body.priv`) |
| Change default search engine | `resolve()` in mobile.html AND `resolve()` in lib.rs |
| Add tracking param to strip | harden.js list |
| Allow gesture-triggered popups | harden.js `window.open` line; lib.rs `.on_new_window` |
| Add/replace filter lists | src-tauri/lists/, `load_lists()` in lib.rs |
| Block more on Windows/Android | intercept_win.rs `kind()` / TabsPlugin.kt type inference |
| iOS rule limits | `webkit_rule_shards` chunk size in blocker.rs |

## 7. ROADMAP — everything still needed
Legend: P0 = blocks everything, P1 = core promise, P2 = usable product, P3 = ship/harden. `[ ]` open, `[~]` partial, `[x]` done.
Each item: ID · what · where · done when.

### P0 — Make it build and run
STATUS (this session): code and config were repaired by hand, but the authoring sandbox has NO Rust toolchain and NO network, so nothing could be compiled. Run `tools/setup.sh` on a dev machine; it does icons, lists, `cargo update`, `cargo check`, `cargo test` and tells you what is left.
- [~] R-01 Project shell. Done: tauri.conf.json fixed (`withGlobalTauri`, CSP with `ipc:`, no config windows on desktop), per-platform mobile configs, scoped capabilities, icon source, setup script. Left: run `cargo tauri icon icons/source.png`; `cargo tauri android init` / `ios init` (needs SDKs). Done when: `cargo tauri dev` opens a window.
- [~] R-02 Crate versions. Written, unverified: `adblock = "0.10"` with `default-features = false` (CHECK: this may drop features the engine needs, e.g. regex handling; try default features first if `cargo check` complains), `webview2-com 0.38` / `windows 0.61` (must match `cargo tree -i webview2-com`), `jni 0.21`. Done when: `cargo check` passes on host + each target.
- [~] R-03 Tauri API existence. `on_new_window` now behind cargo feature `new-window-api` (default on); turn off if the pinned Tauri lacks it (harden.js then only covers `window.open`, not `target=_blank`). Still verify `Window::add_child`/`webviews()`, `Webview::clear_all_browsing_data`, `WindowBuilder` (all need tauri feature `unstable`).
- [~] R-04 Filter lists. `tools/fetch-lists.sh` downloads EasyList + EasyPrivacy (needs network); placeholders remain until run. uBO lists commented in the script. Check licences (R-60).
- [ ] R-05 First compile fixes: blocker.rs adblock calls (`Engine::from_filter_set`, `url_cosmetic_resources` fields, `into_content_blocking`), intercept_win.rs windows-crate types (`EventRegistrationToken`, `PWSTR`), mobile `run_mobile_plugin` generics. Unit tests exist in blocker.rs (7, `cargo test`) to prove blocking/exception/cosmetic/shards once it compiles.
- [~] R-06 Resize: `relayout()` in desktop.rs now runs on `WindowEvent::Resized`. Untested.
- [x] R-07 Structural bugs fixed: capability scope no longer covers tab webviews (was `windows:["main"]`, now `webviews:["chrome"]`); duplicate chrome/main webview removed; mobile no longer compiles desktop-only multiwebview code; commands made async; unique tab ids via counter; mobile loads `mobile.html`.
- [ ] R-08 Verify on first run: a remote tab page cannot call `window.__TAURI__.invoke` (open devtools on a tab, expect undefined/denied).

### P1 — Blocking completeness (the headline feature)
- [~] R-10 Windows subresource blocking (intercept_win.rs written, untested). Done: ads on a test page never hit the network (check with devtools/proxy).
- [ ] R-11 macOS desktop: compile `Blocker::webkit_rule_shards` into WKContentRuleList via `Webview::with_webview` (objc2) and attach to each tab. Where: new src-tauri/src/intercept_apple.rs shared with iOS desktop path.
- [ ] R-12 Linux desktop: WebKitGTK `WebKitUserContentFilterStore` with the same JSON (webkit2gtk crate through `with_webview`). Where: new intercept_linux.rs.
- [~] R-13 Android request typing: infer resource type from `Accept`/`Sec-Fetch-Dest` headers instead of file extension; compute third-party flag. Where: TabsPlugin.kt `shouldInterceptRequest`. **STATUS:** Kotlin `kindOf()` uses Accept header + extension; no Sec-Fetch-Dest on Android, so still approximate. Untested.
- [~] R-14 iOS cosmetic reply path: Rust must listen for the plugin's `cosmetic` event, call `Blocker::cosmetic_js(url)`, and send it back to evaluate in the web view. Where: tabs_plugin.rs + TabsPlugin.swift `didCommit`. Add early injection via WKUserScript for generic hides. **STATUS:** Done via C ABI: `ios_ffi.rs` exports `hush_cosmetic_js/hush_free`; Swift `didCommit` calls them (`@_silgen_name`) and evaluates the result. Untested; early WKUserScript injection for generic hides still TODO.
- [ ] R-15 Scriptlets and resources: bundle uBO `resources` (scriptlets, redirect stubs) and feed to `Engine::use_resources`. Needed for YouTube/anti-adblock sites. Where: blocker.rs + lists/resources.
- [ ] R-16 (generic `##sel` hiding now done in blocker.rs `generic_css()`: one CSS rule per selector, `#@#` exceptions honored, skipped on `$generichide`) Procedural cosmetic filters (`:has-text`, `:xpath`, `:upward`): ship a small JS runtime injected with cosmetic_js. Not possible via iOS content rules, so JS only.
- [ ] R-17 Exceptions and options: `$badfilter`, `$important`, `@@||x^$document`, `$elemhide/$generichide`, `$removeparam`, `$redirect`. Verify engine honors them; add tests.
- [~] R-18 Popup policy upgrade: allow window.open only with a real user gesture and same-site; keep deny for ad/redirect chains. Where: harden.js, `.on_new_window`, TabsPlugin.swift `createWebViewWith`, TabsPlugin.kt `onCreateWindow`. Add per-site "allow popups". **STATUS:** harden.js: real clicks on `target=_blank` / same-origin `window.open` now open IN PLACE; everything else denied. Native `on_new_window`/`createWebViewWith`/`onCreateWindow` deny. No per-site "allow popups" yet.
- [ ] R-19 Third-party cookie blocking on desktop: set WebView2 tracking prevention to Strict; WebKit ITP is on by default; Android `setAcceptThirdPartyCookies(false)` already set (verify).
- [~] R-20 HTTPS-first done properly: currently `http:` navigations are just cancelled (dead end). Upgrade to https, on failure show a local "this site only supports http" interstitial with a one-time proceed button. Where: lib.rs `on_navigation`, new ui/interstitial.html. **STATUS:** http → https auto-upgrade on desktop (`on_navigation` re-navigates) and Android (`shouldOverrideUrlLoading`); iOS via `make-https` rule. Desktop now has a loop guard: if a site redirects back to http, navigation stops and the UI toasts “no secure version”. STILL MISSING: interstitial with one-time proceed.
- [ ] R-21 Fingerprint resistance review: harden.js overrides are cheap and incomplete; decide the set (canvas noise? UA reduction? referrer trimming) and test breakage.
- [~] R-22 Blocked counter: increment real counts from Rust per tab and push to UI (event `blocked{tab,count}`); off by default on mobile. **STATUS:** Per-tab counter in Rust (`Blocker::bump`), emitted as event `blocked{tab,count}` from the Windows hook; reset on page load; desktop UI shows it as the shield tooltip. Not yet on macOS/Linux/Android/iOS (those hooks don’t count). `settings.counter` stored but not yet used by the UI.
- [~] R-23 Per-site allow list persistence + UI (currently in-memory `allow_sites`). Store in settings file. **STATUS:** Allow list persisted in store.json and restored at startup; mobile bridge restores `shieldOff`. No management list UI.

### P2 — Make it a usable product
- [~] R-30 Wire ui/mobile.html and ui/index.html to Rust (see section 3). Remove demo renderers except start page. **STATUS:** `ui/bridge.js` (loaded by `ui/mobile.html`) maps open/navigate/back/forward/reload/switch/close/shield/clear/bookmark/update-lists to Rust commands; falls back to demo in a plain browser. Untested on device. Desktop `index.html` already used commands.
- [~] R-31 Native → UI events: url, title, loading progress, canGoBack/Forward, favicon-less tab labels, find results. Where: lib.rs `app.emit`, plugin `trigger()`, UI `listen()`. **STATUS:** Desktop emits `tab-url{tab,url,state}` (started/finished) and `https-failed{tab,url}` to the `chrome` webview; index.html shows the real URL, lock, loading line, per-tab host shield. Title/canGoBack/mobile still TODO.
- [~] R-32 Mobile layout offsets: native web view frame must sit below the top bar (measure chrome height, include safe area); Android/iOS keyboard handling. **STATUS:** `set_chrome_inset` command + Swift/Kotlin `setTopInset`; bridge measures `#top` and sends it. Bottom inset/keyboard not handled.
- [ ] R-33 Mobile chrome as a real UI layer: decide overlay approach (chrome webview over native view vs native top bar). iOS: top chrome webview + content web view; Android: same via view hierarchy.
- [~] R-34 Settings store (JSON file in app data dir): search engine, theme, blocking strength, list toggles, counter on/off. New src-tauri/src/settings.rs + settings sheet in UI. **STATUS:** `store.rs` + commands `get_state`, `set_setting` (search, custom_search, theme, counter). No settings sheet in the UI yet. **STATUS:** Settings sheet added in `ui/bridge.js` (menu → Settings): search engine, counter toggle, custom filters, shield exceptions, export/import. Theme still in the menu.
- [x] R-35 Search engine choice (DDG default, Brave, Startpage, custom). Single `resolve()` shared by Rust and UI (currently duplicated). **STATUS:** Single `resolve_with()` in lib.rs uses the chosen engine (DDG, Brave, Startpage, Ecosia, custom `https://…%s`). `ui/mobile.html` `resolve()` still hard-codes DDG for the offline demo only; native path goes through Rust.
- [~] R-36 Bookmarks: local JSON/SQLite, folders, HTML + JSON import/export. New bookmarks.rs + UI sheet; start-page grid reads it. **STATUS:** Backend: `bookmark_add/remove`, persisted; mobile menu has “Bookmark this page”; start page tiles read them. No folders UI, no HTML import/export yet.
- [ ] R-37 History (optional, off by default) and address-bar suggestions from bookmarks only.
- [~] R-38 Downloads: WebView2 `DownloadStarting`, WKDownload (iOS 14.5+), Android `DownloadListener`; progress list, open file/folder, clear completed. **STATUS (desktop):** `on_download` in desktop.rs saves to the OS Downloads folder (safe unique names), emits `download{state:started|done|failed}`; UI panel (Ctrl+J) with Open / Show in folder (`download_open`/`download_reveal`, only for files Hush downloaded; executables are only revealed, never launched). No byte progress yet (Tauri gives start/finish only).
- [ ] R-39 Clear data for real, per platform: WebView2 `ClearBrowsingData`, WKWebsiteDataStore.removeData, Android WebStorage/CookieManager; confirmation already in UI.
- [ ] R-40 True private mode on desktop: separate ephemeral data dir (WebView2 `--InPrivate`/temp user-data folder, WebKitGTK ephemeral context, macOS nonPersistent), delete on close. iOS/Android partly written.
- [~] R-41 Element picker: inject picker JS (desktop right-click, mobile long-press) → generate cosmetic filter → save to custom list → rebuild a small "user" shard only. Where: new picker.js, blocker.rs `custom`. **STATUS:** Desktop only: `picker.js` + `start_picker` + ✂ button; result returns through a `hush-pick://` navigation intercepted in `on_navigation` → `add_filter` (persists, rebuilds engine). Mobile long-press picker NOT done (needs per-platform URL interception → Rust).
- [~] R-42 Filter list manager + user-controlled updater: fetch over HTTPS, show last-updated, verify size/hash, hot-swap with `Blocker::reload`, rebuild iOS shards. Add `ureq` (rustls) only; no background fetching. **STATUS:** `update_lists` command (user-triggered, ureq/rustls, sanity checks, hot-swap, iOS shard rebuild) + mobile menu button. Missing: checksum verification, list manager UI, uBO lists, last-updated display.
- [~] R-43 Export/import settings + custom filters (single JSON file). **STATUS:** `export_data` / `import_data` (merge) commands exist; no UI buttons / file picker yet. **STATUS:** Export (copies JSON to clipboard) / Import (paste JSON) wired in the Settings sheet; no file picker.
- [~] R-44 Desktop extras: find-in-page, zoom, keyboard map (Ctrl+T/W/L/R/Tab, Alt+Left), tab reorder, session restore (opt-in). **STATUS:** Ctrl+T/W/L/R/D, Ctrl+(Shift+)Tab, Alt+Left/Right done in index.html. Find, zoom, reorder, restore TODO.
- [ ] R-45 Mobile tab discard: Android done in plugin (needs onTrimMemory + timer hook); iOS release background WKWebViews and keep URL/scroll; desktop optional suspend.
- [ ] R-46 Start page: bookmark grid from storage, remove the demo tiles.
- [x] R-47 Desktop UI polish to match mobile grayscale/sleek pass (DONE: grayscale tokens shared with mobile, SVG icons, bookmark start grid, toast, a11y labels.)
- [ ] R-48 About screen + licences viewer.

### P3 — Platform packaging and hardening
- [ ] R-50 Windows: MSI/NSIS, WebView2 runtime bootstrapper, code signing.
- [ ] R-51 macOS: signing, notarization, minimum 11.0, hardened runtime.
- [ ] R-52 Linux: deb/AppImage, webkit2gtk-4.1 dependency docs, Wayland/X11 checks.
- [ ] R-53 Android (see the APK group R-70–R-85 for the step-by-step): minSdk 26, signing, AAB, ProGuard/R8 keep rules for JNI (`Native`) and plugin, edge-to-edge insets, back-gesture handling, WebView version check (`WebViewCompat.getCurrentWebViewPackage`) with graceful degradation.
- [ ] R-54 iOS/iPadOS: bundle id, signing, entitlements, verify PrivacyInfo.xcprivacy, iPad split layout, Dynamic Island insets, App Review notes (WKWebView only, no private APIs). Default-browser entitlement requires Apple approval; document it.
- [~] R-55 Security audit: capabilities (only `chrome` webview has IPC; add a test that a remote page cannot `invoke`), CSP review, address-bar scheme allowlist (block `javascript:`, `file:`, `intent:`), deny-by-default permissions (camera, mic, geolocation, notifications, clipboard-read), WebRTC IP-leak policy, no certificate-error bypass, referrer trimming, download safety. **STATUS:** desktop tab navigation scheme allowlist (http/https/about/blob/data only; file:, javascript:, intent:, tauri:, ipc: refused); element-picker `hush-pick://` only accepted for the tab's current host; `import_data` validates bookmarks (web URLs), filters, hostnames. Permissions/WebRTC TODO.
- [ ] R-56 Dependency hygiene: `cargo audit`, `cargo deny`, lockfile committed, reproducible build notes.
- [ ] R-57 Update strategy: user-initiated update check only (or none); document in About.

### P3 — Quality, performance, release
- [ ] R-60 Licences: choose project licence; check adblock-rust (MPL-2.0), EasyList (GPLv3/CC BY-SA) and uBO lists (GPLv3) redistribution terms; add THIRD_PARTY_NOTICES.
- [ ] R-61 Blocker unit tests with known filter/URL pairs; benchmark engine load time and memory with full lists; serialize/deserialize the engine to skip parsing at startup (`Engine::serialize`).
- [ ] R-62 Performance budgets: cold start < 1s, idle memory target per platform, battery check on phones; measure and record.
- [ ] R-63 Site compatibility checklist (news, video, shopping, login/SSO, banking) with a local "breakage → disable shield for this site" flow.
- [ ] R-64 Accessibility: VoiceOver/TalkBack labels on icon buttons (SVG buttons currently use `title` only), contrast, text scaling.
- [~] R-65 CI: GitHub Actions matrix (win/mac/linux/android/ios) building and running blocker tests. **STATUS:** `.github/workflows/ci.yml` runs cargo test on 3 OSes + builds a debug APK artifact. Unverified; versions (NDK) may need bumping.
- [ ] R-66 Update README.md and this guide when items land; keep section 2 anchors current.

### APK — from source to an installable Android app (milestones M1–M5)
Milestones: **M1** debug APK installs and shows the chrome UI · **M2** tabs load real pages · **M3** blocking + popup deny verified on device · **M4** signed release APK (sideload) · **M5** AAB for Play. Do R-70→R-74 first; they are the quickest path to something you can tap.
- [ ] R-70 Toolchain (host machine, one time): JDK 17 (`JAVA_HOME`), Android Studio or cmdline-tools, SDK platform 34+, build-tools, **NDK** (`ANDROID_HOME`, `NDK_HOME`), and Rust targets `aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android` (tools/setup.sh adds the targets). Done when: `cargo tauri info` shows Android environment green.
- [ ] R-71 Generate the Android project: `cd src-tauri && cargo tauri android init` → creates `gen/android/` (Gradle project, MainActivity, manifest). Commit `gen/android/` (our edits live there). Set `bundle.android.minSdkVersion = 26` in tauri.conf.json (or tauri.android.conf.json).
- [~] R-72 **Install the native plugin code into the Gradle project.** Right now `src-tauri/android-plugin/*.kt` are loose files that nothing compiles. Either (a) copy `Native.kt` + `TabsPlugin.kt` into `gen/android/app/src/main/java/app/hush/browser/` (quickest), or (b) turn them into a proper Tauri plugin crate (`tauri-plugin` build.rs + `android/` library module). Also add `@InvokeArg` (from `app.tauri.annotation`) to the `Args`, `IdArgs`, `NavArgs` classes — Tauri 2 requires it for `parseArgs`. Done when: `register_android_plugin("app.hush.browser","TabsPlugin")` finds the class at runtime (no ClassNotFoundException in logcat). **STATUS:** `@InvokeArg` added to Kotlin arg classes. Still: copy `android-plugin/*.kt` into `gen/android/.../app/hush/browser/` after `android init`.
- [ ] R-73 First debug APK (M1): `cargo tauri android build --debug --apk --target aarch64` (use `--target x86_64` for an emulator). Output: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk` (path may vary by Tauri version; search `build/outputs/apk`). Install: `adb install -r <apk>`. Live dev loop: `cargo tauri android dev`. Done when: app opens on a device/emulator showing mobile.html.
- [ ] R-74 Fix first-run crashes using `adb logcat | grep -iE "hush|tauri|WebView|FATAL"`. Likely: JNI symbol mismatch (`Java_app_hush_browser_Native_*` must match package + class), library name (`System.loadLibrary("hush_lib")` must equal the Cargo `[lib] name`), missing `@InvokeArg`, adblock engine load time on the main thread (move to a background thread / use serialized engine, R-61).
- [~] R-75 **Tab layout on Android (needed for M2):** `TabsPlugin.show()` adds a full-screen WebView over `android.R.id.content`, which hides the chrome bar. Reserve top space for the chrome (measure the chrome height in px and pass it via a plugin command, apply as top margin + status-bar inset) and handle the keyboard. Same work as R-32/R-33. **STATUS:** `topMargin` from `set_chrome_inset` applied to native WebViews (see R-32). Keyboard + nav-bar insets TODO.
- [ ] R-76 Wire mobile.html to Rust commands (R-30) and verify on device: open tab, navigate, back/forward, switch, close, shield toggle, clear data.
- [ ] R-77 Verify blocking on device (M3): load a known ad-heavy test page; confirm `shouldInterceptRequest` returns 403 for blocked hosts (logcat counter or a debug toast), popups denied (`onCreateWindow` false), cosmetic CSS applied, third-party cookies off. Needs real lists (R-04) and the JNI global `BLOCKER` set before the first request.
- [~] R-78 Android manifest/security hardening in `gen/android/app/src/main/AndroidManifest.xml`: only `INTERNET` (+ `POST_NOTIFICATIONS` only if downloads need it), `android:usesCleartextTraffic="false"`, `android:allowBackup="false"`, no exported components except the launcher activity, `networkSecurityConfig` that forbids user-installed CAs for release, adaptive icon + app name. **STATUS:** Post-init script adds INTERNET permission and `allowBackup=false`. Cleartext/network-security-config still TODO.
- [~] R-79 Release build config: R8/ProGuard keep rules in `gen/android/app/proguard-rules.pro` — keep `app.hush.browser.Native` (native methods), `TabsPlugin`, all `@InvokeArg` classes; keep line numbers for crash reading. Enable minify + resource shrinking; strip Rust symbols (already `strip=true`, `opt-level="s"`, `lto`). **STATUS:** `tools/android-post-init.sh` appends keep rules for Native/TabsPlugin/@InvokeArg/native methods. Minify/shrink flags not enabled yet.
- [ ] R-80 Signing (M4): create a keystore once (`keytool -genkeypair -v -keystore hush-release.jks -alias hush -keyalg RSA -keysize 4096 -validity 10000`), store it OUTSIDE the repo, add `keystore.properties` (gitignored) and a `signingConfigs.release` in `gen/android/app/build.gradle.kts`. Build: `cargo tauri android build --apk --target aarch64 --target armv7`. Unsigned fallback: `zipalign -p 4 in.apk aligned.apk` then `apksigner sign --ks hush-release.jks aligned.apk`, verify with `apksigner verify --print-certs`. BACK UP the keystore: losing it means you can never update the app for existing installs.
- [ ] R-81 Size/ABI strategy: per-ABI APKs (arm64-v8a for modern phones; armeabi-v7a optional; x86_64 for emulator only) instead of one universal APK; record the APK size and cold-start time as budgets (R-62).
- [ ] R-82 Device matrix test: Android 8.0 (API 26) emulator with an old System WebView, a current phone, a low-RAM device. Check WebView version gating (R-53), background-tab discard via `onTrimMemory`, back gesture/button (WebView back → tab close → exit), rotation, split-screen, dark mode.
- [ ] R-83 Versioning: set `versionCode`/`versionName` (Tauri `version` in tauri.conf.json drives them; bump per release). Add an in-app About with version and licences (R-48).
- [ ] R-84 Distribution (M5): sideload APK via GitHub Releases/F-Droid-style repo (publish SHA-256 of the APK), and/or Play Store: `cargo tauri android build --aab`, Play App Signing enrollment, privacy policy (no data collected), Data Safety form = "no data collected", target the current required targetSdk.
- [ ] R-85 CI for APK: GitHub Actions job (JDK 17 + Android SDK/NDK + Rust targets) running `cargo tauri android build --apk`, uploading the artifact; keystore via encrypted secrets, never committed.

Quick path to a tappable build: R-70 → R-71 → R-72 → R-73 → R-74 (debug APK, M1). Then R-75/R-76 (M2) → R-77 (M3) → R-78→R-80 (M4).

### Suggested order
R-01→R-08 (build; tools/setup.sh) → R-10, R-14, R-30/31/32 (one platform end-to-end) → R-11/12/13 → R-15→R-17 → R-20, R-18 → R-34→R-36, R-39/40 → R-38, R-41, R-42 → polish R-47 → APK milestones R-70→R-85 (can start right after P0) → packaging R-50→R-54 → audit R-55→R-57, R-60→R-66.

### Known risks
Tauri multi-webview is unstable and desktop-only; iOS cannot intercept per request (rule-list limits); Android WebView versions vary; scriptlet support depends on R-15/R-16; none of the Rust/Swift/Kotlin has been compiled.

## 8. Editing discipline (saves tokens)
1. Read this file. 2. `tools/map.sh` → pick line range. 3. `sed -n` that range only. 4. Patch with small edits.
5. After changes that move things, update the relevant table above (anchors are strings, so most edits need no doc change).
