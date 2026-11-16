/* AranChat — ชวนติดตั้งแอป (โหลดจาก index.html ผ่าน sub_filter ใน k8s/branding.yaml.tpl)
 *   หน้า login   : การ์ดดาวน์โหลดด้านซ้าย (จอใหญ่) / แถบล่าง (มือถือ)
 *   หน้าแชท      : ปุ่มดาวน์โหลดบนแถบซ้ายสุด เหนือปุ่มตั้งค่า → เปิดหน้าต่างดาวน์โหลด
 *   /download/   : หน้าดาวน์โหลดเต็ม (brand/download.html) เรียก AranChat.renderFull()
 * ทุกอย่างอยู่นอก React ของ Element (แปะที่ body) ยกเว้นปุ่มบนแถบซ้ายที่แทรกไว้ก่อนปุ่มตั้งค่า
 * ไฟล์ติดตั้งอยู่ ~/aranchat-apps/dist — ชื่อไฟล์ด้านล่างเป็น symlink ไปยังเวอร์ชันล่าสุด
 */
(function () {
  if (/Electron/i.test(navigator.userAgent)) return; // อยู่ในแอป Desktop อยู่แล้ว

  var BRAND = "__BRAND__";
  var DL = "https://__CHAT_HOST__/download/";
  var IMG = "https://__CHAT_HOST__/branding/download-hero.png?v=__BRAND_VER__";
  // ไอคอนระบบปฏิบัติการ (วาดเอง ไม่พึ่งอีโมจิ — Windows 10 บางเครื่องไม่มีอีโมจิใหม่)
  function svg(body) { return '<svg class="ac-ic" viewBox="0 0 24 24" aria-hidden="true">' + body + "</svg>"; }
  var I = {
    windows: svg('<path fill="#0078D4" d="M3 5.5l7.5-1v7H3zM11.5 4.4L21 3v8.5h-9.5zM3 12.5h7.5v7L3 18.5zM11.5 12.5H21V21l-9.5-1.4z"/>'),
    android: svg('<path fill="#34A853" d="M5 10.5a1 1 0 0 1 2 0v5a1 1 0 0 1-2 0zM17 10.5a1 1 0 0 1 2 0v5a1 1 0 0 1-2 0zM8 10h8v7a1 1 0 0 1-1 1h-1v2.5a1 1 0 0 1-2 0V18h-0v2.5a1 1 0 0 1-2 0V18H9a1 1 0 0 1-1-1zM8 9a4 4 0 0 1 8 0z"/><circle cx="10.3" cy="7.3" r=".7" fill="#fff"/><circle cx="13.7" cy="7.3" r=".7" fill="#fff"/><path stroke="#34A853" stroke-width="1.2" stroke-linecap="round" d="M9.2 4.2l1 1.6M14.8 4.2l-1 1.6"/>'),
    linux: svg('<rect x="2.5" y="4" width="19" height="16" rx="3" fill="#334155"/><path d="M6.5 9.5l3 2.5-3 2.5M11.5 15h5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
    phone: svg('<rect x="6.5" y="2.5" width="11" height="19" rx="2.5" fill="#0F172A"/><rect x="8" y="5" width="8" height="13" rx="1" fill="#C4B5FD"/><circle cx="12" cy="19.6" r=".8" fill="#fff"/>'),
    laptop: svg('<rect x="4" y="4.5" width="16" height="11" rx="1.5" fill="#0F172A"/><rect x="5.5" y="6" width="13" height="8" rx=".5" fill="#C4B5FD"/><path d="M2 17h20l-1.5 2.5h-17z" fill="#94A3B8"/>'),
  };
  var APPS = {
    windows: { name: "Windows", icon: I.windows, file: "AranChat-Windows.exe", note: "Windows 10 / 11",
      steps: ["ดาวน์โหลดแล้วดับเบิลคลิกไฟล์", "ถ้าขึ้น “Windows protected your PC” กด More info → Run anyway", "เปิดแอป กด “เข้าสู่ระบบด้วย AranKub”"] },
    android: { name: "Android", icon: I.android, file: "AranChat-Android.apk", note: "Android 7 ขึ้นไป",
      steps: ["ดาวน์โหลดแล้วแตะไฟล์ .apk", "ถ้าถาม ให้อนุญาต “ติดตั้งแอปที่ไม่รู้จัก” จากเบราว์เซอร์", "ตั้งค่าแบตเตอรี่ของแอปเป็น “ไม่จำกัด” เพื่อให้แจ้งเตือนเด้ง"] },
    linux: { name: "Linux", icon: I.linux, file: "AranChat-Linux.deb", note: "Ubuntu / Debian",
      alt: { file: "AranChat-Linux.AppImage", label: "AppImage" },
      steps: ["sudo apt install ./AranChat-Linux.deb", "หรือใช้ AppImage: คลิกขวา → Properties → อนุญาตให้รัน"] },
    ios: { name: "iPhone / iPad", icon: I.phone, note: "ใช้ผ่านเว็บ",
      steps: ["เปิด __CHAT_HOST__ ใน Safari", "กดปุ่มแชร์ → “เพิ่มไปยังหน้าจอโฮม”", "จะได้ไอคอน " + BRAND + " เหมือนแอป"] },
    mac: { name: "Mac", icon: I.laptop, note: "ใช้ผ่านเว็บ",
      steps: ["เปิด __CHAT_HOST__ ใน Chrome หรือ Edge", "กดไอคอน “ติดตั้ง” ท้ายช่องที่อยู่เว็บ", "จะได้แอป " + BRAND + " ใน Launchpad"] },
  };
  var ORDER = ["windows", "android", "linux", "ios", "mac"];

  function detect() {
    var ua = navigator.userAgent;
    if (/Android/i.test(ua)) return "android";
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
    if (/Windows/i.test(ua)) return "windows";
    if (/Macintosh/i.test(ua)) return "mac";
    if (/Linux|X11/i.test(ua)) return "linux";
    return "windows";
  }
  var OS = detect();

  var CSS = [
    ".ac-dl, .ac-dl * { box-sizing: border-box; font-family: 'Inter', 'Sarabun', 'Noto Sans Thai', system-ui, sans-serif; }",
    ".ac-dl { color: #0F172A; line-height: 1.5; }",
    ".ac-dl img.ac-hero { display: block; width: 100%; height: auto; border-radius: 18px; }",
    ".ac-dl h2 { margin: 14px 0 2px; font-size: 20px; font-weight: 700; }",
    ".ac-dl p.ac-sub { margin: 0 0 14px; color: #475569; font-size: 14px; }",
    ".ac-dl .ac-main { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 13px 18px;",
    "  border-radius: 999px; border: 0; background: linear-gradient(135deg, #5B3FD9, #8B5CF6); color: #fff !important;",
    "  font-size: 16px; font-weight: 700; text-decoration: none !important; cursor: pointer; box-shadow: 0 6px 16px rgba(91,63,217,.3); }",
    ".ac-dl .ac-main:hover { filter: brightness(1.06); }",
    ".ac-dl .ac-main small { font-weight: 400; opacity: .85; font-size: 12px; }",
    ".ac-dl .ac-steps { margin: 12px 0 0; padding: 10px 14px 10px 30px; border-radius: 12px; background: #F4F1FC; font-size: 13px; color: #334155; }",
    ".ac-dl .ac-steps li { margin: 2px 0; }",
    ".ac-dl .ac-others { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }",
    ".ac-dl .ac-chip { flex: 1 1 auto; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px;",
    "  border-radius: 999px; border: 1px solid #D9D0F5; background: #fff; color: #2E1F7A !important; font-size: 13px;",
    "  text-decoration: none !important; cursor: pointer; white-space: nowrap; }",
    ".ac-dl .ac-chip:hover { border-color: #8B5CF6; background: #F4F1FC; }",
    ".ac-dl .ac-ic { width: 1.25em; height: 1.25em; flex-shrink: 0; vertical-align: -0.25em; }",
    ".ac-main > svg:not(.ac-ic) { width: 18px; height: 18px; flex-shrink: 0; }",
    ".ac-main .ac-ic { background: #fff; border-radius: 6px; padding: 2px; }",
    ".ac-dl .ac-more { display: block; margin-top: 10px; text-align: center; font-size: 13px; color: #5B3FD9 !important; }",
    /* หน้าต่างดาวน์โหลด */
    ".ac-modal { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 16px;",
    "  background: rgba(26,15,77,.45); backdrop-filter: blur(3px); animation: ac-fade .15s ease-out; }",
    ".ac-modal .ac-card { position: relative; width: 100%; max-width: 440px; max-height: calc(100vh - 32px); overflow: auto;",
    "  padding: 14px 18px 18px; border-radius: 24px; background: #fff; box-shadow: 0 20px 50px rgba(26,15,77,.35); }",
    ".ac-x { position: absolute; top: 20px; right: 22px; width: 32px; height: 32px; border-radius: 50%; border: 0;",
    "  background: rgba(255,255,255,.9); color: #0F172A; font-size: 18px; line-height: 32px; cursor: pointer; }",
    "@keyframes ac-fade { from { opacity: 0 } to { opacity: 1 } }",
    /* หน้า login: การ์ดด้านซ้าย (จอกว้าง) */
    ".ac-login { position: fixed; z-index: 50; left: max(24px, calc(50vw - 640px)); top: 50%; transform: translateY(-50%);",
    "  width: 300px; padding: 12px 14px 14px; border-radius: 24px; background: rgba(255,255,255,.96); box-shadow: 0 14px 40px rgba(26,15,77,.25); }",
    ".ac-login h2 { font-size: 17px; }",
    ".ac-login .ac-steps { display: none; }",
    /* หน้า login: แถบล่าง (จอแคบ / มือถือ) */
    ".ac-bar { position: fixed; z-index: 50; left: 12px; right: 12px; bottom: 12px; display: flex; align-items: center; gap: 10px;",
    "  padding: 10px 10px 10px 12px; border-radius: 18px; background: #fff; box-shadow: 0 10px 30px rgba(26,15,77,.28); }",
    ".ac-bar img { width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0; }",
    ".ac-bar .ac-t { flex: 1; min-width: 0; font-size: 13px; color: #475569; }",
    ".ac-bar .ac-t b { display: block; font-size: 15px; color: #0F172A; }",
    ".ac-bar .ac-main { width: auto; padding: 9px 16px; font-size: 14px; box-shadow: none; }",
    ".ac-bar .ac-close { border: 0; background: none; color: #94A3B8; font-size: 20px; padding: 4px; cursor: pointer; }",
    "body.ac-has-bar .mx_AuthPage { padding-bottom: 84px; }",
    /* หน้าแชท: ปุ่มบนแถบซ้าย */
    ".ac-side { display: flex; align-items: center; justify-content: center; gap: 10px; width: 32px; height: 32px; margin: 4px auto 0;",
    "  border: 0; border-radius: 8px; background: linear-gradient(135deg, #5B3FD9, #8B5CF6); color: #fff; cursor: pointer; padding: 0; }",
    ".ac-side svg { width: 18px; height: 18px; flex-shrink: 0; }",
    ".ac-side span { display: none; font-size: 14px; font-weight: 600; }",
    ".ac-side:hover { filter: brightness(1.1); }",
    ".mx_SpacePanel:not(.collapsed) .ac-side { width: auto; margin: 6px 8px 0 16px; padding: 0 12px; height: 34px; justify-content: flex-start; }",
    ".mx_SpacePanel:not(.collapsed) .ac-side span { display: inline; }",
    /* หน้าดาวน์โหลดเต็ม */
    ".ac-full .ac-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; margin-top: 18px; }",
    ".ac-full .ac-os { padding: 16px; border-radius: 18px; border: 1px solid #E2E8F0; background: #fff; }",
    ".ac-full .ac-os.ac-me { border: 2px solid #8B5CF6; box-shadow: 0 8px 24px rgba(91,63,217,.15); }",
    ".ac-full .ac-os h3 { margin: 0; font-size: 18px; display: flex; align-items: center; gap: 8px; }",
    ".ac-full .ac-os .ac-badge { margin-left: auto; padding: 2px 8px; border-radius: 999px; background: #E4DCFD; color: #5B3FD9; font-size: 11px; }",
    ".ac-full .ac-os .ac-note { margin: 2px 0 12px; color: #64748B; font-size: 13px; }",
    ".ac-full .ac-os .ac-ver { color: #5B3FD9; font-weight: 600; }",
    ".ac-full .ac-os .ac-main { padding: 10px 14px; font-size: 15px; box-shadow: none; }",
  ].join("\n");

  function el(html) { var d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function ensureCss() {
    if (document.getElementById("ac-dl-css")) return;
    var s = document.createElement("style"); s.id = "ac-dl-css"; s.textContent = CSS; document.head.appendChild(s);
  }

  // ปุ่มหลักของระบบปฏิบัติการนั้น: มีไฟล์ → ดาวน์โหลด · ไม่มี (iPhone/Mac) → ไปหน้าวิธีติดตั้ง
  function mainBtn(key, label) {
    var a = APPS[key];
    if (a.file) return '<a class="ac-main" data-dl="' + key + '" href="' + DL + a.file + '" download>' + ICON + " " + esc(label || "ดาวน์โหลดสำหรับ " + a.name) + "</a>";
    return '<a class="ac-main" href="' + DL + "#" + key + '" target="_blank" rel="noopener">' + a.icon + " " + esc(label || "วิธีติดตั้งบน " + a.name) + "</a>";
  }
  function others(skip) {
    return '<div class="ac-others">' + ORDER.filter(function (k) { return k !== skip && APPS[k].file; }).map(function (k) {
      return '<a class="ac-chip" href="' + DL + APPS[k].file + '" download>' + APPS[k].icon + " " + APPS[k].name + "</a>";
    }).join("") + "</div>";
  }
  function steps(key) { return '<ol class="ac-steps">' + APPS[key].steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>"; }

  function panelHTML(cls) {
    return '<div class="ac-dl ' + (cls || "") + '">' +
      '<img class="ac-hero" src="' + IMG + '" alt="">' +
      "<h2>ติดตั้งแอป " + BRAND + "</h2>" +
      '<p class="ac-sub">แชทและแจ้งเตือนเด้งทันที ไม่ต้องเปิดเว็บค้างไว้</p>' +
      mainBtn(OS) + steps(OS) + others(OS) +
      '<a class="ac-more" href="' + DL + '" target="_blank" rel="noopener">ดูทุกระบบและวิธีติดตั้ง →</a></div>';
  }

  function openModal() {
    ensureCss();
    if (document.querySelector(".ac-modal")) return;
    var m = el('<div class="ac-modal" role="dialog" aria-modal="true" aria-label="ดาวน์โหลดแอป"><div class="ac-card">' +
      '<button class="ac-x" aria-label="ปิด">×</button>' + panelHTML() + "</div></div>");
    function close() { m.remove(); document.removeEventListener("keydown", onKey, true); }
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
    m.addEventListener("click", function (e) { if (e.target === m || e.target.classList.contains("ac-x")) close(); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(m);
  }

  // ---- หน้า login ----
  var DISMISS = "aranchat_dl_bar_closed";
  function loginUI(onAuth) {
    var card = document.querySelector(".ac-login"), bar = document.querySelector(".ac-bar");
    var wide = window.innerWidth >= 1180 && window.innerHeight >= 640;
    if (!onAuth || wide) { if (bar) bar.remove(); document.body.classList.remove("ac-has-bar"); }
    if (!onAuth || !wide) { if (card) card.remove(); }
    if (!onAuth) return;
    if (wide && !card) document.body.appendChild(el(panelHTML("ac-login")));
    var closed = false;
    try { closed = sessionStorage.getItem(DISMISS) === "1"; } catch (e) {}
    if (!wide && !bar && !closed) {
      bar = el('<div class="ac-dl ac-bar"><img src="https://__CHAT_HOST__/branding/icon-120.png?v=__BRAND_VER__" alt="">' +
        '<div class="ac-t"><b>ติดตั้งแอป ' + BRAND + "</b>แจ้งเตือนเด้งทันที</div>" +
        '<button class="ac-main">ดาวน์โหลด</button><button class="ac-close" aria-label="ปิด">×</button></div>');
      bar.querySelector(".ac-main").onclick = openModal;
      bar.querySelector(".ac-close").onclick = function () {
        try { sessionStorage.setItem(DISMISS, "1"); } catch (e) {}
        bar.remove(); document.body.classList.remove("ac-has-bar");
      };
      document.body.appendChild(bar);
      document.body.classList.add("ac-has-bar");
    }
  }

  // ---- หน้าแชท: ปุ่มบนแถบซ้าย ----
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>';
  function sideButton() {
    if (document.querySelector(".mx_AranChatRail")) return; // ตัวที่ build เอง: ดาวน์โหลดอยู่ในเมนู "ระบบงาน" แล้ว
    var qs = document.querySelector(".mx_SpacePanel .mx_QuickSettingsButton");
    if (!qs || (qs.previousElementSibling && qs.previousElementSibling.classList.contains("ac-side"))) return;
    var old = document.querySelector(".ac-side"); if (old) old.remove();
    var b = el('<button class="ac-side" title="ดาวน์โหลดแอป ' + BRAND + '" aria-label="ดาวน์โหลดแอป">' + ICON + "<span>ดาวน์โหลดแอป</span></button>");
    b.onclick = openModal;
    qs.parentNode.insertBefore(b, qs);
  }

  function tick() {
    ensureCss();
    loginUI(!!document.querySelector(".mx_AuthPage"));
    sideButton();
  }

  window.AranChat = {
    apps: APPS, os: OS, openModal: openModal, downloadIcon: ICON,
    // หน้า /download/: การ์ดทุกระบบ + ขนาดไฟล์
    renderFull: function (root) {
      ensureCss();
      var keys = [OS].concat(ORDER.filter(function (k) { return k !== OS; }));
      root.innerHTML = '<div class="ac-dl ac-full"><div class="ac-grid">' + keys.map(function (k) {
        var a = APPS[k];
        return '<div class="ac-os' + (k === OS ? " ac-me" : "") + '" id="' + k + '"><h3>' + a.icon + " " + a.name +
          (k === OS ? '<span class="ac-badge">เครื่องนี้</span>' : "") + "</h3>" +
          '<div class="ac-note">' + (a.file ? '<b class="ac-ver" data-ver="' + k + '"></b>' : "") + esc(a.note) +
          (a.file ? ' · <span data-size="' + a.file + '"></span>' : "") + "</div>" +
          mainBtn(k, a.file ? "ดาวน์โหลด" : "ใช้ผ่านเว็บ") + steps(k) +
          (a.alt ? '<a class="ac-more" data-dl="' + k + '-alt" href="' + DL + a.alt.file + '" download>หรือดาวน์โหลดแบบ ' + a.alt.label + "</a>" : "") +
          (k === "android" ? '<a class="ac-more" data-dl="android32" href="' + DL + 'AranChat-Android-32bit.apk" download>มือถือรุ่นเก่า (32 บิต) ดาวน์โหลดที่นี่</a>' : "") +
          "</div>";
      }).join("") + "</div></div>";
      // รุ่นล่าสุด (latest.json จาก scripts/18-publish-apps.sh): ขึ้นเลขรุ่น + ลิงก์ไฟล์ที่มีเลขรุ่นในชื่อ
      fetch(DL + "latest.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (f) {
        var d = f.desktop || {}, an = f.android || {}, lx = d.linux || {};
        var ver = { windows: d.version, linux: d.version, android: an.version };
        var url = { windows: d.win && d.win.url, linux: lx.deb, "linux-alt": lx.appimage, android: an.url, android32: an.url32 };
        [].forEach.call(document.querySelectorAll("[data-ver]"), function (e) {
          if (ver[e.dataset.ver]) e.textContent = "รุ่น " + ver[e.dataset.ver] + " · ";
        });
        [].forEach.call(document.querySelectorAll("[data-dl]"), function (e) { if (url[e.dataset.dl]) e.href = url[e.dataset.dl]; });
        if (window.AranChatOnLatest) window.AranChatOnLatest(ver);
      }).catch(function () {});
      [].forEach.call(root.querySelectorAll("[data-size]"), function (s) {
        fetch(DL + s.dataset.size, { method: "HEAD" }).then(function (r) {
          var n = +r.headers.get("content-length"); if (n) s.textContent = Math.round(n / 1048576) + " MB";
        }).catch(function () {});
      });
    },
  };

  if (document.getElementById("ac-download")) return; // หน้า /download/ เรียก renderFull เอง
  var pending = false;
  function schedule() { if (!pending) { pending = true; requestAnimationFrame(function () { pending = false; tick(); }); } }
  function start() {
    tick();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
