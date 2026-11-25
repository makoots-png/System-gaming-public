// fight-view.ts: every number the fight screen draws (docs/agent-handoff/rw/m2-plan.md, unit P3): the order ahead, a
// combatant's card, the targets an ability can aim at, and a step toward or away from a picked body (the move control).
// Pure, and no new rule: each number comes from space.ts, timeline.ts, effect-ops.ts or a rule of resolve.ts. Aims and
// steps read `Spot`s, the little a phone knows of a row, so the GM's screen (the fight's rows through `spotOf`) and a
// player's (the room doc's rows) draw with the same code. A new number a screen draws is a function here with its case in
// tests/fight-view.test.ts.

import type { Rules } from '../rules.ts';
import { dist, place, reachable } from './space.ts';
import { bandOf, mythicScriptOf } from '../registry/mythics.ts';
import { clockOut, enraged, heldAtGate } from './mythic.ts';
import type { MythicState } from './mythic.ts';
import type { AnswerOutcome, Interrupt, MythicMove, MythicScript, MythicScriptId, MythicStanding, Omen, OmenAim, OmenKey } from './mythic-types.ts';
import type { DocStanding } from './fight-doc.ts';
import { canAimAt, inRange, swapWith, whoIsIn } from './resolve.ts';
import type { Grid, Place, MoveReach, Side, Tiles } from './space.ts';
import { acted, ahead, paceCost, roundOf, roundsOf, tick } from './timeline.ts';
import type { Tick } from './timeline.ts';
import { printFormula } from '../formula.ts';
import { formulaOf } from '../registry/ability-kinds.ts';
import type { KindRules } from '../registry/ability-kinds.ts';
import type { Ability, AbilityId, CombatantId } from './ability-types.ts';
import { isUp, rowHp } from './row-hp.ts';
import type { LifeState } from '../hunter/vitals.ts';
import { sheetStatuses, statusKey } from './effect-ops.ts';
import type { Body, Channel, CombatantKind, OpRules, SheetStatus, StatusDef } from './effect-ops.ts';
import { usesOf } from './uses.ts';
import type { Fight, ForcedFace, StatusGrant } from './fight-types.ts';
import { fudgeOf } from './fudge.ts';
import { taunter, threatOf } from './threat.ts';
import type { ThreatView } from './threat.ts';

// ── the order ahead ──

/** One turn of the order ahead: whose it is (the row as the fight holds it now), when it starts, and its round from 1. */
export type Turn = { readonly row: Body; readonly at: Tick; readonly round: number };

/**
 * The next `n` turns of a running fight if everyone takes a standard action (timeline.ts `ahead`), the current turn first.
 * The current turn is `currentId`'s, at the fight's `now`, whatever has happened since it began: a row that joined at the
 * same time with a higher tie, or the current row's own move, can put another row first in `ahead`, and the GM's bar and
 * the players' doc must name the same turn and round. Only rows that are up take turns. A fight in setup or ended has no order.
 */
export function order(f: Fight, n: number, R: Rules): Turn[] {
  if (f.phase !== 'running' || n < 1) return [];
  const turn = (id: CombatantId, at: Tick): Turn => ({ row: f.rows.find(r => r.id === id)!, at, round: roundOf(at, R.fight) });
  const up = f.rows.filter(isUp), cur = up.find(r => r.id === f.currentId);
  if (!cur) return ahead(up, n, R.fight).map(t => turn(t.id, t.at));
  // The turn under way is taken as a standard action, unless the row's time has already moved past it.
  const after = cur.at > f.now ? cur : acted(cur, f.now, paceCost('standard', R.fight), R.fight);
  const rest = ahead(up.map(r => (r === cur ? after : r)), n - 1, R.fight);
  return [turn(cur.id, f.now), ...rest.map(t => turn(t.id, t.at))];
}

// ── a card ──

/**
 * What a combatant's card shows: whether it is its turn, its speed and the armor, resist and stride of its sheet, HP,
 * mana and fatigue against the sheet's maxima, its shield, a stagger bar in whole points, its statuses with the rounds
 * left (one decimal, null until removed, as the sheet keeps them) and whether it is down. A screen draws a card from this
 * alone and updates in place the parts whose value changed (src/views/patch.ts), so a new number on a card is a field here.
 */
