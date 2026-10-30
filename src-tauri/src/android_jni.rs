//! Kotlin WebViewClient.shouldInterceptRequest runs on a worker thread and needs a SYNC answer,
//! so we expose the engine over JNI instead of going through Tauri IPC.
use jni::{objects::{JClass, JString}, sys::jboolean, JNIEnv};


#[no_mangle]
pub extern "system" fn Java_app_hush_browser_Native_shouldBlock(
    mut env: JNIEnv, _c: JClass, url: JString, source: JString, kind: JString) -> jboolean {
    let get = |env: &mut JNIEnv, s: &JString| env.get_string(s).map(|s| s.into()).unwrap_or_else(|_| String::new());
    let (u, s, k): (String, String, String) = (get(&mut env, &url), get(&mut env, &source), get(&mut env, &kind));
    // A Rust panic must never cross into Java: it would abort the whole app (inside WebView's thread).
    std::panic::catch_unwind(|| crate::BLOCKER.get().map(|b| b.check_request(&u, &s, &k)).unwrap_or(false))
        .unwrap_or(false) as jboolean
}

#[no_mangle]
pub extern "system" fn Java_app_hush_browser_Native_cosmeticJs(
    mut env: JNIEnv, _c: JClass, url: JString) -> jni::sys::jstring {
    let u: String = env.get_string(&url).map(|s| s.into()).unwrap_or_default();
    let js = std::panic::catch_unwind(|| crate::BLOCKER.get().map(|b| b.cosmetic_js(&u)).unwrap_or_default()).unwrap_or_default();
    env.new_string(js).map(|s| s.into_raw()).unwrap_or(std::ptr::null_mut())
}
