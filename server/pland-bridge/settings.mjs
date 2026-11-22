// ค่าตั้งที่ผู้ดูแลแก้ได้ในหน้า AranKub (/settings/aranchat → แท็บ "ตั้งค่าระบบ" → Plan-D)
//   bridge ประกาศรายการช่อง (schema) ไปที่ AranChat → AranKub สร้างฟอร์มให้ → bridge อ่านค่ากลับทุก 1 นาที แล้วเขียนทับ cfg
//   ค่าจากหน้า AranKub ชนะ .env · ค่าเริ่มต้นของแต่ละช่อง = ค่าใน .env ตอนเริ่มทำงาน
const DAILY_CATS = [
  { value: "room", label: "🏢 ห้องประชุม" }, { value: "vehicle", label: "🚗 ใช้รถ" }, { value: "booking", label: "📅 จองอื่น ๆ" },
  { value: "leave", label: "🏖️ ลา" }, { value: "travel", label: "🚐 ไปราชการ" }, { value: "meeting", label: "👥 ประชุม" },
];
const MENU = [
  { value: "room", label: "🏢 ห้องประชุม (/room)" }, { value: "car", label: "🚗 รถ (/car)" },
  { value: "leave", label: "🏖️ ใบลา (/leave)" }, { value: "travel", label: "🚐 ไปราชการ (/travel)" },
];

