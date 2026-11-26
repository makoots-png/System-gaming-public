// jobs.ts: the 36 built-in classes across four rarities (Common, Rare, Epic, Mythic), one typed table.
// Common starters (6) are chainable via the level-10 Job Change chain (`BUILT_IN_JOBS` / `JOB_NAMES`).
// Rare (12), Epic (8, unique), and Mythic (10, unique) live in `RARER_CLASSES`, joined into `BUILT_IN_CLASSES` (36).
// Each class leans to one pair of stats (`pair`), whose Confluence it awakens when earned and active
// (src/core/hunter/keystones.ts), and carries matching 2:1 Auto-allocate weights (`alloc`).
import type { StatPair } from '../hunter/keystones.ts';
import type { Rank } from '../rules.ts';
import { STAT_KEYS } from '../stats.ts';
import type { StatKey } from '../stats.ts';

/** Relative weights Auto-allocate uses to split free ability points across stats (for example, `{ str: 2, vit: 1 }`). */
export type StatWeights = Partial<Readonly<Record<StatKey, number>>>;
/** A player's chosen stat focus for Auto-allocate: one main stat (2 parts) and an optional second stat (1 part). */
export type StatFocus = { readonly main: StatKey; readonly second: StatKey | null };

/** The four class rarities, in order from starter to capstone tier. */
export const CLASS_RARITIES = ['common', 'rare', 'epic', 'mythic'] as const;
export type ClassRarity = (typeof CLASS_RARITIES)[number];

/** What one step of a chain asks. A `level` step completes itself when the hunter reaches `level`. */
export type StepDef =
  | { goal: 'level'; level: number; title: string; desc: string }
  | { goal: 'task'; title: string; desc: string; objectives: readonly { label: string; target: number }[] };
/**
 * A chainable starter job: its three steps, in order (a tuple, so a job with two or four steps does not compile),
 * the pair of stats it leans to, and its 2:1 Auto-allocate weights.
 */
export type JobDef = { steps: readonly [StepDef, StepDef, StepDef]; pair: StatPair; alloc: StatWeights };

/** The level the standard Common chain asks for before the Job Change dungeon. */
export const CHAIN_LEVEL = 10;
/** The level the Rare Job Change chain asks for before the Rare trial dungeon (`RULES.rankLevels.C`). */
export const RARE_CHAIN_LEVEL = 20;
/** The chain every starter job runs: reach level 10, survive the dungeon's 3 waves, defeat the Knight Captain. */
const STANDARD: JobDef['steps'] = [
  { goal: 'level', level: CHAIN_LEVEL, title: 'Job Change 1/3: Requirements', desc: `Reach Level ${CHAIN_LEVEL} to qualify for the Job Change quest.` },
  { goal: 'task', title: 'Job Change 2/3: The Job Change Dungeon', desc: 'Enter the Job Change dungeon and survive.', objectives: [{ label: 'Survive dungeon waves', target: 3 }] },
  { goal: 'task', title: 'Job Change 3/3: Knight Captain', desc: 'Defeat the Knight Captain.', objectives: [{ label: 'Defeat the Knight Captain', target: 1 }] },
];
/** Builds a 3-step level-20 Rare Job Change chain with optional branch-specific trial steps. */
const rareSteps = (
  step2Title: string,
  step2Desc: string,
  step2Obj: string,
  champion: string,
): JobDef['steps'] => [
  { goal: 'level', level: RARE_CHAIN_LEVEL, title: 'Rare Job Change 1/3: Requirements', desc: `Reach Level ${RARE_CHAIN_LEVEL} to qualify for the Rare Job Change quest.` },
  { goal: 'task', title: `Rare Job Change 2/3: ${step2Title}`, desc: step2Desc, objectives: [{ label: step2Obj, target: 3 }] },
  { goal: 'task', title: `Rare Job Change 3/3: ${champion}`, desc: `Defeat the ${champion} to claim your Rare class.`, objectives: [{ label: `Defeat the ${champion}`, target: 1 }] },
];
/** Default level-20 3-step chain for Rare classes without a bespoke branch trial yet. */
const RARE_STEPS: JobDef['steps'] = rareSteps(
  'The Trial Dungeon',
  'Enter the Rare Job Change dungeon and survive the trial.',
  'Survive trial waves',
  'Trial Champion',
);
const BRAMBLEGUARD_STEPS = rareSteps(
  'The Briar Labyrinth',
  'Hold the line inside the Briar Labyrinth and endure three waves.',
  'Survive labyrinth waves',
  'Thornbound Warden',
);
const PYROMANCER_STEPS = rareSteps(
  'The Caldera Trial',
  'Cross the burning floor of the Caldera Trial and clear three waves.',
  'Survive caldera waves',
  'Cinder Archon',
);
const SNIPER_STEPS = rareSteps(
  'Hold the Watchtower',
  'Hold your perch atop the Watchtower through three siege waves.',
  'Survive siege waves',
  'Watchtower Marksman',
);

