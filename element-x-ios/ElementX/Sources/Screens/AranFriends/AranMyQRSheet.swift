//
// AranChat — "QR โค้ดของฉัน / ชวนเพื่อน" บนหน้าตั้งค่า แบบ LINE — เทียบ Android preferences/root/AranMyQrSection.kt
//   ให้เพื่อนสแกน หรือแชร์ลิงก์ทาง LINE/แอปอื่น → เพื่อนเปิดลิงก์ → ล็อกอินด้วย AranKub → เข้าแชทกับเราทันที
//   ลิงก์จาก POST https://chat.<เซิร์ฟเวอร์>/api/notify/invite/create {openid} (ใช้ลิงก์เดิมซ้ำ)
//
// SPDX-License-Identifier: AGPL-3.0-only
//

import Compound
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

/// แถว "QR โค้ดของฉัน / ชวนเพื่อน" ใต้โปรไฟล์ — แตะแล้วขึ้นแผง QR จากด้านล่าง
struct AranMyQRRow: View {
    let myName: String?
    @State private var open = false

    var body: some View {
        ListRow(label: .default(title: "QR โค้ดของฉัน / ชวนเพื่อน",
                                description: "ให้เพื่อนสแกนหรือส่งลิงก์ เพื่อเริ่มแชทกับคุณ",
                                icon: \.qrCode),
                kind: .navigationLink { open = true })
            .sheet(isPresented: $open) {
                AranMyQRSheet(myName: myName)
            }
    }
}

struct AranMyQRSheet: View {
    let myName: String?

    @State private var invite: AranInvite.Link?
    @State private var failed = false
    @State private var copied = false
    @State private var shareItem: AranShareItem?

    var body: some View {
        VStack(spacing: 10) {
            Text("QR โค้ดของฉัน")
                .font(.compound.headingSMSemibold)
                .foregroundStyle(.compound.textPrimary)
            Text("ให้เพื่อนสแกน หรือส่งลิงก์ — เพื่อนเปิดแล้วเริ่มแชทกับคุณได้ทันที")
                .font(.compound.bodySM)
                .foregroundStyle(.compound.textSecondary)
                .multilineTextAlignment(.center)
            ZStack {
                RoundedRectangle(cornerRadius: 16).fill(Color.white)
                if let invite, let image = Self.qrImage(invite.url) {
                    Image(uiImage: image)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .padding(10)
                        .accessibilityLabel("QR โค้ดลิงก์ชวน")
                } else if failed {
                    Button("ลองอีกครั้ง") { Task { await load() } }
                        .buttonStyle(.compound(.secondary, size: .medium))
                        .fixedSize()
                } else {
                    ProgressView()
                }
            }
            .frame(width: 220, height: 220)
            Text(invite?.url ?? (failed ? "สร้างลิงก์ไม่สำเร็จ" : "กำลังสร้างลิงก์…"))
                .font(.compound.bodySM)
                .foregroundStyle(failed ? .compound.textCriticalPrimary : .compound.textSecondary)
                .textSelection(.enabled)
            if let invite {
                HStack(spacing: 8) {
                    Button {
                        shareItem = AranShareItem(text: AranInvite.text(myName: myName, url: invite.url))
                    } label: {
                        Label("แชร์ลิงก์", icon: \.shareIos)
                    }
                    .buttonStyle(.compound(.primary, size: .medium))
                    Button(copied ? "คัดลอกแล้ว ✓" : "คัดลอก") {
                        UIPasteboard.general.string = invite.url
                        copied = true
                    }
                    .buttonStyle(.compound(.secondary, size: .medium))
                }
                .fixedSize()
                if invite.joined > 0 {
                    Text("🎉 มีคนเข้ามาผ่านลิงก์ของคุณแล้ว \(invite.joined) คน")
                        .font(.compound.bodySMSemibold)
                        .foregroundStyle(.compound.textPrimary)
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .background(Color.compound.bgSubtleSecondary, in: RoundedRectangle(cornerRadius: 20))
        .padding(16)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Color.compound.bgCanvasDefault)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await load() }
        .sheet(item: $shareItem) { item in
            AranActivityView(items: [item.text])
                .presentationDetents([.medium, .large])
        }
    }

    private func load() async {
        failed = false
        do {
            invite = try await AranInvite.createLink()
        } catch {
            MXLog.warning("AranMyQR: create invite failed: \(error)")
            failed = true
        }
    }

    private static func qrImage(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
              let cgImage = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
