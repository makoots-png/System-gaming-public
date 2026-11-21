// vitals.ts: a hunter's life (HP, dying, stable, dead), mana, fatigue and collapse. Pure.
// One field, `life`, holds what HP, the dying chip and the death saves used to hold in three places. Its one
// table of events is `lifeAfter`. The vitals together (life, mana, fatigue, the collapse, spent uses) have one machine,
// `vitalStep`, whose table is `VITAL_TABLE`: a sheet's change goes through grant.ts `sheetEdit`, which calls it. The save
// repair reads a stored hunter in src/core/save.ts. The maxima are not stored: the caller reads them from the hunter's
// sheet and passes them in.
import type { Rules } from '../rules.ts';
import type { AbilityId } from '../combat/ability-types.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';

// ── life ──
export const LIFE_STATES = ['up', 'dying', 'stable', 'dead'] as const;
export type LifeState = (typeof LIFE_STATES)[number];
/** Death saves made so far while dying. A third success makes the hunter stable, a third failure dead. */
type Saves = 0 | 1 | 2;
/** Up has at least 1 HP. Dying, stable and dead have 0 HP. Only `revive` brings back the dead: the GM's, or a Resurrection Crystal used (use.ts). */
export type Life =
  | { at: 'up'; hp: number }
  | { at: 'dying'; successes: Saves; failures: Saves }
  | { at: 'stable' }
  | { at: 'dead' };

/**
 * What can happen to a hunter's life. `setHp` is the HP the sheet's bar or the GM sets. `deathSave` carries the d20
 * the player rolled. `revive` is the GM's Revive or a Resurrection Crystal's use, for the dead only. `maxChanged` is sent
 * when the maximum HP changes.
 */
export type LifeEvent =
  | { type: 'damage'; amount: number }
  | { type: 'heal'; amount: number }
  | { type: 'setHp'; hp: number }
  | { type: 'deathSave'; roll: number }
  | { type: 'stabilize' }
  | { type: 'revive' }
  | { type: 'maxChanged' };
export type LifeEventType = LifeEvent['type'];
export const LIFE_EVENT_TYPES = ['damage', 'heal', 'setHp', 'deathSave', 'stabilize', 'revive', 'maxChanged'] as const satisfies readonly LifeEventType[];

/**
 * The death save numbers, today's (and the rules reference's "d20, 10 or higher succeeds"): a 20 brings the hunter
 * up at 1 HP, 10 to 19 is a success, 2 to 9 a failure, a 1 two failures. Three of either ends the dying.
 */
export const SAVE_SUCCESS = 10, SAVE_UP = 20;
/** The HP a hunter has after a natural 20 on a death save. */
export const SAVE_UP_HP = 1;
/** The roll that counts as more than one failure, and how many (the Rules page's "a 1 counts as two failures"). */
export const SAVE_FUMBLE = 1, FUMBLE_FAILURES = 2;
/** Successes or failures that end the dying: the death panel's pips count up to it. */
export const SAVES_TO_END = 3;

/** HP as the sheet shows it: at most the maximum, 0 for a hunter who is down. */
export const hpOf = (life: Life, hpMax: number): number => (life.at === 'up' ? Math.min(life.hp, hpMax) : 0);

/** A whole number of at least 1, or null for anything else. */
const amountOf = (n: number): number | null => (Number.isFinite(n) && Math.trunc(n) >= 1 ? Math.trunc(n) : null);
const DOWN: Life = { at: 'dying', successes: 0, failures: 0 };
/** Up at `hp`, capped at the maximum; 0 or less is a fresh fall. */
const at = (hp: number, hpMax: number): Life => (hp >= 1 ? { at: 'up', hp: Math.min(hp, Math.max(1, hpMax)) } : DOWN);

type Step<T extends LifeEventType> = (life: Life, event: Extract<LifeEvent, { type: T }>, hpMax: number) => Life;
/** For one state: what each event does there. `null` means the event does not apply, and the life stays as it is. */
type Row = { readonly [T in LifeEventType]: Step<T> | null };

