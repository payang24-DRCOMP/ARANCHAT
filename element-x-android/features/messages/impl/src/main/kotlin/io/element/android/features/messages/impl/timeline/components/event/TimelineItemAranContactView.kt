/*
 * AranChat — การ์ดแนะนำเพื่อนในห้องแชท: รูป + ชื่อ + ปุ่ม "ดูโปรไฟล์ / แชท"
 * แตะ → หน้าโปรไฟล์ของเพื่อนคนนั้นในแอป (มีปุ่มส่งข้อความ) ผ่านลิงก์ภายใน matrix.to (แอปจัดการเอง ไม่เปิดเว็บ)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.features.messages.impl.timeline.components.event

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.element.android.compound.theme.ElementTheme
import io.element.android.features.messages.impl.timeline.model.event.AranContact
import io.element.android.libraries.designsystem.components.avatar.Avatar
import io.element.android.libraries.designsystem.components.avatar.AvatarData
import io.element.android.libraries.designsystem.components.avatar.AvatarSize
import io.element.android.libraries.designsystem.components.avatar.AvatarType
import io.element.android.libraries.designsystem.theme.components.HorizontalDivider
import io.element.android.libraries.designsystem.theme.components.Text

@Composable
fun TimelineItemAranContactView(contact: AranContact, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .width(240.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(Color.White),
    ) {
        Text(
            text = "แนะนำเพื่อน",
            style = ElementTheme.typography.fontBodySmMedium,
            color = Color.White,
            modifier = Modifier
                .fillMaxWidth()
                .background(Brush.linearGradient(listOf(Color(0xFF8B5CF6), Color(0xFF5B3FD9))))
                .padding(horizontal = 14.dp, vertical = 8.dp),
        )
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Avatar(
                avatarData = AvatarData(id = contact.userId, name = contact.name, url = contact.avatarUrl, size = AvatarSize.UserListItem),
                avatarType = AvatarType.User,
                forcedAvatarSize = 48.dp,
            )
            Column {
                Text(contact.name, style = ElementTheme.typography.fontBodyLgMedium, color = Color(0xFF1E1350), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(contact.userId.drop(1).substringBefore(':'), style = ElementTheme.typography.fontBodySmRegular, color = Color(0xFF64748B))
            }
        }
        HorizontalDivider(color = Color(0xFFEEEEEE))
        Text(
            text = "ดูโปรไฟล์ / แชท",
            style = ElementTheme.typography.fontBodyMdMedium,
            color = Color(0xFF5B3FD9),
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(12.dp),
        )
    }
}
