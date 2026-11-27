// kit-parts.js: the kits' groups of a status def in a maker (docs/agent-handoff/kits/design.md sections 5.1 and 8.12):
// Stacks (a cap, how stacks leave, whose count it is, and what a count sets off), When something happens (the triggers)
// and When it ends (the delayed effect). The status maker (forge.js) holds them, and so does the worn status of a passive
// skill (skills.js) and an item (loot.js). Each group is a collapsed `.mk-group` with one line when set. No rule lives
// here: what a def means is `describeStatus`, and the maker saves what `parseStatusDef` gives back.
import { esc } from './ui.js';
import { rules } from '../edge/rules.ts';
import { parseFormula, printFormula } from '../core/formula.ts';
import { BEARER_EVENTS, PARTY_EVENTS } from '../core/combat/triggers.ts';
import { isStateChip } from '../core/hunter/chips.ts';
import { MAX_STATUSES } from '../core/combat/fight-types.ts';

/** Each bearer event as the GM reads it, after "When its bearer"; the low share is the rule's (`kit.lowHpAt`). */
const eventLabels = () => ({
  hitDealt: 'deals a hit', struck: 'is struck', critDealt: 'crits', critTaken: 'takes a crit', kill: 'kills a foe', avoided: 'avoids an ability',
  turnStart: 'starts its turn', turnEnd: 'ends its turn', moved: 'moves', down: 'reaches 0 HP',
  lowHp: `falls under ${Math.round(rules().fight.kit.lowHpAt * 100)}% HP`, imposed: 'puts a harmful status on a foe',
  statusGained: 'gains a status', statusEnded: 'loses a status', used: 'uses an ability tagged',
});
const TRIGGER_EVENTS = [...BEARER_EVENTS, 'statusGained', 'statusEnded', 'used'];
const LEAVE_LABEL = [['never', 'Never'], ['round', 'One per round'], ['event', 'On an event']];
const KEEP_LABEL = [['fight', 'Cleared'], ['sheet', 'Kept on sheet']];
const AT_LABEL = [['count', 'Stack count'], ['formula', 'Formula']];
const REACH_LABEL = [['bearer', 'The bearer'], ['area', 'An area']];
const THEN_LABEL = [['spend', 'Spent'], ['keep', 'Kept']];
const ON_LABEL = [['all', 'Everyone'], ['allies', 'Allies'], ['foes', 'Foes']];
const LIMIT_LABEL = [['each', 'Every time'], ['round', 'Once per round'], ['fight', 'Limited per fight']];
const CLEANSE_LABEL = [['cancel', 'Cancels the effect'], ['land', 'Triggers immediately']];
const TAG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** @type {readonly string[]} */
const PARTY = PARTY_EVENTS;

/**
 * The triggers of a status def or of a field (whose triggers its hold carries: kits design 1.3.2), in `host`: one box
 * each, at most `kit.triggers`, from `triggers`. `who` names the body that fires them in the event's words ("its
 * bearer", "one inside it"). `M` is app.api.maker; `name` keeps its chip groups apart from another list's. It raises
 * `input` on `host` after a change of its own.
 * @param {HTMLElement} host @param {readonly any[]} triggers @param {any} M @param {string} name @param {string} who
 */
