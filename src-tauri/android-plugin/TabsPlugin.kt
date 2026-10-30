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
 *   icon {id, host, data}   openUrl {}  (a link/share/widget arrived — call takeIntent)   permission {host, kinds[]}
 */
@TauriPlugin
class TabsPlugin(private val act: Activity) : Plugin(act) {
    private class Tab(val id: String, var url: String, var wv: WebView?, var saved: Bundle? = null, val priv: Boolean = false) {
        var lastUsed = System.currentTimeMillis()
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
    private var pendingUrl: String? = null
    private var fsView: View? = null; private var fsCb: WebChromeClient.CustomViewCallback? = null
    private var pendingPerm: PermissionRequest? = null
    private var pendingGeo: Pair<String, GeolocationPermissions.Callback>? = null
    private val prefs by lazy { act.getSharedPreferences("hush-site-perms", Context.MODE_PRIVATE) }
    private var defaultUa: String? = null
    private var chrome: WebView? = null
    private val empty get() = WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), "".byteInputStream())

    override fun load(webView: WebView) {
        super.load(webView)
        chrome = webView
        handleIntent(act.intent)
        // System back: page history first, otherwise let the chrome UI decide (close a sheet, etc.).
        (act as? ComponentActivity)?.onBackPressedDispatcher?.addCallback(object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val w = active?.let { tabs[it]?.wv }
                if (fsView != null) { fsCb?.onCustomViewHidden(); return }
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
        if (defaultUa == null) defaultUa = w.settings.userAgentString
        w.settings.textZoom = textZoom
        w.settings.userAgentString = if (desktop) defaultUa!!.replace(Regex("; Android [^;)]*"), "; X11; Linux x86_64").replace(" Mobile", "") else defaultUa
        w.settings.useWideViewPort = true; w.settings.loadWithOverviewMode = desktop
    }

    /** True private browsing needs WebView's multi-profile support (WebView 123+). */
    private fun privateSupported() = try { WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) } catch (e: Throwable) { false }

    private fun make(t: Tab): WebView = WebView(act).also { w ->
        // Private tabs live in a separate, throw-away profile: own cookies, storage and cache, deleted with the last private tab.
        // This must be the first call on the WebView.
        if (t.priv && privateSupported()) try { WebViewCompat.setProfile(w, PRIVATE) } catch (e: Throwable) {}
        w.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true
            setSupportMultipleWindows(false); javaScriptCanOpenWindowsAutomatically = false   // popup deny
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
                return try { if (Native.shouldBlock(u, t.page, kindOf(r))) empty else null } catch (e: Throwable) { null }
            }
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                return when (r.url.scheme) {
                    "http" -> { v.loadUrl(r.url.toString().replaceFirst("http://", "https://")); true }  // HTTPS-first
                    "https", "about", "data", "blob" -> false
                    else -> true   // intent:, file:, javascript:, market:, custom app schemes — refused
                }
            }
            override fun onPageStarted(v: WebView, u: String, f: android.graphics.Bitmap?) {
                t.page = u; t.url = u
                try { v.evaluateJavascript(Native.cosmeticJs(u), null) } catch (e: Throwable) {}
                if (!earlyScripts) try { v.evaluateJavascript(Native.scriptletJs(), null) } catch (e: Throwable) {}
                if (bgPlay) v.evaluateJavascript(BG_PLAY_JS, null)
                emitUrl(t, v, "started")
            }
            override fun onPageFinished(v: WebView, u: String) {
                t.url = u; t.box?.isRefreshing = false
                v.postDelayed({ if (active == t.id && visible) snap(t) }, 900)
                try { val d = Native.darkJs(u); if (d.isNotEmpty()) v.evaluateJavascript(d, null) } catch (e: Throwable) {}
                emitUrl(t, v, "finished")
            }
            override fun doUpdateVisitedHistory(v: WebView, u: String, reload: Boolean) { t.url = u; emitUrl(t, v, "finished") }
        }
        w.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(v: WebView, d: Boolean, g: Boolean, m: android.os.Message?) = false
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
                if (fsView != null) { cb.onCustomViewHidden(); return }
                fsView = view; fsCb = cb
                act.findViewById<ViewGroup>(android.R.id.content).addView(view, FrameLayout.LayoutParams(-1, -1)); bars(false); autoPip(true) }
            override fun onHideCustomView() {
                fsView?.let { (it.parent as? ViewGroup)?.removeView(it) }; fsView = null; fsCb = null; bars(true); autoPip(false) }
        }
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
    private fun snap(t: Tab) {
        val w = t.wv ?: return
        if (t.priv || w.width <= 0 || w.height <= 0 || w.parent == null) return
        try {
            val s = 360f / w.width
            val bmp = android.graphics.Bitmap.createBitmap(360, (w.height * s).toInt().coerceIn(1, 1200), android.graphics.Bitmap.Config.RGB_565)
            val c = android.graphics.Canvas(bmp); c.scale(s, s); c.translate(-w.scrollX.toFloat(), -w.scrollY.toFloat()); w.draw(c)
            val out = java.io.ByteArrayOutputStream(); bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 62, out); bmp.recycle()
            emit("thumb", JSObject().apply { put("id", t.id)
                put("data", "data:image/jpeg;base64," + android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)) })
        } catch (e: Throwable) {}
    }

    /** The view that goes on screen: the WebView inside a pull-to-refresh container. */
    private fun boxFor(t: Tab, w: WebView): SwipeRefreshLayout = t.box ?: SwipeRefreshLayout(act).also { b ->
        b.addView(w, ViewGroup.LayoutParams(-1, -1))
        b.setOnRefreshListener { w.reload() }
        b.isEnabled = pullRefresh
        t.box = b
    }
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
    private fun render() = act.runOnUiThread {
        val root = act.findViewById<ViewGroup>(android.R.id.content)
        tabs.values.forEach { t -> t.box?.let { if (it.parent != null && (t.id != active || !visible)) { snap(t); root.removeView(it) } } }
        val t = active?.let { tabs[it] } ?: return@runOnUiThread
        if (!visible) return@runOnUiThread
        if (t.wv == null) { t.box = null; t.wv = make(t).also { w -> if (t.saved != null) w.restoreState(t.saved!!) else w.loadUrl(t.url) } }
        t.lastUsed = System.currentTimeMillis()
        val b = boxFor(t, t.wv!!)
        if (b.parent == null) root.addView(b, android.widget.FrameLayout.LayoutParams(-1, -1))
        layout(b)
    }

    @Command fun openTab(i: Invoke) {
        val id = "t" + java.util.UUID.randomUUID().toString().take(8)
        val a = i.parseArgs(Args::class.java)
        val priv = a.isPrivate && privateSupported()
        tabs[id] = Tab(id, a.url, null, priv = priv); active = id; visible = true; render()
        i.resolve(JSObject().put("id", id).put("private", priv))
    }
    /** id = "none" hides every tab (a chrome sheet is open); any other id shows that tab. */
    @Command fun switchTab(i: Invoke) {
        val id = i.parseArgs(IdArgs::class.java).id
        if (id == "none") visible = false else { visible = true; if (tabs.containsKey(id)) active = id }
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
    /** Battery/RAM: destroy every background WebView, keep URL + navigation state, restore lazily. */
    @Command fun discardBackground(i: Invoke) { val mins = i.parseArgs(DiscardArgs::class.java).minutes; act.runOnUiThread {
        val cutoff = System.currentTimeMillis() - mins * 60_000L
        tabs.forEach { (id, t) -> if (id != active && !t.priv && t.lastUsed < cutoff) t.wv?.let { w -> t.saved = Bundle().also(w::saveState); t.box?.removeAllViews(); t.box = null; w.destroy(); t.wv = null } } }
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
        act.runOnUiThread { tabs.values.forEach { t -> t.box?.isEnabled = pullRefresh; t.wv?.let { w -> applyPrefs(w); if (reload) w.reload() } } }
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
    /** Run a page tool script (built by Rust from a fixed list of actions) in the active tab. */
    @Command fun evalJs(i: Invoke) { val js = i.parseArgs(JsArgs::class.java).js
        act.runOnUiThread { active?.let { tabs[it]?.wv }?.evaluateJavascript(js, null) }; i.resolve() }

    @InvokeArg class FindArgs { var query: String = ""; var action: String = "find" }
    @InvokeArg class JsArgs { var js: String = "" }
    @InvokeArg class InsetArgs { var px: Int = 0; var bottom: Int = 0 }
    @InvokeArg class PrefArgs { var textZoom: Int = 100; var desktop: Boolean = false; var pullRefresh: Boolean = true; var bgPlay: Boolean = true }
    @InvokeArg class PermArgs { var allow: Boolean = false; var remember: Boolean = true }
    @InvokeArg class HostArgs { var host: String = "" }
    @InvokeArg class DiscardArgs { var minutes: Int = 0 }
    @InvokeArg class NavArgs { var action: String = "" }
    @InvokeArg class Args { var url: String = ""; var isPrivate: Boolean = false }
    @InvokeArg class IdArgs { var id: String = "" }

    companion object {
        private const val PRIVATE = "hush-private"
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
