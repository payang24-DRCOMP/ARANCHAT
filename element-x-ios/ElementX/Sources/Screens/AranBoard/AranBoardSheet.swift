//
// AranChat — แผงโน้ต/อัลบั้มในกลุ่ม + การ์ดในแชท — เทียบ Android aranchat/AranBoardSheet.kt
//   เปิดจาก: เมนู + ข้างช่องพิมพ์ (โน้ต / อัลบั้ม) · แตะการ์ดในแชท
//   อัลบั้ม: รูปคือข้อความรูปในเธรดของข้อความอัลบั้ม — เพิ่มรูปในแผงได้เลย (ย่อ/เข้ารหัสแบบเดียวกับส่งรูปปกติ)
//
// SPDX-License-Identifier: AGPL-3.0-only
//

import Compound
import MatrixRustSDK
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

private let brand = Color(red: 0x5B / 255, green: 0x3F / 255, blue: 0xD9 / 255)
private let noPermission = "ต้องให้ผู้ดูแลกลุ่มเปิดสิทธิ์ก่อน (ผู้ดูแลเปิดแผงนี้ครั้งแรก ระบบจะเปิดให้สมาชิกทุกคนอัตโนมัติ)"

private func day(_ ts: UInt64) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "th_TH")
    formatter.dateFormat = "d MMM yyyy"
    return formatter.string(from: Date(timeIntervalSince1970: TimeInterval(ts) / 1000))
}

struct AranBoardSheet: View {
    let roomID: String
    @State var kind: AranBoardKind
    /// เปิดโน้ต/อัลบั้มนี้ทันที (แตะการ์ดในแชท)
    var openID: String?

    private enum Screen: Equatable {
        case list
        case open(String)
        case edit(AranBoardEntry?, String)
    }

    @Environment(\.dismiss) private var dismiss
    @State private var screen: Screen = .list
    @State private var entries: [AranBoardEntry]?
    @State private var error: String?
    @State private var busy = false
    @State private var didOpenInitial = false

    private var board: AranBoard { AranBoard(roomID: roomID) }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if let error {
                Text(error)
                    .font(.compound.bodySM)
                    .foregroundStyle(.compound.textCriticalPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
            }
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .background(Color.compound.bgCanvasDefault)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task {
            if !didOpenInitial {
                didOpenInitial = true
                if let openID { screen = .open(openID) }
                _ = await board.ensurePermission()
            }
        }
        .task(id: kind) { entries = await board.entries(kind) }
    }

