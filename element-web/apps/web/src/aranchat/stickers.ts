/*
 * AranChat — สติกเกอร์ (หลายชุด + ใช้ล่าสุด + เคลื่อนไหวได้)
 *
 * ชุดสติกเกอร์มาจาก server: https://<chat>/stickers/index.json (aranchat-ess/scripts/24-stickers.py)
 *   → แอดมินเพิ่มชุดใหม่ได้โดยไม่ต้องออกแอปรุ่นใหม่ · โหลดไม่ได้ = ใช้ชุด "น้องอรัญ" ที่ติดมากับแอป (res/aranchat-stickers)
 * ส่งเป็น m.sticker มาตรฐาน Matrix (แอปทุกตัวแสดงได้) — รูปต้องอยู่บน server (mxc)
 *   → อัปโหลดครั้งแรกที่ผู้ใช้ส่งสติกเกอร์นั้น แล้วจำ mxc ไว้ใน account data "com.arankub.stickers"
 *   { mxc: { "<key>@<ขนาดไฟล์>": mxc }, recent: ["<ชุด>/<id>", …] } — ใช้ร่วมกับ Android (AranStickers.kt)
 *   key ชุดพื้นฐาน = "<id>" (เหมือนรุ่นแรก ใช้แคชเดิมได้) · ชุดอื่น = "<ชุด>/<id>"
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import ContentMessages from "../ContentMessages";
import { aranChatConfig } from "./config";

export interface AranSticker {
    /** "<ชุด>/<id>" — ใช้ใน "ใช้ล่าสุด" */
    ref: string;
    id: string;
    pack: string;
    /** ข้อความบนสติกเกอร์ — ใช้เป็น body (แสดงในแจ้งเตือน/รายการแชท/ค้นหา) */
    body: string;
    url: string;
    w: number;
    h: number;
    size: number;
    mime: string;
    animated: boolean;
}

export interface AranStickerPack {
    id: string;
    name: string;
    icon: string;
    stickers: AranSticker[];
}

interface RawSticker {
    id: string;
    body: string;
    file: string;
    w: number;
    h: number;
    size: number;
    mime?: string;
    animated?: boolean;
}

const BUILTIN_BASE = "aranchat-stickers/";
const BUILTIN_ID = "aran";
const CACHE_TYPE = "com.arankub.stickers";
const RECENT_MAX = 16;
/** ขนาดที่แสดงในแชท (ไฟล์จริง 2 เท่า เพื่อให้คมบนจอความละเอียดสูง) */
const SHOW_PX = 160;

const mimeOf = (file: string): string =>
    file.endsWith(".webp") ? "image/webp" : file.endsWith(".gif") ? "image/gif" : "image/png";

function toSticker(pack: string, base: string, s: RawSticker): AranSticker {
    return {
        ref: `${pack}/${s.id}`,
        id: s.id,
        pack,
        body: s.body,
        url: new URL(s.file, base).toString(),
        w: s.w,
        h: s.h,
        size: s.size,
        mime: s.mime ?? mimeOf(s.file),
        animated: !!s.animated,
    };
}

/** ที่อยู่ชุดสติกเกอร์บน server — Desktop ต้องเป็น URL เต็ม (config aranchat.stickers_url) */
function serverIndexUrl(): string {
    const configured = aranChatConfig()?.stickers_url;
    return new URL(configured ?? "/stickers/index.json", window.location.href).toString();
}

async function loadServerPacks(): Promise<AranStickerPack[]> {
    const url = serverIndexUrl();
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`stickers ${r.status}`);
    const data = (await r.json()) as { packs?: { id: string; name: string; icon: string; stickers: RawSticker[] }[] };
    const packs = (data.packs ?? [])
        .filter((p) => /^[a-z0-9_-]{1,32}$/.test(p.id) && Array.isArray(p.stickers) && p.stickers.length)
        .map((p) => ({
            id: p.id,
            name: p.name,
            icon: new URL(p.icon, url).toString(),
            stickers: p.stickers.map((s) => toSticker(p.id, url, s)),
        }));
    if (!packs.length) throw new Error("stickers: ว่าง");
    return packs;
}

