// Worst-case parsed fixtures for maker and editor round-trip tests. Every optional field is populated and validated
// through its real core parser so any field silently dropped by a maker or editor fails equality immediately.
import { RULES } from '../../src/core/rules.ts';
import { parseFormula } from '../../src/core/formula.ts';
import { abilityId } from '../../src/core/combat/ability-types.ts';
import { statusKey } from '../../src/core/combat/effect-ops.ts';
import { parseStatusDef } from '../../src/core/combat/fight-parse.ts';
import { percent, tiles } from '../../src/core/combat/space.ts';
import { cost, tick } from '../../src/core/combat/timeline.ts';
import { abilityOf } from '../../src/core/registry/ability-kinds.ts';
import { RECIPE_ITEMS, itemOf, parseItem } from '../../src/core/registry/items.ts';
import { parseBattleMap } from '../../src/core/registry/maps.ts';
import { parseMonster } from '../../src/core/registry/monsters.ts';
import { parseSkill } from '../../src/core/registry/skills.ts';
import { parseFeat } from '../../src/core/hunter/feats.ts';
import { parseGuild } from '../../src/core/hunter/guild.ts';
import { questOf } from '../../src/core/hunter/quests.ts';
import { parseStory } from '../../src/core/story/story.ts';
import { parseGate } from '../../src/core/gates/gate.ts';
import { parseClearPreset } from '../../src/core/gates/preset.ts';
import { parseBundle, parseRewards, REWARD_BOUNDS } from '../../src/core/rewards.ts';
import { parseOverrides } from '../../src/core/overrides.ts';
import { parseSaveId, presetLineId, saveId } from '../../src/core/ids.ts';
import { withinSize } from '../../src/core/size.ts';
import type { Formula } from '../../src/core/formula.ts';
import type { StatusDef } from '../../src/core/combat/effect-ops.ts';
import type { Item, Monster, Skill } from '../../src/core/save.ts';
import type { RewardBundle } from '../../src/core/rewards.ts';
import type { BattleMap } from '../../src/core/registry/maps.ts';
import type { FeatDef } from '../../src/core/hunter/feats.ts';
import type { Story } from '../../src/core/story/story.ts';
import type { Quest } from '../../src/core/save.ts';
import type { Gate } from '../../src/core/gates/gate.ts';
import type { ClearPreset } from '../../src/core/gates/preset.ts';
import type { GuildMembership } from '../../src/core/hunter/guild.ts';

function mustFormula(text: string): Formula {
  const r = parseFormula(text, RULES);
  if ('error' in r) throw new Error(`bad fixture formula "${text}": ${r.error}`);
  return r.formula;
}

function must<T>(v: T | null | undefined, label: string): T {
  if (v === null || v === undefined) throw new Error(`fixture failed parser: ${label}`);
  return v;
}

const ROUND = RULES.fight.round;

// ── 1. Statuses (split into two defs to stay well inside THING_MAX.status = 5,120 bytes) ──
export const WORST_STATUS_OPS: StatusDef = must(parseStatusDef({
  label: 'Crimson Eclipse Mark',
  desc: 'Full op matrix with color and icon.',
  color: '#ff4d5e',
  icon: 'flame',
  ops: [
    { op: 'damage', type: 'arcane', amount: [mustFormula('1d4'), mustFormula('1d6'), mustFormula('2d6'), mustFormula('2d8'), mustFormula('3d8'), mustFormula('4d10')] },
    { op: 'speed', pct: [-10, -15, -20, -25, -30, -40] },
    { op: 'stat', key: 'str', amount: mustFormula('2 + 0.05 * vit') },
    { op: 'sheet', key: 'armor', amount: mustFormula('0.02 * hpmax') },
    { op: 'share', on: 'dealt', pct: 15 },
    { op: 'edge', side: 'attack', keep: 'better', tag: 'blade', spend: true },
    { op: 'boost', side: 'defend', die: { kind: 'die', sides: 6 } },
    { op: 'hidden', level: 2, start: 'anywhere', ends: { hurt: true, revealed: false, dealt: true } },
    { op: 'stayHidden', on: 'dealt' },
    { op: 'aura', radius: 3, on: 'foes' },
    { op: 'spread', range: 2 },
    { op: 'safeguard' },
  ],
}, RULES), 'WORST_STATUS_OPS');

