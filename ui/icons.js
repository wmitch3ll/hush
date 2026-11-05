// Hush icons: one modern line-icon set for every screen (desktop, Android, Murmur, Echo, assistant).
// Buttons and links in the UI were written with text symbols (✕ ▶ ⋯ ★ → …), which every system draws
// differently and which look dated. This swaps those symbols, wherever they stand alone on a control,
// for crisp SVG icons that follow the text color and size. New screens are covered automatically.
(() => {
  const P = {   // 24×24, 2px round strokes (filled where noted)
    x: "M6 6l12 12M18 6L6 18",
    check: "M5 12.5l4.5 4.5L19 7.5",
    left: "M15 5l-7 7 7 7", right: "M9 5l7 7-7 7",
    arrowR: "M5 12h14M13 6l6 6-6 6", arrowL: "M19 12H5M11 6l-6 6 6 6",
    up: "M12 19V5M6 11l6-6 6 6", down: "M12 5v14M6 13l6 6 6-6",
    ext: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
    redo: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
    more: "", star: "M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9z",
    music: "M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
    lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
    shield: "M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z",
    edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
    del: "M21 5H9l-6 7 6 7h12zM17 9l-6 6M11 9l6 6",
    menu: "M4 7h16M4 12h16M4 17h16",
    gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.4z",
  };
  const FILL = { play: "M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z",
    pause: "M7 5h3.2v14H7zM13.8 5H17v14h-3.2z", starOn: P.star, dot: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" };
  const MAP = { "✕": "x", "×": "x", "✓": "check", "✔": "check", "‹": "left", "›": "right", "→": "arrowR", "←": "arrowL",
    "↑": "up", "↓": "down", "↗": "ext", "↻": "redo", "⟳": "redo", "⋯": "more", "⋮": "more", "☆": "star", "★": "starOn",
    "♪": "music", "▶": "play", "⏸": "pause", "❚❚": "pause", "🔒": "lock", "🛡": "shield", "🛡️": "shield", "✎": "edit", "⌫": "del",
    "☰": "menu", "⚙": "gear", "⚙️": "gear", "●": "dot" };
  const NS = "http://www.w3.org/2000/svg";
  const svg = name => { const s = document.createElementNS(NS, "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true");
    s.setAttribute("class", "hi hi-" + name);
    if (name === "more") { for (const x of [5, 12, 19]) { const c = document.createElementNS(NS, "circle"); c.setAttribute("cx", x); c.setAttribute("cy", 12); c.setAttribute("r", 1.8); c.setAttribute("fill", "currentColor"); s.append(c); } return s; }
    const p = document.createElementNS(NS, "path");
    if (FILL[name]) { p.setAttribute("d", FILL[name]); p.setAttribute("fill", "currentColor"); if (name === "starOn") { p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "1.5"); p.setAttribute("stroke-linejoin", "round"); } }
    else { p.setAttribute("d", P[name]); p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round"); }
    s.append(p); return s; };
  const keys = Object.keys(MAP).sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // A symbol counts only when it stands alone (start/end of the label, set off by spaces) — never inside words or numbers like 2×3.
  const RE = new RegExp("(^|\\s)(" + keys.join("|") + ")\\uFE0F?(?=\\s|$)", "g");
  const CTL = "button,a,[role=button],[role=tab],[role=menuitem],label,summary,.x,.ib,.tb,.tag,.chip,.btn,.item b,.item span";
  const skip = el => !el || el.closest("input,textarea,[contenteditable],code,pre,kbd,script,style,svg,.no-icons,.hm-text,.ec-text,.msg-body");
  const fix = t => { const el = t.parentElement; if (skip(el) || !el.closest(CTL)) return;
    const s = t.nodeValue; if (!s || s.length > 60) return; RE.lastIndex = 0; if (!RE.test(s)) return; RE.lastIndex = 0;
    const frag = document.createDocumentFragment(); let at = 0, m;
    while ((m = RE.exec(s))) { const i = m.index + m[1].length; if (i > at) frag.append(s.slice(at, i)); frag.append(svg(MAP[m[2]])); at = i + m[0].length - m[1].length; }
    if (at < s.length) frag.append(s.slice(at)); t.replaceWith(frag); };
  const walk = root => { if (root.nodeType === 3) return fix(root); if (root.nodeType !== 1 && root.nodeType !== 11) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const list = []; while (w.nextNode()) list.push(w.currentNode); list.forEach(fix); };
  let pend = new Set(), raf = 0;
  const flush = () => { raf = 0; const p = pend; pend = new Set(); p.forEach(n => n.isConnected && walk(n)); };
  const queue = n => { pend.add(n); if (!raf) raf = requestAnimationFrame(flush); };
  const st = document.createElement("style");
  st.textContent = ".hi{width:1.15em;height:1.15em;vertical-align:-.2em;flex:none;display:inline-block;overflow:visible}" +
    ".hi-more{width:1.25em}button .hi:only-child,.x .hi,.ib .hi{vertical-align:middle}";
  const start = () => { document.head.append(st); walk(document.body);
    new MutationObserver(ms => { for (const m of ms) { if (m.type === "characterData") queue(m.target); else m.addedNodes.forEach(queue); } })
      .observe(document.body, { childList: true, subtree: true, characterData: true }); };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start();
  window.__hushIcon = svg;
})();
