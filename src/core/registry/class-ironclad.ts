// class-ironclad.ts: Epic Ironclad (vit+dis) signature kit and full 26-node / 23-buyable skill tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
// Ships absorb-and-release Siege Charge plus Wave 4 true reflect on blocked damage (Hook H1).
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId, tag } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { StackDef, StatusDef, StatusKey, UseOp } from '../combat/effect-ops.ts';
import type { Limit, Trigger } from '../combat/triggers.ts';
import { tiles } from '../combat/space.ts';
import { cost, tick } from '../combat/timeline.ts';
import type { Tick } from '../combat/timeline.ts';
import { abilityOf } from './ability-kinds.ts';
import type { Scaler } from './scalers.ts';
import type { ClassNodeDef, ClassTree, ClassWorn, NodeGift, TreeDepth } from './class-trees.ts';
import type { ClassSignature } from './class-powers.ts';

const R = RULES;
const nid = (s: string): ClassNodeId => {
  const id = parseClassNodeId(s);
  if (!id) throw new Error(`Invalid Ironclad node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Ironclad formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };
const ONCE: Limit = { kind: 'fight', n: 1 };
const LOW_HP_PCT = Math.round(R.fight.kit.lowHpAt * 100);

const TAG_SLAM = tag('shield-slam');

const KEY_BASTION = statusKey('iron-bastion');
const KEY_BASTION_LIVING = statusKey('iron-bastion-living');
const KEY_CHARGE = statusKey('iron-charge');
const KEY_CAGED_TAUNT = statusKey('iron-caged-taunt');
const KEY_SLAM_TAUNT = statusKey('iron-slam-taunt');
const KEY_SAFEGUARD = statusKey('iron-safeguard');
const KEY_STANCE = statusKey('iron-stance');
const KEY_STANCE_UP = statusKey('iron-stance-ii');
const KEY_CRACKED = statusKey('iron-cracked');

const ID_CAGE = abilityId('iron-cage');
const ID_INTERCEPT = abilityId('iron-intercept');
const ID_SLAM = abilityId('iron-shield-slam');
const ID_STANCE = abilityId('iron-unbreakable');

// ── statuses ──

// Siege Charge: builds up to 5 stacks when Ironclad is struck (+2 armor per stack), then spends all stacks
// when Shield Slam hits to unleash absorbed impact as bonus damage.
const SIEGE_CHARGE: StackDef = {
  label: 'Siege Charge',
  desc: 'Adds 2 armor per stack (up to 5). Your next Shield Slam deals bonus damage per stack and spends all stacks.',
  ops: [{ op: 'sheet', key: 'armor', amount: f('2') }],
  triggers: [
    { on: 'hitDealt', tag: TAG_SLAM, to: 'self', limit: EACH, ops: [{ op: 'cureStatus', key: KEY_CHARGE }] },
  ],
  stack: {
    cap: 5,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: null,
  },
};

const CAGED_TAUNT: StatusDef = {
  label: 'Caged',
  desc: 'Must aim at the Ironclad while taunted.',
  ops: [{ op: 'taunt' }],
};

const SLAM_TAUNT: StatusDef = {
  label: 'Challenged',
  desc: 'Must aim at the Ironclad while taunted.',
  ops: [{ op: 'taunt' }],
};

const SAFEGUARD_DEF: StatusDef = {
  label: 'Iron Safeguard',
  desc: 'Blocks harmful statuses from foes for 1 round.',
  ops: [{ op: 'safeguard' }],
};

const STANCE_DEF: StatusDef = {
  label: 'Unbreakable Stance',
  desc: 'Adds 25 armor and 25 resist, and reduces damage taken by 20%.',
  ops: [
    { op: 'sheet', key: 'armor', amount: f('25') },
    { op: 'sheet', key: 'resist', amount: f('25') },
    { op: 'share', on: 'taken', pct: -20 },
  ],
};

const STANCE_UP_DEF: StatusDef = {
  label: 'Adamant Shell',
  desc: 'Adds 35 armor and 35 resist, and reduces damage taken by 25%.',
  ops: [
    { op: 'sheet', key: 'armor', amount: f('35') },
    { op: 'sheet', key: 'resist', amount: f('35') },
    { op: 'share', on: 'taken', pct: -25 },
  ],
};

const CRACKED_DEF: StatusDef = {
  label: 'Cracked Armor',
  desc: 'Reduces armor by 15.',
  ops: [{ op: 'sheet', key: 'armor', amount: f('-15') }],
};

function makeBastion(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly armor: string;
  readonly resist: string;
  readonly takenPct: number;
  readonly chargePerHit: number;
  readonly reflectFormula: string;
  readonly reflectLimit: Limit;
  readonly lowHpTrigger: Trigger | null;
}): ClassWorn {
  const triggers: Trigger[] = [
    {
      on: 'struck',
      tag: null,
      to: 'self',
      limit: EACH,
      ops: [{ op: 'applyStatus', key: KEY_CHARGE, def: SIEGE_CHARGE, duration: null, stacks: o.chargePerHit }],
    },
    ...(o.lowHpTrigger ? [o.lowHpTrigger] : []),
    {
      on: 'struck',
      tag: null,
      to: 'other',
      limit: o.reflectLimit,
      ops: [{ op: 'damage', type: 'physical', when: 'use', amount: f(o.reflectFormula) }],
    },
  ];
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [
        { op: 'sheet', key: 'armor', amount: f(o.armor) },
        { op: 'sheet', key: 'resist', amount: f(o.resist) },
        { op: 'share', on: 'taken', pct: o.takenPct },
      ],
      triggers,
    },
  };
}

const BASE_BASTION: ClassWorn = makeBastion({
  key: KEY_BASTION,
  label: 'Iron Bulwark',
  desc: 'Adds 4 armor and 3 resist, and reduces damage taken by 10%. Taking a hit builds 1 Siege Charge (up to 5) that raises armor and adds damage to Shield Slam. Once a round when struck, you reflect 25% of blocked damage back as physical damage.',
  armor: '4',
  resist: '3',
  takenPct: -10,
  chargePerHit: 1,
  reflectFormula: '0.25 * blocked',
  reflectLimit: ROUND,
  lowHpTrigger: null,
});

const LIVING_BASTION: ClassWorn = makeBastion({
  key: KEY_BASTION_LIVING,
  label: 'Living Fortress',
  desc: `Adds 10 armor and 8 resist, and reduces damage taken by 15%. Taking a hit builds 2 Siege Charge (up to 5). Each time you are struck, you reflect 35% of blocked damage back as physical damage. Once a fight below ${LOW_HP_PCT}% HP, gain a 20% max HP shield and safeguard for 1 round.`,
  armor: '10',
  resist: '8',
  takenPct: -15,
  chargePerHit: 2,
  reflectFormula: '0.35 * blocked',
  reflectLimit: EACH,
  lowHpTrigger: {
    on: 'lowHp',
    to: 'self',
    limit: ONCE,
    ops: [
      { op: 'shield', amount: f('0.2 * hpmax') },
      { op: 'applyStatus', key: KEY_SAFEGUARD, def: SAFEGUARD_DEF, duration: rounds(1) },
    ],
  },
});

// ── active ability builders ──

function makeIronCage(o: {
  readonly name: string;
  readonly radiusTiles: number;
  readonly formula: string;
  readonly shoveTiles: number;
  readonly zoneDealtPct: number;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  // Always 2-round cage on 4-round cooldown so no fork or haste creates permanent root lock.
  const base = abilityOf('blast', {
    id: ID_CAGE,
    name: o.name,
    aim: 'place',
    range: tiles(4),
    shape: { kind: 'radius', radius: tiles(o.radiusTiles), ring: null },
    delivery: { kind: 'travel', windup: tick(400), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'applyStatus', key: KEY_CAGED_TAUNT, def: CAGED_TAUNT, duration: rounds(2) },
      { op: 'shove', dir: 'toward', from: 'aim', tiles: o.shoveTiles },
      ...(o.extraOps ?? []),
    ],
    zone: {
      name: 'Iron Cage',
      duration: rounds(2),
      around: null,
      endsWithOwner: true,
      grow: null,
      ops: [
        { op: 'root' },
        { op: 'share', on: 'dealt', pct: o.zoneDealtPct },
      ],
    },
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 6, fatigue: 8, time: cost(R.fight.cost.standard), cooldown: rounds(4) },
  };
}

function makeIntercept(o: {
  readonly name: string;
  readonly reachTiles: number;
  readonly cooldownRounds: number;
  readonly guardShare: number;
  readonly shieldFormula: string;
}): Ability {
  const base = abilityOf('support', {
    id: ID_INTERCEPT,
    name: o.name,
    aim: 'ally',
    range: tiles(o.reachTiles),
    shape: { kind: 'touch', reach: tiles(o.reachTiles) },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'shield', by: 'hand', formula: f(o.shieldFormula) },
    ops: [
      { op: 'guard', share: o.guardShare },
      { op: 'applyStatus', key: KEY_SAFEGUARD, def: SAFEGUARD_DEF, duration: rounds(1) },
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 6, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds) },
    react: { when: 'before', reach: tiles(o.reachTiles) },
  };
}

function makeShieldSlam(o: {
  readonly name: string;
  readonly cooldownRounds: number;
  readonly formula: string;
  readonly staggerShare: number;
  readonly withCrack: boolean;
}): Ability {
  const base = abilityOf('strike', {
    id: ID_SLAM,
    name: o.name,
    aim: 'foe',
    range: tiles(1),
    shape: { kind: 'touch', reach: tiles(1) },
    delivery: { kind: 'travel', windup: tick(100), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'stagger', share: o.staggerShare },
      { op: 'applyStatus', key: KEY_SLAM_TAUNT, def: SLAM_TAUNT, duration: rounds(2) },
      ...(o.withCrack ? [{ op: 'applyStatus', key: KEY_CRACKED, def: CRACKED_DEF, duration: rounds(2) } as const] : []),
    ],
  }, R);
  return {
    ...base,
    tags: [TAG_SLAM],
    cost: { ...base.cost, mana: 0, fatigue: 8, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeUnbreakable(o: {
  readonly name: string;
  readonly cooldownRounds: number;
  readonly shieldFormula: string;
  readonly dispel: 'first' | 'all';
  readonly stanceKey: StatusKey;
  readonly stanceDef: StatusDef;
}): Ability {
  const base = abilityOf('support', {
    id: ID_STANCE,
    name: o.name,
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'shield', by: 'hand', formula: f(o.shieldFormula) },
    ops: [
      { op: 'dispel', which: o.dispel },
      { op: 'applyStatus', key: o.stanceKey, def: o.stanceDef, duration: rounds(2) },
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 4, fatigue: 6, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds) },
  };
}

const BASE_CAGE = makeIronCage({
  name: 'Iron Cage',
  radiusTiles: 3,
  formula: '1d6 + 0.25 * armor',
  shoveTiles: 2,
  zoneDealtPct: -15,
});

const UP_CAGE_COLOSSUS = makeIronCage({
  name: 'Iron Cage: Colossus',
  radiusTiles: 4,
  formula: '1d8 + 0.35 * armor',
  shoveTiles: 3,
  zoneDealtPct: -20,
});

const UP_CAGE_CRUSH = makeIronCage({
  name: 'Iron Cage: Crushing',
  radiusTiles: 3,
  formula: '1d8 + 0.3 * armor',
  shoveTiles: 2,
  zoneDealtPct: -15,
  extraOps: [
    { op: 'stagger', share: 0.25 },
    { op: 'applyStatus', key: KEY_CRACKED, def: CRACKED_DEF, duration: rounds(2) },
  ],
});

const BASE_INTERCEPT = makeIntercept({
  name: 'Bulwark Intercept',
  reachTiles: 2,
  cooldownRounds: 2,
  guardShare: 0.35,
  shieldFormula: '0.16 * hpmax',
});

const UP_INTERCEPT = makeIntercept({
  name: 'Bulwark Intercept: Vanguard',
  reachTiles: 3,
  cooldownRounds: 1,
  guardShare: 0.45,
  shieldFormula: '0.2 * hpmax',
});

const BASE_SLAM = makeShieldSlam({
  name: 'Shield Slam',
  cooldownRounds: 2,
  formula: '(1d8 + 0.3 * armor + 0.03 * hpmax) * (1 + 0.18 * stacks(iron-charge))',
  staggerShare: 0.25,
  withCrack: false,
});

const UP_SLAM = makeShieldSlam({
  name: 'Shield Slam: Siege Breaker',
  cooldownRounds: 1,
  formula: '(2d6 + 0.4 * armor + 0.04 * hpmax) * (1 + 0.22 * stacks(iron-charge))',
  staggerShare: 0.35,
  withCrack: true,
});

const BASE_STANCE = makeUnbreakable({
  name: 'Unbreakable Stance',
  cooldownRounds: 4,
  shieldFormula: '0.22 * hpmax',
  dispel: 'first',
  stanceKey: KEY_STANCE,
  stanceDef: STANCE_DEF,
});

const UP_STANCE = makeUnbreakable({
  name: 'Unbreakable Stance: Adamant',
  cooldownRounds: 3,
  shieldFormula: '0.3 * hpmax',
  dispel: 'all',
  stanceKey: KEY_STANCE_UP,
  stanceDef: STANCE_UP_DEF,
});

/** Base Ironclad signature (before skill-tree nodes are folded on top). */
export const IRONCLAD_SIGNATURE: ClassSignature = {
  className: 'Ironclad',
  bonus: { vit: 2, dis: 2, threat: 10 },
  worn: BASE_BASTION,
  actives: [BASE_CAGE, BASE_INTERCEPT, BASE_SLAM, BASE_STANCE],
};

// ── 26-node / 23-buyable Epic skill tree ──

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

const bonus = (p: Perk): NodeGift => ({ kind: 'bonus', bonus: p });
const scaler = (s: Scaler): NodeGift => ({ kind: 'scaler', scaler: s });
const replaceActive = (targetId: AbilityId, active: Ability): NodeGift => ({ kind: 'replace-active', targetId, active });
const replaceWorn = (targetKey: StatusKey, worn: ClassWorn): NodeGift => ({ kind: 'replace-worn', targetKey, worn });

/** Full 7-depth, 3-branch, 23-buyable (26-node) Epic Ironclad skill tree. */
export const IRONCLAD_TREE: ClassTree = {
  className: 'Ironclad',
  rarity: 'epic',
  nodes: [
    // Depth 1: Root (1)
    node('iron-root', 1, 'Riveted Frame', 'Gain 4 Vitality, 3 Discipline, and 20 max HP.', [], [
      bonus({ vit: 4, dis: 3, hpMax: 20 }),
    ]),

    // Depth 2: Three branches (3)
    node('iron-a2', 2, 'Arena Warden', 'Gain 4 Vitality and 5 potency.', ['iron-root'], [
      bonus({ vit: 4, potency: 5 }),
    ]),
    node('iron-b2', 2, 'Tempered Plate', 'Gain 25 max HP and 4 Discipline.', ['iron-root'], [
      bonus({ hpMax: 25, dis: 4 }),
    ]),
    node('iron-c2', 2, 'Siege Momentum', 'Gain 4 Vitality and 6 ability haste.', ['iron-root'], [
      bonus({ vit: 4, haste: 6 }),
    ]),

    // Depth 3: Branch splits (6)
    node('iron-a3x', 3, 'Unmoved', 'Gain 5 tenacity and 3 Discipline.', ['iron-a2'], [
      bonus({ tenacity: 5, dis: 3 }),
    ]),
    node('iron-a3y', 3, 'Iron Taunt', 'Gain 20% threat and 20 max HP.', ['iron-a2'], [
      bonus({ threat: 20, hpMax: 20 }),
    ]),
    node('iron-b3x', 3, 'Steel Resolve', 'Gain 30 max HP and 4 Will.', ['iron-b2'], [
      bonus({ hpMax: 30, will: 4 }),
    ]),
    node('iron-b3y', 3, 'Reinforced Buckler', 'Gain 6% heal and shield bonus and 3 Vitality.', ['iron-b2'], [
      bonus({ healPower: 6, vit: 3 }),
    ]),
    node('iron-c3x', 3, 'Battering Edge', 'Gain 5% armor penetration and 5 flat armor penetration.', ['iron-c2'], [
      bonus({ armorPen: 5, armorPenFlat: 5 }),
    ]),
    node('iron-c3y', 3, 'Heavy Stride', 'Gain 6 speed and 6 ability haste.', ['iron-c2'], [
      bonus({ speed: 6, haste: 6 }),
    ]),

    // Depth 4: Deepening (6)
    node('iron-a4x', 4, 'Lockdown Grip', 'Gain 6 potency and 6 tenacity.', ['iron-a3x'], [
      bonus({ potency: 6, tenacity: 6 }),
    ]),
    node('iron-a4y', 4, 'Commanding Presence', 'Gain 25% threat and 4 Vitality.', ['iron-a3y'], [
      bonus({ threat: 25, vit: 4 }),
    ]),
    node('iron-b4x', 4, 'Fortified Core', 'Gain 35 max HP and 5 Will.', ['iron-b3x'], [
      bonus({ hpMax: 35, will: 5 }),
    ]),
    node('iron-b4y', 4, 'Layered Plating', 'Gain 8% heal and shield bonus and 4 Discipline.', ['iron-b3y'], [
      bonus({ healPower: 8, dis: 4 }),
    ]),
    node('iron-c4x', 4, 'Sunder Plate', 'Gain 6% armor penetration and 6 flat armor penetration.', ['iron-c3x'], [
      bonus({ armorPen: 6, armorPenFlat: 6 }),
    ]),
    node('iron-c4y', 4, 'Relentless March', 'Gain 8 speed and 8 ability haste.', ['iron-c3y'], [
      bonus({ speed: 8, haste: 8 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('iron-a5-l', 5, 'Colossus Cage', 'Upgrade Iron Cage to 4-tile radius, 3-tile pull, 20% foe damage reduction, and stronger armor damage.', ['iron-a4x', 'iron-a4y'], [
      replaceActive(ID_CAGE, UP_CAGE_COLOSSUS),
    ], { forkGroup: 'iron-a5' }),
    node('iron-a5-r', 5, 'Crushing Cage', 'Upgrade Iron Cage to add 25% stagger and 15 armor shred for 2 rounds to every foe caught.', ['iron-a4x', 'iron-a4y'], [
      replaceActive(ID_CAGE, UP_CAGE_CRUSH),
    ], { forkGroup: 'iron-a5' }),

    node('iron-b5-l', 5, 'Vanguard Wall', 'Upgrade Bulwark Intercept to 3-tile reach, 1-round cooldown, 45% strike guard, and 20% max HP shield.', ['iron-b4x', 'iron-b4y'], [
      replaceActive(ID_INTERCEPT, UP_INTERCEPT),
    ], { forkGroup: 'iron-b5' }),
    node('iron-b5-r', 5, 'Adamant Shell', 'Upgrade Unbreakable Stance to a 3-round cooldown, 30% max HP shield, full dispel, 35 armor, 35 resist, and 25% damage reduction.', ['iron-b4x', 'iron-b4y'], [
      replaceActive(ID_STANCE, UP_STANCE),
    ], { forkGroup: 'iron-b5' }),

    node('iron-c5-l', 5, 'Siege Breaker', 'Upgrade Shield Slam to a 1-round cooldown, stronger Siege Charge release, 35% stagger, and 15 armor shred for 2 rounds.', ['iron-c4x', 'iron-c4y'], [
      replaceActive(ID_SLAM, UP_SLAM),
    ], { forkGroup: 'iron-c5' }),
    node('iron-c5-r', 5, 'Giant Anvil', 'Gain 6 Vitality and 8% armor penetration. Your damaging attacks and spells deal up to 25% more damage to foes with higher max HP than you.', ['iron-c4x', 'iron-c4y'], [
      bonus({ vit: 6, armorPen: 8 }),
      scaler({ measure: 'maxPair', dir: 'over', start: 0.5, scale: 0.25 }),
    ], { forkGroup: 'iron-c5' }),

    // Depth 6: Branch Capstones (3)
    node('iron-a6', 6, 'Cage Master', 'Gain 5 Vitality, 5 Discipline, and 6 tenacity.', ['iron-a5-l', 'iron-a5-r'], [
      bonus({ vit: 5, dis: 5, tenacity: 6 }),
    ], { parentMode: 'any' }),
    node('iron-b6', 6, 'Citadel Heart', 'Gain 45 max HP, 6 Will, and 6% heal and shield bonus.', ['iron-b5-l', 'iron-b5-r'], [
      bonus({ hpMax: 45, will: 6, healPower: 6 }),
    ], { parentMode: 'any' }),
    node('iron-c6', 6, 'Spiked Ram', 'Gain 5 Vitality, 8 ability haste, and 8 flat armor penetration.', ['iron-c5-l', 'iron-c5-r'], [
      bonus({ vit: 5, haste: 8, armorPenFlat: 8 }),
    ], { parentMode: 'any' }),

    // Depth 7: Epic Capstone (1)
    node('iron-cap', 7, 'Living Fortress', 'Upgrade Iron Bulwark to Living Fortress and gain 6 Vitality, 6 Discipline, and 45 max HP.', ['iron-a6', 'iron-b6', 'iron-c6'], [
      replaceWorn(KEY_BASTION, LIVING_BASTION),
      bonus({ vit: 6, dis: 6, hpMax: 45 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
