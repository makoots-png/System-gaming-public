// item-budget.ts: what an item of a tier and a grade may hold, and what an item spends of it (economy design 2.3 and
// 2.4, the owner's ruling 1: "some items lower stats but better abilities"). The unit is the point, one point on a stat;
// everything a worn item carries is converted to points on the item maker's sample wearer (`SAMPLE_WEARER`) at the first
// level of its rarity's rank, and the amounts of its powers (a passive and an active, `powersSpend`) are read on the
// paper build each favours (worth.ts `bestScope`, item-stats 6.5). A tier's budget is a span of points cut in three
// grades; the price reads the grade the maker picked (items.ts `valueOf`), never the spend, so the spend line only tells
// the maker whether they agree. A block with no measure is named in `Spend.unweighed`, never counted as 0, as worth.ts does.
// A title is weighed the same way at its band (item-stats 6.7, `titleSpend`), against `titleBudget`. Tests: tests/item-budget.test.ts.
import { BONUS_HUNDREDTHS, RANKS } from '../rules.ts';
import type { BonusKey, Perk, Rank, Rules } from '../rules.ts';
import type { StatKey } from '../stats.ts';
import { kitGear, monsterSheet, pointsAt, sheetOf, split } from '../hunter/derive.ts';
import type { Kit, Sheet } from '../hunter/derive.ts';
import { defenceLeft, throughDefence } from '../combat/land.ts';
import type { Ability, DamageType } from '../combat/ability-types.ts';
import { cooldownOf } from '../combat/charge.ts';
import { atTier } from '../combat/op-amount.ts';
import type { Op, SheetOpKey } from '../combat/effect-ops.ts';
import { average, NO_KIT, parseFormula } from '../formula.ts';
import type { Formula, Scope } from '../formula.ts';
import { gradeLabel } from '../effects.ts';
import { GRADES, KIT_SHARE, SAMPLE_WEARER, WEAR_LIMIT, piece, weightOf } from './items.ts';
import type { ArmorSlot, Grade, Item, Rarity } from './items.ts';
import { formulaOf, KINDS } from './ability-kinds.ts';
import { weaponAttack } from './abilities.ts';
import { abilityWorth, bestScope, BUILD_OF, hpRate, referenceBody, usesPerRound, wornWorth } from './worth.ts';
import type { WorthRules } from './worth.ts';
import type { Powers } from './powers.ts';
import { bandOf } from '../rewards.ts';

/** The rule numbers the budget reads: the body and the fight's yardstick (worth.ts), each rarity's rank, and the budget's share. */
export type BudgetRules = WorthRules & Pick<Rules, 'rarities' | 'itemBudget'>;

// ── the budget of a tier and a grade (design 2.4) ──
/** A rank's middle budget: `itemBudget.share` of the points a hunter of the rank has at its first level, over `WEAR_LIMIT`. */
export const middleBudget = (R: BudgetRules, rank: Rank): number =>
  R.itemBudget.share * pointsAt(R.rankLevels[rank], R) / WEAR_LIMIT;

/** A tier's span of points: its low edge, and the top of each grade (the plus's is the tier's top). */
export type Span = { readonly low: number; readonly tops: { readonly [G in Grade]: number } };
/**
 * A rank's span on a log scale: from halfway to the rank below's middle budget to halfway to the rank above's (E's low
 * and S's top mirrored, as far out as their one neighbour is), so the spans tile and every spend falls in one tier; cut
 * in three equal steps on the same scale, minus, middle and plus.
 */
export function tierSpan(R: BudgetRules, rank: Rank): Span {
  const i = RANKS.indexOf(rank), b = middleBudget(R, rank);
  const near = (j: number): number => { const r = RANKS[j]; return r ? middleBudget(R, r) : b * b / middleBudget(R, RANKS[2 * i - j]!); };
  const low = Math.sqrt(near(i - 1) * b), top = Math.sqrt(b * near(i + 1)), k = Math.cbrt(top / low);
  return { low, tops: { [-1]: low * k, 0: low * k * k, 1: top } };
}

/**
 * What a tier and a grade may hold, in points: up to `high`, from `low`. The minus has no `low`: an item weaker than
 * its tier's middle is allowed, and cheap. What is never allowed is a spend past its grade's `high`.
 */
