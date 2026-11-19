//
// AranChat — แท็บ "เพื่อน" แบบ LINE (แทนแท็บ Spaces): รายชื่อเจ้าหน้าที่ทั้งหมด แตะชื่อแล้วเข้าแชทส่วนตัว
//   (มีอยู่แล้วเปิดห้องเดิม ไม่มีสร้างใหม่) — เทียบ Android home/impl/friends/AranFriends.kt และเว็บ AranChatFriends.tsx
//   รายชื่อ = สมาชิก "ห้องรวมเจ้าหน้าที่" #staff:<เซิร์ฟเวอร์> (ผู้ใช้ทุกคนเข้าอัตโนมัติ)
//   ปุ่มชวนเพื่อน: POST https://chat.<เซิร์ฟเวอร์>/api/notify/invite/create {openid} → แชร์ลิงก์ผ่าน LINE ฯลฯ
//
// SPDX-License-Identifier: AGPL-3.0-only
//

import Compound
import SwiftUI
import UIKit

nonisolated struct AranFriend: Identifiable, Hashable {
    let id: String // user id
    let displayName: String?
    let avatarURL: URL?

    var name: String { displayName.flatMap { $0.isEmpty ? nil : $0 } ?? id }
}

nonisolated enum AranInvite {
    struct Link: Equatable {
        let url: String
        /// จำนวนคนที่เข้ามาผ่านลิงก์นี้แล้ว
        let joined: Int
    }

    /// สร้าง (หรือใช้ซ้ำ) ลิงก์ชวน — roomID = แชร์กลุ่ม · nil = ชวนคุยกับฉัน
    static func create(roomID: String? = nil) async throws -> String {
        try await createLink(roomID: roomID).url
    }

    static func createLink(roomID: String? = nil) async throws -> Link {
        guard let client = AranSession.client else { throw URLError(.userAuthenticationRequired) }
        let server = try client.userId().split(separator: ":", maxSplits: 1).last.map(String.init) ?? ""
        guard let url = URL(string: "https://chat.\(server)/api/notify/invite/create") else { throw URLError(.badURL) }
        let token = try await client.requestOpenidToken()
        var body: [String: Any] = ["openid": ["access_token": token.accessToken, "token_type": token.tokenType,
                                              "matrix_server_name": token.matrixServerName, "expires_in": token.expiresInSeconds]]
        if let roomID { body["room_id"] = roomID }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let link = json["url"] as? String else { throw URLError(.badServerResponse) }
        return Link(url: link, joined: (json["joined"] as? NSNumber)?.intValue ?? 0)
    }

    /// ข้อความชวนสำหรับส่งทาง LINE / แอปอื่น (เหมือน Android aranInviteText)
    static func text(myName: String?, url: String) -> String {
        "มาคุยกับ\(myName.flatMap { $0.isEmpty ? nil : " \($0)" } ?? "ฉัน") บน AranChat แอปแชทของบุคลากร 👉 \(url)"
    }
}

@MainActor @Observable
final class AranFriendsModel {
    private(set) var friends: [AranFriend] = []
    private(set) var loading = true
    private(set) var opening: String?
    private(set) var inviting = false
    private(set) var inviteError = false
    var shareItem: AranShareItem?
    var errorMessage: String?

    @ObservationIgnored private let userSession: UserSessionProtocol
    @ObservationIgnored private let openRoom: @MainActor (String) -> Void
    @ObservationIgnored private var membersTask: Task<Void, Never>?

    var mediaProvider: MediaProviderProtocol { userSession.mediaProvider }

    init(userSession: UserSessionProtocol, openRoom: @escaping @MainActor (String) -> Void) {
        self.userSession = userSession
        self.openRoom = openRoom
    }

    func load() async {
        guard friends.isEmpty else { return }
        let client = userSession.clientProxy
        guard let server = client.userIDServerName,
              case let .success(resolved) = await client.resolveRoomAlias("#staff:\(server)"),
              case let .joined(room) = await client.roomForIdentifier(resolved.roomId) else {
            loading = false
            return
        }
        await room.updateMembers()
        let me = client.userID
        let collator = { (a: AranFriend, b: AranFriend) in
            a.name.compare(b.name, options: [.caseInsensitive], locale: Locale(identifier: "th")) == .orderedAscending
        }
        for await members in room.membersPublisher.values {
            friends = members
                .filter { $0.membership == .join && $0.userID != me && !$0.userID.hasPrefix("@aranchat:") }
                .map { AranFriend(id: $0.userID, displayName: $0.displayName, avatarURL: $0.avatarURL) }
                .sorted(by: collator)
            loading = false
        }
    }

