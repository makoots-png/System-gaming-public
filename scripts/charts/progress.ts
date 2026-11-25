// The charts of a hunter's progress and rank: the allocation of points (src/core/hunter/progress.ts `progressStep`,
// `PROGRESS_TABLE`), walked from a new hunter with every event on one stat; and where the rank stands against the level
// (src/core/hunter/record.ts `rankStep`, `RANK_TABLE`, `rankStanding`), walked over two levels and two ranks.
import { allocationOf, available, progressStep, undoableOn } from '../../src/core/hunter/progress.ts';
import type { ProgressAllocation, ProgressEvent } from '../../src/core/hunter/progress.ts';
import { rankStanding, rankStep } from '../../src/core/hunter/record.ts';
import type { ProgressRank } from '../../src/core/hunter/record.ts';
import { newHunter } from '../../src/core/save.ts';
import type { Hunter } from '../../src/core/save.ts';
import { RULES } from '../../src/core/rules.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { bfs, machine } from '../statecharts.ts';

const R = RULES;
const fieldsKey = (h: Hunter): string => JSON.stringify([h.level, h.xp, h.peakLevel, h.bonusPoints, h.spent, h.pending, h.stats, h.rank, h.rankBy]);

// ── the allocation ──
/** Every event of the allocation on Strength, from hunter `h`: Auto puts every point free on it. */
function progressEvents(h: Hunter): ProgressEvent[] {
  return [
    { type: 'raise', stat: 'str', role: 'player' }, { type: 'raise', stat: 'str', role: 'gm' },
    { type: 'lower', stat: 'str', role: 'player' }, { type: 'lower', stat: 'str', role: 'gm' },
    { type: 'takeAll' },
    { type: 'confirm' },
    { type: 'auto', plan: { str: available(h, R) } },
    { type: 'setStat', stat: 'str', value: h.stats.str + 1 },
    { type: 'level', level: h.level + 1, xp: 0 }, { type: 'level', level: h.level - 1, xp: 0 },
    { type: 'points', n: 1 }, { type: 'points', n: -1 },
    { type: 'revived' },
  ];
}
function progressMoves(h: Hunter): { event: ProgressEvent; to: Hunter }[] {
  return progressEvents(h).flatMap(event => {
    const to = progressStep(h, event, R);
    return isRefused(to) || fieldsKey(to) === fieldsKey(h) ? [] : [{ event, to }];
  });
}
const PROGRESS_KINDS = ['settled', 'allocating'] as const satisfies readonly ProgressAllocation['at'][];
function progressWords(h: Hunter): string {
  const free = available(h, R) > 0 ? 'points free' : 'no point free';
  return allocationOf(h).at === 'settled' ? `Settled, ${free}` : `Points pending Confirm, ${free}`;
}
function progressArrow(e: ProgressEvent, from: Hunter): string {
  switch (e.type) {
    case 'raise': return (from.pending[e.stat] ?? 0) < 0 ? '+ cancels a staged take-back' : available(from, R) > 0 ? '+ on a stat' : 'the GM\'s + with no point free (edits the stat)';
    case 'lower': return (from.pending[e.stat] ?? 0) > -undoableOn(from, e.stat) ? '− takes a point back (staged)' : 'the GM\'s − at the floor (edits the stat)';
    case 'takeAll': return 'Take all back (stages full reset)';
    case 'confirm': return 'Confirm';
    case 'auto': return 'Auto';
    case 'setStat': return 'the GM edits the stat';
    case 'xp': return 'XP given or taken';
    case 'level': return e.level < from.level && allocationOf(from).at === 'allocating' ? 'the level falls (XP, or the GM): the points pending handed back' : 'the level moves (XP, or the GM)';
    case 'points': return e.n >= 0 ? 'points given' : 'points taken (a quest\'s cost)';
    case 'setPoints': return 'the GM sets the points shown';
    case 'revived': return allocationOf(from).at === 'allocating' ? 'a raising from death (levels lost): the points pending handed back' : 'a raising from death (levels lost)';
  }
}

