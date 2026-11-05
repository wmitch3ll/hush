// Split screen: each half is a full page. A video in a half fills that half with the browser's own full
// controls (play, seek, volume, fullscreen). The half you last tapped is "focused": it gets a highlight ring
// and the sound; the other half keeps playing muted. Text sites are left as they are.
// Rust/Kotlin appends __hushSplit({on, focus}). A tap on an unfocused half reports hush-split://focus (cancelled natively).
// Top layer: lift the video above EVERYTHING on the page (headers, overlays, shadow-DOM parts that CSS can't hide),
// over a black backdrop, without moving it in the page — so the site's player keeps working.
window.__hushSolo = window.__hushSolo || ((v, on) => { try {
  if (!document.getElementById("hush-solo-css")) { const c = document.createElement("style"); c.id = "hush-solo-css";
    c.textContent = "[data-hush-solo]:popover-open{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;object-fit:contain!important;background:#000!important;transform:none!important;display:block!important;visibility:visible!important;opacity:1!important;clip-path:none!important;color:inherit}[data-hush-solo]::backdrop{background:#000}";
    (document.head || document.documentElement).append(c); }
  if (on) { if (!v.isConnected) return false; if (!v.hasAttribute("popover")) { v.setAttribute("popover", "manual"); v.setAttribute("data-hush-solo", ""); }
    if (v.hasAttribute("data-hush-solo") && !v.matches(":popover-open")) v.showPopover(); return true; }
  if (v.hasAttribute("data-hush-solo")) { try { v.hidePopover(); } catch (_) {} v.removeAttribute("popover"); v.removeAttribute("data-hush-solo"); }
  return true; } catch (_) { return false; } });
