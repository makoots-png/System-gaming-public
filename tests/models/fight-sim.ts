// The balance player of the reworked fight (src/core/combat/fight.ts): the five builds of design section 2 at E, C and S,
// the abilities each archetype uses (the built-ins of src/core/registry/abilities.ts where one exists, else made by
// `abilityOf`), one plain policy per archetype and per monster, and
// `playFight`, which plays the fight on the engine's loop (src/core/combat/play.ts) with seeded dice until it ends or a time cap. No rule is worked out
// here: a use is the reducer's, and the counters read `resolve` (pure) on the same inputs the reducer gets. The rows
// that play these fights are tests/fight-sim.test.ts; what they found is docs/agent-handoff/rw/sim-log.md.
//
// A class is a row of `BUILDS`; a monster archetype's attack is its built-in (`MONSTER_ABILITY`). A policy is a pure function from the
// fight and its own row to a choice, written as a sensible player plays it, not as an optimizer.
import { RANKS, RULES } from '../../src/core/rules.ts';
import type { BonusKey, Rank, Rules } from '../../src/core/rules.ts';
import { baseStats } from '../../src/core/stats.ts';
import type { StatKey, Stats } from '../../src/core/stats.ts';
import { TIER_BUDGET } from '../../src/core/registry/paths.ts';
import { kitGear, NO_TWEAK, pointsAt, split } from '../../src/core/hunter/derive.ts';
import type { Archetype as MonsterArchetype, SheetBasis, Kit, MonsterKind, MonsterTrait } from '../../src/core/hunter/derive.ts';
import { diceOf, parseFormula } from '../../src/core/formula.ts';
import { dist, inShape, openGrid, place, reachable, straightCost, tiles } from '../../src/core/combat/space.ts';
import type { Place } from '../../src/core/combat/space.ts';
import { interval, paceCost, tick, walkCost } from '../../src/core/combat/timeline.ts';
import type { Tick } from '../../src/core/combat/timeline.ts';
import { abilityId, combatantId } from '../../src/core/combat/ability-types.ts';
import type { Ability } from '../../src/core/combat/ability-types.ts';
import { modified, statusKey } from '../../src/core/combat/effect-ops.ts';
import type { Body, Op, Origin, StackDef, Status, Tiers, UseOp } from '../../src/core/combat/effect-ops.ts';
import { formulaOf, abilityOf } from '../../src/core/registry/ability-kinds.ts';
import { ARCHETYPE_ATTACKS, ATTACK_ID, SKILL_ABILITIES, weaponAttack } from '../../src/core/registry/abilities.ts';
import type { BuiltInSkill } from '../../src/core/registry/abilities.ts';
import { STARTER_GEAR } from '../../src/core/registry/items.ts';
import type { Rarity } from '../../src/core/registry/items.ts';
import { itemSpend, middleBudget } from '../../src/core/registry/item-budget.ts';
import type { AbilityInput } from '../../src/core/registry/ability-kinds.ts';
import { onCooldown, payCost } from '../../src/core/combat/charge.ts';
import { inRange, resolve, taunted } from '../../src/core/combat/resolve.ts';
import type { Aim, Rolls } from '../../src/core/combat/resolve.ts';
import { fightId, reduce, runningState } from '../../src/core/combat/fight.ts';
import type { Ctx, Effect, Ended, Fight, Fudge, FudgeSet, NewRow, Running } from '../../src/core/combat/fight.ts';
import { CAP_ROUNDS, playBegin, playOver, playStep } from '../../src/core/combat/play.ts';
import type { Limits, Play } from '../../src/core/combat/play.ts';
import { answerChoice, beatUses, keptOut, sensible } from '../../src/core/combat/policy.ts';
import type { Policy as TurnPolicy, TurnChoice } from '../../src/core/combat/policy.ts';
import { ANSWERS, enraged, scriptOf } from '../../src/core/combat/mythic.ts';
import type { Answer } from '../../src/core/combat/mythic.ts';
import type { MythicStanding } from '../../src/core/combat/mythic-types.ts';
import { monsterRows } from '../../src/core/combat/rows.ts';
import type { RowMonster } from '../../src/core/combat/rows.ts';
import { seedMonsters } from '../../src/core/registry/monsters.ts';
import type { MythicScriptId } from '../../src/core/registry/mythics.ts';
import { rng } from './fight-play.ts';
import { rowHp } from '../../src/core/combat/row-hp.ts';

export { rng };
export type SimRank = 'E' | 'C' | 'S';
export const SIM_RANKS: readonly SimRank[] = ['E', 'C', 'S'];
const tierOf = (rank: Rank): number => RANKS.indexOf(rank);

// ── abilities, each from `abilityOf` with its kind's defaults ──
const formula = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
const make = (kind: Ability['kind'], name: string, o: Omit<AbilityInput, 'id' | 'name'>, R: Rules): Ability =>
  abilityOf(kind, { id: abilityId(name.toLowerCase()), name, ...o }, R);

/** Phase 4's Burning curve by the source's rank, E to S (docs/agent-handoff/p4/design.md): about half a same-rank hit a round. */
const BURNING: Tiers<string> = ['1d6', '2d6', '3d8', '4d10', '5d12', '7d12'];
const status = (key: string, rounds: number, op: Op, R: Rules): UseOp =>
  ({ op: 'applyStatus', key: statusKey(key), def: { label: key, desc: '', ops: [op] }, duration: tick(rounds * R.fight.round) });

/**
 * The built-in abilities a build takes (src/core/registry/abilities.ts): the weapon's attack, as `hunterAbilities` in
 * src/core/combat/rows.ts gives it, and the built-in skills of the starter hunter of its kind (src/views/starter.js).
 */
export function builtIns(R: Rules = RULES) {
  const skill = (name: BuiltInSkill): Ability => { const a = SKILL_ABILITIES[name](R); if (!a) throw new Error(`${name} has no ability`); return a; };
  return {
    /** The Ranger's Hunting Bow: a quick arrow, 0.7 of a standard hit, `0.7 * (1d8 + phys)`. */
    bow: weaponAttack(STARTER_GEAR.huntingBow, R),
    /** No weapon: the strike kind's own `1d8 + phys`, the Tanker's attack (a tower shield and no weapon). */
    strike: weaponAttack(null, R),
    /** The Ranger's skill: a quick arrow of `0.7 * (1d6 + phys)` with a 2-round cooldown, never better than the bow. */
    markedShot: skill('Marked Shot'),
    /** The Tanker's skill: a shield of `1.5 * sup` on an ally in range 6, cooldown 3 rounds. */
    shieldWall: skill('Shield Wall'),
    /** The Mage's skill: a curse of `2d6 + mag`, no travel, the target's Will resists it for half. */
    arcBolt: skill('Arc Bolt'),
    /** A Strength build's skill: a standard strike of `2d6 + phys`, cooldown 3 rounds. */
    mutilation: skill('Mutilation'),
  };
}
type BuiltIns = ReturnType<typeof builtIns>;

