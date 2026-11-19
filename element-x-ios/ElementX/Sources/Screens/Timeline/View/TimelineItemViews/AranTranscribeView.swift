//
// AranChat — ปุ่ม "ถอดเป็นข้อความ" ใต้ข้อความเสียง/ไฟล์เสียง (ทุกห้อง รวมห้องเข้ารหัส) — เทียบเว็บ AranTranscribe.tsx
//   แอปถอดรหัสไฟล์เสียงในเครื่อง (mediaProvider) → ส่งไปถอดที่เครื่องของ รพ.
//   POST https://chat.<เซิร์ฟเวอร์>/api/notify/asr · body = ไฟล์เสียง (≤ 25 MB) · header X-AranChat-OpenID → { text }
//   ไม่เก็บไฟล์/ข้อความบนเซิร์ฟเวอร์ · ผลแสดงเฉพาะเครื่องนี้ (ไม่ส่งเข้าแชท) · จำผลไว้ระหว่างเปิดแอป
//
// SPDX-License-Identifier: AGPL-3.0-only
//

import Compound
import SwiftUI
import UniformTypeIdentifiers

nonisolated enum AranTranscribe {
    static let maxBytes = 25 * 1024 * 1024

    /// ผลที่ถอดแล้ว (ต่อข้อความ) — เลื่อนจอไปมาแล้วไม่ต้องถอดใหม่
    @MainActor static var results: [String: String] = [:]

    static func transcribe(fileURL: URL, mimeType: String) async throws -> String {
        let data = try Data(contentsOf: fileURL)
        guard data.count <= maxBytes else {
            throw message("ไฟล์ใหญ่เกิน 25 MB — ส่งไฟล์ให้ \"AranChat แจ้งเตือน\" แทน")
        }
        guard let client = AranSession.client else { throw message("ยังไม่ได้เข้าระบบ") }
        let server = try client.userId().split(separator: ":", maxSplits: 1).last.map(String.init) ?? ""
        guard let url = URL(string: "https://chat.\(server)/api/notify/asr") else { throw URLError(.badURL) }
        let token = try await client.requestOpenidToken()
        var request = URLRequest(url: url, timeoutInterval: 300)
        request.httpMethod = "POST"
        request.setValue(mimeType, forHTTPHeaderField: "Content-Type")
        request.setValue(token.accessToken, forHTTPHeaderField: "X-AranChat-OpenID")
        let (body, response) = try await URLSession.shared.upload(for: request, from: data)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
        guard status == 200 else { throw message(json["error"] as? String ?? "HTTP \(status)") }
        let text = (json["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? "(ไม่พบเสียงพูด)" : text
    }

    private static func message(_ text: String) -> NSError {
        NSError(domain: "AranTranscribe", code: 0, userInfo: [NSLocalizedDescriptionKey: text])
    }
}

/// ปุ่ม + ผลถอดเสียงของข้อความเสียง 1 ข้อความ
struct AranTranscribeView: View {
    @Environment(\.timelineContext) private var context
    let itemID: TimelineItemIdentifier
    let content: AudioRoomTimelineItemContent

    @State private var busy = false
    @State private var result: String?
    @State private var error: String?

    private var key: String { itemID.eventID ?? itemID.uniqueID.value }

    var body: some View {
        Group {
            if let result {
                VStack(alignment: .leading, spacing: 4) {
                    Text("🎙 ข้อความจากเสียง")
                        .font(.compound.bodyXSSemibold)
                        .foregroundStyle(.compound.textSecondary)
                    Text(result)
                        .font(.compound.bodyMD)
                        .foregroundStyle(.compound.textPrimary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("ถอดอัตโนมัติ อาจมีคำผิด · เห็นเฉพาะคุณ")
                        .font(.compound.bodyXS)
                        .foregroundStyle(.compound.textSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else if content.source != nil {
                VStack(alignment: .leading, spacing: 4) {
                    Button(action: run) {
                        Text(busy ? "กำลังถอดเสียง…" : "🎙 ถอดเป็นข้อความ")
                            .font(.compound.bodySMSemibold)
                            .foregroundStyle(.compound.textActionAccent)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 5)
                            .overlay(Capsule().stroke(Color.compound.textActionAccent.opacity(0.6), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(busy)
                    if let error {
                        Text(error)
                            .font(.compound.bodyXS)
                            .foregroundStyle(.compound.textCriticalPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .padding(.top, 6)
        .onAppear { result = AranTranscribe.results[key] }
    }

    private func run() {
        guard let source = content.source, let mediaProvider = context?.mediaProvider else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            if let size = content.fileSize, size > AranTranscribe.maxBytes {
                error = "ไฟล์ใหญ่เกิน 25 MB — ส่งไฟล์ให้ \"AranChat แจ้งเตือน\" แทน"
                return
            }
            switch await mediaProvider.loadFileFromSource(source, filename: content.filename) {
            case .success(let handle):
                guard let url = handle.url else {
                    error = "เปิดไฟล์เสียงไม่ได้"
                    return
                }
                let mime = content.contentType?.preferredMIMEType ?? source.mimeType ?? "application/octet-stream"
                do {
                    let text = try await AranTranscribe.transcribe(fileURL: url, mimeType: mime)
                    AranTranscribe.results[key] = text
                    result = text
                } catch {
                    MXLog.warning("AranTranscribe: failed: \(error)")
                    self.error = error.localizedDescription
                }
            case .failure(let failure):
                MXLog.warning("AranTranscribe: load audio failed: \(failure)")
                error = "โหลดไฟล์เสียงไม่สำเร็จ ลองอีกครั้ง"
            }
        }
    }
}
