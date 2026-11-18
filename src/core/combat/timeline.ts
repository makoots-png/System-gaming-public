// timeline.ts: who acts next in a fight (docs/agent-handoff/rw/design.md section 1). Each combatant has the time of its
// next turn, `at`, and a speed; the lowest `at` acts, then waits an interval that its speed and the action's cost decide.
// Pure: the caller rolls the dice and passes them in, and passes the rule numbers as `TimelineRules`. A new way to move a
// turn is a function here with its case in tests/timeline.test.ts.

import type { Tiles } from './space.ts';
import type { Brand } from '../ids.ts';

/** Fight time, a whole number of ticks. One round is `TimelineRules.round` ticks. */
export type Tick = Brand<number, 'Tick'>;
/** What an action takes from its user's time, in hundredths of a standard action. */
export type Cost = Brand<number, 'Cost'>;
/** The three costs an ability's kind may have. */
export type Pace = 'quick' | 'standard' | 'heavy';

/** The rule numbers this module reads. A later unit passes `RULES.fight`. */
export type TimelineRules = {
  /** Ticks in one round: the time a speed-100 combatant needs for one standard action. */
  readonly round: number;
  readonly cost: Readonly<Record<Pace, number>>;
  /** The cost of one tile walked, so that a round of walking costs one standard action. */
  readonly moveCost: number;
};

/** A combatant as the timeline sees it. `tie` is the d1000 rolled when it joined; `id` settles what `tie` cannot. */
export type Clock = { readonly id: string; readonly at: Tick; readonly speed: number; readonly tie: number };

export const tick = (n: number): Tick => n as Tick;
export const cost = (n: number): Cost => n as Cost;

/** The cost of an action of this pace. */
export const paceCost = (pace: Pace, rules: TimelineRules): Cost => cost(rules.cost[pace]);

/** The cost of walking `steps` tiles: the same share of a turn for everyone (design 4.6). */
export const walkCost = (steps: Tiles, rules: TimelineRules): Cost => cost(Math.round(rules.moveCost * steps));

/** The ticks one action of `c` takes at `speed`. */
export const interval = (speed: number, c: Cost, rules: TimelineRules): Tick => tick(Math.round(rules.round * c / speed));

/**
 * The first `at` of a combatant who starts the fight or joins it at `now`. `roll` is its d20 plus its Instinct opening
 * bonus: a roll of 20 or more acts at once, a 1 waits 19/20 of a standard interval.
 */
export const opening = (now: Tick, speed: number, roll: number, rules: TimelineRules): Tick =>
  tick(now + Math.floor(interval(speed, paceCost('standard', rules), rules) * (20 - Math.min(20, roll)) / 20));

/** Whether `a` takes its turn before `b`: lower `at`, then higher speed, then higher `tie`, then lower id. */
export const before = (a: Clock, b: Clock): boolean =>
  a.at !== b.at ? a.at < b.at : a.speed !== b.speed ? a.speed > b.speed : a.tie !== b.tie ? a.tie > b.tie : a.id < b.id;

/** The combatant whose turn starts next, or undefined for no rows. The caller passes only the rows that take turns. */
export const next = <T extends Clock>(rows: readonly T[]): T | undefined =>
  rows.reduce<T | undefined>((best, r) => best === undefined || before(r, best) ? r : best, undefined);

/** The row after it took an action of cost `c` at `now`. */
export const acted = <T extends Clock>(row: T, now: Tick, c: Cost, rules: TimelineRules): T =>
  ({ ...row, at: tick(now + interval(row.speed, c, rules)) });

/**
 * The next `n` turns if everyone takes a standard action, each row as it is when its turn starts. This is the order ahead
 * the phones draw; a heavy action or a slow changes it.
 */
export function ahead<T extends Clock>(rows: readonly T[], n: number, rules: TimelineRules): T[] {
  const turns: T[] = [];
  let live = [...rows];
  for (let k = 0; k < n; k++) {
    const r = next(live);
    if (r === undefined) break;
    turns.push(r);
    live = live.map(x => x === r ? acted(r, r.at, paceCost('standard', rules), rules) : x);
  }
  return turns;
}

/** The row at a new speed from `now`: the wait left is rescaled by old speed over new, so a slow never brings a turn nearer. */
export const withSpeed = <T extends Clock>(row: T, now: Tick, speed: number): T =>
  ({ ...row, speed, at: tick(now + Math.round((row.at - now) * row.speed / speed)) });

