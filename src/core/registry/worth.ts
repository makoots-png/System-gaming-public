// worth.ts: what a made ability or status is worth against its budget (docs/agent-handoff/kits/design.md section 3), the
// one line every maker shows under its preview. The unit is the standard action (SA): the average of the kind's
// recommended standard formula read by the kind's reference body (a strike's `1d8 + phys` by a bruiser). A quick ability's
// budget is 0.7 SA and a heavy one's 1.5 (`RULES.fight.cost`); the maker warns past `1 + tolerance` times the budget and
// never refuses. Every number is a rule (`RULES.fight.kit`) or is worked out from the rules here. A new block's worth is
// a line of `abilityWorth` or `statusWorth` with its rule from design section 3 and a case in tests/worth.test.ts.
// A block with no rule is named in `Worth.unweighed`, never counted as 0, and the line says to test it in a fight.
// The simulation is the authority: tests/worth.test.ts ("the bar agrees with the simulation") plays the example kits on
// the real reducer and holds the bar to what they measure (docs/agent-handoff/kits/notes-worth.md).

import { RANKS } from '../rules.ts';
import type { Rank } from '../rules.ts';
import type { StatKey } from '../stats.ts';
import { kitGear, monsterSheet, monsterStats, pointsAt, sheetOf, split } from '../hunter/derive.ts';
import type { Kit, Sheet } from '../hunter/derive.ts';
import type { Stats } from '../stats.ts';
import { average, NO_KIT } from '../formula.ts';
import type { Formula, Scope } from '../formula.ts';
import { TIER_BUDGET } from './paths.ts';
import { SKILL_ABILITIES } from './abilities.ts';
import type { SkillRules } from './abilities.ts';
import { defaultTicks, formulaOf, KINDS, kindDefaults, recommended } from './ability-kinds.ts';
import type { SampleRules } from './ability-kinds.ts';
import { scalerMean, scalersOf } from './scalers.ts';
import type { Scaler } from './scalers.ts';
import { atTier, isStacking } from '../combat/op-amount.ts';
import type { End, LandOp, Op, OpKind, StatusDef } from '../combat/effect-ops.ts';
import type { Trigger } from '../combat/triggers.ts';
import type { Ability, AbilityKind, Delivery, Price } from '../combat/ability-types.ts';

/** The rule numbers this file reads. */
export type WorthRules = SampleRules & SkillRules;

// ── the reference bodies (design 2.3's paper builds, kits-paper `sheet`) ──
export type RefBuild = 'speed' | 'tank' | 'cannon' | 'bruiser' | 'support';
/** Each paper build: its main and second stat (two points to one) and its kit (`kitGear`); its rank's perk points go to its main stat. */
const BUILDS: { readonly [B in RefBuild]: { readonly main: StatKey; readonly second: StatKey; readonly kit: Kit } } = {
  speed: { main: 'agi', second: 'str', kit: 'light' }, tank: { main: 'vit', second: 'str', kit: 'heavy' },
  cannon: { main: 'pow', second: 'ctl', kit: 'light' }, bruiser: { main: 'str', second: 'vit', kit: 'medium' },
  support: { main: 'pre', second: 'dis', kit: 'light' },
};
/** The build that uses each kind on paper: the bruiser strikes, the speed build shoots, the cannon casts, the support supports. */
export const BUILD_OF: { readonly [K in AbilityKind]: RefBuild } = { strike: 'bruiser', shot: 'speed', blast: 'cannon', curse: 'cannon', support: 'support' };
/** A paper build at `rank`: the level the rank starts at, its points split two to one, its perk points on its main stat. */
export function referenceBody(build: RefBuild, rank: Rank, R: WorthRules): { readonly stats: Stats; readonly sheet: Sheet } {
  const b = BUILDS[build], level = R.rankLevels[rank], perks = TIER_BUDGET.slice(0, RANKS.indexOf(rank) + 1).reduce((s, v) => s + v, 0);
  const base = split(b.main, b.second, pointsAt(level, R), R), stats = { ...base, [b.main]: base[b.main] + perks };
  return { stats, sheet: sheetOf({ stats, level, gear: kitGear(b.kit, R), perks: {} }, R) };
}
/** What a use by paper build `build` reads at `rank`: the build on a same-rank normal brute, with no kit snapshot (no stacks, full HP). */
function buildScope(build: RefBuild, rank: Rank, R: WorthRules): Scope {
  const target = { stats: monsterStats(rank, 'brute', R), sheet: monsterSheet(rank, 'brute', 'normal', R) };
  return { user: referenceBody(build, rank, R), target, charge: 0, kit: NO_KIT };
}
/** What a use reads at `rank`: the kind's paper build (`BUILD_OF`) on a same-rank normal brute. */
const scopeOf = (kind: AbilityKind, rank: Rank, R: WorthRules): Scope => buildScope(BUILD_OF[kind], rank, R);
/**
 * The scope of the five paper builds of `rank` on which `f` averages highest, on the same brute (item-stats 6.5): an
 * amount that grows with its holder's stats costs what it gives the body that gets the most from it, a Presence heal on
 * the support and a Strength hit on the bruiser, so it is never undercharged. On a tie (a flat amount) the first build
 * of `BUILDS` that reaches the highest.
 */
