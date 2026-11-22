// ความปลอดภัย ARANKUB / ARANKUB Agent → AranChat
//
//   ทุก 1 นาที   ดึง POST {ARANKUB_URL}/api/security/feed (header x-sync-secret = ARANKUB_SYNC_SECRET)
//                - alerts    เหตุการณ์ใหม่ (สั่งคำสั่งผ่าน MeshCentral ตรง, ดูหน้าจอ, ล็อกอิน MeshCentral ผิด, เครื่องใหม่, โปรแกรมเสี่ยง) แจ้งทันที
//                - incidents สภาวะที่ยังเป็นอยู่ (ล็อกอินผิดซ้ำ, 2FA ผิดซ้ำ, สแกนจากในเครือข่าย, สแกนจากเน็ตมากผิดปกติ)
//                            แจ้งตอนเริ่ม + แจ้งกลับมาปกติเมื่อหาย
//                - agent ออนไลน์ลดฮวบใน 10 นาที (ไฟดับ/เน็ตล่ม/ransomware ปิด agent) — คำนวณที่นี่จากจำนวนออนไลน์
//   07:30 น.     สรุป 24 ชม.
// ตรรกะตรวจจับอยู่ฝั่ง ARANKUB: src/lib/security-feed.ts (เกณฑ์/ข้อความแก้ที่นั่น)