/** What a build may use that no built-in gives: the blast, the channel, the taunt, a Presence build's bolt, Burning. */
export function abilities(R: Rules = RULES) {
  return {
    /** A magical bolt that does not travel, `1d8 + mag` (the caster archetype's Curse): the support's attack. */
    bolt: make('curse', 'Bolt', {}, R),
    /** The cannon's mana blast: heavy, a radius with a ring, a long wind-up a fast body steps out of. */
    blast: make('blast', 'Blast', {}, R),
    /** The cannon's channel: a bolt that grows 1.45 times a turn held, to 6.4 times at 5. */
    focus: make('curse', 'Focus', { ticks: { channel: 'exponential' } }, R),
    /** The tank's taunt: sure to land, forces the target for `tauntRounds` and bursts its threat to the lead. */
    taunt: make('curse', 'Taunt', { effect: null, delivery: { kind: 'sure' }, ops: [status('taunted', R.fight.tauntRounds, { op: 'taunt' }, R)] }, R),
    /**
     * A party's control (balance plan row P3): a curse with no damage that puts the built-in Stunned (a hold) on its target
     * for a round, the target's Tenacity shortening it, back every `itemBudget.cooldownRounds` (3, the middle of the
     * built-in skills' cooldowns). No built-in skill holds, so this is the plain control a kit maker would start from.
     */
    stun: ((a: Ability): Ability => ({ ...a, cost: { ...a.cost, cooldown: tick(R.itemBudget.cooldownRounds * R.fight.round) } }))(
      make('curse', 'Stun', { effect: null, ops: [{ op: 'applyStatus', key: statusKey('stunned'), def: R.conditions.stunned, duration: tick(R.fight.round) }] }, R)),
    /** The status build's signature: Burning for 3 rounds, per-round magical damage by the user's rank, no direct damage. */
    ignite: make('curse', 'Ignite', {
      effect: null, ops: [status('burning', 3, { op: 'damage', type: 'magical', amount: BURNING.map(formula) as unknown as Tiers<ReturnType<typeof formula>> }, R)],
    }, R),
    ...kitAbilities(R),
  };
}

// ── the three example kits (kits design section 3, table 3.6, and 5.2) ──
// Each kit is its body's plain build with one ability in place of the one it plays most: the cannon's Arc Bolt
// (`2d6 + mag`) for the two casters, the bruiser's weaponless strike (`1d8 + phys`) for Pain. Its numbers are the
// design's shares of that ability (`RULES.fight.kit.examples`), so a kit and its plain build spend the same pace.
const resonance = (R: Rules): StackDef => ({
  label: 'Resonance', desc: 'Blood that answers its caller.', ops: [], stack: { cap: 3, leave: { kind: 'never' }, keep: 'fight', threshold: {
    at: { kind: 'count', n: 3 }, to: { kind: 'bearer' }, then: 'spend',
    // its execute scaler at the suggestion (design 8.0): from half HP, up to +100%, the base cut to 0.8
    ops: [{ op: 'damage', type: 'magical', when: 'use', amount: formula(`(2d6 + mag) * ${R.fight.kit.examples.blood.burst * R.fight.kit.examples.blood.base} * (1 + 1 * max(0, min(1, (target.missing - 0.5) / 0.5)))`) }],
  } },
});
const mark = (R: Rules): StackDef => ({
  label: 'Signature', desc: 'The mark of the visionary.', ops: [], stack: { cap: 2, leave: { kind: 'never' }, keep: 'fight', threshold: {
    at: { kind: 'count', n: 2 }, to: { kind: 'area', radius: tiles(2), on: 'allies' }, then: 'spend',
    ops: [{ op: 'damage', type: 'magical', when: 'use', amount: formula(`${R.fight.kit.examples.mark.burst} * (2d6 + mag)`) }],
  } },
});
/** Einar's Pain: a fight's count to 10 that never leaves. */
export const PAIN = (): StackDef => ({ label: 'Pain', desc: '', ops: [], stack: { cap: 10, leave: { kind: 'never' }, keep: 'fight', threshold: null } });
/** Pain is Power, Einar's worn status: each hit its bearer deals adds a Pain. */
export const painIsPower = (): Status => ({
  key: statusKey('pain-is-power'), def: { label: 'Pain is Power', desc: '', ops: [], triggers: [{ on: 'hitDealt', tag: null, to: 'self', limit: { kind: 'each' },
    ops: [{ op: 'applyStatus', key: statusKey('pain'), def: PAIN(), duration: null }] }] },
  source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0),
});
function kitAbilities(R: Rules) {
  const K = R.fight.kit.examples;
  return {
    /** Glas's Bloodletting: a curse at a share of Arc Bolt that adds a Resonance when it is not resisted (a stack lasts 2 rounds). */
    bloodletting: make('curse', 'Bloodletting', { effect: { type: 'magical', by: 'hand', formula: formula(`${K.blood.share} * (2d6 + mag)`) },
      ops: [{ op: 'applyStatus', key: statusKey('resonance'), def: resonance(R), duration: tick(2 * R.fight.round) }] }, R),
    /** Hwei's Disaster Stroke: a curse at a share of Arc Bolt that adds a mark; two burst on every foe within 2. */
    stroke: make('curse', 'Disaster-Stroke', { effect: { type: 'magical', by: 'hand', formula: formula(`${K.mark.share} * (2d6 + mag)`) },
      ops: [{ op: 'applyStatus', key: statusKey('signature'), def: mark(R), duration: tick(2 * R.fight.round) }] }, R),
    /** Einar's Violence: a strike that spends all Pain, `1 + perStack` a Pain more. */
    violence: { ...make('strike', 'Violence', { effect: { type: 'physical', by: 'hand', formula: formula(`(1d8 + phys) * (1 + ${K.pain.perStack} * spent)`) } }, R),
      prices: [{ kind: 'stacks', key: statusKey('pain'), from: 'self', take: { kind: 'all' } }] } as Ability,
    /** A summoner's Sprite: a skirmisher for `summonRounds`, once a fight. */
    sprite: { ...make('support', 'Call-Sprite', { aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null }, R), gates: [{ kind: 'uses', per: 'fight', n: 1 }],
      summon: { name: 'Sprite', archetype: 'skirmisher', rounds: R.fight.kit.summonRounds, statuses: [] } } as Ability,
  };
}
type Kit5 = ReturnType<typeof abilities>;

/**
 * Wave 2's blocks the simulation weighs (kits design 8.10): Parry, a quick reaction before a strike with the rules' guard;
 * Sustained through Suffering, a strike with an extra action; Transfer, an ally's standard action given (`hasten 1`); a
 * worn attack edge (Bow Expert: the target keeps the lower d20, never spent); a damage-taken curse kept on a foe.
 */
export function wave2(R: Rules = RULES) {
  const quick = make('shot', 'q', {}, R).cost;
  return {
    parry: { ...make('strike', 'Parry', { effect: null }, R), cost: { ...quick, fatigue: 0 }, react: { when: 'before', reach: tiles(0) }, ops: [{ op: 'guard', share: R.fight.kit.parry }] } as Ability,
    surge: { ...make('strike', 'Surge', {}, R), ops: [{ op: 'extra' }] } as Ability,
    transfer: { ...make('support', 'Transfer', { effect: null }, R), ops: [{ op: 'hasten', share: 1 }] } as Ability,
    bowExpert: (): Status => ({ key: statusKey('bow-expert'), def: { label: 'Bow Expert', desc: '', ops: [{ op: 'edge', side: 'attack', keep: 'better', tag: null, spend: false }] },
      source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) }),
    exposed: (pct: number): Status => ({ key: statusKey('exposed'), def: { label: 'Exposed', desc: '', ops: [{ op: 'share', on: 'taken', pct }] },
      source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) }),
  };
}