    private var header: some View {
        HStack(spacing: 0) {
            ForEach(AranBoardKind.allCases) { k in
                Button {
                    kind = k
                    screen = .list
                    error = nil
                } label: {
                    Text(k.tabTitle)
                        .font(.compound.bodyLGSemibold)
                        .foregroundStyle(k == kind ? brand : .compound.textSecondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                }
            }
            Spacer()
            if screen == .list {
                Button(kind == .note ? "+ โน้ตใหม่" : "+ อัลบั้มใหม่") { screen = .edit(nil, "") }
                    .buttonStyle(.compound(.primary, size: .small))
                    .fixedSize()
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 4)
    }

    @ViewBuilder
    private var content: some View {
        switch screen {
        case .list:
            AranBoardList(board: board, kind: kind, entries: entries) { screen = .open($0) }
        case .open(let id):
            if let entry = entries?.first(where: { $0.id == id }) {
                if kind == .note {
                    AranNoteDetail(board: board, entry: entry,
                                   onBack: { screen = .list },
                                   onEdit: { screen = .edit(entry, $0) },
                                   onDeleted: {
                                       screen = .list
                                       Task { entries = await board.entries(kind) }
                                   })
                } else {
                    AranAlbumDetail(roomID: roomID, board: board, entry: entry,
                                    onBack: { screen = .list },
                                    onChanged: { Task { entries = await board.entries(kind) } },
                                    onOpenThread: { openThread(entry.eventID) })
                }
            } else if entries == nil {
                ProgressView().padding(40)
            } else {
                Text("กำลังบันทึก…").foregroundStyle(.compound.textSecondary).padding(40)
            }
        case .edit(let entry, let initial):
            if kind == .note {
                AranNoteEditor(initial: initial, busy: busy,
                               onCancel: { screen = entry.map { .open($0.id) } ?? .list },
                               onSave: { save(note: $0, entry: entry) })
            } else {
                AranAlbumCreate(busy: busy, onCancel: { screen = .list }, onCreate: createAlbum)
            }
        }
    }

    // MARK: - Actions

    private func openThread(_ eventID: String) {
        let context = AranRoomContext.get(roomID)
        dismiss()
        Task {
            try? await Task.sleep(for: .milliseconds(400))
            context?.openThread(eventID)
        }
    }

    /// เพิ่งบันทึก: state จาก server อาจยังไม่มา → ลองโหลดซ้ำ
    private func refresh(until id: String) async {
        for _ in 0..<10 {
            let list = await board.entries(kind)
            entries = list
            if list.contains(where: { $0.id == id }) { return }
            try? await Task.sleep(for: .milliseconds(500))
        }
    }

    private func save(note text: String, entry: AranBoardEntry?) {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            guard await board.ensurePermission() else { error = noPermission; return }
            do {
                let id: String
                if let entry {
                    try await board.editNote(entry, text: text)
                    id = entry.id
                } else {
                    id = try await board.createNote(text).id
                }
                screen = .open(id)
                await refresh(until: id)
            } catch {
                MXLog.error("AranBoard: save note failed: \(error)")
                self.error = "บันทึกไม่สำเร็จ ลองอีกครั้ง"
            }
        }
    }

    private func createAlbum(name: String, items: [PhotosPickerItem]) {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            guard await board.ensurePermission() else { error = noPermission; return }
            do {
                let entry = try await board.createAlbum(name)
                screen = .open(entry.id)
                await refresh(until: entry.id)
                if !items.isEmpty {
                    let sent = await AranAlbumUploader.send(items, roomID: roomID, entry: entry) { _ in }
                    if sent < items.count { error = "ส่งรูปไม่สำเร็จบางรูป" }
                    entries = await board.entries(kind)
                }
            } catch {
                MXLog.error("AranBoard: create album failed: \(error)")
                self.error = "สร้างอัลบั้มไม่สำเร็จ ลองอีกครั้ง"
            }
        }
    }
}

// MARK: - List

private struct AranBoardList: View {
    let board: AranBoard
    let kind: AranBoardKind
    let entries: [AranBoardEntry]?
    let onOpen: (String) -> Void

    var body: some View {
        if let entries {
            if entries.isEmpty {
                Text(kind == .note ? "ยังไม่มีโน้ต — จดเรื่องสำคัญของกลุ่มไว้ที่นี่ ทุกคนเห็นและแก้ได้" : "ยังไม่มีอัลบั้ม — รวมรูปงาน/กิจกรรมของกลุ่มไว้ที่เดียว")
                    .font(.compound.bodyMD)
                    .foregroundStyle(.compound.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(32)
            } else if kind == .note {
                List(entries) { entry in
                    Button { onOpen(entry.id) } label: { AranNoteRow(board: board, entry: entry) }
                        .buttonStyle(.plain)
                }
                .listStyle(.plain)
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                        ForEach(entries) { entry in
                            Button { onOpen(entry.id) } label: { AranAlbumTile(board: board, entry: entry) }
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(16)
                }
            }
        } else {
            ProgressView().padding(40)
        }
    }
}

private struct AranNoteRow: View {
    let board: AranBoard
    let entry: AranBoardEntry
    @State private var text: String?
    @State private var loaded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(loaded ? (text.map(AranBoardRef.noteTitle) ?? "(อ่านไม่ได้ — โน้ตก่อนคุณเข้ากลุ่ม)") : "…")
                .font(.compound.bodyLGSemibold)
                .foregroundStyle(.compound.textPrimary)
                .lineLimit(1)
            if let rest = text.map(AranBoardRef.noteRest), !rest.isEmpty {
                Text(rest).font(.compound.bodyMD).foregroundStyle(.compound.textSecondary).lineLimit(2)
            }
            Text("แก้ล่าสุด \(day(entry.updatedTs))").font(.compound.bodyXS).foregroundStyle(.compound.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .task(id: entry.updatedTs) {
            text = await board.text(entry)
            loaded = true
        }
    }
}

private struct AranAlbumTile: View {
    let board: AranBoard
    let entry: AranBoardEntry
    @State private var name: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            RoundedRectangle(cornerRadius: 12)
                .fill(LinearGradient(colors: [Color(red: 0.96, green: 0.62, blue: 0.04), Color(red: 0.92, green: 0.35, blue: 0.05)],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
                .aspectRatio(1.3, contentMode: .fit)
                .overlay { Text("🖼").font(.system(size: 40)) }
            Text(name ?? "อัลบั้ม").font(.compound.bodyMDSemibold).foregroundStyle(.compound.textPrimary).lineLimit(1)
            Text(day(entry.updatedTs)).font(.compound.bodyXS).foregroundStyle(.compound.textSecondary)
        }
        .task(id: entry.updatedTs) { name = await board.text(entry) }
    }
}

// MARK: - Note

private struct AranNoteDetail: View {
    let board: AranBoard
    let entry: AranBoardEntry
    let onBack: () -> Void
    let onEdit: (String) -> Void
    let onDeleted: () -> Void

