// detail.js: app.api.detail, "more info" on anything, one pattern everywhere (the owner, Nov 14). A thing on screen shows
// its one line; its control opens its detail in place, under it, with the sentences src/core/detail.ts gives (`detailOf`)
// and nothing else. One detail is open at a time in each list, every detail is closed when the app opens, and the
// control says `aria-expanded`. Which one is open is kept here alone, one value of src/core/detail-open.ts's machine per
// list, and every move of it is drawn by the view's redraw, a close as an open, so markup a view keeps (a part of
// patch.ts, a list drawn whole) is never left saying otherwise: a view puts `control(list, key)` on the thing's button
// and `panel(list, key, thing)` right after it, and `wire(root, redraw)` once. On the hotbar a press and hold opens it
// (map.js, `move` and `openIn`), since a tap there picks the ability. It arrives and leaves through motion.ts.
import { detailOf } from '../core/detail.ts';
import { CLOSED, detailStep } from '../core/detail-open.ts';
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

  /** The open detail of each list, by list name (src/core/detail-open.ts); a list not here is closed. */
  const open = new Map();
  /** The key open in `list`, or null. */
  const openIn = list => { const s = open.get(list) ?? CLOSED; return s.at === 'open' ? s.key : null; };
  /** One part of an id: a character an id cannot hold is written as its code, so two keys never share an id. */
  const idPart = part => String(part).replace(/[^A-Za-z0-9]/g, c => `_${c.charCodeAt(0).toString(16)}_`);
  const idOf = (list, key) => `dt-${idPart(list)}-${idPart(key)}`;

  /** The attributes of a thing's control: it says whether its detail is open, and which detail it opens. */
  const control = (list, key) => {
    const on = openIn(list) === key;
    return ` data-dt="${esc(list)}" data-dt-key="${esc(key)}" aria-expanded="${on}"${on ? ` aria-controls="${idOf(list, key)}"` : ''}`;
  };

  /**
   * The detail's markup when `key` is the list's open one, else nothing. `thing` is a Thing of src/core/detail.ts, or a
   * function that answers one (asked only when it is open); null draws nothing. `titled` repeats the thing's name at its
   * top, for a detail drawn away from the thing (the hotbar's, a zone's).
   */
  function panel(list, key, thing, titled = false) {
    if (openIn(list) !== key) return '';
    const t = typeof thing === 'function' ? thing() : thing;
    if (!t) return '';
    const d = detailOf(t, app.rules());
    const lines = d.lines.length ? `<ul>${d.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '';
    const about = d.about || (lines ? '' : 'No more detail.');
    return `<div class="dt" id="${idOf(list, key)}" data-dt-panel="${esc(list)}" role="region" aria-label="${esc(d.title)}">${titled ? `<b>${esc(d.title)}</b>` : ''}${about ? `<p>${esc(about)}</p>` : ''}${lines}</div>`;
  }

  /**
   * Moves `list`'s detail by `e` and draws the change with `redraw`: the one that was open leaves as a copy fading off
   * (the redraw takes the panel itself away), the one now open comes in. An event that changes nothing draws nothing.
   */
  function move(list, e, redraw) {
    const was = open.get(list) ?? CLOSED, now = detailStep(was, e);
    if (now === was) return;
    const leaving = was.at === 'open' ? document.getElementById(idOf(list, was.key)) : null;
    if (leaving) void motion.fadeOff(leaving);
    if (now.at === 'open') open.set(list, now); else open.delete(list);
    redraw();
    const p = now.at === 'open' ? document.getElementById(idOf(list, now.key)) : null;
    if (p) void motion.enter(p);
  }

  /** Taps on the controls inside `root` open and close their details; `redraw` draws the view with the open one. */
  function wire(root, redraw) {
    root.addEventListener('click', ev => {
      const b = ev.target instanceof Element ? ev.target.closest('[data-dt-key]') : null;
      if (!b || !root.contains(b) || !(b instanceof HTMLElement)) return;
      move(b.dataset.dt || '', { kind: 'toggle', key: b.dataset.dtKey || '' }, redraw);
    });
  }

  /** @type {import('../core/api.ts').DetailApi} */
  app.api.detail = { control, panel, wire, move, openIn };
}
