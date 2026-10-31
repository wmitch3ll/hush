//! Hush entry point. Desktop = multiwebview (desktop.rs). Mobile = native tab plugin (mobile.rs).
//! Shared commands (settings, bookmarks, filters, lists, export/import) live here.
mod blocker;
mod store;
#[cfg(desktop)] mod desktop;
#[cfg(desktop)] mod extensions;
#[cfg(mobile)] mod mobile;
#[cfg(windows)] mod intercept_win;
#[cfg(target_os = "android")] mod android_jni;
#[cfg(target_os = "ios")] mod ios_ffi;
#[cfg(mobile)] mod tabs_plugin;
mod tor;
mod msgnet;

/// Change watch: fetch a page and read the text of one element (CSS selector). None = not found.
#[tauri::command]
async fn watch_check(url: String, sel: String) -> Result<Option<String>, String> {
    if !url.starts_with("https://") { return Err("https only".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let body = ureq::get(&url).set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36")
            .timeout(std::time::Duration::from_secs(20)).call().map_err(|e| e.to_string())?
            .into_string().map_err(|e| e.to_string())?;
        let doc = scraper::Html::parse_document(&body);
        let s = scraper::Selector::parse(&sel).map_err(|_| "bad selector".to_string())?;
        Ok(doc.select(&s).next().map(|e| e.text().collect::<Vec<_>>().join(" ").split_whitespace().collect::<Vec<_>>().join(" ").chars().take(300).collect()))
    }).await.map_err(|e| e.to_string())?
}

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
    /// Desktop Peek: the floating preview webview, if one is open.
    pub peek: Mutex<Option<String>>,
}

// ---------- page tools (dark mode, reader, find): one script for every platform ----------
pub const PAGE_JS: &str = include_str!("page.js");
/// uBlock Origin scriptlets + rules (YouTube, anti-adblock), built by tools/build-scriptlets.mjs. Runs at document start.
pub const SCRIPTLETS_JS: &str = include_str!("../lists/scriptlets.js");
pub const FARBLE_JS: &str = include_str!("farble.js");
/// Per-session secret for fingerprint randomization: a new value every time Hush starts (like Brave's default).
static FP_SECRET: LazyLock<String> = LazyLock::new(|| {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    format!("{:016x}", h.finish())
});
/// Document-start script for a new tab: fingerprint protection, then uBlock scriptlets.
/// Both are skipped on sites the user excluded (shield off, or fingerprint protection off for that site).
pub fn scriptlets_init_js() -> String {
    let off = BLOCKER.get().map(|b| b.allow_sites.read().clone()).unwrap_or_default();
    let p = PAGE_PREFS.read();
    let fp = if p.fp_on {
        let fp_off: Vec<&String> = p.fp_off.iter().chain(off.iter()).collect();
        format!("const __HUSH_FP={};\n{}\n", json!({ "secret": *FP_SECRET, "off": fp_off }), FARBLE_JS)
    } else { String::new() };
    let tools = format!("{{const __HUSH_TOOLS={};\n{}\n}}\n", json!({ "clean": p.clean, "video": p.video, "gestures": p.gestures, "wheel": p.wheel, "quality": p.quality }), include_str!("tools.js"));
    format!("{fp}{tools}window.__hushOff={};\n{}", serde_json::to_string(&off).unwrap_or("[]".into()), SCRIPTLETS_JS)
}
/// What every page gets when it starts loading; readable from JNI threads without the AppHandle.
#[derive(Default)]
pub struct PagePrefs { pub dark: bool, pub site_dark: std::collections::BTreeMap<String, bool>,
    pub boosts: std::collections::BTreeMap<String, store::Boost>,
    /// Fingerprint protection on/off, and sites where it's turned off.
    pub fp_on: bool, pub fp_off: Vec<String>,
    /// Page tools: link cleaner, video controls, mouse gestures (desktop).
    pub clean: bool, pub video: bool, pub gestures: bool, pub wheel: Vec<String>, pub quality: String }
