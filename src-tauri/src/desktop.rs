//! Desktop shell: window + full-size "chrome" webview + one child webview per tab.
//! Commands are `async` on purpose: creating webviews from sync commands can deadlock on Windows.
use crate::{resolve_app, AppState};
use std::sync::atomic::Ordering;
use std::path::{Path, PathBuf};
use tauri::{webview::{DownloadEvent, PageLoadEvent, WebviewBuilder}, window::WindowBuilder, AppHandle, Emitter, LogicalPosition,
            LogicalSize, Manager, WebviewUrl, Window};

// Layout: the chrome UI (ui/index.html) decides where its bars go and reports the space it uses via `set_layout`.
// Tab webviews fill whatever is left. Nothing here hard-codes bar sizes or positions any more.

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    crate::init_state(app.handle());
    let win = WindowBuilder::new(app, "main").title("Hush").inner_size(1200.0, 800.0).build()?;
    let s = win.inner_size()?.to_logical::<f64>(win.scale_factor()?);
    // Every webview shares one engine environment, so the chrome uses the same extension setting as the tabs.
    win.add_child(
        WebviewBuilder::new("chrome", WebviewUrl::App("index.html".into())).browser_extensions_enabled(true),
        LogicalPosition::new(0.0, 0.0), LogicalSize::new(s.width, s.height))?;
    // The tab bar is its own small view that slides OVER the page (the page never resizes when it shows or hides).
    win.add_child(
        WebviewBuilder::new("rail", WebviewUrl::App("rail.html".into())).browser_extensions_enabled(true),
        LogicalPosition::new(-4000.0, 0.0), LogicalSize::new(1.0, 1.0))?;
    let w2 = win.clone();
    win.on_window_event(move |e| { if let tauri::WindowEvent::Resized(_) = e { relayout(&w2); } });
    Ok(())
}

/// Put the tab-bar view on top of every page view (each webview is its own native child window on Windows).
pub fn raise_rail(app: &AppHandle) {
    #[cfg(windows)]
    if let Some(r) = app.get_webview("rail") { crate::intercept_win::raise(&r); }
    #[cfg(not(windows))]
    let _ = app;
}
/// Place the tab-bar view (logical px). The chrome UI animates this for the slide in/out.
#[tauri::command]
pub async fn set_rail(app: AppHandle, x: f64, y: f64, w: f64, h: f64, visible: bool) {
    let Some(r) = app.get_webview("rail") else { return };
    let ok = |v: f64| v.is_finite() && v.abs() < 20000.0;
    if !(ok(x) && ok(y) && ok(w) && ok(h)) { return; }
    let _ = r.set_position(LogicalPosition::new(x, y));
    let _ = r.set_size(LogicalSize::new(w.max(1.0), h.max(1.0)));
    if visible { let _ = r.show(); } else { let _ = r.hide(); }
    raise_rail(&app);
}
/// Page zoom for the active tab (1.0 = 100%).
#[tauri::command]
pub async fn set_zoom(app: AppHandle, factor: f64, tab: Option<String>) {
    let l = tab.or_else(|| app.state::<AppState>().active.lock().clone());
    if let Some(w) = l.and_then(|l| app.get_webview(&l)) { let _ = w.set_zoom(factor.clamp(0.25, 5.0)); }
}
/// Mute or unmute a tab (Windows).
#[tauri::command]
pub async fn set_muted(app: AppHandle, tab: String, muted: bool) {
    #[cfg(windows)]
    if let Some(w) = app.get_webview(&tab) { crate::intercept_win::mute(&w, muted); }
    #[cfg(not(windows))]
    let _ = (app, tab, muted);
}
#[tauri::command]
pub async fn toggle_fullscreen(app: AppHandle) {
    if let Some(w) = app.get_window("main") { let f = w.is_fullscreen().unwrap_or(false); let _ = w.set_fullscreen(!f); }
}
/// Ask for a fresh preview image of a tab (sent back as a `thumb` event to the tab bar).
#[tauri::command]
pub async fn capture_tab(app: AppHandle, tab: String) {
    #[cfg(windows)]
    if let Some(w) = app.get_webview(&tab) { crate::intercept_win::capture(&w); }
    #[cfg(not(windows))]
    let _ = (app, tab);
}

