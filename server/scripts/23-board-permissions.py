#!/usr/bin/env python3
"""เปิดให้สมาชิกทุกคนสร้าง "โน้ต" และ "อัลบั้ม" ในห้องเดิม (แบบ LINE — ใครในกลุ่มก็เพิ่มได้)

โน้ต/อัลบั้ม (element-web src/aranchat/groupBoard.ts) ใช้ state event com.arankub.note / com.arankub.album
ซึ่งปกติต้องเป็นผู้ดูแลห้อง (ระดับ 50) → ตั้งเป็น 0 ใน m.room.power_levels
ห้องใหม่: ผู้ดูแลห้องเปิดหน้าโน้ต/อัลบั้มครั้งแรก แอปตั้งให้เอง — สคริปต์นี้สำหรับห้องที่มีอยู่แล้วทั้งหมด
ข้าม: ห้องของบอท @aranchat (แจ้งเตือน/ข่าวสาร) และห้องที่ไม่มีสมาชิก

ใช้: python3 scripts/23-board-permissions.py           ดูรายการ (ยังไม่ทำอะไร)
     python3 scripts/23-board-permissions.py --apply   ตั้งค่าจริง
วิธี: เหมือน 22-encrypt-rooms.py (admin API ตั้งบัญชีผู้ดูแลเป็นแอดมินห้อง) แล้วตอนแก้สิทธิ์ ลบชื่อตัวเองออกจากผู้ดูแลห้อง แล้วออกจากห้อง
"""
import json, os, sys, urllib.parse, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = dict(l.split("=", 1) for l in open(os.path.join(ROOT, "notify/.env"), encoding="utf-8").read().splitlines() if "=" in l and not l.startswith("#"))
HS, ADMIN = env["MATRIX_URL"], env["MATRIX_ADMIN_TOKEN"]
SERVER = dict(l.split("=", 1) for l in open(os.path.join(ROOT, "config.env"), encoding="utf-8").read().splitlines() if "=" in l and not l.startswith("#"))["SERVER_NAME"].strip('"')
# ทดสอบกับเซิร์ฟเวอร์อื่น: ARAN_HS=http://127.0.0.1:18008 ARAN_ADMIN_TOKEN=... ARAN_SERVER=aranchat.test
HS, ADMIN, SERVER = os.environ.get("ARAN_HS", HS), os.environ.get("ARAN_ADMIN_TOKEN", ADMIN), os.environ.get("ARAN_SERVER", SERVER)
BOT_ID = f"@aranchat:{SERVER}"
TYPES = ("com.arankub.note", "com.arankub.album")
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

def power_levels(rid):
    for ev in call("GET", f"/_synapse/admin/v1/rooms/{urllib.parse.quote(rid)}/state").get("state", []):
        if ev.get("type") == "m.room.power_levels" and ev.get("state_key") == "": return ev.get("content", {})
    return None

me = call("GET", "/_matrix/client/v3/account/whoami").get("user_id")
rooms, frm = [], 0
while True:
    page = call("GET", f"/_synapse/admin/v1/rooms?from={frm}&limit=100")
    rooms += page.get("rooms", [])
    if not page.get("next_batch"): break
    frm = page["next_batch"]

todo = []
for r in rooms:
    rid, name = r["room_id"], r.get("name") or r.get("canonical_alias") or "(ไม่มีชื่อ / แชทส่วนตัว)"
    if not r.get("joined_local_members"): continue
    if r.get("room_type") == "m.space": continue
    members = call("GET", f"/_synapse/admin/v1/rooms/{urllib.parse.quote(rid)}/members").get("members", [])
    if BOT_ID in members: continue
    pl = power_levels(rid)
    if pl is None: continue
    if all(pl.get("events", {}).get(t) == 0 for t in TYPES): continue
    todo.append((rid, name, len(members)))

print(f"จะเปิดโน้ต/อัลบั้มให้สมาชิกทุกคน {len(todo)} ห้อง:")
for rid, name, n in todo: print(f"  📝 {name}  ({n} คน)  {rid}")
if not APPLY:
    print("\nยังไม่ได้ทำอะไร — ตรวจรายการแล้วรันใหม่พร้อม --apply"); sys.exit(0)

for rid, name, _ in todo:
    q = urllib.parse.quote(rid)
    was_member = me in call("GET", f"/_synapse/admin/v1/rooms/{q}/members").get("members", [])
    had_level = (power_levels(rid) or {}).get("users", {}).get(me)
    if not was_member: had_level = None   # ค้างจากรอบที่ไม่สำเร็จ (เชิญ+ตั้งระดับไว้แต่ไม่ได้เข้าห้อง) → ไม่คืนระดับนี้
    r = call("POST", f"/_synapse/admin/v1/rooms/{q}/make_room_admin", {"user_id": me})
    if r.get("_status"): print(f"  ✗ {name}: ตั้งผู้ดูแลไม่ได้ {r}"); continue
    call("POST", f"/_synapse/admin/v1/join/{q}", {"user_id": me})
    # admin join ไม่ผ่าน (บางห้อง) → make_room_admin เชิญไว้แล้ว ตอบรับคำเชิญเอง
    if me not in call("GET", f"/_synapse/admin/v1/rooms/{q}/members").get("members", []):
        call("POST", f"/_matrix/client/v3/join/{q}", {})
    pl = power_levels(rid) or {}
    pl["events"] = {**pl.get("events", {}), **{t: 0 for t in TYPES}}
    # คืนระดับเดิมของบัญชีผู้ดูแล (ไม่ค้างเป็นแอดมินห้องที่สมาชิกไม่รู้จัก) — ลดระดับตัวเองได้ในคำสั่งเดียวกัน
    users = dict(pl.get("users", {}))
    if had_level is None: users.pop(me, None)
    else: users[me] = had_level
    pl["users"] = users
    r = call("PUT", f"/_matrix/client/v3/rooms/{q}/state/m.room.power_levels/", pl)
    print(f"  {'✗' if r.get('_status') else '✓'} {name}" + (f": {r}" if r.get("_status") else ""))
    if not was_member: call("POST", f"/_matrix/client/v3/rooms/{q}/leave", {})   # ไม่ค้างอยู่ในแชทของผู้ใช้ (บัญชีผู้ดูแล = บอท)
