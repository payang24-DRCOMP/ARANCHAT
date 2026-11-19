#!/usr/bin/env bash
# build แอป AranChat Desktop (Windows / Linux) จาก Element Desktop
# ใช้เว็บแชทที่ build จากซอร์ส (apps/web/webapp) + ค่าตั้ง/หน้าตา/ภาษาไทยชุดเดียวกับ chat.arankub.com
#
#   ./aranchat/build-desktop.sh linux      → .deb + AppImage
#   ./aranchat/build-desktop.sh win        → ตัวติดตั้ง .exe (build ใน Docker ที่มี wine)
# หน่วยงานอื่น: แก้ aranchat/desktop-variant/build.json + ESS_DIR (config.env/brand ของหน่วยงานนั้น)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
TARGET=${1:-linux}
ESS_DIR=${ESS_DIR:-/home/payang/aranchat-ess}
T=/home/payang/aranchat-apps/tools
export PATH=$T/pnpm/bin:/home/payang/.nvm/versions/node/v24.22.1/bin:$PATH
source "$ESS_DIR/config.env"
CHAT_URL="https://${CHAT_HOST:-chat.${SERVER_NAME}}"

[[ -f apps/web/webapp/index.html ]] || (cd apps/web && NODE_OPTIONS=--max-old-space-size=16384 pnpm build)

# 1. เว็บแชทที่จะฝังในแอป
W=apps/desktop/webapp
rm -rf "$W"; cp -r apps/web/webapp "$W"
#    เหลือเฉพาะชุดไฟล์ที่ index.html ใช้ (build ซ้ำแล้วชุดเก่าค้าง) + ไม่เอาไฟล์ดีบัก .map — แอปเล็กลงหลายร้อย MB
KEEP=$(grep -o 'bundles/[0-9a-f]*' "$W/index.html" | head -1 | cut -d/ -f2)
find "$W/bundles" -mindepth 1 -maxdepth 1 ! -name "$KEEP" -exec rm -rf {} +
find "$W" -name "*.map" -delete
#    ค่าตั้ง: เอาจากเว็บแชทจริง (ตรงกันทุกอย่าง) แล้วปรับเฉพาะส่วนของแอป Desktop
curl -fsSL "$CHAT_URL/config.json" | python3 -c '
import json, sys
c = json.load(sys.stdin)
# จุดเริ่มแผนที่ตอนปักหมุด: ค่าจากเว็บจริง (14-web-beta.sh) หรือ MAP_CENTER ใน config.env ถ้าเว็บยังไม่มี
map_center = (c.get("aranchat") or {}).get("map_center") or ([float(v) for v in sys.argv[4].split(",")] if sys.argv[4] else None)
c.pop("update_base_url", None)          # ไม่ใช้ระบบอัปเดตของ Element
c["bug_report_endpoint_url"] = None
# แถบเมนู/หน้าเพื่อน/หน้ามือถือของ AranChat (src/aranchat) — ค่าเดียวกับเว็บแชท /beta/ (scripts/14-web-beta.sh)
apps = json.load(open(sys.argv[1]))
c["aranchat"] = {"logo": sys.argv[2] + "/branding/icon-120.png", "bot_user": "@aranchat:" + sys.argv[3],
                 "news_room": apps.get("news_room"), "quiet_encryption": True, "apps": apps["apps"],
                 # อัปเดตแอปอัตโนมัติ (apps/desktop/src/aranchat-updater.ts) — ไฟล์นี้สร้างโดย ~/aranchat-ess/scripts/18-publish-apps.sh
                 "update_feed": sys.argv[2] + "/download/latest.json"}
