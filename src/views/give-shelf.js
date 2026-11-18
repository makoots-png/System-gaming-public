// give-shelf.js: the GM's shelf of awards for roleplay, opened by Give… on a hunter's card (gm.js `giveFrom`). One window
// at 390 px: its head (the title, Cancel and "How to use these") and a row of moment chips stay put while the list under
// them scrolls, so Cancel is never a scroll away. The list is grouped under headings: the last few given on this phone,
// the GM's own bundles, then the built-ins by moment (src/core/registry/bundles.ts). A chip shows one group alone, so a
// GM who knows the moment sees its few awards on one screen with one tap and types nothing at the table. Each row says
// what the award is for (`when`) and what it gives (`givesLine`); a tap answers it and closes the shelf. Every sentence is
// core's (`SHELF_WORDS`, `MOMENT_WORDS`, `MOMENT_CHIPS`, `GIVING_GUIDE`). The chip on screen lives in the DOM
// (`aria-pressed`) and dies with the window; the shelf writes nothing.
import { closeWindow, css, esc, h, openWindow, trapTab } from './ui.js';
import { enter } from './motion.ts';
import { BUILT_IN_BUNDLES, GIVING_GUIDE, MOMENTS, MOMENT_CHIPS, MOMENT_WORDS, SHELF_WORDS, givesLine } from '../core/registry/bundles.ts';

css('give-shelf', `
.gs-ov{align-items:stretch}
.gs-win.sys-window{display:flex;flex-direction:column;overflow:visible;text-align:left;padding:14px 14px 0;height:calc(100dvh - 32px - var(--sat) - var(--sab));max-height:calc(100dvh - 32px - var(--sat) - var(--sab));margin:auto}
.gs-head{display:flex;align-items:flex-start;gap:10px;flex:0 0 auto}
.gs-head>div{flex:1 1 auto;min-width:0}
.gs-head .n-tag{margin-bottom:4px}
.gs-win .n-big.gs-title{font-size:calc(20px*var(--ts));letter-spacing:.1em;margin:0;overflow-wrap:anywhere}
.gs-head button,.gs-guide-btn{min-height:var(--control-h);flex:0 0 auto}
.gs-guide-btn{align-self:flex-start;margin:4px 0 6px}
.gs-chips.seg{flex:0 0 auto;flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;gap:6px;padding:2px 0 8px;scrollbar-width:thin}
.gs-chips.seg>button{flex:0 0 auto;min-height:var(--control-h);white-space:nowrap;padding:0 12px}
.gs-list{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:0 2px 14px;border-top:1px solid var(--line)}
.gs-guide{margin:10px 0 4px;padding-left:20px;color:var(--ice);font-size:calc(14px*var(--ts));line-height:1.45}
.gs-guide li{margin-bottom:6px}
.gs-h{font-size:calc(12px*var(--ts));letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin:14px 0 6px}
.gs-rows{display:flex;flex-direction:column;gap:6px}
button.gs-row{display:flex;flex-direction:column;align-items:stretch;gap:2px;width:100%;text-align:left;padding:8px 12px;min-height:var(--control-h);text-transform:none;letter-spacing:normal;font-weight:400}
.gs-name{font-weight:600;color:var(--ice);font-size:calc(15px*var(--ts));overflow-wrap:anywhere}
.gs-rare{margin-left:8px;font-size:calc(12px*var(--ts));letter-spacing:.14em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);padding:0 6px}
.gs-when{color:var(--cyan-dim);font-size:calc(13px*var(--ts));overflow-wrap:anywhere}
.gs-gives{color:var(--gold);font-size:calc(13px*var(--ts));font-family:var(--font-mono);overflow-wrap:anywhere}
`);

/**
 * An award on the shelf: a built-in or a bundle the GM saved (`own`), with its key (a built-in's `seed-` key, a saved
 * bundle's id), name, reward and window words.
 * @typedef {{ key: string; name: string; rewards: import('../core/rewards.ts').Rewards; window: import('../core/rewards.ts').SystemWords | null }} Award
 * @typedef {Award & { when: string; rare: boolean; own: boolean }} Row
 */

/**
 * Opens the shelf for a hunter called `name`: `own` the GM's saved bundles, `recent` the keys of the last given (newest
 * first), `R` the rules a reward's line is said by. Answers the award tapped, or null for Cancel, Escape or the backdrop.
 * @param {{ name: string; own: Award[]; recent: string[]; R: import('../core/rewards.ts').RewardRules }} o
 * @returns {Promise<Award | null>}
 */
