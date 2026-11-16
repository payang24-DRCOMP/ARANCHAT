/*
 * AranChat — แผงเลือกสติกเกอร์ (แทนตัวเลือกสติกเกอร์แบบ widget ของ Element ที่ต้องมี integration manager)
 * เปิดจากปุ่มสติกเกอร์เดิมในช่องพิมพ์ (MessageComposer → isStickerPickerOpen)
 * แบบ LINE: แท็บด้านล่าง = 🕘 ใช้ล่าสุด + ชุดสติกเกอร์ · แตะแล้วส่งทันที · ภาพเคลื่อนไหวเล่นเองในแผง
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React, { type JSX, useEffect, useState } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import ContextMenu, { ChevronFace, type MenuProps } from "../components/structures/ContextMenu";
import { MatrixClientPeg } from "../MatrixClientPeg";
import Modal from "../Modal";
import ErrorDialog from "../components/views/dialogs/ErrorDialog";
import { type AranSticker, type AranStickerPack, loadStickerPacks, recentStickers, sendAranSticker } from "./stickers";

interface Props {
    room: Room;
    threadId?: string | null;
    isOpen: boolean;
    setOpen: (open: boolean) => void;
    menuPosition?: MenuProps;
}

const WIDTH = 344;
const HEIGHT = 380;
const RECENT = "__recent";
const TAB_KEY = "aranchat_sticker_tab";

/** แผงสติกเกอร์ 4 คอลัมน์ + แท็บชุดสติกเกอร์ */
export function AranStickerPicker({ room, threadId, isOpen, setOpen, menuPosition }: Props): JSX.Element | null {
    const [packs, setPacks] = useState<AranStickerPack[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [tab, setTab] = useState<string>(() => {
        try {
            return localStorage.getItem(TAB_KEY) ?? RECENT;
        } catch {
            return RECENT;
        }
    });

    useEffect(() => {
        if (!isOpen || packs) return;
        loadStickerPacks()
            .then(setPacks)
            .catch((e) => {
                logger.warn("AranChat: โหลดสติกเกอร์ไม่ได้", e);
                setFailed(true);
            });
    }, [isOpen, packs]);

    if (!isOpen) return null;

    const cli = MatrixClientPeg.safeGet();
    const recent = packs ? recentStickers(cli, packs) : [];
    // ยังไม่เคยใช้ → เปิดชุดแรก · ชุดที่จำไว้ถูกซ่อนแล้ว → ชุดแรก
    let current = tab;
    if (packs && (current === RECENT ? !recent.length : !packs.some((p) => p.id === current))) {
        current = recent.length ? RECENT : packs[0].id;
    }
    const shown: AranSticker[] = !packs ? [] : current === RECENT ? recent : (packs.find((p) => p.id === current)?.stickers ?? []);
    const title = current === RECENT ? "ใช้ล่าสุด" : (packs?.find((p) => p.id === current)?.name ?? "สติกเกอร์");

    const choose = (id: string): void => {
        setTab(id);
        try {
            localStorage.setItem(TAB_KEY, id);
        } catch {
            /* โหมดส่วนตัว */
        }
    };

    const send = (s: AranSticker): void => {
        setOpen(false);
        sendAranSticker(cli, room.roomId, threadId ?? null, s).catch((e) => {
            logger.warn("AranChat: ส่งสติกเกอร์ไม่สำเร็จ", e);
            Modal.createDialog(ErrorDialog, {
                title: "ส่งสติกเกอร์ไม่สำเร็จ",
                description: "ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง",
            });
        });
    };

    return (
        <ContextMenu
            chevronFace={ChevronFace.Bottom}
            menuWidth={WIDTH}
            menuHeight={HEIGHT}
            onFinished={() => setOpen(false)}
            menuPaddingTop={0}
            menuPaddingLeft={0}
            menuPaddingRight={0}
            mountAsChild={true}
            {...menuPosition}
        >
            <div className="mx_AranStickers" role="dialog" aria-label="สติกเกอร์">
                <div className="mx_AranStickers_title">{title}</div>
                <div className="mx_AranStickers_grid">
                    {failed && <div className="mx_AranStickers_empty">โหลดสติกเกอร์ไม่ได้ ลองใหม่อีกครั้ง</div>}
                    {!failed && !packs && <div className="mx_AranStickers_empty">กำลังโหลด…</div>}
                    {shown.map((s) => (
                        <button
                            key={s.ref}
                            type="button"
                            className="mx_AranStickers_item"
                            title={s.body}
                            aria-label={`ส่งสติกเกอร์ ${s.body}`}
                            onClick={() => send(s)}
                        >
                            <img src={s.url} alt={s.body} width={72} height={72} loading="lazy" />
                        </button>
                    ))}
                </div>
                {packs && (
                    <div className="mx_AranStickers_tabs" role="tablist">
                        {recent.length > 0 && (
                            <button
                                type="button"
                                role="tab"
                                aria-selected={current === RECENT}
                                aria-label="ใช้ล่าสุด"
                                title="ใช้ล่าสุด"
                                className="mx_AranStickers_tab mx_AranStickers_tab_recent"
                                onClick={() => choose(RECENT)}
                            >
                                🕘
                            </button>
                        )}
                        {packs.map((p) => (
                            <button
                                key={p.id}
                                type="button"
                                role="tab"
                                aria-selected={current === p.id}
                                aria-label={p.name}
                                title={p.name}
                                className="mx_AranStickers_tab"
                                onClick={() => choose(p.id)}
                            >
                                <img src={p.icon} alt="" width={32} height={32} />
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </ContextMenu>
    );
}
