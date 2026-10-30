//! WebView2: block subresources BEFORE any network activity via WebResourceRequested.
use crate::blocker::Blocker;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use webview2_com::{take_pwstr, Microsoft::Web::WebView2::Win32::*, WebResourceRequestedEventHandler};
use windows::core::{w, Interface, PWSTR};

fn kind(c: COREWEBVIEW2_WEB_RESOURCE_CONTEXT) -> &'static str {
    match c {
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT => "script",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE => "image",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET => "stylesheet",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST | COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH => "xmlhttprequest",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA => "media",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT => "font",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT => "document",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET => "websocket",
        _ => "other",
    }
}

/// Call once per tab webview, right after creation.
pub fn install(wv: &tauri::Webview, blocker: Arc<Blocker>) {
    let app = wv.app_handle().clone();
    let label = wv.label().to_string();
    let _ = wv.with_webview(move |p| unsafe {
        let Ok(core) = p.controller().CoreWebView2() else { return };
        let _ = core.AddWebResourceRequestedFilter(w!("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
        // Strict tracking prevention: blocks third-party tracking cookies and storage (same profile for every tab).
        if let Ok(c13) = core.cast::<ICoreWebView2_13>() {
            if let Ok(p3) = c13.Profile().and_then(|p| p.cast::<ICoreWebView2Profile3>()) {
                let _ = p3.SetPreferredTrackingPreventionLevel(COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_STRICT);
            }
        }
        let core2 = core.clone();
        let handler = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let req = args.Request()?;
            let mut uri = PWSTR::null();
            req.Uri(&mut uri)?;
            let uri = take_pwstr(uri);
            let mut ctx = COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
            args.ResourceContext(&mut ctx)?;
            let mut src = PWSTR::null();
            core2.Source(&mut src)?;
            let src = take_pwstr(src);
            // Blocker::check_request is lock-light (RwLock read); safe on the UI thread.
            if blocker.check_request(&uri, if src.is_empty() { &uri } else { &src }, kind(ctx)) {
                let n = blocker.bump(&label);
                let _ = app.emit("blocked", serde_json::json!({ "tab": label, "count": n }));
                let env = core2.cast::<ICoreWebView2_2>()?.Environment()?;
                let resp = env.CreateWebResourceResponse(None, 403, w!("Blocked"), w!(""))?;
                args.SetResponse(&resp)?;
            }
            Ok(())
        }));
        let mut token = Default::default();
        let _ = core.add_WebResourceRequested(&handler, &mut token);
    });
}

/// Browser shortcuts while a web page has focus. WebView2 sends keys to the page, not to the chrome UI, so we catch them
/// natively (a page can't fake these) and forward them as a `shortcut` event. Keys we don't list go to the page as usual.
pub fn install_shortcuts(wv: &tauri::Webview) {
    use windows::Win32::UI::Input::KeyboardAndMouse::GetKeyState;
    let app = wv.app_handle().clone();
    let _ = wv.with_webview(move |p| unsafe {
        let controller = p.controller();
        let handler = webview2_com::AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
            args.KeyEventKind(&mut kind)?;
            if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN { return Ok(()); }
            let mut vk = 0u32;
            args.VirtualKey(&mut vk)?;
            let down = |k: i32| GetKeyState(k) < 0;
            let (ctrl, shift) = (down(0x11), down(0x10));
            if vk == 0x7A { args.SetHandled(true)?; let a = app.clone();               // F11: fullscreen
                tauri::async_runtime::spawn(async move { let _ = a.emit_to("chrome", "shortcut", serde_json::json!({ "key": "f11" })); }); return Ok(()); }
            if !ctrl { return Ok(()); }
            let digit = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
            let name = match vk {
                0x4E if shift => "shift+n", 0x54 if shift => "shift+t", 0x42 if shift => "shift+b", 0x53 if shift => "shift+s", 0x52 if shift => "shift+r", 0x41 if shift => "shift+a", 0x4D if shift => "shift+m", 0x45 if shift => "shift+e", 0x4F if shift => "shift+o",
                0x31..=0x39 => digit[(vk - 0x31) as usize], 0x30 => "0", 0xBB | 0x6B => "+", 0xBD | 0x6D => "-",
                0x4D => "m", 0x47 => "g",
                0x54 => "t", 0x57 => "w", 0x4C => "l", 0x44 => "d", 0x42 => "b", 0x4A => "j", 0xBC => ",",
                0x4B => "k", 0x46 => "f", 0x45 => "e", 0x48 => "h", 0xDC => "\\",
                0x09 if shift => "shift+tab", 0x09 => "tab",
                _ => return Ok(()),
            };
            args.SetHandled(true)?;
            // Typing shortcuts (new tab, address bar) need the chrome webview focused; do it outside this callback.
            let a = app.clone();
            let focus = matches!(name, "t" | "l" | "," | "k" | "f" | "h" | "shift+n" | "g");
            tauri::async_runtime::spawn(async move {
                if focus { if let Some(c) = a.get_webview("chrome") { let _ = c.set_focus(); } }
                let _ = a.emit_to("chrome", "shortcut", serde_json::json!({ "key": name }));
            });
            Ok(())
        }));
        let mut token = Default::default();
        let _ = controller.add_AcceleratorKeyPressed(&handler, &mut token);
    });
}

