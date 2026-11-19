#!/usr/bin/env bash
# แผนที่ของ รพ. เอง (OpenStreetMap ประเทศไทย) — แชร์ตำแหน่งในแชท + แผนที่ใน AranKub ไม่ต้องพึ่งบริการภายนอก
# ใช้: ./28-maps.sh            ติดตั้ง/อัปเดตบริการ (รันซ้ำได้)
#      ./28-maps.sh update     ดาวน์โหลดข้อมูลแผนที่ล่าสุด แล้วนำเข้าใหม่ (เดือนละครั้งพอ · แผนที่ใช้ไม่ได้ระหว่างนำเข้า ~30–60 นาที)
#
#   1. ข้อมูล: thailand-latest.osm.pbf จาก Geofabrik → maps/data/
#   2. ตัววาดแผนที่: docker "aranchat-osm" (overv/openstreetmap-tile-server — ฟอนต์ Noto รวมภาษาไทย) ที่ 127.0.0.1:18090
#   3. maps/server.mjs (pm2 aranchat-maps, 10.42.0.1:3214): แคช + โหมดมืด + style ของ MapLibre + ภาพแผนที่ย่อ
#   4. ทางเข้า https://<chat>/maps (K3s ingress)
#   แอป: เว็บ map_style_url (14-web-beta.sh) · Android/iOS ตั้ง MAP_URL ตอน build (aranchat/brand.env)
source "$(dirname "$0")/lib.sh"
M="${ROOT_DIR}/maps"
IMAGE=overv/openstreetmap-tile-server:2.3.0
PBF="$M/data/thailand-latest.osm.pbf"
mkdir -p "$M/data"

download() {
  info "ดาวน์โหลดข้อมูลแผนที่ประเทศไทย (~330 MB)"
  (cd "$M/data" && curl -fsSL -o thailand-latest.osm.pbf.new https://download.geofabrik.de/asia/thailand-latest.osm.pbf \
    && curl -fsSL https://download.geofabrik.de/asia/thailand-latest.osm.pbf.md5 | sed 's/thailand-latest.osm.pbf/thailand-latest.osm.pbf.new/' | md5sum -c --quiet \
    && mv thailand-latest.osm.pbf.new thailand-latest.osm.pbf) || die "ดาวน์โหลดไม่สำเร็จ"
}

import() {
  info "นำเข้าข้อมูลแผนที่ (30–60 นาที) — log: $M/data/import.log"
  docker rm -f aranchat-osm >/dev/null 2>&1 || true
  docker volume rm aranchat-osm-data aranchat-osm-tiles >/dev/null 2>&1 || true
  docker volume create aranchat-osm-data >/dev/null && docker volume create aranchat-osm-tiles >/dev/null
  docker run --rm --name aranchat-osm-import -e THREADS=16 -e "OSM2PGSQL_EXTRA_ARGS=-C 16000" \
    -v "$PBF:/data/region.osm.pbf:ro" -v aranchat-osm-data:/data/database/ -v aranchat-osm-tiles:/data/tiles/ \
    "$IMAGE" import >"$M/data/import.log" 2>&1 || true
  # ขั้นสุดท้ายของการนำเข้า (ข้อมูลทะเล/ขอบเขตจาก osmdata.openstreetmap.de ~1 GB) ล้มบ่อยเมื่อเน็ตหลุด → ลองใหม่เฉพาะขั้นนั้น
  if ! docker run --rm -v aranchat-osm-data:/d alpine test -f /d/planet-import-complete; then
    warn "โหลดข้อมูลเสริมไม่ครบ — ลองใหม่เฉพาะขั้นนี้"
    docker run --rm --name aranchat-osm-external --entrypoint /finish.sh -v "$M/finish-external.sh:/finish.sh:ro" \
      -v aranchat-osm-data:/data/database/ "$IMAGE" >"$M/data/external.log" 2>&1 \
      || die "นำเข้าไม่สำเร็จ — ดู $M/data/import.log และ $M/data/external.log"
  fi
  rm -rf "${M:?}/data/cache"   # ภาพเก่าในแคชมาจากข้อมูลชุดก่อน
  ok "นำเข้าแล้ว"
}

if [[ ${1:-} == update ]]; then download; import
else
  [[ -f $PBF ]] || download
  docker volume inspect aranchat-osm-data >/dev/null 2>&1 || import
fi

if ! docker ps --format '{{.Names}}' | grep -qx aranchat-osm; then
  docker rm -f aranchat-osm >/dev/null 2>&1 || true
  docker run -d --name aranchat-osm --restart unless-stopped -e THREADS=8 --shm-size=1g \
    -p 127.0.0.1:18090:80 -v aranchat-osm-data:/data/database/ -v aranchat-osm-tiles:/data/tiles/ \
    "$IMAGE" run >/dev/null
  ok "ตัววาดแผนที่ทำงานแล้ว (docker aranchat-osm)"
fi

(cd "$M" && npm install --omit=dev --no-audit --no-fund --silent)
export PUBLIC_URL="https://${CHAT_HOST}/maps"
if pm2 describe aranchat-maps >/dev/null 2>&1; then pm2 restart aranchat-maps --update-env >/dev/null
else (cd "$M" && pm2 start server.mjs --name aranchat-maps >/dev/null); fi
pm2 save >/dev/null

render "${ROOT_DIR}/k8s/maps.yaml.tpl" "${RENDER_DIR}/maps-k8s.yaml"
kubectl apply -f "${RENDER_DIR}/maps-k8s.yaml"

out=$(curl -s "https://${CHAT_HOST}/maps/health")
[[ "$out" == *'"ok":true'* ]] && ok "แผนที่พร้อม: https://${CHAT_HOST}/maps/tiles/{z}/{x}/{y}.png" \
  || warn "ยังเรียกไม่ได้ ($out) — ตรวจ: pm2 logs aranchat-maps / docker logs aranchat-osm"
info "เว็บแชทใช้แผนที่นี้หลังรัน 14-web-beta.sh (map_style_url) · AranKub: เปลี่ยน URL ภาพแผนที่เป็นด้านบน"
