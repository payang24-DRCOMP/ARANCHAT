# AranChat — ชุดติดตั้งบน server AranKub (ESS Community)

แอปแชทภายใน รพ. บนฐาน **Element Server Suite Community** (Matrix)
ได้ครบ: แชท · สร้างกลุ่ม · แจ้งเตือนจากระบบ (webhook) · video call / ห้องประชุม · หน้าแอดมิน
ข้อมูลทั้งหมดเก็บบน server ของเราเอง

```
อินเทอร์เน็ต ──► Cloudflare Tunnel ──► localhost:8080 (Traefik ใน K3s) ──► แชท/login/แอดมิน
                       └─► localhost:3000 ──► AranKub เดิม (ไม่ถูกแตะ)
มือถือ ── video/เสียง ──► TCP 30001 / UDP 30002 (forward ตรงจาก router — ไม่ผ่าน Tunnel)
```

| ที่อยู่ | ใช้ทำอะไร |
|---|---|
| `https://chat.arankub.com` | เว็บแชท |
| `https://admin.arankub.com` | หน้าแอดมิน |
| `account.` / `matrix.` / `mrtc.arankub.com` | ระบบเบื้องหลัง (login, server, video call) |
| ชื่อผู้ใช้ | `@payang:arankub.com` |

```
aranchat-ess/
├── config.env               ← ตั้งค่าไว้สำหรับ arankub.com แล้ว
├── cloudflare/config.example.yml
├── scripts/  00-preflight → 08-check
└── values/   แม่แบบการตั้งค่า
```

---

## ขั้นที่ 1 — ส่งไฟล์ขึ้น server

จากเครื่อง Windows (PowerShell) หรือ Mac/Linux:

```bash
scp aranchat-ess.zip <user>@<IP-server-AranKub>:~/
ssh <user>@<IP-server-AranKub>
```

บน server:

```bash
sudo apt install -y unzip curl      # (Ubuntu/Debian) ถ้ายังไม่มี
unzip aranchat-ess.zip && cd aranchat-ess
chmod +x scripts/*.sh
```

หรือใช้ WinSCP / FileZilla ลากไฟล์ขึ้นไปก็ได้

## ขั้นที่ 2 — แก้ `config.env`

ตั้งค่าไว้ให้ `arankub.com` แล้ว เหลือ 2 ค่า:

- **`PUBLIC_IP`** — IP สาธารณะของ รพ. (สคริปต์ 00 จะบอกค่าที่ตรวจเจอ)
- **`TRAEFIK_HTTP_PORT`** — ถ้าพอร์ต 8080 ถูกใช้อยู่แล้ว (สคริปต์ 00 จะแจ้ง) ให้เปลี่ยนเป็นพอร์ตว่าง เช่น `8880`

> ⚠️ **ยืนยัน `SERVER_NAME="arankub.com"` ก่อนติดตั้ง** — เปลี่ยนภายหลังไม่ได้
> ถ้าในอนาคตจะย้ายไปใช้โดเมน รพ. (เช่น .go.th) ให้ตัดสินใจตอนนี้ ไม่งั้นต้องติดตั้งใหม่และผู้ใช้ต้องสร้างบัญชีใหม่หมด

## ขั้นที่ 3 — ติดตั้ง

```bash
./scripts/00-preflight.sh    # ตรวจ RAM, พอร์ตชน, IP
./scripts/01-k3s.sh          # ติดตั้ง K3s + Helm (ไม่กระทบ Docker/AranKub เดิม)
source ~/.bashrc
./scripts/02-tls.sh          # โหมด external: Cloudflare ทำ SSL ให้
./scripts/03-render.sh
./scripts/04-install.sh      # ครั้งแรกรอ 5–15 นาที
```

## ขั้นที่ 4 — ตั้งค่า Cloudflare Tunnel (tunnel เดิมของ AranKub)

### แบบ A: ตั้งค่าผ่านหน้าเว็บ (Zero Trust → Networks → Tunnels → tunnel ของ AranKub → Public Hostname)

