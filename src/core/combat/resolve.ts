// resolve.ts: what one use of an ability does, worked out whole (docs/agent-handoff/rw/design.md section 3.1, rules 2 to
// 19, in that order). Pure: the edge asks `needs` which dice to roll, rolls them and passes them in; nothing is rolled or
// validated here. A use the rules refuse comes back as a refusal and changes nothing. Each rule is one function below,
// named for what it decides. Rules 3 to 4 are the exception: an armed reaction asks them too, so they are `charged` in
// charge.ts, which this file and fight-react.ts both import. A new rule is a function here, called in its place in
// `resolve`, with a test in tests/resolve.test.ts that fails when the rule is removed.

import { tallyOf } from './row-tally.ts';
import { diceOf, evaluate, rollOf, withEdge } from '../formula.ts';
import type { Dice, Env, Formula, KitScope, Scope } from '../formula.ts';
import { formulaOf, tagsOf } from '../registry/ability-kinds.ts';
import type { KindRules } from '../registry/ability-kinds.ts';
import type { Rules } from '../rules.ts';
import { dist, dodge, dodgeOptions, inShape, sees, shovePath, terrain, TERRAIN, tiles, tilesOf } from './space.ts';
import type { Dodge, DodgeTile, Grid, Place, Side, Tiles } from './space.ts';
import { acted, delayed, extraNow, extraStep, interval, notBefore, refunded, tick } from './timeline.ts';
import type { Tick } from './timeline.ts';
import { isDamage } from './damage-type.ts';
import type { Ability, AbilityEffectType, Avoid, CombatantId, DamageType, Outcome } from './ability-types.ts';
import type { LifeState } from '../hunter/vitals.ts';
import { isUp, rowHp } from './row-hp.ts';
import { moveLeft, removeStatus, shielded, shieldOn, withMoved, withStatuses } from './effect-ops.ts';
import { atTier, countOn, stacked } from './op-amount.ts';
import { ambushShare, boostsOn, critFacesAgainst, damageShare, dealtBy, edgeOn, edgeStep, given, healShare, hides, shieldShare, rangeWith, warded, wardedDamage } from './standing.ts';
import { eyesOf, figureOf, perceivedBy, perceives, watched } from './sight.ts';
import type { Lookout } from './sight.ts';
import type { Fog } from './fight-types.ts';
import type { HeldDieId } from './standing.ts';
import type { Body, OpRules, Status, StatusKey, UseOp } from './effect-ops.ts';
import { afterDefence, alive, barFilled, barRate, broken, channelBreaks, clamp, cleansed, drained, hasteOn, healed, hurt, landEnd, landMove, landThreshold, live, opsOf, landStatus, staggerOp, stealthAfter, threatened, throughShield } from './land.ts';
import type { Burst, LandFired } from './land.ts';
import { freeZoneId, MAX_ZONES } from './zones.ts';
import type { Ground, Zone } from './zones.ts';
import { charged, cooled, stacksOn, taken } from './charge.ts';
import type { ChargeRefusal } from './charge.ts';
import { beforeReactions } from './fight-react.ts';
import type { Reacted } from './fight-react.ts';
import { taunter } from './threat.ts';
import { canRiseFor } from './rise.ts';
import { isMinionOf } from './summons.ts';

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
  /** Each held die's roll, by its id (rule 7b: `heldDieId`, its bearer, status and op); absent when none is a die. */
  readonly boost?: Readonly<Record<HeldDieId, number>>;
};
/**
 * What the edge must roll before it sends a use: each target's dice and reaction d20, the user's refund d20, a second
 * d20 for each target whose die has an edge (`second`), and each held die to roll by its id (`boost`: one a die, however
 * many one body holds; a user's reaches every target and is rolled once a use); the last two absent when there are none.
 */
export type Needs = {
  readonly dice: Readonly<Record<CombatantId, readonly Dice[]>>; readonly react: readonly CombatantId[]; readonly refund: boolean;
  readonly second?: readonly CombatantId[]; readonly boost?: readonly { readonly id: HeldDieId; readonly sides: number }[];
  /** Set when the use raises a corpse (`a.raise`): exempts the corpse's trailing d20 from hidden fight fudge (`fudge.ts`). */
  readonly raise?: true;
};
/** Why a use was refused: rules 3 to 4's refusals (`ChargeRefusal`, charge.ts), and those of the rules here. */
export type UseRefusal = ChargeRefusal | 'taunted' | 'range' | 'noTarget' | 'needsRoll'
  /** A second extra action in one round of fight time (kits design 8.6.1, `extraPerRound`). */
  | 'extra'
  /** A blink of a rooted user, or one to a tile it does not see, may not stand on or is taken (kits design 8.3.5). */
  | 'rooted' | 'blocked';
/** A threshold that a use's status set off (rule 18a): on whom, which status, and what its ops did to each body they reached. */
export type { Burst } from './land.ts';
export { afterDefence } from './land.ts';
/**
 * `shoved`: the bodies moved by another's use (a push, a pull or the target of a swap, kits design 8.3), whose entry
 * into a zone pays nothing (`zones.ts:216`); `reacted`: the reactions the use set off (rules 7c and 13b).
 */
export type Resolved =
  | { readonly ok: false; readonly reason: UseRefusal }
  | {
    readonly ok: true; readonly outcomes: readonly Outcome[]; readonly bodies: readonly Body[]; readonly bursts: readonly Burst[]; readonly shoved: readonly CombatantId[]; readonly reacted: Reacted;
    /** The HP the user's lifesteal healed it (land.ts `drained`), 0 for none. */
    readonly drained: number;
    /** The shield the user's damage to shield added to what it held (land.ts `drained`), 0 for none. */
    readonly stored: number;
  };
/** Caller-supplied dodge choices (by row id) for a use being resolved in ask mode. */
export type DodgePick = Readonly<Record<CombatantId, Place>>;
/**
 * The first hunter caught in a use who has two or more tiles to choose from (staying put plus at least one reachable
 * move), before damage or statuses land. `bodies` holds the rows with any earlier target's dodge already applied and no
 * damage taken yet. `reach` is `min(rollCan, left)` where `left` is the hunter's remaining movement bank.
 */
