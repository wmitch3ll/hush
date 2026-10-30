// Floating video: the tab shrinks to a small player you can drag anywhere and resize and shows only its playing video, with small controls.
// Rust appends __hushFloat(true|false). Controls report back by navigating to hush-float://<action> (cancelled in Rust/Kotlin).
window.__hushFloat = window.__hushFloat || ((on) => {
  const old = document.getElementById("hush-float"); if (old) old.remove();
  const prev = document.querySelector("[data-hush-float]");
  if (prev) { prev.style.cssText = prev.dataset.hushFloat; prev.removeAttribute("data-hush-float"); }
  if (!on) { document.documentElement.style.overflow = ""; return; }
  const vids = [...document.querySelectorAll("video")];
  const v = vids.find(x => !x.paused && x.readyState > 2) || vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  if (!v) return;
  v.dataset.hushFloat = v.style.cssText;
  v.style.cssText += ";position:fixed!important;inset:0!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483646!important;object-fit:contain!important;background:#000!important;transform:none!important;margin:0!important";
  document.documentElement.style.overflow = "hidden";
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