เพิ่ม 6 รายการ ทุกรายการ Service = `HTTP` → `localhost:8080`

| Subdomain | Domain | Path |
|---|---|---|
| chat | arankub.com | (ว่าง) |
| matrix | arankub.com | (ว่าง) |
| account | arankub.com | (ว่าง) |
| mrtc | arankub.com | (ว่าง) |
| admin | arankub.com | (ว่าง) |
| *(ว่าง)* | arankub.com | `^/\.well-known/matrix/.*` |

**รายการสุดท้าย (well-known) ต้องลากขึ้นไปอยู่เหนือรายการ arankub.com เดิมของ AranKub** — Cloudflare ใช้กฎแรกที่ตรง ถ้าอยู่ล่าง แอปมือถือจะหา server ไม่เจอ

### แบบ B: ตั้งค่าในไฟล์ `/etc/cloudflared/config.yml`

ดูตัวอย่างใน `cloudflare/config.example.yml` แล้ว `sudo systemctl restart cloudflared`
และสร้าง DNS ให้ subdomain ใหม่: `cloudflared tunnel route dns <ชื่อ tunnel> chat.arankub.com` (ทำซ้ำทุกชื่อ)

### ตั้งค่า Cloudflare เพิ่ม 2 จุด

- **Network → WebSockets: เปิด** (แชท realtime และ video call ต้องใช้)
- **Rules: ปิด Rocket Loader / Auto Minify / cache** สำหรับ `*.arankub.com` ของแชท (ถ้าเคยเปิดไว้) เพื่อไม่ให้หน้าแชทเพี้ยน

## ขั้นที่ 5 — Forward พอร์ต video call

ที่ router/firewall ของ รพ. forward มาที่ IP ภายในของ server AranKub:

| พอร์ต | |
|---|---|
| TCP 30001 | video call สำรอง (เครือข่ายที่บล็อก UDP) |
| **UDP 30002** | video call หลัก |

ไม่ต้องเปิด 80/443 เพราะเว็บวิ่งผ่าน Tunnel อยู่แล้ว

## ขั้นที่ 6 — ตรวจและสร้างแอดมิน

```bash
./scripts/08-check.sh        # ตรวจทุกโดเมน + เว็บ AranKub เดิมยังปกติ
./scripts/05-admin.sh        # สร้างแอดมินคนแรก
```

ทดสอบ:
1. เปิด `https://chat.arankub.com` แล้ว login
2. มือถือ: ติดตั้ง **Element X** → เปลี่ยน server → `arankub.com` → login
3. ส่งข้อความจากเว็บ ดูว่ามือถือเด้งแจ้งเตือน
4. โทรวิดีโอ ทดสอบทั้ง Wi-Fi รพ. **และ 4G** (Wi-Fi ได้แต่ 4G ไม่ได้ = ตรวจ UDP 30002 / PUBLIC_IP)

## ขั้นที่ 7 — เพิ่มผู้ใช้ (ช่วงนำร่อง)

```bash
cp users.example.csv users.csv     # แก้รายชื่อ
./scripts/06-bulk-users.sh users.csv
```

## ขั้นที่ 8 — แจ้งเตือนจากระบบต่างๆ

1. สร้างห้อง เช่น `IT-Alert` → เชิญ `@hookshot:arankub.com` → ตั้งสิทธิ์ Moderator
2. พิมพ์ในห้อง: `!hookshot webhook server-alert`
3. bot ส่ง URL webhook มาในแชทส่วนตัว
4. ทดสอบ: `./scripts/07-notify-test.sh <URL>`

ส่งจากระบบใดก็ได้:

```bash
curl -X POST -H 'Content-Type: application/json' \
  -d '{"text":"⚠️ HosXP-DB CPU 95%"}' <WEBHOOK_URL>
```

```python
import requests
requests.post(WEBHOOK_URL, json={"text": "📋 เคลมถูกปฏิเสธ 3 ราย วันนี้"}, timeout=10)
```

