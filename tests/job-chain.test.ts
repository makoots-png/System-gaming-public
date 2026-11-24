// The Job Change chain (src/core/hunter/job-chain.ts). The numbers are today's chain (inventory 5.1): step 1 asks for
// level 10 (CHAIN_LEVEL), step 2 for 3 dungeon waves, step 3 for 1 Knight Captain.
import { saveId } from '../src/core/ids.ts';
import { describe, expect, test } from 'bun:test';
import { CHAIN_EVENT_TYPES, chainAfter, parseJobChain, stepQuest } from '../src/core/hunter/job-chain.ts';
import type { ChainEffect, ChainEvent, ChainQuestRef, ChainResult, JobChain } from '../src/core/hunter/job-chain.ts';
import type { Quest, Save } from '../src/core/save.ts';
import { freshSave } from '../src/core/save.ts';
import { grant, levelEdit, levelled } from '../src/core/hunter/grant.ts';
import { setLevel } from '../src/core/hunter/progress.ts';
import { chained } from '../src/core/hunter/quests.ts';
import { newRewards } from '../src/core/rewards.ts';
import { RULES } from '../src/core/rules.ts';
import { isRefused } from '../src/core/save-step.ts';

import { AT, WALK_MOVES, abandoned, completed, failed, levelChanged, play } from './models/job-chain-events.ts';
import type { ChainHunter } from './models/job-chain-events.ts';
import { day, dev, jcid, qid } from './fixtures/ids.ts';

const issued = (level: number, job: JobChain['job'] = 'Necromancer'): ChainEvent => ({ type: 'issued', id: jcid('jc1'), job, questId: qid('q1'), level, at: AT });
const reissued = (by: 'gm' | 'player', level = 1): ChainEvent => ({ type: 'reissued', by, questId: qid('q9'), level, at: AT });
/** Necromancer chain c1 at `step`, its open quest `questId`. */
const at = (step: JobChain['step'], questId: string, status: JobChain['status'] = 'active'): JobChain => ({ id: jcid('jc1'), job: 'Necromancer', step, status, questId: qid(questId) });

function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.freeze(v); for (const x of Object.values(v)) freeze(x); } return v; }
const step = (c: JobChain | null, e: ChainEvent): ChainResult => chainAfter(freeze(c), freeze(e));
const issuedQuest = (r: ChainResult): Quest => {
  const fx = r.effects.find((x): x is Extract<ChainEffect, { type: 'issueQuest' }> => x.type === 'issueQuest');
  if (!fx) throw new Error('no quest issued');
  return fx.quest;
};
const progressOf = (q: Quest) => q.objectives.map(o => `${o.label} ${o.progress}/${o.target}`);

describe('issuing a chain', () => {
  test('at level 1 starts the chain at step 1 and issues "Reach Level 10" with the level so far, 1 of 10', () => {
    const r = step(null, issued(1));
    expect(r.jobChain).toEqual(at(1, 'q1'));
    expect(r.effects.map(x => x.type)).toEqual(['issueQuest']);
    const q = issuedQuest(r);
    expect(q).toMatchObject({ id: 'q1', kind: 'job', from: 'system', status: 'active', chainId: jcid('jc1'), title: 'Job Change 1/3: Requirements' });
    expect(progressOf(q)).toEqual(['Reach Level 10 1/10']);
  });

  test('at level 10 or 30 issues step 1 already full and asks the app to complete it', () => {
    for (const level of [10, 30]) {
      const r = step(null, issued(level));
      expect(r.jobChain).toEqual(at(1, 'q1'));
      expect(progressOf(issuedQuest(r))).toEqual(['Reach Level 10 10/10']);
      expect(r.effects.slice(1)).toEqual([{ type: 'completeQuest', questId: 'q1' }]);
    }
  });

  test('is refused while a chain is running: one chain per hunter', () => {
    for (const c of [at(1, 'q1'), at(3, 'q5')]) expect(step(c, issued(12, 'Mage'))).toEqual({ jobChain: c, effects: [{ type: 'refused', reason: 'running' }] });
  });

  test('over a failed chain starts the new one', () => {
    const r = step(at(2, 'q5', 'failed'), issued(1, 'Mage'));
    expect(r.jobChain).toEqual({ ...at(1, 'q1'), job: 'Mage' });
  });
});

