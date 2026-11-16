# AranChat — ตัวส่ง Web Push (iPhone/เว็บ) = webpush ของ Sygnal + ย่อข้อความให้ไม่เกินขนาดที่ Apple/Google รับ (4 KB)
# Sygnal เข้ารหัส JSON แบบ ASCII: ภาษาไทย 1 ตัว = \uXXXX 6 ไบต์ ข้อความยาว/การ์ด (com.arankub.card) จึงเกินบ่อย
# → ส่งเฉพาะที่ใช้แสดงแจ้งเตือน (sw.js ของเว็บแชท): msgtype, body (ตัดให้พอดี), หัวการ์ด
# ใช้ใน k8s/sygnal.yaml.tpl: type: aranwebpush.AranWebpushPushkin (โฟลเดอร์นี้ mount ที่ /plugins + PYTHONPATH)
import json

from sygnal.webpushpushkin import WebpushPushkin

MAX_JSON = 2800  # ไบต์ก่อนเข้ารหัส (+~100 ไบต์ header/padding) — เผื่อจาก 4096

_orig = WebpushPushkin._build_payload


def _trimmed(n, device):
    p = _orig(n, device)
    c = p.get("content")
    if isinstance(c, dict):
        keep = {k: c[k] for k in ("msgtype", "body") if isinstance(c.get(k), str)}
        card = c.get("com.arankub.card")
        if isinstance(card, dict) and isinstance(card.get("title"), str):
            keep["com.arankub.card"] = {
                "title": card["title"][:120],
                "icon": str(card.get("icon") or "")[:8],
                "urgent": card.get("urgent") is True,
            }
        p["content"] = keep
        body = keep.get("body")
        while isinstance(body, str) and len(body) > 20 and len(json.dumps(p)) > MAX_JSON:
            body = body[: int(len(body) * 0.7)].rstrip()
            keep["body"] = body + "…"
    for k in ("room_name", "sender_display_name"):
        if isinstance(p.get(k), str):
            p[k] = p[k][:80]
    return p


# Sygnal เรียก WebpushPushkin._build_payload(...) ผ่านชื่อคลาสตรงๆ จึงต้องแทนที่ที่คลาสแม่
WebpushPushkin._build_payload = staticmethod(_trimmed)


class AranWebpushPushkin(WebpushPushkin):
    pass
