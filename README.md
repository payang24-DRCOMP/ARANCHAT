# AranChat

แชทภายในของเจ้าหน้าที่ รพ.อรัญ — แชทเข้ารหัส ข้อมูลอยู่บนเซิร์ฟเวอร์โรงพยาบาล พร้อมระบบแจ้งเตือนจาก HOSxP / AranKub

| โฟลเดอร์ | เนื้อหา |
| --- | --- |
| `server/` | ติดตั้งและดูแลเซิร์ฟเวอร์ (Matrix / ESS บน K3s), `notify/` บอทแจ้งเตือน + การ์ด + คำสั่ง / + webhook, `keyvault/`, `hosxp-bridge/`, แบรนด์, หน้าเอกสาร (`docs-site/`) — ดู `server/README.md` |
| `element-web/` | เว็บแชท + แอป Desktop (fork ของ [element-hq/element-web](https://github.com/element-hq/element-web)) — โค้ดของเราอยู่ที่ `apps/web/src/aranchat/`, `apps/web/res/css/aranchat/`, `aranchat/` |
| `element-x-android/` | แอป Android (fork ของ [element-hq/element-x-android](https://github.com/element-hq/element-x-android)) — โค้ดของเราอยู่ในไฟล์/โฟลเดอร์ชื่อ `aranchat` / `Aran*` |
| `element-x-ios/` | แอป iOS (ฐาน [element-hq/element-x-ios](https://github.com/element-hq/element-x-ios)) — ตั้งชื่อแอป/เซิร์ฟเวอร์ AranChat แล้ว ฟีเจอร์ยังต้อง port ตาม `element-x-ios/aranchat/PORTING.md` |
| `docs/DEVELOPMENT.md` | **คู่มือนักพัฒนา** — ภาพรวมระบบ สเปกข้อความที่ทุกแอปต้องรองรับ วิธี build/ปล่อย ข้อควรระวัง |

## ไม่อยู่ใน repo นี้ (ตั้งใจ)

- ความลับทั้งหมด: `*.env`, `secrets.env`, กุญแจ `*.pem` / `*.key`, keystore ที่ใช้เซ็นแอป Android (release)
- ข้อมูลระบบจริง: `*/data/` (รวม `keyvault/data` ที่เก็บกุญแจกู้คืนแชท), `state.json`, `rendered/`
- ประวัติ git ของ Element (fork ทำจาก element-web / element-x-android — ดูรุ่นตั้งต้นในประวัติ commit ของ fork บนเครื่อง build)

ไฟล์ลับต้องสำรองแยกไว้ที่ปลอดภัย (ไม่ใช่ git): `server/keyvault/.env` (`KEYVAULT_SECRET`), `server/notify/.env`, `server/secrets.env`, `secrets/vapid_private_key.pem`, keystore ของแอป Android

## สัญญาอนุญาต

`element-web/` และ `element-x-android/` เป็นงานดัดแปลงจากโค้ด AGPL-3.0 ของ Element — ส่วนที่แก้ไขเผยแพร่ภายใต้ AGPL-3.0 เช่นกัน
