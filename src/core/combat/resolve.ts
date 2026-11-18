// resolve.ts: what one use of an ability does, worked out whole (docs/agent-handoff/rw/design.md section 3.1, rules 2 to
// 19, in that order). Pure: the edge asks `needs` which dice to roll, rolls them and passes them in; nothing is rolled or
// validated here. A use the rules refuse comes back as a refusal and changes nothing. Each rule is one function below,
// named for what it decides. A new rule is a function here, called in its place in `resolve`, with a test in
// tests/resolve.test.ts that fails when the rule is removed.

import { tallyOf } from './row-tally.ts';
import { diceOf, evaluate, rollOf, withEdge } from '../formula.ts';
import type { Dice, Env, Formula, KitScope, Scope } from '../formula.ts';
import { formulaOf } from '../registry/ability-kinds.ts';
import type { KindRules } from '../registry/ability-kinds.ts';
import type { Rules } from '../rules.ts';
import { dist, dodge, inShape, sees, shovePath, terrain, TERRAIN, tiles, tilesOf } from './space.ts';
import type { Grid, Place, Side } from './space.ts';
import { acted, delayed, extraNow, extraStep, interval, refunded, stunned, tick } from './timeline.ts';
import type { Tick } from './timeline.ts';
import type { Ability, Avoid, CombatantId, AbilityGate, Outcome, Price } from './ability-types.ts';
import { atTier, controlFactor, countOn, cureStatus, dispelled, removeStatus, shielded, stackOf, stacked, withStatuses } from './effect-ops.ts';
import { boostsOn, concealed, critFacesAgainst, damageShare, edgeOn, edgeStep, healShare, rangeWith, wardedDamage } from './standing.ts';
import type { Body, OpRules, Status, StatusKey, UseOp } from './effect-ops.ts';
import { afterDefence, alive, broken, channelBreaks, clamp, crossed, cureLands, hasteOn, healed, hurt, landEnd, landThreshold, live, moved, opsOf, landStatus, threatened, throughShield } from './land.ts';
import { insideZone } from './triggers.ts';
import type { Burst, LandFired } from './land.ts';
import { stackStep } from './stacks.ts';
import { usesOf } from './uses.ts';
import { freeZoneId, MAX_ZONES } from './zones.ts';
import type { Ground, Zone } from './zones.ts';

/** Where a use is aimed: a tile, or a combatant. */
export type Aim = Place | CombatantId;
/**
 * The numbers the edge rolled: each target's formula dice in reading order (one total per dice term), each target's
 * reaction d20, and the user's d20 for an extra-turn refund that has a chance.
 */
export type Rolls = {
  readonly dice: Readonly<Record<CombatantId, readonly number[]>>;
  readonly react: Readonly<Record<CombatantId, number>>;
  readonly refund?: number;
  /** The second d20 of a target whose die has an edge (rule 7b, kits design 8.2); absent when no die has one. */
  readonly second?: Readonly<Record<CombatantId, number>>;
  /** Each held die's roll, by its bearer (rule 7b); absent when none is a die. */
  readonly boost?: Readonly<Record<CombatantId, number>>;
};
/**
 * What the edge must roll before it sends a use: each target's dice and reaction d20, the user's refund d20, a second
 * d20 for each target whose die has an edge (`second`), and each held die by its bearer (`boost`); the last two absent
 * when there are none.
 */
export type Needs = {
  readonly dice: Readonly<Record<CombatantId, readonly Dice[]>>; readonly react: readonly CombatantId[]; readonly refund: boolean;
  readonly second?: readonly CombatantId[]; readonly boost?: readonly { readonly id: CombatantId; readonly sides: number }[];
};
/**
 * The dice of a player's cast (the room's `cast`: one roll of the use's dice on the player's phone) by target: they land
 * on the body the cast aimed at, or on the first body the use takes when it aimed at a tile; every other target rolls its
 * own (`rolled`, the GM's phone's roll of `n`), as each target of the GM's own use does.
 */
export function castDice(n: Needs, aim: Aim, own: readonly number[], rolled: Rolls['dice']): Rolls['dice'] {
  const ids = Object.keys(n.dice) as CombatantId[], mine = typeof aim === 'string' && ids.includes(aim) ? aim : ids[0];
  return Object.fromEntries(ids.map(id => [id, id === mine ? own : rolled[id] ?? []]));
}
/**
 * Why a use was refused. `gated`: a `holds` gate of rule 3b does not hold; `noUses`: its uses a fight or a rest are
 * spent (table 2.3); `hp`: an HP price would take the user to 0 or
 * less; `stacks`: the user holds fewer stacks than a price asks (kits design 1.4).
 */
export type UseRefusal = 'taunted' | 'cooldown' | 'gated' | 'noUses' | 'mana' | 'hp' | 'stacks' | 'range' | 'noTarget' | 'needsRoll'
  /** A second extra action in one round of fight time (kits design 8.6.1, `extraPerRound`). */
  | 'extra'
  /** A blink of a rooted user, or one to a tile it does not see, may not stand on or is taken (kits design 8.3.5). */
  | 'rooted' | 'blocked';
/** A threshold that a use's status set off (rule 18a): on whom, which status, and what its ops did to each body they reached. */
export type { Burst } from './land.ts';
export { afterDefence } from './land.ts';
/** `shoved`: the bodies a push, a pull or a swap moved (kits design 8.3), whose entry into a zone pays nothing. */
export type Resolved =
  | { readonly ok: false; readonly reason: UseRefusal }
  | { readonly ok: true; readonly outcomes: readonly Outcome[]; readonly bodies: readonly Body[]; readonly bursts: readonly Burst[]; readonly shoved: readonly CombatantId[] };
export type ResolveRules = OpRules & Pick<Rules, 'dice'>;

