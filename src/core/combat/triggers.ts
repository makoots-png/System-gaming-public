// triggers.ts: what a status does when something happens to its bearer (docs/agent-handoff/kits/design.md section 1.3,
// table 2.5). A trigger lives on a status def and nowhere else: a passive skill and an item carry one through a worn
// status, a zone through its hold. Pure. `eventsOf` lists the events a use raised, in order (rule 19b); `fire` fires the
// triggers they set off, to depth `kit.depth` and at most `kit.fires` firings a command, each trigger's limit counted on
// its bearer's row (`trips`, the machine `tripStep`). A new event is a member of `BearerEvent` (or of `TriggerEvent`),
// its line in `eventsOf` or where the fight raises it, and a case in tests/triggers.test.ts.

import type { StatusKey, LandOp } from './effect-ops.ts';
import type { Body, OpRules, Reach } from './effect-ops.ts';
import { isStacking, removeStatus, stackOf, withStatuses } from './effect-ops.ts';
import { stackStep } from './stacks.ts';
import type { Ability, CombatantId, Outcome, Tag } from './ability-types.ts';
import { alive, landOps, landThreshold, reached } from './land.ts';
import { refunded, tick } from './timeline.ts';
import { tallied } from './row-tally.ts';
import type { Tick } from './timeline.ts';

/** What can happen to a bearer: it deals a hit, is struck, deals or takes a crit, kills, avoids, starts or ends a turn, moves. */
export type BearerEvent = 'hitDealt' | 'struck' | 'critDealt' | 'critTaken' | 'kill' | 'avoided' | 'turnStart' | 'turnEnd' | 'moved' | 'down';
const BEARER_EVENT_SET: { readonly [E in BearerEvent]: true } = {
  hitDealt: true, struck: true, critDealt: true, critTaken: true, kill: true, avoided: true, turnStart: true, turnEnd: true, moved: true, down: true,
};
/** Every bearer event, once: what a parser reads a stack's leave or a trigger's event against. */
export const BEARER_EVENTS = Object.keys(BEARER_EVENT_SET) as readonly BearerEvent[];
const isBearerEvent = (e: TriggerEvent): e is BearerEvent => Object.hasOwn(BEARER_EVENT_SET, e);
/** The events with another body in them: the one hit, the striker, the one killed, the one whose use was avoided. */
export type Party = Extract<BearerEvent, 'hitDealt' | 'struck' | 'critDealt' | 'critTaken' | 'kill' | 'avoided'>;
export const PARTY_EVENTS: readonly Party[] = ['hitDealt', 'struck', 'critDealt', 'critTaken', 'kill', 'avoided'];
/** Every event a trigger may name: a bearer's, a status of a key gained or ended, an ability of a tag used. */
export type TriggerEvent = BearerEvent | 'statusGained' | 'statusEnded' | 'used';
/** How often a trigger fires: on every event, once in a round of fight time, or `n` times a fight (1 to `fightUses`). */
export type Limit = { readonly kind: 'each' } | { readonly kind: 'round' } | { readonly kind: 'fight'; readonly n: number };
/**
 * A trigger: an event, how often, where its ops land and the ops (at most `triggerOps`). `other` (the event's other body)
 * is allowed only on an event that has one; a hit, a crit or a kill may name a tag, so only one dealt by an ability with
 * that tag fires it; a status gained or ended names its key; an ability used names its tag.
 */
/**
 * A condition on where (kits design 8.8): a trigger fires only while its bearer holds a status of `key`, or stands in a
 * zone of `zone`'s name (it holds that zone's hold).
 */
export type Need = { readonly kind: 'holds'; readonly key: StatusKey } | { readonly kind: 'inside'; readonly zone: string };
export type Trigger = { readonly limit: Limit; readonly ops: readonly LandOp[]; readonly need?: Need } & (
  | { readonly on: Party; readonly tag: Tag | null; readonly to: 'self' | 'other' | Reach }
  | { readonly on: Exclude<BearerEvent, Party>; readonly to: 'self' | Reach }
  | { readonly on: 'statusGained' | 'statusEnded'; readonly key: StatusKey; readonly to: 'self' | Reach }
  | { readonly on: 'used'; readonly tag: Tag; readonly to: 'self' | Reach });

// ── a trigger's limit on its bearer (table 2.5) ──
export const TRIP_STATES = ['ready', 'tripped', 'counting', 'spent'] as const;
export type TripState = (typeof TRIP_STATES)[number];
/**
 * Where one trigger of one status on one bearer stands: ready (never fired, or a limit of `each`), fired in round `round`
 * (a limit of once a round), fired `k` of its `n` times a fight, or spent (all `n` fired).
 */
