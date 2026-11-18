// A side quest with one objective and a daily, and the events of a quest's life. Shared by tests/quests.test.ts and
// the state chart (scripts/charts/quest.ts), so both walk the same events.
import { QUEST_EVENTS } from '../../src/core/hunter/quests.ts';
import type { QuestEvent } from '../../src/core/hunter/quests.ts';
import { newQuest, questState } from '../../src/core/save.ts';
import type { Quest, QuestKind, QuestStatus } from '../../src/core/save.ts';
import { qid } from '../fixtures/ids.ts';

/** "Clear the den": kill 3 goblins, 1 done; issued on Nov 14. */
export function questIn(status: QuestStatus, kind: QuestKind = 'side'): Quest {
  return {
    ...newQuest(), id: qid('q800'), kind, title: 'Clear the den', objectives: [{ label: 'Goblins', target: 3, progress: 1 }], issuedAt: '2026-11-14T08:00:00.000Z',
    ...questState(status, '2026-11-14T09:00:00.000Z'),
  };
}

/** The four events, each tried in every state. */
export const WALK_EVENTS: readonly QuestEvent[] = QUEST_EVENTS;
