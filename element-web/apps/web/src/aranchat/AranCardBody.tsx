/*
 * AranChat — การ์ดแจ้งเตือนแบบ LINE (Flex Message)
 *   ระบบแจ้งเตือน (~/aranchat-ess/notify) ส่ง m.text ที่มี content["com.arankub.card"] มาด้วย
 *   แอปอื่น/แอปมือถือที่ยังไม่รู้จักฟิลด์นี้ เห็น body / formatted_body ตามปกติ
 *
 * รุ่น 2 (notify/cardkit.mjs): ระดับสี (level) · บรรทัดรอง · รูปใหญ่ · ช่องข้อมูลมีโทนสี (ค่าวิกฤต/สูง/ต่ำ/ปกติ)
 *   · ส่วนเนื้อหา: ข้อความ / ช่องข้อมูล / ขั้นตอน / ตาราง / ตัวเลขสรุป · ปุ่ม: เปิดลิงก์ / คัดลอก / สั่งงาน
 *   · ผลการตัดสิน (status) — บอทแก้การ์ดเดิมเมื่อมีคนกดปุ่มสั่งงาน แล้วซ่อนปุ่ม (closed)
 * ปุ่ม "รับทราบ" = ส่ง reaction "✅ รับทราบ" ที่ข้อความนั้น (คนในห้องเห็นว่าใครรับทราบแล้ว บอทอ่านย้อนหลังได้)
 * ปุ่มสั่งงาน = ส่งข้อความตอบกลับการ์ด (ทุกคนเห็นว่าใครกดอะไร) + content["com.arankub.card_action"] → notify เรียก webhook ระบบต้นทาง
 * ปุ่มรับทราบ/สั่งงานกดได้เฉพาะการ์ดจากบอท (@aranchat:…) — การ์ดที่ผู้ใช้ส่งต่อไปห้องอื่นแสดงอย่างเดียว
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React, { type JSX, useEffect, useReducer, useState } from "react";
import { EventType, MsgType, RelationType, type Relations, RelationsEvent } from "matrix-js-sdk/src/matrix";
import { type RoomMessageEventContent } from "matrix-js-sdk/src/types";

import { useMatrixClientContext } from "../contexts/MatrixClientContext";
import { type IBodyProps } from "../components/views/messages/IBodyProps";
import Modal from "../Modal";
import ForwardDialog from "../components/views/dialogs/ForwardDialog";
import QuestionDialog from "../components/views/dialogs/QuestionDialog";
import { mediaFromMxc } from "../customisations/Media";
import { openMiniApp, pickDateTime } from "./AranBot";
import CopyIcon from "@vector-im/compound-design-tokens/assets/web/icons/copy";

export const ARANCHAT_CARD_KEY = "com.arankub.card";
export const ARANCHAT_CARD_ACTION_KEY = "com.arankub.card_action";
export const ARANCHAT_ACK_KEY = "✅ รับทราบ";

export type AranTone = "crit" | "high" | "low" | "ok" | "muted";
export type AranLevel = "info" | "success" | "warning" | "critical";
/** [ชื่อช่อง, ค่า, โทนสี?] */
export type AranField = [string, string, AranTone?];

export type AranSection =
    | { type: "text"; text: string }
    | { type: "fields"; title?: string; items: AranField[] }
    | { type: "steps"; title?: string; items: { label: string; time?: string; state: "done" | "current" | "todo" }[] }
    | { type: "table"; title?: string; columns: string[]; rows: string[][]; tones?: string[][] }
    | { type: "stats"; title?: string; items: { label: string; value: string; tone?: AranTone }[] };

export type AranButton =
    | { type: "link"; label: string; url: string; style?: string }
    | { type: "copy"; label: string; text: string; style?: string }
    | { type: "action"; label: string; id: string; style?: string; confirm?: string }
    | {
          type: "datetime";
          label: string;
          id: string;
          style?: string;
          mode: "date" | "time" | "datetime";
          min?: string;
          max?: string;
          initial?: string;
      }
    | { type: "app"; label: string; url: string; style?: string };

