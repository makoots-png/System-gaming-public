// class-hemomancer.ts: Mythic Hemomancer (vit+pow) signature kit and full 38-node / 32-buyable skill tree.
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
import { abilityOf } from './ability-kinds.ts';
import type { Scaler } from './scalers.ts';
import type { ClassNodeDef, ClassTree, ClassWorn, NodeGift, TreeDepth } from './class-trees.ts';
import type { ClassSignature } from './class-powers.ts';

const R = RULES;
const nid = (s: string): ClassNodeId => {
  const id = parseClassNodeId(s);
  if (!id) throw new Error(`Invalid Hemomancer node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Hemomancer formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };
const ONCE: Limit = { kind: 'fight', n: 1 };
const area = (radius: number, on: 'allies' | 'foes'): Reach => ({ kind: 'area', radius: tiles(radius), on });

const TAG_TRANSFUSION = tag('transfusion');
const KEY_PACT = statusKey('hemo-crimson-pact');
const KEY_PACT_LORD = statusKey('hemo-crimson-pact-lord');
const KEY_RUSH = statusKey('hemo-crimson-rush');
const KEY_FRENZY = statusKey('hemo-crimson-frenzy');
const KEY_POOL_WARD = statusKey('hemo-pool-ward');
const KEY_POOL_TIDE = statusKey('hemo-pool-tide');
const KEY_POOL_TIDE_UP = statusKey('hemo-pool-tide-ii');
const KEY_POOL_SLOW = statusKey('hemo-pool-slow');
const KEY_TIDES_SLOW = statusKey('hemo-tides-slow');
const KEY_PLAGUE = statusKey('hemo-hemoplague');
const KEY_PLAGUE_UP = statusKey('hemo-hemoplague-ii');

const ID_TRANSFUSION = abilityId('hemo-transfusion');
const ID_POOL = abilityId('hemo-sanguine-pool');
const ID_TIDES = abilityId('hemo-tides-of-blood');
const ID_PLAGUE = abilityId('hemo-hemoplague');

// ── statuses ──

const CRIMSON_FRENZY: StatusDef = {
  label: 'Crimson Frenzy',
  desc: 'Your next Transfusion deals bonus damage and heals extra max HP, then consumes this status.',
  ops: [],
  triggers: [
    { on: 'hitDealt', tag: TAG_TRANSFUSION, to: 'self', limit: EACH, ops: [{ op: 'cureStatus', key: KEY_FRENZY }] },
  ],
};

const CRIMSON_RUSH: StackDef = {
  label: 'Crimson Rush',
  desc: 'At 2 stacks, spend all stacks to gain Crimson Frenzy for your next Transfusion.',
  ops: [],
  stack: {
    cap: 2,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: {
      at: { kind: 'count', n: 2 },
      to: { kind: 'bearer' },
      then: 'spend',
      ops: [{ op: 'applyStatus', key: KEY_FRENZY, def: CRIMSON_FRENZY, duration: null }],
    },
  },
};

const POOL_WARD: StatusDef = {
  label: 'Sanguine Pool',
  desc: 'Untargetable for 1 round. Acting against a foe ends this early.',
  ops: [{ op: 'untargetable' }],
};

const POOL_SLOW: StatusDef = {
  label: 'Sanguine Chill',
  desc: 'Speed reduced by 25%.',
  ops: [{ op: 'speed', pct: -25 }],
};

const TIDES_SLOW: StatusDef = {
  label: 'Bloodlogged',
  desc: 'Speed reduced by 20%.',
  ops: [{ op: 'speed', pct: -20 }],
};

function makeCrimsonPact(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly hpToMag: string;
  readonly magToHp: string;
  readonly drainToMag: string;
  readonly transfusionHeal: string;
  readonly extraOps?: readonly Op[];
  readonly extraTriggers?: readonly Trigger[];
}): ClassWorn {
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [
        { op: 'sheet', key: 'mag', amount: f(o.hpToMag) },
        { op: 'sheet', key: 'hpMax', amount: f(o.magToHp) },
        { op: 'sheet', key: 'mag', amount: f(o.drainToMag) },
        ...(o.extraOps ?? []),
      ],
      // Order matters: Trigger 1 reads `stacks(hemo-crimson-frenzy)` before Trigger 2 advances `hemo-crimson-rush`.
      // On a 1->2 hit, `hemo-crimson-frenzy` is absent from the hitDealt snapshot so it survives for the next Transfusion.
      triggers: [
        { on: 'hitDealt', tag: TAG_TRANSFUSION, to: 'self', limit: EACH, ops: [{ op: 'heal', when: 'use', amount: f(o.transfusionHeal) }] },
        { on: 'hitDealt', tag: null, to: 'self', limit: ROUND, ops: [{ op: 'applyStatus', key: KEY_RUSH, def: CRIMSON_RUSH, duration: null }] },
        ...(o.extraTriggers ?? []),
      ],
    },
  };
}

const BASE_PACT: ClassWorn = makeCrimsonPact({
  key: KEY_PACT,
  label: 'Crimson Pact',
  desc: 'Converts max HP and lifesteal into arcane power, converts arcane power into max HP, builds Crimson Rush on hit, and heals on Transfusion.',
  hpToMag: '0.04 * hpmax',
  magToHp: '0.3 * mag',
  drainToMag: '0.4 * drain * mag',
  transfusionHeal: '0.16 * (2d6 + mag) * (1 + drain) + 0.05 * hpmax * stacks(hemo-crimson-frenzy)',
});

const LORD_PACT: ClassWorn = makeCrimsonPact({
  key: KEY_PACT_LORD,
  label: 'Crimson Pact: Lord of Blood',
  desc: `Deepens Crimson Pact conversions, boosts Transfusion healing, adds 3% damage dealt, and grants a blood shield below ${Math.round(R.fight.kit.lowHpAt * 100)}% HP once per fight.`,
  hpToMag: '0.055 * hpmax',
  magToHp: '0.35 * mag',
  drainToMag: '0.5 * drain * mag',
  transfusionHeal: '0.18 * (2d6 + mag) * (1 + drain) + 0.05 * hpmax * stacks(hemo-crimson-frenzy)',
  extraOps: [
    { op: 'share', on: 'dealt', pct: 3 },
  ],
  extraTriggers: [
    { on: 'lowHp', to: 'self', limit: ONCE, ops: [{ op: 'shield', amount: f('0.08 * hpmax') }] },
  ],
});

// ── active ability builders ──

function makeTransfusion(o: { readonly name: string; readonly formula: string; readonly cooldownRounds: number }): Ability {
  const base = abilityOf('curse', {
    id: ID_TRANSFUSION,
    name: o.name,
    range: tiles(5),
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
  }, R);
  return {
    ...base,
    tags: [TAG_TRANSFUSION],
    cost: { ...base.cost, mana: 0, fatigue: 6, cooldown: rounds(o.cooldownRounds) },
  };
}

function makeSanguinePool(o: {
  readonly name: string;
  readonly tideKey: StatusKey;
  readonly hpShare: number;
  readonly cooldownRounds: number;
  readonly speedPct: number;
  readonly auraFormula: string;
}): Ability {
  const tide: StatusDef = {
    label: 'Sanguine Tide',
    desc: `Speed +${o.speedPct}%. Damages and slows foes within 2 tiles on entry and when you move.`,
    ops: [{ op: 'speed', pct: o.speedPct }],
    triggers: [
      {
        on: 'statusGained',
        key: o.tideKey,
        to: area(2, 'foes'),
        limit: EACH,
        ops: [
          { op: 'damage', type: 'arcane', when: 'use', amount: f(o.auraFormula) },
          { op: 'applyStatus', key: KEY_POOL_SLOW, def: POOL_SLOW, duration: rounds(1) },
        ],
      },
      {
        on: 'moved',
        to: area(2, 'foes'),
        limit: ROUND,
        ops: [
          { op: 'damage', type: 'arcane', when: 'use', amount: f(o.auraFormula) },
          { op: 'applyStatus', key: KEY_POOL_SLOW, def: POOL_SLOW, duration: rounds(1) },
        ],
      },
    ],
  };
  const base = abilityOf('support', {
    id: ID_POOL,
    name: o.name,
    aim: 'self',
    shape: { kind: 'self' },
    range: tiles(0),
    delivery: { kind: 'sure' },
    foesOnly: true,
    effect: null,
    ops: [
      { op: 'applyStatus', key: KEY_POOL_WARD, def: POOL_WARD, duration: rounds(1) },
      { op: 'applyStatus', key: o.tideKey, def: tide, duration: rounds(1) },
    ],
    zone: {
      name: o.name,
      duration: rounds(1),
      around: tiles(2),
      endsWithOwner: true,
      grow: null,
      ops: [{ op: 'speed', pct: -25 }],
    },
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 6, cooldown: rounds(o.cooldownRounds) },
    prices: [{ kind: 'hp', amount: { kind: 'share', share: o.hpShare } }],
  };
}

function makeTidesOfBlood(o: {
  readonly name: string;
  readonly hpShare: number;
  readonly cooldownRounds: number;
  readonly formula: string;
  readonly channel: { readonly growth: 'linear'; readonly max: number } | null;
}): Ability {
  const base = abilityOf('blast', {
    id: ID_TIDES,
    name: o.name,
    aim: 'place',
    range: tiles(0),
    shape: { kind: 'radius', radius: tiles(3), ring: null },
    delivery: { kind: 'travel', windup: tick(100), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops: [{ op: 'applyStatus', key: KEY_TIDES_SLOW, def: TIDES_SLOW, duration: rounds(1) }],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
    channel: o.channel,
    prices: [{ kind: 'hp', amount: { kind: 'share', share: o.hpShare } }],
  };
}

function makeHemoplague(o: {
  readonly name: string;
  readonly statusKey: StatusKey;
  readonly hpShare: number;
  readonly uses: number;
  readonly takenPct: number;
  readonly popFormula: string;
  readonly sourceHealShare: number;
}): Ability {
  const plagueDef: StatusDef = {
    label: o.name,
    desc: `Takes ${o.takenPct}% more damage for 2 rounds. Detonates when it ends and heals the caster. Curing cancels the detonation.`,
    ops: [{ op: 'share', on: 'taken', pct: o.takenPct }],
    end: {
      cleanse: 'cancel',
      sourceHealShare: o.sourceHealShare,
      ops: [{ op: 'damage', type: 'arcane', when: 'use', amount: f(o.popFormula) }],
    },
  };
  const base = abilityOf('curse', {
    id: ID_PLAGUE,
    name: o.name,
    aim: 'place',
    range: tiles(6),
    shape: { kind: 'radius', radius: tiles(3), ring: null },
    delivery: { kind: 'sure' },
    foesOnly: true,
    effect: null,
    ops: [{ op: 'applyStatus', key: o.statusKey, def: plagueDef, duration: rounds(2) }],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 8, cooldown: rounds(2) },
    prices: [{ kind: 'hp', amount: { kind: 'share', share: o.hpShare } }],
    gates: [{ kind: 'uses', per: 'fight', n: o.uses }],
  };
}

const BASE_TRANSFUSION = makeTransfusion({
  name: 'Transfusion',
  formula: '(2d6 + 0.9 * mag) * (1 + 0.6 * drain) * (1 + 0.75 * stacks(hemo-crimson-frenzy))',
  cooldownRounds: 2,
});

const UP_TRANSFUSION = makeTransfusion({
  name: 'Transfusion: Exsanguinate',
  formula: '(2d6 + mag) * (1 + 0.75 * drain) * (1 + 0.75 * stacks(hemo-crimson-frenzy))',
  cooldownRounds: 1,
});

const BASE_POOL = makeSanguinePool({
  name: 'Sanguine Pool',
  tideKey: KEY_POOL_TIDE,
  hpShare: 0.2,
  cooldownRounds: 4,
  speedPct: 25,
  auraFormula: '(1d8 + 0.08 * hpmax) * (1 + 0.5 * drain)',
});

const UP_POOL = makeSanguinePool({
  name: 'Sanguine Pool: Undertow',
  tideKey: KEY_POOL_TIDE_UP,
  hpShare: 0.15,
  cooldownRounds: 3,
  speedPct: 35,
  auraFormula: '(2d8 + 0.12 * hpmax) * (1 + 0.8 * drain)',
});

const BASE_TIDES = makeTidesOfBlood({
  name: 'Tides of Blood',
  hpShare: 0.1,
  cooldownRounds: 2,
  formula: '(2d8 + mag + 0.06 * hpmax) * (1 + 0.6 * drain) * (1 + 0.5 * charge)',
  channel: { growth: 'linear', max: 2 },
});

const UP_TIDES = makeTidesOfBlood({
  name: 'Tides of Blood: Riptide',
  hpShare: 0.1,
  cooldownRounds: 1,
  formula: '(2d8 + mag + 0.06 * hpmax) * (1 + 0.6 * drain)',
  channel: null,
});

const BASE_PLAGUE = makeHemoplague({
  name: 'Hemoplague',
  statusKey: KEY_PLAGUE,
  hpShare: 0.15,
  uses: 1,
  takenPct: 15,
  popFormula: '(3d8 + 1.4 * mag) * (1 + drain)',
  sourceHealShare: 0.4,
});

const UP_PLAGUE = makeHemoplague({
  name: 'Hemoplague: Virulent Strain',
  statusKey: KEY_PLAGUE_UP,
  hpShare: 0.15,
  uses: 2,
  takenPct: 18,
  popFormula: '(3d8 + 1.45 * mag) * (1 + drain)',
  sourceHealShare: 0.45,
});

/** Base Hemomancer signature (before skill-tree nodes are folded on top). */
export const HEMOMANCER_SIGNATURE: ClassSignature = {
  className: 'Hemomancer',
  bonus: { drain: 10, shieldDrain: 4 },
  worn: BASE_PACT,
  actives: [BASE_TRANSFUSION, BASE_POOL, BASE_TIDES, BASE_PLAGUE],
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

/** Full 9-depth, 3-branch, 32-buyable (38-node) Mythic Hemomancer skill tree. */
export const HEMOMANCER_TREE: ClassTree = {
  className: 'Hemomancer',
  rarity: 'mythic',
  nodes: [
    // Depth 1: Root (1)
    node('hemo-root', 1, 'Awakened Vein', 'Gain 4 Power, 4 Vitality, and 2% lifesteal.', [], [
      bonus({ pow: 4, vit: 4, drain: 2 }),
    ]),

    // Depth 2: Three branches (3)
    node('hemo-a2', 2, 'Sanguine Harvest', 'Gain 2% lifesteal and 3 Power.', ['hemo-root'], [
      bonus({ drain: 2, pow: 3 }),
    ]),
    node('hemo-b2', 2, 'Crimson Tide', 'Gain 4 Vitality and 6 ability haste.', ['hemo-root'], [
      bonus({ vit: 4, haste: 6 }),
    ]),
    node('hemo-c2', 2, 'Blood Plague', 'Gain 4 Power and 4% magic penetration.', ['hemo-root'], [
      bonus({ pow: 4, resistPen: 4 }),
    ]),

    // Depth 3: Branch splits (6)
    node('hemo-a3x', 3, 'Deep Siphon', 'Gain 2% lifesteal and 10 max HP.', ['hemo-a2'], [
      bonus({ drain: 2, hpMax: 10 }),
    ]),
    node('hemo-a3y', 3, 'Coagulate', 'Gain 2% damage to shield and 3 Power.', ['hemo-a2'], [
      bonus({ shieldDrain: 2, pow: 3 }),
    ]),
    node('hemo-b3x', 3, 'Swift Pulse', 'Gain 8 ability haste and 5 speed.', ['hemo-b2'], [
      bonus({ haste: 8, speed: 5 }),
    ]),
    node('hemo-b3y', 3, 'Thick Blood', 'Gain 5 Vitality, 10 max HP, and 6 tenacity.', ['hemo-b2'], [
      bonus({ vit: 5, hpMax: 10, tenacity: 6 }),
    ]),
    node('hemo-c3x', 3, 'Hemorrhage', 'Gain 5% magic penetration and 5 flat magic penetration.', ['hemo-c2'], [
      bonus({ resistPen: 5, resistPenFlat: 5 }),
    ]),
    node('hemo-c3y', 3, 'Crimson Eye', 'Gain 5 Power and 1 extra crit face.', ['hemo-c2'], [
      bonus({ pow: 5, critFaces: 1 }),
    ]),

    // Depth 4: Deepening (6)
    node('hemo-a4x', 4, 'Gorged Vessels', 'Gain 2% lifesteal and 4% heal and shield bonus.', ['hemo-a3x'], [
      bonus({ drain: 2, healPower: 4 }),
    ]),
    node('hemo-a4y', 4, 'Clotted Guard', 'Gain 2% damage to shield and 4 Vitality.', ['hemo-a3y'], [
      bonus({ shieldDrain: 2, vit: 4 }),
    ]),
    node('hemo-b4x', 4, 'Surging Artery', 'Gain 8 ability haste and 5 speed.', ['hemo-b3x'], [
      bonus({ haste: 8, speed: 5 }),
    ]),
    node('hemo-b4y', 4, 'Iron Marrow', 'Gain 10 max HP and 8 tenacity.', ['hemo-b3y'], [
      bonus({ hpMax: 10, tenacity: 8 }),
    ]),
    node('hemo-c4x', 4, 'Rupture Ward', 'Gain 6% magic penetration and 6 flat magic penetration.', ['hemo-c3x'], [
      bonus({ resistPen: 6, resistPenFlat: 6 }),
    ]),
    node('hemo-c4y', 4, 'Arterial Strike', 'Gain 6 Power and 0.1 crit multiplier.', ['hemo-c3y'], [
      bonus({ pow: 6, critSize: 10 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('hemo-a5-l', 5, 'Exsanguinate', 'Upgrade Transfusion to a 1-round cooldown with stronger arcane and lifesteal scaling.', ['hemo-a4x', 'hemo-a4y'], [
      replaceActive(ID_TRANSFUSION, UP_TRANSFUSION),
    ], { forkGroup: 'hemo-a5' }),
    node('hemo-a5-r', 5, 'Aegis of Blood', 'Gain 5% damage to shield, 8 Vitality, 20 max HP, and 6% heal and shield bonus.', ['hemo-a4x', 'hemo-a4y'], [
      bonus({ shieldDrain: 5, vit: 8, hpMax: 20, healPower: 6 }),
    ], { forkGroup: 'hemo-a5' }),

    node('hemo-b5-l', 5, 'Riptide', 'Upgrade Tides of Blood into an instant 1-round cooldown burst at 10% HP cost.', ['hemo-b4x', 'hemo-b4y'], [
      replaceActive(ID_TIDES, UP_TIDES),
    ], { forkGroup: 'hemo-b5' }),
    node('hemo-b5-r', 5, 'Crimson Undertow', 'Upgrade Sanguine Pool to a 3-round cooldown, 15% HP cost, 35% speed, and stronger aura damage.', ['hemo-b4x', 'hemo-b4y'], [
      replaceActive(ID_POOL, UP_POOL),
    ], { forkGroup: 'hemo-b5' }),

    node('hemo-c5-l', 5, 'Virulent Strain', 'Upgrade Hemoplague to 2 uses per fight, 18% bonus damage taken, a stronger detonation, and 45% heal.', ['hemo-c4x', 'hemo-c4y'], [
      replaceActive(ID_PLAGUE, UP_PLAGUE),
    ], { forkGroup: 'hemo-c5' }),
    node('hemo-c5-r', 5, 'Blood Tithe', 'Gain 8 Power and 8 flat magic penetration.', ['hemo-c4x', 'hemo-c4y'], [
      bonus({ pow: 8, resistPenFlat: 8 }),
    ], { forkGroup: 'hemo-c5' }),

    // Depth 6: Post-fork convergence (6)
    node('hemo-a6x', 6, 'Insatiable', 'Gain 2% lifesteal and 5 Power.', ['hemo-a5-l', 'hemo-a5-r'], [
      bonus({ drain: 2, pow: 5 }),
    ], { parentMode: 'any' }),
    node('hemo-a6y', 6, 'Blood Carapace', 'Gain 15 max HP and 2% damage to shield.', ['hemo-a5-l', 'hemo-a5-r'], [
      bonus({ hpMax: 15, shieldDrain: 2 }),
    ], { parentMode: 'any' }),
    node('hemo-b6x', 6, 'Racing Heart', 'Gain 10 ability haste and 6 speed.', ['hemo-b5-l', 'hemo-b5-r'], [
      bonus({ haste: 10, speed: 6 }),
    ], { parentMode: 'any' }),
    node('hemo-b6y', 6, 'Crimson Bastion', 'Gain 20 max HP, 10 tenacity, and 6 Vitality.', ['hemo-b5-l', 'hemo-b5-r'], [
      bonus({ hpMax: 20, tenacity: 10, vit: 6 }),
    ], { parentMode: 'any' }),
    node('hemo-c6x', 6, 'Shatter Resist', 'Gain 6% magic penetration and 6 flat magic penetration.', ['hemo-c5-l', 'hemo-c5-r'], [
      bonus({ resistPen: 6, resistPenFlat: 6 }),
    ], { parentMode: 'any' }),
    node('hemo-c6y', 6, 'Mortal Precision', 'Gain 6 Power, 1 extra crit face, and 0.1 crit multiplier.', ['hemo-c5-l', 'hemo-c5-r'], [
      bonus({ pow: 6, critFaces: 1, critSize: 10 }),
    ], { parentMode: 'any' }),

    // Depth 7: Second Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('hemo-a7-l', 7, 'Reaper Thirst', 'Gain 2% lifesteal. Your damaging attacks and spells deal up to 15% more damage to foes below half HP.', ['hemo-a6x', 'hemo-a6y'], [
      bonus({ drain: 2 }),
      scaler({ measure: 'target', dir: 'under', start: 0.5, scale: 0.15 }),
    ], { forkGroup: 'hemo-a7' }),
    node('hemo-a7-r', 7, 'Sanguine Shell', 'Gain 8 Vitality, 20 max HP, and 4% damage to shield.', ['hemo-a6x', 'hemo-a6y'], [
      bonus({ vit: 8, hpMax: 20, shieldDrain: 4 }),
    ], { forkGroup: 'hemo-a7' }),

    node('hemo-b7-l', 7, 'Blood Frenzy', 'Gain 14 ability haste, 8 Power, and 6 speed.', ['hemo-b6x', 'hemo-b6y'], [
      bonus({ haste: 14, pow: 8, speed: 6 }),
    ], { forkGroup: 'hemo-b7' }),
    node('hemo-b7-r', 7, 'Unstoppable Flow', 'Gain 10 speed, 14 tenacity, and 8 Will.', ['hemo-b6x', 'hemo-b6y'], [
      bonus({ speed: 10, tenacity: 14, will: 8 }),
    ], { forkGroup: 'hemo-b7' }),

    node('hemo-c7-l', 7, 'Titanbane', 'Gain 7 Power. Your damaging attacks and spells deal up to 20% more damage to foes with higher max HP than you.', ['hemo-c6x', 'hemo-c6y'], [
      bonus({ pow: 7 }),
      scaler({ measure: 'maxPair', dir: 'over', start: 0.5, scale: 0.2 }),
    ], { forkGroup: 'hemo-c7' }),
    node('hemo-c7-r', 7, 'Arcane Rupture', 'Gain 8% magic penetration, 10 flat magic penetration, and 1 extra crit face.', ['hemo-c6x', 'hemo-c6y'], [
      bonus({ resistPen: 8, resistPenFlat: 10, critFaces: 1 }),
    ], { forkGroup: 'hemo-c7' }),

    // Depth 8: Branch Capstones (3)
    node('hemo-a8', 8, 'Eternal Harvest', 'Gain 3% lifesteal, 6 Power, and 15 max HP.', ['hemo-a7-l', 'hemo-a7-r'], [
      bonus({ drain: 3, pow: 6, hpMax: 15 }),
    ], { parentMode: 'any' }),
    node('hemo-b8', 8, 'Undying Pulse', 'Gain 8 Vitality, 10 ability haste, 20 max HP, and 8 Will.', ['hemo-b7-l', 'hemo-b7-r'], [
      bonus({ vit: 8, haste: 10, hpMax: 20, will: 8 }),
    ], { parentMode: 'any' }),
    node('hemo-c8', 8, 'Sovereign Vein', 'Gain 8 Power, 8 flat magic penetration, and 0.1 crit multiplier.', ['hemo-c7-l', 'hemo-c7-r'], [
      bonus({ pow: 8, resistPenFlat: 8, critSize: 10 }),
    ], { parentMode: 'any' }),

    // Depth 9: Monarch Capstone (1)
    node('hemo-cap', 9, 'Lord of Blood', 'Upgrade Crimson Pact to Lord of Blood and gain 8 Power, 8 Vitality, and 3% lifesteal.', ['hemo-a8', 'hemo-b8', 'hemo-c8'], [
      replaceWorn(KEY_PACT, LORD_PACT),
      bonus({ pow: 8, vit: 8, drain: 3 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
