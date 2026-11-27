// class-dreadnought.ts: Mythic Dreadnought (vit+dis) signature kit and full 38-node / 32-buyable skill tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
// Uses Hook H1 (`blocked`, `lost`, and `stacksBy`) to bank mitigated damage into neutral Wrath stacks (`dread-wrath`),
// holds the line under Sealed Hull (`dread-sealed`), and opens All-Out to spend all Wrath for burst offense before
// restoring Sealed Hull on expiry or cleanse.
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId, tag } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { Op, StackDef, StatusDef, StatusKey, UseOp } from '../combat/effect-ops.ts';
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
  if (!id) throw new Error(`Invalid Dreadnought node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Dreadnought formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };
const ONCE: Limit = { kind: 'fight', n: 1 };
const LOW_HP_PCT = Math.round(R.fight.kit.lowHpAt * 100);

const TAG_BROADSIDE = tag('dread-broadside');
const TAG_ALL_OUT = tag('dread-all-out');

const KEY_HULL = statusKey('dread-hull');
const KEY_COLOSSUS = statusKey('dread-colossus');
const KEY_WRATH = statusKey('dread-wrath');
const KEY_SEALED = statusKey('dread-sealed');
const KEY_SAFEGUARD = statusKey('dread-safeguard');
const KEY_SAFEGUARD_HEAVY = statusKey('dread-safeguard-heavy');
const KEY_BULKHEAD_RUSH = statusKey('dread-bulkhead-rush');
const KEY_SHACKLE = statusKey('dread-shackle');
const KEY_LOCKDOWN = statusKey('dread-lockdown');
const KEY_BREACH = statusKey('dread-breach');
const KEY_ALL_OUT = statusKey('dread-all-out');
const KEY_ALL_OUT_OVERDRIVE = statusKey('dread-all-out-overdrive');
const KEY_ALL_OUT_SIEGE = statusKey('dread-all-out-siege');

const ID_BROADSIDE = abilityId('dread-broadside');
const ID_BULKHEAD = abilityId('dread-bulkhead');
const ID_SHOCKWAVE = abilityId('dread-shockwave');
const ID_ALL_OUT = abilityId('dread-all-out');

// ── statuses ──

// Neutral stacking counter (ops: [] so neither helpful nor harmful dispels touch it).
// Broadside reads Wrath on hit, then this trigger cures 1 stack so Wrath climbs smoothly toward 8+ for All-Out.
const WRATH_DEF: StackDef = {
  label: 'Wrath',
  desc: 'Banked siege energy (up to 20 stacks). Broadside deals bonus damage per stack and spends 1 stack on hit. All-Out spends all stacks.',
  ops: [],
  triggers: [
    {
      on: 'hitDealt',
      tag: TAG_BROADSIDE,
      to: 'self',
      limit: EACH,
      ops: [{ op: 'cureStatus', key: KEY_WRATH, stacks: 1 }],
    },
  ],
  stack: {
    cap: 20,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: null,
  },
};

// Shared single Sealed Hull definition across base worn, capstone worn, and all All-Out end restorations.
const SEALED_HULL: StatusDef = {
  label: 'Sealed Hull',
  desc: 'Adds 8 armor and 6 resist, and reduces damage taken by 5% until All-Out opens the hull.',
  ops: [
    { op: 'sheet', key: 'armor', amount: f('8') },
    { op: 'sheet', key: 'resist', amount: f('6') },
    { op: 'share', on: 'taken', pct: -5 },
  ],
};

// 1-round safeguard wards (matches kit.wardRounds = 1).
const BULKHEAD_WARD: StatusDef = {
  label: 'Bulkhead Ward',
  desc: 'Blocks harmful statuses from foes and adds 15 armor for 1 round.',
  ops: [
    { op: 'safeguard' },
    { op: 'sheet', key: 'armor', amount: f('15') },
  ],
};

const REINFORCED_WARD: StatusDef = {
  label: 'Reinforced Ward',
  desc: 'Blocks harmful statuses from foes and adds 25 armor for 1 round.',
  ops: [
    { op: 'safeguard' },
    { op: 'sheet', key: 'armor', amount: f('25') },
  ],
};

// Self-curing arrival pulse so Bastion Bulkhead refunds 20% of its turn time without leaving a blank status behind.
const BULKHEAD_RUSH: StatusDef = {
  label: 'Bulkhead Surge',
  desc: 'Refunds 20% of your turn when you use Bastion Bulkhead.',
  ops: [],
  triggers: [
    {
      on: 'statusGained',
      key: KEY_BULKHEAD_RUSH,
      to: 'self',
      limit: ROUND,
      ops: [
        { op: 'refund', pct: 20 },
        { op: 'cureStatus', key: KEY_BULKHEAD_RUSH },
      ],
    },
  ],
};

const DREAD_SHACKLE: StatusDef = {
  label: 'Dread Shackle',
  desc: 'Speed reduced by 20% and must aim at the Dreadnought for 2 rounds.',
  ops: [
    { op: 'speed', pct: -20 },
    { op: 'taunt' },
  ],
};

const LOCKDOWN_CRUSH: StatusDef = {
  label: 'Lockdown Crush',
  desc: 'Stunned and must aim at the Dreadnought for 1 round.',
  ops: [
    { op: 'hold' },
    { op: 'taunt' },
  ],
};

const BREACHED_HULL: StatusDef = {
  label: 'Breached Hull',
  desc: 'Attacks against this target crit on 1 more die face for 2 rounds.',
  ops: [{ op: 'sheet', key: 'exposed', amount: 1 }],
};

function makeAllOutDrive(o: {
  readonly label: string;
  readonly dealtPct: number;
  readonly healFormula: string;
  readonly healPctLabel: number;
}): StatusDef {
  return {
    label: o.label,
    desc: `Deals ${o.dealtPct}% more damage and adds 10 Discipline for 3 rounds. Once a round when your attack hits, heal ${o.healPctLabel}% of max HP. Restores Sealed Hull when it ends or is cleansed.`,
    ops: [
      { op: 'share', on: 'dealt', pct: o.dealtPct },
      { op: 'stat', key: 'dis', amount: f('10') },
    ],
    triggers: [
      {
        on: 'hitDealt',
        tag: null,
        to: 'self',
        limit: ROUND,
        ops: [{ op: 'heal', when: 'use', amount: f(o.healFormula) }],
      },
    ],
    end: {
      cleanse: 'land',
      ops: [{ op: 'applyStatus', key: KEY_SEALED, def: SEALED_HULL, duration: null }],
    },
  };
}

const ALL_OUT_DRIVE: StatusDef = makeAllOutDrive({
  label: 'All-Out Drive',
  dealtPct: 25,
  healFormula: '0.02 * hpmax',
  healPctLabel: 2,
});

const ALL_OUT_OVERDRIVE: StatusDef = makeAllOutDrive({
  label: 'Overdrive Core',
  dealtPct: 35,
  healFormula: '0.02 * hpmax',
  healPctLabel: 2,
});

const ALL_OUT_SIEGE: StatusDef = makeAllOutDrive({
  label: 'Relentless Drive',
  dealtPct: 25,
  healFormula: '0.05 * hpmax',
  healPctLabel: 5,
});

function makeDreadHull(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly ops: readonly Op[];
  readonly wrathFormula: string;
  readonly lowHpShield: string;
  readonly regenFormula: string | null;
}): ClassWorn {
  const triggers: Trigger[] = [
    // 1. Wrath bank: taking a hit converts mitigated damage plus half of HP lost into Wrath stacks (up to kit.stackAdd per hit).
    {
      on: 'struck',
      tag: null,
      to: 'self',
      limit: EACH,
      ops: [{ op: 'applyStatus', key: KEY_WRATH, def: WRATH_DEF, duration: null, stacksBy: f(o.wrathFormula) }],
    },
    // 2. Sealed Hull: activates on your first turn of the fight until All-Out opens the hull.
    {
      on: 'turnStart',
      to: 'self',
      limit: ONCE,
      ops: [{ op: 'applyStatus', key: KEY_SEALED, def: SEALED_HULL, duration: null }],
    },
    // 3. Emergency Bulkhead: once a fight below lowHpAt, shields and heals.
    {
      on: 'lowHp',
      to: 'self',
      limit: ONCE,
      ops: [
        { op: 'shield', amount: f(o.lowHpShield) },
        { op: 'heal', when: 'use', amount: f('0.02 * hpmax') },
      ],
    },
    // 4. Hull Regen (Capstone): heals a share of max HP at the start of each turn.
    ...(o.regenFormula
      ? [{
        on: 'turnStart' as const,
        to: 'self' as const,
        limit: EACH,
        ops: [{ op: 'heal' as const, when: 'use' as const, amount: f(o.regenFormula) }],
      }]
      : []),
  ];
  return { key: o.key, def: { label: o.label, desc: o.desc, ops: o.ops, triggers } };
}

const BASE_HULL: ClassWorn = makeDreadHull({
  key: KEY_HULL,
  label: 'Dread Hull',
  desc: `Taking a hit builds Wrath from blocked damage and half of HP lost (up to 20 stacks). Your first turn activates Sealed Hull (8 armor, 6 resist, 5% less damage taken). Once a fight below ${LOW_HP_PCT}% HP, gain an 8% max HP shield and heal 2% of max HP.`,
  ops: [],
  wrathFormula: '(blocked + 0.5 * lost) / (0.025 * hpmax)',
  lowHpShield: '0.08 * hpmax',
  regenFormula: null,
});

const COLOSSUS_HULL: ClassWorn = makeDreadHull({
  key: KEY_COLOSSUS,
  label: 'Colossus Hull',
  desc: `Builds Wrath faster from blocked damage and half of HP lost, activates Sealed Hull on your first turn, heals 1.5% of max HP at the start of each turn, and raises the below-${LOW_HP_PCT}% HP shield to 10% of max HP.`,
  ops: [],
  wrathFormula: '(blocked + 0.5 * lost) / (0.02 * hpmax)',
  lowHpShield: '0.10 * hpmax',
  regenFormula: '0.015 * hpmax',
});

// ── active ability builders ──

function makeBroadside(o: {
  readonly name: string;
  readonly formula: string;
  readonly cleaveRadius?: number;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('strike', {
    id: ID_BROADSIDE,
    name: o.name,
    aim: 'foe',
    range: tiles(1),
    shape: o.cleaveRadius
      ? { kind: 'radius', radius: tiles(o.cleaveRadius), ring: null }
      : { kind: 'touch', reach: tiles(1) },
    delivery: { kind: 'travel', windup: tick(100), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'stagger', share: 0.20 },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    tags: [TAG_BROADSIDE],
    cost: { ...base.cost, mana: 0, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(0) },
  };
}

function makeBulkhead(o: {
  readonly name: string;
  readonly shieldFormula: string;
  readonly wardKey: StatusKey;
  readonly wardDef: StatusDef;
  readonly rush?: boolean;
}): Ability {
  const ops: UseOp[] = [
    { op: 'applyStatus', key: o.wardKey, def: o.wardDef, duration: rounds(1) },
    ...(o.rush ? [{ op: 'applyStatus' as const, key: KEY_BULKHEAD_RUSH, def: BULKHEAD_RUSH, duration: rounds(1) }] : []),
  ];
  const base = abilityOf('support', {
    id: ID_BULKHEAD,
    name: o.name,
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'shield', by: 'hand', formula: f(o.shieldFormula) },
    ops,
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 4, time: cost(R.fight.cost.quick), cooldown: rounds(2) },
  };
}

function makeShockwave(o: {
  readonly name: string;
  readonly formula: string;
  readonly radius: number;
  readonly staggerShare: number;
  readonly shove: boolean;
  readonly statusKey: StatusKey;
  readonly statusDef: StatusDef;
  readonly statusRounds: number;
  readonly cooldownRounds: number;
}): Ability {
  const ops: UseOp[] = [
    { op: 'stagger', share: o.staggerShare },
    ...(o.shove ? [{ op: 'shove' as const, dir: 'away' as const, from: 'user' as const, tiles: 1 }] : []),
    { op: 'applyStatus', key: o.statusKey, def: o.statusDef, duration: rounds(o.statusRounds) },
  ];
  const base = abilityOf('blast', {
    id: ID_SHOCKWAVE,
    name: o.name,
    aim: 'place',
    range: tiles(2),
    shape: { kind: 'radius', radius: tiles(o.radius), ring: null },
    delivery: { kind: 'travel', windup: tick(100), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops,
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 7, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeAllOut(o: {
  readonly name: string;
  readonly shieldFormula: string;
  readonly driveKey: StatusKey;
  readonly driveDef: StatusDef;
  readonly cooldownRounds: number;
}): Ability {
  const base = abilityOf('support', {
    id: ID_ALL_OUT,
    name: o.name,
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'shield', by: 'hand', formula: f(o.shieldFormula) },
    ops: [
      { op: 'cureStatus', key: KEY_SEALED },
      { op: 'applyStatus', key: o.driveKey, def: o.driveDef, duration: rounds(3) },
    ],
  }, R);
  return {
    ...base,
    tags: [TAG_ALL_OUT],
    gates: [{ kind: 'holds', key: KEY_WRATH, on: 'self', atLeast: 5 }],
    prices: [{ kind: 'stacks', key: KEY_WRATH, from: 'self', take: { kind: 'all' } }],
    cost: { ...base.cost, mana: 0, fatigue: 6, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds) },
  };
}

const BASE_BROADSIDE = makeBroadside({
  name: 'Broadside',
  formula: '2d8 + 0.27 * armor + 0.15 * resist + 0.014 * hpmax * stacks(dread-wrath)',
});

const UP_BROADSIDE_TECTONIC = makeBroadside({
  name: 'Broadside: Tectonic Broadside',
  formula: '2d8 + 0.27 * armor + 0.15 * resist + 0.014 * hpmax * stacks(dread-wrath)',
  cleaveRadius: 2,
});

const UP_BROADSIDE_BREACHING = makeBroadside({
  name: 'Broadside: Breaching Broadside',
  formula: '2d8 + 0.27 * armor + 0.15 * resist + 0.020 * hpmax * stacks(dread-wrath)',
  extraOps: [{ op: 'applyStatus', key: KEY_BREACH, def: BREACHED_HULL, duration: rounds(2) }],
});

const BASE_BULKHEAD = makeBulkhead({
  name: 'Bulkhead',
  shieldFormula: '0.12 * hpmax',
  wardKey: KEY_SAFEGUARD,
  wardDef: BULKHEAD_WARD,
});

const UP_BULKHEAD_BASTION = makeBulkhead({
  name: 'Bulkhead: Bastion Bulkhead',
  shieldFormula: '0.17 * hpmax',
  wardKey: KEY_SAFEGUARD,
  wardDef: BULKHEAD_WARD,
  rush: true,
});

const UP_BULKHEAD_REINFORCED = makeBulkhead({
  name: 'Bulkhead: Reinforced Bulkhead',
  shieldFormula: '0.12 * hpmax',
  wardKey: KEY_SAFEGUARD_HEAVY,
  wardDef: REINFORCED_WARD,
});

const BASE_SHOCKWAVE = makeShockwave({
  name: 'Shockwave',
  formula: '2d8 + 1.25 * armor + 0.75 * resist',
  radius: 2,
  staggerShare: 0.35,
  shove: true,
  statusKey: KEY_SHACKLE,
  statusDef: DREAD_SHACKLE,
  statusRounds: 2,
  cooldownRounds: 2,
});

const UP_SHOCKWAVE_SEISMIC = makeShockwave({
  name: 'Shockwave: Seismic Shockwave',
  formula: '2d8 + 1.40 * armor + 0.85 * resist',
  radius: 3,
  staggerShare: 0.40,
  shove: true,
  statusKey: KEY_SHACKLE,
  statusDef: DREAD_SHACKLE,
  statusRounds: 2,
  cooldownRounds: 2,
});

const UP_SHOCKWAVE_LOCKDOWN = makeShockwave({
  name: 'Shockwave: Lockdown Wave',
  formula: '2d8 + 1.80 * armor + 1.08 * resist',
  radius: 2,
  staggerShare: 0.35,
  shove: false,
  statusKey: KEY_LOCKDOWN,
  statusDef: LOCKDOWN_CRUSH,
  statusRounds: 1,
  cooldownRounds: 6,
});

const BASE_ALL_OUT = makeAllOut({
  name: 'All-Out',
  shieldFormula: '0.014 * hpmax * spent',
  driveKey: KEY_ALL_OUT,
  driveDef: ALL_OUT_DRIVE,
  cooldownRounds: 4,
});

const UP_ALL_OUT_OVERDRIVE = makeAllOut({
  name: 'All-Out: Overdrive Core',
  shieldFormula: '0.018 * hpmax * spent',
  driveKey: KEY_ALL_OUT_OVERDRIVE,
  driveDef: ALL_OUT_OVERDRIVE,
  cooldownRounds: 4,
});

const UP_ALL_OUT_SIEGE = makeAllOut({
  name: 'All-Out: Relentless Siege',
  shieldFormula: '0.014 * hpmax * spent',
  driveKey: KEY_ALL_OUT_SIEGE,
  driveDef: ALL_OUT_SIEGE,
  cooldownRounds: 3,
});

/** Base Dreadnought signature (before skill-tree nodes are folded on top). */
export const DREADNOUGHT_SIGNATURE: ClassSignature = {
  className: 'Dreadnought',
  bonus: { vit: 3, dis: 3, hpMax: 25, speed: 13 },
  worn: BASE_HULL,
  actives: [BASE_BROADSIDE, BASE_BULKHEAD, BASE_SHOCKWAVE, BASE_ALL_OUT],
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

const bonus = (p: Perk): NodeGift => ({ kind: 'bonus', bonus: p });
const scaler = (s: Scaler): NodeGift => ({ kind: 'scaler', scaler: s });
const replaceActive = (targetId: AbilityId, active: Ability): NodeGift => ({ kind: 'replace-active', targetId, active });
const replaceWorn = (targetKey: StatusKey, worn: ClassWorn): NodeGift => ({ kind: 'replace-worn', targetKey, worn });

/** Full 9-depth, 3-branch, 32-buyable (38-node) Mythic Dreadnought skill tree. */
export const DREADNOUGHT_TREE: ClassTree = {
  className: 'Dreadnought',
  rarity: 'mythic',
  nodes: [
    // Depth 1: Root (1)
    node('dread-root', 1, 'Dreadnought Frame', 'Gain 2 Vitality, 2 Discipline, and 10 max HP.', [], [
      bonus({ vit: 2, dis: 2, hpMax: 10 }),
    ]),

    // Depth 2: Three branches (3) — Hull (a), Slam (b), Siege (c)
    node('dread-a2', 2, 'Armored Bulkhead', 'Gain 3 Vitality and 10 max HP.', ['dread-root'], [
      bonus({ vit: 3, hpMax: 10 }),
    ]),
    node('dread-b2', 2, 'Heavy Broadside', 'Gain 3 Discipline and 12% armor penetration.', ['dread-root'], [
      bonus({ dis: 3, armorPen: 12 }),
    ]),
    node('dread-c2', 2, 'Siege Stride', 'Gain 7 speed and 4 ability haste.', ['dread-root'], [
      bonus({ speed: 7, haste: 4 }),
    ]),

    // Depth 3: Branch splits (6)
    node('dread-a3x', 3, 'Riveted Plating', 'Gain 3 Vitality and 10 max HP.', ['dread-a2'], [
      bonus({ vit: 3, hpMax: 10 }),
    ]),
    node('dread-a3y', 3, 'Hull Bracing', 'Gain 5 tenacity and 4 Will.', ['dread-a2'], [
      bonus({ tenacity: 5, will: 4 }),
    ]),
    node('dread-b3x', 3, 'Battering Ram', 'Gain 14% armor penetration and 15 flat armor penetration.', ['dread-b2'], [
      bonus({ armorPen: 14, armorPenFlat: 15 }),
    ]),
    node('dread-b3y', 3, 'Shock Discipline', 'Gain 3 Discipline and 4 Accuracy.', ['dread-b2'], [
      bonus({ dis: 3, aim: 4 }),
    ]),
    node('dread-c3x', 3, 'Steady Drive', 'Gain 7 speed and 4 ability haste.', ['dread-c2'], [
      bonus({ speed: 7, haste: 4 }),
    ]),
    node('dread-c3y', 3, 'Pressure Vent', 'Gain 5 max HP and 4% heal and shield bonus.', ['dread-c2'], [
      bonus({ hpMax: 5, healPower: 4 }),
    ]),

    // Depth 4: Deepening (6)
    node('dread-a4x', 4, 'Reinforced Keel', 'Gain 4 Vitality and 10 max HP.', ['dread-a3x'], [
      bonus({ vit: 4, hpMax: 10 }),
    ]),
    node('dread-a4y', 4, 'Unbending Frame', 'Gain 6 tenacity and 5 Will.', ['dread-a3y'], [
      bonus({ tenacity: 6, will: 5 }),
    ]),
    node('dread-b4x', 4, 'Armor Splitter', 'Gain 16% armor penetration and 15 flat armor penetration.', ['dread-b3x'], [
      bonus({ armorPen: 16, armorPenFlat: 15 }),
    ]),
    node('dread-b4y', 4, 'Heavy Calibration', 'Gain 4 Discipline and 5 potency.', ['dread-b3y'], [
      bonus({ dis: 4, potency: 5 }),
    ]),
    node('dread-c4x', 4, 'Piston Gait', 'Gain 7 speed and 4 ability haste.', ['dread-c3x'], [
      bonus({ speed: 7, haste: 4 }),
    ]),
    node('dread-c4y', 4, 'Shield Capacitor', 'Gain 5 max HP and 5% heal and shield bonus.', ['dread-c3y'], [
      bonus({ hpMax: 5, healPower: 5 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('dread-a5-l', 5, 'Bastion Bulkhead', 'Upgrade Bulkhead to shield for 17% of max HP and refund 20% of your turn.', ['dread-a4x', 'dread-a4y'], [
      replaceActive(ID_BULKHEAD, UP_BULKHEAD_BASTION),
    ], { forkGroup: 'dread-a5' }),
    node('dread-a5-r', 5, 'Reinforced Bulkhead', 'Upgrade Bulkhead so its ward adds 25 armor for 1 round instead of 15.', ['dread-a4x', 'dread-a4y'], [
      replaceActive(ID_BULKHEAD, UP_BULKHEAD_REINFORCED),
    ], { forkGroup: 'dread-a5' }),

    node('dread-b5-l', 5, 'Tectonic Broadside', 'Upgrade Broadside to strike every foe within 2 tiles of the target.', ['dread-b4x', 'dread-b4y'], [
      replaceActive(ID_BROADSIDE, UP_BROADSIDE_TECTONIC),
    ], { forkGroup: 'dread-b5' }),
    node('dread-b5-r', 5, 'Breaching Broadside', 'Upgrade Broadside to add 2% of max HP per Wrath stack and apply Breached Hull for 2 rounds.', ['dread-b4x', 'dread-b4y'], [
      replaceActive(ID_BROADSIDE, UP_BROADSIDE_BREACHING),
    ], { forkGroup: 'dread-b5' }),

    node('dread-c5-l', 5, 'Seismic Shockwave', 'Upgrade Shockwave to a 3-tile blast with 40% stagger and heavier impact.', ['dread-c4x', 'dread-c4y'], [
      replaceActive(ID_SHOCKWAVE, UP_SHOCKWAVE_SEISMIC),
    ], { forkGroup: 'dread-c5' }),
    node('dread-c5-r', 5, 'Lockdown Wave', 'Upgrade Shockwave to stun and taunt foes in place for 1 round on a 6-round cooldown with heavier impact.', ['dread-c4x', 'dread-c4y'], [
      replaceActive(ID_SHOCKWAVE, UP_SHOCKWAVE_LOCKDOWN),
    ], { forkGroup: 'dread-c5' }),

    // Depth 6: Post-fork convergence (6)
    node('dread-a6x', 6, 'Citadel Plating', 'Gain 4 Vitality and 10 max HP.', ['dread-a5-l', 'dread-a5-r'], [
      bonus({ vit: 4, hpMax: 10 }),
    ], { parentMode: 'any' }),
    node('dread-a6y', 6, 'Steadfast Core', 'Gain 6 tenacity and 5 Will.', ['dread-a5-l', 'dread-a5-r'], [
      bonus({ tenacity: 6, will: 5 }),
    ], { parentMode: 'any' }),
    node('dread-b6x', 6, 'Hullbreaker Rounds', 'Gain 20 flat armor penetration and 1 extra crit face.', ['dread-b5-l', 'dread-b5-r'], [
      bonus({ armorPenFlat: 20, critFaces: 1 }),
    ], { parentMode: 'any' }),
    node('dread-b6y', 6, 'Measured Impact', 'Gain 4 Discipline and 5 Accuracy.', ['dread-b5-l', 'dread-b5-r'], [
      bonus({ dis: 4, aim: 5 }),
    ], { parentMode: 'any' }),
    node('dread-c6x', 6, 'Turbine March', 'Gain 7 speed and 4 ability haste.', ['dread-c5-l', 'dread-c5-r'], [
      bonus({ speed: 7, haste: 4 }),
    ], { parentMode: 'any' }),
    node('dread-c6y', 6, 'Reserve Bulkhead', 'Gain 6% heal and shield bonus and 5 potency.', ['dread-c5-l', 'dread-c5-r'], [
      bonus({ healPower: 6, potency: 5 }),
    ], { parentMode: 'any' }),

    // Depth 7: Second Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('dread-a7-l', 7, 'Titan Plate', 'Gain 8 Vitality, 6 Discipline, and 8 Will.', ['dread-a6x', 'dread-a6y'], [
      bonus({ vit: 8, dis: 6, will: 8 }),
    ], { forkGroup: 'dread-a7' }),
    node('dread-a7-r', 7, 'Siege Hull', 'Gain 35 max HP and 12 tenacity.', ['dread-a6x', 'dread-a6y'], [
      bonus({ hpMax: 35, tenacity: 12 }),
    ], { forkGroup: 'dread-a7' }),

    node('dread-b7-l', 7, 'Titan Crusher', 'Gain 16% armor penetration and deal up to 22% more damage to foes with higher max HP than you.', ['dread-b6x', 'dread-b6y'], [
      bonus({ armorPen: 16 }),
      scaler({ measure: 'maxPair', dir: 'over', start: 0.5, scale: 0.22 }),
    ], { forkGroup: 'dread-b7' }),
    node('dread-b7-r', 7, 'Breaker Core', 'Gain 16% armor penetration and deal up to 25% more damage to foes below half HP.', ['dread-b6x', 'dread-b6y'], [
      bonus({ armorPen: 16 }),
      scaler({ measure: 'target', dir: 'under', start: 0.5, scale: 0.25 }),
    ], { forkGroup: 'dread-b7' }),

    node('dread-c7-l', 7, 'Overdrive Core', 'Upgrade All-Out to grant 35% more damage dealt and shield for 1.8% of max HP per Wrath stack spent.', ['dread-c6x', 'dread-c6y'], [
      replaceActive(ID_ALL_OUT, UP_ALL_OUT_OVERDRIVE),
    ], { forkGroup: 'dread-c7' }),
    node('dread-c7-r', 7, 'Relentless Siege', 'Upgrade All-Out to a 3-round cooldown and heal 5% of max HP on hit once a round.', ['dread-c6x', 'dread-c6y'], [
      replaceActive(ID_ALL_OUT, UP_ALL_OUT_SIEGE),
    ], { forkGroup: 'dread-c7' }),

    // Depth 8: Branch Capstones (3)
    node('dread-a8', 8, 'Unbroken Hull', 'Gain 4 Vitality and 6 tenacity.', ['dread-a7-l', 'dread-a7-r'], [
      bonus({ vit: 4, tenacity: 6 }),
    ], { parentMode: 'any' }),
    node('dread-b8', 8, 'Siege Ordnance', 'Gain 4 Discipline and 20 flat armor penetration.', ['dread-b7-l', 'dread-b7-r'], [
      bonus({ dis: 4, armorPenFlat: 20 }),
    ], { parentMode: 'any' }),
    node('dread-c8', 8, 'Full Steam', 'Gain 7 speed and 4 ability haste.', ['dread-c7-l', 'dread-c7-r'], [
      bonus({ speed: 7, haste: 4 }),
    ], { parentMode: 'any' }),

    // Depth 9: Monarch Capstone (1)
    node('dread-cap', 9, 'Colossus Hull', 'Upgrade Dread Hull to Colossus Hull and gain 5 Vitality and 4 Discipline.', ['dread-a8', 'dread-b8', 'dread-c8'], [
      replaceWorn(KEY_HULL, COLOSSUS_HULL),
      bonus({ vit: 5, dis: 4 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
