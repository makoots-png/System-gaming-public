// Every job in src/core/registry/jobs.ts must pass these. A new job is checked here with no new test.
import { describe as group, expect, test } from 'bun:test';
import { AUTO_ALLOC_WORDS, BUILT_IN_CLASSES, BUILT_IN_JOBS, CHAIN_JOB_NAMES, CLASS_NAMES, JOB_NAMES, RARE_CHAIN_LEVEL, RARE_CLASS_NAMES, RARER_CLASSES, UNIQUE_CLASS_NAMES, canonicalUniqueClass, chainStepsOf, classDefOf, classRarityOf, focusWeights, isChainJob, isClassName, isJobName, isRareClass, isUniqueClass, jobAlloc, jobFocus, matchingJob, parseStatFocus, rareBranchesOf, rareParentOf } from '../src/core/registry/jobs.ts';
import { statsOfPair } from '../src/core/hunter/keystones.ts';
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

    test('has a 2:1 stat allocation matching its keystone pair and round-trips through jobFocus and matchingJob', () => {
      const pairStats = statsOfPair(def.pair);
      const focus = jobFocus(job);
      expect(focus).not.toBeNull();
      if (!focus || !focus.second) throw new Error(`${job} focus missing second stat`);
      expect(pairStats).toContain(focus.main);
      expect(pairStats).toContain(focus.second);
      expect(focus.main).not.toBe(focus.second);
      expect(jobAlloc(job)).toEqual({ [focus.main]: 2, [focus.second]: 1 });
      expect(focusWeights(focus)).toEqual(def.alloc);
      expect(matchingJob(focus)).toBe(job);
    });
  });
}

group('stat focus helpers', () => {
  test('jobAlloc returns null for unknown or empty job names', () => {
    expect(jobAlloc(null)).toBeNull();
    expect(jobAlloc('')).toBeNull();
    expect(jobAlloc('Shadow Monarch')).toBeNull();
  });

  test('focusWeights supports single-stat focus and ignores duplicate second stat', () => {
    expect(focusWeights({ main: 'str', second: null })).toEqual({ str: 1 });
    expect(focusWeights({ main: 'str', second: 'str' })).toEqual({ str: 1 });
    expect(focusWeights({ main: 'agi', second: 'ctl' })).toEqual({ agi: 2, ctl: 1 });
  });

  test('matchingJob finds a job regardless of order or returns null when no job matches', () => {
    expect(matchingJob({ main: 'vit', second: 'str' })).toBe('Fighter');
    expect(matchingJob({ main: 'str', second: null })).toBeNull();
    expect(matchingJob({ main: 'str', second: 'pow' })).toBeNull();
  });

  test('parseStatFocus validates outside values and drops invalid or duplicate second stats', () => {
    expect(parseStatFocus({ main: 'pow', second: 'ctl' })).toEqual({ main: 'pow', second: 'ctl' });
    expect(parseStatFocus({ main: 'pow', second: 'pow' })).toEqual({ main: 'pow', second: null });
    expect(parseStatFocus({ main: 'pow', second: 'bogus' })).toEqual({ main: 'pow', second: null });
    expect(parseStatFocus({ main: 'bogus', second: 'str' })).toBeNull();
    expect(parseStatFocus(null)).toBeNull();
  });

  test('AUTO_ALLOC_WORDS follow the app voice rules', () => {
    const lines = [
      AUTO_ALLOC_WORDS.button, AUTO_ALLOC_WORDS.title, AUTO_ALLOC_WORDS.preJobHint,
      AUTO_ALLOC_WORDS.customJobHint, AUTO_ALLOC_WORDS.jobHint('Fighter', 'Strength', 'Vitality'),
      AUTO_ALLOC_WORDS.jobPresetsLabel, AUTO_ALLOC_WORDS.mainLabel, AUTO_ALLOC_WORDS.secondLabel,
      AUTO_ALLOC_WORDS.secondNone, AUTO_ALLOC_WORDS.previewLabel, AUTO_ALLOC_WORDS.matchesJob('Fighter'),
      AUTO_ALLOC_WORDS.undoHint, AUTO_ALLOC_WORDS.placeAction,
    ];
    for (const s of lines) {
      expect(s).not.toMatch(/[—;]/);
      expect(s).not.toMatch(/\bjust\b/i);
    }
  });
});

