{#
AranChat: แก้จากต้นฉบับ MAS v1.28.0 templates/app.html (หน้าจัดการบัญชีและอุปกรณ์)
— อัปเกรด MAS แล้วต้องเทียบกับต้นฉบับใหม่
#}
{#
Copyright 2025, 2026 Element Creations Ltd.
Copyright 2024, 2025 New Vector Ltd.
Copyright 2023, 2024 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
-#}

{# Must be kept in sync with frontend/index.html #}
{% set _ = translator(lang) %}

<!DOCTYPE html>
<html lang="{{ lang }}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{ _("app.name") }}</title>
    {{ include_asset('src/entrypoints/main.tsx') | indent(4) | safe }}
    {# Pre-load the locale data for the current language #}
    {# AranChat: ภาษาที่หน้าเว็บของ MAS ไม่มีไฟล์ (เช่น th — เรามีแค่คำแปลฝั่งเซิร์ฟเวอร์) → ใช้ไฟล์ภาษาอังกฤษ แทนที่จะ error 500 #}
    {% set asset_lang = lang if lang in ["cs", "da", "de", "en", "et", "fi", "fr", "hu", "nb-NO", "nl", "pl", "pt", "pt-BR", "ru", "sk", "sv", "tr", "uk", "uz", "zh-Hans"] else "en" %}
    {{ include_asset('locales/' ~ asset_lang ~ '.json') | indent(4) | safe }}
  </head>

  <body>
    <div id="root" data-root="{{ app_config.root }}" data-graphql-endpoint="{{ app_config.graphqlEndpoint }}"></div>

    <div id="root-error" class="critical-notice" hidden>
      {{ _("mas.loading_failed") }}
    </div>
  </body>
</html>
