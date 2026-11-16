#!/usr/bin/env bash
# หน้าเอกสารนักพัฒนา (การ์ด ปุ่ม คำสั่งบอท มินิแอป) → https://${CHAT_HOST}/connect/bot/
# ต้นฉบับ: docs-site/bot/ (+ notify/templates/examples.json) → ~/aranchat-apps/web-dist/docs/bot/ (nginx อ่านจากดิสก์ ไม่ต้อง restart)
# ไม่อยู่ใน configmap แบรนด์ (เพดาน 1 MB) เพราะมีรูปประกอบ · ครั้งแรกต้องรัน 09-branding.sh เพื่อเพิ่ม location /connect/bot/
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
source "$ROOT/config.env"
OUT=${ARAN_DOCS_OUT:-/home/payang/aranchat-apps/web-dist/docs}/bot
rm -rf "$OUT.new"; mkdir -p "$OUT.new"
cp -r "$ROOT/docs-site/bot/." "$OUT.new/"
cp "$ROOT/notify/templates/examples.json" "$OUT.new/examples.json"
sed -i -e "s|__CHAT_HOST__|${CHAT_HOST}|g" -e "s|__BRAND__|${BRAND}|g" -e "s|__SERVER__|${SERVER_NAME}|g" "$OUT.new/index.html"
rm -rf "$OUT"; mv "$OUT.new" "$OUT"
echo "เอกสาร: $OUT → https://${CHAT_HOST}/connect/bot/"