export const WORST_STATUS_KITS: StatusDef = must(parseStatusDef({
  label: 'Uncolored Mark With A Forty Five Char Label X',
  desc: 'K'.repeat(260),
  ops: [{ op: 'note', text: 'Escalates on stacks and triggers.' }],
  stack: {
    cap: 6,
    leave: { kind: 'event', event: 'struck' },
    keep: 'sheet',
    threshold: {
      at: { kind: 'formula', formula: mustFormula('3 + 0.1 * vit') },
      to: { kind: 'most', of: 'hp', radius: tiles(4), on: 'foes' },
      ops: [{ op: 'damage', type: 'arcane', amount: mustFormula('2d6') }],
      then: 'keep',
    },
  },
  triggers: [
    {
      on: 'hitDealt',
      tag: 'blade',
      to: 'other',
      limit: { kind: 'fight', n: 3 },
      need: { kind: 'holds', key: statusKey('hasted') },
      ops: [{ op: 'stagger', share: 0.25 }],
    },
    {
      on: 'down',
      to: { kind: 'most', of: 'hp', radius: tiles(8), on: 'allies' },
      limit: { kind: 'each' },
      ops: [{ op: 'heal', amount: mustFormula('10') }],
    },
  ],
  end: {
    cleanse: 'land',
    ops: [{ op: 'shield', amount: mustFormula('15') }],
  },
}, RULES), 'WORST_STATUS_KITS');

// ── 2. Items ──
export const WORST_ITEM_BULWARK: Item = {
  ...itemOf(RULES, RECIPE_ITEMS.find(i => i.name === 'Bulwark Ring')!),
  id: saveId('i', 910),
};

export const WORST_ITEM_WORN: Item = {
  ...must(parseItem({
    name: 'Eclipse Halberd',
    rar: 'epic',
    grade: -1,
    type: 'weapon',
    slot: 'weapon',
    qty: 1,
    value: 4250,
    dice: '2d8',
    attack: 'shot',
    twoHanded: true,
    weight: 7,
    armor: 4,
    resist: 6,
    bonus: { str: 12, agi: -3, hpMax: 80, critChance: 4 },
    desc: 'Worn weapon with custom worn status and distinct active ability.',
    icon: 'sword',
    tell: true,
    worn: {
      label: 'Halberd Stance',
      desc: 'Sharpens strikes while equipped.',
      color: '#ffc94d',
      icon: 'shield',
      ops: [{ op: 'sheet', key: 'armor', amount: mustFormula('0.015 * hpmax') }],
      triggers: [{
        on: 'kill',
        tag: null,
        to: 'self',
        limit: { kind: 'round' },
        ops: [{ op: 'heal', amount: mustFormula('8') }],
      }],
    },
    active: {
      ...abilityOf('support', {
        id: abilityId('ab-halberd'),
        name: 'Lunar Ward',
        aim: 'self',
        shape: { kind: 'self' },
        range: tiles(0),
        delivery: { kind: 'sure' },
        cost: { fatigue: 4, mana: 6, time: cost(RULES.fight.cost.quick), cooldown: tick(3 * ROUND) },
        effect: { type: 'shield', by: 'hand', formula: mustFormula('12 + 0.05 * hpmax') },
        ops: [{ op: 'dispel', which: 'first' }],
      }, RULES),
      tags: ['ward'],
    },
  }), 'WORST_ITEM_WORN'),
  id: saveId('i', 911),
};

