// AranChat Keyvault — ฝากกุญแจกู้คืนแชทเข้ารหัส (recovery key) ของผู้ใช้แต่ละคนไว้บน server ของ รพ.
//
// ทำไม: แชทเข้ารหัสต้นทางถึงปลายทาง (E2EE) — กุญแจอยู่ในเครื่องผู้ใช้ เปลี่ยนมือถือ/ล้างแอปแล้วต้องกู้กุญแจคืน
//   แอปสร้าง recovery key ให้อัตโนมัติแล้วฝากไว้ที่นี่ → ล็อกอินเครื่องใหม่ แอปดึงคืนเอง อ่านแชทเก่าได้ทันที ผู้ใช้ไม่ต้องจำอะไร
// ความปลอดภัย:
//   - ข้อความยังเข้ารหัสต่อคนภายนอก (Cloudflare, Apple/Google push, ผู้ดักเครือข่าย) — กุญแจไม่เคยออกนอก server รพ.
//   - เก็บแบบเข้ารหัส AES-256-GCM ด้วย KEYVAULT_SECRET (.env) — ไฟล์ data/keys.json หลุดไปอย่างเดียวเปิดไม่ได้
//     ⚠️ สำรอง KEYVAULT_SECRET แยกจากไฟล์สำรองข้อมูลปกติ (เก็บกับกุญแจเซ็นแอป) — หาย = กู้กุญแจของทุกคนไม่ได้
//   - ยืนยันตัวผู้ขอด้วย OpenID token ของ Matrix (แอปไม่ต้องส่ง access token) → ได้ mxid จาก Synapse โดยตรง
//   - ทุกครั้งที่อ่าน/เขียนบันทึกลง data/audit.log (ใคร ทำอะไร เมื่อไร จาก IP ไหน) — ไม่บันทึกตัวกุญแจ
//
// ทางเข้า: https://chat.arankub.com/api/keyvault (K3s ingress → 10.42.0.1:3212 · k8s/keyvault.yaml.tpl)
//   POST /api/keyvault/get  { openid }                         → 200 { recovery_key } | 404
//   POST /api/keyvault/put  { openid, recovery_key, replace? } → 200 | 409 (มีอยู่แล้ว และไม่ได้ส่ง replace)
//   POST /api/keyvault/allow-reset { openid } → 200 — บัญชีที่มีกุญแจยืนยันตัวตน (cross-signing) เก่าบน server แต่ไม่มีใครถือกุญแจ
//        ให้แอปตั้งชุดใหม่ได้ภายใน 10 นาทีโดยไม่ต้องถามรหัสผ่าน (Synapse admin API) · จำกัดชั่วโมงละครั้งต่อคน
//   openid = ผลจาก POST /_matrix/client/v3/user/{userId}/openid/request_token
// รัน: pm2 start server.mjs --name aranchat-keyvault --node-args="--env-file=.env" · ติดตั้ง: scripts/21-keyvault.sh
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";

const env = (k, d) => process.env[k] ?? d ?? (() => { throw new Error(`ต้องตั้ง ${k}`); })();
const MATRIX = env("MATRIX_URL", "https://matrix.arankub.com");
const SERVER_NAME = env("SERVER_NAME", "arankub.com");
const SECRET = Buffer.from(env("KEYVAULT_SECRET"), "hex");
if (SECRET.length !== 32) throw new Error("KEYVAULT_SECRET ต้องเป็น hex 64 ตัว (32 ไบต์)");
const [HOST, PORT] = env("BIND", "10.42.0.1:3212").split(":");
const DATA = env("DATA_DIR", new URL("./data", import.meta.url).pathname);
const KEYS = `${DATA}/keys.json`;
const AUDIT = `${DATA}/audit.log`;
// recovery key ของ Matrix: base58 เว้นวรรคทุก 4 ตัว ขึ้นต้น "Es"
const ADMIN_TOKEN = process.env.MATRIX_ADMIN_TOKEN; // ใช้เฉพาะ allow-reset
const lastReset = new Map();
const RECOVERY_KEY = /^Es[1-9A-HJ-NP-Za-km-z ]{40,80}$/;

const log = (...a) => console.log(new Date().toISOString(), ...a);
const keys = (() => { try { return JSON.parse(fs.readFileSync(KEYS, "utf8")); } catch { return {}; } })();
function save() {
  fs.writeFileSync(KEYS + ".tmp", JSON.stringify(keys), { mode: 0o600 });
  fs.renameSync(KEYS + ".tmp", KEYS);
}
function audit(mxid, action, ip) {
  fs.appendFileSync(AUDIT, `${new Date().toISOString()}\t${mxid}\t${action}\t${ip}\n`, { mode: 0o600 });
}

