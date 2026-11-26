// maker.js: the parts every maker dialog is built from, on app.api.maker. The shell (`open`) owns the dialog: it opens
// on the window stack (ui.js, which traps Tab and hands it the keys), asks before Escape or a press beside it drops an
// edited form (its draft, src/core/draft.ts: a body's surface with no field, as the map maker's grid, is marked
// `data-mk-paint` and a press on it is an edit), Enter in a field moves to the next one (ui.js `formEnter`; Ctrl or Cmd and Enter saves), the fit to the visual viewport when the keyboard opens, the sticky Cancel and Save bar and the
// live preview. `chips` and `picked` are toggle chips; `bonus` and `readBonus` are the ten bonus fields; `effects` is the
// effects editor, one row per op of the fight (src/core/combat/effect-ops.ts), an amount a formula read by `parseFormula`;
// `rewards` is the reward editor (reward-editor.js). No game rule lives here: a maker builds its form from these parts and
// saves what the kind's parser gives back.
import { esc, css, field, h, closeWindow, confirm, formEnter, openWindow, sheet, trapTab } from './ui.js';
import { enter, pop } from './motion.ts';
import { icon, iconHref, sprite } from './icons.ts';
import { GROUP_WORDS, iconPickStart, iconPickStep, iconShown, iconWords, pickerGroups } from '../core/icon-pick.ts';
import { ICON_GROUPS, ICON_KEYS, iconDef, iconsOf } from '../core/registry/icons.ts';
import { BONUS_KEYS, BONUS_LABELS, rules } from '../edge/rules.ts';
import { RANKS } from '../core/rules.ts';
import { STAT_KEYS, STAT_LABELS } from '../core/stats.ts';
import { amountWords, bareRefusal, parseFormula, printFormula } from '../core/formula.ts';
import { SHEET_LABELS } from '../core/hunter/derive.ts';
import { OP_KINDS, opLines, opsOffered } from '../core/combat/effect-ops.ts';
import { LEVELS } from '../core/combat/sight-levels.ts';
import { isFormulaKey } from '../core/combat/op-amount.ts';
import { sheetOpCap } from '../core/combat/standing.ts';
import { parseOp } from '../core/combat/fight-parse.ts';
import { RARITIES } from '../core/registry/items.ts';
import { BUILT_IN_STATUSES } from '../core/registry/statuses.ts';
import { isStateChip } from '../core/hunter/chips.ts';
import { abilityOf, averages, checkGap, defaultTicks, gapOf, paceOf, paceTime, powerStat, recommended, ruleTicks, sampleBody, SCALER_CHOICES, suggestedScaler, ticksOf } from '../core/registry/ability-kinds.ts';
import { FAMILY, nameOf } from '../core/registry/scalers.ts';
import { worthLine } from '../core/registry/worth.ts';
import { DAMAGE_HELP_LINE, DAMAGE_SHORT, DAMAGE_TYPES, DAMAGE_WORD, defenceOf, isDamage } from '../core/combat/damage-type.ts';
import { GRIEVOUS_LEGACY_MAX, GRIEVOUS_MAX, GRIEVOUS_MIN, grievousCapPct, grievousCutOf, hasTieredGrievousCut, isGrievousKey, shareCapPct, withGrievousCut } from '../core/combat/grievous.ts';
import { abilityId } from '../core/combat/ability-types.ts';
import { percent, tiles } from '../core/combat/space.ts';
import { roundsOf, tick } from '../core/combat/timeline.ts';
import { oneOf } from '../core/one-of.ts';
import { draftStep } from '../core/draft.ts';
import { rewardEditor, rewardEditorCss } from './reward-editor.js';
import { abilityBlocks, kitPartsCss, statusBlocks, triggerList } from './kit-parts.js';

const BONUS_LABEL = { ...BONUS_LABELS, hpMax: 'Max HP', manaMax: 'Max mana' };

// ── chips ──
/**
 * A group of toggle chips. One value is pressed at a time unless `many`; with `clear`, a tap on the pressed chip lets it
 * go. A shell presses them; `picked` reads the group.
 * @param {string} name @param {ReadonlyArray<readonly string[]>} options value, label and an extra class @param {string | string[] | null} value
 * @param {{ many?: boolean; clear?: boolean; label?: string }} [o]
 */
function chips(name, options, value, o = {}) {
  const on = v => (Array.isArray(value) ? value.includes(v) : v === value);
  return `<div class="mk-chips${o.many ? '' : ' seg'}" role="group" data-chips="${esc(name)}"${o.many ? ' data-many' : ''}${o.clear ? ' data-clear' : ''}${o.label ? ` aria-label="${esc(o.label)}"` : ''}>${
    options.map(([v, l, cls]) => `<button type="button" class="mk-chip${cls ? ` ${esc(cls)}` : ''}" data-chip="${esc(v)}" aria-pressed="${on(v)}">${esc(l)}</button>`).join('')}</div>`;
}
/** The pressed value of a chip group (null when none), or every pressed value of a `many` group. */
function picked(root, name) {
  const g = root.querySelector(`[data-chips="${CSS.escape(name)}"]`); if (!g) return null;
  const vals = [...g.querySelectorAll('[data-chip][aria-pressed="true"]')].map(b => b.dataset.chip);
  return g.hasAttribute('data-many') ? vals : vals[0] ?? null;
}
function press(btn) {
  const g = btn.closest('[data-chips]'), was = btn.getAttribute('aria-pressed') === 'true';
  if (g.hasAttribute('data-many')) { btn.setAttribute('aria-pressed', String(!was)); return; }
  if (was && !g.hasAttribute('data-clear')) return;
  g.querySelectorAll('[data-chip]').forEach(b => b.setAttribute('aria-pressed', 'false'));
  if (!was) btn.setAttribute('aria-pressed', 'true');
}

// ── the bonus fields ──
/** An input for each bonus key (`BONUS_KEYS`: the eight stats, then the sheet's numbers), each empty when 0. */
function bonus(values = {}, o = {}) {
  const lim = `${o.min !== undefined ? ` min="${esc(o.min)}"` : ''}${o.max !== undefined ? ` max="${esc(o.max)}"` : ''}`;
  return `<div class="mk-bonus" data-bonus-fields>${BONUS_KEYS.map(k => field(BONUS_LABEL[k],
    `<input type="number" step="1" inputmode="numeric"${lim} data-bonus="${k}" placeholder="0" value="${values && Number(values[k]) ? esc(Math.trunc(Number(values[k]))) : ''}">`)).join('')}</div>`;
}
/** What the bonus inputs under `root` hold: each whole number that is not 0. */
function readBonus(root) {
  const out = {};
  for (const k of BONUS_KEYS) {
    const inp = root.querySelector(`[data-bonus="${k}"]`), n = inp ? Math.trunc(Number(inp.value)) : 0;
    if (Number.isFinite(n) && n) out[k] = n;
  }
  return out;
}

// ── the effects editor ──
const KIND_LABEL = {
  damage: 'Damage', heal: 'Heal', mana: 'Mana', fatigue: 'Fatigue', shield: 'Shield', speed: 'Speed %', delay: 'Delay next turn', stat: 'Stat',
  hold: 'Cannot act (stun)', root: 'Cannot move (root)', taunt: 'Taunt', threat: 'Threat', channel: 'Channel', staggerRate: 'Stagger fill %',
  refund: 'Action time refund', applyStatus: 'Apply status', cureStatus: 'Cure status', note: 'Note', aura: 'Aura around the bearer', spread: 'Spreads to others',
  sheet: 'Armor, crit, or range', share: 'Damage or healing %', untargetable: 'Cannot be aimed at', invulnerable: 'Cannot drop under 1 HP',
  safeguard: 'Blocks harmful statuses', edge: 'Roll twice (advantage)', boost: 'Bonus die or number', hidden: 'Hidden (stealth)', alert: 'Never surprised',
  shove: 'Push or pull', move: 'Move status stacks', hasten: 'Move turn sooner', extra: 'Extra action', guard: 'Guard (reaction)',
  negate: 'Negate (reaction)', dispel: 'Cure harmful status', stayHidden: 'Stays hidden', reveal: 'Reveal hidden',
  stagger: 'Fill the stagger bar', echo: 'Copy status to nearest',
};
/** Whom a status's aura reaches (effect-ops.ts `AURA_ON`). */
const AURA_LABEL = [['all', 'Everyone'], ['allies', 'Allies'], ['foes', 'Foes']];
/**
 * The ops each maker's rows offer. A status's are every kind of `Op` (`OP_KINDS`, which a test loops over); an item's what
 * a use does; a skill's what an ability's own ops may do to each target it lands on (`UseOp`).
 */
const ROW_KINDS = {
  status: OP_KINDS,
  item: ['damage', 'heal', 'mana', 'fatigue', 'applyStatus', 'cureStatus', 'note'],
  skill: ['applyStatus', 'cureStatus', 'delay', 'threat', 'shield', 'channel', 'mana', 'fatigue', 'note', 'shove', 'move', 'hasten', 'extra', 'guard', 'negate', 'dispel', 'reveal', 'stagger'],
  /**
   * What a threshold, a trigger or a delayed end lands (effect-ops.ts `LandOp`): a hit or a heal at once, the ability ops
   * that land alone (`LAND_USE_OPS`, a reveal and a stagger among them), and an echo, which acts in a trigger a status gained sets off.
   */
  land: ['damage', 'heal', 'applyStatus', 'cureStatus', 'shield', 'mana', 'fatigue', 'threat', 'delay', 'note', 'move', 'hasten', 'dispel', 'reveal', 'stagger', 'echo'],
};
/** Ops whose amount is a formula (by rank), and the shield, whose amount is one formula. */
const FORMULA_KINDS = ['damage', 'heal', 'mana', 'fatigue'];
const ONE_FORMULA = ['shield'];
/**
 * Ops whose value is a number, by rank: the op's field, the parser's bounds, whether it may have decimals, and whether it
 * is typed in rounds and kept in ticks (a delay). A sheet op is a number row only on a key that holds a number (`lasting`).
 */
const NUMBERS = {
  speed: { key: 'pct', lo: -100, hi: 1000 }, threat: { key: 'amount', lo: -9999, hi: 9999 },
  staggerRate: { key: 'pct', lo: -100, hi: 1000 }, refund: { key: 'pct', lo: 1, hi: 100 }, delay: { key: 'ticks', lo: 0.1, hi: 10, decimal: true, rounds: true },
  share: { key: 'pct', lo: -100, hi: 100 }, sheet: { key: 'amount', lo: -60, hi: 60 },
  hidden: { key: 'level', lo: LEVELS[0], hi: LEVELS[LEVELS.length - 1], placeholder: '0', label: 'Stealth level', zero: true }, // a hide at 0 hides from a plain sight of 0 (sight.ts `perceives`)
};
const NUMBER_KINDS = Object.keys(NUMBERS);
/** The bounds a stat op's flat amount is typed within: what its number row held before it took a formula. */
const STAT_SPEC = { key: 'amount', lo: -999, hi: 999 };
/**
 * A number's field and bounds: a stat op's `STAT_SPEC`; a sheet op's its key's rule (standing.ts `sheetOpCap`, which the
 * parser and the reader keep too); the rest `NUMBERS`. A lasting row checks a flat amount against them.
 */
function specOf(r, statusKey = null) {
  if (r.kind === 'stat') return STAT_SPEC;
  if (r.kind === 'share' && r.shareOn === 'healed' && isGrievousKey(statusKey)) return { key: 'pct', lo: -GRIEVOUS_MAX, hi: 100 };
  if (r.kind !== 'sheet') return NUMBERS[r.kind];
  const hi = sheetOpCap(r.sheetKey, rules());
  return { key: 'amount', lo: -hi, hi, decimal: r.sheetKey === 'critSize' || r.sheetKey === 'costCut' };
}
/**
 * A row whose amount is a lasting change's formula (item-stats 6.2): a stat op, or a sheet op on a key that takes one
 * (op-amount.ts `SHEET_FORMULA_KEYS`). Exposed and range are read inside a use, where no bearer's body is at hand, so
 * theirs stay a number row; what a lasting formula may read is `bareRefusal`'s, the parser's check.
 */
const lasting = r => r.kind === 'stat' || (r.kind === 'sheet' && isFormulaKey(r.sheetKey));
/** A row whose amount is a formula: the formula kinds, the shield, and a lasting change. */
const formulaRow = r => FORMULA_KINDS.includes(r.kind) || ONE_FORMULA.includes(r.kind) || lasting(r);
/** A row whose amount is a plain number (`NUMBERS`). */
const numberRow = r => NUMBER_KINDS.includes(r.kind) && !lasting(r);
/**
 * A lasting row moved to a key that holds a number (a sheet op's Armor to Range): its number field keeps a written
 * number and starts empty for a formula, which a number field cannot show; the formula it came with is dropped.
 */
