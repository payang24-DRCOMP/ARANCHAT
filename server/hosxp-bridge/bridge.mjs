// HOSxP → AranChat: อ่านฐานข้อมูล HOSxP (อ่านอย่างเดียว) แล้วส่งแจ้งเตือนผ่าน https://chat.arankub.com/api/notify
// ใช้ key ของระบบ "HOSxP" (.env) เหมือนระบบภายนอกทั่วไป — เป็นตัวอย่างการเชื่อมระบบอื่นด้วย
//
// เรื่องที่ส่ง (เพิ่มเรื่องใหม่: เขียนฟังก์ชัน check… แล้วใส่ใน CHECKS)
//   lab.critical  ค่าวิกฤต — ผลที่ยืนยันแล้ว อยู่นอกช่วงวิกฤตที่ตั้งใน lab_items (critical_range_*) และเปิด alert_critical_value
//                 → ห้อง LAB_CRITICAL_TO + แพทย์ผู้สั่ง (ถ้ามีบัญชีแชท)
//   lab.reported  ผลแล็บออก — ห้องแล็บยืนยันผล (confirm_report = 'Y') → LAB_REPORTED_TO (+ แพทย์ผู้สั่ง ถ้า LAB_REPORTED_DOCTOR=on)
//
// แพทย์ผู้สั่ง → บัญชีแชท: ส่ง "cidhash:<SHA-256 เลขบัตร>" (สูตรเดียวกับ Provider ID/AranKub) ไม่ส่งเลขบัตรจริงออกนอกเครื่อง
// ข้อความมีแค่ HN + หน่วยงาน + ชื่อรายการ/ค่า — ไม่มีชื่อผู้ป่วย (PDPA)
//
// รัน: pm2 start bridge.mjs --name hosxp-bridge · ทดลองไม่ส่งจริง: node bridge.mjs --dry-run [นาทีย้อนหลัง]
import crypto from "node:crypto";
import fs from "node:fs";
import mysql from "mysql2/promise";

