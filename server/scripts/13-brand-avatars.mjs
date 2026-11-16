// เปลี่ยนรูปโปรไฟล์บอท + รูปห้อง เป็นไอคอนแบรนด์ปัจจุบัน (brand/icon-512.png)
// ใช้หลังเปลี่ยนโลโก้: node scripts/13-brand-avatars.mjs   (อ่าน MATRIX_URL / MATRIX_TOKEN ของบอทจาก notify/.env)
//   - อัปโหลดรูป → ตั้งเป็นรูปบอท @aranchat
//   - ห้องที่บอทอยู่และยังใช้รูปบอทเดิม (หรือไม่มีรูป สำหรับห้องรวม/ห้องแจ้งเตือน) → ตั้งรูปใหม่
//   - พิมพ์ mxc ใหม่ให้นำไปใส่ values/hookshot.yaml.tpl (รูปบอท Webhook)
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, "notify/.env"), "utf8").split("\n")
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]));
const HS = env.MATRIX_URL || "https://matrix.arankub.com";
const H = { Authorization: `Bearer ${env.MATRIX_TOKEN}` };

async function mx(method, p, body, attempt = 0) {
  const r = await fetch(HS + p, { method, headers: { ...H, "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  if (r.status === 429 && attempt < 5) { await new Promise((ok) => setTimeout(ok, 2000)); return mx(method, p, body, attempt + 1); }
  if (!r.ok) throw new Error(`${method} ${p.split("?")[0]} → ${r.status}`);
  return r.json();
}

const png = fs.readFileSync(path.join(ROOT, "brand/icon-512.png"));
const up = await fetch(`${HS}/_matrix/media/v3/upload?filename=aranchat.png`, { method: "POST", headers: { ...H, "Content-Type": "image/png" }, body: png });
if (!up.ok) throw new Error(`upload → ${up.status}`);
const { content_uri: mxc } = await up.json();

const { user_id: me } = await mx("GET", "/_matrix/client/v3/account/whoami");
const old = (await mx("GET", `/_matrix/client/v3/profile/${encodeURIComponent(me)}`)).avatar_url;
await mx("PUT", `/_matrix/client/v3/profile/${encodeURIComponent(me)}/avatar_url`, { avatar_url: mxc });
console.log(`รูปบอท ${me}: เปลี่ยนแล้ว`);

const { joined_rooms } = await mx("GET", "/_matrix/client/v3/joined_rooms");
let n = 0;
for (const id of joined_rooms) {
  const st = (t) => mx("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(id)}/state/${t}/`).catch(() => null);
  const av = await st("m.room.avatar"), alias = await st("m.room.canonical_alias");
  const isBrandRoom = av?.url ? av.url === old : !!alias?.alias; // ห้องที่ใช้รูปบอทเดิม หรือห้องสาธารณะ (มี alias) ที่ยังไม่มีรูป
  if (!isBrandRoom) continue;
  try { await mx("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(id)}/state/m.room.avatar/`, { url: mxc }); n++; }
  catch (e) { console.log(`ข้ามห้อง ${alias?.alias ?? id}: ${e.message}`); }
}
console.log(`รูปห้อง: เปลี่ยน ${n} ห้อง`);
console.log(`MXC=${mxc}`);
