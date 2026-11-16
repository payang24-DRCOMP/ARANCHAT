#!/usr/bin/env bash
# เตรียม login ด้วยบัญชี AranKub (OIDC) — รันครั้งเดียว
#   1) สุ่ม client secret เก็บใน secrets.env (ฝั่งแชท)
#   2) พิมพ์ค่าที่ต้องเพิ่มใน .env.local ของ AranKub (กุญแจเซ็น + client)
# จากนั้น: deploy AranKub ใหม่ → ./scripts/03-render.sh && ./scripts/04-install.sh
source "$(dirname "$0")/lib.sh"
need openssl
SECRETS="${ROOT_DIR}/secrets.env"
REDIRECT="https://${AUTH_HOST}/upstream/callback/01M6JFPAM16HCK56GW67B4K9MA"

if [[ -z "${OIDC_CLIENT_SECRET:-}" ]]; then
  OIDC_CLIENT_SECRET=$(openssl rand -hex 32)
  umask 077
  echo "OIDC_CLIENT_SECRET=\"${OIDC_CLIENT_SECRET}\"" >> "$SECRETS"
  ok "สร้าง client secret ใน ${SECRETS}"
else
  info "มี client secret ใน ${SECRETS} อยู่แล้ว — ใช้ค่าเดิม"
fi

KEY=$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null | awk '{printf "%s\\n", $0}')

info "เพิ่ม 3 บรรทัดนี้ใน .env.local ของ AranKub (ถ้ามี OIDC_PRIVATE_KEY อยู่แล้ว ให้คงค่าเดิม ไม่งั้น token เก่าใช้ไม่ได้):"
cat <<EOF

OIDC_ISSUER=https://${SERVER_NAME}
OIDC_PRIVATE_KEY="${KEY}"
OIDC_CLIENTS='[{"id":"aranchat","secret":"${OIDC_CLIENT_SECRET}","redirectUris":["${REDIRECT}"]}]'

EOF
warn "ค่าเหล่านี้เป็นความลับ — อย่าวางในแชท/อีเมล และห้าม commit เข้า git"
