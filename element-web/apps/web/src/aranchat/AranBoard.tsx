/*
 * AranChat — หน้า "โน้ต" และ "อัลบั้ม" ของกลุ่ม + การ์ดในแชท (แบบ LINE)
 * ข้อมูล/รูปแบบข้อความ: src/aranchat/groupBoard.ts
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React, { type JSX, useEffect, useRef, useState } from "react";
import { type MatrixEvent, type Room, RoomStateEvent } from "matrix-js-sdk/src/matrix";
import { LinkedText } from "@element-hq/web-shared-components";

import BaseDialog from "../components/views/dialogs/BaseDialog";
import ImageView from "../components/views/elements/ImageView";
import Modal from "../Modal";
import { MatrixClientPeg } from "../MatrixClientPeg";
import defaultDispatcher from "../dispatcher/dispatcher";
import { Action } from "../dispatcher/actions";
import { MediaEventHelper } from "../utils/MediaEventHelper";
import { formatFullDateNoTime } from "../DateUtils";
import {
    type BoardEntry,
    type BoardKind,
    addPhotos,
    albumName,
    albumPhotos,
    canUseBoard,
    createAlbum,
    createNote,
    editNote,
    ensureBoardPermission,
    listBoard,
    loadLatest,
    noteText,
    noteTitle,
    readBoardRef,
    removeEntry,
    renameAlbum,
} from "./groupBoard";

const NO_PERMISSION = "ผู้ดูแลกลุ่มยังไม่ได้เปิดให้สมาชิกสร้างโน้ต/อัลบั้ม — ขอให้ผู้ดูแลเปิดหน้านี้ครั้งหนึ่ง ระบบจะเปิดให้อัตโนมัติ";

/** รายการโน้ต/อัลบั้มของห้อง อัปเดตเองเมื่อมีคนเพิ่ม/แก้ */
function useBoard(room: Room, kind: BoardKind): BoardEntry[] {
    const [list, setList] = useState(() => listBoard(room, kind));
    useEffect(() => {
        const update = (): void => setList(listBoard(room, kind));
        update();
        room.currentState.on(RoomStateEvent.Update, update);
        return () => void room.currentState.off(RoomStateEvent.Update, update);
    }, [room, kind]);
    return list;
}

function useLatest(room: Room, eventId: string, rev: number): Record<string, unknown> | null | undefined {
    const [content, setContent] = useState<Record<string, unknown> | null | undefined>(undefined);
    useEffect(() => {
        let alive = true;
        loadLatest(MatrixClientPeg.safeGet(), room, eventId)
            .then((c) => alive && setContent(c))
            .catch(() => alive && setContent(null));
        return () => {
            alive = false;
        };
    }, [room, eventId, rev]);
    return content;
}

const who = (room: Room, userId: string): string => room.getMember(userId)?.name ?? userId.slice(1).split(":")[0];
const day = (ts: number): string => formatFullDateNoTime(new Date(ts));

/** เปิดความคิดเห็น (เธรดของโน้ต/อัลบั้ม) ในแผงขวา */
async function openThread(room: Room, eventId: string): Promise<void> {
    const cli = MatrixClientPeg.safeGet();
    let ev = room.findEventById(eventId);
    if (!ev) {
        const raw = await cli.fetchRoomEvent(room.roomId, eventId);
        ev = cli.getEventMapper()(raw);
        await cli.decryptEventIfNeeded(ev);
    }
    defaultDispatcher.dispatch({ action: Action.ViewRoom, room_id: room.roomId, metricsTrigger: undefined });
    defaultDispatcher.dispatch({ action: Action.ShowThread, rootEvent: ev, push: false });
}

interface DialogProps {
    room: Room;
    kind?: BoardKind;
    /** เปิดโน้ต/อัลบั้มนี้เลย (กดจากการ์ดในแชท) */
    openId?: string;
    /** เริ่มที่หน้าสร้างใหม่ (เมนู + ในช่องพิมพ์) */
    create?: boolean;
    onFinished: () => void;
}

