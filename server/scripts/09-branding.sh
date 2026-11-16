#!/usr/bin/env bash
# ติดตั้งแบรนด์ AranChat: โลโก้ + ภาพพื้นหลังหน้า login
# เปลี่ยนภาพเอง: แทนที่ไฟล์ในโฟลเดอร์ brand/ (ชื่อเดิม) แล้วรันสคริปต์นี้ซ้ำ
source "$(dirname "$0")/lib.sh"
BRAND_DIR="${ROOT_DIR}/brand"
mkdir -p "$RENDER_DIR"

# ไฟล์ *.tpl (เช่น home.html.tpl) แทนค่า __BRAND__ / __CHAT_HOST__ ก่อน — หน่วยงานอื่นแก้แค่ config.env
OUT_DIR="${RENDER_DIR}/brand"
rm -rf "$OUT_DIR"; mkdir -p "$OUT_DIR"
for f in "$BRAND_DIR"/*; do
  if [[ "$f" == *.tpl ]]; then render "$f" "${OUT_DIR}/$(basename "$f" .tpl)"; else cp "$f" "$OUT_DIR/"; fi
done

info "อัปโหลดไฟล์แบรนด์เข้า K3s"
# server-side apply: ฟอนต์ทำให้ ConfigMap ใหญ่เกิน annotation ของ apply แบบปกติ (262 KB)
kubectl -n "$NAMESPACE" create configmap aranchat-branding \
  --from-file="$OUT_DIR" --dry-run=client -o yaml | kubectl apply --server-side --force-conflicts -f -

# hash ของไฟล์ เพื่อให้ nginx โหลดไฟล์ใหม่ทุกครั้งที่ภาพเปลี่ยน
HASH=$(cat "$BRAND_DIR"/* "${ROOT_DIR}/k8s/branding.yaml.tpl" | sha256sum | cut -c1-12)
render "${ROOT_DIR}/k8s/branding.yaml.tpl" "${RENDER_DIR}/branding-k8s.yaml"
sed -i "s|__HASH__|${HASH}|g" "${RENDER_DIR}/branding-k8s.yaml"
kubectl apply -f "${RENDER_DIR}/branding-k8s.yaml"
kubectl -n "$NAMESPACE" rollout status deploy/aranchat-branding --timeout=120s

info "ทดสอบในเครื่อง"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: ${CHAT_HOST}" \
  "http://localhost:${TRAEFIK_HTTP_PORT:-8080}/branding/aranchat-logo.svg")
[[ "$code" == 200 ]] && ok "โลโก้เสิร์ฟได้ (HTTP 200)" || warn "เสิร์ฟโลโก้ไม่ได้ (HTTP $code)"

info "อัปเดตค่าหน้าเว็บแชท"
"${ROOT_DIR}/scripts/03-render.sh" >/dev/null
"${ROOT_DIR}/scripts/04-install.sh"
ok "เสร็จ — เปิด https://${CHAT_HOST} แบบ Ctrl+Shift+R (ล้าง cache) หรือหน้าต่างไม่ระบุตัวตน"
warn "ถ้ายังเห็นภาพเก่า: Cloudflare → Caching → Purge Cache → Custom → https://${CHAT_HOST}/branding/*"
