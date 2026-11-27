// AranChat จดประชุม: แปลงเสียงเป็น PCM16 16 kHz mono (โหลดจากไฟล์ — CSP script-src ไม่อนุญาต blob:)
class AranPcm extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.pos = 0; this.buf = new Int16Array(3200); this.n = 0; this.sum = 0; this.cnt = 0; }
  process(inputs) {
    const ch = inputs[0]; if (!ch || !ch.length) return true;
    const len = ch[0].length;
    for (let i = 0; i < len; i++) {
      let v = 0; for (let c = 0; c < ch.length; c++) v += ch[c][i]; v /= ch.length;
      this.sum += v * v; this.cnt++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const s = Math.max(-1, Math.min(1, v));
        this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.n === this.buf.length) {
          this.port.postMessage({ pcm: this.buf.buffer, rms: Math.sqrt(this.sum / this.cnt) }, [this.buf.buffer]);
          this.buf = new Int16Array(3200); this.n = 0; this.sum = 0; this.cnt = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("aran-pcm", AranPcm);
