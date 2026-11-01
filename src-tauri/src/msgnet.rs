//! Messenger network: WebSocket connections to Nostr relays, ALWAYS through Tor (no direct fallback).
//! The UI does all crypto (NIP-17/44/59, ui/vendor/nostr.js); Rust only carries opaque JSON frames.
use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

static CONNS: LazyLock<Mutex<HashMap<u32, mpsc::UnboundedSender<Option<String>>>>> = LazyLock::new(Default::default);
static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

fn ev(app: &AppHandle, id: u32, t: &str, d: &str) {
    let _ = app.emit("msg-ws", serde_json::json!({ "id": id, "t": t, "d": d }));
}

/// Open wss://relay through Tor. Returns a connection id; frames arrive as `msg-ws {id, t: open|msg|close, d}`.
#[tauri::command]
pub async fn msg_ws_open(app: AppHandle, url: String) -> Result<u32, String> {
    let u = url::Url::parse(&url).map_err(|e| e.to_string())?;
    if u.scheme() != "wss" { return Err("relays must use wss://".into()); }
    let host = u.host_str().ok_or("no host")?.to_string();
    let port = u.port().unwrap_or(443);
    let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let (tx, mut rx) = mpsc::unbounded_channel::<Option<String>>();
    CONNS.lock().insert(id, tx);
    tauri::async_runtime::spawn(async move {
        let r: Result<(), String> = async {
            let tor = crate::tor::connect(&app, &host, port).await?;
            let mut roots = rustls::RootCertStore::empty();
            roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            let cfg = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                .with_safe_default_protocol_versions().map_err(|e| e.to_string())?
                .with_root_certificates(roots).with_no_client_auth();
            let name = rustls::pki_types::ServerName::try_from(host.clone()).map_err(|e| e.to_string())?;
            let tls = tokio_rustls::TlsConnector::from(Arc::new(cfg)).connect(name, tor).await.map_err(|e| format!("TLS: {e}"))?;
            let (ws, _) = tokio_tungstenite::client_async(url.as_str(), tls).await.map_err(|e| format!("WebSocket: {e}"))?;
            let (mut w, mut r) = ws.split();
            ev(&app, id, "open", "");
            loop {
                tokio::select! {
                    out = rx.recv() => match out {
                        Some(Some(text)) => { w.send(Message::Text(text.into())).await.map_err(|e| e.to_string())?; }
                        _ => { let _ = w.close().await; break; }
                    },
                    inc = r.next() => match inc {
                        Some(Ok(Message::Text(t))) => ev(&app, id, "msg", t.as_ref()),
                        Some(Ok(Message::Ping(p))) => { let _ = w.send(Message::Pong(p)).await; }
                        Some(Ok(Message::Close(_))) | None => break,
                        Some(Ok(_)) => {}
                        Some(Err(e)) => return Err(e.to_string()),
                    }
                }
            }
            Ok(())
        }.await;
        CONNS.lock().remove(&id);
        ev(&app, id, "close", &r.err().unwrap_or_default());
    });
    Ok(id)
}
#[tauri::command]
pub fn msg_ws_send(id: u32, data: String) -> Result<(), String> {
    if data.len() > 512 * 1024 { return Err("too large".into()); }
    CONNS.lock().get(&id).ok_or("not connected")?.send(Some(data)).map_err(|_| "closed".to_string())
}
#[tauri::command]
pub fn msg_ws_close(id: u32) { if let Some(tx) = CONNS.lock().remove(&id) { let _ = tx.send(None); } }

