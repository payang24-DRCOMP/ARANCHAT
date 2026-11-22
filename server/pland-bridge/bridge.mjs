// Plan-D → AranChat: รับเหตุการณ์ (webhook) จาก Plan-D แล้วส่งแจ้งเตือนเข้าแชทผ่าน https://chat.arankub.com/api/notify
// ใช้ key ของระบบ "Plan-D" (.env) เหมือนระบบภายนอกทั่วไป (แบบเดียวกับ hosxp-bridge)
//
// เรื่องที่ส่ง (ห้องปลายทางตั้งใน .env — ไม่ตั้ง = ห้องตั้งต้นด้านล่าง · ตั้งเป็นค่าว่าง = ใช้ผู้รับประจำที่ตั้งในหน้าจัดการแจ้งเตือน)
//   แจ้งลา        leave.*               → LEAVE_TO      (room:pland-leave)
//   ไปราชการ      travel_request.*      → TRAVEL_TO     (room:pland-travel)
//   แจ้งซ่อม      asset_maintenance.*   → REPAIR_TO     (room:pland-repair)
//   ห้องประชุม    resource_booking.* ที่เป็น meeting_room → ROOM_TO (room:pland-meeting-room)
//   ใช้รถ        resource_booking.* ที่เป็น vehicle      → VEHICLE_TO (room:pland-vehicle)
//   จองอื่น ๆ     resource_booking.* อุปกรณ์/สถานที่      → BOOKING_TO (ค่าตั้งต้น = ห้องเดียวกับ ROOM_TO)
//   ประชุม        meeting.create / meeting.update        → MEETING_TO (room:pland-meeting)
//   หนังสือเข้า   ยังไม่มีใน Plan-D API v1 — ถ้า Plan-D เพิ่มเหตุการณ์ correspondence.* / saraban.* / document.* จะส่งเข้า DOC_TO ให้เอง
//
// Plan-D ส่งแค่ "กริ่ง" (เกิดอะไรกับรายการ id ไหน) ไม่มีเนื้อข้อมูล → ใช้บัญชีบริการ (client_credentials) ไปอ่านรายละเอียดจาก API
// อ่านไม่ได้ (ยังไม่มีบัญชีบริการ/ไม่มีสิทธิ์/หาไม่เจอ) ก็ยังส่งแจ้งเตือนแบบสั้น + ลิงก์เปิดใน Plan-D
// แจ้งซ่อม: API v1 ยังไม่มีเส้นอ่านคำขอซ่อม → ส่งแบบสั้นเสมอ
//
// รัน:   pm2 start bridge.mjs --name pland-bridge
// ทดลอง: node bridge.mjs --dry-run              (รับจริง แต่พิมพ์การ์ดแทนส่งเข้าแชท)
//        node bridge.mjs --listen [--dry-run]   (ดึงเหตุการณ์จริงแบบ webhook listen ด้วย PLAND_DEV_TOKEN — ใช้ทดสอบกับหน่วยทดลองใช้
//                                                ผู้ดูแลต้องติ๊ก "อนุญาตทดสอบบนเครื่องผู้พัฒนา" ก่อน · หมดอายุเองใน 8 ชั่วโมง)
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createPersonal, nameKey } from "./personal.mjs";
import { loadRoutes, routeOf, KNOWN_EVENTS } from "./routes.mjs";
import { createUnits } from "./units.mjs";
import { createDaily } from "./daily.mjs";
import { createQuery } from "./query.mjs";
import { createSettings } from "./settings.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const readEnv = (file) => {
  try {
    return Object.fromEntries(fs.readFileSync(file, "utf8").split("\n")
      .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
  } catch { return {}; }
};
const cfg = { ...readEnv(HERE + ".env"), ...process.env };
const opt = (k, d) => cfg[k] ?? d;
/** รายการผู้รับ: ไม่ตั้ง = ค่าตั้งต้น · ตั้งเป็นค่าว่าง = [] (ใช้ผู้รับประจำในหน้าจัดการ) */
const LIST = (k, d) => String(opt(k, d)).split(",").map((s) => s.trim()).filter(Boolean);

