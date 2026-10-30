// Injected into every page. Popup guard + cheap fingerprint/tracking hardening.
(() => {
  let last = 0, lastEl = null;
  addEventListener("click", e => {
    if (!e.isTrusted) return;
    last = Date.now(); lastEl = e.target;
    // Real click on <a target=_blank>: open in this tab instead of a new window.
    const a = e.target.closest && e.target.closest("a[target]");
    if (a && a.target !== "_self") a.target = "_self";
  }, true);
  // Shift-click a link = Peek (floating preview); Ctrl/Cmd-click or middle-click = open in a background tab.
  // Reported to Hush through a navigation that Hush intercepts and cancels (tabs have no other channel).
  let lastPeek = 0;
  const linkOf = e => { const a = e.target.closest && e.target.closest("a[href]"); return a && /^https?:/i.test(a.href) ? a.href : null; };
  const report = (mode, href) => { if (Date.now() - lastPeek < 400) return; lastPeek = Date.now();
    location.href = "hush-peek://" + mode + "?u=" + encodeURIComponent(href); };
  addEventListener("click", e => { if (!e.isTrusted) return; const href = linkOf(e); if (!href) return;
    if (e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopImmediatePropagation(); report("peek", href); }
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
