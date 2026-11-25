/*
 * AranChat — "จดประชุม": หน้าตั้งค่าก่อนเริ่ม (ชื่อการประชุม · แหล่งเสียง · ข้อความสด) + แผงลอยระหว่างประชุม
 *   แผงลอยอยู่มุมจอ ใช้แชทต่อได้ระหว่างประชุม · ย่อได้ · ผลบทถอด + สรุปส่งเข้าแชท ARANKUB AI — aranchat/meeting.ts
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React, { type JSX, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import Modal from "../Modal";
import BaseDialog from "../components/views/dialogs/BaseDialog";
import { MeetingRecorder, type MeetingEvent, type MeetingSource, systemAudioSupport } from "./meeting";

let root: Root | null = null;
let active: MeetingRecorder | null = null;

/** เปิดจากปุ่ม "จดประชุม" — กำลังบันทึกอยู่แล้วจะขยายแผงเดิมแทน */
export function openAranMeeting(roomName?: string): void {
    if (active) {
        document.querySelector<HTMLElement>(".mx_AranMeeting_panel")?.classList.remove("mx_AranMeeting_min");
        return;
    }
    Modal.createDialog(AranMeetingSetup, { roomName });
}

function defaultTitle(roomName?: string): string {
    const d = new Date().toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
    return roomName ? `ประชุม ${roomName} ${d}` : `ประชุม ${d}`;
}

function AranMeetingSetup({ roomName, onFinished }: { roomName?: string; onFinished: () => void }): JSX.Element {
    const sys = systemAudioSupport();
    const [title, setTitle] = useState(defaultTitle(roomName));
    const [source, setSource] = useState<MeetingSource>("mic");
    const [captions, setCaptions] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const start = async (): Promise<void> => {
        setBusy(true);
        setError(null);
        const rec = new MeetingRecorder({ title: title.trim() || defaultTitle(roomName), source, captions }, (e) =>
            window.dispatchEvent(new CustomEvent<MeetingEvent>("aran-meeting", { detail: e })),
        );
        try {
            mountPanel(rec, title.trim() || defaultTitle(roomName));
            await rec.start();
            onFinished();
        } catch (e) {
            rec.cleanup();
            unmountPanel();
            setError((e as Error).message);
            setBusy(false);
        }
    };

    return (
        <BaseDialog className="mx_AranMeeting_setup" title="🎙 จดประชุม" onFinished={onFinished}>
            <p className="mx_AranMeeting_hint">
                ระบบฟังเสียงประชุม ถอดเป็นข้อความ แล้วส่ง <b>บทถอดเสียงเต็ม + สรุปการประชุม</b> (ประเด็น · มติ · งานที่มอบหมาย)
                เข้าแชท <b>ARANKUB AI</b> ของคุณหลังจบประชุม — ประมวลผลบนเครื่องของ รพ.
            </p>
            <label className="mx_AranMeeting_field">
                <span>ชื่อการประชุม</span>
                <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <fieldset className="mx_AranMeeting_field">
                <legend>ฟังเสียงจาก</legend>
                <label>
                    <input type="radio" checked={source === "mic"} onChange={() => setSource("mic")} /> 🎤 ไมค์ของเครื่องนี้
                    <small>ประชุมในห้องประชุม — วางเครื่องใกล้ผู้พูด หรือต่อไมค์ห้องประชุม</small>
                </label>
                <label className={sys ? "" : "mx_AranMeeting_disabled"}>
                    <input type="radio" disabled={!sys} checked={source === "system"} onChange={() => setSource("system")} /> 💻
                    เสียงจากเครื่อง + ไมค์
                    <small>
                        {sys === "desktop"
                            ? "Zoom · Teams · Google Meet · ถ่ายทอดสด ที่เปิดอยู่บนเครื่องนี้ (ได้ทั้งเสียงคนอื่นและเสียงเรา)"
                            : sys === "browser"
                              ? "เลือกแท็บ Zoom/Meet/YouTube แล้วติ๊ก \"แชร์เสียงของแท็บ\" (Chrome/Edge)"
                              : "ใช้ได้บนแอป AranChat Desktop (Windows) หรือ Chrome/Edge บนคอม"}
                    </small>
                </label>
            </fieldset>
            <label className="mx_AranMeeting_check">
                <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> แสดงข้อความสดระหว่างประชุม
                <small>ปิดได้ถ้าต้องการแค่บันทึกแล้วสรุปทีหลัง</small>
            </label>
            <p className="mx_AranMeeting_privacy">
                ⚠️ แจ้งผู้เข้าประชุมว่ากำลังบันทึกเสียง · หลีกเลี่ยงการเอ่ยชื่อ/เลขประจำตัวผู้ป่วย · เสียงถูกลบทิ้งเมื่อถอดเสร็จ
            </p>
            {error && <p className="mx_AranMeeting_error">{error}</p>}
            <div className="mx_AranMeeting_actions">
                <button className="mx_AranMeeting_btn" onClick={onFinished}>
                    ยกเลิก
                </button>
                <button className="mx_AranMeeting_btn mx_AranMeeting_primary" disabled={busy} onClick={() => void start()}>
                    {busy ? "กำลังเริ่ม…" : "เริ่มจดประชุม"}
                </button>
            </div>
        </BaseDialog>
    );
}

function mountPanel(rec: MeetingRecorder, title: string): void {
    active = rec;
    const el = document.createElement("div");
    el.id = "mx_AranMeeting_root";
    document.body.appendChild(el);
    root = createRoot(el);
    root.render(<AranMeetingPanel rec={rec} title={title} />);
    window.addEventListener("beforeunload", warnUnload);
}

