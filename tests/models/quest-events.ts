// A side quest with one objective and a daily, and the events of a quest's life. Shared by tests/quests.test.ts and
// the state chart (scripts/charts/quest.ts), so both walk the same events.
import { QUEST_EVENTS } from '../../src/core/hunter/quests.ts';
import type { QuestEvent, QuestPhase } from '../../src/core/hunter/quests.ts';
import { newQuest, questState } from '../../src/core/save.ts';
import type { Quest, QuestKind, QuestStatus } from '../../src/core/save.ts';
import { hid, qid } from '../fixtures/ids.ts';
import type { QuestFormEvent } from '../../src/core/hunter/quest-form.ts';

/** "Clear the den": kill 3 goblins, 1 done; issued on Nov 14. */
export function questIn(status: QuestStatus, kind: QuestKind = 'side'): Quest {
  return {
    ...newQuest(), id: qid('q800'), kind, title: 'Clear the den', objectives: [{ label: 'Goblins', target: 3, progress: 1 }], issuedAt: '2026-11-14T08:00:00.000Z',
    ...questState(status, '2026-11-14T09:00:00.000Z'),
  };
}

/** "Clear the den" in phase `phase`: an untold one is done by the System with its window not yet answered. */
export function questAt(phase: QuestPhase, kind: QuestKind = 'side'): Quest {
  if (phase !== 'untold') return questIn(phase, kind);
  return { ...questIn('active', kind), ...questState('done', '2026-11-14T09:00:00.000Z', false) };
}

/** The events, each tried in every state. */
export const WALK_EVENTS: readonly QuestEvent[] = QUEST_EVENTS;

/**
 * The quest form's events (src/core/hunter/quest-form.ts) on a phone with two hunters, as a player and as the GM: each
 * opening on hunter 1, Save, Cancel, and the screen seen on either hunter in either role.
 */
export const FORM_WALK: readonly QuestFormEvent[] = [
  { type: 'new', role: 'player', hid: hid('h1') }, { type: 'edit', role: 'player', hid: hid('h1'), qid: qid('q800') },
  { type: 'saved' }, { type: 'cancelled' },
  ...(['player', 'gm'] as const).flatMap(role => [{ type: 'seen' as const, role, hid: hid('h1') }, { type: 'seen' as const, role, hid: hid('h2') }]),
];
