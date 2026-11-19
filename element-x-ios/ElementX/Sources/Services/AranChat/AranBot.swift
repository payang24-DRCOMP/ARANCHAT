//
// AranChat — บอทแจ้งเตือน: คำสั่ง / · เมนูเหนือช่องพิมพ์ · ปุ่มตอบด่วน · มินิแอป — เทียบ Android aranchat/AranBot.kt
//   รายการคำสั่ง/เมนู: GET https://chat.<เซิร์ฟเวอร์>/api/notify/bot (สาธารณะ ไม่มีข้อมูลส่วนบุคคล)
//   ใช้เฉพาะห้องที่บอท @aranchat:<เซิร์ฟเวอร์> เป็นสมาชิก (ห้องเหล่านี้ไม่เข้ารหัส บอทจึงอ่านคำสั่งได้)
//   คำสั่ง /lab 0012345: Element X iOS ตีความเองแค่ /join กับ /me → ที่เหลือส่งเป็นข้อความธรรมดาอยู่แล้ว
//
// SPDX-License-Identifier: AGPL-3.0-only
//

import Combine
import Compound
import Foundation
import MatrixRustSDK
import SwiftUI

nonisolated struct AranBotMenuItem: Hashable {
    let label: String
    let type: String // text | link | app
    let text: String?
    let url: URL?
    let prefill: Bool
}

nonisolated struct AranQuickReply: Hashable {
    let label: String
    let text: String
    let prefill: Bool
}

/// client ของ session ปัจจุบัน (ตั้งจาก ClientProxy.init) — ใช้ขอ OpenID token ให้มินิแอป
nonisolated enum AranSession {
    nonisolated(unsafe) static var client: ClientProtocol?
}

nonisolated enum AranBotAPI {
    nonisolated(unsafe) private static var cache: (menu: [AranBotMenuItem], at: Date)?

    /// เมนูบอท (แคช 60 วินาที · โหลดไม่ได้ใช้ของเดิม)
    static func menu(serverName: String) async -> [AranBotMenuItem] {
        if let cache, Date().timeIntervalSince(cache.at) < 60 { return cache.menu }
        guard let url = URL(string: "https://chat.\(serverName)/api/notify/bot") else { return [] }
        do {
            let (data, response) = try await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 8))
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw URLError(.badServerResponse) }
            let menu = ((json["menu"] as? [[String: Any]]) ?? []).prefix(8).compactMap { m -> AranBotMenuItem? in
                let label = String((m["label"] as? String ?? "").prefix(24))
                guard !label.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
                let type = ["link", "app"].contains(m["type"] as? String) ? m["type"] as! String : "text"
                let url = (m["url"] as? String).flatMap(URL.init(string:)).flatMap { ["https", "http"].contains($0.scheme) ? $0 : nil }
                return AranBotMenuItem(label: label, type: type, text: (m["text"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                                       url: url, prefill: m["prefill"] as? Bool ?? false)
            }
            cache = (menu, Date())
            return menu
        } catch {
            MXLog.warning("AranBot: load menu failed: \(error)")
            return cache?.menu ?? []
        }
    }

    /// ปุ่มตอบด่วนจาก JSON ของข้อความ (content["com.arankub.quick_replies"])
    static func quickReplies(eventJSON: String?) -> [AranQuickReply] {
        guard let data = eventJSON?.data(using: .utf8),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let list = (json["content"] as? [String: Any])?["com.arankub.quick_replies"] as? [[String: Any]] else { return [] }
        return list.prefix(6).compactMap { q in
            let label = String((q["label"] as? String ?? "").prefix(24))
            let text = String((q["text"] as? String ?? "").prefix(200))
            guard !label.trimmingCharacters(in: .whitespaces).isEmpty, !text.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            return AranQuickReply(label: label, text: text, prefill: q["prefill"] as? Bool ?? false)
        }
    }

    /// ที่อยู่มินิแอป + OpenID token ใน fragment (#aranchat_openid=…&aranchat_server=…) — fragment ไม่ถูกส่งไปกับคำขอ HTTP
    static func miniAppURL(_ url: URL) async throws -> URL {
        guard url.scheme == "https", let client = AranSession.client,
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { throw URLError(.unsupportedURL) }
        let token = try await client.requestOpenidToken()
        let allowed = CharacterSet.alphanumerics.union(.init(charactersIn: "-._~"))
        let extra = "aranchat_openid=\(token.accessToken.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")"
            + "&aranchat_server=\(token.matrixServerName.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")"
        components.percentEncodedFragment = [components.percentEncodedFragment, extra].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: "&")
        guard let result = components.url else { throw URLError(.badURL) }
        return result
    }
}

/// สถานะแถบบอทของห้องหนึ่ง (สร้างใน RoomScreenCoordinator)
@MainActor @Observable
final class AranBotBarModel {
    private(set) var isBotRoom = false
    private(set) var menu: [AranBotMenuItem] = []
    private(set) var quickReplies: [AranQuickReply] = []
    var isMenuOpen = true

