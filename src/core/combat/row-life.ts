// row-life.ts: a fight row's life, its one writer (docs/agent-handoff/audit/notes-dead-row.md sections 2 and 3). A
// hunter's row holds the hunter's `Life` and moves only by the life machine (src/core/hunter/vitals.ts `lifeAfter`), so a
// heal never lifts a dead hunter; a monster's, a shadow's or a summon's row holds a `FoeLife` and moves only by
// `FOE_TABLE` below. `rowLifeAfter` is the one function that changes a row's life: every HP change of the fight (a hit,
// a heal, an HP price, a paid op, the GM's hand edit, a lower maximum, the `revive` command) asks it, and `refilledRow` is
// a level-up's refill. tests/lint.test.ts keeps every other module from writing `life` on a row.
import { can, lifeAfter, refilled, REVIVE_HP } from '../hunter/vitals.ts';
import type { Life, LifeEvent, LifeEventType, LifeState } from '../hunter/vitals.ts';
import type { Body, CombatantKind, HunterRow } from './effect-ops.ts';
import { rowHp } from './row-hp.ts';

// ── a foe's life ──
export const FOE_LIFE_STATES = ['up', 'dead'] as const;
export type FoeLifeState = (typeof FOE_LIFE_STATES)[number];
/** A monster's, shadow's or summon's life: up with its HP (at least 1), or dead, which is defeated. */
export type FoeLife = { readonly at: 'up'; readonly hp: number } | { readonly at: 'dead' };

type FoeStep<T extends LifeEventType> = (life: FoeLife, event: Extract<LifeEvent, { type: T }>, hpMax: number) => FoeLife;
/** For one state: what each event does there. `null` means the event does not apply, and the life stays as it is. */
type FoeRow = { readonly [T in LifeEventType]: FoeStep<T> | null };

/** A whole number of at least 1, or null for anything else. */
const amountOf = (n: number): number | null => (Number.isFinite(n) && Math.trunc(n) >= 1 ? Math.trunc(n) : null);
/** Up at `hp`, capped at the maximum; 0 or less is dead. */
const foeAt = (hp: number, hpMax: number): FoeLife => (hp >= 1 ? { at: 'up', hp: Math.min(hp, Math.max(1, hpMax)) } : { at: 'dead' });
const hpIn = (life: FoeLife): number => (life.at === 'up' ? life.hp : 0);

const damage: FoeStep<'damage'> = (life, e, max) => { const n = amountOf(e.amount); return n === null ? life : foeAt(hpIn(life) - n, max); };
const heal: FoeStep<'heal'> = (life, e, max) => { const n = amountOf(e.amount); return n === null ? life : foeAt(hpIn(life) + n, max); };
const setHp: FoeStep<'setHp'> = (life, e, max) => (Number.isFinite(e.hp) ? foeAt(Math.trunc(e.hp), max) : life);
const revive: FoeStep<'revive'> = () => ({ at: 'up', hp: REVIVE_HP });
const maxChanged: FoeStep<'maxChanged'> = (life, _e, max) => (life.at === 'up' && life.hp > max ? foeAt(max, max) : life);

/**
 * A foe's life, the small table beside the hunter's: up takes damage, a heal, the GM's set and a lower maximum, and goes
 * dead at 0 HP; dead takes only `revive` (the GM's Revive), back up at `REVIVE_HP`.
 */
const FOE_TABLE: { readonly [S in FoeLifeState]: FoeRow } = {
  up: { damage, heal, setHp, revive: null, maxChanged },
  dead: { damage: null, heal: null, setHp: null, revive, maxChanged: null },
};

/** The foe life after `event`, at `hpMax` maximum HP. The same life when the event does not apply. */
export function foeLifeAfter(life: FoeLife, event: LifeEvent, hpMax: number): FoeLife {
  // The table's type pairs each key with the step for that event, so the step for `event.type` takes `event`.
  const step = FOE_TABLE[life.at][event.type] as FoeStep<LifeEventType> | null;
  return step ? step(life, event as never, hpMax) : life;
}
/** Whether `type` applies to a foe in this state. */
export const foeCan = (life: { at: FoeLifeState }, type: LifeEventType): boolean => FOE_TABLE[life.at][type] !== null;

