#!/bin/bash
# รันในคอนเทนเนอร์ openstreetmap-tile-server: โหลดข้อมูลเสริม (ทะเล/ขอบเขต) ซ้ำ เมื่อขั้นนี้ของการนำเข้าล้ม (เน็ตหลุด)
set -euo pipefail
eval "$(sed -n '/^function createPostgresConfig/,/^}/p' /run.sh)"
[ "$(ls -A /data/style/)" ] || mv /home/renderer/src/openstreetmap-carto-backup/* /data/style/
chown -R postgres: /var/lib/postgresql /data/database/postgres/
createPostgresConfig
service postgresql start
for i in 1 2 3; do
  sudo -E -u renderer python3 /data/style/scripts/get-external-data.py -c /data/style/external-data.yml -D /data/style/data && ok=1 && break
  sleep 10
done
[ "${ok:-}" = 1 ] || { service postgresql stop; exit 1; }
sudo -u renderer touch /data/database/planet-import-complete
service postgresql stop
