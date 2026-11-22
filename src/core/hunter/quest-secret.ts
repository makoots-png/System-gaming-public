// quest-secret.ts: a secret quest, the GM's quest for one hunter that no other player's phone gets (notes-5-trade.md
// section 5). The quest carries `secret` (hunter.ts `Quest`, kept only from the GM by quests.ts `questOf`); the room
// seals its `quest` and `questUpdate` by it (protocol.ts). Here: who it may go to, and its words. Pure.
import type { Quest } from './hunter.ts';

/** Whether quest `q` may go to `n` hunters at once: a secret quest is one hunter's. The room's reader and Issue quest ask. */
export const questReaches = (q: Pick<Quest, 'secret'>, n: number): boolean => !q.secret || n === 1;

/**
 * The words of a secret quest: the GM's box on Issue quest and its refusal of more than one hunter, the player's chip and
 * line on the quest's card and window, and the GM's mark on its lines (the Party quests, the session log, a toast).
 */
export const SECRET_WORDS = {
  box: 'Secret: only this hunter and you see it',
  oneHunter: 'A secret quest goes to one hunter.',
  chip: 'Secret',
  line: 'Only you and the GM see this quest.',
  mark: '(secret)',
} as const;
