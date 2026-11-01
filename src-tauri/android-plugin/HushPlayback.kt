package app.hush.browser

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Keeps Hush's audio/video going after you switch to another app (Android stops a background app's media
 * unless it runs a "media playback" service). Started only while a tab is playing and Hush is in the background;
 * stopped as soon as you come back or the sound ends. If another app starts its own music or video, the page
 * loses audio focus and pauses by itself, so the other app wins — Hush never fights it.
 */
class HushPlayback : Service() {
    override fun onBind(i: Intent?): IBinder? = null
    override fun onStartCommand(i: Intent?, flags: Int, id: Int): Int {
        // "Pause" on the notification: you stopped it — Hush pauses everything and won't restart it.
        if (i?.action == ACT_PAUSE) { try { onPause?.invoke() } catch (e: Throwable) {}; stopSelf(); return START_NOT_STICKY }
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null)
            nm.createNotificationChannel(NotificationChannel(CH, "Playing in the background", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
        val open = PendingIntent.getActivity(this, 7, (packageManager.getLaunchIntentForPackage(packageName) ?: Intent()).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val title = i?.getStringExtra("title")?.take(80)?.ifEmpty { null } ?: "Hush"
        val n: Notification = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CH) else @Suppress("DEPRECATION") Notification.Builder(this))
            .setSmallIcon(applicationInfo.icon).setContentTitle(title).setContentText("Playing in Hush").setContentIntent(open).setOngoing(true)
            .addAction(@Suppress("DEPRECATION") Notification.Action.Builder(applicationInfo.icon, "Pause", PendingIntent.getService(this, 8, Intent(this, HushPlayback::class.java).setAction(ACT_PAUSE), PendingIntent.FLAG_IMMUTABLE)).build())
            .build()
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(1907, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK) else startForeground(1907, n)
        } catch (e: Throwable) { stopSelf() }
        return START_NOT_STICKY
    }
    companion object {
        private const val CH = "hush-playback"; private const val ACT_PAUSE = "app.hush.browser.PAUSE"
        /** Set by the tabs plugin: pause every tab and disarm the keep-playing guard. */
        @Volatile var onPause: (() -> Unit)? = null
        fun start(c: Context, title: String) { try { val i = Intent(c, HushPlayback::class.java).putExtra("title", title)
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i) } catch (e: Throwable) {} }
        fun stop(c: Context) { try { c.stopService(Intent(c, HushPlayback::class.java)) } catch (e: Throwable) {} }
    }
}
