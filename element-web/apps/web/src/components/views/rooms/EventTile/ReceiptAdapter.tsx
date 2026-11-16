/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useState } from "react";
import { type EventStatus, type MatrixEvent, type RoomMember, RoomEvent } from "matrix-js-sdk/src/matrix";
import { Tooltip } from "@vector-im/compound-web";
import { CheckCircleIcon, CircleIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t } from "../../../../languageHandler";
import { StaticNotificationState } from "../../../../stores/notifications/StaticNotificationState";
import { NotificationBadge } from "../NotificationBadge/NotificationBadge";
import { ReadReceiptGroup } from "../ReadReceiptGroup";
import { type IReadReceiptPosition } from "../ReadReceiptMarker";
import { type EventTileReceiptState } from "../../../../viewmodels/room/timeline/event-tile/EventTileReceiptState";
import { aranChatConfig } from "../../../../aranchat/config";
import { MatrixClientPeg } from "../../../../MatrixClientPeg";
import { useEventEmitter } from "../../../../hooks/useEventEmitter";
import BaseAvatar from "../../avatars/BaseAvatar";
import { mediaFromMxc } from "../../../../customisations/Media";

/**
 * A single read receipt entry displayed in the event tile receipt row.
 */
interface ReadReceiptProps {
    /** The user ID associated with the receipt. */
    userId: string;
    /** The room member metadata for the user, if available. */
    roomMember: RoomMember | null;
    /** Timestamp of the receipt in milliseconds since the Unix epoch. */
    ts: number;
}

/**
 * Props for the {@link ReceiptAdapter} component.
 */
interface ReceiptAdapterProps {
    /** Current receipt state for the event tile. */
    receiptState: EventTileReceiptState;
    /** Send status used when rendering the sent-state badge. */
    eventSendStatus?: EventStatus;
    /** Read receipts to render when the group is visible. */
    readReceipts?: ReadReceiptProps[];
    /** Read receipt positions keyed by user ID. */
    readReceiptMap?: { [userId: string]: IReadReceiptPosition };
    /** Checks whether the receipt row is unmounting. */
    checkUnmounting?: () => boolean;
    /** Suppresses receipt animation when true. */
    suppressAnimation: boolean;
    /** Whether timestamps should use a 12-hour clock. */
    isTwelveHour?: boolean;
    /** AranChat: ข้อความของเราเอง (แสดง "อ่านแล้ว" แทนรูปคนอ่าน) */
    isOwnEvent?: boolean;
    /** AranChat: ข้อความนี้ — นับคนที่อ่านถึงหรือเลยข้อความนี้แล้ว (แบบ LINE) */
    mxEvent?: MatrixEvent;
}

/**
 * Renders the send-state or read-receipt indicator for an event tile.
 */
export function ReceiptAdapter({
    receiptState,
    eventSendStatus,
    readReceipts,
    readReceiptMap,
    checkUnmounting,
    suppressAnimation,
    isTwelveHour,
    isOwnEvent,
    mxEvent,
}: Readonly<ReceiptAdapterProps>): JSX.Element {
    if (receiptState.shouldShowSentReceipt || receiptState.shouldShowSendingReceipt) {
        return <SentReceipt messageState={eventSendStatus} />;
    }

    // AranChat: แบบแอปแชททั่วไป — ใต้ข้อความของเราเขียน "อ่านแล้ว" (กลุ่ม: "อ่านแล้ว N") แทนรูปโปรไฟล์คนอ่าน
    // ข้อความของคนอื่นไม่แสดงอะไร · ชี้ที่คำว่าอ่านแล้วเพื่อดูชื่อคนอ่าน
    if (aranChatConfig()) {
        if (!isOwnEvent) return <div className="mx_ReadReceiptGroup" />;
        if (mxEvent) return <AranReadLabel mxEvent={mxEvent} />;
        const n = readReceipts?.length ?? 0;
        if (n === 0) return <div className="mx_ReadReceiptGroup" />;
        const names = readReceipts!.map((r) => r.roomMember?.name ?? r.userId).join(", ");
        return (
            <div className="mx_ReadReceiptGroup">
                <Tooltip description={names}>
                    <span className="mx_AranChat_read" tabIndex={0}>
                        อ่านแล้ว{n > 1 ? ` ${n}` : ""}
                    </span>
                </Tooltip>
            </div>
        );
    }

    return (
        <ReadReceiptGroup
            readReceipts={readReceipts ?? []}
            readReceiptMap={readReceiptMap ?? {}}
            checkUnmounting={checkUnmounting}
            suppressAnimation={suppressAnimation}
            isTwelveHour={isTwelveHour}
        />
    );
}

