#!/usr/bin/env bash
# แจ้งเตือนเด้งบน iPhone/iPad (ติดตั้งเว็บแชทลงหน้าจอโฮม) และเบราว์เซอร์คอมพิวเตอร์ — Web Push ผ่าน Sygnal
#   ข้อความใหม่ → Synapse → Sygnal (aranwebpush) → Apple/Google push → sw.js ของเว็บแชท
# ใช้: ./20-web-push.sh   (รันซ้ำได้ — ใช้กุญแจเดิม)
#   1. สร้างกุญแจ VAPID ครั้งแรก → ~/aranchat-apps/secrets/vapid_private_key.pem (ความลับ — สำรองไว้กับกุญแจเซ็นแอป)
#      ถ้ากุญแจหาย/เปลี่ยน: ทุกเครื่องต้องเปิดแอปใหม่อีกครั้งเพื่อสมัครใหม่ (webPush.ts ทำให้อัตโนมัติ)
#   2. เก็บเข้า K3s Secret aranchat-sygnal-webpush + ติดตั้ง Sygnal ใหม่ (16-push.sh)
#   3. เขียน public key ไว้ที่ rendered/brand/web-push.json → 14-web-beta.sh ใส่ใน config.json (aranchat.web_push)
source "$(dirname "$0")/lib.sh"
KEY=${VAPID_KEY:-/home/payang/aranchat-apps/secrets/vapid_private_key.pem}
APP_ID=${PUSHER_APP_ID_WEB:-com.arankub.aranchat.web}

if [[ ! -f "$KEY" ]]; then
  info "สร้างกุญแจ VAPID ใหม่"
  ( umask 077; openssl ecparam -name prime256v1 -genkey -noout -out "$KEY" )
fi
chmod 600 "$KEY"
PUB=$(openssl ec -in "$KEY" -pubout -outform DER 2>/dev/null | tail -c 65 | base64 -w0 | tr '+/' '-_' | tr -d '=')
[[ ${#PUB} -eq 87 ]] || die "อ่าน public key ไม่ได้ ($KEY)"

kubectl -n "$NAMESPACE" create secret generic aranchat-sygnal-webpush --from-file=vapid_private_key.pem="$KEY" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
mkdir -p "${RENDER_DIR}/brand"
printf '{"app_id": "%s", "vapid_public_key": "%s", "gateway": "https://%s/_matrix/push/v1/notify"}\n' \
  "$APP_ID" "$PUB" "$MATRIX_HOST" > "${RENDER_DIR}/brand/web-push.json"
ok "public key: $PUB"

PUSHER_APP_ID_WEB="$APP_ID" "$(dirname "$0")/16-push.sh"

info "ทดสอบ Web Push"
# subscription ปลอมไปที่ web.push.apple.com — Sygnal ต้องโหลด aranwebpush ได้และตอบกลับ (ไม่ใช่ 500)
out=$(curl -s -o /dev/null -w '%{http_code}' -X POST "https://${MATRIX_HOST}/_matrix/push/v1/notify" -H 'Content-Type: application/json' \
  -d "{\"notification\":{\"event_id\":\"\$test\",\"room_id\":\"!test:${SERVER_NAME}\",\"type\":\"m.room.message\",\"content\":{\"msgtype\":\"m.text\",\"body\":\"ทดสอบ\"},\"counts\":{\"unread\":1},\"devices\":[{\"app_id\":\"${APP_ID}\",\"pushkey\":\"BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM\",\"data\":{\"endpoint\":\"https://web.push.apple.com/aranchat-test\",\"auth\":\"tBHItJI5svbpez7KI4CCXg\",\"events_only\":true}}]}}")
sleep 2; log=$(kubectl -n "$NAMESPACE" logs deploy/aranchat-sygnal --since=60s 2>&1)
if grep -q "Failed to load and create pushkin" <<<"$log"; then echo "$log" | tail -20; die "Sygnal โหลด aranwebpush ไม่ได้"; fi
[[ "$out" == 200 ]] && ok "Sygnal รับคำขอ Web Push แล้ว (HTTP $out)" || warn "Sygnal ตอบ HTTP $out — ดู log: kubectl -n ${NAMESPACE} logs deploy/aranchat-sygnal"
echo "  ขั้นต่อไป: ./14-web-beta.sh  (ใส่ web_push ใน config.json ของเว็บแชท)"
