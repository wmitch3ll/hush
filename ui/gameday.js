// Game Day: your teams, live games with the betting line, pick'em with a running record, and headlines (ESPN + any RSS feed, e.g. Hyperfeast) in one screen.
// HXGD.open(el, A)  A = { inv, pref, setPref, open(url), toast, close? }.  Needs scores.js (HUSH_SCORES.parse).
(function (G) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LEAGUES = { nfl: 'NFL', cfb: 'College football', nba: 'NBA', cbb: 'College basketball', nhl: 'NHL', mlb: 'MLB', wcbb: 'Women’s college basketball', mls: 'MLS' };
  const SHORT = { nfl: 'NFL', cfb: 'NCAAF', nba: 'NBA', cbb: 'NCAAB', nhl: 'NHL', mlb: 'MLB', wcbb: 'WCBB', mls: 'MLS' };
  const WEEKLY = { nfl: 1, cfb: 1 };
  const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const PINS = 'hush.scores.pins', PICKS = 'hush.gd.picks', REC = 'hush.gd.rec';
  const ymd = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  // ESPN's daily board rolls over at 9am Pacific: before that, "today" is still last night's slate.
  const ptDate = () => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hour12: false }).formatToParts(new Date()).reduce((a, x) => (a[x.type] = +x.value, a), {});
    const d = new Date(p.year, p.month - 1, p.day, 12); if ((p.hour % 24) < 9) d.setDate(d.getDate() - 1); return d; };
  const dateFor = lg => WEEKLY[lg] ? null : ymd(ptDate());

  // ---------- pick'em ----------
  const rec = () => Object.assign({ w: 0, l: 0, streak: 0, best: 0 }, LS.get(REC, {}));
  /** Grade picks for games that are now final. Returns how many were graded. */
  function grade(games) { const picks = LS.get(PICKS, {}); let n = 0; const r = rec();
    for (const g of games) { const k = g.lg + ':' + g.id, p = picks[k]; if (!p || p.r || g.state !== 'post') continue; const won = (g.a.win && p.t === g.a.id) || (g.h.win && p.t === g.h.id); const lost = (g.a.win && p.t === g.h.id) || (g.h.win && p.t === g.a.id); if (!won && !lost) continue;
      p.r = won ? 'w' : 'l'; n++; if (won) { r.w++; r.streak = r.streak > 0 ? r.streak + 1 : 1; r.best = Math.max(r.best, r.streak); } else { r.l++; r.streak = r.streak < 0 ? r.streak - 1 : -1; } }
    if (n) { LS.set(REC, r); const keys = Object.keys(picks); if (keys.length > 400) for (const k of keys.slice(0, keys.length - 300)) delete picks[k]; LS.set(PICKS, picks); } return n; }

  // ---------- headlines ----------
  function parseFeed(xml, label) { const out = []; let doc; try { doc = new DOMParser().parseFromString(xml, 'text/xml'); } catch { return out; } if (doc.querySelector('parsererror')) return out;
    const txt = (n, s) => { const e = n.querySelector(s); return e ? (e.textContent || '').trim() : ''; };
    for (const it of [...doc.querySelectorAll('item, entry')].slice(0, 20)) { const t = txt(it, 'title'); let link = txt(it, 'link'); const lk = it.querySelector('link[href]'); if (lk) link = lk.getAttribute('href') || link;
      if (!t || !/^https:\/\//.test(link)) continue; const d = Date.parse(txt(it, 'pubDate') || txt(it, 'published') || txt(it, 'updated') || '') || 0;
      const desc = txt(it, 'description') || txt(it, 'summary'); out.push({ t: t.slice(0, 200), u: link, at: d, s: label, d: desc.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) }); }
    return out; }
  function parseEspnNews(json, label) { const out = []; for (const a of (json && json.articles) || []) { const u = a.links && a.links.web && a.links.web.href; if (!a.headline || !/^https:\/\/(www\.)?espn\.com\//.test(u || '')) continue;
      out.push({ t: String(a.headline).slice(0, 200), u, at: Date.parse(a.published) || 0, s: label, d: String(a.description || '').slice(0, 160) }); } return out; }
  const ago = t => { if (!t) return ''; const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

  const CSS = `.gd{display:grid;gap:12px;font:14px/1.4 system-ui,sans-serif;color:var(--ink,#161616);max-width:680px;margin:0 auto;width:100%}.gd *{box-sizing:border-box}.gd h3{margin:0;font:700 22px system-ui;letter-spacing:-.02em}.gd p{margin:0;color:var(--mute,#8b8b88)}
.gd .row{display:flex;gap:8px;align-items:center}.gd .grow{flex:1}.gd button{all:unset;cursor:pointer;padding:8px 14px;border-radius:99px;font:600 13px system-ui;background:color-mix(in srgb,var(--ink,#161616) 10%,transparent);white-space:nowrap}.gd button.on{background:var(--ink,#161616);color:var(--bg,#f5f5f4)}
.gd .tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}.gd .sec{font:700 12px system-ui;letter-spacing:.06em;text-transform:uppercase;color:var(--mute,#8b8b88);margin:6px 2px -4px}
.gd .g{display:grid;gap:8px;padding:12px 14px;border-radius:16px;background:var(--card,#fff);border:1px solid var(--line,#e4e4e2)}.gd .g.live{border-color:#ef444488;box-shadow:0 0 0 3px #ef444418}
.gd .t{display:flex;align-items:center;gap:10px;min-width:0}.gd .t b{flex:1;font:600 15px system-ui;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gd .t.l b{font-weight:500;opacity:.6}.gd .t i{width:10px;height:10px;border-radius:50%;flex:none}
.gd .t .s{font:700 18px ui-monospace,Menlo,monospace;min-width:30px;text-align:right}.gd .t.l .s{opacity:.5}.gd .meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font:600 12px system-ui;color:var(--mute,#8b8b88)}.gd .meta .live{color:#ef4444}
.gd .chip{padding:3px 9px;border-radius:99px;background:color-mix(in srgb,var(--ink,#161616) 8%,transparent);font:600 11.5px system-ui;color:var(--ink,#161616)}
.gd .pk{padding:5px 11px!important;font-size:12px!important;border:1px solid var(--line,#e4e4e2)}.gd .pk.on{background:#3b82f6!important;color:#fff!important;border-color:#3b82f6}.gd .pk.w{background:#16a34a!important;color:#fff!important}.gd .pk.x{background:#dc2626!important;color:#fff!important}
.gd .star{padding:2px 6px!important;background:none!important;opacity:.35;font-size:15px!important}.gd .star.on{opacity:1;color:#eab308}
.gd .rec{display:flex;gap:14px;align-items:center;padding:12px 14px;border-radius:16px;background:linear-gradient(135deg,#3b82f622,#8b5cf622)}.gd .rec b{font:800 24px system-ui}.gd .rec small{display:block;color:var(--mute,#8b8b88);font-size:11.5px}
.gd .n{display:grid;gap:3px;padding:12px 14px;border-radius:16px;background:var(--card,#fff);border:1px solid var(--line,#e4e4e2);cursor:pointer}.gd .n b{font:600 14.5px/1.3 system-ui}.gd .n small{color:var(--mute,#8b8b88);font-size:12px}.gd .n p{font-size:13px}
.gd input{width:100%;padding:10px 13px;border-radius:12px;border:1px solid var(--line,#e4e4e2);background:var(--card,#fff);color:inherit;font:14px system-ui;outline:none;user-select:text}`;
  function open(el, A) {
    if (!document.getElementById('gd-css')) { const s = document.createElement('style'); s.id = 'gd-css'; s.textContent = CSS; document.head.append(s); }
    const root = document.createElement('div'); root.className = 'gd'; el.replaceChildren(root);
    const leagues = (String(A.pref('sp_leagues') || 'nfl,cfb,nba,cbb,nhl').split(',').filter(l => LEAGUES[l])), lgs = leagues.length ? leagues : ['nfl'];
    const st = { tab: 'games', games: null, news: null, err: '', only: 'all' }; let alive = true, timer = 0;
    const pins = () => LS.get(PINS, []), isPin = (lg, id) => pins().includes(lg + ':' + id), picks = () => LS.get(PICKS, {});
    const feedUrl = () => A.pref('gd_feed') || 'https://hyperfeast.com/feed';
    async function loadGames() { try { const res = await Promise.all(lgs.map(async l => { const j = JSON.parse(await A.inv('scores_get', { league: l, date: dateFor(l) })); return G.HUSH_SCORES.parse(j).map(g => ({ ...g, lg: l })); }));
        st.games = res.flat(); st.err = ''; grade(st.games); } catch (e) { if (!st.games) st.err = 'Scores are unavailable right now.'; } }
    async function loadNews() { const jobs = lgs.slice(0, 3).map(async l => { try { return parseEspnNews(JSON.parse(await A.inv('news_get', { league: l })), SHORT[l]); } catch { return []; } });
      jobs.push((async () => { try { const u = feedUrl(); return parseFeed(await A.inv('feed_get', { url: u }), new URL(u).hostname.replace(/^www\./, '')); } catch { return []; } })());
      const all = (await Promise.all(jobs)).flat(), seen = new Set(); st.news = all.filter(n => { const k = n.t.toLowerCase().slice(0, 50); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 40); }
    const card = g => { const fin = g.state === 'post', lose = s => fin && !s.win, pk = picks()[g.lg + ':' + g.id], mineG = isPin(g.lg, g.a.id) || isPin(g.lg, g.h.id);
      const team = t => `<div class="t ${lose(t) ? 'l' : ''}"><button class="star ${isPin(g.lg, t.id) ? 'on' : ''}" data-pin="${esc(g.lg + ':' + t.id)}" aria-label="Follow ${esc(t.name)}">★</button><b>${t.rank ? '<small style="opacity:.6">#' + esc(t.rank) + '</small> ' : ''}${esc(t.name || t.ab)}</b><span class=s>${g.state === 'pre' ? '' : esc(t.score)}</span></div>`;
      const pickBtn = t => g.state === 'pre' ? `<button class="pk ${pk && pk.t === t.id ? 'on' : ''}" data-pick="${esc(g.lg + ':' + g.id + ':' + t.id)}">${pk && pk.t === t.id ? '✓ ' : ''}Pick ${esc(t.ab)}</button>` : '';
      const res = pk && pk.r ? `<span class="chip" style="background:${pk.r === 'w' ? '#16a34a' : '#dc2626'};color:#fff">${pk.r === 'w' ? 'You called it' : 'Missed pick'}</span>` : fin && pk ? '' : '';
      return `<div class="g ${g.state === 'in' ? 'live' : ''}" data-l="${esc(g.link || '')}">${team(g.a)}${team(g.h)}<div class=meta><span class="${g.state === 'in' ? 'live' : ''}">${g.state === 'in' ? '● ' : ''}${esc(g.state === 'pre' ? new Date(g.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : g.detail)}</span><span class=chip>${esc(SHORT[g.lg])}</span>${g.odds && g.odds.d ? `<span class=chip title="Betting line">${esc(g.odds.d)}${g.odds.ou ? ' · O/U ' + esc(g.odds.ou) : ''}</span>` : ''}${res}<span class=grow></span>${pickBtn(g.a)}${pickBtn(g.h)}</div></div>`; };
    function gamesView() { if (st.err) return `<p>${esc(st.err)} <button data-retry>Try again</button></p>`; if (!st.games) return '<p>Loading games…</p>';
      const r = rec(), tot = r.w + r.l; const mine = st.games.filter(g => isPin(g.lg, g.a.id) || isPin(g.lg, g.h.id)); const rest = st.games.filter(g => !mine.includes(g));
      const grp = (title, list) => list.length ? `<div class=sec>${title}</div>${list.map(card).join('')}` : '';
      const sort = l => l.slice().sort((x, y) => x.at - y.at);
      return `<div class=rec><div><b>${r.w}–${r.l}</b><small>Your pick’em record${tot ? ' · ' + Math.round(r.w / tot * 100) + '%' : ''}</small></div><div><b>${r.streak > 0 ? '🔥 ' + r.streak : r.streak < 0 ? 'L' + -r.streak : '–'}</b><small>Streak</small></div><div><b>${r.best}</b><small>Best</small></div></div>
        ${st.games.length ? '' : '<p>No games on the board for your leagues right now.</p>'}${grp('Your teams', sort(mine))}${grp('Live now', rest.filter(g => g.state === 'in'))}${grp('Coming up', sort(rest.filter(g => g.state === 'pre')))}${grp('Final', rest.filter(g => g.state === 'post'))}
        <p style="font-size:12px">Betting lines come from ESPN and are shown for information only. Pick’em is just for fun — stored on this device. Star a team to follow it.</p>`; }
    function newsView() { if (!st.news) return '<p>Loading headlines…</p>';
      return `${st.news.length ? st.news.map(n => `<div class=n data-u="${esc(n.u)}"><small>${esc(n.s)}${n.at ? ' · ' + ago(n.at) : ''}</small><b>${esc(n.t)}</b>${n.d ? `<p>${esc(n.d)}</p>` : ''}</div>`).join('') : '<p>No headlines came through. Check the feed address below.</p>'}
        <div><p style="margin:8px 0 6px;font-weight:600;color:var(--ink)">Your feed</p><div class=row><input id=feed value="${esc(feedUrl())}" placeholder="https://hyperfeast.com/feed" autocapitalize=none><button id=feedgo>Save</button></div></div>`; }
    function paint() { if (!alive || !root.isConnected) return;
      root.innerHTML = `<div class=row><h3 class=grow>Game day</h3>${A.close ? '<button data-x>Done</button>' : ''}</div><div class=tabs><button data-tab=games class="${st.tab === 'games' ? 'on' : ''}">Games</button><button data-tab=news class="${st.tab === 'news' ? 'on' : ''}">Headlines</button></div>${st.tab === 'games' ? gamesView() : newsView()}`;
      root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; if (st.tab === 'news' && !st.news) loadNews().then(paint); paint(); });
      const x = root.querySelector('[data-x]'); if (x) x.onclick = () => A.close(); const rt = root.querySelector('[data-retry]'); if (rt) rt.onclick = () => { st.err = ''; st.games = null; paint(); loadGames().then(paint); };
      root.querySelectorAll('[data-pin]').forEach(b => b.onclick = e => { e.stopPropagation(); const k = b.dataset.pin, p = pins(); LS.set(PINS, p.includes(k) ? p.filter(v => v !== k) : p.concat(k).slice(-40)); paint(); });
      root.querySelectorAll('[data-pick]').forEach(b => b.onclick = e => { e.stopPropagation(); const [lg, id, t] = b.dataset.pick.split(':'), p = picks(), k = lg + ':' + id; if (p[k] && p[k].t === t) delete p[k]; else p[k] = { t, at: Date.now() }; LS.set(PICKS, p); paint(); });
      let last = null, lt = 0; root.querySelectorAll('.g[data-l]').forEach(g => g.onclick = () => { if (!g.dataset.l) return; const n = Date.now(); if (last === g && n - lt < 600) { last = null; A.open(g.dataset.l); } else { last = g; lt = n; A.toast && A.toast('Double-tap to open the game page'); } });
      root.querySelectorAll('[data-u]').forEach(n => n.onclick = () => A.open(n.dataset.u));
      const fg = root.querySelector('#feedgo'); if (fg) fg.onclick = async () => { const v = root.querySelector('#feed').value.trim(); if (!/^https:\/\//.test(v)) return A.toast && A.toast('The feed must start with https://'); await A.setPref('gd_feed', v); st.news = null; paint(); loadNews().then(paint); }; }
    paint(); loadGames().then(paint);
    const tick = () => { if (!alive || !root.isConnected) return; if (!document.hidden && st.tab === 'games') loadGames().then(paint); timer = setTimeout(tick, (st.games || []).some(g => g.state === 'in') ? 45000 : 180000); }; timer = setTimeout(tick, 45000);
    return { stop() { alive = false; clearTimeout(timer); } };
  }
  G.HXGD = { open, grade, parseFeed, parseEspnNews };
})(window);
