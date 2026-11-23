// effects.ts: what an item does when it is used, as the ops of the fight (src/core/combat/effect-ops.ts), and its card's
// words. Pure. What an item adds while worn is its stats and gear numbers, which src/core/hunter/sheet.ts reads.
// src/views/effects.js rolls and applies the ops to a hunter: `amountDice` says what to roll, `amountOn` what it comes to.
import { FULL_HEAL, healsFully, opLines } from './combat/effect-ops.ts';
import { atTier } from './combat/op-amount.ts';
import type { DescribeRules, Op, Source } from './combat/effect-ops.ts';
import { diceOf, evaluate } from './formula.ts';
import type { FormulaBody, Dice } from './formula.ts';
import { TIERS, rankIdx } from './rules.ts';
import { REVIVE_HP } from './hunter/vitals.ts';
import type { Rank } from './rules.ts';
import type { Grade } from './registry/items.ts';

export { FULL_HEAL, healsFully };

/** What this file reads of an item. */
export type ItemEffects = { readonly rar: string; readonly grade?: Grade; readonly effects?: readonly Op[]; readonly revive?: true; readonly rankCap?: true };
/** What an item that revives says it does (src/core/hunter/use.ts `useItem`). */
export const REVIVE_TEXT = `Revives a dead hunter at ${REVIVE_HP} HP (outside a fight).`;
/** What a rank-capped consumable says on its detail card (src/core/hunter/use.ts `usableAtRank`). */
export const RANK_CAP_TEXT = 'For hunters of this rarity\'s rank or lower.';

/** Every op an item does when used. */
export const effectsOf = (item: ItemEffects): Op[] => [...(item.effects ?? [])];

/**
 * What an item does at `when`: its ops when used, none when worn (a worn item's stats are its fields). Kept for the views
 * that still ask for `equip` until W6 moves them.
 */
export const itemOps = (item: ItemEffects, when: 'use' | 'equip'): Op[] => (when === 'use' ? effectsOf(item) : []);

/** An item's tier: its rarity's place in the rules' rarities, common 0 to mythic 5. */
const rarityTier = (rar: string): number => Math.max(0, Math.min(5, TIERS.indexOf(rar)));

/** An item as the source of a status it applies: no combatant, at its rarity's tier. */
export const itemSource = (item: Pick<ItemEffects, 'rar'>): Source => ({ id: null, tier: rarityTier(item.rar) });

/** A status the GM or the player puts on a hunter by hand: no combatant, at the hunter's rank's tier (E 0 to S 5). */
export const gmSource = (rank: Rank): Source => ({ id: null, tier: rankIdx(rank) });

/** The sign a grade adds to its rarity's word: Epic−, Epic, Epic+ (economy design 2.1). */
const GRADE_SIGN: Readonly<Record<Grade, string>> = { [-1]: '−', 0: '', 1: '+' };
/** An item's tier and grade in words, its rarity's word with the grade's sign: `gradeLabel('epic', 1)` is Epic+. */
export const gradeLabel = (rar: string, grade: Grade): string => `${rar[0]!.toUpperCase()}${rar.slice(1)}${GRADE_SIGN[grade]}`;

/**
 * What an item's card says it does: its grade's label when it is a minus or a plus (a middle item's rarity says it all),
 * that it revives, then its ops (all of them, or `ops`), each number at the item's rarity tier. With a `wearer` (the
 * hunter who holds it), an amount that reads the wearer's numbers says what it comes to on them: "Shield: 10 + 20% of max
 * HP (now 34)".
 */
export function describeItem(R: DescribeRules, item: ItemEffects, ops: readonly Op[] = effectsOf(item), wearer: FormulaBody | null = null): string[] {
  return [
    ...(item.grade ? [gradeLabel(item.rar, item.grade)] : []),
    ...(item.revive ? [REVIVE_TEXT] : []),
    ...(item.rankCap && !item.revive ? [RANK_CAP_TEXT] : []),
    ...opLines(ops, itemSource(item).tier, R, wearer),
  ];
}

/** An op with an amount: what a use outside a fight rolls and applies to a hunter. */
export type AmountOp = Extract<Op, { readonly op: 'damage' | 'heal' | 'mana' | 'fatigue' }>;
/** The dice one use of `o` rolls at `tier`, in reading order. */
export const amountDice = (o: AmountOp, tier: number): Dice[] => diceOf(atTier(o.amount, tier));
/**
 * What `o` comes to outside a fight, rounded: its formula at `tier` with the dice `amountDice` asked for, the hunter both
 * user and target (an item or a skill used on oneself; a damage op that goes to another reads the user's numbers too).
 */
export const amountOn = (o: AmountOp, tier: number, body: FormulaBody, dice: readonly number[]): number =>
  Math.round(evaluate(atTier(o.amount, tier), { user: body, target: body, charge: 0, dice }));
