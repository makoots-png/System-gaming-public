// mythic.ts: where a mythic row stands in its script, as a machine (notes-11-keystones.md, design B.3), and the pure
// readers of what follows from it. This module is the one writer of a row's `MythicStanding` (a lint test): `mythicStep`
// moves it, the table `MYTHIC_TABLE` saying what each event does in each state; `mythicStart` makes a new row's and
// `mythicJoined` moves a joining row's clock to the fight's now. What is not stored is read here: the gate's HP (which
// row-life.ts, the one writer of a row's life, holds it at), whether it is held there, whether its clock ran out,
// whether it is enraged, which beat comes next, which move lands, where an omen aims and which answers a change met.
// The reducer raises its events (fight-turn.ts `startTurn` and `consequences`, fight.ts's landing and the GM's `mythic`).
// A new event is a member of `MythicEvent` and its cell in every row of `MYTHIC_TABLE` (the typecheck asks), with its
// row in tests/mythic.test.ts and its arrow in scripts/charts/mythic.ts.
import type { Rules } from '../rules.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { bandOf, mythicScriptOf } from '../registry/mythics.ts';
import type { MythicScriptId } from '../registry/mythics.ts';
import type { CombatantId } from './ability-types.ts';
import type { Body } from './effect-ops.ts';
import type { Running } from './fight-types.ts';
import type { AnswerOutcome, Beat, MoveKey, MythicMove, MythicScript, MythicStanding, Omen, OmenAim, OmenKey } from './mythic-types.ts';
import { isUp, rowHp } from './row-hp.ts';
import { perceivedBy } from './sight.ts';
import { dist, inShape, tiles } from './space.ts';
import type { Place } from './space.ts';
import { warded } from './standing.ts';
import { threatOf } from './threat.ts';
import { tick } from './timeline.ts';
import type { Tick } from './timeline.ts';

/** The rules the readers read: a round's length in fight time, which a phase's clock counts in. */
type RoundRules = { readonly fight: Pick<Rules['fight'], 'round'> };
/** The rules `answerBack` reads besides: the rounds an answer winds its phase's clock back (decision 40). */
type AnswerRules = { readonly fight: Pick<Rules['fight'], 'round'> & { readonly mythic: Pick<Rules['fight']['mythic'], 'answerTime'> } };

// ── the machine ──
/** `calm`: in its phase, no omen standing. `omen`: an omen stands and lands whole on its next turn. `faltering`: it stands weakened. */
export type MythicState = MythicStanding['at'];
/** The answer that met an omen, for the log's words: a status that holds, roots or taunts, its bar broken, or the burst share taken. */
export type Answer = 'interrupt' | 'stagger' | 'burst';
/**
 * What moves a standing (design B.3, "Events"). `next`: its phase ends, at its turn start (`turn`) or by the GM's Next
 * phase (`gm`), at fight time `now`. `announce`: its turn starts in `calm` on an omen beat, aimed at `aim` with `hpAt` HP.
 * `beat`: its turn starts in `calm` on an act beat. `cancel` and `weaken`: a change met an answer of that outcome, which
 * winds its phase's clock back by `back` (`answerBack`, decision 40: answering buys the party time). `land`: the
 * landing move went off. `fizzle`: it could not reach its aim. `drop`: the GM dropped the omen.
 */
export type MythicEvent =
  | { readonly type: 'next'; readonly now: Tick; readonly by: 'turn' | 'gm' }
  | { readonly type: 'announce'; readonly omen: OmenKey; readonly aim: Place | CombatantId; readonly hpAt: number }
  | { readonly type: 'beat' }
  | { readonly type: 'cancel'; readonly how: Answer; readonly back: Tick }
  | { readonly type: 'weaken'; readonly how: Answer; readonly back: Tick }
  | { readonly type: 'land' }
  | { readonly type: 'fizzle' }
  | { readonly type: 'drop' };
export type MythicEventType = MythicEvent['type'];
/**
 * Why a standing did not move. `noOmen`: none stands to answer, land or drop. `omenStands`: one stands, so no other is
 * announced and no act beat is taken. `weakened`: a second weaken does nothing. `lastPhase`: the last phase ends only at
 * 0 HP, so no `next` leaves it.
 */
export type MythicRefusal = 'noOmen' | 'omenStands' | 'weakened' | 'lastPhase';

type Calm = Extract<MythicStanding, { readonly at: 'calm' }>;
type Omened = Exclude<MythicStanding, Calm>;
type EventOf<T extends MythicEventType> = Extract<MythicEvent, { readonly type: T }>;
/** A cell: the next standing, or the refusal that leaves it as it was. */
type Cell<S, T extends MythicEventType> = ((s: S, e: EventOf<T>) => MythicStanding) | MythicRefusal;
type TableRow<S> = { readonly [T in MythicEventType]: Cell<S, T> };

