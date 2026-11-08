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


  // ------------------------------------------------------------------ small seeded random numbers (same course on both phones)
  function hash32(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function rng(seed) { let a = typeof seed === 'string' ? hash32(seed) : seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ------------------------------------------------------------------ golf: mini golf (ball) and disc golf (disc)
  // Top-down courses made from a seed. One shot = { a: angle in radians, p: power 0..1, c: curve -1..1 (disc only) }.
  // The flight is simulated in fixed small steps with plain arithmetic, so both phones land in the same place.
  const Golf = (() => {
    const W = 280, H = 560, HOLES = 3, MAXS = 8;
    const BR = 5, HR = 9;                       // ball radius, cup radius
    const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
    const round = (v, d) => { const m = Math.pow(10, d); return Math.round(v * m) / m; };
    function course(kind, seed, h) {
      const R = rng(seed + ':' + kind + ':' + h), disc = kind === 'disc';
      const c = { W, H, kind, h, blocks: [], water: [], sand: [], trees: [] };
      c.tee = { x: 60 + R() * (W - 120), y: H - 50 };
      const minD = disc ? 300 + h * 70 : 260 + h * 40, maxD = disc ? 520 : 440;
      for (let tries = 0; tries < 200; tries++) { const x = 40 + R() * (W - 80), y = 40 + R() * 90 + (disc ? 0 : R() * 60), d = Math.hypot(x - c.tee.x, y - c.tee.y); c.hole = { x, y }; if (d >= minD && d <= maxD) break; }
      const clear = (x, y, r) => Math.hypot(x - c.tee.x, y - c.tee.y) > r + 34 && Math.hypot(x - c.hole.x, y - c.hole.y) > r + 34;
      const lerpPt = t => ({ x: c.tee.x + (c.hole.x - c.tee.x) * t, y: c.tee.y + (c.hole.y - c.tee.y) * t });
      if (disc) {
        const nT = 3 + h * 2; for (let i = 0; i < nT; i++) { for (let k = 0; k < 30; k++) { const r = 11 + R() * 8, t = .2 + R() * .65, q = lerpPt(t), x = clamp(q.x + (R() - .5) * 110, 24, W - 24), y = q.y + (R() - .5) * 60; if (clear(x, y, r)) { c.trees.push({ x: round(x, 1), y: round(y, 1), r: round(r, 1) }); break; } } }
        if (h >= 1) { const q = lerpPt(.45 + R() * .25); const w = 70 + R() * 50; c.water.push({ x: clamp(q.x - w / 2 + (R() - .5) * 60, 10, W - 10 - w), y: q.y - 22, w: round(w, 1), h: 44 }); }
        c.par = clamp(Math.ceil(Math.hypot(c.hole.x - c.tee.x, c.hole.y - c.tee.y) / 260) + 1, 2, 4);
      } else {
        const nB = h === 0 ? 1 : 1 + h; for (let i = 0; i < nB; i++) { for (let k = 0; k < 30; k++) { const w = 46 + R() * 60, hh = 14 + R() * 10, t = .25 + R() * .5, q = lerpPt(t), x = clamp(q.x - w / 2 + (R() - .5) * 40, 14, W - 14 - w), y = q.y - hh / 2 + (R() - .5) * 40; if (clear(x + w / 2, y + hh / 2, Math.max(w, hh) / 2)) { c.blocks.push({ x: round(x, 1), y: round(y, 1), w: round(w, 1), h: round(hh, 1) }); break; } } }
        if (h >= 1) { const q = lerpPt(.35 + R() * .3), w = 60 + R() * 40; c.sand.push({ x: clamp(q.x - w / 2 + (R() - .5) * 70, 10, W - 10 - w), y: q.y - 20, w: round(w, 1), h: 40 }); }
        if (h >= 2) { const q = lerpPt(.55 + R() * .2), w = 50 + R() * 40; c.water.push({ x: clamp(q.x - w / 2 + (R() - .5) * 90, 10, W - 10 - w), y: q.y - 14, w: round(w, 1), h: 28 }); }
        c.par = 2 + (h > 0 ? 1 : 0);
      }
      c.tee.x = round(c.tee.x, 1); c.hole.x = round(c.hole.x, 1); c.hole.y = round(c.hole.y, 1);
      return c;
    }
    const inRect = (r, x, y, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
    // Returns { trace: [[x,y],...] (30 points a second), end: {x,y}, sunk, water }
    function sim(c, pos, shot) {
      const disc = c.kind === 'disc', trace = [[pos.x, pos.y]]; let x = pos.x, y = pos.y, steps = 0;
      const a = shot.a, p = clamp(shot.p, 0, 1), dt = 1 / 120;
      if (!disc) {
        let vx = Math.cos(a) * (40 + 440 * p), vy = Math.sin(a) * (40 + 440 * p);
        while (steps++ < 3600) {
          let sp = Math.sqrt(vx * vx + vy * vy); if (sp < 7) break;
          const sand = c.sand.some(r => inRect(r, x, y)), dec = (sand ? 760 : 170) * dt, ns = Math.max(0, sp - dec); vx *= ns / sp; vy *= ns / sp;
          x += vx * dt; y += vy * dt;
          if (x < BR) { x = BR; vx = -vx * .8; } else if (x > W - BR) { x = W - BR; vx = -vx * .8; }
          if (y < BR) { y = BR; vy = -vy * .8; } else if (y > H - BR) { y = H - BR; vy = -vy * .8; }
          for (const b of c.blocks) { const cx = clamp(x, b.x, b.x + b.w), cy = clamp(y, b.y, b.y + b.h), dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
            if (d2 < BR * BR) { if (d2 === 0) { vy = -vy; y -= 2; continue; } const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, dot = vx * nx + vy * ny; if (dot < 0) { vx = (vx - 2 * dot * nx) * .8; vy = (vy - 2 * dot * ny) * .8; } x = cx + nx * (BR + .01); y = cy + ny * (BR + .01); } }
          if (c.water.some(r => inRect(r, x, y))) { trace.push([x, y]); return { trace, end: { x, y }, sunk: false, water: true }; }
          const dh = Math.hypot(x - c.hole.x, y - c.hole.y); sp = Math.sqrt(vx * vx + vy * vy);
          if (dh < HR && sp < 300) { trace.push([c.hole.x, c.hole.y]); return { trace, end: { x: c.hole.x, y: c.hole.y }, sunk: true, water: false }; }
          if (steps % 4 === 0) trace.push([x, y]);
        }
        trace.push([x, y]); return { trace, end: { x, y }, sunk: false, water: false };
      }
      // disc: flies for a set time, slowing and turning (curve < 0 bends left, > 0 right), then skids a little
      const v0 = 6 + 514 * p * p, T = 1.5, cv = clamp(shot.c || 0, -1, 1); let th = a, lt = 0, lx = x, ly = y;
      while (lt < T) {
        lt += dt; const f = lt / T; th = a + cv * 1.1 * f * Math.sqrt(f); const sp = v0 * (1 - .4 * f);
        lx = x; ly = y; x += Math.cos(th) * sp * dt; y += Math.sin(th) * sp * dt; steps++;
        if (x < 4 || x > W - 4 || y < 4 || y > H - 4) { x = clamp(x, 4, W - 4); y = clamp(y, 4, H - 4); break; }
        const tr = c.trees.find(t => Math.hypot(x - t.x, y - t.y) < t.r + 3); if (tr) { x = lx; y = ly; break; }
        if (steps % 4 === 0) trace.push([x, y]);
      }
      const roll = tr => tr; const sk = 14 * p;                      // a short skid after landing
      let sx = x + Math.cos(th) * sk, sy = y + Math.sin(th) * sk; if (!c.trees.some(t => Math.hypot(sx - t.x, sy - t.y) < t.r + 3) && sx > 4 && sx < W - 4 && sy > 4 && sy < H - 4) { x = sx; y = sy; }
      trace.push([x, y]);
      if (Math.hypot(x - c.hole.x, y - c.hole.y) < 15) { trace.push([c.hole.x, c.hole.y]); return { trace, end: { x: c.hole.x, y: c.hole.y }, sunk: true, water: false }; }
      if (c.water.some(r => inRect(r, x, y))) return { trace, end: { x, y }, sunk: false, water: true };
      return { trace, end: { x: round(x, 2), y: round(y, 2) }, sunk: false, water: false };
    }
    // The computer's throw: try many shots, keep the one that ends nearest the hole, then add some human wobble.
    function aiShot(c, pos, rand, skill) {
      const direct = Math.atan2(c.hole.y - pos.y, c.hole.x - pos.x), dist = Math.hypot(c.hole.x - pos.x, c.hole.y - pos.y), disc = c.kind === 'disc'; let best = null, bd = 1e9;
      for (let i = 0; i < 90; i++) {
        const a = direct + (rand() - .5) * (i < 20 ? .08 : 1.3), p = clamp((disc ? Math.sqrt(Math.max(0, (dist / 1.2 - 6) / 514)) : (Math.sqrt(2 * 170 * dist) - 40) / 440) * (.5 + rand() * .8), .02, 1), cu = disc ? (rand() - .5) * 1.4 : 0;
        const r = sim(c, pos, { a, p, c: cu }), d = r.sunk ? -50 : Math.hypot(r.end.x - c.hole.x, r.end.y - c.hole.y) + (r.water ? 400 : 0); if (d < bd) { bd = d; best = { a, p, c: cu }; } }
      const wob = (1.25 - skill) * .22; return { a: best.a + (rand() - .5) * wob, p: clamp(best.p * (1 + (rand() - .5) * wob * 1.6), .02, 1), c: best.c };
    }
    // Plays a whole hole for the computer (skill 0..1). Returns the number of strokes.
    function aiHole(c, rand, skill) {
      let pos = { x: c.tee.x, y: c.tee.y }, last = pos, n = 0;
      while (n < MAXS) { const sh = aiShot(c, pos, rand, skill), r = sim(c, pos, sh); n++; if (r.sunk) return n; if (r.water) { n++; pos = last; continue; } last = pos = r.end; }
      return MAXS;
    }
    return { W, H, HOLES, MAXS, course, sim, aiShot, aiHole, HR, BR, inRect };
  })();

  // ------------------------------------------------------------------ the computer's chess
  const ChessAI = (() => {
    const V = { p: 100, n: 320, b: 335, r: 500, q: 920, k: 0 };
    // Piece-square tables (white's view, row 0 = rank 8). Black reads them mirrored.
    const T = {
      p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
      n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
      b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
      r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
      q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
      k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
      ke: [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50]
    };
    // Static evaluation from White's point of view: material + placement + pawn structure + bishop pair + rooks + king safety.
    function evalPos(s) {
      const b = s.b; let sc = 0, mat = 0; const pawns = { w: [0,0,0,0,0,0,0,0], b: [0,0,0,0,0,0,0,0] }, pr = { w: [], b: [] }, bish = { w: 0, b: 0 }, rooks = [], kings = {};
      for (let i = 0; i < 64; i++) { const p = b[i]; if (p === ' ') continue; const k = p.toLowerCase(); if (k !== 'p' && k !== 'k') mat += V[k]; }
      const endg = mat < 2600;
      for (let i = 0; i < 64; i++) {
        const p = b[i]; if (p === ' ') continue; const w = p === p.toUpperCase(), k = p.toLowerCase(), j = w ? i : (7 - (i >> 3)) * 8 + (i & 7), sg = w ? 1 : -1;
        let v = V[k] + (k === 'k' ? (endg ? T.ke[j] : T.k[j]) : T[k][j]);
        if (k === 'p') { pawns[w ? 'w' : 'b'][i & 7]++; pr[w ? 'w' : 'b'].push(i); }
        else if (k === 'b') bish[w ? 'w' : 'b']++;
        else if (k === 'r') rooks.push(i); else if (k === 'k') kings[w ? 'w' : 'b'] = i;
        sc += sg * v;
      }
      if (bish.w > 1) sc += 35; if (bish.b > 1) sc -= 35;
      for (const side of ['w', 'b']) { const sg = side === 'w' ? 1 : -1, foe = side === 'w' ? 'b' : 'w', P = side === 'w' ? 'P' : 'p', FP = side === 'w' ? 'p' : 'P';
        for (let f = 0; f < 8; f++) { const n = pawns[side][f]; if (n > 1) sc -= sg * 14 * (n - 1); if (n && !(f > 0 && pawns[side][f - 1]) && !(f < 7 && pawns[side][f + 1])) sc -= sg * 12 * n; }
        for (const i of pr[side]) { const f = i & 7, r = i >> 3; let passed = true;
          for (let rr = side === 'w' ? r - 1 : r + 1; rr >= 0 && rr < 8 && passed; rr += side === 'w' ? -1 : 1) for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1); ff++) if (b[rr * 8 + ff] === FP) { passed = false; break; }
          if (passed) { const adv = side === 'w' ? 6 - r : r - 1; sc += sg * (10 + adv * adv * 4 + (endg ? adv * 6 : 0)); } }
        const ki = kings[side];
        if (ki != null && !endg) { const kr = ki >> 3, kf = ki & 7, dr = side === 'w' ? -1 : 1; let sh = 0;
          for (let ff = Math.max(0, kf - 1); ff <= Math.min(7, kf + 1); ff++) { const r1 = kr + dr, r2 = kr + 2 * dr; if (r1 >= 0 && r1 < 8 && b[r1 * 8 + ff] === P) sh += 10; else if (r2 >= 0 && r2 < 8 && b[r2 * 8 + ff] === P) sh += 5; else sh -= 8; }
          sc += sg * sh; }
        // king in the middle with no castling rights left and the centre open is a liability
        void foe;
      }
      for (const i of rooks) { const w = b[i] === 'R', f = i & 7, own = pawns[w ? 'w' : 'b'][f], opp = pawns[w ? 'b' : 'w'][f]; const bonus = !own ? (!opp ? 18 : 9) : 0; sc += w ? bonus : -bonus;
        if ((i >> 3) === (w ? 1 : 6)) sc += w ? 12 : -12; }
      if (endg && kings.w != null && kings.b != null) { // when ahead, push the enemy king to the edge and bring ours close
        const d = Math.abs((kings.w >> 3) - (kings.b >> 3)) + Math.abs((kings.w & 7) - (kings.b & 7)), edge = k => Math.max(Math.abs(3.5 - (k >> 3)), Math.abs(3.5 - (k & 7)));
        if (sc > 150) sc += (edge(kings.b) * 14) + (14 - d) * 4; else if (sc < -150) sc -= (edge(kings.w) * 14) + (14 - d) * 4; }
      return Math.round(sc);
    }
    const nullMove = s => ({ b: s.b, t: s.t === 'w' ? 'b' : 'w', c: s.c, ep: -1, hm: s.hm + 1, fm: s.fm });
    const MATE = 100000;
    let tt = new Map(), hist = new Map(), killers = [], nodes = 0;
    const tkey = s => s.b + s.t + s.c + s.ep;
    const mkey = m => m.f * 64 + m.t;
    function orderMoves(s, ms, ttm, ply) {
      const kl = killers[ply] || [];
      return ms.map(m => { let k = 0; const tgt = s.b[m.t];
        if (ttm && mkey(m) === ttm) k = 1e6;
        else if (tgt !== ' ' || m.ep) k = 10000 + 10 * V[(m.ep ? 'p' : tgt).toLowerCase()] - V[s.b[m.f].toLowerCase()] / 10;
        else if (m.p) k = 9000; else if (kl[0] === mkey(m)) k = 8000; else if (kl[1] === mkey(m)) k = 7900; else k = (hist.get(mkey(m)) || 0) + (m.castle ? 30 : 0);
        return { m, k }; }).sort((a, b) => b.k - a.k).map(x => x.m);
    }
    function quiesce(s, al, be, q, deadline) {
      if ((++nodes & 511) === 0 && Date.now() > deadline) throw 'time';
      const sg = s.t === 'w' ? 1 : -1, st = sg * evalPos(s); if (q > 6) return st; if (st >= be) return st; if (st > al) al = st;
      const ms = Chess.legal(s).filter(m => s.b[m.t] !== ' ' || m.ep || m.p);
      for (const m of orderMoves(s, ms, 0, 0)) { const v = -quiesce(Chess.make(s, m), -be, -al, q + 1, deadline); if (v >= be) return v; if (v > al) al = v; }
      return al;
    }
    function search(s, d, al, be, ply, deadline, canNull, path) {
      if ((++nodes & 511) === 0 && Date.now() > deadline) throw 'time';
      if (s.hm >= 100) return 0;
      const k = tkey(s); if (ply > 0 && path.has(k)) return 0;
      const inChk = Chess.inCheck(s); if (inChk) d++;
      if (d <= 0) return quiesce(s, al, be, 0, deadline);
      const e = tt.get(k), al0 = al; let ttm = 0;
      if (e) { ttm = e.m; if (e.d >= d && ply > 0) { if (e.f === 0) return e.v; if (e.f === 1 && e.v >= be) return e.v; if (e.f === 2 && e.v <= al) return e.v; } }
      const sg = s.t === 'w' ? 1 : -1;
      if (canNull && !inChk && d >= 3 && /[NBRQnbrq]/.test(s.b) && sg * evalPos(s) >= be) { const v = -search(nullMove(s), d - 3, -be, -be + 1, ply + 1, deadline, false, path); if (v >= be) return v; }
      const ms = Chess.legal(s); if (!ms.length) return inChk ? -MATE + ply : 0;
      let best = -1e9, bm = 0, i = 0; path.add(k);
      try {
        for (const m of orderMoves(s, ms, ttm, ply)) {
          const quiet = s.b[m.t] === ' ' && !m.ep && !m.p, n = Chess.make(s, m); let v;
          if (i > 3 && d >= 3 && quiet && !inChk) { v = -search(n, d - 2, -al - 1, -al, ply + 1, deadline, true, path); if (v > al) v = -search(n, d - 1, -be, -al, ply + 1, deadline, true, path); }
          else v = -search(n, d - 1, -be, -al, ply + 1, deadline, true, path);
          i++;
          if (v > best) { best = v; bm = mkey(m); } if (v > al) al = v;
          if (al >= be) { if (quiet) { const kl = killers[ply] || (killers[ply] = []); if (kl[0] !== mkey(m)) { kl[1] = kl[0]; kl[0] = mkey(m); } hist.set(mkey(m), (hist.get(mkey(m)) || 0) + d * d); } break; }
        }
      } finally { path.delete(k); }
      if (tt.size > 250000) tt.clear();
      tt.set(k, { v: best, d, m: bm, f: best <= al0 ? 2 : best >= be ? 1 : 0 });
      return best;
    }
    // A few sound opening moves, so games do not all start the same way.
    const BOOK_W = ['e2e4', 'd2d4', 'g1f3', 'c2c4', 'e2e4'], BOOK_B = { e2e4: ['e7e5', 'c7c5', 'e7e6', 'c7c6'], d2d4: ['d7d5', 'g8f6', 'e7e6'], g1f3: ['d7d5', 'g8f6', 'c7c5'], c2c4: ['e7e5', 'g8f6', 'c7c5'] };
    // lvl 1 easy, 2 medium, 3 hard. Returns a legal move object. hist = earlier position keys (for repetition).
    function pick(s, lvl, rand = Math.random, seen) {
      const ms = Chess.legal(s); if (!ms.length) return null; if (ms.length === 1) return ms[0];
      if (s.fm === 1 && lvl > 1) {
        if (s.t === 'w') { const m = Chess.parse(s, BOOK_W[Math.floor(rand() * BOOK_W.length)]); if (m) return m; }
        else for (const [u, rep] of Object.entries(BOOK_B)) { const w1 = Chess.parse(Chess.init(), u); if (w1 && Chess.make(Chess.init(), w1).b === s.b) { const m = Chess.parse(s, rep[Math.floor(rand() * rep.length)]); if (m) return m; } }
      }
      const cap = lvl === 1 ? 2 : lvl === 2 ? 5 : 8, budget = lvl === 1 ? 300 : lvl === 2 ? 1000 : 2000, deadline = Date.now() + budget;
      tt = new Map(); hist = new Map(); killers = []; nodes = 0;
      const path = new Set(seen || []); path.delete(tkey(s));
      let order = orderMoves(s, ms, 0, 0), bestMove = order[0], scored = [];
      for (let d = 1; d <= cap; d++) {
        const cur = []; let alpha = -1e9; try {
          for (const m of order) { const n = Chess.make(s, m); const v = -search(n, d - 1, -1e9, -alpha, 1, deadline, true, path); cur.push({ m, v }); if (v > alpha) alpha = v; }
        } catch (e) { if (e !== 'time') throw e; if (cur.length > 1) { cur.sort((a, b) => b.v - a.v); if (cur[0].v > (scored[0] ? scored[0].v : -1e9) - 60) { const rest = order.filter(m => !cur.some(c => c.m === m)); scored = cur.concat(rest.map(m => ({ m, v: -1e9 }))); } } break; }
        cur.sort((a, b) => b.v - a.v); scored = cur; order = cur.map(x => x.m);
        if (Math.abs(cur[0].v) > MATE - 200) break;
      }
      if (!scored.length) return bestMove;
      if (lvl === 1) { const top = scored.slice(0, 4), w = top[Math.floor(rand() * Math.min(top.length, rand() < .5 ? 1 : 4))]; return w.m; }
      if (lvl === 2 && scored.length > 1 && rand() < .3 && scored[0].v - scored[1].v < 25) return scored[1].m;
      return scored[0].m;
    }
    return { pick, evalPos, tkey };
  })();

  // ------------------------------------------------------------------ the computer's Battleship
  const SeaAI = {
    // shots: array of cells already fired, res: {cell: {r,n}}, sunk: ship indices already sunk. lvl 1..3
    pick(shots, res, sunk, lvl, rand = Math.random) {
      const tried = new Set(shots), free = []; for (let i = 0; i < 100; i++) if (!tried.has(i)) free.push(i);
      // hits that belong to a ship that is not sunk yet
      const open = shots.filter(i => res[i] && res[i].r === 'hit');
      const sunkCells = new Set(); // a sunk ship's cells are not known exactly; assume hits next to the sinking shot belong to it when lengths allow (kept simple: treat all hits as open unless every ship is accounted for)
      const live = SHIPS.map((s, i) => i).filter(i => !sunk.includes(i));
      if (lvl === 1) { const adj = []; for (const h of open) for (const d of [-10, 10, -1, 1]) { const j = h + d; if (j >= 0 && j < 100 && !tried.has(j) && !((d === 1 && h % 10 === 9) || (d === -1 && h % 10 === 0))) adj.push(j); }
        if (adj.length && rand() < .8) return adj[Math.floor(rand() * adj.length)]; return free[Math.floor(rand() * free.length)]; }
      // probability map: count every way each live ship could still fit; placements covering open hits count much more
      const score = new Array(100).fill(0), hitSet = new Set(open);
      for (const s of live) { const L = SHIPS[s].l; for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) for (const v of [0, 1]) {
        const cells = []; let ok = true; for (let k = 0; k < L; k++) { const rr = r + (v ? k : 0), cc = c + (v ? 0 : k); if (rr > 9 || cc > 9) { ok = false; break; } const i = rr * 10 + cc; if (tried.has(i) && !hitSet.has(i)) { ok = false; break; } cells.push(i); }
        if (!ok) continue; const cov = cells.filter(i => hitSet.has(i)).length; const w = open.length ? (cov ? 40 * cov : 1) : 1; for (const i of cells) if (!tried.has(i)) score[i] += w; } }
      let bestV = -1, bests = []; for (const i of free) { const v = score[i] + (lvl === 2 ? rand() * 2 : 0) + (lvl === 3 && (((i / 10 | 0) + i % 10) & 1) ? .01 : 0); if (v > bestV + 1e-9) { bestV = v; bests = [i]; } else if (Math.abs(v - bestV) < 1e-9) bests.push(i); }
      return bests[Math.floor(rand() * bests.length)];
    }
  };

  const core = { Chess, Sea, Word, Golf, ChessAI, SeaAI, rng, hash32, sq, idx };
  if (typeof module !== 'undefined' && module.exports) module.exports = core; else root.HUSH_GAMES_CORE = core;
})(typeof window !== 'undefined' ? window : globalThis);
