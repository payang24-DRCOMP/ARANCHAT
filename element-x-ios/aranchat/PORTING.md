# AranChat iOS — คู่มือ port จาก Android

ฐานโค้ด: Element X iOS (`element-hq/element-x-ios`, commit `93b0747` "Update the SDK to 26.11.16") — ฐานเดียวกับแอป Android (`element-x-android`)
ทั้งสองใช้ `matrix-rust-sdk` ชุดเดียวกัน ฟีเจอร์ AranChat จึง port ได้ตรงตัว: ทุกอย่างเป็น **รูปแบบข้อความ Matrix + HTTP API ของเซิร์ฟเวอร์เรา** ไม่มีอะไรผูกกับ Android

> build ต้องใช้ Mac + Xcode (เครื่องเซิร์ฟเวอร์ Linux ของ รพ. build iOS ไม่ได้) · ดู `README.md` ของ Element X iOS สำหรับ XcodeGen / SPM

## ทำไว้แล้วในโฟลเดอร์นี้

| ไฟล์ | ค่า |
| --- | --- |
| `app.yml` | `APP_DISPLAY_NAME`/`PRODUCTION_APP_NAME` = AranChat · `BASE_BUNDLE_IDENTIFIER` = `com.arankub.aranchat` · `APP_GROUP_IDENTIFIER` = `group.com.arankub.aranchat` · **`DEVELOPMENT_TEAM` = `CHANGE_ME` (ใส่ Team ID ของหน่วยงาน)** |
| `ElementX/Sources/Application/Settings/AppSettings.swift` | ล็อกเซิร์ฟเวอร์ `arankub.com` / `https://matrix.arankub.com` · ห้ามเลือกเซิร์ฟเวอร์อื่น · push gateway `https://matrix.arankub.com` |

ค่าแบรนด์ทั้งหมดอยู่ที่ `element-x-android/aranchat/brand.env` (ชื่อแอป สี `#5B3FD9` ไอคอน `aranchat/icon.png` ลิงก์ข้อตกลง/นโยบาย) — ใช้ชุดเดียวกัน

## สถานะการ port (17 พ.ย. 2569) — ⚠️ ยังไม่เคย build (เขียนบนเครื่อง Linux ไม่มี Xcode)

เปิดโปรเจกต์บน Mac แล้วรัน `xcodegen` ก่อน (ไฟล์ใหม่จะถูกเพิ่มเข้า target อัตโนมัติ) แล้ว build แก้ error ที่เหลือ