    @ObservationIgnored private let roomProxy: JoinedRoomProxyProtocol
    @ObservationIgnored private let prefill: @MainActor (String) -> Void
    @ObservationIgnored private var cancellable: AnyCancellable?
    @ObservationIgnored private var botUserID: String

    init(roomProxy: JoinedRoomProxyProtocol, prefill: @escaping @MainActor (String) -> Void) {
        self.roomProxy = roomProxy
        self.prefill = prefill
        let server = roomProxy.ownUserID.split(separator: ":", maxSplits: 1).last.map(String.init) ?? ""
        botUserID = "@aranchat:\(server)"
        Task { await load(server: server) }
    }

    private func load(server: String) async {
        guard case let .success(member) = await roomProxy.getMember(userID: botUserID), member.membership == .join else { return }
        isBotRoom = true
        cancellable = roomProxy.timeline.timelineItemProvider.updatePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] items, _ in self?.updateQuickReplies(items) }
        updateQuickReplies(roomProxy.timeline.timelineItemProvider.itemProxies)
        menu = await AranBotAPI.menu(serverName: server)
    }

    /// ปุ่มตอบด่วนแสดงเฉพาะเมื่อข้อความล่าสุดในห้องมาจากบอท
    private func updateQuickReplies(_ items: [TimelineItemProxy]) {
        let newest = items.reversed().lazy.compactMap { item -> EventTimelineItemProxy? in
            if case let .event(event) = item { return event }
            return nil
        }.first
        guard let newest, newest.sender.id == botUserID else {
            if !quickReplies.isEmpty { quickReplies = [] }
            return
        }
        let replies = AranBotAPI.quickReplies(eventJSON: newest.item.lazyProvider.debugInfo().originalJson)
        if replies != quickReplies { quickReplies = replies }
    }

    func run(text: String?, prefill isPrefill: Bool) {
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        if isPrefill {
            prefill(text)
            return
        }
        // ส่งผ่านคิวของ timeline (ไม่ใช่ sendRaw) → ข้อความขึ้นทันที ไม่ต้องรอ sync รอบถัดไป
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            if case let .failure(error) = await roomProxy.timeline.sendMessage(body, html: nil, inReplyToEventID: nil, intentionalMentions: .empty) {
                MXLog.warning("AranBot: send failed: \(error)")
            }
        }
    }

    func open(_ item: AranBotMenuItem, openURL: OpenURLAction) {
        switch item.type {
        case "link":
            if let url = item.url { openURL(url) }
        case "app":
            guard let url = item.url else { return }
            Task {
                do {
                    openURL(try await AranBotAPI.miniAppURL(url))
                } catch {
                    MXLog.warning("AranBot: open mini app failed: \(error)")
                }
            }
        default:
            run(text: item.text, prefill: item.prefill)
        }
    }
}

/// แถบเหนือช่องพิมพ์ในห้องบอท: ปุ่มตอบด่วน (จากข้อความล่าสุดของบอท) + เมนูบอท
struct AranBotBar: View {
    @Bindable var model: AranBotBarModel
    @Environment(\.openURL) private var openURL

    var body: some View {
        if model.isBotRoom, !(model.quickReplies.isEmpty && model.menu.isEmpty) {
            VStack(alignment: .leading, spacing: 6) {
                if !model.quickReplies.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(model.quickReplies, id: \.self) { reply in
                                Button { model.run(text: reply.text, prefill: reply.prefill) } label: {
                                    Text(reply.label)
                                        .font(.compound.bodySMSemibold)
                                        .foregroundStyle(.compound.textActionAccent)
                                        .lineLimit(1)
                                        .padding(.horizontal, 14)
                                        .padding(.vertical, 6)
                                        .overlay(Capsule().stroke(Color.compound.textActionAccent, lineWidth: 1))
                                }
                            }
                        }
                        .padding(.vertical, 1)
                    }
                }
                if !model.menu.isEmpty {
                    Button { withAnimation(.easeInOut(duration: 0.2)) { model.isMenuOpen.toggle() } } label: {
                        Text(model.isMenuOpen ? "▾ ซ่อนเมนู" : "☰ เมนู")
                            .font(.compound.bodyXSSemibold)
                            .foregroundStyle(.compound.textSecondary)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 2)
                    }
                    if model.isMenuOpen {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: min(3, model.menu.count)), spacing: 6) {
                            ForEach(model.menu, id: \.self) { item in
                                Button { model.open(item, openURL: openURL) } label: {
                                    Text(item.label + (item.type == "text" ? "" : " ↗"))
                                        .font(.compound.bodySMSemibold)
                                        .foregroundStyle(.compound.textPrimary)
                                        .lineLimit(1)
                                        .truncationMode(.tail)
                                        .frame(maxWidth: .infinity)
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 9)
                                        .background(Color.compound.bgSubtleSecondary, in: RoundedRectangle(cornerRadius: 12))
                                }
                            }
                        }
                    }
                }
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 12)
            .padding(.top, 6)
            .padding(.bottom, 2)
        }
    }
}