export function triggerList(host, triggers, M, name, who) {
  const R = rules(), K = R.fight.kit;
  const statuses = () => Object.entries(rules().conditions).filter(([k]) => !isStateChip(k)).map(([k, d]) => [k, String((d && d.label) || k)]);
  const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
  const numIn = (attr, label, value) => `<label class="field"><span class="lbl">${esc(label)}</span><input type="number" inputmode="numeric" step="1" ${attr} value="${esc(value)}"></label>`;
  host.innerHTML = `<div class="mk-trigs" data-trigs></div><button type="button" class="mk-add" data-add-trig>Add a trigger</button>`;
  const raise = () => host.dispatchEvent(new Event('input', { bubbles: true }));
  /** @type {{ el: HTMLElement; fx: any; id: string; need: any; wasTo: any; event: string }[]} */
  const trigs = [];
  let made = 0;
  function addTrig(t) {
    const id = `${name}${made++}`, el = document.createElement('div');
    const to = t ? t.to : 'self', limit = t ? t.limit : { kind: 'each' };
    el.className = 'mk-fx mk-trig';
    el.innerHTML = `<div class="mk-fx-top"><select data-tk="on" aria-label="When">${TRIGGER_EVENTS.map(e => opt(e, `When ${who} ${eventLabels()[e]}`, t ? t.on : 'hitDealt')).join('')}</select>
        <button type="button" class="icon-btn" data-rm-trig aria-label="Remove trigger">&times;</button></div>
      <label class="field" data-tf="tag"><span class="lbl" data-tag-lbl>Only abilities tagged (optional)</span><input type="text" maxlength="${K.tagLength}" autocomplete="off" spellcheck="false" data-tk="tag" aria-label="Ability tag" placeholder="sword" value="${esc(t && t.tag ? t.tag : '')}"></label>
      <label class="field" data-tf="key"><span class="lbl">Which status</span><select data-tk="key" data-pick aria-label="Which status">${statuses().map(([k, l]) => opt(k, l, t && t.key)).join('')}</select></label>
      <div class="lbl">How often</div>${M.chips(`${id}-limit`, LIMIT_LABEL, limit.kind, { label: 'How often' })}
      <div data-tf="n">${numIn(`data-tk="n" min="1" max="${K.fightUses}" aria-label="Uses per fight"`, `Uses per fight (1 to ${K.fightUses})`, limit.kind === 'fight' ? limit.n : 1)}</div>
      <div class="lbl">Applies to</div>${M.chips(`${id}-to`, [['self', who === 'its bearer' ? 'The bearer' : 'That creature'], ['other', 'The other creature'], ['area', 'An area']], typeof to === 'string' ? to : 'area', { label: 'Applies to' })}
      <div class="mk-two" data-tf="area">${numIn(`data-tk="radius" min="1" max="${R.fight.fieldRadiusMax}" aria-label="Radius in tiles"`, 'Radius (tiles)', typeof to === 'object' ? to.radius : 2)}
        <div><div class="lbl">Affects</div>${M.chips(`${id}-on`, ON_LABEL, typeof to === 'object' ? to.on : 'foes', { label: 'Who it affects' })}</div></div>
      <div class="lbl">Effects to apply</div><div data-tfx></div>
      <p class="mk-fx-err" data-terr role="alert"></p>`;
    host.querySelector('[data-trigs]').appendChild(el);
    const fx = M.effects(el.querySelector('[data-tfx]'), { ops: t ? t.ops : [], kind: 'land', event: t ? t.on : 'hitDealt' });
    trigs.push({ event: t ? t.on : 'hitDealt', el, fx, id, need: t && t.need ? t.need : null, wasTo: t ? t.to : null });
  }
  triggers.forEach(addTrig);
  /** A trigger as its box holds it, or the words of what is wrong. */
  function readTrig(t) {
    const q = s => t.el.querySelector(s), ev = q('[data-tk="on"]').value, party = PARTY.includes(ev);
    const lk = M.picked(t.el, `${t.id}-limit`) || 'each', toK = M.picked(t.el, `${t.id}-to`) || 'self';
    const n = Math.trunc(Number(q('[data-tk="n"]').value)), radius = Math.trunc(Number(q('[data-tk="radius"]').value));
    if (lk === 'fight' && !(n >= 1 && n <= K.fightUses)) return { err: `Uses per fight must be from 1 to ${K.fightUses}.` };
    if (toK === 'area' && !(radius >= 1 && radius <= R.fight.fieldRadiusMax)) return { err: `Area radius must be from 1 to ${R.fight.fieldRadiusMax} tiles.` };
    if (toK === 'other' && !party) return { err: `Only a hit, crit, kill, dodge, or applied status has another creature. Pick ${who === 'its bearer' ? 'The bearer' : 'That creature'} or An area.` };
    const tag = q('[data-tk="tag"]').value.trim().toLowerCase();
    if (tag && !(TAG_RE.test(tag) && tag.length <= K.tagLength)) return { err: `A tag must be one word or hyphenated words, up to ${K.tagLength} characters.` };
    if (ev === 'used' && !tag) return { err: 'Enter the ability tag that triggers this.' };
    const ops = t.fx.ops();
    if (t.fx.blocked()) return { err: 'Fix the effect above.' };
    if (!ops.length) return { err: 'Add at least one effect.' };
    if (ops.length > K.triggerOps) return { err: `A trigger can have at most ${K.triggerOps} effects.` };
    const limit = lk === 'fight' ? { kind: 'fight', n } : { kind: lk === 'round' ? 'round' : 'each' };
    const areaOn = M.picked(t.el, `${t.id}-on`) || 'foes';
    const keepMost = toK === 'area' && t.wasTo && typeof t.wasTo === 'object' && t.wasTo.kind === 'most' && t.wasTo.radius === radius && t.wasTo.on === areaOn;
    const to = toK === 'area' ? (keepMost ? t.wasTo : { kind: 'area', radius, on: areaOn }) : toK;
    const base = { on: ev, to, limit, ops, ...(t.need ? { need: t.need } : {}) };
    if (party) return { trigger: { ...base, tag: tag || null } };
    if (ev === 'statusGained' || ev === 'statusEnded') { const key = q('[data-tk="key"]').value; return key ? { trigger: { ...base, key } } : { err: 'Pick a status.' }; }
    if (ev === 'used') return { trigger: { ...base, tag } };
    return { trigger: base };
  }

  /** Shows the fields each trigger's choices need, and whether another may be added. */
  function draw() {
    for (const t of trigs) {
      const ev = t.el.querySelector('[data-tk="on"]').value, party = PARTY.includes(ev);
      if (ev !== t.event) { t.event = ev; t.fx.setEvent(ev); }
      t.el.querySelector('[data-tf="tag"]').hidden = !(party || ev === 'used');
      t.el.querySelector('[data-tag-lbl]').textContent = ev === 'used' ? 'Ability tag' : 'Only abilities tagged (optional)';
      t.el.querySelector('[data-tf="key"]').hidden = !(ev === 'statusGained' || ev === 'statusEnded');
      t.el.querySelector('[data-tf="n"]').hidden = M.picked(t.el, `${t.id}-limit`) !== 'fight';
      t.el.querySelector('[data-tf="area"]').hidden = M.picked(t.el, `${t.id}-to`) !== 'area';
      const other = t.el.querySelector(`[data-chips="${t.id}-to"] [data-chip="other"]`);
      if (other) other.hidden = !party;
    }
    const full = trigs.length >= K.triggers, add = host.querySelector('[data-add-trig]');
    add.disabled = full; add.textContent = full ? `Add a trigger (max ${K.triggers})` : 'Add a trigger';
  }
  host.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !host.contains(b)) return;
    if (b.hasAttribute('data-add-trig')) { if (trigs.length < K.triggers) addTrig(null); draw(); raise(); return; }
    if (b.hasAttribute('data-rm-trig')) {
      const at = trigs.findIndex(t => t.el.contains(b));
      if (at >= 0) { trigs[at].el.remove(); trigs.splice(at, 1); }
      draw(); raise(); return;
    }
    if (b.closest('[data-chips]')) draw();
  });
  host.addEventListener('change', () => draw());
  host.addEventListener('input', e => { if (e.target !== host) draw(); });
  draw();
  return {
    /** The triggers the boxes hold (one with an error left out), each box's error shown, and the first error. */
    read() {
      const tr = trigs.map(readTrig);
      tr.forEach((r, i) => { trigs[i].el.querySelector('[data-terr]').textContent = r.err || ''; trigs[i].el.classList.toggle('bad', !!r.err); });
      return { triggers: tr.flatMap(r => (r.trigger ? [r.trigger] : [])), err: (tr.find(r => r.err) || {}).err || '' };
    },
    count: () => trigs.length,
  };
}