| ฟีเจอร์ | สถานะ | ไฟล์ |
| --- | --- | --- |
| แบรนด์ + ล็อกเซิร์ฟเวอร์ + push gateway | ✅ ตั้งค่าแล้ว | `app.yml`, `AppSettings.swift` |
| การ์ดแจ้งเตือน: แสดงผล (หัวตามระดับ ช่องข้อมูลมีสี ตาราง ขั้นตอน ตัวเลขสรุป ผลการตัดสิน) | ✅ เขียนแล้ว | `Services/AranChat/AranCard.swift`, `Screens/Timeline/View/TimelineItemViews/AranCardView.swift`, hook ใน `RoomTimelineItemFactory.buildTextTimelineItem` + `TextRoomTimelineView` + `TextRoomTimelineItemContent.aranCard` |
| การ์ด: ปุ่มลิงก์ / คัดลอก / รับทราบ | ✅ เขียนแล้ว | `AranCardView.swift` (รับทราบ = `.toggleReaction`) |
| การ์ด: ปุ่มสั่งงาน / เลือกวันเวลา | ✅ เขียนแล้ว (ถามยืนยัน · ปฏิทิน ค.ศ. ตาม min/max · "กำลังส่ง…" 20 วิ) | `AranCardView.swift`, `TimelineViewModel.sendAranCardAction`, `JoinedRoomProxy.sendRawMessage` |
| แชร์ตำแหน่ง (แผนที่ของ รพ. เอง) | ✅ ตั้งค่าแล้ว — `bundledMapTilerConfiguration` ชี้ `https://chat.arankub.com/maps` (server แผนที่: `server/maps/README.md`, รูปแบบ URL เดียวกับ MapTiler) · ⏳ ทดสอบบนเครื่องจริง | `AppSettings.swift` |
| keyvault | ✅ ทำงานแล้ว (ลำดับเดียวกับ Android · เริ่มจาก `ClientProxy.init` · ทดสอบกับ server จริง: get 200) | `Services/AranChat/AranKeyvault.swift` |
| มินิแอป (OpenID ใน fragment) | ✅ แนบ token แล้ว (เมนูบอท + ปุ่มการ์ด) | `AranBot.swift` `AranBotAPI.miniAppURL` · ข้อ F |
| บอท: คำสั่ง / เมนู / ปุ่มตอบด่วน + มินิแอป | ✅ ทดสอบแล้ว | `Services/AranChat/AranBot.swift` · แถบอยู่เหนือช่องพิมพ์ (`RoomScreen.composer`) · มินิแอปส่ง OpenID ใน fragment (ข้อ F) · คำสั่ง /xxx ส่งเป็นข้อความธรรมดาอยู่แล้ว (iOS ตีความแค่ /join /me) |
| สติกเกอร์ | ✅ ทดสอบแล้ว (ส่งได้) | `Services/AranChat/AranStickers.swift` · เมนู + → สติกเกอร์ · ส่งในเธรดได้ · ชุดจาก server (แคช index ไว้ใช้ออฟไลน์ — ยังไม่มีชุดในแอป) |
| แท็บเพื่อน (แทน Spaces) + ปุ่มชวนเพื่อน · การ์ดแนะนำเพื่อน · QR โค้ดของฉัน | ✅ build ผ่าน (รอทดสอบ) | `Screens/AranFriends/` (`AranFriendsScreen.swift`, `AranContact.swift` — เมนู + → แนะนำเพื่อน, `AranMyQRSheet.swift` — ตั้งค่า → QR โค้ดของฉัน) · ยังไม่ทำ: เปิดลิงก์ชวน /i/<รหัส> ในแอป (ต้องมี Universal Link = Apple Developer) |
| ซ่อนหน้า "ยืนยันตัวตน" หลังล็อกอิน + แถบตั้งกุญแจกู้คืน | ✅ | `OnboardingFlowCoordinator.requiresVerification`, `HomeScreenViewModel` (เหมือน Android — keyvault จัดการให้) |
| ภาษาไทย | ✅ | `th.lproj` จาก Android (`aranchat/i18n-th.py`) · ตั้งค่า > ภาษา / Language → หน้า iOS ของแอป (เลือกภาษาต่อแอป) |
| โน้ต/อัลบั้มในกลุ่ม | ✅ build ผ่าน (รอทดสอบ) | `Services/AranChat/AranBoard.swift`, `Screens/AranBoard/AranBoardSheet.swift` · เมนู + → โน้ต / อัลบั้ม · การ์ดในแชท · เพิ่มรูปในแผงได้ · แตะรูป = เปิดเธรดของอัลบั้ม (ดูรูปเต็ม) |
| ถอดเสียง | ✅ build ผ่าน (รอทดสอบ) | `Screens/Timeline/View/TimelineItemViews/AranTranscribeView.swift` · ปุ่ม "🎙 ถอดเป็นข้อความ" ใต้ข้อความเสียง/ไฟล์เสียง (รวมไฟล์เสียงที่ส่งเป็น m.file) · ≤ 25 MB: `POST /api/notify/asr` + header `X-AranChat-OpenID` · > 25 MB (ประชุม): ปุ่ม "📝 ส่งให้บอทถอด + สรุปประชุม" → ถอดรหัสในเครื่องแล้วส่ง m.audio (มี duration) เข้าแชทบอท (ไม่เข้ารหัส, ≤ 200 MB) |
| จดประชุม (ถอดเสียงสด + สรุป) | ⬜ ยังไม่ทำ — ดูข้อ K | Android: `aranchat/AranMeeting.kt`, `AranMeetingSheet.kt` · เว็บ: `src/aranchat/meeting.ts`, `AranMeeting.tsx` |