export const WORST_ITEM_FINESSE: Item = {
  ...must(parseItem({
    name: 'Viper Stiletto',
    rar: 'rare',
    grade: 1,
    type: 'weapon',
    slot: 'weapon',
    qty: 1,
    dice: '2d8 + 0.1 * agi',
    attack: 'strike',
    finesse: true,
    bonus: { agi: 2, armorPenFlat: 3 },
    desc: 'Finesse strike weapon with a formula-based weapon damage line.',
  }), 'WORST_ITEM_FINESSE'),
  id: saveId('i', 913),
};

export const WORST_ITEM_CONSUMABLE: Item = {
  ...must(parseItem({
    name: 'Phoenix Vial',
    rar: 'rare',
    grade: 1,
    type: 'consumable',
    slot: null,
    qty: 4,
    value: 900,
    dice: '',
    bonus: {},
    desc: 'Revive tonic with rank cap and notify GM.',
    armor: 0,
    resist: 0,
    icon: 'potion',
    effects: [
      { op: 'heal', amount: mustFormula('2d8 + 10') },
      { op: 'cureStatus', key: statusKey('poisoned') },
    ],
    target: 'other',
    tell: true,
    revive: true,
    rankCap: true,
  }), 'WORST_ITEM_CONSUMABLE'),
  id: saveId('i', 912),
};

export const WORST_ITEM_TYPED_WEAPON: Item = {
  ...must(parseItem({
    name: 'Void Fang',
    rar: 'rare',
    type: 'weapon',
    slot: 'weapon',
    qty: 1,
    dice: '1d8',
    attack: 'strike',
    damageType: 'true',
    bonus: { str: 2 },
    desc: 'A blade that deals true damage directly.',
    armor: 0,
    resist: 0,
  }), 'WORST_ITEM_TYPED_WEAPON'),
  id: saveId('i', 914),
};

// ── 3. Skills ──
export const WORST_SKILL_TRUE: Skill = {
  ...must(parseSkill({
    name: 'Soul Sever',
    level: 3,
    label: 'True Cut',
    desc: 'A rule-built strike dealing true damage.',
    type: 'active',
    ability: abilityOf('strike', {
      id: abilityId('ab-soul-sever'),
      name: 'Soul Sever',
      ticks: { type: 'true', scale: 'str', pace: 'standard', gap: null, channel: null, scalers: [] },
    }, RULES),
  }), 'WORST_SKILL_TRUE'),
  id: saveId('s', 914),
};

export const WORST_SKILL_ACTIVE: Skill = {
  ...must(parseSkill({
    name: 'Starfall Domain',
    level: 7,
    label: 'Awakened',
    desc: 'Worst-case active skill with hand formula, ring, travel, channel, lasting null-duration zone, and kits.',
    type: 'active',
    ability: {
      id: abilityId('ab-starfall'),
      name: 'Starfall Domain',
      kind: 'blast',
      cost: { fatigue: 12, mana: 18, time: RULES.fight.cost.heavy, cooldown: tick(4 * ROUND) },
      aim: 'place',
      range: tiles(14),
      shape: { kind: 'radius', radius: tiles(3), ring: { outer: tiles(5), share: percent(40) } },
      delivery: { kind: 'travel', windup: tick(Math.round(0.5 * ROUND)), speed: 60 },
      foesOnly: false,
      effect: { type: 'arcane', by: 'hand', formula: mustFormula('3d8 + mag') },
      ops: [
        { op: 'shove', dir: 'away', from: 'aim', tiles: 2 },
        { op: 'stagger', share: 0.3 },
      ],
      channel: { growth: 'exponential', max: 3 },
      zone: {
        name: 'Starlight Field',
        duration: null,
        ops: [{ op: 'damage', type: 'arcane', amount: mustFormula('1d6') }],
        endsWithOwner: true,
        around: tiles(3),
        grow: { step: tiles(1), cap: tiles(6) },
        upkeep: { fatigue: 2, mana: 5 },
        end: [{ op: 'heal', amount: mustFormula('10') }],
        triggers: [{
          on: 'turnStart',
          to: 'self',
          limit: { kind: 'round' },
          ops: [{ op: 'note', text: 'Bathed in starlight' }],
        }],
      },
      prices: [{ kind: 'hp', amount: { kind: 'share', share: 0.1 } }],
      gates: [{ kind: 'uses', per: 'fight', n: 2 }],
      tags: ['cosmic', 'ultimate'],
      summon: { name: 'Star Wisp', archetype: 'caster', rounds: 3, statuses: [{ key: statusKey('hasted'), rounds: 2 }] },
      zoneAct: { act: 'shift', name: 'Starlight Field', by: 2 },
    },
  }), 'WORST_SKILL_ACTIVE'),
  id: saveId('s', 910),
};