export type Trip = { readonly at: 'ready' } | { readonly at: 'tripped'; readonly round: number } | { readonly at: 'counting'; readonly k: number } | { readonly at: 'spent' };
/** Its event in fight round `round` (`floor(now / round)`); or skipped past the chain's depth or the command's firings, which changes nothing. */
export type TripEvent = { readonly type: 'event'; readonly round: number } | { readonly type: 'skipped' };
export type TripEventType = TripEvent['type'];
export const READY: Trip = { at: 'ready' };
type TripStep<E extends TripEventType> = (t: Trip, e: Extract<TripEvent, { type: E }>, limit: Limit) => { readonly trip: Trip; readonly fires: boolean };
const counted = (k: number, limit: Limit): Trip => (limit.kind === 'fight' && k >= limit.n ? { at: 'spent' } : { at: 'counting', k });
/** The first firing: `each` stays ready, `round` trips this round, `fight` counts one. */
const first: TripStep<'event'> = (_t, e, limit) => ({ trip: limit.kind === 'each' ? READY : limit.kind === 'round' ? { at: 'tripped', round: e.round } : counted(1, limit), fires: true });
/** Tripped: the same round changes nothing; a later round fires again. */
const again: TripStep<'event'> = (t, e) => (t.at === 'tripped' && e.round > t.round ? { trip: { at: 'tripped', round: e.round }, fires: true } : { trip: t, fires: false });
/** Counting: one more of the fight's `n`, spent at `n`. */
const more: TripStep<'event'> = (t, _e, limit) => ({ trip: counted((t.at === 'counting' ? t.k : 0) + 1, limit), fires: true });
const stay: TripStep<'skipped'> = t => ({ trip: t, fires: false });
/** Table 2.5 of the kits design. `null`: the event does not apply there, and the trip stays as it is without firing. */
const TABLE: { readonly [S in TripState]: { readonly [E in TripEventType]: TripStep<E> | null } } = {
  ready: { event: first, skipped: stay },
  tripped: { event: again, skipped: stay },
  counting: { event: more, skipped: stay },
  spent: { event: null, skipped: stay },
};
/** A trigger's trip after `event` under its `limit`, and whether it fires. Never changes its input. */
export function tripStep(t: Trip, event: TripEvent, limit: Limit): { readonly trip: Trip; readonly fires: boolean } {
  // The table's type pairs each key with the step for that event, so the step for `event.type` takes `event`.
  const step = TABLE[t.at][event.type] as TripStep<TripEventType> | null;
  return step ? step(t, event as never, limit) : { trip: t, fires: false };
}
/** The key a trigger's trip goes by on its bearer's row: its status's key and its place in the def's list. */
export const tripKey = (key: StatusKey, i: number): string => `${key}#${i}`;

// ── the events a use raises (rule 19b) ──
/**
 * One event on one bearer: what it was, the other body in it (the one hit, the striker, the one killed), the tags of the
 * ability behind it (none for a trigger's own hit) and, for a status gained or ended, its key.
 */
export type Raised = { readonly bearer: CombatantId; readonly event: TriggerEvent; readonly other: CombatantId | null; readonly tags: readonly Tag[]; readonly key: StatusKey | null };
export const raised = (bearer: CombatantId, event: TriggerEvent, other: CombatantId | null = null, tags: readonly Tag[] = [], key: StatusKey | null = null): Raised => ({ bearer, event, other, tags, key });

/**
 * The events a use of `a` by `by` raised (design 1.3.5): by outcome, in the order resolve took the targets, and in each
 * the user's before the target's. A hit is a damaging outcome that was not dodged and dealt something: the user deals a
 * hit, the target is struck; a crit adds a crit dealt and taken; a target taken to 0 is the user's kill; a target out of
 * the shape or that resisted avoided the use; each status the use put on is gained, and each a cure took whole has
 * ended (from the rows `before` and `after` the use). Last, the use itself, when the ability has tags.
 */
