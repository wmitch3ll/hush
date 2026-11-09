// Privacy autopilot: reads a site's privacy policy on this device and tells you, in plain words, what it does with your data.
// HXPA.analyze(text) -> { grade, score, findings:[{kind:'bad'|'good'|'note', title, quote, w}] }.  No network, no AI needed (the AI only rewrites the result in friendlier words).
// HXPA.open(el, o): the screen.  o = { host, getPolicy():Promise<{url,text}|null>, ask?(prompt,on):Promise, toast, close, open(url) }
(function (G) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NEG = /\b(do(?:es)? not|don[’']t|never|won[’']t|will not|not)\b[^.]{0,30}\b(sell|share|rent|disclose)/i;
  // [id, regex, weight (bad > 0, good < 0), title]. First sentence matching each rule is kept as evidence.
  const RULES = [
    ['sell', /\b(sell|sold|selling|sale of|rent)\b[^.]{0,70}\b(personal (?:information|data)|your (?:data|information)|data about you)/i, 28, 'May sell your personal data', true],
    ['sell2', /\bsale of personal (?:information|data)\b|\bdata broker/i, 14, 'Mentions data brokers or the sale of personal data', true],
    ['ads', /\b(share|disclose|provide|make available)\b[^.]{0,80}\b(advertis\w+|marketing)\b[^.]{0,40}\b(partners?|networks?|companies|providers?)|\b(advertising|marketing) partners\b/i, 14, 'Shares data with advertising partners', true],
    ['third', /\b(share|disclose)\b[^.]{0,70}\b(third[- ]part(?:y|ies)|affiliates|business partners)\b/i, 9, 'Shares data with third parties or affiliates', true],
    ['cross', /\bcross[- ](?:site|context|device|app)\b|\btrack(?:ing)? you across\b|\bacross (?:other )?(?:websites|sites|devices)\b/i, 12, 'Follows you across sites or devices', true],
    ['finger', /\bfingerprint(?:ing)?\b(?![^.]{0,20}\b(?:sensor|login|unlock))|\bdevice (?:identifiers?|fingerprint)\b/i, 8, 'Uses device fingerprints or identifiers', true],
    ['pixel', /\b(?:tracking )?pixels?\b|\bweb beacons?\b|\badvertising ids?\b|\bad ids?\b/i, 7, 'Uses tracking pixels or advertising IDs', true],
    ['loc', /\b(?:precise|exact|real[- ]time) (?:geo)?location\b|\bgps\b|\blocation data\b/i, 7, 'Collects your location', true],
    ['bio', /\bbiometric\b|\bface (?:geometry|recognition|scan)\b|\bvoice ?prints?\b|\bfaceprint/i, 9, 'Collects biometric data', true],
    ['combine', /\bcombine\b[^.]{0,60}\b(?:other sources|third[- ]part|data brokers|information we (?:receive|obtain))/i, 8, 'Combines your data with data from other sources', true],
    ['contacts', /\b(?:contacts?|address book|phone book)\b[^.]{0,40}\b(?:upload|collect|access|sync)/i, 6, 'May collect your contacts', true],
    ['keep', /\b(?:retain|keep|store)\b[^.]{0,60}\b(?:indefinitely|as long as (?:necessary|we (?:need|deem))|for as long as)/i, 6, 'Keeps your data for a long or unspecified time', true],
    ['profile', /\b(?:build|create|infer)\w*\b[^.]{0,40}\b(?:profile|inferences?)\b/i, 8, 'Builds a profile of you', true],
    ['nosell', /\b(?:do(?:es)? not|never|won[’']t|will not)\b[^.]{0,20}\bsell\b[^.]{0,60}\b(?:personal|your|data|information)/i, -15, 'Says it does not sell your data', false],
    ['noshare', /\b(?:do(?:es)? not|never|won[’']t|will not)\b[^.]{0,20}\bshare\b[^.]{0,60}\b(?:personal|your|data|information)\b[^.]{0,40}\b(?:third|advertis|market|partners)/i, -9, 'Says it does not share your data with advertisers or third parties', false],
    ['delete', /\b(?:request|ask|right)\b[^.]{0,40}\b(?:delet\w+|erase\w*|erasure)\b|\bdelete (?:your|the) (?:account|data|personal)/i, -6, 'Lets you delete your data', false],
    ['optout', /\bopt[- ]out\b|\bunsubscribe\b/i, -3, 'Offers opt-outs', false],
    ['e2e', /\bend[- ]to[- ]end encrypt\w*/i, -8, 'Uses end-to-end encryption', false],
    ['gpc', /\bglobal privacy control\b|\bGPC\b|\bdo not track\b/i, -4, 'Honors privacy signals like Global Privacy Control', false],
    ['min', /\bdata minimi[sz]ation\b|\bonly (?:collect|use)\b[^.]{0,40}\b(?:necessary|needed|required)/i, -4, 'Says it collects only what it needs', false],
  ];
  const sentences = t => String(t).replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/).filter(s => s.length > 25 && s.length < 600);
  function analyze(text) {
    text = String(text || ''); const ss = sentences(text.slice(0, 250000)), found = [], seen = new Set();
    if (text.replace(/\s/g, '').length < 800) return { grade: '?', score: null, findings: [{ kind: 'note', title: 'Couldn’t read enough of the policy to judge it', quote: '' }], words: text.split(/\s+/).length };
    for (const [id, re, w, title, bad] of RULES) {
      for (const s of ss) { if (!re.test(s)) continue; if (bad && NEG.test(s) && !/\b(?:may|can|might|could)\b/i.test(s)) continue;   // "we do not sell…" is good news, not bad
        const key = s.slice(0, 60); if (seen.has(key)) continue; seen.add(key); found.push({ kind: w > 0 ? 'bad' : 'good', id, title, quote: s.length > 260 ? s.slice(0, 257) + '…' : s, w }); break; }
    }
    let score = 78; let bad = 0, good = 0; for (const f of found) { if (f.w > 0) bad += f.w; else good += -f.w; }
    score = Math.round(Math.max(0, Math.min(100, score - Math.min(75, bad) + Math.min(22, good))));
    const words = text.split(/\s+/).length; if (words > 12000) found.push({ kind: 'note', title: 'The policy is very long (' + Math.round(words / 250) + ' min to read) — hard to know what you agreed to', quote: '' });
    const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';
    found.sort((a, b) => (b.w > 0) - (a.w > 0) || Math.abs(b.w) - Math.abs(a.w));
    return { grade, score, findings: found, words };
  }
  const SUMMARY = { A: 'Looks respectful of your privacy', B: 'Mostly fine, with a few things to know', C: 'Collects and shares a fair amount', D: 'Shares your data widely', F: 'Heavy tracking and data sharing' };
  const COL = { A: '#16a34a', B: '#65a30d', C: '#d97706', D: '#ea580c', F: '#dc2626', '?': '#71717a' };
  const CSS = `.pa{display:grid;gap:12px;font:14px/1.45 system-ui,sans-serif;color:var(--ink,#161616);max-width:640px;margin:0 auto;width:100%}.pa *{box-sizing:border-box}.pa h3{margin:0;font:700 20px system-ui;letter-spacing:-.02em}.pa p{margin:0;color:var(--mute,#8b8b88)}
.pa .row{display:flex;gap:10px;align-items:center}.pa .grow{flex:1}.pa button{all:unset;cursor:pointer;padding:10px 16px;border-radius:99px;font:600 13.5px system-ui;background:color-mix(in srgb,var(--ink,#161616) 10%,transparent)}.pa button.p{background:var(--ink,#161616);color:var(--bg,#f5f5f4)}
.pa .big{display:flex;gap:16px;align-items:center;padding:18px;border-radius:20px;background:var(--card,#fff);border:1px solid var(--line,#e4e4e2)}.pa .g{width:68px;height:68px;border-radius:20px;display:grid;place-items:center;font:800 38px system-ui;color:#fff;flex:none}
.pa .f{padding:12px 14px;border-radius:14px;background:var(--card,#fff);border:1px solid var(--line,#e4e4e2);display:grid;gap:5px}.pa .f b{display:flex;gap:8px;align-items:flex-start;font:600 14px system-ui}.pa .f i{font-style:normal;flex:none;width:20px;height:20px;border-radius:99px;display:grid;place-items:center;font-size:12px;color:#fff}
.pa .f blockquote{margin:0;padding-left:10px;border-left:2px solid var(--line,#e4e4e2);color:var(--mute,#8b8b88);font-size:12.5px;user-select:text}.pa .ai{padding:14px;border-radius:16px;background:color-mix(in srgb,#8b5cf6 12%,transparent);white-space:pre-wrap;user-select:text}.pa .spin{color:var(--mute,#8b8b88)}`;
  function open(el, o) {
    o = o || {}; if (!document.getElementById('pa-css')) { const s = document.createElement('style'); s.id = 'pa-css'; s.textContent = CSS; document.head.append(s); }
    const root = document.createElement('div'); root.className = 'pa'; el.replaceChildren(root);
    root.innerHTML = `<div class=row><h3 class=grow>Privacy check</h3>${o.close ? '<button data-x>Done</button>' : ''}</div><p class=spin>Finding ${esc(o.host || 'the site')}’s privacy policy…</p>`;
    const x = () => { const b = root.querySelector('[data-x]'); if (b) b.onclick = () => o.close(); }; x();
    (async () => {
      let pol = null; try { pol = await o.getPolicy(); } catch (e) { pol = { err: String(e && e.message || e) }; }
      if (!root.isConnected) return;
      if (!pol || !pol.text) { root.innerHTML = `<div class=row><h3 class=grow>Privacy check</h3>${o.close ? '<button data-x>Done</button>' : ''}</div><p>${esc(pol && pol.err ? pol.err : 'I couldn’t find a privacy policy link on this page. Open the site’s privacy policy and run the check from there.')}</p>`; x(); return; }
      const r = analyze(pol.text), g = r.grade, bad = r.findings.filter(f => f.kind === 'bad'), good = r.findings.filter(f => f.kind === 'good'), note = r.findings.filter(f => f.kind === 'note');
      const card = (f, c, sym) => `<div class=f><b><i style="background:${c}">${sym}</i><span>${esc(f.title)}</span></b>${f.quote ? `<blockquote>“${esc(f.quote)}”</blockquote>` : ''}</div>`;
      root.innerHTML = `<div class=row><h3 class=grow>Privacy check</h3>${o.close ? '<button data-x>Done</button>' : ''}</div>
        <div class=big><div class=g style="background:${COL[g]}">${g}</div><div class=grow><b style="font:700 17px system-ui">${esc(g === '?' ? 'Not enough to judge' : SUMMARY[g])}</b><p>${esc(o.host || '')} · read on this device${r.score != null ? ' · score ' + r.score + '/100' : ''}</p></div></div>
        ${o.ask ? '<div class=row><button class=p data-ai>Explain it in plain words</button></div><div id=aiout></div>' : ''}
        ${bad.length ? `<p style="font-weight:600">Worth knowing</p>${bad.map(f => card(f, '#dc2626', '!')).join('')}` : ''}
        ${good.length ? `<p style="font-weight:600">In its favor</p>${good.map(f => card(f, '#16a34a', '✓')).join('')}` : ''}
        ${note.map(f => card(f, '#71717a', 'i')).join('')}
        <p style="font-size:12.5px">An automatic reading of the policy’s wording, not legal advice. ${pol.url ? `<a href="#" data-open style="color:inherit">Open the full policy</a>` : ''}</p>`;
      x(); const op = root.querySelector('[data-open]'); if (op) op.onclick = e => { e.preventDefault(); o.open && o.open(pol.url); };
      const ai = root.querySelector('[data-ai]'); if (ai) ai.onclick = async () => { ai.disabled = true; const out = root.querySelector('#aiout'); out.innerHTML = '<p class=spin>Thinking…</p>';
        const ev = r.findings.filter(f => f.quote).slice(0, 8).map(f => '- ' + f.quote).join('\n');
        try { let acc = ''; await o.ask(`You are a privacy expert. A privacy policy for ${o.host || 'a website'} scored ${g} (${r.score}/100). Key sentences from it:\n${ev}\n\nIn 4 short bullet points, tell an ordinary person what this site does with their data and what to watch out for. No legal jargon.`, t => { acc = t; out.innerHTML = '<div class=ai>' + esc(acc) + '</div>'; });
          if (!acc) out.innerHTML = ''; } catch (e) { out.innerHTML = '<p>' + esc(String(e && e.message || e)) + '</p>'; } ai.disabled = false; };
    })();
  }
  G.HXPA = { analyze, open };
  if (typeof module !== 'undefined') module.exports = G.HXPA;
})(typeof window !== 'undefined' ? window : globalThis);
