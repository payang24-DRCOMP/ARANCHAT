/*
 * AranChat — แจ้ง "มีรุ่นใหม่" ในแอป Android (เราแจก APK เองจากหน้าดาวน์โหลด ไม่ผ่าน Play Store → แอปไม่อัปเดตเอง)
 *   อ่าน https://chat.arankub.com/download/latest.json (สร้างโดย ~/aranchat-ess/scripts/18-publish-apps.sh)
 *   รุ่นใหม่กว่า → ถามครั้งเดียวต่อ 12 ชม. · "อัปเดต" = เปิดลิงก์ APK ที่ตรงกับเครื่อง (64/32 บิต) ให้เบราว์เซอร์โหลด แล้วแตะติดตั้งทับ
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.x

import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import timber.log.Timber
import java.net.HttpURLConnection
import java.net.URL

private const val FEED_URL = "https://chat.arankub.com/download/latest.json"
private const val ASK_EVERY_MS = 12 * 3600_000L

/** "26.11.2" > "26.11.1" — เทียบทีละส่วนเป็นตัวเลข (ตัด -nightly ฯลฯ) */
internal fun isNewerVersion(remote: String, local: String): Boolean {
    val a = remote.split('.', '-').map { it.toIntOrNull() ?: 0 }
    val b = local.split('.', '-').map { it.toIntOrNull() ?: 0 }
    for (i in 0 until maxOf(a.size, b.size)) {
        val x = a.getOrElse(i) { 0 }
        val y = b.getOrElse(i) { 0 }
        if (x != y) return x > y
    }
    return false
}

fun checkForAranChatUpdate(activity: ComponentActivity) {
    val prefs = activity.getSharedPreferences("aranchat_update", Context.MODE_PRIVATE)
    if (System.currentTimeMillis() - prefs.getLong("asked_at", 0) < ASK_EVERY_MS) return
    activity.lifecycleScope.launch {
        val feed = withContext(Dispatchers.IO) {
            runCatching {
                val conn = URL("$FEED_URL?t=${System.currentTimeMillis()}").openConnection() as HttpURLConnection
                conn.connectTimeout = 10_000
                conn.readTimeout = 10_000
                try {
                    JSONObject(conn.inputStream.bufferedReader().readText()).optJSONObject("android")
                } finally {
                    conn.disconnect()
                }
            }.onFailure { Timber.w(it, "AranChat: ตรวจรุ่นใหม่ไม่สำเร็จ") }.getOrNull()
        } ?: return@launch
        val remote = feed.optString("version")
        val local = runCatching { activity.packageManager.getPackageInfo(activity.packageName, 0).versionName }.getOrNull().orEmpty()
        if (remote.isEmpty() || !isNewerVersion(remote, local)) return@launch
        val is64 = Build.SUPPORTED_64_BIT_ABIS.isNotEmpty()
        val url = feed.optString(if (is64) "url" else "url32").ifEmpty { feed.optString("url") }
        if (url.isEmpty() || activity.isFinishing) return@launch
        prefs.edit().putLong("asked_at", System.currentTimeMillis()).apply()
        val notes = feed.optString("notes")
        AlertDialog.Builder(activity)
            .setTitle("มี AranChat รุ่นใหม่ ($remote)")
            .setMessage(
                "แตะ \"อัปเดต\" เพื่อดาวน์โหลด แล้วแตะไฟล์ที่โหลดเสร็จเพื่อติดตั้งทับของเดิม (ข้อมูลแชทไม่หาย)" +
                    if (notes.isNotEmpty()) "\n\n$notes" else ""
            )
            .setPositiveButton("อัปเดต") { _, _ ->
                runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
            }
            .setNegativeButton("ไว้ทีหลัง", null)
            .show()
    }
}
