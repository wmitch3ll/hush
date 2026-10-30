//! Local-only persistence: one JSON file in the app data dir (settings, bookmarks, custom filters, allow list).
//! No network, no accounts. Downloaded filter-list overrides live in <data>/lists/.
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Settings { pub search: String, pub custom_search: String, pub theme: String, pub counter: bool,
    /// UI preferences set from the chrome (`ui.<name>` keys): tabs_pos, tabs_mode, hide_delay, bar_pos, density...
    pub ui: std::collections::BTreeMap<String, String> }
impl Default for Settings {
    fn default() -> Self { Self { search: "duckduckgo".into(), custom_search: String::new(), theme: "system".into(), counter: !cfg!(mobile),
        ui: Default::default() } }
}
impl Settings {
    /// URL template with %s for the encoded query.
    pub fn search_template(&self) -> String {
        match self.search.as_str() {
            "brave" => "https://search.brave.com/search?q=%s".to_string(),
            "startpage" => "https://www.startpage.com/do/search?q=%s".to_string(),
            "ecosia" => "https://www.ecosia.org/search?q=%s".to_string(),
            "custom" if self.custom_search.starts_with("https://") && self.custom_search.contains("%s") => self.custom_search.clone(),
            _ => "https://duckduckgo.com/?q=%s".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Bookmark { pub title: String, pub url: String, #[serde(default)] pub folder: String }

/// One open tab remembered for "restore tabs" (opt-in).
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct SessionTab { pub url: String, pub ws: String }

/// Blocked-request totals for the start-page stats. Counts only, never URLs.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct Stats { pub total: u64, pub week: u64, pub week_id: u64 }

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct Store { pub settings: Settings, pub bookmarks: Vec<Bookmark>, pub custom_filters: Vec<String>, pub allow_sites: Vec<String>,
    /// Per-site "force dark" override: host -> on/off (absent = follow the global setting).
    pub site_dark: std::collections::BTreeMap<String, bool>,
    pub session: Vec<SessionTab>,
    pub stats: Stats }

/// Opt-in browsing history, kept in its own file (history.json) so the main store stays small.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Hist { pub url: String, pub title: String, pub t: u64 }
pub fn load_history(app: &AppHandle) -> Vec<Hist> {
    fs::read_to_string(dir(app).join("history.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}
pub fn save_history(app: &AppHandle, h: &[Hist]) {
    let p = dir(app).join("history.json");
    if h.is_empty() { let _ = fs::remove_file(p); return; }
    if let Ok(j) = serde_json::to_string(h) { let tmp = dir(app).join("history.json.tmp"); if fs::write(&tmp, j).is_ok() { let _ = fs::rename(tmp, p); } }
}

pub fn dir(app: &AppHandle) -> PathBuf {
    let d = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("hush"));
    let _ = fs::create_dir_all(&d);
    d
}
pub fn load(app: &AppHandle) -> Store {
    fs::read_to_string(dir(app).join("store.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}
pub fn save(app: &AppHandle, s: &Store) {
    if let Ok(j) = serde_json::to_string_pretty(s) {
        let tmp = dir(app).join("store.json.tmp");
        if fs::write(&tmp, j).is_ok() { let _ = fs::rename(tmp, dir(app).join("store.json")); } // atomic-ish
    }
}
/// Updated lists downloaded by the user (if any). None -> use the bundled lists.
pub fn lists_override(app: &AppHandle) -> Option<Vec<String>> {
    let rd = fs::read_dir(dir(app).join("lists")).ok()?;
    let mut v: Vec<(String, String)> = rd.flatten().filter_map(|e| {
        let n = e.file_name().to_string_lossy().to_string();
        n.ends_with(".txt").then(|| fs::read_to_string(e.path()).ok().map(|t| (n, t))).flatten()
    }).collect();
    v.sort();
    if v.is_empty() { None } else { Some(v.into_iter().map(|(_, t)| t).collect()) }
}
