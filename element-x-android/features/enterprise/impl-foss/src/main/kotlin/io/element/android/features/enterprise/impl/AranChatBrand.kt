/*
 * AranChat — สร้างจาก aranchat/brand.env โดย aranchat/apply-brand.sh (อย่าแก้ไฟล์นี้ตรงๆ)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.features.enterprise.impl

import androidx.compose.ui.graphics.Color
import io.element.android.compound.colors.SemanticColorsLightDark
import io.element.android.compound.tokens.generated.SemanticColors
import io.element.android.compound.tokens.generated.compoundColorsDark
import io.element.android.compound.tokens.generated.compoundColorsLight
import io.element.android.libraries.matrix.api.accountprovider.AccountProvider

internal object AranChatBrand {
    /** เซิร์ฟเวอร์เดียวที่แอปเข้าได้ — ผู้ใช้ไม่ต้องเลือก/พิมพ์เซิร์ฟเวอร์ */
    val accountProvider = AccountProvider.Managed(
        serverName = "arankub.com",
        baseUrl = "https://matrix.arankub.com",
        canUseServerName = true,
    )

    val brandColor = Color(0xFF5B3FD9)

    val pushGateway: String? = "https://matrix.arankub.com/_matrix/push/v1/notify".ifBlank { null }

    /** ฝากกุญแจกู้คืนแชทเข้ารหัส (aranchat-ess/keyvault) — ว่าง = ไม่ใช้ */
    val keyvaultUrl: String? = "https://chat.arankub.com/api/keyvault".ifBlank { null }

    private fun SemanticColors.branded(darker: Color) = copy(
        bgActionPrimaryRest = brandColor,
        bgActionPrimaryHovered = darker,
        bgActionPrimaryPressed = darker,
        bgAccentRest = brandColor,
        bgAccentHovered = darker,
        bgAccentPressed = darker,
        iconAccentPrimary = brandColor,
        iconAccentTertiary = brandColor,
        textActionAccent = brandColor,
    )

    val semanticColors = SemanticColorsLightDark(
        light = compoundColorsLight.branded(darker = brandColor.copy(red = brandColor.red * 0.8f, green = brandColor.green * 0.8f, blue = brandColor.blue * 0.8f)),
        dark = compoundColorsDark.branded(darker = brandColor),
    )
}