// ── the builds (design 2.2's five, and the status build the lead asked for) ──
export type Archetype = 'speed' | 'tank' | 'cannon' | 'bruiser' | 'support' | 'status' | KitBuild;
/** The three example kits of kits design table 3.6, and a summoner (table 3.2's last row). */
export type KitBuild = 'blood' | 'mark' | 'pain' | 'summoner';
export const KIT_BUILDS: readonly KitBuild[] = ['blood', 'mark', 'pain', 'summoner'];
/** Each kit's plain build: the body it is, with the ability it replaces. */
export const PLAIN_OF: { readonly [K in KitBuild]: Archetype } = { blood: 'cannon', mark: 'cannon', pain: 'bruiser', summoner: 'cannon' };
type BuildRow = {
  readonly main: StatKey; readonly second: StatKey; readonly kit: Kit;
  /** The weapon's attack first, then the built-in skills, then what no built-in gives. */
  readonly uses: (b: BuiltIns, k: Kit5) => Ability[];
  readonly policy: Policy;
  /** The statuses it comes into a fight with (a kit's worn status). */
  readonly worn?: () => Status[];
};

/** Every perk point a body of `rank` has had, all on its main stat (the paper's builds). */
const perkPoints = (rank: Rank): number => TIER_BUDGET.slice(0, tierOf(rank) + 1).reduce((s, v) => s + v, 0);
/** The stats of a build at `rank`: its points split 2:1 (derive.ts `split`), every perk on the main stat. */
export function statsOf(main: StatKey, second: StatKey, rank: Rank, R: Rules = RULES): Stats {
  const st = split(main, second, pointsAt(R.rankLevels[rank], R), R);
  return { ...baseStats(R.fight), ...st, [main]: st[main] + perkPoints(rank) };
}
/** A build at `rank` as a sheet reads it: its stats (`statsOf`) in its kit (`kitGear`), as a monster wears its own. */
export const buildOf = (a: Archetype, rank: Rank, R: Rules = RULES): SheetBasis =>
  ({ stats: statsOf(BUILDS[a].main, BUILDS[a].second, rank, R), level: R.rankLevels[rank], gear: kitGear(BUILDS[a].kit, R), perks: {} });

// ── what a policy chooses: the loop's choice (src/core/combat/policy.ts) ──
export type Choice = TurnChoice;
/** A policy: what this row does on its turn. `plan` is the fight's setup (whether and when the cannon channels), `R` its rules. */
export type Policy = (f: Running, me: Body, plan: Plan, R: Rules) => Choice;
/**
 * When the cannon begins its one channel of a fight: never, on its first turn the boss aims at someone else (a careful
 * player), or on its first turn the boss aims at it (a channel begun under fire, the case `hold` is for).
 */
export type Plan = { readonly channel: 'none' | 'safe' | 'aimed' };

const up = (b: Body): boolean => rowHp(b) > 0;
const foesOf = (f: Running, me: Body): Body[] => f.rows.filter(r => r.side !== me.side && up(r));
const alliesOf = (f: Running, me: Body): Body[] => f.rows.filter(r => r.side === me.side && r.id !== me.id && up(r));
const nearest = (me: Body, list: readonly Body[]): Body | undefined =>
  [...list].sort((a, b) => dist(me.place, a.place) - dist(me.place, b.place) || rowHp(a) - rowHp(b) || (a.id < b.id ? -1 : 1))[0];
const weakest = (list: readonly Body[]): Body | undefined => [...list].sort((a, b) => rowHp(a) - rowHp(b) || (a.id < b.id ? -1 : 1))[0];
const own = (me: Body, name: string): Ability => {
  const a = me.abilities.find(x => x.id === name);
  if (!a) throw new Error(`${me.name} has no ${name}`);
  return a;
};
/** Whether `me` may use `a` at `at` now, by the rules' own checks (taunt, cooldown, cost, range). */
export function usable(f: Running, me: Body, a: Ability, at: Place): boolean {
  return !taunted(a, me, f.rows, at, f.grid, f.now) && !onCooldown(a, me, f.now) && payCost(a, me) !== null && inRange(a, me, at);
}
/** The taunter `me` must aim at, if a taunt holds it. */
function taunter(f: Running, me: Body): Body | undefined {
  const s = me.statuses.find(x => (x.until === null || x.until > f.now) && x.def.ops.some(o => o.op === 'taunt') && x.source.id !== null);
  const src = s && f.rows.find(r => r.id === s.source.id);
  return src && up(src) ? src : undefined;
}
/** A step toward `target`: the tile within a stride that is nearest it, fewest steps on a tie; null when none is nearer. */
function toward(f: Running, me: Body, target: Body): Choice {
  const others = f.rows.filter(r => r.id !== me.id && (up(r) || r.kind === 'hunter')).map(r => r.place);
  const now = dist(me.place, target.place);
  const best = reachable(me.place, me.sheet.stride, f.grid, others)
    .filter(r => r.steps > 0)
    .sort((a, b) => dist(a.place, target.place) - dist(b.place, target.place) || a.steps - b.steps)[0];
  return best && dist(best.place, target.place) < now ? { type: 'move', to: best.place } : { type: 'pass' };
}
/**
 * A charge at `target` (design 4.6), when it is the quicker way in: the tile within the whole move, on a clear straight
 * line, that puts `target` within `a`'s range, taken only when the dash costs less time than walking those tiles and
 * its fatigue leaves the body under its capacity. Null when no such charge exists.
 */
function charge(f: Running, me: Body, a: Ability, target: Body, rules: Rules): Choice | null {
  const R = rules.fight, far = Math.floor(me.sheet.move);
  if (me.fatigue + R.dashFatigue >= me.sheet.fatigueMax) return null;
  const others = f.rows.filter(r => r.id !== me.id && (up(r) || r.kind === 'hunter')).map(r => r.place);
  let best: { to: Place; steps: number } | null = null;
  for (let y = me.place.y - far; y <= me.place.y + far; y++) for (let x = me.place.x - far; x <= me.place.x + far; x++) {
    const to = place(x, y), steps = x === me.place.x && y === me.place.y ? null : straightCost(me.place, to, f.grid, others);
    if (steps === null || steps > far || dist(to, target.place) > a.range) continue;
    if (!best || steps < best.steps) best = { to, steps };
  }
  return best && R.dashTime < walkCost(tiles(best.steps), R) ? { type: 'move', to: best.to, dash: true } : null;
}
/** Use `a` on `target` if the rules allow it now, else walk toward it. */
const attackOr = (f: Running, me: Body, a: Ability, target: Body): Choice =>
  usable(f, me, a, target.place) ? { type: 'act', ability: a, aim: target.id } : toward(f, me, target);

/** A monster's suggested target (design 4.2): the highest threat among hunters up, else the nearest. */
export function suggested(f: Running, m: Body): Body | undefined {
  const party = foesOf(f, m);
  const forced = taunter(f, m);
  if (forced) return forced;
  const scored = party.map(p => ({ p, t: m.threat?.[p.id] ?? 0 })).filter(x => x.t > 0).sort((a, b) => b.t - a.t || (a.p.id < b.p.id ? -1 : 1));
  return scored[0]?.p ?? nearest(m, party);
}

