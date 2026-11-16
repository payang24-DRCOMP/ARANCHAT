/*
 * AranChat — แถบเมนูหลัก (แชท / แจ้งเตือน / ข่าวสาร / ระบบงาน / โปรไฟล์) แทนรายการ Space ของ Element
 * จอกว้าง: แถบซ้าย · จอแคบ: แถบล่าง (res/css/aranchat/_AranChat.pcss)
 * ค่าตั้งจาก config.json คีย์ "aranchat": { bot_user, news_room, apps: [{name, desc, url, icon, color, external}] }
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React, { type JSX, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ClientEvent, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

import { useMatrixClientContext } from "../contexts/MatrixClientContext";
import { SDKContext } from "../contexts/SDKContext";
import { useEventEmitter, useEventEmitterState } from "../hooks/useEventEmitter";
import { UPDATE_EVENT } from "../stores/AsyncStore";
import defaultDispatcher from "../dispatcher/dispatcher";
import { Action } from "../dispatcher/actions";
import SdkConfig from "../SdkConfig";
import PlatformPeg from "../PlatformPeg";
import { OwnProfileStore } from "../stores/OwnProfileStore";
import BaseAvatar from "../components/views/avatars/BaseAvatar";
import { aranChatSection, useAranChatSection } from "./section";

export { aranChatConfig, type AranChatApp, type AranChatConfig } from "./config";
import { unseenNewFriends } from "./newFriends";
import { aranChatConfig, type AranChatApp } from "./config";

const ICONS: Record<string, JSX.Element> = {
    chat: <path d="M12 3C6.9 3 3 6.6 3 11c0 2.4 1.2 4.6 3.1 6.1L5.5 21l4-2.1c.8.2 1.6.3 2.5.3 5.1 0 9-3.6 9-8.1S17.1 3 12 3z" />,
    friends: <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-7 1.7-7 4.5V20h14v-2.5C16 14.7 12.3 13 9 13zm7.5-2.2a3.3 3.3 0 1 0 0-6.6 4.8 4.8 0 0 1 0 6.6zM18 13.3c1.5.9 2.5 2.3 2.5 4.2V20H22v-2.5c0-2-2-3.6-4-4.2z" />,
    news: <path d="M4 5h13v14H6a2 2 0 0 1-2-2zm13 4h3v8a2 2 0 0 1-2 2h-1M7 8h7M7 11h7M7 14h4" />,
    apps: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
    me: <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.4 0-8 2.5-8 5.5V22h16v-2.5c0-3-3.6-5.5-8-5.5z" />,
};

/** ห้องข่าวสาร — จาก alias ในห้องที่ผู้ใช้อยู่แล้ว */
function findNewsRoom(cli: MatrixClient, alias?: string): Room | null {
    if (!alias) return null;
    return (
        cli
            .getRooms()
            .find(
                (r) =>
                    r.getMyMembership() === KnownMembership.Join &&
                    (r.getCanonicalAlias() === alias || r.getAltAliases().includes(alias)),
            ) ?? null
    );
}

const unread = (r: Room | null): number => (r ? r.getUnreadNotificationCount() || 0 : 0);
const isDesktop = (): boolean => !!PlatformPeg.get()?.getHumanReadableName().includes("Electron");

type Section = "chat" | "friends" | "news" | "apps" | "me";

