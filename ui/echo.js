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
  const K_PACK = 31415, K_POST = 1414, K_LIKE = 1416, K_REPOST = 1417, K_VOTE = 1418, K_PROFILE = 31414, now = () => Math.floor(Date.now() / 1000);
  const me = () => M.me();
  const prof = () => LS.get('me', null);
  const profiles = () => LS.get('profiles', {});
  const follows = () => LS.get('follow', []);
  const tagOf = pk => (M.npub(pk).slice(5, 9));
  const nameOf = pk => pk === me() ? (prof()?.name || 'You') : (profiles()[pk]?.name || (M.contacts()[pk]?.name) || 'Hush user');
  const isFriend = pk => M.friends().includes(pk);
  const expired = p => p.exp && p.exp * 1000 < Date.now();
  const normUrl = u => { try { const x = new URL(u); x.hash = ''; for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$|si$)/.test(k)) x.searchParams.delete(k); return x.toString().replace(/\/$/, ''); } catch { return ''; } };
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const circles = () => LS.get('circles', {});
  const saved = () => LS.get('saved', []);
  const isMoment = p => p.moment && !expired(p);
  const words = t => [...new Set(String(t).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}#@ ]+/gu, ' ').split(/\s+/).map(w => w.replace(/^#/, '')).filter(w => w.length >= 3 && w.length <= 30))].slice(0, 40);

  // ---------------------------------------------------------------- store
  const posts = () => LS.get('posts', {});          // every post we know: id -> post
  function savePost(p) { const all = posts(); const old = all[p.id];
    all[p.id] = { ...(old || {}), ...p, likes: [...new Set([...(old?.likes || []), ...(p.likes || [])])], votes: { ...(old?.votes || {}), ...(p.votes || {}) } };
    const ids = Object.keys(all); if (ids.length > 2500) { ids.sort((a, b) => all[a].at - all[b].at).slice(0, ids.length - 2500).forEach(i => { if (all[i].pk !== me()) delete all[i]; }); }
    LS.set('posts', all); return all[p.id]; }
  function fromEvent(e, aud) {      // signed public event or unwrapped rumor -> post
    const t = n => (e.tags.find(x => x[0] === n) || [])[1];
    let img = null; try { const j = t('hush-img'); if (j) img = JSON.parse(j); } catch {}
    const exp = +t('expiration') || 0, re = e.tags.find(x => x[0] === 'e' && x[3] === 'reply');
    let quote = null; try { const q = JSON.parse(t('hush-q') || 'null'); if (q && /^[0-9a-f]{64}$/.test(q.pk || '')) quote = { id: String(q.id || '').slice(0, 64), pk: q.pk, text: String(q.text || '').slice(0, 280), img: !!q.img }; } catch {}
    let poll = null; try { const o = JSON.parse(t('hush-poll') || 'null'); if (Array.isArray(o) && o.length >= 2) poll = o.slice(0, 4).map(x => String(x).slice(0, 60)); } catch {}
    const page = /^https?:\/\//.test(t('hush-page') || '') ? normUrl(t('hush-page')) : '';
    return { id: e.id, pk: e.pubkey, text: String(e.content || '').slice(0, 2000), at: e.created_at * 1000, aud, img, exp, reply: re ? re[1] : null, replyTo: re ? (e.tags.find(x => x[0] === 'p' && x[1] !== e.pubkey) || [])[1] : null, ev: aud === 'public' ? e : undefined,
      moment: !!t('hush-moment'), quote, poll, page: page || null, replies: ['follow', 'none'].includes(t('hush-replies')) ? t('hush-replies') : null, comm: /^[a-z0-9-]{2,30}$/.test(t('hush-comm') || '') ? t('hush-comm') : null };
  }
  function notify(n) { if (n.from === me()) return; const l = LS.get('notif', []); if (l.some(x => x.k === n.k)) return; l.unshift({ ...n, at: Date.now(), unread: true }); LS.set('notif', l.slice(0, 200)); badge(); if (view.open) paint(); }
  const unread = () => LS.get('notif', []).filter(n => n.unread).length;
  const badge = () => A.badge && A.badge(unread());

  // ---------------------------------------------------------------- receiving
  function onPrivate(r) {     // from Murmur: unwrapped rumor (already checked the wrap/seal)
    if (r.kind === K_PROFILE) { if (r.pubkey === me()) return; try { const j = JSON.parse(r.content); setProfile(r.pubkey, { name: String(j.name || '').slice(0, 40), bio: String(j.bio || '').slice(0, 300), public: !!j.public, echo: true, at: r.created_at, pin: /^[0-9a-f]{64}$/.test(j.pin || '') ? j.pin : null }); } catch {} return; }
    if (r.kind === K_POST) {
      const del = (r.tags.find(x => x[0] === 'delete') || [])[1];
      if (del) { const all = posts(); if (all[del]?.pk === r.pubkey) { delete all[del]; LS.set('posts', all); if (view.open) paint(); } return; }
      if (r.pubkey !== me() && !isFriend(r.pubkey) && !(r.tags.some(x => x[0] === 'p' && x[1] === me()))) return;   // only friends (or replies to me)
      const p = savePost(fromEvent(r, 'friends'));
      if (p.replyTo === me()) notify({ k: 'r' + p.id, type: 'reply', from: p.pk, post: p.reply, reply: p.id });
      setProfile(r.pubkey, { echo: true });
      if (view.open) paint(); return; }
    if (r.kind === K_VOTE) return gotVote(r);
    if (r.kind === K_LIKE) { const target = (r.tags.find(x => x[0] === 'e') || [])[1]; const all = posts(); const p = all[target]; if (!p) return;
      const un = r.content === '-'; p.likes = (p.likes || []).filter(x => x !== r.pubkey); if (!un) p.likes.push(r.pubkey); LS.set('posts', all);
      if (!un && p.pk === me()) notify({ k: 'l' + target + r.pubkey, type: 'like', from: r.pubkey, post: target }); if (view.open) paint(); }
  }
  function onPublic(e) {
    if (M.contacts()[e.pubkey]?.blocked) return;
    if (e.kind === K_PROFILE) { try { const j = JSON.parse(e.content); if (j.hidden) { setProfile(e.pubkey, { public: false }); return; }
      const okm = m => m && /^[0-9a-f]{64}$/.test(m.x || '') && /^https:\/\//.test(m.url || '') ? m : null;
      setProfile(e.pubkey, { name: String(j.name || '').slice(0, 40), bio: String(j.bio || '').slice(0, 300), public: true, echo: true, at: e.created_at, avatar: okm(j.avatar), banner: okm(j.banner), pin: /^[0-9a-f]{64}$/.test(j.pin || '') ? j.pin : null }); } catch {} return; }
    if (e.kind === K_PACK) { try { const ppl = e.tags.filter(t => t[0] === 'p' && /^[0-9a-f]{64}$/.test(t[1])).map(t => t[1]).slice(0, 150); const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
      const name = String((e.tags.find(t => t[0] === 'title') || [])[1] || 'Starter pack').slice(0, 60); if (!ppl.length) return; const all = LS.get('packs', {}); all[e.pubkey + ':' + d] = { id: e.pubkey + ':' + d, pk: e.pubkey, name, people: ppl, at: e.created_at }; LS.set('packs', all); } catch {} return; }
    if (e.kind === 5) { const all = posts(); for (const t of e.tags) if (t[0] === 'e' && all[t[1]]?.pk === e.pubkey) delete all[t[1]]; LS.set('posts', all); if (view.open) paint(); return; }
    if (e.kind === K_POST) { const p = savePost(fromEvent(e, 'public')); if (p.replyTo === me()) notify({ k: 'r' + p.id, type: 'reply', from: p.pk, post: p.reply, reply: p.id }); if (view.open) paint(); return; }
    if (e.kind === K_VOTE) return gotVote(e);
    if (e.kind === K_LIKE) { const target = (e.tags.find(x => x[0] === 'e') || [])[1]; const all = posts(); const p = all[target]; if (!p) { (pendLikes[target] = pendLikes[target] || new Set()).add(e.pubkey); return; }
      if (!(p.likes || []).includes(e.pubkey)) { p.likes = [...(p.likes || []), e.pubkey]; LS.set('posts', all); } if (p.pk === me()) notify({ k: 'l' + target + e.pubkey, type: 'like', from: e.pubkey, post: target }); if (view.open) paint(); return; }
    if (e.kind === K_REPOST) { try { const orig = JSON.parse(e.content); if (orig && orig.kind === K_POST && N.verifyEvent(orig)) { savePost({ ...fromEvent(orig, 'public'), boostedBy: e.pubkey, boostAt: e.created_at * 1000 });
      if (orig.pubkey === me()) notify({ k: 'b' + e.id, type: 'repost', from: e.pubkey, post: orig.id }); if (view.open) paint(); } } catch {} }
  }
  const pendLikes = {};
  function gotVote(e) { const target = (e.tags.find(x => x[0] === 'e') || [])[1], all = posts(), p = all[target]; if (!p || !p.poll) return;
    const i = parseInt(e.content, 10); p.votes = p.votes || {}; if (i >= 0 && i < p.poll.length) p.votes[e.pubkey] = i; else delete p.votes[e.pubkey];
    LS.set('posts', all); if (view.open) paint(); }
  function vote(p, i) { const mineV = (p.votes || {})[me()], v = mineV === i ? -1 : i;
    if (p.aud === 'public') M.broadcast(M.sign({ kind: K_VOTE, content: String(v), tags: [['e', p.id], ['p', p.pk]] }));
    else M.wrapTo([p.pk], K_VOTE, String(v), [['e', p.id]]);
    const all = posts(), x = all[p.id]; x.votes = x.votes || {}; if (v < 0) delete x.votes[me()]; else x.votes[me()] = v; LS.set('posts', all); paint(); }
  function setProfile(pk, p) { const all = profiles(); all[pk] = { ...(all[pk] || {}), ...p }; LS.set('profiles', all); }

  // ---------------------------------------------------------------- subscriptions (public side, through Tor)
  let subbed = false;
  function subscribe() {
    const authors = [...new Set([...follows(), ...M.friends().filter(pk => profiles()[pk]?.public)])];
    const f = [{ kinds: [K_POST, 5], '#p': [me()], limit: 200 }, { kinds: [K_LIKE, K_REPOST, K_VOTE], '#p': [me()], limit: 300 }];
    if (authors.length) f.push({ kinds: [K_POST, K_REPOST, 5], authors, limit: 400 }, { kinds: [K_PROFILE], authors, '#d': ['echo'] });
    if (prof()?.public) f.push({ kinds: [K_LIKE], '#p': [me()] });
    if (subbed) M.unreq('echo-home'); subbed = true;
    M.req('echo-home', f, onPublic);
  }
  function explore() { M.unreq('echo-x'); M.req('echo-x', [{ kinds: [K_POST], '#t': ['hush-echo'], limit: 150 }, { kinds: [K_PROFILE], '#d': ['echo'], limit: 200 }, { kinds: [K_PACK], limit: 50 }], e => { onPublic(e); }, () => { if (view.open) paint(); }); }
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
    text = String(text || '').trim(); if (!text && !opt.file && !opt.quote) return;
    const tags = [];
    if (opt.moment) { tags.push(['hush-moment', '1']); opt.exp = 86400; }
    if (opt.page) tags.push(['hush-page', normUrl(opt.page)]);
    if (opt.quote) tags.push(['hush-q', JSON.stringify({ id: opt.quote.id, pk: opt.quote.pk, text: (opt.quote.text || '').slice(0, 280), img: !!opt.quote.img })]);
    if (opt.poll) tags.push(['hush-poll', JSON.stringify(opt.poll)]);
    if (opt.replies) tags.push(['hush-replies', opt.replies]);
    if (opt.comm) { tags.push(['hush-comm', opt.comm]); if (opt.aud === 'public') tags.push(['t', 'c-' + opt.comm]); }
    if (opt.reply) { tags.push(['e', opt.reply.id, '', 'reply'], ['p', opt.reply.pk]); }
    if (opt.exp) tags.push(['expiration', String(now() + opt.exp)]);
    if (opt.file) { A.toast('Encrypting & uploading photo through Tor…');
      const small = await M.shrink(opt.file, 1600, 0.8).catch(() => opt.file); const meta = await M.uploadEncrypted(small); tags.push(['hush-img', JSON.stringify(meta)]); }
    const pub = opt.aud === 'public';
    if (pub) { for (const w of words(text)) tags.push(['t', w]); tags.push(['t', 'hush-echo']);
      const ev = M.broadcast(M.sign({ kind: K_POST, content: text, tags })); savePost({ ...fromEvent(ev, 'public'), mine: true }); }
    else { const ci = String(opt.aud || '').startsWith('c:') ? circles()[opt.aud.slice(2)] : null, fr = new Set(M.friends());
      const to = [...new Set([...(ci ? ci.members.filter(x => fr.has(x)) : audienceFriends()), ...(opt.reply ? [opt.reply.pk] : [])])];
      const r = M.wrapTo(to, K_POST, text, tags); savePost({ ...fromEvent({ ...r, pubkey: me() }, 'friends'), mine: true, sentTo: to, circle: ci ? ci.name : null }); }
    paint();
  }
  function like(p) { A.haptic && A.haptic();
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
    M.wrapTo(audienceFriends(), K_PROFILE, JSON.stringify({ name: p.name, bio: p.bio, public: !!p.public, pin: p.pin || null }), [['d', 'echo']]);
    const mp = M.myProfile(); if (p.public) M.broadcast(M.sign({ kind: K_PROFILE, content: JSON.stringify({ name: p.name, bio: p.bio, avatar: mp.avatar || null, banner: mp.banner || null, pin: p.pin && posts()[p.pin]?.aud === 'public' ? p.pin : null }), tags: [['d', 'echo'], ...words(p.name).map(w => ['t', '@' + w])] }));
    else if (p.wasPublic) M.broadcast(M.sign({ kind: K_PROFILE, content: JSON.stringify({ hidden: true }), tags: [['d', 'echo']] }));
    LS.set('shared', audienceFriends());
  }
  // Keep-alive: new friends get your profile and friends-only history; public posts that vanished from relays are re-sent.
  function keepAlive() {
    if (!prof()) return;
    const shared = new Set(LS.get('shared', [])), fresh = audienceFriends().filter(f => !shared.has(f)), mine = Object.values(posts()).filter(p => p.pk === me() && !expired(p));
    if (fresh.length) { const p = prof(); M.wrapTo(fresh, K_PROFILE, JSON.stringify({ name: p.name, bio: p.bio, public: !!p.public }), [['d', 'echo']]);
      mine.filter(p => p.aud === 'friends' && !p.circle).sort((a, b) => b.at - a.at).slice(0, 60).forEach(p => M.wrapTo(fresh, K_POST, p.text, [...(p.img ? [['hush-img', JSON.stringify(p.img)]] : []), ...(p.exp ? [['expiration', String(p.exp)]] : []), ...(p.moment ? [['hush-moment', '1']] : []), ...(p.page ? [['hush-page', p.page]] : []), ...(p.poll ? [['hush-poll', JSON.stringify(p.poll)]] : [])]));
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
.ec-banner{height:130px;overflow:hidden}.ec-act svg,.ec-aud svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;vertical-align:-3px}.ec-act .on svg{fill:currentColor}
.ec-fab svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.ec-aud{color:var(--mute)}
.ec-moments{display:flex;gap:12px;overflow-x:auto;padding:12px 14px;border-bottom:1px solid var(--line);scrollbar-width:none}.ec-moments button{display:grid!important;justify-items:center;gap:4px;font-size:11.5px;color:var(--mute);flex:none;width:64px}
.ec-moments .ring{padding:2px;border-radius:50%;background:conic-gradient(var(--acc),#ec4899,#f97316,var(--acc))}.ec-moments .ring.seen{background:var(--line)}.ec-moments .ring>div{border:2px solid var(--bg)}
.ec-moments span{max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ec-mv{position:absolute;inset:0;background:#000;color:#fff;z-index:9;display:flex;flex-direction:column}.ec-mv .bars{display:flex;gap:3px;padding:10px 10px 0}.ec-mv .bars i{flex:1;height:3px;border-radius:2px;background:#fff4;overflow:hidden}.ec-mv .bars i b{display:block;height:100%;background:#fff;width:0}
.ec-mv .top{display:flex;align-items:center;gap:10px;padding:10px 12px}.ec-mv .mid{flex:1;display:grid;place-items:center;padding:16px;min-height:0}.ec-mv .mid img{max-width:100%;max-height:100%;border-radius:12px;object-fit:contain}
.ec-mv .cap{font:500 19px/1.4 system-ui;text-align:center;padding:0 22px 26px;white-space:pre-wrap;word-wrap:break-word}.ec-mv .mid .big{font:600 24px/1.4 system-ui;text-align:center;white-space:pre-wrap}
.ec-catch{margin:10px 14px;padding:12px 14px;border-radius:14px;background:color-mix(in srgb,var(--acc) 9%,var(--card));border:1px solid var(--line);font-size:14px}.ec-catch b{display:block;margin-bottom:2px}
.ec-q{border:1px solid var(--line);border-radius:12px;padding:8px 10px;margin:2px 0 8px;font-size:13.5px;cursor:pointer}.ec-q b{font-size:13px}
.ec-page{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--acc);margin:0 0 6px;cursor:pointer}
.ec-poll button{display:flex!important;position:relative;width:100%;border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:0 0 6px;overflow:hidden;font-size:14px;text-align:left}.ec-poll button i{position:absolute;inset:0 auto 0 0;background:color-mix(in srgb,var(--acc) 18%,transparent)}.ec-poll button span{position:relative;flex:1}.ec-poll button em{position:relative;font-style:normal;color:var(--mute)}.ec-poll button.on{border-color:var(--acc)}
.ec-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2px}.ec-grid img{width:100%;aspect-ratio:1;object-fit:cover;background:var(--card);cursor:pointer}
.ec-ptabs{display:flex;border-bottom:1px solid var(--line)}.ec-ptabs button{flex:1;padding:10px 0;font:600 13px system-ui;color:var(--mute);border-bottom:2px solid transparent}.ec-ptabs button.on{color:var(--ink);border-color:var(--acc)}
.ec-pinl{font-size:12px;color:var(--mute);padding:8px 14px 0 68px}.ec-chk{display:flex;gap:8px;align-items:center;font-size:13.5px}
.ec-pill{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:99px;font:600 11px system-ui;background:var(--card);border:1px solid var(--line)}`;
  if (!document.getElementById('ec-css')) { const s = document.createElement('style'); s.id = 'ec-css'; s.textContent = css; document.head.append(s); }
  const view = { open: false, el: null, tab: 'home', screen: null, q: '', results: null };
  const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : s < 7 * 86400 ? Math.floor(s / 86400) + 'd' : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  const left = e => { const s = e - now(); return s > 86400 ? Math.ceil(s / 86400) + 'd' : s > 3600 ? Math.ceil(s / 3600) + 'h' : Math.max(1, Math.ceil(s / 60)) + 'm'; };
  const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)"'\]]/g, u => `<a href="#" data-u="${u}">${u.length > 50 ? u.slice(0, 47) + '…' : u}</a>`).replace(/(^|\s)#(\w{2,30})/g, '$1<a href="#" data-tag="$2">#$2</a>');
  // Avatars: contacts & me via Murmur (encrypted photo + aura); public profiles carry their own public photo.
  const av = (pk, sz = 44) => { if (pk === me() || M.contacts()[pk]) return M.avatarHTML(pk, sz);
    const pr = profiles()[pk] || {}, img = pr.avatar && /^[0-9a-f]{64}$/.test(pr.avatar.x || '') ? `<img data-av='${esc(JSON.stringify(pr.avatar))}' alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;opacity:0;transition:opacity .2s">` : '';
    return `<div class=hm-av style="position:relative;background:${M.colorOf(pk)};width:${sz}px;height:${sz}px;font-size:${Math.round(sz / 2.9)}px">${esc(M.initials(nameOf(pk)))}${img}</div>`; };
  const bannerOf = pk => pk === me() ? M.myProfile().banner : (M.contacts()[pk]?.banner || profiles()[pk]?.banner);
  const banner = pk => { const b = bannerOf(pk); return `<div class=ec-banner style="background:linear-gradient(135deg,${M.colorOf(pk)},var(--card))">${b ? `<img data-av='${esc(JSON.stringify(b))}' alt="" style="width:100%;height:100%;object-fit:cover;opacity:0">` : ''}</div>`; };
  const IC = { reply: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>', repost: '<svg viewBox="0 0 24 24"><path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
    like: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-4.4-9.3-9A5.4 5.4 0 0 1 12 6a5.4 5.4 0 0 1 9.3 6C19 16.6 12 21 12 21z"/></svg>', more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>',
    pen: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg>', lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>', globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>' };
  const head = (title, right = '', left = '') => `<div class=hm-h>${left}<div style="flex:1;min-width:0"><h2>${title}</h2><div class=hm-st></div></div>${right}</div>`;
  const backB = `<button class=hm-ib data-back aria-label=Back><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>`;
  const closeB = () => A.close ? `<button class=hm-ib data-close aria-label=Close><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : '';
  function pollHTML(p) { const v = p.votes || {}, tot = Object.keys(v).length, mineV = v[me()], show = mineV != null || p.pk === me();
    return `<div class=ec-poll>${p.poll.map((o, i) => { const n = Object.values(v).filter(x => x === i).length, pc = tot ? Math.round(100 * n / tot) : 0;
      return `<button data-vote="${i}" class="${mineV === i ? 'on' : ''}">${show ? `<i style="width:${pc}%"></i>` : ''}<span>${esc(o)}</span><em>${show ? pc + '%' : ''}</em></button>`; }).join('')}
      <div style="font-size:12px;color:var(--mute);margin:-2px 0 6px">${tot} vote${tot === 1 ? '' : 's'}${p.aud !== 'public' && p.pk !== me() ? ' you can see · the poster sees them all' : ''}</div></div>`; }
  const canReply = p => !p.replies || p.pk === me() || (p.replies === 'follow' && isFriend(p.pk));
  // Your Algo: private, timed "more / less of" topics (kept only on this device).
  const algo = () => (LS.get('algo', []) || []).filter(a => a.until > Date.now());
  const hits = (p, w) => (' ' + p.text.toLowerCase() + ' ').includes(w);
  function tune(list) { const a = algo(); if (!a.length) return list;
    const less = a.filter(x => x.dir < 0).map(x => x.w), more = a.filter(x => x.dir > 0).map(x => x.w);
    return list.filter(p => !less.some(w => hits(p, w))).map((p, i) => ({ p, s: i - (more.some(w => hits(p, w)) && Date.now() - p.at < 3 * 86400e3 ? 40 : 0) })).sort((x, y) => x.s - y.s).map(x => x.p); }
  // Trending among the people you know: hashtags and repeated words in the last 2 days, counted on this device.
  function trending() { const fr = new Set([...M.friends(), ...follows()]), c = {}, t0 = Date.now() - 2 * 86400e3;
    for (const p of Object.values(posts())) { if (p.at < t0 || !(fr.has(p.pk) || p.aud === 'public') || expired(p)) continue;
      for (const m of (p.text.match(/#\w{2,30}/g) || [])) { const k = m.slice(1).toLowerCase(); (c[k] = c[k] || new Set()).add(p.pk); } }
    return Object.entries(c).map(([k, v]) => [k, v.size]).sort((a, b) => b[1] - a[1]).slice(0, 8); }
  function card(p, opt = {}) {
    const liked = (p.likes || []).includes(me()), likes = (p.likes || []).length, replies = Object.values(posts()).filter(x => x.reply === p.id && !expired(x)).length;
    return `${opt.pinned ? '<div class=ec-pinl>📌 Pinned</div>' : ''}${p.boostedBy ? `<div class=ec-boost>↻ ${esc(nameOf(p.boostedBy))} reposted</div>` : ''}<div class=ec-post data-p="${p.id}">${av(p.pk)}<div class=b>
      <div class=h><b data-pk="${p.pk}">${esc(nameOf(p.pk))}</b><span>· ${tagOf(p.pk)}</span><span>· ${ago(p.at)}</span><span class=ec-aud title="${p.aud === 'public' ? 'Public' : p.circle ? 'Circle: ' + esc(p.circle) + ' — encrypted' : 'Friends only — encrypted'}">${p.aud === 'public' ? IC.globe : IC.lock}${p.circle ? ' ' + esc(p.circle) : ''}</span>${p.exp ? `<span title="Disappears">⏲ ${left(p.exp)}</span>` : ''}</div>
      ${p.replyTo ? `<div class=ec-reply>Replying to ${esc(nameOf(p.replyTo))}</div>` : ''}
      ${p.comm ? `<div class=ec-page data-comm="${esc(p.comm)}">◆ ${esc(p.comm)}</div>` : ''}
      ${p.page ? `<div class=ec-page data-u="${esc(p.page)}">📌 Note on ${esc(hostOf(p.page))}</div>` : ''}
      ${p.text ? `<div class=t>${linkify(p.text)}</div>` : ''}${p.img ? `<img class=ec-img data-img='${esc(JSON.stringify(p.img))}' alt="Photo">` : ''}
      ${p.quote ? `<div class=ec-q data-open="${esc(p.quote.id)}"><b>${esc(nameOf(p.quote.pk))}</b> <span style="color:var(--mute)">· ${tagOf(p.quote.pk)}</span><div>${esc(p.quote.text)}${p.quote.img ? ' 📷' : ''}</div></div>` : ''}
      ${p.poll ? pollHTML(p) : ''}
      <div class=ec-act>${canReply(p) ? `<button data-a=reply aria-label=Reply>${IC.reply}<span>${replies || ''}</span></button>` : `<span title="Replies are limited" style="opacity:.5">${IC.reply}<span>${replies || ''}</span></span>`}${p.aud === 'public' ? `<button data-a=repost aria-label=Repost>${IC.repost}</button>` : ''}<button data-a=like class="${liked ? 'on' : ''}" aria-label=Like>${IC.like}<span>${likes || ''}</span></button><button data-a=more aria-label=More>${IC.more}</button></div></div></div>`;
  }
  function feed() {
    const fr = new Set(M.friends()), fo = new Set(follows()), all = Object.values(posts());
    return all.filter(p => !expired(p) && !p.reply && !p.moment && (p.pk === me() || fr.has(p.pk) || fo.has(p.pk) || (p.boostedBy && (fo.has(p.boostedBy) || fr.has(p.boostedBy)))) && !M.contacts()[p.pk]?.blocked)
      .sort((a, b) => (b.boostAt || b.at) - (a.boostAt || a.at)).slice(0, 300);
  }
  async function open(el) { view.open = true; view.el = el; el.innerHTML = '<div class=hm><div class=hm-empty>…</div></div>';
    if (!await M.ready()) { view.screen = 'nomurmur'; return paint(); }
    M.gate(el, () => { if (view.el !== el) return; M.start(); if (!prof()) view.screen = 'setup'; else { subscribe(); keepAlive(); view.catch = catchUp(); } paint(); }); }
  function close() { view.open = false; view.el = null; M.unreq('echo-x'); M.unreq('echo-s'); }
  function paint() { if (!view.open || !view.el) return;
    if (view.screen === 'moment' && view.el.querySelector('.ec-mv')) return;   // don't restart a moment that's showing
    const sc = view.el.querySelector('.hm-body')?.scrollTop || 0, ta = view.el.querySelector('textarea')?.value;
    ({ nomurmur: drawNoMurmur, setup: drawSetup, compose: drawCompose, post: drawThread, person: drawPerson, edit: drawSetup, circles: drawCircles, moment: drawMoment, page: drawPage }[view.screen] || drawMain)();
    const b = view.el.querySelector('.hm-body'); if (b && !view.jump) b.scrollTop = sc; view.jump = false; const t = view.el.querySelector('textarea'); if (t && ta && !t.value) t.value = ta;
    const st = view.el.querySelector('.hm-st'); if (st) { const s = M.status(); st.className = 'hm-st ' + (s.startsWith('error') ? 'error' : s); st.innerHTML = `<i></i>${s === 'on' ? 'Through Tor · ' + M.okRelays() + ' relays' : s === 'connecting' ? 'Connecting through Tor…' : 'Offline — retrying'}`; }
    wire(); M.hydrate(view.el); }
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
  // ---------- Open web: public posts from Bluesky and Mastodon ----------
  // So Echo has people to follow from day one. Read-only: posts are fetched through Tor (Bluesky and Mastodon never
  // see your IP), shown with where they came from, and "Open" takes you to the original to reply or like there.
  // No pictures are loaded from those servers (that would reveal you); posts with photos say so.
  const OPEN_CATS = {
    // News: outlets generally rated center or center-right by media-bias raters (AllSides / Ad Fontes).
    News: ['bsky:reuters.com', 'bsky:thehill.com', 'bsky:newsweek.com', 'bsky:axios.com', 'bsky:newsnationnow.com', 'bsky:forbes.com', 'bsky:realclearpolitics.com',
      'bsky:thedispatch.com', 'bsky:washingtonexaminer.com', 'bsky:nationalreview.com', 'bsky:reason.com', 'bsky:bbcnews.bsky.social'],
    Sports: ['bsky:theathletic.bsky.social', 'bsky:awfulannouncing.bsky.social', 'bsky:mlbtraderumors.bsky.social', 'bsky:splitzoneduo.com', 'bsky:redditcfb.com', 'bsky:cfbnumbers.bsky.social',
      'bsky:dimeuproxx.bsky.social', 'bsky:marcjspears.bsky.social', 'bsky:howardbeck.bsky.social', 'bsky:jonbois.bsky.social', 'bsky:warriors.bsky.social', 'bsky:ny-knicks.bsky.social',
      'bsky:bigskyconf.bsky.social', 'bsky:espn.com', 'bsky:nba.com', 'bsky:mlb.com',
      'masto:BleacherReport@flipboard.com', 'masto:SportingNews@flipboard.com', 'masto:NBCSports@flipboard.com', 'masto:si_flipboard@flipboard.com', 'masto:usatodaysports@flipboard.com',
      'masto:Yardbarker@flipboard.com', 'masto:247Sports@flipboard.com', 'masto:nflscores@mastodon.online', 'masto:premierleaguescores@mastodon.world'],
    Business: ['bsky:bloomberg.com', 'bsky:reuters.com', 'bsky:wsj.com', 'bsky:ft.com', 'bsky:economist.com', 'bsky:cnbc.com', 'bsky:fortune.com', 'bsky:businessinsider.com', 'bsky:marketwatch.com', 'bsky:techcrunch.com'],
    Gaming: ['bsky:videogameschronicle.com', 'bsky:playstation.com', 'bsky:nintendolife.com', 'bsky:pushsquare.com', 'bsky:purexbox.com', 'bsky:timeextension.com',
      'bsky:jeffgerstmann.com', 'bsky:nintendousa.bsky.social', 'bsky:limitedrungames.bsky.social', 'bsky:gamingalexandria.bsky.social', 'bsky:capcomart.bsky.social',
      'masto:GIbiz@mastodon.social', 'masto:gamingonlinux@mastodon.social'],
    Tech: ['bsky:theverge.com', 'bsky:arstechnica.com', 'masto:eff@mastodon.social', 'masto:torproject@mastodon.social', 'masto:Gargron@mastodon.social', 'masto:arstechnica@mastodon.social', 'masto:signalapp@mastodon.world', 'masto:internetarchive@mastodon.archive.org'],
    Science: ['bsky:nasa.gov', 'bsky:science.org', 'bsky:newscientist.com', 'bsky:natgeo.com'],
    Fun: ['bsky:xkcd.com'] };
  // Only show accounts that are actually active: posts older than 30 days are hidden from Explore.
  const FRESH = 30 * 86400e3;
  const openAcc = () => LS.get('openFollow', []), openPosts = () => LS.get('openPosts', {}), openSet = v => LS.set('openFollow', [...new Set(v)].slice(0, 200));
  const invoke = (c, a) => window.__TAURI__.core.invoke(c, a);
  const otxt = h => { try { const d = new DOMParser().parseFromString(String(h).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p>/gi, '\n\n'), 'text/html'); return d.body.textContent || ''; } catch (_) { return ''; } };
  async function openFetch(acc) {
    const [kind, id] = [acc.slice(0, acc.indexOf(':')), acc.slice(acc.indexOf(':') + 1)];
    if (kind === 'bsky') {
      const j = JSON.parse(await invoke('public_feed', { url: 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?filter=posts_no_replies&limit=15&actor=' + encodeURIComponent(id) }));
      return (j.feed || []).filter(f => !f.reason && f.post && f.post.record).map(f => { const p = f.post, a = p.author || {}, rk = String(p.uri || '').split('/').pop();
        const imgs = (p.embed && (p.embed.images || (p.embed.media && p.embed.media.images))) || [];
        return { id: 'b:' + p.uri, acc, net: 'bsky', name: a.displayName || a.handle, handle: '@' + a.handle, at: Date.parse(p.record.createdAt || p.indexedAt) || Date.now(),
          text: String(p.record.text || '').slice(0, 3000), photos: imgs.length, video: !!(p.embed && /video/.test(p.embed.$type || '')), likes: p.likeCount || 0, reposts: p.repostCount || 0, replies: p.replyCount || 0,
          url: 'https://bsky.app/profile/' + a.handle + '/post/' + rk }; });
    }
    const [user, home] = id.split('@'), DIRECT = ['mastodon.social', 'mastodon.online', 'mstdn.social', 'mastodon.world', 'newsie.social'];
    // Accounts on other servers (Flipboard, etc.) are read through mastodon.social, which keeps their public posts.
    const host = DIRECT.includes(home) ? home : 'mastodon.social', acct = host === home ? user : user + '@' + home;
    const a = JSON.parse(await invoke('public_feed', { url: `https://${host}/api/v1/accounts/lookup?acct=${encodeURIComponent(acct)}` }));
    const l = JSON.parse(await invoke('public_feed', { url: `https://${host}/api/v1/accounts/${encodeURIComponent(a.id)}/statuses?limit=15&exclude_replies=true&exclude_reblogs=true` }));
    return (l || []).map(x => ({ id: 'm:' + x.uri, acc, net: 'masto', name: a.display_name || a.username, handle: '@' + a.acct + (a.acct.includes('@') ? '' : '@' + host), at: Date.parse(x.created_at) || Date.now(),
      text: otxt(x.content).slice(0, 3000), photos: (x.media_attachments || []).filter(m => m.type === 'image').length, video: (x.media_attachments || []).some(m => /video|gifv/.test(m.type)),
      likes: x.favourites_count || 0, reposts: x.reblogs_count || 0, replies: x.replies_count || 0, url: x.url || x.uri }));
  }
  let openBusy = false;
  async function openRefresh(accs, force) {
    if (openBusy) return; const all = openPosts(), stamp = LS.get('openAt', {}), now = Date.now();
    const due = [...new Set(accs)].filter(a => force || !(stamp[a] > now - 15 * 60e3)); if (!due.length) return;
    openBusy = true; view.openLoading = true; view.open && paint();
    for (let i = 0; i < due.length; i += 3) await Promise.all(due.slice(i, i + 3).map(async a => {
      try { const l = await openFetch(a); for (const k of Object.keys(all)) if (all[k].acc === a) delete all[k]; for (const x of l) all[x.id] = x; stamp[a] = now; }
      catch (e) { stamp[a] = now - 10 * 60e3; } }));
    // Keep the cache small: newest 600 posts.
    const keep = Object.values(all).sort((x, y) => y.at - x.at).slice(0, 600), out = {}; for (const x of keep) out[x.id] = x;
    LS.set('openPosts', out); LS.set('openAt', stamp); openBusy = false; view.openLoading = false; view.open && paint();
  }
  const NET = { bsky: '🦋 Bluesky', masto: '🐘 Mastodon' };
  function ocard(o) { const fol = openAcc().includes(o.acc);
    return `<div class="ec-post ec-open">${`<div class=hm-av style="width:40px;height:40px;flex:none;background:${o.net === 'bsky' ? '#1185fe' : '#6364ff'};color:#fff">${esc((o.name || '?')[0].toUpperCase())}</div>`}<div class=b>
      <div class=h><b>${esc(o.name)}</b><span>· ${esc(o.handle)}</span><span>· ${ago(o.at)}</span><span class=ec-aud title="Public post on ${o.net === 'bsky' ? 'Bluesky' : 'Mastodon'} — read-only in Echo">${NET[o.net]}</span></div>
      ${o.text ? `<div class=t>${linkify(o.text)}</div>` : ''}${o.photos || o.video ? `<div class=ec-page data-u="${esc(o.url)}">${o.video ? '▶ Video' : '📷 ' + o.photos + ' photo' + (o.photos > 1 ? 's' : '')} — open to view</div>` : ''}
      <div class=ec-act><span style="color:var(--mute);font-size:12.5px">💬 ${o.replies} · ↻ ${o.reposts} · ♥ ${o.likes}</span><span style="flex:1"></span>
        <button data-ofollow="${esc(o.acc)}" class="${fol ? 'on' : ''}" style="font-size:12.5px">${fol ? '✓ Following' : '＋ Follow'}</button><button data-u="${esc(o.url)}" style="font-size:12.5px">Open ↗</button></div></div></div>`; }
  function openSection() { const cat = OPEN_CATS[view.ocat] || view.ocat === 'Following' ? view.ocat : 'Sports', accs = cat === 'Following' ? openAcc() : (OPEN_CATS[cat] || []);
    const list = Object.values(openPosts()).filter(o => accs.includes(o.acc) && (cat === 'Following' || Date.now() - o.at < FRESH)).sort((a, b) => b.at - a.at).slice(0, 60);
    setTimeout(() => openRefresh(accs), 0);
    return `<div style="padding:12px 14px 0;font:600 12px system-ui;color:var(--mute)">FROM THE OPEN WEB · Bluesky & Mastodon, read through Tor</div>
      <div class=ec-seg style="padding:6px 14px">${[...Object.keys(OPEN_CATS), ...(openAcc().length ? ['Following'] : [])].map(c => `<button data-ocat="${c}" class="${c === cat ? 'on' : ''}">${c}</button>`).join('')}<button data-oadd>＋ Add account</button></div>
      ${list.map(ocard).join('') || `<div class=hm-empty>${view.openLoading ? 'Loading through Tor…' : 'Nothing yet — make sure Tor is connected.'}</div>`}`; }
  function tabs() { const n = unread();
    return `<div class=ec-tabs>${[['home', 'Home'], ['explore', 'Explore'], ['search', 'Search'], ['alerts', 'Alerts'], ['me', 'Me']].map(([k, l]) => `<button data-tab=${k} class="${view.tab === k ? 'on' : ''}">${l}${k === 'alerts' && n ? `<span class=n>${n}</span>` : ''}</button>`).join('')}</div>`; }
  function drawMain() {
    let body = '';
    if (view.tab === 'home') { const f = tune(feed()), fo = openAcc(); if (fo.length) setTimeout(() => openRefresh(fo), 0);
      const mix = [...f.map(p => ({ at: p.boostAt || p.at, h: () => card(p) })), ...Object.values(openPosts()).filter(o => fo.includes(o.acc)).map(o => ({ at: o.at, h: () => ocard(o) }))].sort((a, b) => b.at - a.at).slice(0, 300);
      body = homeTop() + (mix.map(x => x.h()).join('') || (M.status() !== 'on' ? '<div class=sk-row><div class="sk c"></div><div style="flex:1"><div class="sk l"></div><div class="sk l2"></div></div></div>'.repeat(3) : '') + `<div class=hm-empty><svg class=empty-art viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=1.2><circle cx=12 cy=12 r=3/><path d="M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7"/></svg><b>Your feed is quiet</b>Posts from your Murmur friends and people you follow show up here. Tap ✎ to post something — it goes to friends only unless you choose Public.</div>`); }
    else if (view.tab === 'explore') { const pub = Object.values(posts()).filter(p => p.aud === 'public' && !expired(p) && !p.reply && !p.moment && !M.contacts()[p.pk]?.blocked).sort((a, b) => b.at - a.at).slice(0, 200);
      const tr = trending(), comms = LS.get('comms', []), packs = Object.values(LS.get('packs', {}));
      const sel = view.comm, list = sel ? Object.values(posts()).filter(p => p.comm === sel && !expired(p) && !p.reply).sort((a, b) => b.at - a.at) : pub;
      body = `${sel ? '' : openSection()}${tr.length ? `<div style="padding:10px 14px 0;font:600 12px system-ui;color:var(--mute)">TRENDING WITH PEOPLE YOU KNOW</div><div class=ec-seg style="padding:6px 14px">${tr.map(([k, n]) => `<button data-tag="${esc(k)}">#${esc(k)} · ${n}</button>`).join('')}</div>` : ''}
        <div style="padding:10px 14px 0;font:600 12px system-ui;color:var(--mute)">COMMUNITIES</div><div class=ec-seg style="padding:6px 14px">${comms.map(c => `<button data-comm="${esc(c)}" class="${sel === c ? 'on' : ''}">◆ ${esc(c)}</button>`).join('')}<button data-commnew>＋ Join or start</button>${sel ? '<button data-comm="">All public</button>' : ''}</div>
        ${packs.length ? `<div style="padding:10px 14px 0;font:600 12px system-ui;color:var(--mute)">STARTER PACKS</div>` + packs.slice(0, 6).map(k => `<button class=ec-person data-pack="${esc(k.id)}"><div class=hm-av style="background:var(--acc);color:var(--bg);width:40px;height:40px">★</div><div style="text-align:left"><b>${esc(k.name)}</b><div style="color:var(--mute);font-size:13px">${k.people.length} people · by ${esc(nameOf(k.pk))}</div></div></button>`).join('') : ''}
        <div style="display:flex;gap:8px;padding:10px 14px"><button class="hm-btn ghost" data-swipe>▶ Swipe photos</button><button class="hm-btn ghost" data-packnew>★ Make a starter pack</button></div>
        <div style="padding:4px 14px 10px;color:var(--mute);font-size:12.5px">${sel ? 'Public posts in ◆ ' + esc(sel) + '.' : 'Public posts from people on Echo. Friends-only posts never appear here.'}</div>` + (list.map(x => card(x)).join('') || '<div class=hm-empty>Nothing public yet — loading through Tor…</div>'); }
    else if (view.tab === 'search') { body = `<div style="padding:12px 14px"><input class=hm-search style="margin:0;width:100%" id=ec-q placeholder="Search names or topics" value="${esc(view.q)}" enterkeyhint=search></div>` + drawResults(); }
    else if (view.tab === 'alerts') { const l = LS.get('notif', []); body = l.map(n => `<div class="ec-note ${n.unread ? 'unread' : ''}" data-open="${esc(n.reply || n.post)}">${av(n.from, 36)}<div><b>${esc(nameOf(n.from))}</b> ${n.type === 'like' ? 'liked your post' : n.type === 'repost' ? 'reposted you' : 'replied to you'}<div style="color:var(--mute);font-size:12px">${ago(n.at)}</div></div></div>`).join('') || '<div class=hm-empty>Likes and replies on your posts show up here.</div>';
      setTimeout(() => { const l2 = LS.get('notif', []); if (l2.some(x => x.unread)) { l2.forEach(x => x.unread = false); LS.set('notif', l2); badge(); } }, 1500); }
    else { const p = prof(), mine = Object.values(posts()).filter(x => x.pk === me() && !expired(x)).sort((a, b) => b.at - a.at);
      body = `${banner(me())}<div class=ec-prof style="margin-top:-46px"><div style="display:flex;justify-content:center">${av(me(), 84)}</div><h2>${esc(p.name)}</h2>${M.myProfile().status ? `<p>${esc(M.myProfile().status)}</p>` : ''}<p>${tagOf(me())} · ${p.public ? '<span class=ec-pill>🌐 Public</span>' : '<span class=ec-pill>🔒 Friends only</span>'}</p>${p.bio ? `<p>${esc(p.bio)}</p>` : ''}
        <p style="font-size:12.5px">${M.friends().length} friends · ${follows().length} following</p><div style="display:flex;gap:8px;justify-content:center"><button class="hm-btn ghost" data-edit>Edit profile</button><button class="hm-btn ghost" data-circles>◎ Circles</button></div></div>` + (profileList(me(), true) || '') + (mine.length ? '' : '<div class=hm-empty>You haven’t posted yet.</div>'); }
    view.el.innerHTML = `<div class=hm>${head('echo.', closeB())}${tabs()}<div class=hm-body>${body}</div><button class=ec-fab data-compose aria-label="New post">${IC.pen}</button></div>`;
    const q = view.el.querySelector('#ec-q'); if (q) { let deb; q.oninput = () => { clearTimeout(deb); deb = setTimeout(() => { const v = q.value.trim(); if (v.length < 2 || v === view.q) return; view.q = v; view.results = 'loading';
        const pos = q.selectionStart; paint(); const q2 = view.el.querySelector('#ec-q'); if (q2) { q2.focus(); try { q2.setSelectionRange(pos, pos); } catch {} } search(view.q, () => { view.results = 'done'; if (view.tab === 'search') { const f = document.activeElement === view.el.querySelector('#ec-q'); paint(); if (f) view.el.querySelector('#ec-q')?.focus(); } }); }, 450); };
      q.onkeydown = e => { if (e.key === 'Enter') { view.q = q.value.trim(); if (!view.q) return; view.results = 'loading'; paint(); search(view.q, () => { view.results = 'done'; paint(); }); } }; if (!view.q) setTimeout(() => q.focus(), 50); }
    if (view.tab === 'explore' && !view.explored) { view.explored = true; explore(); }
    if (view.tab === 'explore' && view.comm && view.commSub !== view.comm) { view.commSub = view.comm; M.unreq('echo-c'); M.req('echo-c', [{ kinds: [K_POST], '#t': ['c-' + view.comm], limit: 200 }], onPublic, () => view.open && paint()); }
  }
  function momentsBy() { const fr = new Set(M.friends()), fo = new Set(follows()), by = {};
    for (const p of Object.values(posts())) if (isMoment(p) && (p.pk === me() || fr.has(p.pk) || fo.has(p.pk)) && !M.contacts()[p.pk]?.blocked) (by[p.pk] = by[p.pk] || []).push(p);
    for (const k in by) by[k].sort((a, b) => a.at - b.at); return by; }
  function homeTop() {
    const by = momentsBy(), seen = new Set(LS.get('mseen', [])), order = Object.keys(by).sort((a, b) => (a === me() ? -1 : b === me() ? 1 : 0) || (by[a].every(x => seen.has(x.id)) - by[b].every(x => seen.has(x.id))) || by[b].at(-1).at - by[a].at(-1).at);
    let h = `<div class=ec-moments><button data-mnew>${'<div class=ring style="background:var(--line)">' + av(me(), 52) + '</div>'}<span>${by[me()] ? 'Add more' : 'Your moment'}</span></button>${order.map(pk => `<button data-moment="${pk}"><div class="ring ${by[pk].every(x => seen.has(x.id)) ? 'seen' : ''}">${av(pk, 52)}</div><span>${esc(pk === me() ? 'You' : nameOf(pk).split(/\s+/)[0])}</span></button>`).join('')}${M.friends().filter(pk => M.contacts()[pk]?.status && !order.includes(pk)).slice(0, 12).map(pk => `<button data-pk="${pk}" title="${esc(M.contacts()[pk].status)}"><div style="position:relative">${av(pk, 52)}<span style="position:absolute;left:50%;top:-10px;transform:translateX(-50%);max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1px 6px;font-size:10.5px;color:var(--ink)">${esc(M.contacts()[pk].status)}</span></div><span>${esc(nameOf(pk).split(/\s+/)[0])}</span></button>`).join('')}</div>`;
    const c = view.catch; if (c && (c.posts || c.likes || c.replies)) h += `<div class=ec-catch><b>While you were away</b>${[c.posts ? `${c.posts} new post${c.posts === 1 ? '' : 's'} from ${c.names.slice(0, 3).map(esc).join(', ')}${c.names.length > 3 ? ' +' + (c.names.length - 3) : ''}` : '', c.moments ? `${c.moments} new moment${c.moments === 1 ? '' : 's'}` : '', c.likes ? `${c.likes} like${c.likes === 1 ? '' : 's'}` : '', c.replies ? `${c.replies} repl${c.replies === 1 ? 'y' : 'ies'}` : ''].filter(Boolean).join(' · ')}<div style="margin-top:8px"><button class="hm-btn ghost" data-caught>Got it</button></div></div>`;
    const al = algo(); h += `<div style="display:flex;gap:6px;align-items:center;padding:8px 14px 0;flex-wrap:wrap"><button class="hm-btn ghost" data-algo style="padding:6px 12px">🎚 Tune my feed</button>${al.map(a => `<span class=ec-pill>${a.dir > 0 ? 'More' : 'Less'}: ${esc(a.w.trim())}</span>`).join('')}</div>`;
    const pg = A.page && A.page(), pn = pg ? notesFor(pg.url) : [];
    if (pg) h += `<div class=ec-catch style="background:var(--card)"><b>📌 ${esc(hostOf(pg.url))}</b>${pn.length ? `${pn.length} note${pn.length === 1 ? '' : 's'} from friends on this page` : 'Leave a note on this page for your friends'}<div style="margin-top:8px;display:flex;gap:8px">${pn.length ? '<button class=hm-btn data-pagenotes>See notes</button>' : ''}<button class="hm-btn ghost" data-pagenote>Add a note</button></div></div>`;
    return h; }
  function catchUp() { const since = LS.get('seenAt', 0); LS.set('seenAt', Date.now()); if (!since || Date.now() - since < 2 * 3600e3) return null;
    const f = Object.values(posts()).filter(p => p.pk !== me() && p.at > since && !expired(p) && !p.reply && (isFriend(p.pk) || follows().includes(p.pk)));
    const n = LS.get('notif', []).filter(x => x.at > since);
    return { posts: f.filter(p => !p.moment).length, moments: f.filter(p => p.moment).length, names: [...new Set(f.filter(p => !p.moment).map(p => nameOf(p.pk)))], likes: n.filter(x => x.type === 'like').length, replies: n.filter(x => x.type === 'reply').length }; }
  function notesFor(url) { const u = normUrl(url); if (!u) return []; const fr = new Set(M.friends()), fo = new Set(follows());
    return Object.values(posts()).filter(p => p.page === u && !expired(p) && (p.pk === me() || fr.has(p.pk) || fo.has(p.pk)) && !M.contacts()[p.pk]?.blocked).sort((a, b) => b.at - a.at); }
  function drawPage() { const pg = A.page && A.page(), u = view.pageUrl || pg?.url || '', l = notesFor(u);
    view.el.innerHTML = `<div class=hm>${head('📌 ' + esc(hostOf(u)), '', backB)}<div class=hm-body><div style="padding:10px 14px;color:var(--mute);font-size:12.5px">Notes your friends left on this page. Only they can read them.</div>${l.map(p => card(p)).join('') || '<div class=hm-empty>No notes on this page yet</div>'}</div>
      <button class=ec-fab data-pagenote aria-label="Add a note">${IC.pen}</button></div>`; }
  function tuneUI() { const v = document.createElement('div'); v.className = 'hm-view';
    v.innerHTML = `<div class=hm-card style="width:min(420px,92vw);color:var(--ink)"><h3>🎚 Tune my feed</h3><p>Ask for more or less of a topic for a while. Only this device knows — nothing is sent anywhere.</p>
      <input class=hm-in id=al-w placeholder="A word or #tag — e.g. politics, #hiking" maxlength=30><div class=ec-seg style="margin:6px 0"><button data-d=1 class=on>More</button><button data-d=-1>Less</button></div>
      <div class=ec-seg style="margin:6px 0">${[[1, '1 day'], [3, '3 days'], [7, '7 days']].map(([d, l], i) => `<button data-days=${d} class="${i === 1 ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${algo().map((a, i) => `<div class=hm-opt><div>${a.dir > 0 ? 'More' : 'Less'} “${esc(a.w.trim())}”<small>until ${new Date(a.until).toLocaleDateString()}</small></div><button class="hm-btn ghost" data-rm=${i}>Remove</button></div>`).join('')}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="hm-btn ghost" data-x>Close</button><button class=hm-btn id=al-go>Add</button></div></div>`;
    document.body.append(v); let dir = 1, days = 3;
    v.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { dir = +b.dataset.d; v.querySelectorAll('[data-d]').forEach(x => x.classList.toggle('on', x === b)); });
    v.querySelectorAll('[data-days]').forEach(b => b.onclick = () => { days = +b.dataset.days; v.querySelectorAll('[data-days]').forEach(x => x.classList.toggle('on', x === b)); });
    v.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const l = algo(); l.splice(+b.dataset.rm, 1); LS.set('algo', l); v.remove(); paint(); });
    v.onclick = e => { if (e.target === v || e.target.dataset.x !== undefined) v.remove(); };
    v.querySelector('#al-go').onclick = () => { const w = v.querySelector('#al-w').value.toLowerCase().trim().replace(/^#/, ''); if (w.length < 2) return A.toast('Type a word or #tag');
      LS.set('algo', [...algo().filter(a => a.w.trim() !== w), { w: ' ' + w, dir, until: Date.now() + days * 86400e3 }].slice(-20)); v.remove(); paint(); A.toast(`${dir > 0 ? 'More' : 'Less'} “${w}” for ${days} day${days > 1 ? 's' : ''}`); }; }
  // Swipe mode: photos and moments full-screen, one at a time — swipe up/down or use the arrow keys.
  function swipe() { const fr = new Set([...M.friends(), ...follows()]);
    const list = Object.values(posts()).filter(p => p.img && !expired(p) && (fr.has(p.pk) || p.aud === 'public' || p.pk === me()) && !M.contacts()[p.pk]?.blocked).sort((a, b) => b.at - a.at).slice(0, 200);
    if (!list.length) return A.toast('No photos to swipe through yet');
    let i = 0; const v = document.createElement('div'); v.className = 'ec-mv'; v.style.position = 'fixed'; v.style.zIndex = 99; document.body.append(v);
    const drawS = () => { const p = list[i]; const liked = (p.likes || []).includes(me());
      v.innerHTML = `<div class=top>${av(p.pk, 34)}<b>${esc(nameOf(p.pk))}</b><span style="opacity:.7;font-size:13px">${ago(p.at)} · ${i + 1}/${list.length}</span><span style="flex:1"></span><button class=hm-ib data-l style="color:${liked ? '#e11d48' : '#fff'}">${IC.like}</button><button class=hm-ib data-x style="color:#fff"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
        <div class=mid><img class=ec-img data-img='${esc(JSON.stringify(p.img))}' alt="" style="border:0;margin:0"></div>${p.text ? `<div class=cap>${esc(p.text.slice(0, 280))}</div>` : ''}`;
      v.querySelectorAll('img.ec-img').forEach(loadImg); M.hydrate(v);
      v.querySelector('[data-x]').onclick = () => { v.remove(); removeEventListener('keydown', k); };
      v.querySelector('[data-l]').onclick = () => { like(p); drawS(); }; };
    const step = d => { const j = i + d; if (j >= 0 && j < list.length) { i = j; drawS(); } };
    let y0 = null; v.addEventListener('pointerdown', e => { y0 = e.clientY; }); v.addEventListener('pointerup', e => { if (y0 == null) return; const dy = e.clientY - y0; y0 = null; if (Math.abs(dy) > 50) step(dy < 0 ? 1 : -1); });
    v.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > 30) step(e.deltaY > 0 ? 1 : -1); }, { passive: true });
    const k = e => { if (e.key === 'ArrowDown') step(1); else if (e.key === 'ArrowUp') step(-1); else if (e.key === 'Escape') { v.remove(); removeEventListener('keydown', k); } }; addEventListener('keydown', k);
    drawS(); }
  let mvTimer = null;
  function drawMoment() { clearTimeout(mvTimer); const by = momentsBy(), order = Object.keys(by), list = by[view.mpk] || [];
    if (!list.length) { view.screen = null; return drawMain(); }
    const i = Math.min(view.mi || 0, list.length - 1), p = list[i]; const sn = new Set(LS.get('mseen', [])); sn.add(p.id); LS.set('mseen', [...sn].slice(-800));
    drawMain(); const mv = document.createElement('div'); mv.className = 'ec-mv';
    mv.innerHTML = `<div class=bars>${list.map((x, j) => `<i><b style="width:${j < i ? 100 : 0}%"></b></i>`).join('')}</div><div class=top>${av(p.pk, 34)}<b>${esc(nameOf(p.pk))}</b><span style="opacity:.7;font-size:13px">${ago(p.at)}</span><span style="flex:1"></span>${p.pk === me() ? '<button class=hm-ib data-mdel aria-label=Delete style="color:#fff">🗑</button>' : `<button class=hm-ib data-mreply aria-label=Reply style="color:#fff">${IC.reply}</button>`}<button class=hm-ib data-mx aria-label=Close style="color:#fff"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class=mid>${p.img ? `<img class=ec-img data-img='${esc(JSON.stringify(p.img))}' alt="" style="border:0;margin:0">` : `<div class=big>${esc(p.text)}</div>`}</div>${p.img && p.text ? `<div class=cap>${esc(p.text)}</div>` : ''}`;
    view.el.querySelector('.hm').append(mv); mv.querySelectorAll('img.ec-img').forEach(loadImg); M.hydrate(mv);
    const bar = mv.querySelectorAll('.bars b')[i]; requestAnimationFrame(() => { bar.style.transition = 'width 6s linear'; bar.style.width = '100%'; });
    const next = d => { clearTimeout(mvTimer); const j = i + d; if (j >= 0 && j < list.length) { view.mi = j; return drawMoment(); }
      const k = order.indexOf(view.mpk) + (d > 0 ? 1 : -1); if (d > 0 && k < order.length && k >= 0) { view.mpk = order[k]; view.mi = 0; return drawMoment(); } view.screen = null; paint(); };
    mvTimer = setTimeout(() => view.screen === 'moment' && next(1), 6000);
    mv.querySelector('.mid').onclick = e => next(e.clientX < innerWidth / 3 ? -1 : 1);
    mv.querySelector('[data-mx]').onclick = () => { clearTimeout(mvTimer); view.screen = null; paint(); };
    const del = mv.querySelector('[data-mdel]'); if (del) del.onclick = () => { clearTimeout(mvTimer); if (confirm('Delete this moment?')) { remove(p); } view.screen = null; paint(); };
    const rp = mv.querySelector('[data-mreply]'); if (rp) rp.onclick = () => { clearTimeout(mvTimer); view.screen = null; A.openMurmur && A.openMurmur(p.pk); }; }
  function drawCircles() { const cs = circles(), ed = view.circle != null ? (cs[view.circle] || { name: '', members: [] }) : null, fr = M.friends();
    if (ed) { const sel = new Set(ed.members);
      view.el.innerHTML = `<div class=hm>${head(view.circle && cs[view.circle] ? 'Edit circle' : 'New circle', '', backB)}<div class=hm-body><div class=ec-c>
        <input class=hm-in id=ec-cn maxlength=30 placeholder="Circle name — e.g. Close friends, Family" value="${esc(ed.name)}">
        <div style="font:600 12px system-ui;color:var(--mute)">WHO’S IN IT (${fr.length} friends)</div>
        ${fr.map(pk => `<label class=ec-chk>${av(pk, 32)}<span style="flex:1">${esc(nameOf(pk))}</span><input type=checkbox data-cm="${pk}" ${sel.has(pk) ? 'checked' : ''}></label>`).join('') || '<div class=hm-empty>Add friends in Murmur first</div>'}
        <div style="display:flex;gap:8px">${view.circle && cs[view.circle] ? '<button class="hm-btn ghost" id=ec-cd style="color:#ef4444">Delete circle</button>' : ''}<span style="flex:1"></span><button class=hm-btn id=ec-cs>Save</button></div>
        <p style="font-size:12px;color:var(--mute);margin:0">Only you can see your circles. People in a circle just see the post — never the circle’s name or who else is in it.</p></div></div></div>`;
      view.el.querySelector('#ec-cs').onclick = () => { const name = view.el.querySelector('#ec-cn').value.trim().slice(0, 30); if (!name) return A.toast('Name your circle');
        const members = [...view.el.querySelectorAll('[data-cm]:checked')].map(x => x.dataset.cm); if (!members.length) return A.toast('Pick at least one friend');
        const all = circles(), id = view.circle || Math.random().toString(36).slice(2, 10); all[id] = { name, members }; LS.set('circles', all); view.circle = null; paint(); A.toast('Circle saved'); };
      const d = view.el.querySelector('#ec-cd'); if (d) d.onclick = () => { if (!confirm('Delete this circle? Posts already shared stay with the people who got them.')) return; const all = circles(); delete all[view.circle]; LS.set('circles', all); view.circle = null; paint(); };
      return; }
    view.el.innerHTML = `<div class=hm>${head('Circles', '', backB)}<div class=hm-body><div style="padding:12px 14px;color:var(--mute);font-size:13px">Share some posts with just a few friends — pick a circle when you post.</div>
      ${Object.entries(cs).map(([id, c]) => `<button class=ec-person data-circ="${id}"><div class=hm-av style="background:var(--acc);color:var(--bg);width:40px;height:40px">◎</div><div style="text-align:left"><b>${esc(c.name)}</b><div style="color:var(--mute);font-size:13px">${c.members.length} ${c.members.length === 1 ? 'person' : 'people'}</div></div></button>`).join('') || '<div class=hm-empty>No circles yet</div>'}
      <div style="padding:14px;display:flex;gap:8px;flex-wrap:wrap">${Object.values(cs).some(c => c.name === 'Close friends') ? '' : '<button class=hm-btn data-close-fr>＋ Close friends</button>'}<button class="hm-btn ghost" data-circ="">+ New circle</button></div></div></div>`;
    view.el.querySelectorAll('[data-circ]').forEach(b => b.onclick = () => { view.circle = b.dataset.circ; paint(); });
    const cf = view.el.querySelector('[data-close-fr]'); if (cf) cf.onclick = () => { view.circle = ''; paint(); const n = view.el.querySelector('#ec-cn'); if (n) n.value = 'Close friends'; }; }
  function profileList(pk, own) { const all = posts(), pinId = own ? prof()?.pin : profiles()[pk]?.pin, pin = pinId && all[pinId] && !expired(all[pinId]) ? all[pinId] : null, tab = view.ptab || 'posts';
    const mine = Object.values(all).filter(x => x.pk === pk && !expired(x) && !x.reply && !x.moment).sort((a, b) => b.at - a.at);
    const tabsH = `<div class=ec-ptabs>${[['posts', 'Posts'], ['photos', 'Photos'], ...(own ? [['saved', 'Saved']] : [])].map(([k, l]) => `<button data-ptab=${k} class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    if (tab === 'photos') { const ph = mine.filter(x => x.img); return tabsH + (ph.length ? `<div class=ec-grid>${ph.map(x => `<img data-img='${esc(JSON.stringify(x.img))}' data-open="${x.id}" alt="">`).join('')}</div>` : '<div class=hm-empty>No photos yet</div>'); }
    if (tab === 'saved') { const sv = saved().map(id => all[id]).filter(x => x && !expired(x)); return tabsH + (sv.map(x => card(x)).join('') || '<div class=hm-empty>Tap ⋯ on any post and choose Save — it’ll be kept here, only on this device.</div>'); }
    return tabsH + (pin ? card(pin, { pinned: true }) : '') + (mine.filter(x => x !== pin).map(x => card(x)).join('') || ''); }
  function drawResults() {
    if (!view.q) return '<div class=hm-empty><b>Find people and posts</b>Search a name (public profiles only) or words people posted about publicly.</div>';
    const ql = view.q.toLowerCase().replace(/^@/, ''), ws = words(view.q);
    const people = Object.entries(profiles()).filter(([pk, p]) => p.public && (p.name || '').toLowerCase().includes(ql)).slice(0, 30);
    const found = Object.values(posts()).filter(p => p.aud === 'public' && !expired(p) && (ws.some(w => p.text.toLowerCase().includes(w)) || p.text.toLowerCase().includes(ql))).sort((a, b) => b.at - a.at).slice(0, 100);
    return `${people.length ? `<div style="padding:4px 14px;color:var(--mute);font:600 12px system-ui">PEOPLE</div>` + people.map(([pk, p]) => `<button class=ec-person data-pk="${pk}">${av(pk, 40)}<div style="text-align:left"><b>${esc(p.name)}</b> <span style="color:var(--mute)">· ${tagOf(pk)}</span><div style="color:var(--mute);font-size:13px">${esc((p.bio || '').slice(0, 80))}</div></div></button>`).join('') : ''}
      ${found.length ? `<div style="padding:10px 14px 4px;color:var(--mute);font:600 12px system-ui">POSTS</div>` + found.map(x => card(x)).join('') : ''}
      ${!people.length && !found.length ? `<div class=hm-empty>${view.results === 'loading' ? 'Searching through Tor…' : 'Nothing found. Only public profiles and posts can be searched.'}</div>` : ''}`;
  }
  function drawCompose() {
    const p = prof(), r = view.replyTo && posts()[view.replyTo], qt = view.quote && posts()[view.quote], pg = A.page && A.page();
    const canPub = p.public, cs = circles(); let aud = view.aud || (r ? r.aud : 'friends'); if (qt && qt.aud !== 'public' && aud === 'public') aud = 'friends';
    const mom = !!view.moment, pageOn = view.pageUrl != null ? !!view.pageUrl : false, poll = view.poll || null;
    view.el.innerHTML = `<div class=hm>${head(r ? 'Reply' : mom ? 'New moment' : qt ? 'Quote' : 'New post', '', backB)}<div class=hm-body><div class=ec-c>
      ${r ? `<div class=ec-reply>Replying to <b>${esc(nameOf(r.pk))}</b>: “${esc(r.text.slice(0, 80))}”</div>` : ''}
      <textarea id=ec-t maxlength=2000 placeholder="${r ? 'Write your reply' : mom ? 'Add a caption (or just text)' : qt ? 'Add your thoughts' : 'What’s happening?'}"></textarea>
      ${qt ? `<div class=ec-q><b>${esc(nameOf(qt.pk))}</b><div>${esc(qt.text.slice(0, 200))}</div></div>` : ''}
      ${poll ? `<div><div style="font:600 12px system-ui;color:var(--mute);margin-bottom:6px">POLL OPTIONS</div>${[0, 1, 2, 3].map(i => `<input class=hm-in data-po=${i} maxlength=60 placeholder="Option ${i + 1}${i > 1 ? ' (optional)' : ''}" value="${esc(poll[i] || '')}">`).join('')}</div>` : ''}
      <div id=ec-ph style="font-size:12.5px;color:var(--mute)"></div>
      ${r ? '' : `<div><div style="font:600 12px system-ui;color:var(--mute);margin-bottom:6px">WHO CAN SEE THIS</div><div class=ec-seg><button data-aud=friends class="${aud === 'friends' ? 'on' : ''}">🔒 Friends</button>${Object.entries(cs).map(([id, c]) => `<button data-aud="c:${id}" class="${aud === 'c:' + id ? 'on' : ''}">◎ ${esc(c.name)}</button>`).join('')}${qt && qt.aud !== 'public' ? '' : `<button data-aud=public class="${aud === 'public' ? 'on' : ''}">🌐 Public</button>`}<button data-circles title="Make a circle">＋</button></div>
        <div style="font-size:12px;color:var(--mute);margin-top:6px">${aud === 'public' ? (canPub ? 'Anyone on Echo can see and find this post.' : 'Turn on your public profile first (Me → Edit profile).') : aud.startsWith('c:') && cs[aud.slice(2)] ? 'Encrypted for the ' + cs[aud.slice(2)].members.length + ' people in ' + esc(cs[aud.slice(2)].name) + '. They don’t see the circle’s name.' : 'Encrypted for your ' + M.friends().length + ' Murmur friends. Nobody else can read it.'}</div></div>`}
      ${r || qt ? '' : `<label class=ec-chk><input type=checkbox id=ec-mom ${mom ? 'checked' : ''}> ✨ Post as a <b>moment</b> — shows at the top of friends’ feeds for 24 hours</label>`}
      ${pg && !r && !mom ? `<label class=ec-chk><input type=checkbox id=ec-pg ${pageOn ? 'checked' : ''}> 📌 Leave this as a note on <b>${esc(hostOf(pg.url))}</b> — friends see it when they visit</label>` : ''}
      ${r || mom ? '' : `<div><div style="font:600 12px system-ui;color:var(--mute);margin-bottom:6px">WHO CAN REPLY</div><div class=ec-seg>${[['', 'Everyone who can see it'], ['follow', 'Friends'], ['none', 'Nobody']].map(([v, l]) => `<button data-rep="${v}" class="${(view.rep || '') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`}
      ${r || mom || !LS.get('comms', []).length ? '' : `<div><div style="font:600 12px system-ui;color:var(--mute);margin-bottom:6px">COMMUNITY</div><div class=ec-seg><button data-cm2="" class="${!view.comm2 ? 'on' : ''}">None</button>${LS.get('comms', []).map(c => `<button data-cm2="${esc(c)}" class="${view.comm2 === c ? 'on' : ''}">◆ ${esc(c)}</button>`).join('')}</div></div>`}
      ${r || mom ? '' : `<div id=ec-thr>${(view.thread || []).map((t, i) => `<textarea class=ec-thr data-thr=${i} maxlength=2000 placeholder="Next post in the thread" style="width:100%;min-height:70px;border-radius:14px;border:1px solid var(--line);background:var(--card);color:var(--ink);padding:10px;font:15px/1.45 system-ui;margin-top:6px">${esc(t)}</textarea>`).join('')}<button class="hm-btn ghost" data-thradd style="margin-top:6px">＋ Add to thread</button></div>`}
      ${mom ? '' : `<div><div style="font:600 12px system-ui;color:var(--mute);margin-bottom:6px">DISAPPEARS</div><div class=ec-seg>${[[0, 'Never'], [86400, '24 hours'], [7 * 86400, '7 days'], [30 * 86400, '30 days']].map(([v, l]) => `<button data-exp=${v} class="${(view.exp || 0) === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`}
      <div style="display:flex;gap:8px;align-items:center"><label class="hm-btn ghost" style="cursor:pointer">📷 Photo<input type=file id=ec-f accept="image/*" hidden></label>${r || mom ? '' : `<button class="hm-btn ghost" id=ec-poll>${poll ? '✕ Poll' : '📊 Poll'}</button>`}<span style="flex:1"></span><button class=hm-btn id=ec-go>${r ? 'Reply' : mom ? 'Share moment' : 'Post'}</button></div></div></div></div>`;
    let file = view.file || null; const ph = view.el.querySelector('#ec-ph'); if (file) ph.textContent = '📷 ' + file.name;
    view.el.querySelector('#ec-f').onchange = async e => { let f = e.target.files[0] || null; if (f && /^image\/(jpeg|png|webp)$/.test(f.type) && M.editPhoto) f = await M.editPhoto(f); file = view.file = f; ph.textContent = file ? '📷 ' + (file.name || 'photo') + ' · edited' : ''; };
    const keepPoll = () => { if (view.poll) view.poll = [...view.el.querySelectorAll('[data-po]')].map(i => i.value); };
    view.el.querySelectorAll('[data-aud]').forEach(b => b.onclick = () => { keepPoll(); view.aud = b.dataset.aud; paint(); });
    const mo = view.el.querySelector('#ec-mom'); if (mo) mo.onchange = () => { keepPoll(); view.moment = mo.checked; if (mo.checked) view.poll = null; paint(); };
    const pc = view.el.querySelector('#ec-pg'); if (pc) pc.onchange = () => { keepPoll(); view.pageUrl = pc.checked ? pg.url : ''; paint(); };
    const keepThr = () => { if (view.thread) view.thread = [...view.el.querySelectorAll('[data-thr]')].map(x => x.value); };
    view.el.querySelectorAll('[data-rep]').forEach(b => b.onclick = () => { keepPoll(); keepThr(); view.rep = b.dataset.rep; paint(); });
    view.el.querySelectorAll('[data-cm2]').forEach(b => b.onclick = () => { keepPoll(); keepThr(); view.comm2 = b.dataset.cm2; paint(); });
    view.el.querySelectorAll('[data-thr]').forEach(x => x.oninput = () => { view.thread[+x.dataset.thr] = x.value; });
    const ta0 = view.el.querySelector('#ec-t'); if (ta0) { if (!r && !qt && !ta0.value && view.draft == null) { const d = LS.get('draft', ''); if (d) { ta0.value = d; A.toast('Draft restored'); } } view.draft = 1; ta0.addEventListener('input', () => { if (!r) LS.set('draft', ta0.value); }); }
    const ta = view.el.querySelector('[data-thradd]'); if (ta) ta.onclick = () => { keepPoll(); keepThr(); view.thread = [...(view.thread || []), '']; paint(); setTimeout(() => [...view.el.querySelectorAll('[data-thr]')].pop()?.focus(), 30); };
    view.el.querySelectorAll('[data-po]').forEach(i => i.oninput = () => { if (view.poll) view.poll[+i.dataset.po] = i.value; });
    const pb = view.el.querySelector('#ec-poll'); if (pb) pb.onclick = () => { view.poll = view.poll ? null : ['', '']; paint(); };
    view.el.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => { keepPoll(); view.exp = +b.dataset.exp; paint(); });
    view.el.querySelector('#ec-go').onclick = async () => { const t = view.el.querySelector('#ec-t').value; keepPoll();
      const opts = view.poll ? view.poll.map(x => x.trim()).filter(Boolean) : null; if (view.poll && (opts.length < 2 || !t.trim())) return A.toast('A poll needs a question and at least 2 options');
      if (!t.trim() && !file && !qt) return A.toast(mom ? 'Add a photo or some text' : 'Write something first');
      if (aud.startsWith('c:') && !cs[aud.slice(2)]) return A.toast('That circle is gone — pick another');
      if (aud === 'public' && !canPub) return A.toast('Turn on your public profile first');
      if (aud === 'friends' && !M.friends().length && !r) return A.toast('Add friends in Murmur first — friends-only posts go to them');
      const b = view.el.querySelector('#ec-go'); b.disabled = true; b.textContent = 'Posting…';
      try { keepThr(); await post(t, { aud, exp: mom ? 86400 : view.exp || 0, file, reply: r, moment: mom, page: !r && !mom && view.pageUrl ? view.pageUrl : null, quote: qt || null, poll: opts, replies: view.rep || null, comm: view.comm2 || null });
        // Thread: each extra part is posted as a reply to the one before it, same audience.
        let prev = Object.values(posts()).filter(x => x.pk === me()).sort((a, b) => b.at - a.at)[0];
        for (const part of (view.thread || []).map(x => x.trim()).filter(Boolean)) { if (!prev) break; await post(part, { aud, reply: prev, replies: view.rep || null }); prev = Object.values(posts()).filter(x => x.pk === me()).sort((a, b) => b.at - a.at)[0]; }
        if (!r) LS.set('draft', ''); view.thread = null; view.rep = null; view.comm2 = null; view.draft = null;
        const pageNote = !!view.pageUrl && !mom; Object.assign(view, { file: null, exp: 0, aud: null, moment: false, pageUrl: null, poll: null, quote: null });
        go(r ? 'post' : pageNote ? 'page' : null, r ? { id: r.id } : {}); A.toast(r ? 'Replied' : mom ? '✨ Moment shared for 24 hours' : pageNote ? '📌 Note left on this page' : aud === 'public' ? '🌐 Posted publicly' : aud.startsWith('c:') ? '◎ Shared with ' + cs[aud.slice(2)].name : '🔒 Posted to friends'); }
      catch (e) { b.disabled = false; b.textContent = 'Post'; A.toast('Couldn’t post: ' + String(e.message || e).slice(0, 100)); } };
    setTimeout(() => view.el.querySelector('#ec-t')?.focus(), 50);
  }
  function drawThread() {
    const all = posts(), p = all[view.id]; if (!p) { view.screen = null; return drawMain(); }
    const parent = p.reply && all[p.reply], replies = Object.values(all).filter(x => x.reply === p.id && !expired(x)).sort((a, b) => a.at - b.at);
    view.el.innerHTML = `<div class=hm>${head('Post', '', backB)}<div class=hm-body>${parent ? card(parent) : ''}${card(p)}${replies.map(x => card(x)).join('') || '<div class=hm-empty style="padding:20px">No replies yet</div>'}</div>
      <button class=ec-fab data-replyto="${p.id}" aria-label=Reply>${IC.reply}</button></div>`;
  }
  function drawPerson() {
    const pk = view.pk, pr = profiles()[pk] || {}, friend = isFriend(pk), fo = follows().includes(pk);
    const list = Object.values(posts()).filter(x => x.pk === pk && !expired(x) && !x.reply && !x.moment);
    view.el.innerHTML = `<div class=hm>${head(esc(nameOf(pk)), '', backB)}<div class=hm-body>${banner(pk)}<div class=ec-prof style="margin-top:-46px"><div style="display:flex;justify-content:center">${av(pk, 84)}</div>
      <h2>${esc(nameOf(pk))}</h2>${M.contacts()[pk]?.status ? `<p>${esc(M.contacts()[pk].status)}</p>` : ''}<p>${tagOf(pk)} · ${friend ? '<span class=ec-pill>Friend</span>' : pr.public ? '<span class=ec-pill>🌐 Public</span>' : ''}</p>${pr.bio ? `<p>${esc(pr.bio)}</p>` : ''}
      <div style="display:flex;gap:8px;justify-content:center;margin-top:8px">${pk !== me() && pr.public && !friend ? `<button class="hm-btn ${fo ? 'ghost' : ''}" id=ec-fo>${fo ? 'Following' : 'Follow'}</button>` : ''}${pk !== me() ? '<button class="hm-btn ghost" id=ec-msg>Message</button>' : ''}</div></div>
      ${list.length ? profileList(pk, false) : `<div class=hm-empty>${friend || pr.public ? 'No posts yet' : 'This profile is private'}</div>`}</div></div>`;
    const f = view.el.querySelector('#ec-fo'); if (f) f.onclick = () => { const l = follows(); LS.set('follow', fo ? l.filter(x => x !== pk) : [...l, pk]); subscribe(); paint(); A.toast(fo ? 'Unfollowed' : 'Following ' + nameOf(pk)); };
    const m = view.el.querySelector('#ec-msg'); if (m) m.onclick = () => A.openMurmur && A.openMurmur(pk);
  }
  async function loadImg(img) { try { const meta = JSON.parse(img.dataset.img); const u = await M.mediaUrl(meta); if (u) img.src = u; else img.alt = 'Photo unavailable'; } catch {} }
  function more(x, y, p) { A.haptic && A.haptic();
    document.querySelector('.hm-menu')?.remove(); const m = document.createElement('div'); m.className = 'hm-menu';
    const sv = saved().includes(p.id), pinned = prof()?.pin === p.id;
    m.innerHTML = `<button class=i data-a=save>${sv ? 'Unsave' : '🔖 Save'}</button>${p.aud === 'public' || isFriend(p.pk) || p.pk === me() ? '<button class=i data-a=quote>❝ Quote</button>' : ''}${p.pk === me() && !p.moment && !p.reply ? `<button class=i data-a=pin>${pinned ? 'Unpin from profile' : '📌 Pin to profile'}</button>` : ''}${p.pk === me() ? '<button class=i data-a=del>Delete post</button>' : `<button class=i data-a=msg>Message ${esc(nameOf(p.pk))}</button><button class=i data-a=block>Block ${esc(nameOf(p.pk))}</button>`}<button class=i data-a=copy>Copy text</button>`;
    document.body.append(m); const r = m.getBoundingClientRect(); m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px'; m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
    const off = e => { if (!m.contains(e.target)) { m.remove(); removeEventListener('pointerdown', off, true); } }; setTimeout(() => addEventListener('pointerdown', off, true), 0);
    m.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => { m.remove(); const a = b.dataset.a;
      if (a === 'del' && confirm('Delete this post for everyone?')) remove(p);
      if (a === 'save') { LS.set('saved', sv ? saved().filter(x => x !== p.id) : [p.id, ...saved()].slice(0, 500)); A.toast(sv ? 'Removed from Saved' : '🔖 Saved — find it in Me → Saved'); paint(); }
      if (a === 'quote') go('compose', { replyTo: null, quote: p.id, moment: false, poll: null, aud: p.aud === 'public' ? null : 'friends' });
      if (a === 'pin') { LS.set('me', { ...prof(), pin: pinned ? null : p.id }); publishProfile(); A.toast(pinned ? 'Unpinned' : '📌 Pinned to your profile'); paint(); }
      if (a === 'msg') A.openMurmur && A.openMurmur(p.pk);
      if (a === 'copy') { try { await navigator.clipboard.writeText(p.text); A.toast('Copied'); } catch {} }
      if (a === 'block' && confirm('Block ' + nameOf(p.pk) + '? You won’t see their posts or messages.')) { const c = M.contacts(); c[p.pk] = { ...(c[p.pk] || {}), blocked: true }; localStorage.setItem('hush.msg.contacts', JSON.stringify(c)); LS.set('follow', follows().filter(z => z !== p.pk)); paint(); } }); }
  function wire() {
    const el = view.el;
    el.querySelectorAll('[data-close]').forEach(b => b.onclick = () => A.close && A.close());
    el.querySelectorAll('[data-back]').forEach(b => b.onclick = () => { if (view.screen === 'circles' && view.circle != null) { view.circle = null; return paint(); }
      if (view.screen === 'compose') Object.assign(view, { moment: false, pageUrl: null, poll: null, quote: null });
      const back = view.screen === 'circles' && view.fromCompose ? 'compose' : null; if (back) { view.fromCompose = false; return go('compose'); } go(view.screen === 'compose' && view.replyTo ? 'post' : null, view.screen === 'compose' && view.replyTo ? { id: view.replyTo, replyTo: null } : { replyTo: null }); });
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => go(null, { tab: b.dataset.tab }));
    el.querySelectorAll('[data-compose]').forEach(b => b.onclick = () => go('compose', { replyTo: null, draft: null, quote: null }));
    el.querySelectorAll('[data-mnew]').forEach(b => b.onclick = () => go('compose', { replyTo: null, moment: true, quote: null, poll: null }));
    el.querySelectorAll('[data-moment]').forEach(b => b.onclick = () => go('moment', { mpk: b.dataset.moment, mi: (() => { const l = momentsBy()[b.dataset.moment] || [], sn = new Set(LS.get('mseen', [])), i = l.findIndex(x => !sn.has(x.id)); return i < 0 ? 0 : i; })() }));
    el.querySelectorAll('[data-caught]').forEach(b => b.onclick = () => { view.catch = null; paint(); });
    el.querySelectorAll('[data-pagenotes]').forEach(b => b.onclick = () => go('page', { pageUrl: null }));
    el.querySelectorAll('[data-pagenote]').forEach(b => b.onclick = () => { const pg = A.page && A.page(); if (!pg) return A.toast('Open a page first'); go('compose', { replyTo: null, pageUrl: pg.url, moment: false }); });
    el.querySelectorAll('[data-circles]').forEach(b => b.onclick = () => { view.fromCompose = view.screen === 'compose'; go('circles', { circle: view.fromCompose ? '' : null }); });
    el.querySelectorAll('[data-ptab]').forEach(b => b.onclick = () => { view.ptab = b.dataset.ptab; paint(); });
    el.querySelectorAll('.ec-grid img').forEach(loadImg);
    el.querySelectorAll('[data-comm]').forEach(b => b.onclick = e => { e.stopPropagation(); const c = b.dataset.comm, l = LS.get('comms', []); if (c && !l.includes(c)) LS.set('comms', [...l, c]); go(null, { tab: 'explore', comm: c || null }); });
    el.querySelectorAll('[data-commnew]').forEach(b => b.onclick = () => { const n = (prompt('Community name — e.g. gardening, jaguars, retro-games') || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 30); if (n.length < 2) return; const l = LS.get('comms', []); if (!l.includes(n)) LS.set('comms', [...l, n]); go(null, { tab: 'explore', comm: n }); A.toast('◆ Joined ' + n + ' — public posts tagged to it show here'); });
    el.querySelectorAll('[data-pack]').forEach(b => b.onclick = () => { const k = LS.get('packs', {})[b.dataset.pack]; if (!k) return; const fo = follows(), add = k.people.filter(x => x !== me() && !fo.includes(x));
      if (!add.length) return A.toast('You already follow everyone in this pack'); if (!confirm(`Follow ${add.length} people from “${k.name}”?`)) return; LS.set('follow', [...fo, ...add]); subscribe(); A.toast('★ Following ' + add.length + ' people'); });
    el.querySelectorAll('[data-packnew]').forEach(b => b.onclick = () => { if (!prof()?.public) return A.toast('Turn on your public profile to share a starter pack');
      const ppl = follows().filter(x => profiles()[x]?.public); if (ppl.length < 2) return A.toast('Follow at least 2 public people first — a pack is made from who you follow');
      const name = (prompt('Name your starter pack — e.g. “Best gardening accounts”') || '').trim().slice(0, 60); if (!name) return;
      M.broadcast(M.sign({ kind: K_PACK, content: '', tags: [['d', Math.random().toString(36).slice(2, 10)], ['title', name], ...ppl.slice(0, 150).map(x => ['p', x])] })); A.toast('★ Starter pack shared with ' + ppl.length + ' people'); view.explored = false; paint(); });
    el.querySelectorAll('[data-swipe]').forEach(b => b.onclick = () => swipe());
    el.querySelectorAll('[data-algo]').forEach(b => b.onclick = () => tuneUI());
    el.querySelectorAll('[data-vote]').forEach(b => b.onclick = e => { e.stopPropagation(); const p = posts()[b.closest('.ec-post')?.dataset.p]; if (p) vote(p, +b.dataset.vote); });
    el.querySelectorAll('[data-replyto]').forEach(b => b.onclick = () => go('compose', { replyTo: b.dataset.replyto }));
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => go('edit'));
    el.querySelectorAll('[data-ocat]').forEach(b => b.onclick = () => { view.ocat = b.dataset.ocat; paint(); });
    el.querySelectorAll('[data-ofollow]').forEach(b => b.onclick = e => { e.stopPropagation(); const a = b.dataset.ofollow, l = openAcc();
      openSet(l.includes(a) ? l.filter(x => x !== a) : [...l, a]); A.toast(l.includes(a) ? 'Unfollowed' : 'Following — their posts show in your Home feed'); paint(); });
    el.querySelectorAll('[data-oadd]').forEach(b => b.onclick = async () => {
      const v = (prompt('Add a Bluesky or Mastodon account:\n• Bluesky: nytimes.com or name.bsky.social\n• Mastodon: name@mastodon.social') || '').trim().replace(/^@/, ''); if (!v) return;
      const acc = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? 'masto:' + v : /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) ? 'bsky:' + v.toLowerCase() : null;
      if (!acc) return A.toast('That doesn’t look like a Bluesky or Mastodon handle');
      try { A.toast('Looking it up through Tor…'); const l = await openFetch(acc); if (!l.length) throw new Error('no posts');
        const all = openPosts(); for (const x of l) all[x.id] = x; LS.set('openPosts', all); openSet([...openAcc(), acc]); view.ocat = 'Following'; A.toast('Following ' + v); paint(); }
      catch (e) { A.toast(/allowed/.test(String(e)) ? 'That Mastodon server isn’t supported yet — try a big one like mastodon.social' : 'Couldn’t find that account'); } });
    el.querySelectorAll('[data-u]').forEach(a => a.onclick = e => { e.preventDefault(); e.stopPropagation(); A.open(a.dataset.u); });
    el.querySelectorAll('[data-tag]').forEach(a => a.onclick = e => { e.preventDefault(); e.stopPropagation(); view.q = a.dataset.tag; view.results = 'loading'; go(null, { tab: 'search' }); search(view.q, () => { view.results = 'done'; paint(); }); });
    el.querySelectorAll('[data-pk]').forEach(a => a.onclick = e => { e.stopPropagation(); go('person', { pk: a.dataset.pk }); });
    el.querySelectorAll('[data-open]').forEach(a => a.onclick = e => { e.stopPropagation(); if (posts()[a.dataset.open]) go('post', { id: a.dataset.open }); else if (a.classList.contains('ec-q')) A.toast('The original post isn’t on this device'); });
    el.querySelectorAll('img.ec-img').forEach(loadImg);
    el.querySelectorAll('.ec-post').forEach(c => { const p = posts()[c.dataset.p]; if (!p) return;
      c.onclick = e => { if (e.target.closest('a,button,[data-pk]')) return; go('post', { id: p.id }); };
      c.querySelectorAll('[data-a]').forEach(b => b.onclick = e => { e.stopPropagation(); const a = b.dataset.a;
        if (a === 'like') like(p); else if (a === 'reply') go('compose', { replyTo: p.id }); else if (a === 'repost') repost(p); else if (a === 'more') more(e.clientX, e.clientY, p); }); });
  }
  // Boot (after Murmur): listen for friends' private Echo posts; refresh public subscriptions; backup support.
  M.onEcho(onPrivate);
  M.onReset(() => { for (const k of ['me', 'posts', 'profiles', 'follow', 'notif', 'shared', 'kept', 'circles', 'saved', 'mseen', 'seenAt']) localStorage.removeItem('hush.echo.' + k); badge(); });
  M.onBackup(async () => ({ echo: { me: prof(), follow: follows(), circles: circles(), saved: saved(), posts: Object.fromEntries(Object.entries(posts()).filter(([, p]) => p.pk === me())) } }),
    async x => { if (!x.echo) return; if (x.echo.me) LS.set('me', x.echo.me); if (x.echo.follow) LS.set('follow', x.echo.follow); if (x.echo.circles) LS.set('circles', x.echo.circles); if (x.echo.saved) LS.set('saved', x.echo.saved); if (x.echo.posts) LS.set('posts', { ...posts(), ...x.echo.posts }); LS.set('shared', []); });
  async function boot() { if (!N || !await M.ready()) return; badge(); if (prof()) setTimeout(() => { subscribe(); keepAlive(); }, 4000); }
  function openPage(el) { view.screen = 'page'; view.pageUrl = null; return open(el); }
  return { open, close, boot, unread, notesFor: u => (prof() ? notesFor(u) : []), openPage };
};
