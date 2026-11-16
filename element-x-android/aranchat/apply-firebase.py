# ใส่ Firebase ของเราเองลงแอป (แทนของ Element) — แจ้งเตือนเด้งได้แม้ปิดแอป (ตัว gplay)
# ใช้: python3 -I aranchat/apply-firebase.py /path/to/google-services.json   (รันจากโฟลเดอร์ element-x-android)
# google-services.json ดาวน์โหลดจาก Firebase Console → Project settings → Your apps (Android)
#   ต้องลงทะเบียน package: <APP_ID> (ตัวจริง) และ <APP_ID>.debug (ตัวทดสอบ ไม่มีก็ได้) ตาม aranchat/brand.env
# ค่าในไฟล์นี้ไม่ใช่ความลับ (ฝังในแอปอยู่แล้ว) — ความลับคือ service account ที่ใช้ฝั่ง server (aranchat-ess 16-push.sh)
import json, os, re, sys

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
env = dict(l.strip().split("=", 1) for l in open(os.path.join(root, "aranchat/brand.env"), encoding="utf-8")
           if "=" in l and not l.startswith("#"))
app_id = env["APP_ID"]
g = json.load(open(sys.argv[1], encoding="utf-8"))
p = g["project_info"]
clients = {c["client_info"]["android_client_info"]["package_name"]: c for c in g["client"]}
if app_id not in clients:
    sys.exit(f"ไม่พบ package {app_id} ใน google-services.json (มี: {', '.join(clients)}) — เพิ่มแอป Android ใน Firebase ก่อน")
main = clients[app_id]
web_client = next((o["client_id"] for c in g["client"] for o in c.get("oauth_client", []) if o.get("client_type") == 3), "")

res = os.path.join(root, "libraries/pushproviders/firebase/src")
with open(os.path.join(res, "main/res/values/firebase.xml"), "w", encoding="utf-8") as f:
    f.write(f'''<?xml version="1.0" encoding="utf-8"?>
<!-- AranChat: aranchat/apply-firebase.py จาก google-services.json (โปรเจกต์ {p["project_id"]}) -->
<resources xmlns:tools="http://schemas.android.com/tools">
    <string name="default_web_client_id" translatable="false">{web_client}</string>
    <string name="firebase_database_url" translatable="false">{p.get("firebase_url", "")}</string>
    <string name="gcm_defaultSenderId" translatable="false">{p["project_number"]}</string>
    <string name="google_api_key" translatable="false">{main["api_key"][0]["current_key"]}</string>
    <string name="google_crash_reporting_api_key" translatable="false">{main["api_key"][0]["current_key"]}</string>
    <string name="google_storage_bucket" translatable="false">{p.get("storage_bucket", "")}</string>
    <string name="project_id" translatable="false" tools:ignore="UnusedResources">{p["project_id"]}</string>
</resources>
''')
# google_app_id แยกตามชนิด build: release = APP_ID · debug = APP_ID.debug · nightly = APP_ID.nightly (ไม่มี → ใช้ของตัวจริง)
for variant, pkg in (("release", app_id), ("debug", app_id + ".debug"), ("nightly", app_id + ".nightly")):
    gid = clients.get(pkg, main)["client_info"]["mobilesdk_app_id"]
    fp = os.path.join(res, variant, "res/values/firebase.xml"); s = open(fp, encoding="utf-8").read()
    open(fp, "w", encoding="utf-8").write(re.sub(r'(name="google_app_id"[^>]*>)[^<]*', lambda m: m.group(1) + gid, s))
    print(f"{variant:8} {pkg:40} {'✓' if pkg in clients else '(ใช้ของตัวจริงแทน — push ของตัวนี้จะไม่เด้ง)'}")
print(f"ใส่ Firebase โปรเจกต์ {p['project_id']} แล้ว — build: ./aranchat/build.sh :app:assembleGplayRelease")
