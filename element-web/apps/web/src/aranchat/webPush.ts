/*
 * AranChat — แจ้งเตือนเด้งบนเว็บ/iPhone แม้ปิดหน้าแชท (Web Push)
 *
 *   ข้อความใหม่ → Synapse → Sygnal (app "web_push.app_id", type webpush) → Apple/Google push → service worker (sw.js)
 *
 * iPhone/iPad (iOS 16.4+): ต้อง "เพิ่มไปยังหน้าจอโฮม" ก่อน แล้วเปิดจากไอคอน จึงขออนุญาตแจ้งเตือนได้
 *   → Safari ธรรมดาแสดงคำแนะนำวิธีติดตั้ง (showIosInstallHint)
 * เปิดเมื่อผู้ใช้กด "เปิด" ที่แถบแจ้งเตือน (DesktopNotificationsToast) — ขออนุญาตทันทีในจังหวะที่กด (iOS บังคับ)
 * ครั้งต่อไปที่เปิดแอป: ถ้าอนุญาตไว้แล้ว ลงทะเบียนกับ server ซ้ำเงียบๆ (subscription เปลี่ยนได้)
 * ตอนเปิดใช้: ปิดแจ้งเตือนในแท็บของ Element (Notifier) เพื่อไม่ให้เด้งซ้ำ 2 ครั้ง
 * แอป Desktop (Electron) ไม่ใช้ — มีแจ้งเตือนของระบบอยู่แล้ว
 *
 * ข้อมูลคนไข้: ใช้ format "event_id_only" (แบบเดียวกับแอป Android) — server ส่งแค่รหัสห้อง/ข้อความผ่าน Apple/Google
 *   ไม่ส่งเนื้อหา/ชื่อผู้ส่ง · ชื่อห้องที่แสดงบนแจ้งเตือนมาจากรายชื่อห้องที่เก็บไว้ในเครื่องนี้เอง (saveRoomNames)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import { GenericToast } from "@element-hq/web-shared-components";

import { aranChatConfig } from "./config";
import PlatformPeg from "../PlatformPeg";
import ToastStore from "../stores/ToastStore";
import SettingsStore from "../settings/SettingsStore";
import dis from "../dispatcher/dispatcher";
import { Action } from "../dispatcher/actions";

export interface AranChatWebPushConfig {
    /** app id ใน Sygnal เช่น com.arankub.aranchat.web */
    app_id: string;
    /** VAPID public key (base64url, จุด P-256 แบบ uncompressed 65 ไบต์) */
    vapid_public_key: string;
    /** https://matrix.<โดเมน>/_matrix/push/v1/notify */
    gateway: string;
}

const FLAG = "aranchat_webpush"; // "on" = เบราว์เซอร์นี้รับแจ้งเตือนจาก server แล้ว
const KEY = "aranchat_webpush_key"; // pushkey ล่าสุด (ลบ pusher เก่าเมื่อ subscription เปลี่ยน)
const HINT = "aranchat_ios_hint"; // เวลาที่ปิดคำแนะนำติดตั้งบน iPhone

const store = {
    get: (k: string): string | null => {
        try {
            return localStorage.getItem(k);
        } catch {
            return null;
        }
    },
    set: (k: string, v: string | null): void => {
        try {
            if (v === null) localStorage.removeItem(k);
            else localStorage.setItem(k, v);
        } catch {
            /* โหมดส่วนตัว — ข้าม */
        }
    },
};

function cfg(): AranChatWebPushConfig | undefined {
    return (aranChatConfig() as { web_push?: AranChatWebPushConfig } | undefined)?.web_push;
}

const isWebPlatform = (): boolean => PlatformPeg.get()?.getHumanReadableName() === "Web Platform";
export const isIos = (): boolean =>
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = (): boolean =>
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
const pushSupported = (): boolean => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** ใช้ Web Push ได้ในเบราว์เซอร์นี้ (ตั้งค่าไว้ + รองรับ + ไม่ใช่แอป Desktop) */
export function webPushAvailable(): boolean {
    return !!cfg() && isWebPlatform() && pushSupported();
}