/** หน้าต่าง โน้ต | อัลบั้ม ของกลุ่ม */
export function AranBoardDialog({ room, kind = "note", openId, create, onFinished }: DialogProps): JSX.Element {
    const cli = MatrixClientPeg.safeGet();
    const [tab, setTab] = useState<BoardKind>(kind);
    const [open, setOpen] = useState<string | "new" | null>(create ? "new" : (openId ?? null));
    const [error, setError] = useState<string | null>(null);
    const allowed = canUseBoard(cli, room);
    const list = useBoard(room, tab); // อัปเดตเมื่อ state เข้ามา (เพิ่งสร้าง → รอ sync แล้วเปิดให้)

    // ผู้ดูแลเปิดหน้านี้ → เปิดสิทธิ์ให้สมาชิกทุกคนอัตโนมัติ (ครั้งเดียว)
    useEffect(() => {
        ensureBoardPermission(cli, room).catch(() => {});
    }, [cli, room]);

    const switchTab = (k: BoardKind): void => {
        setTab(k);
        setOpen(null);
        setError(null);
    };
    const startNew = (): void => (allowed ? setOpen("new") : setError(NO_PERMISSION));

    let body: JSX.Element;
    const entry = open && open !== "new" ? (list.find((e) => e.id === open) ?? null) : null;
    if (open === "new") {
        body =
            tab === "note" ? (
                <NoteEditor room={room} onDone={(id) => setOpen(id)} onCancel={() => setOpen(null)} />
            ) : (
                <AlbumCreate room={room} onDone={(id) => setOpen(id)} onCancel={() => setOpen(null)} />
            );
    } else if (open && !entry && openId !== open) {
        body = <p className="mx_AranBoard_empty">กำลังบันทึก…</p>;
    } else if (entry) {
        body =
            tab === "note" ? (
                <NoteView room={room} entry={entry} onBack={() => setOpen(null)} onClose={onFinished} />
            ) : (
                <AlbumView room={room} entry={entry} onBack={() => setOpen(null)} onClose={onFinished} />
            );
    } else {
        body = tab === "note" ? <NoteList room={room} onOpen={setOpen} /> : <AlbumList room={room} onOpen={setOpen} />;
    }

    return (
        <BaseDialog className="mx_AranBoard" title={room.name} onFinished={onFinished} fixedWidth={false}>
            <div className="mx_AranBoard_tabs" role="tablist">
                {(["note", "album"] as const).map((k) => (
                    <button
                        key={k}
                        type="button"
                        role="tab"
                        aria-selected={tab === k}
                        className="mx_AranBoard_tab"
                        onClick={() => switchTab(k)}
                    >
                        {k === "note" ? "📝 โน้ต" : "🖼 อัลบั้ม"}
                    </button>
                ))}
                {!open && (
                    <button type="button" className="mx_AranBoard_new" onClick={startNew}>
                        {tab === "note" ? "+ โน้ตใหม่" : "+ อัลบั้มใหม่"}
                    </button>
                )}
            </div>
            {error && <p className="mx_AranBoard_error">{error}</p>}
            <div className="mx_AranBoard_body">{body}</div>
        </BaseDialog>
    );
}

/* ---------- โน้ต ---------- */

function NoteList({ room, onOpen }: { room: Room; onOpen: (id: string) => void }): JSX.Element {
    const list = useBoard(room, "note");
    if (!list.length)
        return (
            <p className="mx_AranBoard_empty">
                ยังไม่มีโน้ต — เก็บเรื่องสำคัญของกลุ่มไว้ที่นี่ เช่น แนวทางปฏิบัติ เบอร์โทร ตารางเวร ไม่จมหายในแชท
            </p>
        );
    return (
        <div className="mx_AranBoard_notes">
            {list.map((e) => (
                <NoteRow key={e.id} room={room} entry={e} onOpen={() => onOpen(e.id)} />
            ))}
        </div>
    );
}

function NoteRow({ room, entry, onOpen }: { room: Room; entry: BoardEntry; onOpen: () => void }): JSX.Element {
    const content = useLatest(room, entry.eventId, entry.updatedTs);
    const text = content ? noteText(content) : "";
    const lines = text.trim().split("\n");
    return (
        <button type="button" className="mx_AranBoard_noteRow" onClick={onOpen}>
            <b>{content === undefined ? "กำลังโหลด…" : content ? noteTitle(text) : "🔒 เปิดอ่านไม่ได้"}</b>
            {lines.length > 1 && <span className="mx_AranBoard_preview">{lines.slice(1).join(" ").slice(0, 140)}</span>}
            <small>
                {who(room, entry.createdBy)} · แก้ล่าสุด {day(entry.updatedTs)}
            </small>
        </button>
    );
}

