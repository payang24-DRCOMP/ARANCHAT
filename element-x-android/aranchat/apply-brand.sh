#!/usr/bin/env bash
# ใส่แบรนด์ (ชื่อแอป รหัสแอป เซิร์ฟเวอร์ สี push gateway ไอคอน) จาก aranchat/brand.env ลงในโค้ด Element X Android
# ./aranchat/apply-brand.sh <ชื่อ>  → ใช้แบรนด์ของ aranchat/brands/<ชื่อ>/ (brand.env + icon.png [+ google-services.json])
# ./aranchat/apply-brand.sh         → ใช้ aranchat/brand.env + icon.png ที่ใส่อยู่ตอนนี้ (รันซ้ำได้)
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n ${1:-} ]]; then
  B=aranchat/brands/$1
  [[ -f $B/brand.env && -f $B/icon.png ]] || { echo "ไม่พบ $B/brand.env หรือ $B/icon.png (สร้าง: ./aranchat/new-brand.sh $1)" >&2; exit 1; }
  cp "$B/brand.env" aranchat/brand.env
  cp "$B/icon.png" aranchat/icon.png
fi
source aranchat/brand.env
# ไลบรารีย่อรูป (sharp) สำหรับสร้างไอคอน — ใช้ของ notify ในเครื่องนี้ถ้าไม่ได้ติดตั้งไว้
export SHARP_PATH=${SHARP_PATH:-$(ls -d ~/aranchat-ess/notify/node_modules/sharp 2>/dev/null || echo sharp)}
: "${CHAT_HOST:?brand.env ต้องมี CHAT_HOST (เช่น chat.arankub.com)}"
hex=${BRAND_COLOR#\#}

# 1. รหัสแอป / ชื่อแอป / app id ที่ลงทะเบียนกับ push gateway / แผนที่ (server แผนที่ของเราใช้รูปแบบ URL เดียวกับ MapTiler — กุญแจไม่ได้ใช้จริง แค่ต้องไม่ว่าง)
f=plugins/src/main/kotlin/config/BuildTimeConfig.kt
q() { [[ -n ${MAP_URL:-} ]] && printf '"%s"' "$1" || printf 'null'; }
M_BASE=$(q "${MAP_URL:-}"); M_KEY=$(q aranchat); M_LIGHT=$(q light); M_DARK=$(q dark)
sed -i -E \
  -e "s|(const val APPLICATION_ID = )\"[^\"]*\"|\1\"${APP_ID}\"|" \
  -e "s|(const val APPLICATION_NAME = )\"[^\"]*\"|\1\"${APP_NAME}\"|" \
  -e "s|(val URL_WEBSITE: String\? = ).*|\1\"${WEBSITE_URL}\"|" \
  -e "s|(val URL_LOGO: String\? = ).*|\1\"${LOGO_URL}\"|" \
  -e "s|(val URL_ACCEPTABLE_USE: String\? = ).*|\1\"${TERMS_URL}\"|" \
  -e "s|(val URL_COPYRIGHT: String\? = ).*|\1\"${TERMS_URL}\"|" \
  -e "s|(val URL_POLICY: String\? = ).*|\1\"${PRIVACY_URL}\"|" \
  -e "s|(val URL_PRIVACY: String\? = ).*|\1\"${PRIVACY_URL}\"|" \
  -e "s|(val METADATA_HOST_REVERSED: String\? = ).*|\1\"${APP_ID}\"|" \
  -e "s|(val PUSHER_APP_ID_RELEASE: String\? = ).*|\1\"${PUSHER_APP_ID}\"|" \
  -e "s|(val PUSHER_APP_ID_DEBUG: String\? = ).*|\1\"${PUSHER_APP_ID}.debug\"|" \
  -e "s|(val PUSHER_APP_ID_NIGHTLY: String\? = ).*|\1\"${PUSHER_APP_ID}.nightly\"|" \
  -e "s|(val SERVICES_MAPTILER_BASE_URL: String\? = ).*|\1${M_BASE}|" \
  -e "s|(val SERVICES_MAPTILER_APIKEY: String\? = ).*|\1${M_KEY}|" \
  -e "s|(val SERVICES_MAPTILER_LIGHT_MAPID: String\? = ).*|\1${M_LIGHT}|" \
  -e "s|(val SERVICES_MAPTILER_DARK_MAPID: String\? = ).*|\1${M_DARK}|" \
  "$f"
f=appconfig/src/main/kotlin/io/element/android/appconfig/ApplicationConfig.kt
sed -i -E \
  -e "s|(const val PRODUCTION_APPLICATION_NAME: String = )\"[^\"]*\"|\1\"${APP_NAME}\"|" \
  -e "s|(const val DESKTOP_APPLICATION_NAME: String = )\"[^\"]*\"|\1\"${APP_NAME}\"|" \
  "$f"

# 2. เซิร์ฟเวอร์ / สี / push gateway — DefaultEnterpriseService (FOSS) อ่านค่าจากไฟล์นี้
cat > features/enterprise/impl-foss/src/main/kotlin/io/element/android/features/enterprise/impl/AranChatBrand.kt <<EOF
/*
 * AranChat — สร้างจาก aranchat/brand.env โดย aranchat/apply-brand.sh (อย่าแก้ไฟล์นี้ตรงๆ)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.features.enterprise.impl

import androidx.compose.ui.graphics.Color
import io.element.android.compound.colors.SemanticColorsLightDark
import io.element.android.compound.tokens.generated.SemanticColors
import io.element.android.compound.tokens.generated.compoundColorsDark
import io.element.android.compound.tokens.generated.compoundColorsLight
import io.element.android.libraries.matrix.api.accountprovider.AccountProvider

internal object AranChatBrand {
    /** เซิร์ฟเวอร์เดียวที่แอปเข้าได้ — ผู้ใช้ไม่ต้องเลือก/พิมพ์เซิร์ฟเวอร์ */
    val accountProvider = AccountProvider.Managed(
        serverName = "${SERVER_NAME}",
        baseUrl = "${HOMESERVER_URL}",
        canUseServerName = true,
    )

    val brandColor = Color(0xFF${hex})

    val pushGateway: String? = "${PUSH_GATEWAY_URL}".ifBlank { null }

    /** ฝากกุญแจกู้คืนแชทเข้ารหัส (aranchat-ess/keyvault) — ว่าง = ไม่ใช้ */
    val keyvaultUrl: String? = "${KEYVAULT_URL:-}".ifBlank { null }

    private fun SemanticColors.branded(darker: Color) = copy(
        bgActionPrimaryRest = brandColor,
        bgActionPrimaryHovered = darker,
        bgActionPrimaryPressed = darker,
        bgAccentRest = brandColor,
        bgAccentHovered = darker,
        bgAccentPressed = darker,
        iconAccentPrimary = brandColor,
        iconAccentTertiary = brandColor,
        textActionAccent = brandColor,
    )

    val semanticColors = SemanticColorsLightDark(
        light = compoundColorsLight.branded(darker = brandColor.copy(red = brandColor.red * 0.8f, green = brandColor.green * 0.8f, blue = brandColor.blue * 0.8f)),
        dark = compoundColorsDark.branded(darker = brandColor),
    )
}
EOF

