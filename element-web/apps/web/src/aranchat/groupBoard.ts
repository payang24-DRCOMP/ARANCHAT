/*
 * AranChat — โน้ตและอัลบั้มในกลุ่ม (แบบ LINE) · ข้อมูล
 *
 * เนื้อหาอยู่ใน "ข้อความ" ทั้งหมด → ห้องเข้ารหัส เนื้อหาก็ถูกเข้ารหัส (server ไม่เห็น)
 *   โน้ต   = m.text  body "📝 โน้ต\n<ข้อความ>"        + "com.arankub.note":  { id }
 *            แก้ไข = m.replace (body เต็มเหมือนกัน ไม่มี "* ") · ความคิดเห็น = ตอบในเธรดของโน้ต
 *   อัลบั้ม = m.text  body "🖼 อัลบั้ม: <ชื่อ>"         + "com.arankub.album": { id }
 *            รูปในอัลบั้ม = รูปที่ส่งในเธรดของข้อความนี้ (แชทหลักไม่ถูกรูปท่วม) · เปลี่ยนชื่อ = m.replace
 * รายการโน้ต/อัลบั้มของห้อง = state event ที่เก็บแค่ event id + เวลา (ไม่มีเนื้อหา)
 *   type "com.arankub.note" / "com.arankub.album", state_key = รหัส
 *   content { event_id, created_by, created_ts, updated_ts } · ลบ = content ว่าง {}
 * Android อ่าน/เขียนรูปแบบเดียวกัน (element-x-android …/aranchat/AranGroupBoard.kt) — body ต้องเป็นข้อความเต็มเสมอ
 *   เพราะ Rust SDK อ่านฟิลด์เสริมของข้อความที่ดึงด้วย id ไม่ได้
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
    Direction,
    EventType,
    type MatrixEvent,
    MsgType,
    RelationType,
    THREAD_RELATION_TYPE,
    type MatrixClient,
    type IPowerLevelsContent,
    type Room,
} from "matrix-js-sdk/src/matrix";

import ContentMessages from "../ContentMessages";

export type BoardKind = "note" | "album";

export const NOTE_TYPE = "com.arankub.note";
export const ALBUM_TYPE = "com.arankub.album";
const TYPE: Record<BoardKind, string> = { note: NOTE_TYPE, album: ALBUM_TYPE };

export const NOTE_PREFIX = "📝 โน้ต\n";
export const ALBUM_PREFIX = "🖼 อัลบั้ม: ";

export interface BoardEntry {
    kind: BoardKind;
    /** state_key */
    id: string;
    /** ข้อความต้นฉบับ (ราก) ของโน้ต/อัลบั้ม */
    eventId: string;
    createdBy: string;
    createdTs: number;
    updatedTs: number;
}

/** รายการโน้ตหรืออัลบั้มของห้อง (ใหม่สุดก่อน) */
export function listBoard(room: Room, kind: BoardKind): BoardEntry[] {
    return room.currentState
        .getStateEvents(TYPE[kind])
        .map((ev): BoardEntry | null => {
            const c = ev.getContent();
            if (typeof c.event_id !== "string" || !c.event_id.startsWith("$")) return null;
            return {
                kind,
                id: ev.getStateKey()!,
                eventId: c.event_id,
                createdBy: typeof c.created_by === "string" ? c.created_by : ev.getSender()!,
                createdTs: Number(c.created_ts) || ev.getTs(),
                updatedTs: Number(c.updated_ts) || ev.getTs(),
            };
        })
        .filter((e): e is BoardEntry => !!e)
        .sort((a, b) => b.updatedTs - a.updatedTs);
}

/** อ่านรหัสโน้ต/อัลบั้มจากเนื้อหาข้อความ (ใช้แสดงการ์ดในแชท) */
export function readBoardRef(content: Record<string, unknown>): { kind: BoardKind; id: string } | null {
    for (const kind of ["note", "album"] as const) {
        const v = content[TYPE[kind]] as { id?: unknown } | undefined;
        if (v && typeof v.id === "string" && /^[\w-]{4,40}$/.test(v.id)) return { kind, id: v.id };
    }
    return null;
}

/** ข้อความโน้ต (ไม่รวมหัว "📝 โน้ต") */
export function noteText(content: Record<string, unknown>): string {
    const body = typeof content.body === "string" ? content.body : "";
    return body.startsWith(NOTE_PREFIX) ? body.slice(NOTE_PREFIX.length) : body;
}

