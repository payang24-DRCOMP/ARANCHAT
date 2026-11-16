// AranChat — การ์ดรุ่น 2 (ส่วนเนื้อหาหลายแบบ + ปุ่มหลายแบบ + ปุ่มสั่งงานส่งกลับระบบต้นทาง)
//
// รูปแบบที่ระบบส่งมา (POST /api/notify) — ทุกช่องไม่บังคับ นอกจาก event, title:
//   level     "info" | "success" | "warning" | "critical"   สีหัวการ์ด (priority "urgent" = แดง + ปุ่มรับทราบ + ติดตาม)
//   subtitle  บรรทัดรองใต้หัวข้อ
//   image     https://… (รูป ≤ 2 MB — server อัปโหลดเข้าแชทให้ ข้อมูลไม่ออกนอก รพ.) หรือ mxc://…
//   fields    [["HN","0012345"], ["K","2.4","crit"]] · โทน: crit | high | low | ok | muted
//   sections  [{ type:"text", text }, { type:"fields", title, items:[[k,v,tone]] },
//              { type:"steps", items:[{ label, time, state:"done"|"current"|"todo" }] },
//              { type:"table", title, columns:["รายการ","ผล","ช่วงปกติ"], rows:[["K","2.4","3.5–5.1"]], tones:[["","crit",""]] },
//              { type:"stats", items:[{ label, value, tone }] }]
//   buttons   [{ label, type:"link", url }, { label, type:"copy", text },
//              { label, type:"action", id:"approve", style:"primary"|"secondary"|"danger", confirm:"ยืนยัน…?" },
//              { label, type:"datetime", id:"pickup", mode:"date"|"time"|"datetime", min, max, initial },   เลือกวันเวลา → ส่ง value กลับ
//              { label, type:"app", url:"https://…" }]   มินิแอป: เปิดหน้าเว็บในแชท พร้อม OpenID token ของผู้ใช้ (ดู POST /api/notify/miniapp/whoami)
//             สูงสุด 4 ปุ่ม
//   quick_replies [{ label, text }]  ปุ่มตอบด่วนเหนือช่องพิมพ์ (กดแล้วส่ง text — ขึ้นต้น "/" = คำสั่ง) หายเมื่อมีข้อความใหม่ · สูงสุด 6
//   approvers ["arankub:12", "@user:arankub.com"]  ใครกดปุ่ม action ได้ (ไม่ใส่ = ทุกคนที่เห็นการ์ด)
//
// ปุ่ม action: แอปส่งข้อความตอบกลับการ์ด (ทุกคนในห้องเห็นว่าใครกดอะไร) + content["com.arankub.card_action"] = { event_id, id }
//   → notify เรียก webhook ของระบบต้นทาง (ลงทะเบียนเองด้วย PUT /api/notify/webhook) ลงลายเซ็น HMAC-SHA256
//   → ปิดการ์ด (แก้ข้อความเดิม: แสดงผล + ซ่อนปุ่ม) ทุกห้องที่ส่งเรื่องนี้ไป · ตัดสินได้ครั้งเดียว
import crypto from "node:crypto";

export const LEVELS = ["info", "success", "warning", "critical"];
export const TONES = ["crit", "high", "low", "ok", "muted"];
const STYLES = ["primary", "secondary", "danger"];
const STEP_STATES = ["done", "current", "todo"];
/** รูปแบบค่าที่ปุ่มเลือกวันเวลาส่งกลับ (เวลาไทย ไม่มีเขตเวลา) */
export const DT_MODES = { date: /^\d{4}-\d{2}-\d{2}$/, time: /^\d{2}:\d{2}$/, datetime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/ };
/** ปุ่มที่ส่งผลกลับระบบต้นทาง (ต้องจำการ์ดไว้ · กดได้เฉพาะในห้องที่บอทส่ง) */
export const isActionButton = (b) => b.type === "action" || b.type === "datetime";