pub static PAGE_PREFS: LazyLock<parking_lot::RwLock<PagePrefs>> = LazyLock::new(Default::default);
fn refresh_page_prefs(s: &store::Store) {
    let mut p = PAGE_PREFS.write();
    p.dark = s.settings.ui.get("force_dark").map(|v| v == "true").unwrap_or(false);
    p.site_dark = s.site_dark.clone();
    p.boosts = s.site_boost.clone();
    p.fp_on = s.settings.ui.get("fp").map(|v| v != "off").unwrap_or(true);
    let on = |k: &str, d: bool| s.settings.ui.get(k).map(|v| v == "on").unwrap_or(d);
    p.clean = on("clean_links", true); p.video = on("video_bar", true); p.gestures = on("gestures", true);
    p.quality = s.settings.ui.get("video_quality").filter(|v| matches!(v.as_str(), "2160" | "1440" | "1080" | "720" | "480" | "auto")).cloned().unwrap_or_else(|| "1080".into());
    p.wheel = s.settings.ui.get("wheel").map(|v| v.as_str()).unwrap_or("back,forward,reload,newtab,closetab,screenshot").split(',')
        .filter(|x| !x.is_empty() && x.len() < 16 && x.chars().all(|c| c.is_ascii_lowercase())).take(8).map(str::to_string).collect();
    p.fp_off = s.settings.ui.get("fp_off").map(|v| v.split(',').map(|x| x.trim().to_lowercase()).filter(|x| !x.is_empty()).collect()).unwrap_or_default();
    let until = s.settings.ui.get("focus_until").and_then(|v| v.parse().ok()).unwrap_or(0);
    let sites = s.settings.ui.get("focus_sites").map(|v| v.split(',').map(|x| x.trim().trim_start_matches("www.").to_lowercase()).filter(|x| !x.is_empty()).collect()).unwrap_or_default();
    *FOCUS.write() = (until, sites);
}
/// Focus mode: (until unix-seconds, sites). Document loads on those sites are replaced by a "focus" page.
pub static FOCUS: LazyLock<parking_lot::RwLock<(u64, Vec<String>)>> = LazyLock::new(Default::default);
pub fn focus_blocks(url: &str) -> bool {
    let f = FOCUS.read();
    if f.0 <= now_secs() || f.1.is_empty() { return false; }
    let host = url::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_default();
    f.1.iter().any(|s| host == *s || host.ends_with(&format!(".{s}")))
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
    js.push_str(&boost_js(url));
    js
}
/// Boosts: per-site look changes the user made (font, size, sepia, hidden images, own CSS), applied as one style element.
pub fn boost_js(url: &str) -> String {
    let host = url::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string())).unwrap_or_default();
    let p = PAGE_PREFS.read();
    let Some(b) = p.boosts.get(&host) else { return String::new() };
    let mut css = String::new();
    match b.font.as_str() {
        "serif" => css.push_str("body,body *:not(code):not(pre):not(kbd):not(i[class]):not(span[class*=icon]){font-family:Georgia,\"Times New Roman\",serif!important}"),
        "sans" => css.push_str("body,body *:not(code):not(pre):not(kbd):not(i[class]):not(span[class*=icon]){font-family:system-ui,\"Segoe UI\",Roboto,Arial,sans-serif!important}"),
        "mono" => css.push_str("body,body *:not(i[class]):not(span[class*=icon]){font-family:ui-monospace,Consolas,monospace!important}"),
        "readable" => css.push_str("body,body *:not(code):not(pre):not(i[class]):not(span[class*=icon]){font-family:Verdana,Tahoma,sans-serif!important;letter-spacing:.02em!important;line-height:1.6!important}"),
        _ => {}
    }
    if b.scale != 100 && (50..=200).contains(&b.scale) { css.push_str(&format!("html{{zoom:{}%}}", b.scale)); }
    match b.tone.as_str() { "sepia" => css.push_str("html{filter:sepia(.4) brightness(.98)!important}"), "gray" => css.push_str("html{filter:grayscale(1)!important}"), "contrast" => css.push_str("html{filter:contrast(1.25)!important}"), _ => {} }
    if b.hide_images { css.push_str("img,picture,svg image,video:not([controls]){visibility:hidden!important}"); }
    css.push_str(&b.css);
    if css.is_empty() { return String::new(); }
    format!(";(()=>{{const s=document.createElement('style');s.id='hush-boost';s.textContent={};(document.head||document.documentElement).appendChild(s)}})();",
        serde_json::to_string(&css).unwrap_or("''".into()))
}
/// Only these named actions can be run in a page; `arg` is JSON-encoded, so it can't break out of the string.
pub fn page_action_js(action: &str, arg: &str) -> Result<String, String> {
    let a = serde_json::to_string(arg).map_err(|e| e.to_string())?;
    let call = match action {
        "dark-on" => "__hushPage.dark(true)".to_string(),
        "media-pause" => "document.querySelectorAll('video,audio').forEach(v=>v.pause())".to_string(),
        "media-play" => "(document.querySelector('video')||document.querySelector('audio')||{play(){}}).play()".to_string(),
        // Watch Together: jump to a time / skip by seconds (arg is a JSON string; `+` turns it into a number or NaN).
        "media-seek" => format!("(()=>{{const v=document.querySelector('video')||document.querySelector('audio');const t=+{a};if(v&&isFinite(t))v.currentTime=Math.max(0,t)}})()"),
        "media-skip" => format!("(()=>{{const v=document.querySelector('video')||document.querySelector('audio');const t=+{a};if(v&&isFinite(t))v.currentTime=Math.max(0,v.currentTime+t)}})()"),
        "wheel" => "window.__hushWheel&&__hushWheel()".to_string(),
        "scroll-top" => "scrollTo({top:0,behavior:'smooth'})".to_string(),
        "scroll-bottom" => "scrollTo({top:document.documentElement.scrollHeight,behavior:'smooth'})".to_string(),
        "dark-off" => "__hushPage.dark(false)".to_string(),
        "reader" => "__hushPage.reader()".to_string(),
        "find" => format!("__hushPage.find({a},false)"),
        "find-back" => format!("__hushPage.find({a},true)"),
        "find-clear" => "__hushPage.find('',false)".to_string(),
        "print" => "print()".to_string(),
        "listen-start" => format!("__hushPage.listen('start',{a})"),
        "listen-rate" => format!("__hushPage.listen('rate',{a})"),
        "listen-pause" | "listen-resume" | "listen-stop" | "listen-next" | "listen-prev" => format!("__hushPage.listen('{}')", &action[7..]),
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
         include_str!("../lists/easylist-cookie.txt").into(),
         // uBlock Origin lists (GPLv3): YouTube / anti-adblock network + element rules. Their +js() scriptlets run via SCRIPTLETS_JS.
         include_str!("../lists/ubo-filters.txt").into(), include_str!("../lists/ubo-quick-fixes.txt").into()]
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
/// Search shortcuts ("bangs"): "!w hush" searches Wikipedia. Users add their own as `key=https://…%s` in Settings.
const BANGS: &[(&str, &str)] = &[
    ("w", "https://en.wikipedia.org/w/index.php?search=%s"), ("yt", "https://www.youtube.com/results?search_query=%s"),
    ("a", "https://www.amazon.com/s?k=%s"), ("g", "https://www.google.com/search?q=%s"), ("ddg", "https://duckduckgo.com/?q=%s"),
    ("b", "https://search.brave.com/search?q=%s"), ("gh", "https://github.com/search?q=%s"), ("r", "https://www.reddit.com/search/?q=%s"),
    ("m", "https://www.openstreetmap.org/search?query=%s"), ("i", "https://duckduckgo.com/?q=%s&ia=images&iax=images"),
    ("n", "https://duckduckgo.com/?q=%s&ia=news&iar=news"), ("imdb", "https://www.imdb.com/find/?q=%s"),
    ("so", "https://stackoverflow.com/search?q=%s"), ("wa", "https://www.wolframalpha.com/input?i=%s"),
    ("e", "https://www.ebay.com/sch/i.html?_nkw=%s"), ("maps", "https://www.google.com/maps/search/%s"),
];
pub fn bang(s: &store::Settings, t: &str) -> Option<String> {
    let words: Vec<&str> = t.split_whitespace().collect();
    let pos = words.iter().position(|w| w.starts_with('!') && w.len() > 1)?;
    let key = words[pos][1..].to_lowercase();
    let custom = s.ui.get("bangs").cloned().unwrap_or_default();
    let tpl = custom.split('|').filter_map(|x| x.split_once('=')).find(|(k, v)| k.trim().eq_ignore_ascii_case(&key) && v.trim().starts_with("https://"))
        .map(|(_, v)| v.trim().to_string()).or_else(|| BANGS.iter().find(|(k, _)| *k == key).map(|(_, v)| v.to_string()))?;
    let q: String = words.iter().enumerate().filter(|(i, _)| *i != pos).map(|(_, w)| *w).collect::<Vec<_>>().join(" ");
    let enc: String = url::form_urlencoded::byte_serialize(q.as_bytes()).collect();
    Some(if tpl.contains("%s") { tpl.replace("%s", &enc) } else { tpl })
}
pub fn resolve_with(s: &store::Settings, input: &str) -> String {
    let t = input.trim();
    if t.contains('!') { if let Some(u) = bang(s, t) { return u; } }
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
    json!({ "settings": s.settings, "bookmarks": s.bookmarks, "custom_filters": s.custom_filters.len(), "filters": s.custom_filters, "allow_sites": s.allow_sites,
            "site_dark": s.site_dark, "site_boost": s.site_boost, "session": s.session, "platform": if cfg!(mobile) { "mobile" } else { "desktop" } })
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
            let max = if matches!(name, "bangs" | "focus_sites" | "workspaces" | "fp_off") { 4000 } else { 200 };
            if name.is_empty() || name.len() > 40 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') || value.len() > max {
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
async fn bookmark_add(app: AppHandle, title: String, url: String, folder: Option<String>) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) { return Err("bad url".into()); }
    let st = app.state::<AppState>();
    let mut s = st.store.lock();
    let folder = folder.unwrap_or_default().chars().take(30).collect::<String>();
    if let Some(b) = s.bookmarks.iter_mut().find(|b| b.url == url) { b.folder = folder; } else { s.bookmarks.push(store::Bookmark { title, url, folder }); }
    store::save(&app, &s);
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
    ("ubo-filters.txt", "https://ublockorigin.github.io/uAssets/filters/filters.min.txt"),
    ("ubo-quick-fixes.txt", "https://ublockorigin.github.io/uAssets/filters/quick-fixes.min.txt"),
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
/// Save (or clear, with None) a site's Boost.
#[tauri::command]
async fn boost_set(app: AppHandle, host: String, boost: Option<store::Boost>) -> Result<(), String> {
    let host = host.trim_start_matches("www.").to_lowercase();
    if host.is_empty() || host.len() > 253 || !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') { return Err("bad host".into()); }
    let st = app.state::<AppState>();
    let mut s = st.store.lock();
    match boost {
        Some(mut b) => { b.css = b.css.chars().take(8000).collect(); b.font.truncate(20); b.tone.truncate(20); s.site_boost.insert(host, b); }
        None => { s.site_boost.remove(&host); }
    }
    refresh_page_prefs(&s);
    store::save(&app, &s);
    Ok(())
}
#[tauri::command]
async fn remove_custom_filter(app: AppHandle, filter: String) {
    { let st = app.state::<AppState>(); let mut s = st.store.lock(); s.custom_filters.retain(|f| *f != filter); store::save(&app, &s); }
    rebuild(&app);
}
/// New order for the start-page shortcuts (bookmarks not listed keep their place after these).
#[tauri::command]
async fn bookmarks_reorder(app: AppHandle, urls: Vec<String>) {
    let st = app.state::<AppState>();
    let mut s = st.store.lock();
    let mut out: Vec<store::Bookmark> = urls.iter().filter_map(|u| s.bookmarks.iter().find(|b| &b.url == u).cloned()).collect();
    for b in s.bookmarks.iter() { if !urls.contains(&b.url) { out.push(b.clone()); } }
    s.bookmarks = out;
    store::save(&app, &s);
}
/// Version of this build (CI sets HUSH_BUILD to the build number).
pub const BUILD: &str = match option_env!("HUSH_BUILD") { Some(b) => b, None => "dev" };
/// Newest Hush test build on GitHub. Errors if the repository is private (GitHub hides it without a login).
#[tauri::command]
async fn check_update() -> Result<Value, String> {
    let body = tauri::async_runtime::spawn_blocking(|| -> Result<String, String> {
        ureq::get("https://api.github.com/repos/wmitch3ll/hush/releases?per_page=1").set("User-Agent", "Hush-browser")
            .set("Accept", "application/vnd.github+json").call().map_err(|e| match e {
                ureq::Error::Status(404, _) => "private".to_string(), e => e.to_string() })?
            .into_string().map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())??;
    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let r = v.get(0).ok_or("no releases yet")?;
    let tag = r["tag_name"].as_str().unwrap_or("");
    let latest: u64 = tag.trim_start_matches("build-").parse().unwrap_or(0);
    let mine: u64 = BUILD.parse().unwrap_or(0);
    Ok(json!({ "current": BUILD, "latest": latest, "newer": mine > 0 && latest > mine, "name": r["name"], "page": r["html_url"],
               "apk": r["assets"].as_array().and_then(|a| a.iter().find(|x| x["name"].as_str().map(|n| n.ends_with(".apk")).unwrap_or(false))).map(|x| x["browser_download_url"].clone()) }))
}
#[tauri::command]
async fn app_info() -> Value { json!({ "build": BUILD, "version": env!("CARGO_PKG_VERSION"), "platform": std::env::consts::OS }) }
/// Merge bookmarks sent from another device (QR code / hush: link). Only web URLs are accepted.
#[tauri::command]
async fn import_bookmarks(app: AppHandle, items: Vec<store::Bookmark>) -> usize {
    let st = app.state::<AppState>();
    let mut s = st.store.lock();
    let mut n = 0;
    for b in items.into_iter().take(500) {
        if (b.url.starts_with("https://") || b.url.starts_with("http://")) && b.url.len() < 2048 && !s.bookmarks.iter().any(|x| x.url == b.url) {
            s.bookmarks.push(store::Bookmark { title: b.title.chars().take(200).collect(), url: b.url, folder: b.folder.chars().take(30).collect() }); n += 1;
        }
    }
    store::save(&app, &s);
    n
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
        split: Default::default(), history: Default::default(), peek: Default::default(),
    });
    #[cfg(mobile)] let b = b.plugin(tabs_plugin::init());
    #[cfg(desktop)] let b = b
        .invoke_handler(tauri::generate_handler![toggle_shield, get_state, set_setting, bookmark_add, bookmark_remove,
            add_custom_filter, export_data, import_data, update_lists,
            site_dark, get_stats, history_add, history_list, history_clear, suggest, session_save,
            check_update, app_info, import_bookmarks,
            desktop::page_action, desktop::set_split, desktop::set_rail, desktop::set_zoom, desktop::set_muted,
            desktop::toggle_fullscreen, desktop::capture_tab, desktop::peek_open, desktop::peek_close, desktop::peek_expand,
            desktop::screenshot, desktop::save_png, boost_set, remove_custom_filter, bookmarks_reorder,
            extensions::extension_list, extensions::extension_install, extensions::extension_remove,
            desktop::open_tab, desktop::switch_tab, desktop::close_tab, desktop::navigate, desktop::nav,
            desktop::clear_data, desktop::start_picker, desktop::set_layout, desktop::show_content,
            desktop::download_open, desktop::download_reveal, desktop::float_tab, desktop::float_close, tor::tor_start, tor::tor_new_identity, tor::tor_state, watch_check, msgnet::msg_ws_open, msgnet::msg_ws_send, msgnet::msg_ws_close, msgnet::blob_put, msgnet::blob_get, msgnet::secret_set, msgnet::secret_get, msgnet::secret_del])
        .setup(desktop::setup);
    #[cfg(mobile)] let b = b
        .invoke_handler(tauri::generate_handler![toggle_shield, get_state, set_setting, bookmark_add, bookmark_remove,
            add_custom_filter, export_data, import_data, update_lists,
            site_dark, get_stats, history_add, history_list, history_clear, suggest, session_save,
            check_update, app_info, import_bookmarks,
            mobile::page_action, mobile::native_call, boost_set, remove_custom_filter, bookmarks_reorder, tor::tor_start, tor::tor_new_identity, tor::tor_state, watch_check, msgnet::msg_ws_open, msgnet::msg_ws_send, msgnet::msg_ws_close, msgnet::blob_put, msgnet::blob_get,
            mobile::open_tab, mobile::switch_tab, mobile::close_tab, mobile::navigate, mobile::nav,
            mobile::clear_data, mobile::set_chrome_inset, mobile::set_web_prefs])
        .setup(mobile::setup);
    b.run(tauri::generate_context!()).expect("hush failed to start");
}

