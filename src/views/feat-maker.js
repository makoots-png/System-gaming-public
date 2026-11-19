// feat-maker.js: the GM's feat maker (feature 1's notes 5.3), opened from the Workshop's Feats. One form through
// `app.api.maker.open`: the name, the window's title, what the player reads, what is counted (a kind of fact, up to four
// tests of its fields, what to count of them), the number that earns it, its window, when it is shown, and its reward
// (the reward editor). Every choice is offered from core's tables (`FACT_FIELDS`, `opsFor`, `WITHINS`, `FEAT_BOUNDS`),
// so a field a kind lacks cannot be picked; Save runs `parseFeat` and writes what it gives back (`saveFeat`). No rule of
// the game is here.
import { esc, field } from './ui.js';
import { FACT_FIELDS } from '../core/hunter/facts.ts';
import { MEASURES, TESTS_MAX, WITHINS, opsFor } from '../core/hunter/counts.ts';
import { FACT_KIND_WORDS, FEAT_BOUNDS, MEASURE_WORDS, WITHIN_WORDS, afterChoices, freeFeatKey, parseFeat, ruleLine } from '../core/hunter/feats.ts';
import { BUILT_IN_FEATS } from '../core/registry/feats.ts';
import { RANKS } from '../core/rules.ts';
import { grantLines } from '../core/rewards.ts';
import { LIMITS } from '../core/save.ts';
import { saveFeat } from '../core/library.ts';
import { atLibrary } from '../core/save-step.ts';

const KINDS = Object.keys(FACT_FIELDS);
const OP_WORDS = { '>=': 'at least', '<=': 'at most', '=': 'is' };
const SHOWS = [['start', 'From the start'], ['count', 'After a count'], ['feat', 'After another feat'], ['never', 'Hidden until earned']];

