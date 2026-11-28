// class-bastion.ts: Rare Bastion (Tanker branch, str+vit) signature kit and full 18-node / 16-buyable tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
//
// Shield-line protector and frontline vanguard: intercepts strikes with Phalanx Guard, shoves and locks foes with
// Vanguard Slam, and anchors allies with an Unbroken Phalanx aura at capstone.
// Root budget at rank C (`RULES.rarities.rare.rank = 'C'`, level 20, settled.md ~12-point Rare unspecialized root):
// - Sheet bonus `{ vit: 1, str: 1 }` spends 2.00 pts.
// - Worn `Phalanx Oath` shields `0.03 * hpmax` once a round when struck (flat armor bonuses live in tree and capstone).
// - Actives (`Phalanx Guard`, `Vanguard Slam`) fit worth.ts C-rank budgets.
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { Op, StatusDef, StatusKey, UseOp } from '../combat/effect-ops.ts';
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
  if (!id) throw new Error(`Invalid Bastion node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Bastion formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const ROUND: Limit = { kind: 'round' };

const KEY_OATH = statusKey('bastion-phalanx-oath');
const KEY_OATH_UP = statusKey('bastion-unbroken-phalanx');
const KEY_LOCK = statusKey('bastion-phalanx-lock');
const KEY_WARD = statusKey('bastion-phalanx-ward');

const ID_GUARD = abilityId('bastion-phalanx-guard');
const ID_SLAM = abilityId('bastion-vanguard-slam');

// ── statuses ──

const PHALANX_LOCK: StatusDef = {
  label: 'Phalanx Lock',
  desc: 'Must target the Bastion while they are up and in reach.',
  ops: [{ op: 'taunt' }],
};

const PHALANX_WARD: StatusDef = {
  label: 'Phalanx Ward',
  desc: 'Blocks harmful statuses from foes for 1 round.',
  ops: [{ op: 'safeguard' }],
};

function makePhalanxOath(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly shieldFormula: string;
  readonly ops?: readonly Op[];
}): ClassWorn {
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [...(o.ops ?? [])],
      triggers: [
        {
          on: 'struck',
          tag: null,
          to: 'self',
          limit: ROUND,
          ops: [{ op: 'shield', amount: f(o.shieldFormula) }],
        },
      ],
    },
  };
}

const BASE_OATH: ClassWorn = makePhalanxOath({
  key: KEY_OATH,
  label: 'Phalanx Oath',
  desc: 'Once a round when struck, gain a shield equal to 3% of your max HP.',
  shieldFormula: '0.03 * hpmax',
});

const UNBROKEN_PHALANX: ClassWorn = makePhalanxOath({
  key: KEY_OATH_UP,
  label: 'Unbroken Phalanx',
  desc: 'You and allies within 2 tiles gain 12 armor and take 10% less damage. Once a round when struck, gain a shield equal to 10% of your max HP.',
  shieldFormula: '0.1 * hpmax',
  ops: [
    { op: 'aura', radius: 2, on: 'allies' },
    { op: 'sheet', key: 'armor', amount: f('12') },
    { op: 'share', on: 'taken', pct: -10 },
  ],
});

// ── active ability builders ──

function makePhalanxGuard(o: {
  readonly name: string;
  readonly desc: string;
  readonly reachTiles: number;
  readonly guardShare: number;
  readonly shieldFormula: string;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('support', {
    id: ID_GUARD,
    name: o.name,
    desc: o.desc,
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'shield', by: 'hand', formula: f(o.shieldFormula) },
    ops: [
      { op: 'guard', share: o.guardShare },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 4, fatigue: 4, time: cost(R.fight.cost.quick), cooldown: rounds(1) },
    react: { when: 'before', reach: tiles(o.reachTiles) },
  };
}

function makeVanguardSlam(o: {
  readonly name: string;
  readonly formula: string;
  readonly pace?: 'standard' | 'heavy';
  readonly shoveTiles: number;
  readonly staggerShare: number;
  readonly tauntRounds: number;
}): Ability {
  const base = abilityOf('strike', {
    id: ID_SLAM,
    name: o.name,
    desc: `Strike a melee foe, shove them ${o.shoveTiles} ${o.shoveTiles === 1 ? 'tile' : 'tiles'} back, fill ${Math.round(o.staggerShare * 100)}% of their stagger bar, and taunt them for ${o.tauntRounds} ${o.tauntRounds === 1 ? 'round' : 'rounds'}.`,
    aim: 'foe',
    range: tiles(1),
    shape: { kind: 'touch', reach: tiles(1) },
    delivery: { kind: 'travel', windup: tick(R.fight.abilityKinds.strike.windup), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'shove', dir: 'away', from: 'user', tiles: o.shoveTiles },
      { op: 'stagger', share: o.staggerShare },
      { op: 'applyStatus', key: KEY_LOCK, def: PHALANX_LOCK, duration: rounds(o.tauntRounds) },
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 6, time: cost(R.fight.cost[o.pace ?? 'standard']), cooldown: rounds(1) },
  };
}

const BASE_GUARD = makePhalanxGuard({
  name: 'Phalanx Guard',
  desc: 'Reaction. Shield yourself and absorb 35% of an incoming hit on you or an ally within 2 tiles.',
  reachTiles: 2,
  guardShare: 0.35,
  shieldFormula: '0.1 * hpmax',
});

const UP_GUARD_WALL = makePhalanxGuard({
  name: 'Phalanx Guard: Iron Wall',
  desc: 'Reaction. Shield yourself and absorb 50% of an incoming hit on you or an ally within 3 tiles.',
  reachTiles: 3,
  guardShare: 0.5,
  shieldFormula: '0.14 * hpmax',
});

const UP_GUARD_WARDED = makePhalanxGuard({
  name: 'Phalanx Guard: Warded Phalanx',
  desc: 'Reaction. Shield yourself, absorb 35% of an incoming hit within 2 tiles, and gain Phalanx Ward for 1 round.',
  reachTiles: 2,
  guardShare: 0.35,
  shieldFormula: '0.12 * hpmax',
  extraOps: [{ op: 'applyStatus', key: KEY_WARD, def: PHALANX_WARD, duration: rounds(1) }],
});

const BASE_SLAM = makeVanguardSlam({
  name: 'Vanguard Slam',
  formula: '1d6 + 0.7 * phys',
  shoveTiles: 1,
  staggerShare: 0.2,
  tauntRounds: 1,
});

const UP_SLAM_RAM = makeVanguardSlam({
  name: 'Vanguard Slam: Crushing Ram',
  formula: '1d8 + 0.8 * phys',
  pace: 'heavy',
  shoveTiles: 2,
  staggerShare: 0.35,
  tauntRounds: 1,
});

const UP_SLAM_HOLD = makeVanguardSlam({
  name: 'Vanguard Slam: Hold the Line',
  formula: '1d6 + 0.75 * phys',
  shoveTiles: 1,
  staggerShare: 0.2,
  tauntRounds: 2,
});

/** Base Bastion signature (before skill-tree nodes are folded on top). */
export const BASTION_SIGNATURE: ClassSignature = {
  className: 'Bastion',
  bonus: { vit: 1, str: 1 },
  worn: BASE_OATH,
  actives: [BASE_GUARD, BASE_SLAM],
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

/** Full 7-depth, 2-branch, 16-buyable (18-node) Rare Bastion skill tree (Phalanx / Vanguard). */
export const BASTION_TREE: ClassTree = {
  className: 'Bastion',
  rarity: 'rare',
  nodes: [
    // Depth 1: Root (1)
    node('bastion-root', 1, 'Shield Line Stance', 'Gain 2 Vitality and 1 Strength.', [], [
      bonus({ vit: 2, str: 1 }),
    ]),

    // Depth 2: Two branches (2)
    node('bastion-a2', 2, 'Interlocking Plates', 'Gain 2 Vitality and 12 max HP.', ['bastion-root'], [
      bonus({ vit: 2, hpMax: 12 }),
    ]),
    node('bastion-b2', 2, 'Heavy Shoulders', 'Gain 2 Strength and 5% threat.', ['bastion-root'], [
      bonus({ str: 2, threat: 5 }),
    ]),

    // Depth 3: Branch splits (4)
    node('bastion-a3x', 3, 'Braced Stance', 'Gain 2 Vitality and 4 tenacity.', ['bastion-a2'], [
      bonus({ vit: 2, tenacity: 4 }),
    ]),
    node('bastion-a3y', 3, 'Garrison Guard', 'Gain 15 max HP and 4% heal and shield bonus.', ['bastion-a2'], [
      bonus({ hpMax: 15, healPower: 4 }),
    ]),
    node('bastion-b3x', 3, 'Bridge Breaker', 'Gain 2 Strength and 4 potency.', ['bastion-b2'], [
      bonus({ str: 2, potency: 4 }),
    ]),
    node('bastion-b3y', 3, 'Marching Tempo', 'Gain 6 ability haste and 6% threat.', ['bastion-b2'], [
      bonus({ haste: 6, threat: 6 }),
    ]),

    // Depth 4: Deepening (4)
    node('bastion-a4x', 4, 'Bastion Resolve', 'Gain 3 Vitality, 4 tenacity, and 3 Will.', ['bastion-a3x'], [
      bonus({ vit: 3, tenacity: 4, will: 3 }),
    ]),
    node('bastion-a4y', 4, 'Tempered Bulwark', 'Gain 20 max HP and 6% heal and shield bonus.', ['bastion-a3y'], [
      bonus({ hpMax: 20, healPower: 6 }),
    ]),
    node('bastion-b4x', 4, 'Heavy Impact', 'Gain 3 Strength, 4% armor penetration, and 4 potency.', ['bastion-b3x'], [
      bonus({ str: 3, armorPen: 4, potency: 4 }),
    ]),
    node('bastion-b4y', 4, 'Line Captain', 'Gain 8 ability haste and 8% threat.', ['bastion-b3y'], [
      bonus({ haste: 8, threat: 8 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (4 nodes, 2 buyable)
    node('bastion-a5-l', 5, 'Iron Wall', 'Upgrade Phalanx Guard to 3-tile reach, 50% strike guard, and a 14% max HP shield.', ['bastion-a4x', 'bastion-a4y'], [
      replaceActive(ID_GUARD, UP_GUARD_WALL),
    ], { forkGroup: 'bastion-a5' }),
    node('bastion-a5-r', 5, 'Warded Phalanx', 'Upgrade Phalanx Guard to a 12% max HP shield and 1 round of Phalanx Ward safeguard against harmful statuses.', ['bastion-a4x', 'bastion-a4y'], [
      replaceActive(ID_GUARD, UP_GUARD_WARDED),
    ], { forkGroup: 'bastion-a5' }),

    node('bastion-b5-l', 5, 'Crushing Ram', 'Upgrade Vanguard Slam to a heavy strike that pushes foes 2 tiles with 35% stagger and deals up to 18% more damage against foes with higher max HP than you.', ['bastion-b4x', 'bastion-b4y'], [
      replaceActive(ID_SLAM, UP_SLAM_RAM),
      scaler({ measure: 'maxPair', dir: 'over', start: 0.5, scale: 0.18 }),
    ], { forkGroup: 'bastion-b5' }),
    node('bastion-b5-r', 5, 'Hold the Line', 'Upgrade Vanguard Slam to taunt for 2 rounds and gain 15 max HP and 15% damage to shield so your strikes build a self shield.', ['bastion-b4x', 'bastion-b4y'], [
      replaceActive(ID_SLAM, UP_SLAM_HOLD),
      bonus({ hpMax: 15, shieldDrain: 15 }),
    ], { forkGroup: 'bastion-b5' }),

    // Depth 6: Branch Capstones (2)
    node('bastion-a6', 6, 'Rampart Core', 'Gain 4 Vitality, 25 max HP, and 5 tenacity.', ['bastion-a5-l', 'bastion-a5-r'], [
      bonus({ vit: 4, hpMax: 25, tenacity: 5 }),
    ], { parentMode: 'any' }),
    node('bastion-b6', 6, 'Vanguard Drive', 'Gain 4 Strength, 6 ability haste, and 8% threat.', ['bastion-b5-l', 'bastion-b5-r'], [
      bonus({ str: 4, haste: 6, threat: 8 }),
    ], { parentMode: 'any' }),

    // Depth 7: Rare Capstone (1)
    node('bastion-cap', 7, 'Unbroken Phalanx', 'Upgrade Phalanx Oath to Unbroken Phalanx and gain 4 Vitality, 4 Strength, and 25 max HP.', ['bastion-a6', 'bastion-b6'], [
      replaceWorn(KEY_OATH, UNBROKEN_PHALANX),
      bonus({ vit: 4, str: 4, hpMax: 25 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
