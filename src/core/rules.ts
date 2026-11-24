// rules.ts: every number from PROGRAM §D lives here, each with its domain beside it (the least and the most a GM's
// override may set, whole or not, and why; overrides.ts refuses a number out of it). GM overrides (a save's
// rulesOverrides) are deep-merged by rulesOf(), and the GM's statuses (a save's library.statuses) are laid over the
// built-in ones.
import { BUILT_IN_STATUSES } from './registry/statuses.ts';
import { BUILT_IN_PATHS } from './registry/paths.ts';
import { STAT_KEYS, STAT_SHORT } from './stats.ts';
import { GRID_SIDE } from './combat/space.ts';
import { LEVELS } from './combat/sight-levels.ts';
import { MAX_LEVEL, MIN_LEVEL } from './hunter/level.ts';
import type { StatKey } from './stats.ts';
import type { StatusDef } from './combat/effect-ops.ts';
import type { SheetNumber } from './hunter/derive.ts';
import type { Rewards } from './rewards.ts';
import type { Pace } from './combat/timeline.ts';

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
/** A rarity of RULES.rarities: its color and the rank whose base price prices it (`priceBaseOf`). */
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
const LEVEL = wholeIn(MIN_LEVEL, MAX_LEVEL, 'the allowed range for hunter levels');
const CHECK_BONUS = wholeIn(0, 30, 'bonus added to a d20 check. Above 30, the die roll no longer matters');
const DC = wholeIn(1, 100, 'DC for a d20 check. The hardest S-rank DC is 55, and nothing can reach past 100');
const MONSTER_XP = wholeIn(0, 1_000_000, 'XP a monster gives. One million is roughly one level-up at the max level');
const BREAK_DAYS = wholeIn(1, 365, 'days a gate stays open before dungeon break. Under 1 day it breaks immediately, and 365 is one full year');
const GOLD = wholeIn(0, 1_000_000_000, 'gold amount. One billion is the maximum for rewards and monster loot');
const REVIVE_DEBT_PRICE = wholeIn(1, 1000, 'debt for a System revive in multiples of priceBase, from 1 to 1000');
const WEIGHT = wholeIn(0, 1000, 'relative chance weight in this table. 0 means never chosen, and 1000 is the maximum');
const SUMMON_MANA = wholeIn(0, 1000, 'mana cost to summon. High values can make a summon unpayable');
const PACK = wholeIn(1, 26, 'number of monsters in a spawned pack. Must be at least 1 and at most 26');
const SHARE_OF_SPAWNS = wholeIn(0, 100, 'percentage chance for personal gate spawns');
const COST = wholeIn(10, 1000, 'action time in hundredths of a standard action. Under 10 causes rapid endless turns, and above 1000 makes one turn last ten actions');
const STAT_CAP = wholeIn(0, 1000, 'maximum bonus from this stat curve. 0 disables this stat bonus');
const SHARE = realIn(0, 1, 'fraction between 0 (none) and 1 (all)');
const GUILD_GOLD_CUT = realIn(0, 0.9, 'share of System clear gold collected by a guild, from 0 to 0.9');
const KIT_WEIGHT = wholeIn(0, 200, 'armor kit weight. 200 is four times the maximum base carry capacity');
const KIT_GUARD = wholeIn(0, 1000, 'armor or magic resist for this kit. At 1000, attacks still deal about a tenth of their damage');
const KIND_FACTOR = realIn(0.1, 20, 'multiplier on monster HP or power. Under 0.1 makes it negligible, and above 20 makes it unbeatable');
const KIND_GUARD = realIn(0.1, 20, 'multiplier on monster armor or magic resist. Under 0.1 removes defense, and 20 blocks over 90% of damage');
const KIND_STAGGER = realIn(0, 20, 'stagger bar size in standard hits at that rank. 0 disables stagger, and above 20 it is almost impossible to fill');
const TRAIT_SPEED = wholeIn(-90, 200, 'percentage speed change from a trait. -90 slows nearly to a halt and 200 triples speed, within the speed limits');
const KIND_XP = realIn(0, 100, 'multiplier on rank XP. 0 gives no XP, and 100 gives a full gate of XP per monster');
const WINDUP = wholeIn(0, 10_000, 'wind-up time in ticks before an ability lands. 0 is instant, and 10,000 is ten full rounds');
const RANGE = wholeIn(0, 40, 'ability range in tiles. 0 is the user\'s own tile, and 40 is the largest map width');
const RADIUS = wholeIn(0, 20, 'area radius in tiles. 20 covers the entire largest map from the center');
const USE_FATIGUE = wholeIn(0, 100, 'fatigue cost per use. 100 is a full base fatigue bar');
const USE_MANA = wholeIn(0, 1000, 'mana cost per use. Very high values make the ability unpayable');
const COOLDOWN = wholeIn(0, 10_000, 'cooldown in ticks before an ability is ready again. 10,000 is ten full rounds');
const EVENT_RATE = realIn(0, 10, 'expected times this event happens per round, up to 10');
const REF_ROUNDS = realIn(0.5, 50, 'expected rounds for the reference party. Most fights take 4 to 8 rounds, up to 50');
const REF_HP = realIn(0.05, 20, 'ratio of monster max HP to user max HP, up to 20');
const TIER_SHARE = realIn(0, 2, 'damage share compared to the base ability it replaces, up to 2');
const BURST = realIn(0, 10, 'burst strength measured in standard spells, up to 10');
const KEYSTONE_SPEND = realIn(0, 30, 'bonus-point budget for one keystone. 0 gives no bonus, and 30 equals ten full levels of ability points');
const TITLE_SPEND = realIn(0, 30, 'bonus-point budget for a title of this rank. 0 flags every bonus as over budget, and 30 equals ten levels of ability points');
const DIFFICULTY_LEVEL = wholeIn(1, 10, 'gate or boss difficulty level, 1 to 10');
const DIFFICULTY_WIN_PCT = wholeIn(1, 99, 'expected three-hunter win chance in percent for one difficulty step');
const DIFFICULTY_FACTOR = realIn(0.1, 20, 'combined HP-times-damage difficulty multiplier for one step or rank');
const DIFFICULTY_SPLIT = realIn(0, 1, 'share of the difficulty multiplier applied to max HP. The rest applies to damage dealt');
/** The points a build path's main and second stat take of each level's points (registry/paths.ts `alloc`). */
export const PATH_ALLOC = wholeIn(0, 10, 'auto-allocation weight for this stat per level. 0 puts no points here, up to 10');
/** A perk's points on a bonus key (a title's bonus, a path tier's perk): the bound of every flat bonus a parser reads. */
export const PERK_POINTS = wholeIn(-999, 999, 'flat stat or sheet bonus, between -999 and 999');
/** A daily objective's target. */
export const OBJECTIVE_TARGET = realIn(0.1, 100_000, 'target count for a daily quest objective. Must be above 0 and at most 100,000');

/** A rule number whose rule is an open map: each entry of the map has this domain. `*` stands for any one key. */
const OPEN_DOMAINS: ReadonlyArray<{ readonly re: RegExp; readonly domain: Domain }> = [
  { re: /^paths\.[^.]+\.alloc\.[^.]+$/, domain: PATH_ALLOC },
  { re: /^gateSpawn\.regulars\.[^.]+$/, domain: PACK },
];

/** What the daily quest gives besides its numbers, typed as a reward's parts so a GM's override of its items, skills or title is one (overrides.ts). */
const DAILY_REWARD_PARTS: Omit<Rewards, 'xp' | 'points' | 'gold' | 'crystal'> = { items: [], title: null, job: null, skills: [], statuses: [], boons: [] };

