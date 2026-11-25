/*
 * AranChat — จดการประชุม: เก็บเสียง (ไมค์ / เสียงจากเครื่อง + ไมค์) → PCM16 16 kHz → ส่งสดไป notify (WS /api/notify/meeting/live)
 *   server ถอดเป็นข้อความสด (ถ้าเปิด) และเมื่อจบส่งบทถอดเต็ม + สรุปเข้าแชท ARANKUB AI — notify/meeting.mjs
 *   เน็ตหลุด: เก็บเสียงไว้ในเครื่องแล้วต่อใหม่ (resume) ส่งที่ค้างตามไป · ไม่มีการเก็บเสียงในเครื่องหลังจบ
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { MatrixClientPeg } from "../MatrixClientPeg";
import PlatformPeg from "../PlatformPeg";
import { aranChatConfig } from "./config";

export type MeetingSource = "mic" | "system";
export type MeetingEvent =
    | { type: "ready"; captions: boolean; note?: string }
    | { type: "partial"; text: string }
    | { type: "final"; text: string; start?: number }
    | { type: "level"; rms: number }
    | { type: "sent"; seconds: number }
    | { type: "net"; online: boolean }
    | { type: "processing"; seconds: number }
    | { type: "error"; message: string; fatal: boolean };

function liveUrl(): string {
    const base = aranChatConfig()?.invite_api ?? "/api/notify";
    const u = new URL(`${base.replace(/\/+$/, "")}/meeting/live`, window.location.href);
    u.protocol = u.protocol === "http:" ? "ws:" : "wss:";
    return u.toString();
}

type LoopbackPlatform = { aranPrepareLoopback?: () => Promise<boolean> };

/** เครื่องนี้เก็บเสียงจากลำโพง (Zoom/Teams/ถ่ายทอดสด) ได้ไหม — Desktop: Windows · เบราว์เซอร์: Chrome/Edge (แชร์แท็บ/ทั้งจอพร้อมเสียง) */
export function systemAudioSupport(): "desktop" | "browser" | null {
    const plat = PlatformPeg.get() as unknown as LoopbackPlatform | null;
    if (plat?.aranPrepareLoopback) return /Windows/i.test(navigator.userAgent) ? "desktop" : null;
    const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    return !mobile && typeof navigator.mediaDevices?.getDisplayMedia === "function" ? "browser" : null;
}

// แปลงเสียงเป็น PCM16 16 kHz mono ใน AudioWorklet (ลดอัตราสุ่มเอง — ไม่พึ่ง AudioContext ที่ตั้ง sampleRate ได้)
const WORKLET = `
class AranPcm extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.pos = 0; this.buf = new Int16Array(3200); this.n = 0; this.sum = 0; this.cnt = 0; }
  process(inputs) {
    const ch = inputs[0]; if (!ch || !ch.length) return true;
    const len = ch[0].length;
    for (let i = 0; i < len; i++) {
      let v = 0; for (let c = 0; c < ch.length; c++) v += ch[c][i]; v /= ch.length;
      this.sum += v * v; this.cnt++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const s = Math.max(-1, Math.min(1, v));
        this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.n === this.buf.length) {
          this.port.postMessage({ pcm: this.buf.buffer, rms: Math.sqrt(this.sum / this.cnt) }, [this.buf.buffer]);
          this.buf = new Int16Array(3200); this.n = 0; this.sum = 0; this.cnt = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("aran-pcm", AranPcm);
`;

export class MeetingRecorder {
    private ctx?: AudioContext;
    private streams: MediaStream[] = [];
    private ws?: WebSocket;
    private session?: string;
    private pending: ArrayBuffer[] = []; // เสียงที่ยังส่งไม่ได้ (เน็ตหลุด) — สูงสุด ~30 นาที
    private stopped = false;
    private paused = false;
    private retry = 0;
    private ping?: number;
    private wake?: { release(): Promise<void> };
    public seconds = 0; // เวลาที่บันทึกแล้ว (ไม่นับช่วงพัก)