/** ปุ่มตอบด่วน [{ label, text }] */
export function cleanQuickReplies(v) {
  return arr(v, 6)
    .map((q) => {
      const raw = String(q?.text ?? q?.label ?? "").slice(0, 200);
      const prefill = q?.prefill === true || /\s$/.test(raw);
      return { label: s(q?.label, 24), text: prefill ? `${raw.trim()} ` : raw.trim(), ...(prefill ? { prefill: true } : {}) };
    })
    .filter((q) => q.label && q.text.trim());
}

const s = (v, max) => (v == null ? "" : String(v)).slice(0, max).trim();
const tone = (v) => (TONES.includes(v) ? v : undefined);
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

/** ช่องข้อมูล: [[k,v,tone?]] หรือ { k: v } */
export function cleanFields(v, max = 16) {
  const list = Array.isArray(v) ? v : v && typeof v === "object" ? Object.entries(v) : [];
  return list
    .filter((f) => Array.isArray(f) && f[0] != null && f[1] != null)
    .slice(0, max)
    .map(([k, val, t]) => (tone(t) ? [s(k, 40), s(val, 300), t] : [s(k, 40), s(val, 300)]))
    .filter(([k]) => k);
}

export function cleanSections(v) {
  const out = [];
  for (const x of arr(v, 8)) {
    if (!x || typeof x !== "object") continue;
    const title = s(x.title, 60) || undefined;
    if (x.type === "text" && s(x.text, 1000)) out.push({ type: "text", text: s(x.text, 1000) });
    else if (x.type === "fields") {
      const items = cleanFields(x.items);
      if (items.length) out.push({ type: "fields", title, items });
    } else if (x.type === "steps") {
      const items = arr(x.items, 8)
        .filter((i) => i && s(i.label, 80))
        .map((i) => ({ label: s(i.label, 80), time: s(i.time, 30) || undefined, state: STEP_STATES.includes(i.state) ? i.state : "todo" }));
      if (items.length) out.push({ type: "steps", title, items });
    } else if (x.type === "table") {
      const columns = arr(x.columns, 4).map((c) => s(c, 30));
      const rows = arr(x.rows, 20).filter(Array.isArray).map((r) => columns.map((_, i) => s(r[i], 60)));
      const tones = arr(x.tones, 20).map((r) => (Array.isArray(r) ? columns.map((_, i) => tone(r[i]) ?? "") : columns.map(() => "")));
      if (columns.length && rows.length) out.push({ type: "table", title, columns, rows, ...(tones.some((r) => r.some(Boolean)) ? { tones } : {}) });
    } else if (x.type === "stats") {
      const items = arr(x.items, 4)
        .filter((i) => i && s(i.label, 30) && s(i.value, 20))
        .map((i) => ({ label: s(i.label, 30), value: s(i.value, 20), ...(tone(i.tone) ? { tone: i.tone } : {}) }));
      if (items.length) out.push({ type: "stats", title, items });
    }
  }
  return out;
}