// ── the words of a life ──
/**
 * A life's state with the kind whose table it follows: a fight's row (`Body`), the fight doc's row (fight-doc.ts), a
 * hunter's sheet (`{ kind: 'hunter', life }`). What `lifeWord` reads.
 */
export type LifeAt =
  | { readonly kind: 'hunter'; readonly life: { readonly at: LifeState } }
  | { readonly kind: Exclude<CombatantKind, 'hunter'>; readonly life: { readonly at: FoeLifeState } };
/**
 * The word every screen shows for a life that is not up, by its table: a hunter is Dead (the owner's ruling,
 * notes-dead-row.md section 7: never "Down"); a monster, shadow or summon at 0 HP is Defeated, its card's word.
 * The one home of these words: the sheet's death panel and chip, the GM's card, order and board, a player's own card,
 * the party's faces and a token's label all read them here.
 */
const LIFE_WORDS: { readonly hunter: Readonly<Record<LifeState, string | null>>; readonly foe: Readonly<Record<FoeLifeState, string | null>> } = {
  hunter: { up: null, dead: 'Dead' },
  foe: { up: null, dead: 'Defeated' },
};
/** The word for `x`'s life (`LIFE_WORDS`), or null while it is up. */
export const lifeWord = (x: LifeAt): string | null => (x.kind === 'hunter' ? LIFE_WORDS.hunter[x.life.at] : LIFE_WORDS.foe[x.life.at]);

// ── a row's life ──
/** Whether two lives say the same: the same state and HP. */
export function sameLife(a: Life | FoeLife, b: Life | FoeLife): boolean {
  return a.at === 'up' && b.at === 'up' ? a.hp === b.hp : a.at === b.at;
}

/**
 * Row `b` after `event`, through its kind's table at the row's maximum HP: the life machine for a hunter, `FOE_TABLE` for
 * anything else. The same row when the event does not apply or changes nothing (a heal of a dead hunter, damage to a
 * dead foe, a heal at full HP), so a caller tells a change by identity. The one writer of a row's life.
 *
 * Damage is the fight's (a use's or a trigger's hit, a status's end or round damage, a settled roll, a zone's hit, an
 * HP price): the row keeps the HP it had before the first damage no batch of triggers has read (`hurtFrom`), and the
 * next batch reads its fall under the low share from it (triggers.ts `fire`, `lowHp`). The GM's hand edit sets HP
 * (`setHp`, fight.ts `adjust`): a correction is not an event of the fight, so it keeps nothing.
 */
export function rowLifeAfter<T extends Body>(b: T, event: LifeEvent): T {
  const row: Body = b, max = row.sheet.hpMax;
  const life = row.kind === 'hunter' ? lifeAfter(row.life, event, max) : foeLifeAfter(row.life, event, max);
  if (sameLife(row.life, life)) return b;
  return event.type === 'damage' ? { ...b, life, hurtFrom: row.hurtFrom ?? rowHp(row) } : { ...b, life };
}
/** Whether event `type` applies to row `b`'s life now: what the `revive` command asks before it changes anything. */
export const rowLifeTakes = (b: Body, type: LifeEventType): boolean => (b.kind === 'hunter' ? can(b.life, type) : foeCan(b.life, type));

/**
 * A level-up's refill of hunter row `b`: the sheet's refill (vitals.ts `refilled`, its one meaning) at the maxima the row
 * has now. The dead stay dead, mana fills.
 */
export function refilledRow(b: HunterRow): HunterRow {
  const v = refilled({ life: b.life, mana: b.mana }, b.sheet);
  return { ...b, life: v.life, mana: v.mana };
}
