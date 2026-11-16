/*
 * AranChat — แท็บ "เพื่อน" แบบ LINE: รายชื่อเจ้าหน้าที่ทั้งหมด แตะชื่อแล้วเข้าแชทส่วนตัว (มีอยู่แล้วเปิดห้องเดิม ไม่มีสร้างใหม่)
 *   รายชื่อ = สมาชิก "ห้องรวมเจ้าหน้าที่" (#staff:<เซิร์ฟเวอร์> — ผู้ใช้ทุกคนเข้าอัตโนมัติ ดู values/synapse.yaml.tpl ใน aranchat-ess)
 *   ชุดเดียวกับหน้าเพื่อนในเว็บแชท (element-web: src/aranchat/AranChatFriends.tsx)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.features.home.impl.friends

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import android.content.Intent
import io.element.android.compound.tokens.generated.CompoundIcons
import io.element.android.libraries.designsystem.theme.components.Button
import io.element.android.libraries.designsystem.theme.components.IconSource
import io.element.android.compound.theme.ElementTheme
import io.element.android.libraries.designsystem.theme.components.CircularProgressIndicator
import io.element.android.libraries.designsystem.theme.components.SearchField
import io.element.android.libraries.designsystem.theme.components.Text
import io.element.android.libraries.matrix.api.MatrixClient
import io.element.android.libraries.matrix.ui.aranchat.aranInviteText
import io.element.android.libraries.matrix.ui.aranchat.createAranInvite
import io.element.android.libraries.matrix.api.core.RoomAlias
import io.element.android.libraries.matrix.api.core.RoomId
import io.element.android.libraries.matrix.api.core.UserId
import io.element.android.libraries.matrix.api.room.RoomMembershipState
import io.element.android.libraries.matrix.api.room.roomMembers
import io.element.android.libraries.matrix.api.user.MatrixUser
import io.element.android.libraries.matrix.ui.components.MatrixUserRow
import kotlinx.collections.immutable.ImmutableList
import kotlinx.collections.immutable.persistentListOf
import kotlinx.collections.immutable.toImmutableList
import kotlinx.coroutines.launch
import timber.log.Timber
import java.text.Collator
import java.util.Locale

data class AranFriendsState(
    val friends: ImmutableList<MatrixUser>,
    val loading: Boolean,
    /** ห้องแชทที่ต้องเปิด (แตะชื่อเพื่อนแล้วหา/สร้างห้องเสร็จ) — HomeView เปิดแล้วเรียก [onRoomOpened] */
    val roomToOpen: RoomId?,
    val opening: UserId?,
    val onFriendClick: (UserId) -> Unit,
    val onRoomOpened: () -> Unit,
    /** ชวนเพื่อน: กำลังขอลิงก์จาก server */
    val inviting: Boolean = false,
    /** ข้อความพร้อมลิงก์ที่ต้องเปิดหน้าแชร์ของเครื่อง (LINE ฯลฯ) — View เปิดแล้วเรียก [onInviteShared] */
    val inviteText: String? = null,
    val inviteError: Boolean = false,
    val onInviteClick: () -> Unit = {},
    val onInviteShared: () -> Unit = {},
)