const PLAND = opt("PLAND_URL", "https://pland.mipble.com").replace(/\/+$/, "");
const API = `${PLAND}/api/apps/v1`;
const SECRET = cfg.PLAND_WEBHOOK_SECRET?.trim();
// บัญชีบริการ: ไม่ตั้งแยก = ลองใช้ client ของแอป (Plan-D ผูกบัญชีบริการกับแอปได้ — ผู้ดูแลเปิดที่แท็บบัญชีบริการของแอปนั้น)
const SVC_ID = (cfg.PLAND_SERVICE_CLIENT_ID || cfg.PLAND_CLIENT_ID)?.trim();
const SVC_SECRET = (cfg.PLAND_SERVICE_CLIENT_SECRET || cfg.PLAND_CLIENT_SECRET)?.trim();
const ARANCHAT = opt("ARANCHAT_URL", "https://chat.arankub.com/api/notify").replace(/\/+$/, "");
const KEY = cfg.ARANCHAT_KEY;
const [BIND_HOST, BIND_PORT] = opt("PUBLIC_BIND", "10.42.0.1:3213").split(":");
const WEBHOOK_PATH = opt("WEBHOOK_PATH", "/api/pland/webhook");
const BASE_PATH = WEBHOOK_PATH.replace(/\/webhook$/, "");
const [HOOK_HOST, HOOK_PORT] = opt("HOOK_BIND", "127.0.0.1:3213").split(":");
const DRY = process.argv.includes("--dry-run");
const LISTEN = process.argv.includes("--listen");
const SHOW_LEAVE_TYPE = opt("LEAVE_SHOW_TYPE", "on") === "on";   // ห้องแจ้งเตือนไม่เข้ารหัส — ปิดได้ถ้าไม่อยากให้เห็นว่าลาประเภทใด

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ── เรื่องแจ้งเตือน ─────────────────────────────────────────────────────────────────
const CATS = {
  leave: { label: "แจ้งลา", icon: "🏖️", to: LIST("LEAVE_TO", "room:pland-leave"), link: opt("LINK_LEAVE", `${PLAND}/hr/leave`) },
  travel: { label: "ไปราชการ", icon: "🚐", to: LIST("TRAVEL_TO", "room:pland-travel"), link: opt("LINK_TRAVEL", PLAND) },
  repair: { label: "แจ้งซ่อม", icon: "🔧", to: LIST("REPAIR_TO", "room:pland-repair"), link: opt("LINK_REPAIR", PLAND) },
  room: { label: "ห้องประชุม", icon: "🏢", to: LIST("ROOM_TO", "room:pland-meeting-room"), link: opt("LINK_BOOKING", PLAND) },
  vehicle: { label: "ใช้รถ", icon: "🚗", to: LIST("VEHICLE_TO", "room:pland-vehicle"), link: opt("LINK_BOOKING", PLAND) },
  booking: { label: "จองทรัพยากร", icon: "📅", to: LIST("BOOKING_TO", opt("ROOM_TO", "room:pland-meeting-room")), link: opt("LINK_BOOKING", PLAND) },
  meeting: { label: "ประชุม", icon: "👥", to: LIST("MEETING_TO", "room:pland-meeting"), link: opt("LINK_MEETING", PLAND) },
  doc: { label: "หนังสือเข้า", icon: "📨", to: LIST("DOC_TO", "room:pland-saraban"), link: opt("LINK_DOC", PLAND) },
};
const ACTIONS = {
  submit: ["ยื่นคำขอ", "info"], create: ["สร้างใหม่", "info"], request_created: ["แจ้งซ่อมใหม่", "info"],
  approve: ["อนุมัติแล้ว", "success"], reject: ["ไม่อนุมัติ", "warning"], cancel: ["ยกเลิก", "warning"],
  undo_approve: ["ถอนการอนุมัติ", "warning"], undo_reject: ["ถอนการไม่อนุมัติ", "info"],
  start_work: ["เริ่มดำเนินการซ่อม", "info"], complete: ["ซ่อมเสร็จแล้ว", "success"], update: ["มีการแก้ไข", "info"],
  // หนังสือเข้า (ชื่อจังหวะเดาไว้ล่วงหน้า — Plan-D ยังไม่มีเหตุการณ์นี้ · ไม่รู้จัก = แสดงชื่อจังหวะตามที่ส่งมา)
  receive: ["หนังสือเข้าใหม่", "info"], assign: ["มอบหมาย/ส่งต่อ", "info"], forward: ["ส่งต่อ", "info"], acknowledge: ["รับทราบแล้ว", "success"],
};
// เส้นทาง (routes.mjs + routes.json): เรื่องไหน จังหวะไหน ส่งถึงเจ้าตัว / ห้องกลุ่มงาน / ห้องตามเรื่อง
const ROUTES = loadRoutes(HERE + "routes.json", log);
const DOC_EVENT = /^(correspondence|saraban|document|incoming_document|e_?doc)\./;
const actionOf = (type) => type.split(".").slice(1).join(".");
function categoryOf(type) {
  const domain = type.split(".")[0];
  if (DOC_EVENT.test(type)) return "doc";
  return { leave: "leave", travel_request: "travel", asset_maintenance: "repair", resource_booking: "booking", meeting: "meeting" }[domain] ?? null;
}
/** เหตุการณ์นี้ต้องส่งแบบใดแบบหนึ่งไหม (การจอง: ยังไม่รู้ว่าห้อง/รถ → ดูทุกชนิด) */
function wanted(type) {
  const cat = categoryOf(type);
  if (!cat) return false;
  const cats = cat === "booking" ? ["room", "vehicle", "booking"] : [cat];
  return cats.some((c) => Object.values(routeOf(ROUTES, c, actionOf(type))).some(Boolean));
}

// ── วันที่แบบไทย (พ.ศ.) ───────────────────────────────────────────────────────────────
const TZ = "Asia/Bangkok";
const fmtDate = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
const fmtDateTime = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ });
const fmtTime = new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayKey = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
/** วันที่อย่างเดียว "2026-11-20" (ไม่มีเขตเวลา) */
const thaiDate = (d) => (d ? fmtDate.format(new Date(`${String(d).slice(0, 10)}T00:00:00Z`)) : "");
function thaiDateRange(a, b) {
  if (!b || String(b).slice(0, 10) === String(a).slice(0, 10)) return thaiDate(a);
  return `${thaiDate(a)} – ${thaiDate(b)}`;
}
/** ช่วงเวลา ISO มีเขตเวลา — วันเดียวกัน: "20 พ.ย. 69 09:00 – 12:00 น." */
function thaiTimeRange(a, b) {
  if (!a) return "";
  if (!b) return `${fmtDateTime.format(new Date(a))} น.`;
  return dayKey(a) === dayKey(b)
    ? `${fmtDateTime.format(new Date(a))} – ${fmtTime.format(new Date(b))} น.`
    : `${fmtDateTime.format(new Date(a))} – ${fmtDateTime.format(new Date(b))} น.`;
}
/** งวดเดือน YYYY-MM รอบวันที่เกิดเหตุการณ์ (ใช้ค้นรายการตาม id เพราะ API ไม่มีตัวกรอง id) */
function monthsAround(iso, before, after) {
  const d = new Date(iso ?? Date.now());
  const [y, m] = d.toLocaleDateString("en-CA", { timeZone: TZ }).split("-").map(Number);
  const offsets = [];
  for (let i = -before; i <= after; i++) offsets.push(i);
  // เดือนของเหตุการณ์ก่อน แล้วค่อยถัดไป/ย้อนหลัง (ส่วนใหญ่ลา/จองล่วงหน้า — เท่ากันให้เดือนถัดไปก่อน)
  offsets.sort((p, q) => Math.abs(p) - Math.abs(q) || q - p);
  return offsets.map((i) => new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7));
}

