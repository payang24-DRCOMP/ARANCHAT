# MAS: ปิดการสมัครเอง — แอดมินเป็นผู้สร้างบัญชี (ผู้ใช้ทั่วไป login ด้วยบัญชี AranKub — ดู arankub-sso.yaml.tpl)
matrixAuthenticationService:
  additional:
    auth.yaml:
      config: |
        # ชื่อที่หน้า login / หน้าจัดการบัญชี (แทน "matrix-authentication-service")
        branding:
          service_name: "__BRAND__"
        account:
          password_registration_enabled: false
          password_change_allowed: true
