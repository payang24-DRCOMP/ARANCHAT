//
// AranChat — กุญแจกู้คืนแชทเข้ารหัส ฝากไว้ที่ server ของ รพ. (server/keyvault) — ลำดับเดียวกับ Android AranKeyvault.kt และเว็บ keyvault.ts
//
// ผู้ใช้ไม่ต้องทำอะไร:
//   - ยังไม่มี recovery บนบัญชี: เปิด recovery (สร้างกุญแจยืนยันตัวตน + สำรองกุญแจแชท) → ฝาก recovery key
//   - เครื่องใหม่ (recovery มีแล้ว แต่เครื่องนี้ยังไม่มีกุญแจ): ดึงจาก keyvault → recover → อ่านแชทเก่าได้ ยืนยันเครื่องเอง
//     (หน้า "ยืนยันตัวตน" หลังล็อกอินปิดเองเมื่อเครื่องยืนยันแล้ว — OnboardingFlowCoordinator ฟัง verificationState)
//   - กุญแจใน keyvault ใช้ไม่ได้ / ไม่มีใครถือกุญแจของบัญชี: ขอ keyvault อนุญาต (allow-reset) → ตั้งตัวตนใหม่ → ฝากใหม่
// ยืนยันตัวกับ keyvault ด้วย OpenID token (ไม่ส่ง access token ออกไป) · ทำเบื้องหลัง ล้มเหลวก็ลองใหม่เมื่อเปิดแอปครั้งหน้า
// เรียกจาก ClientProxy.init (แอปหลักเท่านั้น — NSE/ShareExtension ไม่ได้สร้าง ClientProxy)
//
// SPDX-License-Identifier: AGPL-3.0-only
//

import Foundation
import MatrixRustSDK

nonisolated enum AranKeyvaultError: Error {
    /// keyvault ตอบอย่างอื่นที่ไม่ใช่ "มีกุญแจ" / "ยังไม่มี" — ห้ามตีความว่าไม่มีกุญแจ (จะรีเซ็ตตัวตนผิด)
    case unavailable(status: Int)
    case recoveryStateUnknown
    case putFailed(status: Int)
    /// server ต้องการรหัสผ่าน (UIAA) เพื่อตั้งตัวตนใหม่ — ระบบเราใช้ MAS (OAuth) จึงไม่ควรเกิด
    case resetNeedsPassword
    case timeout
}

