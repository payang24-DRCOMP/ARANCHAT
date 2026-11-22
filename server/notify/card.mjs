// การ์ดแจ้งเตือนแบบรูปภาพ (คล้าย LINE Flex) — SVG → PNG ด้วย sharp
// ฟอนต์ Sarabun ใน fonts/ (FONTCONFIG_FILE ใน .env) · ไม่ใช้ emoji ในรูป (librsvg วาด emoji สีไม่ได้)
// แชทแสดงรูป + คำบรรยายใต้รูป (หัวข้อ + ลิงก์ที่กดได้) — คำบรรยายคือข้อความที่เด้งบนจอมือถือและค้นหาได้
import sharp from "sharp";

const W = 720;
const PAD = 40;
const FONT = "Sarabun";

// สีประจำระบบ: [สีหลัก, สีไล่เฉด, ตัวอักษรในวงกลม]
export const THEMES = {
  arankub: ["#0B7A8C", "#0FA48F", "A"],
  p4p: ["#5B3FC4", "#8B5CF6", "P"],
  nhso: ["#15803D", "#22C55E", "สป"],
  system: ["#334155", "#64748B", "!"],
  sos: ["#B91C1C", "#EF4444", "SOS"],
  default: ["#5B3FD9", "#8B5CF6", "A"],
};
const URGENT = ["#B91C1C", "#EF4444"];