const damage: Step<'damage'> = (life, e, max) => { const n = amountOf(e.amount); return n === null ? life : at(hpOf(life, max) - n, max); };
const heal: Step<'heal'> = (life, e, max) => { const n = amountOf(e.amount); return n === null ? life : at(hpOf(life, max) + n, max); };
/** Down: only an HP above 0 changes anything, so setting 0 keeps the saves made. */
const setHp: Step<'setHp'> = (life, e, max) => { const n = Math.trunc(e.hp); return Number.isFinite(n) && (life.at === 'up' || n >= 1) ? at(n, max) : life; };
const deathSave: Step<'deathSave'> = (life, e) => {
  if (life.at !== 'dying' || !Number.isInteger(e.roll) || e.roll < 1 || e.roll > SAVE_UP) return life;
  if (e.roll === SAVE_UP) return { at: 'up', hp: SAVE_UP_HP };
  if (e.roll >= SAVE_SUCCESS) { const s = life.successes + 1; return s >= SAVES_TO_END ? { at: 'stable' } : { ...life, successes: s as Saves }; }
  const f = life.failures + (e.roll === SAVE_FUMBLE ? FUMBLE_FAILURES : 1);
  return f >= SAVES_TO_END ? { at: 'dead' } : { ...life, failures: f as Saves };
};
const stabilize: Step<'stabilize'> = () => ({ at: 'stable' });
/** The HP a revive brings a dead hunter back at; a fight's row of that hunter is raised to it too (combat.js `revive`). */
export const REVIVE_HP = 1;
const revive: Step<'revive'> = () => ({ at: 'up', hp: REVIVE_HP });
const maxChanged: Step<'maxChanged'> = (life, _e, max) => (life.at === 'up' && life.hp > max ? at(max, max) : life);

