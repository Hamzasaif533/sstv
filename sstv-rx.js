/*
 * SSTV decoder — turns slow-scan TV audio back into an image.
 * Works in the browser (window.SSTVDecoder, needs sstv.js loaded first) and in Node.
 *
 * Pipeline: mix to complex baseband around 1700 Hz -> low-pass FIR -> FM discriminator
 * gives an instantaneous-frequency stream. A 1 ms averaged copy of that stream is scanned
 * for the VIS header (which also names the mode). Each image line is then located by
 * searching for its 1200 Hz sync pulse; a least-squares fit of the sync positions corrects
 * slant caused by sender/receiver clock differences.
 */
(function (root) {
  'use strict';
  const SSTV = root.SSTV || (typeof require !== 'undefined' ? require('./sstv.js') : null);
  const { MODES } = SSTV;

  const CENTER = 1700;            // mixing frequency (middle of 1100..2300 Hz)
  const TWO_PI = 2 * Math.PI;

  /* Where everything sits within one line, in ms relative to the start of its sync pulse. */
  function layout(m) {
    const s = m.scan;
    switch (m.family) {
      case 'martin': {
        const p = 0.572, a = 4.862 + p;
        return { line: 4.862 + 4 * p + 3 * s, sync: 4.862, first: 0,
          G: [a, s], B: [a + s + p, s], R: [a + 2 * (s + p), s] };
      }
      case 'scottie':                      // sync sits mid-line, between blue and red
        return { line: 13.5 + 3 * s, sync: 9, first: 12 + 2 * s,
          G: [-1.5 - 2 * s, s], B: [-s, s], R: [10.5, s] };
      case 'robot36':
        return { line: 150, sync: 9, first: 0, Y: [12, 88], sep: [100, 4.5], C: [106, 44] };
      case 'robot72':
        return { line: 300, sync: 9, first: 0, Y: [12, 138], V: [156, 69], U: [231, 69] };
      case 'pd': {
        const o = 22.08;
        return { line: o + 4 * s, sync: 20, first: 0,
          Y0: [o, s], V: [o + s, s], U: [o + 2 * s, s], Y1: [o + 3 * s, s] };
      }
    }
    throw new Error('unknown family ' + m.family);
  }

  const toLevel = (f) => (f - 1500) * (255 / 800);
  const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const syncness = (f) => { const d = Math.abs(f - 1200); return d >= 200 ? 0 : 1 - d / 200; };

  class SSTVDecoder {
    /**
     * handlers: onStart({ id, mode, image }), onLine(y0, y1), onEnd({ id, mode, image, completed, rows })
     * image is a Uint8ClampedArray RGBA buffer (mode.width x mode.height) filled in as lines arrive.
     */
    constructor(sampleRate, handlers = {}) {
      this.sr = sampleRate;
      this.spm = sampleRate / 1000;      // samples per ms
      this.h = handlers;

      // Low-pass FIR (Hamming windowed sinc), ~2.5 ms long, 1500 Hz cutoff.
      const N = Math.round(sampleRate * 0.0025) | 1, fc = 1500 / sampleRate, M = (N - 1) / 2;
      const taps = new Float32Array(N);
      let sum = 0;
      for (let i = 0; i < N; i++) {
        const k = i - M;
        const sinc = k === 0 ? 2 * fc : Math.sin(TWO_PI * fc * k) / (Math.PI * k);
        taps[i] = sinc * (0.54 - 0.46 * Math.cos(TWO_PI * i / (N - 1)));
        sum += taps[i];
      }
      for (let i = 0; i < N; i++) taps[i] /= sum;
      this.N = N; this.taps = taps;
      this.bi = new Float32Array(2 * N); this.bq = new Float32Array(2 * N); this.bpos = 0;
      this.phase = 0; this.dphi = TWO_PI * CENTER / sampleRate;
      this.pI = 0; this.pQ = 0;

      // Ring buffer of instantaneous frequency (several seconds).
      let R = 1; while (R < sampleRate * 6) R <<= 1;
      this.freq = new Float32Array(R).fill(CENTER); this.mask = R - 1;
      this.n = 0;                         // frequency samples produced so far

      // 1 ms averages for VIS detection.
      this.ms = new Float32Array(1024); this.msK = 0; this.msSum = 0; this.msCnt = 0;
      this.msNext = Math.round(this.spm);
      this.run = null;

      this.modeByVis = {};
      for (const [id, m] of Object.entries(MODES)) this.modeByVis[m.vis] = id;
      this.img = null;
      this.level = 0;                     // RMS of the last chunk (for meters)
    }

    get busy() { return !!this.img; }
    get progress() { return this.img ? this.img.k / this.img.lines : 0; }

    /** Feed mono samples (Float32Array, -1..1). */
    process(input) {
      const N = this.N, taps = this.taps, bi = this.bi, bq = this.bq, freq = this.freq, mask = this.mask;
      const dphi = this.dphi, k2 = this.sr / TWO_PI;
      let pos = this.bpos, ph = this.phase, pI = this.pI, pQ = this.pQ, n = this.n, energy = 0;

      for (let j = 0; j < input.length; j++) {
        const x = input[j];
        energy += x * x;
        bi[pos] = bi[pos + N] = x * Math.cos(ph);
        bq[pos] = bq[pos + N] = -x * Math.sin(ph);
        ph += dphi; if (ph > TWO_PI) ph -= TWO_PI;
        if (++pos === N) pos = 0;
        let I = 0, Q = 0;
        for (let t = 0, o = pos; t < N; t++, o++) { I += taps[t] * bi[o]; Q += taps[t] * bq[o]; }

        let f = CENTER + Math.atan2(Q * pI - I * pQ, I * pI + Q * pQ) * k2;
        if (f < 1000) f = 1000; else if (f > 2500) f = 2500;
        pI = I; pQ = Q;
        freq[n & mask] = f;
        n++;

        this.msSum += f; this.msCnt++;
        if (n >= this.msNext) {
          this.ms[this.msK & 1023] = this.msSum / this.msCnt;
          this.msK++; this.msSum = 0; this.msCnt = 0;
          this.msNext = Math.round((this.msK + 1) * this.spm);
          this.n = n;
          this.checkVis();
        }
      }
      this.bpos = pos; this.phase = ph; this.pI = pI; this.pQ = pQ; this.n = n;
      this.level = input.length ? Math.sqrt(energy / input.length) : 0;
      this.pump();
    }

    /** Stop decoding the current image (keeps what was received). */
    flush() { if (this.img) this.finish(false); }

    /* ---------- VIS header ---------- */

    msMean(a, b) {
      let s = 0;
      for (let i = a; i < b; i++) s += this.ms[i & 1023];
      return s / (b - a);
    }

    checkVis() {
      const end = this.msK;               // blocks [0, end) exist; end = candidate end of stop bit
      if (end < 620) return;
      const near = (v, t) => Math.abs(v - t) < 80;
      let id = null;
      if (near(this.msMean(end - 25, end - 5), 1200) &&       // stop bit
          near(this.msMean(end - 295, end - 275), 1200) &&    // start bit
          near(this.msMean(end - 560, end - 340), 1900)) {    // second leader tone
        let code = 0, ones = 0, ok = true;
        for (let i = 0; i < 8 && ok; i++) {
          const ws = end - 270 + i * 30, v = this.msMean(ws + 5, ws + 25);
          let bit;
          if (near(v, 1100)) bit = 1; else if (near(v, 1300)) bit = 0; else ok = false;
          if (ok) { if (i < 7) code |= bit << i; ones += bit; }
        }
        if (ok && ones % 2 === 0) id = this.modeByVis[code] || null;
      }
      // The pattern matches over a few ms of alignment; take the middle of that run.
      if (id && (!this.run || this.run.id === id)) {
        if (!this.run) this.run = { id, first: end };
        this.run.last = end;
      } else if (this.run) {
        const r = this.run;
        this.run = null;
        this.startImage(r.id, (r.first + r.last) / 2);
      }
    }

    /* ---------- image lines ---------- */

    startImage(id, endMs) {
      if (this.img) this.finish(false);
      const m = MODES[id], L = layout(m);
      const rgba = new Uint8ClampedArray(m.width * m.height * 4);
      for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
      this.img = {
        id, m, L, rgba,
        start: endMs * this.spm,
        period: L.line * this.spm,
        lines: m.family === 'pd' ? m.height / 2 : m.height,
        k: 0, misses: 0, last: null,
        fit: { n: 0, sk: 0, sp: 0, skk: 0, skp: 0 },
        U: new Float32Array(m.width).fill(128), V: new Float32Array(m.width).fill(128),
        Yprev: new Float32Array(m.width),
      };
      if (this.h.onStart) this.h.onStart({ id, mode: m, image: rgba });
    }

    predict(g, k) {
      const f = g.fit;
      if (f.n >= 8) {
        let b = (f.n * f.skp - f.sk * f.sp) / (f.n * f.skk - f.sk * f.sk);
        b = Math.min(g.period * 1.01, Math.max(g.period * 0.99, b));
        const a = (f.sp - b * f.sk) / f.n;
        return { pos: g.start + a + b * k, per: b, w: 3 * this.spm };
      }
      if (g.last) return { pos: g.last.pos + (k - g.last.k) * g.period, per: g.period, w: 5 * this.spm };
      return { pos: g.start + g.L.first * this.spm + k * g.period, per: g.period, w: 9 * this.spm };
    }

    pump() {
      while (this.img) {
        const g = this.img;
        const p = this.predict(g, g.k);
        if (this.n < p.pos + p.w + p.per + 4 * this.spm) break;   // line not fully received yet
        this.decodeLine(g, p);
      }
    }

    findSync(g, p) {
      const freq = this.freq, mask = this.mask;
      const len = Math.max(1, Math.round(g.L.sync * this.spm));
      const a0 = Math.floor(p.pos - p.w), a1 = Math.ceil(p.pos + p.w);
      let sum = 0;
      for (let i = a0; i < a0 + len; i++) sum += syncness(freq[i & mask]);
      const scores = new Float32Array(a1 - a0 + 1);
      let best = -1;
      for (let i = a0; i <= a1; i++) {
        scores[i - a0] = sum;
        if (sum > best) best = sum;
        sum += syncness(freq[(i + len) & mask]) - syncness(freq[i & mask]);
      }
      // Centre of the plateau near the maximum.
      let first = -1, last = -1;
      for (let i = 0; i < scores.length; i++) if (scores[i] >= best * 0.97) { if (first < 0) first = i; last = i; }
      return { pos: a0 + (first + last) / 2, score: best / len };
    }

    decodeLine(g, p) {
      const { m, L } = g, W = m.width, spm = this.spm;
      const s = this.findSync(g, p);
      let sync = p.pos;
      if (s.score > 0.5) {
        sync = s.pos;
        const rel = sync - g.start, f = g.fit;
        f.n++; f.sk += g.k; f.sp += rel; f.skk += g.k * g.k; f.skp += g.k * rel;
        g.last = { k: g.k, pos: sync };
        g.misses = 0;
      } else {
        g.misses++;
      }

      const scale = spm * (p.per / g.period);   // stretch for clock mismatch
      const freq = this.freq, mask = this.mask;
      const read = ([o, len]) => {
        const out = new Float32Array(W);
        for (let x = 0; x < W; x++) {
          const ia = Math.round(sync + (o + x * len / W) * scale);
          const ib = Math.max(ia + 1, Math.round(sync + (o + (x + 1) * len / W) * scale));
          let acc = 0;
          for (let i = ia; i < ib; i++) acc += freq[i & mask];
          out[x] = toLevel(acc / (ib - ia));
        }
        return out;
      };
      const meanF = ([o, len]) => {
        const ia = Math.round(sync + (o + len * 0.2) * scale), ib = Math.round(sync + (o + len * 0.8) * scale);
        let acc = 0;
        for (let i = ia; i < ib; i++) acc += freq[i & mask];
        return acc / Math.max(1, ib - ia);
      };

      let y0 = g.k, y1 = g.k + 1;
      switch (m.family) {
        case 'martin': case 'scottie':
          this.putRGB(g, g.k, read(L.R), read(L.G), read(L.B));
          break;
        case 'robot36': {
          const Y = read(L.Y), C = read(L.C);
          const isV = meanF(L.sep) < 1900;     // 1500 Hz separator = R-Y line, 2300 Hz = B-Y line
          if (isV) g.V = C; else g.U = C;
          this.putYUV(g, g.k, Y, g.U, g.V);
          if (!isV && g.k > 0) { this.putYUV(g, g.k - 1, g.Yprev, g.U, g.V); y0 = g.k - 1; }
          g.Yprev = Y;
          break;
        }
        case 'robot72':
          this.putYUV(g, g.k, read(L.Y), read(L.U), read(L.V));
          break;
        case 'pd': {
          const U = read(L.U), V = read(L.V);
          this.putYUV(g, 2 * g.k, read(L.Y0), U, V);
          this.putYUV(g, 2 * g.k + 1, read(L.Y1), U, V);
          y0 = 2 * g.k; y1 = Math.min(m.height, 2 * g.k + 2);
          break;
        }
      }
      if (this.h.onLine) this.h.onLine(y0, y1);
      g.k++;
      if (g.k >= g.lines) this.finish(true);
      else if (g.misses > 30) this.finish(false);         // signal lost
    }

    putRGB(g, y, R, G, B) {
      const W = g.m.width, d = g.rgba;
      for (let x = 0, o = y * W * 4; x < W; x++, o += 4) {
        d[o] = clamp8(R[x]); d[o + 1] = clamp8(G[x]); d[o + 2] = clamp8(B[x]);
      }
    }

    putYUV(g, y, Y, U, V) {
      if (y < 0 || y >= g.m.height) return;
      const W = g.m.width, d = g.rgba;
      for (let x = 0, o = y * W * 4; x < W; x++, o += 4) {
        const yy = 1.164 * (Y[x] - 16), u = U[x] - 128, v = V[x] - 128;
        d[o] = clamp8(yy + 1.596 * v);
        d[o + 1] = clamp8(yy - 0.392 * u - 0.813 * v);
        d[o + 2] = clamp8(yy + 2.017 * u);
      }
    }

    finish(completed) {
      const g = this.img;
      if (!g) return;
      this.img = null;
      const rows = Math.min(g.m.height, g.m.family === 'pd' ? g.k * 2 : g.k);
      if (this.h.onEnd) this.h.onEnd({ id: g.id, mode: g.m, image: g.rgba, completed, rows });
    }
  }

  SSTVDecoder.layout = layout;
  if (typeof module !== 'undefined' && module.exports) module.exports = SSTVDecoder;
  else root.SSTVDecoder = SSTVDecoder;
})(typeof self !== 'undefined' ? self : this);
