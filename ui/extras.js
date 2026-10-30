// Shared by the desktop (index.html) and Android (mobile.html) UIs:
// custom start page, Boosts, auto-archive, Listen controls and the screenshot markup editor.
// Each UI calls HushX(adapter) once; the adapter hides the platform differences.
//   A = { inv, pref(k), setPref(k,v), toast(msg), open(url), state(), reload(), mobile }
window.HushX = function (A) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } };
  const LS = { get(k, d) { try { const v = localStorage.getItem('hush.' + k); return v == null ? d : JSON.parse(v) } catch { return d } },
               set(k, v) { try { localStorage.setItem('hush.' + k, JSON.stringify(v)) } catch {} } };

  // ---------------------------------------------------------------- start page
  const WALLS = { none: '', dusk: 'linear-gradient(160deg,#2b2440,#c86b5a)', sea: 'linear-gradient(160deg,#0f2a3a,#3f8f9a)', moss: 'linear-gradient(160deg,#1d2a1f,#7d9461)',
                  sand: 'linear-gradient(160deg,#e9dfcf,#b99c7a)', ink: 'linear-gradient(160deg,#0a0a0a,#2a2a2a)', rose: 'linear-gradient(160deg,#f3d9dc,#b9788a)' };
  const css = `
.hx-home{position:relative;min-height:100%;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:40px 16px;background-size:cover;background-position:center}
.hx-home.walled{color:#fff;text-shadow:0 1px 8px #0006}.hx-home.walled .hx-mute{color:#ffffffcc}
.hx-time{display:flex;flex-direction:column;align-items:center;gap:6px}.hx-clock{font:200 60px/1.05 ui-sans-serif,system-ui,"Segoe UI",sans-serif;letter-spacing:-1px;font-variant-numeric:tabular-nums;margin:0}.hx-date{font-size:13px;opacity:.75;margin:0}
.hx-home .wordmark,.hx-home h1.wordmark{font:300 58px/1.1 ui-serif,"Times New Roman",Times,Georgia,serif;letter-spacing:-1.5px;margin:0;padding:0}
.hx-home p,.hx-home .hx-mute{margin:0!important;color:var(--mute);line-height:1.45}.hx-home .stats{font-size:12px;margin:0!important;font-variant-numeric:tabular-nums}.hx-home .stats b{color:var(--ink)}.hx-home.walled .stats b{color:#fff}
.hx-brand{display:flex;flex-direction:column;align-items:center;gap:8px}.hx-home .hint{font-size:11.5px;text-align:center;max-width:520px}
.hx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,96px));justify-content:center;gap:12px;width:min(640px,100%)}
.hx-tile{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 4px;border-radius:14px;cursor:pointer;min-width:0;touch-action:none}
.hx-tile:hover{background:#8881}.hx-tile i{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;font:600 18px system-ui;font-style:normal;background:var(--card);color:var(--ink);border:1px solid var(--line);background-size:60%;background-position:center;background-repeat:no-repeat}
.hx-tile span{font-size:11.5px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hx-tile .hx-x{display:none;position:absolute;top:2px;right:8px;width:20px;height:20px;border-radius:50%;background:var(--ink);color:var(--bg);font-size:11px;align-items:center;justify-content:center;text-shadow:none}
.hx-edit .hx-tile .hx-x{display:flex}.hx-edit .hx-tile{animation:hxw .25s ease-in-out infinite alternate}.hx-tile.hx-drag{opacity:.3}.hx-tile.hx-over{outline:2px dashed var(--acc)}
@keyframes hxw{from{transform:rotate(-1.2deg)}to{transform:rotate(1.2deg)}}@media (prefers-reduced-motion:reduce){.hx-edit .hx-tile{animation:none}}
.hx-row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.hx-b{all:unset;cursor:pointer;padding:6px 12px;border-radius:99px;background:var(--card);color:var(--ink);border:1px solid var(--line);font-size:12px;text-shadow:none}
.hx-notes{width:min(640px,100%);min-height:70px;resize:vertical;border-radius:14px;border:1px solid var(--line);background:color-mix(in srgb,var(--card) 88%,transparent);color:var(--ink);padding:10px 12px;font:13px/1.45 system-ui;text-shadow:none}
.hx-pop{width:min(640px,100%);background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:14px;padding:12px;display:grid;gap:10px;text-shadow:none;font-size:12.5px}
.hx-sw{width:30px;height:30px;border-radius:50%;border:2px solid var(--line);cursor:pointer}.hx-sw.on{border-color:var(--acc)}
.hx-add{display:flex;gap:6px;width:min(640px,100%)}.hx-add input,.hx-in{flex:1;min-width:0;padding:8px 10px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:13px system-ui}
.hx-list{display:grid;gap:6px}.hx-item{display:flex;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card)}
.hx-item div{flex:1;min-width:0}.hx-item b{display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hx-item small{color:var(--mute)}
.hx-seg{display:flex;gap:4px;flex-wrap:wrap}.hx-seg .hx-b.on{background:var(--ink);color:var(--bg)}
.hx-lbl{color:var(--mute);font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;margin-top:6px}
.hx-shot{position:fixed;inset:0;z-index:50;background:#000d;display:flex;flex-direction:column}
.hx-shot .hx-tools{display:flex;gap:6px;align-items:center;padding:10px;flex-wrap:wrap;background:#111;color:#eee}
.hx-shot .hx-tools .hx-b{background:#222;color:#eee;border-color:#333}.hx-shot .hx-tools .hx-b.on{background:#eee;color:#111}
.hx-shot .hx-wrap{flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:12px}
.hx-shot canvas{max-width:100%;height:auto;touch-action:none;box-shadow:0 8px 40px #000;cursor:crosshair;background:#fff}
.hx-col{width:22px;height:22px;border-radius:50%;border:2px solid #555;cursor:pointer}.hx-col.on{border-color:#fff}`;
  if (!document.getElementById('hx-css')) { const s = document.createElement('style'); s.id = 'hx-css'; s.textContent = css; document.head.append(s); }

  let editing = false, customizing = false, clockT;
  let wallStyle = function () {
    const w = A.pref('sp_bg') || 'none';
    if (w === 'image') { const img = LS.get('wall', ''); return img ? `url("${img}")` : ''; }
    if (/^#[0-9a-f]{6}$/i.test(w)) return w;
    return WALLS[w] || '';
  }
  function home(el, opts = {}) {
    const st = A.state(), bms = (st.bookmarks || []).filter(b => b.folder !== 'reading'), bg = wallStyle(), priv = !!opts.priv;
    const clock = A.pref('sp_clock') !== 'off', notes = A.pref('sp_notes') === 'on' && !priv;
    el.innerHTML = `<div class="hx-home ${bg && !priv ? 'walled' : ''}" style="${bg && !priv ? 'background:' + esc(bg) + ';background-size:cover;background-position:center' : ''}">
      ${clock ? '<div class=hx-time><div class=hx-clock></div><div class=hx-date></div></div>' : ''}
      <div class=hx-brand>${opts.top || ''}</div>
      <div class="hx-grid ${editing ? 'hx-edit' : ''}">${bms.slice(0, 24).map(b => { const ic = opts.icon && opts.icon(b.url);
        return `<div class=hx-tile draggable=${editing} data-u="${esc(b.url)}" title="${esc(b.title || host(b.url))}"><i ${ic ? `style="background-image:url('${esc(ic)}');color:transparent"` : ''}>${esc((host(b.url) || '?')[0].toUpperCase())}</i><span>${esc(b.title || host(b.url))}</span><b class=hx-x data-rm="${esc(b.url)}">✕</b></div>` }).join('')}</div>
      ${editing ? `<form class=hx-add><input name=u placeholder="Add a site — example.com" autocomplete=off><button class=hx-b>Add</button></form>` : ''}
      ${notes ? `<textarea class=hx-notes placeholder="Quick notes — saved on this device">${esc(LS.get('notes', ''))}</textarea>` : ''}
      ${customizing ? customizer() : ''}
      <div class=hx-row>${priv ? '' : `<button class=hx-b data-a=edit>${editing ? 'Done' : 'Edit shortcuts'}</button><button class=hx-b data-a=custom>${customizing ? 'Close' : 'Customize'}</button>`}</div>
      ${opts.bottom || ''}</div>`;
    const tick = () => { const c = el.querySelector('.hx-clock'); if (!c) return clearInterval(clockT); const d = new Date();
      c.textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); el.querySelector('.hx-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }); };
    clearInterval(clockT); if (clock) { tick(); clockT = setInterval(tick, 15000); }
    const redraw = () => home(el, opts);
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { if (b.dataset.a === 'edit') editing = !editing; else customizing = !customizing; redraw(); });
    const n = el.querySelector('.hx-notes'); if (n) n.oninput = () => LS.set('notes', n.value.slice(0, 20000));
    const f = el.querySelector('.hx-add'); if (f) f.onsubmit = async e => { e.preventDefault(); let v = f.u.value.trim(); if (!v) return;
      if (!/^https?:\/\//.test(v)) v = 'https://' + v; if (!host(v)) return A.toast('That isn’t a web address');
      try { await A.inv('bookmark_add', { title: host(v), url: v }); await A.reload(); redraw(); } catch (err) { A.toast(String(err)); } };
    el.querySelectorAll('[data-rm]').forEach(x => x.onclick = async e => { e.stopPropagation(); await A.inv('bookmark_remove', { url: x.dataset.rm }); await A.reload(); redraw(); });
    // Tap opens; in edit mode drag to rearrange (mouse: HTML drag; touch: pointer drag over tiles).
    const tiles = [...el.querySelectorAll('.hx-tile')];
    const order = async (from, to) => { const urls = bms.map(b => b.url), i = urls.indexOf(from), j = urls.indexOf(to); if (i < 0 || j < 0 || i === j) return;
      urls.splice(j, 0, urls.splice(i, 1)[0]); await A.inv('bookmarks_reorder', { urls }); await A.reload(); redraw(); };
    tiles.forEach(t => {
      t.onclick = () => { if (!editing) A.open(t.dataset.u); };
      if (!editing) { if (opts.long) { let lt; t.addEventListener('pointerdown', () => lt = setTimeout(() => { editing = true; redraw(); }, 550)); ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => t.addEventListener(ev, () => clearTimeout(lt))); } return; }
      t.ondragstart = e => { e.dataTransfer.setData('text/hx', t.dataset.u); t.classList.add('hx-drag'); };
      t.ondragend = () => t.classList.remove('hx-drag');
      t.ondragover = e => { e.preventDefault(); t.classList.add('hx-over'); }; t.ondragleave = () => t.classList.remove('hx-over');
      t.ondrop = e => { e.preventDefault(); t.classList.remove('hx-over'); order(e.dataTransfer.getData('text/hx'), t.dataset.u); };
      t.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' || e.target.closest('[data-rm]')) return; t.classList.add('hx-drag'); t.setPointerCapture(e.pointerId);
        let over = null; t.onpointermove = m => { const o = document.elementFromPoint(m.clientX, m.clientY)?.closest('.hx-tile'); tiles.forEach(x => x.classList.toggle('hx-over', x === o && x !== t)); over = o; };
        t.onpointerup = () => { t.onpointermove = t.onpointerup = null; t.classList.remove('hx-drag'); tiles.forEach(x => x.classList.remove('hx-over')); if (over && over !== t) order(t.dataset.u, over.dataset.u); }; });
    });
    if (customizing) wireCustomizer(el, redraw);
    if (opts.after) opts.after();
  }
  function customizer() {
    const w = A.pref('sp_bg') || 'none';
    return `<div class=hx-pop><div class=hx-lbl>Background</div><div class=hx-row style="justify-content:flex-start">
      ${Object.entries(WALLS).map(([k, v]) => `<div class="hx-sw ${w === k ? 'on' : ''}" data-w="${k}" title="${k}" style="background:${v || 'var(--bg)'}"></div>`).join('')}
      <label class="hx-sw ${/^#/.test(w) ? 'on' : ''}" title="Pick a color" style="background:${/^#/.test(w) ? w : 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)'};position:relative"><input type=color data-c style="opacity:0;position:absolute;inset:0;width:100%;height:100%"></label>
      <label class=hx-b>Your photo…<input type=file accept="image/*" data-img hidden></label></div>
      <div class=hx-lbl>Show</div><div class=hx-seg>
      <button class="hx-b ${A.pref('sp_clock') !== 'off' ? 'on' : ''}" data-t=sp_clock>Clock</button><button class="hx-b ${A.pref('sp_notes') === 'on' ? 'on' : ''}" data-t=sp_notes>Quick notes</button>
      <button class="hx-b ${A.pref('sp_stats') !== 'off' ? 'on' : ''}" data-t=sp_stats>Blocked count</button></div></div>`;
  }
  function wireCustomizer(el, redraw) {
    el.querySelectorAll('[data-w]').forEach(s => s.onclick = async () => { await A.setPref('sp_bg', s.dataset.w); redraw(); });
    const c = el.querySelector('[data-c]'); if (c) c.onchange = async () => { await A.setPref('sp_bg', c.value); redraw(); };
    el.querySelectorAll('[data-t]').forEach(b => b.onclick = async () => { const k = b.dataset.t, on = k === 'sp_notes' ? A.pref(k) === 'on' : A.pref(k) !== 'off';
      await A.setPref(k, on ? 'off' : 'on'); redraw(); });
    const f = el.querySelector('[data-img]'); if (f) f.onchange = () => { const file = f.files[0]; if (!file) return;
      const img = new Image(); img.onload = async () => { const s = Math.min(1, 1920 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
        cv.width = img.width * s; cv.height = img.height * s; cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        LS.set('wall', cv.toDataURL('image/jpeg', 0.82)); URL.revokeObjectURL(img.src); await A.setPref('sp_bg', 'image'); redraw(); };
      img.src = URL.createObjectURL(file); };
  }

  // ---------------------------------------------------------------- Boosts
  const FONTS = [['', 'Site font'], ['serif', 'Serif'], ['sans', 'Sans'], ['mono', 'Mono'], ['readable', 'Easy-read']];
  const TONES = [['', 'Site colors'], ['sepia', 'Sepia'], ['contrast', 'High contrast'], ['gray', 'Grayscale']];
  function boost(el, h, done) {
    const st = A.state(), b = Object.assign({ font: '', scale: 100, tone: '', hide_images: false, css: '' }, (st.site_boost || {})[h] || {});
    const zaps = (st.filters || []).filter(f => f.startsWith(h + '##') || f.startsWith('www.' + h + '##'));
    el.innerHTML = `<div class=hx-lbl>Font</div><div class=hx-seg>${FONTS.map(([v, l]) => `<button class="hx-b ${b.font === v ? 'on' : ''}" data-font="${v}">${l}</button>`).join('')}</div>
      <div class=hx-lbl>Text size · <span data-sv>${b.scale}%</span></div><input type=range min=70 max=200 step=10 value="${b.scale}" data-scale style="width:100%">
      <div class=hx-lbl>Colors</div><div class=hx-seg>${TONES.map(([v, l]) => `<button class="hx-b ${b.tone === v ? 'on' : ''}" data-tone="${v}">${l}</button>`).join('')}</div>
      <div class=hx-lbl>Images</div><div class=hx-seg><button class="hx-b ${b.hide_images ? 'on' : ''}" data-img>Hide images</button></div>
      <div class=hx-lbl>Zap elements</div><div class=hx-seg><button class=hx-b data-zap>Pick something to remove…</button></div>
      <div class=hx-list style="margin-top:6px">${zaps.map(z => `<div class=hx-item><div><b>${esc(z.split('##')[1])}</b><small>hidden on ${esc(h)}</small></div><button class=hx-b data-unzap="${esc(z)}">Bring back</button></div>`).join('') || '<small style="color:var(--mute)">Nothing zapped on this site yet.</small>'}</div>
      <div class=hx-lbl>Your own CSS (advanced)</div><textarea class=hx-notes data-css placeholder="e.g. .sidebar{display:none}" style="width:100%;font-family:ui-monospace,monospace">${esc(b.css)}</textarea>
      <div class=hx-row style="justify-content:flex-start;margin-top:8px"><button class=hx-b data-save>Apply</button><button class=hx-b data-reset>Reset this site</button></div>
      <small style="color:var(--mute);display:block;margin-top:8px">Boosts are saved for ${esc(h)} and applied every time it loads.</small>`;
    const save = async (again = true) => { b.scale = +b.scale; const empty = !b.font && b.scale === 100 && !b.tone && !b.hide_images && !b.css.trim();
      try { await A.inv('boost_set', { host: h, boost: empty ? null : b }); await A.reload(); if (done) done(); if (again) boost(el, h, done); } catch (e) { A.toast(String(e)); } };
    el.querySelectorAll('[data-font]').forEach(x => x.onclick = () => { b.font = x.dataset.font; save(); });
    el.querySelectorAll('[data-tone]').forEach(x => x.onclick = () => { b.tone = x.dataset.tone; save(); });
    const r = el.querySelector('[data-scale]'); r.oninput = () => el.querySelector('[data-sv]').textContent = r.value + '%'; r.onchange = () => { b.scale = +r.value; save(); };
    el.querySelector('[data-img]').onclick = () => { b.hide_images = !b.hide_images; save(); };
    el.querySelector('[data-save]').onclick = () => { b.css = el.querySelector('[data-css]').value.slice(0, 4000); save(); A.toast('Boost applied'); };
    el.querySelector('[data-reset]').onclick = async () => { Object.assign(b, { font: '', scale: 100, tone: '', hide_images: false, css: '' }); await save(); A.toast('Site reset'); };
    el.querySelector('[data-zap]').onclick = () => A.zap();
    el.querySelectorAll('[data-unzap]').forEach(x => x.onclick = async () => { await A.inv('remove_custom_filter', { filter: x.dataset.unzap }); await A.reload(); boost(el, h, done); A.toast('Restored — reload to see it'); });
  }

  // ---------------------------------------------------------------- auto-archive
  const archived = () => LS.get('archive', []);
  function archiveSweep(tabs, cur, close) {
    const hrs = +(A.pref('archive') || 0); if (!hrs) return;
    const cutoff = Date.now() - hrs * 3600e3, list = archived();
    for (const t of tabs) {
      if (t.id === cur || t.priv || t.audio || t.pinned || !t.url || !/^https?:/.test(t.url)) continue;
      if ((t.last || t.opened || Date.now()) > cutoff) continue;
      list.unshift({ url: t.url, title: t.title || host(t.url), ws: t.ws, at: Date.now() }); close(t.id);
    }
    LS.set('archive', list.slice(0, 500));
  }
  function archivePanel(el, restore) {
    const draw = q => { const all = archived(), ql = (q || '').toLowerCase(), list = all.filter(a => !ql || (a.title + ' ' + a.url).toLowerCase().includes(ql));
      el.querySelector('.hx-list').innerHTML = list.slice(0, 200).map(a => `<div class=hx-item><div><b>${esc(a.title)}</b><small>${esc(host(a.url))} · archived ${esc(ago(a.at))}</small></div>
        <button class=hx-b data-open="${esc(a.url)}">Restore</button><button class=hx-b data-del="${esc(a.url)}" aria-label="Remove">✕</button></div>`).join('') || '<small style="color:var(--mute)">Nothing archived.</small>';
      el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { LS.set('archive', archived().filter(a => a.url !== b.dataset.open)); restore(b.dataset.open); });
      el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { LS.set('archive', archived().filter(a => a.url !== b.dataset.del)); draw(el.querySelector('.hx-in').value); }); };
    const v = A.pref('archive') || '0';
    el.innerHTML = `<div class=hx-lbl>Archive tabs you haven’t opened in</div><div class=hx-seg>${[['0', 'Never'], ['12', '12 hours'], ['24', '1 day'], ['72', '3 days'], ['168', '1 week']].map(([k, l]) => `<button class="hx-b ${v === k ? 'on' : ''}" data-ar="${k}">${l}</button>`).join('')}</div>
      <p style="color:var(--mute);font-size:12px;margin:8px 0">Archived tabs close quietly and wait here. Private tabs, playing tabs and the tab you’re on are never archived.</p>
      <input class=hx-in placeholder="Search archived tabs" style="width:100%;margin-bottom:8px"><div class=hx-list></div>
      <div class=hx-row style="justify-content:flex-start;margin-top:8px"><button class=hx-b data-clear>Clear archive</button></div>`;
    el.querySelectorAll('[data-ar]').forEach(b => b.onclick = async () => { await A.setPref('archive', b.dataset.ar); archivePanel(el, restore); });
    el.querySelector('.hx-in').oninput = e => draw(e.target.value);
    el.querySelector('[data-clear]').onclick = () => { LS.set('archive', []); draw(''); };
    draw('');
  }
  const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

  // ---------------------------------------------------------------- screenshot markup
  function markup(dataUrl, { save, name = 'Hush screenshot' }) {
    const box = document.createElement('div'); box.className = 'hx-shot';
    const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#111111'];
    box.innerHTML = `<div class=hx-tools>${[['pen', 'Pen'], ['mark', 'Highlighter'], ['arrow', 'Arrow'], ['box', 'Box'], ['blur', 'Hide']].map(([k, l]) => `<button class="hx-b ${k === 'pen' ? 'on' : ''}" data-tool=${k}>${l}</button>`).join('')}
      ${COLORS.map((c, i) => `<span class="hx-col ${i ? '' : 'on'}" data-col="${c}" style="background:${c}"></span>`).join('')}
      <span style="flex:1"></span><button class=hx-b data-undo>Undo</button><button class=hx-b data-copy>Copy</button>${navigator.canShare ? '<button class=hx-b data-share>Share</button>' : ''}<button class=hx-b data-save>Save</button><button class=hx-b data-close>✕</button></div>
      <div class=hx-wrap><canvas></canvas></div>`;
    document.body.append(box);
    const cv = box.querySelector('canvas'), g = cv.getContext('2d'), img = new Image(), hist = [];
    let tool = 'pen', col = COLORS[0], down = null, snap = null;
    img.onload = () => { cv.width = img.width; cv.height = img.height; g.drawImage(img, 0, 0); };
    img.src = dataUrl;
    const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    const lw = () => Math.max(3, cv.width / 300);
    cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); hist.push(g.getImageData(0, 0, cv.width, cv.height)); if (hist.length > 30) hist.shift();
      down = pt(e); snap = hist.at(-1); g.beginPath(); g.moveTo(...down); };
    cv.onpointermove = e => { if (!down) return; const p = pt(e);
      g.lineCap = g.lineJoin = 'round'; g.strokeStyle = col; g.fillStyle = col;
      if (tool === 'pen' || tool === 'mark') { g.globalAlpha = tool === 'mark' ? 0.35 : 1; g.lineWidth = tool === 'mark' ? lw() * 5 : lw(); g.lineTo(...p); g.stroke(); g.globalAlpha = 1; if (tool === 'mark') { g.putImageData(snap, 0, 0); g.globalAlpha = .35; g.stroke(); g.globalAlpha = 1; } return; }
      g.putImageData(snap, 0, 0); const [x0, y0] = down, [x1, y1] = p; g.lineWidth = lw();
      if (tool === 'box') g.strokeRect(x0, y0, x1 - x0, y1 - y0);
      else if (tool === 'blur') { g.fillStyle = '#111'; g.fillRect(x0, y0, x1 - x0, y1 - y0); }
      else { const a = Math.atan2(y1 - y0, x1 - x0), L = lw() * 5; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
        g.moveTo(x1, y1); g.lineTo(x1 - L * Math.cos(a - .5), y1 - L * Math.sin(a - .5)); g.moveTo(x1, y1); g.lineTo(x1 - L * Math.cos(a + .5), y1 - L * Math.sin(a + .5)); g.stroke(); } };
    cv.onpointerup = cv.onpointercancel = () => { down = null; };
    box.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => { tool = b.dataset.tool; box.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('on', x === b)); });
    box.querySelectorAll('[data-col]').forEach(b => b.onclick = () => { col = b.dataset.col; box.querySelectorAll('[data-col]').forEach(x => x.classList.toggle('on', x === b)); });
    box.querySelector('[data-undo]').onclick = () => { const h = hist.pop(); if (h) g.putImageData(h, 0, 0); };
    const close = () => { box.remove(); removeEventListener('keydown', key); };
    const key = e => { if (e.key === 'Escape') close(); else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') box.querySelector('[data-undo]').click(); };
    addEventListener('keydown', key);
    box.querySelector('[data-close]').onclick = close;
    const blob = () => new Promise(r => cv.toBlob(r, 'image/png'));
    box.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': await blob() })]); A.toast('Copied'); } catch (e) { A.toast('Copy isn’t available here — use Save'); } };
    const sh = box.querySelector('[data-share]'); if (sh) sh.onclick = async () => { try { const f = new File([await blob()], name + '.png', { type: 'image/png' }); await navigator.share({ files: [f], title: name }); } catch (e) {} };
    box.querySelector('[data-save]').onclick = async () => { try { const where = await save(cv.toDataURL('image/png')); A.toast(where ? 'Saved to ' + where : 'Saved'); close(); } catch (e) { A.toast(String(e)); } };
    return close;
  }

  // ---------------------------------------------------------------- actions, gestures, quick wheel
  // A.act(id) runs an action on the current platform; ids are shared with tools.js (the in-page wheel).
  const ACTIONS = { none: 'Do nothing', back: 'Back', forward: 'Forward', reload: 'Reload', newtab: 'New tab', closetab: 'Close tab', reopen: 'Reopen closed tab',
    nexttab: 'Next tab', prevtab: 'Previous tab', top: 'Scroll to top', bottom: 'Scroll to bottom', find: 'Find in page', reader: 'Reader view', listen: 'Listen to page',
    screenshot: 'Screenshot', tor: A.mobile ? 'Tor mode on/off' : 'Open in Tor tab', newid: 'New Tor identity', bookmark: 'Bookmark page', copylink: 'Copy link', dark: 'Dark mode on/off',
    alltabs: 'All tabs', home: 'Start page', private: 'New private tab', mute: 'Mute tab', boosts: 'Boosts', destruct: 'Self-destruct tab…' };
  const SLOTS = A.mobile
    ? [['TL', 'Two fingers ←', 'nexttab'], ['TR', 'Two fingers →', 'prevtab'], ['TD', 'Two fingers ↓', 'reload'], ['TU', 'Two fingers ↑', 'alltabs']]
    : [['L', 'Right-drag ←', 'back'], ['R', 'Right-drag →', 'forward'], ['D', 'Right-drag ↓', 'closetab'], ['U', 'Right-drag ↑', 'newtab'],
       ['DR', 'Right-drag ↓ then →  (L shape)', 'reopen'], ['UD', 'Right-drag ↑ then ↓', 'reload'], ['RL', 'Right-drag → then ←', 'top'], ['LR', 'Right-drag ← then →', 'bottom'],
       ['TL', 'Touchscreen: two fingers ←', 'back'], ['TR', 'Touchscreen: two fingers →', 'forward']];
  const slotPref = g => 'g_' + g.toLowerCase();
  function gesture(ev) {
    const id = ev.action || (() => { const sl = SLOTS.find(x => x[0] === ev.g); return sl ? (A.pref(slotPref(sl[0])) || sl[2]) : null; })();
    if (id && id !== 'none' && ACTIONS[id]) { A.toast(ACTIONS[id]); A.act(id); }
  }
  const WHEEL_DEF = 'back,forward,reload,newtab,closetab,screenshot';
  function gesturePanel(el) {
    const wheel = (A.pref('wheel') || WHEEL_DEF).split(',').filter(Boolean), opts = sel => Object.entries(ACTIONS).map(([k, l]) => `<option value=${k} ${k === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
    el.innerHTML = `<div class=hx-lbl>Gestures</div><div class=hx-seg><button class="hx-b ${A.pref('gestures') !== 'off' ? 'on' : ''}" data-gon>${A.pref('gestures') !== 'off' ? 'On' : 'Off'}</button></div>
      <p style="color:var(--mute);font-size:12px;margin:6px 0">${A.mobile ? 'Swipe on a page with two fingers. Two-finger touch-and-hold opens your quick wheel.' : 'Hold the right mouse button on a page and draw. A quick right-click still opens the normal menu; right-click and hold opens your quick wheel.'}</p>
      <div class=hx-list>${SLOTS.map(([g, l, d]) => `<div class=hx-item><div><b>${esc(l)}</b></div><select class=hx-in style="flex:none;width:170px" data-slot="${g}">${opts(A.pref(slotPref(g)) || d)}</select></div>`).join('')}</div>
      <div class=hx-lbl>Quick wheel · up to 8, in order clockwise from the top</div>
      <div class=hx-list>${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<div class=hx-item><div><b>${i + 1}</b></div><select class=hx-in style="flex:none;width:170px" data-w=${i}>${opts(wheel[i] || 'none')}</select></div>`).join('')}</div>
      <small style="color:var(--mute);display:block;margin-top:8px">Changes apply to pages you open or reload after this.</small>`;
    el.querySelector('[data-gon]').onclick = async () => { await A.setPref('gestures', A.pref('gestures') !== 'off' ? 'off' : 'on'); gesturePanel(el); };
    el.querySelectorAll('[data-slot]').forEach(x => x.onchange = () => A.setPref(slotPref(x.dataset.slot), x.value));
    el.querySelectorAll('[data-w]').forEach(x => x.onchange = () => A.setPref('wheel', [...el.querySelectorAll('[data-w]')].map(y => y.value).filter(v => v !== 'none').join(',')));
  }

  // ---------------------------------------------------------------- looks (themes)
  const LOOKS = {
    default: null,
    midnight: { bg: '#0b1020', card: '#131a2e', line: '#222b45', ink: '#e7ebf7', mute: '#8590b0', acc: '#7aa2ff', dark: true, wall: 'linear-gradient(160deg,#0b1020,#24305a)' },
    paper: { bg: '#f4efe6', card: '#fbf8f2', line: '#e3dacb', ink: '#2b2620', mute: '#8b8172', acc: '#9a4f2c', dark: false, wall: 'linear-gradient(160deg,#f4efe6,#e2d3b8)' },
    neon: { bg: '#0a0a0f', card: '#14141d', line: '#262638', ink: '#f2f2ff', mute: '#8a8aa8', acc: '#ff3df2', dark: true, wall: 'linear-gradient(160deg,#120022,#002a3a)' },
    forest: { bg: '#101612', card: '#18211b', line: '#26332a', ink: '#e4efe6', mute: '#83998a', acc: '#6fcf8c', dark: true, wall: 'linear-gradient(160deg,#0f1a12,#3a5a3f)' },
    ocean: { bg: '#eef5f8', card: '#ffffff', line: '#d5e5ec', ink: '#0f2a36', mute: '#6b8794', acc: '#0b84a5', dark: false, wall: 'linear-gradient(160deg,#dff0f6,#7fbcd2)' } };
  function applyLook() {
    const L = LOOKS[A.pref('look')] || null, r = document.documentElement.style;
    for (const k of ['bg', 'card', 'line', 'ink', 'mute', 'acc']) { if (L) r.setProperty('--' + k, L[k]); else r.removeProperty('--' + k); }
    if (L) { r.setProperty('--glow', L.acc + '33'); r.colorScheme = L.dark ? 'dark' : 'light'; document.documentElement.dataset.theme = L.dark ? 'dark' : 'light'; }
    else { r.removeProperty('--glow'); r.colorScheme = ''; }
    return !!L;
  }
  function lookPicker(el, after) {
    const cur = A.pref('look') || 'default';
    el.innerHTML = `<div class=hx-row style="justify-content:flex-start">${Object.entries(LOOKS).map(([k, L]) => `<button class="hx-b ${cur === k ? 'on' : ''}" data-look=${k} style="${L ? `background:${L.bg};color:${L.ink};border-color:${L.acc}` : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>`;
    el.querySelectorAll('[data-look]').forEach(b => b.onclick = async () => { await A.setPref('look', b.dataset.look);
      const L = LOOKS[b.dataset.look]; if (L && (!A.pref('sp_bg') || A.pref('sp_bg') === 'none' || A.pref('sp_bg').startsWith('look:'))) await A.setPref('sp_bg', 'look:' + b.dataset.look);
      if (!L && (A.pref('sp_bg') || '').startsWith('look:')) await A.setPref('sp_bg', 'none');
      applyLook(); lookPicker(el, after); after && after(); });
  }
  const _wall = wallStyle;
  wallStyle = () => { const w = A.pref('sp_bg') || ''; if (w.startsWith('look:')) { const L = LOOKS[w.slice(5)]; return L ? L.wall : ''; } return _wall(); };

  // ---------------------------------------------------------------- self-destruct tabs
  const destructLabel = t => { if (!t.destruct) return ''; const m = Math.max(0, Math.ceil((t.destruct - Date.now()) / 60000)); return m >= 60 ? Math.round(m / 60) + ' h' : m + ' min'; };
  function destructSweep(tabs, close) { const now = Date.now(); for (const t of tabs) if (t.destruct && t.destruct <= now) { t.destruct = 0; close(t.id); } }
  const DESTRUCT = [['5 minutes', 5], ['15 minutes', 15], ['1 hour', 60], ['Never', 0]];

  // ---------------------------------------------------------------- change watch
  const watches = () => LS.get('watch', []);
  function watchAdd(w) { const list = watches().filter(x => !(x.url === w.url && x.sel === w.sel)); list.unshift({ ...w, last: w.text, at: Date.now(), changed: false }); LS.set('watch', list.slice(0, 40)); }
  let watching = false;
  async function watchSweep(force) {
    if (watching) return; watching = true; const list = watches(); let n = 0;
    for (const w of list) { if (!force && Date.now() - (w.checked || 0) < 30 * 60e3) continue;
      try { const now = await A.inv('watch_check', { url: w.url, sel: w.sel }); w.checked = Date.now();
        if (now == null) w.missing = true;
        else { w.missing = false; if (now !== w.last) { w.prev = w.last; w.last = now; w.changed = true; w.at = Date.now(); n++; A.toast('Changed on ' + host(w.url) + ': ' + now.slice(0, 60)); } } } catch (e) { w.err = String(e); } }
    LS.set('watch', list); watching = false; return n; }
  const watchCount = () => watches().filter(w => w.changed).length;
  function watchPanel(el, open) {
    const draw = () => { const list = watches();
      el.innerHTML = `<p style="color:var(--mute);font-size:12px;margin:0 0 10px">Hush checks these every 30 minutes while it’s open and tells you when they change. Pages that build their content with scripts may not be readable — those show “not found”.</p>
        <div class=hx-row style="justify-content:flex-start;margin-bottom:10px"><button class=hx-b data-add>Watch something on this page…</button><button class=hx-b data-now>Check now</button></div>
        <div class=hx-list>${list.map((w, i) => `<div class=hx-item style="${w.changed ? 'border-color:var(--acc)' : ''}"><div><b>${esc(w.last || '—')}</b><small>${esc(host(w.url))}${w.changed ? ` · changed${w.prev ? ' from “' + esc(w.prev.slice(0, 40)) + '”' : ''} · ${ago(w.at)}` : w.missing ? ' · not found on the page' : ' · no change'}</small></div>
          <button class=hx-b data-open=${i}>Open</button><button class=hx-b data-rm=${i} aria-label=Remove>✕</button></div>`).join('') || '<small style="color:var(--mute)">Nothing watched yet. Open a product page, then tap “Watch something on this page” and tap the price.</small>'}</div>`;
      el.querySelector('[data-add]').onclick = () => A.watchPick();
      el.querySelector('[data-now]').onclick = async () => { A.toast('Checking…'); const n = await watchSweep(true); A.toast(n ? n + ' changed' : 'No changes'); draw(); };
      el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const l = watches(); l[b.dataset.open].changed = false; LS.set('watch', l); open(l[b.dataset.open].url); });
      el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const l = watches(); l.splice(+b.dataset.rm, 1); LS.set('watch', l); draw(); }); };
    draw(); }

  // ---------------------------------------------------------------- sync by QR (desktop -> phone)
  function syncLink(tabs, maxLen = 2300) {
    const st = A.state(), bms = (st.bookmarks || []).filter(b => /^https?:/.test(b.url)), ui = st.settings.ui || {};
    const keep = ['color', 'look', 'theme', 'search', 'force_dark', 'fp', 'clean_links', 'video_bar', 'gestures', 'wheel', 'archive', 'sp_bg', 'sp_clock', 'sp_notes', 'bangs'].filter(k => ui[k] != null && !(k === 'sp_bg' && ui[k] === 'image'));
    const s = Object.fromEntries(keep.map(k => [k, ui[k]])); if (st.settings.search) s.search = st.settings.search;
    const t = tabs.filter(x => !x.priv && /^https:/.test(x.url)).map(x => x.url);
    const enc = o => 'hush://import#' + btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    let nb = bms.length, nt = t.length, link = enc({ v: 2, s, t, b: bms.map(b => [b.title.slice(0, 40), b.url, b.folder || '']) });
    while (link.length > maxLen && (nt > 0 || nb > 0)) { if (nt > nb / 2 && nt > 0) nt--; else nb--; link = enc({ v: 2, s, t: t.slice(0, nt), b: bms.slice(0, nb).map(b => [b.title.slice(0, 40), b.url, b.folder || '']) }); }
    return { link, tabs: nt, totalTabs: t.length, bookmarks: nb, totalBookmarks: bms.length, settings: Object.keys(s).length };
  }

  return { home, boost, archiveSweep, archivePanel, markup, host, esc, gesture, gesturePanel, ACTIONS, applyLook, lookPicker, LOOKS,
    destructSweep, destructLabel, DESTRUCT, watchAdd, watchSweep, watchPanel, watchCount, syncLink, LS };
};
