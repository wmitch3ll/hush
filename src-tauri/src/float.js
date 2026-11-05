// Floating video: the tab shrinks to a small player you can drag anywhere and resize and shows only its playing video, with small controls.
// Rust appends __hushFloat(true|false). Controls report back by navigating to hush-float://<action> (cancelled in Rust/Kotlin).
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
window.__hushFloat = window.__hushFloat || ((on) => {
  const old = document.getElementById("hush-float"); if (old) old.remove();
  const css0 = document.getElementById("hush-float-css"); if (css0) css0.remove();
  document.querySelectorAll("[data-hush-float]").forEach(x => __hushSolo(x, false));
  document.querySelectorAll("[data-hush-float],[data-hush-float-anc]").forEach(e => { e.removeAttribute("data-hush-float"); e.removeAttribute("data-hush-float-anc"); });
  window.__hushFloatOn = !!on;
  if (!on) { window.dispatchEvent(new Event("resize")); return; }
  const vids = [...document.querySelectorAll("video")];
  const area = x => x.clientWidth * x.clientHeight;
  // Streaming sites often embed another site's player: then the player FRAME is what we keep (the video is inside it).
  const v = vids.find(x => !x.paused && x.readyState > 2) || vids.sort((a, b) => area(b) - area(a))[0]
    || [...document.querySelectorAll("iframe")].filter(f => area(f) >= innerWidth * innerHeight * 0.08).sort((a, b) => area(b) - area(a))[0];
  if (!v) return;
  const isVid = v.tagName === "VIDEO";
  // A stylesheet (not inline styles) so the site's own player code can't undo it when the window shrinks.
  // Everything else is hidden; the video's parents lose transforms/containment so "fixed" really fills the view.
  v.setAttribute("data-hush-float", "");
  for (let e = v.parentElement; e && e !== document.documentElement; e = e.parentElement) e.setAttribute("data-hush-float-anc", "");
  const st = document.createElement("style"); st.id = "hush-float-css";
  st.textContent = "html,body{overflow:hidden!important;background:#000!important}body *{visibility:hidden!important}" +
    "[data-hush-float-anc]{visibility:visible!important;transform:none!important;filter:none!important;contain:none!important;will-change:auto!important;perspective:none!important;backdrop-filter:none!important;clip-path:none!important;mask:none!important}" +
    v.tagName.toLowerCase() + "[data-hush-float]{visibility:visible!important;position:fixed!important;inset:0!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;z-index:2147483646!important;object-fit:contain!important;background:#000!important;transform:none!important;margin:0!important;padding:0!important;border:0!important}";
  (document.head || document.documentElement).append(st);
  __hushSolo(v, true);
  const go = a => { location.href = "hush-float://" + a; };
const FI = { play: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="#fff" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>', pause: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="#fff" d="M7 5h3.2v14H7zM13.8 5H17v14h-3.2z"/></svg>', x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>', open: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/></svg>' };
  const ui = document.createElement("hush-float"); ui.id = "hush-float";
  const sh = ui.attachShadow({ mode: "closed" });
  sh.innerHTML = `<style>:host{all:initial}.o{position:fixed;inset:0;z-index:2147483647;cursor:grab;touch-action:none}
    .b{position:absolute;display:flex;gap:4px;opacity:0;pointer-events:none;transition:opacity .15s}.o:hover .b,.o.t .b{opacity:1;pointer-events:auto}
    .tl{left:6px;top:6px}.tr{right:6px;top:6px}.c{left:50%;top:50%;transform:translate(-50%,-50%)}
    button{all:unset;cursor:pointer;width:32px;height:32px;border-radius:50%;background:rgba(18,18,22,.5);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.14);color:#fff;display:grid;place-items:center;font:600 14px system-ui}
    .c button{width:52px;height:52px}.g{position:absolute;right:0;bottom:0;width:26px;height:26px;cursor:nwse-resize;touch-action:none;background:linear-gradient(135deg,transparent 55%,#fff8 55%,#fff8 62%,transparent 62%,transparent 72%,#fff8 72%,#fff8 79%,transparent 79%);opacity:0;transition:opacity .15s}.o:hover .g,.o.t .g{opacity:1}button:hover{background:rgba(18,18,22,.75)}button:active{transform:scale(.94)}</style>
    <div class=o><div class="b tl"><button data-a=open title="Back to the tab">${FI.open}</button></div>
    <div class="b tr"><button data-a=close title="Close the floating video">${FI.x}</button></div>
    <div class="b c"><button data-a=play title="Play / pause">${isVid && v.paused ? FI.play : FI.pause}</button></div>
    <div class="g" title="Drag to resize"></div></div>`;
  document.documentElement.append(ui);
  // Taps on the mini player's own frame and buttons never reach the site underneath (its player would react to them too, ¼ s later).
  for (const t of ["click", "dblclick", "mousedown", "mouseup", "touchstart", "touchend", "touchmove", "pointerdown", "pointerup", "contextmenu"]) ui.addEventListener(t, e => e.stopPropagation());
  try { ui.setAttribute("popover", "manual"); ui.style.cssText = "all:initial;position:fixed;inset:0;margin:0;padding:0;border:0;background:transparent;width:100vw;height:100vh;overflow:visible"; ui.showPopover(); } catch (_) {}
  const o = sh.querySelector(".o"), pb = sh.querySelector("[data-a=play]"), grip = sh.querySelector(".g");
  const sync = () => { pb.innerHTML = v.paused ? FI.play : FI.pause; };
  // Every play/pause shows the controls for a moment, so you can always see what happened.
  let flashT = 0; const flash = () => { o.classList.add("t"); clearTimeout(flashT); flashT = setTimeout(() => { if (!s) o.classList.remove("t"); }, 1800); };
  if (isVid) { v.addEventListener("play", () => { sync(); flash(); }); v.addEventListener("pause", () => { sync(); flash(); }); setTimeout(flash, 50); }
  else { // a player frame: its own controls work (taps go through); keep only move / close / back-to-tab here
    pb.parentElement.remove(); o.style.pointerEvents = "none"; sh.querySelectorAll(".b,.g").forEach(x => x.style.pointerEvents = "auto"); }
  // What YOU asked for wins for a moment: a tap that the page also reacts to (sites often toggle play/pause themselves ~¼ s later)
  // must not undo it. Whatever flips the video within 0.9 s of your tap is flipped straight back (at most 3 times).
  let hold = null;
  const setHold = p => { hold = { p, until: Date.now() + 900, n: 0 }; };
  const enforce = () => { if (!hold || Date.now() > hold.until || v.paused === hold.p || hold.n >= 3) return; hold.n++; if (hold.p) v.pause(); else v.play().catch(() => {}); };
  if (isVid) { v.addEventListener("play", enforce); v.addEventListener("pause", enforce); }
  if (isVid && v.paused && !v.ended) setTimeout(() => { if (window.__hushFloatOn && v.paused && Date.now() - (window.__hushUserPause || 0) > 2500) v.play().catch(() => {}); }, 150);
  // While the mini player is up, nothing but YOU pausing should stop the video: if the page or the system pauses it, play again at once.
  if (isVid) { let n = 0, t0 = 0; v.addEventListener("pause", () => setTimeout(() => { if (!window.__hushFloatOn || !v.paused || v.ended || !v.isConnected) return;
    if (Date.now() - (window.__hushUserPause || 0) < 2500 || (hold && hold.p && Date.now() < hold.until + 1500)) return;
    const now = Date.now(); if (now - t0 > 10000) { t0 = now; n = 0; } if (n++ >= 6) return; v.play().catch(() => {}); }, 40)); }
  o.addEventListener("pointerdown", () => { if (isVid && (!hold || Date.now() > hold.until)) setHold(v.paused); }, true);   // a tap on the frame itself must not toggle the video
  sh.querySelectorAll("[data-a]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); const a = b.dataset.a;
    if (a === "play") { const want = !v.paused; setHold(want); if (v.paused) v.play().catch(() => {}); else { window.__hushUserPause = Date.now(); v.pause(); } } else go(a); }));
  // Drag anywhere to move it; drag the corner grip to resize. Updates are sent ~25×/s while you drag.
  let s = null, last = 0, mode = "", id = 0;
  const send = (a, force) => { const t = performance.now(); if (!force && t - last < 40) return; last = t; go(a); };
  const start = (e, m) => { e.preventDefault(); e.stopPropagation(); mode = m; s = [e.screenX, e.screenY, false]; e.target.setPointerCapture(e.pointerId); o.classList.add("t"); id++; };
  o.addEventListener("pointerdown", e => { if (e.target === o) start(e, "move"); });
  grip.addEventListener("pointerdown", e => start(e, "size"));
  const mv = e => { if (!s) return; const dx = Math.round(e.screenX - s[0]), dy = Math.round(e.screenY - s[1]); if (Math.hypot(dx, dy) > 4) s[2] = true; if (!s[2]) return;
    send((mode === "size" ? "size?dw=" + dx : "move?dx=" + dx + "&dy=" + dy) + "&id=" + id); };
  const up = e => { if (!s) return; const moved = s[2]; last = 0; mv(e); s = null; setTimeout(() => o.classList.remove("t"), 1500); if (moved) setTimeout(() => go("drop?id=" + id), 80); };
  o.addEventListener("pointermove", mv); grip.addEventListener("pointermove", mv);
  o.addEventListener("pointerup", up); grip.addEventListener("pointerup", up); o.addEventListener("pointercancel", up); grip.addEventListener("pointercancel", up);
});
