/*
 * AranChat — ส่งข้อมูลติดต่อเพื่อน (การ์ดแนะนำเพื่อนแบบ LINE) — รูปแบบเดียวกับเว็บ (src/aranchat/AranContact.tsx)
 *   ปุ่ม + → เพื่อน → เลือกเพื่อน → ส่ง m.text ที่มี "com.arankub.contact": { user_id, name, avatar_url }
 *   ห้องเข้ารหัส: ทั้งข้อความถูกเข้ารหัส (sendRaw ของ Rust SDK เข้ารหัสให้)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.features.messages.impl.messagecomposer

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.zacsweers.metro.ContributesBinding
import io.element.android.compound.theme.ElementTheme
import io.element.android.libraries.designsystem.theme.components.CircularProgressIndicator
import io.element.android.libraries.designsystem.theme.components.ModalBottomSheet
import io.element.android.libraries.designsystem.theme.components.SearchField
import io.element.android.libraries.designsystem.theme.components.Text
import io.element.android.libraries.di.SessionScope
import io.element.android.libraries.matrix.api.MatrixClient
import io.element.android.libraries.matrix.api.core.RoomAlias
import io.element.android.libraries.matrix.api.core.ThreadId
import io.element.android.libraries.matrix.api.core.UserId
import io.element.android.libraries.matrix.api.room.JoinedRoom
import io.element.android.libraries.matrix.api.room.RoomMembershipState
import io.element.android.libraries.matrix.api.room.roomMembers
import io.element.android.libraries.matrix.api.user.MatrixUser
import io.element.android.libraries.matrix.ui.components.MatrixUserRow
import kotlinx.coroutines.flow.first
import org.json.JSONObject
import java.text.Collator
import java.util.Locale

interface AranContacts {
    /** เพื่อนทั้งหมด (ห้องรวมเจ้าหน้าที่) ยกเว้นตัวเอง บอท และคนที่อยู่ในห้องนี้แล้ว */
    suspend fun friends(room: JoinedRoom): List<MatrixUser>

    suspend fun send(room: JoinedRoom, user: MatrixUser, threadRoot: ThreadId?): Result<Unit>
}

@ContributesBinding(SessionScope::class)
class DefaultAranContacts(
    private val client: MatrixClient,
) : AranContacts {
    override suspend fun friends(room: JoinedRoom): List<MatrixUser> {
        val here = room.membersStateFlow.value.roomMembers().orEmpty().map { it.userId }.toSet()
        val staffId = client.resolveRoomAlias(RoomAlias("#staff:${client.userIdServerName()}")).getOrNull()?.orElse(null)?.roomId
        val staff = staffId?.let { client.getJoinedRoom(it) } ?: return emptyList()
        runCatching { staff.updateMembers() }
        val members = staff.membersStateFlow.first { it.roomMembers() != null }.roomMembers().orEmpty()
        val collator = Collator.getInstance(Locale("th"))
        return members
            .filter { it.membership == RoomMembershipState.JOIN && it.userId != client.sessionId && it.userId !in here && !it.userId.value.startsWith("@aranchat:") }
            .map { MatrixUser(userId = it.userId, displayName = it.displayName, avatarUrl = it.avatarUrl) }
            .sortedWith { a, b -> collator.compare(a.displayName ?: a.userId.value, b.displayName ?: b.userId.value) }
    }

    override suspend fun send(room: JoinedRoom, user: MatrixUser, threadRoot: ThreadId?): Result<Unit> = runCatching {
        val name = user.displayName?.takeIf { it.isNotBlank() } ?: user.userId.value
        val contact = JSONObject().put("user_id", user.userId.value).put("name", name)
        user.avatarUrl?.let { contact.put("avatar_url", it) }
        val content = JSONObject()
            .put("msgtype", "m.text")
            .put("body", "👤 แนะนำเพื่อน: $name\nhttps://chat.${client.userIdServerName()}/#/user/${user.userId.value}")
            .put(CONTACT_KEY, contact)
        if (threadRoot != null) {
            content.put(
                "m.relates_to",
                JSONObject().put("rel_type", "m.thread").put("event_id", threadRoot.value).put("is_falling_back", true)
                    .put("m.in_reply_to", JSONObject().put("event_id", threadRoot.value)),
            )
        }
        room.sendRaw("m.room.message", content.toString()).getOrThrow()
    }

    companion object {
        const val CONTACT_KEY = "com.arankub.contact"
    }
}

/** แผงเลือกเพื่อน — friends = null ระหว่างโหลด */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AranContactSheet(
    friends: List<MatrixUser>?,
    onPick: (MatrixUser) -> Unit,
    onDismiss: () -> Unit,
) {
    val search = rememberTextFieldState()
    val q = search.text.toString().trim()
    val shown = remember(friends, q) {
        friends.orEmpty().filter { q.isEmpty() || (it.displayName ?: "").contains(q, true) || it.userId.value.contains(q, true) }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, scrollable = true) {
        Column(Modifier.navigationBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("ส่งข้อมูลติดต่อเพื่อน", style = ElementTheme.typography.fontHeadingSmMedium)
            Text(
                "เลือกเพื่อนที่จะแนะนำให้คนในแชทนี้",
                style = ElementTheme.typography.fontBodySmRegular,
                color = ElementTheme.colors.textSecondary,
                modifier = Modifier.padding(bottom = 4.dp),
            )
            SearchField(state = search, placeholder = "ค้นหาชื่อเพื่อน", modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp))
            if (friends == null) {
                CircularProgressIndicator(Modifier.padding(24.dp))
            } else {
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 460.dp)) {
                    items(shown, key = { it.userId.value }) { user ->
                        MatrixUserRow(matrixUser = user, modifier = Modifier.clickable { onPick(user) })
                    }
                    if (shown.isEmpty()) {
                        item { Text(if (q.isEmpty()) "ยังไม่มีรายชื่อเพื่อน" else "ไม่พบ \"$q\"", modifier = Modifier.padding(24.dp)) }
                    }
                }
            }
        }
    }
}

