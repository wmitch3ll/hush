package app.hush.browser
object Native {
    init { System.loadLibrary("hush_lib") }
    external fun shouldBlock(url: String, source: String, kind: String): Boolean
    external fun cosmeticJs(url: String): String
    /** Force-dark script for this URL, or "" when dark mode is off for it. */
    external fun darkJs(url: String): String
    /** uBlock Origin scriptlets for YouTube / anti-adblock sites, run at document start. */
    external fun scriptletJs(): String
}