export function bestScope(f: Formula, rank: Rank, R: WorthRules): Scope {
  const scopes = (Object.keys(BUILDS) as RefBuild[]).map(b => buildScope(b, rank, R));
  return scopes.reduce((best, s) => (average(f, s) > average(f, best) + 1e-9 ? s : best));
}
/**
 * Whose numbers a weighing reads an amount on: `build`, the paper build of the ability's kind (a worn status's, the
 * bruiser's), as a skill is weighed; `best`, each amount on the build it favours (`bestScope`), as an item's or a title's
 * powers are weighed, since anyone may hold them.
 */
export type ReadOn = 'build' | 'best';
/** One standard action of `kind` and `type` at `rank`, in what its formula averages: the yardstick every SA is. */
function standardOf(kind: AbilityKind, type: NonNullable<Ability['effect']>['type'], rank: Rank, R: WorthRules): number {
  return average(recommended(kind, { ...defaultTicks(kind, type), pace: 'standard' }, R).formula, scopeOf(kind, rank, R));
}

// ── the blocks, each in SA (design 3) ──
/** What one HP paid is worth: the share of a same-rank support's heal in one action (`1.5 * sup`) that heals it back. */
export const hpRate = (rank: Rank, R: WorthRules): number => 1 / (1.5 * referenceBody('support', rank, R).sheet.sup);
/** An HP price at `rank` paid by a body of `hpMax`: its HP at `hpRate`. */
export function hpPriceWorth(p: Extract<Price, { kind: 'hp' }>, hpMax: number, rank: Rank, R: WorthRules): number {
  const hp = p.amount.kind === 'flat' ? p.amount.n : p.amount.share * hpMax;
  return hp * hpRate(rank, R);
}
/** The uses of an ability of `time` a round by the paper build of `kind` at `rank`: its speed over the base, per standard action. */
export const usesPerRound = (kind: AbilityKind, time: number, rank: Rank, R: WorthRules): number =>
  referenceBody(BUILD_OF[kind], rank, R).sheet.speed / R.fight.speedBase * (R.fight.cost.standard / time);
/**
 * A mode (design 1.7, table 3.5): a standard action and `hpShare` of max HP enter it for `rounds`; spread over the
 * cannon's uses in those rounds it is the credit each ability the mode gates may carry above its pace's budget.
 */
export function modeCredit(mode: { readonly hpShare: number; readonly rounds: number }, rank: Rank, R: WorthRules): { readonly price: number; readonly uses: number; readonly credit: number } {
  const u = referenceBody('cannon', rank, R).sheet, price = 1 + mode.hpShare * u.hpMax * hpRate(rank, R), uses = mode.rounds * u.speed / R.fight.speedBase;
  return { price, uses, credit: price / uses };
}
/**
 * The credit a gated ability carries from the mode that opens it (design 1.7, table 3.5), found among `others` (the
 * library's and the hunter's abilities): for each gate on a status its user holds, an ability that puts that status on
 * its user for some rounds is the mode's entry; its time and HP prices, spread over the gated ability's uses in those
 * rounds, are the credit. The largest of its gates' credits; 0 when no entry is found (a mode the GM puts on by hand).
 */
