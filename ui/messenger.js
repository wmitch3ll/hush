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
  const K_TYPING = 20014, K_READ = 20015, K_PCARD = 10414, K_TOG = 20016, K_SYNC = 10417;   // 20016: Watch Together controls (play/pause/skip/start/go)
    // 10414: your profile card (name, photo, status, aura), sent privately to contacts        // Hush-only signals, sent inside the same encrypted gift wraps
  const CHUNK = 24000, SMALL = 2.5 * 1024 * 1024, MAX_BIG = 100 * 1024 * 1024, AUTO_DL = 25 * 1024 * 1024;
  // Encrypted-file hosts (Blossom). Files are AES-256-GCM encrypted on this device before upload; uploads/downloads go through Tor.
  const HOSTS_DEFAULT = ['https://blossom.primal.net', 'https://nostr.download', 'https://blossom.band'];
  const hosts = () => LS.get('hosts', HOSTS_DEFAULT);
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
  // Chats that contain a "Report a problem" message (only the Hush developer receives these).
  const isReport = k => (chats()[k] || []).some(m => typeof m.text === 'string' && m.text.startsWith('🐞 Hush report'));
  const groups = () => LS.get('groups', {});
  const profile = () => LS.get('profile', { name: '' });
  const prefs = () => LS.get('prefs', { receipts: true, typing: true, curtain: true });
  // The identity key lives in the OS vault (Windows DPAPI / Android Keystore), never in page storage.
  let keyTried = false;
  async function loadKey() {
    if (sk) return true; if (!N) return false;
    let k = null; try { k = await A.secret.get('murmur-key'); } catch (e) { console.warn('vault', e); }
    const legacy = LS.get('key', '');
    if (!k && /^[0-9a-f]{64}$/.test(legacy)) { try { await A.secret.set('murmur-key', legacy); k = legacy; } catch { k = legacy; } }
    if (k && legacy) { try { if (await A.secret.get('murmur-key') === legacy) localStorage.removeItem('hush.msg.key'); } catch {} }
    keyTried = true;
    if (k && /^[0-9a-f]{64}$/.test(k)) { sk = unhex(k); me = N.getPublicKey(sk); await loadPq(); }
    return !!sk;
  }
  async function useKey(k, pqHex) { await A.secret.set('murmur-key', k); sk = unhex(k); me = N.getPublicKey(sk); if (pqHex) await A.secret.set('murmur-pq', pqHex).catch(() => {}); await loadPq(); }
  // ---------------------------------------------------------------- Post-quantum layer (ML-KEM-768, like Signal's)
  // Each device keeps an ML-KEM key pair in the OS vault and shares the public half with contacts in the (encrypted)
  // profile card. 1-to-1 messages are then locked twice: first with a fresh key carried by ML-KEM, then sealed and
  // gift-wrapped as usual (NIP-44/59). Someone recording traffic today would need to break both, even with a quantum computer.
  const n44 = () => N.nip44.v2 || N.nip44;
  let pq = null;   // { pk: Uint8Array, sk: Uint8Array, hex: string }
  async function loadPq() { if (pq || !N.ml_kem768) return;
    let h = null; try { h = await A.secret.get('murmur-pq'); } catch {}
    if (!h || !/^[0-9a-f]+$/.test(h)) { const kp = N.ml_kem768.keygen(); h = hex(kp.publicKey) + ':' + hex(kp.secretKey); }
    if (!h.includes(':')) return; const [p1, s1] = h.split(':'); pq = { pk: unhex(p1), sk: unhex(s1), hex: h }; try { await A.secret.set('murmur-pq', h); } catch {} }
  const pqOn = key => !!(pq && N.ml_kem768 && prefs().pq !== false && key !== 'self' && members(key).length && members(key).length <= 40 && members(key).every(m => /^[0-9a-f]{2368}$/.test(contacts()[m]?.pq || '')));
  function pqSeal(key, content) { const K = crypto.getRandomValues(new Uint8Array(32)), r = [];
    for (const pkHex of [...members(key).map(m => contacts()[m].pq), hex(pq.pk)]) { const { cipherText, sharedSecret } = N.ml_kem768.encapsulate(unhex(pkHex)); r.push({ c: btoa(String.fromCharCode(...cipherText)), k: n44().encrypt(hex(K), sharedSecret) }); }
    return JSON.stringify({ v: 1, r, d: n44().encrypt(String(content || '') || ' ', K) }); }
  function pqOpen(content) { if (!pq) return null; let j; try { j = JSON.parse(content); } catch { return null; } if (!j || j.v !== 1 || !Array.isArray(j.r)) return null;
    for (const e of j.r.slice(0, 41)) { try { const ct = Uint8Array.from(atob(e.c), ch => ch.charCodeAt(0)), ss = N.ml_kem768.decapsulate(ct, pq.sk); const K = unhex(n44().decrypt(e.k, ss)); const t = n44().decrypt(j.d, K); return t === ' ' ? '' : t; } catch {} }
    return null; }
  async function createKey() { await useKey(hex(N.generateSecretKey())); LS.set('since', now() - 3 * 86400); }
  const npub = pk => { try { return N.nip19.npubEncode(pk); } catch { return pk; } };
  const inviteOf = s => (String(s || '').match(/[?&]i=([0-9a-f]{16})/) || [])[1] || null;
  const parseId = s => { s = String(s || '').trim().replace(/^(nostr:|hush:\/\/add#?|hush:add#?)/i, '').replace(/[?&].*$/, '');
    if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
    try { const d = N.nip19.decode(s); if (d.type === 'npub') return d.data; if (d.type === 'nprofile') return d.data.pubkey; } catch {} return null; };
  const members = key => key === 'self' ? [] : key.split(',').filter(Boolean);
  const isGroup = key => key.includes(',');
  const keyOf = pks => [...new Set(pks)].filter(p => p && p !== me).sort().join(',');
  const nameOf = pk => (contacts()[pk] || {}).name || ('Hush user ' + npub(pk).slice(5, 11));
  const first = pk => nameOf(pk).split(/\s+/)[0];
  const chatName = key => key === 'self' ? 'Notes to self' : isGroup(key) ? (groups()[key]?.name || members(key).map(first).join(', ')) : nameOf(key);
  const verified = pk => !!contacts()[pk]?.verified;
  const badgeV = pk => !isGroup(pk) && verified(pk) ? ' <span class=hm-ver title="Verified in person">✓</span>' : '';
  // Safety code: the same 20 digits on both phones if (and only if) you're talking to the right person.
  async function safetyCode(pk) { const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode([me, pk].sort().join(':'))));
    let out = ''; for (let i = 0; i < 20; i++) out += d[i] % 10; return out.match(/.{5}/g).join(' '); }
  // A stranger using the same name as someone you verified gets a warning.
  const impostor = pk => { const n = (contacts()[pk]?.name || '').trim().toLowerCase(); if (!n || verified(pk)) return null;
    const c = contacts(); return Object.keys(c).find(k => k !== pk && c[k].verified && (c[k].name || '').trim().toLowerCase() === n) || null; };
  const colorOf = k => `hsl(${parseInt(k.replace(/,/g, '').slice(0, 6), 16) % 360} 55% 48%)`;
  const initials = n => (n.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || '?').toUpperCase();

  // ---------------------------------------------------------------- network (relays over Tor)
  const conns = {}, byId = {}, pending = {};
  let status = 'off', started = false;
  const okRelays = () => Object.values(conns).filter(c => c.open).length;
  function setStatus(s) { status = s; paintStatus(); }
  const syncLive = () => { try { A.live && A.live(!!sk && !prefs().nonotif && !prefs().nobg); } catch (e) {} };
  function start() { syncLive();
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
      c.queue.splice(0).forEach(m => send(u, m));
      Object.entries(subs).forEach(([id, s]) => send(u, ['REQ', id, ...s.filters])); }
    else if (p.t === 'close') { delete byId[p.id]; if (!okRelays()) setStatus(p.d ? 'error:' + p.d : 'connecting'); retry(u); }
    else if (p.t === 'msg') { let m; try { m = JSON.parse(p.d); } catch { return; }
      if (m[0] === 'EVENT' && m[2]) { if (m[1] === 'hush') receive(m[2]); else if (subs[m[1]]) { if (!subSeen.has(m[2].id)) { subSeen.add(m[2].id); try { if (N.verifyEvent(m[2])) subs[m[1]].onEvent(m[2]); } catch {} } } }
      else if (m[0] === 'EOSE' && subs[m[1]]) { const s = subs[m[1]]; s.eose = (s.eose || 0) + 1; if (s.eose === 1 && s.onEose) s.onEose(); }
      else if (m[0] === 'OK' && pending[m[1]] && m[2]) { const { chat, msgId } = pending[m[1]]; delete pending[m[1]]; mark(chat, msgId, 'sent'); } }
  }

  // ---------------------------------------------------------------- shared API for Echo (social): subscriptions + signed events
  const ECHO_KINDS = new Set([1414, 1416, 1417, 1418, 31414]);
  const hooks = { echo: [], reset: [], backup: [], restore: [], sync: [] }, subs = {}, subSeen = new Set();
  function req(id, filters, onEvent, onEose) { subs[id] = { filters, onEvent, onEose, eose: 0 }; for (const u of relays()) send(u, ['REQ', id, ...filters]); }
  function unreq(id) { if (!subs[id]) return; delete subs[id]; for (const u of relays()) send(u, ['CLOSE', id]); }
  function sign(ev) { return N.finalizeEvent({ created_at: now(), tags: [], content: '', ...ev }, sk); }
  function broadcast(ev) { for (const u of relays()) send(u, ['EVENT', ev]); return ev; }
  function wrapTo(pks, kind, content, tags = []) {      // private: one encrypted copy per recipient (+ me)
    const rumor = N.nip59.createRumor({ kind, content, tags, created_at: now() }, sk);
    const list = [...new Set(pks.filter(p => /^[0-9a-f]{64}$/.test(p) && p !== me))];
    for (const p of [...list, me]) { const w = wrapFor(rumor, p); if (p === me) seen.add(w.id); for (const u of relays()) send(u, ['EVENT', w]); }
    return rumor;
  }
  async function uploadEncrypted(blob) {      // returns {url, k, nonce, x, alt[], mime, size}
    const plain = new Uint8Array(await blob.arrayBuffer()), kb = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ck = await crypto.subtle.importKey('raw', kb, 'AES-GCM', false, ['encrypt']);
    const enc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ck, plain));
    const x = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc))); const got = []; let err = '';
    for (const h of hosts()) { if (got.length >= 2) break;
      try { const t = N.finalizeEvent({ kind: 24242, created_at: now(), content: 'Upload', tags: [['t', 'upload'], ['x', x], ['expiration', String(now() + 900)]] }, N.generateSecretKey());
        const res = await A.invRaw('blob_put', enc, { 'x-hush-server': h, 'x-hush-auth': btoa(unescape(encodeURIComponent(JSON.stringify(t)))) });
        got.push(res && /^https:\/\//.test(res.url) ? res.url : h.replace(/\/$/, '') + '/' + x); } catch (e) { err = String(e); } }
    if (!got.length) throw new Error(err || 'no host accepted the file');
    await putFile(x.slice(0, 32), blob);
    return { url: got[0], alt: got.slice(1), k: hex(kb), nonce: hex(iv), x, mime: blob.type, size: blob.size };
  }
  async function mediaUrl(meta) {      // download (through Tor) + verify + decrypt, cached in IndexedDB
    if (!meta || !/^[0-9a-f]{64}$/.test(meta.x || '')) return null;
    const id = meta.x.slice(0, 32); const u0 = await fileUrl(id); if (u0) return u0;
    for (const u of [meta.url, ...(meta.alt || [])].filter(z => /^https:\/\//.test(z || ''))) {
      try { const buf = new Uint8Array(await A.inv('blob_get', { url: u }));
        if (hex(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))) !== meta.x) continue;
        const ck = await crypto.subtle.importKey('raw', unhex(meta.k), 'AES-GCM', false, ['decrypt']);
        await putFile(id, new Blob([await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(meta.nonce) }, ck, buf)], { type: meta.mime || 'image/jpeg' }));
        return fileUrl(id); } catch {} }
    return null;
  }
  const api = { avatarHTML: (k, z) => avatarHTML(k, z), hydrate: el => hydrate(el), myProfile: () => profile(), ready: () => loadKey(), gate: (el, then) => gate(el, then), me: () => me, start, req, unreq, sign, broadcast, wrapTo, uploadEncrypted, mediaUrl, shrink,
    onEcho: f => hooks.echo.push(f), onReset: f => hooks.reset.push(f), onBackup: (get, put) => { hooks.backup.push(get); hooks.restore.push(put); }, npub, nameOf, colorOf, initials, contacts, profile, setProfile: p => LS.set('profile', p), status: () => status, okRelays,
    chatList: () => { if (!sk) return []; const c = contacts(); return [...new Set([...Object.keys(chats()), ...Object.keys(c).filter(k => !c[k].blocked && !c[k].request), ...Object.keys(groups())])].filter(k => k && k !== 'self').map(k => ({ key: k, name: chatName(k) })); },
    // Device sync: end-to-end encrypted messages from this ID to itself; every linked device (same ID) receives them.
    onSync: f => hooks.sync.push(f), syncSend: o => { if (!sk) return false; try { wrapTo([], K_SYNC, JSON.stringify(o).slice(0, 60000)); return true; } catch { return false; } }, hasId: () => !!sk,
    editPhoto: f => editPhoto(f),
    parseId: s => parseId(s),
    sendTo: (key, text) => { if (!sk || !key) return false; if (key === me) key = 'self';   /* the developer reporting to themselves lands in Notes to self */ sendText(key, String(text).slice(0, 4000), null); return true; },
    lockNow: () => { unlockedAt = 0; if (view.open) { A.close && A.close(); } },
    friends: () => { const c = contacts(); return Object.keys(c).filter(k => !c[k].blocked && !c[k].request && !c[k].auto); }, openChat: pk => { if (view.el) openChat(pk); } };

  // ---------------------------------------------------------------- receive
  const seen = new Set(LS.get('seen', []));
  const typing = {};   // chatKey -> {pk: until}
  function receive(wrap) {
    if (!wrap || wrap.kind !== 1059 || seen.has(wrap.id)) return; seen.add(wrap.id);
    if (seen.size % 25 === 0) LS.set('seen', [...seen].slice(-8000));
    let r; try { if (!N.verifyEvent(wrap)) return; r = N.nip59.unwrapEvent(wrap, sk); } catch { return; }
    if (ECHO_KINDS.has(r.kind)) { if (!contacts()[r.pubkey]?.blocked) hooks.echo.forEach(f => { try { f(r, 'private'); } catch (e) {} }); return; }   // Echo (private posts)
    if (r.kind === K_SYNC) { if (r.pubkey !== me || now() - r.created_at > 14 * 86400) return; let j; try { j = JSON.parse(r.content); } catch { return; } hooks.sync.forEach(f => { try { f(j, r.created_at); } catch (e) {} }); return; }   // browser sync between my own devices
    const ps = r.tags.filter(t => t[0] === 'p').map(t => t[1]).filter(p => /^[0-9a-f]{64}$/.test(p));
    const key = keyOf([r.pubkey, ...ps]) || (r.pubkey === me ? 'self' : ''); if (!key) return;
    if (members(key).some(pk => contacts()[pk]?.blocked) && !isGroup(key)) return;
    if ((r.kind === 14 || r.kind === 15) && r.tags.some(t => t[0] === 'hush-pq')) { const pt = pqOpen(r.content); r = { ...r, content: pt == null ? '🔒 This message used post-quantum encryption that this device can’t open (restore your backup or link this device again).' : pt, pqOk: pt != null }; }
    const mine = r.pubkey === me, tag = n => (r.tags.find(t => t[0] === n) || []);
    const subject = tag('subject')[1];
    if (isGroup(key) && subject) { const g = groups(); if (g[key]?.name !== subject.slice(0, 60)) { g[key] = { ...(g[key] || {}), name: subject.slice(0, 60) }; LS.set('groups', g); } }
    const nm = tag('hush-name')[1];
    // One-time invites: a valid, unused invite makes them a contact straight away (no request); then it's spent.
    const inv = tag('hush-invite')[1];
    if (inv && !mine && !isGroup(key)) { const iv = LS.get('invites', {}); if (iv[inv] && !iv[inv].used) { iv[inv].used = r.pubkey; LS.set('invites', iv); const c0 = contacts(); if (!c0[r.pubkey] || c0[r.pubkey].request) { c0[r.pubkey] = { ...(c0[r.pubkey] || {}), added: Date.now(), name: (tag('hush-name')[1] || 'New contact').slice(0, 40) }; delete c0[r.pubkey].request; LS.set('contacts', c0); A.toast('🎟 ' + c0[r.pubkey].name + ' joined with your invite'); } } }
    if (!mine && contacts()[r.pubkey]?.invite && !contacts()[r.pubkey]?.inviteAck) { const c1 = contacts(); c1[r.pubkey].inviteAck = true; LS.set('contacts', c1); }
    // Invite-only: strangers without a valid invite are dropped silently (no request, nothing stored).
    if (!mine && !isGroup(key) && prefs().inviteOnly && !contacts()[r.pubkey] && r.kind === 14) return;
    if (nm && !mine) { const c = contacts(); if (!c[r.pubkey]?.named && c[r.pubkey]?.name !== nm.slice(0, 40)) { c[r.pubkey] = { ...(c[r.pubkey] || {}), name: nm.slice(0, 40), added: c[r.pubkey]?.added || Date.now(), ...(c[r.pubkey] ? {} : isGroup(key) ? { auto: true } : { request: true }) }; LS.set('contacts', c); } }
    if (r.kind === K_PCARD) { if (mine) return; const c = contacts(); if (!c[r.pubkey] || c[r.pubkey].blocked) return;
      try { const j = JSON.parse(r.content); const okm = m => m && /^[0-9a-f]{64}$/.test(m.x || '') && /^https:\/\//.test(m.url || '') ? m : null;
        c[r.pubkey] = { ...c[r.pubkey], pq: /^[0-9a-f]{2368}$/.test(j.pq || '') ? j.pq : (c[r.pubkey].pq || null), status: String(j.status || '').slice(0, 80), aura: /^#[0-9a-f]{6}$/i.test(j.aura || '') ? j.aura : '', avatar: okm(j.avatar), banner: okm(j.banner), cardAt: r.created_at,
          ...(c[r.pubkey].named || !j.name ? {} : { name: String(j.name).slice(0, 40) }) }; LS.set('contacts', c); if (view.open) repaint(); } catch {} return; }
    if (r.kind === K_TOG) { if (mine || now() - r.created_at > 120) return; try { together.remote(key, r.pubkey, JSON.parse(r.content)); } catch {} return; }
    if (r.kind === K_TYPING) { if (!mine && now() - r.created_at < 20) { (typing[key] = typing[key] || {})[r.pubkey] = Date.now() + 7000; if (view.open && view.chat === key) paintTyping(); setTimeout(() => view.open && view.chat === key && paintTyping(), 7100); } return; }
    const all = chats(), list = all[key] || (all[key] = []);
    if (r.kind === K_READ) { if (mine) return; const upto = r.content; const i = list.findIndex(m => m.id === upto); if (i < 0) return;
      for (let j = 0; j <= i; j++) if (list[j].from === 'me') { list[j].read = [...new Set([...(list[j].read || []), r.pubkey])]; }
      if (typing[key]) delete typing[key][r.pubkey];
      all[key] = list; LS.set('chats', all); if (view.open && view.chat === key) repaint(); return; }
    if (r.kind === 15) return receiveRemote(key, r, list, all);
    if (r.kind === 14) {
      const f = tag('hush-file');
      if (f.length) return receiveChunk(key, r, f);
      if (list.some(x => x.id === r.id)) return;
      const who = mine ? 'me' : r.pubkey, ed = tag('hush-edit')[1], un = tag('hush-unsend')[1], pin = tag('hush-pin'), ttlSet = tag('hush-ttlset');
      if (ed) { const m = list.find(x => x.id === ed && x.from === who); if (m) { m.text = String(r.content).slice(0, 20000); m.edited = true; all[key] = list; LS.set('chats', all); if (view.open) repaint(); } return; }
      if (un) { const i = list.findIndex(x => x.id === un && x.from === who); if (i >= 0) { list[i] = { ...list[i], text: '', file: null, poll: null, unsent: true }; all[key] = list; LS.set('chats', all); if (view.open) repaint(); } return; }
      const loc = tag('hush-loc'); if (loc.length) { const [, la, lo, acc, until] = loc; const lat = +la, lon = +lo; if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
        const id = 'loc-' + (mine ? 'me' : r.pubkey); let m = list.find(x => x.id === id); if (!m) { m = { id, from: who, at: r.created_at * 1000, status: 'sent', text: '' }; list.push(m); }
        m.loc = { lat, lon, acc: Math.min(5000, +acc || 0), until: +until || 0, at: r.created_at * 1000 }; m.at = r.created_at * 1000; all[key] = list; LS.set('chats', all); if (view.open) repaint(); return; }
      const lab = tag('hush-label'); if (lab.length && isGroup(key)) { const g = groups(); if (/^[0-9a-f]{64}$/.test(lab[1] || '')) { g[key] = { ...(g[key] || {}), labels: { ...(g[key]?.labels || {}), [lab[1]]: String(lab[2] || '').slice(0, 24) } }; LS.set('groups', g); if (view.open) repaint(); } return; }
      const prot = tag('hush-protect'); if (prot.length) { const cs = chatSet(key); cs.protect = prot[1] === '1'; saveChatSet(key, cs); list.push({ id: r.id, from: who, sys: true, text: (mine ? 'You' : first(r.pubkey)) + (cs.protect ? ' turned on protected chat — no saving, copying or forwarding' : ' turned off protected chat'), at: r.created_at * 1000 }); all[key] = list; LS.set('chats', all); if (view.open) repaint(); return; }
      if (pin.length) { const cs = chatSet(key); cs.pin = pin[1] || null; saveChatSet(key, cs); if (view.open) repaint(); return; }
      if (ttlSet.length) { const cs = chatSet(key); cs.ttl = +ttlSet[1] || 0; saveChatSet(key, cs); list.push({ id: r.id, from: who, sys: true, text: (mine ? 'You' : first(r.pubkey)) + ' ' + (cs.ttl ? 'turned on disappearing messages — ' + ttlLabel(cs.ttl) : 'turned off disappearing messages'), at: r.created_at * 1000 }); all[key] = list; LS.set('chats', all); if (view.open) repaint(); return; }
      let poll = null; try { const pj = tag('hush-poll')[1]; if (pj) { const o = JSON.parse(pj); if (Array.isArray(o) && o.length >= 2) poll = o.slice(0, 10).map(x => String(x).slice(0, 80)); } } catch {}
      list.push({ id: r.id, from: who, text: String(r.content).slice(0, 20000), at: r.created_at * 1000, status: 'sent', reply: tag('e')[1], ttl: +tag('hush-ttl')[1] || 0, poll, once: !!tag('hush-once').length, tog: /^https?:\/\//.test(tag('hush-together')[1] || '') ? tag('hush-together')[1].slice(0, 2000) : null });
      if (typing[key]) delete typing[key][r.pubkey];
      arrived(key, r, list, all, String(r.content));
    } else if (r.kind === 7) {
      const target = tag('e')[1], m = list.find(x => x.id === target); if (!m) return;
      const who = mine ? 'me' : r.pubkey;
      if (/^poll:\d+$/.test(r.content || '') || (r.content === '' && m.poll && (m.votes || {})[who] != null)) { m.votes = m.votes || {}; if (r.content) m.votes[who] = +r.content.slice(5); else delete m.votes[who]; all[key] = list; LS.set('chats', all); if (view.open) repaint(); return; }
      m.react = m.react || {};
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
        const pn = prefs(), who = isGroup(key) ? chatName(key) + ' · ' + first(r.pubkey) : nameOf(r.pubkey), body = pn.nopreview ? 'New message' : preview.slice(0, 140);
        if (!pn.nonotif) {
          if (A.banner) A.banner({ key, name: who, text: body, ini: initials(isGroup(key) ? chatName(key) : nameOf(r.pubkey)), color: contacts()[r.pubkey]?.aura || '#4F46E5', unread: unreadTotal() });
          else A.toast('💬 ' + who + ': ' + body.slice(0, 60));
          if (A.notify && document.visibilityState === 'hidden') A.notify({ key, title: who, text: body, count: un[key] }); }
        if (A.onIncoming) A.onIncoming(key, initials(isGroup(key) ? chatName(key) : nameOf(r.pubkey)), contacts()[r.pubkey]?.aura || '#4F46E5'); }
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
    if (!m) { m = { id: 'f' + fid, from: r.pubkey === me ? 'me' : r.pubkey, text: '', at: r.created_at * 1000, status: 'sent', reply: (r.tags.find(t => t[0] === 'e') || [])[1], once: r.tags.some(t => t[0] === 'hush-once'), ttl: +((r.tags.find(t => t[0] === 'hush-ttl') || [])[1]) || 0,
      file: { id: fid, mime: String(mime).slice(0, 80), name: String(name).slice(0, 120), size: +size || 0, got: 0, total: n, have: [],
        kind: ['voice', 'vmsg'].includes((r.tags.find(t => t[0] === 'hush-kind') || [])[1]) ? (r.tags.find(t => t[0] === 'hush-kind') || [])[1] : '', dur: +((r.tags.find(t => t[0] === 'dur') || [])[1]) || 0 } }; list.push(m); }
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
  // Kind 15 (NIP-17 file message): url + AES-GCM key/nonce; Hush adds hush-kind (voice/video/vmsg), dur, name.
  async function receiveRemote(key, r, list, all) {
    if (list.some(x => x.id === r.id)) return;
    const t = n => (r.tags.find(x => x[0] === n) || [])[1];
    const url = String(r.content || ''), k = t('decryption-key'), nonce = t('decryption-nonce'), x = t('x');
    if (!/^https:\/\//.test(url) || !/^[0-9a-f]{64}$/.test(k || '') || !/^[0-9a-f]{24}$/.test(nonce || '') || !/^[0-9a-f]{64}$/.test(x || '')) return;
    const m = { id: r.id, from: r.pubkey === me ? 'me' : r.pubkey, text: '', at: r.created_at * 1000, status: 'sent', reply: (r.tags.find(z => z[0] === 'e') || [])[1],
      file: { id: x.slice(0, 32), mime: String(t('file-type') || 'application/octet-stream').slice(0, 80), name: String(t('name') || 'file').slice(0, 120), size: +t('size') || 0,
        kind: t('hush-kind') || '', dur: +t('dur') || 0, remote: { url, k, nonce, x, alt: r.tags.filter(z => z[0] === 'fallback').map(z => z[1]).filter(u => /^https:\/\//.test(u)).slice(0, 3) } } };
    list.push(m); arrived(key, r, list, all, m.file.kind === 'voice' ? '🎤 Voice message' : m.file.kind === 'vmsg' ? '📹 Video message' : m.file.mime.startsWith('image/') ? '📷 Photo' : m.file.mime.startsWith('video/') ? '🎬 Video' : '📎 ' + m.file.name);
    if (m.file.size <= AUTO_DL || m.file.kind) fetchRemote(key, m.id);
  }
  const fetching = new Set();
  async function fetchRemote(key, id) {
    if (fetching.has(id)) return; fetching.add(id);
    const get = () => (chats()[key] || []).find(z => z.id === id), upd = f => { const all = chats(), m = (all[key] || []).find(z => z.id === id); if (!m) return; f(m); LS.set('chats', all); if (view.open && view.chat === key) repaint(); };
    const m = get(); if (!m || m.file.done) return fetching.delete(id);
    upd(m => { m.file.loading = true; m.file.error = false; });
    let err = '';
    for (const u of [m.file.remote.url, ...(m.file.remote.alt || [])]) {
      try { const buf = new Uint8Array(await A.inv('blob_get', { url: u }));
        if (hex(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))) !== m.file.remote.x) throw new Error('file was changed');
        const ck = await crypto.subtle.importKey('raw', unhex(m.file.remote.k), 'AES-GCM', false, ['decrypt']);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(m.file.remote.nonce) }, ck, buf);
        await putFile(m.file.id, new Blob([plain], { type: m.file.mime }));
        upd(m => { m.file.done = true; m.file.loading = false; }); fetching.delete(id); return;
      } catch (e) { err = String(e.message || e); }
    }
    upd(m => { m.file.loading = false; m.file.error = err || 'download failed'; }); fetching.delete(id);
  }
  const unreadTotal = () => Object.values(LS.get('unread', {})).reduce((a, b) => a + b, 0);
  const badge = () => A.badge(unreadTotal());

  // ---------------------------------------------------------------- send
  const wrapFor = (rumor, pk) => N.nip59.createWrap(N.nip59.createSeal(rumor, sk, pk), pk);
  function publish(key, kind, content, extra = [], opt = {}) {
    const to = members(key), tags = [...to.map(p => ['p', p]), ...extra];
    if ((kind === 14 || kind === 15) && pqOn(key)) { content = pqSeal(key, content); tags.push(['hush-pq', '1']); }
    if (kind === 14 && contacts()[key]?.invite && !contacts()[key]?.inviteAck) tags.push(['hush-invite', contacts()[key].invite]);
    if (kind === 14 && chatSet(key).ttl && !extra.some(t => /^hush-(edit|unsend|pin|ttlset|protect)$/.test(t[0]))) tags.push(['hush-ttl', String(chatSet(key).ttl)]);
    if (kind === 14 && profile().name) tags.push(['hush-name', profile().name.slice(0, 40)]);
    if (kind === 14 && isGroup(key) && groups()[key]?.name) tags.push(['subject', groups()[key].name]);
    const rumor = N.nip59.createRumor({ kind, content, tags, created_at: now() }, sk);
    const wraps = to.map(p => wrapFor(rumor, p));
    if (!opt.noSelf) { const w = wrapFor(rumor, me); seen.add(w.id); wraps.push(w); }       // copy for my other devices
    const rs = relays(), spread = opt.spread ? rs.slice(0, opt.spread) : rs;
    for (const w of wraps) for (const u of spread) send(u, ['EVENT', w]);
    return { rumor, wrapId: wraps[0]?.id };
  }
  function addLocal(key, m, wrapId) {
    const all = chats(), list = all[key] || (all[key] = []); list.push(m); all[key] = list; LS.set('chats', all);
    if (wrapId) { pending[wrapId] = { chat: key, msgId: m.id }; setTimeout(() => { if (pending[wrapId]) mark(key, m.id, 'failed'); }, 60000); }
    repaint();
  }
  // Per-chat settings shared by both sides: pinned message, disappearing timer. Local-only: theme.
  const chatSet = key => LS.get('chatset', {})[key] || {};
  const saveChatSet = (key, v) => { const a = LS.get('chatset', {}); a[key] = v; LS.set('chatset', a); };
  const ttlLabel = t => t >= 604800 ? Math.round(t / 604800) + ' week' + (t >= 1209600 ? 's' : '') : t >= 86400 ? Math.round(t / 86400) + ' day' + (t >= 172800 ? 's' : '') : Math.round(t / 3600) + ' hour' + (t >= 7200 ? 's' : '');
  function control(key, tags, text = '') { const { rumor } = publish(key, 14, text, tags); return rumor; }
  // Disappearing messages: anything older than its timer is removed on both sides.
  function sweep() { const all = chats(); let ch = false; const n = Date.now();
    for (const k in all) { const l = all[k], keep = l.filter(m => !(m.ttl && m.at + m.ttl * 1000 < n)); if (keep.length !== l.length) { all[k] = keep; ch = true; } }
    if (ch) { LS.set('chats', all); if (view.open) repaint(); } }
  setInterval(sweep, 60000);
  // ---------------------------------------------------------------- Watch Together
  // Everyone in the chat opens the same page; the 🎬 controls (play, pause, skip, start together, bring everyone here)
  // apply on your screen and are sent to the others, encrypted like any message. Nothing is streamed — each person
  // plays the page themselves, so it works with any site that has a video.
  const together = (() => {
    let s = null;
    const label = { play: 'played', pause: 'paused', start: 'is starting it from the top', go: 'moved everyone to a new page' };
    function bar() { if (!A.togetherBar) return; if (!s) return A.togetherBar(null);
      A.togetherBar({ title: '🎬 ' + chatName(s.key), items: [['⏪ 10 s', 'skip:-10'], ['▶ Play', 'play'], ['⏸ Pause', 'pause'], ['⏩ 10 s', 'skip:10'], ['⟲ Start together', 'start'], ['🔗 Bring everyone to this page', 'go'], ['✕ Leave', 'end']] }, act); }
    function apply(o) {
      if (o.a === 'play' || o.a === 'pause') A.media(o.a);
      else if (o.a === 'skip' && isFinite(o.v)) A.media('skip', Math.max(-600, Math.min(600, +o.v)));
      else if (o.a === 'start') { A.media('pause'); A.media('seek', 0); setTimeout(() => A.media('play'), Math.max(0, Math.min(6000, (+o.at || 0) * 1000 - Date.now()))); }
      else if (o.a === 'go' && /^https?:\/\//.test(o.url || '')) { s.url = String(o.url).slice(0, 2000); A.open(s.url); } }
    function send(o) { if (s) publish(s.key, K_TOG, JSON.stringify(o), [], { noSelf: true, spread: 2 }); }
    function act(a) { if (!s) return;
      if (a === 'end') { send({ a: 'end' }); s = null; bar(); return A.toast('You left Watch Together'); }
      const [x, v] = a.split(':'), o = { a: x };
      if (v) o.v = +v; if (x === 'start') o.at = now() + 3;
      if (x === 'go') { const p = A.page && A.page(); if (!p) return A.toast('Open a page first'); o.url = p.url; s.url = p.url; send(o); return A.toast('Everyone is moving to this page'); }
      apply(o); send(o); if (x === 'start') A.toast('Starting from the top in 3 seconds…'); }
    return {
      join(key, url, host) { s = { key, url }; A.open(url); bar(); send({ a: 'join' });
        A.toast(host ? '🎬 Started — when they join, use the 🎬 controls so everyone stays in sync' : '🎬 Joined — use the 🎬 controls; play, pause and skip happen for everyone'); },
      remote(key, pk, o) { if (!s || s.key !== key) return;
        if (o.a === 'join') return A.toast('🎬 ' + first(pk) + ' joined');
        if (o.a === 'end') return A.toast('🎬 ' + first(pk) + ' left');
        if (!['play', 'pause', 'skip', 'start', 'go'].includes(o.a)) return;
        apply(o); A.toast('🎬 ' + first(pk) + ' ' + (o.a === 'skip' ? 'skipped ' + (o.v > 0 ? '+' : '') + o.v + ' s' : label[o.a])); },
      active: () => !!s };
  })();
  // ---------------------------------------------------------------- Live location (opt-in, per chat, for a set time)
  // Updates go only to that chat, encrypted like messages. It stops by itself; "Ghost mode" in your Hush ID turns all of it off.
  const liveLoc = (() => { const watch = {};
    function send(key, p, until) { publish(key, 14, '', [['hush-loc', p.coords.latitude.toFixed(5), p.coords.longitude.toFixed(5), String(Math.round(p.coords.accuracy || 0)), String(until)]], { noSelf: false }); }
    function stop(key, quiet) { const w = watch[key]; if (!w) return; navigator.geolocation.clearWatch(w.id); clearTimeout(w.t); delete watch[key];
      publish(key, 14, '', [['hush-loc', '0', '0', '0', '0']]); if (!quiet) A.toast('📍 Stopped sharing your location'); if (view.open) repaint(); }
    function start(key, mins) { if (prefs().ghost) return A.toast('👻 Ghost mode is on — turn it off in Your Hush ID to share location');
      if (!navigator.geolocation) return A.toast('Location isn’t available on this device');
      const until = now() + mins * 60; let last = null;
      const id = navigator.geolocation.watchPosition(p => { const t = Date.now(); if (last && t - last.t < 60000 && Math.hypot(p.coords.latitude - last.la, p.coords.longitude - last.lo) < 0.0003) return; last = { t, la: p.coords.latitude, lo: p.coords.longitude }; send(key, p, until); },
        e => { A.toast('Couldn’t get your location: ' + (e.message || 'permission denied')); stop(key, true); }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 });
      watch[key] = { id, t: setTimeout(() => stop(key), mins * 60000) }; A.toast('📍 Sharing your live location with ' + chatName(key) + ' for ' + (mins < 60 ? mins + ' min' : mins / 60 + ' h')); if (view.open) repaint(); }
    return { active: k => !!watch[k], stop, pick(key) { const v = overlay(`<h3>📍 Share live location</h3><p>Only ${esc(chatName(key))} sees it, encrypted and through Tor. It stops by itself — or tap stop any time.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${[[15, '15 minutes'], [60, '1 hour'], [480, '8 hours']].map(([m, l]) => `<button class=hm-btn data-m=${m}>${l}</button>`).join('')}<button class="hm-btn ghost" data-x>Cancel</button></div>`);
      v.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { v.remove(); start(key, +b.dataset.m); }); } }; })();
  function sendText(key, text, reply, opt2 = {}) {
    text = text.trim(); if (!text) return; A.haptic && A.haptic();
    const { rumor, wrapId } = publish(key, 14, text, [...(reply ? [['e', reply, '', 'reply']] : []), ...(opt2.poll ? [['hush-poll', JSON.stringify(opt2.poll)]] : []), ...(opt2.tog ? [['hush-together', opt2.tog]] : [])]);
    addLocal(key, { id: rumor.id, from: 'me', text, at: Date.now(), status: key === 'self' || okRelays() ? 'sending' : 'queued', reply, ttl: chatSet(key).ttl || 0, poll: opt2.poll || null, tog: opt2.tog || null }, wrapId);
    lastTypingSent = 0;
  }
  async function sendFile(key, file, opt = {}) {
    let blob = file, mime = file.type || 'application/octet-stream', name = file.name || 'file';
    if (/^image\/(jpeg|png|webp|heic|heif|gif|bmp)$/.test(mime) && mime !== 'image/gif') {       // photos: resized + compressed so they travel fast over Tor
      try { blob = await shrink(file, 1600, 0.78); mime = 'image/jpeg'; name = name.replace(/\.\w+$/, '') + '.jpg'; } catch {} }
    if (!opt.once && (blob.size > SMALL || opt.kind === 'vmsg' || /^video\//.test(mime))) return sendBig(key, blob, { mime, name, ...opt });
    if (opt.kind === 'voice') opt.extra = [['hush-kind', 'voice'], ['dur', String(Math.round(opt.dur || 0))]];
    if (opt.once) opt.extra = [...(opt.extra || []), ['hush-once', '1']];
    const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(blob); });
    const fid = hex(N.generateSecretKey()).slice(0, 32), n = Math.max(1, Math.ceil(b64.length / CHUNK));
    await putFile(fid, blob);
    const reply = view.reply; view.reply = null;
    const msg = { id: 'f' + fid, from: 'me', text: '', at: Date.now(), status: 'sending', reply, file: { id: fid, mime, name, size: blob.size, got: n, total: n, done: true, kind: opt.kind || '', dur: opt.dur || 0 }, once: !!opt.once, ttl: chatSet(key).ttl || 0 };
    addLocal(key, msg);
    for (let i = 0; i < n; i++) {
      const { wrapId } = publish(key, 14, b64.slice(i * CHUNK, (i + 1) * CHUNK),
        [['hush-file', fid, String(i), String(n), mime, name, String(blob.size)], ...(opt.extra || []), ...(reply && i === 0 ? [['e', reply, '', 'reply']] : [])], { noSelf: true });
      if (i === n - 1) pending[wrapId] = { chat: key, msgId: msg.id };
      if (i % 4 === 3) await new Promise(r => setTimeout(r, 120));    // don't flood the relays
    }
    setTimeout(() => mark(key, msg.id, okRelays() ? 'sent' : 'queued'), 3000);
  }
  // Big files, videos and video messages: encrypt here (AES-256-GCM), upload the ciphertext through Tor to two hosts,
  // then send the link + key in an encrypted kind-15 message. Hosts only ever see random bytes from an anonymous key.
  async function sendBig(key, blob, o) {
    if (blob.size > MAX_BIG) return A.toast('That file is too big — up to 100 MB');
    const fid = hex(N.generateSecretKey()).slice(0, 32), reply = view.reply; view.reply = null;
    await putFile(fid, blob);
    const msg = { id: 'f' + fid, from: 'me', text: '', at: Date.now(), status: 'sending', reply, file: { id: fid, mime: o.mime, name: o.name, size: blob.size, done: true, kind: o.kind || '', dur: o.dur || 0, up: true } };
    addLocal(key, msg);
    try {
      const plain = new Uint8Array(await blob.arrayBuffer()), kb = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
      const ck = await crypto.subtle.importKey('raw', kb, 'AES-GCM', false, ['encrypt']);
      const enc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ck, plain));
      const x = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc))), ox = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', plain)));
      const got = [];
      for (const h of hosts()) { if (got.length >= 2) break;
        try { const t = N.finalizeEvent({ kind: 24242, created_at: now(), content: 'Upload', tags: [['t', 'upload'], ['x', x], ['expiration', String(now() + 900)]] }, N.generateSecretKey());
          const auth = btoa(unescape(encodeURIComponent(JSON.stringify(t))));
          const res = await A.invRaw('blob_put', enc, { 'x-hush-server': h, 'x-hush-auth': auth });
          got.push(res && /^https:\/\//.test(res.url) ? res.url : h.replace(/\/$/, '') + '/' + x); } catch (e) { msg.lastErr = String(e); } }
      if (!got.length) throw new Error(msg.lastErr || 'no host accepted the file');
      const tags = [['file-type', o.mime], ['encryption-algorithm', 'aes-gcm'], ['decryption-key', hex(kb)], ['decryption-nonce', hex(iv)], ['x', x], ['ox', ox], ['size', String(blob.size)], ['name', o.name],
        ...got.slice(1).map(u => ['fallback', u]), ...(o.kind ? [['hush-kind', o.kind]] : []), ...(o.dur ? [['dur', String(Math.round(o.dur))]] : []), ...(reply ? [['e', reply, '', 'reply']] : [])];
      const { wrapId } = publish(key, 15, got[0], tags);
      const all = chats(), m = (all[key] || []).find(z => z.id === msg.id); if (m) { m.file.up = false; m.status = okRelays() ? 'sending' : 'queued'; LS.set('chats', all); }
      pending[wrapId] = { chat: key, msgId: msg.id }; repaint();
    } catch (e) { const all = chats(), m = (all[key] || []).find(z => z.id === msg.id); if (m) { m.file.up = false; m.status = 'failed'; LS.set('chats', all); }
      repaint(); A.toast('Couldn’t send the file: ' + String(e.message || e).slice(0, 120)); }
  }
  // Centre-crop an image to w×h (JPEG) — for profile photos and banners.
  // ---------------------------------------------------------------- Hush Card + QR scanner
  async function hushCard() {
    const p = profile(), id = npub(me), link = 'hush://add#' + id, aura = p.aura || colorOf(me);
    const v = document.createElement('div'); v.className = 'hm-view';
    v.innerHTML = `<div class=hm-hcard style="--aura:${aura}"><div class=top>${p.banner ? `<img data-av='${esc(JSON.stringify(p.banner))}' alt="">` : ''}</div>
      <div class=who>${avatarHTML(me, 84)}<h3>${esc(p.name || 'Hush user')}</h3>${p.status ? `<p>${esc(p.status)}</p>` : ''}</div>
      <div class=qr>${A.qr ? A.qr(link) : ''}</div><div class=tag>Scan with Hush to message me privately · ${esc(id.slice(0, 12))}…</div></div>
      <div class=bar style="display:flex;gap:10px;margin-top:14px"><button class=hm-btn data-a=save>Save image</button>${navigator.share ? '<button class=hm-btn data-a=share>Share</button>' : ''}<button class="hm-btn ghost" data-a=x style="color:#fff;border-color:#fff6">Close</button></div>`;
    document.body.append(v); hydrate(v);
    v.onclick = async e => { const a = e.target.dataset?.a; if (e.target === v || a === 'x') return v.remove();
      if (a === 'save' || a === 'share') { const blob = await cardImage(v.querySelector('.hm-hcard')); if (!blob) return A.toast('Couldn’t make the image');
        if (a === 'share') navigator.share({ files: [new File([blob], 'My Hush Card.png', { type: 'image/png' })], title: 'My Hush Card' }).catch(() => {});
        else saveBlob(blob, 'My Hush Card.png'); } };
  }
  // Draw the card to a PNG (photo, name, status, QR) for saving/sharing.
  async function cardImage(card) {
    const W = 720, H = 1000, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), p = profile(), aura = p.aura || colorOf(me);
    const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
    g.fillStyle = '#ffffff'; rr(0, 0, W, H, 48); g.fill(); g.save(); rr(0, 0, W, 300, [48, 48, 0, 0]); g.clip();
    const top = card.querySelector('.top img'); if (top && top.complete && top.naturalWidth) g.drawImage(top, 0, 0, W, 300); else { const gr = g.createLinearGradient(0, 0, W, 300); gr.addColorStop(0, aura); gr.addColorStop(1, '#f4f4f5'); g.fillStyle = gr; g.fillRect(0, 0, W, 300); }
    g.restore();
    const av = card.querySelector('.hm-av img'); g.save(); g.beginPath(); g.arc(W / 2, 300, 92, 0, 7); g.fillStyle = aura; g.fill(); g.beginPath(); g.arc(W / 2, 300, 84, 0, 7); g.clip();
    if (av && av.complete && av.naturalWidth) g.drawImage(av, W / 2 - 84, 216, 168, 168); else { g.fillStyle = colorOf(me); g.fillRect(W / 2 - 84, 216, 168, 168); g.fillStyle = '#fff'; g.font = '600 64px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(initials(p.name || 'Hush'), W / 2, 302); }
    g.restore(); g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.font = '700 46px system-ui'; g.fillText(p.name || 'Hush user', W / 2, 450);
    if (p.status) { g.fillStyle = '#666'; g.font = '30px system-ui'; g.fillText(p.status.slice(0, 40), W / 2, 496); }
    const svg = card.querySelector('.qr svg'); if (svg) { const u = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      await new Promise(r => { const im = new Image(); im.onload = () => { g.drawImage(im, W / 2 - 190, 540, 380, 380); r(); }; im.onerror = r; im.src = u; }); }
    g.fillStyle = '#888'; g.font = '24px system-ui'; g.fillText('Scan with Hush to message me privately', W / 2, 960);
    return new Promise(r => c.toBlob(r, 'image/png'));
  }
  // In-app scanner: BarcodeDetector where available (Android), jsQR otherwise (Windows).
  async function scan(custom) {
    let st; try { st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch { return A.toast('Hush needs the camera to scan — allow it and try again'); }
    const v = document.createElement('div'); v.className = 'hm-view';
    v.innerHTML = `<div class=hm-scan><video playsinline muted autoplay></video><i></i></div><p style="color:#fff;margin:14px">${custom ? 'Point at the link code on your other device' : 'Point at a Hush Card or Murmur QR code'}</p><button class="hm-btn ghost" style="color:#fff;border-color:#fff6" data-x>Cancel</button>`;
    document.body.append(v); const vid = v.querySelector('video'); vid.srcObject = st;
    const det = 'BarcodeDetector' in window ? new BarcodeDetector({ formats: ['qr_code'] }) : null, cv = document.createElement('canvas'), g = cv.getContext('2d', { willReadFrequently: true });
    let on = true; const stop = () => { on = false; st.getTracks().forEach(t => t.stop()); v.remove(); };
    v.querySelector('[data-x]').onclick = stop;
    const found = txt => { if (custom) { if (!custom(txt)) return false; stop(); return true; } const pk = parseId(txt); if (!pk) return false; stop(); if (pk === me) { A.toast('That’s your own card'); return true; }
      addContact(pk, null, inviteOf(txt), true); A.toast('Added and verified in person ✓ — say hi 👋'); openChat(pk); return true; };
    const tick = async () => { if (!on) return;
      try { if (vid.readyState >= 2) {
        if (det) { const r = await det.detect(vid); if (r[0] && found(r[0].rawValue)) return; }
        else if (N.jsQR) { const w = Math.min(640, vid.videoWidth), h = Math.round(vid.videoHeight * w / vid.videoWidth); cv.width = w; cv.height = h; g.drawImage(vid, 0, 0, w, h);
          const r = N.jsQR(g.getImageData(0, 0, w, h).data, w, h); if (r && found(r.data)) return; } } } catch {}
      setTimeout(tick, 180); };
    tick();
  }
  function crop(file, w, h) { return new Promise((res, rej) => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = w; c.height = h;
    const r = Math.max(w / img.width, h / img.height), sw = w / r, sh = h / r; c.getContext('2d').drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
    URL.revokeObjectURL(img.src); c.toBlob(b => b ? res(b) : rej(new Error('image')), 'image/jpeg', 0.85); }; img.onerror = () => rej(new Error('Not an image')); img.src = URL.createObjectURL(file); }); }
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
  function sendTyping(key) { if (key === 'self' || !prefs().typing || Date.now() - lastTypingSent < 5000) return; lastTypingSent = Date.now(); publish(key, K_TYPING, '', [], { noSelf: true, spread: 2 }); }
  function mark(key, id, st) { const all = chats(), m = (all[key] || []).find(x => x.id === id); if (m && m.status !== 'sent') { m.status = st; LS.set('chats', all); if (view.open) repaint(); } }
  function resend(key, m) { const all = chats(); all[key] = (all[key] || []).filter(x => x.id !== m.id); LS.set('chats', all); if (m.file) { getFile(m.file.id).then(b => b && sendFile(key, new File([b], m.file.name, { type: m.file.mime }))); } else sendText(key, m.text, m.reply); }

  // ---------------------------------------------------------------- UI
  const css = `
.hm{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;color:var(--ink);font:14px/1.4 ui-sans-serif,system-ui,"Segoe UI",sans-serif}
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

  // Murmur v2 look: calm glass surfaces, roomy rows, soft bubbles, one accent. Pure styling on the same markup.
  // Composer: a roomy, readable message box (it used to be squeezed to nothing between the buttons).
  const css4 = `
.hm-c{gap:6px;align-items:flex-end;padding:8px 10px calc(8px + env(safe-area-inset-bottom,0px))}
.hm-c textarea{flex:1 1 auto;width:0;min-width:0;min-height:44px;box-sizing:border-box;padding:12px 18px;border-radius:24px;border:1px solid color-mix(in srgb,var(--ink) 14%,transparent);background:color-mix(in srgb,var(--ink) 7%,var(--bg));color:var(--ink);-webkit-text-fill-color:var(--ink);caret-color:var(--acc);font:16px/1.4 system-ui,-apple-system,sans-serif;max-height:140px;overflow-y:auto}
.hm-c textarea::placeholder{color:var(--mute);-webkit-text-fill-color:var(--mute);opacity:1}
.hm-c textarea:focus{border-color:color-mix(in srgb,var(--acc) 60%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--acc) 18%,transparent)}
.hm-c .hm-ib{flex:none;width:40px;height:44px;border-radius:50%;background:transparent}
.hm-c .hm-send{flex:none;width:44px;height:44px;animation:hmpop .18s cubic-bezier(.2,1.4,.4,1)}
@keyframes hmpop{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}
@media (max-width:600px){.hm-c{gap:4px;padding-left:6px;padding-right:6px}.hm-c .hm-ib{width:34px}.hm-c #hm-att,.hm-c #hm-share{display:none!important}.hm-c textarea{padding:11px 16px}}`;
  const css3 = `
.hm{--mr:20px;--sp:14px;letter-spacing:-.005em}
.hm-h{padding:calc(12px + env(safe-area-inset-top,0px)*0) 16px 12px;border-bottom:0;background:linear-gradient(var(--bg),color-mix(in srgb,var(--bg) 92%,transparent));position:relative;z-index:2}
.hm-h h2{font:700 24px/1.1 system-ui;letter-spacing:-.02em}
.hm-ib{width:38px;height:38px;background:color-mix(in srgb,var(--ink) 7%,transparent);transition:background .15s,transform .15s}.hm-ib:hover{background:color-mix(in srgb,var(--ink) 13%,transparent)}.hm-ib:active{transform:scale(.92)}
.hm-st{padding:3px 9px;border-radius:99px;background:color-mix(in srgb,var(--ink) 6%,transparent);width:max-content}
.hm-search{margin:4px 16px 10px;width:calc(100% - 32px);padding:11px 16px;border-radius:99px;border:0;background:color-mix(in srgb,var(--ink) 7%,transparent);transition:background .15s,box-shadow .15s}.hm-search:focus{outline:none;background:color-mix(in srgb,var(--ink) 10%,transparent);box-shadow:0 0 0 2px color-mix(in srgb,var(--acc) 45%,transparent)}
.hm-folders{padding:0 16px 10px!important;scrollbar-width:none}.hm-folders::-webkit-scrollbar{display:none}.hm-chip{transition:background .15s,transform .15s;border:0!important;background:color-mix(in srgb,var(--ink) 7%,transparent)}.hm-chip:active{transform:scale(.95)}
.hm-row{margin:0 8px;width:calc(100% - 16px)!important;padding:11px 12px;border-radius:18px;transition:background .15s,transform .12s}.hm-row:hover{background:color-mix(in srgb,var(--ink) 6%,transparent)}.hm-row:active{transform:scale(.985)}
.hm-row .t b{font:600 15.5px system-ui;letter-spacing:-.01em}.hm-row .t span{font-size:13.5px;margin-top:1px}
.hm-row.unread .t b{font-weight:750}.hm-row.unread .t span{color:var(--ink);opacity:.85}.hm-row.unread em{color:var(--ink)}
.hm-row .u{background:var(--acc);box-shadow:0 2px 10px color-mix(in srgb,var(--acc) 40%,transparent);min-width:20px;text-align:center;padding:2px 7px}
.hm-av{width:50px;height:50px;font-size:17px;box-shadow:inset 0 0 0 1px #ffffff22,0 2px 8px #0002}
.hm-fab{width:58px;height:58px;border-radius:20px;right:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));box-shadow:0 10px 30px color-mix(in srgb,var(--acc) 35%,#0008),inset 0 1px 0 #fff3;transition:transform .15s}.hm-fab:active{transform:scale(.93)}
.hm-msgs{padding:14px 14px 8px;gap:2px}
.hm-m{padding:9px 14px;border-radius:20px;font-size:15px;line-height:1.38;box-shadow:0 1px 2px #0001;animation:hmIn .22s cubic-bezier(.2,.9,.25,1)}@keyframes hmIn{from{opacity:0;transform:translateY(6px) scale(.98)}}
.hm-m.me{background:linear-gradient(155deg,color-mix(in srgb,var(--acc) 100%,#fff 0%),color-mix(in srgb,var(--acc) 93%,#000));border-bottom-right-radius:7px}
.hm-m.them{background:color-mix(in srgb,var(--ink) 7%,var(--bg));border:0;border-bottom-left-radius:7px}
.hm-m.me+.hm-m.me{border-top-right-radius:7px;margin-top:1px}.hm-m.them+.hm-m.them{border-top-left-radius:7px;margin-top:1px}
.hm-day{border:0;background:color-mix(in srgb,var(--ink) 7%,transparent);font-weight:650;letter-spacing:.02em}
.hm-c{align-items:flex-end;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));border-top:0;background:linear-gradient(transparent,var(--bg) 30%)}
.hm-c textarea{border:0;background:color-mix(in srgb,var(--ink) 8%,transparent);border-radius:24px;padding:11px 16px;font-size:15px;transition:box-shadow .15s}.hm-c textarea:focus{box-shadow:0 0 0 2px color-mix(in srgb,var(--acc) 40%,transparent)}
.hm-send{width:44px;height:44px;box-shadow:0 6px 18px color-mix(in srgb,var(--acc) 35%,#0006);transition:transform .15s}.hm-send:active{transform:scale(.9)}
.hm-menu{border:1px solid color-mix(in srgb,var(--ink) 10%,transparent);background:color-mix(in srgb,var(--card) 90%,transparent);backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4);border-radius:18px;box-shadow:0 18px 50px #0006}
.hm-card{border:0;background:color-mix(in srgb,var(--ink) 5%,var(--bg));border-radius:22px}.hm-btn{border-radius:99px;padding:10px 18px}.hm-in{border:0;background:color-mix(in srgb,var(--ink) 7%,transparent);border-radius:14px}
.hm-body{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--ink) 22%,transparent) transparent}.hm-body::-webkit-scrollbar{width:8px}.hm-body::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--ink) 22%,transparent);border-radius:99px;border:2px solid transparent;background-clip:padding-box}
.hm-pinbar{border-bottom:0;background:color-mix(in srgb,var(--ink) 6%,var(--bg));margin:0 12px;border-radius:14px}
@media (prefers-reduced-motion:reduce){.hm-m{animation:none}}`;
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
.hm-drop{outline:3px dashed var(--acc);outline-offset:-8px}
.hm-pq{display:block;margin-bottom:8px}.hm-m.pollb{min-width:240px}.hm-po{display:flex!important;align-items:center;gap:8px;width:100%;position:relative;overflow:hidden;padding:8px 10px;margin:4px 0;border-radius:10px;border:1px solid color-mix(in srgb,currentColor 25%,transparent)}
.hm-po i{position:absolute;left:0;top:0;bottom:0;background:color-mix(in srgb,currentColor 14%,transparent)}.hm-po span{position:relative;flex:1}.hm-po em{position:relative;font-style:normal;font-weight:700}.hm-po.on{border-color:currentColor;font-weight:600}
.hm-pinbar{display:flex;gap:8px;align-items:center;padding:7px 14px;font-size:12.5px;border-bottom:1px solid var(--line);background:var(--card);cursor:pointer;flex:none}.hm-pinbar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hm-flash{animation:hmfl 1.2s}@keyframes hmfl{30%{box-shadow:0 0 0 4px var(--acc)}}.hm-curtain .hm-body,.hm-curtain .hm-row{filter:blur(14px)}
.hm .hm-body{background:var(--bg)}.hm{background:var(--bg);color:var(--ink)}
.hm-banner{height:120px;position:relative;background:var(--card)}.hm-banner img{display:block}.hm-bannerbtn{position:absolute;right:10px;top:10px;background:#0008;color:#fff;font:600 12px system-ui;padding:5px 10px;border-radius:99px;cursor:pointer}
.hm-cam{position:absolute;right:-2px;bottom:-2px;background:var(--bg);border:1px solid var(--line);border-radius:50%;width:28px;height:28px;display:grid;place-items:center;font-size:13px}
.hm-auras{display:flex;gap:8px;flex-wrap:wrap}.hm-auras button{width:28px;height:28px;border-radius:50%;border:2px solid var(--line);font-size:12px;display:grid!important;place-items:center;color:var(--mute)}.hm-auras button.on{outline:3px solid var(--acc);outline-offset:2px}
.hm-hcard{width:min(340px,88vw);background:#fff;color:#111;border-radius:24px;overflow:hidden;text-align:center;box-shadow:0 20px 60px #0008}.hm-hcard .top{height:120px;background:linear-gradient(135deg,var(--aura),#f4f4f5)}.hm-hcard .top img{width:100%;height:100%;object-fit:cover}
.hm-hcard .who{margin-top:-44px}.hm-hcard .who .hm-av{margin:auto;box-shadow:0 0 0 4px #fff,0 0 0 8px var(--aura)!important}.hm-hcard h3{margin:10px 0 2px;font:700 21px system-ui}.hm-hcard p{margin:0;color:#666;font-size:14px}
.hm-hcard .qr{width:190px;height:190px;margin:14px auto 6px}.hm-hcard .qr svg{width:100%;height:100%}.hm-hcard .tag{font-size:11.5px;color:#888;padding:0 16px 16px}
.hm-scan{position:relative;width:min(80vw,360px);aspect-ratio:1;border-radius:24px;overflow:hidden;background:#000}.hm-scan video{width:100%;height:100%;object-fit:cover}.hm-scan i{position:absolute;inset:18%;border:3px solid #fff;border-radius:18px;box-shadow:0 0 0 999px #0006}
.hm-ver{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;background:#22c55e;color:#fff;font:700 10px system-ui;vertical-align:middle}
.hm-lock{z-index:90;background:color-mix(in srgb,var(--bg) 94%,transparent);backdrop-filter:blur(12px)}.hm-pin{text-align:center;color:var(--ink)}.hm-pin h3{font:600 17px system-ui;margin:8px 0 14px}
.hm-pin .dots{font-size:22px;letter-spacing:8px;height:30px;margin-bottom:14px}.hm-pin .pad{display:grid;grid-template-columns:repeat(3,72px);gap:12px;justify-content:center;margin-bottom:16px}
.hm-pin .pad button{all:unset;cursor:pointer;width:72px;height:72px;border-radius:50%;background:var(--card);border:1px solid var(--line);font:500 24px system-ui;display:grid;place-items:center}.hm-pin .pad button:disabled{visibility:hidden}
.hm-pin.shake{animation:hmsh .35s}@keyframes hmsh{25%{transform:translateX(-10px)}75%{transform:translateX(10px)}}
.hm-words{columns:2;font:14px ui-monospace,monospace;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:12px 12px 12px 34px;margin:0 0 10px;user-select:text}
.hm .hide{display:none!important}
.hm-ind{width:35%!important;animation:hmind 1.1s ease-in-out infinite alternate}@keyframes hmind{from{margin-left:0}to{margin-left:65%}}
.hm-voice{display:flex;align-items:center;gap:8px;min-width:220px}.hm-voice .pp{width:34px;height:34px;border-radius:50%;background:#0002;display:grid!important;place-items:center;font-size:13px;flex:none}
.hm-m.me .hm-voice .pp{background:#fff3}.hm-voice canvas{flex:1;height:30px;width:150px;cursor:pointer}.hm-voice .d{font-size:11.5px;opacity:.8;min-width:30px}.hm-voice .sp{font:700 11px system-ui;padding:3px 7px;border-radius:99px;background:#0002}
.hm-m.voice{padding:8px 10px}.hm-m.vmsgb{background:none!important;border:0!important;padding:0}.hm-m.vmsgb .tm{float:none;display:block;text-align:right;color:var(--mute)}
.hm-vmsg{position:relative;width:200px;height:200px;border-radius:50%;overflow:hidden;cursor:pointer;background:#000}.hm-vmsg video{width:100%;height:100%;object-fit:cover}
.hm-vmsg .d,.hm-vmsg .snd{position:absolute;bottom:14px;font:600 11px system-ui;color:#fff;background:#0008;border-radius:99px;padding:2px 7px}.hm-vmsg .d{left:22px}.hm-vmsg .snd{right:22px}.hm-vmsg.on{outline:3px solid var(--acc)}
.hm-c .hm-mic{background:var(--acc)}.hm-rec{position:absolute;left:0;right:0;bottom:0;z-index:30;display:flex;flex-direction:column;align-items:center;pointer-events:none}
.hm-rec .hm-recbar{pointer-events:auto;width:100%;display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg);border-top:1px solid var(--line);font:600 14px system-ui;min-height:57px}
.hm-rec .dot{width:10px;height:10px;border-radius:50%;background:#ef4444;animation:hmp .8s infinite alternate}.hm-rec .hint{flex:1;color:var(--mute);font-weight:500;transition:opacity .1s}.hm-rec .lockh{color:var(--mute);font-size:12px;font-weight:500}
.hm-rec .cx{font-size:18px;padding:6px}.hm-cv{position:relative;width:min(70vw,300px);aspect-ratio:1;border-radius:50%;overflow:hidden;margin-bottom:24px;box-shadow:0 12px 50px #0006}
.hm-cv video{width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}.hm-cv .ring{position:absolute;inset:0;border-radius:50%;background:conic-gradient(#ef4444 calc(var(--p,0)*360deg),transparent 0);-webkit-mask:radial-gradient(circle,transparent 66%,#000 67%);mask:radial-gradient(circle,transparent 66%,#000 67%)}`;
  if (!document.getElementById('hm-css')) { const s = document.createElement('style'); s.id = 'hm-css'; s.textContent = css + css2 + css3 + css4; document.head.append(s); }
  const I = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>', plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>', send: '<svg viewBox="0 0 24 24"><path d="M3 20l18-8L3 4v6l12 2-12 2z"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
    clip: '<svg viewBox="0 0 24 24"><path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/></svg>',
    group: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-4 3-6 7-6s7 2 7 6M16 4.5a3.5 3.5 0 0 1 0 7M22 20c0-3-1.5-5-4-5.7"/></svg>',
    mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    cam: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
    qr: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M21 14v7h-4M14 21v-3"/></svg>' };
  const view = { open: false, el: null, screen: 'list', chat: null, reply: null, q: '', pick: new Set() };
  const time = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = t => { const d = new Date(t), n = new Date(); const y = new Date(); y.setDate(n.getDate() - 1);
    return d.toDateString() === n.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); };
  const short = t => { const d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString() ? time(t) : (n - d < 6 * 864e5 ? d.toLocaleDateString([], { weekday: 'short' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' })); };
  const dur = s => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const size = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  // Tap-to-remind: "tomorrow 7pm", "Friday at 6:30", "8pm" become a button that sets a reminder (kept on this device).
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  function whenOf(txt) { const m = String(txt).toLowerCase().match(/\b(today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)?\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/); if (!m) return null;
    let h = +m[2] % 12 + (m[4] === 'pm' ? 12 : 0), mi = +(m[3] || 0); if (h > 23 || mi > 59) return null; const d = new Date(); d.setSeconds(0, 0); d.setHours(h, mi);
    if (m[1] === 'tomorrow') d.setDate(d.getDate() + 1); else if (DAYS.includes(m[1])) { let k = (DAYS.indexOf(m[1]) - d.getDay() + 7) % 7; if (k === 0 && d < new Date()) k = 7; d.setDate(d.getDate() + k); } else if (d < new Date()) d.setDate(d.getDate() + 1);
    return { at: d.getTime(), text: m[0].trim() }; }
  const linkify = s => { let h = esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)"'\]]/g, u => `<a href="#" data-u="${u}">${u.length > 60 ? u.slice(0, 57) + '…' : u}</a>`); const w = whenOf(s);
    if (w) h = h.replace(new RegExp(esc(w.text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i'), x => `<a href="#" class=hm-when data-when="${w.at}" title="Tap for a reminder">⏰ ${x}</a>`); return h; };
  function remindersTick() { const l = LS.get('reminders', []), now0 = Date.now(), due = l.filter(r => r.at <= now0); if (!due.length) return; LS.set('reminders', l.filter(r => r.at > now0));
    for (const r of due) { A.toast('⏰ ' + r.text.slice(0, 100)); try { if (Notification.permission === 'granted') new Notification('Hush reminder', { body: r.text.slice(0, 140) }); } catch {} } }
  setInterval(remindersTick, 30000); setTimeout(remindersTick, 5000);
  // Avatars: profile photo (encrypted, from the person's profile card) or initials; optional "aura" ring colour.
  function avatarHTML(key, sz = 44) {
    if (key === 'self') return `<div class=hm-av style="background:var(--acc);color:var(--bg);width:${sz}px;height:${sz}px;font-size:${Math.round(sz / 2.4)}px">✎</div>`;
    if (isGroup(key)) return `<div class=hm-av style="background:${colorOf(key)};width:${sz}px;height:${sz}px">${I.group.replace('<svg', `<svg style="width:${sz / 2}px;height:${sz / 2}px;stroke:#fff;fill:none;stroke-width:1.8"`)}</div>`;
    const c = key === me ? profile() : (contacts()[key] || {}), nm = key === me ? (profile().name || 'Me') : nameOf(key);
    const ring = /^#[0-9a-f]{6}$/i.test(c.aura || '') ? `;box-shadow:0 0 0 2px var(--bg),0 0 0 ${Math.max(3, Math.round(sz / 14))}px ${c.aura}` : '';
    const img = c.avatar && /^[0-9a-f]{64}$/.test(c.avatar.x || '') ? `<img data-av='${esc(JSON.stringify(c.avatar))}' alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;opacity:0;transition:opacity .2s">` : '';
    return `<div class=hm-av style="position:relative;background:${colorOf(key)};width:${sz}px;height:${sz}px;font-size:${Math.round(sz / 2.9)}px${ring}">${esc(initials(nm))}${img}</div>`;
  }
  const avatar = avatarHTML;
  function hydrate(el) { (el || document).querySelectorAll('img[data-av]:not([data-ok])').forEach(async im => { im.dataset.ok = 1;
    try { const u = await mediaUrl(JSON.parse(im.dataset.av)); if (u) { im.src = u; im.onload = () => im.style.opacity = 1; } } catch {} }); }
  const preview = m => m.loc ? '📍 Live location' : m.file ? (m.file.kind === 'voice' ? '🎤 Voice message' : m.file.kind === 'vmsg' ? '📹 Video message' : m.file.mime.startsWith('image/') ? '📷 Photo' : m.file.mime.startsWith('video/') ? '🎬 Video' : '📎 ' + m.file.name) : m.text;
  function paintStatus() { const e = view.el && view.el.querySelector('.hm-st'); if (!e) return;
    if (view.screen === 'chat' && typingNames().length) return paintTyping();
    const s = status.startsWith('error') ? 'error' : status; e.className = 'hm-st ' + s;
    e.innerHTML = `<i></i>${s === 'on' ? (view.screen === 'chat' && isGroup(view.chat) ? `${members(view.chat).length + 1} people · ` : '') + `Private${view.screen === 'chat' && pqOn(view.chat) ? ' · quantum-safe' : ''} · through Tor · ${okRelays()} relay${okRelays() === 1 ? '' : 's'}` : s === 'connecting' ? 'Connecting through Tor…' : s === 'error' ? 'Can’t reach Tor — retrying' : 'Offline'}`; }
  function typingNames() { const t = typing[view.chat] || {}, n = Date.now(); return Object.entries(t).filter(([, u]) => u > n).map(([pk]) => first(pk)); }
  function paintTyping() { const e = view.el && view.el.querySelector('.hm-st'); if (!e) return; const ns = typingNames();
    if (!ns.length) { e.classList.remove('hm-typing'); return paintStatus(); }
    e.className = 'hm-st hm-typing'; e.innerHTML = `${isGroup(view.chat) ? esc(ns.join(', ')) + (ns.length > 1 ? ' are' : ' is') + ' typing' : 'typing'}<span class=hm-dots><i></i><i></i><i></i></span>`; }
  async function open(el, chat) { view.open = true; view.el = el; if (chat) { view.screen = 'chat'; view.chat = chat; }
    el.innerHTML = '<div class="hm hm-mur"><div class=hm-empty>…</div></div>';
    if (!await loadKey()) { view.screen = view.screen === 'restore' ? 'restore' : 'welcome'; repaint(); return; }
    gate(el, () => { if (view.el !== el) return; start(); repaint(); if (view.screen === 'chat') sendRead(view.chat); }); }
  function close() { view.open = false; view.el = null; document.querySelector('.hm-menu')?.remove(); }
  function repaint() { if (!view.open || !view.el) return;
    if (rec) { view.dirty = true; return; }      // never tear down the screen while recording
    const ta = view.el.querySelector('textarea'), keep = ta?.value, focused = document.activeElement === ta, scr = view.screen;
    const sc = view.el.querySelector('#hm-scroll'), atBottom = !sc || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80, top = sc?.scrollTop;
    ({ welcome: drawWelcome, list: drawList, chat: drawChat, add: drawAdd, group: drawGroup, me: drawMe, verify: drawVerify, restore: drawRestore, backup: drawBackup }[scr] || drawList)();
    if (scr === 'chat') { const t = view.el.querySelector('textarea'); if (t && keep) { t.value = keep; t.oninput(); } if (t && focused) t.focus();
      const s2 = view.el.querySelector('#hm-scroll'); if (s2) s2.scrollTop = atBottom ? s2.scrollHeight : top; }
    paintStatus(); hydrate(view.el); }
  const head = (title, sub, left, right) => `<div class=hm-h>${left || ''}<div style="flex:1;min-width:0"><h2>${title}</h2>${sub || ''}</div>${right || ''}</div>`;
  const closeB = () => A.close ? `<button class=hm-ib data-close aria-label=Close>${I.x}</button>` : '';
  function wireCommon() { view.el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { view.screen = b.dataset.go; repaint(); });
    view.el.querySelectorAll('[data-close]').forEach(b => b.onclick = () => A.close && A.close()); }

  function drawWelcome() {
    view.el.innerHTML = `<div class="hm hm-mur">${head('Murmur', '<small>Private messages</small>', '', closeB())}<div class=hm-body>
      <div class=hm-card style="text-align:center"><div style="font-size:42px">💬</div><h3 style="font-size:22px;font-family:ui-serif,Georgia,serif;font-weight:400">murmur.</h3><p style="margin-top:-4px"><b>Private messages, built into Hush</b></p>
      <p>Chat, share photos and files, and make group chats with other Hush users. Everything is end-to-end encrypted and always sent through <b>Tor</b> — no server ever sees what you say, who you are, or where you are. No phone number, no email, no account.</p>
      <input class=hm-in id=hm-name placeholder="Your name (what friends see)" maxlength=40 style="text-align:center">
      <button class=hm-btn id=hm-go>Start messaging</button><p style="margin:12px 0 0;display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="hm-btn ghost" id=hm-link>📱 Link from my other device</button><button class="hm-btn ghost" id=hm-restore>I have a backup</button></p></div>
      <div class=hm-card><h3>How it stays private</h3><p>🔒 Only the people in a chat can read it — photos and files too.</p><p>🧅 Every connection goes through Tor — your IP address is never shown to anyone.</p><p>✉️ Each message is sealed in an outer envelope from a throwaway key, so relays can’t tell who sent it.</p><p>📱 Your contacts and chats stay on this device.</p><p style="margin:0">🎤 Mic and camera turn on only while you hold the record button. Recordings are made and encrypted on your device, and Hush keeps no copies.</p></div></div></div>`;
    wireCommon();
    view.el.querySelector('#hm-restore').onclick = () => { view.screen = 'restore'; repaint(); };
    view.el.querySelector('#hm-link').onclick = linkJoin;
    view.el.querySelector('#hm-go').onclick = async () => { await createKey(); LS.set('profile', { name: view.el.querySelector('#hm-name').value.trim().slice(0, 40) });
      view.screen = 'list'; start(); repaint(); A.toast('You’re set up — share your Hush ID to start chatting'); };
  }
  function drawList() {
    const all = chats(), c = contacts(), g = groups(), un = LS.get('unread', {}), q = view.q.toLowerCase();
    const keys = [...new Set(['self', ...Object.keys(all), ...Object.keys(c).filter(k => !c[k].blocked && !c[k].auto), ...Object.keys(g)])].filter(k => k && (isGroup(k) || !c[k]?.blocked))
      .map(k => ({ k, last: (all[k] || []).at(-1) })).sort((a, b) => (b.last?.at || c[b.k]?.added || g[b.k]?.at || 0) - (a.last?.at || c[a.k]?.added || g[a.k]?.at || 0))
      .filter(x => !q || chatName(x.k).toLowerCase().includes(q) || (x.last?.text || '').toLowerCase().includes(q))
      .filter(x => { const f = view.folder || 'all'; return f === 'all' || (f === 'unread' && un[x.k]) || (f === 'groups' && isGroup(x.k)) || (f === 'favs' && LS.get('favs', []).includes(x.k)) || (f === 'reports' && isReport(x.k)); });
    view.el.innerHTML = `<div class="hm hm-mur" style="position:relative">${head('Murmur', '<div class=hm-st></div>', '',
      `<button class=hm-ib data-go=me title="Your Hush ID" aria-label="Your Hush ID">${I.qr}</button>${closeB()}`)}
      <div class=hm-body><input class=hm-search placeholder="Search chats" value="${esc(view.q)}"><div class=hm-folders style="display:flex;gap:6px;padding:0 12px 8px;overflow-x:auto">${[['all', 'All'], ['unread', 'Unread'], ...(Object.keys(chats()).some(isReport) ? [['reports', '🐞 Reports']] : []), ['groups', 'Groups'], ['favs', '★ Favorites']].map(([k, l]) => `<button data-folder=${k} class="hm-chip ${(view.folder || 'all') === k ? 'on' : ''}" style="padding:5px 12px;border-radius:99px;border:1px solid var(--line);font:600 12.5px system-ui;${(view.folder || 'all') === k ? 'background:var(--ink);color:var(--bg)' : ''}">${l}</button>`).join('')}<button data-bcast class=hm-chip style="padding:5px 12px;border-radius:99px;border:1px solid var(--line);font:600 12.5px system-ui">📣 Broadcast</button></div>
      ${!view.q && keys.every(x => x.k === 'self') ? `<div class=hm-welcome style="margin:6px 14px 10px;padding:18px;border-radius:18px;background:color-mix(in srgb,var(--mur) 10%,var(--card));border:1px solid color-mix(in srgb,var(--mur) 25%,transparent)">
        <b style="display:block;font-size:17px;margin-bottom:4px">Add your first friend</b><span style="color:var(--mute);font-size:14px;line-height:1.45">Meet up and scan each other’s code (that also verifies them), or send a one-time invite link.</span>
        <div class=hm-cta style="justify-content:flex-start"><button class=hm-btn data-go=me>Show my code</button><button class="hm-btn ghost" data-go=add>Add a friend</button></div></div>` : ''}
      ${keys.map(({ k, last }) => `<button class="hm-row${un[k] ? ' unread' : ''}" data-chat="${k}">${avatar(k)}<div class=t><b>${esc(chatName(k))}${badgeV(k)}</b><span>${k === 'self' && !last ? 'Links, photos and notes — synced to your devices' : last ? (last.from === 'me' && k !== 'self' ? 'You: ' : isGroup(k) ? esc(first(last.from)) + ': ' : '') + esc(preview(last).slice(0, 80)) : c[k]?.request ? 'Wants to chat' : isGroup(k) ? 'New group' : 'Say hi 👋'}</span></div>
        <em>${last ? short(last.at) : ''}${un[k] ? `<br><span class=u>${un[k]}</span>` : ''}</em></button>`).join('') ||
        (status !== 'on' && !okRelays() ? '<div class=sk-row><div class="sk c"></div><div style="flex:1"><div class="sk l"></div><div class="sk l2"></div></div></div>'.repeat(3) : '') + `<div class=hm-empty><svg class=empty-art viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=1.2><path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8M8 13h5"/></svg><b>No chats yet</b>Tap <b>+</b> to add someone with their Hush ID, or show them yours with the QR button.</div>`}</div>
      <button class=hm-fab data-go=add aria-label="New chat">${I.plus}</button></div>`;
    wireCommon();
    const s = view.el.querySelector('.hm-search'); s.oninput = () => { view.q = s.value; const p = s.selectionStart; repaint(); const n = view.el.querySelector('.hm-search'); n.focus(); n.setSelectionRange(p, p); };
    view.el.querySelectorAll('[data-folder]').forEach(b => b.onclick = () => { view.folder = b.dataset.folder; repaint(); });
    const bc = view.el.querySelector('[data-bcast]'); if (bc) bc.onclick = () => broadcastUI();
    view.el.querySelectorAll('[data-chat]').forEach(b => { b.onclick = () => openChat(b.dataset.chat);
      b.oncontextmenu = e => { e.preventDefault(); chatMenu(e.clientX, e.clientY, b.dataset.chat); };
      let t; b.addEventListener('touchstart', e => { const p = e.touches[0]; t = setTimeout(() => chatMenu(p.clientX, p.clientY, b.dataset.chat), 550); }, { passive: true });
      b.addEventListener('touchend', () => clearTimeout(t)); b.addEventListener('touchmove', () => clearTimeout(t), { passive: true }); });
  }
  function openChat(k) { A.clearNotif && A.clearNotif(k); view.screen = 'chat'; view.chat = k; view.reply = null; const un = LS.get('unread', {}); delete un[k]; LS.set('unread', un); badge(); repaint(); sendRead(k); }
  function bubble(m, list, key, prev) {
    if (m.sys) return `<div class=hm-day style="font-weight:500">${esc(m.text)}</div>`;
    if (m.unsent) return `<div class="hm-m ${m.from === 'me' ? 'me' : 'them'}" data-m="${m.id}" style="opacity:.6;font-style:italic">${m.from === 'me' ? 'You unsent a message' : 'Message unsent'}<span class=tm>${time(m.at)}</span></div>`;
    const q = m.reply && list.find(x => x.id === m.reply);
    const rx = m.react && Object.entries(m.react).filter(([, w]) => w.length).map(([e, w]) => e + (w.length > 1 ? w.length : '')).join(' ');
    const who = m.from === 'me' ? 'me' : 'them', showName = isGroup(key) && who === 'them' && (!prev || prev.from !== m.from);
    let body = '';
    let cls = '';
    if (m.file) { const f = m.file, img = f.mime.startsWith('image/'), vid = f.mime.startsWith('video/'), icon = f.kind === 'voice' ? '🎤' : f.kind === 'vmsg' ? '📹' : img ? '📷' : vid ? '🎬' : '📎';
      if (!f.done) body = f.remote ? `<div class=hm-file data-fetch="${m.id}"><i>${icon}</i><div><b>${esc(f.kind === 'voice' ? 'Voice message' : f.kind === 'vmsg' ? 'Video message' : f.name)}</b><small>${f.loading ? 'Downloading through Tor…' : f.error ? '⚠ ' + esc(String(f.error).slice(0, 60)) + ' · tap to retry' : size(f.size) + ' · tap to download'}</small>${f.loading ? '<div class=hm-prog><i class=hm-ind></i></div>' : ''}</div></div>`
        : `<div class=hm-file><i>${icon}</i><div><b>${esc(f.name)}</b><small>Receiving… ${Math.round(100 * f.got / f.total)}%</small><div class=hm-prog><i style="width:${Math.round(100 * f.got / f.total)}%"></i></div></div></div>`;
      else if (f.kind === 'voice') { body = `<div class=hm-voice data-voice="${f.id}"><button class=pp aria-label=Play>▶</button><canvas width=150 height=30></canvas><span class=d>${dur(f.dur)}</span><button class=sp aria-label=Speed>1×</button></div>`; cls = 'voice'; }
      else if (f.kind === 'vmsg') { body = `<div class=hm-vmsg data-vmsg="${f.id}"><video muted loop playsinline></video><span class=d>${dur(f.dur)}</span><span class=snd>🔇</span></div>`; cls = 'vmsgb'; }
      else if (img) { body = `<img class=hm-img data-img="${f.id}" alt="Photo">`; cls = 'img'; }
      else if (vid) { body = `<video class=hm-img data-vid="${f.id}" controls playsinline preload=metadata></video>`; cls = 'img'; }
      else body = `<div class=hm-file data-dl="${f.id}"><i>📎</i><div><b>${esc(f.name)}</b><small>${size(f.size)} · tap to open</small></div></div>`;
      if (f.up) body += `<div class=hm-prog><i class=hm-ind></i></div><small style="opacity:.75">Encrypting & sending through Tor…</small>`; }
    else if (m.poll) { const v = m.votes || {}, tot = Object.keys(v).length, mineV = v.me;
      body = `<b class=hm-pq>📊 ${esc(m.text)}</b>${m.poll.map((o, i) => { const n = Object.values(v).filter(x => x === i).length, pc = tot ? Math.round(100 * n / tot) : 0;
        return `<button class="hm-po ${mineV === i ? 'on' : ''}" data-vote="${i}"><i style="width:${pc}%"></i><span>${esc(o)}</span><em>${n || ''}</em></button>`; }).join('')}<small style="opacity:.75">${tot} vote${tot === 1 ? '' : 's'} · tap to vote</small>`; cls = 'pollb'; }
    else if (m.loc) { const live = m.loc.until * 1000 > Date.now() && m.loc.lat; const ago2 = Math.round((Date.now() - m.loc.at) / 60000);
      body = `<div class=hm-file><i>📍</i><div><b>${live ? 'Live location' : 'Location sharing ended'}</b><small>${live ? (ago2 < 1 ? 'updated just now' : 'updated ' + ago2 + ' min ago') + ' · ±' + Math.round(m.loc.acc) + ' m' : 'Last seen ' + short(m.loc.at)}</small></div></div>${live || m.from !== 'me' ? `<a href=# class=hm-link data-u="https://www.openstreetmap.org/?mlat=${m.loc.lat.toFixed(5)}&mlon=${m.loc.lon.toFixed(5)}#map=16/${m.loc.lat.toFixed(5)}/${m.loc.lon.toFixed(5)}">🗺 Open map</a>` : ''}`; }
    else if (m.tog) { let h = m.tog; try { h = new URL(m.tog).hostname.replace(/^www\./, ''); } catch {}
      body = `<div class=hm-file><i>🎬</i><div><b>Watch together</b><small>${esc(h)}</small></div></div><button class=hm-btn data-tog="${m.id}" style="margin-top:6px;width:100%">${m.from === 'me' ? 'Open & start' : 'Join'}</button>`; }
    else { const url = (m.text.match(/https?:\/\/\S+/) || [])[0];
      body = linkify(m.text) + (url && m.text.trim() === url.trim() ? `<a href=# class=hm-link data-u="${esc(url)}">🔗 ${esc((() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })())}</a>` : ''); }
    if (m.once && m.file) { body = m.opened ? `<div class=hm-file><i>👁</i><div><b>View-once photo</b><small>${m.from === 'me' ? 'Sent' : 'Opened'}</small></div></div>` : m.from === 'me' ? `<div class=hm-file><i>👁</i><div><b>View-once photo</b><small>Disappears after they open it</small></div></div>` : `<div class=hm-file data-once="${m.id}"><i>👁</i><div><b>View-once photo</b><small>${m.file.done ? 'Tap to open — you can view it once' : 'Receiving…'}</small></div></div>`; cls = ''; }
    const st = (m.ttl ? ' ⏲' : '') + (m.edited ? ' · edited' : '') + (m.from === 'me' ? ' ' + ({ sent: (m.read?.length ? '✓✓' : '✓'), sending: '…', queued: '◷', failed: '⚠ tap to retry' }[m.status] || '') : '');
    return `<div class="hm-m ${who} ${cls} ${rx ? 'hasrx' : ''} ${m.status === 'failed' ? 'failed' : ''}" data-m="${m.id}">${showName ? `<span class=hm-who style="color:${colorOf(m.from)}">${esc(nameOf(m.from))}${groups()[key]?.labels?.[m.from] ? ` <span style="font-weight:500;opacity:.75;font-size:11px;border:1px solid currentColor;border-radius:6px;padding:0 4px">${esc(groups()[key].labels[m.from])}</span>` : ''}</span>` : ''}${q ? `<span class=q>${esc(preview(q).slice(0, 80))}</span>` : ''}${body}<span class=tm>${time(m.at)}${st}</span>${rx ? `<span class=rx>${rx}</span>` : ''}</div>`;
  }
  const THEMES = {
    default: { name: 'Default', dot: 'var(--acc)', css: '' },
    ocean: { name: 'Ocean', dot: '#0ea5e9', css: '--acc:#0284c7;--bg:#f0f9ff;--card:#ffffff;--ink:#0c4a6e;--line:#bae6fd' },
    sunset: { name: 'Sunset', dot: '#f97316', css: '--acc:#ea580c;--bg:#fff7ed;--card:#ffffff;--ink:#431407;--line:#fed7aa' },
    forest: { name: 'Forest', dot: '#16a34a', css: '--acc:#15803d;--bg:#f0fdf4;--card:#ffffff;--ink:#14532d;--line:#bbf7d0' },
    rose: { name: 'Rose', dot: '#e11d48', css: '--acc:#e11d48;--bg:#fff1f2;--card:#ffffff;--ink:#4c0519;--line:#fecdd3' },
    midnight: { name: 'Midnight', dot: '#6366f1', css: '--acc:#818cf8;--bg:#0b1020;--card:#151b30;--ink:#e0e7ff;--line:#26304f;--mute:#8a93b8;color-scheme:dark' },
    mono: { name: 'Mono', dot: '#111', css: '--acc:#111;--bg:#fff;--card:#f4f4f5;--ink:#111;--line:#e4e4e7' } };
  function pollForm(key) {
    const v = document.createElement('div'); v.className = 'hm-view';
    v.innerHTML = `<div class=hm-card style="width:min(420px,92vw);color:var(--ink)"><h3>📊 New poll</h3><input class=hm-in id=pq placeholder="Question" maxlength=200><div id=po>${[1, 2, 3].map(i => `<input class=hm-in placeholder="Option ${i}" maxlength=80>`).join('')}</div>
      <button class="hm-btn ghost" id=pa>+ Add option</button><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="hm-btn ghost" data-x>Cancel</button><button class=hm-btn id=ps>Send poll</button></div></div>`;
    document.body.append(v); v.querySelector('#pq').focus();
    v.onclick = e => { if (e.target === v || e.target.dataset.x !== undefined) v.remove(); };
    v.querySelector('#pa').onclick = () => { const n = v.querySelectorAll('#po input').length; if (n < 10) v.querySelector('#po').insertAdjacentHTML('beforeend', `<input class=hm-in placeholder="Option ${n + 1}" maxlength=80>`); };
    v.querySelector('#ps').onclick = () => { const q = v.querySelector('#pq').value.trim(), o = [...v.querySelectorAll('#po input')].map(i => i.value.trim()).filter(Boolean);
      if (!q || o.length < 2) return A.toast('Add a question and at least two options'); v.remove(); sendText(key, q, null, { poll: o }); };
  }
  // Privacy curtain: chats blur whenever Hush loses focus or goes to the background (and Android blocks screenshots/recents while open).
  const curtain = on => { if (!view.el) return; view.el.classList.toggle('hm-curtain', on && prefs().curtain !== false); };
  addEventListener('blur', () => curtain(true)); addEventListener('focus', () => curtain(false));
  document.addEventListener('visibilitychange', () => curtain(document.visibilityState === 'hidden'));
  function drawChat() {
    const key = view.chat, list = (chats()[key] || []), c = contacts()[key] || {};
    let lastDay = '', html = '', prev = null;
    const lastMine = [...list].reverse().find(m => m.from === 'me');
    for (const m of list) { const d = day(m.at); if (d !== lastDay) { html += `<div class=hm-day>${d}</div>`; lastDay = d; prev = null; } html += bubble(m, list, key, prev); prev = m;
      if (m === lastMine && m.read?.length && prefs().receipts) html += `<div class=hm-seen>${isGroup(key) ? 'Seen by ' + m.read.map(first).join(', ') : 'Seen'}</div>`; }
    const cs = chatSet(key), th = THEMES[(LS.get('themes', {})[key]) || 'default'] || THEMES.default, pinned = cs.pin && list.find(x => x.id === cs.pin && !x.unsent);
    if (cs.wall) fileUrl(cs.wall).then(u => { const b = view.el?.querySelector('.hm-body'); if (u && b && view.chat === key) { b.style.backgroundImage = `linear-gradient(color-mix(in srgb,var(--bg) 55%,transparent),color-mix(in srgb,var(--bg) 55%,transparent)),url(${u})`; b.style.backgroundSize = 'cover'; b.style.backgroundAttachment = 'local'; } });
    view.el.innerHTML = `<div class="hm hm-mur" style="${th.css}">${head(esc(chatName(key)) + badgeV(key), key !== 'self' && !isGroup(key) && contacts()[key]?.status ? `<small style="display:block;color:var(--mute);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(contacts()[key].status)}</small><div class=hm-st></div>` : '<div class=hm-st></div>', `<button class=hm-ib data-go=list aria-label=Back>${I.back}</button>${avatar(key, 36)}`,
      `<button class=hm-ib id=hm-cm aria-label="Chat options">⋯</button>`)}
      ${pinned ? `<div class=hm-pinbar data-jump="${pinned.id}">📌 <span>${esc(preview(pinned).slice(0, 90))}</span></div>` : ''}${cs.ttl ? `<div class=hm-pinbar style="cursor:default">⏲ Disappearing messages: ${ttlLabel(cs.ttl)}</div>` : ''}
      <div class=hm-body id=hm-scroll>${!isGroup(key) && impostor(key) ? `<div class=hm-req style="border-color:#ef4444"><b style="color:#ef4444">⚠ This is not your verified ${esc(nameOf(impostor(key)))}.</b> It’s a different Hush ID using the same name. Don’t share anything sensitive unless you’ve checked with them another way.</div>` : ''}${c.request ? `<div class=hm-req><b>${esc(nameOf(key))}</b> isn’t in your contacts yet. Only reply if you know them.<div style="margin-top:8px;display:flex;gap:8px"><button class="hm-btn" id=hm-acc>Accept</button><button class="hm-btn ghost" id=hm-blk>Block</button></div></div>` : ''}
      <div class=hm-msgs>${html || `<div class=hm-empty style="padding:30px"><b>Start the conversation</b>Messages, photos and files are end-to-end encrypted and sent through Tor.</div>`}</div></div>
      ${view.reply ? `<div class=hm-rep>↩ <span>${esc(preview(list.find(x => x.id === view.reply) || { text: '' }))}</span><button class=hm-ib id=hm-rx aria-label="Cancel reply">${I.x}</button></div>` : ''}
      <div class=hm-c><button class=hm-ib id=hm-plus title="More: poll, view-once photo" aria-label="More">${I.plus}</button><button class=hm-ib id=hm-att title="Photo or file" aria-label="Send a photo or file">${I.clip}</button>${A.page && A.page() ? `<button class=hm-ib id=hm-share title="Share the page you’re on" aria-label="Share page">${I.link}</button>` : ''}
      <textarea rows=1 placeholder="Message" aria-label="Message"></textarea><button class=hm-ib id=hm-cam title="Hold to record a video message" aria-label="Video message">${I.cam}</button><button class="hm-send hm-mic" id=hm-mic title="Hold to record a voice message (tap to keep recording)" aria-label="Voice message">${I.mic}</button><button class="hm-send hide" id=hm-go aria-label=Send>${I.send}</button>
      <input type=file id=hm-file hidden multiple></div></div>`;
    wireCommon();
    const sc = view.el.querySelector('#hm-scroll'); sc.scrollTop = sc.scrollHeight;
    const ta = view.el.querySelector('textarea'), go = () => { const v = ta.value; if (!v.trim()) return; ta.value = ''; ta.oninput(); const r = view.reply; view.reply = null; sendText(key, v, r); };
    const swap = () => { const t = !!ta.value.trim(); view.el.querySelector('#hm-go').classList.toggle('hide', !t); view.el.querySelector('#hm-mic').classList.toggle('hide', t); view.el.querySelector('#hm-cam').classList.toggle('hide', t); ['#hm-att', '#hm-share', '#hm-plus'].forEach(q => { const b = view.el.querySelector(q); if (b && q !== '#hm-plus') b.classList.toggle('hide', t); }); };
    ta.oninput = e => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; swap(); if (e && ta.value.trim()) sendTyping(key); };
    recorder(view.el.querySelector('#hm-mic'), 'voice', key); recorder(view.el.querySelector('#hm-cam'), 'vmsg', key);
    ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !A.mobile) { e.preventDefault(); go(); } };
    view.el.querySelector('#hm-go').onclick = go; if (!A.mobile) setTimeout(() => ta.focus(), 30);
    const fi = view.el.querySelector('#hm-file'); view.el.querySelector('#hm-att').onclick = () => fi.click();
    fi.onchange = async () => { const fs = [...fi.files].slice(0, 10), once = view.once; view.once = false; fi.value = '';
      if (fs.length === 1 && /^image\/(jpeg|png|webp)$/.test(fs[0].type)) { const ed = await editPhoto(fs[0]); if (ed) sendFile(key, ed, once ? { once: true } : {}); return; }
      fs.forEach(f => sendFile(key, f, once ? { once: true } : {})); };
    view.el.querySelector('#hm-plus').onclick = e => menu(e.clientX, e.clientY - 120, `<button class=i data-a=file>📎 Photo or file</button>${A.page && A.page() ? '<button class=i data-a=page>🔗 Share this page</button>' : ''}<button class=i data-a=poll>📊 Poll</button><button class=i data-a=once>👁 View-once photo</button>${key !== 'self' && A.media && A.page && A.page() ? '<button class=i data-a=tog>🎬 Watch this page together</button>' : ''}${A.ai && A.ai.ready() && key !== 'self' ? '<button class=i data-a=ai>✨ Suggest a reply</button>' : ''}${key !== 'self' ? `<button class=i data-a=loc>📍 ${liveLoc.active(key) ? 'Stop sharing location' : 'Share live location'}</button>` : ''}<button class=i data-a=self>✎ Notes to self</button>`, (m, done) => m.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { done();
      if (b.dataset.a === 'ai') { const ta2 = view.el.querySelector('textarea'), recent = (chats()[key] || []).filter(x => x.text && !x.sys).slice(-8).map(x => (x.from === 'me' ? 'Me' : first(x.from)) + ': ' + x.text.slice(0, 300)).join('\n');
        ta2.value = '…'; A.ai.ask(`Write one short, friendly reply I could send next in this chat. Reply with only the message text.\n\n${recent}`, t => { ta2.value = t; }).then(t => { ta2.value = t; ta2.oninput && ta2.oninput(); ta2.focus(); }).catch(e => { ta2.value = ''; A.toast(e.message); }); return; }
      if (b.dataset.a === 'loc') return liveLoc.active(key) ? liveLoc.stop(key) : liveLoc.pick(key);
      if (b.dataset.a === 'tog') { const p = A.page(); if (p) { sendText(key, '🎬 Watch together: ' + p.url, null, { tog: p.url }); together.join(key, p.url, true); } return; }
      if (b.dataset.a === 'file') { fi.accept = ''; fi.multiple = true; fi.click(); return; }
      if (b.dataset.a === 'page') { const p = A.page(); if (p) { ta.value = (ta.value ? ta.value + ' ' : '') + p.url; ta.oninput(); ta.focus(); } return; }
      if (b.dataset.a === 'poll') pollForm(key); else if (b.dataset.a === 'once') { view.once = true; fi.accept = 'image/*'; fi.multiple = false; fi.click(); } else openChat('self'); }));
    const pb = view.el.querySelector('[data-jump]'); if (pb) pb.onclick = () => { const t = view.el.querySelector(`[data-m="${pb.dataset.jump}"]`); if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.add('hm-flash'); setTimeout(() => t.classList.remove('hm-flash'), 1200); } };
    view.el.querySelectorAll('[data-vote]').forEach(b => b.onclick = e => { e.stopPropagation(); const m = list.find(x => x.id === b.closest('[data-m]').dataset.m); if (!m) return;
      const i = +b.dataset.vote, cur = (m.votes || {}).me; publish(key, 7, cur === i ? '' : 'poll:' + i, [['e', m.id], ['k', '14']]);
      const all = chats(), x = (all[key] || []).find(y => y.id === m.id); x.votes = x.votes || {}; if (cur === i) delete x.votes.me; else x.votes.me = i; LS.set('chats', all); repaint(); });
    view.el.querySelectorAll('[data-when]').forEach(a => a.onclick = e => { e.preventDefault(); e.stopPropagation(); const at = +a.dataset.when, m = list.find(x => x.id === a.closest('[data-m]')?.dataset.m);
      if (!confirm('Remind me ' + new Date(at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + '?')) return;
      LS.set('reminders', [...LS.get('reminders', []), { at, text: (chatName(key) + ': ' + (m?.text || '')).slice(0, 200) }].slice(-100)); try { Notification.requestPermission?.(); } catch {} A.toast('⏰ Reminder set — Hush will remind you'); });
    view.el.querySelectorAll('[data-tog]').forEach(b => b.onclick = e => { e.stopPropagation(); const m = list.find(x => x.id === b.dataset.tog); if (m && m.tog) together.join(key, m.tog, m.from === 'me'); });
    view.el.querySelectorAll('[data-once]').forEach(b => b.onclick = async e => { e.stopPropagation(); const m = list.find(x => x.id === b.dataset.once); if (!m || !m.file.done) return;
      await viewer(m.file.id, true); const all = chats(), x = (all[key] || []).find(y => y.id === m.id); if (x) { x.opened = true; LS.set('chats', all); }
      idb('files', 'readwrite', st => st.delete(m.file.id)).catch(() => {}); repaint(); });
    ta.addEventListener('paste', e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); fs.slice(0, 10).forEach(f => sendFile(key, f)); } });
    const body = view.el.querySelector('.hm'); body.ondragover = e => { e.preventDefault(); body.classList.add('hm-drop'); }; body.ondragleave = () => body.classList.remove('hm-drop');
    body.ondrop = e => { e.preventDefault(); body.classList.remove('hm-drop'); [...(e.dataTransfer?.files || [])].slice(0, 10).forEach(f => sendFile(key, f)); };
    const sh = view.el.querySelector('#hm-share'); if (sh) sh.onclick = () => { const p = A.page(); if (p) { ta.value = (ta.value ? ta.value + ' ' : '') + p.url; ta.oninput(); ta.focus(); } };
    const rxb = view.el.querySelector('#hm-rx'); if (rxb) rxb.onclick = () => { view.reply = null; repaint(); };
    const acc = view.el.querySelector('#hm-acc'); if (acc) acc.onclick = () => { const all = contacts(); delete all[key].request; LS.set('contacts', all); shareCard(); repaint(); };
    const blk = view.el.querySelector('#hm-blk'); if (blk) blk.onclick = () => { const all = contacts(); all[key] = { ...all[key], blocked: true }; LS.set('contacts', all); view.screen = 'list'; repaint(); A.toast('Blocked'); };
    view.el.querySelector('#hm-cm').onclick = e => chatMenu(e.clientX, e.clientY, key);
    view.el.querySelectorAll('[data-u]').forEach(a => a.onclick = e => { e.preventDefault(); e.stopPropagation(); A.open(a.dataset.u); });
    view.el.querySelectorAll('[data-img]').forEach(async im => { const u = await fileUrl(im.dataset.img); if (u) im.src = u; im.onclick = e => { e.stopPropagation(); viewer(im.dataset.img, false, chatSet(key).protect); }; });
    view.el.querySelectorAll('[data-fetch]').forEach(d => d.onclick = e => { e.stopPropagation(); fetchRemote(key, d.dataset.fetch); });
    view.el.querySelectorAll('[data-vid]').forEach(async v => { const u = await fileUrl(v.dataset.vid); if (u) v.src = u; });
    view.el.querySelectorAll('[data-voice]').forEach(v => voicePlayer(v, list.find(x => x.file?.id === v.dataset.voice), key));
    view.el.querySelectorAll('[data-vmsg]').forEach(async v => { const vid = v.querySelector('video'), u = await fileUrl(v.dataset.vmsg); if (!u) return; vid.src = u; vid.play().catch(() => {});
      v.onclick = e => { e.stopPropagation(); if (vid.muted) { vid.muted = false; vid.loop = false; vid.currentTime = 0; vid.play(); v.classList.add('on'); v.querySelector('.snd').textContent = '🔊'; }
        else { vid.muted = true; vid.loop = true; v.classList.remove('on'); v.querySelector('.snd').textContent = '🔇'; } };
      vid.onended = () => { vid.muted = true; vid.loop = true; vid.play(); v.classList.remove('on'); v.querySelector('.snd').textContent = '🔇'; }; });
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
  // ---------------------------------------------------------------- recording: hold to record, release to send,
  // slide left to cancel, slide up to lock (hands-free). A quick tap also locks. Voice: Opus ~24 kbps. Video message: 480×480, ≤ 60 s.
  let rec = null;
  function recorder(btn, kind, key) {
    if (!btn) return;
    btn.onpointerdown = async e => { e.preventDefault(); if (rec) return;
      if (!LS.get('avOk', false)) return avNotice(kind);       // explain first, then the system asks for permission
      const sx = e.clientX, sy = e.clientY, t0 = Date.now(); let st, down = true;
      const early = () => { down = false; removeEventListener('pointerup', early); }; addEventListener('pointerup', early);
      try { st = await navigator.mediaDevices.getUserMedia(kind === 'voice' ? { audio: { echoCancellation: true, noiseSuppression: true } } : { audio: true, video: { facingMode: 'user', width: 480, height: 480 } }); }
      catch (err) { return A.toast(kind === 'voice' ? 'Hush needs the microphone for voice messages — allow it and try again' : 'Hush needs the camera and microphone for video messages — allow them and try again'); }
      const mt = kind === 'voice' ? ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'] : ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
      const mime = mt.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      const mr = new MediaRecorder(st, { mimeType: mime || undefined, audioBitsPerSecond: kind === 'voice' ? 24000 : 32000, videoBitsPerSecond: 380000 });
      const chunks = []; mr.ondataavailable = ev => ev.data.size && chunks.push(ev.data);
      rec = { mr, st, kind, key, chunks, start: Date.now(), locked: false, cancel: false, ui: recUI(kind, st) };
      const max = kind === 'voice' ? 300 : 60, tick = setInterval(() => { if (!rec) return clearInterval(tick); const s = (Date.now() - rec.start) / 1000; rec.ui.time(s); if (s >= max) finish(true); }, 200);
      mr.onstop = async () => { clearInterval(tick); st.getTracks().forEach(t => t.stop()); const r = rec; rec = null; r.ui.close(); if (view.dirty) { view.dirty = false; repaint(); } if (r.cancel) return;
        const secs = (Date.now() - r.start) / 1000; if (secs < 0.8) return A.toast(kind === 'voice' ? 'Hold to record — release to send' : 'Hold to record a video message');
        const type = (mr.mimeType || mime || (kind === 'voice' ? 'audio/webm' : 'video/webm')).split(';')[0], ext = type.split('/')[1] || 'webm';
        const blob = new Blob(r.chunks, { type });
        const real = await mediaDuration(blob, kind).catch(() => 0);
        sendFile(key, new File([blob], (kind === 'voice' ? 'Voice message.' : 'Video message.') + ext, { type }), { kind, dur: real || secs }); };
      mr.start(250);
      if (!down) { rec.locked = true; rec.ui.lock(() => finish(true), () => { rec.cancel = true; finish(); }); return; }   // released while the permission prompt was up
      removeEventListener('pointerup', early);
      const move = ev => { if (!rec || rec.locked) return; const dx = ev.clientX - sx, dy = ev.clientY - sy;
        rec.ui.drag(dx, dy); if (dx < -90) { rec.cancel = true; finish(); } else if (dy < -70) { rec.locked = true; rec.ui.lock(() => finish(true), () => { rec.cancel = true; finish(); }); } };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
        if (!rec || rec.locked) return; if (Date.now() - t0 < 350) { rec.locked = true; rec.ui.lock(() => finish(true), () => { rec.cancel = true; finish(); }); return; } finish(true); };
      addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    };
    function finish() { if (rec && rec.mr.state !== 'inactive') rec.mr.stop(); }
  }
  // Recorded WebM has no duration in its header; measure it by decoding (audio) or seeking to the end (video).
  async function mediaDuration(blob, kind) {
    if (kind === 'voice') { const ac = new (window.AudioContext || window.webkitAudioContext)(); try { return (await ac.decodeAudioData(await blob.arrayBuffer())).duration; } finally { ac.close(); } }
    return new Promise(res => { const v = document.createElement('video'), u = URL.createObjectURL(blob); v.preload = 'metadata'; v.src = u;
      v.onloadedmetadata = () => { if (isFinite(v.duration)) { res(v.duration); URL.revokeObjectURL(u); } else { v.currentTime = 1e7; v.ontimeupdate = () => { v.ontimeupdate = null; res(v.duration); URL.revokeObjectURL(u); }; } };
      v.onerror = () => res(0); setTimeout(() => res(0), 4000); });
  }
  // Shown once, before Hush asks for the microphone / camera for the first time.
  function avNotice(kind) {
    const v = document.createElement('div'); v.className = 'hm-view';
    v.innerHTML = `<div class=hm-card style="max-width:420px;margin:16px;color:var(--ink)"><div style="font-size:34px;text-align:center">${kind === 'voice' ? '🎤' : '📹'}</div>
      <h3 style="text-align:center;font-size:17px">Your ${kind === 'voice' ? 'microphone stays' : 'camera and microphone stay'} private</h3>
      <p>• Hush only turns on the ${kind === 'voice' ? 'microphone' : 'camera and microphone'} <b>while you hold the button</b> (or until you tap send / 🗑). Never in the background, and the light/indicator on your device shows when it’s on.</p>
      <p>• The recording is made <b>on this device</b> and encrypted here. Only the people in this chat can play it.</p>
      <p>• Hush has no servers and <b>keeps nothing</b>: no copies, no transcripts, no analysis. The encrypted message passes through relays${kind === 'vmsg' ? ' and a file host' : ''} that can’t open it.</p>
      <p style="margin-bottom:14px">• Next, ${A.mobile ? 'Android' : 'your computer'} will ask for permission — you can turn it off any time in its settings.</p>
      <div style="display:flex;gap:8px;justify-content:center"><button class="hm-btn ghost" data-a=no>Not now</button><button class=hm-btn data-a=ok>Continue</button></div></div>`;
    document.body.append(v);
    v.onclick = async e => { const a = e.target.dataset?.a; if (e.target === v || a === 'no') return v.remove();
      if (a === 'ok') { v.remove(); LS.set('avOk', true);
        try { const st = await navigator.mediaDevices.getUserMedia(kind === 'voice' ? { audio: true } : { audio: true, video: true }); st.getTracks().forEach(t => t.stop());
          A.toast(kind === 'voice' ? 'Ready — hold the mic button to record' : 'Ready — hold the camera button to record'); }
        catch { A.toast('Permission wasn’t given — you can allow it later in settings'); } } };
  }
  function recUI(kind, stream) {
    const el = document.createElement('div'); el.className = 'hm-rec ' + kind;
    el.innerHTML = `${kind === 'vmsg' ? '<div class=hm-cv><video autoplay muted playsinline></video><i class=ring></i></div>' : ''}<div class=hm-recbar><i class=dot></i><span class=t>0:00</span><span class=hint>‹ slide to cancel</span><span class=lockh>⇡ slide up to lock</span>
      <button class=cx aria-label="Cancel" style="display:none">🗑</button><button class="hm-send ok" aria-label="Send" style="display:none">${I.send}</button></div>`;
    (view.el?.querySelector('.hm') || document.body).append(el);
    if (kind === 'vmsg') el.querySelector('video').srcObject = stream;
    return { time: s => { el.querySelector('.t').textContent = dur(s); const r = el.querySelector('.ring'); if (r) r.style.setProperty('--p', Math.min(1, s / 60)); },
      drag: (dx, dy) => { el.querySelector('.hint').style.transform = `translateX(${Math.min(0, dx)}px)`; el.querySelector('.hint').style.opacity = 1 + Math.min(0, dx) / 120; el.querySelector('.lockh').style.opacity = 1 + Math.min(0, dy) / 90; },
      lock: (send, cancel) => { el.classList.add('locked'); el.querySelector('.hint').style.display = el.querySelector('.lockh').style.display = 'none';
        const c = el.querySelector('.cx'), o = el.querySelector('.ok'); c.style.display = o.style.display = ''; c.onclick = cancel; o.onclick = send; },
      close: () => el.remove() };
  }
  function voicePlayer(v, m, key) {
    if (!m) return; const pp = v.querySelector('.pp'), sp = v.querySelector('.sp'), cv = v.querySelector('canvas'), d = v.querySelector('.d'); let au = null, raf = 0;
    const draw = (p = 0) => { const g = cv.getContext('2d'), w = cv.width, h = cv.height, bars = m.file.wave || Array(30).fill(0.3), bw = w / bars.length;
      g.clearRect(0, 0, w, h); bars.forEach((b, i) => { g.fillStyle = i / bars.length <= p ? getComputedStyle(v).color : 'rgba(128,128,128,.45)'; const bh = Math.max(3, b * h); g.fillRect(i * bw + 1, (h - bh) / 2, bw - 2, bh); }); };
    draw();
    if (!m.file.wave) fileUrl(m.file.id).then(async u => { if (!u) return; try { const ac = new (window.AudioContext || window.webkitAudioContext)(); const buf = await ac.decodeAudioData(await (await fetch(u)).arrayBuffer());
      const ch = buf.getChannelData(0), n = 30, step = Math.floor(ch.length / n), out = []; for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < step; j += 16) s = Math.max(s, Math.abs(ch[i * step + j] || 0)); out.push(s); }
      const mx = Math.max(...out, 0.01); m.file.wave = out.map(x => +(x / mx).toFixed(2)); const all = chats(), z = (all[key] || []).find(y => y.id === m.id); if (z) { z.file.wave = m.file.wave; LS.set('chats', all); } ac.close(); draw(); } catch {} });
    const loop = () => { if (!au) return; draw(au.currentTime / (au.duration || m.file.dur || 1)); d.textContent = dur(au.currentTime); raf = requestAnimationFrame(loop); };
    pp.onclick = async e => { e.stopPropagation(); if (!au) { const u = await fileUrl(m.file.id); if (!u) return; au = new Audio(u); au.playbackRate = parseFloat(sp.textContent);
        au.onended = () => { pp.textContent = '▶'; cancelAnimationFrame(raf); draw(0); d.textContent = dur(m.file.dur); au = null; }; }
      if (au.paused) { document.querySelectorAll('audio').forEach(a => a.pause()); au.play(); pp.textContent = '❚❚'; loop(); } else { au.pause(); pp.textContent = '▶'; cancelAnimationFrame(raf); } };
    sp.onclick = e => { e.stopPropagation(); const r = { '1×': '1.5×', '1.5×': '2×', '2×': '1×' }[sp.textContent]; sp.textContent = r; if (au) au.playbackRate = parseFloat(r); };
    cv.onclick = e => { e.stopPropagation(); if (au && au.duration) { au.currentTime = au.duration * (e.offsetX / cv.clientWidth); } };
  }
  async function viewer(fid, once, prot) { const u = await fileUrl(fid); if (!u) return; const v = document.createElement('div'); v.className = 'hm-view';
    v.innerHTML = `<img src="${u}" alt="Photo"><div class=bar>${once || prot ? `<span style="color:#fff;font-size:13px;align-self:center">${once ? '👁 View once — it disappears when you close it' : '🛡 Protected chat — saving is off'}</span>` : `<button data-a=save>Save</button>${navigator.share ? '<button data-a=share>Share</button>' : ''}`}<button data-a=x>Close</button></div>`;
    if (once) return new Promise(res => { document.body.append(v); v.onclick = e => { if (e.target === v || e.target.dataset?.a === 'x') { v.remove(); res(); } }; });
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
    menu(x, y, `<div class=e>${REACT.map(e => `<button data-e="${e}">${e}</button>`).join('')}</div><button class=i data-a=reply>↩ Reply</button>${chatSet(key).protect ? '' : m.file ? (m.once ? '' : '<button class=i data-a=save>Save</button>') : '<button class=i data-a=copy>Copy text</button>'}${m.from === 'me' && !m.file && !m.poll && Date.now() - m.at < 24 * 3600e3 ? '<button class=i data-a=edit>✎ Edit</button>' : ''}<button class=i data-a=pin>${chatSet(key).pin === m.id ? 'Unpin' : '📌 Pin'}</button>${m.from === 'me' ? '<button class=i data-a=unsend>↶ Unsend for everyone</button>' : ''}${m.status === 'failed' ? '<button class=i data-a=retry>Retry</button>' : ''}${m.from === 'me' && m.read?.length && isGroup(key) ? `<button class=i data-a=info>Seen by ${m.read.length}</button>` : ''}<button class=i data-a=del>Delete for me</button>`,
      (el, done) => { el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { done(); react(key, m, b.dataset.e); });
        el.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => { done(); const a = b.dataset.a;
          if (a === 'reply') { view.reply = m.id; repaint(); view.el.querySelector('textarea')?.focus(); }
          else if (a === 'copy') { try { await navigator.clipboard.writeText(m.text); A.toast('Copied'); } catch {} }
          else if (a === 'save') saveFile(m.file);
          else if (a === 'edit') { const t = prompt('Edit message', m.text); if (t == null || !t.trim() || t.trim() === m.text) return; control(key, [['hush-edit', m.id]], t.trim().slice(0, 20000));
            const all = chats(), x = (all[key] || []).find(y => y.id === m.id); x.text = t.trim(); x.edited = true; LS.set('chats', all); repaint(); }
          else if (a === 'unsend') { if (!confirm('Unsend this message for everyone in the chat?')) return; control(key, [['hush-unsend', m.id]]);
            const all = chats(), x = (all[key] || []).find(y => y.id === m.id); Object.assign(x, { text: '', file: null, poll: null, unsent: true }); LS.set('chats', all); repaint(); }
          else if (a === 'pin') { const cs = chatSet(key), on = cs.pin !== m.id; control(key, [['hush-pin', on ? m.id : '']]); cs.pin = on ? m.id : null; saveChatSet(key, cs); repaint(); }
          else if (a === 'info') A.toast('Seen by ' + m.read.map(first).join(', '));
          else if (a === 'retry') resend(key, m);
          else if (a === 'del') { const all = chats(); all[key] = (all[key] || []).filter(z => z.id !== m.id); LS.set('chats', all); repaint(); } }); });
  }
  function chatMenu(x, y, key) {
    const g = isGroup(key);
    menu(x, y, `<button class=i data-a=theme>🎨 Chat theme</button><button class=i data-a=wall>🖼 Wallpaper${chatSet(key).wall ? ' · change' : ''}</button><button class=i data-a=ttl>⏲ Disappearing messages${chatSet(key).ttl ? ' · ' + ttlLabel(chatSet(key).ttl) : ''}</button><button class=i data-a=find>🔎 Search this chat</button><button class=i data-a=links>📚 Reading list (links shared here)</button><button class=i data-a=fav>${(LS.get('favs', [])).includes(key) ? '★ Unfavorite' : '☆ Favorite'}</button>${isGroup(key) ? '<button class=i data-a=labels>🏷 Member labels</button>' : ''}${key === 'self' ? '' : `<button class=i data-a=protect>🛡 Protected chat${chatSet(key).protect ? ' · on' : ''}</button>`}${key === 'self' ? '' : `<button class=i data-a=rename>${g ? 'Rename group' : 'Rename'}</button>`}${g ? '<button class=i data-a=people>People in this group</button>' : `<button class=i data-a=verify>${verified(key) ? '✓ Verified — view safety code' : 'Verify safety code'}</button><button class=i data-a=id>Show their Hush ID</button>`}<button class=i data-a=clear>Clear chat</button>${g ? '' : '<button class=i data-a=block>Block</button>'}<button class=i data-a=del>${g ? 'Leave & delete group' : 'Delete chat & contact'}</button>`,
      (el, done) => el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { done(); const a = b.dataset.a, c = contacts();
        if (a === 'theme') return setTimeout(() => menu(x, y, Object.entries(THEMES).map(([k, t]) => `<button class=i data-t=${k}><span style="display:inline-block;width:14px;height:14px;border-radius:50%;vertical-align:-2px;margin-right:8px;background:${t.dot}"></span>${t.name}</button>`).join(''),
          (el2, d2) => el2.querySelectorAll('[data-t]').forEach(b2 => b2.onclick = () => { d2(); const th = LS.get('themes', {}); th[key] = b2.dataset.t; LS.set('themes', th); repaint(); })), 0);
        if (a === 'ttl') return setTimeout(() => menu(x, y, [[0, 'Off'], [3600, '1 hour'], [86400, '1 day'], [604800, '1 week']].map(([v, l]) => `<button class=i data-ttl=${v}>${chatSet(key).ttl === v || (!chatSet(key).ttl && !v) ? '✓ ' : ''}${l}</button>`).join(''),
          (el2, d2) => el2.querySelectorAll('[data-ttl]').forEach(b2 => b2.onclick = () => { d2(); const v = +b2.dataset.ttl, cs = chatSet(key); cs.ttl = v; saveChatSet(key, cs); control(key, [['hush-ttlset', String(v)]]);
            const all = chats(), l = all[key] || (all[key] = []); l.push({ id: 's' + Date.now(), from: 'me', sys: true, text: 'You ' + (v ? 'turned on disappearing messages — ' + ttlLabel(v) : 'turned off disappearing messages'), at: Date.now() }); LS.set('chats', all); repaint(); })), 0);
        if (a === 'rename') { const n = prompt(g ? 'Group name (everyone sees it)' : 'Name for this contact', chatName(key)); if (!n || !n.trim()) return;
          if (g) { const gs = groups(); gs[key] = { ...(gs[key] || {}), name: n.trim().slice(0, 60) }; LS.set('groups', gs); sendText(key, '✏️ renamed the group to “' + n.trim().slice(0, 60) + '”'); }
          else { c[key] = { ...(c[key] || {}), name: n.trim().slice(0, 40), named: true }; LS.set('contacts', c); } repaint(); }
        else if (a === 'verify') { view.verify = key; view.screen = 'verify'; repaint(); }
        else if (a === 'people') A.toast('You, ' + members(key).map(nameOf).join(', '));
        else if (a === 'id') prompt('Their Hush ID', npub(key));
        else if (a === 'wall') { const cs = chatSet(key); if (cs.wall && confirm('Remove this chat’s wallpaper?')) { cs.wall = null; saveChatSet(key, cs); return repaint(); }
          const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*'; f.onchange = async () => { const fl = f.files[0]; if (!fl) return; const b = await shrink(fl, 1400, 0.7).catch(() => fl); const id = 'wall-' + hex(crypto.getRandomValues(new Uint8Array(6))); await putFile(id, b); const c2 = chatSet(key); c2.wall = id; saveChatSet(key, c2); repaint(); A.toast('🖼 Wallpaper set — only on this device'); }; f.click(); }
        else if (a === 'fav') { const f = LS.get('favs', []); LS.set('favs', f.includes(key) ? f.filter(x => x !== key) : [...f, key]); repaint(); }
        else if (a === 'find') { findInChat(key); }
        else if (a === 'links') { readingList(key); }
        else if (a === 'labels') { const ms = members(key); const v = overlay(`<h3>🏷 Member labels</h3><p>A short role next to each name — “Coach”, “Mom”, “Organizer”. Everyone in the group sees them.</p>${ms.map(pk => `<div class=hm-opt><div>${esc(nameOf(pk))}</div><input class=hm-in data-lab="${pk}" maxlength=24 value="${esc(groups()[key]?.labels?.[pk] || '')}" style="max-width:150px;margin:0"></div>`).join('')}<div style="display:flex;justify-content:flex-end;gap:8px"><button class="hm-btn ghost" data-x>Cancel</button><button class=hm-btn id=lab-s>Save</button></div>`);
          v.querySelector('#lab-s').onclick = () => { const g = groups(); for (const i of v.querySelectorAll('[data-lab]')) { const pk = i.dataset.lab, val = i.value.trim().slice(0, 24); if ((g[key]?.labels?.[pk] || '') !== val) control(key, [['hush-label', pk, val]]); g[key] = { ...(g[key] || {}), labels: { ...(g[key]?.labels || {}), [pk]: val } }; } LS.set('groups', g); v.remove(); repaint(); }; }
        else if (a === 'protect') { const cs = chatSet(key), on = !cs.protect; control(key, [['hush-protect', on ? '1' : '0']]); cs.protect = on; saveChatSet(key, cs); repaint(); A.toast(on ? '🛡 Protected: nobody in this chat can save, copy or forward from Hush. (They could still photograph their screen.)' : 'Protected chat off'); }
        else if (a === 'clear') { if (confirm('Clear all messages in ' + chatName(key) + ' on this device?')) { const all = chats(); delete all[key]; LS.set('chats', all); repaint(); } }
        else if (a === 'block') { c[key] = { ...(c[key] || {}), blocked: true }; LS.set('contacts', c); view.screen = 'list'; repaint(); A.toast('Blocked — you won’t see their messages'); }
        else if (a === 'del') { if (!confirm(g ? 'Leave this group and delete it from this device?' : 'Delete this chat and contact?')) return;
          const all = chats(); delete all[key]; LS.set('chats', all); if (g) { const gs = groups(); delete gs[key]; LS.set('groups', gs); } else { delete c[key]; LS.set('contacts', c); } view.screen = 'list'; repaint(); } }));
  }
  function drawAdd() {
    view.el.innerHTML = `<div class="hm hm-mur">${head('New chat', '', `<button class=hm-ib data-go=list aria-label=Back>${I.back}</button>`)}<div class=hm-body>
      <button class="hm-row" data-go=group style="margin-top:6px">${avatar('a,b', 44)}<div class=t><b>New group</b><span>Chat with several people at once</span></div></button>
      <div class=hm-card style="text-align:center"><h3>📷 Scan their Hush Card</h3><p>The fastest way — point your camera at their card or QR code.</p><button class=hm-btn id=hm-scan>Scan a code</button></div>
      <div class=hm-card><h3>Or paste their ID</h3><p>Paste their Hush ID (it starts with <b>npub</b>). They can find it under the QR button in their Murmur.</p>
      <input class=hm-in id=hm-id placeholder="npub1…" autocapitalize=off spellcheck=false><input class=hm-in id=hm-nm placeholder="Name (optional)" maxlength=40>
      <button class=hm-btn id=hm-add>Start chat</button></div>
      <div class=hm-card><h3>Or let them add you</h3><p>Show your code — they can scan it with their phone camera.</p><button class="hm-btn ghost" data-go=me>Show my Hush ID</button></div></div></div>`;
    wireCommon();
    view.el.querySelector('#hm-scan').onclick = scan;
    view.el.querySelector('#hm-add').onclick = () => { const raw = view.el.querySelector('#hm-id').value, pk = parseId(raw); if (!pk) return A.toast('That isn’t a Hush ID — it should start with npub1');
      if (pk === me) return A.toast('That’s your own ID'); addContact(pk, view.el.querySelector('#hm-nm').value.trim(), inviteOf(raw)); openChat(pk); };
  }
  function drawGroup() {
    const c = contacts(), people = Object.keys(c).filter(k => !c[k].blocked && !c[k].request && (!c[k].auto || chats()[k]));
    view.el.innerHTML = `<div class="hm hm-mur">${head('New group', `<small>${view.pick.size} selected</small>`, `<button class=hm-ib data-go=add aria-label=Back>${I.back}</button>`)}<div class=hm-body>
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
  async function drawVerify() {
    const pk = view.verify, code = await safetyCode(pk), v = verified(pk);
    view.el.innerHTML = `<div class="hm hm-mur">${head('Safety code', `<small>${esc(nameOf(pk))}</small>`, `<button class=hm-ib id=hm-vb aria-label=Back>${I.back}</button>`)}<div class=hm-body>
      <div class=hm-card style="text-align:center"><div style="font:600 26px/1.5 ui-monospace,monospace;letter-spacing:2px">${code.split(' ').map(x => `<span style="display:inline-block;margin:0 6px">${x}</span>`).join('')}</div>
      <p style="margin-top:12px">Open this screen on ${esc(first(pk))}’s device too. <b>If the numbers match</b>, you’re really talking to them and nobody can be in the middle. Best done in person or on a call.</p>
      <button class="hm-btn ${v ? 'ghost' : ''}" id=hm-vt>${v ? 'Remove verification' : '✓ The numbers match — mark as verified'}</button></div>
      <div class=hm-card><p style="margin:0">Verified contacts get a ✓ next to their name. If someone else ever messages you using the same name, Murmur warns you it isn’t them.</p></div></div></div>`;
    view.el.querySelector('#hm-vb').onclick = () => { view.screen = 'chat'; view.chat = pk; repaint(); };
    view.el.querySelector('#hm-vt').onclick = () => { const c = contacts(); c[pk] = { ...(c[pk] || {}), verified: !v }; delete c[pk].request; LS.set('contacts', c); A.toast(v ? 'Verification removed' : '✓ ' + nameOf(pk) + ' is verified'); repaint(); };
  }
  // ---------------------------------------------------------------- app lock
  let lockCfg = undefined, unlockedAt = 0;
  async function loadLock() { if (lockCfg !== undefined) return lockCfg; try { const v = await A.secret.get('murmur-lock'); lockCfg = v ? JSON.parse(v) : null; } catch { lockCfg = null; } return lockCfg; }
  async function pinHash(pin, salt) { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: 210000 }, k, 256))); }
  let fails = 0, waitUntil = 0;
  async function checkPin(pin) { if (Date.now() < waitUntil) { A.toast('Too many tries — wait a moment'); return false; }
    const ok = (await pinHash(pin, lockCfg.salt)) === lockCfg.hash; if (ok) fails = 0; else { fails++; if (fails >= 5) waitUntil = Date.now() + 30000 * 2 ** Math.min(fails - 5, 5); } return ok; }
  function pinPad(title, opt = {}) { return new Promise(res => { const v = document.createElement('div'); v.className = 'hm-view hm-lock'; let pin = '';
    v.innerHTML = `<div class=hm-pin><div style="font-size:30px">🔒</div><h3>${esc(title)}</h3><div class=dots></div><div class=pad>${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(k => `<button data-k="${k}" ${k === '' ? 'disabled' : ''}>${k}</button>`).join('')}</div>
      <div style="display:flex;gap:8px;justify-content:center">${opt.bio ? '<button class=hm-btn data-x=bio>Use fingerprint</button>' : ''}<button class="hm-btn ghost" data-x=ok>OK</button><button class="hm-btn ghost" data-x=no>Cancel</button></div></div>`;
    document.body.append(v); const dots = () => v.querySelector('.dots').textContent = '●'.repeat(pin.length) || ' ';
    const done = r => { v.remove(); removeEventListener('keydown', key); res(r); };
    const key = e => { if (/^[0-9]$/.test(e.key) && pin.length < 8) { pin += e.key; dots(); } else if (e.key === 'Backspace') { pin = pin.slice(0, -1); dots(); } else if (e.key === 'Enter') ok(); else if (e.key === 'Escape') done(null); };
    const ok = () => { if (pin.length < 4) return A.toast('At least 4 digits'); if (opt.check) opt.check(pin).then(g => { if (g) done(pin); else { pin = ''; dots(); v.querySelector('.hm-pin').classList.add('shake'); setTimeout(() => v.querySelector('.hm-pin')?.classList.remove('shake'), 400); } }); else done(pin); };
    addEventListener('keydown', key); dots();
    v.onclick = e => { const k = e.target.dataset?.k, x = e.target.dataset?.x;
      if (k !== undefined && k !== '') { if (k === '⌫') pin = pin.slice(0, -1); else if (pin.length < 8) pin += k; dots(); if (opt.auto && pin.length === opt.auto) ok(); }
      if (x === 'ok') ok(); if (x === 'no') done(null); if (x === 'bio') opt.bio().then(g => g && done(true)); };
    if (opt.bio && opt.bioFirst) opt.bio().then(g => g && done(true)); }); }
  const bio = async () => { if (!A.biometric) return false; try { const r = await A.biometric(); return !!(r && r.ok); } catch { return false; } };
  async function askPin(title) { await loadLock(); if (!lockCfg) return true; return !!(await pinPad(title, { check: checkPin, bio: A.biometric ? bio : null })); }
  // Gate: Murmur and Echo ask for the PIN (or fingerprint) when opened after 5 minutes away.
  async function gate(el, then) { await loadLock(); if (!lockCfg || Date.now() - unlockedAt < 5 * 60000) { unlockedAt = Date.now(); return then(); }
    const r = await pinPad('Unlock Murmur & Echo', { check: checkPin, bio: A.biometric ? bio : null, bioFirst: !!A.biometric });
    if (r) { unlockedAt = Date.now(); then(); } else { A.close && A.close(); } }
  document.addEventListener('pointerdown', () => { if (view.open && unlockedAt && lockCfg) unlockedAt = Date.now(); }, true);   // activity keeps it unlocked
  // ---------------------------------------------------------------- backup & restore
  async function pbkdf(pass, salt, it) { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: it }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
  function drawBackup() {
    view.el.innerHTML = `<div class="hm hm-mur">${head('Back up', '', `<button class=hm-ib data-go=me aria-label=Back>${I.back}</button>`)}<div class=hm-body>
      <div class=hm-card><h3>📄 Backup file (recommended)</h3><p>Saves your ID, contacts, groups, settings${hooks.backup.length ? ' and Echo profile & posts' : ''}, locked with a password you choose. Keep it somewhere safe — like a USB drive or your password manager. Hush can’t recover a forgotten password.</p>
        <input class=hm-in id=hm-bp1 type=password placeholder="Backup password (at least 8 characters)" autocomplete=new-password><input class=hm-in id=hm-bp2 type=password placeholder="Same password again" autocomplete=new-password>
        <button class=hm-btn id=hm-bf>Save backup file</button>
        <p style="margin:12px 0 4px"><b>No password to remember?</b> Lock the file with your 24 recovery words instead — anyone restoring needs the file <i>and</i> the words.</p><button class="hm-btn ghost" id=hm-bw>Save backup locked with my words</button></div>
      <div class=hm-card><h3>🔑 Recovery words</h3><p>24 words that restore your Hush ID (not your contacts). Write them on paper. <b>Anyone with these words can read your messages and post as you</b> — never type them into a website or share a photo of them.</p>
        <div id=hm-words></div><button class="hm-btn ghost" id=hm-sw>Show my 24 words</button></div></div></div>`;
    wireCommon();
    view.el.querySelector('#hm-sw').onclick = async () => { if (!await askPin('Enter your PIN to show your words')) return;
      const w = N.entropyToMnemonic(sk, N.bip39English).split(' ');
      view.el.querySelector('#hm-words').innerHTML = `<ol class=hm-words>${w.map(x => `<li>${esc(x)}</li>`).join('')}</ol>`; view.el.querySelector('#hm-sw').remove(); };
    const doBackup = async (a, words) => {
      const extra = {}; for (const f of hooks.backup) { try { Object.assign(extra, await f()); } catch {} }
      const data = { v: 1, key: hex(sk), pq: pq ? pq.hex : null, contacts: contacts(), groups: groups(), profile: profile(), prefs: prefs(), relays: relays(), hosts: hosts(), extra, at: Date.now() };
      const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), it = 600000;
      const enc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await pbkdf(a, salt, it), new TextEncoder().encode(JSON.stringify(data))));
      let b64 = ''; for (let i = 0; i < enc.length; i += 8192) b64 += String.fromCharCode.apply(null, enc.subarray(i, i + 8192));
      const file = JSON.stringify({ hush: 'backup', v: 1, kdf: 'pbkdf2-sha256', it, salt: hex(salt), iv: hex(iv), lock: words ? 'words' : 'password', data: btoa(b64) });
      const name = 'Hush backup ' + new Date().toISOString().slice(0, 10) + '.hushbackup', blob = new Blob([file], { type: 'application/octet-stream' });
      if (A.mobile && navigator.canShare && navigator.canShare({ files: [new File([blob], name)] })) navigator.share({ files: [new File([blob], name)], title: 'Hush backup' }).catch(() => {});
      else saveBlob(blob, name);
      A.toast(words ? 'Backup saved — restore it with the file and your 24 words' : 'Backup saved — keep the file and your password safe'); };
    view.el.querySelector('#hm-bf').onclick = async () => { const a = view.el.querySelector('#hm-bp1').value, b = view.el.querySelector('#hm-bp2').value;
      if (a.length < 8) return A.toast('Use at least 8 characters'); if (a !== b) return A.toast('Passwords don’t match'); if (!await askPin('Enter your PIN to make a backup')) return; doBackup(a, false); };
    view.el.querySelector('#hm-bw').onclick = async () => { if (!await askPin('Enter your PIN to make a backup')) return; doBackup(N.entropyToMnemonic(sk, N.bip39English), true); };
  }
  async function finishRestore(k, data, msg) { await useKey(k, data && /^[0-9a-f]+:[0-9a-f]+$/.test(data.pq || '') ? data.pq : null); if (data) { LS.set('contacts', data.contacts || {}); LS.set('groups', data.groups || {}); if (data.profile) LS.set('profile', data.profile);
      if (data.prefs) LS.set('prefs', data.prefs); if (data.chats && typeof data.chats === 'object') LS.set('chats', { ...chats(), ...data.chats });
      for (const f of hooks.restore) { try { await f(data.extra || {}); } catch {} } }
    LS.set('since', now() - 14 * 86400); view.screen = 'list'; start(); badge(); repaint(); A.toast(msg || 'Welcome back — your Hush ID is restored'); }
  // ---------------------------------------------------------------- Link my devices
  // The old device packs your ID, contacts, chats (text) and Echo, locks it twice (a random key in the QR code + a
  // 6-digit code you type), and leaves it, encrypted, on a file host through Tor for 15 minutes. The new device scans,
  // types the code, downloads and unlocks it. Both devices then share one Hush ID, so messages arrive on both.
  function broadcastUI() { const fr = Object.keys(contacts()).filter(k => !contacts()[k].blocked && !contacts()[k].request && !contacts()[k].auto);
    if (!fr.length) return A.toast('Add some contacts first');
    const v = overlay(`<h3>📣 Broadcast</h3><p>Send one message to several people. Each gets it as a private 1-to-1 message — they can't see who else got it.</p><textarea class=hm-in id=bc-t rows=3 maxlength=4000 placeholder="Message"></textarea>
      ${fr.map(pk => `<label class=hm-opt style="cursor:pointer"><div>${esc(nameOf(pk))}</div><input type=checkbox data-bc="${pk}"></label>`).join('')}<div style="display:flex;justify-content:flex-end;gap:8px"><button class="hm-btn ghost" data-x>Cancel</button><button class=hm-btn id=bc-go>Send</button></div>`);
    v.querySelector('#bc-go').onclick = () => { const t = v.querySelector('#bc-t').value.trim(), to = [...v.querySelectorAll('[data-bc]:checked')].map(x => x.dataset.bc); if (!t || !to.length) return A.toast('Write a message and pick people');
      for (const pk of to) sendText(pk, t, null); v.remove(); repaint(); A.toast('📣 Sent to ' + to.length + ' people'); }; }
  function findInChat(key) { const list = chats()[key] || [];
    const v = overlay(`<h3>🔎 Search ${esc(chatName(key))}</h3><input class=hm-in id=fc-q placeholder="Words, or from:name" autofocus><div class=ec-seg style="display:flex;gap:6px;margin:6px 0">${[['', 'All'], ['photo', 'Photos'], ['link', 'Links'], ['file', 'Files'], ['voice', 'Voice']].map(([k, l]) => `<button data-ff="${k}" class="hm-btn ghost" style="padding:4px 10px">${l}</button>`).join('')}</div><div id=fc-r style="max-height:50vh;overflow:auto"></div>`);
    let kind = ''; const run = () => { const q = v.querySelector('#fc-q').value.trim().toLowerCase(), fm = (q.match(/from:(\S+)/) || [])[1], words = q.replace(/from:\S+/, '').trim();
      const res = list.filter(m => !m.sys && !m.unsent && (!words || (m.text || '').toLowerCase().includes(words) || (m.file?.name || '').toLowerCase().includes(words)) && (!fm || (m.from === 'me' ? 'me you' : nameOf(m.from).toLowerCase()).includes(fm))
        && (!kind || (kind === 'photo' && m.file?.mime?.startsWith('image/')) || (kind === 'link' && /https?:\/\//.test(m.text || '')) || (kind === 'file' && m.file && !m.file.mime?.startsWith('image/') && !m.file.kind) || (kind === 'voice' && m.file?.kind === 'voice'))).slice(-80).reverse();
      v.querySelector('#fc-r').innerHTML = res.map(m => `<button class=hm-row data-jm="${m.id}" style="width:100%"><div class=t><b>${esc(m.from === 'me' ? 'You' : nameOf(m.from))}</b><span>${esc(preview(m).slice(0, 120))}</span></div><em>${short(m.at)}</em></button>`).join('') || '<p>Nothing found</p>';
      v.querySelectorAll('[data-jm]').forEach(b => b.onclick = () => { v.remove(); const t = view.el.querySelector(`[data-m="${b.dataset.jm}"]`); if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('hm-flash'); setTimeout(() => t.classList.remove('hm-flash'), 1200); } }); };
    v.querySelector('#fc-q').oninput = run; v.querySelectorAll('[data-ff]').forEach(b => b.onclick = () => { kind = b.dataset.ff; v.querySelectorAll('[data-ff]').forEach(x => x.style.background = x === b ? 'var(--ink)' : ''); v.querySelectorAll('[data-ff]').forEach(x => x.style.color = x === b ? 'var(--bg)' : ''); run(); }); run(); }
  // Reading list: every link shared in this chat, newest first, with who shared it and whether you've opened it.
  function readingList(key) { const list = chats()[key] || [], done = LS.get('readDone', {});
    const items = []; for (const m of list) for (const u of ((m.text || '').match(/https?:\/\/[^\s<]+[^\s<.,;:!?)"'\]]/g) || [])) items.push({ u, from: m.from, at: m.at });
    const v = overlay(`<h3>📚 Reading list</h3><p>Links shared in ${esc(chatName(key))}.</p>${items.reverse().slice(0, 100).map(x => { let h = x.u; try { h = new URL(x.u).hostname.replace(/^www\./, ''); } catch {} return `<button class=hm-row data-rl="${esc(x.u)}" style="width:100%;${done[x.u] ? 'opacity:.55' : ''}"><div class=t><b>${done[x.u] ? '✓ ' : ''}${esc(h)}</b><span>${esc(x.u.slice(0, 80))}</span></div><em>${esc(x.from === 'me' ? 'You' : first(x.from))}<br>${short(x.at)}</em></button>`; }).join('') || '<p>No links shared yet.</p>'}`);
    v.querySelectorAll('[data-rl]').forEach(b => b.onclick = () => { const d = LS.get('readDone', {}); d[b.dataset.rl] = Date.now(); LS.set('readDone', d); v.remove(); A.open(b.dataset.rl); }); }
  // Photo editor (before sending a photo or posting to Echo): crop square, rotate, add text, blur faces/details with a finger.
  function editPhoto(file) { return new Promise(res => { const img = new Image(), url = URL.createObjectURL(file); img.onerror = () => res(file); img.onload = () => {
    const MAX = 1600, k = Math.min(1, MAX / Math.max(img.width, img.height)); let W = Math.round(img.width * k), H = Math.round(img.height * k);
    let base = document.createElement('canvas'); base.width = W; base.height = H; base.getContext('2d').drawImage(img, 0, 0, W, H); URL.revokeObjectURL(url);
    let texts = [], tool = 'blur';
    const v = document.createElement('div'); v.className = 'hm-view'; v.style.flexDirection = 'column';
    v.innerHTML = `<canvas style="max-width:94vw;max-height:70vh;touch-action:none;border-radius:8px;background:#000"></canvas><div class=bar style="flex-wrap:wrap;justify-content:center">
      <button data-t=blur style="background:#fff3">🫥 Blur</button><button data-t=text>Aa Text</button><button data-t=crop>⬚ Square</button><button data-t=rot>⟳ Rotate</button><button data-t=undo>↶ Undo</button><button data-x>Cancel</button><button data-t=done style="background:var(--acc);color:var(--bg)">Use photo</button></div>
      <p style="color:#fff;font-size:12.5px;margin:6px">Blur: drag over faces or details to hide them before anyone sees the photo.</p>`;
    document.body.append(v); const cv = v.querySelector('canvas'), g = cv.getContext('2d'); const hist = [];
    const draw = () => { cv.width = base.width; cv.height = base.height; g.drawImage(base, 0, 0); for (const t of texts) { g.font = `700 ${t.s}px system-ui`; g.textAlign = 'center'; g.lineWidth = t.s / 7; g.strokeStyle = '#000'; g.fillStyle = '#fff'; g.strokeText(t.v, t.x, t.y); g.fillText(t.v, t.x, t.y); } };
    const snap = () => { const c = document.createElement('canvas'); c.width = base.width; c.height = base.height; c.getContext('2d').drawImage(base, 0, 0); hist.push([c, texts.slice()]); if (hist.length > 15) hist.shift(); };
    const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    const pix = (x, y, rad) => { const b = base.getContext('2d'), sz = Math.max(8, rad / 3), x0 = Math.max(0, x - rad), y0 = Math.max(0, y - rad);
      for (let yy = y0; yy < Math.min(base.height, y + rad); yy += sz) for (let xx = x0; xx < Math.min(base.width, x + rad); xx += sz) { const d = b.getImageData(xx, yy, 1, 1).data; b.fillStyle = `rgb(${d[0]},${d[1]},${d[2]})`; b.fillRect(xx, yy, sz, sz); } };
    let down = false; cv.onpointerdown = e => { const [x, y] = pos(e);
      if (tool === 'text') { const t = prompt('Text on the photo'); if (t) { snap(); texts.push({ v: t.slice(0, 60), x, y, s: Math.round(base.width / 14) }); draw(); } return; }
      down = true; snap(); cv.setPointerCapture(e.pointerId); pix(x, y, base.width / 22); draw(); };
    cv.onpointermove = e => { if (!down) return; const [x, y] = pos(e); pix(x, y, base.width / 22); draw(); }; cv.onpointerup = () => { down = false; };
    v.onclick = e => { const t = e.target.dataset?.t;
      if (e.target.dataset?.x !== undefined) { v.remove(); return res(null); }
      if (t === 'blur' || t === 'text') { tool = t; v.querySelectorAll('[data-t=blur],[data-t=text]').forEach(b => b.style.background = b.dataset.t === t ? '#fff3' : ''); }
      if (t === 'undo' && hist.length) { const [c, tx] = hist.pop(); base = c; texts = tx; draw(); }
      if (t === 'rot') { snap(); const c = document.createElement('canvas'); c.width = base.height; c.height = base.width; const cg = c.getContext('2d'); cg.translate(c.width, 0); cg.rotate(Math.PI / 2); cg.drawImage(base, 0, 0); base = c; texts = []; draw(); }
      if (t === 'crop') { snap(); const m = Math.min(base.width, base.height), c = document.createElement('canvas'); c.width = c.height = m; c.getContext('2d').drawImage(base, (base.width - m) / 2, (base.height - m) / 2, m, m, 0, 0, m, m); base = c; texts = []; draw(); }
      if (t === 'done') { draw(); cv.toBlob(b => { v.remove(); res(b ? new File([b], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.85); } };
    draw(); }; img.src = url; }); }
  function overlay(html) { A.haptic && A.haptic(); const v = document.createElement('div'); v.className = 'hm-view'; v.innerHTML = `<div class=hm-card style="width:min(420px,92vw);color:var(--ink);max-height:90vh;overflow:auto">${html}</div>`;
    document.body.append(v); v.onclick = e => { if (e.target === v || e.target.closest('[data-x]')) v.remove(); }; return v; }
  async function linkShow() {
    if (!await askPin('Enter your PIN to link a device')) return;
    const v = overlay('<h3>📱 Link another device</h3><p>Packing your ID, contacts and chats…</p>');
    try {
      const extra = {}; for (const f of hooks.backup) { try { Object.assign(extra, await f()); } catch {} }
      const ch = {}; for (const [k, l] of Object.entries(chats())) ch[k] = l.filter(m => !m.file && !m.unsent && !m.once).slice(-300);
      const data = { v: 1, key: hex(sk), pq: pq ? pq.hex : null, contacts: contacts(), groups: groups(), profile: profile(), prefs: prefs(), relays: relays(), hosts: hosts(), chats: ch, extra, at: Date.now() };
      const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)), salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
      const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await pbkdf(code, salt, 300000), new TextEncoder().encode(JSON.stringify(data)));
      const meta = await uploadEncrypted(new Blob([enc], { type: 'application/octet-stream' }));
      const exp = now() + 900, link = 'hushlink:' + btoa(JSON.stringify({ u: meta.url, a: meta.alt, k: meta.k, n: meta.nonce, x: meta.x, s: hex(salt), i: hex(iv), e: exp }));
      v.firstChild.innerHTML = `<h3>📱 Link another device</h3><p>On the new device: open Murmur → <b>Link from my other device</b> → scan this, then type the code.</p>
        <div class=hm-qr style="max-width:260px;margin:8px auto">${A.qr ? A.qr(link) : ''}</div><div style="text-align:center;font:700 30px ui-monospace,monospace;letter-spacing:6px;margin:6px 0">${code.slice(0, 3)} ${code.slice(3)}</div>
        <p style="font-size:12.5px">Works for 15 minutes. <b>Only show this to your own devices</b> — the code and the QR together are your whole Hush ID.</p>
        <div style="display:flex;gap:8px;justify-content:center"><button class="hm-btn ghost" id=lk-c>Copy link instead</button><button class=hm-btn data-x>Done</button></div>`;
      v.querySelector('#lk-c').onclick = async () => { try { await navigator.clipboard.writeText(link); A.toast('Link copied — paste it on the other device, then type the code'); } catch { prompt('Link', link); } };
      setTimeout(() => v.isConnected && v.remove(), 900e3);
    } catch (e) { v.firstChild.innerHTML = `<h3>📱 Link another device</h3><p>Couldn’t prepare the link: ${esc(String(e.message || e).slice(0, 120))}</p><button class=hm-btn data-x>Close</button>`; }
  }
  function linkJoin() {
    const v = overlay(`<h3>📱 Link from my other device</h3><p>On your other device: Murmur → Your Hush ID → <b>Link another device</b>. Then scan its code here, or paste its link.</p>
      <button class=hm-btn id=lj-s style="width:100%">📷 Scan the code</button><textarea class=hm-in id=lj-l rows=2 placeholder="…or paste the link (hushlink:…)" style="margin-top:10px" autocapitalize=off spellcheck=false></textarea>
      <input class=hm-in id=lj-c inputmode=numeric maxlength=7 placeholder="6-digit code" style="text-align:center;font:600 20px ui-monospace,monospace;letter-spacing:4px">
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="hm-btn ghost" data-x>Cancel</button><button class=hm-btn id=lj-go>Link</button></div>`);
    v.querySelector('#lj-s').onclick = () => scan(t => { if (!/^hushlink:/.test(t)) return false; v.querySelector('#lj-l').value = t; v.querySelector('#lj-c').focus(); A.toast('Got it — now type the code'); return true; });
    v.querySelector('#lj-go').onclick = async () => {
      const b = v.querySelector('#lj-go'), code = v.querySelector('#lj-c').value.replace(/\D/g, ''); let j;
      try { j = JSON.parse(atob(v.querySelector('#lj-l').value.trim().replace(/^hushlink:/, ''))); } catch { return A.toast('That isn’t a Hush link code'); }
      if (code.length !== 6) return A.toast('Type the 6-digit code shown on your other device');
      if (+j.e < now()) return A.toast('That code expired — make a new one on your other device');
      b.disabled = true; b.textContent = 'Linking through Tor…';
      try { const u = await mediaUrl({ url: j.u, alt: j.a || [], k: j.k, nonce: j.n, x: j.x, mime: 'application/octet-stream' }); if (!u) throw new Error('download');
        const buf = await (await fetch(u)).arrayBuffer(); let plain;
        try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(j.i) }, await pbkdf(code, unhex(j.s), 300000), buf); } catch { throw new Error('code'); }
        const data = JSON.parse(new TextDecoder().decode(plain)); if (!/^[0-9a-f]{64}$/.test(data.key)) throw new Error('bad');
        v.remove(); await finishRestore(data.key, data, '📱 Linked — this device now has your Hush ID, contacts and chats');
      } catch (e) { b.disabled = false; b.textContent = 'Link'; A.toast(String(e.message) === 'code' ? 'Wrong code — check it and try again' : 'Couldn’t download the link — check the connection and try again'); } };
  }
  function drawRestore() {
    view.el.innerHTML = `<div class="hm hm-mur">${head('Restore', '', `<button class=hm-ib data-go=welcome aria-label=Back>${I.back}</button>`)}<div class=hm-body>
      <div class=hm-card><h3>📄 From a backup file</h3><p>Restores your ID, contacts, groups and settings.</p><input type=file id=hm-rf class=hm-in accept=".hushbackup,application/octet-stream,application/json">
        <input class=hm-in id=hm-rp type=password placeholder="Backup password — or your 24 words if you locked it with them"><button class=hm-btn id=hm-rgo>Restore</button></div>
      <div class=hm-card><h3>🔑 From recovery words</h3><p>Restores your ID only. Type your 24 words separated by spaces.</p><textarea class=hm-in id=hm-rw rows=4 autocapitalize=off spellcheck=false placeholder="word1 word2 word3 …"></textarea>
        <button class=hm-btn id=hm-rwo>Restore</button></div></div></div>`;
    wireCommon();
    const finish = finishRestore;
    view.el.querySelector('#hm-rwo').onclick = async () => { const w = view.el.querySelector('#hm-rw').value.trim().toLowerCase().split(/\s+/).join(' ');
      if (!N.validateMnemonic(w, N.bip39English)) return A.toast('Those words don’t look right — check spelling and order');
      await finish(hex(N.mnemonicToEntropy(w, N.bip39English))); };
    view.el.querySelector('#hm-rgo').onclick = async () => { const f = view.el.querySelector('#hm-rf').files[0], pw = view.el.querySelector('#hm-rp').value; if (!f) return A.toast('Pick your backup file');
      try { const j = JSON.parse(await f.text()); if (j.hush !== 'backup') throw 0;
        const bin = Uint8Array.from(atob(j.data), c => c.charCodeAt(0));
        const pw2 = j.lock === 'words' ? pw.trim().toLowerCase().split(/\s+/).join(' ') : pw;
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(j.iv) }, await pbkdf(pw2, unhex(j.salt), +j.it || 600000), bin);
        const data = JSON.parse(new TextDecoder().decode(plain)); if (!/^[0-9a-f]{64}$/.test(data.key)) throw 0; await finish(data.key, data);
      } catch (e) { A.toast('Couldn’t open that backup — wrong password or not a Hush backup'); } };
  }
  function addContact(pk, name, invite, verifiedNow) { setTimeout(() => shareCard(), 1500); const c = contacts(); c[pk] = { ...(c[pk] || {}), added: c[pk]?.added || Date.now(), ...(name ? { name: name.slice(0, 40), named: true } : {}), ...(invite ? { invite } : {}), ...(verifiedNow ? { verified: true } : {}) }; delete c[pk].request; delete c[pk].blocked; delete c[pk].auto; LS.set('contacts', c); }
  function drawMe() {
    const id = npub(me), link = 'hush://add#' + id, p = prefs();
    view.el.innerHTML = `<div class="hm hm-mur">${head('Your Hush ID', '', `<button class=hm-ib data-go=list aria-label=Back>${I.back}</button>`)}<div class=hm-body>
      <div class=hm-card style="text-align:center"><div class=hm-qr>${A.qr ? A.qr(link) : ''}</div><p>Friends scan this with their phone camera, or paste your ID into New chat.</p>
      <div class=hm-id>${esc(id)}</div><div style="margin-top:10px;display:flex;gap:8px;justify-content:center"><button class=hm-btn id=hm-copy>Copy ID</button>${navigator.share ? '<button class="hm-btn ghost" id=hm-sh>Share</button>' : ''}</div></div>
      <div class=hm-card style="padding:0;overflow:hidden"><div class=hm-banner style="${profile().banner ? '' : 'background:linear-gradient(135deg,' + (profile().aura || colorOf(me)) + ',var(--card))'}">${profile().banner ? `<img data-av='${esc(JSON.stringify(profile().banner))}' alt="" style="width:100%;height:100%;object-fit:cover;opacity:0">` : ''}<label class=hm-bannerbtn>🖼 Banner<input type=file accept="image/*" id=hm-bn hidden></label></div>
        <div style="padding:0 16px 16px;margin-top:-36px"><label style="display:inline-block;cursor:pointer;position:relative" title="Change photo">${avatarHTML(me, 76)}<span class=hm-cam>📷</span><input type=file accept="image/*" id=hm-av hidden></label>
        <input class=hm-in id=hm-name value="${esc(profile().name)}" maxlength=40 placeholder="Your name"><input class=hm-in id=hm-status value="${esc(profile().status || '')}" maxlength=80 placeholder="Status — e.g. “At the beach 🌊”">
        <div style="font:600 12px system-ui;color:var(--mute);margin:2px 0 6px">AURA — a ring friends see around your photo</div><div class=hm-auras>${['', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#f97316', '#eab308', '#14b8a6', '#ef4444'].map(c => `<button data-aura="${c}" class="${(profile().aura || '') === c ? 'on' : ''}" style="background:${c || 'var(--card)'}">${c ? '' : '∅'}</button>`).join('')}</div>
        <div style="display:flex;gap:8px;margin-top:12px"><button class=hm-btn id=hm-save>Save profile</button><button class="hm-btn ghost" id=hm-card>Show my Hush Card</button></div>
        <p style="margin:10px 0 0;font-size:12px">Your photo, banner and status go only to your contacts, encrypted.</p></div></div>
      <div class=hm-card><h3>Chat settings</h3>
        <div class=hm-opt><div>Read receipts<small>Show ✓✓ / “Seen” — if off, you won’t see theirs either</small></div><button class="hm-sw ${p.receipts ? 'on' : ''}" data-pref=receipts aria-label="Read receipts"></button></div>
        <div class=hm-opt><div>🔔 Message notifications<small>A banner at the top of Hush${A.mobile ? ', and a notification when Hush is in the background' : ''}</small></div><button class="hm-sw ${!p.nonotif ? 'on' : ''}" data-pref=nonotif aria-label="Message notifications"></button></div>
        <div class=hm-opt><div>Show message text in notifications<small>Off: only “New message” is shown, so nothing private appears on your lock screen</small></div><button class="hm-sw ${!p.nopreview ? 'on' : ''}" data-pref=nopreview aria-label="Show message text"></button></div>
        ${A.mobile ? `<div class=hm-opt><div>Stay connected in the background<small>Keeps Murmur online with a quiet notification so messages arrive when Hush isn’t open</small></div><button class="hm-sw ${!p.nobg ? 'on' : ''}" data-pref=nobg aria-label="Stay connected"></button></div>` : ''}
        <div class=hm-opt><div>Typing indicator<small>Let people see when you’re typing</small></div><button class="hm-sw ${p.typing ? 'on' : ''}" data-pref=typing aria-label="Typing indicator"></button></div>
        <div class=hm-opt><div>👻 Ghost mode<small>Never share your location, even by accident</small></div><button class="hm-sw ${p.ghost ? 'on' : ''}" data-pref=ghost aria-label="Ghost mode"></button></div>
        <div class=hm-opt><div>Privacy curtain<small>Blur chats when you switch away${A.mobile ? '; block screenshots and the recent-apps preview while Murmur or Echo is open' : ''}</small></div><button class="hm-sw ${p.curtain !== false ? 'on' : ''}" data-pref=curtain aria-label="Privacy curtain"></button></div></div>
      <div class=hm-card><h3>Lock Murmur & Echo</h3><p>${lockCfg ? '🔒 On — ' + (A.biometric ? 'fingerprint/face or ' : '') + 'your PIN is needed after 5 minutes away.' : 'Ask for a PIN' + (A.biometric ? ' or your fingerprint/face' : '') + ' before anyone can open your messages on this device.'}</p>
        <button class=hm-btn id=hm-lock>${lockCfg ? 'Turn off lock' : 'Set a PIN'}</button>${lockCfg ? ' <button class="hm-btn ghost" id=hm-lnow>Lock now</button>' : ''}</div>
      <div class=hm-card><h3>🎟 One-time invite</h3><p>A link that works for one person. Once they use it, it can't be reused — safe to send to someone new.</p><button class=hm-btn id=hm-inv>Make an invite link</button>
        <div class=hm-opt style="margin-top:12px"><div>Only people I add or invite<small>Messages from strangers are dropped silently — no requests, no spam</small></div><button class="hm-sw ${p.inviteOnly ? 'on' : ''}" data-pref=inviteOnly aria-label="Invite only"></button></div></div>
      <div class=hm-card><h3>📱 Link another device</h3><p>Use the same Hush ID on your phone and computer — contacts, chats and Echo come along, and new messages arrive on both.</p><button class=hm-btn id=hm-lk>Link a device</button></div>
      <div class=hm-card><h3>Back up your Hush ID</h3><p>Without a backup, losing this device means losing your ID — there’s no account to recover. Your backup restores your ID${hooks.backup.length ? ', contacts and Echo profile' : ' and contacts'} on any device.</p>
        <button class=hm-btn data-go=backup>Back up now</button></div>
      <div class=hm-card><h3>Privacy</h3><p><span class=hm-tor>🧅 Tor only</span> Every connection goes through Tor. Messages, photos and files are end-to-end encrypted (NIP-44), sealed and gift-wrapped (NIP-59); 1-to-1 chats add a post-quantum layer (ML-KEM-768) once both sides have it, and relayed by ${relays().length} independent relays.</p>
      <p>🎤 The mic and camera are used only while you hold a record button. Recordings are made and encrypted on this device; Hush keeps no copies and sends nothing anywhere else.</p>
      <p style="margin:0">Your secret key is kept in ${A.mobile ? 'the Android Keystore' : 'your operating system’s protected storage'} and never leaves this device unless you make a backup.</p></div>
      <div class=hm-card><h3>Start over</h3><p>Deletes your ID, contacts, groups, photos and every message on this device.</p><button class="hm-btn ghost" id=hm-reset style="color:#ef4444">Delete everything</button></div></div></div>`;
    wireCommon();
    view.el.querySelectorAll('[data-pref]').forEach(b => b.onclick = () => { const q = prefs(); q[b.dataset.pref] = !q[b.dataset.pref]; LS.set('prefs', q); syncLive(); repaint(); });
    view.el.querySelector('#hm-copy').onclick = async () => { try { await navigator.clipboard.writeText(id); A.toast('Hush ID copied'); } catch { prompt('Your Hush ID', id); } };
    const sh = view.el.querySelector('#hm-sh'); if (sh) sh.onclick = () => navigator.share({ text: 'Message me privately on Hush: ' + id }).catch(() => {});
    view.el.querySelector('#hm-lock').onclick = async () => { if (lockCfg) { if (!await askPin('Enter your PIN to turn off the lock')) return; lockCfg = null; await A.secret.del('murmur-lock').catch(() => {}); A.toast('Lock turned off'); return repaint(); }
      const a = await pinPad('Choose a PIN (4–8 digits)'); if (!a) return; const b = await pinPad('Enter it again'); if (a !== b) return A.toast('PINs didn’t match — try again');
      const salt = hex(crypto.getRandomValues(new Uint8Array(16))); lockCfg = { salt, hash: await pinHash(a, salt) }; await A.secret.set('murmur-lock', JSON.stringify(lockCfg)); unlockedAt = Date.now(); A.toast('🔒 Lock is on'); repaint(); };
    view.el.querySelector('#hm-lk').onclick = linkShow;
    view.el.querySelector('#hm-inv').onclick = async () => { const t = hex(crypto.getRandomValues(new Uint8Array(8))), iv = LS.get('invites', {});
      for (const k in iv) if (Date.now() - iv[k].at > 30 * 86400e3) delete iv[k]; iv[t] = { at: Date.now(), used: null }; LS.set('invites', iv);
      const link = 'hush://add#' + npub(me) + '?i=' + t;
      const v = overlay(`<h3>🎟 One-time invite</h3><p>Send this to one person. It works once, for 30 days.</p><div class=hm-qr style="max-width:240px;margin:8px auto">${A.qr ? A.qr(link) : ''}</div><div class=hm-id style="font-size:11px">${esc(link)}</div>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:10px"><button class=hm-btn id=iv-c>Copy link</button>${navigator.share ? '<button class="hm-btn ghost" id=iv-s>Share</button>' : ''}<button class="hm-btn ghost" data-x>Done</button></div>`);
      v.querySelector('#iv-c').onclick = async () => { try { await navigator.clipboard.writeText(link); A.toast('Invite copied'); } catch { prompt('Invite link', link); } };
      const sb = v.querySelector('#iv-s'); if (sb) sb.onclick = () => navigator.share({ text: 'Chat with me privately on Hush: ' + link }).catch(() => {}); };
    const ln = view.el.querySelector('#hm-lnow'); if (ln) ln.onclick = () => { unlockedAt = 0; A.close && A.close(); };
    const saveP = patch => { LS.set('profile', { ...profile(), ...patch }); shareCard(); };
    view.el.querySelector('#hm-save').onclick = () => { saveP({ name: view.el.querySelector('#hm-name').value.trim().slice(0, 40), status: view.el.querySelector('#hm-status').value.trim().slice(0, 80) }); A.toast('Profile saved — shared with your contacts'); repaint(); };
    const fields = () => ({ name: view.el.querySelector('#hm-name').value.trim().slice(0, 40), status: view.el.querySelector('#hm-status').value.trim().slice(0, 80) });
    view.el.querySelectorAll('[data-aura]').forEach(b => b.onclick = () => { saveP({ ...fields(), aura: b.dataset.aura }); repaint(); });
    const pic = async (inp, w, h, key) => { const f = inp.files[0]; if (!f) return; A.toast('Encrypting & uploading through Tor…');
      try { const keep = fields(); const blob = await crop(f, w, h); const meta = await uploadEncrypted(blob); saveP({ ...keep, [key]: meta }); A.toast(key === 'avatar' ? 'Photo updated' : 'Banner updated'); repaint(); } catch (e) { A.toast('Couldn’t upload: ' + String(e.message || e).slice(0, 90)); } };
    view.el.querySelector('#hm-av').onchange = e => pic(e.target, 512, 512, 'avatar');
    view.el.querySelector('#hm-bn').onchange = e => pic(e.target, 1500, 500, 'banner');
    view.el.querySelector('#hm-card').onclick = () => hushCard();
    view.el.querySelector('#hm-reset').onclick = async () => { if (!confirm('Delete your Hush ID and all messages, photos and files on this device? This can’t be undone.')) return;
      for (const k of ['key', 'contacts', 'chats', 'groups', 'unread', 'seen', 'since', 'profile', 'readSent', 'verified']) localStorage.removeItem('hush.msg.' + k);
      try { await A.secret.del('murmur-key'); await A.secret.del('murmur-lock'); } catch {} lockCfg = null; hooks.reset.forEach(f => { try { f(); } catch {} });
      try { (await db()).close(); dbp = null; indexedDB.deleteDatabase('hush-msg'); } catch {}
      Object.values(conns).forEach(c => c.id && A.inv('msg_ws_close', { id: c.id }).catch(() => {})); sk = null; me = ''; started = false; view.screen = 'welcome'; badge(); repaint(); };
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && view.open && view.screen === 'chat') sendRead(view.chat); });
  // Background: once set up, stay connected (through Tor) so messages arrive while you browse.
  // Share my profile card with every contact who hasn't got the latest one (on start, after edits, and to new contacts).
  function shareCard(force) { if (!sk) return; const p = profile(), ver = JSON.stringify([p.name, p.status, p.aura, p.avatar?.x, p.banner?.x, pq ? hex(pq.pk).slice(0, 16) : '']);
    const sent = LS.get('cardSent', {}), to = Object.keys(contacts()).filter(k => !contacts()[k].blocked && !contacts()[k].request && (force || sent[k] !== ver));
    if (!to.length) return; wrapTo(to, K_PCARD, JSON.stringify({ name: p.name, status: p.status || '', aura: p.aura || '', avatar: p.avatar || null, banner: p.banner || null, pq: pq ? hex(pq.pk) : null }));
    to.forEach(k => sent[k] = ver); LS.set('cardSent', sent); }
  async function boot() { if (!N) return; if (await loadKey()) { start(); badge(); setTimeout(() => shareCard(), 8000); } }
  return { api, open, close, boot, unread: unreadTotal, addFromLink: async s => { const pk = parseId(s); if (!pk || !await loadKey()) return false; addContact(pk, null, inviteOf(s)); return pk; }, ready: () => !!N };
};