/// Page area (x, y, w, h) in logical px = window minus the insets the chrome reported.
fn content_rect(win: &Window) -> (f64, f64, f64, f64) {
    let s = win.inner_size().map(|z| z.to_logical::<f64>(win.scale_factor().unwrap_or(1.0)))
        .unwrap_or(tauri::LogicalSize::new(1200.0, 800.0));
    let [t, r, b, l] = *win.app_handle().state::<AppState>().layout.lock();
    (l, t, (s.width - l - r).max(1.0), (s.height - t - b).max(1.0))
}

fn relayout(win: &Window) {
    let Ok(sz) = win.inner_size() else { return };
    let s = sz.to_logical::<f64>(win.scale_factor().unwrap_or(1.0));
    let (cx, cy, cw, ch) = content_rect(win);
    let st = win.app_handle().state::<AppState>();
    let split = st.split.lock().clone();
    let half = ((cw - 1.0) / 2.0).max(1.0);
    for wv in win.webviews() {
        let l = wv.label();
        if l == "rail" { continue; }                      // positioned by set_rail
        let (x, y, w, h) = if l == "chrome" { (0.0, 0.0, s.width, s.height) }
            else if split.as_deref() == Some(l) { (cx + half + 1.0, cy, half, ch) }       // split view: right half
            else if split.is_some() { (cx, cy, half, ch) }                                  // split view: left half
            else { (cx, cy, cw, ch) };
        let _ = wv.set_position(LogicalPosition::new(x, y));
        let _ = wv.set_size(LogicalSize::new(w, h));
    }
}

fn show_only(app: &AppHandle, label: &str) {
    let st = app.state::<AppState>();
    let panel = st.panel_open.load(Ordering::Relaxed);
    let split = st.split.lock().clone().filter(|s| s != label);
    let prev = st.active.lock().clone();
    for t in st.tabs.lock().iter() {
        let on = !panel && (t == label || split.as_deref() == Some(t.as_str()));
        if let Some(w) = app.get_webview(t) {
            // Snapshot the tab we're leaving so the tab bar shows what it looked like.
            #[cfg(windows)]
            if !on && prev.as_deref() == Some(t.as_str()) && !panel { crate::intercept_win::capture(&w); }
            if on { let _ = w.show(); } else { let _ = w.hide(); }
        }
    }
    *st.active.lock() = Some(label.into());
    if let Some(win) = app.get_window("main") { relayout(&win); }
    raise_rail(app);
}

/// Split view: show `label` on the right half next to the active tab (None = back to one tab).
#[tauri::command]
pub async fn set_split(app: AppHandle, label: Option<String>) {
    let st = app.state::<AppState>();
    *st.split.lock() = label.filter(|l| st.tabs.lock().contains(l));
    let active = st.active.lock().clone();
    if let Some(a) = active { show_only(&app, &a); }
}

/// Run a named page tool (dark mode, reader, find) in the active tab — or in `tab` if given.
#[tauri::command]
pub async fn page_action(app: AppHandle, action: String, arg: Option<String>, tab: Option<String>) -> Result<(), String> {
    let js = crate::page_action_js(&action, arg.as_deref().unwrap_or(""))?;
    let l = tab.or_else(|| app.state::<AppState>().active.lock().clone()).ok_or("no tab")?;
    app.get_webview(&l).ok_or("no tab")?.eval(&js).map_err(|e| e.to_string())
}

/// The chrome UI reports how much space its bars take on each side (logical px). Clamped so a bad value
/// can never hide the page entirely.
#[tauri::command]
pub async fn set_layout(app: AppHandle, top: f64, right: f64, bottom: f64, left: f64) {
    let c = |v: f64| if v.is_finite() { v.clamp(0.0, 400.0) } else { 0.0 };
    *app.state::<AppState>().layout.lock() = [c(top), c(right), c(bottom), c(left)];
    if let Some(win) = app.get_window("main") { relayout(&win); }
}

/// Hide the page (false) while a chrome panel such as Settings or Downloads is open; show it again (true).
#[tauri::command]
pub async fn show_content(app: AppHandle, visible: bool) {
    let st = app.state::<AppState>();
    st.panel_open.store(!visible, Ordering::Relaxed);
    let active = st.active.lock().clone();
    if let Some(a) = active { show_only(&app, &a); }
}

