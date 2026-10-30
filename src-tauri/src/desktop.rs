//! Desktop shell: window + full-size "chrome" webview + one child webview per tab.
//! Commands are `async` on purpose: creating webviews from sync commands can deadlock on Windows.
use crate::{resolve_app, AppState};
use std::sync::atomic::Ordering;
use tauri::{webview::{PageLoadEvent, WebviewBuilder}, window::WindowBuilder, AppHandle, Emitter, LogicalPosition,
            LogicalSize, Manager, WebviewUrl, Window};

const CHROME_TOP: f64 = 52.0; // top bar height (px) — keep in sync with ui/index.html #top
const RAIL_W: f64 = 64.0;     // tab rail width (px)    — keep in sync with ui/index.html #rail

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    crate::init_state(app.handle());
    let win = WindowBuilder::new(app, "main").title("Hush").inner_size(1200.0, 800.0).build()?;
    let s = win.inner_size()?.to_logical::<f64>(win.scale_factor()?);
    win.add_child(
        WebviewBuilder::new("chrome", WebviewUrl::App("index.html".into())),
        LogicalPosition::new(0.0, 0.0), LogicalSize::new(s.width, s.height))?;
    let w2 = win.clone();
    win.on_window_event(move |e| { if let tauri::WindowEvent::Resized(_) = e { relayout(&w2); } });
    Ok(())
}

fn relayout(win: &Window) {
    let Ok(sz) = win.inner_size() else { return };
    let s = sz.to_logical::<f64>(win.scale_factor().unwrap_or(1.0));
    for wv in win.webviews() {
        let (x, y, w, h) = if wv.label() == "chrome" { (0.0, 0.0, s.width, s.height) }
            else { (RAIL_W, CHROME_TOP, (s.width - RAIL_W).max(1.0), (s.height - CHROME_TOP).max(1.0)) };
        let _ = wv.set_position(LogicalPosition::new(x, y));
        let _ = wv.set_size(LogicalSize::new(w, h));
    }
}

fn show_only(app: &AppHandle, label: &str) {
    let st = app.state::<AppState>();
    for t in st.tabs.lock().iter() {
        if let Some(w) = app.get_webview(t) { if t == label { let _ = w.show(); } else { let _ = w.hide(); } }
    }
    *st.active.lock() = Some(label.into());
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
pub async fn open_tab(app: AppHandle, input: String) -> Result<String, String> {
    let st = app.state::<AppState>();
    let win = app.get_window("main").ok_or("no window")?;
    let label = format!("tab-{}", st.next_id.fetch_add(1, Ordering::Relaxed));
    let url: url::Url = resolve_app(&app, &input).parse().map_err(|e: url::ParseError| e.to_string())?;
    let (b_nav, b_load) = (st.blocker.clone(), st.blocker.clone());
    let (app_nav, lbl_nav) = (app.clone(), label.clone());
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
            "https" => !b_nav.check_request(u.as_str(), u.as_str(), "document"),
            // Scheme allowlist (R-55): everything else (file:, javascript:, intent:, tauri:, asset:, ipc:, custom app
            // schemes) is refused so a web page can never steer a tab into local files or the app's own origin.
            "about" | "blob" | "data" => true,
            _ => false,
        })
        .on_page_load(move |wv, p| {
            if matches!(p.event(), PageLoadEvent::Started) {
                let l = wv.label().to_string();
                b_load.counts.lock().insert(l.clone(), 0);
                let _ = wv.app_handle().emit("blocked", serde_json::json!({ "tab": l, "count": 0 }));
                let _ = wv.eval(&b_load.cosmetic_js(p.url().as_str()));
            }
            // R-31: tell the chrome UI where this tab actually is (redirects, link clicks, back/forward).
            let ev = if matches!(p.event(), PageLoadEvent::Started) { "started" } else { upgrade_reset.lock().clear(); "finished" };
            let _ = wv.app_handle().emit_to("chrome", "tab-url",
                serde_json::json!({ "tab": wv.label(), "url": p.url().as_str(), "state": ev }));
        })
        .initialization_script(include_str!("harden.js"));
    #[cfg(feature = "new-window-api")]
    let builder = builder.on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny);

    let s = win.inner_size().map_err(|e| e.to_string())?.to_logical::<f64>(win.scale_factor().unwrap_or(1.0));
    win.add_child(builder, LogicalPosition::new(RAIL_W, CHROME_TOP),
        LogicalSize::new((s.width - RAIL_W).max(1.0), (s.height - CHROME_TOP).max(1.0))).map_err(|e| e.to_string())?;

    #[cfg(windows)]
    if let Some(w) = app.get_webview(&label) { crate::intercept_win::install(&w, st.blocker.clone()); }

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
