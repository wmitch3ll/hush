// Page tools injected at document start (desktop + Android). Rust prepends: const __HUSH_TOOLS = {clean, video, gestures};
// 1) Link cleaner: strips tracking junk (utm_*, fbclid, gclid…) from links before you follow or copy them.
// 2) Video controls: a small bar on any video — speed, ±10 s, loop, picture-in-picture.
// 3) Gestures: right-button drag (desktop) / two-finger swipe (phone) -> hush-gesture://<shape>; right-hold / two-finger hold = quick wheel.
(() => {
  if (window.__hushTools || window.top !== window && !document.documentElement) return; window.__hushTools = true;
  const cfg = (typeof __HUSH_TOOLS === "object" && __HUSH_TOOLS) || { clean: true, video: true, gestures: false, quality: "1080" };
  const TRACK = /^(utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_eid|mc_cid|igshid|igsh|yclid|_hsenc|_hsmi|mkt_tok|oly_anon_id|oly_enc_id|vero_id|wickedid|twclid|ttclid|s_cid|rb_clickid|_openstat|ref_src|ref_url|si)$/i;
  const KEEP_SI = /(^|\.)(spotify|youtube|youtu)\./i;   // "si" is a share-tracking id on these sites only
  const clean = href => { try { const u = new URL(href, location.href); if (!/^https?:$/.test(u.protocol)) return href; let changed = false;
      for (const k of [...u.searchParams.keys()]) if (TRACK.test(k) && (k !== "si" || KEEP_SI.test(u.hostname))) { u.searchParams.delete(k); changed = true; }
      return changed ? u.href : href; } catch (e) { return href; } };
  if (cfg.clean) {
    const fix = e => { const a = e.target.closest && e.target.closest("a[href]"); if (a) { const c = clean(a.href); if (c !== a.href) a.href = c; } };
    addEventListener("mousedown", fix, true); addEventListener("touchstart", fix, { capture: true, passive: true }); addEventListener("keydown", e => { if (e.key === "Enter") fix(e); }, true);
    addEventListener("copy", e => { const s = String(getSelection()).trim(); if (/^https?:\/\/\S+$/.test(s)) { const c = clean(s); if (c !== s) { e.clipboardData.setData("text/plain", c); e.preventDefault(); } } }, true);
    if (window.top === window) { const c = clean(location.href); if (c !== location.href) try { history.replaceState(history.state, "", c); } catch (e) {} }
  }

  if (cfg.video) {
    const css = ":host{all:initial}.b{position:fixed;z-index:2147483646;display:flex;gap:2px;align-items:center;background:#111d;color:#fff;border-radius:10px;padding:3px;font:600 12px system-ui;backdrop-filter:blur(6px);opacity:0;transition:opacity .15s;pointer-events:none}" +
      ".b.on{opacity:1;pointer-events:auto}button{all:unset;cursor:pointer;padding:5px 8px;border-radius:7px;min-width:18px;text-align:center}button:hover{background:#fff2}button.a{background:#fff;color:#111}";
    let host, bar, vid, hideT;
    const make = () => { host = document.createElement("hush-video"); const sh = host.attachShadow({ mode: "closed" });
      sh.innerHTML = `<style>${css}</style><div class=b><button data-k=-10 title="Back 10 s">−10</button><button data-k=slow title="Slower">−</button><button data-k=rate title="Normal speed">1×</button><button data-k=fast title="Faster">+</button><button data-k=10 title="Forward 10 s">+10</button><button data-k=loop title="Loop">⟲</button><button data-k=pip title="Picture-in-picture">⧉</button></div>`;
      bar = sh.querySelector(".b"); document.documentElement.append(host);
      bar.addEventListener("click", e => { const k = e.target.dataset && e.target.dataset.k; if (!k || !vid) return; e.stopPropagation();
        if (k === "-10" || k === "10") vid.currentTime = Math.max(0, vid.currentTime + +k);
        else if (k === "slow" || k === "fast") vid.playbackRate = Math.min(4, Math.max(.25, Math.round((vid.playbackRate + (k === "fast" ? .25 : -.25)) * 100) / 100));
        else if (k === "rate") vid.playbackRate = 1;
        else if (k === "loop") vid.loop = !vid.loop;
        else if (k === "pip") { if (document.pictureInPictureElement) document.exitPictureInPicture(); else vid.requestPictureInPicture && vid.requestPictureInPicture().catch(() => {}); }
        paint(); }, true);
      bar.addEventListener("pointerenter", () => clearTimeout(hideT)); bar.addEventListener("pointerleave", () => hide()); };
    const paint = () => { if (!vid) return; const s = bar.querySelector('[data-k=rate]'); s.textContent = vid.playbackRate + "×"; bar.querySelector('[data-k=loop]').classList.toggle("a", vid.loop); };
    const place = v => { const r = v.getBoundingClientRect(); if (r.width < 200 || r.height < 120) return false;
      bar.style.left = Math.max(4, r.left + 8) + "px"; bar.style.top = Math.max(4, r.top + 8) + "px"; return true; };
    const show = v => { if (!host) make(); vid = v; if (!place(v)) return; paint(); bar.classList.add("on"); clearTimeout(hideT); hideT = setTimeout(hide, 2600); };
    const hide = () => { clearTimeout(hideT); hideT = setTimeout(() => bar && bar.classList.remove("on"), 300); };
    const over = e => { const v = e.target && e.target.closest ? e.target.closest("video") : null;
      if (v) return show(v);
      // Many players put an overlay above the <video>: look for one under the pointer.
      const p = e.touches ? e.touches[0] : e; if (!p) return;
      for (const el of document.elementsFromPoint(p.clientX, p.clientY)) if (el.tagName === "VIDEO") return show(el); };
    addEventListener("pointermove", e => { if (e.pointerType === "mouse") over(e); }, { passive: true, capture: true });
    addEventListener("touchstart", over, { passive: true, capture: true });
    addEventListener("scroll", () => bar && bar.classList.remove("on"), { passive: true, capture: true });
  }

  // YouTube video quality: start at your chosen quality (default 1080p) instead of YouTube's low "auto" pick.
  const Q = { "2160": "hd2160", "1440": "hd1440", "1080": "hd1080", "720": "hd720", "480": "large" };
  if (cfg.quality && Q[cfg.quality] && /(^|\.)youtube\.com$/.test(location.hostname)) {
    const q = +cfg.quality, now = Date.now();
    try { localStorage.setItem("yt-player-quality", JSON.stringify({ data: JSON.stringify({ quality: q, previousQuality: q }), expiration: now + 31536e6, creation: now })); } catch (e) {}
    const apply = () => { const p = document.getElementById("movie_player") || document.querySelector(".html5-video-player");
      if (p && p.setPlaybackQualityRange) { try { const lv = p.getAvailableQualityLevels ? p.getAvailableQualityLevels() : [];
        const want = lv.includes(Q[cfg.quality]) ? Q[cfg.quality] : (lv.find(l => /^hd/.test(l)) || Q[cfg.quality]);
        p.setPlaybackQualityRange(want, want); if (p.setPlaybackQuality) p.setPlaybackQuality(want); } catch (e) {} } };
    let n = 0; const tick = setInterval(() => { apply(); if (++n > 20) clearInterval(tick); }, 1000);
    addEventListener("yt-navigate-finish", () => { n = 0; apply(); }, true);
    document.addEventListener("loadeddata", e => { if (e.target && e.target.tagName === "VIDEO") setTimeout(apply, 300); }, true);
  }

  // Gestures. Mouse (desktop): hold the right button and draw. Touch (Android): swipe with two fingers.
  // The page only reports the shape; what it does is chosen in Settings. Quick right-click still opens the menu.
  const send = g => { location.href = "hush-gesture://" + g; };
  if (cfg.gestures && window.top === window) {
    let pts = null, drew = false, holdT = 0;
    addEventListener("mousedown", e => { if (e.button !== 2) return; pts = [[e.clientX, e.clientY]]; drew = false;
      clearTimeout(holdT); holdT = setTimeout(() => { if (pts && pts.length < 4 && cfg.wheel && cfg.wheel.length) { pts = null; drew = true; wheel(e.clientX, e.clientY, true); } }, 380); }, true);
    addEventListener("mousemove", e => { if (pts && e.buttons & 2) { pts.push([e.clientX, e.clientY]); if (pts.length > 3) clearTimeout(holdT); } }, true);
    addEventListener("mouseup", e => { if (e.button !== 2) return; clearTimeout(holdT); if (!pts) return; const dirs = dirsOf(pts); pts = null;
      if (dirs.length && dirs.length <= 3) { drew = true; send(dirs.join("")); } }, true);
    addEventListener("contextmenu", e => { if (drew) { e.preventDefault(); e.stopImmediatePropagation(); drew = false; } }, true);
    // Two fingers: swipe = gesture "T"+direction; touch-and-hold with two fingers = the quick wheel.
    let t0 = null, tHold = 0;
    addEventListener("touchstart", e => { if (e.touches.length !== 2) { t0 = null; return; }
      const m = mid(e.touches); t0 = { x: m[0], y: m[1], moved: false }; clearTimeout(tHold);
      tHold = setTimeout(() => { if (t0 && !t0.moved && cfg.wheel && cfg.wheel.length) { const p = t0; t0 = null; wheel(p.x, p.y, false); } }, 450); }, { passive: true, capture: true });
    addEventListener("touchmove", e => { if (!t0 || e.touches.length !== 2) return; const m = mid(e.touches), dx = m[0] - t0.x, dy = m[1] - t0.y;
      if (Math.hypot(dx, dy) > 12) { t0.moved = true; clearTimeout(tHold); }
      if (Math.hypot(dx, dy) > 110) { const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : (dy > 0 ? "D" : "U"); t0 = null; send("T" + d); } }, { passive: true, capture: true });
    addEventListener("touchend", () => { clearTimeout(tHold); }, { passive: true, capture: true });
  }
  function mid(t) { return [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2]; }
  function dirsOf(p) { const dirs = []; let [ax, ay] = p[0];
    for (const [x, y] of p) { const dx = x - ax, dy = y - ay; if (Math.hypot(dx, dy) < 40) continue;
      const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : (dy > 0 ? "D" : "U"); if (dirs.at(-1) !== d) dirs.push(d); ax = x; ay = y; }
    return dirs; }

  // Quick wheel: up to 8 favourite actions in a ring around the pointer. Slide toward one and let go (or tap it).
  const LABELS = { back: ["Back", "‹"], forward: ["Forward", "›"], reload: ["Reload", "↻"], newtab: ["New tab", "+"], closetab: ["Close tab", "✕"], reopen: ["Reopen tab", "↺"],
    nexttab: ["Next tab", "⇥"], prevtab: ["Previous tab", "⇤"], top: ["Top", "⤒"], bottom: ["Bottom", "⤓"], find: ["Find", "⌕"], reader: ["Reader", "¶"], listen: ["Listen", "♪"],
    screenshot: ["Screenshot", "◫"], tor: ["Tor tab", "◎"], newid: ["New identity", "⟳"], bookmark: ["Bookmark", "★"], copylink: ["Copy link", "⧉"], dark: ["Dark mode", "◐"],
    alltabs: ["All tabs", "▦"], home: ["Start page", "⌂"], private: ["Private tab", "◌"], mute: ["Mute", "🔇"], boosts: ["Boosts", "≋"], destruct: ["Self-destruct", "⏲"] };
  function wheel(cx, cy, mouse) {
    const ids = (cfg.wheel || []).filter(id => LABELS[id]).slice(0, 8); if (!ids.length) return;
    const host = document.createElement("hush-wheel"), sh = host.attachShadow({ mode: "closed" }), R = 86, n = ids.length;
    const x = Math.min(innerWidth - R - 40, Math.max(R + 40, cx)), y = Math.min(innerHeight - R - 40, Math.max(R + 40, cy));
    sh.innerHTML = `<style>:host{all:initial}.s{position:fixed;inset:0;z-index:2147483647;background:#0003;touch-action:none}
      .c{position:fixed;width:${2 * R + 76}px;height:${2 * R + 76}px;left:${x - R - 38}px;top:${y - R - 38}px;border-radius:50%;background:#111d;backdrop-filter:blur(10px);animation:p .16s cubic-bezier(.2,.9,.3,1.3)}
      @keyframes p{from{transform:scale(.6);opacity:0}}.i{position:absolute;width:62px;height:62px;margin:-31px;border-radius:50%;display:grid;place-items:center;color:#fff;font:20px system-ui;transition:transform .1s,background .1s}
      .i small{position:absolute;top:66px;font:600 10.5px system-ui;white-space:nowrap;color:#fff;opacity:0;transition:opacity .1s}.i.on{background:#fff;color:#111;transform:scale(1.15)}.i.on small{opacity:1}
      .m{position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px;border-radius:50%;background:#fff8}</style>
      <div class=s><div class=c>${ids.map((id, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n;
        return `<div class=i data-id=${id} style="left:${R + 38 + Math.cos(a) * R}px;top:${R + 38 + Math.sin(a) * R}px">${LABELS[id][1]}<small>${LABELS[id][0]}</small></div>`; }).join("")}<div class=m></div></div></div>`;
    document.documentElement.append(host);
    const items = [...sh.querySelectorAll(".i")]; let cur = null;
    const aim = (px, py) => { const dx = px - x, dy = py - y; cur = null;
      if (Math.hypot(dx, dy) > 28) { let a = Math.atan2(dy, dx) + Math.PI / 2; if (a < 0) a += 2 * Math.PI; cur = Math.round(a / (2 * Math.PI / n)) % n; }
      items.forEach((el, i) => el.classList.toggle("on", i === cur)); };
    const done = run => { removeEventListener("mousemove", mm, true); removeEventListener("mouseup", mu, true); removeEventListener("touchmove", tm, true); removeEventListener("touchend", te, true);
      host.remove(); if (run && cur != null) { try { navigator.vibrate && navigator.vibrate(8); } catch (e) {} send("a-" + ids[cur]); } };
    const mm = e => aim(e.clientX, e.clientY), mu = e => { if (cur != null) done(true); };
    const tm = e => { if (e.touches[0]) aim(e.touches[0].clientX, e.touches[0].clientY); }, te = () => { if (cur != null) done(true); };
    addEventListener("mousemove", mm, true); addEventListener("mouseup", mu, true);
    addEventListener("touchmove", tm, { capture: true, passive: true }); addEventListener("touchend", te, true);
    sh.querySelector(".s").addEventListener("click", e => { const i = e.target.closest && e.target.closest(".i"); if (i) { cur = items.indexOf(i); done(true); } else done(false); });
    addEventListener("keydown", function k(e) { if (e.key === "Escape") { removeEventListener("keydown", k, true); done(false); } }, true);
  }
  window.__hushWheel = (x, y) => wheel(x == null ? innerWidth / 2 : x, y == null ? innerHeight / 2 : y, false);
})();
