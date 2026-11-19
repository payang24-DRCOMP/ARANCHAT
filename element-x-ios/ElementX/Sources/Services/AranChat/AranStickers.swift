//
// AranChat — สติกเกอร์ (หลายชุด + ใช้ล่าสุด + เคลื่อนไหวได้) — เทียบ Android messagecomposer/AranStickers.kt และเว็บ stickers.ts
//
// ชุดสติกเกอร์จาก server: https://chat.<โดเมน>/stickers/index.json — แอดมินเพิ่มชุดได้โดยไม่ต้องออกแอปใหม่
//   โหลดไม่ได้ = ใช้ index ที่จำไว้ครั้งก่อน (Caches)
// ส่งเป็น m.sticker มาตรฐาน — อัปโหลดรูปครั้งแรกที่ส่ง แล้วจำ mxc ใน account data "com.arankub.stickers"
//   { mxc: { "<key>@<ขนาดไฟล์>": mxc }, recent: ["<ชุด>/<id>", …] } · key ชุดพื้นฐาน (aran) = "<id>" · ชุดอื่น = "<ชุด>/<id>"
//   ใช้ร่วมกับเว็บ/Android — อ่านซ้ำก่อนเขียนทุกครั้ง
//
// SPDX-License-Identifier: AGPL-3.0-only
//

import Compound
import Foundation
import MatrixRustSDK
import SwiftUI

nonisolated struct AranSticker: Hashable, Identifiable {
    let packID: String
    let id: String
    let body: String
    let url: URL
    let w: Int
    let h: Int
    let size: Int
    let mime: String
    let animated: Bool

    var ref: String { "\(packID)/\(id)" }
}

nonisolated struct AranStickerPackData: Hashable, Identifiable {
    let id: String
    let name: String
    let icon: URL
    let stickers: [AranSticker]
}

