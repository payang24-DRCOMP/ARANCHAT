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
./gradlew --no-daemon -Dorg.gradle.jvmargs="-Xmx12g" "$TASK"
find app/build/outputs/apk -name "*.apk" -newer aranchat/brand.env -printf "%p  %s bytes\n"