function seal(mxid, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", SECRET, iv);
  c.setAAD(Buffer.from(mxid)); // ย้ายกุญแจไปบัญชีอื่นไม่ได้
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64"), at: new Date().toISOString() };
}
function open(mxid, box) {
  const d = crypto.createDecipheriv("aes-256-gcm", SECRET, Buffer.from(box.iv, "base64"));
  d.setAAD(Buffer.from(mxid));
  d.setAuthTag(Buffer.from(box.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(box.ct, "base64")), d.final()]).toString("utf8");
}

/** OpenID token → mxid (ถาม Synapse ของเราเท่านั้น) */
async function whoIs(openid) {
  const token = openid?.access_token;
  if (typeof token !== "string" || !/^[\w\-.~+/=]{8,512}$/.test(token)) return null;
  if (openid.matrix_server_name !== SERVER_NAME) return null;
  const r = await fetch(`${MATRIX}/_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(token)}`);
  if (!r.ok) return null;
  const { sub } = await r.json();
  return typeof sub === "string" && sub.endsWith(`:${SERVER_NAME}`) ? sub : null;
}

// กันเดา: ไม่เกิน 30 ครั้ง/นาที ต่อ IP
const hits = new Map();
function limited(ip) {
  const now = Date.now(), h = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  h.push(now); hits.set(ip, h);
  return h.length > 30;
}
setInterval(() => hits.clear(), 10 * 60_000).unref();

const server = http.createServer(async (req, res) => {
  // CORS: แอป Desktop (Electron) เรียกจาก origin อื่น · ไม่ใช้ cookie (ยืนยันด้วย OpenID token ใน body) จึงเปิด * ได้
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  const reply = (code, obj) => { res.writeHead(code, { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
  if (req.method === "OPTIONS") { res.writeHead(204, { ...cors, "Access-Control-Max-Age": "86400" }); return res.end(); }
  const ip = req.headers["cf-connecting-ip"] ?? (String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress);
  try {
    const path = new URL(req.url, "http://x").pathname.replace(/\/+$/, "");
    if (req.method === "GET" && path === "/api/keyvault/health") return reply(200, { ok: true });
    if (req.method !== "POST" || !["/api/keyvault/get", "/api/keyvault/put", "/api/keyvault/allow-reset"].includes(path)) return reply(404, { error: "not found" });
    if (limited(ip)) return reply(429, { error: "ถี่เกินไป" });
    let raw = "";
    for await (const c of req) { raw += c; if (raw.length > 8_000) return reply(413, { error: "too large" }); }
    const body = JSON.parse(raw || "{}");
    const mxid = await whoIs(body.openid);
    if (!mxid) { log("openid ไม่ถูกต้อง จาก", ip); return reply(401, { error: "unauthorized" }); }

    if (path === "/api/keyvault/allow-reset") {
      if (!ADMIN_TOKEN) return reply(501, { error: "ไม่ได้ตั้ง MATRIX_ADMIN_TOKEN" });
      if (Date.now() - (lastReset.get(mxid) ?? 0) < 3600_000) return reply(429, { error: "ชั่วโมงละครั้ง" });
      lastReset.set(mxid, Date.now());
      const r = await fetch(`${MATRIX}/_synapse/admin/v1/users/${encodeURIComponent(mxid)}/_allow_cross_signing_replacement_without_uia`, {
        method: "POST", headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json", "User-Agent": "AranChat-keyvault/1.0" }, body: "{}",
      });
      audit(mxid, `allow-reset ${r.status}`, ip);
      return r.ok || r.status === 404 ? reply(200, { ok: true }) : reply(502, { error: `synapse ${r.status}` });
    }
    if (path === "/api/keyvault/get") {
      const box = keys[mxid];
      audit(mxid, box ? "get" : "get-none", ip);
      return box ? reply(200, { recovery_key: open(mxid, box) }) : reply(404, { error: "none" });
    }
    const key = String(body.recovery_key ?? "");
    if (!RECOVERY_KEY.test(key)) return reply(400, { error: "recovery_key ไม่ถูกรูปแบบ" });
    if (keys[mxid] && body.replace !== true) { audit(mxid, "put-exists", ip); return reply(409, { error: "exists" }); }
    keys[mxid] = seal(mxid, key);
    save();
    audit(mxid, body.replace === true ? "replace" : "put", ip);
    log("เก็บกุญแจ", mxid);
    reply(200, { ok: true });
  } catch (e) {
    log("error:", e.message);
    reply(500, { error: "keyvault ขัดข้อง" });
  }
});

if (process.argv[2] === "--selftest") {
  const box = seal("@a:x", "EsTest key 1234");
  if (open("@a:x", box) !== "EsTest key 1234") throw new Error("seal/open ผิด");
  try { open("@b:x", box); throw new Error("ต้องเปิดด้วยบัญชีอื่นไม่ได้"); } catch (e) { if (e.message.startsWith("ต้อง")) throw e; }
  console.log("selftest ok");
} else {
  server.listen(Number(PORT), HOST, () => log(`keyvault ฟังที่ ${HOST}:${PORT} · ${Object.keys(keys).length} บัญชี`));
}
