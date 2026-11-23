// count-fields.js: the controls of what the System counts (a `FactCount`, src/core/hunter/counts.ts), drawn in a box its
// caller owns. Two callers: the feat maker (feat-maker.js), whose count earns a feat, and a quest's objective in the one
// quest form (quest-fields.js), whose count moves the objective (feature 1's notes 17.14). What happened (a kind of fact),
// up to four conditions on its fields, what to count of them and, for an objective, the window it counts in. Every
// choice is offered from core's tables (`FACT_FIELDS`, `opsFor`, `measuresFor`, `WITHINS`), so a field or a measure a
// kind lacks cannot be picked; what it answers is raw, for `parseCount`. No rule of the game is here.
import { esc, field } from './ui.js';
import { FACT_FIELDS } from '../core/hunter/facts.ts';
import { TESTS_MAX, WITHINS, measureFields, measuresFor, opsFor } from '../core/hunter/counts.ts';
import { FACT_KIND_WORDS, MEASURE_WORDS, WITHIN_WORDS } from '../core/hunter/feats.ts';
import { RANKS } from '../core/rules.ts';

export const KINDS = Object.keys(FACT_FIELDS);
const OP_WORDS = { '>=': 'at least', '<=': 'at most', '=': 'is' };
const PICK_LABELS = {
  won: 'Won', lost: 'Lost', ended: 'Ended early', stalled: 'Stalled',
  normal: 'Normal', elite: 'Elite', boss: 'Boss', mythic: 'Mythic',
  fight: 'Fight', solo: 'Solo run', up: 'Alive', dead: 'Dead',
  done: 'Completed', failed: 'Failed',
  daily: 'Daily', main: 'Main', side: 'Side', job: 'Job Change', urgent: 'Urgent', penalty: 'Penalty',
  gm: 'GM', system: 'The System', self: 'Player', item: 'Item', hand: 'Manual edit',
  died: 'Died', raised: 'Revived', buy: 'Bought', sell: 'Sold',
  common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary',
};

// A condition is two rows: its field and Remove, then the comparison and the value; what is counted and of which field share a row.
export const COUNT_CSS = `
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
  if (spec.t === 'pick') return `<select data-tv aria-label="Value">${spec.of.map(v => opt(v, PICK_LABELS[v] || v)).join('')}</select>`;
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
/** The Count choices of kind `kind` (`measuresFor`), `of` chosen when the kind takes it, else Each time. */
function measureOptions(kind, of) {
  const ms = measuresFor(kind), sel = ms.includes(of) ? of : 'facts';
  return ms.map(m => `<option value="${m}"${m === sel ? ' selected' : ''}>${esc(MEASURE_WORDS[m])}</option>`).join('');
}
/** The field select of measure `m` on kind `kind` (`measureFields`), `sel` chosen when it is one of them. */
function measureField(id, kind, m, sel) {
  return `<select id="${esc(id)}-mfield" data-mf aria-label="Field to count">${measureFields(kind, m).map(f => `<option value="${esc(f)}"${f === sel ? ' selected' : ''}>${esc(FACT_FIELDS[kind][f].label)}</option>`).join('')}</select>`;
}
/** A test row's value as its field's spec reads it. */
function readValue(spec, raw) {
  if (spec.t === 'num') return raw === '' ? null : Number(raw);
  if (spec.t === 'flag') return raw === 'true';
  return raw;
}

/**
 * The count's controls in `box`, from `initial` (a `FactCount`, or a kill count when null). `id` names its selects
 * (`<id>-kind`, `<id>-measure`, `<id>-mfield`, `<id>-within`). `within`: draw the window as a select (an objective's);
 * the feat maker draws its own. `changed` is called on every change. Answers the count as raw data and its kind.
 * @param {HTMLElement} box @param {{ id: string; initial: any; within: boolean; changed?: () => void }} o
 */
export function countFields(box, o) {
  const id = o.id, rule = o.initial || { on: 'kill', where: [], measure: { of: 'facts' }, within: 'ever' };
  box.innerHTML = `${field('Event to track', `<select id="${esc(id)}-kind" data-ck>${KINDS.map(k => `<option value="${esc(k)}"${k === rule.on ? ' selected' : ''}>${esc(FACT_KIND_WORDS[k])}</option>`).join('')}</select>`)}
    <div class="lbl" id="${esc(id)}-tests-l">Only when</div>
    <div class="fm-tests" data-tests role="group" aria-labelledby="${esc(id)}-tests-l">${rule.where.map(t => testHtml(rule.on, t)).join('')}</div>
    <button type="button" data-tadd>Add a condition</button>
    <div class="fm-row">${field('How to count', `<select id="${esc(id)}-measure" data-cm>${measureOptions(rule.on, rule.measure.of)}</select>`)}
      <span data-mfield>${rule.measure.of === 'facts' ? '' : measureField(id, rule.on, rule.measure.of, rule.measure.field)}</span></div>
    ${o.within ? field('Time window', `<select id="${esc(id)}-within" data-cw>${WITHINS.map(w => `<option value="${w}"${w === rule.within ? ' selected' : ''}>${esc(WITHIN_WORDS[w])}</option>`).join('')}</select>`) : ''}`;
  const $ = sel => box.querySelector(sel);
  const kind = () => $('[data-ck]').value;
  const redrawMeasure = () => {
    const m = $('[data-cm]').value, was = $('[data-mf]');
    $('[data-mfield]').innerHTML = m === 'facts' ? '' : measureField(id, kind(), m, was ? was.value : null);
  };
  box.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-ck]')) { const ms = $('[data-cm]'); $('[data-tests]').innerHTML = ''; ms.innerHTML = measureOptions(kind(), ms.value); redrawMeasure(); }
    else if (t.matches('[data-cm]')) redrawMeasure();
    else if (t.matches('[data-tf]')) { const row = t.closest('[data-test]'); row.outerHTML = testHtml(kind(), { field: t.value }); }
    if (o.changed) o.changed();
  });
  box.addEventListener('click', e => {
    const t = /** @type {Element} */ (e.target).closest('button'); if (!t || !box.contains(t)) return;
    if (t.hasAttribute('data-tadd') && box.querySelectorAll('[data-test]').length < TESTS_MAX) $('[data-tests]').insertAdjacentHTML('beforeend', testHtml(kind(), null));
    else if (t.hasAttribute('data-trm')) t.closest('[data-test]').remove();
    else return;
    if (o.changed) o.changed();
  });
  /** The count as raw data, for `parseCount`; `within` is the select's, or `fallback` where the caller draws its own. */
  function value(fallback = 'ever') {
    const k = kind(), where = [...box.querySelectorAll('[data-test]')].map(r => {
      const f = r.querySelector('[data-tf]').value, spec = FACT_FIELDS[k][f];
      return { field: f, op: r.querySelector('[data-to]').value, value: readValue(spec, r.querySelector('[data-tv]').value) };
    });
    const m = $('[data-cm]').value, mf = $('[data-mf]'), w = $('[data-cw]');
    return { on: k, where, measure: m === 'facts' ? { of: 'facts' } : { of: m, field: mf ? mf.value : '' }, within: w ? w.value : fallback };
  }
  return { value, kind };
}
