# แผนที่ของ รพ. (AranChat / AranKub)

แผนที่ประเทศไทยจาก OpenStreetMap วาดบน server ของเราเอง ไม่ต้องพึ่ง MapTiler หรือ Google
- แผนที่ยังใช้ได้ในเครือข่าย รพ. แม้เน็ตออกนอกล่ม
- บริการภายนอกไม่รู้ว่า รพ. เปิดดูพื้นที่ไหน

ติดตั้งหรืออัปเดต: `scripts/28-maps.sh` · อัปเดตข้อมูลแผนที่ (เดือนละครั้ง): `scripts/28-maps.sh update`

## ส่วนประกอบ
| ส่วน | ที่อยู่ | หน้าที่ |
|---|---|---|
| docker `aranchat-osm` | 127.0.0.1:18090 | วาดภาพแผนที่ (openstreetmap-tile-server: PostGIS + Mapnik ฟอนต์ Noto รวมภาษาไทย) |
| pm2 `aranchat-maps` (`server.mjs`) | 10.42.0.1:3214 | แคชภาพ, โหมดมืด, style ของ MapLibre, ภาพแผนที่ย่อ, จำกัดการเรียกต่อ IP |
| K3s ingress | `https://chat.arankub.com/maps` | ทางเข้าจากแอป |

## URL
| URL | ใช้กับ |
|---|---|
| `/maps/tiles/{z}/{x}/{y}.png` | Leaflet ของ AranKub (แทน `tile.openstreetmap.org`) |
| `/maps/tiles-dark/{z}/{x}/{y}.png` | แบบมืด |
| `/maps/light/style.json` · `/maps/dark/style.json` | เว็บแชท (`map_style_url`), Android, iOS |
| `/maps/{light,dark}/static/{lon},{lat},{zoom}/{w}x{h}[@2x].{webp,png}` | ภาพแผนที่ย่อในแชทของแอปมือถือ (รูปแบบเดียวกับ MapTiler) |

แอปตั้งค่าดังนี้:
- **Android:** `MAP_URL` ใน `element-x-android/aranchat/brands/<องค์กร>/brand.env`
- **iOS:** `bundledMapTilerConfiguration` ใน `AppSettings.swift`
- กุญแจ `aranchat` ไม่ได้ใช้จริง แต่ต้องไม่ว่าง ถ้าว่าง แอปจะซ่อนเมนูแชร์ตำแหน่ง

**เครดิต:** ข้อมูลแผนที่ใช้สัญญาอนุญาต ODbL ต้องแสดง "© OpenStreetMap contributors" บนแผนที่เสมอ style และภาพย่อใส่ให้แล้ว