function NoteView(props: { room: Room; entry: BoardEntry; onBack: () => void; onClose: () => void }): JSX.Element {
    const { room, entry, onBack, onClose } = props;
    const cli = MatrixClientPeg.safeGet();
    const content = useLatest(room, entry.eventId, entry.updatedTs);
    const [editing, setEditing] = useState(false);
    if (editing && content)
        return <NoteEditor room={room} entry={entry} initial={noteText(content)} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />;
    const del = (): void => {
        if (window.confirm("ลบโน้ตนี้ออกจากกลุ่ม?")) void removeEntry(cli, room, entry).then(onBack);
    };
    return (
        <div className="mx_AranBoard_note">
            <button type="button" className="mx_AranBoard_back" onClick={onBack}>
                ‹ โน้ตทั้งหมด
            </button>
            {content === undefined ? (
                <p className="mx_AranBoard_empty">กำลังโหลด…</p>
            ) : content ? (
                <div className="mx_AranBoard_noteText">
                    <LinkedText>{noteText(content)}</LinkedText>
                </div>
            ) : (
                <p className="mx_AranBoard_empty">🔒 เปิดอ่านโน้ตนี้ไม่ได้ — อาจสร้างก่อนคุณเข้ากลุ่ม ขอให้สมาชิกกด "แก้ไข" แล้วบันทึกอีกครั้ง</p>
            )}
            <small className="mx_AranBoard_meta">
                สร้างโดย {who(room, entry.createdBy)} · {day(entry.createdTs)} · แก้ล่าสุด {day(entry.updatedTs)}
            </small>
            <div className="mx_AranBoard_actions">
                {content && (
                    <button type="button" className="mx_AranBoard_btn mx_AranBoard_primary" onClick={() => setEditing(true)}>
                        แก้ไข
                    </button>
                )}
                <button
                    type="button"
                    className="mx_AranBoard_btn"
                    onClick={() => {
                        onClose();
                        void openThread(room, entry.eventId);
                    }}
                >
                    💬 ความคิดเห็น
                </button>
                <button type="button" className="mx_AranBoard_btn mx_AranBoard_danger" onClick={del}>
                    ลบ
                </button>
            </div>
        </div>
    );
}

function NoteEditor(props: {
    room: Room;
    entry?: BoardEntry;
    initial?: string;
    onDone: (id: string) => void;
    onCancel: () => void;
}): JSX.Element {
    const { room, entry, initial = "", onDone, onCancel } = props;
    const [text, setText] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const save = async (): Promise<void> => {
        const cli = MatrixClientPeg.safeGet();
        setBusy(true);
        setError(null);
        try {
            if (!(await ensureBoardPermission(cli, room))) throw new Error(NO_PERMISSION);
            if (entry) {
                await editNote(cli, room, entry, text);
                onDone(entry.id);
            } else {
                onDone((await createNote(cli, room, text)).id);
            }
        } catch (e) {
            setError(e instanceof Error && e.message === NO_PERMISSION ? NO_PERMISSION : "บันทึกไม่สำเร็จ ลองอีกครั้ง");
            setBusy(false);
        }
    };
    return (
        <div className="mx_AranBoard_editor">
            <textarea
                className="mx_AranBoard_textarea"
                value={text}
                autoFocus
                placeholder={"หัวข้อ (บรรทัดแรก)\nรายละเอียด…"}
                maxLength={20000}
                onChange={(e) => setText(e.target.value)}
            />
            <p className="mx_AranBoard_hint">🔒 โน้ตเข้ารหัสเหมือนข้อความในกลุ่ม สมาชิกทุกคนอ่านและแก้ได้</p>
            {error && <p className="mx_AranBoard_error">{error}</p>}
            <div className="mx_AranBoard_actions">
                <button type="button" className="mx_AranBoard_btn" onClick={onCancel} disabled={busy}>
                    ยกเลิก
                </button>
                <button
                    type="button"
                    className="mx_AranBoard_btn mx_AranBoard_primary"
                    disabled={busy || !text.trim()}
                    onClick={() => void save()}
                >
                    {busy ? "กำลังบันทึก…" : "บันทึก"}
                </button>
            </div>
        </div>
    );
}

