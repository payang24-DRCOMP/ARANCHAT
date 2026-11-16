/*
 * AranChat — การ์ดแจ้งเตือนแบบ LINE (Flex Message) ในหน้าแชท
 *   หัวสีตามระดับ (ด่วน/วิกฤต = แดง · เตือน = ส้ม · สำเร็จ = เขียว · ข้อมูล = น้ำเงิน) · รูปใหญ่ · ช่องข้อมูลมีโทนสี
 *   · ส่วนเนื้อหา: ข้อความ / ช่องข้อมูล / ขั้นตอน / ตาราง / ตัวเลขสรุป · ปุ่มแบบเม็ดยา: เปิดลิงก์ / คัดลอก / สั่งงาน / รับทราบ
 *   · ผลการตัดสิน (บอทแก้การ์ดเมื่อมีคนกดปุ่มสั่งงาน แล้วซ่อนปุ่ม)
 * หน้าตาเดียวกับเว็บแชท (element-web: src/aranchat/AranCardBody.tsx) — การ์ดพื้นขาวทั้งธีมสว่าง/มืด
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.features.messages.impl.timeline.components.event

import android.content.ClipData
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.toClipEntry
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.element.android.compound.theme.ElementTheme
import io.element.android.features.messages.impl.aranchat.LocalAranBot
import io.element.android.features.messages.impl.aranchat.LocalAranCardSender
import io.element.android.features.messages.impl.aranchat.openAranMiniApp
import io.element.android.features.messages.impl.timeline.model.AggregatedReaction
import io.element.android.features.messages.impl.timeline.model.event.AranButton
import io.element.android.features.messages.impl.timeline.model.event.AranCard
import io.element.android.features.messages.impl.timeline.model.event.AranCardStatus
import io.element.android.features.messages.impl.timeline.model.event.AranField
import io.element.android.features.messages.impl.timeline.model.event.AranSection
import io.element.android.libraries.designsystem.preview.ElementPreview
import io.element.android.libraries.designsystem.preview.PreviewsDayNight
import io.element.android.libraries.designsystem.theme.components.HorizontalDivider
import io.element.android.libraries.designsystem.theme.components.Text
import io.element.android.libraries.matrix.api.media.MediaSource
import io.element.android.libraries.matrixmedia.api.MediaRequestData
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** ข้อมูลจากแถวข้อความ (reaction ของข้อความนั้น + ฟังก์ชันกด reaction) — TimelineItemEventRow ตั้งค่า */
@Immutable
data class AranCardActions(
    val reactions: List<AggregatedReaction> = emptyList(),
    val onToggleReaction: (String) -> Unit = {},
)

val LocalAranCardActions = staticCompositionLocalOf { AranCardActions() }

private val Brand = Color(0xFF5B3FD9)
private val Crit = Color(0xFFDC2626)
private val High = Color(0xFFC2410C)
private val Low = Color(0xFF1D4ED8)
private val Ink = Color(0xFF1E1B4B)
private val Muted = Color(0xFF6B6684)
private val Line = Color(0xFFECE8F6)
private val Tint = Color(0xFFF4F1FC)
private val Ok = Color(0xFF0E7A55)

private fun heroBrush(card: AranCard): Brush {
    val level = if (card.urgent) "critical" else card.level
    return when (level) {
        "critical" -> Brush.linearGradient(listOf(Color(0xFFB91C1C), Color(0xFFEF4444)))
        "warning" -> Brush.linearGradient(listOf(Color(0xFFB45309), Color(0xFFF59E0B)))
        "success" -> Brush.linearGradient(listOf(Color(0xFF0E7A55), Color(0xFF16A34A)))
        "info" -> Brush.linearGradient(listOf(Color(0xFF1D4ED8), Color(0xFF3B82F6)))
        else -> Brush.linearGradient(listOf(card.color?.let(::Color) ?: Brand, card.color?.let(::Color) ?: Brand))
    }
}

private fun toneColor(tone: String?, default: Color = Ink): Color = when (tone) {
    "crit" -> Crit
    "high" -> High
    "low" -> Low
    "ok" -> Ok
    "muted" -> Muted
    else -> default
}

