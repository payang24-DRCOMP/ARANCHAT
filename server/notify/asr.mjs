// AranChat — ถอดเสียงภาษาไทย + สรุปประชุม (ทุกอย่างรันบนเครื่องของ รพ. ไฟล์ไม่ออกนอก)
//   ถอดเสียง: OpenThai2.0-ASR-Streaming (iapp, OpenMDW-1.1) — ~/aranchat-ess/asr/run.sh (pm2 aranchat-asr, 127.0.0.1:18081, GPU 1)
//   สรุป:    ollama (qwen2.5 ค่าเริ่มต้น) — 127.0.0.1:11434
// ใช้ 2 ทาง: (1) ส่งไฟล์เสียง/วิดีโอประชุมเข้าแชทกับบอท → บทถอด + สรุป  (2) ปุ่ม "ถอดเป็นข้อความ" ที่ข้อความเสียงในแอป (POST /api/notify/asr)

const env = (k, d) => process.env[k] ?? d;
export const ASR_URL = env("ASR_URL", "http://127.0.0.1:18081/v1/transcribe");
const OLLAMA_URL = env("OLLAMA_URL", "http://127.0.0.1:11434/api/chat");
// qwen2.5 สรุปภาษาไทยได้ครบ/ถูกกว่า qwen3.5:9b ในการทดสอบ (16 พ.ย. 2569) — เปลี่ยนได้ด้วย SUMMARY_MODEL
const SUMMARY_MODEL = env("SUMMARY_MODEL", "qwen2.5:latest");
export const ASR_MAX_BYTES = 200 * 1024 * 1024;   // ไฟล์ประชุม 1–2 ชม. (m4a/mp3) อยู่ในขนาดนี้
const MEETING_MIN_S = 180;                        // ยาวกว่า 3 นาที = แยกผู้พูด (โหมด meeting)

/** ถอดเสียง → { text, duration_s, segments?, speakers? } */
export async function transcribe(buf, { name = "audio", mime = "application/octet-stream", durationS = 0, meeting } = {}) {
  const fd = new FormData();
  fd.append("file", buf instanceof Blob ? buf : new Blob([buf], { type: mime }), name);
  const mode = meeting ?? durationS >= MEETING_MIN_S ? "meeting" : "standard";
  fd.append("mode", mode);
  // ไฟล์ยาว: ประมวลผลได้ราว 7 เท่าของเวลาจริงบน GPU — เผื่อเวลาโหลดโมเดลครั้งแรก
  const timeout = Math.max(180_000, durationS * 1000) + 120_000;
  const r = await fetch(ASR_URL, { method: "POST", body: fd, signal: AbortSignal.timeout(timeout) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.detail ?? `ASR ${r.status}`), { status: r.status });
  return { ...data, text: String(data.display_text ?? data.text ?? "").trim(), mode };
}

/** บทถอดแบบมีผู้พูด/เวลา (โหมด meeting) หรือข้อความล้วน */
export function transcriptText(res) {
  const segs = Array.isArray(res.segments) ? res.segments : [];
  if (!segs.length || !segs.some((s) => s.speaker != null)) return res.text;
  const t = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const names = new Map();
  return segs.map((s) => {
    if (!names.has(s.speaker)) names.set(s.speaker, `ผู้พูด ${names.size + 1}`);
    return `[${t(s.start ?? 0)}] ${names.get(s.speaker)}: ${String(s.text ?? "").trim()}`;
  }).join("\n");
}

