package app.hush.browser

import android.Manifest
import android.app.Activity
import android.app.DownloadManager
import android.app.PictureInPictureParams
import android.app.SearchManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.print.PrintManager
import android.speech.RecognizerIntent
import android.util.Rational
import android.view.View
import android.widget.FrameLayout
import androidx.activity.result.ActivityResult
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.ActivityCallback
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.webkit.*
import android.view.ViewGroup
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.*

/**
 * Each tab is a native Android WebView placed over the chrome page (mobile.html), between its bars.
 * Events to the chrome UI are delivered by calling window.__hushEvent(name, data) in the chrome page:
 *   tabUrl {id, url, title, state: started|finished, canBack, canFwd}   download {name, state, error?}   back {}
 *   find {index, count}   longpress {url, kind: link|image}   thumb {id, data: jpeg data URL}  (tab-grid previews)
 *   listen {state, index, total}   peek {state: open|closed|expanded, id?, url?}   pick {host, sel}   screenshot {data}
 *   tabAudio {id, audio}   icon {id, host, data}   openUrl {}  (a link/share/widget arrived — call takeIntent)   permission {host, kinds[]}
 */
@TauriPlugin
class TabsPlugin(private val act: Activity) : Plugin(act) {
    private class Tab(val id: String, var url: String, var wv: WebView?, var saved: Bundle? = null, val priv: Boolean = false, val space: String = "") {
        var lastUsed = System.currentTimeMillis()
        @Volatile var audio = false
        var ptr: androidx.webkit.ScriptHandler? = null
        var box: SwipeRefreshLayout? = null   // pull-to-refresh container around the WebView
        /** Current page URL, readable from WebView's network thread (WebView methods like getUrl() are UI-thread only). */
        @Volatile var page: String = url
    }
    private val tabs = LinkedHashMap<String, Tab>()
    private var active: String? = null
    private var visible = true
    private var topPx = 0; private var bottomPx = 0
    private var textZoom = 100; private var desktop = false; private var pullRefresh = true
    private var findQuery = ""
    private var bgPlay = true
    @Volatile private var inBg = false
    /** Start/stop the background playback service to match: Hush in the background + a tab making sound. */
    /** The playback service must be started while Hush is still on screen: since Android 12 an app may not start
     *  a foreground service from the background (it's silently refused — that's why sound used to stop when you
     *  switched apps). So it starts as soon as something plays, and keeps Hush alive while it plays. In the
     *  foreground it stops a little after the sound stops; in the background it stays until you return, tap Pause,
     *  or close Hush. */
    private var svcOn = false; private val svcStop = Runnable { if (!inBg && tabs.values.none { it.audio }) { HushPlayback.stop(act); svcOn = false } }
    private fun bgCheck() { if (!bgPlay) { if (svcOn) { HushPlayback.stop(act); svcOn = false }; return }
        val playing = tabs.values.firstOrNull { it.audio }
        val h = act.window.decorView
        if (playing != null) { h.removeCallbacks(svcStop); if (!svcOn || inBg) { HushPlayback.start(act, playing.wv?.title ?: ""); svcOn = true } }
        else if (svcOn && !inBg) { h.removeCallbacks(svcStop); h.postDelayed(svcStop, 20000) } }
    private var pendingUrl: String? = null
    private var fsView: View? = null; private var fsCb: WebChromeClient.CustomViewCallback? = null
    private var pendingPerm: PermissionRequest? = null
    private var pendingGeo: Pair<String, GeolocationPermissions.Callback>? = null
    // ---------- Secrets in the Android Keystore (Murmur / Echo identity). The AES key never leaves secure hardware. ----------
    private fun vaultKey(): javax.crypto.SecretKey {
        val ks = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey("hush-vault", null) as? javax.crypto.SecretKey)?.let { return it }
        val g = javax.crypto.KeyGenerator.getInstance(android.security.keystore.KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(android.security.keystore.KeyGenParameterSpec.Builder("hush-vault", android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        return g.generateKey()
    }
    private val vault by lazy { act.getSharedPreferences("hush-vault", android.content.Context.MODE_PRIVATE) }
    @Command fun secretSet(i: Invoke) { val a = i.parseArgs(SecretArgs::class.java)
        if (!a.name.matches(Regex("[A-Za-z0-9-]{1,40}"))) { i.reject("bad name"); return }
        try { val c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding"); c.init(javax.crypto.Cipher.ENCRYPT_MODE, vaultKey())
            val enc = c.doFinal(a.value.toByteArray(Charsets.UTF_8)); val b = { x: ByteArray -> android.util.Base64.encodeToString(x, android.util.Base64.NO_WRAP) }
            vault.edit().putString(a.name, b(c.iv) + ":" + b(enc)).apply(); i.resolve() } catch (e: Throwable) { i.reject("Couldn’t store securely: " + e.message) } }
    @Command fun secretGet(i: Invoke) { val a = i.parseArgs(SecretArgs::class.java)
        val v = vault.getString(a.name, null); if (v == null) { i.resolve(JSObject().put("value", org.json.JSONObject.NULL)); return }
        try { val (iv, enc) = v.split(":").map { android.util.Base64.decode(it, android.util.Base64.NO_WRAP) }
            val c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding"); c.init(javax.crypto.Cipher.DECRYPT_MODE, vaultKey(), javax.crypto.spec.GCMParameterSpec(128, iv))
            i.resolve(JSObject().put("value", String(c.doFinal(enc), Charsets.UTF_8))) } catch (e: Throwable) { i.reject("Couldn’t read the secure store: " + e.message) } }
    @Command fun secretDel(i: Invoke) { val a = i.parseArgs(SecretArgs::class.java); vault.edit().remove(a.name).apply(); i.resolve() }
    /** App lock: fingerprint / face (falls back to the in-app PIN). */
    @Command fun biometric(i: Invoke) { act.runOnUiThread {
        val fa = act as? androidx.fragment.app.FragmentActivity
        val ok = androidx.biometric.BiometricManager.from(act).canAuthenticate(androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK) == androidx.biometric.BiometricManager.BIOMETRIC_SUCCESS
        if (fa == null || !ok) { i.resolve(JSObject().put("ok", false).put("available", false)); return@runOnUiThread }
        var done = false
        androidx.biometric.BiometricPrompt(fa, androidx.core.content.ContextCompat.getMainExecutor(act), object : androidx.biometric.BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(r: androidx.biometric.BiometricPrompt.AuthenticationResult) { if (!done) { done = true; i.resolve(JSObject().put("ok", true).put("available", true)) } }
            override fun onAuthenticationError(code: Int, msg: CharSequence) { if (!done) { done = true; i.resolve(JSObject().put("ok", false).put("available", true)) } }
        }).authenticate(androidx.biometric.BiometricPrompt.PromptInfo.Builder().setTitle("Unlock Hush").setSubtitle("Murmur & Echo")
            .setAllowedAuthenticators(androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK).setNegativeButtonText("Use PIN").build()) } }
    /** Privacy curtain: while Murmur/Echo is open, block screenshots and the recent-apps thumbnail. */
    @Command fun secure(i: Invoke) { val on = i.parseArgs(SecureArgs::class.java).on
        act.runOnUiThread { if (on) act.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE) else act.window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE); i.resolve() } }
    // ---------- Murmur chat bubble: a floating head over the page when a message arrives. Drag it anywhere;
    // tap to open the chat; drag it to the bottom to dismiss. ----------
    private var bubble: android.widget.TextView? = null
    @Command fun bubble(i: Invoke) { val a = i.parseArgs(BubbleArgs::class.java)
        act.runOnUiThread {
            val root = act.findViewById<ViewGroup>(android.R.id.content)
            if (!a.show) { bubble?.let { root.removeView(it) }; bubble = null; i.resolve(); return@runOnUiThread }
            val b = bubble ?: android.widget.TextView(act).also { v ->
                val sz = dp(58); v.layoutParams = FrameLayout.LayoutParams(sz, sz).apply { leftMargin = act.resources.displayMetrics.widthPixels - sz - dp(14); topMargin = topPx + dp(90) }
                v.gravity = android.view.Gravity.CENTER; v.setTextColor(0xFFFFFFFF.toInt()); v.textSize = 18f; v.typeface = android.graphics.Typeface.DEFAULT_BOLD; v.elevation = dp(12).toFloat()
                var dx = 0f; var dy = 0f; var moved = false
                v.setOnTouchListener { view, e -> val lp = view.layoutParams as FrameLayout.LayoutParams
                    when (e.actionMasked) {
                        android.view.MotionEvent.ACTION_DOWN -> { dx = e.rawX - lp.leftMargin; dy = e.rawY - lp.topMargin; moved = false; view.animate().scaleX(.9f).scaleY(.9f).setDuration(80).start() }
                        android.view.MotionEvent.ACTION_MOVE -> { val nx = (e.rawX - dx).toInt(); val ny = (e.rawY - dy).toInt(); if (kotlin.math.abs(nx - lp.leftMargin) + kotlin.math.abs(ny - lp.topMargin) > 6) moved = true
                            lp.leftMargin = nx; lp.topMargin = ny; view.layoutParams = lp }
                        android.view.MotionEvent.ACTION_UP -> { view.animate().scaleX(1f).scaleY(1f).setDuration(80).start()
                            val h = root.height; if (moved && lp.topMargin > h - dp(150)) { root.removeView(view); bubble = null; emit("bubble", JSObject().put("a", "dismiss")) }
                            else if (!moved) emit("bubble", JSObject().put("a", "open"))
                            else { val w = act.resources.displayMetrics.widthPixels; lp.leftMargin = if (lp.leftMargin + view.width / 2 < w / 2) dp(10) else w - view.width - dp(10); view.layoutParams = lp } }
                    }; true }
                root.addView(v); bubble = v }
            b.text = a.text.take(2); b.background = android.graphics.drawable.GradientDrawable().apply { shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(try { android.graphics.Color.parseColor(a.color) } catch (e: Throwable) { 0xFF4F46E5.toInt() }); setStroke(dp(3), 0xFFFFFFFF.toInt()) }
            b.contentDescription = "New message"; b.bringToFront(); b.scaleX = 0.6f; b.scaleY = 0.6f; b.animate().scaleX(1f).scaleY(1f).setDuration(160).start()
            i.resolve() } }
    private val keepIds = mutableSetOf<String>()
    private val sunk = mutableSetOf<String>()
    /** Background media: keep | release | pause | play for one tab. */
    @Command fun media(i: Invoke) { val a = i.parseArgs(MediaArgs::class.java)
        act.runOnUiThread { val t = tabs[a.id]
            when (a.action) {
                "keep" -> keepIds += a.id
                "release" -> keepIds -= a.id
                "pause" -> { keepIds -= a.id; t?.wv?.evaluateJavascript("document.querySelectorAll('video,audio').forEach(v=>v.pause())", null) }
                "play" -> t?.wv?.evaluateJavascript("(document.querySelector('video,audio')||{play(){}}).play()", null)
            }
            render(); i.resolve() } }
    // ---------- Where you left off (scroll position + video time per page; stays on this phone, 30 days, newest 180 pages) ----------
    private val posPrefs by lazy { act.getSharedPreferences("hush-pos", Context.MODE_PRIVATE) }
    private fun posSave(json: String) { try { val o = org.json.JSONObject(json); val k = o.optString("k"); if (k.isEmpty() || k.length > 400) return
        val e = posPrefs.edit()
        if (o.optInt("y") == 0 && o.optInt("vt") == 0) e.remove(k) else e.putString(k, System.currentTimeMillis().toString() + "|" + json)
        val all = posPrefs.all; if (all.size > 220) all.entries.sortedBy { (it.value as? String)?.substringBefore('|')?.toLongOrNull() ?: 0L }.take(all.size - 180).forEach { e.remove(it.key) }
        e.apply() } catch (e: Throwable) {} }
    private fun posLoad(k: String): String? { val v = posPrefs.getString(k, null) ?: return null
        val ts = v.substringBefore('|').toLongOrNull() ?: return null
        return if (System.currentTimeMillis() - ts > 30L * 86400_000L) null else v.substringAfter('|') }
    /** Privacy report: how many requests were blocked on which site (hostnames and counts only, never from private tabs). Sent to the UI in batches. */
    private val blockPending = HashMap<String, Int>(); private var blockFlush = false
    private fun countBlock(t: Tab) { if (t.priv) return
        val h = try { Uri.parse(t.page)?.host?.removePrefix("www.") } catch (e: Throwable) { null } ?: return
        synchronized(blockPending) { blockPending[h] = (blockPending[h] ?: 0) + 1; if (blockFlush) return; blockFlush = true }
        act.window.decorView.postDelayed({ val snap = synchronized(blockPending) { blockFlush = false; HashMap(blockPending).also { blockPending.clear() } }
            snap.forEach { (host, n) -> emit("blocked", JSObject().apply { put("host", host); put("n", n) }) } }, 4000) }
    /** Every saved camera / microphone / location choice, for the privacy panel. */
    @Command fun allSitePerms(i: Invoke) { val m = HashMap<String, JSObject>()
        prefs.all.forEach { (k, v) -> val p = k.split("|"); if (p.size == 2 && v is Boolean) m.getOrPut(p[0]) { JSObject() }.put(p[1], v) }
        val arr = org.json.JSONArray(); m.toSortedMap().forEach { (h, o) -> arr.put(JSObject().put("host", h).put("kinds", o)) }
        i.resolve(JSObject().put("list", arr)) }
    /** Short diary of what the app did to the videos' pages (shown, hidden, floated, split) — goes into problem reports, no URLs. */
    private val natLog = ArrayDeque<String>()
    private fun nlog(m: String) { synchronized(natLog) { natLog.addLast((System.currentTimeMillis() % 100000).toString() + " " + m); while (natLog.size > 40) natLog.removeFirst() } }
    private var floatScale = 1f; private var floatId: String? = null; private var floatX = -1; private var floatY = -1; private var floatW = 0
    private var dragStart = IntArray(3); private var dragId = -1
    @Command fun floatTab(i: Invoke) { val a = i.parseArgs(FloatArgs::class.java)
        act.runOnUiThread { val t = tabs[a.id]; val w = t?.wv
            if (t == null || w == null) { i.reject("no tab"); return@runOnUiThread }
            floatId?.takeIf { it != a.id }?.let { unfloat(it, false) }
            nlog("float on " + a.id.takeLast(4)); floatId = a.id; floatX = a.x; floatY = a.y; floatW = if (a.w > 0) a.w else (act.resources.displayMetrics.widthPixels * 0.62).toInt(); dragId = -1
            w.evaluateJavascript(Native.floatJs() + ";__hushFloat(true);window.__hushMediaSet&&__hushMediaSet({on:true,mute:null,keep:true});", null)
            w.onResume(); w.resumeTimers(); render(); i.resolve() } }
    /** Problem reports: what happened to the videos in the mini player / current tab (events, sizes, focus) — no URLs. */
    @Command fun mediaLog(i: Invoke) { act.runOnUiThread {
        val ids = listOfNotNull(floatId, active).distinct() + panes().filter { it != active }
        ids.forEach { id -> tabs[id]?.wv?.evaluateJavascript("window.__hushMediaCollect&&__hushMediaCollect()", null) }
        act.window.decorView.postDelayed({ val out = JSObject(); out.put("app", synchronized(natLog) { natLog.joinToString(" | ") }); var left = ids.size
            if (left == 0) { i.resolve(out); return@postDelayed }
            ids.forEach { id -> val role = if (id == floatId) "mini" else if (id == active) "tab" else "pane"
                val w = tabs[id]?.wv; if (w == null) { if (--left == 0) i.resolve(out); return@forEach }
                w.evaluateJavascript("(window.__hushMediaOut||[]).join(' || ').slice(0,3000)") { r -> out.put(role, r ?: ""); if (--left == 0) i.resolve(out) } } }, 600) } }
    @Command fun floatClose(i: Invoke) { val stop = i.parseArgs(FloatArgs::class.java).stop
        act.runOnUiThread { floatId?.let { unfloat(it, stop) }; i.resolve() } }
    private fun unfloat(id: String, stop: Boolean) {
        if (floatId != id) return; nlog("float off " + id.takeLast(4) + if (stop) " stop" else ""); floatId = null
        tabs[id]?.let { t -> t.wv?.evaluateJavascript(Native.floatJs() + ";__hushFloat(false);" + (if (id !in panes()) "window.__hushMediaSet&&__hushMediaSet({on:false});" else "") + (if (stop) "document.querySelectorAll('video,audio').forEach(v=>v.pause());" else ""), null)
            t.box?.let { b -> b.elevation = 0f; b.clipToOutline = false; if (id != active) { (b.parent as? ViewGroup)?.removeView(b) } } }
        render() }
    private fun onFloatUrl(t: Tab, u: Uri) { if (t.id != floatId) return
        val d = act.resources.displayMetrics.density; val q = { k: String -> u.getQueryParameter(k)?.toDoubleOrNull() ?: 0.0 }
        when (u.host) {
            "open" -> { unfloat(t.id, false); emit("float", JSObject().apply { put("a", "open"); put("id", t.id) }) }
            "close" -> { unfloat(t.id, true); emit("float", JSObject().apply { put("a", "close"); put("id", t.id) }) }
            "move", "size", "drop" -> {
                val id = q("id").toInt(); val b = t.box ?: return
                if (id != dragId) { dragId = id; dragStart = intArrayOf(floatX, floatY, (b.width * floatScale).toInt()) }
                // The page is scaled down on screen, so its finger distances are in unscaled page pixels: scale them back.
                val k = d * floatScale
                when (u.host) { "move" -> { floatX = dragStart[0] + (q("dx") * k).toInt(); floatY = dragStart[1] + (q("dy") * k).toInt() }
                    "size" -> floatW = dragStart[2] + (q("dw") * k).toInt() }
                render()
                if (u.host == "drop") emit("float", JSObject().apply { put("a", "moved"); put("x", floatX); put("y", floatY); put("w", floatW) }) } } }
    private var torOn = false
    private val NO_RTC_JS = "(()=>{for(const k of ['RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel'])try{delete window[k];Object.defineProperty(window,k,{value:undefined})}catch(e){}})();"
    /** Tor mode: route every tab through Hush's local Tor proxy (whole app), or back to a direct connection. */
    @Command fun torMode(i: Invoke) { val a = i.parseArgs(TorArgs::class.java)
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) { i.reject("This phone's WebView can't use a proxy — update Android System WebView"); return }
        val pc = androidx.webkit.ProxyController.getInstance(); val ex = java.util.concurrent.Executor { act.runOnUiThread(it) }
        val done = Runnable { torOn = a.on
            // Recreate open tabs so every page (and its WebRTC removal) uses the new route; nothing is reused across.
            CookieManager.getInstance().removeAllCookies(null); WebStorage.getInstance().deleteAllData()
            tabs.values.forEach { t -> t.wv?.let { w -> (w.parent as? ViewGroup)?.removeView(w); w.destroy() }; t.wv = null }
            render(); i.resolve() }
        if (a.on && a.port in 1..65535) pc.setProxyOverride(androidx.webkit.ProxyConfig.Builder().addProxyRule("socks5://127.0.0.1:" + a.port).build(), ex, done)
        else pc.clearProxyOverride(ex, done) }
    private var tts: android.speech.tts.TextToSpeech? = null
    private var ttsQ: List<String> = emptyList(); private var ttsI = 0; private var ttsRate = 1f; private var ttsOn = false
    private var peekTab: Tab? = null; private var peekBox: FrameLayout? = null
    private val prefs by lazy { act.getSharedPreferences("hush-site-perms", Context.MODE_PRIVATE) }
    private var defaultUa: String? = null
    private var chrome: WebView? = null
    private val empty get() = WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), "".byteInputStream())

    override fun load(webView: WebView) {
        super.load(webView)
        chrome = webView
        // Background play: when you switch to another app while a tab is playing, a media playback service keeps
        // Hush's sound going (Android would otherwise stop it). Another app playing its own audio still pauses it.
        HushPlayback.onPause = { act.runOnUiThread { svcOn = false; tabs.values.forEach { t -> t.audio = false
            t.wv?.evaluateJavascript("window.__hushBgGuard&&__hushBgGuard(false);document.querySelectorAll('video,audio').forEach(m=>m.pause());window.__hushMediaSet&&__hushMediaSet({on:false,pause:true})", null) } } }
        act.application.registerActivityLifecycleCallbacks(object : android.app.Application.ActivityLifecycleCallbacks {
            override fun onActivityStopped(a: Activity) { if (a !== act) return; inBg = true; bgCheck()
                // Arm the keep-playing guard in every open tab; any tab that's playing starts the playback service.
                if (bgPlay) tabs.values.forEach { t -> t.wv?.evaluateJavascript(BG_GUARD_JS + ";__hushBgGuard(true)") { r -> if (r == "true") { t.audio = true; bgCheck() } }
                    // …and inside every frame (streaming sites play in other sites' player frames)
                    if (t.id !in panes()) t.wv?.evaluateJavascript("window.__hushMediaSet&&__hushMediaSet({on:true,mute:null,keep:true})", null) }
                // Something may have paused the tab views on the way out: wake the ones that are playing.
                act.window.decorView.postDelayed({ if (inBg && bgPlay) tabs.values.filter { it.audio || it.id == active || it.id in panes() }.forEach { t -> t.wv?.let { w -> w.onResume(); w.resumeTimers() } } }, 300) }
            override fun onActivityStarted(a: Activity) { if (a !== act) return; inBg = false; bgCheck()
                tabs.values.forEach { t -> t.wv?.evaluateJavascript("window.__hushBgGuard&&__hushBgGuard(false)" + (if (t.id !in panes()) ";window.__hushMediaSet&&__hushMediaSet({on:false})" else ""), null) } }
            override fun onActivityCreated(a: Activity, b: Bundle?) {}
            override fun onActivityResumed(a: Activity) { if (a === act) inBg = false }
            // Mark "going to the background" early (pause comes before the window is hidden), so tabs stay "visible".
            override fun onActivityPaused(a: Activity) { if (a !== act || act.isFinishing || act.isChangingConfigurations) return
                // Still allowed to start the service here. If the page's own report missed it (players inside other
                // sites' frames), ask Android whether this app is playing sound right now.
                val am = act.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
                if (bgPlay && !svcOn && am.isMusicActive) { (tabs[active ?: ""] ?: tabs.values.firstOrNull())?.audio = true; bgCheck() }
                inBg = true }
            override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
            override fun onActivityDestroyed(a: Activity) { if (a === act) HushPlayback.stop(act) }
        })
        handleIntent(act.intent)
        // System back: page history first, otherwise let the chrome UI decide (close a sheet, etc.).
        (act as? ComponentActivity)?.onBackPressedDispatcher?.addCallback(object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val w = active?.let { tabs[it]?.wv }
                if (fsView != null) { fsCb?.onCustomViewHidden(); return }
                (splitFocus?.let { paneFs[it] } ?: paneFs.values.firstOrNull())?.let { try { it.second.onCustomViewHidden() } catch (e: Throwable) {}; return }
                if (peekBox != null) { val pw = peekTab?.wv; if (pw != null && pw.canGoBack()) pw.goBack() else closePeek(true); return }
                if (visible && w != null && w.canGoBack()) w.goBack() else emit("back", JSObject())
            }
        })
    }

    // ---------- links from other apps, shares, widget, quick-settings tile ----------
    override fun onNewIntent(intent: Intent) { handleIntent(intent) }
    private fun handleIntent(i: Intent?) {
        if (i == null || i.getBooleanExtra("hush_seen", false)) return
        val u = when {
            i.getBooleanExtra("hush_private", false) -> "hush:private"
            i.getBooleanExtra("hush_search", false) -> "hush:search"
            i.getBooleanExtra("hush_voice", false) -> "hush:voice"
            !i.getStringExtra("hush_chat").isNullOrEmpty() -> "hush:chat:" + i.getStringExtra("hush_chat")
            i.action == Intent.ACTION_VIEW -> i.dataString
            i.action == Intent.ACTION_SEND -> i.getStringExtra(Intent.EXTRA_TEXT)?.let { Regex("https?://\\S+").find(it)?.value ?: it }
            i.action == Intent.ACTION_WEB_SEARCH -> i.getStringExtra(SearchManager.QUERY)
            else -> null
        } ?: return
        i.putExtra("hush_seen", true)
        pendingUrl = u.take(8000)
        emit("openUrl", JSObject())
    }
    @Command fun takeIntent(i: Invoke) { val u = pendingUrl; pendingUrl = null; i.resolve(JSObject().put("url", u ?: "")) }
    /** Ask Android to make Hush the default browser (Android 10+: system dialog; older: default-apps settings). */
    @Command fun askDefault(i: Invoke) { act.runOnUiThread { try {
        if (Build.VERSION.SDK_INT >= 29) { val rm = act.getSystemService(android.app.role.RoleManager::class.java)
            if (rm != null && rm.isRoleAvailable(android.app.role.RoleManager.ROLE_BROWSER) && !rm.isRoleHeld(android.app.role.RoleManager.ROLE_BROWSER)) {
                act.startActivity(rm.createRequestRoleIntent(android.app.role.RoleManager.ROLE_BROWSER)); return@runOnUiThread } }
        act.startActivity(Intent(android.provider.Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS))
    } catch (e: Throwable) { try { act.startActivity(Intent(android.provider.Settings.ACTION_SETTINGS)) } catch (_: Throwable) {} } }; i.resolve() }
    @Command fun isDefault(i: Invoke) {
        val held = if (Build.VERSION.SDK_INT >= 29) act.getSystemService(android.app.role.RoleManager::class.java)?.isRoleHeld(android.app.role.RoleManager.ROLE_BROWSER) ?: false else false
        i.resolve(JSObject().put("default", held)) }

    // ---------- fullscreen video + picture-in-picture ----------
    private fun bars(show: Boolean) {
        val c = WindowInsetsControllerCompat(act.window, act.window.decorView)
        if (show) c.show(WindowInsetsCompat.Type.systemBars()) else { c.hide(WindowInsetsCompat.Type.systemBars())
            c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE }
    }
    private fun autoPip(on: Boolean) { if (Build.VERSION.SDK_INT >= 31) try {
        act.setPictureInPictureParams(PictureInPictureParams.Builder().setAutoEnterEnabled(on).setAspectRatio(Rational(16, 9)).build()) } catch (e: Throwable) {} }
    @Command fun pip(i: Invoke) { act.runOnUiThread { try { if (Build.VERSION.SDK_INT >= 26)
        act.enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build()) } catch (e: Throwable) {} }; i.resolve() }

    // ---------- per-site permissions (camera, microphone, location) ----------
    private fun osPerms(kinds: List<String>): Array<String> = kinds.flatMap { when (it) {
        "camera" -> listOf(Manifest.permission.CAMERA); "microphone" -> listOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.MODIFY_AUDIO_SETTINGS)
        "location" -> listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION); else -> emptyList() } }.toTypedArray()
    private fun ensureOs(kinds: List<String>) { val need = osPerms(kinds).filter { ContextCompat.checkSelfPermission(act, it) != PackageManager.PERMISSION_GRANTED }
        if (need.isNotEmpty()) ActivityCompat.requestPermissions(act, need.toTypedArray(), 4711) }
    private fun saved(host: String, kind: String): Boolean? = if (prefs.contains("$host|$kind")) prefs.getBoolean("$host|$kind", false) else null
    private fun webKinds(r: PermissionRequest) = r.resources.mapNotNull { when (it) {
        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> "camera"; PermissionRequest.RESOURCE_AUDIO_CAPTURE -> "microphone"; else -> null } }
    private fun decide(r: PermissionRequest, allow: Boolean) { val res = r.resources.filter { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE || it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
        if (allow && res.isNotEmpty()) { ensureOs(webKinds(r)); r.grant(res.toTypedArray()) } else r.deny() }
    @Command fun permissionReply(i: Invoke) { val a = i.parseArgs(PermArgs::class.java)
        act.runOnUiThread {
            pendingPerm?.let { r -> val host = r.origin.host ?: ""; if (a.remember) webKinds(r).forEach { prefs.edit().putBoolean("$host|$it", a.allow).apply() }; decide(r, a.allow) }
            pendingPerm = null
            pendingGeo?.let { (origin, cb) -> val host = Uri.parse(origin).host ?: ""; if (a.remember) prefs.edit().putBoolean("$host|location", a.allow).apply()
                if (a.allow) ensureOs(listOf("location")); cb.invoke(origin, a.allow, false) }
            pendingGeo = null }
        i.resolve() }
    @Command fun sitePerms(i: Invoke) { val h = i.parseArgs(HostArgs::class.java).host
        val o = JSObject(); listOf("camera", "microphone", "location").forEach { k -> saved(h, k)?.let { o.put(k, it) } }; i.resolve(o) }
    @Command fun resetSitePerms(i: Invoke) { val h = i.parseArgs(HostArgs::class.java).host
        prefs.edit().apply { listOf("camera", "microphone", "location").forEach { remove("$h|$it") } }.apply(); i.resolve() }

    // ---------- print / save as PDF, voice search ----------
    @Command fun printPage(i: Invoke) { act.runOnUiThread { val t = active?.let { tabs[it] }; val w = t?.wv
        if (w != null) try { val name = "Hush - " + (w.title ?: "page").take(60)
            (act.getSystemService(Context.PRINT_SERVICE) as PrintManager).print(name, w.createPrintDocumentAdapter(name), null) } catch (e: Throwable) {} }
        i.resolve() }
    @Command fun voice(i: Invoke) {
        val it = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_WEB_SEARCH)
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Search or say a website")
        try { startActivityForResult(i, it, "voiceResult") } catch (e: Throwable) { i.reject("Voice search isn't available on this phone") } }
    @ActivityCallback fun voiceResult(i: Invoke, r: ActivityResult) {
        val text = r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() ?: ""
        i.resolve(JSObject().put("text", text)) }

    /** Send an event to the chrome page. Data is a JSON object literal, so nothing in it can run as code. */
    private fun emit(name: String, data: JSObject) {
        val js = "window.__hushEvent&&window.__hushEvent(" + org.json.JSONObject.quote(name) + "," + data.toString() + ")"
        act.runOnUiThread { try { chrome?.evaluateJavascript(js, null) } catch (e: Throwable) {} }
    }

    /** Resource type for adblock-rust, from Accept header + extension (R-13). */
    private fun kindOf(r: WebResourceRequest): String {
        if (r.isForMainFrame) return "document"
        val a = r.requestHeaders["Accept"] ?: ""; val p = r.url.path ?: ""
        return when {
            a.contains("text/css") -> "stylesheet"
            a.startsWith("image/") || IMG.matches(p) -> "image"
            a.contains("text/html") -> "sub_frame"
            p.endsWith(".js") || p.endsWith(".mjs") -> "script"
            FONT.matches(p) -> "font"
            MEDIA.matches(p) -> "media"
            else -> "xmlhttprequest"
        }
    }

    private fun emitUrl(t: Tab, w: WebView, state: String) = emit("tabUrl", JSObject().apply {
        put("id", t.id); put("url", t.url); put("title", w.title ?: ""); put("state", state); put("canBack", w.canGoBack()); put("canFwd", w.canGoForward())
    })

    private fun applyPrefs(w: WebView) {
        // Look like the normal Chrome app, not an "embedded web view": Google (and some banks) refuse to sign in
        // inside anything marked "; wv" or "Version/4.0" ("This browser or app may not be secure").
        if (defaultUa == null) defaultUa = w.settings.userAgentString.replace("; wv)", ")").replace(Regex(" Version/\\d+(\\.\\d+)*"), "")
        // …and don't send the X-Requested-With header that names the app on every request (also a privacy leak).
        if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST))
            try { androidx.webkit.WebSettingsCompat.setRequestedWithHeaderOriginAllowList(w.settings, emptySet()) } catch (e: Throwable) {}
        w.settings.textZoom = textZoom
        w.settings.userAgentString = if (desktop) defaultUa!!.replace(Regex("; Android [^;)]*"), "; X11; Linux x86_64").replace(" Mobile", "") else defaultUa
        w.settings.useWideViewPort = true; w.settings.loadWithOverviewMode = desktop
    }

    /** True private browsing needs WebView's multi-profile support (WebView 123+). */
    private fun privateSupported() = try { WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) } catch (e: Throwable) { false }

    /** A tab's WebView that keeps playing when Hush is minimized: Android tells pages their window went invisible
     *  when you switch apps, and the page's video engine pauses itself. While Background play is on, a tab that is
     *  playing keeps being told it's visible, so nothing pauses. Closing Hush still stops everything. */
    private inner class TabView(val tab: Tab) : WebView(act) {
        override fun onWindowVisibilityChanged(visibility: Int) {
            super.onWindowVisibilityChanged(if (visibility != View.VISIBLE && bgPlay && inBg && (tab.audio || tab.id in panes() || tab.id == active)) View.VISIBLE else visibility) }
    }
    private fun make(t: Tab): WebView = TabView(t).also { w ->
        // Private tabs live in a separate, throw-away profile: own cookies, storage and cache, deleted with the last private tab.
        // This must be the first call on the WebView.
        if (t.priv && privateSupported()) try { WebViewCompat.setProfile(w, PRIVATE) } catch (e: Throwable) {}
        // Spaces with their own sign-ins: each such Space keeps its own cookies and storage in a named profile.
        else if (t.space.isNotEmpty() && privateSupported()) try { WebViewCompat.setProfile(w, "space-" + t.space) } catch (e: Throwable) {}
        // Scroll direction for the bottom toolbar (only direction changes and "near the top" are sent).
        var acc = 0; var lastDir = 0
        w.setOnScrollChangeListener { _, _, y, _, oy ->
            if (t.id != active) return@setOnScrollChangeListener
            acc += y - oy; val near = y < dp(30)
            if (near && lastDir != -1) { lastDir = -1; acc = 0; emit("scroll", JSObject().apply { put("id", t.id); put("dir", -1); put("y", 0) }) }
            else if (kotlin.math.abs(acc) > dp(24)) { val d = if (acc > 0) 1 else -1; acc = 0
                if (d != lastDir) { lastDir = d; emit("scroll", JSObject().apply { put("id", t.id); put("dir", d); put("y", y) }) } } }
        // Visible tabs get the renderer's full priority (faster page + video startup); hidden ones yield.
        try { w.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true) } catch (e: Throwable) {}
        w.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true; mediaPlaybackRequiresUserGesture = false   // videos autoplay
            setSupportMultipleWindows(true); javaScriptCanOpenWindowsAutomatically = false   // popups are dropped in onCreateWindow (not loaded over the page)
            safeBrowsingEnabled = true; allowFileAccess = false; allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW; setGeolocationEnabled(!t.priv)
            mediaPlaybackRequiresUserGesture = true
            builtInZoomControls = true; displayZoomControls = false
            if (t.priv) { cacheMode = WebSettings.LOAD_NO_CACHE; saveFormData = false }
        }
        applyPrefs(w)
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, false)
        // YouTube / anti-adblock fixes must run before the page's own scripts: document-start injection (WebView 88+).
        val earlyScripts = try { WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) } catch (e: Throwable) { false }
        if (earlyScripts) try { WebViewCompat.addDocumentStartJavaScript(w, Native.scriptletJs(), setOf("*")) } catch (e: Throwable) {}
        // Popup / click-jack guard (streaming sites): invisible ad layers, new-window ads, script popups.
        if (earlyScripts) try { WebViewCompat.addDocumentStartJavaScript(w, "window.__hushAndroid=1;" + Native.hardenJs(), setOf("*")) } catch (e: Throwable) {}
        if (earlyScripts) setPtr(t, w)
        // Tor mode: WebRTC could reveal your real IP outside the proxy, so it's removed from every page.
        if (torOn && earlyScripts) try { WebViewCompat.addDocumentStartJavaScript(w, NO_RTC_JS, setOf("*")) } catch (e: Throwable) {}
        // Tor mode: every phone looks the same (UTC, letterboxing, fonts, hardware).
        if (earlyScripts) try { WebViewCompat.addDocumentStartJavaScript(w, "var __HUSH_UNIFORM=" + (if (torOn) "'tor'" else "''") + ";" + Native.uniformJs(), setOf("*")) } catch (e: Throwable) {}
        // Audio indicator: the page reports (only) whether something is playing. Spoofing it can't do anything but flip an icon.
        val audioMsgs = try { WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) } catch (e: Throwable) { false }
        if (audioMsgs) try {
            WebViewCompat.addWebMessageListener(w, "hushAudio", setOf("*")) { _, msg, _, _, _ ->
                t.audio = msg.data == "1"; emit("tabAudio", JSObject().apply { put("id", t.id); put("audio", t.audio) }); act.runOnUiThread { bgCheck() } }
            if (earlyScripts) WebViewCompat.addDocumentStartJavaScript(w, AUDIO_JS, setOf("*"))
            // "Where you left off": the page tells the app its scroll position and video time (top page only, never from private tabs).
            // The page's own icon (small PNG): filed under the site that really sent it (never from private tabs).
            WebViewCompat.addWebMessageListener(w, "hushFav", setOf("*")) { _, msg, _, main, _ -> if (!main || t.priv) return@addWebMessageListener
                val d = msg.data ?: return@addWebMessageListener; val n = d.indexOf('\n'); if (n < 1 || d.length > 16000) return@addWebMessageListener
                val h = d.substring(0, n).removePrefix("www."); val ph = Uri.parse(t.page).host?.removePrefix("www.") ?: return@addWebMessageListener
                if (h == ph && d.startsWith("data:image/png;base64,", n + 1)) emit("favicon", JSObject().apply { put("host", h); put("data", d.substring(n + 1)) }) }
            WebViewCompat.addWebMessageListener(w, "hushPos", setOf("*")) { _, msg, _, main, _ -> if (main && !t.priv) msg.data?.let { posSave(it) } }
        } catch (e: Throwable) {}
        w.webViewClient = object : WebViewClient() {
            // NEVER call v.url (or any WebView method) here: this runs on a network thread and WebView throws,
            // which crashes the app ("the installed version of WebView caused the crash").
            override fun shouldInterceptRequest(v: WebView, r: WebResourceRequest): WebResourceResponse? {
                val u = r.url.toString()
                if (r.isForMainFrame) {
                    t.page = u
                    // Focus mode: a friendly page instead of the distracting site.
                    try { if (Native.focusBlock(u)) return WebResourceResponse("text/html", "utf-8", 200, "OK", emptyMap(), FOCUS_HTML.byteInputStream()) } catch (e: Throwable) {}
                }
                return try { if (Native.shouldBlock(u, t.page, kindOf(r))) { countBlock(t); empty } else null } catch (e: Throwable) { null }
            }
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                return when (r.url.scheme) {
                    // Element picker result (Boosts → zap): only accepted for the site this tab is on.
                    "hush-pick" -> { val host = r.url.getQueryParameter("host") ?: ""; val sel = r.url.getQueryParameter("sel") ?: ""
                        if (host.isNotEmpty() && sel.isNotEmpty() && host == Uri.parse(t.page).host) {
                            if (r.url.host == "watch") emit("watchPick", JSObject().apply { put("url", t.page); put("sel", sel); put("text", r.url.getQueryParameter("text") ?: "") })
                            else emit("pick", JSObject().apply { put("host", host); put("sel", sel) }) }; true }
                    // Two-finger gestures and the quick wheel (tools.js): only a short shape / action id is passed on.
                    // Keep-playing guard: a video that was playing got paused while Hush is in the background.
                    // Resume it — unless another app is now playing sound (then that app wins and Hush stays paused).
                    "hush-bg" -> { if (inBg && bgPlay) v.postDelayed({ val am = act.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
                        if (inBg && !am.isMusicActive) v.evaluateJavascript("window.__hushBgResume&&__hushBgResume()", null) }, 350); true }
                    "hush-float" -> { act.runOnUiThread { onFloatUrl(t, r.url) }; true }
                    // split.js: you tapped this half → it gets the highlight and the sound.
                    // Any frame of this page reports "play" / "pause" after YOU tapped: the app draws a brief round icon over the page.
                    "hush-pulse" -> { val k = r.url.host ?: ""; if (k == "play" || k == "pause") pulse(t.id, k); true }
                    "hush-split" -> { act.runOnUiThread { if (r.url.host == "swap") { if (t.id in panes()) { splitRot++; splitFrac = 1f - splitFrac; render() } } else if (splitIds.isNotEmpty() && t.id in panes() && splitFocus != t.id) { splitFocus = t.id; render(); applySplit() } }; true }
                    // harden.js: a link to another site that wanted a new window → Hush opens it in a background tab.
                    // harden.js on console.groq.com: hand a freshly made Groq key to the assistant (only from Groq's own site).
                    "hush-groq" -> { val k = r.url.getQueryParameter("k") ?: ""
                        if (Uri.parse(t.page).host == "console.groq.com" && k.startsWith("gsk_") && k.length < 200 && k.all { it.isLetterOrDigit() || it == '_' })
                            emit("groqKey", JSObject().apply { put("key", k); put("id", t.id) }); true }
                    "hush-peek" -> { val u = r.url.getQueryParameter("u") ?: ""; if (u.startsWith("https://") || u.startsWith("http://")) emit("linkTab", JSObject().apply { put("url", u) }); true }
                    "hush-gesture" -> { val h = (r.url.host ?: "").lowercase()
                        if (h.startsWith("a-") && h.length < 20 && h.drop(2).all { it in 'a'..'z' }) emit("gesture", JSObject().apply { put("action", h.drop(2)) })
                        else if (h.length in 1..4 && h.all { it in "lrudt" }) emit("gesture", JSObject().apply { put("g", h.uppercase()) }); true }
                    "http" -> { v.loadUrl(r.url.toString().replaceFirst("http://", "https://")); true }  // HTTPS-first
                    "https" -> { if (r.isForMainFrame && t.page.isNotEmpty() && Uri.parse(t.page).host?.removePrefix("www.") != r.url.host?.removePrefix("www.") && try { Native.shouldBlock(r.url.toString(), t.page, "popup") } catch (e: Throwable) { false }) { emit("popupBlocked", JSObject().apply { put("url", r.url.toString()) }); return true }
                        if (r.isForMainFrame) try { val ok = Native.jsAllowed(r.url.toString()); if (v.settings.javaScriptEnabled != ok) v.settings.javaScriptEnabled = ok } catch (e: Throwable) {}; false }
                    "about", "data", "blob" -> false
                    else -> true   // intent:, file:, javascript:, market:, custom app schemes — refused
                }
            }
            override fun onPageStarted(v: WebView, u: String, f: android.graphics.Bitmap?) {
                t.page = u; t.url = u
                // Security levels: a typed/opened URL skips shouldOverrideUrlLoading, so fix the JS switch here and reload once.
                try { val ok = Native.jsAllowed(u); if (v.settings.javaScriptEnabled != ok) { v.settings.javaScriptEnabled = ok; v.stopLoading(); v.loadUrl(u); return } } catch (e: Throwable) {}
                try { v.evaluateJavascript(Native.cosmeticJs(u), null) } catch (e: Throwable) {}
                if (!earlyScripts) try { v.evaluateJavascript(Native.scriptletJs(), null) } catch (e: Throwable) {}
                if (bgPlay) v.evaluateJavascript(BG_PLAY_JS, null)
                if (!earlyScripts) v.evaluateJavascript(AUDIO_JS, null)
                emit("tabAudio", JSObject().apply { put("id", t.id); put("audio", false) })
                emitUrl(t, v, "started")
            }
            override fun onPageFinished(v: WebView, u: String) {
                t.url = u; t.box?.isRefreshing = false
                v.postDelayed({ if (active == t.id && visible) snap(t) }, 900)
                try { val d = Native.darkJs(u); if (d.isNotEmpty()) v.evaluateJavascript(d, null) } catch (e: Throwable) {}
                emitUrl(t, v, "finished")
                // Back on a page you were on before: put the scroll position and video time back (only if you haven't moved yet).
                if (!t.priv) v.evaluateJavascript("window.__hushKey&&__hushKey()") { r -> try { val k = org.json.JSONTokener(r).nextValue() as? String
                    if (!k.isNullOrEmpty()) posLoad(k)?.let { j -> v.evaluateJavascript("window.__hushRestore&&__hushRestore(" + org.json.JSONObject.quote(j) + ")", null) } } catch (e: Throwable) {} }
                if (splitIds.isNotEmpty() && t.id in panes()) applySplit()
                barCheck(t, v)
            }
            override fun doUpdateVisitedHistory(v: WebView, u: String, reload: Boolean) { t.url = u; emitUrl(t, v, "finished"); barCheck(t, v) }
        }
        w.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(v: WebView, d: Boolean, g: Boolean, m: android.os.Message?) = false
            // No dated grey "play in a circle" placeholder before a video loads: plain black (pages' own posters still show).
            override fun getDefaultVideoPoster(): android.graphics.Bitmap =
                android.graphics.Bitmap.createBitmap(2, 2, android.graphics.Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.BLACK) }
            // Camera / microphone: ask once per site (remembered if the user says so); private tabs always deny.
            override fun onPermissionRequest(r: PermissionRequest) { act.runOnUiThread {
                val kinds = webKinds(r); val host = r.origin.host ?: ""
                if (kinds.isEmpty() || t.priv) { r.deny(); return@runOnUiThread }
                val known = kinds.map { saved(host, it) }
                if (known.all { it == true }) decide(r, true) else if (known.any { it == false }) decide(r, false)
                else { pendingPerm?.deny(); pendingPerm = r; emit("permission", JSObject().apply { put("host", host); put("kinds", org.json.JSONArray(kinds)) }) } } }
            override fun onPermissionRequestCanceled(r: PermissionRequest) { if (pendingPerm == r) pendingPerm = null }
            override fun onGeolocationPermissionsShowPrompt(origin: String, cb: GeolocationPermissions.Callback) {
                val host = Uri.parse(origin).host ?: ""
                when (saved(host, "location")) { true -> { ensureOs(listOf("location")); cb.invoke(origin, true, false) }; false -> cb.invoke(origin, false, false)
                    else -> { pendingGeo = origin to cb; emit("permission", JSObject().apply { put("host", host); put("kinds", org.json.JSONArray(listOf("location"))) }) } } }
            override fun onReceivedIcon(v: WebView, icon: android.graphics.Bitmap?) { if (icon == null || t.priv) return
                try { val b = android.graphics.Bitmap.createScaledBitmap(icon, 48, 48, true); val out = java.io.ByteArrayOutputStream()
                    b.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out)
                    emit("icon", JSObject().apply { put("id", t.id); put("host", Uri.parse(t.url).host ?: ""); put("data", "data:image/png;base64," + android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)) })
                } catch (e: Throwable) {} }
            // Fullscreen video (and picture-in-picture when you leave the app while it plays).
            override fun onShowCustomView(view: View, cb: CustomViewCallback) {
                // Split screen: "fullscreen" fills just this tab's pane — the video stays locked in its part of the split.
                if (t.id in panes()) { paneFs[t.id]?.let { (it.first.parent as? ViewGroup)?.removeView(it.first) }
                    val holder = object : FrameLayout(act) { override fun dispatchTouchEvent(e: android.view.MotionEvent): Boolean { if (e.actionMasked == android.view.MotionEvent.ACTION_DOWN) paneTouched(t.id); return super.dispatchTouchEvent(e) } }
                    holder.setBackgroundColor(0xFF000000.toInt()); holder.addView(view, FrameLayout.LayoutParams(-1, -1))
                    paneFs[t.id] = holder to cb; act.findViewById<ViewGroup>(android.R.id.content).addView(holder); render(); return }
                if (fsView != null) { cb.onCustomViewHidden(); return }
                fsView = view; fsCb = cb
                act.findViewById<ViewGroup>(android.R.id.content).addView(view, FrameLayout.LayoutParams(-1, -1)); bars(false); autoPip(true) }
            override fun onHideCustomView() {
                paneFs.remove(t.id)?.let { (it.first.parent as? ViewGroup)?.removeView(it.first); render(); return }
                fsView?.let { (it.parent as? ViewGroup)?.removeView(it) }; fsView = null; fsCb = null; bars(true); autoPip(false) }
        }
        // Split screen: touching a pane gives it the sound (native, so it works on any site and on fullscreen video).
        w.setOnTouchListener { _, e -> if (e.actionMasked == android.view.MotionEvent.ACTION_DOWN) paneTouched(t.id); false }
        w.setDownloadListener { url, ua, cd, mime, _ -> if (!t.priv) download(url, ua, cd, mime) else emit("download", JSObject().apply {
            put("name", URLUtil.guessFileName(url, cd, mime)); put("state", "failed"); put("error", "downloads are off in private tabs") }) }
        w.setFindListener { index, count, done -> if (done) emit("find", JSObject().apply { put("index", if (count == 0) 0 else index + 1); put("count", count) }) }
        // Long-press a link or image: let the chrome UI show its own menu (open in new tab, copy, share...).
        w.setOnLongClickListener {
            val h = w.hitTestResult
            when (h.type) {
                WebView.HitTestResult.SRC_ANCHOR_TYPE -> { emit("longpress", JSObject().apply { put("url", h.extra ?: ""); put("kind", "link") }); true }
                WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE -> {
                    val msg = Handler(Looper.getMainLooper()) { m -> emit("longpress", JSObject().apply {
                        put("url", m.data.getString("url") ?: h.extra ?: ""); put("kind", "link") }); true }.obtainMessage()
                    w.requestFocusNodeHref(msg); true }
                WebView.HitTestResult.IMAGE_TYPE -> { emit("longpress", JSObject().apply { put("url", h.extra ?: ""); put("kind", "image") }); true }
                else -> false
            }
        }
    }

    /** Small JPEG of what the tab currently shows, for the tab grid. Never for private tabs. */
    /** Copy what a view shows on screen (WebViews draw on the GPU, so drawing them into a bitmap gives black). */
    /** Full-page screenshot: scroll through the page one screen at a time and stitch the screens together
     *  (up to 12 screens). Sticky headers/bars are hidden after the first screen so they don't repeat. */
    private fun wholePage(w: WebView, done: (android.graphics.Bitmap?) -> Unit) {
        val vh = w.height; val total = (w.contentHeight * w.resources.displayMetrics.density).toInt().coerceAtLeast(vh).coerceAtMost(vh * 12)
        val out = try { android.graphics.Bitmap.createBitmap(w.width, total, android.graphics.Bitmap.Config.ARGB_8888) } catch (e: Throwable) { done(null); return }
        val c = android.graphics.Canvas(out); val y0 = w.scrollY
        val steps = (0 until total step vh).map { minOf(it, total - vh) }.distinct()
        fun finish(ok: Boolean) { w.evaluateJavascript("document.querySelectorAll('[data-hush-shot]').forEach(e=>{e.style.visibility=e.dataset.hushShot;e.removeAttribute('data-hush-shot')})", null)
            w.scrollTo(0, y0); if (ok) done(out) else { out.recycle(); done(null) } }
        fun step(k: Int) { if (k >= steps.size) { finish(true); return }
            w.scrollTo(0, steps[k])
            w.postDelayed({ pixels(w, Int.MAX_VALUE) { b -> if (b == null) { finish(false); return@pixels }
                c.drawBitmap(b, 0f, steps[k].toFloat(), null); b.recycle()
                if (k == 0) w.evaluateJavascript("for(const e of document.querySelectorAll('body *')){const p=getComputedStyle(e).position;if(p==='fixed'||p==='sticky'){e.dataset.hushShot=e.style.visibility;e.style.visibility='hidden'}}", null)
                w.postDelayed({ step(k + 1) }, if (k == 0) 120 else 0) } }, 160) }
        step(0) }
    private fun pixels(v: android.view.View, maxW: Int, done: (android.graphics.Bitmap?) -> Unit) {
        if (v.width <= 0 || v.height <= 0 || !v.isAttachedToWindow || Build.VERSION.SDK_INT < 26) { done(null); return }
        val loc = IntArray(2); v.getLocationInWindow(loc)
        val full = android.graphics.Bitmap.createBitmap(v.width, v.height, android.graphics.Bitmap.Config.ARGB_8888)
        try {
            android.view.PixelCopy.request(act.window, android.graphics.Rect(loc[0], loc[1], loc[0] + v.width, loc[1] + v.height), full, { r ->
                if (r != android.view.PixelCopy.SUCCESS) { full.recycle(); done(null); return@request }
                if (maxW >= v.width) { done(full); return@request }
                val s = android.graphics.Bitmap.createScaledBitmap(full, maxW, (v.height * maxW.toFloat() / v.width).toInt().coerceAtLeast(1), true); full.recycle(); done(s)
            }, android.os.Handler(android.os.Looper.getMainLooper()))
        } catch (e: Throwable) { full.recycle(); done(null) }
    }
    /** Tab-switcher preview of a tab while it's still on screen; `then` runs afterwards (e.g. take it off screen). */
    private fun snap(t: Tab, then: (() -> Unit)? = null) {
        val w = t.wv
        if (w == null || t.priv || w.parent == null) { then?.invoke(); return }
        pixels(w, 360) { bmp -> try { if (bmp != null) {
                val out = java.io.ByteArrayOutputStream(); bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 62, out); bmp.recycle()
                emit("thumb", JSObject().apply { put("id", t.id)
                    put("data", "data:image/jpeg;base64," + android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)) }) } } catch (e: Throwable) {}
            then?.invoke() }
    }

    /** The view that goes on screen: the WebView inside a pull-to-refresh container. */
    private fun boxFor(t: Tab, w: WebView): SwipeRefreshLayout = t.box ?: HushRefresh(act).also { b ->
        b.addView(w, ViewGroup.LayoutParams(-1, -1))
        b.setOnRefreshListener { w.reload() }
        b.isEnabled = false   // pull-to-refresh is done in the page (PTR_JS): it knows about scrolling boxes inside the page
        t.box = b
    }
    /** Pull-to-refresh script for this tab, on or off per the setting (re-registered when the setting changes). */
    private fun setPtr(t: Tab, w: WebView) { try { t.ptr?.remove(); t.ptr = null
        if (pullRefresh) t.ptr = WebViewCompat.addDocumentStartJavaScript(w, PTR_JS, setOf("*"))
        w.evaluateJavascript("window.__hushPtrOn=" + pullRefresh, null) } catch (e: Throwable) {} }
    private fun dropPrivateProfileIfUnused() {
        if (tabs.values.none { it.priv }) try { ProfileStore.getInstance().deleteProfile(PRIVATE) } catch (e: Throwable) {}
    }

    private fun download(url: String, ua: String?, cd: String?, mime: String?) {
        val name = URLUtil.guessFileName(url, cd, mime)
        try {
            if (!url.startsWith("https://")) throw IllegalArgumentException("only https downloads")
            val req = DownloadManager.Request(Uri.parse(url)).apply {
                setMimeType(mime); addRequestHeader("User-Agent", ua ?: "")
                CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            }
            (act.getSystemService(Activity.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
            emit("download", JSObject().apply { put("name", name); put("state", "started") })
        } catch (e: Throwable) {
            emit("download", JSObject().apply { put("name", name); put("state", "failed"); put("error", e.message ?: "") })
        }
    }

    private fun layout(w: android.view.View) {
        val lp = (w.layoutParams as? android.widget.FrameLayout.LayoutParams) ?: android.widget.FrameLayout.LayoutParams(-1, -1)
        lp.topMargin = topPx; lp.bottomMargin = bottomPx; w.layoutParams = lp
    }

    /** Show the active tab's view (or none while a chrome sheet is open). */
    private fun render(): Unit = act.runOnUiThread {
        val root = act.findViewById<ViewGroup>(android.R.id.content)
        // Media keeps playing: a tab you chose to keep playing (or the tab you're watching while the tab list is open)
        // stays attached but moved off-screen, so the page isn't paused. Everything else is taken off screen.
        splitIds.removeAll { it == active || !tabs.containsKey(it) }
        tabs.values.forEach { t -> t.box?.let { b -> val off = (t.id != active || !visible) && !(t.id == floatId && visible) && !(t.id in splitIds && visible)
            // Kept tabs sink BEHIND the app's own screen (lower Z): still attached and "visible" to the page so media
            // keeps playing, but every touch goes to the tab list / sheets on top. (Moving them off-screen could leave
            // video layers catching touches.)
            // The mini player and the split-screen panes count too: a menu, the tab list or the keyboard on top must never
            // take their page off the screen — a WebView that leaves the window is paused by Android, and so is its video.
            val live = t.id == floatId || t.id in splitIds || (splitIds.isNotEmpty() && t.id == active)
            if (off && (t.id in keepIds || live || (t.id == active && !visible && t.audio))) {
                if (b.parent == null) root.addView(b, 0, FrameLayout.LayoutParams(-1, -1)) else if (t.id !in sunk && !live) snap(t)
                if (t.id !in sunk) { sunk += t.id; nlog("sink " + t.id.takeLast(4) + if (t.id == floatId) " mini" else if (live) " split" else ""); b.translationZ = -1000f; b.elevation = 0f
                    b.importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS; b.descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS; t.wv?.clearFocus() }
                return@let }
            if (t.id in sunk) { sunk -= t.id; nlog("unsink " + t.id.takeLast(4)); b.translationZ = 0f; b.importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_AUTO; b.descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS; if (!off) b.bringToFront() }
        } }
        tabs.values.forEach { t -> t.box?.let { b -> if (b.parent != null && t.id !in sunk && (t.id != active || !visible) && !(t.id == floatId && visible) && !(t.id in splitIds && visible)) {
            // Grab the preview first (it needs the tab on screen), then take it off one frame later (the new tab covers it).
            if (b.tag != "leaving") { b.tag = "leaving"; snap(t) { b.tag = null; if ((t.id != active || !visible) && !(t.id == floatId && visible)) (b.parent as? ViewGroup)?.removeView(b) } } } } }
        // A tab that joined the split screen is no longer a mini player (it was drawn twice: shrunk AND as a pane).
        floatId?.let { fid -> if (visible && fid in panes()) { floatId = null; nlog("float off " + fid.takeLast(4) + " split")
            tabs[fid]?.wv?.evaluateJavascript(Native.floatJs() + ";__hushFloat(false);", null); emit("floatEnded", JSObject().apply { put("id", fid) }) } }
        // Floating video: that tab's view stays on top in a small, movable, resizable frame.
        tabs.values.forEach { x -> if (x.id != floatId || !visible || x.id == active) x.box?.takeIf { it.scaleX != 1f }?.let { it.scaleX = 1f; it.scaleY = 1f } }
        floatId?.let { fid -> tabs[fid]?.let { ft -> if (visible && fid != active) ft.wv?.let { fw ->
            val fb = boxFor(ft, fw); val m = act.resources.displayMetrics
            val w = floatW.coerceIn(dp(160), m.widthPixels - dp(8)); val h = w * 9 / 16
            val maxX = m.widthPixels - w; val maxY = root.height.takeIf { it > 0 }?.let { it - h - bottomPx } ?: (m.heightPixels - h)
            floatX = if (floatX < 0) maxX - dp(12) else floatX.coerceIn(0, maxX.coerceAtLeast(0)); floatY = if (floatY < 0) maxY - dp(12) else floatY.coerceIn(topPx, maxY.coerceAtLeast(topPx))
            // The page keeps a full-width 16:9 size and is only SHRUNK ON SCREEN (scaled). Sites never see a tiny
            // window, so players don't rebuild or pause themselves the moment the video becomes small.
            val W0 = m.widthPixels; val H0 = W0 * 9 / 16; val sc = w.toFloat() / W0
            val lp = FrameLayout.LayoutParams(W0, H0).apply { leftMargin = floatX; topMargin = floatY }
            if (fb.parent == null) root.addView(fb, lp) else fb.layoutParams = lp
            fb.pivotX = 0f; fb.pivotY = 0f; fb.scaleX = sc; fb.scaleY = sc; floatScale = sc
            fb.elevation = dp(10).toFloat(); fb.clipToOutline = true
            fb.outlineProvider = object : android.view.ViewOutlineProvider() { override fun getOutline(v: android.view.View, o: android.graphics.Outline) { o.setRoundRect(0, 0, v.width, v.height, dp(12) / sc) } }
            fb.bringToFront() } } }
        val t = active?.let { tabs[it] } ?: return@runOnUiThread
        // A menu/sheet is open: the split's divider and any in-pane fullscreen video go away with the pages, and come back after.
        if (!visible) { splitBar?.let { (it.parent as? ViewGroup)?.removeView(it) }; paneFs.values.forEach { it.first.visibility = View.GONE } }
        else paneFs.values.forEach { it.first.visibility = View.VISIBLE }
        if (!visible) return@runOnUiThread
        if (t.wv == null) { t.box = null; t.wv = make(t).also { w -> if (t.saved != null) w.restoreState(t.saved!!) else w.loadUrl(t.url) } }
        t.lastUsed = System.currentTimeMillis()
        val b = boxFor(t, t.wv!!)
        if (floatId == t.id) { floatId = null; t.wv?.evaluateJavascript(Native.floatJs() + ";__hushFloat(false);", null) }
        if ((b.layoutParams?.width ?: -1) != -1) b.layoutParams = android.widget.FrameLayout.LayoutParams(-1, -1)
        if (b.parent == null) root.addView(b, android.widget.FrameLayout.LayoutParams(-1, -1))
        b.elevation = 0f; b.clipToOutline = false
        layout(b)
        // Split screen (2–4 tabs). Grid: rows on a tall screen, columns/2×2 when wide; with 2 tabs the line between
        // them can be dragged. Spotlight: the focused tab big, the others in a strip. Every pane is a full page.
        val ps = panes()
        if (ps.size > 1) {
            val W = root.width.takeIf { it > 0 } ?: act.resources.displayMetrics.widthPixels
            val H = (root.height.takeIf { it > 0 } ?: act.resources.displayMetrics.heightPixels) - topPx - bottomPx
            val gap = dp(4); val wide = W > H; val n = ps.size
            // Long-press a pane swaps places: the layout order rotates; each tab keeps its sound/focus.
            val L = if (n > 1) { val k = splitRot % n; ps.drop(k) + ps.take(k) } else ps
            val rects = HashMap<String, IntArray>()   // x, y, w, h (y from the top of the page area)
            if (splitMode == "spot") {
                val f = splitFocus?.takeIf { it in L } ?: L[0]; val rest = L.filter { it != f }
                if (wide) { val bw = (W * 0.72f).toInt(); rects[f] = intArrayOf(0, 0, bw, H); val sh = (H - gap * (rest.size - 1)) / rest.size
                    rest.forEachIndexed { k, id -> rects[id] = intArrayOf(bw + gap, k * (sh + gap), W - bw - gap, sh) } }
                else { val bh = (H * 0.68f).toInt(); rects[f] = intArrayOf(0, 0, W, bh); val sw = (W - gap * (rest.size - 1)) / rest.size
                    rest.forEachIndexed { k, id -> rects[id] = intArrayOf(k * (sw + gap), bh + gap, sw, H - bh - gap) } }
            } else if (wide && n > 2) { val cw = (W - gap) / 2; val rh = (H - gap) / 2
                L.forEachIndexed { k, id -> val last = n == 3 && k == 2; rects[id] = intArrayOf(if (last) 0 else (k % 2) * (cw + gap), (k / 2) * (rh + gap), if (last) W else cw, rh) }
            } else if (wide) { val cw = (W * splitFrac).toInt().coerceIn(dp(260).coerceAtMost(W / 2), W - dp(260).coerceAtMost(W / 2)); rects[L[0]] = intArrayOf(0, 0, cw, H); rects[L[1]] = intArrayOf(cw + gap, 0, W - cw - gap, H)
            } else if (n == 2) { val h1 = (H * splitFrac).toInt().coerceIn(dp(220).coerceAtMost(H / 2), H - dp(220).coerceAtMost(H / 2)); rects[L[0]] = intArrayOf(0, 0, W, h1); rects[L[1]] = intArrayOf(0, h1 + gap, W, H - h1 - gap)
            } else { val rh = (H - gap * (n - 1)) / n; L.forEachIndexed { k, id -> rects[id] = intArrayOf(0, k * (rh + gap), W, rh) } }
            ps.forEach { id -> val pt = tabs[id] ?: return@forEach; val r = rects[id] ?: return@forEach
                if (pt.wv == null) { pt.box = null; pt.wv = make(pt).also { w -> if (pt.saved != null) w.restoreState(pt.saved!!) else w.loadUrl(pt.url) } }
                val pb = boxFor(pt, pt.wv!!); val lp = android.widget.FrameLayout.LayoutParams(r[2], r[3]).apply { leftMargin = r[0]; topMargin = topPx + r[1] }
                pb.clipToOutline = false; pb.outlineProvider = android.view.ViewOutlineProvider.BACKGROUND; pb.elevation = 0f; if (pb.scaleX != 1f) { pb.scaleX = 1f; pb.scaleY = 1f }   // a pane is a plain box (it may have been the rounded mini player)
                if (pb.parent == null) root.addView(pb, lp) else pb.layoutParams = lp
                if (pt.id in sunk) { sunk -= pt.id; pb.translationZ = 0f; pb.importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_AUTO; pb.descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS } }
            // Drag handle between two panes in grid mode.
            if (n == 2 && splitMode != "spot") {
                val d: android.view.View = splitBar ?: FrameLayout(act).also { v -> splitBar = v
                    val pill = android.view.View(act).apply { background = android.graphics.drawable.GradientDrawable().apply { cornerRadius = dp(3).toFloat(); setColor(0xCCFFFFFF.toInt()) }; elevation = dp(2).toFloat(); tag = "pill" }
                    v.addView(pill)
                    var p0 = 0f; var f0 = 0f; var last = 0L
                    v.setOnTouchListener { _, e -> val w2 = root.width > root.height - topPx - bottomPx
                        when (e.actionMasked) {
                            android.view.MotionEvent.ACTION_DOWN -> { p0 = if (w2) e.rawX else e.rawY; f0 = splitFrac; pill.animate().scaleX(1.4f).scaleY(1.4f).setDuration(120).start() }
                            android.view.MotionEvent.ACTION_MOVE -> { val av = (if (w2) root.width else root.height - topPx - bottomPx).coerceAtLeast(1); splitFrac = (f0 + ((if (w2) e.rawX else e.rawY) - p0) / av).coerceIn(0.3f, 0.7f)
                                // One layout per screen frame: laying both pages out on every touch event made the videos stutter.
                                if (!dragPending) { dragPending = true; v.postOnAnimation { dragPending = false; render() } } }
                            else -> { pill.animate().scaleX(1f).scaleY(1f).setDuration(160).start(); v.postDelayed({ applySplit() }, 200)   // after resizing, re-assert which half has the highlight and the sound
                                
                                val now = System.currentTimeMillis(); val tap = Math.abs((if (w2) e.rawX else e.rawY) - p0) < dp(6)
                                // Snap back to 50/50 near the middle, or on a double-tap.
                                if (Math.abs(splitFrac - 0.5f) < 0.05f || (tap && now - last < 320)) { splitFrac = 0.5f; render() }
                                if (tap) last = now } }
                        true } }
                val pill = (d as ViewGroup).findViewWithTag<android.view.View>("pill")
                val r0 = rects[L[0]]!!
                val grab = dp(24)   // touch area wider than the visible gap
                val dl = if (wide) android.widget.FrameLayout.LayoutParams(grab, H).apply { leftMargin = r0[2] + gap / 2 - grab / 2; topMargin = topPx } else android.widget.FrameLayout.LayoutParams(-1, grab).apply { topMargin = topPx + r0[3] + gap / 2 - grab / 2 }
                pill.layoutParams = FrameLayout.LayoutParams(if (wide) dp(4) else dp(40), if (wide) dp(40) else dp(4), android.view.Gravity.CENTER)
                if (d.parent == null) root.addView(d, dl) else d.layoutParams = dl
                d.bringToFront()
            } else splitBar?.let { (it.parent as? ViewGroup)?.removeView(it) }
        } else splitBar?.let { (it.parent as? ViewGroup)?.removeView(it) }
        paneFs.keys.toList().forEach { id -> val fs = paneFs[id] ?: return@forEach
            val pb = tabs[id]?.box
            if (id !in ps || pb == null) { paneFs.remove(id); (fs.first.parent as? ViewGroup)?.removeView(fs.first); try { fs.second.onCustomViewHidden() } catch (e: Throwable) {} }
            else { val lp0 = pb.layoutParams as? FrameLayout.LayoutParams; fs.first.layoutParams = FrameLayout.LayoutParams(lp0?.width ?: -1, lp0?.height ?: -1).apply { leftMargin = lp0?.leftMargin ?: 0; topMargin = lp0?.topMargin ?: 0 }; fs.first.bringToFront() } }
        if (splitPanes != ps) applySplit()
        floatId?.let { tabs[it]?.box }?.takeIf { it.parent != null && floatId != active }?.bringToFront()
    }

    /** Bottom bar: a page that can't scroll never sends "scrolled up", so the bar could stay hidden. After a page
     *  (or an in-page change like YouTube's) settles, if it can't scroll — or it's back at the top — show the bar. */
    private fun barCheck(t: Tab, v: WebView) { v.postDelayed({ if (t.id == active && (!v.canScrollVertically(1) || v.scrollY < dp(30)))
        emit("scroll", JSObject().apply { put("id", t.id); put("dir", -1); put("y", 0) }) }, 700) }
    private val splitIds = mutableListOf<String>(); private var splitFrac = 0.5f; private var splitRot = 0; private var dragPending = false; private var splitBar: android.view.View? = null
    private var splitMode = "grid"; private var splitAwake = true
    /** In-pane fullscreen videos (split screen): tab id → (holder view on top of that pane, the page's callback). */
    private val paneFs = HashMap<String, Pair<FrameLayout, WebChromeClient.CustomViewCallback>>()
    private fun paneTouched(id: String) { if (splitIds.isNotEmpty() && id in panes() && splitFocus != id) { splitFocus = id; if (splitMode == "spot") render(); applySplit() } }
    /** Tabs on screen in split view: the active tab first, then up to 3 more (empty = no split). */
    private fun panes(): List<String> = if (splitIds.isNotEmpty() && active != null && visible) (listOf(active!!) + splitIds.filter { it != active && tabs.containsKey(it) }.take(3)).takeIf { it.size > 1 } ?: emptyList() else emptyList()
    private var splitFocus: String? = null; private var splitPanes: List<String> = emptyList()
    /** Tell both halves whether split is on and which one has the focus (highlight + sound); halves that left the split go back to normal. */
    private fun applySplit(): Unit = act.runOnUiThread {
        val panes = panes().takeIf { it.size > 1 } ?: emptyList()
        nlog("split " + panes.size + " focus " + (splitFocus ?: "-").takeLast(4))
        // Keep awake: the screen stays on while you're watching a split.
        if (panes.isNotEmpty() && splitAwake) act.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else act.window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (!panes.contains(splitFocus ?: "")) splitFocus = panes.firstOrNull()
        ((if (panes.isEmpty()) splitPanes + listOfNotNull(active) else splitPanes).distinct() - panes.toSet()).forEach { id -> tabs[id]?.wv?.evaluateJavascript(Native.splitJs() + ";__hushSplit({on:false});", null) }
        // Order matters: mute the other panes FIRST, then give the sound to the focused one a moment later. If the
        // new pane got its sound first, two panes would be audible at once and Android would pause one of them.
        val sw = System.currentTimeMillis()
        panes.filter { it != splitFocus }.forEach { id -> tabs[id]?.wv?.evaluateJavascript(Native.splitJs() + ";__hushSplit({on:true,focus:false,sw:" + sw + "});", null) }
        splitFocus?.takeIf { it in panes }?.let { f -> act.window.decorView.postDelayed({ if (splitFocus == f) tabs[f]?.wv?.evaluateJavascript(Native.splitJs() + ";__hushSplit({on:true,focus:true,sw:" + sw + "});", null) }, 240) }
        // Highlight ring drawn natively, so it shows over a fullscreen video too.
        if (Build.VERSION.SDK_INT >= 23) tabs.values.forEach { t -> val ring = if (t.id == splitFocus && panes.isNotEmpty()) android.graphics.drawable.GradientDrawable().apply { setStroke(dp(3), 0xFF4DA3FF.toInt()); setColor(0) } else null
            t.box?.foreground = ring; paneFs[t.id]?.first?.foreground = ring?.constantState?.newDrawable() }
        splitPanes = panes }
    /** The active tab's text, for the on-device assistant. */
    /** Paste and go: the text you last copied (read only when you ask, while Hush is on screen). */
    @Command fun clipText(i: Invoke) { act.runOnUiThread { try { val cm = act.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        val t = cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(act)?.toString() ?: ""; i.resolve(JSObject().put("text", t.take(4000))) } catch (e: Throwable) { i.resolve(JSObject().put("text", "")) } } }
    @Command fun pageText(i: Invoke) { act.runOnUiThread { val w = active?.let { tabs[it]?.wv } ?: return@runOnUiThread i.reject("no tab")
        w.evaluateJavascript(Native.pageTextJs()) { v -> try { i.resolve(JSObject().put("text", org.json.JSONTokener(v).nextValue() as? String ?: "")) } catch (e: Throwable) { i.resolve(JSObject().put("text", "")) } } } }
    /** Split screen: show this tab under the active one ("" turns split off). */
    /** Split screen: add this tab to the split with the active one (again = take it out, "" = close the split). Up to 4 tabs. */
    @Command fun splitTab(i: Invoke) { val id = i.parseArgs(IdArgs::class.java).id
        act.runOnUiThread {
            if (id.isEmpty()) { splitIds.clear(); splitRot = 0; splitFrac = 0.5f } else if (id in splitIds) splitIds.remove(id) else if (id != active && tabs.containsKey(id)) { if (splitIds.size >= 3) { i.reject("Split screen holds up to 4 tabs"); return@runOnUiThread }; splitIds.add(id) }
            if (!panes().contains(splitFocus ?: "")) splitFocus = active
            render(); applySplit(); i.resolve(JSObject().put("count", panes().size)) } }
    // ---------- Murmur notifications ----------
    @InvokeArg class MsgNotifArgs { var key: String = ""; var title: String = ""; var text: String = ""; var count: Int = 1; var on: Boolean = true }
    /** Keep Murmur connected while Hush is in the background (a quiet notification), or let it sleep. */
    @Command fun msgLive(i: Invoke) { val a = i.parseArgs(MsgNotifArgs::class.java); act.runOnUiThread { if (a.on) HushMessages.start(act) else HushMessages.stop(act); i.resolve() } }
    /** A new message while Hush is in the background: a normal notification that opens that chat. */
    @Command fun notify(i: Invoke) { val a = i.parseArgs(MsgNotifArgs::class.java); act.runOnUiThread { if (inBg || !visible) HushMessages.post(act, a.key, a.title, a.text, a.count); i.resolve() } }
    @Command fun clearNotif(i: Invoke) { val a = i.parseArgs(MsgNotifArgs::class.java); act.runOnUiThread { HushMessages.clear(act, a.key); i.resolve() } }
    /** Android 13+ asks before an app may show notifications. */
    @Command fun notifPerm(i: Invoke) { act.runOnUiThread { try { if (Build.VERSION.SDK_INT >= 33 && act.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) act.requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"), 91) } catch (e: Throwable) {}; i.resolve() } }
    /** Split layout ("grid" or "spot" = spotlight) and keep-awake. */
    @Command fun splitMode(i: Invoke) { val a = i.parseArgs(SplitModeArgs::class.java); act.runOnUiThread { splitMode = if (a.mode == "spot") "spot" else "grid"; splitAwake = a.awake; render(); applySplit(); i.resolve() } }
    @Command fun openTab(i: Invoke) {
        val id = "t" + java.util.UUID.randomUUID().toString().take(8)
        val a = i.parseArgs(Args::class.java)
        val priv = a.isPrivate && privateSupported()
        val sp = a.space.lowercase().filter { it.isLetterOrDigit() }.take(24)
        tabs[id] = Tab(id, a.url, null, priv = priv, space = if (priv) "" else sp); active = id; visible = true; render()
        i.resolve(JSObject().put("id", id).put("private", priv))
    }
    /** id = "none" hides every tab (a chrome sheet is open); any other id shows that tab. */
    @Command fun switchTab(i: Invoke) {
        val id = i.parseArgs(IdArgs::class.java).id
        if (id == "none") visible = false else { visible = true; if (tabs.containsKey(id)) active = id }
        nlog("switch " + (if (id == "none") "none" else id.takeLast(4)))
        render(); i.resolve()
    }
    @Command fun closeTab(i: Invoke) {
        val id = i.parseArgs(IdArgs::class.java).id
        act.runOnUiThread {
            tabs.remove(id)?.let { t -> t.box?.let { (it.parent as? ViewGroup)?.removeView(it) }; t.wv?.destroy()
                if (t.priv) dropPrivateProfileIfUnused() }
            if (active == id) active = null
        }
        i.resolve()
    }
    /** A brief play / pause icon drawn by the app itself over a tab's page — it can't be hidden by a site's styles,
     *  a lifted video, or a cross-site player frame. Shows where that page is on screen (full tab, split pane or mini player). */
    private var lastPulse = 0L
    private fun pulse(id: String, kind: String) = act.runOnUiThread {
        val now = System.currentTimeMillis(); if (now - lastPulse < 220) return@runOnUiThread; lastPulse = now
        val b = tabs[id]?.box ?: return@runOnUiThread
        if (b.parent == null || b.width <= 0 || id in sunk || !visible) return@runOnUiThread
        val root = act.findViewById<ViewGroup>(android.R.id.content)
        val a = IntArray(2); val o = IntArray(2); b.getLocationInWindow(a); root.getLocationInWindow(o)
        val w = b.width * b.scaleX; val h = b.height * b.scaleY
        val size = (minOf(w, h) * 0.34f).toInt().coerceIn(dp(44), dp(76))
        (0 until root.childCount).map { root.getChildAt(it) }.filter { it.tag == "hush-pulse" }.forEach { root.removeView(it) }
        val v = PulseView(act, kind == "play", size); v.tag = "hush-pulse"; v.alpha = 0f; v.scaleX = .7f; v.scaleY = .7f; v.elevation = dp(40).toFloat(); v.translationZ = dp(40).toFloat()
        root.addView(v, FrameLayout.LayoutParams(size, size).apply { leftMargin = (a[0] - o[0] + w / 2 - size / 2).toInt(); topMargin = (a[1] - o[1] + h / 2 - size / 2).toInt() })
        v.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(130).withEndAction {
            v.animate().alpha(0f).scaleX(1.25f).scaleY(1.25f).setStartDelay(280).setDuration(240).withEndAction { root.removeView(v) }.start() }.start() }
    /** Battery/RAM: destroy every background WebView, keep URL + navigation state, restore lazily. */
    @Command fun discardBackground(i: Invoke) { val mins = i.parseArgs(DiscardArgs::class.java).minutes; act.runOnUiThread {
        val a = i.parseArgs(DiscardArgs::class.java); val keep = a.keep.split(',').filter { it.isNotEmpty() }.toSet(); val ps = panes()
        val cutoff = if (a.id.isNotEmpty()) Long.MAX_VALUE else System.currentTimeMillis() - mins * 60_000L
        // Never put to sleep: the open tab, split panes, the floating video, tabs you asked to keep awake. "id" = sleep that one tab now.
        tabs.forEach { (id, t) -> if (id != active && id !in ps && id != floatId && id !in keep && (a.id.isEmpty() || a.id == id) && !t.priv && t.lastUsed < cutoff) t.wv?.let { w -> t.saved = Bundle().also(w::saveState); t.box?.removeAllViews(); t.box = null; w.destroy(); t.wv = null } } }
        i.resolve() }
    @Command fun navigate(i: Invoke) { val u = i.parseArgs(Args::class.java).url
        act.runOnUiThread { active?.let { tabs[it]?.url = u; tabs[it]?.wv?.loadUrl(u) } }; i.resolve() }
    @Command fun nav(i: Invoke) { val a = i.parseArgs(NavArgs::class.java).action
        act.runOnUiThread { val w = active?.let { tabs[it]?.wv }
            when (a) { "back" -> w?.goBack(); "fwd" -> w?.goForward(); else -> w?.reload() } }; i.resolve() }
    @Command fun clearData(i: Invoke) { act.runOnUiThread {
        CookieManager.getInstance().removeAllCookies(null); WebStorage.getInstance().deleteAllData()
        WebViewDatabase.getInstance(act).clearHttpAuthUsernamePassword(); WebViewDatabase.getInstance(act).clearFormData()
        tabs.values.forEach { it.wv?.clearCache(true); it.wv?.clearHistory(); it.wv?.clearFormData() } }; i.resolve() }
    /** Space (device px) the chrome bars take at the top and bottom; tab views sit between them. */
    @Command fun setTopInset(i: Invoke) { val a = i.parseArgs(InsetArgs::class.java); topPx = a.px; bottomPx = a.bottom; render(); i.resolve() }
    /** Page preferences from Settings: text size (%) and "desktop site". Applied to every open tab. */
    @Command fun setPrefs(i: Invoke) { val a = i.parseArgs(PrefArgs::class.java)
        textZoom = a.textZoom.coerceIn(50, 200); val reload = desktop != a.desktop; desktop = a.desktop; pullRefresh = a.pullRefresh; bgPlay = a.bgPlay
        act.runOnUiThread { tabs.values.forEach { t -> t.wv?.let { w -> setPtr(t, w); applyPrefs(w); if (reload) w.reload() } } }
        i.resolve() }

    /** Native find in page; results arrive as a `find` event. */
    @Command fun find(i: Invoke) { val a = i.parseArgs(FindArgs::class.java)
        act.runOnUiThread { val w = active?.let { tabs[it]?.wv } ?: return@runOnUiThread
            when {
                a.action == "find-clear" || a.query.isEmpty() -> { w.clearMatches(); findQuery = "" }
                a.query != findQuery -> { findQuery = a.query; w.findAllAsync(a.query) }
                else -> w.findNext(a.action != "find-back")
            } }
        i.resolve() }
    /** Mute / unmute everything a tab plays (keeps new media muted too). */
    @Command fun muteTab(i: Invoke) { val a = i.parseArgs(MuteArgs::class.java)
        act.runOnUiThread { tabs[a.id]?.wv?.evaluateJavascript("(m=>{window.__hushMuted=m;const f=()=>document.querySelectorAll('video,audio').forEach(x=>x.muted=m);f();" +
            "if(!window.__hushMuteHook){window.__hushMuteHook=1;document.addEventListener('play',e=>{if(window.__hushMuted)e.target.muted=true},true)}})(" + a.muted + ")", null) }
        i.resolve() }
    // ---------- Listen: read the page aloud with the phone's own voices ----------
    private fun ttsSpeak() {
        val e = tts ?: return
        if (!ttsOn || ttsI >= ttsQ.size) { ttsOn = false; emit("listen", JSObject().apply { put("state", "done") }); return }
        e.setSpeechRate(ttsRate)
        e.speak(ttsQ[ttsI], android.speech.tts.TextToSpeech.QUEUE_FLUSH, null, "hush-$ttsI")
        emit("listen", JSObject().apply { put("state", "playing"); put("index", ttsI); put("total", ttsQ.size) })
    }
    @Command fun listen(i: Invoke) { val a = i.parseArgs(ListenArgs::class.java)
        act.runOnUiThread {
            when (a.action) {
                "start" -> { val w = active?.let { tabs[it]?.wv } ?: return@runOnUiThread
                    ttsRate = a.rate.toFloat().coerceIn(0.5f, 3f)
                    w.evaluateJavascript(Native.pageJs() + ";__hushPage.text()") { raw ->
                        val text = try { org.json.JSONArray("[" + raw + "]").getString(0) } catch (e: Throwable) { "" }
                        ttsQ = text.split(Regex("\n{2,}")).map { it.trim() }.filter { it.length > 1 }; ttsI = 0; ttsOn = true
                        if (ttsQ.isEmpty()) { emit("listen", JSObject().apply { put("state", "empty") }); return@evaluateJavascript }
                        if (tts == null) tts = android.speech.tts.TextToSpeech(act) { ok ->
                            if (ok == android.speech.tts.TextToSpeech.SUCCESS) {
                                tts?.setOnUtteranceProgressListener(object : android.speech.tts.UtteranceProgressListener() {
                                    override fun onStart(id: String?) {}
                                    override fun onError(id: String?) {}
                                    override fun onDone(id: String?) { if (ttsOn && id == "hush-$ttsI") { ttsI++; act.runOnUiThread { ttsSpeak() } } } })
                                ttsSpeak()
                            } else emit("listen", JSObject().apply { put("state", "unavailable") }) }
                        else ttsSpeak() } }
                "pause" -> { ttsOn = false; tts?.stop(); emit("listen", JSObject().apply { put("state", "paused"); put("index", ttsI); put("total", ttsQ.size) }) }
                "resume" -> { ttsOn = true; ttsSpeak() }
                "stop" -> { ttsOn = false; tts?.stop(); emit("listen", JSObject().apply { put("state", "done") }) }
                "rate" -> { ttsRate = a.rate.toFloat().coerceIn(0.5f, 3f); if (ttsOn) ttsSpeak() }
                "next" -> { if (ttsI < ttsQ.size - 1) { ttsI++; ttsOn = true; ttsSpeak() } }
                "prev" -> { ttsI = (ttsI - 1).coerceAtLeast(0); ttsOn = true; ttsSpeak() }
            } }
        i.resolve() }

    // ---------- Peek: a link in a floating card over the page ----------
    private fun dp(v: Int) = (v * act.resources.displayMetrics.density).toInt()
    @Command fun peek(i: Invoke) { val u = i.parseArgs(Args::class.java).url
        if (!u.startsWith("https://") && !u.startsWith("http://")) { i.reject("not a web link"); return }
        act.runOnUiThread {
            closePeek(false)
            val id = "t" + java.util.UUID.randomUUID().toString().take(8)
            val t = Tab(id, u, null); val w = make(t).also { it.loadUrl(u) }; t.wv = w; peekTab = t
            val shade = FrameLayout(act).apply { setBackgroundColor(0x99000000.toInt()); isClickable = true; setOnClickListener { closePeek(true) } }
            val card = android.widget.LinearLayout(act).apply { orientation = android.widget.LinearLayout.VERTICAL
                background = android.graphics.drawable.GradientDrawable().apply { setColor(0xFF161616.toInt()); cornerRadius = dp(18).toFloat() }
                clipToOutline = true; elevation = dp(12).toFloat(); isClickable = true }
            val bar = android.widget.LinearLayout(act).apply { orientation = android.widget.LinearLayout.HORIZONTAL; setPadding(dp(14), dp(6), dp(6), dp(6)); gravity = android.view.Gravity.CENTER_VERTICAL }
            val label = android.widget.TextView(act).apply { text = Uri.parse(u).host ?: u; setTextColor(0xFFEEEEEE.toInt()); textSize = 14f; maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END; layoutParams = android.widget.LinearLayout.LayoutParams(0, -2, 1f) }
            fun btn(txt: String, f: () -> Unit) = android.widget.Button(act).apply { text = txt; isAllCaps = false; setTextColor(0xFFEEEEEE.toInt()); background = null; setOnClickListener { f() } }
            bar.addView(label); bar.addView(btn("Open as tab") { expandPeek() }); bar.addView(btn("✕") { closePeek(true) })
            card.addView(bar, android.widget.LinearLayout.LayoutParams(-1, -2)); card.addView(w, android.widget.LinearLayout.LayoutParams(-1, 0, 1f))
            shade.addView(card, FrameLayout.LayoutParams(-1, -1).apply { setMargins(dp(14), topPx + dp(18), dp(14), bottomPx + dp(18)) })
            act.findViewById<ViewGroup>(android.R.id.content).addView(shade, FrameLayout.LayoutParams(-1, -1))
            peekBox = shade
            emit("peek", JSObject().apply { put("state", "open"); put("url", u) }) }
        i.resolve() }
    private fun closePeek(tell: Boolean) {
        peekBox?.let { (it.parent as? ViewGroup)?.removeView(it) }; peekTab?.wv?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        peekBox = null; peekTab = null; if (tell) emit("peek", JSObject().apply { put("state", "closed") }) }
    private fun expandPeek() {
        val t = peekTab ?: return; val w = t.wv ?: return
        (w.parent as? ViewGroup)?.removeView(w); peekBox?.let { (it.parent as? ViewGroup)?.removeView(it) }; peekBox = null; peekTab = null
        tabs[t.id] = t; active = t.id; visible = true; render()
        emit("peek", JSObject().apply { put("state", "expanded"); put("id", t.id); put("url", t.url) }) }
    @Command fun peekClose(i: Invoke) { act.runOnUiThread { closePeek(true) }; i.resolve() }

    // ---------- Screenshot (visible area) + save to Pictures/Hush ----------
    @Command fun screenshot(i: Invoke) { val fullPage = try { i.parseArgs(ShotArgs::class.java).full } catch (e: Throwable) { false }
      act.runOnUiThread { val w = active?.let { tabs[it]?.wv }
        if (w == null || w.width <= 0 || w.parent == null) { i.reject("no page"); return@runOnUiThread }
        val shoot: ((android.graphics.Bitmap?) -> Unit) -> Unit = if (fullPage) { cb -> wholePage(w, cb) } else { cb -> pixels(w, Int.MAX_VALUE, cb) }
        shoot { bmp -> if (bmp == null) { i.reject("couldn't capture"); return@shoot }
            val out = java.io.ByteArrayOutputStream(); bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out); bmp.recycle()
            emit("screenshot", JSObject().apply { put("data", "data:image/png;base64," + android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)) })
            i.resolve() } } }
    @Command fun saveImage(i: Invoke) { val a = i.parseArgs(ImgArgs::class.java)
        try { val b64 = a.data.removePrefix("data:image/png;base64,"); val bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT)
            val v = android.content.ContentValues().apply { put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, "Hush " + System.currentTimeMillis() + ".png")
                put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png")
                if (Build.VERSION.SDK_INT >= 29) put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Hush") }
            val uri = act.contentResolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v) ?: throw Exception("no storage")
            act.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
            i.resolve(JSObject().put("saved", true)) } catch (e: Throwable) { i.reject("Couldn’t save: " + (e.message ?: "")) } }
    /** Boosts → zap: start the element picker in the current page. */
    @Command fun pick(i: Invoke) { val w = i.parseArgs(PickArgs::class.java).mode == "watch"
        act.runOnUiThread { active?.let { tabs[it]?.wv }?.evaluateJavascript((if (w) "window.__hushPickMode=\"watch\";" else "") + Native.pickerJs(), null) }; i.resolve() }

    /** Run a page tool script (built by Rust from a fixed list of actions) in the active tab. */
    @Command fun evalJs(i: Invoke) { val js = i.parseArgs(JsArgs::class.java).js
        act.runOnUiThread { active?.let { tabs[it]?.wv }?.evaluateJavascript(js, null) }; i.resolve() }

    @InvokeArg class PickArgs { var mode: String = "" }
    @InvokeArg class BubbleArgs { var show: Boolean = false; var text: String = ""; var color: String = "" }
    @InvokeArg class SecureArgs { var on: Boolean = false }
    @InvokeArg class SecretArgs { var name: String = ""; var value: String = "" }
    @InvokeArg class MediaArgs { var id: String = ""; var action: String = "" }
    @InvokeArg class FloatArgs { var id: String = ""; var x: Int = -1; var y: Int = -1; var w: Int = 0; var stop: Boolean = true }
    @InvokeArg class TorArgs { var on: Boolean = false; var port: Int = 0 }
    @InvokeArg class ListenArgs { var action: String = ""; var rate: Double = 1.0 }
    @InvokeArg class ImgArgs { var data: String = "" }
    @InvokeArg class ShotArgs { var full: Boolean = false }
    @InvokeArg class MuteArgs { var id: String = ""; var muted: Boolean = true }
    @InvokeArg class FindArgs { var query: String = ""; var action: String = "find" }
    @InvokeArg class JsArgs { var js: String = "" }
    @InvokeArg class InsetArgs { var px: Int = 0; var bottom: Int = 0 }
    @InvokeArg class PrefArgs { var textZoom: Int = 100; var desktop: Boolean = false; var pullRefresh: Boolean = true; var bgPlay: Boolean = true }
    @InvokeArg class PermArgs { var allow: Boolean = false; var remember: Boolean = true }
    @InvokeArg class HostArgs { var host: String = "" }
    @InvokeArg class DiscardArgs { var minutes: Int = 0; var id: String = ""; var keep: String = "" }
    @InvokeArg class NavArgs { var action: String = "" }
    @InvokeArg class Args { var url: String = ""; var isPrivate: Boolean = false; var space: String = "" }
    @InvokeArg class IdArgs { var id: String = "" }
    @InvokeArg class SplitModeArgs { var mode: String = "grid"; var awake: Boolean = true }

    companion object {
        private const val PRIVATE = "hush-private"
        /** Tells Hush whether this page is playing sound (for the speaker icon). */
        /** Keep-playing guard (Hush in the background): remembers what was playing; if the site or the system pauses it,
         *  asks Hush (hush-bg://) whether to resume. Returns true if something was playing. A pause you make with the
         *  notification / headphone controls also asks, and resumes only when no other app is playing. */
        private const val BG_GUARD_JS = "(()=>{if(window.__hushBgGuard)return;let on=false,was=[];" +
            "window.__hushBgResume=()=>{if(on)was.forEach(m=>{if(m.paused&&!m.ended)m.play().catch(()=>{})})};" +
            "document.addEventListener('pause',e=>{if(on&&was.includes(e.target)&&!e.target.ended)setTimeout(()=>{try{location.href='hush-bg://paused'}catch(_){}},60)},true);" +
            "window.__hushBgGuard=x=>{on=!!x;was=on?[...document.querySelectorAll('video,audio')].filter(m=>!m.paused&&!m.ended):[];return was.length>0};})()"
        private const val AUDIO_JS = "(()=>{if(window.__hushAu||typeof hushAudio==='undefined')return;window.__hushAu=1;let last=null;" +
            "const tell=()=>{const on=[...document.querySelectorAll('video,audio')].some(m=>!m.paused&&!m.ended&&!m.muted&&m.volume>0);" +
            "if(on!==last){last=on;try{hushAudio.postMessage(on?'1':'0')}catch(e){}}};" +
            "for(const e of ['play','playing','pause','ended','volumechange','emptied'])document.addEventListener(e,()=>setTimeout(tell,50),true);setInterval(tell,4000)})()"
        /** Pull-to-refresh, decided by the page itself: only when the page is at the very top AND the drag didn't start
         *  in a box that scrolls on its own (comments, chats, side lists) — those just scroll. A long, deliberate pull
         *  (~140 px) is needed; a small spinner follows the finger and the page reloads when you let go past the line. */
        const val PTR_JS = "(()=>{if(window!==top||window.__hushPtr)return;window.__hushPtr=1;window.__hushPtrOn=true;" +
            "const NEED=140;let y0=0,x0=0,ok=false,d=0,host=null,dot=null;" +
            "const inner=t=>{for(let e=t;e&&e!==document.body&&e!==document.documentElement;e=e.parentElement){if(!(e instanceof Element))continue;const s=getComputedStyle(e);" +
            "if(/(auto|scroll|overlay)/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+4)return true;if(s.position==='fixed')return true}return false};" +
            "const ui=()=>{if(host)return;host=document.createElement('hush-ptr');host.style.cssText='all:initial;position:fixed;left:0;right:0;top:0;height:0;z-index:2147483647;pointer-events:none';" +
            "const r=host.attachShadow({mode:'closed'});r.innerHTML='<style>i{position:absolute;left:50%;top:0;width:36px;height:36px;margin-left:-18px;border-radius:50%;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.25);display:grid;place-items:center;opacity:0;transition:opacity .15s}" +
            "b{width:18px;height:18px;border-radius:50%;border:2.5px solid #9aa0a6;border-top-color:transparent;display:block}i.go b{border-color:#1a73e8;border-top-color:transparent;animation:s .7s linear infinite}@keyframes s{to{transform:rotate(360deg)}}</style><i><b></b></i>';" +
            "dot=r.querySelector('i');document.documentElement.append(host)};" +
            "const draw=()=>{ui();const k=Math.min(1,d/NEED);dot.style.opacity=d>12?1:0;dot.style.transform='translateY('+(Math.min(d,NEED*1.25)*0.6)+'px) rotate('+(k*270)+'deg)';dot.classList.toggle('go',false)};" +
            "const hide=()=>{if(dot){dot.style.transition='opacity .15s,transform .2s';dot.style.opacity=0;dot.style.transform='translateY(0)';setTimeout(()=>{if(dot)dot.style.transition='opacity .15s'},220)}};" +
            "addEventListener('touchstart',e=>{d=0;ok=window.__hushPtrOn!==false&&e.touches.length===1&&(scrollY||document.scrollingElement?.scrollTop||0)<=0&&!inner(e.target);" +
            "if(ok){y0=e.touches[0].clientY;x0=e.touches[0].clientX}},{capture:true,passive:true});" +
            "addEventListener('touchmove',e=>{if(!ok)return;const t=e.touches[0],dy=t.clientY-y0,dx=Math.abs(t.clientX-x0);" +
            "if(dy<=0||(scrollY||0)>0||dx>dy){ok=false;d=0;hide();return}d=dy;draw()},{capture:true,passive:true});" +
            "const end=()=>{if(!ok){return}ok=false;if(d>=NEED&&(scrollY||0)<=0){dot.style.transform='translateY('+(NEED*0.6)+'px)';dot.classList.add('go');setTimeout(()=>location.reload(),150)}else hide();d=0};" +
            "addEventListener('touchend',end,true);addEventListener('touchcancel',()=>{ok=false;d=0;hide()},true)})()"
        /** Background play: pages can't tell the app is in the background, so videos keep playing. */
        private const val BG_PLAY_JS = "(()=>{if(window.__hushBg)return;window.__hushBg=1;try{Object.defineProperty(document,'visibilityState',{get:()=>'visible'});" +
            "Object.defineProperty(document,'hidden',{get:()=>false});Object.defineProperty(document,'webkitVisibilityState',{get:()=>'visible'});" +
            "for(const e of ['visibilitychange','webkitvisibilitychange','pagehide','blur'])addEventListener(e,x=>x.stopImmediatePropagation(),true)}catch(e){}})()"
        private const val FOCUS_HTML = "<!doctype html><meta name=viewport content='width=device-width'><title>Focus mode</title>" +
            "<body style='margin:0;display:grid;place-items:center;height:100vh;font:16px system-ui;background:#111;color:#eee;text-align:center'>" +
            "<div><div style='font:300 54px Georgia,serif'>hush.</div><p>Focus mode is on.<br>This site is paused for now.</p></div>"
        private val IMG = Regex(".*\\.(png|jpe?g|gif|webp|svg|ico|avif)$")
        private val FONT = Regex(".*\\.(woff2?|ttf|otf)$")
        private val MEDIA = Regex(".*\\.(mp4|webm|mp3|m4a|ogg)$")
    }
}

/** The round play / pause icon (frosted dark disc, white glyph). Not clickable: touches go to the page underneath. */
private class PulseView(c: android.content.Context, private val play: Boolean, private val s: Int) : android.view.View(c) {
    private val bg = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { color = 0xB3121216.toInt() }
    private val ring = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { color = 0x24FFFFFF; style = android.graphics.Paint.Style.STROKE; strokeWidth = 2f }
    private val fg = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFFFFFFF.toInt() }
    init { isClickable = false; isFocusable = false }
    override fun onDraw(c: android.graphics.Canvas) {
        val r = s / 2f; c.drawCircle(r, r, r - 1f, bg); c.drawCircle(r, r, r - 1f, ring)
        if (play) { val p = android.graphics.Path().apply { moveTo(r * .80f, r * .60f); lineTo(r * 1.44f, r); lineTo(r * .80f, r * 1.40f); close() }; c.drawPath(p, fg) }
        else { val w = r * .20f; c.drawRoundRect(r * .72f, r * .62f, r * .72f + w, r * 1.38f, w / 2, w / 2, fg); c.drawRoundRect(r * 1.08f, r * .62f, r * 1.08f + w, r * 1.38f, w / 2, w / 2, fg) }
    }
}