export function eventsOf(a: Pick<Ability, 'ops' | 'tags'>, by: CombatantId, outcomes: readonly Outcome[], before: readonly Body[], after: readonly Body[]): Raised[] {
  const tags = a.tags ?? [], out: Raised[] = [];
  const held = (rows: readonly Body[], id: CombatantId, key: StatusKey): boolean => rows.some(r => r.id === id && r.statuses.some(s => s.key === key));
  for (const o of outcomes) {
    const mine: Raised[] = [], theirs: Raised[] = [];
    const hit = (o.type === 'physical' || o.type === 'magical') && o.avoid !== 'out' && o.dealt > 0;
    if (hit) { mine.push(raised(by, 'hitDealt', o.target, tags)); theirs.push(raised(o.target, 'struck', by, tags)); }
    if (o.crit) { mine.push(raised(by, 'critDealt', o.target, tags)); theirs.push(raised(o.target, 'critTaken', by, tags)); }
    if (o.down) { mine.push(raised(by, 'kill', o.target, tags)); theirs.push(raised(o.target, 'down', by, tags)); }
    if (o.avoid === 'out' || o.avoid === 'resisted') theirs.push(raised(o.target, 'avoided', by, tags));
    for (const k of o.statuses) theirs.push(raised(o.target, 'statusGained', by, tags, k));
    for (const op of a.ops) if (op.op === 'cureStatus' && held(before, o.target, op.key) && !held(after, o.target, op.key)) theirs.push(raised(o.target, 'statusEnded', by, tags, op.key));
    out.push(...mine, ...theirs);
  }
  if (tags.length) out.push(raised(by, 'used', null, tags));
  return out;
}

// ── firing (rule 19b) ──
type TriggerTo = Trigger['to'];
/** Whether trigger `t` answers event `e`: the same event, and its tag, key or the use's tag where it names one. */
function matches(t: Trigger, e: Raised): boolean {
  if (t.on !== e.event) return false;
  if (t.on === 'statusGained' || t.on === 'statusEnded') return t.key === e.key;
  if (t.on === 'used') return e.tags.includes(t.tag);
  return !('tag' in t) || t.tag === null || e.tags.includes(t.tag);
}
/** A trigger's condition on where (kits design 8.8): its bearer holds the status, or stands in a zone of the name. */
const needMet = (t: Trigger, b: Body): boolean => !t.need || (t.need.kind === 'holds' ? b.statuses.some(s => s.key === (t.need as { key: StatusKey }).key) : insideZone(b, t.need.zone));
/** Whether `b` stands in a zone named `name`: it holds that zone's open hold (zones.ts, whose def is labelled by the zone's name). */
export const insideZone = (b: Pick<Body, 'statuses'>, name: string): boolean => b.statuses.some(s => s.zone !== undefined && s.until === null && s.def.label === name);
const targetsOf = (rows: ReadonlyMap<CombatantId, Body>, bearer: Body, to: TriggerTo, e: Raised): CombatantId[] =>
  to === 'self' ? [bearer.id] : to === 'other' ? (e.other !== null && rows.has(e.other) ? [e.other] : []) : reached(rows, bearer, to).map(b => b.id);
/** A bearer's foe taken down: one more of its kills in its tally (row-tally.ts; the formula's `kills`, design 1.5), and its killer on the foe's. */
function withKill(rows: Map<CombatantId, Body>, killer: CombatantId, killed: CombatantId): void {
  const k = rows.get(killer), d = rows.get(killed);
  if (!k || !d) return;
  for (const b of tallied([k, d], { type: 'raised', events: [raised(killer, 'kill', killed)] })) rows.set(b.id, b);
}
/** The bearer's stacking statuses whose stacks leave on `event` lose them all (table 2.1, its leave `event`). */
function leaveOn(b: Body, event: BearerEvent, now: Tick, R: OpRules): Body {
  let list = b.statuses;
  for (const s of b.statuses) {
    if (!isStacking(s.def) || s.def.stack.leave.kind !== 'event') continue;
    const after = stackStep(stackOf(s), { type: 'event', event }, { rule: s.def.stack, at: null }).stack;
    if (after.at === 'absent') list = removeStatus(list, s.key);
  }
  return list === b.statuses ? b : withStatuses(b, list, now, R);
}
/** Whether any row could answer an event: a status with a trigger, or with stacks that leave on an event. */
const answers = (bodies: readonly Body[]): boolean =>
  bodies.some(b => b.statuses.some(s => (s.def.triggers?.length ?? 0) > 0 || (isStacking(s.def) && s.def.stack.leave.kind === 'event')));

/** What firing did: the rows after it, a log phrase for each trigger that fired and the rows those phrases name (`about`), how many fired, and the deepest depth one fired at (0: none). */
export type TriggerFired = { readonly bodies: Body[]; readonly said: string[]; readonly about: CombatantId[]; readonly fires: number; readonly deepest: number };

