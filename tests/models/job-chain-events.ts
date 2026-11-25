// The moves of a Job Change chain's short runs, and how a hunter's quests and level follow them. Shared by
// tests/job-chain.test.ts and the state charts (scripts/charts/job-chain.ts), so both walk the same moves.
import { chainAfter } from '../../src/core/hunter/job-chain.ts';
import type { ChainEvent, ChainResult, JobChain } from '../../src/core/hunter/job-chain.ts';
import type { Quest } from '../../src/core/save.ts';
import { jcid, qid } from '../fixtures/ids.ts';

export const AT = '2026-11-12T12:00:00.000Z';
export const completed = (questId: string, level: number, nextQuestId = 'q9'): ChainEvent => ({ type: 'stepCompleted', questId: qid(questId), level, nextQuestId: qid(nextQuestId), at: AT });
export const failed = (questId: string): ChainEvent => ({ type: 'stepFailed', questId: qid(questId) });
export const levelChanged = (level: number): ChainEvent => ({ type: 'levelChanged', level });
export const abandoned = (by: 'gm' | 'player'): ChainEvent => ({ type: 'abandoned', by });

/**
 * A hunter as the walk holds it. Its quests are simulated: an issued quest is active, a completed one done, a failed one
 * failed, a deleted one gone. `n` makes the next fresh id.
 */
export type ChainHunter = { chain: JobChain | null; quests: Map<string, Quest['status']>; level: number; n: number };
/** A move, built from the hunter as it stands, so "the tied quest" is always the open step's. `apply` changes the quests unless the event is refused. */
export type ChainMove = (s: ChainHunter) => { event: ChainEvent; apply?: (q: Map<string, Quest['status']>) => void };
const tied = (s: ChainHunter): string => s.chain?.questId ?? 'q0';

/**
 * 11 moves: the GM issues a Fighter chain, the level becomes 10 or 3, the tied quest or another is completed, the
 * tied quest fails or is deleted, and the GM and a player each reissue and abandon.
 */
export const WALK_MOVES: ChainMove[] = [
  s => ({ event: { type: 'issued', id: jcid(`jc${s.n}`), job: 'Fighter', questId: qid(`q${s.n}`), level: s.level, at: AT } }),
  () => ({ event: levelChanged(10) }),
  () => ({ event: levelChanged(3) }),
  s => ({ event: completed(tied(s), s.level, `q${s.n}`), apply: q => { if (q.has(tied(s))) q.set(tied(s), 'done'); } }),
  s => ({ event: completed('q990', s.level, `q${s.n}`) }),
  s => ({ event: failed(tied(s)), apply: q => { if (q.has(tied(s))) q.set(tied(s), 'failed'); } }),
  s => ({ event: failed(tied(s)), apply: q => { q.delete(tied(s)); } }),
  () => ({ event: abandoned('gm') }),
  () => ({ event: abandoned('player') }),
  s => ({ event: { type: 'reissued', by: 'gm', questId: qid(`q${s.n}`), level: s.level, at: AT } }),
  s => ({ event: { type: 'reissued', by: 'player', questId: qid(`q${s.n}`), level: s.level, at: AT } }),
];

/** One move on `s`: its event, the chain model's answer, and the hunter after it with the effects' quests issued. */
export function play(s: ChainHunter, move: ChainMove): { event: ChainEvent; result: ChainResult; next: ChainHunter } {
  const { event, apply } = move(s);
  const result = chainAfter(s.chain, event);
  const quests = new Map(s.quests);
  if (!result.effects.some(fx => fx.type === 'refused')) apply?.(quests);
  for (const fx of result.effects) if (fx.type === 'issueQuest') quests.set(fx.quest.id, 'active');
  const level = event.type === 'levelChanged' ? event.level : s.level;
  return { event, result, next: { chain: result.jobChain, quests, level, n: s.n + 1 } };
}
