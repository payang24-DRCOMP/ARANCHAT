<!doctype html>
<!-- หน้าดาวน์โหลดแอป __BRAND__ — https://__CHAT_HOST__/download/ (nginx: location = /download/)
     รายชื่อระบบ/ไฟล์/วิธีติดตั้งอยู่ใน aranchat.js (ใช้ร่วมกับการ์ดหน้า login และปุ่มในหน้าแชท) -->
<html lang="th" translate="no">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="google" content="notranslate">
  <title>ดาวน์โหลดแอป __BRAND__</title>
  <link rel="icon" href="/branding/icon-120.png?v=__BRAND_VER__">
  <link rel="stylesheet" href="/branding/aranchat.css">
  <meta property="og:title" content="ดาวน์โหลดแอป __BRAND__">
  <meta property="og:image" content="https://__CHAT_HOST__/branding/icon-512.png?v=__BRAND_VER__">
  <style>
    body { margin: 0; background: #F1EEF9; color: #0F172A; font-family: "Inter", "Sarabun", "Noto Sans Thai", system-ui, sans-serif; }
    .wrap { max-width: 980px; margin: 0 auto; padding: 24px 16px 48px; }
    header { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
    header img { width: 44px; height: 44px; border-radius: 12px; }
    header b { font-size: 20px; }
    header a { margin-left: auto; padding: 8px 16px; border-radius: 999px; background: #fff; color: #5B3FD9; text-decoration: none; font-weight: 600; border: 1px solid #D9D0F5; }
    .hero { display: grid; grid-template-columns: 1.1fr 1fr; gap: 24px; align-items: center; padding: 20px; border-radius: 28px; background: #fff; box-shadow: 0 10px 30px rgba(26,15,77,.08); }
    .hero img { width: 100%; border-radius: 20px; display: block; }
    .hero h1 { margin: 0 0 6px; font-size: 30px; line-height: 1.3; }
    .hero p { margin: 0 0 16px; color: #475569; font-size: 16px; }
    .hero ul { margin: 0 0 18px; padding: 0; list-style: none; color: #334155; }
    .hero li { margin: 6px 0; }
    #hero-btn .ac-main { font-size: 17px; padding: 14px 20px; }
    footer { margin-top: 28px; text-align: center; color: #64748B; font-size: 13px; }
    footer a { color: #5B3FD9; }
    @media (max-width: 760px) { .hero { grid-template-columns: 1fr; } .hero h1 { font-size: 24px; } }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <img src="/branding/icon-120.png?v=__BRAND_VER__" alt="">
      <b>__BRAND__</b>
      <a href="https://__CHAT_HOST__/">เปิดเว็บแชท</a>
    </header>

    <section class="hero">
      <img src="/branding/download-hero.png?v=__BRAND_VER__" alt="แอป __BRAND__ บนคอมพิวเตอร์และมือถือ">
      <div>
        <h1>ติดตั้งแอป __BRAND__</h1>
        <p>แชทกับเพื่อนร่วมงานและรับแจ้งเตือนจากระบบงาน ใช้บัญชี AranKub บัญชีเดียว</p>
        <ul>
          <li>🔔 แจ้งเตือนเด้งทันที ไม่ต้องเปิดเว็บค้างไว้</li>
          <li>💬 แชทเดี่ยว / กลุ่ม / ส่งรูปและไฟล์</li>
          <li>🔒 ข้อมูลอยู่บนเซิร์ฟเวอร์ของหน่วยงาน</li>
        </ul>
        <div class="ac-dl" id="hero-btn"></div>
      </div>
    </section>

    <div id="ac-download"></div>

    <footer>
      เข้าสู่ระบบด้วยบัญชี AranKub · มีปัญหาการติดตั้ง ติดต่อผู้ดูแลระบบ<br>
      แอปพัฒนาต่อจาก Element (AGPL-3.0) · <a href="https://__CHAT_HOST__/">__CHAT_HOST__</a>
    </footer>
  </div>
  <script src="/branding/aranchat.js"></script>
  <script>
    AranChat.renderFull(document.getElementById("ac-download"));
    var k = AranChat.os, a = AranChat.apps[k];
    document.getElementById("hero-btn").innerHTML = a.file
      ? '<a class="ac-main" data-dl="' + k + '" href="/download/' + a.file + '" download>' + AranChat.downloadIcon + ' ดาวน์โหลดสำหรับ ' + a.name + '<span class="ac-hero-ver"></span></a>'
      : '<a class="ac-main" href="#' + k + '">' + a.icon + " วิธีติดตั้งบน " + a.name + "</a>";
    // เลขรุ่นบนปุ่มใหญ่ (renderFull อ่าน latest.json แล้วเรียกฟังก์ชันนี้)
    window.AranChatOnLatest = function (ver) {
      var e = document.querySelector(".ac-hero-ver");
      if (e && ver[k]) e.textContent = " (รุ่น " + ver[k] + ")";
    };
  </script>
</body>
</html>
