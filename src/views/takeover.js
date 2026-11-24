// takeover.js: blocking full-screen choice when this tab may not write (src/core/store-life.ts ReadOnlyWhy).
// Variant 1: System warning window over dimmed, frozen (inert) app chrome. Opens on the one window stack (ui.js)
// as kind 'takeover' so it holds System windows behind it, traps Tab, swallows Escape, and ignores backdrop taps.
import { TAKEOVER_WORDS, canTakeOver } from '../core/store-life.ts';
import { enter } from './motion.ts';
import { closeWindow, openWindow, trapTab } from './ui.js';

const pad = n => String(n).padStart(2, '0');
const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc, h } = ui;

  /** @type {{ why: import('../core/store-life.ts').ReadOnlyWhy; root: HTMLElement; win: HTMLElement; handle: import('./ui.js').Win } | null} */
  let open = null;
  /** Siblings of the takeover overlay in document.body that this module froze, with their prior inert and aria-hidden. @type {Map<HTMLElement, { inert: boolean; hidden: string | null }>} */
  const frozen = new Map();

  function freeze() {
    if (!open) return;
    for (const el of document.body.children) {
      if (el === open.root || !(el instanceof HTMLElement) || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || frozen.has(el)) continue;
      frozen.set(el, { inert: el.inert, hidden: el.getAttribute('aria-hidden') });
      el.inert = true;
      el.setAttribute('aria-hidden', 'true');
    }
  }

  function unfreeze() {
    for (const [el, prev] of frozen) {
      el.inert = prev.inert;
      if (prev.hidden === null) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', prev.hidden);
    }
    frozen.clear();
  }

  function focusPrimary() {
    if (!open) return;
    const btn = /** @type {HTMLElement | null} */ (open.win.querySelector('button.primary') || open.win.querySelector('button') || open.win);
    if (btn) btn.focus({ preventScroll: true });
  }

  /** @param {import('../core/store-life.ts').ReadOnlyWhy} why */
  function markup(why) {
    const copy = TAKEOVER_WORDS.causes[why];
    return `<span class="cb"></span>
      <div class="n-tag">${esc(TAKEOVER_WORDS.tag)}</div>
      <h2 class="n-big" id="tk-title">${esc(copy.heading)}</h2>
      <div class="n-body" id="tk-body">
        ${copy.body.map(p => `<p>${esc(p)}</p>`).join('')}
        <p class="tk-export-note">${esc(copy.exportNote)}</p>
      </div>
      <div class="sys-actions tk-actions">
        <button type="button" class="primary" data-tk-reload>${esc(TAKEOVER_WORDS.reload)}</button>
        ${canTakeOver(why) ? `<button type="button" class="danger" data-tk-takeover>${esc(TAKEOVER_WORDS.takeOver)}</button>` : ''}
        <button type="button" data-tk-export>${esc(TAKEOVER_WORDS.exportBackup)}</button>
      </div>
      <p class="tk-status" role="status" aria-live="polite" data-tk-status hidden></p>`;
  }

  function key(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === 'Tab' && open) trapTab(e, open.win);
  }

  function sync() {
    const why = store.readOnlyWhy();
    if (!why) {
      if (!open) return;
      const closing = open;
      open = null;
      unfreeze();
      closeWindow(closing.handle);
      const main = document.getElementById('main');
      if (main) main.focus({ preventScroll: true });
      return;
    }
    if (open) {
      if (open.why !== why) {
        open.why = why;
        open.win.innerHTML = markup(why);
        focusPrimary();
      }
      freeze();
      return;
    }
    const root = h('<div class="overlay sys-overlay show tk-overlay"><div class="sys-window k-warning tk-win" role="alertdialog" aria-modal="true" aria-labelledby="tk-title" aria-describedby="tk-body" tabindex="-1"></div></div>');
    const win = /** @type {HTMLElement} */ (root.firstElementChild);
    win.innerHTML = markup(why);
    root.addEventListener('pointerdown', e => {
      if (e.target !== root) return;
      e.preventDefault();
      if (!win.contains(document.activeElement)) focusPrimary();
    });
    win.addEventListener('click', e => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      if (t.closest('[data-tk-reload]')) { location.reload(); return; }
      if (t.closest('[data-tk-takeover]')) { store.takeOver(); return; }
      if (t.closest('[data-tk-export]')) {
        download(`hunter-system-backup-${localDate(new Date())}.json`, store.exportReadOnly());
        const st = /** @type {HTMLElement | null} */ (win.querySelector('[data-tk-status]'));
        if (st) { st.textContent = TAKEOVER_WORDS.exported; st.hidden = false; }
      }
    });
    const handle = openWindow('takeover', () => { document.body.appendChild(root); return { root, win }; }, key);
    open = { why, root, win, handle };
    freeze();
    void enter(win);
    void enter(root, 'fade');
    focusPrimary();
  }

  document.addEventListener('focusin', e => {
    if (!open || !(e.target instanceof Node) || open.root.contains(e.target)) return;
    freeze();
    focusPrimary();
  }, true);

  app.on('ready', sync);
  app.on('change', sync);
  // Open immediately if the store loaded read-only, before later modules register and ask for System windows (coin.js).
  sync();
}
