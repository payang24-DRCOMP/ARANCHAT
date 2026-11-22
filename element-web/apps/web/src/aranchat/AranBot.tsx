/*
 * AranChat — แถบบอทเหนือช่องพิมพ์ (ห้องที่บอทแจ้งเตือนอยู่) + หน้าต่างมินิแอป + หน้าต่างเลือกวันเวลา
 *   ปุ่มตอบด่วน: จากข้อความล่าสุดของบอท (content["com.arankub.quick_replies"]) หายเมื่อมีข้อความใหม่
 *   เมนูบอท: ปุ่มถาวร (GET /api/notify/bot) กด "☰ เมนู" เพื่อเปิด/ปิด — จำสถานะไว้ในเครื่อง
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React, { type JSX, useEffect, useReducer, useState } from "react";
import { type Room, RoomEvent } from "matrix-js-sdk/src/matrix";

import { useMatrixClientContext } from "../contexts/MatrixClientContext";
import Modal from "../Modal";
import { MatrixClientPeg } from "../MatrixClientPeg";
import BaseDialog from "../components/views/dialogs/BaseDialog";
import DialogButtons from "../components/views/elements/DialogButtons";
import {
    type BotInfo,
    type BotMenuItem,
    cachedBotInfo,
    isBotDm,
    latestQuickReplies,
    loadBotInfo,
    miniAppUrl,
    onBotInfo,
    sendOrPrefill,
} from "./bot";

const MENU_KEY = "aranchat_bot_menu_open";

function readMenuOpen(): boolean {
    try {
        return window.localStorage.getItem(MENU_KEY) !== "0";
    } catch {
        return true;
    }
}

/** แถบเหนือช่องพิมพ์: ปุ่มตอบด่วน + เมนูบอท */
export function AranBotBar({ room }: { room: Room }): JSX.Element | null {
    const cli = useMatrixClientContext();
    const [, refresh] = useReducer((n: number) => n + 1, 0);
    const [info, setInfo] = useState<BotInfo | null>(cachedBotInfo());
    const [open, setOpen] = useState(readMenuOpen);
    const botRoom = isBotDm(room);   // เมนูเฉพาะแชทส่วนตัวกับบอท

    useEffect(() => {
        if (!botRoom) return;
        loadBotInfo()
            .then(setInfo)
            .catch(() => {});
        return onBotInfo(() => setInfo(cachedBotInfo()));
    }, [botRoom]);
    // ข้อความใหม่ → ปุ่มตอบด่วนเปลี่ยน/หาย
    useEffect(() => {
        const onTimeline = (_e: unknown, r: Room | undefined): void => {
            if (r?.roomId === room.roomId) refresh();
        };
        room.on(RoomEvent.Timeline, onTimeline);
        room.on(RoomEvent.LocalEchoUpdated, onTimeline);
        return () => {
            room.off(RoomEvent.Timeline, onTimeline);
            room.off(RoomEvent.LocalEchoUpdated, onTimeline);
        };
    }, [room]);

    if (!botRoom) return null;
    const quick = latestQuickReplies(room);
    const menu = info?.menu ?? [];
    if (!quick && !menu.length) return null;

    const toggle = (): void => {
        setOpen(!open);
        try {
            window.localStorage.setItem(MENU_KEY, open ? "0" : "1");
        } catch {
            /* โหมดส่วนตัว */
        }
    };
    const runMenu = (m: BotMenuItem): void => {
        if (m.type === "link" && m.url) window.open(m.url, "_blank", "noopener,noreferrer");
        else if (m.type === "app" && m.url) openMiniApp(m.url, m.label);
        else sendOrPrefill(cli, room.roomId, m);
    };

    return (
        <div className="mx_AranBotBar">
            {quick && (
                <div className="mx_AranBotBar_quick" role="toolbar" aria-label="ตอบด่วน">
                    {quick.items.map((q, i) => (
                        <button key={`${quick.eventId}-${i}`} type="button" onClick={() => sendOrPrefill(cli, room.roomId, q)}>
                            {q.label}
                        </button>
                    ))}
                </div>
            )}
            {menu.length > 0 && (
                <>
                    <button type="button" className="mx_AranBotBar_toggle" aria-expanded={open} onClick={toggle}>
                        {open ? "▾ ซ่อนเมนู" : "☰ เมนู"}
                    </button>
                    {open && (
                        <div className="mx_AranBotBar_menu" role="toolbar" aria-label="เมนูบอท">
                            {menu.map((m, i) => (
                                <button key={i} type="button" onClick={() => runMenu(m)}>
                                    {m.label}
                                    {m.type !== "text" && <span aria-hidden> ↗</span>}
                                </button>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function MiniAppDialog({ url, title, onFinished }: { url: string; title: string; onFinished: () => void }): JSX.Element {
    // หน้าต่าง (Modal) อยู่นอก MatrixClientContext → ใช้ client กลาง
    const cli = MatrixClientPeg.safeGet();
    const [src, setSrc] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        miniAppUrl(cli, url).then(setSrc, (e: Error) => setError(e.message));
    }, [cli, url]);
    return (
        <BaseDialog className="mx_AranMiniApp" title={title} onFinished={onFinished} fixedWidth={false}>
            <div className="mx_AranMiniApp_bar">
                <span>{new URL(url).host}</span>
                {src && (
                    <a href={src} target="_blank" rel="noreferrer noopener">
                        เปิดในหน้าต่างใหม่ ↗
                    </a>
                )}
            </div>
            {error && <p className="mx_AranMiniApp_error">เปิดไม่ได้: {error}</p>}
            {src && (
                <iframe
                    className="mx_AranMiniApp_frame"
                    src={src}
                    title={title}
                    sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads"
                    allow="clipboard-write"
                />
            )}
        </BaseDialog>
    );
}

/** เปิดมินิแอป (หน้าเว็บซ้อนในแชท พร้อมบอกระบบว่าใครเปิด) */
export function openMiniApp(url: string, title: string): void {
    Modal.createDialog(MiniAppDialog, { url, title }, "mx_AranMiniApp_wrapper");
}

const INPUT_TYPE = { date: "date", time: "time", datetime: "datetime-local" } as const;

function DateTimeDialog(props: {
    title: string;
    mode: "date" | "time" | "datetime";
    min?: string;
    max?: string;
    initial?: string;
    onFinished: (value?: string) => void;
}): JSX.Element {
    const [value, setValue] = useState(props.initial ?? "");
    const ok = !!value && (!props.min || value >= props.min) && (!props.max || value <= props.max);
    return (
        <BaseDialog className="mx_AranDateTime" title={props.title} onFinished={() => props.onFinished()}>
            <input
                className="mx_AranDateTime_input"
                type={INPUT_TYPE[props.mode]}
                value={value}
                min={props.min}
                max={props.max}
                onChange={(e) => setValue(e.target.value.slice(0, 16))}
                autoFocus
            />
            <DialogButtons
                primaryButton="ตกลง"
                primaryDisabled={!ok}
                onPrimaryButtonClick={() => props.onFinished(value)}
                onCancel={() => props.onFinished()}
            />
        </BaseDialog>
    );
}

/** เลือกวันเวลา → ค่าแบบ "2026-11-20" / "18:30" / "2026-11-20T18:30" หรือ undefined เมื่อยกเลิก */
export async function pickDateTime(opts: {
    title: string;
    mode: "date" | "time" | "datetime";
    min?: string;
    max?: string;
    initial?: string;
}): Promise<string | undefined> {
    const { finished } = Modal.createDialog(DateTimeDialog, opts);
    const [value] = await finished;
    return value;
}