function toNumberRow(r) {
  const keep = t => (String(t).trim() !== '' && Number.isFinite(Number(t)) ? t : '');
  r.q = keep(r.q); r.tiers = r.tiers.map(keep); r.amount = undefined;
}
/** A formula that is a written number (`12`, `-8`), as that number; null when it reads a name or rolls a die. */
const flatOf = f => (f.kind === 'number' ? f.value : f.kind === 'negate' && f.arg.kind === 'number' ? -f.arg.value : null);
/** The sample hunter a lasting change's words are read on in the maker: rank C, its points in Strength and Vitality. */
const SAMPLE_RANK = 'C';
/** What a formula amount grows with: a stat is read times a number, a sheet number as a share of it. */
const GROWS_WITH = [...STAT_KEYS.map(k => [k, STAT_LABELS[k]]), ...Object.entries(SHEET_LABELS).map(([k, l]) => [k.toLowerCase(), l])];
/** The unit typed beside a "Grows with" name: `×` for a stat, `%` for a sheet number. */
const growUnit = name => (STAT_KEYS.includes(name) ? '×' : '%');
/** The text a "Grows with" row adds to an amount (`0.2 * hpmax` for 20 on max HP), or '' when the number is not above 0. */
function growTerm(name, by) {
  const n = Number(by);
  if (!Number.isFinite(n) || n <= 0 || !GROWS_WITH.some(([k]) => k === name)) return '';
  return `${Number((growUnit(name) === '%' ? n / 100 : n).toPrecision(12))} * ${name}`;
}
/** The "Grows with" row of formula row `i`: pick a stat or sheet number, type how much, Add puts its term in the amount. */
const growsRow = i => `<div class="mk-grows"><span class="lbl">Grows with</span><div class="mk-grows-row"><select data-grow-name aria-label="Grows with, effect ${i + 1}">${GROWS_WITH.map(([k, l]) => `<option value="${k}"${k === 'hpmax' ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select><input type="number" inputmode="decimal" step="any" min="0" data-grow-by aria-label="How much, effect ${i + 1}" value="20"><span data-grow-unit>%</span><button type="button" class="quiet" data-grow-add>Add</button></div></div>`;
/** An amount in words on the sample wearer: `10 + 20% of max HP (34 on a sample rank C wearer)`. */
function amountLine(f) {
  const body = sampleBody(SAMPLE_RANK, 'str', rules());
  return amountWords(f, body).replace(/\(now (-?\d+)\)$/, `($1 on a sample rank ${SAMPLE_RANK} wearer)`);
}
const PLAIN_KINDS = ['hold', 'root', 'taunt', 'untargetable', 'invulnerable', 'safeguard', 'alert', 'extra', 'negate', 'reveal'];
/** Where a hide may start (effect-ops.ts `HIDE_STARTS`), and the three events that may end it (`STEALTH_ENDS`), as the GM reads them. */
const START_LABEL = [['unseen', 'Out of sight'], ['anywhere', 'Anywhere']];
const STEALTH_END_LABEL = [['hurt', 'Takes damage'], ['revealed', 'Revealed'], ['dealt', 'Deals damage']];
/** The sheet numbers a `sheet` op changes (effect-ops.ts `SHEET_OP_KEYS`), as the GM reads them. */
const SHEET_KEY_LABEL = [['armor', 'Armor'], ['resist', 'Resist'], ['armorPen', 'Armor penetration (%)'], ['resistPen', 'Magic penetration (%)'],
  ['armorPenFlat', 'Flat armor penetration'], ['resistPenFlat', 'Flat magic penetration'], ['critFaces', 'Crit range (+)'], ['exposed', 'Exposed (foes crit easier)'],
  ['critSize', 'Crit damage multiplier'], ['costCut', 'Ability cost reduction'], ['range', 'Range']];
const SHARE_LABEL = [['dealt', 'Damage dealt'], ['taken', 'Damage taken'], ['healed', 'Healing'], ['shielded', 'Shields']];
const SIDE_LABEL = [['attack', 'Attacks'], ['defend', 'Defense']];
const KEEP_LABEL = [['better', 'Advantage'], ['worse', 'Disadvantage']];
const DIE_LABEL = [['die', 'Roll a die'], ['face', 'Fixed number']];
const DIR_LABEL = [['away', 'Push'], ['toward', 'Pull']];
const FROM_LABEL = [['user', 'Relative to user'], ['aim', 'Relative to target tile']];
const MOVE_FROM_LABEL = [['user', 'User to target'], ['target', 'Target to user']];
const WHICH_LABEL = [['first', 'One harmful status'], ['all', 'All harmful statuses']];
/** A tag's form (fight-parse.ts `TAG_RE`): lower-case words joined by hyphens. */
const TAG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAMAGE_CHOICES = DAMAGE_TYPES.map(t => [t, DAMAGE_SHORT[t]]);
const WHEN_LABEL = [['turn', 'Each round'], ['use', 'Once, when applied']];
const CHANNEL_LABEL = [['protect', 'Protect channel from hits'], ['break', 'Break target\'s channel']];
const RARITY_SHORT = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', mythic: 'Mythic' };
/** The most rows an editor holds: a status, an item and an ability each read 12 ops. */
const MAX_ROWS = 12;
const NEW_STATUS = '__new';
const TIER_COUNT = 6;
const num = value => ({ kind: 'number', value });
const dice = (count, sides) => ({ kind: 'dice', count, sides });
/** Quick chips: a tap adds a ready row. A status's are what the built-ins do, an item's what a use does, a skill's what its ability puts on a target. */
const QUICK = {
  status: [
    ['slow', 'Speed −20%', { op: 'speed', pct: -20 }], ['haste', 'Speed +20%', { op: 'speed', pct: 20 }],
    ['ctl', 'Control −8', { op: 'stat', key: 'ctl', amount: num(-8) }], ['dis', 'Discipline −8', { op: 'stat', key: 'dis', amount: num(-8) }],
    ['d4', '1d4 damage a round', { op: 'damage', type: 'physical', amount: dice(1, 4) }], ['d6', '1d6 arcane a round', { op: 'damage', type: 'arcane', amount: dice(1, 6) }], ['d4t', '1d4 true a round', { op: 'damage', type: 'true', amount: dice(1, 4) }],
    ['h4', '1d4 heal a round', { op: 'heal', amount: dice(1, 4) }], ['hold', 'Cannot act', { op: 'hold' }], ['root', 'Cannot move', { op: 'root' }],
  ],
  item: [
    ['heal', 'Heal 2d4+2', { op: 'heal', amount: { kind: 'binary', op: '+', left: dice(2, 4), right: num(2) }, when: 'use' }],
    ['damage', 'Damage 2d6', { op: 'damage', type: 'physical', amount: dice(2, 6), when: 'use' }],
    ['mana', 'Mana 4', { op: 'mana', amount: num(4), when: 'use' }], ['rest', 'Fatigue −25', { op: 'fatigue', amount: num(-25), when: 'use' }],
    ['apply', 'Apply status', { op: 'applyStatus' }], ['cure', 'Cure status', { op: 'cureStatus' }], ['note', 'Note', { op: 'note', text: '' }],
  ],
  skill: [['apply', 'Apply status', { op: 'applyStatus' }], ['cure', 'Cure status', { op: 'cureStatus' }], ['note', 'Note', { op: 'note', text: '' }]],
  land: [
    ['damage', 'Damage 2d6', { op: 'damage', type: 'arcane', amount: dice(2, 6), when: 'use' }], ['heal', 'Heal 2d4', { op: 'heal', amount: dice(2, 4), when: 'use' }],
    ['apply', 'Apply status', { op: 'applyStatus' }], ['cure', 'Cure status', { op: 'cureStatus' }],
  ],
};
const isTiers = v => Array.isArray(v);
const blankTiers = () => Array.from({ length: TIER_COUNT }, () => '');
/** The six values of the first built-in status op a quick chip's op mirrors (same op, stat and type, its E value the chip's). */
function mirrorOf(op) {
  const show = v => (typeof v === 'number' ? String(v) : printFormula(v));
  const mine = op.op === 'speed' ? op.pct : op.amount;
  if (mine === undefined) return null;
  for (const def of Object.values(BUILT_IN_STATUSES)) {
    for (const o of /** @type {any[]} */ (def.ops)) {
      if (o.op !== op.op || (o.op === 'stat' && o.key !== op.key) || (o.op === 'damage' && o.type !== op.type)) continue;
      const theirs = o.op === 'speed' ? o.pct : o.amount;
      if (isTiers(theirs) && show(theirs[0]) === show(mine)) return theirs.map(show);
    }
  }
  return null;
}
/** A number of an op as its row shows it: a delay in rounds (one decimal), anything else as it is. */
const typed = (kind, v) => String(NUMBERS[kind].rounds ? roundsOf(v, rules(), 'near') : v);
/** A row of the editor from an op. An op of a kind the editor has no row for is a row that keeps the op as it is. */
function rowOf(o) {
  const r = {
    kind: o.op, mode: 'flat', q: '', tiers: blankTiers(), type: 'physical', stat: 'str', status: '', rounds: '', def: null, follow: false, gwCut: '', text: '', when: o.when || null, mirror: null, keep: null, chance: '', chMode: 'protect', on: 'all',
    addStacks: o.stacks === undefined ? '' : String(o.stacks), sheetKey: o.op === 'sheet' ? o.key : 'armor', shareOn: o.op === 'share' ? o.on : 'taken', side: o.side || 'attack',
    edgeKeep: o.op === 'edge' ? o.keep : 'better', tag: o.op === 'edge' && o.tag ? o.tag : '', spend: o.op === 'edge' ? !!o.spend : true, dieMode: o.op === 'boost' ? o.die.kind : 'die',
    dir: o.dir || 'away', from: o.op === 'shove' ? o.from : 'user', moveKey: o.op === 'move' ? o.key : 'harmful', moveFrom: o.op === 'move' ? o.from : 'user', as: o.op === 'move' && o.as ? o.as : '',
    which: o.which || 'first', start: o.op === 'hidden' ? o.start : null, ends: o.op === 'hidden' ? { ...o.ends } : null, stayOn: o.op === 'stayHidden' ? o.on : null,
  };
  if (o.op === 'stat') r.stat = o.key;
  if (formulaRow(r)) {
    if (o.op === 'damage') r.type = o.type;
    if (isTiers(o.amount)) { r.mode = 'rank'; r.tiers = o.amount.map(printFormula); r.q = r.tiers[0]; } else r.q = o.amount ? printFormula(o.amount) : '';
    // the amount as it came, kept while its text is not changed: "-10" reads back as a negation of 10, the same number in another tree
    r.amount = o.amount; r.shown = JSON.stringify(r.mode === 'rank' ? r.tiers : r.q);
  } else if (numberRow(r)) {
    if (o.op === 'refund') r.chance = String(o.chance ?? '');
    const v = o[specOf(r).key];
    if (isTiers(v)) { r.mode = 'rank'; r.tiers = v.map(x => typed(o.op, x)); r.q = r.tiers[0]; } else r.q = v === undefined ? '' : typed(o.op, v);
  } else if (o.op === 'applyStatus') {
    const rounds = d => (d ? String(roundsOf(d, rules(), 'near')) : '');
    r.status = o.key || ''; r.def = o.def || null;
    r.follow = o.follow === true || (!o.def && !!r.status);
    const defCut = r.def && !hasTieredGrievousCut(r.def) ? grievousCutOf(r.def) : null;
    r.gwCut = !r.follow && defCut !== null ? String(defCut) : '';
    if (isTiers(o.duration)) { r.mode = 'rank'; r.tiers = o.duration.map(rounds); r.rounds = r.tiers[0]; } else r.rounds = rounds(o.duration);
  } else if (o.op === 'cureStatus') r.status = o.key || '';
  else if (o.op === 'note') r.text = o.text || '';
  else if (o.op === 'channel') r.chMode = o.mode;
  else if (o.op === 'aura') { r.q = String(o.radius); r.on = o.on; }
  else if (o.op === 'spread') r.q = String(o.range);
  else if (o.op === 'boost') r.q = String(o.die.kind === 'die' ? o.die.sides : o.die.n);
  else if (o.op === 'shove') r.q = String(o.tiles);
  else if (o.op === 'move') r.q = o.take === 'all' ? '' : String(o.take);
  else if (o.op === 'hasten' || o.op === 'guard' || o.op === 'stagger') r.q = String(Math.round(o.share * 1000) / 10);
  else if (o.op === 'echo') r.q = String(o.radius);
  else if (!PLAIN_KINDS.includes(o.op) && o.op !== 'edge' && o.op !== 'dispel' && o.op !== 'stayHidden') return { ...r, kind: 'keep', keep: o };
  return r;
}
const tierName = (t, item) => (item ? RARITIES[t] : `rank ${RANKS[t]}`);
/**
 * A lasting row's op, or what is wrong with it: each formula (one, or one by rank) reads only its bearer's own numbers
 * (`bareRefusal`'s words), and a written number keeps the bounds its number row had (`specOf`: whole unless the key is a
 * share, within the rule, not 0 at every rank), kept as a number. A formula that reads a name is held to the rule's
 * bound where it is read (standing.ts `sheetOpCap`).
 */
function checkLasting(r, amount, item, fail, ok) {
  const spec = specOf(r), all = isTiers(amount) ? amount : [amount];
  const words = spec.decimal ? `Write a number from ${spec.lo} to ${spec.hi}, or a formula on its bearer's numbers.` : `Write a whole number from ${spec.lo} to ${spec.hi}, or a formula on its bearer's numbers.`;
  const wrong = f => { const n = flatOf(f); return bareRefusal(f) ?? (n !== null && (n < spec.lo || n > spec.hi || (!spec.decimal && !Number.isInteger(n))) ? words : null); };
  const bad = all.flatMap((f, i) => (wrong(f) ? [i] : []));
  if (bad.length) return fail(isTiers(amount) ? `At ${tierName(bad[0], item)}: ${wrong(all[bad[0]])}` : wrong(amount), isTiers(amount) ? bad : []);
  if (all.every(f => flatOf(f) === 0)) return fail(isTiers(amount) ? 'Not 0 at every rank.' : 'Not 0.');
  const flat = f => { const n = flatOf(f); return n === null ? f : num(n); };
  const out = isTiers(amount) ? amount.map(flat) : flat(amount);
  return ok(r.kind === 'stat' ? { op: 'stat', key: r.stat, amount: out } : { op: 'sheet', key: r.sheetKey, amount: out });
}
/**
 * The op a row holds, or what is wrong with it: `err` the words on the row, `bad` the values by rank that are wrong. A
 * formula is read by `parseFormula` with the rules' dice limits, and its error is the row's.
 */
function checkRow(app, r, item, statusKey = null) {
  const R = rules(), when = r.when ? { when: r.when } : {};
  const fail = (err, bad = []) => ({ op: null, err, bad });
  const ok = op => ({ op, err: '', bad: [] });
  if (r.kind === 'keep') return ok(r.keep);
  if (formulaRow(r)) {
    const read = t => parseFormula(t, R), rank = r.mode === 'rank' && !ONE_FORMULA.includes(r.kind);
    let amount;
    if (r.amount && JSON.stringify(r.mode === 'rank' ? r.tiers : r.q) === r.shown) amount = r.amount;
    else if (rank) {
      const all = r.tiers.map(read), bad = all.flatMap((p, i) => ('error' in p ? [i] : []));
      if (bad.length) return fail(`At ${tierName(bad[0], item)}: ${/** @type {any} */ (all[bad[0]]).error}`, bad);
      amount = all.map(p => /** @type {any} */ (p).formula);
    } else {
      const p = read(r.q);
      if ('error' in p) return fail(p.error);
      amount = p.formula;
    }
    if (r.kind === 'shield') return ok({ op: 'shield', amount });
    if (lasting(r)) return checkLasting(r, amount, item, fail, ok);
    return ok({ op: r.kind, ...(r.kind === 'damage' ? { type: r.type } : {}), amount, ...when });
  }
  if (numberRow(r)) {
    const spec = specOf(r, statusKey), lo = spec.lo, hi = spec.hi;
    const read = t => {
      const s = String(t).trim(), n = Number(s);
      if (s === '' || !Number.isFinite(n) || n < lo || n > hi || (!spec.decimal && !Number.isInteger(n))) return null;
      return spec.rounds ? Math.round(n * R.fight.round) : n;
    };
    const words = spec.decimal ? `Write a number of rounds from ${lo} to ${hi}.` : `Write a whole number from ${lo} to ${hi}.`;
    let v;
    if (r.mode === 'rank') {
      const all = r.tiers.map(read), bad = all.flatMap((n, i) => (n === null ? [i] : []));
      if (bad.length) return fail(`At ${tierName(bad[0], item)}: ${words}`, bad);
      if (!spec.zero && all.every(n => n === 0)) return fail('Not 0 at every rank.');
      v = all;
    } else {
      v = read(r.q);
      if (v === null) return fail(words);
      if (v === 0 && !spec.zero) return fail('Not 0.');
    }
    if (r.kind === 'sheet') return ok({ op: 'sheet', key: r.sheetKey, amount: v });
    if (r.kind === 'share') return ok({ op: 'share', on: r.shareOn, pct: v });
    if (r.kind === 'hidden') return ok({ op: 'hidden', level: v, start: r.start, ends: { ...r.ends } });
    if (r.kind === 'refund') {
      const t = String(r.chance).trim(), c = Number(t);
      if (!(t !== '' && Number.isInteger(c) && c >= 1 && c <= 100)) return fail('Enter a whole percentage from 1 to 100.');
      return ok({ op: 'refund', pct: v, chance: c });
    }
    return ok({ op: r.kind, [spec.key]: v });
  }
  if (PLAIN_KINDS.includes(r.kind)) return ok({ op: r.kind });
  const K = R.fight.kit, wholeIn = (t, lo, hi) => { const x = String(t).trim(), n = Number(x); return x !== '' && Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
  if (r.kind === 'edge') {
    const tag = r.side === 'attack' ? r.tag.trim().toLowerCase() : '';
    if (tag && !(TAG_RE.test(tag) && tag.length <= K.tagLength)) return fail(`A tag must be one word or hyphenated words, up to ${K.tagLength} characters. Leave empty to match any ability.`);
    return ok({ op: 'edge', side: r.side, keep: r.edgeKeep, tag: tag || null, spend: !!r.spend });
  }
  if (r.kind === 'boost') {
    const n = wholeIn(r.q, r.dieMode === 'die' ? 2 : 1, K.boostSides);
    if (n === null) return fail(r.dieMode === 'die' ? `Write the die's sides, from 2 to ${K.boostSides}.` : `Write the number, from 1 to ${K.boostSides}.`);
    return ok({ op: 'boost', side: r.side, die: r.dieMode === 'die' ? { kind: 'die', sides: n } : { kind: 'face', n } });
  }
  if (r.kind === 'shove') {
    const n = wholeIn(r.q, 1, K.shoveMax);
    return n === null ? fail(`Write the tiles, from 1 to ${K.shoveMax}.`) : ok({ op: 'shove', dir: r.dir, from: r.from, tiles: n });
  }
  if (r.kind === 'move') {
    const take = String(r.q).trim() === '' ? 'all' : wholeIn(r.q, 1, K.stackCap);
    if (take === null) return fail(`Enter 1 to ${K.stackCap} stacks to move, or leave empty to move all.`);
    return ok({ op: 'move', key: r.moveKey, take, from: r.moveFrom, as: r.as || null });
  }
  if (r.kind === 'hasten' || r.kind === 'guard') {
    const x = String(r.q).trim(), n = Number(x);
    if (x === '' || !Number.isFinite(n) || n < 0 || n > 100) return fail('Write a percent from 0 to 100.');
    return ok({ op: r.kind, share: n / 100 });
  }
  if (r.kind === 'stagger') {
    // the most of a bar one op fills (keystones A.7)
    const hi = Math.round(K.staggerOpMax * 1000) / 10, x = String(r.q).trim(), n = Number(x);
    if (x === '' || !Number.isFinite(n) || n <= 0 || n > hi) return fail(`Enter a percentage above 0 and up to ${hi}.`);
    return ok({ op: 'stagger', share: n / 100 });
  }
  if (r.kind === 'echo') {
    const n = wholeIn(r.q, 1, R.fight.fieldRadiusMax);
    return n === null ? fail(`Enter a whole number of tiles from 1 to ${R.fight.fieldRadiusMax}.`) : ok({ op: 'echo', radius: n });
  }
  if (r.kind === 'dispel') return ok({ op: 'dispel', which: r.which === 'all' ? 'all' : 'first' });
  if (r.kind === 'stayHidden') return ok({ op: 'stayHidden', on: r.stayOn });
  if (r.kind === 'channel') return ok({ op: 'channel', mode: r.chMode === 'break' ? 'break' : 'protect' });
  if (r.kind === 'aura' || r.kind === 'spread') {
    // the rules' widest aura and longest spread (design 4.8)
    const hi = r.kind === 'aura' ? R.fight.fieldRadiusMax : R.fight.spreadRangeMax, t = String(r.q).trim(), n = Number(t);
    if (!(t !== '' && Number.isInteger(n) && n >= 1 && n <= hi)) return fail(`Enter a whole number of tiles from 1 to ${hi}.`);
    return ok(r.kind === 'aura' ? { op: 'aura', radius: n, on: oneOf(r.on, ['all', 'allies', 'foes'], 'all') } : { op: 'spread', range: n });
  }
  if (r.kind === 'note') {
    const text = r.text.replace(/\s+/g, ' ').trim();
    return text && text.length <= 200 ? ok({ op: 'note', text }) : fail('Enter a note (up to 200 characters).');
  }
  if (!r.status) return fail('Pick a status.');
  const st = String(r.addStacks).trim(), stacks = st === '' ? undefined : wholeIn(st, 1, K.stackAdd);
  if (stacks === null) return fail(`Stacks go from 1 to ${K.stackAdd}. Leave it empty for ${r.kind === 'cureStatus' ? 'all of them' : 'one'}.`);
  const more = stacks === undefined ? {} : { stacks };
  if (r.kind === 'cureStatus') return ok({ op: 'cureStatus', key: r.status, ...more });
  const rawCondDef = Object.hasOwn(R.conditions, r.status) ? R.conditions[r.status] : null;
  const condDef = rawCondDef ? app.api.effects.liveStatusDef(rawCondDef, 1) : null;
  const baseDef = (r.follow ? condDef : null) || r.def || condDef;
  if (!baseDef) return fail('Pick a status.');
  const canCut = !hasTieredGrievousCut(baseDef) && grievousCutOf(baseDef) !== null;
  const baseCut = canCut ? grievousCutOf(baseDef) : null;
  const savedCut = !r.follow && r.def && !hasTieredGrievousCut(r.def) ? grievousCutOf(r.def) : null;
  const isGw = isGrievousKey(r.status);
  const gwCap = isGw ? grievousCapPct() : shareCapPct(R);
  const gwHi = !isGw && savedCut !== null ? Math.max(gwCap, Math.floor(savedCut)) : gwCap;
  const rawCut = String(r.gwCut).trim();
  const keptCut = canCut && rawCut !== '' && savedCut !== null && rawCut === String(savedCut);
  const cut = canCut && rawCut !== '' && !keptCut ? wholeIn(rawCut, GRIEVOUS_MIN, gwHi) : null;
  if (canCut && rawCut !== '' && !keptCut && cut === null) {
    return fail(isGw
      ? `Healing cut must be a whole number from ${GRIEVOUS_MIN} to ${gwCap}.`
      : gwHi > gwCap
        ? `Healing cut must be a whole number from ${GRIEVOUS_MIN} to ${gwCap} (the share cap), or no higher than its current ${gwHi}%.`
        : `Healing cut must be a whole number from ${GRIEVOUS_MIN} to ${gwCap} (the share cap).`);
  }
  const condCut = condDef && !hasTieredGrievousCut(condDef) ? grievousCutOf(condDef) : null;
  const maxCut = isGw ? GRIEVOUS_MAX : GRIEVOUS_LEGACY_MAX;
  const follow = condDef !== null && (canCut ? rawCut === '' : r.follow);
  const def = follow ? condDef
    : !canCut || keptCut ? baseDef
    : cut !== null ? (cut === baseCut ? baseDef : withGrievousCut(baseDef, cut, maxCut))
    : condCut !== null && condCut !== baseCut ? withGrievousCut(baseDef, condCut, maxCut) : baseDef;
  const live = follow ? { follow: true } : {};
  if (r.mode === 'rank') {
    const all = r.tiers.map(x => { const t = String(x).trim(), n = Number(t); return t !== '' && Number.isInteger(n) && n >= 1 && n <= 999 ? n * R.fight.round : null; });
    const bad = all.flatMap((n, i) => (n === null ? [i] : []));
    if (bad.length) return fail(`At ${tierName(bad[0], item)}: rounds go from 1 to 999.`, bad);
    return ok({ op: 'applyStatus', key: r.status, def, duration: all, ...more, ...live });
  }
  const t = r.rounds.trim(), n = Number(t);
  if (t !== '' && !(Number.isInteger(n) && n >= 1 && n <= 999)) return fail('Rounds must be from 1 to 999. Leave empty so it lasts until removed.');
  return ok({ op: 'applyStatus', key: r.status, def, duration: t === '' ? null : n * R.fight.round, ...more, ...live });
}