const samePlace = (a: Place, b: Place): boolean => a.x === b.x && a.y === b.y;
export const placeOf = (aim: Aim, bodies: readonly Body[]): Place | null => typeof aim === 'string' ? bodies.find(b => b.id === aim)?.place ?? null : aim;
const againstFoes = (a: Ability): boolean => a.aim === 'foe' || a.aim === 'place';
const rollsReaction = (a: Ability): boolean => againstFoes(a) && a.delivery.kind !== 'sure';
/** The formula of an op that rolls dice for each target, at the user's tier. */
const rolled = (o: UseOp, tier: number): Formula | null => o.op === 'shield' ? o.amount : o.op === 'mana' || o.op === 'fatigue' ? atTier(o.amount, tier) : null;
const extraDice = (ops: readonly UseOp[], tier: number): Dice[] => ops.flatMap(o => { const f = rolled(o, tier); return f ? diceOf(f) : []; });
/**
 * The dice one target of `a` needs, in order: its effect's, then a shield, mana or fatigue op's, at the user's tier. A
 * player's phone rolls them for a `cast`.
 */
export const diceFor = (a: Ability, tier: number, R: KindRules): Dice[] => { const f = formulaOf(a, R); return [...(f ? diceOf(f) : []), ...extraDice(a.ops, tier)]; };

// Rule 2: a taunted user aims at its taunter, or at a place whose shape holds it, while the taunter is up and in range.
export function taunted(a: Ability, user: Body, bodies: readonly Body[], at: Place, grid: Grid, now: Tick): boolean {
  if (!againstFoes(a)) return false;
  for (const s of live(user, now)) {
    if (!s.def.ops.some(o => o.op === 'taunt') || s.source.id === null) continue;
    const src = bodies.find(b => b.id === s.source.id);
    if (!src || src.hp <= 0 || dist(user.place, src.place) > a.range) continue;
    const cover = tilesOf(a.shape, user.place, at, grid);
    if (![...cover.hit, ...cover.ring].some(p => samePlace(p, src.place))) return true;
  }
  return false;
}

// Rule 3.
export const onCooldown = (a: Ability, user: Body, now: Tick): boolean => now < (user.readyAt[a.id] ?? 0);

/** The stacks of `key` a body holds: its count for a stacking status, 1 for a plain one, 0 for none. */
const stacksOn = (b: Body, key: StatusKey, now: Tick): number => { const s = live(b, now).find(x => x.key === key); return s ? countOn(s) : 0; };
// Rule 3b (kits design 1.4): every `holds` gate holds: the user, or the body at the aim, has at least `atLeast` stacks of
// the status (1 for a plain one: a mode); and an ability limited to n uses a fight or a rest has one left on the user's
// row (uses.ts, table 2.3).
export function gated(a: Ability, user: Body, bodies: readonly Body[], at: Place, now: Tick): 'gated' | 'noUses' | null {
  const target = bodies.find(b => alive(b) && samePlace(b.place, at));
  const held = (g: Extract<AbilityGate, { kind: 'holds' }>): number => (g.on === 'self' ? stacksOn(user, g.key, now) : target ? stacksOn(target, g.key, now) : 0);
  if ((a.gates ?? []).some(g => g.kind === 'holds' && held(g) < g.atLeast)) return 'gated';
  if ((a.gates ?? []).some(g => g.kind === 'inside' && !insideZone(user, g.zone))) return 'gated';
  return usesOf(a, user)?.at === 'spent' ? 'noUses' : null;
}

/** An HP price's HP for a body of `hpMax`: a flat number, or its share of max HP rounded up. */
export const hpPrice = (p: Extract<Price, { kind: 'hp' }>, hpMax: number): number => (p.amount.kind === 'flat' ? p.amount.n : Math.ceil(p.amount.share * hpMax));
/**
 * Rule 4's kit prices (kits design 1.4), paid with the mana: an HP price, refused at the HP it would take (never the
 * killing blow), past the shield; a price in the user's own stacks, refused when it holds fewer than `n` (or none for
 * `all`), whose count is the formula's `spent`. A zone price is the zones unit's (design 5.3 unit 9).
 */
export function payPrices(a: Ability, user: Body, now: Tick, R: ResolveRules): { user: Body; spent: number } | UseRefusal {
  let u = user, spent = 0;
  for (const p of a.prices ?? []) {
    if (p.kind === 'hp') {
      const hp = hpPrice(p, u.sheet.hpMax);
      if (u.hp <= hp) return 'hp';
      u = { ...u, hp: u.hp - hp };
    } else if (p.kind === 'stacks' && p.from === 'self') {
      const held = stacksOn(u, p.key, now), take = p.take.kind === 'all' ? held : p.take.n;
      if (held < Math.max(1, take)) return 'stacks';
      u = withStatuses(u, taken(u, p.key, take, now), now, R);
      spent += take;
    }
  }
  return { user: u, spent };
}
/** A body's statuses with `m` stacks of `key` taken by a price (table 2.1): a plain status goes whole; spent is not ended. */
function taken(b: Body, key: StatusKey, m: number, now: Tick) {
  const s = live(b, now).find(x => x.key === key);
  if (!s || !stacked(s)) return removeStatus(b.statuses, key);
  const after = stackStep(stackOf(s), { type: 'price', m }, { rule: s.def.stack, at: null }).stack;
  return after.at === 'held' ? b.statuses.map(x => x.key === key ? { ...s, stacks: after.n } : x) : removeStatus(b.statuses, key);
}

// Rule 4: what a use costs its user, its fatigue and mana each cut by the user's `costCut`.
export const costOf = (a: Pick<Ability, 'cost'>, costCut: number): { readonly fatigue: number; readonly mana: number } =>
  ({ fatigue: Math.ceil(a.cost.fatigue * (1 - costCut)), mana: Math.ceil(a.cost.mana * (1 - costCut)) });
// Rule 4: paid before anything can miss. Mana must be on hand; fatigue rises to the capacity at most.
export function payCost(a: Ability, user: Body): Body | null {
  const { fatigue, mana } = costOf(a, user.sheet.costCut);
  if (mana > user.mana) return null;
  return { ...user, mana: user.mana - mana, fatigue: Math.min(user.sheet.fatigueMax, user.fatigue + fatigue) };
}

/**
 * Rules 3, 3b and 4 for a user, whatever it aims at: off its cooldown, its gates holding at `at` and a use left, its cost
 * and its kit prices paid. A use asks it after rule 2; an armed reaction asks it to fire (fight-react.ts), so a reaction
 * is refused and charged as a use is.
 */
