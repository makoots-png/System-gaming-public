// class-sniper.ts: Rare Sniper (Ranger branch, agi+ctl) signature kit and full 18-node / 16-buyable tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
//
// Patience-and-perch sharpshooter: trades mobility for escalating range, armor penetration, and crit multiplier.
// Root budget at rank C (`RULES.rarities.rare.rank = 'C'`, level 20, settled.md ~12-point Rare unspecialized root):
// - Sheet bonus `{ agi: 1, ctl: 1 }` spends 2.00 pts (1 pt per stat point, item-budget.ts `BONUS_COST`).
// - Worn `Vantage Perch` adds +2 tiles to ranged abilities (range >= 2, within `kit.rangeAdd = 3`; unweighed like
//   Confluence `Deadeye`) and builds `Sighted` stacks (up to 3) on each shot used while stationary (`+0.02` critSize
//   and `+2%` armorPen per stack; moving drops all stacks via `leave: 'moved'`).
// - Even at full 3 stationary stacks (`+0.06` critSize + `+6%` armorPen + `{ agi: 1, ctl: 1 }`), the equivalent C-rank
//   spend stays honestly within the ~12-point Rare root budget (no unweighed +3 critFaces hidden at root, per w1p7-neon-on-fable.md).
// - `Sightline` (and both D5 forks) grants only 1 stack of `Sighted` so moving genuinely costs multiple turns of ramp.
// - `Sighted` triggers on `used` (`tag: shot`) rather than `turnEnd` so moving always leaves `Sighted` at 0 stacks.
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { Op, StackDef, StatusDef, StatusKey } from '../combat/effect-ops.ts';
import type { Limit, Trigger } from '../combat/triggers.ts';
import { tiles } from '../combat/space.ts';
import { cost, tick } from '../combat/timeline.ts';
import type { Tick } from '../combat/timeline.ts';
import { abilityOf, KIND_TAG } from './ability-kinds.ts';
import type { Scaler } from './scalers.ts';
import type { ClassNodeDef, ClassTree, ClassWorn, NodeGift, TreeDepth } from './class-trees.ts';
import type { ClassSignature } from './class-powers.ts';

