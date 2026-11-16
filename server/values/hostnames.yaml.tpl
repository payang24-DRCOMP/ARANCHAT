# ชื่อโดเมนของแต่ละบริการ (สร้างจาก config.env)
# ถ้า helm แจ้งว่า key ไม่ถูกต้อง ให้เทียบกับ rendered/official-hostnames.example.yaml
serverName: __SERVER_NAME__

elementWeb:
  ingress:
    host: __CHAT_HOST__

elementAdmin:
  ingress:
    host: __ADMIN_HOST__

synapse:
  ingress:
    host: __MATRIX_HOST__

matrixAuthenticationService:
  ingress:
    host: __AUTH_HOST__

matrixRTC:
  ingress:
    host: __RTC_HOST__
