/*
 * AranChat — การ์ดแนะนำเพื่อน (content["com.arankub.contact"]) — ชุดเดียวกับเว็บ (src/aranchat/AranContact.tsx)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.features.messages.impl.timeline.model.event

import androidx.compose.runtime.Immutable
import org.json.JSONObject

@Immutable
data class AranContact(
    val userId: String,
    val name: String,
    val avatarUrl: String?,
) {
    companion object {
        const val CONTENT_KEY = "com.arankub.contact"

        /** ข้อความการ์ดขึ้นต้นด้วยคำนี้เสมอ — อ่าน JSON เฉพาะข้อความที่ใช่ (ไม่อ่านทุกข้อความ) */
        const val BODY_PREFIX = "👤 "

        private val USER_ID = Regex("^@[^:\\s]+:\\S+$")

        fun fromEventJson(json: String?): AranContact? = runCatching {
            val c = JSONObject(json ?: return null).optJSONObject("content")?.optJSONObject(CONTENT_KEY) ?: return null
            val userId = c.optString("user_id").takeIf { USER_ID.matches(it) } ?: return null
            AranContact(
                userId = userId,
                name = c.optString("name").take(80).ifBlank { userId },
                avatarUrl = c.optString("avatar_url").takeIf { it.startsWith("mxc://") },
            )
        }.getOrNull()
    }
}