export function albumName(content: Record<string, unknown>): string {
    const body = typeof content.body === "string" ? content.body : "";
    return (body.startsWith(ALBUM_PREFIX) ? body.slice(ALBUM_PREFIX.length) : body).split("\n")[0] || "อัลบั้ม";
}

/** บรรทัดแรก = หัวข้อ */
export function noteTitle(text: string): string {
    return text.trim().split("\n")[0].slice(0, 80) || "โน้ต";
}

/**
 * สิทธิ์สร้างโน้ต/อัลบั้ม — ปกติ state event ต้องเป็นผู้ดูแล (50) จึงเปิดให้สมาชิกทุกคน (0) แบบ LINE
 * ผู้ดูแลห้องเปิดให้อัตโนมัติครั้งแรกที่ใช้ · ห้องเดิมทั้งหมด: aranchat-ess/scripts/23-board-permissions.py
 */
export async function ensureBoardPermission(cli: MatrixClient, room: Room): Promise<boolean> {
    const me = cli.getSafeUserId();
    const state = room.currentState;
    if (state.maySendStateEvent(NOTE_TYPE, me) && state.maySendStateEvent(ALBUM_TYPE, me)) {
        const pl = state.getStateEvents(EventType.RoomPowerLevels, "")?.getContent();
        // สมาชิกทั่วไปทำได้แล้ว (หรือเราเป็นผู้ดูแลที่เปิดให้ได้)
        if (pl?.events?.[NOTE_TYPE] === 0 && pl?.events?.[ALBUM_TYPE] === 0) return true;
        if (!state.maySendStateEvent(EventType.RoomPowerLevels, me)) return true;
    }
    if (!state.maySendStateEvent(EventType.RoomPowerLevels, me)) return false;
    const pl = { ...(state.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() ?? {}) };
    pl.events = { ...(pl.events ?? {}), [NOTE_TYPE]: 0, [ALBUM_TYPE]: 0 };
    await cli.sendStateEvent(room.roomId, EventType.RoomPowerLevels, pl as IPowerLevelsContent, "");
    return true;
}

export function canUseBoard(cli: MatrixClient, room: Room): boolean {
    const me = cli.getSafeUserId();
    const s = room.currentState;
    return (
        (s.maySendStateEvent(NOTE_TYPE, me) && s.maySendStateEvent(ALBUM_TYPE, me)) ||
        s.maySendStateEvent(EventType.RoomPowerLevels, me)
    );
}

const newId = (): string =>
    Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");

async function putIndex(cli: MatrixClient, room: Room, kind: BoardKind, id: string, eventId: string): Promise<void> {
    const old = room.currentState.getStateEvents(TYPE[kind], id)?.getContent();
    const now = Date.now();
    await cli.sendStateEvent(
        room.roomId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- state event ของเราไม่อยู่ใน type ของ SDK
        TYPE[kind] as any,
        {
            event_id: eventId,
            created_by: old?.created_by ?? cli.getSafeUserId(),
            created_ts: old?.created_ts ?? now,
            updated_ts: now,
        },
        id,
    );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ฟิลด์เสริมของเราไม่อยู่ใน type ของ SDK
const send = (cli: MatrixClient, roomId: string, content: Record<string, unknown>): Promise<{ event_id: string }> =>
    cli.sendMessage(roomId, content as any);

function msg(kind: BoardKind, id: string, body: string): Record<string, unknown> {
    return { msgtype: MsgType.Text, body, [TYPE[kind]]: { id } };
}

/** สร้างโน้ตใหม่ → ขึ้นเป็นการ์ดในแชท */
export async function createNote(cli: MatrixClient, room: Room, text: string): Promise<BoardEntry> {
    const id = newId();
    const { event_id } = await send(cli, room.roomId, msg("note", id, NOTE_PREFIX + text.trim()));
    await putIndex(cli, room, "note", id, event_id);
    return { kind: "note", id, eventId: event_id, createdBy: cli.getSafeUserId(), createdTs: Date.now(), updatedTs: Date.now() };
}

/** แก้ข้อความต้นฉบับ (โน้ต / ชื่ออัลบั้ม) — การ์ดในแชทเปลี่ยนตาม */
async function replace(cli: MatrixClient, room: Room, entry: BoardEntry, body: string): Promise<void> {
    const content = msg(entry.kind, entry.id, body);
    await send(cli, room.roomId, {
        ...content,
        "m.new_content": content,
        "m.relates_to": { rel_type: RelationType.Replace, event_id: entry.eventId },
    });
    await putIndex(cli, room, entry.kind, entry.id, entry.eventId);
}

export const editNote = (cli: MatrixClient, room: Room, entry: BoardEntry, text: string): Promise<void> =>
    replace(cli, room, entry, NOTE_PREFIX + text.trim());

export const renameAlbum = (cli: MatrixClient, room: Room, entry: BoardEntry, name: string): Promise<void> =>
    replace(cli, room, entry, ALBUM_PREFIX + name.trim());

/** ลบออกจากรายการ + ลบข้อความต้นฉบับ (ถ้ามีสิทธิ์) */
export async function removeEntry(cli: MatrixClient, room: Room, entry: BoardEntry): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- state event ของเรา
    await cli.sendStateEvent(room.roomId, TYPE[entry.kind] as any, {}, entry.id);
    await cli.redactEvent(room.roomId, entry.eventId).catch(() => {});
}