// ── the policies ──
/** Speed: picks off the weakest foe in bow range; walks in when none is. Marked Shot is never the better arrow. */
const speedPolicy: Policy = (f, me) => {
  const shot = own(me, ATTACK_ID);
  const forced = taunter(f, me);
  const target = forced ?? weakest(foesOf(f, me).filter(t => usable(f, me, shot, t.place))) ?? nearest(me, foesOf(f, me))!;
  return attackOr(f, me, shot, target);
};
/**
 * Tank: taunts a monster that is aiming at someone else; otherwise strikes the nearest foe, charging or walking up to it.
 * Shield Wall is never worth a turn: its shield is `1.5 * sup`, 9 at Presence 10, half a strike.
 */
const tankPolicy: Policy = (f, me, _plan, R) => {
  const taunt = own(me, 'taunt'), strike = own(me, ATTACK_ID);
  const pull = foesOf(f, me).filter(m => m.threat && suggested(f, m)?.id !== me.id && usable(f, me, taunt, m.place))
    .sort((a, b) => rowHp(b) - rowHp(a) || (a.id < b.id ? -1 : 1))[0];
  if (pull) return { type: 'act', ability: taunt, aim: pull.id };
  const target = taunter(f, me) ?? nearest(me, foesOf(f, me))!;
  return usable(f, me, strike, target.place) ? { type: 'act', ability: strike, aim: target.id } : charge(f, me, strike, target, R) ?? toward(f, me, target);
};
/**
 * The tank with a control (row P3): stuns the foe with the most HP when the stun is ready and that foe's turn comes
 * before the tank's next one; else the tank's play, its taunt included. The stun goes before the taunt because a
 * stun left ready is control lost (sim-log.md, balance unit 3: taunting first left it idle on 1.4 turns a fight, and
 * the boss lost 0.032 of its time at C); it waits while the foe's turn is past the tank's next, as a hold is a floor
 * on that turn and moves a nearer one further.
 */
export const controlPolicy: Policy = (f, me, plan, R) => {
  const stun = me.abilities.find(a => a.id === 'stun');
  const big = [...foesOf(f, me)].sort((a, b) => rowHp(b) - rowHp(a) || (a.id < b.id ? -1 : 1))[0];
  const mine = f.now + interval(me.speed, paceCost('standard', R.fight), R.fight);
  return stun && big && big.at < mine && usable(f, me, stun, big.place) ? { type: 'act', ability: stun, aim: big.id } : tankPolicy(f, me, plan, R);
};
/** Bruiser: Mutilation on the nearest foe when it is ready, else a strike, walking up to it. */
const bruiserPolicy: Policy = (f, me) => {
  const target = taunter(f, me) ?? nearest(me, foesOf(f, me))!, mut = own(me, 'mutilation');
  return attackOr(f, me, usable(f, me, mut, target.place) ? mut : own(me, ATTACK_ID), target);
};
/** Whether a blast at `at` would catch an ally (its radius and ring). */
const hitsAlly = (f: Running, me: Body, a: Ability, at: Place): boolean => {
  const { hit, ring } = inShape(a.shape, me.place, at, f.grid, f.rows.filter(r => r.side === me.side && (up(r) || r.kind === 'hunter')));
  return hit.length + ring.length > 0;
};
/**
 * Cannon: in a fight planned around a channel, begins Focus on the biggest foe on the first turn the plan's moment comes
 * (that foe aiming at someone else, or at the cannon) and bolts until then; releases it when full. Otherwise blasts a
 * foe while it has the mana and no ally is near the blast, the foe that puts the most foes in it; else bolts the nearest.
 */
const cannonPolicy: Policy = (f, me, plan, R) => castWith('arc-bolt')(f, me, plan, R);
/** The cannon's play with `bolt` as the bolt it casts between blasts: Arc Bolt, or a kit's curse in its place. */
const castWith = (boltId: string): Policy => (f, me, plan, R) => {
  if (me.channel?.state === 'holding') {
    const max = own(me, me.channel.ability).channel?.max ?? R.fight.channelMax;
    return me.channel.charge >= max ? { type: 'release' } : { type: 'pass' };
  }
  const foes = foesOf(f, me);
  const focus = own(me, 'focus'), blast = own(me, 'blast'), bolt = own(me, boltId);
  const big = [...foes].sort((a, b) => rowHp(b) - rowHp(a))[0]!;
  if (plan.channel !== 'none' && !me.channel && usable(f, me, focus, big.place)) {
    const onMe = suggested(f, big)?.id === me.id;
    if (onMe === (plan.channel === 'aimed')) return { type: 'act', ability: focus, aim: big.id };
    return attackOr(f, me, bolt, nearest(me, foes)!);
  }
  const forced = taunter(f, me);
  const blasts = (forced ? [forced] : foes).filter(t => usable(f, me, blast, t.place) && !hitsAlly(f, me, blast, t.place))
    .map(t => ({ t, n: inShape(blast.shape, me.place, t.place, f.grid, foes).hit.length }))
    .sort((a, b) => b.n - a.n || rowHp(a.t) - rowHp(b.t));
  if (blasts[0]) return { type: 'act', ability: blast, aim: blasts[0].t.place };
  return attackOr(f, me, bolt, forced ?? nearest(me, foes)!);
};
/** Support: shields the most hurt ally under 70% with no shield; otherwise bolts the nearest foe. */
const supportPolicy: Policy = (f, me) => {
  const shield = own(me, 'shield-wall');
  const hurt = [me, ...alliesOf(f, me)].filter(a => rowHp(a) < 0.7 * a.sheet.hpMax && !(a.shield && a.shield.until > f.now) && usable(f, me, shield, a.place))
    .sort((a, b) => rowHp(a) / a.sheet.hpMax - rowHp(b) / b.sheet.hpMax)[0];
  if (hurt) return { type: 'act', ability: shield, aim: hurt.id };
  return attackOr(f, me, own(me, 'bolt'), taunter(f, me) ?? nearest(me, foesOf(f, me))!);
};
/** Status build: keeps Burning on the nearest foe (re-applies it when under a round is left); bolts in between. */
const statusPolicy: Policy = (f, me, _plan, R) => {
  const target = taunter(f, me) ?? nearest(me, foesOf(f, me))!;
  const burning = target.statuses.find(s => s.key === statusKey('burning'));
  const ignite = own(me, 'ignite');
  if ((!burning || (burning.until ?? Infinity) - f.now < R.fight.round) && usable(f, me, ignite, target.place)) return { type: 'act', ability: ignite, aim: target.id };
  return attackOr(f, me, own(me, 'arc-bolt'), target);
};
/** A monster: its archetype's attack on its suggested target, walking up when it is out of range. A summon plays so too. */
/**
 * Whether `a` aimed at `target` reaches it: a line that does not pierce stops at the first body lying in it, and a dead
 * hunter still lies on the map (land.ts `alive`), so a shot at a hunter behind a fallen one hits the fallen one.
 */
const clearLine = (f: Running, me: Body, a: Ability, target: Body): boolean =>
  a.shape.kind !== 'line' || a.shape.pierce || inShape(a.shape, me.place, target.place, f.grid, f.rows.filter(r => r.id !== me.id && (up(r) || r.kind === 'hunter'))).hit[0]?.id === target.id;
