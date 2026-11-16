#!/usr/bin/env bash
# สลับเว็บแชทที่ https://__CHAT_HOST__/ ระหว่างตัวของเรากับ Element Web เดิม — มีผลทันที ไม่ต้อง restart
#   ./15-web-switch.sh on      ใช้ตัวของเรา (ไม่มีไฟล์ก็ build ชุดจาก /beta/ ล่าสุดให้)
#   ./15-web-switch.sh off     กลับไปใช้ Element Web เดิม (ย้อนกลับฉุกเฉิน)
#   ./15-web-switch.sh status
# nginx aranchat-branding เช็กโฟลเดอร์ ~/aranchat-apps/web-dist/live ทุกคำขอ: มี → ตัวเรา · ไม่มี → ส่งต่อตัวเดิม
# อัปเดตตัวจริงหลัง build ใหม่: ./14-web-beta.sh live
source "$(dirname "$0")/lib.sh"
D=/home/payang/aranchat-apps/web-dist
case "${1:-status}" in
  on)
    if [[ -d "$D/live.off" ]]; then rm -rf "$D/live"; mv "$D/live.off" "$D/live"
    else "$(dirname "$0")/14-web-beta.sh" live; fi
    ok "https://${CHAT_HOST}/ ใช้เว็บแชทของเราแล้ว" ;;
  off)
    [[ -d "$D/live" ]] && { rm -rf "$D/live.off"; mv "$D/live" "$D/live.off"; }
    ok "https://${CHAT_HOST}/ กลับไปใช้ Element Web เดิมแล้ว (เปิดคืน: $0 on)" ;;
  status)
    [[ -f "$D/live/index.html" ]] && echo "ตัวของเรา (live)" || echo "Element Web เดิม" ;;
  *) die "ใช้: $0 on|off|status" ;;
esac