export function cleanButtons(v) {
  const out = [];
  const ids = new Set();
  for (const b of arr(v, 4)) {
    const label = s(b?.label, 30);
    if (!label) continue;
    const style = STYLES.includes(b.style) ? b.style : undefined;
    if (b.type === "link" && /^https?:\/\//.test(String(b.url ?? ""))) out.push({ type: "link", label, url: s(b.url, 2000), style });
    else if (b.type === "copy" && s(b.text, 200)) out.push({ type: "copy", label, text: s(b.text, 200), style });
    else if (b.type === "app" && /^https:\/\//.test(String(b.url ?? ""))) out.push({ type: "app", label, url: s(b.url, 2000), style });
    else if ((b.type === "action" || b.type === "datetime") && /^[\w.\-]{1,40}$/.test(String(b.id ?? "")) && !ids.has(b.id)) {
      ids.add(b.id);
      if (b.type === "action") out.push({ type: "action", label, id: b.id, style, confirm: s(b.confirm, 120) || undefined });
      else {
        const mode = DT_MODES[b.mode] ? b.mode : "datetime";
        const ok = (v) => (DT_MODES[mode].test(String(v ?? "")) ? String(v) : undefined);
        out.push({ type: "datetime", label, id: b.id, style, mode, min: ok(b.min), max: ok(b.max), initial: ok(b.initial) });
      }
    }
  }
  return out;
}

/** ข้อมูลการ์ดรุ่น 2 จาก body ที่ระบบส่งมา (เฉพาะส่วนที่เพิ่มจากรุ่นแรก) */
export function cardExtras(body) {
  return {
    level: LEVELS.includes(body.level) ? body.level : undefined,
    subtitle: s(body.subtitle, 160) || undefined,
    imageSrc: /^(https:\/\/|mxc:\/\/)/.test(String(body.image ?? "")) ? s(body.image, 2000) : undefined,
    sections: cleanSections(body.sections),
    buttons: cleanButtons(body.buttons),
    approvers: arr(body.approvers, 50).map((x) => s(x, 200)).filter(Boolean),
    quickReplies: cleanQuickReplies(body.quick_replies),
  };
}

/** บรรทัดข้อความสำรอง (แจ้งเตือนบนมือถือ / แอปที่ยังไม่รู้จักการ์ด) */
export function sectionsText(sections) {
  const out = [];
  for (const x of sections ?? []) {
    if (x.title) out.push(`— ${x.title} —`);
    if (x.type === "text") out.push(x.text);
    if (x.type === "fields") for (const [k, v] of x.items) out.push(`${k}: ${v}`);
    if (x.type === "steps") for (const i of x.items) out.push(`${i.state === "done" ? "✓" : i.state === "current" ? "▶" : "○"} ${i.label}${i.time ? ` · ${i.time}` : ""}`);
    if (x.type === "table") for (const r of x.rows) out.push(r.filter(Boolean).join(" · "));
    if (x.type === "stats") out.push(x.items.map((i) => `${i.label} ${i.value}`).join(" · "));
  }
  return out;
}

/** รูปจาก https → อัปโหลดเข้า Matrix (แอปไม่ต้องดึงรูปจากภายนอก · รูปภายใน รพ. ที่ต้องล็อกอินก็ใช้ได้ถ้า server เข้าถึง) */
export async function imageToMxc(src, upload) {
  if (!src) return undefined;
  if (src.startsWith("mxc://")) return /^mxc:\/\/[\w.\-:]+\/[\w\-]+$/.test(src) ? src : undefined;
  const r = await fetch(src, { signal: AbortSignal.timeout(10_000), redirect: "follow" });
  const type = String(r.headers.get("content-type") ?? "").split(";")[0];
  if (!r.ok || !/^image\/(png|jpeg|webp|gif)$/.test(type)) throw new Error(`รูป ${r.status} ${type}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 2 * 1024 * 1024) throw new Error("รูปใหญ่เกิน 2 MB");
  return upload(buf, type);
}

// ── webhook ของระบบต้นทาง ───────────────────────────────────────────────────────
export const newSecret = () => `acw_${crypto.randomBytes(24).toString("base64url")}`;
export const sign = (secret, raw) => crypto.createHmac("sha256", secret).update(raw).digest("base64");

/**
 * ส่ง event ไปที่ webhook · คืน { ok, status, data } — ระบบตอบ JSON ได้ (ไม่บังคับ):
 *   { "status": { "text": "อนุมัติแล้ว", "tone": "ok" }, "close": true, "reply": "ข้อความตอบในห้อง" }
 */
export async function callWebhook(hook, payload) {
  const raw = JSON.stringify({ ...payload, webhookEventId: crypto.randomUUID(), timestamp: Date.now() });
  try {
    const r = await fetch(hook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "AranChat-Notify/1.0", "X-AranChat-Signature": sign(hook.secret, raw) },
      body: raw,
      signal: AbortSignal.timeout(10_000),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: data && typeof data === "object" ? data : {} };
  } catch (e) {
    return { ok: false, status: 0, data: {}, error: e.name === "TimeoutError" ? "หมดเวลา 10 วินาที" : e.message };
  }
}

/** ผลที่แสดงบนการ์ดหลังตัดสิน */
export function cleanStatus(v, fallback) {
  const text = s(v?.text, 120) || fallback?.text;
  if (!text) return undefined;
  return { text, tone: tone(v?.tone) ?? fallback?.tone ?? "ok" };
}