// A condition is two rows: its field and Remove, then the comparison and the value; what is counted and of which field share a row.
const CSS = `
.fm-tests{display:flex;flex-direction:column;gap:8px}.fm-tests:empty{display:none}
.fm-test{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr) var(--control-h);gap:6px;padding:6px;border:1px solid var(--line)}
.fm-test [data-tf]{grid-column:1/3}.fm-test [data-trm]{grid-column:3;grid-row:1}.fm-test [data-to]{grid-column:1}.fm-test [data-tv]{grid-column:2/4}
.fm-row{display:flex;gap:8px;align-items:flex-end}.fm-row>*{flex:1 1 0;min-width:0}.fm-row>[data-mfield]:empty{display:none}
`;
/** The fields of fact kind `kind`: [name, spec]. */
const fieldsOf = kind => Object.entries(FACT_FIELDS[kind] || {});
/** The value control of a test of `spec`: a choice for a rank, a pick or a flag, else a box. */
function valueHtml(spec, value) {
  const opt = (v, l) => `<option value="${esc(v)}"${String(value) === String(v) ? ' selected' : ''}>${esc(l)}</option>`;
  if (spec.t === 'rank') return `<select data-tv aria-label="Value">${RANKS.map(r => opt(r, r)).join('')}</select>`;
  if (spec.t === 'pick') return `<select data-tv aria-label="Value">${spec.of.map(v => opt(v, v)).join('')}</select>`;
  if (spec.t === 'flag') return `<select data-tv aria-label="Value">${opt('true', 'yes')}${opt('false', 'no')}</select>`;
  return `<input data-tv aria-label="Value" ${spec.t === 'num' ? `type="number" inputmode="numeric" min="${spec.min}" max="${spec.max}"` : `type="text" maxlength="${spec.max}"`} value="${esc(value ?? '')}">`;
}
/** One test row of kind `kind`: its field, its comparison and its value. */
function testHtml(kind, t) {
  const fields = fieldsOf(kind), name = t && fields.some(([f]) => f === t.field) ? t.field : fields[0][0], spec = FACT_FIELDS[kind][name];
  const ops = opsFor(spec), op = t && ops.includes(t.op) ? t.op : ops[0];
  return `<div class="fm-test" data-test>
    <select data-tf aria-label="Field">${fields.map(([f, s]) => `<option value="${esc(f)}"${f === name ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
    <button type="button" class="icon-btn" data-trm aria-label="Remove this condition">&times;</button>
    <select data-to aria-label="Comparison">${ops.map(o => `<option value="${esc(o)}"${o === op ? ' selected' : ''}>${esc(OP_WORDS[o])}</option>`).join('')}</select>
    ${valueHtml(spec, t ? t.value : '')}</div>`;
}
/** A test row's value as its field's spec reads it. */
function readValue(spec, raw) {
  if (spec.t === 'num') return raw === '' ? null : Number(raw);
  if (spec.t === 'flag') return raw === 'true';
  return raw;
}

/**
 * The feat maker for the library's feat `key` (a built-in's key edits that built-in), or a new one when null. Answers
 * the key it saved under, or null.
 * @param {import('./app.ts').App} app @param {string | null} key
 */
export function featMaker(app, key) {
  const A = app.api, store = app.store, lib = store.get().library;
  app.ui.css('feat-maker', CSS);
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
        <div class="lbl">Counts</div>
        ${field('What happened', `<select id="fm-kind">${KINDS.map(k => `<option value="${esc(k)}"${k === rule.on ? ' selected' : ''}>${esc(FACT_KIND_WORDS[k])}</option>`).join('')}</select>`)}
        <div class="lbl" id="fm-tests-l">Only when</div>
        <div class="fm-tests" data-tests role="group" aria-labelledby="fm-tests-l">${rule.where.map(t => testHtml(rule.on, t)).join('')}</div>
        <button type="button" data-tadd>Add a condition</button>
        <div class="fm-row">${field('Count', `<select id="fm-measure">${MEASURES.map(m => `<option value="${m}"${m === rule.measure.of ? ' selected' : ''}>${esc(MEASURE_WORDS[m])}</option>`).join('')}</select>`)}
          <span data-mfield>${rule.measure.of === 'facts' ? '' : measureField(rule.on, rule.measure.of, /** @type {any} */ (rule.measure).field)}</span></div>
        ${field('Earned at', `<input type="number" id="fm-reach" inputmode="numeric" min="1" max="${FEAT_BOUNDS.reach}" value="${esc(rule.reach)}">`)}
        <div class="lbl">Within</div>${A.maker.chips('within', WITHINS.map(w => [w, WITHIN_WORDS[w]]), rule.within, { label: 'Within' })}
        <div class="lbl">Shown to the player</div>${A.maker.chips('show', SHOWS, show.at, { label: 'Shown to the player' })}
        <div data-show="count"${show.at === 'count' ? '' : ' hidden'}>${field('Shown once the count reaches', `<input type="number" id="fm-shown" inputmode="numeric" min="1" value="${esc(show.at === 'count' ? /** @type {any} */ (show).n : 1)}">`)}</div>
        <div data-show="feat"${show.at === 'feat' ? '' : ' hidden'}>${field('Shown once this feat is earned', `<select id="fm-after">${afterChoices(BUILT_IN_FEATS, lib.feats, key, after)
          .map(([k, n]) => `<option value="${esc(k)}"${k === after ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`)}</div>
        <div class="lbl">Reward</div><div data-fm-rw data-later></div>`;
      /** The field a sum, a highest or a count of different values reads: a number's for the first two, any for the last. */
      function measureField(kind, m, sel) {
        const nums = fieldsOf(kind).filter(([, s]) => m === 'distinct' || s.t === 'num');
        return `<select id="fm-mfield" aria-label="Of">${nums.map(([f, s]) => `<option value="${esc(f)}"${f === sel ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select>`;
      }
      const ed = A.maker.rewards(body.querySelector('[data-fm-rw]'), { initial: d ? d.rewards : undefined, bundles: false });
      const kind = () => body.querySelector('#fm-kind').value;
      const redrawMeasure = () => { const m = body.querySelector('#fm-measure').value; body.querySelector('[data-mfield]').innerHTML = m === 'facts' ? '' : measureField(kind(), m, null); };
      body.addEventListener('change', e => {
        const t = e.target;
        if (t.id === 'fm-kind') { body.querySelector('[data-tests]').innerHTML = ''; redrawMeasure(); }
        else if (t.id === 'fm-measure') redrawMeasure();
        else if (t.matches('[data-tf]')) { const row = t.closest('[data-test]'); row.outerHTML = testHtml(kind(), { field: t.value }); }
        shell.changed();
      });
      body.addEventListener('click', e => {
        const t = e.target.closest('button'); if (!t) return;
        if (t.hasAttribute('data-tadd') && body.querySelectorAll('[data-test]').length < TESTS_MAX) body.querySelector('[data-tests]').insertAdjacentHTML('beforeend', testHtml(kind(), null));
        else if (t.hasAttribute('data-trm')) t.closest('[data-test]').remove();
        else if (t.closest('[data-chips="show"]')) queueMicrotask(() => { body.querySelectorAll('[data-show]').forEach(el => { el.hidden = el.dataset.show !== A.maker.picked(body, 'show'); }); });
        shell.changed();
      });
      /** The form as raw data, for the parser. */
      function raw() {
        const k = kind(), where = [...body.querySelectorAll('[data-test]')].map(r => {
          const f = r.querySelector('[data-tf]').value, spec = FACT_FIELDS[k][f];
          return { field: f, op: r.querySelector('[data-to]').value, value: readValue(spec, r.querySelector('[data-tv]').value) };
        });
        const m = body.querySelector('#fm-measure').value, mf = body.querySelector('#fm-mfield');
        const at = A.maker.picked(body, 'show') || 'never';
        return {
          name: body.querySelector('#fm-name').value, window: body.querySelector('#fm-window').value, desc: body.querySelector('#fm-desc').value,
          rule: { on: k, where, measure: m === 'facts' ? { of: 'facts' } : { of: m, field: mf ? mf.value : '' }, within: A.maker.picked(body, 'within') || 'ever', reach: Number(body.querySelector('#fm-reach').value), also: d ? d.rule.also : [] },
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
          const L = store.get().library;
          const at = key || freeFeatKey(f.name, k => Object.hasOwn(L.feats, k) || BUILT_IN_FEATS.some(([b]) => b === k));
          const done = store.apply('library-feat', atLibrary(l => saveFeat(l, at, f)));
          if (!done.ok) { shell.error(`The library holds ${LIMITS.libraryFeats} feats at most.`); return undefined; }
          return at;
        },
      };
    },
  });
}
