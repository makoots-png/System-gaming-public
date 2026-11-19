// rules.ts: every number from PROGRAM §D lives here. GM overrides (a save's rulesOverrides) are deep-merged by rulesOf(),
// and the GM's statuses (a save's library.statuses) are laid over the built-in ones.
import { BUILT_IN_STATUSES } from './registry/statuses.ts';
import { BUILT_IN_PATHS } from './registry/paths.ts';
import { STAT_KEYS, STAT_SHORT } from './stats.ts';
import type { StatKey } from './stats.ts';
import type { StatusDef } from './combat/effect-ops.ts';
import type { Rewards } from './rewards.ts';

/** What the daily quest gives, typed as a reward so a GM's override of its items, skills or title is one (overrides.ts). */
const DAILY_REWARDS: Rewards = { xp: 25, points: 1, gold: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] };

const deepFreeze = <T>(o: T): T => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o as object).forEach(deepFreeze); } return o; };

export const RANKS = ['E', 'D', 'C', 'B', 'A', 'S'] as const;
export type Rank = (typeof RANKS)[number];

export const RULES = deepFreeze({
  xpPerLevel: 100, pointsPerLevel: 3, dailyRewardPoints: 1, streakBonusEvery: 7, levelUpRestore: true,
  rankLevels: { E: 1, D: 10, C: 20, B: 35, A: 50, S: 70 },
  rankBonus: { E: 2, D: 3, C: 4, B: 5, A: 6, S: 8 },
  rankColors: { E: '#9fb6c9', D: '#59e6a8', C: '#4dd8ff', B: '#4d8cff', A: '#c79bff', S: '#ffc94d' },
  // A check's DC (easy, medium, hard), a normal monster's XP and the days a gate of the rank stays open. A monster's HP,
  // armor and attacks come from `fight.kinds` and its archetype (src/core/hunter/derive.ts `monsterSheet`).
  rankTable: {
    E: { dc: [10, 13, 16], xp: 25, breakDays: 7 },
    D: { dc: [14, 17, 20], xp: 75, breakDays: 6 },
    C: { dc: [20, 24, 28], xp: 250, breakDays: 5 },
    B: { dc: [27, 31, 35], xp: 800, breakDays: 4 },
    A: { dc: [35, 40, 45], xp: 2500, breakDays: 3 },
    S: { dc: [45, 50, 55], xp: 8000, breakDays: 2 },
  },
  xpSplit: false,
  fatigue: { penaltyAt: 50, penalty: 2, disAt: 80, collapseAt: 100 },
  rest: { short: { hpPct: 25, mpPct: 50, fatigue: 25 }, long: { hpPct: 100, mpPct: 100, fatigue: 100 } },
  penaltyCheck: 2,
  dailyTemplate: {
    title: 'Strength Training', desc: 'Finish the daily training before the day resets.', recover: true,
    objectives: [
      { label: 'Push-ups', target: 100, progress: 0 }, { label: 'Sit-ups', target: 100, progress: 0 },
      { label: 'Squats', target: 100, progress: 0 }, { label: 'Running (km)', target: 10, progress: 0 },
    ],
    rewards: DAILY_REWARDS,
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
  rarities: {
    common: { color: '#9fb6c9', mult: 1 }, uncommon: { color: '#59e6a8', mult: 2 }, rare: { color: '#4dd8ff', mult: 5 },
    epic: { color: '#c79bff', mult: 15 }, legendary: { color: '#ffc94d', mult: 50 }, mythic: { color: '#ff6b3d', mult: 200 },
  },
  baseValue: 10,
  slots: ['weapon', 'offhand', 'head', 'chest', 'hands', 'legs', 'feet', 'neck', 'ring1', 'ring2'],
  loot: {
    E: { gold: [50, 150], weights: { common: 70, uncommon: 25, rare: 5 } },
    D: { gold: [150, 500], weights: { common: 50, uncommon: 35, rare: 13, epic: 2 } },
    C: { gold: [500, 2000], weights: { common: 30, uncommon: 40, rare: 25, epic: 5 } },
    B: { gold: [2000, 8000], weights: { uncommon: 30, rare: 45, epic: 22, legendary: 3 } },
    A: { gold: [8000, 30000], weights: { rare: 40, epic: 45, legendary: 14, mythic: 1 } },
    S: { gold: [30000, 120000], weights: { epic: 50, legendary: 42, mythic: 8 } },
  },
  shadow: { maxAttempts: 3, dcBase: 10, dcPerRank: 3, bossDc: 5, dcMin: 5, summonMp: { E: 1, D: 2, C: 4, B: 8, A: 16, S: 32 } },
  gateSpawn: { rank: { E: 40, D: 30, C: 15, B: 9, A: 5, S: 1 }, type: { normal: 85, red: 10, double: 5 }, redDcBonus: 3, regulars: { E: [1, 3] } }, // regulars: [min, max] pack size for a rank; ranks not listed spawn 2-6
  gateNames: ['Goblin Warren', 'Crimson Cavern', 'Frost Hollow', 'Sunken Temple', 'Ant Nest', 'Iron Fortress',
    'Whispering Catacombs', 'Ashen Spire', 'Moonlit Marsh', 'Double Dungeon', 'Demon Castle', 'Giant\'s Vault'],
  // maxDice: the owner was told a term rolls up to 100 dice (Roll20's own cap is higher); the exact mean of the worst keep
  // term this allows (100d1000!kh50) costs under a second, once, when a GM types it. maxSides: a d1000 is the largest die named.
  dice: { maxDice: 100, maxSides: 1000 },
  logCap: 200, rollCap: 50, backupCap: 8, loadoutCap: 6,
  // A hunter's personal gates, the System's (notes-2-solo.md section 7 has each number's reason): on, a spawn every
  // `hours`, at most `held` open at once (stays / hours, so a once-a-day player loses none), each open `stays` hours; a
  // spawn's rank one below, at, or one above the hunter's by `ranks` (percent), its pack `pack` normal monsters of that
  // rank from the built-in seeds, no boss. The pack was 1 to 3 until measured: two same-rank normals already kill a
  // level 1 pregen in about 40% of plays, so 2 is the hard gate and 3 is the party's (notes-2-solo.md section 16).
  solo: { personal: true, hours: 8, held: 3, stays: 24, ranks: { below: 25, same: 60, above: 15 }, pack: [1, 2] },
  // feats (hunter/feats.ts): `on` is the GM's one switch for every feat the System notices; the room's `rules` doc carries it to the players
  feats: { on: true },
  build: { enabled: true, playerPick: true, respecGold: 5 }, // respecGold: a player's own respec costs respecGold * level * level gold (GM mode is free)
  paths: BUILT_IN_PATHS, // the build paths and their perks: src/core/registry/paths.ts
  // The reworked fight's numbers (docs/agent-handoff/rw/design.md; scripts/rw-paper.ts prints the tables they make).
  // src/core/stats.ts, src/core/hunter/derive.ts, combat/timeline.ts and combat/space.ts read them. Each comment is the reason.
  fight: {
    // Time (design 1.2)
    round: 1000, // ticks in a round, the time a speed-100 combatant needs for one standard action; 1000 keeps rounding under 0.1%
    cost: { quick: 70, standard: 100, heavy: 150 }, // hundredths of a standard action: two quick actions cost more than one standard, a heavy one half a turn more
    moveCost: 100 / 6, // one tile walked: six tiles cost a standard action, so everyone walks `move` tiles a round
    // A dash (design 4.6) runs the whole `move` in one straight line, twice a stride, for `dashTime` hundredths of a
    // standard action (the lead's standard action) and twice a strike's fatigue: a charge is how a heavy fighter closes
    // on an archer, and it costs breath. A walk already covers 6 tiles in a standard action's time at any speed, so at
    // 100 a dash is quicker than walking only for a body over speed 100 (sim-log.md, round three).
    dashTime: 100, dashFatigue: 16,
    speedMin: 40, speedMax: 250, // at 40 a combatant still acts every 2.5 rounds, at 250 it acts 2.5 times a round
    // Stats (design 2.1)
    statBase: 10, // every stat starts at 10
    creationPoints: 12, // free points at level 1, four levels' worth: enough for a main stat of 20 so an E build is a build
    mainShare: 2 / 3, // a built body (a monster, a shadow, a starter, the sim's builds) puts two points in its main stat for one in its second
    effExp: 0.8, // eff(s) = base * (s / base) ^ 0.8: doubling a stat gives 1.74 times, an S main stat is worth 9.8 base ones
    half: 40, // every capped curve reaches half its cap at 40 effective points; a C main stat has 34
    // The Sheet (design 2.2)
    growthDiv: 24, // g(level) = 1 + (level - 1) / 24: level carries most HP, so a fight is a similar number of hits at every rank
    // hpMax = g * 45 * (1 + capped(x(vit), 0.9)): Vitality's share of HP is a share like every other, on the capped curve
    // with Agility's cap on speed (90%), so a tank's toughness and a speed build's turns grow with rank at the same rate:
    // 1.14 times at E, 1.41 at C, 1.62 at S, never 1.9. It was 45 + 0.5 * x(vit), uncapped: a tank 1.09 times as tough as
    // a speed build at E and 1.98 at S, which flipped tank against speed from 0.10 at C to 1.00 at S (sim-log.md, round two).
    hpBase: 45, hpVitCap: 0.9,
    manaBase: 10, manaCap: 30, // mana counts big casts a dungeon, so it does not grow with rank: an S cannon has 31, three casts
    fatigueBase: 100, fatigueCap: 50, // today's 0 to 100 bar; Vitality makes a body last longer, not hit harder
    carryBase: 20, carryCap: 50, // weight is what Strength lets you wear
    freeLoad: 0.5, loadSlow: 0.35, // free up to half the carry, then up to 35% slower at full carry: a heavy kit on a weak body costs a third of its turns
    // Strength lifts weight but does not shrink plate: weight over a base body's whole carry (`carryBase`, 20) is bulk, and
    // slows any wearer 2.5% a point, at most `loadSlow`. Only plate (32) has bulk: 12 points, 30% slower, so a tank runs
    // at 70 at C and at S alike (an S tank's Strength had lifted its load to 87, and it beat an S speed build in every
    // duel; sim-log.md, round four). The medium kit (18) and the light (8) have none.
    bulkSlow: 0.025,
    speedBase: 100, speedCap: 90, // Agility alone takes a body to at most 190 before load
    moveBase: 6, // tiles a round at speed 100: 30 feet, the pace the old text assumes
    strideShare: 0.5, // one move command walks at most half of `move`, so a turn is never one long walk
    armorVitCap: 30, // gear carries most armor, so the tank pays weight for it; Vitality gives a little to every body
    resistDisCap: 40, // the magical twin of armor, from the will stat, so the tank in plate is open to magic
    penCap: 0.4, // Control finds the gap, and armor still stops 60% of what it would against the best caster
    powerK: 0.6, // phys, mag and sup are 0.6 * eff of their stat: uncapped, so damage keeps growing with rank
    critFacesCap: 5, // a crit is 5% to 30% of uses, never the 1 in 3 where it becomes the expected hit
    critSizeBase: 1.5, critSizeCap: 0.5, // a crit is 1.5 to 2 times: felt, and never more than today's double dice
    openK: 0.25, openCap: 6, // Instinct's opening bonus on the d20, capped at 6 so the die still decides 70% of the opening
    tenacityCap: 60, // control lasts duration * (100 + potency) / (100 + tenacity): at most 37% shorter
    potencyCap: 50, // mirrors tenacity, so equal investment cancels
    threatCap: 1, // a Presence build draws up to twice the threat for the same damage
    holdBase: 0.15, holdCap: 0.25, // a single hit of hold * hpMax breaks a channel: a status tick never does, one real attack does
    costCutCap: 0.25, // Control lowers costs, at most a quarter off
    shadowPerEff: 0.2, // shadow capacity = floor(0.2 * eff(pre)): 2 at base, 19 for an S Presence build
    // Kits (design 2.3): weight on the armour slots, the offhand and the weapon
    kits: {
      light: { weight: 8, armor: 10, resist: 15 }, // never slows anyone (8 is under half the smallest carry); robes carry a little resist
      medium: { weight: 18, armor: 30, resist: 5 }, // free from Strength 33, 28% slower on Strength 10
      // Takes 37% off physical damage and as much off magic, and costs any body at least 30% of its speed (its bulk). Plate
      // stops a bolt as it stops a blade: the cannon beats the tank on tempo (it acts 1.4 times as often as a tank in plate),
      // Power and penetration, not because plate lets magic through. At resist 20 the cannon won 0.95 of duels at E, 0.97
      // at C and 0.98 at S; resist alone could not bring them in below 80, because the tank's turns decide the duel
      // (sim-log.md, round four). It was 0 until round two.
      heavy: { weight: 32, armor: 60, resist: 60 },
    },
    // Monster kinds (design 2.4, 4.2 and 4.3): factors on max HP and power, the stagger bar in same-rank hits (0 is no
    // bar), and the factor on a control status's duration. A normal monster is a weaker body, so three hunters beat a
    // pack of three. A boss has 3.2 bodies of HP with one turn: at 4 the S party needed 9.8 rounds (the simulation,
    // docs/agent-handoff/rw/sim-log.md), past the 8 a boss fight may last, because the tank spends its turns taunting.
    // `xp` is the factor on the rank's XP (`rankTable`), as the old boss (3) and elite (1.5) rules gave it.
    kinds: {
      normal: { hp: 0.6, power: 0.7, stagger: 0, control: 1, xp: 1 },
      elite: { hp: 1.5, power: 1, stagger: 2.5, control: 0.75, xp: 1.5 },
      boss: { hp: 3.2, power: 1.2, stagger: 4, control: 0.5, xp: 3 },
    },
    // Defence (design 3.1 rule 12)
    armorK: 100, // dealt = raw * 100 / (100 + def): 60 armor takes 37% off, and no amount of armor makes a body immune
    // The flat part of armor or resist: 3% of what is left after penetration comes off every hit before the percentage,
    // so a weak hit loses more than a strong one (the mirror of penetration's flat part). A C tank's 74 takes 2.2 off a
    // speed build's 14-point shot (15%) and off a bruiser's 30-point strike (7%). At 0 tank against speed at C was 0.49 of
    // duels (sim-log.md, round two); at 0.03 it is 0.80; at 0.06 it is 1.00, as a duel is near all or nothing.
    armorFlat: 0.03,
    // Reaction (design 3.1 rules 8 and 9, 3.2)
    reactK: 0.25, reactCap: 6, // edge = round(0.25 * (react - aim)), at most 6 either way, so the d20 always decides
    // Reaction = 10 + x(ins) + reactAgi * x(agi): noticing the blow is Instinct, getting the body moving is Agility (the owner's
    // notes give Agility "speed and dodge"), and each counts once, the weight Instinct already had. Reaction is compared
    // with Accuracy, which is eff(ctl) uncapped, so it stays on the same curve; the edge's cap of 6 bounds it. With
    // Instinct alone a speed build had Reaction 10 and the cannon's Control cancelled its dodge: speed beat the cannon
    // 0.30 of duels at C (sim-log.md, round three).
    reactAgi: 1,
    // A use with no travel is resisted on d20 + will edge of 12 or more, or a 20: 45% at equal Will and Accuracy, and 15%
    // to 75% at the edge's cap of 6 either way, so the die decides even against a caster's best Control, as it does for a
    // dodge. At 15 a C cannon's Control (edge -4) left its curse resisted 10% of the time and an S one's 5%, a natural 20
    // alone, and speed beat the cannon in 0.51 of duels at C once it cast Arc Bolt. At 11 (a coin flip at parity) the S
    // boss resisted enough of the cannon's bolts to last past 8 rounds (sim-log.md, round four).
    resistDc: 12,
    resistedShare: 0.5, // a resisted use deals half and applies no status
    ringShare: 0.5, // the default share of damage in an area's outer ring
    // Ability kinds (design 3.3): the numbers each kind fills in when the maker starts one. A wind-up is ticks before the
    // ability lands, `travel` tiles a round after it, a range and a radius in tiles, fatigue and mana what one use costs,
    // a cooldown in ticks. src/core/registry/ability-kinds.ts holds each kind's shape and reads these.
    abilityKinds: {
      // A swing is over before a body can step out of reach: a wind-up of 0.1 round, and even a d20 of 20 moves 0 tiles (table 3.A).
      strike: { windup: 100, range: 1, fatigue: 8, mana: 0, cooldown: 0 },
      // An arrow is dodged by a fast body about half the time and a normal one a fifth: 0.1 round, then 80 tiles a round (table 3.B).
      shot: { windup: 100, travel: 80, range: 12, fatigue: 6, mana: 0, cooldown: 0 },
      // A blast is a telegraph a fast body leaves and a slow one does not: a full round, nothing after it (table 3.C). At
      // 0.6 round the C speed build was out of it a quarter of the time and lost to the cannon (sim-log.md, round three);
      // at 1 round, with Reaction from Agility, it is out 85% and a C tank 10%. A radius of 2 with a ring to 3 is a
      // 7-tile-wide area; 10 mana is a major cast, so a cannon's 20 to 31 mana is 2 or 3 a dungeon.
      blast: { windup: 1000, radius: 2, ring: 3, range: 10, fatigue: 0, mana: 10, cooldown: 0 },
      // Nothing travels, so there is no wind-up: the target's Will resists it instead. Range 8, the gap between the default lines.
      curse: { range: 8, fatigue: 8, mana: 0, cooldown: 0 },
      // An ally is not avoiding it. Range 6, one round's walk at speed 100.
      support: { range: 6, fatigue: 6, mana: 0, cooldown: 0 },
    },
    // Fatigue back after a fight: a little over half a base capacity, so a body that spent it all in one fight is not fresh
    // for the next. The speed build spends about 72 in a 6-round fight: at 55 it is at 88 after two fights and at its
    // capacity in the third, and nobody is before it. At 50 it reached its capacity before the third fight in 15 dungeons
    // of 100 (sim-log.md, round three).
    fightRest: 55,
    // Channel (design 4.1)
    channelMax: 5, // charge grows one a turn and stops at 5
    channelLin: 0.5, // the maker's linear tick: base * (1 + 0.5 * charge), 3.5 times at 5, the safe choice
    channelExp: 1.45, // the maker's exponential tick: base * 1.45 ^ charge, 6.4 times at 5, nearly a same-rank boss's HP
    breakShare: 0.5, // a broken channel fires at half its charge, rounded down
    // Threat (design 4.2)
    threatDecay: 0.1, // every entry falls 10% a round, so a hunter who stops attacking fades out in about 7 rounds
    tauntBurst: 2, // a taunt adds twice the gap to the leader, the smallest rule that matters after the taunt ends
    tauntRounds: 2, // one or two of the monster's turns: enough to pull it off a dying hunter, short enough to keep taunting
    // Stagger (design 4.3)
    staggerWeak: 1.5, // a hit under a third of a same-rank hit fills 1.5 times its damage: chips help without being the way to kill
    staggerCost: 1.5, // a full bar moves the monster's next turn to now + 1.5 rounds: it misses one turn and part of another
    staggerWeakBelow: 1 / 3, // a weak hit is under a third of a same-rank hit: a status tick or a chip build's quick hit
    staggerRegrow: 0.75, // the bar's max grows 75% after each stagger, so a boss fight has one or two staggers: at 50% an S boss, about 24 same-rank hits long, filled a third bar in 3 fights of 10 (sim-log.md)
    // Shield (design 4.4)
    shieldLife: 2, // rounds: a shield buys a turn, not a fight
    // Space (design 5.1 to 5.3)
    tileFeet: 5, // 21 monster abilities already give distances in feet, and a portrait phone fits about 20 by 14 tiles
    lineGap: 8, // tiles between the two default lines: two or three turns of walking for a slow build, one for a fast one
    lineBack: 2, // rows behind the party's front line, so a reserve stands behind it; the foes' front at 10 leaves them 3 rows on a grid 14 high
    grid: { w: 20, h: 14 }, // a fight with no map: 100 by 70 feet, a room or a clearing
    // The map (design 4.7 and 5.3)
    coverShare: 0.25, // a body in cover takes a quarter less from a use that travels to it: the d20's three-quarters cover, +5 to hit, is a quarter of the die
    sight: 25, // tiles the party sees in a fog of war: the whole default arena from its corner (19 + 13 / 2 = 25 by the 5-10-5 count); a GM lowers it for a dark gate
    // Fields that move and spread (design 4.8)
    auraRadius: 2, // an aura the maker starts: a blast's radius, so an aura and a blast read with the same ruler
    fieldRadiusMax: 6, // the widest an aura or a growing field gets: 121 tiles, under half the default arena's 280, so there is somewhere to stand outside it
    fieldGrow: 1, // tiles of radius a growing field gains a round in the maker: a walker at move 6 outruns it
    spreadRange: 1, // a sickness passes by touch: a body next to its bearer, diagonals too
    spreadRangeMax: 3, // further than that it is an aura
    // Kits (docs/agent-handoff/kits/design.md sections 1.11, 3 and 8.0; `bun scripts/kits-paper.ts` prints the tables): the
    // caps every parser of the kit blocks reads, what the reducer stops at, and what the maker weighs a made thing against.
    kit: {
      stackCap: 20, // the most stacks a def may hold: twice the largest cap a sheet writes (Baangs 9, Cold's threshold 5), and two digits on a chip
      stackAdd: 3, // the most stacks one op adds or cures: Anchor's "twice as fast" is 2; a third leaves room, a fourth is a threshold in one hit
      triggers: 4, // triggers on one status def: the most any kit item needs is 2 (Osteoporosis), and each one is a line the GM reads
      triggerOps: 6, // ops in one trigger, a threshold or an end: an item's effects list is 12, half of it is a full rule
      depth: 2, // a trigger's ops raise further triggers to this depth: Parry, then Retribution's hit, then Void Knight's stack is 2
      fires: 16, // trigger firings in one command, whatever the depth: 4 triggers on 4 statuses of the user is 16
      fightUses: 10, // the most uses an "n a fight" or "n a rest" limit may have: a fight is 4 to 8 rounds, so 10 is "every turn"
      prices: 2, // extra costs on one ability: HP and a stack (Truth in Pain), or a stack and a zone (Soul Shatter)
      gates: 3, // conditions on one ability: a mode, stacks on the target and a use limit (Spirit Shackle)
      hpShare: 0.5, // an HP price of at most half the max HP: past that one use is most of a life, and a heal must pay it back
      hpShareMin: 0.01, // the smallest HP price as a share: 1%, under which a price is a rounding error
      hpFlat: 999, // the bound of every flat number the parsers read (SKILL_BOUNDS.bonus)
      tags: 3, // tags on one ability: Hwei's painting type and "ultimate" are two
      tagLength: 20, // a tag is a word the GM types: "disaster", "ultimate", "sword"
      zonesPerOwner: 3, // zones one body holds at once: Einar starts at 3 boundaries; a fourth replaces the oldest
      zoneAge: 1, // rounds a zone must stand before ending it pays its end: placing and popping in one turn would be a free blast
      summons: 2, // timed summons one body holds at once: two sprites; past that the order of turns is the summoner's alone
      summonRounds: 5, // the longest a summon stays: a fight is 4 to 8 rounds, and a summon for the whole fight is a hunter
      fieldStacks: 60, // `field(key)` reads at most this: three bodies at the cap of 20
      kills: 10, // `kills` reads at most this: a pack is 3 to 6, a long fight 10
      held: 10, // `held(key)` reads at most this many rounds: past a long fight
      hits: 16, // `hits` reads at most this many bodies: every zone's worth of a crowd
      // Wave 2 (kits design 8.1 to 8.7, kits-paper `KIT2`, table 8.1). Each bounds one block; the reason is beside it.
      shareCap: 0.5, // a use's dealt times taken share stays in 0.5 to 1.5: Brutalize's -50% healing is the sheet's largest share
      armorOp: 60, // a status moves armor or resist by at most a suit of plate's 60 (`kits.heavy`)
      critFacesMax: 6, // crit faces plus a target's exposed faces stay at most 6: design 2.2's 30%, never the 1 in 3
      critSizeMax: 2, // crit size stays at most 2: design 2.2's "never more than double the dice"
      // A cost cut stays at `costCutCap`'s 0.25: mana is the dungeon's brake on blasts (design 6). The paper's separate
      // fatigue cut of 0.5 needs a second sheet number; one cut on both is the stricter reading (notes-build-3.md).
      costCutMax: 0.25,
      rangeAdd: 3, // tiles a status adds to its bearer's ranges of 2 or more: a curse's 8 to 11, still under a shot's 12
      wardRounds: 1, // untargetable, invulnerable and safeguard last a round at most, and the first two reach a body once a fight
      boostSides: 20, // a held die is at most a d20 (Expected Outcome)
      shoveMax: 3, // tiles one push or pull moves a body: half a round's walk at move 6
      blinkMax: 8, // the longest blink: a curse's range, the gap between the default lines
      reactionsPerUse: 4, // reactions one use may set off: four targets of an area, one each
      // Parry's guard, the share a `before` reaction takes off a strike (kits table 8.10.3): the largest in steps of 0.05
      // with which no build armed with it all fight improves a duel against a striker by more than the tolerance. The
      // sheet's Parry (0.25 or 0.75 by a roll) takes about 0.5 off and lifts the speed build over the tank by 1.30 to 1.40.
      // The paper's 0.35 is the simulation's 0.30: at 0.35 the speed build armed with it beat the tank 0.08 more often at C
      // and 0.17 at S (a duel is a race, and 0.35 takes a tank's swing under a hit the speed build lives through); at
      // 0.30 it is -0.03 and -0.01, at 0.25 -0.08 and -0.13, since its quick action's time is real (sim-log.md).
      parry: 0.3,
      zoneMove: 6, // tiles one use moves a zone: a round's walk
      zoneGrow: 2, // tiles of radius one use adds to a zone, to `fieldRadiusMax`
      extraPerRound: 1, // extra actions (a refund to now) one body takes in a round of fight time: the fastest build stays under 4 turns to the tank's 1
      hideReveal: 1, // a hidden body is revealed by a foe that is up within this many tiles: adjacent
      surprise: 1, // rounds a surprised side's openings are pushed back
      doArmed: 12, // party rows whose armed reaction the room doc names: 4 hunters, 4 shadows, 4 summons
      // The maker warns past 1.08 times a pace's budget (design 3): the triangle's closest margin on paper is the cannon over
      // the tank at C, 1.081 (kits-paper table 3.1), so a made thing that adds more can flip that row by itself.
      tolerance: 0.08,
      referenceRounds: 6, // a status that lasts until removed is weighed over design 6's reference fight of 6 rounds
      // The share of a delayed end a cure takes each round it waits (worth.ts `delayedShare`): no built-in monster cures or
      // dispels, and the simulation's foes never do, so the bar counts none; a GM whose foes cleanse raises it.
      cleanse: 0,
      // A trigger is worth its ops times its event's rate a round (design 3, kits-paper table 3.3), read off a C bruiser
      // against one same-rank brute: 1 hit dealt, struck once, 0.05 crits, 0.35 kills a round. Where the table has no row
      // the rate is an upper bound, so the maker warns early rather than late: a turn's start and end, a move, a status
      // gained or ended and an ability used once a turn (1); an avoid as often as a curse is resisted at parity (0.45).
      eventRates: {
        hitDealt: 1, struck: 1, critDealt: 0.05, critTaken: 0.05, kill: 0.35, avoided: 0.45, turnStart: 1, turnEnd: 1, moved: 1,
        down: 0.17, // a body goes down once a fight: of design 6's reference fight of 6 rounds, a round's share
        statusGained: 1, statusEnded: 1, used: 1,
      },
      // The conditional scalers that replace the execute (design 8.0): the owner, Nov 14, "execute just does more dmg the lower
      // health people are". A scaler's bonus is 0 at its start and its scale at its end, linear between.
      scalers: 2, // scalers on one formula: an execute and one counterpart; a third is a formula nobody reads at a glance
      scaleCap: 1, // the most a scaler adds: double the damage, a crit's largest size (critSizeBase + critSizeCap)
      scalerStart: 0.5, // where a suggested scaler activates: half of an HP share, or two equal bodies of a pair
      scalerStep: 0.05, // the suggested scale is searched in steps of 5%, the precision a GM reads off a slider
      // A pair's bonus is whole at 4 to 1: past a same-rank boss over a paper build at C and E (2.8 to 4, kits-paper table
      // 8.0.1), so a giant slayer is near its whole against a boss and not past it.
      pairFull: 4,
      // The reference dungeon a scaler's suggestion and worth are taken over (design 8.0): at E, C and S, the rounds the
      // party of design table 6.2 takes on paper to clear a pack of three normal brutes and a boss (kits-paper table 3.2),
      // and a same-rank normal brute's and boss's max HP over the user's (table 8.0.1): the bruiser in the medium kit, whose
      // kind is the strike, and the speed or cannon build in the light kit, whose kinds are the shot, the curse and the blast.
      reference: {
        E: { pack: 3.14, boss: 5.52, medium: { normal: 0.604, boss: 3.188 }, light: { normal: 0.644, boss: 3.4 } },
        C: { pack: 3.2, boss: 5.665, medium: { normal: 0.604, boss: 3.208 }, light: { normal: 0.753, boss: 4 } },
        S: { pack: 3.8, boss: 6.76, medium: { normal: 0.599, boss: 3.198 }, light: { normal: 0.885, boss: 4.724 } },
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
        blood: { share: 0.85, burst: 1.6, base: 0.8 },
        // Hwei: Disaster Stroke at 0.75 adds a mark; two burst for 0.82 bolts on every foe within 2
        mark: { share: 0.75, burst: 0.82 },
        // Einar: Violence spends all Pain, 6% more a Pain, used at 5
        pain: { perStack: 0.06, spendAt: 5 },
        // Glas: Hemoplague, under Crimson Pact, ends 3 rounds later for 1.4 curses: design 3's number for it. No simulation
        // build plays the Pact yet (notes-worth.md); the bar weighs it at 0.50 SA at C, inside its budget with the Pact's
        // credit. It was 0.6 while worth.ts weighed a curse with no formula against a physical one.
        hemo: { end: 1.4 },
      },
    },
  },
});

/** The shipped rules, with every number and string widened: a GM override can change any of them. */
export type Rules = typeof RULES;
/**
 * The bounds of a GM's override of `RULES.solo` (overrides.ts reads them): a week between spawns or open at most, ten
 * gates held (the sheet push's bound, protocol.ts), a pack of at most 12 (a lone hunter against more is no run, and a
 * line of the roster holds at most 26 copies).
 */
export const SOLO_BOUNDS = { hours: 168, held: 10, pack: 12 } as const;
/** The reworked fight's numbers. */
export type FightRules = Rules['fight'];

export const TIERS = Object.keys(RULES.rarities);

// ── rulesOf(): RULES deep-merged with a save's rulesOverrides. Pure: the edge passes the overrides in. ──
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
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
  const R: Rules = isObj(ov) && Object.keys(ov).length ? merge<Rules>(RULES, ov) : RULES;
  return Object.keys(statuses).length ? { ...R, conditions: { ...R.conditions, ...statuses } } : R;
}

