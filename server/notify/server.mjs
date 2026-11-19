// AranChat Notify — ส่งแจ้งเตือนรายบุคคลเข้าแชท (bot @aranchat "AranChat แจ้งเตือน")
//
// แหล่งแจ้งเตือน:
//   1. AranKub / P4P — อ่านตาราง notifications ของแต่ละระบบ (อ่านอย่างเดียว ไม่ต้องแก้โค้ดระบบนั้น)
//      แถวที่ระบบนั้นสร้าง = คนที่ระบบนั้นตัดสินแล้วว่าต้องเห็น → ส่งต่อเข้าแชทของคนนั้น
//   2. ระบบอื่น (FastAPI, PHP, cron) — POST http://127.0.0.1:PORT/send (Bearer NOTIFY_API_KEY)
//
// ผู้รับ: ผู้ใช้ AranKub → บัญชีแชทที่ผูกไว้ (MAS upstream link) · P4P staff → AranKub ผ่าน hash เลขบัตร/Provider ID
// ผู้ใช้เลือกเองว่าจะรับเรื่องไหน: พิมพ์ "ตั้งค่า" / "ปิด 3" / "เปิด 3" ในแชทกับ bot (ค่าเริ่มต้นดู events.mjs)
// ห้องแชทกับ bot ไม่เข้ารหัส (bot ไม่มีกุญแจ) — แจ้งเตือนเป็นข้อความสั้น + ลิงก์ ไม่ใส่ข้อมูลผู้ป่วยละเอียด
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { EVENTS } from "./events.mjs";
import { renderCard } from "./card.mjs";
import { createInvites, templateReader } from "./invites.mjs";
import { transcribe, transcriptText, summarize, ASR_MAX_BYTES } from "./asr.mjs";
import { cardExtras, cleanFields, sectionsText, imageToMxc, newSecret, callWebhook, cleanStatus, isActionButton, DT_MODES, cleanQuickReplies } from "./cardkit.mjs";

const run = promisify(execFile);
const env = (k, d) => process.env[k] ?? d ?? (() => { throw new Error(`ต้องตั้ง ${k}`); })();

/** อ่าน DATABASE_URL จากไฟล์ env ของระบบนั้นโดยตรง — ไม่ต้องคัดลอกรหัสผ่านมาเก็บซ้ำ */
function dbUrlFrom(file) {
  const line = fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error(`ไม่พบ DATABASE_URL ใน ${file}`);
  return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

const MATRIX = env("MATRIX_URL", "https://matrix.arankub.com");
const TOKEN = env("MATRIX_TOKEN");
const API_KEY = env("NOTIFY_API_KEY");          // key เดิม = ระบบ "api" (สปสช., cron)
const ADMIN_KEY = env("NOTIFY_ADMIN_KEY");       // หน้าจัดการใน AranKub (/settings/aranchat) เรียก /admin/*
const PORT = Number(env("PORT", "3210"));
const STATE_FILE = env("STATE_FILE", new URL("./data/state.json", import.meta.url).pathname);
const NS = env("K8S_NAMESPACE", "ess");
const LINKS = { arankub: env("ARANKUB_URL", "https://arankub.com"), p4p: env("P4P_URL", "https://p4p.arankub.com") };
const POLL_MS = 15_000;

const arankubDb = new pg.Pool({ connectionString: dbUrlFrom(env("ARANKUB_ENV_FILE")), max: 2 });
const p4pDb = new pg.Pool({ connectionString: dbUrlFrom(env("P4P_ENV_FILE")), max: 2 });

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ── state (ไฟล์เดียว: ตำแหน่งที่อ่านถึง, ห้องแชทของแต่ละคน, ค่าที่ผู้ใช้เลือก) ──────────────
const state = (() => {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
})();
state.cursor ??= {};       // source → { ts, ids[] }
state.dm ??= {};           // mxid → roomId
state.prefs ??= {};        // mxid → { eventKey: bool }
state.seen ??= {};         // mxid → [eventKey] เรื่องที่เคยได้รับ (ใช้แสดงในเมนูตั้งค่า)
state.extraEvents ??= [];  // kind ที่ไม่อยู่ใน events.mjs — ต่อท้ายหมายเลข
state.eventCfg ??= {};     // eventKey → ค่าที่ admin แก้จากหน้าจัดการ { label, icon, on, mandatory, recipients[] }
state.sources ??= {};      // ระบบที่ส่งแจ้งเตือน id → { name, color, mark, keyHash, keyHint, enabled, builtin, kind }
state.log ??= [];          // ประวัติการส่งล่าสุด { t, src, ev, to, r }
state.channels ??= {};     // ห้องแจ้งเตือนตามเรื่อง id → { name, icon, topic, roomId, createdAt } (ส่งด้วย to: "room:<id>")
state.docs ??= {};         // คำอธิบายวิธีดึงข้อมูลที่ระบบส่งมาเอง "<ระบบ>:<เรื่อง>" → { note, sql, at } (แสดงปุ่ม "ดู query" ในหน้าจัดการ)
state.cases ??= {};        // เรื่องด่วน (การ์ดมีปุ่ม "รับทราบ") "<ref>" → { ev, title, fields, at, events: [{eventId, roomId, to}], by, ackAt, reminded, escalated }
state.announced ??= {};    // ประกาศแอปรุ่นใหม่แล้ว "<desktop>|<android>" → เวลา (ไม่ประกาศรุ่นเดิมซ้ำ)
state.actions ??= {};      // การ์ดที่มีปุ่มสั่งงาน "<ref>" → { src, ev, extId, buttons, approvers, card, body, html, events: [{roomId, eventId}], closed, status, at }
state.webhooks ??= {};
state.bots ??= {};         // คำสั่ง / เมนูบอท ที่แต่ละระบบลงทะเบียน ระบบ → { commands: [{command, description, usage}], menu: [{label, type, text|url}], at }     // ระบบ → { url, secret, lastError, lastOkAt } (ระบบตั้งเองด้วย PUT /api/notify/webhook)
state.idem ??= {};         // กันส่งซ้ำ "<ระบบ>:<id ที่ระบบส่งมา>" → เวลา (เก็บ 3 วัน)
// ระบบตั้งต้น (ลบไม่ได้) — สีตรงกับ THEMES ใน card.mjs
for (const [id, s] of Object.entries({
  arankub: { name: "AranKub", color: "#0B7A8C", mark: "A", kind: "poll" },
  p4p: { name: "P4P", color: "#5B3FC4", mark: "P", kind: "poll" },
  sos: { name: "แจ้งเหตุ SOS", color: "#B91C1C", mark: "SOS", kind: "poll" },
  api: { name: "สปสช. / งานอัตโนมัติ", color: "#15803D", mark: "สป", kind: "api", keyHint: "NOTIFY_API_KEY" },
})) state.sources[id] ??= { ...s, enabled: true, builtin: true, createdAt: new Date().toISOString() };
const LOG_MAX = 2000;
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const sourceOn = (id) => state.sources[id]?.enabled !== false;
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(new URL("./data/", import.meta.url).pathname, { recursive: true });
    fs.writeFileSync(STATE_FILE + ".tmp", JSON.stringify(state, null, 1));
    fs.renameSync(STATE_FILE + ".tmp", STATE_FILE);
  }, 500);
}

// ── เรื่องแจ้งเตือน + ค่าที่ผู้ใช้เลือก ─────────────────────────────────────────────
// ค่าในไฟล์ events.mjs = ค่าตั้งต้น · ที่ admin แก้จากหน้าจัดการ (state.eventCfg) ทับอีกชั้น
function eventList() {
  return [...EVENTS, ...state.extraEvents].map((e) => ({ ...e, ...state.eventCfg[e.key] }));
}
function eventOf(key) {
  let e = eventList().find((x) => x.key === key);
  if (!e) {
    // เรื่องใหม่ที่ระบบส่งมาครั้งแรก — ส่งได้เลย แล้วขึ้นป้าย "ใหม่" ในหน้าจัดการให้ admin ตั้งชื่อ
    e = { key, label: key.split(":").slice(1).join(":"), on: true, isNew: true };
    state.extraEvents.push(e);
    save();
  }
  return e;
}
const eventNo = (key) => eventList().findIndex((x) => x.key === key) + 1;
const wants = (mxid, e) => e.mandatory || (state.prefs[mxid]?.[e.key] ?? e.on);

// ── ผู้รับ: id AranKub → บัญชีแชท ──────────────────────────────────────────────────
let mxidByArankub = new Map();   // AranKub user id → @user:server
let arankubByP4p = new Map();    // P4P staff id → AranKub user id
let arankubByCidHash = new Map(); // SHA-256 เลขบัตร (สูตร Provider ID) → AranKub user id — ระบบอื่น (HOSxP) ส่ง "cidhash:<hex>" ไม่ต้องส่งเลขบัตรจริง
let serverName = "";
let mapsAt = 0;

async function refreshMaps(force = false) {
  if (!force && Date.now() - mapsAt < 5 * 60_000) return;
  // MAS อยู่ใน K3s: อ่านผ่าน psql ใน pod postgres (อ่านอย่างเดียว)
  const { stdout } = await run("kubectl", ["-n", NS, "exec", "ess-postgres-0", "-c", "postgres", "--",
    "psql", "-U", "postgres", "-d", "matrixauthenticationservice", "-AtF", "\t", "-c",
    `select l.subject, u.username from upstream_oauth_links l
       join users u using (user_id)
       join upstream_oauth_providers p using (upstream_oauth_provider_id)
      where u.deactivated_at is null and p.issuer = '${LINKS.arankub}'`]);
  if (!serverName) serverName = (await mx("GET", "/_matrix/client/v3/account/whoami")).user_id.split(":").slice(1).join(":");
  mxidByArankub = new Map(stdout.trim().split("\n").filter(Boolean)
    .map((l) => l.split("\t")).map(([sub, user]) => [sub, `@${user}:${serverName}`]));

  // P4P ↔ AranKub: hash เลขบัตรสูตรเดียวกับ Provider ID หรือ providerId ตรงกัน
  const [staff, acc] = await Promise.all([
    p4pDb.query(`select id, "mophHashCid" h, "providerId" p from "Staff"`),
    arankubDb.query(`select "userId" u, "hashCid" h, "providerId" p from provider_accounts where "userId" is not null
                     union all select id, "hashCid", null from users where "hashCid" is not null`),
  ]);
  const byHash = new Map(), byPid = new Map();
  for (const r of acc.rows) { if (r.h) byHash.set(r.h, r.u); if (r.p) byPid.set(r.p, r.u); }
  arankubByCidHash = byHash;
  arankubByP4p = new Map();
  for (const s of staff.rows) {
    const u = (s.h && byHash.get(s.h)) || (s.p && byPid.get(s.p));
    if (u) arankubByP4p.set(s.id, u);
  }
  mapsAt = Date.now();
}

async function resolve(target) {
  if (target.startsWith("@")) return target;
  const [kind, id] = target.split(/:(.*)/s);
  await refreshMaps();
  const lookup = () => {
    const au = kind === "arankub" ? id : kind === "p4p" ? arankubByP4p.get(id)
      : kind === "cidhash" ? arankubByCidHash.get(String(id).toLowerCase()) : null;
    return au ? mxidByArankub.get(au) : null;
  };
  // ไม่เจอ: อาจเพิ่ง login แชทครั้งแรก / เพิ่งผูก Provider ID → โหลดใหม่ (ไม่บ่อยกว่านาทีละครั้ง)
  if (!lookup() && Date.now() - mapsAt > 60_000) await refreshMaps(true);
  return lookup() ?? null;
}

