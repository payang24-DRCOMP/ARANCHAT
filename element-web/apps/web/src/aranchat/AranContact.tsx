/*
 * AranChat — การ์ดติดต่อ (แบบ "ส่งข้อมูลติดต่อ" ใน LINE)
 *
 * ปุ่ม + ในช่องพิมพ์ → "เพื่อน" → เลือกเพื่อน → ส่งการ์ดให้คนที่กำลังคุยอยู่
 * คนรับแตะ "แชท" → เปิดแชทส่วนตัวกับเพื่อนคนนั้นทันที
 *
 * รูปแบบข้อความ (ใช้ร่วมกับ Android: AranContact.kt) — m.text ธรรมดา แอปอื่นเห็นเป็นข้อความ + ลิงก์
 *   body: "👤 แนะนำเพื่อน: <ชื่อ>\n<ลิงก์>"
 *   "com.arankub.contact": { user_id, name, avatar_url? }
 * อยู่ในเนื้อหาข้อความ → ห้องเข้ารหัสก็ถูกเข้ารหัสด้วย
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React, { type JSX, useMemo, useState } from "react";
import { KnownMembership, MsgType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import BaseDialog from "../components/views/dialogs/BaseDialog";
import BaseAvatar from "../components/views/avatars/BaseAvatar";
import { mediaFromMxc } from "../customisations/Media";
import { MatrixClientPeg } from "../MatrixClientPeg";
import defaultDispatcher from "../dispatcher/dispatcher";
import { Action } from "../dispatcher/actions";
import DMRoomMap from "../utils/DMRoomMap";
import { DirectoryMember, startDmOnFirstMessage } from "../utils/direct-messages";
import { aranChatConfig } from "./config";

export const ARANCHAT_CONTACT_KEY = "com.arankub.contact";

export interface AranContactInfo {
    user_id: string;
    name: string;
    avatar_url?: string;
}

const collator = new Intl.Collator("th");
const thumb = (mxc?: string | null, size = 40): string | undefined =>
    mxc?.startsWith("mxc://") ? (mediaFromMxc(mxc).getSquareThumbnailHttp(size) ?? undefined) : undefined;

/** อ่านการ์ดติดต่อจากเนื้อหาข้อความ — รูปแบบไม่ถูกต้อง = null (แสดงเป็นข้อความปกติ) */
export function readContact(content: Record<string, unknown>): AranContactInfo | null {
    const c = content[ARANCHAT_CONTACT_KEY] as Record<string, unknown> | undefined;
    if (!c || typeof c.user_id !== "string" || !/^@[^:\s]+:\S+$/.test(c.user_id)) return null;
    return {
        user_id: c.user_id,
        name: typeof c.name === "string" && c.name.trim() ? c.name.slice(0, 80) : c.user_id,
        avatar_url: typeof c.avatar_url === "string" ? c.avatar_url : undefined,
    };
}

/** ลิงก์โปรไฟล์บนเว็บแชทของเรา (แอปอื่นแตะได้) */
const profileLink = (userId: string): string => `${window.location.origin}/#/user/${encodeURIComponent(userId)}`;

/** เปิดแชทส่วนตัวกับคนนี้ (ห้องเดิมถ้ามี ไม่อย่างนั้นสร้างเมื่อพิมพ์ข้อความแรก) */
export async function openDmWith(cli: MatrixClient, c: AranContactInfo): Promise<void> {
    if (c.user_id === cli.getUserId()) return;
    const dm = DMRoomMap.shared()
        .getDMRoomsForUserId(c.user_id)
        .map((id) => cli.getRoom(id))
        .find((room) => room?.getMyMembership() === KnownMembership.Join);
    if (dm) {
        defaultDispatcher.dispatch({ action: Action.ViewRoom, room_id: dm.roomId, metricsTrigger: undefined });
        return;
    }
    await startDmOnFirstMessage(cli, [new DirectoryMember({ user_id: c.user_id, display_name: c.name, avatar_url: c.avatar_url })]);
}

