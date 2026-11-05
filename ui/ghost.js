// Hush the ghost, on the start page. Two modes (Customize on the start page):
//   buddy - a friendly ghost that floats about, watches your finger, and does tricks for taps, swipes and holds.
//   pet   - a pocket-pet: it gets hungry, bored, tired and messy while you're away. Check in to keep it alive.
// HUSH_GHOST.mount(el, mode) draws into el; HUSH_GHOST.stop() cleans up timers.
window.HUSH_GHOST = window.HUSH_GHOST || (() => {
  const KEY = 'hush.ghost.pet', HOUR = 3600e3;
  const rd = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const wr = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} };
  const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  let timers = [], offs = [];
  const stop = () => { timers.forEach(clearInterval); timers.forEach(clearTimeout); timers = []; offs.forEach(f => f()); offs = []; };

  const css = `.hg{position:relative;width:min(340px,92%);margin:6px auto 0;user-select:none;-webkit-user-select:none;touch-action:none;color:var(--ink,#eee)}
  .hg *{box-sizing:border-box}
  .hg-stage{position:relative;height:190px;display:grid;place-items:end center;overflow:visible}
  .hg-body{width:122px;height:132px;position:relative;cursor:pointer;will-change:transform;filter:drop-shadow(0 10px 12px #0005);transform-origin:50% 100%}
  .hg-body svg{width:100%;height:100%;overflow:visible;display:block}
  .hg-bob{animation:hgbob 3.2s ease-in-out infinite}
  @keyframes hgbob{50%{transform:translateY(-9px)}}
  .hg .eye{transform-box:fill-box;transform-origin:center;animation:hgbl 4.6s infinite}
  @keyframes hgbl{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.08)}}
  .hg .pup{transition:transform .12s}
  .hg .arm{transform-box:fill-box;transform-origin:50% 0}
  .hg-sh{position:absolute;bottom:2px;left:50%;width:84px;height:12px;margin-left:-42px;border-radius:50%;background:#0005;filter:blur(4px);pointer-events:none;animation:hgsh 3.2s ease-in-out infinite}
  @keyframes hgsh{50%{transform:scale(.78);opacity:.6}}
  .hg-say{position:absolute;left:50%;top:-6px;transform:translate(-50%,6px);opacity:0;max-width:92%;padding:8px 14px;border-radius:16px;background:var(--card,#222);color:var(--ink,#eee);border:1px solid var(--line,#444);font:600 13px/1.3 system-ui;text-align:center;transition:all .25s;pointer-events:none;z-index:3;white-space:nowrap}
  .hg-say.on{opacity:1;transform:translate(-50%,0)}
  .hg-note{position:absolute;font:700 16px system-ui;color:var(--acc,#4da3ff);pointer-events:none;animation:hgn 1.4s ease-out forwards}
  @keyframes hgn{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-46px) rotate(12deg)}}
  .hg-bar{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 4px 4px}
  .hg-m{display:grid;gap:3px;font:600 11px system-ui;color:var(--mute,#999);text-align:center}.hg-m i{display:block;height:6px;border-radius:9px;background:color-mix(in srgb,var(--ink,#eee) 14%,transparent);overflow:hidden}.hg-m i b{display:block;height:100%;border-radius:9px;background:var(--acc,#4da3ff);transition:width .5s,background .3s}.hg-m.low i b{background:#ef4444}
  .hg-act{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:8px;margin:10px 4px 0}
  .hg-act button{all:unset;cursor:pointer;text-align:center;padding:10px 0;border-radius:14px;font:700 13px system-ui;color:var(--ink,#eee);background:color-mix(in srgb,var(--ink,#eee) 10%,transparent);transition:transform .12s,background .15s}
  .hg-act button:active{transform:scale(.94)}.hg-act button:hover{background:color-mix(in srgb,var(--ink,#eee) 17%,transparent)}
  .hg-foot{margin:10px 0 0;text-align:center;font:12px system-ui;color:var(--mute,#999)}
  .hg-dim{position:absolute;inset:-14px -10px;border-radius:26px;background:#05060ccc;opacity:0;pointer-events:none;transition:opacity .6s}.hg.sleep .hg-dim{opacity:1}
  .hg-z{position:absolute;right:26%;top:14px;font:800 18px system-ui;color:#cfe;opacity:0;pointer-events:none}.hg.sleep .hg-z{animation:hgz 2.4s ease-in-out infinite}
  @keyframes hgz{0%{opacity:0;transform:translate(0,12px) scale(.7)}50%{opacity:1}100%{opacity:0;transform:translate(14px,-24px) scale(1.1)}}
  .hg-mess{position:absolute;bottom:6px;width:34px;height:14px;border-radius:50%;background:#58c26b;opacity:.9;cursor:pointer;box-shadow:inset 0 -3px 0 #3e9a50}
  .hg-egg{width:92px;height:116px;margin:auto auto 0;animation:hgegg 4.5s ease-in-out infinite}
  @keyframes hgegg{0%,68%,100%{transform:rotate(0)}72%{transform:rotate(-7deg)}77%{transform:rotate(7deg)}82%{transform:rotate(-5deg)}87%{transform:rotate(3deg)}}
  .hg-snack{display:grid;place-items:center;background:none!important;box-shadow:none!important}.hg-snack svg{width:100%;height:100%;overflow:visible}
  .hg-bub{position:absolute;border-radius:50%;pointer-events:none;background:radial-gradient(circle at 30% 28%,#fff9,#8fd3ff55 60%,#fff2);border:1px solid #fff8}
  .hg-conf{position:absolute;width:8px;height:12px;pointer-events:none;border-radius:2px}
  .hg-ball{position:absolute;width:40px;height:40px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff,var(--acc,#4da3ff) 60%);box-shadow:0 6px 14px #0006;cursor:pointer;transition:left .35s,top .35s}
  .hg-snack{position:absolute;left:50%;top:-30px;width:34px;height:34px;margin-left:-17px;pointer-events:none;z-index:4}
  .hg.dead .hg-body{opacity:.45;filter:grayscale(1) blur(.3px)}
  @media (prefers-reduced-motion:reduce){.hg *{animation:none!important}}`;

  const body = (o = {}) => {
    const st = o.stage || 'adult';
    const acc = 'var(--acc,#4da3ff)';
    const mouth = o.mouth || 'smile';
    const M = { smile: '<path d="M50 74q10 9 20 0" stroke="#111" stroke-width="3" fill="none" stroke-linecap="round"/>',
      open: '<ellipse cx="60" cy="78" rx="8" ry="9" fill="#5a1d33"/>', flat: '<path d="M52 78h16" stroke="#111" stroke-width="3" stroke-linecap="round"/>',
      sad: '<path d="M50 80q10-9 20 0" stroke="#111" stroke-width="3" fill="none" stroke-linecap="round"/>', big: '<path d="M46 72q14 20 28 0z" fill="#5a1d33"/>' }[mouth];
    const eyes = o.closed ? '<path d="M38 58q8 7 16 0M66 58q8 7 16 0" stroke="#111" stroke-width="3" fill="none" stroke-linecap="round"/>'
      : `<g class="eye"><ellipse cx="46" cy="58" rx="${st === 'baby' ? 9.5 : 8}" ry="${o.droop ? 7 : st === 'baby' ? 12 : 10}" fill="#111"/><circle class="pup" cx="46" cy="58" r="3" fill="#fff"/></g><g class="eye"><ellipse cx="74" cy="58" rx="${st === 'baby' ? 9.5 : 8}" ry="${o.droop ? 7 : st === 'baby' ? 12 : 10}" fill="#111"/><circle class="pup" cx="74" cy="58" r="3" fill="#fff"/></g>`;
    return `<svg viewBox="0 0 120 132"><path d="M14 124V58C14 26 34 6 60 6s46 20 46 52v66l-15-12-15 12-16-12-16 12-15-12z" fill="${o.sick ? '#d7f0d3' : '#fff'}" stroke="${acc}" stroke-width="4" stroke-linejoin="round"/>
      <path class="arm l" d="M16 76q-12 4-10 16" stroke="${acc}" stroke-width="6" fill="none" stroke-linecap="round"/><path class="arm r" d="M104 76q12 4 10 16" stroke="${acc}" stroke-width="6" fill="none" stroke-linecap="round"/>
      ${eyes}${M}<ellipse cx="32" cy="72" rx="6" ry="3.4" fill="#ff9db5" opacity=".7"/><ellipse cx="88" cy="72" rx="6" ry="3.4" fill="#ff9db5" opacity=".7"/>
      ${o.shades ? '<path d="M30 52h60v10c0 6-6 10-14 10s-12-4-16-8c-4 4-8 8-16 8s-14-4-14-10z" fill="#111"/>' : ''}
      ${o.scarf ? `<path d="M22 96q38 14 76 0v10q-38 14-76 0z" fill="${acc}"/><path d="M80 104l6 22h-9z" fill="${acc}"/>` : ''}
      ${o.hat ? `<path d="M34 16q26-24 52 0z" fill="${acc}"/><circle cx="60" cy="0" r="5" fill="#fff"/>` : ''}
      ${st === 'baby' ? `<path d="M56 8q-6-12 4-14q10 2 2 12" stroke="#111" stroke-width="3" fill="none" stroke-linecap="round"/>${!o.mouth || o.mouth === 'smile' ? '<circle cx="60" cy="80" r="5.5" fill="#ffb3c7" stroke="#e0809b" stroke-width="2"/><circle cx="60" cy="88" r="3" fill="none" stroke="#e0809b" stroke-width="2"/>' : ''}` : ''}
      ${st === 'teen' ? `<path d="M16 38q44-14 88 0v10q-44-14-88 0z" fill="${acc}"/><path d="M36 40l-4-12M60 36V22M84 40l4-12" stroke="#111" stroke-width="3" stroke-linecap="round"/>` : ''}
      ${st === 'elder' ? `<ellipse cx="60" cy="-4" rx="26" ry="7" fill="none" stroke="#ffd34d" stroke-width="4"/><g fill="none" stroke="#111" stroke-width="2.5"><circle cx="46" cy="58" r="12"/><circle cx="74" cy="58" r="12"/><path d="M58 58h4"/></g><path d="M44 72q16-8 32 0q-16 6-32 0z" fill="#e9e9ef" stroke="#c9c9d4"/>` : ''}</svg>`;
  };
  const eggSvg = (n = 0) => { const a = 'var(--acc,#4da3ff)', C = ['M46 8l-6 14 8 8-8 10', 'M22 40l12 6-6 10 12 4', 'M76 36l-10 8 8 10-10 8', 'M30 78l12-6 8 12 14-8l12 8'];
    return `<svg viewBox="0 0 92 116"><path d="M46 4C20 4 6 50 6 74c0 24 18 40 40 40s40-16 40-40C86 50 72 4 46 4z" fill="#fff" stroke="${a}" stroke-width="4"/><circle cx="34" cy="40" r="5" fill="${a}" opacity=".35"/><circle cx="60" cy="32" r="3" fill="${a}" opacity=".35"/><circle cx="58" cy="86" r="6" fill="${a}" opacity=".25"/>
      ${C.slice(0, Math.min(4, n)).map(d => `<path d="${d}" stroke="#222" stroke-width="2.6" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}</svg>`; };

  const FOODS = { bottle: '<svg viewBox="0 0 34 34"><path d="M17 3v6" stroke="#ffb3c7" stroke-width="5" stroke-linecap="round"/><rect x="11" y="10" width="12" height="21" rx="4" fill="#fff" stroke="#9cc9ff" stroke-width="2"/><rect x="12" y="19" width="10" height="11" rx="3" fill="#cfe8ff"/></svg>',
    cookie: '<svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="14" fill="#d9a05b" stroke="#b97f3e" stroke-width="2"/><circle cx="12" cy="13" r="2.4" fill="#5b3418"/><circle cx="21" cy="15" r="2.4" fill="#5b3418"/><circle cx="15" cy="22" r="2.4" fill="#5b3418"/><circle cx="23" cy="23" r="2" fill="#5b3418"/></svg>',
    burger: '<svg viewBox="0 0 34 34"><path d="M4 15a13 10 0 0 1 26 0z" fill="#e0a458"/><rect x="3" y="16" width="28" height="4" rx="2" fill="#58c26b"/><rect x="3" y="20" width="28" height="4" rx="2" fill="#7a3b1d"/><path d="M4 25h26a2 4 0 0 1-2 4H6a2 4 0 0 1-2-4z" fill="#e0a458"/></svg>',
    cake: '<svg viewBox="0 0 34 34"><path d="M3 28V14l28 6v8z" fill="#ffd9e3" stroke="#e0809b" stroke-width="2" stroke-linejoin="round"/><path d="M3 14l28 6" stroke="#fff" stroke-width="3"/><circle cx="14" cy="9" r="4" fill="#ef4444"/><path d="M14 5q2-3 5-3" stroke="#3e9a50" stroke-width="2" fill="none"/></svg>',
    tea: '<svg viewBox="0 0 34 34"><path d="M6 14h18v8a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8z" fill="#fff" stroke="#9cc9ff" stroke-width="2"/><path d="M24 17h3a3 3 0 0 1 0 7h-3" stroke="#9cc9ff" stroke-width="2" fill="none"/><path d="M12 4q-3 3 0 6M18 4q-3 3 0 6" stroke="#bbb" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
    pill: '<svg viewBox="0 0 34 34"><g transform="rotate(-35 17 17)"><rect x="4" y="11" width="26" height="12" rx="6" fill="#fff" stroke="#999" stroke-width="2"/><path d="M17 11h7a6 6 0 0 1 0 12h-7z" fill="#58c26b"/></g></svg>' };
  function mount(el, mode) {
    stop(); if (!document.getElementById('hg-css')) { const s = document.createElement('style'); s.id = 'hg-css'; s.textContent = css; document.head.append(s); }
    if (!el) return; const pet = mode === 'pet';
    el.innerHTML = `<div class="hg ${pet ? 'pet' : ''}"><div class=hg-dim></div><div class=hg-stage><div class=hg-say></div><div class=hg-z>z z</div><div class=hg-sh></div><div class="hg-body hg-bob"></div></div>${pet ? '<div class=hg-bar></div><div class=hg-act></div>' : ''}<div class=hg-foot></div></div>`;
    const root = el.querySelector('.hg'), stage = root.querySelector('.hg-stage'), bodyEl = root.querySelector('.hg-body'), say = root.querySelector('.hg-say'), foot = root.querySelector('.hg-foot');
    let S = pet ? (rd() || fresh()) : { alive: true }, look = { x: 0, y: 1 }, busy = false, sayT = 0, look2 = 0, view = {};
    function fresh() { const n = Date.now(); return { born: n, last: n, hatched: 0, taps: 0, hunger: 80, fun: 80, energy: 90, mess: 0, sleeping: false, alive: true, since: 0, best: 0, visits: 0, day: '' }; }

    // ----- pet time passes while you're away -----
    const advance = () => { if (!pet || !S.alive || !S.hatched) { S.last = Date.now(); return; }
      const now = Date.now(), h = Math.max(0, (now - S.last) / HOUR); S.last = now;
      S.hunger = clamp(S.hunger - 4.2 * h); S.fun = clamp(S.fun - 3.4 * h); S.energy = clamp(S.energy + (S.sleeping ? 11 : -2.4) * h);
      if (S.sleeping && S.energy >= 99 && h > 0) S.sleeping = false;
      S.mess = Math.min(3, S.mess + (S.sleeping ? 0 : h / 5));
      const bad = Math.min(S.hunger, S.fun) <= 0;
      if (bad && !S.since) S.since = now - 0; if (!bad) S.since = 0;
      if (S.since && now - S.since > 36 * HOUR) { S.alive = false; S.diedAt = now; S.best = Math.max(S.best || 0, now - S.born); } };
    const ageH = () => (Date.now() - S.born) / HOUR, stg = () => !S.hatched ? 'egg' : ageH() < 24 ? 'baby' : ageH() < 72 ? 'child' : ageH() < 168 ? 'teen' : ageH() < 504 ? 'adult' : 'elder';
    const sick = () => pet && S.alive && S.hatched && (Math.min(S.hunger, S.fun) < 12 || Math.floor(S.mess) >= 3);
    const hour = new Date().getHours(), night = hour >= 23 || hour < 6;

    const talk = (t, ms = 2200) => { say.textContent = t; say.classList.add('on'); clearTimeout(sayT); sayT = setTimeout(() => say.classList.remove('on'), ms); };
    const note = (c = '♪') => { const n = document.createElement('span'); n.className = 'hg-note'; n.textContent = c; n.style.left = 50 + (Math.random() * 40 - 10) + '%'; n.style.top = '30px'; stage.append(n); setTimeout(() => n.remove(), 1500); };
    const anim = (kf, o) => { try { return bodyEl.animate(kf, Object.assign({ duration: 600, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'forwards' }, o)); } catch (e) { return { finished: Promise.resolve() }; } };
    // One frame = position (x,y), turns around the vertical axis (ry, degrees), tilt (rz), scale (s or sx/sy) and opacity (o).
    // Every frame uses the same list of transform functions, so big spins (720, 1440…) really turn instead of collapsing.
    const fr = f => ({ transform: `translate3d(${f.x || 0}px,${f.y || 0}px,0) perspective(700px) rotateY(${f.ry || 0}deg) rotate(${f.rz || 0}deg) scale(${f.sx != null ? f.sx : f.s != null ? f.s : 1},${f.sy != null ? f.sy : f.s != null ? f.s : 1})`, opacity: f.o != null ? f.o : 1 });
    const play = (frames, duration, easing = 'ease-in-out') => anim(frames.map(fr), { duration, easing });
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const edge = () => { const r = bodyEl.getBoundingClientRect(); return { l: -r.right - 70, r: innerWidth - r.left + 70, u: -r.bottom - 70, d: innerHeight - r.top + 70 }; };
    // While the ghost is off the edge of the screen the page must not grow a scrollbar.
    let clipped = [];
    const clipPage = on => { if (on) { for (let e = bodyEl, i = 0; e && i < 7; e = e.parentElement, i++) { clipped.push([e, e.style.overflow]); e.style.overflow = 'hidden'; } }
      else { clipped.forEach(([e, v]) => { e.style.overflow = v; }); clipped = []; } };
    const spinTurns = (turns, dir, h = 80) => { const n = Math.max(2, turns * 4), fs = []; for (let i = 0; i <= n; i++) { const t = i / n; fs.push({ ry: turns * 360 * t, x: dir * 46 * Math.sin(Math.PI * t), y: -h * Math.sin(Math.PI * t), s: 1 + .08 * Math.sin(Math.PI * t) }); }
      fs.push({ ry: turns * 360, s: 1, sy: .88, sx: 1.1 }); fs.push({ ry: turns * 360 }); return play(fs, 380 + turns * 330, 'linear'); };
    const burst = (colors, n = 14, spread = 90) => { for (let i = 0; i < n; i++) { const d = document.createElement('div'); d.className = 'hg-conf'; d.style.left = '50%'; d.style.top = '62%'; d.style.background = pick(colors); stage.append(d);
      const a = Math.random() * Math.PI * 2, r = spread * (.5 + Math.random() * .7);
      try { d.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${Math.cos(a) * r}px,${Math.sin(a) * r - 40}px) rotate(${Math.random() * 540}deg)`, opacity: 1, offset: .55 }, { transform: `translate(${Math.cos(a) * r * 1.1}px,${Math.sin(a) * r + 50}px) rotate(720deg)`, opacity: 0 }], { duration: 900 + Math.random() * 400, easing: 'ease-out' }).finished.then(() => d.remove(), () => d.remove()); } catch (e) { d.remove(); } } };
    const bubbles = (n = 14) => { for (let i = 0; i < n; i++) setTimeout(() => { const d = document.createElement('div'); d.className = 'hg-bub'; const z = 10 + Math.random() * 20; d.style.cssText = `width:${z}px;height:${z}px;left:${15 + Math.random() * 70}%;top:88%`; stage.append(d);
      try { d.animate([{ transform: 'translate(0,0) scale(.4)', opacity: 0 }, { transform: `translate(${Math.random() * 30 - 15}px,-60px) scale(1)`, opacity: 1, offset: .3 }, { transform: `translate(${Math.random() * 50 - 25}px,${-110 - Math.random() * 70}px) scale(1.15)`, opacity: 0 }], { duration: 1300 + Math.random() * 500, easing: 'ease-out' }).finished.then(() => d.remove(), () => d.remove()); } catch (e) { d.remove(); } }, i * 70); };
    const T = {
      hop: () => play([{}, { y: -46, sx: .94, sy: 1.08 }, { sx: 1.08, sy: .9 }, {}], 520, 'cubic-bezier(.3,1.4,.5,1)'),
      spin: () => spinTurns(1, 0, 40),
      flip: () => play([{}, { y: -70, rz: 180 }, { rz: 360, sy: .88, sx: 1.1 }, {}], 820),
      float: () => play([{}, { y: -92, s: .92, at: 0 }, { y: -92, s: .92, rz: 5 }, { y: -92, s: .92, rz: -5 }, {}], 1500),
      squish: () => play([{}, { sx: 1.25, sy: .6 }, { sx: .9, sy: 1.12 }, {}], 560),
      wiggle: () => play([{}, { rz: -9 }, { rz: 9 }, { rz: -6 }, {}], 520),
      dizzy: () => play([{}, { rz: -14, x: -8 }, { rz: 14, x: 8 }, { rz: -10 }, { rz: 8 }, {}], 1300),
      // swipe left / right: a full 360 turn around the vertical axis while dashing a little sideways and back
      side: (dir) => play([{}, { x: dir * 36, y: -16, ry: 180 }, { x: dir * 72, ry: 360 }, { x: dir * 36, ry: 360 }, { x: 0, ry: 360 }], 780, 'ease-in-out'),
      jumpspin: (dir, turns = 2) => spinTurns(turns, dir, 96),
      tornado: () => { const fs = []; for (let i = 0; i <= 16; i++) { const t = i / 16; fs.push({ ry: 1440 * t, y: -70 * Math.sin(Math.PI * t), rz: 10 * Math.sin(t * 20), s: 1 + .12 * Math.sin(Math.PI * t) }); } fs.push({}); return play(fs, 1900, 'linear'); },
      dance: async () => { for (let i = 0; i < 3; i++) await play([{}, { y: -22, rz: -12 }, { rz: 12, y: -22 }, {}], 360).finished; },
      pingpong: () => play([{}, { x: -84, ry: 360, y: -20 }, { x: 84, ry: 720, y: -20 }, { x: 0, ry: 1080 }], 1500, 'ease-in-out'),
      launch: async () => { await play([{}, { sx: 1.3, sy: .55 }], 200, 'ease-out').finished; await spinTurns(2, 0, 150).finished; await play([{ sx: 1.2, sy: .7 }, {}], 260, 'ease-out').finished; },
      quake: async () => { await play([{}, { y: -80, sy: 1.1 }], 280, 'ease-out').finished; await play([{ y: -80 }, { y: 0, sx: 1.35, sy: .5 }], 140, 'ease-in').finished;
        try { stage.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(-7px,3px)' }, { transform: 'translate(7px,-3px)' }, { transform: 'translate(-4px,2px)' }, { transform: 'none' }], { duration: 420 }); } catch (e) {}
        note('✦'); note('✦'); await play([{ sx: 1.35, sy: .5 }, { sx: .92, sy: 1.1 }, {}], 360).finished; },
      // up, up: shoots off the top of the screen, then comes zooming in big from the bottom
      rocket: async () => { const e = edge(); clipPage(true); await play([{}, { sx: 1.15, sy: .8 }, { y: e.u, sy: 1.35, sx: .85 }], 620, 'ease-in').finished;
        await wait(380); await play([{ y: e.d, s: 1.9, o: 1 }, { y: -36, s: 1.35 }, { y: 0, s: .94 }, {}], 780, 'cubic-bezier(.2,.9,.3,1.2)').finished; clipPage(false); },
      // out one side of the screen, in from the other side with a spin
      dashoff: async (dir) => { const e = edge(), out = dir > 0 ? e.r : e.l, back = dir > 0 ? e.l : e.r; clipPage(true);
        await play([{}, { x: out * .5, ry: 180, rz: dir * 8 }, { x: out, ry: 360 }], 560, 'ease-in').finished; await wait(260);
        await play([{ x: back, ry: 0, s: 1.5 }, { x: back * .3, ry: 540, s: 1.3 }, { x: 0, ry: 720, s: 1 }, {}], 820, 'cubic-bezier(.2,.9,.3,1.1)').finished; clipPage(false); },
      tumble: () => play([{}, { rz: 78, x: 14, y: 8 }, { rz: 78, x: 14, y: 8 }, { rz: 70, x: 12, y: 6 }, {}], 1300),
      yawn: async () => { face = { mouth: 'open' }; draw(); await play([{}, { sy: 1.13, sx: .92, y: -6 }, { sy: 1.13, sx: .92, y: -6 }, { sy: .93, sx: 1.07 }, {}], 1100).finished; face = {}; },
      stretch: async () => { face = { mouth: 'open' }; draw(); await play([{}, { sy: 1.15, sx: .9, y: -10 }, { sy: .92, sx: 1.08 }, { y: -26 }, {}], 900).finished; face = {}; draw(); },
      eat: async () => { for (let i = 0; i < 4; i++) { face = { mouth: 'big' }; draw(); await play([{}, { sx: 1.09, sy: .9 }, {}], 210).finished; face = { mouth: 'flat' }; draw(); await play([{}, { sx: .95, sy: 1.05 }, {}], 210).finished; }
        face = {}; draw(); await play([{}, { sx: 1.12, sy: .86 }, { y: -34, sy: 1.08 }, {}], 560).finished; },
      cheer: async () => { burst(['#ff6b6b', '#ffd34d', '#4dd18b', '#4da3ff', '#c77dff'], 22, 110); await play([{}, { y: -76, rz: -180 }, { y: -76, rz: -360 }, { y: 0, sx: 1.12, sy: .88 }, {}], 780).finished; for (let i = 0; i < 2; i++) await play([{}, { y: -20, rz: -10 }, { y: -20, rz: 10 }, {}], 320).finished; },
      scrub: async () => { bubbles(16); await spinTurns(1, 0, 30).finished; await play([{}, { rz: -8 }, { rz: 8 }, { rz: -6 }, { rz: 6 }, {}], 500, 'linear').finished; },
      gulp: async () => { await play([{}, { sx: 1.1, sy: .9 }, { sy: 1.1, sx: .95 }, {}], 480).finished; },
      heal: async () => { await play([{}, { sx: 1.1, sy: .9 }, { sy: 1.1, sx: .95 }, {}], 480).finished; try { bodyEl.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(3) hue-rotate(60deg)' }, { filter: 'brightness(1)' }], { duration: 700 }); } catch (e) {} burst(['#58c26b', '#b6f5c1', '#fff'], 18, 90); await play([{}, { y: -40, rz: 10 }, { y: -40, rz: -10 }, {}], 700).finished; },
      hatch: async () => { S.taps = 4; draw(); await play([{}, { rz: -10 }, { rz: 11 }, { rz: -13 }, { rz: 13 }, { rz: -7 }, { rz: 6 }, {}], 820, 'linear').finished;
        burst(['#fff', '#e7e7ee', '#d4d4de', 'var(--acc,#4da3ff)'], 20, 100); S.hatched = 1; S.born = Date.now(); S.last = Date.now(); S.since = 0; S.stageSeen = 'baby'; save();
        bodyEl.style.opacity = '0'; draw(); meters(); messes(); acts(); bodyEl.style.opacity = '';
        await play([{ s: .2, o: 0, y: 40 }, { s: 1.25, o: 1, y: -34 }, { s: .92, y: 0 }, {}], 760, 'cubic-bezier(.3,1.4,.5,1)').finished; talk('Hello, world!', 2600); note('✦'); note('♥'); },
      evolve: async () => { await play([{}, { s: 1.18 }], 280, 'ease-out').finished; try { bodyEl.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(5)' }, { filter: 'brightness(1)' }], { duration: 560 }); } catch (e) {}
        await wait(220); draw(); burst(['#ffd34d', '#fff', 'var(--acc,#4da3ff)'], 22, 120); await spinTurns(2, 0, 70).finished; talk('I grew up!', 2600); },
      // triple tap: vanishes… then pops up huge right in your face
      scare: async () => { await play([{}, { s: .15, o: 0, ry: 180 }], 240, 'ease-in').finished; say.classList.remove('on'); await wait(900 + Math.random() * 700);
        face = { mouth: 'open' }; draw(); bodyEl.style.opacity = '0';
        const fl = document.createElement('div'); fl.className = 'hg-boo'; fl.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:radial-gradient(circle,#000a,#000e);pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;opacity:0;transition:opacity .08s';
        const g = document.createElement('div'); g.style.cssText = 'width:min(76vw,340px);filter:drop-shadow(0 0 40px #fff6)'; g.innerHTML = bodyEl.innerHTML; const t = document.createElement('div'); t.textContent = 'BOO!'; t.style.cssText = 'font:900 54px system-ui;color:#fff;letter-spacing:6px';
        fl.append(g, t); document.body.append(fl); requestAnimationFrame(() => fl.style.opacity = '1'); try { navigator.vibrate && navigator.vibrate([40, 30, 60]); } catch (e) {}
        try { g.animate([{ transform: 'scale(.1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'cubic-bezier(.2,1.6,.4,1)', fill: 'forwards' }); } catch (e) {}
        await wait(260); try { g.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-4deg)' }, { transform: 'rotate(4deg)' }, { transform: 'rotate(-3deg)' }, { transform: 'none' }], { duration: 520 }); } catch (e) {}
        await wait(620); fl.style.transition = 'opacity .3s'; fl.style.opacity = '0'; setTimeout(() => fl.remove(), 350); face = {}; draw(); bodyEl.style.opacity = '';
        talk('Hehe, gotcha!'); await play([{ s: .3, o: 0 }, { s: 1.08, o: 1 }, {}], 480, 'cubic-bezier(.3,1.3,.5,1)').finished; } };
    let pending = null, busyName = '';
    const trick = async (name, ...args) => { if (busy) return; busy = true; busyName = name; bodyEl.classList.remove('hg-bob');
      try { const r = (T[name] || T.hop)(...args); if (r && r.finished) await r.finished; else await r; } catch (e) {}
      try { bodyEl.getAnimations().forEach(x => x.cancel()); } catch (e) {} clipPage(false); stage.style.zIndex = ''; document.querySelectorAll('.hg-boo').forEach(x => x.remove());
      bodyEl.classList.add('hg-bob'); busy = false;
      if (pending) { const p = pending; pending = null; if (Date.now() - p.t < 2500) setTimeout(() => gesture(p.k), 40); } };

    // ----- drawing -----
    const mood = () => !S.alive ? 'dead' : sick() ? 'sick' : S.sleeping ? 'sleep' : pet && S.hatched && Math.min(S.hunger, S.fun) < 30 ? 'sad' : 'ok';
    let face = {};
    const draw = () => { const st = pet ? stg() : 'adult', m = mood();
      root.classList.toggle('sleep', m === 'sleep'); root.classList.toggle('dead', m === 'dead');
      if (pet && st === 'egg') { bodyEl.innerHTML = eggSvg(S.taps || 0); bodyEl.classList.add('hg-egg'); bodyEl.classList.remove('hg-bob'); bodyEl.style.width = ''; }
      else { bodyEl.classList.remove('hg-egg'); if (!busy) bodyEl.classList.add('hg-bob');
        const o = Object.assign({ mouth: m === 'sad' || m === 'sick' ? 'sad' : 'smile', closed: m === 'sleep' || m === 'dead', droop: m === 'sad' || m === 'sick', sick: m === 'sick', stage: st, scarf: pet && (st === 'adult' || st === 'elder'), hat: pet && st === 'child' || (!pet && new Date().getMonth() === 11) }, face);
        bodyEl.innerHTML = body(o); const k = { baby: .66, child: .82, teen: .93, adult: 1, elder: 1.05 }[st] || 1; bodyEl.style.width = 122 * k + 'px'; bodyEl.style.height = 132 * k + 'px'; }
      aim(); };
    const aim = () => bodyEl.querySelectorAll('.pup').forEach(p => p.style.transform = `translate(${look.x * 3}px,${look.y * 3}px)`);
    const meters = () => { if (!pet) return; const bar = root.querySelector('.hg-bar'); if (!S.hatched || !S.alive) { bar.innerHTML = ''; return; }
      bar.innerHTML = [['Full', S.hunger], ['Fun', S.fun], ['Rest', S.energy], ['Clean', 100 - Math.floor(S.mess) * 34]].map(([n, v]) => `<div class="hg-m ${v < 25 ? 'low' : ''}">${n}<i><b style="width:${Math.round(v)}%"></b></i></div>`).join(''); };
    const messes = () => { if (!pet) return; stage.querySelectorAll('.hg-mess').forEach(x => x.remove()); if (!S.alive) return;
      for (let i = 0; i < Math.floor(S.mess); i++) { const m = document.createElement('div'); m.className = 'hg-mess'; m.style.left = (i % 2 ? 66 : 8) + (i * 7) + '%'; m.onclick = () => { S.mess = Math.max(0, S.mess - 1); S.fun = clamp(S.fun + 2); save(); messes(); meters(); talk('Sparkly!'); }; stage.append(m); } };
    const acts = () => { if (!pet) return; const a = root.querySelector('.hg-act');
      if (!S.alive) { a.innerHTML = '<button style="grid-column:1/-1" data-a=again>Hatch a new egg</button>'; foot.textContent = 'Hush drifted away after ' + Math.max(1, Math.round(((S.diedAt || Date.now()) - S.born) / (24 * HOUR))) + ' day(s). Best so far: ' + Math.max(1, Math.round((S.best || 0) / (24 * HOUR))) + ' day(s).'; }
      else if (!S.hatched) { a.innerHTML = ''; foot.textContent = 'An egg! Tap it to help it hatch.'; }
      else { a.innerHTML = `<button data-a=feed>Feed</button><button data-a=play>Play</button><button data-a=clean>Clean</button><button data-a=sleep>${S.sleeping ? 'Wake' : 'Sleep'}</button>${sick() ? '<button data-a=heal>Heal</button>' : ''}`;
        const d = Math.max(1, Math.ceil(ageH() / 24)); foot.textContent = `Day ${d} · ${stg()}${sick() ? ' · not feeling well' : ''} · come back often`; }
      a.querySelectorAll('[data-a]').forEach(b => b.onclick = () => doAct(b.dataset.a)); };
    function save() { if (pet) wr(S); }
    const checkEvolve = () => { if (!pet || !S.alive || !S.hatched) return; const cs = stg(); if (!S.stageSeen) { S.stageSeen = cs; save(); return; } if (S.stageSeen !== cs && !busy) { S.stageSeen = cs; save(); trick('evolve'); } };
    const refresh = () => { if (pet) { advance(); save(); } draw(); meters(); messes(); acts(); checkEvolve(); };

    // ----- pet actions -----
    const wake = () => { if (S.sleeping) { S.sleeping = false; talk('Mmh… I was sleeping!'); return true; } return false; };
    const mouthY = () => { const h = bodyEl.offsetHeight || 132; return Math.round(190 - h + h * .58 - 17); };
    const drop = (food, ms = 700) => { const sn = document.createElement('div'); sn.className = 'hg-snack'; sn.innerHTML = FOODS[food] || FOODS.cookie; stage.append(sn); const y = mouthY();
      try { sn.animate([{ top: '-34px', transform: 'rotate(-25deg)', opacity: 1 }, { top: Math.round(y * .6) + 'px', transform: 'rotate(15deg)', offset: .55 }, { top: y + 'px', transform: 'rotate(-5deg) scale(1)', opacity: 1, offset: .88 }, { top: y + 'px', transform: 'scale(.2)', opacity: 0 }], { duration: ms, easing: 'ease-in' }).finished.then(() => sn.remove(), () => sn.remove()); } catch (e) { sn.remove(); } return wait(ms - 80); };
    async function doAct(a) {
      if (a === 'again') { const best = S.best; S = fresh(); S.best = best; save(); refresh(); return; }
      if (!S.alive || !S.hatched) return; advance();
      if (busy) { talk('One moment…', 900); return; }
      const st = stg();
      if (a === 'sleep') { if (S.sleeping) { S.sleeping = false; save(); refresh(); talk('Good morning!'); await trick('stretch'); note('♪'); return; }
        talk('*yaaawn*', 1500); look = { x: 0, y: -1 }; aim(); await trick('yawn'); S.sleeping = true; talk('Night night…'); save(); refresh(); return; }
      if (wake()) { save(); refresh(); return; }
      if (a === 'feed') { if (S.hunger > 92) { talk(st === 'baby' ? 'No more milk!' : 'I’m full!'); trick('wiggle'); return; }
        const food = { baby: 'bottle', child: 'cookie', teen: 'burger', adult: 'cake', elder: 'tea' }[st];
        look = { x: 0, y: -1 }; aim(); face = { mouth: 'open' }; draw(); talk(st === 'baby' ? 'Milk!' : 'Ooh!', 900); await drop(food);
        S.hunger = clamp(S.hunger + 32); S.mess = Math.min(3, S.mess + 0.35); save(); meters(); await trick('eat');
        talk(pick(['Yum!', 'Nom nom!', 'Tasty!', 'More please!'])); note('♥'); note('♥'); S.fun = clamp(S.fun + 3); save(); refresh(); messes(); return; }
      if (a === 'play') { if (S.energy < 15) { talk('Too sleepy…'); trick('tumble'); return; } game(); return; }
      if (a === 'clean') { if (!Math.floor(S.mess)) { talk('Already clean!'); trick('wiggle'); return; }
        stage.querySelectorAll('.hg-mess').forEach(m => { try { m.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.4,.3)', opacity: 0 }], { duration: 600, fill: 'forwards' }); } catch (e) {} });
        S.mess = 0; S.fun = clamp(S.fun + 5); talk('Bubbles!'); save(); await trick('scrub'); talk('All sparkly!'); note('✦'); note('✦'); refresh(); return; }
      if (a === 'heal') { look = { x: 0, y: -1 }; aim(); face = { mouth: 'open' }; draw(); await drop('pill', 600); S.hunger = Math.max(S.hunger, 40); S.fun = Math.max(S.fun, 40); S.mess = 0; S.since = 0; save(); await trick('heal'); talk('I feel so much better!'); refresh(); } }
    function game() { let n = 0; talk('Catch the ball!', 1400); const b = document.createElement('div'); b.className = 'hg-ball'; stage.append(b);
      const place = () => { const x = 6 + Math.random() * (stage.clientWidth - 52), y = 10 + Math.random() * 110; b.style.left = x + 'px'; b.style.top = y + 'px';
        const r = bodyEl.getBoundingClientRect(), s = stage.getBoundingClientRect(), dx = s.left + x + 20 - (r.left + r.width / 2), dy = s.top + y + 20 - (r.top + r.height / 3), d = Math.hypot(dx, dy) || 1; look = { x: dx / d, y: dy / d }; aim(); };
      place(); const mv = setInterval(place, 1100);
      const end = async ok => { clearInterval(mv); clearTimeout(to); b.remove(); if (ok) { S.fun = clamp(S.fun + 34); S.energy = clamp(S.energy - 8); talk('That was fun!'); note('♥'); save(); refresh(); await trick('cheer'); } else { S.fun = clamp(S.fun + n * 7); talk('Aw, it got away'); save(); refresh(); } };
      b.onpointerdown = e => { e.stopPropagation(); n++; b.animate([{ transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 160 }); trick(n % 2 ? 'hop' : 'spin'); burst(['#fff', 'var(--acc,#4da3ff)'], 6, 50); if (n >= 4) end(true); else place(); };
      const to = setTimeout(() => end(false), 9000); timers.push(mv, to); }

    // ----- gestures: tap, double tap, hold, swipes, drag -----
    let down = null, taps = 0, tapT = 0;
    const hello = () => { const t = hour < 5 ? 'Still up?' : hour < 12 ? 'Good morning!' : hour < 18 ? 'Hi there!' : 'Good evening!'; return t; };
    bodyEl.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: Date.now(), dx: 0, dy: 0 }; try { bodyEl.setPointerCapture(e.pointerId); } catch (_) {}
      down.lp = setTimeout(() => { if (!down) return; down.held = true; hold(); }, 600); });
    bodyEl.addEventListener('pointermove', e => { if (!down) return; down.dx = e.clientX - down.x; down.dy = e.clientY - down.y;
      if (Math.hypot(down.dx, down.dy) > 12) clearTimeout(down.lp);
      if (!busy) { bodyEl.classList.remove('hg-bob'); bodyEl.style.transform = `translate(${down.dx * .35}px,${down.dy * .35}px) rotate(${down.dx * .06}deg)`; } });
    const up = () => { if (!down) return; const d = down; down = null; clearTimeout(d.lp); bodyEl.style.transform = '';
      if (d.held) { bodyEl.classList.add('hg-bob'); return; }
      const ax = Math.abs(d.dx), ay = Math.abs(d.dy);
      if (Math.max(ax, ay) > 34) { bodyEl.classList.add('hg-bob'); return swipe(ax > ay ? (d.dx > 0 ? 'right' : 'left') : (d.dy < 0 ? 'up' : 'down')); }
      bodyEl.classList.add('hg-bob'); taps++; clearTimeout(tapT); tapT = setTimeout(() => { const n = taps; taps = 0; tap(n); }, n2()); };
    const n2 = () => 240;
    bodyEl.addEventListener('pointerup', up); bodyEl.addEventListener('pointercancel', up);
    const talkIdle = () => pick(night ? ['Yaaawn…', 'Shhh… it’s late.'] : ['Boo!', 'Hush.', 'Psst… nobody can see us.', 'Ads? Not on my watch.', 'Tor feels cozy today.', 'I only float. I don’t track.']);
    // Gestures can be chained: each one remembers the one before it (within ~1.8 s) and some pairs do something special.
    let hist = [];
    const dirv = k => k === 'left' ? -1 : k === 'right' ? 1 : 0;
    function gesture(k) {
      if (pet && !S.alive) return; if (pet && !S.hatched) { trick('wiggle'); return; } if (pet && wake()) { save(); refresh(); return; }
      if (busy) { pending = { k, t: Date.now() }; return; }
      const now = Date.now(); hist = hist.filter(h => now - h.t < 1800); const prev = hist.length ? hist[hist.length - 1].k : null; hist.push({ k, t: now });
      const side = x => x === 'left' || x === 'right';
      let c = null;
      if (hist.length >= 4) { hist = []; c = ['tornado', 'Tornado time!']; }
      else if (prev === 'up' && k === 'up') c = ['rocket', 'Houston, we have a ghost!'];
      else if (prev === 'down' && k === 'down') c = ['quake', 'Ground pound!'];
      else if (prev === 'down' && k === 'up') c = ['launch', 'Launch!'];
      else if ((prev === 'up' || prev === 'tap') && side(k)) c = ['jumpspin', 'Double spin!', dirv(k), 2];
      else if (prev === 'tap' && k === 'up') c = ['jumpspin', 'Triple spin!', 0, 3];
      else if (side(prev) && side(k)) c = prev === k ? ['dashoff', 'See you on the other side!', dirv(k)] : ['pingpong', 'Ping pong!'];
      else if (side(prev) && k === 'tap') c = ['dashoff', 'Peekaboo!', dirv(prev)];
      if (c) { if (c[0] !== 'tornado') hist = hist.slice(-1).filter(() => false); talk(c[1]); note(); trick(c[0], c[2], c[3]); }
      else if (k === 'up') { talk('Up, up and away!'); trick('float'); }
      else if (k === 'down') { talk('Squish!'); trick('squish'); }
      else if (side(k)) { talk('Wheee!'); trick('side', dirv(k)); }
      else { look = { x: (Math.random() - .5) * 2, y: -.4 }; aim(); talk(pet && sick() ? 'I don’t feel so good…' : talkIdle()); note(); trick('hop'); }
      if (pet) { S.fun = clamp(S.fun + (c ? 4 : 2)); save(); meters(); } }
    function tap(n) {
      if (pet && !S.alive) return;
      if (pet && !S.hatched) { if (S.hatching) return; S.taps += n; save(); if (S.taps >= 5) { S.hatching = 1; const go = () => busy ? setTimeout(go, 80) : trick('hatch').then(() => { S.hatching = 0; }); go(); return; } draw(); trick('wiggle'); talk(['Tap tap…', 'Something is moving!', 'I hear a tiny peep…', 'It’s cracking!'][Math.min(3, S.taps - 1)] || 'Tap tap…'); return; }
      if (pet && wake()) { save(); refresh(); return; }
      if (n === 1) return gesture('tap');
      if (busy) { pending = null; return; }
      hist = [{ k: 'tap', t: Date.now() }];
      if (n >= 7) { face = { shades: true }; draw(); talk('Too cool.'); trick('dizzy'); setTimeout(() => { face = {}; draw(); }, 5000); }
      else if (n === 6) { talk('Tornado time!'); trick('tornado'); }
      else if (n === 5) { talk('Wheee!'); trick('flip'); }
      else if (n === 4) { talk('Dance party!'); trick('dance'); }
      else if (n === 3) { talk('Boo?'); trick('scare'); }
      else { talk('Ooh, a spin!'); trick('spin'); }
      if (pet) { S.fun = clamp(S.fun + 3); save(); meters(); } }
    function swipe(dir) { gesture(dir); }
    function hold() { if (pet && (!S.alive || !S.hatched)) return;
      if (!pet) { S.sleeping = !S.sleeping; face = {}; root.classList.toggle('sleep', S.sleeping); bodyEl.innerHTML = body({ closed: S.sleeping }); talk(S.sleeping ? 'Zzz…' : 'I’m awake!'); aim(); if (!S.sleeping) draw(); return; }
      face = { mouth: 'big' }; draw(); talk('Hehe, that tickles!'); note('♥'); S.fun = clamp(S.fun + 4); save(); meters(); trick('wiggle'); setTimeout(() => { face = {}; draw(); }, 1200); }

    // ----- eyes follow your finger / pointer -----
    const track = e => { const p = e.touches ? e.touches[0] : e; if (!p || !bodyEl.isConnected) return; const r = bodyEl.getBoundingClientRect(), dx = p.clientX - (r.left + r.width / 2), dy = p.clientY - (r.top + r.height / 3), d = Math.hypot(dx, dy) || 1;
      look = { x: dx / d, y: dy / d }; clearTimeout(look2); look2 = setTimeout(() => { look = { x: 0, y: 1 }; aim(); }, 2600); aim(); };
    addEventListener('pointermove', track, { passive: true }); offs.push(() => removeEventListener('pointermove', track));
    // shake the phone: dizzy
    let sk = 0, lastA = 0; const shake = e => { const a = e.accelerationIncludingGravity; if (!a) return; const v = Math.abs(a.x) + Math.abs(a.y) + Math.abs(a.z); if (Math.abs(v - lastA) > 22 && Date.now() - sk > 2500) { sk = Date.now(); if (!pet || (S.alive && S.hatched)) { talk('Whoa! Dizzy…'); trick('dizzy'); } } lastA = v; };
    addEventListener('devicemotion', shake); offs.push(() => removeEventListener('devicemotion', shake));

    // ----- life of its own -----
    const idle = () => { if (busy || down) return; if (pet && S.alive && !S.hatched) { if (Math.random() < .5) { trick('wiggle'); if (Math.random() < .4) talk('peep…', 1200); } return; } if (pet && !S.alive) return; if (S.sleeping) return;
      if (pet && stg() === 'baby' && Math.random() < .3) { talk('Oopsie!', 1400); return trick('tumble'); }
      if (pet && stg() === 'elder' && Math.random() < .25) { talk('Back in my day, we had no ads…', 2800); return; }
      const r = Math.random(); if (r < .3) { look = { x: Math.random() * 2 - 1, y: Math.random() * 2 - 1 }; aim(); } else if (r < .5) { note(); } else if (r < .65) trick('wiggle'); else if (r < .8) talk(pet && sick() ? 'Hello? I need you…' : talkIdle()); else if (r < .9) trick('hop'); };
    timers.push(setInterval(idle, 7000));
    if (pet) timers.push(setInterval(() => { advance(); save(); checkEvolve(); meters(); messes(); if (!S.alive) { draw(); acts(); } else if (S.sleeping !== root.classList.contains('sleep')) draw(); }, 15000));

    // ----- first look -----
    if (pet) { const today = new Date().toDateString(); if (S.hatched && S.alive && S.day !== today) { S.day = today; S.visits = (S.visits || 0) + 1; } advance(); save(); }
    refresh();
    if (!pet) foot.textContent = 'Tap, double-tap, swipe or hold me';
    setTimeout(() => { if (!root.isConnected) return; if (pet && !S.alive) talk('…'); else if (pet && !S.hatched) talk('An egg appeared!'); else if (pet && sick()) talk('Please look after me…'); else if (pet && S.hunger < 30) talk('I’m hungry!'); else talk(hello()); }, 500);
  }
  return { mount, stop };
})();