const SUMMARY_PROMPT = `คุณคือเลขานุการการประชุมของโรงพยาบาล สรุปบทถอดเสียงเป็นภาษาไทย ตอบตามรูปแบบนี้เท่านั้น (แต่ละข้อขึ้นต้นด้วย "- " บรรทัดละข้อ):

หัวข้อ: <1 บรรทัด>

ประเด็นสำคัญ:
- <เรื่องที่คุยกัน ไม่เกิน 7 ข้อ>

มติที่ประชุม:
- <สิ่งที่ที่ประชุมตกลง/อนุมัติ/เห็นด้วย เช่น "ตกลง…", "เห็นด้วยให้…", "สรุปมติว่า…" — ถ้าไม่มีการตกลงใดๆ เลยจึงเขียน "- ไม่มี">

งานที่ต้องทำ:
- <ใคร> – <ทำอะไร> – <เมื่อไร> (ทุกงานที่มีคนรับไปทำ · ไม่ระบุคน/เวลา ให้เขียน "ไม่ระบุ")

นัดประชุมครั้งถัดไป: <วันเวลา หรือ "ไม่ระบุ">

ข้อห้าม: ห้ามแต่งข้อมูลที่ไม่มีในบทถอด · บทถอดเสียงอาจสะกดผิด ให้ตีความตามบริบทและเขียนให้ถูก · ห้ามใส่ชื่อผู้ป่วยหรือเลขประจำตัวผู้ป่วย`;

const NOTES_PROMPT = `คุณคือเลขานุการการประชุมของโรงพยาบาล นี่คือบทถอดเสียง "ช่วงหนึ่ง" ของการประชุมที่ยาว
จดบันทึกเป็นภาษาไทยแบบย่อ บรรทัดละข้อ ขึ้นต้นด้วย "- " ให้ครบทุกเรื่องที่คุย ทุกข้อตกลง/มติ ทุกงานที่มีคนรับไปทำ (ใคร ทำอะไร เมื่อไร) ตัวเลข วันที่ ที่สำคัญ
ไม่ต้องมีหัวข้อหรือคำเกริ่น · ห้ามแต่งข้อมูลที่ไม่มีในบทถอด · ห้ามใส่ชื่อผู้ป่วยหรือเลขประจำตัวผู้ป่วย`;

async function chat(system, user, ctx = 16384) {
  const r = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: SUMMARY_MODEL, stream: false, think: false,
      options: { temperature: 0.2, num_ctx: ctx },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `ollama ${r.status}`);
  return String(data.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/** ตัดบทถอดเป็นช่วง ๆ ตามบรรทัด (ไม่ตัดกลางประโยค) */
function chunks(text, size) {
  const out = []; let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length > size) { out.push(cur); cur = ""; }
    cur += (cur ? "\n" : "") + line;
    while (cur.length > size * 1.5) { out.push(cur.slice(0, size)); cur = cur.slice(size); }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** สรุปการประชุมยาว (เกิน ~1 ชม.): จดบันทึกทีละช่วง แล้วสรุปรวมจากบันทึก — ไม่ทิ้งช่วงกลางของการประชุม */
export async function summarizeLong(transcript, onProgress) {
  if (transcript.length <= 24_000) return summarize(transcript);
  const parts = chunks(transcript, 12_000);
  const notes = [];
  for (let i = 0; i < parts.length; i++) {
    onProgress?.(i + 1, parts.length);
    notes.push(`[ช่วงที่ ${i + 1}/${parts.length}]\n${await chat(NOTES_PROMPT, `บทถอดเสียงช่วงที่ ${i + 1} จาก ${parts.length}:\n${parts[i]}`)}`);
  }
  let joined = notes.join("\n\n");
  if (joined.length > 24_000) joined = joined.slice(0, 24_000);
  return summarize(`(บันทึกย่อเรียงตามช่วงเวลาของการประชุม)\n${joined}`, { force: true });
}

/** สรุปประชุมด้วย AI ในเครื่อง — คืนข้อความ หรือ null ถ้าสั้นเกินไป/ระบบสรุปไม่ว่าง */
export async function summarize(transcript, { force = false } = {}) {
  if (transcript.length < 200 && !force) return null;
  // ตัดให้พอดีบริบทของโมเดล (ประมาณ 1 ชม. ของการพูด) — ยาวกว่านั้นใช้ summarizeLong
  const text = transcript.length > 24_000 ? `${transcript.slice(0, 16_000)}\n…(ตัดช่วงกลาง)…\n${transcript.slice(-8_000)}` : transcript;
  const r = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: SUMMARY_MODEL, stream: false, think: false,
      options: { temperature: 0.2, num_ctx: 16384 },
      messages: [{ role: "system", content: SUMMARY_PROMPT }, { role: "user", content: `บทถอดเสียง:\n${text}` }],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `ollama ${r.status}`);
  return String(data.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim() || null;
}