export type Card = {
  readonly turn: boolean;
  /** Rounds the shield has left, one decimal, or null. */
  readonly shieldLeft: number | null;
  readonly channel: ChannelView | null;
  readonly intent: IntentView | null;
  readonly threat: ThreatView | null;
  readonly taunt: TauntView | null;
  readonly speed: number; readonly armor: number; readonly resist: number; readonly stride: number;
  readonly hp: number; readonly hpMax: number;
  readonly mana: number; readonly manaMax: number;
  readonly fatigue: number; readonly fatigueMax: number;
  readonly shield: number | null;
  /** The bar in whole points, and while its last break holds the monster back, the rounds a break costs (`staggerCost`). */
  readonly stagger: { readonly fill: number; readonly max: number; readonly staggered: number | null } | null;
  readonly statuses: readonly SheetStatus[];
  readonly down: boolean;
  /** A summon's rounds left, one decimal, rounded up (kits design 1.9); null for any other body and for a summon that stays. */
  readonly summon: number | null;
  /** The GM's weight on this row's dice: its side's and its own (fudge.ts `fudgeOf`). 0 in a fight that holds none. GM's screen only. */
  readonly fudge: number;
  /** The weight set on this row alone, for its own stepper. */
  readonly fudgeOwn: number;
  /** The face this row's next d20 roll is forced to, or null. */
  readonly forced: ForcedFace | null;
};

/** Whether the GM has any weight or forced roll on in `f` (the gold dot on the Fight tools). A fight with no fudge field has none. */
export const fudgeShown = (f: Fight): boolean =>
  f.phase !== 'ended' && (f.fudge.sides.party !== 0 || f.fudge.sides.foe !== 0 || Object.keys(f.fudge.rows).length > 0 || Object.keys(f.fudge.forced).length > 0);

/** The time a fight's numbers are read at: its `now`, or 0 in setup, which has no time yet and where every status starts. */
export const timeOf = (f: Fight): Tick => f.phase === 'setup' ? tick(0) : f.now;

/** The card of `row` in fight `f`. The reducer drops a shield at the first turn start after its end, so a row's shield is live. */
export function cardOf(f: Fight, row: Body, R: OpRules & KindRules): Card {
  return {
    turn: f.phase === 'running' && f.currentId === row.id,
    speed: row.speed, armor: row.sheet.armor, resist: row.sheet.resist, stride: row.sheet.stride,
    hp: rowHp(row), hpMax: row.sheet.hpMax, mana: row.mana, manaMax: row.sheet.manaMax, fatigue: row.fatigue, fatigueMax: row.sheet.fatigueMax,
    shield: row.shield?.amount ?? null,
    shieldLeft: row.shield ? roundsLeft(row.shield.until, timeOf(f), R) : null,
    stagger: row.stagger && {
      fill: Math.round(row.stagger.fill), max: Math.round(row.stagger.max),
      staggered: row.stagger.until !== undefined && timeOf(f) < row.stagger.until ? R.fight.staggerCost : null,
    },
    statuses: sheetStatuses(row.statuses, timeOf(f), R),
    down: !isUp(row),
    channel: channelView(row, R),
    intent: intentOf(row, R),
    threat: threatOf(f, row),
    taunt: tauntOf(row, timeOf(f), R),
    summon: row.kind === 'summon' ? roundsLeft(row.until, timeOf(f), R) : null,
    fudge: f.phase === 'ended' ? 0 : fudgeOf(f.fudge, row),
    fudgeOwn: f.phase === 'ended' ? 0 : f.fudge.rows[row.id] ?? 0,
    forced: f.phase === 'ended' ? null : f.fudge.forced[row.id] ?? null,
  };
}

/** Rounds from `now` to `until`, rounded up to one decimal, never below 0. */
const roundsLeft = (until: Tick, now: Tick, R: { readonly fight: { readonly round: number } }): number => Math.max(0, roundsOf(until - now, R, 'up'));

// ── the extras (design 4) ──

/**
 * A channel as a card, a token and the hotbar show it while it holds or waits to fire broken: its ability's name, the charge of its max, its state, and the
 * payoff at this charge as a factor of the ability's base, by the growth its maker ticked (design 4.1: linear
 * `1 + channelLin * charge`, exponential `channelExp ^ charge`), to two decimals.
 */
export type ChannelView = {
  readonly ability: AbilityId; readonly name: string; readonly charge: number; readonly max: number; readonly state: Channel['state']; readonly factor: number;
};
export function channelView(row: Body, R: Pick<Rules, 'fight'>): ChannelView | null {
  const c = row.channel;
  // a channel that went off is spent: nothing to show until its user begins another
  if (!c || c.state === 'fired') return null;
  const a = row.abilities.find(x => x.id === c.ability), growth = a?.channel?.growth ?? 'exponential';
  const factor = growth === 'linear' ? 1 + R.fight.channelLin * c.charge : Math.pow(R.fight.channelExp, c.charge);
  return { ability: c.ability, name: a?.name ?? c.ability, charge: c.charge, max: a?.channel?.max ?? R.fight.channelMax, state: c.state, factor: Math.round(factor * 100) / 100 };
}

