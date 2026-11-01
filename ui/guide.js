// Hush Guide — an in-depth, chaptered walkthrough of every feature: what it's for (real use cases), exactly how
// to use it on this device, and a "Try it" button that opens the feature itself. Progress is remembered.
// HUSH_GUIDE.open(el, { mobile, act: name => void, done: () => void })
window.HUSH_GUIDE = (() => {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  // Each lesson: [id, title, use cases, steps (phone), steps (desktop), try-it action, tip]
  const L = (id, t, uses, m, d, act, tip) => ({ id, t, uses, m, d, act, tip });
  const CH = [
    { e: '👋', t: 'Getting started', s: 'Tabs, search and getting around fast', l: [
      L('bar', 'The address bar & search', ['Search or type a site in one place', 'Jump straight into a site’s own search with a shortcut'],
        ['Tap the bar at the top and type a site (espn.com) or anything you want to search.', 'Start with a shortcut to search one site directly: !yt cats searches YouTube, !w Wikipedia, !a Amazon, !r Reddit, !m maps.', 'Make your own shortcuts in Settings › Search shortcuts (for example  hf=https://hyperfeast.com/?s=%s).', 'Swipe the bar left or right to switch to the next or previous tab.'],
        ['Click the bar (or press Ctrl+L) and type a site or a search.', 'Start with a shortcut to search one site directly: !yt, !w, !a, !r, !m, !gh.', 'Add your own in Settings › Search shortcuts.', 'Only the site name shows in the bar to keep it clean; turn on the full address in Settings if you prefer.'], 'cmd'),
      L('tabs', 'Tabs, workspaces & Spaces', ['Keep work, sports and shopping apart', 'Stay signed in to two accounts of the same site at once'],
        ['Tap the tabs button on the bottom row to see every tab as a card; swipe a card away to close it.', 'Hold a tab card for more: mute, keep playing, split screen, self-destruct, move to a workspace.', 'Workspaces are groups of tabs (the chips above the cards). Tap + to make one, tap a chip to switch.', 'Hold a workspace chip › Give this workspace its own sign-ins: it becomes a Space with separate cookies — handy for a second Google or social account.'],
        ['Tabs live in the side bar; drag to reorder, middle-click to close.', 'Workspaces group tabs — switch from the top of the side bar or the command bar (Ctrl+K › workspace).', 'Turn a workspace into a Space with its own sign-ins (separate cookies) to use two accounts side by side.', '★ Pin your everyday sites as Essentials; they stay put in every workspace.'], 'tabs',
        'Tabs you haven’t used in a while go to sleep to save memory and battery; they wake instantly when you tap them.'),
      L('cmd', 'The command bar', ['Find any tab, bookmark, chat or setting without hunting through menus'],
        ['Hold the address bar to open commands, then type what you want: “split”, “dark”, “tor”, a chat name, a setting.', 'Chats from Murmur show up here too — type a friend’s name to jump into the chat.'],
        ['Press Ctrl+K anywhere and type: a tab, a bookmark, a command (“split”, “reader”, “scene”) or a friend’s name.', 'Arrow keys and Enter pick; Esc closes.'], 'cmd'),
      L('gest', 'Gestures & the quick wheel', ['Do common things one-handed, without menus'],
        ['Swipe the address bar down for all tabs, left/right to switch tabs.', 'Two-finger swipes on a page and the quick wheel can be set up in Settings › Gestures.', 'Pull a page down to refresh (can be turned off).'],
        ['Hold the right mouse button and draw: ← back, → forward, ↓ then → close tab, and more.', 'Right-click and hold for your quick wheel of favourite actions.', 'Change any of them in Settings › Gestures.'], 'gest'),
      L('toolbar', 'The bottom row (phone)', ['Back, forward, new tab, tabs and menu always under your thumb'],
        ['The bottom row stays on screen. If you want more room while reading, turn on Settings › Hide toolbar while scrolling — it slides away as you scroll down and comes back when you scroll up.', 'You can move the address bar to the bottom too (Settings › Address bar).'],
        ['On desktop everything is in the side bar and the command bar (Ctrl+K).'], 'settings'),
    ] },
    { e: '🛡', t: 'Privacy & security', s: 'What’s protecting you and how to tune it', l: [
      L('shield', 'Blocking & per-site settings', ['Pages load faster without ads and trackers', 'Fix a site that breaks by relaxing protection just there'],
        ['Ads, trackers, cookie banners and popups are blocked everywhere automatically.', 'Tap the shield in the address bar for this site: see what was blocked, turn blocking off for the site, allow or block JavaScript, always open it in Tor, and check its connection.', 'A site acting strange? Turn its shield off, reload, and turn it back on later.'],
        ['Blocking is on for every site. Click the shield in the bar for this site’s settings: blocking, JavaScript, always-Tor, a note, and connection info.'], 'site'),
      L('levels', 'Security levels', ['Lock things down on sketchy sites', 'Maximum protection while on public Wi-Fi'],
        ['Settings › Security level: Standard for everyday, Safer turns off risky page features (like WebAssembly) on every site, Safest also turns JavaScript off except on sites you allow.', 'With Safest on, allow a site you trust from its shield › JavaScript.'],
        ['Settings › Security level: Standard, Safer or Safest — the same as on the phone. Allow JavaScript per site from the shield.'], 'settings',
        'Fingerprint protection is always on: sites see slightly randomized graphics and hardware details, so they can’t recognize your device across the web.'),
      L('tor', 'Tor mode', ['Hide your IP address and location', 'Open a site that’s blocked on your network', 'Visit .onion sites'],
        ['Tap the onion (🧅) to turn Tor on — the bar changes colour while you’re on Tor.', 'Pages are a little slower because they bounce through three relays around the world.', 'Want one site to always use Tor? Open its shield › Always open in Tor.', 'In Tor every Hush user looks the same to websites (same time zone, screen size and fonts), so you blend in.'],
        ['Click the onion or open a Tor tab from the command bar. Tor tabs are private and never touch your normal sign-ins.', 'Set a site to always open in Tor from its shield.'], 'tor'),
      L('private', 'Private tabs & self-destruct', ['Look something up without it in your history', 'A tab that cleans itself up'],
        ['Menu › New private tab: nothing is saved, and its cookies are gone when you close it.', 'Hold a tab › Self-destruct: pick a time and the tab closes and wipes itself.'],
        ['Ctrl+Shift+N opens a private tab. Self-destruct a tab from its right-click menu or the command bar.'], 'tabs'),
      L('panic', 'Panic button', ['Someone walks up and you need everything hidden right now'],
        ['Hold the address bar (Commands) › Panic: close private tabs, lock Murmur. Every private and Tor tab closes at once and your messages lock behind your PIN.'],
        ['Press Ctrl+Shift+X: every private and Tor tab closes, Murmur and Echo lock, and Tor gets a new identity.'], null,
        'The weekly privacy report (in the menu) shows how much was blocked, how many pages went over Tor, popups stopped and photos cleaned.'),
      L('popups', 'Popup & fake-button protection', ['Streaming and sports sites that throw ads every time you tap play'],
        ['Hush removes the invisible ad layers sites put over the player, so your tap reaches the real button.', 'Popups and surprise redirects to ad sites are blocked; a small message tells you when one was stopped.', 'Links stay in the same tab, so nothing sneaks open in the background.'],
        ['Same protection on desktop: invisible layers over the player are removed and popup ads are blocked.'], null),
    ] },
    { e: '🎬', t: 'Watching video & split screen', s: 'Two games at once, background play and more', l: [
      L('split', 'Split screen (up to 4)', ['Watch two games at once', 'A video next to a live blog or stats page', 'Compare two shops side by side'],
        ['Open the tabs you want. In the tab list, hold a second tab › Add to split screen. Add up to 4.', 'Every pane is a full site. A video fills its pane with full controls — play, seek, volume and fullscreen.', 'Tap a pane to give it the sound: it gets a blue ring, and the others keep playing muted.', 'Two tabs: drag the line between them to resize. Turn the phone sideways for side-by-side.', '⋯ › Split screen… to change layout, save a scene, or close the split.'],
        ['Shift-click a tab in the side bar to split with it; shift-click more tabs to add (up to 4).', 'Click a pane to give it the sound (blue ring); the others keep playing muted.', 'Videos fill their pane with full controls. Ctrl+K › Split layout to switch between Grid and Spotlight.'], 'split',
        'Videos never stop when you switch the sound — only the pane you pause yourself stops.'),
      L('spot', 'Grid vs Spotlight', ['Grid: equal views of every game', 'Spotlight: one main game big, others small to keep an eye on'],
        ['⋯ › Split screen… › Layout. In Spotlight, the pane you tap becomes the big one and gets the sound.'],
        ['Ctrl+K › Split layout. In Spotlight, the tab you click moves to the big spot.'], 'split'),
      L('scenes', 'Scenes', ['Your Sunday setup — the same 3 streams every week — in one tap'],
        ['Set up a split, then ⋯ › Split screen… › Save as a scene. Name it.', 'Next time, open ⋯ › Split screen… and tap the scene: every tab reopens in the same layout.'],
        ['Set up a split, Ctrl+K › Save split as a scene. Open it later from Ctrl+K › Scene: …'], 'split',
        'Keep screen awake is on by default while a split is open, so the phone or PC won’t dim during a game.'),
      L('bg', 'Background play', ['Listen to a video or podcast while using other apps', 'Keep a stream going with the screen off'],
        ['Leave Hush while something is playing and it keeps going — a small “Playing in Hush” notification appears.', 'If another app starts its own music or video, Hush pauses so the two don’t talk over each other.', 'Turn this off in Settings › Background play.'],
        ['On desktop, playing tabs keep going when you switch tabs or minimize.'], 'settings'),
      L('float', 'Floating video & picture-in-picture', ['Keep watching while you browse other tabs'],
        ['Leave a tab while its video plays and it shrinks into a mini player you can drag around.', 'Menu › Pop-out video to put it in a system picture-in-picture window over other apps.'],
        ['Switch tabs while a video plays and it keeps going in a small player you can drag and resize. ⤢ returns to the tab.'], null),
      L('sleep', 'Sleep timer', ['Fall asleep to a video without it playing all night'],
        ['Hold the address bar (Commands) › Sleep timer for this video: pick 15, 30, 60 minutes or end of video.'], ['Ctrl+K › Sleep timer.'], null),
      L('watch', 'Watch Together', ['Watch the same video in sync with a friend, wherever they are'],
        ['In a Murmur chat, share a video and choose Watch together. Play, pause and seeking stay in sync for both of you, privately over Tor.'],
        ['Same from Murmur on desktop; the Watch Together chip appears in the bar while you’re in a session.'], 'msgs'),
    ] },
    { e: '📖', t: 'Reading & research', s: 'Read better, remember more', l: [
      L('peek', 'Peek', ['Check a link without losing your place'],
        ['Hold a link to peek at it in a card over the page. Open as tab if you want to keep it.'], ['Shift-click (or Alt-click) a link to peek at it.'], null),
      L('reader', 'Reader, dark mode & listen', ['Clean articles without clutter', 'Have a page read to you'],
        ['Menu › Reader for a clean article view. Commands › Dark mode for websites turns any site dark. Menu › Listen to have the page read aloud with your phone’s voices.'],
        ['Ctrl+K › Reader, Dark, or Listen.'], null),
      L('assistant', 'Your AI assistant', ['Summarize a long article', 'Ask questions about the page', 'Suggest a reply in Murmur'],
        ['Menu › AI Assistant. The first time, give it a name — Nova, Jarvis, anything — it’s yours (rename it any time).', 'Pick how it runs. Cloud — Groq: instant and smart, free (about 1,000 requests a day). Tap Get my free key, sign in, tap Create API Key, then tap “Use this key in Hush” when it pops up — no copy-paste.', 'Or on this device: fully private, downloads once (the Lite model is best for phones), works offline.', 'Change between them any time with the Change button at the top.'],
        ['Ctrl+K › Ask (your assistant’s name). Name it the first time.', 'Cloud — Groq: tap Get my free key, sign in, Create API Key, then click “Use this key in Hush” when it pops up.', 'Or on this computer: fully private, downloads once, works offline. Switch any time with Change.'], 'assistant',
        'Groq requests go through Tor, so Groq never sees your IP — but it does see what you ask. For anything sensitive, use the on-device model.'),
      L('notes', 'Reading list, notes & margin notes', ['Save articles for later', 'Remember why you opened a tab', 'See what friends said about a page'],
        ['Save pages to your reading list and find them in Menu › Reading list.', 'Site shield › Note pins a private note to a site.', 'Margin notes: when friends left notes on the page you’re on, a 📌 chip appears — tap it to read them (shared privately through Murmur).'],
        ['Ctrl+K › Reading list or Tab note. A 📌 chip in the bar means friends left margin notes on this page.'], 'reading'),
      L('save', 'Save, share & send', ['Keep a page as a PDF', 'Send a page to a friend privately'],
        ['Menu › Save as PDF. Commands › Send this page to a friend shares the link privately through Murmur.', 'On Windows, photos you download have their hidden location and camera details removed.'],
        ['Ctrl+P or Ctrl+K › Save as PDF. Downloaded photos have location data removed automatically.'], null),
    ] },
    { e: '💬', t: 'Murmur — private messages', s: 'Chat, call and share without a phone number', l: [
      L('m-start', 'Set up & add friends', ['Message people without giving out your number', 'Chats nobody else can read — not even Hush'],
        ['Open Murmur from the menu. Pick a name; your account is just a key on your device — no phone number or email.', 'Add a friend: show your QR code in person or send a one-time invite link.', 'Scanning in person verifies the friend automatically (a ✓ appears).'],
        ['Open Murmur from the side bar or Ctrl+K. Same QR codes and invite links.'], 'msgs',
        'Everything goes through Tor and is end-to-end encrypted. Chats show “quantum-safe” when extra protection against future computers is on.'),
      L('m-chat', 'Chats, photos & voice', ['Send photos with faces blurred', 'Voice notes and calls'],
        ['Send photos, voice notes and files. The photo editor can blur, add text, crop and rotate before sending.', 'Hold a message to react, reply, edit or delete.', 'Set a reminder on any message: hold › Remind me.'],
        ['Same on desktop; drag files into a chat to send.'], 'msgs'),
      L('m-groups', 'Groups, folders & broadcast', ['Group chats for friends or family', 'Send one message to many people'],
        ['Make a group from the new-chat button. Give members labels.', 'Sort chats into folders and favourites. Broadcast sends one message to several people privately.'],
        ['Same on desktop.'], 'msgs'),
      L('m-safe', 'Protected chats, location & backups', ['A chat that needs Face ID / PIN to open', 'Share your live location for a while — or go ghost'],
        ['Protect a chat so it needs your lock to open. Share live location for a set time; ghost mode hides yours.', 'Back up with recovery words so you can restore Murmur on a new phone. Link your devices to use the same account on your PC.'],
        ['Same on desktop. Link devices from Murmur › Settings.'], 'msgs'),
    ] },
    { e: '📣', t: 'Echo — your private social network', s: 'Share with the people you choose', l: [
      L('e-post', 'Posting & audiences', ['Share with close friends only', 'A public profile if you want to be found'],
        ['Open Echo from the menu. Write a post and choose who sees it: everyone, a Circle, or Close friends.', 'Drafts save automatically. Add polls, quote other posts, and control who can reply.'],
        ['Same on desktop from the side bar or Ctrl+K › Echo.'], 'echo'),
      L('e-moments', 'Moments, communities & threads', ['Quick 24-hour updates', 'Groups around a topic'],
        ['Moments are short posts that disappear after a day. Join or start communities for topics you love. Long thoughts can be threads.'],
        ['Same on desktop.'], 'echo'),
      L('e-feed', 'Your feed, your rules', ['See what you care about, not what an algorithm wants'],
        ['Tune your feed privately (it happens on your device). Follow starter packs to find people fast. Trending shows what’s popular.'],
        ['Same on desktop.'], 'echo'),
    ] },
    { e: '🎨', t: 'Make it yours', s: 'Looks, settings and moving over', l: [
      L('look', 'Themes & looks', ['Easy on the eyes at night', 'Save battery with true black'],
        ['Settings › Look: colours, true black (great on OLED phones), text size and more.'], ['Settings › Look.'], 'settings'),
      L('find', 'Find any setting', ['Change something without hunting'],
        ['Type in the search box at the top of Settings — every option is searchable.'], ['Same at the top of Settings.'], 'settings'),
      L('import', 'Moving from another browser', ['Bring your bookmarks and tabs'],
        ['Importing is on desktop for now: import there, then link your devices.'], ['Settings › Import from Arc brings pinned tabs and folders over as bookmarks.'], 'settings'),
    ] },
  ];
  const ls = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (_) { return null; } };
  const css = `.hg{max-width:620px;margin:0 auto;padding:6px 4px 30px;color:var(--ink)}.hg h1{font:700 24px system-ui;margin:4px 0 2px}.hg .sub{color:var(--mute);font-size:14px;margin:0 0 14px}
  .hg input{width:100%;box-sizing:border-box;padding:11px 14px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:15px system-ui;margin-bottom:14px}
  .hg .ch{display:flex;gap:12px;align-items:center;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--card);margin-bottom:10px;cursor:pointer;width:100%;text-align:left;font:inherit;color:inherit}
  .hg .ch .e{font-size:28px;flex:none}.hg .ch b{display:block;font-size:16px}.hg .ch small{color:var(--mute);font-size:13px}.hg .ch .p{margin-left:auto;font:600 12px system-ui;color:var(--mute);white-space:nowrap}
  .hg .bar{height:6px;border-radius:9px;background:var(--line);overflow:hidden;margin:0 0 16px}.hg .bar i{display:block;height:100%;background:var(--acc)}
  .hg .ls{padding:12px 14px;border-bottom:1px solid var(--line);cursor:pointer;display:flex;gap:10px;align-items:center;background:none;border-left:0;border-right:0;border-top:0;width:100%;text-align:left;font:inherit;color:inherit}.hg .ls .ok{color:var(--acc);width:18px;flex:none}
  .hg .card{border:1px solid var(--line);border-radius:16px;background:var(--card);padding:16px}.hg h2{font:700 20px system-ui;margin:0 0 10px}.hg h3{font:700 13px system-ui;text-transform:uppercase;letter-spacing:.05em;color:var(--mute);margin:16px 0 8px}
  .hg ul{margin:0;padding-left:18px}.hg li{margin:0 0 6px;line-height:1.5}.hg ol{margin:0;padding-left:0;list-style:none;counter-reset:s}.hg ol li{counter-increment:s;display:flex;gap:10px;margin-bottom:10px;line-height:1.5}
  .hg ol li::before{content:counter(s);flex:none;width:24px;height:24px;border-radius:50%;background:var(--acc);color:var(--bg);font:700 12px/24px system-ui;text-align:center}
  .hg .tip{margin-top:12px;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--acc) 12%,transparent);font-size:14px;line-height:1.5}
  .hg .row{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}.hg .b{all:unset;cursor:pointer;padding:10px 16px;border-radius:999px;border:1px solid var(--line);font:600 14px system-ui;text-align:center}.hg .b.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
  .hg .back{all:unset;cursor:pointer;color:var(--mute);font:600 14px system-ui;padding:6px 0;margin-bottom:8px;display:inline-block}`;
  function open(el, o) {
    const mobile = !!o.mobile; let done = new Set(ls('hush.guide.done') || []);
    const save = () => ls('hush.guide.done', [...done]);
    const all = CH.flatMap((c, ci) => c.l.map((l, li) => ({ ...l, ci, li })));
    const wrap = h => { el.innerHTML = `<style>${css}</style><div class=hg>${h}</div>`; };
    const home = () => {
      const n = all.filter(l => done.has(l.id)).length;
      wrap(`<h1>Hush guide</h1><p class=sub>Everything Hush can do, what it’s good for, and how to use it — step by step.</p>
        <div class=bar><i style="width:${Math.round(n / all.length * 100)}%"></i></div>
        <input type=search placeholder="Search the guide — try “split”, “tor”, “background”" id=hgq>
        <div id=hgl>${CH.map((c, i) => { const k = c.l.filter(l => done.has(l.id)).length; return `<button class=ch data-c=${i}><span class=e>${c.e}</span><span><b>${esc(c.t)}</b><small>${esc(c.s)}</small></span><span class=p>${k}/${c.l.length}</span></button>`; }).join('')}</div>
        <div class=row><button class="b on" data-go=next>${n ? 'Continue where I left off' : 'Start from the beginning'}</button>${o.done ? '<button class=b data-go=close>Close</button>' : ''}</div>`);
      el.querySelectorAll('[data-c]').forEach(b => b.onclick = () => chapter(+b.dataset.c));
      el.querySelector('[data-go=next]').onclick = () => { const l = all.find(x => !done.has(x.id)) || all[0]; lesson(l.ci, l.li); };
      const cl = el.querySelector('[data-go=close]'); if (cl) cl.onclick = () => o.done();
      const q = el.querySelector('#hgq'); q.oninput = () => { const v = q.value.trim().toLowerCase(); const box = el.querySelector('#hgl');
        if (!v) return home();
        const hits = all.filter(l => (l.t + ' ' + l.uses.join(' ') + ' ' + (mobile ? l.m : l.d).join(' ')).toLowerCase().includes(v));
        box.innerHTML = hits.length ? hits.map(l => `<button class=ls data-l="${l.ci}:${l.li}"><span class=ok>${done.has(l.id) ? '✓' : CH[l.ci].e}</span><span>${esc(l.t)}<br><small style="color:var(--mute)">${esc(CH[l.ci].t)}</small></span></button>`).join('') : '<p class=sub>Nothing found — try another word.</p>';
        box.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { const [c, l] = b.dataset.l.split(':').map(Number); lesson(c, l); }); };
    };
    const chapter = ci => { const c = CH[ci];
      wrap(`<button class=back data-go=home>‹ Guide</button><h1>${c.e} ${esc(c.t)}</h1><p class=sub>${esc(c.s)}</p>
        <div class=card style="padding:0">${c.l.map((l, i) => `<button class=ls data-l=${i}><span class=ok>${done.has(l.id) ? '✓' : '○'}</span><span>${esc(l.t)}<br><small style="color:var(--mute)">${esc(l.uses[0])}</small></span></button>`).join('')}</div>`);
      el.querySelector('[data-go=home]').onclick = home; el.querySelectorAll('[data-l]').forEach(b => b.onclick = () => lesson(ci, +b.dataset.l)); };
    const lesson = (ci, li) => { const c = CH[ci], l = c.l[li], steps = mobile ? l.m : l.d, k = all.findIndex(x => x.id === l.id);
      wrap(`<button class=back data-go=ch>‹ ${esc(c.t)}</button><div class=card><h2>${esc(l.t)}</h2>
        <h3>Use it to</h3><ul>${l.uses.map(u => `<li>${esc(u)}</li>`).join('')}</ul>
        <h3>How</h3><ol>${steps.map(s => `<li><span>${esc(s)}</span></li>`).join('')}</ol>
        ${l.tip ? `<div class=tip>💡 ${esc(l.tip)}</div>` : ''}
        <div class=row>${l.act && o.act ? '<button class=b data-go=try>Try it now</button>' : ''}<span style="flex:1"></span>${k ? '<button class=b data-go=prev>Back</button>' : ''}<button class="b on" data-go=next>${k === all.length - 1 ? 'Finish' : 'Got it — next'}</button></div></div>
        <p class=sub style="text-align:center;margin-top:10px">${k + 1} of ${all.length}</p>`);
      el.querySelector('[data-go=ch]').onclick = () => chapter(ci);
      const t = el.querySelector('[data-go=try]'); if (t) t.onclick = () => { done.add(l.id); save(); o.act(l.act); };
      const p = el.querySelector('[data-go=prev]'); if (p) p.onclick = () => { const x = all[k - 1]; lesson(x.ci, x.li); };
      el.querySelector('[data-go=next]').onclick = () => { done.add(l.id); save(); const x = all[k + 1]; if (x) lesson(x.ci, x.li); else home(); };
      try { el.scrollTop = 0; el.closest('.sheet,#panel')?.scrollTo?.(0, 0); } catch (_) {} };
    home();
  }
  return { open, chapters: CH };
})();