export function gateCredit(a: Ability, others: readonly Ability[], R: WorthRules, rank: Rank = 'C'): number {
  const user = referenceBody(BUILD_OF[a.kind], rank, R).sheet;
  let best = 0;
  for (const g of a.gates ?? []) {
    if (g.kind !== 'holds' || g.on !== 'self') continue;
    for (const e of others) {
      if (e.id === a.id || e.aim !== 'self') continue;
      const op = e.ops.find(o => o.op === 'applyStatus' && o.key === g.key && o.duration !== null);
      if (!op || op.op !== 'applyStatus' || op.duration === null) continue;
      const rounds = atTier(op.duration, RANKS.indexOf(rank)) / R.fight.round;
      const hp = (e.prices ?? []).reduce((n, p) => n + (p.kind === 'hp' ? hpPriceWorth(p, user.hpMax, rank, R) : 0), 0);
      const uses = rounds * usesPerRound(a.kind, a.cost.time, rank, R);
      if (uses > 0) best = Math.max(best, (e.cost.time / R.fight.cost.standard + hp) / uses);
    }
  }
  return best;
}
/**
 * A threshold's payoff of `payoff` SA at `n` stacks, for an ability that adds `k` stacks and lands its status `land` of its
 * `uses` in a fight: `payoff / n` for each stack that lands, times the share of them that reach a whole firing before the
 * fight ends or the stacks lapse (`firings`, `misses` uses in a row that may miss before they do).
 */
export const thresholdWorth = (payoff: number, n: number, k: number, land: number, uses: number, misses = Infinity): number =>
  payoff / n * k * land * firings(n, k, land, uses, misses);
/**
 * The share of the stacks a fight lands that reach a whole firing (design 3's paper counts whole firings): over `uses`
 * uses (rounded down) each landing `k` stacks with chance `land`, the count fires and spends at `n`; the stacks short of
 * a firing when the fight ends are lost, and so are all of them after more than `misses` uses in a row miss (their time
 * runs out before the next lands). Worked exactly over the states (count, misses in a row). At the reference fight's 6
 * uses landing 0.55 of the time with no lapse it is 0.70 at 3 stacks and 0.85 at 2; with every use landing and `k` at
 * least `n` it is 1.
 */
export function firings(n: number, k: number, land: number, uses: number, misses = Infinity): number {
  const m = Math.max(1, Math.floor(uses)), p = Math.min(1, Math.max(0, land)), cap = Math.min(m, misses);
  if (p === 0) return 0;
  let states = new Map<string, number>([['0,0', 1]]), fired = 0;
  for (let i = 0; i < m; i++) {
    const next = new Map<string, number>(), add = (c: number, x: number, pr: number) => next.set(`${c},${x}`, (next.get(`${c},${x}`) ?? 0) + pr);
    for (const [key, pr] of states) {
      const [c, x] = key.split(',').map(Number) as [number, number], had = x > cap ? 0 : c, sum = had + k;
      fired += pr * p * Math.floor(sum / n);
      add(sum % n, 0, pr * p);
      add(had, Math.min(x + 1, cap + 1), pr * (1 - p));
    }
    states = next;
  }
  return fired * n / (k * m * p);
}
/** The uses in a row that may miss before stacks lasting `rounds` lapse, for uses `perRound` a round apart (null: they never lapse). */
export const lapseAfter = (rounds: number | null, perRound: number): number =>
  rounds === null ? Infinity : Math.max(0, Math.ceil(rounds * perRound - 1e-9) - 2);
/**
 * The share of a delayed effect that lands (kits design 1.6): an end `rounds` after its use lands only if the fight is
 * still going and nothing has cured it. A use at a uniform moment of the reference fight leaves `1 - rounds / F` of it to
 * land, and each round it waits a cleanse takes it with `kit.cleanse`; an end that a cure sets off is not lost to a cure.
 */
export function delayedShare(rounds: number, cleanse: End['cleanse'], R: WorthRules): number {
  const F = R.fight.kit.referenceRounds, left = Math.max(0, 1 - rounds / F);
  return cleanse === 'land' ? left : left * (1 - R.fight.kit.cleanse) ** rounds;
}
/**
 * The share of a use's own formula that a target takes at parity: a use with nothing travelling is resisted for
 * `resistedShare` on 12 or more of a d20 (`resistDc`: 0.55 whole, 0.45 at half, 0.775 of its average); a travel or a
 * sure one lands whole (an upper bound: the warning comes early).
 */
