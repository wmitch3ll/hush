// Hush Memory: a private "second brain" of the pages you read. Optional (off until you turn it on), stored only on this device
// (IndexedDB), never in private or Tor tabs, never on login / banking / health / mail pages. Search it, or ask your AI a question about it.
// HXBR.open(el, A): A = { pref, setPref, ask?(prompt,on), open(url), toast, close?, count? }.  HXBR.seen(tab, A): call when a page finishes loading.
(function (G) {
  const DB = 'hush-brain', MAX = 2500, KEEP = 7000;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const idb = () => new Promise((res, rej) => { try { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('p', { keyPath: 'url' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } });
  const tx = async (mode, f) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('p', mode), s = t.objectStore('p'); let out; try { out = f(s); } catch (e) { rej(e); return; } t.oncomplete = () => { db.close(); res(out && out.result !== undefined ? out.result : out); }; t.onerror = () => { db.close(); rej(t.error); }; }); };
  const all = () => tx('readonly', s => s.getAll());
  const put = d => tx('readwrite', s => s.put(d));
  const del = url => tx('readwrite', s => s.delete(url));
  const clear = () => tx('readwrite', s => s.clear());
  const STOP = new Set('the a an and or of to in on for with is are was were be it this that as at by from you your i we our they their not but if so do does did have has had can will just about into than then there what which who how when where why'.split(' '));
  const toks = q => String(q).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)?.filter(w => !STOP.has(w)) || [];
  const SKIP_HOST = /(^|\.)(bank|banks|chase|wellsfargo|bankofamerica|citi|capitalone|paypal|venmo|mychart|health|patient|irs|ssa|login|accounts|auth|mail|outlook|gmail|proton|icloud|1password|bitwarden|lastpass)\b|bank|clinic|hospital|medical|insurance|payroll|tax/i;
  const skipUrl = u => { try { const x = new URL(u); return x.protocol !== 'https:' || SKIP_HOST.test(x.hostname) || /\/(login|signin|sign-in|logout|checkout|cart|payment|account|settings|password|reset)(\/|$|\?)/i.test(x.pathname); } catch { return true; } };
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

  /** Rank saved pages for a query (title/host hits weigh most, rarer words count more, newer pages get a small nudge). */
  function rank(docs, q, limit) { const t = [...new Set(toks(q))]; if (!t.length) return []; const N = docs.length || 1, df = {}; for (const d of docs) for (const w of t) if (d.l.includes(w) || d.ti.includes(w)) df[w] = (df[w] || 0) + 1;
    const out = []; for (const d of docs) { let s = 0, hit = 0; for (const w of t) { const idf = Math.log(1 + N / (1 + (df[w] || 0))); let c = 0, i = -1; while ((i = d.l.indexOf(w, i + 1)) >= 0 && c < 8) c++;
        const sc = (d.ti.includes(w) ? 5 : 0) + (d.host.includes(w) ? 3 : 0) + c; if (sc) { hit++; s += sc * idf; } }
      if (!hit) continue; s *= 0.6 + 0.4 * hit / t.length; if (hit === t.length) s *= 1.4; s *= 1 + Math.max(0, 1 - (Date.now() - d.t) / (90 * 864e5)) * 0.15; out.push({ d, s }); }
    return out.sort((a, b) => b.s - a.s).slice(0, limit || 20).map(x => x.d); }
  const snippet = (d, q) => { const t = toks(q); let at = -1; for (const w of t) { const i = d.l.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; } const from = Math.max(0, (at < 0 ? 0 : at) - 60); return (from ? '…' : '') + d.text.slice(from, from + 220) + '…'; };
  async function save(rec) { const l = rec.text.toLowerCase(), d = { url: rec.url, host: rec.host, title: rec.title.slice(0, 160), ti: rec.title.toLowerCase(), text: rec.text.slice(0, KEEP), l: l.slice(0, KEEP), t: Date.now() };
    await put(d); const docs = await all(); if (docs.length > MAX) { docs.sort((a, b) => a.t - b.t); for (const x of docs.slice(0, docs.length - MAX + 100)) await del(x.url); } return d; }

  // ---------- capture ----------
  const seenAt = {}; let pend = 0;
  /** A.on(): memory is on.  A.read(): Promise<{text, title, hasPassword}> for the page in front.  A.current(): {url, priv, tor} of the active tab. */
  function seen(url, A) { clearTimeout(pend); if (!A.on() || skipUrl(url)) return; const h = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })(); if ((A.blocked() || []).includes(h)) return;
    if (Date.now() - (seenAt[url] || 0) < 6 * 3600e3) return;
    pend = setTimeout(async () => { try { const c = A.current(); if (!c || c.priv || c.tor || c.url !== url) return; const r = await A.read(); if (!r || r.hasPassword) return; const text = clean(r.text); if (text.length < 400) return;
        seenAt[url] = Date.now(); await save({ url: url.split('#')[0], host: h, title: clean(r.title) || h, text }); A.saved && A.saved(); } catch {} }, 9000); }

  const CSS = `.br{display:grid;gap:12px;font:14px/1.45 system-ui,sans-serif;color:var(--ink,#161616);max-width:680px;margin:0 auto;width:100%}.br *{box-sizing:border-box}.br h3{margin:0;font:700 22px system-ui;letter-spacing:-.02em}.br p{margin:0;color:var(--mute,#8b8b88)}
.br .row{display:flex;gap:8px;align-items:center}.br .grow{flex:1}.br button{all:unset;cursor:pointer;padding:9px 15px;border-radius:99px;font:600 13px system-ui;background:color-mix(in srgb,var(--ink,#161616) 10%,transparent)}.br button.p{background:var(--ink,#161616);color:var(--bg,#f5f5f4)}.br button.d{color:#ef4444}
.br input[type=search]{width:100%;padding:12px 15px;border-radius:14px;border:1px solid var(--line,#e4e4e2);background:var(--card,#fff);color:inherit;font:16px system-ui;outline:none;user-select:text}
.br .r{padding:12px 14px;border-radius:14px;background:var(--card,#fff);border:1px solid var(--line,#e4e4e2);cursor:pointer;display:grid;gap:3px}.br .r b{font:600 14.5px/1.3 system-ui}.br .r small{color:var(--mute,#8b8b88);font-size:12px}.br .r span{font-size:13px;color:var(--mute,#8b8b88)}
.br .ai{padding:14px;border-radius:16px;background:color-mix(in srgb,#8b5cf6 12%,transparent);white-space:pre-wrap;user-select:text}.br .card{padding:16px;border-radius:18px;background:var(--card,#fff);border:1px solid var(--line,#e4e4e2);display:grid;gap:10px}.br mark{background:#facc1566;color:inherit;border-radius:3px}`;
  function open(el, A) {
    if (!document.getElementById('br-css')) { const s = document.createElement('style'); s.id = 'br-css'; s.textContent = CSS; document.head.append(s); }
    const root = document.createElement('div'); root.className = 'br'; el.replaceChildren(root); let docs = [], q = '', hits = [], view = 'main', aiTxt = '', busy = false;
    const on = () => A.pref('brain') === 'on';
    const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? Math.max(1, m) + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
    const hl = (s) => { let o = esc(s); for (const w of toks(q)) o = o.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>'); return o; };
    function paint() { if (!root.isConnected) return;
      if (view === 'settings') { root.innerHTML = `<div class=row><h3 class=grow>Memory settings</h3><button data-v=main>Back</button></div><div class=card><div class=row><b class=grow>Remember pages I read</b><button class="${on() ? 'p' : ''}" data-tog>${on() ? 'On' : 'Off'}</button></div>
          <p>Pages are saved only on this device. Never in private or Tor tabs, never on https-less sites, and never on login, banking, health, mail or checkout pages. Only the text is kept, trimmed to the first few paragraphs.</p><p>${docs.length} page${docs.length === 1 ? '' : 's'} remembered.</p></div>
          <div class=card><b>Never remember these sites</b><input type=search id=bl placeholder="example.com, another.com" value="${esc((A.pref('brain_skip') || ''))}"><div class=row><button data-savebl>Save</button></div></div>
          <div class=row><button class=d data-clear>Forget everything</button></div>`;
        root.querySelector('[data-tog]').onclick = async () => { await A.setPref('brain', on() ? 'off' : 'on'); A.toast && A.toast(on() ? 'Memory is on' : 'Memory is off'); paint(); };
        root.querySelector('[data-savebl]').onclick = async () => { await A.setPref('brain_skip', root.querySelector('#bl').value.trim()); A.toast && A.toast('Saved'); };
        root.querySelector('[data-clear]').onclick = async function () { if (!this.dataset.s) { this.dataset.s = 1; this.textContent = 'Tap again to forget all ' + docs.length; return; } await clear(); docs = []; hits = []; A.toast && A.toast('Memory cleared'); view = 'main'; paint(); };
        root.querySelector('[data-v]').onclick = () => { view = 'main'; paint(); }; return; }
      root.innerHTML = `<div class=row><h3 class=grow>Memory</h3><button data-v=settings>${on() ? 'On' : 'Off'} · Settings</button>${A.close ? '<button data-x>Done</button>' : ''}</div>
        <input type=search id=q placeholder="Search everything you’ve read…" value="${esc(q)}" autocomplete=off>
        ${!on() && !docs.length ? '<div class=card><b>Your private second brain</b><p>Turn Memory on and Hush remembers the pages you read — only on this device. Later, search them or ask your AI things like “what was that article about the stadium vote?”</p><button class=p data-tog>Turn on Memory</button></div>' : ''}
        ${q && A.ask && hits.length ? `<div class=row><button class=p data-ask ${busy ? 'disabled' : ''}>Ask ${esc(A.aiName || 'your AI')} about this</button></div>` : ''}${aiTxt ? `<div class=ai>${esc(aiTxt)}</div>` : ''}
        ${q ? (hits.length ? hits.map((d, i) => `<div class=r data-u="${esc(d.url)}"><small>${esc(d.host)} · ${ago(d.t)}</small><b>${hl(d.title)}</b><span>${hl(snippet(d, q))}</span></div>`).join('') : '<p>Nothing in your memory matches that.</p>') : (docs.length ? `<p>${docs.length} page${docs.length === 1 ? '' : 's'} remembered. Type to search them.</p>` + docs.slice().sort((a, b) => b.t - a.t).slice(0, 8).map(d => `<div class=r data-u="${esc(d.url)}"><small>${esc(d.host)} · ${ago(d.t)}</small><b>${esc(d.title)}</b></div>`).join('') : '')}`;
      const qi = root.querySelector('#q'); qi.oninput = () => { q = qi.value; aiTxt = ''; hits = rank(docs, q, 20); const p = qi.selectionStart; paint(); const n = root.querySelector('#q'); n.focus(); n.setSelectionRange(p, p); };
      root.querySelectorAll('[data-u]').forEach(r => r.onclick = () => A.open(r.dataset.u)); const x = root.querySelector('[data-x]'); if (x) x.onclick = () => A.close(); const v = root.querySelector('[data-v]'); if (v) v.onclick = () => { view = v.dataset.v; paint(); };
      const tg = root.querySelector('[data-tog]'); if (tg) tg.onclick = async () => { await A.setPref('brain', 'on'); A.toast && A.toast('Memory is on — pages you read will be remembered'); paint(); };
      const ak = root.querySelector('[data-ask]'); if (ak) ak.onclick = async () => { busy = true; aiTxt = 'Reading your notes…'; paint(); const top = hits.slice(0, 4);
        const ctx = top.map((d, i) => `[${i + 1}] ${d.title} (${d.host})\n${d.text.slice(0, 1400)}`).join('\n\n');
        try { await A.ask(`Answer the question using ONLY these pages the user read earlier. Cite sources like [1]. If the answer isn't in them, say so.\n\n${ctx}\n\nQuestion: ${q}`, t => { aiTxt = t; paint(); }); aiTxt = aiTxt.replace(/^Reading your notes…$/, ''); } catch (e) { aiTxt = String(e && e.message || e); } busy = false; paint(); }; }
    all().then(d => { docs = d; paint(); }).catch(() => { paint(); }); paint();
  }
  G.HXBR = { open, seen, rank, save, all, clear, skipUrl, toks, _put: put };
})(window);
