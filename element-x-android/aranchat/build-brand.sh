#!/usr/bin/env bash
# build แอปของหน่วยงานหนึ่ง (ตัวแจกจริง) → aranchat/out/<APP_NAME>-<ชื่อ>-<เวอร์ชัน>.apk
# ใช้: ./aranchat/build-brand.sh <ชื่อ>        (แบรนด์ใน aranchat/brands/<ชื่อ>/)
#   มี Firebase ของแอปนี้ (google-services.json ใน brands/<ชื่อ>/ หรือ ~/aranchat-apps/secrets/) → ตัว gplay: แจ้งเตือนเด้งแม้ปิดแอป
#   ไม่มี → ตัว fdroid: แจ้งเตือนผ่าน UnifiedPush/เปิดแอปค้างไว้ (บอกหน่วยงานด้วย)
# เสร็จแล้วใส่แบรนด์ arankub กลับ (โค้ดในเครื่องคงเป็นของ รพ.อรัญ) — ไม่ต้องการ: KEEP_BRAND=1
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=${1:?ชื่อแบรนด์ (ดู ls aranchat/brands)}
./aranchat/apply-brand.sh "$NAME"
source aranchat/brand.env
GS=aranchat/brands/$NAME/google-services.json
[[ -f $GS ]] || GS=/home/payang/aranchat-apps/secrets/google-services.json
FLAVOR=Fdroid
if [[ -f $GS ]] && python3 -I aranchat/apply-firebase.py "$GS"; then FLAVOR=Gplay
else echo "⚠ ไม่มี Firebase ของ ${APP_ID} — build ตัว fdroid (แจ้งเตือนไม่เด้งตอนปิดแอป)"; fi
restore() {
  [[ $NAME == arankub ]] && return
  # ลบ APK ของหน่วยงานนี้ออกจากโฟลเดอร์ build — กัน 18-publish-apps.sh เอาไปแจกเป็นแอปของ รพ.อรัญ
  rm -f app/build/outputs/apk/*/release/*.apk
  [[ ${KEEP_BRAND:-} == 1 ]] && return
  ./aranchat/apply-brand.sh arankub >/dev/null
  python3 -I aranchat/apply-firebase.py /home/payang/aranchat-apps/secrets/google-services.json >/dev/null || true
  echo "ใส่แบรนด์ arankub กลับแล้ว"
}
trap restore EXIT
./aranchat/build.sh ":app:assemble${FLAVOR}Release"
VER=$(sed -nE 's/.*versionYear = ([0-9]+).*/\1/p' plugins/src/main/kotlin/Versions.kt).$(sed -nE 's/.*versionMonth = ([0-9]+).*/\1/p' plugins/src/main/kotlin/Versions.kt).$(sed -nE 's/.*versionReleaseNumber = ([0-9]+).*/\1/p' plugins/src/main/kotlin/Versions.kt)
APK=$(ls app/build/outputs/apk/${FLAVOR,,}/release/*universal*.apk 2>/dev/null | head -1)   # universal = ติดตั้งได้ทุกเครื่อง
[[ -n $APK ]] || APK=$(ls -t app/build/outputs/apk/${FLAVOR,,}/release/*.apk | head -1)
mkdir -p aranchat/out
OUT="aranchat/out/${APP_NAME// /_}-${NAME}-${VER}.apk"
cp "$APK" "$OUT"
echo "✓ $OUT ($(du -h "$OUT" | cut -f1)) — ${APP_NAME} · ${APP_ID} · server ${SERVER_NAME}"
echo "  แจก: วางไฟล์นี้บนหน้าดาวน์โหลดของหน่วยงาน (https://${CHAT_HOST}/download/) — scripts/18-publish-apps.sh บน server ของหน่วยงาน"