/** The most lines `abilityLines` gives: what it does, its shape, its range and how it is avoided. */
export const ABILITY_LINES = 4;
/**
 * The numbers of an ability in words, as a revealed intent shows them (design 4.5): what it does and its formula, its
 * shape, its range, and how it is avoided. At most four lines.
 */
export function abilityLines(a: Ability, R: KindRules): string[] {
  const out: string[] = [];
  if (a.effect) {
    const what = a.effect.type === 'heal' ? 'Heals' : a.effect.type === 'shield' ? 'Shields' : `${a.effect.type === 'physical' ? 'Physical' : 'Arcane'} damage`;
    const f = formulaOf(a, R);
    if (f) out.push(`${what} ${printFormula(f)}`);
  }
  const sh = a.shape;
  if (sh.kind === 'radius') out.push(`Radius ${sh.radius} tile${sh.radius === 1 ? '' : 's'}${sh.ring ? `, ring to ${sh.ring.outer} at ${sh.ring.share}%` : ''}`);
  else if (sh.kind === 'line') out.push(`A line${sh.pierce ? ' that pierces' : ''}`);
  if (a.aim !== 'self') out.push(`Range ${a.range} tile${a.range === 1 ? '' : 's'}`);
  const d = a.delivery;
  out.push(d.kind === 'travel' ? 'Avoided by moving out of it' : d.kind === 'direct' ? 'Resisted with Discipline' : 'Cannot be avoided');
  return out.slice(0, ABILITY_LINES);
}

/**
 * What a monster will do, as its card and the map show it: the ability's name and its aim, whether the GM revealed its
 * numbers and those numbers (`abilityLines`), and the splash of an area ability (null for any other). A channel that holds
 * is the intent, at its charge, because the table can see it winding up (design 4.5). Null with neither.
 */
export type IntentView = {
  readonly name: string; readonly target: CombatantId | Place; readonly revealed: boolean; readonly lines: readonly string[];
  readonly area: { readonly radius: number; readonly outer: number | null } | null; readonly channel: ChannelView | null;
};
export function intentOf(row: Body, R: KindRules): IntentView | null {
  const c = row.channel?.state === 'holding' ? row.channel : null, i = c ?? row.intent;
  if (!i) return null;
  const a = row.abilities.find(x => x.id === i.ability);
  const revealed = c ? false : row.intent?.revealed === true;
  const area = a && a.shape.kind === 'radius' ? { radius: a.shape.radius, outer: a.shape.ring?.outer ?? null } : null;
  return { name: a?.name ?? i.ability, target: i.aim, revealed, lines: revealed && a ? abilityLines(a, R) : [], area, channel: c && channelView(row, R) };
}

/** A taunt on a body: who taunted it and the rounds it has left (null until removed). */
export type TauntView = { readonly by: CombatantId; readonly left: number | null };
export function tauntOf(row: Body, now: Tick, R: { readonly fight: { readonly round: number } }): TauntView | null {
  const t = taunter(row);
  return t && { by: t.by, left: t.until === null ? null : roundsLeft(t.until, now, R) };
}

// ── a cooldown ──

/**
 * The rounds until ability `id` is ready again, from the times its row's abilities are ready (`readyAt` of a row, or the
 * room doc's `ready` for the current row) and the fight's `now`: rounded up to one decimal, so a use not yet ready never
 * reads 0; 0 when it is ready.
 */
export function readyIn(readyAt: Readonly<Record<string, Tick>>, id: string, now: Tick, R: { readonly fight: { readonly round: number } }): number {
  const at = Object.hasOwn(readyAt, id) ? readyAt[id]! : now;
  return at <= now ? 0 : roundsOf(at - now, R, 'up');
}

// ── uses left (kits table 2.3) ──

/**
 * The uses left of each of `b`'s abilities limited a fight or a rest, by ability id, 0 for a spent one, in its ability
 * order, at most `max`: the doc's `left` for the current row, and the GM's hotbar.
 */
export function usesLeft(b: Pick<Body, 'abilities' | 'used'>, max: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of b.abilities.slice(0, max)) { const u = usesOf(a, b); if (u) out[a.id] = u.at === 'spent' ? 0 : u.left; }
  return out;
}