/**
 * The effects editor in `box`: one row per op. `kind` picks the ops a row may be and the quick chips; 'item' labels the
 * six values of "By rank" with the rarities. It raises an `input` event on `box` after each change of its own, so a shell redraws.
 * @param {import('./app.ts').App} app @param {HTMLElement} box @param {{ ops?: unknown; kind: 'status' | 'item' | 'skill' | 'land'; event?: string | null; statusKey?: string | null; newStatus?: () => Promise<{ key: string; def?: unknown } | null> }} o
 */
function effects(app, box, o) {
  const item = o.kind === 'item', defaultWhen = item || o.kind === 'land' ? 'use' : null, statusKey = o.statusKey ?? null;
  /** The ops a new row may be here (core's `opsOffered`): an echo only in a trigger on a status gained or imposed. */
  const offered = () => opsOffered(ROW_KINDS[o.kind], o.event ?? null);
  /** A row's own kind is always listed, so an echo kept after the trigger's event changed is shown, not dropped. */
  const kindsOf = r => (offered().includes(r.kind) || !ROW_KINDS[o.kind].includes(r.kind) ? offered() : [...offered(), r.kind]);
  const idle = r => r.kind === 'echo' && !offered().includes('echo');
  const rows = (Array.isArray(o.ops) ? o.ops : []).flatMap(x => parseOp(x, rules()) || []).map(rowOf);
  const tierLabels = item ? RARITIES.map(r => [RARITY_SHORT[r], r]) : RANKS.map(r => [r, `rank ${r}`]);
  const statuses = () => Object.entries(rules().conditions).filter(([k]) => !isStateChip(k)).map(([k, c]) => [k, String((c && c.label) || k)]);
  const raise = () => box.dispatchEvent(new Event('input', { bubbles: true }));
  const seg = (attr, label, options, value) => `<div class="mk-chips mk-modes seg" role="group" aria-label="${esc(label)}">${options.map(([v, l]) => `<button type="button" class="mk-chip" ${attr}="${v}" aria-pressed="${v === value}">${esc(l)}</button>`).join('')}</div>`;
  /** A one-of-n row that sets the row's field `f` (a click sets `rows[i][f]`). */
  const segF = (f, label, options, value) => seg(`data-set="${f}" data-v`, label, options, value);
  const defOf = key => (Object.hasOwn(rules().conditions, key) ? rules().conditions[key] : null);
  const stacking = r => { const d = r.def || defOf(r.status); return !!(d && d.stack); };
  const smallNum = (f, label, value, o2 = {}) => `<label class="field"><span class="lbl">${esc(label)}</span><input type="number" inputmode="${o2.decimal ? 'decimal' : 'numeric'}" step="${o2.decimal ? 'any' : '1'}" data-f="${f}" aria-label="${esc(o2.aria || label)}" value="${esc(value)}"${o2.placeholder ? ` placeholder="${esc(o2.placeholder)}"` : ''}></label>`;

  const statusSelect = (r, i, withNew) => {
    const list = statuses(); if (r.status && !list.some(([k]) => k === r.status)) list.push([r.status, (r.def && r.def.label) || r.status]);
    return `<select data-f="status" data-pick aria-label="Status of effect ${i + 1}"><option value=""${r.status ? '' : ' selected'}>Pick a status</option>${list.map(([k, l]) => `<option value="${esc(k)}"${k === r.status ? ' selected' : ''}>${esc(l)}</option>`).join('')}${withNew ? `<option value="${NEW_STATUS}">New status…</option>` : ''}</select>`;
  };
  function rowHtml(r, i) {
    if (r.kind === 'keep') {
      return `<div class="mk-fx" data-row="${i}"><div class="mk-fx-top"><span class="mk-keep">${esc(opLines([r.keep], null, rules()).join('; ') || r.keep.op)}</span>
        <button type="button" class="icon-btn" data-rm aria-label="Remove effect ${i + 1}">&times;</button></div><p class="mk-fx-err" data-err role="alert"></p></div>`;
    }
    const one = ONE_FORMULA.includes(r.kind), formula = formulaRow(r), number = numberRow(r), what = KIND_LABEL[r.kind];
    const decimal = number && specOf(r).decimal;
    const modes = (formula && !one) || number || r.kind === 'applyStatus' ? [['flat', 'Same at every rank'], ['rank', item ? 'By rarity' : 'By rank']] : [];
    const input = (attrs, label, value) => (number
      ? `<input type="number" inputmode="${decimal ? 'decimal' : 'numeric'}" step="${decimal ? 'any' : '1'}" ${attrs} aria-label="${esc(label)}" value="${esc(value)}">`
      : `<input type="text" autocomplete="off" spellcheck="false" ${attrs} aria-label="${esc(label)}" value="${esc(value)}">`);
    const placeholder = number ? (NUMBERS[r.kind].placeholder ?? (NUMBERS[r.kind].rounds ? 'Rounds, e.g. 0.5' : '−20')) : lasting(r) ? '10 or 0.1 * hpmax' : '2d6 + 1';
    /** A labelled group of buttons: a `div`, so a tap on its label presses none of them. */
    const group = (label, inner) => `<div class="field"><span class="lbl">${esc(label)}</span>${inner}</div>`;
    const K = rules().fight.kit, stacksIn = r.kind === 'applyStatus' || r.kind === 'cureStatus'
      ? (stacking(r) || r.addStacks ? smallNum('addStacks', r.kind === 'applyStatus' ? 'Stacks added' : 'Stacks removed', r.addStacks, { aria: `Stacks of effect ${i + 1}`, placeholder: r.kind === 'applyStatus' ? '1' : 'All' }) : '') : '';
    const gwDef = r.kind === 'applyStatus' ? ((r.follow ? defOf(r.status) : null) || r.def || defOf(r.status)) : null;
    const gwBaseCut = gwDef && !hasTieredGrievousCut(gwDef) ? grievousCutOf(gwDef) : null;
    const gwCond = r.kind === 'applyStatus' ? defOf(r.status) : null;
    const gwCondCut = gwCond && !hasTieredGrievousCut(gwCond) ? grievousCutOf(gwCond) : null;
    const gwIsGw = isGrievousKey(r.status);
    const gwSavedCut = !r.follow && r.def && !hasTieredGrievousCut(r.def) ? grievousCutOf(r.def) : null;
    const gwCap = gwIsGw ? grievousCapPct() : shareCapPct(rules());
    const gwHi = !gwIsGw && gwSavedCut !== null ? Math.max(gwCap, Math.floor(gwSavedCut)) : gwCap;
    const gwPlaceholder = gwBaseCut !== null ? Math.min(gwCondCut ?? gwBaseCut, gwCap) : null;
    const gwIn = gwBaseCut !== null
      ? `<label class="field"><span class="lbl">Healing cut (%)</span><input type="number" inputmode="numeric" step="1" min="${GRIEVOUS_MIN}" max="${gwHi}" data-f="gwCut" aria-label="Healing cut of effect ${i + 1}" value="${esc(r.gwCut)}" placeholder="${esc(gwPlaceholder)}"></label>`
      : '';
    let body = '';
    if (formula || number) {
      if (r.mode === 'rank' && !one) body = `<div class="mk-tiers">${tierLabels.map(([short, full], t) => `<label class="mk-tier"><span>${esc(short)}</span>${input(`data-t="${t}"`, `${what} at ${full}`, r.tiers[t])}</label>`).join('')}</div>`;
      else body = input(`data-f="q" placeholder="${placeholder}"`, `${what} ${number ? 'value' : 'amount'}`, r.q);
      if (number && NUMBERS[r.kind].label) body = group(NUMBERS[r.kind].label, body);
      if (r.kind === 'refund') body += `<label class="field"><span class="lbl">Chance (%)</span><input type="number" inputmode="numeric" step="1" min="1" max="100" data-f="chance" aria-label="Chance of effect ${i + 1}" value="${esc(r.chance)}"></label>`;
      if (formula && (r.mode !== 'rank' || one)) body += `${growsRow(i)}<p class="mk-avg" data-words></p><p class="mk-avg" data-avg></p>`;
      if (r.kind === 'hidden') {
        body += group('Starts', segF('start', `Where effect ${i + 1} may start`, START_LABEL, r.start));
        body += group('Ends when', `<div class="mk-chips" role="group" aria-label="What ends effect ${i + 1}">${STEALTH_END_LABEL.map(([e, l]) => `<button type="button" class="mk-chip" data-end="${e}" aria-pressed="${!!r.ends[e]}">${esc(l)}</button>`).join('')}</div>`);
      }
    } else if (r.kind === 'applyStatus' && r.mode === 'rank') {
      const rounds = (attrs, label, value) => `<input type="number" min="1" max="999" step="1" inputmode="numeric" ${attrs} aria-label="${esc(label)}" value="${esc(value)}">`;
      body = `${statusSelect(r, i, !!o.newStatus)}<div class="mk-tiers">${tierLabels.map(([short, full], t) => `<label class="mk-tier"><span>${esc(short)}</span>${rounds(`data-t="${t}"`, `Rounds of effect ${i + 1} at ${full}`, r.tiers[t])}</label>`).join('')}</div>`;
    } else if (r.kind === 'applyStatus') body = `<div class="mk-fx-two">${statusSelect(r, i, !!o.newStatus)}<input type="number" min="1" max="999" step="1" inputmode="numeric" data-f="rounds" aria-label="Rounds of effect ${i + 1}" placeholder="Until removed" value="${esc(r.rounds)}"></div>`;
    else if (r.kind === 'cureStatus') body = statusSelect(r, i, false);
    else if (r.kind === 'edge') {
      body = `${segF('side', `Which rolls of effect ${i + 1}`, SIDE_LABEL, r.side)}${segF('edgeKeep', `Which die is kept, effect ${i + 1}`, KEEP_LABEL, r.edgeKeep)}
        ${r.side === 'attack' ? `<label class="field"><span class="lbl">Only abilities tagged (optional)</span><input type="text" maxlength="${K.tagLength}" autocomplete="off" spellcheck="false" data-f="tag" aria-label="Tag of effect ${i + 1}" placeholder="any ability" value="${esc(r.tag)}"></label>` : ''}
        <label class="mk-check"><input type="checkbox" data-f="spend"${r.spend ? ' checked' : ''}><span>Consumed after one roll</span></label>`;
    } else if (r.kind === 'boost') body = `${segF('side', `Which rolls of effect ${i + 1}`, SIDE_LABEL, r.side)}${segF('dieMode', `Die of effect ${i + 1}`, DIE_LABEL, r.dieMode)}${smallNum('q', r.dieMode === 'die' ? 'Sides' : 'Number', r.q, { aria: `Die of effect ${i + 1}` })}`;
    else if (r.kind === 'shove') body = `${segF('dir', `Push or pull, effect ${i + 1}`, DIR_LABEL, r.dir)}${segF('from', `From where, effect ${i + 1}`, FROM_LABEL, r.from)}${smallNum('q', 'Tiles', r.q, { aria: `Tiles of effect ${i + 1}` })}`;
    else if (r.kind === 'move') {
      const list = statuses(), opt = (k, l, v) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(l)}</option>`;
      body = `<select data-f="moveKey" data-pick aria-label="What effect ${i + 1} moves">${opt('harmful', 'The first harmful status', r.moveKey)}${opt('event', 'The status that set it off', r.moveKey)}${list.map(([k, l]) => opt(k, l, r.moveKey)).join('')}</select>
        ${segF('moveFrom', `Which way, effect ${i + 1}`, MOVE_FROM_LABEL, r.moveFrom)}
        <div class="mk-two">${smallNum('q', 'Stacks', r.q, { aria: `Stacks effect ${i + 1} moves`, placeholder: 'All' })}<label class="field"><span class="lbl">Arrives as</span><select data-f="as" data-pick aria-label="Effect ${i + 1} arrives as">${opt('', 'The same status', r.as)}${list.map(([k, l]) => opt(k, l, r.as)).join('')}</select></label></div>`;
    } else if (r.kind === 'hasten' || r.kind === 'guard') body = smallNum('q', r.kind === 'hasten' ? 'Move turn sooner (%)' : 'Damage reduced (%)', r.q, { aria: `Percent of effect ${i + 1}`, decimal: true });
    else if (r.kind === 'stagger') body = `${smallNum('q', 'Stagger bar fill (%)', r.q, { aria: `Share of the stagger bar, effect ${i + 1}`, decimal: true })}<p class="mk-avg">Only elite and boss monsters have a stagger bar. One effect can fill at most ${Math.round(K.staggerOpMax * 100)}% of it.</p>`;
    else if (r.kind === 'echo') body = `${smallNum('q', 'Range (tiles)', r.q, { aria: `Reach of effect ${i + 1}` })}${idle(r) ? '<p class="mk-fx-err" role="note">Does nothing here. Echo only works in a trigger for gaining or applying a status.</p>' : ''}<p class="mk-avg">Works only in a trigger when a status is gained or applied. Copies that status with the same duration onto the nearest ally or foe on that side who does not have it. It does not chain.</p>`;
    else if (r.kind === 'dispel') body = segF('which', `Which harmful statuses, effect ${i + 1}`, WHICH_LABEL, r.which);
    else if (r.kind === 'stayHidden') body = group('Stays hidden when', segF('stayOn', `What effect ${i + 1} keeps from ending a hide`, STEALTH_END_LABEL, r.stayOn));
    else if (r.kind === 'note') body = `<input type="text" maxlength="200" autocomplete="off" data-f="text" aria-label="Note of effect ${i + 1}" placeholder="What the GM rules on" value="${esc(r.text)}">`;
    else if (r.kind === 'channel') body = seg('data-channel', `Channel of effect ${i + 1}`, CHANNEL_LABEL, r.chMode);
    else if (r.kind === 'aura' || r.kind === 'spread') {
      const tilesIn = `<label class="field"><span class="lbl">${r.kind === 'aura' ? 'Radius (tiles)' : 'Spread range (tiles)'}</span><input type="number" inputmode="numeric" step="1" min="1" data-f="q" aria-label="${r.kind === 'aura' ? 'Radius' : 'Reach'} of effect ${i + 1}" value="${esc(r.q)}"></label>`;
      body = r.kind === 'aura' ? `${seg('data-on', `Whom effect ${i + 1} reaches`, AURA_LABEL, r.on)}${tilesIn}` : tilesIn;
    }
    return `<div class="mk-fx" data-row="${i}">
      <div class="mk-fx-top"><select data-f="kind" aria-label="Effect ${i + 1}">${kindsOf(r).map(k => `<option value="${k}"${k === r.kind ? ' selected' : ''}>${esc(KIND_LABEL[k])}${idle(r) && k === r.kind ? ' (does nothing here)' : ''}</option>`).join('')}</select>
        ${r.kind === 'stat' ? `<select data-f="stat" aria-label="Stat of effect ${i + 1}">${STAT_KEYS.map(k => `<option value="${k}"${k === r.stat ? ' selected' : ''}>${esc(STAT_LABELS[k])}</option>`).join('')}</select>` : ''}
        ${r.kind === 'sheet' ? `<select data-f="sheetKey" aria-label="Number of effect ${i + 1}">${SHEET_KEY_LABEL.map(([k, l]) => `<option value="${k}"${k === r.sheetKey ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>` : ''}
        <button type="button" class="icon-btn" data-rm aria-label="Remove effect ${i + 1}">&times;</button></div>
      ${r.kind === 'damage' ? `${seg('data-type', `Damage type of effect ${i + 1}`, DAMAGE_CHOICES, r.type)}<p class="mk-avg">${esc(DAMAGE_HELP_LINE)}</p>` : ''}
      ${r.kind === 'share' ? segF('shareOn', `What effect ${i + 1} changes`, SHARE_LABEL, r.shareOn) : ''}
      ${FORMULA_KINDS.includes(r.kind) && o.kind === 'status' ? seg('data-when', `When effect ${i + 1} acts`, WHEN_LABEL, r.when || 'turn') : ''}
      ${modes.length ? seg('data-mode', `Amount of effect ${i + 1}`, modes, r.mode) : ''}
      ${body}${gwIn}${stacksIn}
      <p class="mk-fx-err" data-err role="alert"></p></div>`;
  }
  /** Shows a row's error and marks the values that are wrong; a formula's average at E, C and S on a sample bearer. */
  function mark(i) {
    const el = box.querySelector(`[data-row="${i}"]`); if (!el) return;
    const c = checkRow(app, rows[i], item, statusKey);
    el.querySelector('[data-err]').textContent = c.err;
    el.classList.toggle('bad', !!c.err);
    el.querySelectorAll('[data-t]').forEach(inp => inp.setAttribute('aria-invalid', String(c.bad.includes(Number(inp.dataset.t)))));
    el.querySelectorAll('[data-f=q],[data-f=text],[data-f=status],[data-f=rounds],[data-f=chance],[data-f=tag],[data-f=addStacks],[data-f=gwCut]').forEach(inp => inp.setAttribute('aria-invalid', String(!!c.err && !c.bad.length)));
    const words = el.querySelector('[data-words]');
    if (words) words.textContent = !c.op || !c.op.amount || isTiers(c.op.amount) ? '' : amountLine(c.op.amount);
    const avg = el.querySelector('[data-avg]');
    if (avg) avg.textContent = !c.op || !c.op.amount || isTiers(c.op.amount) ? '' : lasting(rows[i]) ? lastingLine(c.op) : averagesLine(c.op.amount, c.op.op === 'damage' ? c.op.type : null, 'str');
  }
  function render(focusRow) {
    const full = rows.length >= MAX_ROWS;
    box.innerHTML = `<div class="mk-chips" data-quick aria-label="Quick effects">${QUICK[o.kind].map(([id, l]) => `<button type="button" class="mk-chip" data-q="${id}"${full ? ' disabled' : ''}>${esc(l)}</button>`).join('')}</div>
      <div class="mk-fxs">${rows.map(rowHtml).join('')}</div>
      <button type="button" class="mk-add" data-add${full ? ' disabled' : ''}>${full ? `Add effect (${MAX_ROWS} at most)` : 'Add effect'}</button>`;
    rows.forEach((_, i) => mark(i));
    // a new row's field takes the focus with its text selected, so typing replaces the quick chip's amount
    if (focusRow !== undefined) { const f = box.querySelector(`[data-row="${focusRow}"] [data-f=q],[data-row="${focusRow}"] [data-f=text],[data-row="${focusRow}"] [data-f=status]`); if (f) { f.focus(); if (f instanceof HTMLInputElement) f.select(); } }
  }
  const add = r => { if (rows.length >= MAX_ROWS) return; rows.push(r); render(rows.length - 1); raise(); };
  /** A new row of `kind`, each starting at a value that does something: a status of the list for 3 rounds, 1d6, a slow of 10%, a delay of half a round. */
  const blank = kind => {
    const first = statuses()[0], when = defaultWhen ? { when: defaultWhen } : {}, R = rules();
    if (kind === 'applyStatus') return rowOf({ op: 'applyStatus', key: first ? first[0] : '', def: null, duration: 3 * R.fight.round });
    if (kind === 'cureStatus') return rowOf({ op: 'cureStatus', key: first ? first[0] : '' });
    if (kind === 'note' || PLAIN_KINDS.includes(kind)) return rowOf({ op: kind, text: '' });
    if (kind === 'speed') return rowOf({ op: 'speed', pct: -10 });
    if (kind === 'stat') return rowOf({ op: 'stat', key: 'str', amount: num(-4) });
    if (kind === 'delay') return rowOf({ op: 'delay', ticks: R.fight.round / 2 });
    if (kind === 'threat') return rowOf({ op: 'threat', amount: 10 });
    if (kind === 'staggerRate') return rowOf({ op: 'staggerRate', pct: 50 });
    if (kind === 'refund') return rowOf({ op: 'refund', pct: 50, chance: 20 });
    if (kind === 'channel') return rowOf({ op: 'channel', mode: 'protect' });
    if (kind === 'aura') return rowOf({ op: 'aura', radius: R.fight.auraRadius, on: 'all' });
    if (kind === 'spread') return rowOf({ op: 'spread', range: R.fight.spreadRange });
    if (kind === 'shield') return rowOf({ op: 'shield', amount: num(10) });
    const K = R.fight.kit;
    if (kind === 'sheet') return rowOf({ op: 'sheet', key: 'armor', amount: num(10) });
    if (kind === 'share') return rowOf({ op: 'share', on: 'taken', pct: 25 });
    if (kind === 'edge') return rowOf({ op: 'edge', side: 'attack', keep: 'better', tag: null, spend: true });
    if (kind === 'boost') return rowOf({ op: 'boost', side: 'attack', die: { kind: 'die', sides: 6 } });
    if (kind === 'shove') return rowOf({ op: 'shove', dir: 'away', from: 'user', tiles: Math.min(2, K.shoveMax) });
    if (kind === 'move') return rowOf({ op: 'move', key: 'harmful', take: 1, from: 'user', as: null });
    if (kind === 'hasten') return rowOf({ op: 'hasten', share: 0.5 });
    if (kind === 'guard') return rowOf({ op: 'guard', share: K.parry });
    if (kind === 'dispel') return rowOf({ op: 'dispel', which: 'first' });
    if (kind === 'stagger') return rowOf({ op: 'stagger', share: K.staggerOpMax / 2 });
    if (kind === 'echo') return rowOf({ op: 'echo', radius: 2 });
    if (kind === 'hidden') return rowOf(parseOp({ op: 'hidden' }, R));
    if (kind === 'stayHidden') return rowOf({ op: 'stayHidden', on: STEALTH_END_LABEL[0][0] });
    return rowOf({ op: kind, type: 'physical', amount: dice(1, 6), ...when });
  };

  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !box.contains(b)) return;
    const rowEl = b.closest('[data-row]'), i = rowEl ? Number(rowEl.dataset.row) : -1;
    if (b.hasAttribute('data-grow-add')) {
      const term = growTerm(rowEl.querySelector('[data-grow-name]').value, rowEl.querySelector('[data-grow-by]').value); if (!term) return;
      const q = rowEl.querySelector('[data-f=q]'); q.value = q.value.trim() ? `${q.value.trim()} + ${term}` : term;
      q.dispatchEvent(new Event('input', { bubbles: true })); return;
    }
    if (b.dataset.q) {
      const op = /** @type {any} */ (QUICK[o.kind].find(q => q[0] === b.dataset.q)[2]);
      const r = op.op === 'applyStatus' || op.op === 'cureStatus' ? blank(op.op) : rowOf(op);
      r.mirror = mirrorOf(op); return add(r);
    }
    if (b.hasAttribute('data-add')) return add(blank(offered()[0]));
    if (b.hasAttribute('data-rm')) { rows.splice(i, 1); render(); raise(); return; }
    if (b.dataset.type) { rows[i].type = b.dataset.type; render(); raise(); return; }
    if (b.dataset.when) { rows[i].when = b.dataset.when === 'use' ? 'use' : null; render(); raise(); return; }
    if (b.dataset.channel) { rows[i].chMode = b.dataset.channel; render(); raise(); return; }
    if (b.dataset.on) { rows[i].on = b.dataset.on; render(); raise(); return; }
    if (b.dataset.set) { rows[i][b.dataset.set] = b.dataset.v; render(); raise(); return; }
    if (b.dataset.end) { const r = rows[i]; r.ends = { ...r.ends, [b.dataset.end]: !r.ends[b.dataset.end] }; render(); raise(); return; }
    if (b.dataset.mode) {
      const r = rows[i]; if (r.mode === b.dataset.mode) return;
      r.mode = b.dataset.mode;
      const start = r.kind === 'applyStatus' ? r.rounds || '3' : r.q;
      if (r.mode === 'rank' && r.tiers.every(t => t === '')) r.tiers = r.mirror ? [...r.mirror] : blankTiers().map(() => start);
      render(); raise();
    }
  });
  box.addEventListener('change', async e => {
    const t = e.target, rowEl = t.closest && t.closest('[data-row]'); if (!rowEl) return;
    const i = Number(rowEl.dataset.row), r = rows[i];
    if (t.dataset.growName !== undefined) { rowEl.querySelector('[data-grow-unit]').textContent = growUnit(t.value); return; }
    if (t.dataset.f === 'kind') {
      const same = FORMULA_KINDS.includes(t.value) && FORMULA_KINDS.includes(r.kind);
      rows[i] = same ? { ...r, kind: t.value } : blank(t.value);
      render(); raise(); return;
    }
    if (t.dataset.f === 'stat') { r.stat = t.value; mark(i); return; }
    if (t.dataset.f === 'sheetKey') { const was = lasting(r); r.sheetKey = t.value; if (was && !lasting(r)) toNumberRow(r); render(); raise(); return; }
    if (t.dataset.f === 'moveKey' || t.dataset.f === 'as') { r[t.dataset.f] = t.value; mark(i); return; }
    if (t.dataset.f === 'spend') { r.spend = t.checked; mark(i); return; }
    if (t.dataset.f === 'status') {
      if (t.value !== NEW_STATUS) {
        r.status = t.value; r.def = null; r.gwCut = ''; r.follow = true;
        render(); raise(); return;
      }
      const made = o.newStatus ? await o.newStatus() : null;
      if (made && made.key) {
        r.status = made.key; r.def = made.def || null; r.gwCut = ''; r.follow = true;
      }
      render(); raise();
    }
  });
  box.addEventListener('input', e => {
    const t = e.target, rowEl = t.closest && t.closest('[data-row]'); if (!rowEl) return;
    const i = Number(rowEl.dataset.row), r = rows[i]; if (!r) return;
    if (t.dataset.t !== undefined) { r.tiers[Number(t.dataset.t)] = t.value; if (Number(t.dataset.t) === 0) { if (r.kind === 'applyStatus') r.rounds = t.value; else r.q = t.value; } }
    else if (t.dataset.f === 'q') r.q = t.value;
    else if (t.dataset.f === 'rounds') r.rounds = t.value;
    else if (t.dataset.f === 'text') r.text = t.value;
    else if (t.dataset.f === 'chance') r.chance = t.value;
    else if (t.dataset.f === 'tag' || t.dataset.f === 'addStacks' || t.dataset.f === 'gwCut') r[t.dataset.f] = t.value;
    mark(i);
  });
  render();
  return {
    /** The ops the rows hold (a row with an error is left out; `blocked` is then true). */
    ops: () => rows.map(r => checkRow(app, r, item, statusKey)).flatMap(c => (c.op ? [c.op] : [])),
    blocked: () => rows.some(r => !!checkRow(app, r, item, statusKey).err),
    /** The event of the trigger this list lands for changed: the list offers what that event allows, and keeps a row it no longer offers. */
    setEvent(ev) { o.event = ev; render(); },
  };
}

