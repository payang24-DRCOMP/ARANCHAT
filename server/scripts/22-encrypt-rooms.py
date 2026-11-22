#!/usr/bin/env python3
"""เปิดเข้ารหัสต้นทางถึงปลายทางให้ห้องเดิมที่ยังไม่เข้ารหัส (ตัดสินใจ 2026-11-12: มีข้อมูลผู้ป่วย)

ยกเว้น (ต้องไม่เข้ารหัส — บอทไม่มีกุญแจ ส่งข้อความในห้องเข้ารหัสไม่ได้):
  - ห้องที่บอท @aranchat อยู่: แชทกับ "ARANKUB AI", ห้องแจ้งเตือนตามเรื่อง, ห้องข่าวสาร (#news)
  - ห้องที่ไม่มีสมาชิกเหลือ
ข้อความเก่าก่อนเปิดยังไม่เข้ารหัส (เข้ารหัสย้อนหลังไม่ได้) · เปิดแล้วปิดกลับไม่ได้

ใช้: python3 scripts/22-encrypt-rooms.py           ดูรายการ (ยังไม่ทำอะไร)
     python3 scripts/22-encrypt-rooms.py --apply   เปิดเข้ารหัสจริง
วิธี: Synapse admin API ตั้งบัญชีผู้ดูแล (MATRIX_ADMIN_TOKEN) เป็นแอดมินห้อง แล้วส่ง m.room.encryption
"""
import json, os, sys, urllib.parse, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = dict(l.split("=", 1) for l in open(os.path.join(ROOT, "notify/.env"), encoding="utf-8").read().splitlines() if "=" in l and not l.startswith("#"))
HS, ADMIN = env["MATRIX_URL"], env["MATRIX_ADMIN_TOKEN"]
SERVER = dict(l.split("=", 1) for l in open(os.path.join(ROOT, "config.env"), encoding="utf-8").read().splitlines() if "=" in l and not l.startswith("#"))["SERVER_NAME"].strip('"')
BOT_ID = f"@aranchat:{SERVER}"
APPLY = "--apply" in sys.argv

def call(method, path, body=None):
    req = urllib.request.Request(HS + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Authorization": f"Bearer {ADMIN}", "Content-Type": "application/json", "User-Agent": "AranChat-admin/1.0"})
    try:
        with urllib.request.urlopen(req) as r: return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return json.loads(raw or b"{}") | {"_status": e.code}
        except ValueError: return {"_status": e.code, "error": raw[:200].decode(errors="replace")}

me = call("GET", "/_matrix/client/v3/account/whoami").get("user_id")
rooms, frm = [], 0
while True:
    page = call("GET", f"/_synapse/admin/v1/rooms?from={frm}&limit=100")
    rooms += page.get("rooms", [])
    if not page.get("next_batch"): break
    frm = page["next_batch"]

todo = []
for r in rooms:
    rid, name = r["room_id"], r.get("name") or r.get("canonical_alias") or "(ไม่มีชื่อ)"
    if r.get("encryption"): continue
    if not r.get("joined_local_members"): print(f"  ข้าม (ไม่มีสมาชิก)   {name}"); continue
    members = call("GET", f"/_synapse/admin/v1/rooms/{urllib.parse.quote(rid)}/members").get("members", [])
    if BOT_ID in members: print(f"  ข้าม (ห้องของบอท)    {name}"); continue
    todo.append((rid, name, len(members)))

print(f"\nจะเปิดเข้ารหัส {len(todo)} ห้อง:")
for rid, name, n in todo: print(f"  🔒 {name}  ({n} คน)  {rid}")
if not APPLY:
    print("\nยังไม่ได้ทำอะไร — ตรวจรายการแล้วรันใหม่พร้อม --apply"); sys.exit(0)

for rid, name, _ in todo:
    q = urllib.parse.quote(rid)
    r = call("POST", f"/_synapse/admin/v1/rooms/{q}/make_room_admin", {"user_id": me})
    if r.get("_status"): print(f"  ✗ {name}: ตั้งผู้ดูแลไม่ได้ {r}"); continue
    call("POST", f"/_synapse/admin/v1/join/{q}", {"user_id": me})   # ห้องที่ไม่ได้เป็นสมาชิก: make_room_admin เชิญไว้ → เข้าห้อง
    if me not in call("GET", f"/_synapse/admin/v1/rooms/{q}/members").get("members", []):
        call("POST", f"/_matrix/client/v3/join/{q}", {})            # admin join ไม่ผ่าน → ตอบรับคำเชิญเอง
    r = call("PUT", f"/_matrix/client/v3/rooms/{q}/state/m.room.encryption/", {"algorithm": "m.megolm.v1.aes-sha2"})
    print(f"  {'✗' if r.get('_status') else '✓'} {name}" + (f": {r}" if r.get("_status") else ""))
    # ไม่ค้างเป็นผู้ดูแลห้อง/สมาชิกที่ผู้ใช้ไม่รู้จัก (บัญชีผู้ดูแล = บอท): ลบระดับ 100 ที่ make_room_admin ตั้งไว้ แล้วออกจากห้อง
    st = call("GET", f"/_synapse/admin/v1/rooms/{q}/state").get("state", [])
    pl = next((e["content"] for e in st if e.get("type") == "m.room.power_levels" and e.get("state_key") == ""), None)
    if pl and me in pl.get("users", {}):
        pl["users"] = {u: v for u, v in pl["users"].items() if u != me}
        call("PUT", f"/_matrix/client/v3/rooms/{q}/state/m.room.power_levels/", pl)
    call("POST", f"/_matrix/client/v3/rooms/{q}/leave", {})
