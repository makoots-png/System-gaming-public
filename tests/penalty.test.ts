// The daily penalty (src/core/hunter/penalty.ts). The numbers are today's rules: a missed day is one the rollover
// found with a daily not done (quests.js, inventory 4.2), the check penalty is `penaltyCheck` (2, src/core/rules.ts),
// and the Penalty Zone quest is "Survive for 4 hours".
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import {
  PENALTY_EVENT_TYPES, canDeleteQuest, checkPenalty, missedDays, parsePenalty, penaltyAfter, penaltyChipsOf, penaltyQuest,
} from '../src/core/hunter/penalty.ts';
import type { Penalty, PenaltyEvent, PenaltyResult, QuestRef } from '../src/core/hunter/penalty.ts';
import { DAILY, TUE, WALK_MOVES, deleted, done, missed, play, quest } from './models/penalty-events.ts';
import type { PenaltyHunter, PenaltyMove } from './models/penalty-events.ts';
import { qid } from './fixtures/ids.ts';

const MON = '2026-11-09T12:00:00.000Z';
/** Brakk, penalized since Monday for one day, tied to his Penalty Zone quest q5. */
const ON: Penalty = { since: MON, days: 1, questId: qid('q5') };

function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.freeze(v); for (const x of Object.values(v)) freeze(x); } return v; }
const step = (p: Penalty | null, e: PenaltyEvent, quests: QuestRef[] = [DAILY, quest('q5')]): PenaltyResult => penaltyAfter(freeze(p), freeze(e), freeze(quests));

describe('a missed daily', () => {
  test('starts a penalty on a hunter who had none, and issues one Penalty Zone quest tied to it', () => {
    expect(step(null, missed(1), [DAILY])).toEqual({ penalty: { since: TUE, days: 1, questId: 'q9' }, effects: [{ type: 'issueQuest', questId: 'q9', at: TUE }] });
  });

  test('several days missed at once are one penalty and one quest: the days are counted, not the quests (rulesref "one penalty")', () => {
    expect(step(null, missed(3), [DAILY])).toEqual({ penalty: { since: TUE, days: 3, questId: 'q9' }, effects: [{ type: 'issueQuest', questId: 'q9', at: TUE }] });
  });

  test('on a hunter already penalized adds the days and keeps the start and the quest while that quest is still open', () => {
    // 1 day already, 2 more missed: 3 days, still since Monday, still quest q5, and no second quest.
    expect(step(ON, missed(2))).toEqual({ penalty: { since: MON, days: 3, questId: 'q5' }, effects: [] });
  });

  test('after the Penalty Zone quest was failed, the next miss issues a new one and ties the penalty to it', () => {
    // Failing the quest does not lift the penalty (inventory 4.4, "Penalty quest failed"). The penalty stays tied to the
    // failed quest, which Reopen makes active again; the next miss adds its day and gives the hunter a quest to clear it.
    const r = step(ON, missed(1), [DAILY, quest('q5', 'failed')]);
    expect(r).toEqual({ penalty: { since: MON, days: 2, questId: 'q9' }, effects: [{ type: 'issueQuest', questId: 'q9', at: TUE }] });
  });

  test('no day missed changes nothing', () => {
    for (const days of [0, -1, Number.NaN, 0.5]) {
      expect(step(null, missed(days), [DAILY])).toEqual({ penalty: null, effects: [] });
      expect(step(ON, missed(days))).toEqual({ penalty: ON, effects: [] });
    }
  });
});

