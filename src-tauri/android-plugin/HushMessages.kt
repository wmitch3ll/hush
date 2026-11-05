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
 * Murmur, when Hush is in the background: a quiet "connected" notification keeps the app alive so messages still arrive
 * (Android would otherwise freeze it), and each new message is shown as a normal notification that opens its chat.
 * Everything stays on this phone; no push server is involved.
 */
class HushMessages : Service() {
    override fun onBind(i: Intent?): IBinder? = null
    override fun onStartCommand(i: Intent?, flags: Int, id: Int): Int {
        ensureChannels(this)
        val open = PendingIntent.getActivity(this, 11, (packageManager.getLaunchIntentForPackage(packageName) ?: Intent()).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val n: Notification = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CH_LIVE) else @Suppress("DEPRECATION") Notification.Builder(this))
            .setSmallIcon(applicationInfo.icon).setContentTitle("Murmur is connected").setContentText("Private messages arrive here, through Tor")
            .setContentIntent(open).setOngoing(true).setShowWhen(false).build()
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(1908, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING) else startForeground(1908, n)
        } catch (e: Throwable) { stopSelf() }
        return START_NOT_STICKY
    }
    companion object {
        const val CH_LIVE = "hush-murmur-live"; const val CH_MSG = "hush-murmur-messages"
        fun ensureChannels(c: Context) { if (Build.VERSION.SDK_INT < 26) return
            val nm = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CH_LIVE) == null) nm.createNotificationChannel(NotificationChannel(CH_LIVE, "Murmur connection", NotificationManager.IMPORTANCE_MIN).apply { setShowBadge(false) })
            if (nm.getNotificationChannel(CH_MSG) == null) nm.createNotificationChannel(NotificationChannel(CH_MSG, "Murmur messages", NotificationManager.IMPORTANCE_HIGH).apply { enableVibration(true) }) }
        fun start(c: Context) { try { val i = Intent(c, HushMessages::class.java); if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i) } catch (e: Throwable) {} }
        fun stop(c: Context) { try { c.stopService(Intent(c, HushMessages::class.java)) } catch (e: Throwable) {} }
        /** One notification per chat (newer messages replace older ones); tapping opens that chat. */
        fun post(c: Context, key: String, title: String, text: String, count: Int) { try { ensureChannels(c)
            val nm = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val i = (c.packageManager.getLaunchIntentForPackage(c.packageName) ?: Intent()).putExtra("hush_chat", key).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
            val pi = PendingIntent.getActivity(c, key.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val b = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(c, CH_MSG) else @Suppress("DEPRECATION") Notification.Builder(c))
                .setSmallIcon(c.applicationInfo.icon).setContentTitle(title.take(60)).setContentText(text.take(160)).setStyle(Notification.BigTextStyle().bigText(text.take(400)))
                .setContentIntent(pi).setAutoCancel(true).setCategory(Notification.CATEGORY_MESSAGE).setWhen(System.currentTimeMillis()).setShowWhen(true)
            if (count > 1) b.setNumber(count)
            @Suppress("DEPRECATION") if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL)
            nm.notify(key.hashCode(), b.build()) } catch (e: Throwable) {} }
        fun clear(c: Context, key: String) { try { (c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(key.hashCode()) } catch (e: Throwable) {} }
    }
}
