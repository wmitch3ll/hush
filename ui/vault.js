// Hush Vault: passwords and passkey notes, encrypted on this device. Nothing leaves it.
// Master password -> PBKDF2-SHA256 (600k rounds) -> AES-256-GCM key. The key lives only in memory and is dropped on lock / after idle time.
// Stored: { v, s: salt, i: rounds, iv, ct } in localStorage ("hush.vault"). A wrong password simply fails to decrypt.
(function (G) {
  const KEY = 'hush.vault', ROUNDS = 600000, enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = u => { let s = ''; const a = new Uint8Array(u); for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.subarray(i, i + 8192)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const ls = { get: () => { try { return localStorage.getItem(KEY); } catch { return null; } }, set: v => { try { localStorage.setItem(KEY, v); return true; } catch { return false; } } };
  const subtle = () => (G.crypto || {}).subtle;
  const S = { key: null, salt: null, rounds: ROUNDS, items: [], idle: 5 * 60e3, timer: 0, subs: new Set() };
  const emit = () => S.subs.forEach(f => { try { f(); } catch {} });
  const bump = () => { clearTimeout(S.timer); if (S.key && S.idle) S.timer = setTimeout(lock, S.idle); };
  const derive = async (pw, salt, rounds) => { const base = await subtle().importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', salt, iterations: rounds, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); };
  async function persist() { const iv = G.crypto.getRandomValues(new Uint8Array(12)); const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, S.key, enc.encode(JSON.stringify({ items: S.items })));
    return ls.set(JSON.stringify({ v: 1, s: b64(S.salt), i: S.rounds, iv: b64(iv), ct: b64(ct) })); }
  const exists = () => { try { return !!(JSON.parse(ls.get() || 'null') || {}).ct; } catch { return false; } };
  const unlocked = () => !!S.key;
  async function create(pw) { if (String(pw).length < 8) throw new Error('Use at least 8 characters'); if (exists()) throw new Error('A vault already exists');
    S.salt = G.crypto.getRandomValues(new Uint8Array(16)); S.rounds = ROUNDS; S.key = await derive(pw, S.salt, S.rounds); S.items = [];
    if (!(await persist())) { S.key = null; throw new Error('Couldn’t save on this device'); } bump(); emit(); }
  async function unlock(pw) { let v; try { v = JSON.parse(ls.get()); } catch { throw new Error('No vault yet'); }
    const salt = unb64(v.s), rounds = Math.max(100000, Math.min(5e6, +v.i || ROUNDS)), key = await derive(pw, salt, rounds);
    let plain; try { plain = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, key, unb64(v.ct)); } catch { throw new Error('Wrong password'); }
    S.key = key; S.salt = salt; S.rounds = rounds; S.items = (JSON.parse(dec.decode(plain)).items || []); bump(); emit(); }
  function lock() { S.key = null; S.items = []; clearTimeout(S.timer); emit(); }
  async function changePassword(oldPw, newPw) { if (String(newPw).length < 8) throw new Error('Use at least 8 characters'); const keep = S.items.slice(); await unlock(oldPw);
    S.salt = G.crypto.getRandomValues(new Uint8Array(16)); S.rounds = ROUNDS; S.key = await derive(newPw, S.salt, S.rounds); S.items = keep; await persist(); bump(); }
  const need = () => { if (!S.key) throw new Error('The vault is locked'); bump(); };
  const hostOf = u => { try { return new URL(/^[a-z]+:/i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return String(u || '').toLowerCase(); } };
  const rid = () => b64(G.crypto.getRandomValues(new Uint8Array(9))).replace(/[+/=]/g, 'x');
  const all = () => { need(); return S.items.slice(); };
  /** Logins that belong to this site (same host, or a parent/child domain such as accounts.example.com <-> example.com). */
  const forHost = h => { need(); h = hostOf(h); return S.items.filter(x => x.host === h || h.endsWith('.' + x.host) || x.host.endsWith('.' + h)); };
  async function add(o) { need(); const it = { id: rid(), host: hostOf(o.host || o.url || ''), name: String(o.name || o.host || '').slice(0, 80), user: String(o.user || ''), pass: String(o.pass || ''), note: String(o.note || '').slice(0, 500), t: Date.now(), u: Date.now() };
    if (!it.host) throw new Error('Which site is this for?');
    const dup = S.items.find(x => x.host === it.host && x.user === it.user); if (dup) { Object.assign(dup, { pass: it.pass, note: it.note || dup.note, u: Date.now() }); await persist(); emit(); return dup; }
    S.items.unshift(it); await persist(); emit(); return it; }
  async function update(id, o) { need(); const it = S.items.find(x => x.id === id); if (!it) return; for (const k of ['name', 'user', 'pass', 'note']) if (k in o) it[k] = String(o[k]); if (o.host) it.host = hostOf(o.host); it.u = Date.now(); await persist(); emit(); }
  async function remove(id) { need(); S.items = S.items.filter(x => x.id !== id); await persist(); emit(); }
  async function addMany(list) { need(); let n = 0, dup = 0;
    for (const o of list) { const h = hostOf(o.host), ex = S.items.find(x => x.host === h && x.user === o.user); if (ex) { dup++; continue; }
      S.items.push({ id: rid(), host: h, name: String(o.name || h).slice(0, 80), user: String(o.user || ''), pass: String(o.pass), note: String(o.note || '').slice(0, 500), t: Date.now(), u: Date.now() }); n++; }
    await persist(); emit(); return { added: n, skipped: dup }; }
  const csvCell = s => { s = String(s == null ? '' : s); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
  const exportCsv = () => { need(); return 'name,url,username,password,note\n' + S.items.map(x => [x.name, 'https://' + x.host, x.user, x.pass, x.note].map(csvCell).join(',')).join('\n') + '\n'; };

  // ----- generator + strength -----
  function generate(o) { o = Object.assign({ len: 20, lower: true, upper: true, digits: true, symbols: true, readable: false }, o || {});
    const n = Math.max(8, Math.min(64, o.len | 0)), amb = /[Il1O0o]/g, sets = [];
    const strip = s => o.readable ? s.replace(amb, '') : s;
    if (o.lower) sets.push(strip('abcdefghijklmnopqrstuvwxyz')); if (o.upper) sets.push(strip('ABCDEFGHIJKLMNOPQRSTUVWXYZ')); if (o.digits) sets.push(strip('0123456789')); if (o.symbols) sets.push('!@#$%^&*-_=+?');
    if (!sets.length) sets.push(strip('abcdefghijklmnopqrstuvwxyz')); const pool = sets.join('');
    const rnd = max => { const lim = Math.floor(0x100000000 / max) * max; const b = new Uint32Array(1); do { G.crypto.getRandomValues(b); } while (b[0] >= lim); return b[0] % max; };
    const out = sets.map(s => s[rnd(s.length)]); while (out.length < n) out.push(pool[rnd(pool.length)]);
    for (let i = out.length - 1; i > 0; i--) { const j = rnd(i + 1); [out[i], out[j]] = [out[j], out[i]]; } return out.join(''); }
  const COMMON = /^(password|passw0rd|qwerty|letmein|welcome|admin|iloveyou|monkey|dragon|football|baseball|abc123|111111|123123|123456|12345678|1234567890|sunshine|princess|login)/i;
  /** 0 (bad) .. 4 (strong): length and variety, with penalties for common words, repeats and runs. */
  function strength(p) { p = String(p || ''); if (!p) return 0; let pool = 0; if (/[a-z]/.test(p)) pool += 26; if (/[A-Z]/.test(p)) pool += 26; if (/\d/.test(p)) pool += 10; if (/[^A-Za-z0-9]/.test(p)) pool += 32;
    let bits = p.length * Math.log2(Math.max(pool, 2)); if (COMMON.test(p)) bits -= 30; if (/(.)\1{2,}/.test(p)) bits -= 8; if (/(0123|1234|2345|3456|abcd|bcde|qwer|asdf)/i.test(p)) bits -= 10; if (new Set(p).size < p.length / 2) bits -= 10;
    return bits < 28 ? 0 : bits < 40 ? 1 : bits < 56 ? 2 : bits < 75 ? 3 : 4; }
  /** Local health check: weak, reused and old passwords. (Breach lookups are separate and opt-in.) */
  function audit() { need(); const by = {}; S.items.forEach(x => (by[x.pass] = by[x.pass] || []).push(x));
    return { weak: S.items.filter(x => x.pass && strength(x.pass) <= 1), reused: S.items.filter(x => x.pass && by[x.pass].length > 1), old: S.items.filter(x => Date.now() - (x.u || x.t) > 365 * 864e5), empty: S.items.filter(x => !x.pass) }; }
  /** Has this password shown up in a breach? Only the first 5 characters of its SHA-1 hash are sent (k-anonymity); `range(prefix)` does the request. */
  async function pwned(pass, range) { const h = Array.from(new Uint8Array(await subtle().digest('SHA-1', enc.encode(pass)))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const txt = await range(h.slice(0, 5)); const line = String(txt).split(/\r?\n/).find(l => l.startsWith(h.slice(5))); return line ? +line.split(':')[1] || 1 : 0; }

  G.HXV = { exists, unlocked, create, unlock, lock, changePassword, all, forHost, add, update, remove, addMany, exportCsv, generate, strength, audit, pwned, hostOf,
    sub: f => (S.subs.add(f), () => S.subs.delete(f)), idle: ms => { S.idle = ms; bump(); }, _s: S };
  if (typeof module !== 'undefined') module.exports = G.HXV;
})(typeof window !== 'undefined' ? window : globalThis);