// ── helpers. Each takes the rules as its first argument; src/edge/rules.ts binds them to the current rules for views. ──
export const xpToNext = (R: Rules, level: number): number => R.xpPerLevel * Math.max(1, level);
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
/** What a perk, a title or a passive adds: points on a stat, max HP or max mana (derive.ts `Bonus` reads them). */
export const PERK_KEYS = [...STAT_KEYS, 'hpMax', 'manaMax'] as const;
export type PerkKey = (typeof PERK_KEYS)[number];
export type Perk = Partial<Record<PerkKey, number>>;
export type Path = { name: string; alloc: Partial<Record<StatKey, number>>; tiers: Perk[][] };
/** The short word for each bonus key. A screen that says "Max HP" overrides hpMax and manaMax itself. */
export const PERK_LABELS: Readonly<Record<PerkKey, string>> = { ...STAT_SHORT, hpMax: 'HP', manaMax: 'Mana' };
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
    for (const k of PERK_KEYS) { const v = b[k]; if (Number.isFinite(v) && v) out[k] = (out[k] || 0) + Math.trunc(v as number); }
  }
  return { p, out, n };
}

// ── cosmetic registries (not game rules, so not in RULES / rulesOverrides). Emblems are 24x24 SVG paths: no image files. ──
export const EMBLEMS = {
  star: 'M12 2l3 7h7l-5.5 4.5 2 7.5L12 17l-6.5 4 2-7.5L2 9h7z', crown: 'M3 19h18l-1-11-5 4-3-7-3 7-5-4z', moon: 'M15 3a9 9 0 1 0 6 15A7 7 0 0 1 15 3z',
  flame: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z', shield: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z',
  blade: 'M19 2l3 3-12 12-3-3zM6 15l3 3-3 3-3-3z', eye: 'M2 12c3-5 7-7 10-7s7 2 10 7c-3 5-7 7-10 7S5 17 2 12zm10-4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z', skull: 'M12 2a8 8 0 0 0-8 8c0 3 1.5 5 3 6v4h10v-4c1.5-1 3-3 3-6a8 8 0 0 0-8-8zM9 9a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  wing: 'M2 6c6 0 10 3 10 9v6c-2-3-5-4-10-4 3-1 5-2 6-3-3 0-5-1-6-3 3 0 5 0 6-1-3-1-5-2-6-4z', diamond: 'M12 2l9 10-9 10-9-10z', fang: 'M4 3h16l-3 8-5 11-5-11z',
};
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
