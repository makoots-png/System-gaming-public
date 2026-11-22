// jobs.ts: the jobs a GM can grant through a Job Change chain, one typed table. To add a job: add an entry here and run
// `bun run test` (tests/jobs.test.ts checks every entry). A job has exactly three steps; the chain model
// (src/core/hunter/job-chain.ts) issues them in order and grants the job when the third is complete. A job leans to one
// pair of stats (`pair`), whose confluence it holds when the pair qualifies (src/core/hunter/keystones.ts).
import type { StatPair } from '../hunter/keystones.ts';

/** What one step of a chain asks. A `level` step completes itself when the hunter reaches `level`. */
export type StepDef =
  | { goal: 'level'; level: number; title: string; desc: string }
  | { goal: 'task'; title: string; desc: string; objectives: readonly { label: string; target: number }[] };
/**
 * A job: its three steps, in order (a tuple, so a job with two or four steps does not compile), and the pair of stats
 * it leans to: when both hold the confluence's share, that pair is the hunter's confluence even if two other stats are
 * higher, and once the job's chain is done the confluence is awakened (design A.5).
 */
export type JobDef = { steps: readonly [StepDef, StepDef, StepDef]; pair: StatPair };

/** The level the standard chain asks for before the Job Change dungeon. */
export const CHAIN_LEVEL = 10;
/** The chain every job had before jobs had their own: reach level 10, survive the dungeon's 3 waves, defeat the Knight Captain. */
const STANDARD: JobDef['steps'] = [
  { goal: 'level', level: CHAIN_LEVEL, title: 'Job Change 1/3: Requirements', desc: `Reach Level ${CHAIN_LEVEL} to qualify for the Job Change quest.` },
  { goal: 'task', title: 'Job Change 2/3: The Job Change Dungeon', desc: 'Enter the Job Change dungeon and survive.', objectives: [{ label: 'Survive dungeon waves', target: 3 }] },
  { goal: 'task', title: 'Job Change 3/3: Knight Captain', desc: 'Defeat the Knight Captain.', objectives: [{ label: 'Defeat the Knight Captain', target: 1 }] },
];

// Each pair is the two stats that feed what the job does (derive.ts; item-budget.ts `FED_BY`).
const JOBS = {
  // the army and the mana to raise it: Presence holds shadows, Power is mana
  Necromancer: { steps: STANDARD, pair: 'pre+pow' },
  // the first and the most turns: Agility is speed, Instinct the opening, Reaction and crit faces
  Assassin: { steps: STANDARD, pair: 'agi+ins' },
  // the spell and its aim: Power is magical power and mana, Control accuracy, penetration and the cost cut
  Mage: { steps: STANDARD, pair: 'pow+ctl' },
  // the guard on both sides: Vitality is HP and armor, Discipline resist, will and tenacity
  Tanker: { steps: STANDARD, pair: 'vit+dis' },
  // the heal and the nerve to cast it under fire: Presence is support power, Discipline will and channel hold
  Healer: { steps: STANDARD, pair: 'dis+pre' },
  // the blow and the body to stand in reach: Strength is physical power, Vitality HP and armor
  Fighter: { steps: STANDARD, pair: 'str+vit' },
  // range kept and the shot that lands: Agility is speed and move, Control accuracy and crit size
  Ranger: { steps: STANDARD, pair: 'agi+ctl' },
} satisfies Record<string, JobDef>;

export type JobName = keyof typeof JOBS;
/** Every job by name, in the order the GM's picker lists them. */
export const BUILT_IN_JOBS: Readonly<Record<JobName, JobDef>> = JOBS;
export const JOB_NAMES = Object.keys(JOBS) as JobName[];
export const isJobName = (v: unknown): v is JobName => typeof v === 'string' && Object.hasOwn(JOBS, v);
