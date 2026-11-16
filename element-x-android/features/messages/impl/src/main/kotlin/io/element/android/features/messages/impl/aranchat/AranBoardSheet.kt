/*
 * AranChat — แผง "โน้ต | อัลบั้ม" ของกลุ่ม (เปิดจากเมนู + หรือแตะการ์ดในแชท) และการ์ดในแชท
 * ข้อมูล: AranBoard.kt · หน้าตาชุดเดียวกับเว็บ (src/aranchat/AranBoard.tsx)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.features.messages.impl.aranchat

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import io.element.android.compound.theme.ElementTheme
import io.element.android.libraries.designsystem.theme.components.Button
import io.element.android.libraries.designsystem.theme.components.ButtonSize
import io.element.android.libraries.designsystem.theme.components.CircularProgressIndicator
import io.element.android.libraries.designsystem.theme.components.HorizontalDivider
import io.element.android.libraries.designsystem.theme.components.ModalBottomSheet
import io.element.android.libraries.designsystem.theme.components.OutlinedButton
import io.element.android.libraries.designsystem.theme.components.Text
import io.element.android.libraries.designsystem.theme.components.TextButton
import io.element.android.libraries.designsystem.theme.components.TextField
import io.element.android.libraries.matrixmedia.api.MediaRequestData
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val Brand = Color(0xFF5B3FD9)
private val Ink = Color(0xFF1E1350)
private val Muted = Color(0xFF64748B)
private const val NO_PERMISSION = "ผู้ดูแลกลุ่มยังไม่ได้เปิดให้สมาชิกสร้างโน้ต/อัลบั้ม — ขอให้ผู้ดูแลเปิดหน้านี้ครั้งหนึ่ง ระบบจะเปิดให้อัตโนมัติ"

private sealed interface Screen {
    data object List : Screen
    data class Open(val id: String) : Screen
    data class Edit(val entry: AranBoardEntry?, val initial: String) : Screen
}

private fun day(ts: Long): String = SimpleDateFormat("d MMM yyyy", Locale("th", "TH")).format(Date(ts))

/** แผงโน้ต/อัลบั้ม */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun AranBoardSheet(
    board: AranBoard,
    initialKind: AranBoardKind,
    onDismiss: () -> Unit,
    openId: String? = null,
) {
    val scope = rememberCoroutineScope()
    var kind by remember { mutableStateOf(initialKind) }
    var screen by remember { mutableStateOf<Screen>(openId?.let { Screen.Open(it) } ?: Screen.List) }
    var entries by remember { mutableStateOf<List<AranBoardEntry>?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { runCatching { board.ensurePermission() } }
    LaunchedEffect(kind, reload) { entries = board.entries(kind) }
    // เพิ่งบันทึก: state จาก server อาจยังไม่มา → ลองโหลดซ้ำ
    suspend fun refreshUntil(id: String) {
        repeat(10) {
            val list = board.entries(kind)
            entries = list
            if (list.any { it.id == id }) return
            kotlinx.coroutines.delay(500)
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, scrollable = false) {
        Column(
            Modifier
                .navigationBarsPadding()
                .imePadding()
                .padding(horizontal = 16.dp)
                .heightIn(min = 320.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AranBoardKind.entries.forEach { k ->
                    val selected = k == kind
                    Text(
                        text = if (k == AranBoardKind.NOTE) "📝 โน้ต" else "🖼 อัลบั้ม",
                        style = ElementTheme.typography.fontBodyLgMedium,
                        color = if (selected) Brand else ElementTheme.colors.textSecondary,
                        modifier = Modifier
                            .clickable {
                                kind = k
                                screen = Screen.List
                                error = null
                            }
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                    )
                }
                Spacer(Modifier.weight(1f))
                if (screen == Screen.List) {
                    Button(
                        text = if (kind == AranBoardKind.NOTE) "+ โน้ตใหม่" else "+ อัลบั้มใหม่",
                        size = ButtonSize.Small,
                        onClick = { screen = Screen.Edit(null, "") },
                    )
                }
            }
            HorizontalDivider()
            error?.let { Text(it, color = ElementTheme.colors.textCriticalPrimary, style = ElementTheme.typography.fontBodySmRegular, modifier = Modifier.padding(8.dp)) }

            when (val s = screen) {
                Screen.List -> BoardList(board, kind, entries, onOpen = { screen = Screen.Open(it) })
                is Screen.Open -> {
                    val entry = entries?.firstOrNull { it.id == s.id }
                    when {
                        entry != null && kind == AranBoardKind.NOTE -> NoteDetail(
                            board = board,
                            entry = entry,
                            onBack = { screen = Screen.List },
                            onEdit = { text -> screen = Screen.Edit(entry, text) },
                            onDeleted = {
                                screen = Screen.List
                                reload++
                            },
                        )
                        entry != null -> AlbumDetail(
                            board = board,
                            entry = entry,
                            onBack = { screen = Screen.List },
                            onChanged = { reload++ },
                        )
                        entries == null -> Loading()
                        else -> Empty("กำลังบันทึก…")
                    }
                }
                is Screen.Edit -> if (kind == AranBoardKind.NOTE) {
                    NoteEditor(
                        initial = s.initial,
                        onCancel = { screen = s.entry?.let { Screen.Open(it.id) } ?: Screen.List },
                        onSave = { text ->
                            scope.launch {
                                error = null
                                if (!board.ensurePermission()) {
                                    error = NO_PERMISSION
                                    return@launch
                                }
                                val result = if (s.entry != null) board.editNote(s.entry, text).map { s.entry.id } else board.createNote(text).map { it.id }
                                result.onSuccess { id ->
                                    screen = Screen.Open(id)
                                    refreshUntil(id)
                                }.onFailure { error = "บันทึกไม่สำเร็จ ลองอีกครั้ง" }
                            }
                        },
                    )
                } else {
                    AlbumCreate(
                        onCancel = { screen = Screen.List },
                        onCreate = { name, uris, progress ->
                            scope.launch {
                                error = null
                                if (!board.ensurePermission()) {
                                    error = NO_PERMISSION
                                    return@launch
                                }
                                board.createAlbum(name).onSuccess { entry ->
                                    screen = Screen.Open(entry.id)
                                    refreshUntil(entry.id)
                                    if (uris.isNotEmpty()) {
                                        board.addPhotos(entry, uris) { progress(it) }
                                            .onFailure { error = "ส่งรูปไม่สำเร็จบางรูป" }
                                        reload++
                                    }
                                }.onFailure { error = "สร้างอัลบั้มไม่สำเร็จ ลองอีกครั้ง" }
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun Loading() {
    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

@Composable
private fun Empty(text: String) {
    Text(
        text,
        color = ElementTheme.colors.textSecondary,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp, horizontal = 12.dp),
    )
}

@Composable
private fun BoardList(board: AranBoard, kind: AranBoardKind, entries: List<AranBoardEntry>?, onOpen: (String) -> Unit) {
    when {
        entries == null -> Loading()
        entries.isEmpty() -> Empty(
            if (kind == AranBoardKind.NOTE) {
                "ยังไม่มีโน้ต — เก็บเรื่องสำคัญของกลุ่มไว้ที่นี่ เช่น แนวทางปฏิบัติ เบอร์โทร ตารางเวร ไม่จมหายในแชท"
            } else {
                "ยังไม่มีอัลบั้ม — รวมรูปกิจกรรม/งานของกลุ่มเป็นชุด หาง่ายกว่าเลื่อนในแชท"
            }
        )
        kind == AranBoardKind.NOTE -> LazyColumn(Modifier.heightIn(max = 520.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Spacer(Modifier.padding(2.dp)) }
            items(entries, key = { it.id }) { NoteRow(board, it, onClick = { onOpen(it.id) }) }
        }
        else -> LazyVerticalGrid(
            columns = GridCells.Adaptive(140.dp),
            modifier = Modifier.heightIn(max = 520.dp).padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(entries, key = { it.id }) { AlbumTile(board, it, onClick = { onOpen(it.id) }) }
        }
    }
}

@Composable
private fun rememberText(board: AranBoard, entry: AranBoardEntry): Pair<Boolean, String?> {
    var loaded by remember(entry) { mutableStateOf(false) }
    var text by remember(entry) { mutableStateOf<String?>(null) }
    LaunchedEffect(entry) {
        text = board.text(entry)
        loaded = true
    }
    return loaded to text
}

@Composable
private fun NoteRow(board: AranBoard, entry: AranBoardEntry, onClick: () -> Unit) {
    val (loaded, text) = rememberText(board, entry)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .border(1.dp, ElementTheme.colors.borderInteractiveSecondary, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(start = 0.dp)
    ) {
        Row {
            Box(Modifier.width(4.dp).heightIn(min = 64.dp).background(Color(0xFFF59E0B)))
            Column(Modifier.padding(12.dp)) {
                Text(
                    when {
                        !loaded -> "กำลังโหลด…"
                        text == null -> "🔒 เปิดอ่านไม่ได้"
                        else -> AranBoardRef.noteTitle(text)
                    },
                    style = ElementTheme.typography.fontBodyLgMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                text?.trim()?.lines()?.drop(1)?.joinToString(" ")?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = ElementTheme.typography.fontBodyMdRegular, color = ElementTheme.colors.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text("แก้ล่าสุด ${day(entry.updatedTs)}", style = ElementTheme.typography.fontBodySmRegular, color = ElementTheme.colors.textSecondary)
            }
        }
    }
}

@Composable
private fun NoteDetail(board: AranBoard, entry: AranBoardEntry, onBack: () -> Unit, onEdit: (String) -> Unit, onDeleted: () -> Unit) {
    val scope = rememberCoroutineScope()
    val (loaded, text) = rememberText(board, entry)
    var confirmDelete by remember { mutableStateOf(false) }
    Column(Modifier.verticalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
        TextButton(text = "‹ โน้ตทั้งหมด", size = ButtonSize.Small, onClick = onBack)
        when {
            !loaded -> Loading()
            text == null -> Empty("🔒 เปิดอ่านโน้ตนี้ไม่ได้ — อาจสร้างก่อนคุณเข้ากลุ่ม ขอให้สมาชิกกด \"แก้ไข\" แล้วบันทึกอีกครั้ง")
            else -> SelectionContainer {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFFFFFBEB))
                        .padding(14.dp)
                ) {
                    val lines = text.trim().lines()
                    Text(lines.first(), color = Ink, style = ElementTheme.typography.fontHeadingSmMedium)
                    if (lines.size > 1) Text(lines.drop(1).joinToString("\n"), color = Ink, style = ElementTheme.typography.fontBodyLgRegular)
                }
            }
        }
        Text(
            "สร้าง ${day(entry.createdTs)} · แก้ล่าสุด ${day(entry.updatedTs)}",
            style = ElementTheme.typography.fontBodySmRegular,
            color = ElementTheme.colors.textSecondary,
            modifier = Modifier.padding(top = 8.dp),
        )
        Row(Modifier.padding(vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (text != null) Button(text = "แก้ไข", size = ButtonSize.Medium, onClick = { onEdit(text) })
            Spacer(Modifier.weight(1f))
            if (confirmDelete) {
                Button(text = "ยืนยันลบ", size = ButtonSize.Medium, destructive = true, onClick = {
                    scope.launch { board.remove(entry).onSuccess { onDeleted() } }
                })
            } else {
                TextButton(text = "ลบ", size = ButtonSize.Medium, onClick = { confirmDelete = true })
            }
        }
    }
}

@Composable
private fun NoteEditor(initial: String, onCancel: () -> Unit, onSave: (String) -> Unit) {
    var text by remember { mutableStateOf(initial) }
    var busy by remember { mutableStateOf(false) }
    Column(Modifier.padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        TextField(
            value = text,
            onValueChange = { if (it.length <= 20_000) text = it },
            placeholder = "หัวข้อ (บรรทัดแรก)\nรายละเอียด…",
            modifier = Modifier.fillMaxWidth().heightIn(min = 200.dp, max = 400.dp),
        )
        Text("🔒 โน้ตเข้ารหัสเหมือนข้อความในกลุ่ม สมาชิกทุกคนอ่านและแก้ได้", style = ElementTheme.typography.fontBodySmRegular, color = ElementTheme.colors.textSecondary)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(text = "ยกเลิก", size = ButtonSize.Medium, onClick = onCancel, enabled = !busy)
            Button(
                text = "บันทึก",
                size = ButtonSize.Medium,
                showProgress = busy,
                enabled = !busy && text.isNotBlank(),
                onClick = {
                    busy = true
                    onSave(text)
                },
            )
        }
    }
}

/* ---------- อัลบั้ม ---------- */

@Composable
private fun Thumb(photo: AranAlbumPhoto, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    Box(modifier.aspectRatio(1f).clip(RoundedCornerShape(6.dp)).background(Color(0xFFEDE9FE))) {
        AsyncImage(
            model = MediaRequestData(photo.source, MediaRequestData.Kind.Thumbnail(320, 320)),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        )
        if (photo.isVideo) Text("▶", color = Color.White, style = ElementTheme.typography.fontHeadingMdBold, modifier = Modifier.align(Alignment.Center))
    }
}

@Composable
private fun rememberPhotos(board: AranBoard, entry: AranBoardEntry): List<AranAlbumPhoto>? {
    var photos by remember(entry) { mutableStateOf<List<AranAlbumPhoto>?>(null) }
    LaunchedEffect(entry) { photos = runCatching { board.photos(entry) }.getOrDefault(emptyList()) }
    return photos
}

@Composable
private fun AlbumTile(board: AranBoard, entry: AranBoardEntry, onClick: () -> Unit) {
    val (_, name) = rememberText(board, entry)
    val photos = rememberPhotos(board, entry)
    Column(Modifier.clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(14.dp)).background(Brush.linearGradient(listOf(Color(0xFFEDE9FE), Color(0xFFDDD6FE))))) {
            photos?.firstOrNull()?.let { Thumb(it, Modifier.fillMaxSize()) } ?: Text("🖼", style = ElementTheme.typography.fontHeadingXlBold, modifier = Modifier.align(Alignment.Center))
        }
        Text(name ?: "…", style = ElementTheme.typography.fontBodyMdMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
        Text(photos?.let { "${it.size} รูป" } ?: "…", style = ElementTheme.typography.fontBodySmRegular, color = ElementTheme.colors.textSecondary)
    }
}

@Composable
private fun rememberPicker(onPicked: (List<Pair<Uri, String>>) -> Unit): () -> Unit {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(50)) { uris ->
        onPicked(uris.map { it to (context.contentResolver.getType(it) ?: "image/jpeg") })
    }
    return { launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) }
}

@Composable
private fun AlbumDetail(board: AranBoard, entry: AranBoardEntry, onBack: () -> Unit, onChanged: () -> Unit) {
    val scope = rememberCoroutineScope()
    val (_, name) = rememberText(board, entry)
    var photos by remember(entry) { mutableStateOf<List<AranAlbumPhoto>?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    LaunchedEffect(entry, refresh) { photos = runCatching { board.photos(entry) }.getOrDefault(emptyList()) }
    var progress by remember { mutableStateOf<String?>(null) }
    var viewing by remember { mutableStateOf<AranAlbumPhoto?>(null) }
    var renaming by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    val pick = rememberPicker { uris ->
        if (uris.isEmpty()) return@rememberPicker
        progress = "กำลังส่ง 0/${uris.size}"
        scope.launch {
            board.addPhotos(entry, uris) { progress = "กำลังส่ง $it/${uris.size}" }
                .onSuccess { progress = null }
                .onFailure { progress = "ส่งรูปไม่สำเร็จบางรูป ลองอีกครั้ง" }
            refresh++
            onChanged()
        }
    }

    Column(Modifier.padding(vertical = 8.dp)) {
        TextButton(text = "‹ อัลบั้มทั้งหมด", size = ButtonSize.Small, onClick = onBack)
        val r = renaming
        if (r != null) {
            TextField(value = r, onValueChange = { renaming = it.take(80) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(text = "ยกเลิก", size = ButtonSize.Small, onClick = { renaming = null })
                Button(text = "บันทึกชื่อ", size = ButtonSize.Small, enabled = r.isNotBlank(), onClick = {
                    scope.launch {
                        board.renameAlbum(entry, r)
                        renaming = null
                        onChanged()
                    }
                })
            }
        } else {
            Text(name ?: "…", style = ElementTheme.typography.fontHeadingSmMedium)
        }
        Text(
            "${photos?.size ?: "…"} รูป · ${day(entry.updatedTs)}",
            style = ElementTheme.typography.fontBodySmRegular,
            color = ElementTheme.colors.textSecondary,
        )
        Row(Modifier.padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Button(text = "+ เพิ่มรูป", size = ButtonSize.Small, enabled = progress?.startsWith("กำลัง") != true, onClick = pick)
            OutlinedButton(text = "เปลี่ยนชื่อ", size = ButtonSize.Small, onClick = { renaming = name.orEmpty() })
            Spacer(Modifier.weight(1f))
            if (confirmDelete) {
                Button(text = "ยืนยันลบ", size = ButtonSize.Small, destructive = true, onClick = {
                    scope.launch { board.remove(entry).onSuccess { onBack(); onChanged() } }
                })
            } else {
                TextButton(text = "ลบ", size = ButtonSize.Small, onClick = { confirmDelete = true })
            }
        }
        progress?.let { Text(it, style = ElementTheme.typography.fontBodySmRegular, color = ElementTheme.colors.textSecondary) }
        val list = photos
        when {
            list == null -> Loading()
            list.isEmpty() -> Empty("ยังไม่มีรูป — กด \"+ เพิ่มรูป\"")
            else -> LazyVerticalGrid(
                columns = GridCells.Adaptive(100.dp),
                modifier = Modifier.heightIn(max = 460.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(list, key = { it.eventId?.value ?: it.hashCode().toString() }) { p -> Thumb(p, onClick = { viewing = p }) }
            }
        }
    }
    viewing?.let { PhotoViewer(it, onDismiss = { viewing = null }) }
}

@Composable
private fun PhotoViewer(photo: AranAlbumPhoto, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black).clickable(onClick = onDismiss), contentAlignment = Alignment.Center) {
            AsyncImage(
                model = MediaRequestData(photo.source, MediaRequestData.Kind.File(fileName = "photo.jpg", mimeType = "image/jpeg")),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
            )
            if (photo.isVideo) Text("วิดีโอ — เปิดดูได้ในเธรดของอัลบั้มในแชท", color = Color.White, modifier = Modifier.align(Alignment.BottomCenter).padding(24.dp))
        }
    }
}

@Composable
private fun AlbumCreate(onCancel: () -> Unit, onCreate: (String, List<Pair<Uri, String>>, (Int) -> Unit) -> Unit) {
    var name by remember { mutableStateOf("") }
    var uris by remember { mutableStateOf<List<Pair<Uri, String>>>(emptyList()) }
    var busy by remember { mutableStateOf<String?>(null) }
    val pick = rememberPicker { uris = uris + it }
    Column(Modifier.padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        TextField(
            value = name,
            onValueChange = { name = it.take(80) },
            placeholder = "ชื่ออัลบั้ม เช่น ประชุมวิชาการ พ.ย. 69",
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedButton(text = "+ เลือกรูป" + if (uris.isNotEmpty()) " (${uris.size})" else "", size = ButtonSize.Medium, enabled = busy == null, onClick = pick)
        if (uris.isNotEmpty()) {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(64.dp),
                modifier = Modifier.heightIn(max = 220.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(uris, key = { it.first.toString() }) { (uri, _) ->
                    AsyncImage(model = uri, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.aspectRatio(1f).clip(RoundedCornerShape(6.dp)))
                }
            }
        }
        busy?.let { Text(it, style = ElementTheme.typography.fontBodySmRegular, color = ElementTheme.colors.textSecondary) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(text = "ยกเลิก", size = ButtonSize.Medium, onClick = onCancel, enabled = busy == null)
            Button(
                text = "สร้างอัลบั้ม",
                size = ButtonSize.Medium,
                enabled = busy == null && name.isNotBlank(),
                showProgress = busy != null,
                onClick = {
                    busy = "กำลังสร้างอัลบั้ม…"
                    onCreate(name, uris) { n -> busy = "กำลังส่งรูป $n/${uris.size}" }
                },
            )
        }
    }
}

/* ---------- การ์ดในแชท ---------- */

/** การ์ดโน้ต/อัลบั้มในห้องแชท — แตะ → เปิดแผง (body ในไทม์ไลน์เป็นฉบับแก้ล่าสุดแล้ว) */
@Composable
fun TimelineItemAranBoardView(ref: AranBoardRef, modifier: Modifier = Modifier) {
    val board = LocalAranBoard.current
    var open by remember { mutableStateOf(false) }
    val isNote = ref.kind == AranBoardKind.NOTE
    Column(modifier.width(260.dp).clip(RoundedCornerShape(18.dp)).background(Color.White)) {
        Text(
            text = if (isNote) "📝 โน้ต" else "🖼 อัลบั้ม",
            style = ElementTheme.typography.fontBodySmMedium,
            color = Color.White,
            modifier = Modifier
                .fillMaxWidth()
                .background(Brush.linearGradient(listOf(Color(0xFFF59E0B), Color(0xFFEA580C))))
                .padding(horizontal = 14.dp, vertical = 8.dp),
        )
        Text(
            if (isNote) AranBoardRef.noteTitle(ref.text) else ref.text,
            style = ElementTheme.typography.fontBodyLgMedium,
            color = Ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 4.dp),
        )
        if (isNote) {
            ref.text.trim().lines().drop(1).joinToString("\n").trim().takeIf { it.isNotEmpty() }?.let {
                Text(it, color = Muted, style = ElementTheme.typography.fontBodyMdRegular, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 14.dp))
            }
        }
        Spacer(Modifier.padding(4.dp))
        HorizontalDivider(color = Color(0xFFEEEEEE))
        Text(
            text = if (isNote) "เปิดโน้ต" else "ดูอัลบั้ม",
            style = ElementTheme.typography.fontBodyMdMedium,
            color = Brand,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().clickable(enabled = board != null) { open = true }.padding(12.dp),
        )
    }
    if (open && board != null) {
        AranBoardSheet(board = board, initialKind = ref.kind, openId = ref.id, onDismiss = { open = false })
    }
}