export const deliveredShare = (d: Delivery, R: WorthRules): number => {
  const land = d.kind === 'direct' ? (R.fight.resistDc - 1) / 20 : 1;
  return land + (1 - land) * R.fight.resistedShare;
};
/**
 * The share of a use's statuses that land at parity: a use with nothing travelling is resisted on 12 or more of a d20
 * (`resistDc`, 0.55 lands), a travel or sure one lands in full (an upper bound: the warning comes early).
 */
export const landShare = (a: Pick<Ability, 'delivery'>, R: WorthRules): number => (a.delivery.kind === 'direct' ? (R.fight.resistDc - 1) / 20 : 1);

// ── what the bar does not estimate ──
/** A block the bar has no rule for: an op kind, or a part of an ability. Each is named, never counted as 0. */
export type Unweighed = OpKind | 'count' | 'charge' | 'reaction' | 'summon' | 'zone' | 'blink' | 'zoneAct' | 'end';
const UNWEIGHED_WORDS: { readonly [U in Unweighed]: string } = {
  count: 'a count it reads in a fight', charge: 'its channel\'s charge', reaction: 'its reaction', summon: 'its summon', zone: 'its field',
  blink: 'its move', zoneAct: 'what it does to a field', end: 'its end, whose delay the ability sets',
  damage: 'damage at once', heal: 'a heal at once', mana: 'mana', fatigue: 'fatigue', applyStatus: 'a status', cureStatus: 'a cure',
  note: 'a note', speed: 'a speed change', delay: 'a delayed turn', hold: 'a hold', root: 'a root', taunt: 'a taunt', threat: 'threat',
  shield: 'a shield', channel: 'a channel guard', staggerRate: 'a stagger change', stat: 'a stat change', refund: 'time back', aura: 'an aura',
  spread: 'a spread', sheet: 'a sheet change', share: 'a damage share', untargetable: 'untargetable', invulnerable: 'invulnerable',
  safeguard: 'a safeguard', edge: 'advantage', boost: 'a held die', hidden: 'stealth', alert: 'alert', shove: 'a push or pull',
  move: 'moving stacks', hasten: 'a hasten', extra: 'an extra action', guard: 'a guard', negate: 'a negate', dispel: 'a dispel',
  stayHidden: 'staying hidden', reveal: 'a reveal',
};

/** Whether a formula reads a count of the fight the bar cannot know (stacks, a field, rounds held, hits, kills, stacks spent, HP lost). */
function readsCounts(f: Formula): boolean {
  switch (f.kind) {
    case 'stacks': case 'field': case 'held': case 'count': case 'missing': return true;
    case 'number': case 'dice': case 'stat': case 'sheet': case 'charge': return false;
    case 'negate': case 'fn': return readsCounts(f.arg);
    case 'binary': case 'min': case 'max': return readsCounts(f.left) || readsCounts(f.right);
    default: return f satisfies never;
  }
}

/**
 * What a worth is read for: the scope, whether each formula is read on its own best build instead (`ReadOn`), one
 * standard action, the source's tier, the ability kind and rank a scaler is weighed at; `landed`, what a part that lands
 * outside the use's own roll is worth against the delivered yardstick (`1 / deliveredShare` of the kind's delivery); `land` and `uses`, the share of the ability's uses that land its
 * statuses and its uses over the reference fight (a threshold's whole firings read them); `miss`, the blocks met with no rule.
 */
