// Hush Messenger — private chat between Hush users, built on Nostr private messages (NIP-17 / NIP-44 / NIP-59).
// Every relay connection goes through Tor (Rust: msg_ws_*), there is no direct fallback.
// Messages are end-to-end encrypted, sealed and gift-wrapped: relays see an encrypted blob addressed to a random-looking
// key, never the sender, never the text, never your IP. Keys, contacts and messages stay on this device (localStorage).
// Shared by desktop (index.html) and Android (mobile.html). A = { inv, listen, toast, mobile, open(url), page(), badge(n), qr(text) }
window.HushMsg = function (A) {
  const N = window.NostrTools;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = { get(k, d) { try { const v = localStorage.getItem('hush.msg.' + k); return v == null ? d : JSON.parse(v) } catch { return d } },
               set(k, v) { try { localStorage.setItem('hush.msg.' + k, JSON.stringify(v)) } catch (e) { A.toast('Storage is full — delete some old chats'); } } };
  const RELAYS_DEFAULT = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://offchain.pub'];
  const REACT = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
  const hex = N ? N.bytesToHex : null, unhex = N ? N.hexToBytes : null;

  // ---------------------------------------------------------------- identity & data
  let sk = null, me = '';
  const relays = () => LS.get('relays', RELAYS_DEFAULT);
  const contacts = () => LS.get('contacts', {});
  const chats = () => LS.get('chats', {});
  const profile = () => LS.get('profile', { name: '' });
  function loadKey() { const k = LS.get('key', ''); if (k && /^[0-9a-f]{64}$/.test(k)) { sk = unhex(k); me = N.getPublicKey(sk); } return !!sk; }
  function createKey() { sk = N.generateSecretKey(); me = N.getPublicKey(sk); LS.set('key', hex(sk)); LS.set('since', Math.floor(Date.now() / 1000) - 3 * 86400); }
  const npub = pk => { try { return N.nip19.npubEncode(pk); } catch { return pk; } };
  const parseId = s => { s = String(s || '').trim().replace(/^(nostr:|hush:\/\/add#?|hush:add#?)/i, '');
    if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
    try { const d = N.nip19.decode(s); if (d.type === 'npub') return d.data; if (d.type === 'nprofile') return d.data.pubkey; } catch {} return null; };
  const nameOf = pk => (contacts()[pk] || {}).name || ('Hush user ' + npub(pk).slice(5, 11));
  const colorOf = pk => `hsl(${parseInt(pk.slice(0, 6), 16) % 360} 55% 48%)`;
  const initials = n => (n.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || '?').toUpperCase();

  // ---------------------------------------------------------------- network (relays over Tor)
  const conns = {};      // url -> {id, open, queue:[]}
  const byId = {};       // conn id -> url
  const pending = {};    // event id -> {chat, msgId}
  let status = 'off', started = false;
  const okRelays = () => Object.values(conns).filter(c => c.open).length;
  function setStatus(s) { status = s; paintStatus(); }
  async function start() {
    if (started || !sk) return; started = true; setStatus('connecting');
    A.listen('msg-ws', ({ payload: p }) => onWs(p));
    for (const u of relays()) openRelay(u);
  }
  async function openRelay(u, wait = 0) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    try { const id = await A.inv('msg_ws_open', { url: u }); conns[u] = { id, open: false, queue: conns[u]?.queue || [], tries: conns[u]?.tries || 0 }; byId[id] = u; }
    catch (e) { setStatus(okRelays() ? 'on' : 'error:' + e); retry(u); }
  }
  function retry(u) { const c = conns[u] || (conns[u] = { queue: [], tries: 0 }); c.open = false; c.tries = (c.tries || 0) + 1;
    openRelay(u, Math.min(120000, 3000 * 2 ** Math.min(c.tries, 5))); }
  const send = (u, msg) => { const c = conns[u]; if (!c) return; if (c.open) A.inv('msg_ws_send', { id: c.id, data: JSON.stringify(msg) }).catch(() => {}); else c.queue.push(msg); };
  function onWs(p) {
    const u = byId[p.id]; if (!u) return; const c = conns[u];
    if (p.t === 'open') { c.open = true; c.tries = 0; setStatus('on');
      send(u, ['REQ', 'hush', { kinds: [1059], '#p': [me], since: LS.get('since', 0) - 2 * 86400 }]);
      const q = c.queue.splice(0); q.forEach(m => send(u, m)); }
    else if (p.t === 'close') { delete byId[p.id]; if (!okRelays()) setStatus(p.d ? 'error:' + p.d : 'connecting'); retry(u); }
    else if (p.t === 'msg') { let m; try { m = JSON.parse(p.d); } catch { return; }
      if (m[0] === 'EVENT' && m[2]) receive(m[2]);
      else if (m[0] === 'OK' && pending[m[1]]) { const { chat, msgId } = pending[m[1]]; if (m[2]) { delete pending[m[1]]; mark(chat, msgId, 'sent'); } } }
  }

  // ---------------------------------------------------------------- receive
  const seen = new Set(LS.get('seen', []));
  function receive(wrap) {
    if (!wrap || wrap.kind !== 1059 || seen.has(wrap.id)) return; seen.add(wrap.id);
    if (seen.size % 25 === 0) LS.set('seen', [...seen].slice(-6000));
    let r; try { if (!N.verifyEvent(wrap)) return; r = N.nip59.unwrapEvent(wrap, sk); } catch { return; }
    const p = (r.tags.find(t => t[0] === 'p') || [])[1];
    const peer = r.pubkey === me ? p : r.pubkey; if (!peer || !/^[0-9a-f]{64}$/.test(peer)) return;
    const all = chats(), list = all[peer] || (all[peer] = []);
    if (r.kind === 14) {
      if (list.some(x => x.id === r.id)) return;
      const name = (r.tags.find(t => t[0] === 'hush-name') || [])[1];
      if (name && r.pubkey !== me) { const c = contacts(); if (!c[peer] || !c[peer].named) { c[peer] = { ...(c[peer] || {}), name: name.slice(0, 40), added: c[peer]?.added || Date.now() }; LS.set('contacts', c); } }
      const reply = (r.tags.find(t => t[0] === 'e') || [])[1];
      list.push({ id: r.id, from: r.pubkey === me ? 'me' : 'them', text: String(r.content).slice(0, 20000), at: r.created_at * 1000, status: 'sent', reply });
      list.sort((a, b) => a.at - b.at); if (list.length > 800) list.splice(0, list.length - 800);
      if (r.pubkey !== me) { const c = contacts(); if (!c[peer]) { c[peer] = { name: nameOf(peer), added: Date.now(), request: true }; LS.set('contacts', c); }
        if (!(view.open && view.chat === peer)) { const un = LS.get('unread', {}); un[peer] = (un[peer] || 0) + 1; LS.set('unread', un); A.toast('💬 ' + nameOf(peer) + ': ' + String(r.content).slice(0, 60)); } }
    } else if (r.kind === 7) {
      const target = (r.tags.find(t => t[0] === 'e') || [])[1], m = list.find(x => x.id === target); if (!m) return;
      m.react = m.react || {}; const who = r.pubkey === me ? 'me' : 'them';
      for (const k in m.react) m.react[k] = m.react[k].filter(w => w !== who);
      if (r.content) (m.react[r.content] = m.react[r.content] || []).push(who);
    } else return;
    all[peer] = list; LS.set('chats', all);
    LS.set('since', Math.max(LS.get('since', 0), Math.min(Math.floor(Date.now() / 1000), r.created_at)));
    badge(); if (view.open) repaint();
  }
  const unreadTotal = () => Object.values(LS.get('unread', {})).reduce((a, b) => a + b, 0);
  const badge = () => A.badge(unreadTotal());

  // ---------------------------------------------------------------- send
  function wrapFor(rumor, pk) { return N.nip59.createWrap(N.nip59.createSeal(rumor, sk, pk), pk); }
  function publish(peer, kind, content, extraTags = []) {
    const tags = [['p', peer], ...extraTags];
    if (kind === 14 && profile().name) tags.push(['hush-name', profile().name.slice(0, 40)]);
    const rumor = N.nip59.createRumor({ kind, content, tags, created_at: Math.floor(Date.now() / 1000) }, sk);
    const toThem = wrapFor(rumor, peer), toMe = wrapFor(rumor, me);   // a copy for my other devices
    seen.add(toMe.id);
    const rs = relays(); for (const u of rs) { send(u, ['EVENT', toThem]); send(u, ['EVENT', toMe]); }
    return { rumor, wrapId: toThem.id };
  }
  function sendText(peer, text, reply) {
    text = text.trim(); if (!text) return;
    const { rumor, wrapId } = publish(peer, 14, text, reply ? [['e', reply, '', 'reply']] : []);
    const all = chats(), list = all[peer] || (all[peer] = []);
    list.push({ id: rumor.id, from: 'me', text, at: Date.now(), status: okRelays() ? 'sending' : 'queued', reply });
    all[peer] = list; LS.set('chats', all); pending[wrapId] = { chat: peer, msgId: rumor.id };
    setTimeout(() => { if (pending[wrapId]) { mark(peer, rumor.id, 'failed'); } }, 45000);
    repaint();
  }
  function react(peer, m, emoji) {
    const mine = (m.react || {})[emoji]?.includes('me');
    publish(peer, 7, mine ? '' : emoji, [['e', m.id], ['k', '14']]);
    const all = chats(), x = (all[peer] || []).find(y => y.id === m.id); if (!x) return;
    x.react = x.react || {}; for (const k in x.react) x.react[k] = x.react[k].filter(w => w !== 'me');
    if (!mine) (x.react[emoji] = x.react[emoji] || []).push('me');
    LS.set('chats', all); repaint();
  }
  function mark(peer, id, st) { const all = chats(), m = (all[peer] || []).find(x => x.id === id); if (m && m.status !== 'sent') { m.status = st; LS.set('chats', all); if (view.open) repaint(); } }
  function resend(peer, m) { const all = chats(); all[peer] = (all[peer] || []).filter(x => x.id !== m.id); LS.set('chats', all); sendText(peer, m.text, m.reply); }

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
  if (!document.getElementById('hm-css')) { const s = document.createElement('style'); s.id = 'hm-css'; s.textContent = css; document.head.append(s); }
  const I = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>', plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>', send: '<svg viewBox="0 0 24 24"><path d="M3 20l18-8L3 4v6l12 2-12 2z"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
    qr: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M21 14v7h-4M14 21v-3"/></svg>' };
  const view = { open: false, el: null, screen: 'list', chat: null, reply: null, q: '' };
  const time = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = t => { const d = new Date(t), n = new Date(); const y = new Date(); y.setDate(n.getDate() - 1);
    return d.toDateString() === n.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); };
  const short = t => { const d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString() ? time(t) : (n - d < 6 * 864e5 ? d.toLocaleDateString([], { weekday: 'short' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' })); };
  const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)"'\]]/g, u => `<a href="#" data-u="${u}">${u.length > 60 ? u.slice(0, 57) + '…' : u}</a>`);
  const avatar = (pk, sz = 44) => `<div class=hm-av style="background:${colorOf(pk)};width:${sz}px;height:${sz}px;font-size:${Math.round(sz / 2.9)}px">${esc(initials(nameOf(pk)))}</div>`;
  function paintStatus() { const e = view.el && view.el.querySelector('.hm-st'); if (!e) return;
    const s = status.startsWith('error') ? 'error' : status; e.className = 'hm-st ' + s;
    e.innerHTML = `<i></i>${s === 'on' ? `Private · through Tor · ${okRelays()} relay${okRelays() === 1 ? '' : 's'}` : s === 'connecting' ? 'Connecting through Tor…' : s === 'error' ? 'Can’t reach Tor — retrying' : 'Offline'}`; }
  function open(el, chat) { view.open = true; view.el = el; if (chat) { view.screen = 'chat'; view.chat = chat; }
    if (!loadKey()) view.screen = 'welcome'; else start(); repaint(); }
  function close() { view.open = false; view.el = null; }
  function repaint() { if (!view.open || !view.el) return;
    const keep = view.el.querySelector('textarea')?.value, scr = view.screen;
    ({ welcome: drawWelcome, list: drawList, chat: drawChat, add: drawAdd, me: drawMe }[scr] || drawList)();
    if (keep != null && scr === 'chat') { const t = view.el.querySelector('textarea'); if (t && !t.value) t.value = keep; }
    paintStatus(); }
  const head = (title, sub, left, right) => `<div class=hm-h>${left || ''}<div style="flex:1;min-width:0"><h2>${title}</h2>${sub || ''}</div>${right || ''}</div>`;
  function wireCommon() { view.el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { view.screen = b.dataset.go; repaint(); });
    view.el.querySelectorAll('[data-close]').forEach(b => b.onclick = () => A.close && A.close()); }

  function drawWelcome() {
    view.el.innerHTML = `<div class=hm>${head('Messages', '', '', A.close ? `<button class=hm-ib data-close aria-label=Close>${I.x}</button>` : '')}<div class=hm-body>
      <div class=hm-card style="text-align:center"><div style="font-size:42px">💬</div><h3 style="font-size:19px">Private messages, built into Hush</h3>
      <p>Chat with other Hush users. Messages are end-to-end encrypted and always sent through <b>Tor</b>, so no server ever sees what you say, who you are, or where you are. No phone number, no email, no account.</p>
      <input class=hm-in id=hm-name placeholder="Your name (what friends see)" maxlength=40 style="text-align:center">
      <button class=hm-btn id=hm-go>Start messaging</button></div>
      <div class=hm-card><h3>How it stays private</h3><p>🔒 Only you and the person you’re talking to can read messages.</p><p>🧅 Every connection goes through Tor — your IP address is never shown to anyone.</p><p>✉️ Each message is sealed in an outer envelope from a throwaway key, so relays can’t tell who sent it.</p><p style="margin:0">📱 Your contacts and chats stay on this device.</p></div></div></div>`;
    wireCommon();
    view.el.querySelector('#hm-go').onclick = () => { createKey(); const n = view.el.querySelector('#hm-name').value.trim(); LS.set('profile', { name: n.slice(0, 40) });
      view.screen = 'list'; start(); repaint(); A.toast('You’re set up — share your Hush ID to start chatting'); };
  }
  function drawList() {
    const all = chats(), c = contacts(), un = LS.get('unread', {}), q = view.q.toLowerCase();
    const peers = [...new Set([...Object.keys(all), ...Object.keys(c)])].filter(pk => !c[pk]?.blocked)
      .map(pk => ({ pk, last: (all[pk] || []).at(-1) })).sort((a, b) => (b.last?.at || c[b.pk]?.added || 0) - (a.last?.at || c[a.pk]?.added || 0))
      .filter(x => !q || nameOf(x.pk).toLowerCase().includes(q) || (x.last?.text || '').toLowerCase().includes(q));
    view.el.innerHTML = `<div class=hm style="position:relative">${head('Messages', '<div class=hm-st></div>', '',
      `<button class=hm-ib data-go=me title="Your Hush ID" aria-label="Your Hush ID">${I.qr}</button>${A.close ? `<button class=hm-ib data-close aria-label=Close>${I.x}</button>` : ''}`)}
      <div class=hm-body><input class=hm-search placeholder="Search chats" value="${esc(view.q)}">
      ${peers.map(({ pk, last }) => `<button class=hm-row data-chat=${pk}>${avatar(pk)}<div class=t><b>${esc(nameOf(pk))}</b><span>${last ? (last.from === 'me' ? 'You: ' : '') + esc(last.text.slice(0, 80)) : c[pk]?.request ? 'Wants to chat' : 'Say hi 👋'}</span></div>
        <em>${last ? short(last.at) : ''}${un[pk] ? `<br><span class=u>${un[pk]}</span>` : ''}</em></button>`).join('') ||
        `<div class=hm-empty><b>No chats yet</b>Tap <b>+</b> to add someone with their Hush ID, or show them yours with the QR button.</div>`}</div>
      <button class=hm-fab data-go=add aria-label="New chat">${I.plus}</button></div>`;
    wireCommon();
    const s = view.el.querySelector('.hm-search'); s.oninput = () => { view.q = s.value; const p = s.selectionStart; repaint(); const n = view.el.querySelector('.hm-search'); n.focus(); n.setSelectionRange(p, p); };
    view.el.querySelectorAll('[data-chat]').forEach(b => { b.onclick = () => openChat(b.dataset.chat);
      b.oncontextmenu = e => { e.preventDefault(); chatMenu(e.clientX, e.clientY, b.dataset.chat); };
      let t; b.addEventListener('touchstart', e => { const p = e.touches[0]; t = setTimeout(() => chatMenu(p.clientX, p.clientY, b.dataset.chat), 550); }, { passive: true });
      b.addEventListener('touchend', () => clearTimeout(t)); b.addEventListener('touchmove', () => clearTimeout(t), { passive: true }); });
  }
  function openChat(pk) { view.screen = 'chat'; view.chat = pk; view.reply = null; const un = LS.get('unread', {}); delete un[pk]; LS.set('unread', un); badge(); repaint(); }
  function drawChat() {
    const pk = view.chat, list = (chats()[pk] || []), c = contacts()[pk] || {};
    let lastDay = '', html = '';
    for (const m of list) { const d = day(m.at); if (d !== lastDay) { html += `<div class=hm-day>${d}</div>`; lastDay = d; }
      const q = m.reply && list.find(x => x.id === m.reply);
      const rx = m.react && Object.entries(m.react).filter(([, w]) => w.length).map(([e, w]) => e + (w.length > 1 ? w.length : '')).join(' ');
      const url = (m.text.match(/https?:\/\/\S+/) || [])[0];
      html += `<div class="hm-m ${m.from} ${rx ? 'hasrx' : ''} ${m.status === 'failed' ? 'failed' : ''}" data-m="${m.id}">${q ? `<span class=q>${esc(q.text.slice(0, 80))}</span>` : ''}${linkify(m.text)}${url && m.text.trim() === url.trim() ? `<a href=# class=hm-link data-u="${esc(url)}">🔗 ${esc((() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })())}</a>` : ''}<span class=tm>${time(m.at)}${m.from === 'me' ? ' ' + ({ sent: '✓', sending: '…', queued: '◷', failed: '⚠ tap to retry' }[m.status] || '') : ''}</span>${rx ? `<span class=rx>${rx}</span>` : ''}</div>`; }
    view.el.innerHTML = `<div class=hm>${head(esc(nameOf(pk)), '<div class=hm-st></div>', `<button class=hm-ib data-go=list aria-label=Back>${I.back}</button>${avatar(pk, 36)}`,
      `<button class=hm-ib id=hm-cm aria-label="Chat options">⋯</button>`)}
      <div class=hm-body id=hm-scroll>${c.request ? `<div class=hm-req><b>${esc(nameOf(pk))}</b> isn’t in your contacts yet. Only reply if you know them.<div style="margin-top:8px;display:flex;gap:8px"><button class="hm-btn" id=hm-acc>Accept</button><button class="hm-btn ghost" id=hm-blk>Block</button></div></div>` : ''}
      <div class=hm-msgs>${html || `<div class=hm-empty style="padding:30px"><b>Start the conversation</b>Messages are end-to-end encrypted and sent through Tor.</div>`}</div></div>
      ${view.reply ? `<div class=hm-rep>↩ <span>${esc((list.find(x => x.id === view.reply) || {}).text || '')}</span><button class=hm-ib id=hm-rx aria-label="Cancel reply">${I.x}</button></div>` : ''}
      <div class=hm-c>${A.page && A.page() ? `<button class=hm-ib id=hm-share title="Share the page you’re on" aria-label="Share page">${I.link}</button>` : ''}
      <textarea rows=1 placeholder="Message" aria-label="Message"></textarea><button class=hm-send aria-label=Send>${I.send}</button></div></div>`;
    wireCommon();
    const sc = view.el.querySelector('#hm-scroll'); sc.scrollTop = sc.scrollHeight;
    const ta = view.el.querySelector('textarea'), go = () => { const v = ta.value; if (!v.trim()) return; ta.value = ''; const r = view.reply; view.reply = null; sendText(pk, v, r); };
    ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; };
    ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !A.mobile) { e.preventDefault(); go(); } };
    view.el.querySelector('.hm-send').onclick = go; if (!A.mobile) setTimeout(() => ta.focus(), 30);
    const sh = view.el.querySelector('#hm-share'); if (sh) sh.onclick = () => { const p = A.page(); if (p) { ta.value = (ta.value ? ta.value + ' ' : '') + p.url; ta.oninput(); ta.focus(); } };
    const rxb = view.el.querySelector('#hm-rx'); if (rxb) rxb.onclick = () => { view.reply = null; repaint(); };
    const acc = view.el.querySelector('#hm-acc'); if (acc) acc.onclick = () => { const all = contacts(); delete all[pk].request; LS.set('contacts', all); repaint(); };
    const blk = view.el.querySelector('#hm-blk'); if (blk) blk.onclick = () => { const all = contacts(); all[pk] = { ...all[pk], blocked: true }; LS.set('contacts', all); view.screen = 'list'; repaint(); A.toast('Blocked'); };
    view.el.querySelector('#hm-cm').onclick = e => chatMenu(e.clientX, e.clientY, pk);
    view.el.querySelectorAll('[data-u]').forEach(a => a.onclick = e => { e.preventDefault(); e.stopPropagation(); A.open(a.dataset.u); });
    view.el.querySelectorAll('[data-m]').forEach(b => { const m = list.find(x => x.id === b.dataset.m);
      b.onclick = e => { if (m.status === 'failed') resend(pk, m); };
      b.ondblclick = () => react(pk, m, '❤️');
      b.oncontextmenu = e => { e.preventDefault(); msgMenu(e.clientX, e.clientY, pk, m); };
      let t, sx; b.addEventListener('touchstart', e => { const p = e.touches[0]; sx = p.clientX; t = setTimeout(() => msgMenu(p.clientX, p.clientY, pk, m), 480); }, { passive: true });
      b.addEventListener('touchmove', e => { clearTimeout(t); const dx = e.touches[0].clientX - sx; if (dx > 0) b.style.transform = `translateX(${Math.min(dx, 70)}px)`; }, { passive: true });
      b.addEventListener('touchend', e => { clearTimeout(t); const dx = (e.changedTouches[0]?.clientX || sx) - sx; b.style.transform = ''; if (dx > 60) { view.reply = m.id; repaint(); } });   // swipe right = reply
    });
  }
  function menu(x, y, html, wire) { document.querySelector('.hm-menu')?.remove(); const m = document.createElement('div'); m.className = 'hm-menu'; m.innerHTML = html;
    document.body.append(m); const r = m.getBoundingClientRect(); m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px'; m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
    const off = e => { if (!m.contains(e.target)) { m.remove(); removeEventListener('pointerdown', off, true); } }; setTimeout(() => addEventListener('pointerdown', off, true), 0);
    wire(m, () => { m.remove(); removeEventListener('pointerdown', off, true); }); }
  function msgMenu(x, y, pk, m) {
    menu(x, y, `<div class=e>${REACT.map(e => `<button data-e="${e}">${e}</button>`).join('')}</div><button class=i data-a=reply>↩ Reply</button><button class=i data-a=copy>Copy text</button>${m.status === 'failed' ? '<button class=i data-a=retry>Retry</button>' : ''}<button class=i data-a=del>Delete for me</button>`,
      (el, done) => { el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { done(); react(pk, m, b.dataset.e); });
        el.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => { done(); const a = b.dataset.a;
          if (a === 'reply') { view.reply = m.id; repaint(); view.el.querySelector('textarea')?.focus(); }
          else if (a === 'copy') { try { await navigator.clipboard.writeText(m.text); A.toast('Copied'); } catch {} }
          else if (a === 'retry') resend(pk, m);
          else if (a === 'del') { const all = chats(); all[pk] = (all[pk] || []).filter(z => z.id !== m.id); LS.set('chats', all); repaint(); } }); });
  }
  function chatMenu(x, y, pk) {
    menu(x, y, `<button class=i data-a=rename>Rename</button><button class=i data-a=id>Show their Hush ID</button><button class=i data-a=clear>Clear chat</button><button class=i data-a=block>Block</button><button class=i data-a=del>Delete chat & contact</button>`,
      (el, done) => el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { done(); const a = b.dataset.a, c = contacts();
        if (a === 'rename') { const n = prompt('Name for this contact', nameOf(pk)); if (n && n.trim()) { c[pk] = { ...(c[pk] || {}), name: n.trim().slice(0, 40), named: true }; LS.set('contacts', c); repaint(); } }
        else if (a === 'id') { prompt('Their Hush ID', npub(pk)); }
        else if (a === 'clear') { if (confirm('Clear all messages with ' + nameOf(pk) + ' on this device?')) { const all = chats(); delete all[pk]; LS.set('chats', all); repaint(); } }
        else if (a === 'block') { c[pk] = { ...(c[pk] || {}), blocked: true }; LS.set('contacts', c); view.screen = 'list'; repaint(); A.toast('Blocked — you won’t see their messages'); }
        else if (a === 'del') { if (confirm('Delete this chat and contact?')) { const all = chats(); delete all[pk]; delete c[pk]; LS.set('chats', all); LS.set('contacts', c); view.screen = 'list'; repaint(); } } }));
  }
  function drawAdd() {
    view.el.innerHTML = `<div class=hm>${head('New chat', '', `<button class=hm-ib data-go=list aria-label=Back>${I.back}</button>`)}<div class=hm-body>
      <div class=hm-card><h3>Add someone</h3><p>Paste their Hush ID (it starts with <b>npub</b>). They can find it under the QR button in their Messages.</p>
      <input class=hm-in id=hm-id placeholder="npub1…" autocapitalize=off spellcheck=false><input class=hm-in id=hm-nm placeholder="Name (optional)" maxlength=40>
      <button class=hm-btn id=hm-add>Start chat</button></div>
      <div class=hm-card><h3>Or let them add you</h3><p>Show your code — they can scan it with their phone camera.</p><button class="hm-btn ghost" data-go=me>Show my Hush ID</button></div></div></div>`;
    wireCommon();
    view.el.querySelector('#hm-add').onclick = () => { const pk = parseId(view.el.querySelector('#hm-id').value); if (!pk) return A.toast('That isn’t a Hush ID — it should start with npub1');
      if (pk === me) return A.toast('That’s your own ID'); addContact(pk, view.el.querySelector('#hm-nm').value.trim()); openChat(pk); };
  }
  function addContact(pk, name) { const c = contacts(); c[pk] = { ...(c[pk] || {}), added: c[pk]?.added || Date.now(), ...(name ? { name: name.slice(0, 40), named: true } : {}) }; delete c[pk].request; delete c[pk].blocked; LS.set('contacts', c); }
  function drawMe() {
    const id = npub(me), link = 'hush://add#' + id;
    view.el.innerHTML = `<div class=hm>${head('Your Hush ID', '', `<button class=hm-ib data-go=list aria-label=Back>${I.back}</button>`)}<div class=hm-body>
      <div class=hm-card style="text-align:center"><div class=hm-qr>${A.qr ? A.qr(link) : ''}</div><p>Friends scan this with their phone camera, or paste your ID into New chat.</p>
      <div class=hm-id>${esc(id)}</div><div style="margin-top:10px;display:flex;gap:8px;justify-content:center"><button class=hm-btn id=hm-copy>Copy ID</button>${navigator.share ? '<button class="hm-btn ghost" id=hm-sh>Share</button>' : ''}</div></div>
      <div class=hm-card><h3>Your name</h3><p>Sent with your messages so friends see who you are.</p><input class=hm-in id=hm-name value="${esc(profile().name)}" maxlength=40><button class="hm-btn ghost" id=hm-save>Save</button></div>
      <div class=hm-card><h3>Privacy</h3><p><span class=hm-tor>🧅 Tor only</span> Every connection goes through Tor. Messages are end-to-end encrypted (NIP-44), sealed and gift-wrapped (NIP-59), and relayed by ${relays().length} independent relays.</p>
      <p style="margin:0">Your secret key never leaves this device. If you uninstall Hush or clear its data, this ID and your chats are gone — there’s no account to recover.</p></div>
      <div class=hm-card><h3>Start over</h3><p>Deletes your ID, contacts and every message on this device.</p><button class="hm-btn ghost" id=hm-reset style="color:#ef4444">Delete everything</button></div></div></div>`;
    wireCommon();
    view.el.querySelector('#hm-copy').onclick = async () => { try { await navigator.clipboard.writeText(id); A.toast('Hush ID copied'); } catch { prompt('Your Hush ID', id); } };
    const sh = view.el.querySelector('#hm-sh'); if (sh) sh.onclick = () => navigator.share({ text: 'Message me privately on Hush: ' + id }).catch(() => {});
    view.el.querySelector('#hm-save').onclick = () => { LS.set('profile', { name: view.el.querySelector('#hm-name').value.trim().slice(0, 40) }); A.toast('Saved'); };
    view.el.querySelector('#hm-reset').onclick = () => { if (!confirm('Delete your Hush ID and all messages on this device? This can’t be undone.')) return;
      for (const k of ['key', 'contacts', 'chats', 'unread', 'seen', 'since', 'profile']) localStorage.removeItem('hush.msg.' + k);
      Object.values(conns).forEach(c => c.id && A.inv('msg_ws_close', { id: c.id }).catch(() => {})); sk = null; me = ''; started = false; view.screen = 'welcome'; badge(); repaint(); };
  }
  // Background: once set up, stay connected (through Tor) so messages arrive while you browse.
  function boot() { if (!N) return; if (loadKey()) { start(); badge(); } }
  return { open, close, boot, unread: unreadTotal, addFromLink: s => { const pk = parseId(s); if (!pk || !loadKey()) return false; addContact(pk); return pk; }, ready: () => !!N };
};