export type DodgeAsked = {
  readonly ask: true; readonly who: CombatantId; readonly by: CombatantId; readonly ability: Ability;
  readonly mode: Dodge; readonly reach: Tiles; readonly left: Tiles;
  readonly auto: DodgeTile; readonly tiles: readonly DodgeTile[];
  readonly hit: readonly Place[]; readonly ring: readonly Place[]; readonly bodies: readonly Body[];
};
export type ResolvedOrAsk = Resolved | DodgeAsked;
export type ResolveRules = OpRules & Pick<Rules, 'dice'>;

const samePlace = (a: Place, b: Place): boolean => a.x === b.x && a.y === b.y;
export const placeOf = (aim: Aim, bodies: readonly Body[]): Place | null => typeof aim === 'string' ? bodies.find(b => b.id === aim)?.place ?? null : aim;
export const againstFoes = (a: Pick<Ability, 'aim'>): boolean => a.aim === 'foe' || a.aim === 'place';
const rollsReaction = (a: Ability): boolean => againstFoes(a) && a.delivery.kind !== 'sure';
/** The formula of an op that rolls dice for each target, at the user's tier. */
const rolled = (o: UseOp, tier: number): Formula | null => o.op === 'shield' ? o.amount : o.op === 'mana' || o.op === 'fatigue' ? atTier(o.amount, tier) : null;
const extraDice = (ops: readonly UseOp[], tier: number): Dice[] => ops.flatMap(o => { const f = rolled(o, tier); return f ? diceOf(f) : []; });
/**
 * The dice one target of `a` needs, in order: its effect's, then a shield, mana or fatigue op's, at the user's tier,
 * and a d20 when `a.raise` is set (Arise's Presence check). A player's phone rolls them for a `cast`.
 */
export const diceFor = (a: Ability, tier: number, R: KindRules): Dice[] => {
  const f = formulaOf(a, R);
  return [...(f ? diceOf(f) : []), ...extraDice(a.ops, tier), ...(a.raise ? [ONE_D20_DIE] : [])];
};

/** Whether `a` aimed at `at` from `user` covers `src`'s tile (hit or ring). */
export function coversBody(a: Pick<Ability, 'shape'>, user: Pick<Body, 'place'>, at: Place, src: Pick<Body, 'place'>, grid: Grid): boolean {
  const cover = tilesOf(a.shape, user.place, at, grid);
  return [...cover.hit, ...cover.ring].some(p => samePlace(p, src.place));
}

// Rule 2: a taunted user aims at its taunter, or at a place whose shape holds it, while the taunter is pickable and in range.
export function taunted(a: Ability, user: Body, at: Place, seen: Lookout, R: ResolveRules): boolean {
  if (!againstFoes(a)) return false;
  const t = taunter(user);
  if (!t) return false;
  const src = seen.rows.find(b => b.id === t.by);
  if (!src || !pickable(src, user, seen) || dist(user.place, src.place) > rangeFor(a, user, R)) return false;
  return !coversBody(a, user, at, src, seen.grid);
}

// Rules 3 to 4 (cooldown, gates and uses, cost and kit prices) are `charged` in charge.ts, which a reaction asks as well.

// Rule 5: within the ability's range, and the tiles a user's `sheet` ops add to a range of 2 or more (kits design 8.1).
export const inRange =(a: Pick<Ability, 'aim' | 'range'>, user: { readonly place: Place }, at: Place, range: number = a.range): boolean =>
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

// Rule 8a and 8b: where the target ends. A self, ally or sure use is caught. Hunters cap dodge reach by their per-turn
// movement bank (`moveLeft`) and may stay put or pick any reachable tile; monsters, shadows, and summons stay automatic.
function whereItEnds(
  a: Ability, user: Body, fromPlace: Place, target: Body, bodies: readonly Body[], at: Place, grid: Grid, d20: number | undefined, R: ResolveRules, picks?: DodgePick,
): { avoid: Avoid; to: Place | null; steps: Tiles } | DodgeAsked {
  if (!rollsReaction(a) || d20 === undefined) return { avoid: 'caught', to: null, steps: tiles(0) };
  if (a.delivery.kind === 'direct') return { avoid: resists(d20, target.sheet.will, user.sheet.aim, R) ? 'resisted' : 'caught', to: null, steps: tiles(0) };
  const land = landTime(a, user, target, R) ?? 0;
  const share = clamp((d20 + edge(target.sheet.react, user.sheet.aim, R)) / 20, 0, 1);
  const rollCan = Math.floor(target.sheet.move * land * share);
  const others = bodies.filter(b => b.id !== target.id && alive(b)).map(b => b.place);
  const cover = tilesOf(a.shape, fromPlace, at, grid);
  if (target.kind === 'hunter') {
    const left = moveLeft(target), can = tiles(Math.min(rollCan, left));
    const opts = dodgeOptions(target.place, can, cover, grid, others);
    if (picks && !target.npc) {
      if (Object.hasOwn(picks, target.id)) {
        const want = picks[target.id]!, chosen = opts.tiles.find(o => samePlace(o.place, want)) ?? opts.auto;
        return { avoid: chosen.avoid, to: chosen.steps > 0 ? chosen.place : null, steps: chosen.steps };
      }
      if (opts.tiles.length >= 2) {
        return { ask: true, who: target.id, by: user.id, ability: a, mode: opts.auto.avoid, reach: can, left, auto: opts.auto, tiles: opts.tiles, hit: cover.hit, ring: cover.ring, bodies };
      }
    }
    const chosen = opts.auto;
    return { avoid: chosen.avoid, to: chosen.steps > 0 ? chosen.place : null, steps: chosen.steps };
  }
  const end = dodge(target.place, tiles(rollCan), cover, grid, others);
  return { avoid: end.avoid, to: end.avoid !== 'caught' && !samePlace(end.to, target.place) ? end.to : null, steps: tiles(0) };
}