// ── Plan-D API ด้วยบัญชีบริการ ───────────────────────────────────────────────────────
let svcToken = null;   // { token, exp }
async function serviceToken() {
  if (!SVC_ID || !SVC_SECRET) return null;
  if (svcToken && Date.now() < svcToken.exp) return svcToken.token;
  const res = await fetch(`${PLAND}/api/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: SVC_ID, client_secret: SVC_SECRET }),
    signal: AbortSignal.timeout(15_000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.access_token) throw new Error(`ขอ token บัญชีบริการไม่ได้ (HTTP ${res.status} ${out.error ?? ""} ${out.error_description ?? ""})`.trim());
  if (out.scope_withheld) log("⚠️ บัญชีบริการยังไม่มีบทบาทสำหรับสิทธิ์:", [].concat(out.scope_withheld).join(" "), "— ให้ผู้ดูแลเพิ่มบทบาทที่ ตั้งค่า → แอปภายนอก → บัญชีบริการ");
  svcToken = { token: out.access_token, exp: Date.now() + (Number(out.expires_in ?? 3600) - 120) * 1000 };
  return svcToken.token;
}

const pageCache = new Map();   // url → { at, json } (หลายเหตุการณ์ติดกันของเรื่องเดียว ไม่ต้องดึงซ้ำ)
async function planDGet(path, query) {
  const token = await serviceToken();
  if (!token) return null;
  const url = `${API}${path}?${new URLSearchParams(query)}`;
  const hit = pageCache.get(url);
  if (hit && Date.now() - hit.at < 20_000) return hit.json;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401) svcToken = null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Plan-D ${path} HTTP ${res.status}: ${json?.error?.message ?? json?.message ?? ""}`), { status: res.status });
  pageCache.set(url, { at: Date.now(), json });
  if (pageCache.size > 200) pageCache.delete(pageCache.keys().next().value);
  return json;
}

/** หาแถวที่ id ตรงจากเส้นรายการ (ลองทีละชุดตัวกรอง · วนหน้าไม่เกิน maxPages) */
async function findById(path, id, queries, maxPages = 6) {
  if (!id) return null;
  for (const q of queries) {
    for (let page = 1; page <= maxPages; page++) {
      const json = await planDGet(path, { ...q, page: String(page), pageSize: "50" });
      if (!json) return null;
      const row = json.items?.find((r) => r.id === id);
      if (row) return row;
      if (page * (json.pageSize ?? 50) >= (json.total ?? 0)) break;
    }
  }
  return null;
}

async function details(payload) {
  const id = payload.entity?.id;
  const months = (b, a) => monthsAround(payload.occurredAt, b, a).map((month) => ({ month }));
  switch (payload.type.split(".")[0]) {
    case "leave": return findById("/leave-requests", id, months(2, 3));
    case "travel_request": return findById("/travel-requests", id, months(2, 3));
    case "resource_booking": return findById("/bookings", id, months(1, 3).map((q) => ({ ...q, scope: "all" })));
    case "meeting": return findById("/meetings", id, [{}], 4);
    default: {
      // แจ้งซ่อม / หนังสือเข้า: API v1 ยังไม่มีเส้นอ่าน — Plan-D เปิดเมื่อไหร่ ตั้งพาธใน .env (เช่น REPAIR_DETAIL_PATH=/asset-maintenance)
      const path = categoryOf(payload.type) === "repair" ? cfg.REPAIR_DETAIL_PATH : categoryOf(payload.type) === "doc" ? cfg.DOC_DETAIL_PATH : null;
      return path ? findById(path, id, [{}, ...months(1, 1)]) : null;
    }
  }
}

// ── สร้างการ์ด ─────────────────────────────────────────────────────────────────────
const TRANSPORT = { government_vehicle: "รถราชการ", public_transport: "รถโดยสารสาธารณะ", flight: "เครื่องบิน", personal_vehicle: "รถส่วนตัว", other: "อื่น ๆ" };
const BOOKING_CAT = { meeting_room: "room", vehicle: "vehicle" };

/** ชนิดเรื่อง (การจองแยกห้อง/รถตาม resourceKind) */
function catOf(type, row) {
  const cat = categoryOf(type);
  return cat === "booking" && row?.resourceKind ? BOOKING_CAT[row.resourceKind] ?? "booking" : cat;
}

