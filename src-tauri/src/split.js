// Split screen: each half is a full page. A video in a half fills that half with the browser's own full
// controls (play, seek, volume, fullscreen). The half you last tapped is "focused": it gets a highlight ring
// and the sound; the other half keeps playing muted. Text sites are left as they are.
// Rust/Kotlin appends __hushSplit({on, focus}). A tap on an unfocused half reports hush-split://focus (cancelled natively).
// Top layer: lift the video above EVERYTHING on the page (headers, overlays, shadow-DOM parts that CSS can't hide),
// over a black backdrop, without moving it in the page — so the site's player keeps working.
const __hushSolo = window.__hushSolo || (window.__hushSolo = (v, on) => { try {
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
    if (cur && cur.__hushCtl === false) cur.controls = false; cur = null; window.dispatchEvent(new Event("resize"));
  };
  const fill = v => {
    if (cur === v) return; unfill(); cur = v;
    v.setAttribute("data-hush-split", "");
    for (let e = v.parentElement; e && e !== document.documentElement; e = e.parentElement) e.setAttribute("data-hush-split-anc", "");
    const st = document.createElement("style"); st.id = "hush-split-css";
    const tag = v.tagName.toLowerCase();
    st.textContent = "html,body{overflow:hidden!important;background:#000!important}body *{visibility:hidden!important}" +
      "[data-hush-split-anc]{visibility:visible!important;transform:none!important;filter:none!important;contain:none!important;will-change:auto!important;perspective:none!important;clip-path:none!important;mask:none!important}" +
      tag + "[data-hush-split]{visibility:visible!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483640!important;object-fit:contain!important;background:#000!important;transform:none!important;margin:0!important;border:0!important}";
    (document.head || document.documentElement).append(st);
    __hushSolo(v, true);
    // The browser's own full controls; some players remove them again, so keep them on. (A player frame has its own.)
    if (v.tagName === "VIDEO") { v.__hushCtl = v.controls; v.controls = true;
      keep = new MutationObserver(() => { if (on && !v.controls) v.controls = true; }); keep.observe(v, { attributes: true, attributeFilter: ["controls"] }); }
    ring();   // the highlight ring goes above the lifted video
  };
  // The video — or, on streaming sites that embed another site's player, the player FRAME (the video lives inside it).
  const pick = () => { const vids = [...document.querySelectorAll("video")].filter(v => area(v) > 0 || !v.paused);
    const v = vids.find(x => !x.paused && x.readyState > 2) || vids.sort((a, b) => area(b) - area(a))[0];
    if (v && (!v.paused || area(v) >= innerWidth * innerHeight * 0.12)) return v;
    const fr = [...document.querySelectorAll("iframe")].filter(f => area(f) >= innerWidth * innerHeight * 0.08 && getComputedStyle(f).visibility !== "hidden").sort((a, b) => area(b) - area(a))[0];
    return fr || null; };
  const media = () => { try { window.__hushMediaSet && window.__hushMediaSet(on ? { on, mute: !focus, keep: true, sw } : { on: false }); } catch (_) {} };
  const want = () => on ? !focus : !!window.__hushMuted;
  const sound = () => { document.querySelectorAll("video,audio").forEach(x => { if (x.muted !== want()) x.muted = want(); }); media(); };
  // Sites (YouTube…) re-apply their own mute/volume; while split is on, Hush's choice wins.
  document.addEventListener("volumechange", e => { if (on && e.target.muted !== want()) e.target.muted = want(); }, true);
  let tick = 0;
  const ring = () => { let r = document.getElementById("hush-split-ring");
    if (!on || !focus) { r?.remove(); return; }
    if (!r) { r = document.createElement("hush-split-ring"); r.id = "hush-split-ring"; document.documentElement.append(r); }
    r.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;box-shadow:inset 0 0 0 3px #4da3ff;border-radius:2px;visibility:visible;margin:0;padding:0;border:0;background:transparent;width:100vw;height:100vh";
    try { if (!r.hasAttribute("popover")) r.setAttribute("popover", "manual"); if (r.matches(":popover-open")) r.hidePopover(); r.showPopover(); } catch (_) {} };
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
    if (!on || v.tagName !== "VIDEO" || v.ended || (!switching() && (focus || Date.now() - touched < 1500))) return;
    const retry = n => setTimeout(() => { if (!on || !v.paused || v.ended || (!switching() && (focus || Date.now() - touched < 1500))) return;
      v.muted = !focus; v.play().then(() => {}, () => n < 4 && retry(n + 1)); }, n ? 450 : 250);
    retry(0); }, true);
  const ask = () => { try { location.href = "hush-split://focus"; } catch (_) {} };
  addEventListener("message", e => { if (e.data && e.data.__hushTap && on && !focus) ask(); });
  // Tapping the other half moves the focus (and the sound) there; the tap itself still reaches the page.
  // Report the tap; Hush mutes the other pane first and then gives this one the sound (never both audible at once).
  addEventListener("pointerdown", e => { if (on && !focus && e.isTrusted) ask(); }, true);
  return o => { on = !!(o && o.on); const f = !!(o && o.focus); if (o && o.sw) sw = o.sw; else if (f !== focus) sw = Date.now(); focus = f; clearInterval(tick);
    if (!on) { unfill(); ring(); sound(); return; }
    sound(); ring(); const v = pick(); if (v) fill(v);
    // Players swap their <video> element (ads, next episode): keep sound, fill and controls right.
    tick = setInterval(() => { if (!on) return; sound(); if (!cur || !cur.isConnected) { const nv = pick(); if (nv) fill(nv); } else if (!cur.matches(":popover-open")) __hushSolo(cur, true); }, 800); };
})();