/** server ส่งแจ้งเตือนมาที่ service worker แล้ว — Notifier ในแท็บไม่ต้องเด้งซ้ำ */
export function webPushActive(): boolean {
    return store.get(FLAG) === "on" && webPushAvailable();
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
    const b64 = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
    if (!a) return false;
    const x = new Uint8Array(a);
    return x.length === b.length && x.every((v, i) => v === b[i]);
}

function deviceName(): string {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua) || isIos()) return "iPad";
    if (/Android/.test(ua)) return "Android (เว็บ)";
    if (/Edg\//.test(ua)) return "Edge";
    if (/Chrome\//.test(ua)) return "Chrome";
    if (/Firefox\//.test(ua)) return "Firefox";
    if (/Safari\//.test(ua)) return "Safari";
    return "เว็บเบราว์เซอร์";
}

async function removePusher(cli: MatrixClient, appId: string, pushkey: string): Promise<void> {
    // kind: null = ลบ pusher (spec) — type ของ SDK ไม่รับ null จึงต้อง cast
    await cli.setPusher({ kind: null, app_id: appId, pushkey } as unknown as Parameters<MatrixClient["setPusher"]>[0]);
}

/** สมัครรับ push จากเบราว์เซอร์ แล้วบอก server ให้ส่งมาที่นี่ (เรียกซ้ำได้ ไม่เสียหาย) */
async function register(cli: MatrixClient): Promise<void> {
    const c = cfg();
    if (!c || Notification.permission !== "granted") return;
    const appKey = b64urlToBytes(c.vapid_public_key);
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub.options.applicationServerKey, appKey)) {
        await sub.unsubscribe(); // เปลี่ยนกุญแจ VAPID ที่ server → สมัครใหม่
        sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    const j = sub.toJSON();
    const pushkey = j.keys?.p256dh;
    if (!pushkey || !j.keys?.auth || !j.endpoint) throw new Error("subscription ไม่สมบูรณ์");

    const old = store.get(KEY);
    if (old && old !== pushkey) await removePusher(cli, c.app_id, old).catch(() => {});
    await cli.setPusher({
        kind: "http",
        app_id: c.app_id,
        pushkey,
        app_display_name: "AranChat",
        device_display_name: deviceName(),
        profile_tag: "",
        lang: "th",
        // Synapse ส่ง data (ยกเว้น url) ต่อให้ Sygnal — Sygnal ใช้ endpoint/auth เข้ารหัสส่งไปที่เบราว์เซอร์
        data: { url: c.gateway, format: "event_id_only", endpoint: j.endpoint, auth: j.keys.auth, events_only: true },
        append: false,
    } as Parameters<MatrixClient["setPusher"]>[0]);
    store.set(KEY, pushkey);
    store.set(FLAG, "on");
    logger.info("AranChat: ลงทะเบียน Web Push แล้ว", deviceName());
}

async function unregister(cli: MatrixClient): Promise<void> {
    const c = cfg();
    const key = store.get(KEY);
    store.set(FLAG, null);
    if (c && key) await removePusher(cli, c.app_id, key).catch(() => {});
    store.set(KEY, null);
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    await sub?.unsubscribe();
}

/**
 * เรียกจากปุ่ม "เปิด" ของแถบแจ้งเตือน — ต้องเรียก **ทันที** ในจังหวะที่ผู้ใช้กด (ก่อน await ใดๆ)
 * เพราะ iOS ให้ขออนุญาตแจ้งเตือนได้เฉพาะตอนผู้ใช้แตะเท่านั้น
 */
export function enableWebPushFromGesture(cli: MatrixClient): Promise<void> {
    if (!webPushAvailable()) return Promise.resolve();
    const asked = Notification.permission === "default" ? Notification.requestPermission() : Promise.resolve(Notification.permission);
    return asked
        .then((p) => (p === "granted" ? register(cli) : undefined))
        .catch((e) => logger.warn("AranChat: เปิด Web Push ไม่สำเร็จ", e));
}

/** ปิด service worker notification ของห้องที่เปิดดูแล้ว (tag = room id) */
async function clearRoomNotifications(roomId: string): Promise<void> {
    const reg = await navigator.serviceWorker.getRegistration();
    for (const n of (await reg?.getNotifications({ tag: roomId })) ?? []) n.close();
}

function showIosInstallHint(): void {
    const last = Number(store.get(HINT) ?? 0);
    if (Date.now() - last < 7 * 24 * 3600 * 1000) return; // ปิดไว้ไม่เกิน 7 วัน ไม่ถามซ้ำ
    const key = "aranchat_ios_install";
    ToastStore.sharedInstance().addOrReplaceToast({
        key,
        title: "ติดตั้ง AranChat บน iPhone",
        props: {
            description:
                "เพื่อให้แจ้งเตือนเด้งแม้ปิดแอป: แตะปุ่มแชร์ (สี่เหลี่ยมมีลูกศรขึ้น) แล้วเลือก \"เพิ่มไปยังหน้าจอโฮม\" จากนั้นเปิด AranChat จากไอคอนบนหน้าจอ",
            primaryLabel: "เข้าใจแล้ว",
            onPrimaryClick: () => {
                store.set(HINT, String(Date.now()));
                ToastStore.sharedInstance().dismissToast(key);
            },
        },
        component: GenericToast,
        priority: 35,
    });
}

/** แสดงแถบ "เปิดการแจ้งเตือน" ทันที ไม่ต้องรอ 24 ชม. หลังสมัคร (Element รอเพื่อไม่ให้ผู้ใช้ใหม่รำคาญ) */
export function promptWithoutDelay(): boolean {
    return webPushAvailable();
}

/** ชื่อห้องสำหรับหัวข้อแจ้งเตือน — เก็บใน Cache Storage ของเครื่องนี้ (sw.js อ่านได้) ไม่ส่งออกไปไหน */
const ROOM_NAMES = "aranchat-push";
async function saveRoomNames(cli: MatrixClient): Promise<void> {
    if (!("caches" in window)) return;
    const names: Record<string, string> = {};
    for (const r of cli.getRooms()) if (r.name) names[r.roomId] = r.name;
    const cache = await caches.open(ROOM_NAMES);
    await cache.put("rooms.json", new Response(JSON.stringify(names), { headers: { "Content-Type": "application/json" } }));
}

let started = false;

/** เรียกครั้งเดียวหลัง client เริ่มทำงาน (MatrixChat.onClientStarted) */
export function startAranWebPush(cli: MatrixClient): void {
    if (!cfg() || !isWebPlatform()) return;
    if (isIos() && !isStandalone() && !pushSupported()) {
        showIosInstallHint();
        return;
    }
    if (!pushSupported() || started) return;
    started = true;

    if (Notification.permission === "granted" && SettingsStore.getValue("notificationsEnabled") !== false) {
        register(cli).catch((e) => logger.warn("AranChat: ลงทะเบียน Web Push ซ้ำไม่สำเร็จ", e));
    } else if (Notification.permission === "denied") {
        store.set(FLAG, null);
    }

    // ผู้ใช้ปิด/เปิดแจ้งเตือนในหน้าตั้งค่า
    SettingsStore.watchSetting("notificationsEnabled", null, (_n, _r, _l, _nv, value) => {
        if (value === false) unregister(cli).catch(() => {});
        else if (Notification.permission === "granted") register(cli).catch(() => {});
    });

    const saveNames = (): void => void saveRoomNames(cli).catch(() => {});
    saveNames();
    window.setInterval(saveNames, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", () => document.hidden && saveNames());

    dis.register((payload) => {
        if (payload.action === Action.ViewRoom && payload.room_id) void clearRoomNotifications(payload.room_id);
    });

    // ลิงก์จากการแตะแจ้งเตือน (sw.js → postMessage) ตอนแอปเปิดค้างอยู่
    navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
        if (e.data?.type === "aranchat_open_room" && typeof e.data.room_id === "string") {
            dis.dispatch({ action: Action.ViewRoom, room_id: e.data.room_id, metricsTrigger: "Notification" });
        }
    });
}
