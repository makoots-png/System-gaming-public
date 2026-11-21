// rules.ts: every number from PROGRAM §D lives here, each with its domain beside it (the least and the most a GM's
// override may set, whole or not, and why; overrides.ts refuses a number out of it). GM overrides (a save's
// rulesOverrides) are deep-merged by rulesOf(), and the GM's statuses (a save's library.statuses) are laid over the
// built-in ones.
import { BUILT_IN_STATUSES } from './registry/statuses.ts';
import { BUILT_IN_PATHS } from './registry/paths.ts';
import { STAT_KEYS, STAT_SHORT } from './stats.ts';
import { GRID_SIDE } from './combat/space.ts';
import { LEVELS } from './combat/standing.ts';
import { MAX_LEVEL, MIN_LEVEL } from './hunter/level.ts';
import type { StatKey } from './stats.ts';
import type { StatusDef } from './combat/effect-ops.ts';
import type { SheetNumber } from './hunter/derive.ts';
import type { Rewards } from './rewards.ts';

const deepFreeze = <T>(o: T): T => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o as object).forEach(deepFreeze); } return o; };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export const RANKS = ['E', 'D', 'C', 'B', 'A', 'S'] as const;
export type Rank = (typeof RANKS)[number];

// ── the domain of every rule number, stated beside it in RULES ──
/**
 * Where a GM's override of a rule number may go: from `least` to `most`, a whole number or not, and `why` those bounds
 * (the Rules editor shows it with a refusal). A number out of its domain breaks the rule that reads it (a divisor of 0,
 * a loop with no end, a list of a billion entries) or makes no game; overrides.ts refuses it, so the rule keeps its
 * default. Every rule number has one: a lint of tests/lint.test.ts walks RULES and fails on a number without a domain
 * or a shipped value outside it.
 */
export type Domain = { readonly least: number; readonly most: number; readonly whole: boolean; readonly why: string };
/** Whether `n` is in domain `d`. */
export const inDomain = (n: number, d: Domain): boolean => Number.isFinite(n) && n >= d.least && n <= d.most && (!d.whole || Number.isInteger(n));
/** A rule number as RULES declares it: its shipped value and its domain. RULES holds the value, `domainOf` the domain. */
class RuleNumber { constructor(readonly value: number, readonly domain: Domain) {} }
/** A rule list of numbers (a rank's DCs, a range's two ends): each entry in the domain. Its reader in overrides.ts keeps its length. */
class RuleNumbers { constructor(readonly value: readonly number[], readonly domain: Domain) {} }
const wholeIn = (least: number, most: number, why: string): Domain => ({ least, most, whole: true, why });
const realIn = (least: number, most: number, why: string): Domain => ({ least, most, whole: false, why });
/** A whole rule number with its own domain. */
const whole = (value: number, least: number, most: number, why: string): RuleNumber => new RuleNumber(value, wholeIn(least, most, why));
/** A rule number that may be a fraction, with its own domain. */
const real = (value: number, least: number, most: number, why: string): RuleNumber => new RuleNumber(value, realIn(least, most, why));
/** A rule number of a domain several rules share (each rank's XP, each kit's weight). */
const of = (value: number, domain: Domain): RuleNumber => new RuleNumber(value, domain);
/** A rule list of numbers, each in `domain`. */
const each = (value: readonly number[], domain: Domain): RuleNumbers => new RuleNumbers(value, domain);
/** A rarity of RULES.rarities: its color and the rank whose Clear prices it (`clearOf`). */
const rarity = (color: string, rank: Rank): { readonly color: string; readonly rank: Rank } => ({ color, rank });

/** RULES as declared, with each number's domain: the values with each rule number its plain value. */
type Values<T> = T extends RuleNumber ? number : T extends RuleNumbers ? number[]
  : T extends string | number | boolean | null | undefined ? T : T extends readonly unknown[] ? T : { [K in keyof T]: Values<T[K]> };
/** The values of a declaration: a part with no rule number in it is the same object (a registry RULES serves as it is). */
function valuesOf<T>(spec: T): Values<T>;
function valuesOf(spec: unknown): unknown {
  if (spec instanceof RuleNumber) return spec.value;
  if (spec instanceof RuleNumbers) return [...spec.value];
  if (!isObj(spec)) return spec;
  const out = Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, valuesOf(v)]));
  return Object.keys(spec).every(k => out[k] === spec[k]) ? spec : out;
}
/** Each rule number's domain by its dotted path; a rule list of numbers under the list's path. */
function domainsOf(spec: unknown, path: string, out: Map<string, Domain>): Map<string, Domain> {
  if (spec instanceof RuleNumber || spec instanceof RuleNumbers) out.set(path, spec.domain);
  else if (isObj(spec)) for (const [k, v] of Object.entries(spec)) domainsOf(v, path ? `${path}.${k}` : k, out);
  return out;
}

/**
 * The bounds of the personal gates' numbers, which protocol.ts also reads for the room's `rules` doc: a week between
 * spawns or open at most, ten gates held (the sheet push's bound, protocol.ts), a pack of at most 12 (a lone hunter
 * against more is no run, and a line of the roster holds at most 26 copies).
 */
export const SOLO_BOUNDS = { hours: 168, held: 10, pack: 12 } as const;

// Domains several rules share: one for each kind of number a table repeats by rank, kit, monster kind or ability kind.
const LEVEL = wholeIn(MIN_LEVEL, MAX_LEVEL, 'a level a hunter can hold (hunter/level.ts)');
const CHECK_BONUS = wholeIn(0, 30, 'a bonus on a d20 check: past 30 the die decides no DC');
const DC = wholeIn(1, 100, 'a d20 check\'s DC: the S rank\'s hardest is 55, and past 100 no bonus reaches it');
const MONSTER_XP = wholeIn(0, 1_000_000, 'XP a monster gives: a million is about the next level of a level 9999 hunter');
const BREAK_DAYS = wholeIn(1, 365, 'days a gate stays open: under a day it breaks as it opens, a year is the longest a table plans');
const PERCENT = wholeIn(0, 100, 'a percent of the bar a rest gives back or takes off');
const GOLD = wholeIn(0, 1_000_000_000, 'gold: a billion is the bound of every gold a reward or a monster\'s loot reads');
const WEIGHT = wholeIn(0, 1000, 'a chance weight against the others of its table: 0 never draws it, 1000 is 1000 times the smallest');
const SUMMON_MANA = wholeIn(0, 1000, 'mana a summon costs: past every body\'s mana it cannot be paid, which a GM may want');
const PACK = wholeIn(1, 26, 'monsters in a spawned pack: at least one, and a line of the roster holds at most 26 copies');
const SHARE_OF_SPAWNS = wholeIn(0, 100, 'a percent of the personal gates\' spawns');
const COST = wholeIn(10, 1000, 'hundredths of a standard action: under a tenth a body acts without end, past ten actions a turn is a fight');
const STAT_CAP = wholeIn(0, 1000, 'the most a stat\'s capped curve gives: 0 turns the stat\'s part off');
const SHARE = realIn(0, 1, 'a share of a whole: 0 is none of it, 1 all of it');
const KIT_WEIGHT = wholeIn(0, 200, 'a kit\'s weight: 200 is four times the heaviest carry a body has');
const KIT_GUARD = wholeIn(0, 1000, 'a kit\'s armor or resist: armor divides, so 1000 still lets a tenth of a hit through');
const KIND_FACTOR = realIn(0.1, 20, 'a factor on a monster\'s HP or power: under 0.1 it is not there, past 20 no party scratches it');
const KIND_STAGGER = realIn(0, 20, 'a stagger bar in same-rank hits: 0 is no bar, past 20 it never fills');
const KIND_XP = realIn(0, 100, 'a factor on the rank\'s XP: 0 pays none, 100 is a whole gate in one monster');
const WINDUP = wholeIn(0, 10_000, 'ticks before a use lands: 0 is at once, ten rounds is past any fight\'s patience');
const RANGE = wholeIn(0, 40, 'tiles a use reaches: 0 is the user\'s own tile, 40 is the largest map\'s side');
const RADIUS = wholeIn(0, 20, 'tiles of an area\'s radius: 20 covers the largest map from its middle');
const USE_FATIGUE = wholeIn(0, 100, 'fatigue one use costs: 100 is a whole base bar');
const USE_MANA = wholeIn(0, 1000, 'mana one use costs: past every body\'s mana it cannot be paid');
const COOLDOWN = wholeIn(0, 10_000, 'ticks before a use comes back: ten rounds is past any fight');
const EVENT_RATE = realIn(0, 10, 'times an event happens a round: 10 is every tick of a crowd');
const REF_ROUNDS = realIn(0.5, 50, 'rounds the reference party takes: a fight is 4 to 8, 50 is a siege');
const REF_HP = realIn(0.05, 20, 'a monster\'s max HP over the user\'s: 20 is past any boss');
const TIER_SHARE = realIn(0, 2, 'a share of the ability a kit replaces: 2 is twice it');
const BURST = realIn(0, 10, 'bolts or curses a burst is worth: 10 is a fight in one go');
/** The points a build path's main and second stat take of each level's points (registry/paths.ts `alloc`). */
export const PATH_ALLOC = wholeIn(0, 10, 'points a path puts in a stat for each the level gives: 0 is none, 10 is past every build');
/** A perk's points on a bonus key (a title's bonus, a path tier's perk): the bound of every flat bonus a parser reads. */
export const PERK_POINTS = wholeIn(-999, 999, 'a flat bonus: the bound of every flat number the kit parsers read (fight.kit.hpFlat)');
/** A daily objective's target. */
export const OBJECTIVE_TARGET = realIn(0.1, 100_000, 'a daily target: above 0 so it can be met, 100000 is past any day\'s count');