// ---------- Encrypted file hosting (Blossom) over Tor ----------
// The UI encrypts files (AES-256-GCM) before they get here; servers only ever store random-looking bytes, and every
// request goes through Tor, so a server sees neither who uploads nor who downloads.
async fn tls_over_tor(app: &AppHandle, host: &str, port: u16) -> Result<tokio_rustls::client::TlsStream<arti_client::DataStream>, String> {
    let tor = crate::tor::connect(app, host, port).await?;
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let mut cfg = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions().map_err(|e| e.to_string())?
        .with_root_certificates(roots).with_no_client_auth();
    cfg.alpn_protocols = vec![b"http/1.1".to_vec()];
    let name = rustls::pki_types::ServerName::try_from(host.to_string()).map_err(|e| e.to_string())?;
    tokio_rustls::TlsConnector::from(Arc::new(cfg)).connect(name, tor).await.map_err(|e| format!("TLS: {e}"))
}
/// Minimal HTTPS/1.1 request over Tor (one request per connection). Returns (status, body).
pub async fn https(app: &AppHandle, method: &str, url: &str, headers: &[(String, String)], body: &[u8], max: usize) -> Result<(u16, Vec<u8>), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let u = url::Url::parse(url).map_err(|e| e.to_string())?;
    if u.scheme() != "https" { return Err("https only".into()); }
    let host = u.host_str().ok_or("no host")?.to_string();
    let mut s = tls_over_tor(app, &host, u.port().unwrap_or(443)).await?;
    let path = match u.query() { Some(q) => format!("{}?{}", u.path(), q), None => u.path().to_string() };
    let mut req = format!("{method} {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: Mozilla/5.0\r\nAccept: */*\r\nConnection: close\r\nContent-Length: {}\r\n", body.len());
    for (k, v) in headers { if k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && !v.contains(['\r', '\n']) { req.push_str(&format!("{k}: {v}\r\n")); } }
    req.push_str("\r\n");
    s.write_all(req.as_bytes()).await.map_err(|e| e.to_string())?;
    if !body.is_empty() { s.write_all(body).await.map_err(|e| e.to_string())?; }
    s.flush().await.map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    let mut chunk = vec![0u8; 64 * 1024];
    loop {
        match s.read(&mut chunk).await { Ok(0) => break, Ok(n) => { buf.extend_from_slice(&chunk[..n]); if buf.len() > max + 64 * 1024 { return Err("response too large".into()); } }
            Err(e) if buf.is_empty() => return Err(e.to_string()), Err(_) => break }   // some servers drop TLS without close_notify
    }
    let end = buf.windows(4).position(|w| w == b"\r\n\r\n").ok_or("bad response")?;
    let head = String::from_utf8_lossy(&buf[..end]).to_string();
    let status: u16 = head.split_whitespace().nth(1).and_then(|x| x.parse().ok()).ok_or("bad status")?;
    let lower = head.to_ascii_lowercase();
    let mut rest = buf[end + 4..].to_vec();
    if lower.contains("transfer-encoding: chunked") {
        let mut out = Vec::new(); let mut i = 0;
        loop {
            let nl = rest[i..].windows(2).position(|w| w == b"\r\n").ok_or("bad chunk")? + i;
            let n = usize::from_str_radix(String::from_utf8_lossy(&rest[i..nl]).split(';').next().unwrap_or("0").trim(), 16).map_err(|e| e.to_string())?;
            if n == 0 { break; }
            let st = nl + 2; if st + n > rest.len() { return Err("truncated".into()); }
            out.extend_from_slice(&rest[st..st + n]); i = st + n + 2;
        }
        rest = out;
    } else if let Some(cl) = lower.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse::<usize>().ok()) {
        rest.truncate(cl);
    }
    Ok((status, rest))
}
/// Upload an (already encrypted) blob: raw request body, headers x-hush-server + x-hush-auth. Returns the server's JSON.
#[tauri::command]
pub async fn blob_put(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<serde_json::Value, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else { return Err("expected bytes".into()) };
    let h = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_string);
    let server = h("x-hush-server").ok_or("no server")?; let auth = h("x-hush-auth").ok_or("no auth")?;
    if data.len() > 120 << 20 { return Err("file too large".into()); }
    let url = format!("{}/upload", server.trim_end_matches('/'));
    let (st, body) = https(&app, "PUT", &url, &[("Authorization".into(), format!("Nostr {auth}")), ("Content-Type".into(), "application/octet-stream".into())], data, 1 << 20).await?;
    if !(200..300).contains(&st) { return Err(format!("{} said {}: {}", server, st, String::from_utf8_lossy(&body).chars().take(160).collect::<String>())); }
    serde_json::from_slice(&body).map_err(|_| "bad reply from server".to_string())
}
/// Download a blob through Tor; returns raw bytes (an ArrayBuffer in JS).
#[tauri::command]
pub async fn blob_get(app: AppHandle, url: String) -> Result<tauri::ipc::Response, String> {
    let (st, body) = https(&app, "GET", &url, &[], &[], 120 << 20).await?;
    if st == 301 || st == 302 || st == 307 || st == 308 { return Err("redirect not followed".into()); }
    if !(200..300).contains(&st) { return Err(format!("download failed ({st})")); }
    Ok(tauri::ipc::Response::new(body))
}

