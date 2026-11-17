//
// AranChat — recovery-key escrow with the hospital keyvault (server/keyvault/server.mjs).
// Same flow as Android AranKeyvault.kt: after login the app restores or deposits the recovery key, so staff never write it down.
//
// Wiring (not done yet — see element-x-ios/aranchat/PORTING.md C):
//   call `AranKeyvault.sync(…)` once after the session is ready, passing
//   - openIDToken: `try await client.requestOpenidToken()` (SDK Client, as in SDKMatrixBackend.openIDToken)
//   - secureBackup: `userSession.clientProxy.secureBackupController`
//   and hide Element's "set up recovery" / "verify this device" prompts when it succeeds.
//
// SPDX-License-Identifier: AGPL-3.0-only
//

import Foundation

nonisolated struct AranOpenIDToken: Sendable {
    let accessToken: String
    let tokenType: String
    let matrixServerName: String
    let expiresIn: Int
}

nonisolated enum AranKeyvaultError: Error {
    /// The keyvault answered with something other than "has key" / "no key" — never treat this as "no key" (that would reset identities).
    case unavailable(status: Int)
    case recoveryFailed(String)
}

enum AranKeyvault {
    /// Default from `.well-known/matrix/client` → `com.arankub.keyvault.url`; this is the current hospital value.
    static let defaultBaseURL = URL(string: "https://chat.arankub.com/api/keyvault")!

    /// Restores the recovery key from the keyvault, or creates one and deposits it.
    static func sync(baseURL: URL = defaultBaseURL,
                     openIDToken: @escaping () async throws -> AranOpenIDToken,
                     secureBackup: SecureBackupControllerProtocol) async throws {
        let (status, json) = try await call(baseURL, "get", openIDToken: openIDToken)
        switch status {
        case 200:
            guard let key = json["recovery_key"] as? String else { throw AranKeyvaultError.unavailable(status: status) }
            if case .failure = await secureBackup.confirmRecoveryKey(key) {
                // The stored key no longer opens this account's backup: ask the keyvault to allow a reset, then deposit a new key.
                _ = try await call(baseURL, "allow-reset", openIDToken: openIDToken)
                try await depositNewKey(baseURL: baseURL, openIDToken: openIDToken, secureBackup: secureBackup, replace: true)
            }
        // A 404 means "no key yet" only when the body says so; an nginx 404 means the keyvault is not deployed.
        case 404 where json["error"] as? String == "none":
            try await depositNewKey(baseURL: baseURL, openIDToken: openIDToken, secureBackup: secureBackup, replace: false)
        default:
            throw AranKeyvaultError.unavailable(status: status)
        }
    }

    private static func depositNewKey(baseURL: URL,
                                      openIDToken: @escaping () async throws -> AranOpenIDToken,
                                      secureBackup: SecureBackupControllerProtocol,
                                      replace: Bool) async throws {
        switch await secureBackup.generateRecoveryKey(withPassphrase: nil) {
        case .success(let key):
            let (status, _) = try await call(baseURL, "put", body: ["recovery_key": key, "replace": replace], openIDToken: openIDToken)
            guard status == 200 else { throw AranKeyvaultError.unavailable(status: status) }
        case .failure(let error):
            throw AranKeyvaultError.recoveryFailed(String(describing: error))
        }
    }

    private static func call(_ baseURL: URL,
                             _ action: String,
                             body: [String: Any] = [:],
                             openIDToken: () async throws -> AranOpenIDToken) async throws -> (Int, [String: Any]) {
        let token = try await openIDToken()
        var payload = body
        payload["openid"] = ["access_token": token.accessToken, "token_type": token.tokenType,
                             "matrix_server_name": token.matrixServerName, "expires_in": token.expiresIn]
        var request = URLRequest(url: baseURL.appending(path: action))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        return (status, json)
    }
}
