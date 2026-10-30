//! Hush entry point. Desktop = multiwebview (desktop.rs). Mobile = native tab plugin (mobile.rs).
//! Shared commands (settings, bookmarks, filters, lists, export/import) live here.
mod blocker;
mod store;
#[cfg(desktop)] mod desktop;
#[cfg(mobile)] mod mobile;
#[cfg(windows)] mod intercept_win;
#[cfg(target_os = "android")] mod android_jni;
#[cfg(target_os = "ios")] mod ios_ffi;
#[cfg(mobile)] mod tabs_plugin;

use blocker::Blocker;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::sync::{atomic::{AtomicUsize, Ordering}, Arc, LazyLock, OnceLock};
use tauri::{AppHandle, Manager};

/// Global handle for FFI/JNI callers (Android JNI, iOS C ABI). Same Arc as AppState.blocker.
pub static BLOCKER: OnceLock<Arc<Blocker>> = OnceLock::new();

pub struct AppState {
    pub blocker: Arc<Blocker>,
    pub tabs: Mutex<Vec<String>>,
    pub active: Mutex<Option<String>>,
    pub next_id: AtomicUsize,
    pub store: Mutex<store::Store>,
    /// Space the chrome UI reserves around the page, in logical px: [top, right, bottom, left]. Set by `set_layout`.
    pub layout: Mutex<[f64; 4]>,
    /// True while a chrome panel (settings, downloads) covers the page area: tabs stay hidden.
    pub panel_open: std::sync::atomic::AtomicBool,
    /// Files Hush itself downloaded this session; only these may be opened/revealed from the UI.
    pub downloads: Mutex<Vec<std::path::PathBuf>>,
    /// Desktop split view: the tab shown on the right half (None = no split).
    pub split: Mutex<Option<String>>,
    /// Opt-in history (empty unless the user turned it on).
    pub history: Mutex<Vec<store::Hist>>,
}

// ---------- page tools (dark mode, reader, find): one script for every platform ----------
pub const PAGE_JS: &str = include_str!("page.js");
/// What every page gets when it starts loading; readable from JNI threads without the AppHandle.
#[derive(Default)]
pub struct PagePrefs { pub dark: bool, pub site_dark: std::collections::BTreeMap<String, bool> }
pub static PAGE_PREFS: LazyLock<parking_lot::RwLock<PagePrefs>> = LazyLock::new(Default::default);
fn refresh_page_prefs(s: &store::Store) {
    let mut p = PAGE_PREFS.write();
    p.dark = s.settings.ui.get("force_dark").map(|v| v == "true").unwrap_or(false);
    p.site_dark = s.site_dark.clone();
}
pub fn dark_for(url: &str) -> bool {
    let host = url::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_default();
    let p = PAGE_PREFS.read();
    p.site_dark.get(&host).copied().unwrap_or(p.dark)
}
/// Cosmetic filtering + (if on for this site) force-dark, as one script to run at page start.
pub fn page_start_js(url: &str) -> String {
    let mut js = BLOCKER.get().map(|b| b.cosmetic_js(url)).unwrap_or_default();
    if dark_for(url) { js.push_str(PAGE_JS); js.push_str(";__hushPage.dark(true);"); }
    js
}
/// Only these named actions can be run in a page; `arg` is JSON-encoded, so it can't break out of the string.
pub fn page_action_js(action: &str, arg: &str) -> Result<String, String> {
    let a = serde_json::to_string(arg).map_err(|e| e.to_string())?;
    let call = match action {
        "dark-on" => "__hushPage.dark(true)".to_string(),
        "dark-off" => "__hushPage.dark(false)".to_string(),
        "reader" => "__hushPage.reader()".to_string(),
        "find" => format!("__hushPage.find({a},false)"),
        "find-back" => format!("__hushPage.find({a},true)"),
        "find-clear" => "__hushPage.find('',false)".to_string(),
        _ => return Err("unknown page action".into()),
    };
    Ok(format!("{PAGE_JS};{call};"))
}
fn now_secs() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }
/// Move session counts into the saved totals (called when the UI asks for stats).
fn flush_stats(app: &AppHandle) -> store::Stats {
    let st = app.state::<AppState>();
    let n = st.blocker.total.swap(0, Ordering::Relaxed);
    let mut s = st.store.lock();
    let wk = now_secs() / 604_800;
    if s.stats.week_id != wk { s.stats.week_id = wk; s.stats.week = 0; }
    if n > 0 { s.stats.total += n; s.stats.week += n; store::save(app, &s); }
    s.stats.clone()
}