/* ---------- อัลบั้ม ---------- */

/** รูปย่อของรูปที่เข้ารหัส (ถอดรหัสในเครื่อง) */
function Thumb({ ev, onClick }: { ev: MatrixEvent; onClick?: () => void }): JSX.Element {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        const h = new MediaEventHelper(ev);
        let alive = true;
        h.thumbnailUrl.value
            .then((t) => t ?? h.sourceUrl.value)
            .then((u) => alive && setUrl(u))
            .catch(() => {});
        return () => {
            alive = false;
            h.destroy();
        };
    }, [ev]);
    const video = ev.getContent().msgtype === "m.video";
    return (
        <button type="button" className="mx_AranBoard_thumb" onClick={onClick} disabled={!onClick}>
            {url ? <img src={url} alt="" loading="lazy" /> : <span className="mx_AranBoard_thumbWait" />}
            {video && <span className="mx_AranBoard_play">▶</span>}
        </button>
    );
}

function usePhotos(room: Room, entry: BoardEntry): MatrixEvent[] | null {
    const [photos, setPhotos] = useState<MatrixEvent[] | null>(null);
    useEffect(() => {
        let alive = true;
        albumPhotos(MatrixClientPeg.safeGet(), room, entry.eventId)
            .then((p) => alive && setPhotos(p))
            .catch(() => alive && setPhotos([]));
        return () => {
            alive = false;
        };
    }, [room, entry.eventId, entry.updatedTs]);
    return photos;
}

function AlbumList({ room, onOpen }: { room: Room; onOpen: (id: string) => void }): JSX.Element {
    const list = useBoard(room, "album");
    if (!list.length)
        return <p className="mx_AranBoard_empty">ยังไม่มีอัลบั้ม — รวมรูปกิจกรรม/งานของกลุ่มเป็นชุด หาง่ายกว่าเลื่อนในแชท</p>;
    return (
        <div className="mx_AranBoard_albums">
            {list.map((e) => (
                <AlbumTile key={e.id} room={room} entry={e} onOpen={() => onOpen(e.id)} />
            ))}
        </div>
    );
}

function AlbumTile({ room, entry, onOpen }: { room: Room; entry: BoardEntry; onOpen: () => void }): JSX.Element {
    const content = useLatest(room, entry.eventId, entry.updatedTs);
    const photos = usePhotos(room, entry);
    return (
        <button type="button" className="mx_AranBoard_albumTile" onClick={onOpen}>
            <div className="mx_AranBoard_cover">{photos?.[0] ? <Thumb ev={photos[0]} /> : <span>🖼</span>}</div>
            <b>{content ? albumName(content) : content === null ? "🔒" : "…"}</b>
            <small>{photos ? `${photos.length} รูป` : "…"}</small>
        </button>
    );
}