export function charged(a: Ability, user: Body, bodies: readonly Body[], at: Place, now: Tick, R: ResolveRules): { user: Body; spent: number } | UseRefusal {
  if (onCooldown(a, user, now)) return 'cooldown';
  const gate = gated(a, user, bodies, at, now);
  if (gate) return gate;
  const cost = payCost(a, user);
  return cost === null ? 'mana' : payPrices(a, cost, now, R);
}

// Rule 5: within the ability's range, and the tiles a user's `sheet` ops add to a range of 2 or more (kits design 8.1).
export const inRange = (a: Pick<Ability, 'aim' | 'range'>, user: { readonly place: Place }, at: Place, range: number = a.range): boolean =>
  a.aim === 'self' || dist(user.place, at) <= range;
/** An ability's range for `user`: its own, and the tiles its `sheet` ops add to a range of 2 or more (standing.ts). */
export const rangeFor = (a: Pick<Ability, 'range'>, user: Pick<Body, 'statuses'>, R: ResolveRules): number => rangeWith(a.range, user, R);

// Rule 6: who stands in the shape at the moment of use, among `onMap` (the bodies that are alive). A self or ally ability takes its one target.
export function whoIsIn<T extends { readonly side: Side; readonly place: Place }>(a: Pick<Ability, 'aim' | 'shape' | 'foesOnly'>, user: T, onMap: readonly T[], at: Place, grid: Grid): { hit: T[]; ring: T[] } {
  if (a.aim === 'self') return { hit: [user], ring: [] };
  if (a.aim === 'ally') return { hit: onMap.filter(b => samePlace(b.place, at)), ring: [] };
  const candidates = onMap.filter(b => !(a.foesOnly && b.side === user.side));
  return inShape(a.shape, user.place, at, grid, candidates);
}

// Rule 7: in rounds, or null when nothing travels.
function landTime(a: Ability, user: Body, target: Body, R: ResolveRules): number | null {
  const d = a.delivery;
  if (d.kind !== 'travel') return null;
  return d.windup / R.fight.round + (d.speed === 'instant' ? 0 : dist(user.place, target.place) / d.speed);
}

// Rule 8: the target's side of the reaction roll against the user's Accuracy, capped either way.
const edge = (mine: number, theirs: number, R: ResolveRules): number =>
  clamp(Math.round(R.fight.reactK * (mine - theirs)), -R.fight.reactCap, R.fight.reactCap);
/**
 * Rule 8b: a target of `will` resists what nothing carries to it (a curse, or a sickness passing on: design 4.8) when its
 * d20 plus its edge against `aim` reaches `resistDc`, or the d20 is 20.
 */
export const resists = (d20: number, will: number, aim: number, R: ResolveRules): boolean => d20 === 20 || d20 + edge(will, aim, R) >= R.fight.resistDc;

// Rule 8a and 8b: where the target ends. A self, ally or sure use is caught.
function whereItEnds(a: Ability, user: Body, target: Body, bodies: readonly Body[], at: Place, grid: Grid, d20: number | undefined, R: ResolveRules): { avoid: Avoid; to: Place | null } {
  if (!rollsReaction(a) || d20 === undefined) return { avoid: 'caught', to: null };
  if (a.delivery.kind === 'direct') return { avoid: resists(d20, target.sheet.will, user.sheet.aim, R) ? 'resisted' : 'caught', to: null };
  const land = landTime(a, user, target, R) ?? 0;
  const share = clamp((d20 + edge(target.sheet.react, user.sheet.aim, R)) / 20, 0, 1);
  const can = tiles(Math.floor(target.sheet.move * land * share));
  const others = bodies.filter(b => b.id !== target.id && alive(b)).map(b => b.place);
  const end = dodge(target.place, can, tilesOf(a.shape, user.place, at, grid), grid, others);
  return { avoid: end.avoid, to: end.avoid !== 'caught' && !samePlace(end.to, target.place) ? end.to : null };
}

// Rule 9: the low faces of the target's die are the moments it froze; a target's exposed faces add to the user's (kits 8.1).
const crit = (a: Ability, user: Body, target: Body, avoid: Avoid, d20: number | undefined, R: ResolveRules): boolean =>
  rollsReaction(a) && avoid === 'caught' && d20 !== undefined && d20 <= critFacesAgainst(user, target, R);

// Rule 6b (kits design 1.5): what the kits' names read, a snapshot when the shape's bodies are known, so every target of
// an area reads the same field and a use's own chain does not change its numbers. Each within its rule's bound.
export type Snapshot = { readonly bodies: ReadonlyMap<CombatantId, { readonly stacks: Readonly<Record<StatusKey, number>>; readonly missing: number }>; readonly user: CombatantId; readonly field: Readonly<Record<StatusKey, number>>; readonly held: Readonly<Record<StatusKey, number>>; readonly hits: number; readonly kills: number; readonly spent: number };
export function snapshot(user: Body, bodies: readonly Body[], hits: number, spent: number, now: Tick, R: ResolveRules): Snapshot {
  const K = R.fight.kit, up = bodies.filter(b => b.hp > 0);
  const stacksOf = (b: Body) => Object.fromEntries(live(b, now).map(s => [s.key, Math.min(K.stackCap, countOn(s))])) as Record<StatusKey, number>;
  const field: Record<StatusKey, number> = {};
  for (const b of up) for (const s of live(b, now)) field[s.key] = Math.min(K.fieldStacks, (field[s.key] ?? 0) + countOn(s));
  const held = Object.fromEntries(live(user, now).map(s => [s.key, Math.min(K.held, Math.max(0, (now - s.since) / R.fight.round))])) as Record<StatusKey, number>;
  const all = new Map(bodies.map(b => [b.id, { stacks: stacksOf(b), missing: b.sheet.hpMax > 0 ? Math.max(0, Math.min(1, 1 - b.hp / b.sheet.hpMax)) : 0 }] as const));
  return { bodies: all, user: user.id, field, held, hits: Math.min(K.hits, hits), kills: Math.min(K.kills, tallyOf(user).kills.length), spent };
}
/** The snapshot as one target's formula reads it: its own stacks and lost share, and the stacks this use's prices took from it and from the user. */
function kitFor(s: Snapshot, target: CombatantId, spentHere: number): KitScope {
  const u = s.bodies.get(s.user), t = s.bodies.get(target);
  return {
    stacks: { user: u?.stacks ?? {}, target: t?.stacks ?? {} }, field: s.field, missing: { user: u?.missing ?? 0, target: t?.missing ?? 0 },
    held: s.held, hits: s.hits, kills: s.kills, spent: s.spent + spentHere,
  };
}

