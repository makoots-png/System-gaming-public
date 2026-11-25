// title-card.ts: what a title's powers say on its card (item-stats 6.7), in the words a table reads. Pure. The card of a
// title the hunter holds and the reward editor's row for a title both draw these lines, so the two say the same thing.
import { effectWord } from './combat/damage-type.ts';
import { describeStatus, opLines } from './combat/effect-ops.ts';
import type { Ability } from './combat/ability-types.ts';
import { roundsOf } from './combat/timeline.ts';
import { amountWords } from './formula.ts';
import type { FormulaBody } from './formula.ts';
import { formulaOf, gateLine } from './registry/ability-kinds.ts';
import type { Powers } from './registry/powers.ts';
import { rankIdx } from './rules.ts';
import type { Rank, Rules } from './rules.ts';

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

/** An ability's lines on a title's card: its name, what it does with the amount as the holder reads it, its ops, its wait and its gates. */
function activeLines(a: Ability, rank: Rank, wearer: FormulaBody | null, R: Rules): string[] {
  const f = formulaOf(a, R), what = effectWord(a, R), rounds = roundsOf(a.cost.cooldown, R, 'near');
  const wait = [rounds ? `Ready again after ${plural(rounds, 'round')}.` : '', ...(a.gates ?? []).map(g => gateLine(g, R.conditions))].filter(Boolean).join(' ');
  return [
    `Can use in a fight: ${a.name}`,
    ...(what && f ? [`${what}: ${amountWords(f, wearer)}`] : []),
    ...opLines(a.ops, rankIdx(rank), R, wearer),
    ...(wait ? [wait] : []),
  ];
}

/**
 * The lines of what a title gives in a fight, for a holder of `rank` whose numbers are `wearer` (null: no holder, so an
 * amount that grows with a number shows no "now"): its worn status, then its active. Empty for a title with neither.
 */
export function titlePowerLines(p: Powers, rank: Rank, wearer: FormulaBody | null, R: Rules): string[] {
  return [
    ...(p.worn ? describeStatus(p.worn, rankIdx(rank), R).map(l => `In a fight: ${l}`) : []),
    ...(p.active ? activeLines(p.active, rank, wearer, R) : []),
  ];
}