type At = {
  readonly scope: Scope; readonly on: ReadOn; readonly sa: number; readonly tier: number; readonly kind: AbilityKind; readonly rank: Rank;
  readonly landed: number; readonly land: number; readonly uses: number; readonly miss: Set<Unweighed>;
};
function atOf(kind: AbilityKind, type: NonNullable<Ability['effect']>['type'], rank: Rank, o: { readonly land: number; readonly time: number; readonly on: ReadOn }, R: WorthRules): At {
  return {
    scope: scopeOf(kind, rank, R), on: o.on, sa: standardOf(kind, type, rank, R), tier: RANKS.indexOf(rank), kind, rank,
    landed: 1 / deliveredShare(kindDefaults(kind, R).delivery, R), land: o.land, uses: R.fight.kit.referenceRounds * usesPerRound(kind, o.time, rank, R), miss: new Set(),
  };
}
/** The scope `f` is read on: the weighing's, or with `best` the paper build `f` favours. */
const scopeFor = (f: Formula, at: At, R: WorthRules): Scope => (at.on === 'best' ? bestScope(f, at.rank, R) : at.scope);
/**
 * A formula's average in SA, read on `scopeFor`. With the conditional scalers of design 8.0 it is its core's average
 * times the base it carries times the larger of its bonus against a pack's brute and against a boss (`scalerWorth`), so
 * a scaler in a threshold's, a trigger's, an end's or a per-round op's formula weighs as one in an ability's. A count it reads (other
 * than a scaler's HP share) is read as 0 and named in `miss`.
 */
function formulaWorth(f: Formula, at: At, R: WorthRules): number {
  const sc = scalersOf(f, R);
  if (readsCounts(sc ? sc.core : f)) at.miss.add('count');
  if (!sc) return average(f, scopeFor(f, at, R)) / at.sa;
  return average(sc.core, scopeFor(sc.core, at, R)) / at.sa * sc.base * scalerWorth(sc.scalers, at.kind, at.rank, R).worst;
}
/** The scalers' bonus over the plain use against a pack's normal brute alone and a boss alone (`1 +` the sum of the means), and the larger. */
export function scalerWorth(scalers: readonly Scaler[], kind: AbilityKind, rank: Rank, R: WorthRules): { readonly packs: number; readonly boss: number; readonly worst: number } {
  const means = scalers.map(s => scalerMean(s, kind, rank, R));
  const packs = 1 + means.reduce((n, m) => n + m.normal, 0), boss = 1 + means.reduce((n, m) => n + m.boss, 0);
  return { packs, boss, worst: Math.max(packs, boss) };
}
/**
 * An op that lands outside a use's own roll (a threshold's, a trigger's, an end's, or an ability's own op), in SA: a hit
 * or a heal at its average, whole (`landed`); time as its share of a standard action, whoever gains or loses it (time
 * back to the user, an ally's turn sooner, a foe's turn later, an extra action whole), since a standard action is the
 * unit itself and a body at parity does as much with an action as the user; a status by `statusWorth`; a note nothing.
 * Any other kind has no rule: it is named in `miss` and adds nothing.
 */
function landWorth(o: LandOp | Op, at: At, R: WorthRules): number {
  if (o.op === 'damage' || o.op === 'heal') return formulaWorth(atTier(o.amount, at.tier) as Formula, at, R) * at.landed;
  if (o.op === 'refund') return atTier(o.pct, at.tier) / 100;
  if (o.op === 'hasten') return o.share;
  if (o.op === 'delay') return atTier(o.ticks, at.tier) / R.fight.cost.standard;
  if (o.op === 'extra') return 1;
  if (o.op === 'applyStatus') return statusWorth(o.def, o.stacks ?? 1, o.duration === null ? null : atTier(o.duration, at.tier) / R.fight.round, at, R);
  if (o.op !== 'note') at.miss.add(o.op);
  return 0;
}
const triggerWorth = (t: Trigger, at: At, R: WorthRules): number =>
  t.ops.reduce((n, o) => n + landWorth(o, at, R), 0) * R.fight.kit.eventRates[t.on];

/**
 * A status's worth when `k` stacks of it land for `rounds` (null: until removed, weighed over the reference fight): each
 * per-round hit or heal its amount times the rounds times the stacks, whole; its threshold's payoff per stack in whole
 * firings (`firings`, at the ability's land share and uses; the land share itself multiplies the whole in
 * `abilityWorth`); its end at its average times the stacks times the share that lands after its delay (`delayedShare`);
 * its triggers their ops times their event's rate a round, for the rounds. A standing op (a stat, a hold, an edge) has
 * no rule in design 3: it is named in `miss`.
 */