function unmountPanel(): void {
    active = null;
    root?.unmount();
    root = null;
    document.getElementById("mx_AranMeeting_root")?.remove();
    window.removeEventListener("beforeunload", warnUnload);
}

function warnUnload(e: BeforeUnloadEvent): void {
    e.preventDefault();
}

const fmt = (s: number): string => {
    s = Math.floor(s);
    const h = Math.floor(s / 3600);
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return h ? `${h}:${m}:${ss}` : `${m}:${ss}`;
};

function AranMeetingPanel({ rec, title }: { rec: MeetingRecorder; title: string }): JSX.Element {
    const [lines, setLines] = useState<string[]>([]);
    const [partial, setPartial] = useState("");
    const [captions, setCaptions] = useState<boolean | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [online, setOnline] = useState(true);
    const [level, setLevel] = useState(0);
    const [paused, setPaused] = useState(false);
    const [min, setMin] = useState(false);
    const [phase, setPhase] = useState<"rec" | "ending" | "done" | "failed">("rec");
    const [, tick] = useState(0);
    const box = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const on = (ev: Event): void => {
            const e = (ev as CustomEvent<MeetingEvent>).detail;
            switch (e.type) {
                case "ready":
                    setCaptions(e.captions);
                    if (e.note) setNote(e.note);
                    break;
                case "partial":
                    setPartial(e.text);
                    break;
                case "final":
                    setPartial("");
                    setLines((l) => [...l.slice(-200), e.text]);
                    break;
                case "level":
                    setLevel(e.rms);
                    break;
                case "net":
                    setOnline(e.online);
                    break;
                case "error":
                    setNote(e.message);
                    if (e.fatal) setPhase("failed");
                    break;
            }
        };
        window.addEventListener("aran-meeting", on);
        const t = window.setInterval(() => tick((x) => x + 1), 1000);
        return () => {
            window.removeEventListener("aran-meeting", on);
            window.clearInterval(t);
        };
    }, []);
    useEffect(() => {
        box.current?.scrollTo({ top: box.current.scrollHeight });
    }, [lines, partial]);

    const stop = async (): Promise<void> => {
        if (!window.confirm("จบการประชุมและส่งไปถอดเสียง + สรุป?")) return;
        setPhase("ending");
        const ok = await rec.stop();
        setNote(
            ok
                ? "ส่งแล้ว ✅ บทถอดเสียง + สรุปจะเข้าแชท ARANKUB AI ภายในไม่กี่นาที"
                : "เน็ตขัดข้อง — ส่วนที่ server ได้รับแล้วจะถอด + สรุปให้อัตโนมัติภายใน 10 นาที",
        );
        setPhase("done");
    };

    const bars = Math.min(10, Math.round(Math.sqrt(level) * 25));
    return (
        <div className={`mx_AranMeeting_panel${min ? " mx_AranMeeting_min" : ""}`} role="dialog" aria-label="จดประชุม">
            <div className="mx_AranMeeting_head">
                <span className={`mx_AranMeeting_dot${paused || phase !== "rec" ? " mx_AranMeeting_dotOff" : ""}`} />
                <b className="mx_AranMeeting_title" title={title}>
                    {title}
                </b>
                <span className="mx_AranMeeting_time">{fmt(rec.seconds)}</span>
                <button className="mx_AranMeeting_icon" title={min ? "ขยาย" : "ย่อ"} onClick={() => setMin(!min)}>
                    {min ? "▢" : "–"}
                </button>
            </div>
            {!min && (
                <>
                    <div className="mx_AranMeeting_status">
                        <span className="mx_AranMeeting_level" aria-hidden>
                            {Array.from({ length: 10 }, (_, i) => (
                                <i key={i} className={i < bars ? "on" : ""} />
                            ))}
                        </span>
                        {!online && <span className="mx_AranMeeting_warn">เน็ตหลุด — เก็บเสียงไว้ในเครื่อง กำลังต่อใหม่…</span>}
                        {online && paused && <span>พักการบันทึก</span>}
                        {online && !paused && phase === "rec" && (captions === false ? <span>บันทึกเสียงอย่างเดียว</span> : <span>กำลังฟัง</span>)}
                    </div>
                    {captions !== false && phase === "rec" && (
                        <div className="mx_AranMeeting_caps" ref={box}>
                            {!lines.length && !partial && <p className="mx_AranMeeting_muted">ข้อความจะขึ้นที่นี่เมื่อมีคนพูด…</p>}
                            {lines.map((l, i) => (
                                <p key={i}>{l}</p>
                            ))}
                            {partial && <p className="mx_AranMeeting_partial">{partial}</p>}
                        </div>
                    )}
                    {note && <p className="mx_AranMeeting_note">{note}</p>}
                    <div className="mx_AranMeeting_actions">
                        {phase === "rec" && (
                            <>
                                <button
                                    className="mx_AranMeeting_btn"
                                    onClick={() => {
                                        rec.setPaused(!paused);
                                        setPaused(!paused);
                                    }}
                                >
                                    {paused ? "▶ บันทึกต่อ" : "⏸ พัก"}
                                </button>
                                <button className="mx_AranMeeting_btn mx_AranMeeting_danger" onClick={() => void stop()}>
                                    ⏹ จบประชุม
                                </button>
                            </>
                        )}
                        {phase === "ending" && <span>กำลังส่งเสียงที่เหลือ…</span>}
                        {(phase === "done" || phase === "failed") && (
                            <button
                                className="mx_AranMeeting_btn mx_AranMeeting_primary"
                                onClick={() => {
                                    rec.cleanup();
                                    unmountPanel();
                                }}
                            >
                                ปิด
                            </button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
