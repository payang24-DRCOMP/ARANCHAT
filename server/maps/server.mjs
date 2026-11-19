// AranChat — server แผนที่ของ รพ. (แผนที่ประเทศไทยจาก OpenStreetMap · ภาพแผนที่ไม่ต้องพึ่งบริการภายนอก)
//
//   https://<chat>/maps/tiles/{z}/{x}/{y}.png        ภาพแผนที่ (raster 256px) — Leaflet ของ AranKub ใช้ได้ตรงๆ
//   https://<chat>/maps/tiles-dark/{z}/{x}/{y}.png   แบบมืด (กลับสี) สำหรับโหมดมืดของแอป
//   https://<chat>/maps/{light|dark}/style.json       style ของ MapLibre — Element Web (map_style_url) / Android / iOS
//   https://<chat>/maps/{light|dark}/static/{lon},{lat},{zoom}/{w}x{h}[@2x].{webp|png}
//                                                     ภาพแผนที่ย่อในแชท — รูปแบบ URL เดียวกับ MapTiler (แอปมือถือเรียกแบบนี้)
//
// ภาพแผนที่วาดโดย openstreetmap-tile-server (docker "aranchat-osm" — ดู maps/README.md) แล้วเก็บแคชบนดิสก์
// พิกัดที่แอปขอภาพย่อไม่ถูกบันทึก (log เฉพาะข้อผิดพลาด) — ตำแหน่งที่แชร์ในแชทเป็นข้อมูลส่วนตัว
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_PATH || "sharp");

const env = (k, d) => process.env[k] ?? d;
const HOST = env("HOST", "10.42.0.1");
const PORT = Number(env("PORT", "3214"));
const UPSTREAM = env("TILE_UPSTREAM", "http://127.0.0.1:18090/tile");   // openstreetmap-tile-server
const PUBLIC = env("PUBLIC_URL", "https://chat.arankub.com/maps").replace(/\/$/, "");
const CACHE = env("CACHE_DIR", new URL("./data/cache", import.meta.url).pathname);
const CACHE_DAYS = Number(env("CACHE_DAYS", "30"));
const MAX_Z = 19;
const ATTRIBUTION = "© OpenStreetMap contributors";
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ── ภาพแผนที่ 1 ช่อง (256px) ──────────────────────────────────────────────────────
const inflight = new Map();
async function tile(z, x, y, dark = false) {
  const file = path.join(CACHE, dark ? "dark" : "light", String(z), String(x), `${y}.png`);
  try {
    const st = await fs.stat(file);
    if (Date.now() - st.mtimeMs < CACHE_DAYS * 86400_000) return fs.readFile(file);
  } catch {}
  const key = file;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    let png;
    if (dark) {
      // โหมดมืด: กลับสี + หมุนเฉดสีกลับ (ถนน/น้ำยังสีเดิมโดยประมาณ) + ลดความสว่างลงเล็กน้อย
      png = await sharp(await tile(z, x, y, false)).negate({ alpha: false }).modulate({ hue: 180, brightness: 0.9 }).png().toBuffer();
    } else {
      const r = await fetch(`${UPSTREAM}/${z}/${x}/${y}.png`, { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw Object.assign(new Error(`tile server ${r.status}`), { status: 502 });
      png = Buffer.from(await r.arrayBuffer());
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file + ".tmp", png);
    await fs.rename(file + ".tmp", file);
    return png;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ── style ของ MapLibre (ภาพแผนที่แบบ raster) ─────────────────────────────────────────
function style(dark) {
  return {
    version: 8,
    name: dark ? "AranChat มืด" : "AranChat",
    sources: {
      osm: {
        type: "raster", tileSize: 256, minzoom: 0, maxzoom: MAX_Z, attribution: ATTRIBUTION,
        tiles: [`${PUBLIC}/${dark ? "tiles-dark" : "tiles"}/{z}/{x}/{y}.png`],
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": dark ? "#1b1d22" : "#f2efe9" } },
      { id: "osm", type: "raster", source: "osm" },
    ],
  };
}

// ── ภาพแผนที่ย่อ: ต่อภาพหลายช่องให้จุดกลางอยู่ที่พิกัด ───────────────────────────────────────
async function staticMap({ lon, lat, zoom, w, h, scale, dark, format }) {
  // @2x = ใช้ภาพซูมมากกว่า 1 ระดับ (ความละเอียด 2 เท่า ขนาดตัวอักษรเท่าเดิม)
  const zf = Math.min(Math.max(zoom, 1), MAX_Z - (scale - 1));
  const z = Math.min(Math.round(zf) + (scale - 1), MAX_Z);
  const W = w * scale, H = h * scale;
  const n = 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  const cx = ((lon + 180) / 360) * n * 256;
  const cy = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n * 256;
  const left = cx - W / 2, top = cy - H / 2;
  const x0 = Math.floor(left / 256), x1 = Math.floor((left + W - 1) / 256);
  const y0 = Math.floor(top / 256), y1 = Math.floor((top + H - 1) / 256);
  const parts = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n;
      parts.push(tile(z, wx, ty, dark).then((input) => ({
        input, left: Math.round(tx * 256 - left), top: Math.round(ty * 256 - top),
      })));
    }
  }
  const tiles = await Promise.all(parts);
  // ช่องที่ล้นขอบภาพ: sharp composite ไม่รับตำแหน่งติดลบ → วางบนผืนใหญ่แล้วตัด
  const pad = 256;
  const bg = dark ? { r: 27, g: 29, b: 34, alpha: 1 } : { r: 242, g: 239, b: 233, alpha: 1 };
  const fs2 = 8 * scale;
  const lw = Math.min(W, Math.ceil(ATTRIBUTION.length * fs2 * 0.56) + 6 * scale);
  const label = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lw}" height="${fs2 + 6 * scale}">` +
    `<rect width="100%" height="100%" fill="${dark ? "#000" : "#fff"}" fill-opacity="0.6"/>` +
    `<text x="${3 * scale}" y="${fs2 + 1 * scale}" font-family="sans-serif" font-size="${fs2}" fill="${dark ? "#ddd" : "#333"}">${ATTRIBUTION}</text></svg>`,
  );
  const canvas = await sharp({ create: { width: W + 2 * pad, height: H + 2 * pad, channels: 4, background: bg } })
    .composite(tiles.map((t) => ({ input: t.input, left: t.left + pad, top: t.top + pad })))
    .png().toBuffer();
  const img = sharp(canvas).extract({ left: pad, top: pad, width: W, height: H })
    .composite([{ input: await sharp(label).png().toBuffer(), gravity: "southeast" }]);
  return format === "png" ? img.png().toBuffer() : img.webp({ quality: 85 }).toBuffer();
}

