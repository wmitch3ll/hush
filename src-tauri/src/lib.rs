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
use std::sync::{atomic::AtomicUsize, Arc, OnceLock};
use tauri::{AppHandle, Manager};

/// Global handle for FFI/JNI callers (Android JNI, iOS C ABI). Same Arc as AppState.blocker.
pub static BLOCKER: OnceLock<Arc<Blocker>> = OnceLock::new();

pub struct AppState {
    pub blocker: Arc<Blocker>,
    pub tabs: Mutex<Vec<String>>,
    pub active: Mutex<Option<String>>,
    pub next_id: AtomicUsize,
    pub store: Mutex<store::Store>,
}

/// Bundled lists (run tools/fetch-lists.sh to fill them with real lists).
pub fn load_lists() -> Vec<String> {
    vec![include_str!("../lists/easylist.txt").into(), include_str!("../lists/easyprivacy.txt").into()]
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
    *st.store.lock() = s;
    rebuild(app); // TODO(R-61): load a serialized engine instead of parsing text at startup
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
    json!({ "settings": s.settings, "bookmarks": s.bookmarks, "custom_filters": s.custom_filters.len(), "allow_sites": s.allow_sites })
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
        _ => return Err("unknown setting".into()),
    }
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
];
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
    });
    #[cfg(mobile)] let b = b.plugin(tabs_plugin::init());
    #[cfg(desktop)] let b = b
        .invoke_handler(tauri::generate_handler![toggle_shield, get_state, set_setting, bookmark_add, bookmark_remove,
            add_custom_filter, export_data, import_data, update_lists,
            desktop::open_tab, desktop::switch_tab, desktop::close_tab, desktop::navigate, desktop::nav,
            desktop::clear_data, desktop::start_picker])
        .setup(desktop::setup);
    #[cfg(mobile)] let b = b
        .invoke_handler(tauri::generate_handler![toggle_shield, get_state, set_setting, bookmark_add, bookmark_remove,
            add_custom_filter, export_data, import_data, update_lists,
            mobile::open_tab, mobile::switch_tab, mobile::close_tab, mobile::navigate, mobile::nav,
            mobile::clear_data, mobile::set_chrome_inset])
        .setup(mobile::setup);
    b.run(tauri::generate_context!()).expect("hush failed to start");
}
