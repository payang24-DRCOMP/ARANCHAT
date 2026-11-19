//
// AranChat — ปุ่ม "ถอดเป็นข้อความ" ใต้ข้อความเสียง/ไฟล์เสียง (ทุกห้อง รวมห้องเข้ารหัส) — เทียบเว็บ AranTranscribe.tsx
//   แอปถอดรหัสไฟล์เสียงในเครื่อง (mediaProvider) → ส่งไปถอดที่เครื่องของ รพ.
//   POST https://chat.<เซิร์ฟเวอร์>/api/notify/asr · body = ไฟล์เสียง (≤ 25 MB) · header X-AranChat-OpenID → { text }
//   ไม่เก็บไฟล์/ข้อความบนเซิร์ฟเวอร์ · ผลแสดงเฉพาะเครื่องนี้ (ไม่ส่งเข้าแชท) · จำผลไว้ระหว่างเปิดแอป
//
// SPDX-License-Identifier: AGPL-3.0-only
//

import AVFoundation
import Compound
import MatrixRustSDK
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

    /// ไฟล์ยาว (ประชุม): ส่งเข้าแชท "AranChat แจ้งเตือน" ให้บอทถอด (แยกผู้พูด) + สรุปประชุม — รับได้ถึง 200 MB
    /// ห้องบอทไม่เข้ารหัส บอทจึงเปิดไฟล์ได้ · ไฟล์ประมวลผลบนเครื่องของ รพ. (notify/asr.mjs onAudioMessage)
    static let botMaxBytes = 200 * 1024 * 1024

    static func sendToBot(fileURL: URL, filename: String, mimeType: String) async throws {
        guard let client = AranSession.client else { throw message("ยังไม่ได้เข้าระบบ") }
        let server = try client.userId().split(separator: ":", maxSplits: 1).last.map(String.init) ?? ""
        guard let room = try client.getDmRoom(userId: "@aranchat:\(server)") else {
            throw message("ยังไม่มีแชทกับ \"AranChat แจ้งเตือน\" — เปิดแชทนั้นก่อนแล้วลองใหม่")
        }
        if (try? await room.latestEncryptionState()) == .encrypted {
            throw message("แชท \"AranChat แจ้งเตือน\" เปิดการเข้ารหัสไว้ บอทจึงเปิดไฟล์ไม่ได้")
        }
        let data = try Data(contentsOf: fileURL)
        guard data.count <= botMaxBytes else { throw message("ไฟล์ใหญ่เกิน 200 MB — แบ่งไฟล์เป็นช่วงแล้วส่งทีละไฟล์") }
        // ความยาวเสียง: บอทใช้เลือกโหมดประชุม (แยกผู้พูด) และกะเวลารอ
        let seconds = (try? await AVURLAsset(url: fileURL).load(.duration).seconds) ?? 0
        let mxc = try await client.uploadMedia(mimeType: mimeType, data: data, progressWatcher: nil)
        var info: [String: Any] = ["mimetype": mimeType, "size": data.count]
        if seconds.isFinite, seconds > 0 { info["duration"] = Int(seconds * 1000) }
        let content: [String: Any] = ["msgtype": "m.audio", "body": filename, "filename": filename, "url": mxc, "info": info]
        let json = String(decoding: try JSONSerialization.data(withJSONObject: content), as: UTF8.self)
        _ = try await room.sendRaw(eventType: "m.room.message", content: json, requestConfigOverride: nil)
    }

    private static func message(_ text: String) -> NSError {
        NSError(domain: "AranTranscribe", code: 0, userInfo: [NSLocalizedDescriptionKey: text])
    }
}

/// ปุ่ม + ผลถอดเสียงของข้อความเสียง 1 ข้อความ
struct AranTranscribeView: View {
    @Environment(\.timelineContext) private var context
    let itemID: TimelineItemIdentifier
    let source: MediaSourceProxy?
    let filename: String
    let fileSize: UInt?
    let contentType: UTType?