// ── Matrix ───────────────────────────────────────────────────────────────────────
async function mx(method, path, body, attempt = 0) {
  const res = await fetch(MATRIX + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  // Synapse จำกัดความถี่ (ส่ง/เชิญถี่) → รอตามที่บอกแล้วลองใหม่
  if (res.status === 429 && attempt < 6) {
    await new Promise((r) => setTimeout(r, Math.min(data.retry_after_ms ?? 5000, 30_000)));
    return mx(method, path, body, attempt + 1);
  }
  if (!res.ok) throw Object.assign(new Error(`${method} ${path.split("?")[0]} → ${res.status} ${data.errcode ?? ""}`), { status: res.status, data });
  return data;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let txn = Date.now();
async function say(roomId, text, html) {
  await mx("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txn++}`,
    { msgtype: "m.text", body: text, ...(html ? { format: "org.matrix.custom.html", formatted_body: html } : {}) });
}

const WELCOME = "สวัสดีครับ ผมคือ AranChat แจ้งเตือน 🔔\n"
  + "แจ้งเตือนจาก AranKub, P4P และระบบอื่นๆ ที่เกี่ยวกับคุณจะส่งมาที่ห้องนี้\n"
  + "เลือกเรื่องที่อยากรับ: พิมพ์ \"ตั้งค่า\"\n"
  + "📄 ส่งรูปหรือ PDF เอกสารมาที่ห้องนี้ ผมจะอ่านข้อความออกมาให้ก๊อปไปใช้ได้";

// ── อ่านข้อความจากรูป/PDF (OCR) ─────────────────────────────────────────────────────
// ผู้ใช้ส่งรูปหรือ PDF เข้าห้องแชทส่วนตัวกับ bot → ส่งต่อให้บริการ OCR กลางของ hospital-api
// (OpenThai2.0-OCR-Text บน CPU ~1 วิ/หน้า — เครื่องเดียวกัน ไฟล์ไม่ออกนอก รพ.)
// ไม่เก็บไฟล์/ข้อความไว้ที่ bot · ห้องนี้ไม่เข้ารหัส ไฟล์ที่ส่งมาจึงอยู่บน media server ของเราตามปกติของแชท
const OCR_URL = env("OCR_URL", "http://127.0.0.1:8000/api/v1/ocr/read");
const OCR_MAX_BYTES = 25 * 1024 * 1024;
const OCR_INLINE_MAX = 3500;            // ยาวกว่านี้ส่งเป็นไฟล์ .txt + ตัวอย่างต้นข้อความ
const OCR_NOTE = "ตรวจทานก่อนใช้ · อ่านเอกสารพิมพ์ได้ดี ลายมือมักอ่านไม่ออก";
const OCR_INTRO = "📄 ใหม่! อ่านข้อความจากเอกสารให้\n"
  + "ถ่ายรูปหรือส่งไฟล์ PDF เอกสารเข้ามาในห้องนี้ ผมจะแปลงเป็นข้อความให้ก๊อปไปใช้ต่อได้ทันที (ประมาณ 1 วินาทีต่อหน้า)\n"
  + "• เหมาะกับเอกสารพิมพ์: หนังสือราชการ ตาราง ใบเสร็จ เช็ค สติกเกอร์ชื่อผู้ป่วย\n"
  + "• ลายมือยังอ่านไม่ได้ · ตรวจทานก่อนใช้ทุกครั้ง · ไฟล์ไม่ถูกเก็บไว้ในระบบอ่าน\n"
  + "ใช้บนคอมก็ได้ที่ AranKub → อ่านข้อความจากภาพ (OCR)";
const OCR_INTRO_HTML = "<p><b>📄 ใหม่! อ่านข้อความจากเอกสารให้</b></p>"
  + "<p>ถ่ายรูปหรือส่งไฟล์ PDF เอกสารเข้ามาในห้องนี้ ผมจะแปลงเป็นข้อความให้ก๊อปไปใช้ต่อได้ทันที (ประมาณ 1 วินาทีต่อหน้า)</p>"
  + "<ul><li>เหมาะกับเอกสารพิมพ์: หนังสือราชการ ตาราง ใบเสร็จ เช็ค สติกเกอร์ชื่อผู้ป่วย</li>"
  + "<li>ลายมือยังอ่านไม่ได้ · ตรวจทานก่อนใช้ทุกครั้ง · ไฟล์ไม่ถูกเก็บไว้ในระบบอ่าน</li></ul>"
  + `<p>ใช้บนคอมก็ได้ที่ <a href="${env("ARANKUB_URL", "https://arankub.com")}/tools/ocr">AranKub → อ่านข้อความจากภาพ (OCR)</a></p>`;

async function sendMsg(roomId, content) {
  return mx("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txn++}`, content);
}

async function downloadMxc(mxc) {
  const m = /^mxc:\/\/([^/]+)\/([^/?#]+)$/.exec(mxc ?? "");
  if (!m) throw new Error("ลิงก์ไฟล์ไม่ถูกต้อง");
  // Synapse รุ่นใหม่บังคับ authenticated media (v1) · รุ่นเก่ายังเป็น v3
  for (const path of [`/_matrix/client/v1/media/download/${m[1]}/${m[2]}`, `/_matrix/media/v3/download/${m[1]}/${m[2]}`]) {
    const r = await fetch(MATRIX + path, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (r.status !== 404) throw new Error(`ดาวน์โหลดไฟล์ไม่สำเร็จ (${r.status})`);
  }
  throw new Error("ไม่พบไฟล์บนเซิร์ฟเวอร์");
}

async function onFileMessage(roomId, ev) {
  if (state.dm[ev.sender] !== roomId) return;   // เฉพาะห้องแชทส่วนตัวกับ bot (ในห้องกลุ่มไม่ยุ่งกับรูปที่คนส่งกัน)
  const c = ev.content;
  const reply = (text, html) => sendMsg(roomId, {
    msgtype: "m.notice", body: text, ...(html ? { format: "org.matrix.custom.html", formatted_body: html } : {}),
    "m.relates_to": { "m.in_reply_to": { event_id: ev.event_id } },
  });
  const name = String(c.filename ?? c.body ?? "file");
  const mime = String(c.info?.mimetype ?? "");
  // เสียง/วิดีโอ (ข้อความเสียง ไฟล์บันทึกประชุม) → ถอดเสียง + สรุป
  if (c.msgtype === "m.audio" || c.msgtype === "m.video" || /^(audio|video)\//.test(mime)) return onAudioMessage(roomId, ev, reply);
  const isPdf = c.msgtype === "m.file" && (mime === "application/pdf" || /\.pdf$/i.test(name));
  const isImg = c.msgtype === "m.image" || (c.msgtype === "m.file" && /^image\//.test(mime));
  if (!isImg && !isPdf) return reply("📄 อ่านข้อความได้จากรูปภาพ (JPG/PNG/TIFF) หรือไฟล์ PDF · 🎙 ถอดเสียงได้จากไฟล์เสียง/วิดีโอครับ");
  if (!c.url) return reply("🔒 ไฟล์นี้ถูกเข้ารหัส bot เปิดอ่านไม่ได้ — ลองส่งในห้องแชทกับ \"AranChat แจ้งเตือน\" ที่ไม่ได้เข้ารหัส");
  if ((c.info?.size ?? 0) > OCR_MAX_BYTES) return reply("ไฟล์ใหญ่เกิน 25 MB — แบ่งส่งทีละส่วนครับ");

  if (isPdf) await reply("⏳ กำลังอ่าน PDF… (ประมาณ 1 วินาทีต่อหน้า)").catch(() => {});
  let data;
  try {
    const buf = await downloadMxc(c.url);
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: mime || (isPdf ? "application/pdf" : "image/jpeg") }), name);
    const r = await fetch(OCR_URL, { method: "POST", body: fd, headers: { "X-OCR-Client": "aranchat" }, signal: AbortSignal.timeout(150_000) });
    data = await r.json().catch(() => ({}));
    if (!r.ok) return reply(`อ่านไม่สำเร็จ: ${data.detail ?? `HTTP ${r.status}`}`);
  } catch (e) {
    log("ocr error:", e.message);
    return reply("ระบบอ่านข้อความไม่ว่างหรือขัดข้อง ลองใหม่อีกครั้งครับ");
  }

  const text = String(data.text ?? "").trim();
  const sec = ((data.elapsed_ms ?? 0) / 1000).toFixed(1);
  const head = `📄 อ่านได้ ${data.page_count} หน้า (${sec} วินาที)`;
  if (!text) return reply(`${head} — ไม่พบตัวอักษรที่อ่านได้ (ถ้าเป็นลายมือ ระบบยังอ่านไม่ได้)`);
  log("ocr", ev.sender, `pages=${data.page_count}`, `chars=${text.length}`);

  if (text.length <= OCR_INLINE_MAX) {
    return reply(`${head}\n\n${text}\n\n— ${OCR_NOTE}`,
      `<p><b>${esc(head)}</b></p><pre>${esc(text)}</pre><p><sub>${esc(OCR_NOTE)}</sub></p>`);
  }
  // ยาว → แนบเป็นไฟล์ .txt (ก๊อปทั้งหมดได้) + ตัวอย่างต้นข้อความ
  const txt = Buffer.from(text, "utf8");
  const fname = `${name.replace(/\.[^.]+$/, "")}-ข้อความ.txt`;
  const up = await fetch(`${MATRIX}/_matrix/media/v3/upload?filename=${encodeURIComponent(fname)}`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "text/plain; charset=utf-8" }, body: txt,
  });
  const { content_uri } = await up.json().catch(() => ({}));
  if (!up.ok || !content_uri) return reply(`${head}\n\n${text.slice(0, OCR_INLINE_MAX)}\n…(ตัดเหลือ ${OCR_INLINE_MAX} ตัวอักษร)`);
  await sendMsg(roomId, { msgtype: "m.file", body: fname, filename: fname, url: content_uri,
    info: { mimetype: "text/plain", size: txt.length } });
  const preview = text.slice(0, 1200);
  return reply(`${head} — ข้อความยาว ${text.length.toLocaleString()} ตัวอักษร แนบเป็นไฟล์ด้านบน\n\n${preview}\n…\n\n— ${OCR_NOTE}`,
    `<p><b>${esc(head)}</b> — ข้อความยาว ${text.length.toLocaleString()} ตัวอักษร แนบเป็นไฟล์ด้านบน</p><pre>${esc(preview)}\n…</pre><p><sub>${esc(OCR_NOTE)}</sub></p>`);
}

// ── ถอดเสียง + สรุปประชุม (asr.mjs) ─────────────────────────────────────────────────
const ASR_NOTE = "ถอดเสียงอัตโนมัติ อาจมีคำผิด · ตรวจทานก่อนใช้ · ไฟล์ประมวลผลบนเครื่องของ รพ.";
async function uploadText(name, text) {
  const buf = Buffer.from(text, "utf8");
  const up = await fetch(`${MATRIX}/_matrix/media/v3/upload?filename=${encodeURIComponent(name)}`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "text/plain; charset=utf-8" }, body: buf,
  });
  const { content_uri } = await up.json().catch(() => ({}));
  return up.ok && content_uri ? { url: content_uri, size: buf.length } : null;
}
const asrBusy = new Set();   // ผู้ใช้ที่กำลังถอดไฟล์อยู่ (ทีละไฟล์ต่อคน)
async function onAudioMessage(roomId, ev, reply) {
  const c = ev.content;
  if (!c.url) return reply("🔒 ไฟล์นี้ถูกเข้ารหัส บอทเปิดไม่ได้ — ส่งไฟล์ในแชทนี้ (ไม่เข้ารหัส) หรือกด \"ถอดเป็นข้อความ\" ที่ข้อความเสียงในแอป");
  if ((c.info?.size ?? 0) > ASR_MAX_BYTES) return reply("ไฟล์ใหญ่เกิน 200 MB — ส่งเป็นไฟล์เสียง (m4a/mp3) แทนวิดีโอ หรือแบ่งเป็นช่วงครับ");
  if (asrBusy.has(ev.sender)) return reply("⏳ กำลังถอดไฟล์ก่อนหน้าอยู่ รอสักครู่ครับ");
  asrBusy.add(ev.sender);
  const durationS = Math.round((c.info?.duration ?? 0) / 1000);
  const name = String(c.filename ?? c.body ?? "audio");
  try {
    if (durationS === 0 || durationS > 60) {
      await reply(`🎙 กำลังถอดเสียง${durationS ? ` (${Math.ceil(durationS / 60)} นาที — ใช้เวลาประมาณ ${Math.max(1, Math.ceil(durationS / 420))} นาที)` : "…"}`).catch(() => {});
    }
    const buf = await downloadMxc(c.url);
    const res = await transcribe(buf, { name, mime: c.info?.mimetype || "application/octet-stream", durationS });
    const transcript = transcriptText(res);
    log("asr", ev.sender, `${Math.round(res.duration_s ?? 0)}s`, res.mode, `chars=${transcript.length}`, `proc=${res.processing_s}s`);
    if (!transcript) return reply("🎙 ไม่พบเสียงพูดที่ถอดได้ในไฟล์นี้");
    const dur = res.duration_s ? `${Math.floor(res.duration_s / 60)}:${String(Math.round(res.duration_s % 60)).padStart(2, "0")} นาที` : "";
    // สั้น: ตอบข้อความเลย · ยาว: แนบบทถอดเป็นไฟล์ + สรุปประชุม
    if (transcript.length <= 1500) {
      await reply(`🎙 ถอดเสียง${dur ? ` (${dur})` : ""}\n\n${transcript}\n\n— ${ASR_NOTE}`,
        `<p><b>🎙 ถอดเสียง${dur ? ` (${esc(dur)})` : ""}</b></p><blockquote>${esc(transcript).replace(/\n/g, "<br>")}</blockquote><p><sub>${esc(ASR_NOTE)}</sub></p>`);
    } else {
      const fname = `${name.replace(/\.[^.]+$/, "")}-บทถอดเสียง.txt`;
      const file = await uploadText(fname, `${transcript}\n\n— ${ASR_NOTE}\n`);
      if (file) await sendMsg(roomId, { msgtype: "m.file", body: fname, filename: fname, url: file.url, info: { mimetype: "text/plain", size: file.size } });
    }
    const summary = await summarize(transcript).catch((e) => { log("summary error:", e.message); return null; });
    if (summary) {
      await reply(`📝 สรุปการประชุม${dur ? ` (${dur})` : ""}\n\n${summary}\n\n— สรุปโดย AI ในเครื่องของ รพ. · ตรวจทานก่อนใช้`,
        `<p><b>📝 สรุปการประชุม${dur ? ` (${esc(dur)})` : ""}</b></p><p>${esc(summary).replace(/\n/g, "<br>")}</p><p><sub>สรุปโดย AI ในเครื่องของ รพ. · ตรวจทานก่อนใช้</sub></p>`);
    } else if (transcript.length > 1500) {
      await reply(`🎙 ถอดเสียงแล้ว${dur ? ` (${dur})` : ""} — บทถอดเต็มแนบเป็นไฟล์ด้านบน\n\n${transcript.slice(0, 800)}…`);
    }
  } catch (e) {
    log("asr error:", e.message);
    await reply(e.status === 415 ? "เปิดไฟล์เสียงนี้ไม่ได้ — ลองส่งเป็น m4a / mp3 / wav ครับ" : "ระบบถอดเสียงไม่ว่างหรือขัดข้อง ลองใหม่อีกครั้งครับ");
  } finally {
    asrBusy.delete(ev.sender);
  }
}

async function dmRoom(mxid) {
  if (state.dm[mxid]) return state.dm[mxid];
  const { room_id } = await mx("POST", "/_matrix/client/v3/createRoom", {
    // public_chat + join_rules invite = ห้องส่วนตัวที่ server ไม่บังคับเข้ารหัส (encryption_enabled_by_default_for_room_type: invite
    // ใช้กับ preset private_chat/trusted_private_chat เท่านั้น) — บอทไม่มีกุญแจ ส่ง/อ่านในห้องเข้ารหัสไม่ได้
    preset: "public_chat", is_direct: true, invite: [mxid],
    name: "AranChat แจ้งเตือน",
    initial_state: [{ type: "m.room.join_rules", state_key: "", content: { join_rule: "invite" } }],
  });
  state.dm[mxid] = room_id;
  save();
  // m.direct ของ bot — Element ฝั่งผู้ใช้จะจัดห้องนี้เป็น "แชทส่วนตัว"
  const direct = Object.fromEntries(Object.entries(state.dm).map(([u, r]) => [u, [r]]));
  await mx("PUT", `/_matrix/client/v3/user/${encodeURIComponent(`@aranchat:${serverName}`)}/account_data/m.direct`, direct).catch(() => {});
  await say(room_id, WELCOME);
  log("dm created", mxid);
  return room_id;
}

async function moveEncryptedDm(mxid, oldRoom) {
  delete state.dm[mxid];
  save();
  const room = await dmRoom(mxid);
  // ข้อความแจ้งในห้องเดิม — ห้องเข้ารหัสแล้วบอทส่งได้แค่ข้อความไม่เข้ารหัส บางแอปอาจไม่แสดง
  await say(oldRoom, "ห้องนี้เปิดการเข้ารหัสไว้ บอทจึงอ่านข้อความที่ส่งมาไม่ได้ — ย้ายไปแชท \"AranChat แจ้งเตือน\" ห้องใหม่แล้ว กรุณาส่งอีกครั้งที่นั่นครับ").catch(() => {});
  await mx("POST", `/_matrix/client/v3/rooms/${encodeURIComponent(oldRoom)}/leave`, {}).catch(() => {});
  await say(room, "📌 ย้ายมาห้องนี้แทนห้องเดิมที่เปิดการเข้ารหัสไว้ (บอทอ่านข้อความในห้องเข้ารหัสไม่ได้) — ส่งไฟล์เสียง/รูป/คำสั่งที่นี่ได้เลยครับ");
  log("dm moved (encrypted)", mxid);
}

// รูปแบบข้อความ: ใช้เฉพาะ HTML ที่ทุกแอปแสดงได้ (ตัวหนา/quote/ลิงก์/emoji) — สีตัวอักษรขึ้นเฉพาะบนเว็บ ไม่ใช้สื่อความหมาย
// บรรทัดแรกของ text = ข้อความที่เด้งบนจอมือถือ → ต้องเป็นหัวข้อ ไม่ใช่ชื่อระบบ
const SYSTEMS = { arankub: ["🏥", "AranKub"], p4p: ["📊", "P4P"], api: ["🔔", "AranChat"] };
const SYSTEM_OF_EVENT = { "api:nhso.sync": ["💰", "สปสช."], "api:cron.failed": ["⚙️", "ระบบอัตโนมัติ"] };
const THEME_OF_EVENT = { "api:nhso.sync": "nhso", "api:cron.failed": "system" };

/** ชื่อระบบ + สีการ์ดของเรื่องนี้ — ระบบที่เพิ่มจากหน้าจัดการใช้ชื่อ/สีที่ admin ตั้ง */
function sysInfo(ev) {
  const src = ev.key.split(":")[0];
  const fixed = SYSTEM_OF_EVENT[ev.key] ?? SYSTEMS[src];
  if (fixed) return { icon: fixed[0], name: fixed[1], theme: THEME_OF_EVENT[ev.key] ?? src };
  const s = state.sources[src] ?? {};
  return { icon: "🔔", name: s.name ?? src, colors: [s.color ?? "#5B3FD9", null, s.mark ?? (s.name ?? src).slice(0, 2)] };
}

function card(ev, n) {
  const { icon: sysIcon, name: sysName } = sysInfo(ev);
  const urgent = n.priority === "urgent";
  const head = `${urgent ? "🔴 ด่วน · " : ""}${ev.icon ?? "🔔"} ${n.title}`;
  const topic = ev.label.replace(/^[^:]+:\s*/, "");   // "งานส่งยา: ส่งไม่สำเร็จ" → "ส่งไม่สำเร็จ"
  const lines = String(n.body ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const openIn = /p4p\./.test(n.link ?? "") ? "P4P" : /arankub\.com/.test(n.link ?? "") ? "AranKub" : "ระบบ";
  const no = eventNo(ev.key);
  const footer = `${sysName} · ${topic} · ปิดเรื่องนี้ พิมพ์ "ปิด ${no}"`;
  const text = [head, ...lines, n.link ? `👉 เปิดใน ${openIn}: ${n.link}` : null, footer].filter(Boolean).join("\n");
  const html = `<p><font color="#5B3FD9"><b>${sysIcon} ${esc(sysName)}</b></font> · ${esc(topic)}</p>`
    + `<h4>${esc(head)}</h4>`
    + (lines.length ? `<blockquote>${lines.map(esc).join("<br>")}</blockquote>` : "")
    + (n.link ? `<p>👉 <a href="${esc(n.link)}"><b>เปิดใน ${openIn}</b></a></p>` : "")
    + `<p><sub>ไม่อยากรับเรื่องนี้ พิมพ์ "ปิด ${no}" · ดูทั้งหมด พิมพ์ "ตั้งค่า"</sub></p>`;
  return { text, html };
}

/** อัปโหลดรูปการ์ด แล้วส่งเป็นรูป + คำบรรยาย (หัวข้อ + ลิงก์) — คำบรรยายคือข้อความที่เด้งบนจอ */
async function sendImageCard(roomId, c, caption, captionHtml) {
  const { png, w, h } = await renderCard(c);
  const up = await fetch(`${MATRIX}/_matrix/media/v3/upload?filename=card.png`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "image/png" }, body: png,
  });
  const { content_uri } = await up.json();
  if (!up.ok || !content_uri) throw Object.assign(new Error(`upload ${up.status}`), { status: up.status });
  await mx("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txn++}`, {
    msgtype: "m.image", url: content_uri, filename: "card.png",
    // รูปแสดงครึ่งหนึ่งของขนาดจริง (วาดที่ 2x ให้คมบนมือถือ)
    info: { mimetype: "image/png", size: png.length, w: Math.round(w / 2), h: Math.round(h / 2) },
    body: caption, format: "org.matrix.custom.html", formatted_body: captionHtml,
  });
}