/** เนื้อหาล่าสุดของข้อความต้นฉบับ (รวมการแก้ไขแล้ว) */
export async function loadLatest(cli: MatrixClient, room: Room, eventId: string): Promise<Record<string, unknown> | null> {
    const local = room.findEventById(eventId);
    if (local && !local.isDecryptionFailure()) {
        const edit = local.replacingEvent();
        if (edit || !local.isRedacted()) return local.getContent(); // getContent() ใช้เนื้อหาที่แก้แล้วให้เอง
    }
    const r = await cli.relations(room.roomId, eventId, RelationType.Replace, null, { dir: Direction.Backward, limit: 20 });
    const orig = r.originalEvent;
    if (!orig || orig.isRedacted() || orig.isDecryptionFailure()) return null;
    const latest = r.events
        .filter((e) => !e.isDecryptionFailure() && e.getWireContent())
        .sort((a, b) => b.getTs() - a.getTs())[0];
    const nc = latest?.getContent()["m.new_content"];
    return (nc && typeof nc === "object" ? nc : orig.getContent()) as Record<string, unknown>;
}

/** รูป/วิดีโอในอัลบั้ม (ในเธรด) ใหม่สุดก่อน */
export async function albumPhotos(cli: MatrixClient, room: Room, rootId: string, max = 300): Promise<MatrixEvent[]> {
    const out: MatrixEvent[] = [];
    let from: string | undefined;
    do {
        const r = await cli.relations(room.roomId, rootId, THREAD_RELATION_TYPE.name, EventType.RoomMessage, {
            dir: Direction.Backward,
            limit: 100,
            from,
        });
        for (const e of r.events) {
            const t = e.getContent().msgtype;
            if ((t === MsgType.Image || t === MsgType.Video) && !e.isRedacted()) out.push(e);
        }
        from = r.nextBatch ?? undefined;
    } while (from && out.length < max);
    return out;
}

/** ส่งรูปเข้าอัลบั้ม (ในเธรด) ทีละรูปตามลำดับ — เข้ารหัส/ย่อรูปแบบเดียวกับส่งรูปปกติ */
export async function addPhotos(
    cli: MatrixClient,
    room: Room,
    entry: BoardEntry,
    files: File[],
    onProgress?: (done: number) => void,
): Promise<void> {
    const relation = { rel_type: THREAD_RELATION_TYPE.name, event_id: entry.eventId, is_falling_back: true };
    let done = 0;
    for (const f of files) {
        await ContentMessages.sharedInstance().sendContentToRoom(f, room.roomId, relation, cli, undefined);
        onProgress?.(++done);
    }
    await putIndex(cli, room, "album", entry.id, entry.eventId);
}

export async function createAlbum(
    cli: MatrixClient,
    room: Room,
    name: string,
    files: File[],
    onProgress?: (done: number) => void,
): Promise<BoardEntry> {
    const id = newId();
    const { event_id } = await send(cli, room.roomId, msg("album", id, ALBUM_PREFIX + name.trim()));
    await putIndex(cli, room, "album", id, event_id);
    const entry: BoardEntry = { kind: "album", id, eventId: event_id, createdBy: cli.getSafeUserId(), createdTs: Date.now(), updatedTs: Date.now() };
    if (files.length) await addPhotos(cli, room, entry, files, onProgress);
    return entry;
}

/** หารายการจากรหัส (การ์ดในแชท → เปิดหน้าโน้ต/อัลบั้ม) */
export function findEntry(room: Room, kind: BoardKind, id: string): BoardEntry | null {
    return listBoard(room, kind).find((e) => e.id === id) ?? null;
}

