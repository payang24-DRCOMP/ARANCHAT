#!/usr/bin/env bash
# ติดตั้งภาษาไทย: เว็บแชท (Element Web) + หน้า login (MAS)
#
# คำแปลอยู่ที่ i18n/*.tsv (key<TAB>คำแปล) — แก้แล้วรันสคริปต์นี้ซ้ำ
# อัปเดต Element/MAS เวอร์ชันใหม่ → รันซ้ำ: ข้อความใหม่แสดงเป็นอังกฤษจนกว่าจะเพิ่มคำแปล
# ข้อความที่ตัวแปร/แท็กไม่ตรงต้นฉบับจะถูกข้าม (ดูรายการที่สคริปต์พิมพ์ออกมา)
source "$(dirname "$0")/lib.sh"
need python3
OUT="${RENDER_DIR}/i18n"
mkdir -p "$OUT/web" "$OUT/mas"
BUILD="${ROOT_DIR}/scripts/i18n-build.py"
wget_web() { kubectl -n "$NAMESPACE" exec deploy/aranchat-branding -- wget -qO- "http://ess-element-web.${NAMESPACE}.svc.cluster.local/$1"; }

info "เว็บแชท: อ่านไฟล์ภาษาต้นฉบับจาก Element Web ที่ติดตั้งอยู่"
wget_web i18n/languages.json > "$OUT/languages.orig.json"
EN_FILE=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['en'])" "$OUT/languages.orig.json")
wget_web "i18n/${EN_FILE}" > "$OUT/element-en.json"
python3 "$BUILD" "$OUT/element-en.json" "$OUT/web/th.json" "${ROOT_DIR}"/i18n/element-th-*.tsv
TH_FILE="th.$(sha256sum "$OUT/web/th.json" | cut -c1-8).json"
python3 - "$OUT/languages.orig.json" "$OUT/web/languages.json" "$TH_FILE" <<'EOF'
import json, sys
langs = json.load(open(sys.argv[1]))
langs["th"] = sys.argv[3]
json.dump(langs, open(sys.argv[2], "w"), indent=1)
EOF
# ไม่ใช้ apply: apply เก็บสำเนาทั้งไฟล์ไว้ใน annotation (จำกัด 256 KB) — ไฟล์ภาษาไทยใหญ่เกินแล้ว
# ลบสำเนาเก่าที่ apply เคยเขียนไว้ก่อน (ไม่งั้น replace จะเขียนสำเนาใหม่ทับให้อีก) แล้วค่อย replace / create
put_configmap() {   # put_configmap <ชื่อ> <โฟลเดอร์>
  if kubectl -n "$NAMESPACE" get configmap "$1" >/dev/null 2>&1; then
    kubectl -n "$NAMESPACE" annotate configmap "$1" kubectl.kubernetes.io/last-applied-configuration- >/dev/null 2>&1 || true
    kubectl -n "$NAMESPACE" create configmap "$1" --from-file="$2" --dry-run=client -o yaml | kubectl replace -f -
  else
    kubectl -n "$NAMESPACE" create configmap "$1" --from-file="$2"
  fi
}
put_configmap aranchat-i18n-web "$OUT/web"

info "หน้า login: ไฟล์ภาษาต้นฉบับของ MAS เวอร์ชันที่ติดตั้งอยู่"
MAS_VER=$(kubectl -n "$NAMESPACE" get deploy ess-matrix-authentication-service \
  -o jsonpath='{.spec.template.spec.containers[0].image}' | sed 's/.*://')
curl -fsSL "https://raw.githubusercontent.com/element-hq/matrix-authentication-service/v${MAS_VER}/translations/en.json" \
  -o "$OUT/mas/en.json" || die "โหลด en.json ของ MAS v${MAS_VER} ไม่ได้"
# เบราว์เซอร์ภาษาอังกฤษ: ชื่อแท็บ/หัวหน้าเป็น AranChat ด้วย (ต้นฉบับคือ "matrix-authentication-service")
python3 - "$OUT/mas/en.json" "$BRAND" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
d["app"]["name"] = d["app"]["human_name"] = sys.argv[2]
json.dump(d, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False, indent=2)
EOF
python3 "$BUILD" "$OUT/mas/en.json" "$OUT/mas/th.json" "${ROOT_DIR}/i18n/mas-th.tsv"
put_configmap aranchat-i18n-mas "$OUT/mas"

info "ติดตั้ง (เสิร์ฟไฟล์ภาษา + ตั้งภาษาไทยเป็นค่าเริ่มต้น)"
"${ROOT_DIR}/scripts/09-branding.sh"
kubectl -n "$NAMESPACE" rollout restart deploy/aranchat-branding >/dev/null
kubectl -n "$NAMESPACE" rollout restart deploy/ess-matrix-authentication-service >/dev/null
kubectl -n "$NAMESPACE" rollout status deploy/ess-matrix-authentication-service --timeout=180s
ok "เสร็จ — เปิด https://${CHAT_HOST} ใหม่ (Ctrl+Shift+R) · เปลี่ยนภาษาได้ที่ การตั้งค่า → ทั่วไป → ภาษา"