// Six Common starters (settled.md: Necromancer moved to unique Mythic).
const COMMON_JOBS_RAW = {
  // the blow and the body to stand in reach: Strength is physical power, Vitality HP and armor
  Fighter: { steps: STANDARD, pair: 'str+vit', alloc: { str: 2, vit: 1 } },
  // the first and the most turns: Agility is speed and finesse power, Instinct the opening, Reaction and crit faces
  Assassin: { steps: STANDARD, pair: 'agi+ins', alloc: { agi: 2, ins: 1 } },
  // the spell and its aim: Power is arcane power and mana, Control accuracy, penetration and the cost cut
  Mage: { steps: STANDARD, pair: 'pow+ctl', alloc: { pow: 2, ctl: 1 } },
  // the guard on both sides: Vitality is HP and armor, Discipline resist, will and tenacity
  Tanker: { steps: STANDARD, pair: 'vit+dis', alloc: { vit: 2, dis: 1 } },
  // the heal and the nerve to cast it under fire: Presence is support power, Discipline will and channel hold
  Healer: { steps: STANDARD, pair: 'dis+pre', alloc: { pre: 2, dis: 1 } },
  // range kept and the shot that lands: Agility is speed, move and finesse power, Control accuracy and crit size
  Ranger: { steps: STANDARD, pair: 'agi+ctl', alloc: { agi: 2, ctl: 1 } },
} satisfies Record<string, JobDef>;

export type JobName = keyof typeof COMMON_JOBS_RAW;
export type CommonClassName = JobName;
/** Every Common starter job by name, in the order the GM's Job Change picker lists them. */
export const COMMON_JOBS: Readonly<Record<JobName, JobDef>> = COMMON_JOBS_RAW;
export const BUILT_IN_JOBS: Readonly<Record<JobName, JobDef>> = COMMON_JOBS_RAW;
export const JOB_NAMES = Object.keys(COMMON_JOBS_RAW) as JobName[];
export const isJobName = (v: unknown): v is JobName => typeof v === 'string' && Object.hasOwn(COMMON_JOBS_RAW, v);

/** Metadata for any built-in class across all four rarities. */
export type ClassDef = {
  readonly rarity: ClassRarity;
  readonly unique: boolean;
  readonly pair: StatPair;
  readonly alloc: StatWeights;
  /** For Rare classes: the Common starter it branches from. */
  readonly parent?: CommonClassName;
  /** Informational recommended rank tag for Epic and Mythic classes (never a hard gate). */
  readonly recRank?: Rank;
  /** Job Change chain steps for chainable classes. */
  readonly steps?: JobDef['steps'];
};

