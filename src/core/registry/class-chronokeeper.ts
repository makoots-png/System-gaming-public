// class-chronokeeper.ts: Epic Chronokeeper (dis+ctl) signature kit and full 26-node / 23-buyable skill tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
// Zero new combat hooks: pairs dis+ctl (Inquisitor, Lockdown, Unbroken Focus, Apex Puppeteer) with an imposed-status engine.
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { Op, Reach, StatusDef, StatusKey, Tiers, UseOp } from '../combat/effect-ops.ts';
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
  if (!id) throw new Error(`Invalid Chronokeeper node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Chronokeeper formula "${text}"`);
  return p.formula;
};
const tiered = (e: string, d: string, c: string, b: string, a: string, s: string): Tiers<Formula> =>
  [f(e), f(d), f(c), f(b), f(a), f(s)];
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };
const area = (radius: number, on: 'allies' | 'foes'): Reach => ({ kind: 'area', radius: tiles(radius), on });

const KEY_HOURGLASS = statusKey('chrono-hourglass');
const KEY_HOURGLASS_MASTER = statusKey('chrono-hourglass-master');
const KEY_DRAG = statusKey('chrono-drag');
const KEY_DRAG_ENTROPY = statusKey('chrono-drag-entropy');
const KEY_QUICKSILVER = statusKey('chrono-quicksilver');
const KEY_OVERCLOCK = statusKey('chrono-overclock');
const KEY_TWIN_TEMPO = statusKey('chrono-twin-tempo');
const KEY_FROZEN = statusKey('chrono-frozen');
const KEY_EDGE = statusKey('chrono-edge');

const ID_BOLT = abilityId('chrono-bolt');
const ID_ACCEL = abilityId('chrono-accelerate');
const ID_STASIS = abilityId('chrono-stasis');
const ID_SLIP = abilityId('chrono-time-slip');

// ── statuses ──

const CHRONO_DRAG: StatusDef = {
  label: 'Chrono Drag',
  desc: 'Speed reduced by 15% for 2 rounds.',
  ops: [{ op: 'speed', pct: -15 }],
};

const ENTROPY_DRAG: StatusDef = {
  label: 'Entropy Sand',
  desc: 'Speed reduced by 15% and attacks against this target crit on 1 more die face for 2 rounds.',
  ops: [
    { op: 'speed', pct: -15 },
    { op: 'sheet', key: 'exposed', amount: 1 },
  ],
};

const QUICKSILVER: StatusDef = {
  label: 'Quicksilver',
  desc: 'Speed increased by 20% and deals 10% more damage for 2 rounds.',
  ops: [
    { op: 'speed', pct: 20 },
    { op: 'share', on: 'dealt', pct: 10 },
  ],
};

const OVERCLOCK: StatusDef = {
  label: 'Overclock',
  desc: 'Speed increased by 20% and deals 20% more damage for 2 rounds.',
  ops: [
    { op: 'speed', pct: 20 },
    { op: 'share', on: 'dealt', pct: 20 },
  ],
};

// Self-curing ally-area pulse so Twin Tempo hastens and buffs nearby allies within 2 tiles while sparing foes and leaving no blank carrier status.
const TWIN_TEMPO_DEF: StatusDef = {
  label: 'Twin Tempo',
  desc: 'Hastens nearby allies within 2 tiles by 40% and grants Quicksilver for 2 rounds.',
  ops: [],
  triggers: [
    {
      on: 'statusGained',
      key: KEY_TWIN_TEMPO,
      to: area(2, 'allies'),
      limit: EACH,
      ops: [
        { op: 'hasten', share: 0.4 },
        { op: 'applyStatus', key: KEY_QUICKSILVER, def: QUICKSILVER, duration: rounds(2) },
        { op: 'cureStatus', key: KEY_TWIN_TEMPO },
      ],
    },
  ],
};

const FROZEN_SECOND: StatusDef = {
  label: 'Frozen Second',
  desc: 'Held in place and unable to act for 1 round.',
  ops: [{ op: 'hold' }],
};

const TEMPORAL_EDGE: StatusDef = {
  label: 'Temporal Edge',
  desc: 'Deals 15% more damage for 1 round.',
  ops: [{ op: 'share', on: 'dealt', pct: 15 }],
};

