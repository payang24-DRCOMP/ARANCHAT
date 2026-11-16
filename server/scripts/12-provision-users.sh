#!/usr/bin/env bash
# สร้างบัญชีแชทล่วงหน้าให้ผู้ใช้ AranKub — ค้นหาเจอ/เชิญเข้าห้องได้ก่อนเขา login ครั้งแรก
# ผูกกับบัญชี AranKub ไว้แล้ว: login ผ่าน AranKub ครั้งแรกเข้าบัญชีนี้ทันที (ไม่ต้องตั้งชื่อผู้ใช้)
#
# ไฟล์ TSV: localpart<TAB>ชื่อจริง<TAB>id ผู้ใช้ AranKub (หลาย id คั่นด้วย , = คนเดียวมีหลายบัญชี AranKub)
# localpart ตั้งแล้วเปลี่ยนไม่ได้ · บัญชีที่มีอยู่แล้วจะถูกข้าม · ไม่มีรหัสผ่าน (login ผ่าน AranKub เท่านั้น)
source "$(dirname "$0")/lib.sh"
TSV="${1:?ใช้: $0 users.tsv}"
MAS="deploy/ess-matrix-authentication-service"
PROVIDER="01M6JFPAM16HCK56GW67B4K9MA"   # ตรงกับ values/arankub-sso.yaml.tpl

n=0
while IFS=$'\t' read -r user name ids; do
  [[ -z "$user" || "$user" == \#* ]] && continue
  maps=()
  IFS=, read -ra idlist <<<"$ids"
  for id in "${idlist[@]}"; do maps+=(-m "${PROVIDER}:${id}"); done
  if kubectl exec -n "$NAMESPACE" "$MAS" -c matrix-authentication-service -- mas-cli manage register-user \
       --yes --no-admin --display-name "$name" "${maps[@]}" "$user" >/dev/null 2>&1; then
    ok "@${user} (${name})"; n=$((n+1))
  else
    warn "@${user} สร้างไม่สำเร็จ (มีอยู่แล้ว หรือบัญชี AranKub นี้ผูกกับคนอื่นแล้ว)"
  fi
done < "$TSV"
ok "สร้างแล้ว $n บัญชี"
