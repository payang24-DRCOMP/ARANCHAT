/*
 * AranChat — อัปเดตแอป Desktop อัตโนมัติ (แทนระบบอัปเดตของ Element ที่ใช้ Squirrel — ตัวติดตั้งเราเป็น NSIS)
 *   อ่าน https://<เว็บแชท>/download/latest.json (สร้างโดย ~/aranchat-ess/scripts/18-publish-apps.sh)
 *   Windows: โหลดตัวติดตั้งรุ่นใหม่เงียบๆ ตรวจ sha256 แล้วถามครั้งเดียว "รีสตาร์ทเพื่ออัปเดต" → ติดตั้งแบบเงียบแล้วเปิดแอปใหม่เอง
 *   Linux (.deb/AppImage): บอกว่ามีรุ่นใหม่ + ปุ่มเปิดหน้าดาวน์โหลด
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { app, dialog, net, shell } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface Feed {
    desktop?: {
        version: string;
        notes?: string;
        win?: { url: string; sha256: string };
    };
    page?: string;
}

const CHECK_EVERY_MS = 6 * 3600_000;

/** "26.11.2" > "26.11.1" > "1.12.33" — เทียบทีละส่วนเป็นตัวเลข */
export function isNewer(remote: string, local: string): boolean {
    const a = remote.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
    const b = local.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
    }
    return false;
}

async function download(url: string, sha256: string): Promise<string> {
    const res = await net.fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = createHash("sha256").update(buf).digest("hex");
    if (got !== sha256.toLowerCase()) throw new Error("sha256 ไม่ตรง — ไม่ติดตั้ง");
    const file = path.join(os.tmpdir(), `AranChat-Setup-${Date.now()}.exe`);
    await fs.promises.writeFile(file, buf);
    return file;
}

let busy = false;
let offered: string | undefined;

async function check(feedUrl: string): Promise<void> {
    if (busy) return;
    busy = true;
    try {
        const res = await net.fetch(`${feedUrl}?t=${Date.now()}`);
        if (!res.ok) return;
        const feed = (await res.json()) as Feed;
        const d = feed.desktop;
        if (!d?.version || !isNewer(d.version, app.getVersion()) || offered === d.version) return;
        offered = d.version;
        const notes = d.notes ? `\n\n${d.notes}` : "";

        if (process.platform === "win32" && d.win?.url && d.win.sha256) {
            const exe = await download(d.win.url, d.win.sha256);
            const { response } = await dialog.showMessageBox({
                type: "info",
                title: "AranChat",
                message: `AranChat รุ่นใหม่ (${d.version}) พร้อมติดตั้งแล้ว`,
                detail: `ใช้เวลาไม่ถึงนาที แอปจะเปิดขึ้นมาใหม่เอง${notes}`,
                buttons: ["อัปเดตเลย", "ไว้ทีหลัง"],
                defaultId: 0,
                cancelId: 1,
            });
            if (response === 0) {
                // /S = ติดตั้งแบบเงียบ · --force-run = เปิดแอปหลังติดตั้งเสร็จ (ตัวติดตั้ง NSIS ของ electron-builder)
                spawn(exe, ["/S", "--force-run"], { detached: true, stdio: "ignore" }).unref();
                app.quit();
            } else {
                offered = undefined; // ถามใหม่รอบหน้า
            }
            return;
        }

        const page = feed.page ?? new URL(".", feedUrl).toString();
        const { response } = await dialog.showMessageBox({
            type: "info",
            title: "AranChat",
            message: `มี AranChat รุ่นใหม่ (${d.version})`,
            detail: `ดาวน์โหลดแล้วติดตั้งทับของเดิมได้เลย${notes}`,
            buttons: ["เปิดหน้าดาวน์โหลด", "ไว้ทีหลัง"],
            defaultId: 0,
            cancelId: 1,
        });
        if (response === 0) void shell.openExternal(page);
    } catch (e) {
        console.warn("AranChat: ตรวจรุ่นใหม่ไม่สำเร็จ", e);
        offered = undefined;
    } finally {
        busy = false;
    }
}

/** เริ่มตรวจรุ่นใหม่ (30 วินาทีหลังเปิดแอป แล้วทุก 6 ชม.) — เฉพาะตัวที่ติดตั้งจริง */
export function startAranChatUpdater(feedUrl: string | undefined): void {
    if (!app.isPackaged || !feedUrl) return;
    setTimeout(() => void check(feedUrl), 30_000);
    setInterval(() => void check(feedUrl), CHECK_EVERY_MS);
}
