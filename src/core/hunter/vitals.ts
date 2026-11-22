// vitals.ts: a hunter's life (HP, or dead), mana, fatigue and collapse. Pure.
// One field, `life`, holds HP and death. Its one table of events is `lifeAfter`. The vitals together (life, mana,
// fatigue, the collapse, spent uses) have one machine, `vitalStep`, whose table is `VITAL_TABLE`: a sheet's change goes
// through grant.ts `sheetEdit`, which calls it. The save repair reads a stored hunter in src/core/save.ts. The maxima are
// not stored: the caller reads them from the hunter's sheet and passes them in.
import type { Rules } from '../rules.ts';
import type { AbilityId } from '../combat/ability-types.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';

// ── life ──
export const LIFE_STATES = ['up', 'dead'] as const;
export type LifeState = (typeof LIFE_STATES)[number];
/**
 * Up has at least 1 HP. A hunter at 0 HP is dead (the owner, Nov 21: "Youre dead. You need to be ressed."), and only
 * `revive` brings it back: the GM's, or a Resurrection Crystal used (use.ts). A revive also takes off every status
 * (grant.ts `sheetEdit` on the sheet, fight.ts `revive` on a fight's row).
 */
export type Life =
  | { at: 'up'; hp: number }
  | { at: 'dead' };

/**
 * What can happen to a hunter's life. `setHp` is the HP the sheet's bar or the GM sets. `revive` is the GM's Revive or
 * a Resurrection Crystal's use, for the dead only. `maxChanged` is sent when the maximum HP changes.
 */
export type LifeEvent =
  | { type: 'damage'; amount: number }
  | { type: 'heal'; amount: number }
  | { type: 'setHp'; hp: number }
  | { type: 'revive' }
  | { type: 'maxChanged' };
export type LifeEventType = LifeEvent['type'];
export const LIFE_EVENT_TYPES = ['damage', 'heal', 'setHp', 'revive', 'maxChanged'] as const satisfies readonly LifeEventType[];

/** HP as the sheet shows it: at most the maximum, 0 for a dead hunter. */
export const hpOf = (life: Life, hpMax: number): number => (life.at === 'up' ? Math.min(life.hp, hpMax) : 0);

/** A whole number of at least 1, or null for anything else. */
const amountOf = (n: number): number | null => (Number.isFinite(n) && Math.trunc(n) >= 1 ? Math.trunc(n) : null);
/** Up at `hp`, capped at the maximum; 0 or less is dead. */
const at = (hp: number, hpMax: number): Life => (hp >= 1 ? { at: 'up', hp: Math.min(hp, Math.max(1, hpMax)) } : { at: 'dead' });

type Step<T extends LifeEventType> = (life: Life, event: Extract<LifeEvent, { type: T }>, hpMax: number) => Life;
/** For one state: what each event does there. `null` means the event does not apply, and the life stays as it is. */
type Row = { readonly [T in LifeEventType]: Step<T> | null };

const damage: Step<'damage'> = (life, e, max) => { const n = amountOf(e.amount); return n === null ? life : at(hpOf(life, max) - n, max); };
const heal: Step<'heal'> = (life, e, max) => { const n = amountOf(e.amount); return n === null ? life : at(hpOf(life, max) + n, max); };
const setHp: Step<'setHp'> = (life, e, max) => { const n = Math.trunc(e.hp); return Number.isFinite(n) ? at(n, max) : life; };
/** The HP a revive brings a dead hunter back at; a fight's row of that hunter is raised to it too (fight.ts `revive`). */
export const REVIVE_HP = 1;
const revive: Step<'revive'> = () => ({ at: 'up', hp: REVIVE_HP });
const maxChanged: Step<'maxChanged'> = (life, _e, max) => (life.at === 'up' && life.hp > max ? at(max, max) : life);

const TABLE: { readonly [S in LifeState]: Row } = {
  up: { damage, heal, setHp, revive: null, maxChanged },
  dead: { damage: null, heal: null, setHp: null, revive, maxChanged: null },
};

/** The life after `event`, for a hunter with `hpMax` maximum HP. The same life when the event does not apply. Never changes its input. */
export function lifeAfter(life: Life, event: LifeEvent, hpMax: number): Life {
  // The table's type pairs each key with the step for that event, so the step for `event.type` takes `event`.
  const step = TABLE[life.at][event.type] as Step<LifeEventType> | null;
  if (!step) return life;
  const next = step(life, event as never, hpMax);
  return next === life ? life : { ...next };
}
/**
 * What a change of life was, for the words a player reads: died (HP reached 0) or raised (up again from dead: a
 * revive). Worked out from the lives before and after a write, so the words follow what the table did, never what was
 * asked (implicit audit 3, H1, H2).
 */
