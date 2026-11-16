/*
 * Copyright (c) 2025 Element Creations Ltd.
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial.
 * Please see LICENSE files in the repository root for full details.
 */

package io.element.android.features.enterprise.impl

import dev.zacsweers.metro.ContributesBinding
import io.element.android.features.enterprise.api.SessionEnterpriseService
import io.element.android.libraries.di.SessionScope

@ContributesBinding(SessionScope::class)
class DefaultSessionEnterpriseService(
    private val keyvault: AranKeyvault,
) : SessionEnterpriseService {
    // AranChat: ฝาก/กู้กุญแจแชทเข้ารหัสอัตโนมัติ (AranKeyvault.kt) — ทำเบื้องหลัง ไม่หน่วงการเปิดแอป
    override suspend fun init() = keyvault.start()
    override suspend fun tweakMasUrl(url: String): String = url
    override suspend fun isElementCallAvailable(): Boolean = true
    // AranChat: แชทเข้ารหัสเสมอ (มีข้อมูลผู้ป่วย — 2026-11-12) · เปลี่ยนเครื่องแล้วอ่านแชทเก่าได้ด้วย AranKeyvault
    override suspend fun isEncryptionDisabledByHomeserver(): Boolean = false
    override suspend fun arePublicRoomsDisabledByHomeserver(): Boolean = false
}