/** A rule number whose rule is an open map: each entry of the map has this domain. `*` stands for any one key. */
const OPEN_DOMAINS: ReadonlyArray<{ readonly re: RegExp; readonly domain: Domain }> = [
  { re: /^paths\.[^.]+\.alloc\.[^.]+$/, domain: PATH_ALLOC },
  { re: /^gateSpawn\.regulars\.[^.]+$/, domain: PACK },
];

/** What the daily quest gives besides its numbers, typed as a reward's parts so a GM's override of its items, skills or title is one (overrides.ts). */
const DAILY_REWARD_PARTS: Omit<Rewards, 'xp' | 'points' | 'gold'> = { items: [], title: null, job: null, skills: [], statuses: [], boons: [] };

const SPEC = {
  xpPerLevel: whole(100, 1, 1_000_000, 'XP to the next level is this times the level: 0 levels a hunter to the cap on 1 XP'),
  pointsPerLevel: whole(3, 0, 20, 'stat points a level gives: 20 is a main stat\'s worth of a rank every level'),
  streakBonusEvery: whole(7, 1, 365, 'days of a streak between its bonuses: a streak of 0 days divides by 0'),
  levelUpRestore: true,
  rankLevels: { E: of(1, LEVEL), D: of(10, LEVEL), C: of(20, LEVEL), B: of(35, LEVEL), A: of(50, LEVEL), S: of(70, LEVEL) },
  rankBonus: { E: of(2, CHECK_BONUS), D: of(3, CHECK_BONUS), C: of(4, CHECK_BONUS), B: of(5, CHECK_BONUS), A: of(6, CHECK_BONUS), S: of(8, CHECK_BONUS) },
  rankColors: { E: '#9fb6c9', D: '#59e6a8', C: '#4dd8ff', B: '#4d8cff', A: '#c79bff', S: '#ffc94d' },
  // A check's DC (easy, medium, hard), a normal monster's XP and the days a gate of the rank stays open. A monster's HP,
  // armor and attacks come from `fight.kinds` and its archetype (src/core/hunter/derive.ts `monsterSheet`).
  rankTable: {
    E: { dc: each([10, 13, 16], DC), xp: of(25, MONSTER_XP), breakDays: of(7, BREAK_DAYS) },
    D: { dc: each([14, 17, 20], DC), xp: of(75, MONSTER_XP), breakDays: of(6, BREAK_DAYS) },
    C: { dc: each([20, 24, 28], DC), xp: of(250, MONSTER_XP), breakDays: of(5, BREAK_DAYS) },
    B: { dc: each([27, 31, 35], DC), xp: of(800, MONSTER_XP), breakDays: of(4, BREAK_DAYS) },
    A: { dc: each([35, 40, 45], DC), xp: of(2500, MONSTER_XP), breakDays: of(3, BREAK_DAYS) },
    S: { dc: each([45, 50, 55], DC), xp: of(8000, MONSTER_XP), breakDays: of(2, BREAK_DAYS) },
  },
  fatigue: {
    penaltyAt: whole(50, 0, 1000, 'fatigue from which checks pay the penalty: past the largest bar (150) never'),
    penalty: whole(2, 0, 20, 'taken off every check when tired: 20 is the whole d20'),
    disAt: whole(80, 0, 1000, 'fatigue from which checks roll at a disadvantage: past the largest bar (150) never'),
    collapseAt: whole(100, 0, 1000, 'fatigue at which a body collapses: past the largest bar (150) never'),
  },
  rest: {
    short: { hpPct: of(25, PERCENT), mpPct: of(50, PERCENT), fatigue: of(25, PERCENT) },
    long: { hpPct: of(100, PERCENT), mpPct: of(100, PERCENT), fatigue: of(100, PERCENT) },
  },
  penaltyCheck: whole(2, 0, 20, 'taken off every check while Penalized: 20 is the whole d20'),
  dailyTemplate: {
    title: 'Strength Training', desc: 'Finish the daily training before the day resets.',
    objectives: [
      { label: 'Push-ups', target: 100, progress: 0 }, { label: 'Sit-ups', target: 100, progress: 0 },
      { label: 'Squats', target: 100, progress: 0 }, { label: 'Running (km)', target: 10, progress: 0 },
    ],
    // What the daily quest gives, typed as a reward so a GM's override of its items, skills or title is one (overrides.ts).
    rewards: {
      xp: whole(25, 0, 1_000_000, 'XP a daily gives: a million is about the next level of a level 9999 hunter'),
      points: whole(1, 0, 20, 'stat points a daily gives: 20 is a level\'s worth and more every day'),
      gold: of(0, GOLD),
      ...DAILY_REWARD_PARTS,
    },
  },
  jobs: ['Fighter', 'Assassin', 'Mage', 'Tanker', 'Healer', 'Ranger', 'Necromancer'],
  extractJobs: ['Necromancer', 'Shadow Monarch'],
  // each rule title has a key a granted title records (`Title.seedKey`), so a rename keeps it and a GM title of the same name is another
  titles: [
    { key: 'wolf-slayer', name: 'Wolf Slayer', desc: 'Killed the leader of a wolf pack.', bonus: { str: 2 } },
    { key: 'overcame-adversity', name: 'One Who Overcame Adversity', desc: 'Survived a fight you were expected to lose.', bonus: { hpMax: 20 } },
    { key: 'demon-hunter', name: 'Demon Hunter', desc: 'Defeated a demon in a low-rank gate.', bonus: { pre: 2 } },
    { key: 'hunts-alone', name: 'The One Who Hunts Alone', desc: 'Cleared a gate without a party.', bonus: { agi: 2 } },
    { key: 'king-of-shadows', name: 'King of Shadows', desc: 'Leads a shadow army.', bonus: { pow: 5 }, gmOnly: true },
  ],
  conditions: BUILT_IN_STATUSES, // the built-in statuses: src/core/registry/statuses.ts
  // Each rarity's color and the rank whose Clear prices it (`clearOf`; economy design 2.2): a price is computed from the
  // loot table, never stored, so a GM's edit of a rank's loot gold moves the price of its rarity.
  rarities: {
    common: rarity('#9fb6c9', 'E'), uncommon: rarity('#59e6a8', 'D'), rare: rarity('#4dd8ff', 'C'),
    epic: rarity('#c79bff', 'B'), legendary: rarity('#ffc94d', 'A'), mythic: rarity('#ff6b3d', 'S'),
  },
  slots: ['weapon', 'offhand', 'head', 'chest', 'hands', 'legs', 'feet', 'neck', 'ring1', 'ring2'],
  // gold: a range low to high (overrides.ts reads its order)
  loot: {
    E: { gold: each([50, 150], GOLD), weights: { common: of(70, WEIGHT), uncommon: of(25, WEIGHT), rare: of(5, WEIGHT) } },
    D: { gold: each([150, 500], GOLD), weights: { common: of(50, WEIGHT), uncommon: of(35, WEIGHT), rare: of(13, WEIGHT), epic: of(2, WEIGHT) } },
    C: { gold: each([500, 2000], GOLD), weights: { common: of(30, WEIGHT), uncommon: of(40, WEIGHT), rare: of(25, WEIGHT), epic: of(5, WEIGHT) } },
    B: { gold: each([2000, 8000], GOLD), weights: { uncommon: of(30, WEIGHT), rare: of(45, WEIGHT), epic: of(22, WEIGHT), legendary: of(3, WEIGHT) } },
    A: { gold: each([8000, 30000], GOLD), weights: { rare: of(40, WEIGHT), epic: of(45, WEIGHT), legendary: of(14, WEIGHT), mythic: of(1, WEIGHT) } },
    S: { gold: each([30000, 120000], GOLD), weights: { epic: of(50, WEIGHT), legendary: of(42, WEIGHT), mythic: of(8, WEIGHT) } },
  },
  // The economy (docs/agent-handoff/features/economy/design.md, each number's reason in its section). A price is a count
  // of Clears (`clearOf`); a world gate's gold and XP are a pot shared by the hunters paid.
  gradeStep: real(1.5, 1, 1.8, 'a grade\'s factor on its tier\'s price: 1 prices a plus as a minus, past 1.8 a plus costs more than the next tier\'s minus (1.8 squared is under 3.25, the smallest step of the shipped ladder)'), // design 2.1: three grades make a tier, a factor of 3.25 to 4, so one grade is about its cube root
  saleShare: of(0.25, SHARE), // design 3: the Association buys an item back at a quarter of its price (the owner: "A quarter.")
  usedUpShare: of(0.5, SHARE), // design 2.2: a consumable is one use, so a Clear buys two of its rank
  reviveClears: whole(10, 1, 1000, 'Clears of its rank a Resurrection Crystal costs: under 1 it costs less than a middle item of its rank, 1000 is out of any table\'s reach'), // design 5: a full set of its rank's middle gear
  reviveLevelShare: of(1 / 30, SHARE), // design 4.4, ruling 9: a raising takes this share of the level, rounded up, never below level 1 ("maybe 3.33% of your total level")
  gateParty: whole(4, 1, 12, 'the hunters a world gate is made for: at least one, past 12 no table seats them'), // design 4.1: the session model's party; its gold and XP are a pot of this many shares
  // design 2.3: the points an item may spend beyond its slot's free numbers
  itemBudget: {
    share: real(0.5, 0, 2, 'the share of a hunter\'s points its gear may hold, over the slots: 0 leaves an item no budget, 2 is twice the hunter\'s own'), // half of what a hunter of the tier's rank holds at its first level, over the 10 slots
    weaponStep: real(1, 0, 10, 'mean damage a weapon\'s free die gains a tier: 0 keeps every tier at the reference die, 10 is past any die\'s step'), // the free die rises by 1 mean damage a tier from 1d8
    // The foe a point of penetration is weighed against (balance plan section 9): a same-rank monster of this kind, a
    // brute's armor for the armor pair and a caster's resist for the resist pair. Penetration is worth more the thicker
    // the defence, so the foe is named; the elite sits between a pack's normal and a boss. One of `fight.kinds`
    // (overrides.ts refuses any other).
    penFoe: 'elite' as 'normal' | 'elite' | 'boss',
    // The cooldown a point of `haste` (ability haste) is weighed on (balance plan section 10): an ability that comes back
    // every this many rounds, so a point of haste gives a hundredth of a use more every this many rounds. 3 is the middle
    // of the built-in skills' cooldowns (Dagger Rush and Marked Shot 2, Mutilation, Sprint and Shield Wall 3, Stealth and
    // Mending Aura 4, Ruler's Authority 5).
    cooldownRounds: real(3, 1, 20, 'rounds of the cooldown haste is weighed on: under 1 an ability is back each turn, 20 is past any fight'),
  },
  shadow: {
    maxAttempts: whole(3, 1, 20, 'tries at one corpse: 0 would offer an Extract that cannot be tried'),
    dcBase: of(10, DC), dcPerRank: whole(3, 0, 20, 'DC added for each rank the foe is above the hunter: 20 is the whole d20'),
    bossDc: whole(5, 0, 50, 'DC added for a boss: 50 makes a boss out of reach of any bonus'), dcMin: of(5, DC),
    summonMp: { E: of(1, SUMMON_MANA), D: of(2, SUMMON_MANA), C: of(4, SUMMON_MANA), B: of(8, SUMMON_MANA), A: of(16, SUMMON_MANA), S: of(32, SUMMON_MANA) },
  },
  gateSpawn: {
    rank: { E: of(40, WEIGHT), D: of(30, WEIGHT), C: of(15, WEIGHT), B: of(9, WEIGHT), A: of(5, WEIGHT), S: of(1, WEIGHT) },
    type: { normal: of(85, WEIGHT), red: of(10, WEIGHT), double: of(5, WEIGHT) },
    redDcBonus: whole(3, 0, 20, 'DC a red gate adds: 20 is the whole d20'),
    regulars: { E: each([1, 3], PACK) }, // [min, max] pack size for a rank, any rank's in PACK (OPEN_DOMAINS); ranks not listed spawn 2-6
  },
  gateNames: ['Goblin Warren', 'Crimson Cavern', 'Frost Hollow', 'Sunken Temple', 'Ant Nest', 'Iron Fortress',
    'Whispering Catacombs', 'Ashen Spire', 'Moonlit Marsh', 'Double Dungeon', 'Demon Castle', 'Giant\'s Vault'],
  // maxDice: the owner was told a term rolls up to 100 dice (Roll20's own cap is higher); the exact mean of the worst keep
  // term this allows (100d1000!kh50) costs under a second, once, when a GM types it. maxSides: a d1000 is the largest die named.
  // Neither goes higher: the odds of a keep term list every face, so a billion sides is a list of a billion.
  dice: {
    maxDice: whole(100, 1, 100, 'dice one term rolls: past 100 the exact odds of a keep term take seconds to work out'),
    maxSides: whole(1000, 2, 1000, 'sides of the largest die: the odds list every face, so a d1000000000 eats the phone\'s memory'),
  },
  logCap: whole(200, 1, 1000, 'lines of the session log a save keeps: past 1000 the save outgrows a phone\'s storage'),
  rollCap: whole(50, 1, 500, 'rolls the dice history keeps: past 500 it outgrows its screen and the save'),
  backupCap: whole(8, 1, 20, 'backups kept, each a whole save: past 20 they fill a phone\'s storage'),
  loadoutCap: whole(6, 0, 24, 'gear sets a hunter may save: 0 is none, 24 is the save\'s limit (repair.ts LIMITS.loadouts)'),
  // A hunter's personal gates, the System's (notes-2-solo.md section 7 has each number's reason): on, a spawn every
  // `hours`, at most `held` open at once (stays / hours, so a once-a-day player loses none), each open `stays` hours; a
  // spawn's rank one below, at, or one above the hunter's by `ranks` (percent), its pack `pack` normal monsters of that
  // rank from the built-in seeds, no boss. The pack was 1 to 3 until measured: two same-rank normals already kill a
  // level 1 pregen in about 40% of plays, so 2 is the hard gate and 3 is the party's (notes-2-solo.md section 16).
  solo: {
    personal: true,
    hours: whole(8, 1, SOLO_BOUNDS.hours, 'hours between spawns: 0 spawns without end, a week is the longest'),
    held: whole(3, 1, SOLO_BOUNDS.held, 'gates open at once: the sheet push carries at most 10'),
    stays: whole(24, 1, SOLO_BOUNDS.hours, 'hours a gate stays open: under one it closes as it opens, a week is the longest'),
    ranks: { below: of(25, SHARE_OF_SPAWNS), same: of(60, SHARE_OF_SPAWNS), above: of(15, SHARE_OF_SPAWNS) },
    pack: each([1, 2], wholeIn(1, SOLO_BOUNDS.pack, 'monsters in a personal gate: a lone hunter against more than 12 is no run')),
    lootShare: of(0.25, SHARE), // economy design 4.2: a cleared personal gate pays a quarter of one hunter's share of a world gate (the owner: "A quarter.")
  },
  // feats (hunter/feats.ts): `on` is the GM's one switch for every feat the System notices; the room's `rules` doc carries it to the players
  feats: { on: true },
  build: { enabled: true, playerPick: true, respecGold: whole(5, 0, 1_000_000, 'a respec costs this times the level squared in gold: 0 is free') }, // respecGold: a player's own respec costs respecGold * level * level gold (GM mode is free)
  paths: BUILT_IN_PATHS, // the build paths and their perks: src/core/registry/paths.ts; each `alloc` number in PATH_ALLOC (OPEN_DOMAINS), each perk in PERK_POINTS
  // The reworked fight's numbers (docs/agent-handoff/rw/design.md; scripts/rw-paper.ts prints the tables they make).
  // src/core/stats.ts, src/core/hunter/derive.ts, combat/timeline.ts and combat/space.ts read them. Each comment is the
  // reason for the value; the last words of each rule are the reason for its domain.
  fight: {
    // Time (design 1.2)
    round: whole(1000, 100, 10_000, 'ticks in a round: under 100 the rounding of speed shows, 0 divides by 0'), // ticks in a round, the time a speed-100 combatant needs for one standard action; 1000 keeps rounding under 0.1%
    cost: { quick: of(70, COST), standard: of(100, COST), heavy: of(150, COST) }, // hundredths of a standard action: two quick actions cost more than one standard, a heavy one half a turn more
    moveCost: real(100 / 6, 1, 100, 'hundredths of a standard action a tile walked costs: a whole action a tile is a crawl'), // one tile walked: six tiles cost a standard action, so everyone walks `move` tiles a round
    // A dash (design 4.6) runs the whole `move` in one straight line, twice a stride, for `dashTime` hundredths of a
    // standard action (the lead's standard action) and twice a strike's fatigue: a charge is how a heavy fighter closes
    // on an archer, and it costs breath. A walk already covers 6 tiles in a standard action's time at any speed, so at
    // 100 a dash is quicker than walking only for a body over speed 100 (sim-log.md, round three).
    dashTime: of(100, COST), dashFatigue: of(16, USE_FATIGUE),
    // at 40 a combatant still acts every 2.5 rounds, at 250 it acts 2.5 times a round
    speedMin: whole(40, 10, 100, 'the slowest speed: 0 never acts, and above 100 the base speed is slowed'),
    speedMax: whole(250, 100, 1000, 'the fastest speed: under 100 the base speed is cut, 1000 is ten turns a round'),
    // Stats (design 2.1)
    statBase: whole(10, 1, 100, 'every stat\'s start, the curve\'s divisor: 0 makes every stat not a number'), // every stat starts at 10
    creationPoints: whole(12, 0, 100, 'free points at level 1: 100 is past an S build'), // free points at level 1, four levels' worth: enough for a main stat of 20 so an E build is a build
    mainShare: real(2 / 3, 0.5, 1, 'a built body\'s share in its main stat: under half the second stat is the main'), // a built body (a monster, a shadow, a starter, the sim's builds) puts two points in its main stat for one in its second
    effExp: real(0.8, 0.1, 1, 'the stat curve\'s power: 1 is a straight line, under 0.1 a stat does nothing'), // eff(s) = base * (s / base) ^ 0.8: doubling a stat gives 1.74 times, an S main stat is worth 9.8 base ones
    half: whole(40, 1, 1000, 'points at which a capped curve gives half its cap: 0 divides by 0'), // every capped curve reaches half its cap at 40 effective points; a C main stat has 34
    // The Sheet (design 2.2)
    growthDiv: whole(24, 1, 1000, 'levels a body\'s growth is spread over: 0 divides by 0'), // g(level) = 1 + (level - 1) / 24: level carries most HP, so a fight is a similar number of hits at every rank
    // hpMax = g * 45 * (1 + capped(x(vit), 0.9)): Vitality's share of HP is a share like every other, on the capped curve
    // with Agility's cap on speed (90%), so a tank's toughness and a speed build's turns grow with rank at the same rate:
    // 1.14 times at E, 1.41 at C, 1.62 at S, never 1.9. It was 45 + 0.5 * x(vit), uncapped: a tank 1.09 times as tough as
    // a speed build at E and 1.98 at S, which flipped tank against speed from 0.10 at C to 1.00 at S (sim-log.md, round two).
    hpBase: whole(45, 1, 1000, 'a level 1 body\'s HP before Vitality: 0 is a body that is down'),
    hpVitCap: real(0.9, 0, 5, 'Vitality\'s largest share of HP: 5 is six times the base'),
    manaBase: whole(10, 0, 1000, 'mana before the will stat: 0 is a body with no mana'), manaCap: of(30, STAT_CAP), // mana counts big casts a dungeon, so it does not grow with rank: an S cannon has 31, three casts
    fatigueBase: whole(100, 1, 1000, 'today\'s fatigue bar: 0 is a body that collapses at once'), fatigueCap: of(50, STAT_CAP), // today's 0 to 100 bar; Vitality makes a body last longer, not hit harder
    carryBase: whole(20, 1, 1000, 'weight a base body carries, the load\'s divisor: 0 divides by 0'), carryCap: of(50, STAT_CAP), // weight is what Strength lets you wear
    // free up to half the carry, then up to 35% slower at full carry: a heavy kit on a weak body costs a third of its turns
    freeLoad: of(0.5, SHARE), loadSlow: real(0.35, 0, 0.9, 'the most a load slows: at 1 a loaded body never acts'),
    // Strength lifts weight but does not shrink plate: weight over a base body's whole carry (`carryBase`, 20) is bulk, and
    // slows any wearer 2.5% a point, at most `loadSlow`. Only plate (32) has bulk: 12 points, 30% slower, so a tank runs
    // at 70 at C and at S alike (an S tank's Strength had lifted its load to 87, and it beat an S speed build in every
    // duel; sim-log.md, round four). The medium kit (18) and the light (8) have none.
    bulkSlow: real(0.025, 0, 0.1, 'speed a point of bulk takes off: at 0.1 one point of bulk is a tenth'),
    speedBase: whole(100, 10, 1000, 'a base body\'s speed: 100 is a standard action a round'), speedCap: of(90, STAT_CAP), // Agility alone takes a body to at most 190 before load
    moveBase: whole(6, 1, 40, 'tiles a round at speed 100: 0 never moves, 40 is the largest map\'s side'), // tiles a round at speed 100: 30 feet, the pace the old text assumes
    strideShare: real(0.5, 0.1, 1, 'the share of a move one command walks: under a tenth no step is taken'), // one move command walks at most half of `move`, so a turn is never one long walk
    armorVitCap: of(30, STAT_CAP), // gear carries most armor, so the tank pays weight for it; Vitality gives a little to every body
    resistDisCap: of(40, STAT_CAP), // the magical twin of armor, from the will stat, so the tank in plate is open to magic
    // Penetration in whole percent of the armor or resist a hit meets (rule 12, balance plan section 9). Control's curve
    // gives up to `penCap` of both the armor and the magic percent: Control finds the gap. `penMax` caps the percent with
    // every bonus on it (an item's, a perk's, a status's), so armor always stops at least 40% of what it would; a bonus
    // passes Control's curve cap, never this one.
    penCap: of(40, STAT_CAP),
    penMax: whole(60, 0, 100, 'the most armor or resist a hit\'s percent penetration ignores: at 100 a hit ignores all of it'),
    powerK: real(0.6, 0.01, 10, 'damage a point of a power stat gives: under 0.01 nobody is hurt'), // phys, mag and sup are 0.6 * eff of their stat: uncapped, so damage keeps growing with rank
    critFacesCap: whole(5, 0, 10, 'd20 faces a crit takes: past 10 half of every use is a crit'), // a crit is 5% to 30% of uses, never the 1 in 3 where it becomes the expected hit
    critSizeBase: real(1.5, 1, 5, 'a crit\'s size: under 1 a crit hurts less than a hit'), critSizeCap: real(0.5, 0, 5, 'a crit\'s largest growth: 5 is six times a hit'), // a crit is 1.5 to 2 times: felt, and never more than today's double dice
    openK: real(0.25, 0, 2, 'Instinct\'s share on the opening d20: 2 is twice its points'), openCap: whole(6, 0, 20, 'the most Instinct adds to the opening d20: 20 is the whole die'), // Instinct's opening bonus on the d20, capped at 6 so the die still decides 70% of the opening
    tenacityCap: of(60, STAT_CAP), // tenacity, from Strength and Discipline together; control lasts duration * (100 + potency) / (100 + tenacity): at most 37% shorter
    potencyCap: of(50, STAT_CAP), // mirrors tenacity, so equal investment cancels
    threatCap: real(1, 0, 10, 'Presence\'s most on threat: 10 is eleven times'), // a Presence build draws up to twice the threat for the same damage
    holdBase: real(0.15, 0.01, 1, 'the share of max HP one hit needs to break a channel: under 0.01 any tick breaks it'), holdCap: of(0.25, SHARE), // a single hit of hold * hpMax breaks a channel: a status tick never does, one real attack does
    costCutCap: real(0.25, 0, 0.9, 'Control\'s most off a cost: at 1 every use is free'), // Control lowers costs, at most a quarter off
    shadowPerEff: real(0.2, 0, 10, 'shadows a point of Presence holds: 10 is an army per point'), // shadow capacity = floor(0.2 * eff(pre)): 2 at base, 19 for an S Presence build
    // Kits (design 2.3): weight on the armour slots, the offhand and the weapon
    kits: {
      light: { weight: of(8, KIT_WEIGHT), armor: of(10, KIT_GUARD), resist: of(15, KIT_GUARD) }, // never slows anyone (8 is under half the smallest carry); robes carry a little resist
      medium: { weight: of(18, KIT_WEIGHT), armor: of(30, KIT_GUARD), resist: of(5, KIT_GUARD) }, // free from Strength 33, 28% slower on Strength 10
      // Takes 37% off physical damage and as much off magic, and costs any body at least 30% of its speed (its bulk). Plate
      // stops a bolt as it stops a blade: the cannon beats the tank on tempo (it acts 1.4 times as often as a tank in plate),
      // Power and penetration, not because plate lets magic through. At resist 20 the cannon won 0.95 of duels at E, 0.97
      // at C and 0.98 at S; resist alone could not bring them in below 80, because the tank's turns decide the duel
      // (sim-log.md, round four). It was 0 until round two.
      heavy: { weight: of(32, KIT_WEIGHT), armor: of(60, KIT_GUARD), resist: of(60, KIT_GUARD) },
    },
    // Monster kinds (design 2.4, 4.2 and 4.3): factors on max HP and power, and the stagger bar in same-rank hits (0 is
    // no bar). A kind shortens and weakens nothing that lands on it: a boss is tougher by its own numbers (here its HP), not
    // by halving a stun, a push or a share (the owner, Nov 21). A normal monster is a weaker body, so three hunters beat a
    // pack of three. A boss has 3.2 bodies of HP with one turn: at 4 the S party needed 9.8 rounds (the simulation,
    // docs/agent-handoff/rw/sim-log.md), past the 8 a boss fight may last, because the tank spends its turns taunting.
    // `xp` is the factor on the rank's XP (`rankTable`), as the old boss (3) and elite (1.5) rules gave it.
    kinds: {
      normal: { hp: of(0.6, KIND_FACTOR), power: of(0.7, KIND_FACTOR), stagger: of(0, KIND_STAGGER), xp: of(1, KIND_XP) },
      elite: { hp: of(1.5, KIND_FACTOR), power: of(1, KIND_FACTOR), stagger: of(2.5, KIND_STAGGER), xp: of(1.5, KIND_XP) },
      boss: { hp: of(3.2, KIND_FACTOR), power: of(1.2, KIND_FACTOR), stagger: of(4, KIND_STAGGER), xp: of(3, KIND_XP) },
    },
    // Defence (design 3.1 rule 12)
    armorK: whole(100, 1, 10_000, 'the armor curve\'s divisor: 0 makes a hit on bare skin not a number'), // dealt = raw * 100 / (100 + def): 60 armor takes 37% off, and no amount of armor makes a body immune
    // The flat part of armor or resist: 3% of what is left after penetration comes off every hit before the percentage,
    // so a weak hit loses more than a strong one (the mirror of penetration's flat part). A C tank's 74 takes 2.2 off a
    // speed build's 14-point shot (15%) and off a bruiser's 30-point strike (7%). At 0 tank against speed at C was 0.49 of
    // duels (sim-log.md, round two); at 0.03 it is 0.80; at 0.06 it is 1.00, as a duel is near all or nothing.
    armorFlat: real(0.03, 0, 0.5, 'the flat part of armor: at 0.5 armor 60 takes 30 off every hit'),
    // Reaction (design 3.1 rules 8 and 9, 3.2)
    reactK: real(0.25, 0, 2, 'edge a point of Reaction over Accuracy gives: 2 is two faces a point'), reactCap: whole(6, 0, 20, 'the most edge either way: 20 is the whole d20'), // edge = round(0.25 * (react - aim)), at most 6 either way, so the d20 always decides
    // Reaction = 10 + x(ins) + reactAgi * x(agi): noticing the blow is Instinct, getting the body moving is Agility (the owner's
    // notes give Agility "speed and dodge"), and each counts once, the weight Instinct already had. Reaction is compared
    // with Accuracy, which is eff(ctl) uncapped, so it stays on the same curve; the edge's cap of 6 bounds it. With
    // Instinct alone a speed build had Reaction 10 and the cannon's Control cancelled its dodge: speed beat the cannon
    // 0.30 of duels at C (sim-log.md, round three).
    reactAgi: real(1, 0, 5, 'Agility\'s weight in Reaction: 0 is Instinct alone'),
    // A use with no travel is resisted on d20 + will edge of 12 or more, or a 20: 45% at equal Will and Accuracy, and 15%
    // to 75% at the edge's cap of 6 either way, so the die decides even against a caster's best Control, as it does for a
    // dodge. At 15 a C cannon's Control (edge -4) left its curse resisted 10% of the time and an S one's 5%, a natural 20
    // alone, and speed beat the cannon in 0.51 of duels at C once it cast Arc Bolt. At 11 (a coin flip at parity) the S
    // boss resisted enough of the cannon's bolts to last past 8 rounds (sim-log.md, round four).
    resistDc: whole(12, 2, 21, 'the d20 a will resists on: 2 resists all but a 1, 21 only a natural 20'),
    resistedShare: of(0.5, SHARE), // a resisted use deals half and applies no status
    ringShare: of(0.5, SHARE), // the default share of damage in an area's outer ring
    // Ability kinds (design 3.3): the numbers each kind fills in when the maker starts one. A wind-up is ticks before the
    // ability lands, `travel` tiles a round after it, a range and a radius in tiles, fatigue and mana what one use costs,
    // a cooldown in ticks. src/core/registry/ability-kinds.ts holds each kind's shape and reads these.
    abilityKinds: {
      // A swing is over before a body can step out of reach: a wind-up of 0.1 round, and even a d20 of 20 moves 0 tiles (table 3.A).
      strike: { windup: of(100, WINDUP), range: of(1, RANGE), fatigue: of(8, USE_FATIGUE), mana: of(0, USE_MANA), cooldown: of(0, COOLDOWN) },
      // An arrow is dodged by a fast body about half the time and a normal one a fifth: 0.1 round, then 80 tiles a round (table 3.B).
      shot: {
        windup: of(100, WINDUP), travel: whole(80, 1, 1000, 'tiles a round a shot flies: 0 never arrives'), range: of(12, RANGE),
        fatigue: of(6, USE_FATIGUE), mana: of(0, USE_MANA), cooldown: of(0, COOLDOWN),
      },
      // A blast is a telegraph a fast body leaves and a slow one does not: a full round, nothing after it (table 3.C). At
      // 0.6 round the C speed build was out of it a quarter of the time and lost to the cannon (sim-log.md, round three);
      // at 1 round, with Reaction from Agility, it is out 85% and a C tank 10%. A radius of 2 with a ring to 3 is a
      // 7-tile-wide area; 10 mana is a major cast, so a cannon's 20 to 31 mana is 2 or 3 a dungeon.
      blast: {
        windup: of(1000, WINDUP), radius: of(2, RADIUS), ring: of(3, RADIUS), range: of(10, RANGE),
        fatigue: of(0, USE_FATIGUE), mana: of(10, USE_MANA), cooldown: of(0, COOLDOWN),
      },
      // Nothing travels, so there is no wind-up: the target's Will resists it instead. Range 8, the gap between the default lines.
      curse: { range: of(8, RANGE), fatigue: of(8, USE_FATIGUE), mana: of(0, USE_MANA), cooldown: of(0, COOLDOWN) },
      // An ally is not avoiding it. Range 6, one round's walk at speed 100.
      support: { range: of(6, RANGE), fatigue: of(6, USE_FATIGUE), mana: of(0, USE_MANA), cooldown: of(0, COOLDOWN) },
    },
    // Fatigue back after a fight: a little over half a base capacity, so a body that spent it all in one fight is not fresh
    // for the next. The speed build spends about 72 in a 6-round fight: at 55 it is at 88 after two fights and at its
    // capacity in the third, and nobody is before it. At 50 it reached its capacity before the third fight in 15 dungeons
    // of 100 (sim-log.md, round three).
    fightRest: whole(55, 0, 1000, 'fatigue back after a fight: past the largest bar every fight ends fresh'),
    // Channel (design 4.1)
    channelMax: whole(5, 1, 20, 'the most charge: at 0 a channel never fires, past 20 its tick outgrows any HP'), // charge grows one a turn and stops at 5
    channelLin: real(0.5, 0, 5, 'the linear tick\'s growth a charge: 5 is 26 times at a charge of 5'), // the maker's linear tick: base * (1 + 0.5 * charge), 3.5 times at 5, the safe choice
    channelExp: real(1.45, 1, 3, 'the exponential tick\'s growth a charge: under 1 it shrinks, 3 is 243 times at 5'), // the maker's exponential tick: base * 1.45 ^ charge, 6.4 times at 5, nearly a same-rank boss's HP
    breakShare: of(0.5, SHARE), // a broken channel fires at half its charge, rounded down
    // Threat (design 4.2)
    threatDecay: of(0.1, SHARE), // every entry falls 10% a round, so a hunter who stops attacking fades out in about 7 rounds
    tauntBurst: real(2, 0, 10, 'times the gap to the leader a taunt adds: 10 holds a monster for the fight'), // a taunt adds twice the gap to the leader, the smallest rule that matters after the taunt ends
    tauntRounds: whole(2, 0, 10, 'rounds a taunt holds: 10 is past any fight'), // one or two of the monster's turns: enough to pull it off a dying hunter, short enough to keep taunting
    // Stagger (design 4.3)
    staggerWeak: real(1.5, 1, 5, 'a weak hit\'s weight on the bar: under 1 a chip counts less than its damage'), // a hit under a third of a same-rank hit fills 1.5 times its damage: chips help without being the way to kill
    staggerCost: real(1.5, 0, 10, 'rounds a full bar pushes the monster\'s turn: 10 is past any fight'), // a full bar moves the monster's next turn to now + 1.5 rounds: it misses one turn and part of another
    staggerWeakBelow: of(1 / 3, SHARE), // a weak hit is under a third of a same-rank hit: a status tick or a chip build's quick hit
    staggerRegrow: real(0.75, 0, 5, 'the bar\'s growth after a stagger: 5 makes the second bar six times the first'), // the bar's max grows 75% after each stagger, so a boss fight has one or two staggers: at 50% an S boss, about 24 same-rank hits long, filled a third bar in 3 fights of 10 (sim-log.md)
    // Shield (design 4.4)
    shieldLife: whole(2, 0, 20, 'rounds a shield lasts: 20 is past any fight'), // rounds: a shield buys a turn, not a fight
    // Space (design 5.1 to 5.3)
    tileFeet: whole(5, 1, 100, 'feet a tile is: the feet of an ability are divided by it'), // 21 monster abilities already give distances in feet, and a portrait phone fits about 20 by 14 tiles
    lineGap: whole(8, 1, 36, 'tiles between the default lines: both lines and their rows fit the largest map\'s side of 40'), // tiles between the two default lines: two or three turns of walking for a slow build, one for a fast one
    lineBack: whole(2, 0, 10, 'rows behind the party\'s front line: 10 is a quarter of the largest map'), // rows behind the party's front line, so a reserve stands behind it; the foes' front at 10 leaves them 3 rows on a grid 14 high
    // a fight with no map: 100 by 70 feet, a room or a clearing
    grid: {
      w: whole(20, GRID_SIDE[0], GRID_SIDE[1], 'tiles of the open arena\'s width: a map\'s bounds (space.ts GRID_SIDE)'),
      h: whole(14, GRID_SIDE[0], GRID_SIDE[1], 'tiles of the open arena\'s height: a map\'s bounds (space.ts GRID_SIDE)'),
    },
    // The map (design 4.7 and 5.3)
    coverShare: of(0.25, SHARE), // a body in cover takes a quarter less from a use that travels to it: the d20's three-quarters cover, +5 to hit, is a quarter of the die
    sight: whole(25, 1, 128, 'tiles the party sees in a fog: a map\'s bounds (maps.ts MAP_BOUNDS.sight)'), // tiles the party sees in a fog of war: the whole default arena from its corner (19 + 13 / 2 = 25 by the 5-10-5 count); a GM lowers it for a dark gate
    // Stealth and sight (docs/agent-handoff/features/notes-7-stealth.md section 2): the sight level every body has before
    // a sight op raises it. 0, so a body with no sight content perceives no stealth above level 0, and sight is earned
    // from a class, an item or a flare: a curve on Instinct would let any hunter who spends points see every hide.
    stealth: {
      sightBase: whole(0, Math.min(...LEVELS), Math.max(...LEVELS), 'a sight level, one per rank E to S (standing.ts LEVELS): a level past 5 cannot be written'),
      // The ambush (section 2, the owner's rulings 3 and 5): a use's hit from hiding on a target that does not perceive its
      // user deals this many times as much, in place of the attacker's edge hiding gave. It is one of the user's dealt
      // increases (rule 11c), so a dealt buff does not compound with it and `kit.shareCap` still bounds it. A hide is one
      // action that deals nothing: at 1.5 a hide and a strike deal 1.5 strikes in two actions, so the ambush pays back
      // half the action and the turns no foe can pick its bearer pay the rest; at 2 the pair deals what two strikes deal
      // and those turns come free, so hiding beats striking outright. The worst heavy strike on a tank stays under design
      // 6's 60% of its HP: table 8.10.2b's 38% (with the old edge, larger than without it) times 1.5 is 57%.
      ambush: real(1.5, 1, 2, 'times a hit from hiding: 1 is no ambush, at 2 a hide and a strike deal two strikes\' damage and hiding beats striking outright'),
    },
    // Fields that move and spread (design 4.8)
    auraRadius: of(2, RADIUS), // an aura the maker starts: a blast's radius, so an aura and a blast read with the same ruler
    fieldRadiusMax: of(6, RADIUS), // the widest an aura or a growing field gets: 121 tiles, under half the default arena's 280, so there is somewhere to stand outside it
    fieldGrow: whole(1, 0, 10, 'tiles of radius a growing field gains a round: 10 covers a map in two rounds'), // tiles of radius a growing field gains a round in the maker: a walker at move 6 outruns it
    spreadRange: whole(1, 1, 10, 'tiles a sickness passes: 0 never passes'), // a sickness passes by touch: a body next to its bearer, diagonals too
    spreadRangeMax: whole(3, 1, 10, 'the furthest a sickness passes: past 10 it is the whole fight'), // further than that it is an aura
    // Kits (docs/agent-handoff/kits/design.md sections 1.11, 3 and 8.0; `bun scripts/kits-paper.ts` prints the tables): the
    // caps every parser of the kit blocks reads, what the reducer stops at, and what the maker weighs a made thing against.
    // A cap's domain stops at a few times its value: each bounds a loop or a list the reducer walks every command.
    kit: {
      stackCap: whole(20, 1, 99, 'the most stacks a def holds: two digits on a chip'), // the most stacks a def may hold: twice the largest cap a sheet writes (Baangs 9, Cold's threshold 5), and two digits on a chip
      stackAdd: whole(3, 1, 20, 'the most stacks one op adds or cures: 0 adds none'), // the most stacks one op adds or cures: Anchor's "twice as fast" is 2; a third leaves room, a fourth is a threshold in one hit
      triggers: whole(4, 0, 8, 'triggers on one status def: each is a line the GM reads, and the firings multiply'), // triggers on one status def: the most any kit item needs is 2 (Osteoporosis), and each one is a line the GM reads
      triggerOps: whole(6, 1, 12, 'ops in one trigger: an item\'s effects list is 12'), // ops in one trigger, a threshold or an end: an item's effects list is 12, half of it is a full rule
      depth: whole(2, 0, 4, 'trigger depth: each level multiplies the firings of one command'), // a trigger's ops raise further triggers to this depth: Parry, then Retribution's hit, then Void Knight's stack is 2
      fires: whole(16, 1, 64, 'trigger firings in one command: the bound of the loop that fires them'), // trigger firings in one command, whatever the depth: 4 triggers on 4 statuses of the user is 16
      fightUses: whole(10, 1, 99, 'uses an "n a fight" limit may have: two digits'), // the most uses an "n a fight" or "n a rest" limit may have: a fight is 4 to 8 rounds, so 10 is "every turn"
      prices: whole(2, 0, 6, 'extra costs on one ability: each is a line of its card'), // extra costs on one ability: HP and a stack (Truth in Pain), or a stack and a zone (Soul Shatter)
      gates: whole(3, 0, 6, 'conditions on one ability: each is a line of its card'), // conditions on one ability: a mode, stacks on the target and a use limit (Spirit Shackle)
      hpShare: real(0.5, 0.01, 0.9, 'the largest HP price as a share: at 1 one use is a whole life'), // an HP price of at most half the max HP: past that one use is most of a life, and a heal must pay it back
      hpShareMin: real(0.01, 0, 0.5, 'the smallest HP price as a share: 0.5 leaves no room under the largest'), // the smallest HP price as a share: 1%, under which a price is a rounding error
      hpFlat: whole(999, 1, 9999, 'the bound of every flat number the parsers read: four digits'), // the bound of every flat number the parsers read (SKILL_BOUNDS.bonus)
      tags: whole(3, 0, 10, 'tags on one ability: each is a word on its card'), // tags on one ability: Hwei's painting type and "ultimate" are two
      tagLength: whole(20, 1, 60, 'letters in a tag: 60 is a line on a phone'), // a tag is a word the GM types: "disaster", "ultimate", "sword"
      zonesPerOwner: whole(3, 1, 10, 'zones one body holds: the reducer walks them every move'), // zones one body holds at once: Einar starts at 3 boundaries; a fourth replaces the oldest
      zoneAge: whole(1, 0, 10, 'rounds a zone stands before its end pays: 10 is past any fight'), // rounds a zone must stand before ending it pays its end: placing and popping in one turn would be a free blast
      summons: whole(2, 0, 6, 'timed summons one body holds: each is a row of the order of turns'), // timed summons one body holds at once: two sprites; past that the order of turns is the summoner's alone
      summonRounds: whole(5, 1, 20, 'the longest a summon stays: 20 is past any fight'), // the longest a summon stays: a fight is 4 to 8 rounds, and a summon for the whole fight is a hunter
      fieldStacks: whole(60, 1, 300, 'stacks `field(key)` reads: fifteen bodies at the largest cap of 20'), // `field(key)` reads at most this: three bodies at the cap of 20
      kills: whole(10, 1, 100, 'kills `kills` reads: 100 is past any fight'), // `kills` reads at most this: a pack is 3 to 6, a long fight 10
      held: whole(10, 1, 100, 'rounds `held(key)` reads: 100 is past any fight'), // `held(key)` reads at most this many rounds: past a long fight
      hits: whole(16, 1, 100, 'bodies `hits` reads: 100 is past any crowd'), // `hits` reads at most this many bodies: every zone's worth of a crowd
      // Wave 2 (kits design 8.1 to 8.7, kits-paper `KIT2`, table 8.1). Each bounds one block; the reason is beside it.
      shareCap: real(0.5, 0, 0.9, 'how far a dealt or taken share moves from 1: at 1 a share of 0 makes a body immune'), // a use's dealt times taken share stays in 0.5 to 1.5: Brutalize's -50% healing is the sheet's largest share
      armorOp: of(60, KIT_GUARD), // a status moves armor or resist by at most a suit of plate's 60 (`kits.heavy`)
      critFacesMax: whole(6, 0, 10, 'crit faces with a target\'s exposed ones: past 10 half of every use is a crit'), // crit faces plus a target's exposed faces stay at most 6: design 2.2's 30%, never the 1 in 3
      critSizeMax: real(2, 1, 5, 'the largest crit size: under 1 a crit hurts less than a hit'), // crit size stays at most 2: design 2.2's "never more than double the dice"
      // A cost cut stays at `costCutCap`'s 0.25: mana is the dungeon's brake on blasts (design 6). The paper's separate
      // fatigue cut of 0.5 needs a second sheet number; one cut on both is the stricter reading (notes-build-3.md).
      costCutMax: real(0.25, 0, 0.9, 'the most a status cuts a cost: at 1 every use is free'),
      rangeAdd: whole(3, 0, 20, 'tiles a status adds to a range: 20 is half the largest map'), // tiles a status adds to its bearer's ranges of 2 or more: a curse's 8 to 11, still under a shot's 12
      wardRounds: whole(1, 0, 10, 'rounds a ward lasts: 10 is past any fight'), // untargetable, invulnerable and safeguard last a round at most, and the first two reach a body once a fight
      boostSides: whole(20, 2, 100, 'sides of a held die: a d100 is the largest a sheet names'), // a held die is at most a d20 (Expected Outcome)
      shoveMax: whole(3, 0, 40, 'tiles one push moves a body: 40 is the largest map\'s side'), // tiles one push or pull moves a body: half a round's walk at move 6
      blinkMax: of(8, RANGE), // the longest blink: a curse's range, the gap between the default lines
      reactionsPerUse: whole(4, 0, 20, 'reactions one use sets off: the bound of the loop that fires them'), // reactions one use may set off: four targets of an area, one each
      // Parry's guard, the share a `before` reaction takes off a strike (kits table 8.10.3): the largest in steps of 0.05
      // with which no build armed with it all fight improves a duel against a striker by more than the tolerance. The
      // sheet's Parry (0.25 or 0.75 by a roll) takes about 0.5 off and lifts the speed build over the tank by 1.30 to 1.40.
      // The paper's 0.35 is the simulation's 0.30: at 0.35 the speed build armed with it beat the tank 0.08 more often at C
      // and 0.17 at S (a duel is a race, and 0.35 takes a tank's swing under a hit the speed build lives through); at
      // 0.30 it is -0.03 and -0.01, at 0.25 -0.08 and -0.13, since its quick action's time is real (sim-log.md).
      parry: of(0.3, SHARE),
      zoneMove: of(6, RANGE), // tiles one use moves a zone: a round's walk
      zoneGrow: of(2, RADIUS), // tiles of radius one use adds to a zone, to `fieldRadiusMax`
      extraPerRound: whole(1, 0, 4, 'extra actions a body takes a round: past 4 the fastest build is the fight'), // extra actions (a refund to now) one body takes in a round of fight time: the fastest build stays under 4 turns to the tank's 1
      surprise: whole(1, 0, 5, 'rounds a surprised side waits: 5 is most of a fight'), // rounds a surprised side's openings are pushed back
      doArmed: whole(12, 0, 24, 'party rows the room doc names as armed: 24 keeps the doc in its cap'), // party rows whose armed reaction the room doc names: 4 hunters, 4 shadows, 4 summons
      // The maker warns past 1.08 times a pace's budget (design 3): the triangle's closest margin on paper is the cannon over
      // the tank at C, 1.081 (kits-paper table 3.1), so a made thing that adds more can flip that row by itself.
      tolerance: of(0.08, SHARE),
      referenceRounds: whole(6, 1, 20, 'rounds of the reference fight: 0 divides by 0, 20 is past any fight'), // a status that lasts until removed is weighed over design 6's reference fight of 6 rounds
      // The share of a delayed end a cure takes each round it waits (worth.ts `delayedShare`): no built-in monster cures or
      // dispels, and the simulation's foes never do, so the bar counts none; a GM whose foes cleanse raises it.
      cleanse: of(0, SHARE),
      // A trigger is worth its ops times its event's rate a round (design 3, kits-paper table 3.3), read off a C bruiser
      // against one same-rank brute: 1 hit dealt, struck once, 0.05 crits, 0.35 kills a round. Where the table has no row
      // the rate is an upper bound, so the maker warns early rather than late: a turn's start and end, a move, a status
      // gained or ended and an ability used once a turn (1); an avoid as often as a curse is resisted at parity (0.45).
      eventRates: {
        hitDealt: of(1, EVENT_RATE), struck: of(1, EVENT_RATE), critDealt: of(0.05, EVENT_RATE), critTaken: of(0.05, EVENT_RATE), kill: of(0.35, EVENT_RATE),
        avoided: of(0.45, EVENT_RATE), turnStart: of(1, EVENT_RATE), turnEnd: of(1, EVENT_RATE), moved: of(1, EVENT_RATE),
        down: of(0.17, EVENT_RATE), // a body goes down once a fight: of design 6's reference fight of 6 rounds, a round's share
        statusGained: of(1, EVENT_RATE), statusEnded: of(1, EVENT_RATE), used: of(1, EVENT_RATE),
      },
      // The conditional scalers that replace the execute (design 8.0): the owner, Nov 14, "execute just does more dmg the lower
      // health people are". A scaler's bonus is 0 at its start and its scale at its end, linear between.
      scalers: whole(2, 0, 4, 'scalers on one formula: past 4 nobody reads it at a glance'), // scalers on one formula: an execute and one counterpart; a third is a formula nobody reads at a glance
      scaleCap: real(1, 0.05, 5, 'the most a scaler adds: 5 is six times the damage'), // the most a scaler adds: double the damage, a crit's largest size (critSizeBase + critSizeCap)
      scalerStart: of(0.5, SHARE), // where a suggested scaler activates: half of an HP share, or two equal bodies of a pair
      scalerStep: real(0.05, 0.01, 0.5, 'the search step of a suggested scale: 0 searches without end'), // the suggested scale is searched in steps of 5%, the precision a GM reads off a slider
      // A pair's bonus is whole at 4 to 1: past a same-rank boss over a paper build at C and E (2.8 to 4, kits-paper table
      // 8.0.1), so a giant slayer is near its whole against a boss and not past it.
      pairFull: real(4, 1.5, 20, 'the ratio at which a pair\'s bonus is whole: at 1 the bonus divides by 0'),
      // The reference dungeon a scaler's suggestion and worth are taken over (design 8.0): at E, C and S, the rounds the
      // party of design table 6.2 takes on paper to clear a pack of three normal brutes and a boss (kits-paper table 3.2),
      // and a same-rank normal brute's and boss's max HP over the user's (table 8.0.1): the bruiser in the medium kit, whose
      // kind is the strike, and the speed or cannon build in the light kit, whose kinds are the shot, the curse and the blast.
      reference: {
        E: { pack: of(3.14, REF_ROUNDS), boss: of(5.52, REF_ROUNDS), medium: { normal: of(0.604, REF_HP), boss: of(3.188, REF_HP) }, light: { normal: of(0.644, REF_HP), boss: of(3.4, REF_HP) } },
        C: { pack: of(3.2, REF_ROUNDS), boss: of(5.665, REF_ROUNDS), medium: { normal: of(0.604, REF_HP), boss: of(3.208, REF_HP) }, light: { normal: of(0.753, REF_HP), boss: of(4, REF_HP) } },
        S: { pack: of(3.8, REF_ROUNDS), boss: of(6.76, REF_ROUNDS), medium: { normal: of(0.599, REF_HP), boss: of(3.198, REF_HP) }, light: { normal: of(0.885, REF_HP), boss: of(4.724, REF_HP) } },
      },
      // The three example kits of design table 3.6 and 5.2, each a share of the ability it replaces in its plain build
      // (the cannon's Arc Bolt, the bruiser's strike), with the one lever the paper searched for each: the largest that
      // keeps the kit within the tolerance of its plain build over design 6's reference fight. The simulation plays them
      // (tests/fight-sim.test.ts, the kits' rows; docs/agent-handoff/rw/sim-log.md).
      examples: {
        // Glas: Bloodletting adds a Resonance; three burst for 1.6 bolts, cut to 0.8 for the execute (8.0). Its share is
        // 0.85, not the paper's 0.7: a duel and a pack fight are races, and the damage of a burst that never comes is lost.
        // At 0.7 the kit won 0.20 fewer duels than the plain cannon against a C tank; at 0.8 the S party with it took 5.02
        // rounds on a pack (bound 5); at 0.85 every row holds (duels within 0.06, the S pack 4.93); at 0.9 the C tank duel
        // is 0.083 over (sim-log.md, the kits' rows).
        blood: { share: of(0.85, TIER_SHARE), burst: of(1.6, BURST), base: of(0.8, BURST) },
        // Hwei: Disaster Stroke at 0.75 adds a mark; two burst for 0.82 bolts on every foe within 2
        mark: { share: of(0.75, TIER_SHARE), burst: of(0.82, BURST) },
        // Einar: Violence spends all Pain, 6% more a Pain, used at 5
        pain: { perStack: real(0.06, 0, 1, 'damage a Pain adds: 1 doubles it a stack'), spendAt: whole(5, 1, 20, 'Pain at which Violence is used: the stack cap of 20') },
        // Glas: Hemoplague, under Crimson Pact, ends 3 rounds later for 1.4 curses: design 3's number for it. No simulation
        // build plays the Pact yet (notes-worth.md); the bar weighs it at 0.50 SA at C, inside its budget with the Pact's
        // credit. It was 0.6 while worth.ts weighed a curse with no formula against a physical one.
        hemo: { end: of(1.4, BURST) },
      },
    },
  },
};

