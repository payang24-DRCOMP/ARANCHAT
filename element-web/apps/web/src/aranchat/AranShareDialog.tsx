/*
 * AranChat — หน้าต่าง "ชวนเพื่อน" / "แชร์กลุ่ม": QR + ลิงก์ + คัดลอก + LINE + แชร์ของเครื่อง + จำนวนที่ชวนสำเร็จ
 * ลิงก์ = https://<chat>/i/<รหัส> (src/aranchat/invites.ts)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React, { type JSX, useEffect, useState } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import BaseDialog from "../components/views/dialogs/BaseDialog";
import QRCode from "../components/views/elements/QRCode";
import { MatrixClientPeg } from "../MatrixClientPeg";
import { type AranInvite, createInvite, prepareGroupForLink } from "./invites";

interface Props {
    /** ไม่ใส่ = ชวนคุยกับฉัน */
    room?: Room;
    onFinished: () => void;
}

/** หน้าต่างแชร์ลิงก์ชวน */
export function AranShareDialog({ room, onFinished }: Props): JSX.Element {
    return (
        <BaseDialog
            className="mx_AranShareDialog"
            title={room ? `แชร์กลุ่ม "${room.name}"` : "ชวนเพื่อนมาคุยกัน"}
            onFinished={onFinished}
            fixedWidth={false}
        >
            <AranSharePanel room={room} />
        </BaseDialog>
    );
}

/** QR + ลิงก์ + ปุ่มแชร์ — ใช้ในหน้าต่างชวนเพื่อน/แชร์กลุ่ม และหน้าโปรไฟล์ ("QR โค้ดของฉัน") */
export function AranSharePanel({ room }: { room?: Room }): JSX.Element {
    const [invite, setInvite] = useState<AranInvite | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const cli = MatrixClientPeg.safeGet();
        (async (): Promise<void> => {
            if (room) {
                const r = await prepareGroupForLink(cli, room);
                if (r === "no-permission") {
                    setError("เฉพาะผู้ดูแลกลุ่มที่สร้างลิงก์เชิญได้ — ขอให้ผู้ดูแลกลุ่มแชร์ให้ หรือกด \"เชิญ\" เพื่อน เข้ากลุ่มโดยตรง");
                    return;
                }
                if (r === "changed") setNotice("เปิดให้คนขอเข้าร่วมผ่านลิงก์แล้ว — ผู้ดูแลกลุ่มต้องอนุมัติทุกคนก่อนเข้า");
            }
            setInvite(await createInvite(cli, room?.roomId));
        })().catch((e) => setError(`สร้างลิงก์ไม่สำเร็จ (${e.message}) — ลองใหม่อีกครั้ง`));
    }, [room]);

    const me = MatrixClientPeg.safeGet().getUser(MatrixClientPeg.safeGet().getSafeUserId())?.displayName;
    const text = room
        ? `เข้ากลุ่ม "${room.name}" บน AranChat กันนะ 👉 ${invite?.url ?? ""}`
        : `มาคุยกับ${me ? ` ${me}` : "ฉัน"} บน AranChat แอปแชทของบุคลากร 👉 ${invite?.url ?? ""}`;

    const copy = async (): Promise<void> => {
        if (!invite) return;
        try {
            await navigator.clipboard.writeText(invite.url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch {
            window.prompt("คัดลอกลิงก์นี้", invite.url); // เบราว์เซอร์ไม่ให้เขียน clipboard
        }
    };
    const nativeShare = (): void => {
        void navigator.share?.({ title: "AranChat", text, url: invite?.url }).catch(() => {});
    };

    return (
        <div className="mx_AranSharePanel">
            {error ? (
                <p className="mx_AranShareDialog_error">{error}</p>
            ) : (
                <div className="mx_AranShareDialog_body">
                    <p className="mx_AranShareDialog_lead">
                        {room
                            ? "ส่งลิงก์หรือให้สแกน QR — เพื่อนกด \"ขอเข้าร่วม\" แล้วผู้ดูแลกลุ่มอนุมัติ"
                            : "ส่งลิงก์หรือให้สแกน QR — เพื่อนเปิดแล้วเริ่มแชทกับคุณได้ทันที"}
                    </p>
                    {notice && <p className="mx_AranShareDialog_notice">{notice}</p>}
                    <div className="mx_AranShareDialog_qr">
                        <QRCode data={invite?.url ?? null} width={220} />
                    </div>
                    <div className="mx_AranShareDialog_link">{invite?.url ?? "กำลังสร้างลิงก์…"}</div>
                    <div className="mx_AranShareDialog_buttons">
                        <button type="button" className="mx_AranShareDialog_btn" disabled={!invite} onClick={copy}>
                            {copied ? "คัดลอกแล้ว ✓" : "คัดลอกลิงก์"}
                        </button>
                        <a
                            className="mx_AranShareDialog_btn mx_AranShareDialog_line"
                            href={invite ? `https://line.me/R/share?text=${encodeURIComponent(text)}` : undefined}
                            target="_blank"
                            rel="noreferrer noopener"
                            aria-disabled={!invite}
                        >
                            ส่งทาง LINE
                        </a>
                        {"share" in navigator && (
                            <button type="button" className="mx_AranShareDialog_btn" disabled={!invite} onClick={nativeShare}>
                                แชร์…
                            </button>
                        )}
                    </div>
                    {invite && invite.joined > 0 && (
                        <p className="mx_AranShareDialog_stats">🎉 มีคนเข้ามาผ่านลิงก์ของคุณแล้ว {invite.joined} คน</p>
                    )}
                </div>
            )}
        </div>
    );
}
