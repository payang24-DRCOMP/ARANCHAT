#!/usr/bin/env bash
# ติดตั้ง push gateway (Sygnal) — แจ้งเตือนเด้งบนแอป AranChat Android แม้ปิดแอป
# ใช้: ./16-push.sh /path/to/service-account.json
#   ไฟล์ = Firebase Console → Project settings → Service accounts → Generate new private key
#   เป็นความลับ: สคริปต์เก็บเข้า K3s Secret แล้ว ลบไฟล์ต้นฉบับทิ้งได้ (เก็บสำรองไว้ที่ปลอดภัย)
source "$(dirname "$0")/lib.sh"
#   ไม่ใส่ไฟล์ = ใช้กุญแจเดิมใน K3s (เช่น 20-web-push.sh เรียกเพื่ออัปเดตการตั้งค่า)
SA=${1:-}
PUSHER_APP_ID=${PUSHER_APP_ID:-com.arankub.aranchat.android}   # ตรงกับ element-x-android/aranchat/brand.env
PUSHER_APP_ID_WEB=${PUSHER_APP_ID_WEB:-com.arankub.aranchat.web} # ตรงกับ aranchat.web_push.app_id (14-web-beta.sh)
VAPID_CONTACT=${VAPID_CONTACT:-admin@${SERVER_NAME}}            # ผู้ติดต่อที่ Apple/Google เห็นใน push (บังคับตามมาตรฐาน VAPID)

if [[ -n "$SA" ]]; then
  [[ -f "$SA" ]] || die "ใช้: $0 [service-account.json]"
  PROJECT=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["type"]=="service_account"; print(d["project_id"])' "$SA") \
    || die "ไม่ใช่ไฟล์ service account ของ Firebase"
  info "เก็บกุญแจ Firebase (โปรเจกต์ ${PROJECT}) เข้า K3s"
  kubectl -n "$NAMESPACE" create secret generic aranchat-sygnal-fcm --from-file=service-account.json="$SA" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
else
  PROJECT=$(kubectl -n "$NAMESPACE" get secret aranchat-sygnal-fcm -o jsonpath='{.data.service-account\.json}' 2>/dev/null \
    | base64 -d | python3 -c 'import json,sys; print(json.load(sys.stdin)["project_id"])') || die "ยังไม่มีกุญแจ Firebase — ใช้: $0 <service-account.json>"
fi
kubectl -n "$NAMESPACE" get secret aranchat-sygnal-webpush >/dev/null 2>&1 \
  || die "ยังไม่มีกุญแจ Web Push — รัน scripts/20-web-push.sh (สร้างกุญแจแล้วเรียกสคริปต์นี้ให้เอง)"
kubectl -n "$NAMESPACE" create configmap aranchat-sygnal-plugins --from-file="${ROOT_DIR}/sygnal/aranwebpush.py" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null

info "ติดตั้ง Sygnal"
HASH=$( (cat "${ROOT_DIR}/k8s/sygnal.yaml.tpl" "${ROOT_DIR}/sygnal/aranwebpush.py"
          for s in aranchat-sygnal-fcm aranchat-sygnal-webpush; do kubectl -n "$NAMESPACE" get secret $s -o jsonpath='{.metadata.resourceVersion}'; done) | sha256sum | cut -c1-12)
render "${ROOT_DIR}/k8s/sygnal.yaml.tpl" "${RENDER_DIR}/sygnal-k8s.yaml"
sed -i -e "s|__HASH__|${HASH}|g" -e "s|__FCM_PROJECT__|${PROJECT}|g" -e "s|__PUSHER_APP_ID_WEB__|${PUSHER_APP_ID_WEB}|g" \
  -e "s|__PUSHER_APP_ID__|${PUSHER_APP_ID}|g" -e "s|__VAPID_CONTACT__|${VAPID_CONTACT}|g" "${RENDER_DIR}/sygnal-k8s.yaml"
kubectl apply -f "${RENDER_DIR}/sygnal-k8s.yaml"
kubectl -n "$NAMESPACE" rollout status deploy/aranchat-sygnal --timeout=180s

info "ทดสอบจากภายนอก"
# ส่ง push ปลอม (token ไม่มีจริง) — Sygnal ตอบ rejected = ต่อ Firebase ได้ กุญแจถูกต้อง
out=$(curl -s -X POST "https://${MATRIX_HOST}/_matrix/push/v1/notify" -H 'Content-Type: application/json' \
  -d "{\"notification\":{\"event_id\":\"\$test\",\"room_id\":\"!test:${SERVER_NAME}\",\"counts\":{\"unread\":1},\"devices\":[{\"app_id\":\"${PUSHER_APP_ID}\",\"pushkey\":\"aranchat-test-invalid-token\"}]}}")
# token ปลอม → Firebase ตอบ "not a valid FCM registration token" (= ล็อกอิน Google ผ่าน) · กุญแจผิดจะเป็น 401/403
sleep 2; log=$(kubectl -n "$NAMESPACE" logs deploy/aranchat-sygnal --since=30s 2>&1)
if [[ "$out" == *rejected* || "$log" == *"not a valid FCM registration token"* ]]; then ok "push gateway พร้อม — ต่อ Firebase ได้"
else echo "  ตอบกลับ: $out"; warn "ยังไม่ผ่าน ดู log: kubectl -n ${NAMESPACE} logs deploy/aranchat-sygnal"; fi
