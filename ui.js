/* Floating dock (navigation + theme switcher) shared by both pages. */
(function () {
  'use strict';

  const ICONS = {
    transmit: '<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
    receive: '<path d="M4.5 9.5a8 8 0 0 0 10 10z"/><path d="M9.5 14.5l3-3"/><path d="M14 4a6 6 0 0 1 6 6M14 7.5a2.5 2.5 0 0 1 2.5 2.5"/>',
    spectrum: '<path d="M3 12h1.5M7 9v6M11 5v14M15 8v8M19 10.5v3M21 12h0"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.7.4-1.2.9-1.2 1.7v.4"/><path d="M12 17h.01"/>',
    expand: '<path d="M8 9l4-4 4 4M8 15l4 4 4-4"/>',
    dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
    auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor"/>',
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  /* ---------- theme ---------- */
  const KEY = 'sstv-theme';
  const getTheme = () => { try { return localStorage.getItem(KEY) || 'auto'; } catch (_) { return 'auto'; } };
  function setTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem(KEY, t); } catch (_) { /* storage unavailable */ }
    document.querySelectorAll('.theme-switch button').forEach((b) => b.classList.toggle('on', b.dataset.theme === t));
  }

  /* ---------- dock ---------- */
  const onReceive = /receive\.html$/.test(location.pathname);
  const page = onReceive ? 'receive' : 'transmit';
  const hasSection = (id) => !!document.getElementById(id);

  const pos = document.createElement('div');
  pos.className = 'dock-pos';
  pos.innerHTML = `
    <nav class="dock" id="dock" aria-label="Main">
      <div class="dock-panel" id="dockPanel">
        <div class="theme-switch" role="group" aria-label="Theme">
          <button type="button" data-theme="dark">${svg('dark')}Dark</button>
          <button type="button" data-theme="light">${svg('light')}Light</button>
          <button type="button" data-theme="auto">${svg('auto')}Auto</button>
        </div>
        <a class="menu-item ${page === 'transmit' ? 'is-active' : ''}" href="index.html">${svg('transmit')}<span>Transmit</span><small>picture → sound</small></a>
        <a class="menu-item ${page === 'receive' ? 'is-active' : ''}" href="receive.html">${svg('receive')}<span>Receive</span><small>sound → picture</small></a>
        <button type="button" class="menu-item" data-scroll="spectrum">${svg('spectrum')}<span>Spectrum</span></button>
        <button type="button" class="menu-item" data-scroll="help">${svg('help')}<span>${onReceive ? 'Received pictures' : 'How to receive'}</span></button>
      </div>
      <div class="dock-bar">
        <a href="index.html" aria-label="Transmit" title="Transmit" class="${page === 'transmit' ? 'is-active' : ''}">${svg('transmit')}</a>
        <a href="receive.html" aria-label="Receive" title="Receive" class="${page === 'receive' ? 'is-active' : ''}">${svg('receive')}</a>
        <button type="button" aria-label="Spectrum" title="Spectrum" data-scroll="spectrum">${svg('spectrum')}</button>
        <button type="button" aria-label="${onReceive ? 'Received pictures' : 'How to receive'}" title="${onReceive ? 'Received pictures' : 'How to receive'}" data-scroll="help">${svg('help')}</button>
        <button type="button" aria-label="Expand menu" title="Menu" id="dockExpand" aria-expanded="false">${svg('expand')}</button>
      </div>
    </nav>`;
  document.body.appendChild(pos);

  const dock = pos.querySelector('#dock');
  const panel = pos.querySelector('#dockPanel');
  const expandBtn = pos.querySelector('#dockExpand');

  function open() {
    dock.style.setProperty('--w', '280px');
    dock.style.setProperty('--h', panel.scrollHeight + 'px');
    dock.classList.add('open');
    expandBtn.setAttribute('aria-expanded', 'true');
  }
  function close() {
    dock.style.removeProperty('--w');
    dock.style.removeProperty('--h');
    dock.classList.remove('open');
    expandBtn.setAttribute('aria-expanded', 'false');
  }

  expandBtn.addEventListener('click', (e) => { e.stopPropagation(); dock.classList.contains('open') ? close() : open(); });
  document.addEventListener('click', (e) => { if (dock.classList.contains('open') && !dock.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  pos.querySelectorAll('.theme-switch button').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.theme)));
  pos.querySelectorAll('[data-scroll]').forEach((b) => {
    if (!hasSection(b.dataset.scroll)) { b.hidden = true; return; }
    b.addEventListener('click', () => {
      close();
      document.getElementById(b.dataset.scroll).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  setTheme(getTheme());
})();