@Composable
fun presentAranFriends(client: MatrixClient): AranFriendsState {
    val scope = rememberCoroutineScope()
    var friends by remember { mutableStateOf<ImmutableList<MatrixUser>>(persistentListOf()) }
    var loading by remember { mutableStateOf(true) }
    var roomToOpen by remember { mutableStateOf<RoomId?>(null) }
    var opening by remember { mutableStateOf<UserId?>(null) }
    var inviting by remember { mutableStateOf(false) }
    var inviteText by remember { mutableStateOf<String?>(null) }
    var inviteError by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        val me = client.sessionId
        val alias = RoomAlias("#staff:${client.userIdServerName()}")
        val roomId = client.resolveRoomAlias(alias).getOrNull()?.orElse(null)?.roomId
        val room = roomId?.let { client.getJoinedRoom(it) }
        if (room == null) {
            loading = false
            return@LaunchedEffect
        }
        runCatching { room.updateMembers() }.onFailure { Timber.w(it, "AranChat: โหลดรายชื่อเพื่อนไม่สำเร็จ") }
        val collator = Collator.getInstance(Locale("th"))
        room.membersStateFlow.collect { state ->
            val members = state.roomMembers() ?: return@collect
            friends = members
                .filter { it.membership == RoomMembershipState.JOIN && it.userId != me && !it.userId.value.startsWith("@aranchat:") }
                .map { MatrixUser(userId = it.userId, displayName = it.displayName, avatarUrl = it.avatarUrl) }
                .sortedWith { a, b -> collator.compare(a.displayName ?: a.userId.value, b.displayName ?: b.userId.value) }
                .toImmutableList()
            loading = false
        }
    }

    return AranFriendsState(
        friends = friends,
        loading = loading,
        roomToOpen = roomToOpen,
        opening = opening,
        onFriendClick = { userId ->
            if (opening == null) {
                opening = userId
                scope.launch {
                    val existing = client.findDM(userId).getOrNull()
                    val room = existing ?: client.createDM(userId, isEncrypted = true).getOrNull()
                    opening = null
                    roomToOpen = room
                }
            }
        },
        onRoomOpened = { roomToOpen = null },
        inviting = inviting,
        inviteText = inviteText,
        inviteError = inviteError,
        onInviteClick = {
            if (!inviting) {
                inviting = true
                inviteError = false
                scope.launch {
                    client.createAranInvite()
                        .onSuccess { inviteText = aranInviteText(client.userProfile.value.displayName, it.url) }
                        .onFailure {
                            Timber.w(it, "AranChat: สร้างลิงก์ชวนไม่สำเร็จ")
                            inviteError = true
                        }
                    inviting = false
                }
            }
        },
        onInviteShared = { inviteText = null },
    )
}

@Composable
fun AranFriendsView(
    state: AranFriendsState,
    onRoomClick: (RoomId) -> Unit,
    contentPadding: PaddingValues,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    LaunchedEffect(state.inviteText) {
        state.inviteText?.let { text ->
            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
            context.startActivity(Intent.createChooser(send, "ชวนเพื่อนมาใช้ AranChat"))
            state.onInviteShared()
        }
    }
    LaunchedEffect(state.roomToOpen) {
        state.roomToOpen?.let {
            onRoomClick(it)
            state.onRoomOpened()
        }
    }
    val search = rememberTextFieldState()
    val query = search.text.toString()
    val shown = remember(state.friends, query) {
        val q = query.trim()
        if (q.isEmpty()) state.friends else state.friends.filter { (it.displayName ?: "").contains(q, ignoreCase = true) || it.userId.value.contains(q, true) }
    }
    if (state.loading) {
        Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    LazyColumn(modifier = modifier.fillMaxSize(), contentPadding = contentPadding, verticalArrangement = Arrangement.spacedBy(0.dp)) {
        item {
            SearchField(
                state = search,
                placeholder = "ค้นหาชื่อเพื่อน",
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        item {
            // ชวนเพื่อน: แชร์ลิงก์ผ่าน LINE/แอปอื่น — เพื่อนเปิดแล้วเข้าแชทกับเราทันที
            Button(
                text = if (state.inviteError) "ลองอีกครั้ง — ชวนเพื่อนมาใช้ AranChat" else "ชวนเพื่อนมาใช้ AranChat",
                onClick = state.onInviteClick,
                showProgress = state.inviting,
                leadingIcon = IconSource.Vector(CompoundIcons.ShareAndroid()),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        item {
            Text(
                text = "เจ้าหน้าที่ทั้งหมด ${state.friends.size} คน · แตะชื่อเพื่อเริ่มแชท",
                style = ElementTheme.typography.fontBodySmRegular,
                color = ElementTheme.colors.textSecondary,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        items(shown, key = { it.userId.value }) { user ->
            MatrixUserRow(
                matrixUser = user,
                modifier = Modifier.clickable(enabled = state.opening == null) { state.onFriendClick(user.userId) },
                trailingContent = if (state.opening == user.userId) {
                    { CircularProgressIndicator(modifier = Modifier.padding(end = 16.dp)) }
                } else {
                    null
                },
            )
        }
        if (shown.isEmpty()) {
            item {
                Text(
                    text = if (query.isBlank()) "ยังไม่มีรายชื่อ" else "ไม่พบ \"$query\"",
                    color = ElementTheme.colors.textSecondary,
                    modifier = Modifier.padding(16.dp),
                )
            }
        }
    }
}
