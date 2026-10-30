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
  // window.open: only after a real click (<1s) and never as a window; same-origin opens in place, others denied.
  window.open = function (u) {
    if (Date.now() - last > 1000 || !u) return null;
    try { const t = new URL(u, location.href); if (t.origin === location.origin) location.href = t.href; } catch (_) {}
    return null;
  };
  try { const u = new URL(location.href);
    ["fbclid","gclid","utm_source","utm_medium","utm_campaign","utm_term","utm_content","mc_eid","msclkid"].forEach(k => u.searchParams.delete(k));
    if (u.href !== location.href) history.replaceState(null, "", u.href); } catch (_) {}
  try {
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 4 });
    Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
  } catch (_) {}
})();
