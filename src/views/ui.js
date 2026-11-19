// ui.js: shared UI primitives (§B4). Every modal goes through system()/confirm()/promptNum().
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC_MAP[c]);
/** @type {(html: string) => ViewElement} */
export const h = html => { const t = document.createElement('template'); t.innerHTML = String(html).trim(); return t.content.firstElementChild; };
/** @type {(sel: string, root?: ParentNode) => ViewElement | null} */
export const $ = (sel, root = document) => root.querySelector(sel);
export const fmt = n => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US') : '0');
/** What a maker says when the store refused its write (another tab took over, a newer app's save): nothing was saved. */
export const NOT_SAVED = 'Not saved: this tab cannot save right now. The banner at the top says why.';
export const rankBadge = rank => `<span class="rank-badge rank-${esc(rank)}" title="Rank ${esc(rank)}">${esc(rank)}</span>`;
export const field = (label, inputHtml) => `<label class="field"><span class="lbl">${esc(label)}</span>${inputHtml}</label>`;
import { dismiss, enter } from './motion.ts';
import { store } from '../edge/store.ts';
import { reported } from '../edge/report.ts';
import { READ_ONLY } from '../core/store-life.ts';
export { reduced } from './motion.ts';

// ── chime: generated WebAudio, only after a user gesture, only when settings.sound is on ──
/** @type {AudioContext | null} */
let actx = null;
const sound = () => store.get().settings.sound;
const arm = () => {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !sound()) return;
  try { if (!actx) actx = new AC(); } catch (e) { reported('ui:sound', e); return; } // the browser allows no more audio: no chime, logged once
  if (actx.state === 'suspended') actx.resume().catch(e => reported('ui:sound', e)); // refused outside a gesture: the next gesture tries again
};
['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, arm, { capture: true, passive: true }));
function chime(kind) {
  try {
    if (!actx || actx.state !== 'running' || !sound()) return;
    const bad = kind === 'warning' || kind === 'penalty';
    const notes = bad ? [330, 247] : kind === 'levelup' ? [523, 659, 784] : [660, 880];
    const t0 = actx.currentTime;
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = t0 + i * 0.09;
      o.type = bad ? 'sawtooth' : 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.25);
    });
  } catch (e) { reported('ui:sound', e); } // a window opens with or without its chime
}