export function statusWorth(def: StatusDef, k: number, rounds: number | null, at: At, R: WorthRules): number {
  const held = rounds ?? R.fight.kit.referenceRounds, n = isStacking(def) ? Math.min(k, def.stack.cap) : 1;
  let w = 0;
  for (const o of def.ops) {
    if ((o.op === 'damage' || o.op === 'heal') && (o.when ?? 'turn') === 'turn') w += formulaWorth(atTier(o.amount, at.tier), at, R) * at.landed * held * n;
    else if (o.op !== 'note') at.miss.add(o.op);
  }
  const t = isStacking(def) ? def.stack.threshold : null;
  if (t && t.at.kind === 'count') w += t.ops.reduce((s, o) => s + landWorth(o, at, R), 0) / t.at.n * n * firings(t.at.n, n, at.land, at.uses, lapseAfter(rounds, at.uses / R.fight.kit.referenceRounds));
  else if (t) at.miss.add('count');
  if (def.end && rounds === null) at.miss.add('end');
  else if (def.end) w += def.end.ops.reduce((s, o) => s + landWorth(o, at, R), 0) * n * delayedShare(rounds!, def.end.cleanse, R);
  for (const tr of def.triggers ?? []) w += triggerWorth(tr, at, R) * held;
  return w;
}

/**
 * A made thing's worth and budget in SA, whether it is past the tolerance, and the blocks the bar could not weigh (the
 * worth and the verdict are of the rest). An ability with scalers also has what they weigh against packs alone and a
 * boss alone, each as a share of its plain use with the base cut (design 8.0).
 */
export type Worth = {
  readonly worth: number; readonly budget: number; readonly over: boolean; readonly unweighed: readonly Unweighed[];
  readonly against?: { readonly packs: number; readonly boss: number };
  /** The built-in that sets the budget of its kind, when one does (`standardHeld`). */
  readonly by?: string;
};
const judged = (worth: number, budget: number, at: At, R: WorthRules): Worth =>
  ({ worth, budget, over: worth > budget * (1 + R.fight.kit.tolerance) + 1e-9, unweighed: [...at.miss] });

/** What the bar weighs of an ability (the worth, before any budget), with the blocks it met that have no rule. */
function weigh(a: Ability, rank: Rank, on: ReadOn, R: WorthRules): { readonly worth: number; readonly at: At } {
  const type = a.effect?.type ?? KINDS[a.kind].type;
  const at = atOf(a.kind, type, rank, { land: landShare(a, R), time: a.cost.time, on }, R);
  const f = formulaOf(a, R);
  let worth = f ? formulaWorth(f, at, R) * deliveredShare(a.delivery, R) * at.landed : 0;
  worth += a.ops.reduce((n, op) => n + landWorth(op, at, R), 0) * at.land;
  for (const p of a.prices ?? []) if (p.kind === 'hp') worth -= hpPriceWorth(p, at.scope.user.sheet.hpMax, rank, R);
  if (a.channel) at.miss.add('charge');
  if (a.react) at.miss.add('reaction');
  if (a.summon) at.miss.add('summon');
  if (a.zone) at.miss.add('zone');
  if (a.move) at.miss.add('blink');
  if (a.zoneAct) at.miss.add('zoneAct');
  return { worth, at };
}
/**
 * What a standard action of `kind` may hold at `rank`: one SA, or the most a built-in skill of the kind with no
 * cooldown is worth a standard action of time, if more (its name with it). Reason: the simulation's builds cast those
 * built-ins every turn and hold every row with them (tests/fight-sim.test.ts), so a budget under them would call the
 * game's own balance over. A curse's is Arc Bolt (`2d6 + mag`): 1.17 SA at E, 1.08 at C, 1.04 at S; every other kind's
 * built-ins with no cooldown are at or under their standard (notes-worth.md).
 */
export function standardHeld(kind: AbilityKind, rank: Rank, R: WorthRules): { readonly sa: number; readonly by: string | null } {
  let best: { sa: number; by: string | null } = { sa: 1, by: null };
  for (const make of Object.values(SKILL_ABILITIES)) {
    const b = make(R);
    if (!b || b.kind !== kind || b.cost.cooldown > 0 || b.channel) continue;
    const sa = weigh(b, rank, 'build', R).worth * R.fight.cost.standard / b.cost.time;
    if (sa > best.sa + 1e-9) best = { sa, by: b.name };
  }
  return best;
}
/**
 * An ability's worth at `rank` (C by default, the design's table): its formula's average over its kind's standard action,
 * times the share of it a target takes over the share the standard's delivery gives (with its scalers, the base it
 * carries times the larger of its bonus against a pack's brute and against a boss, design 8.0), plus the statuses its
 * ops apply times its land share, less what its HP prices pay. Its budget is its pace's share of what a standard action
 * of its kind may hold (`standardHeld`), plus `credit` (a mode's, `gateCredit`, for an ability the mode gates). Its
 * amounts are read on its kind's paper build, or with `on: 'best'` each on the build it favours (`bestScope`, an item's
 * or a title's active). A channel, a reaction, a summon, a field, a move and a zone act are named as not weighed.
 */