export const RULES = deepFreeze(valuesOf(SPEC));
/** Each rule number's domain by its dotted path (a list of numbers under the list's path). */
const DOMAINS: ReadonlyMap<string, Domain> = domainsOf(SPEC, '', new Map());
/** The domain of the rule number at dotted `path` (`fight.round`, a list's `rankTable.E.dc`, an open map's `gateSpawn.regulars.D`), or null when no rule number is there. */
export const domainOf = (path: string): Domain | null => DOMAINS.get(path) ?? OPEN_DOMAINS.find(o => o.re.test(path))?.domain ?? null;

/** The shipped rules, with every number and string widened: a GM override can change any of them. */
export type Rules = typeof RULES;
/** The reworked fight's numbers. */
export type FightRules = Rules['fight'];

export const TIERS = Object.keys(RULES.rarities);

// ── rulesOf(): RULES deep-merged with a save's rulesOverrides. Pure: the edge passes the overrides in. ──
/**
 * `base` with `ov` laid over it, object by object; a value that is not an object replaces the one under it. The overrides
 * are what `parseOverrides` (overrides.ts) kept: each value of the type of the rule it replaces, read against `RULES`,
 * each list and each entry of an open map by the reader of its rule. So the answer has `base`'s type, which the one cast
 * at its end says: the compiler cannot follow a merge by key, and tests/overrides.test.ts holds that every rule a cast
 * could hide (a list, a null, an open map's entry) has a reader.
 */
