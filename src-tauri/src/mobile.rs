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
pub async fn open_tab(app: AppHandle, input: String) -> Result<String, String> {
    let v = call(&app, "openTab", json!({ "url": resolve_app(&app, &input), "isPrivate": false }))?;
    Ok(v["id"].as_str().unwrap_or_default().to_string())
}
#[tauri::command] pub async fn switch_tab(app: AppHandle, label: String) { let _ = call(&app, "switchTab", json!({ "id": label })); }
#[tauri::command] pub async fn close_tab(app: AppHandle, label: String) { let _ = call(&app, "closeTab", json!({ "id": label })); }
#[tauri::command] pub async fn navigate(app: AppHandle, input: String) { let _ = call(&app, "navigate", json!({ "url": resolve_app(&app, &input) })); }
#[tauri::command] pub async fn nav(app: AppHandle, action: String) { let _ = call(&app, "nav", json!({ "action": action })); }
#[tauri::command] pub async fn clear_data(app: AppHandle) { let _ = call(&app, "clearData", json!({})); }
/// Space (px) the chrome bar occupies; native tab views start below it. Android = device px, iOS = points.
#[tauri::command] pub async fn set_chrome_inset(app: AppHandle, px: i32) { let _ = call(&app, "setTopInset", json!({ "px": px })); }
