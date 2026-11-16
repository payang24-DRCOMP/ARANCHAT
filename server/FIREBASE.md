# แจ้งเตือนเด้งบนแอป AranChat Android (Firebase)

แอป Android จะเด้งแจ้งเตือนตอนปิดแอปได้ ต้องส่งผ่าน Firebase Cloud Messaging (FCM) ของ Google เท่านั้น
ใช้ของ Element ไม่ได้ เพราะ Firebase ผูกกับรหัสแอป (`com.arankub.aranchat`) และกุญแจของเจ้าของแอป จึงต้องมีโปรเจกต์ของโรงพยาบาลเอง (ฟรี)

```
ข้อความใหม่ → Synapse → Sygnal (ในเครื่องเรา, scripts/16-push.sh) → Firebase → มือถือ
```

## ขั้นตอน (ทำครั้งเดียว ประมาณ 10 นาที)

1. เข้า https://console.firebase.google.com ด้วยบัญชี Google ของโรงพยาบาล (ควรใช้บัญชีกลาง ไม่ใช่บัญชีส่วนตัว)
2. **Create a project** → ตั้งชื่อ เช่น `aranchat` → ปิด Google Analytics ได้ (ไม่ต้องใช้) → Create
3. หน้าโปรเจกต์ → ไอคอน **Android** (Add app)
   - Android package name: `com.arankub.aranchat`
   - App nickname: `AranChat`
   - SHA-1: เว้นว่าง
   - **Register app** → **Download google-services.json** → Next จนจบ (ข้ามขั้นแก้โค้ดได้)
4. (ไม่บังคับ) เพิ่มแอป Android อีกตัว package `com.arankub.aranchat.debug` สำหรับตัวทดสอบ แล้วดาวน์โหลด google-services.json **ใหม่** (ไฟล์เดียวมีทั้ง 2 แอป)
5. ⚙️ **Project settings** → แท็บ **Service accounts** → **Generate new private key** → ได้ไฟล์ `.json` อีกไฟล์
   - ⚠️ ไฟล์นี้เป็น**ความลับ** (ใครได้ไปส่งแจ้งเตือนในนามแอปเราได้) ห้ามส่งในแชท/อีเมล — คัดลอกเข้าเครื่อง server โดยตรง
6. วางไฟล์ทั้ง 2 ไว้ที่ `~/aranchat-apps/secrets/` บนเครื่อง server:
   - `google-services.json` (ไม่ใช่ความลับ — ฝังในแอปอยู่แล้ว)
   - `firebase-service-account.json` (ความลับ)

## ฝั่งผู้ดูแลระบบ (หลังได้ไฟล์)

```bash
chmod 600 ~/aranchat-apps/secrets/*.json
~/aranchat-ess/scripts/16-push.sh ~/aranchat-apps/secrets/firebase-service-account.json   # ติดตั้ง Sygnal + ทดสอบ
cd ~/aranchat-apps/element-x-android
python3 -I aranchat/apply-firebase.py ~/aranchat-apps/secrets/google-services.json
./aranchat/build.sh :app:assembleGplayRelease                                              # แอปตัวจริง มีแจ้งเตือน
```

แอปตัวใหม่ใช้รหัสแอปและกุญแจเซ็นเดิม → ติดตั้ง**ทับ**ตัวเดิมได้ ไม่ต้องลบ ไม่ต้องล็อกอินใหม่

## กุญแจเซ็นแอป (สร้างแล้ว 2026-11-09)

- `~/aranchat-apps/secrets/aranchat-release.jks` + รหัสผ่านใน `aranchat-release.env`
- **สำรอง 2 ไฟล์นี้ไว้นอกเครื่อง server** (USB ที่เก็บในตู้ล็อก / ที่เก็บรหัสผ่านของหน่วยงาน)
- ถ้าหาย: ออกแอปเวอร์ชันใหม่ทับเครื่องเดิมไม่ได้ ทุกคนต้องลบแอปแล้วติดตั้งใหม่
- SHA-256 ของกุญแจ: `AD:0E:89:24:9B:E4:6E:ED:73:CC:8E:F6:D3:56:A8:94:9B:76:75:4C:64:78:5B:5B:BB:E6:7C:CF:F2:68:9F:E7`
