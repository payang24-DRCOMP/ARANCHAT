// AranChat iOS — ใส่ภาพแบรนด์ (ไอคอนแอป โลโก้หน้าแรก พื้นหลังหน้าแรก) จากไอคอนชุดเดียวกับ Android
// ใช้: SHARP_PATH=<.../node_modules/sharp> node aranchat/make-brand.mjs [icon.png]
//      ค่าเริ่มต้น icon = ../element-x-android/aranchat/icon.png (1024px สี่เหลี่ยม มุมโค้งโปร่งใส)
// เทียบ Android: element-x-android/aranchat/make-icons.mjs + make-onboarding.mjs
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_PATH || "sharp");
const icon = process.argv[2] || "../element-x-android/aranchat/icon.png";
const R = "ElementX/Resources";
const IMG = `${R}/Assets.xcassets/images`;

// พื้นมุมไอคอน: ไล่สีให้ใกล้ขอบไอคอน (iOS ตัดมุมเองอยู่แล้ว แต่ไฟล์ต้องทึบเต็มผืน)
const square = (s) => Buffer.from(`<svg width="${s}" height="${s}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#33227F"/><stop offset="1" stop-color="#8B5CF0"/></linearGradient></defs>
  <rect width="${s}" height="${s}" fill="url(#g)"/></svg>`);

// 1. ไอคอนแอป (Icon Composer: AppIcon.icon/Assets/AppIcon.png) — 1024px ไม่มีความโปร่งใส
await sharp(square(1024)).composite([{ input: await sharp(icon).resize(1024, 1024).png().toBuffer() }])
  .removeAlpha().png().toFile(`${R}/AppIcon.icon/Assets/AppIcon.png`);

// 2. โลโก้หน้าแรก (app-logo): ไอคอนมุมโค้งโปร่งใส — แทน app-logo.pdf ของ Element
const logoDir = `${IMG}/app-logo.imageset`;
for (const f of fs.readdirSync(logoDir)) if (f !== "Contents.json") fs.rmSync(`${logoDir}/${f}`);
for (const [scale, px] of [["1x", 158], ["2x", 316], ["3x", 474]]) {
  await sharp(icon).resize(px, px).png().toFile(`${logoDir}/app-logo@${scale}.png`);
}
fs.writeFileSync(`${logoDir}/Contents.json`, JSON.stringify({
  images: ["1x", "2x", "3x"].map((scale) => ({ filename: `app-logo@${scale}.png`, idiom: "universal", scale })),
  info: { author: "xcode", version: 1 },
}, null, 2) + "\n");

// 3. พื้นหลังหน้าแรก: หมุนโทนเขียว-ฟ้าของ Element เป็นม่วงของแบรนด์ (วิธีเดียวกับ Android make-onboarding.mjs)
//    ต้นฉบับเก็บไว้ที่ aranchat/orig/ ครั้งแรก — รันซ้ำก็สร้างจากต้นฉบับ
fs.mkdirSync("aranchat/orig", { recursive: true });
for (const [set, files] of [["launch-background", ["iphone-light", "iphone-dark", "ipad-light", "ipad-dark"]],
                            ["background-bottom", ["background-bottom-light", "background-bottom-dark"]]]) {
  for (const name of files) {
    const f = `${IMG}/${set}.imageset/${name}.png`, o = `aranchat/orig/${set}-${name}.png`;
    if (!fs.existsSync(o)) fs.copyFileSync(f, o);
    const dark = name.endsWith("dark");
    const { width: w, height: h } = await sharp(o).metadata();
    const px = await sharp(o).flatten({ background: dark ? "#000" : "#fff" }).removeAlpha().raw().toBuffer();
    const mask = Buffer.alloc(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
      mask[i] = Math.min(255, (Math.max(r, g, b) - Math.min(r, g, b)) * 1.4);
    }
    const grad = Buffer.from(`<svg width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#A78BFA"/><stop offset="1" stop-color="#5B3FD9"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/></svg>`);
    const rgb = await sharp(grad).removeAlpha().raw().toBuffer();
    const color = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
      .joinChannel(mask, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
    const base = dark ? "#101014" : "#ffffff";
    fs.writeFileSync(f, await sharp({ create: { width: w, height: h, channels: 3, background: base } })
      .composite([{ input: color }]).png().toBuffer());
  }
}
console.log("แบรนด์ iOS: ไอคอนแอป + โลโก้ + พื้นหลังหน้าแรก AranChat แล้ว");