const STATUS_TONE = { approved: "ok", completed: "ok", scheduled: "ok", rejected: "high", cancelled: "high", cancel_requested: "high" };
/** ช่องข้อมูลของรายการ (ใช้ทั้งการ์ดห้องและการ์ดรายบุคคล) */
function fieldsFor(domain, row, cat, { leaveType = SHOW_LEAVE_TYPE } = {}) {
  const fields = [];
  switch (domain) {
    case "leave":
      fields.push(["ผู้ลา", row.requesterName]);
      if (row.requesterOrgUnitName) fields.push(["หน่วยงาน", row.requesterOrgUnitName]);
      if (leaveType && row.leaveTypeName) fields.push(["ประเภท", row.leaveTypeName]);
      fields.push(["วันที่", thaiDateRange(row.startDate, row.endDate)]);
      if (row.days != null) fields.push(["จำนวน", `${row.days} วัน`]);
      break;
    case "travel_request":
      fields.push(["ผู้ขอ", row.requesterName], ["เรื่อง", row.purpose], ["สถานที่", row.destination]);
      fields.push(["วันที่", thaiDateRange(row.startDate, row.endDate) + (row.startTime ? ` ${row.startTime}${row.endTime ? `–${row.endTime}` : ""} น.` : "")]);
      if (row.transportMode) fields.push(["เดินทางโดย", TRANSPORT[row.transportMode] ?? row.transportMode]);
      if (row.companionCount) fields.push(["ผู้ร่วมเดินทาง", row.companionNames?.length ? row.companionNames.join(", ") : `${row.companionCount} คน`]);
      break;
    case "resource_booking":
      if (row.resourceName) fields.push([cat === "vehicle" ? "รถ" : cat === "room" ? "ห้อง" : "ทรัพยากร", row.resourceName]);
      fields.push(["เวลา", thaiTimeRange(row.startsAt, row.endsAt)]);
      if (row.requesterName) fields.push(["ผู้จอง", row.requesterName]);
      if (row.requesterOrgUnitName) fields.push(["หน่วยงาน", row.requesterOrgUnitName]);
      if (row.purpose) fields.push(["วัตถุประสงค์", row.purpose]);
      break;
    case "asset_maintenance":   // ชื่อฟิลด์ตามแบบของ API อื่นใน Plan-D — ปรับเมื่อ Plan-D เปิดเส้นจริง
      fields.push(["ครุภัณฑ์", [row.assetName, row.assetTag && `(${row.assetTag})`].filter(Boolean).join(" ")]);
      fields.push(["อาการ", row.problem ?? row.description ?? row.symptom]);
      fields.push(["สถานที่", row.locationName]);
      fields.push(["ผู้แจ้ง", row.requesterName ?? row.reporterName], ["หน่วยงาน", row.requesterOrgUnitName]);
      break;
    case "meeting":
      fields.push(["เรื่อง", row.title], ["เวลา", thaiTimeRange(row.startsAt, row.endsAt)]);
      if (row.locationText) fields.push(["สถานที่", row.locationText]);
      if (row.meetingType && !/^[a-z_]+$/.test(row.meetingType)) fields.push(["ประเภท", row.meetingType]);   // รหัสภาษาอังกฤษ (general) ไม่แสดง
      if (row.participantCount) fields.push(["ผู้เข้าประชุม", `${row.participantCount} คน`]);
      break;
  }
  if (cat === "doc") {
    fields.push(["เรื่อง", row.subject ?? row.title], ["จาก", row.fromName ?? row.senderName ?? row.senderOrgName]);
    fields.push(["ถึง", row.recipientNames?.join(", ") ?? row.recipientName ?? row.recipientOrgUnitName]);
    fields.push(["ความเร่งด่วน", row.urgencyLabel ?? row.priorityLabel], ["ลงรับ", row.receivedAt ? thaiTimeRange(row.receivedAt) : null]);
  }
  if (row.referenceNumber) fields.push(["เลขที่", row.referenceNumber, "muted"]);
  if (row.statusLabel) fields.push(STATUS_TONE[row.status] ? ["สถานะ", row.statusLabel, STATUS_TONE[row.status]] : ["สถานะ", row.statusLabel]);
  return fields.filter(([, v]) => v != null && v !== "" && v !== "()");
}

function buildNotice(payload, row) {
  const [domain, ...rest] = payload.type.split(".");
  const action = rest.join(".");
  const cat = catOf(payload.type, row);
  const c = CATS[cat];
  const [actionLabel, level] = ACTIONS[action] ?? [action.replace(/_/g, " "), "info"];
  const subtitle = !row ? undefined : { leave: row.requesterName, travel_request: `${row.requesterName} · ${row.destination}`,
    resource_booking: row.resourceName ?? undefined, meeting: row.title, asset_maintenance: row.assetName ?? undefined }[domain]
    ?? (row && cat === "doc" ? row.subject ?? row.title : undefined);
  const fields = row ? fieldsFor(domain, row, cat) : [
    ["เวลา", payload.occurredAt ? `${fmtDateTime.format(new Date(payload.occurredAt))} น.` : "-"],
    ...(domain === "asset_maintenance" ? [["หมายเหตุ", "ดูรายละเอียดคำขอซ่อมใน Plan-D", "muted"]] : []),
  ];
  return {
    id: `pland:${payload.id}`,
    event: payload.type,
    title: `${c.icon} ${c.label}: ${actionLabel}`, subtitle, level, fields,
    link: c.link,
    buttons: [{ label: "เปิดใน Plan-D", type: "link", url: c.link }],
    ...(c.to.length ? { to: c.to } : {}),
  };
}

const orgUnitOf = (row) => row?.requesterOrgUnitName ?? row?.orgUnitName ?? row?.recipientOrgUnitName ?? null;

/** การ์ดเข้าห้องกลุ่มงาน (การ์ดเดียวกับห้องเรื่อง แต่ปลายทางเป็นห้องของกลุ่มงานผู้ยื่น) */
function buildUnitNotice(payload, row, room) {
  const n = buildNotice(payload, row);
  delete n.to;
  return { ...n, id: `pland:${payload.id}:unit`, event: `unit.${payload.type}`.slice(0, 60), to: [room] };
}

// ── ส่งเข้า AranChat ───────────────────────────────────────────────────────────────
async function send(msg) {
  if (DRY) { log("[dry-run]", JSON.stringify(msg)); return; }
  if (!KEY) throw new Error("ยังไม่ได้ตั้ง ARANCHAT_KEY ใน .env");
  const res = await fetch(ARANCHAT, {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(msg),
    signal: AbortSignal.timeout(15_000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`AranChat HTTP ${res.status}: ${out.error ?? ""}`), { status: res.status });
  const bad = Object.entries(out.results ?? {}).filter(([, r]) => r !== "sent" && r !== "off");
  if (bad.length) log("⚠️ ส่งไม่ถึงบางที่:", msg.event, JSON.stringify(Object.fromEntries(bad)), "— ห้องยังไม่ได้สร้าง? (scripts/29-pland.sh rooms)");
}

/** ลงชื่อเรื่องภาษาไทยในหน้าจัดการแจ้งเตือน (ขึ้นทันทีแม้ยังไม่เคยส่ง — admin ตั้งผู้รับประจำได้เลย) */
async function describe() {
  if (DRY || !KEY) return;
  const events = {};
  for (const type of KNOWN_EVENTS.filter(wanted)) {
    const cat = categoryOf(type);
    const action = actionOf(type);
    const label = `Plan-D ${cat === "booking" ? "จองห้อง/รถ" : CATS[cat].label}: ${ACTIONS[action]?.[0] ?? action}`;
    const note = `เหตุการณ์ ${type} จาก Plan-D (webhook) · รายละเอียดอ่านจาก Plan-D API ด้วยบัญชีบริการ · ตัวเชื่อม: pland-bridge/bridge.mjs`;
    events[type] = { label, note, sql: "" };
    if (routeOf(ROUTES, cat, action).unit) events[`unit.${type}`] = { label: `${label} (ห้องกลุ่มงาน)`, note, sql: "" };
  }
  Object.assign(events, daily.events());
  const res = await fetch(`${ARANCHAT}/describe`, {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ events }),
    signal: AbortSignal.timeout(15_000),
  }).catch((e) => ({ ok: false, status: e.message }));
  log(res.ok ? `ลงทะเบียน ${Object.keys(events).length} เรื่องในหน้าจัดการแล้ว` : `ลงทะเบียนเรื่องไม่ได้ (${res.status}) — ส่งได้ปกติ แค่ชื่อเรื่องยังไม่ขึ้นภาษาไทย`);
}