export const WORST_SKILL_SWAP: Skill = {
  ...must(parseSkill({
    name: 'Umbral Shift',
    level: 3,
    label: 'Shadow',
    desc: 'Swap places with an allied shadow.',
    type: 'active',
    ability: {
      ...abilityOf('support', {
        id: abilityId('ab-umbral-shift'),
        name: 'Umbral Shift',
        aim: 'ally',
        range: tiles(12),
        shape: { kind: 'touch', reach: tiles(12) },
        effect: null,
        move: { kind: 'swap', only: 'shadow' },
      }, RULES),
    },
  }), 'WORST_SKILL_SWAP'),
  id: saveId('s', 913),
};

export const WORST_SKILL_REACTION: Skill = {
  ...must(parseSkill({
    name: 'Aegis Counter',
    level: 4,
    label: 'Guard',
    desc: 'Reaction skill with valid reaction ops.',
    type: 'active',
    ability: {
      ...abilityOf('support', {
        id: abilityId('ab-aegis-counter'),
        name: 'Aegis Counter',
        aim: 'ally',
        ops: [{ op: 'guard', share: 0.5 }, { op: 'negate' }],
      }, RULES),
      react: { when: 'before', reach: tiles(4) },
    },
  }), 'WORST_SKILL_REACTION'),
  id: saveId('s', 911),
};

export const WORST_SKILL_PASSIVE: Skill = {
  ...must(parseSkill({
    name: 'Monolith Body',
    level: 6,
    label: 'Tier VI',
    desc: 'Passive with bonus outside -20..50 and full worn status.',
    type: 'passive',
    bonus: { str: 120, vit: -40, hpMax: 600, manaMax: 250 },
    worn: {
      label: 'Stone Mantle',
      desc: 'Endures heavy blows.',
      color: '#4dffa0',
      icon: 'shield',
      ops: [{ op: 'share', on: 'taken', pct: -10 }],
      stack: { cap: 5, leave: { kind: 'round' }, keep: 'fight', threshold: null },
      end: { cleanse: 'cancel', ops: [{ op: 'heal', amount: mustFormula('12') }] },
    },
  }), 'WORST_SKILL_PASSIVE'),
  id: saveId('s', 912),
};

// ── 4. Monsters ──
const LOOT_SHARD = must(parseItem({
  name: 'Astral Core',
  rar: 'rare',
  type: 'material',
  qty: 2,
  value: 150,
  desc: 'Crystallized mana.',
}), 'LOOT_SHARD');

export const WORST_MONSTER_MYTHIC: Monster = {
  ...must(parseMonster({
    name: 'Trumpet Herald',
    rank: 'S',
    type: 'Angel',
    archetype: 'caster',
    kind: 'mythic',
    script: 'angel-of-the-last-trumpet',
    tweak: { hp: 2.5, stats: { pwr: 14, ins: 8 }, traits: ['tough', 'warded'] },
    abilities: [abilityOf('curse', { id: abilityId('ab-herald-note'), name: 'Choir Note' }, RULES)],
    notes: ['First omen at round 2', 'Ignores fear'],
    xp: 52000,
    extractable: false,
    desc: 'Mythic monster with named script, custom XP, stats, traits, abilities, statuses, loot, and icon.',
    statuses: [
      { key: statusKey('hasted'), rounds: 4 },
      { key: statusKey('regenerating'), rounds: null },
    ],
    loot: { gold: 1200, items: [LOOT_SHARD] },
    icon: 'skull',
  }), 'WORST_MONSTER_MYTHIC'),
  id: saveId('m', 910),
};