function pickFiles(onPick: (files: File[]) => void): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,video/*";
    input.multiple = true;
    input.onchange = () => input.files?.length && onPick(Array.from(input.files));
    input.click();
}

function openPhoto(ev: MatrixEvent): void {
    const h = new MediaEventHelper(ev);
    void h.sourceUrl.value.then((src) => {
        if (!src) return;
        const c = ev.getContent();
        Modal.createDialog(
            ImageView,
            { src, name: c.body, mxEvent: ev, width: c.info?.w, height: c.info?.h, fileSize: c.info?.size },
            "mx_Dialog_lightbox",
            undefined,
            true,
        );
    });
}

function AlbumView(props: { room: Room; entry: BoardEntry; onBack: () => void; onClose: () => void }): JSX.Element {
    const { room, entry, onBack, onClose } = props;
    const cli = MatrixClientPeg.safeGet();
    const content = useLatest(room, entry.eventId, entry.updatedTs);
    const photos = usePhotos(room, entry);
    const [progress, setProgress] = useState<string | null>(null);

    const add = (): void =>
        pickFiles((files) => {
            setProgress(`กำลังส่ง 0/${files.length}`);
            addPhotos(cli, room, entry, files, (n) => setProgress(`กำลังส่ง ${n}/${files.length}`))
                .then(() => setProgress(null))
                .catch(() => setProgress("ส่งรูปไม่สำเร็จบางรูป ลองอีกครั้ง"));
        });
    const rename = (): void => {
        const name = window.prompt("ชื่ออัลบั้ม", content ? albumName(content) : "");
        if (name?.trim()) void renameAlbum(cli, room, entry, name);
    };
    const del = (): void => {
        if (window.confirm("ลบอัลบั้มนี้ออกจากรายการ? (รูปในแชทยังอยู่)")) void removeEntry(cli, room, entry).then(onBack);
    };

    return (
        <div className="mx_AranBoard_album">
            <button type="button" className="mx_AranBoard_back" onClick={onBack}>
                ‹ อัลบั้มทั้งหมด
            </button>
            <h3 className="mx_AranBoard_albumName">
                {content ? albumName(content) : content === null ? "🔒 เปิดอ่านไม่ได้" : "…"}
                <small>
                    {photos ? `${photos.length} รูป · ` : ""}
                    {who(room, entry.createdBy)} · {day(entry.updatedTs)}
                </small>
            </h3>
            <div className="mx_AranBoard_actions">
                <button type="button" className="mx_AranBoard_btn mx_AranBoard_primary" onClick={add} disabled={!!progress?.startsWith("กำลัง")}>
                    + เพิ่มรูป
                </button>
                <button
                    type="button"
                    className="mx_AranBoard_btn"
                    onClick={() => {
                        onClose();
                        void openThread(room, entry.eventId);
                    }}
                >
                    💬 ความคิดเห็น
                </button>
                <button type="button" className="mx_AranBoard_btn" onClick={rename}>
                    เปลี่ยนชื่อ
                </button>
                <button type="button" className="mx_AranBoard_btn mx_AranBoard_danger" onClick={del}>
                    ลบ
                </button>
            </div>
            {progress && <p className="mx_AranBoard_hint">{progress}</p>}
            {photos === null ? (
                <p className="mx_AranBoard_empty">กำลังโหลดรูป…</p>
            ) : photos.length ? (
                <div className="mx_AranBoard_grid">
                    {photos.map((p) => (
                        <Thumb key={p.getId()} ev={p} onClick={() => openPhoto(p)} />
                    ))}
                </div>
            ) : (
                <p className="mx_AranBoard_empty">ยังไม่มีรูป — กด "+ เพิ่มรูป"</p>
            )}
        </div>
    );
}

function AlbumCreate({ room, onDone, onCancel }: { room: Room; onDone: (id: string) => void; onCancel: () => void }): JSX.Element {
    const [name, setName] = useState("");
    const [files, setFiles] = useState<File[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const previews = useRef<string[]>([]);
    const [urls, setUrls] = useState<string[]>([]);
    useEffect(() => {
        previews.current.forEach((u) => URL.revokeObjectURL(u));
        previews.current = files.filter((f) => f.type.startsWith("image/")).slice(0, 12).map((f) => URL.createObjectURL(f));
        setUrls(previews.current);
    }, [files]);
    useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

    const save = async (): Promise<void> => {
        const cli = MatrixClientPeg.safeGet();
        setError(null);
        setBusy("กำลังสร้างอัลบั้ม…");
        try {
            if (!(await ensureBoardPermission(cli, room))) throw new Error(NO_PERMISSION);
            const e = await createAlbum(cli, room, name, files, (n) => setBusy(`กำลังส่งรูป ${n}/${files.length}`));
            onDone(e.id);
        } catch (e) {
            setError(e instanceof Error && e.message === NO_PERMISSION ? NO_PERMISSION : "สร้างอัลบั้มไม่สำเร็จ ลองอีกครั้ง");
            setBusy(null);
        }
    };
    return (
        <div className="mx_AranBoard_editor">
            <input
                className="mx_AranBoard_input"
                value={name}
                autoFocus
                maxLength={80}
                placeholder="ชื่ออัลบั้ม เช่น ประชุมวิชาการ พ.ย. 69"
                onChange={(e) => setName(e.target.value)}
            />
            <button type="button" className="mx_AranBoard_btn" disabled={!!busy} onClick={() => pickFiles((f) => setFiles([...files, ...f]))}>
                + เลือกรูป {files.length ? `(${files.length})` : ""}
            </button>
            {urls.length > 0 && (
                <div className="mx_AranBoard_grid mx_AranBoard_grid_small">
                    {urls.map((u) => (
                        <span key={u} className="mx_AranBoard_thumb">
                            <img src={u} alt="" />
                        </span>
                    ))}
                </div>
            )}
            {busy && <p className="mx_AranBoard_hint">{busy}</p>}
            {error && <p className="mx_AranBoard_error">{error}</p>}
            <div className="mx_AranBoard_actions">
                <button type="button" className="mx_AranBoard_btn" onClick={onCancel} disabled={!!busy}>
                    ยกเลิก
                </button>
                <button
                    type="button"
                    className="mx_AranBoard_btn mx_AranBoard_primary"
                    disabled={!!busy || !name.trim()}
                    onClick={() => void save()}
                >
                    สร้างอัลบั้ม
                </button>
            </div>
        </div>
    );
}

/* ---------- การ์ดในแชท ---------- */