export type LifeNews = { readonly kind: 'died' } | { readonly kind: 'raised' };
/** What the change from `before` to `after` was, or null when the state is the same (HP moved while up). */
export function lifeNews(before: Life, after: Life): LifeNews | null {
  if (before.at === after.at) return null;
  return after.at === 'dead' ? { kind: 'died' } : { kind: 'raised' };
}

/** The life event of a signed HP change: below 0 is damage, above 0 a heal. */
export const hpChange = (delta: number): LifeEvent => (delta < 0 ? { type: 'damage', amount: -delta } : { type: 'heal', amount: delta });
/** Whether `type` applies to a hunter in this state: what a view asks before it shows the button. */
export const can = (life: { at: LifeState }, type: LifeEventType): boolean => TABLE[life.at][type] !== null;

// ── vitals: life, mana, fatigue and collapse, one machine ──
/**
 * What a hunter stores of its condition. `collapsed` is the collapse's latch: set when fatigue reaches the rules'
 * collapse share, lifted by a rest or a Clear that leaves fatigue under it; `vitalStep` is its one writer, and
 * `fatigueState` reads it with the number. `used` counts the uses of each ability limited to n a gate (kits design 1.4
 * and table 2.3): the fight writes it back with `vitals`, and a gate's Clear clears it. An ability it does not name has none spent.
 */
export type Vitals = { life: Life; mana: number; fatigue: number; collapsed: boolean; used: Readonly<Record<AbilityId, number>> };
/** The hunter's maxima, from its sheet (src/core/hunter/sheet.ts `hunterSheet`): the caller passes them in. */
export type Maxima = { hpMax: number; manaMax: number; fatigueMax: number };
/** The rules the vitals read: the fatigue shares and the rest's. */
export type VitalRules = Pick<Rules, 'fatigue' | 'rest'>;

export const newVitals = (m: Maxima): Vitals => ({ life: at(Math.max(1, m.hpMax), m.hpMax), mana: Math.max(0, m.manaMax), fatigue: 0, collapsed: false, used: {} });
/** Only the vitals fields: a hunter passed in keeps its other fields out of the answer. */
const fieldsOf = (v: Vitals): Vitals => ({ life: v.life, mana: v.mana, fatigue: v.fatigue, collapsed: v.collapsed, used: v.used });
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const whole = (n: number): number => (Number.isFinite(n) ? Math.trunc(n) : 0);
const manaCap = (m: Pick<Maxima, 'manaMax'>): number => Math.max(0, m.manaMax);
const fatigueCap = (m: Pick<Maxima, 'fatigueMax'>): number => Math.max(0, Math.round(m.fatigueMax));

/** Mana as the sheet shows it: at most the maximum. */
export const manaOf = (v: Pick<Vitals, 'mana'>, m: Pick<Maxima, 'manaMax'>): number => clamp(v.mana, 0, manaCap(m));
/**
 * Whether fatigue has reached `pct` percent of the fatigue capacity. The rules' thresholds (`R.fatigue`: the check
 * penalty, disadvantage, collapse) are shares of the capacity, which Vitality raises (design 2.2).
 */
export const fatiguePast = (fatigue: number, m: Pick<Maxima, 'fatigueMax'>, pct: number): boolean => fatigue >= pct * m.fatigueMax / 100;

/**
 * Where fatigue stands: `collapsed` while the latch holds (until a rest or a Clear lifts it), `tired` from the check penalty's share of
 * the capacity (`R.fatigue.penaltyAt`), else `fresh`. Only the latch is stored; tired and fresh are read from the number.
 */
export const FATIGUE_STATES = ['fresh', 'tired', 'collapsed'] as const;
export type FatigueState = (typeof FATIGUE_STATES)[number];
export const fatigueState = (v: Pick<Vitals, 'fatigue' | 'collapsed'>, m: Pick<Maxima, 'fatigueMax'>, R: Pick<Rules, 'fatigue'>): FatigueState =>
  v.collapsed ? 'collapsed' : fatiguePast(v.fatigue, m, R.fatigue.penaltyAt) ? 'tired' : 'fresh';