/// Bundled lists (run tools/fetch-lists.sh to fill them with real lists). The cookie list hides consent banners.
pub fn load_lists() -> Vec<String> {
    vec![include_str!("../lists/easylist.txt").into(), include_str!("../lists/easyprivacy.txt").into(),
         include_str!("../lists/easylist-cookie.txt").into()]
}
fn lists_for(app: &AppHandle) -> Vec<String> { store::lists_override(app).unwrap_or_else(load_lists) }

/// Rebuild the engine from lists + custom filters (hot swap; allow list is kept).
pub fn rebuild(app: &AppHandle) {
    let st = app.state::<AppState>();
    let custom = st.store.lock().custom_filters.clone();
    st.blocker.reload(&lists_for(app), &custom);
}
/// Load persisted data and build the real engine. Called first thing in each platform's setup().
pub fn init_state(app: &AppHandle) {
    let st = app.state::<AppState>();
    let s = store::load(app);
    *st.blocker.allow_sites.write() = s.allow_sites.clone();
    refresh_page_prefs(&s);
    *st.history.lock() = store::load_history(app);
    *st.store.lock() = s;
    // Parsing the full filter lists takes seconds (much longer in debug builds / on phones). On mobile, do it
    // off the main thread so the app can start; pages load unfiltered for those first seconds.
    // TODO(R-61): load a serialized engine instead of parsing text at startup.
    #[cfg(mobile)] { let h = app.clone(); std::thread::spawn(move || rebuild(&h)); }
    #[cfg(desktop)] rebuild(app);
}

/// Address-bar input -> URL. HTTPS-first; searches use the chosen engine. (Mirror in ui/mobile.html resolve().)
pub fn resolve_with(s: &store::Settings, input: &str) -> String {
    let t = input.trim();
    if let Ok(u) = url::Url::parse(t) { if u.has_host() && (u.scheme() == "http" || u.scheme() == "https") { return t.replacen("http://", "https://", 1); } }
    if t.contains('.') && !t.contains(' ') && !t.contains("://") { return format!("https://{t}"); }
    let q: String = url::form_urlencoded::byte_serialize(t.as_bytes()).collect();
    s.search_template().replace("%s", &q)
}
pub fn resolve_app(app: &AppHandle, input: &str) -> String {
    let s = app.state::<AppState>().store.lock().settings.clone();
    resolve_with(&s, input)
}

/// Add one filter line (e.g. "example.com##.ad"), persist, rebuild. Used by the element picker + UI.
pub fn add_filter(app: &AppHandle, filter: String) -> Result<(), String> {
    let f = filter.trim().to_string();
    if f.is_empty() || f.contains('\n') || f.len() > 2000 { return Err("invalid filter".into()); }
    {
        let st = app.state::<AppState>();
        let mut s = st.store.lock();
        if !s.custom_filters.contains(&f) { s.custom_filters.push(f); store::save(app, &s); }
    }
    rebuild(app);
    Ok(())
}

// ---------- shared commands ----------
#[tauri::command]
async fn toggle_shield(app: AppHandle, host: String) {
    let st = app.state::<AppState>();
    {
        let mut a = st.blocker.allow_sites.write();
        if let Some(i) = a.iter().position(|h| *h == host) { a.remove(i); } else { a.push(host); }
        let mut s = st.store.lock();
        s.allow_sites = a.clone();
        store::save(&app, &s);
    }
}
#[tauri::command]
async fn get_state(app: AppHandle) -> Value {
    let s = app.state::<AppState>().store.lock().clone();
    json!({ "settings": s.settings, "bookmarks": s.bookmarks, "custom_filters": s.custom_filters.len(), "allow_sites": s.allow_sites,
            "site_dark": s.site_dark, "session": s.session, "platform": if cfg!(mobile) { "mobile" } else { "desktop" } })
}
#[tauri::command]
async fn set_setting(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let st = app.state::<AppState>();
    let mut s = st.store.lock();
    match key.as_str() {
        "search" => s.settings.search = value,
        "custom_search" => s.settings.custom_search = value,
        "theme" => s.settings.theme = value,
        "counter" => s.settings.counter = value == "true",
        // Free-form UI preferences (layout, auto-hide, density...). The UI owns their meaning; Rust only stores them.
        k if k.starts_with("ui.") => {
            let name = &k[3..];
            if name.is_empty() || name.len() > 40 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') || value.len() > 200 {
                return Err("invalid ui setting".into());
            }
            if name == "history" && value != "on" { st.history.lock().clear(); store::save_history(&app, &[]); }
            if name == "restore" && value != "on" { s.session.clear(); }
            s.settings.ui.insert(name.to_string(), value);
        }
        _ => return Err("unknown setting".into()),
    }
    refresh_page_prefs(&s);
    store::save(&app, &s);
    Ok(())
}
#[tauri::command]
async fn bookmark_add(app: AppHandle, title: String, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) { return Err("bad url".into()); }
    let st = app.state::<AppState>();
    let mut s = st.store.lock();
    if !s.bookmarks.iter().any(|b| b.url == url) { s.bookmarks.push(store::Bookmark { title, url, folder: String::new() }); store::save(&app, &s); }
    Ok(())
}
#[tauri::command]
async fn bookmark_remove(app: AppHandle, url: String) {
    let st = app.state::<AppState>();
    let mut s = st.store.lock();
    s.bookmarks.retain(|b| b.url != url);
    store::save(&app, &s);
}
#[tauri::command]
async fn add_custom_filter(app: AppHandle, filter: String) -> Result<(), String> { add_filter(&app, filter) }