// การ์ดแจ้งเตือน: native = การ์ดแบบ LINE ในเว็บ/Desktop (content["com.arankub.card"] → AranCardBody.tsx ใน element-web)
//   + ข้อความ HTML ให้แอปมือถือ/แอปอื่นที่ยังไม่รู้จักการ์ด · image = รูปการ์ดแบบเดิม (ย้อนกลับได้ด้วย CARD_STYLE=image)
const CARD_STYLE = env("CARD_STYLE", "native");
const FIELD_LINE = /^([^:\n]{1,24}):\s+(.+)$/;   // "เกณฑ์วิกฤต: นอกช่วง 2.5–6" → ช่องข้อมูล (เวลา "09:42" ไม่มีช่องว่างหลัง : จึงไม่นับ)

async function sayNativeCard(roomId, ev, n, inChannel) {
  const sys = sysInfo(ev);
  const urgent = n.priority === "urgent";
  const openIn = /p4p\./.test(n.link ?? "") ? "P4P" : /arankub\.com/.test(n.link ?? "") ? "AranKub" : sys.name;
  const no = eventNo(ev.key);
  const fields = [...(n.fields ?? [])], lines = [];
  for (const l of String(n.body ?? "").split("\n").map((x) => x.trim()).filter(Boolean)) {
    const m = l.match(FIELD_LINE);
    if (m) fields.push([m[1].trim(), m[2].trim()]); else lines.push(l);
  }
  const topic = ev.label.replace(/^[^:]+:\s*/, "");
  const color = (sys.colors?.[0] && COLOR.test(sys.colors[0])) ? sys.colors[0] : undefined;
  const head = [urgent ? "🔴 ด่วน" : "", `${ev.icon ?? "🔔"} ${sys.name}`, topic].filter(Boolean).join(" · ");
  const note = inChannel ? "" : `ไม่อยากรับเรื่องนี้ พิมพ์ "ปิด ${no}" · ดูทั้งหมด พิมพ์ "ตั้งค่า"`;
  const x = n.extras ?? {};
  const more = sectionsText(x.sections);
  const links = (x.buttons ?? []).filter((b) => b.type === "link");
  const text = [head, n.title, x.subtitle, ...fields.map(([k, v]) => `${k}: ${v}`), ...lines, ...more, n.link ? `👉 ${n.link}` : "",
    ...links.map((b) => `👉 ${b.label}: ${b.url}`), note].filter(Boolean).join("\n");
  const html = `<b>${esc(head)}</b><br><b>${esc(n.title)}</b>` + (x.subtitle ? `<br>${esc(x.subtitle)}` : "")
    + fields.map(([k, v]) => `<br>${esc(k)}: <b>${esc(v)}</b>`).join("") + lines.map((l) => `<br>${esc(l)}`).join("")
    + more.map((l) => `<br>${esc(l)}`).join("")
    + (n.link ? `<br>👉 <a href="${esc(n.link)}"><b>${esc(n.link_label ?? `แตะเพื่อเปิดใน ${openIn}`)}</b></a>` : "")
    + links.map((b) => `<br>👉 <a href="${esc(b.url)}"><b>${esc(b.label)}</b></a>`).join("")
    + (note ? `<br><sub>${esc(note)}</sub>` : "");
  const content = {
    msgtype: "m.text", body: text, format: "org.matrix.custom.html", formatted_body: html,
    "com.arankub.card": {
      v: 2, system: sys.name, topic, icon: ev.icon ?? "🔔", title: n.title, urgent, fields, lines,
      link: n.link, link_label: n.link ? (n.link_label ?? `เปิดใน ${openIn}`) : undefined,
      // มีปุ่มสั่งงาน (เช่น "รับเคส") = กดแล้วปิดเรื่องแทนปุ่มรับทราบ — ไม่แสดงสองปุ่มที่ทำเหมือนกัน
      ack: urgent && !x.buttons?.some(isActionButton), note: note || undefined, color,
      // รุ่น 2 (cardkit.mjs) — แอปรุ่นเก่าไม่รู้จักช่องเหล่านี้ ก็ยังแสดงส่วนรุ่นแรกได้
      level: x.level, subtitle: x.subtitle, image: x.image,
      sections: x.sections?.length ? x.sections : undefined,
      buttons: x.buttons?.length ? x.buttons : undefined,
      at: Date.now(),
    },
    ...(x.quickReplies?.length ? { "com.arankub.quick_replies": x.quickReplies } : {}),
  };
  const { event_id } = await mx("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txn++}`, content);
  if (x.buttons?.some(isActionButton)) trackAction(n, ev, roomId, event_id, content);
  return event_id;
}

/** อัปโหลดไฟล์เข้า Matrix (รูปในการ์ด) */
async function uploadMedia(buf, type) {
  const up = await fetch(`${MATRIX}/_matrix/media/v3/upload`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": type }, body: buf,
  });
  const { content_uri } = await up.json().catch(() => ({}));
  if (!up.ok || !content_uri) throw new Error(`upload ${up.status}`);
  return content_uri;
}

async function sayCard(roomId, ev, n, inChannel = false) {
  if (CARD_STYLE !== "image") return sayNativeCard(roomId, ev, n, inChannel);
  const sys = sysInfo(ev);
  const openIn = /p4p\./.test(n.link ?? "") ? "P4P" : /arankub\.com/.test(n.link ?? "") ? "AranKub" : sys.name;
  const no = eventNo(ev.key);
  const head = `${n.priority === "urgent" ? "🔴 ด่วน · " : ""}${ev.icon ?? "🔔"} ${n.title}`;
  await sendImageCard(roomId, {
    theme: sys.theme, colors: sys.colors,
    system: sys.name,
    topic: ev.label.replace(/:\s*/, " · ").replace(/^P4P · /, ""),
    title: n.title, body: n.body ?? (n.fields.length ? n.fields.map(([k, v]) => `${k}: ${v}`).join("\n") : undefined), urgent: n.priority === "urgent", at: n.at,
  },
  // ห้องแจ้งเตือน (หลายคน): ไม่มีคำสั่ง "ปิด N" — ไม่อยากรับก็ออกจากห้อง/ปิดเสียงห้อง
  `${head}${n.link ? `\n👉 ${n.link}` : ""}${inChannel ? "" : `\nปิดเรื่องนี้ พิมพ์ "ปิด ${no}"`}`,
  `<b>${esc(head)}</b>${n.link ? `<br>👉 <a href="${esc(n.link)}"><b>แตะเพื่อเปิดใน ${openIn}</b></a>` : ""}`
    + (inChannel ? "" : `<br><sub>ไม่อยากรับเรื่องนี้ พิมพ์ "ปิด ${no}" · ดูทั้งหมด พิมพ์ "ตั้งค่า"</sub>`));
}

/** ส่งแจ้งเตือน 1 เรื่องถึง 1 คน (ตามค่าที่ผู้ใช้เลือก) */
async function deliver(mxid, ev, n) {
  const seen = (state.seen[mxid] ??= []);
  const first = !seen.includes(ev.key);
  if (first) { seen.push(ev.key); save(); }
  if (!wants(mxid, ev)) {
    // เรื่องแบบ "เลือกเปิดรับเอง" (ค่าเริ่มต้นปิด) ครั้งแรกที่มีเรื่องนี้ถึงคนนี้ → บอกวิธีเปิดครั้งเดียว ไม่ส่งเนื้อหา
    if (first && ev.on === false && state.prefs[mxid]?.[ev.key] === undefined) {
      await say(await dmRoom(mxid), `${ev.icon ?? "🔔"} มีแจ้งเตือนเรื่องใหม่ให้เลือกรับ: ${ev.label}\n`
        + `ตอนนี้ยังปิดอยู่ — อยากได้ พิมพ์ "เปิด ${eventNo(ev.key)}" · ดูทุกเรื่อง พิมพ์ "ตั้งค่า"`).catch((e) => log("hint error:", e.message));
    }
    return record(ev, mxid, "off");
  }
  try {
    await deliverNow(mxid, ev, n);
  } catch (e) {
    record(ev, mxid, "error");
    throw e;
  }
  return record(ev, mxid, "sent");
}

/** เก็บประวัติการส่ง (หน้าจัดการ: ส่งถึงใคร สำเร็จไหม ใครปิดรับไว้) */
function record(ev, to, r) {
  state.log.push({ t: new Date().toISOString(), src: ev.key.split(":")[0], ev: ev.key, to, r });
  if (state.log.length > LOG_MAX) state.log.splice(0, state.log.length - LOG_MAX);
  save();
  return r;
}

async function deliverNow(mxid, ev, n) {
  const room = await dmRoom(mxid);
  const send = async (r) => {
    try {
      trackCase(n, ev, r, await sayCard(r, ev, n), mxid);
    } catch (e) {
      if (e.status) throw e;
      // วาดการ์ดไม่สำเร็จ → ส่งเป็นข้อความธรรมดาแทน (แจ้งเตือนต้องถึงเสมอ)
      log("card error:", e.message);
      const { text, html } = card(ev, n);
      await say(r, text, html);
    }
  };
  try {
    await send(room);
  } catch (e) {
    if (e.status !== 403) throw e;
    // ผู้ใช้ออกจากห้องไปแล้ว → เปิดห้องใหม่ (เชิญใหม่) แล้วส่งอีกครั้ง
    delete state.dm[mxid];
    await send(await dmRoom(mxid));
  }
  return "sent";
}

const linkOf = (source, url) => !url ? null : /^https?:\/\//.test(url) ? url : LINKS[source] + (url.startsWith("/") ? url : `/${url}`);

// ── 1. อ่านแจ้งเตือนใหม่จาก AranKub / P4P ────────────────────────────────────────
const SOURCES = {
  arankub: {
    db: arankubDb,
    sql: `select id, "userId" who, kind, title, body, url, "createdAt" ts from notifications
           where audience = 'STAFF' and "userId" is not null and "createdAt" >= $1 order by "createdAt", id limit 500`,
  },
  p4p: {
    db: p4pDb,
    // P4P อัปเดตแจ้งเตือนเรื่องเดิม (refKey) โดยเลื่อน createdAt → ได้แจ้งเตือนอีกครั้งพร้อมข้อความล่าสุด
    sql: `select id, "staffId" who, kind, title, body, href url, "createdAt" ts from "Notification"
           where "createdAt" >= $1 order by "createdAt", id limit 500`,
  },
};

async function pollSource(name) {
  const src = SOURCES[name];
  // เริ่มครั้งแรก: ส่งเฉพาะแจ้งเตือนหลังจากนี้ ไม่ส่งของเก่าย้อนหลังทั้งหมด
  const cur = (state.cursor[name] ??= { ts: new Date().toISOString(), ids: [] });
  const { rows } = await src.db.query(src.sql, [cur.ts]);
  for (const r of rows) {
    const ts = r.ts.toISOString();
    if (ts === cur.ts && cur.ids.includes(r.id)) continue;
    try {
      const mxid = await resolve(`${name}:${r.who}`);
      if (mxid) {
        const ev = eventOf(`${name}:${r.kind}`);
        const res = await deliver(mxid, ev, { title: r.title, body: r.body, link: linkOf(name, r.url), at: r.ts });
        log(name, r.kind, mxid, res);
      }
    } catch (e) {
      log(name, "ส่งไม่สำเร็จ — ลองใหม่รอบหน้า", r.id, e.message);
      break;  // ไม่เลื่อน cursor ผ่านแถวที่ยังส่งไม่ได้
    }
    if (ts !== cur.ts) { cur.ts = ts; cur.ids = []; }
    cur.ids.push(r.id);
    save();
  }
}

// ── SOS จากประชาชน (หน้า /sos ของ AranKub) → ห้องแจ้งเหตุ ทุกคนในห้องเห็นพร้อมกัน ───────────
// ห้องไม่เข้ารหัส → ส่งเฉพาะประเภท/พื้นที่/จำนวนคน ส่วนชื่อ เบอร์โทร พิกัด ให้กดลิงก์ไปดูใน AranKub (ต้อง login)
const SOS_ROOM = env("SOS_ROOM_ALIAS", "#sos");
const SOS_KINDS = { MEDICINE: "💊 ยาประจำตัวหมด", MEDICAL: "🩺 เจ็บป่วย ต้องพบหมอ", FOOD: "🍚 ขาดอาหาร/น้ำดื่ม", EVACUATE: "🚤 ต้องการอพยพออก", OTHER: "❓ เรื่องอื่น ๆ" };
let sosRoomId = null;
async function pollSos() {
  sosRoomId ??= (await mx("GET", `/_matrix/client/v3/directory/room/${encodeURIComponent(`${SOS_ROOM}:${serverName}`)}`)).room_id;
  const cur = (state.cursor.sos ??= { ts: new Date().toISOString(), ids: [] });
  const { rows } = await arankubDb.query(
    `select id, "refCode", kind, kinds, "peopleCount", vulnerable, tambon, "otherText", "createdAt" ts
       from emg_requests where "createdAt" >= $1 order by "createdAt", id limit 100`, [cur.ts]);
  for (const r of rows) {
    const ts = r.ts.toISOString();
    if (ts === cur.ts && cur.ids.includes(r.id)) continue;
    const kinds = (r.kinds?.length ? r.kinds : [r.kind]).map((k) => SOS_KINDS[k] ?? k).join(", ");
    const facts = [
      r.tambon && `ต.${r.tambon}`,
      r.peopleCount && `${r.peopleCount} คน`,
      r.vulnerable && "มีกลุ่มเปราะบาง (ผู้สูงอายุ/ผู้ป่วยติดเตียง/เด็ก)",
      r.otherText,
    ].filter(Boolean).join(" · ");
    const link = `${LINKS.arankub}/emergency/requests`;
    const caption = `@room 🆘 SOS ใหม่ ${r.refCode}: ${kinds}${facts ? `\n${facts}` : ""}\n👉 ${link}`;
    const captionHtml = `@room <b>🆘 SOS ใหม่ ${esc(r.refCode)}</b>: ${esc(kinds)}${facts ? `<br>${esc(facts)}` : ""}<br>👉 <a href="${link}"><b>แตะเพื่อดูรายละเอียด / รับเรื่อง</b></a>`;
    // ชื่อประเภทในรูปตัด emoji ออก (วาด emoji ในรูปไม่ได้)
    const plainKinds = kinds.replace(/\p{Extended_Pictographic}\uFE0F?\s*/gu, "");
    await sendImageCard(sosRoomId, {
      theme: "sos", system: "แจ้งเหตุ SOS", topic: `คำขอความช่วยเหลือ · ${r.refCode}`,
      title: plainKinds, body: facts.replace(/ · /g, "\n"), urgent: true, at: r.ts,
    }, caption, captionHtml).catch(async (e) => {
      log("sos card error:", e.message);
      await say(sosRoomId, caption, captionHtml);
    });
    log("sos", r.refCode);
    if (ts !== cur.ts) { cur.ts = ts; cur.ids = []; }
    cur.ids.push(r.id);
    save();
  }
}