// Rule 10a (kits design 1.4): a price in each target's stacks takes up to `n` (or all) from a target the use reached; what
// it gave is that target's `spent`.
function targetPrices(a: Ability, target: Body, now: Tick, R: ResolveRules): { target: Body; spent: number } {
  let t = target, spent = 0;
  for (const p of a.prices ?? []) if (p.kind === 'stacks' && p.from === 'target') {
    const held = stacksOn(t, p.key, now), take = Math.min(held, p.take.kind === 'all' ? held : p.take.n);
    if (take > 0) { t = withStatuses(t, taken(t, p.key, take, now), now, R); spent += take; }
  }
  return { target: t, spent };
}

// Rule 10.
function formulaValue(a: Ability, user: Body, target: Body, dice: readonly number[], kit: KitScope, R: ResolveRules): number {
  const f = formulaOf(a, R);
  if (!f) return 0;
  const charge = user.channel && user.channel.ability === a.id ? user.channel.charge : 0;
  const env: Env = { user: { stats: user.stats, sheet: user.sheet }, target: { stats: target.stats, sheet: target.sheet }, charge, dice, kit };
  return evaluate(f, env);
}

// Rule 11: crit size, the ring's share, a resisted use's share. No rounding yet.
function multiplied(raw: number, a: Ability, user: Body, avoid: Avoid, isCrit: boolean, R: ResolveRules): number {
  const ring = avoid === 'ring' && a.shape.kind === 'radius' && a.shape.ring ? a.shape.ring.share / 100 : 1;
  return raw * (isCrit ? user.sheet.critSize : 1) * ring * (avoid === 'resisted' ? R.fight.resistedShare : 1);
}

// Rule 11b: a target standing in cover takes `coverShare` less from a damaging use that travels to it across the ground
// (a line or an area), and nothing less from a touch, which reaches round the cover (design 4.7).
export const inCover = (a: Pick<Ability, 'delivery' | 'shape' | 'effect'>, at: Place, grid: Grid): boolean =>
  a.delivery.kind === 'travel' && (a.shape.kind === 'line' || a.shape.kind === 'radius') && (a.effect?.type === 'physical' || a.effect?.type === 'magical')
  && TERRAIN[terrain(grid, at.x, at.y)].cover;
const covered = (raw: number, a: Ability, target: Body, grid: Grid, R: ResolveRules): number =>
  inCover(a, target.place, grid) ? raw * (1 - R.fight.coverShare) : raw;

// Rule 11c (kits design 8.1): a damaging use is multiplied by the user's dealt share and the target's taken share, a heal
// by the target's healed share, each product within `kit.shareCap` of 1 (standing.ts).
function shared(raw: number, a: Ability, user: Body, target: Body, R: ResolveRules): number {
  const type = a.effect?.type;
  return type === 'heal' ? raw * healShare(target, R) : type === 'physical' || type === 'magical' ? raw * damageShare(user, target, R) : raw;
}

// Rule 12: penetration percent, then flat; then the flat part of what is left comes off the hit, then the percentage; at least 1.
function defended(raw: number, a: Ability, user: Body, target: Body, R: ResolveRules): number {
  if (!a.effect) return 0;
  if (a.effect.type === 'heal' || a.effect.type === 'shield') return Math.max(0, Math.round(raw));
  return afterDefence(raw, a.effect.type, user.sheet, target.sheet, R);
}

// Rule 16: a weak hit fills the bar 1.5 times; a full bar costs the target 1.5 rounds, empties and grows 50%.
function staggered(target: Body, damage: number, now: Tick, R: ResolveRules): { target: Body; fill: number; staggered: boolean } {
  const bar = target.stagger;
  if (!bar || damage <= 0) return { target, fill: 0, staggered: false };
  const rate = 1 + opsOf(target, now).reduce((sum, { op, tier, n }) => op.op === 'staggerRate' ? sum + atTier(op.pct, tier) * n : sum, 0) / 100;
  const fill = damage * (damage < R.fight.staggerWeakBelow * bar.hit ? R.fight.staggerWeak : 1) * Math.max(0, rate);
  if (bar.fill + fill < bar.max) return { target: { ...target, stagger: { ...bar, fill: bar.fill + fill } }, fill, staggered: false };
  const floor = stunned(target, now, tick(R.fight.staggerCost * R.fight.round));
  return { target: { ...floor, stagger: { ...bar, fill: 0, max: bar.max * (1 + R.fight.staggerRegrow), until: floor.at } }, fill, staggered: true };
}

// Rule 17: a channel breaks on a single hit of at least `hold * hpMax`, or on an op that breaks it, unless protected.

