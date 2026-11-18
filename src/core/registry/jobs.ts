// jobs.ts: the jobs a GM can grant through a Job Change chain, one typed table. To add a job: add an entry here and run
// `bun run test` (tests/jobs.test.ts checks every entry). A job has exactly three steps; the chain model
// (src/core/hunter/job-chain.ts) issues them in order and grants the job when the third is complete.

/** What one step of a chain asks. A `level` step completes itself when the hunter reaches `level`. */
export type StepDef =
  | { goal: 'level'; level: number; title: string; desc: string }
  | { goal: 'task'; title: string; desc: string; objectives: readonly { label: string; target: number }[] };
/** A job: its three steps, in order. A tuple, so a job with two or four steps does not compile. */
export type JobDef = { steps: readonly [StepDef, StepDef, StepDef] };

/** The level the standard chain asks for before the Job Change dungeon. */
export const CHAIN_LEVEL = 10;
/** The chain every job had before jobs had their own: reach level 10, survive the dungeon's 3 waves, defeat the Knight Captain. */
const STANDARD: JobDef['steps'] = [
  { goal: 'level', level: CHAIN_LEVEL, title: 'Job Change 1/3: Requirements', desc: `Reach Level ${CHAIN_LEVEL} to qualify for the Job Change quest.` },
  { goal: 'task', title: 'Job Change 2/3: The Job Change Dungeon', desc: 'Enter the Job Change dungeon and survive.', objectives: [{ label: 'Survive dungeon waves', target: 3 }] },
  { goal: 'task', title: 'Job Change 3/3: Knight Captain', desc: 'Defeat the Knight Captain.', objectives: [{ label: 'Defeat the Knight Captain', target: 1 }] },
];

const JOBS = {
  Necromancer: { steps: STANDARD },
  Assassin: { steps: STANDARD },
  Mage: { steps: STANDARD },
  Tanker: { steps: STANDARD },
  Healer: { steps: STANDARD },
  Fighter: { steps: STANDARD },
  Ranger: { steps: STANDARD },
} satisfies Record<string, JobDef>;

export type JobName = keyof typeof JOBS;
/** Every job by name, in the order the GM's picker lists them. */
export const BUILT_IN_JOBS: Readonly<Record<JobName, JobDef>> = JOBS;
export const JOB_NAMES = Object.keys(JOBS) as JobName[];
export const isJobName = (v: unknown): v is JobName => typeof v === 'string' && Object.hasOwn(JOBS, v);
