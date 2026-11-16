#!/usr/bin/env bash
# นำแอปที่ build แล้วขึ้นหน้าดาวน์โหลด (https://__CHAT_HOST__/download/) + เขียน latest.json
#   แอป Desktop (aranchat-updater.ts) / Android (AranChatUpdateChecker.kt) อ่าน latest.json เพื่ออัปเดต/แจ้งรุ่นใหม่
#
#   ./18-publish-apps.sh desktop android "ข้อความบอกผู้ใช้ว่ามีอะไรใหม่"
#   ./18-publish-apps.sh desktop                 (ขึ้นเฉพาะ Desktop — ส่วน Android ใน latest.json คงเดิม)
#   เพิ่ม --announce = บอท "AranChat แจ้งเตือน" ส่งการ์ด "มีรุ่นใหม่ + ปุ่มดาวน์โหลด" เข้าแชททุกคน (รุ่นเดิมไม่ประกาศซ้ำ)
#   ประกาศอย่างเดียว (ขึ้นไฟล์ไปแล้ว): ./18-publish-apps.sh --announce
# ก่อนรัน: build ด้วย element-web/aranchat/build-desktop.sh linux + win และ element-x-android/aranchat/build.sh :app:assembleGplayRelease
# รุ่น: Desktop = apps/desktop/package.json "version" · Android = plugins/src/main/kotlin/Versions.kt — เปลี่ยนเลขทุกครั้งที่ออกรุ่นใหม่
# ไฟล์รุ่นก่อนย้ายไป ~/aranchat-apps/dist-old/<วันเวลา>/ (ไม่อยู่บนหน้าดาวน์โหลด) — ย้อนกลับ: ย้ายคืนแล้วรันสคริปต์นี้ใหม่ไม่ได้ ให้แก้ลิงก์เอง
source "$(dirname "$0")/lib.sh"
APPS=/home/payang/aranchat-apps
DIST=$APPS/dist
OLD=$APPS/dist-old/$(date +%Y%m%d-%H%M)
DESK=$APPS/element-web/apps/desktop
AND=$APPS/element-x-android
DO_DESK=0 DO_AND=0 NOTES="" ANNOUNCE=0
for a in "$@"; do
  case "$a" in desktop) DO_DESK=1 ;; android) DO_AND=1 ;; --announce) ANNOUNCE=1 ;; *) NOTES="$a" ;; esac
done
announce() {
  local key; key=$(grep '^NOTIFY_ADMIN_KEY=' "${ROOT_DIR}/notify/.env" | cut -d= -f2-)
  info "ประกาศเข้าแชททุกคน"
  curl -s -X POST -H "Authorization: Bearer $key" -H "Content-Type: application/json" -d '{}' http://127.0.0.1:3210/admin/announce; echo
}
if (( ANNOUNCE && !DO_DESK && !DO_AND )); then announce; exit 0; fi
(( DO_DESK || DO_AND )) || die "ใช้: $0 [desktop] [android] [\"มีอะไรใหม่\"] [--announce]"
mkdir -p "$OLD"
retire() { for f in "$@"; do [[ -f "$f" && ! -L "$f" ]] && mv "$f" "$OLD/"; done; true; }

if (( DO_DESK )); then
  V=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$DESK/package.json")
  EXE="$DESK/dist/AranChat Setup $V.exe"; IMG="$DESK/dist/AranChat-$V.AppImage"; DEB="$DESK/dist/aranchat-desktop_${V}_amd64.deb"
  for f in "$EXE" "$IMG" "$DEB"; do [[ -f "$f" ]] || die "ไม่พบ $f — build Desktop รุ่น $V ก่อน"; done
  retire "$DIST"/AranChat-Setup-*.exe "$DIST"/AranChat-*.AppImage "$DIST"/aranchat-desktop_*_amd64.deb
  cp "$EXE" "$DIST/AranChat-Setup-$V.exe"; cp "$IMG" "$DIST/AranChat-$V.AppImage"; cp "$DEB" "$DIST/aranchat-desktop_${V}_amd64.deb"
  chmod 644 "$DIST/AranChat-Setup-$V.exe" "$DIST/aranchat-desktop_${V}_amd64.deb"; chmod 755 "$DIST/AranChat-$V.AppImage"
  ln -sfn "AranChat-Setup-$V.exe" "$DIST/AranChat-Windows.exe"
  ln -sfn "AranChat-$V.AppImage" "$DIST/AranChat-Linux.AppImage"
  ln -sfn "aranchat-desktop_${V}_amd64.deb" "$DIST/AranChat-Linux.deb"
  ok "Desktop $V"
