// ห้องแจ้งเตือนของกลุ่มงาน — สร้างเองอัตโนมัติเมื่อกลุ่มงานนั้นมีเรื่องครั้งแรก ("👥 Plan-D · กลุ่มงานประกันสุขภาพ")
// สร้าง/เชิญผ่าน admin API ของระบบแจ้งเตือน (127.0.0.1 · NOTIFY_ADMIN_KEY จาก notify/.env) — bot เป็นเจ้าของห้อง ห้องไม่เข้ารหัส
// สมาชิก: คนที่เชื่อม /pland แล้วและหน่วยงานใน Plan-D ตรงกัน (ชวนให้ตอนสร้างห้อง + ตอนเชื่อมบัญชีทีหลัง) · ผู้ดูแลเพิ่ม/ลบคนเองได้
// ปิด: UNIT_ROOMS=off ใน .env
import crypto from "node:crypto";

export function createUnits({ cfg, state, save, log, readEnv, DRY, membersOf }) {
  const enabled = (cfg.UNIT_ROOMS ?? "on") !== "off";
  const nenv = readEnv(cfg.NOTIFY_ENV_FILE ?? new URL("../notify/.env", import.meta.url).pathname);
  const ADMIN = `http://127.0.0.1:${nenv.PORT ?? 3210}/admin`;
  const ADMIN_KEY = nenv.NOTIFY_ADMIN_KEY;
  state.unitRooms ??= {};   // ชื่อกลุ่มงาน → channel id
  const idFor = (orgUnit) => `pu-${crypto.createHash("sha1").update(orgUnit).digest("hex").slice(0, 12)}`;

  async function admin(method, path, body) {
    if (!ADMIN_KEY) throw new Error("ไม่พบ NOTIFY_ADMIN_KEY (notify/.env)");
    const r = await fetch(`${ADMIN}${path}`, {
      method, headers: { Authorization: `Bearer ${ADMIN_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  }

  /** ปลายทาง "room:<id>" ของกลุ่มงาน (สร้างถ้ายังไม่มี) · null = ปิดใช้/ไม่รู้กลุ่มงาน */
  async function ensure(orgUnit) {
    if (!enabled || !orgUnit) return null;
    const known = state.unitRooms[orgUnit];
    if (known) return `room:${known}`;
    const id = idFor(orgUnit);
    if (DRY) return `room:${id}`;
    const members = membersOf(orgUnit);
    const r = await admin("POST", "/channels", {
      id, icon: "👥", name: `Plan-D · ${orgUnit}`.slice(0, 60),
      topic: `แจ้งเตือนเรื่องของ${orgUnit}จาก Plan-D (ลา · ไปราชการ · แจ้งซ่อม · หนังสือเข้า) — ห้องนี้เห็นเฉพาะเรื่องของกลุ่มงานนี้`,
      members,
    });
    if (r.status !== 200 && r.status !== 409) throw new Error(`สร้างห้องกลุ่มงานไม่ได้ (${r.status} ${r.json.error ?? ""})`);
    state.unitRooms[orgUnit] = id;
    save();
    log(r.status === 200 ? `สร้างห้องกลุ่มงาน "${orgUnit}" (room:${id}) ชวน ${members.length} คน` : `ใช้ห้องกลุ่มงานเดิม "${orgUnit}" (room:${id})`);
    return `room:${id}`;
  }

  /** ชวนเข้าห้องกลุ่มงาน (ถ้าห้องมีแล้ว) — ตอนเชื่อมบัญชีใหม่ */
  async function invite(orgUnit, mxids) {
    const id = enabled && orgUnit && state.unitRooms[orgUnit];
    if (!id || DRY || !mxids.length) return;
    const r = await admin("POST", `/channels/${id}/members`, { add: mxids });
    log(`ชวนเข้าห้องกลุ่มงาน "${orgUnit}":`, JSON.stringify(r.json.results ?? r.json));
  }

  return { ensure, invite, enabled };
}
