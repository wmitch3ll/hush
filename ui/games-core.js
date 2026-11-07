// Rules for the Murmur games. Pure logic only (no screen, no network) so both players' phones reach the same result,
// and so each phone can check the other's moves. Works in the browser and in Node (tests).
(function (root) {
  'use strict';
  const FILES = 'abcdefgh';
  const sq = i => FILES[i & 7] + (8 - (i >> 3));
  const idx = s => (8 - +s[1]) * 8 + FILES.indexOf(s[0]);

  // ------------------------------------------------------------------ chess
  // Board: 64 cells, index 0 = a8 … 63 = h1. Upper case = white, lower case = black, '' = empty.
  const Chess = (() => {
    const START = 'rnbqkbnrpppppppp' + ' '.repeat(32) + 'PPPPPPPPRNBQKBNR';
    const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
    const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    const DG = [[-1, -1], [-1, 1], [1, -1], [1, 1]], ST = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const white = p => p !== ' ' && p === p.toUpperCase();
    const init = () => ({ b: START, t: 'w', c: 'KQkq', ep: -1, hm: 0, fm: 1 });
    const clone = s => ({ b: s.b, t: s.t, c: s.c, ep: s.ep, hm: s.hm, fm: s.fm });
    const find = (b, ch) => b.indexOf(ch);

    // Is square i attacked by side `by` ('w' or 'b')?
    function attacked(b, i, by) {
      const r = i >> 3, c = i & 7, w = by === 'w';
      const at = (rr, cc) => rr < 0 || rr > 7 || cc < 0 || cc > 7 ? ' ' : b[rr * 8 + cc];
      const P = w ? 'P' : 'p', N = w ? 'N' : 'n', B = w ? 'B' : 'b', R = w ? 'R' : 'r', Q = w ? 'Q' : 'q', K = w ? 'K' : 'k';
      const pr = w ? r + 1 : r - 1; if (at(pr, c - 1) === P || at(pr, c + 1) === P) return true;
      for (const [dr, dc] of KN) if (at(r + dr, c + dc) === N) return true;
      for (const [dr, dc] of KG) if (at(r + dr, c + dc) === K) return true;
      for (const [dr, dc] of DG) for (let k = 1; k < 8; k++) { const p = at(r + dr * k, c + dc * k); if (p === ' ') continue; if (p === B || p === Q) return true; break; }
      for (const [dr, dc] of ST) for (let k = 1; k < 8; k++) { const p = at(r + dr * k, c + dc * k); if (p === ' ') continue; if (p === R || p === Q) return true; break; }
      return false;
    }
    const inCheck = (s, side = s.t) => attacked(s.b, find(s.b, side === 'w' ? 'K' : 'k'), side === 'w' ? 'b' : 'w');

    // Moves that follow the piece rules but may leave the king in check.
    function pseudo(s) {
      const out = [], b = s.b, me = s.t, mine = p => p !== ' ' && white(p) === (me === 'w');
      const add = (f, t, extra) => out.push(Object.assign({ f, t }, extra));
      for (let i = 0; i < 64; i++) {
        const p = b[i]; if (p === ' ' || !mine(p)) continue; const r = i >> 3, c = i & 7, k = p.toLowerCase();
        if (k === 'p') {
          const d = me === 'w' ? -1 : 1, start = me === 'w' ? 6 : 1, last = me === 'w' ? 0 : 7, r1 = r + d;
          const push = (to, cap, ep) => { if ((to >> 3) === last) for (const q of 'qrbn') add(i, to, { p: q, x: cap }); else add(i, to, { x: cap, ep }); };
          if (r1 >= 0 && r1 < 8) {
            if (b[r1 * 8 + c] === ' ') { push(r1 * 8 + c, false); if (r === start && b[(r + 2 * d) * 8 + c] === ' ') add(i, (r + 2 * d) * 8 + c, { dbl: true }); }
            for (const dc of [-1, 1]) { const cc = c + dc; if (cc < 0 || cc > 7) continue; const t = r1 * 8 + cc, q = b[t];
              if (q !== ' ' && !mine(q)) push(t, true); else if (t === s.ep) push(t, true, true); }
          }
        } else if (k === 'n' || k === 'k') {
          for (const [dr, dc] of k === 'n' ? KN : KG) { const rr = r + dr, cc = c + dc; if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue; const q = b[rr * 8 + cc]; if (q === ' ' || !mine(q)) add(i, rr * 8 + cc, { x: q !== ' ' }); }
          if (k === 'k') {
            const home = me === 'w' ? 60 : 4, enemy = me === 'w' ? 'b' : 'w';
            if (i === home && !attacked(b, i, enemy)) {
              const ks = me === 'w' ? 'K' : 'k', qs = me === 'w' ? 'Q' : 'q', rk = me === 'w' ? 'R' : 'r';
              if (s.c.includes(ks) && b[home + 1] === ' ' && b[home + 2] === ' ' && b[home + 3] === rk && !attacked(b, home + 1, enemy) && !attacked(b, home + 2, enemy)) add(i, home + 2, { castle: 'k' });
              if (s.c.includes(qs) && b[home - 1] === ' ' && b[home - 2] === ' ' && b[home - 3] === ' ' && b[home - 4] === rk && !attacked(b, home - 1, enemy) && !attacked(b, home - 2, enemy)) add(i, home - 2, { castle: 'q' });
            }
          }
        } else {
          const dirs = k === 'b' ? DG : k === 'r' ? ST : DG.concat(ST);
          for (const [dr, dc] of dirs) for (let n = 1; n < 8; n++) { const rr = r + dr * n, cc = c + dc * n; if (rr < 0 || rr > 7 || cc < 0 || cc > 7) break; const q = b[rr * 8 + cc];
            if (q === ' ') { add(i, rr * 8 + cc, {}); continue; } if (!mine(q)) add(i, rr * 8 + cc, { x: true }); break; }
        }
      }
      return out;
    }

    function make(s, m) {
      const b = s.b.split(''), p = b[m.f], n = clone(s), me = s.t, k = p.toLowerCase();
      let cap = b[m.t] !== ' ';
      b[m.t] = m.p ? (me === 'w' ? m.p.toUpperCase() : m.p) : p; b[m.f] = ' ';
      if (m.ep) { b[m.t + (me === 'w' ? 8 : -8)] = ' '; cap = true; }
      if (m.castle) { const home = m.f; if (m.castle === 'k') { b[home + 1] = b[home + 3]; b[home + 3] = ' '; } else { b[home - 1] = b[home - 4]; b[home - 4] = ' '; } }
      n.b = b.join(''); n.t = me === 'w' ? 'b' : 'w'; n.ep = m.dbl ? (m.f + m.t) / 2 : -1;
      let c = s.c;
      if (k === 'k') c = c.replace(me === 'w' ? /[KQ]/g : /[kq]/g, '');
      for (const [sqr, ch] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']]) if (m.f === sqr || m.t === sqr) c = c.replace(ch, '');
      n.c = c; n.hm = k === 'p' || cap ? 0 : s.hm + 1; n.fm = s.fm + (me === 'b' ? 1 : 0);
      return n;
    }
    function legal(s) { const out = []; for (const m of pseudo(s)) { const n = make(s, m); if (!inCheck(n, s.t)) out.push(m); } return out; }
    const key = s => s.b + s.t + s.c + (s.ep >= 0 && legal(s).some(m => m.ep) ? s.ep : -1);

    // 'e2e4' / 'e7e8q' → legal move object or null
    function parse(s, str) {
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(str || '')) return null;
      const f = idx(str.slice(0, 2)), t = idx(str.slice(2, 4)), p = str[4] || undefined;
      return legal(s).find(m => m.f === f && m.t === t && m.p === p) || null;
    }
    const uci = m => sq(m.f) + sq(m.t) + (m.p || '');

    // Algebraic notation for the move list, e.g. Nf3, exd5, O-O, e8=Q+
    function san(s, m) {
      const p = s.b[m.f], k = p.toLowerCase(); let t;
      if (m.castle) t = m.castle === 'k' ? 'O-O' : 'O-O-O';
      else {
        t = k === 'p' ? (m.x ? FILES[m.f & 7] + 'x' : '') : k.toUpperCase();
        if (k !== 'p') { const others = legal(s).filter(o => o.t === m.t && o.f !== m.f && s.b[o.f] === p);
          if (others.length) { const sameFile = others.some(o => (o.f & 7) === (m.f & 7)), sameRank = others.some(o => (o.f >> 3) === (m.f >> 3));
            t += !sameFile ? FILES[m.f & 7] : !sameRank ? 8 - (m.f >> 3) : sq(m.f); }
          if (m.x) t += 'x'; }
        t += sq(m.t); if (m.p) t += '=' + m.p.toUpperCase();
      }
      const n = make(s, m), L = legal(n); if (inCheck(n)) t += L.length ? '+' : '#';
      return t;
    }
    function insufficient(b) {
      const ps = b.replace(/ /g, '').replace(/[Kk]/g, '').toLowerCase().split('').sort().join('');
      if (!ps.length) return true; if (/^[bn]$/.test(ps)) return true;
      if (/^b+$/.test(ps)) { const sqs = []; for (let i = 0; i < 64; i++) if (b[i].toLowerCase() === 'b') sqs.push(((i >> 3) + (i & 7)) & 1); return sqs.every(x => x === sqs[0]); }
      return false;
    }
    // 'play' | 'check' | 'mate' | 'stalemate' | 'fifty' | 'material'  (repetition is decided by the caller, who keeps the history)
    function status(s) {
      const L = legal(s), chk = inCheck(s);
      if (!L.length) return chk ? 'mate' : 'stalemate';
      if (insufficient(s.b)) return 'material';
      if (s.hm >= 100) return 'fifty';
      return chk ? 'check' : 'play';
    }
    return { init, legal, make, parse, uci, san, status, inCheck, key, sq, idx, white, START };
  })();

  // ------------------------------------------------------------------ battleship
  const SHIPS = [{ n: 'Carrier', l: 5 }, { n: 'Battleship', l: 4 }, { n: 'Cruiser', l: 3 }, { n: 'Submarine', l: 3 }, { n: 'Destroyer', l: 2 }];
  const Sea = {
    SHIPS, N: 10,
    // board: array(100) of ship index (0-4) or -1. Returns cells of ship s placed at (r,c) horizontal/vertical, or null if off the grid or overlapping.
    cells(board, s, r, c, vert) {
      const out = []; for (let k = 0; k < SHIPS[s].l; k++) { const rr = r + (vert ? k : 0), cc = c + (vert ? 0 : k); if (rr > 9 || cc > 9 || rr < 0 || cc < 0) return null; const i = rr * 10 + cc; if (board[i] !== -1 && board[i] !== s) return null; out.push(i); }
      return out;
    },
    empty: () => new Array(100).fill(-1),
    place(board, s, r, c, vert) { const b = board.map(v => v === s ? -1 : v), cs = Sea.cells(b, s, r, c, vert); if (!cs) return null; cs.forEach(i => { b[i] = s; }); return b; },
    random(rand = Math.random) {
      let b = Sea.empty(); for (let s = 0; s < SHIPS.length; s++) { for (let tries = 0; tries < 500; tries++) { const nb = Sea.place(b, s, Math.floor(rand() * 10), Math.floor(rand() * 10), rand() < .5); if (nb) { b = nb; break; } } }
      return b;
    },
    // A fleet is valid when it holds exactly the five ships, each a straight unbroken line.
    valid(board) {
      if (!Array.isArray(board) || board.length !== 100) return false;
      for (let s = 0; s < SHIPS.length; s++) {
        const cs = []; board.forEach((v, i) => { if (v === s) cs.push(i); }); if (cs.length !== SHIPS[s].l) return false;
        const rs = new Set(cs.map(i => i / 10 | 0)), ccs = new Set(cs.map(i => i % 10)); let ok = false;
        if (rs.size === 1) { const a = cs.map(i => i % 10); ok = Math.max(...a) - Math.min(...a) === cs.length - 1; }
        else if (ccs.size === 1) { const a = cs.map(i => i / 10 | 0); ok = Math.max(...a) - Math.min(...a) === cs.length - 1; }
        if (!ok) return false;
      }
      return board.every(v => Number.isInteger(v) && v >= -1 && v < SHIPS.length);
    },
    // Result of a shot at cell i given which cells were already shot at. → { r:'miss'|'hit'|'sunk', n:shipIndex, over:boolean }
    shoot(board, shots, i) {
      const v = board[i]; if (v < 0) return { r: 'miss', over: false };
      const left = []; board.forEach((s, k) => { if (s === v && k !== i && !shots.includes(k)) left.push(k); });
      const all = board.every((s, k) => s < 0 || k === i || shots.includes(k));
      return { r: left.length ? 'hit' : 'sunk', n: v, over: all };
    },
    // The string both players commit to before the first shot.
    pack: (board, salt) => salt + ':' + board.map(v => v < 0 ? '.' : v).join('')
  };

  // ------------------------------------------------------------------ word race
  const Word = {
    // 0 = absent (grey), 1 = in the word elsewhere (yellow), 2 = right place (green)
    score(guess, word) {
      const r = [0, 0, 0, 0, 0], left = {};
      for (let i = 0; i < 5; i++) { if (guess[i] === word[i]) r[i] = 2; else left[word[i]] = (left[word[i]] || 0) + 1; }
      for (let i = 0; i < 5; i++) if (r[i] !== 2 && left[guess[i]] > 0) { r[i] = 1; left[guess[i]]--; }
      return r.join('');
    },
    // Decide who won from both players' results: { solved, n, ms }.
    winner(a, b) {
      if (a.solved && !b.solved) return 'a'; if (b.solved && !a.solved) return 'b';
      if (!a.solved && !b.solved) return 'none';
      if (a.n !== b.n) return a.n < b.n ? 'a' : 'b';
      if (a.ms !== b.ms) return a.ms < b.ms ? 'a' : 'b';
      return 'tie';
    }
  };

  const core = { Chess, Sea, Word, sq, idx };
  if (typeof module !== 'undefined' && module.exports) module.exports = core; else root.HUSH_GAMES_CORE = core;
})(typeof window !== 'undefined' ? window : globalThis);