/** A monster: its one attack on its suggested target, walking toward it when out of range or when a fallen hunter stands in its line. */
const monsterPolicy: Policy = (f, me) => {
  const a = me.abilities[0]!, target = suggested(f, me)!;
  return clearLine(f, me, a, target) ? attackOr(f, me, a, target) : toward(f, me, target);
};
/** Pain: the bruiser's play, with Violence in place of the strike once it holds `spendAt` Pain (design 3.6: at 5). */
const painPolicy: Policy = (f, me, _plan, R) => {
  const target = taunter(f, me) ?? nearest(me, foesOf(f, me))!, mut = own(me, 'mutilation'), violence = own(me, 'violence');
  const pain = me.statuses.find(s => s.key === statusKey('pain'))?.stacks ?? 0;
  const a = usable(f, me, mut, target.place) ? mut : pain >= R.fight.kit.examples.pain.spendAt ? violence : own(me, ATTACK_ID);
  return attackOr(f, me, a, target);
};
/** A summoner: the cannon's play, calling its Sprite on its first turn it may. */
const summonerPolicy: Policy = (f, me, plan, R) => {
  const call = own(me, 'call-sprite');
  return usable(f, me, call, me.place) && !(me.used?.[call.id]) ? { type: 'act', ability: call, aim: me.id } : cannonPolicy(f, me, plan, R);
};

/** The bruiser's play, with Surge (an extra action) whenever its round of fight time allows one (kits design 8.6.1). */
export const surgePolicy: Policy = (f, me, plan, R) => {
  const surge = me.abilities.find(a => a.id === 'surge'), target = taunter(f, me) ?? nearest(me, foesOf(f, me))!;
  const round = Math.floor(f.now / R.fight.round), taken = me.extras?.round === round ? me.extras.n : 0;
  if (surge && taken < R.fight.kit.extraPerRound && usable(f, me, surge, target.place)) return { type: 'act', ability: surge, aim: target.id };
  return bruiserPolicy(f, me, plan, R);
};
/**
 * The bruiser's play with both of 8.6's blocks: Surge whenever its round allows an extra action; else, when the cannon
 * has not been hastened since its turn, its standard action given to the cannon with Transfer (the party's best use of a
 * turn); else a bruiser's turn.
 */
export const turnsPolicy: Policy = (f, me, plan, R) => {
  const surge = me.abilities.find(a => a.id === 'surge'), t = me.abilities.find(a => a.id === 'transfer'), target = taunter(f, me) ?? nearest(me, foesOf(f, me))!;
  const round = Math.floor(f.now / R.fight.round), taken = me.extras?.round === round ? me.extras.n : 0, cannon = alliesOf(f, me).find(a => a.id === 'cannon');
  if (surge && taken < R.fight.kit.extraPerRound && usable(f, me, surge, target.place)) return { type: 'act', ability: surge, aim: target.id };
  if (t && cannon && !cannon.hastened && usable(f, me, t, cannon.place)) return { type: 'act', ability: t, aim: cannon.id };
  return bruiserPolicy(f, me, plan, R);
};

/**
 * The builds and what each holds: speed is the starter Ranger (Hunting Bow, Marked Shot), tank the Tanker (no weapon,
 * Shield Wall) with the design's taunt, cannon the Mage (no weapon, Arc Bolt) with the design's blast and channel, the
 * bruiser a Strength build with Mutilation, the support Shield Wall and a bolt, the status build Burning and Arc Bolt.
 */
export const BUILDS: { readonly [A in Archetype]: BuildRow } = {
  speed: { main: 'agi', second: 'str', kit: 'light', uses: b => [b.bow, b.markedShot], policy: speedPolicy },
  tank: { main: 'vit', second: 'str', kit: 'heavy', uses: (b, k) => [b.strike, b.shieldWall, k.taunt], policy: tankPolicy },
  cannon: { main: 'pow', second: 'ctl', kit: 'light', uses: (b, k) => [b.strike, b.arcBolt, k.blast, k.focus], policy: cannonPolicy },
  bruiser: { main: 'str', second: 'vit', kit: 'medium', uses: b => [b.strike, b.mutilation], policy: bruiserPolicy },
  support: { main: 'pre', second: 'dis', kit: 'light', uses: (b, k) => [b.strike, b.shieldWall, k.bolt], policy: supportPolicy },
  status: { main: 'pow', second: 'ctl', kit: 'light', uses: (b, k) => [b.strike, k.ignite, b.arcBolt], policy: statusPolicy },
  blood: { main: 'pow', second: 'ctl', kit: 'light', uses: (b, k) => [b.strike, k.bloodletting, k.blast, k.focus], policy: castWith('bloodletting') },
  mark: { main: 'pow', second: 'ctl', kit: 'light', uses: (b, k) => [b.strike, k.stroke, k.blast, k.focus], policy: castWith('disaster-stroke') },
  pain: { main: 'str', second: 'vit', kit: 'medium', uses: (b, k) => [b.strike, b.mutilation, k.violence], policy: painPolicy, worn: () => [painIsPower()] },
  summoner: { main: 'pow', second: 'ctl', kit: 'light', uses: (b, k) => [b.strike, b.arcBolt, k.blast, k.focus, k.sprite], policy: summonerPolicy },
};
/** A monster's attack by its archetype: the built-in Strike, Shot and Curse. */
export const MONSTER_ABILITY: { readonly [A in MonsterArchetype]: (R: Rules) => Ability } = ARCHETYPE_ATTACKS;

// ── rows ──
/** One combatant of a sim fight: who it is and how it plays. */
export type SimRow = { readonly row: NewRow; readonly policy: Policy };

function newRow(id: string, name: string, side: NewRow['side'], kind: NewRow['kind'], origin: Origin, tier: number, uses: Ability[], R: Rules): NewRow {
  const sheet = modified(origin, [], R).sheet;
  return {
    id: combatantId(id), name, side, kind, origin, tier, place: null, life: { at: 'up', hp: sheet.hpMax }, mana: sheet.manaMax, fatigue: 0, shield: null,
    stagger: null, channel: null, threat: kind === 'monster' ? {} : null, statuses: [], readyAt: {}, abilities: uses, intent: null, holder: null, xp: 0, mythic: null,
  } as NewRow;
}
export const hunter = (a: Archetype, rank: Rank, id: string = a, R: Rules = RULES): SimRow => hunterOn(a, rank, id, buildOf(a, rank, R), R);
/** A hunter of build `a` on the sheet basis `build`. */
function hunterOn(a: Archetype, rank: Rank, id: string, build: SheetBasis, R: Rules): SimRow {
  const origin: Origin = { kind: 'hunter', build };
  const row = newRow(id, id, 'party', 'hunter', origin, tierOf(rank), BUILDS[a].uses(builtIns(R), abilities(R)), R), worn = BUILDS[a].worn?.() ?? [];
  return { row: worn.length ? { ...row, statuses: worn } : row, policy: BUILDS[a].policy };
}

