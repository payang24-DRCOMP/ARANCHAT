/*
 * AranChat — การ์ดแจ้งเตือน (content["com.arankub.card"] ที่ระบบแจ้งเตือน ~/aranchat-ess/notify ส่งมา)
 * ชุดเดียวกับเว็บแชท (element-web: src/aranchat/AranCardBody.tsx) · รูปแบบรุ่น 2: notify/cardkit.mjs
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.features.messages.impl.timeline.model.event

import androidx.compose.runtime.Immutable
import org.json.JSONArray
import org.json.JSONObject

@Immutable
data class AranField(val label: String, val value: String, val tone: String? = null)

@Immutable
sealed interface AranSection {
    val title: String?

    data class Text(val text: String) : AranSection {
        override val title: String? = null
    }

    data class Fields(override val title: String?, val items: List<AranField>) : AranSection
    data class Steps(override val title: String?, val items: List<Step>) : AranSection {
        data class Step(val label: String, val time: String?, val state: String)
    }

    data class Table(override val title: String?, val columns: List<String>, val rows: List<List<String>>, val tones: List<List<String>>) : AranSection
    data class Stats(override val title: String?, val items: List<Stat>) : AranSection {
        data class Stat(val label: String, val value: String, val tone: String?)
    }
}

@Immutable
data class AranButton(
    /** link | copy | action */
    val type: String,
    val label: String,
    val style: String?,
    val url: String? = null,
    val text: String? = null,
    val id: String? = null,
    val confirm: String? = null,
    /** ปุ่มเลือกวันเวลา: date | time | datetime · ค่า min/max/initial รูปแบบเดียวกับที่ส่งกลับ */
    val mode: String? = null,
    val min: String? = null,
    val max: String? = null,
    val initial: String? = null,
) {
    /** ปุ่มที่ส่งผลกลับระบบต้นทาง (กดได้เฉพาะการ์ดจากบอท ก่อนปิดรายการ) */
    val isAction: Boolean get() = type == "action" || type == "datetime"
}

@Immutable
data class AranCardStatus(val text: String, val tone: String)

