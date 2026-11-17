//
// AranChat — การ์ดแจ้งเตือน (content["com.arankub.card"] จากบอท @aranchat) · สเปก: server/notify/cardkit.mjs
// ชุดเดียวกับ Android (AranCard.kt) และเว็บ (AranCardBody.tsx)
//
// SPDX-License-Identifier: AGPL-3.0-only
//

import Foundation

nonisolated struct AranCard: Hashable {
    nonisolated struct Field: Hashable {
        let label: String
        let value: String
        let tone: String?
    }

    nonisolated struct Step: Hashable {
        let label: String
        let time: String?
        /// done | current | todo
        let state: String
    }

    nonisolated struct Stat: Hashable {
        let label: String
        let value: String
        let tone: String?
    }

    nonisolated enum Section: Hashable {
        case text(String)
        case fields(title: String?, items: [Field])
        case steps(title: String?, items: [Step])
        case table(title: String?, columns: [String], rows: [[String]], tones: [[String]])
        case stats(title: String?, items: [Stat])
    }

    nonisolated struct Button: Hashable {
        /// link | copy | action | datetime | app
        let type: String
        let label: String
        let style: String?
        let url: URL?
        let text: String?
        let id: String?
        let confirm: String?
        let mode: String?
    }

    static let contentKey = "com.arankub.card"
    static let actionKey = "com.arankub.card_action"
    static let ackKey = "✅ รับทราบ"

    let system: String
    let topic: String
    let icon: String
    let title: String
    let subtitle: String?
    let urgent: Bool
    let level: String?
    let color: String?
    let fields: [Field]
    let lines: [String]
    let sections: [Section]
    let buttons: [Button]
    let link: URL?
    let linkLabel: String
    let ack: Bool
    let note: String?
    let statusText: String?
    let statusTone: String?
    let closed: Bool

    /// บอทแจ้งเตือน — อ่านการ์ดเฉพาะข้อความจากบอท
    static func isCardSender(_ userID: String) -> Bool {
        userID.hasPrefix("@aranchat:")
    }

    /// การ์ดจาก JSON ของเหตุการณ์ · ใช้การแก้ไขล่าสุด (บอทแก้การ์ดเมื่อมีคนกดปุ่ม: แสดงผล + ซ่อนปุ่ม) ถ้ามี
    static func from(originalJSON: String?, latestEditJSON: String?) -> AranCard? {
        let edited = latestEditJSON.flatMap(object(from:)).flatMap { ($0["content"] as? [String: Any])?["m.new_content"] as? [String: Any] }
        let content = edited ?? originalJSON.flatMap(object(from:)).flatMap { $0["content"] as? [String: Any] }
        guard let card = content?[contentKey] as? [String: Any] else { return nil }
        return AranCard(json: card)
    }

    private static func object(from json: String) -> [String: Any]? {
        guard let data = json.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private init?(json c: [String: Any]) {
        func str(_ key: String, _ max: Int, in dict: [String: Any]? = nil) -> String {
            String(((dict ?? c)[key] as? String ?? "").prefix(max))
        }
        func tone(_ value: Any?) -> String? {
            guard let value = value as? String, ["crit", "high", "low", "ok", "muted"].contains(value) else { return nil }
            return value
        }
        func fields(_ value: Any?) -> [Field] {
            (value as? [Any] ?? []).prefix(16).compactMap { item in
                guard let array = item as? [Any], array.count >= 2, let label = array[0] as? String, let value = array[1] as? String else { return nil }
                return Field(label: String(label.prefix(40)), value: String(value.prefix(300)), tone: tone(array.count > 2 ? array[2] : nil))
            }
        }
        func url(_ value: String) -> URL? {
            value.hasPrefix("https://") || value.hasPrefix("http://") ? URL(string: value) : nil
        }

        let title = str("title", 200)
        guard !title.isEmpty else { return nil }
        self.title = title
        system = str("system", 60)
        topic = str("topic", 80)
        icon = str("icon", 8)
        subtitle = str("subtitle", 160).nilIfEmpty
        urgent = c["urgent"] as? Bool ?? false
        level = ["info", "success", "warning", "critical"].contains(str("level", 10)) ? str("level", 10) : nil
        color = str("color", 7).range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil ? str("color", 7) : nil
        self.fields = fields(c["fields"])
        lines = (c["lines"] as? [Any] ?? []).prefix(12).compactMap { ($0 as? String).map { String($0.prefix(300)) } }
        link = url(str("link", 2000))
        linkLabel = str("link_label", 40).nilIfEmpty ?? "เปิดดู"
        ack = c["ack"] as? Bool ?? false
        note = str("note", 200).nilIfEmpty
        let status = c["status"] as? [String: Any]
        let statusValue = status.map { str("text", 120, in: $0) }?.nilIfEmpty
        statusText = statusValue
        statusTone = tone(status?["tone"]) ?? (statusValue == nil ? nil : "ok")
        closed = c["closed"] as? Bool ?? false

        sections = (c["sections"] as? [Any] ?? []).prefix(8).compactMap { raw -> Section? in
            guard let x = raw as? [String: Any] else { return nil }
            let title = str("title", 60, in: x).nilIfEmpty
            switch x["type"] as? String {
            case "text":
                return str("text", 1000, in: x).nilIfEmpty.map { .text($0) }
            case "fields":
                let items = fields(x["items"])
                return items.isEmpty ? nil : .fields(title: title, items: items)
            case "steps":
                let items = (x["items"] as? [Any] ?? []).prefix(8).compactMap { item -> Step? in
                    guard let s = item as? [String: Any], let label = (s["label"] as? String)?.nilIfEmpty else { return nil }
                    let state = s["state"] as? String
                    return Step(label: String(label.prefix(80)), time: (s["time"] as? String)?.nilIfEmpty,
                                state: state == "done" || state == "current" ? state! : "todo")
                }
                return items.isEmpty ? nil : .steps(title: title, items: items)
            case "table":
                let columns = (x["columns"] as? [Any] ?? []).prefix(4).map { String(($0 as? String ?? "").prefix(30)) }
                let rows = (x["rows"] as? [Any] ?? []).prefix(20).compactMap { row -> [String]? in
                    guard let row = row as? [Any] else { return nil }
                    return columns.indices.map { $0 < row.count ? String((row[$0] as? String ?? "").prefix(60)) : "" }
                }
                let tones = (x["tones"] as? [Any] ?? []).prefix(20).map { row -> [String] in
                    let row = row as? [Any] ?? []
                    return columns.indices.map { $0 < row.count ? tone(row[$0]) ?? "" : "" }
                }
                return columns.isEmpty || rows.isEmpty ? nil : .table(title: title, columns: columns, rows: rows, tones: tones)
            case "stats":
                let items = (x["items"] as? [Any] ?? []).prefix(4).compactMap { item -> Stat? in
                    guard let s = item as? [String: Any], let label = (s["label"] as? String)?.nilIfEmpty,
                          let value = (s["value"] as? String)?.nilIfEmpty else { return nil }
                    return Stat(label: String(label.prefix(30)), value: String(value.prefix(20)), tone: tone(s["tone"]))
                }
                return items.isEmpty ? nil : .stats(title: title, items: items)
            default:
                return nil
            }
        }

        buttons = (c["buttons"] as? [Any] ?? []).prefix(4).compactMap { raw -> Button? in
            guard let b = raw as? [String: Any], let label = (b["label"] as? String)?.nilIfEmpty, let type = b["type"] as? String else { return nil }
            let style = ["primary", "secondary", "danger"].contains(b["style"] as? String ?? "") ? b["style"] as? String : nil
            let id = (b["id"] as? String).flatMap { $0.range(of: "^[\\w.-]{1,40}$", options: .regularExpression) != nil ? $0 : nil }
            switch type {
            case "link":
                return url(b["url"] as? String ?? "").map { Button(type: type, label: label, style: style, url: $0, text: nil, id: nil, confirm: nil, mode: nil) }
            case "app":
                let value = b["url"] as? String ?? ""
                return value.hasPrefix("https://") ? URL(string: value).map { Button(type: type, label: label, style: style, url: $0, text: nil, id: nil, confirm: nil, mode: nil) } : nil
            case "copy":
                return (b["text"] as? String)?.nilIfEmpty.map { Button(type: type, label: label, style: style, url: nil, text: String($0.prefix(200)), id: nil, confirm: nil, mode: nil) }
            case "action", "datetime":
                return id.map { Button(type: type, label: label, style: style, url: nil, text: nil, id: $0,
                                       confirm: (b["confirm"] as? String)?.nilIfEmpty, mode: b["mode"] as? String) }
            default:
                return nil
            }
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