export type GradeBand = { readonly grade: Grade; readonly low: number | null; readonly high: number };
/** The band of `grade` in the tier of `rar` (the tier of its rank, `rarities.*.rank`). */
export function gradeBand(R: BudgetRules, rar: Rarity, grade: Grade): GradeBand {
  const s = tierSpan(R, R.rarities[rar].rank);
  return { grade, low: grade === -1 ? null : s.tops[grade === 1 ? 0 : -1], high: s.tops[grade] };
}
/** The grade whose band holds `points` in the tier of `rar`: the lowest whose top it does not pass; null past the plus's top. */
export const gradeOfSpend = (R: BudgetRules, rar: Rarity, points: number): Grade | null =>
  GRADES.find(g => points <= gradeBand(R, rar, g).high + 1e-9) ?? null;

// ── what an item spends (design 2.3) ──
/** What an item carries that the budget has no measure for: a part of its worn status or of its active with no rule in worth.ts. */
export type Unbudgeted = 'worn' | 'active';
const UNBUDGETED_WORDS: { readonly [U in Unbudgeted]: string } = {
  worn: 'unestimated worn status effects',
  active: 'unestimated active ability effects',
};
/** What an item's spend breaks into: extra weapon damage (null on non-weapons and titles), stat bonuses, extra guard, and powers. */
export type SpendParts = {
  readonly weapon: number | null;
  readonly stats: number;
  readonly guard: number;
  readonly powers: number;
};
/** Player- and GM-facing words for each part of a weapon's budget breakdown (`spendLine`). */
export const BUDGET_WORDS: Readonly<Record<keyof SpendParts, string>> = {
  weapon: 'weapon damage', stats: 'stats', guard: 'armor', powers: 'powers',
};
/** An item's spend in points beyond its slot's free numbers, its parts, and what it carries that the budget cannot weigh. */
export type Spend = { readonly points: number; readonly parts: SpendParts; readonly unweighed: readonly Unbudgeted[] };
/** What a spend reads of an item. */
export type Spendable = Pick<Item, 'rar' | 'type' | 'slot' | 'dice' | 'bonus' | 'armor' | 'resist'> & Partial<Pick<Item, 'attack' | 'finesse' | 'weight' | 'worn' | 'active'>>;

/** The points a conversion is read over: max HP and max mana are whole numbers, so one point's share is read off ten. */
const READ_OVER = 10;
/**
 * The sample wearer at the first level of a rank (block [2.3]): its sheet with a bonus on it, the body itself, what one
 * point of Strength, Power and Vitality buys of physical power, arcane power and armor, and one standard action in damage.
 */
type Rates = {
  readonly rank: Rank; readonly sheet: (perks: Perk) => Sheet;
  readonly phys: number; readonly mag: number; readonly armor: number;
  readonly body: Scope['user']; readonly strike: number;
};
function ratesAt(rank: Rank, R: BudgetRules): Rates {
  const level = R.rankLevels[rank], stats = split(SAMPLE_WEARER.main, SAMPLE_WEARER.second, pointsAt(level, R), R);
  const sheet = (perks: Perk): Sheet => sheetOf({ stats, level, gear: kitGear(SAMPLE_WEARER.kit, R), perks }, R);
  const bare = sheet({}), per = (k: StatKey, n: 'mag' | 'phys' | 'armor'): number => (sheet({ [k]: READ_OVER })[n] - bare[n]) / READ_OVER;
  const body = { stats, sheet: bare };
  // worth.ts's yardstick: the strike's dice plus its power times the bruiser's phys
  const strike = strikeDie(body, R) + KINDS.strike.power * referenceBody(BUILD_OF.strike, rank, R).sheet.phys;
  return { rank, sheet, phys: per('str', 'phys'), mag: per('pow', 'mag'), armor: per('vit', 'armor'), body, strike };
}
/** The mean of the reference strike's own dice (`KINDS.strike`, 1d8): the free die of an unarmed strike. */
function strikeDie(body: Scope['user'], R: BudgetRules): number {
  const p = parseFormula(KINDS.strike.dice ?? '0', R);
  return p.ok ? average(p.formula, { user: body, target: body, charge: 0, kit: NO_KIT }) : 0;
}
/**
 * What a weapon's attack formula spends above its kind's default die (`weaponAttack`), floored at 0 so a weaker die never
 * refunds points. The extra damage is read on the paper build the attack favours (`bestScope`), divided by the kind's
 * pace share (so a quick shot and a standard strike price the same), and weighed at `itemBudget.weaponDuty` of a
 * standard action a round (`perAction = r.strike / r.phys`, which cancels `r.strike`).
 */
