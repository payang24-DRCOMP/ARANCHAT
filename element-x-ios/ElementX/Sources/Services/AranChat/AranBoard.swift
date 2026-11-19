//
// AranChat — โน้ตและอัลบั้มในกลุ่ม (แบบ LINE) · ข้อมูล — เทียบ Android aranchat/AranBoard.kt และเว็บ groupBoard.ts
//   โน้ต   = m.text body "📝 โน้ต\n<ข้อความ>"   + "com.arankub.note":  { id } · แก้ไข = m.replace (body เต็ม)
//   อัลบั้ม = m.text body "🖼 อัลบั้ม: <ชื่อ>"    + "com.arankub.album": { id } · รูป = ส่งในเธรดของข้อความนี้
//   รายการ = state event (type เดียวกัน, state_key = รหัส) { event_id, created_by, created_ts, updated_ts } · ลบ = {}
// เนื้อหาอยู่ในข้อความ → ห้องเข้ารหัสก็เข้ารหัส · state มีแค่ id/เวลา
//
// SPDX-License-Identifier: AGPL-3.0-only
//

import Foundation
import MatrixRustSDK

nonisolated enum AranBoardKind: String, CaseIterable, Identifiable, Hashable {
    case note = "com.arankub.note"
    case album = "com.arankub.album"

    var id: String { rawValue }
    var type: String { rawValue }
    var tabTitle: String { self == .note ? "📝 โน้ต" : "🖼 อัลบั้ม" }
}

nonisolated struct AranBoardEntry: Identifiable, Hashable {
    let kind: AranBoardKind
    let id: String
    let eventID: String
    let createdBy: String
    let createdTs: UInt64
    let updatedTs: UInt64
}

/// การ์ดโน้ต/อัลบั้มในแชท (ต้องมีรหัสใน JSON — ข้อความที่พิมพ์ "📝 โน้ต" เองไม่กลายเป็นการ์ด)
nonisolated struct AranBoardRef: Hashable {
    static let notePrefix = "📝 โน้ต\n"
    static let albumPrefix = "🖼 อัลบั้ม: "

    let kind: AranBoardKind
    let id: String
    /// โน้ต: ข้อความทั้งหมด · อัลบั้ม: ชื่อ
    let text: String

    static func isCandidate(_ body: String) -> Bool { body.hasPrefix(notePrefix) || body.hasPrefix(albumPrefix) }

    static func parse(body: String, originalJSON: String?) -> AranBoardRef? {
        let kind: AranBoardKind
        if body.hasPrefix(notePrefix) { kind = .note } else if body.hasPrefix(albumPrefix) { kind = .album } else { return nil }
        guard let data = originalJSON?.data(using: .utf8),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let id = ((json["content"] as? [String: Any])?[kind.type] as? [String: Any])?["id"] as? String,
              id.range(of: "^[\\w-]{4,40}$", options: .regularExpression) != nil else { return nil }
        return AranBoardRef(kind: kind, id: id, text: textOf(kind, body: body))
    }

    static func textOf(_ kind: AranBoardKind, body: String) -> String {
        switch kind {
        case .note:
            return body.hasPrefix(notePrefix) ? String(body.dropFirst(notePrefix.count)) : body
        case .album:
            let name = (body.hasPrefix(albumPrefix) ? String(body.dropFirst(albumPrefix.count)) : body)
                .split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? ""
            return name.trimmingCharacters(in: .whitespaces).isEmpty ? "อัลบั้ม" : name
        }
    }

    static func noteTitle(_ text: String) -> String {
        let first = text.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "\n").first.map { String($0.prefix(80)) } ?? ""
        return first.trimmingCharacters(in: .whitespaces).isEmpty ? "โน้ต" : first
    }

    static func noteRest(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "\n", omittingEmptySubsequences: false)
            .dropFirst().joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// สิ่งที่แผงโน้ต/อัลบั้มต้องใช้จากห้องที่เปิดอยู่ (RoomScreenCoordinator ลงทะเบียนให้)
@MainActor
final class AranRoomContext {
    private static var contexts: [String: AranRoomContext] = [:]

    let roomProxy: JoinedRoomProxyProtocol
    let userSession: UserSessionProtocol
    let openThread: @MainActor (String) -> Void

