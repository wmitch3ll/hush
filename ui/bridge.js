// Connects the mobile.html demo logic to the real Rust commands. In a plain browser (no Tauri) it does nothing,
// so mobile.html stays a working demo. Loaded AFTER the main script; overrides its globals by name.
(() => {
  const TA = window.__TAURI__; if (!TA || !TA.core) return;
  const I = (c, a) => TA.core.invoke(c, a || {});
  const NONE = "none", ANDROID = /Android/i.test(navigator.userAgent);
  const nat = t => !!(t && t.native) && t.url !== "hush://new";

  // Native tab views must start below the chrome bar (Android: device px, iOS: points).
  const inset = () => { const b = document.querySelector("#top").getBoundingClientRect().bottom;
    I("set_chrome_inset", { px: Math.round(ANDROID ? b * devicePixelRatio : b) }).catch(() => {}); };
  addEventListener("resize", inset); setTimeout(inset, 60);

  const _load = load;
  load = function () {
    const t = T(), live = nat(t);
    document.querySelector("#view").style.display = live ? "none" : "";
    if (!live) return _load();
    progress(); $("#url").value = hostOf(t.url);
    $("#shield").classList.toggle("off", shieldOff.has(hostOf(t.url)));
    $("#cnt").style.display = "none"; $("#tabs-btn").textContent = tabs.length;
  };
  const _select = select;
  select = function (id) { _select(id); const t = T(); I("switch_tab", { label: nat(t) ? t.native : NONE }); };
  const _show = show;  // sheets live in the chrome page, so hide the native view while one is open
  show = function (id) { _show(id); const t = T(); I("switch_tab", { label: id || !nat(t) ? NONE : t.native }); };
  const _close = closeTab;
  closeTab = function (id) { const t = tabs.find(x => x.id === id); if (t && t.native) I("close_tab", { label: t.native }); _close(id); };

  go = async function (v) {
    const t = T(), u = resolve(v);
    if (u === "hush://new") { t.url = u; load(); I("switch_tab", { label: NONE }); return; }
    try { if (t.native) await I("navigate", { input: u }); else t.native = await I("open_tab", { input: u }); }
    catch (e) { return toast("Couldn’t open that page"); }
    t.url = u; t.hist.push(u); t.idx = t.hist.length - 1; t.blocked = 0; load();
  };
  step = function (d) { const t = T(); if (!nat(t)) return toast("Nothing there"); I("nav", { action: d < 0 ? "back" : "fwd" }); };
  $("#reload").onclick = () => { const t = T(); if (nat(t)) I("nav", { action: "reload" }); else load(); };
  $("#shield").addEventListener("click", () => {
    const t = T(), h = hostOf(t.url); if (!h) return;
    I("toggle_shield", { host: h }).then(() => { if (nat(t)) I("nav", { action: "reload" }); });
  });
  $("#m-clear").onclick = () => { if (confirm("Clear cookies, cache, history and site data?")) { I("clear_data"); show(null); toast("Cleared"); } };

  // Menu extras: bookmark + user-triggered filter-list update.
  const menu = $("#menu"), close = $("#m-close");
  const add = (label, sub, fn) => { const b = document.createElement("button");
    b.innerHTML = label + ' <span class="mute">' + sub + "</span>"; b.onclick = fn; menu.insertBefore(b, close); };
  add("Bookmark this page", "saved on this device", async () => {
    const t = T(); if (!nat(t)) return toast("Open a page first");
    try { await I("bookmark_add", { title: hostOf(t.url), url: t.url }); show(null); toast("Bookmarked"); } catch (e) { toast("Couldn’t save"); } });
  add("Update filter lists", "downloads EasyList", async () => {
    toast("Updating…"); try { toast(await I("update_lists")); } catch (e) { toast("Update failed"); } });

  // ---- Settings sheet (search engine, counter, custom filters, exceptions, export/import)
  const ENGINES = ["duckduckgo", "brave", "startpage", "ecosia"];
  let S = { settings: { search: "duckduckgo", counter: false }, custom_filters: 0, allow_sites: [] };
  const sheet = document.createElement("div"); sheet.className = "sheet menu"; sheet.id = "settings"; sheet.style.zIndex = 12;
  $("#app").appendChild(sheet);
  const ask = (title, cb) => { const m = document.createElement("div"); m.className = "fake-modal";
    m.innerHTML = '<div style="width:86%;text-align:left"><b></b><textarea style="width:100%;height:110px;margin:10px 0;font:13px monospace"></textarea><div class="row"><button class="btn" data-x>Cancel</button><button class="btn acc" data-ok>OK</button></div></div>';
    m.querySelector("b").textContent = title; m.querySelector("[data-x]").onclick = () => m.remove();
    m.querySelector("[data-ok]").onclick = () => { const v = m.querySelector("textarea").value.trim(); m.remove(); if (v) cb(v); };
    document.body.append(m); };
  const row = (label, sub, fn) => { const b = document.createElement("button");
    b.innerHTML = label + ' <span class="mute">' + sub + "</span>"; b.onclick = async () => { await fn(); refresh(); }; sheet.appendChild(b); };
  function draw() {
    sheet.innerHTML = ""; const back = document.createElement("button"); back.className = "btn"; back.textContent = "‹ Settings";
    back.onclick = () => sheet.classList.remove("on"); sheet.appendChild(back);
    row("Search engine", S.settings.search, () => I("set_setting", { key: "search", value: ENGINES[(ENGINES.indexOf(S.settings.search) + 1) % ENGINES.length] }));
    row("Blocked counter", S.settings.counter ? "on" : "off", () => I("set_setting", { key: "counter", value: String(!S.settings.counter) }));
    row("Custom filters", S.custom_filters + " saved", () => new Promise(r => { ask("Filter line, e.g. example.com##.ad", f => I("add_custom_filter", { filter: f }).then(() => toast("Filter added")).catch(() => toast("Invalid filter")).finally(r)); }));
    row("Shield exceptions", (S.allow_sites || []).length + " sites", async () => {
      if ((S.allow_sites || []).length && confirm("Turn the shield back on for all sites?")) { for (const h of S.allow_sites) await I("toggle_shield", { host: h }); shieldOff = new Set(); toast("Shield on everywhere"); } });
    row("Export data", "copy JSON", async () => { try { await navigator.clipboard.writeText(await I("export_data")); toast("Copied to clipboard"); } catch (e) { toast("Couldn’t copy"); } });
    row("Import data", "paste JSON", () => new Promise(r => { ask("Paste a Hush export", j => I("import_data", { json: j }).then(() => toast("Imported")).catch(() => toast("Not a Hush export")).finally(r)); }));
  }
  async function refresh() { try { S = await I("get_state"); } catch (e) {} draw(); }
  add("Settings", "search · filters · backup", () => { refresh(); sheet.classList.add("on"); });

  // Restore persisted state: allow list + bookmarks on the start page.
  I("get_state").then(s => {
    shieldOff = new Set(s.allow_sites || []);
    if (s.bookmarks && s.bookmarks.length) {
      BM.length = 0;
      s.bookmarks.forEach(b => BM.push([(b.title || "?")[0].toUpperCase(), b.title, b.url.replace(/^https?:\/\//, "")]));
    }
    const t = T(); if (t && t.url === "hush://new") load();
  }).catch(() => {});
})();