export function giveShelf({ name, own, recent, R }) {
  /** @type {Row[]} */
  const mine = own.map(b => ({ ...b, when: SHELF_WORDS.ownWhen, rare: false, own: true }));
  /** @type {(b: import('../core/registry/bundles.ts').BuiltInBundle) => Row} */
  const rowOf = b => ({ key: b.key, name: b.name, rewards: b.rewards, window: b.window, when: b.when, rare: b.rare, own: false });
  const every = [...mine, ...BUILT_IN_BUNDLES.map(rowOf)];
  const last = recent.map(k => every.find(b => b.key === k)).filter(b => !!b);
  /** The groups under their headings, by the chip that shows each alone ('' for the last given, shown under All only). */
  const groups = [
    { chip: '', head: SHELF_WORDS.recent, rows: last },
    { chip: 'own', head: SHELF_WORDS.own, rows: mine },
    ...MOMENTS.map(m => ({ chip: m, head: MOMENT_WORDS[m], rows: BUILT_IN_BUNDLES.filter(b => b.moment === m).map(rowOf) })),
  ].filter(g => g.rows.length);
  const chips = [['all', SHELF_WORDS.all], ...(mine.length ? [['own', SHELF_WORDS.own]] : []), ...MOMENTS.map(m => [m, MOMENT_CHIPS[m]])];
  const rowHtml = (/** @type {Row} */ b) => `<button type="button" class="gs-row" data-give="${esc(b.key)}">
      <span class="gs-name">${esc(b.name)}${b.rare ? `<span class="gs-rare">${esc(SHELF_WORDS.rare)}</span>` : ''}</span>
      <span class="gs-when">${esc(b.when)}</span>
      <span class="gs-gives">${esc(givesLine(b.rewards, R))}</span></button>`;
  const listHtml = (/** @type {string} */ chip) => groups.filter(g => chip === 'all' || g.chip === chip)
    .map(g => `<section data-group="${esc(g.chip || 'recent')}"><h3 class="gs-h">${esc(g.head)}</h3><div class="gs-rows">${g.rows.map(rowHtml).join('')}</div></section>`).join('');

  return new Promise(resolve => {
    const trigger = document.activeElement, uid = 'gs' + Math.random().toString(36).slice(2, 7);
    const el = h(`<div class="overlay sys-overlay show gs-ov">
      <div class="sys-window k-quest gs-win" role="dialog" aria-modal="true" aria-labelledby="${uid}-t"><span class="cb"></span>
        <div class="gs-head"><div><div class="n-tag">${esc(SHELF_WORDS.tag)}</div><h2 class="n-big gs-title" id="${uid}-t">${esc(SHELF_WORDS.title(name))}</h2></div>
          <button type="button" class="quiet" data-gs-cancel>${esc(SHELF_WORDS.cancel)}</button></div>
        <button type="button" class="quiet gs-guide-btn" data-gs-guide aria-expanded="false" aria-controls="${uid}-g">${esc(SHELF_WORDS.guide)}</button>
        <div class="gs-chips seg" role="group" aria-label="${esc(SHELF_WORDS.chips)}">${chips.map(([v, l]) => `<button type="button" data-gs-chip="${esc(v)}" aria-pressed="${v === 'all'}">${esc(l)}</button>`).join('')}</div>
        <div class="gs-list" data-gs-list><ul class="gs-guide" id="${uid}-g" hidden>${GIVING_GUIDE.map(l => `<li>${esc(l)}</li>`).join('')}</ul><div data-gs-rows>${listHtml('all')}</div></div>
      </div></div>`);
    const win = /** @type {HTMLElement} */ (el.firstElementChild), list = /** @type {HTMLElement} */ (el.querySelector('[data-gs-list]'));
    /** @param {Award | null} b */
    const done = b => {
      closeWindow(me);
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
      resolve(b ? { key: b.key, name: b.name, rewards: b.rewards, window: b.window } : null);
    };
    const me = openWindow('shelf', () => { document.body.appendChild(el); return { root: el, win }; }, e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); return; }
      if (e.key === 'Tab') trapTab(e, win);
    });
    el.addEventListener('click', e => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (t === el) return done(null);
      const btn = t.closest('button'); if (!btn) return;
      if (btn.hasAttribute('data-gs-cancel')) return done(null);
      if (btn.dataset.give !== undefined) return done(every.find(b => b.key === btn.dataset.give) || null);
      if (btn.hasAttribute('data-gs-guide')) {
        const g = /** @type {HTMLElement} */ (el.querySelector('.gs-guide')), open = g.hidden;
        g.hidden = !open; btn.setAttribute('aria-expanded', String(open));
        if (open) list.scrollTop = 0;
        return;
      }
      if (btn.dataset.gsChip !== undefined) {
        for (const c of el.querySelectorAll('[data-gs-chip]')) c.setAttribute('aria-pressed', String(c === btn));
        /** @type {HTMLElement} */ (el.querySelector('[data-gs-rows]')).innerHTML = listHtml(btn.dataset.gsChip);
        list.scrollTop = 0;
      }
    });
    void enter(win); void enter(el, 'fade');
    /** @type {HTMLElement} */ (el.querySelector('[data-gs-cancel]')).focus();
  });
}
