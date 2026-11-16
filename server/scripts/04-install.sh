#!/usr/bin/env bash
# ติดตั้ง/อัปเดต ESS Community (รันซ้ำได้ทุกครั้งที่แก้ config)
source "$(dirname "$0")/lib.sh"
need helm

args=(-f "${RENDER_DIR}/hostnames.yaml" -f "${RENDER_DIR}/tls.yaml")
for f in branding synapse auth hookshot rtc arankub-sso thai; do
  [[ -f "${RENDER_DIR}/${f}.yaml" ]] && args+=(-f "${RENDER_DIR}/${f}.yaml")
done

# แม่แบบ mount แบบ subPath ไม่อัปเดตเอง → แม่แบบเปลี่ยนเมื่อไรต้อง restart MAS
tpl_changed=$(kubectl -n "$NAMESPACE" create configmap aranchat-mas-templates --from-file="${RENDER_DIR}/mas-templates" \
  --dry-run=client -o yaml | kubectl apply -f - | grep -c configured || true)

info "helm upgrade --install (ครั้งแรกใช้เวลา 5–15 นาที)"
helm upgrade --install --namespace "$NAMESPACE" "$RELEASE" "$CHART" "${args[@]}" --wait --timeout 20m

if [[ "$tpl_changed" != 0 ]]; then
  kubectl -n "$NAMESPACE" rollout restart deploy/ess-matrix-authentication-service >/dev/null
  kubectl -n "$NAMESPACE" rollout status deploy/ess-matrix-authentication-service --timeout=180s
fi

kubectl -n "$NAMESPACE" get pods
ok "ติดตั้งเสร็จ → เปิด https://${CHAT_HOST}"