function weaponPoints(it: Spendable, rank: Rank, r: Rates, R: BudgetRules): number {
  const attack = it.attack ?? 'strike', baseDice = KINDS[attack].dice ?? '1d8';
  const finesse = it.finesse ? { finesse: true as const } : {};
  const actual = weaponAttack({ name: 'w', dice: it.dice, attack, ...finesse }, R);
  const base = weaponAttack({ name: 'w', dice: baseDice, attack, ...finesse }, R);
  const fActual = formulaOf(actual, R), fBase = formulaOf(base, R);
  if (!fActual || !fBase) return 0;
  const s = bestScope(fActual, rank, R), paceShare = R.fight.cost[KINDS[attack].pace] / R.fight.cost.standard;
  const extra = (average(fActual, s) - average(fBase, s)) / paceShare;
  return Math.max(0, extra) / r.phys * R.itemBudget.weaponDuty;
}

/** The four penetrations, which no stat feeds alone (Control feeds the percent pair of both): each is weighed by `penCost`. */
type PenKey = 'armorPen' | 'resistPen' | 'armorPenFlat' | 'resistPenFlat';
/**
 * Lifesteal, ability haste, heal and shield power and damage to shield, which no stat feeds: each is weighed by its
 * worth a round (`drainCost`, `hasteCost`, `healPowerCost`).
 */
type UnfedKey = 'drain' | 'haste' | 'healPower' | 'shieldDrain';
/**
 * The stat that feeds each other sheet key in `derive` (balance plan section 10): a bonus on the key costs the points of
 * that stat that make the same change on the sample wearer. Tenacity reads Strength and Discipline together, so its
 * points are spent on both evenly; the reaction reads Instinct first and Agility after, so Instinct weighs it.
 */
const FED_BY: { readonly [K in Exclude<BonusKey, StatKey | PenKey | UnfedKey>]: readonly StatKey[] } = {
  hpMax: ['vit'], manaMax: ['pow'], fatigueMax: ['vit'], carry: ['str'], speed: ['agi'], move: ['agi'], react: ['ins'], aim: ['ctl'], will: ['dis'], critFaces: ['ins'], critSize: ['ctl'], opening: ['ins'],
  tenacity: ['str', 'dis'], potency: ['ctl'], threat: ['pre'], hold: ['dis'], costCut: ['ctl'],
};
/** What one point of a bonus key adds to its sheet number: one, or a hundredth for a key of `BONUS_HUNDREDTHS`. */
const unitOf = (k: BonusKey): number => ((BONUS_HUNDREDTHS as readonly BonusKey[]).includes(k) ? 0.01 : 1);
/**
 * A key a stat feeds: what a point of the key adds to its number, over what a point of the stat adds to it on the sample
 * wearer (read over `READ_OVER` points of the stat, spread evenly over the stats of `FED_BY`).
 */
function fedCost(k: keyof typeof FED_BY, r: Rates): number {
  const by = FED_BY[k], spent: Perk = Object.fromEntries(by.map(s => [s, READ_OVER / by.length]));
  return unitOf(k) / ((r.sheet(spent)[k] - r.sheet({})[k]) / READ_OVER);
}
/**
 * A penetration (balance plan section 9): the points of the power stat (Strength for the armor pair, Power for the
 * resist pair) that add as much damage to one standard action of the tier, `strike`, on a same-rank foe of the kind
 * `itemBudget.penFoe` (a brute's armor, a caster's resist) as a point of the key does, both read before rule 12 rounds.
 */
function penCost(k: PenKey, r: Rates, R: BudgetRules): number {
  const physical = k === 'armorPen' || k === 'armorPenFlat', type: DamageType = physical ? 'physical' : 'arcane';
  const foe = monsterSheet(r.rank, physical ? 'brute' : 'caster', R.itemBudget.penFoe, R);
  const dealt = (raw: number, user: Sheet): number => throughDefence(raw, defenceLeft(type, user, foe), R);
  const wearer = r.sheet({}), hit = r.strike;
  const key = (dealt(hit, r.sheet({ [k]: READ_OVER })) - dealt(hit, wearer)) / READ_OVER;
  const stat = dealt(hit + (physical ? r.phys : r.mag), wearer) - dealt(hit, wearer);
  return key / stat;
}
/**
 * A key no stat feeds (balance plan section 10) costs its worth a round in standard actions, at the rate a worn status
 * pays (`r.strike / r.phys`: the Strength points whose physical power adds that much to one standard action a round).
 */