// ── penetration's fairness (balance plan section 9, rows P1 and P2) ──
/** How a build spends one item of its tier's middle budget: all on its main stat, on percent penetration, or on flat. */
export type PenSpend = 'main' | 'percent' | 'flat';
export const PEN_SPENDS: readonly PenSpend[] = ['main', 'percent', 'flat'];
/** The builds that spend it, each with the pair of the defence its damage meets: the armor pair, the resist pair. */
const PEN_PAIR = {
  bruiser: { percent: 'armorPen', flat: 'armorPenFlat' },
  cannon: { percent: 'resistPen', flat: 'resistPenFlat' },
} as const satisfies Record<string, Record<Exclude<PenSpend, 'main'>, BonusKey>>;
export type PenBuild = keyof typeof PEN_PAIR;
/** A bonus key's price in stat points at `rank`: what one point of it on an accessory of the rank's rarity spends (`itemSpend`). */
function priceAt(key: BonusKey, rank: Rank, R: Rules): number {
  const rar = (Object.keys(R.rarities) as Rarity[]).find(r => R.rarities[r].rank === rank)!;
  return itemSpend({ rar, type: 'accessory', slot: 'neck', dice: '', bonus: { [key]: READ_PRICE }, armor: 0, resist: 0 }, R)!.points / READ_PRICE;
}
/** Points of a key the price is read over, as item-budget.ts reads a key over 10. */
const READ_PRICE = 10;
/**
 * `a` holding one item of its tier's middle budget (`middleBudget`) spent all one way, at the item budget's own prices
 * (`itemSpend`, which weighs a penetration on a same-rank `itemBudget.penFoe`): its main stat, or the percent or the flat
 * penetration of the defence its damage meets. Unrounded, so the three spend the same points; the bonus is a perk.
 */
export function spending(a: PenBuild, rank: Rank, spend: PenSpend, id: string = a, R: Rules = RULES): SimRow {
  const budget = middleBudget(R, rank), key: BonusKey = spend === 'main' ? BUILDS[a].main : PEN_PAIR[a][spend];
  return hunterOn(a, rank, id, { ...buildOf(a, rank, R), perks: { [key]: budget / priceAt(key, rank, R) } }, R);
}
/**
 * A same-rank hit (design 4.3, the paper's `sameRankHit`): the bruiser's strike at its average dice on a same-rank monster
 * of `archetype` and `kind` (the body that holds the bar; a normal brute by default), worked out by `resolve` itself.
 */
export function sameRankHit(rank: Rank, R: Rules = RULES, archetype: MonsterArchetype = 'brute', kind: MonsterKind = 'normal', traits: readonly MonsterTrait[] = []): number {
  const at = (s: SimRow, p: Place): Body => { const m = modified(s.row.origin, [], R); return { ...s.row, ...m, place: p, speed: m.sheet.speed, at: tick(0), tie: 0 }; };
  const u = at(hunter('bruiser', rank, 'u', R), place(0, 0)), t = at({ row: unbarred(rank, archetype, kind, 't', R, traits), policy: monsterPolicy }, place(1, 0));
  const a = builtIns(R).strike, mean = diceOf(formulaOf(a, RULES)!).map(d => d.count * (d.sides + 1) / 2);
  const r = resolve(a, u, [u, t], t.id, openGrid(R.fight.grid.w, R.fight.grid.h), { dice: { [t.id]: mean }, react: { [t.id]: 20 } }, tick(0), R);
  if (!r.ok) throw new Error(r.reason);
  return r.outcomes[0]!.dealt;
}
/** A monster's row before its stagger bar, with `traits` (`RULES.fight.traits`) and optional difficulty `scale` on its body. */
function unbarred(rank: Rank, archetype: MonsterArchetype, kind: MonsterKind, id: string, R: Rules, traits: readonly MonsterTrait[] = [], scale?: { readonly hp: number; readonly dealt: number }): NewRow {
  const origin: Origin = {
    kind: 'monster', name: 'Monster', rank, archetype, monsterKind: kind,
    tweak: { ...NO_TWEAK, ...(scale ? { hp: scale.hp, dealt: scale.dealt } : {}), traits },
  };
  return newRow(id, id, 'foe', 'monster', origin, tierOf(rank), [MONSTER_ABILITY[archetype](R)], R);
}
/** A monster of the simulation; an elite's or a boss's stagger bar is its kind's number of same-rank hits on its own body. */
export function monster(rank: Rank, archetype: MonsterArchetype, kind: MonsterKind, id: string, R: Rules = RULES, traits: readonly MonsterTrait[] = [], scale?: { readonly hp: number; readonly dealt: number }): SimRow {
  const base = unbarred(rank, archetype, kind, id, R, traits, scale);
  const bar = R.fight.kinds[kind].stagger;
  const hit = bar > 0 ? sameRankHit(rank, R, archetype, kind, traits) : 0;
  return { row: bar > 0 ? { ...base, stagger: { fill: 0, max: bar * hit, hit } } : base, policy: monsterPolicy } as SimRow;
}

// ── a mythic that plays its script (notes-11-keystones.md, design B.8) ──
/** The rules a scripted mythic's row is made under, with `fight.mythic.scripts` on (the shipped default). */
export const scriptsOn = (R: Rules = RULES): Rules => ({ ...R, fight: { ...R.fight, mythic: { ...R.fight.mythic, scripts: true } } });
/** The rules with `fight.mythic.scripts` turned off explicitly, for tests of the off path. */
export const scriptsOff = (R: Rules = RULES): Rules => ({ ...R, fight: { ...R.fight, mythic: { ...R.fight.mythic, scripts: false } } });
/** `plain`'s body: today's mythic of row M1, a brute at S with its archetype's attack alone. */
const PLAIN_BODY: RowMonster = { name: 'A Mythic', rank: 'S', archetype: 'brute', kind: 'mythic', tweak: {}, abilities: [], statuses: [], script: 'plain' };
/**
 * The mythic of script `id` on its seed's body (`plain` on today's brute mythic), made as a fight makes it (rows.ts
 * `monsterRows`) under `R` with scripts on, which gives it its seed's HP times the script's `hp` (design B.8's one lever). Played on
 * `sensible`, which lands its omens and keeps its act beats to its phase's acts.
 */
export function scripted(id: MythicScriptId, R: Rules = scriptsOn()): SimRow {
  const seed: RowMonster | undefined = id === 'plain' ? PLAIN_BODY : seedMonsters(R).find(m => m.script === id);
  if (!seed) throw new Error(`no seed plays ${id}`);
  const row = monsterRows(seed, [combatantId('mythic')], R)[0]!;
  return { row, policy: mythicPolicy };
}
/**
 * A scripted mythic: its omen's move on its landing turn (policy.ts `sensible`); on an act beat row M1's monster play
 * (`monsterPolicy`) with the first damaging use its phase's acts name (policy.ts `beatUses`): it walks to its suggested
 * target and hits it. `sensible`'s own monster hits whoever is in reach when its target is not, and the mixed party won
 * 0.245 of 200 fights against M1's body on it, against 0.065 on `monsterPolicy` (sim-log.md, MY5).
 */
const mythicPolicy: Policy = (f, me, plan, R) => {
  if (me.mythic && me.mythic.at !== 'calm') return sensible(f, me, R);
  const target = suggested(f, me)!, uses = beatUses(me, me.abilities).filter(a => a.effect?.type === 'physical' || a.effect?.type === 'magical');
  const a = uses.find(x => usable(f, me, x, target.place) && clearLine(f, me, x, target)) ?? uses[0];
  return a ? (clearLine(f, me, a, target) ? attackOr(f, me, a, target) : toward(f, me, target)) : monsterPolicy(f, me, plan, R);
};
/**
 * `s` answering a standing omen first (policy.ts `answerChoice`, with the answers `kinds`), and kept out of its tiles
 * after (`keptOut`); with no omen standing it plays as it did.
 */
