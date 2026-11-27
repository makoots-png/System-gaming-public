// class-necromancer.ts: Mythic Necromancer (pre+pow) signature kit and full 38-node / 32-buyable skill tree.
// Pure static registry data. Prices come solely from RULES via classes.ts.
import { RULES } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId, tag } from '../combat/ability-types.ts';
import type { Ability, AbilityId, RiseSpec } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { StatusDef, StatusKey } from '../combat/effect-ops.ts';
import type { Limit } from '../combat/triggers.ts';
import { tiles } from '../combat/space.ts';
import { cost, tick } from '../combat/timeline.ts';
import type { Tick } from '../combat/timeline.ts';
import { abilityOf } from './ability-kinds.ts';
import type { Scaler } from './scalers.ts';
import type { ClassNodeDef, ClassPerk, ClassTree, ClassWorn, NodeGift, TreeDepth } from './class-trees.ts';
import type { ClassSignature } from './class-powers.ts';

const R = RULES;
const nid = (s: string): ClassNodeId => {
  const id = parseClassNodeId(s);
  if (!id) throw new Error(`Invalid Necromancer node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Necromancer formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };

const TAG_EXCHANGE = tag('shadow-exchange');

const KEY_SOVEREIGN = statusKey('necro-sovereign');
const KEY_MONARCH = statusKey('necro-shadow-monarch');
const KEY_DOMAIN_AURA = statusKey('necro-domain-aura');
const KEY_DOMAIN_AURA_UP = statusKey('necro-domain-aura-ii');

const ID_ARISE = abilityId('necro-arise');
const ID_DOMAIN = abilityId('necro-domain');
const ID_AUTHORITY = abilityId('necro-authority');
const ID_EXCHANGE = abilityId('necro-exchange');

// ── worn passives ──

const SOVEREIGN_WORN: ClassWorn = {
  key: KEY_SOVEREIGN,
  def: {
    label: 'Sovereign of Shadows',
    desc: 'Once per round when you or a minion kills a monster, restore 12 + 10% of max mana. Once per round when a minion drops to 0 HP, spend 15 mana to reform it at 50% HP. Using Shadow Exchange grants you a shield equal to 15% of max HP.',
    ops: [],
    triggers: [
      { on: 'armyKill', tag: null, to: 'self', limit: ROUND, ops: [{ op: 'mana', amount: f('12 + 0.1 * manamax') }] },
      { on: 'minionDown', tag: null, to: 'other', limit: ROUND, ops: [{ op: 'reform', hpShare: 0.5, mana: 15 }] },
      { on: 'used', tag: TAG_EXCHANGE, to: 'self', limit: EACH, ops: [{ op: 'shield', amount: f('0.15 * hpmax') }] },
    ],
  },
};

const MONARCH_WORN: ClassWorn = {
  key: KEY_MONARCH,
  def: {
    label: 'Shadow Monarch',
    desc: 'Minions within 6 tiles deal 15% more damage, have 15% more speed, and take 10% less damage. Restore 3 mana at the start of each turn. Once per round when you or a minion kills a monster, restore 12 + 10% of max mana. Once per round when a minion drops to 0 HP, spend 12 mana to reform it at 65% HP with a 15% max HP shield. Using Shadow Exchange grants you a shield equal to 15% of max HP.',
    ops: [
      { op: 'aura', radius: 6, on: 'minions' },
      { op: 'share', on: 'dealt', pct: 15 },
      { op: 'speed', pct: 15 },
      { op: 'share', on: 'taken', pct: -10 },
    ],
    triggers: [
      { on: 'armyKill', tag: null, to: 'self', limit: ROUND, ops: [{ op: 'mana', amount: f('12 + 0.1 * manamax') }] },
      {
        on: 'minionDown',
        tag: null,
        to: 'other',
        limit: ROUND,
        ops: [
          { op: 'reform', hpShare: 0.65, mana: 12 },
          { op: 'shield', amount: f('0.15 * target.hpmax') },
        ],
      },
      { on: 'used', tag: TAG_EXCHANGE, to: 'self', limit: EACH, ops: [{ op: 'shield', amount: f('0.15 * hpmax') }] },
      { on: 'turnStart', to: 'self', limit: EACH, ops: [{ op: 'mana', amount: f('3') }] },
    ],
  },
};

// ── active ability builders ──

function makeArise(o: {
  readonly name: string;
  readonly mana: number;
  readonly raise: RiseSpec;
}): Ability {
  return {
    id: ID_ARISE,
    name: o.name,
    kind: 'support',
    cost: { fatigue: 6, mana: o.mana, time: cost(R.fight.cost.standard), cooldown: rounds(1) },
    aim: 'corpse',
    range: tiles(6),
    shape: { kind: 'touch', reach: tiles(6) },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: null,
    ops: [],
    channel: null,
    raise: o.raise,
  };
}

const DOMAIN_AURA_BASE: StatusDef = {
  label: 'Domain of the Monarch',
  desc: 'Minions within 5 tiles deal 35% more damage, gain 25% speed, and take 15% less damage.',
  ops: [
    { op: 'aura', radius: 5, on: 'minions' },
    { op: 'share', on: 'dealt', pct: 35 },
    { op: 'speed', pct: 25 },
    { op: 'share', on: 'taken', pct: -15 },
  ],
};

const DOMAIN_AURA_UP: StatusDef = {
  label: 'Imperial Domain',
  desc: 'Minions within 5 tiles deal 40% more damage, gain 30% speed, and take 20% less damage.',
  ops: [
    { op: 'aura', radius: 5, on: 'minions' },
    { op: 'share', on: 'dealt', pct: 40 },
    { op: 'speed', pct: 30 },
    { op: 'share', on: 'taken', pct: -20 },
  ],
};

function makeDomain(o: {
  readonly name: string;
  readonly auraKey: StatusKey;
  readonly auraDef: StatusDef;
  readonly shredShare: number;
  readonly movesWithOwner: boolean;
  readonly uses: number;
  readonly mana: number;
  readonly durationRounds: number;
}): Ability {
  const base = abilityOf('support', {
    id: ID_DOMAIN,
    name: o.name,
    aim: 'self',
    shape: { kind: 'radius', radius: tiles(5), ring: null },
    range: tiles(0),
    delivery: { kind: 'sure' },
    foesOnly: true,
    effect: null,
    ops: [{ op: 'applyStatus', key: o.auraKey, def: o.auraDef, duration: rounds(o.durationRounds) }],
    zone: {
      name: o.name,
      duration: rounds(o.durationRounds),
      around: o.movesWithOwner ? tiles(5) : null,
      endsWithOwner: true,
      grow: null,
      ops: [
        { op: 'sheet', key: 'armor', amount: f(`-${o.shredShare} * armor`) },
        { op: 'sheet', key: 'resist', amount: f(`-${o.shredShare} * resist`) },
      ],
    },
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: o.mana, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(o.durationRounds) },
    gates: [{ kind: 'uses', per: 'fight', n: o.uses }],
  };
}

function makeAuthority(o: {
  readonly name: string;
  readonly mana: number;
  readonly cooldownRounds: number;
  readonly formula: string;
  readonly staggerShare: number;
}): Ability {
  const base = abilityOf('blast', {
    id: ID_AUTHORITY,
    name: o.name,
    aim: 'place',
    range: tiles(6),
    shape: { kind: 'radius', radius: tiles(2), ring: null },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'shove', dir: 'toward', from: 'aim', tiles: 3 },
      { op: 'stagger', share: o.staggerShare },
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: o.mana, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeExchange(o: {
  readonly name: string;
  readonly mana: number;
  readonly cooldownRounds: number;
  readonly slowPct: number;
}): Ability {
  const base = abilityOf('support', {
    id: ID_EXCHANGE,
    name: o.name,
    aim: 'ally',
    range: tiles(12),
    shape: { kind: 'touch', reach: tiles(12) },
    delivery: { kind: 'sure' },
    foesOnly: true,
    effect: null,
    ops: [],
    zone: {
      name: 'Shadow Wake',
      duration: rounds(1),
      around: tiles(2),
      endsWithOwner: true,
      grow: null,
      ops: [{ op: 'speed', pct: o.slowPct }],
    },
  }, R);
  return {
    ...base,
    tags: [TAG_EXCHANGE],
    move: { kind: 'swap', only: 'minion' },
    cost: { ...base.cost, mana: o.mana, fatigue: 4, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds) },
  };
}

const BASE_ARISE = makeArise({
  name: 'Arise',
  mana: 15,
  raise: { bonus: 4, maxRisen: 2, elitePerFight: 1 },
});

const ARISE_II = makeArise({
  name: 'Arise: Greater Command',
  mana: 13,
  raise: { bonus: 5, maxRisen: 3, elitePerFight: 1 },
});

const ARISE_III = makeArise({
  name: 'Arise: Endless Legion',
  mana: 12,
  raise: { bonus: 6, maxRisen: 4, elitePerFight: 1 },
});

const BASE_DOMAIN = makeDomain({
  name: 'Domain of the Monarch',
  auraKey: KEY_DOMAIN_AURA,
  auraDef: DOMAIN_AURA_BASE,
  shredShare: 0.15,
  movesWithOwner: false,
  uses: 1,
  mana: 25,
  durationRounds: 4,
});

const DOMAIN_II = makeDomain({
  name: 'Domain of the Monarch: Imperial',
  auraKey: KEY_DOMAIN_AURA_UP,
  auraDef: DOMAIN_AURA_UP,
  shredShare: 0.25,
  movesWithOwner: false,
  uses: 2,
  mana: 20,
  durationRounds: 4,
});

const DOMAIN_III = makeDomain({
  name: 'Domain of the Monarch: Walking',
  auraKey: KEY_DOMAIN_AURA_UP,
  auraDef: DOMAIN_AURA_UP,
  shredShare: 0.25,
  movesWithOwner: true,
  uses: 2,
  mana: 20,
  durationRounds: 4,
});

const BASE_AUTHORITY = makeAuthority({
  name: 'Ruler\'s Authority',
  mana: 14,
  cooldownRounds: 3,
  formula: '2d8 + mag + 0.5 * sup',
  staggerShare: 0.35,
});

const AUTHORITY_II = makeAuthority({
  name: 'Ruler\'s Authority: Sovereign Grip',
  mana: 14,
  cooldownRounds: 2,
  formula: '2d10 + mag + 0.65 * sup',
  staggerShare: 0.4,
});

const AUTHORITY_III = makeAuthority({
  name: 'Ruler\'s Authority: Crushing Force',
  mana: 12,
  cooldownRounds: 2,
  formula: '3d8 + 1.1 * mag + 0.7 * sup',
  staggerShare: 0.45,
});

const BASE_EXCHANGE = makeExchange({
  name: 'Shadow Exchange',
  mana: 8,
  cooldownRounds: 3,
  slowPct: -25,
});

const EXCHANGE_II = makeExchange({
  name: 'Shadow Exchange: Phantom Shift',
  mana: 6,
  cooldownRounds: 2,
  slowPct: -35,
});

/** Base Necromancer signature (before skill-tree nodes are folded on top). */
export const NECROMANCER_SIGNATURE: ClassSignature = {
  className: 'Necromancer',
  bonus: { manaMax: 40, shadows: 3 },
  worn: SOVEREIGN_WORN,
  actives: [BASE_ARISE, BASE_DOMAIN, BASE_AUTHORITY, BASE_EXCHANGE],
};

// ── 38-node / 32-buyable Mythic skill tree ──

const node = (
  id: string,
  depth: TreeDepth,
  name: string,
  desc: string,
  parents: readonly string[],
  gifts: readonly NodeGift[],
  extra?: Partial<Pick<ClassNodeDef, 'parentMode' | 'forkGroup' | 'capstone'>>,
): ClassNodeDef => ({
  id: nid(id),
  depth,
  name,
  desc,
  parents: parents.map(nid),
  gifts,
  ...extra,
});

const bonus = (p: ClassPerk): NodeGift => ({ kind: 'bonus', bonus: p });
const scaler = (s: Scaler): NodeGift => ({ kind: 'scaler', scaler: s });
const replaceActive = (targetId: AbilityId, active: Ability): NodeGift => ({ kind: 'replace-active', targetId, active });
const replaceWorn = (targetKey: StatusKey, worn: ClassWorn): NodeGift => ({ kind: 'replace-worn', targetKey, worn });

/** Full 9-depth, 3-branch (Legion, Dominion, Harvest), 32-buyable (38-node) Mythic Necromancer skill tree. */
export const NECROMANCER_TREE: ClassTree = {
  className: 'Necromancer',
  rarity: 'mythic',
  nodes: [
    // Depth 1: Root (1)
    node('necro-root', 1, 'Awakened Sovereign', 'Gain 4 Presence, 4 Power, and 5 max mana.', [], [
      bonus({ pre: 4, pow: 4, manaMax: 5 }),
    ]),

    // Depth 2: Three branches (3) — Legion (a), Dominion (b), Harvest (c)
    node('necro-a2', 2, 'Legion Command', 'Gain 4 Presence and 12 max HP.', ['necro-root'], [
      bonus({ pre: 4, hpMax: 12 }),
    ]),
    node('necro-b2', 2, 'Monarch\'s Reach', 'Gain 4 Power and 4% magic penetration.', ['necro-root'], [
      bonus({ pow: 4, resistPen: 4 }),
    ]),
    node('necro-c2', 2, 'Soul Reservoir', 'Gain 8 max mana and 4 Power.', ['necro-root'], [
      bonus({ manaMax: 8, pow: 4 }),
    ]),

    // Depth 3: Branch splits (6)
    node('necro-a3x', 3, 'Grave Call', 'Gain 4 Presence and 6 ability haste.', ['necro-a2'], [
      bonus({ pre: 4, haste: 6 }),
    ]),
    node('necro-a3y', 3, 'Shadow Bulwark', 'Gain 15 max HP, 4 Vitality, and 6% heal and shield bonus.', ['necro-a2'], [
      bonus({ hpMax: 15, vit: 4, healPower: 6 }),
    ]),
    node('necro-b3x', 3, 'Crushing Presence', 'Gain 5 Power and 5 flat magic penetration.', ['necro-b2'], [
      bonus({ pow: 5, resistPenFlat: 5 }),
    ]),
    node('necro-b3y', 3, 'Dark Authority', 'Gain 5 Presence and 6 ability haste.', ['necro-b2'], [
      bonus({ pre: 5, haste: 6 }),
    ]),
    node('necro-c3x', 3, 'Abyssal Well', 'Gain 8 max mana and 8 ability haste.', ['necro-c2'], [
      bonus({ manaMax: 8, haste: 8 }),
    ]),
    node('necro-c3y', 3, 'Spectral Shift', 'Gain 5 speed and 6% heal and shield bonus.', ['necro-c2'], [
      bonus({ speed: 5, healPower: 6 }),
    ]),

    // Depth 4: Deepening (6)
    node('necro-a4x', 4, 'Unbroken Ranks', 'Gain 5 Presence and 8 tenacity.', ['necro-a3x'], [
      bonus({ pre: 5, tenacity: 8 }),
    ]),
    node('necro-a4y', 4, 'Deathless Guard', 'Gain 20 max HP and 6% heal and shield bonus.', ['necro-a3y'], [
      bonus({ hpMax: 20, healPower: 6 }),
    ]),
    node('necro-b4x', 4, 'Shattering Force', 'Gain 6% magic penetration and 6 flat magic penetration.', ['necro-b3x'], [
      bonus({ resistPen: 6, resistPenFlat: 6 }),
    ]),
    node('necro-b4y', 4, 'Imperial Poise', 'Gain 6 Presence and 8 Will.', ['necro-b3y'], [
      bonus({ pre: 6, will: 8 }),
    ]),
    node('necro-c4x', 4, 'Mana Conduit', 'Gain 7 max mana and 5% ability cost reduction.', ['necro-c3x'], [
      bonus({ manaMax: 7, costCut: 5 }),
    ]),
    node('necro-c4y', 4, 'Umbral Aegis', 'Gain 8% heal and shield bonus and 15 max HP.', ['necro-c3y'], [
      bonus({ healPower: 8, hpMax: 15 }),
    ]),

    // Depth 5: First Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('necro-a5-l', 5, 'Greater Arise', 'Upgrade Arise to keep up to 3 risen monsters at once, with a +5 Presence check bonus and 13 mana cost.', ['necro-a4x', 'necro-a4y'], [
      replaceActive(ID_ARISE, ARISE_II),
    ], { forkGroup: 'necro-a5' }),
    node('necro-a5-r', 5, 'Iron Vanguard', 'Gain 25 max HP, 8 Vitality, and 10% heal and shield bonus.', ['necro-a4x', 'necro-a4y'], [
      bonus({ hpMax: 25, vit: 8, healPower: 10 }),
    ], { forkGroup: 'necro-a5' }),

    node('necro-b5-l', 5, 'Imperial Domain', 'Upgrade Domain of the Monarch to 2 uses per fight and 20 mana, granting minions 40% damage dealt, 30% speed, and 20% less damage taken, and cutting foe armor and resist by 25%.', ['necro-b4x', 'necro-b4y'], [
      replaceActive(ID_DOMAIN, DOMAIN_II),
    ], { forkGroup: 'necro-b5' }),
    node('necro-b5-r', 5, 'Sovereign Grip', 'Upgrade Ruler\'s Authority to a 2-round cooldown with stronger arcane damage and 40% stagger.', ['necro-b4x', 'necro-b4y'], [
      replaceActive(ID_AUTHORITY, AUTHORITY_II),
    ], { forkGroup: 'necro-b5' }),

    node('necro-c5-l', 5, 'Phantom Exchange', 'Upgrade Shadow Exchange to a 2-round cooldown, 6 mana cost, and a 35% slow zone. Gain 8% heal and shield bonus.', ['necro-c4x', 'necro-c4y'], [
      replaceActive(ID_EXCHANGE, EXCHANGE_II),
      bonus({ healPower: 8 }),
    ], { forkGroup: 'necro-c5' }),
    node('necro-c5-r', 5, 'Deep Harvest', 'Gain 8% ability cost reduction, 10 ability haste, and 6 Power.', ['necro-c4x', 'necro-c4y'], [
      bonus({ costCut: 8, haste: 10, pow: 6 }),
    ], { forkGroup: 'necro-c5' }),

    // Depth 6: Post-fork convergence (6)
    node('necro-a6x', 6, 'March of the Dead', 'Gain 6 Presence and 6 speed.', ['necro-a5-l', 'necro-a5-r'], [
      bonus({ pre: 6, speed: 6 }),
    ], { parentMode: 'any' }),
    node('necro-a6y', 6, 'Monarch\'s Mantle', 'Gain 20 max HP and 10 tenacity.', ['necro-a5-l', 'necro-a5-r'], [
      bonus({ hpMax: 20, tenacity: 10 }),
    ], { parentMode: 'any' }),
    node('necro-b6x', 6, 'Arcane Dominion', 'Gain 6 Power and 6% magic penetration.', ['necro-b5-l', 'necro-b5-r'], [
      bonus({ pow: 6, resistPen: 6 }),
    ], { parentMode: 'any' }),
    node('necro-b6y', 6, 'Gravity Well', 'Gain 8 flat magic penetration and 10 ability haste.', ['necro-b5-l', 'necro-b5-r'], [
      bonus({ resistPenFlat: 8, haste: 10 }),
    ], { parentMode: 'any' }),
    node('necro-c6x', 6, 'Siphon Flow', 'Gain 6 max mana and 8% heal and shield bonus.', ['necro-c5-l', 'necro-c5-r'], [
      bonus({ manaMax: 6, healPower: 8 }),
    ], { parentMode: 'any' }),
    node('necro-c6y', 6, 'Shadow Tempo', 'Gain 10 ability haste and 5% ability cost reduction.', ['necro-c5-l', 'necro-c5-r'], [
      bonus({ haste: 10, costCut: 5 }),
    ], { parentMode: 'any' }),

    // Depth 7: Second Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('necro-a7-l', 7, 'Endless Arise', 'Upgrade Arise to keep up to 4 risen monsters at once, with a +6 Presence check bonus and 12 mana cost.', ['necro-a6x', 'necro-a6y'], [
      replaceActive(ID_ARISE, ARISE_III),
    ], { forkGroup: 'necro-a7' }),
    node('necro-a7-r', 7, 'Reaper\'s Command', 'Gain 6 Presence. Your damaging attacks and spells deal up to 15% more damage to foes below half HP.', ['necro-a6x', 'necro-a6y'], [
      bonus({ pre: 6 }),
      scaler({ measure: 'target', dir: 'under', start: 0.5, scale: 0.15 }),
    ], { forkGroup: 'necro-a7' }),

    node('necro-b7-l', 7, 'Walking Domain', 'Upgrade Domain of the Monarch to 2 uses per fight and 20 mana with a radius 5 foe zone that moves with you, keeping 40% minion damage dealt, 30% speed, 20% less damage taken, and 25% armor and resist reduction.', ['necro-b6x', 'necro-b6y'], [
      replaceActive(ID_DOMAIN, DOMAIN_III),
    ], { forkGroup: 'necro-b7' }),
    node('necro-b7-r', 7, 'Crushing Authority', 'Upgrade Ruler\'s Authority to a 2-round cooldown, 12 mana cost, higher arcane damage, and 45% stagger.', ['necro-b6x', 'necro-b6y'], [
      replaceActive(ID_AUTHORITY, AUTHORITY_III),
    ], { forkGroup: 'necro-b7' }),

    node('necro-c7-l', 7, 'Abyssal Thrift', 'Gain 7% ability cost reduction and 12 ability haste.', ['necro-c6x', 'necro-c6y'], [
      bonus({ costCut: 7, haste: 12 }),
    ], { forkGroup: 'necro-c7' }),
    node('necro-c7-r', 7, 'Sovereign Shielding', 'Gain 12% heal and shield bonus, 20 max HP, and 6 Presence.', ['necro-c6x', 'necro-c6y'], [
      bonus({ healPower: 12, hpMax: 20, pre: 6 }),
    ], { forkGroup: 'necro-c7' }),

    // Depth 8: Branch Capstones (3)
    node('necro-a8', 8, 'Lord of the Legion', 'Gain 8 Presence, 20 max HP, and 8 tenacity.', ['necro-a7-l', 'necro-a7-r'], [
      bonus({ pre: 8, hpMax: 20, tenacity: 8 }),
    ], { parentMode: 'any' }),
    node('necro-b8', 8, 'Absolute Dominion', 'Gain 8 Power, 8 flat magic penetration, and 8 Will.', ['necro-b7-l', 'necro-b7-r'], [
      bonus({ pow: 8, resistPenFlat: 8, will: 8 }),
    ], { parentMode: 'any' }),
    node('necro-c8', 8, 'Boundless Well', 'Gain 6 max mana, 6 Presence, and 6 Power.', ['necro-c7-l', 'necro-c7-r'], [
      bonus({ manaMax: 6, pre: 6, pow: 6 }),
    ], { parentMode: 'any' }),

    // Depth 9: Monarch Capstone (1)
    node('necro-cap', 9, 'Shadow Monarch', 'Upgrade Sovereign of Shadows to Shadow Monarch and gain 8 Presence, 8 Power, and 20 max HP.', ['necro-a8', 'necro-b8', 'necro-c8'], [
      replaceWorn(KEY_SOVEREIGN, MONARCH_WORN),
      bonus({ pre: 8, pow: 8, hpMax: 20 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
