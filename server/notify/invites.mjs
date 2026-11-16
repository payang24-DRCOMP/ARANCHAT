// AranChat — ลิงก์ชวนเพื่อน / แชร์กลุ่ม: https://chat.arankub.com/i/<รหัส>
//
// ทำไมใช้รหัส (ไม่ใช้ @ชื่อผู้ใช้ตรงๆ): โปรไฟล์บน server ไม่เปิดให้คนนอกดู — รหัสสร้างโดยเจ้าของเท่านั้น
//   คนภายนอกไล่เดารายชื่อเจ้าหน้าที่ไม่ได้ · นับได้ว่าใครชวนใครเข้ามา (ขยายชุมชน)
// แบบ:
//   user  = ชวนคุยกับฉัน → เปิดลิงก์แล้วเข้าแชทส่วนตัวกับคนชวน
//   room  = แชร์กลุ่ม → เปิดลิงก์แล้ว "ขอเข้าร่วม" (knock) ผู้ดูแลกลุ่มกดอนุมัติ — กลุ่มเข้ารหัส มีข้อมูลผู้ป่วย ไม่ให้ใครเข้าเองได้
//
// API (ingress /api/notify → publicApi ใน server.mjs):
//   POST /api/notify/invite/create        { openid, room_id? }  → { code, url, joined }   (สร้างหรือใช้รหัสเดิม)
//   GET  /api/notify/invite/<code>                              → { kind, name, room_name?, members? }  (หน้า /i/ และแอปใช้)
//   GET  /api/notify/invite/<code>/avatar                       → รูปโปรไฟล์/กลุ่ม (ย่อ)
//   GET  /api/notify/invite/<code>/page                         → หน้า HTML (nginx /i/<code>) — มี og:title สำหรับตัวอย่างลิงก์ใน LINE
//   POST /api/notify/invite/<code>/accept { openid }            → { kind, mxid?, room_id? } + นับผู้เข้าร่วม + บอทบอกคนชวน
import fs from "node:fs";
import crypto from "node:crypto";

const CODE = /^[a-z0-9]{8}$/;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // ไม่มี i l o 0 1 (อ่านผิดง่าย)