    public constructor(
        private readonly opts: { title: string; source: MeetingSource; captions: boolean },
        private readonly emit: (e: MeetingEvent) => void,
    ) {}

    public async start(): Promise<void> {
        const mic = await navigator.mediaDevices
            .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
            .catch((e: Error) => {
                if (this.opts.source === "mic") throw new Error(`เปิดไมค์ไม่ได้ (${e.message}) — อนุญาตไมค์ให้แอปก่อน`);
                return null; // เสียงจากเครื่องอย่างเดียวก็ได้
            });
        if (mic) this.streams.push(mic);
        if (this.opts.source === "system") {
            const plat = PlatformPeg.get() as unknown as LoopbackPlatform | null;
            if (plat?.aranPrepareLoopback && !(await plat.aranPrepareLoopback())) {
                throw new Error("เครื่องนี้เก็บเสียงจากลำโพงไม่ได้ (ทำได้บน Windows) — เลือก \"ไมค์\" แทน");
            }
            const disp = await navigator.mediaDevices
                // เบราว์เซอร์: ผู้ใช้เลือกแท็บ Zoom/YouTube แล้วติ๊ก "แชร์เสียง" · Desktop: ตอบเอง (จอหลัก + loopback)
                .getDisplayMedia({ video: true, audio: true })
                .catch((e: Error) => {
                    throw new Error(`ไม่ได้เสียงจากเครื่อง (${e.message})`);
                });
            disp.getVideoTracks().forEach((t) => t.stop()); // ใช้แค่เสียง
            if (!disp.getAudioTracks().length) {
                throw new Error("ไม่ได้เสียงจากเครื่อง — ตอนเลือกแท็บ/หน้าจอ ให้ติ๊ก \"แชร์เสียง\" ด้วย");
            }
            this.streams.push(disp);
        }
        if (!this.streams.length) throw new Error("ไม่มีแหล่งเสียง");

        this.ctx = new AudioContext();
        const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
        await this.ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const node = new AudioWorkletNode(this.ctx, "aran-pcm", { channelCount: 1, channelCountMode: "explicit" });
        for (const s of this.streams) this.ctx.createMediaStreamSource(s).connect(node); // ผสมไมค์ + เสียงเครื่อง
        const mute = this.ctx.createGain();
        mute.gain.value = 0;
        node.connect(mute).connect(this.ctx.destination); // ให้ worklet ทำงาน โดยไม่เล่นเสียงออกลำโพง (กันเสียงสะท้อน)
        node.port.onmessage = (m: MessageEvent<{ pcm: ArrayBuffer; rms: number }>): void => {
            this.emit({ type: "level", rms: this.paused ? 0 : m.data.rms });
            if (this.paused || this.stopped) return;
            this.seconds += 0.2;
            this.push(m.data.pcm);
        };
        // แหล่งเสียงหายกลางคัน (ถอดหูฟัง/ปิดแชร์) — แจ้งผู้ใช้
        for (const s of this.streams) {
            s.getAudioTracks().forEach((t) =>
                t.addEventListener("ended", () => {
                    if (!this.stopped) this.emit({ type: "error", message: "แหล่งเสียงถูกปิด — กดหยุดแล้วเริ่มใหม่ถ้าจำเป็น", fatal: false });
                }),
            );
        }
        try {
            this.wake = await (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen");
        } catch {
            /* ไม่รองรับก็ไม่เป็นไร */
        }
        await this.connect();
    }

    private push(pcm: ArrayBuffer): void {
        if (this.ws?.readyState === WebSocket.OPEN && !this.pending.length) {
            this.ws.send(pcm);
            return;
        }
        this.pending.push(pcm);
        if (this.pending.length > 9000) this.pending.shift(); // ~30 นาที
    }

    private flush(): void {
        while (this.pending.length && this.ws?.readyState === WebSocket.OPEN) this.ws.send(this.pending.shift()!);
    }

    private async connect(): Promise<void> {
        const token = await MatrixClientPeg.safeGet().getOpenIdToken();
        const ws = new WebSocket(liveUrl());
        ws.binaryType = "arraybuffer";
        this.ws = ws;
        ws.onopen = (): void => {
            ws.send(
                JSON.stringify(
                    this.session
                        ? { type: "resume", openid: token.access_token, session: this.session }
                        : { type: "start", openid: token.access_token, title: this.opts.title, captions: this.opts.captions },
                ),
            );
        };
        ws.onmessage = (m: MessageEvent<string>): void => {
            let e: Record<string, unknown>;
            try {
                e = JSON.parse(m.data);
            } catch {
                return;
            }
            switch (e.type) {
                case "ready":
                    this.session = String(e.session);
                    this.retry = 0;
                    this.emit({ type: "net", online: true });
                    this.emit({ type: "ready", captions: !!e.captions, note: e.note as string | undefined });
                    this.flush();
                    window.clearInterval(this.ping);
                    this.ping = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
                    break;
                case "partial":
                    this.emit({ type: "partial", text: String(e.text ?? "") });
                    break;
                case "final":
                    this.emit({ type: "final", text: String(e.text ?? ""), start: e.start as number });
                    break;
                case "level":
                    this.emit({ type: "sent", seconds: Number(e.seconds) });
                    break;
                case "processing":
                    this.emit({ type: "processing", seconds: Number(e.seconds) });
                    break;
                case "error":
                    if (this.session && /ปิดไปแล้ว/.test(String(e.message))) {
                        // server รีสตาร์ท: ส่วนก่อนหน้าถอดให้แล้ว — เริ่มตอนใหม่ต่อเลย
                        this.session = undefined;
                        this.emit({ type: "error", message: "ระบบเพิ่งรีสตาร์ท — ส่วนก่อนหน้าจะได้สรุปแยก บันทึกต่อเป็นตอนใหม่แล้ว", fatal: false });
                        return;
                    }
                    this.emit({ type: "error", message: String(e.message ?? "ขัดข้อง"), fatal: !this.session });
                    if (!this.session) this.stopped = true;
                    break;
            }
        };
        ws.onclose = (): void => {
            window.clearInterval(this.ping);
            if (this.stopped) return;
            this.emit({ type: "net", online: false });
            const wait = Math.min(15_000, 1000 * 2 ** this.retry++);
            window.setTimeout(() => {
                if (!this.stopped) void this.connect().catch(() => ws.onclose?.(new CloseEvent("close")));
            }, wait);
        };
    }

    public setPaused(p: boolean): void {
        this.paused = p;
    }

    /** จบการประชุม: ส่งเสียงที่ค้างให้หมด แล้วบอก server ให้ถอด + สรุป */
    public async stop(): Promise<boolean> {
        this.paused = true;
        for (let i = 0; i < 60 && this.pending.length; i++) {
            this.flush();
            if (this.pending.length) await new Promise((r) => setTimeout(r, 500));
        }
        const ok = this.ws?.readyState === WebSocket.OPEN && !this.pending.length;
        if (ok) {
            const done = new Promise<void>((r) => {
                const t = setTimeout(r, 10_000);
                this.ws!.addEventListener("close", () => {
                    clearTimeout(t);
                    r();
                });
            });
            this.stopped = true; // server ปิดสายหลังรับ end — ไม่ต้องต่อใหม่
            this.ws!.send("end");
            await done;
        }
        this.stopped = true;
        this.cleanup();
        return ok;
    }

    /** ยกเลิก (ไม่ส่ง end) — server จะถอดส่วนที่ได้รับแล้วหลัง 10 นาที */
    public cleanup(): void {
        this.stopped = true;
        window.clearInterval(this.ping);
        try {
            this.ws?.close();
        } catch {
            /* */
        }
        this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
        void this.ctx?.close().catch(() => {});
        void this.wake?.release().catch(() => {});
    }
}
