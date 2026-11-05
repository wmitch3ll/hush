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
    const apply = () => document.querySelectorAll("video,audio").forEach(m => { if (st.pause) m.pause(); else if (st.on && st.mute !== null && st.mute !== undefined && m.muted !== st.mute) m.muted = st.mute; });
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
    const switching = () => st.sw && Date.now() - st.sw < 2500;
    document.addEventListener("pause", e => { const v = e.target; if (!st.on || v.ended || (!st.keep && !switching()) || (!switching() && Date.now() - touched < 4000)) return;
      const r = n => setTimeout(() => { if (!st.on || !v.paused || v.ended || (!st.keep && !switching()) || (!switching() && Date.now() - touched < 4000)) return;
        if (forced()) v.muted = st.mute; v.play().then(() => {}, () => n < 4 && r(n + 1)); }, n ? 450 : 250); r(0); }, true);
    addEventListener("message", e => { const d = e.data; if (d && d.__hushTouch && window !== top && e.source === parent) { touched = Math.max(touched, Date.now()); relay(d); return; }
      if (d && d.__hushTap && window === top) touched = Date.now();
      if (!d || !d.__hushMedia || window === top || e.source !== parent) return; st = d.__hushMedia; apply(); relay(d); });
    if (window === top) window.__hushMediaSet = s => { st = s; apply(); relay({ __hushMedia: s }); };
    // New player frames that load later get the current state too.
    if (window === top) setInterval(() => { if (st.on) relay({ __hushMedia: st }); }, 2000);
  })();
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
