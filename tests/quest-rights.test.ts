// What a phone may do to a quest (src/core/hunter/quest-rights.ts). The rule: a player in a room may not edit or delete
// a quest the GM issued (one the GM sent, or a Job Change step); the GM may change any; a phone alone is its own GM.
// The System counts the objective of a chain's open level step ("Reach Level 10"), so nobody gets minus and plus there.
import { describe, expect, test } from 'bun:test';
import { COMPLETER, QUEST_COMPLETERS, completerOf, gmIssued, mayChangeQuest, reportsProgress, systemCounts } from '../src/core/hunter/quest-rights.ts';
import type { Objective } from '../src/core/save.ts';
import type { JobChain } from '../src/core/hunter/job-chain.ts';
import { jcid, qid } from './fixtures/ids.ts';

const sent = { from: 'gm' as const };
const step = { from: 'system' as const, chainId: jcid('jc1') };
const own = { from: 'self' as const };
const daily = { from: 'system' as const };

describe('whose progress the GM hears of', () => {
  test('a player in a room tells the GM of progress on a quest the GM sent, and of no other', () => {
    expect([sent, step, own, daily].map(q => reportsProgress(q, 'player'))).toEqual([true, false, false, false]);
  });
  test('a phone alone and the GM\'s own phone tell nobody', () => {
    for (const seat of ['alone', 'gm'] as const) expect([sent, step, own, daily].some(q => reportsProgress(q, seat))).toBe(false);
  });
});

describe('who may edit or delete a quest', () => {
  test('a player in a room may not change a quest the GM sent, nor a Job Change step', () => {
    expect(mayChangeQuest(sent, 'player')).toBe(false);
    expect(mayChangeQuest(step, 'player')).toBe(false);
  });
  test('a player in a room may change their own quest and a System quest that is not a chain step', () => {
    expect(mayChangeQuest(own, 'player')).toBe(true);
    expect(mayChangeQuest(daily, 'player')).toBe(true);
  });
  test('the GM of a room may change any quest', () => {
    for (const q of [sent, step, own, daily]) expect(mayChangeQuest(q, 'gm')).toBe(true);
  });
  test('a phone alone is its own GM: it may change any quest, a Job Change step and a sent quest included', () => {
    for (const q of [sent, step, own, daily]) expect(mayChangeQuest(q, 'alone')).toBe(true);
  });
  test('a Job Change step and a sent quest are GM-issued; an own quest and a daily are not', () => {
    expect([sent, step, own, daily].map(gmIssued)).toEqual([true, true, false, false]);
  });
});

describe('which objectives the System counts', () => {
  const chain = (step: JobChain['step'], questId = 'q1'): JobChain => ({ id: jcid('jc1'), job: 'Ranger', step, status: 'active', questId: qid(questId) });
  test('step 1 of a chain, "Reach Level 10", is counted by the System', () => {
    expect(systemCounts({ id: qid('q1'), chainId: jcid('jc1') }, chain(1))).toBe(true);
  });
  test('step 2, the dungeon waves, is counted by the player', () => {
    expect(systemCounts({ id: qid('q1'), chainId: jcid('jc1') }, chain(2))).toBe(false);
  });
  test('a quest that is not the chain\'s open step, or has no chain, is counted by the player', () => {
    expect(systemCounts({ id: qid('q0'), chainId: jcid('jc1') }, chain(1))).toBe(false);
    expect(systemCounts({ id: qid('q1') }, chain(1))).toBe(false);
    expect(systemCounts({ id: qid('q1'), chainId: jcid('jc1') }, null)).toBe(false);
  });
});

describe('who completes a quest (SMX-gates-4)', () => {
  const byHand: Objective = { label: 'Report to the guild', target: 1, progress: 0 };
  const counted: Objective = { label: 'Beasts defeated', target: 1, progress: 0, count: { rule: { on: 'kill', where: [], measure: { of: 'facts' }, within: 'ever' }, mark: '' } };
  test('every objective counted is the System\'s; none counted, or no objective, is the hand\'s; some of each is mixed', () => {
    expect(completerOf({ objectives: [counted, counted] })).toBe('system');
    expect(completerOf({ objectives: [byHand] })).toBe('hand');
    expect(completerOf({ objectives: [] })).toBe('hand');
    expect(completerOf({ objectives: [counted, byHand] })).toBe('mixed');
  });
  // Every completer and what it gives: a Complete button on the card, and the System completing it when its last
  // objective fills from a fact.
  const rows: [typeof QUEST_COMPLETERS[number], { button: boolean; counted: boolean }][] = [
    ['system', { button: false, counted: true }],
    ['hand', { button: true, counted: false }],
    // SMX-gates-4.1: a quest with any hand-ticked objective keeps its Complete button (the owner, Nov 22)
    ['mixed', { button: true, counted: true }],
  ];
  for (const [who, gives] of rows) test(`a ${who} quest: Complete button ${gives.button ? 'shown' : 'hidden'}, ${gives.counted ? '' : 'never '}completed by the System`, () => {
    expect(COMPLETER[who]).toEqual(gives);
  });
  test('the rows are every completer', () => {
    expect(rows.map(r => r[0])).toEqual([...QUEST_COMPLETERS]);
  });
});
