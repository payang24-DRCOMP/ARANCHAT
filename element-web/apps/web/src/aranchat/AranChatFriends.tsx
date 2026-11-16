/*
 * AranChat — หน้า "เพื่อน": รายชื่อเพื่อนทั้งหมด + กลุ่มทั้งหมด (แทนรายการแชท เมื่อกด "เพื่อน" บนแถบเมนู)
 *   เพื่อน = ทุกคนที่อยู่ห้องเดียวกับเรา (ห้องรวมเจ้าหน้าที่มีทุกคน จึงได้เจ้าหน้าที่ทั้งหมด) + คนที่เคยแชทส่วนตัว
 *   กดเพื่อน → เปิดแชทส่วนตัวเดิม หรือเริ่มแชทใหม่ · กดกลุ่ม → เปิดห้อง
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React, { type JSX, useEffect, useMemo, useState } from "react";
import { ClientEvent, type Room } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

import { useMatrixClientContext } from "../contexts/MatrixClientContext";
import { useEventEmitter } from "../hooks/useEventEmitter";
import defaultDispatcher from "../dispatcher/dispatcher";
import { Action } from "../dispatcher/actions";
import DMRoomMap from "../utils/DMRoomMap";
import { DirectoryMember, startDmOnFirstMessage } from "../utils/direct-messages";
import BaseAvatar from "../components/views/avatars/BaseAvatar";
import { mediaFromMxc } from "../customisations/Media";
import { aranChatConfig } from "./config";
import { aranChatSection, useAranChatSection } from "./section";
import { markFriendsSeen, newFriends } from "./newFriends";
import Modal from "../Modal";
import { AranShareDialog } from "./AranShareDialog";

interface Friend {
    userId: string;
    name: string;
    avatarMxc?: string;
}

const collator = new Intl.Collator("th");
const thumb = (mxc?: string | null): string | undefined =>
    mxc ? (mediaFromMxc(mxc).getSquareThumbnailHttp(40) ?? undefined) : undefined;

export function AranChatFriends(): JSX.Element {
    const cli = useMatrixClientContext();
    const [q, setQ] = useState("");
    const [tick, setTick] = useState(0);
    useEventEmitter(cli, ClientEvent.Sync, () => setTick((t) => t + 1));

    // เปิดหน้านี้ = เห็นเพื่อนใหม่แล้ว (จุดแดงบนแถบเมนูหาย) — ป้าย "ใหม่" ในหน้านี้ยังอยู่ครบ 7 วัน
    useEffect(() => {
        markFriendsSeen();
        return markFriendsSeen;
    }, []);

    const { friends, groups, fresh, recent } = useMemo(() => {
        void tick;
        const me = cli.getUserId();
        const bot = aranChatConfig()?.bot_user;
        const dm = DMRoomMap.shared();
        const people = new Map<string, Friend>();
        const groups: Room[] = [];
        for (const room of cli.getRooms()) {
            if (room.getMyMembership() !== KnownMembership.Join || room.isSpaceRoom()) continue;
            if (!dm.getUserIdForRoomId(room.roomId)) groups.push(room);
            for (const m of room.getJoinedMembers()) {
                if (m.userId === me || m.userId === bot || people.has(m.userId)) continue;
                people.set(m.userId, { userId: m.userId, name: m.rawDisplayName || m.name, avatarMxc: m.getMxcAvatarUrl() });
            }
        }
        const fresh = newFriends(cli);
        // คุยล่าสุด: แชทส่วนตัว 5 ห้องที่มีความเคลื่อนไหวล่าสุด
        const recent = cli
            .getRooms()
            .filter((r) => r.getMyMembership() === KnownMembership.Join && dm.getUserIdForRoomId(r.roomId))
            .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp())
            .map((r) => people.get(dm.getUserIdForRoomId(r.roomId)!))
            .filter((f): f is Friend => !!f)
            .slice(0, 5);
        return {
            friends: [...people.values()].sort((a, b) => collator.compare(a.name, b.name)),
            groups: groups.sort((a, b) => collator.compare(a.name, b.name)),
            fresh,
            recent,
        };
    }, [cli, tick]);

    const term = q.trim().toLowerCase();
    const shownFriends = term ? friends.filter((f) => f.name.toLowerCase().includes(term) || f.userId.includes(term)) : friends;
    const shownGroups = term ? groups.filter((g) => g.name.toLowerCase().includes(term)) : groups;
    const newcomers = term ? [] : friends.filter((f) => fresh.has(f.userId)).sort((a, b) => fresh.get(b.userId)! - fresh.get(a.userId)!);
    const recentShown = term ? [] : recent;
    const friendRow = (f: Friend, key: string): JSX.Element => (
        <button key={key} type="button" className="mx_AranChatFriends_row" onClick={() => void openFriend(f)}>
            <BaseAvatar name={f.name} idName={f.userId} url={thumb(f.avatarMxc)} size="40px" />
            <span className="mx_AranChatFriends_name">
                <b>{f.name}</b>
                <small>{f.userId.replace(/^@/, "").split(":")[0]}</small>
            </span>
            {fresh.has(f.userId) && <span className="mx_AranChatFriends_new">ใหม่</span>}
        </button>
    );

    const openFriend = async (f: Friend): Promise<void> => {
        const dmRooms = DMRoomMap.shared()
            .getDMRoomsForUserId(f.userId)
            .map((id) => cli.getRoom(id))
            .filter((r): r is Room => r?.getMyMembership() === KnownMembership.Join);
        aranChatSection.set("chat");
        if (dmRooms[0]) {
            defaultDispatcher.dispatch({ action: Action.ViewRoom, room_id: dmRooms[0].roomId, metricsTrigger: undefined });
            return;
        }
        await startDmOnFirstMessage(cli, [new DirectoryMember({ user_id: f.userId, display_name: f.name, avatar_url: f.avatarMxc })]);
    };
    const openGroup = (room: Room): void => {
        aranChatSection.set("chat");
        defaultDispatcher.dispatch({ action: Action.ViewRoom, room_id: room.roomId, metricsTrigger: undefined });
    };

    return (
        <div className="mx_AranChatFriends">
            <div className="mx_AranChatFriends_head">
                <h1>
                    เพื่อน
                    <small>เจ้าหน้าที่ทั้งหมด {friends.length} คน · แตะชื่อเพื่อเริ่มแชท</small>
                </h1>
                <button
                    type="button"
                    className="mx_AranChatFriends_add mx_AranChatFriends_invite"
                    onClick={() => Modal.createDialog(AranShareDialog, {})}
                >
                    ชวนเพื่อน
                </button>
                <button
                    type="button"
                    className="mx_AranChatFriends_add"
                    onClick={() => defaultDispatcher.dispatch({ action: Action.CreateChat })}
                >
                    + เพิ่มเพื่อน
                </button>
            </div>
            <input
                className="mx_AranChatFriends_search"
                type="search"
                placeholder="ค้นหาชื่อเพื่อนหรือกลุ่ม"
                value={q}
                onChange={(e) => setQ(e.target.value)}
            />
            <div className="mx_AranChatFriends_list">
                {newcomers.length > 0 && (
                    <>
                        <h2>
                            เพิ่งเข้ามาใหม่ <span>{newcomers.length}</span>
                        </h2>
                        {newcomers.map((f) => friendRow(f, `new-${f.userId}`))}
                    </>
                )}
                {recentShown.length > 0 && (
                    <>
                        <h2>คุยล่าสุด</h2>
                        {recentShown.map((f) => friendRow(f, `recent-${f.userId}`))}
                    </>
                )}
                <h2>
                    กลุ่ม <span>{shownGroups.length}</span>
                </h2>
                {shownGroups.map((g) => (
                    <button key={g.roomId} type="button" className="mx_AranChatFriends_row" onClick={() => openGroup(g)}>
                        <BaseAvatar name={g.name} idName={g.roomId} url={thumb(g.getMxcAvatarUrl())} size="40px" />
                        <span className="mx_AranChatFriends_name">
                            <b>{g.name}</b>
                            <small>{g.getJoinedMemberCount()} สมาชิก</small>
                        </span>
                    </button>
                ))}
                <h2>
                    เพื่อนทั้งหมด <span>{shownFriends.length}</span>
                </h2>
                {shownFriends.map((f) => friendRow(f, f.userId))}
                {!shownFriends.length && !shownGroups.length && <p className="mx_AranChatFriends_empty">ไม่พบ "{q}"</p>}
            </div>
        </div>
    );
}

/** คอลัมน์รายการ: หมวดเพื่อน → หน้าเพื่อน · อื่นๆ → รายการแชทของ Element (LeftPanel) */
export function AranChatListSwitch({ children }: { children: React.ReactNode }): JSX.Element {
    const section = useAranChatSection();
    return section === "friends" && aranChatConfig() ? <AranChatFriends /> : <>{children}</>;
}
