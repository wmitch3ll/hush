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
    // <a target=_blank>: another site opens in a background tab (your page stays put); same site opens in place.
    if (a.target && a.target !== "_self") { if (cross && /^https?:/i.test(a.href)) { e.preventDefault(); e.stopImmediatePropagation(); report("tab", a.href); } else a.target = "_self"; }
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
  window.open = function (u) {
    if (Date.now() - last > 1000 || !u) return null;
    try { const t = new URL(u, location.href); if (t.origin === location.origin) location.href = t.href; } catch (_) {}
    return null;
  };
  try { const u = new URL(location.href);
    ["fbclid","gclid","utm_source","utm_medium","utm_campaign","utm_term","utm_content","mc_eid","msclkid"].forEach(k => u.searchParams.delete(k));
    if (u.href !== location.href) history.replaceState(null, "", u.href); } catch (_) {}
  // Hardware / canvas / WebGL / audio fingerprinting is handled by farble.js (per-site randomized values).
})();