// Rule 18: the ability's ops on a target it caught. A control status lasts less on a tenacious or a boss target. A
// stacking status adds the op's stacks (kits design 1.1); rule 18a checks its threshold after each application.
function landOps(a: Ability, user: Body, target: Body, dice: readonly number[], now: Tick, R: ResolveRules): { target: Body; keys: StatusKey[]; breaks: boolean; threat: number; fired: LandFired[]; detonated: Status[] } {
  const f = formulaOf(a, R);
  let t = target, breaks = false, threat = 0, die = f ? diceOf(f).length : 0;
  const keys: StatusKey[] = [], fired: LandFired[] = [], detonated: Status[] = [];
  for (const op of a.ops) {
    switch (op.op) {
      case 'applyStatus': {
        // the one rule for a status put on a body (land.ts `landStatus`), a trigger's and a threshold's too
        const p = landStatus(t, op, user, { id: user.id, tier: user.tier }, user.side, true, now, R);
        if (!p.put) break;
        t = p.target; threat += p.threat; breaks ||= p.breaks;
        if (p.fired) fired.push(p.fired);
        keys.push(op.key);
        break;
      }
      case 'cureStatus': {
        const was = t.statuses.find(s => s.key === op.key), list = cureStatus(t.statuses, op.key, op.stacks);
        if (was && !list.some(s => s.key === op.key) && cureLands(was)) detonated.push(was);
        t = withStatuses(t, list, now, R);
        break;
      }
      case 'delay': t = delayed(t, atTier(op.ticks, user.tier)); break;
      case 'threat': { const n = atTier(op.amount, user.tier); t = threatened(t, user.id, n); threat += t.threat ? n : 0; break; }
      case 'shield': case 'mana': case 'fatigue': {
        const f = rolled(op, user.tier)!, n = diceOf(f).length, roll = dice.slice(die, die + n);
        die += n;
        const v = Math.round(evaluate(f, { user: { stats: user.stats, sheet: user.sheet }, target: { stats: t.stats, sheet: t.sheet }, charge: 0, dice: roll }));
        if (op.op === 'shield') t = { ...t, shield: shielded(t.shield, { amount: Math.max(0, v), until: tick(now + R.fight.shieldLife * R.fight.round) }, now) };
        else if (op.op === 'mana') t = { ...t, mana: clamp(t.mana + v, 0, t.sheet.manaMax) };
        else t = { ...t, fatigue: clamp(t.fatigue + v, 0, t.sheet.fatigueMax) };
        break;
      }
      case 'channel': if (op.mode === 'break') breaks = true; break;
      case 'note': break;
      case 'dispel': {
        const list = dispelled(t.statuses, op.which);
        for (const s of t.statuses) if (!list.includes(s) && cureLands(s)) detonated.push(s);
        t = withStatuses(t, list, now, R);
        break;
      }
      // a shove lands after every outcome, in its order (rule 18c, `pushed`)
      case 'shove': break;
      // a move changes the user too: it lands after the target's ops (`movedOn`)
      case 'move': break;
      case 'hasten': t = hasteOn(user, t, op.share, now, R); break;
      // an extra action is the user's (`userTime`); a guard and a negate are a reaction's (fight-react.ts)
      case 'extra': case 'guard': case 'negate': break;
      default: op satisfies never;
    }
  }
  return { target: t, keys, breaks, threat, fired, detonated };
}

// Rule 18b: an ability that leaves a field puts its zone where it landed (around its centre for a radius, else on its
// shape's tiles) or, as an aura, around its user (design 4.8; its radius at most the rules' `fieldRadiusMax`), owned by
// its user at its tier, from now for its duration. It spares the user's side when the ability spares it, and the other
// side when the ability is aimed at an ally or its user. With `MAX_ZONES` on the ground it leaves none. Who stands in it
// is the zone's rule (zones.ts), not the use's. A field with a centre or a body may grow (its `grow`), from now, to its
// cap and at most `fieldRadiusMax`.
export function leftZone(a: Ability, user: Body, at: Place, grid: Grid, now: Tick, zones: readonly Zone[], R: ResolveRules): Zone | null {
  const spec = a.zone;
  if (!spec || zones.length >= MAX_ZONES) return null;
  const most = R.fight.fieldRadiusMax;
  const grow = spec.grow && { step: spec.grow.step, cap: tiles(Math.min(spec.grow.cap, most)), from: now };
  let ground: Ground;
  if (spec.around !== null) ground = { kind: 'around', anchor: { kind: 'body', id: user.id, status: null }, radius: tiles(Math.min(spec.around, most)), grow };
  else if (a.shape.kind === 'radius') ground = { kind: 'around', anchor: { kind: 'place', at }, radius: a.shape.ring?.outer ?? a.shape.radius, grow };
  else {
    const cover = tilesOf(a.shape, user.place, at, grid), list = [...cover.hit, ...cover.ring];
    if (!list.length) return null;
    ground = { kind: 'tiles', tiles: list };
  }
  const other: Side = user.side === 'party' ? 'foe' : 'party';
  return {
    id: freeZoneId('z', now, zones), name: spec.name, ground, owner: user.id, tier: user.tier,
    spares: a.foesOnly ? user.side : a.aim === 'ally' || a.aim === 'self' ? other : null,
    until: spec.duration === null ? null : tick(now + spec.duration), endsWithOwner: spec.endsWithOwner, ops: spec.ops,
    ...(spec.upkeep ? { upkeep: spec.upkeep } : {}), ...(spec.end?.length ? { end: spec.end } : {}), ...(spec.triggers?.length ? { triggers: spec.triggers } : {}),
    ...(spec.upkeep || spec.end?.length ? { laid: now } : {}),
  };
}

// Rule 19: the user's next turn, then any delay on it, then any extra-turn refund; the ability's cooldown.
function userTime(a: Ability, user: Body, now: Tick, refundRoll: number | undefined, R: ResolveRules): Body {
  let u = acted(user, now, a.cost.time, R.fight);
  const ops = opsOf(user, now);
  const delay = ops.reduce((n, { op, tier }) => op.op === 'delay' ? n + atTier(op.ticks, tier) : n, 0);
  if (delay) u = delayed(u, tick(delay));
  const pct = ops.reduce((best, { op, tier }) => op.op === 'refund' && refundLands(op.chance, refundRoll) ? Math.max(best, atTier(op.pct, tier)) : best, 0);
  if (pct) u = refunded(u, now, interval(user.speed, a.cost.time, R.fight), pct);
  // an extra action (kits design 8.6.1): the next turn is now, one a round of fight time
  if (a.ops.some(o => o.op === 'extra')) {
    const round = Math.floor(now / R.fight.round), n = u.extras?.round === round ? u.extras.n + 1 : 1;
    u = { ...extraNow(u, now), extras: { round, n } };
  }
  return { ...u, readyAt: { ...u.readyAt, [a.id]: tick(now + a.cost.cooldown) } };
}
/** Whether a use with an extra action comes in a round of fight time in which its user took `extraPerRound` already. */
const extraTaken = (a: Ability, user: Body, now: Tick, R: ResolveRules): boolean => {
  if (!a.ops.some(o => o.op === 'extra')) return false;
  const round = Math.floor(now / R.fight.round), n = user.extras?.round === round ? user.extras.n : 0;
  return !extraStep(n > 0 ? 'taken' : 'plain', { type: 'extra', left: R.fight.kit.extraPerRound - n }).ok;
};
// A refund with a chance lands when the user's d20 is within that percent of the die (each face is a twentieth of 100%):
// 20% on 1 to 4.
const refundLands = (chance: number, d20: number | undefined): boolean => chance >= 100 || (d20 !== undefined && d20 * 100 / 20 <= chance);
const refundRolls = (user: Body, now: Tick): boolean => opsOf(user, now).some(({ op }) => op.op === 'refund' && op.chance < 100);

