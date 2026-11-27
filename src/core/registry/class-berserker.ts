// class-berserker.ts: Rare Berserker (Fighter branch, str+vit) signature kit and full 18-node / 16-buyable tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
//
// Relentless HP-spending melee bruiser: builds Bloodrage when struck or roaring, heals on kills, and peaks under half HP.
// Root budget at rank C (`RULES.rarities.rare.rank = 'C'`, level 20, settled.md ~12-point Rare unspecialized root):
// - Sheet bonus `{ str: 1, vit: 1 }` spends 2.00 pts.
// - Worn `Undying Fury` builds Bloodrage on `struck` (cap 4, +5% dealt and +4% speed per stack, never lowering armor)
//   and heals `0.07 * hpmax` once a round on `kill`. Exact root spend verified inside <= 12.0 pts by tests/rare-classes.test.ts.
// - Actives (`Reckless Cleave`, `Blood Roar`) spend max HP shares and stay inside worth.ts C-rank budgets.
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { LandOp, StackDef, StatusDef, StatusKey, Tiers, UseOp } from '../combat/effect-ops.ts';
import type { Limit } from '../combat/triggers.ts';
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
  if (!id) throw new Error(`Invalid Berserker node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Berserker formula "${text}"`);
  return p.formula;
};
const tiered = (e: string, d: string, c: string, b: string, a: string, s: string): Tiers<Formula> =>
  [f(e), f(d), f(c), f(b), f(a), f(s)];
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const ROUND: Limit = { kind: 'round' };

const KEY_FURY = statusKey('zerk-undying-fury');
const KEY_FURY_UP = statusKey('zerk-crimson-berserk');
const KEY_BLOODRAGE = statusKey('zerk-bloodrage');
const KEY_BLOODRAGE_UP = statusKey('zerk-bloodrage-ii');
const KEY_REND = statusKey('zerk-rending-wound');
const KEY_UNSTOPPABLE = statusKey('zerk-unstoppable');
const KEY_ROAR_RUSH = statusKey('zerk-roar-rush');
const KEY_FRENZY_RUSH = statusKey('zerk-frenzy-rush');

const ID_CLEAVE = abilityId('zerk-reckless-cleave');
const ID_ROAR = abilityId('zerk-blood-roar');

// ── statuses ──

const BLOODRAGE: StackDef = {
  label: 'Bloodrage',
  desc: 'Each stack adds 5% damage dealt and 4% speed (up to 4 stacks) for 3 rounds.',
  ops: [
    { op: 'share', on: 'dealt', pct: 5 },
    { op: 'speed', pct: 4 },
  ],
  stack: {
    cap: 4,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: null,
  },
};

const BLOODRAGE_UP: StackDef = {
  label: 'Bloodrage II',
  desc: 'Each stack adds 7% damage dealt and 5% speed (up to 5 stacks) for 3 rounds.',
  ops: [
    { op: 'share', on: 'dealt', pct: 7 },
    { op: 'speed', pct: 5 },
  ],
  stack: {
    cap: 5,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: null,
  },
};

const RENDING_WOUND: StatusDef = {
  label: 'Rending Wound',
  desc: 'Takes physical bleed damage each round and attacks against this target crit on 1 more die face.',
  ops: [
    { op: 'damage', type: 'physical', when: 'turn', amount: tiered('1d4', '1d6', '1d8', '2d6', '2d8', '3d6') },
    { op: 'sheet', key: 'exposed', amount: 1 },
  ],
};

const UNSTOPPABLE_DEF: StatusDef = {
  label: 'Unstoppable',
  desc: 'Blocks harmful statuses from foes for 1 round.',
  ops: [{ op: 'safeguard' }],
};

// Self-curing pulse so Blood Roar refunds its own user's turn time without leaving a blank status behind.
function makeRoarRush(key: StatusKey, label: string, pct: number): StatusDef {
  return {
    label,
    desc: `Refunds ${pct}% of your turn when you use Blood Roar.`,
    ops: [],
    triggers: [
      {
        on: 'statusGained',
        key,
        to: 'self',
        limit: ROUND,
        ops: [
          { op: 'refund', pct },
          { op: 'cureStatus', key },
        ],
      },
    ],
  };
}

