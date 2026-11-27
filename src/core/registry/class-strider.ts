// class-strider.ts: Rare Strider (Ranger branch, agi+vit) signature kit and full 18-node / 16-buyable tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
//
// High-mobility skirmisher opposite Sniper: gains shields and Fleet speed from moving, shoves foes with Skirmish Shot,
// and repositions across the battlefield with Bounding Leap blinks.
// Root budget at rank C (`RULES.rarities.rare.rank = 'C'`, level 20, settled.md ~12-point Rare unspecialized root):
// - Sheet bonus `{ agi: 1, vit: 1 }` spends 2.00 pts.
// - Worn `Trailworn` shields `0.03 * hpmax` and grants 1 round of Fleet (+10% speed, never self-hasten) on moving.
// - Actives (`Skirmish Shot`, `Bounding Leap`) stay inside worth.ts C-rank budgets (`Bounding Leap` carries a weighed shield).
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { StatusDef, StatusKey, UseOp } from '../combat/effect-ops.ts';
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
  if (!id) throw new Error(`Invalid Strider node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Strider formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const ROUND: Limit = { kind: 'round' };

const KEY_TRAILWORN = statusKey('strider-trailworn');
const KEY_APEX = statusKey('strider-apex');
const KEY_FLEET = statusKey('strider-fleet');
const KEY_FLEET_UP = statusKey('strider-fleet-ii');
const KEY_WINDSTRIDE = statusKey('strider-windstride');
const KEY_WINDWARD = statusKey('strider-windward');
const KEY_HAMSTRUNG = statusKey('strider-hamstrung');

const ID_SHOT = abilityId('strider-skirmish-shot');
const ID_LEAP = abilityId('strider-bounding-leap');

// ── statuses ──

const FLEET: StatusDef = {
  label: 'Fleet',
  desc: 'Speed increased by 10% for 1 round.',
  ops: [{ op: 'speed', pct: 10 }],
};

// Defense advantage lives in Windward so defending never strips Windstride or Apex Fleet speed.
const APEX_FLEET: StatusDef = {
  label: 'Apex Fleet',
  desc: 'Speed increased by 18% for 1 round.',
  ops: [{ op: 'speed', pct: 18 }],
};

const WINDSTRIDE: StatusDef = {
  label: 'Windstride',
  desc: 'Speed increased by 15% for 2 rounds.',
  ops: [{ op: 'speed', pct: 15 }],
};

const WINDWARD: StatusDef = {
  label: 'Windward',
  desc: 'Advantage on your next defense roll.',
  ops: [{ op: 'edge', side: 'defend', keep: 'better', tag: null, spend: true }],
};

const HAMSTRUNG: StatusDef = {
  label: 'Hamstrung',
  desc: 'Speed reduced by 15% for 2 rounds.',
  ops: [{ op: 'speed', pct: -15 }],
};

function makeTrailworn(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly shieldFormula: string;
  readonly fleetKey: StatusKey;
  readonly fleetDef: StatusDef;
  readonly addWindward?: boolean;
}): ClassWorn {
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [],
      triggers: [
        {
          on: 'moved',
          to: 'self',
          limit: ROUND,
          ops: [
            { op: 'shield', amount: f(o.shieldFormula) },
            { op: 'applyStatus', key: o.fleetKey, def: o.fleetDef, duration: rounds(1) },
            ...(o.addWindward ? [{ op: 'applyStatus' as const, key: KEY_WINDWARD, def: WINDWARD, duration: rounds(1) }] : []),
          ],
        },
      ],
    },
  };
}

const BASE_TRAILWORN: ClassWorn = makeTrailworn({
  key: KEY_TRAILWORN,
  label: 'Trailworn',
  desc: 'Once a round after you walk or dash, gain a shield equal to 3% of your max HP and Fleet (+10% speed) for 1 round.',
  shieldFormula: '0.03 * hpmax',
  fleetKey: KEY_FLEET,
  fleetDef: FLEET,
});

const APEX_TRAILRUNNER: ClassWorn = makeTrailworn({
  key: KEY_APEX,
  label: 'Apex Trailrunner',
  desc: 'Once a round after you walk or dash, gain a shield equal to 6% of your max HP, Apex Fleet (+18% speed), and Windward (defense advantage) for 1 round.',
  shieldFormula: '0.06 * hpmax',
  fleetKey: KEY_FLEET_UP,
  fleetDef: APEX_FLEET,
  addWindward: true,
});

// ── active ability builders ──

function makeSkirmishShot(o: {
  readonly name: string;
  readonly formula: string;
  readonly pace?: 'quick' | 'standard';
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('shot', {
    id: ID_SHOT,
    name: o.name,
    aim: 'foe',
    range: tiles(10),
    shape: { kind: 'line', width: tiles(0), pierce: false },
    delivery: { kind: 'travel', windup: tick(R.fight.abilityKinds.shot.windup), speed: 120 },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'shove', dir: 'away', from: 'user', tiles: 1 },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 5, time: cost(R.fight.cost[o.pace ?? 'quick']), cooldown: rounds(1) },
  };
}

function makeBoundingLeap(o: {
  readonly name: string;
  readonly rangeTiles: number;
  readonly shieldFormula: string;
  readonly healFormula?: string;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const isHeal = o.healFormula !== undefined;
  const base = abilityOf('support', {
    id: ID_LEAP,
    name: o.name,
    aim: 'place',
    shape: { kind: 'self' },
    range: tiles(o.rangeTiles),
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: isHeal
      ? { type: 'heal', by: 'hand', formula: f(o.healFormula!) }
      : { type: 'shield', by: 'hand', formula: f(o.shieldFormula) },
    ops: [
      ...(isHeal ? [{ op: 'shield' as const, amount: f(o.shieldFormula) }] : []),
      { op: 'applyStatus', key: KEY_WINDSTRIDE, def: WINDSTRIDE, duration: rounds(2) },
      { op: 'applyStatus', key: KEY_WINDWARD, def: WINDWARD, duration: rounds(2) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    move: { kind: 'blink' },
    cost: { ...base.cost, mana: 0, fatigue: 5, time: cost(R.fight.cost.quick), cooldown: rounds(2) },
  };
}

const BASE_SHOT = makeSkirmishShot({
  name: 'Skirmish Shot',
  formula: '1d6 + 0.6 * finesse',
});

const UP_SHOT_BOLTING = makeSkirmishShot({
  name: 'Skirmish Shot: Bolting Shot',
  formula: '1d8 + 0.65 * finesse',
});

// Standard pace gives room for 20% stagger and 2 rounds of Hamstrung slow inside worth.ts C-rank budgets.
const UP_SHOT_HAMSTRING = makeSkirmishShot({
  name: 'Skirmish Shot: Hamstring Volley',
  formula: '1d6 + 0.6 * finesse',
  pace: 'standard',
  extraOps: [
    { op: 'stagger', share: 0.2 },
    { op: 'applyStatus', key: KEY_HAMSTRUNG, def: HAMSTRUNG, duration: rounds(2) },
  ],
});

const BASE_LEAP = makeBoundingLeap({
  name: 'Bounding Leap',
  rangeTiles: 5,
  shieldFormula: '0.12 * hpmax',
});

const UP_LEAP_GALE = makeBoundingLeap({
  name: 'Bounding Leap: Gale Leap',
  rangeTiles: 6,
  shieldFormula: '0.16 * hpmax',
});

const UP_LEAP_RECOVERY = makeBoundingLeap({
  name: 'Bounding Leap: Wild Recovery',
  rangeTiles: 5,
  shieldFormula: '0.12 * hpmax',
  healFormula: '0.1 * hpmax',
  extraOps: [{ op: 'dispel', which: 'first' }],
});

/** Base Strider signature (before skill-tree nodes are folded on top). */
export const STRIDER_SIGNATURE: ClassSignature = {
  className: 'Strider',
  bonus: { agi: 1, vit: 1 },
  worn: BASE_TRAILWORN,
  actives: [BASE_SHOT, BASE_LEAP],
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

/** Full 7-depth, 2-branch, 16-buyable (18-node) Rare Strider skill tree (Skirmish / Trail). */
export const STRIDER_TREE: ClassTree = {
  className: 'Strider',
  rarity: 'rare',
  nodes: [
    // Depth 1: Root (1)
    node('strider-root', 1, 'Road Tested', 'Gain 2 Agility and 1 Vitality.', [], [
      bonus({ agi: 2, vit: 1 }),
    ]),

    // Depth 2: Two branches (2)
    node('strider-a2', 2, 'Snap Draw', 'Gain 2 Agility and 3% armor penetration.', ['strider-root'], [
      bonus({ agi: 2, armorPen: 3 }),
    ]),
    node('strider-b2', 2, 'Sturdy Gait', 'Gain 2 Vitality and 10 max HP.', ['strider-root'], [
      bonus({ vit: 2, hpMax: 10 }),
    ]),

    // Depth 3: Branch splits (4)
    node('strider-a3x', 3, 'Running Shot', 'Gain 2 Agility and 4 flat armor penetration.', ['strider-a2'], [
      bonus({ agi: 2, armorPenFlat: 4 }),
    ]),
    node('strider-a3y', 3, 'Wind Quiver', 'Gain 6 ability haste and 4 speed.', ['strider-a2'], [
      bonus({ haste: 6, speed: 4 }),
    ]),
    node('strider-b3x', 3, 'Long March', 'Gain 15 max HP and 1 move tile.', ['strider-b2'], [
      bonus({ hpMax: 15, move: 1 }),
    ]),
    node('strider-b3y', 3, 'Weathered Stamina', 'Gain 2 Vitality and 4 tenacity.', ['strider-b2'], [
      bonus({ vit: 2, tenacity: 4 }),
    ]),

    // Depth 4: Deepening (4)
    node('strider-a4x', 4, 'Barbed Flights', 'Gain 3 Agility, 4% armor penetration, and 4 flat armor penetration.', ['strider-a3x'], [
      bonus({ agi: 3, armorPen: 4, armorPenFlat: 4 }),
    ]),
    node('strider-a4y', 4, 'Harrying Pace', 'Gain 8 ability haste and 5 speed.', ['strider-a3y'], [
      bonus({ haste: 8, speed: 5 }),
    ]),
    node('strider-b4x', 4, 'Trail Vigor', 'Gain 20 max HP and 4 Reaction.', ['strider-b3x'], [
      bonus({ hpMax: 20, react: 4 }),
    ]),
    node('strider-b4y', 4, 'Second Breath', 'Gain 3 Vitality, 4 tenacity, and 4% heal and shield bonus.', ['strider-b3y'], [
      bonus({ vit: 3, tenacity: 4, healPower: 4 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (4 nodes, 2 buyable)
    node('strider-a5-l', 5, 'Bolting Shot', 'Upgrade Skirmish Shot with higher physical damage and deal up to 18% more damage against foes above half HP.', ['strider-a4x', 'strider-a4y'], [
      replaceActive(ID_SHOT, UP_SHOT_BOLTING),
      scaler({ measure: 'target', dir: 'over', start: 0.5, scale: 0.18 }),
    ], { forkGroup: 'strider-a5' }),
    node('strider-a5-r', 5, 'Hamstring Volley', 'Upgrade Skirmish Shot to a standard shot that adds 20% stagger and 2 rounds of Hamstrung (-15% speed).', ['strider-a4x', 'strider-a4y'], [
      replaceActive(ID_SHOT, UP_SHOT_HAMSTRING),
    ], { forkGroup: 'strider-a5' }),

    node('strider-b5-l', 5, 'Gale Leap', 'Upgrade Bounding Leap to a 6-tile blink with a 16% max HP shield.', ['strider-b4x', 'strider-b4y'], [
      replaceActive(ID_LEAP, UP_LEAP_GALE),
    ], { forkGroup: 'strider-b5' }),
    node('strider-b5-r', 5, 'Wild Recovery', 'Upgrade Bounding Leap to dispel the oldest harmful status and heal 10% of your max HP alongside its shield.', ['strider-b4x', 'strider-b4y'], [
      replaceActive(ID_LEAP, UP_LEAP_RECOVERY),
    ], { forkGroup: 'strider-b5' }),

    // Depth 6: Branch Capstones (2)
    node('strider-a6', 6, 'Skirmisher Reflex', 'Gain 4 Agility, 5% armor penetration, and 6 speed.', ['strider-a5-l', 'strider-a5-r'], [
      bonus({ agi: 4, armorPen: 5, speed: 6 }),
    ], { parentMode: 'any' }),
    node('strider-b6', 6, 'Pathless Endurance', 'Gain 4 Vitality, 25 max HP, and 6 ability haste.', ['strider-b5-l', 'strider-b5-r'], [
      bonus({ vit: 4, hpMax: 25, haste: 6 }),
    ], { parentMode: 'any' }),

    // Depth 7: Rare Capstone (1)
    node('strider-cap', 7, 'Apex Trailrunner', 'Upgrade Trailworn to Apex Trailrunner and gain 4 Agility, 4 Vitality, and 6 speed.', ['strider-a6', 'strider-b6'], [
      replaceWorn(KEY_TRAILWORN, APEX_TRAILRUNNER),
      bonus({ agi: 4, vit: 4, speed: 6 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