// ---------- downloads (R-38) ----------
/// Keep only a safe file name: no folders, no reserved characters, never empty.
fn safe_name(raw: &str) -> String {
    let n: String = raw.chars().map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c }).collect();
    let n = n.trim().trim_matches('.').to_string();
    if n.is_empty() { "download".into() } else { n.chars().take(150).collect() }
}
/// `name.ext`, `name (1).ext`, `name (2).ext`... — never overwrite an existing file.
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() { return p; }
    let (stem, ext) = match name.rsplit_once('.') { Some((s, e)) if !s.is_empty() => (s, format!(".{e}")), _ => (name, String::new()) };
    (1..10_000).map(|i| dir.join(format!("{stem} ({i}){ext}"))).find(|p| !p.exists()).unwrap_or(p)
}
fn download_dir(app: &AppHandle) -> PathBuf {
    app.path().download_dir().unwrap_or_else(|_| crate::store::dir(app).join("downloads"))
}
/// Files that run code when "opened". These are only ever revealed in their folder, never launched by Hush.
fn is_executable(p: &Path) -> bool {
    const RISKY: &[&str] = &["exe","msi","bat","cmd","com","scr","ps1","vbs","js","jse","wsf","hta","lnk","reg","dll","jar","appx","msix","app","sh","command","pkg","dmg","apk"];
    p.extension().and_then(|e| e.to_str()).map(|e| RISKY.contains(&e.to_ascii_lowercase().as_str())).unwrap_or(true)
}
fn known_download(app: &AppHandle, path: &str) -> Option<PathBuf> {
    let p = PathBuf::from(path);
    app.state::<AppState>().downloads.lock().iter().any(|d| *d == p).then_some(p)
}
fn on_download(app: &AppHandle, tab: &str, ev: DownloadEvent<'_>) -> bool {
    match ev {
        DownloadEvent::Requested { url, destination } => {
            let suggested = destination.file_name().and_then(|n| n.to_str()).map(str::to_string)
                .or_else(|| url.path_segments().and_then(|s| s.last()).map(str::to_string)).unwrap_or_default();
            let dir = download_dir(app);
            let _ = std::fs::create_dir_all(&dir);
            *destination = unique_path(&dir, &safe_name(&suggested));
            let _ = app.emit_to("chrome", "download", serde_json::json!({ "tab": tab, "url": url.as_str(),
                "path": destination.to_string_lossy(), "name": destination.file_name().map(|n| n.to_string_lossy().to_string()),
                "state": "started" }));
            true
        }
        DownloadEvent::Finished { url, path, success } => {
            if let (true, Some(p)) = (success, &path) { app.state::<AppState>().downloads.lock().push(p.clone()); }
            let _ = app.emit_to("chrome", "download", serde_json::json!({ "tab": tab, "url": url.as_str(),
                "path": path.as_ref().map(|p| p.to_string_lossy().to_string()), "state": if success { "done" } else { "failed" } }));
            true
        }
        #[allow(unreachable_patterns)]
        _ => true,
    }
}
/// Open a finished download with its default app. Executables are revealed in their folder instead.
#[tauri::command]
pub async fn download_open(app: AppHandle, path: String) -> Result<(), String> {
    let p = known_download(&app, &path).ok_or("not a Hush download")?;
    if is_executable(&p) { return reveal(&p); }
    #[cfg(windows)] let r = std::process::Command::new("explorer").arg(&p).spawn();
    #[cfg(target_os = "macos")] let r = std::process::Command::new("open").arg(&p).spawn();
    #[cfg(target_os = "linux")] let r = std::process::Command::new("xdg-open").arg(&p).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn download_reveal(app: AppHandle, path: String) -> Result<(), String> {
    reveal(&known_download(&app, &path).ok_or("not a Hush download")?)
}
fn reveal(p: &Path) -> Result<(), String> {
    #[cfg(windows)] let r = std::process::Command::new("explorer").arg(format!("/select,{}", p.display())).spawn();
    #[cfg(target_os = "macos")] let r = std::process::Command::new("open").arg("-R").arg(p).spawn();
    #[cfg(target_os = "linux")] let r = std::process::Command::new("xdg-open").arg(p.parent().unwrap_or(p)).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

/// The element picker (picker.js) "sends" its result by navigating to hush-pick://add?host=..&sel=..
/// Tab webviews have no IPC, so on_navigation is the one-way channel back into Rust.
fn handle_pick(app: &AppHandle, tab: &str, u: &url::Url) {
    let (mut host, mut sel) = (String::new(), String::new());
    for (k, v) in u.query_pairs() {
        match k.as_ref() { "host" => host = v.into_owned(), "sel" => sel = v.into_owned(), _ => {} }
    }
    if host.is_empty() || sel.is_empty() || sel.contains('\n') || host.contains(|c: char| c.is_whitespace() || c == '#') { return; }
    // Any page can navigate to hush-pick://, so only accept a filter for the host the tab is actually on.
    let on_host = app.get_webview(tab).and_then(|w| w.url().ok()).and_then(|cur| cur.host_str().map(str::to_string));
    if on_host.as_deref() != Some(host.as_str()) { return; }
    let app = app.clone();
    tauri::async_runtime::spawn(async move { let _ = crate::add_filter(&app, format!("{host}##{sel}")); });
}

#[tauri::command]
pub async fn open_tab(app: AppHandle, input: String, private: Option<bool>) -> Result<String, String> {
    let st = app.state::<AppState>();
    let win = app.get_window("main").ok_or("no window")?;
    let label = format!("tab-{}", st.next_id.fetch_add(1, Ordering::Relaxed));
    // chrome-extension:// pages (an extension's popup or settings) open only for extensions the user installed.
    let ext_page = input.strip_prefix("chrome-extension://").and_then(|r| r.split('/').next()).map(|id| crate::extensions::installed(&app, id)).unwrap_or(false);
    let url: url::Url = if ext_page { input.parse() } else { resolve_app(&app, &input).parse() }.map_err(|e: url::ParseError| e.to_string())?;
    let (b_nav, b_load) = (st.blocker.clone(), st.blocker.clone());
    let (app_nav, lbl_nav) = (app.clone(), label.clone());
    let (app_dl, lbl_dl) = (app.clone(), label.clone());
    // Loop guard for the https upgrade: if the same http URL comes back right after we upgraded it
    // (site redirects https -> http), stop instead of bouncing forever. TODO(R-20): show an interstitial.
    let last_upgrade = std::sync::Arc::new(parking_lot::Mutex::new(String::new()));
    let upgrade_reset = last_upgrade.clone();

    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .on_navigation(move |u| match u.scheme() {
            "hush-pick" => { handle_pick(&app_nav, &lbl_nav, u); false }
            // HTTPS-first: cancel and re-navigate to https (off-thread to avoid re-entrancy).
            "http" => {
                {
                    let mut last = last_upgrade.lock();
                    if *last == u.as_str() {
                        let _ = app_nav.emit_to("chrome", "https-failed", serde_json::json!({ "tab": lbl_nav, "url": u.as_str() }));
                        return false;
                    }
                    *last = u.as_str().to_string();
                }
                let https = u.as_str().replacen("http://", "https://", 1);
                let (a, l) = (app_nav.clone(), lbl_nav.clone());
                tauri::async_runtime::spawn(async move {
                    if let (Some(w), Ok(nu)) = (a.get_webview(&l), https.parse::<url::Url>()) { let _ = w.navigate(nu); }
                });
                false
            }
            "https" => {
                if crate::focus_blocks(u.as_str()) {
                    let _ = app_nav.emit_to("chrome", "focus-blocked", serde_json::json!({ "tab": lbl_nav, "url": u.as_str() }));
                    return false;
                }
                !b_nav.check_request(u.as_str(), u.as_str(), "document")
            }
            // Scheme allowlist (R-55): everything else (file:, javascript:, intent:, tauri:, asset:, ipc:, custom app
            // schemes) is refused so a web page can never steer a tab into local files or the app's own origin.
            "about" | "blob" | "data" => true,
            "chrome-extension" => u.host_str().map(|id| crate::extensions::installed(&app_nav, id)).unwrap_or(false),
            _ => false,
        })
        .on_page_load(move |wv, p| {
            if matches!(p.event(), PageLoadEvent::Started) {
                let l = wv.label().to_string();
                b_load.counts.lock().insert(l.clone(), 0);
                let _ = wv.app_handle().emit("blocked", serde_json::json!({ "tab": l, "count": 0 }));
                let _ = wv.eval(&crate::page_start_js(p.url().as_str()));
            } else if crate::dark_for(p.url().as_str()) {
                let _ = wv.eval(&format!("{};__hushPage.dark(true);", crate::PAGE_JS));
            }
            // R-31: tell the chrome UI where this tab actually is (redirects, link clicks, back/forward).
            let ev = if matches!(p.event(), PageLoadEvent::Started) { "started" } else { upgrade_reset.lock().clear(); "finished" };
            let _ = wv.app_handle().emit_to("chrome", "tab-url",
                serde_json::json!({ "tab": wv.label(), "url": p.url().as_str(), "state": ev }));
        })
        .on_download(move |_wv, ev| on_download(&app_dl, &lbl_dl, ev))
        // Private tabs: in-memory profile, nothing written to disk, gone when the tab closes.
        .incognito(private.unwrap_or(false))
        .browser_extensions_enabled(true)
        .extensions_path(crate::extensions::dir(&app))
        .initialization_script(include_str!("harden.js"))
        .initialization_script(&crate::scriptlets_init_js());
    #[cfg(feature = "new-window-api")]
    let builder = builder.on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny);

    let (x, y, w, h) = content_rect(&win);
    win.add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h)).map_err(|e| e.to_string())?;

    #[cfg(windows)]
    if let Some(w) = app.get_webview(&label) {
        crate::intercept_win::install(&w, st.blocker.clone());
        crate::intercept_win::install_shortcuts(&w);
        crate::intercept_win::install_extras(&w);
    }
    raise_rail(&app);

    st.tabs.lock().push(label.clone());
    show_only(&app, &label);
    Ok(label)
}

