// fight-react.ts: a reaction on its reactor (docs/agent-handoff/kits/design.md 8.4, table 8.9.1). A player arms one of
// its hunter's reactions ahead (the room's `arm`), the GM anyone's (the fight's `arm`); the fight fires it by rule at its
// moment: before a foe's use lands on the reactor or an ally within its reach (rule 7c), before a hit takes one of them
// to 0 (rule 13b), after a foe's use landed on one of them (rule 19c), or before a named body's turn (`startTurn`). The
// machine is `reactStep` and its `TABLE`; a row holds one armed reaction at most (`Body.armed`). A reaction lands like a
// trigger, at its formulas' averages (land.ts), and its time comes off its reactor's next turn: an action taken early,
// never a free one. A new moment is a member of `ReactWhen` (ability-types.ts), its rule where it fires, and its cells
// here; a case in tests/fight.test.ts ("a reaction").

import type { Rules } from '../rules.ts';
import { interval, tick } from './timeline.ts';
import type { Tick } from './timeline.ts';
import type { Ability, CombatantId, ReactWhen } from './ability-types.ts';
import { landsAlone } from './effect-ops.ts';
import type { Body, LandOp } from './effect-ops.ts';
import { alive, held, landOps } from './land.ts';
import { charged } from './resolve.ts';
import { formulaOf } from '../registry/ability-kinds.ts';
import { dist } from './space.ts';
import { counted } from './uses.ts';

/** What a row holds armed (`Body.armed`): the reaction's ability, the body a `turn` reaction names (null for the rest), and whether it fired since it was last restored. */
export type Armed = NonNullable<Body['armed']>;

// ── the machine (table 8.9.1) ──
export const REACT_STATES = ['unarmed', 'armed', 'fired', 'spent'] as const;
export type ReactState = (typeof REACT_STATES)[number];
/**
 * What changes a reaction: armed or disarmed; its moment, when it may fire or not; its use resolving; its restoring
 * turn starting (its reactor's own; for a `turn` reaction, the named body's); its reactor down or the fight's end.
 */
export type ReactEvent =
  | { readonly type: 'arm' } | { readonly type: 'disarm' } | { readonly type: 'moment'; readonly may: boolean }
  | { readonly type: 'resolves' } | { readonly type: 'turnStart' } | { readonly type: 'down' };
export type ReactEventType = ReactEvent['type'];
type ReactStepFn<E extends ReactEventType> = (s: ReactState, e: Extract<ReactEvent, { type: E }>) => ReactState;
const to = (s: ReactState) => (): ReactState => s;
/** Its moment: it fires when it may (up, not held, ready, paid, not fired since its turn began); else it stays armed and says nothing. */
const moment: ReactStepFn<'moment'> = (_s, e) => (e.may ? 'fired' : 'armed');
/** Table 8.9.1 of the kits design. `null`: the event does not apply there, and nothing changes. */
const TABLE: { readonly [S in ReactState]: { readonly [E in ReactEventType]: ReactStepFn<E> | null } } = {
  unarmed: { arm: to('armed'), disarm: null, moment: null, resolves: null, turnStart: null, down: null },
  // arming another replaces it
  armed: { arm: to('armed'), disarm: to('unarmed'), moment, resolves: null, turnStart: to('armed'), down: to('unarmed') },
  fired: { arm: null, disarm: null, moment: null, resolves: to('spent'), turnStart: null, down: to('unarmed') },
  // one between two of its turns: a moment does nothing, and arming another keeps it spent until its turn
  spent: { arm: to('spent'), disarm: to('unarmed'), moment: to('spent'), resolves: null, turnStart: to('armed'), down: to('unarmed') },
};
/** A reaction's state after `e`. Never changes its input. */
export function reactStep(s: ReactState, e: ReactEvent): ReactState {
  const step = TABLE[s][e.type] as ReactStepFn<ReactEventType> | null;
  return step ? step(s, e as never) : s;
}
/** Where a row's reaction stands. */
export const reactState = (b: Pick<Body, 'armed'>): ReactState => (!b.armed ? 'unarmed' : b.armed.spent ? 'spent' : 'armed');
/** A row with its reaction moved to `s`: unarmed is no `armed` at all. */
export function withReact<B extends Body>(b: B, s: ReactState, armed: Omit<Armed, 'spent'> | null = b.armed ?? null): B {
  if (s === 'unarmed' || !armed) { const { armed: _gone, ...rest } = b; return rest as B; }
  return { ...b, armed: { ability: armed.ability, on: armed.on, spent: s === 'spent' || s === 'fired' } };
}

// ── firing ──
/** The ability a row holds armed, when it is still one of its reactions. */
export const armedAbility = (b: Body): Ability | null => {
  const a = b.armed ? b.abilities.find(x => x.id === b.armed!.ability) : undefined;
  return a?.react ? a : null;
};
/**
 * What firing `r`'s reaction at `aim` would leave of `r` (table 8.9.1's "may"): armed and not spent, up, not held, and
 * then a use's rules 3 to 4 (resolve.ts `charged`: off its cooldown, its gates holding at the aim, a use left, its cost
 * and its kit prices paid). Null when it may not fire.
 */
