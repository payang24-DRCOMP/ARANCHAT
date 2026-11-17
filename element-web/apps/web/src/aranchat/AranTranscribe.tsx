/*
 * AranChat — ปุ่ม "ถอดเป็นข้อความ" ใต้ข้อความเสียง/ไฟล์เสียง (ทุกห้อง รวมห้องเข้ารหัส)
 *   แอปถอดรหัสเสียงในเครื่องผู้ใช้ (MediaEventHelper) → ส่งไปถอดที่เครื่องของ รพ. (notify POST /api/notify/asr + OpenID token)
 *   ไม่เก็บไฟล์/ข้อความบนเซิร์ฟเวอร์ · ผลแสดงเฉพาะเครื่องนี้ (ไม่ส่งเข้าแชท) · notify/asr.mjs
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React, { type JSX, useState } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { MatrixClientPeg } from "../MatrixClientPeg";
import { MediaEventHelper } from "../utils/MediaEventHelper";
import { aranChatConfig } from "./config";

function asrUrl(): string {
    const base = aranChatConfig()?.invite_api ?? "/api/notify";
    return new URL(`${base.replace(/\/+$/, "")}/asr`, window.location.href).toString();
}

type State = { kind: "idle" } | { kind: "busy" } | { kind: "done"; text: string } | { kind: "error"; message: string };

/** ปุ่ม + ผลถอดเสียงของข้อความเสียง 1 ข้อความ */
export function AranTranscribe({ mxEvent }: { mxEvent: MatrixEvent }): JSX.Element | null {
    const [state, setState] = useState<State>({ kind: "idle" });
    if (!aranChatConfig()) return null;

    const run = async (): Promise<void> => {
        setState({ kind: "busy" });
        const helper = new MediaEventHelper(mxEvent);
        try {
            const blob = await helper.sourceBlob.value;
            if (blob.size > 25 * 1024 * 1024) throw new Error("ไฟล์ใหญ่เกิน 25 MB — ส่งไฟล์ให้ \"AranChat แจ้งเตือน\" แทน");
            const token = await MatrixClientPeg.safeGet().getOpenIdToken();
            const r = await fetch(asrUrl(), {
                method: "POST",
                headers: { "Content-Type": blob.type || "application/octet-stream", "X-AranChat-OpenID": token.access_token },
                body: blob,
            });
            const data = (await r.json().catch(() => ({}))) as { text?: string; error?: string };
            if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
            setState({ kind: "done", text: data.text?.trim() || "(ไม่พบเสียงพูด)" });
        } catch (e) {
            setState({ kind: "error", message: (e as Error).message });
        } finally {
            helper.destroy();
        }
    };

    if (state.kind === "done") {
        return (
            <div className="mx_AranTranscribe mx_AranTranscribe_result">
                <span className="mx_AranTranscribe_label">🎙 ข้อความจากเสียง</span>
                <p>{state.text}</p>
                <small>ถอดอัตโนมัติ อาจมีคำผิด · เห็นเฉพาะคุณ</small>
            </div>
        );
    }
    return (
        <div className="mx_AranTranscribe">
            <button type="button" disabled={state.kind === "busy"} onClick={() => void run()}>
                {state.kind === "busy" ? "กำลังถอดเสียง…" : "🎙 ถอดเป็นข้อความ"}
            </button>
            {state.kind === "error" && <span className="mx_AranTranscribe_error">{state.message}</span>}
        </div>
    );
}
