#!/usr/bin/env bash
# build แอป AranChat (Android) — ใช้ JDK/SDK ใน ~/aranchat-apps/tools (ไม่ต้องติดตั้งระดับเครื่อง)
# ./aranchat/build.sh                          → debug (fdroid, ทดสอบหน้าตา/login)
# ./aranchat/build.sh :app:assembleGplayRelease → ตัวแจกจริง มี Firebase push (ต้อง apply-firebase.sh ก่อน)
# ตัว release เซ็นด้วยกุญแจใน ~/aranchat-apps/secrets/aranchat-release.env (ไม่มี → debug key ห้ามแจก)
set -euo pipefail
cd "$(dirname "$0")/.."
T=/home/payang/aranchat-apps/tools
export JAVA_HOME=$T/jdk21 ANDROID_HOME=$T/android-sdk PATH=$T/jdk21/bin:$PATH
KEYS=/home/payang/aranchat-apps/secrets/aranchat-release.env
[[ -f $KEYS ]] && { set -a; source "$KEYS"; set +a; }
TASK=${1:-:app:assembleFdroidDebug}
# แผนที่ (แชร์ตำแหน่ง): ตัว FOSS อ่านกุญแจ/รหัสแผนที่จากตัวแปรนี้ ไม่ใช่ BuildTimeConfig — กุญแจไม่ได้ใช้จริงกับ server แผนที่ของเรา แค่ต้องไม่ว่าง
source aranchat/brand.env
if [[ -n ${MAP_URL:-} ]]; then
  export ELEMENT_ANDROID_MAPTILER_API_KEY=aranchat ELEMENT_ANDROID_MAPTILER_LIGHT_MAP_ID=light ELEMENT_ANDROID_MAPTILER_DARK_MAP_ID=dark
fi
./gradlew --no-daemon -Dorg.gradle.jvmargs="-Xmx12g" "$TASK"
find app/build/outputs/apk -name "*.apk" -newer aranchat/brand.env -printf "%p  %s bytes\n"
