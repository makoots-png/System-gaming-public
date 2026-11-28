// class-ranger.ts: Common Ranger (agi+ctl) signature kit and 12-node / 12-buyable skill tree.
// Pure static registry data. No gold literals: node prices come solely from RULES via classes.ts.
//
// Themes: Snare (slows into `root`) and Tempo (`Pinning Shot`, turn delay/range).
// Root budget at rank D (~6 to 8 pts): small pair bonus `{ agi: 1, ctl: 1, aim: 2 }` + `Hunter's Snare` + `Pinning Shot`.
import { RULES } from '../rules.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { StackDef, StatusDef, StatusKey } from '../combat/effect-ops.ts';
import type { Trigger } from '../combat/triggers.ts';
import { tiles } from '../combat/space.ts';
import { cost, tick } from '../combat/timeline.ts';
import { abilityOf, KIND_TAG } from './ability-kinds.ts';
import type { ClassTree, ClassWorn } from './class-trees.ts';
import type { ClassSignature } from './class-powers.ts';
import {
  EACH,
  ROUND,
  bonus,
  buildCommonTree,
  commonFormula,
  commonRounds,
  replaceActive,
  replaceWorn,
} from './class-common.ts';

const R = RULES;
const f = (text: string) => commonFormula(text, 'Ranger');

const KEY_SNARE_WORN = statusKey('rng-hunters-snare');
const KEY_SNARE_WORN_UP = statusKey('rng-hunters-snare-ii');
const KEY_TANGLED = statusKey('rng-tangled');
const KEY_ROOT = statusKey('rng-snare-root');

const ID_PINNING = abilityId('rng-pinning-shot');

// ── statuses ──

const SNARE_ROOT: StatusDef = {
  label: 'Snare Root',
  desc: 'Cannot move for 1 round.',
  ops: [{ op: 'root' }],
};

const TANGLED_DEF: StackDef = {
  label: 'Tangled',
  desc: 'Speed reduced by 10% per stack. At 2 stacks, all stacks are spent to root the target for 1 round.',
  ops: [{ op: 'speed', pct: -10 }],
  stack: {
    cap: 2,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: {
      at: { kind: 'count', n: 2 },
      to: { kind: 'bearer' },
      then: 'spend',
      ops: [{ op: 'applyStatus', key: KEY_ROOT, def: SNARE_ROOT, duration: commonRounds(1) }],
    },
  },
};

function makeSnareWorn(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly rangeAdd: number;
  readonly delayShare: number | null;
}): ClassWorn {
  const triggers: Trigger[] = [
    {
      on: 'hitDealt',
      tag: KIND_TAG.shot,
      to: 'other',
      limit: EACH,
      ops: [{ op: 'applyStatus', key: KEY_TANGLED, def: TANGLED_DEF, duration: commonRounds(2) }],
    },
    ...(o.delayShare !== null
      ? [{
        on: 'hitDealt' as const,
        tag: KIND_TAG.shot,
        to: 'other' as const,
        limit: ROUND,
        ops: [{ op: 'delay' as const, ticks: tick(Math.round(o.delayShare * R.fight.round)) }],
      }]
      : []),
  ];
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [{ op: 'sheet', key: 'range', amount: o.rangeAdd }],
      triggers,
    },
  };
}

const BASE_SNARE_WORN: ClassWorn = makeSnareWorn({
  key: KEY_SNARE_WORN,
  label: "Hunter's Snare",
  desc: 'Your ranged abilities reach 1 tile farther. Your shot hits apply 1 stack of Tangled (-10% speed for 2 rounds). At 2 stacks, the target is rooted for 1 round.',
  rangeAdd: 1,
  delayShare: null,
});

const MASTER_TRACKER: ClassWorn = makeSnareWorn({
  key: KEY_SNARE_WORN_UP,
  label: 'Master Tracker',
  desc: "Your ranged abilities reach 2 tiles farther. Your shot hits apply Tangled (2 stacks root for 1 round) and delay the target's next turn by 20% of a round once per round.",
  rangeAdd: 2,
  delayShare: 0.2,
});

// ── active ability ──

