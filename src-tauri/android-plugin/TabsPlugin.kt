package app.hush.browser

import android.app.Activity
import android.app.DownloadManager
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.webkit.*
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.*

/**
 * Each tab is a native Android WebView placed over the chrome page (mobile.html), between its bars.
 * Events to the chrome UI are delivered by calling window.__hushEvent(name, data) in the chrome page:
 *   tabUrl {id, url, state: started|finished, canBack, canFwd}   download {name, state, error?}   back {}
 */
@TauriPlugin
class TabsPlugin(private val act: Activity) : Plugin(act) {
    private class Tab(val id: String, var url: String, var wv: WebView?, var saved: Bundle? = null) {
        /** Current page URL, readable from WebView's network thread (WebView methods like getUrl() are UI-thread only). */
        @Volatile var page: String = url
    }
    private val tabs = LinkedHashMap<String, Tab>()
    private var active: String? = null
    private var visible = true
    private var topPx = 0; private var bottomPx = 0
    private var textZoom = 100; private var desktop = false
    private var defaultUa: String? = null
    private var chrome: WebView? = null
    private val empty get() = WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), "".byteInputStream())

    override fun load(webView: WebView) {
        super.load(webView)
        chrome = webView
        // System back: page history first, otherwise let the chrome UI decide (close a sheet, etc.).
        (act as? ComponentActivity)?.onBackPressedDispatcher?.addCallback(object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val w = active?.let { tabs[it]?.wv }
                if (visible && w != null && w.canGoBack()) w.goBack() else emit("back", JSObject())
            }
        })
    }

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
        put("id", t.id); put("url", t.url); put("state", state); put("canBack", w.canGoBack()); put("canFwd", w.canGoForward())
    })

    private fun applyPrefs(w: WebView) {
        if (defaultUa == null) defaultUa = w.settings.userAgentString
        w.settings.textZoom = textZoom
        w.settings.userAgentString = if (desktop) defaultUa!!.replace(Regex("; Android [^;)]*"), "; X11; Linux x86_64").replace(" Mobile", "") else defaultUa
        w.settings.useWideViewPort = true; w.settings.loadWithOverviewMode = desktop
    }

    private fun make(t: Tab): WebView = WebView(act).also { w ->
        w.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true
            setSupportMultipleWindows(false); javaScriptCanOpenWindowsAutomatically = false   // popup deny
            safeBrowsingEnabled = true; allowFileAccess = false; allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW; setGeolocationEnabled(false)
            builtInZoomControls = true; displayZoomControls = false
        }
        applyPrefs(w)
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, false)
        w.webViewClient = object : WebViewClient() {
            // NEVER call v.url (or any WebView method) here: this runs on a network thread and WebView throws,
            // which crashes the app ("the installed version of WebView caused the crash").
            override fun shouldInterceptRequest(v: WebView, r: WebResourceRequest): WebResourceResponse? {
                val u = r.url.toString()
                if (r.isForMainFrame) t.page = u
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
                emitUrl(t, v, "started")
            }
            override fun onPageFinished(v: WebView, u: String) { t.url = u; emitUrl(t, v, "finished") }
            override fun doUpdateVisitedHistory(v: WebView, u: String, reload: Boolean) { t.url = u; emitUrl(t, v, "finished") }
        }
        w.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(v: WebView, d: Boolean, g: Boolean, m: android.os.Message?) = false
            override fun onPermissionRequest(r: PermissionRequest) { r.deny() }   // camera/mic: deny by default (R-55)
        }
        w.setDownloadListener { url, ua, cd, mime, _ -> download(url, ua, cd, mime) }
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

    private fun layout(w: WebView) {
        val lp = (w.layoutParams as? android.widget.FrameLayout.LayoutParams) ?: android.widget.FrameLayout.LayoutParams(-1, -1)
        lp.topMargin = topPx; lp.bottomMargin = bottomPx; w.layoutParams = lp
    }

    /** Show the active tab's view (or none while a chrome sheet is open). */
    private fun render() = act.runOnUiThread {
        val root = act.findViewById<ViewGroup>(android.R.id.content)
        tabs.values.forEach { t -> t.wv?.let { if (it.parent != null && (t.id != active || !visible)) root.removeView(it) } }
        val t = active?.let { tabs[it] } ?: return@runOnUiThread
        if (!visible) return@runOnUiThread
        if (t.wv == null) t.wv = make(t).also { w -> if (t.saved != null) w.restoreState(t.saved!!) else w.loadUrl(t.url) }
        val w = t.wv!!
        if (w.parent == null) root.addView(w, android.widget.FrameLayout.LayoutParams(-1, -1))
        layout(w)
    }

    @Command fun openTab(i: Invoke) {
        val id = "t" + java.util.UUID.randomUUID().toString().take(8)
        tabs[id] = Tab(id, i.parseArgs(Args::class.java).url, null); active = id; visible = true; render()
        i.resolve(JSObject().put("id", id))
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
            tabs.remove(id)?.wv?.let { w -> (w.parent as? ViewGroup)?.removeView(w); w.destroy() }
            if (active == id) active = null
        }
        i.resolve()
    }
    /** Battery/RAM: destroy every background WebView, keep URL + navigation state, restore lazily. */
    @Command fun discardBackground(i: Invoke) { act.runOnUiThread {
        tabs.forEach { (id, t) -> if (id != active) t.wv?.let { w -> t.saved = Bundle().also(w::saveState); w.destroy(); t.wv = null } } }
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
        textZoom = a.textZoom.coerceIn(50, 200); val reload = desktop != a.desktop; desktop = a.desktop
        act.runOnUiThread { tabs.values.forEach { t -> t.wv?.let { w -> applyPrefs(w); if (reload) w.reload() } } }
        i.resolve() }

    @InvokeArg class InsetArgs { var px: Int = 0; var bottom: Int = 0 }
    @InvokeArg class PrefArgs { var textZoom: Int = 100; var desktop: Boolean = false }
    @InvokeArg class NavArgs { var action: String = "" }
    @InvokeArg class Args { var url: String = "" }
    @InvokeArg class IdArgs { var id: String = "" }

    companion object {
        private val IMG = Regex(".*\\.(png|jpe?g|gif|webp|svg|ico|avif)$")
        private val FONT = Regex(".*\\.(woff2?|ttf|otf)$")
        private val MEDIA = Regex(".*\\.(mp4|webm|mp3|m4a|ogg)$")
    }
}