// ── the Status window ──

/**
 * What the GM's Status window sends as the `status` command's `add`: the status at the tier the window picked, lasting
 * the rounds typed (a round is `R.fight.round` ticks; null lasts until removed).
 */
export const statusGrant = (key: string, def: StatusDef, rounds: number | null, tier: number, R: { readonly fight: { readonly round: number } }): StatusGrant =>
  ({ key: statusKey(key), def, duration: rounds === null ? null : tick(Math.round(rounds * R.fight.round)), tier });

// ── aims and steps, on spots ──

/** A row as aims and steps read it: the GM's from `spotOf`, a player's from the room doc. */
export type Spot = { readonly id: CombatantId; readonly side: Side; readonly kind: CombatantKind; readonly place: Place; readonly down: boolean };
export const spotOf = (b: Body): Spot => ({ id: b.id, side: b.side, kind: b.kind, place: b.place, down: !isUp(b) });
/** The room fight doc's rows as spots (a doc's tile is plain numbers on the wire, and down is its life's), each keeping its other fields. */
export const docSpots = <T extends Omit<Spot, 'place' | 'down'> & { readonly place: { readonly x: number; readonly y: number }; readonly life: { readonly at: LifeState } }>(rows: readonly T[]): (T & Spot)[] =>
  rows.map(r => ({ ...r, place: place(r.place.x, r.place.y), down: !isUp(r) }));
/** On the map: land.ts `alive` over a spot. A monster or shadow that is down is gone; a hunter that is down lies there. */
export const onMap = (s: Spot): boolean => !s.down || s.kind === 'hunter';

/**
 * The rows a reaction before a turn of row `by` may wait for (kits design 8.4): every other row, the other side's rows
 * still up first, each part in the order given. The first is the one an arm that names no row waits for, so the GM's
 * card and a player's phone offer the same rows and wait on the same one.
 */
export function waitChoices<S extends Pick<Spot, 'id' | 'side' | 'down'>>(rows: readonly S[], by: CombatantId): S[] {
  const me = rows.find(x => x.id === by), others = rows.filter(x => x.id !== by);
  const foes = others.filter(x => !!me && x.side !== me.side && !x.down);
  return [...foes, ...others.filter(x => !foes.includes(x))];
}
/** The words of the choice of the row a reaction before a turn waits for: its label, and the window a player picks it in. */
export const WAIT_WORDS = {
  label: 'Before the turn of',
  body: (reaction: string): string => `${reaction} fires right before that target's turn.`,
} as const;

/** What aiming the ability at one candidate gives: its 5-10-5 distance, and whether rules 5 and 6 of resolve.ts let it be hit. */
export type AimAt<T extends Spot> = { readonly target: T; readonly dist: Tiles; readonly inRange: boolean; readonly inShape: boolean };
/** What `aims` reads of an ability. */
export type Aiming = Pick<Ability, 'aim' | 'range' | 'shape' | 'foesOnly' | 'move'>;

/**
 * The bodies `by` can aim `a` at, nearest first (then in the order given): itself for a self ability, its side for an ally
 * one, the other side for a foe or place one, each admitted by resolve.ts `canAimAt` (only bodies that are up; dead
 * bodies are never offered) and `swapWith` (a swap never aims at its user, and a shadow swap only aims at a shadow).
 * Rule 5: in range when the distance is at most the range. Rule 6: in the shape when the use aimed at its tile covers
 * it, among the bodies on the map (the user's side left out of a `foesOnly` use), so a line that does not pierce stops
 * at the first body and a wall stops a line. A self or ally use takes its one target. Taunt (rule 2) is the reducer's
 * alone: a spot carries no statuses.
 */
export function aims<T extends Spot>(spots: readonly T[], by: CombatantId, a: Aiming, grid: Grid): AimAt<T>[] {
  const user = spots.find(s => s.id === by);
  if (!user) return [];
  const map = spots.filter(onMap);
  const candidates = (a.aim === 'self' ? [user] : map.filter(s => (a.aim === 'ally') === (s.side === user.side)))
    .filter(s => canAimAt(s) && swapWith(a, user, s));
  const covers = (t: T): boolean => {
    const { hit, ring } = whoIsIn(a, user, map, t.place, grid);
    return hit.includes(t) || ring.includes(t);
  };
  return candidates
    .map(t => ({ target: t, dist: dist(user.place, t.place), inRange: inRange(a, user, t.place), inShape: covers(t) }))
    .sort((x, y) => x.dist - y.dist);
}