/**
 * What can happen to a hunter's vitals. The life's events go to the life table (`lifeAfter`); a revive says who raised:
 * the GM's Revive or an item (a Resurrection Crystal, use.ts). `mana` and `fatigue` are signed changes, `spend` a price
 * in mana, `refill` a level-up's, `rest` a rest (`R.rest`), `cleared` a gate's Clear the hunter was paid for (everything
 * back), `maxChanged` sent after every change to a maximum, `fightTotals` the fight row's life, mana, fatigue and spent
 * uses written back while the fight holds the hunter.
 */
export type VitalEvent =
  | Exclude<LifeEvent, { type: 'revive' | 'maxChanged' }>
  | { type: 'revive'; by: 'gm' | 'item' }
  | { type: 'mana'; delta: number }
  | { type: 'spend'; mana: number }
  | { type: 'fatigue'; delta: number }
  | { type: 'refill' }
  | { type: 'rest' }
  | { type: 'cleared' }
  | { type: 'maxChanged' }
  | { type: 'fightTotals'; life: Life; mana: number; fatigue: number; used?: Readonly<Record<AbilityId, number>> };
export type VitalEventType = VitalEvent['type'];
/** The events beside the life's own: the vitals table's columns. */
type OwnType = Exclude<VitalEventType, Exclude<LifeEventType, 'maxChanged'>>;
export const VITAL_EVENT_TYPES = ['damage', 'heal', 'setHp', 'revive', 'mana', 'spend', 'fatigue', 'refill', 'rest', 'cleared', 'maxChanged', 'fightTotals'] as const satisfies readonly VitalEventType[];
/** Why `vitalStep` refused: the hunter's state does not take the event (`cannot`), or a price is more mana than held (`mana`). */
export type VitalRefusal = 'cannot' | 'mana';
/** The events every state takes: a maximum fitted and the fight's totals. */
type Always = 'maxChanged' | 'fightTotals';

/**
 * For each life state, whether it takes each event beside the life's own (the life's are the life table's, `can`).
 * `Always` is `true` in every row by its type, so `vitalStep` answers vitals for those without a refusal.
 */
type VitalRow = { readonly [T in OwnType]: T extends Always ? true : boolean };
const TAKES = { mana: true, spend: true, fatigue: true, refill: true, rest: true, cleared: true, maxChanged: true, fightTotals: true } as const satisfies VitalRow;
export const VITAL_TABLE: { readonly [S in LifeState]: VitalRow } = {
  up: TAKES,
  // A dead hunter gets nothing from a rest or a Clear (the owner, Nov 21: "Youre dead. You need to be ressed."; the lead's
  // ruling of Nov 22): both refused, nothing changes. Whether a dead hunter is refilled on a level-up still waits on
  // the owner (SMX-rules-1.2); taken today, the life staying dead.
  dead: { ...TAKES, refill: true, rest: false, cleared: false },
};

/** What an event does to the collapse's latch: `rise` sets it when fatigue reaches the collapse share, `keep` leaves it, `recount` sets it to whether fatigue is still past the share. */
export type CollapseMove = 'rise' | 'keep' | 'recount';
export const COLLAPSE_MOVES: { readonly [T in OwnType]: (e: Extract<VitalEvent, { type: T }>) => CollapseMove } = {
  mana: () => 'keep',
  spend: () => 'keep',
  fatigue: () => 'rise',
  refill: () => 'keep',
  // "exhausted will largely clear" (the owner, Nov 22): a rest lifts Exhausted when the fatigue it leaves is under the share
  rest: () => 'recount',
  cleared: () => 'recount',
  // SMX-rules-6.1: fatigue fitted to a lower maximum, at or past the collapse share, collapses the hunter at once
  // (the owner, Nov 22: "Yes").
  maxChanged: () => 'rise',
  // SMX-rules-6.2: a hunter who reaches the collapse share in a fight is collapsed (the owner, Nov 22: "Yes"), and stays
  // so when the fight brings fatigue back down. The fight's own row has no collapse yet (notes-9-rulings-1122.md).
  fightTotals: () => 'rise',
};
const collapsedAfter = (move: CollapseMove, was: boolean, fatigue: number, m: Maxima, R: Pick<Rules, 'fatigue'>): boolean =>
  move === 'keep' ? was : move === 'rise' ? was || fatiguePast(fatigue, m, R.fatigue.collapseAt) : fatiguePast(fatigue, m, R.fatigue.collapseAt);
/** The share `share` of `n`, rounded up: what a rest gives back or takes off. */
const shareOf = (n: number, share: number): number => Math.ceil(n * share);

