// ถามจากแชท: ห้องประชุม / รถ วันไหนมีใครจอง ว่างตอนไหน (อ่าน Plan-D ด้วยบัญชีบริการ)
//
//   /room                      วันนี้
//   /room พรุ่งนี้ | มะรืน | ศุกร์ | 25 | 25/11 | 25 พ.ย. | 2026-11-25
//   /room 25/11 13:00-15:00    ห้องไหนว่างช่วงนั้น
//   /car …                     แบบเดียวกันสำหรับรถ
//
// Plan-D API ไม่มีรายชื่อห้อง/รถทั้งหมด → รวบรวมชื่อจากการจองย้อนหลัง 3 เดือน + ล่วงหน้า 2 เดือน (แคช 6 ชม.)
// ห้องที่ไม่เคยถูกจองเลยจะไม่รู้จัก → เพิ่มเองได้ใน .env: ROOM_LIST=ห้องA,ห้องB · VEHICLE_LIST=รถตู้ นข 1234,…
// ใช้ได้ในแชทกับ AranChat แจ้งเตือน และในห้องแจ้งเตือน (เช่น ห้อง Plan-D · ห้องประชุม)
const KINDS = {
  room: { kind: "meeting_room", label: "ห้องประชุม", icon: "🏢", unit: "ห้อง", env: "ROOM_LIST", cmd: "room" },
  car: { kind: "vehicle", label: "รถ", icon: "🚗", unit: "คัน", env: "VEHICLE_LIST", cmd: "car" },
};
const LIVE = new Set(["approved", "pending", "submitted"]);
const WAITING = new Set(["pending", "submitted"]);
const WEEKDAYS = { อาทิตย์: 0, จันทร์: 1, อังคาร: 2, พุธ: 3, พฤหัส: 4, พฤหัสบดี: 4, ศุกร์: 5, เสาร์: 6 };
const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export function createQuery({ cfg, log, planDGet, TZ, PLAND }) {
  const DAY_START = cfg.WORK_START ?? "08:00", DAY_END = cfg.WORK_END ?? "16:30";
  const link = cfg.LINK_BOOKING ?? PLAND;
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
  const hhmm = (iso) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  const dayOf = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
  const thaiDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("th-TH-u-ca-buddhist", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short", year: "2-digit" });
  const mins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  /** "พรุ่งนี้ 13:00-15:00" → { date, from, to } · ไม่เข้าใจ → { error } */
  function parse(args) {
    let text = String(args ?? "").trim().replace(/\s+/g, " ");
    let from = null, to = null;
    const tm = text.match(/(\d{1,2})[:.](\d{2})\s*(?:-|–|ถึง)\s*(\d{1,2})[:.](\d{2})/) ?? text.match(/(\d{1,2})[:.](\d{2})/);
    if (tm) {
      from = mins(`${tm[1]}:${tm[2]}`);
      to = tm[3] ? mins(`${tm[3]}:${tm[4]}`) : from + 60;
      text = text.replace(tm[0], "").replace(/\s*(น\.|เวลา)\s*/g, " ").trim();
      if (to <= from) return { error: "ช่วงเวลาไม่ถูกต้อง (เวลาจบต้องหลังเวลาเริ่ม)" };
    }
    const t = today();
    let date = null;
    if (!text || /^(วันนี้|today)$/.test(text)) date = t;
    else if (/^(พรุ่งนี้|tomorrow)$/.test(text)) date = addDays(t, 1);
    else if (/^มะรืน(นี้)?$/.test(text)) date = addDays(t, 2);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) date = text;
    else {
      const wd = text.replace(/^(วัน)?/, "").replace(/(นี้|หน้า)$/, "");
      if (wd in WEEKDAYS) {
        const cur = new Date(`${t}T00:00:00Z`).getUTCDay();
        date = addDays(t, (WEEKDAYS[wd] - cur + 7) % 7 + (/หน้า$/.test(text) ? 7 : 0));
      } else {
        // 25 · 25/11 · 25/11/69 · 25 พ.ย. · 25 พ.ย. 69
        const m = text.match(/^(\d{1,2})(?:\s*[/\-.]\s*(\d{1,2})|\s*([ก-๙.]+))?(?:\s*[/\-.]?\s*(\d{2,4}))?$/);
        if (m) {
          const [ty, tmo] = t.split("-").map(Number);
          let mo = m[2] ? Number(m[2]) : m[3] ? MONTHS.findIndex((x) => x.replace(/\./g, "") === m[3].replace(/\./g, "")) + 1 : tmo;
          let y = m[4] ? Number(m[4]) : ty;
          if (y < 100) y += 2500;   // 69 → 2569
          if (y > 2400) y -= 543;   // พ.ศ. → ค.ศ.
          const d = Number(m[1]);
          if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
            date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            // ไม่ใส่เดือน/ปี แล้ววันนั้นผ่านไปแล้ว → เดือนหน้า
            if (!m[2] && !m[3] && date < t) date = addDays(`${y}-${String(mo).padStart(2, "0")}-01`, 32).slice(0, 8) + String(d).padStart(2, "0");
          }
        }
      }
    }
    if (!date || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return { error: `ไม่เข้าใจวันที่ "${text}"` };
    return { date, from, to };
  }

  // ── รายชื่อห้อง/รถที่รู้จัก ─────────────────────────────────────────────────────────
  const known = {};   // kind → { at, names: Set }
  async function names(k) {
    const hit = known[k.kind];
    if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.names;
    const set = new Set(String(cfg[k.env] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    const t = today();
    const rows = await list({ from: addDays(t, -90), to: addDays(t, 60), resourceKind: k.kind }, 10).catch((e) => (log("รวบรวมรายชื่อไม่ได้:", e.message), []));
    for (const r of rows) if (r.resourceName) set.add(r.resourceName.trim());
    known[k.kind] = { at: Date.now(), names: set };
    return set;
  }

  async function list(q, maxPages = 5) {
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const j = await planDGet("/bookings", { scope: "all", pageSize: "50", page: String(page), ...q });
      if (!j) throw new Error("ยังไม่ได้ตั้งบัญชีบริการ Plan-D");
      out.push(...(j.items ?? []));
      if (page * (j.pageSize ?? 50) >= (j.total ?? 0)) break;
    }
    return out;
  }

  /** ช่วงที่ถูกจองในวันนั้น (นาที) — จองข้ามวันตัดให้อยู่ในวัน */
  function span(r, date) {
    const s = dayOf(r.startsAt) < date ? 0 : mins(hhmm(r.startsAt));
    const e = dayOf(r.endsAt) > date ? 24 * 60 : mins(hhmm(r.endsAt));
    return [s, e];
  }

  async function answer(k, args) {
    const p = parse(args);
    if (p.error) return { reply: `${p.error}\nตัวอย่าง: /${k.cmd} พรุ่งนี้ · /${k.cmd} ศุกร์ · /${k.cmd} 25/11 13:00-15:00`, quick_replies: quick(k) };
    const [rows, all] = await Promise.all([list({ from: p.date, to: p.date, resourceKind: k.kind }), names(k)]);
    const live = rows.filter((r) => LIVE.has(r.status)).sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
    const byName = new Map();
    for (const r of live) {
      const n = (r.resourceName ?? "-").trim();
      all.add(n);
      byName.set(n, [...(byName.get(n) ?? []), r]);
    }
    const dayFrom = mins(DAY_START), dayTo = mins(DAY_END);
    const sections = [];
    const when = p.from != null ? ` · ${fmt(p.from)}–${fmt(p.to)} น.` : "";

    if (p.from != null) {
      // ถามช่วงเวลา: ว่าง / ไม่ว่าง
      const busy = [], free = [];
      for (const n of [...all].sort((a, b) => a.localeCompare(b, "th"))) {
        const hit = (byName.get(n) ?? []).filter((r) => { const [s, e] = span(r, p.date); return s < p.to && e > p.from; });
        if (hit.length) busy.push([n, hit.map((r) => `${slot(r, p.date)} ${r.purpose ?? r.requesterOrgUnitName ?? ""}${WAITING.has(r.status) ? " ⏳" : ""}`.trim()).join(" · ")]);
        else free.push(n);
      }
      sections.push({ type: "fields", title: `✅ ว่าง ${free.length} ${k.unit}`, items: free.length ? free.slice(0, 8).map((n) => [n, "ว่าง", "ok"]) : [["-", "ไม่มีที่ว่างช่วงนี้", "high"]] });
      if (free.length > 8) sections.push({ type: "text", text: `ว่างอีก: ${free.slice(8).join(", ")}` });
      if (busy.length) sections.push({ type: "table", title: `⛔ ไม่ว่าง ${busy.length} ${k.unit}`, columns: [k.label, "จองไว้"], rows: busy.slice(0, 20) });
    } else {
      if (live.length) {
        sections.push({
          type: "table", title: `จองไว้ ${live.length} รายการ`, columns: ["เวลา", k.label, "หน่วยงาน", "เรื่อง"],
          rows: live.slice(0, 20).map((r) => [slot(r, p.date) + (WAITING.has(r.status) ? " ⏳" : ""), r.resourceName ?? "-", r.requesterOrgUnitName ?? r.requesterName ?? "-", r.purpose ?? ""]),
        });
      }
      // ว่างตอนไหน (ในเวลาราชการ)
      const freeAll = [], partly = [];
      for (const n of [...all].sort((a, b) => a.localeCompare(b, "th"))) {
        const b = (byName.get(n) ?? []).map((r) => span(r, p.date)).sort((x, y) => x[0] - y[0]);
        if (!b.length) { freeAll.push(n); continue; }
        const gaps = [];
        let cur = dayFrom;
        for (const [s, e] of b) { if (s - cur >= 30) gaps.push(`${fmt(cur)}–${fmt(Math.min(s, dayTo))}`); cur = Math.max(cur, e); if (cur >= dayTo) break; }
        if (dayTo - cur >= 30) gaps.push(`${fmt(cur)}–${fmt(dayTo)}`);
        partly.push([n, gaps.length ? `ว่าง ${gaps.join(", ")}` : "เต็มทั้งวัน", gaps.length ? "" : "high"]);
      }
      if (freeAll.length) sections.push({ type: "text", text: `✅ ว่างทั้งวัน (${freeAll.length}): ${freeAll.join(", ")}` });
      if (partly.length) sections.push({ type: "fields", title: "ช่วงที่ยังว่าง (เวลาราชการ)", items: partly.slice(0, 8) });
      if (!live.length && !all.size) sections.push({ type: "text", text: `ยังไม่มีการจอง${k.label}ในวันนี้` });
    }
    if (live.some((r) => WAITING.has(r.status))) sections.push({ type: "text", text: "⏳ = ยังรออนุมัติ" });
    sections.push({ type: "text", text: `ข้อมูลจาก Plan-D ขณะนี้ · รายชื่อ${k.label}รวบรวมจากการจองที่ผ่านมา${all.size ? ` (รู้จัก ${all.size} ${k.unit})` : ""}` });
    return {
      card: {
        title: `${k.icon} ${k.label} · ${thaiDay(p.date)}${when}`, level: "info",
        sections: sections.slice(0, 8), link,
        buttons: [{ label: "จองใน Plan-D", type: "link", url: link }],
      },
      quick_replies: quick(k, p.date),
    };
  }

  function slot(r, date) {
    const [s, e] = span(r, date);
    return `${fmt(s)}–${e >= 24 * 60 ? "ข้ามวัน" : fmt(e)}`;
  }

  function quick(k, date) {
    const t = today();
    const next = date ? addDays(date, 1) : addDays(t, 1);
    return [
      { label: "วันนี้", text: `/${k.cmd} วันนี้` },
      { label: "พรุ่งนี้", text: `/${k.cmd} พรุ่งนี้` },
      ...(date && date >= addDays(t, 1) ? [{ label: "วันถัดไป", text: `/${k.cmd} ${next}` }] : []),
      { label: "ระบุวัน/เวลา…", text: `/${k.cmd} `, prefill: true },
      { label: k.cmd === "room" ? "🚗 รถ" : "🏢 ห้องประชุม", text: k.cmd === "room" ? "/car วันนี้" : "/room วันนี้" },
    ];
  }

  const commands = Object.values(KINDS).map((k) => ({
    command: k.cmd, description: `${k.label}: วันไหนใครจอง ว่างตอนไหน (Plan-D)`, usage: `/${k.cmd} [วันนี้|พรุ่งนี้|ศุกร์|25/11] [13:00-15:00]`,
  }));
  const menu = [{ label: "🏢 ห้องประชุมว่าง", type: "text", text: "/room วันนี้" }, { label: "🚗 รถว่าง", type: "text", text: "/car วันนี้" }];

  /** คำสั่งจาก AranChat → คำตอบ (null = ไม่ใช่คำสั่งของเรา) */
  async function onCommand(body) {
    const k = Object.values(KINDS).find((x) => x.cmd === body.command);
    if (!k) return null;
    try { return await answer(k, body.args); }
    catch (e) { log(`/${k.cmd} ขัดข้อง:`, e.message); return { reply: `อ่านข้อมูลจาก Plan-D ไม่ได้ตอนนี้ (${e.message}) — ลองใหม่อีกครั้ง หรือเปิดใน Plan-D` }; }
  }

  return { onCommand, commands, menu, parse };
}