/// Everything the user owns, as one JSON string (settings, bookmarks, custom filters, allow list).
#[tauri::command]
async fn export_data(app: AppHandle) -> Result<String, String> {
    let s = app.state::<AppState>().store.lock().clone();
    serde_json::to_string_pretty(&s).map_err(|e| e.to_string())
}
#[tauri::command]
async fn import_data(app: AppHandle, json: String) -> Result<(), String> {
    let inc: store::Store = serde_json::from_str(&json).map_err(|e| format!("not a Hush export: {e}"))?;
    {
        let st = app.state::<AppState>();
        let mut s = st.store.lock();
        s.settings = inc.settings;
        // Imports are untrusted: only web bookmarks, single-line filters, plain hostnames.
        let web = |u: &str| u.starts_with("https://") || u.starts_with("http://");
        for b in inc.bookmarks { if web(&b.url) && b.url.len() < 4096 && !s.bookmarks.iter().any(|x| x.url == b.url) { s.bookmarks.push(b); } }
        for f in inc.custom_filters.into_iter().map(|f| f.trim().to_string()) {
            if !f.is_empty() && !f.contains('\n') && f.len() <= 2000 && !s.custom_filters.contains(&f) { s.custom_filters.push(f); }
        }
        for h in inc.allow_sites {
            let ok = !h.is_empty() && h.len() < 256 && h.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
            if ok && !s.allow_sites.contains(&h) { s.allow_sites.push(h); }
        }
        *st.blocker.allow_sites.write() = s.allow_sites.clone();
        store::save(&app, &s);
    }
    rebuild(&app);
    Ok(())
}

const LIST_URLS: &[(&str, &str)] = &[
    ("easylist.txt", "https://easylist.to/easylist/easylist.txt"),
    ("easyprivacy.txt", "https://easylist.to/easylist/easyprivacy.txt"),
    ("easylist-cookie.txt", "https://secure.fanboy.co.nz/fanboy-cookiemonster.txt"),
];

// ---------- per-site dark, stats, history, session ----------
/// value: Some(true/false) = override for this site, None = follow the global setting.
#[tauri::command]
async fn site_dark(app: AppHandle, host: String, value: Option<bool>) -> Result<(), String> {
    if host.is_empty() || host.len() > 253 || !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') { return Err("bad host".into()); }
    let st = app.state::<AppState>();
    let mut s = st.store.lock();
    match value { Some(v) => { s.site_dark.insert(host, v); } None => { s.site_dark.remove(&host); } }
    refresh_page_prefs(&s);
    store::save(&app, &s);
    Ok(())
}
#[tauri::command]
async fn get_stats(app: AppHandle) -> store::Stats { flush_stats(&app) }

