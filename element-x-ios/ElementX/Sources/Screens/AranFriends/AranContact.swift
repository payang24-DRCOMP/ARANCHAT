//
// AranChat — การ์ดแนะนำเพื่อน (แบบ LINE) — เทียบ Android AranContact.kt / AranContacts.kt / TimelineItemAranContactView.kt และเว็บ AranContact.tsx
//   ส่ง: เมนู + → แนะนำเพื่อน → เลือกเพื่อน → m.text body "👤 แนะนำเพื่อน: <ชื่อ>\n<ลิงก์>" + "com.arankub.contact": { user_id, name, avatar_url }
//   แสดง: ข้อความที่ body ขึ้นต้น "👤 " และมี com.arankub.contact → การ์ด รูป + ชื่อ + ปุ่ม "ดูโปรไฟล์ / แชท"
//   ห้องเข้ารหัส: ทั้งข้อความถูกเข้ารหัส (sendRaw ของ Rust SDK เข้ารหัสให้)
//
// SPDX-License-Identifier: AGPL-3.0-only
//

import Compound
import MatrixRustSDK
import SwiftUI

nonisolated struct AranContact: Hashable {
    static let contentKey = "com.arankub.contact"
    /// ข้อความการ์ดขึ้นต้นด้วยคำนี้เสมอ — อ่าน JSON เฉพาะข้อความที่ใช่
    static let bodyPrefix = "👤 "

    let userID: String
    let name: String
    let avatarURL: URL?

    static func from(originalJSON: String?) -> AranContact? {
        guard let data = originalJSON?.data(using: .utf8),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let c = (json["content"] as? [String: Any])?[contentKey] as? [String: Any],
              let userID = c["user_id"] as? String,
              userID.range(of: "^@[^:\\s]+:\\S+$", options: .regularExpression) != nil else { return nil }
        let name = String((c["name"] as? String ?? "").prefix(80))
        let avatar = (c["avatar_url"] as? String).flatMap { $0.hasPrefix("mxc://") ? URL(string: $0) : nil }
        return AranContact(userID: userID, name: name.trimmingCharacters(in: .whitespaces).isEmpty ? userID : name, avatarURL: avatar)
    }

    /// ส่งการ์ดแนะนำเพื่อนเข้าห้อง (threadRootID = ส่งในเธรด)
    static func send(_ friend: AranFriend, roomID: String, threadRootID: String?) async throws {
        guard let client = AranSession.client, let room = try client.getRoom(roomId: roomID) else { throw AranBoardError.noRoom }
        let server = try client.userId().split(separator: ":", maxSplits: 1).last.map(String.init) ?? ""
        var contact: [String: Any] = ["user_id": friend.id, "name": friend.name]
        if let avatar = friend.avatarURL?.absoluteString, avatar.hasPrefix("mxc://") { contact["avatar_url"] = avatar }
        var content: [String: Any] = ["msgtype": "m.text",
                                      "body": "👤 แนะนำเพื่อน: \(friend.name)\nhttps://chat.\(server)/#/user/\(friend.id)",
                                      contentKey: contact]
        if let threadRootID {
            content["m.relates_to"] = ["rel_type": "m.thread", "event_id": threadRootID, "is_falling_back": true,
                                       "m.in_reply_to": ["event_id": threadRootID]]
        }
        let json = String(decoding: try JSONSerialization.data(withJSONObject: content), as: UTF8.self)
        _ = try await room.sendRaw(eventType: "m.room.message", content: json, requestConfigOverride: nil)
    }
}

// MARK: - Card in timeline

