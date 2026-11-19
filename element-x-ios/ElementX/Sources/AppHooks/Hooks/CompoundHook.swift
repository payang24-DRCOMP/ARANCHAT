//
// Copyright 2025 Element Creations Ltd.
// Copyright 2025 New Vector Ltd.
//
// SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial.
// Please see LICENSE files in the repository root for full details.
//

import Compound
import SwiftUI
import UIKit

nonisolated protocol CompoundHookProtocol: Sendable {
    @MainActor func override(colors: CompoundColors, uiColors: CompoundUIColors)
}

/// AranChat: สีหลักของแบรนด์ (#5B3FD9) บนปุ่ม/ลิงก์/ไอคอนเน้น — ชุดเดียวกับ Android (`AranChatBrand.semanticColors`)
struct DefaultCompoundHook: CompoundHookProtocol {
    func override(colors: CompoundColors, uiColors: CompoundUIColors) {
        let brand = UIColor(red: 0x5B / 255, green: 0x3F / 255, blue: 0xD9 / 255, alpha: 1)
        let pressed = UIColor { $0.userInterfaceStyle == .dark ? brand : UIColor(red: 0x49 / 255, green: 0x32 / 255, blue: 0xAE / 255, alpha: 1) }
        // โหมดมืด: ปุ่มของ Element เป็นพื้นขาวตัวอักษรดำ → พื้นม่วงต้องใช้ตัวอักษรขาวเสมอ
        let onBrand = UIColor.white

        let solid: [(KeyPath<CompoundUIColorTokens, UIColor> & Sendable, KeyPath<CompoundColorTokens, Color> & Sendable, UIColor)] = [
            (\.bgActionPrimaryRest, \.bgActionPrimaryRest, brand),
            (\.bgActionPrimaryHovered, \.bgActionPrimaryHovered, pressed),
            (\.bgActionPrimaryPressed, \.bgActionPrimaryPressed, pressed),
            (\.bgAccentRest, \.bgAccentRest, brand),
            (\.bgAccentHovered, \.bgAccentHovered, pressed),
            (\.bgAccentPressed, \.bgAccentPressed, pressed),
            (\.iconAccentPrimary, \.iconAccentPrimary, brand),
            (\.iconAccentTertiary, \.iconAccentTertiary, brand),
            (\.textActionAccent, \.textActionAccent, brand),
            (\.textOnSolidPrimary, \.textOnSolidPrimary, onBrand),
            (\.iconOnSolidPrimary, \.iconOnSolidPrimary, onBrand)
        ]
        for (uiKeyPath, keyPath, color) in solid {
            uiColors.override(uiKeyPath, with: color)
            colors.override(keyPath, with: Color(uiColor: color))
        }

        // แสงไล่สีด้านบนหน้ารายการแชท (bloom) — เขียวของ Element → ม่วง
        let subtle: [(KeyPath<CompoundUIColorTokens, UIColor> & Sendable, KeyPath<CompoundColorTokens, Color> & Sendable, UIColor, Color)] = [
            (\.gradientSubtleStop1, \.gradientSubtleStop1, CompoundCoreUIColorTokens.alphaPurple500, CompoundCoreColorTokens.alphaPurple500),
            (\.gradientSubtleStop2, \.gradientSubtleStop2, CompoundCoreUIColorTokens.alphaPurple400, CompoundCoreColorTokens.alphaPurple400),
            (\.gradientSubtleStop3, \.gradientSubtleStop3, CompoundCoreUIColorTokens.alphaPurple300, CompoundCoreColorTokens.alphaPurple300),
            (\.gradientSubtleStop4, \.gradientSubtleStop4, CompoundCoreUIColorTokens.alphaPurple200, CompoundCoreColorTokens.alphaPurple200),
            (\.gradientSubtleStop5, \.gradientSubtleStop5, CompoundCoreUIColorTokens.alphaPurple100, CompoundCoreColorTokens.alphaPurple100)
        ]
        for (uiKeyPath, keyPath, uiColor, color) in subtle {
            uiColors.override(uiKeyPath, with: uiColor)
            colors.override(keyPath, with: color)
        }
    }
}
