/*
 * AranChat — สติกเกอร์ (หลายชุด + ใช้ล่าสุด + เคลื่อนไหวได้) — ชุดเดียวกับเว็บ (element-web src/aranchat/stickers.ts)
 *
 * ชุดสติกเกอร์มาจาก server: https://chat.<โดเมน>/stickers/index.json (aranchat-ess/scripts/24-stickers.py)
 *   แอดมินเพิ่มชุดใหม่ได้โดยไม่ต้องออกแอปรุ่นใหม่ · โหลดไม่ได้ = ใช้ชุดที่จำไว้ครั้งก่อน หรือชุด "น้องอรัญ" ใน assets
 * ส่งเป็น m.sticker มาตรฐาน Matrix — อัปโหลดรูปครั้งแรกที่ส่ง แล้วจำ mxc ใน account data "com.arankub.stickers"
 *   { mxc: { "<key>@<ขนาดไฟล์>": mxc }, recent: ["<ชุด>/<id>", …] } · key ชุดพื้นฐาน = "<id>" · ชุดอื่น = "<ชุด>/<id>"
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.features.messages.impl.messagecomposer

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import dev.zacsweers.metro.ContributesBinding
import io.element.android.compound.theme.ElementTheme
import io.element.android.libraries.designsystem.theme.components.CircularProgressIndicator
import io.element.android.libraries.designsystem.theme.components.HorizontalDivider
import io.element.android.libraries.designsystem.theme.components.ModalBottomSheet
import io.element.android.libraries.designsystem.theme.components.Text
import io.element.android.libraries.di.SessionScope
import io.element.android.libraries.di.annotations.ApplicationContext
import io.element.android.libraries.matrix.api.MatrixClient
import io.element.android.libraries.matrix.api.core.ThreadId
import io.element.android.libraries.matrix.api.room.JoinedRoom
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

data class AranSticker(
    val packId: String,
    val id: String,
    /** ข้อความบนสติกเกอร์ — ใช้เป็น body (แจ้งเตือน/รายการแชท/ค้นหา) */
    val body: String,
    /** path ใน index (เช่น "aran/ack.png") */
    val file: String,
    /** URL บน server — null = รูปใน assets */
    val url: String?,
    val w: Int,
    val h: Int,
    val size: Long,
    val mime: String,
    val animated: Boolean,
) {
    val ref get() = "$packId/$id"

    /** ให้ coil แสดงในแผง (รูปเคลื่อนไหวเล่นเอง) */
    val imageModel: String get() = url ?: "file:///android_asset/aranchat-stickers/${file.substringAfterLast('/')}"
}

data class AranStickerPackData(
    val id: String,
    val name: String,
    val icon: String,
    val stickers: List<AranSticker>,
)

object AranStickerPack {
    private const val DIR = "aranchat-stickers"
    const val BUILTIN_ID = "aran"

    @Volatile private var cache: List<AranSticker>? = null

    /** ชุดพื้นฐานจาก assets (อ่านครั้งเดียว) — ไม่มีไฟล์ = ไม่แสดงเมนูสติกเกอร์ */
    fun load(context: Context): List<AranSticker> = cache ?: runCatching {
        val json = JSONObject(context.assets.open("$DIR/pack.json").bufferedReader().use { it.readText() })
        val arr = json.getJSONArray("stickers")
        List(arr.length()) { i ->
            val o = arr.getJSONObject(i)
            AranSticker(
                packId = BUILTIN_ID,
                id = o.getString("id"),
                body = o.getString("body"),
                file = o.getString("file"),
                url = null,
                w = o.getInt("w"),
                h = o.getInt("h"),
                size = o.getLong("size"),
                mime = "image/png",
                animated = false,
            )
        }
    }.onFailure { Timber.w(it, "AranChat: อ่านสติกเกอร์ไม่ได้") }.getOrDefault(emptyList()).also { cache = it }

