package app.hush.browser
object Native {
    init { System.loadLibrary("hush_lib") }
    external fun shouldBlock(url: String, source: String, kind: String): Boolean
    external fun cosmeticJs(url: String): String
}