const ROAR_RUSH: StatusDef = makeRoarRush(KEY_ROAR_RUSH, 'Blood Rush', 25);
const FRENZY_RUSH: StatusDef = makeRoarRush(KEY_FRENZY_RUSH, 'Frenzy Surge', 35);

function makeFury(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly rageKey: StatusKey;
  readonly rageDef: StackDef;
  readonly killOps: readonly LandOp[];
}): ClassWorn {
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [],
      triggers: [
        {
          on: 'struck',
          tag: null,
          to: 'self',
          limit: ROUND,
          ops: [{ op: 'applyStatus', key: o.rageKey, def: o.rageDef, duration: rounds(3) }],
        },
        {
          on: 'kill',
          tag: null,
          to: 'self',
          limit: ROUND,
          ops: o.killOps,
        },
      ],
    },
  };
}

const BASE_FURY: ClassWorn = makeFury({
  key: KEY_FURY,
  label: 'Undying Fury',
  desc: 'Once a round when struck, gain 1 stack of Bloodrage for 3 rounds. Once a round when you defeat a foe, heal 7% of max HP.',
  rageKey: KEY_BLOODRAGE,
  rageDef: BLOODRAGE,
  killOps: [{ op: 'heal', when: 'use', amount: f('0.07 * hpmax') }],
});

const CRIMSON_BERSERK: ClassWorn = makeFury({
  key: KEY_FURY_UP,
  label: 'Crimson Berserk',
  desc: 'Once a round when struck, gain 1 stack of Bloodrage II (up to 5 stacks, 7% damage dealt and 5% speed each). Once a round when you defeat a foe, heal 14% of max HP and refund 35% of your turn.',
  rageKey: KEY_BLOODRAGE_UP,
  rageDef: BLOODRAGE_UP,
  killOps: [
    { op: 'heal', when: 'use', amount: f('0.14 * hpmax') },
    { op: 'refund', pct: 35 },
  ],
});

// ── active ability builders ──

