# Synapse: ขนาดไฟล์แนบ + ปิด federation (คุยเฉพาะภายใน)
synapse:
  media:
    maxUploadSize: __MAX_UPLOAD__
  additional:
    user-config.yaml:
      config: |
        federation_domain_whitelist: []
        url_preview_enabled: false
        # แชทส่วนตัว/กลุ่มส่วนตัวเข้ารหัสต้นทางถึงปลายทางเสมอ (มีข้อมูลผู้ป่วย — ตัดสินใจ 2026-11-12)
        # คู่กับ io.element.e2ee.default ใน values/rtc.yaml.tpl · กู้กุญแจเมื่อเปลี่ยนเครื่อง: keyvault/ (ฝากที่ server รพ.)
        # ห้องของบอท (แจ้งเตือน/ข่าวสาร) สร้างด้วย preset public_chat + join_rules invite จึงไม่เข้ารหัส (บอทไม่มีกุญแจ)
        encryption_enabled_by_default_for_room_type: "invite"
        # หาเพื่อน: ค้นหาชื่อได้ทุกคนในระบบ (ค่าเริ่มต้นค้นได้เฉพาะคนที่อยู่ห้องเดียวกัน)
        user_directory:
          enabled: true
          search_all_users: true
          prefer_local_users: true
        # ผู้ใช้ใหม่เข้าห้องรวมอัตโนมัติ — มีคนคุยตั้งแต่ login ครั้งแรก
        # ห้องสร้างเองเมื่อมีผู้ใช้ใหม่คนแรก เจ้าของห้องคือ @aranchat (บัญชีระบบ ไม่ใช่ผู้ใช้คนแรก)
        auto_join_rooms:
          - "#staff:__SERVER_NAME__"
          - "#news:__SERVER_NAME__"   # ห้องประกาศ (scripts/19-news-room.py สร้าง)
        autocreate_auto_join_rooms: true
        auto_join_mxid_localpart: aranchat
        auto_join_room_preset: public_chat
        # แชทจากเพื่อนร่วมงานเปิดให้อัตโนมัติแบบ LINE (ไม่ต้องกดตอบรับคำเชิญ) — ทุกแอปพร้อมกัน
        # เฉพาะแชทส่วนตัว และเฉพาะคนในระบบเดียวกัน (ห้องกลุ่ม/คนนอกยังต้องกดตอบรับ)
        auto_accept_invites:
          enabled: true
          only_for_direct_messages: true
          only_from_local_users: true