/**
 * The kits' groups of a status def in `box`, from `def` (absent fields are none). `M` is app.api.maker (its `chips`,
 * `picked` and `effects`); `name` keeps the chip groups of two of these in one window apart. It raises `input` on `box`
 * after a change of its own, so the shell redraws the preview.
 * @param {HTMLElement} box @param {any} def @param {any} M @param {string} name
 */
export function statusBlocks(box, def, M, name) {
  const R = rules(), K = R.fight.kit, st = def && def.stack, th = st && st.threshold;
  const c = n => `${name}-${n}`;
  const statuses = () => Object.entries(rules().conditions).filter(([k]) => !isStateChip(k)).map(([k, d]) => [k, String((d && d.label) || k)]);
  const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
  const numIn = (attr, label, value, o = {}) => `<label class="field"><span class="lbl">${esc(label)}</span><input type="number" inputmode="numeric" step="1" ${attr} value="${esc(value)}"${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ''}></label>`;
  const area = (pre, reach) => `<div class="mk-two" data-area="${pre}">${numIn(`data-k="${pre}-radius" min="1" max="${R.fight.fieldRadiusMax}" aria-label="Radius in tiles"`, 'Radius (tiles)', reach && reach.kind !== 'bearer' && typeof reach === 'object' ? reach.radius : 2)}
    <div><div class="lbl">Affects</div>${M.chips(c(`${pre}-on`), ON_LABEL, reach && typeof reach === 'object' && reach.kind !== 'bearer' ? reach.on : 'foes', { label: 'Who it affects' })}</div></div>`;
  box.innerHTML = `
    <details class="mk-group" data-group="stacks"><summary data-sum="stacks"></summary><div class="mk-group-body">
      <label class="mk-check"><input type="checkbox" data-k="stack"${st ? ' checked' : ''}><span>Can stack</span></label>
      <div data-stack-f>
        ${numIn(`data-k="cap" min="1" max="${K.stackCap}" aria-label="Max stacks"`, `Max stacks (1 to ${K.stackCap})`, st ? st.cap : 5)}
        <div class="lbl">How stacks expire</div>${M.chips(c('leave'), LEAVE_LABEL, st ? st.leave.kind : 'never', { label: 'How stacks expire' })}
        <label class="field" data-leave-ev><span class="lbl">All stacks expire when the bearer</span><select data-k="leaveEvent" aria-label="Event that clears stacks">${BEARER_EVENTS.map(e => opt(e, eventLabels()[e], st && st.leave.kind === 'event' ? st.leave.event : 'struck')).join('')}</select></label>
        <div class="lbl">After the fight, stacks are</div>${M.chips(c('keep'), KEEP_LABEL, st ? st.keep : 'fight', { label: 'After the fight' })}
        <label class="mk-check"><input type="checkbox" data-k="th"${th ? ' checked' : ''}><span>Trigger an effect at a stack count</span></label>
        <div data-th-f>
          <div class="lbl">Trigger at</div>${M.chips(c('at'), AT_LABEL, th && th.at.kind === 'formula' ? 'formula' : 'count', { label: 'Trigger at' })}
          <div data-at="count">${numIn('data-k="thN" min="1" aria-label="Trigger stack count"', 'Stack count', th && th.at.kind === 'count' ? th.at.n : st ? st.cap : 5)}</div>
          <label class="field" data-at="formula"><span class="lbl">Stack count formula</span><input type="text" autocomplete="off" spellcheck="false" data-k="thF" aria-label="Stack count formula" placeholder="vit" value="${esc(th && th.at.kind === 'formula' ? printFormula(th.at.formula) : 'vit')}"></label>
          <div class="lbl">Applies to</div>${M.chips(c('th-to'), REACH_LABEL, th && th.to.kind !== 'bearer' ? 'area' : 'bearer', { label: 'Applies to' })}
          ${area('th', th && th.to)}
          <div class="lbl">Effects to apply</div><div data-th-fx></div>
          <div class="lbl">After triggering, stacks are</div>${M.chips(c('then'), THEN_LABEL, th ? th.then : 'spend', { label: 'After triggering' })}
        </div>
        <p class="mk-fx-err" data-stack-err role="alert"></p>
      </div>
    </div></details>
    <details class="mk-group" data-group="when"><summary data-sum="when"></summary><div class="mk-group-body" data-trig-list></div></details>
    <details class="mk-group" data-group="end"><summary data-sum="end"></summary><div class="mk-group-body">
      <label class="mk-check"><input type="checkbox" data-k="end"${def && def.end ? ' checked' : ''}><span>Trigger an effect when this status ends</span></label>
      <div data-end-f><div data-end-fx></div>
        <div class="lbl">If cured early</div>${M.chips(c('cleanse'), CLEANSE_LABEL, def && def.end ? def.end.cleanse : 'cancel', { label: 'If cured early' })}
        <p class="mk-fx-err" data-end-err role="alert"></p></div>
    </div></details>`;
  const $ = s => box.querySelector(s), on = k => $(`[data-k="${k}"]`).checked;
  const raise = () => box.dispatchEvent(new Event('input', { bubbles: true }));
  // a nested effects editor is drawn when its box is first ticked, so a form that uses none of them holds one editor;
  // it starts empty, so what lands is what the GM chose (a quick chip or Add effect), never a guess to remove
  const NONE = { ops: () => [], blocked: () => false };
  let thFx = NONE, endFx = NONE;
  const thEditor = () => { if (thFx === NONE) thFx = M.effects($('[data-th-fx]'), { ops: th ? th.ops : [], kind: 'land' }); };
  const endEditor = () => { if (endFx === NONE) endFx = M.effects($('[data-end-fx]'), { ops: def && def.end ? def.end.ops : [], kind: 'land' }); };
  if (th) thEditor();
  if (def && def.end) endEditor();

  const trigList = triggerList($('[data-trig-list]'), def && def.triggers ? def.triggers : [], M, c('t'), 'its bearer');

  /** What the groups hold: `{ stack, triggers, end }` (each absent when none) and the first error, if any. */
  function read() {
    const out = /** @type {any} */ ({}), errs = { stack: '', end: '' };
    if (on('stack')) {
      const cap = Math.trunc(Number($('[data-k="cap"]').value)), leaveK = M.picked(box, c('leave')) || 'never';
      if (!(cap >= 1 && cap <= K.stackCap)) errs.stack = `Max stacks must be from 1 to ${K.stackCap}.`;
      const leave = leaveK === 'event' ? { kind: 'event', event: $('[data-k="leaveEvent"]').value } : { kind: leaveK };
      let threshold = null;
      if (on('th') && !errs.stack) {
        const atK = M.picked(box, c('at')) || 'count', n = Math.trunc(Number($('[data-k="thN"]').value));
        let at = null;
        if (atK === 'count') { if (n >= 1 && n <= cap) at = { kind: 'count', n }; else errs.stack = `Stack count must be from 1 to max stacks (${cap}).`; }
        else { const p = parseFormula($('[data-k="thF"]').value, rules()); if ('error' in p) errs.stack = `Stack count: ${p.error}`; else at = { kind: 'formula', formula: p.formula }; }
        const toK = M.picked(box, c('th-to')) || 'bearer', radius = Math.trunc(Number($('[data-k="th-radius"]').value));
        if (toK === 'area' && !(radius >= 1 && radius <= R.fight.fieldRadiusMax)) errs.stack = `Area radius must be from 1 to ${R.fight.fieldRadiusMax} tiles.`;
        const ops = thFx.ops();
        if (thFx.blocked()) errs.stack = errs.stack || 'Fix the effect above.';
        else if (!ops.length) errs.stack = errs.stack || 'Add at least one effect for the stack trigger.';
        else if (ops.length > K.triggerOps) errs.stack = errs.stack || `A threshold can have at most ${K.triggerOps} effects.`;
        const thOnSide = M.picked(box, c('th-on')) || 'foes';
        const keepMost = toK === 'area' && th && th.to.kind === 'most' && th.to.radius === radius && th.to.on === thOnSide;
        const to = toK === 'area' ? (keepMost ? th.to : { kind: 'area', radius, on: thOnSide }) : { kind: 'bearer' };
        if (at) threshold = { at, to, ops, then: M.picked(box, c('then')) === 'keep' ? 'keep' : 'spend' };
      }
      out.stack = { cap, leave, keep: M.picked(box, c('keep')) === 'sheet' ? 'sheet' : 'fight', threshold };
    }
    const tr = trigList.read();
    if (trigList.count()) out.triggers = tr.triggers;
    if (on('end')) {
      const ops = endFx.ops();
      if (endFx.blocked()) errs.end = 'Fix the effect above.';
      else if (!ops.length) errs.end = 'Add at least one effect for when the status ends.';
      else if (ops.length > K.triggerOps) errs.end = `An end effect can have at most ${K.triggerOps} effects.`;
      out.end = { ops, cleanse: M.picked(box, c('cleanse')) === 'land' ? 'land' : 'cancel' };
    }
    $('[data-stack-err]').textContent = errs.stack;
    $('[data-end-err]').textContent = errs.end;
    return { fields: out, err: errs.stack || errs.end || tr.err };
  }

  /** Shows the fields each choice needs, and each group's one line. */
  function draw() {
    const stackOn = on('stack'), thOn = on('th'), leaveK = M.picked(box, c('leave'));
    if (stackOn && thOn) thEditor();
    if (on('end')) endEditor();
    $('[data-stack-f]').hidden = !stackOn;
    $('[data-leave-ev]').hidden = leaveK !== 'event';
    $('[data-th-f]').hidden = !thOn;
    box.querySelectorAll('[data-at]').forEach(el => { el.hidden = el.dataset.at !== (M.picked(box, c('at')) || 'count'); });
    $('[data-area="th"]').hidden = M.picked(box, c('th-to')) !== 'area';
    $('[data-end-f]').hidden = !on('end');
    const { fields } = read(), s = fields.stack, nt = trigList.count();
    $('[data-sum="stacks"]').textContent = !s ? 'Stacks: no'
      : `Stacks up to ${s.cap}${s.leave.kind === 'round' ? ', 1 expires per round' : s.leave.kind === 'event' ? `, all expire when the bearer ${eventLabels()[s.leave.event]}` : ''}${s.threshold ? `, at ${s.threshold.at.kind === 'count' ? s.threshold.at.n : printFormula(s.threshold.at.formula)}: ${s.threshold.then === 'spend' ? 'spent' : 'kept'}` : ''}`;
    $('[data-sum="when"]').textContent = nt ? `Triggers: ${nt}` : 'Triggers: none';
    $('[data-sum="end"]').textContent = fields.end ? `When it ends: ${fields.end.ops.length} effect${fields.end.ops.length === 1 ? '' : 's'}, curing ${fields.end.cleanse === 'cancel' ? 'cancels it' : 'triggers it immediately'}` : 'When it ends: nothing';
  }

  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !box.contains(b)) return;
    if (b.closest('[data-chips]') || b.closest('[data-trig-list]')) draw();
  });
  box.addEventListener('change', () => draw());
  box.addEventListener('input', e => { if (e.target !== box) draw(); });
  draw();
  return {
    /** The def's kits fields as the groups hold them; each absent when none. */
    fields: () => read().fields,
    blocked: () => !!read().err,
  };
}

