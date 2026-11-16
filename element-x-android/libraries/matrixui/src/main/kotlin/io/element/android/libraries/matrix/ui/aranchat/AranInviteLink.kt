/*
 * AranChat — ลิงก์ชวนเพื่อน / แชร์กลุ่ม https://chat.<server>/i/<รหัส> (aranchat-ess/notify/invites.mjs)
 * ใช้ร่วม: แท็บเพื่อน (ปุ่มชวนเพื่อน) · ตั้งค่า (QR โค้ดของฉัน) — ยืนยันตัวด้วย OpenID token (ไม่ส่ง access token)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.libraries.matrix.ui.aranchat

import io.element.android.libraries.matrix.api.MatrixClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class AranInvite(
    val url: String,
    /** จำนวนคนที่เข้ามาผ่านลิงก์นี้แล้ว */
    val joined: Int,
)

/** สร้าง (หรือใช้ซ้ำ) ลิงก์ชวน — roomId = แชร์กลุ่ม, null = ชวนคุยกับฉัน */
suspend fun MatrixClient.createAranInvite(roomId: String? = null): Result<AranInvite> = runCatching {
    val body = JSONObject().put("openid", JSONObject(requestOpenIdToken().getOrThrow()))
    if (roomId != null) body.put("room_id", roomId)
    val base = "https://chat.${userIdServerName()}/api/notify"
    withContext(Dispatchers.IO) {
        val conn = URL("$base/invite/create").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            check(conn.responseCode == 200) { "invite create ${conn.responseCode}" }
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            AranInvite(url = json.getString("url"), joined = json.optInt("joined"))
        } finally {
            conn.disconnect()
        }
    }
}

/** ผลการเปิดลิงก์ชวน: แชทกับคนชวน หรือหน้าขอเข้ากลุ่ม */
sealed interface AranInviteTarget {
    data class User(val userId: String) : AranInviteTarget
    data class Room(val roomId: String) : AranInviteTarget
}

/** รหัสจากลิงก์ https://chat.<โดเมน>/i/<รหัส> (null = ไม่ใช่ลิงก์ชวน) */
fun aranInviteCode(url: String): String? =
    Regex("^https://chat\\.[\\w.-]+/i/([a-z0-9]{8})/?(?:[?#].*)?$").find(url)?.groupValues?.get(1)

/**
 * เปิดลิงก์ชวนในแอป (Android App Links): แจ้ง server ว่าเข้ามาจากลิงก์ (นับผู้ชวน + บอทบอกคนชวน)
 * แล้วคืนปลายทาง — เหมือนเว็บ (element-web src/aranchat/invites.ts consumePendingInvite)
 */
suspend fun MatrixClient.acceptAranInvite(code: String): Result<AranInviteTarget> = runCatching {
    val body = JSONObject().put("openid", JSONObject(requestOpenIdToken().getOrThrow()))
    val base = "https://chat.${userIdServerName()}/api/notify"
    withContext(Dispatchers.IO) {
        val conn = URL("$base/invite/$code/accept").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            check(conn.responseCode == 200) { "invite accept ${conn.responseCode}" }
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            when (json.optString("kind")) {
                "room" -> AranInviteTarget.Room(json.getString("room_id"))
                else -> AranInviteTarget.User(json.getString("mxid"))
            }
        } finally {
            conn.disconnect()
        }
    }
}

/** ข้อความชวนสำหรับส่งทาง LINE / แอปอื่น */
fun aranInviteText(myName: String?, url: String) = "มาคุยกับ${myName?.let { " $it" } ?: "ฉัน"} บน AranChat แอปแชทของบุคลากร 👉 $url"