// ── the formula field ──
/** What an ability's effect is, as the GM names it: physical, arcane, or true damage, a heal, a shield, or nothing. */
const EFFECT_TYPES = [...DAMAGE_TYPES.map(t => [t, DAMAGE_WORD[t]]), ['heal', 'Heal'], ['shield', 'Shield'], ['none', 'None']];
/** @type {readonly import('../core/combat/ability-types.ts').AbilityEffectType[]} */
const EFFECT_VALUES = [...DAMAGE_TYPES, 'heal', 'shield'];
const DEFENCE_WORD = { armor: 'Armor', resist: 'Resist' };
/** The kits' formula names (formula.ts, kits design 1.5) a chip inserts; KEY is the status picked beside them. */
const FORMULA_NAMES = [
  ['target.stacks(KEY)', 'Its stacks on the target'], ['stacks(KEY)', 'Its stacks on you'], ['spent', 'Stacks this use spent'], ['field(KEY)', 'Its stacks on everyone'],
  ['held(KEY)', 'Rounds you held it'], ['target.missing', 'Target\'s missing HP share'], ['missing', 'Your missing HP share'], ['hits', 'Targets hit'], ['kills', 'Your kills this fight'],
];
/** A lasting change in words on the maker's sample hunter (`SAMPLE_RANK`): `Armor: +10% of max HP (now 12)`. */
const lastingLine = op => `On a sample rank ${SAMPLE_RANK} hunter: ${opLines([op], 0, rules(), sampleBody(SAMPLE_RANK, 'str', rules())).join('')}`;
/** The averages line of a formula: at E, C and S on a same-rank brute, and after its Armor or Resist for a damage type. */
function averagesLine(f, type, main) {
  const rows = averages(f, type, main, rules()), r = n => String(Math.round(n));
  const def = isDamage(type) ? defenceOf(type) : null;
  const dealt = rows.every(x => x.dealt !== null) && def ? `. After ${DEFENCE_WORD[def]}: ${rows.map(x => r(x.dealt)).join(', ')}` : isDamage(type) && def === null ? '. Ignores Armor and Resist' : '';
  return `Average on a same-rank brute: ${rows.map(x => `${x.rank} ${r(x.average)}`).join(', ')}${dealt}`;
}
/**
 * The formula field in `box`: an ability's effect as text the GM may type over. Its ticks (what it is aimed at, the stat
 * it scales with, a stat gap with its cap) build the kind's recommended formula through `recommended` in core; the pace
 * and the channel come from the ability form (`set`). Typed over, it carries an "edited" mark and a Reset back to the
 * recommendation. The parser's error shows under it and blocks Save; the averages line is redrawn as the GM types.
 * Whether it is edited is the effect's own arm (`by: 'hand'`), never a compare of its text with the recommendation: typing
 * makes it the GM's, Reset gives it back to the rule (implicit audit 3, M2).
 * @param {HTMLElement} box
 * `typed`: a formula the GM typed under another kind, kept as it was typed (edited, its Reset this kind's recommendation).
 * @param {{ kind: import('../core/combat/ability-types.ts').AbilityKind; effect?: import('../core/combat/ability-types.ts').AbilityEffect | null; ticks?: import('../core/registry/ability-kinds.ts').Ticks | null; typed?: { text: string; type: import('../core/combat/ability-types.ts').AbilityEffectType } | null }} o
 */
