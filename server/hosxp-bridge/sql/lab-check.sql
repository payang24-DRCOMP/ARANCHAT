-- SQL ที่ตัวเชื่อม HOSxP (hosxp-bridge/bridge.mjs) ใช้ดึงแจ้งเตือนผลแล็บ — เอาไปรันตรวจใน HeidiSQL/Navicat ได้เลย
-- อ่านอย่างเดียว (SELECT) · ตัวเชื่อมรันทุก 60 วินาที ย้อนหลัง 30 นาที (1800 วินาที) · ส่งแล้วจำไว้ ไม่ส่งซ้ำ
-- ปรับช่วงเวลาตรวจ: เปลี่ยน @secs (เช่น 86400 = ย้อน 24 ชม.)
SET @secs = 1800;

-- ─────────────────────────────────────────────────────────────
-- 1) ผลแล็บออก (lab.reported) — 1 แถว = 1 ใบสั่ง = 1 แจ้งเตือนถึงแพทย์ผู้สั่ง (เฉพาะแพทย์ที่เปิดรับเอง)
--    เงื่อนไข: ใบที่ "ยืนยันผลแล้ว" (confirm_report='Y') และเวลารายงานอยู่ในช่วง @secs ล่าสุด
--    แพทย์ผู้สั่ง = lab_head.doctor_code → doctor.code · ส่งถึงแพทย์ด้วย doctor.cid (เข้ารหัส SHA-256 ก่อนส่ง ไม่ส่งเลข ปชช.)
-- ─────────────────────────────────────────────────────────────
SELECT h.lab_order_number AS no, h.hn, h.department AS dep, h.form_name AS form,
       h.report_date, h.report_time, h.lab_priority_id AS prio,
       d.name AS doctor, (d.cid IS NOT NULL AND d.cid <> '') AS doctor_has_cid,
       k.department AS unit, p.sex
  FROM lab_head h
  LEFT JOIN doctor d        ON d.code = h.doctor_code
  LEFT JOIN kskdepartment k ON k.depcode = h.order_department
  LEFT JOIN patient p       ON p.hn = h.hn
 WHERE h.confirm_report = 'Y'
   AND h.report_date >= DATE(NOW() - INTERVAL @secs SECOND)
   AND TIMESTAMP(h.report_date, h.report_time) >= NOW() - INTERVAL @secs SECOND
 ORDER BY h.report_date, h.report_time
 LIMIT 500;

-- ─────────────────────────────────────────────────────────────
-- 2) ค่าวิกฤต (lab.critical) — 1 แถว = 1 รายการแล็บ = 1 แจ้งเตือน (ห้อง 🔴 ค่าวิกฤตแล็บ + แพทย์ผู้สั่ง)
--    ตัวเชื่อมดึงรายการของใบในข้อ 1 ที่ lab_items เปิด alert_critical_value='Y' และตั้ง critical_range_* ไว้
--    แล้วตัดสินในโปรแกรม: ผลต้องเป็นตัวเลขล้วน · เกณฑ์ตามเพศ (patient.sex = '2' หญิง, อื่นๆ ใช้เกณฑ์ชาย)
--    ต่ำกว่า min → "ต่ำ" · สูงกว่า max → "สูง" · ผลแบบ "<0.5", "Positive", ">1000" ไม่นับ
--    (ฟิลด์ critical_result ของ HOSxP เองไม่มีใครลง จึงคำนวณจากช่วงวิกฤตแทน)
--    คิวรีนี้เขียนการตัดสินเป็น SQL ให้ตรวจผลเทียบได้ — แถวที่ dir ไม่ว่าง = จะถูกแจ้ง
-- ─────────────────────────────────────────────────────────────
SELECT * FROM (
  SELECT o.lab_order_number AS no, h.hn, p.sex, d.name AS doctor,
         h.report_date, h.report_time,
         i.lab_items_code AS code, COALESCE(NULLIF(i.lab_items_display_name, ''), i.lab_items_name) AS item,
         o.lab_order_result AS result, i.lab_items_unit AS unit,
         IF(p.sex = '2', i.critical_range_min_female, i.critical_range_min_male) AS crit_min,
         IF(p.sex = '2', i.critical_range_max_female, i.critical_range_max_male) AS crit_max,
         CASE
           WHEN TRIM(o.lab_order_result) NOT REGEXP '^-?[0-9]+(\\.[0-9]+)?$' THEN NULL
           WHEN IF(p.sex = '2', i.critical_range_min_female, i.critical_range_min_male) IS NOT NULL
            AND TRIM(o.lab_order_result) + 0 < IF(p.sex = '2', i.critical_range_min_female, i.critical_range_min_male) THEN 'ต่ำ'
           WHEN IF(p.sex = '2', i.critical_range_max_female, i.critical_range_max_male) IS NOT NULL
            AND TRIM(o.lab_order_result) + 0 > IF(p.sex = '2', i.critical_range_max_female, i.critical_range_max_male) THEN 'สูง'
         END AS dir
    FROM lab_head h
    JOIN lab_order o          ON o.lab_order_number = h.lab_order_number
    JOIN lab_items i          ON i.lab_items_code = o.lab_items_code
    LEFT JOIN doctor d        ON d.code = h.doctor_code
    LEFT JOIN patient p       ON p.hn = h.hn
   WHERE h.confirm_report = 'Y'
     AND h.report_date >= DATE(NOW() - INTERVAL @secs SECOND)
     AND TIMESTAMP(h.report_date, h.report_time) >= NOW() - INTERVAL @secs SECOND
     AND i.alert_critical_value = 'Y'
     AND COALESCE(i.critical_range_min_male, i.critical_range_max_male,
                  i.critical_range_min_female, i.critical_range_max_female) IS NOT NULL
) x
 WHERE dir IS NOT NULL
 ORDER BY report_date, report_time;

-- ─────────────────────────────────────────────────────────────
-- 3) ตรวจเกณฑ์: รายการแล็บที่ตั้งค่าวิกฤตไว้ทั้งหมด (ถ้ารายการไหนควรแจ้งแต่ไม่อยู่ในนี้ = ต้องไปตั้งใน HOSxP)
-- ─────────────────────────────────────────────────────────────
SELECT i.lab_items_code, i.lab_items_name, i.lab_items_unit, i.alert_critical_value,
       i.critical_range_min_male, i.critical_range_max_male,
       i.critical_range_min_female, i.critical_range_max_female
  FROM lab_items i
 WHERE COALESCE(i.critical_range_min_male, i.critical_range_max_male,
                i.critical_range_min_female, i.critical_range_max_female) IS NOT NULL
 ORDER BY i.alert_critical_value DESC, i.lab_items_name;