export const WORST_MONSTER_BOSS: Monster = {
  ...must(parseMonster({
    name: 'Ashfang Sovereign',
    rank: 'A',
    type: 'Beast',
    archetype: 'brute',
    kind: 'boss',
    tweak: { hp: 1.4, traits: ['fast', 'armored'] },
    abilities: [abilityOf('strike', { id: abilityId('ab-ash-rend'), name: 'Ash Rend' }, RULES)],
    notes: ['Leaps over cover'],
    extractable: true,
    desc: 'Extractable boss monster with default rule XP.',
    statuses: [{ key: statusKey('poisoned'), rounds: 3 }],
    loot: { gold: 450, items: [] },
    icon: 'claw',
  }), 'WORST_MONSTER_BOSS'),
  id: saveId('m', 911),
};

// ── 5 & 6. Rewards and Bundle ──
const TITLE_WORN: StatusDef = must(parseStatusDef({
  label: 'Steady Pulse',
  desc: 'Calm under pressure.',
  ops: [{ op: 'stat', key: 'dis', amount: mustFormula('2') }],
}, RULES), 'TITLE_WORN');

const TITLE_ACTIVE = abilityOf('support', {
  id: abilityId('ab-title-bastion'),
  name: 'Bastion Call',
  aim: 'self',
  shape: { kind: 'self' },
  range: tiles(0),
}, RULES);

export const WORST_REWARDS = must(parseRewards({
  xp: 1250,
  gold: 640,
  crystal: 35,
  points: 3,
  items: [LOOT_SHARD],
  title: {
    name: 'Wolf Slayer Ascendant',
    desc: 'T'.repeat(REWARD_BOUNDS.titleDesc),
    bonus: { str: 4, vit: 2 },
    key: 'wolf-slayer',
    replaces: 'Wolf Slayer',
    band: 'A',
    worn: TITLE_WORN,
    active: TITLE_ACTIVE,
  },
  job: 'Shadow Monarch',
  skills: [must(parseSkill({ name: 'Quick Step', level: 2, label: 'Swift', desc: 'Agile burst.', type: 'passive', bonus: { agi: 3 } }), 'Quick Step')],
  statuses: [
    { key: statusKey('hasted'), rounds: 5, def: RULES.conditions.hasted },
    { key: statusKey('rt-custom-st'), rounds: null, def: TITLE_WORN },
  ],
  boons: [{ name: 'Guild Favor', text: 'One free gate license from the Association.' }],
}), 'WORST_REWARDS');

export const WORST_BUNDLE: RewardBundle = {
  ...must(parseBundle({
    name: 'Sovereign Tribute',
    rewards: WORST_REWARDS,
    window: { title: 'THE SYSTEM TOOK NOTE', line: 'You held the line against the break.' },
  }), 'WORST_BUNDLE'),
  id: saveId('rb', 910),
};

// ── 7. Battle Map ──
export const WORST_MAP: BattleMap = must(parseBattleMap({
  id: saveId('mp', 910),
  name: 'Obsidian Vault',
  w: 6,
  h: 5,
  tiles: '......' + '.#c~o.' + '......' + '.~..#.' + '......',
  fog: true,
  sight: 9,
  zones: [{
    id: 'z-lava',
    name: 'Lava Rift',
    ground: { kind: 'tiles', tiles: [{ x: 1, y: 2 }, { x: 2, y: 2 }] },
    spares: 'foe',
    tier: 3,
    ops: [{ op: 'damage', type: 'arcane', amount: mustFormula('1d6') }],
    upkeep: { fatigue: 2, mana: 4 },
    end: [{ op: 'heal', amount: mustFormula('5') }],
    triggers: [{
      on: 'turnStart',
      to: 'self',
      limit: { kind: 'round' },
      ops: [{ op: 'note', text: 'Seared by the rift' }],
    }],
    laid: tick(1000),
    paid: tick(2000),
  }],
  starts: { party: [{ x: 0, y: 0 }, { x: 1, y: 0 }], foe: [{ x: 5, y: 4 }] },
}, RULES), 'WORST_MAP');

