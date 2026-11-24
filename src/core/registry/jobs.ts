// jobs.ts: the jobs a GM can grant through a Job Change chain, one typed table. To add a job: add an entry here and run
// `bun run test` (tests/jobs.test.ts checks every entry). A job has exactly three steps; the chain model
// (src/core/hunter/job-chain.ts) issues them in order and grants the job when the third is complete. A job leans to one
// pair of stats (`pair`), whose confluence it holds when the pair qualifies (src/core/hunter/keystones.ts), and carries
// matching 2:1 Auto-allocate weights (`alloc`).
import type { StatPair } from '../hunter/keystones.ts';
import { STAT_KEYS } from '../stats.ts';
import type { StatKey } from '../stats.ts';

/** Relative weights Auto-allocate uses to split free ability points across stats (for example, `{ str: 2, vit: 1 }`). */
export type StatWeights = Partial<Readonly<Record<StatKey, number>>>;
/** A player's chosen stat focus for Auto-allocate: one main stat (2 parts) and an optional second stat (1 part). */
export type StatFocus = { readonly main: StatKey; readonly second: StatKey | null };

/** What one step of a chain asks. A `level` step completes itself when the hunter reaches `level`. */
export type StepDef =
  | { goal: 'level'; level: number; title: string; desc: string }
  | { goal: 'task'; title: string; desc: string; objectives: readonly { label: string; target: number }[] };
/**
 * A job: its three steps, in order (a tuple, so a job with two or four steps does not compile), the pair of stats
 * it leans to (when both hold the confluence's share, that pair is the hunter's confluence even if two other stats are
 * higher, and once the job's chain is done the confluence is awakened, design A.5), and its 2:1 Auto-allocate weights.
 */
export type JobDef = { steps: readonly [StepDef, StepDef, StepDef]; pair: StatPair; alloc: StatWeights };

/** The level the standard chain asks for before the Job Change dungeon. */
export const CHAIN_LEVEL = 10;
/** The chain every job had before jobs had their own: reach level 10, survive the dungeon's 3 waves, defeat the Knight Captain. */
const STANDARD: JobDef['steps'] = [
  { goal: 'level', level: CHAIN_LEVEL, title: 'Job Change 1/3: Requirements', desc: `Reach Level ${CHAIN_LEVEL} to qualify for the Job Change quest.` },
  { goal: 'task', title: 'Job Change 2/3: The Job Change Dungeon', desc: 'Enter the Job Change dungeon and survive.', objectives: [{ label: 'Survive dungeon waves', target: 3 }] },
  { goal: 'task', title: 'Job Change 3/3: Knight Captain', desc: 'Defeat the Knight Captain.', objectives: [{ label: 'Defeat the Knight Captain', target: 1 }] },
];

// Each pair and alloc is the two stats that feed what the job does (derive.ts; item-budget.ts `FED_BY`), weighted 2:1.
const JOBS = {
  // the army and the mana to raise it: Presence holds shadows, Power is mana
  Necromancer: { steps: STANDARD, pair: 'pre+pow', alloc: { pre: 2, pow: 1 } },
  // the first and the most turns: Agility is speed, Instinct the opening, Reaction and crit faces
  Assassin: { steps: STANDARD, pair: 'agi+ins', alloc: { agi: 2, ins: 1 } },
  // the spell and its aim: Power is magical power and mana, Control accuracy, penetration and the cost cut
  Mage: { steps: STANDARD, pair: 'pow+ctl', alloc: { pow: 2, ctl: 1 } },
  // the guard on both sides: Vitality is HP and armor, Discipline resist, will and tenacity
  Tanker: { steps: STANDARD, pair: 'vit+dis', alloc: { vit: 2, dis: 1 } },
  // the heal and the nerve to cast it under fire: Presence is support power, Discipline will and channel hold
  Healer: { steps: STANDARD, pair: 'dis+pre', alloc: { pre: 2, dis: 1 } },
  // the blow and the body to stand in reach: Strength is physical power, Vitality HP and armor
  Fighter: { steps: STANDARD, pair: 'str+vit', alloc: { str: 2, vit: 1 } },
  // range kept and the shot that lands: Agility is speed and move, Control accuracy and crit size
  Ranger: { steps: STANDARD, pair: 'agi+ctl', alloc: { agi: 2, ctl: 1 } },
} satisfies Record<string, JobDef>;