@Immutable
data class AranCard(
    val system: String,
    val topic: String,
    val icon: String,
    val title: String,
    val urgent: Boolean,
    val fields: List<AranField>,
    val lines: List<String>,
    val link: String?,
    val linkLabel: String,
    val ack: Boolean,
    val note: String,
    val color: Long?,
    val level: String? = null,
    val subtitle: String? = null,
    val image: String? = null,
    val sections: List<AranSection> = emptyList(),
    val buttons: List<AranButton> = emptyList(),
    val status: AranCardStatus? = null,
    val closed: Boolean = false,
    /** ข้อความเดิมของการ์ด (ใช้ตอบกลับเมื่อกดปุ่มสั่งงาน) */
    val eventId: String? = null,
) {
    companion object {
        const val CONTENT_KEY = "com.arankub.card"
        const val ACTION_KEY = "com.arankub.card_action"
        const val ACK_KEY = "✅ รับทราบ"
        private val TONES = setOf("crit", "high", "low", "ok", "muted")
        private val LEVELS = setOf("info", "success", "warning", "critical")
        private val STYLES = setOf("primary", "secondary", "danger")
        /** รูปแบบค่าที่ปุ่มเลือกวันเวลาส่งกลับ (ตรงกับ notify/cardkit.mjs DT_MODES) */
        val DT_MODES = mapOf(
            "date" to Regex("^\\d{4}-\\d{2}-\\d{2}$"),
            "time" to Regex("^\\d{2}:\\d{2}$"),
            "datetime" to Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$"),
        )

        /** บอทแจ้งเตือน (@aranchat:<เซิร์ฟเวอร์>) — อ่านการ์ดเฉพาะข้อความจากบอท */
        fun isCardSender(userId: String) = userId.startsWith("@aranchat:")

        /**
         * อ่านการ์ดจาก JSON ของเหตุการณ์ — รูปแบบไม่ถูกต้อง = null (แสดงเป็นข้อความปกติ)
         * @param editedJson การแก้ไขล่าสุด (บอทแก้การ์ดเมื่อมีคนกดปุ่มสั่งงาน: แสดงผล + ซ่อนปุ่ม) — ใช้ m.new_content
         */
        fun fromEventJson(json: String?, editedJson: String? = null): AranCard? = runCatching {
            val event = JSONObject(json ?: return null)
            val edited = editedJson?.let { runCatching { JSONObject(it).optJSONObject("content")?.optJSONObject("m.new_content") }.getOrNull() }
            val c = (edited ?: event.optJSONObject("content"))?.optJSONObject(CONTENT_KEY) ?: return null
            val title = c.str("title", 200).ifEmpty { return null }
            val link = c.str("link", 2000).takeIf { it.startsWith("https://") || it.startsWith("http://") }
            val status = c.optJSONObject("status")
            AranCard(
                system = c.str("system", 60),
                topic = c.str("topic", 80),
                icon = c.str("icon", 8),
                title = title,
                urgent = c.optBoolean("urgent"),
                fields = fields(c.optJSONArray("fields"), 12),
                lines = c.optJSONArray("lines").orEmpty().mapNotNull { (it as? String)?.take(300)?.takeIf(String::isNotBlank) }.take(12),
                link = link,
                linkLabel = c.str("link_label", 40).ifEmpty { "เปิดดู" },
                ack = c.optBoolean("ack"),
                note = c.str("note", 200),
                color = c.str("color", 7).takeIf { Regex("^#[0-9a-fA-F]{6}$").matches(it) }?.let { 0xFF000000 or it.substring(1).toLong(16) },
                level = c.str("level", 10).takeIf { it in LEVELS },
                subtitle = c.str("subtitle", 160).ifEmpty { null },
                image = c.str("image", 300).takeIf { Regex("^mxc://[\\w.:-]+/[\\w-]+$").matches(it) },
                sections = sections(c.optJSONArray("sections")),
                buttons = buttons(c.optJSONArray("buttons")),
                status = status?.str("text", 120)?.takeIf(String::isNotEmpty)?.let { AranCardStatus(it, status.str("tone", 8).takeIf { t -> t in TONES } ?: "ok") },
                closed = c.optBoolean("closed"),
                eventId = event.optString("event_id").ifEmpty { null },
            )
        }.getOrNull()

        private fun tone(v: Any?): String? = (v as? String)?.takeIf { it in TONES }

        private fun fields(a: JSONArray?, max: Int = 16): List<AranField> = a.orEmpty().mapNotNull { f ->
            (f as? JSONArray)?.takeIf { it.length() >= 2 && it.opt(0) is String && it.opt(1) is String }
                ?.let { AranField(it.optString(0).take(40), it.optString(1).take(300), tone(it.opt(2))) }
        }.take(max)

        private fun sections(a: JSONArray?): List<AranSection> = a.orEmpty().take(8).mapNotNull { raw ->
            val x = raw as? JSONObject ?: return@mapNotNull null
            val title = x.str("title", 60).ifEmpty { null }
            when (x.optString("type")) {
                "text" -> x.str("text", 1000).takeIf(String::isNotEmpty)?.let { AranSection.Text(it) }
                "fields" -> fields(x.optJSONArray("items")).takeIf { it.isNotEmpty() }?.let { AranSection.Fields(title, it) }
                "steps" -> x.optJSONArray("items").orEmpty().take(8).mapNotNull { i ->
                    (i as? JSONObject)?.takeIf { it.str("label", 80).isNotEmpty() }?.let {
                        AranSection.Steps.Step(
                            label = it.str("label", 80),
                            time = it.str("time", 30).ifEmpty { null },
                            state = it.optString("state").takeIf { s -> s == "done" || s == "current" } ?: "todo",
                        )
                    }
                }.takeIf { it.isNotEmpty() }?.let { AranSection.Steps(title, it) }
                "table" -> {
                    val cols = x.optJSONArray("columns").orEmpty().take(4).map { (it as? String)?.take(30).orEmpty() }
                    val rows = x.optJSONArray("rows").orEmpty().take(20).mapNotNull { r -> (r as? JSONArray)?.let { row -> cols.indices.map { (row.opt(it) as? String)?.take(60).orEmpty() } } }
                    val tones = x.optJSONArray("tones").orEmpty().take(20).map { r -> cols.indices.map { tone((r as? JSONArray)?.opt(it)).orEmpty() } }
                    if (cols.isNotEmpty() && rows.isNotEmpty()) AranSection.Table(title, cols, rows, tones) else null
                }
                "stats" -> x.optJSONArray("items").orEmpty().take(4).mapNotNull { i ->
                    (i as? JSONObject)?.takeIf { it.str("label", 30).isNotEmpty() && it.str("value", 20).isNotEmpty() }
                        ?.let { AranSection.Stats.Stat(it.str("label", 30), it.str("value", 20), tone(it.opt("tone"))) }
                }.takeIf { it.isNotEmpty() }?.let { AranSection.Stats(title, it) }
                else -> null
            }
        }

        private fun buttons(a: JSONArray?): List<AranButton> = a.orEmpty().take(4).mapNotNull { raw ->
            val b = raw as? JSONObject ?: return@mapNotNull null
            val label = b.str("label", 30).ifEmpty { return@mapNotNull null }
            val style = b.str("style", 10).takeIf { it in STYLES }
            when (b.optString("type")) {
                "link" -> b.str("url", 2000).takeIf { it.startsWith("https://") || it.startsWith("http://") }?.let { AranButton("link", label, style, url = it) }
                "copy" -> b.str("text", 200).takeIf(String::isNotEmpty)?.let { AranButton("copy", label, style, text = it) }
                "action" -> b.str("id", 40).takeIf { Regex("^[\\w.-]{1,40}$").matches(it) }
                    ?.let { AranButton("action", label, style, id = it, confirm = b.str("confirm", 120).ifEmpty { null }) }
                "app" -> b.str("url", 2000).takeIf { it.startsWith("https://") }?.let { AranButton("app", label, style, url = it) }
                "datetime" -> b.str("id", 40).takeIf { Regex("^[\\w.-]{1,40}$").matches(it) }?.let { id ->
                    val mode = b.optString("mode").takeIf { it == "date" || it == "time" } ?: "datetime"
                    val ok = { k: String -> b.str(k, 16).takeIf { DT_MODES.getValue(mode).matches(it) } }
                    AranButton("datetime", label, style, id = id, mode = mode, min = ok("min"), max = ok("max"), initial = ok("initial"))
                }
                else -> null
            }
        }

        private fun JSONObject.str(key: String, max: Int): String = (opt(key) as? String)?.take(max).orEmpty()
        private fun JSONArray?.orEmpty(): List<Any?> = if (this == null) emptyList() else List(length()) { opt(it) }
    }
}