describe('the Penalty Zone quest', () => {
  test('completing the quest the penalty is tied to lifts it', () => {
    expect(step(ON, done('q5'))).toEqual({ penalty: null, effects: [{ type: 'lifted' }] });
  });

  test('the GM deleting the quest the penalty is tied to lifts it: the GM pardons the penalty', () => {
    expect(step(ON, deleted('q5'), [DAILY])).toEqual({ penalty: null, effects: [{ type: 'lifted' }] });
  });

  test('a player cannot delete the quest the penalty is tied to, open or failed: the delete is refused and the penalty stays', () => {
    for (const status of ['active', 'failed'] as const) {
      expect(step(ON, deleted('q5', 'player'), [DAILY, quest('q5', status)])).toEqual({ penalty: ON, effects: [{ type: 'refused' }] });
    }
  });

  test('a player may delete any other quest, a Penalty Zone quest no penalty is tied to included', () => {
    for (const p of [ON, null]) for (const id of ['q1', 'q3']) {
      expect(step(p, deleted(id, 'player'), [DAILY, quest('q3', 'failed'), quest('q5')])).toEqual({ penalty: p, effects: [] });
    }
  });

  test('the Delete control is offered to the GM for every quest, and to a player for every quest but the one the penalty is tied to', () => {
    expect(canDeleteQuest(ON, 'q5', 'gm')).toBe(true);
    expect(canDeleteQuest(ON, 'q5', 'player')).toBe(false);
    expect(canDeleteQuest(ON, 'q1', 'player')).toBe(true);
    expect(canDeleteQuest(null, 'q5', 'player')).toBe(true);
  });

  test('completing or deleting any other quest changes nothing: a penalty quest copied to another hunter with "Issue to…" clears nothing', () => {
    for (const e of [done('q1'), deleted('q1'), done('q7'), deleted('q7'), deleted('q7', 'player')]) expect(step(ON, e, [DAILY, quest('q5'), quest('q7')])).toEqual({ penalty: ON, effects: [] });
  });

  test('the tie is the quest id, not its kind: after the GM edits the quest to another kind, completing it still lifts the penalty', () => {
    expect(step(ON, done('q5'), [DAILY, quest('q5', 'active', 'side')])).toEqual({ penalty: null, effects: [{ type: 'lifted' }] });
  });

  test('a hunter without a penalty is not changed by a quest', () => {
    for (const e of [done('q5'), deleted('q5'), deleted('q5', 'player')]) expect(step(null, e)).toEqual({ penalty: null, effects: [] });
  });

  test('is the one the System issues: survive 4 hours, from the System, no reward and no cost, not secret', () => {
    expect(penaltyQuest(qid('q9'), TUE)).toEqual({
      id: 'q9', kind: 'penalty', title: 'Penalty Zone: Survive for 4 hours', desc: 'You failed the Daily Quest. Survive the Penalty Zone. The GM decides how it plays.',
      objectives: [{ label: 'Hours survived', target: 4, progress: 0 }], rewards: { xp: 0, points: 0, gold: 0, crystal: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] },
      status: 'active', issuedAt: TUE, doneAt: null, dueAt: null, from: 'system', penaltyText: '', secret: false,
      onFail: { xp: 0, points: 0, gold: 0, crystal: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] },
    });
  });
});

describe('what the penalty shows', () => {
  test('a penalized hunter has -2 on every check, the rules\' penaltyCheck; a hunter without one has 0', () => {
    expect(checkPenalty(ON, RULES)).toBe(2);
    expect(checkPenalty(null, RULES)).toBe(0);
    expect(checkPenalty(ON, { ...RULES, penaltyCheck: 3 })).toBe(3);
  });

  test('the Penalized chip is drawn from the penalty and from nothing else', () => {
    expect(penaltyChipsOf({ penalty: ON })).toEqual(['penalized']);
    expect(penaltyChipsOf({ penalty: null })).toEqual([]);
  });
});

describe('the days the rollover counts as missed', () => {
  // `gap` is the number of day keys since the hunter was last checked. The dailies are as they stood at the rollover.
  test('a day with a daily left undone is one missed day', () => {
    expect(missedDays(1, ['active'])).toBe(1);
    expect(missedDays(1, ['done', 'active'])).toBe(1);
  });

  test('the dailies done on the last day checked keep that day: three days later, two are missed', () => {
    expect(missedDays(1, ['done'])).toBe(0);
    expect(missedDays(3, ['done', 'done'])).toBe(2);
    expect(missedDays(3, ['active'])).toBe(3);
  });

  test('a hunter with no daily quest, or a rollover on the same day, misses nothing', () => {
    expect(missedDays(4, [])).toBe(0);
    expect(missedDays(0, ['active'])).toBe(0);
  });
});

