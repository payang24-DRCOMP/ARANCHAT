// ไอคอนแอป Desktop: icon.png (512px — Linux/mac) + icon.ico (Windows: 16–256px รวมในไฟล์เดียว)
// ใช้: node aranchat/make-desktop-icons.mjs <icon ≥1024px> <apps/desktop/build>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_PATH || "/home/payang/aranchat-ess/notify/node_modules/sharp");
const [src, outDir] = process.argv.slice(2);

await sharp(src).resize(512, 512).png().toFile(path.join(outDir, "icon.png"));

// ICO = header + ตารางรูป + รูป PNG ต่อกัน (Windows Vista ขึ้นไปอ่าน PNG ใน ICO ได้)
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(sizes.map((s) => sharp(src).resize(s, s).png().toBuffer()));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
const dir = Buffer.alloc(16 * sizes.length);
let offset = 6 + dir.length;
sizes.forEach((s, i) => {
  const e = i * 16;
  dir.writeUInt8(s >= 256 ? 0 : s, e); dir.writeUInt8(s >= 256 ? 0 : s, e + 1);
  dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(pngs[i].length, e + 8); dir.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
fs.writeFileSync(path.join(outDir, "icon.ico"), Buffer.concat([header, dir, ...pngs]));
console.log("ไอคอน Desktop: icon.png + icon.ico");