/**
 * The life and mana a refill leaves: HP healed to the maximum through the life machine (the dead stay dead), mana
 * full. The one meaning of a refill, for a sheet (`refill`) and for a fight's row (row-life.ts `refilledRow`).
 */
export const refilled = (v: Pick<Vitals, 'life' | 'mana'>, m: Pick<Maxima, 'hpMax' | 'manaMax'>): Pick<Vitals, 'life' | 'mana'> =>
  ({ life: lifeAfter(v.life, { type: 'heal', amount: m.hpMax }, m.hpMax), mana: manaCap(m) });

type Cell<T extends OwnType> = (v: Vitals, e: Extract<VitalEvent, { type: T }>, m: Maxima, R: VitalRules) => Vitals | Refused<'mana'>;
/** What each event beside the life's own does to the numbers; the collapse is `COLLAPSE_MOVES`'s, set after. */
const CELLS: { readonly [T in OwnType]: Cell<T> } = {
  mana: (v, e, m) => ({ ...v, mana: clamp(manaOf(v, m) + whole(e.delta), 0, manaCap(m)) }),
  spend: (v, e, m) => { const n = Math.max(0, whole(e.mana)); return manaOf(v, m) < n ? refuse('mana') : { ...v, mana: manaOf(v, m) - n }; },
  fatigue: (v, e, m) => ({ ...v, fatigue: clamp(v.fatigue + whole(e.delta), 0, fatigueCap(m)) }),
  refill: (v, _e, m) => ({ ...v, ...refilled(v, m) }),
  // A rest: the rules' share of max HP and of max mana back, never past the maximum, and the rules' share of the fatigue
  // held off. The uses limited to n a gate stay spent: a Clear gives them back.
  rest: (v, _e, m, R) => ({
    ...v,
    life: lifeAfter(v.life, { type: 'heal', amount: shareOf(m.hpMax, R.rest.hp) }, m.hpMax),
    mana: clamp(manaOf(v, m) + shareOf(m.manaMax, R.rest.mana), 0, manaCap(m)),
    fatigue: clamp(v.fatigue - shareOf(v.fatigue, R.rest.fatigue), 0, fatigueCap(m)),
  }),
  // A gate's Clear (the owner, Nov 22: "after a dungeon clear they should get everything back"): HP and mana full, no
  // fatigue, every use limited to n a gate back. The dead get nothing (`VITAL_TABLE`).
  cleared: (v, _e, m) => ({ ...v, ...refilled(v, m), fatigue: 0, used: {} }),
  maxChanged: (v, _e, m) => ({ ...v, life: lifeAfter(v.life, { type: 'maxChanged' }, m.hpMax), mana: manaOf(v, m), fatigue: clamp(v.fatigue, 0, fatigueCap(m)) }),
  fightTotals: (v, e, m) => ({
    ...v, life: lifeAfter(e.life, { type: 'maxChanged' }, m.hpMax), mana: clamp(whole(e.mana), 0, manaCap(m)), fatigue: clamp(whole(e.fatigue), 0, fatigueCap(m)),
    used: e.used ? { ...e.used } : v.used,
  }),
};

const isLifeEvent = (e: VitalEvent): e is Exclude<VitalEvent, { type: OwnType }> => !(e.type in CELLS);

/**
 * The vitals after `e`, for a hunter with maxima `m`: the one writer of a hunter's HP, life, mana, fatigue, collapse and
 * spent uses on its sheet. A life event goes through the life table (refused `cannot` where its state does not take
 * it); any other through `VITAL_TABLE` and `CELLS`, the collapse moved by `COLLAPSE_MOVES`. Never changes its input.
 */
export function vitalStep(v: Vitals, e: Extract<VitalEvent, { type: Always }>, m: Maxima, R: VitalRules): Vitals;
export function vitalStep(v: Vitals, e: VitalEvent, m: Maxima, R: VitalRules): Vitals | Refused<VitalRefusal>;
export function vitalStep(v: Vitals, e: VitalEvent, m: Maxima, R: VitalRules): Vitals | Refused<VitalRefusal> {
  if (isLifeEvent(e)) return can(v.life, e.type) ? { ...fieldsOf(v), life: lifeAfter(v.life, e, m.hpMax) } : refuse('cannot');
  if (!VITAL_TABLE[v.life.at][e.type]) return refuse('cannot');
  const own = fieldsOf(v);
  // The cells' type pairs each key with the event of that type, so the cell for `e.type` takes `e`.
  const next = (CELLS[e.type] as Cell<OwnType>)(own, e as never, m, R);
  if (isRefused(next)) return next;
  const move = (COLLAPSE_MOVES[e.type] as (x: VitalEvent) => CollapseMove)(e);
  return { ...next, collapsed: collapsedAfter(move, v.collapsed, next.fatigue, m, R) };
}

