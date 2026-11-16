# ใส่ภาษาไทยลงแอป → <โมดูล>/src/main/res/values-th/translations.xml + เพิ่ม "th" ในรายการภาษาที่แอปรองรับ
# ใช้: python3 -I aranchat/i18n/apply-th.py .   (รันจากโฟลเดอร์ element-x-android)
#   en.tsv      ข้อความอังกฤษทั้งหมด (extract.py)
#   th-web.tsv  คำแปลที่ตรงกับเว็บแชท (อังกฤษ<TAB>ไทย)
#   th-NNN.tsv  คำแปลของแอป (หมายเลขบรรทัดใน todo.txt<TAB>ไทย)
# ข้อความที่ตัวแปร (%1$s, %d …) ไม่ตรงต้นฉบับจะถูกข้าม (แอปแสดงภาษาอังกฤษแทน) — ดูรายการที่พิมพ์ออกมา
# อัปเดตแอปเวอร์ชันใหม่: รัน extract.py ใหม่ → ข้อความใหม่ที่ยังไม่แปลจะเป็นภาษาอังกฤษ จนกว่าจะเพิ่มคำแปล
import glob, os, re, sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from xml.sax.saxutils import escape

root = sys.argv[1]
here = os.path.join(root, "aranchat", "i18n")
norm = lambda s: s.strip().strip('"').strip()
PH = re.compile(r"%(?:\d+\$)?[sd@]")

web = {}
for l in open(os.path.join(here, "th-web.tsv"), encoding="utf-8"):
    if l.startswith("#") or "\t" not in l: continue
    e, t = l.rstrip("\n").split("\t", 1); web[e] = t
todo = [l.rstrip("\n") for l in open(os.path.join(here, "todo.txt"), encoding="utf-8")]
byidx = {}
for f in sorted(glob.glob(os.path.join(here, "th-[0-9]*.tsv"))):
    for l in open(f, encoding="utf-8"):
        if "\t" not in l: continue
        i, t = l.rstrip("\n").split("\t", 1)
        byidx[todo[int(i) - 1]] = t
th = {**byidx, **web}

def android(t):
    # สตริงอยู่ใน "…" แบบต้นฉบับ: apostrophe ไม่ต้อง escape, " ต้อง escape, & < > ต้อง escape เป็น XML
    t = t.replace('\\"', '"').replace('"', '\\"')
    return '"' + escape(t) + '"'

mods = defaultdict(list); skipped = []; ok = 0
for f in sorted(glob.glob(f"{root}/**/src/main/res/values/localazy.xml", recursive=True)):
    if "/build/" in f: continue
    out = []
    for el in ET.parse(f).getroot():
        if el.get("translatable") == "false": continue
        if el.tag == "string":
            e = norm("".join(el.itertext())); t = th.get(e)
            if t is None: continue
            if sorted(PH.findall(e)) != sorted(PH.findall(t)): skipped.append((el.get("name"), e, t)); continue
            out.append(f'  <string name="{el.get("name")}">{android(t)}</string>'); ok += 1
        elif el.tag == "plurals":
            items = {i.get("quantity"): norm("".join(i.itertext())) for i in el}
            e = items.get("other") or list(items.values())[-1]; t = th.get(e)
            if t is None: continue
            # ภาษาไทยไม่มีพหูพจน์ → ใช้รูป other อย่างเดียว · ตัวแปรต้องตรงทุกรูป
            if sorted(PH.findall(e)) != sorted(PH.findall(t)): skipped.append((el.get("name"), e, t)); continue
            out.append(f'  <plurals name="{el.get("name")}">\n    <item quantity="other">{android(t)}</item>\n  </plurals>'); ok += 1
    if out:
        d = os.path.join(os.path.dirname(os.path.dirname(f)), "values-th")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "translations.xml"), "w", encoding="utf-8") as fh:
            fh.write('<?xml version="1.0" encoding="utf-8"?>\n<!-- AranChat: aranchat/i18n/apply-th.py (อย่าแก้ไฟล์นี้ตรงๆ) -->\n'
                     '<resources xmlns:xliff="urn:oasis:names:tc:xliff:document:1.2">\n' + "\n".join(out) + "\n</resources>\n")
        mods[d] = len(out)

# รายการภาษาที่แอปรองรับ (localeFilters + เลือกภาษาในแอปของ Android 13)
p = os.path.join(root, "plugins/src/main/kotlin/extension/locales.kt"); s = open(p, encoding="utf-8").read()
if '"th",' not in s: s = s.replace('    "tr",', '    "th",\n    "tr",', 1); open(p, "w", encoding="utf-8").write(s)
p = os.path.join(root, "app/src/main/res/xml/locales_config.xml"); s = open(p, encoding="utf-8").read()
if '"th"' not in s: s = s.replace('    <locale android:name="tr"/>', '    <locale android:name="th"/>\n    <locale android:name="tr"/>', 1); open(p, "w", encoding="utf-8").write(s)

print(f"ภาษาไทย {ok} ข้อความ ใน {len(mods)} โมดูล · ข้าม {len(skipped)} ข้อความ (ตัวแปรไม่ตรง)")
for n, e, t in skipped[:20]: print(f"  ข้าม {n}: {e!r} → {t!r}")