    fun builtinPack(context: Context): AranStickerPackData? = load(context).takeIf { it.isNotEmpty() }?.let {
        AranStickerPackData(BUILTIN_ID, "น้องอรัญ", it.first().imageModel, it)
    }

    fun assetBytes(context: Context, sticker: AranSticker): ByteArray =
        context.assets.open("$DIR/${sticker.file.substringAfterLast('/')}").use { it.readBytes() }

    /** อ่าน index.json จาก server */
    fun parseIndex(json: String, indexUrl: String): List<AranStickerPackData> {
        val base = URL(indexUrl)
        val packs = JSONObject(json).optJSONArray("packs") ?: JSONArray()
        return (0 until packs.length()).mapNotNull { i ->
            val p = packs.getJSONObject(i)
            val id = p.optString("id").takeIf { Regex("^[a-z0-9_-]{1,32}$").matches(it) } ?: return@mapNotNull null
            val arr = p.optJSONArray("stickers") ?: return@mapNotNull null
            val stickers = (0 until arr.length()).map { j ->
                val s = arr.getJSONObject(j)
                val file = s.getString("file")
                AranSticker(
                    packId = id,
                    id = s.getString("id"),
                    body = s.getString("body"),
                    file = file,
                    url = URL(base, file).toString(),
                    w = s.getInt("w"),
                    h = s.getInt("h"),
                    size = s.getLong("size"),
                    mime = s.optString("mime").ifBlank { "image/png" },
                    animated = s.optBoolean("animated"),
                )
            }
            if (stickers.isEmpty()) return@mapNotNull null
            AranStickerPackData(id, p.optString("name").ifBlank { id }, URL(base, p.optString("icon").ifBlank { stickers.first().file }).toString(), stickers)
        }
    }
}

/** ส่งสติกเกอร์เข้าห้อง (อัปโหลดรูปให้ถ้ายังไม่เคย) + รายการชุด/ใช้ล่าสุดสำหรับแผงเลือก */
interface AranStickerSender {
    suspend fun packs(): List<AranStickerPackData>

    suspend fun recent(): List<AranSticker>

    /** @param stickerRef "<ชุด>/<id>" (หรือ "<id>" ของชุดพื้นฐาน — รุ่นเก่า) */
    suspend fun send(room: JoinedRoom, stickerRef: String, threadRoot: ThreadId?): Result<Unit>
}

/** แผงสติกเกอร์ใช้ร่วมกับตัวส่ง (MessagesNode ใส่ให้) */
val LocalAranStickers = staticCompositionLocalOf<AranStickerSender?> { null }

