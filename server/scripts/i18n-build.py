#!/usr/bin/env python3
"""สร้างไฟล์ภาษาไทย (JSON) จากไฟล์แปล i18n/*.tsv

ใช้: i18n-build.py <en.json ต้นฉบับ> <out th.json> <tsv>...

- tsv: key<TAB>คำแปล (key แบบจุด เช่น room_list.filters.unread, \\n = ขึ้นบรรทัดใหม่)
- ตรวจทุกข้อความว่าตัวแปร (%(name)s, %s) และแท็ก (<a>, <userId/>) ครบเท่าต้นฉบับ
  ไม่ครบ / key ไม่มีในต้นฉบับแล้ว (เวอร์ชันใหม่เปลี่ยน) → ทิ้ง แสดงเป็นภาษาอังกฤษแทน ไม่ทำให้แอปพัง
- "@key": {...} (คำอธิบายสำหรับนักแปลของ MAS) ไม่แปล
"""
import json
import re
import sys

TOKEN = re.compile(r"%\([a-zA-Z0-9_]+\)s|%s|</?[a-zA-Z][a-zA-Z0-9]*\s*/?>")


def flat(d, prefix="", path=()):
    """→ (key แบบจุด, (ชื่อแต่ละชั้นจริง), ข้อความ) — ชื่อชั้นมีจุดในตัวได้ เช่น timeline → "m.room.member" → join"""
    for k, v in d.items():
        if k.startswith("@") and isinstance(v, dict):   # คำอธิบายของ MAS (Element มี key จริงที่ขึ้นต้นด้วย @)
            continue
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            yield from flat(v, key, path + (k,))
        else:
            yield key, path + (k,), v


def tokens(s):
    return sorted(t.replace(" ", "") for t in TOKEN.findall(s))


def main():
    en_path, out_path, *tsvs = sys.argv[1:]
    src = list(flat(json.load(open(en_path, encoding="utf-8"))))
    en = {k: v for k, _, v in src}
    paths = {k: p for k, p, _ in src}
    out, ok, dropped = {}, 0, []
    for path in tsvs:
        for line in open(path, encoding="utf-8"):
            line = line.rstrip("\n")
            if not line or "\t" not in line:
                continue
            key, th = line.split("\t", 1)
            th = th.replace("\\n", "\n")
            if key not in en:
                dropped.append(f"{key} (ไม่มีในต้นฉบับเวอร์ชันนี้)")
                continue
            if tokens(th) != tokens(en[key]):
                dropped.append(f"{key} (ตัวแปร/แท็กไม่ตรง: {tokens(en[key])} ≠ {tokens(th)})")
                continue
            node = out
            *parents, leaf = paths[key]
            for p in parents:
                node = node.setdefault(p, {})
            node[leaf] = th
            ok += 1
    json.dump(out, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"แปลแล้ว {ok}/{len(en)} ข้อความ ({ok * 100 // len(en)}%) → {out_path}")
    for d in dropped:
        print(f"  ข้าม: {d}")


if __name__ == "__main__":
    main()
