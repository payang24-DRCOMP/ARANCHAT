#!/usr/bin/env python3
# AranChat iOS — สร้างภาษาไทย (th.lproj) จากคำแปลไทยของแอป Android (element-x-android/**/values-th/*.xml)
# Element X iOS กับ Android ใช้ชื่อคีย์ข้อความชุดเดียวกัน (Localazy) → จับคู่ด้วยชื่อคีย์ก่อน
# ไม่เจอคีย์ → จับคู่ด้วยข้อความอังกฤษ (values/*.xml ของ Android) · ตัวแปรต้องตรงกัน ไม่งั้นข้าม (แสดงอังกฤษ)
# ใช้: python3 -I aranchat/i18n-th.py   (รันจากโฟลเดอร์ element-x-ios · รันซ้ำได้)
import glob, os, re, sys
import xml.etree.ElementTree as ET

IOS = os.getcwd()
AND = os.path.join(IOS, "..", "element-x-android")
LOC = os.path.join(IOS, "ElementX", "Resources", "Localizations")

def unandroid(s):
    s = (s or "").strip()
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        s = s[1:-1]
    s = s.replace("\\'", "'").replace('\\"', '"').replace("\\n", "\n").replace("\\@", "@").replace("\\?", "?")
    return re.sub(r"%(\d+\$)?s", lambda m: "%" + (m.group(1) or "") + "@", s)   # %1$s → %1$@

def text(el):
    return "".join(el.itertext())

def load(pattern):
    strings, plurals = {}, {}
    for f in sorted(glob.glob(os.path.join(AND, "**", pattern), recursive=True)):
        if "/build/" in f:
            continue
        try:
            root = ET.parse(f).getroot()
        except ET.ParseError:
            continue
        for el in root:
            name = el.get("name")
            if el.tag == "string" and name:
                strings[name] = unandroid(text(el))
            elif el.tag == "plurals" and name:
                plurals[name] = {i.get("quantity"): unandroid(text(i)) for i in el.findall("item")}
    return strings, plurals

th, th_pl = load("values-th/*.xml")
en, en_pl = load("values/*.xml")
by_en = {}
for k, v in en.items():
    if k in th:
        by_en.setdefault(v, th[k])

PH = re.compile(r"%(?:\d+\$)?(?:@|d|ld|lld|u|f|\.\d+f)")
ph = lambda s: sorted(PH.findall(s))

def parse_strings(path):
    out = {}
    if not os.path.exists(path):
        return out
    for m in re.finditer(r'^"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)";', open(path, encoding="utf-8").read(), re.M):
        val = m.group(2).replace('\\"', '"').replace("\\n", "\n").replace("\\\\", "\\")
        out[m.group(1)] = val
    return out

esc = lambda s: s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
os.makedirs(os.path.join(LOC, "th.lproj"), exist_ok=True)

total = 0
for name in ("Localizable", "Untranslated"):
    src = parse_strings(os.path.join(LOC, "en.lproj", f"{name}.strings"))
    lines, hit, skipped = [], 0, []
    for k, v in src.items():
        t = th.get(k) or by_en.get(v)
        if not t:
            continue
        if ph(t) != ph(v):
            skipped.append(k)
            continue
        lines.append(f'"{k}" = "{esc(t)}";')
        hit += 1
    with open(os.path.join(LOC, "th.lproj", f"{name}.strings"), "w", encoding="utf-8") as f:
        f.write("// สร้างโดย aranchat/i18n-th.py จากคำแปลไทยของ Android — อย่าแก้ตรงๆ\n" + "\n".join(lines) + "\n")
    total += hit
    print(f"{name}.strings: แปลแล้ว {hit}/{len(src)} · ข้าม (ตัวแปรไม่ตรง) {len(skipped)}")

# พหูพจน์ (stringsdict): ภาษาไทยไม่มีรูปพหูพจน์ → ใช้ other (หรือ one) ของ Android เป็นทุกรูป
for name in ("Localizable", "Untranslated"):
    p = os.path.join(LOC, "en.lproj", f"{name}.stringsdict")
    if not os.path.exists(p):
        continue
    import plistlib
    d = plistlib.load(open(p, "rb"))
    out, hit = {}, 0
    for k, entry in d.items():
        t = th_pl.get(k)
        if not t:
            continue
        val = t.get("other") or t.get("one") or next(iter(t.values()), None)
        if not val:
            continue
        e = {kk: vv for kk, vv in entry.items()}
        var = next((kk for kk, vv in entry.items() if isinstance(vv, dict) and "NSStringFormatSpecTypeKey" in vv), None)
        if not var:
            continue
        rule = dict(entry[var])
        en_other = rule.get("other", "")
        if ph(val) != ph(en_other):
            continue
        for q in ("zero", "one", "two", "few", "many"):
            rule.pop(q, None)
        rule["other"] = val
        e[var] = rule
        out[k] = e
        hit += 1
    plistlib.dump(out, open(os.path.join(LOC, "th.lproj", f"{name}.stringsdict"), "wb"))
    print(f"{name}.stringsdict: แปลแล้ว {hit}/{len(d)}")

# ชื่อแอป/ข้อความขอสิทธิ์ (InfoPlist.strings): ใช้ของอังกฤษไปก่อนถ้าไม่มีคำแปล
src = parse_strings(os.path.join(LOC, "en.lproj", "InfoPlist.strings"))
lines = [f'"{k}" = "{esc(th.get(k) or by_en.get(v) or v)}";' for k, v in src.items()
         if ph(th.get(k) or by_en.get(v) or v) == ph(v)]
open(os.path.join(LOC, "th.lproj", "InfoPlist.strings"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(f"รวม {total} ข้อความ → ElementX/Resources/Localizations/th.lproj/")