## ลำดับที่แนะนำ

1. **เข้าระบบได้ + แจ้งเตือนเด้ง** (ข้อ A, B) — ใช้งานพื้นฐานได้ทันที
2. **กุญแจแชท keyvault** (ข้อ C) — สำคัญมาก: ไม่ทำ = ผู้ใช้เปลี่ยนเครื่องแล้วอ่านแชทเข้ารหัสเก่าไม่ได้
3. **การ์ดแจ้งเตือน + ปุ่ม** (ข้อ D) — งานหลักของ รพ. (ค่าวิกฤตแล็บ อนุมัติงาน)
4. ที่เหลือ (E–J) ตามความสำคัญ

---

### A. เข้าระบบ (OIDC ผ่าน MAS → AranKub)
- Element X iOS รองรับ OIDC อยู่แล้ว — ตั้ง client metadata ให้ตรงกับ Android: `WEBSITE_URL=https://arankub.com`, `TERMS_URL`, `PRIVACY_URL` (MAS บังคับให้อยู่โดเมนเดียวกัน ไม่งั้น "client registration denied by the policy")
- redirect URI ต้องขึ้นต้นด้วยโดเมนกลับด้าน (`com.arankub.aranchat:/…`)

### B. แจ้งเตือน (APNs ผ่าน Sygnal ของเรา)
- `pusherAppID` = `com.arankub.aranchat.ios.prod` (ดู `AppSettings.pusherAppID`)
- เพิ่ม app นี้ใน Sygnal (`aranchat-ess/sygnal`, `scripts/16-push.sh`) แบบ `type: apns` พร้อมกุญแจ APNs (.p8) จากบัญชี Apple Developer
- NSE (Notification Service Extension) ของ Element X ถอดรหัสข้อความเข้ารหัสให้อยู่แล้ว — ตั้ง App Group ให้ตรงกับ `app.yml`

### C. ฝากกุญแจกู้คืนแชท (keyvault) — Android: `features/enterprise/impl-foss/.../AranKeyvault.kt`
หลังเข้าระบบสำเร็จ แอปจัดการกุญแจกู้คืนให้เองโดยผู้ใช้ไม่ต้องจด:
- ที่อยู่: `.well-known/matrix/client` → `com.arankub.keyvault.url` (ค่าปัจจุบัน `https://chat.arankub.com/api/keyvault`)
- ทุกคำขอส่ง `{"openid": <ผลจาก POST /_matrix/client/v3/user/{userId}/openid/request_token>}`
- `POST …/get` → `200 {recovery_key}` = กู้คืนด้วยกุญแจนี้ · **`404` ที่ body เป็น `{"error":"none"}` เท่านั้น = ยังไม่มีกุญแจ** (404 แบบอื่น = ระบบยังไม่พร้อม ห้ามตีความว่าไม่มีกุญแจ ไม่งั้นจะรีเซ็ตตัวตนผิด)
- ยังไม่มีกุญแจ → เปิด backup/recovery ด้วย SDK → `POST …/put {recovery_key}`
- กุญแจใช้ไม่ได้ / ตัวตนเก่าไม่มีใครถือกุญแจ → `POST …/allow-reset` → รีเซ็ตตัวตน → `put {recovery_key, replace: true}`
- ซ่อนหน้าจอ "ตั้งกุญแจกู้คืน / ยืนยันอุปกรณ์" ที่ไม่จำเป็น (Android ทำใน `DefaultSessionEnterpriseService.kt`)

