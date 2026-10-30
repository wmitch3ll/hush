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

  /** Reader view: keep the article's text and images, drop everything else. Calling again restores the page. */
  function reader() {
    if (document.getElementById("hush-reader")) { location.reload(); return; }
    const textOf = el => [...el.querySelectorAll("p")].reduce((n, p) => n + (p.innerText || "").trim().length, 0);
    const body = document.body; if (!body) return;
    const total = textOf(body) || 1;
    let best = body;
    for (const c of document.querySelectorAll("article,main,[role=main],[itemprop=articleBody],.post,.entry-content,.article-body,.story,#content,.content")) {
      if (textOf(c) >= total * 0.6 && c.contains(best) === false && best.contains(c)) best = c;
    }
    const keep = "h1,h2,h3,h4,p,ul,ol,blockquote,pre,figure,img,table";
    const nodes = [...best.querySelectorAll(keep)].filter(n => !n.parentElement.closest(keep) &&
      !n.closest("nav,aside,footer,header,form,[role=navigation],[aria-hidden=true]") && (n.innerText || n.tagName === "IMG" || n.tagName === "FIGURE"));
    if (nodes.reduce((n, x) => n + (x.innerText || "").length, 0) < 300) { alertish("No article found on this page"); return; }
    const clean = n => { const c = n.cloneNode(true);
      c.querySelectorAll("*").forEach(e => { for (const at of [...e.attributes]) if (!["src", "href", "alt", "srcset"].includes(at.name)) e.removeAttribute(at.name);
        if (/^(SCRIPT|STYLE|IFRAME|BUTTON|INPUT|FORM|SVG)$/i.test(e.tagName)) e.remove(); });
      for (const at of [...c.attributes]) if (!["src", "href", "alt", "srcset"].includes(at.name)) c.removeAttribute(at.name);
      return c; };
    const title = (document.querySelector("h1") || {}).innerText || document.title;
    const art = document.createElement("article"); art.id = "hush-reader";
    const h = document.createElement("h1"); h.textContent = title; art.append(h);
    const by = document.createElement("p"); by.className = "by"; by.textContent = location.hostname.replace(/^www\./, ""); art.append(by);
    nodes.forEach(n => { if ((n.innerText || "").trim() !== title.trim()) art.append(clean(n)); });
    document.querySelectorAll('style,link[rel="stylesheet"]').forEach(s => s.remove());
    const st = document.createElement("style");
    st.textContent = ':root{color-scheme:light dark}body{margin:0;background:Canvas;color:CanvasText}' +
      '#hush-reader{max-width:680px;margin:0 auto;padding:28px 20px 80px;font:19px/1.65 Georgia,"Iowan Old Style",serif}' +
      '#hush-reader h1{font:600 30px/1.2 system-ui,sans-serif;letter-spacing:-.02em;margin:0 0 6px}#hush-reader .by{color:GrayText;font:14px system-ui;margin:0 0 28px}' +
      '#hush-reader img{max-width:100%;height:auto;border-radius:8px}#hush-reader a{color:inherit}#hush-reader pre{overflow:auto;font-size:14px}' +
      '#hush-reader h2,#hush-reader h3{font-family:system-ui,sans-serif;line-height:1.25;margin-top:1.6em}';
    document.head.append(st); body.replaceChildren(art); scrollTo(0, 0);
  }
  function alertish(msg) { const d = document.createElement("div"); d.textContent = msg;
    d.style.cssText = "position:fixed;left:50%;top:16px;transform:translateX(-50%);background:#111;color:#fff;padding:8px 14px;border-radius:99px;font:13px system-ui;z-index:2147483647";
    document.documentElement.append(d); setTimeout(() => d.remove(), 2200); }

  /** Find in page (desktop): next/previous match; empty query clears. */
  function find(q, back) {
    if (!q) { getSelection().removeAllRanges(); return; }
    if (!window.find(q, false, !!back, true, false, false, false)) alertish("No matches for “" + q + "”");
  }
  return { dark, reader, find };
})();