export function abilityWorth(a: Ability, R: WorthRules, o: { readonly rank?: Rank; readonly credit?: number; readonly on?: ReadOn } = {}): Worth {
  const rank = o.rank ?? 'C', { worth, at } = weigh(a, rank, o.on ?? 'build', R), held = standardHeld(a.kind, rank, R);
  const judgedAt = { ...judged(worth, a.cost.time / R.fight.cost.standard * held.sa + (o.credit ?? 0), at, R), ...(held.by ? { by: held.by } : {}) };
  const f = formulaOf(a, R), sc = f ? scalersOf(f, R) : null;
  if (!sc) return judgedAt;
  const e = scalerWorth(sc.scalers, a.kind, rank, R), base = 1 / (1 + sc.scalers.reduce((n, s) => n + scalerMean(s, a.kind, rank, R).mean, 0));
  return { ...judgedAt, against: { packs: base * e.packs, boss: base * e.boss } };
}
/**
 * A worn status's worth a round (a passive skill's or an item's, design 3): its triggers' ops times their event's rate,
 * against the tolerance, the budget of a kit with no ability. In SA of a bruiser's strike at `rank`, its amounts read
 * by the bruiser, or with `on: 'best'` each on the build it favours (`bestScope`, an item's or a title's worn status);
 * its standing ops are named as not weighed.
 */
export function wornWorth(def: StatusDef, R: WorthRules, rank: Rank = 'C', o: { readonly on?: ReadOn } = {}): Worth {
  const at = atOf('strike', 'physical', rank, { land: 1, time: R.fight.cost.standard, on: o.on ?? 'build' }, R);
  const worth = (def.triggers ?? []).reduce((n, t) => n + triggerWorth(t, at, R), 0);
  for (const o of def.ops) if (o.op !== 'note') at.miss.add(o.op);
  return { worth, budget: R.fight.kit.tolerance, over: worth > R.fight.kit.tolerance + 1e-9, unweighed: [...at.miss] };
}
/**
 * A status def alone, as the status maker shows it: what it is worth when a standard curse puts it on at its cap (a
 * plain def once), held the reference fight, against the budget of that standard action. Its end has no delay until an
 * ability sets one, so it is named as not weighed here.
 */
export function defWorth(def: StatusDef, R: WorthRules, rank: Rank = 'C'): Worth {
  const at = atOf('curse', 'magical', rank, { land: 1, time: R.fight.cost.standard, on: 'build' }, R);
  const worth = statusWorth(def, isStacking(def) ? def.stack.cap : 1, null, at, R);
  return judged(worth, 1, at, R);
}

const two = (n: number): string => n.toFixed(2);
/**
 * The worth line: "Worth 1.04 of a standard action (budget 1.00)", past the tolerance a warning in the same line, and
 * the blocks it could not weigh with the words to test them in a fight.
 */
export function worthLine(w: Worth): string {
  const missing = w.unweighed.map(u => UNWEIGHED_WORDS[u]);
  const without = missing.length ? ` without ${listed(missing)}, which it cannot estimate: test ${missing.length > 1 ? 'them' : 'it'} in a fight` : '';
  const line = `Worth ${two(w.worth)} of a standard action (budget ${two(w.budget)}${w.by ? `, as ${w.by} holds` : ''})${without}`;
  const against = w.against ? ` Its scalers make it ${two(w.against.packs)} of its plain use against packs, ${two(w.against.boss)} against a boss.` : '';
  if (!w.over) return `${line}.${against}`;
  return `${line}. Stronger than its pace allows by ${Math.round((w.worth / w.budget - 1) * 100)}%.${against}`;
}
const listed = (xs: readonly string[]): string => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
