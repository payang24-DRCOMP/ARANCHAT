#!/usr/bin/env bash
# ส่งการ์ดทดสอบ (ข้อมูลจำลอง ไม่มีผู้ป่วยจริง) ถึงผู้ใช้ 1 คน — ใช้ลองแอปมือถือ/เว็บ/Desktop
#
# ใช้: ./27-test-cards.sh @payang:arankub.com          ส่งครบ 4 ใบ
#      ./27-test-cards.sh @payang:arankub.com lab      เฉพาะใบค่าวิกฤตแล็บ (lab | approve | refer | report)
#
# การ์ดเข้าแชท "AranChat แจ้งเตือน" ของคนนั้น · เรื่อง "ทดสอบการ์ด" (ปิดรับได้ด้วย "ปิด N" เหมือนเรื่องอื่น)
# ค่าวิกฤตทดสอบ = เรื่องด่วน: ไม่กดรับเคสภายใน 15 นาทีจะมีข้อความเตือนซ้ำ (ทดสอบระบบเตือนได้ด้วย)
set -euo pipefail
ESS=$(cd "$(dirname "$0")/.." && pwd)
TO=${1:?ใส่ผู้รับ เช่น @payang:arankub.com}
ONLY=${2:-all}
# ARAN_NOTIFY_API / ARAN_NOTIFY_KEY = ส่งไป notify ตัวอื่น (เช่น เครื่องทดสอบ)
KEY=${ARAN_NOTIFY_KEY:-$(grep '^NOTIFY_API_KEY=' "$ESS/notify/.env" | cut -d= -f2- | tr -d '"'"'")}
PORT=$(grep '^PORT=' "$ESS/notify/.env" | cut -d= -f2- | tr -d '"'"'" || true)
API=${ARAN_NOTIFY_API:-"http://127.0.0.1:${PORT:-3210}/send"}
RUN=$(date +%H%M%S)

send() {   # send <ชื่อ> <json>
  local out
  out=$(curl -sS -X POST "$API" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d "$2")
  echo "  $1: $out"
}

echo "ส่งการ์ดทดสอบถึง $TO"
if [[ $ONLY == all || $ONLY == lab ]]; then
  send "ค่าวิกฤตแล็บ (ปุ่มรับเคส)" '{"event":"test.card","priority":"urgent","id":"test-lab-'"$RUN"'","to":["'"$TO"'"],
    "title":"[ทดสอบ] ค่าวิกฤต Potassium 2.4 mmol/L (ต่ำ)","subtitle":"ต่ำกว่าเกณฑ์วิกฤต — แจ้งแพทย์ผู้รักษาโดยเร็ว",
    "fields":[["HN","0000000 (ทดสอบ)"],["ผล","2.4 mmol/L","crit"],["เกณฑ์วิกฤต","นอกช่วง 2.5–6.5"],["หน่วยงาน","ER · ทดสอบระบบ"]],
    "sections":[{"type":"table","title":"ผลแล็บใบนี้ · Electrolyte","columns":["รายการ","ผล","ช่วงปกติ"],
      "rows":[["Sodium","136 mmol/L","135-145"],["Potassium","2.4 mmol/L","3.5-5.1"],["Chloride","96 mmol/L","98-107"]],
      "tones":[["","ok",""],["","crit",""],["","low",""]]}],
    "buttons":[{"type":"action","id":"take","label":"รับเคส","style":"primary"},{"type":"copy","label":"คัดลอก HN","text":"0000000"}]}'
fi
if [[ $ONLY == all || $ONLY == approve ]]; then
  send "ขออนุมัติ (อนุมัติ/ไม่อนุมัติ)" '{"event":"test.card","id":"test-approve-'"$RUN"'","to":["'"$TO"'"],"level":"warning",
    "title":"[ทดสอบ] ขออนุมัติลาพักผ่อน 3 วัน","subtitle":"ตัวอย่างการ์ดอนุมัติงาน",
    "fields":[["วันที่","20–22 พ.ย. 2569"],["คงเหลือ","7 วัน"]],
    "buttons":[{"type":"action","id":"approve","label":"อนุมัติ","style":"primary"},
               {"type":"action","id":"reject","label":"ไม่อนุมัติ","style":"danger",
                "ask":{"prompt":"เหตุผลที่ไม่อนุมัติ?","options":["ช่วงนั้นคนไม่พอ","ขอเลื่อนวัน","วันลาไม่พอ"]}}]}'
fi
if [[ $ONLY == all || $ONLY == refer ]]; then
  send "ส่งต่อผู้ป่วย (ขั้นตอน + เลือกวันเวลา)" '{"event":"test.card","id":"test-refer-'"$RUN"'","to":["'"$TO"'"],"level":"info",
    "title":"[ทดสอบ] ส่งต่อผู้ป่วย → รพ.ปลายทาง","subtitle":"ตัวอย่างการ์ดติดตามสถานะ",
    "sections":[{"type":"steps","items":[{"label":"ประสานปลายทาง","time":"10:05","state":"done"},
      {"label":"ปลายทางตอบรับ","time":"10:12","state":"done"},{"label":"รถออกเดินทาง","state":"current"},{"label":"ถึงปลายทาง","state":"todo"}]}],
    "buttons":[{"type":"datetime","id":"arrive","label":"แจ้งเวลาถึง","mode":"datetime"},{"type":"copy","label":"คัดลอกเลขส่งต่อ","text":"RF-TEST"}]}'
fi
if [[ $ONLY == all || $ONLY == report ]]; then
  send "สรุปรายวัน (ตัวเลข + ปุ่มตอบด่วน)" '{"event":"test.card","id":"test-report-'"$RUN"'","to":["'"$TO"'"],"level":"success",
    "title":"[ทดสอบ] สรุปบริการวันนี้","subtitle":"ตัวอย่างการ์ดรายงาน",
    "sections":[{"type":"stats","items":[{"label":"OPD","value":"412"},{"label":"ER","value":"57"},{"label":"Admit","value":"18","tone":"high"}]}],
    "quick_replies":[{"label":"❓ คำสั่งทั้งหมด","text":"/help"},{"label":"⚙️ ตั้งค่า","text":"/settings"}]}'
fi
echo "เปิดแชท \"AranChat แจ้งเตือน\" ในแอปเพื่อดูการ์ด"