export const kitPartsCss = `
.mk-trigs{display:flex;flex-direction:column;gap:8px}
.mk-trig.bad{border-color:var(--red)}
.mk-group [hidden]{display:none!important}`;

// ── the ability form's kits groups (design 5.1 and 8.12) ──
const PRICE_LABEL = [['hp', 'HP'], ['stacks', 'Stacks'], ['zone', 'A field']];
const GATE_LABEL = [['holds', 'Has a status'], ['uses', 'Use limit'], ['inside', 'Inside a field']];
const MOVE_LABEL = [['none', 'None'], ['blink', 'Teleport'], ['swap', 'Swap places'], ['swap-shadow', 'Swap with a shadow']];
const REACT_LABEL = [['before', 'Before a hit'], ['lethal', 'Before a killing hit'], ['after', 'After a hit'], ['turn', 'Before a turn']];
const ACT_LABEL = [['none', 'None'], ['shift', 'Moves field'], ['grow', 'Widens field'], ['erase', 'Erases foe field']];
const ARCH_LABEL = [['brute', 'Brute'], ['skirmisher', 'Skirmisher'], ['caster', 'Caster']];
/** The most starting statuses a summon has: as many as a fight row holds (fight-parse.ts `summonOf`). */
const SUMMON_STATUSES = MAX_STATUSES;

