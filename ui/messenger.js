// Hush Messenger — private chat between Hush users, built on Nostr private messages (NIP-17 / NIP-44 / NIP-59).
// Every relay connection goes through Tor (Rust: msg_ws_*), there is no direct fallback.
// Messages are end-to-end encrypted, sealed and gift-wrapped: relays see an encrypted blob addressed to a random-looking
// key, never the sender, never the text, never your IP. Keys, contacts and messages stay on this device.
// Chats are keyed by the other participants' public keys (one key = 1:1 chat, several keys joined by "," = group).
// Photos and files travel as encrypted chunks inside ordinary private messages, so they work on any relay (no upload server).
// Shared by desktop (index.html) and Android (mobile.html). A = { inv, listen, toast, mobile, open(url), page(), badge(n), qr(text), close(), saveImage?(dataUrl) }
window.HushMsg = function (A) {
  const N = window.NostrTools;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = { get(k, d) { try { const v = localStorage.getItem('hush.msg.' + k); return v == null ? d : JSON.parse(v) } catch { return d } },
               set(k, v) { try { localStorage.setItem('hush.msg.' + k, JSON.stringify(v)) } catch (e) { A.toast('Storage is full — delete some old chats'); } } };
  const RELAYS_DEFAULT = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://offchain.pub'];
  const REACT = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
  const K_TYPING = 20014, K_READ = 20015;        // Hush-only signals, sent inside the same encrypted gift wraps
  const CHUNK = 24000, MAX_FILE = 3 * 1024 * 1024;
  const hex = N ? N.bytesToHex : null, unhex = N ? N.hexToBytes : null;
  const now = () => Math.floor(Date.now() / 1000);

  // ---------------------------------------------------------------- files (IndexedDB: blobs don't fit in localStorage)
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open('hush-msg', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('files'); r.result.createObjectStore('chunks'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const idb = async (store, mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
  const putFile = (id, blob) => idb('files', 'readwrite', s => s.put(blob, id));
  const getFile = id => idb('files', 'readonly', s => s.get(id));
  const urls = {};
  async function fileUrl(id) { if (urls[id]) return urls[id]; const b = await getFile(id).catch(() => null); return b ? (urls[id] = URL.createObjectURL(b)) : null; }

  // ---------------------------------------------------------------- identity & data
  let sk = null, me = '';
  const relays = () => LS.get('relays', RELAYS_DEFAULT);
  const contacts = () => LS.get('contacts', {});
  const chats = () => LS.get('chats', {});
  const groups = () => LS.get('groups', {});
  const profile = () => LS.get('profile', { name: '' });
  const prefs = () => LS.get('prefs', { receipts: true, typing: true });
  function loadKey() { const k = LS.get('key', ''); if (k && /^[0-9a-f]{64}$/.test(k)) { sk = unhex(k); me = N.getPublicKey(sk); } return !!sk; }
  function createKey() { sk = N.generateSecretKey(); me = N.getPublicKey(sk); LS.set('key', hex(sk)); LS.set('since', now() - 3 * 86400); }
  const npub = pk => { try { return N.nip19.npubEncode(pk); } catch { return pk; } };
  const parseId = s => { s = String(s || '').trim().replace(/^(nostr:|hush:\/\/add#?|hush:add#?)/i, '');
    if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
    try { const d = N.nip19.decode(s); if (d.type === 'npub') return d.data; if (d.type === 'nprofile') return d.data.pubkey; } catch {} return null; };
  const members = key => key.split(',').filter(Boolean);
  const isGroup = key => key.includes(',');
  const keyOf = pks => [...new Set(pks)].filter(p => p && p !== me).sort().join(',');
  const nameOf = pk => (contacts()[pk] || {}).name || ('Hush user ' + npub(pk).slice(5, 11));
  const first = pk => nameOf(pk).split(/\s+/)[0];
  const chatName = key => isGroup(key) ? (groups()[key]?.name || members(key).map(first).join(', ')) : nameOf(key);
  const colorOf = k => `hsl(${parseInt(k.replace(/,/g, '').slice(0, 6), 16) % 360} 55% 48%)`;
  const initials = n => (n.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || '?').toUpperCase();

  // ---------------------------------------------------------------- network (relays over Tor)
  const conns = {}, byId = {}, pending = {};
  let status = 'off', started = false;
  const okRelays = () => Object.values(conns).filter(c => c.open).length;
  function setStatus(s) { status = s; paintStatus(); }
  function start() {
    if (started || !sk) return; started = true; setStatus('connecting');
    A.listen('msg-ws', ({ payload: p }) => onWs(p));
    for (const u of relays()) openRelay(u);
  }
  async function openRelay(u, wait = 0) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    if (!sk) return;
    try { const id = await A.inv('msg_ws_open', { url: u }); conns[u] = { id, open: false, queue: conns[u]?.queue || [], tries: conns[u]?.tries || 0 }; byId[id] = u; }
    catch (e) { setStatus(okRelays() ? 'on' : 'error:' + e); retry(u); }
  }
  function retry(u) { const c = conns[u] || (conns[u] = { queue: [], tries: 0 }); c.open = false; c.tries = (c.tries || 0) + 1;
    openRelay(u, Math.min(120000, 3000 * 2 ** Math.min(c.tries, 5))); }
  const send = (u, msg) => { const c = conns[u]; if (!c) return; if (c.open) A.inv('msg_ws_send', { id: c.id, data: JSON.stringify(msg) }).catch(() => {}); else if (c.queue.length < 400) c.queue.push(msg); };
  function onWs(p) {
    const u = byId[p.id]; if (!u) return; const c = conns[u];
    if (p.t === 'open') { c.open = true; c.tries = 0; setStatus('on');
      send(u, ['REQ', 'hush', { kinds: [1059], '#p': [me], since: LS.get('since', 0) - 2 * 86400 }]);
      c.queue.splice(0).forEach(m => send(u, m)); }
    else if (p.t === 'close') { delete byId[p.id]; if (!okRelays()) setStatus(p.d ? 'error:' + p.d : 'connecting'); retry(u); }
    else if (p.t === 'msg') { let m; try { m = JSON.parse(p.d); } catch { return; }
      if (m[0] === 'EVENT' && m[2]) receive(m[2]);
      else if (m[0] === 'OK' && pending[m[1]] && m[2]) { const { chat, msgId } = pending[m[1]]; delete pending[m[1]]; mark(chat, msgId, 'sent'); } }
  }

  // ---------------------------------------------------------------- receive
  const seen = new Set(LS.get('seen', []));
  const typing = {};   // chatKey -> {pk: until}
  function receive(wrap) {
    if (!wrap || wrap.kind !== 1059 || seen.has(wrap.id)) return; seen.add(wrap.id);
    if (seen.size % 25 === 0) LS.set('seen', [...seen].slice(-8000));
    let r; try { if (!N.verifyEvent(wrap)) return; r = N.nip59.unwrapEvent(wrap, sk); } catch { return; }
    const ps = r.tags.filter(t => t[0] === 'p').map(t => t[1]).filter(p => /^[0-9a-f]{64}$/.test(p));
    const key = keyOf([r.pubkey, ...ps]); if (!key) return;
    if (members(key).some(pk => contacts()[pk]?.blocked) && !isGroup(key)) return;
    const mine = r.pubkey === me, tag = n => (r.tags.find(t => t[0] === n) || []);
    const subject = tag('subject')[1];
    if (isGroup(key) && subject) { const g = groups(); if (g[key]?.name !== subject.slice(0, 60)) { g[key] = { ...(g[key] || {}), name: subject.slice(0, 60) }; LS.set('groups', g); } }
    const nm = tag('hush-name')[1];
    if (nm && !mine) { const c = contacts(); if (!c[r.pubkey]?.named && c[r.pubkey]?.name !== nm.slice(0, 40)) { c[r.pubkey] = { ...(c[r.pubkey] || {}), name: nm.slice(0, 40), added: c[r.pubkey]?.added || Date.now(), ...(c[r.pubkey] ? {} : isGroup(key) ? { auto: true } : { request: true }) }; LS.set('contacts', c); } }
    if (r.kind === K_TYPING) { if (!mine && now() - r.created_at < 20) { (typing[key] = typing[key] || {})[r.pubkey] = Date.now() + 7000; if (view.open && view.chat === key) paintTyping(); setTimeout(() => view.open && view.chat === key && paintTyping(), 7100); } return; }
    const all = chats(), list = all[key] || (all[key] = []);
    if (r.kind === K_READ) { if (mine) return; const upto = r.content; const i = list.findIndex(m => m.id === upto); if (i < 0) return;
      for (let j = 0; j <= i; j++) if (list[j].from === 'me') { list[j].read = [...new Set([...(list[j].read || []), r.pubkey])]; }
      if (typing[key]) delete typing[key][r.pubkey];
      all[key] = list; LS.set('chats', all); if (view.open && view.chat === key) repaint(); return; }
    if (r.kind === 14) {
      const f = tag('hush-file');
      if (f.length) return receiveChunk(key, r, f);
      if (list.some(x => x.id === r.id)) return;
      list.push({ id: r.id, from: mine ? 'me' : r.pubkey, text: String(r.content).slice(0, 20000), at: r.created_at * 1000, status: 'sent', reply: tag('e')[1] });
      if (typing[key]) delete typing[key][r.pubkey];
      arrived(key, r, list, all, String(r.content));
    } else if (r.kind === 7) {
      const target = tag('e')[1], m = list.find(x => x.id === target); if (!m) return;
      m.react = m.react || {}; const who = mine ? 'me' : r.pubkey;
      for (const k in m.react) m.react[k] = m.react[k].filter(w => w !== who);
      if (r.content) (m.react[r.content] = m.react[r.content] || []).push(who);
      all[key] = list; LS.set('chats', all); if (view.open) repaint();
    }
  }
  function arrived(key, r, list, all, preview) {
    list.sort((a, b) => a.at - b.at); if (list.length > 800) list.splice(0, list.length - 800);
    all[key] = list; LS.set('chats', all);
    if (r.pubkey !== me) {
      const c = contacts(); if (!isGroup(key) && !c[key]) { c[key] = { name: nameOf(key), added: Date.now(), request: true }; LS.set('contacts', c); }
      if (view.open && view.chat === key && document.visibilityState !== 'hidden') sendRead(key);
      else { const un = LS.get('unread', {}); un[key] = (un[key] || 0) + 1; LS.set('unread', un);
        A.toast('💬 ' + (isGroup(key) ? chatName(key) + ' · ' + first(r.pubkey) : nameOf(r.pubkey)) + ': ' + preview.slice(0, 60)); }
    }
    LS.set('since', Math.max(LS.get('since', 0), Math.min(now(), r.created_at)));
    badge(); if (view.open) repaint();
  }
  // File chunks: ["hush-file", id, index, total, mime, name, size]. The message appears at once and fills in as chunks
  // arrive; chunks are kept in IndexedDB so a transfer survives restarts. Both sides use id "f<fileid>" for replies/reactions.
  async function receiveChunk(key, r, f) {
    const [, fid, idx, total, mime, name, size] = f; const i = +idx, n = +total;
    if (!/^[0-9a-f]{16,64}$/.test(fid) || !(n > 0 && n <= 200) || !(i >= 0 && i < n)) return;
    await idb('chunks', 'readwrite', s => s.put(r.content, fid + ':' + i)).catch(() => {});
    const all = chats(), list = all[key] || (all[key] = []);
    let m = list.find(x => x.file?.id === fid);
    if (!m) { m = { id: 'f' + fid, from: r.pubkey === me ? 'me' : r.pubkey, text: '', at: r.created_at * 1000, status: 'sent', reply: (r.tags.find(t => t[0] === 'e') || [])[1],
      file: { id: fid, mime: String(mime).slice(0, 80), name: String(name).slice(0, 120), size: +size || 0, got: 0, total: n, have: [] } }; list.push(m); }
    if (m.file.done) return;
    m.file.have = [...new Set([...(m.file.have || []), i])]; m.file.got = m.file.have.length;
    if (m.file.got === n) {
      try { const ps = []; for (let j = 0; j < n; j++) ps.push(await idb('chunks', 'readonly', s => s.get(fid + ':' + j)));
        const bin = atob(ps.join('')); const u8 = new Uint8Array(bin.length); for (let j = 0; j < bin.length; j++) u8[j] = bin.charCodeAt(j);
        await putFile(fid, new Blob([u8], { type: m.file.mime || 'application/octet-stream' })); m.file.done = true; delete m.file.have;
        for (let j = 0; j < n; j++) idb('chunks', 'readwrite', s => s.delete(fid + ':' + j)).catch(() => {}); } catch (e) { m.file.error = true; }
      arrived(key, r, list, all, m.file.mime.startsWith('image/') ? '📷 Photo' : '📎 ' + m.file.name);
    } else { all[key] = list; LS.set('chats', all); if (view.open && view.chat === key) repaint(); }
  }
  const unreadTotal = () => Object.values(LS.get('unread', {})).reduce((a, b) => a + b, 0);
  const badge = () => A.badge(unreadTotal());

  // ---------------------------------------------------------------- send
  const wrapFor = (rumor, pk) => N.nip59.createWrap(N.nip59.createSeal(rumor, sk, pk), pk);
  function publish(key, kind, content, extra = [], opt = {}) {
    const to = members(key), tags = [...to.map(p => ['p', p]), ...extra];
    if (kind === 14 && profile().name) tags.push(['hush-name', profile().name.slice(0, 40)]);
    if (kind === 14 && isGroup(key) && groups()[key]?.name) tags.push(['subject', groups()[key].name]);
    const rumor = N.nip59.createRumor({ kind, content, tags, created_at: now() }, sk);
    const wraps = to.map(p => wrapFor(rumor, p));
    if (!opt.noSelf) { const w = wrapFor(rumor, me); seen.add(w.id); wraps.push(w); }       // copy for my other devices
    const rs = relays(), spread = opt.spread ? rs.slice(0, opt.spread) : rs;
    for (const w of wraps) for (const u of spread) send(u, ['EVENT', w]);
    return { rumor, wrapId: wraps[0].id };
  }
  function addLocal(key, m, wrapId) {
    const all = chats(), list = all[key] || (all[key] = []); list.push(m); all[key] = list; LS.set('chats', all);
    if (wrapId) { pending[wrapId] = { chat: key, msgId: m.id }; setTimeout(() => { if (pending[wrapId]) mark(key, m.id, 'failed'); }, 60000); }
    repaint();
  }
  function sendText(key, text, reply) {
    text = text.trim(); if (!text) return;
    const { rumor, wrapId } = publish(key, 14, text, reply ? [['e', reply, '', 'reply']] : []);
    addLocal(key, { id: rumor.id, from: 'me', text, at: Date.now(), status: okRelays() ? 'sending' : 'queued', reply }, wrapId);
    lastTypingSent = 0;
  }
  async function sendFile(key, file) {
    let blob = file, mime = file.type || 'application/octet-stream', name = file.name || 'file';
    if (/^image\/(jpeg|png|webp|heic|heif|gif|bmp)$/.test(mime) && mime !== 'image/gif') {       // photos: resized + compressed so they travel fast over Tor
      try { blob = await shrink(file, 1600, 0.78); mime = 'image/jpeg'; name = name.replace(/\.\w+$/, '') + '.jpg'; } catch {} }
    if (blob.size > MAX_FILE) return A.toast('That file is too big — up to 3 MB for now');
    const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(blob); });
    const fid = hex(N.generateSecretKey()).slice(0, 32), n = Math.max(1, Math.ceil(b64.length / CHUNK));
    await putFile(fid, blob);
    const reply = view.reply; view.reply = null;
    const msg = { id: 'f' + fid, from: 'me', text: '', at: Date.now(), status: 'sending', reply, file: { id: fid, mime, name, size: blob.size, got: n, total: n, done: true, sent: 0 } };
    addLocal(key, msg);
    for (let i = 0; i < n; i++) {
      const { wrapId } = publish(key, 14, b64.slice(i * CHUNK, (i + 1) * CHUNK),
        [['hush-file', fid, String(i), String(n), mime, name, String(blob.size)], ...(reply && i === 0 ? [['e', reply, '', 'reply']] : [])], { noSelf: true });
      if (i === n - 1) pending[wrapId] = { chat: key, msgId: msg.id };
      if (i % 4 === 3) await new Promise(r => setTimeout(r, 120));    // don't flood the relays
    }
    setTimeout(() => mark(key, msg.id, okRelays() ? 'sent' : 'queued'), 3000);
  }
  function shrink(file, max, q) { return new Promise((res, rej) => { const img = new Image(); img.onload = () => {
    const s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); c.toBlob(b => b ? res(b) : rej(), 'image/jpeg', q); }; img.onerror = rej; img.src = URL.createObjectURL(file); }); }
  function react(key, m, emoji) {
    const mineR = (m.react || {})[emoji]?.includes('me');
    publish(key, 7, mineR ? '' : emoji, [['e', m.id], ['k', '14']]);
    const all = chats(), x = (all[key] || []).find(y => y.id === m.id); if (!x) return;
    x.react = x.react || {}; for (const k in x.react) x.react[k] = x.react[k].filter(w => w !== 'me');
    if (!mineR) (x.react[emoji] = x.react[emoji] || []).push('me');
    LS.set('chats', all); repaint();
  }
  // Read receipts and typing: small encrypted signals, only to the people in the chat (not to my other devices).
  const lastRead = LS.get('readSent', {});
  function sendRead(key) {
    if (!prefs().receipts) return; const list = chats()[key] || [], last = [...list].reverse().find(m => m.from !== 'me');
    if (!last || lastRead[key] === last.id) return; lastRead[key] = last.id; LS.set('readSent', lastRead);
    publish(key, K_READ, last.id, [], { noSelf: true, spread: 2 });
  }
  let lastTypingSent = 0;
  function sendTyping(key) { if (!prefs().typing || Date.now() - lastTypingSent < 5000) return; lastTypingSent = Date.now(); publish(key, K_TYPING, '', [], { noSelf: true, spread: 2 }); }
  function mark(key, id, st) { const all = chats(), m = (all[key] || []).find(x => x.id === id); if (m && m.status !== 'sent') { m.status = st; LS.set('chats', all); if (view.open) repaint(); } }
  function resend(key, m) { const all = chats(); all[key] = (all[key] || []).filter(x => x.id !== m.id); LS.set('chats', all); if (m.file) { getFile(m.file.id).then(b => b && sendFile(key, new File([b], m.file.name, { type: m.file.mime }))); } else sendText(key, m.text, m.reply); }

  // ---------------------------------------------------------------- UI
  const css = `
.hm{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--ink);font:14px/1.4 ui-sans-serif,system-ui,"Segoe UI",sans-serif}
.hm *{box-sizing:border-box}:where(.hm) button{all:unset;cursor:pointer;box-sizing:border-box}
.hm-h{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line);flex:none}
.hm-h h2{font:600 17px system-ui;margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hm-h small{display:block;font:12px system-ui;color:var(--mute)}
.hm-ib{width:34px;height:34px;border-radius:50%;display:grid!important;place-items:center;color:var(--ink)}.hm-ib:hover{background:var(--card)}
.hm-ib svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.hm-st{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--mute)}.hm-st i{width:7px;height:7px;border-radius:50%;background:#aaa;display:inline-block}
.hm-st.on i{background:#22c55e}.hm-st.connecting i{background:#f59e0b;animation:hmp 1s infinite alternate}.hm-st.error i{background:#ef4444}@keyframes hmp{to{opacity:.3}}
.hm-body{flex:1;overflow:auto;min-height:0}
.hm-av{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;color:#fff;font:600 15px system-ui;flex:none}
.hm-row{display:flex!important;gap:12px;align-items:center;padding:10px 14px;width:100%}.hm-row:hover{background:var(--card)}
.hm-row .t{flex:1;min-width:0}.hm-row b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hm-row span{display:block;color:var(--mute);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hm-row em{font-style:normal;color:var(--mute);font-size:11.5px;text-align:right}.hm-row .u{background:var(--acc);color:var(--bg);border-radius:99px;font:700 11px system-ui;padding:2px 7px;margin-top:4px;display:inline-block}
.hm-search{margin:10px 14px;padding:9px 12px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);width:calc(100% - 28px);font:14px system-ui}
.hm-empty{padding:40px 24px;text-align:center;color:var(--mute)}.hm-empty b{display:block;color:var(--ink);font-size:17px;margin-bottom:6px}
.hm-fab{position:absolute;right:18px;bottom:18px;width:54px;height:54px;border-radius:18px;background:var(--acc);color:var(--bg);display:grid!important;place-items:center;box-shadow:0 8px 24px #0003}
.hm-fab svg{width:24px;height:24px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round}
.hm-msgs{padding:12px 12px 6px;display:flex;flex-direction:column;gap:3px}
.hm-day{align-self:center;font:600 11px system-ui;color:var(--mute);background:var(--card);border:1px solid var(--line);border-radius:99px;padding:3px 10px;margin:10px 0 6px}
.hm-m{max-width:min(78%,560px);padding:8px 12px;border-radius:18px;position:relative;word-wrap:break-word;white-space:pre-wrap;user-select:text}
.hm-m.me{align-self:flex-end;background:var(--acc);color:var(--bg);border-bottom-right-radius:6px}.hm-m.them{align-self:flex-start;background:var(--card);border:1px solid var(--line);border-bottom-left-radius:6px}
.hm-m.me+.hm-m.me{border-top-right-radius:6px}.hm-m.them+.hm-m.them{border-top-left-radius:6px}
.hm-m a{color:inherit;text-decoration:underline}.hm-m .tm{font-size:10.5px;opacity:.7;margin-left:8px;float:right;margin-top:6px;white-space:nowrap}
.hm-m .q{display:block;font-size:12px;opacity:.8;border-left:3px solid currentColor;padding-left:8px;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hm-m .rx{position:absolute;bottom:-12px;right:10px;background:var(--card);border:1px solid var(--line);border-radius:99px;padding:0 6px;font-size:12px;color:var(--ink)}.hm-m.them .rx{right:auto;left:10px}
.hm-m.hasrx{margin-bottom:12px}.hm-m.failed{opacity:.6}
.hm-link{display:block;margin-top:6px;padding:8px 10px;border-radius:10px;background:#0002;font-size:12px;text-decoration:none!important}
.hm-c{flex:none;display:flex;gap:6px;align-items:flex-end;padding:8px 10px;border-top:1px solid var(--line);background:var(--bg)}
.hm-c textarea{flex:1;resize:none;max-height:140px;min-height:40px;padding:10px 14px;border-radius:20px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:14px/1.35 system-ui;outline:none}
.hm-send{width:40px;height:40px;border-radius:50%;background:var(--acc);color:var(--bg);display:grid!important;place-items:center;flex:none}.hm-send svg{width:18px;height:18px;fill:currentColor}
.hm-rep{display:flex;align-items:center;gap:8px;padding:6px 14px;font-size:12px;color:var(--mute);border-top:1px solid var(--line)}.hm-rep span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hm-menu{position:fixed;z-index:60;background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 40px #0004;padding:6px;min-width:190px}
.hm-menu .e{display:flex;gap:2px;padding:4px 4px 6px;border-bottom:1px solid var(--line);margin-bottom:4px}.hm-menu .e button{font-size:21px;padding:4px 6px;border-radius:8px}.hm-menu .e button:hover{background:var(--bg)}
.hm-menu .i{display:block!important;padding:8px 10px;border-radius:8px;width:100%}.hm-menu .i:hover{background:var(--bg)}
.hm-card{margin:14px;padding:16px;border-radius:16px;border:1px solid var(--line);background:var(--card)}
.hm-card h3{margin:0 0 8px;font:600 15px system-ui}.hm-card p{margin:0 0 10px;color:var(--mute);font-size:13px}
.hm-in{width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:14px system-ui;margin:4px 0 10px}
.hm-btn{display:inline-flex!important;align-items:center;gap:6px;padding:9px 16px;border-radius:12px;background:var(--acc);color:var(--bg);font-weight:600}.hm-btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.hm-qr{width:200px;height:200px;margin:8px auto;background:#fff;padding:8px;border-radius:12px}.hm-qr svg{width:100%;height:100%}
.hm-id{font:12px ui-monospace,monospace;word-break:break-all;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px;user-select:all}
.hm-req{margin:10px 12px;padding:12px;border-radius:14px;background:var(--card);border:1px solid var(--line);font-size:13px}
.hm-tor{display:inline-flex;align-items:center;gap:4px;font:600 10.5px system-ui;color:#7c3aed;background:#7c3aed1a;border-radius:99px;padding:2px 8px}`;
  const css2 = `
.hm-img{display:block;width:100%;max-height:340px;object-fit:cover;border-radius:12px;margin:0 0 4px;cursor:zoom-in;background:#0002;min-height:60px}
.hm-m.img{padding:4px;width:min(300px,78%)}.hm-m.img .tm{margin:0 6px 2px}
.hm .hm-send,.hm .hm-send:hover{background:var(--acc);color:var(--bg)}.hm .hm-send svg{fill:currentColor;stroke:none}.hm .hm-fab:hover{background:var(--acc)}.hm .hm-btn:hover{filter:brightness(1.1)}.hm-file{display:flex;gap:10px;align-items:center;min-width:200px;cursor:pointer}.hm-file i{font-style:normal;font-size:26px}
.hm-file b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}.hm-file small{opacity:.75;font-size:11.5px}
.hm-prog{height:4px;border-radius:2px;background:#0003;overflow:hidden;margin-top:4px}.hm-prog i{display:block;height:100%;background:currentColor}
.hm-who{display:block;font:600 11.5px system-ui;margin-bottom:2px}
.hm-seen{align-self:flex-end;font-size:11px;color:var(--mute);margin:2px 4px 0}
.hm-typing{color:var(--acc)!important}.hm-dots{display:inline-flex;gap:3px;margin-left:4px;vertical-align:middle}.hm-dots i{width:5px;height:5px;border-radius:50%;background:currentColor;animation:hmd 1s infinite}.hm-dots i:nth-child(2){animation-delay:.15s}.hm-dots i:nth-child(3){animation-delay:.3s}
@keyframes hmd{50%{transform:translateY(-3px);opacity:.5}}
.hm-view{position:fixed;inset:0;z-index:70;background:#000e;display:flex;flex-direction:column;align-items:center;justify-content:center}.hm-view img{max-width:96vw;max-height:84vh;object-fit:contain}
.hm-view .bar{display:flex;gap:10px;margin-top:12px}.hm-view .bar button{color:#fff;background:#fff2;padding:9px 16px;border-radius:12px;font-weight:600}
.hm-pick{display:flex!important;gap:12px;align-items:center;padding:8px 14px;width:100%}.hm-pick input{width:20px;height:20px;accent-color:var(--acc)}
.hm-sw{width:44px;height:26px;border-radius:99px;background:var(--line);position:relative;flex:none}.hm-sw::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s}.hm-sw.on{background:var(--acc)}.hm-sw.on::after{left:21px}
.hm-opt{display:flex;align-items:center;gap:10px;margin-top:10px}.hm-opt div{flex:1}.hm-opt small{display:block;color:var(--mute);font-size:12px}
.hm-drop{outline:3px dashed var(--acc);outline-offset:-8px}`;
  if (!document.getElementById('hm-css')) { const s = document.createElement('style'); s.id = 'hm-css'; s.textContent = css + css2; document.head.append(s); }
  const I = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>', plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>', send: '<svg viewBox="0 0 24 24"><path d="M3 20l18-8L3 4v6l12 2-12 2z"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
    clip: '<svg viewBox="0 0 24 24"><path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/></svg>',
    group: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-4 3-6 7-6s7 2 7 6M16 4.5a3.5 3.5 0 0 1 0 7M22 20c0-3-1.5-5-4-5.7"/></svg>',
    qr: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M21 14v7h-4M14 21v-3"/></svg>' };
  const view = { open: false, el: null, screen: 'list', chat: null, reply: null, q: '', pick: new Set() };
  const time = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = t => { const d = new Date(t), n = new Date(); const y = new Date(); y.setDate(n.getDate() - 1);
    return d.toDateString() === n.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); };
  const short = t => { const d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString() ? time(t) : (n - d < 6 * 864e5 ? d.toLocaleDateString([], { weekday: 'short' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' })); };
  const size = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)"'\]]/g, u => `<a href="#" data-u="${u}">${u.length > 60 ? u.slice(0, 57) + '…' : u}</a>`);
  const avatar = (key, sz = 44) => isGroup(key)
    ? `<div class=hm-av style="background:${colorOf(key)};width:${sz}px;height:${sz}px">${I.group.replace('<svg', `<svg style="width:${sz / 2}px;height:${sz / 2}px;stroke:#fff;fill:none;stroke-width:1.8"`)}</div>`
    : `<div class=hm-av style="background:${colorOf(key)};width:${sz}px;height:${sz}px;font-size:${Math.round(sz / 2.9)}px">${esc(initials(nameOf(key)))}</div>`;
  const preview = m => m.file ? (m.file.mime.startsWith('image/') ? '📷 Photo' : '📎 ' + m.file.name) : m.text;
  function paintStatus() { const e = view.el && view.el.querySelector('.hm-st'); if (!e) return;
    if (view.screen === 'chat' && typingNames().length) return paintTyping();
    const s = status.startsWith('error') ? 'error' : status; e.className = 'hm-st ' + s;
    e.innerHTML = `<i></i>${s === 'on' ? (view.screen === 'chat' && isGroup(view.chat) ? `${members(view.chat).length + 1} people · ` : '') + `Private · through Tor · ${okRelays()} relay${okRelays() === 1 ? '' : 's'}` : s === 'connecting' ? 'Connecting through Tor…' : s === 'error' ? 'Can’t reach Tor — retrying' : 'Offline'}`; }
  function typingNames() { const t = typing[view.chat] || {}, n = Date.now(); return Object.entries(t).filter(([, u]) => u > n).map(([pk]) => first(pk)); }
  function paintTyping() { const e = view.el && view.el.querySelector('.hm-st'); if (!e) return; const ns = typingNames();
    if (!ns.length) { e.classList.remove('hm-typing'); return paintStatus(); }
    e.className = 'hm-st hm-typing'; e.innerHTML = `${isGroup(view.chat) ? esc(ns.join(', ')) + (ns.length > 1 ? ' are' : ' is') + ' typing' : 'typing'}<span class=hm-dots><i></i><i></i><i></i></span>`; }
  function open(el, chat) { view.open = true; view.el = el; if (chat) { view.screen = 'chat'; view.chat = chat; }
    if (!loadKey()) view.screen = 'welcome'; else start(); repaint(); if (view.screen === 'chat') sendRead(view.chat); }
  function close() { view.open = false; view.el = null; document.querySelector('.hm-menu')?.remove(); }
  function repaint() { if (!view.open || !view.el) return;
    const ta = view.el.querySelector('textarea'), keep = ta?.value, focused = document.activeElement === ta, scr = view.screen;
    const sc = view.el.querySelector('#hm-scroll'), atBottom = !sc || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80, top = sc?.scrollTop;
    ({ welcome: drawWelcome, list: drawList, chat: drawChat, add: drawAdd, group: drawGroup, me: drawMe }[scr] || drawList)();
    if (scr === 'chat') { const t = view.el.querySelector('textarea'); if (t && keep) { t.value = keep; t.oninput(); } if (t && focused) t.focus();
      const s2 = view.el.querySelector('#hm-scroll'); if (s2) s2.scrollTop = atBottom ? s2.scrollHeight : top; }
    paintStatus(); }
  const head = (title, sub, left, right) => `<div class=hm-h>${left || ''}<div style="flex:1;min-width:0"><h2>${title}</h2>${sub || ''}</div>${right || ''}</div>`;
  const closeB = () => A.close ? `<button class=hm-ib data-close aria-label=Close>${I.x}</button>` : '';
  function wireCommon() { view.el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { view.screen = b.dataset.go; repaint(); });
    view.el.querySelectorAll('[data-close]').forEach(b => b.onclick = () => A.close && A.close()); }

  function drawWelcome() {
    view.el.innerHTML = `<div class=hm>${head('Messages', '', '', closeB())}<div class=hm-body>
      <div class=hm-card style="text-align:center"><div style="font-size:42px">💬</div><h3 style="font-size:19px">Private messages, built into Hush</h3>
      <p>Chat, share photos and files, and make group chats with other Hush users. Everything is end-to-end encrypted and always sent through <b>Tor</b> — no server ever sees what you say, who you are, or where you are. No phone number, no email, no account.</p>
      <input class=hm-in id=hm-name placeholder="Your name (what friends see)" maxlength=40 style="text-align:center">
      <button class=hm-btn id=hm-go>Start messaging</button></div>
      <div class=hm-card><h3>How it stays private</h3><p>🔒 Only the people in a chat can read it — photos and files too.</p><p>🧅 Every connection goes through Tor — your IP address is never shown to anyone.</p><p>✉️ Each message is sealed in an outer envelope from a throwaway key, so relays can’t tell who sent it.</p><p style="margin:0">📱 Your contacts and chats stay on this device.</p></div></div></div>`;
    wireCommon();
    view.el.querySelector('#hm-go').onclick = () => { createKey(); LS.set('profile', { name: view.el.querySelector('#hm-name').value.trim().slice(0, 40) });
      view.screen = 'list'; start(); repaint(); A.toast('You’re set up — share your Hush ID to start chatting'); };
  }
  function drawList() {
    const all = chats(), c = contacts(), g = groups(), un = LS.get('unread', {}), q = view.q.toLowerCase();
    const keys = [...new Set([...Object.keys(all), ...Object.keys(c).filter(k => !c[k].blocked && !c[k].auto), ...Object.keys(g)])].filter(k => k && (isGroup(k) || !c[k]?.blocked))
      .map(k => ({ k, last: (all[k] || []).at(-1) })).sort((a, b) => (b.last?.at || c[b.k]?.added || g[b.k]?.at || 0) - (a.last?.at || c[a.k]?.added || g[a.k]?.at || 0))
      .filter(x => !q || chatName(x.k).toLowerCase().includes(q) || (x.last?.text || '').toLowerCase().includes(q));
    view.el.innerHTML = `<div class=hm style="position:relative">${head('Messages', '<div class=hm-st></div>', '',
      `<button class=hm-ib data-go=me title="Your Hush ID" aria-label="Your Hush ID">${I.qr}</button>${closeB()}`)}
      <div class=hm-body><input class=hm-search placeholder="Search chats" value="${esc(view.q)}">
      ${keys.map(({ k, last }) => `<button class=hm-row data-chat="${k}">${avatar(k)}<div class=t><b>${esc(chatName(k))}</b><span>${last ? (last.from === 'me' ? 'You: ' : isGroup(k) ? esc(first(last.from)) + ': ' : '') + esc(preview(last).slice(0, 80)) : c[k]?.request ? 'Wants to chat' : isGroup(k) ? 'New group' : 'Say hi 👋'}</span></div>
        <em>${last ? short(last.at) : ''}${un[k] ? `<br><span class=u>${un[k]}</span>` : ''}</em></button>`).join('') ||
        `<div class=hm-empty><b>No chats yet</b>Tap <b>+</b> to add someone with their Hush ID, or show them yours with the QR button.</div>`}</div>
      <button class=hm-fab data-go=add aria-label="New chat">${I.plus}</button></div>`;
    wireCommon();
    const s = view.el.querySelector('.hm-search'); s.oninput = () => { view.q = s.value; const p = s.selectionStart; repaint(); const n = view.el.querySelector('.hm-search'); n.focus(); n.setSelectionRange(p, p); };
    view.el.querySelectorAll('[data-chat]').forEach(b => { b.onclick = () => openChat(b.dataset.chat);
      b.oncontextmenu = e => { e.preventDefault(); chatMenu(e.clientX, e.clientY, b.dataset.chat); };
      let t; b.addEventListener('touchstart', e => { const p = e.touches[0]; t = setTimeout(() => chatMenu(p.clientX, p.clientY, b.dataset.chat), 550); }, { passive: true });
      b.addEventListener('touchend', () => clearTimeout(t)); b.addEventListener('touchmove', () => clearTimeout(t), { passive: true }); });
  }
  function openChat(k) { view.screen = 'chat'; view.chat = k; view.reply = null; const un = LS.get('unread', {}); delete un[k]; LS.set('unread', un); badge(); repaint(); sendRead(k); }
  function bubble(m, list, key, prev) {
    const q = m.reply && list.find(x => x.id === m.reply);
    const rx = m.react && Object.entries(m.react).filter(([, w]) => w.length).map(([e, w]) => e + (w.length > 1 ? w.length : '')).join(' ');
    const who = m.from === 'me' ? 'me' : 'them', showName = isGroup(key) && who === 'them' && (!prev || prev.from !== m.from);
    let body = '';
    if (m.file) { const f = m.file, img = f.mime.startsWith('image/');
      body = !f.done ? `<div class=hm-file><i>${img ? '📷' : '📎'}</i><div><b>${esc(f.name)}</b><small>Receiving… ${Math.round(100 * f.got / f.total)}%</small><div class=hm-prog><i style="width:${Math.round(100 * f.got / f.total)}%"></i></div></div></div>`
        : img ? `<img class=hm-img data-img="${f.id}" alt="Photo">` : `<div class=hm-file data-dl="${f.id}"><i>📎</i><div><b>${esc(f.name)}</b><small>${size(f.size)} · tap to open</small></div></div>`; }
    else { const url = (m.text.match(/https?:\/\/\S+/) || [])[0];
      body = linkify(m.text) + (url && m.text.trim() === url.trim() ? `<a href=# class=hm-link data-u="${esc(url)}">🔗 ${esc((() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })())}</a>` : ''); }
    const st = m.from === 'me' ? ' ' + ({ sent: (m.read?.length ? '✓✓' : '✓'), sending: '…', queued: '◷', failed: '⚠ tap to retry' }[m.status] || '') : '';
    return `<div class="hm-m ${who} ${m.file?.done && m.file.mime.startsWith('image/') ? 'img' : ''} ${rx ? 'hasrx' : ''} ${m.status === 'failed' ? 'failed' : ''}" data-m="${m.id}">${showName ? `<span class=hm-who style="color:${colorOf(m.from)}">${esc(nameOf(m.from))}</span>` : ''}${q ? `<span class=q>${esc(preview(q).slice(0, 80))}</span>` : ''}${body}<span class=tm>${time(m.at)}${st}</span>${rx ? `<span class=rx>${rx}</span>` : ''}</div>`;
  }
  function drawChat() {
    const key = view.chat, list = (chats()[key] || []), c = contacts()[key] || {};
    let lastDay = '', html = '', prev = null;
    const lastMine = [...list].reverse().find(m => m.from === 'me');
    for (const m of list) { const d = day(m.at); if (d !== lastDay) { html += `<div class=hm-day>${d}</div>`; lastDay = d; prev = null; } html += bubble(m, list, key, prev); prev = m;
      if (m === lastMine && m.read?.length && prefs().receipts) html += `<div class=hm-seen>${isGroup(key) ? 'Seen by ' + m.read.map(first).join(', ') : 'Seen'}</div>`; }
    view.el.innerHTML = `<div class=hm>${head(esc(chatName(key)), '<div class=hm-st></div>', `<button class=hm-ib data-go=list aria-label=Back>${I.back}</button>${avatar(key, 36)}`,
      `<button class=hm-ib id=hm-cm aria-label="Chat options">⋯</button>`)}
      <div class=hm-body id=hm-scroll>${c.request ? `<div class=hm-req><b>${esc(nameOf(key))}</b> isn’t in your contacts yet. Only reply if you know them.<div style="margin-top:8px;display:flex;gap:8px"><button class="hm-btn" id=hm-acc>Accept</button><button class="hm-btn ghost" id=hm-blk>Block</button></div></div>` : ''}
      <div class=hm-msgs>${html || `<div class=hm-empty style="padding:30px"><b>Start the conversation</b>Messages, photos and files are end-to-end encrypted and sent through Tor.</div>`}</div></div>
      ${view.reply ? `<div class=hm-rep>↩ <span>${esc(preview(list.find(x => x.id === view.reply) || { text: '' }))}</span><button class=hm-ib id=hm-rx aria-label="Cancel reply">${I.x}</button></div>` : ''}
      <div class=hm-c><button class=hm-ib id=hm-att title="Photo or file" aria-label="Send a photo or file">${I.clip}</button>${A.page && A.page() ? `<button class=hm-ib id=hm-share title="Share the page you’re on" aria-label="Share page">${I.link}</button>` : ''}
      <textarea rows=1 placeholder="Message" aria-label="Message"></textarea><button class=hm-send aria-label=Send>${I.send}</button>
      <input type=file id=hm-file hidden multiple></div></div>`;
    wireCommon();
    const sc = view.el.querySelector('#hm-scroll'); sc.scrollTop = sc.scrollHeight;
    const ta = view.el.querySelector('textarea'), go = () => { const v = ta.value; if (!v.trim()) return; ta.value = ''; ta.oninput(); const r = view.reply; view.reply = null; sendText(key, v, r); };
    ta.oninput = e => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; if (e && ta.value.trim()) sendTyping(key); };
    ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !A.mobile) { e.preventDefault(); go(); } };
    view.el.querySelector('.hm-send').onclick = go; if (!A.mobile) setTimeout(() => ta.focus(), 30);
    const fi = view.el.querySelector('#hm-file'); view.el.querySelector('#hm-att').onclick = () => fi.click();
    fi.onchange = () => { [...fi.files].slice(0, 10).forEach(f => sendFile(key, f)); fi.value = ''; };
    ta.addEventListener('paste', e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); fs.slice(0, 10).forEach(f => sendFile(key, f)); } });
    const body = view.el.querySelector('.hm'); body.ondragover = e => { e.preventDefault(); body.classList.add('hm-drop'); }; body.ondragleave = () => body.classList.remove('hm-drop');
    body.ondrop = e => { e.preventDefault(); body.classList.remove('hm-drop'); [...(e.dataTransfer?.files || [])].slice(0, 10).forEach(f => sendFile(key, f)); };
    const sh = view.el.querySelector('#hm-share'); if (sh) sh.onclick = () => { const p = A.page(); if (p) { ta.value = (ta.value ? ta.value + ' ' : '') + p.url; ta.oninput(); ta.focus(); } };
    const rxb = view.el.querySelector('#hm-rx'); if (rxb) rxb.onclick = () => { view.reply = null; repaint(); };
    const acc = view.el.querySelector('#hm-acc'); if (acc) acc.onclick = () => { const all = contacts(); delete all[key].request; LS.set('contacts', all); repaint(); };
    const blk = view.el.querySelector('#hm-blk'); if (blk) blk.onclick = () => { const all = contacts(); all[key] = { ...all[key], blocked: true }; LS.set('contacts', all); view.screen = 'list'; repaint(); A.toast('Blocked'); };
    view.el.querySelector('#hm-cm').onclick = e => chatMenu(e.clientX, e.clientY, key);
    view.el.querySelectorAll('[data-u]').forEach(a => a.onclick = e => { e.preventDefault(); e.stopPropagation(); A.open(a.dataset.u); });
    view.el.querySelectorAll('[data-img]').forEach(async im => { const u = await fileUrl(im.dataset.img); if (u) im.src = u; im.onclick = e => { e.stopPropagation(); viewer(im.dataset.img); }; });
    view.el.querySelectorAll('[data-dl]').forEach(d => d.onclick = e => { e.stopPropagation(); const m = list.find(x => x.file?.id === d.dataset.dl); if (m) saveFile(m.file); });
    view.el.querySelectorAll('[data-m]').forEach(b => { const m = list.find(x => x.id === b.dataset.m); if (!m) return;
      b.onclick = () => { if (m.status === 'failed') resend(key, m); };
      b.ondblclick = () => react(key, m, '❤️');
      b.oncontextmenu = e => { e.preventDefault(); msgMenu(e.clientX, e.clientY, key, m); };
      let t, sx; b.addEventListener('touchstart', e => { const p = e.touches[0]; sx = p.clientX; t = setTimeout(() => msgMenu(p.clientX, p.clientY, key, m), 480); }, { passive: true });
      b.addEventListener('touchmove', e => { clearTimeout(t); const dx = e.touches[0].clientX - sx; if (dx > 0) b.style.transform = `translateX(${Math.min(dx, 70)}px)`; }, { passive: true });
      b.addEventListener('touchend', e => { clearTimeout(t); const dx = (e.changedTouches[0]?.clientX || sx) - sx; b.style.transform = ''; if (dx > 60) { view.reply = m.id; repaint(); } });   // swipe right = reply
    });
  }
  async function viewer(fid) { const u = await fileUrl(fid); if (!u) return; const v = document.createElement('div'); v.className = 'hm-view';
    v.innerHTML = `<img src="${u}" alt="Photo"><div class=bar><button data-a=save>Save</button>${navigator.share ? '<button data-a=share>Share</button>' : ''}<button data-a=x>Close</button></div>`;
    document.body.append(v); const close = () => { v.remove(); removeEventListener('keydown', k); }; const k = e => { if (e.key === 'Escape') close(); }; addEventListener('keydown', k);
    v.onclick = async e => { const a = e.target.dataset?.a; if (e.target === v || a === 'x') return close();
      const b = await getFile(fid); if (!b) return;
      if (a === 'save') saveBlob(b, 'Hush photo.jpg');
      if (a === 'share') navigator.share({ files: [new File([b], 'photo.jpg', { type: b.type })] }).catch(() => {}); }; }
  async function saveFile(f) { const b = await getFile(f.id); if (!b) return A.toast('File not found');
    if (A.mobile && navigator.canShare && navigator.canShare({ files: [new File([b], f.name, { type: f.mime })] })) { navigator.share({ files: [new File([b], f.name, { type: f.mime })] }).catch(() => {}); return; }
    saveBlob(b, f.name); }
  function saveBlob(b, name) {
    if (A.saveImage && b.type.startsWith('image/')) { const fr = new FileReader(); fr.onload = () => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); A.saveImage(c.toDataURL('image/png')); }; img.src = fr.result; }; fr.readAsDataURL(b); return; }
    const u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 30000); }
  function menu(x, y, html, wire) { document.querySelector('.hm-menu')?.remove(); const m = document.createElement('div'); m.className = 'hm-menu'; m.innerHTML = html;
    document.body.append(m); const r = m.getBoundingClientRect(); m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px'; m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
    const off = e => { if (!m.contains(e.target)) { m.remove(); removeEventListener('pointerdown', off, true); } }; setTimeout(() => addEventListener('pointerdown', off, true), 0);
    wire(m, () => { m.remove(); removeEventListener('pointerdown', off, true); }); }
  function msgMenu(x, y, key, m) {
    menu(x, y, `<div class=e>${REACT.map(e => `<button data-e="${e}">${e}</button>`).join('')}</div><button class=i data-a=reply>↩ Reply</button>${m.file ? '<button class=i data-a=save>Save</button>' : '<button class=i data-a=copy>Copy text</button>'}${m.status === 'failed' ? '<button class=i data-a=retry>Retry</button>' : ''}${m.from === 'me' && m.read?.length && isGroup(key) ? `<button class=i data-a=info>Seen by ${m.read.length}</button>` : ''}<button class=i data-a=del>Delete for me</button>`,
      (el, done) => { el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { done(); react(key, m, b.dataset.e); });
        el.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => { done(); const a = b.dataset.a;
          if (a === 'reply') { view.reply = m.id; repaint(); view.el.querySelector('textarea')?.focus(); }
          else if (a === 'copy') { try { await navigator.clipboard.writeText(m.text); A.toast('Copied'); } catch {} }
          else if (a === 'save') saveFile(m.file);
          else if (a === 'info') A.toast('Seen by ' + m.read.map(first).join(', '));
          else if (a === 'retry') resend(key, m);
          else if (a === 'del') { const all = chats(); all[key] = (all[key] || []).filter(z => z.id !== m.id); LS.set('chats', all); repaint(); } }); });
  }
  function chatMenu(x, y, key) {
    const g = isGroup(key);
    menu(x, y, `<button class=i data-a=rename>${g ? 'Rename group' : 'Rename'}</button>${g ? '<button class=i data-a=people>People in this group</button>' : '<button class=i data-a=id>Show their Hush ID</button>'}<button class=i data-a=clear>Clear chat</button>${g ? '' : '<button class=i data-a=block>Block</button>'}<button class=i data-a=del>${g ? 'Leave & delete group' : 'Delete chat & contact'}</button>`,
      (el, done) => el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { done(); const a = b.dataset.a, c = contacts();
        if (a === 'rename') { const n = prompt(g ? 'Group name (everyone sees it)' : 'Name for this contact', chatName(key)); if (!n || !n.trim()) return;
          if (g) { const gs = groups(); gs[key] = { ...(gs[key] || {}), name: n.trim().slice(0, 60) }; LS.set('groups', gs); sendText(key, '✏️ renamed the group to “' + n.trim().slice(0, 60) + '”'); }
          else { c[key] = { ...(c[key] || {}), name: n.trim().slice(0, 40), named: true }; LS.set('contacts', c); } repaint(); }
        else if (a === 'people') A.toast('You, ' + members(key).map(nameOf).join(', '));
        else if (a === 'id') prompt('Their Hush ID', npub(key));
        else if (a === 'clear') { if (confirm('Clear all messages in ' + chatName(key) + ' on this device?')) { const all = chats(); delete all[key]; LS.set('chats', all); repaint(); } }
        else if (a === 'block') { c[key] = { ...(c[key] || {}), blocked: true }; LS.set('contacts', c); view.screen = 'list'; repaint(); A.toast('Blocked — you won’t see their messages'); }
        else if (a === 'del') { if (!confirm(g ? 'Leave this group and delete it from this device?' : 'Delete this chat and contact?')) return;
          const all = chats(); delete all[key]; LS.set('chats', all); if (g) { const gs = groups(); delete gs[key]; LS.set('groups', gs); } else { delete c[key]; LS.set('contacts', c); } view.screen = 'list'; repaint(); } }));
  }
  function drawAdd() {
    view.el.innerHTML = `<div class=hm>${head('New chat', '', `<button class=hm-ib data-go=list aria-label=Back>${I.back}</button>`)}<div class=hm-body>
      <button class="hm-row" data-go=group style="margin-top:6px">${avatar('a,b', 44)}<div class=t><b>New group</b><span>Chat with several people at once</span></div></button>
      <div class=hm-card><h3>Add someone</h3><p>Paste their Hush ID (it starts with <b>npub</b>). They can find it under the QR button in their Messages.</p>
      <input class=hm-in id=hm-id placeholder="npub1…" autocapitalize=off spellcheck=false><input class=hm-in id=hm-nm placeholder="Name (optional)" maxlength=40>
      <button class=hm-btn id=hm-add>Start chat</button></div>
      <div class=hm-card><h3>Or let them add you</h3><p>Show your code — they can scan it with their phone camera.</p><button class="hm-btn ghost" data-go=me>Show my Hush ID</button></div></div></div>`;
    wireCommon();
    view.el.querySelector('#hm-add').onclick = () => { const pk = parseId(view.el.querySelector('#hm-id').value); if (!pk) return A.toast('That isn’t a Hush ID — it should start with npub1');
      if (pk === me) return A.toast('That’s your own ID'); addContact(pk, view.el.querySelector('#hm-nm').value.trim()); openChat(pk); };
  }
  function drawGroup() {
    const c = contacts(), people = Object.keys(c).filter(k => !c[k].blocked && !c[k].request && (!c[k].auto || chats()[k]));
    view.el.innerHTML = `<div class=hm>${head('New group', `<small>${view.pick.size} selected</small>`, `<button class=hm-ib data-go=add aria-label=Back>${I.back}</button>`)}<div class=hm-body>
      <div class=hm-card><input class=hm-in id=hm-gn placeholder="Group name" maxlength=60 style="margin:0"></div>
      ${people.map(k => `<label class=hm-pick>${avatar(k, 36)}<div style="flex:1"><b>${esc(nameOf(k))}</b></div><input type=checkbox data-p="${k}" ${view.pick.has(k) ? 'checked' : ''}></label>`).join('') ||
        '<div class=hm-empty><b>No contacts yet</b>Add people first with their Hush ID, then make a group.</div>'}
      ${people.length ? '<div style="padding:14px"><button class=hm-btn id=hm-mk>Create group</button></div>' : ''}</div></div>`;
    wireCommon();
    view.el.querySelectorAll('[data-p]').forEach(x => x.onchange = () => { x.checked ? view.pick.add(x.dataset.p) : view.pick.delete(x.dataset.p); view.el.querySelector('.hm-h small').textContent = view.pick.size + ' selected'; });
    const mk = view.el.querySelector('#hm-mk'); if (mk) mk.onclick = () => { if (view.pick.size < 2) return A.toast('Pick at least two people');
      const key = keyOf([...view.pick]), name = view.el.querySelector('#hm-gn').value.trim().slice(0, 60);
      const gs = groups(); gs[key] = { name: name || '', at: Date.now() }; LS.set('groups', gs); view.pick.clear();
      openChat(key); sendText(key, '👋 started the group' + (name ? ' “' + name + '”' : '')); };
  }
  function addContact(pk, name) { const c = contacts(); c[pk] = { ...(c[pk] || {}), added: c[pk]?.added || Date.now(), ...(name ? { name: name.slice(0, 40), named: true } : {}) }; delete c[pk].request; delete c[pk].blocked; delete c[pk].auto; LS.set('contacts', c); }
  function drawMe() {
    const id = npub(me), link = 'hush://add#' + id, p = prefs();
    view.el.innerHTML = `<div class=hm>${head('Your Hush ID', '', `<button class=hm-ib data-go=list aria-label=Back>${I.back}</button>`)}<div class=hm-body>
      <div class=hm-card style="text-align:center"><div class=hm-qr>${A.qr ? A.qr(link) : ''}</div><p>Friends scan this with their phone camera, or paste your ID into New chat.</p>
      <div class=hm-id>${esc(id)}</div><div style="margin-top:10px;display:flex;gap:8px;justify-content:center"><button class=hm-btn id=hm-copy>Copy ID</button>${navigator.share ? '<button class="hm-btn ghost" id=hm-sh>Share</button>' : ''}</div></div>
      <div class=hm-card><h3>Your name</h3><p>Sent with your messages so friends see who you are.</p><input class=hm-in id=hm-name value="${esc(profile().name)}" maxlength=40><button class="hm-btn ghost" id=hm-save>Save</button></div>
      <div class=hm-card><h3>Chat settings</h3>
        <div class=hm-opt><div>Read receipts<small>Show ✓✓ / “Seen” — if off, you won’t see theirs either</small></div><button class="hm-sw ${p.receipts ? 'on' : ''}" data-pref=receipts aria-label="Read receipts"></button></div>
        <div class=hm-opt><div>Typing indicator<small>Let people see when you’re typing</small></div><button class="hm-sw ${p.typing ? 'on' : ''}" data-pref=typing aria-label="Typing indicator"></button></div></div>
      <div class=hm-card><h3>Privacy</h3><p><span class=hm-tor>🧅 Tor only</span> Every connection goes through Tor. Messages, photos and files are end-to-end encrypted (NIP-44), sealed and gift-wrapped (NIP-59), and relayed by ${relays().length} independent relays.</p>
      <p style="margin:0">Your secret key never leaves this device. If you uninstall Hush or clear its data, this ID and your chats are gone — there’s no account to recover.</p></div>
      <div class=hm-card><h3>Start over</h3><p>Deletes your ID, contacts, groups, photos and every message on this device.</p><button class="hm-btn ghost" id=hm-reset style="color:#ef4444">Delete everything</button></div></div></div>`;
    wireCommon();
    view.el.querySelectorAll('[data-pref]').forEach(b => b.onclick = () => { const q = prefs(); q[b.dataset.pref] = !q[b.dataset.pref]; LS.set('prefs', q); repaint(); });
    view.el.querySelector('#hm-copy').onclick = async () => { try { await navigator.clipboard.writeText(id); A.toast('Hush ID copied'); } catch { prompt('Your Hush ID', id); } };
    const sh = view.el.querySelector('#hm-sh'); if (sh) sh.onclick = () => navigator.share({ text: 'Message me privately on Hush: ' + id }).catch(() => {});
    view.el.querySelector('#hm-save').onclick = () => { LS.set('profile', { name: view.el.querySelector('#hm-name').value.trim().slice(0, 40) }); A.toast('Saved'); };
    view.el.querySelector('#hm-reset').onclick = async () => { if (!confirm('Delete your Hush ID and all messages, photos and files on this device? This can’t be undone.')) return;
      for (const k of ['key', 'contacts', 'chats', 'groups', 'unread', 'seen', 'since', 'profile', 'readSent']) localStorage.removeItem('hush.msg.' + k);
      try { (await db()).close(); dbp = null; indexedDB.deleteDatabase('hush-msg'); } catch {}
      Object.values(conns).forEach(c => c.id && A.inv('msg_ws_close', { id: c.id }).catch(() => {})); sk = null; me = ''; started = false; view.screen = 'welcome'; badge(); repaint(); };
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && view.open && view.screen === 'chat') sendRead(view.chat); });
  // Background: once set up, stay connected (through Tor) so messages arrive while you browse.
  function boot() { if (!N) return; if (loadKey()) { start(); badge(); } }
  return { open, close, boot, unread: unreadTotal, addFromLink: s => { const pk = parseId(s); if (!pk || !loadKey()) return false; addContact(pk); return pk; }, ready: () => !!N };
};
