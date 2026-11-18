// feat-maker.js: the GM's feat maker (feature 1's notes 5.3), opened from the Workshop's Feats. One form through
// `app.api.maker.open`: the name, the window's title, what the player reads, what is counted (a kind of fact, up to four
// tests of its fields, what to count of them), the number that earns it, its window, when it is shown, and its reward
// (the reward editor). Every choice is offered from core's tables (`FACT_FIELDS`, `opsFor`, `WITHINS`, `FEAT_BOUNDS`),
// so a field a kind lacks cannot be picked; Save runs `parseFeat` and writes what it gives back (`saveFeat`). No rule of
// the game is here.
import { esc, field } from './ui.js';
import { FACT_FIELDS } from '../core/hunter/facts.ts';
import { MEASURES, TESTS_MAX, WITHINS, opsFor } from '../core/hunter/counts.ts';
import { FACT_KIND_WORDS, FEAT_BOUNDS, MEASURE_WORDS, WITHIN_WORDS, freeFeatKey, parseFeat, ruleLine } from '../core/hunter/feats.ts';
import { BUILT_IN_FEATS } from '../core/registry/feats.ts';
import { RANKS } from '../core/rules.ts';
import { grantLines } from '../core/rewards.ts';
import { LIMITS } from '../core/save.ts';
import { saveFeat } from '../core/library.ts';
import { atLibrary } from '../core/save-step.ts';

const KINDS = Object.keys(FACT_FIELDS);
const OP_WORDS = { '>=': 'at least', '<=': 'at most', '=': 'is' };
const SHOWS = [['start', 'From the start'], ['count', 'After a count'], ['never', 'Hidden until earned']];

/** The fields of fact kind `kind`: [name, spec]. */
const fieldsOf = kind => Object.entries(FACT_FIELDS[kind] || {});
/** The value control of a test of `spec`: a choice for a rank, a pick or a flag, else a box. */
function valueHtml(spec, value) {
  const opt = (v, l) => `<option value="${esc(v)}"${String(value) === String(v) ? ' selected' : ''}>${esc(l)}</option>`;
  if (spec.t === 'rank') return `<select data-tv>${RANKS.map(r => opt(r, r)).join('')}</select>`;
  if (spec.t === 'pick') return `<select data-tv>${spec.of.map(v => opt(v, v)).join('')}</select>`;
  if (spec.t === 'flag') return `<select data-tv>${opt('true', 'yes')}${opt('false', 'no')}</select>`;
  return `<input data-tv ${spec.t === 'num' ? `type="number" inputmode="numeric" min="${spec.min}" max="${spec.max}"` : `type="text" maxlength="${spec.max}"`} value="${esc(value ?? '')}">`;
}
/** One test row of kind `kind`: its field, its comparison and its value. */
function testHtml(kind, t) {
  const fields = fieldsOf(kind), name = t && fields.some(([f]) => f === t.field) ? t.field : fields[0][0], spec = FACT_FIELDS[kind][name];
  const ops = opsFor(spec), op = t && ops.includes(t.op) ? t.op : ops[0];
  return `<div class="fm-test" data-test>
    <select data-tf aria-label="Field">${fields.map(([f, s]) => `<option value="${esc(f)}"${f === name ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
    <select data-to aria-label="Comparison">${ops.map(o => `<option value="${esc(o)}"${o === op ? ' selected' : ''}>${esc(OP_WORDS[o])}</option>`).join('')}</select>
    ${valueHtml(spec, t ? t.value : '')}
    <button type="button" class="quiet" data-trm aria-label="Remove this test">Remove</button></div>`;
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
  const built = key ? BUILT_IN_FEATS.find(([k]) => k === key) : null;
  const d = key ? lib.feats[key] || (built ? built[1] : null) : null;
  return A.maker.open({
    tag: 'Workshop', title: d ? `Edit ${d.name}` : 'New feat', save: 'Save feat', cls: 'fm',
    build(body, shell) {
      const rule = d ? d.rule : { on: 'kill', where: [], measure: { of: 'facts' }, within: 'ever', reach: 1 };
      const show = d ? d.show : { at: 'never' };
      body.innerHTML = `${field('Name', `<input type="text" id="fm-name" maxlength="${FEAT_BOUNDS.name}" autocomplete="off" value="${esc(d ? d.name : '')}">`)}
        ${field('Window title', `<input type="text" id="fm-window" maxlength="${FEAT_BOUNDS.window}" autocomplete="off" value="${esc(d ? d.window : '')}">`)}
        ${field('What the player reads', `<input type="text" id="fm-desc" maxlength="${FEAT_BOUNDS.desc}" autocomplete="off" value="${esc(d ? d.desc : '')}">`)}
        <div class="lbl">Counts</div>
        ${field('What happened', `<select id="fm-kind">${KINDS.map(k => `<option value="${esc(k)}"${k === rule.on ? ' selected' : ''}>${esc(FACT_KIND_WORDS[k])}</option>`).join('')}</select>`)}
        <div data-tests>${rule.where.map(t => testHtml(rule.on, t)).join('')}</div>
        <button type="button" data-tadd>Add a test</button>
        <div class="fm-row">${field('Count', `<select id="fm-measure">${MEASURES.map(m => `<option value="${m}"${m === rule.measure.of ? ' selected' : ''}>${esc(MEASURE_WORDS[m])}</option>`).join('')}</select>`)}
          <span data-mfield>${rule.measure.of === 'facts' ? '' : measureField(rule.on, rule.measure.of, /** @type {any} */ (rule.measure).field)}</span></div>
        ${field('Earned at', `<input type="number" id="fm-reach" inputmode="numeric" min="1" max="${FEAT_BOUNDS.reach}" value="${esc(rule.reach)}">`)}
        <div class="lbl">Within</div>${A.maker.chips('within', WITHINS.map(w => [w, WITHIN_WORDS[w]]), rule.within, { label: 'Within' })}
        <div class="lbl">Shown to the player</div>${A.maker.chips('show', SHOWS, show.at === 'feat' ? 'never' : show.at, { label: 'Shown to the player' })}
        <div data-showcount${show.at === 'count' ? '' : ' hidden'}>${field('Shown once the count reaches', `<input type="number" id="fm-shown" inputmode="numeric" min="1" value="${esc(show.at === 'count' ? /** @type {any} */ (show).n : 1)}">`)}</div>
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
        else if (t.closest('[data-chips="show"]')) queueMicrotask(() => { body.querySelector('[data-showcount]').hidden = A.maker.picked(body, 'show') !== 'count'; });
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
          show: at === 'count' ? { at, n: Number(body.querySelector('#fm-shown').value) } : { at }, rewards: ed.value(),
        };
      }
      return {
        blocked: () => ed.blocked(),
        preview() { const f = parseFeat(raw()); return f ? [ruleLine(f.rule), ...grantLines(app.rules(), f.rewards)] : ['Name the feat and finish its tests.']; },
        save() {
          const f = parseFeat(raw());
          if (!f) { shell.error(body.querySelector('#fm-name').value.trim() ? 'Finish each test: a value its field can hold.' : 'Name the feat.'); return undefined; }
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
