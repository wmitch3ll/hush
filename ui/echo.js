// Echo — a private-first social feed for Hush users, on top of Murmur's identity and Tor connections.
// • Friends-only posts (default): sealed and gift-wrapped to each friend, exactly like private messages — relays see nothing.
// • Public posts (only after you turn on "Public profile"): signed Hush-only events (kind 1414) that other Nostr apps ignore,
//   findable by username or words you used. Likes 1416, reposts 1417, profile 31414 (d=echo).
// • Your own posts are kept on this device and quietly re-sent if relays drop them (keep-alive). Optional disappearing posts.
// A = { M: HushMsg api, toast, mobile, open(url), close(), openMurmur(pk?), badge(n) }
window.HushEcho = function (A) {
  const M = A.M, N = window.NostrTools;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = { get(k, d) { try { const v = localStorage.getItem('hush.echo.' + k); return v == null ? d : JSON.parse(v) } catch { return d } },
               set(k, v) { try { localStorage.setItem('hush.echo.' + k, JSON.stringify(v)) } catch { A.toast('Storage is full'); } } };
  const K_POST = 1414, K_LIKE = 1416, K_REPOST = 1417, K_PROFILE = 31414, now = () => Math.floor(Date.now() / 1000);
  const me = () => M.me();
  const prof = () => LS.get('me', null);
  const profiles = () => LS.get('profiles', {});
  const follows = () => LS.get('follow', []);
  const tagOf = pk => (M.npub(pk).slice(5, 9));
  const nameOf = pk => pk === me() ? (prof()?.name || 'You') : (profiles()[pk]?.name || (M.contacts()[pk]?.name) || 'Hush user');
  const isFriend = pk => M.friends().includes(pk);
  const expired = p => p.exp && p.exp * 1000 < Date.now();
  const words = t => [...new Set(String(t).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}#@ ]+/gu, ' ').split(/\s+/).map(w => w.replace(/^#/, '')).filter(w => w.length >= 3 && w.length <= 30))].slice(0, 40);

  // ---------------------------------------------------------------- store
  const posts = () => LS.get('posts', {});          // every post we know: id -> post
  function savePost(p) { const all = posts(); const old = all[p.id];
    all[p.id] = { ...(old || {}), ...p, likes: [...new Set([...(old?.likes || []), ...(p.likes || [])])] };
    const ids = Object.keys(all); if (ids.length > 2500) { ids.sort((a, b) => all[a].at - all[b].at).slice(0, ids.length - 2500).forEach(i => { if (all[i].pk !== me()) delete all[i]; }); }
    LS.set('posts', all); return all[p.id]; }
  function fromEvent(e, aud) {      // signed public event or unwrapped rumor -> post
    const t = n => (e.tags.find(x => x[0] === n) || [])[1];
    let img = null; try { const j = t('hush-img'); if (j) img = JSON.parse(j); } catch {}
    const exp = +t('expiration') || 0, re = e.tags.find(x => x[0] === 'e' && x[3] === 'reply');
    return { id: e.id, pk: e.pubkey, text: String(e.content || '').slice(0, 2000), at: e.created_at * 1000, aud, img, exp, reply: re ? re[1] : null, replyTo: re ? (e.tags.find(x => x[0] === 'p' && x[1] !== e.pubkey) || [])[1] : null, ev: aud === 'public' ? e : undefined };
  }
  function notify(n) { if (n.from === me()) return; const l = LS.get('notif', []); if (l.some(x => x.k === n.k)) return; l.unshift({ ...n, at: Date.now(), unread: true }); LS.set('notif', l.slice(0, 200)); badge(); if (view.open) paint(); }
  const unread = () => LS.get('notif', []).filter(n => n.unread).length;
  const badge = () => A.badge && A.badge(unread());

  // ---------------------------------------------------------------- receiving
  function onPrivate(r) {     // from Murmur: unwrapped rumor (already checked the wrap/seal)
    if (r.kind === K_PROFILE) { if (r.pubkey === me()) return; try { const j = JSON.parse(r.content); setProfile(r.pubkey, { name: String(j.name || '').slice(0, 40), bio: String(j.bio || '').slice(0, 300), public: !!j.public, echo: true, at: r.created_at }); } catch {} return; }
    if (r.kind === K_POST) {
      const del = (r.tags.find(x => x[0] === 'delete') || [])[1];
      if (del) { const all = posts(); if (all[del]?.pk === r.pubkey) { delete all[del]; LS.set('posts', all); if (view.open) paint(); } return; }
      if (r.pubkey !== me() && !isFriend(r.pubkey) && !(r.tags.some(x => x[0] === 'p' && x[1] === me()))) return;   // only friends (or replies to me)
      const p = savePost(fromEvent(r, 'friends'));
      if (p.replyTo === me()) notify({ k: 'r' + p.id, type: 'reply', from: p.pk, post: p.reply, reply: p.id });
      setProfile(r.pubkey, { echo: true });
      if (view.open) paint(); return; }
    if (r.kind === K_LIKE) { const target = (r.tags.find(x => x[0] === 'e') || [])[1]; const all = posts(); const p = all[target]; if (!p) return;
      const un = r.content === '-'; p.likes = (p.likes || []).filter(x => x !== r.pubkey); if (!un) p.likes.push(r.pubkey); LS.set('posts', all);
      if (!un && p.pk === me()) notify({ k: 'l' + target + r.pubkey, type: 'like', from: r.pubkey, post: target }); if (view.open) paint(); }
  }
  function onPublic(e) {
    if (M.contacts()[e.pubkey]?.blocked) return;
    if (e.kind === K_PROFILE) { try { const j = JSON.parse(e.content); if (j.hidden) { setProfile(e.pubkey, { public: false }); return; }
      setProfile(e.pubkey, { name: String(j.name || '').slice(0, 40), bio: String(j.bio || '').slice(0, 300), public: true, echo: true, at: e.created_at }); } catch {} return; }
    if (e.kind === 5) { const all = posts(); for (const t of e.tags) if (t[0] === 'e' && all[t[1]]?.pk === e.pubkey) delete all[t[1]]; LS.set('posts', all); if (view.open) paint(); return; }
    if (e.kind === K_POST) { const p = savePost(fromEvent(e, 'public')); if (p.replyTo === me()) notify({ k: 'r' + p.id, type: 'reply', from: p.pk, post: p.reply, reply: p.id }); if (view.open) paint(); return; }
    if (e.kind === K_LIKE) { const target = (e.tags.find(x => x[0] === 'e') || [])[1]; const all = posts(); const p = all[target]; if (!p) { (pendLikes[target] = pendLikes[target] || new Set()).add(e.pubkey); return; }
      if (!(p.likes || []).includes(e.pubkey)) { p.likes = [...(p.likes || []), e.pubkey]; LS.set('posts', all); } if (p.pk === me()) notify({ k: 'l' + target + e.pubkey, type: 'like', from: e.pubkey, post: target }); if (view.open) paint(); return; }
    if (e.kind === K_REPOST) { try { const orig = JSON.parse(e.content); if (orig && orig.kind === K_POST && N.verifyEvent(orig)) { savePost({ ...fromEvent(orig, 'public'), boostedBy: e.pubkey, boostAt: e.created_at * 1000 });
      if (orig.pubkey === me()) notify({ k: 'b' + e.id, type: 'repost', from: e.pubkey, post: orig.id }); if (view.open) paint(); } } catch {} }
  }
  const pendLikes = {};
  function setProfile(pk, p) { const all = profiles(); all[pk] = { ...(all[pk] || {}), ...p }; LS.set('profiles', all); }

  // ---------------------------------------------------------------- subscriptions (public side, through Tor)
  let subbed = false;
  function subscribe() {
    const authors = [...new Set([...follows(), ...M.friends().filter(pk => profiles()[pk]?.public)])];
    const f = [{ kinds: [K_POST, 5], '#p': [me()], limit: 200 }, { kinds: [K_LIKE, K_REPOST], '#p': [me()], limit: 300 }];
    if (authors.length) f.push({ kinds: [K_POST, K_REPOST, 5], authors, limit: 400 }, { kinds: [K_PROFILE], authors, '#d': ['echo'] });
    if (prof()?.public) f.push({ kinds: [K_LIKE], '#p': [me()] });
    if (subbed) M.unreq('echo-home'); subbed = true;
    M.req('echo-home', f, onPublic);
  }
  function explore() { M.unreq('echo-x'); M.req('echo-x', [{ kinds: [K_POST], '#t': ['hush-echo'], limit: 150 }, { kinds: [K_PROFILE], '#d': ['echo'], limit: 200 }], e => { onPublic(e); }, () => { if (view.open) paint(); }); }
  let searchToken = 0;
  function search(q, done) {
    const tok = ++searchToken, ws = words(q).slice(0, 5), out = { people: new Set(), posts: new Set() };
    M.unreq('echo-s'); const f = [{ kinds: [K_PROFILE], '#d': ['echo'], limit: 500 }]; if (ws.length) f.push({ kinds: [K_POST], '#t': ws, limit: 200 });
    M.req('echo-s', f, e => { if (tok !== searchToken) return; onPublic(e); }, () => { if (tok === searchToken) done(); });
    setTimeout(() => tok === searchToken && done(), 9000);
  }

  // ---------------------------------------------------------------- publishing
  function audienceFriends() { return M.friends(); }
  async function post(text, opt = {}) {
    text = String(text || '').trim(); if (!text && !opt.file) return;
    const tags = [];
    if (opt.reply) { tags.push(['e', opt.reply.id, '', 'reply'], ['p', opt.reply.pk]); }
    if (opt.exp) tags.push(['expiration', String(now() + opt.exp)]);
    if (opt.file) { A.toast('Encrypting & uploading photo through Tor…');
      const small = await M.shrink(opt.file, 1600, 0.8).catch(() => opt.file); const meta = await M.uploadEncrypted(small); tags.push(['hush-img', JSON.stringify(meta)]); }
    const pub = opt.aud === 'public';
    if (pub) { for (const w of words(text)) tags.push(['t', w]); tags.push(['t', 'hush-echo']);
      const ev = M.broadcast(M.sign({ kind: K_POST, content: text, tags })); savePost({ ...fromEvent(ev, 'public'), mine: true }); }
    else { const to = [...new Set([...audienceFriends(), ...(opt.reply ? [opt.reply.pk] : [])])];
      const r = M.wrapTo(to, K_POST, text, tags); savePost({ ...fromEvent({ ...r, pubkey: me() }, 'friends'), mine: true, sentTo: to }); }
    paint();
  }
  function like(p) {
    const mine = (p.likes || []).includes(me());
    if (p.aud === 'public') M.broadcast(M.sign({ kind: K_LIKE, content: mine ? '-' : '+', tags: [['e', p.id], ['p', p.pk]] }));
    else M.wrapTo([p.pk], K_LIKE, mine ? '-' : '+', [['e', p.id]]);
    const all = posts(); const x = all[p.id]; x.likes = (x.likes || []).filter(z => z !== me()); if (!mine) x.likes.push(me()); LS.set('posts', all); paint();
  }
  function repost(p) { if (p.aud !== 'public' || !p.ev) return; if (!prof()?.public) return A.toast('Turn on your public profile to repost');
    M.broadcast(M.sign({ kind: K_REPOST, content: JSON.stringify(p.ev), tags: [['e', p.id], ['p', p.pk]] })); A.toast('Reposted'); }
  function remove(p) { if (p.pk !== me()) return;
    if (p.aud === 'public') M.broadcast(M.sign({ kind: 5, content: 'deleted', tags: [['e', p.id]] }));
    else M.wrapTo(p.sentTo || audienceFriends(), K_POST, '', [['delete', p.id]]);
    const all = posts(); delete all[p.id]; LS.set('posts', all); paint(); A.toast('Deleted'); }
  function publishProfile() {
    const p = prof(); if (!p) return;
    M.wrapTo(audienceFriends(), K_PROFILE, JSON.stringify({ name: p.name, bio: p.bio, public: !!p.public }), [['d', 'echo']]);
    if (p.public) M.broadcast(M.sign({ kind: K_PROFILE, content: JSON.stringify({ name: p.name, bio: p.bio }), tags: [['d', 'echo'], ...words(p.name).map(w => ['t', '@' + w])] }));
    else if (p.wasPublic) M.broadcast(M.sign({ kind: K_PROFILE, content: JSON.stringify({ hidden: true }), tags: [['d', 'echo']] }));
    LS.set('shared', audienceFriends());
  }
  // Keep-alive: new friends get your profile and friends-only history; public posts that vanished from relays are re-sent.
  function keepAlive() {
    if (!prof()) return;
    const shared = new Set(LS.get('shared', [])), fresh = audienceFriends().filter(f => !shared.has(f)), mine = Object.values(posts()).filter(p => p.pk === me() && !expired(p));
    if (fresh.length) { const p = prof(); M.wrapTo(fresh, K_PROFILE, JSON.stringify({ name: p.name, bio: p.bio, public: !!p.public }), [['d', 'echo']]);
      mine.filter(p => p.aud === 'friends').sort((a, b) => b.at - a.at).slice(0, 60).forEach(p => M.wrapTo(fresh, K_POST, p.text, [...(p.img ? [['hush-img', JSON.stringify(p.img)]] : []), ...(p.exp ? [['expiration', String(p.exp)]] : [])]));
      LS.set('shared', [...shared, ...fresh]); }
    const last = LS.get('kept', 0); if (Date.now() - last < 20 * 3600e3) return; LS.set('kept', Date.now());
    const pub = mine.filter(p => p.aud === 'public' && p.ev); if (pub.length) { const have = new Set();
      M.req('echo-keep', [{ ids: pub.map(p => p.id).slice(0, 300) }], e => have.add(e.id), () => { M.unreq('echo-keep'); pub.filter(p => !have.has(p.id)).forEach(p => M.broadcast(p.ev)); }); }
    if (prof().public) publishProfile();
  }

  // ---------------------------------------------------------------- UI
  const css = `
.ec-tabs{display:flex;border-bottom:1px solid var(--line);flex:none}.ec-tabs button{flex:1;padding:12px 0;text-align:center;font:600 13.5px system-ui;color:var(--mute);border-bottom:2px solid transparent;position:relative}
.ec-tabs button.on{color:var(--ink);border-color:var(--acc)}.ec-tabs .n{position:absolute;top:6px;margin-left:4px;background:var(--acc);color:var(--bg);border-radius:99px;font:700 10px/16px system-ui;min-width:16px;padding:0 4px}
.ec-post{display:flex;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line);cursor:pointer}.ec-post:hover{background:color-mix(in srgb,var(--card) 60%,transparent)}
.ec-post .b{flex:1;min-width:0}.ec-post .h{display:flex;gap:6px;align-items:baseline;font-size:13px;color:var(--mute);flex-wrap:wrap}.ec-post .h b{color:var(--ink);font-size:14.5px}
.ec-post .t{white-space:pre-wrap;word-wrap:break-word;margin:3px 0 6px;font-size:15px;line-height:1.45;user-select:text}.ec-post .t a{color:var(--acc)}
.ec-img{display:block;max-width:100%;max-height:420px;border-radius:14px;border:1px solid var(--line);margin:4px 0 8px;background:var(--card);min-height:80px;object-fit:cover}
.ec-act{display:flex;gap:28px;color:var(--mute);font-size:13px}.ec-act button{display:inline-flex!important;align-items:center;gap:6px;padding:4px 2px}.ec-act button:hover{color:var(--ink)}.ec-act .on{color:#e11d48}
.ec-aud{font-size:11.5px}.ec-boost{font-size:12px;color:var(--mute);padding:8px 14px 0 68px}.ec-reply{font-size:12.5px;color:var(--mute);margin-top:2px}
.ec-c{padding:14px;display:grid;gap:10px}.ec-c textarea{width:100%;min-height:110px;resize:vertical;border-radius:14px;border:1px solid var(--line);background:var(--card);color:var(--ink);padding:12px;font:15px/1.45 system-ui}
.ec-seg{display:flex;gap:6px;flex-wrap:wrap}.ec-seg button{padding:7px 12px;border-radius:99px;border:1px solid var(--line);font:600 12.5px system-ui}.ec-seg button.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.ec-prof{padding:18px 14px;border-bottom:1px solid var(--line);text-align:center}.ec-prof h2{margin:8px 0 2px;font:700 20px system-ui}.ec-prof p{color:var(--mute);margin:4px 0}
.ec-person{display:flex!important;gap:12px;align-items:center;padding:10px 14px;width:100%}.ec-person:hover{background:var(--card)}
.ec-note{display:flex;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line);font-size:14px;cursor:pointer}.ec-note.unread{background:color-mix(in srgb,var(--acc) 7%,transparent)}
.ec-fab{position:absolute;right:18px;bottom:18px;width:56px;height:56px;border-radius:18px;background:var(--acc);color:var(--bg);display:grid!important;place-items:center;box-shadow:0 8px 24px #0003;font-size:24px;z-index:3}
.ec-pill{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:99px;font:600 11px system-ui;background:var(--card);border:1px solid var(--line)}`;
  if (!document.getElementById('ec-css')) { const s = document.createElement('style'); s.id = 'ec-css'; s.textContent = css; document.head.append(s); }
  const view = { open: false, el: null, tab: 'home', screen: null, q: '', results: null };
  const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : s < 7 * 86400 ? Math.floor(s / 86400) + 'd' : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  const left = e => { const s = e - now(); return s > 86400 ? Math.ceil(s / 86400) + 'd' : s > 3600 ? Math.ceil(s / 3600) + 'h' : Math.max(1, Math.ceil(s / 60)) + 'm'; };
  const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)"'\]]/g, u => `<a href="#" data-u="${u}">${u.length > 50 ? u.slice(0, 47) + '…' : u}</a>`).replace(/(^|\s)#(\w{2,30})/g, '$1<a href="#" data-tag="$2">#$2</a>');
  const av = (pk, sz = 44) => `<div class=hm-av style="background:${M.colorOf(pk)};width:${sz}px;height:${sz}px;font-size:${Math.round(sz / 2.9)}px">${esc(M.initials(nameOf(pk)))}</div>`;
  const head = (title, right = '', left = '') => `<div class=hm-h>${left}<div style="flex:1;min-width:0"><h2>${title}</h2><div class=hm-st></div></div>${right}</div>`;
  const backB = `<button class=hm-ib data-back aria-label=Back><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>`;
  const closeB = () => A.close ? `<button class=hm-ib data-close aria-label=Close><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : '';
  function card(p) {
    const liked = (p.likes || []).includes(me()), likes = (p.likes || []).length, replies = Object.values(posts()).filter(x => x.reply === p.id && !expired(x)).length;
    return `${p.boostedBy ? `<div class=ec-boost>↻ ${esc(nameOf(p.boostedBy))} reposted</div>` : ''}<div class=ec-post data-p="${p.id}">${av(p.pk)}<div class=b>
      <div class=h><b data-pk="${p.pk}">${esc(nameOf(p.pk))}</b><span>· ${tagOf(p.pk)}</span><span>· ${ago(p.at)}</span><span class=ec-aud title="${p.aud === 'public' ? 'Public' : 'Friends only — encrypted'}">${p.aud === 'public' ? '🌐' : '🔒'}</span>${p.exp ? `<span title="Disappears">⏲ ${left(p.exp)}</span>` : ''}</div>
      ${p.replyTo ? `<div class=ec-reply>Replying to ${esc(nameOf(p.replyTo))}</div>` : ''}
      ${p.text ? `<div class=t>${linkify(p.text)}</div>` : ''}${p.img ? `<img class=ec-img data-img='${esc(JSON.stringify(p.img))}' alt="Photo">` : ''}
      <div class=ec-act><button data-a=reply aria-label=Reply>💬 ${replies || ''}</button>${p.aud === 'public' ? `<button data-a=repost aria-label=Repost>↻</button>` : ''}<button data-a=like class="${liked ? 'on' : ''}" aria-label=Like>${liked ? '♥' : '♡'} ${likes || ''}</button><button data-a=more aria-label=More>⋯</button></div></div></div>`;
  }
  function feed() {
    const fr = new Set(M.friends()), fo = new Set(follows()), all = Object.values(posts());
    return all.filter(p => !expired(p) && !p.reply && (p.pk === me() || fr.has(p.pk) || fo.has(p.pk) || (p.boostedBy && (fo.has(p.boostedBy) || fr.has(p.boostedBy)))) && !M.contacts()[p.pk]?.blocked)
      .sort((a, b) => (b.boostAt || b.at) - (a.boostAt || a.at)).slice(0, 300);
  }
  async function open(el) { view.open = true; view.el = el; el.innerHTML = '<div class=hm><div class=hm-empty>…</div></div>';
    if (!await M.ready()) { view.screen = 'nomurmur'; return paint(); }
    M.gate(el, () => { if (view.el !== el) return; M.start(); if (!prof()) view.screen = 'setup'; else { subscribe(); keepAlive(); } paint(); }); }
  function close() { view.open = false; view.el = null; M.unreq('echo-x'); M.unreq('echo-s'); }
  function paint() { if (!view.open || !view.el) return;
    const sc = view.el.querySelector('.hm-body')?.scrollTop || 0, ta = view.el.querySelector('textarea')?.value;
    ({ nomurmur: drawNoMurmur, setup: drawSetup, compose: drawCompose, post: drawThread, person: drawPerson, edit: drawSetup }[view.screen] || drawMain)();
    const b = view.el.querySelector('.hm-body'); if (b && !view.jump) b.scrollTop = sc; view.jump = false; const t = view.el.querySelector('textarea'); if (t && ta && !t.value) t.value = ta;
    const st = view.el.querySelector('.hm-st'); if (st) { const s = M.status(); st.className = 'hm-st ' + (s.startsWith('error') ? 'error' : s); st.innerHTML = `<i></i>${s === 'on' ? 'Through Tor · ' + M.okRelays() + ' relays' : s === 'connecting' ? 'Connecting through Tor…' : 'Offline — retrying'}`; }
    wire(); }
  function go(screen, extra = {}) { Object.assign(view, { screen, jump: true }, extra); paint(); }
  function drawNoMurmur() {
    view.el.innerHTML = `<div class=hm>${head('echo.', closeB())}<div class=hm-body><div class=hm-card style="text-align:center"><div style="font-size:40px">📣</div><h3>Set up your Hush ID first</h3>
      <p>Echo uses the same private Hush ID as Murmur, so your friends there are your friends here. It takes ten seconds.</p><button class=hm-btn id=ec-m>Open Murmur</button></div></div></div>`;
    view.el.querySelector('#ec-m').onclick = () => A.openMurmur && A.openMurmur(); }
  function drawSetup() {
    const p = prof() || { name: M.profile().name || '', bio: '', public: false };
    view.el.innerHTML = `<div class=hm>${head(view.screen === 'edit' ? 'Edit profile' : 'echo.', view.screen === 'edit' ? '' : closeB(), view.screen === 'edit' ? backB : '')}<div class=hm-body>
      ${view.screen === 'edit' ? '' : `<div class=hm-card style="text-align:center"><div style="font:300 34px ui-serif,Georgia,serif">echo.</div><p><b>Share with friends. Privately by default.</b></p>
        <p>Posts go only to your Murmur friends, encrypted — nobody else, not even the relays, can read them. You can make your profile public later if you want to be found.</p></div>`}
      <div class=hm-card><h3>Your profile</h3><input class=hm-in id=ec-n maxlength=40 placeholder="Name" value="${esc(p.name)}"><textarea class=hm-in id=ec-b rows=3 maxlength=300 placeholder="Bio (optional)">${esc(p.bio)}</textarea>
        <div class=hm-opt><div><b>Public profile</b><small>${p.public ? 'On — anyone on Echo can find you by name and see your public posts.' : 'Off (recommended to start) — only friends see you. Turn on to be found by anyone who searches your name or topics you post about.'}</small></div><button class="hm-sw ${p.public ? 'on' : ''}" id=ec-pub aria-label="Public profile"></button></div>
        <p style="margin-top:12px;font-size:12px">Even public, everything goes through Tor, so nobody sees your IP or location. Public posts stay public once seen — be thoughtful.</p>
        <button class=hm-btn id=ec-save>${view.screen === 'edit' ? 'Save' : 'Start Echo'}</button></div></div></div>`;
    let pub = !!p.public; view.el.querySelector('#ec-pub').onclick = e => { pub = !pub; e.target.classList.toggle('on', pub);
      if (pub) A.toast('Public: your name and public posts can be found by anyone on Echo'); };
    view.el.querySelector('#ec-save').onclick = () => { const name = view.el.querySelector('#ec-n').value.trim().slice(0, 40); if (!name) return A.toast('Pick a name');
      const old = prof(); LS.set('me', { name, bio: view.el.querySelector('#ec-b').value.trim().slice(0, 300), public: pub, wasPublic: !!(old?.public || old?.wasPublic) });
      publishProfile(); subscribe(); keepAlive(); go(null, { tab: view.screen === 'edit' ? 'me' : 'home' }); A.toast(pub ? '🌐 Your profile is public' : '🔒 Your profile is friends-only'); };
  }
  function tabs() { const n = unread();
    return `<div class=ec-tabs>${[['home', 'Home'], ['explore', 'Explore'], ['search', 'Search'], ['alerts', 'Alerts'], ['me', 'Me']].map(([k, l]) => `<button data-tab=${k} class="${view.tab === k ? 'on' : ''}">${l}${k === 'alerts' && n ? `<span class=n>${n}</span>` : ''}</button>`).join('')}</div>`; }
  function drawMain() {
    let body = '';
    if (view.tab === 'home') { const f = feed(); body = f.map(card).join('') || `<div class=hm-empty><b>Your feed is quiet</b>Posts from your Murmur friends and people you follow show up here. Tap ✎ to post something — it goes to friends only unless you choose Public.</div>`; }
    else if (view.tab === 'explore') { const pub = Object.values(posts()).filter(p => p.aud === 'public' && !expired(p) && !p.reply && !M.contacts()[p.pk]?.blocked).sort((a, b) => b.at - a.at).slice(0, 200);
      body = `<div style="padding:10px 14px;color:var(--mute);font-size:12.5px">Public posts from people on Echo. Friends-only posts never appear here.</div>` + (pub.map(card).join('') || '<div class=hm-empty>Nothing public yet — loading through Tor…</div>'); }
    else if (view.tab === 'search') { body = `<div style="padding:12px 14px"><input class=hm-search style="margin:0;width:100%" id=ec-q placeholder="Search names or topics" value="${esc(view.q)}" enterkeyhint=search></div>` + drawResults(); }
    else if (view.tab === 'alerts') { const l = LS.get('notif', []); body = l.map(n => `<div class="ec-note ${n.unread ? 'unread' : ''}" data-open="${esc(n.reply || n.post)}">${av(n.from, 36)}<div><b>${esc(nameOf(n.from))}</b> ${n.type === 'like' ? 'liked your post' : n.type === 'repost' ? 'reposted you' : 'replied to you'}<div style="color:var(--mute);font-size:12px">${ago(n.at)}</div></div></div>`).join('') || '<div class=hm-empty>Likes and replies on your posts show up here.</div>';
      setTimeout(() => { const l2 = LS.get('notif', []); if (l2.some(x => x.unread)) { l2.forEach(x => x.unread = false); LS.set('notif', l2); badge(); } }, 1500); }
    else { const p = prof(), mine = Object.values(posts()).filter(x => x.pk === me() && !expired(x)).sort((a, b) => b.at - a.at);
      body = `<div class=ec-prof>${av(me(), 72).replace('class=hm-av', 'class=hm-av style="margin:auto"')}<h2>${esc(p.name)}</h2><p>${tagOf(me())} · ${p.public ? '<span class=ec-pill>🌐 Public</span>' : '<span class=ec-pill>🔒 Friends only</span>'}</p>${p.bio ? `<p>${esc(p.bio)}</p>` : ''}
        <p style="font-size:12.5px">${M.friends().length} friends · ${follows().length} following</p><button class="hm-btn ghost" data-edit>Edit profile</button></div>` + (mine.map(card).join('') || '<div class=hm-empty>You haven’t posted yet.</div>'); }
    view.el.innerHTML = `<div class=hm>${head('echo.', closeB())}${tabs()}<div class=hm-body>${body}</div><button class=ec-fab data-compose aria-label="New post">✎</button></div>`;
    const q = view.el.querySelector('#ec-q'); if (q) { q.onkeydown = e => { if (e.key === 'Enter') { view.q = q.value.trim(); if (!view.q) return; view.results = 'loading'; paint(); search(view.q, () => { view.results = 'done'; paint(); }); } }; if (!view.q) setTimeout(() => q.focus(), 50); }
    if (view.tab === 'explore' && !view.explored) { view.explored = true; explore(); }
  }
  function drawResults() {
    if (!view.q) return '<div class=hm-empty><b>Find people and posts</b>Search a name (public profiles only) or words people posted about publicly.</div>';
    const ql = view.q.toLowerCase().replace(/^@/, ''), ws = words(view.q);
    const people = Object.entries(profiles()).filter(([pk, p]) => p.public && (p.name || '').toLowerCase().includes(ql)).slice(0, 30);
    const found = Object.values(posts()).filter(p => p.aud === 'public' && !expired(p) && (ws.some(w => p.text.toLowerCase().includes(w)) || p.text.toLowerCase().includes(ql))).sort((a, b) => b.at - a.at).slice(0, 100);
    return `${people.length ? `<div style="padding:4px 14px;color:var(--mute);font:600 12px system-ui">PEOPLE</div>` + people.map(([pk, p]) => `<button class=ec-person data-pk="${pk}">${av(pk, 40)}<div style="text-align:left"><b>${esc(p.name)}</b> <span style="color:var(--mute)">· ${tagOf(pk)}</span><div style="color:var(--mute);font-size:13px">${esc((p.bio || '').slice(0, 80))}</div></div></button>`).join('') : ''}
      ${found.length ? `<div style="padding:10px 14px 4px;color:var(--mute);font:600 12px system-ui">POSTS</div>` + found.map(card).join('') : ''}
      ${!people.length && !found.length ? `<div class=hm-empty>${view.results === 'loading' ? 'Searching through Tor…' : 'Nothing found. Only public profiles and posts can be searched.'}</div>` : ''}`;
  }
  function drawCompose() {
    const p = prof(), r = view.replyTo && posts()[view.replyTo];
    const canPub = p.public, aud = view.aud || (r ? r.aud : 'friends');
    view.el.innerHTML = `<div class=hm>${head(r ? 'Reply' : 'New post', '', backB)}<div class=hm-body><div class=ec-c>
      ${r ? `<div class=ec-reply>Replying to <b>${esc(nameOf(r.pk))}</b>: “${esc(r.text.slice(0, 80))}”</div>` : ''}
      <textarea id=ec-t maxlength=2000 placeholder="${r ? 'Write your reply' : 'What’s happening?'}"></textarea>
      <div id=ec-ph style="font-size:12.5px;color:var(--mute)"></div>
      ${r ? '' : `<div><div style="font:600 12px system-ui;color:var(--mute);margin-bottom:6px">WHO CAN SEE THIS</div><div class=ec-seg><button data-aud=friends class="${aud === 'friends' ? 'on' : ''}">🔒 Friends only</button><button data-aud=public class="${aud === 'public' ? 'on' : ''}">🌐 Public</button></div>
        <div style="font-size:12px;color:var(--mute);margin-top:6px">${aud === 'public' ? (canPub ? 'Anyone on Echo can see and find this post.' : 'Turn on your public profile first (Me → Edit profile).') : 'Encrypted for your ' + M.friends().length + ' Murmur friends. Nobody else can read it.'}</div></div>`}
      <div><div style="font:600 12px system-ui;color:var(--mute);margin-bottom:6px">DISAPPEARS</div><div class=ec-seg>${[[0, 'Never'], [86400, '24 hours'], [7 * 86400, '7 days'], [30 * 86400, '30 days']].map(([v, l]) => `<button data-exp=${v} class="${(view.exp || 0) === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div style="display:flex;gap:8px;align-items:center"><label class="hm-btn ghost" style="cursor:pointer">📷 Photo<input type=file id=ec-f accept="image/*" hidden></label><span style="flex:1"></span><button class=hm-btn id=ec-go>${r ? 'Reply' : 'Post'}</button></div></div></div></div>`;
    let file = view.file || null; const ph = view.el.querySelector('#ec-ph'); if (file) ph.textContent = '📷 ' + file.name;
    view.el.querySelector('#ec-f').onchange = e => { file = view.file = e.target.files[0] || null; ph.textContent = file ? '📷 ' + file.name : ''; };
    view.el.querySelectorAll('[data-aud]').forEach(b => b.onclick = () => { view.aud = b.dataset.aud; paint(); });
    view.el.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => { view.exp = +b.dataset.exp; paint(); });
    view.el.querySelector('#ec-go').onclick = async () => { const t = view.el.querySelector('#ec-t').value; if (!t.trim() && !file) return A.toast('Write something first');
      if (aud === 'public' && !canPub) return A.toast('Turn on your public profile first');
      if (aud === 'friends' && !M.friends().length && !r) return A.toast('Add friends in Murmur first — friends-only posts go to them');
      const b = view.el.querySelector('#ec-go'); b.disabled = true; b.textContent = 'Posting…';
      try { await post(t, { aud, exp: view.exp || 0, file, reply: r }); view.file = null; view.exp = 0; view.aud = null; go(r ? 'post' : null, r ? { id: r.id } : {}); A.toast(r ? 'Replied' : aud === 'public' ? '🌐 Posted publicly' : '🔒 Posted to friends'); }
      catch (e) { b.disabled = false; b.textContent = 'Post'; A.toast('Couldn’t post: ' + String(e.message || e).slice(0, 100)); } };
    setTimeout(() => view.el.querySelector('#ec-t')?.focus(), 50);
  }
  function drawThread() {
    const all = posts(), p = all[view.id]; if (!p) { view.screen = null; return drawMain(); }
    const parent = p.reply && all[p.reply], replies = Object.values(all).filter(x => x.reply === p.id && !expired(x)).sort((a, b) => a.at - b.at);
    view.el.innerHTML = `<div class=hm>${head('Post', '', backB)}<div class=hm-body>${parent ? card(parent) : ''}${card(p)}${replies.map(card).join('') || '<div class=hm-empty style="padding:20px">No replies yet</div>'}</div>
      <button class=ec-fab data-replyto="${p.id}" aria-label=Reply>💬</button></div>`;
  }
  function drawPerson() {
    const pk = view.pk, pr = profiles()[pk] || {}, friend = isFriend(pk), fo = follows().includes(pk);
    const list = Object.values(posts()).filter(x => x.pk === pk && !expired(x) && !x.reply).sort((a, b) => b.at - a.at);
    view.el.innerHTML = `<div class=hm>${head(esc(nameOf(pk)), '', backB)}<div class=hm-body><div class=ec-prof>${av(pk, 72).replace('class=hm-av', 'class=hm-av style="margin:auto"')}
      <h2>${esc(nameOf(pk))}</h2><p>${tagOf(pk)} · ${friend ? '<span class=ec-pill>Friend</span>' : pr.public ? '<span class=ec-pill>🌐 Public</span>' : ''}</p>${pr.bio ? `<p>${esc(pr.bio)}</p>` : ''}
      <div style="display:flex;gap:8px;justify-content:center;margin-top:8px">${pk !== me() && pr.public && !friend ? `<button class="hm-btn ${fo ? 'ghost' : ''}" id=ec-fo>${fo ? 'Following' : 'Follow'}</button>` : ''}${pk !== me() ? '<button class="hm-btn ghost" id=ec-msg>Message</button>' : ''}</div></div>
      ${list.map(card).join('') || `<div class=hm-empty>${friend || pr.public ? 'No posts yet' : 'This profile is private'}</div>`}</div></div>`;
    const f = view.el.querySelector('#ec-fo'); if (f) f.onclick = () => { const l = follows(); LS.set('follow', fo ? l.filter(x => x !== pk) : [...l, pk]); subscribe(); paint(); A.toast(fo ? 'Unfollowed' : 'Following ' + nameOf(pk)); };
    const m = view.el.querySelector('#ec-msg'); if (m) m.onclick = () => A.openMurmur && A.openMurmur(pk);
  }
  async function loadImg(img) { try { const meta = JSON.parse(img.dataset.img); const u = await M.mediaUrl(meta); if (u) img.src = u; else img.alt = 'Photo unavailable'; } catch {} }
  function more(x, y, p) {
    document.querySelector('.hm-menu')?.remove(); const m = document.createElement('div'); m.className = 'hm-menu';
    m.innerHTML = `${p.pk === me() ? '<button class=i data-a=del>Delete post</button>' : `<button class=i data-a=msg>Message ${esc(nameOf(p.pk))}</button><button class=i data-a=block>Block ${esc(nameOf(p.pk))}</button>`}<button class=i data-a=copy>Copy text</button>`;
    document.body.append(m); const r = m.getBoundingClientRect(); m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px'; m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
    const off = e => { if (!m.contains(e.target)) { m.remove(); removeEventListener('pointerdown', off, true); } }; setTimeout(() => addEventListener('pointerdown', off, true), 0);
    m.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => { m.remove(); const a = b.dataset.a;
      if (a === 'del' && confirm('Delete this post for everyone?')) remove(p);
      if (a === 'msg') A.openMurmur && A.openMurmur(p.pk);
      if (a === 'copy') { try { await navigator.clipboard.writeText(p.text); A.toast('Copied'); } catch {} }
      if (a === 'block' && confirm('Block ' + nameOf(p.pk) + '? You won’t see their posts or messages.')) { const c = M.contacts(); c[p.pk] = { ...(c[p.pk] || {}), blocked: true }; localStorage.setItem('hush.msg.contacts', JSON.stringify(c)); LS.set('follow', follows().filter(z => z !== p.pk)); paint(); } }); }
  function wire() {
    const el = view.el;
    el.querySelectorAll('[data-close]').forEach(b => b.onclick = () => A.close && A.close());
    el.querySelectorAll('[data-back]').forEach(b => b.onclick = () => go(view.screen === 'compose' && view.replyTo ? 'post' : null, view.screen === 'compose' && view.replyTo ? { id: view.replyTo, replyTo: null } : { replyTo: null }));
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => go(null, { tab: b.dataset.tab }));
    el.querySelectorAll('[data-compose]').forEach(b => b.onclick = () => go('compose', { replyTo: null }));
    el.querySelectorAll('[data-replyto]').forEach(b => b.onclick = () => go('compose', { replyTo: b.dataset.replyto }));
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => go('edit'));
    el.querySelectorAll('[data-u]').forEach(a => a.onclick = e => { e.preventDefault(); e.stopPropagation(); A.open(a.dataset.u); });
    el.querySelectorAll('[data-tag]').forEach(a => a.onclick = e => { e.preventDefault(); e.stopPropagation(); view.q = a.dataset.tag; view.results = 'loading'; go(null, { tab: 'search' }); search(view.q, () => { view.results = 'done'; paint(); }); });
    el.querySelectorAll('[data-pk]').forEach(a => a.onclick = e => { e.stopPropagation(); go('person', { pk: a.dataset.pk }); });
    el.querySelectorAll('[data-open]').forEach(a => a.onclick = () => { if (posts()[a.dataset.open]) go('post', { id: a.dataset.open }); });
    el.querySelectorAll('img.ec-img').forEach(loadImg);
    el.querySelectorAll('.ec-post').forEach(c => { const p = posts()[c.dataset.p]; if (!p) return;
      c.onclick = e => { if (e.target.closest('a,button,[data-pk]')) return; go('post', { id: p.id }); };
      c.querySelectorAll('[data-a]').forEach(b => b.onclick = e => { e.stopPropagation(); const a = b.dataset.a;
        if (a === 'like') like(p); else if (a === 'reply') go('compose', { replyTo: p.id }); else if (a === 'repost') repost(p); else if (a === 'more') more(e.clientX, e.clientY, p); }); });
  }
  // Boot (after Murmur): listen for friends' private Echo posts; refresh public subscriptions; backup support.
  M.onEcho(onPrivate);
  M.onReset(() => { for (const k of ['me', 'posts', 'profiles', 'follow', 'notif', 'shared', 'kept']) localStorage.removeItem('hush.echo.' + k); badge(); });
  M.onBackup(async () => ({ echo: { me: prof(), follow: follows(), posts: Object.fromEntries(Object.entries(posts()).filter(([, p]) => p.pk === me())) } }),
    async x => { if (!x.echo) return; if (x.echo.me) LS.set('me', x.echo.me); if (x.echo.follow) LS.set('follow', x.echo.follow); if (x.echo.posts) LS.set('posts', { ...posts(), ...x.echo.posts }); LS.set('shared', []); });
  async function boot() { if (!N || !await M.ready()) return; badge(); if (prof()) setTimeout(() => { subscribe(); keepAlive(); }, 4000); }
  return { open, close, boot, unread };
};
