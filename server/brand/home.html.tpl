<!-- หน้าแรกของ AranChat (เห็นเมื่อยังไม่ได้เลือกห้อง) — config: embedded_pages.home_url
     Element ตัดแท็ก <style> และ class ในหน้านี้ทิ้ง เหลือเฉพาะ style="" ในแต่ละแท็ก → จัดหน้าด้วย inline style ทั้งหมด
     ลิงก์ #/dm #/new #/directory #/room/... เป็นคำสั่งของ Element · ลิงก์ arankub.com เปิดแท็บใหม่ -->
<div style="max-width:760px;margin:0 auto;padding:32px 24px;color:#1E1B4B;line-height:1.5">
  <div style="display:flex;align-items:center;gap:16px;padding:24px;border-radius:24px;background:#5B3FD9;color:#fff">
    <img src="https://__CHAT_HOST__/branding/icon-512.png?v=__BRAND_VER__" alt="" width="64" height="64" style="width:64px;height:64px;border-radius:16px;flex-shrink:0">
    <div>
      <h1 style="margin:0;font-size:24px;line-height:1.3;font-weight:700;color:#fff">ยินดีต้อนรับสู่ __BRAND__</h1>
      <p style="margin:4px 0 0;color:#E4DCFD">แชทและแจ้งเตือนในหน่วยงาน · เข้าด้วยบัญชี AranKub บัญชีเดียว</p>
    </div>
  </div>

  <a href="https://__CHAT_HOST__/download/" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:16px;margin-top:16px;padding:12px;border-radius:24px;background:#fff;border:1px solid #D9D0F5;text-decoration:none;color:#1E1B4B">
    <img src="https://__CHAT_HOST__/branding/download-hero.png?v=__BRAND_VER__" alt="" width="200" height="112" style="width:200px;max-width:40%;height:auto;border-radius:16px;flex-shrink:0">
    <span>
      <b style="display:block;font-size:18px;line-height:1.4">📲 ติดตั้งแอป __BRAND__</b>
      <span style="display:block;margin:4px 0 12px;font-size:14px;color:#64607A">Windows / Android / Linux · แจ้งเตือนเด้งทันที ไม่ต้องเปิดเว็บค้างไว้</span>
      <span style="display:inline-block;padding:8px 16px;border-radius:999px;background:#5B3FD9;color:#fff;font-weight:700;font-size:14px">ดาวน์โหลดแอป</span>
    </span>
  </a>

  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-top:16px">
    <a href="#/dm" style="display:flex;gap:12px;align-items:center;padding:16px;border-radius:16px;text-decoration:none;border:1px solid #ECE8F6;background:#fff;color:#1E1B4B"><span style="font-size:24px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:#EEE9FC;flex-shrink:0">💬</span><span><b style="display:block;font-size:15px;line-height:1.4">เริ่มแชทกับเพื่อน</b><span style="display:block;font-size:13px;line-height:1.4;color:#64607A">พิมพ์ชื่อจริงเพื่อค้นหา</span></span></a>
    <a href="#/new" style="display:flex;gap:12px;align-items:center;padding:16px;border-radius:16px;text-decoration:none;border:1px solid #ECE8F6;background:#fff;color:#1E1B4B"><span style="font-size:24px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:#EEE9FC;flex-shrink:0">👥</span><span><b style="display:block;font-size:15px;line-height:1.4">สร้างกลุ่ม</b><span style="display:block;font-size:13px;line-height:1.4;color:#64607A">ห้องทีม / แผนก / โครงการ</span></span></a>
    <a href="#/room/#staff:__SERVER_NAME__" style="display:flex;gap:12px;align-items:center;padding:16px;border-radius:16px;text-decoration:none;border:1px solid #ECE8F6;background:#fff;color:#1E1B4B"><span style="font-size:24px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:#EEE9FC;flex-shrink:0">🏥</span><span><b style="display:block;font-size:15px;line-height:1.4">ห้องรวมเจ้าหน้าที่</b><span style="display:block;font-size:13px;line-height:1.4;color:#64607A">ประกาศ ถามตอบ ทักทาย</span></span></a>
    <a href="https://__SERVER_NAME__/aranchat" target="_blank" rel="noopener" style="display:flex;gap:12px;align-items:center;padding:16px;border-radius:16px;text-decoration:none;border:1px solid #ECE8F6;background:#fff;color:#1E1B4B"><span style="font-size:24px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:#EEE9FC;flex-shrink:0">🔗</span><span><b style="display:block;font-size:15px;line-height:1.4">ชวนเพื่อนมาใช้</b><span style="display:block;font-size:13px;line-height:1.4;color:#64607A">QR / ลิงก์ / ส่งทาง LINE</span></span></a>
    <a href="https://__SERVER_NAME__/aranchat" target="_blank" rel="noopener" style="display:flex;gap:12px;align-items:center;padding:16px;border-radius:16px;text-decoration:none;border:1px solid #ECE8F6;background:#fff;color:#1E1B4B"><span style="font-size:24px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:#EEE9FC;flex-shrink:0">🔔</span><span><b style="display:block;font-size:15px;line-height:1.4">เลือกเรื่องแจ้งเตือน</b><span style="display:block;font-size:13px;line-height:1.4;color:#64607A">เปิด/ปิดแจ้งเตือนรายเรื่อง</span></span></a>
    <a href="#/directory" style="display:flex;gap:12px;align-items:center;padding:16px;border-radius:16px;text-decoration:none;border:1px solid #ECE8F6;background:#fff;color:#1E1B4B"><span style="font-size:24px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:#EEE9FC;flex-shrink:0">🔎</span><span><b style="display:block;font-size:15px;line-height:1.4">ค้นหาห้อง</b><span style="display:block;font-size:13px;line-height:1.4;color:#64607A">ห้องสาธารณะในหน่วยงาน</span></span></a>
  </div>

  <div style="margin-top:24px;padding:16px 24px;border-radius:16px;background:#F7F5FC;border:1px solid #ECE8F6;color:#3F3A5C">
    <h3 style="margin:0 0 8px;font-size:16px">💡 ใช้งานเบื้องต้น</h3>
    <ul style="margin:0;padding-left:24px">
      <li style="margin:4px 0">แจ้งเตือนจาก AranKub / P4P / สปสช. ส่งมาที่แชท <b>"ARANKUB AI"</b> · ไม่อยากรับเรื่องไหน พิมพ์ <b>ปิด</b> ตามด้วยหมายเลข</li>
      <li style="margin:4px 0">มือถือ: ติดตั้งแอปแล้วเข้าระบบด้วยบัญชี AranKub เดียวกัน · Samsung/Oppo/Vivo ตั้งค่าแบตเตอรี่ให้แอป "ไม่จำกัด" ไม่งั้นแจ้งเตือนไม่เด้ง</li>
      <li style="margin:4px 0">กลับมาหน้านี้: กดรูปโปรไฟล์มุมซ้ายบน → หน้าแรก</li>
    </ul>
  </div>
</div>