function merge<T extends Record<string, unknown>>(base: T, ov: Readonly<Record<string, unknown>>): T {
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(ov)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const under = out[k], over = ov[k];
    out[k] = isObj(over) && isObj(under) ? merge(under, over) : over;
  }
  return out as T;
}
/**
 * The shipped rules with a save's `rulesOverrides` merged in, and the GM's statuses (`library.statuses`) over the
 * built-in `conditions`: an entry under a built-in key replaces that built-in whole, any other key adds a status.
 */
export function rulesOf(ov: unknown, statuses: Readonly<Record<string, StatusDef>> = {}): Rules {
  return withStatuses(isObj(ov) && Object.keys(ov).length ? merge<Rules>(RULES, ov) : RULES, statuses);
}
/**
 * Rules `R` with `statuses` laid over its `conditions`: an entry under a key `R` has replaces that status whole, any other
 * key adds one. The one way a status of the GM's reaches the rules (the save's library here, a room's solo doc in solo.ts).
 */
export const withStatuses = (R: Rules, statuses: Readonly<Record<string, StatusDef>>): Rules =>
  Object.keys(statuses).length ? { ...R, conditions: { ...R.conditions, ...statuses } } : R;

// ── helpers. Each takes the rules as its first argument; src/edge/rules.ts binds them to the current rules for views. ──
/** XP from `level` to the next: `xpPerLevel` times the level. `level` is a level (hunter/level.ts), so no bound is kept here. */
export const xpToNext = (R: Rules, level: number): number => R.xpPerLevel * level;
/**
 * One Clear of `rank`: the middle of its loot gold, what one hunter takes from clearing a world gate of that rank in the
 * party it is made for. The anchor of every price (economy design 0): an item costs a count of Clears.
 */