function makePinningShot(o: {
  readonly name: string;
  readonly rangeTiles: number;
  readonly formula: string;
  readonly delayShare: number;
}): Ability {
  const base = abilityOf('shot', {
    id: ID_PINNING,
    name: o.name,
    desc: `Fire a ranged shot up to ${o.rangeTiles} tiles that delays the target's next turn and applies Tangled for 2 rounds (-10% speed, roots at 2 stacks).`,
    aim: 'foe',
    range: tiles(o.rangeTiles),
    shape: { kind: 'line', width: tiles(0), pierce: false },
    delivery: { kind: 'travel', windup: tick(100), speed: 100 },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'delay', ticks: tick(Math.round(o.delayShare * R.fight.round)) },
      { op: 'applyStatus', key: KEY_TANGLED, def: TANGLED_DEF, duration: commonRounds(2) },
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: commonRounds(2) },
  };
}

const BASE_PINNING = makePinningShot({
  name: 'Pinning Shot',
  rangeTiles: 12,
  formula: '1d8 + 0.7 * finesse',
  delayShare: 0.25,
});

const UP_PINNING = makePinningShot({
  name: 'Pinning Shot: Lockshot',
  rangeTiles: 14,
  formula: '1d10 + 0.9 * finesse',
  delayShare: 0.35,
});

/** Base Common Ranger signature (before skill-tree nodes are folded on top). */
export const RANGER_SIGNATURE: ClassSignature = {
  className: 'Ranger',
  bonus: { agi: 1, ctl: 1, aim: 2 },
  worn: BASE_SNARE_WORN,
  actives: [BASE_PINNING],
};

/** Full 5-depth, 2-branch, 12-buyable Common Ranger skill tree (`1, 2, 4, 4, 1`, 0 forks). */
export const RANGER_TREE: ClassTree = buildCommonTree({
  className: 'Ranger',
  prefix: 'rng',
  root: {
    name: 'Trail Sense',
    desc: 'Gain 1 Agility and 1 Control.',
    gifts: [bonus({ agi: 1, ctl: 1 })],
  },
  // Branch A: Snare (potency, accuracy, armor penetration)
  a2: {
    name: 'Weighted Shafts',
    desc: 'Gain 2 Control and 3 potency.',
    gifts: [bonus({ ctl: 2, potency: 3 })],
  },
  a3x: {
    name: 'Tightened Cord',
    desc: 'Gain 4 potency and 3 Accuracy.',
    gifts: [bonus({ potency: 4, aim: 3 })],
  },
  a3y: {
    name: 'Hunting Sight',
    desc: 'Gain 2 Control and 4% armor penetration.',
    gifts: [bonus({ ctl: 2, armorPen: 4 })],
  },
  a4x: {
    name: 'Deep Snare',
    desc: 'Gain 2 Control, 5 potency, and 3 Accuracy.',
    gifts: [bonus({ ctl: 2, potency: 5, aim: 3 })],
  },
  a4y: {
    name: 'Broadhead Tips',
    desc: 'Gain 1 Control, 5% armor penetration, and 4 flat armor penetration.',
    gifts: [bonus({ ctl: 1, armorPen: 5, armorPenFlat: 4 })],
  },
  // Branch B: Tempo (Pinning Shot, turn delay, speed & haste)
  b2: {
    name: 'Quick Draw',
    desc: 'Gain 2 Agility and 3 opening.',
    gifts: [bonus({ agi: 2, opening: 3 })],
  },
  b3x: {
    name: 'Light Quiver',
    desc: 'Gain 2 Agility and 4 speed.',
    gifts: [bonus({ agi: 2, speed: 4 })],
  },
  b3y: {
    name: 'Rapid Volley',
    desc: 'Gain 6 ability haste and 0.04 crit multiplier.',
    gifts: [bonus({ haste: 6, critSize: 4 })],
  },
  b4x: {
    name: 'Lockshot',
    desc: 'Upgrade Pinning Shot to Lockshot with 14-tile range, higher finesse damage, and 35% turn delay.',
    gifts: [replaceActive(ID_PINNING, UP_PINNING)],
  },
  b4y: {
    name: 'Wind Tempo',
    desc: 'Gain 3 Agility, 5 speed, and 6 ability haste.',
    gifts: [bonus({ agi: 3, speed: 5, haste: 6 })],
  },
  cap: {
    name: 'Master Tracker',
    desc: "Upgrade Hunter's Snare to Master Tracker and gain 2 Agility and 2 Control.",
    gifts: [
      replaceWorn(KEY_SNARE_WORN, MASTER_TRACKER),
      bonus({ agi: 2, ctl: 2 }),
    ],
  },
});