# ลิงก์ชวนเพื่อน / แชร์กลุ่ม (notify/invites.mjs) + กลุ่มแบบขอเข้าร่วม — เหมือน scripts/14-web-beta.sh
c["aranchat"]["invite_api"] = sys.argv[2] + "/api/notify"
c.setdefault("features", {})["feature_ask_to_join"] = True
# ชุดสติกเกอร์บน server (aranchat-ess/scripts/24-stickers.py) + สติกเกอร์เคลื่อนไหวเล่นเองแบบ LINE
c["aranchat"]["stickers_url"] = sys.argv[2] + "/stickers/index.json"
if map_center: c["aranchat"]["map_center"] = map_center
c.setdefault("setting_defaults", {})["autoplayGifs"] = True
print(json.dumps(c, ensure_ascii=False, indent=1))' "$ESS_DIR/rendered/brand/apps.json" "$CHAT_URL" "$SERVER_NAME" "${MAP_CENTER:-}" > "$W/config.json"
#    หน้าตา (CSS/ฟอนต์) — เว็บแชทใส่ผ่าน nginx แต่แอปโหลดจากไฟล์ในเครื่อง จึงต้องใส่ลง index.html เอง
mkdir -p "$W/branding"
cp "$ESS_DIR"/brand/aranchat.css "$ESS_DIR"/brand/Sarabun-*.ttf "$ESS_DIR"/brand/icon-120.png "$W/branding/"
cp aranchat/desktop-titlebar.css aranchat/desktop-titlebar.js "$W/branding/"
#    แถบบนของหน้าต่าง (แทนแถบชื่อ/เมนูของระบบ — electron-main.ts ซ่อนไว้)
sed -i 's|</head>|<link rel="stylesheet" href="branding/aranchat.css"><link rel="stylesheet" href="branding/desktop-titlebar.css"><script src="branding/desktop-titlebar.js" defer></script></head>|' "$W/index.html"
sed -i "s|<title>Element</title>|<title>${BRAND}</title>|" "$W/index.html"
#    ภาษาไทย (scripts/11-thai.sh สร้างไว้แล้ว)
TH=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["th"])' "$ESS_DIR/rendered/i18n/web/languages.json")
cp "$ESS_DIR/rendered/i18n/web/th.json" "$W/i18n/$TH"
cp "$ESS_DIR/rendered/i18n/web/languages.json" "$W/i18n/languages.json"
#    "en" ต้องชี้ไฟล์ที่มีจริงใน build นี้ (languages.json ที่ render ไว้อาจชี้ชื่อไฟล์ของ build เก่า → ข้อความขึ้นเป็นรหัส)
EN=$(cd "$W/i18n" && ls en_EN.*.json | head -1)
python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["en"]=sys.argv[2]; json.dump(d, open(p,"w"))' "$W/i18n/languages.json" "$EN"
(cd apps/desktop && pnpm exec asar p webapp webapp.asar)

# 2. ไอคอนแอป
node aranchat/make-desktop-icons.mjs "$ESS_DIR/brand/icon-1024.png" apps/desktop/build

# 3. build
export VARIANT_PATH="$ROOT/aranchat/desktop-variant/build.json"
cd apps/desktop
# โค้ดฝั่ง Electron (TypeScript → lib/) + ไฟล์ภาษา — electron-builder แพ็กจาก lib/
pnpm exec tsc && node scripts/copy-res.ts
case "$TARGET" in
  linux) pnpm exec electron-builder --linux deb AppImage --x64 ;;
  win)
    # electron-builder ต้องใช้ wine เพื่อใส่ไอคอน/ข้อมูลลงไฟล์ .exe → build ใน image ทางการที่มี wine
    # npmRebuild=false: pkcs11js (login ด้วยสมาร์ตการ์ด — ไม่ได้ใช้, โหลดแบบไม่บังคับ) compile ข้ามเป็น Windows ไม่ได้
    docker run --rm -v "$ROOT":/project -w /project/apps/desktop \
      -e VARIANT_PATH=/project/aranchat/desktop-variant/build.json -e ELECTRON_CACHE=/root/.cache/electron \
      -v "$HOME/.cache/electron":/root/.cache/electron -v "$HOME/.cache/electron-builder":/root/.cache/electron-builder \
      electronuserland/builder:wine \
      bash -c "npx --yes electron-builder@\$(node -p 'require(\"./node_modules/electron-builder/package.json\").version') --win nsis --x64 -c.npmRebuild=false" ;;
  *) echo "ใช้: $0 linux|win"; exit 1 ;;
esac
ls -la dist | grep -iE "\.(exe|deb|AppImage)$" || true