export function AranChatRail(): JSX.Element {
    const cli = useMatrixClientContext();
    const sdk = useContext(SDKContext);
    const cfg = aranChatConfig() ?? {};
    const [, setTick] = useState(0);
    const [appsOpen, setAppsOpen] = useState(false);
    const [view, setView] = useState<AranChatApp | null>(null);
    const activeRoomId = useEventEmitterState(sdk.roomViewStore, UPDATE_EVENT, () => sdk.roomViewStore.getRoomId());
    const section = useAranChatSection();
    // รูปประจำตัว (ปุ่มโปรไฟล์) — เปลี่ยนรูป/ชื่อแล้วอัปเดตทันที
    const avatar = useEventEmitterState(OwnProfileStore.instance, UPDATE_EVENT, () => OwnProfileStore.instance.getHttpAvatarUrl(48));
    const myName = useEventEmitterState(OwnProfileStore.instance, UPDATE_EVENT, () => OwnProfileStore.instance.displayName);

    // จำนวนที่ยังไม่อ่าน / ห้องที่เพิ่งเข้า — คำนวณใหม่ทุกรอบ sync
    useEventEmitter(cli, ClientEvent.Sync, () => setTick((t) => t + 1));
    useEffect(() => {
        const ref = defaultDispatcher.register((p) => {
            // กดลิงก์ในแชท/แจ้งเตือน หรือกลับหน้าแรก → ปิดโปรแกรมที่เปิดซ้อนอยู่
            if (p.action === Action.ViewRoom || p.action === Action.ViewHomePage) setView(null);
        });
        return () => defaultDispatcher.unregister(ref);
    }, []);

    const news = findNewsRoom(cli, cfg.news_room);
    const active: Section =
        appsOpen || view
            ? "apps"
            : section === "friends"
              ? "friends"
              : activeRoomId && activeRoomId === news?.roomId
                ? "news"
                : "chat";

    const viewRoom = (room: Room | null): void => {
        aranChatSection.set("chat");
        if (room) defaultDispatcher.dispatch({ action: Action.ViewRoom, room_id: room.roomId, metricsTrigger: undefined });
    };

    const openApp = useCallback((app: AranChatApp) => {
        setAppsOpen(false);
        // แอป Desktop เก็บคุกกี้แยกจากเบราว์เซอร์ → เปิดในเบราว์เซอร์ (ล็อกอิน AranKub ค้างไว้แล้ว) ไม่ติดหน้า login
        if (app.external || isDesktop()) {
            window.open(app.url, "_blank", "noopener");
            return;
        }
        setView(app);
    }, []);

    const items: { id: Section; label: string; badge?: number; hidden?: boolean; onClick: () => void }[] = [
        // แชท: รายการแชท (ห้องแจ้งเตือนของบอทอยู่ในรายการนี้แล้ว) · เพื่อน: รายชื่อเพื่อน + กลุ่มทั้งหมด
        { id: "chat", label: "แชท", onClick: () => { setView(null); aranChatSection.set("chat"); } },
        // จุดแดง = เจ้าหน้าที่เข้าระบบใหม่ที่ยังไม่ได้เปิดดู (newFriends.ts)
        { id: "friends", label: "เพื่อน", badge: active === "friends" ? 0 : unseenNewFriends(cli), onClick: () => { setView(null); aranChatSection.set("friends"); } },
        { id: "news", label: "ข่าวสาร", badge: unread(news), hidden: !news, onClick: () => viewRoom(news) },
        { id: "apps", label: "ระบบงาน", hidden: !cfg.apps?.length, onClick: () => setAppsOpen((o) => !o) },
        { id: "me", label: "โปรไฟล์", onClick: () => defaultDispatcher.dispatch({ action: Action.ViewUserSettings }) },
    ];

    return (
        <div className="mx_AranChatRail">
            <button
                type="button"
                className="mx_AranChatRail_logo"
                title={SdkConfig.get().brand}
                onClick={() => defaultDispatcher.dispatch({ action: Action.ViewHomePage })}
            >
                {cfg.logo && <img src={cfg.logo} alt={SdkConfig.get().brand} />}
            </button>
            {items
                .filter((i) => !i.hidden)
                .map((i) => (
                    <button
                        key={i.id}
                        type="button"
                        className={"mx_AranChatRail_item" + (active === i.id ? " mx_AranChatRail_item_active" : "")}
                        aria-current={active === i.id ? "page" : undefined}
                        onClick={i.onClick}
                    >
                        <span className="mx_AranChatRail_icon">
                            {i.id === "me" ? (
                                <BaseAvatar name={myName ?? ""} idName={cli.getUserId() ?? ""} url={avatar} size="24px" />
                            ) : (
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    {ICONS[i.id]}
                                </svg>
                            )}
                            {!!i.badge && <b className="mx_AranChatRail_badge">{i.badge > 99 ? "99+" : i.badge}</b>}
                        </span>
                        <span>{i.label}</span>
                    </button>
                ))}
            {appsOpen && <AppsPanel apps={cfg.apps ?? []} onOpen={openApp} onClose={() => setAppsOpen(false)} />}
            {view && <AppView app={view} onClose={() => setView(null)} />}
        </div>
    );
}

function AppsPanel({
    apps,
    onOpen,
    onClose,
}: {
    apps: AranChatApp[];
    onOpen: (a: AranChatApp) => void;
    onClose: () => void;
}): JSX.Element {
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Escape") onClose();
        };
        const onDown = (e: MouseEvent): void => {
            const t = e.target as HTMLElement;
            if (!t.closest(".mx_AranChatApps") && !t.closest(".mx_AranChatRail_item")) onClose();
        };
        document.addEventListener("keydown", onKey, true);
        document.addEventListener("mousedown", onDown, true);
        return () => {
            document.removeEventListener("keydown", onKey, true);
            document.removeEventListener("mousedown", onDown, true);
        };
    }, [onClose]);
    return createPortal(
        <div className="mx_AranChatApps" role="dialog" aria-label="ระบบงาน">
            <div className="mx_AranChatApps_head">
                <b>ระบบงาน</b>
                <span>โปรแกรมของหน่วยงาน{isDesktop() ? " · เปิดในเบราว์เซอร์" : ""}</span>
            </div>
            <div className="mx_AranChatApps_grid">
                {apps.map((a) => (
                    <a
                        key={a.url}
                        className="mx_AranChatApps_app"
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                            e.preventDefault();
                            onOpen(a);
                        }}
                    >
                        <span className="mx_AranChatApps_icon" style={{ background: a.color ?? "#5B3FD9" }}>
                            {a.icon ?? "•"}
                        </span>
                        <span className="mx_AranChatApps_text">
                            <b>{a.name}</b>
                            {a.desc && <small>{a.desc}</small>}
                        </span>
                    </a>
                ))}
            </div>
        </div>,
        document.body,
    );
}

/** เปิดโปรแกรมซ้อนในหน้าแชท — เว็บแชทอยู่โดเมนเดียวกับ AranKub จึงใช้ session ที่ล็อกอินไว้ ไม่ต้องล็อกอินซ้ำ */
function AppView({ app, onClose }: { app: AranChatApp; onClose: () => void }): JSX.Element {
    return createPortal(
        <div className="mx_AranChatView">
            <div className="mx_AranChatView_bar">
                <span className="mx_AranChatApps_icon" style={{ background: app.color ?? "#5B3FD9" }}>
                    {app.icon ?? "•"}
                </span>
                <b>{app.name}</b>
                <a className="mx_AranChatView_btn" href={app.url} target="_blank" rel="noopener noreferrer" onClick={onClose}>
                    เปิดในแท็บใหม่ ↗
                </a>
                <button type="button" className="mx_AranChatView_btn mx_AranChatView_close" aria-label="กลับไปแชท" onClick={onClose}>
                    ✕
                </button>
            </div>
            <iframe src={app.url} title={app.name} allow="clipboard-write; fullscreen" />
        </div>,
        document.body,
    );
}
