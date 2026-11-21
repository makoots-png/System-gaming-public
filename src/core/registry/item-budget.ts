// item-budget.ts: what an item of a tier and a grade may hold, and what an item spends of it (economy design 2.3 and
// 2.4, the owner's ruling 1: "some items lower stats but better abilities"). The unit is the point, one point on a stat;
// everything a worn item carries is converted to points on the item maker's sample wearer (`SAMPLE_WEARER`) at the first
// level of its rarity's rank. A tier's budget is a span of points cut in three grades; the price reads the grade the
// maker picked (items.ts `valueOf`), never the spend, so the spend line only tells the maker whether they agree. A block
// with no measure is named in `Spend.unweighed`, never counted as 0, as worth.ts does. Tests: tests/item-budget.test.ts.
import { RANKS } from '../rules.ts';
import type { PerkKey, Rank, Rules } from '../rules.ts';
import { kitGear, pointsAt, sheetOf, split } from '../hunter/derive.ts';
import type { Kit, Sheet } from '../hunter/derive.ts';
import { average, NO_KIT, parseFormula } from '../formula.ts';
import type { Scope } from '../formula.ts';
import { gradeLabel } from '../effects.ts';
import { GRADES, KIT_SHARE, SAMPLE_WEARER, piece, weightOf } from './items.ts';
import type { ArmorSlot, Grade, Item, Rarity } from './items.ts';
import { KINDS } from './ability-kinds.ts';
import { BUILD_OF, referenceBody, wornWorth } from './worth.ts';
import type { WorthRules } from './worth.ts';

/** The rule numbers the budget reads: the body and the fight's yardstick (worth.ts), each rarity's rank, the budget's share and the slots. */
export type BudgetRules = WorthRules & Pick<Rules, 'rarities' | 'itemBudget' | 'slots'>;

// ── the budget of a tier and a grade (design 2.4) ──
/** A rank's middle budget: `itemBudget.share` of the points a hunter of the rank has at its first level, over the slots. */
export const middleBudget = (R: BudgetRules, rank: Rank): number =>
  R.itemBudget.share * pointsAt(R.rankLevels[rank], R) / R.slots.length;

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
/** What an item carries that the budget has no measure for: armor its hits ignore, and the standing ops of a worn status. */
export type Unbudgeted = 'penFlat' | 'worn';
const UNBUDGETED_WORDS: { readonly [U in Unbudgeted]: string } = {
  penFlat: 'armor ignored on a hit', worn: 'what its worn status does that its worth line cannot weigh',
};
/** An item's spend in points beyond its slot's free numbers, and what it carries that the budget cannot weigh. */
export type Spend = { readonly points: number; readonly unweighed: readonly Unbudgeted[] };
/** What a spend reads of an item. */
export type Spendable = Pick<Item, 'rar' | 'type' | 'slot' | 'dice' | 'bonus' | 'armor' | 'resist'> & Partial<Pick<Item, 'weight' | 'penFlat' | 'worn'>>;

/** The points a conversion is read over: max HP and max mana are whole numbers, so one point's share is read off ten. */
const READ_OVER = 10;
/** What one point buys on the sample wearer at the first level of a rank (block [2.3]), the body itself, and one standard action in damage. */
type Rates = {
  readonly hpMax: number; readonly manaMax: number; readonly phys: number; readonly armor: number;
  readonly body: Scope['user']; readonly strike: number;
};
function ratesAt(rank: Rank, R: BudgetRules): Rates {
  const level = R.rankLevels[rank], stats = split(SAMPLE_WEARER.main, SAMPLE_WEARER.second, pointsAt(level, R), R);
  const sheet = (perks: Partial<Record<PerkKey, number>>): Sheet => sheetOf({ stats, level, gear: kitGear(SAMPLE_WEARER.kit, R), perks }, R);
  const bare = sheet({}), per = (k: PerkKey, n: 'hpMax' | 'manaMax' | 'phys' | 'armor'): number => (sheet({ [k]: READ_OVER })[n] - bare[n]) / READ_OVER;
  const body = { stats, sheet: bare };
  // worth.ts's yardstick: the strike's dice plus its power times the bruiser's phys
  const strike = strikeDie(body, R) + KINDS.strike.power * referenceBody(BUILD_OF.strike, rank, R).sheet.phys;
  return { hpMax: per('vit', 'hpMax'), manaMax: per('pow', 'manaMax'), phys: per('str', 'phys'), armor: per('vit', 'armor'), body, strike };
}
/** The mean of dice text on `body`, or null when the rules refuse it. */
function meanOf(text: string, body: Scope['user'], R: BudgetRules): number | null {
  const p = parseFormula(text, R);
  return p.ok ? average(p.formula, { user: body, target: body, charge: 0, kit: NO_KIT }) : null;
}
/** The mean of the reference strike's own dice (`KINDS.strike`, 1d8): the free die of the first tier. */
const strikeDie = (body: Scope['user'], R: BudgetRules): number => meanOf(KINDS.strike.dice ?? '0', body, R) ?? 0;
/** The mean of a weapon's dice as the fight rolls them: text the rules refuse rolls the strike's own (abilities.ts `weaponAttack`). */
const dieMean = (text: string, body: Scope['user'], R: BudgetRules): number => meanOf(text, body, R) ?? strikeDie(body, R);
/** Each bonus key's cost in points: a stat point is the unit, max HP and max mana what the stat that gives them would cost. */
const BONUS_COST: { readonly [K in PerkKey]: (r: Rates) => number } = {
  str: () => 1, agi: () => 1, vit: () => 1, pow: () => 1, ins: () => 1, pre: () => 1, ctl: () => 1, dis: () => 1,
  hpMax: r => 1 / r.hpMax, manaMax: r => 1 / r.manaMax,
};
const isArmorSlot = (s: Spendable['slot']): s is ArmorSlot => s !== null && Object.hasOwn(KIT_SHARE, s);
/**
 * The armor and resist a slot gives for free: the piece (`piece`) of the heaviest kit whose piece in that slot weighs no
 * more than the item, since weight is what pays for a kit's guard. None for a lighter item, or a slot no kit fills.
 */
