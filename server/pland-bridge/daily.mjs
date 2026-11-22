// สรุปประจำวันจาก Plan-D: ทุกเช้า (DAILY_AT, ค่าตั้งต้น 09:00 เวลาไทย) ส่งการ์ด "วันนี้" เข้าห้องตามเรื่อง
//   🏢 ห้องประชุม → ROOM_TO · 🚗 ใช้รถ → VEHICLE_TO · 📅 จองอื่น ๆ → BOOKING_TO · 🏖️ ลา → LEAVE_TO · 🚐 ไปราชการ → TRAVEL_TO · 👥 ประชุม → MEETING_TO
// ห้องเดียวกับแจ้งเตือนรายเรื่อง (คนในห้องเห็นข้อมูลชุดเดียวกันอยู่แล้ว) · เรื่องที่วันนี้ไม่มีรายการ = ไม่ส่ง (DAILY_EMPTY=on ส่ง "ไม่มี")
// อ่านด้วยบัญชีบริการ: /bookings /leave-requests /travel-requests /meetings ตัวกรอง from/to (รายการที่คาบเกี่ยววันนั้น)
//
//   DAILY_AT=09:00      เวลาส่ง (off = ปิด)
//   DAILY_DAYS=0-6      วันที่ส่ง 0=อาทิตย์ … 6=เสาร์ เช่น 1-5 = จันทร์–ศุกร์
//   DAILY_CATS=room,vehicle,booking,leave,travel,meeting
//   ทดลอง: node bridge.mjs --daily [--date 2026-11-23] [--send]   (ไม่ใส่ --send = พิมพ์การ์ด)
const MAX_ROWS = 20;     // ต่อตาราง (ข้อจำกัดการ์ด) — เกินแบ่งเป็นหลายตาราง สูงสุด MAX_TABLES
const MAX_TABLES = 4;
const ALL = ["room", "vehicle", "booking", "leave", "travel", "meeting"];
const KIND = { meeting_room: "room", vehicle: "vehicle" };
const LIVE = new Set(["approved", "pending", "submitted", "scheduled", "completed", "in_progress"]);
const WAITING = new Set(["pending", "submitted"]);

