#!/usr/bin/env bash
# สร้างผู้ใช้จำนวนมากจาก CSV: username,display_name,password
# ใช้ช่วงนำร่องก่อนเปิด login ด้วยบัญชี AranKub (หลังเชื่อมแล้วผู้ใช้ login ผ่าน SSO ได้เลย)
# ตัวอย่างไฟล์: users.example.csv
source "$(dirname "$0")/lib.sh"
CSV="${1:?ใช้: $0 users.csv}"
MAS="deploy/ess-matrix-authentication-service"

n=0
while IFS=, read -r user name pass; do
  [[ -z "$user" || "$user" == username ]] && continue
  if kubectl exec -n "$NAMESPACE" "$MAS" -- mas-cli manage register-user \
       --yes --password "$pass" --display-name "$name" "$user" >/dev/null 2>&1; then
    ok "$user ($name)"; n=$((n+1))
  else
    warn "$user สร้างไม่สำเร็จ (อาจมีอยู่แล้ว หรือ flag ต่างจากเวอร์ชันนี้ — ดู: mas-cli manage register-user --help)"
  fi
done < "$CSV"
ok "สร้างแล้ว $n บัญชี — ให้ผู้ใช้เปลี่ยนรหัสผ่านหลัง login ครั้งแรก"
