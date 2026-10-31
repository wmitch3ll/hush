// Tor tabs (__HUSH_UNIFORM = 'tor'), run at document start: on top of farble.js, everyone looks the same — UTC time zone, en-US, a common screen size
// rounded to 200×100 steps (letterboxing), 4 cores / 8 GB, only standard fonts (as Tor/Mullvad Browser do).
(() => {
  if (window.__hushUniform) return; window.__hushUniform = 1;
  const TOR = typeof __HUSH_UNIFORM !== 'undefined' && __HUSH_UNIFORM === 'tor';
  const def = (o, k, v) => { try { Object.defineProperty(o, k, { get: typeof v === 'function' ? v : () => v, configurable: true }); } catch (e) {} };
  // A per-site, per-session seed: noise is stable within a site (so pages don't break) but differs between sites.
  let seed = 0; try { const s = (sessionStorage.getItem('__hs') || (Math.random() * 1e9 | 0) + ''); sessionStorage.setItem('__hs', s); seed = +s; } catch (e) { seed = Math.random() * 1e9 | 0; }
  for (const c of location.hostname) seed = (seed * 31 + c.charCodeAt(0)) | 0;
  const rnd = i => { let x = (seed ^ (i * 2654435761)) | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };

  if (!TOR) return;   // every tab already gets farble.js (GPU, canvas, audio, hardware randomized per site)
  if (navigator.gpu) def(Navigator.prototype, 'gpu', undefined);   // WebGPU adapter details identify the graphics card

  // ---- Tor tabs: look like everyone else
  // Time zone: UTC everywhere.
  const DTF = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function (l, o) { return new DTF(l || 'en-US', { timeZone: 'UTC', ...(o || {}) }); };
  Intl.DateTimeFormat.prototype = DTF.prototype; Intl.DateTimeFormat.supportedLocalesOf = DTF.supportedLocalesOf;
  Date.prototype.getTimezoneOffset = function () { return 0; };
  const fmt = (d, o) => new DTF('en-US', { timeZone: 'UTC', ...o }).format(d);
  Date.prototype.toString = function () { return isNaN(this) ? 'Invalid Date' : fmt(this, { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' }).replace(/,/g, '') + ' ' + this.toISOString().slice(11, 19) + ' GMT+0000 (Coordinated Universal Time)'; };
  Date.prototype.toTimeString = function () { return isNaN(this) ? 'Invalid Date' : this.toISOString().slice(11, 19) + ' GMT+0000 (Coordinated Universal Time)'; };
  for (const [k, o] of [['toLocaleString', {}], ['toLocaleDateString', { year: 'numeric', month: 'numeric', day: 'numeric' }], ['toLocaleTimeString', { hour: 'numeric', minute: '2-digit', second: '2-digit' }]]) {
    Date.prototype[k] = function (l, opt) { return new DTF(l || 'en-US', { timeZone: 'UTC', ...o, ...(opt || {}) }).format(this); }; }
  for (const k of ['getHours', 'getMinutes', 'getDate', 'getDay', 'getMonth', 'getFullYear']) { const u = Date.prototype['getUTC' + k.slice(3)]; Date.prototype[k] = function () { return u.call(this); }; }
  // Language, hardware, platform.
  def(Navigator.prototype, 'language', 'en-US'); def(Navigator.prototype, 'languages', Object.freeze(['en-US', 'en']));
  const AND = /Android/.test(navigator.userAgent);
  def(Navigator.prototype, 'hardwareConcurrency', 4); def(Navigator.prototype, 'deviceMemory', 8); def(Navigator.prototype, 'maxTouchPoints', AND ? 5 : 0);
  def(Navigator.prototype, 'platform', AND ? 'Linux armv81' : 'Win32'); def(Navigator.prototype, 'getBattery', undefined); def(Navigator.prototype, 'connection', undefined);
  // Screen: letterboxed to 200×100 steps, no taskbar/DPR detail.
  const bw = () => Math.max(200, Math.floor(innerWidth / 200) * 200), bh = () => Math.max(100, Math.floor(innerHeight / 100) * 100);
  for (const k of ['width', 'availWidth']) def(Screen.prototype, k, bw); for (const k of ['height', 'availHeight']) def(Screen.prototype, k, bh);
  def(Screen.prototype, 'colorDepth', 24); def(Screen.prototype, 'pixelDepth', 24); def(Screen.prototype, 'availLeft', 0); def(Screen.prototype, 'availTop', 0);
  def(window, 'outerWidth', bw); def(window, 'outerHeight', bh); def(window, 'screenX', 0); def(window, 'screenY', 0); def(window, 'devicePixelRatio', 1);
  // Fonts: only the standard families answer "installed".
  const STD = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|arial|helvetica|times new roman|times|courier new|courier|georgia|verdana)$/i;
  if (document.fonts && document.fonts.check) { const ck = document.fonts.check.bind(document.fonts);
    document.fonts.check = (f, t) => { const fam = String(f).split(/\s(?=["']?[A-Za-z])/).pop().split(',')[0].replace(/["']/g, '').trim(); return STD.test(fam) ? ck(f, t) : false; }; }
  // Sensors / device APIs that identify hardware.
  for (const k of ['getGamepads']) def(Navigator.prototype, k, undefined);
  try { if (window.AudioBuffer) { const gc = AudioBuffer.prototype.getChannelData; AudioBuffer.prototype.getChannelData = function (c) { const d = gc.call(this, c); for (let i = 0; i < d.length; i += 101) d[i] += (rnd(i) - 0.5) * 1e-7; return d; }; } } catch (e) {}
  // Timer precision: 1 ms steps (blocks fine-grained timing fingerprints).
  const pn = performance.now.bind(performance); performance.now = () => Math.floor(pn());
})();
