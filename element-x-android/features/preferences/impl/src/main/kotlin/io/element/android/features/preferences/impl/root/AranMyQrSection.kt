/*
 * AranChat — "QR โค้ดของฉัน" บนหน้าตั้งค่า (โปรไฟล์) แบบ LINE: ให้เพื่อนสแกน หรือแชร์ลิงก์ทาง LINE/แอปอื่น
 * เพื่อนเปิดลิงก์ → ล็อกอินด้วย AranKub → เข้าแชทกับเราทันที (aranchat-ess/notify/invites.mjs)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.features.preferences.impl.root

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import io.element.android.libraries.designsystem.components.list.ListItemContent
import io.element.android.libraries.designsystem.theme.components.ListItem
import io.element.android.libraries.designsystem.theme.components.ModalBottomSheet
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.element.android.compound.theme.ElementTheme
import io.element.android.compound.tokens.generated.CompoundIcons
import io.element.android.libraries.designsystem.theme.components.Button
import io.element.android.libraries.designsystem.theme.components.ButtonSize
import io.element.android.libraries.designsystem.theme.components.CircularProgressIndicator
import io.element.android.libraries.designsystem.theme.components.IconSource
import io.element.android.libraries.designsystem.theme.components.OutlinedButton
import io.element.android.libraries.designsystem.theme.components.Text
import io.element.android.libraries.matrix.ui.aranchat.AranInvite
import io.element.android.libraries.matrix.ui.aranchat.aranInviteText
import io.element.android.libraries.qrcode.QrCodeImage

/** แถว "QR โค้ดของฉัน" ใต้โปรไฟล์ — แตะแล้วขึ้นแผง QR จากด้านล่าง */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AranMyQrRow(invite: AranInvite?, myName: String?) {
    var open by remember { mutableStateOf(false) }
    ListItem(
        leadingContent = ListItemContent.Icon(IconSource.Vector(CompoundIcons.QrCode())),
        supportingContent = { Text("ให้เพื่อนสแกนหรือส่งลิงก์ เพื่อเริ่มแชทกับคุณ") },
        onClick = { open = true },
        content = { Text("QR โค้ดของฉัน / ชวนเพื่อน") },
    )
    if (open) {
        ModalBottomSheet(onDismissRequest = { open = false }, scrollable = true) {
            AranMyQrSection(invite = invite, myName = myName, modifier = Modifier.navigationBarsPadding())
        }
    }
}

@Composable
internal fun AranMyQrSection(invite: AranInvite?, myName: String?, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(ElementTheme.colors.bgSubtleSecondary)
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("QR โค้ดของฉัน", style = ElementTheme.typography.fontHeadingSmMedium, color = ElementTheme.colors.textPrimary)
        Text(
            "ให้เพื่อนสแกน หรือส่งลิงก์ — เพื่อนเปิดแล้วเริ่มแชทกับคุณได้ทันที",
            style = ElementTheme.typography.fontBodySmRegular,
            color = ElementTheme.colors.textSecondary,
            textAlign = TextAlign.Center,
        )
        Box(
            modifier = Modifier.size(212.dp).clip(RoundedCornerShape(16.dp)).background(Color.White).padding(6.dp),
            contentAlignment = Alignment.Center,
        ) {
            if (invite != null) {
                QrCodeImage(data = invite.url, forceMaxBrightness = false, modifier = Modifier.size(200.dp))
            } else {
                CircularProgressIndicator()
            }
        }
        Text(
            invite?.url ?: "กำลังสร้างลิงก์…",
            style = ElementTheme.typography.fontBodySmRegular,
            color = ElementTheme.colors.textSecondary,
        )
        if (invite != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    text = "แชร์ลิงก์",
                    size = ButtonSize.Medium,
                    leadingIcon = IconSource.Vector(CompoundIcons.ShareAndroid()),
                    onClick = { share(context, aranInviteText(myName, invite.url)) },
                )
                OutlinedButton(
                    text = "คัดลอก",
                    size = ButtonSize.Medium,
                    onClick = { copy(context, invite.url) },
                )
            }
            if (invite.joined > 0) {
                Text("🎉 มีคนเข้ามาผ่านลิงก์ของคุณแล้ว ${invite.joined} คน", style = ElementTheme.typography.fontBodySmMedium)
            }
        }
    }
}

private fun share(context: Context, text: String) {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
    context.startActivity(Intent.createChooser(send, "ชวนเพื่อนมาใช้ AranChat"))
}

private fun copy(context: Context, url: String) {
    context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("AranChat", url))
    Toast.makeText(context, "คัดลอกลิงก์แล้ว", Toast.LENGTH_SHORT).show()
}
