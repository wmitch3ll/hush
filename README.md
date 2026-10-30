# Hush — architecture (v0 scaffold)

## Layout
Window = one local "chrome" webview (ui/index.html, the only webview with IPC capability)
         + one child webview per tab (remote content, ZERO IPC permissions).
Rust core (blocker.rs) is shared by all platforms.

## Blocking flow
| Layer | Windows | macOS/iOS | Linux | Android |
|---|---|---|---|---|
| Navigation gate | on_navigation → Blocker | same | same | same |
| Popups | on_new_window deny + harden.js | same | same | same |
| Subresources | WebView2 WebResourceRequested (TODO, via with_webview) | WKContentRuleList from Blocker::webkit_rules() | WebKitGTK UserContentFilter (same JSON) | WebViewClient.shouldInterceptRequest → JNI → Blocker::check_request (TODO) |
| Cosmetic | eval CSS+scriptlets at page start | same (or WKUserScript) | same | same |

iOS limits: no per-request callback in WKWebView, so rules are static JSON (~150k rule cap per list;
split into several lists). Scriptlets and procedural cosmetic filters (:has-text etc.) are best-effort.

## Build
  cargo install tauri-cli --version "^2"
  First time: ./tools/setup.sh   (icons, real lists, cargo check/test)
  Desktop:  cd src-tauri && cargo tauri dev | cargo tauri build
  Android:  cargo tauri android init && cargo tauri android build   (needs SDK/NDK, JDK 17)
  iOS:      cargo tauri ios init && cargo tauri ios build            (macOS + Xcode)
Put real filter lists in src-tauri/lists/ first.

## Known gaps
- Never compiled in the authoring sandbox (no network). Expect API-name fixes on first build.
- Tauri multi-webview is unstable and desktop-only; mobile tabs need a small native plugin
  (one WKWebView/WebView per tab) driven by the same Rust core.
- Windows/Android subresource hooks, element picker, downloads, bookmarks, private mode: not yet written.

---
# v0.2 additions

## Windows (done in code): intercept_win.rs
WebView2 WebResourceRequested with a "*" filter -> Blocker::check_request -> synthetic 403 before any socket opens.

## Mobile tabs
Desktop tabs = child webviews (Tauri unstable). Mobile = native plugin, one WKWebView/WebView per tab,
only ONE attached to the view hierarchy at a time. Chrome UI is a thin bottom bar (build the mobile
layout of ui/index.html: bottom address pill, thumb-reach tab switcher sheet, no FAB).
Android: discardBackground() destroys inactive WebViews (saveState bundles kept) -> call on onTrimMemory
and after 5 min in background. iOS: only the active WKWebView is in the hierarchy; background ones are
released via closeTab-like discard and reloaded from stored URL.

## iOS limits & workarounds (honest list)
1. No per-request callback -> static WKContentRuleList. Workaround: Rust compiles ABP/uBO syntax to
   Safari JSON (adblock-rust "content-blocking" feature), sharded <=40k rules, compiled once by WebKit.
2. Lost in conversion: $removeparam, $redirect, regex-heavy rules, procedural cosmetics (:has-text, :xpath),
   most scriptlets. Mitigation: scriptlet bundle injected at didCommit; expect brief flash.
3. Rule lists apply to subresources AND navigations, but not WebSocket content or service workers' internals.
4. 3rd-party cookies: "block-cookies" rule + ITP. HTTPS: "make-https" rule + upgradeKnownHostsToHTTPS.
5. Popups: WKUIDelegate createWebViewWith returns nil. Private mode: WKWebsiteDataStore.nonPersistent().
6. App Store: must use WKWebView (no custom engine); PrivacyInfo.xcprivacy included; no private APIs;
   disable isInspectable in release. Element picker saves a rule locally -> triggers recompile of a tiny
   "user" shard (cheap, ~ms) so edits don't recompile the big lists.
7. Dynamic updates: only on user action (store new JSON, recompile) — no background fetch needed.
## Android limits
- WebView version fragmentation: gate features on WebViewCompat.getCurrentWebViewPackage(); API 26 + old
  WebView may lack safe browsing/modern JS -> degrade cosmetic scriptlets only, blocking stays native.
- shouldInterceptRequest can't see POST bodies or distinguish some resource types well (we infer by extension).

## Building an APK (see REFERENCE.md R-70–R-85 for the full checklist)
  cd src-tauri
  cargo tauri android init                                   # once; commit gen/android
  # copy android-plugin/*.kt into gen/android/app/src/main/java/app/hush/browser/ (R-72)
  cargo tauri android build --debug --apk --target aarch64   # debug APK
  adb install -r gen/android/app/build/outputs/apk/universal/debug/*.apk
  cargo tauri android build --apk                            # release (needs signing config, R-80)
