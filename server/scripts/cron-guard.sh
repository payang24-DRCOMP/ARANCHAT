#!/usr/bin/env bash
# ครอบงาน cron: รันคำสั่งตามเดิม ถ้าล้มเหลว → แจ้งเตือนเข้าแชท (AranChat Notify, เรื่อง "งานอัตโนมัติล้มเหลว")
# แจ้งเฉพาะตอนสถานะเปลี่ยน (เพิ่งล้ม / กลับมาปกติ) — งานที่รันทุก 5 นาทีจะไม่เด้งซ้ำทุก 5 นาที
#
# ใช้ใน crontab:  */5 * * * * /home/payang/aranchat-ess/scripts/cron-guard.sh opd-sync curl -sf -m 280 -X POST ...
#   - curl ต้องมี -f (ไม่งั้น HTTP 500 จะนับเป็นสำเร็จ)
#   - ผู้รับ: CRON_NOTIFY_TO ใน notify/.env (id ผู้ใช้ AranKub คั่นด้วย ,)
#   - ผลลัพธ์ของคำสั่งส่งต่อออก stdout/stderr ตามเดิม (>> log ใน crontab ยังใช้ได้)
set -u
NAME="${1:?ใช้: $0 <ชื่องาน> <คำสั่ง...>}"; shift
DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${DIR}/notify/data/cron"
mkdir -p "$STATE_DIR"
OUT="$(mktemp)"; trap 'rm -f "$OUT"' EXIT

"$@" > >(tee "$OUT") 2> >(tee -a "$OUT" >&2)
code=$?
wait

state_file="${STATE_DIR}/${NAME}.failed"
prev_failed=0; [[ -f "$state_file" ]] && prev_failed=1

notify() {   # $1 title  $2 text  $3 priority
  local key to
  key=$(grep -E '^NOTIFY_API_KEY=' "${DIR}/notify/.env" | cut -d= -f2-)
  to=$(grep -E '^CRON_NOTIFY_TO=' "${DIR}/notify/.env" | cut -d= -f2-)
  [[ -z "$key" || -z "$to" ]] && return 0
  python3 - "$1" "$2" "$3" "$to" <<'EOF' | curl -s -m 10 -o /dev/null -X POST http://127.0.0.1:3210/send \
      -H "Authorization: Bearer ${key}" -H 'Content-Type: application/json' --data-binary @- || true
import json, sys
title, text, prio, to = sys.argv[1:5]
print(json.dumps({"event": "cron.failed", "title": title, "text": text, "priority": prio,
                  "to": [f"arankub:{u.strip()}" for u in to.split(",") if u.strip()]}, ensure_ascii=False))
EOF
}

if [[ $code -ne 0 ]]; then
  if [[ $prev_failed -eq 0 ]]; then
    date -Iseconds > "$state_file"
    # ตัดข้อความยาว และไม่ส่ง secret ที่อาจติดมาใน output
    tail_out=$(tail -c 400 "$OUT" | sed -E 's/(secret|token|key|password)[^ ]*[:=][^ ]+/\1=***/Ig')
    notify "งานอัตโนมัติล้มเหลว: ${NAME}" "exit code ${code} · $(hostname) · $(date '+%d/%m %H:%M')${tail_out:+
${tail_out}}" urgent
  fi
elif [[ $prev_failed -eq 1 ]]; then
  since=$(cat "$state_file"); rm -f "$state_file"
  notify "งานอัตโนมัติกลับมาปกติ: ${NAME}" "ล้มเหลวตั้งแต่ ${since}" normal
fi
exit $code
