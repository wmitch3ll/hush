package app.hush.browser

import android.app.Activity
import android.os.Bundle
import android.webkit.*
import android.view.ViewGroup
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.*

@TauriPlugin
class TabsPlugin(private val act: Activity) : Plugin(act) {
    private class Tab(var url: String, var wv: WebView?, var saved: Bundle? = null, var priv: Boolean = false)
    private val tabs = LinkedHashMap<String, Tab>(); private var active: String? = null; private var topPx = 0
    private val empty = WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), "".byteInputStream())

    /** Resource type for adblock-rust, from Accept header + extension (R-13). */
    private fun kindOf(r: WebResourceRequest): String {
        if (r.isForMainFrame) return "document"
        val a = r.requestHeaders["Accept"] ?: ""; val p = r.url.path ?: ""
        return when {
            a.contains("text/css") -> "stylesheet"
            a.startsWith("image/") || p.matches(Regex(".*\\.(png|jpe?g|gif|webp|svg|ico|avif)$")) -> "image"
            a.contains("text/html") -> "sub_frame"
            p.endsWith(".js") || p.endsWith(".mjs") -> "script"
            p.matches(Regex(".*\\.(woff2?|ttf|otf)$")) -> "font"
            p.matches(Regex(".*\\.(mp4|webm|mp3|m4a|ogg)$")) -> "media"
            else -> "xmlhttprequest"
        }
    }
    private fun make(t: Tab): WebView = WebView(act).also { w ->
        w.settings.apply { javaScriptEnabled = true; domStorageEnabled = !t.priv
            setSupportMultipleWindows(false); javaScriptCanOpenWindowsAutomatically = false   // popup deny
            safeBrowsingEnabled = true; allowFileAccess = false; allowContentAccess = false }
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, false)
        w.webViewClient = object : WebViewClient() {
            // Runs on a worker thread BEFORE the network request: same Rust engine via JNI.
            override fun shouldInterceptRequest(v: WebView, r: WebResourceRequest): WebResourceResponse? {
                val kind = kindOf(r)
                return if (Native.shouldBlock(r.url.toString(), v.url ?: r.url.toString(), kind)) empty else null
            }
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                if (r.url.scheme == "http") { v.loadUrl(r.url.toString().replaceFirst("http://", "https://")); return true }  // HTTPS-first
                return false }
            override fun onPageStarted(v: WebView, u: String, f: android.graphics.Bitmap?) {
                v.evaluateJavascript(Native.cosmeticJs(u), null)
            }
        }
        w.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(v: WebView, d: Boolean, g: Boolean, m: android.os.Message?) = false
        }
    }
    private fun show(id: String) = act.runOnUiThread {
        val root = act.findViewById<ViewGroup>(android.R.id.content)
        active?.let { tabs[it]?.wv?.let { w -> root.removeView(w) } }
        val t = tabs[id] ?: return@runOnUiThread
        if (t.wv == null) { t.wv = make(t).also { w -> if (t.saved != null) w.restoreState(t.saved!!) else w.loadUrl(t.url) } }
        root.addView(t.wv, android.widget.FrameLayout.LayoutParams(-1, -1).apply { topMargin = topPx }); active = id
    }
    @Command fun openTab(i: Invoke) { val id = java.util.UUID.randomUUID().toString()
        tabs[id] = Tab(i.parseArgs(Args::class.java).url, null); show(id); i.resolve(JSObject().put("id", id)) }
    @Command fun switchTab(i: Invoke) { show(i.parseArgs(IdArgs::class.java).id); i.resolve() }
    @Command fun closeTab(i: Invoke) { val id = i.parseArgs(IdArgs::class.java).id
        act.runOnUiThread { tabs.remove(id)?.wv?.destroy() }; i.resolve() }
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
        tabs.values.forEach { it.wv?.clearCache(true); it.wv?.clearHistory() } }; i.resolve() }
    @Command fun setTopInset(i: Invoke) { topPx = i.parseArgs(PxArgs::class.java).px
        act.runOnUiThread { active?.let { tabs[it]?.wv?.let { w -> (w.layoutParams as? android.widget.FrameLayout.LayoutParams)?.let { lp -> lp.topMargin = topPx; w.layoutParams = lp } } } }; i.resolve() }
    @InvokeArg class PxArgs { var px: Int = 0 }
    @InvokeArg class NavArgs { var action: String = "" }
    @InvokeArg class Args { var url: String = "" }
    @InvokeArg class IdArgs { var id: String = "" }
}