export const answering = (s: SimRow, kinds: readonly Answer[] = ANSWERS): SimRow => ({
  ...s, policy: (f, me, plan, R) => answerChoice(f, me, R, kinds) ?? keptOut(f, me, R, s.policy(f, me, plan, R), kinds),
});

// ── what a fight leaves for the rows to measure ──
/** One combatant's counts over a fight. Damage is after defence; `reduced` is what armor or resist took off. */
export type Tally = {
  turns: number; moves: number; passes: number; acts: Record<string, number>;
  /** Damage dealt to foes by each ability, a threshold's burst it set off counted with it. */
  byAct: Record<string, number>;
  dealt: number; raw: number; absorbed: number; caught: number; ring: number; out: number; resisted: number; crits: number;
  taken: number; fatigue: number; mana: number; hpMax: number; fatigueMax: number;
};
export type FightRecord = {
  readonly winner: 'party' | 'foe' | null; readonly rounds: number; readonly capped: boolean;
  /** Hunters that died (hit 0 HP), in the order they died. */
  readonly dead: readonly string[];
  readonly staggers: number;
  /** Ticks each row's next turn was pushed by a hold another row's use landed on it (a stagger apart), and the fight's length in ticks. */
  readonly held: Readonly<Record<string, number>>; readonly ticks: number;
  /** Every channel begun, and of them those begun while the foe it aimed at was aiming at the channeler (`aimed`). */
  readonly channels: { begun: number; completed: number; broken: number; dropped: number; aimed: { begun: number; completed: number } };
  readonly tally: Readonly<Record<string, Tally>>;
  /** HP, fatigue and mana of every row at the end, for a dungeon's next fight. */
  readonly end: Readonly<Record<string, { hp: number; fatigue: number; mana: number }>>;
  /** The script a mythic of the fight played, from what its effects said; null in a fight with none. */
  readonly mythic: MythicTrace | null;
};
/** What a scripted mythic did in one fight (design B.8 rows B2, B6 and B7). */
export type MythicTrace = {
  /** The phases it entered, in order, its first included, each with the turns it took in it (an announce, an act or a landing). */
  readonly phases: readonly { readonly phase: number; turns: number }[];
  /** The round of its first turn taken enraged (a gate phase past its clock); null when it never was. */
  enraged: number | null;
  /** Its omens that landed while it was enraged: its dooms. */
  dooms: number;
  /** The phase it stood in when the first hunter fell; null when none fell. */
  firstFall: number | null;
  /** Each omen it announced, by key, and each answer the party met, by how and outcome ("stagger cancel"). */
  readonly omens: Record<string, number>;
  readonly answers: Record<string, number>;
};
const emptyTally = (b: Body): Tally => ({
  turns: 0, moves: 0, passes: 0, acts: {}, byAct: {}, dealt: 0, raw: 0, absorbed: 0, caught: 0, ring: 0, out: 0, resisted: 0, crits: 0,
  taken: 0, fatigue: 0, mana: 0, hpMax: b.sheet.hpMax, fatigueMax: b.sheet.fatigueMax,
});

/** A fight to play: the rows, the plan, the time cap in rounds, and when the GM ends it (null: when a side is down). */
export type Setup = {
  readonly rows: readonly SimRow[];
  readonly plan?: Plan;
  readonly capRounds?: number;
  readonly endAtRounds?: number | null;
  /** Fatigue and mana each row starts with (a dungeon's earlier fights). */
  readonly carry?: Readonly<Record<string, { fatigue: number; mana: number }>>;
  readonly rules?: Rules;
  /** The GM's weight on the fight's dice (fudge.ts), set on the fight before it begins; its draws read it as the reducer's do. Absent: none. */
  readonly fudge?: Fudge;
};

/** `f` with the weight `w` set by the GM's own `fudge` command, one set for each side, row and forced roll (the reducer is its one writer). */
function weighted(f: Fight & { readonly phase: 'setup' }, w: Fudge, ctx: Ctx): Fight & { readonly phase: 'setup' } {
  const sets: FudgeSet[] = [
    ...(['party', 'foe'] as const).map((side): FudgeSet => ({ kind: 'weight', scope: { kind: 'side', side }, n: w.sides[side] })),
    ...Object.entries(w.rows).map(([id, n]): FudgeSet => ({ kind: 'weight', scope: { kind: 'row', id: combatantId(id) }, n })),
    ...Object.entries(w.forced).map(([id, face]): FudgeSet => ({ kind: 'force', id: combatantId(id), face })),
  ];
  let g: Fight = f;
  for (const set of sets) g = reduce(g, { type: 'fudge', set }, ctx).fight ?? g;
  if (g.phase !== 'setup') throw new Error('the fudge did not leave the fight in setup');
  return g;
}

/**
 * Plays one fight on the engine's loop (src/core/combat/play.ts, the one loop that plays a fight): the openings, then
 * each turn's choice of its row's policy, its dice, and every die the fight then waits for, all from the seed. This
 * keeps only the counts: what each use did (from `resolve`, pure, on the inputs the reducer got), the staggers and
 * the channels. The loop throws on any refusal: a policy asks the rules' own checks first, so a refusal is a bug in
 * the player or the fight.
 */
