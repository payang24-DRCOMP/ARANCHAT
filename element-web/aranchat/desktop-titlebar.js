// AranChat Desktop — แถบบนของหน้าต่าง: โลโก้ + ชื่อแอป + ห้องที่เปิดอยู่ + จำนวนข้อความใหม่
// อ่านจากชื่อหน้า (Element ตั้งเป็น "AranChat [3] | ชื่อห้อง") · ดู desktop-titlebar.css
(function () {
    var bar = document.createElement("div");
    bar.className = "ac-titlebar";
    bar.innerHTML = '<img src="branding/icon-120.png" alt=""><span>AranChat</span>'
        + '<span class="ac-tb-badge" hidden></span><span class="ac-tb-room" hidden></span>';
    var badge = bar.querySelector(".ac-tb-badge");
    var room = bar.querySelector(".ac-tb-room");
    function update() {
        var t = document.title || "";
        var n = /\[(\d+)\]/.exec(t);
        badge.textContent = n ? n[1] : "";
        badge.hidden = !n;
        var r = t.indexOf(" | ") >= 0 ? t.slice(t.indexOf(" | ") + 3).trim() : "";
        room.textContent = r;
        room.hidden = !r;
    }
    function start() {
        document.body.prepend(bar);
        update();
        var title = document.querySelector("title");
        if (title) new MutationObserver(update).observe(title, { childList: true, characterData: true, subtree: true });
    }
    if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
