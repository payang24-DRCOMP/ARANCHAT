// สติกเกอร์ชุด "น้องอรัญ" ของ AranChat — วาดเอง (SVG → PNG ด้วย sharp) ไม่ใช้ภาพของแอปอื่น
// ใช้: FONTCONFIG_FILE=~/aranchat-ess/notify/fonts/fonts.conf node aranchat/make-stickers.mjs
// ได้: apps/web/res/aranchat-stickers/{<id>.png, pack.json}  (เว็บ) และคัดลอกไป element-x-android (assets)
// เพิ่ม/แก้สติกเกอร์: แก้ STICKERS ด้านล่างแล้วรันใหม่ — id ห้ามซ้ำ/ห้ามเปลี่ยน (แอปจำ mxc ที่อัปโหลดแล้วตาม id)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire("/home/payang/aranchat-ess/notify/package.json");
const sharp = require("sharp");

const HERE = path.dirname(new URL(import.meta.url).pathname);
const WEB_OUT = path.join(HERE, "../apps/web/res/aranchat-stickers");
const ANDROID_OUT = "/home/payang/aranchat-apps/element-x-android/features/messages/impl/src/main/assets/aranchat-stickers";
const S = 320; // px ของไฟล์ (แสดงจริง ~160px — คมบนจอ 2x)

const INK = "#1E1350";
const PURPLE = "#5B3FD9";

// ── หน้าตา ──────────────────────────────────────────────────────────────────────
const eye = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="11" ry="14" fill="${INK}"/><circle cx="${x + 4}" cy="${y - 5}" r="4" fill="#fff"/>`;
const FACES = {
  normal: () => eye(128, 112) + eye(192, 112) + `<path d="M138 140 Q160 160 182 140" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`,
  happy: () =>
    `<path d="M114 116 Q128 98 142 116 M178 116 Q192 98 206 116" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>` +
    `<path d="M134 136 Q160 172 186 136 Z" fill="${INK}"/><path d="M146 152 Q160 162 174 152 Q160 146 146 152Z" fill="#FF8FA3"/>`,
  wink: () =>
    eye(128, 112) + `<path d="M178 114 Q192 102 206 114" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>` +
    `<path d="M136 138 Q160 162 184 138" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`,
  surprised: () => eye(128, 108) + eye(192, 108) + `<ellipse cx="160" cy="148" rx="13" ry="16" fill="${INK}"/>`,
  sorry: () =>
    `<path d="M114 104 L140 112 M206 104 L180 112" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>` +
    eye(128, 120) + eye(192, 120) + `<path d="M142 152 Q160 140 178 152" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M228 70 Q240 92 228 100 Q216 92 228 70Z" fill="#7DD3FC" stroke="#fff" stroke-width="3"/>`,
  determined: () =>
    `<path d="M112 98 L142 108 M208 98 L178 108" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>` +
    eye(128, 120) + eye(192, 120) + `<path d="M140 146 L180 146" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`,
  sleepy: () =>
    `<path d="M114 116 Q128 126 142 116 M178 116 Q192 126 206 116" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>` +
    `<ellipse cx="160" cy="146" rx="8" ry="6" fill="${INK}"/>`,
  love: () => {
    const h = (x, y) => `<path d="M${x} ${y + 12} C${x - 22} ${y - 4} ${x - 10} ${y - 20} ${x} ${y - 8} C${x + 10} ${y - 20} ${x + 22} ${y - 4} ${x} ${y + 12}Z" fill="#F43F5E"/>`;
    return h(128, 112) + h(192, 112) + `<path d="M136 140 Q160 166 184 140" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`;
  },
};

// ── ของประกอบ ───────────────────────────────────────────────────────────────────
const heart = (x, y, s = 1, c = "#F43F5E") =>
  `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 14 C-26 -4 -12 -24 0 -10 C12 -24 26 -4 0 14Z" fill="${c}" stroke="#fff" stroke-width="4"/></g>`;
const star = (x, y, r, c = "#FBBF24") => {
  const p = [...Array(10)].map((_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    return `${(x + rr * Math.cos(a)).toFixed(1)},${(y + rr * Math.sin(a)).toFixed(1)}`;
  });
  return `<polygon points="${p.join(" ")}" fill="${c}" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>`;
};
const sparkle = (x, y, r, c = "#FBBF24") =>
  `<path d="M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}Z" fill="${c}"/>`;