/// Raise this webview's native container window above its siblings (used for the slide-over tab bar).
pub fn raise(wv: &tauri::Webview) {
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE};
    let _ = wv.with_webview(|p| unsafe {
        let mut parent = windows::Win32::Foundation::HWND::default();
        if p.controller().ParentWindow(&mut parent).is_ok() && !parent.is_invalid() {
            let _ = SetWindowPos(parent, Some(HWND_TOP), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    });
}

pub fn mute(wv: &tauri::Webview, muted: bool) {
    let _ = wv.with_webview(move |p| unsafe {
        if let Ok(c8) = p.controller().CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_8>()) { let _ = c8.SetIsMuted(muted); }
    });
}

/// Page title and audio changes -> chrome + tab bar; preview capture when a page finishes loading.
pub fn install_extras(wv: &tauri::Webview) {
    let app = wv.app_handle().clone();
    let label = wv.label().to_string();
    let wv2 = wv.clone();
    let _ = wv.with_webview(move |p| unsafe {
        let Ok(core) = p.controller().CoreWebView2() else { return };
        let (a1, l1, c1) = (app.clone(), label.clone(), core.clone());
        let h = webview2_com::DocumentTitleChangedEventHandler::create(Box::new(move |_, _| {
            let mut t = PWSTR::null();
            if c1.DocumentTitle(&mut t).is_ok() {
                let title = take_pwstr(t);
                let p = serde_json::json!({ "tab": l1, "title": title });
                let _ = a1.emit_to("chrome", "tab-title", p.clone()); let _ = a1.emit_to("rail", "tab-title", p);
            }
            Ok(())
        }));
        let mut tok = Default::default();
        let _ = core.add_DocumentTitleChanged(&h, &mut tok);
        let (a2, l2) = (app.clone(), label.clone());
        if let Ok(c8) = core.cast::<ICoreWebView2_8>() {
            let c8b = c8.clone();
            let h = webview2_com::IsDocumentPlayingAudioChangedEventHandler::create(Box::new(move |_, _| {
                let mut on = windows::core::BOOL::default();
                let _ = c8b.IsDocumentPlayingAudio(&mut on);
                let p = serde_json::json!({ "tab": l2, "audio": on.as_bool() });
                let _ = a2.emit_to("chrome", "tab-audio", p.clone()); let _ = a2.emit_to("rail", "tab-audio", p);
                Ok(())
            }));
            let mut tok = Default::default();
            let _ = c8.add_IsDocumentPlayingAudioChanged(&h, &mut tok);
        }
        let (w3, a3, l3) = (wv2.clone(), app.clone(), label.clone());
        let h = webview2_com::NavigationCompletedEventHandler::create(Box::new(move |_, _| {
            let (w, a, l) = (w3.clone(), a3.clone(), l3.clone());
            // Only snapshot the tab you're looking at (hidden tabs can't be captured).
            tauri::async_runtime::spawn(async move { tokio_sleep(900).await;
                if a.state::<crate::AppState>().active.lock().as_deref() == Some(l.as_str()) { capture(&w); } });
            Ok(())
        }));
        let mut tok = Default::default();
        let _ = core.add_NavigationCompleted(&h, &mut tok);
    });
}
async fn tokio_sleep(ms: u64) { let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(std::time::Duration::from_millis(ms))).await; }

