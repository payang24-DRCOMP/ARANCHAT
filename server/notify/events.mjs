// รายการเรื่องที่แจ้งเตือนเข้าแชทได้ — ผู้ใช้เปิด/ปิดเองรายเรื่องในแชทกับ bot (พิมพ์ "ตั้งค่า")
// icon: emoji หน้าหัวข้อข้อความ · on: ค่าเริ่มต้น (เปิด/ปิด) · เรื่องที่เกิดถี่มากปิดไว้ก่อน ไม่งั้นแชทท่วมจนไม่มีใครอ่าน
// ลำดับในไฟล์ = หมายเลขที่ผู้ใช้เห็น ("ปิด 3") → เพิ่มเรื่องใหม่ต่อท้ายเสมอ ห้ามแทรก/ลบกลางรายการ
// kind ที่ไม่อยู่ในรายการ: ส่งตามปกติ (เปิดไว้) และได้หมายเลขต่อท้ายอัตโนมัติ
export const EVENTS = [
  // AranKub — งานส่งยา (src/lib/notify.ts: notifyStaff)
  { key: "arankub:NEW_CASES", label: "งานส่งยา: มีรายการใหม่", icon: "📦", on: true },
  { key: "arankub:DELIVERED", label: "งานส่งยา: ส่งสำเร็จ (ถี่มาก)", icon: "✅", on: false },
  { key: "arankub:FAILED", label: "งานส่งยา: ส่งไม่สำเร็จ", icon: "⚠️", on: true },
  { key: "arankub:RETURNED", label: "งานส่งยา: ตีกลับ", icon: "↩️", on: true },
  { key: "arankub:REDELIVERY", label: "งานส่งยา: ส่งใหม่", icon: "🔁", on: true },
  { key: "arankub:OVERDUE", label: "งานส่งยา: เกินกำหนด", icon: "⏰", on: true },
  { key: "arankub:ADDR_CHECK", label: "งานส่งยา: ตรวจที่อยู่", icon: "📍", on: true },
  { key: "arankub:UNASSIGNED", label: "งานส่งยา: ยังไม่มีผู้รับงาน", icon: "🙋", on: true },
  { key: "arankub:ASSIGNED", label: "งานส่งยา: มอบหมายงาน", icon: "🛵", on: false },
  // AranKub — ตรวจรหัสโรคผู้ป่วยใน / ผู้ดูแลระบบ
  { key: "arankub:CODING_ALERT", label: "รหัสโรค: พบเคสลงรหัสผิดกฎ", icon: "⛔", on: true },
  { key: "arankub:CODING_DAILY", label: "รหัสโรค: สรุปรายวัน", icon: "📋", on: true },
  { key: "arankub:ACCESS_REQUEST", label: "ผู้ดูแลระบบ: มีคำขอสิทธิ์", icon: "🔑", on: true },
  // P4P (src/server/notify.ts: notify)
  { key: "p4p:approval_pending", label: "P4P: ผลงานรอรับรอง", icon: "📝", on: true },
  { key: "p4p:entry_approved", label: "P4P: ผลงานได้รับรอง", icon: "✅", on: true },
  { key: "p4p:entry_returned", label: "P4P: ผลงานถูกส่งกลับ", icon: "↩️", on: true },
  { key: "p4p:entry_comment", label: "P4P: ความเห็นในผลงาน", icon: "💬", on: true },
  { key: "p4p:announcement", label: "P4P: ประกาศ", icon: "📢", on: true },
  { key: "p4p:period_open", label: "P4P: เปิดรอบบันทึกผลงาน", icon: "🟢", on: true },
  { key: "p4p:period_closing", label: "P4P: รอบใกล้ปิด", icon: "⏳", on: true },
  { key: "p4p:period_closing_head", label: "P4P: รอบใกล้ปิด (หัวหน้า)", icon: "⏳", on: true },
  { key: "p4p:period_committee", label: "P4P: งานคณะกรรมการ", icon: "🏛️", on: true },
  { key: "p4p:supervisor_request", label: "P4P: คำขอเป็นผู้รับรอง", icon: "🤝", on: true },
  { key: "p4p:supervisor_assigned", label: "P4P: ได้รับมอบหมายผู้รับรอง", icon: "👤", on: true },
  { key: "p4p:supervisor_accepted", label: "P4P: ผู้รับรองตอบรับ", icon: "🤝", on: true },
  { key: "p4p:own_activity_review", label: "P4P: กิจกรรมที่เสนอรอตรวจ", icon: "🔎", on: true },
  { key: "p4p:own_activity_confirmed", label: "P4P: กิจกรรมที่เสนอได้รับอนุมัติ", icon: "✅", on: true },
  { key: "p4p:own_activity_merged", label: "P4P: กิจกรรมที่เสนอถูกรวม", icon: "🔗", on: true },
  { key: "p4p:new_user", label: "P4P: ผู้ใช้ใหม่รอตรวจ", icon: "🆕", on: true },
  // ระบบอื่นที่ส่งผ่าน API (POST /send) — event ตามที่ระบบนั้นส่งมา
  { key: "api:nhso.sync", label: "ดึงข้อมูล สปสช.", icon: "💰", on: true },
  { key: "api:cron.failed", label: "งานอัตโนมัติ (cron) ล้มเหลว", icon: "⚙️", on: true },
  // AranKub — กองทุน สปสช. รายกิจกรรม (src/lib/fund-notify.ts) ส่งให้ผู้รับผิดชอบกิจกรรม: เมื่อมีงานใหม่ + สรุปทุกวันจันทร์
  { key: "arankub:FUND_DIGEST", label: "กองทุน สปสช.: งานค้างของฉัน", icon: "💰", on: true },
  // AranChat เอง — แอปรุ่นใหม่ขึ้นหน้าดาวน์โหลด (scripts/18-publish-apps.sh --announce → /admin/announce) ส่งถึงทุกคน ปิดรับไม่ได้ (นานๆ ครั้ง)
  { key: "api:app.update", label: "AranChat: มีแอปรุ่นใหม่", icon: "⬆️", on: true, mandatory: true },
];
