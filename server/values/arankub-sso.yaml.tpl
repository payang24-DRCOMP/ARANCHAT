# Login ด้วยบัญชี AranKub (AranKub เป็น OIDC provider — ศูนย์ผู้ใช้แหล่งเดียว)
# ฝั่ง AranKub: ~/ai_drg/src/lib/oidc.ts และค่า OIDC_* ใน .env.local
# 03-render.sh สร้างไฟล์นี้เมื่อมี OIDC_CLIENT_SECRET ใน secrets.env
#
# - id ต้องเป็น ULID และห้ามเปลี่ยนหลังมีผู้ใช้ login แล้ว (อยู่ใน redirect URI ที่จดไว้ฝั่ง AranKub)
#   Redirect URI: https://__AUTH_HOST__/upstream/callback/01M6JFPAM16HCK56GW67B4K9MA
# - ผู้ใช้ผูกกับบัญชี AranKub ด้วย users.id (sub) — เปลี่ยนชื่อ/อีเมลใน AranKub ได้ ไม่หลุดจากบัญชีแชท
matrixAuthenticationService:
  additional:
    sso.yaml:
      config: |
        upstream_oauth2:
          providers:
            - id: 01M6JFPAM16HCK56GW67B4K9MA
              human_name: "บัญชี AranKub"
              issuer: "https://__SERVER_NAME__"
              client_id: "aranchat"
              client_secret: "__OIDC_CLIENT_SECRET__"
              token_endpoint_auth_method: client_secret_basic
              scope: "openid profile email"
              claims_imports:
                # username ตั้งเองได้ตอนเข้าครั้งแรก (คนที่มีอีเมลจริงจะมีค่าเสนอไว้ให้) — เปลี่ยนภายหลังไม่ได้
                localpart:
                  action: suggest
                  template: "{{ user.preferred_username }}"
                # ชื่อที่แสดง = ชื่อจริงจาก AranKub บังคับ ไม่ให้ตั้งเอง จะได้รู้ว่าใครเป็นใคร
                displayname:
                  action: force
                  template: "{{ user.name }}"
                email:
                  action: ignore
        # เปิดรหัสผ่านไว้ก่อนระหว่างทดสอบ (แอดมินยังใช้รหัสผ่านได้)
        # ทดสอบผ่านแล้วตั้ง SSO_ONLY="true" ใน config.env → เหลือ login ผ่าน AranKub ทางเดียว
        passwords:
          enabled: __PASSWORDS_ENABLED__

# ผู้ใช้แก้ชื่อที่แสดงเองไม่ได้ (ชื่อมาจาก AranKub) — แอดมินแก้ได้จากหน้าแอดมิน
synapse:
  additional:
    sso.yaml:
      config: |
        enable_set_displayname: false