    @State private var text: String?
    @State private var loaded = false
    @State private var confirmDelete = false
    @State private var deleting = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Button("‹ โน้ตทั้งหมด", action: onBack).foregroundStyle(brand)
                Text("แก้ล่าสุด \(day(entry.updatedTs))").font(.compound.bodyXS).foregroundStyle(.compound.textSecondary)
                if !loaded {
                    ProgressView()
                } else {
                    Text(text ?? "อ่านโน้ตนี้ไม่ได้ (โน้ตถูกสร้างก่อนคุณเข้ากลุ่ม หรือถูกลบแล้ว)")
                        .font(.compound.bodyLG)
                        .foregroundStyle(text == nil ? .compound.textSecondary : .compound.textPrimary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                HStack(spacing: 8) {
                    if let text {
                        Button("แก้ไข") { onEdit(text) }.buttonStyle(.compound(.primary, size: .medium))
                    }
                    if confirmDelete {
                        Button("ยืนยันลบ") { delete() }.buttonStyle(.compound(.primary, size: .medium)).tint(.compound.bgCriticalPrimary)
                            .disabled(deleting)
                    } else {
                        Button("ลบ") { confirmDelete = true }.buttonStyle(.compound(.tertiary, size: .medium))
                    }
                }
                .fixedSize()
            }
            .buttonStyle(.plain)
            .padding(16)
        }
        .task(id: entry.updatedTs) {
            text = await board.text(entry)
            loaded = true
        }
    }

    private func delete() {
        deleting = true
        Task {
            try? await board.remove(entry)
            deleting = false
            onDeleted()
        }
    }
}

private struct AranNoteEditor: View {
    let initial: String
    let busy: Bool
    let onCancel: () -> Void
    let onSave: (String) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextEditor(text: $text)
                .focused($focused)
                .font(.compound.bodyLG)
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(Color.compound.bgSubtleSecondary, in: RoundedRectangle(cornerRadius: 12))
                .frame(minHeight: 160)
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text("พิมพ์โน้ต… บรรทัดแรกเป็นหัวข้อ").foregroundStyle(.compound.textSecondary).padding(16).allowsHitTesting(false)
                    }
                }
            HStack(spacing: 8) {
                Button("ยกเลิก", action: onCancel).buttonStyle(.compound(.secondary, size: .medium)).disabled(busy)
                Button(busy ? "กำลังบันทึก…" : "บันทึก") { onSave(text) }
                    .buttonStyle(.compound(.primary, size: .medium))
                    .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .fixedSize()
        }
        .padding(16)
        .onAppear {
            text = initial
            focused = true
        }
    }
}

// MARK: - Album

