#!/usr/bin/env bash
# เว็บแชทตัวที่ build จากซอร์สของเรา (~/aranchat-apps/element-web สาขา aranchat)
#   ./14-web-beta.sh        → https://__CHAT_HOST__/beta/  (ทดลอง)
#   ./14-web-beta.sh live   → https://__CHAT_HOST__/       (ตัวจริง — เปิด/ปิดด้วย scripts/15-web-switch.sh)
# ใช้บัญชี/ห้องเดียวกัน · ไฟล์อยู่ ~/aranchat-apps/web-dist/<beta|live> (nginx aranchat-branding เสิร์ฟ)
#   build ก่อน: cd ~/aranchat-apps/element-web/apps/web && pnpm build
source "$(dirname "$0")/lib.sh"
SRC=${SRC:-/home/payang/aranchat-apps/element-web/apps/web/webapp}
TARGET=${1:-beta}
[[ "$TARGET" == beta || "$TARGET" == live ]] || die "ใช้: $0 [beta|live]"
OUT=/home/payang/aranchat-apps/web-dist/$TARGET
[[ -f "$SRC/index.html" ]] || die "ยังไม่ได้ build: $SRC"

info "คัดลอกเว็บแชทที่ build แล้ว"
rm -rf "$OUT.new" && mkdir -p "$(dirname "$OUT")" && cp -r "$SRC" "$OUT.new"
# เหลือเฉพาะชุดไฟล์ที่ index.html ใช้ (build ซ้ำแล้วชุดเก่าค้าง) + ไม่เอาไฟล์ดีบัก .map
KEEP=$(grep -o 'bundles/[0-9a-f]*' "$OUT.new/index.html" | head -1 | cut -d/ -f2)
find "$OUT.new/bundles" -mindepth 1 -maxdepth 1 ! -name "$KEEP" -exec rm -rf {} +
find "$OUT.new" -name "*.map" -delete

# ค่าตั้ง = ตัวเดียวกับ Element Web เดิม (ConfigMap ที่ 04-install.sh สร้าง) + แถบเมนู AranChat (config คีย์ "aranchat")
kubectl -n "$NAMESPACE" get configmap ess-element-web -o jsonpath='{.data.config\.json}' | python3 -c '
import json, sys
c = json.load(sys.stdin)
apps = json.load(open(sys.argv[1]))
c["aranchat"] = {"logo": "/branding/icon-120.png", "bot_user": "@aranchat:" + sys.argv[2],
                 "news_room": apps.get("news_room"), "quiet_encryption": True, "apps": apps["apps"]}
# ลิงก์ชวนเพื่อน / แชร์กลุ่ม (notify/invites.mjs) — URL เต็ม ให้แอป Desktop เรียกได้ด้วย
c["aranchat"]["invite_api"] = "https://chat." + sys.argv[2] + "/api/notify"   # CHAT_HOST = chat.<SERVER_NAME> (config.env)
# กลุ่มที่แชร์ลิงก์: คน "ขอเข้าร่วม" (knock) แล้วผู้ดูแลอนุมัติ
c.setdefault("features", {})["feature_ask_to_join"] = True
# แจ้งเตือนเด้งบน iPhone/เว็บ (scripts/20-web-push.sh สร้างไฟล์นี้)
try: c["aranchat"]["web_push"] = json.load(open(sys.argv[1].replace("apps.json", "web-push.json")))
except FileNotFoundError: pass
# หน้าแชทแบบ LINE (_AranChatLine.pcss): แสดงเวลาข้างทุกข้อความ แบบ 24 ชม.
# รายการแชทแบบ LINE: "รายการโปรด" (ปักหมุด) บนสุด แล้วแชททั้งหมด (ส่วนตัว+กลุ่มรวมกัน) เรียงจากข้อความล่าสุด
c.setdefault("setting_defaults", {}).update({"alwaysShowTimestamps": True, "showTwelveHourTimestamps": False, "RoomList.showSections": True, "RoomList.showPeopleSection": False, "autoplayGifs": True})  # autoplayGifs: สติกเกอร์เคลื่อนไหวเล่นเองแบบ LINE
print(json.dumps(c, ensure_ascii=False, indent=1))' "${RENDER_DIR}/brand/apps.json" "$SERVER_NAME" > "$OUT.new/config.json"

# ภาษาไทย (scripts/11-thai.sh)
TH=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["th"])' "${RENDER_DIR}/i18n/web/languages.json")
cp "${RENDER_DIR}/i18n/web/th.json" "$OUT.new/i18n/$TH"
cp "${RENDER_DIR}/i18n/web/languages.json" "$OUT.new/i18n/languages.json"
# ชี้ภาษาอังกฤษ (ข้อความที่ยังไม่แปล) ไปไฟล์ที่มีจริงใน build นี้ — ชื่อไฟล์เปลี่ยนทุกครั้งที่ Element แก้ข้อความ
# ไม่ตรง = หน้าเว็บแสดงรหัสดิบ เช่น "event_preview|m.text"
EN=$(cd "$OUT.new/i18n" && ls en_EN.*.json | head -1)
python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["en"]=sys.argv[2]; json.dump(d, open(p,"w"))' "$OUT.new/i18n/languages.json" "$EN"

# ชื่อแท็บ/ฟอนต์/สี + การ์ดดาวน์โหลดหน้า login + ภาษาไทยเริ่มต้น (แถบเมนู/หน้ามือถืออยู่ในโค้ดแล้ว)
V=$(cat "${ROOT_DIR}"/brand/* | sha256sum | cut -c1-10)
sed -i \
  -e "s|<title>Element</title>|<title>${BRAND}</title>|" \
  -e 's|<html lang="en"|<html lang="th" translate="no"|' \
  -e 's|<head>|<head><meta name="google" content="notranslate">|' \
  -e "s|name=\"apple-mobile-web-app-title\" content=\"Element\"|name=\"apple-mobile-web-app-title\" content=\"${BRAND}\"|" \
  -e "s|https://app.element.io/themes/element/img/logos/opengraph.png|https://${CHAT_HOST}/branding/icon-512.png|" \
  -e "s|</head>|<link rel=\"stylesheet\" href=\"/branding/aranchat.css?v=${V}\"><script src=\"/branding/aranchat.js?v=${V}\" defer></script><script src=\"/branding/aranchat-early.js?v=${V}\"></script></head>|" \
  "$OUT.new/index.html"
for i in 16 24 32 48 64 76 96 120 144 152 180 192 512 1024; do   # ไอคอน
  for f in "$OUT.new"/vector-icons/$i.*png "$OUT.new"/vector-icons/$i.png; do [[ -f "$f" && -f "${RENDER_DIR}/brand/icon-$i.png" ]] && cp "${RENDER_DIR}/brand/icon-$i.png" "$f"; done
done
rm -rf "$OUT.old"; [[ -d "$OUT" ]] && mv "$OUT" "$OUT.old"; mv "$OUT.new" "$OUT"; rm -rf "$OUT.old"
[[ "$TARGET" == beta ]] && ok "พร้อมที่ https://${CHAT_HOST}/beta/" || ok "อัปเดตตัวจริงแล้ว https://${CHAT_HOST}/"