const unfedCost = (saPerRound: number, r: Rates): number => saPerRound * r.strike / r.phys;
/**
 * A point of lifesteal, `drain` (a hundredth): a hundredth of the HP one standard action a round takes, healed back. The
 * action is the tier's strike (`strike`) on a same-rank normal brute, worth.ts's target, through its armor by rule 12
 * with the wearer's penetration; an HP healed is worth what a support's standard heal makes it (`hpRate`). A point of
 * damage to shield, `shieldDrain`, by the same rule (item-stats 2.2): an HP of shield is weighed as an HP healed, and
 * its ceiling (`kit.shieldDrainMax`) is not read, so the cost never undercharges.
 */
const drainCost = (k: 'drain' | 'shieldDrain') => (r: Rates, R: BudgetRules): number => {
  const wearer = r.sheet({}), brute = monsterSheet(r.rank, 'brute', 'normal', R);
  const taken = throughDefence(r.strike, defenceLeft('physical', wearer, brute), R);
  return unfedCost(unitOf(k) * taken * hpRate(r.rank, R), r);
};
/**
 * A point of heal and shield power, `healPower` (a hundredth, item-stats 2.1): a support's standard heal a round is
 * about one standard action (`hpRate` reads 1.5 times `sup` HP as one), so a hundredth more of it is a hundredth of a
 * standard action a round. The wearer is weighed as healing every round, the reading that never undercharges.
 */
const healPowerCost = (r: Rates): number => unfedCost(unitOf('healPower'), r);
/**
 * A point of ability haste, `haste` (whole points): a cooldown of C rounds becomes C * 100 / (100 + haste) (charge.ts
 * `cooldownOf`), so the ability is used (100 + haste) / (100 * C) times a round, and each point adds a hundredth of a
 * use every C rounds whatever the haste already is: the cost is linear in points. C is `itemBudget.cooldownRounds`;
 * each extra use is weighed as a whole standard action. The bar weighs the built-ins with a cooldown at about their budget a use (worth.ts), and what a cooldown holds
 * back that the bar cannot weigh (a hide, a haste, a field) is why it has one, so a whole action is the reading that
 * does not undercharge it.
 */
const hasteCost = (r: Rates, R: BudgetRules): number => unfedCost(0.01 / R.itemBudget.cooldownRounds, r);
/** Each bonus key's cost in points: a stat point is the unit; every other key by the stat that feeds it, as a penetration, or by its worth a round. */
const BONUS_COST: { readonly [K in BonusKey]: (r: Rates, R: BudgetRules) => number } = {
  str: () => 1, agi: () => 1, vit: () => 1, pow: () => 1, ins: () => 1, pre: () => 1, ctl: () => 1, dis: () => 1,
  hpMax: r => fedCost('hpMax', r), manaMax: r => fedCost('manaMax', r), fatigueMax: r => fedCost('fatigueMax', r),
  carry: r => fedCost('carry', r), speed: r => fedCost('speed', r), move: r => fedCost('move', r), react: r => fedCost('react', r), aim: r => fedCost('aim', r),
  will: r => fedCost('will', r), critFaces: r => fedCost('critFaces', r), critSize: r => fedCost('critSize', r),
  opening: r => fedCost('opening', r), tenacity: r => fedCost('tenacity', r), potency: r => fedCost('potency', r),
  threat: r => fedCost('threat', r), hold: r => fedCost('hold', r), costCut: r => fedCost('costCut', r),
  armorPen: (r, R) => penCost('armorPen', r, R), resistPen: (r, R) => penCost('resistPen', r, R),
  armorPenFlat: (r, R) => penCost('armorPenFlat', r, R), resistPenFlat: (r, R) => penCost('resistPenFlat', r, R),
  drain: drainCost('drain'), haste: hasteCost, healPower: healPowerCost, shieldDrain: drainCost('shieldDrain'),
};
/** A bonus's points at the rank of `r`: each bonus key's points times its cost (`BONUS_COST`); any other key costs nothing, as the sheet reads nothing of it. */
const bonusPoints = (bonus: Readonly<Partial<Record<BonusKey, number>>>, r: Rates, R: BudgetRules): number =>
  (Object.keys(BONUS_COST) as BonusKey[]).reduce((n, k) => n + (bonus[k] ? bonus[k] * BONUS_COST[k](r, R) : 0), 0);