/**
 * Fires the triggers `events` set off at `now` (design 1.3, rule 19b). The events are depth 1; the events a trigger's
 * ops raise (a hit dealt and struck, a kill, a status gained or ended) are one deeper, and nothing fires past
 * `kit.depth`; at most `kit.fires` triggers fire in all. Each event's bearer, if it is up, fires its live statuses'
 * triggers in list order and each def's in order, when the trigger answers the event and its limit lets it
 * (`tripStep` on the row's `trips`). A trigger's ops land from its status's source at their averages, as a hit the
 * bearer deals (design 1.3.9), on itself, the event's other body or its reach; a `refund` gives the bearer back that
 * share of the wait to its next turn; a status put on checks its threshold, which lands at once. Then the bearer's
 * stacks that leave on the event go. A kill counts on the killer's row whatever the depth.
 */
export function fire(bodies: readonly Body[], events: readonly Raised[], now: Tick, R: OpRules): TriggerFired {
  const rows = new Map(bodies.map(b => [b.id, b] as const)), said: string[] = [], about: CombatantId[] = [];
  for (const e of events) if (e.event === 'kill' && e.other !== null) withKill(rows, e.bearer, e.other);
  if (!events.length || !answers(bodies)) return { bodies: bodies.map(b => rows.get(b.id)!), said, about, fires: 0, deepest: 0 };
  const K = R.fight.kit, round = Math.floor(now / R.fight.round);
  let queue = events, fires = 0, deepest = 0;
  for (let depth = 1; queue.length && depth <= K.depth; depth++) {
    const next: Raised[] = [];
    for (const e of queue) {
      const b = rows.get(e.bearer);
      // a bearer fires only while up, but on its own going down (kits design 8.5.3)
      if (!b || (b.hp <= 0 && e.event !== 'down')) continue;
      for (const s of b.statuses) {
        if (s.until !== null && s.until <= now) continue;
        (s.def.triggers ?? []).forEach((t, i) => {
          if (!matches(t, e) || !needMet(t, b)) return;
          const cur = rows.get(b.id)!, key = tripKey(s.key, i);
          if (fires >= K.fires) return;
          const step = tripStep(cur.trips?.[key] ?? READY, { type: 'event', round }, t.limit);
          if (!step.fires) return;
          fires++;
          deepest = depth;
          const { [key]: _was, ...rest } = cur.trips ?? {};
          const trips = step.trip.at === 'ready' ? rest : { ...rest, [key]: step.trip };
          let bearer: Body = { ...cur, ...(Object.keys(trips).length || cur.trips ? { trips } : {}) };
          const pct = t.ops.reduce((n, o) => (o.op === 'refund' ? Math.max(n, o.pct) : n), 0);
          if (pct > 0) bearer = refunded(bearer, now, tick(Math.max(0, bearer.at - now)), pct);
          rows.set(bearer.id, bearer);
          const r = landOps(rows, t.ops, bearer, targetsOf(rows, bearer, t.to, e), s.source, now, R, { cross: true, event: e.key ?? s.key });
          for (const f of r.fired) landThreshold(rows, f, now, R);
          about.push(bearer.id, ...r.landed.filter(l => l.dealt).map(l => l.target));
          said.push(`${bearer.name}'s ${s.def.label}${r.landed.some(l => l.dealt) ? ` (${r.landed.filter(l => l.dealt).map(l => `${rows.get(l.target)?.name ?? l.target} ${l.dealt}`).join(', ')})` : ''}`);
          for (const l of r.landed) {
            if (l.down) withKill(rows, bearer.id, l.target);
            if (depth >= K.depth) continue;
            if (l.dealt > 0) next.push(raised(bearer.id, 'hitDealt', l.target), raised(l.target, 'struck', bearer.id));
            if (l.down) next.push(raised(bearer.id, 'kill', l.target), raised(l.target, 'down', bearer.id));
            for (const k of l.gained) next.push(raised(l.target, 'statusGained', bearer.id, [], k));
            for (const k of l.cured) next.push(raised(l.target, 'statusEnded', bearer.id, [], k));
          }
        });
      }
      const after = rows.get(e.bearer)!;
      if (isBearerEvent(e.event) && alive(after)) rows.set(after.id, leaveOn(after, e.event, now, R));
    }
    queue = next;
  }
  return { bodies: bodies.map(b => rows.get(b.id)!), said, about, fires, deepest };
}
