/*
 * AranChat — state event อ่านแบบ JSON ดิบ (โน้ต/อัลบั้มของกลุ่ม: com.arankub.note / com.arankub.album)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.libraries.matrix.api.room

import io.element.android.libraries.matrix.api.core.UserId

data class RawStateEvent(
    val stateKey: String,
    val sender: UserId,
    val contentJson: String,
    val timestamp: Long,
)
