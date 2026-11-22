#!/usr/bin/env bash
# เชื่อมแจ้งเตือนจาก Plan-D (ลา · ไปราชการ · แจ้งซ่อม · ห้องประชุม · ใช้รถ · ประชุม) เข้า AranChat — ตัวเชื่อม: pland-bridge/bridge.mjs
#
#   scripts/29-pland.sh rooms    สร้างห้องแจ้งเตือน 7 ห้อง (bot เป็นเจ้าของ · ข้ามห้องที่มีแล้ว) — เชิญเจ้าหน้าที่ภายหลังในหน้าจัดการ/ในแชท
#   scripts/29-pland.sh route    เปิดทางเข้า https://<CHAT_HOST>/api/pland/webhook (K3s ingress → 10.42.0.1:3213)
#   scripts/29-pland.sh start    pm2 start/restart pland-bridge
#   scripts/29-pland.sh sample   ส่งการ์ดตัวอย่างเข้าทุกห้อง (เช็กหน้าตา + ห้องพร้อม) · sample --to @me:server = การ์ดรายบุคคล
#   scripts/29-pland.sh invite @a:server,@b:server | all [--force]
#                                ส่งการ์ดชวนเชื่อมบัญชี Plan-D (ข้ามคนที่เชื่อมแล้ว/เพิ่งชวนใน 7 วัน) — pland-bridge ต้องทำงานอยู่
#   scripts/29-pland.sh all      rooms + route + start
source "$(dirname "$0")/lib.sh"
BRIDGE="${ROOT_DIR}/pland-bridge"
NOTIFY_ENV="${ROOT_DIR}/notify/.env"

rooms() {
  local key; key=$(grep -E '^NOTIFY_ADMIN_KEY=' "$NOTIFY_ENV" | cut -d= -f2- | tr -d '"'"'")
  local port; port=$(grep -E '^PORT=' "$NOTIFY_ENV" | cut -d= -f2- || true); port=${port:-3210}
  [[ -n "$key" ]] || die "ไม่พบ NOTIFY_ADMIN_KEY ใน $NOTIFY_ENV"
  while IFS='|' read -r id icon name topic; do
    out=$(curl -s -X POST "http://127.0.0.1:${port}/admin/channels" -H "Authorization: Bearer ${key}" -H 'Content-Type: application/json' \
      --data "$(python3 -c 'import json,sys; print(json.dumps(dict(zip(["id","icon","name","topic"], sys.argv[1:])), ensure_ascii=False))' "$id" "$icon" "$name" "$topic")")
    case "$out" in
      *'"channel"'*) ok "สร้างห้อง ${icon} ${name} (room:${id})" ;;
      *'มีห้องนี้แล้ว'*) info "มีห้อง room:${id} แล้ว" ;;
      *) warn "สร้าง room:${id} ไม่ได้: $out" ;;
    esac
  done <<'EOF'
pland-leave|🏖️|Plan-D แจ้งลา|ใบลาจาก Plan-D: ยื่น · อนุมัติ · ไม่อนุมัติ · ยกเลิก
pland-travel|🚐|Plan-D ไปราชการ|คำขอไปราชการจาก Plan-D
pland-repair|🔧|Plan-D แจ้งซ่อม|คำขอซ่อมบำรุงครุภัณฑ์จาก Plan-D
pland-meeting-room|🏢|Plan-D จองห้องประชุม|การจองห้องประชุม/สถานที่/อุปกรณ์จาก Plan-D
pland-vehicle|🚗|Plan-D ขอใช้รถ|การจองรถจาก Plan-D
pland-meeting|👥|Plan-D การประชุม|นัดประชุมใหม่/แก้ไขการประชุมจาก Plan-D
pland-saraban|📨|Plan-D หนังสือเข้า|รอ Plan-D เปิด API สารบรรณ — ยังไม่มีแจ้งเตือนเข้าห้องนี้
EOF
  info "เชิญเจ้าหน้าที่เข้าห้อง: หน้าจัดการแจ้งเตือนใน AranKub → ห้องแจ้งเตือน หรือเชิญในแชทได้เลย"
}

route() {
  render "${ROOT_DIR}/k8s/pland-webhook.yaml.tpl" "${RENDER_DIR}/pland-webhook-k8s.yaml"
  kubectl apply -f "${RENDER_DIR}/pland-webhook-k8s.yaml"
  sleep 2
  out=$(curl -s "https://${CHAT_HOST}/api/pland/health")
  [[ "$out" == *'"ok":true'* ]] && ok "พร้อม: https://${CHAT_HOST}/api/pland/webhook — ให้ผู้ดูแล Plan-D เพิ่มเป็นปลายทางแจ้งเหตุการณ์" \
    || warn "ยังเรียกไม่ได้ ($out) — pland-bridge ทำงานอยู่ไหม (pm2 logs pland-bridge) · firewall พอร์ต 3213 จาก 10.42.0.0/16"
}

start() {
  [[ -f "${BRIDGE}/.env" ]] || die "ยังไม่มี ${BRIDGE}/.env — คัดลอกจาก .env.example แล้วใส่ค่า (chmod 600)"
  chmod 600 "${BRIDGE}/.env"
  if pm2 describe pland-bridge >/dev/null 2>&1; then pm2 restart pland-bridge; else (cd "$BRIDGE" && pm2 start bridge.mjs --name pland-bridge); fi
  pm2 save >/dev/null
  ok "pland-bridge ทำงาน — ดู log: pm2 logs pland-bridge"
}

sample() { (cd "$BRIDGE" && node bridge.mjs --sample --send "$@"); }   # --to @user:server = การ์ดรายบุคคลถึงคนนั้น

case "${1:-}" in
  rooms) rooms ;; route) route ;; start) start ;; sample) shift; sample "$@" ;;
  invite) shift; (cd "$BRIDGE" && node bridge.mjs --invite "$@") ;;
  all) rooms; start; route ;;
  *) sed -n 2,11p "$0"; exit 1 ;;
esac