window.__hushSplit = window.__hushSplit || (() => {
  let on = false, focus = false, cur = null, keep = null, sw = 0;   // sw: when the sound last moved between panes
  const area = v => v.clientWidth * v.clientHeight;
  const unfill = () => {
    document.getElementById("hush-split-css")?.remove(); keep?.disconnect(); keep = null;
    document.querySelectorAll("[data-hush-split],[data-hush-split-anc]").forEach(e => { e.removeAttribute("data-hush-split"); e.removeAttribute("data-hush-split-anc"); });
    if (cur) __hushSolo(cur, false);
    if (cur && cur.tagName === "VIDEO" && cur.__hushCtl) cur.controls = true; cur = null; bar.hide(true); window.dispatchEvent(new Event("resize"));
  };
  const fill = v => {
    if (cur === v) return; unfill(); cur = v;
    v.setAttribute("data-hush-split", "");
    for (let e = v.parentElement; e && e !== document.documentElement; e = e.parentElement) e.setAttribute("data-hush-split-anc", "");
    const st = document.createElement("style"); st.id = "hush-split-css";
    const tag = v.tagName.toLowerCase();
    st.textContent = "html,body{overflow:hidden!important;background:#000!important}body *{visibility:hidden!important}" +
      "[data-hush-split-anc]{visibility:visible!important;transform:none!important;filter:none!important;contain:none!important;will-change:auto!important;perspective:none!important;clip-path:none!important;mask:none!important}" +
      "video[data-hush-split]::-webkit-media-controls{display:none!important}" + tag + "[data-hush-split]{visibility:visible!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483640!important;object-fit:contain!important;background:#000!important;transform:none!important;margin:0!important;border:0!important}";
    (document.head || document.documentElement).append(st);
    __hushSolo(v, true);
    // Hush's own slim controls instead of the browser's dated ones (whose pause icon stayed on screen).
    // Players that turn the native controls back on are switched off again. (A player frame keeps its own.)
    if (v.tagName === "VIDEO") { v.__hushCtl = v.controls; v.controls = false;
      keep = new MutationObserver(() => { if (on && v.controls && !api_native()) v.controls = false; }); keep.observe(v, { attributes: true, attributeFilter: ["controls"] }); }
    ring();   // the highlight ring and controls go above the lifted video
    if (v.tagName === "VIDEO") setTimeout(() => bar.flash(), 60);
  };
  // The video — or, on streaming sites that embed another site's player, the player FRAME (the video lives inside it).
  const pick = () => { const vids = [...document.querySelectorAll("video")].filter(v => area(v) > 0 || !v.paused);
    const v = vids.find(x => !x.paused && x.readyState > 2) || vids.sort((a, b) => area(b) - area(a))[0];
    if (v && (!v.paused || area(v) >= innerWidth * innerHeight * 0.12)) return v;
    const fr = [...document.querySelectorAll("iframe")].filter(f => area(f) >= innerWidth * innerHeight * 0.08 && getComputedStyle(f).visibility !== "hidden").sort((a, b) => area(b) - area(a))[0];
    return fr || null; };
  const media = () => { try { window.__hushMediaSet && window.__hushMediaSet(on ? { on, mute: !focus, keep: true, sw } : { on: false }); } catch (_) {} };
  const want = () => on ? !focus : !!window.__hushMuted;
  // Smooth switching: the sound fades out (~150 ms) / in (~220 ms) instead of cutting, so moving it between panes is soft.
  const fade = (x, m) => { if (x.__hushFade) cancelAnimationFrame(x.__hushFade.raf);
    const vol = x.__hushFade ? x.__hushFade.vol : x.volume, dur = m ? 150 : 220, t0 = performance.now();
    if (!m) { x.volume = 0; x.muted = false; }
    const f = { vol, raf: 0 }; x.__hushFade = f;
    const step = now => { const k = Math.min(1, (now - t0) / dur);
      try { x.volume = m ? vol * (1 - k) : vol * k; } catch (_) {}
      if (k < 1) { f.raf = requestAnimationFrame(step); return; }
      x.__hushFade = null; if (m) x.muted = true; try { x.volume = vol; } catch (_) {} };
    f.raf = requestAnimationFrame(step); };
  const sound = (soft) => { document.querySelectorAll("video,audio").forEach(x => { const w = want();
    if (x.__hushFade ? x.__hushFade.to === w : x.muted === w) return;
    if (soft && !x.paused && document.visibilityState === "visible") { fade(x, w); x.__hushFade.to = w; } else { if (x.__hushFade) { cancelAnimationFrame(x.__hushFade.raf); try { x.volume = x.__hushFade.vol; } catch (_) {} x.__hushFade = null; } x.muted = w; } }); media(); };
  // Sites (YouTube…) re-apply their own mute/volume; while split is on, Hush's choice wins (not mid-fade).
  document.addEventListener("volumechange", e => { if (on && !e.target.__hushFade && e.target.muted !== want()) e.target.muted = want(); }, true);
  // Slim, modern control bar: glass pill at the bottom; shows on a tap, fades after 2.5 s while playing.
  const ICON = { play: "M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z",
    pause: "M7 5h3.2v14H7zM13.8 5H17v14h-3.2z", full: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" };
  let api_native = () => false;
  const bar = (() => { let host = null, root = null, hideT = 0, shown = false;
    const fmt = t => { t = Math.max(0, Math.floor(t || 0)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s2 = String(t % 60).padStart(2, "0"); return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + s2; };
    const build = () => { host = document.createElement("hush-split-ctl"); host.setAttribute("popover", "manual");
      host.style.cssText = "all:initial;position:fixed;inset:0;width:100vw;height:100vh;margin:0;padding:0;border:0;background:transparent;pointer-events:none;z-index:2147483647;overflow:visible";
      root = host.attachShadow({ mode: "closed" });
      root.innerHTML = '<style>:host{all:initial}.b{position:absolute;left:12px;right:12px;bottom:12px;display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:999px;background:rgba(18,18,22,.55);backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4);border:1px solid rgba(255,255,255,.12);color:#fff;font:500 12px/1 system-ui,-apple-system,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums;opacity:0;transform:translateY(8px);transition:opacity .22s ease,transform .22s ease;pointer-events:none;box-shadow:0 8px 30px rgba(0,0,0,.35)}.on .b{opacity:1;transform:none;pointer-events:auto}button{all:unset;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;cursor:pointer;flex:none}button:active{background:rgba(255,255,255,.16)}svg{width:20px;height:20px}.p{fill:#fff}.f{fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}input{flex:1;min-width:0;height:4px;appearance:none;-webkit-appearance:none;border-radius:4px;background:linear-gradient(#fff,#fff) 0/var(--v,0%) 100% no-repeat,rgba(255,255,255,.25);outline:none;margin:0}input::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}input::-moz-range-thumb{width:14px;height:14px;border:0;border-radius:50%;background:#fff}.t{opacity:.85;white-space:nowrap}.sp{width:auto;padding:0 8px;border-radius:999px;font:600 12px/1 system-ui,sans-serif}.k{position:absolute;top:50%;padding:10px 16px;border-radius:999px;background:rgba(18,18,22,.55);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);color:#fff;font:600 15px/1 system-ui,sans-serif;opacity:0;transform:translateY(-50%) scale(.9);transition:opacity .18s,transform .18s}.k.on{opacity:1;transform:translateY(-50%) scale(1)}@media (prefers-reduced-motion:reduce){.b{transition:none}}</style>' +
        '<div class=w><div class=b><button class=pp aria-label="Play or pause"><svg viewBox="0 0 24 24"><path class=p /></svg></button><span class=t></span><input type=range min=0 max=1000 value=0 aria-label="Seek"><button class=sp aria-label="Speed">1×</button><button class=fs aria-label="Full screen"><svg viewBox="0 0 24 24"><path class=f d="' + ICON.full + '"/></svg></button></div><div class=k></div></div>';
      const $ = q => root.querySelector(q);
      $(".pp").onclick = () => { if (!cur) return; cur.paused ? cur.play().catch(() => {}) : cur.pause(); later(); };
      const SP = [1, 1.25, 1.5, 2, 0.75]; $(".sp").onclick = () => { if (!cur) return; const i = (SP.indexOf(cur.playbackRate) + 1) % SP.length; cur.playbackRate = SP[i]; $(".sp").textContent = SP[i] + "×"; later(); };
      $(".fs").onclick = () => { try { cur && (cur.requestFullscreen || cur.webkitRequestFullscreen).call(cur); } catch (_) {} };
      const sk = $("input"); sk.oninput = () => { if (cur && isFinite(cur.duration)) cur.currentTime = sk.value / 1000 * cur.duration; later(); };
      for (const t of ["pointerdown", "click", "pointerup"]) root.addEventListener(t, e => e.stopPropagation()); };
    // Hush's bar must really be on top of the lifted video. If the system won't stack it there (some phones),
    // the video gets the browser's own controls back so you're never left without any.
    let native = false, checked = false;
    const verify = () => { if (checked) return; setTimeout(() => { if (!shown || !host || !cur) return; checked = true;
      const r = root.querySelector(".b").getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const ok = host.matches(":popover-open") && r.width > 0 && el === host;
      window.__hushSplitDiag = ok ? "hush-bar" : "native-controls";
      if (!ok) { native = true; api.hide(true); cur.controls = true; } }, 300); };
    api_native = () => native;
    const later = () => { clearTimeout(hideT); hideT = setTimeout(() => { if (cur && !cur.paused) api.hide(); }, 2500); };
    const api = {
      hit: e => { if (!root || !shown) return false; const r = root.querySelector(".b").getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; },
      sync: () => { if (!root || !cur || cur.tagName !== "VIDEO") return; const $ = q => root.querySelector(q);
        $(".p").setAttribute("d", cur.paused ? ICON.play : ICON.pause);
        const d = cur.duration, live = !isFinite(d), sk = $("input"); sk.style.display = live ? "none" : "";
        if (!live && d) { const v = cur.currentTime / d * 1000; if (root.activeElement !== sk) sk.value = v; sk.style.setProperty("--v", v / 10 + "%"); }
        $(".sp").textContent = (cur.playbackRate || 1) + "×";
        $(".t").textContent = live ? "LIVE" : fmt(cur.currentTime) + " / " + fmt(d);
        if (cur.paused && on && focus && !shown) api.show(false); },
      raise: () => { if (!host || !on || !focus) return; try { if (host.matches(":popover-open")) host.hidePopover(); host.showPopover(); } catch (_) {} },
      show: (auto = true) => { if (!on || !focus || !cur || cur.tagName !== "VIDEO") return;
        if (native) { cur.controls = true; return; }
        if (!host) build();
        if (!host.isConnected) document.documentElement.append(host); if (!host.matches(":popover-open")) api.raise();
        shown = true; root.querySelector(".w").className = "w on"; api.sync(); if (auto) later(); verify(); },
      flash: () => { if (on && focus) { api.show(true); } },
      skip: d => { if (!cur || cur.tagName !== "VIDEO") return; try { cur.currentTime = Math.max(0, Math.min((cur.duration || 1e9) - 0.3, cur.currentTime + d)); } catch (_) {}
        api.show(true); if (!root) return; const k = root.querySelector(".k"); k.textContent = (d > 0 ? "+" : "−") + Math.abs(d) + "s";
        k.style.left = d > 0 ? "" : "22px"; k.style.right = d > 0 ? "22px" : ""; k.className = "k on"; clearTimeout(k.__t); k.__t = setTimeout(() => k.className = "k", 600); },
      hide: (gone) => { shown = false; clearTimeout(hideT); if (!root) return; root.querySelector(".w").className = "w";
        if (gone) { try { host.hidePopover(); } catch (_) {} host.remove(); } },
      toggle: () => shown ? api.hide() : api.show() };
    for (const t of ["play", "pause", "timeupdate", "durationchange"]) document.addEventListener(t, e => { if (e.target !== cur) return;
      if ((t === "play" || t === "pause") && on && focus) api.show(true); else if (shown) api.sync(); }, true);
    return api; })();
  let tick = 0;
  const ring = () => { let r = document.getElementById("hush-split-ring");
    if (!on || !focus) { r?.remove(); bar.hide(true); return; }
    if (!r) { r = document.createElement("hush-split-ring"); r.id = "hush-split-ring"; document.documentElement.append(r); }
    r.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;box-shadow:inset 0 0 0 3px #4da3ff;border-radius:2px;visibility:visible;margin:0;padding:0;border:0;background:transparent;width:100vw;height:100vh";
    try { if (!r.hasAttribute("popover")) r.setAttribute("popover", "manual"); if (r.matches(":popover-open")) r.hidePopover(); r.showPopover(); } catch (_) {} bar.raise(); };
  document.addEventListener("play", e => { if (!on) return; e.target.muted = !focus; if (e.target.tagName === "VIDEO" && cur !== e.target && (area(e.target) > 0)) fill(e.target); }, true);
  // Keep every video playing: when another half takes the sound, the phone pauses the others (audio focus).
  // A pause you didn't make yourself (no tap in this half just before) is undone; the video carries on muted.
  let touched = 0;
  addEventListener("pointerdown", () => { touched = Date.now(); }, true);
  addEventListener("keydown", () => { touched = Date.now(); }, true);
  document.addEventListener("pause", e => { const v = e.target;
    // Only muted halves are restarted: if another app takes the sound, the half with Hush's sound stays paused.
    // Decide a moment later: when the sound moves to the other pane, this pane learns it lost the focus a beat
    // AFTER the system paused it — checking right away (still "focused") skipped the restart.
    const switching = () => Date.now() - sw < 2500;
    if (!on || v.tagName !== "VIDEO" || v.ended || (!switching() && (focus || Date.now() - touched < 4000))) return;
    const retry = n => setTimeout(() => { if (!on || !v.paused || v.ended || (!switching() && (focus || Date.now() - touched < 4000))) return;
      const now = Date.now(); v.__hushR = (v.__hushR || []).filter(t => now - t < 6000); if (v.__hushR.length >= 3) return; v.__hushR.push(now);
      v.muted = !focus; v.play().then(() => {}, () => n < 4 && retry(n + 1)); }, n ? 450 : 250);
    retry(0); }, true);
  const ask = () => { try { location.href = "hush-split://focus"; } catch (_) {} };
  addEventListener("message", e => { if (e.data && e.data.__hushTap) { touched = Date.now(); if (on && !focus) ask(); } });
  // Tapping the other half moves the focus (and the sound) there; the tap itself still reaches the page.
  // Report the tap; Hush mutes the other pane first and then gives this one the sound (never both audible at once).
  // The first tap/click on a pane that doesn't have the sound ONLY selects it: the page never sees that tap, so it
  // can't also pause/play the video (that caused the play-pause flash when switching). Later taps work normally.
  let eat = 0;
  const swallow = e => { if (Date.now() < eat) { e.preventDefault(); e.stopImmediatePropagation(); } };
  // Focused pane: one tap shows/hides the controls; a quick double-tap on the left/right third skips 10 s.
  let lastTap = 0, tapT = 0;
  addEventListener("pointerdown", e => { if (!(on && focus && cur && cur.tagName === "VIDEO") || bar.hit(e) || !e.isPrimary) return;
    const now = Date.now(), third = e.clientX < innerWidth / 3 ? -1 : e.clientX > innerWidth * 2 / 3 ? 1 : 0;
    if (now - lastTap < 300 && third) { clearTimeout(tapT); lastTap = 0; bar.skip(third * 10); return; }
    lastTap = now; clearTimeout(tapT); tapT = setTimeout(() => bar.toggle(), third ? 260 : 0); }, true);
  // Long-press any pane (~0.55 s, finger still): the panes swap places.
  let lp = 0, lpX = 0, lpY = 0;
  addEventListener("pointerdown", e => { if (!on || !e.isPrimary) return; clearTimeout(lp); lpX = e.clientX; lpY = e.clientY;
    lp = setTimeout(() => { lp = 0; lastTap = 0; clearTimeout(tapT); try { navigator.vibrate && navigator.vibrate(12); } catch (_) {} try { location.href = "hush-split://swap"; } catch (_) {} }, 550); }, true);
  addEventListener("pointermove", e => { if (lp && Math.hypot(e.clientX - lpX, e.clientY - lpY) > 12) { clearTimeout(lp); lp = 0; } }, true);
  for (const t of ["pointerup", "pointercancel"]) addEventListener(t, () => { clearTimeout(lp); lp = 0; }, true);
  addEventListener("contextmenu", e => { if (on) e.preventDefault(); }, true);
  addEventListener("pointerdown", e => { if (on && !focus && e.isTrusted) { eat = Date.now() + 700; e.preventDefault(); e.stopImmediatePropagation(); ask(); } }, true);
  for (const t of ["mousedown", "mouseup", "pointerup", "click", "dblclick", "touchstart", "touchend"]) addEventListener(t, swallow, true);
  // Event-driven upkeep (no busy polling): players swap their <video> (ads, next episode), drop the top layer, or
  // reset sound — react to those events; a slow 4 s check is only a safety net.
  const upkeep = () => { if (!on) return; sound(); if (!cur || !cur.isConnected) { const nv = pick(); if (nv) fill(nv); } else if (!cur.matches(":popover-open")) { __hushSolo(cur, true); ring(); } bar.sync(); };
  let uq = 0; const soon = () => { if (on && !uq) uq = setTimeout(() => { uq = 0; upkeep(); }, 120); };
  new MutationObserver(ms => { if (!on) return; for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.tagName === "VIDEO" || n.tagName === "IFRAME" || n.querySelector?.("video,iframe"))) return soon();
    if (cur && !cur.isConnected) soon(); }).observe(document.documentElement, { childList: true, subtree: true });
  for (const t of ["loadstart", "loadedmetadata", "emptied", "playing"]) document.addEventListener(t, soon, true);
  document.addEventListener("toggle", e => { if (on && e.target === cur && e.newState === "closed") soon(); }, true);
  return o => { on = !!(o && o.on); const f = !!(o && o.focus); const gained = on && f && !focus; if (o && o.sw) sw = o.sw; else if (f !== focus) sw = Date.now(); focus = f; clearInterval(tick);
    if (!on) { unfill(); ring(); sound(); return; }
    sound(true); ring(); const v = pick(); if (v) fill(v); if (gained) bar.flash();
    tick = setInterval(upkeep, 4000); };
})();
