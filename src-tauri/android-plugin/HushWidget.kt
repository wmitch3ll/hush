package app.hush.browser

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/** Home-screen search widget: tap the bar to search, the mic for voice, the mask for a private tab. */
class HushWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        fun open(extra: String, code: Int): PendingIntent {
            val i = (ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent()).apply {
                putExtra(extra, true); addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP) }
            return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        for (id in ids) {
            val v = RemoteViews(ctx.packageName, ctx.resources.getIdentifier("hush_widget", "layout", ctx.packageName))
            val r = { name: String -> ctx.resources.getIdentifier(name, "id", ctx.packageName) }
            v.setOnClickPendingIntent(r("hush_widget_search"), open("hush_search", 1))
            v.setOnClickPendingIntent(r("hush_widget_voice"), open("hush_voice", 2))
            v.setOnClickPendingIntent(r("hush_widget_private"), open("hush_private", 3))
            mgr.updateAppWidget(id, v)
        }
    }
}
