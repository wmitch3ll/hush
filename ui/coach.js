// Hands-on welcome walkthrough. Each step highlights a real part of Hush, explains what it's for, and (for "do it"
// steps) waits until you actually do it, then cheers and moves on. Info steps have a Next button; any step can be skipped.
// HUSH_COACH.run(steps, { onEnd(finished), onStep(i) })
// step: { sel?: css selector to highlight, title, text, until?: () => bool, optional?: bool, before?: () => void, place?: 'top'|'bottom'|'center' }
window.HUSH_COACH = (() => {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const css = `#hc{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font:15px/1.5 system-ui,-apple-system,sans-serif}
  #hc .hc-hole{position:fixed;border-radius:14px;box-shadow:0 0 0 9999px rgba(0,0,0,.62),0 0 0 3px var(--acc,#4da3ff);transition:all .28s cubic-bezier(.16,1,.3,1);pointer-events:none}
  #hc .hc-hole.hc-none{box-shadow:0 0 0 9999px rgba(0,0,0,.62);width:0!important;height:0!important;left:50%!important;top:50%!important}
  #hc .hc-hole.hc-pulse{animation:hcp 1.4s ease-in-out infinite}@keyframes hcp{50%{box-shadow:0 0 0 9999px rgba(0,0,0,.62),0 0 0 7px var(--acc,#4da3ff)}}
  #hc .hc-bub{position:fixed;left:12px;right:12px;max-width:440px;margin:0 auto;background:var(--card,#1b1b1b);color:var(--ink,#eee);border:1px solid var(--line,#333);border-radius:18px;padding:16px 16px 12px;box-shadow:0 18px 50px #0008;pointer-events:auto;transition:top .28s,bottom .28s,opacity .2s}
  #hc .hc-bub h3{margin:0 0 6px;font:700 18px system-ui}#hc .hc-bub p{margin:0;color:var(--mute,#aaa)}#hc .hc-bub .hc-do{margin-top:10px;padding:8px 10px;border-radius:10px;background:color-mix(in srgb,var(--acc,#4da3ff) 16%,transparent);color:var(--ink,#eee);font-weight:600}
  #hc .hc-row{display:flex;gap:8px;align-items:center;margin-top:12px}#hc .hc-row .hc-sp{flex:1}#hc .hc-n{font:600 12px system-ui;color:var(--mute,#aaa)}
  #hc button{all:unset;cursor:pointer;padding:9px 15px;border-radius:999px;font:600 14px system-ui;border:1px solid var(--line,#333)}#hc button.hc-on{background:var(--ink,#eee);color:var(--bg,#111);border-color:var(--ink,#eee)}
  #hc .hc-ok{position:fixed;left:50%;top:40%;transform:translate(-50%,-50%) scale(.6);opacity:0;font:800 22px system-ui;color:#fff;background:#22a35a;padding:12px 20px;border-radius:999px;transition:all .25s;pointer-events:none}#hc .hc-ok.hc-on{opacity:1;transform:translate(-50%,-50%) scale(1)}
  @media (prefers-reduced-motion:reduce){#hc .hc-hole{transition:none;animation:none}}`;
  function run(steps, o = {}) {
    document.getElementById('hc')?.remove();
    const root = document.createElement('div'); root.id = 'hc'; root.innerHTML = `<style>${css}</style><div class=hc-hole></div><div class=hc-bub></div><div class=hc-ok>✓ Nice!</div>`;
    document.body.append(root);
    const hole = root.querySelector('.hc-hole'), bub = root.querySelector('.hc-bub'), ok = root.querySelector('.hc-ok');
    let i = -1, timer = 0, advancing = false;
    const end = fin => { clearInterval(timer); root.remove(); o.onEnd && o.onEnd(fin); };
    const place = s => { const el = s.sel && document.querySelector(s.sel); const r = el && el.getClientRects().length ? el.getBoundingClientRect() : null;
      if (r && r.width) { hole.classList.remove('hc-none'); Object.assign(hole.style, { left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px' }); }
      else hole.classList.add('hc-none');
      const where = s.place || (!r ? 'center' : (r.top + r.height / 2 > innerHeight / 2 ? 'above' : 'below'));
      bub.style.top = bub.style.bottom = '';
      if (where === 'center') bub.style.top = Math.max(20, innerHeight / 2 - bub.offsetHeight / 2) + 'px';
      else if (where === 'top') bub.style.top = 'calc(env(safe-area-inset-top,0px) + 16px)';
      else if (where === 'bottom') bub.style.bottom = 'calc(env(safe-area-inset-bottom,0px) + 16px)';
      else if (where === 'above') bub.style.bottom = Math.max(12, Math.min(innerHeight - bub.offsetHeight - 12, innerHeight - r.top + 16)) + 'px';
      else bub.style.top = Math.max(12, Math.min(innerHeight - bub.offsetHeight - 12, r.bottom + 16)) + 'px'; };
    // Bring the highlighted thing into view once per step (e.g. an item low down in a menu).
    const reveal = s => { try { const el = s.sel && document.querySelector(s.sel); if (!el) return; const r = el.getBoundingClientRect();
      if (r.height && r.height < innerHeight * 0.8 && (r.top < 0 || r.bottom > innerHeight)) el.scrollIntoView({ block: 'center' }); } catch (_) {} };
    const show = k => { clearInterval(timer); advancing = false; i = k; const s = steps[i]; if (!s) return end(true);
      try { s.before && s.before(); } catch (_) {}
      const doIt = !!s.until;
      bub.innerHTML = `<h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>${s.doText ? `<div class=hc-do>👉 ${esc(s.doText)}</div>` : ''}
        <div class=hc-row><button data-a=quit>${i ? 'End tour' : 'Skip tour'}</button><span class=hc-sp></span><span class=hc-n>${i + 1}/${steps.length}</span>
        ${i ? '<button data-a=back>Back</button>' : ''}${doIt ? (s.optional !== false ? '<button data-a=skip>Skip</button>' : '') : `<button class=hc-on data-a=next>${s.last ? 'Start browsing' : 'Next'}</button>`}</div>`;
      bub.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { const a = b.dataset.a; if (a === 'quit') end(false); else if (a === 'back') show(Math.max(0, i - 1)); else show(i + 1); });
      if (s.extra) s.extra(bub);
      hole.classList.toggle('hc-pulse', doIt);
      reveal(s); place(s); requestAnimationFrame(() => place(s)); setTimeout(() => { reveal(s); place(s); }, 350);
      o.onStep && o.onStep(i);
      // Re-place while things move (sheets sliding in) and watch for the action to be done.
      timer = setInterval(() => { place(s); if (doIt && !advancing) { let d = false; try { d = s.until(); } catch (_) {}
        if (d) { advancing = true; ok.classList.add('hc-on'); setTimeout(() => { ok.classList.remove('hc-on'); show(i + 1); }, 750); } } }, 250); };
    addEventListener('resize', () => i >= 0 && steps[i] && place(steps[i]));
    show(0);
    return { end: () => end(false) };
  }
  return { run };
})();
