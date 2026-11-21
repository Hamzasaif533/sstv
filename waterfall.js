/* Scrolling spectrum (waterfall) shared by the Transmit and Receive pages. */
(function (root) {
  'use strict';

  const LUT = (() => {
    const stops = [[0, [6, 6, 6]], [0.4, [38, 38, 38]], [0.66, [255, 71, 10]], [0.86, [255, 176, 130]], [1, [255, 255, 255]]];
    const out = new Array(256);
    for (let i = 0; i < 256; i++) {
      const v = i / 255;
      let k = 0; while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
      const [a, ca] = stops[k], [b, cb] = stops[k + 1];
      const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
      out[i] = ca.map((c, j) => Math.round(c + (cb[j] - c) * t));
    }
    return out;
  })();

  function Waterfall(canvas, ticksEl, lo = 1000, hi = 2500) {
    const ctx = canvas.getContext('2d');
    let row = null, bins = null;

    function clear() { ctx.fillStyle = '#060606'; ctx.fillRect(0, 0, canvas.width, canvas.height); }

    function ticks() {
      ticksEl.innerHTML = '';
      [[1200, 'sync 1200'], [1500, 'black 1500'], [1900, '1900'], [2300, 'white 2300']].forEach(([f, label]) => {
        const s = document.createElement('span');
        s.style.left = ((f - lo) / (hi - lo) * 100) + '%';
        s.innerHTML = `<b>${label}</b>`;
        ticksEl.appendChild(s);
      });
    }

    function draw(analyser, sampleRate) {
      const W = canvas.width, H = canvas.height;
      if (!bins || bins.length !== analyser.frequencyBinCount) {
        bins = new Uint8Array(analyser.frequencyBinCount);
        row = ctx.createImageData(W, 1);
      }
      analyser.getByteFrequencyData(bins);
      ctx.drawImage(canvas, 0, 0, W, H - 1, 0, 1, W, H - 1);   // scroll down 1px
      const binHz = sampleRate / analyser.fftSize, d = row.data;
      for (let x = 0; x < W; x++) {
        const f = lo + (hi - lo) * x / (W - 1);
        const c = LUT[bins[Math.min(bins.length - 1, Math.round(f / binHz))]];
        d[x * 4] = c[0]; d[x * 4 + 1] = c[1]; d[x * 4 + 2] = c[2]; d[x * 4 + 3] = 255;
      }
      ctx.putImageData(row, 0, 0);
    }

    /* Analyser settings that suit SSTV audio. */
    function analyserFor(audioCtx) {
      const a = audioCtx.createAnalyser();
      a.fftSize = 2048;
      a.smoothingTimeConstant = 0;
      a.minDecibels = -70;
      a.maxDecibels = -12;
      return a;
    }

    clear();
    ticks();
    return { draw, clear, analyserFor };
  }

  root.Waterfall = Waterfall;
})(self);
