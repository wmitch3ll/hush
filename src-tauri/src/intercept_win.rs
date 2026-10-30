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
            if !ctrl { return Ok(()); }
            let name = match vk {
                0x54 => "t", 0x57 => "w", 0x4C => "l", 0x44 => "d", 0x42 => "b", 0x4A => "j", 0xBC => ",",
                0x09 if shift => "shift+tab", 0x09 => "tab",
                _ => return Ok(()),
            };
            args.SetHandled(true)?;
            // Typing shortcuts (new tab, address bar) need the chrome webview focused; do it outside this callback.
            let a = app.clone();
            let focus = matches!(name, "t" | "l" | ",");
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
