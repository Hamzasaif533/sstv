# SSTV

Send and receive pictures as sound (slow-scan television), right in the browser.

**Live:** https://hamzasaif533.github.io/sstv/

- **Transmit** — pick an image, add a callsign, choose a mode and press Transmit. Or download the audio as a WAV.
- **Receive** — listen through the microphone or open a recording; the mode is detected from the VIS header and the picture is drawn line by line, with automatic slant correction.

Modes: Robot 36/72, Martin M1/M2, Scottie S1/S2/DX, PD 50/90/120/180.

No build step and no dependencies — plain HTML, CSS and JavaScript.

## Run locally

```
python -m http.server 8123
```

Then open http://localhost:8123. (Microphone access needs `localhost` or https.)

## Files

| File | What it does |
| --- | --- |
| `sstv.js` | Encoder: image → SSTV audio, WAV export |
| `sstv-rx.js` | Decoder: audio → image (FM demodulator, VIS detection, sync tracking) |
| `app.js` / `index.html` | Transmit page |
| `rx.js` / `receive.html` | Receive page |
| `waterfall.js` | Spectrum display |
| `ui.js` | Floating dock and light/dark theme |
| `style.css` | Styles |
