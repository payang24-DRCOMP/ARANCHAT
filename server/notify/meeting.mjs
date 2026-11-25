// AranChat — จดการประชุม: ฟังสด (ข้อความขึ้นตามเสียง) หรือบันทึกอย่างเดียว แล้วถอดเสียงเต็ม + สรุปการประชุม ส่งเข้าแชท ARANKUB AI
//   ใช้กับ: ประชุมในห้อง (ไมค์ของเครื่อง) · Zoom/Teams/Meet (แอป Desktop เก็บเสียงจากลำโพงเครื่อง + ไมค์) · ถ่ายทอดสดที่เปิดบนเครื่อง
//   ทุกอย่างประมวลผลบนเครื่องของ รพ. · เสียงเก็บชั่วคราวใน data/meetings แล้วลบทิ้งเมื่อถอดเสร็จ
//
// WS /api/notify/meeting/live   (แอปเปิด — ทางเข้า publicApi ส่ง upgrade มาที่ handleUpgrade)
//   1) แอปส่ง JSON  {"type":"start","openid":"<openid access_token>","title":"ประชุมกรรมการ…","captions":true}
//                   หรือ {"type":"resume","openid":"…","session":"<id>"}  (เน็ตหลุดแล้วต่อใหม่ — เสียงต่อท้ายไฟล์เดิม)
//   2) server ตอบ  {"type":"ready","session":"<id>","captions":true|false,"seconds":0}
//      captions=false = บันทึกอย่างเดียว (ขอข้อความสดแต่ช่องเต็ม จะได้ false พร้อม "note")
//   3) แอปส่งเสียงเป็น binary: PCM16 little-endian · 16 kHz · mono (ก้อนละ ~100–500 ms)
//      server ส่งกลับ {"type":"partial","text"} / {"type":"final","text","start","end"} (เฉพาะ captions)
//                     {"type":"level","seconds"} ทุก ~5 วินาที (ยืนยันว่าเสียงถึง server)
//   4) แอปส่ง "end" (text) → {"type":"processing","seconds"} → ปิด · ผลส่งเข้าแชท ARANKUB AI ของผู้บันทึกภายในไม่กี่นาที
//   แอปหลุดโดยไม่ส่ง end: เก็บไว้ 10 นาทีให้ต่อ (resume) — เลยเวลาแล้วถอด + สรุปจากที่บันทึกได้
//   ระบบรีสตาร์ทกลางคัน: เสียงที่บันทึกแล้วถอดต่อให้ (resume จะได้ error → แอปเริ่มบันทึกตอนใหม่ต่อเอง)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { transcribe, transcriptText, summarizeLong } from "./asr.mjs";

const env = (k, d) => process.env[k] ?? d;
const LIVE_URL = env("ASR_LIVE_URL", "ws://127.0.0.1:18081/v1/live");
const LIVE_MAX = Number(env("MEETING_LIVE_MAX", "3"));          // ข้อความสดพร้อมกันได้กี่ห้อง (การ์ดจอ 1 ใบ)
const REC_MAX = Number(env("MEETING_REC_MAX", "20"));           // บันทึกพร้อมกันได้กี่ห้อง (ใช้แค่พื้นที่ดิสก์)
const MAX_S = Number(env("MEETING_MAX_HOURS", "4")) * 3600;     // ยาวสุดต่อครั้ง
const RESUME_MS = 10 * 60_000;
const BYTES_PER_S = 32_000;                                     // PCM16 16 kHz mono
const NOTE = "ถอดเสียงอัตโนมัติ อาจมีคำผิด · ตรวจทานก่อนใช้ · เสียงประมวลผลบนเครื่องของ รพ. และลบทิ้งแล้ว";