/// Security regression tests (run in CI on Windows, macOS and Linux).
#[cfg(test)]
mod security_tests {
    use super::*;
    fn cap(name: &str) -> Value { serde_json::from_str(&std::fs::read_to_string(format!("capabilities/{name}.json")).unwrap()).unwrap() }

    #[test] fn only_the_chrome_ui_can_call_hush_on_desktop() {
        // Web pages live in tab webviews; if a capability ever matched them, a website could call Hush commands.
        let c = cap("default");
        assert_eq!(c["webviews"], json!(["chrome", "rail"]));   // both are Hush's own local pages
        assert!(c.get("windows").is_none(), "a window-wide capability would include every tab");
        assert!(c.get("remote").is_none(), "remote URLs must never get IPC");
    }
    #[test] fn mobile_capability_is_the_local_chrome_only() {
        let c = cap("mobile");
        assert_eq!(c["windows"], json!(["main"]));
        assert!(c.get("remote").is_none());
    }
    #[test] fn csp_is_set_for_the_chrome_ui() {
        let conf: Value = serde_json::from_str(&std::fs::read_to_string("tauri.conf.json").unwrap()).unwrap();
        let csp = conf["app"]["security"]["csp"].as_str().unwrap_or("");
        assert!(csp.contains("default-src 'self'"), "chrome UI must not load remote code");
        assert!(!csp.contains("unsafe-eval"));
    }
    #[test] fn address_bar_never_produces_dangerous_schemes() {
        let s = store::Settings::default();
        for input in ["javascript:alert(1)", "file:///C:/Windows/win.ini", "data:text/html,<script>x</script>", "intent://x#Intent;end", "chrome://settings"] {
            let out = resolve_with(&s, input);
            assert!(out.starts_with("https://"), "{input} -> {out}");
        }
        assert_eq!(resolve_with(&s, "http://example.com"), "https://example.com");
    }
    #[test] fn page_actions_are_a_fixed_list_and_args_cannot_break_out() {
        assert!(page_action_js("eval", "x").is_err());
        let js = page_action_js("find", "\");fetch('//evil');(\"").unwrap();
        assert!(js.ends_with(r#"__hushPage.find("\");fetch('//evil');(\"",false);"#));
    }
    #[test] fn search_shortcuts() {
        let mut s = store::Settings::default();
        assert_eq!(resolve_with(&s, "!w hush browser"), "https://en.wikipedia.org/w/index.php?search=hush+browser");
        s.ui.insert("bangs".into(), "x=javascript:alert(1)|my=https://example.com/?q=%s".into());
        assert!(bang(&s, "!x hi").is_none(), "custom shortcuts must be https");
        assert_eq!(bang(&s, "!my hi").unwrap(), "https://example.com/?q=hi");
    }
}