// ── 8. Feats (guarding 7e222b1e: show.at === 'feat') ──
export const WORST_FEAT_AFTER: FeatDef = must(parseFeat({
  name: 'Silent Sovereign',
  window: 'A NEW TITLE EMERGES',
  desc: 'Defeat elite beasts in a single session.',
  rule: {
    on: 'kill',
    where: [
      { field: 'mkind', op: '=', value: 'boss' },
      { field: 'rank', op: '>=', value: 'B' },
    ],
    measure: { of: 'facts' },
    within: 'session',
    reach: 3,
    also: [{ of: 'level', op: '>=', value: 5 }],
  },
  show: { at: 'feat', key: 'first-blood' },
  rewards: WORST_REWARDS,
  off: true,
}), 'WORST_FEAT_AFTER');

export const WORST_FEAT_COUNT: FeatDef = must(parseFeat({
  name: 'Gate Runner',
  window: 'GATE RUNNER',
  desc: 'Clear five gates.',
  rule: { on: 'gate', where: [], measure: { of: 'facts' }, within: 'ever', reach: 5, also: [] },
  show: { at: 'count', n: 2 },
  rewards: { xp: 100 },
}), 'WORST_FEAT_COUNT');

// ── 9. Story (guarding 4e6be3c8: chapter quest onFail + counted objectives) ──
export const WORST_STORY: Story = {
  ...must(parseStory({
    name: 'The Red Gate Incident',
    when: 'Open when the party reaches C-rank.',
    for: 'hunters',
    chapters: [
      {
        name: 'Frost Closes In',
        words: { title: 'RED GATE SEALED', line: 'The exit vanishes behind a curtain of snow.' },
        note: 'Ask who scouts the ridge first.',
        rewards: WORST_REWARDS,
        quest: {
          kind: 'urgent',
          title: 'Survive the Blizzard',
          desc: 'Endure until the boss falls.',
          objectives: [
            { label: 'Defeat ice beasts', target: 4, count: { rule: { on: 'kill', where: [{ field: 'rank', op: '>=', value: 'C' }], measure: { of: 'facts' }, within: 'ever' }, mark: '' } },
            { label: 'Keep the camp fire lit', target: 1 },
          ],
          rewards: { xp: 400, gold: 200, crystal: 12, points: 1 },
          onFail: { xp: -100, gold: -50, crystal: 0, points: 0 },
          penaltyText: 'Frostbite drains 100 XP and 50 gold.',
          dueHours: 12.5,
        },
      },
      {
        name: 'Aftermath',
        words: { title: 'THE GATE OPENS', line: 'Warm air greets the survivors.' },
        note: 'Wrap up the session.',
        rewards: { xp: 200, gold: 0, crystal: 0, points: 0 },
        quest: null,
      },
    ],
  }), 'WORST_STORY'),
  id: saveId('st', 910),
};

// ── 10. Quests ──
export const WORST_QUEST_GM: Quest = questOf({
  kind: 'urgent',
  title: 'Hold the Breach',
  desc: 'Stop the wave before the timer expires.',
  objectives: [
    { label: 'Defeat raiders', target: 6, progress: 2, count: { rule: { on: 'kill', where: [], measure: { of: 'facts' }, within: 'session' }, mark: 's2' } },
    { label: 'Seal the fissure', target: 3, progress: 1 },
  ],
  rewards: WORST_REWARDS,
  onFail: { xp: -120, gold: -60, crystal: 0, points: 0 },
  dueAt: '2029-05-10T14:25:47.321Z',
  penaltyText: 'Lose 120 XP and 60 gold.',
  from: 'gm',
  secret: true,
}, saveId('q', 910), '2029-05-10T12:00:00.000Z');