fn history_on(app: &AppHandle) -> bool {
    app.state::<AppState>().store.lock().settings.ui.get("history").map(|v| v == "on").unwrap_or(false)
}
/// Record a visit (only when the user turned history on; the UI never calls this for private tabs).
#[tauri::command]
async fn history_add(app: AppHandle, url: String, title: String) {
    if !history_on(&app) || !(url.starts_with("https://") || url.starts_with("http://")) || url.len() > 2048 { return; }
    let st = app.state::<AppState>();
    let mut h = st.history.lock();
    h.retain(|x| x.url != url);
    h.insert(0, store::Hist { url, title: title.chars().take(200).collect(), t: now_secs() });
    h.truncate(3000);
    store::save_history(&app, &h);
}
#[tauri::command]
async fn history_list(app: AppHandle, limit: Option<usize>) -> Vec<store::Hist> {
    app.state::<AppState>().history.lock().iter().take(limit.unwrap_or(200).min(3000)).cloned().collect()
}
#[tauri::command]
async fn history_clear(app: AppHandle) { app.state::<AppState>().history.lock().clear(); store::save_history(&app, &[]); }
/// Address-bar suggestions: bookmarks first, then history. Matches words in the URL or title.
#[tauri::command]
async fn suggest(app: AppHandle, q: String) -> Vec<Value> {
    let q = q.trim().to_lowercase();
    if q.is_empty() { return vec![]; }
    let words: Vec<&str> = q.split_whitespace().collect();
    let hit = |url: &str, title: &str| { let t = format!("{} {}", url.to_lowercase(), title.to_lowercase()); words.iter().all(|w| t.contains(w)) };
    let st = app.state::<AppState>();
    let mut out: Vec<Value> = st.store.lock().bookmarks.iter().filter(|b| hit(&b.url, &b.title))
        .take(4).map(|b| json!({ "url": b.url, "title": b.title, "kind": "bookmark" })).collect();
    for h in st.history.lock().iter() {
        if out.len() >= 8 { break; }
        if hit(&h.url, &h.title) && !out.iter().any(|o| o["url"] == h.url) { out.push(json!({ "url": h.url, "title": h.title, "kind": "history" })); }
    }
    out
}
/// Remember open tabs for "restore tabs" (only when that setting is on).
#[tauri::command]
async fn session_save(app: AppHandle, tabs: Vec<store::SessionTab>) {
    let st = app.state::<AppState>();
    let mut s = st.store.lock();
    if s.settings.ui.get("restore").map(|v| v != "on").unwrap_or(true) { return; }
    s.session = tabs.into_iter().filter(|t| t.url.starts_with("https://") && t.url.len() < 2048)
        .map(|t| store::SessionTab { url: t.url, ws: t.ws.chars().take(30).collect() }).take(100).collect();
    store::save(&app, &s);
}
/// User-triggered only (no background fetching). Sanity-checks content before replacing anything.
#[tauri::command]
async fn update_lists(app: AppHandle) -> Result<String, String> {
    let dir = store::dir(&app).join("lists");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut n = 0;
    for (name, url) in LIST_URLS {
        let u = url.to_string();
        let body = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
            ureq::get(&u).call().map_err(|e| e.to_string())?.into_string().map_err(|e| e.to_string())
        }).await.map_err(|e| e.to_string())??;
        // TODO(R-42): verify a checksum/signature if the list publisher offers one.
        if body.len() < 10_000 || !(body.starts_with('[') || body.starts_with('!')) { return Err(format!("{name}: unexpected content, kept old list")); }
        std::fs::write(dir.join(name), body).map_err(|e| e.to_string())?;
        n += 1;
    }
    rebuild(&app);
    #[cfg(target_os = "ios")] mobile::push_shards(&app);
    Ok(format!("{n} lists updated"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Empty engine until setup() loads persisted data + lists.
    let blocker = Arc::new(Blocker::from_lists(&[], &[]));
    let _ = BLOCKER.set(blocker.clone());

    let b = tauri::Builder::default().manage(AppState {
        blocker, tabs: Default::default(), active: Default::default(), next_id: AtomicUsize::new(1), store: Default::default(),
        layout: Mutex::new([52.0, 0.0, 0.0, 64.0]), panel_open: Default::default(), downloads: Default::default(),
        split: Default::default(), history: Default::default(),
    });
    #[cfg(mobile)] let b = b.plugin(tabs_plugin::init());
    #[cfg(desktop)] let b = b
        .invoke_handler(tauri::generate_handler![toggle_shield, get_state, set_setting, bookmark_add, bookmark_remove,
            add_custom_filter, export_data, import_data, update_lists,
            site_dark, get_stats, history_add, history_list, history_clear, suggest, session_save,
            desktop::page_action, desktop::set_split,
            desktop::open_tab, desktop::switch_tab, desktop::close_tab, desktop::navigate, desktop::nav,
            desktop::clear_data, desktop::start_picker, desktop::set_layout, desktop::show_content,
            desktop::download_open, desktop::download_reveal])
        .setup(desktop::setup);
    #[cfg(mobile)] let b = b
        .invoke_handler(tauri::generate_handler![toggle_shield, get_state, set_setting, bookmark_add, bookmark_remove,
            add_custom_filter, export_data, import_data, update_lists,
            site_dark, get_stats, history_add, history_list, history_clear, suggest, session_save,
            mobile::page_action,
            mobile::open_tab, mobile::switch_tab, mobile::close_tab, mobile::navigate, mobile::nav,
            mobile::clear_data, mobile::set_chrome_inset, mobile::set_web_prefs])
        .setup(mobile::setup);
    b.run(tauri::generate_context!()).expect("hush failed to start");
}