private fun toneMark(tone: String?) = when (tone) {
    "crit" -> " ‼"
    "high" -> " ↑"
    "low" -> " ↓"
    else -> ""
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TimelineItemAranCardView(
    card: AranCard,
    modifier: Modifier = Modifier,
) {
    val actions = LocalAranCardActions.current
    val sender = LocalAranCardSender.current
    val uriHandler = LocalUriHandler.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val acks = actions.reactions.firstOrNull { it.key == AranCard.ACK_KEY }
    var sending by remember { mutableStateOf(false) }
    var pending by remember(card.eventId) { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<AranButton?>(null) }
    val acked = acks?.isHighlighted == true || sending
    val names = acks?.senders?.map { it.user?.displayName ?: it.senderId.value }.orEmpty()
    val icon = if (card.urgent && card.icon == "🔴") "" else card.icon
    val head = listOf(card.system, card.topic).filter(String::isNotEmpty).joinToString(" · ")
    // ปุ่มสั่งงาน/รับทราบกดได้เฉพาะการ์ดจากบอท (TimelineItemContentFactory อ่านการ์ดเฉพาะข้อความจากบอทอยู่แล้ว)
    val live = sender != null && card.eventId != null
    val buttons = card.buttons.filter { !it.isAction || (live && !card.closed) }
    val bot = LocalAranBot.current
    val context = LocalContext.current
    val critical = card.urgent || card.level == "critical"

    // บอทแก้การ์ดเป็น "ปิดแล้ว" → ล้างสถานะกำลังส่ง · ไม่มีคำตอบใน 20 วินาที → กดใหม่ได้
    LaunchedEffect(pending, card.closed) {
        if (pending != null) {
            if (card.closed) pending = null else { delay(20_000); pending = null }
        }
    }

    fun runAction(b: AranButton, value: String? = null) {
        val eventId = card.eventId ?: return
        if (sender == null || pending != null) return
        pending = b.id
        scope.launch { sender.sendAction(eventId, b.id.orEmpty(), b.label, value).onFailure { pending = null } }
    }

    Column(modifier.widthIn(max = 340.dp).width(320.dp).background(Color.White)) {
        Column(
            Modifier.fillMaxWidth().background(heroBrush(card)).padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (card.urgent) {
                    Text(
                        text = "ด่วน",
                        color = Crit,
                        style = ElementTheme.typography.fontBodyXsMedium.copy(fontWeight = FontWeight.Bold),
                        modifier = Modifier
                            .padding(end = 6.dp)
                            .background(Color.White, RoundedCornerShape(50))
                            .padding(horizontal = 8.dp),
                    )
                }
                Text(
                    text = listOf(icon, head).filter(String::isNotEmpty).joinToString(" "),
                    color = Color.White.copy(alpha = 0.92f),
                    style = ElementTheme.typography.fontBodySmMedium,
                )
            }
            Text(text = card.title, color = Color.White, style = ElementTheme.typography.fontBodyLgMedium.copy(fontWeight = FontWeight.Bold))
            card.subtitle?.let { Text(text = it, color = Color.White.copy(alpha = 0.9f), style = ElementTheme.typography.fontBodySmRegular) }
        }
        card.image?.let { mxc ->
            AsyncImage(
                model = MediaRequestData(MediaSource(mxc), MediaRequestData.Kind.Thumbnail(640, 360)),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp, max = 200.dp).background(Tint),
            )
        }
        if (card.fields.isNotEmpty() || card.lines.isNotEmpty() || card.sections.isNotEmpty()) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (card.fields.isNotEmpty()) Fields(card.fields)
                card.lines.forEach { Text(text = it, color = Ink, style = ElementTheme.typography.fontBodyMdRegular) }
                card.sections.forEachIndexed { i, s ->
                    if (i > 0 || card.fields.isNotEmpty() || card.lines.isNotEmpty()) HorizontalDivider(color = Line)
                    Section(s)
                }
            }
        }
        card.status?.let { StatusBanner(it, card.closed) }
        if (names.isNotEmpty()) {
            Text(
                text = "✅ รับทราบแล้ว: ${names.joinToString(", ")}",
                color = Ok,
                style = ElementTheme.typography.fontBodySmRegular,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 10.dp),
            )
        }
        val showAck = card.ack && live
        if (buttons.isNotEmpty() || card.link != null || showAck) {
            FlowRow(
                Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                maxItemsInEachRow = 2,
            ) {
                // 2 ปุ่มต่อแถว · ปุ่มที่เหลือเศษกว้างเต็มแถว (weight ในแถวที่มีปุ่มเดียว)
                @Composable
                fun pill(text: String, style: String, enabled: Boolean = true, onClick: () -> Unit) =
                    Pill(text, style, critical, enabled, Modifier.weight(1f), onClick)
                buttons.forEach { b ->
                    when (b.type) {
                        "link" -> pill(b.label, b.style ?: "secondary") { b.url?.let { runCatching { uriHandler.openUri(it) } } }
                        "app" -> pill("${b.label} ↗", b.style ?: "secondary") {
                            val url = b.url ?: return@pill
                            if (bot != null) openAranMiniApp(bot, url, scope) { u -> uriHandler.openUri(u) } else runCatching { uriHandler.openUri(url) }
                        }
                        "datetime" -> pill(if (pending == b.id) "กำลังส่ง…" else "📅 ${b.label}", b.style ?: "primary", enabled = pending == null) {
                            pickAranDateTime(context, b) { value -> runAction(b, value) }
                        }
                        "copy" -> pill(if (copied == b.label) "คัดลอกแล้ว ✓" else b.label, b.style ?: "secondary") {
                            scope.launch {
                                clipboard.setClipEntry(ClipData.newPlainText(b.label, b.text.orEmpty()).toClipEntry())
                                copied = b.label
                                delay(1500)
                                copied = null
                            }
                        }
                        else -> pill(if (pending == b.id) "กำลังส่ง…" else b.label, b.style ?: "primary", enabled = pending == null) {
                            if (b.confirm != null) confirm = b else runAction(b)
                        }
                    }
                }
                card.link?.let { link -> pill(card.linkLabel, "secondary") { runCatching { uriHandler.openUri(link) } } }
                if (showAck) {
                    pill(if (acked) "รับทราบแล้ว ✓" else "รับทราบ", if (acked) "done" else "primary", enabled = !acked) {
                        sending = true
                        actions.onToggleReaction(AranCard.ACK_KEY)
                    }
                }
            }
        }
        if (card.note.isNotEmpty()) {
            HorizontalDivider(color = Line)
            Text(
                text = card.note,
                color = Muted,
                style = ElementTheme.typography.fontBodyXsRegular,
                modifier = Modifier.fillMaxWidth().background(Color(0xFFFAF9FD)).padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
    }

    confirm?.let { b ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(b.label) },
            text = { Text(b.confirm.orEmpty()) },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    runAction(b)
                }) { Text(b.label, color = if (b.style == "danger") Crit else Brand) }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("ยกเลิก") } },
        )
    }
}

