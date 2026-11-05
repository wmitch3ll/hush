// Injected into every page. Popup guard + cheap fingerprint/tracking hardening.
(() => {
  let last = 0, lastEl = null;
  // Click-jack guard (streaming sites): an invisible layer over the player that grabs your click to open ads.
  // If the top thing under your finger is a big, see-through layer (or an empty link over a video/iframe), it's
  // switched off and the click goes to what's underneath instead.
  const vw = () => innerWidth * innerHeight;
  const sneaky = el => { try { if (!el || el === document.body || el === document.documentElement) return false;
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el); if (r.width * r.height < vw() * 0.15) return false;
      if (!/fixed|absolute/.test(cs.position)) return false;
      const op = +cs.opacity, bg = cs.backgroundColor, clear = op < 0.15 || ((bg === "transparent" || /rgba\([^)]*,\s*0(\.0*)?\)/.test(bg)) && !cs.backgroundImage.replace("none", ""));
      const empty = !el.textContent.trim() && !el.querySelector("img,video,iframe,canvas,svg,button,input");
      const under = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2).some(x => x !== el && !el.contains(x) && /^(VIDEO|IFRAME|CANVAS)$/.test(x.tagName));
      return clear && empty && (under || +cs.zIndex > 999);
    } catch (_) { return false; } };
  addEventListener("pointerdown", e => { if (!e.isTrusted) return;
    for (let i = 0; i < 4; i++) { const top = document.elementFromPoint(e.clientX, e.clientY); if (!sneaky(top)) break; top.style.setProperty("pointer-events", "none", "important"); top.dataset.hushJack = "1"; jackAt = Date.now(); } }, true);
  let jackAt = 0;
  addEventListener("click", e => {
    if (!e.isTrusted) return;
    last = Date.now(); lastEl = e.target;
    // The press landed on a hidden ad layer we just switched off: hand this click to what's really under the finger.
    if (Date.now() - jackAt < 1500 && (e.target.dataset?.hushJack || e.target === document.body || e.target === document.documentElement)) {
      const real = document.elementFromPoint(e.clientX, e.clientY); e.preventDefault(); e.stopImmediatePropagation(); jackAt = 0;
      if (real && real !== e.target && !real.dataset.hushJack) real.click(); return; }
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    let cross = false; try { cross = new URL(a.href, location.href).hostname.replace(/^www\./, "") !== location.hostname.replace(/^www\./, ""); } catch (_) {}
    // A link-shaped ad covering the page (or one we just switched off): swallow the click.
    if (a.dataset.hushJack || (cross && sneaky(a))) { e.preventDefault(); e.stopImmediatePropagation(); a.style.setProperty("pointer-events", "none", "important"); return; }
    // <a target=_blank>: opens right here in this tab (new windows are always refused, on Windows and Android).
    if (a.target && a.target !== "_self") a.target = "_self";
  }, true);
  // Shift-click a link = Peek (floating preview); Ctrl/Cmd-click or middle-click = open in a background tab.
  // Reported to Hush through a navigation that Hush intercepts and cancels (tabs have no other channel).
  let lastPeek = 0;
  const linkOf = e => { const a = e.target.closest && e.target.closest("a[href]"); return a && /^https?:/i.test(a.href) ? a.href : null; };
  const report = (mode, href) => { if (Date.now() - lastPeek < 400) return; lastPeek = Date.now();
    location.href = "hush-peek://" + mode + "?u=" + encodeURIComponent(href); };
  addEventListener("click", e => { if (!e.isTrusted) return; const href = linkOf(e); if (!href) return;
    if ((e.shiftKey || e.altKey) && !e.ctrlKey && !e.metaKey) { /* Shift- or Alt-click: Glance preview */ e.preventDefault(); e.stopImmediatePropagation(); report("peek", href); }
    else if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopImmediatePropagation(); report("tab", href); } }, true);
  addEventListener("auxclick", e => { if (!e.isTrusted || e.button !== 1) return; const href = linkOf(e); if (href) { e.preventDefault(); report("tab", href); } }, true);
  // window.open: only after a real click (<1s) and never as a window; same-origin opens in place, others denied.
  const guardOpen = function (u) {
    if (Date.now() - last > 1000 || !u) return null;
    try { const t = new URL(u, location.href); if (t.origin === location.origin) location.href = t.href; } catch (_) {}
    return null;
  };
  window.open = guardOpen;
  // Ad scripts grab a fresh, unguarded window.open from a hidden blank frame: guard every frame's open too.
  try { const d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", { configurable: true, get() { const w = d.get.call(this); try { if (w && w.open !== guardOpen) w.open = guardOpen; } catch (_) {} return w; } });
    const fd = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentDocument");
    if (fd) Object.defineProperty(HTMLIFrameElement.prototype, "contentDocument", { configurable: true, get() { const doc = fd.get.call(this); try { if (doc && doc.defaultView && doc.defaultView.open !== guardOpen) doc.defaultView.open = guardOpen; } catch (_) {} return doc; } });
  } catch (_) {}
  try { const u = new URL(location.href);
    ["fbclid","gclid","utm_source","utm_medium","utm_campaign","utm_term","utm_content","mc_eid","msclkid"].forEach(k => u.searchParams.delete(k));
    if (u.href !== location.href) history.replaceState(null, "", u.href); } catch (_) {}
  // Hardware / canvas / WebGL / audio fingerprinting is handled by farble.js (per-site randomized values).
  // Thin scrollbars everywhere (split panes, small windows): a low-priority default — :where() has zero
  // specificity, so any site that styles its own scrollbars keeps its look.
  try { const st = document.createElement("style"); st.textContent = ":where(html){scrollbar-width:thin;scrollbar-color:rgba(127,127,127,.45) transparent}";
    (document.head || document.documentElement).append(st); } catch (_) {}
  // Media agent (every frame, including other sites' player frames on streaming pages): the top page tells each
  // frame how to treat its videos in split screen — muted or not, and whether to restart a video the system paused
  // (when another pane takes the sound, Android pauses the others). Frames pass the message on to their own frames.
  (() => {
    let st = { on: false, mute: false, keep: false }, touched = 0;
    // st.mute: true/false = force it, null = leave the sound alone. st.sw: when the sound last moved between panes —
    // for 2.5s after that, ANY pause is the system reacting to the switch, so it's undone. st.pause: stop everything.
    // While Hush keeps a video going (mini player, split, background), the page — and every player frame in it —
    // is told it's visible and focused, so players that pause on "blur" / "hidden" keep playing.
    const spoof = () => { if (window.__hushVis) return; window.__hushVis = 1; try {
      Object.defineProperty(document, "visibilityState", { get: () => "visible" }); Object.defineProperty(document, "hidden", { get: () => false });
      document.hasFocus = () => true;
      for (const k of ["visibilitychange", "webkitvisibilitychange", "blur", "pagehide", "freeze"]) { const f = x => { if (st.keep) x.stopImmediatePropagation(); }; addEventListener(k, f, true); document.addEventListener(k, f, true); }
    } catch (_) {} };
    const apply = () => (st.keep && spoof(), document.querySelectorAll("video,audio")).forEach(m => { if (st.pause) m.pause(); else if (st.on && st.mute !== null && st.mute !== undefined && m.muted !== st.mute) m.muted = st.mute; });
    const relay = d => { for (const f of document.querySelectorAll("iframe,frame")) try { f.contentWindow.postMessage(d, "*"); } catch (_) {} };
    // Split screen, inside a player frame of the pane WITHOUT the sound: the first tap only selects the pane (the
    // player never sees it, so it doesn't pause/play); it's reported to the top page, which moves the sound here.
    let eat = 0;
    const swallow = e => { if (Date.now() < eat) { e.preventDefault(); e.stopImmediatePropagation(); } };
    // A tap anywhere on the page counts as "you touched the player": the top page passes its taps down to the player
    // frames, so a pause you make through a site's overlay (common on sports streams) is never undone.
    addEventListener("pointerdown", e => { touched = Date.now();
      if (window === top) relay({ __hushTouch: touched });
      if (window !== top && e.isTrusted) { if (st.on && st.mute === true) { eat = Date.now() + 700; e.preventDefault(); e.stopImmediatePropagation(); }
        try { top.postMessage({ __hushTap: 1 }, "*"); } catch (_) {} } }, true);
    for (const t of ["mousedown", "mouseup", "pointerup", "click", "dblclick", "touchstart", "touchend"]) addEventListener(t, swallow, true);
    addEventListener("keydown", () => { touched = Date.now(); }, true);
    const forced = () => st.on && st.mute !== null && st.mute !== undefined;
    document.addEventListener("volumechange", e => { if (forced() && e.target.muted !== st.mute) e.target.muted = st.mute; }, true);
    document.addEventListener("play", e => { if (forced()) e.target.muted = st.mute; }, true);
    // Play/pause pulse: when YOU play or pause a video (a tap a moment before), a soft round icon flashes in the
    // middle of the video for half a second — on every site, inside player frames too.
    const IC = { play: "M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z", pause: "M7 5h3.2v14H7zM13.8 5H17v14h-3.2z" };
    let pz = null, pzT = 0;
    const pulse = (v, kind) => { try { const r = v.getBoundingClientRect(); if (r.width < 120 || r.height < 68) return;
      if (!pz) { pz = document.createElement("hush-pulse"); pz.setAttribute("popover", "manual");
        const sr = pz.attachShadow({ mode: "closed" }); sr.innerHTML = '<style>i{display:grid;place-items:center;width:64px;height:64px;border-radius:50%;background:rgba(18,18,22,.5);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);animation:p .6s ease-out forwards}svg{width:30px;height:30px;fill:#fff}@keyframes p{0%{opacity:0;transform:scale(.7)}25%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.25)}}</style><i><svg viewBox="0 0 24 24"><path/></svg></i>';
        pz.__sr = sr; }
      const sr = pz.__sr; sr.querySelector("path").setAttribute("d", IC[kind]);
      const i = sr.querySelector("i"); i.style.animation = "none"; void i.offsetWidth; i.style.animation = "";
      pz.style.cssText = "all:initial;position:fixed;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;z-index:2147483647;width:64px;height:64px;left:" + (r.left + r.width / 2 - 32) + "px;top:" + (r.top + r.height / 2 - 32) + "px";
      if (!pz.isConnected) document.documentElement.append(pz);
      try { if (pz.matches(":popover-open")) pz.hidePopover(); pz.showPopover(); } catch (_) {}
      clearTimeout(pzT); pzT = setTimeout(() => { try { pz.hidePopover(); } catch (_) {} }, 650); } catch (_) {} };
    // Android: the app itself draws the icon (it can't be hidden by site styles, a lifted video or a player frame).
    // The frame that owns the video tells the top page; the top page tells the app. Windows draws it in the page.
    const native = k => { if (window === top) { try { location.href = "hush-pulse://" + k; } catch (_) {} } else { try { top.postMessage({ __hushPulse: k }, "*"); } catch (_) {} } };
    for (const k of ["play", "pause"]) document.addEventListener(k, e => { const v = e.target;
      if (v.tagName !== "VIDEO" || v.ended || Date.now() - touched >= 1200) return;
      const r = v.getBoundingClientRect(); if (r.width < 120 || r.height < 68) return;
      if (window.__hushAndroid) native(k); else if (!(window.__hushSplitBar && window.__hushSplitBar(v))) pulse(v, k); }, true);
    addEventListener("message", e => { const d = e.data; if (d && d.__hushPulse && window === top && window.__hushAndroid && (d.__hushPulse === "play" || d.__hushPulse === "pause") && e.source !== window) native(d.__hushPulse); });
    // Video diary for problem reports: the last few things that happened to the videos on this page (no URLs).
    const log = window.__hushMediaLog = [];
    const note = (k, v) => { try { log.push([Math.round(performance.now()), k, v ? Math.round(v.clientWidth) + "x" + Math.round(v.clientHeight) + (v.paused ? " paused" : " playing") + (v.muted ? " muted" : "") : "", document.visibilityState, document.hasFocus() ? "focus" : "nofocus", innerWidth + "x" + innerHeight, Date.now() - touched < 1500 ? "touched" : ""].join(" ")); if (log.length > 40) log.shift(); } catch (_) {} };
    // Who paused it? (script file names only, no addresses) — shows up in problem reports.
    try { const op = HTMLMediaElement.prototype.pause; HTMLMediaElement.prototype.pause = function () { try { const w = (new Error().stack || "").split("\n").slice(2, 4).map(x => (x.match(/([^\/\s()]+?)(?:\?[^:]*)?:(\d+):\d+\)?$/) || [0, "?", ""]).slice(1).join(":")).join(">"); note("pause()<" + w, this); } catch (_) {} return op.apply(this, arguments); }; } catch (_) {}
    for (const k of ["play", "pause", "waiting", "stalled", "emptied", "ended"]) document.addEventListener(k, e => note(k, e.target), true);
    for (const k of ["visibilitychange", "blur", "focus", "resize", "pagehide"]) addEventListener(k, () => note(k), true);
    // Report: the top page gathers the diary from every player frame too (they answer by message).
    addEventListener("message", e => { const d = e.data; if (!d) return;
      if (d.__hushAsk && window !== top && e.source === parent) { try { top.postMessage({ __hushDump: window.__hushMediaDump() }, "*"); } catch (_) {} relay(d); }
      if (d.__hushDump && window === top && window.__hushMediaOut) window.__hushMediaOut.push(String(d.__hushDump).slice(0, 1500)); });
    if (window === top) window.__hushMediaCollect = () => { window.__hushMediaOut = [window.__hushMediaDump()]; relay({ __hushAsk: 1 }); };
    window.__hushMediaDump = () => (window === top ? "" : "[frame " + location.host + "] ") + log.slice(-15).join(" | ");
    const switching = () => st.sw && Date.now() - st.sw < 2500;
    // In the mini player only the pause button counts as "you paused it"; any other pause (the site reacting to a tap) is undone.
    const mine = () => window.__hushFloatOn ? Date.now() - (window.__hushUserPause || 0) < 1000 : Date.now() - touched < 4000;
    document.addEventListener("pause", e => { const v = e.target; if (!st.on || v.ended || (!st.keep && !switching()) || (!switching() && mine())) return;
      const r = n => setTimeout(() => { if (!st.on || !v.paused || v.ended || (!st.keep && !switching()) || (!switching() && mine())) return;
        // If the site keeps pausing it (3 restarts within 6 s), stop fighting for a while — no stutter loop.
        const now = Date.now(); v.__hushR = (v.__hushR || []).filter(t => now - t < 6000); if (v.__hushR.length >= 3) return; v.__hushR.push(now);
        if (forced()) v.muted = st.mute; v.play().then(() => {}, () => n < 4 && r(n + 1)); }, n ? 450 : 250); r(0); }, true);
    addEventListener("message", e => { const d = e.data; if (d && d.__hushTouch && window !== top && e.source === parent) { touched = Math.max(touched, Date.now()); relay(d); return; }
      if (d && d.__hushTap && window === top) touched = Date.now();
      if (!d || !d.__hushMedia || window === top || e.source !== parent) return; st = d.__hushMedia; apply(); relay(d); });
    if (window === top) window.__hushMediaSet = s => { st = s; apply(); relay({ __hushMedia: s }); };
    // New player frames that load later get the current state too.
    if (window === top) setInterval(() => { if (st.on) relay({ __hushMedia: st }); }, 2000);
  })();
  // Where you left off (Android app stores it): scroll position and video time of THIS page, so coming back later
  // (or reopening a video) continues there. Top page only; nothing leaves the device.
  if (window === top) {
    const keyOf = () => { try { const u = new URL(location.href);
        if (/(^|\.)youtube\.com$/.test(u.hostname)) { const v = u.searchParams.get("v"); if (v) return u.hostname + "/watch?v=" + v; }
        u.hash = ""; for (const p of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_)/i.test(p)) u.searchParams.delete(p); return u.href; } catch (_) { return location.href; } };
    window.__hushKey = () => /^https?:/.test(location.href) ? keyOf() : "";
    const mainVideo = () => [...document.querySelectorAll("video")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const state = () => { const o = { k: keyOf(), y: 0, vt: 0 }; try {
        if (scrollY > 600 && document.documentElement.scrollHeight > innerHeight * 2.2) o.y = Math.round(scrollY);
        const v = mainVideo(); if (v && isFinite(v.duration) && v.duration > 150 && v.currentTime > 20 && v.currentTime < v.duration - 30) o.vt = Math.round(v.currentTime); } catch (_) {} return o; };
    let sent = "";
    const save = () => { try { if (!window.hushPos || !/^https?:/.test(location.href)) return; const o = state(), j = JSON.stringify(o); if (j === sent) return; sent = j; hushPos.postMessage(j); } catch (_) {} };
    window.__hushRestore = j => { try { const o = JSON.parse(j); if (!o || o.k !== keyOf()) return;
        if (o.y) { let n = 0; const go = () => { if (scrollY > 80) return; if (document.documentElement.scrollHeight > o.y + innerHeight * 0.5) scrollTo(0, o.y); else if (++n < 20) setTimeout(go, 300); }; setTimeout(go, 400); }
        if (o.vt) { let n = 0; const tv = () => { const v = [...document.querySelectorAll("video")].find(x => isFinite(x.duration) && x.duration > o.vt + 30);
            if (v && v.currentTime < 5) { try { v.currentTime = o.vt; } catch (_) {} } else if (++n < 25) setTimeout(tv, 400); }; tv(); }
      } catch (_) {} };
    addEventListener("pagehide", save, true);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") save(); }, true);
    document.addEventListener("pause", e => { if (e.target === mainVideo()) save(); }, true);
    let st2 = 0; addEventListener("scroll", () => { clearTimeout(st2); st2 = setTimeout(save, 2000); }, { passive: true, capture: true });
    setInterval(() => { const v = mainVideo(); if (v && !v.paused) save(); }, 15000);
  }
  // Groq key helper: on Groq's own key page only, when a new key appears, offer to hand it straight to Hush's
  // assistant (no copy/paste). The key only ever goes to the Hush app on this device.
  if (location.hostname === "console.groq.com" && window.top === window) {
    let offered = "";
    const scan = () => { try {
        const vals = [...document.querySelectorAll("input,textarea,code,pre,span,div")].slice(0, 4000).map(e => e.value || (e.childElementCount ? "" : e.textContent) || "");
        const m = vals.join(" ").match(/gsk_[A-Za-z0-9]{40,}/); if (!m || m[0] === offered) return; offered = m[0];
        let bar = document.getElementById("hush-groq"); if (bar) bar.remove();
        bar = document.createElement("hush-groq"); bar.id = "hush-groq"; const sh = bar.attachShadow({ mode: "closed" });
        sh.innerHTML = `<style>:host{all:initial}.b{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#111;color:#fff;border-radius:16px;padding:14px 16px;box-shadow:0 12px 40px #0008;font:15px system-ui;display:flex;gap:12px;align-items:center;max-width:92vw}
          button{all:unset;cursor:pointer;background:#fff;color:#111;font-weight:700;padding:10px 16px;border-radius:999px;white-space:nowrap}.x{background:transparent;color:#aaa;padding:10px 6px}</style>
          <div class=b><span>🔑 New key found</span><button data-y>Use this key in Hush</button><button class=x data-n>✕</button></div>`;
        sh.querySelector("[data-y]").onclick = () => { location.href = "hush-groq://key?k=" + encodeURIComponent(offered); bar.remove(); };
        sh.querySelector("[data-n]").onclick = () => bar.remove();
        document.documentElement.append(bar);
      } catch (_) {} };
    new MutationObserver(() => { clearTimeout(scan.t); scan.t = setTimeout(scan, 400); }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["value"] });
    setInterval(scan, 2000);
  }
})();