export const clearOf = (R: Pick<Rules, 'loot'>, rank: Rank): number => (R.loot[rank].gold[0]! + R.loot[rank].gold[1]!) / 2;
/**
 * Every job a reward may name: the rules' `jobs`, then each of the `extractJobs` they do not hold (a Shadow Monarch is
 * reached, never picked at the start).
 */
export const rewardJobs = (R: Pick<Rules, 'jobs' | 'extractJobs'>): string[] => [...new Set([...R.jobs, ...R.extractJobs])];
/** Whether a hunter of this job may extract shadows: the job is one of the rules' `extractJobs`. */
export const canExtract = (R: Pick<Rules, 'extractJobs'>, job: string | null): boolean => job !== null && (R.extractJobs as readonly string[]).includes(job);
export const rankIdx = (rank: unknown): number => Math.max(0, (RANKS as readonly unknown[]).indexOf(rank));
export function rankForLevel(R: Rules, level: number): Rank {
  const rl = R.rankLevels; let r: Rank = 'E';
  for (const k of RANKS) if (level >= rl[k]) r = k;
  return r;
}

// ── build paths (pure; also used by the save repair in save.ts on raw data, so every lookup tolerates junk) ──
/**
 * The keys of every bonus (balance plan section 10): what a perk, a title, a passive skill, a worn item or the GM's grant
 * may add. The eight stats add before their curves; every other key is the sheet number of that name (derive.ts), added
 * after its stat's curve cap and never past its sheet clamp. Three sheet numbers are left out: `weight`, `armor` and
 * `resist` are a worn piece's own fields (what its weight buys), so each has one route; `sight` takes the higher, not
 * the sum; `stride` and `shadows` no stat of an item names.
 */
