# Video call: server อยู่หลัง NAT → ประกาศ IP สาธารณะให้มือถือเชื่อมต่อกลับมาได้
matrixRTC:
  sfu:
    useStunToDiscoverPublicIP: false
    manualIP: "__PUBLIC_IP__"

# การเข้ารหัสแบบ end-to-end: ห้องใหม่/แชทส่วนตัวเข้ารหัสเป็นค่าเริ่มต้น (ตัดสินใจ 2026-11-12 — มีข้อมูลผู้ป่วย)
#   (เดิม 2026-11-06 ปิดไว้ — เปลี่ยนเพราะต้องไม่ให้ข้อความหลุดออกนอก รพ. เช่น ผ่าน Cloudflare)
#   เปลี่ยนเครื่องแล้วอ่านแชทเก่าได้: แอปฝาก recovery key ไว้ที่ keyvault ของ รพ. อัตโนมัติ (com.arankub.keyvault ด้านล่าง)
#   Element อ่านค่า io.element.e2ee.default จาก /.well-known/matrix/client
wellKnownDelegation:
  additional:
    client: '{"io.element.e2ee": {"default": true}, "com.arankub.keyvault": {"url": "https://__CHAT_HOST__/api/keyvault"}}'
