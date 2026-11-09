// Bring your stuff from another browser: bookmarks (HTML exports from Chrome, Edge, Firefox, Safari, Brave...; Firefox JSON backups)
// and saved logins (the CSV that Chrome, Edge, Firefox, Safari, Bitwarden, 1Password and others export). Pure parsing, no network.
(function (G) {
  const esc = s => String(s == null ? '' : s);
  const decode = s => esc(s).replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase(); if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'quot') return '"'; if (k === 'apos') return "'"; if (k === 'nbsp') return ' ';
    const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); try { return String.fromCodePoint(n); } catch { return ''; } });
  const okUrl = u => /^https?:\/\//i.test(u);

  /** Netscape bookmark file (every browser's "Export bookmarks" HTML). Folders come from the nested <DL> structure. */
  function bookmarksHtml(html) {
    const out = [], stack = []; let pending = null;
    const re = /<(\/?)(h3|dl|a)\b([^>]*)>([^<]*)/gi; let m;
    while ((m = re.exec(html))) {
      const close = m[1] === '/', tag = m[2].toLowerCase(), attrs = m[3], text = m[4];
      if (tag === 'h3' && !close) { pending = decode(text).trim(); }
      else if (tag === 'dl' && !close) { stack.push(pending); pending = null; }
      else if (tag === 'dl' && close) { stack.pop(); }
      else if (tag === 'a' && !close) {
        const href = (/href\s*=\s*"([^"]*)"/i.exec(attrs) || /href\s*=\s*'([^']*)'/i.exec(attrs) || [])[1];
        const url = decode(href || '').trim(); if (!okUrl(url)) continue;
        const names = stack.filter(Boolean).filter(n => !/^(bookmarks( bar| menu| toolbar)?|favorites( bar)?|other bookmarks|mobile bookmarks|menu|toolbar|unfiled bookmarks|bookmarks toolbar)$/i.test(n));
        out.push({ title: decode(text).trim().slice(0, 120) || url, url, folder: names.join(' / ').slice(0, 60) });
      }
    }
    return out;
  }
  /** Firefox "Backup" JSON (Bookmarks > Show all > Backup). */
  function bookmarksJson(txt) {
    let j; try { j = JSON.parse(txt); } catch { return []; }
    const out = []; const walk = (n, path) => { if (!n) return;
      if (n.uri && okUrl(n.uri)) out.push({ title: esc(n.title).slice(0, 120) || n.uri, url: n.uri, folder: path.join(' / ').slice(0, 60) });
      if (Array.isArray(n.children)) { const p = n.type === 'text/x-moz-place-container' && n.title && !/^(menu|toolbar|unfiled|mobile)$/i.test(n.title) ? path.concat(n.title) : path; n.children.forEach(c => walk(c, p)); } };
    walk(j, []); return out;
  }

  /** Small, strict CSV reader (quotes, doubled quotes, CRLF, commas/newlines inside quotes). */
  function csv(text) {
    const rows = []; let row = [], cur = '', q = false; text = String(text).replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) { const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
      else cur += c; }
    row.push(cur); if (row.some(x => x !== '')) rows.push(row); return rows;
  }
  /** Saved logins from a password manager / browser export. Understands Chrome, Edge, Brave, Firefox, Safari, Bitwarden, 1Password, LastPass, Dashlane. */
  function loginsCsv(text) {
    const rows = csv(text); if (rows.length < 2) return [];
    const h = rows[0].map(x => x.trim().toLowerCase()), at = (...names) => { for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; } return -1; };
    const iu = at('url', 'login_uri', 'website', 'origin', 'web site', 'login url'), iname = at('name', 'title', 'login_name'), iuser = at('username', 'login_username', 'user', 'login', 'email', 'user name', 'login name'),
      ipw = at('password', 'login_password', 'pass'), inote = at('note', 'notes', 'extra', 'comments');
    if (ipw < 0 || (iu < 0 && iname < 0)) return [];
    const out = [];
    for (const r of rows.slice(1)) { const pass = esc(r[ipw]); if (!pass) continue;
      let url = esc(r[iu]).trim(); if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
      let host = ''; try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch {}
      if (!host && iname >= 0) { const g = esc(r[iname]).trim().toLowerCase(); if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(g)) host = g.replace(/^www\./, ''); }
      if (!host) continue;
      out.push({ host, name: iname >= 0 ? esc(r[iname]).slice(0, 80) : host, user: iuser >= 0 ? esc(r[iuser]) : '', pass, note: inote >= 0 ? esc(r[inote]).slice(0, 500) : '' }); }
    return out;
  }
  /** One call for any file: tells you what it was. */
  function parse(text, name) {
    const t = esc(text), n = esc(name).toLowerCase();
    if (/\.json$/.test(n) || /^\s*[{[]/.test(t)) { const b = bookmarksJson(t); if (b.length) return { kind: 'bookmarks', bookmarks: b, logins: [] }; }
    if (/<dl|<a\s+href/i.test(t) && !/\.csv$/.test(n)) { const b = bookmarksHtml(t); return { kind: 'bookmarks', bookmarks: b, logins: [] }; }
    const l = loginsCsv(t); if (l.length) return { kind: 'logins', bookmarks: [], logins: l };
    return { kind: 'unknown', bookmarks: [], logins: [] };
  }
  G.HXI = { parse, bookmarksHtml, bookmarksJson, loginsCsv, csv };
  if (typeof module !== 'undefined') module.exports = G.HXI;
})(typeof window !== 'undefined' ? window : globalThis);
