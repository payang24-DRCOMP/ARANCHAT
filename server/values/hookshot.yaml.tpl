# Hookshot: bot รับ webhook จากระบบต่างๆ แล้วโพสต์เข้าห้องแชท
hookshot:
  enabled: true
  additional:
    user-config.yaml:
      config: |
        # ชื่อ bot ที่ผู้ใช้เห็นในห้อง (แทน "Hookshot")
        # แจ้งเตือนรายบุคคลใช้ bot @aranchat "AranChat แจ้งเตือน" (notify/) → hookshot ใช้ชื่ออื่นไม่ให้สับสน
        # avatar: โลโก้ AranChat ที่อัปโหลดไว้แล้ว (brand/icon-512.png)
        bot:
          displayname: "__BRAND__ Webhook"
          avatar: "mxc://__SERVER_NAME__/zwLtHdhZqaarHzdjFAgUBfNK"  # รูปจาก scripts/13-brand-avatars.mjs
        generic:
          enabled: true
          allowJsTransformationFunctions: false
          waitForComplete: true
          enableHttpGet: false