// No `phys`, `mag` or `sup`: the owner (Nov 21), "Idk about attack and ability power. I think that's hard to do." A bonus raises power through Strength, Power and Presence.
export const BONUS_KEYS = [...STAT_KEYS, 'hpMax', 'manaMax', 'fatigueMax', 'carry', 'speed', 'move',
  'armorPen', 'resistPen', 'armorPenFlat', 'resistPenFlat', 'react', 'aim', 'will', 'critFaces', 'critSize', 'opening',
  'tenacity', 'potency', 'threat', 'hold', 'costCut', 'drain', 'haste'] as const satisfies readonly (StatKey | SheetNumber)[];
export type BonusKey = (typeof BONUS_KEYS)[number];
/**
 * The bonus keys whose sheet number is a share or a multiplier (crit size 1.5 to 2, the threat multiplier, the channel's
 * hold, the cost cut, lifesteal): a bonus is a whole number, so a point of one of these is a hundredth of the number
 * (derive.ts). Ability haste is whole points, as in League of Legends, so it is not one of them.
 */
export const BONUS_HUNDREDTHS: readonly BonusKey[] = ['critSize', 'threat', 'hold', 'costCut', 'drain'];
export type Perk = Partial<Record<BonusKey, number>>;
export type Path = { name: string; alloc: Partial<Record<StatKey, number>>; tiers: Perk[][] };
/**
 * The short words for each bonus key, read after a signed number ("+5 Lethality"). A screen that says "Max HP"
 * overrides hpMax and manaMax itself. A key read in hundredths says so with its %.
 */