function parseDays(v) {
  const out = new Set();
  for (const part of String(v ?? "").split(",")) {
    const [a, b] = part.split("-").map((x) => Number(x.trim()));
    if (Number.isInteger(a)) for (let i = a; i <= (Number.isInteger(b) ? b : a); i++) if (i >= 0 && i <= 6) out.add(i);
  }
  return out.size ? [...out] : [0, 1, 2, 3, 4, 5, 6];
}
const list = (v) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export function createSettings({ cfg, log, ARANCHAT, KEY, DRY, onChange }) {
  const env = { ...cfg };   // ค่า .env ตอนเริ่ม (ใช้เป็นค่าเริ่มต้น)
  const daily = /^\d{1,2}:\d{2}$/.test(String(env.DAILY_AT ?? "09:00"));
  const schema = [
    { group: "สรุปประจำวัน (ส่งเข้าห้องตามเรื่อง)", key: "daily_on", type: "bool", label: "ส่งสรุปทุกเช้า", default: daily },
    { group: "สรุปประจำวัน (ส่งเข้าห้องตามเรื่อง)", key: "daily_at", type: "time", label: "เวลาส่ง", default: daily ? String(env.DAILY_AT ?? "09:00").padStart(5, "0") : "09:00" },
    { group: "สรุปประจำวัน (ส่งเข้าห้องตามเรื่อง)", key: "daily_days", type: "days", label: "วันที่ส่ง", default: parseDays(env.DAILY_DAYS ?? "0-6") },
    { group: "สรุปประจำวัน (ส่งเข้าห้องตามเรื่อง)", key: "daily_cats", type: "multi", label: "เรื่องที่สรุป", options: DAILY_CATS, default: env.DAILY_CATS ? list(env.DAILY_CATS) : DAILY_CATS.map((o) => o.value) },
    { group: "สรุปประจำวัน (ส่งเข้าห้องตามเรื่อง)", key: "daily_empty", type: "bool", label: "วันที่ไม่มีรายการก็ส่ง (\"วันนี้ไม่มีรายการ\")", default: env.DAILY_EMPTY === "on" },
    { group: "ถามจากแชทส่วนตัว (เมนู 📅 Plan-D)", key: "menu_items", type: "multi", label: "เปิดใช้", options: MENU, default: env.MENU_ITEMS ? list(env.MENU_ITEMS) : MENU.map((o) => o.value),
      help: "ถามในห้องกลุ่ม: บอทลบข้อความคำสั่งออกแล้วตอบในแชทส่วนตัวของคนถาม" },
    { group: "ถามจากแชทส่วนตัว (เมนู 📅 Plan-D)", key: "leave_access", type: "select", label: "ใครดูใบลาได้",
      options: [
        { value: "plan-d", label: "ตามสิทธิ์ใน Plan-D (หัวหน้า = หน่วยตัวเอง) + สมาชิกห้องแจ้งลา" },
        { value: "room", label: "เฉพาะสมาชิกห้องแจ้งลา" },
        { value: "off", label: "ปิด" },
      ], default: env.LEAVE_ACCESS ?? "plan-d" },
    { group: "ถามจากแชทส่วนตัว (เมนู 📅 Plan-D)", key: "leave_show_type", type: "bool", label: "แสดงประเภทการลา (ลาป่วย/ลากิจ/…)", default: (env.LEAVE_SHOW_TYPE ?? "on") === "on" },
    { group: "ถามจากแชทส่วนตัว (เมนู 📅 Plan-D)", key: "work_start", type: "time", label: "เวลาราชการเริ่ม (คิดช่วงว่าง)", default: env.WORK_START ?? "08:00" },
    { group: "ถามจากแชทส่วนตัว (เมนู 📅 Plan-D)", key: "work_end", type: "time", label: "เวลาราชการเลิก", default: env.WORK_END ?? "16:30" },
    { group: "รายชื่อห้องประชุม / รถ", key: "room_list", type: "list", label: "ห้องประชุมทั้งหมด (บรรทัดละห้อง)", default: list(env.ROOM_LIST),
      help: "Plan-D ไม่มีรายชื่อห้องให้ดึง — ระบบรวบรวมจากการจองเอง ห้องที่ไม่เคยถูกจองให้เพิ่มที่นี่ (ชื่อต้องตรงกับใน Plan-D)" },
    { group: "รายชื่อห้องประชุม / รถ", key: "vehicle_list", type: "list", label: "รถทั้งหมด (บรรทัดละคัน)", default: list(env.VEHICLE_LIST) },
  ];

  /** ค่าจาก AranChat → cfg (รูปแบบเดียวกับ .env ที่โมดูลอื่นอ่าน) */
  function apply(v) {
    const before = JSON.stringify([cfg.MENU_ITEMS, cfg.LEAVE_ACCESS]);
    cfg.DAILY_AT = v.daily_on === false ? "off" : v.daily_at ?? "09:00";
    cfg.DAILY_DAYS = (v.daily_days ?? []).join(",") || "0-6";
    cfg.DAILY_CATS = (v.daily_cats ?? []).join(",");
    cfg.DAILY_EMPTY = v.daily_empty ? "on" : "off";
    cfg.MENU_ITEMS = (v.menu_items ?? []).join(",");
    cfg.LEAVE_ACCESS = v.leave_access ?? "plan-d";
    cfg.LEAVE_SHOW_TYPE = v.leave_show_type === false ? "off" : "on";
    cfg.WORK_START = v.work_start ?? "08:00";
    cfg.WORK_END = v.work_end ?? "16:30";
    cfg.ROOM_LIST = (v.room_list ?? []).join(",");
    cfg.VEHICLE_LIST = (v.vehicle_list ?? []).join(",");
    if (JSON.stringify([cfg.MENU_ITEMS, cfg.LEAVE_ACCESS]) !== before) onChange?.("menu");
  }

  const call = (method, body) => fetch(`${ARANCHAT}/settings`, {
    method, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000),
  }).then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) }));

  let last = null;
  async function pull() {
    const r = await call("GET");
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.json.error ?? ""}`);
    const s = JSON.stringify(r.json.values);
    if (s !== last) { const first = last == null; last = s; apply(r.json.values ?? {}); if (!first) log("ใช้ค่าตั้งใหม่จากหน้า AranKub", r.json.updatedAt ?? ""); }
  }

  async function start() {
    if (DRY || !KEY) return;
    const r = await call("PUT", { schema }).catch((e) => ({ ok: false, status: e.message, json: {} }));
    if (!r.ok) return log(`ประกาศค่าตั้งไม่ได้ (${r.status}) — ใช้ค่าใน .env`);
    await pull().catch((e) => log("อ่านค่าตั้งไม่ได้:", e.message));
    log(`ค่าตั้ง: ${schema.length} ช่อง (แก้ที่ AranKub → ตั้งค่า → การแจ้งเตือน AranChat → ตั้งค่าระบบ)`);
    setInterval(() => pull().catch((e) => log("อ่านค่าตั้งไม่ได้:", e.message)), 60_000).unref?.();
  }

  return { start, schema };
}