function formulaField(box, o) {
  const kind = o.kind, typed0 = o.typed || null, hand = o.effect && o.effect.by === 'hand' ? o.effect : null;
  let ticks = o.ticks || defaultTicks(kind, typed0 ? typed0.type : o.effect ? o.effect.type : undefined);
  let type = o.effect === null && !typed0 ? 'none' : o.effect ? o.effect.type : ticks.type, edited = !!hand || !!typed0, scaleTouched = !!o.ticks;
  let gapOn = !!ticks.gap, gap = ticks.gap || gapOf(ticks.type, kind);
  const rec = () => recommended(kind, { ...ticks, gap: gapOn ? gap : null }, rules());
  let text = typed0 ? typed0.text : hand ? printFormula(hand.formula) : rec().text;
  // a typed tree as it came, kept while its text is unchanged ("-10" reads back as a negation: the same number in another tree)
  const kept = hand ? { text, formula: hand.formula } : null;
  const statOpts = (v, none) => `${none ? `<option value=""${v === null ? ' selected' : ''}>Nothing (its dice alone)</option>` : ''}${STAT_KEYS.map(k => `<option value="${k}"${k === v ? ' selected' : ''}>${esc(STAT_LABELS[k])}</option>`).join('')}`;
  const pct = n => String(Math.round(n * 1000) / 10);
  box.innerHTML = `<div class="mk-formula">
    <div class="lbl">What it does</div>
    ${chips('ftype', EFFECT_TYPES.map(([v, l]) => [v, l]), type, { label: 'What it does' })}
    <p class="mk-avg">${esc(DAMAGE_HELP_LINE)}</p>
    <div data-f-has><label class="field"><span class="lbl">Formula <span class="mk-edited" data-edited hidden>edited</span></span>
      <span class="mk-formula-row"><input type="text" data-formula autocomplete="off" spellcheck="false" aria-label="Formula" value="${esc(text)}">
      <button type="button" class="quiet" data-reset hidden>Reset formula</button></span></label>
    <p class="mk-fx-err" data-formula-err role="alert"></p>
    <p class="mk-avg" data-formula-avg></p>
    <details class="mk-group" data-group="ticks"><summary>Build the formula</summary><div class="mk-group-body">
      <label class="field"><span class="lbl">Scales with</span><select data-tick="scale" aria-label="Scales with">${statOpts(ticks.scale, true)}</select></label>
      <label class="mk-check"><input type="checkbox" data-tick="gap"${gapOn ? ' checked' : ''}><span>Grows with a stat gap</span></label>
      <div class="mk-gap" data-gap${gapOn ? '' : ' hidden'}>
        <label class="field"><span class="lbl">The user's</span><select data-gap="mine" aria-label="The user's stat">${statOpts(gap.mine, false)}</select></label>
        <label class="field"><span class="lbl">Over the target's</span><select data-gap="theirs" aria-label="The target's stat">${statOpts(gap.theirs, false)}</select></label>
        <label class="field"><span class="lbl">Bonus % per stat point</span><input type="number" inputmode="decimal" step="any" data-gap="per" aria-label="Bonus a point, percent" value="${pct(gap.per)}"></label>
        <label class="field"><span class="lbl">Max bonus (%)</span><input type="number" inputmode="decimal" step="any" data-gap="cap" aria-label="Cap, percent" value="${pct(gap.cap)}"></label>
      </div>
      <p class="mk-fx-err" data-gap-err role="alert"></p>
      <div class="lbl">More damage by HP (execute and similar)</div>
      <div class="mk-fxs" data-scalers></div>
      <button type="button" class="mk-add" data-add-scaler>Add an HP bonus</button>
    </div></details>
    <details class="mk-group" data-group="names"><summary>Insert a name: stacks, missing HP, kills</summary><div class="mk-group-body">
      <label class="field"><span class="lbl">Of the status</span><select data-name-key data-pick aria-label="Status the names read">${Object.entries(rules().conditions).filter(([k]) => !isStateChip(k)).map(([k, d]) => `<option value="${esc(k)}">${esc(String((d && d.label) || k))}</option>`).join('')}</select></label>
      <div class="mk-chips" data-names>${FORMULA_NAMES.map(([t, l]) => `<button type="button" class="mk-chip" data-insert="${esc(t)}">${esc(l)}</button>`).join('')}</div>
    </div></details></div></div>`;
  const $ = s => box.querySelector(s), input = $('[data-formula]');
  const K = rules().fight.kit;
  /** The scaler rows: each a choice of the family, its start and scale as percents the GM may type over. */
  const scalerRow = sc => ({ name: nameOf(sc), start: String(Math.round(sc.start * 1000) / 10), scale: String(Math.round(sc.scale * 1000) / 10) });
  const scRows = (ticks.scalers || []).map(scalerRow);
  const scErr = () => {
    for (const r of scRows) {
      const a = Number(r.start), b = Number(r.scale);
      if (r.start.trim() === '' || !(a > 0 && a < 100)) return 'Start must be between 0% and 100%.';
      if (r.scale.trim() === '' || !(b >= 0 && b <= 100)) return 'Scale must be from 0% to 100%.';
    }
    return null;
  };
  const scalersNow = () => (scErr() ? ticks.scalers : scRows.map(r => ({ measure: FAMILY[r.name].measure, dir: FAMILY[r.name].dir, start: Number(r.start) / 100, scale: Number(r.scale) / 100 })));
  function drawScalers() {
    $('[data-scalers]').innerHTML = scRows.map((r, i) => {
      const pair = FAMILY[r.name].measure === 'maxPair' || FAMILY[r.name].measure === 'hpPair';
      return `<div class="mk-fx" data-sc="${i}"><div class="mk-fx-top"><select data-sc-f="name" aria-label="Scaler ${i + 1}">${SCALER_CHOICES.map(c => `<option value="${c.name}"${c.name === r.name ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
      <button type="button" class="icon-btn" data-sc-rm aria-label="Remove scaler ${i + 1}">&times;</button></div>
      <div class="mk-two"><label class="field"><span class="lbl">${pair ? 'Starts at (target share %, 50 = equal)' : 'Starts at (% HP)'}</span><input type="number" inputmode="decimal" step="any" data-sc-f="start" aria-label="Scaler ${i + 1} starts at, percent" value="${esc(r.start)}"></label>
      <label class="field"><span class="lbl">Up to (+%)</span><input type="number" inputmode="decimal" step="any" data-sc-f="scale" aria-label="Scaler ${i + 1} up to, percent" value="${esc(r.scale)}"></label></div>
      <button type="button" class="quiet" data-sc-reset>Reset to suggested</button></div>`;
    }).join('') + '<p class="mk-fx-err" data-sc-err role="alert"></p>';
    const add = $('[data-add-scaler]'); add.disabled = scRows.length >= K.scalers;
    $('[data-sc-err]').textContent = scErr() || '';
  }
  const scalersChanged = () => { $('[data-sc-err]').textContent = scErr() || ''; if (!scErr()) { ticks = { ...ticks, scalers: scalersNow() }; follow(); } else draw(); };
  const gapErr = () => (gapOn ? checkGap(gap) : null);
  const read = () => (kept && text === kept.text ? { ok: true, formula: kept.formula } : parseFormula(text, rules()));
  /** Shows the mark, Reset, the parser's error and the averages for the text as it stands. */
  function draw() {
    const p = read(), none = type === 'none';
    $('[data-f-has]').hidden = none;
    $('[data-edited]').hidden = !edited;
    $('[data-reset]').hidden = !edited;
    $('[data-formula-err]').textContent = 'error' in p ? p.error : '';
    input.setAttribute('aria-invalid', String('error' in p));
    $('[data-gap-err]').textContent = gapErr() || '';
    $('[data-gap]').hidden = !gapOn;
    $('[data-formula-avg]').textContent = 'formula' in p && !none ? averagesLine(p.formula, type, ticks.scale || powerStat(ticks.type, kind)) : '';
  }
  /** The text back to the recommendation of the ticks as they stand (unless the GM typed over it). */
  const follow = () => { if (!edited) { text = rec().text; input.value = text; } draw(); };
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !box.contains(b)) return;
    if (b.closest('[data-chips="ftype"]')) {
      type = String(picked(box, 'ftype') || type);
      if (type !== 'none') {
        const was = ticks.type;
        ticks = { ...ticks, type: oneOf(type, EFFECT_VALUES, DAMAGE_TYPES[0]) };
        if (!scaleTouched && ticks.scale === powerStat(was, kind)) ticks = { ...ticks, scale: powerStat(ticks.type, kind) };
        if (!gapOn) gap = gapOf(ticks.type, kind);
        box.querySelector('[data-tick="scale"]').value = ticks.scale || '';
      }
      follow();
    } else if (b.hasAttribute('data-reset')) { edited = false; follow(); input.focus(); box.dispatchEvent(new Event('input', { bubbles: true })); }
    else if (b.hasAttribute('data-add-scaler')) { if (scRows.length < K.scalers) scRows.push(scalerRow(suggestedScaler(kind, 'execute', rules()))); drawScalers(); scalersChanged(); raiseF(); }
    else if (b.hasAttribute('data-sc-rm') || b.hasAttribute('data-sc-reset')) {
      const i = Number(b.closest('[data-sc]').dataset.sc);
      if (b.hasAttribute('data-sc-rm')) scRows.splice(i, 1); else scRows[i] = scalerRow(suggestedScaler(kind, scRows[i].name, rules()));
      drawScalers(); scalersChanged(); raiseF();
    } else if (b.dataset.insert) {
      // a name read by the formula's parser, put where the cursor is: the GM's own text, so the field is marked edited
      const key = $('[data-name-key]').value || 'key', word = b.dataset.insert.replace('KEY', key);
      const at = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? at;
      input.value = input.value.slice(0, at) + word + input.value.slice(end);
      text = input.value; edited = true; draw(); input.focus(); input.setSelectionRange(at + word.length, at + word.length); raiseF();
    }
  });
  const raiseF = () => box.dispatchEvent(new Event('input', { bubbles: true }));
  box.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('[data-formula]')) { text = input.value; edited = true; draw(); return; }
    if (t.dataset.gap === 'per' || t.dataset.gap === 'cap') { gap = { ...gap, [t.dataset.gap]: Number(t.value) / 100 }; follow(); }
    if (t.dataset.scF === 'start' || t.dataset.scF === 'scale') { scRows[Number(t.closest('[data-sc]').dataset.sc)][t.dataset.scF] = t.value; scalersChanged(); }
  });
  box.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.tick === 'scale') { scaleTouched = true; ticks = { ...ticks, scale: t.value ? oneOf(t.value, STAT_KEYS, 'str') : null }; follow(); }
    else if (t.dataset.tick === 'gap') { gapOn = t.checked; follow(); }
    else if (t.dataset.gap === 'mine' || t.dataset.gap === 'theirs') { gap = { ...gap, [t.dataset.gap]: oneOf(t.value, STAT_KEYS, 'str') }; follow(); }
    else if (t.dataset.scF === 'name') { const i = Number(t.closest('[data-sc]').dataset.sc); scRows[i] = scalerRow(suggestedScaler(kind, oneOf(t.value, SCALER_CHOICES.map(c => c.name), 'execute'), rules())); drawScalers(); scalersChanged(); }
  });
  drawScalers();
  draw();
  return {
    /**
     * The effect the field holds: null for Nothing, or while a typed text does not read; by the rule, the ticks as they
     * stand (worked out where it is read); typed over, the formula as typed.
     * @returns {import('../core/combat/ability-types.ts').AbilityEffect | null}
     */
    effect() {
      if (type === 'none') return null;
      if (!edited) return { type: ticks.type, by: 'rule', ticks: ruleTicks({ ...ticks, gap: gapOn ? gap : null }) };
      const p = read(); return 'formula' in p ? { type: ticks.type, by: 'hand', formula: p.formula } : null;
    },
    /** The formula as the GM typed it, when it is typed over (for a new kind to keep), else null. */
    typed: () => (type !== 'none' && edited ? { text, type: ticks.type } : null),
    blocked: () => type !== 'none' && ('error' in read() || !!gapErr() || !!scErr()),
    /** The pace and the channel the ability form picked, which the recommendation reads. A new kind draws a new field. */
    set(change) {
      ticks = { ...ticks, ...change };
      follow();
    },
  };
}

// ── the ability form ──
const PACE_LABEL = [['quick', 'Quick'], ['standard', 'Standard'], ['heavy', 'Heavy']];
const SHAPE_LABEL = [['touch', 'One target'], ['line', 'Line'], ['radius', 'Area']];
const DELIVERY_LABEL = [['travel', 'Can be dodged'], ['direct', 'Resisted by Discipline'], ['sure', 'Cannot be avoided']];
const GROWTH_LABEL = [['linear', 'Linear'], ['exponential', 'Exponential']];
/** Where a field lies (zones.ts `ZoneSpec.around`): on the shape where it lands, or as an aura around its user. */
const WHERE_LABEL = [['lands', 'Where it lands'], ['user', 'Around the user']];
/**
 * The ability form in `box`: the kind fills everything (`abilityOf`), the formula field, then what the GM may change,
 * each group collapsed until opened: cost, reach, how it is avoided, and the channel. The skill maker holds it, and the
 * enemy maker's abilities are edited in the skill maker.
 * @param {import('./app.ts').App} app
 * @param {HTMLElement} box
 * @param {{ kind: import('../core/combat/ability-types.ts').AbilityKind; ability?: import('../core/combat/ability-types.ts').Ability | null; typed?: { text: string; type: import('../core/combat/ability-types.ts').AbilityEffectType } | null; kit?: any }} o
 */
function buildAbility(app, box, o) {
  const R = rules(), round = R.fight.round;
  /** The fields the groups edit; a new kind starts them from the kind's. */
  let kind = o.kind, a = o.ability && o.ability.kind === kind ? o.ability : abilityOf(kind, { id: abilityId('x'), name: '' }, R);
  const ticks0 = o.ability && o.ability.kind === kind ? ticksOf(o.ability, R) : null;
  const num = (v, lo, hi, d) => { const t = String(v).trim(), n = Number(t); return t === '' || !Number.isFinite(n) ? d : Math.max(lo, Math.min(hi, n)); };
  const whole = (v, lo, hi, d) => Math.round(num(v, lo, hi, d));
  const fieldNum = (label, attr, value, o2 = {}) => field(label, `<input type="number" inputmode="${o2.decimal ? 'decimal' : 'numeric'}" step="${o2.decimal ? 'any' : '1'}" ${attr} value="${esc(value)}"${o2.placeholder ? ` placeholder="${esc(o2.placeholder)}"` : ''}>`);
  box.innerHTML = `<div class="mk-ability">
    <div data-formula-box></div>
    <details class="mk-group" data-group="cost"><summary data-sum="cost"></summary><div class="mk-group-body">
      <div class="lbl">Action speed</div>${chips('pace', PACE_LABEL, paceOf(a.cost.time, R), { label: 'Action speed' })}
      <div class="mk-two">${fieldNum('Fatigue', 'data-a="fatigue" min="0" max="1000"', a.cost.fatigue)}${fieldNum('Mana', 'data-a="mana" min="0" max="1000"', a.cost.mana)}</div>
      ${fieldNum('Cooldown (rounds)', 'id="skm-cd" data-a="cooldown" min="0" max="99"', Math.round(a.cost.cooldown / round))}
    </div></details>
    <details class="mk-group" data-group="reach"><summary data-sum="reach"></summary><div class="mk-group-body">
      ${fieldNum('Target range (tiles)', 'data-a="range" min="0" max="64"', a.range)}
      <div class="lbl">Shape</div>${chips('shape', SHAPE_LABEL, a.shape.kind === 'self' ? 'touch' : a.shape.kind, { label: 'Shape' })}
      <div data-shape-f="touch">${fieldNum('Touch reach (tiles)', 'data-a="reach" min="0" max="64"', a.shape.kind === 'touch' ? a.shape.reach : a.range)}</div>
      <div data-shape-f="line" class="mk-two">${fieldNum('Width (tiles each side)', 'data-a="width" min="0" max="64"', a.shape.kind === 'line' ? a.shape.width : 0)}
        <label class="mk-check"><input type="checkbox" data-a="pierce"${a.shape.kind === 'line' && a.shape.pierce ? ' checked' : ''}><span>Pierces through targets</span></label></div>
      <div data-shape-f="radius">${fieldNum('Radius (tiles)', 'data-a="radius" min="0" max="64"', a.shape.kind === 'radius' ? a.shape.radius : 2)}
        <label class="mk-check"><input type="checkbox" data-a="ring"${a.shape.kind === 'radius' && a.shape.ring ? ' checked' : ''}><span>Add an outer splash ring</span></label>
        <div class="mk-two" data-ring-f>${fieldNum('Outer ring radius (tiles)', 'data-a="outer" min="0" max="64"', a.shape.kind === 'radius' && a.shape.ring ? a.shape.ring.outer : 3)}${fieldNum('Outer ring damage (%)', 'data-a="share" min="0" max="100"', a.shape.kind === 'radius' && a.shape.ring ? a.shape.ring.share : Math.round(R.fight.ringShare * 100))}</div></div>
    </div></details>
    <details class="mk-group" data-group="avoid"><summary data-sum="avoid"></summary><div class="mk-group-body">
      ${chips('delivery', DELIVERY_LABEL, a.delivery.kind, { label: 'How it is avoided' })}
      <div class="mk-two" data-travel-f>${fieldNum('Wind-up (rounds)', 'data-a="windup" min="0" max="10"', a.delivery.kind === 'travel' ? a.delivery.windup / round : 0.1, { decimal: true })}${fieldNum('Projectile speed (tiles/round)', 'data-a="speed" min="1" max="1000"', a.delivery.kind === 'travel' && a.delivery.speed !== 'instant' ? a.delivery.speed : '', { placeholder: 'Instant' })}</div>
    </div></details>
    <details class="mk-group" data-group="zone"><summary data-sum="zone"></summary><div class="mk-group-body">
      <label class="mk-check"><input type="checkbox" data-a="zone"${a.zone ? ' checked' : ''}><span>Leaves a field</span></label>
      <div data-zone-f>${chips('zwhere', WHERE_LABEL, a.zone && a.zone.around !== null ? 'user' : 'lands', { label: 'Where it lies' })}
        <div data-zaround-f>${fieldNum('Radius (tiles)', `data-a="zradius" min="1" max="${R.fight.fieldRadiusMax}"`, a.zone && a.zone.around !== null ? a.zone.around : R.fight.auraRadius)}</div>
        <label class="field"><span class="lbl">Field name</span><input type="text" maxlength="40" data-a="zname" value="${esc(a.zone ? a.zone.name : 'Burning ground')}"></label>
        ${fieldNum('Duration (rounds)', 'data-a="zrounds" min="1" max="99"', a.zone ? (a.zone.duration !== null ? roundsOf(a.zone.duration, R, 'near') : '') : 2, { placeholder: 'Until removed' })}
        <label class="mk-check"><input type="checkbox" data-a="zowner"${a.zone && a.zone.endsWithOwner ? ' checked' : ''}><span>Ends when its user is defeated</span></label>
        <label class="mk-check"><input type="checkbox" data-a="zgrow"${a.zone && a.zone.grow ? ' checked' : ''}><span>Grows each round</span></label>
        <div class="mk-two" data-zgrow-f>${fieldNum('Grows by (tiles per round)', `data-a="zstep" min="1" max="${R.fight.fieldRadiusMax}"`, a.zone && a.zone.grow ? a.zone.grow.step : R.fight.fieldGrow)}${fieldNum('Max radius (tiles)', `data-a="zcap" min="1" max="${R.fight.fieldRadiusMax}"`, a.zone && a.zone.grow ? a.zone.grow.cap : R.fight.fieldRadiusMax)}</div>
        <div class="mk-two">${fieldNum('Upkeep: fatigue per round', `data-a="zupf" min="0" max="${R.fight.kit.hpFlat}"`, a.zone && a.zone.upkeep ? a.zone.upkeep.fatigue : 0)}${fieldNum('Upkeep: mana per round', `data-a="zupm" min="0" max="${R.fight.kit.hpFlat}"`, a.zone && a.zone.upkeep ? a.zone.upkeep.mana : 0)}</div>
        <label class="mk-check"><input type="checkbox" data-a="zend"${a.zone && a.zone.end ? ' checked' : ''}><span>Trigger an effect when the field ends</span></label>
        <div data-zend-f><div class="lbl">Effects when the field ends</div><div data-zend-fx></div><p class="mk-fx-err" data-zend-err role="alert"></p></div>
        <div class="lbl">Effects while standing in the field</div><div data-zone-fx></div>
        <div class="lbl">Triggers for creatures inside the field</div><div data-ztrig></div></div>
    </div></details>
    <details class="mk-group" data-group="channel"><summary data-sum="channel"></summary><div class="mk-group-body">
      <label class="mk-check"><input type="checkbox" data-a="channel"${a.channel ? ' checked' : ''}><span>Can be channeled</span></label>
      <div data-channel-f><div class="lbl">Charge scaling</div>${chips('growth', GROWTH_LABEL, a.channel ? a.channel.growth : 'linear', { label: 'Charge scaling' })}
        ${fieldNum('Max charge', `data-a="max" min="1" max="${R.fight.channelMax}"`, a.channel ? a.channel.max : R.fight.channelMax)}</div>
    </div></details>
    <div class="mk-kit-ability" data-kit-ability></div></div>`;
  const $ = s => box.querySelector(s), val = k => $(`[data-a="${k}"]`).value, on = k => $(`[data-a="${k}"]`).checked;
  // the field's ops through the effects editor, a burn of 1d6 a round to start (what Burning deals at E)
  const zfx = effects(app, $('[data-zone-fx]'), { ops: a.zone ? a.zone.ops : [{ op: 'damage', type: 'arcane', amount: dice(1, 6) }], kind: 'status' });
  // what lands when the field ends (zones.ts `ZoneKit.end`), drawn when its box is first ticked and empty until the GM adds to it
  const NO_END = { ops: () => [], blocked: () => false };
  let zendFx = NO_END;
  const zendEditor = () => { if (zendFx === NO_END) zendFx = effects(app, $('[data-zend-fx]'), { ops: a.zone && a.zone.end ? a.zone.end : [], kind: 'land' }); };
  if (a.zone && a.zone.end) zendEditor();
  /** What is wrong with the field's end, or '' (a ticked end with nothing in it lands nothing). */
  const zendErr = () => (!on('zone') || !on('zend') ? '' : zendFx.blocked() ? 'Fix the effect above.' : zendFx.ops().length ? '' : 'Add at least one effect for when the field ends.');
  // the field's triggers (zones.ts `ZoneKit.triggers`): its hold carries them, so they fire for whoever stands in it
  const ztrig = triggerList($('[data-ztrig]'), a.zone && a.zone.triggers ? a.zone.triggers : [], { chips, picked, effects: (b, opts) => effects(app, b, opts) }, 'zt', 'one inside it');
  const ztrigErr = () => (on('zone') ? ztrig.read().err : '');
  const kitA = abilityBlocks($('[data-kit-ability]'), o.kit || (o.ability && o.ability.kind === kind ? a : null), null);
  const ff = formulaField($('[data-formula-box]'), { kind, effect: o.ability && o.ability.kind === kind ? a.effect : undefined, ticks: ticks0, typed: o.typed || null });
  /** The ability's fields as the groups hold them (not its id, name, aim, effect or ops). */
  function read() {
    const shape = oneOf(picked(box, 'shape'), ['touch', 'line', 'radius'], 'touch'), delivery = oneOf(picked(box, 'delivery'), ['travel', 'direct', 'sure'], 'travel');
    const range = tiles(whole(val('range'), 0, 64, a.range));
    const speed = val('speed').trim() === '' ? 'instant' : whole(val('speed'), 1, 1000, 1);
    return {
      cost: { fatigue: whole(val('fatigue'), 0, 1000, 0), mana: whole(val('mana'), 0, 1000, 0), time: paceTime(oneOf(picked(box, 'pace'), ['quick', 'standard', 'heavy'], 'standard'), R), cooldown: tick(whole(val('cooldown'), 0, 99, 0) * round) },
      range,
      shape: shape === 'touch' ? { kind: 'touch', reach: tiles(whole(val('reach'), 0, 64, 1)) }
        : shape === 'line' ? { kind: 'line', width: tiles(whole(val('width'), 0, 64, 0)), pierce: on('pierce') }
        : { kind: 'radius', radius: tiles(whole(val('radius'), 0, 64, 2)), ring: on('ring') ? { outer: tiles(whole(val('outer'), 0, 64, 3)), share: percent(whole(val('share'), 0, 100, 50)) } : null },
      delivery: delivery === 'travel' ? { kind: 'travel', windup: tick(Math.round(num(val('windup'), 0, 10, 0) * round)), speed } : { kind: delivery },
      channel: on('channel') ? { growth: oneOf(picked(box, 'growth'), ['linear', 'exponential'], 'linear'), max: whole(val('max'), 1, R.fight.channelMax, R.fight.channelMax) } : null,
    };
  }
  /** The field the form leaves (a `ZoneSpec`), or null when its box is not ticked. Rounds left empty last until removed. */
  function zoneOf() {
    if (!on('zone')) return null;
    const t = val('zrounds').trim(), name = val('zname').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Field', most = R.fight.fieldRadiusMax;
    const around = picked(box, 'zwhere') === 'user' ? tiles(whole(val('zradius'), 1, most, R.fight.auraRadius)) : null;
    const grow = on('zgrow') ? { step: tiles(whole(val('zstep'), 1, most, R.fight.fieldGrow)), cap: tiles(whole(val('zcap'), 1, most, most)) } : null;
    const hpFlat = R.fight.kit.hpFlat, upF = whole(val('zupf'), 0, hpFlat, 0), upM = whole(val('zupm'), 0, hpFlat, 0);
    return {
      name, duration: t === '' ? null : tick(whole(t, 1, 99, 2) * round), ops: zfx.ops(), endsWithOwner: on('zowner'), around, grow,
      ...(upF || upM ? { upkeep: { fatigue: upF, mana: upM } } : {}), ...(on('zend') ? { end: zendFx.ops() } : {}),
      ...(ztrig.count() ? { triggers: ztrig.read().triggers } : {}),
    };
  }
  /** Shows the fields of the picked shape, delivery and channel, and each group's summary. */
  function draw() {
    const f = read(), shape = f.shape.kind;
    box.querySelectorAll('[data-shape-f]').forEach(el => { el.hidden = el.dataset.shapeF !== shape; });
    $('[data-ring-f]').hidden = !on('ring');
    $('[data-travel-f]').hidden = f.delivery.kind !== 'travel';
    $('[data-channel-f]').hidden = !on('channel');
    $('[data-zone-f]').hidden = !on('zone');
    $('[data-zaround-f]').hidden = picked(box, 'zwhere') !== 'user';
    $('[data-zgrow-f]').hidden = !on('zgrow');
    $('[data-zend-f]').hidden = !on('zend');
    if (on('zend')) zendEditor();
    $('[data-zend-err]').textContent = zendErr();
    const pace = (PACE_LABEL.find(([p]) => p === paceOf(f.cost.time, R)) || PACE_LABEL[1])[1];
    const costs = [f.cost.fatigue ? `${f.cost.fatigue} fatigue` : '', f.cost.mana ? `${f.cost.mana} mana` : ''].filter(Boolean).join(', ') || 'free';
    $('[data-sum="cost"]').textContent = `Cost: ${pace}, ${costs}${f.cost.cooldown ? `, every ${f.cost.cooldown / round} round${f.cost.cooldown === round ? '' : 's'}` : ''}`;
    $('[data-sum="reach"]').textContent = `Reach: ${(SHAPE_LABEL.find(([s]) => s === shape) || SHAPE_LABEL[0])[1].toLowerCase()}, range ${f.range}`;
    $('[data-sum="avoid"]').textContent = `Avoided: ${(DELIVERY_LABEL.find(([d]) => d === f.delivery.kind) || DELIVERY_LABEL[0])[1].toLowerCase()}`;
    $('[data-sum="channel"]').textContent = f.channel ? `Channel: ${f.channel.growth}, up to ${f.channel.max}` : 'Channel: no';
    const z = zoneOf();
    $('[data-sum="zone"]').textContent = z ? `Leaves ${z.name}${z.around === null ? '' : ' around the user'}${z.duration === null ? '' : ` for ${z.duration / round} round${z.duration === round ? '' : 's'}`}${z.grow ? `, growing to ${z.grow.cap} tiles` : ''}${z.upkeep ? ', with an upkeep' : ''}${z.end ? ', triggers when it ends' : ''}${z.triggers ? `, ${z.triggers.length} trigger${z.triggers.length === 1 ? '' : 's'}` : ''}` : 'Leaves a field: no';
  }
  const tell = () => { const f = read(); ff.set({ pace: paceOf(f.cost.time, R), channel: f.channel ? f.channel.growth : null }); draw(); };
  box.addEventListener('click', e => { if (e.target.closest('[data-chips="pace"],[data-chips="growth"],[data-chips="shape"],[data-chips="delivery"],[data-chips="zwhere"]')) tell(); });
  // the field's end editor raises its own input on a row added or changed, so its "Add what lands" goes with the row
  box.addEventListener('input', e => { if (e.target.dataset && (e.target.dataset.a || 'ztrig' in e.target.dataset || 'zendFx' in e.target.dataset)) draw(); });
  box.addEventListener('change', e => { if (e.target.dataset && (e.target.dataset.a === 'channel' || e.target.dataset.a === 'ring')) tell(); else draw(); });
  draw();
  return {
    /** The ability the form holds for this id and name: null while the formula does not read or a gap has no cap. */
    value(id, name) {
      if (ff.blocked() || (on('zone') && zfx.blocked()) || zendErr() || ztrigErr() || kitA.blocked()) return null;
      const z = zoneOf();
      return { id, name, kind, ...read(), aim: a.aim, foesOnly: a.foesOnly, effect: ff.effect(), ops: [], ...(z ? { zone: z } : {}), ...kitA.fields() };
    },
    blocked: () => ff.blocked() || (on('zone') && zfx.blocked()) || !!zendErr() || !!ztrigErr() || kitA.blocked(),
    typed: () => ff.typed(),
    kit: () => kitA.fields(),
  };
}
/**
 * The ability form in `box` (see `buildAbility`). A new kind (`setKind`) draws it again from the kind's defaults, with
 * the groups that were open still open, and a formula the GM typed kept as typed (Reset gives the new kind's).
 * @param {import('./app.ts').App} app
 * @param {HTMLElement} box
 * @param {{ kind: import('../core/combat/ability-types.ts').AbilityKind; ability?: import('../core/combat/ability-types.ts').Ability | null }} o
 */
function abilityForm(app, box, o) {
  let kind = o.kind, cur = null;
  const draw = (ability, typed = null, kit = null) => { const root = document.createElement('div'); box.replaceChildren(root); cur = buildAbility(app, root, { kind, ability, typed, kit }); };
  draw(o.ability || null);
  return {
    value: (id, name) => cur.value(id, name),
    blocked: () => cur.blocked(),
    setKind(k) {
      if (k === kind) return;
      const open = [...box.querySelectorAll('details[open]')].map(d => d.dataset.group);
      const typed = cur.typed(), kit = cur.kit();
      kind = k; draw(null, typed, kit);
      box.querySelectorAll('details').forEach(d => { if (open.includes(d.dataset.group)) d.open = true; });
    },
  };
}

// ── the shell ──
/**
 * The maker dialog of `MakerApi.open`: answers what the body's `save` gives, or null.
 * @template T
 * @param {import('../core/api.ts').MakerOptions<T>} o
 * @returns {Promise<T | null>}
 */
function openMaker(o) {
  return new Promise(resolve => {
    const uid = 'mk' + Math.random().toString(36).slice(2, 7), cls = o.cls || 'mk';
    const el = h(`<div class="overlay sys-overlay show mk-overlay ${cls}-overlay">
      <div class="sys-window mk-win ${cls}-win dlg-form" role="dialog" aria-modal="true" aria-labelledby="${uid}-t"><span class="cb"></span>
        <div class="mk-scroll">
          <div class="n-tag">${esc(o.tag)}</div>
          <h2 class="n-big sys-title mk-title" id="${uid}-t">${esc(o.title)}</h2>
          <div class="mk-body"></div>
        </div>
        <div class="sys-err mk-err" role="alert" data-err></div>
        <div class="sys-actions mk-actions"><button type="button" data-cancel>Cancel</button><button type="button" class="primary" data-apply>${esc(o.save || 'Save')}</button></div>
      </div></div>`);
    const win = el.firstElementChild, bodyEl = win.querySelector('.mk-body'), err = win.querySelector('[data-err]'), ok = win.querySelector('[data-apply]'), scroller = win.querySelector('.mk-scroll');
    const trigger = document.activeElement;
    let previewEl = null;
    /** @type {import('../core/api.ts').MakerBody<T>} */
    let body = { save: () => undefined };
    /**
     * The form's draft (src/core/draft.ts): `clean` until the GM changes it, `edited` after, `asking` while "Discard
     * changes?" is up, `closed` once the window went. It moves only by `step`, and only a step's answer asks or closes.
     * A change is a trusted input or change in the body, a press of its buttons, or a press on a surface it marks
     * `data-mk-paint`; the search above a long list changes no field (its events stop at it), opening a group is not
     * a change, and neither is a button marked `data-mk-look`, which only shows something (the Icon row's sheet, its groups). Cancel and Save are the GM's own choice and close without asking.
     * @type {import('../core/draft.ts').Draft}
     */
    let draft = 'clean';
    /** Moves the draft by `e`; a close answers `v`. */
    function step(e, v = null) {
      const s = draftStep(draft, e);
      draft = s.draft;
      if (s.then === 'close') finish(v);
      else if (s.then === 'ask') void confirm({ title: 'Discard changes?', body: 'Your unsaved changes will be lost.', danger: true, confirmLabel: 'Discard changes' }).then(drop => step(drop ? 'dropped' : 'kept'));
    }
    const shell = {
      el: win,
      changed() {
        if (previewEl && body.preview) {
          const lines = body.preview() || [];
          previewEl.innerHTML = `<div class="lbl">Preview</div>${lines.length ? `<ul class="mk-lines">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="mk-none">Nothing to preview yet.</p>'}`;
        }
        ok.disabled = !!(body.blocked && body.blocked());
      },
      done(v) { step('closed', v); },
      error(text) { err.textContent = text || ''; },
    };
    body = o.build(bodyEl, shell) || body;
    if (body.preview) {
      previewEl = bodyEl.querySelector('[data-mk-preview]') || h('<div data-mk-preview></div>');
      previewEl.classList.add('mk-preview'); previewEl.setAttribute('aria-live', 'polite');
      if (!bodyEl.contains(previewEl)) bodyEl.appendChild(previewEl);
    }

    const save = () => { if (ok.disabled) return; err.textContent = ''; const v = body.save(); if (v !== undefined) step('closed', v); };
    /** @type {import('./ui.js').Win | null} */
    let me = null;
    function finish(v) {
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', fit);
      if (me) closeWindow(me);
      if (trigger && trigger.isConnected && trigger.focus) trigger.focus(); resolve(v);
    }
    const touched = e => { if (e.isTrusted && bodyEl.contains(e.target)) step('changed'); };
    bodyEl.addEventListener('input', touched); bodyEl.addEventListener('change', touched);
    bodyEl.addEventListener('click', e => { if (e.target.closest('button') && !e.target.closest('[data-mk-look]')) touched(e); });
    bodyEl.addEventListener('pointerdown', e => { if (e.isTrusted && e.target.closest('[data-mk-paint]')) step('painted'); });
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); step('leave'); return; }
      if (formEnter(e, bodyEl, save)) return;
      if (e.key === 'Tab') trapTab(e, win);
    }
    // Keeps the dialog inside the visible area when the on-screen keyboard opens or closes, and the field being typed in
    // inside the dialog. The form moves only on that resize, never on a timer, so a tap lands where the GM aimed it.
    function fit() {
      const vv = window.visualViewport; if (!vv) return;
      el.style.height = vv.height + 'px'; el.style.top = vv.offsetTop + 'px'; el.style.bottom = 'auto';
      const f = document.activeElement;
      if (!(f instanceof HTMLElement) || !win.contains(f) || !f.matches('input,select,textarea')) return;
      const seen = scroller.getBoundingClientRect(), at = f.getBoundingClientRect();
      if (at.top < seen.top || at.bottom > seen.bottom) f.scrollIntoView({ block: 'center' });
    }

    // chips are pressed before the body's own click handlers run, so a body reads the new value
    win.addEventListener('click', e => { const c = e.target.closest('[data-chips] [data-chip]'); if (c && win.contains(c)) { press(c); err.textContent = ''; } }, true);
    win.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.closest('[data-chips]')) return shell.changed();
      if (b.matches('[data-cancel]') && b.parentElement.classList.contains('mk-actions')) return step('closed');
      if (b === ok) return save();
    });
    win.addEventListener('input', () => shell.changed());
    win.addEventListener('change', () => shell.changed());
    el.addEventListener('mousedown', e => { if (e.target === el) step('leave'); });
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', fit); fit(); }
    shell.changed();
    me = openWindow('maker', () => { document.body.appendChild(el); enter(win); enter(el, 'fade'); return { root: el, win }; }, onKey);
    // the window opens at its top; a field the person moves to is brought into view by the browser, and above the keyboard by `fit`
    const first = (o.focus && o.focus(win)) || win.querySelector('input,select,textarea') || ok;
    first.focus({ preventScroll: true });
    // The window and the form's first fields are drawn in the tap's frame. A part the build marked `data-later` is in the
    // form (its fields hold their values, the preview and Save read them) but not drawn until a later frame, one part a
    // frame, so no frame styles and lays out the whole form.
    const later = [...win.querySelectorAll('[data-later]')];
    const show = () => { const p = later.shift(); if (!p) return; p.removeAttribute('data-later'); if (later.length) requestAnimationFrame(show); };
    if (later.length) requestAnimationFrame(() => requestAnimationFrame(show));
  });
}

