// ถามจากแชท: ห้องประชุม / รถ วันไหนมีใครจอง ว่างตอนไหน (อ่าน Plan-D ด้วยบัญชีบริการ)
//
//   /room                      วันนี้
//   /room พรุ่งนี้ | มะรืน | ศุกร์ | 25 | 25/11 | 25 พ.ย. | 2026-11-25
//   /room 25/11 13:00-15:00    ห้องไหนว่างช่วงนั้น
//   /car …                     แบบเดียวกันสำหรับรถ
//
// Plan-D API ไม่มีรายชื่อห้อง/รถทั้งหมด → รวบรวมชื่อจากการจองย้อนหลัง 3 เดือน + ล่วงหน้า 2 เดือน (แคช 6 ชม.)
// ห้องที่ไม่เคยถูกจองเลยจะไม่รู้จัก → เพิ่มเองได้ใน .env: ROOM_LIST=ห้องA,ห้องB · VEHICLE_LIST=รถตู้ นข 1234,…
// ใช้ได้ในแชทกับ ARANKUB AI และในห้องแจ้งเตือน (เช่น ห้อง Plan-D · ห้องประชุม)
const KINDS = {
  room: { kind: "meeting_room", label: "ห้องประชุม", icon: "🏢", unit: "ห้อง", env: "ROOM_LIST", cmd: "room" },
  car: { kind: "vehicle", label: "รถ", icon: "🚗", unit: "คัน", env: "VEHICLE_LIST", cmd: "car" },
};
const LIVE = new Set(["approved", "pending", "submitted"]);
const WAITING = new Set(["pending", "submitted"]);
const WEEKDAYS = { อาทิตย์: 0, จันทร์: 1, อังคาร: 2, พุธ: 3, พฤหัส: 4, พฤหัสบดี: 4, ศุกร์: 5, เสาร์: 6 };
const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

// ใบลา / ไปราชการ (คนละ API กับการจอง)
const PEOPLE = {
  leave: { label: "ใบลา", icon: "🏖️", cmd: "leave", path: "/leave-requests" },
  travel: { label: "ไปราชการ", icon: "🚐", cmd: "travel", path: "/travel-requests" },
};