#[tauri::command] pub async fn switch_tab(app: AppHandle, label: String) { show_only(&app, &label); }

/// Closes a tab; if it was the active one, shows the last remaining tab. Returns the new active label (None = no tabs).
#[tauri::command]
pub async fn close_tab(app: AppHandle, label: String) -> Option<String> {
    if let Some(w) = app.get_webview(&label) { let _ = w.close(); }
    let st = app.state::<AppState>();
    st.tabs.lock().retain(|t| t != &label);
    st.blocker.counts.lock().remove(&label);
    { let mut sp = st.split.lock(); if sp.as_deref() == Some(label.as_str()) { *sp = None; } }
    let was_active = st.active.lock().as_deref() == Some(label.as_str());
    if was_active {
        let next = st.tabs.lock().last().cloned();
        match &next { Some(n) => show_only(&app, n), None => *st.active.lock() = None }
        return next;
    }
    let current = st.active.lock().clone();
    current
}

#[tauri::command]
pub async fn navigate(app: AppHandle, input: String) {
    let l = app.state::<AppState>().active.lock().clone();
    if let (Some(w), Ok(u)) = (l.and_then(|l| app.get_webview(&l)), resolve_app(&app, &input).parse()) { let _ = w.navigate(u); }
}

#[tauri::command]
pub async fn nav(app: AppHandle, action: String) {
    let l = app.state::<AppState>().active.lock().clone();
    if let Some(w) = l.and_then(|l| app.get_webview(&l)) {
        let _ = w.eval(match action.as_str() { "back" => "history.back()", "fwd" => "history.forward()", _ => "location.reload()" });
    }
}

#[tauri::command]
pub async fn clear_data(app: AppHandle) {
    for (_, w) in app.webviews() { let _ = w.clear_all_browsing_data(); }
}

/// Start the element picker in the active tab (R-41, desktop).
#[tauri::command]
pub async fn start_picker(app: AppHandle) {
    let l = app.state::<AppState>().active.lock().clone();
    if let Some(w) = l.and_then(|l| app.get_webview(&l)) { let _ = w.eval(include_str!("picker.js")); }
}
