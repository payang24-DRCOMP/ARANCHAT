#!/usr/bin/env bash
# สร้างไฟล์ values จริงจากแม่แบบ + config.env
source "$(dirname "$0")/lib.sh"
mkdir -p "$RENDER_DIR"

for f in hostnames branding synapse auth hookshot; do
  render "${VALUES_DIR}/${f}.yaml.tpl" "${RENDER_DIR}/${f}.yaml"
done

# ปิด federation (คุยเฉพาะภายใน รพ.)
if [[ "$DISABLE_FEDERATION" != "true" ]]; then
  sed -i '/federation_domain_whitelist/d' "${RENDER_DIR}/synapse.yaml"
fi

# Video call: ระบุ IP สาธารณะเมื่ออยู่หลัง NAT
if [[ -n "$PUBLIC_IP" ]]; then
  render "${VALUES_DIR}/rtc.yaml.tpl" "${RENDER_DIR}/rtc.yaml"
else
  rm -f "${RENDER_DIR}/rtc.yaml"
fi

# Login ด้วยบัญชี AranKub: เปิดเมื่อมี client secret ใน secrets.env (สร้างด้วย scripts/10-arankub-sso.sh)
if [[ -n "${OIDC_CLIENT_SECRET:-}" ]]; then
  render "${VALUES_DIR}/arankub-sso.yaml.tpl" "${RENDER_DIR}/arankub-sso.yaml"
  chmod 600 "${RENDER_DIR}/arankub-sso.yaml"
else
  rm -f "${RENDER_DIR}/arankub-sso.yaml"
fi

# ภาษาไทยหน้า login: เปิดเมื่อสร้างไฟล์ภาษาแล้ว (scripts/11-thai.sh) — ไม่งั้น MAS จะหาไฟล์ภาษาไม่เจอ
if [[ -f "${RENDER_DIR}/i18n/mas/en.json" ]]; then
  render "${VALUES_DIR}/thai.yaml.tpl" "${RENDER_DIR}/thai.yaml"
else
  rm -f "${RENDER_DIR}/thai.yaml"
fi

# หน้า login แบบแก้เอง (mas-templates/) — 04-install.sh อัปโหลดเป็น ConfigMap aranchat-mas-templates
mkdir -p "${RENDER_DIR}/mas-templates"
for t in "${ROOT_DIR}"/mas-templates/*.tpl; do
  render "$t" "${RENDER_DIR}/mas-templates/$(basename "$t" .tpl)"
done

# เก็บไฟล์ hostnames ต้นฉบับไว้เทียบ เผื่อ chart เปลี่ยนชื่อ key
curl -fsSL https://raw.githubusercontent.com/element-hq/ess-helm/refs/heads/main/charts/matrix-stack/ci/fragments/quick-setup-hostnames.yaml \
  -o "${RENDER_DIR}/official-hostnames.example.yaml" || warn "โหลดไฟล์ต้นฉบับไม่ได้ (ไม่กระทบการติดตั้ง)"

ok "สร้างไฟล์ใน ${RENDER_DIR}:"
ls -1 "$RENDER_DIR"