    private init(roomProxy: JoinedRoomProxyProtocol, userSession: UserSessionProtocol, openThread: @escaping @MainActor (String) -> Void) {
        self.roomProxy = roomProxy
        self.userSession = userSession
        self.openThread = openThread
    }

    static func register(roomProxy: JoinedRoomProxyProtocol, userSession: UserSessionProtocol, openThread: @escaping @MainActor (String) -> Void) {
        contexts[roomProxy.id] = AranRoomContext(roomProxy: roomProxy, userSession: userSession, openThread: openThread)
    }

    static func get(_ roomID: String) -> AranRoomContext? { contexts[roomID] }
}

nonisolated enum AranBoardError: Error {
    case noRoom
    case noPermission
}

nonisolated struct AranBoard {
    let roomID: String

    private func room() throws -> Room {
        guard let client = AranSession.client, let room = try client.getRoom(roomId: roomID) else { throw AranBoardError.noRoom }
        return room
    }

    private var me: String { (try? AranSession.client?.userId()) ?? "" }

    // MARK: - Read

    func entries(_ kind: AranBoardKind) async -> [AranBoardEntry] {
        guard let room = try? room(),
              let events = try? await room.stateEvents(eventType: stateEventTypeFromString(s: kind.type)) else { return [] }
        return events.compactMap { ev -> AranBoardEntry? in
            guard let c = (try? JSONSerialization.jsonObject(with: Data(ev.contentJson.utf8))) as? [String: Any],
                  let eventID = c["event_id"] as? String, eventID.hasPrefix("$") else { return nil }
            let ts = ev.timestamp ?? 0
            let created = (c["created_ts"] as? NSNumber)?.uint64Value ?? 0
            let updated = (c["updated_ts"] as? NSNumber)?.uint64Value ?? 0
            let by = (c["created_by"] as? String).flatMap { $0.hasPrefix("@") ? $0 : nil } ?? ev.sender
            return AranBoardEntry(kind: kind, id: ev.stateKey, eventID: eventID, createdBy: by,
                                  createdTs: created > 0 ? created : ts, updatedTs: updated > 0 ? updated : ts)
        }
        .sorted { $0.updatedTs > $1.updatedTs }
    }

    /// ข้อความล่าสุด (โน้ต: ข้อความ · อัลบั้ม: ชื่อ) — nil = อ่านไม่ได้ (เข้ากลุ่มทีหลัง/ถูกลบ)
    func text(_ entry: AranBoardEntry) async -> String? {
        guard let room = try? room(),
              let result = try? await room.loadOrFetchEventWithRelations(eventId: entry.eventID, relationFilter: [.replacement]) else { return nil }
        let latest = result.relatedEvents.max { $0.timestamp() < $1.timestamp() } ?? result.event
        let body = Self.body(of: latest) ?? Self.body(of: result.event)
        return body.map { AranBoardRef.textOf(entry.kind, body: $0) }
    }

    private static func body(of event: TimelineEvent) -> String? {
        guard case let .messageLike(content) = try? event.content(),
              case let .roomMessage(messageType, _) = content,
              case let .text(text) = messageType else { return nil }
        return text.body
    }

    // MARK: - Permission

    /// state event ปกติต้องเป็นผู้ดูแล → ผู้ดูแลเปิดให้สมาชิกทุกคน (0) อัตโนมัติ · true = สร้าง/แก้ได้
    func ensurePermission() async -> Bool {
        guard let room = try? room() else { return false }
        let plEvent = try? await room.stateEvents(eventType: .roomPowerLevels).first
        var pl = plEvent.flatMap { (try? JSONSerialization.jsonObject(with: Data($0.contentJson.utf8))) as? [String: Any] } ?? [:]
        let create = try? await room.stateEvents(eventType: .roomCreate).first
        var creators = Set<String>()
        if let create {
            creators.insert(create.sender)
            if let c = (try? JSONSerialization.jsonObject(with: Data(create.contentJson.utf8))) as? [String: Any],
               let extra = c["additional_creators"] as? [String] { creators.formUnion(extra) }
        }
        let users = pl["users"] as? [String: Any] ?? [:]
        let usersDefault = (pl["users_default"] as? NSNumber)?.int64Value ?? 0
        let isV12Creator = creators.contains(me) && users[me] == nil
        let myLevel = isV12Creator ? Int64.max : ((users[me] as? NSNumber)?.int64Value ?? usersDefault)
        let stateDefault = (pl["state_default"] as? NSNumber)?.int64Value ?? 50
        var events = pl["events"] as? [String: Any] ?? [:]
        func need(_ type: String) -> Int64 { (events[type] as? NSNumber)?.int64Value ?? stateDefault }
        let kinds = AranBoardKind.allCases
        let open = kinds.allSatisfy { (events[$0.type] as? NSNumber)?.int64Value == 0 }
        let canAll = kinds.allSatisfy { myLevel >= need($0.type) }
        if open || (canAll && myLevel < need("m.room.power_levels")) { return canAll }
        guard myLevel >= need("m.room.power_levels") else { return false }
        for kind in kinds { events[kind.type] = 0 }
        pl["events"] = events
        guard let data = try? JSONSerialization.data(withJSONObject: pl) else { return false }
        return (try? await room.sendStateEventRaw(eventType: "m.room.power_levels", stateKey: "",
                                                  content: String(decoding: data, as: UTF8.self), requestConfigOverride: nil)) != nil
    }

    // MARK: - Write

    private static func newID() -> String {
        let alphabet = Array("abcdefghjkmnpqrstuvwxyz23456789")
        return String((0..<9).map { _ in alphabet.randomElement()! })
    }

    private static func message(_ kind: AranBoardKind, id: String, body: String) -> [String: Any] {
        ["msgtype": "m.text", "body": body, kind.type: ["id": id]]
    }

    private static func json(_ object: [String: Any]) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
    }

    private func putIndex(_ kind: AranBoardKind, id: String, eventID: String, old: AranBoardEntry?) async throws {
        let now = UInt64(Date().timeIntervalSince1970 * 1000)
        let content: [String: Any] = ["event_id": eventID, "created_by": old?.createdBy ?? me,
                                      "created_ts": old?.createdTs ?? now, "updated_ts": now]
        _ = try await room().sendStateEventRaw(eventType: kind.type, stateKey: id, content: Self.json(content), requestConfigOverride: nil)
    }

    private func create(_ kind: AranBoardKind, body: String) async throws -> AranBoardEntry {
        let id = Self.newID()
        let eventID = try await room().sendRaw(eventType: "m.room.message", content: Self.json(Self.message(kind, id: id, body: body)),
                                               requestConfigOverride: nil)
        try await putIndex(kind, id: id, eventID: eventID, old: nil)
        let now = UInt64(Date().timeIntervalSince1970 * 1000)
        return AranBoardEntry(kind: kind, id: id, eventID: eventID, createdBy: me, createdTs: now, updatedTs: now)
    }

    private func replace(_ entry: AranBoardEntry, body: String) async throws {
        let content = Self.message(entry.kind, id: entry.id, body: body)
        var edit = content
        edit["m.new_content"] = content
        edit["m.relates_to"] = ["rel_type": "m.replace", "event_id": entry.eventID]
        _ = try await room().sendRaw(eventType: "m.room.message", content: Self.json(edit), requestConfigOverride: nil)
        try await putIndex(entry.kind, id: entry.id, eventID: entry.eventID, old: entry)
    }

    func createNote(_ text: String) async throws -> AranBoardEntry {
        try await create(.note, body: AranBoardRef.notePrefix + text.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    func editNote(_ entry: AranBoardEntry, text: String) async throws {
        try await replace(entry, body: AranBoardRef.notePrefix + text.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    func createAlbum(_ name: String) async throws -> AranBoardEntry {
        try await create(.album, body: AranBoardRef.albumPrefix + name.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    func renameAlbum(_ entry: AranBoardEntry, name: String) async throws {
        try await replace(entry, body: AranBoardRef.albumPrefix + name.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    /// ลบออกจากรายการ + ลบข้อความต้นฉบับ (ถ้ามีสิทธิ์)
    func remove(_ entry: AranBoardEntry) async throws {
        let room = try room()
        _ = try await room.sendStateEventRaw(eventType: entry.kind.type, stateKey: entry.id, content: "{}", requestConfigOverride: nil)
        try? await room.redact(eventId: entry.eventID, reason: nil)
    }

    /// แตะเวลาอัปเดตหลังเพิ่มรูป (รายการเรียงตามล่าสุด)
    func touch(_ entry: AranBoardEntry) async throws {
        try await putIndex(entry.kind, id: entry.id, eventID: entry.eventID, old: entry)
    }
}