/// รูป/วิดีโอในอัลบั้ม = ข้อความสื่อในเธรดของข้อความอัลบั้ม
private struct AranAlbumPhoto: Identifiable {
    let id: String
    let source: MediaSourceProxy
    let blurhash: String?
    let isVideo: Bool
}

@MainActor @Observable
private final class AranAlbumModel {
    private(set) var photos: [AranAlbumPhoto]?
    @ObservationIgnored private var timeline: TimelineProxyProtocol?
    @ObservationIgnored private var task: Task<Void, Never>?

    func load(roomID: String, eventID: String) async {
        guard timeline == nil, let context = AranRoomContext.get(roomID),
              case let .success(timeline) = await context.roomProxy.threadTimeline(eventID: eventID) else {
            if photos == nil { photos = [] }
            return
        }
        self.timeline = timeline
        update(timeline.timelineItemProvider.itemProxies)
        task = Task { [weak self] in
            for await (items, _) in timeline.timelineItemProvider.updatePublisher.values {
                self?.update(items)
            }
        }
        for _ in 0..<5 {
            guard case .success = await timeline.paginateBackwards(requestSize: 50) else { break }
            if timeline.timelineItemProvider.paginationState.backward == .endReached { break }
        }
    }

    deinit { task?.cancel() }

    private func update(_ items: [TimelineItemProxy]) {
        photos = items.reversed().compactMap { item -> AranAlbumPhoto? in
            guard case let .event(event) = item, case let .msgLike(content) = event.item.content,
                  case let .message(message) = content.kind else { return nil }
            switch message.msgType {
            case .image(let image):
                let source = image.info?.thumbnailSource ?? image.source
                return AranAlbumPhoto(id: event.id.uniqueID.value, source: MediaSourceProxy(source: source, mimeType: image.info?.mimetype),
                                      blurhash: image.info?.blurhash, isVideo: false)
            case .video(let video):
                guard let thumb = video.info?.thumbnailSource else { return nil }
                return AranAlbumPhoto(id: event.id.uniqueID.value, source: MediaSourceProxy(source: thumb, mimeType: "image/jpeg"),
                                      blurhash: video.info?.blurhash, isVideo: true)
            default:
                return nil
            }
        }
    }
}

private struct AranAlbumDetail: View {
    let roomID: String
    let board: AranBoard
    let entry: AranBoardEntry
    let onBack: () -> Void
    let onChanged: () -> Void
    let onOpenThread: () -> Void

    @State private var model = AranAlbumModel()
    @State private var name: String?
    @State private var renaming: String?
    @State private var picked: [PhotosPickerItem] = []
    @State private var progress: String?
    @State private var confirmDelete = false