const thDate = (TZ, d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const thHM = (TZ, d = new Date()) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

const DROP_MIN = 5;        // หลุดอย่างน้อยกี่เครื่อง
const DROP_RATIO = 0.4;    // และอย่างน้อยกี่ส่วนของที่เคยออนไลน์ (ภายใน 10 นาที)

export default {
  name: "security",
  everySec: 60,

  docs: {
    "security.brute_force": { label: "ความปลอดภัย: ล็อกอิน ARANKUB ผิดซ้ำ", note: "IP เดียวผิด ≥10 ครั้งใน 15 นาที (หรือถูกล็อก) / ผิดรวม ≥30 ครั้งจาก ≥5 IP = แจ้ง (ด่วน) · หยุดแล้วแจ้งกลับ", sql: "" },
    "security.otp_fail": { label: "ความปลอดภัย: รหัสผ่านถูกแต่ 2FA ผิดซ้ำ", note: "ผู้ใช้คนเดียวใส่รหัส 2FA ผิด ≥3 ครั้งใน 15 นาที = รหัสผ่านอาจรั่ว แจ้ง (ด่วน)", sql: "" },
    "security.scan_internal": { label: "ความปลอดภัย: สแกนช่องโหว่จากในเครือข่าย", note: "มีคำขอหาช่องโหว่ (/.env, /wp-login.php ...) เข้าตรงที่เครื่องเซิร์ฟเวอร์ ไม่ผ่านโดเมน = เครื่องใน รพ. อาจติดมัลแวร์ แจ้ง (ด่วน)", sql: "" },
    "security.scan_wave": { label: "ความปลอดภัย: สแกนจากอินเทอร์เน็ตมากผิดปกติ", note: "บล็อก IP ที่สแกน ≥20 IP ใน 1 ชม. (ปกติบอตสแกนทุกวันอยู่แล้ว ระบบบล็อกเอง ไม่แจ้งรายตัว ดูยอดในสรุปรายวัน)", sql: "" },
    "security.mesh_command": { label: "ความปลอดภัย: สั่งคำสั่งบนเครื่องลูกผ่าน MeshCentral ตรง", note: "MeshCentral มีบันทึก Running commands แต่ ARANKUB ไม่ได้สั่ง = มีคนใช้ MeshCentral/โทเค็นสั่งเอง แจ้ง (ด่วน)", sql: "" },
    "security.mesh_session": { label: "ความปลอดภัย: มีคนดูหน้าจอ/เปิด terminal/ไฟล์เครื่องลูก", note: "ทุกครั้งที่เริ่ม session (ดูหน้าจอ = ปกติ, terminal/ไฟล์ = ด่วน)", sql: "" },
    "security.mesh_login_fail": { label: "ความปลอดภัย: ล็อกอิน MeshCentral ไม่ผ่าน", note: "ทุกครั้ง (รหัส/2FA ผิด, บัญชีถูกล็อก)", sql: "" },
    "security.agent_added": { label: "ความปลอดภัย: เครื่องใหม่ติดตั้ง ARANKUB Agent", note: "ทุกเครื่องที่เข้ากลุ่มใหม่ — ถ้าไม่รู้จักเครื่องนั้น ให้ลบออกจากกลุ่ม", sql: "" },
    "security.risky_software": { label: "ความปลอดภัย: พบโปรแกรมเสี่ยงติดตั้งใหม่", note: "จากการสแกนโปรแกรมรอบ 12 ชม.: ตัวแครก (ด่วน), รีโมทภายนอก, Office หมดซัพพอร์ต", sql: "" },
    "security.agents_drop": { label: "ความปลอดภัย: agent หลุดพร้อมกันหลายเครื่อง", note: `ออนไลน์ลดลง ≥${DROP_MIN} เครื่อง และ ≥${DROP_RATIO * 100}% ภายใน 10 นาที = แจ้ง (ด่วน) — ไฟดับ/สวิตช์ล่ม/ransomware ปิดบริการ (ช่วงเลิกงานอาจแจ้งได้)`, sql: "" },
    "security.recovered": { label: "ความปลอดภัย: กลับมาปกติ", note: "สภาวะข้างต้นหายแล้ว พร้อมระยะเวลา", sql: "" },
    "security.daily": { label: "ความปลอดภัย: สรุปประจำวัน", note: "07:30 น. ทุกวัน ยอด 24 ชม.: ล็อกอินผิด, 2FA ผิด, ยิงหาช่องโหว่, IP ถูกบล็อก, agent ออนไลน์", sql: "" },
  },

  async run(ctx) {
    const { cfg, state, incident, notify, log, TZ, save } = ctx;
    const url = (cfg.ARANKUB_URL || "http://localhost:3000").replace(/\/$/, "") + "/api/security/feed";
    if (!cfg.ARANKUB_SYNC_SECRET) { if (!state.warned) { log("ยังไม่ได้ตั้ง ARANKUB_SYNC_SECRET ใน .env — ข้าม"); state.warned = true; } return; }

    // ครั้งแรก: เริ่มนับจากตอนนี้ ไม่ย้อนแจ้งของเก่า
    if (!state.cursor) { state.cursor = new Date(Date.now() - 60_000).toISOString(); save(); log("เริ่มเฝ้าระวังตั้งแต่", state.cursor); return; }

    const today = thDate(TZ);
    const wantSummary = thHM(TZ) >= "07:30" && state.summaryDay !== today;
    let feed;
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "x-sync-secret": cfg.ARANKUB_SYNC_SECRET, "Content-Type": "application/json" },
        body: JSON.stringify({ since: state.cursor ?? null, summary: wantSummary }), signal: AbortSignal.timeout(50_000),
      });
      if (!res.ok) { log("ดึง feed ไม่สำเร็จ", res.status); return; }
      feed = await res.json();
    } catch (e) { log("ดึง feed ไม่สำเร็จ:", e.message); return; }

    for (const a of feed.alerts ?? []) await notify(a);

    const now = new Set();
    for (const i of feed.incidents ?? []) {
      const id = `sec:${i.key}`;
      now.add(id);
      await incident(id, true, { open: i.open, recovered: i.recovered });
      (state.recover ??= {})[id] = i.recovered;
    }
    for (const id of Object.keys(state.recover ?? {})) {
      if (now.has(id)) continue;
      await incident(id, false, { open: { title: "" }, recovered: state.recover[id] });
      delete state.recover[id];
    }

    // agent หลุดพร้อมกัน
    const t = Date.now();
    state.samples = [...(state.samples ?? []).filter((s) => t - s.t <= 10 * 60_000), { t, n: feed.agents?.online ?? 0 }];
    const peak = Math.max(...state.samples.map((s) => s.n));
    const cur = feed.agents?.online ?? 0;
    const dropping = peak - cur >= DROP_MIN && (peak - cur) / Math.max(peak, 1) >= DROP_RATIO;
    if (dropping) state.dropPeak = Math.max(state.dropPeak ?? 0, peak);
    const stillDown = state.dropPeak ? cur < state.dropPeak * 0.8 : false;
    const r = await incident("sec:agents_drop", dropping || stillDown, {
      open: { event: "security.agents_drop", priority: "urgent", title: `ARANKUB Agent หลุดพร้อมกัน ${peak - cur} เครื่องใน 10 นาที (เหลือออนไลน์ ${cur}/${feed.agents?.total ?? "-"})`,
        text: "ตรวจไฟฟ้า/สวิตช์/เครือข่ายของตึกที่หลุด ถ้าไฟและเน็ตปกติ ให้ตรวจว่ามีมัลแวร์ปิดบริการหรือไม่ (ช่วงเลิกงานที่ปิดเครื่องพร้อมกันอาจทำให้แจ้งได้)" },
      recovered: { event: "security.recovered", title: `ARANKUB Agent กลับมาออนไลน์ ${cur} เครื่อง` },
    });
    if (r === "recovered" || (!dropping && !stillDown)) delete state.dropPeak;

    if (wantSummary && feed.summary) { if (await notify(feed.summary)) state.summaryDay = today; }
    if (feed.cursor) state.cursor = feed.cursor;
    save();
  },
};
