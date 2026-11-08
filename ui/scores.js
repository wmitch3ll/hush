// Sports scores for the start page: live, final and upcoming games for the leagues you pick, with "my teams" starred to the top.
// Data: ESPN's public scoreboard, fetched by the app (scores_get). Nothing is sent but the league and date. Off unless turned on in Customize.
window.HUSH_SCORES = (function () {
  'use strict';
  const LEAGUES = { nfl: 'NFL', cfb: 'College football', nba: 'NBA', cbb: 'College basketball', nhl: 'NHL', mlb: 'MLB', wcbb: 'Women’s college basketball', mls: 'MLS' };
  const SHORT = { nfl: 'NFL', cfb: 'NCAAF', nba: 'NBA', cbb: 'NCAAB', nhl: 'NHL', mlb: 'MLB', wcbb: 'WCBB', mls: 'MLS' };
  const WEEKLY = { nfl: 1, cfb: 1 };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = { get(k, d) { try { const v = localStorage.getItem('hush.scores.' + k); return v == null ? d : JSON.parse(v) } catch { return d } },
               set(k, v) { try { localStorage.setItem('hush.scores.' + k, JSON.stringify(v)) } catch {} } };
  const ymd = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const cache = {};            // league|date -> { at, games }
  let timer = null, token = 0;

  // ESPN event -> small plain object. Everything is coerced so odd data can't break the page.
  function parse(json) {
    const out = [];
    for (const e of (json && json.events) || []) {
      try {
        const c = e.competitions && e.competitions[0]; if (!c) continue; const st = (e.status || c.status || {}).type || {};
        const team = side => { const t = (c.competitors || []).find(x => x.homeAway === side); if (!t) return null; const tm = t.team || {};
          return { id: String(tm.id || tm.abbreviation || ''), ab: String(tm.abbreviation || tm.shortDisplayName || '?').slice(0, 5), name: String(tm.shortDisplayName || tm.displayName || '').slice(0, 30), color: /^[0-9a-f]{6}$/i.test(tm.color || '') ? '#' + tm.color : '#888',
            score: t.score != null && t.score !== '' ? String(t.score).slice(0, 4) : '', win: !!t.winner, rank: t.curatedRank && t.curatedRank.current && t.curatedRank.current < 26 ? t.curatedRank.current : 0, rec: ((t.records || [])[0] || {}).summary || '' }; };
        const a = team('away'), h = team('home'); if (!a || !h) continue;
        const state = ['pre', 'in', 'post'].includes(st.state) ? st.state : 'pre';
        const link = ((e.links || []).find(l => (l.rel || []).includes('summary') || (l.rel || []).includes('desktop')) || {}).href;
        out.push({ id: String(e.id || ''), at: Date.parse(e.date) || 0, state, detail: String(st.shortDetail || st.detail || '').slice(0, 40), a, h, link: /^https:\/\/(www\.)?espn\.com\//.test(link || '') ? link : '' });
      } catch {}
    }
    return out.sort((x, y) => (x.state === 'in' ? 0 : x.state === 'pre' ? 1 : 2) - (y.state === 'in' ? 0 : y.state === 'pre' ? 1 : 2) || x.at - y.at);
  }
  async function load(A, lg, date, force) {
    const k = lg + '|' + (date || 'now'), c = cache[k], ttl = 30000;
    if (!force && c && Date.now() - c.at < ttl) return c.games;
    const txt = await A.inv('scores_get', { league: lg, date: date || null });
    const games = parse(JSON.parse(txt)); cache[k] = { at: Date.now(), games }; LS.set('last.' + k, { at: Date.now(), games }); return games;
  }
  const when = g => g.state === 'pre' ? new Date(g.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : g.detail;

  const CSS = `
.hx-sc{width:min(100%,520px);border-radius:18px;background:var(--card);border:1px solid var(--line);padding:10px 10px 8px;text-align:left;color:var(--ink);font:13px/1.35 system-ui,sans-serif}
.hx-home.walled .hx-sc{background:#0000008c;border-color:#ffffff30;color:#fff;backdrop-filter:blur(8px)}
.hx-sc .sc-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:2px 2px 8px}.hx-sc .sc-tabs::-webkit-scrollbar{display:none}
.hx-sc .sc-tabs button,.hx-sc .sc-nav button{all:unset;cursor:pointer;box-sizing:border-box;padding:5px 11px;border-radius:99px;border:1px solid var(--line);font:600 12px system-ui;white-space:nowrap;color:inherit}
.hx-sc .sc-tabs button.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}.hx-home.walled .sc-tabs button.on{background:#fff;color:#111}
.hx-sc .sc-nav{display:flex;align-items:center;justify-content:space-between;padding:0 2px 6px;font:600 12px system-ui;color:var(--mute)}.hx-home.walled .sc-nav{color:#ffffffbb}
.hx-sc .sc-nav button{padding:3px 10px;font-size:15px;line-height:1}
.hx-sc .sc-g{display:grid;grid-template-columns:1fr auto 84px;gap:2px 10px;align-items:center;padding:8px 6px;border-top:1px solid var(--line);border-radius:6px}.hx-home.walled .sc-g{border-color:#ffffff22}
.hx-sc .sc-g[data-l]{cursor:pointer}.hx-sc .sc-g[data-l]:active{background:var(--glow)}.hx-sc .sc-g.arm{background:var(--glow)}
.hx-sc .sc-t{display:flex;align-items:center;gap:8px;min-width:0}.hx-sc .sc-t i{width:9px;height:9px;border-radius:50%;flex:none}
.hx-sc .sc-t b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hx-sc .sc-t em{font:11px system-ui;font-style:normal;color:var(--mute)}.hx-home.walled .sc-t em{color:#ffffffaa}
.hx-sc .sc-t.l b{font-weight:500;opacity:.7}.hx-sc .sc-s{font:700 15px ui-monospace,Menlo,monospace;min-width:26px;text-align:right}.hx-sc .sc-s.l{opacity:.55;font-weight:500}
.hx-sc .sc-st{grid-column:3;grid-row:1 / span 2;text-align:right;font:600 11.5px system-ui;color:var(--mute);min-width:64px}.hx-home.walled .sc-st{color:#ffffffbb}.hx-sc .sc-st.live{color:#d4483b}
.hx-sc .sc-star{all:unset;cursor:pointer;width:18px;height:18px;display:grid;place-items:center;opacity:.35;flex:none}.hx-sc .sc-star.on{opacity:1}.hx-sc .sc-star svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linejoin:round}.hx-sc .sc-star.on svg{fill:currentColor}
.hx-sc .sc-m{padding:16px 6px;text-align:center;color:var(--mute)}.hx-sc .sc-m button{all:unset;cursor:pointer;text-decoration:underline}
.hx-sc .sc-ft{display:flex;justify-content:space-between;padding:6px 6px 0;font-size:10.5px;color:var(--mute);border-top:1px solid var(--line)}.hx-home.walled .sc-ft{color:#ffffff99;border-color:#ffffff22}`;
  function css() { if (document.getElementById('hx-sc-css')) return; const s = document.createElement('style'); s.id = 'hx-sc-css'; s.textContent = CSS; document.head.append(s); }
  const STAR = '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17.3 6.6 20.3l1.1-6.1L3.2 9.9l6.1-.8z"/></svg>';

  // el: container; A: host adapter (inv, pref, open). Returns nothing; call stop() when the page is replaced.
  function mount(el, A) {
    css(); stop(); const my = ++token;
    const all = Object.keys(LEAGUES), enabled = String(A.pref('sp_leagues') || 'nfl,cfb,nba,cbb,nhl').split(',').filter(l => LEAGUES[l]);
    const leagues = enabled.length ? enabled : ['nfl'];
    const st = { lg: LS.get('lg', leagues[0]), off: 0, mine: false, games: null, err: '' };
    if (!leagues.includes(st.lg) && st.lg !== 'mine') st.lg = leagues[0];
    const pins = () => LS.get('pins', []), isPin = (lg, id) => pins().includes(lg + ':' + id);
    // ESPN rolls its daily scoreboard over at 9am Pacific, so until then "today" still means last night's games.
    const ptNow = () => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hour12: false }).formatToParts(new Date()).reduce((o, x) => (o[x.type] = +x.value, o), {});
    const ptDay = () => { const p = ptNow(), d = new Date(p.year, p.month - 1, p.day, 12); return { d, late: (p.hour % 24) < 9 }; };
    const dayFor = off => { const { d, late } = ptDay(); d.setDate(d.getDate() + off - (late ? 1 : 0)); return d; };
    const dateFor = (lg = st.lg) => WEEKLY[lg] ? (st.off ? (() => { const d = new Date(); d.setDate(d.getDate() + st.off * 7); return ymd(d); })() : null) : ymd(dayFor(st.off));
    const label = () => {
      if (WEEKLY[st.lg]) { if (!st.off) return 'This week'; const d = new Date(); d.setDate(d.getDate() + st.off * 7); return 'Week of ' + d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); }
      const { d: t0, late } = ptDay(), d = dayFor(st.off), diff = Math.round((d - t0) / 864e5);
      return diff === 0 ? 'Today' : diff === -1 ? (st.off === 0 && late ? 'Last night' : 'Yesterday') : diff === 1 ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    };
    el.innerHTML = '<div class="hx-sc"></div>'; const box = el.firstChild;
    const rowHtml = (g, lg) => { const fin = g.state === 'post', aw = fin && g.a.win, hw = fin && g.h.win;
      const team = (t, lose) => `<div class="sc-t ${lose ? 'l' : ''}"><button class="sc-star ${isPin(lg, t.id) ? 'on' : ''}" data-pin="${esc(lg + ':' + t.id)}" aria-label="Follow ${esc(t.name)}">${STAR}</button><i style="background:${t.color}"></i><b>${t.rank ? '<em>' + t.rank + '</em> ' : ''}${esc(t.name || t.ab)}</b>${g.state === 'pre' && t.rec ? `<em>${esc(t.rec)}</em>` : ''}</div>`;
      const sc = (t, lose) => `<span class="sc-s ${lose ? 'l' : ''}">${g.state === 'pre' ? '' : esc(t.score)}</span>`;
      return `<div class="sc-g" ${g.link ? `data-l="${esc(g.link)}"` : ''}>${team(g.a, fin && !aw && hw)}${sc(g.a, fin && !aw && hw)}<div class="sc-st ${g.state === 'in' ? 'live' : ''}">${esc(when(g))}</div>${team(g.h, fin && !hw && aw)}${sc(g.h, fin && !hw && aw)}</div>`; };
    function paint() {
      if (my !== token) return;
      const hasPins = pins().length > 0, tabs = leagues.map(l => `<button data-lg="${l}" class="${st.lg === l ? 'on' : ''}">${SHORT[l]}</button>`).join('') + (hasPins ? `<button data-lg="mine" class="${st.lg === 'mine' ? 'on' : ''}">My teams</button>` : '');
      let body;
      if (st.err) body = `<div class="sc-m">${esc(st.err)}<br><button data-retry>Try again</button></div>`;
      else if (!st.games) body = '<div class="sc-m">Loading scores…</div>';
      else {
        let list = st.games; if (st.lg === 'mine') list = list.filter(x => isPin(x.lg, x.a.id) || isPin(x.lg, x.h.id));
        else { const mineFirst = g => isPin(st.lg, g.a.id) || isPin(st.lg, g.h.id) ? 0 : 1; list = list.slice().sort((x, y) => mineFirst(x) - mineFirst(y)); }
        body = list.length ? list.slice(0, 40).map(g => rowHtml(g, g.lg || st.lg)).join('') : `<div class="sc-m">${st.lg === 'mine' ? 'None of your teams play ' + label().toLowerCase() : 'No games ' + label().toLowerCase()}</div>`;
      }
      box.innerHTML = `<div class="sc-tabs">${tabs}</div>${st.lg === 'mine' ? '' : `<div class="sc-nav"><button data-nav="-1" aria-label="Earlier">&lsaquo;</button><span>${esc(label())}</span><button data-nav="1" aria-label="Later">&rsaquo;</button></div>`}${body}<div class="sc-ft"><span>${st.at ? 'Updated ' + new Date(st.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</span><span>Scores from ESPN</span></div>`;
      box.querySelectorAll('[data-lg]').forEach(b => b.onclick = () => { st.lg = b.dataset.lg; st.off = 0; if (st.lg !== 'mine') LS.set('lg', st.lg); refresh(true); });
      box.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { st.off += +b.dataset.nav; refresh(true); });
      box.querySelectorAll('[data-retry]').forEach(b => b.onclick = () => refresh(true));
      box.querySelectorAll('[data-pin]').forEach(b => b.onclick = e => { e.stopPropagation(); const k = b.dataset.pin, p = pins(); LS.set('pins', p.includes(k) ? p.filter(x => x !== k) : p.concat(k).slice(-40)); paint(); });
      let lastTap = 0, lastEl = null;
      box.querySelectorAll('[data-l]').forEach(r => r.onclick = () => { const n = Date.now(); if (lastEl === r && n - lastTap < 600) { lastTap = 0; lastEl = null; A.open(r.dataset.l); } else { lastEl = r; lastTap = n; r.classList.add('arm'); setTimeout(() => r.classList.remove('arm'), 600); if (!st.hinted) { st.hinted = 1; A.toast('Double-tap a game to open it'); } } });
    }
    async function refresh(show) {
      if (my !== token) return; st.err = '';
      const lgs = st.lg === 'mine' ? leagues : [st.lg];
      if (show) { st.games = null; const c = lgs.map(l => LS.get('last.' + l + '|' + (dateFor(l) || 'now'), null)).filter(Boolean); if (c.length === lgs.length) { st.games = c.flatMap((x, i) => x.games.map(g => ({ ...g, lg: lgs[i] }))); st.at = Math.min(...c.map(x => x.at)); } paint(); }
      try {
        const res = await Promise.all(lgs.map(async l => (await load(A, l, dateFor(l), show)).map(g => ({ ...g, lg: l }))));
        if (my !== token) return; st.games = res.flat(); st.at = Date.now();
      } catch (e) { if (my !== token) return; if (!st.games) st.err = 'Scores are unavailable right now.'; }
      paint(); schedule();
    }
    function schedule() { clearTimeout(timer); if (my !== token) return; const live = (st.games || []).some(g => g.state === 'in'); timer = setTimeout(() => { if (my !== token) return; if (document.hidden || !document.body.contains(box)) return schedule(); refresh(false); }, live ? 30000 : 300000); }
    paint(); refresh(true);
  }
  function stop() { token++; clearTimeout(timer); }

  // Game alerts for the teams you starred. Runs whenever Hush is running (not only on the start page); it only talks to the
  // scores service while "Game alerts" is on and at least one team is starred. First sight of a game sets a baseline, so you
  // are never alerted about a game that was already under way.
  let wtimer = 0, wtok = 0;
  function unwatch() { wtok++; clearTimeout(wtimer); }
  function watch(A) {
    unwatch(); const my = wtok;
    if (A.pref('sp_scores') !== 'on' || A.pref('sp_alerts') !== 'on') return;
    const tick = async () => {
      if (my !== wtok) return; let live = false;
      try {
        const pins = LS.get('pins', []); const lgs = [...new Set(pins.map(x => String(x).split(':')[0]))].filter(l => LEAGUES[l]);
        const seen = LS.get('alert', {}); let changed = false;
        for (const lg of lgs) {
          let games = []; try { games = await load(A, lg, null, true); } catch { continue; }
          for (const g of games) {
            if (!pins.includes(lg + ':' + g.a.id) && !pins.includes(lg + ':' + g.h.id)) continue;
            const k = lg + ':' + g.id, prev = seen[k]; if (g.state === 'in') live = true;
            if (prev !== g.state) { seen[k] = g.state; changed = true;
              if (prev === 'pre' && g.state === 'in') A.alert('Game on', g.a.name + ' at ' + g.h.name + ' just started');
              else if ((prev === 'pre' || prev === 'in') && g.state === 'post') A.alert('Final', g.a.name + ' ' + g.a.score + ', ' + g.h.name + ' ' + g.h.score + (g.a.win ? ' - ' + g.a.name + ' win' : g.h.win ? ' - ' + g.h.name + ' win' : '')); }
          }
        }
        const ks = Object.keys(seen); if (ks.length > 300) { for (const k of ks.slice(0, ks.length - 200)) delete seen[k]; changed = true; } if (changed) LS.set('alert', seen);
      } catch {}
      if (my === wtok) wtimer = setTimeout(tick, live ? 60000 : 300000);
    };
    wtimer = setTimeout(tick, 4000);
  }
  return { mount, stop, watch, unwatch, parse, LEAGUES, _ymd: ymd };
})();