/// Public posts from open networks for Echo's Discover feed (Bluesky, Mastodon), fetched through Tor so those
/// services never see your IP. Read-only GETs to a fixed list of public servers; returns the JSON reply as text.
pub const PUBLIC_FEED_HOSTS: &[&str] = &["public.api.bsky.app", "mastodon.social", "mastodon.online", "mstdn.social", "fosstodon.org", "flipboard.social", "newsie.social", "mas.to", "hachyderm.io", "infosec.exchange", "techhub.social", "journa.host", "press.coop"];
pub fn public_feed_ok(url: &str) -> bool {
    url::Url::parse(url).ok().filter(|u| u.scheme() == "https" && u.port().is_none())
        .and_then(|u| u.host_str().map(|h| PUBLIC_FEED_HOSTS.contains(&h) && (u.path().starts_with("/xrpc/app.bsky.") || u.path().starts_with("/api/v1/")))).unwrap_or(false)
}
#[tauri::command]
pub async fn public_feed(app: AppHandle, url: String) -> Result<String, String> {
    if !public_feed_ok(&url) { return Err("not an allowed public feed address".into()); }
    let (st, body) = https(&app, "GET", &url, &[("Accept".into(), "application/json".into())], &[], 4 << 20).await?;
    if !(200..300).contains(&st) { return Err(format!("feed error ({st})")); }
    String::from_utf8(body).map_err(|_| "bad reply".into())
}
/// Cloud assistant (Groq, with the user's own free key). path = "chat/completions" (POST body) or "models" (GET).
/// Tries Tor first (Groq never sees your IP); Groq's firewall often blocks Tor, so on any refusal it goes direct.
/// Returns {"via":"tor"|"direct","body":"…"}. Only ever talks to api.groq.com/openai/v1; the key goes only to Groq.
#[tauri::command]
pub async fn groq_chat(app: AppHandle, key: String, body: Option<String>, direct: Option<bool>, path: Option<String>) -> Result<serde_json::Value, String> {
    if key.len() < 20 || key.len() > 200 || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') { return Err("That doesn’t look like a Groq key".into()); }
    let path = path.unwrap_or_else(|| "chat/completions".into());
    if path != "chat/completions" && path != "models" { return Err("not allowed".into()); }
    let body = body.unwrap_or_default(); if body.len() > 400_000 { return Err("too much text".into()); }
    let url = format!("https://api.groq.com/openai/v1/{path}");
    let method = if path == "models" { "GET" } else { "POST" };
    let check = |st: u16, txt: &str| -> Result<(), String> {
        if st == 401 { return Err("Groq didn’t accept the key — check it and paste it again".into()); }
        if st == 429 { return Err("You’ve hit Groq’s free limit for now — try again in a minute (or tomorrow)".into()); }
        if !(200..300).contains(&st) {
            let msg = serde_json::from_str::<serde_json::Value>(txt).ok().and_then(|j| j["error"]["message"].as_str().map(str::to_string)).unwrap_or_else(|| txt.chars().take(160).collect());
            return Err(format!("Groq error {st}: {msg}")); }
        Ok(()) };
    if direct != Some(true) {
        let hs = [("Authorization".to_string(), format!("Bearer {key}")), ("Content-Type".into(), "application/json".into()), ("Accept".into(), "application/json".into())];
        if let Ok((st, out)) = https(&app, method, &url, &hs, body.as_bytes(), 2 << 20).await {
            let txt = String::from_utf8_lossy(&out).to_string();
            // A real answer from Groq's API (JSON) is final; anything else (firewall page, 403/404 from the edge) → go direct.
            let api = txt.trim_start().starts_with('{') && (st == 401 || st == 429 || (200..300).contains(&st));
            if api { check(st, &txt)?; return Ok(serde_json::json!({ "via": "tor", "body": txt })); }
        }
    }
    let (k, b, u, m) = (key.clone(), body.clone(), url.clone(), method);
    let (st, txt) = tauri::async_runtime::spawn_blocking(move || {
        let req = if m == "GET" { ureq::get(&u) } else { ureq::post(&u) }
            .set("Authorization", &format!("Bearer {k}")).set("Content-Type", "application/json").set("Accept", "application/json").timeout(std::time::Duration::from_secs(60));
        match if m == "GET" { req.call() } else { req.send_string(&b) } {
            Ok(r) => { let st = r.status(); (st, r.into_string().unwrap_or_default()) }
            Err(ureq::Error::Status(st, r)) => (st, r.into_string().unwrap_or_default()),
            Err(e) => (0, e.to_string()) } }).await.map_err(|e| e.to_string())?;
    if st == 0 { return Err(format!("Couldn’t reach Groq: {txt}")); }
    check(st, &txt)?;
    Ok(serde_json::json!({ "via": "direct", "body": txt }))
}
#[cfg(test)] mod feed_tests {
    #[test] fn only_public_feed_reads() {
        assert!(super::public_feed_ok("https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=nasa.gov&limit=5"));
        assert!(super::public_feed_ok("https://mastodon.social/api/v1/accounts/lookup?acct=Gargron"));
        assert!(!super::public_feed_ok("https://evil.example/api/v1/x"));
        assert!(!super::public_feed_ok("http://mastodon.social/api/v1/x"));
        assert!(!super::public_feed_ok("https://mastodon.social/oauth/token"));
    }
}