// ── จำกัดการเรียกต่อ IP (กันดูดแผนที่ทั้งประเทศ) ───────────────────────────────────────────
const RATE = Number(env("RATE_PER_MIN", "1200"));
const buckets = new Map();
function allowed(ip) {
  const now = Date.now();
  const b = buckets.get(ip) ?? { n: RATE, t: now };
  b.n = Math.min(RATE, b.n + ((now - b.t) / 60_000) * RATE);
  b.t = now;
  if (b.n < 1) { buckets.set(ip, b); return false; }
  b.n -= 1;
  buckets.set(ip, b);
  return true;
}
setInterval(() => { const old = Date.now() - 600_000; for (const [k, b] of buckets) if (b.t < old) buckets.delete(k); }, 600_000).unref();

const TYPES = { png: "image/png", webp: "image/webp", json: "application/json" };
function send(res, status, body, type, maxAge = 86400) {
  res.writeHead(status, {
    "Content-Type": type, "Access-Control-Allow-Origin": "*",
    "Cache-Control": status === 200 ? `public, max-age=${maxAge}` : "no-store",
  });
  res.end(body);
}

http.createServer(async (req, res) => {
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress).split(",")[0].trim();
  const p = new URL(req.url, "http://x").pathname.replace(/^\/maps/, "");
  try {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method", "text/plain");
    if (p === "/health") return send(res, 200, JSON.stringify({ ok: true }), TYPES.json, 0);
    let m;
    if ((m = p.match(/^\/(light|dark)\/style\.json$/))) return send(res, 200, JSON.stringify(style(m[1] === "dark")), TYPES.json, 3600);
    if (!allowed(ip)) return send(res, 429, "ขอแผนที่ถี่เกินไป", "text/plain");
    if ((m = p.match(/^\/(tiles|tiles-dark)\/(\d+)\/(\d+)\/(\d+)\.png$/))) {
      const [z, x, y] = [m[2], m[3], m[4]].map(Number);
      if (z > MAX_Z || x >= 2 ** z || y >= 2 ** z) return send(res, 404, "ไม่มี", "text/plain");
      return send(res, 200, await tile(z, x, y, m[1] === "tiles-dark"), TYPES.png, 7 * 86400);
    }
    // MapTiler: /{mapId}/static/{lon},{lat},{zoom}/{w}x{h}[@2x].{format}
    if ((m = p.match(/^\/(light|dark)\/static\/(-?[\d.]+),(-?[\d.]+),([\d.]+)\/(\d+)x(\d+)(@2x)?\.(webp|png)$/))) {
      const [lon, lat, zoom, w, h] = [m[2], m[3], m[4], m[5], m[6]].map(Number);
      if (!(Math.abs(lon) <= 180 && Math.abs(lat) <= 85 && w >= 1 && h >= 1 && w <= 1024 && h <= 1024)) return send(res, 400, "ค่าไม่ถูกต้อง", "text/plain");
      const img = await staticMap({ lon, lat, zoom, w, h, scale: m[7] ? 2 : 1, dark: m[1] === "dark", format: m[8] });
      return send(res, 200, img, TYPES[m[8]], 7 * 86400);
    }
    send(res, 404, "ไม่มี", "text/plain");
  } catch (e) {
    log("error:", p.replace(/\/static\/[^/]+/, "/static/…"), e.message);   // ไม่บันทึกพิกัด
    send(res, e.status ?? 500, "แผนที่ขัดข้อง", "text/plain");
  }
}).listen(PORT, HOST, () => log(`maps: http://${HOST}:${PORT}/maps → ${UPSTREAM}`));
