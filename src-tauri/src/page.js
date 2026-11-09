// Page tools injected into a tab on demand (desktop: Webview::eval, Android: evaluateJavascript).
// Rust appends one call such as `__hushPage.dark(true)`. Idempotent; safe to inject many times.
window.__hushPage = window.__hushPage || (() => {
  const ready = f => document.readyState === "loading" ? addEventListener("DOMContentLoaded", f, { once: true }) : f();

  /** Force dark: invert the page, re-invert media. Skips pages that are already dark. */
  function dark(on) {
    ready(() => {
      let s = document.getElementById("hush-dark");
      if (!on) { if (s) s.remove(); return; }
      if (s) return;
      const el = document.body || document.documentElement;
      const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g) || [255, 255, 255, 0];
      const [r, g, b, a = 1] = m.map(Number);
      if (a > 0.5 && (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.35) return;   // site is already dark
      s = document.createElement("style"); s.id = "hush-dark";
      s.textContent = 'html{filter:invert(.9) hue-rotate(180deg)!important;background:#fff!important}' +
        'img,video,picture,canvas,iframe,embed,object,svg image,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)!important}';
      (document.head || document.documentElement).appendChild(s);
    });
  }

  /** Reader view: the article as clean, comfortable text, with its own small toolbar (size, font, theme, width, listen, summary). Calling again restores the page. */
  function reader() {
    if (document.getElementById("hush-reader")) { location.reload(); return; }
    const body = document.body; if (!body) return;
    const txt = e => (e.innerText || "").replace(/\s+/g, " ").trim();
    const linkDensity = e => { const t = txt(e).length || 1; let l = 0; e.querySelectorAll("a").forEach(a => { l += txt(a).length; }); return l / t; };
    // Score every block by the paragraph text directly inside it (and a little of its parent): the article is where the paragraphs are.
    const score = new Map();
    document.querySelectorAll("p,pre,blockquote,li").forEach(p => { const t = txt(p); if (t.length < 40 || p.closest("nav,aside,footer,header,form,[aria-hidden=true]")) return;
      const s = 1 + Math.min(3, t.split(/[,.،。]/).length) + Math.min(3, Math.floor(t.length / 100));
      for (let el = p.parentElement, d = 0; el && el !== document.documentElement && d < 4; el = el.parentElement, d++) score.set(el, (score.get(el) || 0) + s / (d === 0 ? 1 : d * 2)); });
    let best = null, bestS = 0;
    score.forEach((s, el) => { s *= 1 - linkDensity(el); if (/article|post|content|story|entry|main|body/i.test((el.id || "") + " " + el.className)) s *= 1.25; if (el.tagName === "ARTICLE" || el.getAttribute("role") === "main" || el.tagName === "MAIN") s *= 1.4;
      if (s > bestS) { best = el; bestS = s; } });
    if (!best) best = document.querySelector("article,main") || body;
    const keep = "h1,h2,h3,h4,p,ul,ol,blockquote,pre,figure,img,table,hr";
    const nodes = [...best.querySelectorAll(keep)].filter(n => !n.parentElement.closest(keep) && !n.closest("nav,aside,footer,header,form,[role=navigation],[aria-hidden=true],[class*=share],[class*=related],[class*=newsletter],[class*=promo],[class*=comment],[class*=subscribe]") &&
      (n.tagName === "IMG" || n.tagName === "FIGURE" || n.tagName === "HR" || txt(n)) && !((n.tagName === "UL" || n.tagName === "OL") && linkDensity(n) > 0.6));
    if (nodes.reduce((n, x) => n + txt(x).length, 0) < 300) { alertish("No article found on this page"); return; }
    const lazy = i => { const s = i.getAttribute("src") || ""; const real = i.getAttribute("data-src") || i.getAttribute("data-original") || i.getAttribute("data-lazy-src"); if (real && (!s || /^data:|placeholder|blank|spacer/i.test(s))) i.setAttribute("src", real);
      const ss = i.getAttribute("srcset") || i.getAttribute("data-srcset"); if (ss) i.setAttribute("srcset", ss); };
    const clean = n => { const c = n.cloneNode(true); c.querySelectorAll("img").forEach(lazy); if (c.tagName === "IMG") lazy(c);
      c.querySelectorAll("picture source").forEach(s => { if (!s.getAttribute("srcset") && s.getAttribute("data-srcset")) s.setAttribute("srcset", s.getAttribute("data-srcset")); });
      c.querySelectorAll("*").forEach(e => { if (/^(SCRIPT|STYLE|IFRAME|BUTTON|INPUT|FORM|SVG|NOSCRIPT|VIDEO|AUDIO)$/i.test(e.tagName)) { e.remove(); return; }
        for (const at of [...e.attributes]) if (!["src", "href", "alt", "srcset", "colspan", "rowspan"].includes(at.name)) e.removeAttribute(at.name);
        if (e.tagName === "A") { e.setAttribute("target", "_self"); } });
      for (const at of [...c.attributes]) if (!["src", "href", "alt", "srcset"].includes(at.name)) c.removeAttribute(at.name);
      return c; };
    const meta = n => { const e = document.querySelector('meta[property="' + n + '"],meta[name="' + n + '"]'); return e ? (e.content || "").trim() : ""; };
    const title = txt(document.querySelector("h1")) || meta("og:title") || document.title;
    const by = meta("author") || meta("article:author") || txt(document.querySelector('[rel=author],[itemprop=author],.byline,.author')).slice(0, 80);
    const when = meta("article:published_time") || (document.querySelector("time[datetime]") || {}).dateTime || "";
    let date = ""; try { if (when) date = new Date(when).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }); } catch (e) {}
    const site = meta("og:site_name") || location.hostname.replace(/^www\./, "");
    const art = document.createElement("article"); art.id = "hush-reader";
    const h = document.createElement("h1"); h.textContent = title; art.append(h);
    const words = nodes.reduce((n, x) => n + (txt(x).split(" ").length), 0), mins = Math.max(1, Math.round(words / 220));
    const info = document.createElement("p"); info.className = "by"; info.textContent = [site, by && by !== site ? by : "", date, mins + " min read"].filter(Boolean).join(" · "); art.append(info);
    const lead = meta("og:image"); if (lead && !nodes.slice(0, 3).some(n => n.tagName === "IMG" || n.tagName === "FIGURE" || n.querySelector && n.querySelector("img"))) { const i = document.createElement("img"); i.src = lead; i.alt = ""; art.append(i); }
    nodes.forEach(n => { if (txt(n) !== title) art.append(clean(n)); });
    document.querySelectorAll('style,link[rel="stylesheet"]').forEach(s => s.remove());
    let P = { size: 20, font: "serif", theme: "auto", width: 680 }; try { Object.assign(P, JSON.parse(localStorage.getItem("hush.reader") || "{}")); } catch (e) {}
    const st = document.createElement("style"); st.id = "hush-reader-css";
    const paint = () => { const dark = P.theme === "dark" || P.theme === "black" || (P.theme === "auto" && matchMedia("(prefers-color-scheme:dark)").matches);
      const T = P.theme === "sepia" ? ["#f4ecd8", "#433422", "#8a7b62", "#7a5a2a"] : P.theme === "black" ? ["#000", "#d8d8d8", "#808080", "#8ab4f8"] : dark ? ["#16161a", "#e6e6e3", "#8d8d92", "#8ab4f8"] : ["#fbfbf9", "#1b1b1b", "#76767b", "#2a62c9"];
      const ff = P.font === "serif" ? 'Georgia,"Iowan Old Style","Palatino Linotype",serif' : P.font === "mono" ? 'ui-monospace,Consolas,monospace' : 'system-ui,-apple-system,"Segoe UI",sans-serif';
      st.textContent = ":root{color-scheme:" + (dark ? "dark" : "light") + "}html{background:" + T[0] + "!important}body{margin:0!important;background:" + T[0] + "!important;color:" + T[1] + "!important}" +
        "#hush-reader{max-width:" + P.width + "px;margin:0 auto;padding:56px 22px 140px;font:" + P.size + "px/1.7 " + ff + ";-webkit-text-size-adjust:none}" +
        "#hush-reader h1{font:700 1.75em/1.2 system-ui,-apple-system,sans-serif;letter-spacing:-.02em;margin:0 0 10px}#hush-reader .by{color:" + T[2] + ";font:500 14px system-ui,sans-serif;margin:0 0 30px}" +
        "#hush-reader img{max-width:100%;height:auto;border-radius:10px;display:block;margin:1.2em auto}#hush-reader figure{margin:1.2em 0}#hush-reader figcaption{color:" + T[2] + ";font:13px system-ui,sans-serif;text-align:center}" +
        "#hush-reader a{color:" + T[3] + ";text-decoration-thickness:1px;text-underline-offset:3px}#hush-reader pre{overflow:auto;font-size:.8em;background:" + (dark ? "#ffffff12" : "#00000009") + ";padding:14px;border-radius:10px}" +
        "#hush-reader blockquote{margin:1.2em 0;padding:.1em 1.1em;border-left:3px solid " + T[2] + ";color:" + T[2] + "}#hush-reader h2,#hush-reader h3,#hush-reader h4{font-family:system-ui,sans-serif;line-height:1.25;margin:1.7em 0 .5em}" +
        "#hush-reader p{margin:0 0 1.1em}#hush-reader table{border-collapse:collapse;display:block;overflow:auto;font:.85em system-ui,sans-serif}#hush-reader td,#hush-reader th{border:1px solid " + T[2] + "55;padding:6px 10px}" +
        "#hush-prog{position:fixed;left:0;top:0;height:3px;width:0;background:" + T[3] + ";z-index:2147483646;transition:width .1s}"; };
    paint(); document.head.append(st); body.replaceChildren(art);
    const prog = document.createElement("div"); prog.id = "hush-prog"; document.documentElement.append(prog);
    addEventListener("scroll", () => { const m = document.documentElement.scrollHeight - innerHeight; prog.style.width = (m > 0 ? Math.min(100, scrollY / m * 100) : 0) + "%"; }, { passive: true });
    // Toolbar (closed shadow root so the page's own scripts and styles can't touch it).
    const host = document.createElement("hush-reader-bar"); const sh = host.attachShadow({ mode: "closed" });
    sh.innerHTML = '<style>:host{all:initial}.b{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;display:flex;gap:2px;align-items:center;background:#111e;color:#fff;border-radius:99px;padding:5px;font:600 13px system-ui;backdrop-filter:blur(10px);box-shadow:0 6px 24px #0005;max-width:calc(100vw - 16px);overflow-x:auto;transition:opacity .3s,transform .3s}' +
      '.b.h{opacity:0;transform:translate(-50%,20px);pointer-events:none}button{all:unset;cursor:pointer;padding:8px 9px;border-radius:99px;white-space:nowrap}button:hover{background:#fff2}button.a{background:#fff;color:#111}i{width:1px;height:18px;background:#fff3;margin:0 3px;flex:none}</style>' +
      '<div class=b><button data-k=s- title="Smaller text">A−</button><button data-k=s+ title="Bigger text">A+</button><i></i><button data-k=f title="Font">Font</button><button data-k=t title="Theme">Theme</button><button data-k=w title="Page width">Width</button><i></i><button data-k=l title="Read aloud">Listen</button><button data-k=sum title="Summarize with your AI">Summary</button><i></i><button data-k=x title="Back to the page">✕</button></div>';
    const bar = sh.querySelector(".b"); document.documentElement.append(host);
    const save = () => { try { localStorage.setItem("hush.reader", JSON.stringify(P)); } catch (e) {} paint(); };
    const FONTS = ["serif", "sans", "mono"], THEMES = ["auto", "light", "sepia", "dark", "black"], WIDTHS = [560, 680, 820];
    bar.addEventListener("click", e => { const k = e.target.dataset && e.target.dataset.k; if (!k) return; e.stopPropagation();
      if (k === "s-") { P.size = Math.max(14, P.size - 2); save(); } else if (k === "s+") { P.size = Math.min(34, P.size + 2); save(); }
      else if (k === "f") { P.font = FONTS[(FONTS.indexOf(P.font) + 1) % 3]; save(); alertish("Font: " + P.font); }
      else if (k === "t") { P.theme = THEMES[(THEMES.indexOf(P.theme) + 1) % 5]; save(); alertish("Theme: " + P.theme); }
      else if (k === "w") { P.width = WIDTHS[(WIDTHS.indexOf(P.width) + 1) % 3]; save(); }
      else if (k === "l") { const on = !L.on; if (on) listen("start", 1); else listen("stop"); e.target.classList.toggle("a", on); }
      else if (k === "sum") { location.href = "hush-gesture://a-summarize"; }
      else if (k === "x") { listen("stop"); location.reload(); } });
    // The bar slips away while you read down the page and returns when you scroll up or tap.
    let last = 0; addEventListener("scroll", () => { const y = scrollY; bar.classList.toggle("h", y > last + 6 && y > 200); if (y < last - 6) bar.classList.remove("h"); last = y; }, { passive: true });
    addEventListener("click", e => { if (!e.target.closest("a")) bar.classList.toggle("h"); });
    scrollTo(0, 0);
  }
  function alertish(msg) { const d = document.createElement("div"); d.textContent = msg;
    d.style.cssText = "position:fixed;left:50%;top:16px;transform:translateX(-50%);background:#111;color:#fff;padding:8px 14px;border-radius:99px;font:13px system-ui;z-index:2147483647";
    document.documentElement.append(d); setTimeout(() => d.remove(), 2200); }

  /** Find in page (desktop): next/previous match; empty query clears. */
  function find(q, back) {
    if (!q) { getSelection().removeAllRanges(); return; }
    if (!window.find(q, false, !!back, true, false, false, false)) alertish("No matches for “" + q + "”");
  }
  /** The page's main text, as paragraphs (used by Listen and by Android's native voice). */
  function text() {
    const body = document.body; if (!body) return "";
    const own = document.getElementById("hush-reader");
    const root = own || [...document.querySelectorAll("article,main,[role=main],[itemprop=articleBody],.post,.entry-content,.article-body,.story")]
      .sort((a, b) => b.innerText.length - a.innerText.length)[0] || body;
    const parts = [...root.querySelectorAll("h1,h2,h3,p,li,blockquote")].filter(n => !n.closest("nav,aside,footer,header,form,[aria-hidden=true]"))
      .map(n => (n.innerText || "").replace(/\s+/g, " ").trim()).filter(t => t.length > 1);
    const title = (document.querySelector("h1") || {}).innerText || document.title;
    if (title && parts[0] !== title.trim()) parts.unshift(title.trim());
    return parts.join("\n\n").slice(0, 200000);
  }
  /** Read aloud with the computer's voices (desktop). Commands: start(rate) pause resume stop rate(x) next prev. */
  const L = { q: [], i: 0, rate: 1, on: false, token: 0 };
  function listen(cmd, arg) {
    const ss = window.speechSynthesis;
    if (!ss) { alertish("Read aloud isn’t available here"); return; }
    const speak = () => {
      const tok = ++L.token;
      if (!L.on || L.i >= L.q.length) { L.on = false; return; }
      const u = new SpeechSynthesisUtterance(L.q[L.i]); u.rate = L.rate;
      u.onend = () => { if (tok === L.token && L.on) { L.i++; speak(); } };
      ss.speak(u);
    };
    if (cmd === "start") { ss.cancel(); L.q = text().split(/\n{2,}/); L.i = 0; L.on = true; L.rate = +arg || 1; speak(); }
    else if (cmd === "pause") ss.pause();
    else if (cmd === "resume") ss.resume();
    else if (cmd === "stop") { L.on = false; L.token++; ss.cancel(); }
    else if (cmd === "rate") { L.rate = +arg || 1; if (L.on) { L.token++; ss.cancel(); speak(); } }
    else if (cmd === "next" || cmd === "prev") { if (!L.on) return; L.token++; ss.cancel(); L.i = Math.max(0, L.i + (cmd === "next" ? 1 : -1)); speak(); }
  }

  /** Login form on this page: where the user/password fields are, and what is typed in them (for "Save login"). Top frame only. */
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
  function loginFields() {
    const pw = [...document.querySelectorAll('input[type=password]')].filter(vis);
    if (!pw.length) return null;
    const p = pw[0], root = p.form || document;
    const users = [...root.querySelectorAll('input:not([type]),input[type=text],input[type=email],input[type=tel],input[autocomplete*=user]')].filter(vis);
    let u = null; for (const x of users) { if (x.compareDocumentPosition(p) & 4) u = x; }   // the last text field before the password
    return { p, u: u || users[0] || null };
  }
  function forms() { const f = loginFields();
    return JSON.stringify({ host: location.hostname, url: location.origin, has: !!f, user: f && f.u ? f.u.value : "", pass: f ? f.p.value : "", top: window.top === window }); }
  /** Fill the login form (user + password). Uses the native setter so React/Vue forms notice the change. */
  function fill(o) { const f = loginFields(); if (!f || !o) return;
    const set = (el, v) => { if (!el || typeof v !== "string") return; const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value"); d.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    set(f.u, o.u); set(f.p, o.p); }
  return { dark, reader, find, text, listen, forms, fill };
})();
