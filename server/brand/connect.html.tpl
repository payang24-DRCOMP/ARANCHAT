<!doctype html>
<!-- คู่มือเชื่อมระบบอื่นเข้ากับการแจ้งเตือน __BRAND__ — https://__CHAT_HOST__/connect/ (nginx: location = /connect/)
     API จริงอยู่ใน notify/server.mjs (ส่วน "ทางเข้าจากระบบอื่น") · แก้ไฟล์นี้แล้วรัน scripts/09-branding.sh -->
<html lang="th" translate="no">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="google" content="notranslate">
  <title>เชื่อมระบบกับ __BRAND__</title>
  <link rel="icon" href="/branding/icon-120.png?v=__BRAND_VER__">
  <link rel="stylesheet" href="/branding/aranchat.css">
  <style>
    :root { --brand: #5B3FD9; --ink: #0F172A; --muted: #475569; --line: #E4DCFD; --tint: #F4F1FC; --code: #1E1B3A; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #F1EEF9; color: var(--ink); font-family: "Inter", "Sarabun", "Noto Sans Thai", system-ui, sans-serif; line-height: 1.6; }
    .wrap { max-width: 920px; margin: 0 auto; padding: 24px 16px 48px; }
    header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    header img { width: 44px; height: 44px; border-radius: 12px; }
    header b { font-size: 20px; }
    header a { margin-left: auto; padding: 8px 16px; border-radius: 999px; background: #fff; color: var(--brand); text-decoration: none; font-weight: 600; border: 1px solid var(--line); }
    section { background: #fff; border-radius: 24px; padding: 24px; margin-bottom: 16px; box-shadow: 0 8px 24px rgba(26,15,77,.06); }
    h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.3; }
    h2 { margin: 0 0 12px; font-size: 20px; }
    p { margin: 0 0 12px; color: var(--muted); }
    .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 16px; }
    .step { background: var(--tint); border-radius: 16px; padding: 16px; }
    .step b { display: block; margin-bottom: 4px; }
    .step span { color: var(--muted); font-size: 14px; }
    .step .n { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 999px; background: var(--brand); color: #fff; font-weight: 700; font-size: 14px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { color: var(--muted); font-weight: 600; }
    code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Sarabun", "Noto Sans Thai", monospace; font-size: 13px; background: var(--tint); padding: 2px 6px; border-radius: 6px; color: #3B2A9E; }
    pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Sarabun", "Noto Sans Thai", monospace; margin: 0; background: var(--code); color: #EDE9FE; padding: 16px; border-radius: 16px; overflow-x: auto; font-size: 13px; line-height: 1.55; }
    pre code { background: none; color: inherit; padding: 0; }
    .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .tabs button { border: 1px solid var(--line); background: #fff; color: var(--ink); padding: 8px 16px; border-radius: 999px; font: inherit; font-weight: 600; cursor: pointer; transition: transform 300ms cubic-bezier(0.22,1,0.36,1); }
    .tabs button[aria-selected="true"] { background: var(--brand); border-color: var(--brand); color: #fff; }
    .tabs button:active { transform: scale(.98); }
    .note { background: #FFF7ED; border-radius: 16px; padding: 12px 16px; color: #9A3412; font-size: 14px; }
    .try { display: grid; gap: 8px; }
    .try input, .try select { font: inherit; padding: 8px 12px; border: 1px solid var(--line); border-radius: 12px; width: 100%; }
    .try button { justify-self: start; font: inherit; font-weight: 600; padding: 8px 24px; border-radius: 999px; border: 0; background: var(--brand); color: #fff; cursor: pointer; }
    #out { white-space: pre-wrap; }
    footer { margin-top: 24px; text-align: center; color: #64748B; font-size: 13px; }
    @media (max-width: 760px) { .steps { grid-template-columns: 1fr; } h1 { font-size: 24px; } section { padding: 16px; } }
  </style>
</head>
<body>
<div class="wrap">
  <header>
    <img src="/branding/icon-120.png?v=__BRAND_VER__" alt="">
    <b>__BRAND__</b>
    <a href="https://__CHAT_HOST__/">เปิดเว็บแชท</a>
  </header>

  <section>
    <h1>ส่งแจ้งเตือนจากระบบของคุณเข้า __BRAND__</h1>
    <p>ระบบใดก็ได้ (HOSxP, PHP, Python, งานตั้งเวลา, เครื่องมือเฝ้าระบบ) ส่งแจ้งเตือนเข้าแชทได้ด้วยคำสั่ง HTTP เดียว
       ผู้รับเห็นเป็นการ์ดในแชท และเด้งเตือนบนมือถือ/คอมทันที</p>
    <div class="steps">
      <div class="step"><span class="n">1</span><b>ขอ key ของระบบ</b><span>ผู้ดูแลเพิ่มระบบที่ AranKub → ตั้งค่า → การแจ้งเตือน AranChat แล้วส่ง key ให้ (1 ระบบ 1 key)</span></div>
      <div class="step"><span class="n">2</span><b>เลือกผู้รับ</b><span>ส่งเข้าห้องแจ้งเตือน (ทุกคนในห้องเห็น) หรือส่งถึงรายคน</span></div>
      <div class="step"><span class="n">3</span><b>ส่ง POST</b><span>ไปที่ <code>https://__CHAT_HOST__/api/notify</code> พร้อม key — ดูตัวอย่างด้านล่าง</span></div>
    </div>
    <p class="note" style="margin-top:16px;color:#3B2A9E;background:#F4F1FC">ใหม่: การ์ดจัดหน้า (ตาราง ขั้นตอน ตัวเลขสรุป) · ปุ่มอนุมัติ/รับเคส/เลือกวันเวลาที่ส่งผลกลับระบบ · คำสั่ง / · เมนูบอท · มินิแอป —
      <a href="/connect/bot/"><b>ดูคู่มือการ์ดและบอท →</b></a></p>
  </section>

  <section>
    <h2>ข้อมูลที่ส่ง</h2>
    <pre><code>POST https://__CHAT_HOST__/api/notify
Authorization: Bearer &lt;key ของระบบ&gt;
Content-Type: application/json

{
  "event": "lab.critical",
  "title": "ค่าวิกฤต K 6.8 mmol/L",
  "text": "หอผู้ป่วยอายุรกรรมชาย เตียง 12",
  "to": ["room:lab-critical"],
  "link": "https://...",
  "priority": "urgent",
  "id": "LAB-2026-000123"
}</code></pre>
    <table style="margin-top:12px">
      <tr><th>ช่อง</th><th>จำเป็น</th><th>ความหมาย</th></tr>
      <tr><td><code>event</code></td><td>✓</td><td>รหัสเรื่อง (a-z 0-9 . _ -) เช่น <code>lab.critical</code> · เรื่องใหม่ขึ้นในหน้าจัดการเอง ผู้ดูแลตั้งชื่อ/ไอคอน/ผู้รับประจำได้</td></tr>
      <tr><td><code>title</code></td><td>✓</td><td>หัวข้อ — ข้อความที่เด้งบนจอมือถือ (ไม่เกิน 200 ตัวอักษร)</td></tr>
      <tr><td><code>text</code></td><td></td><td>รายละเอียด หลายบรรทัดได้ (ไม่เกิน 2,000 ตัวอักษร)</td></tr>
      <tr><td><code>to</code></td><td></td><td>รายชื่อผู้รับ (ดูตารางถัดไป) · ไม่ใส่ = ใช้ผู้รับประจำ/ห้องประจำที่ผู้ดูแลตั้งไว้กับเรื่องนี้</td></tr>
      <tr><td><code>link</code></td><td></td><td>ลิงก์ปุ่ม "เปิดดู" (http/https)</td></tr>
      <tr><td><code>priority</code></td><td></td><td><code>normal</code> (ค่าเริ่มต้น) หรือ <code>urgent</code> = การ์ดหัวสีแดง ป้าย 🔴 ด่วน และปุ่ม "รับทราบ"</td></tr>
      <tr><td><code>fields</code></td><td></td><td>ช่องข้อมูลในการ์ด เช่น <code>{"HN": "0012345", "หน่วยงาน": "ER"}</code> · ไม่ส่งก็ได้ บรรทัด <code>ชื่อ: ค่า</code> ใน <code>text</code> จะกลายเป็นช่องข้อมูลให้เอง</td></tr>
      <tr><td><code>id</code></td><td></td><td>รหัสอ้างอิงของคุณ — ส่งซ้ำด้วย id เดิมภายใน 3 วัน จะไม่ส่งซ้ำเข้าแชท (ปลอดภัยเมื่อ retry)</td></tr>
    </table>
  </section>

  <section>
    <h2>ผู้รับ (<code>to</code>)</h2>
    <table>
      <tr><th>รูปแบบ</th><th>ส่งถึง</th></tr>
      <tr><td><code>room:&lt;id ห้อง&gt;</code></td><td>ห้องแจ้งเตือน เช่น <code>room:lab-critical</code> · ดูรายชื่อห้อง: <code>GET /api/notify/channels</code> หรือกด "ดูห้อง" ในช่องทดลองด้านล่าง</td></tr>
      <tr><td><code>arankub:&lt;user id&gt;</code></td><td>ผู้ใช้ AranKub (ต้องเคยเข้าแชทแล้ว)</td></tr>
      <tr><td><code>p4p:&lt;staff id&gt;</code></td><td>บุคลากรในระบบ P4P</td></tr>
      <tr><td><code>cidhash:&lt;SHA-256&gt;</code></td><td>บุคลากรจากเลขบัตรประชาชนที่ hash แล้ว (SHA-256 ของเลข 13 หลัก สูตรเดียวกับ Provider ID) — ระบบที่รู้แค่เลขบัตร เช่น HOSxP (ตาราง doctor) ใช้แบบนี้ ไม่ต้องส่งเลขบัตรจริง</td></tr>
      <tr><td><code>@ชื่อผู้ใช้:__SERVER_NAME__</code></td><td>บัญชีแชทโดยตรง</td></tr>
    </table>
  </section>

  <section>
    <h2>ตัวอย่างโค้ด</h2>
    <div class="tabs" role="tablist" id="tabs"></div>
    <pre><code id="code"></code></pre>
  </section>

  <section>
    <h2>ผลที่ได้กลับมา</h2>
    <table>
      <tr><th>HTTP</th><th>ความหมาย</th></tr>
      <tr><td>200</td><td><code>{"results": {"room:lab-critical": "sent"}}</code> · ผลรายผู้รับ: <code>sent</code> ส่งแล้ว · <code>off</code> ผู้รับปิดเรื่องนี้ไว้ · <code>not_in_chat</code> ยังไม่มีบัญชีแชท · <code>no_such_room</code> ไม่มีห้องนี้ · <code>error</code> ส่งไม่สำเร็จ<br>
        <code>{"duplicate": true}</code> = id นี้ส่งไปแล้ว</td></tr>
      <tr><td>400</td><td>ข้อมูลไม่ครบ/ไม่ถูกรูปแบบ (ข้อความ error บอกว่าช่องไหน)</td></tr>
      <tr><td>401</td><td>key ไม่ถูกต้อง</td></tr>
      <tr><td>403</td><td>ผู้ดูแลปิดระบบนี้ไว้ในหน้าจัดการ</td></tr>
      <tr><td>429</td><td>ส่งเกิน 60 ครั้งต่อนาที — รอแล้วส่งใหม่</td></tr>
    </table>
  </section>

  <section>
    <h2>เครื่องมือสำเร็จรูป (ไม่ต้องเขียนโค้ด)</h2>
    <p>Uptime Kuma, Grafana และเครื่องมือที่ส่ง webhook ได้ ใส่ URL นี้ได้เลย ระบบจะใช้ข้อความแจ้งเตือนของเครื่องมือนั้นเป็นหัวข้อ</p>
    <pre><code>https://__CHAT_HOST__/api/notify?event=server.down&amp;to=room:it-alert&amp;key=&lt;key ของระบบ&gt;</code></pre>
    <p style="margin-top:12px">ถ้าเครื่องมือใส่ header ได้ แนะนำใส่ key ใน <code>Authorization: Bearer …</code> แทน <code>?key=</code> (ไม่ติดไปกับ log ของเครื่องมือ)</p>
  </section>

  <section>
    <h2>ลองส่งจากหน้านี้</h2>
    <div class="try">
      <input id="k" type="password" placeholder="key ของระบบ (acn_…)" autocomplete="off">
      <select id="to"><option value="">— กด "ดูห้อง" เพื่อโหลดรายชื่อห้อง —</option></select>
      <input id="t" value="ทดสอบการเชื่อมต่อ" placeholder="หัวข้อ">
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button id="ls" type="button">ดูห้อง</button><button id="go" type="button">ส่งทดสอบ</button></div>
      <pre><code id="out">ผลจะแสดงที่นี่</code></pre>
    </div>
  </section>

  <section class="note">
    <b>ข้อควรระวัง (PDPA):</b> ส่งเฉพาะข้อความสั้นที่จำเป็น + ลิงก์ไปดูรายละเอียดในระบบต้นทาง
    ไม่ใส่ชื่อ-นามสกุล เลขบัตรประชาชน หรือผลการรักษาละเอียดของผู้ป่วยในแจ้งเตือน · เก็บ key เป็นความลับเหมือนรหัสผ่าน
  </section>

  <footer>AranChat · โรงพยาบาลอรัญประเทศ · มีปัญหาการเชื่อมต่อ ติดต่อผู้ดูแลระบบ</footer>
</div>
<script>
  const API = "https://__CHAT_HOST__/api/notify";
  const BODY = `{
  "event": "lab.critical",
  "title": "ค่าวิกฤต K 6.8 mmol/L",
  "text": "หอผู้ป่วยอายุรกรรมชาย เตียง 12",
  "to": ["room:lab-critical"],
  "priority": "urgent",
  "id": "LAB-2026-000123"
}`;
  const SAMPLES = {
    curl: `curl -X POST ${API} \\
  -H "Authorization: Bearer $ARANCHAT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${BODY.replace(/\n\s*/g, " ")}'`,
    "PHP (HOSxP)": `<?php
// เก็บ key ไว้ในไฟล์ตั้งค่า/ตัวแปรระบบ ไม่ฝังในโค้ด
function aranchat_notify(array $msg): array {
    $ch = curl_init("${API}");
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_HTTPHEADER => [
            "Authorization: Bearer " . getenv("ARANCHAT_KEY"),
            "Content-Type: application/json",
        ],
        CURLOPT_POSTFIELDS => json_encode($msg, JSON_UNESCAPED_UNICODE),
    ]);
    $res = curl_exec($ch);
    curl_close($ch);
    return json_decode($res ?: "{}", true);
}

aranchat_notify([
    "event" => "lab.critical",
    "title" => "ค่าวิกฤต K 6.8 mmol/L",
    "text"  => "หอผู้ป่วยอายุรกรรมชาย เตียง 12",
    "to"    => ["room:lab-critical"],
    "priority" => "urgent",
    "id"    => "LAB-2026-000123",
]);`,
    Python: `import os, requests

def aranchat_notify(**msg):
    r = requests.post("${API}", json=msg, timeout=10,
                      headers={"Authorization": f"Bearer {os.environ['ARANCHAT_KEY']}"})
    return r.json()

aranchat_notify(event="lab.critical", title="ค่าวิกฤต K 6.8 mmol/L",
                text="หอผู้ป่วยอายุรกรรมชาย เตียง 12", to=["room:lab-critical"],
                priority="urgent", id="LAB-2026-000123")`,
    "JavaScript (Node)": `async function aranchatNotify(msg) {
  const res = await fetch("${API}", {
    method: "POST",
    headers: { Authorization: \`Bearer \${process.env.ARANCHAT_KEY}\`, "Content-Type": "application/json" },
    body: JSON.stringify(msg),
  });
  return res.json();
}

await aranchatNotify(${BODY.replace(/\n/g, "\n  ").replace(/"(\w+)":/g, "$1:")});`,
    PowerShell: `$body = @{
  event = "server.down"; title = "เครื่อง HOSxP-DB ไม่ตอบสนอง"
  to = @("room:it-alert"); priority = "urgent"
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "${API}" -ContentType "application/json; charset=utf-8" \`
  -Headers @{ Authorization = "Bearer $env:ARANCHAT_KEY" } -Body ([Text.Encoding]::UTF8.GetBytes($body))`,
  };
  const tabs = document.getElementById("tabs"), code = document.getElementById("code");
  const show = (name) => {
    code.textContent = SAMPLES[name];
    for (const b of tabs.children) b.setAttribute("aria-selected", String(b.textContent === name));
    try { localStorage.setItem("ac-connect-tab", name); } catch {}
  };
  for (const name of Object.keys(SAMPLES)) {
    const b = document.createElement("button");
    b.type = "button"; b.role = "tab"; b.textContent = name; b.onclick = () => show(name);
    tabs.append(b);
  }
  let first = "curl";
  try { first = SAMPLES[localStorage.getItem("ac-connect-tab")] ? localStorage.getItem("ac-connect-tab") : first; } catch {}
  show(first);

  const $ = (id) => document.getElementById(id), out = $("out");
  const call = async (method, path, body) => {
    const key = $("k").value.trim();
    if (!key) { out.textContent = "ใส่ key ก่อน"; return null; }
    const res = await fetch(API + path, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    out.textContent = `HTTP ${res.status}\n` + JSON.stringify(data, null, 2);
    return res.ok ? data : null;
  };
  $("ls").onclick = async () => {
    const d = await call("GET", "/channels");
    if (!d) return;
    $("to").innerHTML = d.channels.map((c) => `<option value="${c.to}">${c.icon ?? ""} ${c.name} (${c.to})</option>`).join("");
  };
  $("go").onclick = () => {
    if (!$("to").value) { out.textContent = "กด \"ดูห้อง\" แล้วเลือกห้องก่อน"; return; }
    call("POST", "", { event: "connect.test", title: $("t").value || "ทดสอบการเชื่อมต่อ", text: "ส่งจากหน้าคู่มือ /connect/", to: [$("to").value] });
  };
</script>
</body>
</html>
