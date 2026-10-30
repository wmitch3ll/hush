//! C ABI the Swift plugin calls directly (same idea as android_jni.rs): cosmetic JS for a URL.
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

#[no_mangle]
pub extern "C" fn hush_cosmetic_js(url: *const c_char) -> *mut c_char {
    if url.is_null() { return std::ptr::null_mut(); }
    let u = unsafe { CStr::from_ptr(url) }.to_string_lossy().into_owned();
    let js = crate::BLOCKER.get().map(|b| b.cosmetic_js(&u)).unwrap_or_default();
    CString::new(js).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut())
}
#[no_mangle]
pub extern "C" fn hush_free(p: *mut c_char) { if !p.is_null() { unsafe { drop(CString::from_raw(p)); } } }
