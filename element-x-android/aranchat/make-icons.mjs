// สร้างไอคอนแอป Android ทุกขนาดจากรูปเดียว (สี่เหลี่ยม ≥1024px)
// ใช้: node aranchat/make-icons.mjs <icon.png> <res dir>
//   ic_launcher / ic_launcher_round   ไอคอนแบบเดิม (Android < 8)
//   ic_launcher_foreground            adaptive icon: รูปเต็มผืน 108dp — ระบบตัดขอบเป็นวงกลม/สี่เหลี่ยมโค้งเอง
//   ic_launcher_monochrome            ไอคอนสีเดียว (Android 13 themed icons) จากส่วนสีขาวของรูป
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_PATH || "sharp");
const [src, resDir] = process.argv.slice(2);
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const mono = await sharp(src).resize(1024, 1024).greyscale().threshold(200).toColourspace("b-w").raw().toBuffer({ resolveWithObject: true });
// พิกเซลขาว → ขาวทึบ, อื่นๆ → โปร่งใส
const rgba = Buffer.alloc(1024 * 1024 * 4);
for (let i = 0; i < 1024 * 1024; i++) {
  const on = mono.data[i] > 0;
  rgba.set(on ? [255, 255, 255, 255] : [0, 0, 0, 0], i * 4);
}
const monoPng = await sharp(rgba, { raw: { width: 1024, height: 1024, channels: 4 } }).png().toBuffer();

for (const [d, k] of Object.entries(DENSITY)) {
  const dir = path.join(resDir, `mipmap-${d}`);
  fs.mkdirSync(dir, { recursive: true });
  const legacy = Math.round(48 * k), adaptive = Math.round(108 * k);
  await sharp(src).resize(legacy, legacy).webp({ quality: 95 }).toFile(path.join(dir, "ic_launcher.webp"));
  const circle = Buffer.from(`<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}"/></svg>`);
  await sharp(src).resize(legacy, legacy).composite([{ input: circle, blend: "dest-in" }]).webp({ quality: 95 }).toFile(path.join(dir, "ic_launcher_round.webp"));
  await sharp(src).resize(adaptive, adaptive).webp({ quality: 95 }).toFile(path.join(dir, "ic_launcher_foreground.webp"));
  // themed icon: ย่อให้อยู่ในพื้นที่ปลอดภัย 66% ตรงกลาง
  const inner = Math.round(adaptive * 0.62), pad = Math.round((adaptive - inner) / 2);
  await sharp(monoPng).resize(inner, inner).extend({ top: pad, bottom: adaptive - inner - pad, left: pad, right: adaptive - inner - pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 95 }).toFile(path.join(dir, "ic_launcher_monochrome.webp"));
}
// ไอคอนสำหรับหน้าร้าน (Play Store 512px)
await sharp(src).resize(512, 512).png().toFile(path.join(resDir, "..", "ic_launcher-playstore.png"));
console.log("ไอคอนครบทุกขนาดแล้ว:", resDir);
