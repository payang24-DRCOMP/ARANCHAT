/*
 * AranChat — กดปุ่มสั่งงานบนการ์ดแจ้งเตือน (การ์ดรุ่น 2 · ~/aranchat-ess/notify/cardkit.mjs)
 *   ส่งข้อความตอบกลับการ์ด (ทุกคนในห้องเห็นว่าใครกดอะไร) + content["com.arankub.card_action"] = { event_id, id }
 *   → บอทแจ้งเตือนส่งต่อให้ระบบต้นทาง แล้วแก้การ์ดเดิมเป็นผลการตัดสิน (ซ่อนปุ่ม)
 * ชุดเดียวกับเว็บแชท (element-web: src/aranchat/AranCardBody.tsx)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.features.messages.impl.aranchat

import androidx.compose.runtime.staticCompositionLocalOf
import dev.zacsweers.metro.Inject
import io.element.android.features.messages.impl.timeline.model.event.AranCard
import io.element.android.libraries.matrix.api.room.JoinedRoom
import org.json.JSONObject

val LocalAranCardSender = staticCompositionLocalOf<AranCardSender?> { null }

@Inject
class AranCardSender(
    private val room: JoinedRoom,
) {
    /** @param value ค่าจากปุ่มเลือกวันเวลา ("2026-11-20" / "18:30" / "2026-11-20T18:30") */
    suspend fun sendAction(cardEventId: String, actionId: String, label: String, value: String? = null): Result<Unit> = runCatching {
        val action = JSONObject().put("event_id", cardEventId).put("id", actionId)
        if (value != null) action.put("value", value)
        val content = JSONObject()
            .put("msgtype", "m.text")
            .put("body", if (value != null) "$label: ${value.replace("T", " ")}" else label)
            .put("m.relates_to", JSONObject().put("m.in_reply_to", JSONObject().put("event_id", cardEventId)))
            .put(AranCard.ACTION_KEY, action)
        room.sendRawForEventId("m.room.message", content.toString()).getOrThrow()
        Unit
    }
}
