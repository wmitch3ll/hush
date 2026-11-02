// Floating video: the tab shrinks to a small player you can drag anywhere and resize and shows only its playing video, with small controls.
// Rust appends __hushFloat(true|false). Controls report back by navigating to hush-float://<action> (cancelled in Rust/Kotlin).
// Top layer: lift the video above EVERYTHING on the page (headers, overlays, shadow-DOM parts that CSS can't hide),
// over a black backdrop, without moving it in the page — so the site's player keeps working.
const __hushSolo = window.__hushSolo || (window.__hushSolo = (v, on) => { try {
  if (!document.getElementById("hush-solo-css")) { const c = document.createElement("style"); c.id = "hush-solo-css";
    c.textContent = "video[data-hush-solo]:popover-open{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;object-fit:contain!important;background:#000!important;transform:none!important;display:block!important;visibility:visible!important;opacity:1!important;clip-path:none!important;color:inherit}video[data-hush-solo]::backdrop{background:#000}";
    (document.head || document.documentElement).append(c); }
  if (on) { if (!v.isConnected) return false; if (!v.hasAttribute("popover")) { v.setAttribute("popover", "manual"); v.setAttribute("data-hush-solo", ""); }
    if (v.hasAttribute("data-hush-solo") && !v.matches(":popover-open")) v.showPopover(); return true; }
  if (v.hasAttribute("data-hush-solo")) { try { v.hidePopover(); } catch (_) {} v.removeAttribute("popover"); v.removeAttribute("data-hush-solo"); }
  return true; } catch (_) { return false; } });
window.__hushFloat = window.__hushFloat || ((on) => {
  const old = document.getElementById("hush-float"); if (old) old.remove();
  const css0 = document.getElementById("hush-float-css"); if (css0) css0.remove();
  document.querySelectorAll("video[data-hush-float]").forEach(x => __hushSolo(x, false));
  document.querySelectorAll("[data-hush-float],[data-hush-float-anc]").forEach(e => { e.removeAttribute("data-hush-float"); e.removeAttribute("data-hush-float-anc"); });
  if (!on) { window.dispatchEvent(new Event("resize")); return; }
  const vids = [...document.querySelectorAll("video")];
  const v = vids.find(x => !x.paused && x.readyState > 2) || vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  if (!v) return;
  // A stylesheet (not inline styles) so the site's own player code can't undo it when the window shrinks.
  // Everything else is hidden; the video's parents lose transforms/containment so "fixed" really fills the view.
  v.setAttribute("data-hush-float", "");
  for (let e = v.parentElement; e && e !== document.documentElement; e = e.parentElement) e.setAttribute("data-hush-float-anc", "");
  const st = document.createElement("style"); st.id = "hush-float-css";
  st.textContent = "html,body{overflow:hidden!important;background:#000!important}body *{visibility:hidden!important}" +
    "[data-hush-float-anc]{visibility:visible!important;transform:none!important;filter:none!important;contain:none!important;will-change:auto!important;perspective:none!important;backdrop-filter:none!important;clip-path:none!important;mask:none!important}" +
    "video[data-hush-float]{visibility:visible!important;position:fixed!important;inset:0!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;z-index:2147483646!important;object-fit:contain!important;background:#000!important;transform:none!important;margin:0!important;padding:0!important;border:0!important}";
  (document.head || document.documentElement).append(st);
  __hushSolo(v, true);
  const go = a => { location.href = "hush-float://" + a; };
  const ui = document.createElement("hush-float"); ui.id = "hush-float";
  const sh = ui.attachShadow({ mode: "closed" });
  sh.innerHTML = `<style>:host{all:initial}.o{position:fixed;inset:0;z-index:2147483647;cursor:grab;touch-action:none}
    .b{position:absolute;display:flex;gap:4px;opacity:0;transition:opacity .15s}.o:hover .b,.o.t .b{opacity:1}
    .tl{left:6px;top:6px}.tr{right:6px;top:6px}.c{left:50%;top:50%;transform:translate(-50%,-50%)}
    button{all:unset;cursor:pointer;width:30px;height:30px;border-radius:50%;background:#000a;color:#fff;display:grid;place-items:center;font:600 14px system-ui}
    .c button{width:44px;height:44px;font-size:18px}.g{position:absolute;right:0;bottom:0;width:26px;height:26px;cursor:nwse-resize;touch-action:none;background:linear-gradient(135deg,transparent 55%,#fff8 55%,#fff8 62%,transparent 62%,transparent 72%,#fff8 72%,#fff8 79%,transparent 79%);opacity:0;transition:opacity .15s}.o:hover .g,.o.t .g{opacity:1}button:hover{background:#000d}</style>
    <div class=o><div class="b tl"><button data-a=open title="Back to the tab">⤢</button></div>
    <div class="b tr"><button data-a=close title="Close the floating video">✕</button></div>
    <div class="b c"><button data-a=play title="Play / pause">${v.paused ? "▶" : "❚❚"}</button></div>
    <div class="g" title="Drag to resize"></div></div>`;
  document.documentElement.append(ui);
  try { ui.setAttribute("popover", "manual"); ui.style.cssText = "all:initial;position:fixed;inset:0;margin:0;padding:0;border:0;background:transparent;width:100vw;height:100vh;overflow:visible"; ui.showPopover(); } catch (_) {}
  const o = sh.querySelector(".o"), pb = sh.querySelector("[data-a=play]"), grip = sh.querySelector(".g");
  const sync = () => { pb.textContent = v.paused ? "▶" : "❚❚"; };
  v.addEventListener("play", sync); v.addEventListener("pause", sync);
  sh.querySelectorAll("[data-a]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); const a = b.dataset.a;
    if (a === "play") { v.paused ? v.play() : v.pause(); } else go(a); }));
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