/// การ์ดแนะนำเพื่อนในห้องแชท: รูป + ชื่อ + ปุ่ม "ดูโปรไฟล์ / แชท" (เปิดหน้าโปรไฟล์ในแอป มีปุ่มส่งข้อความ)
struct AranContactCardView: View {
    @Environment(\.timelineContext) private var context
    let contact: AranContact

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("แนะนำเพื่อน")
                .font(.compound.bodySMSemibold)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(LinearGradient(colors: [Color(red: 0x8B / 255, green: 0x5C / 255, blue: 0xF6 / 255),
                                                    Color(red: 0x5B / 255, green: 0x3F / 255, blue: 0xD9 / 255)],
                                           startPoint: .leading, endPoint: .trailing))
            HStack(spacing: 12) {
                LoadableAvatarImage(url: contact.avatarURL, name: contact.name, contentID: contact.userID,
                                    avatarSize: .user(on: .startChat), mediaProvider: context?.mediaProvider)
                VStack(alignment: .leading, spacing: 2) {
                    Text(contact.name)
                        .font(.compound.bodyLGSemibold)
                        .foregroundStyle(Color(red: 0x1E / 255, green: 0x13 / 255, blue: 0x50 / 255))
                        .lineLimit(1)
                    Text(String(contact.userID.dropFirst().split(separator: ":").first ?? ""))
                        .font(.compound.bodySM)
                        .foregroundStyle(Color(red: 0x64 / 255, green: 0x74 / 255, blue: 0x8B / 255))
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            Divider()
            Button {
                context?.send(viewAction: .tappedOnSenderDetails(sender: TimelineItemSender(id: contact.userID,
                                                                                          displayName: contact.name,
                                                                                          avatarURL: contact.avatarURL)))
            } label: {
                Text("ดูโปรไฟล์ / แชท")
                    .font(.compound.bodyMDSemibold)
                    .foregroundStyle(Color(red: 0x5B / 255, green: 0x3F / 255, blue: 0xD9 / 255))
                    .frame(maxWidth: .infinity)
                    .padding(12)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .frame(width: 240)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }
}

// MARK: - Picker sheet

/// แผงเลือกเพื่อนเพื่อส่งการ์ดแนะนำเพื่อน — เพื่อน = สมาชิกห้องรวมเจ้าหน้าที่ ยกเว้นตัวเอง บอท และคนที่อยู่ในห้องนี้แล้ว
struct AranContactSheet: View {
    let roomID: String
    let threadRootID: String?
    @Environment(\.dismiss) private var dismiss

    @State private var friends: [AranFriend]?
    @State private var query = ""
    @State private var sending: String?
    @State private var failed = false

    private var mediaProvider: MediaProviderProtocol? { AranRoomContext.get(roomID)?.userSession.mediaProvider }

    private var shown: [AranFriend] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return friends ?? [] }
        return (friends ?? []).filter { $0.name.localizedCaseInsensitiveContains(q) || $0.id.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if let friends {
                    List {
                        if failed {
                            Text("ส่งไม่สำเร็จ ลองอีกครั้ง").foregroundStyle(.compound.textCriticalPrimary)
                        }
                        ForEach(shown) { friend in
                            Button { send(friend) } label: { row(friend) }
                                .buttonStyle(.plain)
                                .disabled(sending != nil)
                        }
                        if shown.isEmpty {
                            Text(friends.isEmpty ? "ยังไม่มีรายชื่อเพื่อน" : "ไม่พบ \"\(query)\"")
                                .foregroundStyle(.compound.textSecondary)
                        }
                    }
                    .listStyle(.plain)
                    .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "ค้นหาชื่อเพื่อน")
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle("แนะนำเพื่อน")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.actionCancel) { dismiss() }
                }
            }
            .safeAreaInset(edge: .top) {
                Text("เลือกเพื่อนที่จะแนะนำให้คนในแชทนี้")
                    .font(.compound.bodySM)
                    .foregroundStyle(.compound.textSecondary)
                    .padding(.bottom, 4)
            }
        }
        .presentationDetents([.medium, .large])
        .task { await load() }
    }

    private func row(_ friend: AranFriend) -> some View {
        HStack(spacing: 12) {
            LoadableAvatarImage(url: friend.avatarURL, name: friend.name, contentID: friend.id,
                                avatarSize: .user(on: .startChat), mediaProvider: mediaProvider)
            VStack(alignment: .leading, spacing: 2) {
                Text(friend.name).font(.compound.bodyLG).foregroundStyle(.compound.textPrimary).lineLimit(1)
                Text(friend.id).font(.compound.bodySM).foregroundStyle(.compound.textSecondary).lineLimit(1)
            }
            Spacer()
            if sending == friend.id { ProgressView() }
        }
        .contentShape(Rectangle())
    }

    private func load() async {
        guard friends == nil, let context = AranRoomContext.get(roomID) else {
            if friends == nil { friends = [] }
            return
        }
        let client = context.userSession.clientProxy
        let here = Set(context.roomProxy.membersPublisher.value.filter { $0.membership == .join || $0.membership == .invite }.map(\.userID))
        guard let server = client.userIDServerName,
              case let .success(resolved) = await client.resolveRoomAlias("#staff:\(server)"),
              case let .joined(staff) = await client.roomForIdentifier(resolved.roomId) else {
            friends = []
            return
        }
        await staff.updateMembers()
        let me = client.userID
        friends = staff.membersPublisher.value
            .filter { $0.membership == .join && $0.userID != me && !here.contains($0.userID) && !$0.userID.hasPrefix("@aranchat:") }
            .map { AranFriend(id: $0.userID, displayName: $0.displayName, avatarURL: $0.avatarURL) }
            .sorted { $0.name.compare($1.name, options: .caseInsensitive, locale: Locale(identifier: "th")) == .orderedAscending }
    }

    private func send(_ friend: AranFriend) {
        sending = friend.id
        failed = false
        Task {
            do {
                try await AranContact.send(friend, roomID: roomID, threadRootID: threadRootID)
                dismiss()
            } catch {
                MXLog.error("AranContact: send failed: \(error)")
                failed = true
            }
            sending = nil
        }
    }
}
