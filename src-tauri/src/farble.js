// Fingerprint protection ("farbling", the approach Brave uses): every site sees slightly different, but stable,
// values for the device details trackers combine into a fingerprint. Different site -> different fingerprint, so you
// can't be followed from site to site; same site -> same values, so pages behave normally.
// Injected at document start. Rust prepends:  const __HUSH_FP = { secret: "<per-install random>", off: ["host", ...] };
(() => {
  if (window.__hushFarbled) return; window.__hushFarbled = true;
  const cfg = (typeof __HUSH_FP === "object" && __HUSH_FP) || { secret: "hush", off: [] };
  const host = location.hostname || "";
  if (!host || cfg.off.some(h => host === h || host.endsWith("." + h))) return;
  // Site key = last two labels (good enough for eTLD+1 on most sites; keeps subdomains of one site consistent).
  const parts = host.split("."), site = parts.length > 2 && !/^\d+$/.test(parts.at(-1)) ? parts.slice(-2).join(".") : host;
  let h = 2166136261; for (const c of cfg.secret + "|" + site) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  const rand = (seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; })(h);
  const pick = a => a[Math.floor(rand() * a.length)];
  const def = (obj, prop, get) => { try { Object.defineProperty(obj, prop, { get, configurable: true }); } catch (e) {} };
  // Make patched functions look native to scripts that check Function.prototype.toString.
  const natives = new WeakMap(), fnToString = Function.prototype.toString;
  const patch = (proto, name, make) => { const orig = proto[name]; if (typeof orig !== "function") return;
    const f = make(orig); natives.set(f, fnToString.call(orig)); try { Object.defineProperty(proto, name, { value: f, writable: true, configurable: true }); } catch (e) {} };
  patch(Function.prototype, "toString", orig => function () { return natives.has(this) ? natives.get(this) : orig.call(this); });

  // --- Hardware details
  const cores = pick([2, 4, 4, 8, 8]);
  def(Navigator.prototype, "hardwareConcurrency", () => cores);
  def(Navigator.prototype, "deviceMemory", () => 8);
  def(Navigator.prototype, "plugins", () => []);
  def(Navigator.prototype, "mimeTypes", () => []);

  // --- Canvas: a few pixels nudged by one color step, the same way every time on this site.
  const noise = []; for (let i = 0; i < 12; i++) noise.push([rand(), rand(), Math.floor(rand() * 3), rand() < 0.5 ? -1 : 1]);
  const fudge = (data, w, hgt) => { if (!data || !w || !hgt) return; for (const [x, y, ch, d] of noise) {
    const i = (Math.floor(y * hgt) * w + Math.floor(x * w)) * 4 + ch; if (i >= 0 && i < data.length) data[i] = Math.max(0, Math.min(255, data[i] + d)); } };
  const C2D = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (C2D) patch(C2D, "getImageData", orig => function (...a) { const img = orig.apply(this, a); fudge(img.data, img.width, img.height); return img; });
  const farbledCopy = canvas => { try { const w = canvas.width, hgt = canvas.height; if (!w || !hgt || w * hgt > 4e6) return null;
    const c = document.createElement("canvas"); c.width = w; c.height = hgt; const x = c.getContext("2d"); x.drawImage(canvas, 0, 0);
    const img = C2D.getImageData.call(x, 0, 0, w, hgt); x.putImageData(img, 0, 0); return c; } catch (e) { return null; } };
  const HC = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
  if (HC) {
    patch(HC, "toDataURL", orig => function (...a) { const c = farbledCopy(this); return orig.apply(c || this, a); });
    patch(HC, "toBlob", orig => function (...a) { const c = farbledCopy(this); return orig.apply(c || this, a); });
  }

  // --- WebGL: hide the exact graphics card; nudge pixel readback.
  for (const G of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!G) continue;
    patch(G.prototype, "getParameter", orig => function (p) {
      if (p === 0x9245) return "Google Inc.";                                   // UNMASKED_VENDOR_WEBGL
      if (p === 0x9246) return "ANGLE (Hush, Generic GPU, OpenGL)";               // UNMASKED_RENDERER_WEBGL
      return orig.call(this, p); });
    patch(G.prototype, "readPixels", orig => function (...a) { orig.apply(this, a); const px = a[6]; if (px && px.length) fudge(px, a[2], a[3]); });
  }

  // --- Audio: tiny, inaudible differences in rendered audio data.
  const AB = window.AudioBuffer && AudioBuffer.prototype, seen = new WeakSet(), amp = 1e-7 * (1 + rand());
  if (AB) patch(AB, "getChannelData", orig => function (...a) { const d = orig.apply(this, a);
    if (!seen.has(d)) { seen.add(d); for (let i = 0; i < d.length; i += 97) d[i] += (rand() - 0.5) * amp; } return d; });
  const AN = window.AnalyserNode && AnalyserNode.prototype;
  if (AN) patch(AN, "getFloatFrequencyData", orig => function (arr) { orig.call(this, arr); for (let i = 0; i < arr.length; i += 31) arr[i] += (rand() - 0.5) * 0.1; });

  // --- Fonts: measuring text is the usual way to list installed fonts; add sub-pixel jitter to widths.
  const TM = window.TextMetrics && TextMetrics.prototype, jitter = (rand() - 0.5) * 0.02;
  if (TM) { const d = Object.getOwnPropertyDescriptor(TM, "width"); if (d && d.get) def(TM, "width", function () { return d.get.call(this) + jitter; }); }
})();
