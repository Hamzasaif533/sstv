(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);

  const preview = $('#preview'), pctx = preview.getContext('2d', { willReadFrequently: true });
  const veil = $('#veil'), vctx = veil.getContext('2d');
  const wfall = Waterfall($('#waterfall'), $('#ticks'));
  const stage = $('#stage');

  const state = {
    mode: 'robot36',
    source: null,            // HTMLImageElement / canvas, or null for the test pattern
    fit: 'cover',
    text: '',
    textColor: '#ffffff',
    textPos: 'top',
  };

  /* ---------- image preview ---------- */

  function fmt(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function drawTestPattern(c, w, h) {
    const bars = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff', '#000000'];
    const bh = Math.round(h * 0.62);
    bars.forEach((col, i) => { c.fillStyle = col; c.fillRect(Math.floor(i * w / 8), 0, Math.ceil(w / 8), bh); });
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#000'); g.addColorStop(1, '#fff');
    c.fillStyle = g; c.fillRect(0, bh, w, Math.round(h * 0.14));
    const y2 = bh + Math.round(h * 0.14);
    const hue = c.createLinearGradient(0, 0, w, 0);
    ['#f00', '#ff0', '#0f0', '#0ff', '#00f', '#f0f', '#f00'].forEach((col, i, a) => hue.addColorStop(i / (a.length - 1), col));
    c.fillStyle = hue; c.fillRect(0, y2, w, h - y2);
    // centre badge
    const r = Math.round(h * 0.17);
    c.fillStyle = 'rgba(0,0,0,.75)';
    c.beginPath(); c.arc(w / 2, bh / 2, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = Math.max(2, h / 120); c.stroke();
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `700 ${Math.round(r * 0.62)}px system-ui, sans-serif`;
    c.fillText('SSTV', w / 2, bh / 2);
  }

  function drawImageFit(c, img, w, h, fit) {
    const iw = img.naturalWidth || img.videoWidth || img.width;
    const ih = img.naturalHeight || img.videoHeight || img.height;
    if (fit === 'stretch') { c.drawImage(img, 0, 0, w, h); return; }
    const s = fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    const dw = iw * s, dh = ih * s;
    c.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  function drawText(c, w, h) {
    const t = state.text.trim();
    if (!t) return;
    let size = Math.round(h * 0.12);
    c.font = `800 ${size}px system-ui, sans-serif`;
    while (c.measureText(t).width > w * 0.92 && size > 8) { size--; c.font = `800 ${size}px system-ui, sans-serif`; }
    c.textAlign = 'center';
    c.textBaseline = state.textPos === 'top' ? 'top' : 'bottom';
    const y = state.textPos === 'top' ? Math.round(h * 0.04) : h - Math.round(h * 0.04);
    c.lineJoin = 'round';
    c.lineWidth = Math.max(2, size / 7);
    c.strokeStyle = 'rgba(0,0,0,.85)';
    c.strokeText(t, w / 2, y);
    c.fillStyle = state.textColor;
    c.fillText(t, w / 2, y);
  }

  function render() {
    const m = SSTV.MODES[state.mode];
    if (preview.width !== m.width || preview.height !== m.height) {
      preview.width = veil.width = m.width;
      preview.height = veil.height = m.height;
    }
    stage.style.aspectRatio = m.width + ' / ' + m.height;
    pctx.save();
    pctx.fillStyle = '#000';
    pctx.fillRect(0, 0, m.width, m.height);
    pctx.imageSmoothingQuality = 'high';
    if (state.source) drawImageFit(pctx, state.source, m.width, m.height, state.fit);
    else drawTestPattern(pctx, m.width, m.height);
    drawText(pctx, m.width, m.height);
    pctx.restore();
    if (!tx) vctx.clearRect(0, 0, veil.width, veil.height);
  }

  function updateInfo() {
    const m = SSTV.MODES[state.mode];
    const len = SSTV.durationMs(state.mode, { preamble: $('#preamble').checked });
    $('#dims').textContent = $('#infoRes').textContent = `${m.width} × ${m.height}`;
    $('#infoLen').textContent = fmt(len);
    $('#infoVis').textContent = m.vis;
    if (!tx) $('#clock').textContent = `0:00 / ${fmt(len)}`;
  }

  /* ---------- loading images ---------- */

  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { state.source = img; render(); };
    img.onerror = () => { setStatus('Could not read that image'); URL.revokeObjectURL(url); };
    img.src = url;
  }

  $('#file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
  $('#pattern').addEventListener('click', () => { state.source = null; render(); });

  ['dragenter', 'dragover'].forEach((ev) => stage.addEventListener(ev, (e) => { e.preventDefault(); stage.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => stage.addEventListener(ev, (e) => { e.preventDefault(); stage.classList.remove('drag'); }));
  stage.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
  // Allow dropping anywhere on the page too.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); if (e.target !== stage && !stage.contains(e.target)) loadFile(e.dataTransfer.files[0]); });
  window.addEventListener('paste', (e) => {
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith('image/')) { loadFile(item.getAsFile()); break; }
    }
  });

  /* ---------- controls ---------- */

  function segmented(el, key) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      state[key] = b.dataset.v;
      render();
    });
  }
  segmented($('#fit'), 'fit');
  segmented($('#textPos'), 'textPos');

  $('#text').addEventListener('input', (e) => { state.text = e.target.value; render(); });
  $('#textColor').addEventListener('input', (e) => { state.textColor = e.target.value; render(); });
  $('#mode').addEventListener('change', (e) => { state.mode = e.target.value; render(); updateInfo(); });
  $('#preamble').addEventListener('change', updateInfo);

  const volume = $('#volume');
  const volGain = () => Math.pow(volume.value / 100, 2);   // perceptual-ish curve
  volume.addEventListener('input', () => {
    $('#volVal').textContent = volume.value + '%';
    if (gainNode) gainNode.gain.setTargetAtTime(volGain(), audio.currentTime, 0.02);
  });

  /* ---------- transmit ---------- */

  let audio = null, gainNode = null, analyser = null, tx = null;

  function setStatus(s) { $('#status').textContent = s; }

  function setLive(on) {
    const btn = $('#play');
    btn.classList.toggle('live', on);
    btn.querySelector('span').textContent = on ? 'Stop' : 'Transmit';
    btn.querySelector('svg').innerHTML = on ? '<path d="M6 6h12v12H6z"/>' : '<path d="M8 5v14l11-7z"/>';
    $('#onAir').classList.toggle('live', on);
    $('#mode').disabled = on;
  }

  function ensureAudio() {
    if (audio) return;
    audio = new (window.AudioContext || window.webkitAudioContext)();
    gainNode = audio.createGain();
    gainNode.gain.value = volGain();
    gainNode.connect(audio.destination);
    analyser = wfall.analyserFor(audio);
  }

  async function start() {
    ensureAudio();
    await audio.resume();
    const m = SSTV.MODES[state.mode];
    render();
    const data = pctx.getImageData(0, 0, m.width, m.height).data;
    const res = SSTV.encode(state.mode, data, { sampleRate: audio.sampleRate, preamble: $('#preamble').checked });

    const buf = audio.createBuffer(1, res.samples.length, audio.sampleRate);
    buf.copyToChannel(res.samples, 0);
    const src = audio.createBufferSource();
    src.buffer = buf;
    src.connect(gainNode);
    src.connect(analyser);                    // waterfall ignores the volume slider
    const t0 = audio.currentTime + 0.05;
    src.start(t0);
    tx = { src, t0, res, m };
    src.onended = () => { if (tx && tx.src === src) finish(true); };
    setLive(true);
    loop();
  }

  function finish(completed) {
    if (!tx) return;
    try { tx.src.onended = null; tx.src.stop(); } catch (_) { /* already stopped */ }
    const total = tx.res.durationMs;
    tx = null;
    setLive(false);
    vctx.clearRect(0, 0, veil.width, veil.height);
    $('#bar').style.width = completed ? '100%' : '0%';
    $('#clock').textContent = `${completed ? fmt(total) : '0:00'} / ${fmt(total)}`;
    setStatus(completed ? 'Sent ✓' : 'Stopped');
  }

  // Which image row (fractional) is being sent at time `ms`.
  function rowAt(marks, ms) {
    let lo = 0, hi = marks.length - 1;
    if (ms < marks[0].t) return -1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (marks[mid].t <= ms) lo = mid; else hi = mid - 1; }
    const a = marks[lo], b = marks[lo + 1];
    if (a.row < 0) return 0;               // image data started, first row not yet
    if (!b) return a.row;
    return a.row + (b.row - a.row) * (ms - a.t) / (b.t - a.t);
  }

  function loop() {
    if (!tx) return;
    const { t0, res, m } = tx;
    const ms = (audio.currentTime - t0) * 1000;
    const imageStart = res.marks[0].t;
    const row = ms < imageStart ? -1 : rowAt(res.marks, ms);

    $('#bar').style.width = Math.min(100, Math.max(0, ms / res.durationMs * 100)) + '%';
    $('#clock').textContent = `${fmt(ms)} / ${fmt(res.durationMs)}`;
    if (row < 0) setStatus(ms < imageStart - 910 ? 'Calibration tones…' : 'Sending mode header…');
    else if (row < m.height) setStatus(`${m.name} · line ${Math.floor(row) + 1} of ${m.height}`);
    else setStatus('Finishing…');

    // Veil over the rows not sent yet + a bright scan line.
    vctx.clearRect(0, 0, veil.width, veil.height);
    const y = Math.max(0, Math.min(m.height, row < 0 ? 0 : row));
    vctx.fillStyle = 'rgba(8,10,14,.78)';
    vctx.fillRect(0, Math.floor(y), veil.width, veil.height - Math.floor(y));
    if (row >= 0 && row < m.height) {
      vctx.fillStyle = '#ff470a';
      vctx.fillRect(0, Math.floor(y), veil.width, Math.max(1, Math.round(m.height / 160)));
    }

    wfall.draw(analyser, audio.sampleRate);
    requestAnimationFrame(loop);
  }

  $('#play').addEventListener('click', () => {
    if (tx) finish(false);
    else start().catch((err) => { console.error(err); setStatus('Audio error: ' + err.message); setLive(false); });
  });

  /* ---------- download ---------- */

  $('#download').addEventListener('click', () => {
    const btn = $('#download');
    btn.disabled = true; btn.textContent = 'Encoding…';
    setTimeout(() => {   // let the button repaint before the heavy work
      try {
        const m = SSTV.MODES[state.mode];
        render();
        const data = pctx.getImageData(0, 0, m.width, m.height).data;
        const rate = +$('#rate').value;
        const res = SSTV.encode(state.mode, data, { sampleRate: rate, preamble: $('#preamble').checked });
        const blob = new Blob([SSTV.toWav(res.samples, rate)], { type: 'audio/wav' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `sstv-${state.mode}.wav`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      } catch (err) {
        console.error(err); setStatus('Could not make WAV: ' + err.message);
      } finally {
        btn.disabled = false; btn.textContent = 'Download WAV';
      }
    }, 30);
  });

  /* ---------- init ---------- */
  render();
  updateInfo();
})();
