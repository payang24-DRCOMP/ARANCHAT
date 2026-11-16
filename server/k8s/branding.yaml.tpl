# เสิร์ฟไฟล์แบรนด์ (โลโก้/พื้นหลัง/ไอคอน) ที่ https://__CHAT_HOST__/branding/...
# ใช้ nginx ตัวเล็กใน K3s + ingress path เฉพาะบนโดเมนเดียวกับเว็บแชท
# และแทนที่จุดที่ Element Web ฝังชื่อ "Element" ไว้ในไฟล์ (ตั้งผ่าน config ไม่ได้):
#   /vector-icons/*  ไอคอนแท็บ/หน้าจอโฮม   /manifest.json  ชื่อตอนติดตั้งเป็นแอป
#   / ทั้งหมด  เว็บแชทของเรา (~/aranchat-apps/web-dist/live จาก scripts/14-web-beta.sh live)
#              ถ้าไม่มีโฟลเดอร์ live (scripts/15-web-switch.sh off) → ส่งต่อ Element Web เดิม + แก้ <title> ฯลฯ
apiVersion: v1
kind: ConfigMap
metadata:
  name: aranchat-branding-nginx
  namespace: ess
data:
  default.conf: |
    server {
      listen 80;
      root /usr/share/nginx/html;

      # ไฟล์ติดตั้งแอป AranChat (Android / Windows / Linux) — ~/aranchat-apps/dist บนเครื่อง host
      # เว็บแชทตัวที่ build จากซอร์สของเรา (ทดลองก่อนสลับ) — scripts/14-web-beta.sh → ~/aranchat-apps/web-dist/beta
      location ^~ /beta/ {
        alias /usr/share/nginx/html/web/beta/;
        index index.html;
        location ~ (index\.html|config\.json|/)$ { add_header Cache-Control "no-cache"; }
      }

      # หน้าดาวน์โหลดแบบมีภาพ (brand/download.html) · ไฟล์ติดตั้งอยู่ใต้ /download/<ไฟล์>
      location = /download/ {
        default_type text/html;
        charset utf-8;
        add_header Cache-Control "no-cache";
        try_files /branding/download.html =404;
        sub_filter 'branding/aranchat.js"' 'branding/aranchat.js?v=__HASH__"';
      }
      # คู่มือเชื่อมระบบอื่นเข้ากับการแจ้งเตือน (brand/connect.html) — API จริงอยู่ที่ /api/notify (k8s/notify-api.yaml.tpl)
      location = /connect/ {
        default_type text/html;
        charset utf-8;
        add_header Cache-Control "no-cache";
        try_files /branding/connect.html =404;
      }
      location = /connect { return 301 /connect/; }
      # คู่มือการ์ด/ปุ่ม/คำสั่งบอท/มินิแอป (docs-site/bot → scripts/25-docs.sh → ~/aranchat-apps/web-dist/docs/bot) — มีรูป จึงไม่อยู่ใน configmap
      location ^~ /connect/bot/ {
        alias /usr/share/nginx/html/web/docs/bot/;
        index index.html;
        charset utf-8;
        add_header Cache-Control "no-cache";
      }
      # ลิงก์ชวนเพื่อน / แชร์กลุ่ม (brand/invite.html.tpl) — notify เติมชื่อผู้ชวนลงหน้า (notify/invites.mjs)
      location ~ "^/i/[a-z0-9]{8}/?$" {
        rewrite "^/i/([a-z0-9]{8})/?$" /api/notify/invite/$1/page break;
        proxy_pass http://aranchat-notify-api.ess.svc.cluster.local:80;   # ไม่ใส่ตัวแปร (ใส่แล้ว nginx ต้องมี resolver)
        proxy_set_header Host $host;
      }
      # ไฟล์ติดตั้งรุ่นล่าสุดที่ตรงกับเครื่อง (ระบบแจ้งเตือนดู User-Agent แล้วส่งต่อไปไฟล์ — notify/server.mjs latestDownload)
      location = /download/latest {
        proxy_pass http://aranchat-notify-api.ess.svc.cluster.local:80/api/notify/download;   # ไม่ใส่ตัวแปร (ใส่แล้ว nginx ต้องมี resolver) · query string ส่งต่อเอง
        proxy_set_header User-Agent $http_user_agent;
      }

      location /download/ {
        autoindex on;
        charset utf-8;
        types { application/vnd.android.package-archive apk; application/octet-stream exe; application/vnd.debian.binary-package deb; }
        add_header Cache-Control "no-cache";
      }

      # ชุดสติกเกอร์บน server (scripts/24-stickers.py → ~/aranchat-apps/web-dist/stickers) — แอป Desktop/Android โหลดข้ามโดเมน
      location ^~ /stickers/ {
        alias /usr/share/nginx/html/web/stickers/;
        add_header Access-Control-Allow-Origin "*";
        add_header Cache-Control "public, max-age=300";   # เพิ่มชุดใหม่ → ทุกเครื่องเห็นภายใน 5 นาที
      }

      location /branding/ {
        add_header Cache-Control "public, max-age=3600";
        # แอป AranChat Desktop ดึงหน้าแรก (home.html) ข้ามโดเมน — ไฟล์แบรนด์เป็นสาธารณะอยู่แล้ว
        add_header Access-Control-Allow-Origin "*";
      }

      # ชื่อไฟล์ไอคอนของ Element Web มี hash ตามเวอร์ชัน (24.97ab000.png) → ตัด hash แล้วส่งไอคอนเรา
      # หน้าแรกชี้มาที่ /vector-icons/<hash แบรนด์>/… — เปลี่ยนแบรนด์เมื่อไร URL ก็เปลี่ยน
      # Cloudflare/เบราว์เซอร์จึงไม่ค้างไอคอนเก่า (ไอคอนเก่าของ Element เคยค้าง cache Cloudflare 4 ชม.)
      location ~ ^/vector-icons/(?:[0-9a-f]+/)?(\d+)(\.[0-9a-f]+)?\.png$ {
        try_files /branding/icon-$1.png =404;
      }
      location = /manifest.json {
        default_type application/manifest+json;
        try_files /branding/manifest.json =404;
      }
      location = /favicon.ico {
        default_type image/png;
        try_files /branding/icon-24.png =404;
      }

      # ภาษาไทย (scripts/11-thai.sh): รายชื่อภาษาที่เพิ่ม "th" + ไฟล์คำแปล · ไฟล์ภาษาอื่นส่งต่อให้ Element Web
      # เว็บแชทของเรามีไฟล์ภาษาไทยในตัวแล้ว (/web/live/i18n) — ไม่มีก็ใช้ชุดสำหรับ Element Web เดิม
      location = /i18n/languages.json {
        default_type application/json;
        add_header Cache-Control "no-cache";
        try_files /web/live/i18n/languages.json /i18n-th/languages.json @element;
      }
      location ~ ^/i18n/th\.[0-9a-f]+\.json$ {
        default_type application/json;
        try_files /web/live$uri /i18n-th/th.json =404;
      }
      location /i18n/ {
        try_files /web/live$uri @element;
      }
      location @element {
        proxy_pass http://ess-element-web.ess.svc.cluster.local:80;
      }

      # เว็บแชทของเรา (ตัวจริง) — ไฟล์ใน bundles/ มี hash ในชื่อ เก็บ cache ได้นาน
      location / {
        try_files /web/live$uri @element;
      }
      location /bundles/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files /web/live$uri @element;
      }
      location ~ ^/(config(\.[a-z0-9.-]+)?\.json|version|sw\.js)$ {
        add_header Cache-Control "no-cache";
        try_files /web/live$uri @element;
      }
      location ~ ^/(index\.html)?$ {
        add_header Cache-Control "no-cache";
        try_files /web/live/index.html @element_index;
      }
      location @element_index {
        proxy_pass http://ess-element-web.ess.svc.cluster.local:80;
        proxy_set_header Host $host;
        proxy_set_header Accept-Encoding "";   # sub_filter แก้ได้เฉพาะเนื้อหาที่ไม่บีบอัด
        sub_filter_once off;
        sub_filter '<title>Element</title>' '<title>__BRAND__</title>';
        sub_filter 'name="apple-mobile-web-app-title" content="Element"' 'name="apple-mobile-web-app-title" content="__BRAND__"';
        sub_filter 'https://app.element.io/themes/element/img/logos/opengraph.png' 'https://__CHAT_HOST__/branding/icon-512.png';
        sub_filter 'href="vector-icons/' 'href="vector-icons/__HASH__/';
        # ปิด Google Translate ของ Chrome — มันแก้ DOM ที่ React คุมอยู่ ทำให้หน้าต่างย่อยของ Element พัง
        # ("ไม่สามารถโหลดได้! โปรดตรวจสอบการเชื่อมต่อเครือข่าย") · หน้าเว็บเป็นภาษาไทยอยู่แล้วจึงไม่ต้องแปล
        sub_filter '<html lang="en"' '<html lang="th" translate="no"';
        sub_filter '<head>' '<head><meta name="google" content="notranslate">';
        # aranchat-early.js: มือถือไม่เด้งไป /mobile_guide/ + ภาษาไทยเริ่มต้น — ต้องเป็นไฟล์ (CSP ของ Element ห้าม inline script)
        # aranchat.css: ฟอนต์ไทย สีฟองข้อความ ฯลฯ (brand/aranchat.css) · aranchat.js: การ์ด/ปุ่มดาวน์โหลดแอป · aranchat-nav.js: แถบเมนูซ้าย · ?v= เปลี่ยนตามแบรนด์ ไม่ค้าง cache
        sub_filter '</head>' '<link rel="stylesheet" href="branding/aranchat.css?v=__HASH__"><link rel="stylesheet" href="branding/aranchat-layout.css?v=__HASH__"><script src="branding/aranchat.js?v=__HASH__" defer></script><script src="branding/aranchat-nav.js?v=__HASH__" defer></script><script src="branding/aranchat-early.js?v=__HASH__"></script></head>';
      }
    }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aranchat-branding
  namespace: ess