// ---------- Secrets (the Murmur / Echo identity key) in the OS vault ----------
// Windows: DPAPI (encrypted to your Windows account). Other desktops: a file only your user can read.
// Android uses the Keystore from Kotlin (TabsPlugin.secretGet/Set), not these commands.
fn secret_path(app: &AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    if name.is_empty() || name.len() > 40 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return Err("bad name".into()); }
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("vault");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d.join(format!("{name}.bin")))
}
#[cfg(windows)]
fn dpapi(data: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN};
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    unsafe {
        let inb = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB::default();
        if decrypt { CryptUnprotectData(&inb, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out) }
        else { CryptProtectData(&inb, windows::core::w!("Hush"), None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out) }.map_err(|e| e.to_string())?;
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as _)));
        Ok(v)
    }
}
#[tauri::command]
pub fn secret_set(app: AppHandle, name: String, value: String) -> Result<(), String> {
    let p = secret_path(&app, &name)?;
    #[cfg(windows)] let bytes = dpapi(value.as_bytes(), false)?;
    #[cfg(not(windows))] let bytes = value.into_bytes();
    std::fs::write(&p, bytes).map_err(|e| e.to_string())?;
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600)); }
    Ok(())
}
#[tauri::command]
pub fn secret_get(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let p = secret_path(&app, &name)?;
    let Ok(bytes) = std::fs::read(&p) else { return Ok(None) };
    #[cfg(windows)] let bytes = dpapi(&bytes, true)?;
    String::from_utf8(bytes).map(Some).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn secret_del(app: AppHandle, name: String) -> Result<(), String> { let p = secret_path(&app, &name)?; let _ = std::fs::remove_file(p); Ok(()) }
