/* AranChat — แถบเมนูซ้าย แทนรายการ Space ของ Element (ไม่สร้างห้อง/ข้อมูลใหม่ — เป็นทางลัดเท่านั้น)
 * ใช้ทั้งเว็บแชท (index.html → sub_filter ใน k8s/branding.yaml.tpl) และแอป Desktop (aranchat/build-desktop.sh)
 * เปิดเฉพาะเมื่อ <html class="ac-layout"> (aranchat-early.js) · หน้าตาอยู่ใน aranchat-layout.css
 *
 *   แชท      = รายการแชท (ตัวกรองด้านใน ยังไม่อ่าน / เพื่อน / กลุ่ม / ถูกแท็ก ของ Element)
 *   แจ้งเตือน = ห้องแชทกับบอทแจ้งเตือน + จำนวนที่ยังไม่อ่าน
 *   ข่าวสาร   = ห้องประกาศของหน่วยงาน (apps.json: news_room) — แสดงเมื่อผู้ใช้อยู่ในห้องนั้นแล้วเท่านั้น
 *   ระบบงาน  = ทางลัดไปโปรแกรมอื่นของหน่วยงาน (apps.json: apps)
 *              เว็บแชท: เปิดซ้อนในหน้าแชท (iframe) — โดเมนเดียวกับ AranKub จึงใช้ session ที่ล็อกอินไว้ตอนเข้าแชท ไม่ต้องล็อกอินซ้ำ
 *              แอป Desktop: เปิดในเบราว์เซอร์ของเครื่อง — แอปเก็บคุกกี้แยก (เปิดซ้อนในแอปจะติดหน้า login) ส่วนเบราว์เซอร์ล็อกอิน AranKub ไว้แล้วตอนล็อกอินแอป
 *              app ที่ตั้ง "external": true เปิดในแท็บใหม่เสมอ
 *   โปรไฟล์   = หน้าตั้งค่าของฉัน
 */