// ── state: delivery ที่รับแล้ว (กันซ้ำ) + คิวที่ยังส่งไม่สำเร็จ (รีสตาร์ตแล้วไม่หาย) ─────────────────
const STATE = HERE + "data/state.json";
const state = (() => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; } })();
state.seen ??= {};    // deliveryId → เวลา (เก็บ 3 วัน)
state.queue ??= [];   // [{ payload, attempts, nextAt }]
state.recent ??= {};  // "<ชนิด>:<id>:new" → เวลา — create+submit ของรายการเดียวกันส่งครั้งเดียว
function save() {
  const old = Date.now() - 3 * 86400_000;
  for (const [k, t] of Object.entries(state.seen)) if (t < old) delete state.seen[k];
  for (const [k, t] of Object.entries(state.recent)) if (t < Date.now() - 3600_000) delete state.recent[k];
  fs.mkdirSync(HERE + "data", { recursive: true });
  fs.writeFileSync(STATE + ".tmp", JSON.stringify(state));
  fs.renameSync(STATE + ".tmp", STATE);
}

// ถามจากแชท (query.mjs): /room /car — ห้องประชุม/รถ วันไหนใครจอง ว่างตอนไหน
const query = createQuery({ cfg, log, planDGet, TZ, PLAND, state });
// แจ้งเตือนรายบุคคล (personal.mjs) — ผู้ใช้เชื่อมบัญชีด้วย /pland
const personal = createPersonal({ cfg, state, save, log, PLAND, API, ARANCHAT, KEY, DRY, send, fieldsFor, CATS, ACTIONS, extraBot: query,
  onLinked: (mxid, record) => units.invite(record.orgUnit, [mxid]).catch((e) => log("ชวนเข้าห้องกลุ่มงานไม่ได้:", e.message)) });
// ห้องกลุ่มงาน (units.mjs)
const units = createUnits({ cfg, state, save, log, readEnv, DRY, membersOf: (orgUnit) => personal.membersOf(orgUnit) });

