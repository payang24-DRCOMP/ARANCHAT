#!/usr/bin/env bash
# สำรองไฟล์ลับของ AranChat เป็นไฟล์เดียวที่เข้ารหัส (AES-256 ด้วยรหัสผ่านที่ตั้งตอนรัน) → นำไปเก็บนอกเครื่องนี้
#
# ใช้: ./26-backup-secrets.sh            → ~/aranchat-backup-<วันเวลา>.tar.gz.gpg (ถามรหัสผ่าน 2 ครั้ง)
#      ./26-backup-secrets.sh /mnt/usb   → เขียนลงโฟลเดอร์ที่ระบุ
# กู้คืน: gpg -d aranchat-backup-….tar.gz.gpg | tar -xz -C /   (ไฟล์กลับไปที่เดิม — ระวังทับของใหม่)
#
# ไฟล์ที่สำรอง (ไม่มีชุดนี้ = กู้ระบบไม่ได้):
#   keyvault/.env + keyvault/data      กุญแจกู้คืนแชทของผู้ใช้ทุกคน (เสีย = ผู้ใช้เปลี่ยนเครื่องแล้วอ่านแชทเก่าไม่ได้)
#   secrets.env, */.env, config.env    token บอท, key ระบบ, รหัสฐานข้อมูล
#   secrets/vapid_private_key.pem      Web Push (เปลี่ยน = ทุกเบราว์เซอร์ต้องสมัครแจ้งเตือนใหม่)
#   aranchat-apps/secrets/             กุญแจเซ็นแอป Android (เสีย = ออกรุ่นใหม่ทับแอปเดิมในเครื่องผู้ใช้ไม่ได้) + Firebase
#   notify/data/state.json             ห้องแชทกับบอท ค่าที่ผู้ใช้เลือก ประวัติเรื่องด่วน
# เก็บไฟล์ผลลัพธ์ + รหัสผ่านแยกกัน (เช่น ไฟล์ใน USB/NAS ของ รพ., รหัสผ่านในตู้เอกสาร/ผู้บริหาร)
set -euo pipefail
ESS=${ARAN_ESS:-$(cd "$(dirname "$0")/.." && pwd)}
APPS=/home/payang/aranchat-apps
OUT_DIR=${1:-$HOME}
OUT="$OUT_DIR/aranchat-backup-$(date +%Y%m%d-%H%M).tar.gz.gpg"
command -v gpg >/dev/null || { echo "ต้องมี gpg"; exit 1; }

FILES=()
add() { for f in "$@"; do if [[ -e "$f" ]]; then FILES+=("${f#/}"); fi; done; }
add "$ESS/secrets.env" "$ESS/config.env" "$ESS/secrets"
add "$ESS"/*/.env "$ESS/keyvault/data" "$ESS/notify/data/state.json"
add "$APPS/secrets"
[[ ${#FILES[@]} -gt 0 ]] || { echo "ไม่พบไฟล์ลับ"; exit 1; }

echo "จะสำรอง ${#FILES[@]} รายการ:"; printf '  /%s\n' "${FILES[@]}"
echo "ตั้งรหัสผ่านสำหรับไฟล์สำรอง (ยาวๆ จำได้ เก็บแยกจากไฟล์):"
umask 077
tar -czf - -C / "${FILES[@]}" | gpg --symmetric --cipher-algo AES256 --pinentry-mode loopback -o "$OUT"
# ตรวจว่าเปิดได้จริง (ถามรหัสผ่านอีกครั้ง) — กันกรณีพิมพ์รหัสผิดแล้วไม่รู้ตัว
echo "ตรวจไฟล์สำรอง (ใส่รหัสผ่านเดิมอีกครั้ง):"
gpg -d --pinentry-mode loopback "$OUT" | tar -tzf - >/dev/null && echo "✓ สำรองแล้ว: $OUT ($(du -h "$OUT" | cut -f1))"
echo "! ย้ายไฟล์นี้ไปเก็บนอกเครื่อง แล้วลบสำเนาในเครื่องนี้ถ้าไม่ต้องการ"