export function playFight(setup: Setup, seed: number): FightRecord {
  const R = setup.rules ?? RULES, ctx: Ctx = { rules: R };
  const plan: Plan = setup.plan ?? { channel: 'none' };
  const limits: Limits = { capRounds: setup.capRounds ?? CAP_ROUNDS, endAtRounds: setup.endAtRounds ?? null };
  const policies = new Map(setup.rows.map(s => [s.row.id as string, s.policy]));
  const rows = setup.rows.map(s => {
    const c = setup.carry?.[s.row.id];
    return c ? { ...s.row, fatigue: c.fatigue, mana: c.mana } : s.row;
  });
  const tally: Record<string, Tally> = {};
  let staggers = 0;
  const held: Record<string, number> = {};
  const channels = { begun: 0, completed: 0, broken: 0, dropped: 0, aimed: { begun: 0, completed: 0 } };
  /** Channelers whose channel began while its target aimed at them. */
  const underFire = new Set<string>();
  const mid = rows.find(r => r.mythic)?.id, trace: MythicTrace | null = mid ? { phases: [{ phase: rows.find(r => r.id === mid)!.mythic!.phase, turns: 0 }], enraged: null, dooms: 0, firstFall: null, omens: {}, answers: {} } : null;
  const phases = trace?.phases as { phase: number; turns: number }[] | undefined;
  const heard = (effects: readonly Effect[], after: Running | Ended): void => {
    const m = after.rows.find(r => r.id === mid);
    for (const e of effects) {
      if (e.type === 'staggered') staggers++;
      if (e.type === 'channel' && e.state === 'broken') channels.broken++;
      if (e.type === 'turnStarted') { const t = tally[e.id]; if (t) t.turns++; }
      if (!trace || !phases || !('id' in e) || e.id !== mid) continue;
      if (e.type === 'phased') phases.push({ phase: e.phase, turns: 0 });
      if (e.type === 'omen') trace.omens[e.omen] = (trace.omens[e.omen] ?? 0) + 1;
      if (e.type === 'answered') trace.answers[`${e.how} ${e.outcome}`] = (trace.answers[`${e.how} ${e.outcome}`] ?? 0) + 1;
      if (e.type === 'omen' || e.type === 'turnStarted') {
        phases[phases.length - 1]!.turns++;
        const now = e.type === 'turnStarted' ? e.now : after.now;
        if (trace.enraged === null && m?.mythic && enraged(m.mythic, now, R)) trace.enraged = Math.floor(now / R.fight.round);
      }
    }
    if (trace && trace.firstFall === null && m?.mythic && after.rows.some(r => r.kind === 'hunter' && rowHp(r) === 0)) trace.firstFall = m.mythic.phase;
  };
  /** Counts what a use does to each target, from `resolve` on the reducer's own inputs. */
  const count = (f: Running, user: Body, a: Ability, aim: Aim, rolls: Rolls): void => {
    const r = resolve(a, user, f.rows, aim, f.grid, rolls, f.now, R);
    if (!r.ok) return;
    const t = tally[user.id]!;
    t.acts[a.id] = (t.acts[a.id] ?? 0) + 1;
    for (const o of r.outcomes) {
      if (o.type !== 'physical' && o.type !== 'magical') continue;
      const victim = f.rows.find(b => b.id === o.target)!;
      if (victim.side === user.side) continue;
      t[o.avoid]++;
      if (o.crit) t.crits++;
      if (o.avoid !== 'out') { t.raw += o.raw; t.dealt += o.dealt; t.absorbed += o.absorbed; tally[o.target]!.taken += o.dealt - o.absorbed; t.byAct[a.id] = (t.byAct[a.id] ?? 0) + o.dealt; }
    }
    // a threshold the use set off is the user's damage too (kits design 1.2)
    for (const b of r.bursts) for (const l of b.landed) {
      const victim = f.rows.find(x => x.id === l.target);
      if (!victim || victim.side === user.side) continue;
      t.dealt += l.dealt; t.byAct[a.id] = (t.byAct[a.id] ?? 0) + l.dealt; tally[l.target]!.taken += l.dealt;
    }
  };

  const made = reduce(null, { type: 'add', fightId: fightId(`sim-${seed}`), rows, openings: [] }, ctx).fight;
  if (made?.phase !== 'setup') throw new Error(`seed ${seed}: the rows did not make a fight`);
  const added = setup.fudge ? weighted(made, setup.fudge, ctx) : made;
  for (const r of added.rows) tally[r.id] = emptyTally(r);
  const begun = playBegin(added, seed, R);
  heard(begun.effects, begun.play.fight);
  // a summon plays as a monster does (kits design 1.9: its owner's phone commands it)
  const policyOf = (me: Body): TurnPolicy => (f, m, rules) => (policies.get(me.id) ?? monsterPolicy)(f, m, plan, rules);
  let p: Play = begun.play;
  while (!playOver(p)) {
    const running = p as Play & { readonly fight: Running }, landing = runningState(running.fight);
    if (landing.at === 'landing' && !capped(running, limits, R) && trace && landing.id === mid && doom(running.fight.rows.find(r => r.id === mid)!.mythic!, running.fight.now, R)) trace.dooms++;
    const s = playStep(running, policyOf, limits, R), f = s.before, me = s.me, choice = s.choice;
    p = s.play;
    if (me && choice) {
      const t = tally[me.id] ??= emptyTally(me);
      if (choice.type === 'act') {
        count(f, me, choice.ability, choice.aim, s.rolls!);
        if (holds(choice.ability)) for (const r of f.rows) {
          const after = p.fight.rows.find(x => x.id === r.id);
          if (r.id !== me.id && after && after.at > r.at && !s.effects.some(e => e.type === 'staggered' && e.id === r.id)) held[r.id] = (held[r.id] ?? 0) + after.at - r.at;
        }
        if (choice.ability.channel) {
          channels.begun++;
          const at = typeof choice.aim === 'string' ? f.rows.find(r => r.id === choice.aim) : undefined;
          if (at && suggested(f, at)?.id === me.id) { channels.aimed.begun++; underFire.add(me.id); } else underFire.delete(me.id);
        }
      }
      if (choice.type === 'move') t.moves++;
      if (choice.type === 'pass') t.passes++;
      if (choice.type === 'release') {
        const c = me.channel!, a = me.abilities.find(x => x.id === c.ability)!;
        const full = { ...a, cost: { ...a.cost, mana: 0, fatigue: 0 }, range: tiles(f.grid.w + f.grid.h) };
        count(f, me, full, c.aim, s.rolls!);
        channels.completed++;
        if (underFire.has(me.id)) channels.aimed.completed++;
      }
    }
    heard(s.effects, p.fight);
  }
  const ended = p as Play & { readonly fight: Ended }, f = ended.fight;
  for (const r of f.rows) { const t = tally[r.id]!; t.fatigue = r.fatigue; t.mana = r.mana; }
  channels.dropped = channels.begun - channels.completed - channels.broken;
  return {
    winner: f.summary.winner, rounds: f.summary.rounds, capped: ended.capped, dead: [...ended.down], staggers, held, ticks: f.now, channels, tally,
    end: Object.fromEntries(f.rows.map(r => [r.id, { hp: rowHp(r), fatigue: r.fatigue, mana: r.mana }])),
    mythic: trace,
  };
}

/** Whether the omen standing is a doom: one of its script's enraged rotation, landing while it is enraged. */
const doom = (s: MythicStanding, now: Tick, R: Rules): boolean =>
  s.at !== 'calm' && enraged(s, now, R) && scriptOf(s).enraged.some(b => b.kind === 'omen' && b.omen === s.omen);
/** Whether `playStep` ends the play at its next step (the GM's end or the cap), as play.ts reads `limits`. */
const capped = (p: Play & { readonly fight: Running }, limits: Limits, R: Rules): boolean =>
  (limits.endAtRounds !== null && p.fight.now >= limits.endAtRounds * R.fight.round) || p.fight.now >= limits.capRounds * R.fight.round;
/** Whether a use puts a hold on what it catches (a stun, design 3.1 rule 18). */
const holds = (a: Ability): boolean => a.ops.some(o => o.op === 'applyStatus' && o.def.ops.some(x => x.op === 'hold'));

/**
 * Three fights in a row with the same party (a dungeon): HP back to full between fights, `rest` fatigue back, no mana
 * back. Returns each fight's record.
 */
export function playDungeon(make: (fight: number) => Setup, seed: number, fights: number, rest: number): FightRecord[] {
  const out: FightRecord[] = [];
  let carry: Record<string, { fatigue: number; mana: number }> = {};
  for (let i = 0; i < fights; i++) {
    const r = playFight({ ...make(i), carry }, seed * 7 + i);
    out.push(r);
    carry = Object.fromEntries(Object.entries(r.end).map(([id, v]) => [id, { fatigue: Math.max(0, v.fatigue - rest), mana: v.mana }]));
  }
  return out;
}


/**
 * How many blasts a fresh cannon's mana pays for, by the rules' own cost check (`payCost`, cost cut included): the blasts
 * the mana allows a dungeon, since mana comes back only on a clear.
 */
export function blastsAllowed(rank: Rank, R: Rules = RULES): number {
  const s = hunter('cannon', rank, 'cannon', R), m = modified(s.row.origin, [], R);
  const blast = abilities(R).blast;
  let n = 0;
  for (let b = payCost(blast, { ...s.row, ...m, place: place(0, 0), speed: m.sheet.speed, at: tick(0), tie: 0 }); b && n < 100; b = payCost(blast, b)) n++;
  return n;
}
