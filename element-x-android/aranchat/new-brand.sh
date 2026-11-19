#!/usr/bin/env bash
# สร้างแบรนด์ใหม่ของหน่วยงาน (คัดลอกจาก arankub แล้วแก้ค่าตามที่ใส่)
# ใช้: ./aranchat/new-brand.sh <ชื่อ> <โดเมนหน่วยงาน> "<ชื่อแอป>" [#สีหลัก]
#   เช่น ./aranchat/new-brand.sh hospx hospx.go.th "แชท รพ.X" "#0E7C66"
# ได้โฟลเดอร์ aranchat/brands/<ชื่อ>/ — เปลี่ยน icon.png (สี่เหลี่ยม ≥1024px) แล้ว build: ./aranchat/build-brand.sh <ชื่อ>
set -euo pipefail
cd "$(dirname "$0")"
NAME=${1:?ชื่อแบรนด์ (a-z0-9-)}; DOMAIN=${2:?โดเมนหน่วยงาน เช่น hospx.go.th}; APP=${3:?ชื่อแอป}; COLOR=${4:-#5B3FD9}
[[ $NAME =~ ^[a-z0-9-]+$ ]] || { echo "ชื่อแบรนด์ใช้ได้เฉพาะ a-z 0-9 -" >&2; exit 1; }
[[ $COLOR =~ ^#[0-9A-Fa-f]{6}$ ]] || { echo "สีต้องเป็น #RRGGBB" >&2; exit 1; }
D=brands/$NAME
[[ -e $D ]] && { echo "มี $D อยู่แล้ว" >&2; exit 1; }
# รหัสแอป = โดเมนกลับด้าน + .aranchat (ระบบ login บังคับให้ตรงกับโดเมนของ WEBSITE_URL)
REV=$(awk -F. '{for(i=NF;i>0;i--) printf "%s%s", $i, (i>1?".":"")}' <<<"$DOMAIN" | tr '-' '_')
mkdir -p "$D"
cp brands/arankub/icon.png "$D/icon.png"
sed -E \
  -e "s|^APP_ID=.*|APP_ID=${REV}.aranchat|" \
  -e "s|^APP_NAME=.*|APP_NAME=${APP}|" \
  -e "s|^SERVER_NAME=.*|SERVER_NAME=${DOMAIN}|" \
  -e "s|^HOMESERVER_URL=.*|HOMESERVER_URL=https://matrix.${DOMAIN}|" \
  -e "s|^CHAT_HOST=.*|CHAT_HOST=chat.${DOMAIN}|" \
  -e "s|^WEBSITE_URL=.*|WEBSITE_URL=https://${DOMAIN}|" \
  -e "s|^LOGO_URL=.*|LOGO_URL=https://chat.${DOMAIN}/branding/icon-512.png|" \
  -e "s|^TERMS_URL=.*|TERMS_URL=https://${DOMAIN}/terms|" \
  -e "s|^PRIVACY_URL=.*|PRIVACY_URL=https://${DOMAIN}/privacy|" \
  -e "s|^BRAND_COLOR=.*|BRAND_COLOR=${COLOR}|" \
  -e "s|^LAUNCHER_BG=.*|LAUNCHER_BG=${COLOR}|" \
  -e "s|^PUSHER_APP_ID=.*|PUSHER_APP_ID=${REV}.aranchat.android|" \
  -e "s|^KEYVAULT_URL=.*|KEYVAULT_URL=https://chat.${DOMAIN}/api/keyvault|" \
  -e "s|^MAP_URL=.*|MAP_URL=https://chat.${DOMAIN}/maps|" \
  brands/arankub/brand.env > "$D/brand.env"
echo "สร้าง $D แล้ว:"
grep -E '^(APP_ID|APP_NAME|SERVER_NAME|HOMESERVER_URL|CHAT_HOST|BRAND_COLOR|PUSH_GATEWAY_URL|PUSHER_APP_ID)=' "$D/brand.env" | sed 's/^/  /'
cat <<MSG
ต่อไป:
  1. ใส่ไอคอนของหน่วยงาน: $D/icon.png (สี่เหลี่ยม ≥1024px)
  2. ตรวจ $D/brand.env (ที่อยู่ server, PUSH_GATEWAY_URL)
  3. แจ้งเตือนเด้งตอนปิดแอป: เพิ่มแอป Android "${REV}.aranchat" ใน Firebase ของเรา → ดาวน์โหลด google-services.json ใหม่
     ไปไว้ที่ ~/aranchat-apps/secrets/google-services.json (ไฟล์เดียวมีทุกแอป) + เพิ่ม app id "${REV}.aranchat.android" ใน Sygnal
  4. build: ./aranchat/build-brand.sh $NAME
MSG