async function pollLoop() {
  // ระบบที่ admin ปิดไว้: ข้าม และเลื่อนตำแหน่งอ่านมาที่ปัจจุบัน — เปิดใหม่จะไม่ส่งของที่ค้างระหว่างปิดทีเดียวทั้งหมด
  const skip = (name) => { state.cursor[name] = { ts: new Date().toISOString(), ids: [] }; };
  for (const name of Object.keys(SOURCES)) {
    if (!sourceOn(name)) { skip(name); continue; }
    await pollSource(name).catch((e) => log(name, "poll error:", e.message));
  }
  if (sourceOn("sos")) await pollSos().catch((e) => log("sos poll error:", e.message));
  else skip("sos");
  setTimeout(pollLoop, POLL_MS);
}

// ── 2. คำสั่งจากผู้ใช้ในแชทกับ bot ───────────────────────────────────────────────
function settingsText(mxid) {
  const keys = new Set(state.seen[mxid] ?? []);
  const list = eventList().filter((e) => keys.has(e.key));
  if (!list.length) return "ยังไม่เคยมีแจ้งเตือนถึงคุณ — เมื่อได้รับเรื่องไหนแล้ว จะเปิด/ปิดเรื่องนั้นได้ที่นี่";
  return "เรื่องที่แจ้งเตือนถึงคุณ:\n"
    + list.map((e) => `${eventNo(e.key)}. ${e.mandatory ? "🔒" : wants(mxid, e) ? "✅" : "⛔"} ${e.label}`).join("\n")
    + "\n\nปิด: พิมพ์ \"ปิด 3\" · เปิด: พิมพ์ \"เปิด 3\" (หลายเรื่อง: \"ปิด 2 5 7\")";
}

async function onMessage(roomId, sender, body) {
  if (state.dm[sender] !== roomId) return;  // ตอบเฉพาะในห้องแชทส่วนตัวของคนนั้น
  const t = body.trim();
  const m = t.match(/^(ปิด|เปิด)\s+([\d\s,]+)$/);
  if (m) {
    const on = m[1] === "เปิด";
    const done = [];
    for (const no of m[2].split(/[\s,]+/).filter(Boolean).map(Number)) {
      const e = eventList()[no - 1];
      if (!e) continue;
      if (e.mandatory && !on) { done.push(`🔒 ${e.label} — เรื่องนี้ผู้ดูแลระบบกำหนดให้ทุกคนต้องรับ`); continue; }
      (state.prefs[sender] ??= {})[e.key] = on;
      done.push(`${on ? "✅" : "⛔"} ${e.label}`);
    }
    save();
    await say(roomId, done.length ? `${on ? "เปิด" : "ปิด"}แล้ว:\n${done.join("\n")}` : "ไม่พบหมายเลขนี้ — พิมพ์ \"ตั้งค่า\" เพื่อดูรายการ");
    return;
  }
  await say(roomId, settingsText(sender) + "\n\n📄 ส่งรูปหรือ PDF เอกสารมาที่ห้องนี้ ผมจะอ่านข้อความออกมาให้"
    + "\n🎙 ส่งไฟล์เสียง/วิดีโอบันทึกประชุมมา ผมจะถอดเป็นข้อความพร้อมสรุปประเด็น มติ และงานที่ต้องทำ");
}

let since = state.since ?? null;
const SYNC_FILTER = encodeURIComponent(JSON.stringify({
  presence: { types: [] }, account_data: { types: [] },
  room: { timeline: { limit: 50, types: ["m.room.message", "m.room.member", "m.reaction", "m.room.encrypted"] }, state: { types: [] }, ephemeral: { types: [] } },
}));
async function syncLoop() {
  try {
    const first = !since;
    const r = await mx("GET", `/_matrix/client/v3/sync?timeout=30000&filter=${SYNC_FILTER}${since ? `&since=${since}` : ""}`);
    since = r.next_batch;
    state.since = since;
    save();
    if (!first) {
      const me = `@aranchat:${serverName}`;
      // ผู้ใช้เปิดแชทกับ bot เอง → รับคำเชิญ แล้วใช้เป็นห้องแชทส่วนตัวของคนนั้น
      for (const [roomId, inv] of Object.entries(r.rooms?.invite ?? {})) {
        const ev = inv.invite_state?.events?.find((e) => e.type === "m.room.member" && e.state_key === me);
        if (!ev?.sender || state.dm[ev.sender]) continue;
        await mx("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {});
        state.dm[ev.sender] = roomId;
        save();
        await say(roomId, WELCOME);
      }
      for (const [roomId, room] of Object.entries(r.rooms?.join ?? {})) {
        for (const ev of room.timeline?.events ?? []) {
          if (ev.sender === me) continue;
          // ผู้ใช้เปิดเข้ารหัสในแชทกับบอท → บอทอ่านไม่ได้ (ไม่มีกุญแจ) · ปิดเข้ารหัสย้อนหลังไม่ได้ → ย้ายไปห้องใหม่
          if (ev.type === "m.room.encrypted") {
            if (state.dm[ev.sender] === roomId) await moveEncryptedDm(ev.sender, roomId).catch((e) => log("move dm error:", e.message));
            continue;
          }
          // กดปุ่มสั่งงานบนการ์ด (ไม่ await — webhook ของระบบต้นทางอาจช้า อย่าให้ข้อความอื่นค้าง)
          if (isCardAction(ev)) { onCardAction(roomId, ev).catch((e) => log("card action error:", e.message)); continue; }
          // คำตอบของปุ่มที่ถามก่อน (เช่น เหตุผลที่ตีกลับ)
          if (onAskAnswer(roomId, ev)) continue;
          // คำสั่ง /… (ไม่ await — รอ webhook ของระบบเจ้าของคำสั่ง)
          const cmd = ev.type === "m.room.message" && ev.content?.msgtype === "m.text" ? parseCommand(ev.content.body) : null;
          if (cmd) { onCommand(roomId, ev, cmd).catch((e) => log("command error:", e.message)); continue; }
          if (onAck(roomId, ev)) continue;
          if (ev.type === "m.reaction") continue;
          // รูป/PDF → OCR (ไม่ await — PDF หลายหน้าใช้เวลา อย่าให้แจ้งเตือนอื่นค้างรอ)
          if (ev.type === "m.room.message" && ["m.image", "m.file", "m.video", "m.audio"].includes(ev.content?.msgtype)) {
            onFileMessage(roomId, ev).catch((e) => log("ocr reply error:", e.message));
            continue;
          }
          if (ev.type === "m.room.message" && typeof ev.content?.body === "string") {
            await onMessage(roomId, ev.sender, ev.content.body).catch((e) => log("command error:", e.message));
          }
          // ผู้ใช้ออกจากห้อง → bot ออกตาม (แจ้งเตือนครั้งหน้าจะเปิดห้องใหม่)
          if (ev.type === "m.room.member" && ev.state_key === ev.sender && ev.content?.membership === "leave" && state.dm[ev.sender] === roomId) {
            delete state.dm[ev.sender];
            save();
            await mx("POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/leave`, {}).catch(() => {});
          }
        }
      }
    }
  } catch (e) {
    log("sync error:", e.message);
    await new Promise((r) => setTimeout(r, 5000));
  }
  setImmediate(syncLoop);
}

// ── เรื่องด่วนแบบปิดงานได้ (เช่น ค่าวิกฤตแล็บ) ────────────────────────────────────────
// การ์ดด่วนมีปุ่ม "รับทราบ" (= reaction ✅ รับทราบ · element-web AranCardBody.tsx / Android TimelineItemAranCardView.kt)
// หรือตอบกลับการ์ดว่า "รับทราบ…" / พิมพ์ "รับทราบ…" ในห้องแจ้งเตือน (ปิดเรื่องล่าสุดที่ยังค้างในห้องนั้น)
// ไม่มีใครรับทราบใน CRIT_REMIND_MIN นาที → เตือนซ้ำในห้องเดิม · CRIT_ESCALATE_MIN นาที → ส่งต่อผู้รับ "ส่งต่อ" ของเรื่อง (หน้าจัดการ)
const ACK_KEY = "✅ รับทราบ";
const REMIND_MIN = Number(env("CRIT_REMIND_MIN", "15"));
const ESCALATE_MIN = Number(env("CRIT_ESCALATE_MIN", "30"));
const CASE_KEEP_DAYS = 90;
const ackIndex = new Map();   // eventId → ref
for (const [ref, c] of Object.entries(state.cases)) for (const e of c.events) ackIndex.set(e.eventId, ref);

function trackCase(n, ev, roomId, eventId, to) {
  if (n.priority !== "urgent" || !eventId) return;
  const c = (state.cases[n.ref] ??= { ev: ev.key, title: n.title, fields: n.fields ?? [], at: new Date().toISOString(), events: [] });
  c.events.push({ eventId, roomId, to });
  c.src ??= n.src;
  c.extId ??= n.extId;
  ackIndex.set(eventId, n.ref);
  save();
}

function closeCase(ref, by, how) {
  const c = state.cases[ref];
  if (!c || c.by) return false;
  c.by = by;
  c.ackAt = new Date().toISOString();
  c.how = how;
  save();
  log("รับทราบ:", c.ev, ref, "โดย", by, `(${Math.round((Date.parse(c.ackAt) - Date.parse(c.at)) / 60000)} นาที)`);
  // แจ้งระบบต้นทางว่ามีคนรับทราบแล้ว (ถ้าระบบตั้ง webhook ไว้) — ไม่รอผล
  const src = c.src ?? c.ev.split(":")[0];
  if (how !== "action" && state.webhooks[src]?.url) {
    whoIs(by).then((user) => hookCall(src, {
      type: "ack", event: c.ev.split(":").slice(1).join(":"), id: c.extId ?? null, ref, how, user, at: c.ackAt,
    })).catch((e) => log("ack webhook:", e.message));
  }
  return true;
}

// ── ปุ่มสั่งงานบนการ์ด (การ์ดรุ่น 2 · cardkit.mjs) ───────────────────────────────────────
const actionIndex = new Map();   // eventId → ref
for (const [ref, a] of Object.entries(state.actions)) for (const e of a.events) actionIndex.set(e.eventId, ref);
const ACTION_KEEP_DAYS = 30;
const busy = new Set();          // ref ที่กำลังเรียก webhook (กันกดซ้ำพร้อมกัน)

function trackAction(n, ev, roomId, eventId, content) {
  const a = (state.actions[n.ref] ??= {
    src: n.src ?? ev.key.split(":")[0], ev: ev.key, extId: n.extId ?? null, approvers: n.extras?.approvers ?? [],
    content, events: [], closed: false, at: new Date().toISOString(),
  });
  a.events.push({ roomId, eventId });
  actionIndex.set(eventId, n.ref);
  save();
}

/** ชื่อ + รหัส AranKub ของผู้ใช้ (ส่งให้ระบบต้นทางตรวจสิทธิ์เอง) */
async function whoIs(mxid) {
  const name = await mx("GET", `/_matrix/client/v3/profile/${encodeURIComponent(mxid)}/displayname`).then((r) => r.displayname).catch(() => null);
  const arankub = [...mxidByArankub].find(([, m]) => m === mxid)?.[0] ?? null;
  return { mxid, name: name ?? mxid, arankub };
}

async function hookCall(src, payload) {
  const hook = state.webhooks[src];
  if (!hook?.url) return null;
  const r = await callWebhook(hook, payload);
  if (r.ok) { hook.lastOkAt = new Date().toISOString(); hook.lastError = null; }
  else hook.lastError = { at: new Date().toISOString(), status: r.status, error: r.error ?? r.data?.error ?? null };
  save();
  return r;
}

/** แก้การ์ดเดิมทุกห้องที่ส่งเรื่องนี้ไป: แสดงผล + ซ่อนปุ่มสั่งงาน */
async function updateActionCards(ref) {
  const a = state.actions[ref];
  const card = { ...a.content["com.arankub.card"], status: a.status, closed: a.closed };
  const statusLine = a.status ? `\n${a.closed ? "✔" : "•"} ${a.status.text}` : "";
  const content = { ...a.content, body: a.content.body + statusLine,
    formatted_body: a.content.formatted_body + (a.status ? `<br><b>${esc(a.status.text)}</b>` : ""), "com.arankub.card": card };
  for (const e of a.events) {
    await mx("PUT", `${roomPath(e.roomId)}/send/m.room.message/${txn++}`, {
      msgtype: "m.text", body: `* ${content.body}`,
      "m.new_content": content,
      "m.relates_to": { rel_type: "m.replace", event_id: e.eventId },
    }).catch((err) => log("update card:", ref, err.message));
  }
}

/** ข้อความในห้อง = การกดปุ่มสั่งงานไหม (true = ใช่ ไม่ต้องทำอย่างอื่นต่อ) */
/** "2026-11-20T18:30" → "20 พ.ย. 69 18:30" */
function thaiDateTime(v) {
  const [d, tm] = v.includes("T") ? v.split("T") : /^\d{2}:/.test(v) ? [null, v] : [v, null];
  const date = d ? new Date(`${d}T00:00:00+07:00`).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit" }) : "";
  return [date, tm ? `${tm} น.` : ""].filter(Boolean).join(" ");
}

function isCardAction(ev) {
  return ev.type === "m.room.message" && !!ev.content?.["com.arankub.card_action"];
}

async function onCardAction(roomId, ev) {
  const act = ev.content["com.arankub.card_action"];
  const ref = actionIndex.get(String(act?.event_id ?? ""));
  const a = ref && state.actions[ref];
  const answer = replier(roomId, ev.event_id);
  if (!a || !a.events.some((e) => e.roomId === roomId)) return;                     // การ์ดที่ส่งต่อไปห้องอื่น / ไม่รู้จัก
  const button = a.content["com.arankub.card"].buttons?.find((b) => isActionButton(b) && b.id === act.id);
  if (!button) return;
  // ปุ่มเลือกวันเวลา: ค่ามาจากเครื่องผู้ใช้ → ตรวจรูปแบบ + ช่วง min/max
  let value = null;
  if (button.type === "datetime") {
    value = String(act.value ?? "");
    if (!DT_MODES[button.mode].test(value) || (button.min && value < button.min) || (button.max && value > button.max)) {
      return void answer("วันเวลาที่เลือกไม่ถูกต้อง ลองเลือกใหม่อีกครั้ง");
    }
  }
  if (!canDecide(a, ev.sender, answer)) return;
  // ปุ่มที่ถามก่อน (เช่น ตีกลับต้องมีเหตุผล): ถามในห้อง แล้วรอข้อความถัดไปของผู้กด
  if (button.type === "action" && button.ask) {
    asking.set(`${roomId}|${ev.sender}`, { ref, buttonId: button.id, until: Date.now() + ASK_MINUTES * 60_000 });
    const options = button.ask.options.map((o) => ({ label: o.slice(0, 24), text: o }));
    return void answer(`${button.ask.prompt}\nพิมพ์ตอบได้เลย หรือกดเหตุผลด้านล่าง (ภายใน ${ASK_MINUTES} นาที)`,
      { "com.arankub.quick_replies": [...options, { label: "ยกเลิก", text: "ยกเลิก" }].slice(0, 6) });
  }
  await decide(roomId, ev, ref, button, value, answer);
}

const ASK_MINUTES = 15;
const asking = new Map();        // "<roomId>|<mxid>" → { ref, buttonId, until } รอคำตอบของปุ่มที่ถามก่อน

/** ข้อความ = คำตอบของปุ่มที่ถามไว้ไหม (true = ใช่ จัดการแล้ว) */
function onAskAnswer(roomId, ev) {
  if (ev.type !== "m.room.message" || ev.content?.msgtype !== "m.text") return false;
  const key = `${roomId}|${ev.sender}`;
  const q = asking.get(key);
  if (!q) return false;
  // ตัดส่วนอ้างข้อความเดิม (กรณีกดตอบกลับ) ออก
  const text = String(ev.content.body ?? "").replace(/^(>.*\n)+\n?/, "").trim();
  if (text.startsWith("/")) { asking.delete(key); return false; }                       // พิมพ์คำสั่งอื่น = เลิกถาม
  asking.delete(key);
  const answer = replier(roomId, ev.event_id);
  if (Date.now() > q.until) return void answer("หมดเวลาตอบแล้ว — กดปุ่มบนการ์ดใหม่อีกครั้ง"), true;
  if (/^ยกเลิก$/.test(text)) return void answer("ยกเลิกแล้ว"), true;
  if (text.length < 3) {
    asking.set(key, q);
    return void answer("ช่วยพิมพ์เหตุผลให้ชัดอีกนิด (อย่างน้อย 3 ตัวอักษร) หรือพิมพ์ ยกเลิก"), true;
  }
  const a = state.actions[q.ref];
  const button = a?.content["com.arankub.card"].buttons?.find((b) => b.id === q.buttonId);
  if (!button) return void answer("ไม่พบการ์ดนี้แล้ว"), true;
  if (!canDecide(a, ev.sender, answer)) return true;
  decide(roomId, ev, q.ref, button, text.slice(0, 500), answer).catch((e) => log("card action error:", e.message));
  return true;
}

function replier(roomId, eventId) {
  return (text, extra = {}) => mx("PUT", `${roomPath(roomId)}/send/m.room.message/${txn++}`,
    { msgtype: "m.notice", body: text, ...extra, "m.relates_to": { "m.in_reply_to": { event_id: eventId } } });
}

function canDecide(a, sender, answer) {
  if (a.closed) return void answer(`รายการนี้ปิดไปแล้ว${a.status ? `: ${a.status.text}` : ""}`), false;
  if (a.approvers.length && !a.approvers.includes(sender)) return void answer("คุณไม่มีสิทธิ์ตัดสินรายการนี้ — ผู้มีสิทธิ์ตามที่ระบบกำหนดเท่านั้น"), false;
  return true;
}

/** ส่งการตัดสินไปยังระบบต้นทาง (webhook) แล้วแก้การ์ดทุกห้อง */
async function decide(roomId, ev, ref, button, value, answer) {
  const a = state.actions[ref];
  if (busy.has(ref)) return;
  busy.add(ref);
  try {
    const user = await whoIs(ev.sender);
    const at = new Date().toISOString();
    const time = new Date(at).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });
    const shown = value ? `: ${button.type === "datetime" ? thaiDateTime(value) : value}` : "";
    const fallback = { text: `${button.label}${shown} · ${user.name} · ${time} น.`, tone: button.style === "danger" ? "crit" : "ok" };
    let close = true, status = fallback, reply = null;
    if (state.webhooks[a.src]?.url) {
      const r = await hookCall(a.src, {
        type: "action", event: a.ev.split(":").slice(1).join(":"), id: a.extId, ref, action: button.id, label: button.label, value, user, at,
      });
      if (!r.ok) {
        log("action webhook:", a.src, ref, r.status, r.error ?? "");
        return void answer(`ส่งไปยังระบบต้นทางไม่สำเร็จ (${r.error ?? r.status}) — ลองกดใหม่อีกครั้ง`);
      }
      close = r.data.close !== false;
      status = cleanStatus(r.data.status, close ? fallback : undefined);
      reply = typeof r.data.reply === "string" ? r.data.reply.slice(0, 1000) : null;
    }
    a.status = status;
    if (close) { a.closed = true; a.by = ev.sender; a.action = button.id; a.decidedAt = at; }
    save();
    log("กดปุ่ม:", a.ev, ref, button.id, "โดย", ev.sender, close ? "(ปิดรายการ)" : "");
    if (close && state.cases[ref]) closeCase(ref, ev.sender, "action");
    await updateActionCards(ref);
    if (reply) await answer(reply);
  } finally {
    busy.delete(ref);
  }
}