const RARER_CLASSES_RAW = {
  // Rare (12, not unique, two branches per Common starter, level-20 3-step chain)
  Berserker:    { rarity: 'rare', unique: false, parent: 'Fighter',  pair: 'str+vit', alloc: { str: 2, vit: 1 }, steps: RARE_STEPS },
  Runeknight:   { rarity: 'rare', unique: false, parent: 'Fighter',  pair: 'str+pow', alloc: { str: 2, pow: 1 }, steps: RARE_STEPS },
  Nightblade:   { rarity: 'rare', unique: false, parent: 'Assassin', pair: 'agi+ins', alloc: { agi: 2, ins: 1 }, steps: RARE_STEPS },
  Duelist:      { rarity: 'rare', unique: false, parent: 'Assassin', pair: 'str+agi', alloc: { agi: 2, str: 1 }, steps: RARE_STEPS },
  Pyromancer:   { rarity: 'rare', unique: false, parent: 'Mage',     pair: 'pow+ctl', alloc: { pow: 2, ctl: 1 }, steps: PYROMANCER_STEPS },
  Artificer:    { rarity: 'rare', unique: false, parent: 'Mage',     pair: 'ins+ctl', alloc: { ctl: 2, ins: 1 }, steps: RARE_STEPS },
  Brambleguard: { rarity: 'rare', unique: false, parent: 'Tanker',   pair: 'vit+dis', alloc: { vit: 2, dis: 1 }, steps: BRAMBLEGUARD_STEPS },
  Bastion:      { rarity: 'rare', unique: false, parent: 'Tanker',   pair: 'str+vit', alloc: { vit: 2, str: 1 }, steps: RARE_STEPS },
  Cleric:       { rarity: 'rare', unique: false, parent: 'Healer',   pair: 'dis+pre', alloc: { dis: 2, pre: 1 }, steps: RARE_STEPS },
  Oracle:       { rarity: 'rare', unique: false, parent: 'Healer',   pair: 'ins+pre', alloc: { pre: 2, ins: 1 }, steps: RARE_STEPS },
  Sniper:       { rarity: 'rare', unique: false, parent: 'Ranger',   pair: 'agi+ctl', alloc: { agi: 2, ctl: 1 }, steps: SNIPER_STEPS },
  Strider:      { rarity: 'rare', unique: false, parent: 'Ranger',   pair: 'agi+vit', alloc: { agi: 2, vit: 1 }, steps: RARE_STEPS },
  // Epic (8, unique, in ship order)
  Chronokeeper: { rarity: 'epic', unique: true, recRank: 'A', pair: 'ins+ctl', alloc: { ctl: 2, ins: 1 } },
  Grimreaper:   { rarity: 'epic', unique: true, recRank: 'A', pair: 'agi+pow', alloc: { agi: 2, pow: 1 } },
  Stormcaller:  { rarity: 'epic', unique: true, recRank: 'A', pair: 'agi+pow', alloc: { pow: 2, agi: 1 } },
  Seraph:       { rarity: 'epic', unique: true, recRank: 'A', pair: 'dis+pre', alloc: { dis: 2, pre: 1 } },
  Voidstalker:  { rarity: 'epic', unique: true, recRank: 'A', pair: 'agi+ins', alloc: { agi: 2, ins: 1 } },
  Ironclad:     { rarity: 'epic', unique: true, recRank: 'A', pair: 'vit+dis', alloc: { vit: 2, dis: 1 } },
  Packlord:     { rarity: 'epic', unique: true, recRank: 'A', pair: 'vit+pre', alloc: { pre: 2, vit: 1 } },
  Soulforger:   { rarity: 'epic', unique: true, recRank: 'A', pair: 'dis+pow', alloc: { pow: 2, dis: 1 } },
  // Mythic (10, unique)
  Hemomancer:   { rarity: 'mythic', unique: true, recRank: 'S', pair: 'vit+pow', alloc: { pow: 2, vit: 1 } },
  Necromancer:  { rarity: 'mythic', unique: true, recRank: 'S', pair: 'pre+pow', alloc: { pre: 2, pow: 1 } },
  Starforger:   { rarity: 'mythic', unique: true, recRank: 'S', pair: 'pow+ctl', alloc: { pow: 2, ctl: 1 } },
  Bladefiend:   { rarity: 'mythic', unique: true, recRank: 'S', pair: 'str+agi', alloc: { str: 2, agi: 1 } },
  Dreadnought:  { rarity: 'mythic', unique: true, recRank: 'S', pair: 'vit+dis', alloc: { vit: 2, dis: 1 } },
  Usurper:      { rarity: 'mythic', unique: true, recRank: 'S', pair: 'agi+pow', alloc: { agi: 2, pow: 1 } },
  Dawnbringer:  { rarity: 'mythic', unique: true, recRank: 'S', pair: 'dis+pre', alloc: { dis: 2, pre: 1 } },
  Rifthunter:   { rarity: 'mythic', unique: true, recRank: 'S', pair: 'ins+ctl', alloc: { ins: 2, ctl: 1 } },
  Nullweaver:   { rarity: 'mythic', unique: true, recRank: 'S', pair: 'ins+pow', alloc: { ins: 2, pow: 1 } },
  Godfist:      { rarity: 'mythic', unique: true, recRank: 'S', pair: 'str+dis', alloc: { str: 2, dis: 1 } },
} satisfies Record<string, ClassDef>;

export type RarerClassName = keyof typeof RARER_CLASSES_RAW;
/** All 30 Rare, Epic, and Mythic classes by name. */
export const RARER_CLASSES: Readonly<Record<RarerClassName, ClassDef>> = RARER_CLASSES_RAW;

const ALL_CLASSES_RAW: Record<JobName | RarerClassName, ClassDef> = {
  Fighter:  { rarity: 'common', unique: false, ...COMMON_JOBS_RAW.Fighter },
  Assassin: { rarity: 'common', unique: false, ...COMMON_JOBS_RAW.Assassin },
  Mage:     { rarity: 'common', unique: false, ...COMMON_JOBS_RAW.Mage },
  Tanker:   { rarity: 'common', unique: false, ...COMMON_JOBS_RAW.Tanker },
  Healer:   { rarity: 'common', unique: false, ...COMMON_JOBS_RAW.Healer },
  Ranger:   { rarity: 'common', unique: false, ...COMMON_JOBS_RAW.Ranger },
  ...RARER_CLASSES_RAW,
};

