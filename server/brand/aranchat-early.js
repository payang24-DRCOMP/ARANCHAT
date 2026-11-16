/* AranChat — รันก่อน Element เริ่มทำงาน (โหลดแบบไม่ defer จาก index.html ผ่าน sub_filter ใน k8s/branding.yaml.tpl)
 * ต้องเป็นไฟล์แยก: CSP ของ Element (script-src 'self') ห้ามสคริปต์ inline
 *   skip_mobile_redirect: มือถือเข้าเว็บแชทเลย ไม่เด้งไป /mobile_guide/ (หน้านั้นพาไปโหลดแอป Element X)
 *   ภาษาไทยเป็นค่าเริ่มต้น (Element ใช้ภาษาเบราว์เซอร์ถ้าผู้ใช้ไม่เคยเลือก) — ไม่ทับภาษาที่ผู้ใช้เลือกเอง
 *   หน้าตาแบบแอปแชท (aranchat-layout.css + aranchat-nav.js): LAYOUT_DEFAULT = เปิดให้ทุกคนหรือยัง
 *     ทดลองเฉพาะเครื่อง: เปิด https://แชท/?ac_layout=on (ปิด: ?ac_layout=off) — จำไว้ในเบราว์เซอร์นั้น
 */
var LAYOUT_DEFAULT = false;
try {
  sessionStorage.setItem("skip_mobile_redirect", "true");
  var k = "mx_local_settings", s = JSON.parse(localStorage.getItem(k) || "{}");
  if (!s.language) { s.language = "th"; localStorage.setItem(k, JSON.stringify(s)); }
} catch (e) {}
try {
  var m = /[?&]ac_layout=(on|off)\b/.exec(location.search);
  if (m) {
    localStorage.setItem("aranchat_layout", m[1]);
    history.replaceState(null, "", location.pathname + location.search.replace(/[?&]ac_layout=(on|off)\b/, "").replace(/^&/, "?") + location.hash);
  }
  var pref = localStorage.getItem("aranchat_layout");
  if (pref ? pref === "on" : LAYOUT_DEFAULT) document.documentElement.classList.add("ac-layout");
} catch (e) {}