spec:
  replicas: 1
  selector:
    matchLabels: {app: aranchat-branding}
  template:
    metadata:
      labels: {app: aranchat-branding}
      annotations:
        aranchat/config-hash: "__HASH__"
    spec:
      containers:
        - name: nginx
          image: nginx:1.27-alpine
          ports: [{containerPort: 80}]
          readinessProbe:
            httpGet: {path: /branding/manifest.json, port: 80}
          resources:
            requests: {cpu: 10m, memory: 16Mi}
            limits: {memory: 64Mi}
          volumeMounts:
            - {name: files, mountPath: /usr/share/nginx/html/branding, readOnly: true}
            - {name: conf, mountPath: /etc/nginx/conf.d, readOnly: true}
            - {name: i18n, mountPath: /usr/share/nginx/html/i18n-th, readOnly: true}
            - {name: download, mountPath: /usr/share/nginx/html/download, readOnly: true}
            - {name: web, mountPath: /usr/share/nginx/html/web, readOnly: true}
      volumes:
        # เครื่องเดียว (single-node K3s) → ใช้โฟลเดอร์บน host ตรงๆ ได้ · build แอปใหม่แล้ววางไฟล์ที่นี่
        - name: download
          hostPath: {path: /home/payang/aranchat-apps/dist, type: DirectoryOrCreate}
        - name: web
          hostPath: {path: /home/payang/aranchat-apps/web-dist, type: DirectoryOrCreate}
        - name: i18n
          configMap: {name: aranchat-i18n-web, optional: true}
        - name: files
          configMap: {name: aranchat-branding}
        - name: conf
          configMap: {name: aranchat-branding-nginx}
