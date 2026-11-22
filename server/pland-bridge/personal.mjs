// แจ้งเตือนรายบุคคล: ผู้ใช้ AranChat เชื่อมบัญชี Plan-D ของตัวเองครั้งเดียว แล้วได้แจ้งเตือนเรื่องของตัวเองในแชทส่วนตัวกับบอท
//
// เชื่อมบัญชี: พิมพ์ /pland ในแชทกับ "AranChat แจ้งเตือน" → ปุ่ม "เชื่อมบัญชี Plan-D" (ลิงก์ใช้ครั้งเดียว 10 นาที)
//   → https://<chat>/api/pland/link/<token> → หน้าเข้าสู่ระบบของ Plan-D (OAuth + PKCE) → /api/pland/callback
//   → อ่าน /me + ทะเบียนบุคลากรของตัวเอง → จำ "mxid ↔ บุคลากร Plan-D" · token ของผู้ใช้ไม่เก็บ (เพิกถอนทันที)
//
// จับคู่ผู้รับ: ข้อมูลใบลา/การจองที่ API ส่งมามีแค่ "ชื่อผู้ยื่น" (ไม่มีรหัสบุคลากร) → เทียบชื่อ-นามสกุล (ตัดคำนำหน้า/ช่องว่าง)
//   กันส่งผิดคน: ตอนเชื่อมตรวจว่าใน Plan-D มีคนชื่อ-นามสกุลเดียวกันไหม — ถ้ามี ไม่ส่งรายบุคคลให้คนนั้น (บอกเจ้าตัว)
//   ชื่อเดียวกันเชื่อมไว้มากกว่า 1 บัญชีแชท → ไม่ส่งให้ใคร (log ไว้)
//
// เรื่องที่ส่ง (ปิด/เปิดรายเรื่องได้ในแชทกับบอท: พิมพ์ "ตั้งค่า")
//   me.leave     ใบลาของฉัน: อนุมัติ / ไม่อนุมัติ / ยกเลิก / ถอนอนุมัติ
//   me.travel    ไปราชการของฉัน (ผู้ขอ + ผู้ร่วมเดินทาง ถ้าบัญชีบริการได้ชั้นลึก hr.travel.read.team)
//   me.booking   การจองห้อง/รถของฉัน (ต้องได้ชั้นลึก bookings.read.details ถึงจะรู้ชื่อผู้จอง)
//   team.leave   มีใบลายื่นใหม่ในหน่วยงาน — เปิดเองด้วย "/pland ทีม" เฉพาะคนที่ Plan-D ให้เห็นใบลาของหน่วยงาน (หัวหน้า/งานบุคคล)
import crypto from "node:crypto";

