/*
 * AranChat — โน้ตและอัลบั้มในกลุ่ม (แบบ LINE) · ข้อมูล
 * รูปแบบเดียวกับเว็บทุกอย่าง (element-web src/aranchat/groupBoard.ts):
 *   โน้ต   = m.text body "📝 โน้ต\n<ข้อความ>"   + "com.arankub.note":  { id } · แก้ไข = m.replace (body เต็ม)
 *   อัลบั้ม = m.text body "🖼 อัลบั้ม: <ชื่อ>"    + "com.arankub.album": { id } · รูป = ส่งในเธรดของข้อความนี้
 *   รายการ = state event (type เดียวกัน, state_key = รหัส) { event_id, created_by, created_ts, updated_ts } · ลบ = {}
 * เนื้อหาอยู่ในข้อความ → ห้องเข้ารหัสก็เข้ารหัส · state มีแค่ id/เวลา
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.features.messages.impl.aranchat

import android.net.Uri
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import dev.zacsweers.metro.Inject
import io.element.android.libraries.matrix.api.core.EventId
import io.element.android.libraries.matrix.api.core.ThreadId
import io.element.android.libraries.matrix.api.core.UserId
import io.element.android.libraries.matrix.api.media.MediaSource
import io.element.android.libraries.matrix.api.room.CreateTimelineParams
import io.element.android.libraries.matrix.api.room.JoinedRoom
import io.element.android.libraries.matrix.api.timeline.MatrixTimelineItem
import io.element.android.libraries.matrix.api.timeline.Timeline
import io.element.android.libraries.matrix.api.timeline.item.event.EventOrTransactionId
import io.element.android.libraries.matrix.api.timeline.item.event.ImageMessageType
import io.element.android.libraries.matrix.api.timeline.item.event.MessageContent
import io.element.android.libraries.matrix.api.timeline.item.event.VideoMessageType
import io.element.android.libraries.mediaupload.api.MediaOptimizationConfigProvider
import io.element.android.libraries.mediaupload.api.MediaSenderFactory
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.security.SecureRandom

enum class AranBoardKind(val type: String) {
    NOTE("com.arankub.note"),
    ALBUM("com.arankub.album"),
}

@Immutable
data class AranBoardEntry(
    val kind: AranBoardKind,
    val id: String,
    val eventId: EventId,
    val createdBy: UserId,
    val createdTs: Long,
    val updatedTs: Long,
)

@Immutable
data class AranAlbumPhoto(
    val eventId: EventId?,
    val source: MediaSource,
    val isVideo: Boolean,
    val width: Long?,
    val height: Long?,
)

/** การ์ดในแชท: อ่านจาก body (ไม่ต้องอ่าน JSON — แต่ใช้ id จาก JSON ถ้ามี) */
@Immutable
data class AranBoardRef(
    val kind: AranBoardKind,
    val id: String?,
    /** โน้ต: ข้อความทั้งหมด · อัลบั้ม: ชื่อ */
    val text: String,
) {
    companion object {
        const val NOTE_PREFIX = "📝 โน้ต\n"
        const val ALBUM_PREFIX = "🖼 อัลบั้ม: "
        private val ID = Regex("^[\\w-]{4,40}$")

        fun isCandidate(body: String) = body.startsWith(NOTE_PREFIX) || body.startsWith(ALBUM_PREFIX)

        fun parse(body: String, eventJson: String?): AranBoardRef? {
            val kind = when {
                body.startsWith(NOTE_PREFIX) -> AranBoardKind.NOTE
                body.startsWith(ALBUM_PREFIX) -> AranBoardKind.ALBUM
                else -> return null
            }
            val id = runCatching {
                JSONObject(eventJson ?: return@runCatching null).optJSONObject("content")
                    ?.optJSONObject(kind.type)?.optString("id")?.takeIf { ID.matches(it) }
            }.getOrNull()
            // ต้องมีรหัส (ข้อความที่พิมพ์ "📝 โน้ต" เองไม่กลายเป็นการ์ด)
            if (id == null) return null
            return AranBoardRef(kind, id, textOf(kind, body))
        }

        fun textOf(kind: AranBoardKind, body: String): String = when (kind) {
            AranBoardKind.NOTE -> body.removePrefix(NOTE_PREFIX)
            AranBoardKind.ALBUM -> body.removePrefix(ALBUM_PREFIX).lineSequence().firstOrNull().orEmpty().ifBlank { "อัลบั้ม" }
        }

        fun noteTitle(text: String) = text.trim().lineSequence().firstOrNull()?.take(80)?.ifBlank { null } ?: "โน้ต"
    }
}

