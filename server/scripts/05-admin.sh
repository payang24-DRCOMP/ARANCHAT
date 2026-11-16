#!/usr/bin/env bash
# สร้างบัญชีแอดมินคนแรก (โหมดถาม-ตอบ)
source "$(dirname "$0")/lib.sh"
MAS="deploy/ess-matrix-authentication-service"

info "สร้างผู้ใช้: ใส่ username แล้วเลือก 'Set a password'"
kubectl exec -n "$NAMESPACE" -it "$MAS" -- mas-cli manage register-user

read -rp "ใส่ username เดิมอีกครั้งเพื่อตั้งเป็นแอดมิน: " u
kubectl exec -n "$NAMESPACE" "$MAS" -- mas-cli manage promote-admin "$u" \
  || warn "ตั้งแอดมินไม่สำเร็จ ลองดูคำสั่งที่รองรับด้วย: kubectl exec -n ess $MAS -- mas-cli manage --help"
ok "เข้าใช้ที่ https://${CHAT_HOST} และหน้าแอดมิน https://${ADMIN_HOST}"