const badge = (x, y, c, inner) => `<circle cx="${x}" cy="${y}" r="34" fill="${c}" stroke="#fff" stroke-width="7"/>${inner}`;
const PROPS = {
  check: () => badge(250, 70, "#22C55E", `<path d="M234 70 L246 83 L268 58" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`),
  hearts: () => heart(250, 64, 1.3) + heart(282, 104, 0.8, "#FB7185"),
  sparkle: () => sparkle(254, 64, 26) + sparkle(286, 104, 13, "#A78BFA"),
  stars: () => star(254, 62, 28) + star(52, 70, 18, "#FCD34D") + sparkle(286, 110, 12),
  burst: () => `<g stroke="#F97316" stroke-width="8" stroke-linecap="round"><path d="M244 40 L256 18 M272 60 L296 50 M276 92 L300 98 M64 52 L46 32 M48 86 L24 82"/></g>` + star(260, 64, 16, "#F97316"),
  clock: () => badge(250, 70, "#0EA5E9", `<path d="M250 50 L250 72 L264 80" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`),
  phone: () => badge(250, 70, "#22C55E", `<path d="M236 58 q6 -6 10 0 l5 8 q2 4 -2 7 l-3 3 q4 8 12 12 l3 -3 q3 -4 7 -2 l8 5 q6 4 0 10 q-8 8 -18 2 q-16 -9 -24 -24 q-6 -10 2 -18z" fill="#fff"/>`),
  motion: () => `<g stroke="#A78BFA" stroke-width="9" stroke-linecap="round"><path d="M22 92 L62 92 M14 124 L58 124 M28 156 L60 156"/></g>`,
  urgent: () => badge(252, 68, "#EF4444", `<path d="M252 48 L252 74" stroke="#fff" stroke-width="10" stroke-linecap="round"/><circle cx="252" cy="88" r="6" fill="#fff"/>`),
  sun: () => `<g stroke="#F59E0B" stroke-width="7" stroke-linecap="round">${[...Array(8)].map((_, i) => { const a = (Math.PI / 4) * i; return `<path d="M${(254 + 36 * Math.cos(a)).toFixed(1)} ${(62 + 36 * Math.sin(a)).toFixed(1)} L${(254 + 50 * Math.cos(a)).toFixed(1)} ${(62 + 50 * Math.sin(a)).toFixed(1)}"/>`; }).join("")}</g><circle cx="254" cy="62" r="26" fill="#FBBF24" stroke="#fff" stroke-width="5"/>`,
  moon: () => `<path d="M266 34 A34 34 0 1 0 290 88 A26 26 0 1 1 266 34Z" fill="#FCD34D" stroke="#fff" stroke-width="5"/>` +
    `<text x="214" y="58" font-family="Sarabun" font-weight="700" font-size="26" fill="#818CF8">z</text><text x="196" y="36" font-family="Sarabun" font-weight="700" font-size="20" fill="#A5B4FC">z</text>`,
  confetti: () => ["#F43F5E,40,50,20", "#22C55E,276,40,-25", "#FBBF24,292,96,40", "#0EA5E9,30,104,-35", "#A78BFA,250,20,15"]
    .map((s) => { const [c, x, y, r] = s.split(","); return `<rect x="${x}" y="${y}" width="22" height="10" rx="3" fill="${c}" transform="rotate(${r} ${x} ${y})"/>`; }).join("") + star(258, 70, 18),
  bulb: () => `<circle cx="254" cy="58" r="28" fill="#FDE047" stroke="#fff" stroke-width="6"/><rect x="242" y="84" width="24" height="16" rx="4" fill="#94A3B8" stroke="#fff" stroke-width="4"/>` +
    `<g stroke="#FACC15" stroke-width="6" stroke-linecap="round"><path d="M254 14 L254 4 M290 30 L298 22 M218 30 L210 22"/></g>`,
  calendar: () => `<rect x="218" y="36" width="70" height="64" rx="12" fill="#fff" stroke="${PURPLE}" stroke-width="6"/><rect x="218" y="36" width="70" height="20" rx="10" fill="${PURPLE}"/>` +
    `<path d="M236 74 L248 86 L270 64" fill="none" stroke="#EF4444" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
  bowl: () => `<path d="M214 70 L294 70 Q290 108 254 110 Q218 108 214 70Z" fill="#F97316" stroke="#fff" stroke-width="5"/>` +
    `<g stroke="#CBD5E1" stroke-width="5" stroke-linecap="round" fill="none"><path d="M236 58 q-6 -10 0 -20 M254 58 q-6 -10 0 -20 M272 58 q-6 -10 0 -20"/></g>`,
};

// ── สติกเกอร์ทั้งหมด (id คงที่ — แอปจำ mxc ตาม id) ───────────────────────────────
const STICKERS = [
  ["ack", "รับทราบ", "normal", "check"],
  ["thanks_f", "ขอบคุณค่ะ", "happy", "hearts"],
  ["thanks_m", "ขอบคุณครับ", "happy", "hearts"],
  ["ok", "โอเค", "wink", "sparkle"],
  ["fight", "สู้ๆ นะ", "determined", "burst"],
  ["wait", "รอสักครู่", "normal", "clock"],
  ["callback", "เดี๋ยวโทรกลับ", "normal", "phone"],
  ["coming", "กำลังไป", "happy", "motion"],
  ["urgent", "ด่วน!", "surprised", "urgent"],
  ["sorry", "ขอโทษนะ", "sorry", null],
  ["great", "เยี่ยมมาก", "happy", "stars"],
  ["morning", "สวัสดีตอนเช้า", "happy", "sun"],
  ["night", "ฝันดี", "sleepy", "moon"],
  ["congrats", "ยินดีด้วย", "happy", "confetti"],
  ["understood", "เข้าใจแล้ว", "normal", "bulb"],
  ["meeting", "ติดประชุม", "sorry", "calendar"],
  ["lunch", "พักเที่ยง", "happy", "bowl"],
  ["love", "รักนะ", "love", "hearts"],
];

// ความกว้างตัวอักษรไทยโดยประมาณ (สระบน/ล่าง วรรณยุกต์ไม่กินที่)
const COMBINING = /[ัิ-ฺ็-๎]/g;
const textWidth = (s, size) => s.replace(COMBINING, "").length * size * 0.62;

function svg(caption, face, prop) {
  let fs = 44;
  while (textWidth(caption, fs) > 244 && fs > 24) fs -= 2;
  const pillW = Math.min(300, Math.max(150, textWidth(caption, fs) + 48));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 320 320">
  <defs>
    <linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#A78BFA"/><stop offset="1" stop-color="#6D4AE8"/></linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#1A0F4D" flood-opacity=".28"/></filter>
  </defs>
  <g filter="url(#sh)">
    <g stroke="#fff" stroke-width="14" stroke-linejoin="round">
      <rect x="62" y="40" width="196" height="166" rx="80" fill="url(#b)"/>
      <path d="M100 186 L80 236 L150 200 Z" fill="#6D4AE8"/>
    </g>
    <rect x="62" y="40" width="196" height="166" rx="80" fill="url(#b)"/>
    <path d="M104 190 L86 228 L146 200 Z" fill="#6D4AE8"/>
    <ellipse cx="128" cy="62" rx="40" ry="14" fill="#fff" opacity=".22"/>
    <circle cx="106" cy="142" r="13" fill="#FF8FA3" opacity=".7"/><circle cx="214" cy="142" r="13" fill="#FF8FA3" opacity=".7"/>
    ${FACES[face]()}
    ${prop ? PROPS[prop]() : ""}
    <rect x="${160 - pillW / 2}" y="236" width="${pillW}" height="66" rx="33" fill="#fff" stroke="${PURPLE}" stroke-width="6"/>
    <text x="160" y="${269 + fs * 0.36}" text-anchor="middle" font-family="Sarabun" font-weight="700" font-size="${fs}" fill="${INK}">${caption}</text>
  </g>
</svg>`;
}

