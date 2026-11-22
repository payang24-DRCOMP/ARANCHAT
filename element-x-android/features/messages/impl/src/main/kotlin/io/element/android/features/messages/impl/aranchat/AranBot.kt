/*
 * AranChat — บอทแจ้งเตือน: คำสั่ง / · เมนูใต้ช่องพิมพ์ · ปุ่มตอบด่วน · มินิแอป (~/aranchat-ess/notify/server.mjs)
 *   รายการคำสั่ง/เมนู: GET https://chat.<เซิร์ฟเวอร์>/api/notify/bot (สาธารณะ ไม่มีข้อมูลส่วนบุคคล)
 *   ใช้เฉพาะห้องที่บอทอยู่ (แชทกับ "ARANKUB AI" / ห้องแจ้งเตือน) — ห้องเหล่านี้ไม่เข้ารหัส บอทจึงอ่านคำสั่งได้
 * ชุดเดียวกับเว็บแชท (element-web: src/aranchat/bot.ts, AranBot.tsx)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.features.messages.impl.aranchat

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.zacsweers.metro.Inject
import io.element.android.compound.theme.ElementTheme
import io.element.android.libraries.designsystem.theme.components.Text
import io.element.android.libraries.matrix.api.MatrixClient
import io.element.android.libraries.matrix.api.core.UserId
import io.element.android.libraries.matrix.api.room.JoinedRoom
import io.element.android.libraries.matrix.api.room.RoomMembershipState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.net.HttpURLConnection
import java.net.URL

@Immutable
data class AranBotCommand(val command: String, val description: String, val usage: String?)

@Immutable
data class AranBotMenuItem(val label: String, val type: String, val text: String?, val url: String?, val prefill: Boolean)

@Immutable
data class AranBotInfo(val commands: List<AranBotCommand>, val menu: List<AranBotMenuItem>)

@Immutable
data class AranQuickReply(val label: String, val text: String, val prefill: Boolean)

const val ARAN_QUICK_REPLIES_KEY = "com.arankub.quick_replies"

/** แคชรายการคำสั่งทั้งแอป (ใช้ตอนกดส่งข้อความ — ไม่ต้องรอเน็ต) */
object AranBotCache {
    @Volatile var info: AranBotInfo? = null
    @Volatile var loadedAt = 0L

    /** "/lab 0012345" เป็นคำสั่งของบอทไหม · ยังโหลดรายการไม่ได้ = คำสั่งพื้นฐาน help / settings */
    fun isBotCommand(text: String): Boolean {
        val name = Regex("^/([a-zA-Z][a-zA-Z0-9_]*)").find(text.trim())?.groupValues?.get(1)?.lowercase() ?: return false
        val names = info?.commands?.map { it.command }?.toSet() ?: setOf("help", "settings")
        return name in names
    }
}

private fun botUserId(room: JoinedRoom) = UserId("@aranchat:${room.sessionId.value.substringAfter(":")}")

/** บอทแจ้งเตือนอยู่ในห้องนี้ไหม (คำสั่ง / เมนูใช้ได้) */
suspend fun JoinedRoom.isAranBotRoom(): Boolean =
    getUpdatedMember(botUserId(this)).getOrNull()?.membership == RoomMembershipState.JOIN

/** ปุ่มตอบด่วนจาก JSON ของข้อความ (content["com.arankub.quick_replies"]) */
fun parseQuickReplies(eventJson: String?): List<AranQuickReply> = runCatching {
    val arr = JSONObject(eventJson ?: return emptyList()).optJSONObject("content")?.optJSONArray(ARAN_QUICK_REPLIES_KEY) ?: return emptyList()
    List(minOf(arr.length(), 6)) { arr.optJSONObject(it) }.mapNotNull { q ->
        val label = q?.optString("label")?.take(24).orEmpty()
        val text = q?.optString("text")?.take(200).orEmpty()
        if (label.isBlank() || text.isBlank()) null else AranQuickReply(label, text, q.optBoolean("prefill"))
    }
}.getOrDefault(emptyList())