/** What bonus key `k` costs for one of its sheet number: a `sheet` op adds to the number itself, a bonus point `unitOf` of it. */
const perNumber = (k: BonusKey) => (r: Rates, R: BudgetRules): number => BONUS_COST[k](r, R) / unitOf(k);
/**
 * What one of each number a `sheet` op adds to costs, as a bonus of that size (item-stats 6.5): armor and resist the
 * Vitality whose armor it is (`r.armor`), as an item's armor above its piece does; a number a bonus key also feeds, that
 * key's cost (`perNumber`). Null, no rule, so it is named as not weighed: `exposed` (the faces a foe crits its bearer on,
 * a drawback), `range` and the level `sight`.
 */
const SHEET_OP_COST: { readonly [K in SheetOpKey]: ((r: Rates, R: BudgetRules) => number) | null } = {
  armor: r => 1 / r.armor, resist: r => 1 / r.armor,
  armorPen: perNumber('armorPen'), resistPen: perNumber('resistPen'), armorPenFlat: perNumber('armorPenFlat'), resistPenFlat: perNumber('resistPenFlat'),
  critFaces: perNumber('critFaces'), critSize: perNumber('critSize'), costCut: perNumber('costCut'),
  exposed: null, range: null, sight: null,
};
/** An amount of a standing op: a number as it is, a formula's average on the paper build it favours (`bestScope`). */
const amountOn = (v: number | Formula, rank: Rank, R: BudgetRules): number => (typeof v === 'number' ? v : average(v, bestScope(v, rank, R)));
/**
 * What a `stat` or `sheet` op of a held thing's worn status spends at the rank of `r`, as a bonus of its size: its amount
 * at the rank's tier times a stat point's cost (one) or the number's (`SHEET_OP_COST`); null for a number with no rule.
 */
function standingPoints(o: Extract<Op, { readonly op: 'stat' | 'sheet' }>, r: Rates, R: BudgetRules): number | null {
  const cost = o.op === 'stat' ? BONUS_COST[o.key](r, R) : SHEET_OP_COST[o.key]?.(r, R) ?? null;
  return cost === null ? null : amountOn(atTier(o.amount, RANKS.indexOf(r.rank)), r.rank, R) * cost;
}
/**
 * The uses a round an active is weighed at (item-stats 6.5): the fewest of what its time lets its kind's paper build
 * use (`usesPerRound`: it takes an action), a round over its cooldown (read by `cooldownOf` at no haste, since ability
 * haste is bought and weighed on its own), and each `uses` gate's n over the reference fight's rounds (a rest's read as
 * a fight's, so it is never undercharged).
 */
function activeUses(a: Ability, rank: Rank, R: BudgetRules): number {
  const cooldown = cooldownOf(a.cost.cooldown, 0);
  const gated = (a.gates ?? []).flatMap(g => (g.kind === 'uses' ? [g.n / R.fight.kit.referenceRounds] : []));
  return Math.min(usesPerRound(a.kind, a.cost.time, rank, R), cooldown > 0 ? R.fight.round / cooldown : Infinity, ...gated);
}
/**
 * What a held thing's powers spend at `rank`, in points (item-stats 6.5), each amount read on the paper build it favours
 * (worth.ts `bestScope`). The worn status: each `stat` and `sheet` op as a bonus of its size (`standingPoints`), the rest
 * its worth a round (`wornWorth`); the active: its worth a use (`abilityWorth`) times its uses a round (`activeUses`).
 * Both are standard actions a round, at the rate any worn worth pays: the tier's strike over what a Strength point adds
 * to it (`r.strike / r.phys`). What worth.ts cannot weigh of either is named, never counted as 0. An item's spend adds
 * it at its rarity's rank.
 */