setInterval(() => {
  const old = Date.now() - ACTION_KEEP_DAYS * 86400_000;
  for (const [ref, a] of Object.entries(state.actions)) {
    if (Date.parse(a.at) < old) { for (const e of a.events) actionIndex.delete(e.eventId); delete state.actions[ref]; save(); }
  }
}, 3600_000);

/** เหตุการณ์ในห้อง = การรับทราบเรื่องด่วนไหม (true = ใช่ ไม่ต้องทำอย่างอื่นต่อ) */
function onAck(roomId, ev) {
  const rel = ev.content?.["m.relates_to"];
  if (ev.type === "m.reaction" && rel?.rel_type === "m.annotation" && rel.key === ACK_KEY) {
    const ref = ackIndex.get(rel.event_id);
    return ref ? (closeCase(ref, ev.sender, "button"), true) : false;
  }
  if (ev.type !== "m.room.message" || !/^\s*(?:>.*\n+)*\s*รับทราบ/.test(String(ev.content?.body ?? ""))) return false;
  const replyTo = rel?.["m.in_reply_to"]?.event_id;
  let ref = replyTo ? ackIndex.get(replyTo) : undefined;
  if (!ref && Object.values(state.channels).some((ch) => ch.roomId === roomId)) {
    // พิมพ์ "รับทราบ" ในห้องแจ้งเตือน → เรื่องล่าสุดที่ยังค้างในห้องนี้
    ref = Object.entries(state.cases).filter(([, c]) => !c.by && c.events.some((e) => e.roomId === roomId))
      .sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at))[0]?.[0];
  }
  if (!ref) return false;
  closeCase(ref, ev.sender, replyTo ? "reply" : "text");
  return state.dm[ev.sender] !== roomId;   // ในแชทส่วนตัวกับ bot ยังตอบคำสั่งตามปกติ
}

async function followUpCases() {
  const now = Date.now();
  for (const [ref, c] of Object.entries(state.cases)) {
    const age = (now - Date.parse(c.at)) / 60000;
    if (age > CASE_KEEP_DAYS * 1440) { for (const e of c.events) ackIndex.delete(e.eventId); delete state.cases[ref]; save(); continue; }
    if (c.by) continue;
    const ev = eventOf(c.ev);
    // ตั้งแยกรายเรื่องได้ในหน้าจัดการ: ปิดการติดตาม / เปลี่ยนจำนวนนาที
    if (ev.followUp === false) continue;
    const remindMin = ev.remindMin ?? REMIND_MIN;
    const escalateMin = ev.escalateMin ?? ESCALATE_MIN;
    try {
      if (!c.reminded && age >= remindMin) {
        c.reminded = new Date().toISOString();
        save();
        for (const e of c.events) {
          await mx("PUT", `${roomPath(e.roomId)}/send/m.room.message/${txn++}`, {
            msgtype: "m.text",
            body: `⏰ ยังไม่มีผู้รับทราบ (${remindMin} นาที): ${c.title}\nกด "รับทราบ" ที่การ์ด หรือตอบกลับว่า "รับทราบ"`,
            format: "org.matrix.custom.html",
            formatted_body: `⏰ <b>ยังไม่มีผู้รับทราบ (${remindMin} นาที)</b>: ${esc(c.title)}<br>กด "รับทราบ" ที่การ์ด หรือตอบกลับว่า "รับทราบ"`,
            "m.relates_to": { "m.in_reply_to": { event_id: e.eventId } },
          });
        }
        log("เตือนซ้ำ:", c.ev, ref);
      }
      if (!c.escalated && age >= escalateMin) {
        c.escalated = new Date().toISOString();
        save();
        const to = ev.escalate ?? [];
        const n = {
          title: `ส่งต่อ: ยังไม่มีผู้รับทราบ ${escalateMin} นาที — ${c.title}`, fields: c.fields, priority: "urgent", ref,
        };
        for (const t of to) await deliverTo(t, ev, n).catch((e) => log("escalate error:", t, e.message));
        log("ส่งต่อ:", c.ev, ref, to.length ? to.join(",") : "(ยังไม่ได้ตั้งผู้รับส่งต่อ)");
      }
    } catch (e) {
      log("follow-up error:", ref, e.message);
    }
  }
}
setInterval(() => void followUpCases(), 60_000);


// ── คำสั่ง / และเมนูบอท (รอบ 2) ─────────────────────────────────────────────────────
// ระบบลงทะเบียนคำสั่งของตัวเองด้วย PUT /api/notify/bot · ผู้ใช้พิมพ์ /<คำสั่ง> ในแชทกับบอทหรือห้องแจ้งเตือน
//   → notify เรียก webhook ของระบบเจ้าของคำสั่ง { type: "command", command, args, user, room }
//   → ระบบตอบ { reply, quick_replies, card } — card ใช้รูปแบบเดียวกับ POST /api/notify (ไม่ต้องใส่ event/to)
// แอปอ่านรายการคำสั่ง/เมนูจาก GET /api/notify/bot (สาธารณะ) → แสดงรายการคำสั่งตอนพิมพ์ / และเมนูใต้ช่องพิมพ์
const CMD = /^[a-z][a-z0-9_]{0,31}$/;
const BUILTIN_CMDS = [
  { command: "help", description: "ดูคำสั่งทั้งหมด" },
  { command: "settings", description: "เลือกเรื่องที่จะรับแจ้งเตือน" },
];
const BUILTIN_MENU = [
  { label: "⚙️ ตั้งค่าแจ้งเตือน", type: "text", text: "/settings" },
  { label: "❓ คำสั่งทั้งหมด", type: "text", text: "/help" },
];
const MENU_MAX = 8;

