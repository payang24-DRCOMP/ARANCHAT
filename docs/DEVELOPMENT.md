# คู่มือนักพัฒนา AranChat (ทีม DRCOMP)

## ภาพรวม

```
ผู้ใช้ (เว็บ / Desktop / Android / iOS)
        │  Matrix (เข้ารหัสต้นทางถึงปลายทาง)
        ▼
chat.arankub.com ──► K3s บนเครื่องเซิร์ฟเวอร์ รพ. (ESS Community: Synapse + MAS + Element Web + LiveKit)
        │
        ├─ notify (pm2 "aranchat-notify")   บอท @aranchat: แจ้งเตือน การ์ด ปุ่ม คำสั่ง / ลิงก์ชวน  ← AranKub / P4P / HOSxP / ระบบอื่น (POST /api/notify)
        ├─ keyvault (pm2)                   ฝากกุญแจกู้คืนแชทของผู้ใช้
        ├─ hosxp-bridge (pm2)               อ่าน HOSxP → ค่าวิกฤตแล็บ → notify
        └─ sygnal (K3s)                     push ไป Android (FCM) / เว็บ (Web Push) / iOS (APNs — ยังไม่ตั้ง)
เข้าระบบ: MAS → AranKub (OIDC) บัญชีเดียวกับ AranKub
```

| โฟลเดอร์ | เทคโนโลยี | เริ่มอ่านที่ |
| --- | --- | --- |
| `server/` | bash + K3s/Helm (ESS) · Node.js 20 (notify, keyvault, hosxp-bridge) | `server/README.md` · สคริปต์เรียงเลข `server/scripts/NN-*.sh` |
| `element-web/` | TypeScript + React (pnpm/nx) · Electron (Desktop) | โค้ดเรา: `apps/web/src/aranchat/`, `apps/web/res/css/aranchat/`, `aranchat/build-desktop.sh` |
| `element-x-android/` | Kotlin + Jetpack Compose · matrix-rust-sdk | `aranchat/` (แบรนด์ + build), ไฟล์ชื่อ `Aran*` |
| `element-x-ios/` | Swift + SwiftUI · matrix-rust-sdk | **`element-x-ios/aranchat/PORTING.md`** (ยังไม่ได้ port ฟีเจอร์ — ตั้งแบรนด์/เซิร์ฟเวอร์ไว้แล้ว) |

ค้นหาโค้ดของ AranChat ใน fork: `grep -rn "AranChat\|aranchat\|com.arankub"` — ทุกจุดที่แก้มีคอมเมนต์ภาษาไทยขึ้นต้น "AranChat"

## รูปแบบข้อความที่ทุกแอปต้องรองรับ (สเปกกลาง)

| ฟีเจอร์ | Matrix | สเปก / อ้างอิง |
| --- | --- | --- |
| การ์ดแจ้งเตือน + ปุ่ม | `content["com.arankub.card"]` · กดปุ่ม = ข้อความตอบกลับ + `com.arankub.card_action` · รับทราบ = reaction `✅ รับทราบ` | `server/notify/cardkit.mjs` · https://chat.arankub.com/connect/bot/ |
| คำสั่ง / เมนูบอท ปุ่มตอบด่วน | `GET /api/notify/bot` · `com.arankub.quick_replies` | `server/notify/server.mjs` (คำสั่ง / และเมนูบอท) |
| สติกเกอร์ | `m.sticker` · account data `com.arankub.stickers` | `element-web/apps/web/src/aranchat/stickers.ts` |
| โน้ต / อัลบั้ม | state `com.arankub.note` / `com.arankub.album` + ข้อความเข้ารหัส | `element-web/apps/web/src/aranchat/groupBoard.ts` |
| แนะนำเพื่อน | `com.arankub.contact` | `element-web/apps/web/src/aranchat/AranContact.tsx` |
| กุญแจกู้คืน | `/api/keyvault/{get,put,allow-reset}` + OpenID | `server/keyvault/server.mjs` |
| ลิงก์ชวน / QR | `/i/<รหัส>` · `/api/notify/invite` | `server/notify/invites.mjs` |

## Build

| อะไร | คำสั่ง | หมายเหตุ |
| --- | --- | --- |
| เว็บ | `cd element-web/apps/web && pnpm install && pnpm build` → `webapp/` | ขึ้นจริง: `server/scripts/14-web-beta.sh beta` (ทดสอบ) / `live` |
| Desktop | `element-web/aranchat/build-desktop.sh linux` / `win` | win build ใน Docker (wine) · เลขรุ่นใน `apps/desktop/package.json` |
| Android | `element-x-android/aranchat/build.sh :app:assembleGplayRelease` | ต้องมีกุญแจเซ็น `secrets/aranchat-release.env` (ไม่อยู่ใน git) · เลขรุ่น `plugins/src/main/kotlin/Versions.kt` |
| iOS | Mac + Xcode: `swift run tools setup-project` → `xcodegen` | ใส่ `DEVELOPMENT_TEAM` ใน `app.yml` · submodule `Enterprise` เป็นของ Element (ส่วนตัว) ไม่ต้องใช้ |
| ปล่อยแอป + แจ้งอัปเดตทุกคน | `server/scripts/18-publish-apps.sh desktop android --announce "มีอะไรใหม่"` | เขียน `latest.json` ที่แอปใช้ตรวจรุ่น |
| ภาษาไทยเว็บ | แก้ `server/i18n/element-th-*.tsv` → `server/scripts/11-thai.sh` | ตรวจตัวแปร/แท็กให้อัตโนมัติ |

## เครื่องทดสอบ (ไม่แตะระบบจริง)
Synapse ทดสอบใน Docker ที่ `127.0.0.1:18008` (`aranchat.test`) + เว็บที่ build แล้ว `127.0.0.1:18080` — สคริปต์อยู่บนเครื่อง build (`~/aranchat-apps/testenv`, ไม่อยู่ใน git เพราะมี token ทดสอบ) · notify รันกับเครื่องทดสอบได้โดยใช้ฐานข้อมูลจำลอง

## ข้อควรระวัง
- **ข้อมูลผู้ป่วย (PDPA):** การ์ด/แจ้งเตือนใช้ HN ห้ามใส่ชื่อผู้ป่วย · แชทกลุ่มเข้ารหัส · ห้องบอทไม่เข้ารหัส (บอทต้องอ่านคำสั่งได้)
- **ความลับไม่อยู่ใน git:** `*.env`, `secrets.env`, กุญแจ `*.pem`, `keyvault/data` (กุญแจกู้คืนของทุกคน), keystore Android — สำรองแยกไว้ที่ปลอดภัย
- notify บนเครื่องจริงอ่านไฟล์จาก `~/aranchat-ess/notify` โดยตรง — แก้ไฟล์แล้ว restart (`pm2 restart aranchat-notify`) = ขึ้นจริงทันที
- อัปเดต Element ต้นฉบับ: merge ทีละรุ่น แล้วทดสอบหน้าจอ AranChat (การ์ด แถบเมนู หน้าจอมือถือ ธีมมืด) ทุกครั้ง