export function powersSpend(p: Powers, rank: Rank, R: BudgetRules): Pick<Spend, 'points' | 'unweighed'> {
  const r = ratesAt(rank, R), perAction = r.strike / r.phys, unweighed: Unbudgeted[] = [];
  let points = 0;
  if (p.worn) {
    const rest: Op[] = [];
    for (const o of p.worn.ops) {
      const n = o.op === 'stat' || o.op === 'sheet' ? standingPoints(o, r, R) : null;
      if (n === null) rest.push(o);
      else points += n;
    }
    const w = wornWorth({ ...p.worn, ops: rest }, R, rank, { on: 'best' });
    points += w.worth * perAction;
    if (w.unweighed.length) unweighed.push('worn');
  }
  if (p.active) {
    const w = abilityWorth(p.active, R, { rank, on: 'best' });
    points += w.worth * activeUses(p.active, rank, R) * perAction;
    if (w.unweighed.length) unweighed.push('active');
  }
  return { points, unweighed };
}
const isArmorSlot = (s: Spendable['slot']): s is ArmorSlot => s !== null && Object.hasOwn(KIT_SHARE, s);
/**
 * The armor and resist a slot gives for free: the piece (`piece`) of the heaviest kit whose piece in that slot weighs no
 * more than the item, since weight is what pays for a kit's guard. None for a lighter item, or a slot no kit fills.
 */
function freeGuard(it: Spendable, R: BudgetRules): { readonly armor: number; readonly resist: number } {
  const slot = it.slot, w = weightOf(it);
  if (!isArmorSlot(slot)) return { armor: 0, resist: 0 };
  const fits = (Object.keys(R.fight.kits) as Kit[]).map(k => piece(k, slot, R)).filter(p => p.weight <= w);
  return fits.reduce((a, p) => (p.weight >= a.weight ? p : a), { weight: -1, armor: 0, resist: 0 });
}

/**
 * What a worn item spends, in points on the sample wearer at its rarity's rank (design 2.3); null for an item nobody
 * wears (a consumable, a material, a key), which has no budget. Each bonus point on a stat is one; any other bonus key
 * costs the stat points that would give it (`FED_BY`), a penetration the power points that add its damage (`penCost`),
 * lifesteal and ability haste their worth a round (`drainCost`, `hasteCost`); a weapon's extra attack damage above its
 * kind's default die (`weaponPoints`) draws on the same budget as its powers via `itemBudget.weaponDuty` (floored at 0);
 * armor or resist above the piece its weight carries costs the Vitality whose armor it is; its powers what `powersSpend`
 * weighs them at its rarity's rank. Weight and the slot's own piece are free.
 */
export function itemSpend(it: Spendable, R: BudgetRules): Spend | null {
  if (it.type !== 'weapon' && it.type !== 'armor' && it.type !== 'accessory') return null;
  const rank = R.rarities[it.rar].rank, r = ratesAt(rank, R);
  const stats = bonusPoints(it.bonus, r, R);
  const weapon = it.type === 'weapon' ? weaponPoints(it, rank, r, R) : null;
  const free = freeGuard(it, R);
  const guard = (Math.max(0, it.armor - free.armor) + Math.max(0, it.resist - free.resist)) / r.armor;
  const powers = powersSpend(it, rank, R);
  const parts: SpendParts = { weapon, stats, guard, powers: powers.points };
  return { points: (weapon ?? 0) + stats + guard + powers.points, parts, unweighed: powers.unweighed };
}

// ── what a title spends (item-stats 6.7) ──
/** What a title's spend reads of it: its bonus, its band (absent is E) and its powers; a held title and a reward's both are one. */
export type TitleSpendable = { readonly bonus: Readonly<Partial<Record<BonusKey, number>>>; readonly band?: Rank } & Powers;
/** The rules a title's line reads: the budget's, and what a title of each band may spend. */
export type TitleRules = BudgetRules & Pick<Rules, 'titleBudget'>;
/**
 * What a title spends, in points on the sample wearer at the first level of its band (`bandOf`: absent is E), weighed as
 * an item at that rank is: its bonus at `BONUS_COST`, its powers by `powersSpend`. A title has no slot, weight or dice,
 * so nothing of it is free. What the budget cannot weigh is named, as an item's is.
 */
export function titleSpend(t: TitleSpendable, R: BudgetRules): Spend {
  const rank = bandOf(t), stats = bonusPoints(t.bonus, ratesAt(rank, R), R), powers = powersSpend(t, rank, R);
  return { points: stats + powers.points, parts: { weapon: null, stats, guard: 0, powers: powers.points }, unweighed: powers.unweighed };
}
/**
 * The lowest band a title fits: the first rank, E up, whose `titleBudget` holds the title weighed at that rank (a scaling
 * amount or a max HP bonus weighs less on a higher rank's wearer); null when it is past every band's, S's included.
 */