@ContributesBinding(SessionScope::class)
class DefaultAranStickerSender(
    @ApplicationContext private val context: Context,
    private val client: MatrixClient,
) : AranStickerSender {
    private val mutex = Mutex()
    @Volatile private var loaded: List<AranStickerPackData>? = null

    private val indexUrl get() = "https://chat.${client.userIdServerName()}/stickers/index.json"
    private val indexCache get() = File(context.cacheDir, "aranchat-stickers-index.json")

    override suspend fun packs(): List<AranStickerPackData> = mutex.withLock {
        loaded?.let { return it }
        val fromServer = withContext(Dispatchers.IO) {
            runCatching {
                val conn = URL(indexUrl).openConnection() as HttpURLConnection
                conn.connectTimeout = 8_000
                conn.readTimeout = 8_000
                try {
                    check(conn.responseCode == 200) { "stickers ${conn.responseCode}" }
                    conn.inputStream.bufferedReader().use { it.readText() }
                } finally {
                    conn.disconnect()
                }
            }.onSuccess { indexCache.writeText(it) }
                .recoverCatching { indexCache.readText() } // ออฟไลน์: ใช้ชุดที่จำไว้ครั้งก่อน
                .mapCatching { AranStickerPack.parseIndex(it, indexUrl) }
                .onFailure { Timber.w(it, "AranChat: โหลดชุดสติกเกอร์จาก server ไม่ได้") }
                .getOrNull()
        }
        val packs = fromServer?.takeIf { it.isNotEmpty() } ?: listOfNotNull(AranStickerPack.builtinPack(context))
        // ชุดพื้นฐานใช้รูปใน assets (ไม่ต้องโหลดซ้ำ ใช้ได้ทั้งออฟไลน์) — ไฟล์เดียวกับบน server
        val builtin = AranStickerPack.builtinPack(context)
        packs.map { if (it.id == AranStickerPack.BUILTIN_ID && builtin != null) builtin.copy(name = it.name) else it }
            .also { loaded = it }
    }

    override suspend fun recent(): List<AranSticker> {
        val all = packs().flatMap { it.stickers }.associateBy { it.ref }
        return readData().second.mapNotNull { all[it] }
    }

    override suspend fun send(room: JoinedRoom, stickerRef: String, threadRoot: ThreadId?): Result<Unit> = runCatching {
        val ref = if ('/' in stickerRef) stickerRef else "${AranStickerPack.BUILTIN_ID}/$stickerRef"
        val sticker = packs().flatMap { it.stickers }.first { it.ref == ref }
        val mxc = mxcFor(sticker)
        val showW = SHOW_DP
        val info = JSONObject().put("w", showW).put("h", showW * sticker.h / sticker.w).put("mimetype", sticker.mime).put("size", sticker.size)
        if (sticker.animated) info.put("org.matrix.msc4230.is_animated", true)
        val content = JSONObject()
            .put("body", sticker.body)
            .put("url", mxc)
            .put("info", info)
        if (threadRoot != null) {
            content.put(
                "m.relates_to",
                JSONObject()
                    .put("rel_type", "m.thread")
                    .put("event_id", threadRoot.value)
                    .put("is_falling_back", true)
                    .put("m.in_reply_to", JSONObject().put("event_id", threadRoot.value)),
            )
        }
        room.sendRaw("m.sticker", content.toString()).getOrThrow()
        runCatching { remember(sticker) }
    }

    private suspend fun bytes(sticker: AranSticker): ByteArray = withContext(Dispatchers.IO) {
        val url = sticker.url ?: return@withContext AranStickerPack.assetBytes(context, sticker)
        URL(url).openStream().use { it.readBytes() }
    }

    private fun cacheKey(sticker: AranSticker) =
        (if (sticker.packId == AranStickerPack.BUILTIN_ID) sticker.id else sticker.ref) + "@" + sticker.size

    private suspend fun mxcFor(sticker: AranSticker): String {
        val key = cacheKey(sticker)
        readData().first[key]?.let { return it }
        val mxc = client.uploadMedia(sticker.mime, bytes(sticker)).getOrThrow()
        // อ่านซ้ำก่อนเขียน — อีกเครื่องอาจเพิ่มสติกเกอร์อื่นไว้ระหว่างอัปโหลด
        writeData { mxcMap, recent -> (mxcMap + (key to mxc)) to recent }
        return mxc
    }

    private suspend fun remember(sticker: AranSticker) {
        writeData { mxcMap, recent -> mxcMap to (listOf(sticker.ref) + recent.filter { it != sticker.ref }).take(RECENT_MAX) }
    }

    private suspend fun readData(): Pair<Map<String, String>, List<String>> {
        val raw = client.getAccountData(CACHE_TYPE).getOrNull() ?: return emptyMap<String, String>() to emptyList()
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return emptyMap<String, String>() to emptyList()
        val mxc = json.optJSONObject("mxc")?.let { m -> m.keys().asSequence().associateWith { m.getString(it) } }.orEmpty()
        val recent = json.optJSONArray("recent")?.let { a -> (0 until a.length()).map { a.getString(it) } }.orEmpty()
        return mxc to recent
    }

    private suspend fun writeData(change: (Map<String, String>, List<String>) -> Pair<Map<String, String>, List<String>>) {
        val (mxc, recent) = readData()
        val (newMxc, newRecent) = change(mxc, recent)
        if (newMxc == mxc && newRecent == recent) return
        client.setAccountData(CACHE_TYPE, JSONObject().put("mxc", JSONObject(newMxc)).put("recent", JSONArray(newRecent)).toString()).getOrThrow()
    }

    private companion object {
        const val CACHE_TYPE = "com.arankub.stickers"
        const val RECENT_MAX = 16

        /** ขนาดที่แสดงในแชท (ไฟล์จริง 2 เท่า ให้คมบนจอความละเอียดสูง) — ตรงกับเว็บ */
        const val SHOW_DP = 160
    }
}

