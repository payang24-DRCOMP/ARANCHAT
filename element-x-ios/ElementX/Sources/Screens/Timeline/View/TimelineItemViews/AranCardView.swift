//
// AranChat — notification card in the timeline (same look as Android TimelineItemAranCardView / web AranCardBody).
// Supported here: header by level, fields with tones, text/fields/steps/table/stats sections, status, link/copy/app buttons,
// and "รับทราบ" (ack = reaction "✅ รับทราบ"). Action/datetime buttons need a raw send — see element-x-ios/aranchat/PORTING.md (D).
//
// SPDX-License-Identifier: AGPL-3.0-only
//

import SwiftUI

struct AranCardView: View {
    @Environment(\.timelineContext) private var context
    @Environment(\.openURL) private var openURL

    let card: AranCard
    let itemID: TimelineItemIdentifier
    let reactions: [AggregatedReaction]

    @State private var copiedLabel: String?

    private static let brand = Color(red: 0x5B / 255, green: 0x3F / 255, blue: 0xD9 / 255)
    private static let crit = Color(red: 0xDC / 255, green: 0x26 / 255, blue: 0x26 / 255)
    private static let ink = Color(red: 0x1E / 255, green: 0x1B / 255, blue: 0x4B / 255)
    private static let muted = Color(red: 0x6B / 255, green: 0x66 / 255, blue: 0x84 / 255)
    private static let ok = Color(red: 0x0E / 255, green: 0x7A / 255, blue: 0x55 / 255)
    private static let tint = Color(red: 0xF4 / 255, green: 0xF1 / 255, blue: 0xFC / 255)