export function sendContact(cli: MatrixClient, roomId: string, threadId: string | null, c: AranContactInfo): Promise<unknown> {
    const content = {
        msgtype: MsgType.Text,
        body: `👤 แนะนำเพื่อน: ${c.name}\n${profileLink(c.user_id)}`,
        [ARANCHAT_CONTACT_KEY]: c,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ฟิลด์เสริมของเราไม่อยู่ใน type ของ SDK
    return cli.sendMessage(roomId, threadId, content as any);
}

/** รายชื่อเพื่อน = ทุกคนในห้องที่เราอยู่ (รวมห้องรวมเจ้าหน้าที่) ยกเว้นตัวเองและบอท */
function listFriends(cli: MatrixClient, exclude: Set<string>): AranContactInfo[] {
    const me = cli.getUserId();
    const bot = aranChatConfig()?.bot_user;
    const people = new Map<string, AranContactInfo>();
    for (const room of cli.getRooms()) {
        if (room.getMyMembership() !== KnownMembership.Join || room.isSpaceRoom()) continue;
        for (const m of room.getJoinedMembers()) {
            if (m.userId === me || m.userId === bot || exclude.has(m.userId) || people.has(m.userId)) continue;
            people.set(m.userId, { user_id: m.userId, name: m.rawDisplayName || m.name, avatar_url: m.getMxcAvatarUrl() });
        }
    }
    return [...people.values()].sort((a, b) => collator.compare(a.name, b.name));
}

interface PickerProps {
    room: Room;
    threadId: string | null;
    onFinished: () => void;
}

/** หน้าต่างเลือกเพื่อนเพื่อส่งการ์ดติดต่อเข้าห้องนี้ */
export function AranContactPickerDialog({ room, threadId, onFinished }: PickerProps): JSX.Element {
    const cli = MatrixClientPeg.safeGet();
    const [q, setQ] = useState("");
    const [sending, setSending] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    // ไม่แนะนำคนที่อยู่ในห้องนี้แล้ว (คุยกันอยู่แล้ว)
    const friends = useMemo(
        () => listFriends(cli, new Set(room.getJoinedMembers().map((m) => m.userId))),
        [cli, room],
    );
    const term = q.trim().toLowerCase();
    const shown = term ? friends.filter((f) => f.name.toLowerCase().includes(term) || f.user_id.includes(term)) : friends;

    const pick = (f: AranContactInfo): void => {
        setSending(f.user_id);
        sendContact(cli, room.roomId, threadId, f)
            .then(() => onFinished())
            .catch(() => {
                setSending(null);
                setError("ส่งไม่สำเร็จ ลองอีกครั้ง");
            });
    };

    return (
        <BaseDialog className="mx_AranContactPicker" title="ส่งข้อมูลติดต่อเพื่อน" onFinished={onFinished} fixedWidth={false}>
            <p className="mx_AranContactPicker_lead">เลือกเพื่อนที่จะแนะนำให้คนในแชทนี้ — เขาแตะแล้วเริ่มคุยกับเพื่อนคนนั้นได้ทันที</p>
            <input
                className="mx_AranContactPicker_search"
                type="search"
                placeholder="ค้นหาชื่อเพื่อน"
                value={q}
                autoFocus
                onChange={(e) => setQ(e.target.value)}
            />
            {error && <p className="mx_AranContactPicker_error">{error}</p>}
            <div className="mx_AranContactPicker_list">
                {shown.map((f) => (
                    <button
                        key={f.user_id}
                        type="button"
                        className="mx_AranContactPicker_row"
                        disabled={!!sending}
                        onClick={() => pick(f)}
                    >
                        <BaseAvatar name={f.name} idName={f.user_id} url={thumb(f.avatar_url)} size="36px" />
                        <span className="mx_AranContactPicker_name">
                            <b>{f.name}</b>
                            <small>{f.user_id.slice(1).split(":")[0]}</small>
                        </span>
                        {sending === f.user_id && <em>กำลังส่ง…</em>}
                    </button>
                ))}
                {!shown.length && <p className="mx_AranContactPicker_empty">{term ? `ไม่พบ "${q}"` : "ยังไม่มีรายชื่อเพื่อน"}</p>}
            </div>
        </BaseDialog>
    );
}

/** การ์ดติดต่อในห้องแชท */
export function AranContactBody({ mxEvent }: { mxEvent: MatrixEvent }): JSX.Element | null {
    const c = readContact(mxEvent.getContent());
    if (!c) return null;
    const cli = MatrixClientPeg.safeGet();
    const isMe = c.user_id === cli.getUserId();
    return (
        <div className="mx_AranContact">
            <div className="mx_AranContact_head">แนะนำเพื่อน</div>
            <div className="mx_AranContact_person">
                <BaseAvatar name={c.name} idName={c.user_id} url={thumb(c.avatar_url, 96)} size="48px" />
                <span className="mx_AranContact_name">
                    <b>{c.name}</b>
                    <small>{c.user_id.slice(1).split(":")[0]}</small>
                </span>
            </div>
            {!isMe && (
                <button type="button" className="mx_AranContact_btn" onClick={() => void openDmWith(cli, c)}>
                    แชท
                </button>
            )}
        </div>
    );
}