interface SentReceiptProps {
    messageState: EventStatus | undefined;
}

function SentReceipt({ messageState }: Readonly<SentReceiptProps>): JSX.Element {
    const isSent = !messageState || messageState === "sent";
    const isFailed = messageState === "not_sent";

    let icon: JSX.Element | undefined;
    let label: string | undefined;
    if (messageState === "encrypting") {
        icon = <CircleIcon />;
        label = _t("timeline|send_state_encrypting");
    } else if (isSent) {
        icon = <CheckCircleIcon />;
        label = _t("timeline|send_state_sent");
    } else if (isFailed) {
        icon = <NotificationBadge notification={StaticNotificationState.RED_EXCLAMATION} />;
        label = _t("timeline|send_state_failed");
    } else {
        icon = <CircleIcon />;
        label = _t("timeline|send_state_sending");
    }

    return (
        <div className="mx_ReadReceiptGroup">
            <Tooltip label={label} placement="top-end">
                <div className="mx_ReadReceiptGroup_button" role="status">
                    <span className="mx_ReadReceiptGroup_container">{icon}</span>
                </div>
            </Tooltip>
        </div>
    );
}

/**
 * AranChat: "อ่านแล้ว" แบบ LINE — นับทุกคนที่อ่านถึงหรือเลยข้อความนี้ (ไม่ใช่แค่คนที่ตำแหน่งอ่านล่าสุดอยู่ที่ข้อความนี้)
 * แชทส่วนตัว: "อ่านแล้ว" · กลุ่ม: รูปคนอ่าน (ล่าสุดก่อน สูงสุด 4) + "อ่านแล้ว N" · ชี้เพื่อดูชื่อทั้งหมด · อัปเดตเองเมื่อมีคนอ่านเพิ่ม
 */
function AranReadLabel({ mxEvent }: { mxEvent: MatrixEvent }): JSX.Element {
    const cli = MatrixClientPeg.safeGet();
    const room = cli.getRoom(mxEvent.getRoomId());
    const [, setTick] = useState(0);
    useEventEmitter(room ?? undefined, RoomEvent.Receipt, () => setTick((t) => t + 1));
    const eventId = mxEvent.getId();
    if (!room || !eventId || mxEvent.isSending()) return <div className="mx_ReadReceiptGroup" />;
    const me = cli.getUserId();
    const bot = aranChatConfig()?.bot_user;
    const readers = room
        .getJoinedMembers()
        .filter((m) => m.userId !== me && m.userId !== bot && room.hasUserReadEvent(m.userId, eventId));
    if (readers.length === 0) return <div className="mx_ReadReceiptGroup" />;
    const isGroup = room.getJoinedMemberCount() > 2;
    // คนที่อ่านล่าสุดอยู่หน้า
    const ts = (userId: string): number => room.getReadReceiptForUserId(userId)?.data?.ts ?? 0;
    const faces = isGroup ? [...readers].sort((a, b) => ts(b.userId) - ts(a.userId)).slice(0, 4) : [];
    return (
        <div className="mx_ReadReceiptGroup">
            <Tooltip description={readers.map((m) => m.name).join(", ")}>
                <span className="mx_AranChat_read" tabIndex={0}>
                    {faces.length > 0 && (
                        <span className="mx_AranChat_readFaces" aria-hidden={true}>
                            {faces.map((m) => {
                                const mxc = m.getMxcAvatarUrl();
                                return (
                                    <BaseAvatar
                                        key={m.userId}
                                        name={m.name}
                                        idName={m.userId}
                                        url={mxc ? (mediaFromMxc(mxc).getSquareThumbnailHttp(16) ?? undefined) : undefined}
                                        size="16px"
                                    />
                                );
                            })}
                        </span>
                    )}
                    อ่านแล้ว{isGroup ? ` ${readers.length}` : ""}
                </span>
            </Tooltip>
        </div>
    );
}
