#!/usr/bin/env python3
"""ชุดสติกเกอร์บน server — เพิ่มชุดใหม่ได้โดยไม่ต้องออกแอปรุ่นใหม่ (เว็บ / Desktop / Android โหลดจาก https://<chat>/stickers/index.json)

เพิ่มชุด: สร้างโฟลเดอร์ ~/aranchat-ess/stickers/<รหัสชุด>/ (a-z 0-9 _ -) ใส่รูป แล้วรันสคริปต์นี้
  - รูป: .png (รวม APNG เคลื่อนไหว) .gif .webp (เคลื่อนไหวได้) — ขนาดแนะนำ 320x320 ไม่เกิน 500 KB
  - ชื่อไฟล์ = ข้อความของสติกเกอร์ (ขึ้นในแจ้งเตือน/รายการแชท/ค้นหา) เช่น "รับทราบ.png" "01 ขอบคุณค่ะ.webp"
    ตัวเลขนำหน้า + ช่องว่าง ใช้เรียงลำดับ ไม่แสดง
  - ไฟล์ pack.json (ไม่ใส่ก็ได้): {"name": "ชื่อชุด", "icon": "ไฟล์รูปแท็บ.png", "order": 10, "hidden": false}
  - ชุดพื้นฐาน "น้องอรัญ" (aran) มาจากแอปเอง (element-web res/aranchat-stickers) — ใส่ไว้ใน index ด้วยเสมอ
ซ่อนชุด: "hidden": true ใน pack.json (คนที่เคยส่งไปแล้วยังเห็นในแชทตามเดิม)
ไฟล์ปลายทาง: ~/aranchat-apps/web-dist/stickers/ (nginx aranchat-branding เสิร์ฟที่ /stickers/ — k8s/branding.yaml.tpl)

ใช้: python3 scripts/24-stickers.py
"""
import hashlib, json, os, re, shutil, struct, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get("ARAN_STICKERS_SRC", os.path.join(ROOT, "stickers"))
BUILTIN = os.environ.get("ARAN_BUILTIN_STICKERS", "/home/payang/aranchat-apps/element-web/apps/web/res/aranchat-stickers")
OUT = os.environ.get("ARAN_STICKERS_OUT", "/home/payang/aranchat-apps/web-dist/stickers")
EXT = {".png": "image/png", ".gif": "image/gif", ".webp": "image/webp"}
MAX_BYTES = 1024 * 1024

def dims(path):
    """กว้าง x สูง จากหัวไฟล์ PNG/GIF/WebP (ไม่ต้องใช้ไลบรารีเสริม) + เคลื่อนไหวไหม"""
    with open(path, "rb") as f: head = f.read(64 * 1024)
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", head[16:24]); return w, h, b"acTL" in head
    if head[:6] in (b"GIF87a", b"GIF89a"):
        w, h = struct.unpack("<HH", head[6:10]); return w, h, head.count(b"\x21\xf9\x04") > 1
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        kind = head[12:16]
        if kind == b"VP8X":
            w = int.from_bytes(head[24:27], "little") + 1; h = int.from_bytes(head[27:30], "little") + 1
            return w, h, bool(head[20] & 0x02)
        if kind == b"VP8 ":
            w, h = struct.unpack("<HH", head[26:30]); return w & 0x3FFF, h & 0x3FFF, False
        if kind == b"VP8L":
            b = head[21:25]; v = int.from_bytes(b, "little"); return (v & 0x3FFF) + 1, ((v >> 14) & 0x3FFF) + 1, False
    raise ValueError("ไม่รู้จักรูปแบบไฟล์")

def label(filename):
    name = os.path.splitext(filename)[0]
    return re.sub(r"^\d+[\s._-]+", "", name).strip() or name

packs, problems = [], []
os.makedirs(OUT + ".new", exist_ok=True)
shutil.rmtree(OUT + ".new"); os.makedirs(OUT + ".new")