/** ตัวเลือกวันเวลาของเครื่อง (date → time ตามโหมด) · ค่า "2026-11-20" / "18:30" / "2026-11-20T18:30" */
private fun pickAranDateTime(context: android.content.Context, b: AranButton, onPicked: (String) -> Unit) {
    val now = java.util.Calendar.getInstance()
    val init = b.initial ?: b.min
    val (y, mo, d) = init?.takeIf { it.length >= 10 }?.substring(0, 10)?.split("-")?.map(String::toInt)
        ?: listOf(now.get(java.util.Calendar.YEAR), now.get(java.util.Calendar.MONTH) + 1, now.get(java.util.Calendar.DAY_OF_MONTH))
    fun pickTime(date: String?) {
        val t = init?.substringAfter("T", init)?.takeIf { Regex("^\\d{2}:\\d{2}$").matches(it) }?.split(":")?.map(String::toInt)
        android.app.TimePickerDialog(context, { _, h, m ->
            val time = "%02d:%02d".format(h, m)
            val value = if (date != null) "${date}T$time" else time
            if ((b.min == null || value >= b.min) && (b.max == null || value <= b.max)) onPicked(value)
        }, t?.get(0) ?: now.get(java.util.Calendar.HOUR_OF_DAY), t?.get(1) ?: 0, true).show()
    }
    if (b.mode == "time") return pickTime(null)
    val dialog = android.app.DatePickerDialog(context, { _, yy, mm, dd ->
        val date = "%04d-%02d-%02d".format(yy, mm + 1, dd)
        if (b.mode == "date") {
            if ((b.min == null || date >= b.min) && (b.max == null || date <= b.max)) onPicked(date)
        } else {
            pickTime(date)
        }
    }, y, mo - 1, d)
    fun millis(v: String?) = v?.takeIf { it.length >= 10 }?.let { java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).parse(it.substring(0, 10))?.time }
    millis(b.min)?.let { dialog.datePicker.minDate = it }
    millis(b.max)?.let { dialog.datePicker.maxDate = it }
    dialog.show()
}

