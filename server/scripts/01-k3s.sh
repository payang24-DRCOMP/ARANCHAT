#!/usr/bin/env bash
# ติดตั้ง K3s + Helm + ตั้งค่า Traefik ตามคู่มือ ESS Community
source "$(dirname "$0")/lib.sh"

# พอร์ตของ Traefik: โหมด external (Cloudflare Tunnel) ใช้พอร์ตจาก config.env
# เพื่อไม่ชนกับเว็บ/ระบบอื่นที่ใช้ 80/443 อยู่แล้วบนเครื่อง
if [[ "${TLS_MODE}" == "external" ]]; then
  HTTP_PORT="${TRAEFIK_HTTP_PORT:-8080}"; HTTPS_PORT="${TRAEFIK_HTTPS_PORT:-8443}"
  # เชื่อ header X-Forwarded-* จาก cloudflared/proxy ที่อยู่ในเครื่องหรือวงภายใน
  TRUSTED='["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.1/32", "2001:db8:42::/56"]'
else
  HTTP_PORT=80; HTTPS_PORT=443
  TRUSTED='["10.42.0.0/16", "2001:db8:42::/56"]'
fi

# เขียนไฟล์ตั้งค่า Traefik ก่อนติดตั้ง K3s เพื่อไม่ให้ Traefik ไปจับพอร์ต 80/443 ตั้งแต่แรก
info "ตั้งค่า Traefik (พอร์ต ${HTTP_PORT}/${HTTPS_PORT}, timeout สำหรับไฟล์ใหญ่)"
sudo mkdir -p /var/lib/rancher/k3s/server/manifests
sudo tee /var/lib/rancher/k3s/server/manifests/traefik-config.yaml >/dev/null <<EOF
apiVersion: helm.cattle.io/v1
kind: HelmChartConfig
metadata:
  name: traefik
  namespace: kube-system
spec:
  valuesContent: |-
    ports:
      web:
        exposedPort: ${HTTP_PORT}
        forwardedHeaders:
          trustedIPs: ${TRUSTED}
        http:
          encodedCharacters:
            allowEncodedHash: true
            allowEncodedSlash: true
        transport:
          respondingTimeouts:
            readTimeout: "600s"
            writeTimeout: "600s"
            idleTimeout: "600s"
      websecure:
        exposedPort: ${HTTPS_PORT}
        forwardedHeaders:
          trustedIPs: ${TRUSTED}
        http:
          encodedCharacters:
            allowEncodedHash: true
            allowEncodedSlash: true
        transport:
          respondingTimeouts:
            readTimeout: "600s"
            writeTimeout: "600s"
            idleTimeout: "600s"
EOF

if ! command -v k3s >/dev/null; then
  info "ติดตั้ง K3s"
  curl -sfL https://get.k3s.io | sh -
else
  ok "มี K3s แล้ว"
fi

info "ตั้งค่า kubeconfig"
mkdir -p "$HOME/.kube"
sudo k3s kubectl config view --raw > "$HOME/.kube/config"
chmod 600 "$HOME/.kube/config"
grep -q 'KUBECONFIG=~/.kube/config' "$HOME/.bashrc" || echo 'export KUBECONFIG=~/.kube/config' >> "$HOME/.bashrc"

if ! command -v helm >/dev/null; then
  info "ติดตั้ง Helm"
  curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
fi

kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 || kubectl create namespace "$NAMESPACE"
info "รอ Traefik พร้อม..."
for _ in $(seq 1 60); do
  kubectl -n kube-system get svc traefik >/dev/null 2>&1 && break; sleep 5
done
kubectl -n kube-system get svc traefik
ok "K3s พร้อม — แชทรับที่ http://localhost:${HTTP_PORT}"