/** รูปแบบค่าที่ปุ่มเลือกวันเวลาส่งกลับ (ตรงกับ notify/cardkit.mjs DT_MODES) */
const DT_MODES = { date: /^\d{4}-\d{2}-\d{2}$/, time: /^\d{2}:\d{2}$/, datetime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/ };

export interface AranCard {
    system?: string;
    topic?: string;
    icon?: string;
    title?: string;
    urgent?: boolean;
    fields?: AranField[];
    lines?: string[];
    link?: string;
    link_label?: string;
    ack?: boolean;
    note?: string;
    color?: string;
    level?: AranLevel;
    subtitle?: string;
    image?: string;
    sections: AranSection[];
    buttons: AranButton[];
    status?: { text: string; tone: AranTone };
    closed?: boolean;
}

const TONES: AranTone[] = ["crit", "high", "low", "ok", "muted"];
const LEVELS: AranLevel[] = ["info", "success", "warning", "critical"];
const STYLES = ["primary", "secondary", "danger"];

const str = (v: unknown, max = 300): string => (typeof v === "string" ? v.slice(0, max) : "");
const tone = (v: unknown): AranTone | undefined => (TONES.includes(v as AranTone) ? (v as AranTone) : undefined);
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const style = (v: unknown): string | undefined => (STYLES.includes(v as string) ? (v as string) : undefined);

function readFields(v: unknown, max = 16): AranField[] {
    return list(v, max)
        .filter((f): f is unknown[] => Array.isArray(f) && typeof f[0] === "string" && typeof f[1] === "string")
        .map((f) => [str(f[0], 40), str(f[1], 300), tone(f[2])] as AranField);
}

function readSections(v: unknown): AranSection[] {
    const out: AranSection[] = [];
    for (const raw of list(v, 8)) {
        const x = obj(raw);
        const title = str(x.title, 60) || undefined;
        if (x.type === "text" && str(x.text, 1000)) out.push({ type: "text", text: str(x.text, 1000) });
        else if (x.type === "fields") {
            const items = readFields(x.items);
            if (items.length) out.push({ type: "fields", title, items });
        } else if (x.type === "steps") {
            const items = list(x.items, 8)
                .map(obj)
                .filter((i) => str(i.label, 80))
                .map((i) => ({
                    label: str(i.label, 80),
                    time: str(i.time, 30) || undefined,
                    state: (["done", "current"].includes(i.state as string) ? i.state : "todo") as "done" | "current" | "todo",
                }));
            if (items.length) out.push({ type: "steps", title, items });
        } else if (x.type === "table") {
            const columns = list(x.columns, 4).map((c) => str(c, 30));
            const rows = list(x.rows, 20)
                .filter(Array.isArray)
                .map((r) => columns.map((_, i) => str((r as unknown[])[i], 60)));
            const tones = list(x.tones, 20).map((r) => columns.map((_, i) => tone(Array.isArray(r) ? r[i] : "") ?? ""));
            if (columns.length && rows.length) out.push({ type: "table", title, columns, rows, tones });
        } else if (x.type === "stats") {
            const items = list(x.items, 4)
                .map(obj)
                .filter((i) => str(i.label, 30) && str(i.value, 20))
                .map((i) => ({ label: str(i.label, 30), value: str(i.value, 20), tone: tone(i.tone) }));
            if (items.length) out.push({ type: "stats", title, items });
        }
    }
    return out;
}