/**
 * The walk of the move control: of the tiles `by` reaches in at most `stride` steps around the walls and the other bodies
 * on the map (space.ts `reachable`, in order of steps, then `y`, then `x`), the first that `better` prefers over every
 * other by its distance to the target. Null when no tile beats standing still, or a body is not on the map.
 */
function stepBy(spots: readonly Spot[], by: CombatantId, target: CombatantId, stride: Tiles, grid: Grid, better: (d: number, best: number) => boolean): MoveReach | null {
  const user = spots.find(s => s.id === by), goal = spots.find(s => s.id === target);
  if (!user || !goal || !onMap(user) || !onMap(goal)) return null;
  const others = spots.filter(s => s.id !== by && onMap(s)).map(s => s.place);
  const options = reachable(user.place, stride, grid, others);
  let best = options[0]!;
  for (const o of options) if (better(dist(o.place, goal.place), dist(best.place, goal.place))) best = o;
  return best.steps === 0 ? null : best;
}

/**
 * Toward: the reachable tile nearest the target, on a tie the fewest steps, then the lowest `y`, then `x` (design 3.1 rule
 * 8a breaks ties so). A full stride or less: it stops beside the target. Null when no tile is nearer than where `by` stands.
 */
export const stepToward = (spots: readonly Spot[], by: CombatantId, target: CombatantId, stride: Tiles, grid: Grid): MoveReach | null =>
  stepBy(spots, by, target, stride, grid, (d, best) => d < best);

/** Away: the reachable tile farthest from the target, with the same ties. Null when no tile is farther than where `by` stands. */
export const stepAway = (spots: readonly Spot[], by: CombatantId, target: CombatantId, stride: Tiles, grid: Grid): MoveReach | null =>
  stepBy(spots, by, target, stride, grid, (d, best) => d > best);

// ── a mythic's strip and omen banner (notes-11-keystones.md B.5, unit MY7) ──

/** A tile as the doc carries it: plain numbers. */
type Spot2 = { readonly x: number; readonly y: number };
/**
 * A mythic row as a screen reads it, from the GM's fight (`mythicSeenOf`) or from the room doc (`mythicSeenOfDoc`), so both
 * phones say the same words. `omen` is the standing omen with its aim (null: the doc left it out, a row the party does not
 * perceive). The GM's phone also knows its exact HP and whether it is held at its gate; a table knows only the band the doc says.
 */
export type MythicSeen = {
  readonly id: CombatantId; readonly name: string;
  readonly place?: Spot2;
  readonly script: MythicScriptId; readonly phase: number; readonly beat: number; readonly since: Tick;
  readonly omen: { readonly key: OmenKey; readonly faltering: boolean; readonly aim: Spot2 | CombatantId | null } | null;
  readonly hp: { readonly hp: number; readonly hpMax: number } | null;
  readonly bandWord: string | null;
  readonly held: boolean | null;
};
/** The rows an omen's words name: their ids, names and sides. */
export type Named = { readonly id: CombatantId; readonly name: string };