### D. การ์ดแจ้งเตือน — Android: `timeline/model/event/AranCard.kt`, `TimelineItemAranCardView.kt`, `aranchat/AranCardSender.kt`
- ข้อความ `m.text` จากบอท `@aranchat:arankub.com` ที่มี `content["com.arankub.card"]` → แสดงเป็นการ์ดแทนข้อความ (อ่านการ์ดเฉพาะข้อความจากบอท)
- รูปแบบเต็ม + ตัวอย่าง: `server/notify/cardkit.mjs` และหน้าเอกสาร https://chat.arankub.com/connect/bot/ · แม่แบบ: `server/notify/templates/examples.json`
- ช่องหลัก: `system topic icon title subtitle urgent level color image(mxc) fields[[k,v,tone]] lines sections[] buttons[] status{text,tone} closed note`
- `sections`: `text` · `fields` · `table{columns,rows,tones}` · `steps{items[{label,time,state}]}` · `stats{items[{label,value,tone}]}`
- โทนสี: `crit` แดง ‼ · `high` ส้ม ↑ · `low` น้ำเงิน ↓ · `ok` เขียว · `muted` · ระดับหัวการ์ด: `info` `success` `warning` `critical` (`urgent` = แดง + ป้าย "ด่วน")
- **บอทแก้การ์ด (m.replace) เมื่อมีคนกดปุ่ม** → อ่านจาก `m.new_content` ของการแก้ไขล่าสุด (Android ใช้ `latestEditedJson`)
- ปุ่ม:
  - `link` เปิด URL · `copy` คัดลอก `text`
  - **รับทราบ** (`ack: true`): ส่ง reaction key `"✅ รับทราบ"` ที่ข้อความนั้น · แสดง "รับทราบแล้ว: ชื่อ…" จาก reaction
  - `action` (มี `confirm` = ถามยืนยันก่อน) และ `datetime` (`mode` date/time/datetime, `min` `max` `initial`): ส่ง
    ```json
    { "msgtype": "m.text", "body": "<label>[: <value>]",
      "m.relates_to": { "m.in_reply_to": { "event_id": "<การ์ด>" } },
      "com.arankub.card_action": { "event_id": "<การ์ด>", "id": "<button id>", "value": "2026-11-20T08:30" } }
    ```
  - `app` มินิแอป → ข้อ F
- ซ่อนปุ่ม action/datetime เมื่อ `closed: true` · การ์ดพื้นขาวเสมอ (ทั้งธีมสว่าง/มืด)

### E. บอท: คำสั่ง / · เมนู · ปุ่มตอบด่วน — Android: `aranchat/AranBot.kt`
- รายการคำสั่ง + เมนู: `GET https://chat.arankub.com/api/notify/bot` (สาธารณะ) → `{commands:[{command,description,usage}], menu:[{label,type:text|link|app,text,url,prefill}]}`
- ใช้เฉพาะห้องที่บอทเป็นสมาชิก (แชทกับ "ARANKUB AI" / ห้องแจ้งเตือน — ห้องเหล่านี้ไม่เข้ารหัส)
- พิมพ์ `/lab 0012345` ในห้องบอท → **ส่งเป็นข้อความธรรมดา** (อย่าให้ตัวแยกคำสั่งของแอปตีว่าไม่รู้จักคำสั่ง)
- ปุ่มตอบด่วน: ข้อความล่าสุดในห้องมาจากบอทและมี `content["com.arankub.quick_replies"] = [{label,text,prefill}]` → แสดงชิปเหนือช่องพิมพ์ · `prefill` = ใส่ลงช่องพิมพ์แทนการส่ง

### F. มินิแอป
- เปิด `url` ในเบราว์เซอร์ในแอป (SFSafariViewController) พร้อม fragment `#aranchat_openid=<openid access_token>&aranchat_server=<matrix_server_name>`
- ระบบหลังบ้านตรวจด้วย `POST /api/notify/miniapp/whoami` (ใช้ key ของระบบ) — แอปไม่ต้องทำอะไรเพิ่ม

