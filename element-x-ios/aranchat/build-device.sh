#!/bin/zsh
# AranChat iOS — build แล้วติดตั้งลง iPhone ที่ต่อสายอยู่ ด้วย Apple ID ฟรี (Personal Team)
#
#   TEAM=XXXXXXXXXX ./aranchat/build-device.sh  # ใช้ iPhone เครื่องแรกที่เจอ
#   TEAM=XXXXXXXXXX DEVICE=<udid> ./aranchat/build-device.sh
#
# ต้องมี: Xcode 26.2 ขึ้นไป (Xcode 26 ต้องใช้แพตช์ใน aranchat/xcode26-patch.sh) · brew install xcodegen swiftgen
#         ล็อกอิน Apple ID ใน Xcode > Settings > Accounts · iPhone เปิด Developer Mode + เชื่อถือเครื่อง Mac นี้
#
# ข้อจำกัดของ Personal Team (ฟรี) — สคริปต์ปิด entitlement เหล่านี้ให้เฉพาะตอน build บนเครื่อง:
#   - ไม่มี Push Notification (APNs) / Associated Domains (ลิงก์ชวน) / communication notifications
#   - แอปหมดอายุทุก 7 วัน (รันสคริปต์ใหม่) · ลงทะเบียน App ID ได้ 10 ตัว/7 วัน
#   - bundle id เป็น com.arankub.aranchat.dev เพื่อไม่ให้บัญชีส่วนตัวไปจอง com.arankub.aranchat
#     (ต้องเหลือไว้ให้บัญชี Apple Developer ของหน่วยงานใช้ปล่อยจริง)
set -eu
cd "${0:A:h}/.."

TEAM="${TEAM:?ตั้ง TEAM=<Team ID ของบัญชี Apple> ก่อน เช่น TEAM=ABCDE12345 ./aranchat/build-device.sh}"
BUNDLE_ID="${BUNDLE_ID:-com.arankub.aranchat.dev}"
APP_GROUP="${APP_GROUP:-group.$BUNDLE_ID}"
DERIVED="${DERIVED:-$PWD/../build/dd}"

XCODE_MAJOR=$(xcodebuild -version | head -1 | awk "{print \$2}" | cut -d. -f1)

if [[ -z "${DEVICE:-}" ]]; then
  DEVICE=$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone|iPad/ && /available|connected/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-/) {print $i; exit}}')
fi
[[ -n "${DEVICE:-}" ]] || { echo "ไม่เจอ iPhone — ต่อสาย USB / ปลดล็อกเครื่อง / กด 'เชื่อถือ' แล้วลองใหม่"; xcrun devicectl list devices; exit 1; }
# xcodebuild ใช้ UDID ของเครื่อง (ไม่ใช่ CoreDevice identifier)
UDID=$(xcrun devicectl device info details --device "$DEVICE" 2>/dev/null | awk -F": " "/udid:/ {print \$2; exit}" | tr -d " ")
[[ -n "$UDID" ]] || UDID="$DEVICE"
echo "▶ device: $DEVICE · team: $TEAM · bundle: $BUNDLE_ID"

xcodegen --quiet

if (( XCODE_MAJOR < 27 )); then
  ./aranchat/xcode26-patch.sh "$DERIVED"
fi

ENTITLEMENTS=(ElementX/SupportingFiles/ElementX.entitlements NSE/SupportingFiles/NSE.entitlements ShareExtension/SupportingFiles/ShareExtension.entitlements)
restore() { git checkout -- "${ENTITLEMENTS[@]}" 2>/dev/null || true; }
trap restore EXIT

PB=/usr/libexec/PlistBuddy
for f in "${ENTITLEMENTS[@]}"; do
  for key in aps-environment com.apple.developer.associated-domains com.apple.developer.usernotifications.communication com.apple.developer.usernotifications.filtering; do
    $PB -c "Delete :$key" "$f" 2>/dev/null || true
  done
  # app group / keychain group ของ Element Classic (group.im.vector เป็นของทีม Element — ทีมอื่นลงทะเบียนไม่ได้)
  $PB -c "Delete :com.apple.security.application-groups:1" "$f" 2>/dev/null || true
  $PB -c "Delete :keychain-access-groups:1" "$f" 2>/dev/null || true
done

xcodebuild -project ElementX.xcodeproj -scheme ElementX -configuration Debug \
  -destination "id=$UDID" -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration -disableAutomaticPackageResolution \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic \
  BASE_BUNDLE_IDENTIFIER="$BUNDLE_ID" APP_GROUP_IDENTIFIER="$APP_GROUP" \
  build | tee "$DERIVED.log" | grep -E "error:|warning: .*provision|BUILD (SUCCEEDED|FAILED)" || true

APP="$DERIVED/Build/Products/Debug-iphoneos/ElementX.app"
[[ -d "$APP" ]] && grep -q "BUILD SUCCEEDED" "$DERIVED.log" || { echo "build ไม่ผ่าน — ดู $DERIVED.log"; exit 1; }

echo "▶ ติดตั้งลง iPhone…"
xcrun devicectl device install app --device "$DEVICE" "$APP"
echo "✅ ติดตั้งแล้ว — ครั้งแรกให้ไปที่ ตั้งค่า > ทั่วไป > VPN และการจัดการอุปกรณ์ > เชื่อถือ Apple ID ของคุณ"
