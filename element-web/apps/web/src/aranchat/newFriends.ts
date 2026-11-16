/*
 * AranChat — เจ้าหน้าที่ที่เพิ่งเข้าระบบ (เข้า "ห้องรวมเจ้าหน้าที่" #staff:<เซิร์ฟเวอร์> ภายใน 7 วัน)
 *   หน้าเพื่อนขึ้นป้าย "ใหม่" · แถบเมนูขึ้นจุดแดงที่ "เพื่อน" จนกว่าจะเปิดหน้าเพื่อนดู (จำไว้ในเครื่อง)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

export const NEW_FRIEND_DAYS = 7;
// คนที่เข้าระบบก่อนวันเปิดใช้ป้ายนี้ไม่นับเป็นเพื่อนใหม่ (ไม่งั้นทุกคนในช่วงเริ่มใช้งานขึ้นป้าย "ใหม่" หมด)
const FEATURE_START = Date.parse("2026-11-11T12:00:00+07:00");
const SEEN_KEY = "aranchat_friends_seen_at";

export function staffRoom(cli: MatrixClient): Room | undefined {
    const alias = `#staff:${cli.getDomain()}`;
    return cli.getRooms().find((r) => r.getCanonicalAlias() === alias);
}

/** userId → เวลาที่เข้าห้องรวม (เฉพาะคนที่เข้ามาภายใน 7 วัน) */
export function newFriends(cli: MatrixClient): Map<string, number> {
    const out = new Map<string, number>();
    const room = staffRoom(cli);
    if (!room) return out;
    const since = Math.max(Date.now() - NEW_FRIEND_DAYS * 86400_000, FEATURE_START);
    const me = cli.getUserId();
    for (const m of room.getJoinedMembers()) {
        const ts = m.events.member?.getTs() ?? 0;
        // เปลี่ยนชื่อ/รูปก็เป็นเหตุการณ์ member — นับเฉพาะตอนเข้าห้องจริง (ก่อนหน้านี้ยังไม่เป็นสมาชิก)
        const prev = m.events.member?.getPrevContent()?.membership;
        if (m.userId !== me && ts >= since && prev !== "join" && !m.userId.startsWith("@aranchat:")) out.set(m.userId, ts);
    }
    return out;
}

export function friendsSeenAt(): number {
    try {
        return Number(localStorage.getItem(SEEN_KEY)) || 0;
    } catch {
        return 0;
    }
}

export function markFriendsSeen(): void {
    try {
        localStorage.setItem(SEEN_KEY, String(Date.now()));
    } catch {
        /* โหมดไม่ระบุตัวตน ฯลฯ — ไม่เป็นไร */
    }
}

/** จำนวนเพื่อนใหม่ที่ยังไม่ได้เปิดหน้าเพื่อนดู (จุดแดงบนแถบเมนู) */
export function unseenNewFriends(cli: MatrixClient): number {
    const seen = friendsSeenAt();
    return [...newFriends(cli).values()].filter((ts) => ts > seen).length;
}
