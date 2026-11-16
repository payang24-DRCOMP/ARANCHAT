# Sygnal — push gateway ของเราเอง: Synapse → Sygnal → Firebase (FCM) → แอป AranChat บนมือถือ
# เสิร์ฟที่ https://__MATRIX_HOST__/_matrix/push/v1/notify (ไม่ต้องเพิ่มโดเมน/DNS)
# ติดตั้ง/อัปเดต: scripts/16-push.sh <service-account.json> — กุญแจ Firebase อยู่ใน Secret aranchat-sygnal-fcm
# Web Push (iPhone/เว็บ): scripts/20-web-push.sh — กุญแจ VAPID ใน Secret aranchat-sygnal-webpush, ตัวย่อข้อความ sygnal/aranwebpush.py
apiVersion: v1
kind: ConfigMap
metadata:
  name: aranchat-sygnal
  namespace: ess
data:
  sygnal.yaml: |
    log:
      setup:
        version: 1
        formatters: {normal: {format: "%(asctime)s %(levelname)s %(name)s %(message)s"}}
        handlers: {stdout: {class: logging.StreamHandler, formatter: normal, stream: "ext://sys.stdout"}}
        root: {handlers: [stdout], level: INFO}
        disable_existing_loggers: false
      access: {}
    http:
      bind_addresses: ["0.0.0.0"]
      port: 5000
    # app id = PUSHER_APP_ID ใน element-x-android/aranchat/brand.env (ตัวทดสอบต่อท้าย .debug)
    apps:
      __PUSHER_APP_ID__:
        type: gcm
        api_version: v1
        project_id: __FCM_PROJECT__
        service_account_file: /secrets/service-account.json
      __PUSHER_APP_ID__.debug:
        type: gcm
        api_version: v1
        project_id: __FCM_PROJECT__
        service_account_file: /secrets/service-account.json
      # เว็บแชท/iPhone ที่ติดตั้งลงหน้าจอโฮม (element-web src/aranchat/webPush.ts, config aranchat.web_push.app_id)
      __PUSHER_APP_ID_WEB__:
        type: aranwebpush.AranWebpushPushkin
        vapid_private_key: /webpush/vapid_private_key.pem
        vapid_contact_email: __VAPID_CONTACT__
        allowed_endpoints: ["web.push.apple.com", "*.push.apple.com", "fcm.googleapis.com", "*.googleapis.com", "updates.push.services.mozilla.com", "*.notify.windows.com"]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aranchat-sygnal
  namespace: ess
spec:
  replicas: 1
  selector:
    matchLabels: {app: aranchat-sygnal}
  template:
    metadata:
      labels: {app: aranchat-sygnal}
      annotations:
        aranchat/config-hash: "__HASH__"
    spec:
      containers:
        - name: sygnal
          image: matrixdotorg/sygnal:v0.17.0
          env: [{name: SYGNAL_CONF, value: /config/sygnal.yaml}, {name: PYTHONPATH, value: /plugins}]
          ports: [{containerPort: 5000}]
          readinessProbe:
            httpGet: {path: /health, port: 5000}
          resources:
            requests: {cpu: 10m, memory: 64Mi}
            limits: {memory: 256Mi}
          volumeMounts:
            - {name: config, mountPath: /config, readOnly: true}
            - {name: fcm, mountPath: /secrets, readOnly: true}
            - {name: webpush, mountPath: /webpush, readOnly: true}
            - {name: plugins, mountPath: /plugins, readOnly: true}
      volumes:
        - name: config
          configMap: {name: aranchat-sygnal}
        - name: fcm
          secret: {secretName: aranchat-sygnal-fcm}
        - name: webpush
          secret: {secretName: aranchat-sygnal-webpush}
        - name: plugins
          configMap: {name: aranchat-sygnal-plugins}
---
apiVersion: v1
kind: Service
metadata:
  name: aranchat-sygnal
  namespace: ess
spec:
  selector: {app: aranchat-sygnal}
  ports: [{port: 80, targetPort: 5000}]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: aranchat-sygnal
  namespace: ess
  annotations:
    # ต้องมาก่อน /_matrix ของ Synapse
    traefik.ingress.kubernetes.io/router.priority: "1000"
spec:
  ingressClassName: traefik
  rules:
    - host: __MATRIX_HOST__
      http:
        paths:
          - {path: /_matrix/push, pathType: Prefix, backend: {service: {name: aranchat-sygnal, port: {number: 80}}}}