export const progress = machine<Hunter, ProgressEvent>({
  name: 'A hunter\'s points and their allocation',
  walked: 'Every state reachable from a new hunter in four events or fewer, under every event of the allocation on one stat (+ and − by each role, Take all back, Confirm, Auto with every point free, the GM\'s stat edit, a level up and down, a point given and taken, a raising from death), breadth first.',
  walk: () => bfs([newHunter(R)], progressMoves, fieldsKey, 4),
  kinds: PROGRESS_KINDS,
  kindsOf: h => [allocationOf(h).at],
  views: [{
    title: 'Points free, pending and confirmed',
    note: 'Pending points are signed per stat: positive counts are points placed and negative counts are confirmed points staged to take back (down to `-undoableOn`). Placing leaves points free while pending; taken-back points become free only on Confirm (paid through `respec.ts confirmPoints`). At the floor, a player\'s − is refused (`nothing-spent`) while the GM\'s − edits the stat. The GM\'s edit of a stat confirms what was pending on it. A level lost, by the GM, by XP or by a raising from death, hands the points pending back (SMX-rules-7.1, the owner, Nov 22), so a hunter never owes a point it had not confirmed; a deduction takes only the points free (unruled). Every change of level, XP, points or stats is an event of `progressStep`; the chart leaves out the GM\'s points shown, which acts as the GM\'s edit.',
    hides: '',
    state: progressWords,
    step: progressArrow,
  }],
  where: [
    ['The union', '`ProgressAllocation`, `ProgressEvent` and `ProgressRefusal` in `src/core/hunter/progress.ts`'],
    ['What changes it', '`progressStep(h, event, R)` and its `PROGRESS_TABLE`, named by `raise`, `lower`, `takeAll`, `confirm`, `raiseMany`, `setStat`, `addXp`, `atLevel`, `grantPoints`, `setPoints` and `raisedLevels`'],
    ['Who calls it', '`src/core/hunter/grant.ts` (rewards, `levelEdit`, a raising in `sheetEdit`), `src/core/hunter/respec.ts` (`confirmPoints`), `src/views/hunter.js` (+, −, Take all back, Confirm, Auto, the GM\'s edits) in `store.apply`'],
    ['The test to copy', '`tests/progress.test.ts`, "the allocation"'],
    ['The recipe', 'docs/guide/hunters.md, "A state or event of the ... machine"'],
  ],
});

// ── the rank ──
/** What moves the rank: the GM sets the level (the rank then hears `levelMoved`, as grant.ts `levelled` does), re-evaluates, or sets a rank. */
type RankMove = { readonly type: 'level'; readonly level: number } | { readonly type: 'reevaluate' } | { readonly type: 'set'; readonly rank: 'E' | 'D' };
const RANK_WALK: readonly RankMove[] = [
  { type: 'level', level: R.rankLevels.D }, { type: 'level', level: R.rankLevels.E },
  { type: 'reevaluate' }, { type: 'set', rank: 'E' }, { type: 'set', rank: 'D' },
];
function rankMove(h: Hunter, e: RankMove): Hunter | null {
  if (e.type === 'set') return rankStep(h, e);
  if (e.type === 'reevaluate') { const r = rankStep(h, e, R); return isRefused(r) ? null : r; }
  const leveled = progressStep(h, { type: 'level', level: e.level, xp: 0 }, R);
  const r = rankStep(leveled, { type: 'levelMoved' }, R);
  return isRefused(r) ? null : r;
}
const RANK_KINDS = ['follows', 'behind', 'above'] as const satisfies readonly ProgressRank['at'][];
const RANK_WORDS: { readonly [S in ProgressRank['at']]: string } = {
  follows: 'The rank the level earns',
  behind: 'Below the level\'s rank (Re-evaluate offered)',
  above: 'Above the level\'s rank (the GM\'s, set by hand)',
};
function rankArrow(e: RankMove): string {
  switch (e.type) {
    case 'level': return e.level >= R.rankLevels.D ? 'the level rises past a rank\'s first level' : 'the level drops below it';
    case 'reevaluate': return 'the GM taps Re-evaluate';
    case 'set': return 'the GM sets a rank';
  }
}

export const rank = machine<Hunter, RankMove>({
  name: 'A hunter\'s rank',
  walked: `Every state reachable from a new hunter, under the ${RANK_WALK.length} moves of the level between the first levels of ranks E and D, Re-evaluate and the GM's choice of E or D, breadth first.`,
  walk: () => bfs([newHunter(R)], h => RANK_WALK.flatMap(event => { const to = rankMove(h, event); return to === null || fieldsKey(to) === fieldsKey(h) ? [] : [{ event, to }]; }), fieldsKey),
  kinds: RANK_KINDS,
  kindsOf: h => [rankStanding(h, R).at],
  views: [{
    title: 'Where a hunter\'s rank stands against its level',
    note: 'Only the rank and who set it are stored; where it stands is read with the level (`rankStanding`). A level risen keeps the rank: a rank behind waits for the GM\'s Re-evaluate. A level lost below the rank takes the rank down to the level\'s, unless the GM set the rank by hand (`rankBy`), when it stays with its check bonus and the path tiers it opened (SMX-rules-7.2, the owner, Nov 22). Re-evaluate is refused (`not-eligible`) unless the rank is behind. A new rank is a fact of the chronicle.',
    hides: '',
    state: h => RANK_WORDS[rankStanding(h, R).at],
    step: rankArrow,
  }],
  where: [
    ['The union', '`ProgressRank` and `ProgressRankEvent` in `src/core/hunter/record.ts`'],
    ['What changes it', '`rankStep(h, event, R)` and its `RANK_TABLE`, named by `setRank` and `reevaluate`; `rankStanding` reads where it stands'],
    ['Who calls it', '`src/core/hunter/grant.ts` `levelled` (`levelMoved`), `src/views/hunter.js` (Re-evaluate, the GM\'s rank) in `store.apply`'],
    ['The test to copy', '`tests/record.test.ts`, the rank'],
    ['The recipe', 'docs/guide/hunters.md, "A state or event of the ... machine"'],
  ],
});
