// detail.js: app.api.detail, "more info" on anything, one pattern everywhere (the owner, Nov 14). A thing on screen shows
// its one line; its control opens its detail in place, under it, with the sentences src/core/detail.ts gives (`detailOf`)
// and nothing else. One detail is open at a time in each list, every detail is closed when the app opens, and the
// control says `aria-expanded`. The open one is kept here by list and key, so a view that draws its markup again (a
// part of patch.ts, a list drawn whole) draws it open again: a view puts `control(list, key)` on the thing's button and
// `panel(list, key, thing)` right after it, and `wire(root, redraw)` once. On the hotbar a press and hold opens it
// (map.js, `show`), since a tap there picks the ability. It arrives and leaves through motion.ts.
import { detailOf } from '../core/detail.ts';
import * as motion from './motion.ts';

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { ui } = app;
  const { esc } = ui;

  ui.css('detail', `
.dt{flex:1 1 100%;width:100%;margin:2px 0 4px;padding:8px 12px;border:1px solid var(--line-bright);background:rgba(17,42,70,.55);font-size:13px;line-height:1.4;color:var(--ice);text-align:left;overflow-wrap:anywhere}
.dt b{display:block;color:var(--cyan);font-weight:600}
.dt p{margin:0;color:var(--muted)}
.dt ul{margin:2px 0 0;padding-left:18px;color:var(--ice)}
.dt li{margin:2px 0}
[data-dt-key][aria-expanded=true]{border-color:var(--cyan)}
.chip .c-n{display:inline-block;min-width:1ch;font-family:var(--font-mono);color:var(--gold)}
.chip.full .c-n{color:var(--ground);background:var(--gold);padding:0 4px}
`);

  /** The open detail of each list: list name to key. */
  const open = new Map();
  const idOf = (list, key) => `dt-${list}-${key}`.replace(/[^\w-]/g, '_');

  /** The attributes of a thing's control: it says whether its detail is open, and which detail it opens. */
  const control = (list, key) => {
    const on = open.get(list) === key;
    return ` data-dt="${esc(list)}" data-dt-key="${esc(key)}" aria-expanded="${on}"${on ? ` aria-controls="${idOf(list, key)}"` : ''}`;
  };

  /**
   * The detail's markup when `key` is the list's open one, else nothing. `thing` is a Thing of src/core/detail.ts, or a
   * function that answers one (asked only when it is open); null draws nothing. `titled` repeats the thing's name at its
   * top, for a detail drawn away from the thing (the hotbar's, a zone's).
   */
  function panel(list, key, thing, titled = false) {
    if (open.get(list) !== key) return '';
    const t = typeof thing === 'function' ? thing() : thing;
    if (!t) return '';
    const d = detailOf(t, app.rules());
    const lines = d.lines.length ? `<ul>${d.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '';
    const about = d.about || (lines ? '' : 'No more detail.');
    return `<div class="dt" id="${idOf(list, key)}" data-dt-panel="${esc(list)}" role="region" aria-label="${esc(d.title)}">${titled ? `<b>${esc(d.title)}</b>` : ''}${about ? `<p>${esc(about)}</p>` : ''}${lines}</div>`;
  }

  /** Opens `key` in `list` (the one open there before closes), draws it with `redraw`, and brings it in. */
  function show(list, key, redraw) {
    open.set(list, key);
    redraw();
    const p = document.getElementById(idOf(list, key));
    if (p) void motion.enter(p);
  }
  /** Closes the open detail of `list`, if any: it leaves, and its control says so at once. */
  function close(list) {
    const key = open.get(list);
    if (key === undefined) return;
    open.delete(list);
    const p = document.getElementById(idOf(list, key));
    for (const c of document.querySelectorAll(`[data-dt="${CSS.escape(list)}"][data-dt-key="${CSS.escape(key)}"]`)) { c.setAttribute('aria-expanded', 'false'); c.removeAttribute('aria-controls'); }
    if (p) void motion.dismiss(p);
  }
  /** A tap on a control: its detail opens, or closes when it was open. */
  const toggle = (list, key, redraw) => (open.get(list) === key ? close(list) : show(list, key, redraw));

  /** Taps on the controls inside `root` open and close their details; `redraw` draws the view with the open one. */
  function wire(root, redraw) {
    root.addEventListener('click', ev => {
      const b = ev.target instanceof Element ? ev.target.closest('[data-dt-key]') : null;
      if (!b || !root.contains(b) || !(b instanceof HTMLElement)) return;
      toggle(b.dataset.dt || '', b.dataset.dtKey || '', redraw);
    });
  }

  /** @type {import('../core/api.ts').DetailApi} */
  app.api.detail = { control, panel, wire, show, close, isOpen: (list, key) => open.get(list) === key };
}