function makeRecklessCleave(o: {
  readonly name: string;
  readonly formula: string;
  readonly hpShare: number;
  readonly pace?: 'standard' | 'heavy';
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('strike', {
    id: ID_CLEAVE,
    name: o.name,
    aim: 'foe',
    range: tiles(1),
    shape: { kind: 'touch', reach: tiles(1) },
    delivery: { kind: 'travel', windup: tick(R.fight.abilityKinds.strike.windup), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [...(o.extraOps ?? [])],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 7, time: cost(R.fight.cost[o.pace ?? 'standard']), cooldown: rounds(1) },
    prices: [{ kind: 'hp', amount: { kind: 'share', share: o.hpShare } }],
  };
}

function makeBloodRoar(o: {
  readonly name: string;
  readonly shieldFormula: string;
  readonly cooldownRounds: number;
  readonly rushKey: StatusKey;
  readonly rushDef: StatusDef;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('support', {
    id: ID_ROAR,
    name: o.name,
    aim: 'self',
    shape: { kind: 'self' },
    range: tiles(0),
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'shield', by: 'hand', formula: f(o.shieldFormula) },
    ops: [
      { op: 'applyStatus', key: KEY_BLOODRAGE, def: BLOODRAGE, duration: rounds(3), stacks: 2 },
      { op: 'applyStatus', key: o.rushKey, def: o.rushDef, duration: rounds(1) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 6, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds) },
    prices: [{ kind: 'hp', amount: { kind: 'share', share: 0.08 } }],
  };
}

const BASE_CLEAVE = makeRecklessCleave({
  name: 'Reckless Cleave',
  formula: '1d10 + 1.0 * phys',
  hpShare: 0.06,
});

const UP_CLEAVE_REND = makeRecklessCleave({
  name: 'Reckless Cleave: Rending Cleave',
  formula: '2d8 + 1.15 * phys',
  hpShare: 0.06,
  pace: 'heavy',
  extraOps: [{ op: 'applyStatus', key: KEY_REND, def: RENDING_WOUND, duration: rounds(2) }],
});

const UP_CLEAVE_EXEC = makeRecklessCleave({
  name: 'Reckless Cleave: Execution Swing',
  formula: '1d10 + 1.0 * phys',
  hpShare: 0.1,
  extraOps: [{ op: 'stagger', share: 0.2 }],
});

const BASE_ROAR = makeBloodRoar({
  name: 'Blood Roar',
  shieldFormula: '0.12 * hpmax',
  cooldownRounds: 3,
  rushKey: KEY_ROAR_RUSH,
  rushDef: ROAR_RUSH,
});

const UP_ROAR_UNSTOPPABLE = makeBloodRoar({
  name: 'Blood Roar: Unstoppable Rage',
  shieldFormula: '0.16 * hpmax',
  cooldownRounds: 3,
  rushKey: KEY_ROAR_RUSH,
  rushDef: ROAR_RUSH,
  extraOps: [{ op: 'applyStatus', key: KEY_UNSTOPPABLE, def: UNSTOPPABLE_DEF, duration: rounds(1) }],
});

const UP_ROAR_FRENZY = makeBloodRoar({
  name: 'Blood Roar: Frenzy Rush',
  shieldFormula: '0.12 * hpmax',
  cooldownRounds: 2,
  rushKey: KEY_FRENZY_RUSH,
  rushDef: FRENZY_RUSH,
});

/** Base Berserker signature (before skill-tree nodes are folded on top). */
export const BERSERKER_SIGNATURE: ClassSignature = {
  className: 'Berserker',
  bonus: { str: 1, vit: 1 },
  worn: BASE_FURY,
  actives: [BASE_CLEAVE, BASE_ROAR],
};

// ── 18-node / 16-buyable Rare skill tree ──

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
const upgradeStatus = (targetKey: StatusKey, key: StatusKey, def: StatusDef): NodeGift => ({ kind: 'upgrade-status', targetKey, key, def });

/** Full 7-depth, 2-branch, 16-buyable (18-node) Rare Berserker skill tree (Fury / Rampage). */
export const BERSERKER_TREE: ClassTree = {
  className: 'Berserker',
  rarity: 'rare',
  nodes: [
    // Depth 1: Root (1)
    node('zerk-root', 1, 'Pit Hardened', 'Gain 2 Strength and 1 Vitality.', [], [
      bonus({ str: 2, vit: 1 }),
    ]),

    // Depth 2: Two branches (2)
    node('zerk-a2', 2, 'Savage Grip', 'Gain 2 Strength and 3% armor penetration.', ['zerk-root'], [
      bonus({ str: 2, armorPen: 3 }),
    ]),
    node('zerk-b2', 2, 'Scarred Hide', 'Gain 2 Vitality and 10 max HP.', ['zerk-root'], [
      bonus({ vit: 2, hpMax: 10 }),
    ]),

    // Depth 3: Branch splits (4)
    node('zerk-a3x', 3, 'Cleaving Force', 'Gain 3 Strength and 4 flat armor penetration.', ['zerk-a2'], [
      bonus({ str: 3, armorPenFlat: 4 }),
    ]),
    node('zerk-a3y', 3, 'Blood Momentum', 'Gain 6 ability haste and 3 speed.', ['zerk-a2'], [
      bonus({ haste: 6, speed: 3 }),
    ]),
    node('zerk-b3x', 3, 'Battle Scarred', 'Gain 15 max HP and 3 tenacity.', ['zerk-b2'], [
      bonus({ hpMax: 15, tenacity: 3 }),
    ]),
    node('zerk-b3y', 3, 'Thirst for Battle', 'Gain 2 Vitality and 3% lifesteal.', ['zerk-b2'], [
      bonus({ vit: 2, drain: 3 }),
    ]),

    // Depth 4: Deepening (4)
    node('zerk-a4x', 4, 'Sundered Edge', 'Gain 3 Strength, 4% armor penetration, and 4 flat armor penetration.', ['zerk-a3x'], [
      bonus({ str: 3, armorPen: 4, armorPenFlat: 4 }),
    ]),
    node('zerk-a4y', 4, 'Relentless Pace', 'Gain 8 ability haste and 4 speed.', ['zerk-a3y'], [
      bonus({ haste: 8, speed: 4 }),
    ]),
    node('zerk-b4x', 4, 'Iron Nerve', 'Gain 20 max HP and 4 tenacity.', ['zerk-b3x'], [
      bonus({ hpMax: 20, tenacity: 4 }),
    ]),
    node('zerk-b4y', 4, 'Red Vitality', 'Gain 3 Vitality and 4% lifesteal.', ['zerk-b3y'], [
      bonus({ vit: 3, drain: 4 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (4 nodes, 2 buyable)
    node('zerk-a5-l', 5, 'Rending Cleave', 'Upgrade Reckless Cleave to a heavy strike with higher physical damage and a 2-round Rending Wound that bleeds and exposes foes.', ['zerk-a4x', 'zerk-a4y'], [
      replaceActive(ID_CLEAVE, UP_CLEAVE_REND),
    ], { forkGroup: 'zerk-a5' }),
    node('zerk-a5-r', 5, 'Execution Swing', 'Upgrade Reckless Cleave to pay 10% max HP, add 20% stagger, and deal up to 25% more damage while you are below half HP.', ['zerk-a4x', 'zerk-a4y'], [
      replaceActive(ID_CLEAVE, UP_CLEAVE_EXEC),
      scaler({ measure: 'user', dir: 'under', start: 0.5, scale: 0.25 }),
    ], { forkGroup: 'zerk-a5' }),

    node('zerk-b5-l', 5, 'Unstoppable Rage', 'Upgrade Blood Roar to a 16% max HP shield and 1 round of Unstoppable safeguard against harmful statuses.', ['zerk-b4x', 'zerk-b4y'], [
      replaceActive(ID_ROAR, UP_ROAR_UNSTOPPABLE),
    ], { forkGroup: 'zerk-b5' }),
    node('zerk-b5-r', 5, 'Frenzy Rush', 'Upgrade Blood Roar to a 2-round cooldown and refund 35% of your turn.', ['zerk-b4x', 'zerk-b4y'], [
      replaceActive(ID_ROAR, UP_ROAR_FRENZY),
    ], { forkGroup: 'zerk-b5' }),

    // Depth 6: Branch Capstones (2)
    node('zerk-a6', 6, 'Slaughter Rhythm', 'Gain 4 Strength, 5% armor penetration, and 6 ability haste.', ['zerk-a5-l', 'zerk-a5-r'], [
      bonus({ str: 4, armorPen: 5, haste: 6 }),
    ], { parentMode: 'any' }),
    node('zerk-b6', 6, 'Bloodied Frame', 'Gain 4 Vitality, 25 max HP, and 4% lifesteal.', ['zerk-b5-l', 'zerk-b5-r'], [
      bonus({ vit: 4, hpMax: 25, drain: 4 }),
    ], { parentMode: 'any' }),

    // Depth 7: Rare Capstone (1)
    node('zerk-cap', 7, 'Crimson Berserk', 'Upgrade Undying Fury to Crimson Berserk, upgrade Bloodrage to Bloodrage II, and gain 4 Strength, 4 Vitality, and 20 max HP.', ['zerk-a6', 'zerk-b6'], [
      replaceWorn(KEY_FURY, CRIMSON_BERSERK),
      upgradeStatus(KEY_BLOODRAGE, KEY_BLOODRAGE_UP, BLOODRAGE_UP),
      bonus({ str: 4, vit: 4, hpMax: 20 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
