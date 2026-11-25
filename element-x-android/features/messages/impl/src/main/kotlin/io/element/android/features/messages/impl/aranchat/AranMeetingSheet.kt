/*
 * AranChat — หน้า "จดประชุม" (เปิดจากเมนู + ในห้องแชท): ตั้งชื่อ/เปิดข้อความสด → เริ่ม · ระหว่างประชุมเห็นข้อความสด เวลา ระดับเสียง
 *   ปิดหน้านี้ได้ การบันทึกยังทำต่อ (แจ้งเตือนค้าง) · กด + → จดประชุม อีกครั้งเพื่อกลับมาดู — AranMeeting.kt
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.features.messages.impl.aranchat

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.element.android.compound.theme.ElementTheme
import io.element.android.libraries.designsystem.theme.components.Button
import io.element.android.libraries.designsystem.theme.components.ButtonSize
import io.element.android.libraries.designsystem.theme.components.ModalBottomSheet
import io.element.android.libraries.designsystem.theme.components.OutlinedButton
import io.element.android.libraries.designsystem.theme.components.Switch
import io.element.android.libraries.designsystem.theme.components.Text
import io.element.android.libraries.designsystem.theme.components.TextField
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.sqrt

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun AranMeetingSheet(bot: AranBot, onDismiss: () -> Unit) {
    val ui by AranMeeting.ui.collectAsState()
    val roomName by produceState<String?>(null) { value = runCatching { bot.groupName() }.getOrNull() }
    ModalBottomSheet(onDismissRequest = onDismiss, scrollable = false) {
        Column(
            Modifier.padding(horizontal = 16.dp, vertical = 8.dp).navigationBarsPadding().imePadding(),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            when (ui.phase) {
                AranMeetingPhase.IDLE -> key(roomName) { Setup(bot, roomName) }
                else -> Live(ui, onDismiss)
            }
        }
    }
}

@Composable
private fun Setup(bot: AranBot, roomName: String?) {
    val context = LocalContext.current
    val date = remember { SimpleDateFormat("d MMM yy", Locale("th", "TH")).format(Date()) }
    var title by remember { mutableStateOf(if (roomName != null) "ประชุม $roomName $date" else "ประชุม $date") }
    var captions by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    val begin = {
        AranMeeting.start(context, bot.meetingLiveUrl(), title.trim().ifBlank { "ประชุม $date" }, captions) { bot.openIdToken() }
    }
    val perms = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.RECORD_AUDIO] == true) begin() else error = "ต้องอนุญาตไมค์ก่อนจึงจะจดประชุมได้"
    }
    Text("🎙 จดประชุม", style = ElementTheme.typography.fontHeadingSmMedium)
    Text(
        "ระบบฟังเสียงประชุม ถอดเป็นข้อความ แล้วส่งบทถอดเสียงเต็ม + สรุปการประชุม (ประเด็น · มติ · งานที่มอบหมาย) " +
            "เข้าแชท ARANKUB AI ของคุณหลังจบ — ประมวลผลบนเครื่องของ รพ.",
        style = ElementTheme.typography.fontBodyMdRegular, color = ElementTheme.colors.textSecondary,
    )
    TextField(value = title, onValueChange = { if (it.length <= 120) title = it }, label = "ชื่อการประชุม", singleLine = true, modifier = Modifier.fillMaxWidth())
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("แสดงข้อความสดระหว่างประชุม", style = ElementTheme.typography.fontBodyMdMedium)
            Text("ปิดได้ถ้าต้องการแค่บันทึกแล้วสรุปทีหลัง", style = ElementTheme.typography.fontBodySmRegular, color = ElementTheme.colors.textSecondary)
        }
        Switch(checked = captions, onCheckedChange = { captions = it })
    }
    Text(
        "วางเครื่องใกล้ผู้พูด · ปิดจอหรือสลับแอปได้ระหว่างประชุม\n" +
            "ประชุม Zoom/Teams: ใช้แอป AranChat บนคอม (Windows) → เสียงจากเครื่อง + ไมค์\n" +
            "⚠️ แจ้งผู้เข้าประชุมว่ากำลังบันทึก · หลีกเลี่ยงการเอ่ยชื่อ/เลขประจำตัวผู้ป่วย · เสียงลบทิ้งเมื่อถอดเสร็จ",
        style = ElementTheme.typography.fontBodySmRegular, color = ElementTheme.colors.textSecondary,
    )
    error?.let { Text(it, color = ElementTheme.colors.textCriticalPrimary, style = ElementTheme.typography.fontBodySmRegular) }
    Button(text = "เริ่มจดประชุม", size = ButtonSize.Medium, modifier = Modifier.fillMaxWidth(), onClick = {
        val want = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        perms.launch(want.toTypedArray())
    })
    Spacer(Modifier.height(8.dp))
}

@Composable
private fun Live(ui: AranMeetingUi, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var confirm by remember { mutableStateOf(false) }
    val list = rememberLazyListState()
    LaunchedEffect(ui.lines.size, ui.partial) { if (ui.lines.isNotEmpty()) list.scrollToItem(maxOf(0, ui.lines.size)) }
    val recording = ui.phase == AranMeetingPhase.RECORDING || ui.phase == AranMeetingPhase.STARTING
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(10.dp).background(if (recording && !ui.paused) Color(0xFFE5484D) else ElementTheme.colors.iconTertiary, CircleShape))
        Text(ui.title, style = ElementTheme.typography.fontBodyLgMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Text("%d:%02d".format(ui.seconds / 60, ui.seconds % 60), color = ElementTheme.colors.textSecondary)
    }
    if (recording) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val bars = minOf(10, (sqrt(ui.level.toDouble()) * 25).toInt())
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.Bottom) {
                repeat(10) { i ->
                    Box(
                        Modifier.width(3.dp).height(if (i < 3) 4.dp else if (i < 6) 8.dp else 12.dp)
                            .background(if (i < bars) Color(0xFF2E9D5C) else ElementTheme.colors.bgSubtlePrimary, RoundedCornerShape(1.dp)),
                    )
                }
            }
            val status = when {
                ui.phase == AranMeetingPhase.STARTING -> "กำลังเชื่อมต่อ…"
                !ui.online -> "เน็ตหลุด — เก็บเสียงไว้ในเครื่อง กำลังต่อใหม่…"
                ui.paused -> "พักการบันทึก"
                ui.captions == false -> "บันทึกเสียงอย่างเดียว"
                else -> "กำลังฟัง"
            }
            Text(status, style = ElementTheme.typography.fontBodySmRegular, color = if (!ui.online) ElementTheme.colors.textCriticalPrimary else ElementTheme.colors.textSecondary)
        }
        if (ui.captions != false) {
            LazyColumn(
                state = list,
                modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp, max = 320.dp)
                    .background(ElementTheme.colors.bgSubtleSecondary, RoundedCornerShape(10.dp)).padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (ui.lines.isEmpty() && ui.partial.isEmpty()) {
                    item { Text("ข้อความจะขึ้นที่นี่เมื่อมีคนพูด…", color = ElementTheme.colors.textSecondary) }
                }
                items(ui.lines) { Text(it, style = ElementTheme.typography.fontBodyMdRegular) }
                if (ui.partial.isNotEmpty()) item { Text(ui.partial, color = ElementTheme.colors.textSecondary, fontStyle = FontStyle.Italic) }
            }
        }
    }
    ui.note?.let { Text(it, style = ElementTheme.typography.fontBodySmRegular, color = ElementTheme.colors.textSecondary) }
    when (ui.phase) {
        AranMeetingPhase.STARTING, AranMeetingPhase.RECORDING -> {
            if (confirm) {
                Text("จบการประชุมและส่งไปถอดเสียง + สรุป?", style = ElementTheme.typography.fontBodyMdMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(text = "ยังไม่จบ", size = ButtonSize.Medium, modifier = Modifier.weight(1f), onClick = { confirm = false })
                    Button(text = "จบประชุม", size = ButtonSize.Medium, destructive = true, modifier = Modifier.weight(1f), onClick = {
                        confirm = false
                        AranMeeting.stop(context)
                    })
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        text = if (ui.paused) "▶ บันทึกต่อ" else "⏸ พัก", size = ButtonSize.Medium, modifier = Modifier.weight(1f),
                        onClick = { AranMeeting.setPaused(context, !ui.paused) },
                    )
                    Button(text = "⏹ จบประชุม", size = ButtonSize.Medium, destructive = true, modifier = Modifier.weight(1f), onClick = { confirm = true })
                }
                Text("ปิดหน้านี้ได้ การบันทึกยังทำต่อ (ดูที่แถบแจ้งเตือน)", style = ElementTheme.typography.fontBodySmRegular, color = ElementTheme.colors.textSecondary)
            }
        }
        AranMeetingPhase.ENDING -> Text("กำลังส่งเสียงที่เหลือ…", color = ElementTheme.colors.textSecondary)
        AranMeetingPhase.DONE, AranMeetingPhase.FAILED -> Button(text = "ปิด", size = ButtonSize.Medium, modifier = Modifier.fillMaxWidth(), onClick = {
            AranMeeting.reset()
            onDismiss()
        })
        AranMeetingPhase.IDLE -> Unit
    }
    Spacer(Modifier.height(8.dp))
}
