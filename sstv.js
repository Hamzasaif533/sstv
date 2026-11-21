/*
 * SSTV encoder — turns an RGBA image into slow-scan TV audio.
 * Works in the browser (window.SSTV) and in Node (module.exports).
 *
 * Supported modes: Robot 36/72, Martin M1/M2, Scottie S1/S2/DX, PD 50/90/120/180.
 * Pixel tones run from 1500 Hz (black) to 2300 Hz (white); sync is 1200 Hz.
 */
(function (root) {
  'use strict';

  const MODES = {
    robot36:  { name: 'Robot 36',  family: 'robot36', vis: 8,  width: 320, height: 240 },
    robot72:  { name: 'Robot 72',  family: 'robot72', vis: 12, width: 320, height: 240 },
    martin1:  { name: 'Martin M1', family: 'martin',  vis: 44, width: 320, height: 256, scan: 146.432 },
    martin2:  { name: 'Martin M2', family: 'martin',  vis: 40, width: 320, height: 256, scan: 73.216 },
    scottie1: { name: 'Scottie S1', family: 'scottie', vis: 60, width: 320, height: 256, scan: 138.240 },
    scottie2: { name: 'Scottie S2', family: 'scottie', vis: 56, width: 320, height: 256, scan: 88.064 },
    scottiedx:{ name: 'Scottie DX', family: 'scottie', vis: 76, width: 320, height: 256, scan: 345.600 },
    pd50:     { name: 'PD 50',  family: 'pd', vis: 93, width: 320, height: 256, scan: 91.520 },
    pd90:     { name: 'PD 90',  family: 'pd', vis: 99, width: 320, height: 256, scan: 170.240 },
    pd120:    { name: 'PD 120', family: 'pd', vis: 95, width: 640, height: 496, scan: 121.600 },
    pd180:    { name: 'PD 180', family: 'pd', vis: 96, width: 640, height: 496, scan: 183.040 },
  };

  const SYNC = 1200, BLACK = 1500, WHITE = 2300;
  const level = (v) => BLACK + (WHITE - BLACK) * (v < 0 ? 0 : v > 255 ? 255 : v) / 255;

  /* Phase-continuous tone writer with exact (fractional-sample) timing. */
  class ToneWriter {
    constructor(sampleRate, totalMs) {
      this.sr = sampleRate;
      this.counting = totalMs == null;      // dry run: only measure duration
      this.t = 0;                            // elapsed time in ms (exact)
      this.n = 0;                            // samples written
      this.phase = 0;
      this.marks = [];                       // { t, row } — when each image row starts
      if (!this.counting) this.buf = new Float32Array(Math.ceil(totalMs * sampleRate / 1000) + 2);
    }
    tone(freq, ms) {
      this.t += ms;
      if (this.counting) return;
      const end = Math.min(Math.round(this.t * this.sr / 1000), this.buf.length);
      const dphi = 2 * Math.PI * freq / this.sr;
      const buf = this.buf;
      let n = this.n, p = this.phase;
      while (n < end) { buf[n++] = Math.sin(p); p += dphi; }
      this.n = n;
      this.phase = p % (2 * Math.PI);
    }
    silence(ms) {
      this.t += ms;
      if (this.counting) return;
      this.n = Math.min(Math.round(this.t * this.sr / 1000), this.buf.length); // buffer is zero-filled
    }
    mark(row) { this.marks.push({ t: this.t, row }); }
  }

  /* Calibration preamble (as sent by MMSSTV) + VIS header. */
  function header(w, vis, preamble) {
    if (preamble) {
      for (const f of [1900, 1500, 1900, 1500, 2300, 1500, 2300, 1500]) w.tone(f, 100);
    }
    w.tone(1900, 300); w.tone(SYNC, 10); w.tone(1900, 300);
    w.tone(SYNC, 30);                                  // start bit
    let parity = 0;
    for (let i = 0; i < 7; i++) {                      // 7 data bits, LSB first
      const bit = (vis >> i) & 1;
      parity ^= bit;
      w.tone(bit ? 1100 : 1300, 30);
    }
    w.tone(parity ? 1100 : 1300, 30);                  // even parity
    w.tone(SYNC, 30);                                  // stop bit
  }

  /* Planes: R,G,B and BT.601 Y / Cb (B-Y) / Cr (R-Y), each 0..255. */
  function planes(rgba, width, height) {
    const n = width * height;
    const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
    const Y = new Float32Array(n), U = new Float32Array(n), V = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      R[i] = r; G[i] = g; B[i] = b;
      Y[i] = 16 + (65.738 * r + 129.057 * g + 25.064 * b) / 256;
      U[i] = 128 + (-37.945 * r - 74.494 * g + 112.439 * b) / 256;
      V[i] = 128 + (112.439 * r - 94.154 * g - 18.285 * b) / 256;
    }
    return { R, G, B, Y, U, V };
  }

  function scan(w, plane, width, row, ms) {
    const px = ms / width, o = row * width;
    for (let x = 0; x < width; x++) w.tone(level(plane[o + x]), px);
  }

  // Chroma averaged over two rows (row and row+1, clamped).
  function scanAvg(w, plane, width, height, row, ms) {
    const px = ms / width, a = row * width, b = Math.min(row + 1, height - 1) * width;
    for (let x = 0; x < width; x++) w.tone(level((plane[a + x] + plane[b + x]) / 2), px);
  }

  const BODY = {
    martin(w, m, P) {
      for (let y = 0; y < m.height; y++) {
        w.mark(y);
        w.tone(SYNC, 4.862); w.tone(BLACK, 0.572);
        scan(w, P.G, m.width, y, m.scan); w.tone(BLACK, 0.572);
        scan(w, P.B, m.width, y, m.scan); w.tone(BLACK, 0.572);
        scan(w, P.R, m.width, y, m.scan); w.tone(BLACK, 0.572);
      }
    },
    scottie(w, m, P) {
      w.tone(SYNC, 9);                                 // one-time starting sync
      for (let y = 0; y < m.height; y++) {
        w.mark(y);
        w.tone(BLACK, 1.5); scan(w, P.G, m.width, y, m.scan);
        w.tone(BLACK, 1.5); scan(w, P.B, m.width, y, m.scan);
        w.tone(SYNC, 9);    w.tone(BLACK, 1.5);
        scan(w, P.R, m.width, y, m.scan);
      }
    },
    robot36(w, m, P) {
      for (let y = 0; y < m.height; y++) {
        w.mark(y);
        w.tone(SYNC, 9); w.tone(BLACK, 3);
        scan(w, P.Y, m.width, y, 88);
        const even = y % 2 === 0;
        const pair = even ? y : y - 1;                 // chroma shared by line pair
        w.tone(even ? BLACK : WHITE, 4.5);             // separator says which chroma
        w.tone(1900, 1.5);
        scanAvg(w, even ? P.V : P.U, m.width, m.height, pair, 44);
      }
    },
    robot72(w, m, P) {
      for (let y = 0; y < m.height; y++) {
        w.mark(y);
        w.tone(SYNC, 9); w.tone(BLACK, 3);
        scan(w, P.Y, m.width, y, 138);
        w.tone(BLACK, 4.5); w.tone(1900, 1.5);
        scan(w, P.V, m.width, y, 69);
        w.tone(WHITE, 4.5); w.tone(1900, 1.5);
        scan(w, P.U, m.width, y, 69);
      }
    },
    pd(w, m, P) {
      for (let y = 0; y < m.height; y += 2) {
        w.mark(y);
        w.tone(SYNC, 20); w.tone(BLACK, 2.08);
        scan(w, P.Y, m.width, y, m.scan);
        scanAvg(w, P.V, m.width, m.height, y, m.scan);
        scanAvg(w, P.U, m.width, m.height, y, m.scan);
        w.mark(y + 1);
        scan(w, P.Y, m.width, Math.min(y + 1, m.height - 1), m.scan);
      }
    },
  };

  function run(w, mode, P, opts) {
    header(w, mode.vis, opts.preamble !== false);
    w.mark(-1);                                        // image data begins
    BODY[mode.family](w, mode, P);
    w.mark(mode.height);                               // image data ends
    if (opts.tail !== false) w.silence(300);
  }

  /**
   * encode(modeId, rgba, { sampleRate, preamble }) -> { samples, sampleRate, durationMs, marks }
   * rgba must be mode.width x mode.height RGBA (e.g. ImageData.data).
   */
  function encode(modeId, rgba, opts = {}) {
    const mode = MODES[modeId];
    if (!mode) throw new Error('Unknown SSTV mode: ' + modeId);
    if (rgba.length < mode.width * mode.height * 4) throw new Error('Image must be ' + mode.width + 'x' + mode.height);
    const sampleRate = opts.sampleRate || 48000;
    const P = planes(rgba, mode.width, mode.height);

    const dry = new ToneWriter(sampleRate, null);
    run(dry, mode, P, opts);
    const w = new ToneWriter(sampleRate, dry.t);
    run(w, mode, P, opts);
    const samples = w.buf.subarray(0, w.n);
    return { samples, sampleRate, durationMs: w.t, marks: w.marks, mode };
  }

  /* Rough duration without encoding (for the UI). */
  function durationMs(modeId, opts = {}) {
    const m = MODES[modeId];
    const w = new ToneWriter(48000, null);
    const blank = new Uint8ClampedArray(m.width * m.height * 4);
    run(w, m, planes(blank, m.width, m.height), opts);
    return w.t;
  }

  /* 16-bit mono PCM WAV. */
  function toWav(samples, sampleRate, gain = 0.8) {
    const n = samples.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0, o = 44; i < n; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, samples[i] * gain));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  const SSTV = { MODES, encode, durationMs, toWav };
  if (typeof module !== 'undefined' && module.exports) module.exports = SSTV;
  else root.SSTV = SSTV;
})(typeof self !== 'undefined' ? self : this);