```php
$ch = curl_init($webhookUrl);
curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
  CURLOPT_POSTFIELDS => json_encode(['text' => '🔔 คิวรอตรวจเกิน 50 คน'])]);
curl_exec($ch);
```

> เก็บ URL webhook เป็นความลับ ใครได้ URL ไปจะโพสต์เข้าห้องได้

### แจ้งเตือนรายบุคคล (AranChat Notify — `notify/`)

bot `@aranchat` "AranChat แจ้งเตือน" ส่งเข้าแชทส่วนตัวของแต่ละคน · รันบนเครื่อง host ด้วย pm2 (`aranchat-notify`)

| แหล่ง | ทำงานยังไง | ต้องแก้ระบบต้นทางไหม |
|---|---|---|
| AranKub กระดิ่ง (`notifications`) | อ่านแถวใหม่ทุก 15 วิ → ส่งให้เจ้าของแถว | ไม่ต้อง |
| P4P กระดิ่ง (`Notification`) | เหมือนกัน · จับคู่คนด้วย hash เลขบัตร / Provider ID | ไม่ต้อง |
| SOS ประชาชน (`emg_requests`) | ส่งเข้าห้อง `#sos` (@room) — ไม่ใส่ชื่อ/เบอร์/พิกัด ให้กดลิงก์ดู | ไม่ต้อง |
| cron ของ AranKub | `scripts/cron-guard.sh <ชื่อ> <คำสั่ง>` แจ้งตอนเพิ่งล้ม/กลับมาปกติ (ผู้รับ `CRON_NOTIFY_TO`) | ครอบใน crontab |
| ระบบอื่น (FastAPI, PHP) | `POST http://127.0.0.1:3210/send` | เพิ่มโค้ดเรียก |

ผู้ใช้เลือกเองว่าจะรับเรื่องไหน: พิมพ์ `ตั้งค่า` / `ปิด 3` / `เปิด 3` ในแชทกับ bot · ค่าเริ่มต้นและรายชื่อเรื่องอยู่ที่ `notify/events.mjs`

```bash
curl -X POST http://127.0.0.1:3210/send -H "Authorization: Bearer $NOTIFY_API_KEY" -H 'Content-Type: application/json' \
  -d '{"event":"nhso.sync","to":["arankub:<id ผู้ใช้ AranKub>"],"title":"ดึงข้อมูล สปสช. เสร็จแล้ว","text":"REP 12 ไฟล์","link":"https://arankub.com/dashboard/hospital/nhso"}'
```

- `notify/.env` (chmod 600): token bot, API key, ผู้รับ cron · ไม่คัดลอกรหัส DB — อ่าน `DATABASE_URL` จากไฟล์ env ของ AranKub/P4P
- ห้องแชทกับ bot ไม่เข้ารหัส → ส่งข้อความสั้น + ลิงก์ ไม่ใส่ข้อมูลผู้ป่วยละเอียด
- แจ้งเตือนส่งเป็นรูปการ์ด (`notify/card.mjs`, ฟอนต์ Sarabun ใน `notify/fonts/`) + คำบรรยายมีลิงก์ · วาดการ์ดไม่ได้จะส่งเป็นข้อความแทน · สีประจำระบบแก้ที่ `THEMES`
- สร้างบัญชีแชทล่วงหน้า (ผูก AranKub แล้ว): `./scripts/12-provision-users.sh users.tsv`

## Login ด้วยบัญชี AranKub (ศูนย์ผู้ใช้แหล่งเดียว)

AranKub เป็นผู้ยืนยันตัวตน (OIDC provider) ให้แชท — ผู้ใช้ login ด้วยวิธีเดิมของ AranKub
(รหัสผ่าน+OTP / Provider ID / ThaID) ไม่มีรหัสผ่านแชทแยก · ระงับบัญชีที่ AranKub = login แชทใหม่ไม่ได้