/**
 * The worth bar and line in `box` (worth.ts, kits design 5.1): a bar to one and a half budgets with a mark at the budget,
 * gold past the tolerance, never a refusal. Answers the function that draws a worth, or hides the box on null.
 * @param {HTMLElement} box
 */
function worthBar(box) {
  box.classList.add('mk-worth'); box.setAttribute('data-worth', '');
  box.innerHTML = '<div class="mk-worth-bar"><span data-worth-fill></span><i data-worth-mark></i></div><p data-worth-line></p>';
  box.hidden = true;
  const fill = /** @type {HTMLElement} */ (box.querySelector('[data-worth-fill]')), mark = /** @type {HTMLElement} */ (box.querySelector('[data-worth-mark]'));
  const line = /** @type {HTMLElement} */ (box.querySelector('[data-worth-line]'));
  return w => {
    box.hidden = !w; if (!w) return;
    const most = Math.max(w.budget * 1.5, w.worth, 0.01);
    fill.style.width = `${Math.max(0, Math.min(100, w.worth / most * 100))}%`;
    mark.style.left = `${w.budget / most * 100}%`;
    box.classList.toggle('over', w.over);
    line.textContent = worthLine(w);
  };
}

// ── the Icon row ──
/**
 * The Icon row of the monster, item and status makers, put in `box` (icons design 6): one button that shows the icon in
 * use and a line saying why ("Wolf, from its type", "Raven, picked"). A tap opens a sheet over the maker: a row of the
 * icon groups, the thing's own first, and a grid of 44 px cells, the first "Default" with the default's picture. A tap on
 * a cell picks it and closes the sheet; "Default" stores no key. The row's state is the machine of src/core/icon-pick.ts,
 * kept in `picker` and moved only by `iconPickStep` (`move`). The sheet is the sheet `iconPick` of the window stack (ui.js `sheet`):
 * Escape or a change of tab (`went`) takes it down, Tab stays in it, and a press anywhere beside its panel closes it.
 * It is drawn inside the row, so a tap on a cell is a press in the form, which the maker's draft reads as a change;
 * opening the sheet, a group and its close are marked `data-mk-look` and change nothing. The default follows the form:
 * the line is drawn again from `subject` after each input, change and tap in the maker's window.
 * @param {HTMLElement} box where the row goes, in the maker's body
 * @param {HTMLElement} win the maker's window (`shell.el`)
 * @param {{ thing: import('../core/icon-pick.ts').IconThing; pick?: import('../core/registry/icons.ts').IconKey | null; subject: () => import('../core/icon-pick.ts').IconSubject }} o
 * @returns {{ pick(): import('../core/registry/icons.ts').IconKey | null }}
 */
