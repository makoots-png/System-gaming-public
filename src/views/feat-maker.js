// feat-maker.js: the GM's feat maker (feature 1's notes 5.3), opened from the Workshop's Feats. One form through
// `app.api.maker.open`: the name, the window's title, what the player reads, what is counted (a kind of fact, up to four
// tests of its fields, what to count of them), the number that earns it, its window, when it is shown, and its reward
// (the reward editor). Every choice is offered from core's tables (`FACT_FIELDS`, `opsFor`, `measuresFor`, `WITHINS`,
// `FEAT_BOUNDS`), so a field or a measure a kind lacks cannot be picked; Save runs `parseFeat` and writes what it gives
// back (`saveFeat`). No rule of the game is here.
import { esc, field, wrote } from './ui.js';
import { COUNT_CSS, countFields } from './count-fields.js';
import { WITHINS } from '../core/hunter/counts.ts';
import { FEAT_BOUNDS, WITHIN_WORDS, afterChoices, parseFeat, ruleLine } from '../core/hunter/feats.ts';
import { BUILT_IN_FEATS } from '../core/registry/feats.ts';
import { grantLines } from '../core/rewards.ts';
import { newFeatKey, saveFeat, savedWords } from '../core/library.ts';
import { atLibrary } from '../core/save-step.ts';

const SHOWS = [['start', 'From the start'], ['count', 'After a count'], ['feat', 'After another feat'], ['never', 'Hidden until earned']];

/**
 * The feat maker for the library's feat `key` (a built-in's key edits that built-in), or a new one when null. Answers
 * the key it saved under, or null.
 * @param {import('./app.ts').App} app @param {string | null} key
 */
export function featMaker(app, key) {
  const A = app.api, store = app.store, lib = store.get().library;
  app.ui.css('count-fields', COUNT_CSS);
  const built = key ? BUILT_IN_FEATS.find(([k]) => k === key) : null;
  const d = key ? lib.feats[key] || (built ? built[1] : null) : null;
  return A.maker.open({
    tag: 'Workshop', title: d ? `Edit ${d.name}` : 'New feat', save: 'Save feat', cls: 'fm',
    build(body, shell) {
      const rule = d ? d.rule : { on: 'kill', where: [], measure: { of: 'facts' }, within: 'ever', reach: 1 };
      const show = d ? d.show : { at: 'never' };
      const after = show.at === 'feat' ? /** @type {any} */ (show).key : null;
      body.innerHTML = `${field('Name', `<input type="text" id="fm-name" maxlength="${FEAT_BOUNDS.name}" autocomplete="off" value="${esc(d ? d.name : '')}">`)}
        ${field('Window title', `<input type="text" id="fm-window" maxlength="${FEAT_BOUNDS.window}" autocomplete="off" value="${esc(d ? d.window : '')}">`)}
        ${field('What the player reads', `<input type="text" id="fm-desc" maxlength="${FEAT_BOUNDS.desc}" autocomplete="off" value="${esc(d ? d.desc : '')}">`)}
        <div class="lbl">Counts</div><div data-fm-count></div>
        ${field('Earned at', `<input type="number" id="fm-reach" inputmode="numeric" min="1" max="${FEAT_BOUNDS.reach}" value="${esc(rule.reach)}">`)}
        <div class="lbl">Within</div>${A.maker.chips('within', WITHINS.map(w => [w, WITHIN_WORDS[w]]), rule.within, { label: 'Within' })}
        <div class="lbl">Shown to the player</div>${A.maker.chips('show', SHOWS, show.at, { label: 'Shown to the player' })}
        <div data-show="count"${show.at === 'count' ? '' : ' hidden'}>${field('Shown once the count reaches', `<input type="number" id="fm-shown" inputmode="numeric" min="1" value="${esc(show.at === 'count' ? /** @type {any} */ (show).n : 1)}">`)}</div>
        <div data-show="feat"${show.at === 'feat' ? '' : ' hidden'}>${field('Shown once this feat is earned', `<select id="fm-after">${afterChoices(BUILT_IN_FEATS, lib.feats, key, after)
          .map(([k, n]) => `<option value="${esc(k)}"${k === after ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`)}</div>
        <div class="lbl">Reward</div><div data-fm-rw data-later></div>`;
      const ed = A.maker.rewards(body.querySelector('[data-fm-rw]'), { initial: d ? d.rewards : undefined, bundles: false });
      const count = countFields(body.querySelector('[data-fm-count]'), { id: 'fm', initial: rule, within: false, changed: () => shell.changed() });
      body.addEventListener('change', () => shell.changed());
      body.addEventListener('click', e => {
        const t = e.target.closest('button'); if (!t || t.closest('[data-fm-count]')) return;
        if (t.closest('[data-chips="show"]')) queueMicrotask(() => { body.querySelectorAll('[data-show]').forEach(el => { el.hidden = el.dataset.show !== A.maker.picked(body, 'show'); }); });
        shell.changed();
      });
      /** The form as raw data, for the parser. */
      function raw() {
        const at = A.maker.picked(body, 'show') || 'never';
        return {
          name: body.querySelector('#fm-name').value, window: body.querySelector('#fm-window').value, desc: body.querySelector('#fm-desc').value,
          rule: { ...count.value(String(A.maker.picked(body, 'within') || 'ever')), reach: Number(body.querySelector('#fm-reach').value), also: d ? d.rule.also : [] },
          show: at === 'count' ? { at, n: Number(body.querySelector('#fm-shown').value) } : at === 'feat' ? { at, key: body.querySelector('#fm-after').value } : { at }, rewards: ed.value(),
          ...(d && d.off ? { off: true } : {}),
        };
      }
      /** What the form still needs when the parser refuses it, in the words of its labels: an empty value is the only test value it refuses. */
      const needs = () => (body.querySelector('#fm-name').value.trim() ? 'Give each condition under Only when a value.' : 'Give the feat a name.');
      return {
        blocked: () => ed.blocked(),
        preview() { const f = parseFeat(raw()); return f ? [ruleLine(f.rule), ...grantLines(app.rules(), f.rewards)] : [needs()]; },
        save() {
          const f = parseFeat(raw());
          if (!f) { shell.error(needs()); return undefined; }
          const at = key || newFeatKey(store.get().library, f.name);
          if (!wrote('Workshop', store.apply('library-feat', atLibrary(l => saveFeat(l, at, f))), savedWords('feat', f.name))) return undefined;
          return at;
        },
      };
    },
  });
}