export function createInvites({ state, save, mx, say, dmRoom, log, matrixUrl, chatHost, getServerName, adminToken, pageTemplate }) {
  state.invites ??= {}; // code → { kind, by, roomId?, at, joined: [mxid] }

  const newCode = () => Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  async function whoIs(openid) {
    const token = openid?.access_token;
    if (typeof token !== "string" || !/^[\w\-.~+/=]{8,512}$/.test(token)) return null;
    if (openid.matrix_server_name !== getServerName()) return null;
    const r = await fetch(`${matrixUrl}/_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(token)}`);
    if (!r.ok) return null;
    const { sub } = await r.json();
    return typeof sub === "string" && sub.endsWith(`:${getServerName()}`) ? sub : null;
  }

  async function admin(method, path) {
    const r = await fetch(matrixUrl + path, { method, headers: { Authorization: `Bearer ${adminToken}`, "User-Agent": "AranChat-notify/1.0" } });
    if (!r.ok) throw Object.assign(new Error(`admin ${path.split("?")[0]} → ${r.status}`), { status: r.status });
    return r.json();
  }

  const profile = (mxid) => mx("GET", `/_matrix/client/v3/profile/${encodeURIComponent(mxid)}`).catch(() => ({}));

  async function roomInfo(roomId) {
    const r = await admin("GET", `/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}`);
    return { name: r.name || r.canonical_alias || "กลุ่ม", members: r.joined_members ?? 0, avatar: r.avatar ?? null, joinRules: r.join_rules };
  }

  async function info(code) {
    const inv = state.invites[code];
    if (!inv) return null;
    const p = await profile(inv.by);
    const out = { kind: inv.kind, name: p.displayname || inv.by.slice(1).split(":")[0], has_avatar: !!p.avatar_url };
    if (inv.kind === "room") {
      const r = await roomInfo(inv.roomId).catch(() => null);
      if (!r) return null;
      Object.assign(out, { room_name: r.name, members: r.members, has_avatar: !!r.avatar, room_id: inv.roomId });
    } else {
      out.mxid = inv.by;
    }
    return out;
  }

  /** รูปย่อ 96px ผ่าน bot (สื่อบน server ต้องล็อกอิน) — เฉพาะรูปของเจ้าของลิงก์/กลุ่มนั้น */
  async function avatar(code, res) {
    const inv = state.invites[code];
    if (!inv) return false;
    let mxc;
    if (inv.kind === "room") mxc = (await roomInfo(inv.roomId).catch(() => ({}))).avatar;
    else mxc = (await profile(inv.by)).avatar_url;
    const m = /^mxc:\/\/([^/]+)\/([\w-]+)$/.exec(mxc ?? "");
    if (!m) return false;
    const r = await fetch(`${matrixUrl}/_matrix/client/v1/media/thumbnail/${m[1]}/${m[2]}?width=96&height=96&method=crop`, {
      headers: { Authorization: `Bearer ${await botToken()}` },
    });
    if (!r.ok) return false;
    res.writeHead(200, { "Content-Type": r.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "public, max-age=3600" });
    res.end(Buffer.from(await r.arrayBuffer()));
    return true;
  }
  let token;
  const botToken = async () => (token ??= process.env.MATRIX_TOKEN);

  async function create(mxid, roomId) {
    if (roomId) {
      // room v12 ขึ้นไป: "!<hash>" ไม่มี ":server" ต่อท้าย
      if (!/^![\w\-.=+/]{8,}(:[\w\-.]+)?$/.test(roomId)) throw Object.assign(new Error("room_id ไม่ถูกต้อง"), { code: 400 });
      const { members } = await admin("GET", `/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}/members`);
      if (!members?.includes(mxid)) throw Object.assign(new Error("ไม่ได้อยู่ในกลุ่มนี้"), { code: 403 });
    }
    const kind = roomId ? "room" : "user";
    let code = Object.keys(state.invites).find((c) => state.invites[c].by === mxid && state.invites[c].kind === kind && (state.invites[c].roomId ?? null) === (roomId ?? null));
    if (!code) {
      do code = newCode(); while (state.invites[code]);
      state.invites[code] = { kind, by: mxid, ...(roomId ? { roomId } : {}), at: new Date().toISOString(), joined: [] };
      save();
      log("invite created", kind, mxid, roomId ?? "");
    }
    return { code, url: `https://${chatHost}/i/${code}`, joined: state.invites[code].joined.length };
  }

  async function accept(code, mxid) {
    const inv = state.invites[code];
    if (!inv) return null;
    if (mxid !== inv.by && !inv.joined.includes(mxid)) {
      inv.joined.push(mxid);
      save();
      log("invite accepted", code, mxid);
      // บอกคนชวน (แชทกับบอท "AranChat แจ้งเตือน") — เห็นผลทันทีว่ามีคนเข้ามาจากลิงก์ของตัวเอง
      const p = await profile(mxid);
      const who = p.displayname || mxid;
      const what = inv.kind === "room" ? `เปิดลิงก์กลุ่ม "${(await roomInfo(inv.roomId).catch(() => ({ name: "กลุ่ม" }))).name}" ของคุณ — กดขอเข้าร่วมแล้วจะขึ้นให้ผู้ดูแลอนุมัติในกลุ่ม`
        : "เข้ามาคุยกับคุณผ่านลิงก์ชวนเพื่อน";
      dmRoom(inv.by)
        .then((room) => say(room, `🎉 ${who} ${what}\nชวนสำเร็จแล้ว ${inv.joined.length} คน`))
        .catch((e) => log("invite notify failed", e.message));
    }
    return inv.kind === "room" ? { kind: "room", room_id: inv.roomId } : { kind: "user", mxid: inv.by };
  }

  function page(code, data) {
    const title = data
      ? data.kind === "room" ? `${data.name} ชวนคุณเข้ากลุ่ม "${data.room_name}" บน AranChat` : `${data.name} ชวนคุณคุยบน AranChat`
      : "ลิงก์นี้ใช้ไม่ได้แล้ว — AranChat";
    const html = (pageTemplate() ?? "<!doctype html><title>__TITLE__</title><body>__TITLE__")
      .replaceAll("__TITLE__", esc(title))
      .replaceAll("__CODE__", esc(code))
      .replaceAll("__DATA__", JSON.stringify(data ?? null).replace(/</g, "\\u003c"));
    return html;
  }

  /** คืน true ถ้าจัดการ request นี้แล้ว */
  async function handle(req, res, path, reply, readBody) {
    if (!path.startsWith("/api/notify/invite")) return false;
    if (req.method === "POST" && path === "/api/notify/invite/create") {
      const body = await readBody();
      const mxid = await whoIs(body.openid);
      if (!mxid) return reply(401, { error: "unauthorized" }), true;
      try {
        reply(200, await create(mxid, body.room_id));
      } catch (e) {
        reply(e.code ?? 500, { error: e.message });
      }
      return true;
    }
    const m = /^\/api\/notify\/invite\/([a-z0-9]+)(\/avatar|\/page|\/accept)?$/.exec(path);
    if (!m || !CODE.test(m[1])) return reply(404, { error: "ไม่พบลิงก์" }), true;
    const [, code, sub] = m;
    if (req.method === "GET" && !sub) {
      const data = await info(code);
      return data ? reply(200, data) : reply(404, { error: "ไม่พบลิงก์" }), true;
    }
    if (req.method === "GET" && sub === "/avatar") {
      if (!(await avatar(code, res))) reply(404, { error: "ไม่มีรูป" });
      return true;
    }
    if (req.method === "GET" && sub === "/page") {
      const data = await info(code).catch(() => null);
      res.writeHead(data ? 200 : 404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(page(code, data));
      return true;
    }
    if (req.method === "POST" && sub === "/accept") {
      const body = await readBody();
      const mxid = await whoIs(body.openid);
      if (!mxid) return reply(401, { error: "unauthorized" }), true;
      const out = await accept(code, mxid);
      return out ? reply(200, out) : reply(404, { error: "ไม่พบลิงก์" }), true;
    }
    reply(404, { error: "not found" });
    return true;
  }

  return { handle };
}

/** อ่านแม่แบบหน้า /i/ ใหม่เมื่อไฟล์เปลี่ยน (scripts/09-branding.sh render ใหม่ได้โดยไม่ต้อง restart) */
export function templateReader(file) {
  let cached, mtime = 0;
  return () => {
    try {
      const st = fs.statSync(file);
      if (st.mtimeMs !== mtime) { cached = fs.readFileSync(file, "utf8"); mtime = st.mtimeMs; }
    } catch { /* ไม่มีไฟล์ — ใช้หน้าพื้นฐาน */ }
    return cached;
  };
}
