// class-stormcaller.ts: Epic Stormcaller (agi+pow) signature kit and full 26-node / 23-buyable skill tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId, tag } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { Op, Reach, StackDef, StatusDef, StatusKey } from '../combat/effect-ops.ts';
import type { Limit, Trigger } from '../combat/triggers.ts';
import { tiles } from '../combat/space.ts';
import { cost, tick } from '../combat/timeline.ts';
import type { Tick } from '../combat/timeline.ts';
import { abilityOf, SPELL_TAG } from './ability-kinds.ts';
import type { Scaler } from './scalers.ts';
import type { ClassNodeDef, ClassTree, ClassWorn, NodeGift, TreeDepth } from './class-trees.ts';
import type { ClassSignature } from './class-powers.ts';

const R = RULES;
const nid = (s: string): ClassNodeId => {
  const id = parseClassNodeId(s);
  if (!id) throw new Error(`Invalid Stormcaller node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Stormcaller formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };
const area = (radius: number, on: 'allies' | 'foes'): Reach => ({ kind: 'area', radius: tiles(radius), on });

const TAG_VOLT_BLINK = tag('volt-blink');

const KEY_COIL = statusKey('storm-coil');
const KEY_COIL_EYE = statusKey('storm-coil-eye');
const KEY_CHARGE = statusKey('storm-charge');
const KEY_CONDUCTIVE = statusKey('storm-conductive');
const KEY_CONDUCTIVE_UP = statusKey('storm-conductive-ii');
const KEY_SURGE = statusKey('storm-surge');
const KEY_SURGE_UP = statusKey('storm-surge-ii');

const ID_BOLT = abilityId('storm-chain-bolt');
const ID_PYLON = abilityId('storm-pylon');
const ID_BLINK = abilityId('storm-volt-blink');
const ID_TEMPEST = abilityId('storm-tempest');

// ── statuses ──

// Static Charge stacks on a foe (harmful via -5% speed per stack so `imposed` and `echo` fire).
// At 3 stacks, spends all stacks and discharges arcane damage + stagger to the bearer and its allies (all foes within 3 tiles).
const CHARGE_DEF: StackDef = {
  label: 'Static Charge',
  desc: 'Speed reduced by 5% per stack. At 3 stacks, discharges lightning to nearby foes within 3 tiles and adds 15% stagger.',
  ops: [{ op: 'speed', pct: -5 }],
  stack: {
    cap: 3,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: {
      at: { kind: 'count', n: 3 },
      to: area(3, 'allies'),
      then: 'spend',
      ops: [
        { op: 'damage', type: 'arcane', when: 'use', amount: f('0.45 * mag') },
        { op: 'stagger', share: 0.15 },
      ],
    },
  },
};

const CONDUCTIVE_DEF: StatusDef = {
  label: 'Conductive',
  desc: 'Takes 10% more damage.',
  ops: [{ op: 'share', on: 'taken', pct: 10 }],
};

const CONDUCTIVE_UP_DEF: StatusDef = {
  label: 'Superconductive',
  desc: 'Takes 15% more damage.',
  ops: [{ op: 'share', on: 'taken', pct: 15 }],
};

const SURGE_DEF: StatusDef = {
  label: 'Volt Surge',
  desc: 'Speed increased by 20% for 1 round.',
  ops: [{ op: 'speed', pct: 20 }],
};

const SURGE_UP_DEF: StatusDef = {
  label: 'Flash Surge',
  desc: 'Speed increased by 30% for 1 round.',
  ops: [{ op: 'speed', pct: 30 }],
};

function makeStormCoil(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly ops: readonly Op[];
  readonly echoRadius: number;
  readonly surgeKey: StatusKey;
  readonly surgeDef: StatusDef;
  readonly manaPerRound: string | null;
}): ClassWorn {
  const triggers: Trigger[] = [
    { on: 'hitDealt', tag: SPELL_TAG, to: 'other', limit: EACH, ops: [{ op: 'applyStatus', key: KEY_CHARGE, def: CHARGE_DEF, duration: rounds(3) }] },
    { on: 'imposed', tag: SPELL_TAG, to: 'self', limit: ROUND, ops: [{ op: 'echo', radius: o.echoRadius }] },
    { on: 'used', tag: TAG_VOLT_BLINK, to: 'self', limit: EACH, ops: [{ op: 'applyStatus', key: o.surgeKey, def: o.surgeDef, duration: rounds(1) }] },
    ...(o.manaPerRound ? [{ on: 'hitDealt', tag: SPELL_TAG, to: 'self', limit: ROUND, ops: [{ op: 'mana', when: 'use', amount: f(o.manaPerRound) }] } as const] : []),
  ];
  return { key: o.key, def: { label: o.label, desc: o.desc, ops: o.ops, triggers } };
}

const BASE_COIL: ClassWorn = makeStormCoil({
  key: KEY_COIL,
  label: 'Living Conduit',
  desc: 'Your spell hits apply Static Charge (at 3 stacks, discharges lightning and 15% stagger within 3 tiles). Once a round, a harmful status your spell imposes arcs to another foe within 3 tiles. Volt Blink grants 20% speed for 1 round.',
  ops: [],
  echoRadius: 3,
  surgeKey: KEY_SURGE,
  surgeDef: SURGE_DEF,
  manaPerRound: null,
});

const EYE_COIL: ClassWorn = makeStormCoil({
  key: KEY_COIL_EYE,
  label: 'Eye of the Storm',
  desc: 'Adds 12% speed, 10% magic penetration, and 10% damage dealt. Spell hits apply Static Charge and recover 2 mana once a round. Harmful spell statuses arc within 4 tiles. Volt Blink grants 30% speed for 1 round.',
  ops: [
    { op: 'speed', pct: 12 },
    { op: 'sheet', key: 'resistPen', amount: f('10') },
    { op: 'share', on: 'dealt', pct: 10 },
  ],
  echoRadius: 4,
  surgeKey: KEY_SURGE_UP,
  surgeDef: SURGE_UP_DEF,
  manaPerRound: '2',
});

// ── active ability builders ──

function makeChainBolt(o: {
  readonly name: string;
  readonly formula: string;
  readonly condKey: StatusKey;
  readonly condDef: StatusDef;
  readonly staggerShare: number;
}): Ability {
  const base = abilityOf('curse', {
    id: ID_BOLT,
    name: o.name,
    desc: o.staggerShare > 0
      ? `Quick arcane bolt up to 8 tiles that applies ${o.condDef.label} for 2 rounds and fills ${Math.round(o.staggerShare * 100)}% stagger.`
      : `Quick arcane bolt up to 8 tiles that applies ${o.condDef.label} for 2 rounds.`,
    aim: 'foe',
    range: tiles(8),
    shape: { kind: 'touch', reach: tiles(8) },
    delivery: { kind: 'direct' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'applyStatus', key: o.condKey, def: o.condDef, duration: rounds(2) },
      ...(o.staggerShare > 0 ? [{ op: 'stagger', share: o.staggerShare } as const] : []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 6, time: cost(R.fight.cost.quick), cooldown: tick(0) },
  };
}

function makeStormPylon(o: {
  readonly name: string;
  readonly radiusTiles: number;
  readonly cooldownRounds: number;
  readonly formula: string;
  readonly zoneSlowPct: number;
  readonly zoneTakenPct: number;
  readonly endFormula: string;
  readonly endStagger: number;
}): Ability {
  const base = abilityOf('blast', {
    id: ID_PYLON,
    name: o.name,
    desc: `Blast a ${o.radiusTiles}-tile area within 8 tiles for arcane damage, apply Static Charge, and leave a 3-round Storm Field that slows foes and amplifies damage before detonating.`,
    aim: 'place',
    range: tiles(8),
    shape: { kind: 'radius', radius: tiles(o.radiusTiles), ring: null },
    delivery: { kind: 'travel', windup: tick(400), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops: [{ op: 'applyStatus', key: KEY_CHARGE, def: CHARGE_DEF, duration: rounds(3), stacks: 1 }],
    zone: {
      name: 'Storm Field',
      duration: rounds(3),
      around: null,
      endsWithOwner: true,
      grow: null,
      ops: [
        { op: 'speed', pct: o.zoneSlowPct },
        { op: 'share', on: 'taken', pct: o.zoneTakenPct },
      ],
      end: [
        { op: 'damage', type: 'arcane', when: 'use', amount: f(o.endFormula) },
        { op: 'stagger', share: o.endStagger },
      ],
    },
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 6, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeVoltBlink(o: {
  readonly name: string;
  readonly rangeTiles: number;
  readonly cooldownRounds: number;
  readonly formula: string;
  readonly chargeStacks: number;
}): Ability {
  const base = abilityOf('blast', {
    id: ID_BLINK,
    name: o.name,
    desc: `Blink up to ${o.rangeTiles} tiles, blasting foes in a 2-tile radius for arcane damage and applying ${o.chargeStacks} ${o.chargeStacks === 1 ? 'stack' : 'stacks'} of Static Charge for 3 rounds.`,
    aim: 'place',
    range: tiles(o.rangeTiles),
    shape: { kind: 'radius', radius: tiles(2), ring: null },
    delivery: { kind: 'travel', windup: tick(100), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops: [{ op: 'applyStatus', key: KEY_CHARGE, def: CHARGE_DEF, duration: rounds(3), stacks: o.chargeStacks }],
    move: { kind: 'blink' },
  }, R);
  return {
    ...base,
    tags: [TAG_VOLT_BLINK],
    cost: { ...base.cost, mana: 4, fatigue: 6, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeTempest(o: {
  readonly name: string;
  readonly mana: number;
  readonly cooldownRounds: number;
  readonly formula: string;
  readonly staggerShare: number;
}): Ability {
  const base = abilityOf('blast', {
    id: ID_TEMPEST,
    name: o.name,
    desc: `Channeled blast (up to 2 charges) in a 3-tile area within 8 tiles that deals arcane damage, applies 2 stacks of Static Charge for 3 rounds, and fills ${Math.round(o.staggerShare * 100)}% stagger.`,
    aim: 'place',
    range: tiles(8),
    shape: { kind: 'radius', radius: tiles(3), ring: null },
    delivery: { kind: 'travel', windup: tick(600), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'applyStatus', key: KEY_CHARGE, def: CHARGE_DEF, duration: rounds(3), stacks: 2 },
      { op: 'stagger', share: o.staggerShare },
    ],
  }, R);
  return {
    ...base,
    channel: { growth: 'linear', max: 2 },
    cost: { ...base.cost, mana: o.mana, fatigue: 8, time: cost(R.fight.cost.heavy), cooldown: rounds(o.cooldownRounds) },
  };
}

const BASE_BOLT = makeChainBolt({
  name: 'Chain Bolt',
  formula: '1d8 + 0.75 * mag',
  condKey: KEY_CONDUCTIVE,
  condDef: CONDUCTIVE_DEF,
  staggerShare: 0,
});

const UP_BOLT = makeChainBolt({
  name: 'Chain Bolt: Forked',
  formula: '2d6 + 0.9 * mag',
  condKey: KEY_CONDUCTIVE_UP,
  condDef: CONDUCTIVE_UP_DEF,
  staggerShare: 0.1,
});

const BASE_PYLON = makeStormPylon({
  name: 'Storm Pylon',
  radiusTiles: 2,
  cooldownRounds: 3,
  formula: '2d8 + mag',
  zoneSlowPct: -20,
  zoneTakenPct: 10,
  endFormula: '0.7 * mag',
  endStagger: 0.15,
});

const UP_PYLON = makeStormPylon({
  name: 'Storm Pylon: Overload',
  radiusTiles: 3,
  cooldownRounds: 2,
  formula: '2d8 + 1.2 * mag',
  zoneSlowPct: -25,
  zoneTakenPct: 15,
  endFormula: '1.1 * mag',
  endStagger: 0.2,
});

const BASE_BLINK = makeVoltBlink({
  name: 'Volt Blink',
  rangeTiles: 6,
  cooldownRounds: 3,
  formula: '1d8 + 0.55 * mag',
  chargeStacks: 1,
});

const UP_BLINK = makeVoltBlink({
  name: 'Volt Blink: Flash Step',
  rangeTiles: 8,
  cooldownRounds: 2,
  formula: '2d6 + 0.75 * mag',
  chargeStacks: 2,
});

const BASE_TEMPEST = makeTempest({
  name: 'Tempest Surge',
  mana: 10,
  cooldownRounds: 4,
  formula: '(2d8 + 1.3 * mag) * (1 + 0.5 * charge)',
  staggerShare: 0.25,
});

const UP_TEMPEST = makeTempest({
  name: 'Tempest Surge: Supercell',
  mana: 8,
  cooldownRounds: 3,
  formula: '(3d8 + 1.5 * mag) * (1 + 0.5 * charge)',
  staggerShare: 0.35,
});

/** Base Stormcaller signature (before skill-tree nodes are folded on top). */
export const STORMCALLER_SIGNATURE: ClassSignature = {
  className: 'Stormcaller',
  bonus: { pow: 2, agi: 2, resistPen: 4, haste: 3 },
  worn: BASE_COIL,
  actives: [BASE_BOLT, BASE_PYLON, BASE_BLINK, BASE_TEMPEST],
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

/** Full 7-depth, 3-branch, 23-buyable (26-node) Epic Stormcaller skill tree. */
export const STORMCALLER_TREE: ClassTree = {
  className: 'Stormcaller',
  rarity: 'epic',
  nodes: [
    // Depth 1: Root (1)
    node('storm-root', 1, 'First Spark', 'Gain 4 Power, 3 Agility, and 5 speed.', [], [
      bonus({ pow: 4, agi: 3, speed: 5 }),
    ]),

    // Depth 2: Three branches (3)
    node('storm-a2', 2, 'Arc Wire', 'Gain 4 Power and 4% magic penetration.', ['storm-root'], [
      bonus({ pow: 4, resistPen: 4 }),
    ]),
    node('storm-b2', 2, 'Gale Stride', 'Gain 4 Agility and 6 ability haste.', ['storm-root'], [
      bonus({ agi: 4, haste: 6 }),
    ]),
    node('storm-c2', 2, 'Thunderhead', 'Gain 4 Power and 5 max mana.', ['storm-root'], [
      bonus({ pow: 4, manaMax: 5 }),
    ]),

    // Depth 3: Branch splits (6)
    node('storm-a3x', 3, 'Ground Fault', 'Gain 5% magic penetration and 5 flat magic penetration.', ['storm-a2'], [
      bonus({ resistPen: 5, resistPenFlat: 5 }),
    ]),
    node('storm-a3y', 3, 'Live Sight', 'Gain 4 accuracy and 3 Power.', ['storm-a2'], [
      bonus({ aim: 4, pow: 3 }),
    ]),
    node('storm-b3x', 3, 'Tailwind', 'Gain 8 speed and 3 Agility.', ['storm-b2'], [
      bonus({ speed: 8, agi: 3 }),
    ]),
    node('storm-b3y', 3, 'Static Reflex', 'Gain 8 ability haste and 4 Reaction.', ['storm-b2'], [
      bonus({ haste: 8, react: 4 }),
    ]),
    node('storm-c3x', 3, 'Capacitor', 'Gain 6 max mana and 4% ability cost reduction.', ['storm-c2'], [
      bonus({ manaMax: 6, costCut: 4 }),
    ]),
    node('storm-c3y', 3, 'Jagged Bolt', 'Gain 4 Power and 1 extra crit face.', ['storm-c2'], [
      bonus({ pow: 4, critFaces: 1 }),
    ]),

    // Depth 4: Deepening (6)
    node('storm-a4x', 4, 'Ionize', 'Gain 6% magic penetration and 6 flat magic penetration.', ['storm-a3x'], [
      bonus({ resistPen: 6, resistPenFlat: 6 }),
    ]),
    node('storm-a4y', 4, 'Magnetize', 'Gain 5 accuracy and 6 potency.', ['storm-a3y'], [
      bonus({ aim: 5, potency: 6 }),
    ]),
    node('storm-b4x', 4, 'Lightning Step', 'Gain 8 speed and 1 move tile.', ['storm-b3x'], [
      bonus({ speed: 8, move: 1 }),
    ]),
    node('storm-b4y', 4, 'Crackling Tempo', 'Gain 8 ability haste and 5 Reaction.', ['storm-b3y'], [
      bonus({ haste: 8, react: 5 }),
    ]),
    node('storm-c4x', 4, 'Storm Reservoir', 'Gain 6 max mana and 4% ability cost reduction.', ['storm-c3x'], [
      bonus({ manaMax: 6, costCut: 4 }),
    ]),
    node('storm-c4y', 4, 'Thunderclap', 'Gain 5 Power and 0.1 crit multiplier.', ['storm-c3y'], [
      bonus({ pow: 5, critSize: 10 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('storm-a5-l', 5, 'Forked Lightning', 'Upgrade Chain Bolt to higher arcane damage, 10% stagger, and 15% bonus damage taken.', ['storm-a4x', 'storm-a4y'], [
      replaceActive(ID_BOLT, UP_BOLT),
    ], { forkGroup: 'storm-a5' }),
    node('storm-a5-r', 5, 'High Voltage', 'Gain 6 Power and 8% magic penetration. Your damaging attacks and spells deal up to 25% more damage to foes above half HP.', ['storm-a4x', 'storm-a4y'], [
      bonus({ pow: 6, resistPen: 8 }),
      scaler({ measure: 'target', dir: 'over', start: 0.5, scale: 0.25 }),
    ], { forkGroup: 'storm-a5' }),

    node('storm-b5-l', 5, 'Flash Step', 'Upgrade Volt Blink to 8-tile range, 2-round cooldown, higher arrival damage, and 2 stacks of Static Charge.', ['storm-b4x', 'storm-b4y'], [
      replaceActive(ID_BLINK, UP_BLINK),
    ], { forkGroup: 'storm-b5' }),
    node('storm-b5-r', 5, 'Cyclone Pace', 'Gain 6 Agility, 10 speed, 10 ability haste, and 8 max mana.', ['storm-b4x', 'storm-b4y'], [
      bonus({ agi: 6, speed: 10, haste: 10, manaMax: 8 }),
    ], { forkGroup: 'storm-b5' }),

    node('storm-c5-l', 5, 'Supercell', 'Upgrade Tempest Surge to 8 mana, 3-round cooldown, higher damage, and 35% stagger.', ['storm-c4x', 'storm-c4y'], [
      replaceActive(ID_TEMPEST, UP_TEMPEST),
    ], { forkGroup: 'storm-c5' }),
    node('storm-c5-r', 5, 'Overload Pylon', 'Upgrade Storm Pylon to 3-tile radius, 2-round cooldown, higher damage, stronger slow and damage amplification, and larger end discharge.', ['storm-c4x', 'storm-c4y'], [
      replaceActive(ID_PYLON, UP_PYLON),
    ], { forkGroup: 'storm-c5' }),

    // Depth 6: Branch Capstones (3)
    node('storm-a6', 6, 'Arc Master', 'Gain 6 Power, 8 flat magic penetration, and 4 accuracy.', ['storm-a5-l', 'storm-a5-r'], [
      bonus({ pow: 6, resistPenFlat: 8, aim: 4 }),
    ], { parentMode: 'any' }),
    node('storm-b6', 6, 'Gale Conduit', 'Gain 6 Agility, 8 speed, and 8 ability haste.', ['storm-b5-l', 'storm-b5-r'], [
      bonus({ agi: 6, speed: 8, haste: 8 }),
    ], { parentMode: 'any' }),
    node('storm-c6', 6, 'Skybreaker', 'Gain 6 Power, 1 extra crit face, and 0.1 crit multiplier.', ['storm-c5-l', 'storm-c5-r'], [
      bonus({ pow: 6, critFaces: 1, critSize: 10 }),
    ], { parentMode: 'any' }),

    // Depth 7: Epic Capstone (1)
    node('storm-cap', 7, 'Eye of the Storm', 'Upgrade Living Conduit to Eye of the Storm and gain 6 Power, 6 Agility, and 6 ability haste.', ['storm-a6', 'storm-b6', 'storm-c6'], [
      replaceWorn(KEY_COIL, EYE_COIL),
      bonus({ pow: 6, agi: 6, haste: 6 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