// Rule 9: the low faces of the target's die are the moments it froze; a target's exposed faces add to the user's (kits 8.1).
const crit = (a: Ability, user: Body, target: Body, avoid: Avoid, d20: number | undefined, R: ResolveRules): boolean =>
  rollsReaction(a) && avoid === 'caught' && d20 !== undefined && d20 <= critFacesAgainst(user, target, R);

// Rule 6b (kits design 1.5): what the kits' names read, a snapshot when the shape's bodies are known, so every target of
// an area reads the same field and a use's own chain does not change its numbers. Each within its rule's bound.
export type Snapshot = { readonly bodies: ReadonlyMap<CombatantId, { readonly stacks: Readonly<Record<StatusKey, number>>; readonly missing: number }>; readonly user: CombatantId; readonly field: Readonly<Record<StatusKey, number>>; readonly held: Readonly<Record<StatusKey, number>>; readonly hits: number; readonly kills: number; readonly spent: number };
export function snapshot(user: Body, bodies: readonly Body[], hits: number, spent: number, now: Tick, R: ResolveRules): Snapshot {
  const K = R.fight.kit, up = bodies.filter(isUp);
  const stacksOf = (b: Body) => Object.fromEntries(live(b).map(s => [s.key, Math.min(K.stackCap, countOn(s))])) as Record<StatusKey, number>;
  const field: Record<StatusKey, number> = {};
  for (const b of up) for (const s of live(b)) field[s.key] = Math.min(K.fieldStacks, (field[s.key] ?? 0) + countOn(s));
  const held = Object.fromEntries(live(user).map(s => [s.key, Math.min(K.held, Math.max(0, (now - s.since) / R.fight.round))])) as Record<StatusKey, number>;
  const all = new Map(bodies.map(b => [b.id, { stacks: stacksOf(b), missing: b.sheet.hpMax > 0 ? Math.max(0, Math.min(1, 1 - rowHp(b) / b.sheet.hpMax)) : 0 }] as const));
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
    const held = stacksOn(t, p.key), take = Math.min(held, p.take.kind === 'all' ? held : p.take.n);
    if (take > 0) { t = withStatuses(t, taken(t, p.key, take), now, R); spent += take; }
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
  a.delivery.kind === 'travel' && (a.shape.kind === 'line' || a.shape.kind === 'radius') && isDamage(a.effect?.type)
  && TERRAIN[terrain(grid, at.x, at.y)].cover;
const covered = (raw: number, a: Ability, type: AbilityEffectType | null, target: Body, grid: Grid, R: ResolveRules): number =>
  isDamage(type) && inCover(a, target.place, grid) ? raw * (1 - R.fight.coverShare) : raw;

// Rule 11c (kits design 8.1): a damaging use is multiplied by the user's dealt share and the target's taken share, a heal
// by the user's heal and shield power (standing.ts `given`, outside the cap) and the target's healed share, a shield by
// that power and its shielded share, each share within `kit.shareCap` of 1 (standing.ts). A hit on a target that does not
// perceive its hidden user is an ambush (`ambushes`): the rules' `stealth.ambush` joins the user's dealt increases. A
// damaging use is then multiplied by its user's `dealtBy` (a solo run's foe's tweak), outside the cap.
function shared(raw: number, type: AbilityEffectType | null, user: Body, target: Body, grid: Grid, R: ResolveRules): number {
  if (type === 'heal') return given(raw, user) * healShare(target, R);
  if (type === 'shield') return given(raw, user) * shieldShare(target, R);
  if (!isDamage(type)) return raw;
  return raw * (ambushes(user, target, grid) ? ambushShare(user, target, R) : damageShare(user, target, R)) * dealtBy(user);
}
/**
 * Rule 11c's ambush (notes-7-stealth.md section 3's table, the owner's rulings 3 and 5): `target`'s own eyes do not
 * perceive `user` over the whole map (sight.ts `perceives`), which only a hidden user's stealth can cause. A target that
 * sees the user, with a sight above its stealth level, saw it coming; its allies' eyes do not warn it.
 */
const ambushes = (user: Body, target: Body, grid: Grid): boolean => !perceives(eyesOf(target), figureOf(user), grid, { kind: 'whole' });

// Rule 12: penetration percent, then flat; then the flat part of what is left comes off the hit, then the percentage; at least 1.
function defended(raw: number, type: AbilityEffectType | null, user: Body, target: Body, R: ResolveRules): number {
  if (!type) return 0;
  if (type === 'heal' || type === 'shield') return Math.max(0, Math.round(raw));
  return afterDefence(raw, type, user.sheet, target.sheet, R);
}

// Rule 15 (design 4.2): the damage a hit's threat counts, `threatBeforeDefence` of it from the hit before the target's
// armor or resist (`struck`), the rest from what it dealt after them; the user's threat multiplier is applied by the caller.
const threatOfHit = (struck: number, dealt: number, R: ResolveRules): number =>
  R.fight.threatBeforeDefence * Math.max(0, struck) + (1 - R.fight.threatBeforeDefence) * dealt;

// Rule 16: a weak hit fills the bar 1.5 times its damage, at the bar's rate; the bar fills where every fill does (land.ts `barFilled`).
function staggered(target: Body, damage: number, now: Tick, R: ResolveRules): { target: Body; fill: number; staggered: boolean } {
  if (!target.stagger || damage <= 0) return { target, fill: 0, staggered: false };
  const fill = damage * (damage < R.fight.staggerWeakBelow * target.stagger.hit ? R.fight.staggerWeak : 1) * barRate(target);
  return { ...barFilled(target, fill, now, R), fill };
}

// Rule 17: a channel breaks on a single hit of at least `hold * hpMax`, or on an op that breaks it, unless protected.

// Rule 18: the ability's ops on a target it caught. A control status lasts less on a tenacious target, on a boss as on any. A
// stacking status adds the op's stacks (kits design 1.1); rule 18a checks its threshold after each application. `seen`:
// whether a foe that is up has the target in sight, which refuses a hide that starts out of sight (land.ts `landStatus`).
function landOps(a: Ability, user: Body, target: Body, dice: readonly number[], seen: boolean, now: Tick, R: ResolveRules): { target: Body; keys: StatusKey[]; breaks: boolean; threat: number; fill: number; staggers: boolean; fired: LandFired[]; detonated: Status[] } {
  const f = formulaOf(a, R);
  let t = target, breaks = false, threat = 0, fill = 0, staggers = false, die = f ? diceOf(f).length : 0;
  const keys: StatusKey[] = [], fired: LandFired[] = [], detonated: Status[] = [];
  for (const op of a.ops) {
    switch (op.op) {
      case 'applyStatus': {
        // the one rule for a status put on a body (land.ts `landStatus`), a trigger's and a threshold's too
        const p = landStatus(t, op, user, { id: user.id, tier: user.tier }, user.side, true, seen, now, R);
        if (!p.put) break;
        t = p.target; threat += p.threat; breaks ||= p.breaks;
        if (p.fired) fired.push(p.fired);
        keys.push(op.key);
        break;
      }
      // a cure and a dispel are one edge with a land op's (land.ts `cleansed`): a detonation lands once the use's outcome is in
      case 'cureStatus': case 'dispel': {
        const c = cleansed(t, op, now, R);
        t = c.target; detonated.push(...c.lands);
        break;
      }
      case 'delay': t = delayed(t, atTier(op.ticks, user.tier)); break;
      case 'threat': { const n = atTier(op.amount, user.tier); t = threatened(t, user.id, n); threat += t.threat ? n : 0; break; }
      case 'shield': case 'mana': case 'fatigue': {
        const f = rolled(op, user.tier)!, n = diceOf(f).length, roll = dice.slice(die, die + n);
        die += n;
        const v = Math.round(evaluate(f, { user: { stats: user.stats, sheet: user.sheet }, target: { stats: t.stats, sheet: t.sheet }, charge: 0, dice: roll }));
        if (op.op === 'shield') t = { ...t, shield: shieldOn(t, given(v, user), tick(now + R.fight.shieldLife * R.fight.round), now, R) };
        else if (op.op === 'mana') t = { ...t, mana: clamp(t.mana + v, 0, t.sheet.manaMax) };
        else t = { ...t, fatigue: clamp(t.fatigue + v, 0, t.sheet.fatigueMax) };
        break;
      }
      case 'channel': if (op.mode === 'break') breaks = true; break;
      case 'note': break;
      // a shove lands after every outcome, in its order (rule 18c, `pushed`)
      case 'shove': break;
      // a move changes the user too: it lands after the target's ops (`movedOn`)
      case 'move': break;
      case 'hasten': t = hasteOn(user, t, op.share, now, R); break;
      // the stealth machine's `revealed` (a Flare's), as the land op lands it (land.ts `landOne`)
      case 'reveal': t = stealthAfter(t, { type: 'revealed' }, now, R); break;
      // keystones A.7: a share of the bar, as the land op fills it (land.ts `staggerOp`); the outcome counts it with the hit's
      case 'stagger': { const s = staggerOp(t, op.share, now, R); t = s.target; fill += s.fill; staggers ||= s.staggered; break; }
      // an extra action is the user's (`userTime`); a guard and a negate are a reaction's (fight-react.ts)
      case 'extra': case 'guard': case 'negate': break;
      default: op satisfies never;
    }
  }
  return { target: t, keys, breaks, threat, fill, staggers, fired, detonated };
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
  const ops = opsOf(user);
  const delay = ops.reduce((n, { op, tier }) => op.op === 'delay' ? n + atTier(op.ticks, tier) : n, 0);
  if (delay) u = delayed(u, tick(delay));
  const pct = ops.reduce((best, { op, tier }) => op.op === 'refund' && refundLands(op.chance, refundRoll) ? Math.max(best, atTier(op.pct, tier)) : best, 0);
  if (pct) u = refunded(u, now, interval(user.speed, a.cost.time, R.fight), pct);
  // an extra action (kits design 8.6.1): the next turn is now, one a round of fight time
  if (a.ops.some(o => o.op === 'extra')) {
    const round = Math.floor(now / R.fight.round), n = u.extras?.round === round ? u.extras.n + 1 : 1;
    u = { ...extraNow(u, now), extras: { round, n } };
  }
  return cooled(a, u, now);
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
const refundRolls = (user: Body, now: Tick): boolean => opsOf(user).some(({ op }) => op.op === 'refund' && op.chance < 100);

/**
 * The dice and reaction rolls the edge must roll for this use of `a` by `user`, as the fight stands (`bodies`): those of
 * the field it lands on (`field`), for each body in its shape there its dice and its d20. A channel's are its release's,
 * which lands what its begin paid; any other use pays as it lands (`ready`). A use the rules refuse asks for none.
 */
export function needs(a: Ability, user: Body, bodies: readonly Body[], aim: Aim, grid: Grid, now: Tick, R: ResolveRules): Needs {
  const ok = a.channel ? channelReady(user, bodies, aim) : ready(a, user, bodies, aim, grid, now, R);
  const f = ok === null || typeof ok === 'string' ? null : field(a, user, ok.paid, bodies, aim, ok.at, grid, now, R);
  return f === null || typeof f === 'string' ? { dice: {}, react: [], refund: false } : asked(a, f, now, R);
}
/** A channel's release as `needs` asks it: the tile it was aimed at, its user as it stands, which paid at the begin. */
const channelReady = (user: Body, bodies: readonly Body[], aim: Aim): Ready | null => {
  const at = placeOf(aim, bodies);
  return at === null ? null : { at, paid: user, spent: 0 };
};
/** The dice a use asks of the field it lands on: each body in its shape there its dice and, read from where its user stands, its d20, second d20 and held dice. */
function asked(a: Ability, f: Field, now: Tick, R: KindRules): Needs {
  const inside = [...f.hit, ...f.ring], user = f.from;
  const dice = diceFor(a, user.tier, R), reacting = rollsReaction(a) ? inside : [];
  const second = reacting.filter(t => edgeOn(tagsOf(a), user, t).cut !== null).map(t => t.id);
  const boost: { id: HeldDieId; sides: number }[] = [];
  for (const t of reacting) for (const b of boostsOn(user, t)) if (b.die.kind === 'die' && !boost.some(x => x.id === b.held)) boost.push({ id: b.held, sides: b.die.sides });
  return {
    dice: Object.fromEntries(inside.map(b => [b.id, dice])),
    react: reacting.map(b => b.id),
    refund: refundRolls(user, now),
    ...(second.length ? { second } : {}), ...(boost.length ? { boost } : {}),
    ...(a.raise ? { raise: true as const } : {}),
  };
}

/**
 * The field a use lands on, after rules 5b, 6 and 7c: its paid user where it stands (on the tile a blink aims at), the
 * bodies with the user among them and the changes its `before` reactions made, the bodies in its shape from there, and
 * what those reactions ask of the use. `needs` asks its dice of this field and `landUse` lands on it, so the dice asked
 * are the dice read.
 */
type Field = { readonly from: Body; readonly bodies: readonly Body[]; readonly hit: readonly Body[]; readonly ring: readonly Body[]; readonly answers: Answers; readonly reacted: Reacted };
function field(a: Ability, user: Body, paid: Body, bodies: readonly Body[], aim: Aim, at: Place, grid: Grid, now: Tick, R: ResolveRules): Field | 'rooted' | 'blocked' {
  if (a.aim === 'corpse') {
    const corpse = typeof aim === 'string' ? bodies.find(b => b.id === aim) : undefined;
    const hit = corpse && a.raise && canRiseFor(corpse, bodies, a.raise) ? [corpse] : [];
    const stood = bodies.map(b => b.id === user.id ? paid : b);
    return { from: paid, bodies: stood, hit, ring: [], answers: {}, reacted: { said: [], about: [], lethal: [], bursts: [], count: { n: 0 } } };
  }
  // Rule 5b (kits design 8.3.5): a blink stands its user on the tile it aims at before rule 6; a swap checks standing before cost is kept.
  const blink = a.move?.kind === 'blink' ? blinked(user, paid, bodies, at, grid) : null;
  if (typeof blink === 'string') return blink;
  if (a.move?.kind === 'swap') {
    const swapTarget = a.aim === 'ally'
      ? (typeof aim === 'string' ? catchable(bodies, user).find(b => b.id === aim) ?? null : catchable(bodies, user).find(b => b.id !== user.id && samePlace(b.place, at)) ?? null)
      : null;
    const bad = swapStands(user, swapTarget, grid);
    if (bad) return bad;
  }
  const stand = blink ?? paid, stood = bodies.map(b => b.id === user.id ? stand : b);
  // rule 7c (kits design 8.4): before the use lands, the reactions of the bodies its shape catches fire on the bodies they protect
  const shape = whoIsIn(a, stand, catchable(stood, stand), at, grid);
  const before = beforeReactions(a, stand, [...shape.hit, ...shape.ring], stood, now, R);
  const from = before.rows.find(b => b.id === user.id)!;
  const { hit, ring } = whoIsIn(a, from, catchable(before.rows, from), at, grid);
  return { from, bodies: before.rows, hit, ring, answers: before.answers, reacted: before.reacted };
}

// Rule 7b (kits design 8.2): the kept face. A die with an edge is two d20s kept higher or lower, read through the dice
// notation's one keep rule (formula.ts `withEdge` and `rollOf`: `2d20kh1`, `2d20kl1`); then each held die moves it, the
// attacker's down and the defender's up, kept within a d20's faces.
function keptFace(a: Ability, user: Body, target: Body, rolls: Rolls): number | undefined {
  const d20 = rolls.react[target.id];
  if (d20 === undefined) return undefined;
  const { cut } = edgeOn(tagsOf(a), user, target), second = rolls.second?.[target.id];
  const term = cut && second !== undefined ? withEdge(ONE_D20, cut) : ONE_D20;
  const read = rollOf(term as Dice, term === ONE_D20 ? [d20] : [d20, second!]);
  let face = 'total' in read ? read.total : d20;
  for (const b of boostsOn(user, target)) {
    const n = b.die.kind === 'face' ? b.die.n : rolls.boost?.[b.held] ?? 0;
    face += b.side === 'attack' ? -n : n;
  }
  return Math.max(1, Math.min(D20_FACES, face));
}
const D20_FACES = 20;
const ONE_D20_DIE: Dice = { count: 1, sides: D20_FACES };
const ONE_D20: Formula = { kind: 'dice', count: 1, sides: D20_FACES };
/**
 * What a use's edges and held dice spend once it resolved (table 8.9.2): an edge with `spend` that reached a die loses a
 * stack (or ends, a plain one), once a use however many targets; a held die always spends.
 */
function spendEdges(a: Ability, user: Body, targets: readonly Body[], rows: Map<CombatantId, Body>, now: Tick, R: ResolveRules): void {
  const gone: { id: CombatantId; key: StatusKey }[] = [];
  for (const t of targets) {
    for (const s of edgeOn(tagsOf(a), user, t).spent) if (!gone.some(x => x.id === s.id && x.key === s.key)) gone.push(s);
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

/**
 * The bodies a use of `user` may catch: those that can be aimed at (`canAimAt`, up and alive), excluding a foe that is
 * untargetable (kits design 8.1). A hidden body is caught: a shape at a place finds it whatever the sight
 * (notes-7-stealth.md section 3).
 */
const catchable = (bodies: readonly Body[], user: Body): Body[] => bodies.filter(b => canAimAt(b) && !warded(b, user.side));

const outcome = (target: CombatantId, avoid: Avoid, to: Place | null, type: Outcome['type']): Outcome =>
  ({ target, avoid, to, crit: false, raw: 0, dealt: 0, absorbed: 0, type, statuses: [], threat: 0, stagger: 0, staggered: false, channelBroken: false, down: false });

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
 * Rules 2 to 5 of a use, before anything lands: an aim that is there and may be picked (`pickable`), no taunt, no extra
 * action taken this round, `charged` (rules 3 to 4, charge.ts) and the range. A channel's begin asks the same (fight.ts),
 * so a channel pays what a use pays. `fog` is the fight's (null: none, so eyes look over the whole map).
 */
export function ready(a: Ability, user: Body, bodies: readonly Body[], aim: Aim, grid: Grid, now: Tick, R: ResolveRules, fog: Fog | null = null): Ready | UseRefusal {
  const seen: Lookout = { rows: bodies, grid, fog };
  if (a.aim === 'corpse') {
    if (typeof aim !== 'string' || !a.raise) return 'noTarget';
    const corpse = bodies.find(b => b.id === aim);
    if (!corpse || !canRiseFor(corpse, bodies, a.raise) || !perceivedBy(user.side, corpse, seen)) return 'noTarget';
    if (extraTaken(a, user, now, R)) return 'extra';
    const priced = charged(a, user, bodies, corpse.place, now, R);
    if (typeof priced === 'string') return priced;
    if (!inRange(a, user, corpse.place, rangeFor(a, user, R))) return 'range';
    return { at: corpse.place, paid: priced.user, spent: priced.spent };
  }
  const at = placeOf(aim, bodies);
  if (at === null) return 'noTarget';
  if (typeof aim === 'string') {
    const target = bodies.find(b => b.id === aim)!;
    if (!pickable(target, user, seen) || !swapWith(a, user, target)) return 'noTarget';
  }
  if (taunted(a, user, at, seen, R)) return 'taunted';
  if (extraTaken(a, user, now, R)) return 'extra';
  const priced = charged(a, user, bodies, at, now, R);
  if (typeof priced === 'string') return priced;
  if (!inRange(a, user, at, a.move?.kind === 'blink' ? Math.min(rangeFor(a, user, R), R.fight.kit.blinkMax) : rangeFor(a, user, R))) return 'range';
  return { at, paid: priced.user, spent: priced.spent };
}

/**
 * Rule 2: whether a body can be aimed at by an ability: only a body that is up. A dead body is never offered as a target
 * for non-corpse abilities and a pick aimed at one is refused (corpse abilities use `aim: 'corpse'`, and the GM's
 * `revive` stands dead rows up). The one rule for `pickable` here and `aims` in fight-view.ts.
 */
export const canAimAt = (target: { readonly life: { readonly at: LifeState } } | { readonly down: boolean }): boolean =>
  'life' in target ? isUp(target) : !target.down;

/**
 * Rule 2: whether `user` may pick `target` for a swap move: never itself, only a shadow when `only === 'shadow'`, and
 * only a minion owned by `user` when `only === 'minion'`. The one predicate for `ready` here and `aims` in fight-view.ts.
 */
export const swapWith = (
  a: Pick<Ability, 'move'>,
  user: { readonly id: CombatantId },
  target: { readonly id: CombatantId; readonly kind: Body['kind']; readonly owner?: CombatantId | null },
): boolean => a.move?.kind !== 'swap'
  || (target.id !== user.id
    && (a.move.only === 'shadow' ? target.kind === 'shadow' : a.move.only === 'minion' ? isMinionOf(target, user.id) : true));

/**
 * Rule 2: whether `user` may pick `t` as its target: `t` can be aimed at (`canAimAt`), is not warded from it (standing.ts
 * `warded`, the untargetable ward), and the user's side perceives it in `seen` (sight.ts `perceivedBy`: a hidden body
 * only by a sight above its level; in a fog only within the fog's sight of a body of the side, the owner's rulings 1 and 7).
 */
const pickable = (t: Body, user: Body, seen: Lookout): boolean => canAimAt(t) && !warded(t, user.side) && perceivedBy(user.side, t, seen);

/**
 * Whether a use may be made now as far as anything but its dice decides: `ready` (rules 2 to 5), then for an ally
 * ability or an aimed body a body in its shape (rule 6's refusal in `landUse`). A blink's landing is not asked. The odds'
 * policy asks it before it chooses (policy.ts), so it never chooses what the reducer refuses.
 */
export function usable(a: Ability, user: Body, bodies: readonly Body[], aim: Aim, grid: Grid, now: Tick, R: ResolveRules, fog: Fog | null = null): boolean {
  const r = ready(a, user, bodies, aim, grid, now, R, fog);
  if (typeof r === 'string') return false;
  if (a.aim === 'corpse') return true;
  if (a.aim !== 'ally' && typeof aim !== 'string') return true;
  const { hit, ring } = whoIsIn(a, r.paid, catchable(bodies, r.paid), r.at, grid);
  return hit.length + ring.length > 0;
}
/**
 * One use of `a` by `user` aimed at `aim` at time `now`, by design 3.1 rules 2 to 19. `bodies` is every combatant of the
 * fight, the user among them, and `fog` its fog; the result holds them all, changed where the use changed them. Rule 1
 * (whose turn it is) and rule 20 (the log) are the reducer's.
 */
export function resolve(a: Ability, user: Body, bodies: readonly Body[], aim: Aim, grid: Grid, rolls: Rolls, now: Tick, R: ResolveRules, fog?: Fog | null): Resolved;
export function resolve(a: Ability, user: Body, bodies: readonly Body[], aim: Aim, grid: Grid, rolls: Rolls, now: Tick, R: ResolveRules, fog: Fog | null, picks: DodgePick): ResolvedOrAsk;
export function resolve(a: Ability, user: Body, bodies: readonly Body[], aim: Aim, grid: Grid, rolls: Rolls, now: Tick, R: ResolveRules, fog: Fog | null = null, picks?: DodgePick): ResolvedOrAsk {
  const r = ready(a, user, bodies, aim, grid, now, R, fog);
  if (typeof r === 'string') return { ok: false, reason: r };
  return picks ? landUse(a, user, r, bodies, aim, grid, rolls, now, R, fog, picks) : landUse(a, user, r, bodies, aim, grid, rolls, now, R, fog);
}
/**
 * Rules 5b to 19: a use that `ready` let through lands. A channel's release lands this way with what its begin paid, so
 * nothing is asked or paid twice; it can still be refused for a missing roll, a blink with nowhere to stand, or no body
 * in its shape for an ally ability or an aimed body. With `picks` given, a hunter with two or more dodge tiles pauses
 * before damage or statuses land (`DodgeAsked`).
 */
export function landUse(a: Ability, user: Body, ok: Ready, bodies: readonly Body[], aim: Aim, grid: Grid, rolls: Rolls, now: Tick, R: ResolveRules, fog?: Fog | null): Resolved;
export function landUse(a: Ability, user: Body, ok: Ready, bodies: readonly Body[], aim: Aim, grid: Grid, rolls: Rolls, now: Tick, R: ResolveRules, fog: Fog | null, picks: DodgePick): ResolvedOrAsk;
export function landUse(a: Ability, user: Body, ok: Ready, bodies: readonly Body[], aim: Aim, grid: Grid, rolls: Rolls, now: Tick, R: ResolveRules, fog: Fog | null = null, picks?: DodgePick): ResolvedOrAsk {
  const { at } = ok, hiding = hides(a);
  const f = field(a, user, ok.paid, bodies, aim, at, grid, now, R);
  if (typeof f === 'string') return { ok: false, reason: f };
  const { from, hit, ring, answers } = f;
  if ((a.aim === 'ally' || typeof aim === 'string') && hit.length + ring.length === 0) return { ok: false, reason: 'noTarget' };
  const need = asked(a, f, now, R), count = diceFor(a, user.tier, R).length;
  const missing = need.react.some(id => rolls.react[id] === undefined)
    || Object.keys(need.dice).some(id => (rolls.dice[id as CombatantId]?.length ?? 0) < count)
    || (need.refund && rolls.refund === undefined)
    || (need.second ?? []).some(id => rolls.second?.[id] === undefined) || (need.boost ?? []).some(b => rolls.boost?.[b.id] === undefined);
  if (missing) return { ok: false, reason: 'needsRoll' };

  const rows = new Map(f.bodies.map(b => [b.id, b] as const));
  const targets = [...hit, ...ring];
  const d20s = new Map<CombatantId, number | undefined>(), ends = new Map<CombatantId, { avoid: Avoid; to: Place | null; steps: Tiles }>();
  // Pass 1: every target dodges in order before any damage or status lands, so a hunter's pick never leaks an earlier
  // target's fate. A negated hunter skips dodging completely so it spends no movement bank; shadows and summons keep stepping aside.
  for (const first of targets) {
    const u = rows.get(user.id)!, t = rows.get(first.id)!;
    const d20 = rollsReaction(a) ? keptFace(a, u, t, rolls) : rolls.react[t.id];
    d20s.set(t.id, d20);
    const negated = answers.negate?.has(t.id) === true;
    const end = negated && t.kind === 'hunter'
      ? { avoid: 'out' as const, to: null, steps: tiles(0) }
      : whereItEnds(a, u, from.place, t, [...rows.values()], at, grid, d20, R, negated ? undefined : picks);
    if ('ask' in end) return end;
    ends.set(t.id, end);
    if (end.to) rows.set(t.id, withMoved({ ...t, place: end.to }, end.steps));
  }
  const snap = snapshot(rows.get(user.id)!, [...rows.values()], targets.length, ok.spent, now, R);
  const outcomes: Outcome[] = [], bursts: Burst[] = [];
  // the HP the use took from bodies other than its user, its hit's and its ops' as they land: what its lifesteal reads
  let lost = 0;
  for (const first of targets) {
    const u = rows.get(user.id)!;
    let t = rows.get(first.id)!;
    const d20 = d20s.get(t.id), dice = rolls.dice[t.id] ?? [], end = ends.get(t.id)!;
    const type = a.effect?.type ?? null;
    // rule 7c: a negate leaves the use nothing more to do to the one it protects (kits design 8.4.5)
    if (end.avoid === 'out' || answers.negate?.has(t.id)) { rows.set(t.id, t); outcomes.push(outcome(t.id, 'out', end.to, type)); continue; }
    const isCrit = crit(a, u, t, end.avoid, d20, R);
    const price = targetPrices(a, t, now, R);
    t = price.target;
    const raw = shared(covered(multiplied(formulaValue(a, u, t, dice, kitFor(snap, t.id, price.spent), R), a, u, end.avoid, isCrit, R), a, type, t, grid, R), type, u, t, grid, R);
    const guard = a.kind === 'strike' ? answers.guard?.[t.id] ?? 0 : 0;
    const struck = guard ? raw * (1 - guard) : raw, dealt = defended(struck, type, u, t, R);
    let absorbed = 0, hpDamage = 0, threat = 0, fill = 0, stag = false;
    const before = rowHp(t);
    if (type === null) {
      // no direct damage, heal, or shield
    } else if (type === 'heal') t = healed(t, dealt);
    else if (type === 'shield') t = { ...t, shield: shielded(t.shield, { amount: dealt, until: tick(now + R.fight.shieldLife * R.fight.round) }, now) };
    else {
      const _exhaustive: DamageType = type satisfies DamageType; void _exhaustive;
      const shield = throughShield(t, dealt, now);
      t = shield.target; absorbed = shield.absorbed; hpDamage = wardedDamage(t, dealt - absorbed);
      // rule 13b: a hit about to take a body to 0 sets off an armed lethal reaction, which lands before the hit does
      if (answers.lethal && isUp(t) && hpDamage >= rowHp(t)) {
        rows.set(t.id, t);
        if (answers.lethal(t.id, rows)) { t = rows.get(t.id)!; const again = throughShield(t, hpDamage, now); t = again.target; absorbed += again.absorbed; hpDamage = wardedDamage(t, hpDamage - again.absorbed); }
      }
      t = hurt(t, hpDamage);
      threat = t.threat ? threatOfHit(struck, dealt, R) * u.sheet.threat : 0;
      t = threatened(t, u.id, threat);
      const s = staggered(t, hpDamage, now, R);
      t = s.target; fill = s.fill; stag = s.staggered;
    }
    let channelBroken = false;
    const lands = end.avoid === 'caught';
    // a hide that starts out of sight is refused on a body a foe that is up watches, whoever casts it (land.ts `landStatus`)
    const seen = hiding && watched(t, { rows: [...rows.values()], grid, fog }, R);
    const landed = lands ? landOps(a, u, t, dice, seen, now, R) : { target: t, keys: [], breaks: false, threat: 0, fill: 0, staggers: false, fired: [], detonated: [] };
    if (channelBreaks(t, hpDamage, landed.breaks, now)) { channelBroken = true; }
    t = channelBroken ? broken(landed.target, R) : landed.target;
    rows.set(t.id, t);
    if (lands) for (const op of a.ops) if (op.op === 'move') {
      const m = landMove(rows, op, user.id, t.id, null, true, now, R);
      if (m?.fired) landed.fired.push(m.fired);
      t = rows.get(t.id)!;
    }
    if (t.id !== user.id) lost += Math.max(0, before - rowHp(t));
    outcomes.push({
      target: t.id, avoid: end.avoid, to: end.to, crit: isCrit, raw, dealt, absorbed, type, statuses: landed.keys,
      threat: threat + landed.threat, stagger: fill + landed.fill, staggered: stag || landed.staggers, channelBroken, down: before > 0 && rowHp(t) === 0,
    });
    for (const f of landed.fired) bursts.push(landThreshold(rows, f, now, R));
    // a cure that sets a delayed effect off lands its end at once (kits table 2.2)
    for (const d of landed.detonated) {
      const e = landEnd(rows, t.id, d, now, R);
      bursts.push({
        bearer: t.id, key: d.key, label: d.def.label,
        landed: [
          { target: t.id, dealt: e.dealt },
          ...(e.sourceHealed && d.source.id !== null ? [{ target: d.source.id, dealt: 0, healed: e.sourceHealed }] : []),
        ],
      });
    }
  }
  if (rollsReaction(a)) spendEdges(a, rows.get(user.id)!, [...hit, ...ring].map(b => rows.get(b.id)!), rows, now, R);
  const shoved = [...swapped(a, user.id, outcomes, rows, grid, R), ...pushed(a, user.id, at, outcomes, rows, grid, R)];
  const stole = drained(rows.get(user.id)!, lost, now, R);
  rows.set(user.id, userTime(a, stole.user, now, rolls.refund, R));
  return { ok: true, outcomes, bodies: bodies.map(b => rows.get(b.id)!), bursts, shoved, reacted: f.reacted, drained: stole.healed, stored: stole.stored };
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
 * Rule 5b: whether `user` (and `target`, when checked up front for an ally swap or at swap time) may stand and swap on
 * `grid`. A rooted user gives `'rooted'`; a rooted target or unwalkable tile gives `'blocked'`.
 */
function swapStands(user: Body, target: Body | null, grid: Grid): 'rooted' | 'blocked' | null {
  if (rooted(user)) return 'rooted';
  if (!TERRAIN[terrain(grid, user.place.x, user.place.y)].walk) return 'blocked';
  if (target && (rooted(target) || !TERRAIN[terrain(grid, target.place.x, target.place.y)].walk)) return 'blocked';
  return null;
}
/**
 * A swap (kits design 8.3.5): the user and the body it aimed at exchange places when each may stand on the other's;
 * against a foe only when the use caught it (a dodge or a resist is no swap). Neither moves if either is rooted.
 */
function swapped(a: Ability, userId: CombatantId, outcomes: readonly Outcome[], rows: Map<CombatantId, Body>, grid: Grid, R: ResolveRules): CombatantId[] {
  if (a.move?.kind !== 'swap') return [];
  const o = outcomes.find(x => x.target !== userId && x.avoid === 'caught'), u = rows.get(userId), t = o && rows.get(o.target);
  if (!u || !t || swapStands(u, t, grid) !== null) return [];
  rows.set(u.id, { ...u, place: t.place });
  rows.set(t.id, moveBreaks({ ...t, place: u.place }, R));
  return [t.id];
}
/** A body moved by another breaks its channel, as one that moves itself drops it (kits design 8.3.4). */
const moveBreaks = (b: Body, R: ResolveRules): Body => (b.channel?.state === 'holding' ? broken(b, R) : b);
/**
 * Rule 18c (kits design 8.3, table 8.9.3): each shove of the ability moves each target it caught its `tiles` (0 for a
 * rooted body; a boss as far as any, the owner, Nov 21), along `shovePath` from its anchor: the user or the aim.
 * A push moves the farthest first, a pull the nearest; then by `y`, then `x`, so a crowd packs. A stop deals nothing.
 */
function pushed(a: Ability, userId: CombatantId, at: Place, outcomes: readonly Outcome[], rows: Map<CombatantId, Body>, grid: Grid, R: ResolveRules): CombatantId[] {
  const moved: CombatantId[] = [];
  for (const op of a.ops) {
    if (op.op !== 'shove') continue;
    const anchor = op.from === 'user' ? rows.get(userId)!.place : at;
    const caught = outcomes.filter(o => o.avoid === 'caught' && o.target !== userId).map(o => rows.get(o.target)!).filter(b => b && isUp(b))
      .sort((p, q) => (op.dir === 'away' ? dist(anchor, q.place) - dist(anchor, p.place) : dist(anchor, p.place) - dist(anchor, q.place)) || p.place.y - q.place.y || p.place.x - q.place.x);
    for (const c of caught) {
      const t = rows.get(c.id)!, k = rooted(t) ? 0 : op.tiles;
      const others = [...rows.values()].filter(b => b.id !== t.id && alive(b)).map(b => b.place);
      const path = shovePath(anchor, t.place, op.dir, k, grid, others);
      if (!path.length) continue;
      rows.set(t.id, moveBreaks({ ...t, place: path[path.length - 1]! }, R));
      if (!moved.includes(t.id)) moved.push(t.id);
    }
  }
  return moved;
}
