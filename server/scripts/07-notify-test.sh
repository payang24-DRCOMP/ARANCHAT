#!/usr/bin/env bash
# ทดสอบส่งแจ้งเตือนเข้าห้องแชทผ่าน Hookshot (generic webhook)
#
# วิธีได้ WEBHOOK_URL:
#   1) สร้างห้อง เช่น "IT-Alert" แล้วเชิญ @hookshot:<SERVER_NAME> เข้าห้อง
#   2) ตั้งระดับสิทธิ์ของ hookshot เป็น Moderator
#   3) พิมพ์ในห้อง:  !hookshot webhook server-alert
#   4) bot จะส่ง URL มาทางแชทส่วนตัว → นำมาใช้กับสคริปต์นี้
source "$(dirname "$0")/lib.sh"
URL="${1:?ใช้: $0 <WEBHOOK_URL>}"

curl -fsS -X POST -H 'Content-Type: application/json' \
  -d "{\"text\":\"✅ ทดสอบแจ้งเตือนจาก $(hostname) เวลา $(date '+%H:%M:%S')\"}" \
  "$URL" && ok "ส่งแล้ว ดูในห้องแชทได้เลย"
