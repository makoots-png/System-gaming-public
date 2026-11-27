// class-artificer.ts: Rare Artificer (Mage branch, ins+ctl) signature kit and full 18-node / 16-buyable tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
//
// Accuracy-scaling gadgeteer planting Shock Mine hazard fields and deploying a timed Arc Turret construct.
// Root budget at rank C (`RULES.rarities.rare.rank = 'C'`, level 20, settled.md ~12-point Rare unspecialized root):
// - Sheet bonus `{ ctl: 1, ins: 1, manaMax: 4 }` spends 10.00 pts.
// - Worn `Clockwork Craft` adds 1 tile of range and restores 3 mana once a round when imposing a harmful status.
// - Actives (`Shock Mine`, `Arc Turret`) stay inside worth.ts C-rank budgets (`Arc Turret` carries a weighed shield).
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { LandOp, StatusDef, StatusKey } from '../combat/effect-ops.ts';
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
  if (!id) throw new Error(`Invalid Artificer node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Artificer formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };

const KEY_CRAFT = statusKey('art-craft');
const KEY_GRAND = statusKey('art-grand-craft');
const KEY_JOLTED = statusKey('art-jolted');
const KEY_SHRAPNEL = statusKey('art-shrapnel-jolt');

const ID_MINE = abilityId('art-shock-mine');
const ID_TURRET = abilityId('art-arc-turret');

// ── statuses ──

const JOLTED: StatusDef = {
  label: 'Jolted',
  desc: 'Speed reduced by 15% for 2 rounds.',
  ops: [{ op: 'speed', pct: -15 }],
};

// Upgraded by Shrapnel Coil (`upgrade-status`) so it composes cleanly with both Cluster Mine and Static Trap.
const SHRAPNEL_JOLT: StatusDef = {
  label: 'Shrapnel Jolt',
  desc: 'Speed reduced by 15% for 2 rounds and fills 25% of the target\'s stagger bar when applied.',
  ops: [{ op: 'speed', pct: -15 }],
  triggers: [
    {
      on: 'statusGained',
      key: KEY_SHRAPNEL,
      to: 'self',
      limit: EACH,
      ops: [{ op: 'stagger', share: 0.25 }],
    },
  ],
};

function makeClockworkCraft(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly rangeAdd: number;
  readonly imposedOps: readonly LandOp[];
}): ClassWorn {
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [{ op: 'sheet', key: 'range', amount: o.rangeAdd }],
      triggers: [
        {
          on: 'imposed',
          tag: null,
          to: 'self',
          limit: ROUND,
          ops: o.imposedOps,
        },
      ],
    },
  };
}

const BASE_CRAFT: ClassWorn = makeClockworkCraft({
  key: KEY_CRAFT,
  label: 'Clockwork Craft',
  desc: 'Your ranged abilities reach 1 tile farther. Once a round when you impose a harmful status on a foe, restore 3 mana.',
  rangeAdd: 1,
  imposedOps: [{ op: 'mana', when: 'use', amount: f('3') }],
});

const GRAND_ARTIFICER: ClassWorn = makeClockworkCraft({
  key: KEY_GRAND,
  label: 'Grand Artificer',
  desc: 'Your ranged abilities reach 2 tiles farther. Once a round when you impose a harmful status on a foe, restore 5 mana and gain a shield equal to 5% of your max HP.',
  rangeAdd: 2,
  imposedOps: [
    { op: 'mana', when: 'use', amount: f('5') },
    { op: 'shield', amount: f('0.05 * hpmax') },
  ],
});

// ── active ability builders ──

function makeShockMine(o: {
  readonly name: string;
  readonly zoneName: string;
  readonly radiusTiles: number;
  readonly hitFormula: string;
  readonly endFormula: string;
}): Ability {
  const base = abilityOf('blast', {
    id: ID_MINE,
    name: o.name,
    aim: 'place',
    range: tiles(8),
    shape: { kind: 'radius', radius: tiles(o.radiusTiles), ring: null },
    delivery: { kind: 'travel', windup: tick(R.fight.abilityKinds.blast.windup), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.hitFormula) },
    ops: [{ op: 'applyStatus', key: KEY_JOLTED, def: JOLTED, duration: rounds(2) }],
    zone: {
      name: o.zoneName,
      duration: rounds(3),
      around: null,
      endsWithOwner: false,
      grow: null,
      ops: [{ op: 'speed', pct: -15 }],
      end: [{ op: 'damage', type: 'arcane', when: 'use', amount: f(o.endFormula) }],
    },
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 5, fatigue: 5, time: cost(R.fight.cost.standard), cooldown: rounds(2) },
  };
}

function makeArcTurret(o: {
  readonly name: string;
  readonly shieldFormula: string;
  readonly summonRounds: number;
}): Ability {
  const base = abilityOf('support', {
    id: ID_TURRET,
    name: o.name,
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'shield', by: 'hand', formula: f(o.shieldFormula) },
    ops: [],
  }, R);
  return {
    ...base,
    summon: {
      name: 'Arc Turret',
      archetype: 'caster',
      rounds: o.summonRounds,
      statuses: [],
    },
    cost: { ...base.cost, mana: 6, fatigue: 5, time: cost(R.fight.cost.standard), cooldown: rounds(3) },
  };
}

const BASE_MINE = makeShockMine({
  name: 'Shock Mine',
  zoneName: 'Shock Mine',
  radiusTiles: 2,
  hitFormula: '1d6 + 0.45 * aim',
  endFormula: '1d8 + 0.55 * aim',
});

const UP_MINE_CLUSTER = makeShockMine({
  name: 'Shock Mine: Cluster Mine',
  zoneName: 'Cluster Mine',
  radiusTiles: 3,
  hitFormula: '1d6 + 0.45 * aim',
  endFormula: '1d8 + 0.55 * aim',
});

const UP_MINE_STATIC = makeShockMine({
  name: 'Shock Mine: Static Trap',
  zoneName: 'Static Trap',
  radiusTiles: 2,
  hitFormula: '1d8 + 0.55 * aim',
  endFormula: '1d10 + 0.65 * aim',
});

const BASE_TURRET = makeArcTurret({
  name: 'Arc Turret',
  shieldFormula: '0.08 * hpmax',
  summonRounds: 4,
});

const UP_TURRET_OVERCLOCK = makeArcTurret({
  name: 'Arc Turret: Overclocked Turret',
  shieldFormula: '0.12 * hpmax',
  summonRounds: 5,
});

/** Base Artificer signature (before skill-tree nodes are folded on top). */
export const ARTIFICER_SIGNATURE: ClassSignature = {
  className: 'Artificer',
  bonus: { ctl: 1, ins: 1, manaMax: 4 },
  worn: BASE_CRAFT,
  actives: [BASE_MINE, BASE_TURRET],
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

/** Full 7-depth, 2-branch, 16-buyable (18-node) Rare Artificer skill tree (Mines / Constructs). */
export const ARTIFICER_TREE: ClassTree = {
  className: 'Artificer',
  rarity: 'rare',
  nodes: [
    // Depth 1: Root (1)
    node('art-root', 1, 'Foundry Blueprints', 'Gain 2 Control and 1 Instinct.', [], [
      bonus({ ctl: 2, ins: 1 }),
    ]),

    // Depth 2: Two branches (2)
    node('art-a2', 2, 'Calibrated Coils', 'Gain 2 Control and 3 Accuracy.', ['art-root'], [
      bonus({ ctl: 2, aim: 3 }),
    ]),
    node('art-b2', 2, 'Clockwork Frame', 'Gain 2 Instinct and 3 max mana.', ['art-root'], [
      bonus({ ins: 2, manaMax: 3 }),
    ]),

    // Depth 3: Branch splits (4)
    node('art-a3x', 3, 'Arc Capacitors', 'Gain 2 Control and 4% magic penetration.', ['art-a2'], [
      bonus({ ctl: 2, resistPen: 4 }),
    ]),
    node('art-a3y', 3, 'Hair-Trigger Springs', 'Gain 3 Accuracy and 4 potency.', ['art-a2'], [
      bonus({ aim: 3, potency: 4 }),
    ]),
    node('art-b3x', 3, 'Quick Assembly', 'Gain 6 ability haste and 3 max mana.', ['art-b2'], [
      bonus({ haste: 6, manaMax: 3 }),
    ]),
    node('art-b3y', 3, 'Sighting Lenses', 'Gain 2 Instinct and 0.06 crit multiplier.', ['art-b2'], [
      bonus({ ins: 2, critSize: 6 }),
    ]),

    // Depth 4: Deepening (4)
    node('art-a4x', 4, 'Voltaic Charges', 'Gain 3 Control, 5% magic penetration, and 4 flat magic penetration.', ['art-a3x'], [
      bonus({ ctl: 3, resistPen: 5, resistPenFlat: 4 }),
    ]),
    node('art-a4y', 4, 'Precision Triggers', 'Gain 4 Accuracy and 5 potency.', ['art-a3y'], [
      bonus({ aim: 4, potency: 5 }),
    ]),
    node('art-b4x', 4, 'Efficient Conduits', 'Gain 8 ability haste and 3% cost cut.', ['art-b3x'], [
      bonus({ haste: 8, costCut: 3 }),
    ]),
    node('art-b4y', 4, 'Keen Optics', 'Gain 3 Instinct, 0.08 crit multiplier, and 3 opening.', ['art-b3y'], [
      bonus({ ins: 3, critSize: 8, opening: 3 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (4 nodes, 2 buyable)
    node('art-a5-l', 5, 'Cluster Mine', 'Upgrade Shock Mine and its hazard field to a 3-tile radius.', ['art-a4x', 'art-a4y'], [
      replaceActive(ID_MINE, UP_MINE_CLUSTER),
    ], { forkGroup: 'art-a5' }),
    node('art-a5-r', 5, 'Static Trap', 'Upgrade Shock Mine with stronger arcane hit and detonation damage and deal up to 18% more damage against foes below half HP.', ['art-a4x', 'art-a4y'], [
      replaceActive(ID_MINE, UP_MINE_STATIC),
      scaler({ measure: 'target', dir: 'under', start: 0.5, scale: 0.18 }),
    ], { forkGroup: 'art-a5' }),

    node('art-b5-l', 5, 'Overclocked Turret', 'Upgrade Arc Turret to last 5 rounds and grant a 12% max HP shield on cast.', ['art-b4x', 'art-b4y'], [
      replaceActive(ID_TURRET, UP_TURRET_OVERCLOCK),
    ], { forkGroup: 'art-b5' }),
    node('art-b5-r', 5, 'Shrapnel Coil', 'Upgrade Jolted from Shock Mine to Shrapnel Jolt (25% stagger on application) and gain 2 Control and 4 potency.', ['art-b4x', 'art-b4y'], [
      upgradeStatus(KEY_JOLTED, KEY_SHRAPNEL, SHRAPNEL_JOLT),
      bonus({ ctl: 2, potency: 4 }),
    ], { forkGroup: 'art-b5' }),

    // Depth 6: Branch Capstones (2)
    node('art-a6', 6, 'Master Sapper', 'Gain 4 Control, 5 Accuracy, and 5% magic penetration.', ['art-a5-l', 'art-a5-r'], [
      bonus({ ctl: 4, aim: 5, resistPen: 5 }),
    ], { parentMode: 'any' }),
    node('art-b6', 6, 'Clockwork Dynamo', 'Gain 4 Instinct, 8 ability haste, and 4 max mana.', ['art-b5-l', 'art-b5-r'], [
      bonus({ ins: 4, haste: 8, manaMax: 4 }),
    ], { parentMode: 'any' }),

    // Depth 7: Rare Capstone (1)
    node('art-cap', 7, 'Grand Artificer', 'Upgrade Clockwork Craft to Grand Artificer and gain 4 Control, 4 Instinct, and 4 max mana.', ['art-a6', 'art-b6'], [
      replaceWorn(KEY_CRAFT, GRAND_ARTIFICER),
      bonus({ ctl: 4, ins: 4, manaMax: 4 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
