/*
 * AranChat — ลิงก์ชวนเพื่อน / แชร์กลุ่ม (server: aranchat-ess/notify/invites.mjs, หน้า https://<chat>/i/<รหัส>)
 *
 * - createInvite: ขอรหัสจาก server (ยืนยันตัวด้วย OpenID token) — รหัสเดิมถ้าเคยสร้างแล้ว
 * - consumePendingInvite: เปิดลิงก์มาก่อนล็อกอิน → หน้า /i/ จำรหัสไว้ใน localStorage (หรือ ?invite= ใน URL)
 *   ล็อกอินเสร็จ → แจ้ง server (นับว่าใครชวน + บอทบอกคนชวน) → เปิดแชทกับคนชวน / หน้าขอเข้ากลุ่ม
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { EventType, JoinRule, KnownMembership, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { aranChatConfig } from "./config";
import defaultDispatcher from "../dispatcher/dispatcher";
import { Action } from "../dispatcher/actions";
import DMRoomMap from "../utils/DMRoomMap";
import { DirectoryMember, startDmOnFirstMessage } from "../utils/direct-messages";

const log = logger.getChild("AranInvites");
const PENDING = "aranchat_invite";

export interface AranInvite {
    code: string;
    url: string;
    /** จำนวนคนที่เข้ามาผ่านลิงก์นี้แล้ว */
    joined: number;
}

function apiBase(): string {
    return (aranChatConfig()?.invite_api ?? "/api/notify").replace(/\/+$/, "");
}

async function post<T>(cli: MatrixClient, path: string, body: Record<string, unknown> = {}): Promise<T> {
    const openid = await cli.getOpenIdToken();
    const r = await fetch(apiBase() + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openid, ...body }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
    return data as T;
}

/** ห้องนี้เป็นกลุ่ม (ไม่ใช่แชทส่วนตัว) ที่แชร์ได้ */
export function isShareableGroup(room: Room): boolean {
    return !DMRoomMap.shared().getUserIdForRoomId(room.roomId) && room.getMyMembership() === KnownMembership.Join;
}

/**
 * ลิงก์กลุ่มต้องให้คน "ขอเข้าร่วม" ได้ (knock) — ผู้ดูแลกลุ่มอนุมัติ ไม่มีใครเข้าเองได้ (กลุ่มมีข้อมูลผู้ป่วย)
 * @returns "ok" | "changed" (เพิ่งเปิดให้ขอเข้าร่วม) | "no-permission"
 */
export async function prepareGroupForLink(cli: MatrixClient, room: Room): Promise<"ok" | "changed" | "no-permission"> {
    const rule = room.getJoinRule();
    if (rule === JoinRule.Knock || rule === JoinRule.Public) return "ok";
    if (!room.currentState.maySendStateEvent(EventType.RoomJoinRules, cli.getSafeUserId())) return "no-permission";
    await cli.sendStateEvent(room.roomId, EventType.RoomJoinRules, { join_rule: JoinRule.Knock });
    return "changed";
}

export function createInvite(cli: MatrixClient, roomId?: string): Promise<AranInvite> {
    return post<AranInvite>(cli, "/invite/create", roomId ? { room_id: roomId } : {});
}

function takePending(): string | null {
    let code: string | null = null;
    try {
        const url = new URL(window.location.href);
        code = url.searchParams.get("invite");
        if (code) {
            url.searchParams.delete("invite");
            window.history.replaceState(null, "", url.toString());
        }
        code ??= localStorage.getItem(PENDING);
        localStorage.removeItem(PENDING);
    } catch {
        /* โหมดส่วนตัว */
    }
    return code && /^[a-z0-9]{8}$/.test(code) ? code : null;
}

/** เรียกหลัง sync ครั้งแรก */
export async function consumePendingInvite(cli: MatrixClient): Promise<void> {
    const code = takePending();
    if (!code || !aranChatConfig()) return;
    try {
        const r = await post<{ kind: "user" | "room"; mxid?: string; room_id?: string }>(cli, `/invite/${code}/accept`);
        // รอ Element พาไปหน้าแรกหลังล็อกอินให้เสร็จก่อน ไม่อย่างนั้นจะเปิดหน้าแรกทับห้องที่เราเปิด
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        if (r.kind === "user" && r.mxid && r.mxid !== cli.getUserId()) {
            const dm = DMRoomMap.shared()
                .getDMRoomsForUserId(r.mxid)
                .map((id) => cli.getRoom(id))
                .find((room) => room?.getMyMembership() === KnownMembership.Join);
            if (dm) {
                defaultDispatcher.dispatch({ action: Action.ViewRoom, room_id: dm.roomId, metricsTrigger: undefined });
                return;
            }
            const p = await cli.getProfileInfo(r.mxid).catch(() => ({}) as { displayname?: string; avatar_url?: string });
            await startDmOnFirstMessage(cli, [
                new DirectoryMember({ user_id: r.mxid, display_name: p.displayname, avatar_url: p.avatar_url }),
            ]);
        } else if (r.kind === "room" && r.room_id) {
            // ยังไม่ได้อยู่ในกลุ่ม → หน้าตัวอย่างห้องพร้อมปุ่ม "ขอเข้าร่วม"
            defaultDispatcher.dispatch({
                action: Action.ViewRoom,
                room_id: r.room_id,
                via_servers: [cli.getDomain()!],
                metricsTrigger: undefined,
            });
        }
    } catch (e) {
        log.warn("เปิดลิงก์ชวนไม่สำเร็จ", e);
    }
}