function makeHourglass(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly speedPct: number;
  readonly refundPct: number;
  readonly imposedMana: string;
  readonly turnMana: string | null;
}): ClassWorn {
  const ops: Op[] = [{ op: 'speed', pct: o.speedPct }];
  const triggers: Trigger[] = [
    {
      on: 'imposed',
      tag: null,
      to: 'self',
      limit: ROUND,
      ops: [
        { op: 'refund', pct: o.refundPct },
        { op: 'mana', when: 'use', amount: f(o.imposedMana) },
      ],
    },
    ...(o.turnMana
      ? [
        {
          on: 'turnStart' as const,
          to: 'self' as const,
          limit: EACH,
          ops: [{ op: 'mana' as const, when: 'use' as const, amount: f(o.turnMana) }],
        },
      ]
      : []),
  ];
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops,
      triggers,
    },
  };
}

const BASE_HOURGLASS: ClassWorn = makeHourglass({
  key: KEY_HOURGLASS,
  label: 'Hourglass Pulse',
  desc: 'Speed increased by 10%. Once a round when you put a harmful status on a foe, refund 20% of your turn and recover 4 mana.',
  speedPct: 10,
  refundPct: 20,
  imposedMana: '4',
  turnMana: null,
});

const MASTER_HOURGLASS: ClassWorn = makeHourglass({
  key: KEY_HOURGLASS_MASTER,
  label: 'Master of Hours',
  desc: 'Speed increased by 15%. Once a round when you put a harmful status on a foe, refund 30% of your turn and recover 6 mana. Recover 3 mana at the start of each turn.',
  speedPct: 15,
  refundPct: 30,
  imposedMana: '6',
  turnMana: '3',
});

// ── active ability builders ──

function makeChronoBolt(o: {
  readonly name: string;
  readonly pace: 'quick' | 'standard';
  readonly formula: string;
  readonly delayRounds: number;
  readonly dragKey: StatusKey;
  readonly dragDef: StatusDef;
}): Ability {
  const base = abilityOf('curse', {
    id: ID_BOLT,
    name: o.name,
    desc: o.pace === 'quick'
      ? `Quick arcane bolt up to 8 tiles that delays the target's turn and applies ${o.dragDef.label} for 2 rounds.`
      : `Arcane bolt up to 8 tiles that delays the target's turn and applies ${o.dragDef.label} for 2 rounds.`,
    aim: 'foe',
    range: tiles(8),
    shape: { kind: 'touch', reach: tiles(8) },
    delivery: { kind: 'direct' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'delay', ticks: rounds(o.delayRounds) },
      { op: 'applyStatus', key: o.dragKey, def: o.dragDef, duration: rounds(2) },
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 4, fatigue: 5, time: cost(R.fight.cost[o.pace]), cooldown: rounds(0) },
  };
}

function makeAccelerate(o: {
  readonly name: string;
  readonly desc: string;
  readonly ops: readonly UseOp[];
}): Ability {
  const base = abilityOf('support', {
    id: ID_ACCEL,
    name: o.name,
    desc: o.desc,
    aim: 'ally',
    range: tiles(8),
    shape: { kind: 'touch', reach: tiles(8) },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: null,
    ops: o.ops,
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 8, fatigue: 5, time: cost(R.fight.cost.quick), cooldown: rounds(2) },
  };
}

