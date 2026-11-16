# ทางเข้าให้ระบบอื่นส่งแจ้งเตือน: https://__CHAT_HOST__/api/notify → AranChat Notify (notify/server.mjs, pm2 บนเครื่องนี้)
# notify ฟังที่ 10.42.0.1:3211 (ฝั่ง host ของเครือข่าย pod ใน K3s) → Service แบบไม่มี selector ชี้ไปที่นั่น
# ติดตั้ง: scripts/17-notify-api.sh · คู่มือสำหรับระบบอื่น: https://__CHAT_HOST__/connect/
apiVersion: v1
kind: Service
metadata:
  name: aranchat-notify-api
  namespace: ess
spec:
  ports: [{name: http, port: 80, targetPort: 3211}]
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: aranchat-notify-api
  namespace: ess
  labels: {kubernetes.io/service-name: aranchat-notify-api}
addressType: IPv4
ports: [{name: http, port: 3211, protocol: TCP}]
endpoints: [{addresses: ["10.42.0.1"]}]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: aranchat-notify-api
  namespace: ess
  annotations:
    # มาก่อน PathPrefix(`/`) ของเว็บแชท (aranchat-branding = 1000)
    traefik.ingress.kubernetes.io/router.priority: "1100"
spec:
  ingressClassName: traefik
  rules:
    - host: __CHAT_HOST__
      http:
        paths:
          - {path: /api/notify, pathType: Prefix, backend: {service: {name: aranchat-notify-api, port: {number: 80}}}}