/** Its next phase from its first beat, its clock counting from `now`; a standing omen is lost. */
const nextPhase = (s: MythicStanding, e: EventOf<'next'>): Calm => ({ at: 'calm', script: s.script, phase: s.phase + 1, beat: 0, since: e.now });
/** The beat after this one, in the same phase, with no omen standing. */
const onward = (s: MythicStanding): Calm => ({ at: 'calm', script: s.script, phase: s.phase, beat: s.beat + 1, since: s.since });
/** The omen cancelled: the beat after this one, its phase's clock wound back by the event's `back`. */
const cancelled = (s: MythicStanding, e: EventOf<'cancel'>): Calm => ({ ...onward(s), since: tick(s.since + e.back) });
/** The omen weakened: it stands faltering, its phase's clock wound back by the event's `back`. */
const weakened = (s: Omened, e: EventOf<'weaken'>): Omened => ({ ...s, at: 'faltering', since: tick(s.since + e.back) });

/** For each state, what each event does there (design B.3's table, cell for cell). */
const MYTHIC_TABLE: { readonly calm: TableRow<Calm>; readonly omen: TableRow<Omened>; readonly faltering: TableRow<Omened> } = {
  calm: {
    next: nextPhase, announce: (s, e) => ({ ...s, at: 'omen', omen: e.omen, aim: e.aim, hpAt: e.hpAt }), beat: onward,
    cancel: 'noOmen', weaken: 'noOmen', land: 'noOmen', fizzle: 'noOmen', drop: 'noOmen',
  },
  omen: {
    next: nextPhase, announce: 'omenStands', beat: 'omenStands',
    cancel: cancelled, weaken: weakened, land: onward, fizzle: onward, drop: onward,
  },
  faltering: {
    next: nextPhase, announce: 'omenStands', beat: 'omenStands',
    cancel: cancelled, weaken: 'weakened', land: onward, fizzle: onward, drop: onward,
  },
};
/**
 * The standing a monster row of script `id` starts with: calm at the first beat of its first phase, its clock counting
 * from `since` (the row's joining, rows.ts; the fight's `add` moves it with `mythicJoined`). Null for a row with no script.
 */
export const mythicStart = (id: MythicScriptId | null, since: Tick): MythicStanding | null =>
  id === null ? null : { at: 'calm', script: id, phase: 0, beat: 0, since };
/** Row `r` joining a fight at `now`: its phase's clock moved on by `now`, as `joined` (fight.ts) moves its statuses. */
export function mythicJoined<R extends { readonly mythic: MythicStanding | null }>(r: R, now: Tick): R {
  return r.mythic === null ? r : { ...r, mythic: { ...r.mythic, since: tick(r.mythic.since + now) } };
}
/** Every state of a standing, from the table's rows. */
export const MYTHIC_STATES = Object.keys(MYTHIC_TABLE) as readonly MythicState[];
/** Every type of event, from the table's columns. */
export const MYTHIC_EVENTS = Object.keys(MYTHIC_TABLE.calm) as readonly MythicEventType[];

/** The script a standing plays. */
export const scriptOf = (s: MythicStanding): MythicScript => mythicScriptOf(s.script);
/** Whether it is in its script's last phase, which ends only at 0 HP. */
const inLastPhase = (s: MythicStanding): boolean => s.phase >= scriptOf(s).phases.length - 1;

/** Why an event of `type` is refused in `s`, or null when it is taken: the state's refusal first, then the script's. */
function refusalOf(s: MythicStanding, type: MythicEventType): MythicRefusal | null {
  const cell = (MYTHIC_TABLE[s.at] as TableRow<MythicStanding>)[type];
  if (typeof cell === 'string') return cell;
  return type === 'next' && inLastPhase(s) ? 'lastPhase' : null;
}
/** Whether `s` takes an event of `type`: what a view asks before it shows the GM's Drop the omen or Next phase. */
export const mythicCan = (s: MythicStanding, type: MythicEventType): boolean => refusalOf(s, type) === null;
/** The standing after `e`, or why `e` is refused (the standing unchanged). */
export function mythicStep(s: MythicStanding, e: MythicEvent): MythicStanding | Refused<MythicRefusal> {
  const why = refusalOf(s, e.type);
  if (why) return refuse(why);
  const cell = (MYTHIC_TABLE[s.at] as TableRow<MythicStanding>)[e.type] as (s: MythicStanding, e: MythicEvent) => MythicStanding;
  return cell(s, e);
}
/** A row that plays a script: its standing is not null. */
export type Scripted<R> = R & { readonly mythic: MythicStanding };
/** Whether row `r` plays a script (a mythic's row while `fight.mythic.scripts` is on). */
export const playsScript = <R extends { readonly mythic: MythicStanding | null }>(r: R): r is Scripted<R> => !!r.mythic;
/** Row `r` with its standing moved by `e` (`mythicStep`), or why `e` is refused: how the reducer moves a row's standing. */
export function mythicStepped<R extends { readonly mythic: MythicStanding | null }>(r: Scripted<R>, e: MythicEvent): R | Refused<MythicRefusal> {
  const next = mythicStep(r.mythic, e);
  return 'ok' in next ? next : { ...r, mythic: next };
}

