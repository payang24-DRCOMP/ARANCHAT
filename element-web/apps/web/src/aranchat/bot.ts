/*
 * AranChat — บอทแจ้งเตือน: คำสั่ง / · เมนูใต้ช่องพิมพ์ · ปุ่มตอบด่วน · มินิแอป (~/aranchat-ess/notify/server.mjs)
 *   รายการคำสั่ง/เมนู: GET <chat>/api/notify/bot (สาธารณะ ไม่มีข้อมูลส่วนบุคคล) — ระบบต่างๆ ลงทะเบียนเองด้วย key ของระบบ
 *   ใช้เฉพาะห้องที่บอทอยู่ (แชทกับ "ARANKUB AI" / ห้องแจ้งเตือน) — ห้องเหล่านี้ไม่เข้ารหัส บอทจึงอ่านคำสั่งได้
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { type MatrixClient, type Room, KnownMembership } from "matrix-js-sdk/src/matrix";

import { aranChatConfig } from "./config";
import dis from "../dispatcher/dispatcher";
import { Action } from "../dispatcher/actions";
import { TimelineRenderingType } from "../contexts/RoomContext";

export interface BotCommand {
    command: string;
    description: string;
    usage?: string;
    system?: string;
}
export interface BotMenuItem {
    label: string;
    type: "text" | "link" | "app";
    text?: string;
    url?: string;
    /** ใส่ข้อความลงช่องพิมพ์ให้พิมพ์ต่อ แทนการส่งทันที */
    prefill?: boolean;
}
export interface BotInfo {
    commands: BotCommand[];
    menu: BotMenuItem[];
}
export interface QuickReply {
    label: string;
    text: string;
    prefill?: boolean;
}

export const QUICK_REPLIES_KEY = "com.arankub.quick_replies";

function botApiUrl(): string {
    const c = aranChatConfig();
    const base = c?.bot_api ?? (c?.invite_api ? `${c.invite_api.replace(/\/+$/, "")}/bot` : "/api/notify/bot");
    return new URL(base, window.location.href).toString();
}

let cache: BotInfo | null = null;
let loadedAt = 0;
let loading: Promise<BotInfo> | null = null;
const listeners = new Set<() => void>();

/** รายการคำสั่ง/เมนู (แคช 60 วินาที) */
export function loadBotInfo(): Promise<BotInfo> {
    if (cache && Date.now() - loadedAt < 60_000) return Promise.resolve(cache);
    loading ??= fetch(botApiUrl(), { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`bot ${r.status}`))))
        .then((d: Partial<BotInfo>) => {
            cache = {
                commands: Array.isArray(d.commands) ? d.commands.filter((c) => /^[a-z][a-z0-9_]{0,31}$/.test(c?.command)) : [],
                menu: Array.isArray(d.menu) ? d.menu.filter((m) => m?.label) : [],
            };
            loadedAt = Date.now();
            listeners.forEach((l) => l());
            return cache;
        })
        .finally(() => {
            loading = null;
        });
    return loading;
}

export function cachedBotInfo(): BotInfo | null {
    return cache;
}

export function onBotInfo(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
}

/** ห้องที่บอทแจ้งเตือนอยู่ (คำสั่ง / เมนูใช้ได้) */
export function isBotRoom(room: Room | null | undefined): boolean {
    const bot = aranChatConfig()?.bot_user;
    return !!bot && !!room && room.getMember(bot)?.membership === KnownMembership.Join;
}

/** แชทส่วนตัวกับบอท (สมาชิก 2 คน: ผู้ใช้ + บอท) — แถบเมนู/ปุ่มตอบด่วนแสดงเฉพาะห้องนี้
 *  ห้องแจ้งเตือนแบบกลุ่มมีแค่รายงาน · คำสั่งที่พิมพ์ในห้องกลุ่ม บอทลบออกแล้วตอบในแชทส่วนตัว */
export function isBotDm(room: Room | null | undefined): boolean {
    return isBotRoom(room) && room!.getJoinedMemberCount() <= 2;
}

/** "/lab 0012345" เป็นคำสั่งของบอทไหม (ห้องบอทเท่านั้น) — ใช่ = ส่งเป็นข้อความธรรมดาให้บอท ไม่ใช่คำสั่งของแอป */
export function isBotCommandText(room: Room | null | undefined, text: string): boolean {
    if (!isBotRoom(room)) return false;
    const m = text.trim().match(/^\/([a-zA-Z][a-zA-Z0-9_]*)/);
    if (!m) return false;
    const info = cachedBotInfo();
    // ยังโหลดรายการไม่เสร็จ: คำสั่งพื้นฐานของบอทส่งได้เสมอ
    const names = new Set(info?.commands.map((c) => c.command) ?? ["help", "settings"]);
    return names.has(m[1].toLowerCase());
}

/** ส่งข้อความหาบอท (เมนู / ปุ่มตอบด่วน) หรือใส่ลงช่องพิมพ์ */
export function sendOrPrefill(cli: MatrixClient, roomId: string, item: { text?: string; prefill?: boolean }): void {
    const text = item.text ?? "";
    if (!text.trim()) return;
    if (item.prefill) {
        dis.dispatch({ action: Action.ComposerInsert, text, timelineRenderingType: TimelineRenderingType.Room });
        return;
    }
    void cli.sendTextMessage(roomId, text.trim());
}

/** ปุ่มตอบด่วนของข้อความล่าสุดในห้อง (ถ้าข้อความล่าสุดมาจากบอท) */
export function latestQuickReplies(room: Room): { eventId: string; items: QuickReply[] } | null {
    const bot = aranChatConfig()?.bot_user;
    const events = room.getLiveTimeline().getEvents();
    for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        // ข้ามเหตุการณ์ที่ไม่แสดงในแชท (reaction, การแก้ไข, ใบตอบรับ)
        if (ev.getType() !== "m.room.message" && ev.getType() !== "m.sticker") continue;
        if (ev.isRelation("m.replace")) continue;
        if (ev.getSender() !== bot) return null;
        const raw = ev.getContent()[QUICK_REPLIES_KEY];
        if (!Array.isArray(raw)) return null;
        const items = raw
            .slice(0, 6)
            .filter((q): q is QuickReply => typeof q?.label === "string" && typeof q?.text === "string" && !!q.text.trim())
            .map((q) => ({ label: q.label.slice(0, 24), text: q.text.slice(0, 200), prefill: q.prefill === true }));
        return items.length ? { eventId: ev.getId()!, items } : null;
    }
    return null;
}

/**
 * ที่อยู่มินิแอป + OpenID token ของผู้ใช้ใน fragment (#aranchat_openid=…&aranchat_server=…)
 * fragment ไม่ถูกส่งไปกับคำขอ HTTP / ไม่อยู่ใน log ของ server · หน้าเว็บส่ง token ให้ระบบหลังบ้านถาม notify ว่าใครเปิด
 */
export async function miniAppUrl(cli: MatrixClient, url: string): Promise<string> {
    const u = new URL(url);
    if (u.protocol !== "https:") throw new Error("มินิแอปต้องเป็น https://");
    const token = await cli.getOpenIdToken();
    const extra = new URLSearchParams({ aranchat_openid: token.access_token, aranchat_server: token.matrix_server_name });
    u.hash = u.hash ? `${u.hash.slice(1)}&${extra}` : extra.toString();
    return u.toString();
}
