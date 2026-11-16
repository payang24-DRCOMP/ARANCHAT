#!/usr/bin/env bash
# ตั้งค่า SSL ตาม TLS_MODE ใน config.env
source "$(dirname "$0")/lib.sh"
mkdir -p "$RENDER_DIR"
BASE="https://raw.githubusercontent.com/element-hq/ess-helm/refs/heads/main/charts/matrix-stack/ci/fragments"

case "$TLS_MODE" in
  letsencrypt)
    info "ติดตั้ง cert-manager"
    helm repo add jetstack https://charts.jetstack.io --force-update
    helm upgrade --install cert-manager jetstack/cert-manager \
      --namespace cert-manager --create-namespace \
      --version v1.17.0 --set crds.enabled=true --wait
    kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ${ACME_EMAIL}
    privateKeySecretRef:
      name: letsencrypt-prod-private-key
    solvers:
      - http01:
          ingress:
            class: traefik
EOF
    curl -fsSL "${BASE}/quick-setup-letsencrypt.yaml" -o "${RENDER_DIR}/tls.yaml"
    ;;
  wildcard)
    [[ -f "$WILDCARD_CERT_FILE" && -f "$WILDCARD_KEY_FILE" ]] || die "ไม่พบไฟล์ใบรับรอง wildcard"
    kubectl -n "$NAMESPACE" create secret tls ess-certificate \
      --cert="$WILDCARD_CERT_FILE" --key="$WILDCARD_KEY_FILE" \
      --dry-run=client -o yaml | kubectl apply -f -
    curl -fsSL "${BASE}/quick-setup-wildcard-cert.yaml" -o "${RENDER_DIR}/tls.yaml"
    ;;
  external)
    curl -fsSL "${BASE}/quick-setup-external-cert.yaml" -o "${RENDER_DIR}/tls.yaml"
    warn "ให้ Cloudflare Tunnel / reverse proxy ส่งทุกโดเมนไปที่ http://localhost:${TRAEFIK_HTTP_PORT:-8080}"
    ;;
  *) die "TLS_MODE ต้องเป็น letsencrypt, wildcard หรือ external" ;;
esac
ok "เตรียม tls.yaml แล้ว ($TLS_MODE)"
