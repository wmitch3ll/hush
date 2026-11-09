// Hush PDF viewer: opens PDFs inside Hush (pdf.js, Mozilla, Apache-2.0, runs locally).
// HXPDF.open(el, { data: ArrayBuffer, name, close(), save?(), summarize?(text), toast? })
// Continuous scroll, pinch / Ctrl+wheel zoom, selectable text, search, dark pages, remembers where you stopped.
(function (G) {
  const CSS = `.pv{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg,#f5f5f4);color:var(--ink,#161616);font:13px system-ui,sans-serif;user-select:none;-webkit-user-select:none}
.pv *{box-sizing:border-box}.pv-bar{display:flex;gap:4px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--line,#e4e4e2);background:var(--card,#fff);flex:none;overflow-x:auto;scrollbar-width:none}
.pv-bar::-webkit-scrollbar{display:none}.pv-t{font:600 14px system-ui;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:60px;padding:0 6px}
.pv button{all:unset;cursor:pointer;padding:7px 11px;border-radius:99px;font:600 13px system-ui;white-space:nowrap;flex:none}.pv button:hover{background:color-mix(in srgb,var(--ink,#161616) 10%,transparent)}.pv button.on{background:var(--ink,#161616);color:var(--bg,#f5f5f4)}
.pv-pg{font:600 13px system-ui;min-width:64px;text-align:center;font-variant-numeric:tabular-nums;color:var(--mute,#8b8b88)}
.pv-sc{flex:1;min-height:0;overflow:auto;background:color-mix(in srgb,var(--ink,#161616) 8%,var(--bg,#f5f5f4));padding:14px 0 90px;touch-action:pan-x pan-y;-webkit-overflow-scrolling:touch}
.pv-p{position:relative;margin:0 auto 12px;background:#fff;box-shadow:0 2px 14px #0002;border-radius:3px;overflow:hidden}.pv-p canvas{display:block;width:100%;height:100%}
.pv.dark .pv-p canvas{filter:invert(.92) hue-rotate(180deg)}.pv.dark .pv-p{background:#111}
.pv-tl{position:absolute;inset:0;overflow:hidden;line-height:1;opacity:1;user-select:text;-webkit-user-select:text}.pv-tl span{position:absolute;color:transparent;white-space:pre;cursor:text;transform-origin:0 0}
.pv-tl span::selection{background:#3b82f666}.pv-tl mark{background:#facc1566;color:transparent;border-radius:2px}.pv-tl mark.cur{background:#f9731699}
.pv-find{display:none;gap:6px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--line,#e4e4e2);background:var(--card,#fff)}.pv-find.on{display:flex}
.pv-find input{flex:1;min-width:0;padding:8px 12px;border-radius:99px;border:1px solid var(--line,#e4e4e2);background:var(--bg,#f5f5f4);color:inherit;font:14px system-ui;outline:none;user-select:text}
.pv-msg{position:absolute;inset:0;display:grid;place-content:center;gap:10px;text-align:center;color:var(--mute,#8b8b88);padding:24px;pointer-events:none}.pv-msg b{color:var(--ink,#161616);font:600 16px system-ui}
.pv-ld{position:absolute;left:0;top:0;height:3px;background:var(--ink,#161616);width:0;transition:width .2s;z-index:3}`;
  const BASE = (document.currentScript && document.currentScript.src || location.href).replace(/[^/]*$/, '');
  let lib = null;
  const load = async () => { if (lib) return lib; lib = await import(BASE + 'vendor/pdfjs/pdf.mjs'); lib.GlobalWorkerOptions.workerSrc = BASE + 'vendor/pdfjs/pdf.worker.mjs'; return lib; };
  const key = (name, n) => 'hush.pdf.' + name + ':' + n;

  async function open(el, o) {
    o = o || {}; if (!document.getElementById('pv-css')) { const s = document.createElement('style'); s.id = 'pv-css'; s.textContent = CSS; document.head.append(s); }
    const root = document.createElement('div'); root.className = 'pv';
    root.innerHTML = `<div class=pv-ld></div><div class=pv-bar><button data-a=close>‹ Close</button><div class=pv-t></div><button data-a=prev aria-label="Previous page">▲</button><span class=pv-pg>–</span><button data-a=next aria-label="Next page">▼</button>
      <button data-a=out aria-label="Zoom out">−</button><button data-a=fit title="Fit to width">Fit</button><button data-a=in aria-label="Zoom in">＋</button><button data-a=find>Search</button><button data-a=dark title="Dark pages">Dark</button>${o.summarize ? '<button data-a=sum>Summary</button>' : ''}${o.save ? '<button data-a=save>Save</button>' : ''}</div>
      <div class=pv-find><input type=search placeholder="Find in this document" autocapitalize=none><button data-a=fprev>↑</button><button data-a=fnext>↓</button><span class=pv-pg id=fc></span><button data-a=fx>✕</button></div>
      <div class=pv-sc></div><div class=pv-msg><b>Opening…</b></div>`;
    el.replaceChildren(root); const $ = s => root.querySelector(s), sc = $('.pv-sc'), msg = $('.pv-msg'); root.querySelector('.pv-t').textContent = o.name || 'Document';
    const toast = m => o.toast && o.toast(m);
    let doc; try { const L = await load(); doc = await L.getDocument({ data: o.data, isEvalSupported: false, enableXfa: false, useSystemFonts: true }).promise; }
    catch (e) { const pw = e && e.name === 'PasswordException'; msg.innerHTML = `<b>${pw ? 'This PDF is password-protected' : 'Couldn’t open this PDF'}</b><span>${pw ? 'Password-protected files aren’t supported yet.' : 'The file may be damaged.'}</span>`; msg.style.pointerEvents = 'auto'; root.querySelector('[data-a=close]').onclick = () => o.close && o.close(); return { close() {} }; }
    msg.remove();
    const N = doc.numPages, pages = [], KEY = key(o.name || 'doc', N), dpr = Math.min(2.5, G.devicePixelRatio || 1);
    let zoom = 0, fitW = 1, dark = false; try { dark = localStorage.getItem('hush.pdf.dark') === '1'; } catch {} root.classList.toggle('dark', dark); $('[data-a=dark]').classList.toggle('on', dark);
    const first = await doc.getPage(1), base = first.getViewport({ scale: 1 });
    const widthFit = () => Math.max(0.3, (sc.clientWidth - 24) / base.width);
    const layout = () => { const z = zoom || widthFit(); fitW = widthFit(); for (const p of pages) { const w = Math.round(p.w0 * z), h = Math.round(p.h0 * z); p.el.style.width = w + 'px'; p.el.style.height = h + 'px'; p.scale = z; p.done = false; p.el.querySelector('canvas')?.remove(); p.el.querySelector('.pv-tl')?.remove(); } visible(); };
    for (let i = 1; i <= N; i++) { const d = document.createElement('div'); d.className = 'pv-p'; d.dataset.n = i; sc.append(d); pages.push({ n: i, el: d, w0: base.width, h0: base.height, done: false, busy: false, scale: 1, page: i === 1 ? first : null }); }
    // Real page sizes (some PDFs mix sizes) arrive lazily; first page sets the layout until then.
    const render = async p => { if (p.done || p.busy) return; p.busy = true; const scale = p.scale;
      try { p.page = p.page || await doc.getPage(p.n); const v1 = p.page.getViewport({ scale: 1 }); if (Math.abs(v1.width - p.w0) > 2 || Math.abs(v1.height - p.h0) > 2) { p.w0 = v1.width; p.h0 = v1.height; p.el.style.width = Math.round(v1.width * scale) + 'px'; p.el.style.height = Math.round(v1.height * scale) + 'px'; }
        const vp = p.page.getViewport({ scale: scale * dpr }), cv = document.createElement('canvas'); cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
        await p.page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; if (p.scale !== scale) { p.busy = false; return; }
        p.el.querySelector('canvas')?.remove(); p.el.prepend(cv);
        const tl = document.createElement('div'); tl.className = 'pv-tl'; p.el.append(tl); const v = p.page.getViewport({ scale });
        const tc = await p.page.getTextContent(); p.text = tc.items.map(i => i.str).join(' ');
        for (const it of tc.items) { if (!it.str || !it.str.trim()) continue; const tx = L_util.transform(v.transform, it.transform), fh = Math.hypot(tx[2], tx[3]), sp = document.createElement('span'); sp.textContent = it.str;
          sp.style.cssText = `left:${tx[4]}px;top:${tx[5] - fh}px;font-size:${fh}px;font-family:sans-serif;` + (it.width ? `width:${it.width * scale}px;` : ''); tl.append(sp); }
        p.done = true; if (find.q) markPage(p); } catch (e) { /* a page that won't draw just stays blank */ } p.busy = false; };
    let L_util; try { L_util = (await load()).Util; } catch {}
    const visible = () => { const t = sc.scrollTop, b = t + sc.clientHeight; for (const p of pages) { const y = p.el.offsetTop, h = p.el.offsetHeight; if (y + h > t - 600 && y < b + 900) render(p); else if (p.done && (y + h < t - 3000 || y > b + 4000)) { p.done = false; p.el.querySelector('canvas')?.remove(); p.el.querySelector('.pv-tl')?.remove(); } } };
    let cur = 1; const where = () => { const mid = sc.scrollTop + sc.clientHeight * 0.35; let c = 1; for (const p of pages) { if (p.el.offsetTop <= mid) c = p.n; else break; } if (c !== cur || !$('.pv-pg').dataset.s) { cur = c; $('.pv-pg').textContent = c + ' / ' + N; $('.pv-pg').dataset.s = 1; try { localStorage.setItem(KEY, String(c)); } catch {} } };
    let raf = 0; sc.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { visible(); where(); }); }, { passive: true });
    const go = n => { n = Math.max(1, Math.min(N, n)); const p = pages[n - 1]; sc.scrollTo({ top: p.el.offsetTop - 8 }); };
    const setZoom = z => { const anchor = sc.scrollTop / Math.max(1, sc.scrollHeight); zoom = Math.max(0.3, Math.min(5, z)); layout(); sc.scrollTop = anchor * sc.scrollHeight; where(); };
    layout(); let last = 1; try { last = +localStorage.getItem(KEY) || 1; } catch {} if (last > 1) setTimeout(() => go(last), 50); where();
    // ---- zoom: Ctrl+wheel, pinch ----
    sc.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); setZoom((zoom || fitW) * (e.deltaY < 0 ? 1.1 : 0.9)); } }, { passive: false });
    let pd = 0, pz = 1; sc.addEventListener('touchstart', e => { if (e.touches.length === 2) { pd = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); pz = zoom || fitW; } }, { passive: true });
    sc.addEventListener('touchmove', e => { if (e.touches.length === 2 && pd) { e.preventDefault(); const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); const z = Math.max(0.3, Math.min(5, pz * d / pd)); sc.style.setProperty('--z', z); zoom = z; clearTimeout(sc._zt); sc._zt = setTimeout(() => setZoom(z), 120); } }, { passive: false });
    sc.addEventListener('touchend', () => { pd = 0; }, { passive: true });
    addEventListener('keydown', function kd(e) { if (!root.isConnected) return removeEventListener('keydown', kd); if (/INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return;
      if (e.key === 'PageDown' || e.key === 'ArrowRight') go(cur + 1); else if (e.key === 'PageUp' || e.key === 'ArrowLeft') go(cur - 1); else if (e.key === 'Home') go(1); else if (e.key === 'End') go(N); else if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); act('find'); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom((zoom || fitW) * 1.15); } else if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); setZoom((zoom || fitW) / 1.15); } });
    // ---- search ----
    const find = { q: '', hits: [], i: -1 }; const bar = $('.pv-find'), fi = bar.querySelector('input');
    const markPage = p => { const tl = p.el.querySelector('.pv-tl'); if (!tl || !find.q) return; const q = find.q.toLowerCase(); tl.querySelectorAll('span').forEach(s => { const t = s.textContent; if (t.toLowerCase().includes(q)) { const re = new RegExp(find.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); s.innerHTML = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(re, m => '<mark>' + m + '</mark>'); } }); };
    const allText = async () => { for (const p of pages) if (p.text == null) { p.page = p.page || await doc.getPage(p.n); const tc = await p.page.getTextContent(); p.text = tc.items.map(i => i.str).join(' '); } };
    const search = async q => { find.q = q.trim(); find.hits = []; find.i = -1; pages.forEach(p => { p.el.querySelectorAll('mark').forEach(m => m.replaceWith(m.textContent)); });
      if (!find.q) { $('#fc').textContent = ''; return; } await allText(); const ql = find.q.toLowerCase(); for (const p of pages) { let k = -1; const t = p.text.toLowerCase(); while ((k = t.indexOf(ql, k + 1)) >= 0) find.hits.push(p.n); }
      pages.forEach(p => { if (p.done) markPage(p); }); $('#fc').textContent = find.hits.length ? '1 / ' + find.hits.length : 'No matches'; if (find.hits.length) { find.i = 0; go(find.hits[0]); } };
    const step = d => { if (!find.hits.length) return; find.i = (find.i + d + find.hits.length) % find.hits.length; $('#fc').textContent = (find.i + 1) + ' / ' + find.hits.length; go(find.hits[find.i]); };
    fi.onkeydown = e => { if (e.key === 'Enter') { if (fi.value.trim() === find.q) step(e.shiftKey ? -1 : 1); else search(fi.value); } if (e.key === 'Escape') act('fx'); };
    // ---- toolbar ----
    const act = a => { if (a === 'close') o.close && o.close(); else if (a === 'prev') go(cur - 1); else if (a === 'next') go(cur + 1); else if (a === 'in') setZoom((zoom || fitW) * 1.25); else if (a === 'out') setZoom((zoom || fitW) / 1.25);
      else if (a === 'fit') { zoom = 0; layout(); where(); } else if (a === 'dark') { dark = !dark; root.classList.toggle('dark', dark); $('[data-a=dark]').classList.toggle('on', dark); try { localStorage.setItem('hush.pdf.dark', dark ? '1' : '0'); } catch {} }
      else if (a === 'find') { bar.classList.add('on'); fi.focus(); fi.select(); } else if (a === 'fx') { bar.classList.remove('on'); search(''); fi.value = ''; } else if (a === 'fnext') step(1); else if (a === 'fprev') step(-1);
      else if (a === 'save') o.save && o.save();
      else if (a === 'sum') { toast('Reading the document…'); allText().then(() => o.summarize((o.name || 'Document') + '\n\n' + pages.map(p => p.text || '').join('\n\n').slice(0, 24000))); } };
    root.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) act(b.dataset.a); });
    new ResizeObserver(() => { if (!zoom) { layout(); where(); } }).observe(sc);
    return { close() { try { doc.destroy(); } catch {} }, go, text: async () => { await allText(); return pages.map(p => p.text || '').join('\n\n'); }, _doc: doc };
  }
  G.HXPDF = { open };
})(window);
