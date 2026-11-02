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
.hx-tour{max-width:440px;margin:0 auto;padding:20px 8px;display:flex;flex-direction:column;gap:18px;min-height:60vh;justify-content:center}.hx-tc{position:relative;min-height:240px}
.hx-ts{position:absolute;inset:0;text-align:center;opacity:0;transform:translateX(24px);transition:opacity .25s,transform .25s;pointer-events:none}.hx-ts.on{opacity:1;transform:none;pointer-events:auto}
.hx-ts .e{font-size:64px;margin-bottom:14px}.hx-ts h2{display:block!important;text-align:center;font:700 24px system-ui;margin:0 0 10px;color:var(--ink)}.hx-ts p{color:var(--mute);font-size:15px;line-height:1.55;margin:0}
.hx-dots{display:flex;gap:6px;justify-content:center}.hx-dots i{width:7px;height:7px;border-radius:50%;background:var(--line)}.hx-dots i.on{background:var(--ink);width:20px;border-radius:99px}
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
    alltabs: 'All tabs', home: 'Start page', private: 'New private tab', mute: 'Mute tab', boosts: 'Boosts', destruct: 'Self-destruct tab…', panic: 'Panic: close private & Tor tabs, lock Murmur' };
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

  // ---------------------------------------------------------------- leaving a tab that's playing
  // A slim bar over the address bar: "Video from youtube.com — Mini player · Keep playing · Stop", with "Always".
  function mediaPrompt(parent, site, done) {
    document.getElementById('hx-mp')?.remove();
    const el = document.createElement('div'); el.id = 'hx-mp';
    el.innerHTML = `<style>#hx-mp{position:absolute;inset:4px 6px;z-index:20;display:flex;align-items:center;gap:6px;padding:0 6px 0 12px;border-radius:12px;background:var(--ink);color:var(--bg);font:12.5px system-ui;box-shadow:0 6px 24px #0004;animation:hxmp .18s ease-out}
      @keyframes hxmp{from{transform:translateY(-6px);opacity:0}}#hx-mp b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
      #hx-mp button{all:unset;cursor:pointer;padding:6px 10px;border-radius:9px;background:color-mix(in srgb,var(--bg) 16%,transparent);white-space:nowrap;font-weight:600}#hx-mp button:hover{background:color-mix(in srgb,var(--bg) 28%,transparent)}
      #hx-mp label{display:flex;align-items:center;gap:4px;opacity:.8;white-space:nowrap;cursor:pointer}#hx-mp .x{background:none;padding:6px}
      @media (max-width:520px){#hx-mp{font-size:11.5px;gap:4px;padding-left:10px}#hx-mp button{padding:6px 7px}#hx-mp b .p{display:none}}</style>
      <b>▶ ${esc(site || 'Video')}<span class=p> is playing</span></b><button data-c=mini>Mini player</button><button data-c=background>Keep playing</button><button data-c=pause>Stop</button>
      <label title="Always do what I pick"><input type=checkbox><span>Always</span></label><button class=x data-c=dismiss aria-label="Keep playing">✕</button>`;
    parent.append(el);
    let t = setTimeout(() => finish('background', false, true), 9000);
    el.addEventListener('pointerenter', () => clearTimeout(t));
    function finish(c, remember, quiet) { clearTimeout(t); el.remove(); done(c === 'dismiss' ? 'background' : c, remember, quiet); }
    el.querySelectorAll('[data-c]').forEach(b => b.onclick = () => finish(b.dataset.c, el.querySelector('input').checked));
  }
  // Privacy report card: what Hush did for you this week (counted only on this device).
  const weekKey = () => Math.floor(Date.now() / 604800e3);
  function bump(k, n = 1) { try { const r = JSON.parse(localStorage.getItem('hush.report') || '{}'); if (r.w !== weekKey()) { r.w = weekKey(); r.c = {}; } r.c[k] = (r.c[k] || 0) + n; localStorage.setItem('hush.report', JSON.stringify(r)); } catch (e) {} }
  function report(blockedWeek, M) { let c = {}; try { const r = JSON.parse(localStorage.getItem('hush.report') || '{}'); if (r.w === weekKey()) c = r.c || {}; } catch (e) {}
    let sent = 0; try { const ch = JSON.parse(localStorage.getItem('hush.msg.chats') || '{}'); const t0 = Date.now() - 7 * 86400e3; for (const l of Object.values(ch)) for (const m of l) if (m.from === 'me' && m.at > t0) sent++; } catch (e) {}
    const f = n => n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
    const items = [[blockedWeek, 'ads & trackers blocked'], [c.tor || 0, 'pages opened through Tor'], [sent, 'messages sent encrypted'], [c.pop || 0, 'popup ads stopped'], [c.meta || 0, 'photos cleaned of location data']].filter(x => x[0] > 0);
    if (!items.length) return 'Ads, trackers and cookie banners are blocked automatically.';
    return `<span style="display:block;font-weight:600;margin-bottom:2px">Your week with Hush</span>` + items.map(([n, l]) => `<b>${f(n)}</b> ${l}`).join(' · '); }
  // Tab notes: a private note pinned to a page, kept only on this device.
  const noteKey = u => { try { const x = new URL(u); x.hash = ''; return x.origin + x.pathname.replace(/\/$/, '') + x.search; } catch (e) { return ''; } };
  const tabNote = { get: u => { try { return JSON.parse(localStorage.getItem('hush.tabnotes') || '{}')[noteKey(u)] || ''; } catch (e) { return ''; } },
    set: (u, t) => { try { const all = JSON.parse(localStorage.getItem('hush.tabnotes') || '{}'), k = noteKey(u); if (!k) return; if (t.trim()) all[k] = t.slice(0, 2000); else delete all[k]; localStorage.setItem('hush.tabnotes', JSON.stringify(all)); } catch (e) {} } };
  // ---------------- On-device assistant (Gemma 4). Off until you turn it on; then everything runs on this device.
  // kind: 'lm' = text-only model (small, light on memory); 'mm' = Gemma 4 (also loads its image/audio parts, so it needs a lot of memory).
  // Your assistant's name — like a Siri or a Jarvis, but yours. "AI Assistant" until you pick one.
  const aiName = () => { try { return (localStorage.getItem('hush.ai.name') || '').trim().slice(0, 24) || 'AI Assistant'; } catch (e) { return 'AI Assistant'; } };
  const aiNamed = () => { try { return !!(localStorage.getItem('hush.ai.name') || '').trim(); } catch (e) { return false; } };
  const aiRename = v => { try { localStorage.setItem('hush.ai.name', String(v || '').replace(/[<>"&]/g, '').trim().slice(0, 24)); } catch (e) {} try { window.dispatchEvent(new Event('hush-ai-name')); } catch (e) {} };
  // Cloud option: Groq, with the user's own free key (console.groq.com). Fast and much smarter than a phone model;
  // requests go through Tor so Groq never sees your IP, but Groq does see what you ask.
  // Groq changes its model line-up often, so Hush asks Groq which models this key can use and picks the best chat
  // models from that list (preferring big, smart ones) instead of hard-coding names that get retired.
  const GROQ_PREF = [/gpt-oss-120b/, /llama-4-maverick/, /qwen.*(32b|27b|235b)/, /70b/, /llama-4/, /gpt-oss/, /qwen/, /llama/, /gemma/, /mistral|mixtral/, /./];
  const groqModelsCache = () => { try { const c = JSON.parse(localStorage.getItem('hush.ai.groqModels') || 'null'); return c && Date.now() - c.at < 86400e3 ? c.list : null; } catch (e) { return null; } };
  async function groqModels() {
    const c = groqModelsCache(); if (c && c.length) return c;
    const w = await window.__TAURI__.core.invoke('groq_chat', { key: groqKey(), path: 'models', direct: groqVia === 'direct' || undefined }); groqVia = w.via || groqVia;
    const ids = ((JSON.parse(w.body || '{}').data) || []).filter(m => m && m.id && m.active !== false).map(m => m.id)
      .filter(id => !/whisper|tts|guard|embed|playai|distil|orpheus|compound|safeguard|prompt/i.test(id));
    const list = ids.map(id => [GROQ_PREF.findIndex(r => r.test(id)), id]).sort((a, b) => a[0] - b[0]).map(x => x[1]).slice(0, 3);
    try { localStorage.setItem('hush.ai.groqModels', JSON.stringify({ at: Date.now(), list })); } catch (e) {}
    return list; }
  let groqVia = '';
  const groqKey = () => { try { return localStorage.getItem('hush.ai.groq') || ''; } catch (e) { return ''; } };
  async function groqAsk(prompt, on, max) {
    let last = '', models = [];
    try { models = await groqModels(); } catch (e) { const m = String(e && e.message || e); if (/key|limit|reach/i.test(m)) throw new Error(m); }
    if (!models.length) models = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'];
    for (const model of models) {
      try { const w = await window.__TAURI__.core.invoke('groq_chat', { key: groqKey(), direct: groqVia === 'direct' || undefined, body: JSON.stringify({ model, max_tokens: Math.min(2048, max || 700), temperature: 0.4,
          messages: [{ role: 'system', content: 'You are ' + aiName() + ', a helpful, concise assistant inside the Hush privacy browser. Answer clearly; use short paragraphs or bullet points.' }, { role: 'user', content: String(prompt).slice(0, 60000) }] }) });
        // Groq's firewall often blocks Tor; then Hush goes direct. Remember that for this session (saves a slow failed try each time).
        groqVia = w.via || 'tor'; const r = JSON.parse(w.body || '{}'); try { localStorage.setItem('hush.ai.groqModel', model); } catch (e) {}
        const t = (((r.choices || [])[0] || {}).message || {}).content || ''; on && on(t); return t.trim(); }
      catch (e) { last = String(e && e.message || e); if (/key|limit|reach/i.test(last)) break; try { localStorage.removeItem('hush.ai.groqModels'); } catch (_) {} } }
    throw new Error(last || 'Groq didn’t answer');
  }
  const AI_MODELS = { lite: { id: 'onnx-community/gemma-3-1b-it-ONNX', kind: 'lm', name: 'Gemma 3 1B (Lite)', size: 'about 1 GB', mem: 3, note: 'Light on memory — the one for phones' },
    e2b: { id: 'onnx-community/gemma-4-E2B-it-ONNX', kind: 'mm', name: 'Gemma 4 E2B', size: 'about 1.5 GB download', mem: 8, note: 'Smarter; needs a phone or PC with 8 GB+ of memory' },
    e4b: { id: 'onnx-community/gemma-4-E4B-it-ONNX', kind: 'mm', name: 'Gemma 4 E4B', size: 'about 3 GB download', mem: 16, note: 'Smartest; for a desktop or laptop with 16 GB+' } };
  const MOBILE = /Android|iPhone|iPad/i.test(navigator.userAgent);
  // Crash guard: loading a model too big for the device's memory can close the whole app. A marker is set while
  // loading and cleared when it finishes; if it's still there at the next start, the app died while loading, so the
  // assistant is NOT loaded again automatically (that would crash on every start) and you're offered the Lite model.
  const BOOT = 'hush.ai.loading';
  const lsg = k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, lss = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const ai = (() => { let w = null, st = 'off', err = '', prog = {}, seq = 0, crash = false; const waits = {}, subs = new Set();
    const cfg = () => { try { return JSON.parse(localStorage.getItem('hush.ai') || '{}'); } catch (e) { return {}; } };
    const tell = () => subs.forEach(f => { try { f(); } catch (e) {} });
    let gotBytes = 0, wantBytes = 0, pct = 0;
    async function load() { if (w || !navigator.gpu) { if (!navigator.gpu) { st = 'error'; err = 'This device’s graphics chip can’t run the assistant (no WebGPU).'; tell(); } return; }
      st = 'loading'; err = ''; prog = {}; pct = 0; lss(BOOT, String(Date.now())); tell(); let ort = '1.22.0'; try { ort = (await (await fetch('vendor/ort/VERSION')).text()).trim() || ort; } catch (e) {}
      try { w = new Worker('assistant-worker.js', { type: 'module' }); } catch (e) { st = 'error'; err = 'Couldn’t start the assistant: ' + e.message; lss(BOOT, null); return tell(); }
      const fail = e => { st = 'error'; err = e; lss(BOOT, null); try { w.terminate(); } catch (_) {} w = null; tell(); };
      w.onerror = e => fail('The assistant stopped: ' + (e.message || 'out of memory?') + (MOBILE ? ' Try the Lite model.' : ''));
      w.onmessage = e => { const m = e.data; if (m.t === 'progress') { prog[m.file] = [m.loaded, m.total];
          // One steady bar: files arrive one after another, so the overall percent never jumps backwards.
          let a = 0, b = 0; for (const [l, t] of Object.values(prog)) { a += l; b += t; } pct = Math.max(pct, b ? Math.min(0.97, a / b) : 0); tell(); }
        else if (m.t === 'stage') { if (m.s === 'warm' && stage !== 'warm') { warmAt = Date.now(); clearTimeout(dog);
            // Watchdog: setting the model up should take a minute or two; if it never finishes, say so instead of sitting at 97%.
            dog = setTimeout(() => { if (st === 'loading') fail('Setting up the model is taking too long — this phone’s graphics chip may not handle it. Try again, or use a cloud assistant.'); }, 6 * 60e3); }
          stage = m.s; tell(); }
        else if (m.t === 'ready') { clearTimeout(dog); st = 'ready'; pct = 1; lss(BOOT, null); tell(); } else if (m.t === 'error' && !m.id) fail(m.e);
        else if (m.id && waits[m.id]) { const q = waits[m.id]; if (m.t === 'tok') { q.out += m.x; q.on && q.on(q.out); } else if (m.t === 'done') { delete waits[m.id]; q.res(q.out.trim()); } else if (m.t === 'error') { delete waits[m.id]; q.rej(new Error(m.e)); } } };
      const md = AI_MODELS[cfg().model] || AI_MODELS.lite; w.postMessage({ t: 'load', model: md.id, kind: md.kind, ort }); }
    let stage = '', warmAt = 0, dog = 0;
    return { cfg, on: () => !!cfg().on, status: () => (cfg().mode === 'groq' && groqKey() ? 'ready' : st), error: () => err, sub: f => (subs.add(f), () => subs.delete(f)),
      progress: () => pct, stage: () => stage,
      crashed: () => !!lsg(BOOT),
      // Try a key (one tiny request through Tor); on success switch the assistant to Groq.
      async connectGroq(key) { const prevK = groqKey(), prev = localStorage.getItem('hush.ai'); try { localStorage.removeItem('hush.ai.groqModels'); } catch (e) {} groqVia = '';
        try { localStorage.setItem('hush.ai.groq', key); localStorage.setItem('hush.ai', JSON.stringify({ on: true, mode: 'groq' })); await groqAsk('Reply with: ready', null, 10); this.useGroq(key); return true; }
        catch (e) { localStorage.setItem('hush.ai.groq', prevK); localStorage.setItem('hush.ai', prev || '{}'); throw e; } },
      useGroq(key) { localStorage.setItem('hush.ai.groq', key); localStorage.setItem('hush.ai', JSON.stringify({ on: true, mode: 'groq' })); if (w) { w.terminate(); w = null; } lss(BOOT, null); st = 'ready'; tell(); },
      cloud: () => cfg().mode === 'groq', groqVia: () => groqVia,
      enable(model) { localStorage.setItem('hush.ai', JSON.stringify({ on: true, model })); load(); },
      disable() { localStorage.setItem('hush.ai', JSON.stringify({ on: false })); if (w) w.terminate(); w = null; st = 'off'; tell(); },
      start() { if (cfg().mode === 'groq') { st = groqKey() ? 'ready' : 'off'; return tell(); } if (!cfg().on || w) return;
        if (lsg(BOOT)) { lss(BOOT, null); st = 'error'; err = 'Hush closed while loading the assistant last time — this device probably doesn’t have enough memory for ' + ((AI_MODELS[cfg().model] || {}).name || 'that model') + '. Pick the Lite model below.'; crash = true; return tell(); }
        load(); },
      wasCrash: () => crash,
      ask(prompt, on, max) { if (cfg().mode === 'groq') return groqAsk(prompt, on, max); return new Promise((res, rej) => { if (st !== 'ready') return rej(new Error('The assistant isn’t ready yet')); const id = ++seq; waits[id] = { res, rej, on, out: '' }; w.postMessage({ t: 'ask', id, prompt, max }); }); } }; })();
  function assistant(el, o) { // o: { pageText():Promise<string>, pageInfo():{host}?, close(), run? }
    // Setup screens (naming, choosing Groq / on-device, downloading) get a close button when shown full-screen.
    const xbtn = () => { if (o.close && !el.querySelector('.ax') && !el.querySelector('[data-xclose]')) el.insertAdjacentHTML('afterbegin', '<div style="display:flex;justify-content:flex-end;padding:8px 10px 0"><button data-xclose aria-label="Close" style="all:unset;cursor:pointer;width:36px;height:36px;border-radius:10px;display:grid;place-items:center;color:var(--mute);font-size:18px">✕</button></div>'); };
    el.addEventListener('click', e => { if (e.target.closest('[data-xclose]')) o.close(); });
    new MutationObserver(xbtn).observe(el, { childList: true });
    // First time: give it a name.
    if (!aiNamed()) { el.innerHTML = `<style>${AX_CSS}</style><div style="padding:18px;display:grid;gap:12px"><div class=ax-hi style="margin:0;padding:6px 0 0"><div class=ax-av>✦</div><h3>Name your AI assistant</h3></div>
      <p style="margin:0;color:var(--mute)">It’s yours — it runs on this device and helps you read, summarize and reply. Give it a name, like you would a Siri or a Jarvis.</p>
      <input class=txt id=ai-nm maxlength=24 placeholder="e.g. Nova, Jarvis, Echo, Sage" style="margin:0;font-size:16px">
      <div style="display:flex;gap:8px;flex-wrap:wrap">${['Nova', 'Jarvis', 'Sage', 'Atlas', 'Luna', 'Max'].map(n => `<button class=btn data-nm="${n}">${n}</button>`).join('')}</div>
      <div style="display:flex;gap:8px"><button class=btn data-skip>Keep “AI Assistant”</button><span style="flex:1"></span><button class=btn data-ok style="background:var(--ink);color:var(--bg)">Continue</button></div></div>`;
      const inp = el.querySelector('#ai-nm'), done = v => { aiRename(v || 'AI Assistant'); assistant(el, o); };
      el.querySelectorAll('[data-nm]').forEach(b => b.onclick = () => { inp.value = b.dataset.nm; inp.focus(); });
      el.querySelector('[data-ok]').onclick = () => done(inp.value.trim()); el.querySelector('[data-skip]').onclick = () => done('AI Assistant');
      inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value.trim()); }; setTimeout(() => inp.focus(), 60); return; }
    el.addEventListener('click', e => { if (e.target.closest('[data-switch]')) { ai.disable(); view = ''; draw(); return; } const b = e.target.closest('[data-rename]'); if (!b) return; const v = prompt('Rename your assistant', aiName()); if (v && v.trim()) { aiRename(v); draw(); } });
    let view = '';
    const draw = () => { const st = ai.status(), c = ai.cfg();
      if (view === 'groq') { el.innerHTML = `<div style="padding:16px;display:grid;gap:12px;line-height:1.5"><h2 style="margin:0">Set up ${esc(aiName())} with Groq</h2>
        <p style="margin:0;color:var(--mute)">Groq runs big open AI models in the cloud — answers in about a second and much smarter than a phone model. The free plan gives <b>about 1,000 requests a day</b> (roughly 60 page summaries or hundreds of questions), just for you.</p>
        <ol style="margin:0;padding-left:20px;display:grid;gap:8px">
          <li>Tap <b>Get my free key</b> below — Groq’s key page opens in a Hush tab.</li>
          <li>Sign in with Google, GitHub or email. Free — no card needed.</li>
          <li>Tap <b>Create API Key</b>, name it “Hush”, and tap <b>Submit</b>.</li>
          <li>Hush spots the new key and shows <b>Use this key in Hush</b> — tap it. Done: you’ll land back here, ready to go.</li></ol>
        <p style="margin:0;font-size:12.5px;color:var(--mute)">🔒 Hush tries Tor first so Groq can’t see your IP. Groq’s firewall often blocks Tor, and then Hush connects directly — Groq then sees your IP address. Either way Groq sees what you ask. For fully private answers, use the on-device model.</p>
        <button class=btn data-gopen style="background:var(--ink);color:var(--bg);padding:12px;font-size:15px;justify-self:stretch;text-align:center">Get my free key →</button>
        <details><summary style="cursor:pointer;color:var(--mute);font-size:13px">Already have a key? Paste it</summary>
        <input class=txt id=gk placeholder="gsk_…" autocomplete=off spellcheck=false style="margin:0;font-family:ui-monospace,monospace" value="${esc(groqKey())}">
        <p style="margin:0;font-size:12px;color:var(--mute)">Your key stays on this device.</p>
        <div style="display:flex;gap:8px;margin-top:8px"><span style="flex:1"></span><button class=btn data-gsave>Save key</button></div></details>
        <button class=btn data-back style="justify-self:start">Back</button></div>`;
        el.querySelector('[data-back]').onclick = () => { view = ''; draw(); };
        el.querySelector('[data-gopen]').onclick = () => { try { localStorage.setItem('hush.ai.groqWait', String(Date.now())); A.open('https://console.groq.com/keys'); } catch (e) { A.toast('Go to console.groq.com/keys'); } };
        el.querySelector('[data-gsave]').onclick = async () => { const k = el.querySelector('#gk').value.trim(); if (!/^gsk_[A-Za-z0-9]{20,}$/.test(k)) return A.toast('That doesn’t look like a Groq key — it starts with gsk_');
          A.toast('Checking the key through Tor…');
          try { await ai.connectGroq(k); view = ''; A.toast(aiName() + ' is ready'); draw(); } catch (e) { A.toast(String(e && e.message || e)); } };
        return; }
      if (!c.on) { el.innerHTML = `<div style="padding:16px;display:grid;gap:12px">${axHead('Set up your AI assistant')}<p style="margin:0;color:var(--mute)">Summarize pages, explain things and draft replies. Pick how it runs — you can change it any time.</p>
        <button class=row data-groq style="all:unset;cursor:pointer;box-sizing:border-box;text-align:left;display:block;width:100%;padding:14px;border:1.5px solid var(--acc);border-radius:16px;background:var(--card);line-height:1.45"><b>Cloud — Groq</b> <small style="color:var(--acc)">· fastest &amp; smartest</small> · free key<br><small style="color:var(--mute)">Instant answers from big AI models. Free (about 1,000 requests a day). Groq sees what you ask. About 2 minutes to set up.</small></button>
        <div style="font:600 12px system-ui;color:var(--mute);margin-top:4px">OR ON THIS DEVICE — fully private</div>
        ${Object.entries(AI_MODELS).map(([k, m]) => { const rec = false && k, tight = (navigator.deviceMemory || (MOBILE ? 4 : 8)) < m.mem && m.mem > 3;
          return `<button class=row data-m=${k} style="all:unset;cursor:pointer;box-sizing:border-box;text-align:left;display:block;width:100%;padding:14px;border:1px solid var(--line);border-radius:16px;background:var(--card);line-height:1.45"><b>${m.name}</b>${rec ? ' <small style="color:var(--acc)">· recommended</small>' : ''} · ${m.size}<br><small style="color:var(--mute)">${m.note}${tight ? ' — <b>may be too big for this device and close Hush while loading</b>' : ''}</small></button>`; }).join('')}
        <p style="margin:0;font-size:12px;color:var(--mute)">The model is downloaded once from Hugging Face (Google’s open Gemma models) and kept on this device. ${navigator.gpu ? '' : '<b>This device can’t run it: no WebGPU support.</b>'}</p></div>`;
        el.querySelector('[data-groq]').onclick = () => { view = 'groq'; draw(); };
        el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { if (!navigator.gpu) return A.toast('This device can’t run the assistant'); if (confirm('Download ' + AI_MODELS[b.dataset.m].name + ' (' + AI_MODELS[b.dataset.m].size + ')? Use Wi-Fi.')) { ai.enable(b.dataset.m); draw(); } }); return; }
      if (st !== 'ready') { el.innerHTML = `<div style="padding:16px;display:grid;gap:10px">${axHead('Set up your AI assistant')}${st === 'error' ? `<p>⚠ ${esc(ai.error())}</p>${c.model !== 'lite' ? '<button class=btn data-lite>Switch to the Lite model</button>' : ''}<button class=btn data-retry>Try again</button>` : `<p>${ai.stage() === 'warm' ? 'Setting it up on your graphics chip — almost there… (first time can take 1–3 minutes; keep Hush open)' : 'Downloading… ' + Math.round(ai.progress() * 100) + '%'}</p><div style="height:6px;border-radius:3px;background:var(--line);overflow:hidden"><i style="display:block;height:100%;width:${Math.round(ai.progress() * 100)}%;background:var(--acc)"></i></div><p style="font-size:12px;color:var(--mute)">First time only — it’s kept on this device afterwards.</p>`}<button class=btn data-off>Turn off & remove</button></div>`;
        el.querySelector('[data-retry]')?.addEventListener('click', () => { ai.disable(); ai.enable(c.model); draw(); });
        el.querySelector('[data-lite]')?.addEventListener('click', () => { ai.disable(); ai.enable('lite'); draw(); }); el.querySelector('[data-off]').onclick = () => { ai.disable(); try { caches.keys().then(k => k.forEach(n => caches.delete(n))); } catch (e) {} draw(); }; return; }
      chat(el, o); };
    const un = ai.sub(() => { if (!el.isConnected) return un(); if (ai.status() !== 'ready' || !el.querySelector('.ax')) draw(); }); draw(); }

  // ---------- The assistant's chat screen ----------
  // One conversation per session (kept in memory, never saved). Messages stream in; the page you're on can be
  // used as context with one tap. Works the same in the phone sheet and the desktop dock.
  const AX_CSS = `.ax{display:flex;flex-direction:column;height:100%;min-height:420px;box-sizing:border-box;color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
  .ax-h{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line)}
  .ax-av{width:38px;height:38px;border-radius:50%;flex:none;display:grid;place-items:center;font:700 16px system-ui;color:#fff;background:linear-gradient(135deg,#6d5efc,#22b8cf)}
  .ax-h b{display:block;font-size:16px}.ax-h small{display:block;color:var(--mute);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ax-ib{all:unset;cursor:pointer;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:var(--mute);flex:none}.ax-ib:hover{background:var(--card);color:var(--ink)}
  .ax-ib svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .ax-m{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:12px;scroll-behavior:smooth}
  .ax-hi{margin:auto 0;text-align:center;padding:10px 4px}.ax-hi .ax-av{width:60px;height:60px;font-size:24px;margin:0 auto 10px}.ax-hi h3{margin:0 0 4px;font:700 20px system-ui}.ax-hi p{margin:0 0 16px;color:var(--mute);font-size:14px}
  .ax-sg{display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:left}
  .ax-sg button{all:unset;cursor:pointer;padding:12px;border:1px solid var(--line);border-radius:14px;background:var(--card);font-size:13.5px;line-height:1.35}.ax-sg button:hover{border-color:var(--acc)}
  .ax-sg button b{display:block;font-size:14px;margin-bottom:2px}.ax-sg button span{color:var(--mute)}
  .ax-u{align-self:flex-end;max-width:85%;background:var(--ink);color:var(--bg);padding:9px 13px;border-radius:18px 18px 4px 18px;white-space:pre-wrap;word-wrap:break-word}
  .ax-a{align-self:flex-start;max-width:92%;display:flex;gap:8px}.ax-a .ax-av{width:26px;height:26px;font-size:12px;margin-top:2px}
  .ax-a .t{background:var(--card);border:1px solid var(--line);padding:10px 13px;border-radius:4px 18px 18px 18px;white-space:pre-wrap;word-wrap:break-word;user-select:text}
  .ax-a .t.err{border-color:#d33;color:#d33}.ax-a .t:empty::after{content:"";display:inline-block;width:28px;height:8px;background:radial-gradient(circle,var(--mute) 35%,transparent 40%) 0 0/10px 8px repeat-x;animation:axd 1s steps(3) infinite}
  @keyframes axd{from{width:8px}to{width:30px}}
  .ax-tools{display:flex;gap:4px;margin-top:4px}.ax-tools button{all:unset;cursor:pointer;color:var(--mute);font-size:12px;padding:2px 8px;border-radius:8px}.ax-tools button:hover{background:var(--card);color:var(--ink)}
  .ax-c{border-top:1px solid var(--line);padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px))}
  .ax-ctx{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--mute);padding:4px 10px;border:1px solid var(--line);border-radius:999px;margin-bottom:8px;cursor:pointer;user-select:none;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .ax-ctx.on{color:var(--ink);border-color:var(--acc);background:color-mix(in srgb,var(--acc) 10%,transparent)}
  .ax-row{display:flex;gap:8px;align-items:flex-end}.ax-row textarea{flex:1;resize:none;border:1px solid var(--line);border-radius:20px;padding:10px 14px;background:var(--card);color:var(--ink);font:15px/1.4 system-ui;max-height:140px;min-height:22px;outline:none}
  .ax-row textarea:focus{border-color:var(--acc)}
  .ax-send{all:unset;cursor:pointer;width:42px;height:42px;border-radius:50%;background:var(--ink);color:var(--bg);display:grid;place-items:center;flex:none}.ax-send:disabled{opacity:.35;cursor:default}
  .ax-send svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}`;
  const AX_SUGG = [['sum', 'Summarize', 'this page in a few lines', 'Summarize this web page in 4–6 short sentences.', true],
    ['key', 'Key points', 'as quick bullets', 'List the key points of this web page as short bullet points.', true],
    ['simple', 'Explain simply', 'no jargon', 'Explain what this web page says in simple words.', true],
    ['ask', 'Ask anything', 'not about the page', '', false]];
  // Header used on the setup screens too (same look as the chat).
  const axHead = sub => `<style>${AX_CSS}</style><div class=ax-h style="padding:6px 0 14px;border:0"><div class=ax-av>${esc((aiName().trim()[0] || 'A').toUpperCase())}</div><div style="flex:1;min-width:0"><b>${esc(aiName())}</b><small>${esc(sub)}</small></div><button class=ax-ib data-rename title="Rename"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button></div>`;
  let axLog = [];   // [{r:'u'|'a', t, err}]
  function chat(el, o) {
    const name = aiName(), ini = esc(name.trim()[0] || 'A').toUpperCase(), sub = ai.cloud() ? (ai.groqVia() === 'direct' ? 'Groq · direct' : 'Groq · through Tor') : 'On this device · private';
    let ctx = o.ctx !== false;
    el.innerHTML = `<style>${AX_CSS}</style><div class=ax><div class=ax-h><div class=ax-av>${ini}</div><div style="flex:1;min-width:0"><b>${esc(name)}</b><small>${sub}</small></div>
      <button class=ax-ib data-new title="New chat"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
      <button class=ax-ib data-rename title="Rename"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
      <button class=ax-ib data-switch title="Change how it runs (Groq / on this device)"><svg viewBox="0 0 24 24"><circle cx=12 cy=12 r=3 /><path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L6 10.9a7 7 0 0 0 0 2.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6c.1-.4.1-.7.1-1.1z"/></svg></button>
      ${o.close ? '<button class=ax-ib data-close title="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' : ''}</div>
      <div class=ax-m></div>
      <div class=ax-c><div class=ax-ctx></div><div class=ax-row><textarea rows=1 placeholder="Message ${esc(name)}…" enterkeyhint=send></textarea><button class=ax-send aria-label=Send disabled><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div></div></div>`;
    const M = el.querySelector('.ax-m'), ta = el.querySelector('textarea'), send = el.querySelector('.ax-send'), cx = el.querySelector('.ax-ctx');
    let host = ''; Promise.resolve(o.pageInfo ? o.pageInfo() : null).then(p => { host = p && p.host || ''; paintCtx(); });
    const paintCtx = () => { cx.className = 'ax-ctx' + (ctx && host ? ' on' : ''); cx.style.display = host ? '' : 'none';
      cx.innerHTML = ctx ? `📄 Using this page · ${esc(host)} <span style="opacity:.6">✕</span>` : `📄 Use this page (${esc(host)})`; };
    cx.onclick = () => { ctx = !ctx; paintCtx(); };
    const bubble = m => m.r === 'u' ? `<div class=ax-u>${esc(m.t)}</div>`
      : `<div class=ax-a><div class=ax-av>${ini}</div><div><div class="t${m.err ? ' err' : ''}">${esc(m.t)}</div>${m.t && !m.err && !m.live ? '<div class=ax-tools><button data-copy>Copy</button></div>' : ''}</div></div>`;
    const paint = () => { M.innerHTML = axLog.length ? axLog.map(bubble).join('') : `<div class=ax-hi><div class=ax-av>${ini}</div><h3>Hi, I’m ${esc(name)}</h3><p>${ai.cloud() ? 'Fast answers from Groq.' : 'I run on this device — nothing you ask leaves it.'} What can I help with?</p>
        <div class=ax-sg>${AX_SUGG.map(([k, a, b]) => `<button data-sg=${k}><b>${a}</b><span>${b}</span></button>`).join('')}</div></div>`;
      M.querySelectorAll('[data-copy]').forEach((b, k) => b.onclick = () => { const txt = axLog.filter(m => m.r === 'a')[k]?.t || ''; try { navigator.clipboard.writeText(txt); A.toast('Copied'); } catch (e) {} });
      M.querySelectorAll('[data-sg]').forEach(b => b.onclick = () => { const s = AX_SUGG.find(x => x[0] === b.dataset.sg); if (!s[3]) { ta.focus(); return; } ask(s[1], s[3], true); });
      M.scrollTop = M.scrollHeight; };
    let busy = false;
    async function ask(shown, q, usePage) {
      if (busy) return; busy = true; send.disabled = true;
      axLog.push({ r: 'u', t: shown }); const a = { r: 'a', t: '', live: true }; axLog.push(a); paint();
      const tEl = () => M.querySelectorAll('.ax-a .t')[M.querySelectorAll('.ax-a .t').length - 1];
      let page = ''; if (usePage) { try { page = (await o.pageText()) || ''; } catch (e) {} if (!page.trim()) { a.t = 'I couldn’t read this page — open a website first, or turn off “Use this page”.'; a.err = true; a.live = false; busy = false; paint(); return; } }
      // Recent turns give follow-up questions context.
      const hist = axLog.slice(0, -2).slice(-6).map(m => (m.r === 'u' ? 'User: ' : name + ': ') + m.t.slice(0, 1500)).join('\n');
      const prompt = (hist ? 'Conversation so far:\n' + hist + '\n\n' : '') + (usePage ? `${q}\n\nWeb page${host ? ' (' + host + ')' : ''}:\n${page.slice(0, ai.cloud() ? 40000 : 12000)}` : q);
      try { await ai.ask(prompt, t => { a.t = t; const e = tEl(); if (e) { e.textContent = t; M.scrollTop = M.scrollHeight; } }, 900); }
      catch (e) { a.t = String(e && e.message || e); a.err = true; }
      a.live = false; busy = false; paint(); send.disabled = !ta.value.trim(); }
    const go = () => { const q = ta.value.trim(); if (!q || busy) return; ta.value = ''; ta.style.height = ''; send.disabled = true;
      ask(q, q, ctx && !!host); };
    ta.oninput = () => { send.disabled = !ta.value.trim() || busy; ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; };
    ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } };
    send.onclick = go;
    el.querySelector('[data-new]').onclick = () => { axLog = []; paint(); ta.focus(); };
    el.querySelector('[data-close]')?.addEventListener('click', () => o.close());
    paint(); paintCtx(); if (!A.mobile) setTimeout(() => ta.focus(), 80);
    if (o.run) { const s = AX_SUGG.find(x => x[0] === o.run); if (s && s[3]) setTimeout(() => ask(s[1], s[3], true), 120); }
  }
  const SEC = [['', 'Standard'], ['safer', 'Safer'], ['safest', 'Safest']];
  const LEAVE = [['ask', 'Ask me'], ['mini', 'Mini player'], ['background', 'Keep playing'], ['pause', 'Stop']];

  // Plain-language explainer for the ⓘ next to Tor.
  const TOR_INFO = `<div style="line-height:1.55;font-size:14px">
    <p style="margin:0 0 10px"><b>Tor</b> is a free, volunteer-run network that hides where you are on the internet. Normally every site you visit sees your IP address — which reveals your rough location and internet provider.</p>
    <p style="margin:0 0 10px">With Tor, your connection bounces through <b>three random relays</b> around the world, wrapped in three layers of encryption. The site only sees the last relay, and no single relay knows both who you are and what you’re visiting.</p>
    <p style="margin:0 0 6px"><b>Good for</b></p><ul style="margin:0 0 10px;padding-left:20px"><li>Hiding your location and IP from sites and trackers</li><li>Keeping your internet provider from seeing which sites you visit</li><li>Getting past some network blocks</li></ul>
    <p style="margin:0 0 6px"><b>Keep in mind</b></p><ul style="margin:0 0 10px;padding-left:20px"><li>Pages load slower — your traffic travels further</li><li>If you sign in to a site, that site still knows it’s you</li><li>Some sites show extra captchas or block Tor</li></ul>
    <p style="margin:0;color:var(--mute);font-size:12.5px">Hush has Tor built in (the Tor Project’s Arti engine), so there’s nothing to install. Hush Messenger always uses it.</p></div>`;
  // Settings search: filter rows by text; hide section titles with nothing left under them.
  function settingsSearch(root, input, rowSel) {
    const run = () => { const q = input.value.trim().toLowerCase(), re = q ? new RegExp('(^|[^a-z0-9])' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null; let h = null, any = false;
      [...root.children].forEach(el => { if (el.tagName === 'H3') { if (h) h.style.display = any || !q ? '' : 'none'; h = el; any = false; return; }
        if (!el.matches(rowSel)) return; const ok = !q || re.test(el.textContent); el.style.display = ok ? '' : 'none'; if (ok) any = true; });
      if (h) h.style.display = any || !q ? '' : 'none'; };
    input.oninput = run; run();
  }
  // First-run tour: a few swipeable cards that show off what Hush can do.
  function tour(el, mobile, done) {
    const S = [
      ['🛡', 'Private by default', 'Ads, trackers, cookie banners and fingerprinting are blocked on every site. Tap the shield for per-site settings.'],
      mobile ? ['👆', 'Built for your thumbs', 'Swipe the address bar ← → to switch tabs, swipe it down for all tabs, hold it for commands. Two-finger swipes and the quick wheel are customizable in Settings.']
             : ['🖱', 'Gestures & the quick wheel', 'Hold the right mouse button and draw to go back, close tabs and more. Right-click and hold for your quick wheel. Ctrl+K finds anything.'],
      ['👀', 'Peek & floating video', mobile ? 'Hold a link to peek at it without leaving the page. Leave a playing video and it keeps going in a mini player.' : 'Shift-click a link to peek at it. Leave a playing video and it keeps going in a small player you can drag and resize.'],
      ['🧅', 'Tor, built in', 'Hide your IP and location with one tap — the onion. No extra app, nothing to install.'],
      ['💬', 'Murmur', 'Private messages, photos, voice and video with other Hush users — end-to-end encrypted and always through Tor. No phone number.'],
      ['📣', 'Echo', 'Share with friends privately, or make a public profile if you want to be found. Your choice, post by post.']];
    let i = 0;
    const draw = () => { el.innerHTML = `<div class=hx-tour><div class=hx-tc>${S.map((s, k) => `<div class="hx-ts ${k === i ? 'on' : ''}"><div class=e>${s[0]}</div><h2>${s[1]}</h2><p>${s[2]}</p></div>`).join('')}</div>
      <div class=hx-dots>${S.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class=hx-row><button class=hx-b data-t=skip>Skip</button><span style="flex:1"></span>${i ? '<button class=hx-b data-t=back>Back</button>' : ''}<button class="hx-b on" data-t=next style="background:var(--ink);color:var(--bg)">${i === S.length - 1 ? 'Start browsing' : 'Next'}</button></div></div>`;
      el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { const t = b.dataset.t; if (t === 'skip' || (t === 'next' && i === S.length - 1)) return done(); i += t === 'next' ? 1 : -1; draw(); });
      let x0 = null; const c = el.querySelector('.hx-tc'); c.ontouchstart = e => x0 = e.touches[0].clientX;
      c.ontouchend = e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (dx < -50 && i < S.length - 1) { i++; draw(); } else if (dx > 50 && i) { i--; draw(); } }; };
    draw();
  }
  return { ai, aiName, aiRename, assistant, settingsSearch, tour, TOR_INFO, mediaPrompt, LEAVE, SEC, bump, report, tabNote, home, boost, archiveSweep, archivePanel, markup, host, esc, gesture, gesturePanel, ACTIONS, applyLook, lookPicker, LOOKS,
    destructSweep, destructLabel, DESTRUCT, watchAdd, watchSweep, watchPanel, watchCount, syncLink, LS };
};
