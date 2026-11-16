# ดึงข้อความภาษาอังกฤษทั้งหมดของแอป (res/values/localazy.xml ทุกโมดูล) → en.tsv  (โมดูล<TAB>ชื่อ<TAB>ข้อความ)
# plurals: ชื่อ = name#quantity · ภาษาไทยไม่มีพหูพจน์ ใช้ข้อความรูป "other"
import sys, glob, os, re
import xml.etree.ElementTree as ET
root = sys.argv[1]; out = sys.argv[2]
rows = []
for f in sorted(glob.glob(f"{root}/**/src/main/res/values/localazy.xml", recursive=True)):
    if "/build/" in f: continue
    mod = os.path.relpath(f, root).split("/src/main/")[0]
    for el in ET.parse(f).getroot():
        if el.get("translatable") == "false": continue
        if el.tag == "string":
            rows.append((mod, el.get("name"), "".join(el.itertext())))
        elif el.tag == "plurals":
            items = {i.get("quantity"): "".join(i.itertext()) for i in el}
            rows.append((mod, el.get("name") + "#other", items.get("other") or list(items.values())[-1]))
with open(out, "w", encoding="utf-8") as fh:
    for r in rows:
        fh.write("\t".join(x.replace("\t", " ").replace("\n", "\\n") for x in r) + "\n")
print(len(rows), "ข้อความ")
