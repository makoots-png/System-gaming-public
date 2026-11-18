// The chart of a quest's life (src/core/hunter/quests.ts), walked with the events of tests/models/quest-events.ts.
import { questStep } from '../../src/core/hunter/quests.ts';
import type { QuestEvent } from '../../src/core/hunter/quests.ts';
import { QUEST_STATUSES } from '../../src/core/save.ts';
import type { Quest, QuestStatus } from '../../src/core/save.ts';
import { WALK_EVENTS, questIn } from '../../tests/models/quest-events.ts';
import { bfs, machine } from '../statecharts.ts';

/** The words of the Quests view's tabs and card. */
const LABEL: { readonly [S in QuestStatus]: string } = { active: 'Active', done: 'Completed', failed: 'Failed' };

function step(e: QuestEvent): string {
  switch (e) {
    case 'complete': return 'Complete (the objectives fill)';
    case 'fail': return 'Fail, or an urgent quest past its due time';
    case 'reopen': return 'Reopen (not a Job Change step)';
    case 'reset': return 'the daily rollover (a daily only)';
  }
}

const AT = '2026-11-14T10:00:00.000Z';
export const quest = machine<Quest, QuestEvent>({
  name: 'A quest',
  walked: `Every quest reachable from an active side quest and an active daily (tests/models/quest-events.ts) under the ${WALK_EVENTS.length} events of the walk in tests/quests.test.ts, breadth first.`,
  walk: () => bfs([questIn('active'), questIn('active', 'daily')], q => WALK_EVENTS.flatMap(event => {
    const to = questStep(q, event, AT);
    return 'ok' in to ? [] : [{ event, to }];
  }), q => `${q.kind}:${q.status}:${q.objectives.map(o => o.progress).join(',')}`),
  kinds: QUEST_STATUSES,
  kindsOf: q => [q.status],
  views: [{
    title: 'A quest, from issued to its end',
    note: 'Both the side quest and the daily are drawn; only a daily is reset by the rollover, from any status. A completed quest stays completed (a daily until its next reset). Deleting a quest takes it off the list from any status and is not drawn. Progress on an objective is not a status: it changes only while the quest is active.',
    hides: '',
    state: q => `${LABEL[q.status]}${q.kind === 'daily' ? ' (daily)' : ''}`,
    step,
  }],
  where: [
    ['The union', '`QUEST_STATUSES` and `questState` in `src/core/save.ts`; `QuestEvent` in `src/core/hunter/quests.ts`'],
    ['What changes it', '`questStep(quest, event, at)` and its `TABLE`; the steps `completeQuest`, `failQuest`, `reopenQuest`, `rollover`'],
    ['Who calls it', '`src/views/quests.js` through `store.apply`'],
    ['The test to copy', '`tests/quests.test.ts`; the walk\'s events are in `tests/models/quest-events.ts`'],
    ['The recipe', 'AGENTS.md, "A state or event of the ... machine"'],
  ],
});