function readButtons(v: unknown): AranButton[] {
    const out: AranButton[] = [];
    for (const raw of list(v, 4)) {
        const b = obj(raw);
        const label = str(b.label, 30);
        if (!label) continue;
        const url = str(b.url, 2000);
        if (b.type === "link" && /^https?:\/\//.test(url)) out.push({ type: "link", label, url, style: style(b.style) });
        else if (b.type === "copy" && str(b.text, 200)) out.push({ type: "copy", label, text: str(b.text, 200), style: style(b.style) });
        else if (b.type === "app" && /^https:\/\//.test(url)) out.push({ type: "app", label, url, style: style(b.style) });
        else if (b.type === "action" && /^[\w.-]{1,40}$/.test(str(b.id, 40)))
            out.push({ type: "action", label, id: str(b.id, 40), style: style(b.style), confirm: str(b.confirm, 120) || undefined });
        else if (b.type === "datetime" && /^[\w.-]{1,40}$/.test(str(b.id, 40))) {
            const mode = (["date", "time"].includes(b.mode as string) ? b.mode : "datetime") as "date" | "time" | "datetime";
            const ok = (v: unknown): string | undefined => (DT_MODES[mode].test(str(v, 16)) ? str(v, 16) : undefined);
            out.push({ type: "datetime", label, id: str(b.id, 40), style: style(b.style), mode, min: ok(b.min), max: ok(b.max), initial: ok(b.initial) });
        }
    }
    return out;
}

/** อ่านการ์ดจากเนื้อหาข้อความ — ค่าที่ไม่ถูกรูปแบบถูกตัดทิ้ง (ข้อความมาจากใครก็ได้ในห้อง) */
export function readCard(content: Record<string, unknown>): AranCard | null {
    const c = content[ARANCHAT_CARD_KEY];
    if (!c || typeof c !== "object") return null;
    const o = c as Record<string, unknown>;
    const title = str(o.title, 200);
    if (!title) return null;
    const link = str(o.link, 2000);
    const image = str(o.image, 300);
    const status = obj(o.status);
    return {
        system: str(o.system, 60),
        topic: str(o.topic, 80),
        icon: str(o.icon, 8),
        title,
        urgent: o.urgent === true,
        fields: readFields(o.fields, 12),
        lines: list(o.lines, 12)
            .map((l) => str(l))
            .filter(Boolean),
        link: /^https?:\/\//.test(link) ? link : undefined,
        link_label: str(o.link_label, 40) || "เปิดดู",
        ack: o.ack === true,
        note: str(o.note, 200),
        color: /^#[0-9a-f]{6}$/i.test(str(o.color)) ? str(o.color) : undefined,
        level: LEVELS.includes(o.level as AranLevel) ? (o.level as AranLevel) : undefined,
        subtitle: str(o.subtitle, 160) || undefined,
        image: /^mxc:\/\/[\w.:-]+\/[\w-]+$/.test(image) ? image : undefined,
        sections: readSections(o.sections),
        buttons: readButtons(o.buttons),
        status: str(status.text, 120) ? { text: str(status.text, 120), tone: tone(status.tone) ?? "ok" } : undefined,
        closed: o.closed === true,
    };
}

/** ใครกดรับทราบแล้วบ้าง — อัปเดตเองเมื่อมีคนกดเพิ่ม */
function useAcks(props: IBodyProps): { names: string[]; mine: boolean } {
    const cli = useMatrixClientContext();
    const ev = props.mxEvent;
    const [, refresh] = useReducer((n: number) => n + 1, 0);
    const relations: Relations | null | undefined = ev.getId()
        ? props.getRelationsForEvent?.(ev.getId()!, RelationType.Annotation, EventType.Reaction)
        : null;
    useEffect(() => {
        if (!relations) return;
        relations.on(RelationsEvent.Add, refresh);
        relations.on(RelationsEvent.Remove, refresh);
        relations.on(RelationsEvent.Redaction, refresh);
        return () => {
            relations.off(RelationsEvent.Add, refresh);
            relations.off(RelationsEvent.Remove, refresh);
            relations.off(RelationsEvent.Redaction, refresh);
        };
    }, [relations]);
    const acks = relations?.getSortedAnnotationsByKey()?.find(([key]) => key === ARANCHAT_ACK_KEY)?.[1];
    const room = cli.getRoom(ev.getRoomId());
    const senders = [...(acks ?? [])].filter((e) => !e.isRedacted()).map((e) => e.getSender()!);
    return {
        names: [...new Set(senders)].map((s) => room?.getMember(s)?.name ?? s),
        mine: senders.includes(cli.getSafeUserId()),
    };
}

/** "2026-11-20T18:30" → "20 พ.ย. 69 18:30 น." (ข้อความตอบกลับให้คนในห้องอ่านง่าย) */
function formatValue(v: string): string {
    const [d, t] = v.includes("T") ? v.split("T") : /^\d{2}:/.test(v) ? [undefined, v] : [v, undefined];
    const date = d
        ? new Date(`${d}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })
        : "";
    return [date, t ? `${t} น.` : ""].filter(Boolean).join(" ");
}

const toneClass = (t?: string): string => (t ? ` mx_AranCard_tone_${t}` : "");
const TONE_MARK: Partial<Record<AranTone, string>> = { crit: "‼", high: "↑", low: "↓" };

function Fields({ items }: { items: AranField[] }): JSX.Element {
    return (
        <dl>
            {items.map(([k, v, t], i) => (
                <React.Fragment key={i}>
                    <dt>{k}</dt>
                    <dd className={toneClass(t)}>
                        {v}
                        {t && TONE_MARK[t] ? <span className="mx_AranCard_mark"> {TONE_MARK[t]}</span> : null}
                    </dd>
                </React.Fragment>
            ))}
        </dl>
    );
}

function Section({ s }: { s: AranSection }): JSX.Element {
    const title = "title" in s && s.title ? <h4 className="mx_AranCard_sectionTitle">{s.title}</h4> : null;
    switch (s.type) {
        case "text":
            return <p className="mx_AranCard_text">{s.text}</p>;
        case "fields":
            return (
                <div className="mx_AranCard_section">
                    {title}
                    <Fields items={s.items} />
                </div>
            );
        case "steps":
            return (
                <div className="mx_AranCard_section">
                    {title}
                    <ol className="mx_AranCard_steps">
                        {s.items.map((i, n) => (
                            <li key={n} className={`mx_AranCard_step_${i.state}`}>
                                <span className="mx_AranCard_dot" aria-hidden />
                                <span className="mx_AranCard_stepLabel">{i.label}</span>
                                {i.time && <span className="mx_AranCard_stepTime">{i.time}</span>}
                            </li>
                        ))}
                    </ol>
                </div>
            );
        case "table":
            return (
                <div className="mx_AranCard_section">
                    {title}
                    <table className="mx_AranCard_table">
                        <thead>
                            <tr>
                                {s.columns.map((c, i) => (
                                    <th key={i}>{c}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {s.rows.map((r, ri) => (
                                <tr key={ri}>
                                    {r.map((c, ci) => (
                                        <td key={ci} className={toneClass(s.tones?.[ri]?.[ci])}>
                                            {c}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        case "stats":
            return (
                <div className="mx_AranCard_section">
                    {title}
                    <div className="mx_AranCard_stats" style={{ gridTemplateColumns: `repeat(${s.items.length}, 1fr)` }}>
                        {s.items.map((i, n) => (
                            <div key={n} className={`mx_AranCard_stat${toneClass(i.tone)}`}>
                                <b>{i.value}</b>
                                <small>{i.label}</small>
                            </div>
                        ))}
                    </div>
                </div>
            );
    }
}

export default function AranCardBody(props: IBodyProps): JSX.Element {
    const cli = useMatrixClientContext();
    const ev = props.mxEvent;
    const card = readCard(ev.getContent())!;
    const { names, mine } = useAcks(props);
    const [sending, setSending] = useState(false);
    const [pending, setPending] = useState<string | null>(null);
    const [copied, setCopied] = useState<string | null>(null);
    const acked = mine || sending;
    // ปุ่มที่ส่งผลกลับระบบได้เฉพาะการ์ดจากบอทแจ้งเตือน (การ์ดที่ส่งต่อมา ผู้ส่งเป็นผู้ใช้ → แสดงอย่างเดียว)
    const live = !props.inhibitInteraction && !!ev.getSender()?.startsWith("@aranchat:");

    // บอทแก้การ์ดเป็น "ปิดแล้ว" → ล้างสถานะกำลังส่ง · ไม่มีคำตอบใน 20 วินาที → ให้กดใหม่ได้
    useEffect(() => {
        if (!pending) return;
        if (card.closed) return setPending(null);
        const t = window.setTimeout(() => setPending(null), 20_000);
        return () => window.clearTimeout(t);
    }, [pending, card.closed]);

    const ack = (): void => {
        if (acked || !live) return;
        setSending(true);
        cli.sendEvent(ev.getRoomId()!, EventType.Reaction, {
            "m.relates_to": { rel_type: RelationType.Annotation, event_id: ev.getId()!, key: ARANCHAT_ACK_KEY },
        }).catch(() => setSending(false));
    };

    const runAction = async (b: Extract<AranButton, { type: "action" | "datetime" }>): Promise<void> => {
        if (!live || pending || card.closed) return;
        // ปุ่มเลือกวันเวลา: เลือกก่อน แล้วส่งค่าไปกับการกด
        let value: string | undefined;
        if (b.type === "datetime") {
            value = await pickDateTime({ title: b.label, mode: b.mode, min: b.min, max: b.max, initial: b.initial });
            if (!value) return;
        } else if (b.confirm) {
            const { finished } = Modal.createDialog(QuestionDialog, {
                title: b.label,
                description: <p>{b.confirm}</p>,
                button: b.label,
                danger: b.style === "danger",
            });
            const [ok] = await finished;
            if (!ok) return;
        }
        setPending(b.id);
        // ข้อความตอบกลับการ์ด = ทุกคนในห้องเห็นว่าใครกดอะไร (แอปอื่นเห็นเป็นข้อความปกติ)
        const content = {
            msgtype: MsgType.Text,
            body: value ? `${b.label}: ${formatValue(value)}` : b.label,
            "m.relates_to": { "m.in_reply_to": { event_id: ev.getId()! } },
            [ARANCHAT_CARD_ACTION_KEY]: { event_id: ev.getId()!, id: b.id, ...(value ? { value } : {}) },
        } as unknown as RoomMessageEventContent;
        cli.sendMessage(ev.getRoomId()!, content).catch(() => setPending(null));
    };

    const copy = (b: Extract<AranButton, { type: "copy" }>): void => {
        void navigator.clipboard?.writeText(b.text).then(() => {
            setCopied(b.label);
            window.setTimeout(() => setCopied(null), 1500);
        });
    };

    const head = [card.system, card.topic].filter(Boolean).join(" · ");
    // หัวการ์ดด่วนเป็นสีแดงอยู่แล้ว → ไอคอนวงกลมแดงมองไม่เห็น ใช้ป้าย "ด่วน" แทน
    const icon = card.urgent && card.icon === "🔴" ? "" : card.icon;
    const level = card.urgent ? "critical" : card.level;
    const heroStyle = card.color && !level ? { background: card.color } : undefined;
    const imageUrl = card.image ? (mediaFromMxc(card.image).getThumbnailOfSourceHttp(640, 360, "scale") ?? undefined) : undefined;
    const buttons = card.buttons.filter((b) => (b.type !== "action" && b.type !== "datetime") || (live && !card.closed));
    const hasBody = card.fields!.length > 0 || card.lines!.length > 0 || card.sections.length > 0;

    return (
        <div
            className={`mx_AranCard${level ? ` mx_AranCard_${level}` : ""}${card.urgent ? " mx_AranCard_urgent" : ""}`}
            ref={props.ref as React.Ref<HTMLDivElement>}
        >
            <div className="mx_AranCard_hero" style={heroStyle}>
                <small>
                    {card.urgent && <span className="mx_AranCard_badge">ด่วน</span>}
                    {icon ? `${icon} ` : ""}
                    {head}
                </small>
                <b>{card.title}</b>
                {card.subtitle && <span className="mx_AranCard_subtitle">{card.subtitle}</span>}
            </div>
            {imageUrl && <img className="mx_AranCard_image" src={imageUrl} alt="" loading="lazy" />}
            {hasBody && (
                <div className="mx_AranCard_body">
                    {card.fields!.length > 0 && <Fields items={card.fields!} />}
                    {card.lines!.map((l, i) => (
                        <p key={i}>{l}</p>
                    ))}
                    {card.sections.map((s, i) => (
                        <Section key={i} s={s} />
                    ))}
                </div>
            )}
            {card.status && (
                <div className={`mx_AranCard_status${toneClass(card.status.tone)}`}>
                    {card.closed ? "✔ " : ""}
                    {card.status.text}
                </div>
            )}
            {names.length > 0 && <div className="mx_AranCard_acks">✅ รับทราบแล้ว: {names.join(", ")}</div>}
            {(card.link || buttons.length > 0 || (card.ack && live)) && (
                <div className="mx_AranCard_actions">
                    {buttons.map((b, i) => {
                        const cls = `mx_AranCard_pill mx_AranCard_pill_${b.style ?? (b.type === "action" ? "primary" : "secondary")}`;
                        if (b.type === "link")
                            return (
                                <a key={i} className={cls} href={b.url} target="_blank" rel="noreferrer noopener">
                                    {b.label}
                                </a>
                            );
                        if (b.type === "app")
                            return (
                                <button key={i} type="button" className={cls} onClick={() => openMiniApp(b.url, b.label)}>
                                    {b.label} ↗
                                </button>
                            );
                        if (b.type === "copy")
                            return (
                                <button key={i} type="button" className={cls} onClick={() => copy(b)}>
                                    {copied === b.label ? (
                                        "คัดลอกแล้ว ✓"
                                    ) : (
                                        <>
                                            <CopyIcon className="mx_AranCard_pillIcon" aria-hidden />
                                            {b.label}
                                        </>
                                    )}
                                </button>
                            );
                        return (
                            <button
                                key={i}
                                type="button"
                                className={cls}
                                disabled={!!pending}
                                onClick={() => void runAction(b)}
                            >
                                {pending === b.id ? "กำลังส่ง…" : b.type === "datetime" ? `📅 ${b.label}` : b.label}
                            </button>
                        );
                    })}
                    {card.link && (
                        <a
                            className="mx_AranCard_pill mx_AranCard_pill_secondary"
                            href={card.link}
                            target="_blank"
                            rel="noreferrer noopener"
                        >
                            {card.link_label}
                        </a>
                    )}
                    {card.ack && live && (
                        <button
                            type="button"
                            className={`mx_AranCard_pill ${acked ? "mx_AranCard_pill_done" : "mx_AranCard_pill_primary"}`}
                            disabled={acked}
                            onClick={ack}
                        >
                            {acked ? "รับทราบแล้ว ✓" : "รับทราบ"}
                        </button>
                    )}
                </div>
            )}
            {(card.note || !props.inhibitInteraction) && (
                <div className="mx_AranCard_foot">
                    <span className="mx_AranCard_note">{card.note}</span>
                    {!props.inhibitInteraction && (
                        // ส่งต่อให้เพื่อน/กลุ่ม (เข้าห้องเข้ารหัสก็ถูกเข้ารหัสด้วย)
                        <button
                            type="button"
                            className="mx_AranCard_forward"
                            onClick={() =>
                                Modal.createDialog(ForwardDialog, {
                                    matrixClient: cli,
                                    event: ev,
                                    permalinkCreator: props.permalinkCreator!,
                                })
                            }
                        >
                            ↗ ส่งต่อ
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
