#!/usr/bin/env bash
# ตรวจว่าทุกบริการเข้าถึงได้จากอินเทอร์เน็ต (รันหลังตั้งค่า Cloudflare Tunnel)
source "$(dirname "$0")/lib.sh"

check() {
  local name="$1" url="$2" expect="$3"
  local body
  if body=$(curl -fsS --max-time 10 "$url" 2>/dev/null) && grep -q "$expect" <<<"$body"; then
    ok "$name"
  else
    warn "$name ไม่ผ่าน → $url"
  fi
}

check "Well-known (ให้แอปมือถือหา server เจอ)" "https://${SERVER_NAME}/.well-known/matrix/client" "m.homeserver"
check "Synapse"                              "https://${MATRIX_HOST}/_matrix/client/versions" "versions"
check "หน้า login (MAS)"                     "https://${AUTH_HOST}/.well-known/openid-configuration" "issuer"
check "เว็บแชท"                               "https://${CHAT_HOST}/config.json" "${BRAND}"
check "หน้าแอดมิน"                             "https://${ADMIN_HOST}/" "html"
code=$(curl -sS -o /dev/null --max-time 10 -w '%{http_code}' "https://${SERVER_NAME}/" || true)
[[ "$code" =~ ^(200|30[1278])$ ]] && ok "เว็บ AranKub เดิมยังใช้ได้ (HTTP $code)" || warn "เว็บ AranKub เดิมตอบ HTTP $code"

info "Video call: ตรวจจากภายนอกไม่ได้ด้วยสคริปต์ — ทดสอบโทรจริงผ่าน 4G"
kubectl -n "$NAMESPACE" get pods
