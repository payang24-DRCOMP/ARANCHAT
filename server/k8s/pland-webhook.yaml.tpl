# ทางเข้า webhook จาก Plan-D: https://__CHAT_HOST__/api/pland/webhook → pland-bridge (pm2 บนเครื่องนี้, ฟัง 10.42.0.1:3213)
# ติดตั้ง: scripts/29-pland.sh route
apiVersion: v1
kind: Service
metadata:
  name: aranchat-pland-webhook
  namespace: ess
spec:
  ports: [{name: http, port: 80, targetPort: 3213}]
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: aranchat-pland-webhook
  namespace: ess
  labels: {kubernetes.io/service-name: aranchat-pland-webhook}
addressType: IPv4
ports: [{name: http, port: 3213, protocol: TCP}]
endpoints: [{addresses: ["10.42.0.1"]}]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: aranchat-pland-webhook
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
          - {path: /api/pland, pathType: Prefix, backend: {service: {name: aranchat-pland-webhook, port: {number: 80}}}}
