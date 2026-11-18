// Every job in src/core/registry/jobs.ts must pass these. A new job is checked here with no new test.
import { describe as group, expect, test } from 'bun:test';
import { BUILT_IN_JOBS, JOB_NAMES } from '../src/core/registry/jobs.ts';
import { chainAfter, stepQuest } from '../src/core/hunter/job-chain.ts';
import type { ChainResult, JobChain } from '../src/core/hunter/job-chain.ts';
import { jcid, qid } from './fixtures/ids.ts';

const AT = '2026-11-12T12:00:00.000Z';

for (const job of JOB_NAMES) {
  const def = BUILT_IN_JOBS[job];
  group(`the job ${job}`, () => {
    test('has a name a hunter\'s Job field can hold (60 characters)', () => {
      expect(job.trim()).toBe(job);
      expect(job.length).toBeGreaterThan(0);
      expect(job.length).toBeLessThanOrEqual(60);
    });

    test('each of its three steps is a quest a player can read and finish: a title, a goal, and objectives of at least 1', () => {
      for (const s of [1, 2, 3] as const) {
        const q = stepQuest(job, s, { chainId: jcid('jc1'), questId: qid(`q${s}`), at: AT, level: 1 });
        expect(q.title.trim()).not.toBe('');
        expect(q.title.length).toBeLessThanOrEqual(120);
        expect(q.desc.trim()).not.toBe('');
        expect(q.desc.length).toBeLessThanOrEqual(500);
        expect(q.objectives.length).toBeGreaterThan(0);
        for (const o of q.objectives) {
          expect(o.label.trim()).not.toBe('');
          expect(o.target).toBeGreaterThanOrEqual(1);
          expect(o.progress).toBeLessThanOrEqual(o.target);
        }
      }
      expect(def.steps).toHaveLength(3);
    });

    test('is granted after its three steps, issued at level 1, 10 or 30, the hunter levelling to its level steps on the way', () => {
      for (const start of [1, 10, 30]) {
        let level = start, n = 1, chain: JobChain | null = null;
        const run = (r: ChainResult): ChainResult => { expect(r.effects.some(fx => fx.type === 'refused')).toBe(false); chain = r.jobChain; return r; };
        let r = run(chainAfter(null, { type: 'issued', id: jcid('jc1'), job, questId: qid(`q${n}`), level, at: AT }));
        for (let s = 1; s <= 3; s++) {
          const c = chain as JobChain | null;
          expect(c?.step).toBe(s as JobChain['step']);
          const goal = def.steps[s - 1]!;
          if (goal.goal === 'level' && level < goal.level) { level = goal.level; run(chainAfter(c, { type: 'levelChanged', level })); }
          r = run(chainAfter(chain, { type: 'stepCompleted', questId: c!.questId, level, nextQuestId: qid(`q${++n}`), at: AT }));
        }
        expect(chain).toBeNull();
        expect(r.effects).toContainEqual({ type: 'grantJob', job });
      }
    });
  });
}
