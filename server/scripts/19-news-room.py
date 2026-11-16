#!/usr/bin/env python3
"""ห้องประกาศ "📢 ข่าวสาร รพ.อรัญ" (#news:<เซิร์ฟเวอร์>) — สร้างครั้งเดียว + ดึงผู้ใช้ทุกคนเข้าห้อง (รันซ้ำได้: ดึงเฉพาะคนที่ยังไม่อยู่)
- บอท @aranchat เป็นเจ้าของ · ทุกคนโพสต์/คุยได้ (ห้องกลาง — ตัดสินใจ 2026-11-11) · ตั้งค่าห้อง/เชิญ/ลบข้อความคนอื่น = ผู้ดูแล · เห็น "อ่านแล้ว N"
- ดึงคนเข้าใช้ Synapse admin API (MATRIX_ADMIN_TOKEN ใน notify/.env) · คนใหม่เข้าเองอัตโนมัติ (values/synapse.yaml.tpl auto_join_rooms)
ใช้: python3 scripts/19-news-room.py [@ผู้ดูแลห้อง ...]   (ผู้ดูแลห้อง = โพสต์ประกาศได้ / ตั้งคนอื่นเพิ่มได้)
"""
import json, os, sys, urllib.parse, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = dict(l.split("=", 1) for l in open(os.path.join(ROOT, "notify/.env"), encoding="utf-8").read().splitlines() if "=" in l and not l.startswith("#"))
HS, BOT, ADMIN = env["MATRIX_URL"], env["MATRIX_TOKEN"], env["MATRIX_ADMIN_TOKEN"]
SERVER = dict(l.split("=", 1) for l in open(os.path.join(ROOT, "config.env"), encoding="utf-8").read().splitlines() if "=" in l and not l.startswith("#"))["SERVER_NAME"].strip('"')
ALIAS, BOT_ID = f"#news:{SERVER}", f"@aranchat:{SERVER}"
mods = sys.argv[1:]

def call(method, path, body=None, token=BOT):
    req = urllib.request.Request(HS + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                                          "User-Agent": "AranChat-admin/1.0"})   # Cloudflare บล็อก User-Agent ของ Python
    try:
        with urllib.request.urlopen(req) as r: return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return json.loads(raw or b"{}") | {"_status": e.code}
        except ValueError: return {"_status": e.code, "error": raw[:200].decode(errors="replace")}

r = call("GET", f"/_matrix/client/v3/directory/room/{urllib.parse.quote(ALIAS)}")
room = r.get("room_id")
if not room:
    r = call("POST", "/_matrix/client/v3/createRoom", {
        "preset": "public_chat", "room_alias_name": "news", "name": "📢 ข่าวสาร รพ.อรัญ",
        "topic": "ห้องกลางโรงพยาบาลอรัญประเทศ — ประกาศ แจ้งข่าว และพูดคุยกันได้ทุกคน",
        "initial_state": [{"type": "m.room.history_visibility", "state_key": "", "content": {"history_visibility": "shared"}}],
        "power_level_content_override": {"events_default": 0, "state_default": 50, "invite": 50, "redact": 50,
                                         # ห้องรุ่น 12: ผู้สร้าง (บอท) มีสิทธิ์สูงสุดอยู่แล้ว ห้ามใส่ในรายชื่อ (ใส่แล้วสร้างห้องไม่สำเร็จ)
                                         "users": {m: 100 for m in mods},
                                         "events": {"m.reaction": 0, "m.room.redaction": 0}},
    })
    if "room_id" not in r: sys.exit(f"สร้างห้องไม่สำเร็จ: {r.get('_status')} {r.get('errcode')} {r.get('error')}")
    room = r["room_id"]
    print("สร้างห้องแล้ว", room)
else:
    print("มีห้องอยู่แล้ว", room)
    if mods:
        pl = call("GET", f"/_matrix/client/v3/rooms/{room}/state/m.room.power_levels")
        if "_status" in pl or "errcode" in pl: sys.exit(f"อ่านสิทธิ์ห้องไม่ได้: {pl.get('errcode')}")
        pl.setdefault("users", {}).update({m: 100 for m in mods})
        call("PUT", f"/_matrix/client/v3/rooms/{room}/state/m.room.power_levels", pl)

members = set(call("GET", f"/_matrix/client/v3/rooms/{room}/joined_members").get("joined", {}))
users, frm = [], 0
while True:
    page = call("GET", f"/_synapse/admin/v2/users?from={frm}&limit=100&guests=false&deactivated=false", token=ADMIN)
    users += [u["name"] for u in page.get("users", [])]
    if not page.get("next_token"): break
    frm = page["next_token"]
added = 0
for u in users:
    if u in members or u == BOT_ID or u.startswith("@hookshot:"): continue   # บอทระบบไม่ต้องอยู่ห้องประกาศ
    res = call("POST", f"/_synapse/admin/v1/join/{room}", {"user_id": u}, token=ADMIN)
    if "room_id" in res: added += 1
    else: print("ดึงเข้าไม่สำเร็จ", u, res.get("errcode"), res.get("error"))
print(f"สมาชิกเดิม {len(members)} · ดึงเข้าเพิ่ม {added} · ผู้ใช้ทั้งหมด {len(users)}")
