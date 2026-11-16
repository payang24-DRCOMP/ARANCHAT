// HOSxP เครื่องหลัก ↔ เครื่องรอง — ข้อมูลเท่ากันไหม / replication ยังทำงานไหม (SELECT อย่างเดียว)
//
//   ทุก 1 นาที   ต่อฐานข้อมูลได้ไหม · เครื่องรองตั้ง read_only ไหม · นาฬิกาสองเครื่องตรงกันไหม
//                สถานะ replication (SHOW SLAVE STATUS — ต้องมีสิทธิ์ SLAVE MONITOR; ยังไม่มีสิทธิ์ = ข้ามเงียบๆ แล้วใช้การเทียบข้อมูลแทน)
//   ทุก 5 นาที   เทียบค่าล่าสุด/จำนวนแถววันนี้ของตารางหลักจากสองเครื่องพร้อมกัน — ต่างกันติดกัน 3 รอบ (15 นาที) จึงแจ้ง
//                (กันแจ้งพลาดช่วงที่เครื่องรองกำลังตามทัน)
//   07:30 น.     สรุปของเมื่อวาน
import mysql from "mysql2/promise";

const MARKERS_SQL = `
SELECT (SELECT MAX(vn) FROM ovst) max_vn,
       (SELECT MAX(an) FROM ipt) max_an,
       (SELECT MAX(lab_order_number) FROM lab_head) max_lab,
       (SELECT MAX(xn) FROM xray_report) max_xn,
       (SELECT COUNT(*) FROM ovst WHERE vstdate = CURDATE()) ovst_today,
       (SELECT COUNT(*) FROM opitemrece WHERE vstdate = CURDATE()) opitemrece_today,
       (SELECT COUNT(*) FROM ipt WHERE regdate = CURDATE()) ipt_today,
       (SELECT COUNT(*) FROM lab_head WHERE order_date = CURDATE()) lab_today`;
const MARKER_TH = {
  max_vn: "VN ล่าสุด", max_an: "AN ล่าสุด", max_lab: "ใบสั่งแล็บล่าสุด", max_xn: "XN ล่าสุด",
  ovst_today: "visit วันนี้", opitemrece_today: "รายการค่าใช้จ่ายวันนี้", ipt_today: "admit วันนี้", lab_today: "ใบสั่งแล็บวันนี้",
};
const HEALTH_SQL = "SELECT NOW() t, UNIX_TIMESTAMP() ts, @@read_only ro, @@server_id sid, @@hostname host";

let pools = null;
function poolsOf(cfg) {
  if (pools) return pools;
  const mk = (hp) => {
    const [host, port] = hp.split(":");
    return mysql.createPool({ host, port: Number(port || 3306), user: cfg.HOSXP_DB_USER, password: cfg.HOSXP_DB_PASSWORD,
      database: cfg.HOSXP_DB_NAME || "hos", connectionLimit: 1, connectTimeout: 8_000, dateStrings: true, charset: "utf8mb4" });
  };
  pools = { primary: mk(cfg.HOSXP_PRIMARY), replica: mk(cfg.HOSXP_REPLICA) };
  return pools;
}
async function q(pool, sql) {
  const c = await pool.getConnection();
  try {
    await c.query("START TRANSACTION READ ONLY");
    const [rows] = await c.query(sql);
    return rows;
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }
}
const settle = async (p) => { try { return { ok: true, v: await p }; } catch (e) { return { ok: false, e }; } };