| เรื่อง | กติกา |
|---|---|
| username (`@xxx:arankub.com`) | ผู้ใช้ตั้งเองตอนเข้าครั้งแรก (มีอีเมลจริงจะมีค่าเสนอให้) — **เปลี่ยนภายหลังไม่ได้** |
| ชื่อที่แสดง | ชื่อจริงจาก AranKub บังคับ ผู้ใช้แก้เองไม่ได้ (แอดมินแก้ได้) |
| ใครเข้าได้ | บัญชี AranKub ที่สถานะ active เท่านั้น |

ขั้นตอน:
1. `./scripts/10-arankub-sso.sh` → ได้ `secrets.env` และค่า `OIDC_*` 3 บรรทัด → เพิ่มใน `.env.local` ของ AranKub แล้ว deploy AranKub
2. ตรวจ: `curl https://arankub.com/.well-known/openid-configuration` ต้องได้ JSON
3. `./scripts/03-render.sh && ./scripts/04-install.sh` → หน้า login แชทมีปุ่ม "บัญชี AranKub"
4. ทดสอบผ่านแล้วตั้ง `SSO_ONLY="true"` ใน `config.env` แล้วรัน 03 + 04 อีกครั้ง

> `secrets.env` เป็นความลับ (chmod 600) อย่าใส่ใน zip ที่ส่งต่อ

## ดูแลระบบ

| งาน | คำสั่ง |
|---|---|
| ดูสถานะ | `kubectl -n ess get pods` |
| ดู log | `kubectl -n ess logs deploy/ess-matrix-authentication-service` |
| แก้ config | แก้ `config.env` → `./scripts/03-render.sh && ./scripts/04-install.sh` |
| อัปเดตเวอร์ชัน | `./scripts/04-install.sh` — สำรองข้อมูลก่อนทุกครั้ง แล้วรัน `./scripts/11-thai.sh` ซ้ำ · อัปเดต MAS: เทียบ `mas-templates/consent.html.tpl` กับต้นฉบับเวอร์ชันใหม่ |
| ภาษาไทย / แก้คำแปล | แก้ `i18n/*.tsv` (key<TAB>คำแปล) → `./scripts/11-thai.sh` · ข้อความที่ยังไม่แปลแสดงเป็นอังกฤษ |
| สำรองข้อมูล | github.com/element-hq/ess-helm/blob/main/docs/maintenance.md |

ข้อมูลอยู่ที่ `/var/lib/rancher/k3s/storage/` (ฐานข้อมูล + ไฟล์แนบ) ควรสำรองทุกคืน

## ปัญหาที่พบบ่อย

| อาการ | สาเหตุ |
|---|---|
| มือถือหา server `arankub.com` ไม่เจอ | กฎ well-known ใน Tunnel อยู่ใต้กฎ AranKub เดิม → ย้ายขึ้นบน |
| เว็บแชทขึ้น 502 | Tunnel ชี้ผิดพอร์ต → ตรงกับ `TRAEFIK_HTTP_PORT` ไหม, `kubectl -n ess get pods` ครบไหม |
| แชทไม่ขึ้นทันที ต้องรีเฟรช | WebSockets ใน Cloudflare ยังไม่เปิด |
| โทรใน รพ. ได้ นอก รพ. ไม่ได้ | ยังไม่ forward UDP 30002 หรือ `PUBLIC_IP` ผิด |
| อัปโหลดไฟล์เกิน 100 MB ไม่ผ่าน | ข้อจำกัด Cloudflare แผนฟรี (ตั้ง MAX_UPLOAD=95M ไว้แล้ว) |
| เครื่องช้าลง / AranKub ตอบช้า | RAM ไม่พอ ระหว่าง Ollama กับแชท → ดู `free -h` พิจารณาย้ายแชทไปเครื่องแยกภายหลัง |

## ข้อจำกัดที่ควรรู้

- ESS Community ปรับมาสำหรับผู้ใช้ราว 100 คน ไม่ล็อกจำนวน แต่ถ้าเกินมากต้องเพิ่มสเปกเครื่อง
- License AGPL-3.0: ใช้ภายในฟรี ถ้า fork แอปมาแจกต้องเปิดซอร์สส่วนที่แก้
- ไม่มี support จาก Element (ถามได้ที่ห้อง #ess-community:element.io)
