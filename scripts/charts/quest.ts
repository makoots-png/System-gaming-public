// The chart of a quest's life (src/core/hunter/quests.ts), walked with the events of tests/models/quest-events.ts.
import { QUEST_PHASES, questPhase, questStep } from '../../src/core/hunter/quests.ts';
import type { QuestEvent, QuestPhase } from '../../src/core/hunter/quests.ts';
import type { Quest } from '../../src/core/save.ts';
import { FORM_WALK, WALK_EVENTS, questIn } from '../../tests/models/quest-events.ts';
import { QUEST_FORM_CLOSED, QUEST_FORM_STATES, questFormStep } from '../../src/core/hunter/quest-form.ts';
import type { QuestFormEvent, QuestFormState } from '../../src/core/hunter/quest-form.ts';
import { bfs, machine } from '../statecharts.ts';

/** The words of the Quests view's tabs and card; an untold quest is Completed with its QUEST COMPLETE window waiting. */
const LABEL: { readonly [P in QuestPhase]: string } = { active: 'Active', untold: 'Completed, its window waiting', done: 'Completed', failed: 'Failed' };

function step(e: QuestEvent): string {
  switch (e) {
    case 'complete': return 'Complete tapped (the objectives fill)';
    case 'counted': return 'the System counts its last objective full';
    case 'told': return 'its QUEST COMPLETE window answered';
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
  }), q => `${q.kind}:${questPhase(q)}:${q.objectives.map(o => o.progress).join(',')}`),
  kinds: QUEST_PHASES,
  kindsOf: q => [questPhase(q)],
  views: [{
    title: 'A quest, from issued to its end',
    note: 'Both the side quest and the daily are drawn; only a daily is reset by the rollover, from any phase. A completed quest stays completed (a daily until its next reset). A quest the System completes waits for its window to be answered; a daily reset before that is not told (as when the window was kept in the phone\'s memory). Deleting a quest takes it off the list from any status and is not drawn. Progress on an objective is not a status: it changes only while the quest is active.',
    hides: '',
    state: q => `${LABEL[questPhase(q)]}${q.kind === 'daily' ? ' (daily)' : ''}`,
    step,
  }],
  where: [
    ['The union', '`QuestState` and `questState` in `src/core/hunter/hunter.ts` (a done quest\'s `told`); `QUEST_PHASES`, `questPhase` and `QuestEvent` in `src/core/hunter/quests.ts`'],
    ['What changes it', '`questStep(quest, event, at)` and its `TABLE`; the steps `completeQuest` (by a tap or the System), `failQuest`, `reopenQuest`, `questTold`, `rollover`'],
    ['Who calls it', '`src/views/quests.js` through `store.apply` (`tellDone` writes `questTold`); `countQuests` in `src/core/hunter/noticed.ts` (the System\'s completion)'],
    ['The test to copy', '`tests/quests.test.ts`; the walk\'s events are in `tests/models/quest-events.ts`'],
    ['The recipe', 'docs/guide/hunters.md, "A state or event of the ... machine"'],
  ],
});

function formStep(e: QuestFormEvent, from: QuestFormState): string {
  switch (e.type) {
    case 'new': return '+ New quest';
    case 'edit': return 'Edit, or Reopen with its due time past';
    case 'saved': return 'Save quest, saved';
    case 'cancelled': return 'Cancel';
    case 'seen': return from.at === 'closed' ? 'the screen drawn' : 'another hunter chosen, or the GM/Player switch';
  }
}
export const questForm = machine<QuestFormState, QuestFormEvent>({
  name: 'The quest form',
  walked: `Every state reachable from a closed form, under the ${FORM_WALK.length} events of tests/models/quest-events.ts (FORM_WALK: two hunters, a player and the GM), breadth first.`,
  walk: () => bfs([QUEST_FORM_CLOSED], s => FORM_WALK.flatMap(event => { const to = questFormStep(s, event); return to === s ? [] : [{ event, to }]; }), s => JSON.stringify(s)),
  kinds: QUEST_FORM_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'The Quests view\'s form, from the tap that opens it to Save or Cancel',
    note: 'The form is opened as a player on hunter 1, so the screen seen on hunter 2 or as the GM closes it; seen as it was it is no move and is not drawn. The GM\'s form is the same machine with the role swapped. A Save the form refuses (a field missing, no hunter picked, a refused write) keeps it open and is not drawn. The GM view\'s Issue quest and the story maker draw the same fields in forms of their own.',
    hides: '',
    state: s => (s.at === 'closed' ? 'Closed' : s.at === 'new' ? 'New quest' : 'Editing a quest'),
    step: (e, from) => formStep(e, from),
  }],
  where: [
    ['The union', '`QuestFormState`, `QuestFormEvent` and `QUEST_FORM_STATES` in `src/core/hunter/quest-form.ts`'],
    ['What changes it', '`questFormStep(state, event)`, through `formMoved` in `src/views/quests.js`, which keeps the value (`form`) and shows the form while it is open'],
    ['Who calls it', '`src/views/quests.js`: + New quest, Edit, Reopen, Save quest, Cancel, and every draw of the view (`seen`)'],
    ['The test to copy', '`tests/quests.test.ts` ("the Quests view\'s quest form"); the walk\'s events are `FORM_WALK` in `tests/models/quest-events.ts`; on screen, `tests/e2e/gates-quests-dailies.e2e.ts`'],
    ['The recipe', 'docs/guide/hunters.md, "A state or event of the ... machine"'],
  ],
});