/** The GM's row of a mythic as a screen reads it; null for a row that plays no script. */
export function mythicSeenOf(b: Body): MythicSeen | null {
  const s = b.mythic;
  if (!s) return null;
  const omen = s.at === 'calm' ? null : { key: s.omen, faltering: s.at === 'faltering', aim: typeof s.aim === 'string' ? s.aim : { x: s.aim.x, y: s.aim.y } };
  return { id: b.id, name: b.name, place: { x: b.place.x, y: b.place.y }, script: s.script, phase: s.phase, beat: s.beat, since: s.since, omen, hp: { hp: rowHp(b), hpMax: b.sheet.hpMax }, bandWord: null, held: heldAtGate(b) };
}
/** A mythic's standing in the room doc as a screen reads it; null when the row carries none. `words` says each band. */
export function mythicSeenOfDoc(r: { readonly id: CombatantId; readonly name: string; readonly place?: Spot2; readonly band: string; readonly standing?: DocStanding }, words: Readonly<Record<string, string>>): MythicSeen | null {
  const s = r.standing;
  if (!s) return null;
  const omen = s.state === 'calm' ? null : { key: s.omen, faltering: s.state === 'faltering', aim: s.aim };
  return { id: r.id, name: r.name, ...(r.place ? { place: r.place } : {}), script: s.script, phase: s.phase, beat: s.beat, since: s.since, omen, hp: null, bandWord: words[r.band] ?? r.band, held: null };
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
/** The state `standOf` gives: the readers of mythic.ts read only a standing's script, phase and clock, never its state. */
const CALM: MythicState = 'calm';
/** A standing of `m` as the readers of mythic.ts take it. It is read here and never put on a row (mythic.ts is the one writer). */
const standOf = (m: MythicSeen): MythicStanding => ({ at: CALM, script: m.script, phase: m.phase, beat: m.beat, since: m.since });
/** Whole rounds from `now` to the end of `m`'s phase's clock, at least 1 while it has not run out. */
const clockLeft = (m: MythicSeen, now: Tick, R: { readonly fight: Pick<Rules['fight'], 'round'> }): number => {
  const p = mythicScriptOf(m.script).phases[m.phase]!;
  return Math.max(0, Math.ceil((m.since + p.clock * R.fight.round - now) / R.fight.round));
};
/** How often the script's enraged rotation lands its doom: "every other turn", "every N turns", or "N times in M turns". */
function doomRate(script: MythicScript): string {
  const r = script.enraged, k = r.filter(b => b.kind === 'omen').length, turns = r.length + k;
  return k * 2 === turns ? 'every other turn' : k === 1 ? `every ${turns} turns` : `${k} times in ${turns} turns`;
}
/** The names of the doom omens of the enraged rotation, in order, once each. */
const doomNames = (script: MythicScript): string => [...new Set(script.enraged.flatMap(b => b.kind === 'omen' ? [script.omens[b.omen]!.name] : []))].join(' and ');

/**
 * The mythic strip's four lines (B.5): the name, the phase, its HP and where its gate is, and its clock. `share` and `gate`
 * (0 to 1) draw the HP bar and its notch, null where the phone does not know the HP. `note` is the phase's own line, shown
 * until the mythic's next turn. `now` is the fight's time.
 */
export type MythicStrip = {
  readonly name: string; readonly phase: string; readonly hp: string; readonly clock: string;
  readonly share: number | null; readonly gate: number | null; readonly note: string | null;
  /** The GM's line on an act beat: the next omen and when ("Next omen: Stars Fall, in 2 turns."); null with an omen standing or none in the rotation. */
  readonly ahead: string | null;
  readonly mark: 'gate' | 'held' | 'enraged' | 'clock' | 'last';
};
export function mythicStrip(m: MythicSeen, now: Tick, R: { readonly fight: Pick<Rules['fight'], 'round'> }): MythicStrip {
  const script = mythicScriptOf(m.script), p = script.phases[m.phase]!, last = m.phase >= script.phases.length - 1;
  const stand = standOf(m), gate = bandOf(script, m.phase).gate, out = clockOut(stand, now, R), left = clockLeft(m, now, R);
  const next = last ? null : script.phases[m.phase + 1]!;
  const acted = m.omen !== null || m.beat > 0;
  const hpWord = m.hp ? `HP ${Math.round(m.hp.hp / m.hp.hpMax * 100)}%` : m.bandWord ?? 'HP unknown';
  let mark: MythicStrip['mark'], hp: string, clock: string;
  if (p.ends === 'clock') {
    mark = 'clock'; hp = `${hpWord} · immune to damage`;
    clock = out && next ? `Phase ${m.phase + 2} (${next.name}) starts on its next turn.` : `Survive ${plural(Math.max(1, left), 'more round')}.`;
  } else if (m.held === true) {
    mark = 'held'; hp = `${hpWord} · HP locked until next phase`;
    clock = acted && next ? `Phase ${m.phase + 2} (${next.name}) starts on its next turn.` : `Clock: ${plural(left, 'round')} left`;
  } else if (out) {
    mark = 'enraged'; hp = last ? `${hpWord} · last phase` : `${hpWord} · next phase at ${Math.round(gate * 100)}% HP`;
    clock = `Enraged: ${doomNames(script)} ${doomRate(script)}.`;
  } else {
    mark = last ? 'last' : 'gate'; hp = last ? `${hpWord} · last phase` : `${hpWord} · next phase at ${Math.round(gate * 100)}% HP`;
    clock = `Clock: ${plural(left, 'round')} left`;
  }
  return {
    name: script.name, phase: `Phase ${m.phase + 1} of ${script.phases.length}: ${p.name}`, hp, clock, mark,
    share: m.hp ? m.hp.hp / m.hp.hpMax : null, gate: p.ends === 'gate' && !last ? gate : null,
    note: m.omen === null && m.beat === 0 ? p.line : null, ahead: m.omen === null ? omenAhead(m, now, R) : null,
  };
}
/** The next omen beat of the rotation it plays, from the beat its next turn takes: "Next omen: Stars Fall, on its next turn." */
function omenAhead(m: MythicSeen, now: Tick, R: { readonly fight: Pick<Rules['fight'], 'round'> }): string | null {
  const script = mythicScriptOf(m.script), rotation = enraged(standOf(m), now, R) ? script.enraged : script.phases[m.phase]!.rotation;
  for (let d = 0; d < rotation.length; d++) {
    const beat = rotation[(m.beat + d) % rotation.length]!;
    if (beat.kind === 'omen') return `Next omen: ${script.omens[beat.omen]!.name}, ${d === 0 ? 'on its next turn' : `in ${plural(d + 1, 'turn')}`}.`;
  }
  return null;
}

/**
 * The GM's hand on a mythic, in words (B.5): the landing turn's title and the two buttons it offers while an omen stands,
 * and Next phase with the question it asks. `next` is null in the last phase; `hp` is the share its HP drops to when the
 * next phase is a gate phase, null for a clock phase (whose HP stays).
 */
export type MythicHand = {
  readonly landTitle: string | null; readonly land: string | null; readonly drop: string | null;
  readonly next: { readonly label: string; readonly ask: string; readonly yes: string; readonly no: string } | null;
};
export function mythicHand(m: MythicSeen): MythicHand {
  const script = mythicScriptOf(m.script), omen = m.omen && script.omens[m.omen.key], next = script.phases[m.phase + 1];
  const to = next && next.ends === 'gate' ? ` Its HP drops to ${Math.round(next.from * 100)}%.` : '';
  return {
    landTitle: omen ? `${script.name}'s turn. The omen lands.` : null, land: omen ? `Land ${omen.name}` : null, drop: omen ? 'Drop the omen' : null,
    next: next ? { label: 'Next phase', ask: `Move ${script.name} to ${next.name} now?${to}`, yes: 'Start next phase', no: 'Cancel' } : null,
  };
}

/** The ops of a status that answer an omen, in the words of the answer line. */
const INTERRUPT_WORDS: Readonly<Record<Interrupt, string>> = { hold: 'Stun', root: 'Root', taunt: 'Taunt' };
const OUTCOME_WORDS: Readonly<Record<Exclude<AnswerOutcome, 'none'>, string>> = { cancel: 'cancels it', weaken: 'weakens it' };
const listed = (xs: readonly string[]): string => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;

/**
 * The omen standing as the banner says it (B.5): `title` ("OMEN: Stars Fall", "OMEN, WEAKENED: ..." or "DOOM: ..."),
 * `when` (what lands, where, and when), and each way to answer it, one plain line each, written from the omen's data and the
 * rules so a changed script or number changes the words. `answers` holds only answers that do something to the omen as it
 * stands (a weakened omen cannot be weakened again).
 */
export type OmenBanner = {
  readonly title: string; readonly when: string; readonly answerHead: string; readonly answers: readonly string[];
  readonly doom: boolean; readonly weakened: boolean;
};
export function omenBanner(m: MythicSeen, rows: readonly Named[], now: Tick, R: Pick<Rules, 'fight'>): OmenBanner | null {
  if (!m.omen) return null;
  const script = mythicScriptOf(m.script), omen = script.omens[m.omen.key];
  if (!omen) return null;
  const move = script.moves[m.omen.faltering && omen.weak !== null ? omen.weak : omen.full]!;
  const inPhase = script.phases[m.phase]!.rotation.some(b => b.kind === 'omen' && b.omen === m.omen!.key);
  const inDoom = script.enraged.some(b => b.kind === 'omen' && b.omen === m.omen!.key);
  const doom = inDoom && (!inPhase || enraged(standOf(m), now, R));
  const aim = m.omen.aim, whom = aimWords(aim, m.id, rows, omen.aim);
  const weakened = m.omen.faltering;
  const lands = weakened ? `Lands as ${move.name} on its next turn, ${whom}.` : `Lands on its next turn, ${whom}.`;
  const lines: string[] = [];
  const reach = R.fight.mythic.answerReach;
  const say = (outcome: AnswerOutcome, text: string): void => {
    if (outcome === 'none' || (outcome === 'weaken' && (omen.weak === null || weakened))) return;
    lines.push(`${text}: ${OUTCOME_WORDS[outcome]}`);
  };
  const by = omen.interrupt.by;
  if (by.length) say(omen.interrupt.outcome, `${listed(by.map(o => INTERRUPT_WORDS[o]))} it`);
  say(omen.shield, aimedAtHunter(aim, m.id) ? 'Put a shield on the hunter it is aimed at' : 'Put a shield on a hunter standing on its center tile');
  say(omen.step, 'Leave its center tile empty, so no hunter stands on it');
  say(omen.stagger, `Fill its stagger bar with heavy hits (${plural(reach.stagger, 'standard hit')} worth)`);
  say(omen.burst, `Take ${Math.round(reach.burst * 100)}% of its HP before it lands`);
  lines.push(move.sure ? 'Cannot be dodged or resisted.' : move.kind === 'blast' ? 'Step out of the marked tiles to dodge it.' : 'Dodge it or resist it, like any attack.');
  return { title: `${doom ? 'DOOM' : weakened ? 'OMEN, WEAKENED' : 'OMEN'}: ${omen.name}`, when: lands, answerHead: 'How to counter it:', answers: lines, doom, weakened };
}
/** Whether an omen's aim names a hunter (a row), rather than a tile or the mythic itself. */
const aimedAtHunter = (aim: Spot2 | CombatantId | null, self: CombatantId): boolean => typeof aim === 'string' && aim !== self;
/** Where an omen lands in words: on a hunter by name, on the marked tiles, around the mythic, on everyone. */
function aimWords(aim: Spot2 | CombatantId | null, self: CombatantId, rows: readonly Named[], kind: OmenAim): string {
  if (aim === null) return 'on someone you cannot see';
  if (typeof aim !== 'string') return 'on the marked tiles';
  if (aim === self) return kind === 'all' ? 'on everyone' : 'on the tiles around it';
  return `on ${rows.find(r => r.id === aim)?.name ?? 'a hunter'}`;
}

/**
 * What a player's own card adds while an omen stands (B.5): "You are in the marked tiles." for an area on tiles that
 * reach the hunter, "<Omen> is aimed at you." for an omen on this hunter, "<Omen> lands on everyone." for one on all,
 * else null. `me` is the hunter's row id and `at` its tile.
 */
export function omenOnYou(m: MythicSeen, me: CombatantId, at: Spot2, R: Pick<Rules, 'fight'>): string | null {
  if (!m.omen) return null;
  const script = mythicScriptOf(m.script), omen = script.omens[m.omen.key];
  if (!omen) return null;
  const move = script.moves[m.omen.faltering && omen.weak !== null ? omen.weak : omen.full]!, aim = m.omen.aim;
  if (aim === me) return `${omen.name} is aimed at you.`;
  if (aim === m.id && omen.aim === 'all') return `${omen.name} lands on everyone.`;
  if (aim === null || move.kind !== 'blast') return null;
  const center = aim === m.id ? (omen.aim === 'self' ? m.place ?? null : null) : typeof aim === 'string' ? null : aim;
  if (!center) return null;
  return move.reach === 'field' || dist(place(center.x, center.y), place(at.x, at.y)) <= move.reach ? 'You are in the marked tiles.' : null;
}

/**
 * The omen's own words for what an ability does to it (B.5, a hotbar tag): "cancels it" or "weakens it" when the ability
 * lands a status holding an op the omen's interrupt names, or shields (the aimed hunter's shield answers it), else null.
 */
export function answersBy(a: Pick<Ability, 'ops' | 'effect'>, m: MythicSeen): string | null {
  if (!m.omen) return null;
  const script = mythicScriptOf(m.script), omen = script.omens[m.omen.key];
  if (!omen) return null;
  const outcomes: Exclude<AnswerOutcome, 'none'>[] = [];
  const add = (o: AnswerOutcome): void => { if (o === 'cancel' || (o === 'weaken' && omen.weak !== null && !m.omen!.faltering)) outcomes.push(o); };
  if (a.ops.some(o => o.op === 'applyStatus' && o.def.ops.some(x => (omen.interrupt.by as readonly string[]).includes(x.op)))) add(omen.interrupt.outcome);
  if (a.effect?.type === 'shield' || a.ops.some(o => o.op === 'shield')) add(omen.shield);
  return outcomes.includes('cancel') ? OUTCOME_WORDS.cancel : outcomes.includes('weaken') ? OUTCOME_WORDS.weaken : null;
}

/** The omen standing and the move it lands (its weak one while it falters): what the map draws and the banner says. */
export function omenMoveOf(m: MythicSeen): { readonly omen: Omen; readonly move: MythicMove } | null {
  if (!m.omen) return null;
  const script = mythicScriptOf(m.script), omen = script.omens[m.omen.key];
  return omen ? { omen, move: script.moves[m.omen.faltering && omen.weak !== null ? omen.weak : omen.full]! } : null;
}