export const BONUS_LABELS: Readonly<Record<BonusKey, string>> = {
  ...STAT_SHORT, hpMax: 'HP', manaMax: 'Mana', fatigueMax: 'Fatigue capacity', carry: 'Carry', speed: 'Speed', move: 'Move',
  armorPen: '% Armor penetration', resistPen: '% Magic penetration',
  armorPenFlat: 'Lethality', resistPenFlat: 'Unravel', react: 'Reaction', aim: 'Accuracy', will: 'Will', critFaces: 'Crit faces',
  critSize: '% Crit size', opening: 'Opening', tenacity: 'Tenacity', potency: 'Potency', threat: '% Threat', hold: '% Channel hold', costCut: '% Cost cut',
  drain: '% Lifesteal', haste: 'Ability haste',
};
export const pathOf = (R: Rules, id: unknown): Path | null => {
  const paths = (R.paths || {}) as Record<string, unknown>;
  return typeof id === 'string' && Object.hasOwn(paths, id) && isObj(paths[id]) ? paths[id] as Path : null;
};
export const perkOf = (p: Path | null, tier: number, pick: number): Perk => {
  const t: unknown = p && Array.isArray(p.tiers) && Array.isArray(p.tiers[tier]) ? p.tiers[tier] : [];
  const perk = (t as unknown[])[pick];
  return isObj(perk) ? perk as Perk : {};
};
export const tiersOpen = (p: Path | null, rank: unknown): number => Math.min(p && Array.isArray(p.tiers) ? p.tiers.length : 0, rankIdx(rank) + 1);
/** Summed bonus of the picks that the hunter's rank has unlocked; picks beyond the rank are kept but inactive. */
export function pathBonus(R: Rules, build: { path?: unknown; picks?: unknown } | null | undefined, rank: unknown): { p: Path | null; out: Perk; n: number } {
  const p = pathOf(R, build && build.path), out: Perk = {};
  if (!build || !p || !Array.isArray(build.picks)) return { p, out, n: 0 };
  const n = Math.min(build.picks.length, tiersOpen(p, rank));
  for (let i = 0; i < n; i++) {
    const b = perkOf(p, i, build.picks[i] as number);
    for (const k of BONUS_KEYS) { const v = b[k]; if (Number.isFinite(v) && v) out[k] = (out[k] || 0) + Math.trunc(v as number); }
  }
  return { p, out, n };
}