export function css(id, text) {
  /** @type {HTMLElement | null} */
  let el = document.head.querySelector(`style[data-mod="${CSS.escape(id)}"]`);
  if (!el) { el = document.createElement('style'); el.dataset.mod = id; document.head.appendChild(el); }
  el.textContent = themed(text);
}
// module CSS follows the device accent and text size: hardcoded accent glows become variables, px font sizes scale with --ts
export const themed = t => String(t).replace(/rgba\(77,\s*216,\s*255,/g, 'rgba(var(--acc-rgb),').replace(/rgba\(63,\s*192,\s*255,/g, 'rgba(var(--acc2-rgb),')
  .replace(/rgba\(20,\s*80,\s*130,/g, 'rgba(var(--deep-rgb),').replace(/font-size:\s*([\d.]+)px/g, 'font-size:calc($1px*var(--ts))');

/** How long a toast, or the fight's line over the map, stays. */
export const TOAST_MS = 3200;
// ── toasts: dismissable, max 2 visible (a third replaces the oldest), same-key toasts coalesce (sum amounts) ──
function toastBox() {
  let box = document.getElementById('toasts');
  if (!box) { box = h('<div class="toast-box" id="toasts" role="status" aria-live="polite"></div>'); document.body.appendChild(box); }
  return box;
}
/** The toasts on screen, not the ones on their way out. @param {HTMLElement} box @returns {any[]} */
const shown = box => [...box.children].filter(t => !t.classList.contains('m-leaving'));
/**
 * A toast that ends with what it says: `act` runs as it ends, never if its Undo is tapped. It ends after `ms`, or sooner
 * when a third toast pushes it off or the page is hidden or left (`heldNow`), so a give held back is never lost. The
 * write it holds is the one the action makes at once without it (gm.js's Give…): only later.
 * @typedef {{ ms: number; act: () => void; undo: string }} Hold
 */
/** A toast ends: its held write, if it holds one, runs as it goes. @param {any} t */
function ended(t) {
  const act = t._act; t._act = null;
  dismiss(t);
  if (act) act();
}
/** The page is hidden or left: every held toast ends now, its write made. */
function heldNow() {
  const box = document.getElementById('toasts');
  if (box) for (const t of shown(box)) if (t._act) { clearTimeout(t._t); ended(t); }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) heldNow(); });
addEventListener('pagehide', heldNow);
/**
 * @param {string} tag @param {string} msg
 * @param {{ kind?: string; key?: string; amount?: number; fmt?: (n: number) => string; hold?: Hold }} [opts]
 */
export function toast(tag, msg, opts = {}) {
  const box = toastBox(); const kind = opts.kind || 'info';
  if (opts.key) { // e.g. {key:'xp', amount:10, fmt:n=>`+${n} XP acquired.`}
    const prev = shown(box).find(t => t.dataset.key === opts.key);
    if (prev && opts.amount !== undefined) {
      const total = Number(prev.dataset.amount) + opts.amount; prev.dataset.amount = String(total);
      prev.querySelector('.t-msg').textContent = opts.fmt ? opts.fmt(total) : msg;
      clearTimeout(prev._t); prev._t = setTimeout(() => dismiss(prev), TOAST_MS); return prev;
    }
  }
  const hold = opts.hold;
  const end = hold ? `<button type="button" class="t-undo">${esc(hold.undo)}</button>` : '<button type="button" class="t-x" aria-label="Dismiss notification">&times;</button>';
  const t = h(`<div class="toast toast-${esc(kind)}"><span class="t-tag">${esc(tag)}</span><span class="t-msg">${esc(opts.amount !== undefined && opts.fmt ? opts.fmt(opts.amount) : msg)}</span>${end}</div>`);
  if (opts.key) { t.dataset.key = opts.key; t.dataset.amount = String(opts.amount ?? 0); }
  if (hold) { t._act = hold.act; t.dataset.held = ''; }
  // Undo drops the held write; the × of a plain toast only takes it away
  t.querySelector('.t-x, .t-undo').addEventListener('click', () => { clearTimeout(t._t); t._act = null; dismiss(t); });
  box.appendChild(t);
  enter(t, 'toast');
  for (const old of shown(box).slice(0, -2)) { clearTimeout(old._t); ended(old); }
  t._t = setTimeout(() => ended(t), hold ? hold.ms : TOAST_MS);
  return t;
}
/**
 * Whether a write to the save was taken: `w` is `store.apply`'s answer. A refused write is told in a toast under `tag`:
 * a read-only tab's refusal as NOT_SAVED (the banner says why), a step's own refusal by its words in `words`, which
 * the core module that refused it gives. A step's refusal with no words means the screen offered a change its rule
 * refuses: a bug, reported.
 * @param {string} tag @param {import('../core/save-step.ts').Applied} w @param {Readonly<Record<string, string>>} [words]
 */
export function wrote(tag, w, words = {}) {
  if (!('why' in w)) return true;
  if (w.why === READ_ONLY) toast(tag, NOT_SAVED, { kind: 'warning' });
  else if (Object.prototype.hasOwnProperty.call(words, w.why)) toast(tag, words[w.why], { kind: 'warning' });
  else reported(`write:${tag}`, new Error(`the screen offered a change its rule refuses: ${w.why}`));
  return false;
}

// ── the fight's news: one line over the map while a map shows a fight, else a toast ──
/** @typedef {(msg: string, kind: string) => boolean} NewsLine A map's line: takes the news (true) while it shows a fight. */
/** @type {Set<NewsLine>} */
const newsLines = new Set();
/** A map offers its line; the answer takes it back. */
export function newsLine(/** @type {NewsLine} */ line) { newsLines.add(line); return () => { newsLines.delete(line); }; }
/**
 * The fight's news (a use, a refusal, a turn): the line over the map that shows a fight takes it, so no toast covers
 * Next, Use, Cancel or the hotbar; with no such map, or a window or sheet over it (`windowOpen`), it is a toast.
 */
export function news(/** @type {string} */ msg, kind = 'info') {
  if (!windowOpen()) for (const line of newsLines) if (line(msg, kind)) return;
  toast('! Combat', msg, { kind });
}

// ── the window stack ──
/**
 * Every window on screen or waiting for its turn, oldest first. A System window (`system`) opens one at a time: the
 * next waits `queued` until the one up has gone. A maker (`maker`), the first-run window (`onboard`) and the GM's shelf
 * of awards (`shelf`, give-shelf.js) open at once, over whatever is up. A sheet over the page (`sheet`: the dice roller, the Fight tools over a map) is on the stack
 * while its owner shows it. A window going away is `leaving`: no longer open, off the stack when its move ends.
 * The top open window that is not a sheet takes every key (`key`), so Escape and Tab reach that one window only.
 * @typedef {'queued' | 'open' | 'leaving'} WindowState
 * @typedef {'system' | 'maker' | 'onboard' | 'shelf' | 'story' | 'sheet'} WindowKind
 * @typedef {{ kind: WindowKind; state: WindowState; root: HTMLElement | null; win: HTMLElement | null; key: ((e: KeyboardEvent) => void) | null; show: () => void }} Win
 */
/** @type {Win[]} */
const stack = [];
/** A sheet counts while it is drawn: a sheet in a view that is not shown has no box. */
const isOpen = (/** @type {Win} */ w) => w.state === 'open' && (w.kind !== 'sheet' || !!w.root && w.root.getClientRects().length > 0);
/** Is a window or a sheet over the page: the one answer for the app's keys, the fight's news and anything else that asks. */
export const windowOpen = () => stack.some(isOpen);
document.addEventListener('keydown', e => {
  for (let i = stack.length - 1; i >= 0; i--) { const w = stack[i]; if (w.kind !== 'sheet' && w.state === 'open') { if (w.key) w.key(e); return; } }
}, true);

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[href],[tabindex]:not([tabindex="-1"])';
/** Keeps Tab inside `win`: past the last field to the first, before the first to the last. */
export function trapTab(/** @type {KeyboardEvent} */ e, /** @type {HTMLElement} */ win) {
  const f = [...win.querySelectorAll(FOCUSABLE)].filter(x => !x.hidden && x.offsetParent !== null); if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (!win.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** A one-line field, where Enter moves to the next field (`formEnter`; a field with a list of choices keeps its Enter); with a text box, the fields that take typing. */
const LINE = 'input[type=text],input[type=number],input:not([type])', TYPED = `${LINE},textarea`;
/**
 * What Enter does in a form of many fields, every maker and the Quests view's form: in a one-line field it moves the
 * cursor to the next field of `form` that takes typing, as a phone keyboard's Next does, and does nothing at the last
 * one. It never saves: such a form is long, its last field moves as rows and parts are drawn, and a stray Enter in an
 * objective saved the whole form. Ctrl or Cmd and Enter runs `save` from anywhere. A key pressed while an input method
 * composes is left alone. Answers whether it took the key.
 * @param {KeyboardEvent} e @param {Element} form @param {() => void} save
 */
export function formEnter(e, form, save) {
  if (e.key !== 'Enter' || e.isComposing) return false;
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); save(); return true; }
  const t = e.target;
  if (!(t instanceof HTMLElement) || !t.matches(LINE) || t.matches('[list]') || !form.contains(t)) return false;
  e.preventDefault();
  const fields = [...form.querySelectorAll(TYPED)].filter(f => !f.disabled && f.getClientRects().length > 0);
  const to = fields[fields.findIndex(f => f === t) + 1];
  if (to) to.focus();
  return true;
}

/**
 * Opens a maker, the first-run window or the shelf of awards now, over whatever is up: `show` puts it on the page and answers its overlay and
 * window. Answers the entry, for `closeWindow`.
 * @param {WindowKind} kind @param {() => { root: HTMLElement; win: HTMLElement | null }} show @param {(e: KeyboardEvent) => void} key
 */
export function openWindow(kind, show, key) {
  /** @type {Win} */
  const w = { kind, state: 'open', root: null, win: null, key, show: () => {} };
  stack.push(w);
  const at = show(); w.root = at.root; w.win = at.win;
  return w;
}
/** A window goes: `leaving` while it fades, then off the stack. After a System window, the next one waiting opens a task later. */
export function closeWindow(/** @type {Win} */ w) {
  if (w.state !== 'open') return;
  w.state = 'leaving';
  const gone = () => { const i = stack.indexOf(w); if (i >= 0) stack.splice(i, 1); };
  if (w.root) void dismiss(w.root, w.win).then(gone); else gone();
  if (w.kind === 'system') setTimeout(openNext, LATE);
}
/** A sheet over the page is on the stack while `on` (its owner says so each time it draws it). @param {HTMLElement} el @param {boolean} on */
export function sheet(el, on) {
  const i = stack.findIndex(w => w.kind === 'sheet' && w.root === el);
  if (on && i < 0) stack.push({ kind: 'sheet', state: 'open', root: el, win: null, key: null, show: () => {} });
  else if (!on && i >= 0) stack.splice(i, 1);
}

// ── System windows: queued on the stack, focus-trapped, Escape and the backdrop dismiss, focus restored ──
let refreshCur = null;
// default (non-cancel) value of a window that may be bulk-confirmed; undefined = never auto-resolve (forms, multi-action dialogs)
const autoValue = o => {
  if (o.form) return undefined;
  const a = o.actions && o.actions.length ? o.actions : [{ value: true }];
  return a.length === 1 ? { v: a[0].value } : undefined;
};

// Test lever, 0 in the app: every window opens this many ms late. tests/e2e/helpers.ts sets it from E2E_POPUP_DELAY, so a
// test that taps on before the window it expects is on screen fails every time instead of now and then.
const LATE = Number(globalThis.__e2ePopupDelay) || 0;
/** The System windows waiting, oldest first. */
const waiting = () => stack.filter(w => w.kind === 'system' && w.state === 'queued');
/** Opens the oldest System window waiting, unless one is up. */
function openNext() {
  if (stack.some(w => w.kind === 'system' && w.state === 'open')) return;
  const w = waiting()[0]; if (!w) return;
  w.state = 'open'; w.show();
}

/**
 * @typedef {{ label: string; value?: unknown; cancel?: boolean; primary?: boolean; danger?: boolean }} SystemAction
 * @typedef {{ tag?: string; title?: string; kind?: string; body?: string; html?: string; size?: string; layout?: string;
 *   lines?: string[]; rewards?: (string | { label?: string; text?: string })[]; actions?: SystemAction[];
 *   form?: { label?: string; value?: string | number; type: 'text' | 'number'; min?: number; max?: number; maxlength?: number } }} SystemWindow
 */
/** A System window; answers the `value` of the action tapped (a form answers what was typed). @param {SystemWindow} [o] @returns {Promise<any>} */
export function system(o = {}) {
  return new Promise(resolve => {
    /** @type {Win & { o: SystemWindow; resolve: (v: any) => void }} */
    const w = { kind: 'system', state: 'queued', root: null, win: null, key: null, show: () => show(w), o, resolve };
    const up = stack.some(x => x.kind === 'system' && x.state === 'open');
    stack.push(w);
    if (up) { if (refreshCur) refreshCur(); } else if (LATE) setTimeout(openNext, LATE); else openNext();
  });
}

/** Draws a System window that has just turned `open`. */
function show(/** @type {Win & { o: SystemWindow; resolve: (v: any) => void }} */ w) {
  const { o, resolve } = w;
  const kind = o.kind || 'info';
  const trigger = document.activeElement;
  const uid = 'sysw' + Math.random().toString(36).slice(2, 7);
  const actions = o.actions && o.actions.length ? o.actions : [{ label: 'Confirm', value: true, primary: true }];
  const lines = (o.lines || []).map(l => `<li>${esc(l)}</li>`).join('');
  const rewards = (o.rewards || []).map(r => `<li>${esc(typeof r === 'string' ? r : r.label || r.text || '')}</li>`).join('');
  const form = o.form ? `<label class="field sys-field"><span class="lbl">${esc(o.form.label || '')}</span>
      <input id="${uid}-in" class="sys-input" type="${o.form.type === 'text' ? 'text' : 'number'}" value="${esc(o.form.value ?? '')}"
        ${o.form.min !== undefined ? `min="${esc(o.form.min)}"` : ''} ${o.form.max !== undefined ? `max="${esc(o.form.max)}"` : ''}
        ${o.form.maxlength ? `maxlength="${esc(o.form.maxlength)}"` : ''} ${o.form.type === 'text' ? '' : 'inputmode="numeric"'} autocomplete="off"></label>
      <div class="sys-err" role="alert"></div>` : '';
  const el = h(`<div class="overlay sys-overlay show">
    <div class="sys-window k-${esc(kind)}${o.size === 'form' ? ' dlg-form' : ''}" role="${kind === 'warning' || kind === 'penalty' ? 'alertdialog' : 'dialog'}" aria-modal="true" aria-labelledby="${uid}-t" ${o.body ? `aria-describedby="${uid}-b"` : ''}>
      <span class="cb"></span>
      <div class="n-tag">${esc(o.tag || '! Notification')}</div>
      <h2 class="n-big sys-title" id="${uid}-t">${esc(o.title || '')}</h2>
      ${o.body ? `<p class="n-body" id="${uid}-b">${esc(o.body)}</p>` : ''}
      ${lines ? `<ul class="sys-lines">${lines}</ul>` : ''}
      ${rewards ? `<div class="lbl sys-rw-h">Rewards</div><ul class="sys-rewards">${rewards}</ul>` : ''}
      ${form}
      ${o.html ? `<div class="sys-html">${o.html}</div>` : ''}
      <div class="sys-actions${o.layout === 'list' ? ' list' : ''}${o.size === 'form' ? ' dlg-actions' : ''}"></div>
    </div></div>`);
  const win = el.firstElementChild, bar = el.querySelector('.sys-actions'), input = el.querySelector('.sys-input'), err = el.querySelector('.sys-err');
  chime(kind);
  const cancelAct = actions.find(a => a.cancel);
  const dismissValue = o.form ? null : cancelAct ? cancelAct.value : null;
  const done = value => { refreshCur = null; closeWindow(w); if (trigger && trigger.isConnected && trigger.focus) trigger.focus(); resolve(value); };
  const choose = a => {
    if (o.form && a.primary !== false && !a.cancel) {
      let v = input.value.trim();
      if (o.form.type === 'text') { if (!v) { err.textContent = 'Enter a value.'; input.focus(); return; } return done(v); }
      const n = Number(v);
      if (v === '' || !Number.isFinite(n)) { err.textContent = 'Enter a number.'; input.focus(); return; }
      if ((o.form.min !== undefined && n < o.form.min) || (o.form.max !== undefined && n > o.form.max)) {
        err.textContent = `Enter a value from ${o.form.min ?? '-∞'} to ${o.form.max ?? '∞'}.`; input.focus(); return;
      }
      return done(n);
    }
    done(a.value);
  };
  actions.forEach(a => {
    const b = h(`<button type="button" class="${a.primary ? 'primary ' : ''}${a.danger ? 'danger ' : ''}">${esc(a.label)}</button>`);
    b.addEventListener('click', () => choose(a)); bar.appendChild(b);
  });
  const mine = autoValue(o) !== undefined;
  const all = h('<button type="button" class="confirm-all" hidden></button>');
  if (mine) bar.appendChild(all);
  const resolvable = () => /** @type {any[]} */ (waiting()).filter(q => autoValue(q.o) !== undefined);
  refreshCur = () => { const n = resolvable().length; all.hidden = !(mine && n >= 2); all.textContent = `Confirm all (${n})`; };
  all.addEventListener('click', () => {
    const rest = resolvable(); rest.forEach(q => stack.splice(stack.indexOf(q), 1));
    done(autoValue(o).v); rest.forEach(q => q.resolve(autoValue(q.o).v));
  });
  refreshCur();
  w.key = (/** @type {any} */ e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(dismissValue); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (o.form || o.size === 'form')) { // B3: Ctrl/Cmd+Enter = primary, even from a textarea
      const p = bar.querySelector('button.primary'); if (p && !p.disabled) { e.preventDefault(); p.click(); return; }
    }
    if (e.key === 'Enter' && input && e.target === input) { e.preventDefault(); choose(actions.find(a => a.primary) || actions[0]); return; }
    if (e.key === 'Tab') trapTab(e, win);
  };
  // a press of its own beside the window dismisses it: `pointerdown`, never the mouse events a phone makes after a tap,
  // which land on this backdrop when the tap's lift opened the window (a battle map control acts at the lift)
  el.addEventListener('pointerdown', e => { if (e.target === el) done(dismissValue); });
  w.root = el; w.win = win;
  document.body.appendChild(el);
  enter(win); enter(el, 'fade');
  // a window taller than the screen opens at its title: the focus on its button must not scroll it to its end
  if (input) { input.focus(); input.select(); } else (bar.querySelector('button.primary') || bar.querySelector('button') || win).focus({ preventScroll: true });
}