function cleanMenu(v) {
  return (Array.isArray(v) ? v : []).slice(0, MENU_MAX).map((m) => {
    const label = String(m?.label ?? "").slice(0, 24).trim();
    if (!label) return null;
    if (m.type === "link" && /^https?:\/\//.test(String(m.url ?? ""))) return { label, type: "link", url: String(m.url).slice(0, 2000) };
    if (m.type === "app" && /^https:\/\//.test(String(m.url ?? ""))) return { label, type: "app", url: String(m.url).slice(0, 2000) };
    // prefill = ใส่ข้อความลงช่องพิมพ์ให้พิมพ์ต่อ (เช่น "/lab " รอ HN) · ไม่ใส่ = กดแล้วส่งเลย
    const raw = String(m.text ?? "").slice(0, 200);
    const text = raw.trim();
    const prefill = m.prefill === true || /\s$/.test(raw);
    return text ? { label, type: "text", text: prefill ? `${text} ` : text, ...(prefill ? { prefill: true } : {}) } : null;
  }).filter(Boolean);
}

/** คำสั่ง + เมนูทั้งหมด (ระบบที่ปิดใช้งานไม่นับ) */
function botInfo() {
  const commands = [...BUILTIN_CMDS], menu = [...BUILTIN_MENU];
  for (const [src, b] of Object.entries(state.bots)) {
    if (!sourceOn(src)) continue;
    const system = state.sources[src]?.name ?? src;
    for (const c of b.commands ?? []) commands.push({ ...c, system });
    for (const m of b.menu ?? []) if (menu.length < MENU_MAX) menu.push(m);
  }
  return { commands, menu };
}
const commandOwner = (cmd) => Object.entries(state.bots).find(([src, b]) => sourceOn(src) && b.commands?.some((c) => c.command === cmd))?.[0] ?? null;

//   PUT    /api/notify/bot  { commands: [{ command: "lab", description: "ดูผลแล็บล่าสุด", usage: "/lab <HN>" }], menu: [{ label, type: "text"|"link"|"app", text|url }] }
//   GET    /api/notify/bot  (ใช้ key ของระบบ = ที่ระบบนี้ลงทะเบียน · ไม่มี key = รายการรวมที่แอปใช้)
//   DELETE /api/notify/bot
function handleBotApi(src, method, body) {
  if (method === "GET") return [200, state.bots[src] ?? { commands: [], menu: [] }];
  if (method === "DELETE") { delete state.bots[src]; save(); return [200, { ok: true }]; }
  if (method !== "PUT") return [405, { error: "ใช้ GET / PUT / DELETE" }];
  const commands = [], taken = new Set(BUILTIN_CMDS.map((c) => c.command));
  for (const c of (Array.isArray(body?.commands) ? body.commands : []).slice(0, 20)) {
    const command = String(c?.command ?? "").replace(/^\//, "").toLowerCase();
    if (!CMD.test(command)) return [400, { error: `คำสั่ง "${command}" ใช้ a-z 0-9 _ ขึ้นต้นด้วยตัวอักษร (ไม่เกิน 32 ตัว)` }];
    if (taken.has(command)) return [409, { error: `คำสั่ง /${command} ซ้ำกับคำสั่งพื้นฐานหรือซ้ำในรายการ` }];
    const owner = commandOwner(command);
    if (owner && owner !== src) return [409, { error: `คำสั่ง /${command} ระบบ "${state.sources[owner]?.name ?? owner}" ใช้อยู่แล้ว` }];
    taken.add(command);
    commands.push({ command, description: String(c.description ?? "").slice(0, 80), usage: c.usage ? String(c.usage).slice(0, 80) : undefined });
  }
  state.bots[src] = { commands, menu: cleanMenu(body?.menu), at: new Date().toISOString() };
  save();
  log("ลงทะเบียนคำสั่ง:", src, commands.map((c) => "/" + c.command).join(" ") || "(ไม่มี)", `เมนู ${state.bots[src].menu.length}`);
  return [200, { ok: true, ...state.bots[src], webhook: !!state.webhooks[src]?.url }];
}

/** "/lab 0012345" → { command: "lab", args: "0012345" } · "/lab@aranchat …" ก็ได้ */
function parseCommand(body) {
  const m = String(body ?? "").trim().match(/^\/([a-zA-Z][a-zA-Z0-9_]{0,31})(?:@\S+)?(?:\s+([\s\S]*))?$/);
  return m ? { command: m[1].toLowerCase(), args: (m[2] ?? "").trim().slice(0, 500) } : null;
}

const lastCommand = new Map();   // mxid → เวลา (กันพิมพ์รัว)
async function onCommand(roomId, ev, { command, args }) {
  const reply = (content) => mx("PUT", `${roomPath(roomId)}/send/m.room.message/${txn++}`, {
    msgtype: "m.notice", ...content, "m.relates_to": { "m.in_reply_to": { event_id: ev.event_id } },
  });
  const isDm = state.dm[ev.sender] === roomId;
  const channel = Object.entries(state.channels).find(([, c]) => c.roomId === roomId)?.[0] ?? null;
  if (!isDm && !channel) return;
  if (Date.now() - (lastCommand.get(ev.sender) ?? 0) < 1500) return;
  lastCommand.set(ev.sender, Date.now());
  if (command === "help") {
    const { commands } = botInfo();
    const lines = commands.map((c) => `/${c.command}${c.usage ? ` — ${c.usage.replace(/^\/\S+\s*/, "")}` : ""}  ${c.description}${c.system ? ` (${c.system})` : ""}`);
    return void reply({ body: `คำสั่งที่ใช้ได้:\n${lines.join("\n")}`, "com.arankub.quick_replies": [{ label: "⚙️ ตั้งค่า", text: "/settings" }] });
  }
  if (command === "settings") {
    return void reply({ body: isDm ? settingsText(ev.sender) : "ตั้งค่าแจ้งเตือนได้ในแชทส่วนตัวกับ AranChat แจ้งเตือน" });
  }
  const src = commandOwner(command);
  if (!src) return void reply({ body: `ไม่รู้จักคำสั่ง /${command} — พิมพ์ /help เพื่อดูคำสั่งทั้งหมด`, "com.arankub.quick_replies": [{ label: "❓ คำสั่งทั้งหมด", text: "/help" }] });
  if (!state.webhooks[src]?.url) return void reply({ body: `คำสั่ง /${command} ยังใช้ไม่ได้ (ระบบ ${state.sources[src]?.name ?? src} ยังไม่ได้ตั้ง webhook)` });
  const user = await whoIs(ev.sender);
  const r = await hookCall(src, { type: "command", command, args, user, room: { id: roomId, kind: isDm ? "dm" : "channel", channel }, at: new Date().toISOString() });
  if (!r.ok) return void reply({ body: `ระบบ ${state.sources[src]?.name ?? src} ไม่ตอบ (${r.error ?? r.status}) — ลองใหม่อีกครั้ง` });
  const quick = cleanQuickReplies(r.data.quick_replies);
  if (r.data.card && typeof r.data.card === "object") {
    const card = { ...r.data.card, title: r.data.card.title ?? `/${command}`, quick_replies: r.data.card.quick_replies ?? r.data.quick_replies };
    const made = await makeNotice(src, card);
    if (made.error) return void reply({ body: `ระบบตอบการ์ดไม่ถูกรูปแบบ: ${made.error}` });
    made.n.priority = "normal";   // คำตอบคำสั่งไม่ใช่เรื่องด่วนที่ต้องติดตาม
    await sayNativeCard(roomId, { key: `${src}:cmd.${command}`, label: `คำสั่ง /${command}`, icon: "⌨️" }, made.n, true);
  }
  if (typeof r.data.reply === "string" && r.data.reply.trim()) {
    await reply({ body: r.data.reply.slice(0, 2000), ...(quick.length && !r.data.card ? { "com.arankub.quick_replies": quick } : {}) });
  }
}

// มินิแอป: แอปเปิดหน้าเว็บพร้อม #aranchat_openid=<token>&aranchat_server=<เซิร์ฟเวอร์> → ระบบหลังบ้านถามว่าใครเปิด
//   POST /api/notify/miniapp/whoami  { "token": "<aranchat_openid>" }  (ใช้ key ของระบบ) → { mxid, name, arankub }
async function miniappWhoami(body) {
  const token = String(body?.token ?? body?.openid?.access_token ?? "");
  if (!/^[\w\-.~+/=]{8,256}$/.test(token)) return [400, { error: "ต้องมี token" }];
  const r = await fetch(`${MATRIX}/_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10_000) });
  const sub = r.ok ? (await r.json().catch(() => ({}))).sub : null;
  if (!sub) return [401, { error: "token ไม่ถูกต้องหรือหมดอายุ (อายุประมาณ 1 ชั่วโมง)" }];
  await refreshMaps().catch(() => {});
  return [200, await whoIs(sub)];
}

/** API ที่ใช้ key ของระบบ (นอกจากส่งแจ้งเตือน): webhook / คำสั่งบอท / มินิแอป */
async function handleSystemApi(src, method, sub, body) {
  if (sub === "/webhook" || sub === "/webhook/test") return handleWebhookApi(src, method, sub, body);
  if (sub === "/bot") return handleBotApi(src, method, body);
  if (sub === "/miniapp/whoami" && method === "POST") return miniappWhoami(body);
  return null;
}

// ── ประกาศแอปรุ่นใหม่เข้าแชททุกคน (การ์ด + ปุ่มดาวน์โหลด) ────────────────────────────
// คนที่ยังใช้รุ่นเก่า (ยังไม่มีระบบอัปเดตในแอป) ก็เห็น · อ่าน latest.json ที่ scripts/18-publish-apps.sh เขียน
const LATEST_JSON = env("APP_LATEST_JSON", "/home/payang/aranchat-apps/dist/latest.json");
async function announceUpdate({ force = false, only } = {}) {
  const feed = JSON.parse(fs.readFileSync(LATEST_JSON, "utf8"));
  const tag = `${feed.desktop?.version ?? "-"}|${feed.android?.version ?? "-"}`;
  if (state.announced[tag] && !force && !only) return { skipped: true, tag, at: state.announced[tag] };
  const versions = [...new Set([feed.desktop?.version, feed.android?.version].filter(Boolean))];
  const notes = [feed.desktop?.notes, feed.android?.notes].find(Boolean) ?? "";
  const ev = eventOf("api:app.update");
  const n = {
    title: `AranChat รุ่นใหม่ ${versions.join(" / ")}`,
    fields: [
      ...(feed.desktop ? [["คอมพิวเตอร์", `Windows / Linux รุ่น ${feed.desktop.version}`]] : []),
      ...(feed.android ? [["มือถือ", `Android รุ่น ${feed.android.version}`]] : []),
    ],
    // รายการ "มีอะไรใหม่" ทีละบรรทัด (latest.json notes แยกบรรทัด หรือคั่นด้วย ·) — ห้ามมี "ชื่อ: ค่า" ไม่งั้นกลายเป็นช่องข้อมูล
    body: [
      ...(notes ? ["มีอะไรใหม่", ...notes.split(/\n|\s·\s/).map((l) => l.trim()).filter(Boolean).map((l) => `• ${l}`)] : []),
      "กดปุ่มด้านล่าง เครื่องจะโหลดไฟล์ที่ตรงกับเครื่องให้เลย แล้วเปิดไฟล์เพื่อติดตั้งทับของเดิม (ข้อมูลแชทไม่หาย)",
      `มือถือรุ่นเก่า (32 บิต) หรือเลือกไฟล์เอง: ${feed.page}`,
    ].join("\n"),
    link: new URL("latest", feed.page).toString(), priority: "normal", ref: `app.update:${tag}`,
  };
  n.link_label = "ดาวน์โหลดและติดตั้ง";
  await refreshMaps();
  const results = {};
  // only = ทดลองส่งให้บางคนก่อน (ไม่นับว่าประกาศแล้ว)
  for (const mxid of only ?? new Set(mxidByArankub.values())) {
    try { results[mxid] = await deliver(mxid, ev, n); } catch (e) { results[mxid] = "error"; log("announce error:", mxid, e.message); }
  }
  if (only) return { test: true, results };
  state.announced[tag] = new Date().toISOString();
  save();
  const sent = Object.values(results).filter((r) => r === "sent").length;
  log("ประกาศแอปรุ่นใหม่", tag, `ส่ง ${sent}/${Object.keys(results).length} คน`);
  return { tag, sent, total: Object.keys(results).length };
}

/** ไฟล์ติดตั้งรุ่นล่าสุดของเครื่องนี้ (ดูจาก ?os= หรือ User-Agent) — ไม่รู้จักเครื่อง/iPhone/Mac = หน้าดาวน์โหลด */
function latestDownload(os, ua) {
  let feed = {};
  try { feed = JSON.parse(fs.readFileSync(LATEST_JSON, "utf8")); } catch { /* ยังไม่มีไฟล์ */ }
  const page = feed.page ?? "/download/";
  const kind = os ?? (/Android/i.test(ua) ? "android" : /Windows/i.test(ua) ? "windows" : /iPhone|iPad|Macintosh/i.test(ua) ? "page"
    : /Linux|X11/i.test(ua) ? "linux" : "page");
  return {
    android: feed.android?.url, android32: feed.android?.url32, windows: feed.desktop?.win?.url,
    linux: feed.desktop?.linux?.deb, appimage: feed.desktop?.linux?.appimage,
  }[kind] ?? page;
}

/** รายงานเรื่องด่วนย้อนหลัง (หน้าจัดการ) — ใครรับทราบ ใช้เวลากี่นาที */
async function casesReport(days = 30) {
  await refreshMaps().catch(() => {});
  const names = new Map((await people().catch(() => [])).map((p) => [p.mxid, p.name]));
  const from = Date.now() - days * 86400_000;
  return Object.entries(state.cases).filter(([, c]) => Date.parse(c.at) >= from)
    .sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at))
    .map(([ref, c]) => ({
      ref, ev: c.ev, label: eventOf(c.ev).label, title: c.title, fields: c.fields, at: c.at,
      to: c.events.map((e) => e.to), by: c.by ? (names.get(c.by) ?? c.by) : null, ackAt: c.ackAt ?? null, how: c.how ?? null,
      minutes: c.ackAt ? Math.round((Date.parse(c.ackAt) - Date.parse(c.at)) / 60000) : null,
      reminded: !!c.reminded, escalated: !!c.escalated,
    }));
}

// ── ห้องแจ้งเตือนตามเรื่อง (หลายคนเห็นพร้อมกัน เช่น "ค่าวิกฤตแล็บ", "IT แจ้งเหตุ") ──────────
// bot เป็นผู้สร้าง/ผู้ดูแลห้อง · สมาชิกคุยกันในห้องได้ (เช่น "รับทราบ") · เพิ่ม/ลบคนได้จากหน้าจัดการ หรือเชิญในแชทเลย
const CHANNEL_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const roomPath = (roomId) => `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}`;

async function createChannel({ id, name, icon, topic, members = [] }) {
  if (!CHANNEL_ID.test(id ?? "")) throw Object.assign(new Error("id ใช้ a-z 0-9 - (2–41 ตัว)"), { code: 400 });
  if (state.channels[id]) throw Object.assign(new Error("มีห้องนี้แล้ว"), { code: 409 });
  if (!String(name ?? "").trim()) throw Object.assign(new Error("ต้องมีชื่อห้อง"), { code: 400 });
  const invite = (await Promise.all(members.map((m) => resolve(String(m))))).filter(Boolean);
  const { room_id } = await mx("POST", "/_matrix/client/v3/createRoom", {
    // ห้องแจ้งเตือนไม่เข้ารหัส (bot ไม่มีกุญแจ): public_chat + join_rules invite (ดู dmRoom) · ประวัติเห็นได้ตั้งแต่เข้าห้อง
    preset: "public_chat", name: `${icon ? icon + " " : ""}${name.trim()}`, topic: topic ?? "", invite,
    initial_state: [
      { type: "m.room.join_rules", state_key: "", content: { join_rule: "invite" } },
      { type: "m.room.history_visibility", state_key: "", content: { history_visibility: "shared" } },
    ],
    power_level_content_override: { invite: 50, kick: 50, state_default: 50 },
  });
  state.channels[id] = { name: name.trim(), icon: icon ?? null, topic: topic ?? "", roomId: room_id, createdAt: new Date().toISOString() };
  save();
  await say(room_id, `${icon ?? "🔔"} ห้องแจ้งเตือน "${name.trim()}"\nแจ้งเตือนเรื่องนี้จากระบบต่างๆ จะส่งเข้าห้องนี้ ทุกคนในห้องเห็นพร้อมกัน`
    + `\nไม่อยากให้เด้ง: กดชื่อห้อง → การแจ้งเตือน → ปิดเสียง`);
  log("channel created", id, room_id);
  return { id, ...state.channels[id], invited: invite.length };
}

async function channelMembers(roomId) {
  const { joined } = await mx("GET", `${roomPath(roomId)}/joined_members`);
  const me = `@aranchat:${serverName}`;
  return Object.entries(joined).filter(([u]) => u !== me).map(([mxid, m]) => ({ mxid, name: m.display_name ?? null }));
}

async function deliverChannel(id, ev, n) {
  const ch = state.channels[id];
  if (!ch) return "no_such_room";
  try {
    trackCase(n, ev, ch.roomId, await sayCard(ch.roomId, ev, n, true), `room:${id}`);
  } catch (e) {
    if (e.status) { record(ev, `room:${id}`, "error"); throw e; }
    log("card error:", e.message);
    const { text, html } = card(ev, n);
    await say(ch.roomId, text, html);
  }
  return record(ev, `room:${id}`, "sent");
}

/** ส่งถึงผู้รับ 1 ราย: "room:<id>" = ห้องแจ้งเตือน · อื่นๆ = รายคน (arankub:/p4p:/@mxid) */
async function deliverTo(target, ev, n) {
  if (target.startsWith("room:")) return deliverChannel(target.slice(5), ev, n);
  const mxid = await resolve(target);
  return mxid ? deliver(mxid, ev, n) : "not_in_chat";
}

// ── 3. HTTP API ──────────────────────────────────────────────────────────────────
// POST /send  Authorization: Bearer <key ของระบบ> (สร้างจากหน้าจัดการ · key เดิม NOTIFY_API_KEY = ระบบ "api")
// { "event": "lab.critical", "to": ["arankub:<user id>", "p4p:<staff id>", "@user:arankub.com"],
//   "title": "...", "text": "...", "link": "https://...", "priority": "normal|urgent" }
// ไม่ส่ง "to" = ส่งถึงผู้รับประจำเรื่องที่ admin ตั้งไว้ในหน้าจัดการ
function sourceByKey(auth) {
  const key = String(auth ?? "").replace(/^Bearer\s+/i, "");
  if (!key) return null;
  if (key === API_KEY) return "api";
  const h = sha(key);
  return Object.entries(state.sources).find(([, s]) => s.keyHash === h)?.[0] ?? null;
}

// จำกัดความถี่ต่อระบบ (กันระบบที่วนลูปผิดพลาดยิงแจ้งเตือนท่วมแชท): 60 ครั้ง/นาที
const RATE = { perMin: 60 };
const hits = new Map();   // ระบบ → [เวลา]
function rateLimited(src) {
  const now = Date.now(), h = (hits.get(src) ?? []).filter((t) => now - t < 60_000);
  h.push(now); hits.set(src, h);
  return h.length > RATE.perMin;
}

async function handleSend(src, body) {
  if (!sourceOn(src)) return [403, { error: "ระบบนี้ถูกปิดในหน้าจัดการ" }];
  if (!body.event || !body.title) return [400, { error: "ต้องมี event, title" }];
  if (!/^[\w.\-]{1,60}$/.test(String(body.event))) return [400, { error: "event ใช้ a-z 0-9 . _ - (ไม่เกิน 60 ตัว)" }];
  if (rateLimited(src)) return [429, { error: `ส่งเกิน ${RATE.perMin} ครั้งต่อนาที — รอสักครู่แล้วส่งใหม่` }];
  // กันส่งซ้ำ: ระบบส่ง id เดิมซ้ำ (เช่น retry หลัง timeout) → ไม่ส่งซ้ำเข้าแชท
  const idem = body.id ? `${src}:${String(body.id).slice(0, 120)}` : null;
  if (idem && state.idem[idem]) return [200, { duplicate: true, results: {} }];
  const ev = eventOf(`${src}:${body.event}`);
  // ไม่ส่ง to = ผู้รับประจำ/ห้องประจำที่ตั้งในหน้าจัดการ · ใส่ "default" ใน to = ผู้รับประจำ + คนที่ระบุ (เช่น แพทย์เจ้าของไข้ + ทีมคุณภาพ)
  const defaults = [...(ev.recipients ?? []).map((u) => `arankub:${u}`), ...(ev.channels ?? []).map((c) => `room:${c}`)];
  const to = [...new Set((Array.isArray(body.to) && body.to.length ? body.to.map(String) : ["default"])
    .flatMap((t) => (t === "default" ? defaults : [t])))];
  if (!to.length) return [400, { error: `ไม่ได้ระบุ to และเรื่อง "${ev.label}" ยังไม่มีผู้รับประจำ/ห้องประจำ — ตั้งได้ที่หน้าจัดการ` }];
  if (to.length > 200) return [400, { error: "ผู้รับไม่เกิน 200 รายต่อครั้ง" }];
  const made = await makeNotice(src, body, idem);
  if (made.error) return [400, { error: made.error }];
  const n = made.n;
  const results = {};
  for (const t of to) {
    try { results[t] = await deliverTo(t, ev, n); } catch (e) { results[t] = "error"; log("deliver error:", t, e.message); }
  }
  if (idem) {
    state.idem[idem] = Date.now();
    const old = Date.now() - 3 * 86400_000;
    for (const [k, t] of Object.entries(state.idem)) if (t < old) delete state.idem[k];
    save();
  }
  // hash เลขบัตรถือเป็นข้อมูลส่วนบุคคล — log แค่ 8 ตัวแรก
  log(src, body.event, JSON.stringify(results).replace(/cidhash:([0-9a-f]{8})[0-9a-f]+/g, "cidhash:$1…"));
  return [200, { results }];
}

/** ข้อมูลแจ้งเตือน 1 เรื่องจาก body ที่ระบบส่งมา (ใช้ทั้ง POST /api/notify และคำตอบคำสั่ง /) → { n } | { error } */
async function makeNotice(src, body, idem = null) {
  const n = {
    title: String(body.title).slice(0, 200), body: body.text == null ? undefined : String(body.text).slice(0, 2000),
    link: /^https?:\/\//.test(body.link ?? "") ? body.link : undefined,
    priority: body.priority === "urgent" || body.priority === "high" ? "urgent" : "normal",
    ref: idem ?? `${src}:${crypto.randomUUID()}`,   // เรื่องเดียวกันที่ส่งหลายที่ (ห้อง + แพทย์) — รับทราบที่ไหนก็ปิดเรื่อง
    // ช่องข้อมูลในการ์ด: [["HN", "0012345"], ...] หรือ { "HN": "0012345" } (ไม่ส่งก็ได้ — ดึงจากบรรทัด "ชื่อ: ค่า" ใน text ให้เอง)
    fields: (Array.isArray(body.fields) ? body.fields : Object.entries(body.fields && typeof body.fields === "object" ? body.fields : {}))
      .filter((f) => Array.isArray(f) && f[0] != null && f[1] != null).slice(0, 12).map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 300)]),
  };
  // การ์ดรุ่น 2 (cardkit.mjs): โทนสีของช่องข้อมูล, ส่วนเนื้อหา, ปุ่ม, รูป — รูปอัปโหลดครั้งเดียวใช้ทุกผู้รับ
  n.fields = cleanFields(body.fields, 12);
  const x = cardExtras(body);
  if (x.imageSrc) x.image = await imageToMxc(x.imageSrc, uploadMedia).catch((e) => { log("card image:", src, e.message); return undefined; });
  delete x.imageSrc;
  if (x.approvers.length) {
    x.approvers = (await Promise.all(x.approvers.map((a) => resolve(a).catch(() => null)))).filter(Boolean);
    if (!x.approvers.length && x.buttons.some(isActionButton)) return { error: "approvers ที่ระบุยังไม่มีบัญชีแชท — ไม่มีใครกดปุ่มได้" };
  }
  n.extras = x;
  n.src = src;
  n.extId = body.id == null ? undefined : String(body.id).slice(0, 120);
  return { n };
}

// webhook ของระบบ (ตั้งเองด้วย key ของระบบ)
//   PUT    /api/notify/webhook       { "url": "https://…" } → { secret } (แสดงครั้งเดียว · ตั้งใหม่ = secret ใหม่)
//   GET    /api/notify/webhook       { url, lastOkAt, lastError }
//   DELETE /api/notify/webhook
//   POST   /api/notify/webhook/test  ส่ง { type: "test" } ไปลองดู
// ทุกคำขอมี header X-AranChat-Signature = base64(HMAC-SHA256(secret, body ดิบ)) — ระบบต้องตรวจก่อนเชื่อ
async function handleWebhookApi(src, method, path, body) {
  const hook = state.webhooks[src];
  if (path.endsWith("/test")) {
    if (method !== "POST") return [405, { error: "ใช้ POST" }];
    if (!hook?.url) return [400, { error: "ยังไม่ได้ตั้ง webhook — PUT /api/notify/webhook ก่อน" }];
    const r = await hookCall(src, { type: "test", at: new Date().toISOString() });
    return [200, { ok: r.ok, status: r.status, error: r.error ?? null }];
  }
  if (method === "GET") return [200, hook ? { url: hook.url, lastOkAt: hook.lastOkAt ?? null, lastError: hook.lastError ?? null } : { url: null }];
  if (method === "DELETE") { delete state.webhooks[src]; save(); return [200, { ok: true }]; }
  if (method !== "PUT") return [405, { error: "ใช้ GET / PUT / DELETE" }];
  const url = String(body?.url ?? "");
  if (!/^https?:\/\/[^\s]{4,500}$/.test(url)) return [400, { error: "ต้องมี url (http:// หรือ https://)" }];
  const secret = newSecret();
  state.webhooks[src] = { url, secret, lastOkAt: null, lastError: null, setAt: new Date().toISOString() };
  save();
  log("ตั้ง webhook:", src, url.replace(/\?.*$/, ""));
  return [200, { url, secret }];
}

// ── Admin API (หน้าจัดการใน AranKub เรียกผ่าน 127.0.0.1 เท่านั้น · Bearer NOTIFY_ADMIN_KEY) ──────
const SOURCE_ID = /^[a-z][a-z0-9-]{1,30}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const newKey = (id) => `acn_${id}_${crypto.randomBytes(24).toString("base64url")}`;
const publicSource = (id, s) => ({ id, name: s.name, color: s.color, mark: s.mark, kind: s.kind, enabled: s.enabled !== false, builtin: !!s.builtin, keyHint: s.keyHint ?? null, createdAt: s.createdAt });

async function people() {
  await refreshMaps();
  const ids = [...mxidByArankub.keys()];
  const { rows } = ids.length ? await arankubDb.query(`select id, name, email from users where id = any($1)`, [ids]) : { rows: [] };
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => ({ arankubId: id, mxid: mxidByArankub.get(id), name: byId.get(id)?.name ?? null }))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "th"));
}

function overview() {
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);   // วันนี้ตามเวลาไทย
  const isToday = (t) => new Date(new Date(t).getTime() + 7 * 3600_000).toISOString().slice(0, 10) === today;
  const stat = {};
  for (const l of state.log) {
    const s = (stat[l.ev] ??= { sent: 0, off: 0, error: 0, today: 0, last: null });
    s[l.r] = (s[l.r] ?? 0) + 1;
    if (isToday(l.t) && l.r === "sent") s.today++;
    s.last = l.t;
  }
  const offBy = {};
  for (const p of Object.values(state.prefs)) for (const [k, v] of Object.entries(p)) if (v === false) offBy[k] = (offBy[k] ?? 0) + 1;
  // เรื่องของระบบที่ลบไปแล้วยังเก็บไว้ใน extraEvents (หมายเลข "ปิด N" ของเรื่องอื่นจะได้ไม่เลื่อน) แต่ไม่แสดง
  const events = eventList().filter((e) => state.sources[e.key.split(":")[0]]).map((e) => ({ no: eventNo(e.key), key: e.key, source: e.key.split(":")[0], label: e.label, icon: e.icon ?? null,
    on: e.on, mandatory: !!e.mandatory, recipients: e.recipients ?? [], channels: e.channels ?? [], escalate: e.escalate ?? [],
    followUp: e.followUp !== false, remindMin: e.remindMin ?? REMIND_MIN, escalateMin: e.escalateMin ?? ESCALATE_MIN, doc: state.docs[e.key] ?? null, isNew: !!e.isNew && !state.eventCfg[e.key], optedOut: offBy[e.key] ?? 0, ...stat[e.key] }));
  const sources = Object.entries(state.sources).map(([id, s]) => ({ ...publicSource(id, s),
    today: events.filter((e) => e.source === id).reduce((n, e) => n + (e.today ?? 0), 0) }));
  return { sources, events, log: state.log.slice(-200).reverse() };
}

async function handleAdmin(method, path, body) {
  const seg = path.split("/").filter(Boolean).slice(1);   // ตัด "admin"
  const [a, id, b] = seg;
  if (method === "GET" && a === "overview") return [200, overview()];
  if (method === "GET" && a === "people") return [200, { people: await people() }];
  if (method === "POST" && a === "announce") {
    const only = Array.isArray(body.only) ? body.only.map(String).filter((m) => /^@[^:]+:.+$/.test(m)).slice(0, 10) : undefined;
    try { return [200, await announceUpdate({ force: body.force === true, only })]; } catch (e) { return [500, { error: e.message }]; }
  }
  // ทักทุกบัญชีแชทที่ยังไม่มีห้องกับ bot ครั้งเดียว + แนะนำการส่งเอกสารให้อ่าน (OCR)
  // body: { dry: true } = แค่แสดงรายชื่อ · ใช้รายชื่อจาก Synapse admin API (รวมคนที่ยังไม่ผูก AranKub)
  if (method === "POST" && a === "greet") {
    const adminToken = env("MATRIX_ADMIN_TOKEN", "");
    if (!adminToken) return [500, { error: "ไม่ได้ตั้ง MATRIX_ADMIN_TOKEN" }];
    const r = await fetch(`${MATRIX}/_synapse/admin/v2/users?guests=false&deactivated=false&limit=1000`,
      { headers: { Authorization: `Bearer ${adminToken}` } });
    if (!r.ok) return [502, { error: `Synapse admin ${r.status}` }];
    const skip = new Set([`@aranchat:${serverName}`, `@hookshot:${serverName}`]);
    const todo = (await r.json()).users
      .filter((u) => !skip.has(u.name) && !u.user_type && !state.dm[u.name])
      .map((u) => ({ mxid: u.name, name: u.displayname ?? null }));
    if (body.dry) return [200, { dry: true, count: todo.length, users: todo }];
    const results = {};
    for (const u of todo) {
      try {
        const roomId = await dmRoom(u.mxid);       // สร้างห้อง + ส่ง WELCOME
        await say(roomId, OCR_INTRO, OCR_INTRO_HTML);
        results[u.mxid] = "sent";
      } catch (e) { results[u.mxid] = `error: ${e.message}`; log("greet error:", u.mxid, e.message); }
    }
    log("ทักผู้ใช้ใหม่", `${Object.values(results).filter((v) => v === "sent").length}/${todo.length} คน`);
    return [200, { count: todo.length, results }];
  }
  if (method === "GET" && a === "cases") return [200, { remindMin: REMIND_MIN, escalateMin: ESCALATE_MIN, cases: await casesReport(Number(id) || 30) }];

  if (a === "sources" && method === "POST" && !id) {
    const sid = String(body.id ?? "").toLowerCase();
    if (!SOURCE_ID.test(sid)) return [400, { error: "รหัสระบบใช้ a-z 0-9 - (2–31 ตัว) ขึ้นต้นด้วยตัวอักษร" }];
    if (state.sources[sid]) return [409, { error: "มีระบบรหัสนี้แล้ว" }];
    if (!body.name) return [400, { error: "ต้องมีชื่อระบบ" }];
    const key = newKey(sid);
    state.sources[sid] = { name: String(body.name).slice(0, 40), color: COLOR.test(body.color) ? body.color : "#5B3FD9",
      mark: String(body.mark || body.name).slice(0, 3), kind: "api", keyHash: sha(key), keyHint: `…${key.slice(-4)}`,
      enabled: true, createdAt: new Date().toISOString() };
    save();
    return [200, { source: publicSource(sid, state.sources[sid]), key }];   // key แสดงครั้งเดียว
  }
  if (a === "sources" && id && state.sources[id]) {
    const s = state.sources[id];
    if (method === "PATCH") {
      if (body.name) s.name = String(body.name).slice(0, 40);
      if (COLOR.test(body.color ?? "")) s.color = body.color;
      if (body.mark) s.mark = String(body.mark).slice(0, 3);
      if (typeof body.enabled === "boolean") s.enabled = body.enabled;
      save();
      return [200, { source: publicSource(id, s) }];
    }
    if (method === "POST" && b === "key") {
      if (s.kind !== "api" || id === "api") return [400, { error: "ระบบนี้ไม่ใช้ key จากหน้าจัดการ" }];
      const key = newKey(id);
      s.keyHash = sha(key); s.keyHint = `…${key.slice(-4)}`;
      save();
      return [200, { key }];
    }
    if (method === "DELETE") {
      if (s.builtin) return [400, { error: "ระบบตั้งต้นลบไม่ได้ — ปิดใช้งานแทน" }];
      delete state.sources[id];
      save();
      return [200, { ok: true }];
    }
  }
  if (a === "events" && method === "PATCH") {
    const key = String(body.key ?? "");
    if (!eventList().some((e) => e.key === key)) return [404, { error: "ไม่พบเรื่องนี้" }];
    const cfg = (state.eventCfg[key] ??= {});
    if (typeof body.label === "string" && body.label.trim()) cfg.label = body.label.trim().slice(0, 80);
    if (typeof body.icon === "string") cfg.icon = body.icon.slice(0, 8) || undefined;
    if (typeof body.on === "boolean") cfg.on = body.on;
    if (typeof body.mandatory === "boolean") cfg.mandatory = body.mandatory;
    if (Array.isArray(body.recipients)) cfg.recipients = [...new Set(body.recipients.map(String))].slice(0, 200);
    if (Array.isArray(body.channels)) cfg.channels = [...new Set(body.channels.map(String))].filter((c) => state.channels[c]);
    // เรื่องด่วนที่ไม่มีใครรับทราบ → ส่งต่อใคร (arankub:<id> / room:<ห้อง>)
    if (Array.isArray(body.escalate)) cfg.escalate = [...new Set(body.escalate.map(String))].slice(0, 50);
    // ติดตามเรื่องด่วน (เตือนซ้ำ/ส่งต่อ) เปิด-ปิด และจำนวนนาที — ไม่ตั้ง = ค่ากลาง CRIT_REMIND_MIN / CRIT_ESCALATE_MIN
    if (typeof body.followUp === "boolean") cfg.followUp = body.followUp;
    const minutes = (v) => (Number.isInteger(v) && v >= 1 && v <= 1440 ? v : undefined);
    if ("remindMin" in body) cfg.remindMin = minutes(body.remindMin);
    if ("escalateMin" in body) cfg.escalateMin = minutes(body.escalateMin);
    save();
    return [200, { event: eventList().find((e) => e.key === key) }];
  }
  // ห้องแจ้งเตือน: GET รายการ · POST สร้าง {id,name,icon,topic,members[]} · PATCH {name,icon,topic}
  //   POST /channels/<id>/members {add:[], remove:[]} (arankub:<id> / p4p:<id> / @mxid) · DELETE = เลิกใช้ (ห้องยังอยู่)
  if (a === "channels") {
    if (method === "GET" && !id) {
      const list = await Promise.all(Object.entries(state.channels).map(async ([cid, c]) => ({
        id: cid, ...c, members: await channelMembers(c.roomId).catch(() => null),
        events: eventList().filter((e) => (e.channels ?? []).includes(cid)).map((e) => e.key),
      })));
      return [200, { channels: list }];
    }
    if (method === "POST" && !id) {
      try { return [200, { channel: await createChannel(body) }]; } catch (e) { return [e.code ?? 500, { error: e.message }]; }
    }
    const ch = state.channels[id];
    if (!ch) return [404, { error: "ไม่พบห้องนี้" }];
    if (method === "PATCH" && !b) {
      if (typeof body.name === "string" && body.name.trim()) ch.name = body.name.trim().slice(0, 60);
      if (typeof body.icon === "string") ch.icon = body.icon.slice(0, 8) || null;
      if (typeof body.topic === "string") ch.topic = body.topic.slice(0, 300);
      await mx("PUT", `${roomPath(ch.roomId)}/state/m.room.name/`, { name: `${ch.icon ? ch.icon + " " : ""}${ch.name}` });
      await mx("PUT", `${roomPath(ch.roomId)}/state/m.room.topic/`, { topic: ch.topic });
      save();
      return [200, { channel: { id, ...ch } }];
    }
    if (method === "POST" && b === "members") {
      const out = {};
      for (const m of body.add ?? []) {
        const mxid = await resolve(String(m));
        out[m] = mxid ? await mx("POST", `${roomPath(ch.roomId)}/invite`, { user_id: mxid }).then(() => "invited", (e) => e.data?.errcode ?? "error") : "not_in_chat";
      }
      for (const m of body.remove ?? []) {
        const mxid = await resolve(String(m));
        out[m] = mxid ? await mx("POST", `${roomPath(ch.roomId)}/kick`, { user_id: mxid, reason: "นำออกจากหน้าจัดการ" }).then(() => "removed", (e) => e.data?.errcode ?? "error") : "not_in_chat";
      }
      return [200, { results: out }];
    }
    if (method === "DELETE" && !b) {
      delete state.channels[id];
      for (const cfg of Object.values(state.eventCfg)) if (cfg.channels) cfg.channels = cfg.channels.filter((c) => c !== id);
      save();
      await say(ch.roomId, "ห้องนี้เลิกใช้เป็นห้องแจ้งเตือนแล้ว จะไม่มีแจ้งเตือนใหม่ส่งเข้ามา").catch(() => {});
      return [200, { ok: true }];
    }
    return [404, { error: "not found" }];
  }
  if (a === "test" && method === "POST") {
    const ev = eventList().find((e) => e.key === body.key);
    const mxid = await resolve(`arankub:${body.arankubId}`);
    if (!ev || !mxid) return [400, { error: "ไม่พบเรื่อง หรือผู้ใช้ยังไม่มีบัญชีแชท" }];
    await deliverNow(mxid, ev, { title: `ทดสอบ: ${ev.label}`, body: "ข้อความทดสอบจากหน้าจัดการการแจ้งเตือน\nถ้าเห็นการ์ดนี้ แปลว่าส่งถึงแล้ว", link: `${LINKS.arankub}/settings/aranchat` });
    record(ev, mxid, "test");
    return [200, { ok: true }];
  }
  // ข้อมูลรายคน (หน้าโปรไฟล์ AranChat ของผู้ใช้เอง) — AranKub ตรวจว่าเป็นเจ้าของ id ก่อนเรียก
  if (a === "user" && id) {
    const mxid = await resolve(`arankub:${id}`);
    if (!mxid) return [404, { error: "ยังไม่มีบัญชีแชท", mxid: null }];
    if (method === "PUT" && b === "prefs") {
      const p = (state.prefs[mxid] ??= {});
      for (const [k, v] of Object.entries(body.prefs ?? {})) {
        const e = eventList().find((x) => x.key === k);
        if (e && !e.mandatory && typeof v === "boolean") p[k] = v;
      }
      save();
    }
    const seen = new Set(state.seen[mxid] ?? []);
    return [200, { mxid, events: eventList().filter((e) => state.sources[e.key.split(":")[0]] && (seen.has(e.key) || e.mandatory))
      .map((e) => ({ key: e.key, label: e.label, icon: e.icon ?? null, mandatory: !!e.mandatory, on: wants(mxid, e) })) }];
  }
  return [404, { error: "not found" }];
}

const server = http.createServer(async (req, res) => {
  const reply = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
  try {
    const path = new URL(req.url, "http://x").pathname;
    if (req.method === "GET" && path === "/health") return reply(200, { ok: true, users: mxidByArankub.size });
    let raw = "";
    for await (const c of req) { raw += c; if (raw.length > 64_000) return reply(413, { error: "too large" }); }
    const body = raw ? JSON.parse(raw) : {};
    if (path.startsWith("/admin/")) {
      if (req.headers.authorization !== `Bearer ${ADMIN_KEY}`) return reply(401, { error: "unauthorized" });
      const [code, out] = await handleAdmin(req.method, path, body);
      return reply(code, out);
    }
    if (/^\/(webhook|bot|miniapp)/.test(path)) {
      const src = sourceByKey(req.headers.authorization);
      if (!src) return reply(401, { error: "unauthorized" });
      const out = await handleSystemApi(src, req.method, path, body);
      return out ? reply(...out) : reply(404, { error: "not found" });
    }
    if (req.method !== "POST" || path !== "/send") return reply(404, { error: "not found" });
    const src = sourceByKey(req.headers.authorization);
    if (!src) return reply(401, { error: "unauthorized" });
    const [code, out] = await handleSend(src, body);
    reply(code, out);
  } catch (e) {
    log("api error:", e.message);
    reply(500, { error: e.message });
  }
});

// ── 4. ทางเข้าจากระบบอื่น (เครื่องอื่นใน รพ. / ภายนอก): https://chat.arankub.com/api/notify ─────────────
// K3s ingress → Service aranchat-notify-api → พอร์ตนี้ (PUBLIC_BIND ค่าเริ่มต้น 10.42.0.1 = ฝั่ง host ของเครือข่าย pod
// มีแค่ K3s ที่ต่อถึง เครื่องอื่นต่อตรงไม่ได้) · คู่มือ + ตัวอย่างโค้ด: https://chat.arankub.com/connect/
//   POST /api/notify            ส่งแจ้งเตือน (เหมือน /send) — key: Authorization: Bearer … หรือ ?key=… (เครื่องมือที่ใส่ header ไม่ได้)
//   GET  /api/notify/channels   รายชื่อห้องแจ้งเตือน (ต้องมี key)
//   POST /api/notify/describe   ระบบแจ้งว่าแต่ละเรื่องดึงข้อมูลอย่างไร { events: { "<เรื่อง>": { label?, note, sql } } } → ผู้ดูแลกดดูในหน้าจัดการ
//                               (ลงทะเบียนเรื่องไว้ด้วย — ขึ้นในหน้าจัดการทันทีแม้ยังไม่เคยส่ง)
//   GET  /api/notify/health
const [PUB_HOST, PUB_PORT] = env("PUBLIC_BIND", "10.42.0.1:3211").split(":");
// ลิงก์ชวนเพื่อน / แชร์กลุ่ม (invites.mjs) — https://<chat>/i/<รหัส>
const invites = createInvites({
  state, save, mx, say, dmRoom, log,
  matrixUrl: MATRIX,
  chatHost: env("CHAT_HOST", "chat.arankub.com"),
  getServerName: () => serverName,
  adminToken: env("MATRIX_ADMIN_TOKEN", ""),
  pageTemplate: templateReader(env("INVITE_PAGE", new URL("../rendered/brand/invite.html", import.meta.url).pathname)),
});
const publicApi = http.createServer(async (req, res) => {
  const reply = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
  const ip = req.headers["cf-connecting-ip"] ?? (String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress);
  try {
    const url = new URL(req.url, "http://x");
    const path = url.pathname.replace(/\/+$/, "");
    if (req.method === "GET" && path === "/api/notify/health") return reply(200, { ok: true });
    // https://chat.arankub.com/download/latest (nginx ส่งต่อมา) — ดาวน์โหลดไฟล์ติดตั้งรุ่นล่าสุดที่ตรงกับเครื่องทันที (ปุ่มในการ์ด "มีรุ่นใหม่")
    if (req.method === "GET" && path === "/api/notify/download") {
      const target = latestDownload(url.searchParams.get("os"), String(req.headers["user-agent"] ?? ""));
      res.writeHead(302, { Location: target, "Cache-Control": "no-store" });
      return res.end();
    }
    const readBody = async () => {
      let raw = "";
      for await (const c of req) { raw += c; if (raw.length > 16_000) throw new Error("ข้อมูลใหญ่เกิน"); }
      return raw ? JSON.parse(raw) : {};
    };
    if (!serverName) serverName = (await mx("GET", "/_matrix/client/v3/account/whoami")).user_id.split(":").slice(1).join(":");
    if (path.startsWith("/api/notify/invite")) {
      // แอป Desktop (Electron) เรียกจาก origin อื่น · ยืนยันตัวด้วย OpenID token ใน body (ไม่ใช้ cookie) จึงเปิด * ได้
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Max-Age": "86400" }); return res.end(); }
    }
    if (await invites.handle(req, res, path, reply, readBody)) return;
    // ปุ่ม "ถอดเป็นข้อความ" ที่ข้อความเสียงในแอป: แอปถอดรหัสเสียงในเครื่องผู้ใช้แล้วส่งมาถอดบนเครื่องของ รพ.
    //   POST /api/notify/asr  body = ไฟล์เสียง (≤ 25 MB) · header X-AranChat-OpenID: <openid access_token> → { text, duration_s }
    //   ไม่เก็บไฟล์/ข้อความ · ทีละไฟล์ต่อผู้ใช้
    if (path === "/api/notify/asr") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-AranChat-OpenID");
      if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "86400" }); return res.end(); }
      if (req.method !== "POST") return reply(405, { error: "ใช้ POST" });
      const token = String(req.headers["x-aranchat-openid"] ?? "");
      if (!/^[\w\-.~+/=]{8,256}$/.test(token)) return reply(401, { error: "ต้องเข้าระบบ" });
      const who = await fetch(`${MATRIX}/_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10_000) })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!who?.sub) return reply(401, { error: "token ไม่ถูกต้องหรือหมดอายุ" });
      if (asrBusy.has(who.sub)) return reply(429, { error: "กำลังถอดไฟล์ก่อนหน้าอยู่" });
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > 25 * 1024 * 1024) return reply(413, { error: "ไฟล์ใหญ่เกิน 25 MB" }); chunks.push(c); }
      if (!size) return reply(400, { error: "ไม่มีไฟล์เสียง" });
      asrBusy.add(who.sub);
      try {
        const r = await transcribe(Buffer.concat(chunks), { name: "voice", mime: String(req.headers["content-type"] ?? "application/octet-stream"), meeting: false });
        log("asr app", who.sub, `${Math.round(r.duration_s ?? 0)}s`, `chars=${r.text.length}`);
        return reply(200, { text: r.text, duration_s: r.duration_s ?? null });
      } catch (e) {
        log("asr app error:", e.message);
        return reply(e.status === 415 ? 415 : 503, { error: e.status === 415 ? "เปิดไฟล์เสียงนี้ไม่ได้" : "ระบบถอดเสียงไม่ว่าง ลองใหม่อีกครั้ง" });
      } finally {
        asrBusy.delete(who.sub);
      }
    }
    // รายการคำสั่ง + เมนูบอท (แอปอ่าน ไม่ต้องมี key) — ไม่มีข้อมูลส่วนบุคคล
    if (req.method === "GET" && path === "/api/notify/bot" && !req.headers.authorization) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=60");
      return reply(200, botInfo());
    }
    const src = sourceByKey(req.headers.authorization ?? url.searchParams.get("key"));
    if (!src) { log("api: key ไม่ถูกต้อง จาก", ip); return reply(401, { error: "key ไม่ถูกต้อง — ขอ key ได้จากผู้ดูแล (หน้าจัดการแจ้งเตือนใน AranKub)" }); }
    // webhook (ผลการกดปุ่มบนการ์ด) · คำสั่งบอท/เมนู · มินิแอป — ใช้ key ของระบบ
    if (/^\/api\/notify\/(webhook|bot|miniapp)/.test(path)) {
      const body = ["PUT", "POST"].includes(req.method) ? await readBody().catch(() => null) : {};
      const out = await handleSystemApi(src, req.method, path.slice("/api/notify".length), body ?? {});
      return out ? reply(...out) : reply(404, { error: "ไม่พบ" });
    }
    if (req.method === "GET" && path === "/api/notify/channels") {
      return reply(200, { channels: Object.entries(state.channels).map(([id, c]) => ({ id, name: c.name, icon: c.icon, to: `room:${id}` })) });
    }
    if (req.method !== "POST" || (path !== "/api/notify" && path !== "/api/notify/describe")) return reply(404, { error: "ไม่พบ — ใช้ POST /api/notify" });
    let raw = "";
    for await (const c of req) { raw += c; if (raw.length > 64_000) return reply(413, { error: "ข้อมูลใหญ่เกิน 64 KB" }); }
    let body;
    try { body = raw ? JSON.parse(raw) : {}; } catch { return reply(400, { error: "body ต้องเป็น JSON" }); }
    if (path === "/api/notify/describe") {
      const evs = Object.entries(body.events ?? {}).filter(([k]) => /^[\w.\-]{1,60}$/.test(k));
      if (!evs.length) return reply(400, { error: "ต้องมี events: { \"<เรื่อง>\": { note, sql } }" });
      for (const [k, d] of evs) {
        const key = `${src}:${k}`;
        // ลงทะเบียนเรื่องไว้ล่วงหน้า (ยังไม่เคยส่งก็ขึ้นในหน้าจัดการ ตั้งผู้รับได้เลย) · label = ชื่อเริ่มต้นของเรื่องใหม่ (admin แก้ทับได้)
        const known = eventList().some((x) => x.key === key);
        const e = eventOf(key);
        if (!known && d?.label) { e.label = String(d.label).slice(0, 80); save(); }
        state.docs[key] = { note: String(d?.note ?? "").slice(0, 4000), sql: String(d?.sql ?? "").slice(0, 16000), at: new Date().toISOString() };
      }
      save();
      return reply(200, { ok: true, events: evs.map(([k]) => k) });
    }
    // เครื่องมือสำเร็จรูป (Uptime Kuma, Grafana ฯลฯ) ส่ง JSON รูปแบบของตัวเอง → ใส่ event/to ใน URL ได้ แล้วเดาหัวข้อจากช่องที่พบบ่อย
    body.event ??= url.searchParams.get("event");
    if (!body.to && url.searchParams.get("to")) body.to = url.searchParams.get("to").split(",");
    body.title ??= body.msg ?? body.message ?? body.summary ?? body.alerts?.[0]?.annotations?.summary;
    const [code, out] = await handleSend(src, body);
    if (code !== 200) log("api:", src, code, out.error, "จาก", ip);
    reply(code, out);
  } catch (e) {
    log("public api error:", e.message);
    reply(500, { error: "ระบบแจ้งเตือนขัดข้อง" });
  }
});
function listenPublic() {
  publicApi.once("error", (e) => { log(`เปิดทางเข้า ${PUB_HOST}:${PUB_PORT} ไม่ได้ (${e.code}) — ลองใหม่ใน 30 วินาที`); setTimeout(listenPublic, 30_000); });
  publicApi.listen(Number(PUB_PORT), PUB_HOST, () => log(`ทางเข้าระบบอื่น http://${PUB_HOST}:${PUB_PORT}/api/notify`));
}

await refreshMaps(true);
log(`เริ่มทำงาน — ผู้ใช้ที่ผูกบัญชีแล้ว ${mxidByArankub.size} คน · P4P จับคู่ได้ ${arankubByP4p.size} คน`);
server.listen(PORT, "127.0.0.1", () => log(`API http://127.0.0.1:${PORT}/send`));
listenPublic();
pollLoop();
syncLoop();
