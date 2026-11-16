/*
 * AranChat — กุญแจกู้คืนแชทเข้ารหัส ฝากไว้ที่ server ของ รพ. (aranchat-ess/keyvault) — แบบเดียวกับเว็บ (src/aranchat/keyvault.ts)
 *
 * ผู้ใช้ไม่ต้องทำอะไร:
 *   - ยังไม่มี recovery บนบัญชี: เปิด recovery (สร้างกุญแจยืนยันตัวตน + สำรองกุญแจแชท) → ฝาก recovery key
 *   - เครื่องใหม่ (recovery มีแล้ว แต่เครื่องนี้ยังไม่มีกุญแจ): ดึงจาก keyvault → recover → อ่านแชทเก่าได้ ยืนยันเครื่องเอง
 *   - กุญแจใน keyvault ใช้ไม่ได้ / ไม่มีใครถือกุญแจของบัญชี: ขอ keyvault อนุญาต (allow-reset) → ตั้งตัวตนใหม่ → ฝากใหม่
 * ยืนยันตัวกับ keyvault ด้วย OpenID token (ไม่ส่ง access token ออกไป) · ทำงานเบื้องหลัง ล้มเหลวก็ลองใหม่เมื่อเปิดแอปครั้งหน้า
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.features.enterprise.impl

import dev.zacsweers.metro.ContributesBinding
import io.element.android.libraries.di.SessionScope
import io.element.android.libraries.di.annotations.SessionCoroutineScope
import io.element.android.libraries.matrix.api.MatrixClient
import io.element.android.libraries.matrix.api.encryption.IdentityOAuthResetHandle
import io.element.android.libraries.matrix.api.encryption.RecoveryState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import timber.log.Timber
import java.net.HttpURLConnection
import java.net.URL

interface AranKeyvault {
    /** เริ่มทำงานเบื้องหลัง (ไม่รอ) */
    fun start()
}

@ContributesBinding(SessionScope::class)
class DefaultAranKeyvault(
    private val client: MatrixClient,
    @SessionCoroutineScope private val scope: CoroutineScope,
) : AranKeyvault {
    private val encryption get() = client.encryptionService

    override fun start() {
        val base = AranChatBrand.keyvaultUrl ?: return
        scope.launch {
            runCatching { sync(base) }.onFailure { Timber.w(it, "AranKeyvault: ไม่สำเร็จ (ลองใหม่เมื่อเปิดแอปครั้งหน้า)") }
        }
    }

    private suspend fun sync(base: String) {
        val state = encryption.recoveryStateStateFlow.first { it != RecoveryState.WAITING_FOR_SYNC && it != RecoveryState.UNKNOWN }
        val (status, json) = call(base, "get")
        // ตัดสินใจได้เฉพาะเมื่อ keyvault ตอบจริง: 200 = มีกุญแจ · 404 {error:"none"} = ยังไม่เคยฝาก
        // อย่างอื่น (บริการล่ม/ยังไม่ติดตั้ง/เครือข่าย) → ไม่แตะกุญแจของผู้ใช้เลย ลองใหม่ครั้งหน้า
        check(status == 200 || (status == 404 && json?.optString("error") == "none")) { "keyvault ไม่พร้อม ($status)" }
        val escrowed = json?.takeIf { status == 200 }?.optString("recovery_key")?.takeIf { it.isNotBlank() }
        when {
            state == RecoveryState.ENABLED && escrowed != null -> Unit // เครื่องนี้พร้อมแล้ว
            state == RecoveryState.ENABLED -> {
                // ตั้ง recovery ไว้ก่อนมี keyvault (เครื่องนี้มีกุญแจครบ) → ออก recovery key ใหม่แล้วฝาก
                put(base, encryption.resetRecoveryKey().getOrThrow(), replace = true)
            }
            state == RecoveryState.INCOMPLETE && escrowed != null && encryption.recover(escrowed).isSuccess -> {
                Timber.i("AranKeyvault: กู้กุญแจจาก keyvault แล้ว")
            }
            state == RecoveryState.DISABLED && !encryption.doesBackupExistOnServer().getOrDefault(false) -> {
                put(base, encryption.enableRecovery(waitForBackupsToUpload = false).getOrThrow(), replace = escrowed != null)
                Timber.i("AranKeyvault: ตั้งการเข้ารหัสและฝากกุญแจแล้ว")
            }
            else -> resetIdentity(base)
        }
    }

    /** ไม่มีใครถือกุญแจของบัญชี (หรือกุญแจที่ฝากใช้ไม่ได้) → ตั้งตัวตนใหม่ ข้อความเข้ารหัสเก่าที่เครื่องนี้ไม่เคยถอดได้จะยังอ่านไม่ได้เหมือนเดิม */
    private suspend fun resetIdentity(base: String) {
        Timber.w("AranKeyvault: กุญแจเดิมของบัญชีไม่มีใครถือ — ตั้งชุดใหม่")
        call(base, "allow-reset")
        when (val handle = encryption.startIdentityReset().getOrThrow()) {
            null -> Unit
            is IdentityOAuthResetHandle -> withTimeout(60_000) { handle.resetOAuth().getOrThrow() } // keyvault อนุญาตแล้ว ไม่ต้องเปิดเว็บ
            else -> {
                handle.cancel()
                error("server ต้องการรหัสผ่านเพื่อตั้งตัวตนใหม่")
            }
        }
        put(base, encryption.enableRecovery(waitForBackupsToUpload = false).getOrThrow(), replace = true)
    }

    private suspend fun put(base: String, key: String, replace: Boolean) {
        val (code, _) = call(base, "put", JSONObject().put("recovery_key", key).put("replace", replace))
        check(code == 200) { "keyvault put $code" }
    }

    private suspend fun call(base: String, action: String, body: JSONObject = JSONObject()): Pair<Int, JSONObject?> = withContext(Dispatchers.IO) {
        body.put("openid", JSONObject(client.requestOpenIdToken().getOrThrow()))
        val conn = URL("$base/$action").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            val text = (if (code < 400) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }
            code to text?.let { runCatching { JSONObject(it) }.getOrNull() }
        } finally {
            conn.disconnect()
        }
    }
}