val LocalAranBot = staticCompositionLocalOf<AranBot?> { null }

@Inject
class AranBot(
    private val room: JoinedRoom,
    private val client: MatrixClient,
) {
    val botUserId: UserId get() = botUserId(room)

    suspend fun isBotRoom(): Boolean = room.isAranBotRoom()

    /** แชทส่วนตัวกับบอท (สมาชิก 2 คน) — แถบเมนู/ปุ่มตอบด่วนแสดงเฉพาะห้องนี้ (ห้องแจ้งเตือนกลุ่มมีแค่รายงาน) */
    suspend fun isBotDm(): Boolean = isBotRoom() && room.info().joinedMembersCount <= 2

    /** รายการคำสั่ง/เมนู (แคช 60 วินาที) */
    suspend fun info(): AranBotInfo? {
        AranBotCache.info?.takeIf { System.currentTimeMillis() - AranBotCache.loadedAt < 60_000 }?.let { return it }
        return withContext(Dispatchers.IO) {
            runCatching {
                val conn = URL("https://chat.${client.userIdServerName()}/api/notify/bot").openConnection() as HttpURLConnection
                conn.connectTimeout = 8_000
                conn.readTimeout = 8_000
                try {
                    check(conn.responseCode == 200) { "bot ${conn.responseCode}" }
                    parse(JSONObject(conn.inputStream.bufferedReader().use { it.readText() }))
                } finally {
                    conn.disconnect()
                }
            }.onSuccess {
                AranBotCache.info = it
                AranBotCache.loadedAt = System.currentTimeMillis()
            }.onFailure { Timber.w(it, "AranChat: โหลดเมนูบอทไม่ได้") }.getOrNull() ?: AranBotCache.info
        }
    }

    /** ส่งข้อความหาบอท (เมนู / ปุ่มตอบด่วน) */
    suspend fun sendText(text: String): Result<Unit> = runCatching {
        room.sendRawForEventId("m.room.message", JSONObject().put("msgtype", "m.text").put("body", text.trim()).toString()).getOrThrow()
        Unit
    }

    /**
     * ที่อยู่มินิแอป + OpenID token ของผู้ใช้ใน fragment (#aranchat_openid=…&aranchat_server=…)
     * fragment ไม่ถูกส่งไปกับคำขอ HTTP · หน้าเว็บส่ง token ให้ระบบหลังบ้านถาม notify ว่าใครเปิด
     */
    suspend fun miniAppUrl(url: String): Result<String> = runCatching {
        val uri = Uri.parse(url)
        require(uri.scheme == "https") { "มินิแอปต้องเป็น https://" }
        val token = JSONObject(client.requestOpenIdToken().getOrThrow())
        val extra = "aranchat_openid=${Uri.encode(token.getString("access_token"))}&aranchat_server=${Uri.encode(token.getString("matrix_server_name"))}"
        uri.buildUpon().encodedFragment(listOfNotNull(uri.encodedFragment?.takeIf(String::isNotEmpty), extra).joinToString("&")).build().toString()
    }

    private fun parse(o: JSONObject): AranBotInfo {
        val cmds = o.optJSONArray("commands") ?: JSONArray()
        val menu = o.optJSONArray("menu") ?: JSONArray()
        return AranBotInfo(
            commands = List(cmds.length()) { cmds.optJSONObject(it) }.mapNotNull { c ->
                c?.optString("command")?.takeIf { Regex("^[a-z][a-z0-9_]{0,31}$").matches(it) }
                    ?.let { AranBotCommand(it, c.optString("description").take(80), c.optString("usage").ifEmpty { null }) }
            },
            menu = List(minOf(menu.length(), 8)) { menu.optJSONObject(it) }.mapNotNull { m ->
                val label = m?.optString("label")?.take(24).orEmpty()
                if (label.isBlank()) return@mapNotNull null
                AranBotMenuItem(
                    label = label,
                    type = m.optString("type").takeIf { it == "link" || it == "app" } ?: "text",
                    text = m.optString("text").ifEmpty { null },
                    url = m.optString("url").takeIf { it.startsWith("https://") || it.startsWith("http://") },
                    prefill = m.optBoolean("prefill"),
                )
            },
        )
    }
}

