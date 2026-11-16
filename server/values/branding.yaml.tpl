# หน้าเว็บแชท: แบรนด์ โลโก้ ภาพพื้นหลังหน้า login + ปรับให้ใช้ง่าย (ฟองข้อความแบบแชททั่วไป ซ่อนเมนูที่ไม่ใช้ หน้าแรกภาษาไทย)
# ไฟล์ภาพเสิร์ฟจาก https://__CHAT_HOST__/branding/ (ติดตั้งด้วย scripts/09-branding.sh)
elementWeb:
  additional:
    user-config.json: |
      {
        "brand": "__BRAND__",
        "default_country_code": "TH",
        "default_theme": "custom-__BRAND__",
        "setting_defaults": {
          "custom_themes": [
            {"name": "__BRAND__", "is_dark": false,
             "colors": {"accent-color": "#5B3FD9", "primary-color": "#8B5CF6",
                        "sidebar-color": "#2E1F7A", "roomlist-background-color": "#F7F5FC",
                        "roomlist-highlights-color": "#E9E3FB", "timeline-background-color": "#F1EEF9"},
             "fonts": {"general": "Inter, Sarabun, 'Noto Sans Thai', Twemoji, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif"}}
          ],
          "layout": "bubble",
          "RoomList.showMessagePreview": true,
          "showJoinLeaves": false,
          "showAvatarChanges": false,
          "showDisplaynameChanges": false,
          "UIFeature.feedback": false,
          "UIFeature.shareSocial": false,
          "UIFeature.identityServer": false,
          "UIFeature.thirdPartyId": false,
          "UIFeature.advancedSettings": false,
          "UIFeature.advancedEncryption": false,
          "UIFeature.allowCreatingPublicSpaces": false
        },
        "embedded_pages": {
          "login_for_welcome": true,
          "home_url": "https://__CHAT_HOST__/branding/home.html?v=__BRAND_VER__"
        },
        "bug_report_endpoint_url": null,
        "disable_3pid_login": true,
        "disable_login_language_selector": true,
        "disable_guests": true,
        "force_verification": false,
        "oidc_metadata": {
          "client_uri": "https://__CHAT_HOST__/",
          "logo_uri": "https://__CHAT_HOST__/branding/icon-1024.png?v=__BRAND_VER__"
        },
        "disable_custom_urls": true,
        "show_labs_settings": false,
        "branding": {
          "auth_header_logo_url": "https://__CHAT_HOST__/branding/aranchat-logo.svg?v=__BRAND_VER__",
          "welcome_background_url": "https://__CHAT_HOST__/branding/aranchat-login-bg.svg?v=__BRAND_VER__",
          "auth_footer_links": [
            {"text": "AranChat · โรงพยาบาลอรัญประเทศ", "url": "https://__SERVER_NAME__"}
          ]
        }
      }