/** The dice and reaction rolls the edge must roll for this use: for each body in the shape, its dice and its d20. */
export function needs(a: Ability, user: Body, bodies: readonly Body[], aim: Aim, grid: Grid, now: Tick, R: KindRules): Needs {
  const at = placeOf(aim, bodies);
  const inside = at === null ? [] : (({ hit, ring }) => [...hit, ...ring])(whoIsIn(a, user, catchable(bodies, user), at, grid));
  const dice = diceFor(a, user.tier, R), reacting = rollsReaction(a) ? inside : [];
  const second = reacting.filter(t => edgeOn(a, user, t).cut !== null).map(t => t.id);
  const boost: { id: CombatantId; sides: number }[] = [];
  for (const t of reacting) for (const b of boostsOn(user, t)) if (b.die.kind === 'die' && !boost.some(x => x.id === b.id)) boost.push({ id: b.id, sides: b.die.sides });
  return {
    dice: Object.fromEntries(inside.map(b => [b.id, dice])),
    react: reacting.map(b => b.id),
    refund: refundRolls(user, now),
    ...(second.length ? { second } : {}), ...(boost.length ? { boost } : {}),
  };
}

// Rule 7b (kits design 8.2): the kept face. A die with an edge is two d20s kept higher or lower, read through the dice
// notation's one keep rule (formula.ts `withEdge` and `rollOf`: `2d20kh1`, `2d20kl1`); then each held die moves it, the
// attacker's down and the defender's up, kept within a d20's faces.
function keptFace(a: Ability, user: Body, target: Body, rolls: Rolls): number | undefined {
  const d20 = rolls.react[target.id];
  if (d20 === undefined) return undefined;
  const { cut } = edgeOn(a, user, target), second = rolls.second?.[target.id];
  const term = cut && second !== undefined ? withEdge(ONE_D20, cut) : ONE_D20;
  const read = rollOf(term as Dice, term === ONE_D20 ? [d20] : [d20, second!]);
  let face = 'total' in read ? read.total : d20;
  for (const b of boostsOn(user, target)) {
    const n = b.die.kind === 'face' ? b.die.n : rolls.boost?.[b.id] ?? 0;
    face += b.side === 'attack' ? -n : n;
  }
  return Math.max(1, Math.min(D20_FACES, face));
}
const D20_FACES = 20;
const ONE_D20: Formula = { kind: 'dice', count: 1, sides: D20_FACES };
/**
 * What a use's edges and held dice spend once it resolved (table 8.9.2): an edge with `spend` that reached a die loses a
 * stack (or ends, a plain one), once a use however many targets; a held die always spends.
 */
function spendEdges(a: Ability, user: Body, targets: readonly Body[], rows: Map<CombatantId, Body>, now: Tick, R: ResolveRules): void {
  const gone: { id: CombatantId; key: StatusKey }[] = [];
  for (const t of targets) {
    for (const s of edgeOn(a, user, t).spent) if (!gone.some(x => x.id === s.id && x.key === s.key)) gone.push(s);
    for (const b of boostsOn(user, t)) if (!gone.some(x => x.id === b.id && x.key === b.key)) gone.push({ id: b.id, key: b.key });
  }
  for (const g of gone) {
    const b = rows.get(g.id), s = b?.statuses.find(x => x.key === g.key);
    if (!b || !s) continue;
    const after = edgeStep({ at: 'held', n: countOn(s) }, { type: 'reached', spend: true });
    const list = after.at === 'absent' ? removeStatus(b.statuses, g.key) : b.statuses.map(x => x === s && stacked(x) ? { ...x, stacks: after.n } : x);
    rows.set(b.id, withStatuses(b, list, now, R));
  }
}

/** The bodies a use of `user` may catch: those on the map, but a foe that is untargetable or hidden (kits design 8.1, 8.7). */
const catchable = (bodies: readonly Body[], user: Body): Body[] => bodies.filter(b => alive(b) && !concealed(b, user.side));

const outcome = (target: CombatantId, avoid: Avoid, to: Place | null, type: Outcome['type']): Outcome =>
  ({ target, avoid, to, crit: false, raw: 0, dealt: 0, absorbed: 0, type, statuses: [], threat: 0, stagger: 0, staggered: false, channelBroken: false, down: false });

/**
 * One use of `a` by `user` aimed at `aim` at time `now`, by design 3.1 rules 2 to 19. `bodies` is every combatant of the
 * fight, the user among them; the result holds them all, changed where the use changed them. Rule 1 (whose turn it is)
 * and rule 20 (the log) are the reducer's.
 */
/**
 * What the reactions a use set off ask of it (kits design 8.4, fight-react.ts): the share a guard takes off its damage to
 * each body (a strike only), the bodies it does nothing more to (a negate), and the lethal reaction of rule 13b, which
 * the fight fires on `rows` when a hit would take a body to 0 and answers whether one fired.
 */
export type Answers = {
  readonly guard?: Readonly<Record<CombatantId, number>>; readonly negate?: ReadonlySet<CombatantId>;
  readonly lethal?: (id: CombatantId, rows: Map<CombatantId, Body>) => boolean;
};
/** A use that may land (`ready`): the tile it aims at, its user with the cost and kit prices paid, and the stacks a price took (the formula's `spent`). */
export type Ready = { readonly at: Place; readonly paid: Body; readonly spent: number };
/**
 * Rules 2 to 5 of a use, before anything lands: an aim that is there and not concealed, no taunt, no extra action taken
 * this round, `charged` (rules 3 to 4) and the range. A channel's begin asks the same (fight.ts), so a channel pays what
 * a use pays.
 */