export function iconField(box, win, o) {
  /** The row's machine (src/core/icon-pick.ts): the pick, and the sheet closed or open at a group. */
  let picker = iconPickStart(o.thing, o.pick || null);
  /** The sheet's overlay while it is up; null while it is closed. @type {HTMLElement | null} */
  let sheetEl = null;
  sprite();
  const first = iconShown(o.subject(), picker.pick);
  box.classList.add('mk-ic');
  box.innerHTML = `<div class="lbl">Icon</div><button type="button" class="mk-ic-open" data-mk-look data-ic-open aria-haspopup="dialog" aria-expanded="false"><span class="mk-ic-box">${icon(first.key)}</span><span class="mk-ic-why">${esc(iconWords(first))}</span></button>`;
  const opener = /** @type {HTMLElement} */ (box.querySelector('[data-ic-open]')), why = box.querySelector('.mk-ic-why'), use = box.querySelector('.mk-ic-box use');
  /** Draws the row from the form and the pick. A changed icon pops in: it is new, and the GM made it so. */
  const line = () => {
    const s = iconShown(o.subject(), picker.pick), words = iconWords(s), href = iconHref(s.key);
    if (use.getAttribute('href') !== href) { use.setAttribute('href', href); void pop(box.querySelector('.mk-ic-box')); }
    if (why.textContent !== words) why.textContent = words;
  };
  /** The sheet's groups and cells for the state now: its group pressed; "Default" with the default's picture, then the group's icons, the pick in use pressed. */
  const paint = root => {
    if (picker.at !== 'open') return;
    const at = picker.group, pick = picker.pick || '', d = iconShown(o.subject(), null);
    for (const b of root.querySelectorAll('[data-ic-group]')) b.setAttribute('aria-pressed', String(b.dataset.icGroup === at));
    const cell = (key, label, inner, cls = '') => `<button type="button" class="mk-ic-cell${cls}" data-ic-key="${key}" aria-label="${esc(label)}" title="${esc(label)}" aria-pressed="${pick === key}">${inner}</button>`;
    root.querySelector('[data-ic-grid]').innerHTML = [cell('', `Default: ${iconWords(d)}`, `${icon(d.key)}<span>Default</span>`, ' mk-ic-def'), ...iconsOf(at).map(k => cell(k, iconDef(k).label, icon(k)))].join('');
  };
  /** Tab stays in the sheet while it is up (Escape is the stack's: `sheet` hands it to `move`). */
  const onKey = e => { if (e.key === 'Tab' && sheetEl) trapTab(e, /** @type {HTMLElement} */ (sheetEl.firstElementChild)); };
  /** Moves the row by `e` and draws what changed: the sheet up, its group, or the sheet gone and the row's line. */
  function move(e) {
    const was = picker;
    picker = iconPickStep(picker, e);
    if (picker === was) return;
    if (picker.at === 'open' && was.at === 'closed') {
      const root = h(`<div class="mk-ic-sheet"><div class="mk-ic-panel" role="group" aria-label="Pick an icon">
        <div class="mk-ic-head"><span class="lbl">Pick an icon</span><button type="button" class="icon-btn" data-mk-look data-ic-shut aria-label="Close icon picker">&times;</button></div>
        <div class="seg mk-ic-groups" role="group" aria-label="Icon categories">${pickerGroups(o.thing).map(g => `<button type="button" data-mk-look data-ic-group="${g}" aria-pressed="false">${esc(GROUP_WORDS[g])}</button>`).join('')}</div>
        <div class="mk-ic-grid" data-ic-grid></div></div></div>`);
      paint(root);
      box.appendChild(root); enter(root.firstElementChild); enter(root, 'fade'); sheetEl = root; root.addEventListener('keydown', onKey);
      sheet('iconPick', true, () => move({ kind: 'shut' }));
      opener.setAttribute('aria-expanded', 'true');
      /** @type {HTMLElement} */ (root.querySelector('.mk-ic-cell[aria-pressed=true]') || root.querySelector('.mk-ic-cell')).focus({ preventScroll: true });
    } else if (picker.at === 'open' && sheetEl) paint(sheetEl);
    else if (sheetEl) {
      sheet('iconPick', false, () => {}); sheetEl.remove(); sheetEl = null;
      opener.setAttribute('aria-expanded', 'false'); opener.focus({ preventScroll: true });
      line();
    }
  }
  // on the window, so the maker's own handlers (in its body) have read the tap or the typing first
  win.addEventListener('click', e => {
    const t = e.target instanceof Element && box.contains(e.target) ? e.target.closest('[data-ic-open],[data-ic-group],[data-ic-key],[data-ic-shut],.mk-ic-sheet') : null;
    if (!t) return line();
    if (t.matches('[data-ic-open]')) move({ kind: 'opened' });
    else if (t.matches('[data-ic-group]')) { const g = oneOf(t.dataset.icGroup, ICON_GROUPS, null); if (g) move({ kind: 'group', group: g }); }
    else if (t.matches('[data-ic-key]')) move({ kind: 'picked', key: oneOf(t.dataset.icKey, ICON_KEYS, null) });
    // its close, or a press on the dimmed page around its panel
    else if (t.matches('[data-ic-shut]') || t === e.target) move({ kind: 'shut' });
  });
  win.addEventListener('input', line);
  win.addEventListener('change', line);
  return { pick: () => picker.pick };
}

