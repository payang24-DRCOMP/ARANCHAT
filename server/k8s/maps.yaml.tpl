# แผนที่ของ รพ.: https://__CHAT_HOST__/maps → maps/server.mjs (pm2 aranchat-maps บนเครื่องนี้)
# aranchat-maps ฟังที่ 10.42.0.1:3214 (ฝั่ง host ของเครือข่าย pod) · ติดตั้ง: scripts/28-maps.sh
apiVersion: v1
kind: Service
metadata:
  name: aranchat-maps
  namespace: ess
spec:
  ports: [{name: http, port: 80, targetPort: 3214}]
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: aranchat-maps
  namespace: ess
  labels: {kubernetes.io/service-name: aranchat-maps}
addressType: IPv4
ports: [{name: http, port: 3214, protocol: TCP}]
endpoints: [{addresses: ["10.42.0.1"]}]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: aranchat-maps
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
          - {path: /maps, pathType: Prefix, backend: {service: {name: aranchat-maps, port: {number: 80}}}}
