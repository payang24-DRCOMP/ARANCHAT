<!doctype html>
<!-- หน้าชวนเพื่อน / แชร์กลุ่ม — https://__CHAT_HOST__/i/<รหัส>
     nginx ส่งต่อไป notify (/api/notify/invite/<รหัส>/page) ซึ่งเติม __TITLE__ __CODE__ __DATA__ (notify/invites.mjs)
     แก้หน้าตา: แก้ไฟล์นี้แล้วรัน scripts/09-branding.sh (notify อ่านไฟล์ใหม่เอง ไม่ต้อง restart) -->
<html lang="th" translate="no">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="google" content="notranslate">
  <meta name="robots" content="noindex">
  <title>__TITLE__</title>
  <link rel="icon" href="/branding/icon-120.png?v=__BRAND_VER__">
  <!-- ฟอนต์ไทย Sarabun ของแบรนด์ (เครื่องที่ไม่มีฟอนต์ไทยในระบบก็อ่านได้) -->
  <link rel="stylesheet" href="/branding/aranchat.css?v=__BRAND_VER__">
  <!-- ตัวอย่างลิงก์ใน LINE / Facebook / Teams -->
  <meta property="og:title" content="__TITLE__">
  <meta property="og:description" content="แตะเพื่อเปิดแชท — แอปแชทของบุคลากร ใช้บัญชี AranKub เข้าสู่ระบบ ข้อความเข้ารหัส">
  <meta property="og:image" content="https://__CHAT_HOST__/branding/icon-512.png?v=__BRAND_VER__">
  <meta property="og:type" content="website">
  <style>
    :root { --brand: #5B3FD9; --ink: #1E1350; --muted: #64748B; --bg: #F1EEF9; --card: #fff; }
    @media (prefers-color-scheme: dark) { :root { --ink: #EDE9FE; --muted: #A5A1C2; --bg: #15112B; --card: #211B3F; } }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px;
           background: var(--bg); color: var(--ink); font-family: "Inter", "Sarabun", "Noto Sans Thai", system-ui, sans-serif; }
    .card { width: 100%; max-width: 420px; background: var(--card); border-radius: 28px; padding: 32px 24px 24px; text-align: center;
            box-shadow: 0 12px 40px rgba(26, 15, 77, .12); }
    .logo { display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--muted); font-weight: 600; margin-bottom: 24px; }
    .logo img { width: 28px; height: 28px; border-radius: 8px; }
    .avatar { width: 96px; height: 96px; border-radius: 50%; margin: 0 auto 14px; display: flex; align-items: center; justify-content: center;
              background: linear-gradient(135deg, #8B5CF6, #5B3FD9); color: #fff; font-size: 40px; font-weight: 700; overflow: hidden; }
    .avatar img { width: 100%; height: 100%; object-fit: cover; }
    h1 { font-size: 22px; line-height: 1.35; margin: 0 0 6px; }
    .sub { color: var(--muted); margin: 0 0 24px; font-size: 15px; }
    .btn { display: block; width: 100%; padding: 14px 18px; border-radius: 999px; font-size: 17px; font-weight: 600; text-decoration: none;
           margin-top: 10px; border: 0; cursor: pointer; font-family: inherit; }
    .primary { background: var(--brand); color: #fff; }
    .secondary { background: transparent; color: var(--brand); border: 1.5px solid #D9D0F5; }
    .note { margin-top: 18px; font-size: 13px; color: var(--muted); line-height: 1.6; }
    .hint { display: none; margin-top: 14px; padding: 12px 14px; border-radius: 16px; background: rgba(91, 63, 217, .08); font-size: 14px; text-align: left; line-height: 1.6; }
  </style>
</head>
<body>
  <main class="card">
    <div class="logo"><img src="/branding/icon-120.png?v=__BRAND_VER__" alt="">__BRAND__</div>
    <div class="avatar" id="av"></div>
    <h1 id="title">__TITLE__</h1>
    <p class="sub" id="sub"></p>
    <div id="actions"></div>
    <div class="hint" id="ios-hint">
      <b>บน iPhone/iPad:</b> เปิดหน้านี้ใน Safari → แตะปุ่มแชร์ (สี่เหลี่ยมมีลูกศรขึ้น) → <b>เพิ่มไปยังหน้าจอโฮม</b> แล้วเปิด __BRAND__ จากไอคอน จะได้รับแจ้งเตือนเหมือนแอป
    </div>
    <p class="note">สำหรับบุคลากร · เข้าสู่ระบบด้วยบัญชี AranKub<br>🔒 ข้อความเข้ารหัส เก็บบนเซิร์ฟเวอร์ของหน่วยงาน</p>
  </main>
  <script>
    (function () {
      var code = "__CODE__", d = __DATA__;
      var $ = function (id) { return document.getElementById(id); };
      var ua = navigator.userAgent;
      var android = /Android/i.test(ua), ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      var web = "/?invite=" + code + "#/home";
      var btn = function (text, href, cls) {
        var a = document.createElement("a"); a.className = "btn " + cls; a.textContent = text; a.href = href; $("actions").appendChild(a);
      };
      if (!d) {
        $("av").textContent = "?";
        $("sub").textContent = "ลิงก์อาจหมดอายุหรือพิมพ์ผิด ขอลิงก์ใหม่จากเพื่อนได้เลย";
        btn("เปิด __BRAND__", "/", "primary");
        return;
      }
      var name = d.kind === "room" ? d.room_name : d.name;
      $("av").textContent = (name || "?").trim().charAt(0);
      if (d.has_avatar) {
        var img = new Image(); img.alt = "";
        img.onload = function () { $("av").textContent = ""; $("av").appendChild(img); };
        img.src = "/api/notify/invite/" + code + "/avatar";
      }
      if (d.kind === "room") {
        $("title").textContent = "เข้ากลุ่ม “" + d.room_name + "”";
        $("sub").textContent = d.name + " ชวนคุณ · สมาชิก " + d.members + " คน · ผู้ดูแลกลุ่มจะอนุมัติให้";
      } else {
        $("title").textContent = d.name;
        $("sub").textContent = "ชวนคุณมาคุยกันบน __BRAND__";
      }
      var open = d.kind === "room" ? "ขอเข้าร่วมกลุ่ม" : "เริ่มแชทกับ " + d.name;
      if (android) {
        // เปิดแอป AranChat ตรง (มีแอปแล้ว) — ใช้ได้แม้เปิดลิงก์ในเบราว์เซอร์ของ LINE · ไม่มีแอป → หน้าติดตั้ง
        var fallback = encodeURIComponent(location.origin + "/download/latest?os=android");
        btn(open + " ในแอป", "intent://" + location.host + "/i/" + code + "#Intent;scheme=https;package=com.arankub.aranchat;S.browser_fallback_url=" + fallback + ";end", "primary");
        btn("เปิดบนเว็บแทน", web, "secondary");
      } else if (ios) {
        btn(open, web, "primary");
        $("ios-hint").style.display = "block";
      } else {
        btn(open, web, "primary");
        btn("ติดตั้งแอปบนคอมพิวเตอร์", "/download/", "secondary");
      }
      // จำรหัสไว้ — ล็อกอินผ่าน AranKub แล้วกลับมา แอปเปิดแชท/กลุ่มให้เอง (src/aranchat/invites.ts)
      try { localStorage.setItem("aranchat_invite", code); } catch (e) {}
    })();
  </script>
</body>
</html>