describe('a penalty as a save or a sheet holds it', () => {
  const NOW = '2026-11-12T12:00:00.000Z';
  test('a penalty tied to one of the hunter\'s quests is kept, with whole days of at least 1', () => {
    expect(parsePenalty({ since: MON, days: 2.4, questId: 'q5' }, [DAILY, quest('q5')], NOW)).toEqual({ since: MON, days: 2, questId: 'q5' });
    expect(parsePenalty({ since: MON, days: -3, questId: 'q5' }, [quest('q5', 'failed')], NOW)).toEqual({ since: MON, days: 1, questId: 'q5' });
  });

  test('a penalty without a start takes the time of the repair', () => {
    expect(parsePenalty({ days: 1, questId: 'q5' }, [quest('q5')], NOW)).toEqual({ since: NOW, days: 1, questId: 'q5' });
  });

  test('a penalty without a valid questId is dropped', () => {
    expect(parsePenalty({ since: MON, days: 2 }, [quest('q5'), DAILY], NOW)).toBeNull();
    expect(parsePenalty({ since: MON, days: 1, questId: 'q5' }, [DAILY], NOW)).toBeNull();
  });

  test('anything that is not a penalty is none', () => {
    for (const v of [null, undefined, 'yes', 3, [ON]]) expect(parsePenalty(v, [quest('q5')], NOW)).toBeNull();
  });
});

describe('every short run of events', () => {
  // From no penalty and from a penalty, every sequence of up to 4 moves over three quest ids (the events, and a player
  // failing or reopening a quest, which the penalty does not hear; tests/models/penalty-events.ts): the penalty is either
  // none or tied to a quest the run issued or started with, its days only grow while it lasts, and lifting it answers
  // the `lifted` effect exactly when it ends. A player's delete of the tied quest is refused and deletes nothing. A miss
  // while the tied quest has failed issues a new one.
  const isEvent = (m: PenaltyMove): m is PenaltyEvent => (PENALTY_EVENT_TYPES as readonly string[]).includes(m.type);
  test('the events cover every type', () => {
    expect([...new Set(WALK_MOVES.filter(isEvent).map(e => e.type))].sort()).toEqual([...PENALTY_EVENT_TYPES].sort());
  });

  test('the penalty stays tied to a quest that exists, and its days never shrink', () => {
    let checked = 0;
    const walk = (h: PenaltyHunter, depth: number): void => {
      checked++;
      if (depth === 0) return;
      const p = h.penalty;
      for (const e of WALK_MOVES) {
        const { result: r, next } = play(h, e);
        const refused = r.effects.some(fx => fx.type === 'refused');
        if (refused) expect(r.penalty).toEqual(p);
        if (e.type === 'questDeleted' && e.by === 'player' && p && p.questId === e.questId) expect(refused).toBe(true);
        if (e.type === 'dailyMissed' && p && h.quests.some(q => q.id === p.questId && q.status === 'failed')) expect(r.effects.map(fx => fx.type)).toEqual(['issueQuest']);
        if (r.penalty) {
          expect(next.quests.some(q => q.id === r.penalty!.questId)).toBe(true);
          if (p) expect(r.penalty.days).toBeGreaterThanOrEqual(p.days);
        }
        expect(r.effects.some(fx => fx.type === 'lifted')).toBe(p !== null && r.penalty === null);
        walk(next, depth - 1);
      }
    };
    walk({ penalty: null, quests: [DAILY] }, 4);
    walk({ penalty: ON, quests: [DAILY, quest('q5')] }, 4);
    // Two starts, 13 moves, depth 4: 1 + 13 + 169 + 2,197 + 28,561 states each.
    expect(checked).toBe(2 * (1 + 13 + 169 + 2197 + 28561));
  });
});