const TABLE: { readonly [S in LifeState]: Row } = {
  up: { damage, heal, setHp, deathSave: null, stabilize: null, revive: null, maxChanged },
  dying: { damage: null, heal, setHp, deathSave, stabilize, revive: null, maxChanged: null },
  stable: { damage: null, heal, setHp, deathSave: null, stabilize: null, revive: null, maxChanged: null },
  dead: { damage: null, heal: null, setHp: null, deathSave: null, stabilize: null, revive, maxChanged: null },
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
 * What a change of life was, for the words a player reads: fell (HP reached 0), raised (up again from down: a heal, a
 * natural 20, a revive), a death save made or failed while still dying (with the count now), stable, or died. Worked
 * out from the lives before and after a write, so the words follow what the table did, never what was asked (implicit
 * audit 3, H1, H2).
 */
export type LifeNews =
  | { readonly kind: 'fell' } | { readonly kind: 'raised' } | { readonly kind: 'stable' } | { readonly kind: 'died' }
  | { readonly kind: 'saved'; readonly successes: number } | { readonly kind: 'failed'; readonly failures: number };
/** What the change from `before` to `after` was, or null when the state and the saves are the same (HP moved while up). */
export function lifeNews(before: Life, after: Life): LifeNews | null {
  if (after.at === 'dead') return before.at === 'dead' ? null : { kind: 'died' };
  if (after.at === 'up') return before.at === 'up' ? null : { kind: 'raised' };
  if (after.at === 'stable') return before.at === 'stable' ? null : { kind: 'stable' };
  if (before.at !== 'dying') return { kind: 'fell' };
  if (after.successes > before.successes) return { kind: 'saved', successes: after.successes };
  if (after.failures > before.failures) return { kind: 'failed', failures: after.failures };
  return null;
}

/** The life event of a signed HP change: below 0 is damage, above 0 a heal. */
export const hpChange = (delta: number): LifeEvent => (delta < 0 ? { type: 'damage', amount: -delta } : { type: 'heal', amount: delta });
/** Whether `type` applies to a hunter in this state: what a view asks before it shows the button. */
export const can = (life: { at: LifeState }, type: LifeEventType): boolean => TABLE[life.at][type] !== null;

// ── vitals: life, mana, fatigue and collapse, one machine ──
/**
 * What a hunter stores of its condition. `collapsed` is the collapse's latch: set when fatigue reaches the rules'
 * collapse share, ended only by a long rest; `vitalStep` is its one writer, and `fatigueState` reads it with the number.
 * `used` counts the uses of each ability limited to n a long rest (kits design 1.4 and table 2.3): the fight writes it
 * back with `vitals`, and a long rest clears it. An ability it does not name has none spent.
 */
export type Vitals = { life: Life; mana: number; fatigue: number; collapsed: boolean; used: Readonly<Record<AbilityId, number>> };
/** The hunter's maxima, from its sheet (src/core/hunter/sheet.ts `hunterSheet`): the caller passes them in. */
export type Maxima = { hpMax: number; manaMax: number; fatigueMax: number };
/** The rules the vitals read: the fatigue shares and the rests. */
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
 * Where fatigue stands: `collapsed` while the latch holds (until a long rest), `tired` from the check penalty's share of
 * the capacity (`R.fatigue.penaltyAt`), else `fresh`. Only the latch is stored; tired and fresh are read from the number.
 */
export const FATIGUE_STATES = ['fresh', 'tired', 'collapsed'] as const;
export type FatigueState = (typeof FATIGUE_STATES)[number];
export const fatigueState = (v: Pick<Vitals, 'fatigue' | 'collapsed'>, m: Pick<Maxima, 'fatigueMax'>, R: Pick<Rules, 'fatigue'>): FatigueState =>
  v.collapsed ? 'collapsed' : fatiguePast(v.fatigue, m, R.fatigue.penaltyAt) ? 'tired' : 'fresh';

/**
 * What can happen to a hunter's vitals. The life's events go to the life table (`lifeAfter`); a revive says who raised:
 * the GM's Revive or an item (a Resurrection Crystal, use.ts). `mana` and `fatigue` are signed changes, `spend` a price
 * in mana, `refill` a level-up's, `maxChanged` sent after every change to a maximum, `fightTotals` the fight row's
 * life, mana, fatigue and spent uses written back while the fight holds the hunter.
 */
export type VitalEvent =
  | Exclude<LifeEvent, { type: 'revive' | 'maxChanged' }>
  | { type: 'revive'; by: 'gm' | 'item' }
  | { type: 'mana'; delta: number }
  | { type: 'spend'; mana: number }
  | { type: 'fatigue'; delta: number }
  | { type: 'refill' }
  | { type: 'rest'; kind: 'short' | 'long' }
  | { type: 'maxChanged' }
  | { type: 'fightTotals'; life: Life; mana: number; fatigue: number; used?: Readonly<Record<AbilityId, number>> };
export type VitalEventType = VitalEvent['type'];
/** The events beside the life's own: the vitals table's columns. */
type OwnType = Exclude<VitalEventType, Exclude<LifeEventType, 'maxChanged'>>;
export const VITAL_EVENT_TYPES = ['damage', 'heal', 'setHp', 'deathSave', 'stabilize', 'revive', 'mana', 'spend', 'fatigue', 'refill', 'rest', 'maxChanged', 'fightTotals'] as const satisfies readonly VitalEventType[];
/** Why `vitalStep` refused: the hunter's state does not take the event (`cannot`), or a price is more mana than held (`mana`). */
export type VitalRefusal = 'cannot' | 'mana';
/** The events every state takes: a maximum fitted and the fight's totals. */
type Always = 'maxChanged' | 'fightTotals';

/**
 * For each life state, whether it takes each event beside the life's own (the life's are the life table's, `can`).
 * `Always` is `true` in every row by its type, so `vitalStep` answers vitals for those without a refusal.
 */
type VitalRow = { readonly [T in OwnType]: T extends Always ? true : boolean };
const TAKES = { mana: true, spend: true, fatigue: true, refill: true, rest: true, maxChanged: true, fightTotals: true } as const satisfies VitalRow;
export const VITAL_TABLE: { readonly [S in LifeState]: VitalRow } = {
  up: TAKES,
  dying: TAKES,
  stable: TAKES,
  // SMX-rules-1.2 waits on the owner: whether a dead hunter may rest and is refilled on a level-up. Today both are taken:
  // mana fills, a long rest ends a collapse and gives back the uses, and the life stays dead (the life table's heal).
  dead: { ...TAKES, refill: true, rest: true },
};

/** What an event does to the collapse's latch: `rise` sets it when fatigue reaches the collapse share, `keep` leaves it, `longRest` sets it to whether fatigue is still past the share. */
export type CollapseMove = 'rise' | 'keep' | 'longRest';
export const COLLAPSE_MOVES: { readonly [T in OwnType]: (e: Extract<VitalEvent, { type: T }>) => CollapseMove } = {
  mana: () => 'keep',
  spend: () => 'keep',
  fatigue: () => 'rise',
  refill: () => 'keep',
  rest: e => (e.kind === 'long' ? 'longRest' : 'keep'),
  // SMX-rules-6.1 waits on the owner: whether fatigue fitted to a lower maximum, at or past the collapse share, collapses
  // the hunter at once. Today it does not.
  maxChanged: () => 'keep',
  // SMX-rules-6.2 waits on the owner: whether a collapse reached in a fight holds once the fight brings fatigue back down
  // (the fight's row has no collapse). Today every totals that reaches the share latches it.
  fightTotals: () => 'rise',
};
const collapsedAfter = (move: CollapseMove, was: boolean, fatigue: number, m: Maxima, R: Pick<Rules, 'fatigue'>): boolean =>
  move === 'keep' ? was : move === 'rise' ? was || fatiguePast(fatigue, m, R.fatigue.collapseAt) : fatiguePast(fatigue, m, R.fatigue.collapseAt);

/**
 * The life and mana a refill leaves: HP healed to the maximum through the life machine (the dead stay dead, the down
 * stand up), mana full. The one meaning of a refill, for a sheet (`refill`) and for a fight's row (row-life.ts `refilledRow`).
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
  // A short or long rest: the rules' share of max HP and mana back, and the rules' share of the fatigue capacity off.
  // Only a long rest gives back the uses of what is limited to n a rest (a "per day" in the sheet is per long rest).
  rest: (v, e, m, R) => {
    const r = R.rest[e.kind];
    return {
      ...v,
      life: lifeAfter(v.life, { type: 'heal', amount: Math.ceil(m.hpMax * r.hpPct / 100) }, m.hpMax),
      mana: clamp(manaOf(v, m) + Math.ceil(m.manaMax * r.mpPct / 100), 0, manaCap(m)),
      fatigue: clamp(v.fatigue - Math.ceil(m.fatigueMax * r.fatigue / 100), 0, fatigueCap(m)),
      used: e.kind === 'long' ? {} : v.used,
    };
  },
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
/** A short or long rest (`vitalStep`'s `rest`); unchanged where the table refuses. */
export const rest = (v: Vitals, kind: 'short' | 'long', m: Maxima, R: VitalRules): Vitals => { const x = vitalStep(v, { type: 'rest', kind }, m, R); return isRefused(x) ? fieldsOf(v) : x; };

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
export const VITAL_CHIPS = ['down', 'dead', 'exhausted'] as const;
export type VitalChip = (typeof VITAL_CHIPS)[number];
/** The chips the vitals draw: Down while dying or stable, Dead, and Exhausted while collapsed. */
export function vitalChipsOf(v: Pick<Vitals, 'life' | 'collapsed'>): VitalChip[] {
  const out: VitalChip[] = [];
  if (v.life.at === 'dying' || v.life.at === 'stable') out.push('down');
  if (v.life.at === 'dead') out.push('dead');
  if (v.collapsed) out.push('exhausted');
  return out;
}
/**
 * The ways back from dead, as every place that tells a dead hunter names them (the sheet, the death save's toast, a solo
 * run, the Dead chip, the Rules page): one name each, the GM's button and the item.
 */
export const WAYS_BACK = 'The GM\'s Revive or a Resurrection Crystal';
/** The toast when a change takes a hunter's HP to 0. */
export const FELL_WORDS = 'HP has reached 0. You are down.';

/** The uses of `id` spent this rest: the count the fight writes back (`vitals`), after each limited use resolves. */
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
/** The life in `value`, or null when it is not one. Up HP is a whole number from 1 to `hpCap`; a count of saves is 0 to 2. */
export function parseLife(value: unknown, hpCap: number): Life | null {
  if (value === null || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const n = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null);
  switch (o.at) {
    case 'up': { const hp = n(o.hp, 1, hpCap); return hp === null ? null : { at: 'up', hp }; }
    case 'dying': return { at: 'dying', successes: (n(o.successes, 0, 2) ?? 0) as Saves, failures: (n(o.failures, 0, 2) ?? 0) as Saves };
    case 'stable': return { at: 'stable' };
    case 'dead': return { at: 'dead' };
    default: return null;
  }
}