### G. สติกเกอร์ — Android: `messagecomposer/AranStickers.kt`
- ชุดสติกเกอร์: `GET https://chat.arankub.com/stickers/index.json` (แคชไว้ใช้ออฟไลน์) + ชุดพื้นฐานในแอป (`res/aranchat-stickers` ของเว็บ)
- ส่งเป็น `m.sticker` มาตรฐาน · ภาพเคลื่อนไหวใส่ `info["org.matrix.msc4230.is_animated"] = true`
- อัปโหลดครั้งแรกแล้วจำ mxc ใน account data `com.arankub.stickers` = `{ mxc: {"<id>@<size>" หรือ "<ชุด>/<id>@<size>": mxc}, recent: ["<ชุด>/<id>"] }` (ใช้ร่วมกับเว็บ/Android — อ่านซ้ำก่อนเขียนทุกครั้ง)

### H. โน้ต / อัลบั้มในกลุ่ม — Android: `aranchat/AranBoard.kt`, `AranBoardSheet.kt`
- ดัชนี: state event `com.arankub.note` / `com.arankub.album` (`state_key` = id, content `{event_id, created_by, created_ts, updated_ts}` · ลบ = `{}`)
- เนื้อหาอยู่ในข้อความเข้ารหัส: โน้ต = body `"📝 โน้ต\n<ข้อความ>"` + `{"com.arankub.note": {"id"}}` (แก้ไข = m.replace body เต็ม) · อัลบั้ม = body `"🖼 อัลบั้ม: <ชื่อ>"` + `{"com.arankub.album": {"id"}}` · รูปในอัลบั้ม = ส่งในเธรดของข้อความอัลบั้ม

### I. เพื่อน / ข้อมูลติดต่อ / ลิงก์ชวน — Android: `home/.../friends/AranFriends.kt`, `AranContact.kt`, `libraries/matrixui/.../aranchat/AranInviteLink.kt`
- การ์ดแนะนำเพื่อน: body ขึ้นต้น `"👤 "` + `content["com.arankub.contact"]`
- ลิงก์ชวน `https://chat.arankub.com/i/<รหัส 8 ตัว>` (Universal Link — เพิ่ม `apple-app-site-association` ที่ `chat.arankub.com/.well-known/` คู่กับ `assetlinks.json` ของ Android) → `POST https://chat.arankub.com/api/notify/invite/<รหัส>/accept {openid}` → เข้าห้อง/เพิ่มเพื่อน
- QR โค้ดของฉัน (ตั้งค่า): `POST …/api/notify/invite {openid}` → ลิงก์ชวนส่วนตัว


### K. จดประชุม (ถอดเสียงสด + สรุปการประชุม) — Android: `aranchat/AranMeeting.kt` (service) + `AranMeetingSheet.kt` (หน้าจอ)
- ทางเข้า: เมนู + ในห้องแชท → "จดประชุม (ถอดเสียง + สรุป)" (ไม่แสดงในเธรด) · บอทมีคำสั่ง `/meeting` อธิบายวิธีใช้
- เสียง: `AVAudioEngine` input tap → แปลงเป็น **PCM16 little-endian · 16 kHz · mono** (`AVAudioConverter`) ส่งก้อนละ ~200 ms (6400 bytes)
  - `AVAudioSession` category `.playAndRecord`/`.record`, mode `.measurement` (ไม่ตัดเสียงเบา/ไกล — ไมค์วางกลางโต๊ะ)
  - **Background**: เปิด `UIBackgroundModes: audio` ใน `app.yml` (ไม่งั้นล็อกจอแล้วหยุดบันทึก) · `NSMicrophoneUsageDescription` มีอยู่แล้ว (ข้อความเสียง)
