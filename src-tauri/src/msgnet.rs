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