function chargedReaction(rows: ReadonlyMap<CombatantId, Body>, r: Body, aim: CombatantId, now: Tick, R: Rules): Body | null {
  const a = armedAbility(r), at = rows.get(aim)?.place;
  if (!a || !at || reactState(r) !== 'armed' || r.hp <= 0 || held(r, now)) return null;
  const c = charged(a, r, [...rows.values()], at, now, R);
  return typeof c === 'string' ? null : c.user;
}
/** Whether `r` may fire its reaction at `aim` now. */
export const mayFire = (rows: ReadonlyMap<CombatantId, Body>, r: Body, aim: CombatantId, now: Tick, R: Rules): boolean => chargedReaction(rows, r, aim, now, R) !== null;
/** Whether `r`'s reaction answers a foe's use on `t` at `when`: its own row, or an ally within its reach. */
export const protects = (r: Body, t: Body, when: ReactWhen): boolean => {
  const a = armedAbility(r);
  return a !== null && a.react!.when === when && r.side === t.side && (r.id === t.id || (alive(t) && dist(r.place, t.place) <= a.react!.reach));
};
/** The reactors of a side that answer a use on `t` at `when` and may fire at `aim` (`t` itself, or the attacker for an `after` reaction), in the fight's order. */
export const reactorsFor = (rows: ReadonlyMap<CombatantId, Body>, t: Body, when: ReactWhen, aim: CombatantId, now: Tick, R: Rules): Body[] =>
  [...rows.values()].filter(r => protects(r, t, when) && mayFire(rows, r, aim, now, R));

/** What a fired reaction gave the use it answers: the share a guard takes off it and whether it negates it, with the log's words. */
export type ReactionFired = { readonly guard: number; readonly negate: boolean; readonly said: string; readonly about: readonly CombatantId[] };
/**
 * Fires `r`'s armed reaction on `aim` (kits design 8.4.4 and 8.4.5), as `rows` holds them now: charged as a use is
 * (`charged`: its cost and kit prices paid at once), its time off its next turn (`at += interval(cost)`; none for a
 * `turn` reaction, which moves its turn itself), its cooldown and use counted, and it is spent. Null, changing nothing,
 * when it may no longer fire (an earlier reaction of the same use changed what it asks). Its effect and its ops land on `aim` at their averages from its reactor at its tier, as a
 * trigger's do; a `guard` and a `negate` are given back for the use it answers. Changes `rows`.
 */
export function fireReaction(rows: Map<CombatantId, Body>, reactor: CombatantId, aim: CombatantId, now: Tick, R: Rules): ReactionFired | null {
  const r = rows.get(reactor), paid = r && chargedReaction(rows, r, aim, now, R), a = r && armedAbility(r);
  if (!paid || !a) return null;
  let b: Body = paid;
  if (a.react!.when !== 'turn') b = { ...b, at: tick(b.at + interval(b.speed, a.cost.time, R.fight)) };
  b = withReact(counted({ ...b, readyAt: { ...b.readyAt, [a.id]: tick(now + a.cost.cooldown) } }, a, R), reactStep(reactStep('armed', { type: 'moment', may: true }), { type: 'resolves' }));
  rows.set(b.id, b);
  const ops: LandOp[] = [];
  const f = formulaOf(a, R);
  if (a.effect && f) ops.push(a.effect.type === 'heal' ? { op: 'heal', amount: f, when: 'use' } : a.effect.type === 'shield' ? { op: 'shield', amount: f }
    : { op: 'damage', type: a.effect.type, amount: f, when: 'use' });
  ops.push(...a.ops.filter(landsAlone));
  const landed = ops.length ? landOps(rows, ops, rows.get(b.id)!, [aim], { id: b.id, tier: b.tier }, now, R).landed : [];
  const guard = a.ops.reduce((n, o) => (o.op === 'guard' ? Math.max(n, o.share) : n), 0), negate = a.ops.some(o => o.op === 'negate');
  const dealt = landed.filter(l => l.dealt).map(l => `${rows.get(l.target)?.name ?? l.target} ${l.dealt}`);
  return { guard, negate, said: `${b.name} reacts with ${a.name}${dealt.length ? ` (${dealt.join(', ')})` : ''}`, about: [b.id, ...landed.filter(l => l.dealt).map(l => l.target)] };
}

/**
 * The `turn` reactions armed on the body whose turn comes next (kits design 8.6.3): the first that may fire moves its
 * reactor's turn to just before that body's, never before `now + 1`. It adds no turn: it moves one earlier. Spent until
 * the named body's turn starts, so it cannot answer the same turn twice. Null when none fires.
 */
export function turnReaction(rows: Map<CombatantId, Body>, next: Body, now: Tick, R: Rules): ReactionFired | null {
  const r = [...rows.values()].find(x => x.id !== next.id && x.armed?.on === next.id && armedAbility(x)?.react?.when === 'turn' && mayFire(rows, x, x.id, now, R));
  if (!r) return null;
  const at = Math.max(now + 1, next.at - 1);
  if (r.at <= at) return null;
  const fired = fireReaction(rows, r.id, r.id, now, R);
  if (fired) rows.set(r.id, { ...rows.get(r.id)!, at: tick(at) });
  return fired;
}
/**
 * A turn starting restores the reactions it restores (table 8.9.1): the starting row's own, and every `turn` reaction
 * that named it. A `turn` reaction is not restored by its own reactor's turn, which it moved.
 */
export function restored(rows: readonly Body[], starting: CombatantId): Body[] {
  return rows.map(b => {
    if (!b.armed?.spent) return b;
    const turn = armedAbility(b)?.react?.when === 'turn';
    return (turn ? b.armed.on === starting : b.id === starting) ? withReact(b, reactStep('spent', { type: 'turnStart' })) : b;
  });
}