@Composable
private fun Fields(items: List<AranField>) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        items.forEach { f ->
            Row {
                Text(text = f.label, color = Muted, style = ElementTheme.typography.fontBodyMdRegular, modifier = Modifier.width(104.dp))
                Text(
                    text = f.value + toneMark(f.tone),
                    color = toneColor(f.tone),
                    style = if (f.tone == "crit" || f.tone == "high" || f.tone == "low") {
                        ElementTheme.typography.fontBodyMdMedium.copy(fontWeight = FontWeight.Bold)
                    } else {
                        ElementTheme.typography.fontBodyMdMedium
                    },
                )
            }
        }
    }
}

@Composable
private fun SectionTitle(title: String?) {
    title?.let { Text(text = it, color = Muted, style = ElementTheme.typography.fontBodyXsMedium.copy(fontWeight = FontWeight.Bold)) }
}

@Composable
private fun Section(s: AranSection) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        SectionTitle(s.title)
        when (s) {
            is AranSection.Text -> Text(text = s.text, color = Ink, style = ElementTheme.typography.fontBodyMdRegular)
            is AranSection.Fields -> Fields(s.items)
            is AranSection.Steps -> Column {
                s.items.forEachIndexed { i, step ->
                    Row(verticalAlignment = Alignment.Top) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(14.dp)) {
                            val dot = Modifier.padding(top = 4.dp).size(14.dp).clip(CircleShape)
                            when (step.state) {
                                "done" -> Box(dot.background(Ok))
                                "current" -> Box(dot.background(Color.White).border(4.dp, Brand, CircleShape))
                                else -> Box(dot.background(Line))
                            }
                            if (i < s.items.lastIndex) {
                                Box(Modifier.width(2.dp).heightIn(min = 14.dp).background(if (step.state == "done") Ok else Line))
                            }
                        }
                        Spacer(Modifier.width(10.dp))
                        Text(
                            text = step.label,
                            color = if (step.state == "todo") Muted else Ink,
                            style = if (step.state == "current") {
                                ElementTheme.typography.fontBodyMdMedium.copy(fontWeight = FontWeight.Bold)
                            } else {
                                ElementTheme.typography.fontBodyMdRegular
                            },
                            modifier = Modifier.weight(1f),
                        )
                        step.time?.let { Text(text = it, color = Muted, style = ElementTheme.typography.fontBodySmRegular) }
                    }
                }
            }
            is AranSection.Table -> Column {
                Row(Modifier.padding(bottom = 4.dp)) {
                    s.columns.forEach { Text(text = it, color = Muted, style = ElementTheme.typography.fontBodySmMedium, modifier = Modifier.weight(1f)) }
                }
                HorizontalDivider(color = Line)
                s.rows.forEachIndexed { ri, row ->
                    Row(Modifier.padding(vertical = 5.dp)) {
                        row.forEachIndexed { ci, cell ->
                            val tone = s.tones.getOrNull(ri)?.getOrNull(ci)?.ifEmpty { null }
                            Text(
                                text = cell,
                                color = toneColor(tone),
                                style = if (tone == "crit" || tone == "high" || tone == "low") {
                                    ElementTheme.typography.fontBodyMdMedium.copy(fontWeight = FontWeight.Bold)
                                } else {
                                    ElementTheme.typography.fontBodyMdRegular
                                },
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                    if (ri < s.rows.lastIndex) HorizontalDivider(color = Line)
                }
            }
            is AranSection.Stats -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                s.items.forEach { stat ->
                    Column(
                        Modifier.weight(1f).background(Tint, RoundedCornerShape(12.dp)).padding(vertical = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(text = stat.value, color = toneColor(stat.tone), style = ElementTheme.typography.fontHeadingSmMedium.copy(fontWeight = FontWeight.Bold))
                        Text(text = stat.label, color = Muted, style = ElementTheme.typography.fontBodyXsRegular)
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusBanner(status: AranCardStatus, closed: Boolean) {
    val bg = when (status.tone) {
        "ok" -> Ok.copy(alpha = 0.1f)
        "crit" -> Crit.copy(alpha = 0.1f)
        else -> Tint
    }
    Text(
        text = (if (closed) "✔ " else "") + status.text,
        color = toneColor(status.tone),
        style = ElementTheme.typography.fontBodyMdMedium.copy(fontWeight = FontWeight.SemiBold),
        modifier = Modifier
            .padding(start = 16.dp, end = 16.dp, bottom = 10.dp)
            .fillMaxWidth()
            .background(bg, RoundedCornerShape(10.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
    )
}

@Composable
private fun Pill(text: String, style: String, critical: Boolean, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val primary = if (critical) Crit else Brand
    val (bg, fg) = when (style) {
        "primary" -> primary to Color.White
        "danger" -> Color.White to Crit
        "done" -> Ok.copy(alpha = 0.1f) to Ok
        else -> Tint to Brand
    }
    Text(
        text = text,
        color = fg,
        style = ElementTheme.typography.fontBodyMdMedium.copy(fontWeight = FontWeight.SemiBold),
        textAlign = TextAlign.Center,
        modifier = modifier
            .clip(RoundedCornerShape(50))
            .background(bg)
            .let { if (style == "danger") it.border(1.dp, Crit, RoundedCornerShape(50)) else it }
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
    )
}

@PreviewsDayNight
@Composable
internal fun TimelineItemAranCardViewPreview() = ElementPreview {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TimelineItemAranCardView(
            card = AranCard(
                system = "HOSxP", topic = "ค่าวิกฤตแล็บ", icon = "🔴", title = "ค่าวิกฤต Potassium 2.4 mmol/L", urgent = true,
                fields = listOf(AranField("HN", "0012345"), AranField("หน่วยงาน", "ER · อายุรกรรม")),
                lines = emptyList(), link = null, linkLabel = "", ack = true, note = "", color = null,
                subtitle = "ต่ำกว่าเกณฑ์วิกฤต — โทรแจ้งแพทย์ภายใน 15 นาที",
                sections = listOf(
                    AranSection.Table(
                        "ผลแล็บชุดนี้", listOf("รายการ", "ผล", "ช่วงปกติ"),
                        listOf(listOf("Potassium", "2.4", "3.5–5.1"), listOf("Creatinine", "1.9", "0.6–1.2")),
                        listOf(listOf("", "crit", ""), listOf("", "high", "")),
                    ),
                ),
                buttons = listOf(AranButton("copy", "คัดลอก HN", null, text = "0012345"), AranButton("link", "เปิดใน AranKub", null, url = "https://arankub.com/")),
            ),
        )
        TimelineItemAranCardView(
            card = AranCard(
                system = "AranKub", topic = "ใบลา", icon = "📝", title = "ขออนุมัติลาพักผ่อน 3 วัน", urgent = false,
                fields = listOf(AranField("วันที่", "20–22 พ.ย. 2569")), lines = emptyList(), link = null, linkLabel = "", ack = false, note = "", color = null,
                level = "warning", status = AranCardStatus("อนุมัติแล้ว โดย สมชาย ใจดี", "ok"), closed = true,
                sections = listOf(
                    AranSection.Steps(
                        null,
                        listOf(AranSection.Steps.Step("ยื่นใบลา", "09:00", "done"), AranSection.Steps.Step("หัวหน้าอนุมัติ", null, "current")),
                    ),
                ),
            ),
        )
    }
}