/** A stun of `duration` from `now`: no turn starts before it ends, and a second stun keeps the later end. */
export const stunned = <T extends Clock>(row: T, now: Tick, duration: Tick): T =>
  ({ ...row, at: tick(Math.max(row.at, now + duration)) });

/** A turn pushed back by `ticks`, as a `delay` op does. */
export const delayed = <T extends Clock>(row: T, ticks: Tick): T => ({ ...row, at: tick(row.at + ticks) });

/**
 * An extra-turn refund after an action that took `spent` ticks: `pct` (0 to 100) of it comes back, but the next turn is
 * still after `now`, so no turn starts twice at one time.
 */
export const refunded = <T extends Clock>(row: T, now: Tick, spent: Tick, pct: number): T =>
  ({ ...row, at: tick(Math.max(now + 1, row.at - Math.round(spent * pct / 100))) });

/** The round `now` falls in, from 1, for the log's `R` prefix. */
export const roundOf = (now: Tick, rules: TimelineRules): number => Math.floor(now / rules.round) + 1;
/**
 * `ticks` as rounds with one decimal, the one way a time is shown in rounds: `near` for a length (a duration, a cooldown,
 * a fight's rounds), `up` for what is left of something still running, so it never reads 0 while it runs and the GM's
 * card and a player's table read the same number.
 */
export const roundsOf = (ticks: number, R: { readonly fight: Pick<TimelineRules, 'round'> }, how: 'up' | 'near'): number =>
  (how === 'up' ? Math.ceil : Math.round)(ticks / R.fight.round * 10) / 10;
/**
 * A turn brought earlier by `ticks` (kits design 8.6: a hasten, a turn reaction, an extra action), never before
 * `now + 1`, so nobody acts twice at one moment; a turn already at or before that is not moved later.
 */
export const hastened = <T extends Clock>(row: T, now: Tick, ticks: number): T => ({ ...row, at: tick(Math.min(row.at, Math.max(now + 1, row.at - ticks))) });
// ── a body's turn extras (kits design 8.6, table 8.9.6) ──
/** An extra action in a round: none taken (plain), or taken. */
export const EXTRA_STATES = ['plain', 'taken'] as const;
export type ExtraState = (typeof EXTRA_STATES)[number];
/** An extra action, with `left` the extras the round still allows (`extraPerRound` less those taken); a later round. */
export type ExtraEvent = { readonly type: 'extra'; readonly left: number } | { readonly type: 'laterRound' };
/** Table 8.9.6, its first part: an extra with none left is refused (`extra`) and changes nothing. */
const EXTRA_TABLE: { readonly [S in ExtraState]: { readonly [E in ExtraEvent['type']]: (e: Extract<ExtraEvent, { type: E }>) => { readonly to: ExtraState; readonly ok: boolean } } } = {
  plain: { extra: e => (e.left > 0 ? { to: 'taken', ok: true } : { to: 'plain', ok: false }), laterRound: () => ({ to: 'plain', ok: true }) },
  taken: { extra: e => ({ to: 'taken', ok: e.left > 0 }), laterRound: () => ({ to: 'plain', ok: true }) },
};
export const extraStep = (s: ExtraState, e: ExtraEvent): { readonly to: ExtraState; readonly ok: boolean } => (EXTRA_TABLE[s][e.type] as (e: ExtraEvent) => { to: ExtraState; ok: boolean })(e);
/** A body's turn against hastes: waiting, or hastened since its turn began. */
export const HASTE_STATES = ['waiting', 'hastened'] as const;
export type HasteState = (typeof HASTE_STATES)[number];
export type HasteEvent = { readonly type: 'hastened' } | { readonly type: 'turnStart' };
/** Table 8.9.6, its second part: a body is hastened once between two of its turns; `moves` says whether the haste moved it. */
const HASTE_TABLE: { readonly [S in HasteState]: { readonly [E in HasteEvent['type']]: { readonly to: HasteState; readonly moves: boolean } } } = {
  waiting: { hastened: { to: 'hastened', moves: true }, turnStart: { to: 'waiting', moves: false } },
  hastened: { hastened: { to: 'hastened', moves: false }, turnStart: { to: 'waiting', moves: false } },
};
export const hasteStep = (s: HasteState, e: HasteEvent): { readonly to: HasteState; readonly moves: boolean } => HASTE_TABLE[s][e.type];
/** An extra action (kits design 8.6.1): the row's next turn is now, the next tick. */
export const extraNow = <T extends Clock>(row: T, now: Tick): T => ({ ...row, at: tick(now + 1) });
