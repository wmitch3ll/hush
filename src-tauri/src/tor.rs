//! Tor, built in (Arti — the Tor Project's Rust implementation). Nothing to install.
//! Hush runs a small SOCKS5 proxy on 127.0.0.1 that sends every connection through Tor.
//! Desktop: Tor tabs (their own profile, routed through the proxy). Android: Tor mode (whole app).
use arti_client::{config::TorClientConfigBuilder, IsolationToken, StreamPrefs, TorClient};
use parking_lot::Mutex;
use std::sync::{Arc, LazyLock};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tor_rtcompat::PreferredRuntime;

#[derive(Default)]
struct Tor { client: Option<Arc<TorClient<PreferredRuntime>>>, port: u16, iso: Option<IsolationToken>, starting: bool }
static TOR: LazyLock<Mutex<Tor>> = LazyLock::new(Default::default);

fn status(app: &AppHandle, state: &str, msg: &str) {
    let _ = app.emit("tor-status", serde_json::json!({ "state": state, "msg": msg, "port": TOR.lock().port }));
}

/// Start Tor (if needed) and return the local SOCKS port. Bootstrapping takes ~5–30 s the first time.
#[tauri::command]
pub async fn tor_start(app: AppHandle) -> Result<u16, String> {
    {
        let mut t = TOR.lock();
        if t.client.is_some() && t.port != 0 { return Ok(t.port); }
        if t.starting { return Err("Tor is still starting".into()); }
        t.starting = true;
    }
    let r = start(&app).await;
    TOR.lock().starting = false;
    match &r { Ok(_) => status(&app, "ready", "Connected to Tor"), Err(e) => status(&app, "error", e) }
    r
}
async fn start(app: &AppHandle) -> Result<u16, String> {
    status(app, "starting", "Connecting to the Tor network…");
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?.join("tor");
    let mut cb = TorClientConfigBuilder::from_directories(base.join("state"), base.join("cache"));
    // The folders are inside Hush's own app-data folder; skip Arti's Unix-style permission checks (they fail on Android/Windows).
    cb.storage().permissions().dangerously_trust_everyone();
    let cfg = cb.build().map_err(|e| e.to_string())?;
    let client = TorClient::create_bootstrapped(cfg).await.map_err(|e| format!("Couldn’t reach Tor: {e}"))?;
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    { let mut t = TOR.lock(); t.client = Some(client); t.port = port; t.iso = Some(IsolationToken::new()); }
    tauri::async_runtime::spawn(async move {
        while let Ok((sock, peer)) = listener.accept().await {
            if !peer.ip().is_loopback() { continue; }
            tokio::spawn(async move { let _ = serve(sock).await; });
        }
    });
    Ok(port)
}

/// New identity: every new connection uses fresh Tor circuits (new exit, new IP). Tabs should be reloaded.
#[tauri::command]
pub async fn tor_new_identity(app: AppHandle) -> Result<(), String> {
    let mut t = TOR.lock();
    if t.client.is_none() { return Err("Tor isn’t on".into()); }
    t.iso = Some(IsolationToken::new());
    drop(t);
    status(&app, "ready", "New identity — reload pages to use it");
    Ok(())
}
#[tauri::command]
pub fn tor_state() -> serde_json::Value {
    let t = TOR.lock();
    serde_json::json!({ "on": t.client.is_some(), "port": t.port, "starting": t.starting })
}
pub fn port() -> Option<u16> { let t = TOR.lock(); (t.client.is_some() && t.port != 0).then_some(t.port) }


/// Minimal SOCKS5 (no auth, CONNECT only) -> Tor stream. Hostnames are resolved by Tor (no DNS leaks).
async fn serve(mut s: TcpStream) -> std::io::Result<()> {
    let mut b = [0u8; 2];
    s.read_exact(&mut b).await?;
    if b[0] != 5 { return Ok(()); }
    let mut m = vec![0u8; b[1] as usize]; s.read_exact(&mut m).await?;
    s.write_all(&[5, 0]).await?;
    let mut h = [0u8; 4]; s.read_exact(&mut h).await?;
    if h[1] != 1 { s.write_all(&[5, 7, 0, 1, 0, 0, 0, 0, 0, 0]).await?; return Ok(()); }   // only CONNECT
    let host = match h[3] {
        1 => { let mut a = [0u8; 4]; s.read_exact(&mut a).await?; std::net::Ipv4Addr::from(a).to_string() }
        3 => { let mut l = [0u8; 1]; s.read_exact(&mut l).await?; let mut d = vec![0u8; l[0] as usize]; s.read_exact(&mut d).await?; String::from_utf8_lossy(&d).into_owned() }
        4 => { let mut a = [0u8; 16]; s.read_exact(&mut a).await?; std::net::Ipv6Addr::from(a).to_string() }
        _ => return Ok(()),
    };
    let mut p = [0u8; 2]; s.read_exact(&mut p).await?;
    let port = u16::from_be_bytes(p);
    let (client, iso) = { let t = TOR.lock(); (t.client.clone(), t.iso) };
    let Some(client) = client else { s.write_all(&[5, 1, 0, 1, 0, 0, 0, 0, 0, 0]).await?; return Ok(()) };
    let mut prefs = StreamPrefs::new();
    if let Some(i) = iso { prefs.set_isolation(i); }
    prefs.connect_to_onion_services(arti_client::config::BoolOrAuto::Explicit(true));   // .onion sites
    match client.connect_with_prefs((host.as_str(), port), &prefs).await {
        Ok(tor) => {
            s.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
            let (mut tr, mut tw) = tokio::io::split(tor);
            let (mut sr, mut sw) = s.into_split();
            let up = async { let r = tokio::io::copy(&mut sr, &mut tw).await; let _ = tw.shutdown().await; r };
            let down = async { let r = tokio::io::copy(&mut tr, &mut sw).await; let _ = sw.shutdown().await; r };
            let _ = tokio::join!(up, down);
        }
        Err(_) => { s.write_all(&[5, 4, 0, 1, 0, 0, 0, 0, 0, 0]).await?; }
    }
    Ok(())
}