const thDate = (TZ, d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const thHM = (TZ, d = new Date()) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

let round = 0;

export default {
  name: "hosxp-replica",
  everySec: 60,

  docs: {
    "hosxp.db_down": { label: "IT: ต่อฐานข้อมูล HOSxP ไม่ได้", note: "ทุก 1 นาที ต่อเครื่องหลักและเครื่องรองด้วยบัญชีอ่านอย่างเดียว — ไม่ได้ติดกัน 2 รอบ = แจ้ง (ด่วน) · ต่อได้อีกครั้ง = แจ้งกลับมาปกติ", sql: HEALTH_SQL },
    "hosxp.replica_stopped": { label: "IT: replication เครื่องรองหยุด", note: "SHOW SLAVE STATUS บนเครื่องรอง: Slave_IO_Running หรือ Slave_SQL_Running ไม่ใช่ Yes = แจ้ง (ด่วน) พร้อมข้อความ error\nต้องมีสิทธิ์ SLAVE MONITOR (ขอ IT แล้ว) — ยังไม่มีสิทธิ์จะข้ามข้อนี้ และใช้ \"ข้อมูลสองเครื่องไม่ตรงกัน\" แทน", sql: "SHOW SLAVE STATUS" },
    "hosxp.replica_lag": { label: "IT: เครื่องรองตามหลังเครื่องหลัก", note: "SHOW SLAVE STATUS: Seconds_Behind_Master เกินเกณฑ์ (ค่าเริ่มต้น 300 วินาที ตั้งได้ REPLICA_LAG_SEC) = แจ้ง", sql: "SHOW SLAVE STATUS" },
    "hosxp.data_mismatch": { label: "IT: ข้อมูลเครื่องหลัก/รองไม่ตรงกัน", note: "ทุก 5 นาที รัน query นี้ที่สองเครื่องพร้อมกันแล้วเทียบทุกค่า\nต่างกันติดกัน 3 รอบ (≈15 นาที) = แจ้ง (ด่วน) พร้อมบอกค่าที่ต่าง\nเครื่องรองมีค่ามากกว่าเครื่องหลัก = มีคนเขียนข้อมูลลงเครื่องรองโดยตรง\nไม่แจ้งซ้ำถ้า \"replication หยุด\" แจ้งไปแล้ว", sql: MARKERS_SQL },
    "hosxp.replica_writable": { label: "IT: เครื่องรองเขียนข้อมูลได้", note: "เครื่องรองควรตั้ง read_only = 1 — ถ้าเป็น 0 มีโปรแกรมหรือคนเผลอบันทึกลงเครื่องรองได้ ทำให้ข้อมูลไม่ตรงกันและ replication หยุด\nแจ้งครั้งเดียวเมื่อพบ และแจ้งอีกครั้งเมื่อแก้แล้ว", sql: HEALTH_SQL },
    "hosxp.clock_drift": { label: "IT: นาฬิกาเครื่อง HOSxP ไม่ตรงกัน", note: "เทียบ UNIX_TIMESTAMP() สองเครื่อง ต่างกันเกิน 120 วินาที = แจ้ง (เวลาบันทึกในเวชระเบียนจะคลาดเคลื่อน)", sql: HEALTH_SQL },
    "hosxp.recovered": { label: "IT: HOSxP กลับมาปกติ", note: "ปัญหาข้างต้นหายแล้ว — บอกว่าเป็นปัญหาอยู่นานเท่าไร", sql: "" },
    "hosxp.daily": { label: "IT: สรุปเครื่องหลัก/รอง HOSxP ประจำวัน", note: "07:30 น. ทุกวัน: เมื่อวานตรวจกี่รอบ ข้อมูลตรงกันกี่รอบ ตามหลังสูงสุด ต่อไม่ได้กี่ครั้ง สถานะตอนนี้", sql: "" },
  },

  async run(ctx) {
    const { cfg, state, incident, notify, log, TZ } = ctx;
    const p = poolsOf(cfg);
    const LAG = Number(cfg.REPLICA_LAG_SEC || 300);
    const today = thDate(TZ);
    state.day ??= today;
    state.stats ??= { rounds: 0, compared: 0, matched: 0, maxLag: null, downPrimary: 0, downReplica: 0, incidents: 0 };
    state.fail ??= { primary: 0, replica: 0 };
    state.mismatch ??= 0;
    const st = state.stats;
    round++;
    st.rounds++;

    // ── 1. ต่อได้ไหม / read_only / นาฬิกา ──
    const [hp, hr] = await Promise.all([settle(q(p.primary, HEALTH_SQL)), settle(q(p.replica, HEALTH_SQL))]);
    for (const [who, h, th] of [["primary", hp, "เครื่องหลัก"], ["replica", hr, "เครื่องรอง"]]) {
      if (h.ok) state.fail[who] = 0; else state.fail[who]++;
      const hostport = who === "primary" ? cfg.HOSXP_PRIMARY : cfg.HOSXP_REPLICA;
      const r = await incident(`down:${who}`, state.fail[who] >= 2, {
        open: { event: "hosxp.db_down", priority: "urgent", title: `ต่อฐานข้อมูล HOSxP ${th}ไม่ได้ (${hostport.split(":")[0]})`,
          fields: [["เครื่อง", `${th} ${hostport}`], ["ข้อผิดพลาด", String(h.e?.code ?? h.e?.message ?? "-").slice(0, 120)], ["ตั้งแต่", ctx.thTime()]] },
        recovered: { event: "hosxp.recovered", title: `ต่อฐานข้อมูล HOSxP ${th}ได้แล้ว` },
      });
      if (r === "opened") { st[who === "primary" ? "downPrimary" : "downReplica"]++; st.incidents++; }
    }
    const P = hp.ok ? hp.v[0] : null, R = hr.ok ? hr.v[0] : null;
    if (R) {
      await incident("writable", Number(R.ro) === 0, {
        open: { event: "hosxp.replica_writable", title: `เครื่องรอง HOSxP (${cfg.HOSXP_REPLICA.split(":")[0]}) ยังเขียนข้อมูลได้ (read_only = 0)`,
          text: "ควรตั้ง SET GLOBAL read_only = 1 และใส่ read_only = 1 ใน my.cnf",
          fields: [["เครื่อง", `${R.host} · server_id ${R.sid}`]] },
        recovered: { event: "hosxp.recovered", title: "เครื่องรอง HOSxP ตั้งอ่านอย่างเดียว (read_only = 1) แล้ว" },
      });
    }
    if (P && R) {
      const drift = Math.abs(Number(P.ts) - Number(R.ts));
      await incident("clock", drift > 120, {
        open: { event: "hosxp.clock_drift", title: `นาฬิกาเครื่อง HOSxP หลัก/รองต่างกัน ${drift} วินาที`,
          fields: [["เครื่องหลัก", P.t], ["เครื่องรอง", R.t]] },
        recovered: { event: "hosxp.recovered", title: "นาฬิกาเครื่อง HOSxP หลัก/รองตรงกันแล้ว" },
      });
    }

    // ── 2. สถานะ replication (ต้องมีสิทธิ์ SLAVE MONITOR) ──
    let replicaStopped = false;
    if (R) {
      const s = await settle(q(p.replica, "SHOW SLAVE STATUS"));
      if (!s.ok && /ACCESS_DENIED/.test(s.e?.code ?? "")) {
        if (state.slaveStatus !== "no_privilege") log("ยังไม่มีสิทธิ์ SHOW SLAVE STATUS — ใช้การเทียบข้อมูลอย่างเดียว");
        state.slaveStatus = "no_privilege";
      } else if (s.ok) {
        if (state.slaveStatus !== "ok") log("อ่านสถานะ replication ได้แล้ว");
        state.slaveStatus = "ok";
        const r = s.v[0];
        const io = r?.Slave_IO_Running ?? r?.Replica_IO_Running, sqlr = r?.Slave_SQL_Running ?? r?.Replica_SQL_Running;
        const lag = r?.Seconds_Behind_Master ?? r?.Seconds_Behind_Source ?? null;
        replicaStopped = !r || io !== "Yes" || sqlr !== "Yes";
        const rs = await incident("stopped", replicaStopped, {
          open: { event: "hosxp.replica_stopped", priority: "urgent", title: r ? "replication เครื่องรอง HOSxP หยุด" : "เครื่องรอง HOSxP ไม่ได้ตั้ง replication",
            fields: r ? [["IO thread", String(io)], ["SQL thread", String(sqlr)],
              ["error", String(r.Last_SQL_Error || r.Last_IO_Error || r.Last_Error || "-").slice(0, 280)],
              ["ตำแหน่ง", `${r.Relay_Master_Log_File ?? ""}:${r.Exec_Master_Log_Pos ?? ""}`]] : [] },
          recovered: { event: "hosxp.recovered", title: "replication เครื่องรอง HOSxP ทำงานแล้ว" },
        });
        if (rs === "opened") st.incidents++;
        if (lag != null) st.maxLag = Math.max(st.maxLag ?? 0, Number(lag));
        const rl = await incident("lag", !replicaStopped && lag != null && Number(lag) > LAG, {
          open: { event: "hosxp.replica_lag", title: `เครื่องรอง HOSxP ตามหลัง ${Math.round(Number(lag) / 60)} นาที`,
            fields: [["Seconds_Behind_Master", String(lag)], ["เกณฑ์", `${LAG} วินาที`]] },
          recovered: { event: "hosxp.recovered", title: "เครื่องรอง HOSxP ตามทันแล้ว" },
        });
        if (rl === "opened") st.incidents++;
      }
    }

    // ── 3. เทียบข้อมูล (ทุก 5 นาที · รอบแรกหลังเริ่มทำงานด้วย) ──
    if (P && R && (round === 1 || round % 5 === 0)) {
      const [mp, mr] = await Promise.all([settle(q(p.primary, MARKERS_SQL)), settle(q(p.replica, MARKERS_SQL))]);
      if (mp.ok && mr.ok) {
        const a = mp.v[0], b = mr.v[0];
        const diff = Object.keys(MARKER_TH).filter((k) => String(a[k]) !== String(b[k]));
        const ahead = diff.filter((k) => Number(b[k]) > Number(a[k]));   // เครื่องรองมากกว่าเครื่องหลัก = มีการเขียนลงเครื่องรอง
        st.compared++;
        if (!diff.length) st.matched++;
        state.mismatch = diff.length ? state.mismatch + 1 : 0;
        if (ctx.DRY) log("เทียบข้อมูล:", diff.length ? `ต่างกัน ${diff.join(", ")}` : "ตรงกันทุกค่า", JSON.stringify(a));
        const rm = await incident("mismatch", state.mismatch >= 3 && !replicaStopped, {
          open: { event: "hosxp.data_mismatch", priority: "urgent",
            title: ahead.length ? "เครื่องรอง HOSxP มีข้อมูลเกินเครื่องหลัก — มีการบันทึกลงเครื่องรองโดยตรง" : "ข้อมูล HOSxP เครื่องหลัก/รองไม่ตรงกันนานกว่า 15 นาที",
            fields: diff.slice(0, 8).map((k) => [MARKER_TH[k], `หลัก ${a[k] ?? "-"} · รอง ${b[k] ?? "-"}`]) },
          recovered: { event: "hosxp.recovered", title: "ข้อมูล HOSxP เครื่องหลัก/รองตรงกันแล้ว" },
        });
        if (rm === "opened") st.incidents++;
      }
    }

    // ── 4. สรุปประจำวัน (07:30 น.) ──
    if (today !== state.day) {   // ขึ้นวันใหม่ → เก็บสถิติเมื่อวานไว้รอส่ง
      state.yesterday = { day: state.day, ...st };
      state.day = today;
      state.stats = { rounds: 0, compared: 0, matched: 0, maxLag: null, downPrimary: 0, downReplica: 0, incidents: 0 };
    }
    const dailyAt = cfg.DAILY_AT || "07:30";
    if (state.yesterday && !state.yesterday.sent && thHM(TZ) >= dailyAt) {
      const y = state.yesterday;
      const now = [
        R ? (Number(R.ro) === 0 ? "เครื่องรองยังเขียนได้ (read_only = 0)" : "เครื่องรองอ่านอย่างเดียว ✓") : "ต่อเครื่องรองไม่ได้",
        state.slaveStatus === "ok" ? "อ่านสถานะ replication ได้ ✓" : "ยังไม่มีสิทธิ์อ่านสถานะ replication",
      ];
      const ok = await notify({
        event: "hosxp.daily", id: `daily:${y.day}`,
        title: y.incidents ? `สรุป HOSxP หลัก/รอง ${y.day}: มีปัญหา ${y.incidents} ครั้ง` : `สรุป HOSxP หลัก/รอง ${y.day}: ปกติ`,
        fields: [
          ["เทียบข้อมูล", `${y.compared} รอบ · ตรงกัน ${y.matched} รอบ`],
          ["ตามหลังสูงสุด", y.maxLag == null ? "อ่านไม่ได้ (ยังไม่มีสิทธิ์)" : `${y.maxLag} วินาที`],
          ["ต่อไม่ได้", `หลัก ${y.downPrimary} ครั้ง · รอง ${y.downReplica} ครั้ง`],
          ["ตอนนี้", now.join(" · ")],
        ],
      });
      if (ok) { y.sent = true; ctx.save(); }
    }
    ctx.save();
  },

  async close() { if (pools) await Promise.all([pools.primary.end(), pools.replica.end()]); },
};