/** เปิดมินิแอป (เบราว์เซอร์ในเครื่อง พร้อม token บอกว่าใครเปิด) */
fun openAranMiniApp(bot: AranBot, url: String, scope: kotlinx.coroutines.CoroutineScope, open: (String) -> Unit) {
    scope.launch {
        bot.miniAppUrl(url).onSuccess { runCatching { open(it) } }.onFailure { Timber.w(it, "AranChat: เปิดมินิแอปไม่ได้") }
    }
}

/**
 * แถบเหนือช่องพิมพ์ในห้องบอท: ปุ่มตอบด่วน (จากข้อความล่าสุดของบอท) + เมนูบอท
 * @param quickReplies ปุ่มตอบด่วนของข้อความล่าสุด (ว่าง = ข้อความล่าสุดไม่ใช่ของบอท)
 * @param onPrefill ใส่ข้อความลงช่องพิมพ์ (เมนู/ปุ่มที่ต้องพิมพ์ต่อ เช่น "/lab ")
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AranBotBar(
    quickReplies: List<AranQuickReply>,
    onPrefill: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val bot = LocalAranBot.current ?: return
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current
    var isBotRoom by remember { mutableStateOf(false) }
    var info by remember { mutableStateOf(AranBotCache.info) }
    var open by rememberSaveable { mutableStateOf(true) }
    LaunchedEffect(bot) {
        isBotRoom = bot.isBotDm()
        if (isBotRoom) info = bot.info()
    }
    if (!isBotRoom) return
    val menu = info?.menu.orEmpty()
    if (quickReplies.isEmpty() && menu.isEmpty()) return

    fun run(text: String?, prefill: Boolean) {
        val t = text ?: return
        if (prefill) onPrefill(t) else scope.launch { bot.sendText(t) }
    }

    Column(modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (quickReplies.isNotEmpty()) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                quickReplies.forEach { q ->
                    Text(
                        text = q.label,
                        color = ElementTheme.colors.textActionAccent,
                        style = ElementTheme.typography.fontBodySmMedium.copy(fontWeight = FontWeight.SemiBold),
                        maxLines = 1,
                        modifier = Modifier
                            .border(1.dp, ElementTheme.colors.textActionAccent, RoundedCornerShape(50))
                            .clickable { run(q.text, q.prefill) }
                            .padding(horizontal = 14.dp, vertical = 6.dp),
                    )
                }
            }
        }
        if (menu.isNotEmpty()) {
            Text(
                text = if (open) "▾ ซ่อนเมนู" else "☰ เมนู",
                color = ElementTheme.colors.textSecondary,
                style = ElementTheme.typography.fontBodyXsMedium,
                modifier = Modifier.clickable { open = !open }.padding(horizontal = 4.dp, vertical = 2.dp),
            )
            if (open) {
                FlowRow(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                    maxItemsInEachRow = 3,
                ) {
                    menu.forEach { m ->
                        Text(
                            text = m.label + if (m.type != "text") " ↗" else "",
                            color = ElementTheme.colors.textPrimary,
                            style = ElementTheme.typography.fontBodySmMedium.copy(fontWeight = FontWeight.SemiBold),
                            textAlign = TextAlign.Center,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier
                                .weight(1f)
                                .background(ElementTheme.colors.bgSubtleSecondary, RoundedCornerShape(12.dp))
                                .clickable {
                                    when (m.type) {
                                        "link" -> m.url?.let { runCatching { uriHandler.openUri(it) } }
                                        "app" -> m.url?.let { openAranMiniApp(bot, it, scope) { u -> uriHandler.openUri(u) } }
                                        else -> run(m.text, m.prefill)
                                    }
                                }
                                .padding(horizontal = 8.dp, vertical = 9.dp),
                        )
                    }
                }
            }
        }
    }
}