fi

if (( DO_AND )); then
  VN=$(python3 - "$AND/plugins/src/main/kotlin/Versions.kt" <<'EOF'
import re, sys
s = open(sys.argv[1]).read()
g = lambda k: int(re.search(rf"val {k} = (\d+)", s).group(1))
print(f"{g('versionYear')}.{g('versionMonth'):02d}.{g('versionReleaseNumber')}")
EOF
)
  OUT=$AND/app/build/outputs/apk/gplay/release
  for f in "$OUT/app-gplay-arm64-v8a-release.apk" "$OUT/app-gplay-armeabi-v7a-release.apk"; do
    [[ -f "$f" && "$f" -nt "$AND/plugins/src/main/kotlin/Versions.kt" ]] || die "ไม่พบ/เก่ากว่าเลขรุ่น: $f — build Android รุ่น $VN ก่อน"
  done
  retire "$DIST"/AranChat-*-android.apk "$DIST"/AranChat-*-android-32bit.apk
  cp "$OUT/app-gplay-arm64-v8a-release.apk" "$DIST/AranChat-$VN-android.apk"
  cp "$OUT/app-gplay-armeabi-v7a-release.apk" "$DIST/AranChat-$VN-android-32bit.apk"
  ln -sfn "AranChat-$VN-android.apk" "$DIST/AranChat-Android.apk"
  ln -sfn "AranChat-$VN-android-32bit.apk" "$DIST/AranChat-Android-32bit.apk"
  ok "Android $VN"
fi

# latest.json — รวมกับของเดิม (ส่วนที่ไม่ได้ขึ้นรอบนี้คงเดิม)
python3 - "$DIST" "https://${CHAT_HOST}/download" "$DO_DESK" "$DO_AND" "$NOTES" "${V:-}" "${VN:-}" <<'EOF'
import hashlib, json, os, sys
dist, base, do_desk, do_and, notes, v, vn = sys.argv[1:8]
path = os.path.join(dist, "latest.json")
feed = json.load(open(path)) if os.path.exists(path) else {}
sha = lambda f: hashlib.sha256(open(os.path.join(dist, f), "rb").read()).hexdigest()
if do_desk == "1":
    feed["desktop"] = {"version": v, "notes": notes,
                       "win": {"url": f"{base}/AranChat-Setup-{v}.exe", "sha256": sha(f"AranChat-Setup-{v}.exe")},
                       "linux": {"deb": f"{base}/aranchat-desktop_{v}_amd64.deb", "appimage": f"{base}/AranChat-{v}.AppImage"}}
if do_and == "1":
    feed["android"] = {"version": vn, "notes": notes,
                       "url": f"{base}/AranChat-{vn}-android.apk", "url32": f"{base}/AranChat-{vn}-android-32bit.apk",
                       "sha256": sha(f"AranChat-{vn}-android.apk")}
feed["page"] = base + "/"
json.dump(feed, open(path, "w"), ensure_ascii=False, indent=1)
print(json.dumps(feed, ensure_ascii=False, indent=1))
EOF
rmdir "$OLD" 2>/dev/null || info "รุ่นก่อนเก็บไว้ที่ $OLD"
code=$(curl -s -o /dev/null -w '%{http_code}' "https://${CHAT_HOST}/download/latest.json")
[[ "$code" == 200 ]] && ok "https://${CHAT_HOST}/download/latest.json" || warn "latest.json ยังเปิดไม่ได้ (HTTP $code)"
(( ANNOUNCE )) && announce
true