/** ผสมสีกับขาว — ใช้ทำสีไล่เฉดของแถบหัวจากสีเดียวที่ admin เลือก */
function lighten(hex, t) {
  const n = parseInt(hex.replace("#", ""), 16);
  const mix = (v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, "0");
  return `#${mix(n >> 16)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

const xml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

// ความกว้างโดยประมาณ: สระบน/ล่าง วรรณยุกต์ของไทยไม่กินที่
const ZERO = /[ัิ-ฺ็-๎]/u;
function textWidth(s, size) {
  let w = 0;
  for (const ch of s) {
    if (ZERO.test(ch)) continue;
    w += /[A-Z0-9]/.test(ch) ? 0.6 : /[a-z]/.test(ch) ? 0.5 : ch === " " ? 0.28 : 0.55;
  }
  return w * size;
}

/** ตัดบรรทัดตามคำ (ภาษาไทยไม่มีเว้นวรรค → ใช้ Intl.Segmenter) */
function wrap(text, size, maxW, maxLines) {
  const seg = new Intl.Segmenter("th", { granularity: "word" });
  const out = [];
  for (const para of String(text ?? "").split("\n")) {
    let line = "";
    for (const { segment } of seg.segment(para)) {
      if (textWidth(line + segment, size) > maxW && line.trim()) {
        out.push(line.trim());
        line = segment.trimStart();
      } else line += segment;
    }
    if (line.trim()) out.push(line.trim());
  }
  if (out.length > maxLines) {
    out.length = maxLines;
    out[maxLines - 1] = out[maxLines - 1].replace(/.{0,2}$/u, "") + "…";
  }
  return out;
}

/**
 * @param {object} c
 * @param {string} c.theme     คีย์ใน THEMES
 * @param {string} c.system    ชื่อระบบบนแถบหัว เช่น "AranKub"
 * @param {string} c.topic     เรื่อง เช่น "งานส่งยา · ส่งไม่สำเร็จ"
 * @param {string} c.title     หัวข้อตัวใหญ่
 * @param {string} [c.body]    รายละเอียด (หลายบรรทัดได้)
 * @param {boolean} [c.urgent]
 * @param {Date} [c.at]
 */
export async function renderCard(c) {
  // ระบบที่ admin เพิ่มเอง: ส่งสีมาตรงๆ [สีหลัก, สีไล่เฉด|null, ตัวอักษรในวงกลม]
  const [c1, c2raw, mark] = c.colors ?? THEMES[c.theme] ?? THEMES.default;
  const c2 = c2raw ?? lighten(c1, 0.25);
  const [h1, h2] = c.urgent ? URGENT : [c1, c2];
  const inner = W - PAD * 2;
  const titleLines = wrap(c.title, 38, inner, 3);
  const bodyLines = wrap(c.body, 27, inner - 28, 7);
  const at = (c.at ?? new Date()).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const HEAD = 128;
  let y = HEAD + 58;
  let svg = "";
  for (const l of titleLines) {
    svg += `<text x="${PAD}" y="${y}" font-family="${FONT}" font-weight="700" font-size="38" fill="#0F172A">${xml(l)}</text>`;
    y += 50;
  }
  if (bodyLines.length) {
    y += 8;
    const top = y - 30;
    for (const l of bodyLines) {
      svg += `<text x="${PAD + 28}" y="${y}" font-family="${FONT}" font-size="27" fill="#334155">${xml(l)}</text>`;
      y += 40;
    }
    // แถบสีด้านซ้ายของรายละเอียด (แบบ quote)
    svg = `<rect x="${PAD}" y="${top}" width="6" height="${y - top - 22}" rx="3" fill="${c1}" opacity="0.55"/>` + svg;
  }
  // ไม่วาดปุ่มในรูป — รูปกดไม่ได้ ผู้ใช้จะกดแล้วงง · ลิงก์อยู่ในคำบรรยายใต้รูป
  y += 30;
  svg += `<line x1="${PAD}" y1="${y - 30}" x2="${W - PAD}" y2="${y - 30}" stroke="#E2E8F0" stroke-width="2"/>`;
  y += 18;
  svg += `<text x="${PAD}" y="${y}" font-family="${FONT}" font-size="22" fill="#94A3B8">${xml(at)} น.</text>`
    + `<text x="${W - PAD}" y="${y}" text-anchor="end" font-family="${FONT}" font-weight="600" font-size="22" fill="#94A3B8">ARANKUB AI</text>`;
  const H = y + 34;

  const markSize = mark.length > 2 ? 22 : mark.length > 1 ? 26 : 34;
  const full = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${h1}"/><stop offset="1" stop-color="${h2}"/></linearGradient>
    <clipPath id="r"><rect width="${W}" height="${H}" rx="32"/></clipPath>
  </defs>
  <g clip-path="url(#r)">
    <rect width="${W}" height="${H}" fill="#FFFFFF"/>
    <rect width="${W}" height="${HEAD}" fill="url(#g)"/>
    <circle cx="${W - 70}" cy="-10" r="90" fill="#FFFFFF" opacity="0.08"/>
    <circle cx="${W - 10}" cy="${HEAD}" r="60" fill="#FFFFFF" opacity="0.08"/>
    <circle cx="${PAD + 34}" cy="${HEAD / 2}" r="34" fill="#FFFFFF"/>
    <text x="${PAD + 34}" y="${HEAD / 2 + markSize * 0.36}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${markSize}" fill="${h1}">${xml(mark)}</text>
    <text x="${PAD + 86}" y="${HEAD / 2 - 6}" font-family="${FONT}" font-weight="700" font-size="32" fill="#FFFFFF">${xml(c.system)}</text>
    <text x="${PAD + 86}" y="${HEAD / 2 + 30}" font-family="${FONT}" font-size="24" fill="#FFFFFF" opacity="0.9">${xml(c.topic)}</text>
    ${c.urgent ? `<rect x="${W - PAD - 104}" y="${HEAD / 2 - 24}" width="104" height="48" rx="24" fill="#FFFFFF"/><text x="${W - PAD - 52}" y="${HEAD / 2 + 9}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="26" fill="${URGENT[0]}">ด่วน</text>` : ""}
    ${svg}
  </g>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="32" fill="none" stroke="#E2E8F0"/>
</svg>`;
  const png = await sharp(Buffer.from(full), { density: 144 }).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
  const meta = await sharp(png).metadata();
  return { png, w: meta.width, h: meta.height };
}