export function ready(a: Ability, user: Body, bodies: readonly Body[], aim: Aim, grid: Grid, now: Tick, R: ResolveRules): Ready | UseRefusal {
  const at = placeOf(aim, bodies);
  if (at === null) return 'noTarget';
  // a foe that is untargetable or hidden cannot be aimed at (kits design 8.1, 8.7)
  if (typeof aim === 'string' && bodies.some(b => b.id === aim && concealed(b, user.side))) return 'noTarget';
  if (taunted(a, user, bodies, at, grid, now)) return 'taunted';
  if (extraTaken(a, user, now, R)) return 'extra';
  const priced = charged(a, user, bodies, at, now, R);
  if (typeof priced === 'string') return priced;
  if (!inRange(a, user, at, a.move?.kind === 'blink' ? Math.min(rangeFor(a, user, R), R.fight.kit.blinkMax) : rangeFor(a, user, R))) return 'range';
  return { at, paid: priced.user, spent: priced.spent };
}

/**
 * Whether a use may be made now as far as anything but its dice decides: `ready` (rules 2 to 5), then for an ally
 * ability or an aimed body a body in its shape (rule 6's refusal in `landUse`). A blink's landing is not asked. The odds'
 * policy asks it before it chooses (policy.ts), so it never chooses what the reducer refuses.
 */
export function usable(a: Ability, user: Body, bodies: readonly Body[], aim: Aim, grid: Grid, now: Tick, R: ResolveRules): boolean {
  const r = ready(a, user, bodies, aim, grid, now, R);
  if (typeof r === 'string') return false;
  if (a.aim !== 'ally' && typeof aim !== 'string') return true;
  const { hit, ring } = whoIsIn(a, r.paid, catchable(bodies, r.paid), r.at, grid);
  return hit.length + ring.length > 0;
}
export function resolve(a: Ability, user: Body, bodies: readonly Body[], aim: Aim, grid: Grid, rolls: Rolls, now: Tick, R: ResolveRules, answers: Answers = {}): Resolved {
  const r = ready(a, user, bodies, aim, grid, now, R);
  return typeof r === 'string' ? { ok: false, reason: r } : landUse(a, user, r, bodies, aim, grid, rolls, now, R, answers);
}
/**
 * Rules 5b to 19: a use that `ready` let through lands. A channel's release lands this way with what its begin paid, so
 * nothing is asked or paid twice; it can still be refused for a missing roll, a blink with nowhere to stand, or no body
 * in its shape for an ally ability or an aimed body.
 */
export function landUse(a: Ability, user: Body, ok: Ready, bodies: readonly Body[], aim: Aim, grid: Grid, rolls: Rolls, now: Tick, R: ResolveRules, answers: Answers = {}): Resolved {
  const { at, paid } = ok;
  // Rule 5b (kits design 8.3.5): a blink stands its user on the tile it aims at before rule 6, so the use hits from there
  const blink = a.move?.kind === 'blink' ? blinked(user, paid, bodies, at, grid) : null;
  if (typeof blink === 'string') return { ok: false, reason: blink };
  const from = blink ?? paid;
  const { hit, ring } = whoIsIn(a, from, catchable(bodies, from), at, grid);
  if ((a.aim === 'ally' || typeof aim === 'string') && hit.length + ring.length === 0) return { ok: false, reason: 'noTarget' };
  const need = needs(a, user, bodies, aim, grid, now, R), count = diceFor(a, user.tier, R).length;
  const missing = need.react.some(id => rolls.react[id] === undefined)
    || Object.keys(need.dice).some(id => (rolls.dice[id as CombatantId]?.length ?? 0) < count)
    || (need.refund && rolls.refund === undefined)
    || (need.second ?? []).some(id => rolls.second?.[id] === undefined) || (need.boost ?? []).some(b => rolls.boost?.[b.id] === undefined);
  if (missing) return { ok: false, reason: 'needsRoll' };

  const rows = new Map(bodies.map(b => [b.id, b] as const));
  rows.set(user.id, from);
  const snap = snapshot(from, [...rows.values()], hit.length + ring.length, ok.spent, now, R);
  const outcomes: Outcome[] = [], bursts: Burst[] = [];
  for (const first of [...hit, ...ring]) {
    const u = rows.get(user.id)!;
    let t = rows.get(first.id)!;
    const d20 = rollsReaction(a) ? keptFace(a, u, t, rolls) : rolls.react[t.id], dice = rolls.dice[t.id] ?? [];
    const end = whereItEnds(a, u, t, [...rows.values()], at, grid, d20, R);
    if (end.to) t = { ...t, place: end.to };
    const type = a.effect?.type ?? null;
    // rule 7c: a negate leaves the use nothing more to do to the one it protects (kits design 8.4.5)
    if (end.avoid === 'out' || answers.negate?.has(t.id)) { rows.set(t.id, t); outcomes.push(outcome(t.id, 'out', end.to, type)); continue; }
    const isCrit = crit(a, u, t, end.avoid, d20, R);
    const price = targetPrices(a, t, now, R);
    t = price.target;
    const raw = shared(covered(multiplied(formulaValue(a, u, t, dice, kitFor(snap, t.id, price.spent), R), a, u, end.avoid, isCrit, R), a, t, grid, R), a, u, t, R);
    const guard = a.kind === 'strike' ? answers.guard?.[t.id] ?? 0 : 0;
    const dealt = defended(guard ? raw * (1 - guard) : raw, a, u, t, R);
    let absorbed = 0, hpDamage = 0, threat = 0, fill = 0, stag = false;
    const before = t.hp;
    if (type === 'physical' || type === 'magical') {
      const shield = throughShield(t, dealt, now);
      t = shield.target; absorbed = shield.absorbed; hpDamage = wardedDamage(t, dealt - absorbed);
      // rule 13b: a hit about to take a body to 0 sets off an armed lethal reaction, which lands before the hit does
      if (answers.lethal && t.hp > 0 && hpDamage >= t.hp) {
        rows.set(t.id, t);
        if (answers.lethal(t.id, rows)) { t = rows.get(t.id)!; const again = throughShield(t, hpDamage, now); t = again.target; absorbed += again.absorbed; hpDamage = wardedDamage(t, hpDamage - again.absorbed); }
      }
      t = hurt(t, hpDamage);
      threat = t.threat ? dealt * u.sheet.threat : 0;
      t = threatened(t, u.id, threat);
      const s = staggered(t, hpDamage, now, R);
      t = s.target; fill = s.fill; stag = s.staggered;
    } else if (type === 'heal') t = healed(t, dealt);
    else if (type === 'shield') t = { ...t, shield: shielded(t.shield, { amount: dealt, until: tick(now + R.fight.shieldLife * R.fight.round) }, now) };
    let channelBroken = false;
    const lands = end.avoid === 'caught';
    const landed = lands ? landOps(a, u, t, dice, now, R) : { target: t, keys: [], breaks: false, threat: 0, fired: [], detonated: [] };
    if (channelBreaks(t, hpDamage, landed.breaks, now)) { channelBroken = true; }
    t = channelBroken ? broken(landed.target) : landed.target;
    rows.set(t.id, t);
    if (lands) for (const op of a.ops) if (op.op === 'move') {
      const m = moved(op, rows.get(user.id)!, rows.get(t.id)!, null, now, R);
      if (!m) continue;
      rows.set(user.id, m.user); rows.set(m.target.id, m.target);
      if (m.gained) { const holder = op.from === 'user' ? m.target : m.user, c = crossed(holder, m.gained, m.before, m.k, now, R); rows.set(holder.id, c.target); if (c.fired) landed.fired.push(c.fired); }
      t = rows.get(t.id)!;
    }
    outcomes.push({
      target: t.id, avoid: end.avoid, to: end.to, crit: isCrit, raw, dealt, absorbed, type, statuses: landed.keys,
      threat: threat + landed.threat, stagger: fill, staggered: stag, channelBroken, down: before > 0 && t.hp === 0,
    });
    for (const f of landed.fired) bursts.push(landThreshold(rows, f, now, R));
    // a cure that sets a delayed effect off lands its end at once (kits table 2.2)
    for (const d of landed.detonated) { const e = landEnd(rows, t.id, d, now, R); bursts.push({ bearer: t.id, key: d.key, label: d.def.label, landed: [{ target: t.id, dealt: e.dealt }] }); }
  }
  if (rollsReaction(a)) spendEdges(a, rows.get(user.id)!, [...hit, ...ring].map(b => rows.get(b.id)!), rows, now, R);
  const shoved = [...swapped(a, user.id, outcomes, rows, grid), ...pushed(a, user.id, at, outcomes, rows, grid, R)];
  rows.set(user.id, userTime(a, rows.get(user.id)!, now, rolls.refund, R));
  return { ok: true, outcomes, bodies: bodies.map(b => rows.get(b.id)!), bursts, shoved };
}

