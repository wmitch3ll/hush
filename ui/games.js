// Murmur games: Chess, Battleship and a timed Word Race you play with a friend, one move at a time, right inside the chat.
// Every move is a small end-to-end encrypted message (same path as a text). Both phones keep the game, check every move
// against the rules, and agree on the result - there is no game server.
(function () {
  'use strict';
  const C = window.HUSH_GAMES_CORE, { Chess, Sea, Word, Golf, ChessAI, SeaAI, rng } = C;
  const G = window.HUSH_GAMES = {};
  let H = null;           // host adapter, set by messenger.js
  let S = null;           // { [gameId]: game }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => Date.now();
  const TYPES = { chess: 'Chess', sea: 'Battleship Blitz', word: 'Word race', ball: 'Mini golf', disc: 'Disc golf' };
  const isGolf = t => t === 'ball' || t === 'disc';
  const nm = pk => pk === 'cpu' ? 'Computer' : H.name(pk);

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
  function load() { if (!S) { S = H.get() || {}; const cut = now() - 60 * 864e5; for (const id in S) if (S[id].status !== 'play' && S[id].status !== 'invite' && S[id].upd < cut) delete S[id]; for (const id in S) { const a = S[id].await; if (S[id].type === 'sea' && a && !a.s) S[id].await = { by: a.by, s: [a.i] }; } } return S; }
  const save = () => { try { H.set(S); } catch {} };
  const me = () => H.me();
  const opp = g => g.key;
  const peerName = g => nm(g.key);
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
    if (isGolf(type)) { g.mine = { holes: [], cur: null }; g.th = { holes: [] }; }
    load()[id] = g; return g;
  }
  const colorOf = (g, pk) => ((parseInt(g.seed[0], 16) & 1) ? (pk === g.host ? 'w' : 'b') : (pk === g.host ? 'b' : 'w'));
  const wordFor = (sa, sb) => { const A = window.HUSH_WORDS.a, n = A.length / 5, i = parseInt(sha256(sa + ':' + sb).slice(0, 8), 16) % n; return A.slice(i * 5, i * 5 + 5); };
  let validSet = null;
  const isWord = w => { if (!validSet) { validSet = new Set(); const W = window.HUSH_WORDS; for (const s of [W.a, W.v]) for (let i = 0; i < s.length; i += 5) validSet.add(s.slice(i, i + 5)); } return validSet.has(w); };

  function finish(g, why, winner) { g.status = 'done'; g.end = { why, w: winner || null, at: now() }; g.upd = now(); if (S && g === S[g.id] && !g.rec) { g.rec = 1; try { record(g); } catch {} } }

  // ---------------------------------------------------------------- records (kept apart from the games so old games can be cleared)
  // REC.p[key][type] = { w, l, d, s (streak: + wins / - losses), at }. key is a friend's id, or cpu1 / cpu2 / cpu3 for the computer. REC.b = personal bests.
  const RK = 'hush.gm.rec'; let REC = null;
  const recGet = () => { if (!REC) { try { REC = JSON.parse(localStorage.getItem(RK)) || {}; } catch { REC = {}; } if (!REC.p) REC.p = {}; if (!REC.b) REC.b = {}; } return REC; };
  const recSave = () => { try { localStorage.setItem(RK, JSON.stringify(REC)); } catch {} };
  function record(g) {
    const w = g.end && g.end.w, res = !w ? 'd' : w === me() ? 'w' : 'l', R = recGet(), key = g.key === 'cpu' ? 'cpu' + (g.lvl || 2) : g.key;
    const e = R.p[key] || (R.p[key] = {}), t = e[g.type] || (e[g.type] = { w: 0, l: 0, d: 0, s: 0 });
    t[res]++; t.s = res === 'w' ? (t.s > 0 ? t.s : 0) + 1 : res === 'l' ? (t.s < 0 ? t.s : 0) - 1 : 0; t.at = now();
    const bests = R.b, bt = bests[g.type] || (bests[g.type] = {});
    if (isGolf(g.type) && g.mine.holes.length === Golf.HOLES) { const tot = g.mine.holes.reduce((a, b) => a + b, 0); if (!bt.best || tot < bt.best) bt.best = tot; }
    if (g.type === 'word' && g.mine.fin && g.mine.fin.solved) { const f = g.mine.fin; if (!bt.ms || f.ms < bt.ms) bt.ms = f.ms; if (!bt.n || f.n < bt.n) bt.n = f.n; }
    recSave();
  }
  const sumRec = (e, type) => { const o = { w: 0, l: 0, d: 0, s: 0, at: 0 }; for (const ty in e || {}) { if (type && ty !== type) continue; const t = e[ty]; o.w += t.w; o.l += t.l; o.d += t.d; if (!type || Math.abs(t.s) > Math.abs(o.s)) o.s = t.s; o.at = Math.max(o.at, t.at || 0); } return o; };
  G.record = (key, type) => { const e = recGet().p[key]; return e ? sumRec(e, type) : { w: 0, l: 0, d: 0, s: 0, at: 0 }; };

  // Apply one message from `from` to game g. Returns null if the message is not allowed, otherwise a short note ('' if nothing to tell the user).
  function apply(g, from, k, d) {
    const mine = from === me(), meN = me();
    if (g.status === 'done' && k === 'rv' && g.type === 'sea') return applySea(g, from, k, d);
    if (g.status === 'done' || g.status === 'declined' || g.status === 'cancelled') return null;
    if (k === 'dec') { if (mine === isHost(g) || g.status !== 'invite') return null; g.status = 'declined'; g.upd = now(); return TYPES[g.type] + ' challenge declined'; }
    if (k === 'can') { if (from !== g.host || g.status !== 'invite') return null; g.status = 'cancelled'; g.upd = now(); return 'Challenge cancelled'; }
    if (k === 'rsn') { if (g.status !== 'play') return null; finish(g, 'resign', other(g, from)); return mine ? '' : nm(from) + ' resigned'; }
    if (k === 'acc') {
      if (g.status !== 'invite' || from === g.host) return null;
      if (g.type === 'word') { if (!ok.hex(d && d.sb, 16)) return null; g.sb = d.sb; g.word = wordFor(g.seed, g.sb); }
      g.status = 'play'; g.upd = now();
      if (g.type === 'sea') g.phase = 'place';
      return mine ? '' : nm(from) + ' accepted your ' + TYPES[g.type] + ' challenge';
    }
    if (g.status !== 'play') return null;
    if (g.type === 'chess') return applyChess(g, from, k, d);
    if (g.type === 'sea') return applySea(g, from, k, d);
    if (g.type === 'word') return applyWord(g, from, k, d);
    if (isGolf(g.type)) return applyGolf(g, from, k, d);
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
      if (g.status === 'done') return mine ? '' : (g.end.w ? 'Checkmate - ' + nm(from) + ' wins' : 'Chess ended in a draw');
      return mine ? '' : (st === 'check' ? 'Check! Your move in Chess' : 'Your move in Chess');
    }
    if (k === 'dro') { if (g.draw) return null; g.draw = from; g.upd = now(); return mine ? '' : nm(from) + ' offers a draw'; }
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
  const SALVO = 3;
  // Answer a salvo against a fleet, shot by shot (a ship hit earlier in the same salvo counts for the next shot).
  function salvo(board, prior, cells) {
    const seen = prior.slice(), out = [];
    for (const i of cells) { const r = Sea.shoot(board, seen, i); out.push(r.r === 'sunk' ? { r: 'sunk', n: r.n } : { r: r.r }); seen.push(i); }
    return { r: out, over: board.every((v, k) => v < 0 || seen.includes(k)) };
  }
  function applySea(g, from, k, d) {
    const mine = from === me();
    if (k === 'rdy') {
      if (g.phase !== 'place' || !ok.hex(d && d.h, 64)) return null; const t = mine ? g.me : g.they; if (t.ready) return null;
      if (mine && !(g.me.board && Sea.valid(g.me.board))) return null; t.h = d.h; t.ready = true;
      if (g.me.ready && g.they.ready) { g.phase = 'battle'; g.turn = g.host; return g.turn === me() ? 'Battleship Blitz: fleets are set - you fire first' : 'Battleship: fleets are set'; }
      return mine ? '' : nm(from) + ' has placed their fleet';
    }
    if (g.phase !== 'battle' && k !== 'rv') return null;
    if (k === 'sh') {   // a salvo: three shots, all planned first and fired together
      const L = g.shots[from] || (g.shots[from] = []), need = Math.min(SALVO, 100 - L.length);
      if (g.turn !== from || g.await || !Array.isArray(d) || d.length !== need || need < 1) return null;
      if (!d.every(i => Number.isInteger(i) && i >= 0 && i < 100 && !L.includes(i)) || new Set(d).size !== d.length) return null;
      const prior = L.slice(); d.forEach(i => L.push(i)); g.await = { by: from, s: d.slice() }; g.upd = now();
      if (!mine) { const r = salvo(g.me.board, prior, d); setTimeout(() => { try { G._answer(g, d, r); } catch {} }, 0); return 'Battleship Blitz: ' + nm(from) + ' fired a salvo at your fleet'; }
      return '';
    }
    if (k === 'rs') {
      if (!g.await || g.await.by === from || !d || !Array.isArray(d.s) || d.s.join() !== g.await.s.join() || !Array.isArray(d.r) || d.r.length !== d.s.length) return null;
      const by = g.await.by, sunkNow = (g.sunk[by] || []).slice(), fresh = [];
      for (const x of d.r) { if (!x || !['miss', 'hit', 'sunk'].includes(x.r)) return null;
        if (x.r === 'sunk') { if (!Number.isInteger(x.n) || x.n < 0 || x.n > 4 || sunkNow.includes(x.n)) return null; sunkNow.push(x.n); fresh.push(x.n); } }
      const over = sunkNow.length === 5; if (!!d.end !== over) return null;
      const R = g.res[by] || (g.res[by] = {}); d.s.forEach((i, k2) => { R[i] = { r: d.r[k2].r, n: d.r[k2].r === 'sunk' ? d.r[k2].n : undefined }; });
      g.sunk[by] = sunkNow; g.await = null; g.upd = now(); g.last = { by, c: d.s.slice() }; g.seq = (g.seq || 0) + 1;
      const hits = d.r.filter(x => x.r !== 'miss').length;
      if (over) {
        if (by === me()) { const good = checkFleet(g, from, d.b, d.sa); if (!good) g.cheat = from; }
        finish(g, g.cheat ? 'cheat' : 'fleet', by); g.turn = null; g.revealed = true;
        if (by === me() && g === S[g.id]) setTimeout(() => { try { sendMsg(g, 'rv', { b: g.me.board, sa: g.me.salt }); } catch {} }, 60);
        return by === me() ? '' : 'Battleship Blitz: ' + nm(from) + ' sank your last ship - ' + nm(by) + ' wins';
      }
      g.turn = from;
      return by === me() ? '' : 'Battleship Blitz: ' + nm(by) + ' fired a salvo - ' + (fresh.length ? 'you lost your ' + fresh.map(n => Sea.SHIPS[n].n.toLowerCase()).join(' and ') : hits ? hits + ' hit' + (hits > 1 ? 's' : '') : 'all missed') + '. Your turn';
    }
    if (k === 'rv') {
      if (!(g.status === 'done' && g.end && g.end.w === from) || g.revealed2) return null; g.revealed2 = true;
      if (!mine && !checkFleet(g, from, d && d.b, d && d.sa)) { g.cheat = from; g.end.why = 'cheat'; }
      return '';
    }
    return null;
  }
  // The defending phone answers a shot automatically.
  G._answer = (g, cells, r) => {
    const out = { s: cells, r: r.r };
    if (r.over) { out.end = 1; out.b = g.me.board; out.sa = g.me.salt; }
    sendMsg(g, 'rs', out);
  };

  // Golf: both play the same three holes in their own time and send their strokes for each hole; lowest total wins.
  function applyGolf(g, from, k, d) {
    if (k !== 'hole') return null; const mine = from === me(), t = mine ? g.mine : g.th;
    if (!d || t.holes.length >= Golf.HOLES || d.h !== t.holes.length || !Number.isInteger(d.n) || d.n < 1 || d.n > Golf.MAXS) return null;
    t.holes.push(d.n); g.upd = now();
    if (g.mine.holes.length === Golf.HOLES && g.th.holes.length === Golf.HOLES) {
      const a = g.mine.holes.reduce((x, y) => x + y, 0), b = g.th.holes.reduce((x, y) => x + y, 0);
      finish(g, a === b ? 'tie' : 'golf', a === b ? null : a < b ? me() : g.key);
      return mine ? '' : TYPES[g.type] + ': ' + (g.end.w === me() ? 'you won' : g.end.w ? nm(from) + ' won' : 'a tie') + ' (' + b + ' to your ' + a + ')';
    }
    return mine ? '' : nm(from) + ' finished hole ' + (d.h + 1) + ' of ' + Golf.HOLES;
  }
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
        return mine ? '' : 'Word race result: ' + (w === me() ? 'you won' : w ? nm(w) + ' won' : 'a draw');
      }
      return mine ? '' : nm(from) + ' finished their word - ' + (fin.solved ? 'solved it in ' + fin.n : 'did not solve it');
    }
    return null;
  }

  function sendMsg(g, k, d) {
    const s = g.tx + 1;
    if (k === 'inv') { g.tx = 1; g.rx[me()] = 1; save(); H.send(g.key, { g: g.id, s: 1, k, d, y: g.type, sd: g.seed, o: g.opt }); H.repaint(); return true; }
    // Apply to a throwaway copy first so an illegal move is never sent.
    const probe = JSON.parse(JSON.stringify(g)); if (apply(probe, me(), k, d) === null) return false;
    g.tx = s; g.rx[me()] = s; const note = apply(g, me(), k, d); g.upd = now(); save();
    if (g.key !== 'cpu') H.send(g.key, { g: g.id, s, k, d });
    if (g.key === 'cpu') setTimeout(() => cpuTurn(g), 0);
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
      return { card: true, notify: mineEcho ? '' : nm(from) + ' challenged you to ' + TYPES[p.y] };
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
    const base = '<path class="sh" d="M12 38h21v-1H12z"/>';
    const P = {
      p: '<path d="M22.500 8.500a4.300 4.300 0 0 0-2.500 7.800c-2.800 1.500-4.600 4.400-4.600 7.800 0 2 .7 3.600 1.800 4.800-2.100.9-3.300 2.700-3.300 5.600h17.200c0-2.900-1.200-4.700-3.300-5.600 1.100-1.200 1.800-2.800 1.800-4.800 0-3.400-1.800-6.300-4.600-7.800a4.300 4.300 0 0 0-2.500-7.800z"/><path class="sh" d="M20 12c-1.200 1.600-.8 3.600.6 4.600-2.400 1.800-3.500 4.800-3 7.800.3 1.800 1.200 3 2.400 3.800-2.300 1-3 3.200-3 5.800h-1.500c0-2.900 1.200-4.700 3.300-5.600-1.100-1.200-1.800-2.800-1.800-4.800 0-3.400 1.800-6.300 4.600-7.800-.9-.9-1.400-2.100-1.600-3.800z"/>',
      r: '<path d="M10 37.500h25v-4H10zM12.500 33.500l1.600-4.500h16.800l1.600 4.500zM14.200 29l1-12.500h14.600l1 12.500zM11 16.500v-7h4.200v2.800h3.400V9.500h7.800v2.800h3.400V9.500H34v7z"/><path class="sh" d="M12 10.500h2v5h-2zM15.800 17.500h2.200l-.8 11h-1.800z"/><path class="cut" d="M14.200 29h16.600M13 16.500h19"/>',
      n: '<path d="M11.500 37.500c-.4-9 1.600-15.200 7.300-19.300-2.400.5-4 1.700-5.800 3.200l-2.200-2.600 6.600-8.400 1.200-3.200 2.600 2.200c1.600-.9 3.200-.7 5 .9 5.400 3.800 10.200 11.400 10.400 27.200z"/><path class="sh" d="M16 12.300l-3 4.100 1.600 1.300c1.400-1.200 2.400-1.800 4-2.300zM19 37c.2-7.600 2.800-12.200 7.200-15.500-4.800 2.300-8.600 7-8.800 15.500z"/><circle cx="19.500" cy="14.500" r="1.300" class="eye"/><path class="cut" d="M12.800 17.800l2.100 1.800M22 9.500c4 .6 7.600 5 8.600 10"/>',
      b: '<circle cx="22.500" cy="8.200" r="2.500"/><path d="M22.500 11c-5.400 3.800-7.800 7.800-7.800 12.200 0 2.700 1.200 4.700 3 6.300h9.600c1.800-1.600 3-3.600 3-6.300 0-4.400-2.400-8.400-7.800-12.200z"/><path d="M12.500 33.500h20v3.800h-20zM15.500 29.500h14v4h-14z"/><path class="sh" d="M21 12c-3.800 3-5.200 6.400-5 10.200.1 2.800 1 4.700 2.500 6.300h-1.200c-1.800-1.600-3-3.600-3-6.300 0-3.200 1.400-6.800 6.700-10.200z"/><path class="cut" d="M19.500 17.500h6M22.500 14.500v6"/>',
      q: '<path d="M10.800 34 8.800 15l7.200 8.800 3-11.200 3.500 10.500 3.500-10.500 3 11.200 7.200-8.800-2 19z"/><circle cx="8.600" cy="13.500" r="2.300"/><circle cx="16" cy="9.800" r="2.300"/><circle cx="22.500" cy="8.400" r="2.300"/><circle cx="29" cy="9.800" r="2.300"/><circle cx="36.400" cy="13.500" r="2.300"/><path d="M10.500 34h24v3.800h-24z"/><path class="sh" d="M10.200 18.500l.9 12.500 3-.2-1.400-9.300zM19 17l-1 13h2.400l.8-11.600z"/><path class="cut" d="M11 34h23"/>',
      k: '<path d="M21 3.500h3v3h3v3h-3v3h-3v-3h-3v-3h3z"/><path d="M22.500 12.500c-8.500-.2-13.500 5.400-12.200 13.500.5 3.200 1.800 5.200 3.400 6.800h17.600c1.600-1.600 2.900-3.600 3.400-6.800 1.300-8.100-3.700-13.700-12.200-13.500z"/><path d="M10.500 33.500h24v4h-24z"/><path class="sh" d="M17 15c-4.500 2.200-6.600 6.600-5.700 11.800.4 2.200 1.200 3.800 2.200 5h-1.300c-1.200-1.600-2-3.400-2.400-5.800-1.200-7.400 3.300-12.700 11.800-12.700z"/><path class="cut" d="M22.500 12.500v6M13 33.500h19M16 24c2.500 1.500 10.500 1.500 13 0"/>'
    };
    return `<svg viewBox="0 0 45 45" class="gm-pc ${w ? 'gw' : 'gb'} ${cls}" aria-hidden="true">${P[k]}</svg>`;
  };
  const GICON = {
    chess: pieceSvg('N'),
    sea: '<svg viewBox="0 0 45 45" class="gm-pc gi"><path d="M6 27h33l-5 8H12z"/><path d="M20 10h5v11h-5zM12 21h21v6H12z"/></svg>',
    ball: '<svg viewBox="0 0 45 45" class="gm-pc gi"><circle cx="19" cy="31" r="6.5"/><path d="M30 8v25" stroke="currentColor" stroke-width="2.2" fill="none"/><path d="M30 8l9 4-9 4z"/><ellipse cx="30" cy="35" rx="6" ry="2" opacity=".4"/></svg>',
    disc: '<svg viewBox="0 0 45 45" class="gm-pc gi"><ellipse cx="22.5" cy="26" rx="16" ry="7"/><ellipse cx="22.5" cy="23.5" rx="12" ry="4.6" opacity=".45"/><path d="M6 14c6-6 20-7 32-2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-dasharray="2 3"/></svg>',
    word: '<svg viewBox="0 0 45 45" class="gm-pc gi"><rect x="5" y="14" width="10" height="10" rx="2"/><rect x="17.5" y="14" width="10" height="10" rx="2" opacity=".6"/><rect x="30" y="14" width="10" height="10" rx="2" opacity=".35"/><rect x="5" y="27" width="10" height="10" rx="2" opacity=".35"/><rect x="17.5" y="27" width="10" height="10" rx="2"/></svg>'
  };
  // One line telling the user where the game stands.
  G.summary = g => {
    if (!g) return { line: 'Game no longer available', hot: false };
    const who = peerName(g);
    if (g.status === 'invite') return isHost(g) ? { line: 'Waiting for ' + who + ' to accept', hot: false } : { line: who + ' challenged you', hot: true, ask: true };
    if (g.status === 'declined') return { line: 'Challenge declined', hot: false };
    if (g.status === 'cancelled') return { line: 'Challenge cancelled', hot: false };
    if (g.status === 'done') {
      const w = g.end && g.end.w, why = g.end && g.end.why;
      const tot = h => h.reduce((x, y) => x + y, 0), sc = isGolf(g.type) && g.mine.holes.length ? ' (' + tot(g.mine.holes) + ' to ' + tot(g.th.holes) + ')' : '';
      const t = why === 'cheat' ? 'Game stopped: a move or fleet did not check out' : !w ? (why === 'nobody' ? 'Nobody found the word' : 'Draw') : w === me() ? 'You won' + sc : who + ' won' + sc;
      return { line: t, hot: false, done: true };
    }
    if (g.type === 'chess') { const my = colorOf(g, me()) === g.st.t; return { line: my ? (Chess.inCheck(g.st) ? 'Check - your move' : 'Your move') : 'Waiting for ' + who, hot: my }; }
    if (g.type === 'sea') {
      if (g.phase === 'place') return g.me.ready ? { line: 'Waiting for ' + who + ' to place their fleet', hot: false } : { line: 'Place your fleet', hot: true };
      return g.turn === me() ? { line: 'Your salvo', hot: true } : { line: 'Waiting for ' + who, hot: false };
    }
    if (isGolf(g.type)) {
      const n = g.mine.holes.length; if (n < Golf.HOLES) return { line: n ? 'Hole ' + (n + 1) + ' of ' + Golf.HOLES + ' - your turn to play' : 'Ready - ' + Golf.HOLES + ' holes', hot: true };
      return { line: 'Waiting for ' + nm(g.key) + ' to finish', hot: false };
    }
    if (g.type === 'word') {
      if (!g.mine.fin) return { line: g.mine.start ? 'In progress - ' + (g.opt.secs / 60) + ' min race' : 'Ready when you are - ' + (g.opt.secs / 60) + ' min', hot: true };
      return { line: 'Waiting for ' + who + ' to finish', hot: false };
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

  // ---------------------------------------------------------------- playing the computer
  const busy = new Set();
  function cpuApply(g, k, d) { if (g.status !== 'play') return null; g.rx.cpu = (g.rx.cpu || 0) + 1; const r = apply(g, 'cpu', k, d); g.upd = now(); save(); refresh(g); H.repaint(); return r; }
  const LVL = [.55, .8, 1];
  function cpuTurn(g) {
    if (!g || g.key !== 'cpu' || g.status !== 'play' || busy.has(g.id)) return;
    const lvl = g.lvl || 2;
    if (g.type === 'chess') {
      const cc = colorOf(g, 'cpu'); if (g.st.t !== cc) return; busy.add(g.id);
      setTimeout(() => { setTimeout(() => { busy.delete(g.id); if (g.status !== 'play' || g.st.t !== cc) return; const m = ChessAI.pick(g.st, lvl); if (m) cpuApply(g, 'mv', Chess.uci(m)); }, 30); }, 420 + Math.random() * 500);
    } else if (g.type === 'sea') {
      if (g.phase !== 'battle') return;
      if (g.await && g.await.by === me()) { busy.add(g.id);
        setTimeout(() => { busy.delete(g.id); if (!g.await || g.await.by !== me()) return; const cells = g.await.s, prior = (g.shots[me()] || []).slice(0, -cells.length), r = salvo(g.cpu.board, prior, cells), out = { s: cells, r: r.r };
          if (r.over) { out.end = 1; out.b = g.cpu.board; out.sa = g.cpu.salt; } cpuApply(g, 'rs', out); cpuTurn(g); }, 800); }
      else if (g.turn === 'cpu' && !g.await) { busy.add(g.id);
        setTimeout(() => { busy.delete(g.id); if (g.status !== 'play' || g.turn !== 'cpu' || g.await) return; const sh = (g.shots.cpu || []).slice(), picks = [];
          for (let k = Math.min(SALVO, 100 - sh.length); k > 0; k--) { const i = SeaAI.pick(sh, g.res.cpu || {}, g.sunk.cpu || [], lvl); sh.push(i); picks.push(i); } cpuApply(g, 'sh', picks); }, 2000 + Math.random() * 700); }
    } else if (g.type === 'word') {
      const pl = g.plan; if (!pl || g.th.fin) return;
      while (g.th.pat.length < Math.min(g.mine.gs.length, pl.gs.length - 1)) cpuApply(g, 'gs', Word.score(pl.gs[g.th.pat.length], g.word));
      if (g.mine.fin) cpuApply(g, 'fin', { gs: pl.gs, ms: pl.ms, solved: pl.solved });
    } else if (isGolf(g.type)) {
      while (g.status === 'play' && g.th.holes.length < g.mine.holes.length) cpuApply(g, 'hole', { h: g.th.holes.length, n: g.plan[g.th.holes.length] });
    }
  }
  G.startSolo = (type, lvl, opt) => {
    if (!TYPES[type]) return; load();
    if (Object.values(S).filter(x => x.key === 'cpu' && x.status === 'play').length >= 8) return H.toast('Finish or resign one of your solo games first');
    const id = rnd(8), seed = rnd(8), o = {}; if (type === 'word') o.secs = [120, 180, 300].includes(opt && opt.secs) ? opt.secs : 180;
    const g = create('cpu', type, me(), id, seed, o); g.lvl = [1, 2, 3].includes(lvl) ? lvl : 2; g.status = 'play'; g.tx = 1; g.rx[me()] = 1;
    if (type === 'sea') { g.cpu = { board: Sea.random(), salt: rnd(16) }; g.they.h = sha256(Sea.pack(g.cpu.board, g.cpu.salt)); g.they.ready = true; }
    if (type === 'word') {
      g.sb = rnd(8); g.word = wordFor(seed, g.sb); const R = rng(seed + ':cpu'), A = window.HUSH_WORDS.a, na = A.length / 5, L = g.lvl;
      const solved = R() < [.55, .8, .95][L - 1]; let n = solved ? Math.min(6, [5, 4, 3][L - 1] + (R() < .5 ? 1 : 0)) : 6, gs = [];
      while (gs.length < (solved ? n - 1 : 6)) { const w = A.slice(Math.floor(R() * na) * 5).slice(0, 5); if (w !== g.word && !gs.includes(w)) gs.push(w); } if (solved) gs.push(g.word);
      g.plan = { solved, gs, ms: Math.min(Math.round((22 + R() * 45 + n * 11) * 1000 * [1.5, 1, .7][L - 1]), o.secs * 1000) };
    }
    if (isGolf(type)) g.plan = [0, 1, 2].map(h => Golf.aiHole(Golf.course(type, seed, h), rng(seed + ':cpu:' + h), LVL[g.lvl - 1]));
    save(); G.open(id); cpuTurn(g);
  };
  G.solos = () => Object.values(load()).filter(g => g.key === 'cpu' && g.status === 'play').sort((a, b) => b.upd - a.upd);

  // ---------------------------------------------------------------- leaderboard
  const ago = t => { if (!t) return ''; const d = (now() - t) / 864e5; return d < 1 ? 'today' : d < 2 ? 'yesterday' : Math.floor(d) + ' days ago'; };
  G.board = tab => {
    css(); fit(); document.querySelector('.gm-sheet')?.remove(); const el = document.createElement('div'); el.className = 'gm-sheet'; tab = tab || 'all';
    const R = recGet(), TABS = [['all', 'All games'], ...Object.entries(TYPES)];
    const pct = o => o.w + o.l + o.d ? Math.round(100 * (o.w + o.d / 2) / (o.w + o.l + o.d)) : 0;
    const line = o => `${o.w}-${o.l}${o.d ? '-' + o.d : ''}`;
    const bar = o => { const n = o.w + o.l + o.d || 1; return `<i class="gm-lb"><b class="w" style="width:${100 * o.w / n}%"></b><b class="d" style="width:${100 * o.d / n}%"></b><b class="l" style="width:${100 * o.l / n}%"></b></i>`; };
    const streak = o => o.s > 1 ? `<em class="st w">W${o.s}</em>` : o.s < -1 ? `<em class="st l">L${-o.s}</em>` : '';
    const row = (name, o, rank, key) => `<button class="gm-lr" ${key ? `data-k="${esc(key)}"` : ''}>${rank ? `<span class="rk">${rank}</span>` : ''}<span class="nm"><b>${esc(name)}</b><small>${line(o)} &middot; ${pct(o)}%${o.at ? ' &middot; ' + ago(o.at) : ''}</small>${bar(o)}</span>${streak(o)}</button>`;
    const draw = () => {
      const keys = Object.keys(R.p), tot = { w: 0, l: 0, d: 0, s: 0, at: 0 }, friends = [], cpu = [];
      for (const k of keys) { const o = sumRec(R.p[k], tab === 'all' ? null : tab); if (!o.w && !o.l && !o.d) continue; if (/^cpu\d$/.test(k)) cpu.push([k, o]); else friends.push([k, o]); tot.w += o.w; tot.l += o.l; tot.d += o.d; }
      const rate = ([, a], [, b]) => pct(b) - pct(a) || (b.w + b.l + b.d) - (a.w + a.l + a.d) || b.w - a.w; friends.sort(rate); cpu.sort((a, b) => a[0].localeCompare(b[0]));
      const bt = tab === 'all' ? null : R.b[tab], best = !bt ? '' : isGolf(tab) ? (bt.best ? `Best round: <b>${bt.best}</b> ${tab === 'disc' ? 'throws' : 'strokes'}` : '') : tab === 'word' ? (bt.ms ? `Fastest solve: <b>${(bt.ms / 1000).toFixed(1)}s</b> &middot; fewest guesses: <b>${bt.n}</b>` : '') : '';
      const LV = { cpu1: 'Computer - Easy', cpu2: 'Computer - Medium', cpu3: 'Computer - Hard' };
      el.innerHTML = `<div class="gm-sc"><div class="gm-sh"><b>Leaderboard</b><button class="gm-x" aria-label="Close">&times;</button></div>
        <div class="gm-tabs">${TABS.map(([k, v]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${k === 'all' ? v : v.replace('Battleship Blitz', 'Blitz')}</button>`).join('')}</div>
        <div class="gm-lt"><div class="gm-ls"><b>${tot.w + tot.l + tot.d ? line(tot) : '0-0'}</b><small>${tab === 'all' ? 'Your record, everyone' : 'Your record'} &middot; ${pct(tot)}% wins</small>${bar(tot)}</div>${best ? `<div class="gm-bs">${best}</div>` : ''}</div>
        ${friends.length ? `<div class="gm-sub">Friends</div>${friends.map(([k, o], i) => row(nm(k), o, i + 1, k)).join('')}` : ''}
        ${cpu.length ? `<div class="gm-sub">Computer</div>${cpu.map(([k, o]) => row(LV[k] || 'Computer', o, '', '')).join('')}` : ''}
        ${!friends.length && !cpu.length ? `<div class="gm-sub" style="padding:18px 4px">Nothing here yet. Finish a game against a friend or the computer and your record shows up.</div>` : '<div class="gm-sub">Tap a friend to challenge them.</div>'}</div>`;
      el.querySelector('.gm-x').onclick = () => el.remove();
      el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; draw(); });
      el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { const k = b.dataset.k; el.remove(); G.pick(k); });
    };
    document.body.append(el); el.onclick = e => { if (e.target === el) el.remove(); }; draw();
  };

  // ---------------------------------------------------------------- picker
  // key: a chat to challenge, or null for the Games hub (computer only).
  G.pick = key => {
    css(); fit(); document.querySelector('.gm-sheet')?.remove();
    const el = document.createElement('div'); el.className = 'gm-sheet'; let secs = 180, lvl = 2, mode = key ? 'friend' : 'cpu';
    const rows = [['chess', 'Chess', 'Full rules. Take your time.'], ['sea', 'Battleship Blitz', 'Hidden fleets. Plan 3 shots, fire together, sink them all.'], ['word', 'Word race', 'Same secret word, six guesses, beat the clock.'], ['ball', 'Mini golf', 'Three holes with walls, sand and water. Fewest strokes wins.'], ['disc', 'Disc golf', 'Curve your throws around the trees. Fewest throws wins.']];
    const solos = G.solos();
    const draw = () => {
      el.innerHTML = `<div class="gm-sc"><div class="gm-sh"><b>${key ? 'Play with ' + esc(nm(key)) : 'Games'}</b><span><button class="gm-lbb" data-lb>Leaderboard</button><button class="gm-x" aria-label="Close">&times;</button></span></div>
        ${key ? (() => { const r = G.record(key); return r.w + r.l + r.d ? `<div class="gm-sub">Your record with ${esc(nm(key))}: <b>${r.w}-${r.l}${r.d ? '-' + r.d : ''}</b>${r.s > 1 ? ' &middot; ' + r.s + ' wins in a row' : r.s < -1 ? ' &middot; ' + -r.s + ' losses in a row' : ''}</div>` : ''; })() : ''}
        ${key ? `<div class="gm-seg2" data-g="mode"><button data-v="friend" class="${mode === 'friend' ? 'on' : ''}">${esc(nm(key))}</button><button data-v="cpu" class="${mode === 'cpu' ? 'on' : ''}">Computer</button></div>` : '<div class="gm-sub">Play against the computer, offline. Open a chat to challenge a friend.</div>'}
        ${mode === 'cpu' ? `<div class="gm-seg2" data-g="lvl"><button data-v="1" class="${lvl === 1 ? 'on' : ''}">Easy</button><button data-v="2" class="${lvl === 2 ? 'on' : ''}">Medium</button><button data-v="3" class="${lvl === 3 ? 'on' : ''}">Hard</button></div>` : ''}
        ${rows.map(r => `<button class="gm-opt" data-t="${r[0]}"><span class="gm-oi">${GICON[r[0]]}</span><span><b>${r[1]}</b><small>${r[2]}</small></span></button>`).join('')}
        <div class="gm-seg" aria-label="Word race time"><span>Word race time</span><button data-s="120" class="${secs === 120 ? 'on' : ''}">2 min</button><button data-s="180" class="${secs === 180 ? 'on' : ''}">3 min</button><button data-s="300" class="${secs === 300 ? 'on' : ''}">5 min</button></div>
        ${mode === 'cpu' && solos.length ? `<div class="gm-sub" style="margin-top:4px">Continue</div>${solos.map(g => `<button class="gm-opt gm-res" data-r="${g.id}"><span class="gm-oi">${GICON[g.type]}</span><span><b>${TYPES[g.type]}</b><small>${esc(G.summary(g).line)}</small></span></button>`).join('')}` : ''}</div>`;
      el.querySelector('.gm-x').onclick = () => el.remove(); el.querySelector('[data-lb]').onclick = () => { el.remove(); G.board(); };
      el.querySelectorAll('[data-g=mode] button').forEach(b => b.onclick = () => { mode = b.dataset.v; draw(); });
      el.querySelectorAll('[data-g=lvl] button').forEach(b => b.onclick = () => { lvl = +b.dataset.v; draw(); });
      el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { secs = +b.dataset.s; draw(); });
      el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { el.remove(); if (mode === 'cpu') G.startSolo(b.dataset.t, lvl, { secs }); else G.start(key, b.dataset.t, { secs }); });
      el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { el.remove(); G.open(b.dataset.r); });
    };
    document.body.append(el); el.onclick = e => { if (e.target === el) el.remove(); }; draw();
  };

  // ---------------------------------------------------------------- game window
  let cur = null;       // { id, root, ui }
  const vib = n => { try { navigator.vibrate && navigator.vibrate(n); } catch {} };
  function refresh(g) { if (cur && cur.id === g.id) paint(); }
  G.open = id => {
    const g = G.get(id); if (!g) return; css();
    document.querySelector('.gm-ov')?.remove();
    const root = document.createElement('div'); root.className = 'gm-ov'; document.body.append(root);
    cur = { id, root, ui: {} }; fit(); cur.fit = setInterval(fit, 700); if (g.type === 'word') cur.timer = setInterval(() => { if (cur && cur.id === id) tickWord(); else clearInterval(cur && cur.timer); }, 250);
    paint(true); if (g.key === 'cpu') cpuTurn(g);
  };
  // Keep the game clear of the browser's own bars (address bar, and the back / tabs / menu row), wherever they sit.
  function fit() {
    let top = 0, bot = 0;
    try { for (const id of ['top', 'tools']) { const e = document.getElementById(id); if (!e) continue; const q = e.getBoundingClientRect(); if (q.height < 4 || getComputedStyle(e).display === 'none') continue;
      if (q.top + q.height / 2 < innerHeight / 2) top = Math.max(top, q.bottom); else bot = Math.max(bot, innerHeight - q.top); } } catch {}
    const st = document.documentElement.style; st.setProperty('--gm-top', Math.max(0, Math.round(top)) + 'px'); st.setProperty('--gm-bot', Math.max(0, Math.round(bot)) + 'px');
  }
  const closeGame = () => { if (cur) { clearInterval(cur.fit); clearInterval(cur.timer); cancelAnimationFrame(cur.raf); cur.root.remove(); cur = null; document.removeEventListener('keydown', onKey); } H.repaint(); };
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
    else if (isGolf(g.type)) html = viewGolf(g);
    else html = viewWord(g);
    r.innerHTML = html; cur.root.className = 'gm-ov gm-t-' + g.type;
    r.querySelector('.gm-back').onclick = closeGame;
    r.querySelectorAll('[data-do]').forEach(b => b.onclick = () => doAct(g, b.dataset.do, b));
    if (g.type === 'chess' && g.status !== 'invite') wireChess(g, first);
    else if (g.type === 'sea' && g.status === 'play') wireSea(g);
    else if (g.type === 'word' && g.status !== 'invite') wireWord(g, first);
    else if (isGolf(g.type) && g.status !== 'invite') wireGolf(g);
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
    if (a === 'rematch') { const t = g.type, o = g.opt, k = g.key, l = g.lvl; closeGame(); if (k === 'cpu') G.startSolo(t, l, o); else G.start(k, t, o); return; }
    if (a === 'flip') { cur.ui.flip = !cur.ui.flip; return paint(); }
    if (a === 'theme') { try { localStorage.setItem('hush.gm.theme', String((theme() + 1) % THEMES)); } catch {} return paint(); }
    if (a === 'hint' && g.type === 'chess' && g.key === 'cpu') {
      if (g.st.t !== colorOf(g, me()) || busy.has(g.id)) return H.toast('Wait for your turn');
      H.toast('Thinking...'); return void setTimeout(() => { const m = ChessAI.pick(g.st, 3); if (m && cur && cur.id === g.id) { cur.ui.hint = { f: m.f, t: m.t }; cur.ui.sel = null; paint(); } }, 40);
    }
    if (a === 'undo' && g.type === 'chess' && g.key === 'cpu') {
      if (busy.has(g.id) || g.status !== 'play') return;
      const keep = g.moves.slice(0, Math.max(0, g.moves.length - (g.st.t === colorOf(g, me()) ? 2 : 1)));
      if (keep.length === g.moves.length) return;
      let st = Chess.init(); g.sans = []; g.moves = []; g.seen = {}; g.seen[Chess.key(st)] = 1;
      for (const u of keep) { const m = Chess.parse(st, u); if (!m) break; g.sans.push(Chess.san(st, m)); g.moves.push(u); st = Chess.make(st, m); const k = Chess.key(st); g.seen[k] = (g.seen[k] || 0) + 1; }
      g.st = st; g.upd = now(); save(); cur.ui.sel = null; cur.ui.hint = null; cur.ui.animFor = g.moves.length; paint(); setTimeout(() => cpuTurn(g), 0); return;
    }
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
  const theme = () => { try { return +localStorage.getItem('hush.gm.theme') || 0; } catch { return 0; } };
  const THEMES = 4;
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
      sq += `<div class="gm-sq ${dark ? 'd' : 'l'}${i === lf || i === lt ? ' lm' : ''}${i === ui.sel ? ' sel' : ''}${i === chk ? ' chk' : ''}${ui.hint && (i === ui.hint.f || i === ui.hint.t) ? ' hint' : ''}${targets.includes(i) ? (p !== ' ' ? ' cap' : ' tgt') : ''}" data-i="${i}">${c === 0 ? `<em class="rk">${rk + 1}</em>` : ''}${r === 7 ? `<em class="fl">${'abcdefgh'[f]}</em>` : ''}${p !== ' ' ? pieceSvg(p) : ''}</div>`;
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
      else foot = `<button class="gm-b" data-do="flip">Flip</button><button class="gm-b" data-do="theme">Board</button>${g.key === 'cpu' ? `<button class="gm-b" data-do="hint">Hint</button><button class="gm-b" data-do="undo">Undo</button>` : ''}${g.key === 'cpu' ? '' : g.draw === me() ? '<button class="gm-b" disabled>Draw offered</button>' : '<button class="gm-b" data-do="draw">Offer draw</button>'}<button class="gm-b danger" data-do="resign">Resign</button>`;
      if (!msg) msg = `<div class="gm-turn ${myturn ? 'me' : ''}">${myturn ? (Chess.inCheck(st) ? 'Check - your move' : 'Your move') : 'Waiting for ' + esc(peerName(g)) + '...'}</div>`;
    }
    return shell(g, `${strip(them === 'w' ? 'w' : 'b', peerName(g))}<div class="gm-board-wrap"><div class="gm-board th${theme()}" id="gm-bd">${sq}</div><div class="gm-promo" id="gm-pr" hidden></div></div>${strip(my, 'You')}${msg}<div class="gm-moves" id="gm-mv">${sans || '<span class="gm-mute">No moves yet</span>'}</div>`, foot);
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
    // Drag a piece: press it, drag, release on a highlighted square. Tapping works too.
    bd.onpointerdown = e => {
      const el = e.target.closest('[data-i]'); if (!el || e.button) return; const i = +el.dataset.i, p = g.st.b[i], ui = cur.ui;
      if (p === ' ' || Chess.white(p) !== (my === 'w') || !legal.some(m => m.f === i)) return;
      const x0 = e.clientX, y0 = e.clientY, pcEl = el.querySelector('.gm-pc'); if (!pcEl) return; let ghost = null, moved = false;
      const sz = el.getBoundingClientRect().width;
      const mv = ev => { if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 7) return;
        if (!moved) { moved = true; ui.sel = i; ghost = pcEl.cloneNode(true); ghost.style.cssText = `position:fixed;z-index:99999;pointer-events:none;width:${sz * 1.25}px;height:${sz * 1.25}px;margin:0;transform:none;filter:drop-shadow(0 8px 8px #0005)`; document.body.appendChild(ghost); pcEl.style.opacity = '.25'; }
        ghost.style.left = ev.clientX - sz * .625 + 'px'; ghost.style.top = ev.clientY - sz * .8 + 'px'; };
      const up = ev => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
        if (!moved) return; ghost.remove(); ui.noClick = Date.now();
        const t = document.elementFromPoint(ev.clientX, ev.clientY), te = t && t.closest && t.closest('#gm-bd [data-i]'), to = te ? +te.dataset.i : -1, ms = legal.filter(m => m.f === i && m.t === to);
        if (ms.length) { if (ms.length > 1) return promo(g, ms); return play(g, ms[0]); } paint(); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    };
    bd.onclick = e => {
      if (cur.ui.noClick && Date.now() - cur.ui.noClick < 400) return;
      const el = e.target.closest('[data-i]'); if (!el) return; const i = +el.dataset.i, p = g.st.b[i], ui = cur.ui;
      if (ui.sel != null) {
        const ms = legal.filter(m => m.f === ui.sel && m.t === i);
        if (ms.length) { if (ms.length > 1) return promo(g, ms); return play(g, ms[0]); }
      }
      if (p !== ' ' && Chess.white(p) === (my === 'w') && legal.some(m => m.f === i)) { ui.sel = ui.sel === i ? null : i; vib(6); } else ui.sel = null;
      paint();
    };
  }
  function play(g, m) { cur.ui.sel = null; cur.ui.hint = null; vib(12); if (!sendMsg(g, 'mv', Chess.uci(m))) { H.toast('That move is not allowed'); paint(); } }
  function promo(g, ms) {
    const box = cur.root.querySelector('#gm-pr'), my = colorOf(g, me()); box.hidden = false;
    box.innerHTML = `<div class="gm-pb">${'qrbn'.split('').map(t => `<button data-p="${t}" aria-label="Promote">${pieceSvg(my === 'w' ? t.toUpperCase() : t)}</button>`).join('')}</div>`;
    box.onclick = e => { const b = e.target.closest('[data-p]'); if (!b) { box.hidden = true; cur.ui.sel = null; return paint(); } play(g, ms.find(m => m.p === b.dataset.p)); };
  }

  // ---------------------------------------------------------------- battleship blitz view
  const COLS = 'ABCDEFGHIJ';
  // Ship silhouettes, drawn lying flat, one cell = 10 units long. Each one is a different shape so you can tell them apart at a glance.
  const SHIPART = [
    '<path class="hu" d="M1 6.4 2.8 9.2h38.6c3.8 0 6.6-1.6 7.6-3.8L46.6 2.8H2.8z"/><path class="dk" d="M3 2.8h43.6l-1.4 3H4.2z"/><path class="ln" d="M6 4.3h37" stroke-dasharray="3 2"/><rect class="dt" x="31" y="1" width="6" height="3.6" rx=".8"/><path class="ln" d="M34 1V.2"/><path class="ac" d="M9 3.6l2.4 0-1.2 1.5zM15 3.6l2.4 0-1.2 1.5z"/>',
    '<path class="hu" d="M1 5l1.8 4.2h28.4c4.6 0 7-2.2 7.8-4.2-.8-2-3.2-4.2-7.8-4.2H2.8z"/><path class="dk" d="M3.4 2.4h27.8c3 0 5 1.2 6 2.6-1 1.4-3 2.6-6 2.6H3.4z"/><circle class="dt" cx="9" cy="5" r="2.1"/><circle class="dt" cx="16" cy="5" r="2.1"/><circle class="dt" cx="31" cy="5" r="1.8"/><path class="ln" d="M9 5h-6M16 5h-5M31 5h4.5"/><rect class="ac" x="21" y="3" width="5" height="4" rx=".8"/><path class="ln" d="M23.5 3V1.2"/>',
    '<path class="hu" d="M1 5.6l1.6 3.4h20.6c3.4 0 5.4-1.6 5.8-3.4-.4-1.8-2.4-3.4-5.8-3.4H2.6z"/><path class="dk" d="M3 3h20.2c2.4 0 4 1 4.8 2.6C27.200 7 25.600 8 23.200 8H3z"/><circle class="dt" cx="8" cy="5.5" r="1.9"/><path class="ln" d="M8 5.5H3"/><rect class="ac" x="13" y="3.4" width="5" height="4.2" rx=".8"/><path class="ln" d="M15.500 3.400V1"/><rect class="dt" x="21" y="4.4" width="2.4" height="2.2" rx=".5"/>',
    '<rect class="hu" x="1" y="3.6" width="28" height="4.8" rx="2.4"/><path class="dk" d="M3.400 4.600h23.200c1.200 0 2 .6 2 1.400s-.8 1.400-2 1.400H3.400z"/><path class="hu" d="M11.500 3.600 12.800 1.400h5.400l1.300 2.200z"/><path class="ln" d="M15.500 1.400V.3h2.200"/><circle class="ac" cx="7" cy="6" r=".9"/><circle class="ac" cx="11" cy="6" r=".9"/><circle class="ac" cx="23" cy="6" r=".9"/><path class="dt" d="M1 6 0 4.400v3.200z"/>',
    '<path class="hu" d="M1 5.4l1.200 3.200H15c2.800 0 4.200-1.400 4.400-3.200-.2-1.800-1.600-3.200-4.400-3.200H2.200z"/><path class="dk" d="M2.600 3.200H15c2 0 3 .9 3.400 2.200-.4 1.300-1.400 2.200-3.400 2.200H2.600z"/><rect class="dt" x="6" y="2" width="2.600" height="3.200" rx=".6"/><circle class="dt" cx="13.500" cy="5.400" r="1.500"/><path class="ln" d="M13.500 5.400h4.800"/><rect class="ac" x="9.500" y="3.600" width="2.400" height="3.600" rx=".6"/>'
  ];
  const shipSvg = (s, vert, cls = '') => { const L = Sea.SHIPS[s].l, w = L * 10;
    return vert ? `<svg viewBox="0 0 10 ${w}" class="gm-shp v ${cls}" preserveAspectRatio="none" aria-hidden="true"><g transform="translate(10 0) rotate(90)">${SHIPART[s]}</g></svg>`
      : `<svg viewBox="0 0 ${w} 10" class="gm-shp ${cls}" preserveAspectRatio="none" aria-hidden="true">${SHIPART[s]}</svg>`; };
  const fleetList = (title, sunk) => `<div class="gm-fl"><b>${title} <em>${5 - sunk.length} of 5 afloat</em></b>${Sea.SHIPS.map((sh, i) => `<div class="gm-fi ${sunk.includes(i) ? 'dead' : ''}" title="${sh.n}"><span class="gm-fa"><span style="display:block;width:${sh.l * 10}px">${shipSvg(i, false)}</span></span><span class="gm-fn">${sh.n}</span></div>`).join('')}</div>`;
  const cellsOf = (board, s) => { const c = []; board.forEach((v, i) => { if (v === s) c.push(i); }); return c; };
  const shipsOverlay = (board, sunk) => { let h = '<div class="gm-ships">'; for (let s = 0; s < 5; s++) { const c = cellsOf(board, s); if (!c.length) continue; const vert = c.length > 1 && c[1] - c[0] === 10, r = c[0] / 10 | 0, col = c[0] % 10;
    h += `<div class="gm-sp ${sunk && sunk.includes(s) ? 'dead' : ''}" style="left:${col * 10}%;top:${r * 10}%;width:${vert ? 10 : c.length * 10}%;height:${vert ? c.length * 10 : 10}%" data-s="${s}">${shipSvg(s, vert)}</div>`; } return h + '</div>'; };
  function viewSea(g) {
    const ui = cur.ui, me_ = me();
    if (g.status === 'play' && g.phase === 'place') {
      if (g.me.ready) return shell(g, `<div class="gm-wait"><h3>Fleet locked in</h3><p>Waiting for ${esc(peerName(g))} to place theirs. You can leave this screen - the game starts when they are ready.</p></div>${seaGrid(g.me.board, g, { own: true })}`, `<button class="gm-b danger" data-do="resign">Forfeit</button>`);
      if (!ui.board) ui.board = g.me.board ? g.me.board.slice() : Sea.empty();
      const placed = s => ui.board.includes(s);
      if (ui.ship == null || ui.ship < 0 || placed(ui.ship)) ui.ship = Sea.SHIPS.findIndex((_, s) => !placed(s));
      const all = Sea.SHIPS.every((_, s) => placed(s));
      const tray = Sea.SHIPS.map((sh, s) => `<button class="gm-ship ${ui.ship === s ? 'on' : ''} ${placed(s) ? 'done' : ''}" data-sh="${s}"><span class="gm-fa" style="width:${sh.l * 16}px">${shipSvg(s, false)}</span><span>${sh.n}</span></button>`).join('');
      return shell(g, `<div class="gm-hint">${all ? 'Happy with it? Tap Ready. Tap a ship on the grid to turn it.' : 'Pick a ship below, then tap the grid to place it. Tap a placed ship to turn it.'}</div>${seaGrid(ui.board, g, { own: true, place: true })}<div class="gm-tray">${tray}</div>`,
        `<button class="gm-b" data-do="shuffle">Shuffle</button><button class="gm-b" data-do="clear">Clear</button><button class="gm-b pri" data-do="ready" ${all ? '' : 'disabled'}>Ready</button>`);
    }
    const my = g.shots[me_] || [], their = g.shots[g.key] || [], free = 100 - my.length, need = Math.min(SALVO, free);
    const turnMine = g.status === 'play' && g.turn === me_ && !g.await;
    const sunkMine = g.sunk[g.key] || [], sunkEnemy = g.sunk[me_] || [];
    if (!ui.tg || !turnMine) ui.tg = ui.tg && turnMine ? ui.tg : [];
    const tg = ui.tg.filter(i => !my.includes(i)).slice(0, need); ui.tg = tg;
    // what the last salvo did
    let sum = '';
    if (g.last) { const mineL = g.last.by === me_, R = g.res[g.last.by] || {}, rs = g.last.c.map(i => R[i]).filter(Boolean), h = rs.filter(x => x.r !== 'miss').length, sk = rs.filter(x => x.r === 'sunk').map(x => Sea.SHIPS[x.n].n);
      sum = `<div class="gm-sum ${mineL ? 'm' : 't'}"><b>${mineL ? 'Your last salvo' : esc(peerName(g)) + "'s last salvo"}</b> ${h ? h + ' hit' + (h > 1 ? 's' : '') + ', ' + (rs.length - h) + ' miss' + (rs.length - h === 1 ? '' : 'es') : 'all ' + rs.length + ' missed'}${sk.length ? ' - ' + (mineL ? 'you sank their ' : 'they sank your ') + sk.join(' and ').toLowerCase() + '!' : ''}</div>`; }
    let foot = '', msg = '';
    if (g.status === 'done') {
      const w = g.end.w;
      msg = `<div class="gm-end"><b>${g.end.why === 'cheat' ? 'Fleet check failed' : w === me_ ? 'Victory' : w ? 'Defeat' : 'Game over'}</b><span>${g.end.why === 'cheat' ? (g.cheat === g.key ? esc(peerName(g)) + "'s fleet did not match what they reported." : 'Your fleet did not match.') : w === me_ ? 'You sank their whole fleet.' : w === g.key ? esc(peerName(g)) + ' sank your fleet.' : 'The game ended.'}</span></div>`;
      foot = `<button class="gm-b pri" data-do="rematch">Rematch</button><button class="gm-b" data-do="close">Close</button>`;
    } else {
      const left = need - tg.length;
      msg = `<div class="gm-turn ${turnMine ? 'me' : ''}">${g.await ? (g.await.by === me_ ? 'Salvo in the air...' : 'Incoming salvo...') : turnMine ? (left > 0 ? (tg.length ? `Pick ${left} more target${left > 1 ? 's' : ''}` : `Tap ${need} square${need > 1 ? 's' : ''} to aim your salvo`) : 'Locked in - fire when ready') : 'Waiting for ' + esc(peerName(g)) + '...'}</div>`;
      foot = `<button class="gm-b pri" data-do="fire" ${turnMine && tg.length === need ? '' : 'disabled'}>Fire ${need > 1 ? need + ' shots' : ''}</button>${tg.length ? '<button class="gm-b" data-do="untarget">Clear</button>' : ''}<button class="gm-b danger" data-do="resign">Forfeit</button>`;
    }
    const fxOn = !!(g.last && g.seq !== ui.fxSeq); ui.fxOn = fxOn;
    return shell(g, `${msg}<div class="gm-lab">Enemy waters</div>${seaGrid(null, g, { enemy: true, tg: turnMine ? tg : [], shots: my, res: g.res[me_] || {}, fx: fxOn && g.last.by === me_ ? g.last.c : null })}${sum}
      <div class="gm-two"><div><div class="gm-lab">Your fleet</div>${seaGrid(g.me.board, g, { own: true, small: true, shots: their, res: g.res[g.key] || {}, sunk: sunkMine, fx: fxOn && g.last.by === g.key ? g.last.c : null })}</div><div class="gm-fls">${fleetList('Enemy', sunkEnemy)}${fleetList('Yours', sunkMine)}</div></div>`, foot);
  }
  // opts: own (show my ships), enemy (tap to target), shots (indices fired at this grid), res (their results), tg (planned targets), fx (cells to animate)
  function seaGrid(board, g, o) {
    const shots = o.shots || [], res = o.res || {}, tg = o.tg || [], fx = o.fx || [];
    let h = `<div class="gm-sea ${o.small ? 'sm' : ''} ${o.enemy ? 'en' : ''}" id="gm-sea${o.enemy ? 'e' : o.own ? 'o' : ''}"><div class="gm-ax"><i></i>${[...COLS].map(c => `<span>${c}</span>`).join('')}</div><div class="gm-bd2"><div class="gm-rl">${Array.from({ length: 10 }, (_, i) => `<span>${i + 1}</span>`).join('')}</div><div class="gm-sgw"><div class="gm-sg">`;
    for (let i = 0; i < 100; i++) {
      const r = res[i], shot = shots.includes(i), t = tg.indexOf(i), alt = ((i / 10 | 0) + i % 10) & 1; let cls = 'gm-c' + (alt ? ' a' : '');
      if (shot) { const hitOwn = o.own && !r && board && board[i] >= 0; cls += r ? (r.r === 'miss' ? ' miss' : r.r === 'hit' ? ' hit' : ' hit sunk') : hitOwn ? ' hit' : o.own ? ' miss' : ' pend'; }
      if (t >= 0) cls += ' tg'; const k = fx.indexOf(i); if (k >= 0) cls += ' fx';
      h += `<div class="${cls}" data-i="${i}" ${t >= 0 ? `data-n="${t + 1}"` : ''} style="--d:${k >= 0 ? k * 90 : 0}ms">${shot ? '<s></s><u></u>' : ''}</div>`;
    }
    h += '</div>' + (o.own && board ? shipsOverlay(board, o.sunk) : '') + '</div></div></div>';
    return h;
  }
  function wireSea(g) {
    const ui = cur.ui, root = cur.root;
    if (g.phase === 'place' && !g.me.ready) {
      const grid = root.querySelector('#gm-seao');
      root.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => { ui.ship = +b.dataset.sh; paint(); });
      grid.onclick = e => {
        const c = e.target.closest('[data-i]'), sp = e.target.closest('[data-s]'); let i;
        if (c) i = +c.dataset.i; else if (sp) { const cs = cellsOf(ui.board, +sp.dataset.s); const rc = sp.getBoundingClientRect(), vert = cs.length > 1 && cs[1] - cs[0] === 10, f = vert ? (e.clientY - rc.top) / rc.height : (e.clientX - rc.left) / rc.width; i = cs[Math.min(cs.length - 1, Math.max(0, Math.floor(f * cs.length)))]; } else return;
        const r = i / 10 | 0, cc = i % 10, at = ui.board[i];
        if (at >= 0 && at === ui.ship) { // turn the ship around its first cell
          const cells = ui.board.map((v, k) => v === at ? k : -1).filter(k => k >= 0), r0 = cells[0] / 10 | 0, c0 = cells[0] % 10, vert = cells.length > 1 && cells[1] - cells[0] === 10;
          const nb = Sea.place(ui.board, at, r0, c0, !vert); if (nb) ui.board = nb; else H.toast("Doesn't fit that way"); return paint();
        }
        if (at >= 0) { ui.ship = at; return paint(); }
        const s = ui.ship; if (s == null || s < 0) return;
        const vert = ui.vert && ui.vert[s]; let nb = Sea.place(ui.board, s, r, cc, !!vert) || Sea.place(ui.board, s, r, cc, !vert);
        if (!nb) { for (const v of [false, true]) { const sh = Sea.SHIPS[s]; const r2 = v ? Math.min(r, 10 - sh.l) : r, c2 = v ? cc : Math.min(cc, 10 - sh.l); nb = Sea.place(ui.board, s, r2, c2, v); if (nb) break; } }
        if (!nb) return H.toast("Doesn't fit there"); ui.board = nb; vib(8);
        ui.ship = Sea.SHIPS.findIndex((_, k) => !ui.board.includes(k)); paint();
      };
      root.querySelectorAll('[data-do]').forEach(b => { const a = b.dataset.do; if (a === 'shuffle') b.onclick = () => { ui.board = Sea.random(); ui.ship = -1; paint(); }; if (a === 'clear') b.onclick = () => { ui.board = Sea.empty(); ui.ship = 0; paint(); };
        if (a === 'ready') b.onclick = () => { if (!Sea.valid(ui.board)) return; g.me.board = ui.board.slice(); g.me.salt = rnd(16); sendMsg(g, 'rdy', { h: sha256(Sea.pack(g.me.board, g.me.salt)) }); save(); }; });
      return;
    }
    if (ui.fxOn) { const hits = g.last ? g.last.c.filter(i => { const x = (g.res[g.last.by] || {})[i]; return x && x.r !== 'miss'; }).length : 0; vib(hits ? [30, 40, 60] : 14); ui.fxSeq = g.seq; ui.fxOn = false; }
    const e = root.querySelector('#gm-seae'); if (e && g.status === 'play') {
      const my = g.shots[me()] || [], need = Math.min(SALVO, 100 - my.length), myTurn = g.turn === me() && !g.await;
      e.onclick = ev => { const c = ev.target.closest('[data-i]'); if (!c || !myTurn) return; const i = +c.dataset.i; if (my.includes(i)) return; const t = ui.tg || (ui.tg = []), k = t.indexOf(i);
        if (k >= 0) t.splice(k, 1); else if (t.length >= need) { H.toast('That is all ' + need + ' shots - tap a target to take it back'); return; } else t.push(i); vib(6); paint(); };
      root.querySelectorAll('[data-do="fire"]').forEach(b => b.onclick = () => { const t = (ui.tg || []).slice(); if (t.length !== need || !myTurn) return; ui.tg = []; vib(24); sendMsg(g, 'sh', t); });
      root.querySelectorAll('[data-do="untarget"]').forEach(b => b.onclick = () => { ui.tg = []; paint(); });
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
    if (!m.start) { const ex = (w, p) => `<div class="gm-wr ex">${[...w].map((c, i) => `<div class="gm-t s${p[i]}">${c.toUpperCase()}</div>`).join('')}</div>`;
      return shell(g, `<div class="gm-wait"><h3>Word race</h3><p>Guess the secret 5-letter word in 6 tries. ${esc(peerName(g))} has the same word. Fewest guesses wins, then fastest time.</p>
        <div class="gm-how">${ex('crane', '02001')}<small><b class="g">Green</b> right letter, right spot &middot; <b class="y">Yellow</b> in the word, wrong spot &middot; <b class="x">Grey</b> not in the word</small></div>
        <p class="gm-clk">${fmt(secs * 1000)} on the clock. It starts when you tap Start, and you don't need to play at the same time.</p><p class="gm-oppl">${esc(peerName(g))} ${esc(oppLine)}.</p></div>`, `<button class="gm-b pri" data-do="start">Start - ${fmt(secs * 1000)}</button><button class="gm-b" data-do="close">Later</button>`); }
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

  // ---------------------------------------------------------------- mini golf and disc golf view
  const sum = a => a.reduce((x, y) => x + y, 0);
  const scoreName = (n, par) => n === 1 ? 'Hole in one!' : n <= par - 2 ? 'Eagle!' : n === par - 1 ? 'Birdie!' : n === par ? 'Par' : n === par + 1 ? 'Bogey' : '+' + (n - par);
  const golfHinted = t => { try { return !!localStorage.getItem('hush.gm.hint.' + t); } catch { return true; } };
  function viewGolf(g) {
    const m = g.mine, disc = g.type === 'disc', done = m.holes.length >= Golf.HOLES;
    if (done || g.status === 'done') {
      const pars = [0, 1, 2].map(h => Golf.course(g.type, g.seed, h).par), fin = g.status === 'done', w = g.end && g.end.w;
      const row = (h, i) => `<tr><td>${i + 1}</td><td>${pars[i]}</td><td>${h[i] != null ? h[i] : '-'}</td></tr>`;
      const msg = fin ? `<div class="gm-end"><b>${!w ? 'It is a tie' : w === me() ? 'You win' : esc(peerName(g)) + ' wins'}</b><span>${sum(m.holes)} ${disc ? 'throws' : 'strokes'} to ${sum(g.th.holes)}.</span></div>` : `<div class="gm-turn">You finished with ${sum(m.holes)}. Waiting for ${esc(peerName(g))} to finish (${g.th.holes.length} of ${Golf.HOLES} holes done)...</div>`;
      const card = (t, who) => `<div><div class="gm-lab">${who}</div><table class="gm-tb"><tr><th>Hole</th><th>Par</th><th>${disc ? 'Throws' : 'Strokes'}</th></tr>${[0, 1, 2].map(i => row(t, i)).join('')}<tr class="tot"><td>Total</td><td>${sum(pars)}</td><td>${t.length ? sum(t) : '-'}</td></tr></table></div>`;
      return shell(g, `${msg}<div class="gm-two w">${card(m.holes, 'You')}${card(g.th.holes, esc(peerName(g)))}</div>`, fin ? `<button class="gm-b pri" data-do="rematch">Rematch</button><button class="gm-b" data-do="close">Close</button>` : `<button class="gm-b" data-do="close">Close</button>`);
    }
    const h = m.holes.length, c = Golf.course(g.type, g.seed, h); if (!m.cur || m.cur.h !== h) m.cur = { h, n: 0, pos: { x: c.tee.x, y: c.tee.y }, last: { x: c.tee.x, y: c.tee.y } };
    cur.ui.c = c;
    const chips = [0, 1, 2].map(i => { const par = Golf.course(g.type, g.seed, i).par, n = m.holes[i]; return `<span class="gm-hc ${i === h ? 'on' : n != null ? 'done' : ''}"><small>Hole ${i + 1} &middot; par ${par}</small><b>${n != null ? n : i === h ? '<i id="gm-n">' + m.cur.n + '</i>' : '-'}</b></span>`; }).join('');
    const first = !golfHinted(g.type);
    return shell(g, `<div class="gm-hcs">${chips}</div>
      <div class="gm-opp2">${esc(peerName(g))}: ${g.th.holes.length} of ${Golf.HOLES} holes done${g.th.holes.length ? ' (' + sum(g.th.holes) + ' total)' : ''} &middot; Total so far <b>${sum(m.holes) + m.cur.n}</b></div>
      <div class="gm-cvw"><canvas id="gm-cv" class="gm-cv"></canvas>${first && !m.cur.n ? `<div class="gm-coach" id="gm-coach"><svg viewBox="0 0 24 24"><path d="M12 3v12m0 0-4-4m4 4 4-4M5 20h14"/></svg><b>Pull back, then let go</b><span>Drag anywhere on the course. The ${disc ? 'disc' : 'ball'} goes the opposite way. Pull farther for more power.</span></div>` : ''}</div>
      <div class="gm-turn" id="gm-msg">${m.cur.n ? '' : disc ? 'Drag to aim and set power. Use the slider to curve the throw.' : 'Drag back to aim. Aim at the cup, avoid water.'}</div>
      ${disc ? `<div class="gm-curve"><span>&#8630; Left</span><input type="range" id="gm-cu" min="-100" max="100" value="${cur.ui.curve || 0}" aria-label="Curve the throw left or right"><span>Right &#8631;</span></div><div class="gm-cvt" id="gm-cvt">Straight</div>` : ''}`, `<button class="gm-b danger" data-do="resign">Give up</button>`);
  }
  function wireGolf(g) {
    const cv = cur.root.querySelector('#gm-cv'); if (!cv) return; const disc = g.type === 'disc', c = cur.ui.c, m = g.mine, ctx = cv.getContext('2d');
    const body = cur.root.querySelector('.gm-body'), wrap = cur.root.querySelector('.gm-cvw'); let used = 0;
    if (body) for (const e of body.children) if (e !== wrap) used += e.getBoundingClientRect().height + 8;
    const availH = body ? body.clientHeight - used - 34 : innerHeight - 330, bw = Math.max(180, Math.min(body ? body.clientWidth - 24 : innerWidth - 24, availH * (Golf.W / Golf.H), 440)), bh = bw * Golf.H / Golf.W, dpr = Math.min(2, window.devicePixelRatio || 1), K = bw / Golf.W;
    cv.style.width = bw + 'px'; cv.style.height = bh + 'px'; cv.width = Math.round(bw * dpr); cv.height = Math.round(bh * dpr); ctx.setTransform(dpr * K, 0, 0, dpr * K, 0, 0);
    const msg = t => { const e = cur.root.querySelector('#gm-msg'); if (e) e.textContent = t; };
    const cu = cur.root.querySelector('#gm-cu'), cvt = cur.root.querySelector('#gm-cvt');
    const curveText = () => { const v = cur.ui.curve || 0; if (cvt) cvt.textContent = Math.abs(v) < 6 ? 'Straight throw' : 'Curves ' + (v < 0 ? 'left' : 'right') + ' ' + Math.abs(v) + '%'; }; curveText();
    if (cu) cu.oninput = () => { cur.ui.curve = +cu.value; curveText(); frame(); };
    const curve = () => disc ? (cur.ui.curve || 0) / 100 : 0;
    let aim = null, anim = null;
    function frame(pos, h) {
      const g2 = ctx; g2.clearRect(0, 0, Golf.W, Golf.H);
      const gr = g2.createLinearGradient(0, 0, 0, Golf.H); gr.addColorStop(0, '#6fb766'); gr.addColorStop(1, '#4f9a57'); g2.fillStyle = gr; g2.fillRect(0, 0, Golf.W, Golf.H);
      g2.fillStyle = '#ffffff12'; for (let y = 0; y < Golf.H; y += 40) g2.fillRect(0, y, Golf.W, 20);
      for (const r of c.sand) { g2.fillStyle = '#e3cf94'; g2.beginPath(); g2.roundRect(r.x, r.y, r.w, r.h, 10); g2.fill(); }
      for (const r of c.water) { g2.fillStyle = '#4a93d6'; g2.beginPath(); g2.roundRect(r.x, r.y, r.w, r.h, 9); g2.fill(); g2.strokeStyle = '#ffffff66'; g2.lineWidth = 1.5; g2.beginPath(); for (let x = r.x + 8; x < r.x + r.w - 8; x += 14) { g2.moveTo(x, r.y + r.h / 2); g2.quadraticCurveTo(x + 4, r.y + r.h / 2 - 4, x + 8, r.y + r.h / 2); } g2.stroke(); }
      for (const b of c.blocks) { g2.fillStyle = '#00000030'; g2.beginPath(); g2.roundRect(b.x + 2, b.y + 3, b.w, b.h, 5); g2.fill(); g2.fillStyle = '#8a5a35'; g2.beginPath(); g2.roundRect(b.x, b.y, b.w, b.h, 5); g2.fill(); g2.fillStyle = '#a4703f'; g2.fillRect(b.x + 3, b.y + 3, b.w - 6, 3); }
      g2.fillStyle = '#3a7a42'; g2.beginPath(); g2.roundRect(c.tee.x - 14, c.tee.y - 10, 28, 20, 5); g2.fill();
      // cup / basket
      if (disc) { g2.strokeStyle = '#d8d8d8'; g2.lineWidth = 2; for (let a = 0; a < 6; a++) { g2.beginPath(); g2.moveTo(c.hole.x, c.hole.y - 20); g2.lineTo(c.hole.x + Math.cos(a * 1.0472) * 11, c.hole.y + Math.sin(a * 1.0472) * 6); g2.stroke(); }
        g2.fillStyle = '#2f3b4a'; g2.beginPath(); g2.arc(c.hole.x, c.hole.y, 9, 0, 7); g2.fill(); g2.strokeStyle = '#e8e8e8'; g2.lineWidth = 2; g2.beginPath(); g2.arc(c.hole.x, c.hole.y, 11, 0, 7); g2.stroke(); g2.fillStyle = '#f0b429'; g2.fillRect(c.hole.x - 3, c.hole.y - 24, 6, 5); }
      else { g2.fillStyle = '#111'; g2.beginPath(); g2.arc(c.hole.x, c.hole.y, Golf.HR, 0, 7); g2.fill(); g2.strokeStyle = '#fff'; g2.lineWidth = 1.6; g2.beginPath(); g2.moveTo(c.hole.x, c.hole.y); g2.lineTo(c.hole.x, c.hole.y - 34); g2.stroke(); g2.fillStyle = '#e5392b'; g2.beginPath(); g2.moveTo(c.hole.x, c.hole.y - 34); g2.lineTo(c.hole.x + 17, c.hole.y - 28); g2.lineTo(c.hole.x, c.hole.y - 22); g2.fill(); }
      for (const t of c.trees) { g2.fillStyle = '#00000030'; g2.beginPath(); g2.arc(t.x + 3, t.y + 4, t.r, 0, 7); g2.fill(); g2.fillStyle = '#2d6b3a'; g2.beginPath(); g2.arc(t.x, t.y, t.r, 0, 7); g2.fill(); g2.fillStyle = '#3f8a4c'; g2.beginPath(); g2.arc(t.x - t.r * .25, t.y - t.r * .25, t.r * .6, 0, 7); g2.fill(); }
      const p = pos || m.cur.pos;
      // aim guide
      if (aim && aim.p > .03) { const sh = { a: aim.a, p: aim.p, c: curve() }; let pts;
        const full = Golf.sim(c, p, sh).trace; pts = full;
        if (!disc) { pts = [full[0]]; let h0 = null; for (let i = 1; i < full.length; i++) { const dx = full[i][0] - full[i - 1][0], dy = full[i][1] - full[i - 1][1]; if (Math.hypot(dx, dy) < .05) continue; const hd = Math.atan2(dy, dx); if (h0 == null) h0 = hd; else if (Math.abs(Math.atan2(Math.sin(hd - h0), Math.cos(hd - h0))) > .3) break; pts.push(full[i]); } }
        g2.strokeStyle = '#ffffffcc'; g2.lineWidth = 2; g2.setLineDash([2, 5]); g2.lineCap = 'round'; g2.beginPath(); pts.forEach((q, i) => i ? g2.lineTo(q[0], q[1]) : g2.moveTo(q[0], q[1])); g2.stroke(); g2.setLineDash([]);
        if (pts.length > 2) { const e = pts[pts.length - 1], q = pts[Math.max(0, pts.length - 4)], an = Math.atan2(e[1] - q[1], e[0] - q[0]); g2.fillStyle = '#fff'; g2.beginPath(); g2.moveTo(e[0] + Math.cos(an) * 7, e[1] + Math.sin(an) * 7); g2.lineTo(e[0] + Math.cos(an + 2.5) * 7, e[1] + Math.sin(an + 2.5) * 7); g2.lineTo(e[0] + Math.cos(an - 2.5) * 7, e[1] + Math.sin(an - 2.5) * 7); g2.fill(); }
        g2.fillStyle = '#fff'; g2.font = '600 11px system-ui'; g2.textAlign = 'center'; g2.fillText(Math.round(aim.p * 100) + '%', p.x, p.y + 20); }
      // ball or disc (shadow shows height while it flies)
      const lift = h || 0; g2.fillStyle = '#00000040'; g2.beginPath(); g2.ellipse(p.x + 1.5, p.y + 2.5 + lift * .2, disc ? 8 : 5.5, disc ? 3.4 : 3, 0, 0, 7); g2.fill();
      if (disc) { g2.fillStyle = '#ef6a3a'; g2.beginPath(); g2.ellipse(p.x, p.y - lift, 8, 4, 0, 0, 7); g2.fill(); g2.fillStyle = '#ffb08c'; g2.beginPath(); g2.ellipse(p.x, p.y - lift - 1, 5, 2.2, 0, 0, 7); g2.fill(); }
      else { g2.fillStyle = '#fff'; g2.beginPath(); g2.arc(p.x, p.y - lift, Golf.BR, 0, 7); g2.fill(); g2.strokeStyle = '#00000030'; g2.lineWidth = .8; g2.stroke(); }
    }
    frame();
    function shoot(shot) {
      const pos = m.cur.pos, r = Golf.sim(c, pos, shot), n = r.trace.length; let t0 = 0; vib(14);
      anim = true; const step = ts => { if (!cur || cur.root !== cv.closest('.gm-ov')) return; if (!t0) t0 = ts; const f = Math.min(n - 1, (ts - t0) / 1000 * 30), i = Math.floor(f), fr = f - i, a = r.trace[i], b = r.trace[Math.min(n - 1, i + 1)];
        const q = { x: a[0] + (b[0] - a[0]) * fr, y: a[1] + (b[1] - a[1]) * fr }, lift = disc ? Math.sin(Math.min(1, f / Math.max(1, n - 4)) * Math.PI) * 16 : 0; frame(q, lift);
        ctx.save(); ctx.lineCap = 'round'; for (let k = Math.max(1, i - 14); k <= i; k++) { ctx.strokeStyle = 'rgba(255,255,255,' + (.5 * (k - (i - 14)) / 14) + ')'; ctx.lineWidth = disc ? 2.2 : 3; ctx.beginPath(); ctx.moveTo(r.trace[k - 1][0], r.trace[k - 1][1] - (disc ? Math.sin(Math.min(1, (k - 1) / Math.max(1, n - 4)) * Math.PI) * 16 : 0)); ctx.lineTo(r.trace[k][0], r.trace[k][1] - (disc ? Math.sin(Math.min(1, k / Math.max(1, n - 4)) * Math.PI) * 16 : 0)); ctx.stroke(); } ctx.restore();
        if (f < n - 1) cur.raf = requestAnimationFrame(step); else land(r); }; cur.raf = requestAnimationFrame(step);
    }
    function land(r) {
      anim = false; const cu_ = m.cur; cu_.n++; const ne = cur.root.querySelector('#gm-n'); if (ne) ne.textContent = cu_.n;
      if (r.sunk) { frame(c.hole); msg(scoreName(cu_.n, c.par)); vib([20, 40, 20]); return setTimeout(() => finishHole(cu_.n), 1100); }
      if (r.water) { cu_.n++; if (ne) ne.textContent = cu_.n; msg('Splash! One stroke added - back to your last spot.'); vib([30, 60]); cu_.pos = { x: cu_.last.x, y: cu_.last.y }; }
      else { cu_.pos = { x: r.end.x, y: r.end.y }; cu_.last = { x: r.end.x, y: r.end.y }; msg(Math.round(Math.hypot(c.hole.x - r.end.x, c.hole.y - r.end.y)) + ' to the ' + (disc ? 'basket' : 'hole')); }
      save(); if (cu_.n >= Golf.MAXS) { msg('Pick up - that counts as ' + Golf.MAXS); return setTimeout(() => finishHole(Golf.MAXS), 1100); } frame();
    }
    function finishHole(n) { if (!cur) return; const h = m.cur.h; m.cur = null; sendMsg(g, 'hole', { h, n }); save(); if (cur) paint(); }
    // slingshot: drag back from anywhere, the shot goes the opposite way; longer drag = more power
    const pt = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / K, y: (e.clientY - r.top) / K }; };
    let p0 = null;
    cv.onpointerdown = e => { if (anim) return; const co = cur.root.querySelector('#gm-coach'); if (co) { co.remove(); try { localStorage.setItem('hush.gm.hint.' + g.type, '1'); } catch {} } p0 = pt(e); aim = { a: 0, p: 0 }; try { cv.setPointerCapture(e.pointerId); } catch {} e.preventDefault(); };
    cv.onpointermove = e => { if (!p0) return; const q = pt(e), dx = p0.x - q.x, dy = p0.y - q.y, len = Math.hypot(dx, dy); aim = { a: Math.round(Math.atan2(dy, dx) * 1000) / 1000, p: Math.min(1, len / 120) }; frame(); };
    const end = e => { if (!p0) return; p0 = null; const a = aim; aim = null; if (a && a.p > .06) shoot({ a: a.a, p: Math.round(a.p * 100) / 100, c: curve() }); else frame(); };
    cv.onpointerup = end; cv.onpointercancel = () => { p0 = null; aim = null; frame(); };
  }

  // ---------------------------------------------------------------- styles
  function defs() {
    if (document.getElementById('gm-defs')) return; const d = document.createElement('div'); d.id = 'gm-defs'; d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    d.innerHTML = '<svg width="0" height="0" aria-hidden="true"><defs><linearGradient id="gmGw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9d6cb"/></linearGradient><linearGradient id="gmGb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a4a52"/><stop offset="1" stop-color="#17171a"/></linearGradient></defs></svg>'; document.body.appendChild(d);
  }
  function css() {
    defs();
    if (document.getElementById('gm-css')) return; const s = document.createElement('style'); s.id = 'gm-css'; s.textContent = CSS; document.head.append(s);
  }
  const CSS = `
.gm-ov{position:fixed;left:0;right:0;top:var(--gm-top,0px);bottom:var(--gm-bot,0px);z-index:90;background:var(--bg);color:var(--ink);display:flex;flex-direction:column;font:14px/1.4 ui-sans-serif,system-ui,"Segoe UI",sans-serif;animation:gmIn .22s cubic-bezier(.2,.8,.2,1);-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}
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
.gm-pc{fill:url(#gmGw);stroke:#1d1d1d;stroke-width:1.3;stroke-linejoin:round;display:block;width:100%;height:100%;pointer-events:none}
.gm-pc.gb{fill:url(#gmGb);stroke:#cfcfd4}.gm-pc .sh{fill:#fff;stroke:none;opacity:.5}.gm-pc.gb .sh{opacity:.16}.gm-pc .eye{fill:#1d1d1d;stroke:none}.gm-pc.gb .eye{fill:#e9e9e9}.gm-pc .cut{fill:none;stroke:#1d1d1d;stroke-width:1.6}.gm-pc.gb .cut{stroke:#e9e9e9}
.gm-pc.gi{fill:var(--ink);stroke:none}.gm-pc.gi rect{fill:var(--ink)}
.gm-pc.sm{width:15px;height:15px;display:inline-block;margin-right:-5px;vertical-align:middle}
.gm-card{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:16px;background:var(--card);border:1px solid var(--line);min-width:230px;max-width:100%;cursor:pointer;color:var(--ink)}
.gm-card.hot{border-color:var(--ink)}.gm-ci{width:46px;height:46px;border-radius:13px;background:var(--bg);display:grid;place-items:center;flex:none}.gm-ci svg{width:34px;height:34px}
.gm-ct{flex:1;min-width:0}.gm-ct b{display:block;font:650 15px system-ui}.gm-ct span{display:block;font-size:12.5px;color:var(--mute)}.gm-card.hot .gm-ct span{color:var(--ink)}
.gm-cb{display:flex;gap:6px;flex:none}.gm-cb .gm-b{flex:none;padding:8px 13px;font-size:13px;border-radius:99px}
.gm-sheet{position:fixed;inset:0;padding-bottom:var(--gm-bot,0px);z-index:95;background:#0008;display:flex;align-items:flex-end;justify-content:center;animation:gmFade .15s}@keyframes gmFade{from{opacity:0}}
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
.gm-sq{position:relative;display:grid;place-items:center;aspect-ratio:1;container-type:inline-size}.gm-board{--l:#e4e2da;--d:#8b9bb0}.gm-board.th1{--l:#f0d9b5;--d:#b58863}.gm-board.th2{--l:#eeeed2;--d:#769656}.gm-board.th3{--l:#d8dde6;--d:#4f5d75}
.gm-sq.l{background:var(--l)}.gm-sq.d{background:var(--d)}.gm-sq.hint::before{content:"";position:absolute;inset:0;background:#3ddc8466;box-shadow:inset 0 0 0 3px #1fb86a}
.gm-sq:hover .gm-pc{transform:scale(1.04)}.gm-sq{touch-action:none}.gm-sq .gm-pc{filter:drop-shadow(0 2px 1.5px #0005)}
.gm-sq .gm-pc{width:86%;height:86%;filter:drop-shadow(0 1px 1px #0004);transition:transform .12s}.gm-sq.sel .gm-pc{transform:scale(1.1) translateY(-2px)}
.gm-sq.lm::before{content:"";position:absolute;inset:0;background:#ffd84a77}.gm-sq.sel::before{content:"";position:absolute;inset:0;background:#4aa3ff88}
.gm-sq.chk::after{content:"";position:absolute;inset:0;background:radial-gradient(circle,#ff2d2dcc 0,#ff2d2d00 72%)}
.gm-sq.tgt::after{content:"";position:absolute;width:30%;height:30%;border-radius:50%;background:#14213d55}.gm-sq.cap::after{content:"";position:absolute;inset:6%;border-radius:50%;border:4px solid #14213d66}
.gm-sq em{position:absolute;font:600 9px system-ui;opacity:.55;font-style:normal;color:#223}.gm-sq em.rk{top:2px;left:3px}.gm-sq em.fl{bottom:1px;right:3px}
.gm-promo{position:absolute;inset:0;display:grid;place-items:center;background:#0007;border-radius:10px}.gm-promo[hidden]{display:none}.gm-pb{display:flex;gap:6px;background:var(--bg);padding:10px;border-radius:16px;box-shadow:0 10px 30px #0006}.gm-pb button{width:min(16vw,70px);height:min(16vw,70px);background:#e4e2da;border-radius:12px;padding:6px}.gm-pb button:active{background:#8b9bb0}
.gm-moves{display:flex;gap:7px;align-items:baseline;overflow-x:auto;width:min(100%,520px);padding:6px 4px;font:13px ui-monospace,Menlo,monospace;white-space:nowrap;scrollbar-width:none}.gm-moves::-webkit-scrollbar{display:none}.gm-moves u{text-decoration:none;color:var(--mute);margin-right:2px}.gm-moves span:last-child{font-weight:700}
/* battleship blitz */
.gm-ov.gm-t-sea{--bs:min(100vw - 52px,100vh - 520px,380px)}
.gm-sea{width:calc(var(--bs) + 16px);flex:none}.gm-sea.sm{width:min(44vw,176px)}
.gm-ax{display:flex;margin-left:16px;font:600 10px system-ui;color:var(--mute)}.gm-ax span{flex:1;text-align:center}.gm-ax i{display:none}
.gm-bd2{display:flex}.gm-rl{width:16px;display:flex;flex-direction:column;font:600 10px system-ui;color:var(--mute)}.gm-rl span{flex:1;display:grid;place-items:center}
.gm-sgw{position:relative;flex:1;min-width:0}.gm-sea.sm .gm-ax,.gm-sea.sm .gm-rl{font-size:8px}.gm-sea.sm .gm-rl{width:12px}.gm-sea.sm .gm-ax{margin-left:12px}
.gm-sg{display:grid;grid-template-columns:repeat(10,1fr);background:#2d6e9e;border-radius:10px;overflow:hidden;box-shadow:0 8px 24px #0003,0 0 0 1px #1d4f75}.gm-sea.sm .gm-sg{border-radius:7px}
.gm-c{position:relative;aspect-ratio:1;background:#4f9bcc;display:grid;place-items:center;overflow:visible}.gm-c.a{background:#4a94c5}.gm-sea.en .gm-c{cursor:crosshair}
.gm-c::before{content:"";position:absolute;inset:0;box-shadow:inset 0 0 0 .5px #ffffff26;pointer-events:none}
.gm-sea.en .gm-c:not(.miss):not(.hit):hover{background:#7ab8de}
.gm-ships{position:absolute;inset:0;pointer-events:none}.gm-sp{position:absolute;filter:drop-shadow(0 1.5px 1px #0006)}.gm-shp{display:block;width:100%;height:100%;overflow:visible}
.gm-shp .hu{fill:#56667c;stroke:#2d3a4c;stroke-width:.6}.gm-shp .dk{fill:#8493a8}.gm-shp .dt{fill:#33405a;stroke:#1f2a3c;stroke-width:.3}.gm-shp .ac{fill:#d9b44a}.gm-shp .ln{fill:none;stroke:#26334a;stroke-width:.7;stroke-linecap:round}
.gm-sp.dead{filter:grayscale(1) brightness(.55)}
.gm-c.miss s,.gm-c.pend s{width:22%;height:22%;border-radius:50%;background:#fff;opacity:.85;display:block}.gm-c.miss u{position:absolute;inset:24%;border:1.5px solid #ffffffaa;border-radius:50%;opacity:.55}
.gm-c.pend s{background:none;border:2px solid #fff;animation:gmPulse .8s infinite}
.gm-c.hit s{position:relative;width:58%;height:58%;border-radius:50%;background:radial-gradient(circle at 50% 60%,#fff4b0 0,#ffb02e 38%,#e5472b 68%,#8a1d12 100%);box-shadow:0 0 7px 2px #ff7a2e;animation:gmFlick .55s infinite alternate}
.gm-c.hit.sunk s{background:radial-gradient(circle,#ffd27a 0,#c9341f 45%,#3a0f0b 100%);box-shadow:0 0 8px 3px #d4352299}.gm-c.hit u{position:absolute;inset:-35%;pointer-events:none;border-radius:50%;opacity:0}
.gm-sea:not(.en) .gm-c.hit{background:transparent}.gm-c.hit,.gm-c.fx{z-index:3}.gm-ships{z-index:2}
@keyframes gmFlick{from{transform:scale(.9) rotate(-4deg);filter:brightness(1)}to{transform:scale(1.08) rotate(4deg);filter:brightness(1.25)}}
/* water splash on a miss, explosion on a hit - they all play together when the salvo lands */
.gm-c.fx.miss s{animation:gmSplash .9s var(--d) both;box-shadow:-9px -6px 0 -1px #fff,9px -6px 0 -1px #fff,0 -11px 0 -1px #fff,-6px 8px 0 -2px #fff,6px 8px 0 -2px #fff}
.gm-c.fx.miss u{animation:gmRing 1s var(--d) both}
.gm-c.fx.hit{animation:gmShake .45s var(--d)}.gm-c.fx.hit s{animation:gmBoom .8s var(--d) both}.gm-c.fx.hit u{background:radial-gradient(circle,#fffbe0 0,#ffd04a 22%,#ff7a1f 46%,#d4352200 70%);animation:gmBlast .8s var(--d) both}
@keyframes gmSplash{0%{transform:translateY(8px) scale(0);opacity:0}25%{transform:translateY(-5px) scale(1.6);opacity:1}100%{transform:translateY(0) scale(1);opacity:.85;box-shadow:0 0 0 0 #fff0}}
@keyframes gmRing{0%{transform:scale(.2);opacity:0}20%{opacity:.9}100%{transform:scale(2.3);opacity:0}}
@keyframes gmBlast{0%{transform:scale(.1);opacity:0}15%{opacity:1}100%{transform:scale(2.4);opacity:0}}
@keyframes gmBoom{0%{transform:scale(0)}40%{transform:scale(1.6)}100%{transform:scale(1)}}
@keyframes gmShake{20%{transform:translate(-1.5px,1px)}40%{transform:translate(1.5px,-1px)}60%{transform:translate(-1px,-1px)}80%{transform:translate(1px,1px)}}
.gm-c.tg::after{content:attr(data-n);position:absolute;inset:6%;border:2px solid #ff4a3a;border-radius:50%;display:grid;place-items:center;font:800 clamp(9px,3vw,13px) system-ui;color:#fff;background:#ff4a3a88;text-shadow:0 1px 2px #0008;animation:gmPulse 1.1s infinite;z-index:2}
.gm-c.tg::before{inset:auto;left:-30%;right:-30%;top:50%;height:1.5px;background:#ff4a3a99;box-shadow:none;z-index:1}
@keyframes gmPulse{50%{transform:scale(1.12);opacity:.75}}
.gm-sum{font-size:12.5px;text-align:center;color:var(--mute);width:min(100%,400px)}.gm-sum b{color:var(--ink)}.gm-sum.m b{color:#2b8a57}.gm-sum.t b{color:#d4483b}
.gm-two .gm-lab{margin-bottom:6px}.gm-two{display:flex;gap:12px;align-items:flex-start;justify-content:center;width:100%;max-width:520px}.gm-two.w>div{flex:1;min-width:0}
.gm-fls{display:flex;flex-direction:column;gap:8px;flex:1;min-width:0}.gm-fl{display:flex;flex-direction:column;gap:3px}.gm-fl b{font:600 10.5px system-ui;text-transform:uppercase;letter-spacing:.08em;color:var(--mute)}.gm-fl b em{font-style:normal;text-transform:none;letter-spacing:0;opacity:.8;margin-left:3px}
.gm-fi{display:flex;align-items:center;gap:7px;font-size:11px;position:relative}.gm-fa{display:block;height:10px;flex:none;width:52px}.gm-ship .gm-fa{width:auto!important}.gm-fa .gm-shp{height:10px;width:100%}.gm-fn{white-space:nowrap}
.gm-fi.dead .gm-fa{filter:grayscale(1) brightness(.6);opacity:.55}.gm-fi.dead .gm-fn{color:#d4483b;text-decoration:line-through}.gm-fi.dead::after{content:"SUNK";font:700 8px system-ui;letter-spacing:.08em;color:#fff;background:#d4483b;border-radius:3px;padding:1px 3px;margin-left:auto}
.gm-tray{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;max-width:420px}.gm-ship{display:flex!important;flex-direction:column;align-items:center;gap:5px;padding:8px 10px;border-radius:12px;border:1px solid var(--line);background:var(--card);font-size:11.5px}.gm-ship .gm-fa{height:14px}.gm-ship .gm-fa .gm-shp{height:14px}.gm-ship.on{border-color:var(--ink);box-shadow:0 0 0 1px var(--ink)}.gm-ship.done{opacity:.45}
/* word race */
.gm-clock{display:flex;align-items:center;gap:10px;width:min(100%,360px)}.gm-bar{flex:1;height:7px;background:var(--card);border-radius:9px;overflow:hidden;border:1px solid var(--line)}.gm-bar i{display:block;height:100%;background:var(--ink);border-radius:9px;transition:width .3s linear}.gm-bar i.low{background:#d4483b}.gm-clock span{font:700 15px ui-monospace,Menlo,monospace;min-width:40px;text-align:right}
.gm-opp{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--mute)}.gm-mini{display:flex;flex-direction:column;gap:2px}.gm-mr{display:flex;gap:2px}.gm-mr i,.gm-mini i{width:9px;height:9px;border-radius:2px;background:var(--card);border:1px solid var(--line)}
.gm-grid{display:flex;flex-direction:column;gap:5px;width:min(100%,min(300px,100vh - 380px));flex:none}.gm-wr{display:flex;gap:5px}.gm-t{flex:1;aspect-ratio:1;display:grid;place-items:center;border:2px solid var(--line);border-radius:7px;font:700 clamp(18px,6vw,28px) system-ui;text-transform:uppercase}.gm-t.f{border-color:var(--mute)}
.gm-t.s0,.gm-mr .s0,.gm-mini i.s0{background:#6a6d73;border-color:#6a6d73;color:#fff}.gm-t.s1,.gm-mini i.s1{background:#c9a227;border-color:#c9a227;color:#fff}.gm-t.s2,.gm-mini i.s2{background:#3e9b5a;border-color:#3e9b5a;color:#fff}
.gm-mr i.s1{background:#c9a227;border-color:#c9a227}.gm-mr i.s2{background:#3e9b5a;border-color:#3e9b5a}.gm-mr i.s0{background:#6a6d73;border-color:#6a6d73}
.gm-grid.mini{width:100%;gap:3px}.gm-grid.mini .gm-wr{gap:3px}.gm-grid.mini .gm-t{font-size:15px;border-width:1.5px;border-radius:5px}
.gm-kb{width:min(100%,480px);display:flex;flex-direction:column;gap:7px;margin-top:6px;padding-bottom:2px}.gm-kr{display:flex;gap:5px;justify-content:center}
.gm-k{flex:1;max-width:42px;height:clamp(44px,7.2vh,54px);border-radius:10px;background:var(--card);border:1px solid var(--line);display:grid!important;place-items:center;font:650 16px system-ui;text-transform:uppercase;box-shadow:0 1px 0 var(--line);transition:transform .06s,background .2s}.gm-k.w{flex:1.55;max-width:66px;font-size:12px;letter-spacing:.02em}.gm-k:active{transform:scale(.92)}
.gm-k.k0{background:#6a6d73;border-color:#6a6d73;color:#fff;opacity:.55}.gm-k.k1{background:#c9a227;border-color:#c9a227;color:#fff}.gm-k.k2{background:#3e9b5a;border-color:#3e9b5a;color:#fff}.gm-k.w:not(.k0):not(.k1):not(.k2){background:var(--ink);color:var(--bg);border-color:var(--ink)}.gm-k svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.gm-t-word .gm-body{justify-content:center;gap:10px}.gm-t-word .gm-grid{width:min(100%,300px,calc((100vh - var(--gm-top,0px) - var(--gm-bot,0px) - 360px) * 5 / 6));min-width:200px}
.gm-how{display:flex;flex-direction:column;align-items:center;gap:8px;margin:14px 0 4px}.gm-how .gm-wr{width:210px}.gm-how .gm-t{font-size:20px}.gm-how small{color:var(--mute);font-size:12px;line-height:1.5;max-width:300px}.gm-how b{font-weight:700}.gm-how b.g{color:#3e9b5a}.gm-how b.y{color:#c9a227}.gm-how b.x{color:#6a6d73}
.gm-clk{margin:10px 0 0!important}.gm-oppl{margin:2px 0 0!important;font-size:12.5px}
.gm-k.k0{background:#6a6d73;color:#fff;border-color:#6a6d73}.gm-k.k1{background:#c9a227;color:#fff;border-color:#c9a227}.gm-k.k2{background:#3e9b5a;color:#fff;border-color:#3e9b5a}
.gm-toast{position:absolute;top:96px;left:50%;transform:translate(-50%,-6px);background:var(--ink);color:var(--bg);padding:7px 13px;border-radius:10px;font:600 13px system-ui;opacity:0;pointer-events:none;transition:.18s}.gm-toast.on{opacity:1;transform:translate(-50%,0)}

.gm-hcs{display:flex;gap:8px;width:min(100%,420px)}.gm-hc{flex:1;display:flex;flex-direction:column;align-items:center;padding:6px 4px;border-radius:12px;background:var(--card);border:1px solid var(--line);color:var(--mute)}.gm-hc small{font-size:10.5px;letter-spacing:.02em}.gm-hc b{font:700 18px system-ui;color:var(--ink)}.gm-hc b i{font-style:normal}.gm-hc.on{border-color:var(--ink);box-shadow:0 0 0 1px var(--ink)}.gm-hc.done{background:transparent}.gm-opp2 b{color:var(--ink)}
.gm-cvw{position:relative;flex:none;display:grid;place-items:center}.gm-coach{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(78%,260px);padding:14px 16px;border-radius:16px;background:#0b0b0cd9;color:#fff;text-align:center;pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:4px;animation:gmPulse2 2.2s infinite}.gm-coach svg{width:30px;height:30px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.gm-coach b{font:650 15px system-ui}.gm-coach span{font-size:12.5px;opacity:.85;line-height:1.4}@keyframes gmPulse2{50%{transform:translate(-50%,-52%)}}
.gm-cvt{font:600 12px system-ui;color:var(--mute);text-align:center;margin-top:-4px}.gm-hud{display:flex;gap:18px;justify-content:center;font-size:13px;color:var(--mute)}.gm-hud b{color:var(--ink);font-size:15px}.gm-opp2{font-size:12px;color:var(--mute)}
.gm-cv{border-radius:14px;touch-action:none;box-shadow:0 8px 28px #0003,0 0 0 1px var(--line);flex:none;cursor:crosshair}
.gm-curve{display:flex;align-items:center;gap:10px;width:min(100%,380px);font-size:12px;color:var(--mute)}.gm-curve input{flex:1;accent-color:var(--ink)}
.gm-tb{width:100%;border-collapse:collapse;font-size:13px}.gm-tb th{font:600 11px system-ui;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);text-align:center;padding:4px}.gm-tb td{text-align:center;padding:6px;border-top:1px solid var(--line)}.gm-tb tr.tot td{font-weight:700}
.gm-seg2{display:flex;gap:4px;padding:3px;border-radius:12px;background:var(--card);border:1px solid var(--line)}.gm-seg2 button{flex:1;text-align:center;padding:8px 6px;border-radius:9px;font:600 13px system-ui;color:var(--mute)}.gm-seg2 button.on{background:var(--ink);color:var(--bg)}
.gm-sub{font-size:12.5px;color:var(--mute);padding:0 4px}.gm-sc{max-height:92vh;overflow-y:auto}.gm-res .gm-oi{opacity:.85}
.gm-sh span{display:flex;align-items:center;gap:6px}.gm-lbb{font:600 12.5px system-ui;padding:6px 11px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink)}
.gm-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:2px 0}.gm-tabs::-webkit-scrollbar{display:none}.gm-tabs button{flex:none;padding:7px 12px;border-radius:999px;border:1px solid var(--line);background:var(--card);font:600 12.5px system-ui;color:var(--mute)}.gm-tabs button.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.gm-lt{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-radius:14px;background:var(--card);border:1px solid var(--line)}.gm-ls b{font:700 30px system-ui;letter-spacing:-.02em;display:block}.gm-ls small{color:var(--mute);font-size:12px}.gm-bs{font-size:12.5px;color:var(--mute)}.gm-bs b{color:var(--ink)}
.gm-lr{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:14px;border:1px solid var(--line);background:var(--card);text-align:left;width:100%}.gm-lr .rk{font:700 15px system-ui;width:22px;text-align:center;color:var(--mute)}.gm-lr .nm{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}.gm-lr .nm b{font:650 14.5px system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gm-lr .nm small{font-size:11.5px;color:var(--mute)}
.gm-lb{display:flex;height:5px;border-radius:5px;overflow:hidden;background:var(--line)}.gm-lb b{display:block;height:100%}.gm-lb .w{background:#3e9b5a}.gm-lb .d{background:#9aa0a8}.gm-lb .l{background:#d4483b}
.gm-lr em.st{font:700 11px system-ui;padding:3px 7px;border-radius:999px;font-style:normal;color:#fff}.gm-lr em.st.w{background:#3e9b5a}.gm-lr em.st.l{background:#d4483b}
@media (prefers-reduced-motion:reduce){.gm-ov,.gm-sc,.gm-sheet{animation:none}}
`;

  // Light check so a word race clock that ran out while the app was closed is still ended.
  setInterval(() => { try { H && G.check(); } catch {} }, 5000);
})();