function makeStasisField(o: {
  readonly name: string;
  readonly desc: string;
  readonly cooldownRounds: number;
  readonly delayRounds: number;
  readonly zoneRounds: number;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('blast', {
    id: ID_STASIS,
    name: o.name,
    desc: o.desc,
    aim: 'place',
    range: tiles(7),
    shape: { kind: 'radius', radius: tiles(2), ring: null },
    delivery: { kind: 'travel', windup: tick(400), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f('1d8 + 0.65 * aim + 0.35 * mag') },
    ops: [
      { op: 'delay', ticks: rounds(o.delayRounds) },
      { op: 'stagger', share: 0.3 },
      ...(o.extraOps ?? []),
    ],
    zone: {
      name: 'Time Warp',
      duration: rounds(o.zoneRounds),
      around: null,
      endsWithOwner: true,
      grow: null,
      ops: [
        { op: 'speed', pct: -25 },
        { op: 'damage', type: 'arcane', when: 'turn', amount: tiered('1d6', '1d8', '2d6', '2d8', '3d10', '4d10') },
      ],
    },
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 10, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeTimeSlip(): Ability {
  const base = abilityOf('support', {
    id: ID_SLIP,
    name: 'Time Slip',
    desc: 'Turn reaction. Shield yourself and gain Temporal Edge for 1 round.',
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: null,
    ops: [
      { op: 'shield', amount: f('0.15 * hpmax') },
      { op: 'applyStatus', key: KEY_EDGE, def: TEMPORAL_EDGE, duration: rounds(1) },
    ],
  }, R);
  // Turn reactions fire by named combatant regardless of distance; reach stays within fieldRadiusMax for zero-clamp parse round-trip.
  return {
    ...base,
    cost: { ...base.cost, mana: 8, fatigue: 4, time: cost(R.fight.cost.quick), cooldown: rounds(2) },
    react: { when: 'turn', reach: tiles(R.fight.fieldRadiusMax) },
  };
}

const BASE_BOLT = makeChronoBolt({
  name: 'Chrono Bolt',
  pace: 'standard',
  formula: '1d8 + 0.75 * aim + 0.35 * mag',
  delayRounds: 0.2,
  dragKey: KEY_DRAG,
  dragDef: CHRONO_DRAG,
});

const UP_BOLT_REWIND = makeChronoBolt({
  name: 'Chrono Bolt: Rewind Strike',
  pace: 'quick',
  formula: '1d8 + 0.8 * aim + 0.35 * mag',
  delayRounds: 0.1,
  dragKey: KEY_DRAG,
  dragDef: CHRONO_DRAG,
});

const UP_BOLT_ENTROPY = makeChronoBolt({
  name: 'Chrono Bolt: Entropy Sand',
  pace: 'standard',
  formula: '1d8 + 0.75 * aim + 0.35 * mag',
  delayRounds: 0.2,
  dragKey: KEY_DRAG_ENTROPY,
  dragDef: ENTROPY_DRAG,
});

const BASE_ACCEL = makeAccelerate({
  name: 'Accelerate',
  desc: 'Hasten an ally within 8 tiles by 40% and grant Quicksilver for 2 rounds.',
  ops: [
    { op: 'hasten', share: 0.4 },
    { op: 'applyStatus', key: KEY_QUICKSILVER, def: QUICKSILVER, duration: rounds(2) },
  ],
});

const UP_ACCEL_TWIN = makeAccelerate({
  name: 'Accelerate: Twin Tempo',
  desc: 'Hasten an ally within 8 tiles by 40%, grant Quicksilver for 2 rounds, and pulse Twin Tempo to allies within 2 tiles.',
  ops: [
    { op: 'hasten', share: 0.4 },
    { op: 'applyStatus', key: KEY_QUICKSILVER, def: QUICKSILVER, duration: rounds(2) },
    { op: 'applyStatus', key: KEY_TWIN_TEMPO, def: TWIN_TEMPO_DEF, duration: rounds(1) },
  ],
});

const UP_ACCEL_OVERCLOCK = makeAccelerate({
  name: 'Accelerate: Overclock',
  desc: 'Hasten an ally within 8 tiles by 50% and grant Overclock for 2 rounds.',
  ops: [
    { op: 'hasten', share: 0.5 },
    { op: 'applyStatus', key: KEY_OVERCLOCK, def: OVERCLOCK, duration: rounds(2) },
  ],
});

const BASE_STASIS = makeStasisField({
  name: 'Stasis Field',
  desc: 'Blast a 2-tile area within 7 tiles for arcane damage, delay turns, fill 30% stagger, and leave a 2-round Time Warp zone.',
  cooldownRounds: 3,
  delayRounds: 0.3,
  zoneRounds: 2,
});

const UP_STASIS_FROZEN = makeStasisField({
  name: 'Stasis Field: Frozen Second',
  desc: 'Blast a 2-tile area within 7 tiles for arcane damage, delay turns, fill 30% stagger, hold foes for 1 round, and leave a 2-round Time Warp zone.',
  cooldownRounds: 4,
  delayRounds: 0.3,
  zoneRounds: 2,
  extraOps: [{ op: 'applyStatus', key: KEY_FROZEN, def: FROZEN_SECOND, duration: rounds(1) }],
});

const UP_STASIS_TIDAL = makeStasisField({
  name: 'Stasis Field: Tidal Clock',
  desc: 'Blast a 2-tile area within 7 tiles for arcane damage, delay turns, fill 30% stagger, and leave a 3-round Time Warp zone.',
  cooldownRounds: 3,
  delayRounds: 0.4,
  zoneRounds: 3,
});

const BASE_SLIP = makeTimeSlip();

/** Base Chronokeeper signature (before skill-tree nodes are folded on top). */
export const CHRONOKEEPER_SIGNATURE: ClassSignature = {
  className: 'Chronokeeper',
  bonus: { ctl: 2, dis: 2, haste: 6 },
  worn: BASE_HOURGLASS,
  actives: [BASE_BOLT, BASE_ACCEL, BASE_STASIS, BASE_SLIP],
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

/** Full 7-depth, 3-branch, 23-buyable (26-node) Epic Chronokeeper skill tree. */
export const CHRONOKEEPER_TREE: ClassTree = {
  className: 'Chronokeeper',
  rarity: 'epic',
  nodes: [
    // Depth 1: Root (1)
    node('chrono-root', 1, 'First Second', 'Gain 4 Control, 3 Discipline, and 6 ability haste.', [], [
      bonus({ ctl: 4, dis: 3, haste: 6 }),
    ]),

    // Depth 2: Three branches (3) — Dial (A), Haste (B), Stasis (C)
    node('chrono-a2', 2, 'Measured Dial', 'Gain 4 Control and 5 accuracy.', ['chrono-root'], [
      bonus({ ctl: 4, aim: 5 }),
    ]),
    node('chrono-b2', 2, 'Quickened Step', 'Gain 4 Control and 6 speed.', ['chrono-root'], [
      bonus({ ctl: 4, speed: 6 }),
    ]),
    node('chrono-c2', 2, 'Still Anchor', 'Gain 4 Discipline and 5 potency.', ['chrono-root'], [
      bonus({ dis: 4, potency: 5 }),
    ]),

    // Depth 3: Branch splits (6)
    node('chrono-a3x', 3, 'Fracture Line', 'Gain 5% magic penetration and 5 flat magic penetration.', ['chrono-a2'], [
      bonus({ resistPen: 5, resistPenFlat: 5 }),
    ]),
    node('chrono-a3y', 3, 'Pinpoint Strike', 'Gain 4 accuracy and 0.08 crit multiplier.', ['chrono-a2'], [
      bonus({ aim: 4, critSize: 8 }),
    ]),
    node('chrono-b3x', 3, 'Slipstream', 'Gain 8 ability haste and 4% ability cost reduction.', ['chrono-b2'], [
      bonus({ haste: 8, costCut: 4 }),
    ]),
    node('chrono-b3y', 3, 'Fleet Pendulum', 'Gain 8 speed and 5 max mana.', ['chrono-b2'], [
      bonus({ speed: 8, manaMax: 5 }),
    ]),
    node('chrono-c3x', 3, 'Iron Hour', 'Gain 30 max HP and 6 tenacity.', ['chrono-c2'], [
      bonus({ hpMax: 30, tenacity: 6 }),
    ]),
    node('chrono-c3y', 3, 'Heavy Sands', 'Gain 6 potency and 5 Will.', ['chrono-c2'], [
      bonus({ potency: 6, will: 5 }),
    ]),

    // Depth 4: Deepening (6)
    node('chrono-a4x', 4, 'Temporal Rift', 'Gain 6% magic penetration and 6 flat magic penetration.', ['chrono-a3x'], [
      bonus({ resistPen: 6, resistPenFlat: 6 }),
    ]),
    node('chrono-a4y', 4, 'Sharp Moment', 'Gain 5 Control and 0.1 crit multiplier.', ['chrono-a3y'], [
      bonus({ ctl: 5, critSize: 10 }),
    ]),
    node('chrono-b4x', 4, 'Cycle Cut', 'Gain 8 ability haste and 4% ability cost reduction.', ['chrono-b3x'], [
      bonus({ haste: 8, costCut: 4 }),
    ]),
    node('chrono-b4y', 4, 'Borrowed Tempo', 'Gain 8 speed and 6 max mana.', ['chrono-b3y'], [
      bonus({ speed: 8, manaMax: 6 }),
    ]),
    node('chrono-c4x', 4, 'Steady Pulse', 'Gain 35 max HP and 8 Will.', ['chrono-c3x'], [
      bonus({ hpMax: 35, will: 8 }),
    ]),
    node('chrono-c4y', 4, 'Binding Hour', 'Gain 7 potency and 6 tenacity.', ['chrono-c3y'], [
      bonus({ potency: 7, tenacity: 6 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('chrono-a5-l', 5, 'Rewind Strike', 'Upgrade Chrono Bolt to a quick action with higher arcane damage and 10% round delay.', ['chrono-a4x', 'chrono-a4y'], [
      replaceActive(ID_BOLT, UP_BOLT_REWIND),
    ], { forkGroup: 'chrono-a5' }),
    node('chrono-a5-r', 5, 'Entropy Sand', 'Upgrade Chrono Bolt to expose targets for 1 extra crit face. Your damaging attacks and spells deal up to 15% more damage to foes above half HP.', ['chrono-a4x', 'chrono-a4y'], [
      replaceActive(ID_BOLT, UP_BOLT_ENTROPY),
      scaler({ measure: 'target', dir: 'over', start: 0.5, scale: 0.15 }),
    ], { forkGroup: 'chrono-a5' }),

    node('chrono-b5-l', 5, 'Twin Tempo', 'Upgrade Accelerate to hasten and grant Quicksilver to the aimed ally and allies within 2 tiles.', ['chrono-b4x', 'chrono-b4y'], [
      replaceActive(ID_ACCEL, UP_ACCEL_TWIN),
    ], { forkGroup: 'chrono-b5' }),
    node('chrono-b5-r', 5, 'Overclock', 'Upgrade Accelerate to 50% hasten and Overclock with 20% speed and 20% damage dealt.', ['chrono-b4x', 'chrono-b4y'], [
      replaceActive(ID_ACCEL, UP_ACCEL_OVERCLOCK),
    ], { forkGroup: 'chrono-b5' }),

    node('chrono-c5-l', 5, 'Frozen Second', 'Upgrade Stasis Field to hold caught foes for 1 round on a 4-round cooldown.', ['chrono-c4x', 'chrono-c4y'], [
      replaceActive(ID_STASIS, UP_STASIS_FROZEN),
    ], { forkGroup: 'chrono-c5' }),
    node('chrono-c5-r', 5, 'Tidal Clock', 'Upgrade Stasis Field to delay foes by 40% of a round and keep Time Warp active for 3 rounds.', ['chrono-c4x', 'chrono-c4y'], [
      replaceActive(ID_STASIS, UP_STASIS_TIDAL),
    ], { forkGroup: 'chrono-c5' }),

    // Depth 6: Branch Capstones (3)
    node('chrono-a6', 6, 'Chronomancer Aim', 'Gain 6 Control, 6 accuracy, and 8 flat magic penetration.', ['chrono-a5-l', 'chrono-a5-r'], [
      bonus({ ctl: 6, aim: 6, resistPenFlat: 8 }),
    ], { parentMode: 'any' }),
    node('chrono-b6', 6, 'Endless Cadence', 'Gain 8 speed, 8 ability haste, and 6 max mana.', ['chrono-b5-l', 'chrono-b5-r'], [
      bonus({ speed: 8, haste: 8, manaMax: 6 }),
    ], { parentMode: 'any' }),
    node('chrono-c6', 6, 'Warden of Stasis', 'Gain 6 Discipline, 40 max HP, and 8 potency.', ['chrono-c5-l', 'chrono-c5-r'], [
      bonus({ dis: 6, hpMax: 40, potency: 8 }),
    ], { parentMode: 'any' }),

    // Depth 7: Epic Capstone (1)
    node('chrono-cap', 7, 'Master of Hours', 'Upgrade Hourglass Pulse to Master of Hours and gain 6 Control, 6 Discipline, and 6 ability haste.', ['chrono-a6', 'chrono-b6', 'chrono-c6'], [
      replaceWorn(KEY_HOURGLASS, MASTER_HOURGLASS),
      bonus({ ctl: 6, dis: 6, haste: 6 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
