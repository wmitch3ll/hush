// Vault screens (desktop panel + phone sheet) and the "bring your stuff over" importer. Needs vault.js and importer.js.
// HXVUI.open(el, o):  o = { host, readForm():Promise<{host,user,pass,has}>, fill(entry), copy(text), toast(msg), range(prefix):Promise<text>,
//   bookmarks(items):Promise<n>, bio:{on(), enable(pw), unlock():Promise<pw|null>, disable()}?, close() }
(function (G) {
  const V = G.HXV, I = G.HXI, esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CSS = `.vx{display:grid;gap:12px;color:var(--ink,#161616);font:14px/1.4 system-ui,sans-serif;max-width:640px;margin:0 auto;width:100%;box-sizing:border-box}
.vx *{box-sizing:border-box}.vx h3{margin:0;font:700 20px system-ui;letter-spacing:-.02em}.vx p{margin:0;color:var(--mute,#8b8b88)}
.vx input,.vx textarea,.vx select{width:100%;padding:11px 13px;border-radius:12px;border:1px solid var(--line,#e4e4e2);background:var(--card,#fff);color:inherit;font:15px system-ui;outline:none;user-select:text}
.vx input:focus,.vx textarea:focus{border-color:var(--ink,#161616)}
.vx button{all:unset;cursor:pointer;box-sizing:border-box;padding:10px 16px;border-radius:99px;font:600 13.5px system-ui;background:color-mix(in srgb,var(--ink,#161616) 10%,transparent);text-align:center}
.vx button:hover{background:color-mix(in srgb,var(--ink,#161616) 16%,transparent)}.vx button.p{background:var(--ink,#161616);color:var(--bg,#f5f5f4)}.vx button.d{color:#ef4444}.vx button:disabled{opacity:.45;cursor:default}
.vx .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.vx .row>input{flex:1;min-width:140px}.vx .grow{flex:1}
.vx .hero{display:grid;gap:10px;justify-items:center;text-align:center;padding:26px 10px}.vx .hero svg{width:54px;height:54px;stroke:currentColor;fill:none;stroke-width:1.4}
.vx .card{background:var(--card,#fff);border:1px solid var(--line,#e4e4e2);border-radius:16px;padding:6px}
.vx .it{display:flex;gap:12px;align-items:center;padding:10px;border-radius:12px;cursor:pointer}.vx .it:hover{background:color-mix(in srgb,var(--ink,#161616) 6%,transparent)}
.vx .fav{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;font:700 15px system-ui;color:#fff;flex:none;text-transform:uppercase}
.vx .it b{display:block;font:600 14.5px system-ui;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.vx .it small{color:var(--mute,#8b8b88);font:12.5px system-ui;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vx .it>div{min-width:0;flex:1}.vx .tag{font:600 10.5px system-ui;padding:2px 7px;border-radius:99px;background:#ef444422;color:#ef4444}.vx .tag.o{background:#f59e0b22;color:#f59e0b}
.vx .bar{height:5px;border-radius:9px;background:color-mix(in srgb,var(--ink,#161616) 12%,transparent);overflow:hidden}.vx .bar i{display:block;height:100%;border-radius:9px;transition:width .2s,background .2s}
.vx .pw{font:15px ui-monospace,Consolas,monospace;letter-spacing:.02em;word-break:break-all;user-select:text}.vx label{font:600 12px system-ui;color:var(--mute,#8b8b88);display:block;margin:0 0 4px 2px}
.vx .fill{display:flex;gap:10px;align-items:center;padding:12px 14px;border-radius:16px;background:color-mix(in srgb,#22c55e 14%,transparent);border:1px solid #22c55e55}.vx .fill b{flex:1;min-width:0}
.vx .seg{display:flex;gap:6px;flex-wrap:wrap}.vx .seg button.on{background:var(--ink,#161616);color:var(--bg,#f5f5f4)}.vx .err{color:#ef4444;font:600 13px system-ui;min-height:18px}
.vx .stat{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.vx .stat div{padding:12px;border-radius:14px;background:var(--card,#fff);border:1px solid var(--line,#e4e4e2);text-align:center}.vx .stat b{font:700 22px system-ui;display:block}.vx .stat small{color:var(--mute,#8b8b88);font-size:12px}`;
  const hue = h => { let n = 0; for (const c of h) n = (n * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${n % 360} 55% 45%)`; };
  const LOCK = '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  const bar = s => `<div class=bar><i style="width:${[8, 28, 55, 80, 100][s]}%;background:${['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#16a34a'][s]}"></i></div>`;

  function open(el, o) {
    o = o || {}; if (!document.getElementById('vx-css')) { const s = document.createElement('style'); s.id = 'vx-css'; s.textContent = CSS; document.head.append(s); }
    let view = 'list', sel = null, q = '', form = null, msg = '';
    const root = document.createElement('div'); root.className = 'vx'; el.replaceChildren(root);
    const toast = m => (o.toast ? o.toast(m) : 0), $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
    const off = V.sub(() => { if (!root.isConnected) return off(); if (!V.unlocked() && view !== 'lock') { view = 'lock'; draw(); } });
    const head = (t, back) => `<div class=row>${back ? '<button data-v="list" aria-label="Back">‹ Back</button>' : ''}<h3 class=grow>${t}</h3>${o.close && !back ? '<button data-x>Done</button>' : ''}</div>`;

    async function lockScreen() {
      const fresh = !V.exists();
      root.innerHTML = `${head('Vault')}<div class="card hero">${LOCK}<h3>${fresh ? 'Create your vault' : 'Vault is locked'}</h3>
        <p>${fresh ? 'One master password protects all your logins. It never leaves this device, and nobody — including us — can reset it. Pick something long you will remember.' : 'Enter your master password.'}</p>
        <input id=pw type=password placeholder="Master password" autocomplete="off" style="max-width:320px">${fresh ? '<input id=pw2 type=password placeholder="Repeat it" autocomplete="off" style="max-width:320px"><div id=sb style="width:100%;max-width:320px"></div>' : ''}
        <div class=err id=er>${esc(msg)}</div><button class=p id=go style="min-width:200px">${fresh ? 'Create vault' : 'Unlock'}</button>
        ${!fresh && o.bio && o.bio.on() ? '<button id=bio>Unlock with fingerprint / face</button>' : ''}</div>`;
      const pw = $('#pw'); pw.focus(); const er = t => { $('#er').textContent = t; };
      const sb = $('#sb'); if (sb) pw.oninput = () => { sb.innerHTML = bar(V.strength(pw.value)); };
      const go = async () => { $('#go').disabled = true; er('');
        try { if (fresh) { if (pw.value !== $('#pw2').value) throw new Error('The two passwords don’t match'); await V.create(pw.value); if (o.bio && o.bio.on()) o.bio.enable(pw.value); } else { await V.unlock(pw.value); if (o.bio && o.bio.on()) o.bio.enable(pw.value); }
          msg = ''; view = 'list'; draw(); } catch (e) { er(e.message || 'Couldn’t unlock'); $('#go').disabled = false; } };
      $('#go').onclick = go; root.querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') go(); });
      const bio = $('#bio'); if (bio) bio.onclick = async () => { try { const p = await o.bio.unlock(); if (p) { await V.unlock(p); view = 'list'; draw(); } } catch (e) { er('Couldn’t unlock that way — use your password'); } };
      const x = $('[data-x]'); if (x) x.onclick = () => o.close();
    }

    async function listView() {
      let items = V.all(), mine = o.host ? V.forHost(o.host) : [];
      if (o.readForm && !form) { try { form = JSON.parse(await o.readForm()); } catch { form = { has: false }; } if (!root.isConnected) return; }
      const f = q.toLowerCase(); if (f) items = items.filter(x => (x.host + ' ' + x.name + ' ' + x.user).toLowerCase().includes(f));
      const a = V.audit(), issues = new Set([...a.weak, ...a.reused].map(x => x.id));
      const canFill = form && form.has && mine.length, canSave = form && form.has && form.pass && !mine.some(x => x.user === form.user && x.pass === form.pass);
      root.innerHTML = `${head('Vault')}
        ${canFill ? `<div class=fill><div style="min-width:0"><b>Sign in to ${esc(o.host)}</b><small style="display:block;color:var(--mute)">${esc(mine[0].user || 'saved login')}</small></div><button class=p data-fill="${esc(mine[0].id)}">Fill</button></div>` : ''}
        ${canSave ? `<div class=fill style="background:color-mix(in srgb,#3b82f6 14%,transparent);border-color:#3b82f655"><b>Save this login?<small style="display:block;color:var(--mute);font-weight:500">${esc(form.user || '(no username)')} on ${esc(form.host)}</small></b><button class=p data-save>Save</button></div>` : ''}
        <div class=row><input id=q type=search placeholder="Search ${items.length} login${items.length === 1 ? '' : 's'}" value="${esc(q)}"><button class=p data-v=add>＋ Add</button></div>
        ${items.length ? `<div class=card>${items.slice(0, 300).map(x => `<div class=it data-id="${esc(x.id)}"><i class=fav style="background:${hue(x.host)}">${esc(x.host[0] || '?')}</i><div><b>${esc(x.name || x.host)}</b><small>${esc(x.user || '—')} · ${esc(x.host)}</small></div>${issues.has(x.id) ? '<span class=tag>Fix</span>' : ''}</div>`).join('')}</div>`
          : `<div class="card hero">${LOCK}<p>${f ? 'Nothing matches.' : 'No logins yet. Add one, save one when you sign in to a site, or bring them over from another browser.'}</p></div>`}
        <div class=seg><button data-v=audit>Health check${a.weak.length + a.reused.length ? ` · ${a.weak.length + a.reused.length}` : ''}</button><button data-v=import>Import</button><button data-v=export>Export</button><button data-v=gen>Generator</button><button data-lock>Lock</button></div>`;
      const qi = $('#q'); qi.oninput = () => { q = qi.value; const p = qi.selectionStart; listView().then(() => { const n = $('#q'); if (n) { n.focus(); n.setSelectionRange(p, p); } }); };
      $$('.it').forEach(r => r.onclick = () => { sel = r.dataset.id; view = 'item'; draw(); });
      const fl = $('[data-fill]'); if (fl) fl.onclick = () => { const it = V.all().find(x => x.id === fl.dataset.fill); if (it && o.fill) { o.fill(it); toast('Filled'); } };
      const sv = $('[data-save]'); if (sv) sv.onclick = async () => { await V.add({ host: form.host, user: form.user, pass: form.pass }); form = null; toast('Saved to vault'); draw(); };
      const lk = $('[data-lock]'); if (lk) lk.onclick = () => V.lock();
      const x = $('[data-x]'); if (x) x.onclick = () => o.close();
    }

    function itemView() {
      const it = V.all().find(x => x.id === sel); if (!it) { view = 'list'; return draw(); } let shown = false;
      const s = V.strength(it.pass), dupe = V.all().filter(x => x.pass === it.pass && x.id !== it.id).length;
      root.innerHTML = `${head(esc(it.name || it.host), true)}<div class="card" style="padding:16px;display:grid;gap:14px">
        <div><label>Website</label><div class=row><span class=grow>${esc(it.host)}</span><button data-open>Open</button></div></div>
        <div><label>Username</label><div class=row><span class=grow style="word-break:break-all;user-select:text">${esc(it.user || '—')}</span><button data-cu>Copy</button></div></div>
        <div><label>Password</label><div class=row><span class="pw grow" id=pv>••••••••••••</span><button id=sh>Show</button><button data-cp>Copy</button></div>${bar(s)}<small style="color:var(--mute)">${['Very weak', 'Weak', 'OK', 'Strong', 'Very strong'][s]}${dupe ? ` · used on ${dupe} other site${dupe > 1 ? 's' : ''}` : ''}</small></div>
        ${it.note ? `<div><label>Note</label><div style="white-space:pre-wrap;user-select:text">${esc(it.note)}</div></div>` : ''}
        <small style="color:var(--mute)">Changed ${new Date(it.u || it.t).toLocaleDateString()}</small></div>
        <div class=row>${o.fill && o.host && V.forHost(o.host).some(x => x.id === it.id) ? '<button class=p data-fillnow>Fill in page</button>' : ''}<button data-edit>Edit</button><button data-pwn>Check for breaches</button><button class=d data-del>Delete</button></div><div class=err id=er></div>`;
      $('#sh').onclick = () => { shown = !shown; $('#pv').textContent = shown ? it.pass : '••••••••••••'; $('#sh').textContent = shown ? 'Hide' : 'Show'; };
      $('[data-cu]').onclick = () => { o.copy && o.copy(it.user); toast('Username copied'); }; $('[data-cp]').onclick = () => { o.copy && o.copy(it.pass); toast('Password copied'); };
      $('[data-open]').onclick = () => o.openUrl && o.openUrl('https://' + it.host); const fn = $('[data-fillnow]'); if (fn) fn.onclick = () => { o.fill(it); toast('Filled'); o.close && o.close(); };
      $('[data-edit]').onclick = () => { view = 'add'; draw(); };
      $('[data-del]').onclick = async function () { if (this.dataset.sure) { await V.remove(it.id); sel = null; view = 'list'; draw(); } else { this.dataset.sure = 1; this.textContent = 'Tap again to delete'; } };
      $('[data-pwn]').onclick = async () => { if (!o.range) return; $('#er').style.color = 'var(--mute)'; $('#er').textContent = 'Checking…';
        try { const n = await V.pwned(it.pass, o.range); $('#er').style.color = n ? '#ef4444' : '#16a34a'; $('#er').textContent = n ? `Found in ${n.toLocaleString()} known breaches — change it.` : 'Not found in known breaches.'; } catch { $('#er').style.color = '#ef4444'; $('#er').textContent = 'Couldn’t check right now.'; } };
    }

    function addView() {
      const it = sel && V.all().find(x => x.id === sel) || {}; const editing = !!it.id; let len = 20;
      root.innerHTML = `${head(editing ? 'Edit login' : 'Add login', true)}<div class="card" style="padding:16px;display:grid;gap:12px">
        <div><label>Website</label><input id=h value="${esc(it.host || (o.host || ''))}" placeholder="example.com" autocapitalize=none></div>
        <div><label>Username or email</label><input id=u value="${esc(it.user || (form && form.user) || '')}" autocapitalize=none autocomplete=off></div>
        <div><label>Password</label><div class=row><input id=p value="${esc(it.pass || '')}" autocomplete=off autocapitalize=none><button id=g>Generate</button></div><div id=sb style="margin-top:6px">${bar(V.strength(it.pass || ''))}</div></div>
        <div><label>Note (optional)</label><textarea id=n rows=2>${esc(it.note || '')}</textarea></div></div><div class=err id=er></div><div class=row><button class=p id=ok>${editing ? 'Save changes' : 'Add to vault'}</button></div>`;
      const p = $('#p'); p.oninput = () => { $('#sb').innerHTML = bar(V.strength(p.value)); }; $('#g').onclick = () => { p.value = V.generate({ len }); p.oninput(); };
      $('#ok').onclick = async () => { try { const o2 = { host: $('#h').value.trim(), user: $('#u').value.trim(), pass: p.value, note: $('#n').value };
        if (editing) await V.update(it.id, o2); else await V.add(o2); toast('Saved'); view = editing ? 'item' : 'list'; draw(); } catch (e) { $('#er').textContent = e.message; } };
    }

    function genView() {
      let st = { len: 20, lower: true, upper: true, digits: true, symbols: true, readable: false }, cur = V.generate(st);
      const paint = () => { root.innerHTML = `${head('Password generator', true)}<div class="card" style="padding:16px;display:grid;gap:12px"><div class=pw id=out>${esc(cur)}</div>${bar(V.strength(cur))}
        <div class=row><button class=p id=cp>Copy</button><button id=again>New one</button></div><div><label>Length: ${st.len}</label><input id=len type=range min=8 max=64 value=${st.len}></div>
        <div class=seg>${[['lower', 'abc'], ['upper', 'ABC'], ['digits', '123'], ['symbols', '#$%'], ['readable', 'No lookalikes']].map(([k, l]) => `<button data-k=${k} class="${st[k] ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
        $('#cp').onclick = () => { o.copy && o.copy(cur); toast('Copied'); }; $('#again').onclick = () => { cur = V.generate(st); paint(); };
        $('#len').oninput = e => { st.len = +e.target.value; cur = V.generate(st); paint(); }; $$('[data-k]').forEach(b => b.onclick = () => { st[b.dataset.k] = !st[b.dataset.k]; cur = V.generate(st); paint(); }); };
      paint();
    }

    function auditView() {
      const a = V.audit(), list = (t, arr, tag) => arr.length ? `<div><label>${t} · ${arr.length}</label><div class=card>${arr.slice(0, 50).map(x => `<div class=it data-id="${esc(x.id)}"><i class=fav style="background:${hue(x.host)}">${esc(x.host[0] || '?')}</i><div><b>${esc(x.name || x.host)}</b><small>${esc(x.user || '—')}</small></div><span class="tag ${tag || ''}">${t}</span></div>`).join('')}</div></div>` : '';
      const n = V.all().length, bad = new Set([...a.weak, ...a.reused].map(x => x.id)).size;
      root.innerHTML = `${head('Health check', true)}<div class=stat><div><b>${n}</b><small>Logins</small></div><div><b style="color:${bad ? '#ef4444' : '#16a34a'}">${bad}</b><small>Need attention</small></div><div><b>${a.old.length}</b><small>Over a year old</small></div></div>
        ${list('Weak', a.weak)}${list('Reused', a.reused)}${list('Old', a.old, 'o')}${!bad && !a.old.length ? '<div class="card hero"><p>Everything looks good.</p></div>' : ''}
        ${o.range && n ? '<div class=row><button id=scan>Scan all for breaches</button><small style="color:var(--mute);flex:1">Sends only a short, anonymous piece of each password’s fingerprint. Never the password.</small></div><div id=res></div>' : ''}`;
      $$('.it').forEach(r => r.onclick = () => { sel = r.dataset.id; view = 'item'; draw(); });
      const sc = $('#scan'); if (sc) sc.onclick = async () => { sc.disabled = true; const hits = []; let i = 0; for (const x of V.all()) { if (!x.pass) continue; $('#res').textContent = `Checking ${++i} of ${n}…`; try { const c = await V.pwned(x.pass, o.range); if (c) hits.push([x, c]); } catch { $('#res').textContent = 'Couldn’t reach the check service.'; sc.disabled = false; return; } }
        $('#res').innerHTML = hits.length ? `<div class=card>${hits.map(([x, c]) => `<div class=it data-id="${esc(x.id)}"><div><b>${esc(x.name || x.host)}</b><small>Found in ${c.toLocaleString()} breaches</small></div><span class=tag>Change</span></div>`).join('')}</div>` : '<p>None of your passwords were found in known breaches.</p>';
        $$('#res .it').forEach(r => r.onclick = () => { sel = r.dataset.id; view = 'item'; draw(); }); sc.disabled = false; };
    }

    function exportView() {
      root.innerHTML = `${head('Export', true)}<div class="card" style="padding:16px;display:grid;gap:10px"><p>This makes a plain, <b>unencrypted</b> CSV of every login so you can move to another app. Anyone who gets the file can read your passwords — delete it when you’re done.</p><button class=p id=cp>Copy as CSV</button></div>`;
      $('#cp').onclick = () => { o.copy && o.copy(V.exportCsv()); toast('Copied — paste it somewhere safe, then clear your clipboard'); };
    }

    function importView() {
      let res = null;
      const paint = () => { root.innerHTML = `${head('Bring your stuff over', true)}<div class="card" style="padding:16px;display:grid;gap:12px">
        <p>Export from your old browser or password manager, then pick the file here. Hush understands bookmark files (.html, Firefox .json) and saved-login files (.csv) from Chrome, Edge, Brave, Firefox, Safari, Bitwarden, 1Password and LastPass.</p>
        <div class=row><label class=btn style="all:unset;cursor:pointer;padding:10px 16px;border-radius:99px;font:600 13.5px system-ui;background:var(--ink,#161616);color:var(--bg,#f5f5f4)">Choose file…<input id=f type=file multiple accept=".html,.htm,.csv,.json,text/*" style="display:none"></label></div>
        <div><label>…or paste the file’s contents</label><textarea id=t rows=4 placeholder="Paste here"></textarea><div class=row style="margin-top:8px"><button id=pp>Read pasted text</button></div></div>
        <details><summary style="cursor:pointer;color:var(--mute)">Where do I find the export?</summary><p style="margin-top:8px">Chrome / Edge / Brave: Settings → Passwords → ⋮ → Export; bookmarks via the Bookmark manager → ⋮ → Export.<br>Firefox: Passwords → ⋯ → Export; Bookmarks → Manage → Import and Backup → Export to HTML.<br>Safari: File → Export → Passwords / Bookmarks.<br>Bitwarden, 1Password, LastPass: export as CSV from their settings.</p></details></div>
        ${res ? `<div class="card" style="padding:16px;display:grid;gap:10px"><b>${res.bookmarks.length} bookmark${res.bookmarks.length === 1 ? '' : 's'} · ${res.logins.length} login${res.logins.length === 1 ? '' : 's'} found</b>
          ${res.unknown ? '<p>Some files weren’t recognized and were skipped.</p>' : ''}<div class=row>${res.bookmarks.length ? '<button class=p id=ib>Add bookmarks</button>' : ''}${res.logins.length ? '<button class=p id=il>Add logins to vault</button>' : ''}</div><div class=err id=er style="color:#16a34a"></div></div>` : ''}`;
        const take = (list) => { res = { bookmarks: [], logins: [], unknown: 0 }; for (const [t, n] of list) { const r = I.parse(t, n); if (r.kind === 'unknown') res.unknown++; res.bookmarks.push(...r.bookmarks); res.logins.push(...r.logins); } paint(); };
        $('#f').onchange = async e => { const out = []; for (const f of e.target.files) { if (f.size > 30e6) continue; out.push([await f.text(), f.name]); } take(out); };
        $('#pp').onclick = () => take([[$('#t').value, '']]);
        const ib = $('#ib'); if (ib) ib.onclick = async () => { const n = o.bookmarks ? await o.bookmarks(res.bookmarks) : 0; $('#er').textContent = `Added ${n} new bookmark${n === 1 ? '' : 's'}.`; ib.disabled = true; };
        const il = $('#il'); if (il) il.onclick = async () => { const r = await V.addMany(res.logins); $('#er').textContent = `Added ${r.added} login${r.added === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} already there` : ''}. Delete the CSV file now — it holds your passwords in plain text.`; il.disabled = true; }; };
      paint();
    }

    async function draw() {
      if (!V.exists() || !V.unlocked()) { view = 'lock'; return lockScreen(); }
      if (view === 'lock') view = 'list';
      await ({ list: listView, item: itemView, add: addView, gen: genView, audit: auditView, export: exportView, import: importView }[view] || listView)();
    }
    root.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-v]'); if (!b) return; const v = b.dataset.v; if (v === 'add') sel = null; view = v; if (v === 'list') form = null; draw(); });
    draw();
    root.addEventListener('pointerdown', () => { if (V.unlocked()) V.idle(5 * 60e3); }, true);
  }
  G.HXVUI = { open };
})(window);