export const WORST_QUEST_SELF: Quest = questOf({
  kind: 'urgent',
  title: 'Morning Drills',
  desc: 'Personal training before noon.',
  objectives: [{ label: 'Run 10 km', target: 10, progress: 4 }],
  dueAt: '2029-05-11T09:15:33.789Z',
  from: 'self',
}, saveId('q', 911), '2029-05-10T12:00:00.000Z');

// ── 11 & 12. Gate and Clear Preset ──
export function worstPreset(hunterId: string): ClearPreset {
  return must(parseClearPreset({
    at: 'edited',
    xp: 2400,
    gold: 1850,
    crystal: 45,
    items: [
      { id: presetLineId(1), item: LOOT_SHARD, checked: true, to: { kind: 'local', hunterId: parseSaveId<'h'>(hunterId)! } },
      { id: presetLineId(2), item: LOOT_SHARD, checked: false, to: null },
    ],
  }), 'worstPreset');
}

export function worstGate(hunterId: string): Gate {
  return must(parseGate({
    id: saveId('g', 910),
    name: 'Shattered Basilica',
    rank: 'A',
    type: 'double',
    status: 'raiding',
    createdDay: 1,
    breakDay: 14,
    monsters: [
      { monsterId: WORST_MONSTER_MYTHIC.id, count: 1 },
      { monsterId: WORST_MONSTER_BOSS.id, count: 2 },
    ],
    bossId: WORST_MONSTER_BOSS.id,
    difficulty: { gate: { at: 'set', level: 4 }, boss: { at: 'own', level: 5 } },
    mapId: WORST_MAP.id,
    notes: 'Second chamber unlocks after the first boss falls.',
    solo: true,
    fought: [hunterId],
    xpPaid: 300,
    preset: worstPreset(hunterId),
  }), 'worstGate');
}

// ── 13. Guild ──
export const WORST_GUILD: GuildMembership = must(parseGuild({
  archetype: 'ninth-hour',
  standing: 'ace',
  name: 'Ashfall Vanguard',
  goldCut: 0.1234,
  crystalShare: 0.3765,
}, RULES), 'WORST_GUILD');

// ── 14. Identity ──
export const WORST_IDENTITY = { emblem: 'wolf', color: '#c79bff' } as const;

// ── 15. Rules overrides and Roll tables ──
export const WORST_OVERRIDES = parseOverrides({
  pointsPerLevel: 5,
  fight: { round: 1200, sight: 14, damageTypes: { 'arc-bolt': 'true', 'attack-unarmed': 'arcane' } },
  feats: { on: false },
}).overrides;

export const WORST_ROLL_TABLES = {
  urgent: ['Red Portal Surge | Hold the gate entrance | 350', 'Hidden Dungeon | Find the false wall | 500'],
  encounterB: ['2x Gate Troll + 1x Demon Knight', '1x Vulcan + 3x Ice Elf'],
} as const;

// Sanity check: our status and item fixtures fit their size limits.
if (!withinSize('status', WORST_STATUS_OPS)) throw new Error('WORST_STATUS_OPS exceeds THING_MAX.status');
if (!withinSize('status', WORST_STATUS_KITS)) throw new Error('WORST_STATUS_KITS exceeds THING_MAX.status');
if (!withinSize('item', WORST_ITEM_WORN)) throw new Error('WORST_ITEM_WORN exceeds THING_MAX.item');
if (!withinSize('item', WORST_ITEM_CONSUMABLE)) throw new Error('WORST_ITEM_CONSUMABLE exceeds THING_MAX.item');