/**
 * A pick from a long list (a status or a skill): a select marked `data-pick` with more options than a phone's list shows
 * (`PICK_LONG`, a 640 px screen at 44 px a row) gets a search field above it; what is typed hides the options it does not
 * match, never the chosen one. It is laid on each such select as it reaches the page (`watchPicks`), so every maker, the
 * effects editor and the kits' parts get it without a call of their own.
 */
const PICK_LONG = 14;
function searchable(sel) {
  if (sel.closest('.mk-pick') || sel.options.length <= PICK_LONG) return;
  const box = document.createElement('span'), q = document.createElement('input');
  box.className = 'mk-pick';
  q.type = 'search'; q.className = 'mk-pick-q'; q.placeholder = 'Search'; q.autocomplete = 'off'; q.spellcheck = false;
  q.setAttribute('aria-label', `Search ${sel.getAttribute('aria-label') || 'the list'}`);
  // its typing changes only the list it filters: the form around it reads nothing from it
  for (const type of ['input', 'change']) q.addEventListener(type, e => e.stopPropagation());
  q.addEventListener('input', () => {
    const t = q.value.trim().toLowerCase();
    for (const o of sel.options) o.hidden = !!t && !!o.value && !o.selected && !o.text.toLowerCase().includes(t);
  });
  sel.replaceWith(box);
  box.append(q, sel);
}
/** Lays `searchable` on every `select[data-pick]` now on the page and every one drawn later. */
function watchPicks() {
  const lay = root => { if (root instanceof Element) { if (root.matches('select[data-pick]')) searchable(root); root.querySelectorAll('select[data-pick]').forEach(searchable); } };
  lay(document.body);
  new MutationObserver(list => { for (const m of list) m.addedNodes.forEach(lay); }).observe(document.body, { childList: true, subtree: true });
}

/** @param {import('./app.ts').App} app */
export function register(app) {
  watchPicks();
  css('maker', `
.mk-overlay{align-items:center}
.mk-win{padding:20px 22px 0;text-align:left;display:flex;flex-direction:column;max-height:calc(100% - 8px);overflow:hidden;box-sizing:border-box}
.mk-scroll{overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;min-height:0;flex:1;display:flex;flex-direction:column;gap:8px;padding-bottom:8px;-webkit-overflow-scrolling:touch}
.mk-scroll>*,.mk-body>*{flex-shrink:0}
.mk-err{flex-shrink:0;margin:0;padding-top:8px}.mk-err:empty{min-height:0;padding:0} /* the shell's message, above Cancel and Save at any scroll (openMaker) */
.mk-win [data-later]{display:none!important} /* a part of the form drawn a frame after the window (openMaker) */
.mk-body{display:flex;flex-direction:column;gap:8px}
.mk-win .n-tag{margin-bottom:0}
.mk-title.n-big{font-size:22px;margin:0}
.mk-win input[type=text],.mk-win input[type=number],.mk-win select,.mk-win textarea{width:100%;box-sizing:border-box;min-height:44px}
.mk-win textarea{min-height:56px;resize:vertical}
.mk-chips{display:flex;flex-wrap:wrap;gap:6px}
.mk-chip{min-height:44px;padding:6px 12px;font-size:14px}
.mk-bonus{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.mk-bonus input{width:100%;box-sizing:border-box;min-height:44px}
.mk-preview{border:1px solid var(--line);background:rgba(10,26,46,.55);padding:6px 10px}
@media (min-width:1100px){.mk-preview{position:sticky;bottom:0;background:var(--panel-solid)}} /* two columns: the preview stays in view while the effects scroll */
.mk-lines{margin:4px 0 0;padding-left:18px;font-size:14px;color:var(--ice);overflow-wrap:anywhere}
.mk-none{margin:4px 0 0;font-size:13px;color:var(--cyan-dim)}
.mk-actions{position:sticky;bottom:0;background:var(--panel-solid);padding:10px 0 14px;margin:0;display:flex;gap:10px;border-top:1px solid var(--line)}
.mk-actions button{flex:1;min-height:44px}
.mk-chip.lib{border-color:var(--gold)}
.mk-fxs{display:flex;flex-direction:column;gap:8px}
.mk-fx{display:flex;flex-direction:column;gap:6px;border:1px solid var(--line);background:rgba(10,26,46,.55);padding:8px}
.mk-fx.bad{border-color:var(--red)}
.mk-fx-top{display:flex;gap:6px;align-items:center}
.mk-fx-top select{flex:1 1 0;min-width:0}
.mk-pick{display:flex;flex-direction:column;gap:4px;flex:1 1 0;min-width:0}
.mk-pick .mk-pick-q{width:100%;box-sizing:border-box;min-height:var(--control-h)}
.mk-keep{flex:1 1 0;min-width:0;font-size:14px;color:var(--ice);overflow-wrap:anywhere}
.mk-fx-two{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:6px}
.mk-tiers{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px}
.mk-tier{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--cyan-dim);text-align:center;min-width:0}
.mk-win .mk-tier input{padding:4px 2px;text-align:center;font-size:14px;min-width:0}
.mk-fx-err{margin:0;font-size:13px;color:#ff8a96}.mk-fx-err:empty{display:none}
.mk-win [aria-invalid=true]{border-color:var(--red)}
.mk-add{align-self:flex-start;min-height:44px}
.mk-modes .mk-chip{flex:1 1 0;padding:6px 4px}
.mk-formula{display:flex;flex-direction:column;gap:6px}
.mk-formula-row{display:flex;gap:6px;align-items:stretch}.mk-formula-row input{flex:1 1 0;min-width:0;font-family:var(--font-mono)}
.mk-edited{margin-left:6px;padding:0 6px;border:1px solid var(--gold);color:var(--gold);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.mk-grows{display:flex;flex-direction:column;gap:4px;min-width:0}.mk-grows-row{display:flex;align-items:center;gap:6px;min-width:0}.mk-win .mk-grows select{flex:1 1 0;width:auto;min-width:0}.mk-win .mk-grows input[type=number]{flex:none;width:4.5em}.mk-grows button{flex:none}
.mk-avg{margin:0;overflow-wrap:anywhere;font-size:13px;color:var(--cyan-dim)}.mk-avg:empty{display:none}
.mk-group{border:1px solid var(--line);background:rgba(10,26,46,.55)}
.mk-group>summary{display:flex;align-items:center;padding:0 10px;cursor:pointer;font-size:14px;color:var(--ice)}
.mk-group-body{display:flex;flex-direction:column;gap:8px;padding:0 10px 10px}
.mk-check{display:flex;align-items:center;gap:8px;min-height:var(--control-h);cursor:pointer}.mk-check input{width:20px;height:20px;margin:0}
.mk-gap{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.mk-gap[hidden]{display:none}
.mk-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
@media (min-width:1100px){.mk-win.dlg-form{max-height:min(760px,calc(100vh - 48px));max-height:min(760px,calc(100dvh - 48px))}}
@media (pointer:coarse),(max-width:720px){.mk-scroll{scroll-padding-bottom:12px}}
@media (min-width:721px) and (max-width:1099px) and (max-height:500px){.mk-actions{padding:6px 0 8px}}
@media (max-width:600px){.mk-win{padding:14px 14px 0}.mk-chip{padding:6px 10px}.mk-overlay{--ovp:8px}}
.mk-worth{display:flex;flex-direction:column;gap:4px}
.mk-worth-bar{position:relative;height:8px;border:1px solid var(--line);background:rgba(10,26,46,.55)}
.mk-worth-bar span{position:absolute;left:0;top:0;bottom:0;background:var(--cyan)}
.mk-worth.over .mk-worth-bar span{background:var(--gold)}
.mk-worth-bar i{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--ice)}
.mk-worth p{margin:0;font-size:13px;color:var(--cyan-dim)}.mk-worth.over p{color:var(--gold)}`);

  rewardEditorCss(css);
  css('kit-parts', kitPartsCss);
  app.api.maker = {
    open: openMaker, chips, picked, bonus, readBonus, effects: (box, o) => effects(app, box, o), ability: (box, o) => abilityForm(app, box, o), rewards: (box, o) => rewardEditor(app, box, o),
    statusBlocks: (box, def, name) => statusBlocks(box, def, app.api.maker, name), worth: worthBar,
  };
}
