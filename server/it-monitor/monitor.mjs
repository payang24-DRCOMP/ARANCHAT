// ตัวเฝ้าระวังงาน IT → AranChat (ระบบ "งาน IT" · key ใน .env)
//
// เพิ่มเรื่องใหม่: สร้างไฟล์ใน checks/ (ดู checks/hosxp-replica.mjs เป็นตัวอย่าง) — โหลดเองทุกไฟล์ ไม่ต้องแก้ไฟล์นี้
//   export default {
//     name: "ชื่อสั้น", everySec: 60,
//     docs: { "<เรื่อง>": { label, note, sql } },     // ขึ้นในหน้าจัดการ /settings/aranchat (ปุ่ม "ดู query") ตั้งแต่เริ่มทำงาน
//     async run(ctx) { … }                              // ctx.notify / ctx.incident / ctx.state / ctx.log / ctx.cfg
//   }
// ctx.incident(id, problem, {...}) จัดการ "เกิดปัญหา → แจ้ง 1 ครั้ง → หายแล้วแจ้งกลับมาปกติพร้อมระยะเวลา" ให้เอง
//
// รัน: pm2 start monitor.mjs --name it-monitor · ทดลองไม่ส่งจริง: node monitor.mjs --dry-run (รันทุกเรื่อง 1 รอบแล้วจบ)
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const readEnv = (file) => Object.fromEntries(fs.readFileSync(file, "utf8").split("\n")
  .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const cfg = { ...readEnv(path.join(HERE, ".env")), ...process.env };
const API = cfg.ARANCHAT_URL || "https://chat.arankub.com/api/notify";
const KEY = cfg.ARANCHAT_KEY;
const DRY = process.argv.includes("--dry-run");
const DEFAULT_TO = (cfg.IT_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
if (!KEY && !DRY) throw new Error("ต้องตั้ง ARANCHAT_KEY ใน .env");

const log = (...a) => console.log(new Date().toISOString(), ...a);
const TZ = "Asia/Bangkok";   // เครื่องนี้ตั้งเวลาเป็น UTC
const thTime = (d = new Date()) => d.toLocaleString("th-TH", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const duration = (ms) => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} นาที` : m < 1440 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${Math.floor(m / 1440)} วัน ${Math.floor((m % 1440) / 60)} ชม.`;
};

// ── สถานะ (ปัญหาที่ค้างอยู่ / สถิติรายวันของแต่ละเรื่อง) ──────────────────────────────────
const STATE = path.join(HERE, "data/state.json");
const state = (() => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; } })();
state.incidents ??= {};
state.checks ??= {};
function save() {
  if (DRY) return;
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE + ".tmp", JSON.stringify(state, null, 1));
  fs.renameSync(STATE + ".tmp", STATE);
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  return [res.status, await res.json().catch(() => ({}))];
}

/** ส่งแจ้งเตือน — ไม่ระบุ to = ผู้รับประจำ/ห้องประจำที่ตั้งในหน้าจัดการ (+ IT_TO ใน .env) */
async function notify(msg) {
  const to = [...new Set(["default", ...DEFAULT_TO, ...(msg.to ?? [])])];
  const body = { ...msg, to };
  if (DRY) { log("[dry-run]", msg.event, msg.priority ?? "", "·", msg.title, msg.fields ? JSON.stringify(msg.fields) : ""); return true; }
  try {
    const [code, out] = await post(API, body);
    if (code !== 200) { log("ส่งไม่สำเร็จ", msg.event, code, out.error); return false; }
    log("ส่งแล้ว", msg.event, JSON.stringify(out.results ?? out));
    return true;
  } catch (e) { log("ส่งไม่สำเร็จ", msg.event, e.message); return false; }
}

/**
 * ปัญหาแบบมีสถานะ: problem = true ครั้งแรก → แจ้ง open · ยัง true → เงียบ (เตือนซ้ำทุก remindMin ถ้าตั้ง)
 * กลับเป็น false → แจ้ง recovered พร้อมระยะเวลาที่เป็นปัญหา · คืนค่า "opened" / "recovered" / null
 */
async function incident(id, problem, { open, recovered, remindMin = 0 }) {
  const cur = state.incidents[id];
  const now = Date.now();
  if (problem && !cur) {
    const ok = await notify(open);
    state.incidents[id] = { since: now, last: now, title: open.title, sent: ok };
    save();
    return "opened";
  } else if (problem && cur) {
    if (!cur.sent || (remindMin && now - cur.last >= remindMin * 60_000)) {
      const ok = await notify({ ...open, title: cur.sent ? `ยังไม่หาย (${duration(now - cur.since)}) — ${open.title}` : open.title, id: undefined });
      if (ok) { cur.sent = true; cur.last = now; save(); }
    }
  } else if (!problem && cur) {
    if (cur.sent && recovered) await notify({ ...recovered, title: `${recovered.title} (เป็นปัญหาอยู่ ${duration(now - cur.since)})` });
    delete state.incidents[id];
    save();
    return "recovered";
  }
  return null;
}

// ── โหลดเรื่องตรวจ ───────────────────────────────────────────────────────────────────
const checks = [];
for (const f of fs.readdirSync(path.join(HERE, "checks")).filter((f) => f.endsWith(".mjs")).sort()) {
  const mod = (await import(path.join(HERE, "checks", f))).default;
  if (!mod?.run) continue;
  if (cfg[`DISABLE_${mod.name.toUpperCase().replace(/\W/g, "_")}`] === "1") { log("ปิดไว้:", mod.name); continue; }
  checks.push(mod);
}

const ctxFor = (c) => ({
  cfg, log: (...a) => log(`[${c.name}]`, ...a), notify, incident, thTime, duration, TZ, DRY,
  get state() { return (state.checks[c.name] ??= {}); }, save,
});

async function describe() {
  const events = Object.assign({}, ...checks.map((c) => c.docs ?? {}));
  if (!Object.keys(events).length || DRY) return;
  try {
    const [code] = await post(API.replace(/\/?$/, "/describe"), { events });
    if (code !== 200) log("ส่งคำอธิบายเรื่องไม่สำเร็จ", code);
  } catch (e) { log("ส่งคำอธิบายเรื่องไม่สำเร็จ:", e.message); }
}

async function runOnce(c) {
  try { await c.run(ctxFor(c)); } catch (e) { log(`[${c.name}] ผิดพลาด:`, e.message); }
}

log(`IT monitor เริ่ม${DRY ? " (ทดลอง ไม่ส่งจริง)" : ""} · เรื่องตรวจ: ${checks.map((c) => `${c.name} (ทุก ${c.everySec} วิ)`).join(", ")}`);
if (DRY) {
  for (const c of checks) await runOnce(c);
  for (const c of checks) await c.close?.();
} else {
  await describe();
  for (const c of checks) {
    let busy = false;
    const tick = async () => { if (busy) return; busy = true; try { await runOnce(c); } finally { busy = false; } };
    await tick();
    setInterval(tick, c.everySec * 1000);
  }
}