const HERE = new URL(".", import.meta.url).pathname;
const readEnv = (file) => Object.fromEntries(fs.readFileSync(file, "utf8").split("\n")
  .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const cfg = { ...readEnv(HERE + ".env"), ...process.env };
const opt = (k, d) => cfg[k] ?? d;

const API = opt("ARANCHAT_URL", "https://chat.arankub.com/api/notify");
const KEY = cfg.ARANCHAT_KEY;
const POLL_MS = Number(opt("POLL_SEC", "60")) * 1000;
const LOOKBACK_MIN = Number(opt("LOOKBACK_MIN", "30"));   // อ่านย้อน 30 นาทีทุกรอบ (ผลที่ลงเวลาย้อนหลังก็ไม่พลาด) — ส่งแล้วจำไว้ไม่ส่งซ้ำ
const LIST = (k, d) => opt(k, d).split(",").map((s) => s.trim()).filter(Boolean);
const LAB_CRITICAL_TO = LIST("LAB_CRITICAL_TO", "room:lab-critical");
const LAB_CRITICAL_DOCTOR = opt("LAB_CRITICAL_DOCTOR", "on") === "on";
const LAB_REPORTED_TO = LIST("LAB_REPORTED_TO", "");
const LAB_REPORTED_DOCTOR = opt("LAB_REPORTED_DOCTOR", "off") === "on";
const DRY = process.argv.includes("--dry-run");

// ฐานข้อมูล HOSxP: ใช้ HOSXP_DB_* ใน .env (บัญชี aran — SELECT อย่างเดียว) · ไม่มีจึงอ่านจาก env ของ hospital-dashboard
// (ตั้งแต่ 2026-11-10 ใช้บัญชีอ่านอย่างเดียวแล้ว)
const db = (() => {
  const e = cfg.HOSXP_DB_HOST ? { DB_HOST: cfg.HOSXP_DB_HOST, DB_PORT: cfg.HOSXP_DB_PORT, DB_USER: cfg.HOSXP_DB_USER, DB_PASSWORD: cfg.HOSXP_DB_PASSWORD, DB_NAME: cfg.HOSXP_DB_NAME }
    : readEnv(opt("HOSXP_ENV_FILE", "/home/payang/hospital-dashboard/backend/.env"));
  return mysql.createPool({ host: e.DB_HOST, port: Number(e.DB_PORT || 3306), user: e.DB_USER, password: e.DB_PASSWORD, database: e.DB_NAME,
    charset: "utf8mb4", connectionLimit: 2, dateStrings: true, connectTimeout: 15_000 });
})();
// ทุกคำสั่งรันใน transaction แบบอ่านอย่างเดียว — เขียนอะไรลง HOSxP ไม่ได้แม้บัญชีจะมีสิทธิ์
async function query(sql, params) {
  const c = await db.getConnection();
  try {
    await c.query("START TRANSACTION READ ONLY");
    const [rows] = await c.query(sql, params);
    return rows;
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }
}

const log = (...a) => console.log(new Date().toISOString(), ...a);
const cidHash = (cid) => { const d = String(cid ?? "").replace(/\D/g, ""); return d.length === 13 ? crypto.createHash("sha256").update(d).digest("hex") : null; };

// ── ส่งแล้วจำไว้ (ไม่ส่งซ้ำ) — AranChat กันซ้ำด้วย id อีกชั้น ──────────────────────────────
const STATE = HERE + "data/state.json";
const sent = new Map(Object.entries((() => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")).sent ?? {}; } catch { return {}; } })()));
function remember(id) {
  sent.set(id, Date.now());
  const old = Date.now() - 2 * 86400_000;
  for (const [k, t] of sent) if (t < old) sent.delete(k);
  fs.mkdirSync(HERE + "data", { recursive: true });
  fs.writeFileSync(STATE + ".tmp", JSON.stringify({ sent: Object.fromEntries(sent) }));
  fs.renameSync(STATE + ".tmp", STATE);
}

let priming = false;   // รอบแรกหลังเปิดบริการ: จำของที่มีอยู่แล้วในช่วงย้อนหลังไว้เฉยๆ ไม่ส่ง (ไม่ส่งของเก่าท่วมแชท)
async function notify(msg) {
  if (sent.has(msg.id)) return;
  if (priming) { sent.set(msg.id, Date.now()); return; }
  if (DRY) { log("[dry-run]", msg.event, msg.to.map((t) => t.replace(/^cidhash:(.{8}).*/, "cidhash:$1…")).join(","), "·", msg.title); return; }
  const res = await fetch(API, {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(msg),
    signal: AbortSignal.timeout(15_000),
  });
  const out = await res.json().catch(() => ({}));
  if (res.status === 429) throw new Error("AranChat จำกัดความถี่ — ส่งรอบหน้า");
  if (!res.ok) { log("ส่งไม่สำเร็จ", res.status, out.error, msg.id); return; }
  remember(msg.id);
  // hash เลขบัตรถือเป็นข้อมูลส่วนบุคคล — log แค่ 8 ตัวแรก
  log(msg.event, msg.id, JSON.stringify(out.results ?? out).replace(/cidhash:([0-9a-f]{8})[0-9a-f]+/g, "cidhash:$1…"));
}

// ── ผลแล็บที่ยืนยันแล้วในช่วงเวลา ─────────────────────────────────────────────────────
const fmtTime = (t) => String(t ?? "").slice(0, 5);
/** ผลที่ยืนยันในช่วง secs วินาทีล่าสุด — ให้ MySQL คิดเวลาเอง (เวลาเครื่อง HOSxP อาจต่างจากเครื่องนี้) */
const SQL_REPORTED = `
    SELECT h.lab_order_number no, h.hn, h.department dep, h.form_name form, h.report_date rd, h.report_time rt, h.lab_priority_id prio,
           d.name doctor, d.cid doctor_cid, k.department unit, p.sex
      FROM lab_head h
      LEFT JOIN doctor d ON d.code = h.doctor_code
      LEFT JOIN kskdepartment k ON k.depcode = h.order_department
      LEFT JOIN patient p ON p.hn = h.hn
     WHERE h.confirm_report = 'Y' AND h.report_date >= DATE(NOW() - INTERVAL ? SECOND)
       AND TIMESTAMP(h.report_date, h.report_time) >= NOW() - INTERVAL ? SECOND
     ORDER BY h.report_date, h.report_time LIMIT 500`;
async function reportedSince(secs) {
  return query(SQL_REPORTED, [secs, secs]);
}

/** รายการที่มีช่วงวิกฤตของใบสั่งเหล่านี้ */
const SQL_CRITICAL = `
    SELECT o.lab_order_number no, i.lab_items_code code, COALESCE(NULLIF(i.lab_items_display_name, ''), i.lab_items_name) name,
           i.lab_items_unit unit, o.lab_order_result result,
           i.critical_range_min_male min_m, i.critical_range_max_male max_m, i.critical_range_min_female min_f, i.critical_range_max_female max_f
      FROM lab_order o JOIN lab_items i ON i.lab_items_code = o.lab_items_code
     WHERE o.lab_order_number IN (?) AND i.alert_critical_value = 'Y'
       AND COALESCE(i.critical_range_min_male, i.critical_range_max_male, i.critical_range_min_female, i.critical_range_max_female) IS NOT NULL`;
async function criticalItems(orderNos) {
  if (!orderNos.length) return [];
  return query(SQL_CRITICAL, [orderNos]);
}

/** ค่าอยู่นอกช่วงวิกฤตไหม — เกณฑ์ตามเพศ (patient.sex 2 = หญิง) · ผลที่ไม่ใช่ตัวเลข (เช่น "<0.5", "Positive") ไม่นับ */
function critical(item, sex) {
  const v = String(item.result ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  const x = Number(v), f = String(sex) === "2";
  const min = f ? item.min_f : item.min_m, max = f ? item.max_f : item.max_m;
  if (min != null && x < min) return { x, dir: "ต่ำ", range: [min, max] };
  if (max != null && x > max) return { x, dir: "สูง", range: [min, max] };
  return null;
}

const where = (h) => [h.dep, h.unit].filter(Boolean).join(" · ");
const rangeText = ([min, max]) => min != null && max != null ? `${min}–${max}` : min != null ? `≥ ${min}` : `≤ ${max}`;

async function checkLab(since) {
  const heads = await reportedSince(since);
  if (!heads.length) return;
  const byNo = new Map(heads.map((h) => [h.no, h]));
  const items = await criticalItems([...byNo.keys()]);

  // 1. ค่าวิกฤต (รายรายการ)
  for (const it of items) {
    const h = byNo.get(it.no), c = critical(it, h.sex);
    if (!c) continue;
    const doc = LAB_CRITICAL_DOCTOR && cidHash(h.doctor_cid);
    await notify({
      event: "lab.critical", priority: "urgent", id: `labcrit:${it.no}:${it.code}`,
      title: `ค่าวิกฤต ${it.name} ${c.x}${it.unit && it.unit !== "-" ? " " + it.unit : ""} (${c.dir})`,
      fields: [["HN", h.hn], ["หน่วยงาน", where(h) || "-"], ["เกณฑ์วิกฤต", `นอกช่วง ${rangeText(c.range)}`],
        ["แพทย์ผู้สั่ง", h.doctor ?? "-"], ["รายงาน", `${fmtTime(h.rt)} น.`]],
      to: [...LAB_CRITICAL_TO, ...(doc ? [`cidhash:${doc}`] : [])],
    });
  }

  // 2. ผลแล็บออก (รายใบสั่ง)
  if (LAB_REPORTED_TO.length || LAB_REPORTED_DOCTOR) {
    for (const h of heads) {
      const doc = LAB_REPORTED_DOCTOR && cidHash(h.doctor_cid);
      const to = [...LAB_REPORTED_TO, ...(doc ? [`cidhash:${doc}`] : [])];
      if (!to.length) continue;
      await notify({
        event: "lab.reported", id: `labrep:${h.no}`,
        title: `ผลแล็บออก ${h.form ?? ""}`.trim(),
        fields: [["HN", h.hn], ["หน่วยงาน", where(h) || "-"], ["แพทย์ผู้สั่ง", h.doctor ?? "-"], ["รายงาน", `${fmtTime(h.rt)} น.`]],
        to,
      });
    }
  }
}

// ── ผลเพาะเชื้อ ─────────────────────────────────────────────────────────────────────
// รหัสรายการตาม lab_items ของ รพ. (ตรวจจากข้อมูลจริง 60 วัน — 12 พ.ย. 2569) แก้ได้ใน .env
//   Hemoculture: ผลเป็นข้อความ "No Growth After 5 Days" / "Positive ส่งตรวจต่อ." / "Gram positive cocci = …"
//   AFB:          "Negative" / "Positive 1+" / "Positive1-9 AFB/100 OF"
//   C/S + Identify: ผลเป็น "see image" (ห้องแล็บแนบภาพ) — เชื้อ/ความไวยาไม่อยู่ในฐานข้อมูลเป็นข้อความ จึงแจ้งได้แค่ "ผลออกแล้ว"
const CODES = (k, d) => LIST(k, d).map(Number).filter(Number.isFinite);
const HEMO_CODES = CODES("CULTURE_HEMO_CODES", "1312,2403");
const AFB_CODES = CODES("CULTURE_AFB_CODES", "489,491,181,498,1078");
const CS_CODES = CODES("CULTURE_CS_CODES", "1866,300,301,302,304,1306,1308,1310,1314,1316,1318,1320,1323,1724");
const CULTURE_POSITIVE_TO = LIST("CULTURE_POSITIVE_TO", LAB_CRITICAL_TO.join(","));
const CULTURE_AFB_TO = LIST("CULTURE_AFB_TO", "");            // เช่น room:ic (งานควบคุมการติดเชื้อ)
const CULTURE_CS_TO = LIST("CULTURE_CS_TO", "");              // เช่น room:pharm-asp (ทีมดูแลการใช้ยาต้านจุลชีพ)
const CULTURE_DOCTOR = opt("CULTURE_DOCTOR", "on") === "on";
const POSITIVE_RX = /^\s*(positive|gram\s*(positive|negative)|yeast|fung)/i;

const SQL_CULTURE = `
    SELECT o.lab_order_number no, o.lab_items_code code, COALESCE(NULLIF(i.lab_items_display_name, ''), i.lab_items_name) name,
           o.lab_order_result result, h.hn, h.department dep, h.report_time rt, d.name doctor, d.cid doctor_cid, k.department unit, w.name ward
      FROM lab_head h
      JOIN lab_order o ON o.lab_order_number = h.lab_order_number
      JOIN lab_items i ON i.lab_items_code = o.lab_items_code
      LEFT JOIN doctor d ON d.code = h.doctor_code
      LEFT JOIN kskdepartment k ON k.depcode = h.order_department
      LEFT JOIN ward w ON w.ward = h.ward
     WHERE h.confirm_report = 'Y' AND h.report_date >= DATE(NOW() - INTERVAL ? SECOND)
       AND TIMESTAMP(h.report_date, h.report_time) >= NOW() - INTERVAL ? SECOND
       AND o.lab_items_code IN (?)
     ORDER BY h.report_date, h.report_time LIMIT 500`;

async function checkCulture(since) {
  const codes = [...HEMO_CODES, ...AFB_CODES, ...CS_CODES];
  if (!codes.length) return;
  for (const r of await query(SQL_CULTURE, [since, since, codes])) {
    const doc = CULTURE_DOCTOR && cidHash(r.doctor_cid);
    const docTo = doc ? [`cidhash:${doc}`] : [];
    const place = r.ward || where(r) || "-";
    const result = String(r.result ?? "").trim();
    const base = [["HN", r.hn], ["หน่วยงาน", place], ["แพทย์ผู้สั่ง", r.doctor ?? "-"], ["รายงาน", `${fmtTime(r.rt)} น.`]];

    // 1. เพาะเชื้อในเลือดขึ้น / พบเชื้อ AFB → ด่วน
    const hemo = HEMO_CODES.includes(r.code), afb = AFB_CODES.includes(r.code);
    if ((hemo || afb) && POSITIVE_RX.test(result)) {
      const to = [...CULTURE_POSITIVE_TO, ...(afb ? CULTURE_AFB_TO : []), ...docTo];
      if (to.length) await notify({
        event: "lab.culture_positive", priority: "urgent", id: `labcx:${r.no}:${r.code}`,
        title: `${hemo ? "เพาะเชื้อในเลือดขึ้น" : "พบเชื้อ AFB"} — ${r.name}`,
        fields: [["ผล", result.slice(0, 120)], ...base],
        to,
      });
    }

    // 2. ผลเพาะเชื้อ/ความไวยาออก (ดูภาพผลใน HOSxP)
    if (CS_CODES.includes(r.code) && result) {
      const to = [...CULTURE_CS_TO, ...docTo];
      if (to.length) await notify({
        event: "lab.culture_result", id: `labcs:${r.no}:${r.code}`,
        title: `ผลเพาะเชื้อออกแล้ว — ${r.name}`,
        fields: [["ผล", /^see image/i.test(result) ? "ดูภาพผลใน HOSxP (เชื้อ + ความไวยา)" : result.slice(0, 120)], ...base],
        to,
      });
    }
  }
}

// ── ผลอ่านภาพรังสี ───────────────────────────────────────────────────────────────────
// ส่วนใหญ่ของ รพ. อ่านฟิล์มนอก HOSxP — มีผลอ่านเป็นข้อความเฉพาะบางรายการ (US / Mammogram ~2%) → แจ้งเฉพาะที่มีข้อความจริง
// xray_critical_result = แบบฟอร์มรายงานภาวะวิกฤตของ HOSxP (ตอนนี้ยังไม่มีใครใช้ — รังสีแพทย์เริ่มลงเมื่อไรจะแจ้งทันที)
const XRAY_REPORTED_TO = LIST("XRAY_REPORTED_TO", "");
const XRAY_DOCTOR = opt("XRAY_DOCTOR", "on") === "on";
const XRAY_TEXT = opt("XRAY_TEXT", "off") === "on";          // ใส่ข้อความผลอ่าน (ตัด 600 ตัวอักษร) ในการ์ด — ค่าเริ่มต้นไม่ใส่
const XRAY_CRITICAL_TO = LIST("XRAY_CRITICAL_TO", LAB_CRITICAL_TO.join(","));

const SQL_XRAY_REPORTED = `
    SELECT r.xn, r.hn, r.an, r.report_time rt, x.xray_items_name item, rd.name doctor, rd.cid doctor_cid, dd.name reader,
           w.name ward, ${XRAY_TEXT ? "LEFT(r.report_text, 2000)" : "NULL"} text
      FROM xray_report r
      LEFT JOIN xray_items x ON x.xray_items_code = r.xray_items_code
      LEFT JOIN doctor rd ON rd.code = r.request_doctor
      LEFT JOIN doctor dd ON dd.code = r.report_doctor
      LEFT JOIN ipt i ON i.an = r.an
      LEFT JOIN ward w ON w.ward = i.ward
     WHERE r.confirm = 'Y' AND LENGTH(r.report_text) > 20
       AND r.report_date >= DATE(NOW() - INTERVAL ? SECOND)
       AND TIMESTAMP(r.report_date, r.report_time) >= NOW() - INTERVAL ? SECOND
     ORDER BY r.report_date, r.report_time LIMIT 300`;

const SQL_XRAY_CRITICAL = `
    SELECT c.xray_critical_result_id id, c.xn, c.finding_text, c.found_datetime, f.category_code cat, f.category_name catname,
           r.hn, x.xray_items_name item, rd.name doctor, rd.cid doctor_cid, fd.name reader, w.name ward
      FROM xray_critical_result c
      LEFT JOIN xray_finding_category f ON f.xray_finding_category_id = c.xray_finding_category_id
      LEFT JOIN xray_report r ON r.xn = c.xn
      LEFT JOIN xray_items x ON x.xray_items_code = r.xray_items_code
      LEFT JOIN doctor rd ON rd.code = r.request_doctor
      LEFT JOIN doctor fd ON fd.code = c.found_doctor
      LEFT JOIN ipt i ON i.an = r.an
      LEFT JOIN ward w ON w.ward = i.ward
     WHERE c.found_datetime >= NOW() - INTERVAL ? SECOND
     ORDER BY c.found_datetime LIMIT 100`;

const oneLine = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

async function checkXray(since) {
  for (const r of await query(SQL_XRAY_REPORTED, [since, since])) {
    const doc = XRAY_DOCTOR && cidHash(r.doctor_cid);
    const to = [...XRAY_REPORTED_TO, ...(doc ? [`cidhash:${doc}`] : [])];
    if (!to.length) continue;
    await notify({
      event: "xray.reported", id: `xrep:${r.xn}`,
      title: `ผลอ่านภาพรังสีออก — ${r.item ?? "X-ray"}`,
      text: XRAY_TEXT && r.text ? oneLine(r.text, 600) : undefined,
      fields: [["HN", r.hn], ["หน่วยงาน", r.ward || (r.an ? "IPD" : "OPD")], ["ผู้อ่าน", r.reader ?? "-"],
        ["แพทย์ผู้สั่ง", r.doctor ?? "-"], ["รายงาน", `${fmtTime(r.rt)} น.`]],
      to,
    });
  }
  for (const c of await query(SQL_XRAY_CRITICAL, [since])) {
    const doc = cidHash(c.doctor_cid);
    await notify({
      event: "xray.critical", priority: c.cat === "SIG" ? "normal" : "urgent", id: `xcrit:${c.id}`,
      title: `ผลภาพรังสี${c.catname ? ` ${c.catname}` : "วิกฤต"} — ${c.item ?? "X-ray"}`,
      text: oneLine(c.finding_text, 600) || undefined,
      fields: [["HN", c.hn ?? "-"], ["หน่วยงาน", c.ward || "-"], ["ผู้อ่าน", c.reader ?? "-"],
        ["แพทย์ผู้สั่ง", c.doctor ?? "-"], ["พบเมื่อ", `${String(c.found_datetime ?? "").slice(11, 16)} น.`]],
      to: [...XRAY_CRITICAL_TO, ...(doc ? [`cidhash:${doc}`] : [])],
    });
  }
}

// ── ผู้ป่วยใน: กลับมานอนซ้ำภายใน 48 ชม. หลังจำหน่าย ──────────────────────────────────────
// ข้อมูลจริง 90 วัน (12 พ.ย. 2569): เข้าเงื่อนไขเวลา 54 ราย ตัดออก
//   - ครั้งก่อนจำหน่ายแบบส่งต่อ (dchtype 04) 11 ราย — ส่วนใหญ่ไปทำ MRI ที่อื่นแล้วรับกลับ ไม่ใช่การกลับมานอนซ้ำ
//   - prediag ขึ้นต้น "รับกลับ…" ~5 ราย (จำหน่ายแบบปกติแต่ไปทำ MRI แล้วรับกลับ) — กรองในโปรแกรม เพราะการเชื่อมต่อ HOSxP เป็น tis620
//     ใส่ข้อความไทยใน SQL แล้วเทียบไม่ตรง
//   - ทารกแรกเกิด (ipt_type 3) และ Home Ward (41, 47)
//   เหลือ ~38 ราย / 90 วัน (~3 ราย/สัปดาห์)
// prediag ไม่ส่งออกไปในการ์ด — บางรายมีชื่อคนอยู่ในข้อความ (|ชื่อ|…)
const READMIT_HOURS = Number(opt("READMIT_HOURS", "48"));
const READMIT_LOOKBACK_MIN = Number(opt("READMIT_LOOKBACK_MIN", "360"));   // admit อาจลงช้ากว่าเวลาจริง → อ่านย้อน 6 ชม. (ส่งแล้วจำไว้)
const READMIT_TO = LIST("READMIT_TO", "");
const READMIT_DOCTOR = opt("READMIT_DOCTOR", "on") === "on";
const READMIT_EXCLUDE_WARDS = LIST("READMIT_EXCLUDE_WARDS", "41,47");
// prediag มักขึ้นต้นด้วย "|ชื่อผู้บันทึก|" — ตัดส่วนนั้นออกก่อน แล้วดูว่าขึ้นต้นด้วย "รับกลับ" ไหม
const plannedReturn = (prediag) => /^รับกลับ/.test(String(prediag ?? "").replace(/^\s*(\|[^|]*\|\s*)+/, "").trim());

const SQL_READMIT = `
    SELECT b.an, b.hn, b.regdate, b.regtime, b.ward, wb.name ward_name, b.prediag,
           a.an prev_an, a.dchdate prev_dchdate, a.dchtime prev_dchtime, a.dchtype prev_dchtype, dt.name prev_dchtype_name,
           a.ward prev_ward, wa.name prev_ward_name, a.ipt_type prev_ipt_type,
           TIMESTAMPDIFF(MINUTE, TIMESTAMP(a.dchdate, a.dchtime), TIMESTAMP(b.regdate, b.regtime)) gap_min,
           (SELECT icd10 FROM iptdiag WHERE an = a.an AND diagtype = '1' LIMIT 1) prev_pdx,
           dd.name prev_doctor, dd.cid prev_doctor_cid, ad.name adm_doctor, ad.cid adm_doctor_cid
      FROM ipt b
      JOIN ipt a ON a.hn = b.hn AND a.an <> b.an AND a.dchdate IS NOT NULL
       AND TIMESTAMP(a.dchdate, a.dchtime) BETWEEN TIMESTAMP(b.regdate, b.regtime) - INTERVAL ? HOUR AND TIMESTAMP(b.regdate, b.regtime)
      LEFT JOIN ward wb ON wb.ward = b.ward
      LEFT JOIN ward wa ON wa.ward = a.ward
      LEFT JOIN dchtype dt ON dt.dchtype = a.dchtype
      LEFT JOIN doctor dd ON dd.code = a.dch_doctor
      LEFT JOIN doctor ad ON ad.code = b.admdoctor
     WHERE b.regdate >= DATE(NOW() - INTERVAL ? MINUTE)
       AND TIMESTAMP(b.regdate, b.regtime) >= NOW() - INTERVAL ? MINUTE
       AND COALESCE(a.dchtype, '') NOT IN ('04', '08', '09')
       AND COALESCE(a.ipt_type, 0) <> 3 AND COALESCE(b.ipt_type, 0) <> 3
       AND b.ward NOT IN (?) AND a.ward NOT IN (?)
     ORDER BY b.regdate, b.regtime, a.dchdate DESC, a.dchtime DESC LIMIT 100`;

const gapText = (m) => m < 60 ? `${m} นาที` : `${Math.floor(m / 60)} ชม.${m % 60 ? ` ${m % 60} นาที` : ""}`;

async function checkReadmit(lookbackMin) {
  const ex = READMIT_EXCLUDE_WARDS.length ? READMIT_EXCLUDE_WARDS : ["__none__"];
  const rows = await query(SQL_READMIT, [READMIT_HOURS, lookbackMin, lookbackMin, ex, ex]);
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.an)) continue;   // จำหน่ายหลายครั้งใน 48 ชม. → แจ้งครั้งเดียวต่อ AN ใหม่ (แถวแรก = ครั้งก่อนหน้าที่ใกล้สุดตามลำดับ)
    if (plannedReturn(r.prediag)) continue;
    seen.add(r.an);
    const docs = READMIT_DOCTOR ? [cidHash(r.prev_doctor_cid), cidHash(r.adm_doctor_cid)].filter(Boolean).map((h) => `cidhash:${h}`) : [];
    const flags = [r.prev_ipt_type === 5 && "ครั้งก่อนเป็น ODS", ["02", "03"].includes(r.prev_dchtype) && `ครั้งก่อน${r.prev_dchtype_name}`].filter(Boolean);
    await notify({
      event: "ipd.readmit48", id: `readmit:${r.an}`,
      title: `กลับมานอนซ้ำภายใน ${gapText(r.gap_min)} หลังจำหน่าย`,
      text: flags.length ? flags.join(" · ") : undefined,
      fields: [["HN", r.hn], ["รับใหม่", `${r.ward_name ?? r.ward} · ${String(r.regdate).slice(5)} ${fmtTime(r.regtime)} น.`],
        ["แพทย์รับใหม่", r.adm_doctor ?? "-"],
        ["ครั้งก่อน", `${r.prev_ward_name ?? r.prev_ward} · จำหน่าย ${String(r.prev_dchdate).slice(5)} ${fmtTime(r.prev_dchtime)} น.`],
        ["วินิจฉัยหลักครั้งก่อน", r.prev_pdx ?? "ยังไม่ลงรหัส"], ["แพทย์ผู้จำหน่าย", r.prev_doctor ?? "-"]],
      to: [...new Set(["default", ...READMIT_TO, ...docs])],
    });
  }
}

async function checkIpd() { await checkReadmit(DRY ? WINDOW_MIN : READMIT_LOOKBACK_MIN); }
const CHECKS = [checkLab, checkCulture, checkXray, checkIpd];

// แจ้งระบบแจ้งเตือนว่าแต่ละเรื่องดึงข้อมูลอย่างไร → ปุ่ม "ดู query" ในหน้าจัดการ AranKub (ส่ง SQL ตัวเดียวกับที่รันจริง)
// ? = ค่าที่ใส่ตอนรัน · ไฟล์ทดลองรันเองได้: sql/lab-check.sql
const show = (sql) => sql.replace(/^\n/, "").replace(/^ {4}/gm, "");
const DOCS = {
  "lab.reported": {
    note: `ทุก ${POLL_MS / 1000} วินาที อ่านใบสั่งแล็บที่ยืนยันผลแล้ว (confirm_report = 'Y') ซึ่งเวลารายงานอยู่ในช่วง ${LOOKBACK_MIN} นาทีล่าสุด`
      + ` (? ทั้งสองตัว = ${LOOKBACK_MIN * 60} วินาที)\n1 ใบสั่ง = 1 แจ้งเตือน ถึงแพทย์ผู้สั่ง (lab_head.doctor_code → doctor) ที่เปิดรับเอง`
      + `\nส่งถึงแพทย์ด้วย SHA-256 ของ doctor.cid (ไม่ส่งเลขบัตรจริง) · ข้อความมี HN + หน่วยงาน ไม่มีชื่อผู้ป่วย · ส่งแล้วจำไว้ ไม่ส่งซ้ำ`,
    sql: show(SQL_REPORTED),
  },
  "lab.critical": {
    note: `ขั้นที่ 1: หาใบสั่งที่ยืนยันผลแล้วในช่วง ${LOOKBACK_MIN} นาทีล่าสุด (query เดียวกับ "ผลแล็บออก")`
      + `\nขั้นที่ 2: query ด้านล่าง ดึงรายการของใบเหล่านั้น (? = เลขใบสั่ง) เฉพาะรายการที่ตั้งช่วงวิกฤตและเปิด alert_critical_value ใน lab_items`
      + `\nขั้นที่ 3 (ในโปรแกรม): ผลต้องเป็นตัวเลขล้วน · ใช้เกณฑ์ตามเพศ (patient.sex = 2 หญิง, นอกนั้นเกณฑ์ชาย)`
      + ` · ต่ำกว่า min = "ต่ำ" สูงกว่า max = "สูง" · ผลแบบ ">600", "<0.5", "Positive" ไม่นับ`
      + `\n1 รายการ = 1 แจ้งเตือน (ด่วน) → ${LAB_CRITICAL_TO.join(", ") || "-"}${LAB_CRITICAL_DOCTOR ? " + แพทย์ผู้สั่ง" : ""}`,
    sql: show(SQL_CRITICAL),
  },
  "lab.culture_positive": {
    label: "HOSxP: เพาะเชื้อขึ้น / พบเชื้อ AFB",
    note: `ทุก ${POLL_MS / 1000} วินาที อ่านรายการเพาะเชื้อที่ยืนยันผลแล้วในช่วง ${LOOKBACK_MIN} นาทีล่าสุด (? สองตัวแรก = ${LOOKBACK_MIN * 60} วินาที, ตัวที่สาม = รหัสรายการ)`
      + `\nHemoculture (lab_items_code ${HEMO_CODES.join(", ")}) และ AFB (${AFB_CODES.join(", ")})`
      + `\nแจ้งเมื่อผลขึ้นต้นด้วย "Positive" / "Gram positive|negative" / "Yeast" / "Fungus" — "No Growth…" และ "Negative" ไม่แจ้ง`
      + `\n1 รายการ = 1 แจ้งเตือน (ด่วน) → ${CULTURE_POSITIVE_TO.join(", ") || "-"}${CULTURE_AFB_TO.length ? ` (AFB เพิ่ม ${CULTURE_AFB_TO.join(", ")})` : ""}${CULTURE_DOCTOR ? " + แพทย์ผู้สั่ง" : ""}`
      + `\nถ้าผลเดิม "No Growth After 2 Days" แล้วภายหลังแก้เป็น Positive จะแจ้งตอนแก้`,
    sql: show(SQL_CULTURE),
  },
  "lab.culture_result": {
    label: "HOSxP: ผลเพาะเชื้อออก",
    note: `query เดียวกับ "เพาะเชื้อขึ้น" เฉพาะรายการ C/S และ Identify (${CS_CODES.join(", ")})`
      + `\nห้องแล็บลงผลเป็นภาพ (ช่องผล = "see image") เชื้อและความไวยาจึงไม่อยู่ในฐานข้อมูลเป็นข้อความ — การ์ดบอกแค่ว่าผลออกแล้ว ให้เปิดดูภาพใน HOSxP`
      + `\nส่งถึง${CULTURE_DOCTOR ? "แพทย์ผู้สั่ง" : ""}${CULTURE_CS_TO.length ? ` + ${CULTURE_CS_TO.join(", ")}` : ""}`,
    sql: show(SQL_CULTURE),
  },
  "xray.reported": {
    label: "HOSxP: ผลอ่านภาพรังสีออก",
    note: `ทุก ${POLL_MS / 1000} วินาที อ่านผลอ่านภาพรังสีที่ยืนยันแล้ว (confirm = 'Y') และมีข้อความผลอ่านจริง ในช่วง ${LOOKBACK_MIN} นาทีล่าสุด`
      + `\nรพ. อ่านฟิล์มส่วนใหญ่นอก HOSxP — ที่มีข้อความในฐานข้อมูลคือ US / Mammogram ราว 2% ของงานรังสี`
      + `\n1 ภาพ (xn) = 1 แจ้งเตือน ถึงแพทย์ผู้สั่ง (xray_report.request_doctor)${XRAY_REPORTED_TO.length ? ` + ${XRAY_REPORTED_TO.join(", ")}` : ""}`
      + ` · ${XRAY_TEXT ? "ใส่ข้อความผลอ่าน 600 ตัวอักษรแรกในการ์ด" : "ไม่ใส่ข้อความผลอ่านในการ์ด (เปิด XRAY_TEXT=on ได้)"}`,
    sql: show(SQL_XRAY_REPORTED),
  },
  "xray.critical": {
    label: "HOSxP: ผลภาพรังสีวิกฤต",
    note: `แบบฟอร์มรายงานภาวะวิกฤตทางรังสีของ HOSxP (xray_critical_result) — แจ้งทันทีที่รังสีแพทย์ลงในช่วง ${LOOKBACK_MIN} นาทีล่าสุด`
      + `\nวิกฤต / เร่งด่วน = ด่วน (มีปุ่มรับทราบ) · สำคัญไม่คาดคิด = ปกติ → ${XRAY_CRITICAL_TO.join(", ") || "-"} + แพทย์ผู้สั่ง`
      + `\nตอนนี้ตารางนี้ยังว่าง (ยังไม่มีใครใช้แบบฟอร์มนี้)`,
    sql: show(SQL_XRAY_CRITICAL),
  },
  "ipd.readmit48": {
    label: "HOSxP: กลับมานอนซ้ำภายใน 48 ชม.",
    note: `ทุก ${POLL_MS / 1000} วินาที อ่านผู้ป่วยที่รับใหม่ในช่วง ${READMIT_LOOKBACK_MIN / 60} ชม. ล่าสุด แล้วหาการจำหน่ายครั้งก่อนของ HN เดียวกันภายใน ${READMIT_HOURS} ชม. ก่อนรับใหม่`
      + `\n? ตามลำดับ = ${READMIT_HOURS} ชม., ${READMIT_LOOKBACK_MIN} นาที (2 ตัว), หอผู้ป่วยที่ไม่นับ (${READMIT_EXCLUDE_WARDS.join(", ") || "-"} = Home Ward) 2 ตัว`
      + `\nไม่นับ: ครั้งก่อนจำหน่ายแบบส่งต่อ (dchtype 04 — ส่วนใหญ่ไปทำ MRI ที่อื่นแล้วรับกลับ) · ทารกแรกเกิด (ipt_type 3)`
      + ` · ในโปรแกรม: prediag ขึ้นต้น "รับกลับ…" (การเชื่อมต่อ HOSxP เป็น tis620 ใส่ข้อความไทยใน SQL แล้วเทียบไม่ตรง)`
      + `\n1 AN ใหม่ = 1 แจ้งเตือน → ผู้รับประจำ/ห้องประจำที่ตั้งในหน้านี้${READMIT_TO.length ? ` + ${READMIT_TO.join(", ")}` : ""}${READMIT_DOCTOR ? " + แพทย์ผู้จำหน่ายครั้งก่อน + แพทย์รับใหม่" : ""}`
      + `\nไม่ส่ง prediag ออกไป (บางรายมีชื่อคนอยู่ในข้อความ) · ข้อมูล 90 วัน: ~38 ราย (~3 ราย/สัปดาห์)`,
    sql: show(SQL_READMIT),
  },
};
async function describe() {
  try {
    const res = await fetch(API.replace(/\/?$/, "/describe"), {
      method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ events: DOCS }), signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) log("ส่งคำอธิบาย query ไม่สำเร็จ", res.status);
  } catch (e) { log("ส่งคำอธิบาย query ไม่สำเร็จ:", e.message); }
}

// ห้องแล็บมักลง "เวลารายงาน" ก่อนกดยืนยันจริง → อ่านย้อนหลังเต็มช่วงทุกรอบ ไม่ตัดที่เวลาเปิดบริการ (ส่งแล้วจำไว้ ไม่ซ้ำ)
const WINDOW_MIN = DRY ? Number(process.argv[process.argv.indexOf("--dry-run") + 1] || 60) : LOOKBACK_MIN;

async function tick() {
  const since = WINDOW_MIN * 60;   // วินาทีย้อนหลัง
  for (const check of CHECKS) {
    try { await check(since); } catch (e) { log(check.name, "ผิดพลาด:", e.message); }
  }
}

if (!KEY && !DRY) throw new Error("ต้องตั้ง ARANCHAT_KEY ใน .env");
log(`HOSxP bridge เริ่ม${DRY ? " (ทดลอง ไม่ส่งจริง)" : ""} · ค่าวิกฤต → ${LAB_CRITICAL_TO.join(",") || "-"}${LAB_CRITICAL_DOCTOR ? " + แพทย์ผู้สั่ง" : ""}`
  + ` · ผลแล็บออก → ${LAB_REPORTED_TO.join(",") || "-"}${LAB_REPORTED_DOCTOR ? " + แพทย์ผู้สั่ง" : ""}`);
if (DRY) { await tick(); await db.end(); }
else {
  await describe();
  priming = sent.size === 0;   // มีประวัติจากรอบก่อน (restart) → ส่งต่อได้เลย ไม่ต้องจำใหม่
  await tick();
  if (priming) { priming = false; log(`จำรายการเดิมในช่วง ${LOOKBACK_MIN} นาทีไว้ ${sent.size} รายการ (ไม่ส่ง) — ส่งเฉพาะรายการใหม่จากนี้`); remember("primed"); }
  setInterval(tick, POLL_MS);
}
