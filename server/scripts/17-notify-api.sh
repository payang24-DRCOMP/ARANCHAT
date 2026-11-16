#!/usr/bin/env bash
# เปิดทางเข้าให้ระบบอื่น (เครื่องอื่นใน รพ. / ภายนอก) ส่งแจ้งเตือนเข้า AranChat: https://__CHAT_HOST__/api/notify
# notify (pm2 aranchat-notify) ต้องทำงานอยู่ และฟังที่ PUBLIC_BIND (ค่าเริ่มต้น 10.42.0.1:3211)
# ปิดทางเข้า: kubectl -n ess delete ingress aranchat-notify-api
source "$(dirname "$0")/lib.sh"
render "${ROOT_DIR}/k8s/notify-api.yaml.tpl" "${RENDER_DIR}/notify-api-k8s.yaml"
kubectl apply -f "${RENDER_DIR}/notify-api-k8s.yaml"
sleep 2
out=$(curl -s "https://${CHAT_HOST}/api/notify/health")
[[ "$out" == *'"ok":true'* ]] && ok "พร้อม: https://${CHAT_HOST}/api/notify (คู่มือ https://${CHAT_HOST}/connect/)" \
  || warn "ยังเรียกไม่ได้ ($out) — ตรวจ: pm2 logs aranchat-notify · firewall พอร์ต 3211 จากเครือข่าย pod (10.42.0.0/16)"