# ชุดพื้นฐานจากแอป (id สติกเกอร์เดิม → แคชรูปบน server ใช้ร่วมกับแอปรุ่นเก่า)
try:
    base = json.load(open(os.path.join(BUILTIN, "pack.json"), encoding="utf-8"))
    os.makedirs(os.path.join(OUT + ".new", "aran"))
    stickers = []
    for s in base["stickers"]:
        shutil.copy2(os.path.join(BUILTIN, s["file"]), os.path.join(OUT + ".new", "aran", s["file"]))
        stickers.append({**s, "file": "aran/" + s["file"], "mime": "image/png"})
    packs.append({"id": "aran", "name": base.get("name", "น้องอรัญ"), "icon": stickers[0]["file"], "order": 0, "stickers": stickers})
except FileNotFoundError:
    problems.append(f"ไม่พบชุดพื้นฐาน {BUILTIN}")

for pid in sorted(os.listdir(SRC)) if os.path.isdir(SRC) else []:
    d = os.path.join(SRC, pid)
    if not os.path.isdir(d): continue
    if not re.fullmatch(r"[a-z0-9_-]{1,32}", pid) or pid == "aran":
        problems.append(f"ข้ามโฟลเดอร์ \"{pid}\" — ชื่อชุดต้องเป็น a-z 0-9 _ - (และไม่ใช่ aran)"); continue
    meta = {}
    if os.path.exists(os.path.join(d, "pack.json")):
        meta = json.load(open(os.path.join(d, "pack.json"), encoding="utf-8"))
    if meta.get("hidden"): print(f"  ซ่อน   {pid}"); continue
    os.makedirs(os.path.join(OUT + ".new", pid))
    stickers = []
    for fn in sorted(os.listdir(d)):
        ext = os.path.splitext(fn)[1].lower()
        if ext not in EXT: continue
        p = os.path.join(d, fn)
        size = os.path.getsize(p)
        if size > MAX_BYTES: problems.append(f"{pid}/{fn}: ใหญ่เกิน 1 MB ({size // 1024} KB) — ข้าม"); continue
        try: w, h, animated = dims(p)
        except ValueError as e: problems.append(f"{pid}/{fn}: {e} — ข้าม"); continue
        sid = hashlib.sha1(fn.encode()).hexdigest()[:10]
        out = sid + ext   # ชื่อไฟล์ปลายทางเป็น ASCII (URL ไม่ต้อง encode)
        shutil.copy2(p, os.path.join(OUT + ".new", pid, out))
        stickers.append({"id": sid, "body": label(fn)[:60], "file": f"{pid}/{out}", "w": w, "h": h, "size": size, "mime": EXT[ext], **({"animated": True} if animated else {})})
    if not stickers: problems.append(f"{pid}: ไม่มีรูป — ข้าม"); continue
    icon = next((s["file"] for s in stickers if meta.get("icon") and s["body"] == label(meta["icon"])), stickers[0]["file"])
    packs.append({"id": pid, "name": str(meta.get("name") or pid)[:40], "icon": icon, "order": int(meta.get("order", 100)), "stickers": stickers})
    print(f"  ✓ {pid}: {meta.get('name') or pid} ({len(stickers)} ตัว{', มีแบบเคลื่อนไหว' if any(s.get('animated') for s in stickers) else ''})")

packs.sort(key=lambda p: (p["order"], p["id"]))
index = {"version": 2, "packs": [{k: v for k, v in p.items() if k != "order"} for p in packs]}
json.dump(index, open(os.path.join(OUT + ".new", "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
if os.path.exists(OUT): shutil.rmtree(OUT)
os.rename(OUT + ".new", OUT)
for p in problems: print("  ⚠", p)
print(f"\nพร้อม {len(packs)} ชุด → {OUT}/index.json (เว็บ: https://chat.<โดเมน>/stickers/index.json)")
