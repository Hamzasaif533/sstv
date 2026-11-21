(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);

  const canvas = $('#rx'), ctx = canvas.getContext('2d');
  const stage = $('#stage');
  const wfall = Waterfall($('#waterfall'), $('#ticks'));

  // Microphone capture: an AudioWorklet that hands us 2048-sample chunks.
  const WORKLET = `
    class Tap extends AudioWorkletProcessor {
      constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch) for (let i = 0; i < ch.length; i++) {
          this.buf[this.n++] = ch[i];
          if (this.n === this.buf.length) {
            this.port.postMessage(this.buf, [this.buf.buffer]);
            this.buf = new Float32Array(2048); this.n = 0;
          }
        }
        return true;
      }
    }
    registerProcessor('sstv-tap', Tap);`;

  let audio = null, workletReady = false;
  let mic = null;          // { stream, src, node, sink, analyser, dec }
  let fileJob = null;      // { cancel }
  let current = null;      // image being received: { mode, imageData }
  let dirty = null;        // [y0, y1) rows waiting to be painted
  let count = 0;

  /* ---------- UI helpers ---------- */

  const setStatus = (s) => { $('#status').textContent = s; };

  function showEmpty(text) {
    $('#empty').hidden = !text;
    if (text) $('#emptyText').textContent = text;
  }

  function paint() {
    if (dirty && current) {
      ctx.putImageData(current.imageData, 0, 0, 0, dirty[0], current.imageData.width, dirty[1] - dirty[0]);
      dirty = null;
    }
  }

  function setProgress(dec) {
    if (dec && dec.busy && current) {
      const p = dec.progress, H = current.mode.height;
      $('#bar').style.width = (p * 100).toFixed(1) + '%';
      $('#lines').textContent = `line ${Math.min(H, Math.round(p * H))} / ${H}`;
    }
  }

  /* ---------- decoder wiring ---------- */

  function makeDecoder(sampleRate) {
    return new SSTVDecoder(sampleRate, {
      onStart(e) {
        const m = e.mode;
        canvas.width = m.width; canvas.height = m.height;
        stage.style.aspectRatio = `${m.width} / ${m.height}`;
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, m.width, m.height);
        current = { mode: m, id: e.id, imageData: new ImageData(e.image, m.width, m.height) };
        showEmpty(null);
        $('#dims').textContent = $('#infoRes').textContent = `${m.width} × ${m.height}`;
        $('#infoMode').textContent = m.name;
        $('#save').disabled = false;
        $('#onAir').classList.add('live');
        setStatus(`Receiving ${m.name}…`);
      },
      onLine(y0, y1) {
        dirty = dirty ? [Math.min(dirty[0], y0), Math.max(dirty[1], y1)] : [y0, y1];
      },
      onEnd(e) {
        dirty = [0, e.mode.height];
        paint();
        $('#onAir').classList.remove('live');
        $('#bar').style.width = e.completed ? '100%' : $('#bar').style.width;
        $('#lines').textContent = `${e.rows} / ${e.mode.height} lines`;
        if (e.rows >= 16) addToGallery(e);
        setStatus(e.completed ? `Received ${e.mode.name} ✓` : `${e.mode.name} ended early (${e.rows} lines)`);
      },
    });
  }

  /* ---------- gallery ---------- */

  function addToGallery(e) {
    const m = e.mode;
    const c = document.createElement('canvas');
    c.width = m.width; c.height = m.height;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(e.image), m.width, m.height), 0, 0);
    const now = new Date();
    const stamp = now.toTimeString().slice(0, 8);
    const name = `sstv-${e.id}-${stamp.replace(/:/g, '')}.png`;
    c.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.className = 'shot'; a.href = url; a.download = name; a.title = 'Download ' + name;
      a.innerHTML = `<img alt="" src="${url}"><span><b>${m.name}</b> · ${stamp}${e.completed ? '' : ' · partial'}</span>`;
      $('#galleryEmpty').hidden = true;
      $('#gallery').prepend(a);
    }, 'image/png');
    $('#infoCount').textContent = ++count;
  }

  $('#save').addEventListener('click', () => {
    if (!current) return;
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `sstv-${current.id}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }, 'image/png');
  });

  $('#clear').addEventListener('click', () => {
    if ((mic && mic.dec.busy) || fileJob) return;
    current = null;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    $('#bar').style.width = '0%'; $('#lines').textContent = '';
    $('#save').disabled = true;
    $('#dims').textContent = $('#infoMode').textContent = $('#infoRes').textContent = '—';
    showEmpty(mic ? 'Listening… waiting for a signal' : 'Waiting for a signal');
  });

  /* ---------- microphone ---------- */

  async function ensureAudio() {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    await audio.resume();
  }

  async function startMic() {
    await ensureAudio();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('this browser does not allow microphone access here (use https or localhost)');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const src = audio.createMediaStreamSource(stream);
    const dec = makeDecoder(audio.sampleRate);
    const analyser = wfall.analyserFor(audio);
    src.connect(analyser);
    const sink = audio.createGain(); sink.gain.value = 0; sink.connect(audio.destination);

    let node;
    if (audio.audioWorklet) {
      if (!workletReady) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        await audio.audioWorklet.addModule(url);
        workletReady = true;
      }
      node = new AudioWorkletNode(audio, 'sstv-tap', { numberOfInputs: 1, numberOfOutputs: 1 });
      node.port.onmessage = (e) => dec.process(e.data);
    } else {                                   // older browsers
      node = audio.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => dec.process(new Float32Array(e.inputBuffer.getChannelData(0)));
    }
    src.connect(node); node.connect(sink);     // silent sink keeps the node running

    mic = { stream, src, node, sink, analyser, dec };
    setListenButton(true);
    if (!current) showEmpty('Listening… waiting for a signal');
    setStatus('Listening for a mode header…');
    requestAnimationFrame(micLoop);
  }

  function stopMic() {
    if (!mic) return;
    const m = mic;
    mic = null;
    m.dec.flush();
    m.stream.getTracks().forEach((t) => t.stop());
    try { m.src.disconnect(); m.node.disconnect(); m.sink.disconnect(); } catch (_) { /* ignore */ }
    if (m.node.port) m.node.port.onmessage = null;
    setListenButton(false);
    $('#meter').style.width = '0%';
    $('#onAir').classList.remove('live');
    if (!current) showEmpty('Waiting for a signal');
    if (!/Received|ended/.test($('#status').textContent)) setStatus('Stopped');
  }

  function micLoop() {
    if (!mic) return;
    const dec = mic.dec;
    paint();
    setProgress(dec);
    // Level meter: -60..0 dBFS
    const db = 20 * Math.log10(dec.level + 1e-9);
    const pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
    const meter = $('#meter');
    meter.style.width = pct + '%';
    meter.classList.toggle('hot', db > -3);
    if (!dec.busy && /Receiving/.test($('#status').textContent)) setStatus('Listening for a mode header…');
    wfall.draw(mic.analyser, audio.sampleRate);
    requestAnimationFrame(micLoop);
  }

  function setListenButton(on) {
    const b = $('#listen');
    b.classList.toggle('live', on);
    b.querySelector('span').textContent = on ? 'Stop listening' : 'Start listening';
  }

  $('#listen').addEventListener('click', () => {
    if (mic) { stopMic(); return; }
    if (fileJob) fileJob.cancel = true;
    startMic().catch((err) => {
      console.error(err);
      setListenButton(false);
      setStatus(err.name === 'NotAllowedError' ? 'Microphone permission was blocked' : 'Microphone error: ' + err.message);
    });
  });

  /* ---------- audio files ---------- */

  // Let the page repaint between chunks. MessageChannel isn't throttled in background tabs
  // the way setTimeout is.
  const yieldChannel = new MessageChannel();
  const yieldQueue = [];
  yieldChannel.port1.onmessage = () => { const r = yieldQueue.shift(); if (r) r(); };
  const yieldToBrowser = () => new Promise((r) => { yieldQueue.push(r); yieldChannel.port2.postMessage(0); });

  async function decodeFile(file) {
    if (!file) return;
    stopMic();
    if (fileJob) fileJob.cancel = true;
    const job = { cancel: false };
    fileJob = job;
    $('#cancel').hidden = false;
    setStatus(`Reading ${file.name}…`);
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      const buf = await audio.decodeAudioData(await file.arrayBuffer());
      // Mix to mono.
      const data = new Float32Array(buf.length);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const ch = buf.getChannelData(c);
        for (let i = 0; i < ch.length; i++) data[i] += ch[i] / buf.numberOfChannels;
      }
      const dec = makeDecoder(buf.sampleRate);
      const before = count;
      let found = false;
      const origStart = dec.h.onStart;
      dec.h.onStart = (e) => { found = true; origStart(e); };

      const CHUNK = 8192;
      let t = performance.now();
      for (let i = 0; i < data.length && !job.cancel; i += CHUNK) {
        dec.process(data.subarray(i, i + CHUNK));
        if (performance.now() - t > 30) {
          paint();
          setProgress(dec);
          if (!dec.busy) setStatus(`Scanning ${file.name}… ${Math.round(i / data.length * 100)}%`);
          await yieldToBrowser();
          t = performance.now();
        }
      }
      if (job.cancel) { dec.flush(); if (fileJob === job) setStatus('Cancelled'); return; }
      dec.flush();
      paint();
      const got = count - before;
      if (!found) setStatus(`No SSTV header found in ${file.name}`);
      else if (got > 1) setStatus(`Decoded ${got} pictures from ${file.name}`);
      else if (got === 1) setStatus(`Received ${current ? current.mode.name : 'picture'} from ${file.name} ✓`);
      else setStatus(`Signal in ${file.name} was too short to decode`);
    } catch (err) {
      console.error(err);
      setStatus('Could not read that file: ' + (err.message || err));
    } finally {
      if (fileJob === job) { fileJob = null; $('#cancel').hidden = true; }
    }
  }

  $('#file').addEventListener('change', (e) => { decodeFile(e.target.files[0]); e.target.value = ''; });
  $('#cancel').addEventListener('click', () => { if (fileJob) fileJob.cancel = true; });

  ['dragenter', 'dragover'].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); stage.classList.add('drag'); }));
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) stage.classList.remove('drag'); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    stage.classList.remove('drag');
    const f = e.dataTransfer.files[0];
    if (f) decodeFile(f);
  });

  /* ---------- init ---------- */
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
})();