describe('the level step', () => {
  test('follows the hunter\'s level up and down, and asks the app to complete it at level 10', () => {
    expect(step(at(1, 'q1'), levelChanged(7))).toEqual({ jobChain: at(1, 'q1'), effects: [{ type: 'progress', questId: 'q1', value: 7 }] });
    expect(step(at(1, 'q1'), levelChanged(3))).toEqual({ jobChain: at(1, 'q1'), effects: [{ type: 'progress', questId: 'q1', value: 3 }] });
    expect(step(at(1, 'q1'), levelChanged(11))).toEqual({ jobChain: at(1, 'q1'), effects: [{ type: 'progress', questId: 'q1', value: 10 }, { type: 'completeQuest', questId: 'q1' }] });
  });

  test('cannot be completed by hand below level 10', () => {
    expect(step(at(1, 'q1'), completed('q1', 9))).toEqual({ jobChain: at(1, 'q1'), effects: [{ type: 'refused', reason: 'belowLevel' }] });
  });

  test('a level change at a task step, or with no chain or a failed one, changes nothing', () => {
    for (const c of [null, at(2, 'q5'), at(1, 'q1', 'failed')]) expect(step(c, levelChanged(10))).toEqual({ jobChain: c, effects: [] });
  });
});

describe('the level step hears every level change in the same step', () => {
  const AT2 = '2026-11-14T12:00:00.000Z';
  /** A save whose hunter h1 is at `level` with a Ranger chain at step 1, its quest showing the level reached. */
  function onStep1(level: number): Save {
    const s = freshSave({ now: new Date(AT2), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-test') }, { onboarded: true });
    const h = { ...s.hunters[0]!, ...setLevel(s.hunters[0]!, level, 0, RULES).progress };
    const t = chained(h, { type: 'issued', id: jcid('jc1'), job: 'Ranger', questId: qid('q1'), level, at: AT2 });
    return { ...s, hunters: [t.hunter] };
  }
  const stepProgress = (s: Save): number | undefined => s.hunters[0]!.quests.find(q => q.id === 'q1')?.objectives[0]?.progress;
  /** The XP from `from` with 0 XP to the start of level `to`: each level L costs 100 times L (xpPerLevel). */
  const xpTo = (from: number, to: number): number => Array.from({ length: to - from }, (_, i) => RULES.xpPerLevel * (from + i)).reduce((a, b) => a + b, 0);

  const DAY = { at: AT2, today: day(AT2.slice(0, 10)), R: RULES };
  const given = (save: Save, xp: number) => {
    const g = grant(save, 'h1', { ...newRewards(), xp }, { ...DAY, vitals: 'sheet' });
    if (isRefused(g)) throw new Error(g.why);
    return g;
  };
  const quest = (s: Save, id: string) => s.hunters[0]!.quests.find(q => q.id === id);

  test('an XP reward from level 7 to 9 moves the step to 9 of 10 in the save it answers', () => {
    const g = given(onStep1(7), xpTo(7, 9));
    expect([g.save.hunters[0]!.level, stepProgress(g.save), g.done]).toEqual([9, 9, []]);
  });

  test('an XP reward that reaches level 10 completes step 1 and opens step 2 in the same save, with their log lines', () => {
    const g = given(onStep1(9), xpTo(9, 10)), h = g.save.hunters[0]!;
    const open = quest(g.save, h.jobChain!.questId);
    expect([h.level, quest(g.save, 'q1')?.status, stepProgress(g.save), h.jobChain?.step, open?.title]).toEqual([10, 'done', 10, 2, 'Job Change 2/3: The Job Change Dungeon']);
    expect(g.done.map(d => [d.quest.id, d.job])).toEqual([['q1', null]]);
    expect(g.save.log.slice(0, 2).map(l => l.title).sort()).toEqual(['Quest complete', 'Quest issued']);
    const ids = [...g.save.log.map(l => l.id), ...h.quests.map(q => q.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('the GM\'s level edit down to 4 moves the step down with it', () => {
    const r = levelEdit(onStep1(7), 'h1', 4, 0, DAY);
    if (isRefused(r)) throw new Error(r.why);
    expect([r.save.hunters[0]!.level, stepProgress(r.save), r.done]).toEqual([4, 4, []]);
  });

  test('the GM\'s level edit up to 12 completes the step in the same save', () => {
    const r = levelEdit(onStep1(7), 'h1', 12, 0, DAY);
    if (isRefused(r)) throw new Error(r.why);
    expect([quest(r.save, 'q1')?.status, r.save.hunters[0]!.jobChain?.step, r.done.map(d => d.quest.id)]).toEqual(['done', 2, ['q1']]);
  });

  test('a change that keeps the level leaves the chain and its quest as they were', () => {
    const h = onStep1(7).hunters[0]!, l = levelled(h.level, { ...h, gold: h.gold + 1 }, DAY, p => saveId(p, 99));
    expect([l.hunter.quests, l.hunter.jobChain, l.done]).toEqual([h.quests, h.jobChain, []]);
  });
});

describe('completing a step', () => {
  test('step 1 at level 10 moves to step 2 and issues the dungeon: 3 waves to survive', () => {
    const r = step(at(1, 'q1'), completed('q1', 10, 'q2'));
    expect(r.jobChain).toEqual(at(2, 'q2'));
    const q = issuedQuest(r);
    expect(q).toMatchObject({ id: 'q2', chainId: jcid('jc1'), title: 'Job Change 2/3: The Job Change Dungeon' });
    expect(progressOf(q)).toEqual(['Survive dungeon waves 0/3']);
  });

  test('step 2 moves to step 3, the Knight Captain, whose card names the job', () => {
    const r = step(at(2, 'q2'), completed('q2', 10, 'q3'));
    expect(r.jobChain).toEqual(at(3, 'q3'));
    const q = issuedQuest(r);
    expect(q).toMatchObject({ id: 'q3', title: 'Job Change 3/3: Knight Captain' });
    expect(q.rewards.job).toBe('Necromancer');
    expect(progressOf(q)).toEqual(['Defeat the Knight Captain 0/1']);
  });

  test('step 3 grants the job and ends the chain; a Necromancer can extract shadows, a Mage cannot', () => {
    expect(step(at(3, 'q3'), completed('q3', 10))).toEqual({ jobChain: null, effects: [{ type: 'grantJob', job: 'Necromancer' }, { type: 'closed' }] });
    expect(step({ ...at(3, 'q3'), job: 'Mage' }, completed('q3', 10))).toEqual({ jobChain: null, effects: [{ type: 'grantJob', job: 'Mage' }, { type: 'closed' }] });
  });

  test('completing any other quest, an earlier step\'s included, changes nothing', () => {
    for (const id of ['q1', 'q7']) expect(step(at(2, 'q2'), completed(id, 10))).toEqual({ jobChain: at(2, 'q2'), effects: [] });
  });
});

describe('a failed step', () => {
  test('failing or deleting the open step\'s quest fails the chain at that step', () => {
    expect(step(at(2, 'q2'), failed('q2'))).toEqual({ jobChain: at(2, 'q2', 'failed'), effects: [] });
  });

  test('failing another quest changes nothing', () => {
    expect(step(at(2, 'q2'), failed('q1'))).toEqual({ jobChain: at(2, 'q2'), effects: [] });
  });

  test('a failed chain does not move: completing its old quest or levelling changes nothing', () => {
    const c = at(2, 'q2', 'failed');
    for (const e of [completed('q2', 10), levelChanged(20), failed('q2')]) expect(step(c, e)).toEqual({ jobChain: c, effects: [] });
  });

  test('the GM reissues it at the step it failed with a new quest', () => {
    const r = step(at(2, 'q2', 'failed'), reissued('gm'));
    expect(r.jobChain).toEqual(at(2, 'q9'));
    expect(issuedQuest(r)).toMatchObject({ id: 'q9', chainId: jcid('jc1'), title: 'Job Change 2/3: The Job Change Dungeon', status: 'active' });
  });

  test('a failed level step reissued at level 12 is complete at once', () => {
    const r = step(at(1, 'q1', 'failed'), reissued('gm', 12));
    expect(r.jobChain).toEqual(at(1, 'q9'));
    expect(r.effects.slice(1)).toEqual([{ type: 'completeQuest', questId: 'q9' }]);
  });

  test('the GM abandons it: the chain is gone', () => {
    expect(step(at(2, 'q2', 'failed'), abandoned('gm'))).toEqual({ jobChain: null, effects: [{ type: 'closed' }] });
  });

  test('a player can neither reissue nor abandon it', () => {
    const c = at(2, 'q2', 'failed');
    for (const e of [reissued('player'), abandoned('player')]) expect(step(c, e)).toEqual({ jobChain: c, effects: [{ type: 'refused', reason: 'gmOnly' }] });
  });

  test('reissue and abandon apply only to a failed chain', () => {
    for (const c of [null, at(2, 'q2')]) for (const e of [reissued('gm'), abandoned('gm')]) expect(step(c, e)).toEqual({ jobChain: c, effects: [] });
  });
});

describe('the step quests', () => {
  test('are the System\'s Job Change quests, with no reward but the job on the last', () => {
    for (const s of [1, 2, 3] as const) {
      const q = stepQuest('Ranger', s, { chainId: jcid('jc1'), questId: qid('q1'), at: AT, level: 1 });
      expect(q).toMatchObject({ kind: 'job', from: 'system', status: 'active', issuedAt: AT, doneAt: null, dueAt: null, chainId: jcid('jc1') });
      expect(q.rewards).toEqual({ xp: 0, points: 0, gold: 0, crystal: 0, items: [], title: null, job: s === 3 ? 'Ranger' : null, skills: [], statuses: [], boons: [] });
    }
  });
});

describe('a chain as a save or a sheet holds it', () => {
  const quests = (...qs: [string, Quest['status']][]) => qs.map(([id, status]) => ({ id: qid(id), status }));
  // An old save kept the chain on its quests: `chainId`, `step` and `chainJob` on each step's quest.
  test('a chain on an open quest is kept', () => {
    expect(parseJobChain(at(2, 'q2'), quests(['q2', 'active']))).toEqual(at(2, 'q2'));
  });

  test('an active chain whose quest was failed or deleted some other way is failed at its step', () => {
    expect(parseJobChain(at(2, 'q2'), quests(['q2', 'failed']))).toEqual(at(2, 'q2', 'failed'));
    expect(parseJobChain(at(2, 'q2'), [])).toEqual(at(2, 'q2', 'failed'));
  });

  test('a job not in the table, a step outside 1 to 3 or junk is no chain', () => {
    for (const v of [{ ...at(2, 'q2'), job: 'Baker' }, { ...at(2, 'q2'), step: 4 }, { ...at(2, 'q2'), status: 'done' }, 'yes', null, [at(2, 'q2')]]) {
      expect(parseJobChain(v, quests(['q2', 'active']))).toBeNull();
    }
  });

  test('an old save\'s chain, stored on its quests as step and chainJob, becomes the hunter\'s chain on its open step', () => {
    const old: ChainQuestRef[] = [{ id: qid('q1'), status: 'done', chainId: 'c4', step: 1, chainJob: 'Mage' }, { id: qid('q2'), status: 'active', chainId: 'c4', step: 2, chainJob: 'Mage' }];
    expect(parseJobChain(undefined, old)).toEqual({ id: 'c4', job: 'Mage', step: 2, status: 'active', questId: 'q2' });
  });

  test('an old chain whose last step was failed becomes a failed chain; one finished or with no job is none', () => {
    const failedOld: ChainQuestRef[] = [{ id: qid('q2'), status: 'failed', chainId: 'c4', step: 2, chainJob: 'Mage' }];
    expect(parseJobChain(undefined, failedOld)).toEqual({ id: 'c4', job: 'Mage', step: 2, status: 'failed', questId: 'q2' });
    expect(parseJobChain(undefined, [{ id: qid('q3'), status: 'done', chainId: 'c4', step: 3, chainJob: 'Mage' }])).toBeNull();
    expect(parseJobChain(undefined, [{ id: qid('q2'), status: 'active', chainId: 'c4', step: 2 }])).toBeNull();
  });
});

describe('every short run of events', () => {
  // A hunter's quests are simulated (tests/models/job-chain-events.ts): an issued quest is active, a completed one done,
  // a failed one failed, a deleted one gone. Each event is built from the chain as it stands, so "the tied quest" is
  // always the open step's.
  test('the events cover every type', () => {
    const s: ChainHunter = { chain: at(1, 'q1'), quests: new Map(), level: 1, n: 0 };
    expect([...new Set(WALK_MOVES.map(m => m(s).event.type))].sort()).toEqual([...CHAIN_EVENT_TYPES].sort());
  });

  test('a chain is tied to a quest it issued, an active one to an open quest, it never steps back, and the job is granted only from step 3', () => {
    let checked = 0;
    const walk = (s: ChainHunter, depth: number): void => {
      checked++;
      if (depth === 0) return;
      for (const move of WALK_MOVES) {
        const { event, result: r, next } = play(s, move);
        const quests = next.quests;
        const refused = r.effects.some(fx => fx.type === 'refused');
        if (refused) expect(r.jobChain).toEqual(s.chain);
        if (r.jobChain) {
          expect(quests.has(r.jobChain.questId) || r.jobChain.status === 'failed').toBe(true);
          if (r.jobChain.status === 'active') expect(quests.get(r.jobChain.questId)).toBe('active');
          if (s.chain && s.chain.id === r.jobChain.id) expect(r.jobChain.step).toBeGreaterThanOrEqual(s.chain.step);
        }
        const granted = r.effects.some(fx => fx.type === 'grantJob');
        expect(granted).toBe(!!s.chain && s.chain.status === 'active' && s.chain.step === 3 && event.type === 'stepCompleted' && event.questId === s.chain.questId);
        if (granted) expect(r.jobChain).toBeNull();
        walk(next, depth - 1);
      }
    };
    walk({ chain: null, quests: new Map(), level: 1, n: 1 }, 5);
    // 11 events, depth 5: 1 + 11 + 121 + 1,331 + 14,641 + 161,051 states.
    expect(checked).toBe(1 + 11 + 121 + 1331 + 14641 + 161051);
  });
});
