// หน้าแรกของแอป (ก่อนล็อกอิน): โลโก้ Element + พื้นหลังเขียว-ฟ้า → ไอคอน AranChat + พื้นหลังโทนม่วง
// ใช้: node aranchat/make-onboarding.mjs <icon.png>   (apply-brand.sh เรียกให้)
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_PATH || "sharp");
const [icon] = process.argv.slice(2);
const DS = "libraries/designsystem/src/main/res";

// โลโก้: ขนาดเดิมของไฟล์ Element · ตัดมุมโค้ง (ไอคอนเราเป็นสี่เหลี่ยมเต็มผืน)
for (const dir of ["drawable-xxhdpi", "drawable-night-xxhdpi"]) {
  const f = `${DS}/${dir}/element_logo.png`;
  const { width: s } = await sharp(f).metadata();
  const mask = Buffer.from(`<svg width="${s}" height="${s}"><rect width="${s}" height="${s}" rx="${s * 0.23}" fill="#fff"/></svg>`);
  const out = await sharp(icon).resize(s, s).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  fs.writeFileSync(f, out);
}
// พื้นหลัง: หมุนโทนสีเขียว-ฟ้าของต้นฉบับไปทางม่วง (คงรูปทรงแสงเดิม)
// ต้นฉบับเก็บไว้ที่ aranchat/orig/ (ครั้งแรก) — รันซ้ำก็หมุนจากต้นฉบับ ไม่หมุนซ้ำ
fs.mkdirSync("aranchat/orig", { recursive: true });
for (const dir of ["drawable", "drawable-night"]) {
  const f = `${DS}/${dir}/onboarding_bg.png`, o = `aranchat/orig/${dir}-onboarding_bg.png`;
  if (!fs.existsSync(o)) fs.copyFileSync(f, o);
  // ความเข้มของแสงจากต้นฉบับ (ยิ่งมีสียิ่งทึบ) → ใช้เป็นความทึบของไล่สีม่วงอ่อน→ม่วงเข้มของแบรนด์
  const { width: w, height: h } = await sharp(o).metadata();
  // ความสด (chroma = max-min ของ RGB) — ใช้ได้ทั้งพื้นขาว (โหมดสว่าง) และพื้นดำ (โหมดมืด)
  const px = await sharp(o).flatten({ background: dir === "drawable" ? "#fff" : "#000" }).removeAlpha().raw().toBuffer();
  const mask = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
    mask[i] = Math.min(255, (Math.max(r, g, b) - Math.min(r, g, b)) * 1.4);
  }
  const grad = Buffer.from(`<svg width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0">
    <stop offset="0" stop-color="#A78BFA"/><stop offset="1" stop-color="#5B3FD9"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/></svg>`);
  const rgb = await sharp(grad).removeAlpha().raw().toBuffer();   // removeAlpha ทำงานท้ายสุด → แยกเป็น raw ก่อนต่อช่องความทึบ
  const color = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
    .joinChannel(mask, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
  const base = dir === "drawable" ? "#ffffff" : "#101014";
  fs.writeFileSync(f, await sharp({ create: { width: w, height: h, channels: 3, background: base } })
    .composite([{ input: color }]).png().toBuffer());
}
console.log("หน้าแรก: โลโก้ + พื้นหลัง AranChat แล้ว");

// ไอคอนเล็กบนแถบแจ้งเตือน (status bar): Android ใช้เฉพาะความทึบ (สีเดียว) — เดิมเป็นวงแหวนของ Element
// วาดจากรูปทรงใน brand/aranchat-icon.svg: ฟองหลัง + ฟองหน้า เจาะตัว A + รอยยิ้ม/จุดสามจุดให้โปร่ง
{
  const VB = 'viewBox="150 190 720 720" width="512" height="512"';
  const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${VB}>${body}</svg>`);
  const front = '<rect x="168" y="380" width="520" height="420" rx="190"/><path d="M268 730 L214 880 L440 790 Z" stroke-width="16" stroke-linejoin="round"/>';
  const back = '<rect x="430" y="210" width="410" height="320" rx="150"/><path d="M740 480 L812 618 L640 516 Z"/>';
  const layers = [
    { input: svg(`<g fill="#fff">${back}</g>`) },
    { input: svg(`<g fill="#000" stroke="#000" stroke-width="56">${front}</g>`), blend: "dest-out" },   // ช่องว่างรอบฟองหน้า
    { input: svg(`<g fill="#fff" stroke="#fff">${front}</g>`) },
    { input: svg(`<g fill="#000"><circle cx="560" cy="360" r="30"/><circle cx="636" cy="360" r="30"/><circle cx="712" cy="360" r="30"/></g>
      <path d="M310 716 L428 468 L546 716" fill="none" stroke="#000" stroke-width="70" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M358 624 Q428 674 498 624" fill="none" stroke="#000" stroke-width="54" stroke-linecap="round"/>`), blend: "dest-out" },
  ];
  let img = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  for (const l of layers) img = await sharp(img).composite([l]).png().toBuffer();
  if (fs.existsSync(`${DS}/drawable/ic_notification.xml`)) fs.unlinkSync(`${DS}/drawable/ic_notification.xml`);
  for (const [d, k] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
    fs.mkdirSync(`${DS}/drawable-${d}`, { recursive: true });
    await sharp(img).resize(Math.round(24 * k), Math.round(24 * k)).png().toFile(`${DS}/drawable-${d}/ic_notification.png`);
  }
  fs.writeFileSync("aranchat/orig/ic_notification-preview.png", img);
  console.log("ไอคอนแจ้งเตือน: AranChat แล้ว");
}