/** Rule 5b: the user on the tile a blink aims at, or why not: rooted, or a tile it does not see, may not stand on, or is taken. */
function blinked(user: Body, paid: Body, bodies: readonly Body[], at: Place, grid: Grid): Body | 'rooted' | 'blocked' {
  if (user.sheet.stride <= 0) return 'rooted';
  const taken = bodies.some(b => b.id !== user.id && alive(b) && samePlace(b.place, at));
  if (taken || !TERRAIN[terrain(grid, at.x, at.y)].walk || !sees(user.place, at, grid)) return 'blocked';
  return { ...paid, place: at };
}
/** A rooted body is not moved by another's use (kits design 8.3.4). */
const rooted = (b: Body): boolean => b.sheet.stride <= 0;
/**
 * A swap (kits design 8.3.5): the user and the body it aimed at exchange places when each may stand on the other's;
 * against a foe only when the use caught it (a dodge or a resist is no swap). Neither moves if either is rooted.
 */
function swapped(a: Ability, userId: CombatantId, outcomes: readonly Outcome[], rows: Map<CombatantId, Body>, grid: Grid): CombatantId[] {
  if (a.move?.kind !== 'swap') return [];
  const o = outcomes.find(x => x.target !== userId && x.avoid === 'caught'), u = rows.get(userId), t = o && rows.get(o.target);
  if (!u || !t || rooted(u) || rooted(t) || !TERRAIN[terrain(grid, u.place.x, u.place.y)].walk || !TERRAIN[terrain(grid, t.place.x, t.place.y)].walk) return [];
  rows.set(u.id, { ...u, place: t.place });
  rows.set(t.id, moveBreaks({ ...t, place: u.place }));
  return [t.id];
}
/** A body moved by another breaks its channel, as one that moves itself drops it (kits design 8.3.4). */
const moveBreaks = (b: Body): Body => (b.channel?.state === 'holding' ? broken(b) : b);
/**
 * Rule 18c (kits design 8.3, table 8.9.3): each shove of the ability moves each target it caught, `tiles` times the
 * target's control factor (rounded down; 0 for a rooted body), along `shovePath` from its anchor: the user or the aim.
 * A push moves the farthest first, a pull the nearest; then by `y`, then `x`, so a crowd packs. A stop deals nothing.
 */
function pushed(a: Ability, userId: CombatantId, at: Place, outcomes: readonly Outcome[], rows: Map<CombatantId, Body>, grid: Grid, R: ResolveRules): CombatantId[] {
  const moved: CombatantId[] = [];
  for (const op of a.ops) {
    if (op.op !== 'shove') continue;
    const anchor = op.from === 'user' ? rows.get(userId)!.place : at;
    const caught = outcomes.filter(o => o.avoid === 'caught' && o.target !== userId).map(o => rows.get(o.target)!).filter(b => b && b.hp > 0)
      .sort((p, q) => (op.dir === 'away' ? dist(anchor, q.place) - dist(anchor, p.place) : dist(anchor, p.place) - dist(anchor, q.place)) || p.place.y - q.place.y || p.place.x - q.place.x);
    for (const c of caught) {
      const t = rows.get(c.id)!, k = rooted(t) ? 0 : Math.floor(op.tiles * controlFactor(t, R));
      const others = [...rows.values()].filter(b => b.id !== t.id && alive(b)).map(b => b.place);
      const path = shovePath(anchor, t.place, op.dir, k, grid, others);
      if (!path.length) continue;
      rows.set(t.id, moveBreaks({ ...t, place: path[path.length - 1]! }));
      if (!moved.includes(t.id)) moved.push(t.id);
    }
  }
  return moved;
}