/// JPEG snapshot of what the tab shows -> `thumb {tab, data}` to the tab bar.
/// DevTools screenshot of the current frame (no resize/emulation, so nothing flickers on screen).
pub fn capture(wv: &tauri::Webview) {
    let app = wv.app_handle().clone();
    let label = wv.label().to_string();
    let dbg = |app: &tauri::AppHandle, label: &str, msg: String| { let _ = app.emit_to("chrome", "diag", serde_json::json!({ "what": "preview", "tab": label, "msg": msg })); };
    let (a0, l0) = (app.clone(), label.clone());
    let r = wv.with_webview(move |p| unsafe {
        let core = match p.controller().CoreWebView2() { Ok(c) => c, Err(e) => { dbg(&a0, &l0, format!("no core: {e}")); return } };
        let (a1, l1) = (a0.clone(), l0.clone());
        let h2 = webview2_com::CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |res, json| {
            match res {
                Ok(()) => match serde_json::from_str::<serde_json::Value>(&json).ok().and_then(|v| v["data"].as_str().map(str::to_string)) {
                    Some(d) => {
                        let n = d.len();
                        let _ = a1.emit_to("rail", "thumb", serde_json::json!({ "tab": l1, "data": format!("data:image/jpeg;base64,{d}") }));
                        dbg(&a1, &l1, format!("ok {n} bytes"));
                    }
                    None => dbg(&a1, &l1, format!("no data: {}", json.chars().take(160).collect::<String>())),
                },
                Err(e) => dbg(&a1, &l1, format!("devtools error: {e}")),
            }
            Ok(())
        }));
        let m: Vec<u16> = "Page.captureScreenshot\0".encode_utf16().collect();
        let pr: Vec<u16> = "{\"format\":\"jpeg\",\"quality\":40,\"fromSurface\":true}\0".encode_utf16().collect();
        if let Err(e) = core.CallDevToolsProtocolMethod(windows::core::PCWSTR(m.as_ptr()), windows::core::PCWSTR(pr.as_ptr()), &h2) { dbg(&a0, &l0, format!("call failed: {e}")); }
    });
    if let Err(e) = r { dbg(&app, &label, format!("with_webview: {e}")); }
}

/// Screenshot via the DevTools protocol (full page or visible area) -> `screenshot {data}` to the chrome UI.
pub fn screenshot(wv: &tauri::Webview, full: bool) {
    let app = wv.app_handle().clone();
    let _ = wv.with_webview(move |p| unsafe {
        let Ok(core) = p.controller().CoreWebView2() else { return };
        let params = if full { r#"{"format":"png","captureBeyondViewport":true}"# } else { r#"{"format":"png"}"# };
        let a = app.clone();
        let h = webview2_com::CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |res, json| {
            if res.is_ok() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
                    if let Some(d) = v["data"].as_str() { let _ = a.emit_to("chrome", "screenshot", serde_json::json!({ "data": format!("data:image/png;base64,{d}") })); }
                }
            }
            Ok(())
        }));
        let m: Vec<u16> = "Page.captureScreenshot\0".encode_utf16().collect();
        let pr: Vec<u16> = format!("{params}\0").encode_utf16().collect();
        let _ = core.CallDevToolsProtocolMethod(windows::core::PCWSTR(m.as_ptr()), windows::core::PCWSTR(pr.as_ptr()), &h);
    });
}