- WS `wss://chat.<เซิร์ฟเวอร์>/api/notify/meeting/live` (`URLSessionWebSocketTask`)
  1. ส่ง text JSON `{"type":"start","openid":"<OpenID access_token>","title":"…","captions":true}`
     - ต่อใหม่หลังเน็ตหลุด: `{"type":"resume","openid":"<token ใหม่>","session":"<id จาก ready>"}` — **ขอ OpenID token ใหม่ทุกครั้งที่ต่อ** (หมดอายุ 1 ชม.)
  2. รอ `{"type":"ready","session","captions":bool,"note"?}` แล้วส่งเสียงเป็น binary message
  3. รับ `partial` {text} (ข้อความที่กำลังพูด) · `final` {text,start,end} (จบประโยค) · `level` {seconds} (ทุก 5 วิ) · `error` {message}
  4. จบ: ส่ง text `end` → ได้ `processing` แล้ว server ปิดสาย · ผลบทถอดเต็ม (ไฟล์ .txt) + สรุป ส่งเข้าแชท ARANKUB AI เอง
  - ส่ง text `ping` ได้ (ตอบ `pong`) — หรือใช้ `sendPing` ของ URLSession ทุก 25 วิ
- เน็ตหลุด: เก็บก้อนเสียงในคิว (≤ ~30 นาที = 9000 ก้อน) → ต่อใหม่ (หน่วง 1,2,4,8,15 วิ) ด้วย resume → ส่งที่ค้างก่อนเสียงใหม่
  - `error` ที่ข้อความมีคำว่า "ปิดไปแล้ว" ตอน resume = server รีสตาร์ท → ล้าง session แล้ว start ใหม่ (ชื่อเดิม) ต่อเลย
  - `error` ก่อนได้ ready ครั้งแรก = ผิดถาวร (token ผิด / เต็ม) → หยุดและแสดงข้อความ
- หน้าจอ: ชื่อการประชุม (ค่าเริ่มต้น "ประชุม <ชื่อกลุ่ม> <วันที่>" · แชทส่วนตัวไม่ใส่ชื่อห้อง) · สวิตช์ "แสดงข้อความสด" ·
  ระหว่างบันทึก: จุดแดง เวลา แถบระดับเสียง สถานะ (กำลังฟัง/เน็ตหลุด/พัก/บันทึกอย่างเดียว) รายการข้อความสด ปุ่ม พัก/บันทึกต่อ และ จบประชุม (ถามยืนยัน)
  - ปิดหน้าได้ การบันทึกยังทำต่อ · เปิดเมนูอีกครั้ง = กลับมาหน้าเดิม · มีได้ทีละการประชุมต่อเครื่อง
  - พัก = หยุดส่งเสียง (ไม่ต้องบอก server)
  - ข้อความเตือน: "แจ้งผู้เข้าประชุมว่ากำลังบันทึก · หลีกเลี่ยงการเอ่ยชื่อ/เลขประจำตัวผู้ป่วย · เสียงลบทิ้งเมื่อถอดเสร็จ"
- iOS เก็บเสียงจากแอปอื่น (Zoom) ไม่ได้ — ใช้ไมค์อย่างเดียว (ประชุม Zoom ให้ใช้แอป Desktop บน Windows)

### J. อื่นๆ
- ภาษาไทย: Element X iOS มีคำแปลไทยจาก Localazy อยู่แล้ว · ข้อความใหม่ของ AranChat ใช้ชุดคำเดียวกับ Android (`values-th/aranchat_th.xml`) และเว็บ
- อัปเดตแอป: iOS ใช้ TestFlight / App Store (Android ใช้ `latest.json` + ดาวน์โหลด APK เอง — ไม่ใช้กับ iOS)
- ปิดการส่งข้อมูลการใช้งานไป Element (Posthog/Sentry) เหมือน Android (`appconfig/ApplicationConfig.kt`)
- ข้อมูลผู้ป่วย: แสดง HN ไม่แสดงชื่อ (PDPA) — แอปแค่แสดงตามที่เซิร์ฟเวอร์ส่ง ไม่ต้องทำอะไรเพิ่ม

## อ้างอิงฝั่งเว็บ (ทำครบทุกฟีเจอร์ — ใช้เทียบพฤติกรรม)
`element-web/apps/web/src/aranchat/` — `AranCardBody.tsx` · `bot.ts` + `AranBot.tsx` · `stickers.ts` · `groupBoard.ts` + `AranBoard.tsx` · `AranContact.tsx` · `keyvault.ts`
