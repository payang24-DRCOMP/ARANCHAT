# ภาษาไทยหน้า login / consent / ตั้งชื่อผู้ใช้ (MAS) + แม่แบบหน้าที่แก้เอง (mas-templates/)
# ไฟล์ภาษามาจาก ConfigMap aranchat-i18n-mas (สร้างโดย scripts/11-thai.sh: en.json ต้นฉบับ + th.json)
# MAS เลือกภาษาจากเบราว์เซอร์ (Accept-Language) — เครื่องที่ตั้งภาษาไทยจะเห็นภาษาไทย
matrixAuthenticationService:
  extraVolumes:
    - name: aranchat-i18n
      configMap:
        name: aranchat-i18n-mas
        optional: true
    # หน้า consent แบบข้ามอัตโนมัติสำหรับเว็บแชทเรา (mas-templates/consent.html.tpl) — ทับไฟล์เดียวในแม่แบบของ MAS
    - name: aranchat-mas-templates
      configMap:
        name: aranchat-mas-templates
  # mount ทีละไฟล์ (subPath) — mount ทั้ง ConfigMap จะมีโฟลเดอร์ ..data ติดมา
  # MAS อ่านทุกไฟล์ในโฟลเดอร์เป็นภาษา แล้วล้มเพราะ "..data" ไม่ใช่ชื่อภาษา
  extraVolumeMounts:
    - name: aranchat-i18n
      mountPath: /aranchat-i18n/en.json
      subPath: en.json
      readOnly: true
    - name: aranchat-i18n
      mountPath: /aranchat-i18n/th.json
      subPath: th.json
      readOnly: true
    - name: aranchat-mas-templates
      mountPath: /usr/local/share/mas-cli/templates/pages/consent.html
      subPath: consent.html
      readOnly: true
    # หน้าจัดการบัญชีและอุปกรณ์: ภาษาไทยไม่มีไฟล์ภาษาฝั่งหน้าเว็บ → ใช้อังกฤษแทน (เดิม error 500)
    - name: aranchat-mas-templates
      mountPath: /usr/local/share/mas-cli/templates/app.html
      subPath: app.html
      readOnly: true
  additional:
    i18n.yaml:
      config: |
        templates:
          translations_path: /aranchat-i18n