nonisolated enum AranStickers {
    static let builtinID = "aran"
    private static let accountDataType = "com.arankub.stickers"
    private static let recentMax = 16
    /// ขนาดที่แสดงในแชท (ไฟล์จริง 2 เท่า) — ตรงกับเว็บ/Android
    private static let showSize = 160

    nonisolated(unsafe) private static var loaded: [AranStickerPackData]?

    private static var indexCacheURL: URL {
        URL.cachesDirectory.appending(path: "aranchat-stickers-index.json")
    }

    // MARK: - Packs

    static func packs() async -> [AranStickerPackData] {
        if let loaded { return loaded }
        guard let server = serverName, let indexURL = URL(string: "https://chat.\(server)/stickers/index.json") else { return [] }
        var data: Data?
        do {
            let (d, response) = try await URLSession.shared.data(for: URLRequest(url: indexURL, timeoutInterval: 8))
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            data = d
            try? d.write(to: indexCacheURL)
        } catch {
            MXLog.warning("AranStickers: load index failed, using cache: \(error)")
            data = try? Data(contentsOf: indexCacheURL) // ออฟไลน์: ใช้ชุดที่จำไว้ครั้งก่อน
        }
        let packs = data.map { parseIndex($0, base: indexURL) } ?? []
        if !packs.isEmpty { loaded = packs }
        return packs
    }

    static func parseIndex(_ data: Data, base: URL) -> [AranStickerPackData] {
        guard let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let packs = json["packs"] as? [[String: Any]] else { return [] }
        return packs.compactMap { p in
            guard let id = p["id"] as? String, id.range(of: "^[a-z0-9_-]{1,32}$", options: .regularExpression) != nil,
                  let list = p["stickers"] as? [[String: Any]] else { return nil }
            let stickers = list.compactMap { s -> AranSticker? in
                guard let sid = s["id"] as? String, let file = s["file"] as? String,
                      let url = URL(string: file, relativeTo: base)?.absoluteURL,
                      let w = s["w"] as? Int, let h = s["h"] as? Int, w > 0, h > 0 else { return nil }
                return AranSticker(packID: id, id: sid, body: s["body"] as? String ?? sid, url: url, w: w, h: h,
                                   size: s["size"] as? Int ?? 0,
                                   mime: (s["mime"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "image/png",
                                   animated: s["animated"] as? Bool ?? false)
            }
            guard let first = stickers.first else { return nil }
            let icon = (p["icon"] as? String).flatMap { URL(string: $0, relativeTo: base)?.absoluteURL } ?? first.url
            let name = (p["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? id
            return AranStickerPackData(id: id, name: name, icon: icon, stickers: stickers)
        }
    }

    static func recent() async -> [AranSticker] {
        let all = Dictionary((await packs()).flatMap(\.stickers).map { ($0.ref, $0) }, uniquingKeysWith: { a, _ in a })
        return (await readData()).recent.compactMap { all[$0] }
    }

    // MARK: - Sending

    /// ส่งสติกเกอร์เข้าห้อง (อัปโหลดรูปให้ถ้ายังไม่เคย) · threadRootID = ส่งในเธรด
    static func send(_ sticker: AranSticker, roomID: String, threadRootID: String?) async throws {
        guard let client = AranSession.client, let room = try client.getRoom(roomId: roomID) else { throw URLError(.resourceUnavailable) }
        let mxc = try await mxc(for: sticker, client: client)
        var info: [String: Any] = ["w": showSize, "h": showSize * sticker.h / sticker.w, "mimetype": sticker.mime, "size": sticker.size]
        if sticker.animated { info["org.matrix.msc4230.is_animated"] = true }
        var content: [String: Any] = ["body": sticker.body, "url": mxc, "info": info]
        if let threadRootID {
            content["m.relates_to"] = ["rel_type": "m.thread", "event_id": threadRootID, "is_falling_back": true,
                                       "m.in_reply_to": ["event_id": threadRootID]]
        }
        let json = String(decoding: try JSONSerialization.data(withJSONObject: content), as: UTF8.self)
        _ = try await room.sendRaw(eventType: "m.sticker", content: json, requestConfigOverride: nil)
        try? await writeData(client) { mxcMap, recent in
            (mxcMap, Array(([sticker.ref] + recent.filter { $0 != sticker.ref }).prefix(recentMax)))
        }
    }

    private static func cacheKey(_ sticker: AranSticker) -> String {
        (sticker.packID == builtinID ? sticker.id : sticker.ref) + "@\(sticker.size)"
    }

    private static func mxc(for sticker: AranSticker, client: ClientProtocol) async throws -> String {
        let key = cacheKey(sticker)
        if let mxc = (await readData()).mxc[key] { return mxc }
        let (bytes, _) = try await URLSession.shared.data(from: sticker.url)
        let mxc = try await client.uploadMedia(mimeType: sticker.mime, data: bytes, progressWatcher: nil)
        // อ่านซ้ำก่อนเขียน — อีกเครื่องอาจเพิ่มสติกเกอร์อื่นไว้ระหว่างอัปโหลด
        try? await writeData(client) { mxcMap, recent in (mxcMap.merging([key: mxc]) { _, new in new }, recent) }
        return mxc
    }

    // MARK: - Account data

    private static var serverName: String? {
        guard let userID = try? AranSession.client?.userId() else { return nil }
        return userID.split(separator: ":", maxSplits: 1).last.map(String.init)
    }

    private static func readData() async -> (mxc: [String: String], recent: [String]) {
        guard let client = AranSession.client,
              let raw = try? await client.accountData(eventType: accountDataType),
              let json = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any] else { return ([:], []) }
        return (json["mxc"] as? [String: String] ?? [:], json["recent"] as? [String] ?? [])
    }

    private static func writeData(_ client: ClientProtocol,
                                  change: ([String: String], [String]) -> ([String: String], [String])) async throws {
        let (mxc, recent) = await readData()
        let (newMxc, newRecent) = change(mxc, recent)
        guard newMxc != mxc || newRecent != recent else { return }
        let data = try JSONSerialization.data(withJSONObject: ["mxc": newMxc, "recent": newRecent])
        try await client.setAccountData(eventType: accountDataType, content: String(decoding: data, as: UTF8.self))
    }
}

// MARK: - Picker sheet

/// แผงสติกเกอร์ 4 คอลัมน์ + แท็บชุดด้านล่าง (🕘 ใช้ล่าสุด + ชุดต่างๆ) แตะแล้วส่งทันทีแบบ LINE
struct AranStickerSheet: View {
    let roomID: String
    let threadRootID: String?
    @Environment(\.dismiss) private var dismiss

    @State private var packs: [AranStickerPackData]?
    @State private var recent: [AranSticker] = []
    @State private var tab: String?
    @State private var sendingRef: String?
    @State private var failed = false

    private static let recentTab = "__recent"

    private var shown: [AranSticker] {
        tab == Self.recentTab ? recent : packs?.first { $0.id == tab }?.stickers ?? []
    }

    private var title: String {
        tab == Self.recentTab ? "ใช้ล่าสุด" : packs?.first { $0.id == tab }?.name ?? "สติกเกอร์"
    }

    var body: some View {
        VStack(spacing: 0) {
            Text(failed ? "ส่งสติกเกอร์ไม่สำเร็จ ลองใหม่อีกครั้ง" : title)
                .font(.compound.bodyMDSemibold)
                .foregroundStyle(failed ? .compound.textCriticalPrimary : .compound.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 4)
            if let packs {
                if packs.isEmpty {
                    Text("โหลดสติกเกอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่")
                        .font(.compound.bodyMD)
                        .foregroundStyle(.compound.textSecondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 4), spacing: 4) {
                            ForEach(shown) { sticker in
                                cell(sticker)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                    }
                    Divider()
                    tabs
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color.compound.bgCanvasDefault)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task {
            let loaded = await AranStickers.packs()
            recent = await AranStickers.recent()
            packs = loaded
            if tab == nil { tab = recent.isEmpty ? loaded.first?.id : Self.recentTab }
        }
    }

    private func cell(_ sticker: AranSticker) -> some View {
        Button {
            guard sendingRef == nil else { return }
            sendingRef = sticker.ref
            failed = false
            Task {
                do {
                    try await AranStickers.send(sticker, roomID: roomID, threadRootID: threadRootID)
                    dismiss()
                } catch {
                    MXLog.error("AranStickers: send failed: \(error)")
                    failed = true
                }
                sendingRef = nil
            }
        } label: {
            AsyncImage(url: sticker.url) { image in
                image.resizable().scaledToFit()
            } placeholder: {
                Color.compound.bgSubtleSecondary.opacity(0.5)
            }
            .aspectRatio(1, contentMode: .fit)
            .padding(4)
            .opacity(sendingRef == nil || sendingRef == sticker.ref ? 1 : 0.4)
            .overlay { if sendingRef == sticker.ref { ProgressView() } }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("ส่งสติกเกอร์ \(sticker.body)")
    }

    private var tabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                if !recent.isEmpty {
                    tabButton(id: Self.recentTab, label: "ใช้ล่าสุด") { Text("🕘").font(.title3) }
                }
                ForEach(packs ?? []) { pack in
                    tabButton(id: pack.id, label: pack.name) {
                        AsyncImage(url: pack.icon) { $0.resizable().scaledToFit() } placeholder: { Color.clear }
                            .frame(width: 32, height: 32)
                    }
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
        .background(Color.compound.bgSubtleSecondary)
    }

    private func tabButton(id: String, label: String, @ViewBuilder content: () -> some View) -> some View {
        Button { tab = id } label: {
            content()
                .frame(width: 48, height: 42)
                .background(tab == id ? Color.compound.bgCanvasDefault : .clear, in: RoundedRectangle(cornerRadius: 10))
                .opacity(tab == id ? 1 : 0.6)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}