(function () {
  var BOT = "@aranchat:__SERVER_NAME__";
  var BOT_PAGE = "#/user/" + BOT;
  var CFG_URL = "https://__CHAT_HOST__/branding/apps.json?v=__BRAND_VER__";
  var I = {
    chat: '<path d="M12 3C6.9 3 3 6.6 3 11c0 2.4 1.2 4.6 3.1 6.1L5.5 21l4-2.1c.8.2 1.6.3 2.5.3 5.1 0 9-3.6 9-8.1S17.1 3 12 3z"/>',
    bell: '<path d="M12 22a2.5 2.5 0 0 0 2.4-1.8H9.6A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.8V3.5a1.5 1.5 0 0 0-3 0v.7A7 7 0 0 0 5 11v5l-2 2v1h18v-1z"/>',
    news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2zm13 4h3v8a2 2 0 0 1-2 2h-1M7 8h7M7 11h7M7 14h4"/>',
    apps: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
    me: '<path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.4 0-8 2.5-8 5.5V22h16v-2.5c0-3-3.6-5.5-8-5.5z"/>',
  };
  var ITEMS = [
    { id: "chat", label: "แชท", icon: I.chat, href: "#/home" },
    { id: "bell", label: "แจ้งเตือน", icon: I.bell, href: BOT_PAGE },
    { id: "news", label: "ข่าวสาร", icon: I.news, href: "#/home" },
    { id: "apps", label: "ระบบงาน", icon: I.apps, href: "#/home" },
    { id: "me", label: "โปรไฟล์", icon: I.me, href: "#/settings" },
  ];
  var cfg = { news_room: null, apps: [] };
  fetch(CFG_URL).then(function (r) { return r.json(); }).then(function (c) { cfg = c; schedule(); }).catch(function () {});

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function client() { try { return window.mxMatrixClientPeg && window.mxMatrixClientPeg.get(); } catch (e) { return null; } }
  function unread(room) { try { return room ? room.getUnreadNotificationCount("total") || 0 : 0; } catch (e) { return 0; } }
  // ห้องแชทกับบอทแจ้งเตือน (m.direct) — ยังไม่มี = ไปหน้าโปรไฟล์บอท (กด "ส่งข้อความ" ได้)
  function botRoom() {
    var c = client(); if (!c) return null;
    try {
      var ev = c.getAccountData("m.direct"), ids = ((ev && ev.getContent()) || {})[BOT] || [];
      for (var i = 0; i < ids.length; i++) {
        var r = c.getRoom(ids[i]);
        if (r && r.getMyMembership() === "join") return r;
      }
    } catch (e) {}
    return null;
  }
  // ห้องข่าวสาร: หาจาก alias ในห้องที่ผู้ใช้อยู่แล้ว (ไม่ต้องถามเซิร์ฟเวอร์)
  function newsRoom() {
    var c = client(); if (!c || !cfg.news_room) return null;
    try {
      var rooms = c.getRooms();
      for (var i = 0; i < rooms.length; i++) {
        var r = rooms[i];
        if (r.getMyMembership() === "join" && (r.getCanonicalAlias() === cfg.news_room || (r.getAltAliases() || []).indexOf(cfg.news_room) >= 0)) return r;
      }
    } catch (e) {}
    return null;
  }

  var DESKTOP = /Electron/i.test(navigator.userAgent);
  // ---- เปิดโปรแกรมซ้อนในหน้าแชท (แทนรายการแชท + ห้องแชท ข้างแถบเมนู) ----
  function closeView() { var v = document.querySelector(".ac-view"); if (v) v.remove(); schedule(); }
  function openView(a) {
    closeView();
    var v = document.createElement("div");
    v.className = "ac-view";
    v.innerHTML = '<div class="ac-view-bar"><span class="ac-app-ic" style="background:' + esc(a.color || "#5B3FD9") + '">' + esc(a.icon || "•") + "</span>" +
      "<b>" + esc(a.name) + "</b>" +
      '<a class="ac-view-btn" href="' + esc(a.url) + '" target="_blank" rel="noopener" title="เปิดในแท็บใหม่">เปิดในแท็บใหม่ ↗</a>' +
      '<button class="ac-view-btn ac-view-x" title="กลับไปแชท" aria-label="ปิด">✕</button></div>' +
      '<iframe src="' + esc(a.url) + '" title="' + esc(a.name) + '" allow="clipboard-write; fullscreen"></iframe>';
    v.querySelector(".ac-view-x").onclick = closeView;
    v.querySelector('a[target="_blank"]').onclick = closeView;
    document.body.appendChild(v);
    schedule();
  }

  // ---- หน้าต่างระบบงาน (ทางลัด) ----
  function closeApps() { var p = document.querySelector(".ac-apps"); if (p) p.remove(); document.removeEventListener("mousedown", outside, true); schedule(); }
  function outside(e) { if (!e.target.closest(".ac-apps") && !e.target.closest('[data-ac="apps"]')) closeApps(); }
  function toggleApps() {
    if (document.querySelector(".ac-apps")) return closeApps();
    var p = document.createElement("div");
    p.className = "ac-apps"; p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "ระบบงาน");
    p.innerHTML = '<div class="ac-apps-head"><b>ระบบงาน</b><span>โปรแกรมของหน่วยงาน' + (DESKTOP ? " — เปิดในเบราว์เซอร์" : "") + '</span></div><div class="ac-apps-grid">' +
      (cfg.apps || []).map(function (a, i) {
        return '<a class="ac-app" data-i="' + i + '" href="' + esc(a.url) + '" target="_blank" rel="noopener">' +
          '<span class="ac-app-ic" style="background:' + esc(a.color || "#5B3FD9") + '">' + esc(a.icon || "•") + "</span>" +
          "<span><b>" + esc(a.name) + "</b><small>" + esc(a.desc) + "</small></span></a>";
      }).join("") + "</div>";
    p.addEventListener("click", function (e) {
      var el = e.target.closest(".ac-app"); if (!el) return;
      var app = cfg.apps[+el.dataset.i];
      if (!DESKTOP && !app.external) { e.preventDefault(); openView(app); }
      closeApps();
    });
    document.body.appendChild(p);
    document.addEventListener("mousedown", outside, true);
    schedule();
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && document.querySelector(".ac-apps")) closeApps(); }, true);
  window.addEventListener("hashchange", function () { if (document.querySelector(".ac-view")) closeView(); }); // กดลิงก์ในแชท/แจ้งเตือน → กลับมาแชท

  function build() {
    var nav = document.createElement("div");
    nav.className = "ac-rail";
    nav.innerHTML = '<a class="ac-rail-logo" href="#/home" title="__BRAND__"><img src="https://__CHAT_HOST__/branding/icon-120.png?v=__BRAND_VER__" alt="__BRAND__"></a>' +
      ITEMS.map(function (it) {
        return '<a class="ac-rail-item" data-ac="' + it.id + '" href="' + it.href + '" title="' + it.label + '">' +
          '<span class="ac-rail-ic"><svg viewBox="0 0 24 24" aria-hidden="true">' + it.icon + '</svg><b class="ac-rail-badge" hidden></b></span>' +
          "<span>" + it.label + "</span></a>";
      }).join("");
    nav.querySelector('[data-ac="apps"]').addEventListener("click", function (e) { e.preventDefault(); toggleApps(); });
    [].forEach.call(nav.querySelectorAll('.ac-rail-item:not([data-ac="apps"]), .ac-rail-logo'), function (el) { el.addEventListener("click", closeView); });
    return nav;
  }

  function badge(a, n) {
    var b = a.querySelector(".ac-rail-badge");
    b.hidden = !n; b.textContent = n > 99 ? "99+" : String(n);
  }

  function update(nav) {
    var hash = location.hash || "#/home", bot = botRoom(), news = newsRoom();
    var bell = nav.querySelector('[data-ac="bell"]'), nw = nav.querySelector('[data-ac="news"]');
    bell.setAttribute("href", bot ? "#/room/" + bot.roomId : BOT_PAGE);
    badge(bell, unread(bot));
    nw.hidden = !news;
    if (news) { nw.setAttribute("href", "#/room/" + news.roomId); badge(nw, unread(news)); }
    var active = document.querySelector(".ac-apps, .ac-view") ? "apps"
      : /^#\/settings/.test(hash) ? "me"
      : (bot && hash.indexOf("#/room/" + bot.roomId) === 0) || (/^#\/user\//.test(hash) && hash.indexOf(BOT) > 0) ? "bell"
      : news && hash.indexOf("#/room/" + news.roomId) === 0 ? "news" : "chat";
    [].forEach.call(nav.querySelectorAll(".ac-rail-item"), function (a) { a.classList.toggle("ac-on", a.dataset.ac === active); });
    document.documentElement.style.setProperty("--ac-brand", '"__BRAND__"'); // ชื่อแอปบนหัวรายการแชท
    // จอแคบแสดงทีละหน้า (aranchat-layout.css): อยู่ในห้อง = room · อื่นๆ = list
    var pane = /^#\/(room|user)\//.test(hash) ? "room" : "list";
    if (document.documentElement.dataset.acPane !== pane) document.documentElement.dataset.acPane = pane;
    backButton();
  }

  // ปุ่มย้อนกลับบนหัวห้อง (แสดงเฉพาะจอแคบ) → กลับไปรายการแชท
  function backButton() {
    var head = document.querySelector(".mx_RoomHeader");
    if (!head || (head.firstElementChild && head.firstElementChild.classList.contains("ac-back"))) return;
    var old = head.querySelector(".ac-back"); if (old) old.remove();
    var b = document.createElement("button");
    b.className = "ac-back"; b.type = "button"; b.setAttribute("aria-label", "กลับไปรายการแชท");
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
    b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); location.hash = "#/home"; });
    head.insertBefore(b, head.firstChild);
  }

  function tick() {
    var panel = document.querySelector(".mx_SpacePanel");
    if (!panel) return;
    var nav = panel.querySelector(":scope > .ac-rail");
    if (!nav) { nav = build(); panel.insertBefore(nav, panel.firstChild); }
    update(nav);
  }

  var pending = false;
  function schedule() { if (!pending) { pending = true; requestAnimationFrame(function () { pending = false; tick(); }); } }
  function start() {
    if (!document.documentElement.classList.contains("ac-layout")) return; // ยังไม่เปิดหน้าตาใหม่ (aranchat-early.js)
    tick();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", schedule);
    setInterval(schedule, 5000); // จำนวนที่ยังไม่อ่าน
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
