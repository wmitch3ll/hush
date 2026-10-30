//! Mobile tabs. Tauri's multi-webview is desktop-only, so on iOS/Android each tab is a NATIVE
//! WKWebView / WebView owned by a tiny Swift/Kotlin plugin (ios-plugin/, android-plugin/).
//! The Rust side exposes the same commands the chrome UI already uses.
use tauri::{plugin::{Builder, PluginHandle, TauriPlugin}, Manager, Runtime};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_hush_tabs);

pub struct Native<R: Runtime>(pub PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("hush-tabs")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let h = api.register_android_plugin("app.hush.browser", "TabsPlugin")?;
            #[cfg(target_os = "ios")]
            let h = api.register_ios_plugin(init_plugin_hush_tabs)?;
            app.manage(Native(h));
            Ok(())
        })
        .build()
}
// Native methods (same names both sides): openTab{url,private} closeTab{id} switchTab{id}
// navigate{url} nav{action} setShield{host,on} discardBackground{} shards{json[]}  (iOS)