// ---- Audio-only mode: hides every video (this page and embedded players) but keeps the sound going. Toggle with __hushAO(true|false).
(() => {
  if (window.__hushAOinit) return; window.__hushAOinit = true;
  const ID = "__hush_ao_style";
  const apply = on => {
    window.__hushAOon = !!on;
    let st = document.getElementById(ID);
    if (on && !st) { st = document.createElement("style"); st.id = ID; st.textContent = "video{opacity:0!important}"; (document.head || document.documentElement).append(st); }
    if (!on && st) st.remove();
    if (window === top) {
      let o = document.getElementById("__hush_ao_o");
      if (on && !o && document.body) {
        o = document.createElement("div"); o.id = "__hush_ao_o";
        o.style.cssText = "position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:radial-gradient(120% 90% at 50% 0%,#1b1b1f,#050506);color:#f2f2f2;font:600 15px system-ui;text-align:center;padding:24px";
        const t = (document.title || location.hostname).slice(0, 90).replace(/[<>&]/g, "");
        o.innerHTML = '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#f2f2f2" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg><div>' + t + '</div><div style="font-weight:500;color:#8a8a8e;font-size:13px">Audio only · tap to show video</div>';
        o.onclick = () => window.__hushAO(false);
        document.body.append(o);
      }
      if (!on && o) o.remove();
    }
    for (const f of document.querySelectorAll("iframe")) { try { f.contentWindow.postMessage({ __hushAO: on ? 1 : 0 }, "*"); } catch (e) {} }
  };
  window.__hushAO = on => { apply(on); };
  addEventListener("message", e => { const d = e.data; if (d && typeof d === "object" && "__hushAO" in d && window !== top && e.source === parent) apply(!!d.__hushAO); });
})();
// ---- Site icon for bookmarks (desktop; Android reads it natively): top page only, once per site per session.
(() => {
  if (window !== top || window.__hushFavInit || !/^https?:$/.test(location.protocol)) return; window.__hushFavInit = 1;
  const run = () => {
    try {
      const h = location.hostname.replace(/^www\./, ""); if (!h || sessionStorage.getItem("__hushFav")) return;
      const l = [...document.querySelectorAll('link[rel~="icon"],link[rel="shortcut icon"],link[rel="apple-touch-icon"]')].map(x => x.href).filter(Boolean);
      const cands = [...l, location.origin + "/favicon.ico"];
      const tryNext = i => { if (i >= cands.length) return;
        const im = new Image(); im.crossOrigin = "anonymous";
        im.onload = () => { try { const c = document.createElement("canvas"); c.width = c.height = 64; c.getContext("2d").drawImage(im, 0, 0, 64, 64);
          const d = c.toDataURL("image/png"); if (d.length > 300 && d.length < 15000) { sessionStorage.setItem("__hushFav", "1"); if (typeof hushFav !== "undefined") hushFav.postMessage(h + "\n" + d); else location.href = "hush-fav://x/?h=" + encodeURIComponent(h) + "&d=" + encodeURIComponent(d); } else tryNext(i + 1); } catch (e) { tryNext(i + 1); } };
        im.onerror = () => tryNext(i + 1); im.src = cands[i]; };
      tryNext(0);
    } catch (e) {}
  };
  if (document.readyState === "complete") setTimeout(run, 1200); else addEventListener("load", () => setTimeout(run, 1200));
})();