export type ClassName = keyof typeof ALL_CLASSES_RAW;
/** All 36 built-in classes across Common, Rare, Epic, and Mythic. */
export const BUILT_IN_CLASSES: Readonly<Record<ClassName, ClassDef>> = ALL_CLASSES_RAW;
export const CLASS_NAMES = Object.keys(ALL_CLASSES_RAW) as readonly ClassName[];

export type RareClassName = {
  [K in RarerClassName]: (typeof RARER_CLASSES_RAW)[K]['rarity'] extends 'rare' ? K : never;
}[RarerClassName];
/** The 12 Rare built-in classes (two level-20 branches per Common starter). */
export const RARE_CLASS_NAMES = CLASS_NAMES.filter(
  (name): name is RareClassName => ALL_CLASSES_RAW[name].rarity === 'rare',
);
export const isRareClass = (v: unknown): v is RareClassName =>
  typeof v === 'string' && Object.hasOwn(RARER_CLASSES_RAW, v) && RARER_CLASSES_RAW[v as RarerClassName].rarity === 'rare';

/** Any built-in class earned through a 3-step Job Change chain (6 Common at Lv.10 + 12 Rare at Lv.20). */
export type ChainJobName = JobName | RareClassName;
/** All 18 chainable classes (Common starters followed by Rare branches). */
export const CHAIN_JOB_NAMES: readonly ChainJobName[] = [...JOB_NAMES, ...RARE_CLASS_NAMES];
export const isChainJob = (v: unknown): v is ChainJobName => isJobName(v) || isRareClass(v);

/** The 3 Job Change steps for any Common (level 10) or Rare (level 20) chainable class. */
export function chainStepsOf(job: ChainJobName): JobDef['steps'] {
  return isJobName(job) ? COMMON_JOBS_RAW[job].steps : RARER_CLASSES_RAW[job].steps;
}

/** The two Rare branches that advance from Common starter `parent`. */
export function rareBranchesOf(parent: CommonClassName): readonly RareClassName[] {
  return RARE_CLASS_NAMES.filter(name => RARER_CLASSES_RAW[name].parent === parent);
}

/** The Common starter job that Rare class `job` branches from. */
export function rareParentOf(job: RareClassName): CommonClassName {
  return RARER_CLASSES_RAW[job].parent;
}

export type UniqueClassName = {
  [K in RarerClassName]: (typeof RARER_CLASSES_RAW)[K]['unique'] extends true ? K : never;
}[RarerClassName];

/** The 18 unique built-in classes (8 Epic and 10 Mythic). */
export const UNIQUE_CLASS_NAMES = CLASS_NAMES.filter(
  (name): name is UniqueClassName => ALL_CLASSES_RAW[name].unique,
);

const UNIQUE_BY_LOWER = new Map<string, UniqueClassName>([
  ...UNIQUE_CLASS_NAMES.map((name): [string, UniqueClassName] => [name.toLowerCase(), name]),
  // Shadow Monarch is folded into Mythic Necromancer as a title/legacy extract string (settled.md) and must not bypass uniqueness.
  ['shadow monarch', 'Necromancer'],
]);

export const isClassName = (v: unknown): v is ClassName =>
  typeof v === 'string' && Object.hasOwn(ALL_CLASSES_RAW, v);

export const isUniqueClass = (v: unknown): v is UniqueClassName =>
  typeof v === 'string' && Object.hasOwn(ALL_CLASSES_RAW, v) && ALL_CLASSES_RAW[v as ClassName].unique;

/** Case-insensitive match against the 18 unique built-in classes and aliases (including Shadow Monarch), or null. */
export const canonicalUniqueClass = (v: string): UniqueClassName | null =>
  UNIQUE_BY_LOWER.get(v.replace(/\s+/g, ' ').trim().toLowerCase()) ?? null;

/** Metadata for a built-in class by name, or null for custom GM jobs and empty values. */
export const classDefOf = (name: string | null | undefined): ClassDef | null =>
  (isClassName(name) ? ALL_CLASSES_RAW[name] : null);

/** Rarity of a built-in class by name, or null for custom GM jobs. */
export const classRarityOf = (name: string | null | undefined): ClassRarity | null =>
  (isClassName(name) ? ALL_CLASSES_RAW[name].rarity : null);

/** Auto-allocate weights for any built-in class, or null when the hunter has no class or a custom GM job. */
export const jobAlloc = (job: string | null | undefined): StatWeights | null =>
  (classDefOf(job)?.alloc ?? null);

/** A built-in class's main and second stats for the stat-focus picker, or null when not a built-in class. */
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

/** The Common starter job whose focus pair matches `focus` (same two stats), or null when none matches. */
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
