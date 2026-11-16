# ฝากกุญแจกู้คืนแชทเข้ารหัส: https://__CHAT_HOST__/api/keyvault → keyvault/server.mjs (pm2 aranchat-keyvault บนเครื่องนี้)
# keyvault ฟังที่ 10.42.0.1:3212 (ฝั่ง host ของเครือข่าย pod) · ติดตั้ง: scripts/21-keyvault.sh
apiVersion: v1
kind: Service
metadata:
  name: aranchat-keyvault
  namespace: ess
spec:
  ports: [{name: http, port: 80, targetPort: 3212}]
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: aranchat-keyvault
  namespace: ess
  labels: {kubernetes.io/service-name: aranchat-keyvault}
addressType: IPv4
ports: [{name: http, port: 3212, protocol: TCP}]
endpoints: [{addresses: ["10.42.0.1"]}]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: aranchat-keyvault
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
          - {path: /api/keyvault, pathType: Prefix, backend: {service: {name: aranchat-keyvault, port: {number: 80}}}}