async function loadBuiltinPack(): Promise<AranStickerPack[]> {
    const base = new URL(BUILTIN_BASE, window.location.href).toString();
    const r = await fetch(base + "pack.json");
    if (!r.ok) throw new Error(`pack.json ${r.status}`);
    const p = (await r.json()) as { name: string; stickers: RawSticker[] };
    const stickers = p.stickers.map((s) => toSticker(BUILTIN_ID, base, s));
    return [{ id: BUILTIN_ID, name: p.name, icon: stickers[0]?.url ?? "", stickers }];
}

let packsPromise: Promise<AranStickerPack[]> | undefined;

/** ชุดสติกเกอร์ทั้งหมด (โหลดครั้งเดียวต่อการเปิดแอป) */
export function loadStickerPacks(): Promise<AranStickerPack[]> {
    packsPromise ??= loadServerPacks()
        .catch(() => loadBuiltinPack())
        .catch((e) => {
            packsPromise = undefined; // ลองใหม่ครั้งหน้า
            throw e;
        });
    return packsPromise;
}

function cacheKey(s: AranSticker): string {
    return `${s.pack === BUILTIN_ID ? s.id : s.ref}@${s.size}`;
}

function accountData(cli: MatrixClient): { mxc: Record<string, string>; recent: string[] } {
    const c = cli.getAccountData(CACHE_TYPE)?.getContent() ?? {};
    return {
        mxc: c.mxc && typeof c.mxc === "object" ? c.mxc : {},
        recent: Array.isArray(c.recent) ? c.recent.filter((x: unknown) => typeof x === "string") : [],
    };
}

/** สติกเกอร์ที่ใช้ล่าสุด (ใช้ร่วมกันทุกเครื่องของผู้ใช้) */
export function recentStickers(cli: MatrixClient, packs: AranStickerPack[]): AranSticker[] {
    const all = new Map(packs.flatMap((p) => p.stickers.map((s) => [s.ref, s] as const)));
    return accountData(cli)
        .recent.map((r) => all.get(r))
        .filter((s): s is AranSticker => !!s);
}

async function mxcFor(cli: MatrixClient, s: AranSticker): Promise<string> {
    const key = cacheKey(s);
    const cached = accountData(cli).mxc[key];
    if (cached) return cached;
    const blob = await (await fetch(s.url)).blob();
    const { content_uri: mxc } = await cli.uploadContent(blob, { type: s.mime, name: s.url.split("/").pop(), includeFilename: false });
    // อ่านซ้ำก่อนเขียน — อีกเครื่องอาจเพิ่มสติกเกอร์อื่นไว้ระหว่างอัปโหลด
    const latest = accountData(cli);
    await cli.setAccountData(CACHE_TYPE, { ...latest, mxc: { ...latest.mxc, [key]: mxc } });
    return mxc;
}

async function remember(cli: MatrixClient, s: AranSticker): Promise<void> {
    const latest = accountData(cli);
    const recent = [s.ref, ...latest.recent.filter((r) => r !== s.ref)].slice(0, RECENT_MAX);
    if (recent.join() === latest.recent.join()) return;
    await cli.setAccountData(CACHE_TYPE, { ...latest, recent });
}

/** ส่งสติกเกอร์เข้าห้อง (อัปโหลดรูปให้ถ้ายังไม่เคย) */
export async function sendAranSticker(
    cli: MatrixClient,
    roomId: string,
    threadId: string | null,
    s: AranSticker,
): Promise<void> {
    const mxc = await mxcFor(cli, s);
    await ContentMessages.sharedInstance().sendStickerContentToRoom(
        mxc,
        roomId,
        threadId,
        {
            w: SHOW_PX,
            h: Math.round((SHOW_PX * s.h) / s.w),
            mimetype: s.mime,
            size: s.size,
            // แอปที่รองรับจะเล่นภาพเคลื่อนไหวเลย (MSC4230)
            ...(s.animated ? { "org.matrix.msc4230.is_animated": true } : {}),
        },
        s.body,
        cli,
    );
    remember(cli, s).catch(() => {});
}