export type JobName = keyof typeof JOBS;
/** Every job by name, in the order the GM's picker lists them. */
export const BUILT_IN_JOBS: Readonly<Record<JobName, JobDef>> = JOBS;
export const JOB_NAMES = Object.keys(JOBS) as JobName[];
export const isJobName = (v: unknown): v is JobName => typeof v === 'string' && Object.hasOwn(JOBS, v);

/** Auto-allocate weights for a built-in job, or null when the hunter has no job or a custom GM job. */
export const jobAlloc = (job: string | null | undefined): StatWeights | null =>
  (isJobName(job) ? BUILT_IN_JOBS[job].alloc : null);

/** A built-in job's main and second stats for the stat-focus picker, or null when not a built-in job. */
export function jobFocus(job: string | null | undefined): StatFocus | null {
  const alloc = jobAlloc(job);
  if (!alloc) return null;
  const ranked = STAT_KEYS.filter(k => (alloc[k] ?? 0) > 0).sort((a, b) => (alloc[b] ?? 0) - (alloc[a] ?? 0));
  if (!ranked[0]) return null;
  return { main: ranked[0], second: ranked[1] ?? null };
}

/** Auto-allocate weights for a chosen stat focus: 2:1 when a distinct second stat is picked, else 100% in main. */
export function focusWeights(focus: StatFocus): StatWeights {
  return focus.second && focus.second !== focus.main ? { [focus.main]: 2, [focus.second]: 1 } : { [focus.main]: 1 };
}

/** The built-in job whose focus pair matches `focus` (same two stats), or null when none matches. */
export function matchingJob(focus: StatFocus): JobName | null {
  if (!focus.second || focus.second === focus.main) return null;
  const pair = new Set<StatKey>([focus.main, focus.second]);
  for (const name of JOB_NAMES) {
    const keys = STAT_KEYS.filter(k => (BUILT_IN_JOBS[name].alloc[k] ?? 0) > 0);
    if (keys.length === 2 && pair.has(keys[0]!) && pair.has(keys[1]!)) return name;
  }
  return null;
}

const isStatKey = (v: unknown): v is StatKey => typeof v === 'string' && (STAT_KEYS as readonly string[]).includes(v);

/** Validates a saved stat focus from device memory, returning null when unreadable. */
export function parseStatFocus(v: unknown): StatFocus | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!isStatKey(o.main)) return null;
  const second = isStatKey(o.second) && o.second !== o.main ? o.second : null;
  return { main: o.main, second };
}

/** Static labels for the Auto-allocate button and Stat-focus picker (shared by views and browser tests). */
export const AUTO_ALLOC_WORDS = {
  button: 'Auto-allocate',
  title: 'Auto-allocate ability points',
  jobPresetsLabel: 'Job focus presets',
  mainLabel: 'Main stat (2 parts)',
  secondLabel: 'Second stat (1 part, optional)',
  secondNone: 'None (all points in main stat)',
  previewLabel: 'Points to place',
  undoHint: 'You can still undo with the minus button until you confirm.',
  placeAction: 'Place ability points',
  preJobHint: 'Pick a job preset or choose one or two stats to focus on until Job Change.',
  customJobHint: 'Your job has no preset focus. Pick a job preset or choose one or two stats.',
  jobHint: (job: string, main: string, second: string | null): string =>
    second ? `Using ${job} focus: ${main} (2) and ${second} (1).` : `Using ${job} focus: ${main}.`,
  matchesJob: (job: string): string => `Matches ${job} focus.`,
} as const;
