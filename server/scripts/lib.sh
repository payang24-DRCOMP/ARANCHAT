#!/usr/bin/env bash
# ฟังก์ชันใช้ร่วมกันของทุกสคริปต์
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT_DIR}/config.env"
# ค่าลับ (ไม่อยู่ใน config.env เพื่อส่งต่อ/zip ชุดติดตั้งได้โดยไม่หลุด) — chmod 600
# shellcheck source=/dev/null
[[ -f "${ROOT_DIR}/secrets.env" ]] && source "${ROOT_DIR}/secrets.env"

VALUES_DIR="${ROOT_DIR}/values"
RENDER_DIR="${ROOT_DIR}/rendered"
NAMESPACE="ess"
RELEASE="ess"
CHART="oci://ghcr.io/element-hq/ess-helm/matrix-stack"

export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"

info() { printf '\033[1;34m[i]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[✓]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "ไม่พบคำสั่ง $1"; }

# แทนค่า __VAR__ ในไฟล์แม่แบบด้วยค่าจาก config.env
# __BRAND_VER__ = hash ของโฟลเดอร์ brand/ — ต่อท้าย URL รูป (?v=) ให้ Cloudflare/เบราว์เซอร์โหลดรูปใหม่ทันทีที่เปลี่ยนแบรนด์
render() {
  local src="$1" dst="$2"
  local brand_ver; brand_ver=$(cat "${ROOT_DIR}"/brand/* 2>/dev/null | sha256sum | cut -c1-10)
  sed \
    -e "s|__BRAND_VER__|${brand_ver}|g" \
    -e "s|__SERVER_NAME__|${SERVER_NAME}|g" \
    -e "s|__CHAT_HOST__|${CHAT_HOST}|g" \
    -e "s|__MATRIX_HOST__|${MATRIX_HOST}|g" \
    -e "s|__AUTH_HOST__|${AUTH_HOST}|g" \
    -e "s|__RTC_HOST__|${RTC_HOST}|g" \
    -e "s|__ADMIN_HOST__|${ADMIN_HOST}|g" \
    -e "s|__BRAND__|${BRAND}|g" \
    -e "s|__MAX_UPLOAD__|${MAX_UPLOAD}|g" \
    -e "s|__PUBLIC_IP__|${PUBLIC_IP}|g" \
    -e "s|__OIDC_CLIENT_SECRET__|${OIDC_CLIENT_SECRET:-}|g" \
    -e "s|__PASSWORDS_ENABLED__|$([[ "${SSO_ONLY:-false}" == true ]] && echo false || echo true)|g" \
    "$src" > "$dst"
}