// ── the derived readers ──
/** What the readers read of a row: its standing (null on any row that is no mythic), its life and its max HP. */
export type MythicRow = Pick<Body, 'life'> & { readonly sheet: { readonly hpMax: number }; readonly mythic: MythicStanding | null };
const phaseOf = (s: MythicStanding) => scriptOf(s).phases[s.phase];

/**
 * The HP its phase's gate holds it at: its band's gate (registry/mythics.ts `bandOf`, the next gate phase's `from`) of
 * its max HP, rounded up so the gate is never under the share. 0 in the last phase and on a row with no standing, so
 * every other row's life is as it was. A clock phase begins at its gate, so no damage moves it.
 */
export function gateOf(row: MythicRow): number {
  const s = row.mythic;
  return s ? Math.ceil(bandOf(scriptOf(s), s.phase).gate * row.sheet.hpMax) : 0;
}
/** Its phase ends by its gate, is not the last, and its HP is held at the gate (or under it). */
export function heldAtGate(row: MythicRow): boolean {
  const s = row.mythic;
  return !!s && phaseOf(s)?.ends === 'gate' && !inLastPhase(s) && rowHp(row) <= gateOf(row);
}
/** Its phase's clock ran out: `clock` rounds have passed since the phase began. */
export function clockOut(s: MythicStanding, now: Tick, R: RoundRules): boolean {
  const p = phaseOf(s);
  return p !== undefined && now >= s.since + p.clock * R.fight.round;
}
/**
 * Whether it has taken a turn in its phase: an act beat taken (its `beat` moved on) or an omen announced. The phase
 * change spends the turn it happens on, so a phase begins with none.
 */
const actedIn = (s: MythicStanding): boolean => s.at !== 'calm' || s.beat > 0;
/**
 * Its phase is over and its next turn starts the next: a gate phase held at its gate, a clock phase past its clock, once
 * it has taken a turn in it (design B.8 row B2: a party sees every phase). A party that takes a phase's band before the
 * mythic's first turn in it, or a stagger that pushes that turn past a clock phase's clock, still meets the phase's first
 * beat, its HP held at the gate meanwhile.
 */
export function phaseOver(row: MythicRow, now: Tick, R: RoundRules): boolean {
  const s = row.mythic;
  if (!s || !actedIn(s)) return false;
  return phaseOf(s)?.ends === 'clock' ? clockOut(s, now, R) : heldAtGate(row);
}
/**
 * How far an answer of `outcome` met at `now` winds standing `s`'s phase's clock back (decision 40): `mythic.answerTime`
 * rounds for that outcome, never past the phase's start (`since` stays at most `now`, so the clock never holds more than
 * its length), and none in a clock phase, whose clock is the time the party must survive, not the time it has.
 */
export function answerBack(s: MythicStanding, outcome: Exclude<AnswerOutcome, 'none'>, now: Tick, R: AnswerRules): Tick {
  if (phaseOf(s)?.ends !== 'gate') return tick(0);
  return tick(Math.max(0, Math.min(R.fight.mythic.answerTime[outcome] * R.fight.round, now - s.since)));
}
/** A gate phase past its clock: it plays the script's enraged rotation, its doom, until the phase ends. */
export const enraged = (s: MythicStanding, now: Tick, R: RoundRules): boolean => phaseOf(s)?.ends === 'gate' && clockOut(s, now, R);
/** The beat its next turn plays: the rotation (the script's enraged one while `enraged`, else its phase's) at `beat` modulo its length. */
export function beatOf(s: MythicStanding, now: Tick, R: RoundRules): Beat {
  const script = scriptOf(s), rotation = enraged(s, now, R) ? script.enraged : (script.phases[s.phase] ?? script.phases[0]).rotation;
  return rotation[s.beat % rotation.length]!;
}
/**
 * The move that lands on its next turn: the standing omen's `full` move, its `weak` one while it falters; null with
 * none standing. An omen with no weak move is never weakened (`answerMet`), so a faltering one always has one.
 */