// ── ตรวจลายเซ็น (กติกาของ Plan-D: t=<วินาที>,v1=<hex HMAC-SHA256(secret, "<t>.<body ดิบ>")> · เก่าเกิน 5 นาที = ปฏิเสธ) ──────
function verify(header, rawBody, secret) {
  if (!header) return "ไม่มีหัวข้อ X-PlanD-Signature";
  const parts = Object.fromEntries(header.split(",").map((p) => { const i = p.indexOf("="); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return "รูปแบบลายเซ็นไม่ถูกต้อง";
  if (Math.abs(Date.now() / 1000 - t) > 300) return "ลายเซ็นเก่าเกิน 5 นาที";
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest();
  const given = Buffer.from(parts.v1, "hex");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return "ลายเซ็นไม่ตรง";
  return null;
}

/** รับเหตุการณ์ 1 รายการ → [HTTP status, body] · งานจริงทำในคิว (Plan-D รอแค่ 10 วินาที) */
function accept(headers, rawBody, secret) {
  if (!secret) return [500, { error: "ยังไม่ได้ตั้ง PLAND_WEBHOOK_SECRET ใน .env" }];
  const bad = verify(headers["x-pland-signature"], rawBody, secret);
  if (bad) return [401, { error: bad }];
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return [400, { error: "body ไม่ใช่ JSON" }]; }
  payload.type ??= headers["x-pland-event"];
  const delivery = headers["x-pland-delivery"] ?? payload.id;
  if (state.seen[delivery] || state.seen[payload.id]) return [200, { received: true, duplicate: true }];
  state.seen[delivery] = Date.now();
  if (payload.id) state.seen[payload.id] = Date.now();
  if (payload.type === "plan_d.webhook_test") log("ได้รับเหตุการณ์ทดสอบจาก Plan-D ✓");
  else if (!wanted(payload.type) && !personal.wants(payload.type)) log("ข้าม", payload.type, "(ไม่อยู่ในตารางเส้นทาง routes)");
  else { state.queue.push({ payload, attempts: 0, nextAt: 0 }); setImmediate(work); }
  save();
  return [200, { received: true }];
}

let working = false;
async function work() {
  if (working) return;
  working = true;
  try {
    while (true) {
      const item = state.queue.find((q) => q.nextAt <= Date.now());
      if (!item) break;
      const { payload } = item;
      try {
        // create + submit ของการจองเดียวกันมักมาคู่กัน — ส่งครั้งเดียว
        const action = payload.type.split(".").slice(1).join(".");
        const newKey = ["create", "submit"].includes(action) ? `${payload.entity?.type}:${payload.entity?.id}:new` : null;
        if (newKey && state.recent[newKey]) {
          log("ข้าม", payload.type, payload.entity?.id, "(ส่งเรื่องใหม่ของรายการนี้ไปแล้ว)");
        } else {
          let row = null;
          try { row = await details(payload); }
          catch (e) { log("อ่านรายละเอียดไม่ได้ — ส่งแบบสั้น:", payload.type, e.message); }
          // ห้อง + รายบุคคล — แต่ละข้อความมี id ของตัวเอง ลองใหม่ทั้งชุดได้ (AranChat กันซ้ำด้วย id)
          const cat = catOf(payload.type, row);
          const route = routeOf(ROUTES, cat, actionOf(payload.type));
          const msgs = [
            ...(route.topic ? [buildNotice(payload, row)] : []),
            ...personal.noticesFor(payload, row, cat, { me: route.me }),
          ];
          if (route.unit && orgUnitOf(row)) {
            const room = await units.ensure(orgUnitOf(row)).catch((e) => { log("ห้องกลุ่มงาน:", e.message); return null; });
            if (room) msgs.push(buildUnitNotice(payload, row, room));
          }
          for (const m of msgs) await send(m);
          if (newKey) state.recent[newKey] = Date.now();
          // ไม่มีรายละเอียด (เช่น แจ้งซ่อม) — เก็บรูป entity ไว้ดูว่า Plan-D ส่งอะไรมาบ้าง (ไม่มีข้อมูลส่วนบุคคล มีแค่ชนิด + id)
          if (!row) log("entity:", payload.type, JSON.stringify(payload.entity));
          log("ส่งแล้ว", payload.type, payload.entity?.id, row ? "" : "(ไม่มีรายละเอียด)",
            msgs.map((m) => `${m.event.split(".")[0] === "unit" ? "กลุ่มงาน" : /^(me|team)\./.test(m.event) ? m.event : "ห้องเรื่อง"}→${m.to?.length ?? "ประจำ"}`).join(" "));
        }
        state.queue.splice(state.queue.indexOf(item), 1);
      } catch (e) {
        item.attempts++;
        // 4xx จาก AranChat (ยกเว้น 429) = ข้อมูลผิด ลองใหม่ก็ไม่หาย
        const fatal = e.status >= 400 && e.status < 500 && e.status !== 429;
        if (fatal || item.attempts >= 10) {
          log("ทิ้ง", payload.type, payload.entity?.id, `หลังลอง ${item.attempts} ครั้ง:`, e.message);
          state.queue.splice(state.queue.indexOf(item), 1);
        } else {
          item.nextAt = Date.now() + Math.min(30 * 60_000, 15_000 * 2 ** item.attempts);
          log("ส่งไม่สำเร็จ จะลองใหม่:", payload.type, e.message);
        }
      }
      save();
    }
  } finally {
    working = false;
  }
}
setInterval(work, 30_000).unref();

// ── ทางเข้า webhook: https://chat.arankub.com/api/pland/webhook → K3s ingress → PUBLIC_BIND ──────────────
function serve() {
  const server = http.createServer(async (req, res) => {
    const reply = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
    try {
      const path = new URL(req.url, "http://x").pathname.replace(/\/+$/, "");
      if (req.method === "GET" && path === WEBHOOK_PATH.replace(/\/webhook$/, "/health")) {
        return reply(200, { ok: true, queue: state.queue.length, serviceAccount: Boolean(SVC_ID && SVC_SECRET) });
      }
      if (path.startsWith(BASE_PATH) && await personal.handlePublic(req, res, path, new URL(req.url, "http://x"))) return;
      if (path !== WEBHOOK_PATH) return reply(404, { error: "ไม่พบ" });
      if (req.method !== "POST") return reply(405, { error: "ใช้ POST" });
      let raw = "";
      for await (const c of req) { raw += c; if (raw.length > 64_000) return reply(413, { error: "ใหญ่เกิน" }); }
      const [code, out] = accept(req.headers, raw, SECRET);
      if (code !== 200) log("ปฏิเสธ webhook:", code, out.error, "จาก", req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"] ?? req.socket.remoteAddress);
      reply(code, out);
    } catch (e) {
      log("webhook error:", e.message);
      reply(500, { error: "ขัดข้อง" });
    }
  });
  server.once("error", (e) => { log(`เปิด ${BIND_HOST}:${BIND_PORT} ไม่ได้ (${e.code}) — ลองใหม่ใน 30 วินาที`); setTimeout(serve, 30_000); });
  server.listen(Number(BIND_PORT), BIND_HOST, () => log(`รับ webhook ที่ http://${BIND_HOST}:${BIND_PORT}${WEBHOOK_PATH}`));
}

const localToken = () => crypto.createHash("sha256").update(`pland-invite:${KEY}`).digest("hex");

// ── ชวนเชื่อมบัญชี: node bridge.mjs --invite @a:x,@b:x | all [--force] (ส่งผ่านตัวที่ทำงานอยู่ใน pm2) ──────────
if (process.argv.includes("--invite")) {
  const arg = process.argv[process.argv.indexOf("--invite") + 1] ?? "";
  let to = arg.split(",").map((s) => s.trim()).filter((s) => /^@[^:]+:.+$/.test(s));
  if (arg === "all") {
    // ทุกบัญชีแชทที่ผูก AranKub (รายชื่อจากระบบแจ้งเตือน — admin API ในเครื่อง)
    const nenv = readEnv(opt("NOTIFY_ENV_FILE", new URL("../notify/.env", import.meta.url).pathname));
    const r = await fetch(`http://127.0.0.1:${nenv.PORT ?? 3210}/admin/people`, { headers: { Authorization: `Bearer ${nenv.NOTIFY_ADMIN_KEY}` } });
    if (!r.ok) { console.error(`อ่านรายชื่อไม่ได้ (HTTP ${r.status})`); process.exit(1); }
    to = [...new Set((await r.json()).people.map((p) => p.mxid))];
  }
  if (!to.length) { console.error("ใช้: node bridge.mjs --invite @user:server[,@user2:server] | all [--force]"); process.exit(1); }
  const r = await fetch(`http://${HOOK_HOST}:${HOOK_PORT}/invite`, {
    method: "POST", headers: { Authorization: `Bearer ${localToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, force: process.argv.includes("--force") }),
  }).catch((e) => { console.error(`ติดต่อ pland-bridge ไม่ได้ (${e.message}) — เปิดก่อน: pm2 start pland-bridge`); process.exit(1); });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("ไม่สำเร็จ:", out.error ?? r.status); process.exit(1); }
  for (const [m, v] of Object.entries(out.results)) console.log(`${v.padEnd(10)} ${m}`);
  process.exit(0);
}

// ── webhook จาก AranChat (คำสั่ง /pland) — ฟังเฉพาะในเครื่อง ──────────────────────────────────
function serveHook() {
  const server = http.createServer(async (req, res) => {
    const reply = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
    try {
      const path = new URL(req.url, "http://x").pathname;
      if (req.method !== "POST" || !["/hook", "/invite"].includes(path)) return reply(404, { error: "ไม่พบ" });
      let raw = "";
      for await (const c of req) { raw += c; if (raw.length > 64_000) return reply(413, { error: "ใหญ่เกิน" }); }
      if (path === "/invite") {
        // node bridge.mjs --invite … เรียกมาที่นี่ (ตัวที่ทำงานอยู่ถือ state) — ยืนยันด้วยค่าที่ได้จาก ARANCHAT_KEY
        if (!KEY || req.headers.authorization !== `Bearer ${localToken()}`) return reply(401, { error: "unauthorized" });
        const body = JSON.parse(raw || "{}");
        return reply(200, { results: await personal.invite(Array.isArray(body.to) ? body.to.map(String) : [], { force: body.force === true }) });
      }
      reply(...await personal.handleHook(raw, req.headers));
    } catch (e) {
      log("hook error:", e.message);
      reply(500, { error: "ขัดข้อง" });
    }
  });
  server.once("error", (e) => { log(`เปิด ${HOOK_HOST}:${HOOK_PORT} ไม่ได้ (${e.code}) — ลองใหม่ใน 30 วินาที`); setTimeout(serveHook, 30_000); });
  server.listen(Number(HOOK_PORT), HOOK_HOST, () => log(`รับคำสั่งจาก AranChat ที่ http://${HOOK_HOST}:${HOOK_PORT}/hook`));
}

// ── โหมดทดสอบ: ดึงเหตุการณ์จริงด้วย developer token (webhook listen) ───────────────────────────
// keep = ทำงานคู่กับตัวรับปกติ (PLAND_PULL=on): หมดอายุ/ขัดข้อง → เปิดใหม่เอง ไม่ปิดโปรแกรม
async function listen({ keep = false } = {}) {
  const clientId = cfg.PLAND_CLIENT_ID?.trim(), devToken = cfg.PLAND_DEV_TOKEN?.trim();
  if (!clientId || !devToken) { log("โหมดดึงเหตุการณ์ต้องมี PLAND_CLIENT_ID และ PLAND_DEV_TOKEN ใน .env"); if (!keep) process.exit(1); return; }
  const base = `${API}/webhook-listen`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const call = async (method, url, body) => {
    const r = await fetch(url, { method, headers: { Authorization: `Bearer ${devToken}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j?.error?.message ?? `HTTP ${r.status}`), { status: r.status });
    return j;
  };
  const open = () => call("POST", base, { clientId, eventKeys: KNOWN_EVENTS.filter((t) => wanted(t) || personal.wants(t)) }).catch((e) => {
    log("ขอเฉพาะเหตุการณ์ที่เลือกไม่ได้:", e.message, "— ขอทั้งหมดที่แอปรับได้แทน");
    return call("POST", base, { clientId });
  });
  let l = null;
  const stop = async () => { if (l) await call("DELETE", `${base}/${l.listenerId}`).catch(() => {}); log("ปิดการดึงเหตุการณ์แล้ว"); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  while (true) {
    if (!l) {
      try {
        l = await open();
        log(`ดึงเหตุการณ์จาก Plan-D (webhook listen): ${l.eventKeys?.length} เรื่อง · หมดอายุ ${new Date(l.expiresAt).toLocaleString("th-TH", { timeZone: TZ })} (เปิดใหม่เอง)`);
      } catch (e) {
        log("เปิดการดึงเหตุการณ์ไม่ได้:", e.message);
        if (!keep) process.exit(1);
        await sleep(5 * 60_000); continue;
      }
    }
    let batch;
    try { batch = await call("GET", `${base}/${l.listenerId}?wait=25`); }
    catch (e) {
      if ([403, 404, 410].includes(e.status)) {
        log("การดึงเหตุการณ์หยุด:", e.message, keep ? "— เปิดใหม่" : "");
        if (!keep) process.exit(1);
        l = null; await sleep(e.status === 403 ? 5 * 60_000 : 2000); continue;
      }
      log("ดึงไม่ได้:", e.message); await sleep(5000); continue;
    }
    const results = [];
    for (const ev of batch.events ?? []) {
      const headers = Object.fromEntries(Object.entries(ev.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      const [status, out] = accept(headers, ev.body, l.signingSecret);
      log("ดึงได้:", headers["x-pland-event"], "→", status, out.error ?? "");
      results.push({ deliveryId: ev.deliveryId, status, error: out.error ?? null });
    }
    if (results.length) await call("POST", `${base}/${l.listenerId}/ack`, { results }).catch((e) => log("ack ไม่ได้:", e.message));
  }
}

// สรุปประจำวัน (daily.mjs): ทุกเช้าส่งการ์ด "วันนี้" ห้องประชุม / รถ / ลา / ไปราชการ / ประชุม
const daily = createDaily({ cfg, state, save, log, planDGet, send, CATS, TZ });
if (process.argv.includes("--daily")) {
  const i = process.argv.indexOf("--date");
  const date = i > 0 ? process.argv[i + 1] : daily.today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error("--date ต้องเป็น YYYY-MM-DD"); process.exit(1); }
  const n = await daily.run(date, { dry: !process.argv.includes("--send"), test: true });
  log(`สรุปวันที่ ${date}: ${n} การ์ด${process.argv.includes("--send") ? " (ส่งแล้ว)" : " (พิมพ์อย่างเดียว · --send = ส่งจริง)"}`);
  process.exit(0);
}

// ทดลองคำสั่ง: node bridge.mjs --ask room "พรุ่งนี้ 13:00-15:00"
if (process.argv.includes("--ask")) {
  const i = process.argv.indexOf("--ask");
  console.log(JSON.stringify(await query.onCommand({ command: process.argv[i + 1], args: process.argv[i + 2] ?? "" }), null, 1));
  process.exit(0);
}

// ── ตัวอย่างการ์ด: node bridge.mjs --sample (พิมพ์) · --sample --send (ส่งเข้าห้องจริง ไว้ดูหน้าตา/เช็กว่าห้องพร้อม) ──────
if (process.argv.includes("--sample")) {
  const at = new Date().toISOString();
  const samples = [
    ["leave.submit", { requesterName: "นายสมศักดิ์ ทดลองดี", requesterOrgUnitName: "กลุ่มงานบริหารทั่วไป", leaveTypeName: "ลาพักผ่อน", startDate: "2026-12-01", endDate: "2026-12-03", days: 3, referenceNumber: "ลา 001/2570", statusLabel: "รออนุมัติ" }],
    ["travel_request.approve", { requesterName: "นางสุดารัตน์ ตัวแทนดี", destination: "สสจ.", purpose: "ประชุมคณะกรรมการระดับจังหวัด", startDate: "2026-12-05", endDate: "2026-12-05", startTime: "08:30", endTime: "16:30", transportMode: "government_vehicle", companionCount: 2, referenceNumber: "ไป 007/2570", statusLabel: "อนุมัติแล้ว" }],
    ["asset_maintenance.request_created", null],
    ["resource_booking.submit", { resourceKind: "meeting_room", resourceName: "ห้องประชุมใหญ่ ชั้น 3", startsAt: "2026-12-02T02:00:00Z", endsAt: "2026-12-02T05:00:00Z", requesterOrgUnitName: "กลุ่มงานการพยาบาล", referenceNumber: "BK-2570-0001", statusLabel: "รออนุมัติ" }],
    ["resource_booking.approve", { resourceKind: "vehicle", resourceName: "รถตู้ นข 1234", startsAt: "2026-12-04T00:30:00Z", endsAt: "2026-12-04T09:00:00Z", requesterName: "นายสมชาย ใจดี", purpose: "รับส่งผู้ป่วยส่งต่อ", referenceNumber: "BK-2570-0002", statusLabel: "อนุมัติแล้ว" }],
    ["meeting.create", { title: "ประชุมกรรมการบริหารโรงพยาบาล ครั้งที่ 12/2569", startsAt: "2026-12-10T06:00:00Z", endsAt: "2026-12-10T08:00:00Z", locationText: "ห้องประชุมใหญ่ ชั้น 3", meetingType: "general", participantCount: 18, referenceNumber: "MT-2569-0012", statusLabel: "นัดหมายแล้ว" }],
  ];
  const real = process.argv.includes("--send");
  // --to @user:server = ตัวอย่างการ์ดรายบุคคลถึงคนนั้น (สมมติว่าเขาเป็นผู้ลา/ผู้ขอ/ผู้จอง และเปิดใบลาทีมไว้ · ไม่บันทึกการเชื่อม)
  const toIdx = process.argv.indexOf("--to");
  const me = toIdx > 0 ? process.argv[toIdx + 1] : null;
  if (me) {
    if (!/^@[^:]+:.+$/.test(me)) { console.error("--to ต้องเป็น @user:server"); process.exit(1); }
    state.links[me] = { keys: ["นายสมศักดิ์ ทดลองดี", "นางสุดารัตน์ ตัวแทนดี", "นายสมชาย ใจดี"].map(nameKey), leaveVisibility: "agency", team: "agency" };
    samples.splice(0, samples.length,
      ["leave.approve", { ...samples[0][1], status: "approved", statusLabel: "อนุมัติแล้ว" }],
      ["leave.submit", { ...samples[0][1], requesterName: "นางมาลี ทดสอบ" }], samples[1], samples[4]);
  }
  for (const [type, row] of samples) {
    const payload = { id: `sample-${type}-${Date.now()}`, type, occurredAt: at, entity: { type: type.split(".")[0], id: "sample" } };
    const msg = me ? personal.noticesFor(payload, row, catOf(type, row), { me: routeOf(ROUTES, catOf(type, row), actionOf(type)).me })[0] : buildNotice(payload, row);
    if (!msg) { log("ไม่มีการ์ดรายบุคคลสำหรับ", type); continue; }
    msg.title = `[ตัวอย่าง] ${msg.title}`;
    if (real) await send(msg).then(() => log("ส่งตัวอย่าง", type, "→", (msg.to ?? ["ผู้รับประจำ"]).join(","))).catch((e) => log("ส่งไม่ได้", type, e.message));
    else console.log(JSON.stringify(msg, null, 1));
  }
  process.exit(0);
}

log(`Plan-D bridge — ${PLAND} → ${DRY ? "[dry-run]" : ARANCHAT} · บัญชีบริการ: ${SVC_ID ? "มี" : "ยังไม่ตั้ง (ส่งแบบสั้น)"} · เชื่อมบัญชีรายบุคคล ${personal.linkedCount()} คน · คิวค้าง ${state.queue.length}`);
// ค่าตั้งจากหน้า AranKub (settings.mjs) — เปลี่ยนเมนู → ลงทะเบียนคำสั่ง/เมนูใหม่
const settings = createSettings({ cfg, log, ARANCHAT, KEY, DRY, onChange: () => personal.register().catch((e) => log("ลงทะเบียนเมนูใหม่ไม่ได้:", e.message)) });
await settings.start();
await describe();
await personal.register();
work();
serveHook();
if (LISTEN) listen();
else {
  serve();
  daily.start();
  // ระหว่างที่ Plan-D ยังส่งเข้าปลายทาง webhook ไม่ได้: ดึงเหตุการณ์เองด้วย webhook listen (กันซ้ำกับทางปกติด้วย id เหตุการณ์)
  if (cfg.PLAND_PULL === "on") listen({ keep: true });
}