/**
 * The ability form's kits groups in `box`, from `a` (an ability or null): Costs more (prices), Only when (gates), Tags,
 * Moves (a blink or a swap), Reaction, Summons and Acts on a field. `fields` answers the ability's `prices`, `gates`,
 * `tags`, `move`, `react`, `summon` and `zoneAct` as the groups hold them, each absent when none.
 * @param {HTMLElement} box @param {any} a @param {any} M
 */
export function abilityBlocks(box, a, M) {
  const R = rules(), K = R.fight.kit;
  const statuses = () => Object.entries(rules().conditions).filter(([k]) => !isStateChip(k)).map(([k, d]) => [k, String((d && d.label) || k)]);
  const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
  const seg = (f, i, label, options, value) => `<div class="mk-chips mk-modes seg" role="group" aria-label="${esc(label)}">${options.map(([v, l]) => `<button type="button" class="mk-chip" data-set="${f}" data-i="${i}" data-v="${v}" aria-pressed="${v === value}">${esc(l)}</button>`).join('')}</div>`;
  const numF = (f, i, label, value, o = {}) => `<label class="field"><span class="lbl">${esc(label)}</span><input type="number" inputmode="${o.decimal ? 'decimal' : 'numeric'}" step="${o.decimal ? 'any' : '1'}" data-f="${f}" data-i="${i}" aria-label="${esc(label)}" value="${esc(value)}"${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ''}></label>`;
  const textF = (f, i, label, value, o = {}) => `<label class="field"><span class="lbl">${esc(label)}</span><input type="text" maxlength="${o.max || 40}" autocomplete="off" spellcheck="false" data-f="${f}" data-i="${i}" aria-label="${esc(label)}" value="${esc(value)}"${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ''}></label>`;
  const statusSel = (f, i, label, value) => `<label class="field"><span class="lbl">${esc(label)}</span><select data-f="${f}" data-i="${i}" data-pick aria-label="${esc(label)}">${statuses().map(([k, l]) => opt(k, l, value)).join('')}${value && !statuses().some(([k]) => k === value) ? opt(value, value, value) : ''}</select></label>`;
  const first = () => (statuses()[0] || [''])[0];

  /** Each price and gate as its row holds it, as text the GM typed. */
  const priceRow = p => (!p ? { kind: 'hp', hpMode: 'share', n: '10', key: first(), from: 'self', take: '', zone: '', zoneTake: 'one' } : {
    kind: p.kind, hpMode: p.kind === 'hp' ? p.amount.kind : 'share', n: p.kind === 'hp' ? String(p.amount.kind === 'flat' ? p.amount.n : Math.round(p.amount.share * 1000) / 10) : '10',
    key: p.kind === 'stacks' ? p.key : first(), from: p.kind === 'stacks' ? p.from : 'self', take: p.kind === 'stacks' && p.take.kind === 'n' ? String(p.take.n) : '',
    zone: p.kind === 'zone' && p.name ? p.name : '', zoneTake: p.kind === 'zone' ? p.take : 'one',
  });
  const gateRow = g => (!g ? { kind: 'holds', key: first(), on: 'self', n: '1', per: 'fight', zone: '' } : {
    kind: g.kind, key: g.kind === 'holds' ? g.key : first(), on: g.kind === 'holds' ? g.on : 'self', n: String(g.kind === 'holds' ? g.atLeast : g.kind === 'uses' ? g.n : 1),
    per: g.kind === 'uses' ? g.per : 'fight', zone: g.kind === 'inside' ? g.zone : '',
  });
  const prices = (a && a.prices ? a.prices : []).map(priceRow), gates = (a && a.gates ? a.gates : []).map(gateRow);
  /** The summon's starting statuses (kits design 1.9), each as its row holds it: a status and its rounds as typed. */
  const sstatRow = x => (!x ? { key: first(), rounds: '2' } : { key: x.key, rounds: String(x.rounds) });
  const sstats = (a && a.summon ? a.summon.statuses : []).map(sstatRow);
  const st = {
    tags: (a && a.tags ? a.tags : []).join(', '), move: a && a.move ? (a.move.kind === 'swap' && a.move.only === 'shadow' ? 'swap-shadow' : a.move.kind) : 'none',
    react: !!(a && a.react), when: a && a.react ? a.react.when : 'before', reach: String(a && a.react ? a.react.reach : 0),
    summon: !!(a && a.summon), sName: a && a.summon ? a.summon.name : 'Sprite', arch: a && a.summon ? a.summon.archetype : 'skirmisher', sRounds: String(a && a.summon ? a.summon.rounds : 2),
    act: a && a.zoneAct ? a.zoneAct.act : 'none', by: String(a && a.zoneAct ? a.zoneAct.by : 2), actZone: a && a.zoneAct && a.zoneAct.name ? a.zoneAct.name : '',
  };

  const priceHtml = (p, i) => `<div class="mk-fx" data-price="${i}"><div class="mk-fx-top"><select data-f="kind" data-i="${i}" data-list="price" aria-label="Cost ${i + 1}">${PRICE_LABEL.map(([v, l]) => opt(v, l, p.kind)).join('')}</select>
      <button type="button" class="icon-btn" data-rm="price" data-i="${i}" aria-label="Remove cost ${i + 1}">&times;</button></div>
    ${p.kind === 'hp' ? `${seg('hpMode', i, `HP cost ${i + 1}`, [['share', '% of max HP'], ['flat', 'Flat HP']], p.hpMode)}${numF('n', i, p.hpMode === 'share' ? `Percent of max HP (${K.hpShareMin * 100} to ${K.hpShare * 100})` : `HP (1 to ${K.hpFlat})`, p.n, { decimal: p.hpMode === 'share' })}`
      : p.kind === 'stacks' ? `${statusSel('key', i, 'Status', p.key)}${seg('from', i, `Whose stacks, cost ${i + 1}`, [['self', 'User\'s stacks'], ['target', 'Target\'s stacks']], p.from)}${numF('take', i, 'Stacks to spend', p.take, { placeholder: 'All stacks' })}`
      : `${textF('zone', i, 'Field name', p.zone, { placeholder: 'any of yours' })}${seg('zoneTake', i, `Which fields, cost ${i + 1}`, [['one', 'One field'], ['all', 'All fields']], p.zoneTake)}`}
    <p class="mk-fx-err" data-err role="alert"></p></div>`;
  const gateHtml = (g, i) => `<div class="mk-fx" data-gate="${i}"><div class="mk-fx-top"><select data-f="kind" data-i="${i}" data-list="gate" aria-label="Condition ${i + 1}">${GATE_LABEL.map(([v, l]) => opt(v, l, g.kind)).join('')}</select>
      <button type="button" class="icon-btn" data-rm="gate" data-i="${i}" aria-label="Remove condition ${i + 1}">&times;</button></div>
    ${g.kind === 'holds' ? `${statusSel('key', i, 'Status', g.key)}${seg('on', i, `On whom, condition ${i + 1}`, [['self', 'On user'], ['target', 'On target']], g.on)}${numF('n', i, 'Minimum stacks', g.n)}`
      : g.kind === 'uses' ? `${numF('n', i, `Uses (1 to ${K.fightUses})`, g.n)}${seg('per', i, `Uses per, condition ${i + 1}`, [['fight', 'Per fight'], ['gate', 'Per gate']], g.per)}`
      : textF('zone', i, 'Field name', g.zone, { placeholder: 'Aura' })}
    <p class="mk-fx-err" data-err role="alert"></p></div>`;

  const sstatHtml = (x, i) => `<div class="mk-fx" data-sstat="${i}"><div class="mk-fx-top">${statusSel('key', i, `Starting status ${i + 1}`, x.key)}
      <button type="button" class="icon-btn" data-rm="sstat" data-i="${i}" aria-label="Remove starting status ${i + 1}">&times;</button></div>
    ${numF('rounds', i, `Rounds (1 to ${K.summonRounds})`, x.rounds)}<p class="mk-fx-err" data-err role="alert"></p></div>`;

  function render() {
    box.innerHTML = `
    <details class="mk-group" data-group="prices"><summary data-sum="prices"></summary><div class="mk-group-body">
      <div class="mk-fxs" data-list="price">${prices.map(priceHtml).join('')}</div>
      <button type="button" class="mk-add" data-add="price"${prices.length >= K.prices ? ' disabled' : ''}>Add a cost</button></div></details>
    <details class="mk-group" data-group="gates"><summary data-sum="gates"></summary><div class="mk-group-body">
      <div class="mk-fxs" data-list="gate">${gates.map(gateHtml).join('')}</div>
      <button type="button" class="mk-add" data-add="gate"${gates.length >= K.gates ? ' disabled' : ''}>Add a condition</button></div></details>
    <details class="mk-group" data-group="tags"><summary data-sum="tags"></summary><div class="mk-group-body">
      <label class="field"><span class="lbl">Tags (up to ${K.tags}, separated by commas)</span><input type="text" maxlength="80" autocomplete="off" spellcheck="false" data-f="tags" aria-label="Tags" placeholder="blood, ultimate" value="${esc(st.tags)}"></label></div></details>
    <details class="mk-group" data-group="moves"><summary data-sum="moves"></summary><div class="mk-group-body">
      <div class="lbl">User movement</div>${seg('move', -1, 'User movement', MOVE_LABEL, st.move)}
      <div class="lbl">Change an active field</div>${seg('act', -1, 'Change an active field', ACT_LABEL, st.act)}
      <div class="mk-two" data-act-f>${numF('by', -1, st.act === 'grow' ? `Expand by (1 to ${K.zoneGrow} tiles)` : st.act === 'erase' ? `Fields to erase (1 to ${K.zonesPerOwner})` : `Max move distance (1 to ${K.zoneMove} tiles)`, st.by)}${textF('actZone', -1, 'Field name', st.actZone, { placeholder: st.act === 'erase' ? 'any foe field' : 'any of yours' })}</div></div></details>
    <details class="mk-group" data-group="react"><summary data-sum="react"></summary><div class="mk-group-body">
      <label class="mk-check"><input type="checkbox" data-f="react"${st.react ? ' checked' : ''}><span>Reaction (arm ahead of time to trigger automatically)</span></label>
      <div data-react-f><div class="lbl">When it triggers</div>${seg('when', -1, 'When it triggers', REACT_LABEL, st.when)}${numF('reach', -1, `Also protects allies within (0 to ${R.fight.fieldRadiusMax} tiles)`, st.reach)}</div></div></details>
    <details class="mk-group" data-group="summon"><summary data-sum="summon"></summary><div class="mk-group-body">
      <label class="mk-check"><input type="checkbox" data-f="summon"${st.summon ? ' checked' : ''}><span>Summons a creature to fight for the user</span></label>
      <div data-summon-f>${textF('sName', -1, 'Summon name', st.sName, { max: 40 })}<div class="lbl">Summon role</div>${seg('arch', -1, 'Summon role', ARCH_LABEL, st.arch)}${numF('sRounds', -1, `Rounds (1 to ${K.summonRounds})`, st.sRounds)}
        <div class="lbl">Starting statuses</div><div class="mk-fxs" data-list="sstat">${sstats.map(sstatHtml).join('')}</div>
        <button type="button" class="mk-add" data-add="sstat"${sstats.length >= SUMMON_STATUSES ? ' disabled' : ''}>Add starting status</button></div></div></details>
    <p class="mk-fx-err" data-kit-err role="alert"></p>`;
    draw();
  }
  const pct = s => Math.round(s * 1000) / 10;
  const wholeIn = (t, lo, hi) => { const x = String(t).trim(), n = Number(x); return x !== '' && Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
  /** A price as its row holds it, or the words of what is wrong. */
  function readPrice(p) {
    if (p.kind === 'hp') {
      if (p.hpMode === 'flat') { const n = wholeIn(p.n, 1, K.hpFlat); return n === null ? { err: `HP must be from 1 to ${K.hpFlat}.` } : { v: { kind: 'hp', amount: { kind: 'flat', n } } }; }
      const n = Number(String(p.n).trim());
      if (String(p.n).trim() === '' || !(n >= K.hpShareMin * 100 && n <= K.hpShare * 100)) return { err: `HP share must be from ${pct(K.hpShareMin)}% to ${pct(K.hpShare)}% of max HP.` };
      return { v: { kind: 'hp', amount: { kind: 'share', share: n / 100 } } };
    }
    if (p.kind === 'stacks') {
      if (!p.key) return { err: 'Pick a status.' };
      const take = String(p.take).trim() === '' ? { kind: 'all' } : (n => (n === null ? null : { kind: 'n', n }))(wholeIn(p.take, 1, K.stackCap));
      return take ? { v: { kind: 'stacks', key: p.key, from: p.from, take } } : { err: `Stacks must be from 1 to ${K.stackCap}. Leave it empty for all.` };
    }
    const name = p.zone.replace(/\s+/g, ' ').trim();
    return { v: { kind: 'zone', name: name || null, take: p.zoneTake } };
  }
  function readGate(g) {
    if (g.kind === 'holds') { const n = wholeIn(g.n, 1, K.stackCap); return !g.key ? { err: 'Pick a status.' } : n === null ? { err: `Minimum stacks must be from 1 to ${K.stackCap}.` } : { v: { kind: 'holds', key: g.key, on: g.on, atLeast: n } }; }
    if (g.kind === 'uses') { const n = wholeIn(g.n, 1, K.fightUses); return n === null ? { err: `Uses must be from 1 to ${K.fightUses}.` } : { v: { kind: 'uses', per: g.per, n } }; }
    const zone = g.zone.replace(/\s+/g, ' ').trim();
    return zone ? { v: { kind: 'inside', zone } } : { err: 'Enter the field name.' };
  }
  /** What the groups hold, each field absent when none, and the first error. */
  function read() {
    // each error with where it is shown: under its row (`row`), or in the group's bottom line (`group`) (implicit audit 3, K1)
    const out = /** @type {any} */ ({}), errs = /** @type {{ text: string; at: 'row' | 'group' }[]} */ ([]);
    const rowErr = text => errs.push({ text, at: 'row' }), groupErr = text => errs.push({ text, at: 'group' });
    const ps = prices.map(readPrice), gs = gates.map(readGate);
    ps.forEach((r, i) => { const el = box.querySelector(`[data-price="${i}"] [data-err]`); if (el) el.textContent = r.err || ''; if (r.err) rowErr(r.err); });
    gs.forEach((r, i) => { const el = box.querySelector(`[data-gate="${i}"] [data-err]`); if (el) el.textContent = r.err || ''; if (r.err) rowErr(r.err); });
    if (ps.length) out.prices = ps.flatMap(r => (r.v ? [r.v] : []));
    if (gs.length) out.gates = gs.flatMap(r => (r.v ? [r.v] : []));
    const tags = st.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (tags.length > K.tags) groupErr(`Use at most ${K.tags} tags.`);
    else if (tags.some(t => !(TAG_RE.test(t) && t.length <= K.tagLength))) groupErr(`A tag must be one word or hyphenated words, up to ${K.tagLength} characters.`);
    else if (tags.length) out.tags = [...new Set(tags)];
    if (st.move !== 'none') out.move = st.move === 'swap-shadow' ? { kind: 'swap', only: 'shadow' } : { kind: st.move };
    if (st.react) {
      const reach = wholeIn(st.reach, 0, R.fight.fieldRadiusMax);
      if (reach === null) groupErr(`Reach must be from 0 to ${R.fight.fieldRadiusMax} tiles.`); else out.react = { when: st.when, reach };
    }
    if (st.summon) {
      const name = st.sName.replace(/\s+/g, ' ').trim(), rounds = wholeIn(st.sRounds, 1, K.summonRounds);
      if (!name) groupErr('Give the summon a name.'); else if (rounds === null) groupErr(`Rounds must be from 1 to ${K.summonRounds}.`);
      else {
        const ss = sstats.map(x => { const r = wholeIn(x.rounds, 1, K.summonRounds); return !x.key ? { err: 'Pick a status.' } : r === null ? { err: `Rounds must be from 1 to ${K.summonRounds}.` } : { v: { key: x.key, rounds: r } }; });
        ss.forEach((r, i) => { const el = box.querySelector(`[data-sstat="${i}"] [data-err]`); if (el) el.textContent = r.err || ''; if (r.err) rowErr(r.err); });
        out.summon = { name, archetype: st.arch, rounds, statuses: ss.flatMap(r => (r.v ? [r.v] : [])) };
      }
    }
    if (st.act !== 'none') {
      const max = st.act === 'grow' ? K.zoneGrow : st.act === 'erase' ? K.zonesPerOwner : K.zoneMove;
      const by = wholeIn(st.by, 1, max), name = st.actZone.replace(/\s+/g, ' ').trim();
      if (by === null) groupErr(`${st.act === 'erase' ? 'Fields' : 'Tiles'} must be from 1 to ${max}.`); else out.zoneAct = { act: st.act, name: name || null, by };
    }
    const err = box.querySelector('[data-kit-err]');
    if (err) err.textContent = (errs.find(e => e.at === 'group') || { text: '' }).text;
    return { fields: out, err: errs.length ? errs[0].text : '' };
  }
  function draw() {
    const { fields: f } = read(), q = s => box.querySelector(s);
    q('[data-react-f]').hidden = !st.react;
    q('[data-summon-f]').hidden = !st.summon;
    q('[data-act-f]').hidden = st.act === 'none';
    const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
    q('[data-sum="prices"]').textContent = prices.length ? `Extra costs: ${n(prices.length, 'cost')}` : 'Extra costs: none';
    q('[data-sum="gates"]').textContent = gates.length ? `Requirements: ${n(gates.length, 'condition')}` : 'Requirements: none';
    q('[data-sum="tags"]').textContent = f.tags ? `Tags: ${f.tags.join(', ')}` : 'Tags: none';
    q('[data-sum="moves"]').textContent = `Movement: ${st.move === 'none' ? 'none' : st.move === 'blink' ? 'teleport' : st.move === 'swap-shadow' ? 'swap with a shadow' : 'swap places'}${st.act === 'none' ? '' : `, ${st.act === 'shift' ? 'moves a field' : st.act === 'grow' ? 'widens a field' : 'erases a foe field'}`}`;
    q('[data-sum="react"]').textContent = st.react ? `Reaction: ${(REACT_LABEL.find(([w]) => w === st.when) || REACT_LABEL[0])[1].toLowerCase()}` : 'Reaction: no';
    q('[data-sum="summon"]').textContent = f.summon ? `Summons ${f.summon.name} for ${n(f.summon.rounds, 'round')}${f.summon.statuses.length ? `, starting with ${f.summon.statuses.length === 1 ? 'a status' : `${f.summon.statuses.length} statuses`}` : ''}` : 'Summons: no';
  }
  const raise = () => box.dispatchEvent(new Event('input', { bubbles: true }));
  /** Keeps the open groups open across a redraw. */
  const keepOpen = f => { const open = [...box.querySelectorAll('details[open]')].map(d => d.dataset.group); f(); box.querySelectorAll('details').forEach(d => { if (open.includes(d.dataset.group)) d.open = true; }); };
  const listOf = name => (name === 'price' ? prices : name === 'sstat' ? sstats : gates);
  /** The row a control of row `i` edits: a price, a condition, a starting status, or (no row) the groups' own state. */
  const rowOf = (el, i) => (el.dataset.i === undefined || i < 0 ? st : el.closest('[data-price]') ? prices[i] : el.closest('[data-sstat]') ? sstats[i] : gates[i]);
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !box.contains(b)) return;
    const i = Number(b.dataset.i);
    if (b.dataset.add) { const l = listOf(b.dataset.add); l.push(b.dataset.add === 'price' ? priceRow(null) : b.dataset.add === 'sstat' ? sstatRow(null) : gateRow(null)); keepOpen(render); raise(); return; }
    if (b.dataset.rm) { listOf(b.dataset.rm).splice(i, 1); keepOpen(render); raise(); return; }
    if (b.dataset.set) {
      rowOf(b, i)[b.dataset.set] = b.dataset.v; keepOpen(render); raise();
    }
  });
  box.addEventListener('change', e => {
    const t = e.target, f = t.dataset && t.dataset.f; if (!f) return;
    const i = Number(t.dataset.i), row = rowOf(t, i);
    if (f === 'kind') { const l = t.dataset.list === 'price' ? prices : gates, fresh = t.dataset.list === 'price' ? priceRow(null) : gateRow(null); l[i] = { ...fresh, kind: t.value }; keepOpen(render); raise(); return; }
    if (f === 'react' || f === 'summon') { st[f] = t.checked; draw(); return; }
    row[f] = t.value; draw();
  });
  box.addEventListener('input', e => {
    const t = e.target, f = t.dataset && t.dataset.f; if (!f || t.type === 'checkbox' || t.tagName === 'SELECT') return;
    rowOf(t, Number(t.dataset.i))[f] = t.value; draw();
  });
  render();
  return { fields: () => read().fields, blocked: () => !!read().err };
}