export function landingMove(s: MythicStanding): { readonly key: MoveKey; readonly move: MythicMove } | null {
  if (s.at === 'calm') return null;
  const script = scriptOf(s), o = script.omens[s.omen];
  if (!o) return null;
  const key = s.at === 'faltering' && o.weak !== null ? o.weak : o.full;
  return { key, move: script.moves[key]! };
}

/**
 * Where an omen announced by `me` aims (design B.3 `OmenAim`), among the foes it can aim at: up, not warded from it,
 * perceived by its side (as policy.ts's `foesOf` reads them). Each picks one body, ties to row order: `threat`, the body
 * its threat table suggests (its taunter while a taunt holds; with no entry every foe ties, so the first); `weakest`, the
 * lowest share of its max HP; `farthest`, the farthest from it; `crowd`, the body whose tile, as the move's centre,
 * catches the most foes. A blast aims at that body's tile, so stepping out of its area answers it; any other move at
 * the body, so going out of its range makes it fizzle. `self` and `all` aim at itself, so the area moves with it (a
 * shove one tile does not take it out of its own range of 0), and so does any aim with no foe to pick: the move then
 * catches no one and finds no one.
 */
export function omenAim(aim: OmenAim, move: MythicMove, me: Body, f: Running): Place | CombatantId {
  const foes = f.rows.filter(r => r.side !== me.side && isUp(r) && !warded(r, me.side) && perceivedBy(me.side, r, f));
  const chosen = aim === 'self' || aim === 'all' ? undefined : picked(aim, move, me, foes, f);
  if (!chosen) return me.id;
  return move.kind === 'blast' ? chosen.place : chosen.id;
}
/** The first of `foes` with the highest `score`. */
const best = (foes: readonly Body[], score: (b: Body) => number): Body | undefined =>
  foes.reduce<Body | undefined>((top, b) => (top === undefined || score(b) > score(top) ? b : top), undefined);
function picked(aim: Exclude<OmenAim, 'self' | 'all'>, move: MythicMove, me: Body, foes: readonly Body[], f: Running): Body | undefined {
  switch (aim) {
    case 'threat': {
      const suggest = threatOf(f, me)?.suggest;
      return foes.find(b => b.id === suggest) ?? foes[0];
    }
    case 'weakest': return best(foes, b => -rowHp(b) / b.sheet.hpMax);
    case 'farthest': return best(foes, b => dist(me.place, b.place));
    case 'crowd': {
      if (move.kind !== 'blast' || move.reach === 'field') return foes[0];
      const area = { kind: 'radius', radius: tiles(move.reach), ring: null } as const;
      return best(foes, b => inShape(area, me.place, b.place, f.grid, foes).hit.length);
    }
    default: return aim satisfies never;
  }
}

/** An answer a change met and what it does to the omen. */
export type MetAnswer = { readonly how: Answer; readonly outcome: Exclude<AnswerOutcome, 'none'> };
/** What `answerMet` reads of the mythic's row before and after a change. */
export type AnswerRow = Pick<Body, 'life' | 'statuses' | 'stagger'> & { readonly sheet: { readonly hpMax: number } };
/**
 * The answers to `omen` a change of the mythic's row from `before` to `after` met (design B.4), cancels first, each
 * whose outcome does something: a status new on it with an op the omen's interrupt names; its stagger bar broken (its
 * max grew, the test `consequences` makes for the `staggered` effect); its HP down at least the burst share of its max
 * HP from `hpAt`, its HP when the omen was announced (a heal since counts against it). A weaken of an omen with no weak
 * move does nothing, so it is not met.
 */
export function answerMet(omen: Omen, hpAt: number, before: AnswerRow, after: AnswerRow): readonly MetAnswer[] {
  const had = new Set(before.statuses.map(s => s.key as string));
  const interrupted = after.statuses.some(s => !had.has(s.key) && s.def.ops.some(o => (omen.interrupt.by as readonly string[]).includes(o.op)));
  const broken = after.stagger !== null && before.stagger !== null && after.stagger.max > before.stagger.max;
  const burst = omen.burst !== null && hpAt - rowHp(after) >= omen.burst.share * after.sheet.hpMax;
  const met: [Answer, AnswerOutcome][] = [];
  if (interrupted) met.push(['interrupt', omen.interrupt.outcome]);
  if (broken) met.push(['stagger', omen.stagger]);
  if (burst && omen.burst) met.push(['burst', omen.burst.outcome]);
  return met
    .flatMap(([how, outcome]): MetAnswer[] => (outcome === 'cancel' || (outcome === 'weaken' && omen.weak !== null) ? [{ how, outcome }] : []))
    .sort((a, b) => (a.outcome === b.outcome ? 0 : a.outcome === 'cancel' ? -1 : 1));
}
