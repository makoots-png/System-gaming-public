// The moves of a penalty's short runs, and how a hunter's quests follow them. Shared by tests/penalty.test.ts and the
// state charts (scripts/charts/penalty.ts), so both walk the same moves.
import { penaltyAfter } from '../../src/core/hunter/penalty.ts';
import type { Penalty, PenaltyEvent, PenaltyResult, QuestRef } from '../../src/core/hunter/penalty.ts';
import { qid } from '../fixtures/ids.ts';

export const TUE = '2026-11-10T12:00:00.000Z';
/** The rollover found `days` missed days; a Penalty Zone quest it issues takes `questId`. */
export const missed = (days: number, questId = 'q9', at = TUE): PenaltyEvent => ({ type: 'dailyMissed', days, at, questId: qid(questId) });
export const done = (questId: string): PenaltyEvent => ({ type: 'questCompleted', questId: qid(questId) });
/** A quest deleted on a GM's phone. A player's phone is `by: 'player'`. */
export const deleted = (questId: string, by: 'gm' | 'player' = 'gm'): PenaltyEvent => ({ type: 'questDeleted', questId: qid(questId), by });
export const quest = (id: string, status: QuestRef['status'] = 'active', kind: QuestRef['kind'] = 'penalty'): QuestRef => ({ id: qid(id), status, kind });
export const DAILY = quest('q1', 'active', 'daily');

/** A tap on a quest the penalty does not hear: Fail on an open quest, Reopen on a failed one (src/views/quests.js). */
export type QuestTap = { type: 'questFailed'; questId: string } | { type: 'questReopened'; questId: string };
export type PenaltyMove = PenaltyEvent | QuestTap;
export const failed = (questId: string): QuestTap => ({ type: 'questFailed', questId });
export const reopened = (questId: string): QuestTap => ({ type: 'questReopened', questId });

/**
 * 13 moves over the quest ids q5 (the tied quest of a penalty the walk starts with), qa and qb (issued by the walk's
 * misses of one and two days): each completed, q5 and qa deleted by the GM and by a player, and qa and qb failed and reopened.
 */
export const WALK_MOVES: PenaltyMove[] = [
  missed(1, 'q901'), missed(2, 'q902'), done('q5'), done('q901'), done('q902'), deleted('q5'), deleted('q901'), deleted('q5', 'player'), deleted('q901', 'player'),
  failed('q901'), failed('q902'), reopened('q901'), reopened('q902'),
];

/** What the walk holds of a hunter. */
export type PenaltyHunter = { penalty: Penalty | null; quests: QuestRef[] };

/**
 * One move on `h`: the penalty model's answer (a quest tap is not sent to it, so the penalty stays) and the hunter after
 * it, with the quests changed as src/views/quests.js changes them: a completed quest is done, a deleted one gone unless
 * the delete is refused, an issued one added as open, a failed one failed, a reopened one open.
 */
export function play(h: PenaltyHunter, move: PenaltyMove): { result: PenaltyResult; next: PenaltyHunter } {
  const set = (id: string, from: QuestRef['status'], to: QuestRef['status']): QuestRef[] => h.quests.map(q => (q.id === id && q.status === from ? { ...q, status: to } : q));
  if (move.type === 'questFailed') return { result: { penalty: h.penalty, effects: [] }, next: { penalty: h.penalty, quests: set(move.questId, 'active', 'failed') } };
  if (move.type === 'questReopened') return { result: { penalty: h.penalty, effects: [] }, next: { penalty: h.penalty, quests: set(move.questId, 'failed', 'active') } };
  const result = penaltyAfter(h.penalty, move, h.quests);
  let quests = h.quests;
  if (move.type === 'questCompleted') quests = quests.map(q => (q.id === move.questId ? { ...q, status: 'done' } : q));
  if (move.type === 'questDeleted' && !result.effects.some(fx => fx.type === 'refused')) quests = quests.filter(q => q.id !== move.questId);
  for (const fx of result.effects) if (fx.type === 'issueQuest') quests = [...quests.filter(q => q.id !== fx.questId), quest(fx.questId)];
  return { result, next: { penalty: result.penalty, quests } };
}