    private var ackReaction: AggregatedReaction? {
        reactions.first { $0.key == AranCard.ackKey }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            VStack(alignment: .leading, spacing: 8) {
                if !card.fields.isEmpty { fieldsView(card.fields) }
                ForEach(card.lines, id: \.self) { Text($0).foregroundStyle(Self.ink) }
                ForEach(Array(card.sections.enumerated()), id: \.offset) { _, section in sectionView(section) }
                if let status = card.statusText {
                    Text((card.closed ? "✔ " : "") + status)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(toneColor(card.statusTone))
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(toneColor(card.statusTone).opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                }
                if let ack = ackReaction, !ack.senders.isEmpty {
                    Text("✅ รับทราบแล้ว \(ack.senders.count) คน").font(.footnote).foregroundStyle(Self.ok)
                }
                buttonsView
            }
            .padding(16)
            if let note = card.note {
                Text(note).font(.caption2).foregroundStyle(Self.muted)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(red: 0xFA / 255, green: 0xF9 / 255, blue: 0xFD / 255))
            }
        }
        .frame(maxWidth: 340)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                if card.urgent {
                    Text("ด่วน").font(.caption.bold()).foregroundStyle(Self.crit)
                        .padding(.horizontal, 8).background(Color.white, in: Capsule())
                }
                Text([card.urgent && card.icon == "🔴" ? "" : card.icon, [card.system, card.topic].filter { !$0.isEmpty }.joined(separator: " · ")]
                    .filter { !$0.isEmpty }.joined(separator: " "))
                    .font(.footnote.weight(.semibold)).foregroundStyle(.white.opacity(0.92))
            }
            Text(card.title).font(.headline).foregroundStyle(.white)
            if let subtitle = card.subtitle {
                Text(subtitle).font(.footnote).foregroundStyle(.white.opacity(0.9))
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(heroGradient)
    }

    private var heroGradient: LinearGradient {
        let pair: (Color, Color) = switch card.urgent ? "critical" : (card.level ?? "") {
        case "critical": (Color(red: 0xB9 / 255, green: 0x1C / 255, blue: 0x1C / 255), Color(red: 0xEF / 255, green: 0x44 / 255, blue: 0x44 / 255))
        case "warning": (Color(red: 0xB4 / 255, green: 0x53 / 255, blue: 0x09 / 255), Color(red: 0xF5 / 255, green: 0x9E / 255, blue: 0x0B / 255))
        case "success": (Color(red: 0x0E / 255, green: 0x7A / 255, blue: 0x55 / 255), Color(red: 0x16 / 255, green: 0xA3 / 255, blue: 0x4A / 255))
        case "info": (Color(red: 0x1D / 255, green: 0x4E / 255, blue: 0xD8 / 255), Color(red: 0x3B / 255, green: 0x82 / 255, blue: 0xF6 / 255))
        default: (Self.brand, Self.brand)
        }
        return LinearGradient(colors: [pair.0, pair.1], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    // MARK: - Content

    private func toneColor(_ tone: String?) -> Color {
        switch tone {
        case "crit": Self.crit
        case "high": Color(red: 0xC2 / 255, green: 0x41 / 255, blue: 0x0C / 255)
        case "low": Color(red: 0x1D / 255, green: 0x4E / 255, blue: 0xD8 / 255)
        case "ok": Self.ok
        case "muted": Self.muted
        default: Self.ink
        }
    }

    private func fieldsView(_ items: [AranCard.Field]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, field in
                HStack(alignment: .firstTextBaseline) {
                    Text(field.label).foregroundStyle(Self.muted).frame(width: 104, alignment: .leading)
                    Text(field.value + (field.tone == "crit" ? " ‼" : field.tone == "high" ? " ↑" : field.tone == "low" ? " ↓" : ""))
                        .fontWeight(field.tone == nil ? .medium : .bold)
                        .foregroundStyle(toneColor(field.tone))
                }
                .font(.subheadline)
            }
        }
    }

    @ViewBuilder
    private func sectionView(_ section: AranCard.Section) -> some View {
        Divider()
        switch section {
        case .text(let text):
            Text(text).font(.subheadline).foregroundStyle(Self.ink)
        case .fields(let title, let items):
            sectionTitle(title)
            fieldsView(items)
        case .steps(let title, let items):
            sectionTitle(title)
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, step in
                    HStack(spacing: 10) {
                        Circle()
                            .fill(step.state == "done" ? Self.ok : step.state == "current" ? Color.white : Color(white: 0.9))
                            .overlay(Circle().stroke(step.state == "current" ? Self.brand : .clear, lineWidth: 4))
                            .frame(width: 14, height: 14)
                        Text(step.label)
                            .fontWeight(step.state == "current" ? .bold : .regular)
                            .foregroundStyle(step.state == "todo" ? Self.muted : Self.ink)
                        Spacer()
                        if let time = step.time { Text(time).font(.caption).foregroundStyle(Self.muted) }
                    }
                    .font(.subheadline)
                }
            }
        case .table(let title, let columns, let rows, let tones):
            sectionTitle(title)
            Grid(alignment: .leading, horizontalSpacing: 8, verticalSpacing: 6) {
                GridRow { ForEach(columns, id: \.self) { Text($0).font(.caption.weight(.semibold)).foregroundStyle(Self.muted) } }
                ForEach(Array(rows.enumerated()), id: \.offset) { r, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { c, cell in
                            let tone = r < tones.count && c < tones[r].count ? tones[r][c] : ""
                            Text(cell).font(.subheadline).fontWeight(tone.isEmpty || tone == "ok" ? .regular : .bold)
                                .foregroundStyle(toneColor(tone.isEmpty ? nil : tone))
                        }
                    }
                }
            }
        case .stats(let title, let items):
            sectionTitle(title)
            HStack(spacing: 8) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, stat in
                    VStack(spacing: 2) {
                        Text(stat.value).font(.title3.bold()).foregroundStyle(toneColor(stat.tone))
                        Text(stat.label).font(.caption2).foregroundStyle(Self.muted)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 8)
                    .background(Self.tint, in: RoundedRectangle(cornerRadius: 12))
                }
            }
        }
    }

    @ViewBuilder
    private func sectionTitle(_ title: String?) -> some View {
        if let title { Text(title).font(.caption.bold()).foregroundStyle(Self.muted) }
    }

    // MARK: - Buttons

    private var buttonsView: some View {
        VStack(spacing: 8) {
            ForEach(Array(card.buttons.enumerated()), id: \.offset) { _, button in
                switch button.type {
                case "link", "app":
                    // TODO(AranChat): "app" should append #aranchat_openid=… (PORTING.md F) — opens without identity for now
                    pill(button.label + (button.type == "app" ? " ↗" : ""), style: button.style ?? "secondary") {
                        if let url = button.url { openURL(url) }
                    }
                case "copy":
                    pill(copiedLabel == button.label ? "คัดลอกแล้ว ✓" : button.label, style: button.style ?? "secondary") {
                        UIPasteboard.general.string = button.text
                        copiedLabel = button.label
                    }
                default:
                    // action / datetime: needs raw send of com.arankub.card_action (PORTING.md D) — hidden once the card is closed
                    if !card.closed {
                        pill(button.label + " (ใช้บนเว็บ/Android)", style: "secondary") { }
                            .disabled(true)
                    }
                }
            }
            if let link = card.link {
                pill(card.linkLabel, style: "secondary") { openURL(link) }
            }
            if card.ack {
                let acked = ackReaction?.isHighlighted ?? false
                pill(acked ? "รับทราบแล้ว ✓" : "รับทราบ", style: acked ? "done" : "primary") {
                    context?.send(viewAction: .toggleReaction(key: AranCard.ackKey, itemID: itemID))
                }
                .disabled(acked)
            }
        }
    }

    private func pill(_ title: String, style: String, action: @escaping () -> Void) -> some View {
        let primary = card.urgent || card.level == "critical" ? Self.crit : Self.brand
        let (background, foreground): (Color, Color) = switch style {
        case "primary": (primary, .white)
        case "danger": (.white, Self.crit)
        case "done": (Self.ok.opacity(0.1), Self.ok)
        default: (Self.tint, Self.brand)
        }
        return Button(action: action) {
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(foreground)
                .frame(maxWidth: .infinity).padding(.vertical, 10)
                .background(background, in: Capsule())
                .overlay(Capsule().stroke(style == "danger" ? Self.crit : .clear, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}
