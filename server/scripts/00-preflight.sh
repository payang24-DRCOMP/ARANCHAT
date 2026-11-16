#!/usr/bin/env bash
# ตรวจความพร้อมก่อนติดตั้ง: ทรัพยากรเครื่อง, พอร์ตชนกับระบบเดิม, DNS
source "$(dirname "$0")/lib.sh"

[[ "${SERVER_NAME}" == *example* ]] && die "ยังไม่ได้แก้ SERVER_NAME ใน config.env"

info "ทรัพยากรเครื่อง"
cpu=$(nproc)
mem=$(awk '/MemTotal/{printf "%d", $2/1024/1024}' /proc/meminfo)
avail=$(awk '/MemAvailable/{printf "%d", $2/1024/1024}' /proc/meminfo)
disk=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
echo "  CPU ${cpu} core / RAM ${mem} GB (ว่างตอนนี้ ${avail} GB) / ดิสก์ว่าง ${disk} GB"
(( cpu >= 4 ))    || warn "แนะนำอย่างน้อย 4 core"
(( avail >= 6 ))  || warn "RAM ว่างน้อยกว่า 6 GB — แชทต้องใช้ราว 4–6 GB ถ้าเครื่องรัน Ollama/AI อยู่ด้วยอาจแย่งกัน"
(( disk >= 100 )) || warn "แนะนำพื้นที่ว่างอย่างน้อย 100 GB (ไฟล์แนบจะโตเร็ว)"

info "ตรวจพอร์ตบนเครื่องว่าชนกับระบบเดิมหรือไม่"
if [[ "$TLS_MODE" == "external" ]]; then
  ports_tcp=("${TRAEFIK_HTTP_PORT:-8080}" "${TRAEFIK_HTTPS_PORT:-8443}" 30001)
else
  ports_tcp=(80 443 30001)
fi
busy=0
for p in "${ports_tcp[@]}"; do
  if ss -ltnH "sport = :$p" | grep -q .; then
    # ถ้าเป็นของ k3s เอง (รันซ้ำ) ถือว่าปกติ
    if command -v k3s >/dev/null && sudo ss -ltnpH "sport = :$p" | grep -qE 'k3s|traefik|containerd'; then
      ok "TCP $p ใช้โดย k3s (ติดตั้งไว้แล้ว)"
    else
      warn "TCP $p ถูกใช้อยู่แล้ว:"; sudo ss -ltnpH "sport = :$p" | sed 's/^/      /'; busy=1
    fi
  else
    ok "TCP $p ว่าง"
  fi
done
if ss -lunH "sport = :30002" | grep -q .; then
  command -v k3s >/dev/null && ok "UDP 30002 ใช้โดย k3s" || { warn "UDP 30002 ถูกใช้อยู่แล้ว"; busy=1; }
else
  ok "UDP 30002 ว่าง"
fi
(( busy == 0 )) || die "พอร์ตชน — เปลี่ยน TRAEFIK_HTTP_PORT/TRAEFIK_HTTPS_PORT ใน config.env เป็นพอร์ตว่าง แล้วรันใหม่"

command -v docker >/dev/null && info "พบ Docker บนเครื่อง — ใช้ร่วมกับ K3s ได้ (K3s ใช้ containerd ของตัวเอง ไม่ยุ่งกับ container เดิม)"
command -v cloudflared >/dev/null && ok "พบ cloudflared (Cloudflare Tunnel)"

info "IP สาธารณะ (สำหรับ video call)"
detected=$(curl -fsS --max-time 5 https://api.ipify.org || true)
echo "  ตรวจพบ: ${detected:-ไม่ทราบ} / config.env: ${PUBLIC_IP:-ยังไม่ได้ใส่}"
[[ -z "$PUBLIC_IP" ]] && warn "ยังไม่ได้ใส่ PUBLIC_IP — แชทใช้ได้ แต่ video call จากนอก รพ. อาจไม่ติด"

info "ตรวจ DNS"
for h in "$SERVER_NAME" "$CHAT_HOST" "$MATRIX_HOST" "$AUTH_HOST" "$RTC_HOST" "$ADMIN_HOST"; do
  ip=$(getent ahostsv4 "$h" | awk 'NR==1{print $1}' || true)
  if [[ -n "$ip" ]]; then ok "$h → $ip"
  elif [[ "$TLS_MODE" == "external" ]]; then warn "$h ยังไม่มี DNS (ปกติ — จะถูกสร้างตอนเพิ่ม Public Hostname ใน Tunnel)"
  else die "$h ยังไม่มี DNS — สร้าง A record ก่อน"
  fi
done

info "สิ่งที่ต้อง forward จาก router/firewall ของ รพ. มาที่เครื่องนี้"
if [[ "$TLS_MODE" == "external" ]]; then
  echo "  TCP 30001 และ UDP 30002 (video call) — เว็บ/แชทวิ่งผ่าน Cloudflare Tunnel ไม่ต้องเปิดพอร์ตอื่น"
else
  echo "  TCP 80, 443, 30001 และ UDP 30002"
fi
ok "preflight ผ่าน"
