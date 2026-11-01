// Split screen: each half is a full page. A video in a half fills that half with the browser's own full
// controls (play, seek, volume, fullscreen). The half you last tapped is "focused": it gets a highlight ring
// and the sound; the other half keeps playing muted. Text sites are left as they are.
// Rust/Kotlin appends __hushSplit({on, focus}). A tap on an unfocused half reports hush-split://focus (cancelled natively).
window.__hushSplit = window.__hushSplit || (() => {
  let on = false, focus = false, cur = null, keep = null;
  const area = v => v.clientWidth * v.clientHeight;
  const unfill = () => {
    document.getElementById("hush-split-css")?.remove(); keep?.disconnect(); keep = null;
    document.querySelectorAll("[data-hush-split],[data-hush-split-anc]").forEach(e => { e.removeAttribute("data-hush-split"); e.removeAttribute("data-hush-split-anc"); });
    if (cur && cur.__hushCtl === false) cur.controls = false; cur = null; window.dispatchEvent(new Event("resize"));
  };
  const fill = v => {
    if (cur === v) return; unfill(); cur = v;
    v.setAttribute("data-hush-split", "");
    for (let e = v.parentElement; e && e !== document.documentElement; e = e.parentElement) e.setAttribute("data-hush-split-anc", "");
    const st = document.createElement("style"); st.id = "hush-split-css";
    st.textContent = "html,body{overflow:hidden!important;background:#000!important}body *{visibility:hidden!important}" +
      "[data-hush-split-anc]{visibility:visible!important;transform:none!important;filter:none!important;contain:none!important;will-change:auto!important;perspective:none!important;clip-path:none!important;mask:none!important}" +
      "video[data-hush-split]{visibility:visible!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483640!important;object-fit:contain!important;background:#000!important;transform:none!important;margin:0!important;border:0!important}";
    (document.head || document.documentElement).append(st);
    // The browser's own full controls; some players remove them again, so keep them on.
    v.__hushCtl = v.controls; v.controls = true;
    keep = new MutationObserver(() => { if (on && !v.controls) v.controls = true; }); keep.observe(v, { attributes: true, attributeFilter: ["controls"] });
  };
  const pick = () => { const vids = [...document.querySelectorAll("video")].filter(v => area(v) > 0 || !v.paused);
    const v = vids.find(x => !x.paused && x.readyState > 2) || vids.sort((a, b) => area(b) - area(a))[0];
    return v && (!v.paused || area(v) >= innerWidth * innerHeight * 0.12) ? v : null; };
  const sound = () => document.querySelectorAll("video,audio").forEach(x => { x.muted = on ? !focus : !!window.__hushMuted; });
  const ring = () => { let r = document.getElementById("hush-split-ring");
    if (!on || !focus) { r?.remove(); return; }
    if (!r) { r = document.createElement("hush-split-ring"); r.id = "hush-split-ring"; document.documentElement.append(r); }
    r.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;box-shadow:inset 0 0 0 3px #4da3ff;border-radius:2px;visibility:visible"; };
  document.addEventListener("play", e => { if (!on) return; e.target.muted = !focus; if (e.target.tagName === "VIDEO" && cur !== e.target && (area(e.target) > 0)) fill(e.target); }, true);
  // Tapping the other half moves the focus (and the sound) there; the tap itself still reaches the page.
  addEventListener("pointerdown", e => { if (on && !focus && e.isTrusted) { focus = true; sound(); ring(); try { location.href = "hush-split://focus"; } catch (_) {} } }, true);
  return o => { on = !!(o && o.on); focus = !!(o && o.focus);
    if (!on) { unfill(); ring(); sound(); return; }
    sound(); ring(); const v = pick(); if (v) fill(v); };
})();