# 2b. เว็บแชทของหน่วยงาน: เช็กอัปเดตจากหน้าดาวน์โหลด + ลิงก์ชวนเพื่อนเปิดในแอป
sed -i -E "s|(private const val FEED_URL = )\"[^\"]*\"|\1\"https://${CHAT_HOST}/download/latest.json\"|" \
  app/src/main/kotlin/io/element/android/x/AranChatUpdateChecker.kt
# บรรทัดที่ต่อจาก <data android:scheme="https" /> ของ intent-filter ลิงก์ชวนเพื่อน (มี pathPrefix /i/ ตามมา)
python3 -I - "$CHAT_HOST" <<'PY'
import re, sys
p = "app/src/main/AndroidManifest.xml"; s = open(p, encoding="utf-8").read()
s2, n = re.subn(r'(<data android:host=")[^"]*(" />\s*<data android:pathPrefix="/i/" />)', lambda m: m.group(1) + sys.argv[1] + m.group(2), s)
if n != 1: sys.exit("AndroidManifest: หา intent-filter ลิงก์ชวนเพื่อน (/i/) ไม่เจอ")
open(p, "w", encoding="utf-8").write(s2)
PY

# 3. ไอคอนแอป — สร้างจาก aranchat/icon.png (สี่เหลี่ยม 1024px ขึ้นไป) + สีพื้นหลัง adaptive icon
sed -i -E "s|(android:fillColor=)\"#[0-9A-Fa-f]{6}\"|\1\"${LAUNCHER_BG:-$BRAND_COLOR}\"|" appicon/element/src/*/res/drawable/ic_launcher_background.xml
node aranchat/make-icons.mjs aranchat/icon.png appicon/element/src/main/res
# 4. หน้าแรกก่อนล็อกอิน: โลโก้/พื้นหลังของ Element → AranChat
node aranchat/make-onboarding.mjs aranchat/icon.png
echo "ใส่แบรนด์ ${APP_NAME} (${APP_ID}) แล้ว — build: ./aranchat/build.sh"
