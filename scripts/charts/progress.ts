// The charts of a hunter's progress and rank: the allocation of points (src/core/hunter/progress.ts `progressStep`,
// `PROGRESS_TABLE`), walked from a new hunter with every event on one stat; and where the rank stands against the level
// (src/core/hunter/record.ts `rankStep`, `RANK_TABLE`, `rankStanding`), walked over two levels and two ranks.
import { allocationOf, available, progressStep } from '../../src/core/hunter/progress.ts';
import type { ProgressAllocation, ProgressEvent } from '../../src/core/hunter/progress.ts';
import { rankStanding, rankStep } from '../../src/core/hunter/record.ts';
import type { ProgressRank } from '../../src/core/hunter/record.ts';
import { newHunter } from '../../src/core/save.ts';
import type { Hunter } from '../../src/core/save.ts';
import { RULES } from '../../src/core/rules.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { bfs, machine } from '../statecharts.ts';

const R = RULES;
const fieldsKey = (h: Hunter): string => JSON.stringify([h.level, h.xp, h.peakLevel, h.bonusPoints, h.spent, h.pending, h.stats, h.rank]);

// ── the allocation ──
/** Every event of the allocation on Strength, from hunter `h`: Auto puts every point free on it. */
function progressEvents(h: Hunter): ProgressEvent[] {
  return [
    { type: 'raise', stat: 'str', role: 'player' }, { type: 'raise', stat: 'str', role: 'gm' },
    { type: 'lower', stat: 'str', role: 'player' }, { type: 'lower', stat: 'str', role: 'gm' },
    { type: 'confirm' },
    { type: 'auto', plan: { str: available(h, R) } },
    { type: 'setStat', stat: 'str', value: h.stats.str + 1 },
    { type: 'level', level: h.level + 1, xp: 0 }, { type: 'level', level: h.level - 1, xp: 0 },
    { type: 'points', n: 1 }, { type: 'points', n: -1 },
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
    case 'raise': return available(from, R) > 0 ? '+ on a stat' : 'the GM\'s + with no point free (edits the stat)';
    case 'lower': return (from.pending[e.stat] ?? 0) > 0 ? '− on a point pending' : 'the GM\'s − on a confirmed stat (edits it)';
    case 'confirm': return 'Confirm';
    case 'auto': return 'Auto';
    case 'setStat': return 'the GM edits the stat';
    case 'start': return 'starting stats';
    case 'xp': return 'XP given or taken';
    case 'level': return 'the level moves (XP, or the GM)';
    case 'points': return e.n >= 0 ? 'points given' : 'points taken (a quest\'s cost)';
    case 'setPoints': return 'the GM sets the points shown';
  }
}

export const progress = machine<Hunter, ProgressEvent>({
  name: 'A hunter\'s points and their allocation',
  walked: 'Every state reachable from a new hunter in four events or fewer, under every event of the allocation on one stat (+ and − by each role, Confirm, Auto with every point free, the GM\'s stat edit, a level up and down, a point given and taken), breadth first.',
  walk: () => bfs([newHunter(R)], progressMoves, fieldsKey, 4),
  kinds: PROGRESS_KINDS,
  kindsOf: h => [allocationOf(h).at],
  views: [{
    title: 'Points free, pending and confirmed',
    note: 'A point put on a stat is pending, not spent: it leaves the points free while it waits, and Confirm moves it into the stat. A player\'s − takes back only a pending point (with none, it is refused); the GM\'s − with nothing pending, and the GM\'s + with no point free, edit the stat. The GM\'s edit of a stat confirms what was pending on it. A level lost keeps the points pending, so a hunter can hold fewer points than it spent (no point free), and a deduction takes only the points free (both wait on ruling SMX-rules-7.1). Every change of level, XP, points or stats is an event of `progressStep`; the chart leaves out the starting stats and the GM\'s points shown, which act as the GM\'s edits.',
    hides: '',
    state: progressWords,
    step: progressArrow,
  }],
  where: [
    ['The union', '`ProgressAllocation`, `ProgressEvent` and `ProgressRefusal` in `src/core/hunter/progress.ts`'],
    ['What changes it', '`progressStep(h, event, R)` and its `PROGRESS_TABLE`, named by `raise`, `lower`, `confirm`, `raiseMany`, `setStat`, `startingStats`, `addXp`, `atLevel`, `grantPoints` and `setPoints`'],
    ['Who calls it', '`src/core/hunter/grant.ts` (rewards, `levelEdit`), `src/views/hunter.js` (+, −, Confirm, Auto, the GM\'s edits) in `store.apply`'],
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
  above: 'Above the level\'s rank (the GM\'s, or kept after levels lost)',
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
    note: 'Only the rank is stored; where it stands is read with the level (`rankStanding`). A level moved keeps the rank: a rank behind waits for the GM\'s Re-evaluate, and a rank above stays, with its check bonus and the path tiers it opened (ruling SMX-rules-7.2 waits; it needs a GM\'s mark stored beside the rank). Re-evaluate is refused (`not-eligible`) unless the rank is behind. A new rank is a fact of the chronicle.',
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