    private var mediaProvider: MediaProviderProtocol? { AranRoomContext.get(roomID)?.userSession.mediaProvider }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Button("‹ อัลบั้มทั้งหมด", action: onBack).foregroundStyle(brand)
                if let r = renaming {
                    TextField("ชื่ออัลบั้ม", text: Binding(get: { r }, set: { renaming = $0 }))
                        .textFieldStyle(.roundedBorder)
                    HStack(spacing: 8) {
                        Button("ยกเลิก") { renaming = nil }.buttonStyle(.compound(.secondary, size: .small))
                        Button("บันทึกชื่อ") { rename(r) }.buttonStyle(.compound(.primary, size: .small))
                            .disabled(r.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    .fixedSize()
                } else {
                    Text(name ?? "อัลบั้ม").font(.compound.headingSMSemibold).foregroundStyle(.compound.textPrimary)
                }
                HStack(spacing: 8) {
                    PhotosPicker(selection: $picked, matching: .any(of: [.images, .videos])) {
                        Text("+ เพิ่มรูป")
                    }
                    .buttonStyle(.compound(.primary, size: .small))
                    .disabled(progress?.hasPrefix("กำลัง") == true)
                    Button("เปลี่ยนชื่อ") { renaming = name ?? "" }.buttonStyle(.compound(.secondary, size: .small))
                    if confirmDelete {
                        Button("ยืนยันลบ") { delete() }.buttonStyle(.compound(.primary, size: .small)).tint(.compound.bgCriticalPrimary)
                    } else {
                        Button("ลบ") { confirmDelete = true }.buttonStyle(.compound(.tertiary, size: .small))
                    }
                }
                .fixedSize()
                if let progress {
                    Text(progress).font(.compound.bodySM).foregroundStyle(.compound.textSecondary)
                }
                photosGrid
            }
            .buttonStyle(.plain)
            .padding(16)
        }
        .task(id: entry.updatedTs) { name = await board.text(entry) }
        .task { await model.load(roomID: roomID, eventID: entry.eventID) }
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            picked = []
            upload(items)
        }
    }

    @ViewBuilder
    private var photosGrid: some View {
        if let photos = model.photos {
            if photos.isEmpty {
                Text("ยังไม่มีรูปในอัลบั้มนี้").font(.compound.bodyMD).foregroundStyle(.compound.textSecondary).padding(.vertical, 24)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: 3), spacing: 3) {
                    ForEach(photos) { photo in
                        Button(action: onOpenThread) {
                            Color.clear
                                .aspectRatio(1, contentMode: .fit)
                                .background {
                                    LoadableImage(mediaSource: photo.source, mediaType: .generic, blurhash: photo.blurhash,
                                                  size: CGSize(width: 300, height: 300), mediaProvider: mediaProvider) {
                                        Color.compound.bgSubtleSecondary
                                    }
                                    .scaledToFill()
                                }
                                .clipped()
                                .overlay(alignment: .bottomLeading) {
                                    if photo.isVideo { Text("▶").font(.caption).foregroundStyle(.white).padding(4) }
                                }
                        }
                        .buttonStyle(.plain)
                    }
                }
                Button("ดูรูปเต็ม / ความเห็นในเธรด ›", action: onOpenThread).foregroundStyle(brand).padding(.top, 4)
            }
        } else {
            ProgressView().padding(24)
        }
    }

    private func upload(_ items: [PhotosPickerItem]) {
        progress = "กำลังส่ง 0/\(items.count)…"
        Task {
            let sent = await AranAlbumUploader.send(items, roomID: roomID, entry: entry) { done in
                progress = "กำลังส่ง \(done)/\(items.count)…"
            }
            progress = sent == items.count ? "เพิ่มแล้ว \(sent) รูป" : "ส่งได้ \(sent)/\(items.count) รูป — ลองส่งรูปที่เหลืออีกครั้ง"
            onChanged()
        }
    }

    private func rename(_ newName: String) {
        Task {
            guard await board.ensurePermission() else { progress = noPermission; return }
            do {
                try await board.renameAlbum(entry, name: newName)
                name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
                renaming = nil
                onChanged()
            } catch {
                progress = "เปลี่ยนชื่อไม่สำเร็จ ลองอีกครั้ง"
            }
        }
    }

    private func delete() {
        Task {
            try? await board.remove(entry)
            onChanged()
            onBack()
        }
    }
}

private struct AranAlbumCreate: View {
    let busy: Bool
    let onCancel: () -> Void
    let onCreate: (String, [PhotosPickerItem]) -> Void
    @State private var name = ""
    @State private var picked: [PhotosPickerItem] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("ชื่ออัลบั้ม เช่น งานกีฬาสี 2569", text: $name)
                .textFieldStyle(.roundedBorder)
            PhotosPicker(selection: $picked, matching: .any(of: [.images, .videos])) {
                Text("+ เลือกรูป" + (picked.isEmpty ? "" : " (\(picked.count))"))
            }
            .buttonStyle(.compound(.secondary, size: .medium))
            .fixedSize()
            HStack(spacing: 8) {
                Button("ยกเลิก", action: onCancel).buttonStyle(.compound(.secondary, size: .medium)).disabled(busy)
                Button(busy ? "กำลังสร้าง…" : "สร้างอัลบั้ม") { onCreate(name, picked) }
                    .buttonStyle(.compound(.primary, size: .medium))
                    .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .fixedSize()
        }
        .padding(16)
    }
}

// MARK: - Uploading