/** @type {(o?: { title?: string; body?: string; danger?: boolean; confirmLabel?: string }) => Promise<boolean>} */
export const confirm = ({ title = 'Are you sure?', body = '', danger = false, confirmLabel = 'Confirm' } = {}) =>
  system({ tag: danger ? '! Warning' : '! Confirm', title, body, kind: danger ? 'warning' : 'info',
    actions: [{ label: 'Cancel', value: false, cancel: true }, { label: confirmLabel, value: true, primary: true, danger }] }).then(v => v === true);

/** @type {(o?: { title?: string; label?: string; value?: number; min?: number; max?: number }) => Promise<number | null>} */
export const promptNum = ({ title = 'Enter a number', label = 'Value', value = 0, min, max } = {}) =>
  system({ tag: '! Input', title, form: { label, value, min, max, type: 'number' },
    actions: [{ label: 'Cancel', value: null, cancel: true }, { label: 'Confirm', primary: true }] }).then(v => (typeof v === 'number' ? v : null));

// addition: text prompt, same contract as promptNum but returns string|null
/** @type {(o?: { title?: string; label?: string; value?: string; maxlength?: number }) => Promise<string | null>} */
export const promptText = ({ title = 'Enter text', label = 'Value', value = '', maxlength = 60 } = {}) =>
  system({ tag: '! Input', title, form: { label, value, maxlength, type: 'text' },
    actions: [{ label: 'Cancel', value: null, cancel: true }, { label: 'Confirm', primary: true }] }).then(v => (typeof v === 'string' ? v : null));

// ── hover hints (B5): mouse-only; icon-ish buttons with an aria-label that differs from their text get it as a title ──
document.addEventListener('pointerover', e => {
  if (e.pointerType !== 'mouse' || !e.target.closest) return;
  const b = e.target.closest('button,a.tab,[role=button]');
  if (!b || b.hasAttribute('title')) return;
  const al = b.getAttribute('aria-label');
  if (al && al !== (b.innerText || '').trim()) b.title = al;
}, { passive: true });