    init(itemID: TimelineItemIdentifier, content: AudioRoomTimelineItemContent) {
        self.init(itemID: itemID, source: content.source, filename: content.filename, fileSize: content.fileSize, contentType: content.contentType)
    }

    /// ไฟล์ทั่วไปที่เป็นไฟล์เสียง (ลากไฟล์ .m4a/.aac/.mp3 เข้าแชท → ส่งเป็น m.file)
    init(itemID: TimelineItemIdentifier, file: FileRoomTimelineItemContent) {
        self.init(itemID: itemID, source: file.source, filename: file.filename, fileSize: file.fileSize, contentType: file.contentType)
    }

    init(itemID: TimelineItemIdentifier, source: MediaSourceProxy?, filename: String, fileSize: UInt?, contentType: UTType?) {
        self.itemID = itemID
        self.source = source
        self.filename = filename
        self.fileSize = fileSize
        self.contentType = contentType
    }

    static func isAudio(_ file: FileRoomTimelineItemContent) -> Bool {
        if file.contentType?.conforms(to: .audio) == true { return true }
        let ext = (file.filename as NSString).pathExtension.lowercased()
        return ["m4a", "aac", "mp3", "wav", "ogg", "opus", "amr", "flac", "caf"].contains(ext)
    }

    @State private var busy = false
    @State private var sentToBot = false
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
            } else if source != nil {
                VStack(alignment: .leading, spacing: 4) {
                    if sentToBot {
                        Text("✅ ส่งให้บอทแล้ว — บทถอดเสียงและสรุปประชุมจะมาที่แชท \"AranChat แจ้งเตือน\" (ไฟล์ 1 ชม. ใช้เวลาราว 10 นาที)")
                            .font(.compound.bodySM)
                            .foregroundStyle(.compound.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    } else if isLong {
                        Button(action: sendToBot) {
                            Text(busy ? "กำลังส่งไฟล์ให้บอท…" : "📝 ส่งให้บอทถอด + สรุปประชุม")
                                .font(.compound.bodySMSemibold)
                                .foregroundStyle(.compound.textActionAccent)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 5)
                                .overlay(Capsule().stroke(Color.compound.textActionAccent.opacity(0.6), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .disabled(busy)
                        Text("ไฟล์ยาวเกิน 25 MB — บอทถอดเสียง แยกผู้พูด และสรุปการประชุมให้ (ไม่เกิน 200 MB)")
                            .font(.compound.bodyXS)
                            .foregroundStyle(.compound.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
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
                    }
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

    private var isLong: Bool { (fileSize ?? 0) > AranTranscribe.maxBytes }

    private func sendToBot() {
        guard let source, let mediaProvider = context?.mediaProvider else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            switch await mediaProvider.loadFileFromSource(source, filename: filename) {
            case .success(let handle):
                guard let url = handle.url else {
                    error = "เปิดไฟล์เสียงไม่ได้"
                    return
                }
                let mime = contentType?.preferredMIMEType ?? source.mimeType ?? "audio/mp4"
                do {
                    try await AranTranscribe.sendToBot(fileURL: url, filename: filename, mimeType: mime)
                    sentToBot = true
                } catch {
                    MXLog.warning("AranTranscribe: send to bot failed: \(error)")
                    self.error = error.localizedDescription
                }
            case .failure(let failure):
                MXLog.warning("AranTranscribe: load audio failed: \(failure)")
                error = "โหลดไฟล์เสียงไม่สำเร็จ ลองอีกครั้ง"
            }
        }
    }

    private func run() {
        guard let source, let mediaProvider = context?.mediaProvider else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            if let size = fileSize, size > AranTranscribe.maxBytes {
                error = "ไฟล์ใหญ่เกิน 25 MB — ส่งไฟล์ให้ \"AranChat แจ้งเตือน\" แทน"
                return
            }
            switch await mediaProvider.loadFileFromSource(source, filename: filename) {
            case .success(let handle):
                guard let url = handle.url else {
                    error = "เปิดไฟล์เสียงไม่ได้"
                    return
                }
                let mime = contentType?.preferredMIMEType ?? source.mimeType ?? "application/octet-stream"
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