export const titleFit = (t: TitleSpendable, R: TitleRules): Rank | null =>
  RANKS.find(at => titleSpend({ ...t, band: at }, R).points <= R.titleBudget[at] + 1e-9) ?? null;

// ── the item maker's and the title's lines (design 2.4, item-stats 6.7) ──
const one = (n: number): string => { const t = Math.abs(n).toFixed(1); return n < 0 && t !== '0.0' ? `−${t}` : t; };
/** What a spend cannot weigh, in a sentence that leads with a space, or nothing when it weighs all of it. */
function withoutWords(s: Spend): string {
  const missing = s.unweighed.map(u => UNBUDGETED_WORDS[u]);
  return missing.length ? ` Does not include ${missing.join(' or ')}. Test ${missing.length > 1 ? 'them' : 'it'} in a fight.` : '';
}
/** A budget's points in words: "1 budget point", "2.5 budget points". */
const pointsWords = (n: number): string => `${Number(n.toFixed(1))} budget point${n === 1 ? '' : 's'}`;
/**
 * A title's spend line (item-stats 6.7): its spend against its band's budget, and the lowest band it fits (`titleFit`).
 * `over` when the spend is past its band's budget: said, never refused, as an item's line does, so an S title "and
 * more" is the GM's call. "Uses 1.2 of 1 point for a rank E title. Over budget. Fits rank D."
 */
export function titleLine(t: TitleSpendable, R: TitleRules): { readonly words: string; readonly over: boolean } {
  const band = bandOf(t), s = titleSpend(t, R), budget = R.titleBudget[band], fit = titleFit(t, R);
  const spent = `Uses ${one(s.points)} of ${pointsWords(budget)} for a rank ${band} title`, without = withoutWords(s);
  if (s.points <= budget + 1e-9) return { words: `${spent}. Fits rank ${fit ?? band}.${without}`, over: false };
  const where = fit === null ? `Above every rank, including rank S (${pointsWords(R.titleBudget.S)})` : `Fits rank ${fit}`;
  return { words: `${spent}. Over budget. ${where}.${without}`, over: true };
}
const held = (b: GradeBand): string => (b.low === null ? `up to ${one(b.high)}` : `${one(b.low)} to ${one(b.high)}`);
/** The parts shown inside parentheses for a weapon's spend line; empty for non-weapons (`parts.weapon === null`). */
function partsWords(parts: SpendParts): string {
  if (parts.weapon === null) return '';
  const bits = [`${one(parts.weapon)} ${BUDGET_WORDS.weapon}`];
  if (Math.abs(parts.stats) >= 0.05) bits.push(`${one(parts.stats)} ${BUDGET_WORDS.stats}`);
  if (Math.abs(parts.guard) >= 0.05) bits.push(`${one(parts.guard)} ${BUDGET_WORDS.guard}`);
  if (Math.abs(parts.powers) >= 0.05) bits.push(`${one(parts.powers)} ${BUDGET_WORDS.powers}`);
  return ` (${bits.join(', ')})`;
}
/**
 * The spend line under the item maker's preview: the points (with the weapon breakdown when `parts.weapon !== null`),
 * what the chosen grade holds, the grade that holds the spend when it is another, and what the budget cannot weigh.
 * `over` when the chosen grade is under the spend (past the tier's top, under any grade): a warning, never a refusal,
 * since the price reads the chosen grade.
 */
export function spendLine(s: Spend, R: BudgetRules, rar: Rarity, grade: Grade): { readonly words: string; readonly over: boolean } {
  const chosen = gradeBand(R, rar, grade), fit = gradeOfSpend(R, rar, s.points), label = (g: Grade): string => gradeLabel(rar, g);
  const without = withoutWords(s), spent = `Uses ${one(s.points)} budget points${partsWords(s.parts)}`;
  if (fit === null) return { words: `${spent}, above the ${label(1)} max (${one(gradeBand(R, rar, 1).high)}). Stronger than any ${label(0)} grade.${without}`, over: true };
  if (fit > grade) return { words: `${spent}, above ${label(grade)} (${held(chosen)}). Matches ${label(fit)} (${held(gradeBand(R, rar, fit))}).${without}`, over: true };
  if (fit < grade) return { words: `${spent}. ${label(grade)} range is ${held(chosen)}. Matches ${label(fit)} (${held(gradeBand(R, rar, fit))}).${without}`, over: false };
  return { words: `${spent}. ${label(grade)} range is ${held(chosen)}.${without}`, over: false };
}