const SPEC = {
  xpPerLevel: whole(100, 1, 1_000_000, 'XP needed per level (multiplied by current level). At 0, a single XP point would reach max level'),
  pointsPerLevel: whole(3, 0, 20, 'ability points gained on each level-up, from 0 to 20'),
  streakBonusEvery: whole(7, 1, 365, 'daily streak days needed per bonus point. Must be at least 1'),
  levelUpRestore: true,
  rankLevels: { E: of(1, LEVEL), D: of(10, LEVEL), C: of(20, LEVEL), B: of(35, LEVEL), A: of(50, LEVEL), S: of(70, LEVEL) },
  rankBonus: { E: of(2, CHECK_BONUS), D: of(3, CHECK_BONUS), C: of(4, CHECK_BONUS), B: of(5, CHECK_BONUS), A: of(6, CHECK_BONUS), S: of(8, CHECK_BONUS) },
  rankColors: { E: '#9fb6c9', D: '#59e6a8', C: '#4dd8ff', B: '#4d8cff', A: '#c79bff', S: '#ffc94d' },
  // A check's DC (easy, medium, hard), a normal monster's XP and the days a gate of the rank stays open. A monster's HP,
  // armor and attacks come from `fight.kinds` and its archetype (src/core/hunter/derive.ts `monsterSheet`).
  rankTable: {
    E: { dc: each([10, 13, 16], DC), xp: of(63, MONSTER_XP), breakDays: of(7, BREAK_DAYS) },
    D: { dc: each([14, 17, 20], DC), xp: of(75, MONSTER_XP), breakDays: of(6, BREAK_DAYS) },
    C: { dc: each([20, 24, 28], DC), xp: of(250, MONSTER_XP), breakDays: of(5, BREAK_DAYS) },
    B: { dc: each([27, 31, 35], DC), xp: of(800, MONSTER_XP), breakDays: of(4, BREAK_DAYS) },
    A: { dc: each([35, 40, 45], DC), xp: of(2500, MONSTER_XP), breakDays: of(3, BREAK_DAYS) },
    S: { dc: each([45, 50, 55], DC), xp: of(8000, MONSTER_XP), breakDays: of(2, BREAK_DAYS) },
  },
  fatigue: {
    penaltyAt: whole(50, 0, 1000, 'fatigue level where check penalties start. Values above max fatigue disable the penalty'),
    penalty: whole(2, 0, 20, 'penalty subtracted from checks when tired, from 0 to 20'),
    disAt: whole(80, 0, 1000, 'fatigue level where checks roll with disadvantage. Values above max fatigue disable it'),
    collapseAt: whole(100, 0, 1000, 'fatigue level where a hunter becomes exhausted. Values above max fatigue disable it'),
  },
  // A rest (the owner, Nov 22: "rests will give 25% of mana back, and 25% health back. exhausted will largely clear. They
  // should get 2x per dungeon"): `hp` and `mana` the share of the maximum given back, `fatigue` the share of the fatigue
  // held taken off ("largely" is the owner's word, 0.75 the lead's number: a rest from full fatigue leaves a quarter, under
  // the collapse share, so Exhausted lifts), `perGate` the rests a hunter has in a gate, counted again from 0 when a gate
  // ends for it (src/core/hunter/rests.ts). A Clear gives everything back (vitals.ts `cleared`).
  rest: {
    hp: of(0.25, SHARE), mana: of(0.25, SHARE), fatigue: of(0.75, SHARE),
    perGate: whole(2, 0, 10, 'rests allowed per gate. 0 disables resting, up to 10'),
  },
  penaltyCheck: whole(2, 0, 20, 'penalty subtracted from checks while Penalized, from 0 to 20'),
  dailyTemplate: {
    title: 'Strength Training', desc: 'Finish the daily training before the day resets.',
    objectives: [
      { label: 'Push-ups', target: 100, progress: 0 }, { label: 'Sit-ups', target: 100, progress: 0 },
      { label: 'Squats', target: 100, progress: 0 }, { label: 'Running (km)', target: 10, progress: 0 },
    ],
    // What the daily quest gives, typed as a reward so a GM's override of its items, skills or title is one (overrides.ts).
    rewards: {
      xp: whole(25, 0, 1_000_000, 'XP rewarded for completing the daily quest, up to 1,000,000'),
      points: whole(1, 0, 20, 'ability points rewarded for completing the daily quest, from 0 to 20'),
      gold: of(0, GOLD),
      crystal: of(0, GOLD),
      ...DAILY_REWARD_PARTS,
    },
  },
  jobs: ['Fighter', 'Assassin', 'Mage', 'Tanker', 'Healer', 'Ranger', 'Necromancer'],
  extractJobs: ['Necromancer', 'Shadow Monarch'],
  // Each rule title has a key a granted title records (`Title.seedKey`), so a rename keeps it and a GM title of the same
  // name is another. Its band is the rank whose `titleBudget` it fits (item-stats 6.7): +2 on a stat spends 2, a rank D
  // title's budget, and the GM-only +5 an S title's. The One Who Overcame Adversity was +20 max HP: 33 points at E and
  // still 8 at S (item-budget.ts `BONUS_COST`, a Vitality point gives 0.6 max HP at E and 2.5 at S), past every band, so
  // it is +2 Vitality, as its three neighbours are +2 on a stat.
  titles: [
    { key: 'wolf-slayer', name: 'Wolf Slayer', desc: 'Killed the leader of a wolf pack.', bonus: { str: 2 }, band: 'D' as Rank },
    { key: 'overcame-adversity', name: 'One Who Overcame Adversity', desc: 'Survived a fight you were expected to lose.', bonus: { vit: 2 }, band: 'D' as Rank },
    { key: 'demon-hunter', name: 'Demon Hunter', desc: 'Defeated a demon in a low-rank gate.', bonus: { pre: 2 }, band: 'D' as Rank },
    { key: 'hunts-alone', name: 'The One Who Hunts Alone', desc: 'Cleared a gate without a party.', bonus: { agi: 2 }, band: 'D' as Rank },
    { key: 'king-of-shadows', name: 'King of Shadows', desc: 'Leads a shadow army.', bonus: { pow: 5 }, band: 'S' as Rank, gmOnly: true },
  ],
  conditions: BUILT_IN_STATUSES, // the built-in statuses: src/core/registry/statuses.ts
  // Each rarity's color and the rank whose base price prices it (`priceBaseOf`): a price is computed from
  // `priceBase`, never stored, so a GM's edit of `priceBase` moves prices without tying them to gate clear gold.
  rarities: {
    common: rarity('#9fb6c9', 'E'), uncommon: rarity('#59e6a8', 'D'), rare: rarity('#4dd8ff', 'C'),
    epic: rarity('#c79bff', 'B'), legendary: rarity('#ffc94d', 'A'), mythic: rarity('#ff6b3d', 'S'),
  },
  slots: ['weapon', 'offhand', 'head', 'chest', 'hands', 'legs', 'feet', 'neck', 'ring1', 'ring2'],
  // Frozen base item price by rank (today's pre-table-B clear midpoints). Item prices, Resurrection Crystals,
  // System revive debt, and shop borrow limits read this table so raising gate clear gold does not raise prices.
  priceBase: {
    E: of(100, GOLD), D: of(325, GOLD), C: of(1250, GOLD), B: of(5000, GOLD), A: of(19000, GOLD), S: of(75000, GOLD),
  },
  // gold: a world-gate clear gold range low to high (overrides.ts reads its order). Gold table B (2.25x at E to 3.33x at S).
  loot: {
    E: { gold: each([100, 350], GOLD), weights: { common: of(70, WEIGHT), uncommon: of(25, WEIGHT), rare: of(5, WEIGHT) } },
    D: { gold: each([350, 1150], GOLD), weights: { common: of(50, WEIGHT), uncommon: of(35, WEIGHT), rare: of(13, WEIGHT), epic: of(2, WEIGHT) } },
    C: { gold: each([1200, 4800], GOLD), weights: { common: of(30, WEIGHT), uncommon: of(40, WEIGHT), rare: of(25, WEIGHT), epic: of(5, WEIGHT) } },
    B: { gold: each([5500, 22500], GOLD), weights: { uncommon: of(30, WEIGHT), rare: of(45, WEIGHT), epic: of(22, WEIGHT), legendary: of(3, WEIGHT) } },
    A: { gold: each([25000, 95000], GOLD), weights: { rare: of(40, WEIGHT), epic: of(45, WEIGHT), legendary: of(14, WEIGHT), mythic: of(1, WEIGHT) } },
    S: { gold: each([100000, 400000], GOLD), weights: { epic: of(50, WEIGHT), legendary: of(42, WEIGHT), mythic: of(8, WEIGHT) } },
  },
  // The economy: item prices, crystals, revive debt, and borrow limits multiply `priceBase`; a world gate's gold and XP are a pot shared by the hunters paid.
  gradeStep: real(1.5, 1, 1.8, 'price multiplier between item grades in the same tier. At 1 all grades cost the same, and above 1.8 a top grade would cost more than the next tier'), // design 2.1: three grades make a tier, a factor of 3.25 to 4, so one grade is about its cube root
  saleShare: of(0.25, SHARE), // design 3: the Association buys an item back at a quarter of its price (the owner: "A quarter.")
  usedUpShare: of(0.35, SHARE), // crystal-economy.md section 1 (the owner, Nov 23): rank-capped combat staples cost 35% of priceBase
  elixirPrices: real(1, 0, 100, 'price of a full-heal consumable in multiples of priceBase, from 0 to 100'), // crystal-economy.md section 1 (the owner, Nov 23): rank-capped Elixir of Life costs 1.0x priceBase
  revivePrices: whole(10, 1, 1000, 'price of a Resurrection Crystal in multiples of priceBase, from 1 to 1000'), // design 5: a full set of its rank's middle gear
  // the owner (Nov 23, qd row 72): System revive debt pays off in about 5 gate clears for a party of 4 under gold table B
  // and the 50/25/25 split. Per-rank multiples of priceBase, calibrated to gold table B's 2.25x (E) to 3.33x (S) clear-gold
  // taper (E 500 to S 525,000 gold; mean 4.71 to 4.98 clears, median 5 at every rank). If you override RULES.loot away
  // from gold table B, adjust reviveDebtPrices to match.
  reviveDebtPrices: {
    E: of(5, REVIVE_DEBT_PRICE), D: of(5, REVIVE_DEBT_PRICE), C: of(5, REVIVE_DEBT_PRICE),
    B: of(6, REVIVE_DEBT_PRICE), A: of(7, REVIVE_DEBT_PRICE), S: of(7, REVIVE_DEBT_PRICE),
  },
  // the owner (Nov 23), qd row 72: while in System revive debt, gate clear gold splits three ways (share to debt, burn lost
  // to debt costs, the rest to the hunter), and earned XP from every source is multiplied by reviveDebtXpRate until debt hits 0.
  reviveDebtShare: of(0.5, SHARE),
  reviveDebtBurn: of(0.25, SHARE),
  reviveDebtXpRate: of(0.25, SHARE),
  // the owner (Nov 23), cap A (qd row 73): shop borrowing limit in multiples of priceBase (1.5 matches one plus-grade
  // own-rank item). 0 turns shop borrowing off.
  borrowCapPrices: real(1.5, 0, 5, 'maximum shop borrowing debt in multiples of priceBase. 0 turns borrowing off, up to 5'),
  reviveLevelShare: of(1 / 30, SHARE), // design 4.4, ruling 9: a raising takes this share of the level, rounded up, never below level 1 ("maybe 3.33% of your total level")
  gateParty: whole(4, 1, 12, 'number of hunters a world gate payout is balanced for, from 1 to 12'), // design 4.1: the session model's party; its gold and XP are a pot of this many shares
  // Mana crystal economy (unit 3, the owner Nov 23): 1 mana crystal = 1 gold at Bureau assay. World gate pool is
  // poolBase * priceBase (4x), multiplied by specialMult (1.5x) for Red and Double gates; unsigned parties keep
  // unsignedShare (12% salvage). Personal gates drop personalShare * priceBase (10%) to the solo hunter.
  crystal: {
    poolBase: real(4, 0, 20, 'world gate mana crystal pool in multiples of priceBase, from 0 to 20'),
    specialMult: real(1.5, 1, 5, 'Red and Double gate mana crystal pool multiplier, from 1 to 5'),
    unsignedShare: of(0.12, SHARE),
    personalShare: of(0.1, SHARE),
    rates: {
      helix: of(0.9, SHARE),
      bureau: of(0.85, SHARE),
      stair: of(0.7, SHARE),
    },
  },
  // Guild contracts (unit 4, economy balance arena Finding 5): anchored at baseGoldCut 0.25 (Ironwake E Rookie).
  // Each archetype stores System clear gold cuts by Standing x Rank (Ninth Hour has Core and Ace only, no Rookie row)
  // and flat party crystal shares by Standing matching crystal-economy.md sections 4.2 and 4.4. Retainers, signing
  // bonuses, and vault Resurrection Crystal cover stay GM-run at the table.
  guilds: {
    baseGoldCut: of(0.25, GUILD_GOLD_CUT),
    archetypes: {
      ironwake: {
        goldCut: {
          rookie: { E: of(0.25, GUILD_GOLD_CUT), D: of(0.22, GUILD_GOLD_CUT), C: of(0.19, GUILD_GOLD_CUT), B: of(0.16, GUILD_GOLD_CUT), A: of(0.13, GUILD_GOLD_CUT), S: of(0.1, GUILD_GOLD_CUT) },
          core: { E: of(0.18, GUILD_GOLD_CUT), D: of(0.16, GUILD_GOLD_CUT), C: of(0.14, GUILD_GOLD_CUT), B: of(0.12, GUILD_GOLD_CUT), A: of(0.1, GUILD_GOLD_CUT), S: of(0.08, GUILD_GOLD_CUT) },
          ace: { E: of(0.11, GUILD_GOLD_CUT), D: of(0.09, GUILD_GOLD_CUT), C: of(0.08, GUILD_GOLD_CUT), B: of(0.07, GUILD_GOLD_CUT), A: of(0.06, GUILD_GOLD_CUT), S: of(0.05, GUILD_GOLD_CUT) },
        },
        crystalShare: {
          rookie: of(0.12, SHARE),
          core: of(0.18, SHARE),
          ace: of(0.25, SHARE),
        },
      },
      lantern: {
        goldCut: {
          rookie: { E: of(0.12, GUILD_GOLD_CUT), D: of(0.11, GUILD_GOLD_CUT), C: of(0.1, GUILD_GOLD_CUT), B: of(0.09, GUILD_GOLD_CUT), A: of(0.08, GUILD_GOLD_CUT), S: of(0.07, GUILD_GOLD_CUT) },
          core: { E: of(0.08, GUILD_GOLD_CUT), D: of(0.07, GUILD_GOLD_CUT), C: of(0.06, GUILD_GOLD_CUT), B: of(0.06, GUILD_GOLD_CUT), A: of(0.05, GUILD_GOLD_CUT), S: of(0.04, GUILD_GOLD_CUT) },
          ace: { E: of(0.05, GUILD_GOLD_CUT), D: of(0.04, GUILD_GOLD_CUT), C: of(0.04, GUILD_GOLD_CUT), B: of(0.03, GUILD_GOLD_CUT), A: of(0.03, GUILD_GOLD_CUT), S: of(0.02, GUILD_GOLD_CUT) },
        },
        crystalShare: {
          rookie: of(0.25, SHARE),
          core: of(0.3, SHARE),
          ace: of(0.35, SHARE),
        },
      },
      aurelian: {
        goldCut: {
          rookie: { E: of(0.28, GUILD_GOLD_CUT), D: of(0.25, GUILD_GOLD_CUT), C: of(0.22, GUILD_GOLD_CUT), B: of(0.18, GUILD_GOLD_CUT), A: of(0.14, GUILD_GOLD_CUT), S: of(0.1, GUILD_GOLD_CUT) },
          core: { E: of(0.2, GUILD_GOLD_CUT), D: of(0.17, GUILD_GOLD_CUT), C: of(0.15, GUILD_GOLD_CUT), B: of(0.12, GUILD_GOLD_CUT), A: of(0.1, GUILD_GOLD_CUT), S: of(0.08, GUILD_GOLD_CUT) },
          ace: { E: of(0.11, GUILD_GOLD_CUT), D: of(0.09, GUILD_GOLD_CUT), C: of(0.05, GUILD_GOLD_CUT), B: of(0.04, GUILD_GOLD_CUT), A: of(0.04, GUILD_GOLD_CUT), S: of(0.03, GUILD_GOLD_CUT) },
        },
        crystalShare: {
          rookie: of(0.1, SHARE),
          core: of(0.15, SHARE),
          ace: of(0.25, SHARE),
        },
      },
      'ninth-hour': {
        goldCut: {
          core: { E: of(0.2, GUILD_GOLD_CUT), D: of(0.18, GUILD_GOLD_CUT), C: of(0.16, GUILD_GOLD_CUT), B: of(0.14, GUILD_GOLD_CUT), A: of(0.11, GUILD_GOLD_CUT), S: of(0.08, GUILD_GOLD_CUT) },
          ace: { E: of(0.14, GUILD_GOLD_CUT), D: of(0.12, GUILD_GOLD_CUT), C: of(0.1, GUILD_GOLD_CUT), B: of(0.08, GUILD_GOLD_CUT), A: of(0.06, GUILD_GOLD_CUT), S: of(0.04, GUILD_GOLD_CUT) },
        },
        crystalShare: {
          core: of(0.2, SHARE),
          ace: of(0.3, SHARE),
        },
      },
      redline: {
        goldCut: {
          rookie: { E: of(0.12, GUILD_GOLD_CUT), D: of(0.11, GUILD_GOLD_CUT), C: of(0.1, GUILD_GOLD_CUT), B: of(0.09, GUILD_GOLD_CUT), A: of(0.08, GUILD_GOLD_CUT), S: of(0.07, GUILD_GOLD_CUT) },
          core: { E: of(0.09, GUILD_GOLD_CUT), D: of(0.08, GUILD_GOLD_CUT), C: of(0.07, GUILD_GOLD_CUT), B: of(0.06, GUILD_GOLD_CUT), A: of(0.05, GUILD_GOLD_CUT), S: of(0.04, GUILD_GOLD_CUT) },
          ace: { E: of(0.06, GUILD_GOLD_CUT), D: of(0.05, GUILD_GOLD_CUT), C: of(0.05, GUILD_GOLD_CUT), B: of(0.04, GUILD_GOLD_CUT), A: of(0.03, GUILD_GOLD_CUT), S: of(0.03, GUILD_GOLD_CUT) },
        },
        crystalShare: {
          rookie: of(0.35, SHARE),
          core: of(0.35, SHARE),
          ace: of(0.4, SHARE),
        },
      },
    },
  },
  // design 2.3: the points an item may spend beyond its slot's free numbers
  itemBudget: {
    share: real(0.5, 0, 2, 'share of a hunter\'s ability points that a full set of gear can add. 0 gives items no bonus budget, up to 2'), // half of what a hunter of the tier's rank holds at its first level, over the 10 slots
    weaponStep: real(1, 0, 10, 'average damage gained by a weapon\'s base die per tier, from 0 to 10'), // the free die rises by 1 mean damage a tier from 1d8
    // The foe a point of penetration is weighed against (balance plan section 9): a same-rank monster of this kind, a
    // brute's armor for the armor pair and a caster's resist for the resist pair. Penetration is worth more the thicker
    // the defence, so the foe is named; the elite sits between a pack's normal and a boss. One of `fight.kinds`
    // (overrides.ts refuses any other).
    penFoe: 'elite' as 'normal' | 'elite' | 'boss',
    // The cooldown a point of `haste` (ability haste) is weighed on (balance plan section 10): an ability that comes back
    // every this many rounds, so a point of haste gives a hundredth of a use more every this many rounds. 3 is the middle
    // of the built-in skills' cooldowns (Dagger Rush and Marked Shot 2, Mutilation, Sprint and Shield Wall 3, Stealth and
    // Mending Aura 4, Ruler's Authority 5).
    cooldownRounds: real(3, 1, 20, 'reference cooldown length in rounds used to value ability haste, from 1 to 20'),
  },
  // What a title may spend, in points on the sample wearer of its band (item-budget.ts `titleSpend`): the top of each
  // band of the ideas file (features/ideas-feats-titles-rewards.md section 4: E 1, D 2, C 2 to 3, B 3, A 4, S 5 and more).
  titleBudget: { E: of(1, TITLE_SPEND), D: of(2, TITLE_SPEND), C: of(3, TITLE_SPEND), B: of(3, TITLE_SPEND), A: of(4, TITLE_SPEND), S: of(5, TITLE_SPEND) },
  shadow: {
    maxAttempts: whole(3, 1, 20, 'shadow extraction attempts allowed per corpse. Must be at least 1'),
    dcBase: of(10, DC), dcPerRank: whole(3, 0, 20, 'extra extraction DC per rank the monster is above the hunter, from 0 to 20'),
    bossDc: whole(5, 0, 50, 'extra extraction DC for boss monsters, from 0 to 50'), dcMin: of(5, DC),
    summonMp: { E: of(1, SUMMON_MANA), D: of(2, SUMMON_MANA), C: of(4, SUMMON_MANA), B: of(8, SUMMON_MANA), A: of(16, SUMMON_MANA), S: of(32, SUMMON_MANA) },
  },
  gateSpawn: {
    rank: { E: of(40, WEIGHT), D: of(30, WEIGHT), C: of(15, WEIGHT), B: of(9, WEIGHT), A: of(5, WEIGHT), S: of(1, WEIGHT) },
    type: { normal: of(85, WEIGHT), red: of(10, WEIGHT), double: of(5, WEIGHT) },
    redDcBonus: whole(3, 0, 20, 'extra check DC inside a red gate, from 0 to 20'),
    regulars: { E: each([1, 3], PACK) }, // [min, max] pack size for a rank, any rank's in PACK (OPEN_DOMAINS); ranks not listed spawn 2-6
  },
  gateNames: ['Goblin Warren', 'Crimson Cavern', 'Frost Hollow', 'Sunken Temple', 'Ant Nest', 'Iron Fortress',
    'Whispering Catacombs', 'Ashen Spire', 'Moonlit Marsh', 'Double Dungeon', 'Demon Castle', 'Giant\'s Vault'],
  // maxDice: the owner was told a term rolls up to 100 dice (Roll20's own cap is higher); the exact mean of the worst keep
  // term this allows (100d1000!kh50) costs under a second, once, when a GM types it. maxSides: a d1000 is the largest die named.
  // Neither goes higher: the odds of a keep term list every face, so a billion sides is a list of a billion.
  dice: {
    maxDice: whole(100, 1, 100, 'maximum dice allowed in a single roll term. Above 100 slows down odds calculation'),
    maxSides: whole(1000, 2, 1000, 'maximum sides allowed on a single die, from 2 to 1000'),
  },
  logCap: whole(200, 1, 1000, 'maximum session log entries stored in a save, from 1 to 1000'),
  rollCap: whole(50, 1, 500, 'maximum dice rolls kept in history, from 1 to 500'),
  backupCap: whole(8, 1, 20, 'maximum automatic save backups kept on the device, from 1 to 20'),
  loadoutCap: whole(6, 0, 24, 'maximum saved gear loadouts per hunter, from 0 to 24'),
  // A hunter's personal gates, the System's (notes-2-solo.md section 7 has each number's reason): on, a spawn every
  // `hours`, at most `held` open at once (stays / hours, so a once-a-day player loses none), each open `stays` hours; a
  // spawn's rank one below, at, or one above the hunter's by `ranks` (percent), its pack `pack` normal monsters of that
  // rank from the built-in seeds, no boss. The pack was 1 to 3 until measured: two same-rank normals already kill a
  // level 1 pregen in about 40% of plays, so 2 is the hard gate and 3 is the party's (notes-2-solo.md section 16).
  solo: {
    personal: true,
    hours: whole(8, 1, SOLO_BOUNDS.hours, 'hours between personal gate spawns. Must be at least 1 hour and at most 1 week (168 hours)'),
    held: whole(3, 1, SOLO_BOUNDS.held, 'maximum personal gates open at once, from 1 to 10'),
    stays: whole(24, 1, SOLO_BOUNDS.hours, 'hours a personal gate stays open before closing, from 1 to 168'),
    ranks: { below: of(25, SHARE_OF_SPAWNS), same: of(60, SHARE_OF_SPAWNS), above: of(15, SHARE_OF_SPAWNS) },
    pack: each([1, 2], wholeIn(1, SOLO_BOUNDS.pack, 'number of monsters in a personal gate, from 1 to 12')),
    lootShare: of(0.25, SHARE), // economy design 4.2: a cleared personal gate pays a quarter of one hunter's share of a world gate (the owner: "A quarter.")
    // How much harder a solo run's fight is than the same fight at the table. The owner (Nov 21): "let's make auto runs 25%
    // harder than optimal gameplay clears. Have that factor into the odds given for the auto clears." The run is one
    // play of the odds engine, each side as well as its policy plays, so a player at the table can only do worse; this
    // takes the run's edge back. A fight's difficulty is its foes' HP times the damage they deal, so each foe gets the
    // square root of the factor on each (gates/solo.ts `soloFight`: its tweak's `hp`, and `dealt` on every hit after the
    // shares) and their product is the factor. Not its power: a hit is its dice plus its power, so power times 1.118
    // made an E foe's strike 7% harder, not 11.8%, and raised its heals too. The odds a card shows play that fight.
    // Measured (one play each, 3000 gates a rank, the six plain builds of tests/models/fight-sim.ts at the rank against
    // a personal gate rolled as soloTick rolls one, before the normal S seed when `pooled` fell back to A; se 0.9 points each): the
    // run's win chance at 1 then 1.25 is E 45.2% to 37.1%, C 42.7% to 34.7%, S 59.4% to 50.0%.
    autoHarder: real(1.25, 1, 4, 'difficulty multiplier for solo runs compared to table fights, from 1 to 4'),
  },
  // feats (hunter/feats.ts): `on` is the GM's one switch for every feat the System notices; the room's `rules` doc carries it to the players
  feats: { on: true },
  // trading (trade/offer.ts, views/trade.js): `on` is the GM's switch for the table's offers between hunters in a room; the
  // room's `rules` doc carries it to the players. Off refuses a new offer and an accept at the tap, never a refuse, a take
  // back, a stop or the read of an end (notes-5-trade.md 2.2)
  trade: { on: true },
  build: { enabled: true, playerPick: true, respecGold: whole(5, 0, 1_000_000, 'gold cost multiplier for respec (multiplied by level squared). 0 makes respec free') }, // respecGold: a player's own respec costs respecGold * level * level gold (GM mode is free)
  paths: BUILT_IN_PATHS, // the build paths and their perks: src/core/registry/paths.ts; each `alloc` number in PATH_ALLOC (OPEN_DOMAINS), each perk in PERK_POINTS
  // The reworked fight's numbers (docs/agent-handoff/rw/design.md; scripts/rw-paper.ts prints the tables they make).
  // src/core/stats.ts, src/core/hunter/derive.ts, combat/timeline.ts and combat/space.ts read them. Each comment is the
  // reason for the value; the last words of each rule are the reason for its domain.
  fight: {
    // Time (design 1.2)
    round: whole(1000, 100, 10_000, 'combat ticks per round. Must be at least 100 to avoid speed rounding errors'), // ticks in a round, the time a speed-100 combatant needs for one standard action; 1000 keeps rounding under 0.1%
    cost: { quick: of(70, COST), standard: of(100, COST), heavy: of(150, COST) }, // hundredths of a standard action: two quick actions cost more than one standard, a heavy one half a turn more
    moveCost: real(100 / 6, 1, 100, 'movement time per tile in hundredths of a standard action, from 1 to 100'), // one tile walked: six tiles cost a standard action, so everyone walks `move` tiles a round
    // A dash (design 4.6) runs the whole `move` in one straight line, twice a stride, for `dashTime` hundredths of a
    // standard action (the lead's standard action) and twice a strike's fatigue: a charge is how a heavy fighter closes
    // on an archer, and it costs breath. A walk already covers 6 tiles in a standard action's time at any speed, so at
    // 100 a dash is quicker than walking only for a body over speed 100 (sim-log.md, round three).
    dashTime: of(100, COST), dashFatigue: of(16, USE_FATIGUE),
    // A consumable used in a fight (registry/abilities.ts `itemAbility`) takes `consumableTime` hundredths of a standard
    // action, whatever its kind: the owner (Nov 22), "not a full turn, but should cost something". At half a standard
    // action a hunter who drinks a potion acts again before a foe of the same speed acts twice; under a tenth a bag of
    // potions is a free heal every tick, and a whole action is the full turn he ruled out.
    consumableTime: of(50, COST),
    // at 40 a combatant still acts every 2.5 rounds, at 250 it acts 2.5 times a round
    speedMin: whole(40, 10, 100, 'minimum combat speed. Must be above 0 so combatants can still take turns, and at most 100'),
    speedMax: whole(250, 100, 1000, 'maximum combat speed, from 100 to 1000'),
    // Stats (design 2.1)
    statBase: whole(10, 1, 100, 'starting value for each stat. Must be at least 1 because stat formulas divide by it'), // every stat starts at 10
    creationPoints: whole(12, 0, 100, 'starting ability points at level 1, from 0 to 100'), // free points at level 1, four levels' worth: enough for a main stat of 20 so an E build is a build
    mainShare: real(2 / 3, 0.5, 1, 'share of points a monster or starter build puts into its primary stat, from 0.5 to 1'), // a built body (a monster, a shadow, a starter, the sim's builds) puts two points in its main stat for one in its second
    effExp: real(0.8, 0.1, 1, 'exponent for stat scaling. 1 is linear scaling, and under 0.1 makes stats almost flat'), // eff(s) = base * (s / base) ^ 0.8: doubling a stat gives 1.74 times, an S main stat is worth 9.8 base ones
    half: whole(40, 1, 1000, 'stat points needed to reach half of a capped bonus. Must be at least 1'), // every capped curve reaches half its cap at 40 effective points; a C main stat has 34
    // The Sheet (design 2.2)
    growthDiv: whole(24, 1, 1000, 'levels needed to double base HP growth. Must be at least 1'), // g(level) = 1 + (level - 1) / 24: level carries most HP, so a fight is a similar number of hits at every rank
    // hpMax = g * 45 * (1 + capped(x(vit), 0.9)): Vitality's share of HP is a share like every other, on the capped curve
    // with Agility's cap on speed (90%), so a tank's toughness and a speed build's turns grow with rank at the same rate:
    // 1.14 times at E, 1.41 at C, 1.62 at S, never 1.9. It was 45 + 0.5 * x(vit), uncapped: a tank 1.09 times as tough as
    // a speed build at E and 1.98 at S, which flipped tank against speed from 0.10 at C to 1.00 at S (sim-log.md, round two).
    hpBase: whole(45, 1, 1000, 'base HP at level 1 before Vitality. Must be at least 1'),
    hpVitCap: real(0.9, 0, 5, 'maximum HP bonus multiplier from Vitality, from 0 to 5'),
    manaBase: whole(10, 0, 1000, 'base mana before stats, from 0 to 1000'), manaCap: of(30, STAT_CAP), // mana counts big casts a dungeon, so it does not grow with rank: an S cannon has 31, three casts
    fatigueBase: whole(100, 1, 1000, 'base fatigue capacity. Must be at least 1'), fatigueCap: of(50, STAT_CAP), // today's 0 to 100 bar; Vitality makes a body last longer, not hit harder
    carryBase: whole(20, 1, 1000, 'base carry capacity before Strength. Must be at least 1'), carryCap: of(50, STAT_CAP), // weight is what Strength lets you wear
    // free up to half the carry, then up to 35% slower at full carry: a heavy kit on a weak body costs a third of its turns
    freeLoad: of(0.5, SHARE), loadSlow: real(0.35, 0, 0.9, 'maximum speed reduction from heavy gear, up to 0.9'),
    // Strength lifts weight but does not shrink plate: weight over a base body's whole carry (`carryBase`, 20) is bulk, and
    // slows any wearer 2.5% a point, at most `loadSlow`. Only plate (32) has bulk: 12 points, 30% slower, so a tank runs
    // at 70 at C and at S alike (an S tank's Strength had lifted its load to 87, and it beat an S speed build in every
    // duel; sim-log.md, round four). The medium kit (18) and the light (8) have none.
    bulkSlow: real(0.025, 0, 0.1, 'speed reduction per point of heavy armor bulk, from 0 to 0.1'),
    speedBase: whole(100, 10, 1000, 'base combat speed before Agility and gear weight. 100 equals one standard action per round'), speedCap: of(90, STAT_CAP), // Agility alone takes a body to at most 190 before load
    moveBase: whole(6, 1, 40, 'base movement tiles per round at speed 100, from 1 to 40'), // tiles a round at speed 100: 30 feet, the pace the old text assumes
    strideShare: real(0.5, 0.1, 1, 'share of full movement allowed in one move command, from 0.1 to 1'), // one move command walks at most half of `move`, so a turn is never one long walk
    armorVitCap: of(30, STAT_CAP), // gear carries most armor, so the tank pays weight for it; Vitality gives a little to every body
    resistDisCap: of(40, STAT_CAP), // the magical twin of armor, from the will stat, so the tank in plate is open to magic
    // Penetration in whole percent of the armor or resist a hit meets (rule 12, balance plan section 9). Control's curve
    // gives up to `penCap` of both the armor and the magic percent: Control finds the gap. `penMax` caps the percent with
    // every bonus on it (an item's, a perk's, a status's), so armor always stops at least 40% of what it would; a bonus
    // passes Control's curve cap, never this one.
    penCap: of(40, STAT_CAP),
    penMax: whole(60, 0, 100, 'maximum percentage of armor or magic resist that penetration can ignore, from 0 to 100'),
    powerK: real(0.6, 0.01, 10, 'power gained per effective point in a power stat, from 0.01 to 10'), // phys, mag and sup are 0.6 * eff of their stat: uncapped, so damage keeps growing with rank
    critFacesCap: whole(5, 0, 10, 'maximum extra critical-hit faces added to the d20 by stats, from 0 to 10'), // a crit is 5% to 30% of uses, never the 1 in 3 where it becomes the expected hit
    critSizeBase: real(1.5, 1, 5, 'base critical-hit damage multiplier. Must be at least 1'), critSizeCap: real(0.5, 0, 5, 'maximum extra critical-hit damage multiplier from stats, from 0 to 5'), // a crit is 1.5 to 2 times: felt, and never more than today's double dice
    openK: real(0.25, 0, 2, 'opening roll bonus per point of Instinct, from 0 to 2'), openCap: whole(6, 0, 20, 'maximum opening roll bonus from Instinct, from 0 to 20'), // Instinct's opening bonus on the d20, capped at 6 so the die still decides 70% of the opening
    tenacityCap: of(60, STAT_CAP), // tenacity, from Strength and Discipline together; control lasts duration * (100 + potency) / (100 + tenacity): at most 37% shorter
    potencyCap: of(50, STAT_CAP), // mirrors tenacity, so equal investment cancels
    threatCap: real(1, 0, 10, 'maximum threat multiplier bonus from Presence, from 0 to 10'), // a Presence build draws up to twice the threat for the same damage
    holdBase: real(0.15, 0.01, 1, 'base share of max HP a single hit must deal to break a channel, from 0.01 to 1'), holdCap: of(0.25, SHARE), // a single hit of hold * hpMax breaks a channel: a status tick never does, one real attack does
    costCutCap: real(0.25, 0, 0.9, 'maximum ability cost reduction from Control, up to 0.9'), // Control lowers costs, at most a quarter off
    shadowPerEff: real(0.2, 0, 10, 'shadow army capacity gained per effective point of Presence, from 0 to 10'), // shadow capacity = floor(0.2 * eff(pre)): 2 at base, 19 for an S Presence build
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
    // Monster kinds (design 2.4, 4.2 and 4.3): factors on max HP, power, armor and resist, and the stagger bar in same-rank
    // hits (0 is no bar). A kind shortens and weakens nothing that lands on it: a boss is tougher by its own numbers, "more
    // hp, armor, magic resist" (the owner, Nov 21), not by halving a stun, a push or a share. A normal monster is a weaker
    // body, so three hunters beat a pack of three. `armor` and `resist` multiply its kit's and its stat's share (derive.ts
    // `monsterSheet`; balance plan section 1): normal 1, elite 1.25 between, boss 1.5, half again as a suit. The armor
    // curve `armorK / (armorK + def)` flattens, so 1.5 times the armor is less than 1.5 times the toughness. A boss has
    // 2.8 bodies of HP with one turn, measured against design 6's boss rows (the mixed party wins in 4 to 8 rounds at C
    // and S, sim-log.md, balance unit 4): it was 3.2 while a boss's armor and resist were its kit's alone (C 6.2 rounds, S
    // 7.7), and with 1.5 times the guard 3.2 took the S party 8.3 rounds, past the bound, so part of its toughness moved
    // from HP into armor and resist: at 2.8 the fights are 5.9 and 7.3 rounds. At 4 bodies the S party needed 9.8 rounds,
    // because the tank spends its turns taunting. An elite (1.5 HP, 1.25 guard) stays between a normal and a boss in each.
    // `xp` is the factor on the rank's XP (`rankTable`), as the old boss (3) and elite (1.5) rules gave it.
    // A mythic (balance plan section 4) is the fourth kind, "basically impossible to beat, like 5-10% odds for a party of
    // 3" (the owner, Nov 21): the mixed party at S's first level wins 5 to 10 fights in 100 against one alone (row M1,
    // tests/fight-sim.test.ts; sim-log.md, balance unit 3). Its armor and resist are the plan's 2, twice a normal's, and
    // its power the same 2, so it is twice a normal body in everything but HP. Its HP is what M1 measured against a brute
    // mythic, 600 fights each: 5.0 bodies won 0.167, 5.1 won 0.110, 5.2 won 0.068 (se 0.010), 5.3 won 0.042, so 5.2 is
    // the middle of the bound. The band is that narrow because a 14-round fight between fixed builds averages its dice
    // out. Its stagger bar is a boss's 4 same-rank hits. Its XP is about its HP factor, as an elite's (1.5 for 1.5) and
    // a boss's (3 for 2.8) are.
    kinds: {
      normal: { hp: of(0.6, KIND_FACTOR), power: of(0.7, KIND_FACTOR), armor: of(1, KIND_GUARD), resist: of(1, KIND_GUARD), stagger: of(0, KIND_STAGGER), xp: of(1, KIND_XP) },
      elite: { hp: of(1.5, KIND_FACTOR), power: of(1, KIND_FACTOR), armor: of(1.25, KIND_GUARD), resist: of(1.25, KIND_GUARD), stagger: of(2.5, KIND_STAGGER), xp: of(1.5, KIND_XP) },
      boss: { hp: of(2.8, KIND_FACTOR), power: of(1.2, KIND_FACTOR), armor: of(1.5, KIND_GUARD), resist: of(1.5, KIND_GUARD), stagger: of(4, KIND_STAGGER), xp: of(3, KIND_XP) },
      mythic: { hp: of(5.2, KIND_FACTOR), power: of(2, KIND_FACTOR), armor: of(2, KIND_GUARD), resist: of(2, KIND_GUARD), stagger: of(4, KIND_STAGGER), xp: of(5, KIND_XP) },
    },
    // Monster archetypes (derive.ts `ARCHETYPES`): factors on max HP and power, after the kind's. An archetype changes how
    // a monster fights (a shot from range and a dodge, a curse no dodge escapes), not how hard it is to beat, so each kind
    // means one fight whatever the body. Without them only the brute's 2:1 split buys toughness: Vitality is its second
    // stat (1.47 times the HP of a body with none at S) and its medium kit and Vitality give it armor 46 at S against a
    // light kit's 10; a skirmisher's main stat, Agility, buys turns and dodges, not damage. The mythic kind, fitted on a
    // brute, was beaten 70% of the time as a caster and always as a skirmisher (sim-log.md, balance unit 6). The brute
    // is 1, as the kinds were measured on it; each other pair is what row M1 measured (600 fights each): the HP that puts
    // the mixed party's wins at the brute's (0.068) with the power that keeps the fight about the brute's 14.4 rounds.
    // The caster's curse is never dodged and its Control finds Will, so it hits harder than a brute and needs less power:
    // 1.8 and 0.75 won 0.078 in 14.6 rounds (1.8 and 0.8 won 0.05, 1.7 and 0.75 won 0.16 at 200 fights). The skirmisher at
    // power 1 won 0.070 in 13.9 rounds at 1.7 (1.65 won 0.140; power 1.1 at 1.6 cut the fight to 12.8 rounds).
    archetypes: {
      brute: { hp: of(1, KIND_FACTOR), power: of(1, KIND_FACTOR) },
      skirmisher: { hp: of(1.7, KIND_FACTOR), power: of(1, KIND_FACTOR) },
      caster: { hp: of(1.8, KIND_FACTOR), power: of(0.75, KIND_FACTOR) },
    },
    // Monster traits (balance plan section 1): named changes to a monster's body that a row's words ask for, each the
    // smallest set of pieces the body already has: a factor on max HP, on armor and on resist (after its kind's), a
    // percent on speed (a `speed` StatusMod, read as a status's), and a factor on XP. The draft's words name slow in 15
    // rows, armour in 19, fast in 6 and tough in 1; frail is in none, kept as the mirror of tough. Every number is a
    // starting guess the simulation settles (balance plan unit 4). `xp` stays 1 until it is measured: the reference
    // party's mean HP lost against a row with the trait over the same row without it, to a tenth.
    traits: {
      // the middle of the shipped seeds' hand HP factors under 1 (0.7 to 0.9)
      frail: { hp: of(0.8, KIND_FACTOR), armor: of(1, KIND_GUARD), resist: of(1, KIND_GUARD), speed: of(0, TRAIT_SPEED), xp: of(1, KIND_XP) },
      // the middle of the shipped seeds' hand HP factors over 1 (1.1 to 1.5)
      tough: { hp: of(1.3, KIND_FACTOR), armor: of(1, KIND_GUARD), resist: of(1, KIND_GUARD), speed: of(0, TRAIT_SPEED), xp: of(1, KIND_XP) },
      // what plate's bulk costs (`bulkSlow` on plate's 12 points over the carry): "slow" is as slow as a body in plate
      slow: { hp: of(1, KIND_FACTOR), armor: of(1, KIND_GUARD), resist: of(1, KIND_GUARD), speed: of(-30, TRAIT_SPEED), xp: of(1, KIND_XP) },
      // the mirror of slow
      fast: { hp: of(1, KIND_FACTOR), armor: of(1, KIND_GUARD), resist: of(1, KIND_GUARD), speed: of(30, TRAIT_SPEED), xp: of(1, KIND_XP) },
      // half again, as the boss's armor factor
      armored: { hp: of(1, KIND_FACTOR), armor: of(1.5, KIND_GUARD), resist: of(1, KIND_GUARD), speed: of(0, TRAIT_SPEED), xp: of(1, KIND_XP) },
      // the magical twin of armored
      warded: { hp: of(1, KIND_FACTOR), armor: of(1, KIND_GUARD), resist: of(1.5, KIND_GUARD), speed: of(0, TRAIT_SPEED), xp: of(1, KIND_XP) },
    },
    // Defence (design 3.1 rule 12)
    armorK: whole(100, 1, 10_000, 'divisor in the armor damage reduction formula. Must be at least 1'), // dealt = raw * 100 / (100 + def): 60 armor takes 37% off, and no amount of armor makes a body immune
    // The flat part of armor or resist: 3% of what is left after penetration comes off every hit before the percentage,
    // so a weak hit loses more than a strong one (the mirror of penetration's flat part). A C tank's 74 takes 2.2 off a
    // speed build's 14-point shot (15%) and off a bruiser's 30-point strike (7%). At 0 tank against speed at C was 0.49 of
    // duels (sim-log.md, round two); at 0.03 it is 0.80; at 0.06 it is 1.00, as a duel is near all or nothing.
    armorFlat: real(0.03, 0, 0.5, 'flat damage reduction per point of remaining armor or magic resist, from 0 to 0.5'),
    // Reaction (design 3.1 rules 8 and 9, 3.2)
    reactK: real(0.25, 0, 2, 'reaction roll modifier per point of difference between Reaction and Accuracy, from 0 to 2'), reactCap: whole(6, 0, 20, 'maximum positive or negative modifier on a reaction roll, from 0 to 20'), // edge = round(0.25 * (react - aim)), at most 6 either way, so the d20 always decides
    // Reaction = 10 + x(ins) + reactAgi * x(agi): noticing the blow is Instinct, getting the body moving is Agility (the owner's
    // notes give Agility "speed and dodge"), and each counts once, the weight Instinct already had. Reaction is compared
    // with Accuracy, which is eff(ctl) uncapped, so it stays on the same curve; the edge's cap of 6 bounds it. With
    // Instinct alone a speed build had Reaction 10 and the cannon's Control cancelled its dodge: speed beat the cannon
    // 0.30 of duels at C (sim-log.md, round three).
    reactAgi: real(1, 0, 5, 'weight of Agility in the Reaction formula. 0 uses Instinct alone'),
    // A use with no travel is resisted on d20 + will edge of 12 or more, or a 20: 45% at equal Will and Accuracy, and 15%
    // to 75% at the edge's cap of 6 either way, so the die decides even against a caster's best Control, as it does for a
    // dodge. At 15 a C cannon's Control (edge -4) left its curse resisted 10% of the time and an S one's 5%, a natural 20
    // alone, and speed beat the cannon in 0.51 of duels at C once it cast Arc Bolt. At 11 (a coin flip at parity) the S
    // boss resisted enough of the cannon's bolts to last past 8 rounds (sim-log.md, round four).
    resistDc: whole(12, 2, 21, 'd20 target number needed to resist an instant effect, from 2 to 21'),
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
        windup: of(100, WINDUP), travel: whole(80, 1, 1000, 'projectile travel speed in tiles per round. Must be at least 1'), range: of(12, RANGE),
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
    fightRest: whole(55, 0, 1000, 'fatigue recovered automatically after a fight ends, from 0 to 1000'),
    // Channel (design 4.1)
    channelMax: whole(5, 1, 20, 'maximum channel charge stacks, from 1 to 20'), // charge grows one a turn and stops at 5
    channelLin: real(0.5, 0, 5, 'damage multiplier added per charge for linear channel abilities, from 0 to 5'), // the maker's linear tick: base * (1 + 0.5 * charge), 3.5 times at 5, the safe choice
    channelExp: real(1.45, 1, 3, 'growth base per charge for exponential channel abilities, from 1 to 3'), // the maker's exponential tick: base * 1.45 ^ charge, 6.4 times at 5, nearly a same-rank boss's HP
    breakShare: of(0.5, SHARE), // a broken channel fires at half its charge, rounded down
    // Threat (design 4.2)
    threatDecay: of(0.1, SHARE), // every entry falls 10% a round, so a hunter who stops attacking fades out in about 7 rounds
    // The share of a hit's threat (rule 15) counted from its damage before the target's armor or resist, the rest from
    // what it dealt after them. All of it, so a monster's own defence does not pick whom it aims at: at 0 a boss's 1.5
    // times armor cut the physical builds' threat and left the cannon's, the boss aimed at the cannon in 57% of its acts
    // during a channel (51% before that armor), and a channel begun under its aim completed 0.086 at C over 1,200 fresh
    // seeds; at 1 it completes 0.208 (se 0.019), inside design 6's 10 to 25%, and no other row moves (sim-log.md).
    threatBeforeDefence: of(1, SHARE),
    tauntBurst: real(2, 0, 10, 'multiplier on threat lead added when taunting, from 0 to 10'), // a taunt adds twice the gap to the leader, the smallest rule that matters after the taunt ends
    tauntRounds: whole(2, 0, 10, 'duration of a taunt in rounds, from 0 to 10'), // one or two of the monster's turns: enough to pull it off a hunter about to die, short enough to keep taunting
    // Stagger (design 4.3)
    staggerWeak: real(1.5, 1, 5, 'stagger bar multiplier for small hits, from 1 to 5'), // a hit under a third of a same-rank hit fills 1.5 times its damage: chips help without being the way to kill
    staggerCost: real(1.5, 0, 10, 'rounds a combatant\'s next turn is delayed when staggered, from 0 to 10'), // a full bar moves the monster's next turn to now + 1.5 rounds: it misses one turn and part of another
    staggerWeakBelow: of(1 / 3, SHARE), // a weak hit is under a third of a same-rank hit: a status tick or a chip build's quick hit
    staggerRegrow: real(0.75, 0, 5, 'fractional increase to the stagger bar after each stagger, from 0 to 5'), // the bar's max grows 75% after each stagger, so a boss fight has one or two staggers: at 50% an S boss, about 24 same-rank hits long, filled a third bar in 3 fights of 10 (sim-log.md)
    // Shield (design 4.4)
    shieldLife: whole(2, 0, 20, 'default duration of a shield in rounds, from 0 to 20'), // rounds: a shield buys a turn, not a fight
    // Space (design 5.1 to 5.3)
    tileFeet: whole(5, 1, 100, 'feet represented by one map tile. Must be at least 1'), // 21 monster abilities already give distances in feet, and a portrait phone fits about 20 by 14 tiles
    lineGap: whole(8, 1, 36, 'starting tile gap between the party and monster lines, from 1 to 36'), // tiles between the two default lines: two or three turns of walking for a slow build, one for a fast one
    lineBack: whole(2, 0, 10, 'rows behind the party front line for back-row positioning, from 0 to 10'), // rows behind the party's front line, so a reserve stands behind it; the foes' front at 10 leaves them 3 rows on a grid 14 high
    // a fight with no map: 100 by 70 feet, a room or a clearing
    grid: {
      w: whole(20, GRID_SIDE[0], GRID_SIDE[1], 'default open arena width in tiles, within the map size limits'),
      h: whole(14, GRID_SIDE[0], GRID_SIDE[1], 'default open arena height in tiles, within the map size limits'),
    },
    // The map (design 4.7 and 5.3)
    coverShare: of(0.25, SHARE), // a body in cover takes a quarter less from a use that travels to it: the d20's three-quarters cover, +5 to hit, is a quarter of the die
    sight: whole(25, 1, 128, 'default sight distance in tiles when fog of war is active, from 1 to 128'), // tiles the party sees in a fog of war: the whole default arena from its corner (19 + 13 / 2 = 25 by the 5-10-5 count); a GM lowers it for a dark gate
    // Stealth and sight (docs/agent-handoff/features/notes-7-stealth.md section 2): the sight level every body has before
    // a sight op raises it. 0, so a body with no sight content perceives no stealth above level 0, and sight is earned
    // from a class, an item or a flare: a curve on Instinct would let any hunter who spends points see every hide.
    stealth: {
      sightBase: whole(0, Math.min(...LEVELS), Math.max(...LEVELS), 'default stealth detection level (0 to 5, matching ranks E to S)'),
      // The ambush (section 2, the owner's rulings 3 and 5): a use's hit from hiding on a target that does not perceive its
      // user deals this many times as much, in place of the attacker's edge hiding gave. It is one of the user's dealt
      // increases (rule 11c), so a dealt buff does not compound with it and `kit.shareCap` still bounds it. A hide is one
      // action that deals nothing: at 1.5 a hide and a strike deal 1.5 strikes in two actions, so the ambush pays back
      // half the action and the turns no foe can pick its bearer pay the rest; at 2 the pair deals what two strikes deal
      // and those turns come free, so hiding beats striking outright. The worst heavy strike on a tank stays under design
      // 6's 60% of its HP: table 8.10.2b's 38% (with the old edge, larger than without it) times 1.5 is 57%.
      ambush: real(1.5, 1, 2, 'damage multiplier for an attack from hiding. 1 disables the ambush bonus, up to 2'),
    },
    // Fields that move and spread (design 4.8)
    auraRadius: of(2, RADIUS), // an aura the maker starts: a blast's radius, so an aura and a blast read with the same ruler
    fieldRadiusMax: of(6, RADIUS), // the widest an aura or a growing field gets: 121 tiles, under half the default arena's 280, so there is somewhere to stand outside it
    fieldGrow: whole(1, 0, 10, 'radius tiles gained per round by a growing field, from 0 to 10'), // tiles of radius a growing field gains a round in the maker: a walker at move 6 outruns it
    spreadRange: whole(1, 1, 10, 'default spread distance in tiles for spreading statuses, from 1 to 10'), // a sickness passes by touch: a body next to its bearer, diagonals too
    spreadRangeMax: whole(3, 1, 10, 'maximum spread distance in tiles for spreading statuses, from 1 to 10'), // further than that it is an aura
    // Kits (docs/agent-handoff/kits/design.md sections 1.11, 3 and 8.0; `bun scripts/kits-paper.ts` prints the tables): the
    // caps every parser of the kit blocks reads, what the reducer stops at, and what the maker weighs a made thing against.
    // A cap's domain stops at a few times its value: each bounds a loop or a list the reducer walks every command.
    kit: {
      stackCap: whole(20, 1, 99, 'maximum stack limit allowed on a status, from 1 to 99'), // the most stacks a def may hold: twice the largest cap a sheet writes (Baangs 9, Cold's threshold 5), and two digits on a chip
      stackAdd: whole(3, 1, 20, 'maximum stacks one effect can add or remove at once, from 1 to 20'), // the most stacks one op adds or cures: Anchor's "twice as fast" is 2; a third leaves room, a fourth is a threshold in one hit
      triggers: whole(4, 0, 8, 'maximum triggers allowed on one status, from 0 to 8'), // triggers on one status def: the most any kit item needs is 2 (Osteoporosis), and each one is a line the GM reads
      triggerOps: whole(6, 1, 12, 'maximum effects inside one trigger, threshold, or expiration, from 1 to 12'), // ops in one trigger, a threshold or an end: an item's effects list is 12, half of it is a full rule
      depth: whole(2, 0, 4, 'maximum chain depth for nested triggers, from 0 to 4'), // a trigger's ops raise further triggers to this depth: Parry, then Retribution's hit, then Void Knight's stack is 2
      fires: whole(16, 1, 64, 'maximum total trigger activations during one action, from 1 to 64'), // trigger firings in one command, whatever the depth: 4 triggers on 4 statuses of the user is 16
      fightUses: whole(10, 1, 99, 'maximum uses allowed for per-fight or per-gate ability limits, from 1 to 99'), // the most uses an "n a fight" or "n a rest" limit may have: a fight is 4 to 8 rounds, so 10 is "every turn"
      prices: whole(2, 0, 6, 'maximum extra costs allowed on one ability, from 0 to 6'), // extra costs on one ability: HP and a stack (Truth in Pain), or a stack and a zone (Soul Shatter)
      gates: whole(3, 0, 6, 'maximum requirements allowed on one ability, from 0 to 6'), // conditions on one ability: a mode, stacks on the target and a use limit (Spirit Shackle)
      hpShare: real(0.5, 0.01, 0.9, 'maximum HP cost as a share of max HP, from 0.01 to 0.9'), // an HP price of at most half the max HP: past that one use is most of a life, and a heal must pay it back
      hpShareMin: real(0.01, 0, 0.5, 'minimum HP cost as a share of max HP, from 0 to 0.5'), // the smallest HP price as a share: 1%, under which a price is a rounding error
      hpFlat: whole(999, 1, 9999, 'maximum flat number allowed in item and skill effects, from 1 to 9999'), // the bound of every flat number the parsers read (SKILL_BOUNDS.bonus)
      tags: whole(3, 0, 10, 'maximum tags allowed on one ability, from 0 to 10'), // tags on one ability: Hwei's painting type and "ultimate" are two
      tagLength: whole(20, 1, 60, 'maximum characters in an ability tag, from 1 to 60'), // a tag is a word the GM types: "disaster", "ultimate", "sword"
      zonesPerOwner: whole(3, 1, 10, 'maximum active fields one combatant can own at once, from 1 to 10'), // zones one body holds at once: Einar starts at 3 boundaries; a fourth replaces the oldest
      zoneAge: whole(1, 0, 10, 'minimum rounds a field must stay active before ending it triggers its expiration effect, from 0 to 10'), // rounds a zone must stand before ending it pays its end: placing and popping in one turn would be a free blast
      summons: whole(2, 0, 6, 'maximum timed summons one combatant can have active at once, from 0 to 6'), // timed summons one body holds at once: two sprites; past that the order of turns is the summoner's alone
      summonRounds: whole(5, 1, 20, 'maximum duration of a timed summon in rounds, from 1 to 20'), // the longest a summon stays: a fight is 4 to 8 rounds, and a summon for the whole fight is a hunter
      fieldStacks: whole(60, 1, 300, 'maximum total status stacks counted by field(key) formulas, from 1 to 300'), // `field(key)` reads at most this: three bodies at the cap of 20
      kills: whole(10, 1, 100, 'maximum kills counted by kills formulas, from 1 to 100'), // `kills` reads at most this: a pack is 3 to 6, a long fight 10
      held: whole(10, 1, 100, 'maximum rounds counted by held(key) formulas, from 1 to 100'), // `held(key)` reads at most this many rounds: past a long fight
      hits: whole(16, 1, 100, 'maximum targets counted by hits formulas, from 1 to 100'), // `hits` reads at most this many bodies: every zone's worth of a crowd
      // Wave 2 (kits design 8.1 to 8.7, kits-paper `KIT2`, table 8.1). Each bounds one block; the reason is beside it.
      shareCap: real(0.5, 0, 0.9, 'maximum damage-dealt or damage-taken modifier distance from 1, up to 0.9'), // a use's dealt times taken share stays in 0.5 to 1.5: Brutalize's -50% healing is the sheet's largest share
      // The most shield a body holds from its own damage dealt (shieldDrain), a share of its max HP: a fifth, so a hard
      // hitter holds at most one fifth of a bar more, about one same-rank hit, and the ceiling, not the share, bounds it.
      shieldDrainMax: real(0.2, 0, 1, 'maximum shield gained from dealing damage, as a share of max HP, from 0 to 1'),
      armorOp: of(60, KIT_GUARD), // a status moves armor or resist by at most a suit of plate's 60 (`kits.heavy`)
      critFacesMax: whole(6, 0, 10, 'maximum total critical-hit faces on a d20 including target debuffs, from 0 to 10'), // crit faces plus a target's exposed faces stay at most 6: design 2.2's 30%, never the 1 in 3
      critSizeMax: real(2, 1, 5, 'maximum total critical-hit damage multiplier, from 1 to 5'), // crit size stays at most 2: design 2.2's "never more than double the dice"
      // A cost cut stays at `costCutCap`'s 0.25: mana is the dungeon's brake on blasts (design 6). The paper's separate
      // fatigue cut of 0.5 needs a second sheet number; one cut on both is the stricter reading (notes-build-3.md).
      costCutMax: real(0.25, 0, 0.9, 'maximum ability cost reduction from statuses and stats combined, up to 0.9'),
      rangeAdd: whole(3, 0, 20, 'maximum extra range tiles a status can add, from 0 to 20'), // tiles a status adds to its bearer's ranges of 2 or more: a curse's 8 to 11, still under a shot's 12
      wardRounds: whole(1, 0, 10, 'maximum duration of protective wards in rounds, from 0 to 10'), // untargetable, invulnerable and safeguard last a round at most, and the first two reach a body once a fight
      boostSides: whole(20, 2, 100, 'maximum die size for a stored bonus die, from 2 to 100'), // a held die is at most a d20 (Expected Outcome)
      shoveMax: whole(3, 0, 40, 'maximum tiles one push or pull can move a target, from 0 to 40'), // tiles one push or pull moves a body: half a round's walk at move 6
      // The most of a stagger bar one `stagger` op fills (keystones design A.7): half a bar, so no one op breaks a bar alone.
      staggerOpMax: real(0.5, 0, 1, 'maximum share of a stagger bar one effect can fill, from 0 to 1'),
      blinkMax: of(8, RANGE), // the longest blink: a curse's range, the gap between the default lines
      // The share of max HP under which a body is low (the Lifeline items' "under 30%"; item-stats design 3.1): a third of
      // a bar, about one same-rank hit from down, so a shield given there buys a turn.
      lowHpAt: real(0.3, 0.05, 0.9, 'share of max HP below which a combatant counts as low HP, from 0.05 to 0.9'),
      reactionsPerUse: whole(4, 0, 20, 'maximum reactions triggered by a single action, from 0 to 20'), // reactions one use may set off: four targets of an area, one each
      // Parry's guard, the share a `before` reaction takes off a strike (kits table 8.10.3): the largest in steps of 0.05
      // with which no build armed with it all fight improves a duel against a striker by more than the tolerance. The
      // sheet's Parry (0.25 or 0.75 by a roll) takes about 0.5 off and lifts the speed build over the tank by 1.30 to 1.40.
      // The paper's 0.35 is the simulation's 0.30: at 0.35 the speed build armed with it beat the tank 0.08 more often at C
      // and 0.17 at S (a duel is a race, and 0.35 takes a tank's swing under a hit the speed build lives through); at
      // 0.30 it is -0.03 and -0.01, at 0.25 -0.08 and -0.13, since its quick action's time is real (sim-log.md).
      parry: of(0.3, SHARE),
      zoneMove: of(6, RANGE), // tiles one use moves a zone: a round's walk
      zoneGrow: of(2, RADIUS), // tiles of radius one use adds to a zone, to `fieldRadiusMax`
      extraPerRound: whole(1, 0, 4, 'maximum extra actions one combatant can gain per round, from 0 to 4'), // extra actions (a refund to now) one body takes in a round of fight time: the fastest build stays under 4 turns to the tank's 1
      surprise: whole(1, 0, 5, 'rounds a surprised side is delayed at the start of combat, from 0 to 5'), // rounds a surprised side's openings are pushed back
      doArmed: whole(12, 0, 24, 'maximum party members whose armed reactions are synced to players, from 0 to 24'), // party rows whose armed reaction the room doc names: 4 hunters, 4 shadows, 4 summons
      // The maker warns past 1.08 times a pace's budget (design 3): the triangle's closest margin on paper is the cannon over
      // the tank at C, 1.081 (kits-paper table 3.1), so a made thing that adds more can flip that row by itself.
      tolerance: of(0.08, SHARE),
      referenceRounds: whole(6, 1, 20, 'reference fight length in rounds used to value lasting statuses, from 1 to 20'), // a status that lasts until removed is weighed over design 6's reference fight of 6 rounds
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
        lowHp: of(0.17, EVENT_RATE), // once a fight, as `down`
        imposed: of(1, EVENT_RATE), // `statusGained`'s, of which it is the user's side: a curse build puts a status on every action
      },
      // The conditional scalers that replace the execute (design 8.0): the owner, Nov 14, "execute just does more dmg the lower
      // health people are". A scaler's bonus is 0 at its start and its scale at its end, linear between.
      scalers: whole(2, 0, 4, 'maximum conditional damage scalers on one formula, from 0 to 4'), // scalers on one formula: an execute and one counterpart; a third is a formula nobody reads at a glance
      scaleCap: real(1, 0.05, 5, 'maximum bonus multiplier a conditional scaler can add, from 0.05 to 5'), // the most a scaler adds: double the damage, a crit's largest size (critSizeBase + critSizeCap)
      scalerStart: of(0.5, SHARE), // where a suggested scaler activates: half of an HP share, or two equal bodies of a pair
      scalerStep: real(0.05, 0.01, 0.5, 'step size used to suggest a conditional damage bonus. Must be above 0'), // the suggested scale is searched in steps of 5%, the precision a GM reads off a slider
      // A pair's bonus is whole at 4 to 1: past a same-rank boss over a paper build at C and E (2.8 to 4, kits-paper table
      // 8.0.1), so a giant slayer is near its whole against a boss and not past it.
      pairFull: real(4, 1.5, 20, 'stat ratio where a comparison scaler reaches full bonus. Must be above 1'),
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
        pain: { perStack: real(0.06, 0, 1, 'bonus damage share added per Pain stack, from 0 to 1'), spendAt: whole(5, 1, 20, 'Pain stack threshold where Violence is used, from 1 to 20') },
        // Glas: Hemoplague, under Crimson Pact, ends 3 rounds later for 1.4 curses: design 3's number for it. No simulation
        // build plays the Pact yet (notes-worth.md); the bar weighs it at 0.50 SA at C, inside its budget with the Pact's
        // credit. It was 0.6 while worth.ts weighed a curse with no formula against a physical one.
        hemo: { end: of(1.4, BURST) },
      },
    },
    // Keystones (docs/agent-handoff/features/notes-11-keystones.md, design A): a power a body earns when one stat, or two
    // together, hold a large share of the points it spent (src/core/hunter/keystones.ts `keystonesOf`). A share is a
    // stat's points above `statBase` over all of them, read from the allocated stats only: gear, titles, perks and fight
    // statuses never count.
    keystone: {
      // A room's switch: off, no body holds a keystone and the fights of before keystones hold.
      // It ships off until unit K5's rows (the fight simulation of a keystone's win share) hold and K6's screens explain
      // a keystone, then on, as `mythic.scripts` does.
      on: false,
      // At most three stats can hold 30% (30% times 3 is 90%), so a mark names one of the hunter's few stats, never one of many.
      markShare: real(0.3, 0.2, 0.5, 'share of spent ability points needed to earn a stat mark, from 0.2 to 0.5'),
      // A quarter each: two stats holding half the points. Four even stats still earn their top pair.
      pairShare: real(0.25, 0.15, 0.5, 'share of spent ability points needed in each of two stats for a confluence, from 0.15 to 0.5'),
      // Over half, so one stat at most: two stats at 50% earn no apex.
      apexShare: real(0.55, 0.51, 0.9, 'share of spent ability points one stat must exceed to earn its apex. Must be above 0.5 so only one stat can qualify'),
      // One tier for each rank step after E: the first sessions teach the sheet before keystones arrive, and the words
      // are plain ("at rank D", not "at 240 points"). Each is one of RANKS (overrides.ts reads it).
      markRank: 'D' as Rank, pairRank: 'C' as Rank, apexRank: 'B' as Rank,
      // What one keystone may spend, in points on the sample wearer of its rank (item-budget.ts `powersSpend`; a point is
      // a stat point's worth, a rank gives 30). A keystone is what a build earns for specialising, so it is set from what
      // design A.6's keystones of the tier weigh as written, not from a title's 2 to 4 points (at 4 Worldbreaker kept 3%
      // of a strike): the marks Follow Through 10.2, Rally 8.7 and Lockdown 11.6 sit about 10; the confluences
      // Executioner 17.8, Vanguard and Conduit 16.7, Riposte 12.8 and Endless Stride 12.4 about 15; the apexes Undying 24.3
      // and Cataclysm 29.9 about 25. An apex is two and a half marks, as A.8 asks (a mark's gain 3 to 8 points of win
      // share, an apex's 8 to 15). A keystone far from its tier moves, not this (notes-11-keystones-build.md, K2).
      budget: {
        mark: of(10, KEYSTONE_SPEND), confluence: of(15, KEYSTONE_SPEND), apex: of(25, KEYSTONE_SPEND),
      },
    },
    // Mythic scripts (docs/agent-handoff/features/notes-11-keystones.md, design B): a mythic's fight in phases, with
    // omens announced a turn ahead and the party's answers, one row of `MYTHICS` each (src/core/registry/mythics.ts).
    mythic: {
      // A room's switch, as `keystone.on`: on by default since unit mythic-phases-on (the owner's "sure" on
      // questionable-decisions row 26, and row B4 holds since mythic-balance, PR 76). The GM's switch in Fight tools
      // still turns phases off for a table; off, no row holds a standing and every mythic fights on its base body.
      scripts: true,
      // Keystones A's promise: the share of a `stagger` op (A.7) a mythic's bar takes. Half: Worldbreaker's half bar is
      // then a quarter of a mythic's, so a stagger answer needs the party's hits too, never one ability.
      staggerTaken: real(0.5, 0, 1, 'share of a stagger effect applied to a mythic monster\'s stagger bar, from 0 to 1'),
      // An omen's announce and a phase change each take the mythic's turn: a standard action's time (timeline.ts
      // `paceCost`). The party gets about one turn each to answer, and the mythic does nothing else on that turn. One
      // of the paces (overrides.ts reads it).
      turnPace: 'standard' as Pace,
      // Decision 40: an answer met winds its gate phase's clock back by these rounds (mythic.ts `answerBack`), never past
      // the phase's start. Without it a party that answered every omen and one that answered none lost the same race to
      // the clocks (sim-log.md, MY5 second pass): an answer saved HP, and the clocks, not HP, decided the fight.
      // 3 rounds, about one omen's cycle, with the scripts' clocks shortened to match (sim-log.md, MY5 fifth pass): once
      // decision 43's answers are turns a party plays only to answer, the party that answers none buys no time, and a
      // clock it cannot beat is one the answering party beats by answering. At 1 round the time bought moved no fight.
      answerTime: {
        cancel: whole(3, 0, 20, 'rounds added back to a mythic phase clock when an omen is canceled, from 0 to 20'),
        weaken: whole(3, 0, 20, 'rounds added back to a mythic phase clock when an omen is weakened, from 0 to 20'),
      },
      // Decision 42: what a stagger or a burst answer asks, counted only from the omen's announce (mythic.ts
      // `answerMet`): `stagger` same-rank hits on its bar (its `hit`, so a bar grown by a break asks no more), `burst` a
      // share of its max HP. Past what ordinary turns land in an omen's window (sim-log.md, MY5 fourth pass): the mixed
      // party's three turns or so land 2 to 6% of a mythic's max HP at the median and 8 to 12% at the 90th centile, and
      // 1 to 2 same-rank hits on its bar. At 0.13 and 4 (a whole bar of a first phase) the party that answers none meets
      // them 0.03 to 0.26 times a fight; at the omens' old shares (0.05 to 0.08) half its windows met the burst.
      // Decision 43 left no script's omen answered by a hit (a hit is the turn a party plays anyway, so the answer was a
      // word); the rule stays for a party that holds a hit it can save (keystones' stagger ops, unit K5).
      answerReach: {
        stagger: real(4, 0, 20, 'standard hits on the stagger bar needed after an omen warning to answer it, from 0 to 20'),
        burst: real(0.13, 0, 1, 'share of max HP damage needed after an omen warning to answer it, from 0 to 1'),
      },
      // The bounds every script is checked against (tests/mythics.test.ts), each a least and a most.
      bounds: {
        // One phase (`plain`) to four. Row M1's fight is about 14 rounds; four phases leave each about 3, one omen
        // announced and landed and a turn to see the phase. A fifth would be over before the party read it.
        phases: each([1, 4], wholeIn(1, 10, 'number of phases allowed in a mythic script, from 1 to 10')),
        // An omen takes a round to announce and land, so a clock under 2 rounds enrages a phase before its first omen
        // can be answered. Design B.8 bounds a mythic fight at 20 rounds: a clock past it never runs out in a fight.
        clock: each([2, 20], wholeIn(1, 40, 'rounds allowed on a mythic phase clock, from 1 to 40')),
        // A move's hit in sample S hunters' max HP: 0 is a move of statuses only; past 4 a move kills every hunter
        // many times over, so a larger number says nothing more.
        hits: each([0, 4], realIn(0, 10, 'mythic move damage measured in S-rank hunter max HP bars, from 0 to 10')),
      },
    },
    // Gate and boss difficulty slider (1 to 10, default 5; the owner, Nov 22, QD row 8).
    // Three same-rank hunters win about 95% at 1, 75% at 5, and 5% at 10 against one same-rank boss.
    difficulty: {
      default: of(5, DIFFICULTY_LEVEL),
      // Share of combined factor `k` placed on max HP (`hp = k^hpExponent`, `dealt = k^(1 - hpExponent)`).
      // Equal split (0.5) stretched boss fights to 11 to 13.5 rounds. At 0.35, fights stay around 8 to 11 rounds.
      hpExponent: of(0.35, DIFFICULTY_SPLIT),
      // Displayed three-hunter expected win chance (%) for levels 1..10. Straight lines between anchors (1=95, 5=75, 10=5).
      targets: each([95, 90, 85, 80, 75, 61, 47, 33, 19, 5], DIFFICULTY_WIN_PCT),
      // Combined difficulty factor `k` for `kind === 'boss'` at levels 1..10 (calibrated at Rank C, scaled per rank by `rankScale`).
      boss: each([2.55, 2.71, 2.88, 2.93, 2.97, 3.09, 3.22, 3.38, 3.88, 4.91], DIFFICULTY_FACTOR),
      // Combined difficulty factor `k` for non-boss monsters (`normal`, `elite`) and `mythic` bosses in a gate.
      // Centered at 1.0 at default level 5 so balanced packs and mythic odds (5 to 10%) stay untouched by default.
      pack: each([0.72, 0.79, 0.86, 0.93, 1.00, 1.15, 1.32, 1.52, 1.75, 2.05], DIFFICULTY_FACTOR),
      // Per-rank multiplier on `boss[level - 1]` so all six ranks align on the 95/75/5% anchors.
      rankScale: {
        E: of(1.04, DIFFICULTY_FACTOR),
        D: of(0.96, DIFFICULTY_FACTOR),
        C: of(1.00, DIFFICULTY_FACTOR),
        B: of(0.96, DIFFICULTY_FACTOR),
        A: of(0.84, DIFFICULTY_FACTOR),
        S: of(0.85, DIFFICULTY_FACTOR),
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
/** Base price anchor for `rank` in gold: read by item prices, Resurrection Crystals, revive debt, and shop borrowing. */
export const priceBaseOf = (R: Pick<Rules, 'priceBase'>, rank: Rank): number => R.priceBase[rank];
/**
 * Midpoint of `rank`'s world-gate clear gold roll (`RULES.loot[rank].gold`), what one hunter takes on average from
 * clearing a world gate of that rank in a standard party (`gateParty`). Used for gate payout math, not item prices.
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
export function rankForLevel(R: Pick<Rules, 'rankLevels'>, level: number): Rank {
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
  'tenacity', 'potency', 'threat', 'hold', 'costCut', 'drain', 'haste', 'healPower', 'shieldDrain'] as const satisfies readonly (StatKey | SheetNumber)[];
export type BonusKey = (typeof BONUS_KEYS)[number];
/**
 * What a point of each bonus key adds to its number. A bonus is a whole number, so a point on a share or a multiplier
 * (crit size 1.5 to 2, the threat multiplier, the channel's hold, the cost cut, lifesteal, heal and shield power, damage
 * to shield) is a hundredth of it (derive.ts); every other key adds whole points. Ability haste is whole points, as in
 * League of Legends. A table of every key, so a new key must say which (the typecheck asks).
 */
const BONUS_STEP: { readonly [K in BonusKey]: 'whole' | 'hundredth' } = {
  str: 'whole', agi: 'whole', vit: 'whole', pow: 'whole', ins: 'whole', pre: 'whole', ctl: 'whole', dis: 'whole',
  hpMax: 'whole', manaMax: 'whole', fatigueMax: 'whole', carry: 'whole', speed: 'whole', move: 'whole',
  armorPen: 'whole', resistPen: 'whole', armorPenFlat: 'whole', resistPenFlat: 'whole', react: 'whole', aim: 'whole', will: 'whole',
  critFaces: 'whole', critSize: 'hundredth', opening: 'whole', tenacity: 'whole', potency: 'whole', threat: 'hundredth',
  hold: 'hundredth', costCut: 'hundredth', drain: 'hundredth', haste: 'whole', healPower: 'hundredth', shieldDrain: 'hundredth',
};
/** The bonus keys a point of which is a hundredth of their number (`BONUS_STEP`). */
export const BONUS_HUNDREDTHS: readonly BonusKey[] = BONUS_KEYS.filter(k => BONUS_STEP[k] === 'hundredth');
export type Perk = Partial<Record<BonusKey, number>>;
export type Path = { name: string; alloc: Partial<Record<StatKey, number>>; tiers: Perk[][] };
/**
 * The short words for each bonus key, read after a signed number ("+5 Lethality"). A screen that says "Max HP"
 * overrides hpMax and manaMax itself. A key read in hundredths says so with its %.
 */
export const BONUS_LABELS: Readonly<Record<BonusKey, string>> = {
  ...STAT_SHORT, hpMax: 'HP', manaMax: 'Mana', fatigueMax: 'Fatigue capacity', carry: 'Carry capacity', speed: 'Speed', move: 'Move',
  armorPen: '% Armor penetration', resistPen: '% Magic penetration',
  armorPenFlat: 'Flat armor penetration', resistPenFlat: 'Flat magic penetration', react: 'Reaction', aim: 'Accuracy', will: 'Will', critFaces: 'Crit range (+)',
  critSize: '% Crit multiplier', opening: 'Opening', tenacity: 'Tenacity', potency: 'Potency', threat: '% Threat', hold: '% Channel break threshold', costCut: '% Ability cost reduction',
  drain: '% Lifesteal', haste: 'Ability haste', healPower: '% Heal and shield power', shieldDrain: '% Damage to shield',
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
/** The save with the GM's trading switch (`trade.on`) set to `on`, the other overrides kept: the switch in the GM view's Trades section (trade.js). */
export const tradeRuleSet = <S extends { readonly rulesOverrides: unknown }>(save: S, on: boolean): S => {
  const ov = recOf(save.rulesOverrides);
  return { ...save, rulesOverrides: { ...ov, trade: { ...recOf(ov.trade), on } } };
};
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