const fmtDur = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} ชม. ${m} นาที` : `${m || 1} นาที`; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** WAV header สำหรับ PCM16 16 kHz mono (soundfile ของระบบถอดเสียงอ่านได้โดยไม่ต้องมี ffmpeg) */
function wavHeader(dataBytes) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + dataBytes, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16_000, 24); h.writeUInt32LE(BYTES_PER_S, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(dataBytes, 40);
  return h;
}

/**
 * @param {{ dir: string, log: Function, whoami: (token:string)=>Promise<string|null>,
 *           notice: (mxid:string, text:string, html?:string)=>Promise<void>,
 *           file: (mxid:string, name:string, text:string)=>Promise<void> }} o
 */
export function createMeetings({ dir, log, whoami, notice, file }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const sessions = new Map();   // id → session
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  const liveCount = () => [...sessions.values()].filter((s) => s.upstream && !s.ended).length;

  // ── คิวถอดเสียง + สรุป (ทีละงาน — การ์ดจอใบเดียว) ──────────────────────────────────────
  const queue = [];
  let working = false;
  async function pump() {
    if (working) return;
    working = true;
    while (queue.length) {
      const s = queue.shift();
      await runJob(s).catch((e) => log("meeting process error:", s.id, e.message));
    }
    working = false;
  }

  async function runJob(s) {
    const seconds = s.bytes / BYTES_PER_S;
    const title = s.title || "การประชุม";
    const when = s.startedAt.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" });
    const head = `🎙 ${title} · ${when} · ${fmtDur(seconds)}`;
    const wav = `${s.pcm}.wav`;
    try {
      if (seconds < 3) { await notice(s.mxid, `${head}\nไม่ได้เสียงประชุม (สั้นเกินไป) — ลองตรวจไมค์/การเลือกแหล่งเสียงแล้วเริ่มใหม่ครับ`); return; }
      const ahead = queue.length ? ` (มีงานก่อนหน้า ${queue.length} งาน)` : "";
      await notice(s.mxid, `${head}\n⏳ กำลังถอดเสียงและสรุป — ประมาณ ${Math.max(1, Math.ceil(seconds / 420) + 1)} นาที${ahead}`).catch(() => {});
      // PCM → WAV (เขียนหัวไฟล์แล้วต่อด้วยเสียง โดยไม่โหลดทั้งไฟล์เข้าหน่วยความจำ)
      fs.writeFileSync(wav, wavHeader(s.bytes), { mode: 0o600 });
      await new Promise((ok, bad) => fs.createReadStream(s.pcm).on("error", bad).pipe(fs.createWriteStream(wav, { flags: "a" })).on("finish", ok).on("error", bad));
      let transcript = "";
      try {
        const res = await transcribe(await fs.openAsBlob(wav, { type: "audio/wav" }), { name: "meeting.wav", mime: "audio/wav", durationS: seconds, meeting: "meeting" });
        transcript = transcriptText(res);
        log("meeting asr", s.mxid, `${Math.round(seconds)}s`, `chars=${transcript.length}`, `proc=${res.processing_s}s`);
      } catch (e) {
        // ถอดไฟล์เต็มไม่ได้ → ใช้ข้อความสดที่ได้ระหว่างประชุม (ถ้ามี)
        log("meeting asr error:", s.id, e.message);
        transcript = s.finals.map((f) => f.text).join("\n");
        if (!transcript) throw e;
      }
      if (!transcript.trim()) { await notice(s.mxid, `${head}\nไม่พบเสียงพูดที่ถอดได้ — ถ้าประชุม Zoom/Teams ให้เลือก "เสียงจากเครื่อง + ไมค์" ครับ`); return; }
      const base = title.replace(/[\\/:*?"<>|\n]+/g, " ").trim().slice(0, 60) || "การประชุม";
      await file(s.mxid, `${base}-บทถอดเสียง.txt`, `${title}\n${when} · ${fmtDur(seconds)}\n\n${transcript}\n\n— ${NOTE}\n`);
      const summary = await summarizeLong(transcript).catch((e) => { log("meeting summary error:", e.message); return null; });
      if (summary) {
        await notice(s.mxid, `📝 สรุปการประชุม: ${title}\n${when} · ${fmtDur(seconds)}\n\n${summary}\n\n— สรุปโดย AI ในเครื่องของ รพ. · ตรวจทานก่อนใช้ · กดค้างที่ข้อความเพื่อส่งต่อเข้ากลุ่มได้`,
          `<p><b>📝 สรุปการประชุม: ${esc(title)}</b><br><sub>${esc(when)} · ${esc(fmtDur(seconds))}</sub></p><p>${esc(summary).replace(/\n/g, "<br>")}</p><p><sub>สรุปโดย AI ในเครื่องของ รพ. · ตรวจทานก่อนใช้ · กดค้างที่ข้อความเพื่อส่งต่อเข้ากลุ่มได้</sub></p>`);
      } else {
        await notice(s.mxid, `${head}\nบทถอดเสียงเต็มแนบเป็นไฟล์ด้านบน (ระบบสรุปไม่ว่าง หรือการประชุมสั้นเกินกว่าจะสรุป)`);
      }
    } catch (e) {
      log("meeting failed:", s.id, e.message);
      await notice(s.mxid, `${head}\n⚠️ ถอดเสียงไม่สำเร็จ (${e.message.slice(0, 120)}) — แจ้งผู้ดูแลระบบได้ครับ`).catch(() => {});
    } finally {
      for (const f of [s.pcm, wav, `${s.pcm}.json`]) fs.rmSync(f, { force: true });
    }
  }

  // ── ปิดการบันทึก ──────────────────────────────────────────────────────────────────────
  async function finish(s, why) {
    if (s.ended) return;
    s.ended = true;
    clearTimeout(s.idle);
    sessions.delete(s.id);
    await new Promise((ok) => s.out.end(ok));
    if (s.upstream) { try { s.upstream.send("end"); } catch {} setTimeout(() => { try { s.upstream.close(); } catch {} }, 15_000); }
    log("meeting end", s.mxid, why, `${Math.round(s.bytes / BYTES_PER_S)}s`, s.upstream ? "live" : "rec");
    queue.push(s);
    pump();
  }

  /** ต่อ ws ไประบบถอดเสียงสด — ข้อความสดส่งกลับไปที่แอปที่ต่ออยู่ตอนนั้น */
  function openUpstream(s) {
    return new Promise((ok) => {
      let ws;
      try { ws = new WebSocket(LIVE_URL); } catch { return ok(null); }
      ws.binaryType = "arraybuffer";
      const t = setTimeout(() => { try { ws.close(); } catch {} ok(null); }, 20_000);
      ws.onopen = () => ws.send(JSON.stringify({ lang: "th-TH", latency_ms: 560, end_silence_ms: 700 }));
      ws.onmessage = (m) => {
        let ev; try { ev = JSON.parse(m.data); } catch { return; }
        if (ev.type === "ready") { clearTimeout(t); return ok(ws); }
        if (ev.type === "final") { const text = String(ev.display_text ?? ev.text ?? "").trim(); if (text) { s.finals.push({ text, start: ev.start, end: ev.end }); s.send({ type: "final", text, start: s.offset + (ev.start ?? 0), end: s.offset + (ev.end ?? 0) }); } }
        else if (ev.type === "partial") s.send({ type: "partial", text: ev.text });
        else if (ev.type === "error") log("meeting live asr:", ev.detail);
      };
      ws.onclose = () => { clearTimeout(t); if (s.upstream === ws) s.upstream = null; ok(null); };
      ws.onerror = () => {};
    });
  }

  wss.on("connection", (client) => {
    let s = null;
    const send = (o) => { if (client.readyState === 1) client.send(JSON.stringify(o)); };
    const fail = (msg) => { send({ type: "error", message: msg }); client.close(1008); };
    const hello = setTimeout(() => fail("ไม่ได้รับคำสั่งเริ่ม"), 15_000);

    client.on("message", async (data, isBinary) => {
      if (isBinary) {
        if (!s || s.ended) return;
        const buf = Buffer.from(data);
        if (buf.length % 2) return;
        s.out.write(buf);
        s.bytes += buf.length;
        if (s.upstream?.readyState === 1) s.upstream.send(buf);
        if (s.bytes / BYTES_PER_S >= MAX_S) { send({ type: "processing", seconds: Math.round(s.bytes / BYTES_PER_S), note: "ครบเวลาสูงสุดต่อครั้ง" }); await finish(s, "max"); client.close(1000); return; }
        if (s.bytes - s.lastLevel >= BYTES_PER_S * 5) { s.lastLevel = s.bytes; send({ type: "level", seconds: Math.round(s.bytes / BYTES_PER_S) }); }
        return;
      }
      const text = data.toString();
      if (text === "end") { if (!s) return client.close(); send({ type: "processing", seconds: Math.round(s.bytes / BYTES_PER_S) }); await finish(s, "end"); client.close(1000); return; }
      if (text === "ping") return send({ type: "pong" });
      let msg; try { msg = JSON.parse(text); } catch { return fail("คำสั่งไม่ถูกต้อง"); }
      if (s) return;   // เริ่มแล้ว
      clearTimeout(hello);
      const mxid = await whoami(String(msg.openid ?? "")).catch(() => null);
      if (!mxid) return fail("ต้องเข้าระบบ (token ไม่ถูกต้องหรือหมดอายุ)");
      if (msg.type === "resume") {
        s = sessions.get(String(msg.session ?? ""));
        if (!s || s.mxid !== mxid || s.ended) { s = null; return fail("การบันทึกนี้ปิดไปแล้ว — ผลจะส่งเข้าแชท ARANKUB AI"); }
        try { s.client?.close(4000); } catch {}
        clearTimeout(s.idle);
      } else {
        const mine = [...sessions.values()].filter((x) => x.mxid === mxid);
        if (mine.length >= 2) return fail("คุณมีการบันทึกที่ยังไม่จบอยู่แล้ว 2 รายการ");
        if (sessions.size >= REC_MAX) return fail("มีการบันทึกพร้อมกันเต็มแล้ว ลองใหม่อีกครั้ง");
        const id = crypto.randomBytes(12).toString("base64url");
        const pcm = path.join(dir, `${id}.pcm`);
        s = { id, mxid, pcm, out: fs.createWriteStream(pcm, { mode: 0o600 }), bytes: 0, lastLevel: 0, offset: 0, finals: [],
          title: String(msg.title ?? "").replace(/\s+/g, " ").trim().slice(0, 120), startedAt: new Date(), wantCaptions: msg.captions !== false, upstream: null, ended: false };
        sessions.set(id, s);
        fs.writeFileSync(`${pcm}.json`, JSON.stringify({ mxid, title: s.title, startedAt: s.startedAt }), { mode: 0o600 });
        log("meeting start", mxid, s.wantCaptions ? "captions" : "record", JSON.stringify(s.title));
      }
      s.client = client;
      s.send = send;
      let note;
      if (s.wantCaptions && !s.upstream) {
        if (liveCount() >= LIVE_MAX) note = `ข้อความสดเต็ม (${LIVE_MAX} ห้องพร้อมกัน) — บันทึกเสียงไว้ให้ แล้วส่งบทถอด + สรุปหลังจบประชุม`;
        else {
          s.offset = s.bytes / BYTES_PER_S;
          s.upstream = await openUpstream(s);
          if (!s.upstream) note = "ระบบข้อความสดไม่ว่าง — บันทึกเสียงไว้ให้ แล้วส่งบทถอด + สรุปหลังจบประชุม";
        }
      }
      send({ type: "ready", session: s.id, captions: !!s.upstream, seconds: Math.round(s.bytes / BYTES_PER_S), ...(note ? { note } : {}) });
    });

    client.on("close", () => {
      clearTimeout(hello);
      if (!s || s.ended || s.client !== client) return;
      s.client = null;
      s.send = () => {};
      // ปิดข้อความสด (คืนช่องให้ห้องอื่น) — ต่อใหม่จะเปิดให้อีกครั้ง · ไม่มีใครมาต่อใน 10 นาที = จบแล้วถอดให้
      if (s.upstream) { try { s.upstream.send("end"); } catch {} const u = s.upstream; s.upstream = null; setTimeout(() => { try { u.close(); } catch {} }, 15_000); }
      s.idle = setTimeout(() => finish(s, "timeout"), RESUME_MS);
    });
    client.on("error", () => {});
  });

  // ระบบรีสตาร์ทระหว่างบันทึก/รอคิว: เสียงที่ค้างอยู่ถอด + สรุปต่อให้ (ไม่หาย) · ไฟล์ที่ไม่มีข้อมูลประกอบ/เก่าเกิน 2 วัน ลบทิ้ง
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (f.endsWith(".pcm.json")) {
      const pcm = p.slice(0, -5);
      try {
        const m = JSON.parse(fs.readFileSync(p, "utf8"));
        const bytes = fs.statSync(pcm).size - (fs.statSync(pcm).size % 2);
        queue.push({ id: path.basename(pcm, ".pcm"), mxid: m.mxid, pcm, bytes, finals: [], startedAt: new Date(m.startedAt),
          title: `${m.title || "การประชุม"} (บันทึกถึงตอนระบบรีสตาร์ท)` });
        log("meeting recover", m.mxid, `${Math.round(bytes / BYTES_PER_S)}s`);
      } catch { fs.rmSync(p, { force: true }); fs.rmSync(pcm, { force: true }); }
    } else if (!fs.existsSync(`${p.replace(/\.wav$/, "")}.json`) && Date.now() - fs.statSync(p).mtimeMs > 2 * 86400_000) fs.rmSync(p, { force: true });
  }
  if (queue.length) setTimeout(pump, 30_000);   // รอให้ระบบถอดเสียง/Matrix พร้อมก่อน

  return {
    /** http server 'upgrade' — คืน true ถ้าเป็นของเรา */
    handleUpgrade(req, socket, head) {
      const p = new URL(req.url, "http://x").pathname.replace(/\/+$/, "");
      if (p !== "/api/notify/meeting/live") return false;
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      return true;
    },
    status: () => ({ sessions: sessions.size, live: liveCount(), queue: queue.length, working }),
  };
}
