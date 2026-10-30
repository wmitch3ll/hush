//! Mobile shell: tabs are native views in the Swift/Kotlin plugin; these commands forward to it.
//! Commands are `async` because plugin calls block, and sync commands run on the main thread (deadlock).
use crate::{resolve_app, tabs_plugin::Native};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Wry};

fn call(app: &AppHandle, cmd: &str, payload: Value) -> Result<Value, String> {
    app.state::<Native<Wry>>().0.run_mobile_plugin(cmd, payload).map_err(|e| e.to_string())
}

/// iOS: compile rule-list shards off the main thread (WebKit compiles + caches them).
#[cfg(target_os = "ios")]
pub fn push_shards(app: &AppHandle) {
    let h = app.clone();
    std::thread::spawn(move || {
        let custom = h.state::<crate::AppState>().store.lock().custom_filters.clone();
        let lists = crate::store::lists_override(&h).unwrap_or_else(crate::load_lists);
        let shards = crate::blocker::Blocker::webkit_rule_shards(&lists, &custom);
        let _ = call(&h, "shards", json!({ "shards": shards }));
    });
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    crate::init_state(app.handle());
    #[cfg(target_os = "ios")] push_shards(app.handle());
    Ok(())
}

#[tauri::command]
pub async fn open_tab(app: AppHandle, input: String, private: Option<bool>) -> Result<String, String> {
    let v = call(&app, "openTab", json!({ "url": resolve_app(&app, &input), "isPrivate": private.unwrap_or(false) }))?;
    Ok(v["id"].as_str().unwrap_or_default().to_string())
}
#[tauri::command] pub async fn switch_tab(app: AppHandle, label: String) { let _ = call(&app, "switchTab", json!({ "id": label })); }
#[tauri::command] pub async fn close_tab(app: AppHandle, label: String) { let _ = call(&app, "closeTab", json!({ "id": label })); }
#[tauri::command] pub async fn navigate(app: AppHandle, input: String) { let _ = call(&app, "navigate", json!({ "url": resolve_app(&app, &input) })); }
#[tauri::command] pub async fn nav(app: AppHandle, action: String) { let _ = call(&app, "nav", json!({ "action": action })); }
#[tauri::command] pub async fn clear_data(app: AppHandle) { let _ = call(&app, "clearData", json!({})); }
/// Space the chrome bars occupy at the top and bottom; native tab views sit between. Android = device px, iOS = points.
#[tauri::command] pub async fn set_chrome_inset(app: AppHandle, px: i32, bottom: Option<i32>) {
    let _ = call(&app, "setTopInset", json!({ "px": px.clamp(0, 4000), "bottom": bottom.unwrap_or(0).clamp(0, 4000) }));
}
/// Page text size (percent) and "desktop site" for every tab.
#[tauri::command] pub async fn set_web_prefs(app: AppHandle, text_zoom: i32, desktop: bool, pull_refresh: Option<bool>, bg_play: Option<bool>) {
    let _ = call(&app, "setPrefs", json!({ "textZoom": text_zoom.clamp(50, 200), "desktop": desktop, "pullRefresh": pull_refresh.unwrap_or(true), "bgPlay": bg_play.unwrap_or(true) }));
}

/// Page tools in the active tab. Find uses Android's native find (match counts come back as a `find` event);
/// everything else runs the shared page script.
#[tauri::command]
pub async fn page_action(app: AppHandle, action: String, arg: Option<String>) -> Result<(), String> {
    let q = arg.unwrap_or_default();
    if action.starts_with("find") {
        call(&app, "find", json!({ "query": q, "action": action })).map(|_| ())
    } else {
        call(&app, "evalJs", json!({ "js": crate::page_action_js(&action, &q)? })).map(|_| ())
    }
}

/// Phone-only actions that go straight to the native plugin. Only these names are allowed.
#[tauri::command]
pub async fn native_call(app: AppHandle, cmd: String, args: Option<Value>) -> Result<Value, String> {
    const ALLOWED: &[&str] = &["takeIntent", "askDefault", "isDefault", "pip", "permissionReply", "sitePerms", "resetSitePerms",
        "printPage", "voice", "discardBackground", "muteTab", "listen", "peek", "peekClose", "screenshot", "saveImage", "pick", "torMode"];
    if !ALLOWED.contains(&cmd.as_str()) { return Err("not allowed".into()); }
    call(&app, &cmd, args.unwrap_or(json!({})))
}
