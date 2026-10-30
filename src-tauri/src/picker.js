// Element picker. Injected on demand. Tap/click an element -> "Block" -> saved as host##selector.
// Result travels back by navigating to hush-pick:// (intercepted + cancelled in Rust on_navigation).
(() => {
  if (window.__hushPick) return; window.__hushPick = true;
  const z = "2147483647", css = (e, s) => (e.style.cssText = s);
  const box = document.createElement("div");
  css(box, `position:fixed;z-index:${z};pointer-events:none;border:2px solid #fff;outline:2px solid #000;background:#0003;display:none`);
  const bar = document.createElement("div");
  css(bar, `position:fixed;z-index:${z};left:50%;bottom:20px;transform:translateX(-50%);background:#111;color:#fff;font:14px system-ui;padding:10px 14px;border-radius:12px;display:flex;gap:10px;align-items:center`);
  const watch = window.__hushPickMode === "watch"; window.__hushPickMode = "";
  const msg = document.createElement("span"); msg.textContent = watch ? "Tap the price or text to watch" : "Tap an element to block";
  const mk = t => { const b = document.createElement("button"); b.textContent = t; css(b, "all:unset;cursor:pointer;padding:6px 12px;border-radius:8px;background:#fff;color:#111;font:600 13px system-ui"); return b; };
  const ok = mk(watch ? "Watch" : "Block"), no = mk("Cancel"); ok.style.display = "none";
  bar.append(msg, ok, no); document.documentElement.append(box, bar);
  let target = null;
  const sel = el => {
    const p = [];
    while (el && el.nodeType === 1 && el !== document.documentElement && p.length < 4) {
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) { p.unshift("#" + el.id); break; }
      let s = el.localName; const c = [...el.classList].filter(x => /^[A-Za-z][\w-]*$/.test(x)).slice(0, 2);
      if (c.length) s += "." + c.join(".");
      else s += ":nth-of-type(" + ([...el.parentNode.children].filter(x => x.localName === el.localName).indexOf(el) + 1) + ")";
      p.unshift(s); el = el.parentElement;
    }
    return p.join(" > ");
  };
  const hit = e => { const p = e.touches ? e.touches[0] : e; const el = document.elementFromPoint(p.clientX, p.clientY); return el && !bar.contains(el) && el !== box ? el : null; };
  const pick = e => {
    if (bar.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    const el = hit(e); if (!el) return; target = el;
    const r = el.getBoundingClientRect();
    css(box, `position:fixed;z-index:${z};pointer-events:none;border:2px solid #fff;outline:2px solid #000;background:#0003;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`);
    msg.textContent = sel(el).slice(-48); ok.style.display = "";
  };
  const off = () => { document.removeEventListener("click", pick, true); box.remove(); bar.remove(); window.__hushPick = false; };
  document.addEventListener("click", pick, true);
  no.onclick = off;
  ok.onclick = () => {
    if (!target) return; const s = sel(target);
    if (watch) { const t = (target.innerText || "").trim().replace(/\s+/g, " ").slice(0, 300); off();
      location.href = "hush-pick://watch?host=" + encodeURIComponent(location.hostname) + "&sel=" + encodeURIComponent(s) + "&text=" + encodeURIComponent(t); return; }
    target.style.display = "none"; off();
    location.href = "hush-pick://add?host=" + encodeURIComponent(location.hostname) + "&sel=" + encodeURIComponent(s);
  };
})();
