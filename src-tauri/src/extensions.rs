//! Desktop browser extensions (Windows WebView2): install Chrome Web Store extensions as unpacked folders in
//! <app data>/extensions/<id>/, loaded into every tab. Each extension keeps its Web Store ID (the publisher's public key
//! from the .crx is written into manifest.json), so chrome-extension://<id>/ pages and the extension's own data work.
use serde_json::{json, Value};
use std::{fs, io::Read, path::PathBuf};
use tauri::AppHandle;

pub fn dir(app: &AppHandle) -> PathBuf { let d = crate::store::dir(app).join("extensions"); let _ = fs::create_dir_all(&d); d }

/// Chrome extension IDs are 32 letters a–p.
fn is_id(s: &str) -> bool { s.len() == 32 && s.bytes().all(|b| (b'a'..=b'p').contains(&b)) }
fn id_from(input: &str) -> Option<String> {
    let t = input.trim().trim_end_matches('/');
    if is_id(t) { return Some(t.to_string()); }
    t.split(['/', '?', '#']).find(|p| is_id(p)).map(str::to_string)
}
fn id_of_key(key: &[u8]) -> String {
    use sha2::Digest;
    sha2::Sha256::digest(key)[..16].iter().flat_map(|b| [b >> 4, b & 15]).map(|n| (b'a' + n) as char).collect()
}
/// Minimal protobuf walk over the CRX3 header: CrxFileHeader { 2|3: AsymmetricKeyProof { 1: public_key } }.
fn crx_keys(h: &[u8]) -> Vec<Vec<u8>> {
    fn varint(b: &[u8], i: &mut usize) -> Option<u64> { let (mut v, mut s) = (0u64, 0); loop { let x = *b.get(*i)?; *i += 1; v |= ((x & 0x7f) as u64) << s; if x < 0x80 { return Some(v); } s += 7; if s > 63 { return None; } } }
    fn fields(b: &[u8]) -> Vec<(u64, Vec<u8>)> { let mut out = vec![]; let mut i = 0;
        while i < b.len() { let Some(tag) = varint(b, &mut i) else { break }; match tag & 7 {
            0 => { if varint(b, &mut i).is_none() { break } }
            2 => { let Some(n) = varint(b, &mut i) else { break }; let e = i + n as usize; if e > b.len() { break } out.push((tag >> 3, b[i..e].to_vec())); i = e; }
            5 => i += 4, 1 => i += 8, _ => break } }
        out }
    fields(h).into_iter().filter(|(f, _)| *f == 2 || *f == 3)
        .flat_map(|(_, proof)| fields(&proof).into_iter().filter(|(f, _)| *f == 1).map(|(_, k)| k)).collect()
}
fn localized(dir: &PathBuf, m: &Value, field: &str) -> String {
    let v = m[field].as_str().unwrap_or("").to_string();
    let Some(key) = v.strip_prefix("__MSG_").and_then(|x| x.strip_suffix("__")) else { return v };
    let loc = m["default_locale"].as_str().unwrap_or("en");
    fs::read_to_string(dir.join("_locales").join(loc).join("messages.json")).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|j| j.as_object().and_then(|o| o.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v["message"].as_str().unwrap_or("").to_string())))
        .unwrap_or(v)
}
fn describe(id: &str, d: &PathBuf) -> Option<Value> {
    let m: Value = serde_json::from_str(&fs::read_to_string(d.join("manifest.json")).ok()?).ok()?;
    let popup = m["action"]["default_popup"].as_str().or(m["browser_action"]["default_popup"].as_str()).map(str::to_string);
    let options = m["options_ui"]["page"].as_str().or(m["options_page"].as_str()).map(str::to_string);
    Some(json!({ "id": id, "name": localized(d, &m, "name"), "version": m["version"], "popup": popup, "options": options }))
}
pub fn installed(app: &AppHandle, id: &str) -> bool { is_id(id) && dir(app).join(id).join("manifest.json").exists() }

#[tauri::command]
pub async fn extension_list(app: AppHandle) -> Vec<Value> {
    let d = dir(&app);
    let mut v: Vec<Value> = fs::read_dir(&d).map(|r| r.flatten().filter_map(|e| { let id = e.file_name().to_string_lossy().to_string();
        if is_id(&id) { describe(&id, &e.path()) } else { None } }).collect()).unwrap_or_default();
    v.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    v
}
#[tauri::command]
pub async fn extension_remove(app: AppHandle, id: String) -> Result<(), String> {
    if !is_id(&id) { return Err("bad id".into()); }
    fs::remove_dir_all(dir(&app).join(&id)).map_err(|e| e.to_string())
}
/// Download from the Chrome Web Store (link or ID), verify the ID matches the publisher key, unpack safely.
#[tauri::command]
pub async fn extension_install(app: AppHandle, input: String) -> Result<Value, String> {
    let id = id_from(&input).ok_or("Paste a Chrome Web Store link or a 32-letter extension ID")?;
    let url = format!("https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0.0.0&acceptformat=crx3&x=id%3D{id}%26installsource%3Dondemand%26uc");
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let r = ureq::get(&url).set("User-Agent", "Mozilla/5.0 Hush").call().map_err(|e| format!("download failed: {e}"))?;
        let mut b = vec![]; r.into_reader().take(60 << 20).read_to_end(&mut b).map_err(|e| e.to_string())?; Ok(b)
    }).await.map_err(|e| e.to_string())??;
    if bytes.len() < 16 || &bytes[..4] != b"Cr24" { return Err("That isn't an extension package (is the ID right?)".into()); }
    let ver = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    if ver != 3 { return Err("Unsupported extension format".into()); }
    let hl = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    let header = bytes.get(12..12 + hl).ok_or("Damaged extension package")?;
    let key = crx_keys(header).into_iter().find(|k| id_of_key(k) == id).ok_or("Package signature doesn't match this extension ID")?;
    let target = dir(&app).join(&id);
    let tmp = dir(&app).join(format!("{id}.tmp"));
    let _ = fs::remove_dir_all(&tmp);
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(&bytes[12 + hl..])).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = f.enclosed_name() else { continue };          // refuses ../ and absolute paths
        let out = tmp.join(rel);
        if f.is_dir() { fs::create_dir_all(&out).map_err(|e| e.to_string())?; continue; }
        if let Some(p) = out.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
        let mut buf = vec![]; f.read_to_end(&mut buf).map_err(|e| e.to_string())?; fs::write(&out, buf).map_err(|e| e.to_string())?;
    }
    let mp = tmp.join("manifest.json");
    let mut m: Value = serde_json::from_str(&fs::read_to_string(&mp).map_err(|_| "No manifest in package")?).map_err(|e| e.to_string())?;
    use base64::Engine;
    m["key"] = Value::String(base64::engine::general_purpose::STANDARD.encode(&key));
    fs::write(&mp, serde_json::to_string_pretty(&m).unwrap()).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&target);
    fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
    describe(&id, &target).ok_or("Installed, but couldn't read it".into())
}