/**
 * HP and mana filled, as `vitalStep`'s `refill` answers (a refill keeps the collapse, so it reads no rules): for
 * starter.ts's pregens, which hold no rules here. Unchanged where the table refuses. tests/vitals.test.ts holds it equal.
 */
export const refill = (v: Vitals, m: Maxima): Vitals => (VITAL_TABLE[v.life.at].refill ? { ...fieldsOf(v), ...refilled(v, m) } : fieldsOf(v));

/**
 * What a change of fatigue crossed, for the words a player reads: `collapsed` when it collapsed the hunter, `high` when
 * it rose past the share from which every check rolls with disadvantage (`R.fatigue.disAt`), else null. A change that
 * lowers fatigue, or moves it while already past, crosses nothing (implicit audit 3, H4).
 */
export function fatigueNews(before: Pick<Vitals, 'fatigue' | 'collapsed'>, after: Pick<Vitals, 'fatigue' | 'collapsed'>, m: Pick<Maxima, 'fatigueMax'>, R: Pick<Rules, 'fatigue'>): 'collapsed' | 'high' | null {
  if (after.collapsed && !before.collapsed) return 'collapsed';
  return fatiguePast(after.fatigue, m, R.fatigue.disAt) && !fatiguePast(before.fatigue, m, R.fatigue.disAt) ? 'high' : null;
}

// ── the chips drawn from the state ──
/** The keys of the chips the vitals draw. src/core/hunter/chips.ts lists every chip a hunter's state draws. */
export const VITAL_CHIPS = ['dead', 'exhausted'] as const;
export type VitalChip = (typeof VITAL_CHIPS)[number];
/** The chips the vitals draw: Dead, and Exhausted while collapsed. */
export function vitalChipsOf(v: Pick<Vitals, 'life' | 'collapsed'>): VitalChip[] {
  const out: VitalChip[] = [];
  if (v.life.at === 'dead') out.push('dead');
  if (v.collapsed) out.push('exhausted');
  return out;
}
/**
 * The ways back from dead, as every place that tells a dead hunter names them (the sheet, the toast of a death, a solo run,
 * the Dead chip, the Rules page): one name each, the GM's button and the item.
 */
export const WAYS_BACK = 'The GM\'s Revive or a Resurrection Crystal';
/** The toast when a change takes a hunter's HP to 0. */
export const DIED_WORDS = `HP has reached 0. You are dead. ${WAYS_BACK} brings you back.`;

/** The uses of `id` spent this gate: the count the fight writes back (`vitals`), after each limited use resolves. */
export const usedOf = (v: Pick<Vitals, 'used'>, id: AbilityId): number => v.used[id] ?? 0;

// ── the boundary ──
/** Ability ids a hunter's `used` may name: a hunter holds at most this many abilities (skills and items) at once. */
const USED_MAX = 60;
/**
 * A hunter's spent uses from outside data (a save): an id of 1 to 80 characters to a whole count, clamped to 1 to
 * `RULES.fight.kit.fightUses`; anything else, and a count of 0, is dropped. At most `USED_MAX` ids.
 */
export function parseUsed(value: unknown, R: Pick<Rules, 'fight'>): Readonly<Record<AbilityId, number>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(value as Record<string, unknown>).slice(0, USED_MAX)) {
    if (id.length < 1 || id.length > 80 || id === '__proto__' || typeof n !== 'number' || !Number.isFinite(n) || Math.trunc(n) < 1) continue;
    out[id] = Math.min(R.fight.kit.fightUses, Math.trunc(n));
  }
  return out as Readonly<Record<AbilityId, number>>;
}
/** The life in `value`, or null when it is not one. Up HP is a whole number from 1 to `hpCap`. */
export function parseLife(value: unknown, hpCap: number): Life | null {
  if (value === null || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const n = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null);
  switch (o.at) {
    case 'up': { const hp = n(o.hp, 1, hpCap); return hp === null ? null : { at: 'up', hp }; }
    case 'dead': return { at: 'dead' };
    default: return null;
  }
}
