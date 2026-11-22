// ตารางเส้นทางแจ้งเตือน: เรื่องไหน จังหวะไหน ส่งแบบไหน
//   me    = เจ้าตัว (คนที่เชื่อม /pland แล้ว และชื่อตรงกับผู้ยื่น/ผู้รับในรายการ)
//   unit  = ห้องของกลุ่มงานผู้ยื่น (สร้างเองอัตโนมัติ "Plan-D · <กลุ่มงาน>")
//   topic = ห้องตามเรื่อง (room:pland-leave, room:pland-repair … — ตั้งปลายทางใน .env: LEAVE_TO, REPAIR_TO …)
// "*" = ทุกจังหวะ · แก้ได้โดยไม่ต้องแก้โค้ด: สร้าง routes.json ข้าง bridge.mjs เฉพาะเรื่องที่ต้องการเปลี่ยน แล้ว pm2 restart pland-bridge
//   เช่น { "vehicle": { "unit": ["approve"] } }
//
// me/unit ต้องรู้ "ใคร/กลุ่มงานไหน" จากรายละเอียดที่บัญชีบริการอ่านได้ — แจ้งซ่อม/หนังสือเข้า Plan-D API ยังไม่เปิด
// จึงส่งได้แค่ topic ไปก่อน พอ Plan-D เปิด ตั้ง REPAIR_DETAIL_PATH / DOC_DETAIL_PATH ใน .env แล้ว me/unit ทำงานเอง
import fs from "node:fs";

const BOOKING_ALL = ["create", "submit", "approve", "reject", "cancel"];
const RESULT = ["approve", "reject", "cancel"];

export const DEFAULT_ROUTES = {
  leave: { me: ["approve", "reject", "cancel", "undo_approve"], unit: ["submit", "approve", "cancel"], topic: ["submit", "approve", "reject", "cancel"] },
  travel: { me: RESULT, unit: ["submit", "approve", "cancel"], topic: ["submit", "approve", "reject", "cancel"] },
  vehicle: { me: RESULT, unit: [], topic: BOOKING_ALL },
  room: { me: RESULT, unit: [], topic: BOOKING_ALL },
  booking: { me: RESULT, unit: [], topic: BOOKING_ALL },
  meeting: { me: [], unit: [], topic: ["create", "update"] },
  repair: {
    me: ["approve", "reject", "start_work", "complete"], unit: ["request_created", "complete"],
    topic: ["request_created", "approve", "reject", "start_work", "complete"],
  },
  doc: { me: ["*"], unit: ["*"], topic: ["*"] },
};

/** เหตุการณ์ที่รู้จัก (ใช้ลงชื่อเรื่องในหน้าจัดการ) — หนังสือเข้ายังไม่มีชื่อเหตุการณ์จาก Plan-D */
export const KNOWN_EVENTS = [
  "leave.submit", "leave.approve", "leave.reject", "leave.cancel", "leave.undo_approve",
  "travel_request.submit", "travel_request.approve", "travel_request.reject", "travel_request.cancel",
  "asset_maintenance.request_created", "asset_maintenance.approve", "asset_maintenance.reject", "asset_maintenance.start_work", "asset_maintenance.complete",
  "resource_booking.create", "resource_booking.submit", "resource_booking.approve", "resource_booking.reject", "resource_booking.cancel",
  "meeting.create", "meeting.update",
];

export function loadRoutes(file, log) {
  const routes = structuredClone(DEFAULT_ROUTES);
  let custom = {};
  try { custom = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") log("⚠️ อ่าน routes.json ไม่ได้ — ใช้ค่าตั้งต้น:", e.message); }
  for (const [cat, r] of Object.entries(custom)) {
    if (!routes[cat] || typeof r !== "object") continue;
    for (const kind of ["me", "unit", "topic"]) if (Array.isArray(r[kind])) routes[cat][kind] = r[kind].map(String);
  }
  if (Object.keys(custom).length) log("ใช้เส้นทางจาก routes.json:", Object.keys(custom).join(", "));
  return routes;
}

/** { me, unit, topic } ของเรื่อง+จังหวะ */
export function routeOf(routes, cat, action) {
  const r = routes[cat] ?? {};
  const has = (l) => (l ?? []).includes("*") || (l ?? []).includes(action);
  return { me: has(r.me), unit: has(r.unit), topic: has(r.topic) };
}
