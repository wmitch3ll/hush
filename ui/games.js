// Murmur games: Chess, Battleship and a timed Word Race you play with a friend, one move at a time, right inside the chat.
// Every move is a small end-to-end encrypted message (same path as a text). Both phones keep the game, check every move
// against the rules, and agree on the result - there is no game server.
(function () {
  'use strict';
  const C = window.HUSH_GAMES_CORE, { Chess, Sea, Word } = C;
  const G = window.HUSH_GAMES = {};
  let H = null;           // host adapter, set by messenger.js
  let S = null;           // { [gameId]: game }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => Date.now();
  const TYPES = { chess: 'Chess', sea: 'Battleship', word: 'Word race' };

  // ---------------------------------------------------------------- small SHA-256 (synchronous, so rules checks stay simple)
  const K256 = [], H256 = [];
  (() => { let n = 2, c = 0; const prime = x => { for (let i = 2; i * i <= x; i++) if (x % i === 0) return false; return true; };
    while (c < 64) { if (prime(n)) { if (c < 8) H256[c] = (Math.pow(n, .5) % 1) * 4294967296 | 0; K256[c] = (Math.cbrt(n) % 1) * 4294967296 | 0; c++; } n++; } })();
  function sha256(str) {
    const b = new TextEncoder().encode(str), l = b.length, w = new Uint32Array(64), h = H256.slice();
    const n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n); m.set(b); m[l] = 0x80; const dv = new DataView(m.buffer); dv.setUint32(n - 4, l * 8 >>> 0); dv.setUint32(n - 8, Math.floor(l * 8 / 4294967296));
    const R = (x, k) => (x >>> k) | (x << (32 - k));
    for (let o = 0; o < n; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) { const s0 = R(w[i - 15], 7) ^ R(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = R(w[i - 2], 17) ^ R(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
      let [a, b2, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) { const S1 = R(e, 6) ^ R(e, 11) ^ R(e, 25), ch = (e & f) ^ (~e & g), t1 = (hh + S1 + ch + K256[i] + w[i]) | 0, S0 = R(a, 2) ^ R(a, 13) ^ R(a, 22), mj = (a & b2) ^ (a & c) ^ (b2 & c), t2 = (S0 + mj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b2; b2 = a; a = (t1 + t2) | 0; }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b2) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    return h.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
  G._sha = sha256; G._send = (id, k, d) => { const g = S && S[id]; return g ? sendMsg(g, k, d) : false; };
  const rnd = (n = 16) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, x => x.toString(16).padStart(2, '0')).join(''); };

  // ---------------------------------------------------------------- store
  function load() { if (!S) { S = H.get() || {}; const cut = now() - 60 * 864e5; for (const id in S) if (S[id].status !== 'play' && S[id].status !== 'invite' && S[id].upd < cut) delete S[id]; } return S; }
  const save = () => { try { H.set(S); } catch {} };
  const me = () => H.me();
  const opp = g => g.key;
  const peerName = g => H.name(g.key);
  const isHost = g => g.host === me();
  const other = (g, pk) => pk === me() ? g.key : me();

  G.init = host => { H = host; S = null; try { css(); } catch {} };
  G.reset = () => { S = null; try { H && H.set({}); } catch {} document.querySelector('.gm-ov')?.remove(); };
  G.get = id => load()[id];
  G.active = key => Object.values(load()).filter(g => g.key === key && (g.status === 'play' || g.status === 'invite'));

  // ---------------------------------------------------------------- messages
  // A message is { g: id, s: sequence number from this sender, k: kind, d: data, y: game type (invite only) }.
  const ok = {
    id: x => typeof x === 'string' && /^[0-9a-f]{16}$/.test(x),
    hex: (x, n) => typeof x === 'string' && new RegExp('^[0-9a-f]{' + n + '}$').test(x)
  };
  function create(key, type, host, id, seed, opt) {
    const g = { id, type, key, host, seed, opt: opt || {}, status: 'invite', at: now(), upd: now(), tx: 0, rx: {}, buf: {}, end: null };
    if (type === 'chess') { g.st = Chess.init(); g.moves = []; g.sans = []; g.seen = {}; g.seen[Chess.key(g.st)] = 1; g.draw = null; }
    if (type === 'sea') { g.me = { board: null, salt: null, h: null }; g.they = { h: null }; g.shots = {}; g.res = {}; g.sunk = {}; g.phase = 'place'; g.turn = null; g.await = null; g.cheat = null; g.revealed = false; }
    if (type === 'word') { g.word = null; g.sb = null; g.mine = { gs: [], pat: [], start: 0, fin: null }; g.th = { pat: [], fin: null }; }
    load()[id] = g; return g;
  }
  const colorOf = (g, pk) => ((parseInt(g.seed[0], 16) & 1) ? (pk === g.host ? 'w' : 'b') : (pk === g.host ? 'b' : 'w'));
  const wordFor = (sa, sb) => { const A = window.HUSH_WORDS.a, n = A.length / 5, i = parseInt(sha256(sa + ':' + sb).slice(0, 8), 16) % n; return A.slice(i * 5, i * 5 + 5); };
  let validSet = null;
  const isWord = w => { if (!validSet) { validSet = new Set(); const W = window.HUSH_WORDS; for (const s of [W.a, W.v]) for (let i = 0; i < s.length; i += 5) validSet.add(s.slice(i, i + 5)); } return validSet.has(w); };

  function finish(g, why, winner) { g.status = 'done'; g.end = { why, w: winner || null, at: now() }; g.upd = now(); }

  // Apply one message from `from` to game g. Returns null if the message is not allowed, otherwise a short note ('' if nothing to tell the user).
  function apply(g, from, k, d) {
    const mine = from === me(), meN = me();
    if (g.status === 'done' && k === 'rv' && g.type === 'sea') return applySea(g, from, k, d);
    if (g.status === 'done' || g.status === 'declined' || g.status === 'cancelled') return null;
    if (k === 'dec') { if (mine === isHost(g) || g.status !== 'invite') return null; g.status = 'declined'; g.upd = now(); return TYPES[g.type] + ' challenge declined'; }
    if (k === 'can') { if (from !== g.host || g.status !== 'invite') return null; g.status = 'cancelled'; g.upd = now(); return 'Challenge cancelled'; }
    if (k === 'rsn') { if (g.status !== 'play') return null; finish(g, 'resign', other(g, from)); return mine ? '' : H.name(from) + ' resigned'; }
    if (k === 'acc') {
      if (g.status !== 'invite' || from === g.host) return null;
      if (g.type === 'word') { if (!ok.hex(d && d.sb, 16)) return null; g.sb = d.sb; g.word = wordFor(g.seed, g.sb); }
      g.status = 'play'; g.upd = now();
      if (g.type === 'sea') g.phase = 'place';
      return mine ? '' : H.name(from) + ' accepted your ' + TYPES[g.type] + ' challenge';
    }
    if (g.status !== 'play') return null;
    if (g.type === 'chess') return applyChess(g, from, k, d);
    if (g.type === 'sea') return applySea(g, from, k, d);
    if (g.type === 'word') return applyWord(g, from, k, d);
    return null;
  }

  function applyChess(g, from, k, d) {
    const mine = from === me();
    if (k === 'mv') {
      if (typeof d !== 'string' || colorOf(g, from) !== g.st.t) return null;
      const m = Chess.parse(g.st, d); if (!m) return null;
      g.sans.push(Chess.san(g.st, m)); g.moves.push(d); g.st = Chess.make(g.st, m); g.draw = null; g.upd = now();
      const kk = Chess.key(g.st); g.seen[kk] = (g.seen[kk] || 0) + 1;
      const st = Chess.status(g.st);
      if (st === 'mate') finish(g, 'mate', from); else if (st === 'stalemate' || st === 'material' || st === 'fifty') finish(g, st, null); else if (g.seen[kk] >= 3) finish(g, 'rep', null);
      if (g.status === 'done') return mine ? '' : (g.end.w ? 'Checkmate - ' + H.name(from) + ' wins' : 'Chess ended in a draw');
      return mine ? '' : (st === 'check' ? 'Check! Your move in Chess' : 'Your move in Chess');
    }
    if (k === 'dro') { if (g.draw) return null; g.draw = from; g.upd = now(); return mine ? '' : H.name(from) + ' offers a draw'; }
    if (k === 'dra') { if (!g.draw || g.draw === from) return null; finish(g, 'draw', null); return mine ? '' : 'Draw agreed'; }
    if (k === 'drd') { if (!g.draw || g.draw === from) return null; g.draw = null; g.upd = now(); return mine ? '' : 'Draw declined'; }
    return null;
  }

  // Battleship: each player commits to a hidden fleet (a hash), then they take turns. The defender's phone answers every shot by itself.
  // At the end the fleet is revealed and checked against the commitment and every answer given, so nobody can cheat by moving ships.
  function checkFleet(g, who, board, salt) {
    const theirs = who === me() ? g.me : g.they;
    if (!Sea.valid(board) || !ok.hex(salt, 32) || sha256(Sea.pack(board, salt)) !== theirs.h) return false;
    const shooter = other(g, who), mineShots = g.shots[shooter] || [], seen = [];
    for (const i of mineShots) { const r = Sea.shoot(board, seen, i), rec = (g.res[shooter] || {})[i];
      if (rec && (rec.r !== r.r || (r.r === 'sunk' && rec.n !== r.n))) return false; seen.push(i); }
    return true;
  }
  function applySea(g, from, k, d) {
    const mine = from === me();
    if (k === 'rdy') {
      if (g.phase !== 'place' || !ok.hex(d && d.h, 64)) return null; const t = mine ? g.me : g.they; if (t.ready) return null;
      if (mine && !(g.me.board && Sea.valid(g.me.board))) return null; t.h = d.h; t.ready = true;
      if (g.me.ready && g.they.ready) { g.phase = 'battle'; g.turn = g.host; return g.turn === me() ? 'Battleship: fleets are set - you fire first' : 'Battleship: fleets are set'; }
      return mine ? '' : H.name(from) + ' has placed their fleet';
    }
    if (g.phase !== 'battle' && k !== 'rv') return null;
    if (k === 'sh') {
      if (g.turn !== from || g.await || !Number.isInteger(d) || d < 0 || d > 99) return null; const L = g.shots[from] || (g.shots[from] = []); if (L.includes(d)) return null;
      L.push(d); g.await = { by: from, i: d }; g.upd = now();
      if (!mine) { const r = Sea.shoot(g.me.board, g.shots[from].slice(0, -1), d); setTimeout(() => { try { G._answer(g, d, r); } catch {} }, 0); return ''; }
      return '';
    }
    if (k === 'rs') {
      if (!g.await || g.await.by === from || !d || d.i !== g.await.i || !['miss', 'hit', 'sunk'].includes(d.r)) return null;
      const by = g.await.by; if (d.r === 'sunk' && (!Number.isInteger(d.n) || d.n < 0 || d.n > 4 || (g.sunk[by] || []).includes(d.n))) return null;
      const cnt = (g.sunk[by] || []).length + (d.r === 'sunk' ? 1 : 0), over = cnt === 5; if (!!d.end !== over) return null;
      (g.res[by] || (g.res[by] = {}))[d.i] = { r: d.r, n: d.r === 'sunk' ? d.n : undefined };
      if (d.r === 'sunk') (g.sunk[by] || (g.sunk[by] = [])).push(d.n);
      g.await = null; g.upd = now();
      if (over) {
        if (by === me()) { const good = checkFleet(g, from, d.b, d.sa); if (!good) g.cheat = from; }
        finish(g, g.cheat ? 'cheat' : 'fleet', by); g.turn = null; g.revealed = true;
        if (by === me() && g === S[g.id]) setTimeout(() => { try { sendMsg(g, 'rv', { b: g.me.board, sa: g.me.salt }); } catch {} }, 60);
        return by === me() ? '' : 'Battleship: ' + H.name(from) + ' sank your last ship - ' + H.name(by) + ' wins';
      }
      g.turn = from;
      const msg = d.r === 'sunk' ? 'sank your ' + Sea.SHIPS[d.n].n.toLowerCase() : d.r;
      return by === me() ? (from === me() ? '' : '') : 'Battleship: ' + H.name(by) + ' fired - ' + (d.r === 'miss' ? 'a miss' : d.r === 'hit' ? 'a hit' : 'they sank your ' + Sea.SHIPS[d.n].n.toLowerCase()) + '. Your turn';
    }
    if (k === 'rv') {
      if (!(g.status === 'done' && g.end && g.end.w === from) || g.revealed2) return null; g.revealed2 = true;
      if (!mine && !checkFleet(g, from, d && d.b, d && d.sa)) { g.cheat = from; g.end.why = 'cheat'; }
      return '';
    }
    return null;
  }
  // The defending phone answers a shot automatically.
  G._answer = (g, i, r) => {
    const out = { i, r: r.r }; if (r.r === 'sunk') out.n = r.n;
    if (r.over) { out.end = 1; out.b = g.me.board; out.sa = g.me.salt; }
    sendMsg(g, 'rs', out);
  };

  function applyWord(g, from, k, d) {
    const mine = from === me();
    if (k === 'gs') { if (mine) return ''; if (typeof d !== 'string' || !/^[012]{5}$/.test(d) || g.th.pat.length >= 6 || g.th.fin) return null; g.th.pat.push(d); g.upd = now(); return ''; }
    if (k === 'fin') {
      const t = mine ? g.mine : g.th; if (t.fin) return null;
      if (!d || !Array.isArray(d.gs) || d.gs.length > 6 || !Number.isInteger(d.ms) || d.ms < 0) return null;
      let good = d.gs.every((w, i) => typeof w === 'string' && /^[a-z]{5}$/.test(w) && isWord(w));
      const solved = good && d.gs.length > 0 && d.gs[d.gs.length - 1] === g.word && d.gs.slice(0, -1).every(w => w !== g.word);
      if (d.solved !== undefined && !!d.solved !== solved) good = false;
      const fin = { solved: good && solved, n: d.gs.length, ms: Math.min(d.ms, (g.opt.secs || 180) * 1000), gs: good ? d.gs : [], bad: !good };
      t.fin = fin; if (!mine) g.th.pat = good ? d.gs.map(w => Word.score(w, g.word)) : g.th.pat; g.upd = now();
      if (g.mine.fin && g.th.fin) {
        const r = Word.winner(g.mine.fin, g.th.fin), w = r === 'a' ? me() : r === 'b' ? g.key : null;
        finish(g, g.th.fin.bad ? 'cheat' : r === 'none' ? 'nobody' : r === 'tie' ? 'tie' : 'race', w);
        return mine ? '' : 'Word race result: ' + (w === me() ? 'you won' : w ? H.name(w) + ' won' : 'a draw');
      }
      return mine ? '' : H.name(from) + ' finished their word - ' + (fin.solved ? 'solved it in ' + fin.n : 'did not solve it');
    }
    return null;
  }

  function sendMsg(g, k, d) {
    const s = g.tx + 1;
    if (k === 'inv') { g.tx = 1; g.rx[me()] = 1; save(); H.send(g.key, { g: g.id, s: 1, k, d, y: g.type, sd: g.seed, o: g.opt }); H.repaint(); return true; }
    // Apply to a throwaway copy first so an illegal move is never sent.
    const probe = JSON.parse(JSON.stringify(g)); if (apply(probe, me(), k, d) === null) return false;
    g.tx = s; g.rx[me()] = s; const note = apply(g, me(), k, d); g.upd = now(); save();
    H.send(g.key, { g: g.id, s, k, d });
    refresh(g); H.repaint(); return note !== null;
  }

  // Incoming (or an echo from my other device). Returns { card, notify } for the chat to show, or null.
  G.recv = (key, from, text, mineEcho) => {
    load(); let p; try { p = JSON.parse(text); } catch { return null; }
    if (!p || !ok.id(p.g) || !Number.isInteger(p.s) || p.s < 1 || typeof p.k !== 'string' || p.k.length > 4) return null;
    if (JSON.stringify(p).length > 6000) return null;
    let g = S[p.g];
    if (p.k === 'inv') {
      if (g || !TYPES[p.y] || !ok.hex(p.sd, 16) || p.s !== 1) return null;
      if (!mineEcho && Object.values(S).filter(x => x.key === key && x.status === 'invite' && x.host === from).length >= 5) return null;
      const opt = {}; if (p.y === 'word') opt.secs = [120, 180, 300].includes(p.o && p.o.secs) ? p.o.secs : 180;
      g = create(key, p.y, from, p.g, p.sd, opt); g.tx = mineEcho ? 1 : 0; g.rx[from] = 1; save();
      return { card: true, notify: mineEcho ? '' : H.name(from) + ' challenged you to ' + TYPES[p.y] };
    }
    if (!g || g.key !== key || (from !== g.key && from !== me())) return null;
    const want = (g.rx[from] || 0) + 1;
    if (p.s < want) return null;
    (g.buf[from] || (g.buf[from] = {}))[p.s] = { k: p.k, d: p.d };
    let note = '', any = false;
    for (let guard = 0; guard < 400; guard++) {
      const nx = (g.rx[from] || 0) + 1, m = g.buf[from] && g.buf[from][nx]; if (!m) break;
      delete g.buf[from][nx]; g.rx[from] = nx;
      if (from === me() && nx <= g.tx) continue;          // my own message that I already applied here
      if (from === me()) g.tx = nx;
      const r = apply(g, from, m.k, m.d); if (r === null) continue; any = true; if (r) note = r;
    }
    if (!any) { save(); return null; }
    save(); refresh(g);
    return { card: false, notify: from === me() ? '' : note, changed: true };
  };

  // ---------------------------------------------------------------- starting and answering challenges
  G.start = (key, type, opt) => {
    if (!TYPES[type]) return;
    if (G.active(key).length >= 4) return H.toast('Finish or cancel one of your current games first');
    load(); const id = rnd(8), seed = rnd(8), o = {}; if (type === 'word') o.secs = [120, 180, 300].includes(opt && opt.secs) ? opt.secs : 180;
    const g = create(key, type, me(), id, seed, o); g.tx = 0;
    sendMsg(g, 'inv', {}); H.toast('Challenge sent'); G.open(id);
  };
  G.answer = (id, yes) => { const g = G.get(id); if (!g) return;
    if (yes) { const d = g.type === 'word' ? { sb: rnd(8) } : {}; sendMsg(g, 'acc', d); G.open(id); } else sendMsg(g, 'dec', {}); };
  G.cancel = id => { const g = G.get(id); if (g) sendMsg(g, 'can', {}); };

  // ---------------------------------------------------------------- chat card
  const pieceSvg = (ch, cls = '') => {
    const w = Chess.white(ch), k = ch.toLowerCase();
    const P = {
      p: '<circle cx="22.5" cy="13.5" r="5.2"/><path d="M16.5 34c0-7 2.4-10.4 6-12.2 3.6 1.8 6 5.2 6 12.2z"/><rect x="12.5" y="33.5" width="20" height="4.5" rx="2.2"/>',
      r: '<path d="M13.5 38h18v-4.5h-18zM15.5 33.5v-14h14v14zM12.5 19.5v-9h4.2v3h3.4v-3h4.8v3h3.4v-3h4.2v9z"/>',
      n: '<path d="M13 38c0-9 3-14 8-18-3.4.8-5.2 2.6-8 4.4L11 20.5l8.6-11c3.4-2 6.6-.6 9 3 4.4 4.4 6.4 12.6 6.4 25.5z"/><circle cx="21" cy="15.5" r="1.4" class="eye"/>',
      b: '<path d="M22.5 6.5c-1.8 1.8-1.4 3.4 0 4.6-4.6 3-7.6 7.6-7.6 12.6 0 3 1.8 5 3 6.2h9.2c1.2-1.2 3-3.2 3-6.2 0-5-3-9.6-7.6-12.6 1.4-1.2 1.8-2.8 0-4.6z"/><rect x="12.5" y="30.5" width="20" height="3.2" rx="1.6"/><rect x="14.5" y="34" width="16" height="4" rx="2"/><path d="M19.8 17.5h5.4M22.5 14.8v5.4" class="cut"/>',
      q: '<path d="M11.5 34 9.6 14.6l7.2 9 5.7-12.6 5.7 12.6 7.2-9L33.5 34z"/><circle cx="9.6" cy="13" r="2.3"/><circle cx="16.8" cy="9.6" r="2.3"/><circle cx="22.5" cy="8" r="2.3"/><circle cx="28.2" cy="9.6" r="2.3"/><circle cx="35.4" cy="13" r="2.3"/><rect x="11" y="33.5" width="23" height="4.5" rx="2.2"/>',
      k: '<path d="M20.9 5h3.2v3.2h3.2v3.2h-3.2v3.2h-3.2v-3.2h-3.2V8.2h3.2z"/><path d="M11.5 34c-1-9 2-14 11-14s12 5 11 14z"/><rect x="10.5" y="33.5" width="24" height="4.5" rx="2.2"/>'
    };
    return `<svg viewBox="0 0 45 45" class="gm-pc ${w ? 'gw' : 'gb'} ${cls}" aria-hidden="true">${P[k]}</svg>`;
  };
  const GICON = {
    chess: pieceSvg('N'),
    sea: '<svg viewBox="0 0 45 45" class="gm-pc gi"><path d="M6 27h33l-5 8H12z"/><path d="M20 10h5v11h-5zM12 21h21v6H12z"/></svg>',
    word: '<svg viewBox="0 0 45 45" class="gm-pc gi"><rect x="5" y="14" width="10" height="10" rx="2"/><rect x="17.5" y="14" width="10" height="10" rx="2" opacity=".6"/><rect x="30" y="14" width="10" height="10" rx="2" opacity=".35"/><rect x="5" y="27" width="10" height="10" rx="2" opacity=".35"/><rect x="17.5" y="27" width="10" height="10" rx="2"/></svg>'
  };
  // One line telling the user where the game stands.
  G.summary = g => {
    if (!g) return { line: 'Game no longer available', hot: false };
    const nm = peerName(g);
    if (g.status === 'invite') return isHost(g) ? { line: 'Waiting for ' + nm + ' to accept', hot: false } : { line: nm + ' challenged you', hot: true, ask: true };
    if (g.status === 'declined') return { line: 'Challenge declined', hot: false };
    if (g.status === 'cancelled') return { line: 'Challenge cancelled', hot: false };
    if (g.status === 'done') {
      const w = g.end && g.end.w, why = g.end && g.end.why;
      const t = why === 'cheat' ? 'Game stopped: a move or fleet did not check out' : !w ? (why === 'nobody' ? 'Nobody found the word' : 'Draw') : w === me() ? 'You won' : nm + ' won';
      return { line: t, hot: false, done: true };
    }
    if (g.type === 'chess') { const my = colorOf(g, me()) === g.st.t; return { line: my ? (Chess.inCheck(g.st) ? 'Check - your move' : 'Your move') : 'Waiting for ' + nm, hot: my }; }
    if (g.type === 'sea') {
      if (g.phase === 'place') return g.me.ready ? { line: 'Waiting for ' + nm + ' to place their fleet', hot: false } : { line: 'Place your fleet', hot: true };
      return g.turn === me() ? { line: 'Your shot', hot: true } : { line: 'Waiting for ' + nm, hot: false };
    }
    if (g.type === 'word') {
      if (!g.mine.fin) return { line: g.mine.start ? 'In progress - ' + (g.opt.secs / 60) + ' min race' : 'Ready when you are - ' + (g.opt.secs / 60) + ' min', hot: true };
      return { line: 'Waiting for ' + nm + ' to finish', hot: false };
    }
    return { line: '', hot: false };
  };
  G.card = id => {
    css();
    const g = G.get(id); const s = G.summary(g);
    if (!g) return `<div class="gm-card"><div class="gm-ci">${GICON.chess}</div><div class="gm-ct"><b>Game</b><span>${esc(s.line)}</span></div></div>`;
    const btns = s.ask ? `<div class="gm-cb"><button data-ga="acc" data-gid="${id}" class="gm-b pri">Accept</button><button data-ga="dec" data-gid="${id}" class="gm-b">Decline</button></div>`
      : (g.status === 'invite' && isHost(g)) ? `<div class="gm-cb"><button data-ga="can" data-gid="${id}" class="gm-b">Cancel</button></div>`
      : (g.status === 'play' || s.done) ? `<div class="gm-cb"><button data-ga="open" data-gid="${id}" class="gm-b ${s.hot ? 'pri' : ''}">${s.done ? 'View' : s.hot ? 'Play' : 'Open'}</button></div>` : '';
    return `<div class="gm-card ${s.hot ? 'hot' : ''}" data-gid="${id}" data-ga="open"><div class="gm-ci">${GICON[g.type]}</div><div class="gm-ct"><b>${TYPES[g.type]}</b><span>${esc(s.line)}</span></div>${btns}</div>`;
  };
  // Called by the chat after it paints: makes the cards tappable.
  G.wire = root => root.querySelectorAll('[data-ga]').forEach(el => {
    if (el.__gm) return; el.__gm = 1;
    el.onclick = e => { e.stopPropagation(); const id = el.dataset.gid, a = el.dataset.ga; if (a === 'open') G.open(id); else if (a === 'acc') G.answer(id, true); else if (a === 'dec') G.answer(id, false); else if (a === 'can') G.cancel(id); };
  });

  // ---------------------------------------------------------------- picker
  G.pick = key => {
    css();
    document.querySelector('.gm-sheet')?.remove();
    const el = document.createElement('div'); el.className = 'gm-sheet';
    let secs = 180;
    el.innerHTML = `<div class="gm-sc"><div class="gm-sh"><b>Play with ${esc(H.name(key))}</b><button class="gm-x" aria-label="Close">&times;</button></div>
      <button class="gm-opt" data-t="chess"><span class="gm-oi">${GICON.chess}</span><span><b>Chess</b><small>Full rules. Take your time - moves wait for them.</small></span></button>
      <button class="gm-opt" data-t="sea"><span class="gm-oi">${GICON.sea}</span><span><b>Battleship</b><small>Hidden fleets, checked at the end so nobody can cheat.</small></span></button>
      <button class="gm-opt" data-t="word"><span class="gm-oi">${GICON.word}</span><span><b>Word race</b><small>Same secret word, six guesses. Fewest guesses, then fastest, wins.</small></span></button>
      <div class="gm-seg" aria-label="Word race time"><span>Word race time</span><button data-s="120">2 min</button><button data-s="180" class="on">3 min</button><button data-s="300">5 min</button></div></div>`;
    document.body.append(el);
    el.onclick = e => { if (e.target === el) el.remove(); };
    el.querySelector('.gm-x').onclick = () => el.remove();
    el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { secs = +b.dataset.s; el.querySelectorAll('[data-s]').forEach(x => x.classList.toggle('on', x === b)); });
    el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { el.remove(); G.start(key, b.dataset.t, { secs }); });
  };

  // ---------------------------------------------------------------- game window
  let cur = null;       // { id, root, ui }
  const vib = n => { try { navigator.vibrate && navigator.vibrate(n); } catch {} };
  function refresh(g) { if (cur && cur.id === g.id) paint(); }
  G.open = id => {
    const g = G.get(id); if (!g) return; css();
    document.querySelector('.gm-ov')?.remove();
    const root = document.createElement('div'); root.className = 'gm-ov'; document.body.append(root);
    cur = { id, root, ui: {} }; if (g.type === 'word') cur.timer = setInterval(() => { if (cur && cur.id === id) tickWord(); else clearInterval(cur && cur.timer); }, 250);
    paint(true);
  };
  const closeGame = () => { if (cur) { clearInterval(cur.timer); cur.root.remove(); cur = null; document.removeEventListener('keydown', onKey); } H.repaint(); };
  G.close = closeGame;

  function shell(g, bodyHtml, foot) {
    const s = G.summary(g);
    return `<div class="gm-top"><button class="gm-back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><div class="gm-ti"><b>${TYPES[g.type]}</b><span>with ${esc(peerName(g))}</span></div><div class="gm-pill ${s.hot ? 'hot' : s.done ? 'done' : ''}">${esc(s.line)}</div></div>
      <div class="gm-body">${bodyHtml}</div>${foot ? `<div class="gm-foot">${foot}</div>` : ''}`;
  }
  function paint(first) {
    if (!cur) return; const g = G.get(cur.id); if (!g) return closeGame();
    const r = cur.root; let html;
    if (g.status === 'invite') html = shell(g, `<div class="gm-wait"><div class="gm-big">${GICON[g.type]}</div><h3>${isHost(g) ? 'Challenge sent' : 'Challenge received'}</h3><p>${isHost(g) ? esc(peerName(g)) + ' will see it in your chat. You can leave this screen - the game waits for them.' : esc(peerName(g)) + ' wants to play ' + TYPES[g.type] + '.'}</p></div>`,
      isHost(g) ? `<button class="gm-b" data-do="can">Cancel challenge</button>` : `<button class="gm-b pri" data-do="acc">Accept</button><button class="gm-b" data-do="dec">Decline</button>`);
    else if (g.status === 'declined' || g.status === 'cancelled') html = shell(g, `<div class="gm-wait"><div class="gm-big">${GICON[g.type]}</div><h3>${g.status === 'declined' ? 'Challenge declined' : 'Challenge cancelled'}</h3></div>`, `<button class="gm-b" data-do="close">Close</button>`);
    else if (g.type === 'chess') html = viewChess(g);
    else if (g.type === 'sea') html = viewSea(g);
    else html = viewWord(g);
    r.innerHTML = html; cur.root.className = 'gm-ov gm-t-' + g.type;
    r.querySelector('.gm-back').onclick = closeGame;
    r.querySelectorAll('[data-do]').forEach(b => b.onclick = () => doAct(g, b.dataset.do, b));
    if (g.type === 'chess' && g.status !== 'invite') wireChess(g, first);
    else if (g.type === 'sea' && g.status === 'play') wireSea(g);
    else if (g.type === 'word' && g.status !== 'invite') wireWord(g, first);
    document.removeEventListener('keydown', onKey); if (g.type === 'word') document.addEventListener('keydown', onKey);
  }
  function doAct(g, a, el) {
    if (a === 'close') return closeGame();
    if (a === 'acc') { sendMsg(g, 'acc', g.type === 'word' ? { sb: rnd(8) } : {}); return; }
    if (a === 'dec') { sendMsg(g, 'dec', {}); return closeGame(); }
    if (a === 'can') { sendMsg(g, 'can', {}); return closeGame(); }
    if (a === 'resign') { if (confirm('Resign this game?')) sendMsg(g, 'rsn', {}); return; }
    if (a === 'draw') { sendMsg(g, 'dro', {}); H.toast('Draw offered'); return; }
    if (a === 'drawy') return void sendMsg(g, 'dra', {});
    if (a === 'drawn') return void sendMsg(g, 'drd', {});
    if (a === 'rematch') { const t = g.type, o = g.opt, k = g.key; closeGame(); G.start(k, t, o); return; }
    if (a === 'flip') { cur.ui.flip = !cur.ui.flip; return paint(); }
  }

  // ---------------------------------------------------------------- chess view
  const CAP0 = { p: 8, n: 2, b: 2, r: 2, q: 1 }, VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  function captured(b) {
    const have = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    for (const ch of b) if (ch !== ' ' && ch.toLowerCase() !== 'k') have[Chess.white(ch) ? 'w' : 'b'][ch.toLowerCase()]++;
    const lost = { w: [], b: [] }; let diff = 0;
    for (const s of ['w', 'b']) for (const t of 'qrbnp') for (let i = have[s][t]; i < CAP0[t]; i++) { lost[s].push(t); }
    const mat = s => Object.keys(VAL).reduce((a, t) => a + VAL[t] * have[s][t], 0); diff = mat('w') - mat('b');
    return { lost, diff };
  }
  function viewChess(g) {
    const my = colorOf(g, me()), flip = cur.ui.flip ? my === 'w' : my === 'b', st = g.st, ui = cur.ui;
    const last = g.moves.length ? g.moves[g.moves.length - 1] : null, lf = last ? Chess.idx(last.slice(0, 2)) : -1, lt = last ? Chess.idx(last.slice(2, 4)) : -1;
    const legal = g.status === 'play' && st.t === my ? Chess.legal(st) : [];
    const targets = ui.sel != null ? legal.filter(m => m.f === ui.sel).map(m => m.t) : [];
    const chk = Chess.inCheck(st) && g.status !== 'invite' ? st.b.indexOf(st.t === 'w' ? 'K' : 'k') : -1;
    let sq = '';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const i = flip ? 63 - (r * 8 + c) : r * 8 + c, p = st.b[i], dark = ((i >> 3) + (i & 7)) & 1;
      const f = flip ? 7 - c : c, rk = flip ? r : 7 - r;
      sq += `<div class="gm-sq ${dark ? 'd' : 'l'}${i === lf || i === lt ? ' lm' : ''}${i === ui.sel ? ' sel' : ''}${i === chk ? ' chk' : ''}${targets.includes(i) ? (p !== ' ' ? ' cap' : ' tgt') : ''}" data-i="${i}">${c === 0 ? `<em class="rk">${rk + 1}</em>` : ''}${r === 7 ? `<em class="fl">${'abcdefgh'[f]}</em>` : ''}${p !== ' ' ? pieceSvg(p) : ''}</div>`;
    }
    const cp = captured(st.b), them = my === 'w' ? 'b' : 'w';
    const strip = (side, who) => { const lost = cp.lost[side === 'w' ? 'b' : 'w'], adv = side === 'w' ? cp.diff : -cp.diff;
      return `<div class="gm-pl"><b>${esc(who)}</b><span class="gm-cap">${lost.map(t => pieceSvg(side === 'w' ? t : t.toUpperCase(), 'sm')).join('')}${adv > 0 ? `<i>+${adv}</i>` : ''}</span></div>`; };
    const sans = g.sans.map((s, i) => `${i % 2 ? '' : `<u>${i / 2 + 1}.</u>`}<span>${esc(s)}</span>`).join('');
    let msg = '', foot = '';
    if (g.status === 'done') {
      const w = g.end.w, why = g.end.why;
      msg = `<div class="gm-end"><b>${why === 'mate' ? 'Checkmate' : why === 'resign' ? 'Resigned' : why === 'stalemate' ? 'Stalemate' : why === 'rep' ? 'Draw by repetition' : why === 'fifty' ? 'Draw - fifty moves' : why === 'material' ? 'Draw - not enough pieces' : 'Draw agreed'}</b><span>${!w ? 'The game is a draw.' : w === me() ? 'You win.' : esc(peerName(g)) + ' wins.'}</span></div>`;
      foot = `<button class="gm-b pri" data-do="rematch">Rematch</button><button class="gm-b" data-do="close">Close</button>`;
    } else {
      const myturn = st.t === my;
      if (g.draw && g.draw !== me()) { msg = `<div class="gm-end soft"><b>${esc(peerName(g))} offers a draw</b></div>`; foot = `<button class="gm-b pri" data-do="drawy">Accept draw</button><button class="gm-b" data-do="drawn">Decline</button>`; }
      else foot = `<button class="gm-b" data-do="flip">Flip board</button>${g.draw === me() ? '<button class="gm-b" disabled>Draw offered</button>' : '<button class="gm-b" data-do="draw">Offer draw</button>'}<button class="gm-b danger" data-do="resign">Resign</button>`;
      if (!msg) msg = `<div class="gm-turn ${myturn ? 'me' : ''}">${myturn ? (Chess.inCheck(st) ? 'Check - your move' : 'Your move') : 'Waiting for ' + esc(peerName(g)) + '...'}</div>`;
    }
    return shell(g, `${strip(them === 'w' ? 'w' : 'b', peerName(g))}<div class="gm-board-wrap"><div class="gm-board" id="gm-bd">${sq}</div><div class="gm-promo" id="gm-pr" hidden></div></div>${strip(my, 'You')}${msg}<div class="gm-moves" id="gm-mv">${sans || '<span class="gm-mute">No moves yet</span>'}</div>`, foot);
  }
  function wireChess(g, first) {
    const bd = cur.root.querySelector('#gm-bd'); if (!bd) return;
    const mv = cur.root.querySelector('#gm-mv'); if (mv) mv.scrollLeft = mv.scrollWidth;
    // Slide the piece that just moved.
    if (cur.ui.animFor !== g.moves.length && g.moves.length) {
      const last = g.moves[g.moves.length - 1]; if (cur.ui.animFor != null || !first) {
        const a = Chess.idx(last.slice(0, 2)), b = Chess.idx(last.slice(2, 4)), from = bd.querySelector(`[data-i="${a}"]`), to = bd.querySelector(`[data-i="${b}"]`), pc = to && to.querySelector('.gm-pc');
        if (pc && from) { const fr = from.getBoundingClientRect(), tr = to.getBoundingClientRect(); try { pc.animate([{ transform: `translate(${fr.left - tr.left}px,${fr.top - tr.top}px)` }, { transform: 'translate(0,0)' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' }); } catch {} } }
      cur.ui.animFor = g.moves.length;
    } else if (cur.ui.animFor == null) cur.ui.animFor = g.moves.length;
    if (g.status !== 'play') return;
    const my = colorOf(g, me()); if (g.st.t !== my) return;
    const legal = Chess.legal(g.st);
    bd.onclick = e => {
      const el = e.target.closest('[data-i]'); if (!el) return; const i = +el.dataset.i, p = g.st.b[i], ui = cur.ui;
      if (ui.sel != null) {
        const ms = legal.filter(m => m.f === ui.sel && m.t === i);
        if (ms.length) { if (ms.length > 1) return promo(g, ms); return play(g, ms[0]); }
      }
      if (p !== ' ' && Chess.white(p) === (my === 'w') && legal.some(m => m.f === i)) { ui.sel = ui.sel === i ? null : i; vib(6); } else ui.sel = null;
      paint();
    };
  }
  function play(g, m) { cur.ui.sel = null; vib(12); if (!sendMsg(g, 'mv', Chess.uci(m))) { H.toast('That move is not allowed'); paint(); } }
  function promo(g, ms) {
    const box = cur.root.querySelector('#gm-pr'), my = colorOf(g, me()); box.hidden = false;
    box.innerHTML = `<div class="gm-pb">${'qrbn'.split('').map(t => `<button data-p="${t}" aria-label="Promote">${pieceSvg(my === 'w' ? t.toUpperCase() : t)}</button>`).join('')}</div>`;
    box.onclick = e => { const b = e.target.closest('[data-p]'); if (!b) { box.hidden = true; cur.ui.sel = null; return paint(); } play(g, ms.find(m => m.p === b.dataset.p)); };
  }

  // ---------------------------------------------------------------- battleship view
  const COLS = 'ABCDEFGHIJ';
  function viewSea(g) {
    const ui = cur.ui, me_ = me();
    if (g.status === 'play' && g.phase === 'place') {
      if (g.me.ready) return shell(g, `<div class="gm-wait"><h3>Fleet locked in</h3><p>Waiting for ${esc(peerName(g))} to place theirs. You can leave this screen - the game starts when they are ready.</p></div>${seaGrid(g.me.board, null, { own: true, small: false })}`, `<button class="gm-b danger" data-do="resign">Forfeit</button>`);
      if (!ui.board) ui.board = g.me.board ? g.me.board.slice() : Sea.empty();
      ui.ship = ui.ship == null ? ui.board.findIndex((_, i) => false) : ui.ship;
      const placed = s => ui.board.includes(s);
      if (ui.ship == null || (ui.ship < 0)) ui.ship = Sea.SHIPS.findIndex((_, s) => !placed(s));
      const all = Sea.SHIPS.every((_, s) => placed(s));
      const tray = Sea.SHIPS.map((sh, s) => `<button class="gm-ship ${ui.ship === s ? 'on' : ''} ${placed(s) ? 'done' : ''}" data-sh="${s}"><span>${sh.n}</span><i>${'<b></b>'.repeat(sh.l)}</i></button>`).join('');
      return shell(g, `<div class="gm-hint">Tap a ship, then tap the grid to place it. Tap it again on the grid to turn it.</div>${seaGrid(ui.board, null, { own: true, place: true })}<div class="gm-tray">${tray}</div>`,
        `<button class="gm-b" data-do="shuffle">Shuffle</button><button class="gm-b" data-do="clear">Clear</button><button class="gm-b pri" data-do="ready" ${all ? '' : 'disabled'}>Ready</button>`);
    }
    // battle or finished
    const turnMine = g.turn === me_ && !g.await, my = g.shots[me_] || [], their = g.shots[g.key] || [];
    const sunkMine = g.sunk[g.key] || [], sunkEnemy = g.sunk[me_] || [];
    const sel = ui.target;
    const info = (title, sunk) => `<div class="gm-fl"><b>${title}</b>${Sea.SHIPS.map((s, i) => `<span class="${sunk.includes(i) ? 'dead' : ''}">${s.n}</span>`).join('')}</div>`;
    let foot = '', msg = '';
    if (g.status === 'done') {
      const w = g.end.w;
      msg = `<div class="gm-end"><b>${g.end.why === 'cheat' ? 'Fleet check failed' : w === me_ ? 'Victory' : w ? 'Defeat' : 'Game over'}</b><span>${g.end.why === 'cheat' ? (g.cheat === g.key ? esc(peerName(g)) + "'s fleet did not match what they reported." : 'Your fleet did not match.') : w === me_ ? 'You sank their whole fleet.' : w === g.key ? esc(peerName(g)) + ' sank your fleet.' : 'The game ended.'}</span></div>`;
      foot = `<button class="gm-b pri" data-do="rematch">Rematch</button><button class="gm-b" data-do="close">Close</button>`;
    } else {
      msg = `<div class="gm-turn ${turnMine ? 'me' : ''}">${g.await ? (g.await.by === me_ ? 'Shot fired...' : 'Incoming...') : turnMine ? (sel != null ? 'Target ' + COLS[sel % 10] + (1 + (sel / 10 | 0)) + ' locked' : 'Your shot - pick a square') : 'Waiting for ' + esc(peerName(g)) + '...'}</div>`;
      foot = `<button class="gm-b pri" data-do="fire" ${turnMine && sel != null ? '' : 'disabled'}>Fire</button><button class="gm-b danger" data-do="resign">Forfeit</button>`;
    }
    const enemyReveal = g.status === 'done' && g.end.why !== 'resign' ? null : null;
    return shell(g, `${msg}<div class="gm-lab">Enemy waters</div>${seaGrid(null, g, { enemy: true, sel: turnMine ? sel : null, shots: my, res: g.res[me_] || {} })}
      <div class="gm-lab">Your fleet</div><div class="gm-two">${seaGrid(g.me.board, g, { own: true, small: true, shots: their, res: g.res[g.key] || {} })}<div>${info('Enemy fleet', sunkEnemy)}${info('Your fleet', sunkMine)}</div></div>`, foot);
  }
  // opts: own (show my ships), enemy (tap to target), shots (indices fired at this grid), res (their results)
  function seaGrid(board, g, o) {
    const shots = o.shots || [], res = o.res || {}; let h = `<div class="gm-sea ${o.small ? 'sm' : ''} ${o.enemy ? 'en' : ''}" id="gm-sea${o.enemy ? 'e' : o.own ? 'o' : ''}"><div class="gm-sg">`;
    for (let i = 0; i < 100; i++) {
      const r = res[i], ship = board ? board[i] : -1, shot = shots.includes(i);
      let cls = 'gm-c'; if (o.own && ship >= 0) cls += ' sh s' + ship; if (shot) cls += r ? (r.r === 'miss' ? ' miss' : r.r === 'hit' ? ' hit' : ' hit sunk') : ' pend'; if (o.sel === i) cls += ' tg';
      if (o.own && shot && !r && ship >= 0) cls += ' hit'; else if (o.own && shot && !r) cls += ' miss';
      h += `<div class="${cls}" data-i="${i}">${shot && (o.enemy || o.own) ? '<s></s>' : ''}</div>`;
    }
    return h + '</div></div>';
  }
  function wireSea(g) {
    const ui = cur.ui, root = cur.root;
    if (g.phase === 'place' && !g.me.ready) {
      const grid = root.querySelector('#gm-seao');
      root.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => { ui.ship = +b.dataset.sh; paint(); });
      grid.onclick = e => {
        const c = e.target.closest('[data-i]'); if (!c) return; const i = +c.dataset.i, r = i / 10 | 0, cc = i % 10, at = ui.board[i];
        if (at >= 0 && at === ui.ship) { // turn the ship around its first cell
          const cells = ui.board.map((v, k) => v === at ? k : -1).filter(k => k >= 0), r0 = cells[0] / 10 | 0, c0 = cells[0] % 10, vert = cells.length > 1 && cells[1] - cells[0] === 10;
          const nb = Sea.place(ui.board, at, r0, c0, !vert); if (nb) ui.board = nb; else H.toast("Doesn't fit that way"); return paint();
        }
        if (at >= 0) { ui.ship = at; return paint(); }
        const s = ui.ship; if (s == null || s < 0) return;
        const vert = ui.vert && ui.vert[s]; let nb = Sea.place(ui.board, s, r, cc, !!vert) || Sea.place(ui.board, s, r, cc, !vert);
        if (!nb) { // slide back so a ship near the edge still fits
          for (const v of [false, true]) { const sh = Sea.SHIPS[s]; const r2 = v ? Math.min(r, 10 - sh.l) : r, c2 = v ? cc : Math.min(cc, 10 - sh.l); nb = Sea.place(ui.board, s, r2, c2, v); if (nb) break; } }
        if (!nb) return H.toast("Doesn't fit there"); ui.board = nb; vib(8);
        ui.ship = Sea.SHIPS.findIndex((_, k) => !ui.board.includes(k)); paint();
      };
      root.querySelectorAll('[data-do]').forEach(b => { const a = b.dataset.do; if (a === 'shuffle') b.onclick = () => { ui.board = Sea.random(); ui.ship = -1; paint(); }; if (a === 'clear') b.onclick = () => { ui.board = Sea.empty(); ui.ship = 0; paint(); };
        if (a === 'ready') b.onclick = () => { if (!Sea.valid(ui.board)) return; g.me.board = ui.board.slice(); g.me.salt = rnd(16); sendMsg(g, 'rdy', { h: sha256(Sea.pack(g.me.board, g.me.salt)) }); save(); }; });
      return;
    }
    const e = root.querySelector('#gm-seae'); if (e && g.status === 'play') {
      const myTurn = g.turn === me() && !g.await;
      e.onclick = ev => { const c = ev.target.closest('[data-i]'); if (!c || !myTurn) return; const i = +c.dataset.i; if ((g.shots[me()] || []).includes(i)) return; ui.target = ui.target === i ? null : i; vib(6); paint(); };
      root.querySelectorAll('[data-do="fire"]').forEach(b => b.onclick = () => { if (ui.target == null) return; const i = ui.target; ui.target = null; vib(18); sendMsg(g, 'sh', i); });
    }
  }

  // ---------------------------------------------------------------- word race view
  const ROWS = [['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'], ['enter', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'del']];
  const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return (s / 60 | 0) + ':' + String(s % 60).padStart(2, '0'); };
  const left = g => Math.max(0, g.opt.secs * 1000 - (now() - g.mine.start));
  function viewWord(g) {
    const ui = cur.ui, m = g.mine, secs = g.opt.secs;
    const tiles = (pats, guesses, cur_) => { let h = ''; for (let r = 0; r < 6; r++) { h += '<div class="gm-wr">'; for (let c = 0; c < 5; c++) { const p = pats[r], l = guesses ? (guesses[r] ? guesses[r][c] : r === guesses.length && cur_ ? (cur_[c] || '') : '') : ''; h += `<div class="gm-t ${p ? 's' + p[c] : l ? 'f' : ''}" data-r="${r}" data-c="${c}">${esc(l.toUpperCase())}</div>`; } h += '</div>'; } return h; };
    const oppRows = (() => { let h = ''; for (let r = 0; r < 6; r++) { h += '<div class="gm-mr">'; for (let c = 0; c < 5; c++) { const p = g.th.pat[r]; h += `<i class="${p ? 's' + p[c] : ''}"></i>`; } h += '</div>'; } return h; })();
    const oppLine = g.th.fin ? (g.th.fin.solved ? 'solved it in ' + g.th.fin.n : 'did not solve it') : g.th.pat.length ? 'on guess ' + (g.th.pat.length + 1) : 'has not started';
    if (g.status === 'done' || m.fin) {
      const done = g.status === 'done', w = g.end && g.end.w;
      const res = done ? `<div class="gm-end"><b>${g.end.why === 'cheat' ? 'Result not valid' : w === me() ? 'You win' : w ? esc(peerName(g)) + ' wins' : g.end.why === 'nobody' ? 'Nobody got it' : 'Tie'}</b><span>The word was <strong>${esc(g.word.toUpperCase())}</strong>. You: ${m.fin.solved ? m.fin.n + ' guess' + (m.fin.n > 1 ? 'es' : '') + ', ' + (m.fin.ms / 1000).toFixed(1) + 's' : 'not solved'}. ${esc(peerName(g))}: ${g.th.fin ? (g.th.fin.solved ? g.th.fin.n + ' guess' + (g.th.fin.n > 1 ? 'es' : '') + ', ' + (g.th.fin.ms / 1000).toFixed(1) + 's' : 'not solved') : '...'}</span></div>` : `<div class="gm-turn">Waiting for ${esc(peerName(g))} to finish...</div>`;
      return shell(g, `${res}<div class="gm-two w"><div><div class="gm-lab">You</div><div class="gm-grid mini">${tiles(m.pat, m.gs.concat([]), '')}</div></div><div><div class="gm-lab">${esc(peerName(g))}</div><div class="gm-grid mini">${tiles(g.th.pat, done && g.th.fin ? g.th.fin.gs : null, '')}</div></div></div>`,
        done ? `<button class="gm-b pri" data-do="rematch">Rematch</button><button class="gm-b" data-do="close">Close</button>` : `<button class="gm-b" data-do="close">Close</button>`);
    }
    if (!m.start) return shell(g, `<div class="gm-wait"><div class="gm-big">${GICON.word}</div><h3>${fmt(secs * 1000)} on the clock</h3><p>Six guesses at the same secret five-letter word as ${esc(peerName(g))}. Fewest guesses wins, then fastest. The clock starts when you tap Start, and you do not have to play at the same time. ${esc(peerName(g))} ${esc(oppLine)}.</p></div>`, `<button class="gm-b pri" data-do="start">Start</button><button class="gm-b" data-do="close">Later</button>`);
    const ks = {}; m.gs.forEach((w, r) => { for (let i = 0; i < 5; i++) ks[w[i]] = Math.max(ks[w[i]] == null ? -1 : ks[w[i]], +m.pat[r][i]); });
    const key = k => `<button class="gm-k ${ks[k] != null ? 'k' + ks[k] : ''} ${k.length > 1 ? 'w' : ''}" data-k="${k}">${k === 'enter' ? 'Enter' : k === 'del' ? '<svg viewBox="0 0 24 24"><path d="M9 6h11v12H9l-6-6zM13 10l4 4M17 10l-4 4"/></svg>' : k}</button>`;
    const kb = ROWS.map(r => `<div class="gm-kr">${r.map(key).join('')}</div>`).join('');
    return shell(g, `<div class="gm-clock"><div class="gm-bar"><i id="gm-bi" style="width:${left(g) / (secs * 10)}%"></i></div><span id="gm-tl">${fmt(left(g))}</span></div>
      <div class="gm-opp"><div class="gm-mini">${oppRows}</div><span>${esc(peerName(g))} ${esc(oppLine)}</span></div>
      <div class="gm-grid" id="gm-gr">${tiles(m.pat, m.gs, ui.cur || '')}</div><div class="gm-toast" id="gm-wt"></div><div class="gm-kb">${kb}</div>`, null);
  }
  function wireWord(g) {
    const root = cur.root, ui = cur.ui;
    root.querySelectorAll('[data-do="start"]').forEach(b => b.onclick = () => { g.mine.start = now(); save(); paint(); });
    if (!g.mine.start || g.mine.fin || g.status !== 'play') return;
    root.querySelectorAll('[data-k]').forEach(b => b.onclick = () => key(g, b.dataset.k));
  }
  function onKey(e) {
    if (!cur) return; const g = G.get(cur.id); if (!g || g.type !== 'word' || !g.mine.start || g.mine.fin || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') key(g, 'enter'); else if (e.key === 'Backspace') key(g, 'del'); else if (/^[a-zA-Z]$/.test(e.key)) key(g, e.key.toLowerCase());
  }
  function wtoast(t) { const el = cur && cur.root.querySelector('#gm-wt'); if (!el) return; el.textContent = t; el.classList.add('on'); clearTimeout(cur.wt); cur.wt = setTimeout(() => el.classList.remove('on'), 1400); }
  function key(g, k) {
    const ui = cur.ui, m = g.mine; if (m.fin || left(g) <= 0) return; ui.cur = ui.cur || '';
    if (k === 'del') ui.cur = ui.cur.slice(0, -1);
    else if (k === 'enter') {
      if (ui.cur.length < 5) { shake(g); return wtoast('Not enough letters'); }
      if (!isWord(ui.cur)) { shake(g); return wtoast('Not in the word list'); }
      const guess = ui.cur, pat = Word.score(guess, g.word); m.gs.push(guess); m.pat.push(pat); ui.cur = ''; vib(10);
      sendMsg(g, 'gs', pat);
      const solved = guess === g.word;
      if (solved || m.gs.length >= 6) { finishWord(g); return; }
      paint(); flipRow(m.gs.length - 1, pat); return;
    } else if (/^[a-z]$/.test(k) && ui.cur.length < 5) ui.cur += k;
    const row = cur.root.querySelectorAll('.gm-wr')[m.gs.length]; if (row) { [...row.children].forEach((t, i) => { t.textContent = (ui.cur[i] || '').toUpperCase(); t.classList.toggle('f', !!ui.cur[i]); }); const t = row.children[Math.max(0, ui.cur.length - 1)]; if (k !== 'del' && t) try { t.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 110 }); } catch {} }
  }
  function shake(g) { const row = cur.root.querySelectorAll('.gm-wr')[g.mine.gs.length]; if (row) try { row.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(0)' }], { duration: 300 }); } catch {} vib([20, 30, 20]); }
  function flipRow(r, pat) { const row = cur.root.querySelectorAll('.gm-wr')[r]; if (!row) return; [...row.children].forEach((t, i) => { try { t.animate([{ transform: 'rotateX(0)' }, { transform: 'rotateX(90deg)', offset: .5 }, { transform: 'rotateX(0)' }], { duration: 420, delay: i * 90 }); } catch {} }); }
  function finishWord(g) {
    const m = g.mine; if (m.fin) return; const ms = Math.min(now() - m.start, g.opt.secs * 1000), solved = m.gs.length > 0 && m.gs[m.gs.length - 1] === g.word;
    m.done = true; sendMsg(g, 'fin', { gs: m.gs, ms, solved }); if (cur && cur.id === g.id) { clearInterval(cur.timer); paint(); }
  }
  function tickWord() {
    if (!cur) return; const g = G.get(cur.id); if (!g || g.type !== 'word' || !g.mine.start || g.mine.fin || g.status !== 'play') return;
    const l = left(g); const t = cur.root.querySelector('#gm-tl'), b = cur.root.querySelector('#gm-bi'); if (t) t.textContent = fmt(l); if (b) { b.style.width = (l / (g.opt.secs * 10)) + '%'; b.classList.toggle('low', l < 20000); }
    if (l <= 0) { wtoast("Time's up"); finishWord(g); }
  }
  // Time keeps running if the user leaves the screen: finish for them if the clock ran out while away.
  G.check = () => { load(); for (const g of Object.values(S)) if (g.type === 'word' && g.status === 'play' && g.mine.start && !g.mine.fin && left(g) <= 0) { try { finishWord(g); } catch {} } };

  // ---------------------------------------------------------------- styles
  function css() {
    if (document.getElementById('gm-css')) return; const s = document.createElement('style'); s.id = 'gm-css'; s.textContent = CSS; document.head.append(s);
  }
  const CSS = `
.gm-ov{position:fixed;inset:0;z-index:90;background:var(--bg);color:var(--ink);display:flex;flex-direction:column;font:14px/1.4 ui-sans-serif,system-ui,"Segoe UI",sans-serif;animation:gmIn .22s cubic-bezier(.2,.8,.2,1);-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}
@keyframes gmIn{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}
.gm-ov *,.gm-sheet *,.gm-card *{box-sizing:border-box}:where(.gm-ov,.gm-sheet,.gm-card) button{all:unset;cursor:pointer;box-sizing:border-box}
.gm-top{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);flex:none}
.gm-back{width:36px;height:36px;border-radius:50%;display:grid!important;place-items:center}.gm-back:active{background:var(--card)}.gm-back svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.gm-ti{flex:1;min-width:0}.gm-ti b{display:block;font:650 16px system-ui}.gm-ti span{font-size:12px;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
.gm-pill{font:600 11.5px system-ui;padding:5px 10px;border-radius:99px;background:var(--card);border:1px solid var(--line);color:var(--mute);max-width:46%;text-align:center;line-height:1.25}
.gm-pill.hot{background:var(--ink);color:var(--bg);border-color:var(--ink)}.gm-pill.done{color:var(--ink)}
.gm-body{flex:1;min-height:0;overflow-y:auto;padding:10px 12px 8px;display:flex;flex-direction:column;align-items:center;gap:8px}
.gm-foot{flex:none;display:flex;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line)}
.gm-b{flex:1;text-align:center;padding:12px 10px;border-radius:12px;background:var(--card);border:1px solid var(--line);font:600 14px system-ui;color:var(--ink);transition:transform .08s}
.gm-b:active{transform:scale(.97)}.gm-b.pri{background:var(--ink);color:var(--bg);border-color:var(--ink)}.gm-b.danger{color:#d4483b}.gm-b[disabled]{opacity:.4;pointer-events:none}
.gm-wait{text-align:center;max-width:340px;margin:auto;padding:12px}.gm-wait h3{margin:10px 0 6px;font:650 19px system-ui}.gm-wait p{margin:0;color:var(--mute);line-height:1.5}
.gm-big{width:84px;height:84px;margin:0 auto;border-radius:24px;background:var(--card);border:1px solid var(--line);display:grid;place-items:center}.gm-big svg{width:56px;height:56px}
.gm-pc{fill:#f6f6f2;stroke:#1d1d1d;stroke-width:1.5;stroke-linejoin:round;display:block;width:100%;height:100%;pointer-events:none}
.gm-pc.gb{fill:#2a2a2d;stroke:#e9e9e9}.gm-pc .eye{fill:#1d1d1d;stroke:none}.gm-pc.gb .eye{fill:#e9e9e9}.gm-pc .cut{fill:none;stroke:#1d1d1d;stroke-width:1.6}.gm-pc.gb .cut{stroke:#e9e9e9}
.gm-pc.gi{fill:var(--ink);stroke:none}.gm-pc.gi rect{fill:var(--ink)}
.gm-pc.sm{width:15px;height:15px;display:inline-block;margin-right:-5px;vertical-align:middle}
.gm-card{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:16px;background:var(--card);border:1px solid var(--line);min-width:230px;max-width:100%;cursor:pointer;color:var(--ink)}
.gm-card.hot{border-color:var(--ink)}.gm-ci{width:46px;height:46px;border-radius:13px;background:var(--bg);display:grid;place-items:center;flex:none}.gm-ci svg{width:34px;height:34px}
.gm-ct{flex:1;min-width:0}.gm-ct b{display:block;font:650 15px system-ui}.gm-ct span{display:block;font-size:12.5px;color:var(--mute)}.gm-card.hot .gm-ct span{color:var(--ink)}
.gm-cb{display:flex;gap:6px;flex:none}.gm-cb .gm-b{flex:none;padding:8px 13px;font-size:13px;border-radius:99px}
.gm-sheet{position:fixed;inset:0;z-index:95;background:#0008;display:flex;align-items:flex-end;justify-content:center;animation:gmFade .15s}@keyframes gmFade{from{opacity:0}}
.gm-sc{width:min(520px,100%);background:var(--bg);color:var(--ink);border-radius:22px 22px 0 0;padding:14px 14px calc(16px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:10px;animation:gmUp .22s cubic-bezier(.2,.8,.2,1);font:14px system-ui}
@keyframes gmUp{from{transform:translateY(40px)}}.gm-sh{display:flex;align-items:center;justify-content:space-between;padding:2px 4px}.gm-sh b{font:650 17px system-ui}.gm-x{font-size:26px;width:34px;height:34px;display:grid!important;place-items:center;color:var(--mute)}
.gm-opt{display:flex!important;align-items:center;gap:14px;padding:12px;border-radius:16px;background:var(--card);border:1px solid var(--line)}.gm-opt:active{transform:scale(.985)}
.gm-oi{width:48px;height:48px;border-radius:14px;background:var(--bg);display:grid;place-items:center;flex:none}.gm-oi svg{width:34px;height:34px}.gm-opt b{display:block;font:650 15px system-ui}.gm-opt small{display:block;color:var(--mute);font-size:12.5px;line-height:1.35}
.gm-seg{display:flex;align-items:center;gap:6px;padding:0 4px;font-size:12.5px;color:var(--mute)}.gm-seg span{flex:1}.gm-seg button{padding:6px 11px;border-radius:99px;border:1px solid var(--line);color:var(--ink)}.gm-seg button.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.gm-turn{font:600 13px system-ui;color:var(--mute);text-align:center;min-height:20px}.gm-turn.me{color:var(--ink)}
.gm-end{text-align:center;padding:9px 14px;border-radius:14px;background:var(--card);border:1px solid var(--line);max-width:420px}.gm-end b{display:block;font:650 16px system-ui}.gm-end span{font-size:13px;color:var(--mute)}.gm-end.soft{background:transparent}.gm-end strong{color:var(--ink);letter-spacing:.08em}
.gm-hint{font-size:12.5px;color:var(--mute);text-align:center}.gm-mute{color:var(--mute)}.gm-lab{font:600 11px system-ui;text-transform:uppercase;letter-spacing:.08em;color:var(--mute);align-self:flex-start;margin:2px 0 -2px 2px}
/* chess */
.gm-pl{display:flex;justify-content:space-between;align-items:center;width:min(100%,var(--bs,520px));padding:0 2px;font-size:13px}.gm-pl b{font-weight:600}.gm-cap{display:flex;align-items:center;min-height:16px;padding-right:5px}.gm-cap i{font:600 11px system-ui;color:var(--mute);margin-left:9px;font-style:normal}
.gm-ov.gm-t-chess{--bs:min(100vw - 24px,100vh - 300px,520px)}
.gm-board-wrap{position:relative;width:var(--bs);height:var(--bs);flex:none}
.gm-board{display:grid;grid-template-columns:repeat(8,1fr);width:100%;height:100%;border-radius:10px;overflow:hidden;box-shadow:0 8px 28px #0003,0 0 0 1px var(--line)}
.gm-sq{position:relative;display:grid;place-items:center;aspect-ratio:1;container-type:inline-size}.gm-sq.l{background:#e4e2da}.gm-sq.d{background:#8b9bb0}
.gm-sq .gm-pc{width:86%;height:86%;filter:drop-shadow(0 1px 1px #0004);transition:transform .12s}.gm-sq.sel .gm-pc{transform:scale(1.1) translateY(-2px)}
.gm-sq.lm::before{content:"";position:absolute;inset:0;background:#ffd84a77}.gm-sq.sel::before{content:"";position:absolute;inset:0;background:#4aa3ff88}
.gm-sq.chk::after{content:"";position:absolute;inset:0;background:radial-gradient(circle,#ff2d2dcc 0,#ff2d2d00 72%)}
.gm-sq.tgt::after{content:"";position:absolute;width:30%;height:30%;border-radius:50%;background:#14213d55}.gm-sq.cap::after{content:"";position:absolute;inset:6%;border-radius:50%;border:4px solid #14213d66}
.gm-sq em{position:absolute;font:600 9px system-ui;opacity:.55;font-style:normal;color:#223}.gm-sq em.rk{top:2px;left:3px}.gm-sq em.fl{bottom:1px;right:3px}
.gm-promo{position:absolute;inset:0;display:grid;place-items:center;background:#0007;border-radius:10px}.gm-promo[hidden]{display:none}.gm-pb{display:flex;gap:6px;background:var(--bg);padding:10px;border-radius:16px;box-shadow:0 10px 30px #0006}.gm-pb button{width:min(16vw,70px);height:min(16vw,70px);background:#e4e2da;border-radius:12px;padding:6px}.gm-pb button:active{background:#8b9bb0}
.gm-moves{display:flex;gap:7px;align-items:baseline;overflow-x:auto;width:min(100%,520px);padding:6px 4px;font:13px ui-monospace,Menlo,monospace;white-space:nowrap;scrollbar-width:none}.gm-moves::-webkit-scrollbar{display:none}.gm-moves u{text-decoration:none;color:var(--mute);margin-right:2px}.gm-moves span:last-child{font-weight:700}
/* battleship */
.gm-ov.gm-t-sea{--bs:min(100vw - 24px,100vh - 450px,400px)}
.gm-sea{width:var(--bs);flex:none}.gm-sea.sm{width:min(42vw,170px)}.gm-sea.sm .gm-sg{border-radius:7px}.gm-sg{display:grid;grid-template-columns:repeat(10,1fr);gap:1px;background:#6d7f96;padding:1px;border-radius:10px;overflow:hidden;box-shadow:0 0 0 1px var(--line)}
.gm-c{position:relative;aspect-ratio:1;background:#a9bacd;display:grid;place-items:center}.gm-sea.en .gm-c{cursor:pointer}.gm-sea.en .gm-c:not(.miss):not(.hit):active{background:#c5d3e2}
.gm-c.sh{background:#44546a}.gm-c.sh.s0,.gm-c.sh.s1,.gm-c.sh.s2,.gm-c.sh.s3,.gm-c.sh.s4{box-shadow:inset 0 0 0 1px #ffffff22}
.gm-c.miss s{width:26%;height:26%;border-radius:50%;background:#fff;opacity:.9;animation:gmPop .3s}.gm-c.hit{background:#e0584a}.gm-sea:not(.en) .gm-c.hit.sh{background:#b8332a}.gm-c.hit s{width:44%;height:44%;border-radius:50%;background:#ffe9a8;box-shadow:0 0 8px 2px #ffb347;animation:gmPop .3s}.gm-c.sunk{background:#7c1f18}
.gm-c.pend s{width:34%;height:34%;border-radius:50%;border:2px solid var(--ink);animation:gmPulse .8s infinite}.gm-c.tg::after{content:"";position:absolute;inset:8%;border:2px solid #d4483b;border-radius:50%;animation:gmPulse 1s infinite}.gm-c.tg::before{content:"";position:absolute;left:50%;top:0;bottom:0;width:2px;background:#d4483b99;transform:translateX(-1px)}
@keyframes gmPop{from{transform:scale(.2);opacity:0}}@keyframes gmPulse{50%{transform:scale(1.18);opacity:.6}}
.gm-two .gm-lab{margin-bottom:6px}.gm-two{display:flex;gap:12px;align-items:flex-start;justify-content:center;width:100%;max-width:520px}.gm-two.w>div{flex:1;min-width:0}
.gm-fl{display:flex;flex-direction:column;gap:1px;font-size:11.5px;margin-bottom:6px}.gm-fl b{font:600 11px system-ui;text-transform:uppercase;letter-spacing:.08em;color:var(--mute);margin-bottom:2px}.gm-fl span.dead{text-decoration:line-through;color:#d4483b}
.gm-tray{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;max-width:420px}.gm-ship{display:flex!important;flex-direction:column;gap:4px;padding:7px 10px;border-radius:12px;border:1px solid var(--line);background:var(--card);font-size:12px}.gm-ship.on{border-color:var(--ink);box-shadow:0 0 0 1px var(--ink)}.gm-ship.done{opacity:.5}.gm-ship i{display:flex;gap:2px;font-style:normal}.gm-ship i b{width:11px;height:11px;border-radius:3px;background:#44546a}
/* word race */
.gm-clock{display:flex;align-items:center;gap:10px;width:min(100%,360px)}.gm-bar{flex:1;height:7px;background:var(--card);border-radius:9px;overflow:hidden;border:1px solid var(--line)}.gm-bar i{display:block;height:100%;background:var(--ink);border-radius:9px;transition:width .3s linear}.gm-bar i.low{background:#d4483b}.gm-clock span{font:700 15px ui-monospace,Menlo,monospace;min-width:40px;text-align:right}
.gm-opp{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--mute)}.gm-mini{display:flex;flex-direction:column;gap:2px}.gm-mr{display:flex;gap:2px}.gm-mr i,.gm-mini i{width:9px;height:9px;border-radius:2px;background:var(--card);border:1px solid var(--line)}
.gm-grid{display:flex;flex-direction:column;gap:5px;width:min(100%,min(300px,100vh - 380px));flex:none}.gm-wr{display:flex;gap:5px}.gm-t{flex:1;aspect-ratio:1;display:grid;place-items:center;border:2px solid var(--line);border-radius:7px;font:700 clamp(18px,6vw,28px) system-ui;text-transform:uppercase}.gm-t.f{border-color:var(--mute)}
.gm-t.s0,.gm-mr .s0,.gm-mini i.s0{background:#6a6d73;border-color:#6a6d73;color:#fff}.gm-t.s1,.gm-mini i.s1{background:#c9a227;border-color:#c9a227;color:#fff}.gm-t.s2,.gm-mini i.s2{background:#3e9b5a;border-color:#3e9b5a;color:#fff}
.gm-mr i.s1{background:#c9a227;border-color:#c9a227}.gm-mr i.s2{background:#3e9b5a;border-color:#3e9b5a}.gm-mr i.s0{background:#6a6d73;border-color:#6a6d73}
.gm-grid.mini{width:100%;gap:3px}.gm-grid.mini .gm-wr{gap:3px}.gm-grid.mini .gm-t{font-size:15px;border-width:1.5px;border-radius:5px}
.gm-kb{width:min(100%,500px);display:flex;flex-direction:column;gap:6px;margin-top:auto;padding-bottom:2px}.gm-kr{display:flex;gap:5px;justify-content:center}
.gm-k{flex:1;max-width:44px;height:50px;border-radius:8px;background:var(--card);border:1px solid var(--line);display:grid!important;place-items:center;font:600 15px system-ui;text-transform:uppercase}.gm-k.w{flex:1.6;max-width:70px;font-size:11.5px}.gm-k:active{transform:scale(.94)}.gm-k svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.gm-k.k0{background:#6a6d73;color:#fff;border-color:#6a6d73}.gm-k.k1{background:#c9a227;color:#fff;border-color:#c9a227}.gm-k.k2{background:#3e9b5a;color:#fff;border-color:#3e9b5a}
.gm-toast{position:absolute;top:96px;left:50%;transform:translate(-50%,-6px);background:var(--ink);color:var(--bg);padding:7px 13px;border-radius:10px;font:600 13px system-ui;opacity:0;pointer-events:none;transition:.18s}.gm-toast.on{opacity:1;transform:translate(-50%,0)}
@media (prefers-reduced-motion:reduce){.gm-ov,.gm-sc,.gm-sheet{animation:none}}
`;

  // Light check so a word race clock that ran out while the app was closed is still ended.
  setInterval(() => { try { H && G.check(); } catch {} }, 5000);
})();