// ── cosmetic registries (not game rules, so not in RULES / rulesOverrides). The emblems are icons: src/core/registry/icons.ts ──
export const HUNTER_COLORS = ['#4dd8ff', '#59e6a8', '#ffc94d', '#ff6b3d', '#ff4d5e', '#c79bff', '#4d8cff', '#ff7ad9', '#dff3ff', '#9fb6c9'];
// device accent presets: the colors live once in app.css ([data-accent=…], read before first paint too); 'hunter' follows the active hunter's color
export const ACCENTS = ['cyan', 'violet', 'gold', 'emerald', 'crimson', 'hunter'];
export const TEXT_SCALES = [1, 1.15, 1.3];

// ── the GM's edits of the overrides (gm.js): the rule numbers, and the GM's roll tables kept beside them in `gmTables` ──
type Overrides = Record<string, unknown>;
const recOf = (v: unknown): Overrides => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Overrides) : {});
/** The rule numbers the GM saved (`parsed`, read by `parseOverrides`), with the GM's roll tables kept. */
export function saveRuleNumbers(ov: Overrides, parsed: Overrides): Overrides {
  return 'gmTables' in ov ? { ...parsed, gmTables: ov.gmTables } : { ...parsed };
}
/** The GM's switch for every feat (`feats.on`) set to `on`, the other overrides kept: the GM view's control beside the rules editor. */
export const featsSwitched = (ov: Overrides, on: boolean): Overrides => ({ ...ov, feats: { ...recOf(ov.feats), on } });
/** Every rule number back to its default; the GM's roll tables are kept. */
export const resetRuleNumbers = (ov: Overrides): Overrides => ('gmTables' in ov ? { gmTables: ov.gmTables } : {});
/**
 * A roll table's lines as the GM wrote them: the gate names are the rule `gateNames`; the encounter table is one list
 * per rank; any other table one list, all in `gmTables`.
 */
export function writeTable(ov: Overrides, table: string, rank: string, lines: readonly string[]): Overrides {
  if (table === 'gate') return { ...ov, gateNames: [...lines] };
  const tabs = recOf(ov.gmTables);
  if (table === 'encounter') return { ...ov, gmTables: { ...tabs, encounter: { ...recOf(tabs.encounter), [rank]: [...lines] } } };
  return { ...ov, gmTables: { ...tabs, [table]: [...lines] } };
}
/** A roll table back to its built-in lines (for the encounter table, that rank's list only). */
export function resetTable(ov: Overrides, table: string, rank: string): Overrides {
  if (table === 'gate') { const { gateNames: _gone, ...rest } = ov; return rest; }
  if (!('gmTables' in ov) || recOf(ov.gmTables) !== ov.gmTables) return ov;
  const tabs = recOf(ov.gmTables);
  if (table === 'encounter' && 'encounter' in tabs && recOf(tabs.encounter) === tabs.encounter) {
    const { [rank]: _gone, ...left } = recOf(tabs.encounter);
    return { ...ov, gmTables: { ...tabs, encounter: left } };
  }
  const { [table]: _gone, ...left } = tabs;
  return { ...ov, gmTables: left };
}