const PREFIXES = [
  "ว่าที่ร้อยตรีหญิง", "ว่าที่ร้อยตรี", "ว่าที่ร.ต.หญิง", "ว่าที่ร.ต.", "นางสาว", "น.ส.", "นาย", "นาง", "ดร.", "นพ.", "พญ.", "ทพ.", "ทพญ.",
  "ภก.", "ภญ.", "ผศ.", "รศ.", "ศ.", "mr.", "mrs.", "ms.", "miss",
].sort((a, b) => b.length - a.length);
/** ชื่อสำหรับเทียบ: ตัดช่องว่างทั้งหมด + คำนำหน้า (ทำแบบเดียวกันทั้งสองฝั่ง) */
export function nameKey(s) {
  let t = String(s ?? "").normalize("NFC").replace(/\s+/g, "").toLowerCase();
  for (let again = true; again;) {
    again = false;
    for (const p of PREFIXES) if (t.startsWith(p) && t.length > p.length + 2) { t = t.slice(p.length); again = true; }
  }
  return t;
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function createPersonal({ cfg, state, save, log, PLAND, API, ARANCHAT, KEY, DRY, send, fieldsFor, CATS, ACTIONS, onLinked, extraBot = { commands: [], menu: [], onCommand: async () => null } }) {
  // แอปเดียวกับบัญชีบริการ (Plan-D ผูกบัญชีบริการกับแอป) — ใส่ชุดไหนชุดหนึ่งก็ได้
  const CLIENT_ID = (cfg.PLAND_CLIENT_ID || cfg.PLAND_SERVICE_CLIENT_ID)?.trim();
  const CLIENT_SECRET = (cfg.PLAND_CLIENT_SECRET || cfg.PLAND_SERVICE_CLIENT_SECRET)?.trim();
  const PUBLIC = (cfg.PUBLIC_URL ?? "https://chat.arankub.com/api/pland").replace(/\/+$/, "");
  const REDIRECT = `${PUBLIC}/callback`;
  const HOOK_URL = cfg.HOOK_URL ?? `http://${cfg.HOOK_BIND ?? "127.0.0.1:3213"}/hook`;
  const SCOPES = cfg.PLAND_LINK_SCOPES ?? "openid profile hr.personnel.read hr.leave.read";
  const LIST = (k, d) => String(cfg[k] ?? d).split(",").map((s) => s.trim()).filter(Boolean);
  // เจ้าตัวได้เรื่องไหน: ตารางเส้นทาง (routes.mjs → me) · ใบลาใหม่ถึงหัวหน้ารายคน (/pland ทีม):
  const TEAM_EVENTS = new Set(LIST("TEAM_EVENTS", "leave.submit"));

  state.links ??= {};     // mxid → { personnelId, displayName, fullName, orgUnit, keys[], ambiguous, leaveVisibility, team, linkedAt }
  state.linkTokens ??= {}; // token → { mxid, exp }  (ลิงก์จากคำสั่ง /pland)
  state.oauth ??= {};     // state → { mxid, verifier, exp }
  state.pendingLinks ??= {}; // nonce → { mxid, record, exp }  login Plan-D แล้ว รอเจ้าของแชทกดยืนยัน
  state.invited ??= {};   // mxid → เวลาที่ส่งคำชวนล่าสุด
  const CONFIRM_MIN = 30;
  const INVITE_DAYS = Number(cfg.INVITE_DAYS ?? 7);
  const prune = () => {
    const now = Date.now();
    for (const m of [state.linkTokens, state.oauth, state.pendingLinks]) for (const [k, v] of Object.entries(m)) if (v.exp < now) delete m[k];
  };

  // ── ชื่อ → mxid ─────────────────────────────────────────────────────────────────
  function byName(name) {
    const key = nameKey(name);
    if (!key) return null;
    const hits = Object.entries(state.links).filter(([, l]) => l.keys?.includes(key));
    if (hits.length !== 1) { if (hits.length > 1) log("⚠️ ชื่อซ้ำในบัญชีที่เชื่อม — ไม่ส่งรายบุคคล:", name); return null; }
    const [mxid, l] = hits[0];
    return l.ambiguous ? null : mxid;
  }
  const teamWatchers = (orgUnit, exclude) => Object.entries(state.links)
    .filter(([m, l]) => m !== exclude && l.team && l.team !== "off" && (l.team === "agency" ? l.leaveVisibility === "agency" : orgUnit && l.orgUnit === orgUnit))
    .map(([m]) => m);

  // ── การ์ดรายบุคคล ───────────────────────────────────────────────────────────────
  /** เหตุการณ์ 1 รายการ → ข้อความรายบุคคล [] (row = รายละเอียดจาก API · ไม่มี = ไม่รู้ว่าเป็นของใคร → ไม่ส่ง) */
  function noticesFor(payload, row, cat, { me = false } = {}) {
    if (!row) return [];
    const type = payload.type;
    const [domain, ...rest] = type.split(".");
    const action = rest.join(".");
    const [actionLabel, level] = ACTIONS[action] ?? [action, "info"];
    const c = CATS[cat];
    const fields = fieldsFor(domain, row, cat, { leaveType: true }).filter(([k]) => !["ผู้ลา", "ผู้ขอ", "ผู้จอง", "ผู้แจ้ง"].includes(k));
    const base = { level, fields, link: c.link, buttons: [{ label: "เปิดใน Plan-D", type: "link", url: c.link }] };
    const out = [];
    const to = (mxids, event, title, subtitle, suffix, extra = {}) => {
      const list = [...new Set(mxids.filter(Boolean))];
      if (list.length) out.push({ ...base, id: `pland:${payload.id}:${suffix}`, event, title, subtitle, to: list, ...extra });
    };
    if (me) {
      if (domain === "leave") to([byName(row.requesterName)], "me.leave", `${c.icon} ใบลาของคุณ: ${actionLabel}`, row.leaveTypeName ?? undefined, "me");
      if (domain === "travel_request") {
        const me = byName(row.requesterName);
        to([me], "me.travel", `${c.icon} คำขอไปราชการของคุณ: ${actionLabel}`, row.purpose, "me");
        to((row.companionNames ?? []).map(byName).filter((m) => m !== me), "me.travel", `${c.icon} ไปราชการที่คุณร่วมเดินทาง: ${actionLabel}`,
          `${row.requesterName} · ${row.purpose}`, "companions");
      }
      if (domain === "resource_booking" && row.requesterName) {
        to([byName(row.requesterName)], "me.booking", `${c.icon} การจอง${cat === "vehicle" ? "รถ" : cat === "room" ? "ห้องประชุม" : ""}ของคุณ: ${actionLabel}`,
          row.resourceName ?? undefined, "me");
      }
      if (domain === "asset_maintenance") {
        to([byName(row.requesterName ?? row.reporterName)], "me.repair", `${c.icon} แจ้งซ่อมของคุณ: ${actionLabel}`, row.assetName ?? undefined, "me");
      }
      if (cat === "doc") {
        to([...(row.recipientNames ?? []), row.recipientName].filter(Boolean).map(byName), "me.doc", `${c.icon} หนังสือถึงคุณ: ${actionLabel}`,
          row.subject ?? row.title, "me", { fields: fieldsFor(domain, row, cat) });
      }
    }
    if (TEAM_EVENTS.has(type) && domain === "leave") {
      to(teamWatchers(row.requesterOrgUnitName, byName(row.requesterName)), "team.leave", `${c.icon} ใบลาใหม่ในหน่วยงาน: ${actionLabel}`,
        `${row.requesterName}${row.requesterOrgUnitName ? ` · ${row.requesterOrgUnitName}` : ""}`, "team",
        { fields: fieldsFor(domain, row, cat) });   // ผู้รับเป็นหัวหน้า — ให้เห็นชื่อผู้ลาด้วย
    }
    return out;
  }
  const wants = (type) => TEAM_EVENTS.has(type);
  /** คนที่เชื่อมแล้วและอยู่กลุ่มงานนี้ (สมาชิกเริ่มต้นของห้องกลุ่มงาน) */
  const membersOf = (orgUnit) => Object.entries(state.links).filter(([, l]) => l.orgUnit === orgUnit).map(([m]) => m);

  // ── ลงทะเบียนคำสั่ง /pland + webhook กับ AranChat ─────────────────────────────────
  async function register() {
    if (DRY || !KEY) return;
    const call = (method, path, body) => fetch(`${ARANCHAT}${path}`, {
      method, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    }).then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) })).catch((e) => ({ ok: false, status: e.message, json: {} }));
    const hook = await call("PUT", "/webhook", { url: HOOK_URL });
    if (hook.ok && hook.json.secret) { state.hookSecret = hook.json.secret; save(); }
    const bot = await call("PUT", "/bot", {
      commands: [{ command: "pland", description: "เชื่อมบัญชี Plan-D · แจ้งเตือนใบลา/ไปราชการ/การจองของฉัน", usage: "/pland [ทีม|เลิก]" }, ...extraBot.commands],
      menu: [...extraBot.menu, { label: "🔗 Plan-D ของฉัน", type: "text", text: "/pland" }],
      menu_icon: extraBot.menuIcon,
    });
    const events = {
      "me.leave": "Plan-D ของฉัน: ผลใบลา", "me.travel": "Plan-D ของฉัน: ผลคำขอไปราชการ",
      "me.booking": "Plan-D ของฉัน: ผลการจองห้อง/รถ", "team.leave": "Plan-D หัวหน้า: ใบลาใหม่ในหน่วยงาน",
      "me.repair": "Plan-D ของฉัน: แจ้งซ่อมของฉัน", "me.doc": "Plan-D ของฉัน: หนังสือถึงฉัน",
      "me.link.confirm": "Plan-D: ยืนยันการเชื่อมบัญชี", "me.link.invite": "Plan-D: ชวนเชื่อมบัญชี", "me.link": "Plan-D: การเชื่อมบัญชี",
    };
    await call("POST", "/describe", { events: Object.fromEntries(Object.entries(events).map(([k, label]) => [k, { label, note: "แจ้งเตือนรายบุคคล — ผู้ใช้เชื่อมบัญชีด้วย /pland (pland-bridge/personal.mjs)", sql: "" }])) });
    log(`คำสั่ง /pland: ${bot.ok ? "ลงทะเบียนแล้ว" : `ไม่ได้ (${bot.status} ${bot.json.error ?? ""})`} · webhook: ${hook.ok ? HOOK_URL : `ไม่ได้ (${hook.status} ${hook.json.error ?? ""})`}`
      + ` · เชื่อมบัญชีแล้ว ${Object.keys(state.links).length} คน`);
  }

  // ── คำสั่ง /pland (AranChat เรียก webhook นี้ ลงลายเซ็น X-AranChat-Signature) ─────────────
  function verifyHook(raw, sig) {
    if (!state.hookSecret || !sig) return false;
    const expected = Buffer.from(crypto.createHmac("sha256", state.hookSecret).update(raw).digest("base64"));
    const given = Buffer.from(String(sig));
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  }

  const TEAM_LABEL = { off: "ปิด", unit: "หน่วยงานของฉัน", agency: "ทุกหน่วยงาน" };
  function statusCard(mxid) {
    const l = state.links[mxid];
    const canTeam = ["unit", "agency"].includes(l.leaveVisibility);
    const quick = [
      ...(canTeam ? [{ label: "👥 ใบลาทีม: หน่วยงานฉัน", text: "/pland ทีม หน่วย" }] : []),
      ...(l.leaveVisibility === "agency" ? [{ label: "🏢 ใบลาทีม: ทุกหน่วย", text: "/pland ทีม ทั้งหมด" }] : []),
      ...(canTeam && l.team !== "off" ? [{ label: "🔕 ปิดใบลาทีม", text: "/pland ทีม ปิด" }] : []),
      { label: "🔄 เชื่อมใหม่", text: "/pland เชื่อม" }, { label: "⛓️‍💥 เลิกเชื่อม", text: "/pland เลิก" },
    ];
    return {
      card: {
        title: "🔗 บัญชี Plan-D ของคุณ", level: l.ambiguous ? "warning" : "success",
        fields: [
          ["ชื่อ", l.fullName ?? l.displayName], ...(l.orgUnit ? [["หน่วยงาน", l.orgUnit]] : []),
          ["แจ้งเตือนส่วนตัว", l.ambiguous ? "ปิด — ใน Plan-D มีคนชื่อ-นามสกุลเดียวกัน" : "เปิด (ผลใบลา · ไปราชการ · การจอง)", l.ambiguous ? "high" : "ok"],
          ...(canTeam ? [["ใบลาใหม่ของทีม", TEAM_LABEL[l.team ?? "off"]]] : []),
          ["เชื่อมเมื่อ", new Date(l.linkedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }), "muted"],
        ],
        ...(l.ambiguous ? { sections: [{ type: "text", text: "ระบบส่งรายบุคคลโดยเทียบชื่อ-นามสกุล จึงปิดไว้กันส่งผิดคน — ยังได้แจ้งเตือนในห้องตามปกติ" }] } : {}),
      },
      quick_replies: quick.slice(0, 6),
    };
  }

  function newLinkUrl(mxid, ms) {
    prune();
    const token = b64url(crypto.randomBytes(24));
    state.linkTokens[token] = { mxid, exp: Date.now() + ms };
    save();
    return `${PUBLIC}/link/${token}`;
  }

  function linkCard(mxid) {
    const url = newLinkUrl(mxid, 10 * 60_000);
    return {
      card: {
        title: "🔗 เชื่อมบัญชี Plan-D", level: "info",
        text: "กดปุ่มด้านล่าง แล้วเข้าสู่ระบบด้วยบัญชี Plan-D ของคุณ\nเชื่อมแล้วจะได้แจ้งเตือนผลใบลา ไปราชการ และการจองห้อง/รถของคุณในแชทนี้",
        fields: [["ลิงก์ใช้ได้", "ครั้งเดียว ภายใน 10 นาที", "muted"], ["ข้อมูลที่อ่าน", "ชื่อ-นามสกุล หน่วยงาน (ไม่เก็บรหัสผ่าน/token)", "muted"]],
        buttons: [{ label: "เชื่อมบัญชี Plan-D", type: "link", url }],
      },
    };
  }

  function onCommand(body) {
    const mxid = body.user?.mxid;
    if (!mxid) return { reply: "ไม่ทราบผู้ใช้" };
    if (body.room?.kind !== "dm") return { reply: "พิมพ์ /pland ในแชทส่วนตัวกับ AranChat แจ้งเตือน (ลิงก์เชื่อมบัญชีเป็นของคุณคนเดียว)" };
    if (!CLIENT_ID) return { reply: "ระบบยังไม่ได้ตั้งค่าการเชื่อมบัญชี Plan-D (PLAND_CLIENT_ID) — แจ้งผู้ดูแลระบบ" };
    const args = String(body.args ?? "").trim().split(/\s+/).filter(Boolean);
    const l = state.links[mxid];
    if (args[0] === "เลิก" || args[0] === "unlink") {
      if (!l) return { reply: "ยังไม่ได้เชื่อมบัญชี Plan-D" };
      delete state.links[mxid]; save();
      log("เลิกเชื่อม Plan-D:", mxid);
      return { reply: "เลิกเชื่อมบัญชี Plan-D แล้ว — จะไม่ได้แจ้งเตือนส่วนตัวจาก Plan-D อีก (เชื่อมใหม่: /pland)" };
    }
    if (!l || args[0] === "เชื่อม" || args[0] === "link") return linkCard(mxid);
    if (args[0] === "ทีม" || args[0] === "team") {
      const want = { หน่วย: "unit", unit: "unit", ทั้งหมด: "agency", all: "agency", ปิด: "off", off: "off" }[args[1] ?? "หน่วย"];
      if (!want) return { reply: "ใช้: /pland ทีม หน่วย | /pland ทีม ทั้งหมด | /pland ทีม ปิด" };
      if (want !== "off" && !["unit", "agency"].includes(l.leaveVisibility)) {
        return { reply: "บัญชี Plan-D ของคุณไม่ได้เห็นใบลาของหน่วยงาน จึงเปิดแจ้งเตือนใบลาทีมไม่ได้ (เพิ่งได้สิทธิ์? พิมพ์ /pland เชื่อม เพื่ออ่านสิทธิ์ใหม่)" };
      }
      if (want === "agency" && l.leaveVisibility !== "agency") return { reply: "เปิดได้เฉพาะ \"หน่วยงานของฉัน\" ตามสิทธิ์ที่เห็นใน Plan-D" };
      if (want === "unit" && !l.orgUnit) return { reply: "ไม่พบหน่วยงานของคุณในทะเบียนบุคลากร Plan-D" };
      l.team = want; save();
      return { reply: want === "off" ? "ปิดแจ้งเตือนใบลาทีมแล้ว" : `เปิดแจ้งเตือนใบลาใหม่ของ${TEAM_LABEL[want]}แล้ว${want === "unit" ? ` (${l.orgUnit})` : ""}` };
    }
    return statusCard(mxid);
  }

  /** เปิดใช้การเชื่อม (หลังเจ้าของแชทกดยืนยัน) */
  function activate(mxid, record) {
    for (const [m, l] of Object.entries(state.links)) {
      if (l.personnelId === record.personnelId && m !== mxid) {
        delete state.links[m];
        log("ย้ายการเชื่อม Plan-D จาก", m, "→", mxid);
        send({ id: `pland:moved:${m}:${Date.now()}`, event: "me.link", title: "🔗 บัญชี Plan-D ย้ายไปบัญชีแชทอื่นแล้ว", level: "warning",
          text: "บัญชี Plan-D ที่เคยเชื่อมกับแชทนี้ ถูกยืนยันเชื่อมกับบัญชีแชทอื่น — ถ้าไม่ใช่คุณทำ แจ้งผู้ดูแลระบบ แล้วพิมพ์ /pland เพื่อเชื่อมใหม่", to: [m] })
          .catch((e) => log("แจ้งย้ายไม่ได้:", e.message));
      }
    }
    const prev = state.links[mxid];
    state.links[mxid] = { ...record, team: prev?.personnelId === record.personnelId ? prev.team ?? "off" : "off", linkedAt: new Date().toISOString() };
    delete state.invited[mxid];
    save();
    onLinked?.(mxid, state.links[mxid]);
    log("เชื่อม Plan-D แล้ว:", mxid, record.ambiguous ? "(ชื่อซ้ำ — ปิดส่งรายบุคคล)" : "", `เห็นใบลา: ${record.leaveVisibility}`);
    return state.links[mxid];
  }

  function onAction(body) {
    const nonce = String(body.id ?? "").replace(/^pland:confirm:/, "");
    const p = state.pendingLinks[nonce];
    if (!p || p.exp < Date.now()) return { status: { text: "การยืนยันนี้ใช้ไปแล้วหรือหมดเวลา — พิมพ์ /pland เพื่อเริ่มใหม่", tone: "muted" }, close: true };
    if (body.user?.mxid !== p.mxid) return { status: { text: "ยืนยันได้เฉพาะเจ้าของแชท", tone: "high" }, close: false };
    delete state.pendingLinks[nonce];
    save();
    if (body.action !== "confirm") {
      log("เชื่อม Plan-D: เจ้าของแชทปฏิเสธ", p.mxid);
      return { status: { text: "ไม่ได้เชื่อม — คุณกดว่าไม่ใช่คุณ", tone: "high" }, close: true,
        reply: "ยกเลิกการเชื่อมแล้ว ถ้าคุณไม่ได้กดเชื่อมเอง อาจมีคนได้ลิงก์ของคุณไป — ไม่เป็นไร ยังไม่มีอะไรเชื่อม" };
    }
    const l = activate(p.mxid, p.record);
    const canTeam = ["unit", "agency"].includes(l.leaveVisibility);
    return {
      status: { text: `เชื่อมแล้ว · ${l.fullName ?? l.displayName}`, tone: "ok" }, close: true,
      reply: l.ambiguous ? "เชื่อมแล้ว แต่ใน Plan-D มีคนชื่อ-นามสกุลเดียวกับคุณ จึงยังไม่ส่งแจ้งเตือนรายบุคคล (กันส่งผิดคน)"
        : `เชื่อมแล้ว ✅ จากนี้จะได้แจ้งเตือนผลใบลา ไปราชการ และการจองของคุณในแชทนี้${canTeam ? "\nคุณเห็นใบลาของหน่วยงาน — เปิดแจ้งเตือนใบลาใหม่ของทีมได้ด้วย /pland ทีม" : ""}`,
    };
  }

  // ── ชวนเชื่อมบัญชี (ส่งการ์ดถึงคนที่ยังไม่เชื่อม) ───────────────────────────────────────
  /** mxids → ผลรายคน · ข้ามคนที่เชื่อมแล้ว / เพิ่งชวนภายใน 7 วัน (force = ชวนซ้ำ) */
  async function invite(mxids, { force = false } = {}) {
    if (!CLIENT_ID) throw new Error("ยังไม่ได้ตั้ง PLAND_CLIENT_ID");
    const out = {};
    for (const mxid of [...new Set(mxids)]) {
      if (state.links[mxid]) { out[mxid] = "เชื่อมแล้ว"; continue; }
      if (!force && state.invited[mxid] && Date.now() - state.invited[mxid] < 7 * 86400_000) { out[mxid] = "เพิ่งชวนไป"; continue; }
      const url = newLinkUrl(mxid, INVITE_DAYS * 86400_000);
      try {
        await send({
          id: `pland:invite:${mxid}:${Date.now()}`, event: "me.link.invite", title: "🔗 เชื่อมบัญชี Plan-D เพื่อรับแจ้งเตือนส่วนตัว", level: "info",
          text: "เชื่อมครั้งเดียว แล้วจะได้แจ้งเตือนในแชทนี้เมื่อ\n• ใบลาของคุณอนุมัติ/ไม่อนุมัติ\n• คำขอไปราชการของคุณมีผล\n• การจองห้องประชุม/รถของคุณมีผล",
          fields: [["วิธีเชื่อม", "กดปุ่ม → เข้าสู่ระบบ Plan-D ด้วยรหัสเดิม → กลับมากดยืนยันในแชท"], ["ลิงก์ใช้ได้", `ครั้งเดียว ภายใน ${INVITE_DAYS} วัน (หมดอายุพิมพ์ /pland)`, "muted"]],
          buttons: [{ label: "เชื่อมบัญชี Plan-D", type: "link", url }],
          quick_replies: [{ label: "🔗 Plan-D ของฉัน", text: "/pland" }],
          to: [mxid],
        });
        state.invited[mxid] = Date.now();
        out[mxid] = "ส่งแล้ว";
      } catch (e) { out[mxid] = `ส่งไม่ได้: ${e.message}`; }
    }
    save();
    return out;
  }

  /** webhook จาก AranChat → [status, json] */
  async function handleHook(raw, headers) {
    if (!verifyHook(raw, headers["x-aranchat-signature"])) return [401, { error: "ลายเซ็นไม่ถูกต้อง" }];
    let body;
    try { body = JSON.parse(raw); } catch { return [400, { error: "JSON" }]; }
    if (body.type === "test") return [200, { ok: true }];
    if (body.type === "command" && body.command === "pland") return [200, onCommand(body)];
    if (body.type === "command") { const r = await extraBot.onCommand(body); if (r) return [200, r]; }
    if (body.type === "action" && extraBot.onAction) { const r = await extraBot.onAction(body); if (r) return [200, r]; }
    if (body.type === "action" && body.event === "me.link.confirm") return [200, onAction(body)];
    return [200, {}];
  }

  // ── หน้าเชื่อมบัญชี (OAuth + PKCE) ─────────────────────────────────────────────────
  const page = (res, code, title, text, ok = false) => {
    res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
    res.end(`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;font-family:"Sarabun","Noto Sans Thai",system-ui,sans-serif;background:#f4f7f8;color:#12343b;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
.c{background:#fff;border-radius:16px;padding:28px 24px;max-width:420px;width:100%;box-shadow:0 6px 24px #0b7a8c22;text-align:center}.i{font-size:48px}h1{font-size:1.3rem;margin:.4em 0}p{line-height:1.6;color:#3d5a60}
@media (prefers-color-scheme:dark){body{background:#0f1c1f;color:#e3f0f2}.c{background:#172a2e;box-shadow:none}p{color:#a9c3c8}}</style></head>
<body><div class="c"><div class="i">${ok ? "✅" : "⚠️"}</div><h1>${esc(title)}</h1><p>${text}</p></div></body></html>`);
  };

  async function startLink(res, token) {
    prune();
    const t = state.linkTokens[token];
    if (!t) return page(res, 410, "ลิงก์หมดอายุหรือใช้ไปแล้ว", "กลับไปที่แอป AranChat แล้วพิมพ์ <b>/pland</b> ในแชทกับ AranChat แจ้งเตือน เพื่อขอลิงก์ใหม่");
    if (!CLIENT_ID) return page(res, 500, "ยังไม่ได้ตั้งค่า", "ผู้ดูแลระบบยังไม่ได้ตั้ง PLAND_CLIENT_ID");
    delete state.linkTokens[token];
    const verifier = b64url(crypto.randomBytes(32));
    const st = b64url(crypto.randomBytes(24));
    state.oauth[st] = { mxid: t.mxid, verifier, exp: Date.now() + 10 * 60_000 };
    save();
    const q = new URLSearchParams({
      response_type: "code", client_id: CLIENT_ID, redirect_uri: REDIRECT, scope: SCOPES, state: st,
      code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()), code_challenge_method: "S256",
    });
    res.writeHead(302, { Location: `${PLAND}/oauth/authorize?${q}`, "Cache-Control": "no-store" });
    res.end();
  }

  async function finishLink(res, url) {
    prune();
    const st = url.searchParams.get("state") ?? "";
    const o = state.oauth[st];
    if (!o) return page(res, 400, "ลิงก์ไม่ถูกต้องหรือหมดเวลา", "พิมพ์ <b>/pland</b> ในแชทกับ AranChat แจ้งเตือน เพื่อเริ่มใหม่");
    delete state.oauth[st];
    save();
    if (url.searchParams.get("error")) {
      return page(res, 400, "ยังไม่ได้เชื่อมบัญชี", `Plan-D ตอบว่า: ${esc(url.searchParams.get("error_description") ?? url.searchParams.get("error"))}<br>ลองใหม่ด้วย <b>/pland</b>`);
    }
    let tok;
    try {
      const body = new URLSearchParams({ grant_type: "authorization_code", code: url.searchParams.get("code") ?? "", redirect_uri: REDIRECT, client_id: CLIENT_ID, code_verifier: o.verifier });
      if (CLIENT_SECRET) body.set("client_secret", CLIENT_SECRET);
      const r = await fetch(`${PLAND}/api/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000) });
      tok = await r.json().catch(() => ({}));
      if (!r.ok || !tok.access_token) throw new Error(`${r.status} ${tok.error ?? ""} ${tok.error_description ?? ""}`);
    } catch (e) {
      log("เชื่อม Plan-D: แลก token ไม่ได้", o.mxid, e.message);
      return page(res, 502, "เชื่อมไม่สำเร็จ", "Plan-D ไม่ยืนยันการเข้าสู่ระบบ ลองใหม่อีกครั้งด้วย <b>/pland</b>");
    }
    const get = async (path, q) => {
      const r = await fetch(`${API}${path}${q ? `?${new URLSearchParams(q)}` : ""}`, { headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
      return r.json();
    };
    try {
      const me = await get("/me");
      const v = me.viewer ?? {};
      if (!v.personnelId) return page(res, 400, "บัญชีนี้ไม่ได้ผูกทะเบียนบุคลากร", "บัญชี Plan-D นี้ไม่มีข้อมูลบุคลากร จึงส่งแจ้งเตือนรายบุคคลไม่ได้ — ติดต่องานบุคคล/ผู้ดูแล Plan-D");
      if (me.sandbox) return page(res, 400, "นี่คือข้อมูลจำลอง", "บัญชีที่เข้าสู่ระบบเป็นหน่วยทดลองใช้/ข้อมูลจำลอง — ใช้บัญชีของหน่วยงานจริง");
      // ทะเบียนบุคลากรของตัวเอง: ชื่อเต็ม + หน่วยงาน · นับคนชื่อ-นามสกุลเดียวกัน (กันส่งผิดคน)
      let self = null, sameName = 0;
      try {
        const list = await get("/personnel", { search: v.displayName, pageSize: "50" });
        self = list.items?.find((p) => p.id === v.personnelId) ?? null;
        const key = nameKey(self?.fullName ?? v.displayName);
        sameName = (list.items ?? []).filter((p) => p.id !== v.personnelId && nameKey(p.fullName ?? "") === key).length;
      } catch (e) { log("เชื่อม Plan-D: อ่านทะเบียนบุคลากรไม่ได้", e.message); }
      const fullName = self?.fullName ?? null;
      const keys = [...new Set([nameKey(v.displayName), fullName && nameKey(fullName), fullName && nameKey(`${self.titlePrefix ?? ""}${fullName}`)].filter(Boolean))];
      const record = {
        personnelId: v.personnelId, displayName: v.displayName, fullName, orgUnit: self?.orgUnitName ?? null, keys, ambiguous: sameName > 0,
        leaveVisibility: me.visibility?.leaveRequests ?? null,
      };
      // ยังไม่เชื่อมจริง — ให้เจ้าของแชทกดยืนยันในแชทก่อน (ลิงก์ที่ถูกส่งต่อให้คนอื่น login จะเชื่อมผิดคนไม่ได้)
      const nonce = b64url(crypto.randomBytes(16));
      for (const [k, p] of Object.entries(state.pendingLinks)) if (p.mxid === o.mxid) delete state.pendingLinks[k];
      state.pendingLinks[nonce] = { mxid: o.mxid, record, exp: Date.now() + CONFIRM_MIN * 60_000 };
      save();
      const other = Object.entries(state.links).find(([m, l]) => l.personnelId === v.personnelId && m !== o.mxid)?.[0];
      await send({
        id: `pland:confirm:${nonce}`, event: "me.link.confirm", title: "🔗 ยืนยันการเชื่อมบัญชี Plan-D", level: "warning",
        text: `มีการเข้าสู่ระบบ Plan-D เพื่อเชื่อมกับบัญชีแชทนี้ — ถ้าเป็นคุณ กด "ใช่ ฉันเอง" (ภายใน ${CONFIRM_MIN} นาที)`,
        fields: [["ชื่อใน Plan-D", fullName ? `${self.titlePrefix ?? ""}${fullName}` : v.displayName], ...(record.orgUnit ? [["หน่วยงาน", record.orgUnit]] : []),
          ...(other ? [["หมายเหตุ", "บัญชี Plan-D นี้เชื่อมกับบัญชีแชทอื่นอยู่ — ยืนยันแล้วจะย้ายมาที่บัญชีนี้", "high"]] : [])],
        buttons: [
          { label: "✅ ใช่ ฉันเอง", type: "action", id: "confirm", style: "primary" },
          { label: "❌ ไม่ใช่ฉัน", type: "action", id: "reject", style: "danger" },
        ],
        approvers: [o.mxid],
        to: [o.mxid],
      });
      log("เชื่อม Plan-D: รอยืนยันในแชท", o.mxid);
      return page(res, 200, "อีกขั้นเดียว",
        `${esc(record.fullName ?? record.displayName)}${record.orgUnit ? `<br>${esc(record.orgUnit)}` : ""}<br><br>`
        + `กลับไปที่แอป AranChat แล้วกด <b>✅ ใช่ ฉันเอง</b> บนการ์ดในแชทกับ AranChat แจ้งเตือน ภายใน ${CONFIRM_MIN} นาที`, true);
    } catch (e) {
      log("เชื่อม Plan-D: อ่านข้อมูลไม่ได้", o.mxid, e.message);
      return page(res, 502, "เชื่อมไม่สำเร็จ", `อ่านข้อมูลจาก Plan-D ไม่ได้ (${esc(e.message)}) — ผู้ดูแลต้องให้สิทธิ์ ${esc(SCOPES)} กับแอปนี้`);
    } finally {
      // ไม่เก็บ token ของผู้ใช้ — เพิกถอนทั้งสาย
      if (tok?.refresh_token) {
        const body = new URLSearchParams({ token: tok.refresh_token, client_id: CLIENT_ID });
        if (CLIENT_SECRET) body.set("client_secret", CLIENT_SECRET);
        fetch(`${PLAND}/api/oauth/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(10_000) }).catch(() => {});
      }
    }
  }

  /** เส้นสาธารณะ /api/pland/link/<token> · /api/pland/callback → true = จัดการแล้ว */
  async function handlePublic(req, res, path, url) {
    if (req.method !== "GET") return false;
    const m = path.match(/\/link\/([\w-]{20,64})$/);
    if (m) { await startLink(res, m[1]); return true; }
    if (path.endsWith("/callback")) { await finishLink(res, url); return true; }
    return false;
  }

  return { noticesFor, wants, membersOf, register, handleHook, handlePublic, invite, byName, linkedCount: () => Object.keys(state.links).length };
}
