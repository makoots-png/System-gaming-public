// The chart of a missed daily's penalty (src/core/hunter/penalty.ts), walked with the moves of the walk in
// tests/penalty.test.ts.
import type { PenaltyEvent } from '../../src/core/hunter/penalty.ts';
import { DAILY, WALK_MOVES, play } from '../../tests/models/penalty-events.ts';
import type { PenaltyHunter, PenaltyMove } from '../../tests/models/penalty-events.ts';
import { bfs, machine } from '../statecharts.ts';

/** A hunter's penalty is none or one penalty (`Penalty | null`). */
type PenaltyKind = 'none' | 'penalized';
/** The words of the sheet's chip and the GM board's PENALTY chip. */
const LABEL: { readonly [K in PenaltyKind]: string } = { none: 'No penalty', penalized: 'Penalized' };
const KINDS = Object.keys(LABEL) as PenaltyKind[];
const kindOf = (h: PenaltyHunter): PenaltyKind => (h.penalty ? 'penalized' : 'none');

/** The status of the Penalty Zone quest the penalty is tied to, as its quest card shows it. */
const tiedStatus = (h: PenaltyHunter) => h.quests.find(q => q.id === h.penalty?.questId)?.status;
const ZONE: Partial<Record<string, string>> = { active: 'Penalty Zone quest open', failed: 'Penalty Zone quest failed' };

function state(h: PenaltyHunter): string | readonly string[] {
  if (!h.penalty) return LABEL.none;
  const zone = ZONE[tiedStatus(h) ?? ''];
  if (!zone) throw new Error(`a penalty tied to a quest that is ${tiedStatus(h) ?? 'gone'}, which the chart has no box for`);
  return [LABEL.penalized, zone];
}

/** A Penalty Zone quest that has failed shows Reopen, not Complete: completing it straight away is hidden. */
const completesFailed = (e: PenaltyMove, from: PenaltyHunter): boolean =>
  e.type === 'questCompleted' && from.quests.some(q => q.id === e.questId && q.status !== 'active');

function step(e: PenaltyMove, from: PenaltyHunter): string | null {
  if (completesFailed(e, from)) return null;
  switch (e.type) {
    case 'dailyMissed': return from.penalty ? 'another daily is missed, and the System issues a new Penalty Zone quest' : 'a daily is missed at the reset, and the System issues a Penalty Zone quest';
    case 'questCompleted': return 'the Penalty Zone quest is completed';
    case 'questDeleted': return 'the GM deletes the Penalty Zone quest (a pardon)';
    case 'questFailed': return 'the Penalty Zone quest is failed';
    case 'questReopened': return 'the Penalty Zone quest is reopened';
  }
}

/** The penalty's start and days are left out of the key: no step reads them but to add to the days. */
const key = (h: PenaltyHunter): string => JSON.stringify({ tied: h.penalty?.questId ?? null, quests: h.quests });
const isEvent = (m: PenaltyMove): m is PenaltyEvent => m.type !== 'questFailed' && m.type !== 'questReopened';

export const penalty = machine<PenaltyHunter, PenaltyMove>({
  name: 'A missed daily\'s penalty',
  walked: `Every penalty reachable from a hunter with no penalty and one open daily under the ${WALK_MOVES.length} moves of the walk in tests/penalty.test.ts (tests/models/penalty-events.ts: ${WALK_MOVES.filter(isEvent).length} penalty events, and a player failing or reopening a quest), breadth first.`,
  walk: () => bfs<PenaltyHunter, PenaltyMove>([{ penalty: null, quests: [DAILY] }], h => WALK_MOVES.map(event => ({ event, to: play(h, event).next })), key),
  kinds: KINDS,
  kindsOf: h => [kindOf(h)],
  views: [{
    title: 'A penalty, from a missed daily to lifted',
    note: 'The chart shows the Penalized chip on the sheet (PENALTY on the GM board) and the card of the Penalty Zone quest it is tied to. It leaves out the days the penalty counts, which only grow while it lasts, and the −2 on checks, which holds in every Penalized box. A missed daily while the quest is open adds to the days and issues no quest. A player\'s phone shows no Delete on the tied quest, and its delete is refused; deleting or completing any other quest changes nothing. Failing the quest does not lift the penalty. Completing the quest lifts the penalty from Penalty Zone quest open; the GM\'s delete lifts it from either box.',
    hides: 'completing a Penalty Zone quest that has failed: its card offers Reopen, not Complete',
    state,
    step,
  }],
  where: [
    ['The state', '`Penalty` (`since`, `days`, `questId`) or none, in `src/core/hunter/penalty.ts`'],
    ['What changes it', '`penaltyAfter(penalty, event, quests)` (`dailyMissed`, `questCompleted`, `questDeleted`); `canDeleteQuest` for the Delete button'],
    ['Who calls it', '`penaltyEvent` in `src/views/quests.js` (the daily rollover, Complete and Delete)'],
    ['The test to copy', '`tests/penalty.test.ts`; the walk\'s moves are in `tests/models/penalty-events.ts`'],
    ['The recipe', 'AGENTS.md, "To add a field to a hunter" (a penalty field)'],
  ],
});