/** ให้การ์ดในแชทและเมนู + ใช้ร่วมกัน (MessagesNode ใส่ให้) */
val LocalAranBoard = staticCompositionLocalOf<AranBoard?> { null }

@Inject
class AranBoard(
    private val room: JoinedRoom,
    private val mediaSenderFactory: MediaSenderFactory,
    private val mediaOptimizationConfigProvider: MediaOptimizationConfigProvider,
) {
    val me: UserId get() = room.sessionId

    suspend fun entries(kind: AranBoardKind): List<AranBoardEntry> =
        room.rawStateEvents(kind.type).getOrDefault(emptyList()).mapNotNull { ev ->
            runCatching {
                val c = JSONObject(ev.contentJson)
                val eventId = c.optString("event_id").takeIf { it.startsWith("$") } ?: return@runCatching null
                AranBoardEntry(
                    kind = kind,
                    id = ev.stateKey,
                    eventId = EventId(eventId),
                    createdBy = c.optString("created_by").takeIf { it.startsWith("@") }?.let(::UserId) ?: ev.sender,
                    createdTs = c.optLong("created_ts").takeIf { it > 0 } ?: ev.timestamp,
                    updatedTs = c.optLong("updated_ts").takeIf { it > 0 } ?: ev.timestamp,
                )
            }.getOrNull()
        }.sortedByDescending { it.updatedTs }

    suspend fun entry(kind: AranBoardKind, id: String): AranBoardEntry? = entries(kind).firstOrNull { it.id == id }

    /** ข้อความล่าสุด (โน้ต: ข้อความ · อัลบั้ม: ชื่อ) — null = อ่านไม่ได้ (เข้ากลุ่มทีหลัง/ถูกลบ) */
    suspend fun text(entry: AranBoardEntry): String? =
        room.latestMessageBody(entry.eventId).getOrNull()?.let { AranBoardRef.textOf(entry.kind, it) }

    /**
     * สิทธิ์สร้าง/แก้ — ปกติ state event ต้องเป็นผู้ดูแล → ผู้ดูแลเปิดให้สมาชิกทุกคน (0) อัตโนมัติ
     * @return true = ใช้ได้
     */
    suspend fun ensurePermission(): Boolean {
        val pl = room.rawStateEvents("m.room.power_levels").getOrNull()?.firstOrNull()?.let { JSONObject(it.contentJson) } ?: JSONObject()
        val create = room.rawStateEvents("m.room.create").getOrNull()?.firstOrNull()
        val creators = buildSet {
            create?.sender?.let(::add)
            runCatching {
                val extra = JSONObject(create!!.contentJson).optJSONArray("additional_creators")
                for (i in 0 until (extra?.length() ?: 0)) add(UserId(extra!!.getString(i)))
            }
        }
        val isV12Creator = creators.contains(me) && !(pl.optJSONObject("users")?.has(me.value) ?: false)
        val myLevel = if (isV12Creator) Long.MAX_VALUE else pl.optJSONObject("users")?.optLong(me.value, pl.optLong("users_default", 0)) ?: pl.optLong("users_default", 0)
        val stateDefault = pl.optLong("state_default", 50)
        val events = pl.optJSONObject("events") ?: JSONObject()
        fun need(type: String) = if (events.has(type)) events.optLong(type) else stateDefault
        val open = AranBoardKind.entries.all { events.has(it.type) && events.optLong(it.type) == 0L }
        if (open || AranBoardKind.entries.all { myLevel >= need(it.type) } && myLevel < need("m.room.power_levels")) {
            return AranBoardKind.entries.all { myLevel >= need(it.type) }
        }
        if (myLevel < need("m.room.power_levels")) return false
        AranBoardKind.entries.forEach { events.put(it.type, 0) }
        pl.put("events", events)
        return room.sendStateEventRaw("m.room.power_levels", "", pl.toString()).isSuccess
    }

    private fun newId(): String {
        val alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
        val rnd = SecureRandom()
        return (1..9).map { alphabet[rnd.nextInt(alphabet.length)] }.joinToString("")
    }

    private fun message(kind: AranBoardKind, id: String, body: String) =
        JSONObject().put("msgtype", "m.text").put("body", body).put(kind.type, JSONObject().put("id", id))

    private suspend fun putIndex(kind: AranBoardKind, id: String, eventId: EventId, old: AranBoardEntry?): Result<Unit> {
        val now = System.currentTimeMillis()
        val content = JSONObject()
            .put("event_id", eventId.value)
            .put("created_by", (old?.createdBy ?: me).value)
            .put("created_ts", old?.createdTs ?: now)
            .put("updated_ts", now)
        return room.sendStateEventRaw(kind.type, id, content.toString())
    }

    private suspend fun create(kind: AranBoardKind, body: String): Result<AranBoardEntry> = runCatching {
        val id = newId()
        val eventId = room.sendRawForEventId("m.room.message", message(kind, id, body).toString()).getOrThrow()
        putIndex(kind, id, eventId, null).getOrThrow()
        val now = System.currentTimeMillis()
        AranBoardEntry(kind, id, eventId, me, now, now)
    }

    private suspend fun replace(entry: AranBoardEntry, body: String): Result<Unit> = runCatching {
        val content = message(entry.kind, entry.id, body)
        val edit = JSONObject(content.toString())
            .put("m.new_content", content)
            .put("m.relates_to", JSONObject().put("rel_type", "m.replace").put("event_id", entry.eventId.value))
        room.sendRawForEventId("m.room.message", edit.toString()).getOrThrow()
        putIndex(entry.kind, entry.id, entry.eventId, entry).getOrThrow()
    }

    suspend fun createNote(text: String) = create(AranBoardKind.NOTE, AranBoardRef.NOTE_PREFIX + text.trim())

    suspend fun editNote(entry: AranBoardEntry, text: String) = replace(entry, AranBoardRef.NOTE_PREFIX + text.trim())

    suspend fun createAlbum(name: String) = create(AranBoardKind.ALBUM, AranBoardRef.ALBUM_PREFIX + name.trim())

    suspend fun renameAlbum(entry: AranBoardEntry, name: String) = replace(entry, AranBoardRef.ALBUM_PREFIX + name.trim())

    /** ลบออกจากรายการ + ลบข้อความต้นฉบับ (ถ้ามีสิทธิ์) */
    suspend fun remove(entry: AranBoardEntry): Result<Unit> = runCatching {
        room.sendStateEventRaw(entry.kind.type, entry.id, "{}").getOrThrow()
        room.liveTimeline.redactEvent(EventOrTransactionId.Event(entry.eventId), null)
    }

    /** ส่งรูป/วิดีโอเข้าอัลบั้ม (เธรด) ทีละรูปตามลำดับ — ย่อ/เข้ารหัสแบบเดียวกับส่งรูปปกติ */
    suspend fun addPhotos(entry: AranBoardEntry, uris: List<Pair<Uri, String>>, onProgress: (Int) -> Unit): Result<Unit> = runCatching {
        val sender = mediaSenderFactory.create(Timeline.Mode.Thread(ThreadId(entry.eventId.value)))
        val config = mediaOptimizationConfigProvider.get()
        try {
            uris.forEachIndexed { i, (uri, mime) ->
                sender.sendMedia(uri = uri, mimeType = mime, mediaOptimizationConfig = config).getOrThrow()
                onProgress(i + 1)
            }
        } finally {
            sender.cleanUp()
        }
        putIndex(entry.kind, entry.id, entry.eventId, entry).getOrThrow()
    }

    /** รูปในอัลบั้ม (ใหม่สุดก่อน) จากไทม์ไลน์ของเธรด */
    suspend fun photos(entry: AranBoardEntry, max: Int = 300): List<AranAlbumPhoto> {
        val timeline = room.createTimeline(CreateTimelineParams.Threaded(ThreadId(entry.eventId.value))).getOrNull() ?: return emptyList()
        return timeline.use { tl ->
            for (i in 0 until 10) {
                if (!tl.backwardPaginationStatus.value.hasMoreToLoad) break
                // true = ถึงต้นเธรดแล้ว
                if (tl.paginate(Timeline.PaginationDirection.BACKWARDS).getOrNull() != false) break
            }
            val items = withTimeoutOrNull(5_000) { tl.timelineItems.first { list -> list.any { it is MatrixTimelineItem.Event } } }.orEmpty()
            items.mapNotNull { item ->
                val ev = (item as? MatrixTimelineItem.Event)?.event ?: return@mapNotNull null
                when (val t = (ev.content as? MessageContent)?.type) {
                    is ImageMessageType -> AranAlbumPhoto(ev.eventId, t.source, false, t.info?.width, t.info?.height)
                    is VideoMessageType -> AranAlbumPhoto(ev.eventId, t.info?.thumbnailSource ?: t.source, true, t.info?.width, t.info?.height)
                    else -> null
                }
            }.reversed().take(max)
        }
    }
}