---
apiVersion: v1
kind: Service
metadata:
  name: aranchat-branding
  namespace: ess
spec:
  selector: {app: aranchat-branding}
  ports: [{port: 80, targetPort: 80}]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: aranchat-branding
  namespace: ess
  annotations:
    # Traefik จัดลำดับตามความยาวกฎ — Path(`/`) สั้นกว่า PathPrefix(`/`) ของ Element Web จึงต้องดันลำดับขึ้น
    traefik.ingress.kubernetes.io/router.priority: "1000"
spec:
  ingressClassName: traefik
  rules:
    - host: __CHAT_HOST__
      http:
        paths:
          - {path: /branding, pathType: Prefix, backend: {service: {name: aranchat-branding, port: {number: 80}}}}
          - {path: /vector-icons, pathType: Prefix, backend: {service: {name: aranchat-branding, port: {number: 80}}}}
          - {path: /manifest.json, pathType: Exact, backend: {service: {name: aranchat-branding, port: {number: 80}}}}
          - {path: /favicon.ico, pathType: Exact, backend: {service: {name: aranchat-branding, port: {number: 80}}}}
          - {path: /i18n, pathType: Prefix, backend: {service: {name: aranchat-branding, port: {number: 80}}}}
          - {path: /download, pathType: Prefix, backend: {service: {name: aranchat-branding, port: {number: 80}}}}
          - {path: /beta, pathType: Prefix, backend: {service: {name: aranchat-branding, port: {number: 80}}}}
          # ทั้งโดเมน → nginx นี้ (เว็บแชทของเรา หรือส่งต่อ Element Web เดิมเมื่อปิด)
          - {path: /, pathType: Prefix, backend: {service: {name: aranchat-branding, port: {number: 80}}}}