group('36-class roster metadata', () => {
  test('counts match settled.md (6 Common, 12 Rare, 8 Epic, 10 Mythic; 18 unique)', () => {
    expect(JOB_NAMES).toHaveLength(6);
    expect(Object.keys(RARER_CLASSES)).toHaveLength(30);
    expect(CLASS_NAMES).toHaveLength(36);
    expect(UNIQUE_CLASS_NAMES).toHaveLength(18);
    expect(CLASS_NAMES.filter(n => classRarityOf(n) === 'common')).toHaveLength(6);
    expect(CLASS_NAMES.filter(n => classRarityOf(n) === 'rare')).toHaveLength(12);
    expect(CLASS_NAMES.filter(n => classRarityOf(n) === 'epic')).toHaveLength(8);
    expect(CLASS_NAMES.filter(n => classRarityOf(n) === 'mythic')).toHaveLength(10);
  });

  test('every built-in class has a valid 2:1 alloc matching its pair, and uniqueness flags match rarity', () => {
    for (const name of CLASS_NAMES) {
      const def = BUILT_IN_CLASSES[name];
      expect(isClassName(name)).toBe(true);
      expect(classDefOf(name)).toBe(def);
      const wantUnique = def.rarity === 'epic' || def.rarity === 'mythic';
      expect(def.unique).toBe(wantUnique);
      expect(isUniqueClass(name)).toBe(wantUnique);
      if (wantUnique) {
        expect(canonicalUniqueClass(`  ${name.toLowerCase()} `) as string | null).toBe(name);
        expect(isJobName(name)).toBe(false);
      } else {
        expect(canonicalUniqueClass(name)).toBeNull();
      }
      if (def.rarity === 'rare') expect(isJobName(def.parent)).toBe(true);
      const pairStats = statsOfPair(def.pair);
      const focus = jobFocus(name);
      expect(focus).not.toBeNull();
      expect(pairStats).toContain(focus!.main);
      expect(pairStats).toContain(focus!.second!);
      expect(jobAlloc(name)).toEqual({ [focus!.main]: 2, [focus!.second!]: 1 });
    }
  });

  test('all 12 Rare classes carry the level-20 3-step chain with 2 branches per Common starter, while unique classes are not chainable', () => {
    expect(RARE_CHAIN_LEVEL).toBe(20);
    expect(RARE_CLASS_NAMES).toHaveLength(12);
    expect(CHAIN_JOB_NAMES).toHaveLength(18);
    for (const parent of JOB_NAMES) {
      const branches = rareBranchesOf(parent);
      expect(branches).toHaveLength(2);
      for (const b of branches) expect(rareParentOf(b)).toBe(parent);
    }
    expect(rareBranchesOf('Tanker')).toEqual(['Brambleguard', 'Bastion']);
    expect(rareBranchesOf('Mage')).toEqual(['Pyromancer', 'Artificer']);
    expect(rareBranchesOf('Ranger')).toEqual(['Sniper', 'Strider']);
    for (const rare of RARE_CLASS_NAMES) {
      expect(isRareClass(rare)).toBe(true);
      expect(isChainJob(rare)).toBe(true);
      expect(isJobName(rare)).toBe(false);
      const steps = chainStepsOf(rare);
      expect(steps).toHaveLength(3);
      expect(steps[0]).toMatchObject({ goal: 'level', level: 20 });
    }
    for (const uniq of UNIQUE_CLASS_NAMES) {
      expect(isRareClass(uniq)).toBe(false);
      expect(isChainJob(uniq)).toBe(false);
    }
  });
});