function freeGuard(it: Spendable, R: BudgetRules): { readonly armor: number; readonly resist: number } {
  const slot = it.slot, w = weightOf(it);
  if (!isArmorSlot(slot)) return { armor: 0, resist: 0 };
  const fits = (Object.keys(R.fight.kits) as Kit[]).map(k => piece(k, slot, it.rar, R)).filter(p => p.weight <= w);
  return fits.reduce((a, p) => (p.weight >= a.weight ? p : a), { weight: -1, armor: 0, resist: 0 });
}

/**
 * What a worn item spends, in points on the sample wearer at its rarity's rank (design 2.3); null for an item nobody
 * wears (a consumable, a material, a key), which has no budget. Each bonus point on a stat is one; max HP and max mana
 * cost the Vitality and Power that would give them; a weapon's mean die above its tier's free die (the strike's die plus
 * `weaponStep` a tier above the first; below it, less than nothing) costs the Strength whose `phys` would deal it; armor
 * or resist above the piece its weight carries costs the Vitality whose armor it is; a worn status its worth a round
 * (`wornWorth`) in standard actions of damage, at the same rate as damage. Weight and the slot's own piece are free.
 */
export function itemSpend(it: Spendable, R: BudgetRules): Spend | null {
  if (it.type !== 'weapon' && it.type !== 'armor' && it.type !== 'accessory') return null;
  const rank = R.rarities[it.rar].rank, r = ratesAt(rank, R), unweighed: Unbudgeted[] = [];
  let points = (Object.keys(BONUS_COST) as PerkKey[]).reduce((n, k) => n + (it.bonus[k] ?? 0) * BONUS_COST[k](r), 0);
  if (it.type === 'weapon') {
    const free = strikeDie(r.body, R) + R.itemBudget.weaponStep * RANKS.indexOf(rank);
    points += (dieMean(it.dice, r.body, R) - free) / r.phys;
  }
  if (it.penFlat) unweighed.push('penFlat');
  const guard = freeGuard(it, R);
  points += (Math.max(0, it.armor - guard.armor) + Math.max(0, it.resist - guard.resist)) / r.armor;
  if (it.worn) {
    const w = wornWorth(it.worn, R, rank);
    points += w.worth * r.strike / r.phys;
    if (w.unweighed.length) unweighed.push('worn');
  }
  return { points, unweighed };
}

// ── the item maker's line (design 2.4) ──
const one = (n: number): string => { const t = Math.abs(n).toFixed(1); return n < 0 && t !== '0.0' ? `−${t}` : t; };
const held = (b: GradeBand): string => (b.low === null ? `up to ${one(b.high)}` : `${one(b.low)} to ${one(b.high)}`);
/**
 * The spend line under the item maker's preview: the points, what the chosen grade holds, the grade that holds the spend
 * when it is another, and what the budget cannot weigh. `over` when the chosen grade is under the spend (past the
 * tier's top, under any grade): a warning, never a refusal, since the price reads the chosen grade.
 */
export function spendLine(s: Spend, R: BudgetRules, rar: Rarity, grade: Grade): { readonly words: string; readonly over: boolean } {
  const chosen = gradeBand(R, rar, grade), fit = gradeOfSpend(R, rar, s.points), label = (g: Grade): string => gradeLabel(rar, g);
  const missing = s.unweighed.map(u => UNBUDGETED_WORDS[u]);
  const without = missing.length ? ` Without ${missing.join(' and ')}, which the budget cannot weigh: test ${missing.length > 1 ? 'them' : 'it'} in a fight.` : '';
  const spent = `Spends ${one(s.points)} points`;
  if (fit === null) return { words: `${spent}, past the top of ${label(1)} (${one(gradeBand(R, rar, 1).high)}): stronger than any grade of ${label(0)}.${without}`, over: true };
  if (fit > grade) return { words: `${spent}, more than ${label(grade)} holds (${held(chosen)}): this is ${label(fit)} (${held(gradeBand(R, rar, fit))}).${without}`, over: true };
  if (fit < grade) return { words: `${spent}. ${label(grade)} holds ${held(chosen)}; this is ${label(fit)} (${held(gradeBand(R, rar, fit))}).${without}`, over: false };
  return { words: `${spent}. ${label(grade)} holds ${held(chosen)}.${without}`, over: false };
}