    func open(_ friend: AranFriend) {
        guard opening == nil else { return }
        let client = userSession.clientProxy
        if case let .success(.some(roomID)) = client.directRoomForUserID(friend.id) {
            openRoom(roomID)
            return
        }
        opening = friend.id
        Task {
            defer { opening = nil }
            let parameters = userSession.userHooks.startChatScreenHook.update(.directRoom(userID: friend.id))
            switch await client.createRoom(parameters) {
            case .success(let roomID):
                openRoom(roomID)
            case .failure(let error):
                MXLog.error("AranFriends: create DM failed: \(error)")
                errorMessage = L10n.screenStartChatErrorStartingChat
            }
        }
    }

    func invite() {
        guard !inviting else { return }
        inviting = true
        inviteError = false
        Task {
            defer { inviting = false }
            do {
                let url = try await AranInvite.create()
                shareItem = AranShareItem(text: AranInvite.text(myName: userSession.clientProxy.userProfilePublisher.value.displayName, url: url))
            } catch {
                MXLog.warning("AranFriends: create invite failed: \(error)")
                inviteError = true
            }
        }
    }
}

struct AranShareItem: Identifiable {
    let id = UUID()
    let text: String
}

struct AranFriendsScreen: View {
    @Bindable var model: AranFriendsModel
    @State private var query = ""

    private var shown: [AranFriend] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return model.friends }
        return model.friends.filter { $0.name.localizedCaseInsensitiveContains(q) || $0.id.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        List {
            Section {
                Button { model.invite() } label: {
                    HStack(spacing: 8) {
                        if model.inviting {
                            ProgressView().tint(.compound.textOnSolidPrimary)
                        } else {
                            CompoundIcon(\.shareIos, size: .small, relativeTo: .compound.bodyLGSemibold)
                        }
                        Text(model.inviteError ? "ลองอีกครั้ง — ชวนเพื่อนมาใช้ AranChat" : "ชวนเพื่อนมาใช้ AranChat")
                    }
                }
                .buttonStyle(.compound(.primary))
                .disabled(model.inviting)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            } footer: {
                if !model.loading {
                    Text(model.friends.isEmpty ? "ยังไม่มีรายชื่อเจ้าหน้าที่" : "เจ้าหน้าที่ทั้งหมด \(model.friends.count) คน · แตะชื่อเพื่อเริ่มแชท")
                        .font(.compound.bodySM)
                        .foregroundStyle(.compound.textSecondary)
                }
            }

            Section {
                ForEach(shown) { friend in
                    Button { model.open(friend) } label: { row(friend) }
                        .buttonStyle(.plain)
                        .disabled(model.opening != nil)
                }
            }
        }
        .listStyle(.plain)
        .overlay { if model.loading { ProgressView() } }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "ค้นหาชื่อเพื่อน")
        .navigationTitle("เพื่อน")
        .navigationBarTitleDisplayMode(.large)
        .background(Color.compound.bgCanvasDefault)
        .task { await model.load() }
        .sheet(item: $model.shareItem) { item in
            AranActivityView(items: [item.text])
                .presentationDetents([.medium, .large])
        }
        .alert(L10n.commonError, isPresented: Binding(get: { model.errorMessage != nil }, set: { if !$0 { model.errorMessage = nil } })) {
            Button(L10n.actionOk) { }
        } message: {
            Text(model.errorMessage ?? "")
        }
    }

    private func row(_ friend: AranFriend) -> some View {
        HStack(spacing: 12) {
            LoadableAvatarImage(url: friend.avatarURL, name: friend.name, contentID: friend.id,
                                avatarSize: .user(on: .startChat), mediaProvider: model.mediaProvider)
            VStack(alignment: .leading, spacing: 2) {
                Text(friend.name)
                    .font(.compound.bodyLG)
                    .foregroundStyle(.compound.textPrimary)
                    .lineLimit(1)
                Text(friend.id)
                    .font(.compound.bodySM)
                    .foregroundStyle(.compound.textSecondary)
                    .lineLimit(1)
            }
            Spacer()
            if model.opening == friend.id { ProgressView() }
        }
        .contentShape(Rectangle())
        .padding(.vertical, 4)
    }
}

/// หน้าแชร์ของเครื่อง (LINE / ข้อความ / อีเมล …)
struct AranActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) { }
}

final class AranFriendsScreenCoordinator: CoordinatorProtocol {
    private let model: AranFriendsModel

    init(userSession: UserSessionProtocol, openRoom: @escaping @MainActor (String) -> Void) {
        model = AranFriendsModel(userSession: userSession, openRoom: openRoom)
    }

    func toPresentable() -> AnyView {
        AnyView(AranFriendsScreen(model: model))
    }
}