private const val RECENT_TAB = "__recent"

/** แผงสติกเกอร์ 4 คอลัมน์ + แท็บชุดด้านล่าง (🕘 ใช้ล่าสุด + ชุดต่างๆ) แตะแล้วส่งทันทีแบบ LINE */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AranStickerSheet(
    onStickerClick: (AranSticker) -> Unit,
    onDismiss: () -> Unit,
) {
    val sender = LocalAranStickers.current
    var packs by remember { mutableStateOf<List<AranStickerPackData>?>(null) }
    var recent by remember { mutableStateOf<List<AranSticker>>(emptyList()) }
    var tab by remember { mutableStateOf<String?>(null) }
    val context = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(sender) {
        val p = sender?.packs() ?: listOfNotNull(AranStickerPack.builtinPack(context))
        recent = runCatching { sender?.recent() }.getOrNull().orEmpty()
        packs = p
        if (tab == null) tab = if (recent.isNotEmpty()) RECENT_TAB else p.firstOrNull()?.id
    }
    val current = tab
    val shown = when {
        current == RECENT_TAB -> recent
        else -> packs?.firstOrNull { it.id == current }?.stickers.orEmpty()
    }
    ModalBottomSheet(onDismissRequest = onDismiss, scrollable = true) {
        Column(Modifier.navigationBarsPadding()) {
            Text(
                text = if (current == RECENT_TAB) "ใช้ล่าสุด" else packs?.firstOrNull { it.id == current }?.name ?: "สติกเกอร์",
                style = ElementTheme.typography.fontBodyMdMedium,
                color = ElementTheme.colors.textSecondary,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
            )
            if (packs == null) {
                Box(Modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(4),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 200.dp, max = 380.dp),
                ) {
                    items(shown, key = { it.ref }) { s ->
                        StickerCell(s, onClick = { onStickerClick(s) })
                    }
                }
                HorizontalDivider()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(ElementTheme.colors.bgSubtleSecondary)
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    if (recent.isNotEmpty()) {
                        StickerTab(selected = current == RECENT_TAB, label = "ใช้ล่าสุด", onClick = { tab = RECENT_TAB }) {
                            Text("🕘", style = ElementTheme.typography.fontHeadingSmRegular)
                        }
                    }
                    packs.orEmpty().forEach { p ->
                        StickerTab(selected = current == p.id, label = p.name, onClick = { tab = p.id }) {
                            AsyncImage(model = p.icon, contentDescription = null, modifier = Modifier.size(32.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StickerTab(selected: Boolean, label: String, onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(
        Modifier
            .width(48.dp)
            .height(42.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) ElementTheme.colors.bgCanvasDefault else androidx.compose.ui.graphics.Color.Transparent)
            .clickable(onClick = onClick)
            .alpha(if (selected) 1f else 0.6f)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { content() }
}

@Composable
private fun StickerCell(sticker: AranSticker, onClick: () -> Unit) {
    AsyncImage(
        model = sticker.imageModel,
        contentDescription = null,
        contentScale = ContentScale.Fit,
        modifier = Modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(4.dp)
            .semantics { contentDescription = "ส่งสติกเกอร์ ${sticker.body}" },
    )
}