const R = RULES;
const nid = (s: string): ClassNodeId => {
  const id = parseClassNodeId(s);
  if (!id) throw new Error(`Invalid Sniper node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Sniper formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };

const KEY_PERCH = statusKey('sniper-perch');
const KEY_PERCH_UP = statusKey('sniper-perch-ii');
const KEY_SIGHTED = statusKey('sniper-sighted');
const KEY_PINNED = statusKey('sniper-pinned');
const KEY_AIM = statusKey('sniper-steady-aim');
const KEY_AIM_UP = statusKey('sniper-steady-aim-ii');
const KEY_BRACE = statusKey('sniper-braced-perch');

const ID_LONGSHOT = abilityId('sniper-longshot');
const ID_SIGHTLINE = abilityId('sniper-sightline');

// ── statuses ──

// Shared across base passive, Sightline, both Fork B upgrades, and Horizon Scope so `stacks(sniper-sighted)` never breaks.
const SNIPER_SIGHTED: StackDef = {
  label: 'Sighted',
  desc: 'Each stack adds 0.02 crit multiplier and 2% armor penetration (up to 3). Moving removes all stacks.',
  ops: [
    { op: 'sheet', key: 'critSize', amount: { kind: 'number', value: 0.02 } },
    { op: 'sheet', key: 'armorPen', amount: { kind: 'number', value: 2 } },
  ],
  stack: {
    cap: 3,
    leave: { kind: 'event', event: 'moved' },
    keep: 'fight',
    threshold: null,
  },
};

const SNIPER_PINNED: StatusDef = {
  label: 'Pinned Shot',
  desc: 'Attacks against this target crit on 1 more die face.',
  ops: [{ op: 'sheet', key: 'exposed', amount: 1 }],
};

const STEADY_AIM: StatusDef = {
  label: 'Steady Aim',
  desc: 'Advantage on your next shot.',
  ops: [{ op: 'edge', side: 'attack', keep: 'better', tag: KIND_TAG.shot, spend: true }],
};

// D5 Fork B-Left (offensive armor-buster): advantage + 15% armor pen (never clamped by Horizon Scope's +3 range cap).
const EAGLE_EYE: StatusDef = {
  label: 'Eagle Eye',
  desc: 'Advantage on your next shot and 15% armor penetration for 2 rounds.',
  ops: [
    { op: 'edge', side: 'attack', keep: 'better', tag: KIND_TAG.shot, spend: true },
    { op: 'sheet', key: 'armorPen', amount: { kind: 'number', value: 15 } },
  ],
};

// D5 Fork B-Right (hold-the-perch defense): take 15% less damage and gain defense advantage for 1 round to avoid moving.
const BRACED_PERCH: StatusDef = {
  label: 'Braced Perch',
  desc: 'Take 15% less damage and gain advantage on your next defense roll for 1 round.',
  ops: [
    { op: 'share', on: 'taken', pct: -15 },
    { op: 'edge', side: 'defend', keep: 'better', tag: null, spend: true },
  ],
};

function makePerch(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly rangeAdd: number;
  readonly extraOps?: readonly Op[];
  readonly extraTriggers?: readonly Trigger[];
}): ClassWorn {
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [
        { op: 'sheet', key: 'range', amount: o.rangeAdd },
        ...(o.extraOps ?? []),
      ],
      triggers: [
        {
          on: 'used',
          tag: KIND_TAG.shot,
          to: 'self',
          limit: EACH,
          ops: [{ op: 'applyStatus', key: KEY_SIGHTED, def: SNIPER_SIGHTED, duration: null }],
        },
        ...(o.extraTriggers ?? []),
      ],
    },
  };
}

// Root passive: +2 range on ranged abilities, and every shot builds 1 stack of Sighted (lost on moving).
const BASE_PERCH: ClassWorn = makePerch({
  key: KEY_PERCH,
  label: 'Vantage Perch',
  desc: 'Your ranged abilities reach 2 tiles farther. Each shot grants 1 stack of Sighted (up to 3). Moving clears all stacks.',
  rangeAdd: 2,
});

// Depth 7 Capstone passive: +3 range (full kit.rangeAdd), +1 crit face, +10% armor pen, +8 flat armor pen, plus 35% turn refund on shot crits once/round.
const HORIZON_SCOPE: ClassWorn = makePerch({
  key: KEY_PERCH_UP,
  label: 'Horizon Scope',
  desc: 'Your ranged abilities reach 3 tiles farther. Gain 1 crit face, 10% armor penetration, and 8 flat armor penetration. Shot crits refund 35% of your turn once a round.',
  rangeAdd: 3,
  extraOps: [
    { op: 'sheet', key: 'critFaces', amount: { kind: 'number', value: 1 } },
    { op: 'sheet', key: 'armorPen', amount: { kind: 'number', value: 10 } },
    { op: 'sheet', key: 'armorPenFlat', amount: { kind: 'number', value: 8 } },
  ],
  extraTriggers: [
    { on: 'critDealt', tag: KIND_TAG.shot, to: 'self', limit: ROUND, ops: [{ op: 'refund', pct: 35 }] },
  ],
});

// ── active ability builders ──

function makeLongshot(o: {
  readonly name: string;
  readonly rangeTiles: number;
  readonly pierce: boolean;
  readonly formula: string;
}): Ability {
  const base = abilityOf('shot', {
    id: ID_LONGSHOT,
    name: o.name,
    aim: 'foe',
    range: tiles(o.rangeTiles),
    shape: { kind: 'line', width: tiles(0), pierce: o.pierce },
    delivery: { kind: 'travel', windup: tick(100), speed: 120 },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [{ op: 'applyStatus', key: KEY_PINNED, def: SNIPER_PINNED, duration: rounds(1) }],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 8, time: cost(R.fight.cost.standard), cooldown: rounds(2) },
  };
}

function makeSightline(o: {
  readonly name: string;
  readonly aimKey: StatusKey;
  readonly aimDef: StatusDef;
  readonly cooldownRounds: number;
  readonly extraOps?: readonly Ability['ops'][number][];
}): Ability {
  const base = abilityOf('support', {
    id: ID_SIGHTLINE,
    name: o.name,
    aim: 'self',
    shape: { kind: 'self' },
    range: tiles(0),
    delivery: { kind: 'sure' },
    effect: null,
    ops: [
      // Always grants only 1 stack of Sighted so repositioning keeps a real setup cost.
      { op: 'applyStatus', key: KEY_SIGHTED, def: SNIPER_SIGHTED, duration: null, stacks: 1 },
      { op: 'applyStatus', key: o.aimKey, def: o.aimDef, duration: rounds(2) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 6, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds) },
  };
}

// Standard-pace 16-tile sniper shot (18 with Vantage Perch): 1d10 + finesse at 0 stacks (~1.00 SA at rank C), ramping +12% per Sighted stack.
const BASE_LONGSHOT = makeLongshot({
  name: 'Longshot',
  rangeTiles: 16,
  pierce: false,
  formula: '1d10 + finesse * (1 + 0.12 * stacks(sniper-sighted))',
});

// D5 Fork A-Left upgrade: 18-tile piercing line shot (21 with Horizon Scope) ramping +16% per Sighted stack.
const UP_LONGSHOT = makeLongshot({
  name: 'Longshot: Piercing Round',
  rangeTiles: 18,
  pierce: true,
  formula: '1d10 + finesse * (1 + 0.16 * stacks(sniper-sighted))',
});

// Quick-pace setup turn: grants 1 stack of Sighted plus Steady Aim (attack advantage on next shot).
const BASE_SIGHTLINE = makeSightline({
  name: 'Sightline',
  aimKey: KEY_AIM,
  aimDef: STEADY_AIM,
  cooldownRounds: 3,
});

// D5 Fork B-Left (armor-buster): 2-round cooldown, 1 stack of Sighted plus Eagle Eye (advantage + 15% armor pen).
const UP_SIGHTLINE_EAGLE = makeSightline({
  name: 'Sightline: Eagle Perch',
  aimKey: KEY_AIM_UP,
  aimDef: EAGLE_EYE,
  cooldownRounds: 2,
});

// D5 Fork B-Right (hold-the-perch defense): 2-round cooldown, 1 stack of Sighted, Steady Aim, and Braced Perch (-15% damage taken + defense advantage).
const UP_SIGHTLINE_BRACE = makeSightline({
  name: 'Sightline: Overwatch Brace',
  aimKey: KEY_AIM,
  aimDef: STEADY_AIM,
  cooldownRounds: 2,
  extraOps: [{ op: 'applyStatus', key: KEY_BRACE, def: BRACED_PERCH, duration: rounds(1) }],
});

/** Base Sniper signature (before skill-tree nodes are folded on top). */
export const SNIPER_SIGNATURE: ClassSignature = {
  className: 'Sniper',
  bonus: { agi: 1, ctl: 1 },
  worn: BASE_PERCH,
  actives: [BASE_LONGSHOT, BASE_SIGHTLINE],
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

/** Full 7-depth, 2-branch, 16-buyable (18-node) Rare Sniper skill tree. */
export const SNIPER_TREE: ClassTree = {
  className: 'Sniper',
  rarity: 'rare',
  nodes: [
    // Depth 1: Root (1)
    node('sniper-root', 1, 'Zeroed Sights', 'Gain 2 Agility and 2 Control.', [], [
      bonus({ agi: 2, ctl: 2 }),
    ]),

    // Depth 2: Two branches (2)
    node('sniper-a2', 2, 'Long Barrel', 'Gain 2 Control and 3% armor penetration.', ['sniper-root'], [
      bonus({ ctl: 2, armorPen: 3 }),
    ]),
    node('sniper-b2', 2, 'High Ground', 'Gain 2 Agility and 3 opening.', ['sniper-root'], [
      bonus({ agi: 2, opening: 3 }),
    ]),

    // Depth 3: Branch splits (4)
    node('sniper-a3x', 3, 'Bodkin Tips', 'Gain 4% armor penetration and 4 flat armor penetration.', ['sniper-a2'], [
      bonus({ armorPen: 4, armorPenFlat: 4 }),
    ]),
    node('sniper-a3y', 3, 'Calibrated Draw', 'Gain 2 Control and 3 Accuracy.', ['sniper-a2'], [
      bonus({ ctl: 2, aim: 3 }),
    ]),
    node('sniper-b3x', 3, 'Steady Breath', 'Gain 2 Agility and 0.06 crit multiplier.', ['sniper-b2'], [
      bonus({ agi: 2, critSize: 6 }),
    ]),
    node('sniper-b3y', 3, 'Quick Chamber', 'Gain 6 ability haste and 3 speed.', ['sniper-b2'], [
      bonus({ haste: 6, speed: 3 }),
    ]),

    // Depth 4: Deepening (4)
    node('sniper-a4x', 4, 'Armor Piercer', 'Gain 5% armor penetration and 5 flat armor penetration.', ['sniper-a3x'], [
      bonus({ armorPen: 5, armorPenFlat: 5 }),
    ]),
    node('sniper-a4y', 4, 'Wind Reader', 'Gain 3 Control and 4 Accuracy.', ['sniper-a3y'], [
      bonus({ ctl: 3, aim: 4 }),
    ]),
    node('sniper-b4x', 4, 'Kill Window', 'Gain 1 extra crit face and 3 Agility.', ['sniper-b3x'], [
      bonus({ critFaces: 1, agi: 3 }),
    ]),
    node('sniper-b4y', 4, 'Overwatch Tempo', 'Gain 8 ability haste and 4 opening.', ['sniper-b3y'], [
      bonus({ haste: 8, opening: 4 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (4 nodes, 2 buyable)
    node('sniper-a5-l', 5, 'Piercing Round', 'Upgrade Longshot to an 18-tile piercing line shot with higher Sighted scaling.', ['sniper-a4x', 'sniper-a4y'], [
      replaceActive(ID_LONGSHOT, UP_LONGSHOT),
    ], { forkGroup: 'sniper-a5' }),
    node('sniper-a5-r', 5, 'Kill Confirm', 'Gain 6% armor penetration, 6 flat armor penetration, 3 Control, and up to 15% more damage against foes below half HP.', ['sniper-a4x', 'sniper-a4y'], [
      bonus({ armorPen: 6, armorPenFlat: 6, ctl: 3 }),
      scaler({ measure: 'target', dir: 'under', start: 0.5, scale: 0.15 }),
    ], { forkGroup: 'sniper-a5' }),

    node('sniper-b5-l', 5, 'Eagle Perch', 'Upgrade Sightline to a 2-round cooldown with 1 Sighted stack and Eagle Eye for 15% armor penetration.', ['sniper-b4x', 'sniper-b4y'], [
      replaceActive(ID_SIGHTLINE, UP_SIGHTLINE_EAGLE),
    ], { forkGroup: 'sniper-b5' }),
    node('sniper-b5-r', 5, 'Overwatch Brace', 'Upgrade Sightline to a 2-round cooldown with 1 Sighted stack and Braced Perch for 15% less damage taken and defense advantage.', ['sniper-b4x', 'sniper-b4y'], [
      replaceActive(ID_SIGHTLINE, UP_SIGHTLINE_BRACE),
    ], { forkGroup: 'sniper-b5' }),

    // Depth 6: Branch Capstones (2)
    node('sniper-a6', 6, 'Ballistic Precision', 'Gain 4 Control, 5% armor penetration, and 5 flat armor penetration.', ['sniper-a5-l', 'sniper-a5-r'], [
      bonus({ ctl: 4, armorPen: 5, armorPenFlat: 5 }),
    ], { parentMode: 'any' }),
    node('sniper-b6', 6, 'Nest Discipline', 'Gain 4 Agility, 8 ability haste, and 0.08 crit multiplier.', ['sniper-b5-l', 'sniper-b5-r'], [
      bonus({ agi: 4, haste: 8, critSize: 8 }),
    ], { parentMode: 'any' }),

    // Depth 7: Rare Capstone (1)
    node('sniper-cap', 7, 'Horizon Scope', 'Upgrade Vantage Perch to Horizon Scope and gain 4 Agility, 4 Control, and 4 Accuracy.', ['sniper-a6', 'sniper-b6'], [
      replaceWorn(KEY_PERCH, HORIZON_SCOPE),
      bonus({ agi: 4, ctl: 4, aim: 4 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
