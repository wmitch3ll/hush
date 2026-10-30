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