export function createQuery({ cfg, log, planDGet, TZ, PLAND, state = { links: {} } }) {
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

  /** ปุ่มเลือกวันที่ (ปฏิทินในแอป) — กดแล้ว AranChat ส่ง value=YYYY-MM-DD มาที่ onAction */
  const picker = (k, label = "📅 เลือกวันที่") => ({
    label, type: "datetime", id: `pick-${k.cmd}`, mode: "date", min: addDays(today(), k.path ? -30 : 0), max: addDays(today(), 180), initial: today(),
  });

  /** /room เลือกวัน → การ์ดเล็กมีปุ่มปฏิทิน */
  function pickCard(k) {
    return {
      card: {
        title: `${k.icon} เช็ค${k.label}ตามวัน`, level: "info",
        text: `กด "เลือกวันที่" แล้วเลือกวันจากปฏิทิน — จะได้${k.path ? `รายชื่อ${k.label}ของวันนั้น` : `ตารางการจอง${k.label}และช่วงที่ยังว่างของวันนั้น`}\nหรือพิมพ์เอง เช่น /${k.cmd} 25/11${k.path ? "" : " 13:00-15:00"}`,
        buttons: [picker(k)],
      },
      quick_replies: quick(k),
    };
  }

  async function answer(k, args) {
    if (/^(เลือกวัน|เลือก|pick)$/.test(String(args ?? "").trim())) return pickCard(k);
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
    const dayFrom = mins(cfg.WORK_START ?? "08:00"), dayTo = mins(cfg.WORK_END ?? "16:30");
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
        buttons: [picker(k, "📅 เลือกวันอื่น"), { label: "จองใน Plan-D", type: "link", url: link }],
      },
      quick_replies: quick(k, p.date),
    };
  }

  // ── ใบลา / ไปราชการ ────────────────────────────────────────────────────────────────
  // ใบลา: เห็นเท่าที่ Plan-D ให้เห็น — แชทส่วนตัว: คนที่เชื่อม /pland แล้วและ Plan-D ให้เห็นใบลาหน่วยงาน (หน่วยตัวเอง) / ทั้งองค์กร
  //       ห้อง: เฉพาะห้องแจ้งลา (LEAVE_TO — คนในห้องเห็นใบลาทุกใบอยู่แล้ว) · ไปราชการ: ทุกคน (งานราชการ)
  function leaveScope(body) {
    const access = cfg.LEAVE_ACCESS ?? "plan-d";   // plan-d = ตามสิทธิ์ Plan-D + คนในห้องแจ้งลา · room = เฉพาะคนในห้องแจ้งลา · off = ปิด
    if (access === "off") return { deny: "ผู้ดูแลปิดการดูใบลาจากแชทไว้" };
    // คนในห้องแจ้งลาเห็นใบลาทุกใบอยู่แล้ว (ถามจากห้อง หรือจากแชทส่วนตัวก็ได้)
    const rooms = (cfg.LEAVE_TO ?? "room:pland-leave").split(",").map((x) => x.trim().replace(/^room:/, "")).filter(Boolean);
    if ((body.room?.kind === "channel" && rooms.includes(body.room.channel)) || body.user?.channels?.some((c) => rooms.includes(c))) return { all: true };
    if (access === "room") return { deny: "ดูใบลาได้เฉพาะสมาชิกห้องแจ้งลา" };
    const l = state.links?.[body.user?.mxid];
    if (!l) return { deny: "ดูใบลาได้เมื่อเชื่อมบัญชี Plan-D แล้ว — พิมพ์ /pland", quick: [{ label: "🔗 เชื่อม Plan-D", text: "/pland" }] };
    if (l.leaveVisibility === "agency") return { all: true };
    if (l.leaveVisibility === "unit" && l.orgUnit) return { unit: l.orgUnit };
    return { deny: "บัญชี Plan-D ของคุณไม่ได้เห็นใบลาของหน่วยงาน (ดูได้เฉพาะหัวหน้า/งานบุคคล) — ได้สิทธิ์แล้ว? พิมพ์ /pland เชื่อม" };
  }

  async function answerPeople(k, args, body) {
    if (/^(เลือกวัน|เลือก|pick)$/.test(String(args ?? "").trim())) return pickCard(k);
    const scope = k.cmd === "leave" ? leaveScope(body) : { all: true };
    if (scope.deny) return { reply: scope.deny, quick_replies: scope.quick };
    const p = parse(args);
    if (p.error) return { reply: `${p.error}\nตัวอย่าง: /${k.cmd} พรุ่งนี้ · /${k.cmd} ศุกร์ · /${k.cmd} 25/11`, quick_replies: quick(k) };
    const rows = [];
    for (let page = 1; page <= 5; page++) {
      const j = await planDGet(k.path, { from: p.date, to: p.date, pageSize: "50", page: String(page) });
      if (!j) throw new Error("ยังไม่ได้ตั้งบัญชีบริการ Plan-D");
      rows.push(...(j.items ?? []));
      if (page * (j.pageSize ?? 50) >= (j.total ?? 0)) break;
    }
    const sd = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("th-TH-u-ca-buddhist", { timeZone: "UTC", day: "numeric", month: "short" });
    const range = (r) => (r.startDate === r.endDate ? "วันเดียว" : `${sd(r.startDate)} – ${sd(r.endDate)}`);
    let live = rows.filter((r) => LIVE.has(r.status) && (!scope.unit || r.requesterOrgUnitName === scope.unit));
    const seen = new Set();
    live = live.filter((r) => { const key = [r.requesterName, r.startDate, r.endDate, r.leaveTypeName ?? r.destination].join("|"); return !seen.has(key) && seen.add(key); });
    const showType = (cfg.LEAVE_SHOW_TYPE ?? "on") === "on";
    const name = (r) => String(r.requesterName ?? "-").replace(/\s+/g, " ").trim() + (WAITING.has(r.status) ? " ⏳" : "");
    let columns, table;
    if (k.cmd === "leave") {
      live.sort((a, b) => String(a.requesterOrgUnitName).localeCompare(String(b.requesterOrgUnitName), "th") || String(a.requesterName).localeCompare(String(b.requesterName), "th"));
      columns = showType ? ["ผู้ลา", "หน่วยงาน", "ประเภท", "ช่วงลา"] : ["ผู้ลา", "หน่วยงาน", "ช่วงลา"];
      table = live.map((r) => [name(r), r.requesterOrgUnitName ?? "-", ...(showType ? [r.leaveTypeName ?? "-"] : []), range(r)]);
    } else {
      columns = ["ผู้ขอ", "สถานที่", "เรื่อง", "ช่วงเวลา"];
      table = live.map((r) => [name(r) + (r.companionCount ? ` +${r.companionCount}` : ""), r.destination ?? "-", r.purpose ?? "",
        r.startDate === r.endDate ? (r.startTime ? `${r.startTime}${r.endTime ? `–${r.endTime}` : ""}` : "วันเดียว") : range(r)]);
    }
    const sections = [];
    for (let i = 0; i < table.length && sections.length < 4; i += 20) sections.push({ type: "table", columns, rows: table.slice(i, i + 20) });
    if (table.length > 80) sections.push({ type: "text", text: `และอีก ${table.length - 80} รายการ — ดูใน Plan-D` });
    if (!table.length) sections.push({ type: "text", text: `ไม่มี${k.label}ในวันนี้` });
    if (live.some((r) => WAITING.has(r.status))) sections.push({ type: "text", text: "⏳ = ยังรออนุมัติ" });
    if (scope.unit) sections.push({ type: "text", text: `เฉพาะ ${scope.unit} (ตามสิทธิ์ที่เห็นใน Plan-D)` });
    const unit = k.cmd === "leave" ? "คน" : "เรื่อง";
    return {
      card: {
        title: `${k.icon} ${k.label} · ${thaiDay(p.date)} · ${table.length} ${unit}`, level: "info", sections, link,
        buttons: [picker(k, "📅 เลือกวันอื่น"), { label: "เปิดใน Plan-D", type: "link", url: k.cmd === "leave" ? (cfg.LINK_LEAVE ?? `${PLAND}/hr/leave`) : (cfg.LINK_TRAVEL ?? PLAND) }],
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
      { label: "📅 เลือกวัน", text: `/${k.cmd} เลือกวัน` },
      { label: "พิมพ์วัน/เวลา…", text: `/${k.cmd} `, prefill: true },
      { label: "📅 Plan-D ▸", text: "/menu pland" },
    ];
  }

  const ALL_COMMANDS = [
    ...Object.values(KINDS).map((k) => ({
      command: k.cmd, description: `${k.label}: วันไหนใครจอง ว่างตอนไหน (Plan-D)`, usage: `/${k.cmd} [วันนี้|พรุ่งนี้|ศุกร์|25/11] [13:00-15:00]`,
    })),
    { command: "leave", description: "ใบลา: วันไหนใครลา (ตามสิทธิ์ใน Plan-D)", usage: "/leave [วันนี้|พรุ่งนี้|ศุกร์|25/11]" },
    { command: "travel", description: "ไปราชการ: วันไหนใครไปไหน (Plan-D)", usage: "/travel [วันนี้|พรุ่งนี้|ศุกร์|25/11]" },
  ];
  // เมนูย่อย Plan-D (ปุ่มตอบด่วนได้ไม่เกิน 6) — แต่ละปุ่มเปิดการ์ดเลือกวัน (+ ปุ่มวันนี้/พรุ่งนี้)
  const ALL_MENU = [
    { cmd: "room", label: "🏢 ห้องประชุม", type: "text", text: "/room เลือกวัน" },
    { cmd: "car", label: "🚗 รถ", type: "text", text: "/car เลือกวัน" },
    { cmd: "leave", label: "🏖️ ใบลา", type: "text", text: "/leave เลือกวัน" },
    { cmd: "travel", label: "🚐 ไปราชการ", type: "text", text: "/travel เลือกวัน" },
  ];
  // ผู้ดูแลเลือกได้ว่าเปิดคำสั่งไหน (MENU_ITEMS = room,car,leave,travel · หน้า AranKub)
  const on = (cmd) => String(cfg.MENU_ITEMS ?? "room,car,leave,travel").split(",").map((x) => x.trim()).includes(cmd) && !(cmd === "leave" && cfg.LEAVE_ACCESS === "off");

  /** คำสั่งจาก AranChat → คำตอบ (null = ไม่ใช่คำสั่งของเรา) */
  async function onCommand(body) {
    const k = Object.values(KINDS).find((x) => x.cmd === body.command) ?? Object.values(PEOPLE).find((x) => x.cmd === body.command);
    if (!k) return null;
    if (!on(k.cmd)) return { reply: `ผู้ดูแลปิดคำสั่ง /${k.cmd} ไว้` };
    try { return k.path ? await answerPeople(k, body.args, body) : await answer(k, body.args); }
    catch (e) { log(`/${k.cmd} ขัดข้อง:`, e.message); return { reply: `อ่านข้อมูลจาก Plan-D ไม่ได้ตอนนี้ (${e.message}) — ลองใหม่อีกครั้ง หรือเปิดใน Plan-D` }; }
  }

  /** กดเลือกวันที่บนการ์ด → การ์ดตารางของวันนั้น (การ์ดเดิมไม่ปิด เลือกวันอื่นซ้ำได้) */
  async function onAction(body) {
    const k = [...Object.values(KINDS), ...Object.values(PEOPLE)].find((x) => body.action === `pick-${x.cmd}`);
    if (!k) return null;
    if (!on(k.cmd)) return { close: false, reply: `ผู้ดูแลปิดคำสั่ง /${k.cmd} ไว้` };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.value ?? ""))) return { close: false, reply: "เลือกวันที่อีกครั้ง" };
    try {
      // คนกดอาจไม่ใช่คนพิมพ์คำสั่ง (การ์ดในห้อง) → ตรวจสิทธิ์ใบลาตามคนกด
      const r = k.path ? await answerPeople(k, body.value, { user: body.user, room: body.room ?? { kind: body.room_kind, channel: body.channel } }) : await answer(k, body.value);
      if (!r.card) return { close: false, reply: r.reply };
      return { close: false, card: { ...r.card, quick_replies: r.quick_replies } };
    }
    catch (e) { log(`เลือกวัน /${k.cmd} ขัดข้อง:`, e.message); return { close: false, reply: `อ่านข้อมูลจาก Plan-D ไม่ได้ตอนนี้ (${e.message})` }; }
  }

  return {
    onCommand, onAction, parse, menuIcon: "📅",
    get commands() { return ALL_COMMANDS.filter((c) => on(c.command)); },
    get menu() { return ALL_MENU.filter((m) => on(m.cmd)).map(({ cmd, ...m }) => m); },
  };
}