export function createDaily({ cfg, state, save, log, planDGet, send, CATS, TZ }) {
  const at = String(cfg.DAILY_AT ?? "09:00").trim();
  const enabled = /^\d{1,2}:\d{2}$/.test(at);
  const days = parseDays(String(cfg.DAILY_DAYS ?? "0-6"));
  const cats = String(cfg.DAILY_CATS ?? ALL.join(",")).split(",").map((s) => s.trim()).filter((c) => ALL.includes(c));
  const sendEmpty = cfg.DAILY_EMPTY === "on";
  const showLeaveType = (cfg.LEAVE_SHOW_TYPE ?? "on") === "on";

  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const hhmm = (iso) => new Date(iso).toLocaleTimeString("th-TH", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  const dayOf = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
  const thaiDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("th-TH-u-ca-buddhist", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const shortDay = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("th-TH-u-ca-buddhist", { timeZone: "UTC", day: "numeric", month: "short" });

  /** ทุกหน้าของรายการที่คาบเกี่ยววันนั้น */
  async function list(path, date, extra = {}) {
    const out = [];
    for (let page = 1; page <= 5; page++) {
      const j = await planDGet(path, { from: date, to: date, page: String(page), pageSize: "100", ...extra });
      if (!j) return null;   // ไม่มีบัญชีบริการ
      out.push(...(j.items ?? []));
      if (page * (j.pageSize ?? 100) >= (j.total ?? 0)) break;
    }
    return out;
  }

  /** ช่วงเวลาในวันนั้น: ข้ามวัน = แสดงวันด้วย */
  function slot(a, b, date) {
    const s = dayOf(a) === date ? hhmm(a) : `${shortDay(dayOf(a))} ${hhmm(a)}`;
    const e = !b ? "" : dayOf(b) === date ? hhmm(b) : `${shortDay(dayOf(b))} ${hhmm(b)}`;
    return e ? `${s}–${e}` : s;
  }
  const mark = (r) => (WAITING.has(r.status) ? " ⏳" : "");

  async function cards(date) {
    const out = [];
    const want = (c) => cats.includes(c);
    if (want("room") || want("vehicle") || want("booking")) {
      const rows = await list("/bookings", date, { scope: "all" }).catch((e) => (log("สรุปวันนี้: อ่านการจองไม่ได้:", e.message), []));
      const live = (rows ?? []).filter((r) => LIVE.has(r.status)).sort((p, q) => String(p.startsAt).localeCompare(String(q.startsAt)));
      for (const cat of ["room", "vehicle", "booking"]) {
        if (!want(cat)) continue;
        const mine = live.filter((r) => (KIND[r.resourceKind] ?? "booking") === cat);
        const label = { room: "ห้อง", vehicle: "รถ", booking: "รายการ" }[cat];
        out.push(card(cat, date, mine.length, "รายการ", {
          columns: ["เวลา", label, "หน่วยงาน / ผู้จอง", "เรื่อง"],
          rows: mine.map((r) => [slot(r.startsAt, r.endsAt, date) + mark(r), r.resourceName ?? "-", r.requesterOrgUnitName ?? r.requesterName ?? "-", r.purpose ?? ""]),
          note: mine.some((r) => WAITING.has(r.status)) ? "⏳ = ยังรออนุมัติ" : null,
        }));
      }
    }
    if (want("leave")) {
      const rows = await list("/leave-requests", date).catch((e) => (log("สรุปวันนี้: อ่านใบลาไม่ได้:", e.message), []));
      // เริ่มลาวันนี้ก่อน แล้วรออนุมัติ แล้วลาต่อเนื่อง
      const live = (rows ?? []).filter((r) => LIVE.has(r.status))
        .sort((p, q) => (q.startDate === date) - (p.startDate === date) || WAITING.has(q.status) - WAITING.has(p.status) || String(p.requesterName).localeCompare(String(q.requesterName), "th"));
      out.push(card("leave", date, live.length, "คน", {
        columns: showLeaveType ? ["ผู้ลา", "หน่วยงาน", "ประเภท", "ช่วงลา"] : ["ผู้ลา", "หน่วยงาน", "ช่วงลา"],
        rows: live.map((r) => {
          const span = r.startDate === r.endDate ? "วันนี้" : `${shortDay(r.startDate)} – ${shortDay(r.endDate)}`;
          return [r.requesterName + mark(r), r.requesterOrgUnitName ?? "-", ...(showLeaveType ? [r.leaveTypeName ?? "-"] : []), span];
        }),
        note: live.some((r) => WAITING.has(r.status)) ? "⏳ = ยังรออนุมัติ" : null,
      }));
    }
    if (want("travel")) {
      const rows = await list("/travel-requests", date).catch((e) => (log("สรุปวันนี้: อ่านไปราชการไม่ได้:", e.message), []));
      const live = (rows ?? []).filter((r) => LIVE.has(r.status));
      out.push(card("travel", date, live.length, "เรื่อง", {
        columns: ["ผู้ขอ", "สถานที่", "เรื่อง", "ช่วงเวลา"],
        rows: live.map((r) => {
          const people = r.companionCount ? `${r.requesterName} +${r.companionCount}` : r.requesterName;
          const span = r.startDate === r.endDate ? (r.startTime ? `${r.startTime}${r.endTime ? `–${r.endTime}` : ""}` : "วันนี้") : `${shortDay(r.startDate)} – ${shortDay(r.endDate)}`;
          return [people + mark(r), r.destination ?? "-", r.purpose ?? "", span];
        }),
        note: live.some((r) => WAITING.has(r.status)) ? "⏳ = ยังรออนุมัติ" : null,
      }));
    }
    if (want("meeting")) {
      const rows = await list("/meetings", date).catch((e) => (log("สรุปวันนี้: อ่านการประชุมไม่ได้:", e.message), []));
      const live = (rows ?? []).filter((r) => r.status !== "cancelled").sort((p, q) => String(p.startsAt).localeCompare(String(q.startsAt)));
      out.push(card("meeting", date, live.length, "เรื่อง", {
        columns: ["เวลา", "เรื่อง", "สถานที่", "ผู้เข้า"],
        rows: live.map((r) => [slot(r.startsAt, r.endsAt, date), r.title ?? "-", r.locationText ?? "", r.participantCount ? `${r.participantCount} คน` : ""]),
      }));
    }
    return out.filter(Boolean);
  }

  function card(cat, date, n, unit, { columns, rows, note }) {
    if (!n && !sendEmpty) return null;
    const c = CATS[cat];
    // แถวซ้ำ (ยื่นซ้ำ 2 ใบเหมือนกัน) แสดงครั้งเดียว · ช่องว่างซ้อนในชื่อ → ช่องเดียว
    const seen = new Set();
    const clean = rows.map((r) => r.map((v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 60)))
      .filter((r) => { const k = r.join("|"); return !seen.has(k) && seen.add(k); });
    const sections = [];
    for (let i = 0; i < clean.length && sections.length < MAX_TABLES; i += MAX_ROWS) sections.push({ type: "table", columns, rows: clean.slice(i, i + MAX_ROWS) });
    if (clean.length > MAX_ROWS * MAX_TABLES) sections.push({ type: "text", text: `และอีก ${clean.length - MAX_ROWS * MAX_TABLES} รายการ — ดูใน Plan-D` });
    if (!n) sections.push({ type: "text", text: "วันนี้ไม่มีรายการ" });
    if (note) sections.push({ type: "text", text: note });
    return {
      id: `pland:daily:${cat}:${date}`,
      event: `daily.${cat}`,
      title: `${c.icon} ${c.label}วันนี้ · ${clean.length} ${unit}`,
      subtitle: thaiDay(date),
      level: "info",
      sections,
      link: c.link,
      buttons: [{ label: "เปิดใน Plan-D", type: "link", url: c.link }],
      ...(c.to.length ? { to: c.to } : {}),
    };
  }

  async function run(date = today(), { dry = false } = {}) {
    const list = await cards(date);
    for (const msg of list) {
      if (dry) { console.log(JSON.stringify(msg, null, 1)); continue; }
      await send(msg).then(() => log("ส่งสรุปวันนี้:", msg.event, msg.title), (e) => log("ส่งสรุปวันนี้ไม่ได้:", msg.event, e.message));
    }
    return list.length;
  }

  /** เรียกทุกนาที: ถึงเวลาแล้วและวันนี้ยังไม่ส่ง → ส่ง (รีสตาร์ตหลังเวลาส่งในวันเดียวกัน = ส่งตามทัน · เกิน 3 ชม. = ข้าม) */
  async function tick() {
    if (!enabled) return;
    const now = new Date();
    const d = today();
    if (state.dailySent === d) return;
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    const [h, m] = at.split(":").map(Number);
    const mins = Number(now.toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false })) * 60 + now.getMinutes();
    if (mins < h * 60 + m) return;
    state.dailySent = d;
    save();
    if (!days.has(wd) || mins > h * 60 + m + 180) return;
    const n = await run(d);
    log(`สรุปวันนี้ (${d}): ส่ง ${n} การ์ด`);
  }

  function start() {
    if (!enabled) return log("สรุปวันนี้: ปิดอยู่ (DAILY_AT=off)");
    log(`สรุปวันนี้: ทุกวัน${days.size === 7 ? "" : ` (${[...days].join(",")})`} ${at} น. · ${cats.join(", ")}`);
    setInterval(() => tick().catch((e) => log("สรุปวันนี้ขัดข้อง:", e.message)), 60_000).unref?.();
    tick().catch((e) => log("สรุปวันนี้ขัดข้อง:", e.message));
  }

  /** ชื่อเรื่องในหน้าจัดการแจ้งเตือน */
  const events = () => Object.fromEntries(cats.map((c) => [`daily.${c}`, {
    label: `Plan-D สรุปวันนี้: ${CATS[c].label}`, note: `ส่งทุกวัน ${at} น. (DAILY_AT) · ตัวเชื่อม: pland-bridge/daily.mjs`, sql: "",
  }]));

  return { start, run, events, today };
}

function parseDays(v) {
  const out = new Set();
  for (const part of v.split(",")) {
    const [a, b] = part.split("-").map((x) => Number(x.trim()));
    if (Number.isInteger(a)) for (let i = a; i <= (Number.isInteger(b) ? b : a); i++) if (i >= 0 && i <= 6) out.add(i);
  }
  return out.size ? out : new Set([0, 1, 2, 3, 4, 5, 6]);
}