nonisolated enum AranKeyvault {
    /// ค่าเดียวกับ Android `brand.env` KEYVAULT_URL (และ `.well-known/matrix/client` → `com.arankub.keyvault.url`)
    static let baseURL = URL(string: "https://chat.arankub.com/api/keyvault")!

    /// เริ่มทำงานเบื้องหลัง (ไม่รอ)
    static func start(client: ClientProtocol) {
        Task.detached(priority: .utility) {
            do {
                try await sync(client: client)
            } catch {
                MXLog.warning("AranKeyvault: failed, will retry on next launch: \(error)")
            }
        }
    }

    static func sync(client: ClientProtocol) async throws {
        let encryption = client.encryption()
        // รอ sync แรกให้รู้สถานะ recovery ของบัญชี
        var state = encryption.recoveryState()
        var waited = 0
        while state == .unknown, waited < 180 {
            try await Task.sleep(for: .seconds(1))
            waited += 1
            state = encryption.recoveryState()
        }
        guard state != .unknown else { throw AranKeyvaultError.recoveryStateUnknown }

        let (status, json) = try await call(client, "get")
        // ตัดสินใจได้เฉพาะเมื่อ keyvault ตอบจริง: 200 = มีกุญแจ · 404 {error:"none"} = ยังไม่เคยฝาก
        // อย่างอื่น (บริการล่ม/ยังไม่ติดตั้ง/เครือข่าย) → ไม่แตะกุญแจของผู้ใช้เลย ลองใหม่ครั้งหน้า
        guard status == 200 || (status == 404 && json["error"] as? String == "none") else {
            throw AranKeyvaultError.unavailable(status: status)
        }
        let escrowed = status == 200 ? (json["recovery_key"] as? String).flatMap { $0.isEmpty ? nil : $0 } : nil
        MXLog.info("AranKeyvault: recoveryState=\(state) keyvault=\(status) hasEscrowedKey=\(escrowed != nil)")

        switch state {
        case .enabled:
            if escrowed != nil { return } // เครื่องนี้พร้อมแล้ว
            // ตั้ง recovery ไว้ก่อนมี keyvault (เครื่องนี้มีกุญแจครบ) → ออก recovery key ใหม่แล้วฝาก
            try await put(client, key: encryption.resetRecoveryKey(), replace: true)
            MXLog.info("AranKeyvault: deposited a new recovery key")
            return
        case .incomplete:
            if let escrowed, (try? await encryption.recover(recoveryKey: escrowed)) != nil {
                MXLog.info("AranKeyvault: recovered from keyvault")
                return
            }
        case .disabled:
            if !((try? await encryption.backupExistsOnServer()) ?? false) {
                try await put(client, key: enableRecovery(encryption), replace: escrowed != nil)
                MXLog.info("AranKeyvault: enabled recovery and deposited the key")
                return
            }
        case .unknown:
            return
        }
        try await resetIdentity(client, encryption)
    }

    /// ไม่มีใครถือกุญแจของบัญชี (หรือกุญแจที่ฝากใช้ไม่ได้) → ตั้งตัวตนใหม่
    /// ข้อความเข้ารหัสเก่าที่เครื่องนี้ไม่เคยถอดได้จะยังอ่านไม่ได้เหมือนเดิม
    private static func resetIdentity(_ client: ClientProtocol, _ encryption: EncryptionProtocol) async throws {
        MXLog.warning("AranKeyvault: nobody holds this account's keys — resetting identity")
        _ = try await call(client, "allow-reset")
        if let handle = try await encryption.resetIdentity() {
            switch handle.authType() {
            case .oAuth(let info):
                // keyvault อนุญาตใน MAS แล้ว ไม่ต้องเปิดเว็บ
                try await withTimeout(seconds: 60) { try await handle.reset(auth: .oAuth(session: info.session)) }
            case .uiaa:
                await handle.cancel()
                throw AranKeyvaultError.resetNeedsPassword
            }
        }
        try await put(client, key: enableRecovery(encryption), replace: true)
        MXLog.info("AranKeyvault: identity reset and new key deposited")
    }

    private static func enableRecovery(_ encryption: EncryptionProtocol) async throws -> String {
        try await encryption.enableRecovery(waitForBackupsToUpload: false, key: nil,
                                            progressListener: SDKListener<EnableRecoveryProgress> { _ in })
    }

    private static func put(_ client: ClientProtocol, key: String, replace: Bool) async throws {
        let (status, _) = try await call(client, "put", body: ["recovery_key": key, "replace": replace])
        guard status == 200 else { throw AranKeyvaultError.putFailed(status: status) }
    }

    private static func call(_ client: ClientProtocol, _ action: String, body: [String: Any] = [:]) async throws -> (Int, [String: Any]) {
        let token = try await client.requestOpenidToken()
        var payload = body
        payload["openid"] = ["access_token": token.accessToken,
                             "token_type": token.tokenType,
                             "matrix_server_name": token.matrixServerName,
                             "expires_in": token.expiresInSeconds]
        var request = URLRequest(url: baseURL.appending(path: action), timeoutInterval: 30)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        return (status, json)
    }

    private static func withTimeout(seconds: Double, _ operation: @escaping @Sendable () async throws -> Void) async throws {
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask { try await operation() }
            group.addTask {
                try await Task.sleep(for: .seconds(seconds))
                throw AranKeyvaultError.timeout
            }
            try await group.next()
            group.cancelAll()
        }
    }
}