fs.mkdirSync(WEB_OUT, { recursive: true });
fs.mkdirSync(ANDROID_OUT, { recursive: true });
const pack = { version: 1, name: "น้องอรัญ", stickers: [] };
for (const [id, caption, face, prop] of STICKERS) {
  const png = await sharp(Buffer.from(svg(caption, face, prop))).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
  for (const dir of [WEB_OUT, ANDROID_OUT]) fs.writeFileSync(path.join(dir, `${id}.png`), png);
  pack.stickers.push({ id, body: caption, file: `${id}.png`, w: S, h: S, size: png.length });
  console.log(id.padEnd(12), caption.padEnd(14), `${(png.length / 1024).toFixed(1)} KB`);
}
for (const dir of [WEB_OUT, ANDROID_OUT]) fs.writeFileSync(path.join(dir, "pack.json"), JSON.stringify(pack, null, 1) + "\n");
// แผ่นรวมไว้ตรวจหน้าตา
const sheet = await sharp({ create: { width: S * 6, height: S * 3, channels: 4, background: "#EEF1F6" } })
  .composite(pack.stickers.map((s, i) => ({ input: path.join(WEB_OUT, s.file), left: (i % 6) * S, top: Math.floor(i / 6) * S })))
  .png().toBuffer();
fs.writeFileSync(path.join(HERE, "stickers/sheet.png"), sheet);
console.log("ok", pack.stickers.length, "ชิ้น");