/// ไฟล์จากคลังรูป (คัดลอกไปโฟลเดอร์ชั่วคราว — ไฟล์ที่ระบบให้มาจะหายเมื่อจบ closure)
private struct AranPickedFile: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .movie) { try copy($0.file) }
        FileRepresentation(importedContentType: .image) { try copy($0.file) }
    }

    private static func copy(_ file: URL) throws -> AranPickedFile {
        let dir = URL.temporaryDirectory.appending(path: "aran-album-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appending(path: file.lastPathComponent)
        try FileManager.default.copyItem(at: file, to: dest)
        return AranPickedFile(url: dest)
    }
}

@MainActor
enum AranAlbumUploader {
    /// ส่งรูป/วิดีโอเข้าเธรดของอัลบั้มทีละรูปตามลำดับ · คืนจำนวนที่ส่งสำเร็จ
    static func send(_ items: [PhotosPickerItem], roomID: String, entry: AranBoardEntry, progress: @escaping @MainActor (Int) -> Void) async -> Int {
        guard let context = AranRoomContext.get(roomID),
              case let .success(timeline) = await context.roomProxy.threadTimeline(eventID: entry.eventID),
              case let .success(maxUploadSize) = await context.userSession.clientProxy.maxMediaUploadSize else { return 0 }
        let preprocessor = MediaUploadingPreprocessor(userSettings: context.userSession.userSettings)
        var sent = 0
        for item in items {
            do {
                guard let file = try await item.loadTransferable(type: AranPickedFile.self) else { continue }
                defer { try? FileManager.default.removeItem(at: file.url.deletingLastPathComponent()) }
                let result: Result<Void, TimelineProxyError>
                switch try await preprocessor.processMedia(at: file.url, maxUploadSize: maxUploadSize).get() {
                case .image(let url, let thumbnailURL, let info):
                    result = await timeline.sendImage(url: url, thumbnailURL: thumbnailURL, imageInfo: info, caption: nil) { _ in }
                case .video(let url, let thumbnailURL, let info):
                    result = await timeline.sendVideo(url: url, thumbnailURL: thumbnailURL, videoInfo: info, caption: nil) { _ in }
                default:
                    continue
                }
                if case .success = result { sent += 1 }
            } catch {
                MXLog.error("AranBoard: add photo failed: \(error)")
            }
            progress(sent)
        }
        if sent > 0 { try? await AranBoard(roomID: roomID).touch(entry) }
        return sent
    }
}

// MARK: - Card in timeline

/// การ์ดโน้ต/อัลบั้มในห้องแชท — แตะ → เปิดแผง (body ในไทม์ไลน์เป็นฉบับแก้ล่าสุดแล้ว)
struct AranBoardCardView: View {
    let ref: AranBoardRef
    let roomID: String
    @State private var open = false

    private var isNote: Bool { ref.kind == .note }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(ref.kind.tabTitle)
                .font(.compound.bodySMSemibold)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(LinearGradient(colors: [Color(red: 0.96, green: 0.62, blue: 0.04), Color(red: 0.92, green: 0.35, blue: 0.05)],
                                           startPoint: .leading, endPoint: .trailing))
            Text(isNote ? AranBoardRef.noteTitle(ref.text) : ref.text)
                .font(.compound.bodyLGSemibold)
                .foregroundStyle(Color(white: 0.12))
                .lineLimit(1)
                .padding(.horizontal, 14)
                .padding(.top, 12)
                .padding(.bottom, 4)
            if isNote, case let rest = AranBoardRef.noteRest(ref.text), !rest.isEmpty {
                Text(rest)
                    .font(.compound.bodyMD)
                    .foregroundStyle(Color(white: 0.45))
                    .lineLimit(3)
                    .padding(.horizontal, 14)
            }
            Divider().padding(.top, 10)
            Button { open = true } label: {
                Text(isNote ? "เปิดโน้ต" : "ดูอัลบั้ม")
                    .font(.compound.bodyMDSemibold)
                    .foregroundStyle(brand)
                    .frame(maxWidth: .infinity)
                    .padding(12)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .frame(width: 260)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .sheet(isPresented: $open) {
            AranBoardSheet(roomID: roomID, kind: ref.kind, openID: ref.id)
        }
    }
}
