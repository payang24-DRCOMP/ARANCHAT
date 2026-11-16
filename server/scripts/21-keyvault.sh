#!/usr/bin/env bash
# ฝากกุญแจกู้คืนแชทเข้ารหัสไว้ที่ server รพ. (keyvault/server.mjs) — เปลี่ยนเครื่อง/ล้างแอปแล้วอ่านแชทเก่าได้เอง
# ใช้: ./21-keyvault.sh   (รันซ้ำได้ — ใช้ KEYVAULT_SECRET เดิม)
#   1. สร้าง keyvault/.env (KEYVAULT_SECRET ครั้งแรก) — ⚠️ สำรองค่านี้แยกไว้ที่ปลอดภัย (หาย = กู้กุญแจของทุกคนไม่ได้)
#   2. pm2 start aranchat-keyvault
#   3. เปิดทางเข้า https://<chat>/api/keyvault (K3s ingress)
#   แอปรู้ที่อยู่ keyvault จาก /.well-known/matrix/client (values/rtc.yaml.tpl → 03-render.sh + 04-install.sh)
source "$(dirname "$0")/lib.sh"
KV="${ROOT_DIR}/keyvault"
if [[ ! -f "$KV/.env" ]]; then
  info "สร้างกุญแจหลักของ keyvault"
  ( umask 077; printf 'MATRIX_URL=https://%s\nSERVER_NAME=%s\nKEYVAULT_SECRET=%s\nBIND=10.42.0.1:3212\n' \
      "$MATRIX_HOST" "$SERVER_NAME" "$(openssl rand -hex 32)" > "$KV/.env" )
  warn "สำรอง KEYVAULT_SECRET ใน $KV/.env ไว้นอกเครื่อง (เก็บกับกุญแจเซ็นแอป) — อย่าเก็บรวมกับไฟล์สำรอง keyvault/data"
fi
# admin token (จาก notify/.env) — ใช้เฉพาะให้บัญชีที่มีกุญแจยืนยันตัวตนเก่า ตั้งชุดใหม่ได้ (allow-reset)
if ! grep -q '^MATRIX_ADMIN_TOKEN=' "$KV/.env"; then grep '^MATRIX_ADMIN_TOKEN=' "${ROOT_DIR}/notify/.env" >> "$KV/.env" || warn "ไม่พบ MATRIX_ADMIN_TOKEN ใน notify/.env"; fi
chmod 600 "$KV/.env"; mkdir -p "$KV/data"; chmod 700 "$KV/data"
(cd "$KV" && set -a && source .env && set +a && node server.mjs --selftest) || die "selftest ไม่ผ่าน"
if pm2 describe aranchat-keyvault >/dev/null 2>&1; then pm2 restart aranchat-keyvault --update-env >/dev/null
else (cd "$KV" && pm2 start server.mjs --name aranchat-keyvault --node-args="--env-file=.env" >/dev/null); fi
pm2 save >/dev/null
render "${ROOT_DIR}/k8s/keyvault.yaml.tpl" "${RENDER_DIR}/keyvault-k8s.yaml"
kubectl apply -f "${RENDER_DIR}/keyvault-k8s.yaml"
sleep 3
out=$(curl -s "https://${CHAT_HOST}/api/keyvault/health")
[[ "$out" == *'"ok":true'* ]] && ok "keyvault พร้อม: https://${CHAT_HOST}/api/keyvault" \
  || warn "ยังเรียกไม่ได้ ($out) — ตรวจ: pm2 logs aranchat-keyvault"
echo "  ขั้นต่อไป: ./03-render.sh && ./04-install.sh  (เปิดเข้ารหัสเป็นค่าเริ่มต้น + บอกแอปว่า keyvault อยู่ที่ไหน)"
echo "            python3 ./22-encrypt-rooms.py        (ดูรายการห้องเดิมที่จะเปิดเข้ารหัส แล้วใส่ --apply)"
