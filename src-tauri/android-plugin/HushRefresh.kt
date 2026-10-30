package app.hush.browser

import android.content.Context
import android.view.MotionEvent
import android.view.ViewConfiguration
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import kotlin.math.abs

/**
 * Pull-to-refresh that only reacts to a clearly vertical, deliberate pull from the top of the page.
 * Sideways swipes (carousels, scrolling bars, maps) never start it, and the pull has to travel further before it reloads.
 */
class HushRefresh(c: Context) : SwipeRefreshLayout(c) {
    private var x0 = 0f; private var y0 = 0f; private var sideways = false
    private val slop = ViewConfiguration.get(c).scaledTouchSlop
    init {
        val d = c.resources.displayMetrics.density
        setDistanceToTriggerSync((170 * d).toInt())   // default is 64dp
        setSlingshotDistance((190 * d).toInt())
    }
    override fun onInterceptTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { x0 = e.x; y0 = e.y; sideways = false }
            MotionEvent.ACTION_MOVE -> {
                val dx = abs(e.x - x0); val dy = e.y - y0
                if (!sideways && dx > slop && dx > dy * 0.6f) sideways = true
                // Only a downward pull that's at least twice as vertical as it is sideways counts.
                if (sideways || dy < slop * 2 || dy < dx * 2) return false
            }
        }
        return super.onInterceptTouchEvent(e)
    }
}