/** การ์ดโน้ต/อัลบั้มในห้องแชท (เนื้อหาที่แก้ล่าสุด — Element ใส่การแก้ไขให้ใน getContent()) */
export function AranBoardCard({ mxEvent }: { mxEvent: MatrixEvent }): JSX.Element | null {
    const content = mxEvent.getContent();
    const ref = readBoardRef(content);
    const room = MatrixClientPeg.safeGet().getRoom(mxEvent.getRoomId());
    if (!ref || !room) return null;
    return <BoardCard mxEvent={mxEvent} room={room} kind={ref.kind} id={ref.id} />;
}

function BoardCard({ mxEvent, room, kind, id }: { mxEvent: MatrixEvent; room: Room; kind: BoardKind; id: string }): JSX.Element {
    const content = mxEvent.getContent();
    const ref = { kind, id };
    // อัปเดตเมื่อ state เข้ามา (ข้อความมาถึงก่อน state ของโน้ตที่เพิ่งสร้าง)
    const entry = useBoard(room, kind).find((e) => e.id === id) ?? null;
    const open = (): void =>
        void Modal.createDialog(AranBoardDialog, { room, kind: ref.kind, openId: entry ? ref.id : undefined });

    if (ref.kind === "note") {
        const text = noteText(content);
        const rest = text.trim().split("\n").slice(1).join("\n").trim();
        return (
            <div className="mx_AranBoardCard">
                <div className="mx_AranBoardCard_head">📝 โน้ต</div>
                <b className="mx_AranBoardCard_title">{noteTitle(text)}</b>
                {rest && <div className="mx_AranBoardCard_preview">{rest}</div>}
                <button type="button" className="mx_AranBoardCard_btn" onClick={open}>
                    {entry ? "เปิดโน้ต" : "โน้ตถูกลบแล้ว"}
                </button>
            </div>
        );
    }
    return (
        <div className="mx_AranBoardCard">
            <div className="mx_AranBoardCard_head">🖼 อัลบั้ม</div>
            <b className="mx_AranBoardCard_title">{albumName(content)}</b>
            {entry && <AlbumCardPreview room={room} entry={entry} />}
            <button type="button" className="mx_AranBoardCard_btn" onClick={open}>
                {entry ? "ดูอัลบั้ม" : "อัลบั้มถูกลบแล้ว"}
            </button>
        </div>
    );
}

function AlbumCardPreview({ room, entry }: { room: Room; entry: BoardEntry }): JSX.Element | null {
    const photos = usePhotos(room, entry);
    if (!photos?.length) return null;
    const more = photos.length - 4;
    return (
        <div className="mx_AranBoardCard_grid">
            {photos.slice(0, 4).map((p, i) => (
                <span key={p.getId()} className="mx_AranBoardCard_cell">
                    <Thumb ev={p} />
                    {i === 3 && more > 0 && <span className="mx_AranBoardCard_more">+{more}</span>}
                </span>
            ))}
        </div>
    );
}
