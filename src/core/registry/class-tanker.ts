// class-tanker.ts: Common Tanker (vit+dis) signature kit and 12-node / 12-buyable skill tree.
// Pure static registry data. No gold literals: node prices come solely from RULES via classes.ts.
//
// Themes: Bulwark (damage cut, per-round shield) and Vanguard (`Aegis Bash`, taunt/stagger).
// Root budget at rank D (~6 to 8 pts): small pair bonus `{ vit: 1, dis: 1 }` + `Iron Guard` worn passive + `Aegis Bash`.
import { RULES } from '../rules.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { Op, StatusDef, StatusKey } from '../combat/effect-ops.ts';
import { tiles } from '../combat/space.ts';
import { cost, tick } from '../combat/timeline.ts';
import { abilityOf } from './ability-kinds.ts';
import type { ClassTree, ClassWorn } from './class-trees.ts';
import type { ClassSignature } from './class-powers.ts';
import {
  ROUND,
  bonus,
  buildCommonTree,
  commonFormula,
  commonRounds,
  replaceActive,
  replaceWorn,
} from './class-common.ts';

const R = RULES;
const f = (text: string) => commonFormula(text, 'Tanker');

const KEY_GUARD = statusKey('tnk-iron-guard');
const KEY_GUARD_UP = statusKey('tnk-iron-guard-ii');
const KEY_TAUNT = statusKey('tnk-aegis-taunt');

const ID_BASH = abilityId('tnk-aegis-bash');

// ── statuses ──

const AEGIS_TAUNT: StatusDef = {
  label: 'Aegis Taunt',
  desc: 'Must target the Tanker while they are up and in reach.',
  ops: [{ op: 'taunt' }],
};

function makeIronGuard(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly takenPct: number;
  readonly armor: string | null;
  readonly resist: string | null;
  readonly roundShield: string;
}): ClassWorn {
  const ops: Op[] = [
    { op: 'share', on: 'taken', pct: o.takenPct },
    ...(o.armor !== null ? [{ op: 'sheet' as const, key: 'armor' as const, amount: f(o.armor) }] : []),
    ...(o.resist !== null ? [{ op: 'sheet' as const, key: 'resist' as const, amount: f(o.resist) }] : []),
  ];
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops,
      triggers: [
        {
          on: 'turnStart',
          to: 'self',
          limit: ROUND,
          ops: [{ op: 'shield', amount: f(o.roundShield) }],
        },
      ],
    },
  };
}

const BASE_GUARD: ClassWorn = makeIronGuard({
  key: KEY_GUARD,
  label: 'Iron Guard',
  desc: 'Take 8% less damage and gain a 2% max HP shield at the start of each round.',
  takenPct: -8,
  armor: null,
  resist: null,
  roundShield: '0.02 * hpmax',
});

const UNBREAKABLE_BULWARK: ClassWorn = makeIronGuard({
  key: KEY_GUARD_UP,
  label: 'Unbreakable Bulwark',
  desc: 'Take 12% less damage, gain 8 armor and 8 magic resist, and gain an 8% max HP shield at the start of each round.',
  takenPct: -12,
  armor: '8',
  resist: '8',
  roundShield: '0.08 * hpmax',
});

// ── active ability ──

function makeAegisBash(o: {
  readonly name: string;
  readonly formula: string;
  readonly staggerShare: number;
}): Ability {
  const base = abilityOf('strike', {
    id: ID_BASH,
    name: o.name,
    desc: `Armor-scaled physical strike that taunts the target for 2 rounds and fills ${Math.round(o.staggerShare * 100)}% of an elite or boss stagger bar.`,
    aim: 'foe',
    range: tiles(1),
    shape: { kind: 'touch', reach: tiles(1) },
    delivery: { kind: 'travel', windup: tick(R.fight.abilityKinds.strike.windup), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'applyStatus', key: KEY_TAUNT, def: AEGIS_TAUNT, duration: commonRounds(2) },
      { op: 'stagger', share: o.staggerShare },
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: commonRounds(2) },
  };
}

const BASE_BASH = makeAegisBash({
  name: 'Aegis Bash',
  formula: '1d6 + 0.55 * phys + 0.1 * armor',
  staggerShare: 0.15,
});

const UP_BASH = makeAegisBash({
  name: 'Aegis Bash: Shield Breaker',
  formula: '1d8 + 0.65 * phys + 0.18 * armor',
  staggerShare: 0.25,
});

/** Base Common Tanker signature (before skill-tree nodes are folded on top). */
export const TANKER_SIGNATURE: ClassSignature = {
  className: 'Tanker',
  bonus: { vit: 1 },
  worn: BASE_GUARD,
  actives: [BASE_BASH],
};

/** Full 5-depth, 2-branch, 12-buyable Common Tanker skill tree (`1, 2, 4, 4, 1`, 0 forks). */
export const TANKER_TREE: ClassTree = buildCommonTree({
  className: 'Tanker',
  prefix: 'tnk',
  root: {
    name: 'Shield Discipline',
    desc: 'Gain 1 Vitality and 1 Discipline.',
    gifts: [bonus({ vit: 1, dis: 1 })],
  },
  // Branch A: Bulwark (damage mitigation, HP, tenacity, shield strength)
  a2: {
    name: 'Plate Conditioning',
    desc: 'Gain 2 Vitality and 12 max HP.',
    gifts: [bonus({ vit: 2, hpMax: 12 })],
  },
  a3x: {
    name: 'Stalwart Frame',
    desc: 'Gain 2 Vitality and 3 tenacity.',
    gifts: [bonus({ vit: 2, tenacity: 3 })],
  },
  a3y: {
    name: 'Steady Nerve',
    desc: 'Gain 2 Discipline and 3 Will.',
    gifts: [bonus({ dis: 2, will: 3 })],
  },
  a4x: {
    name: 'Fortress Ward',
    desc: 'Gain 2 Vitality, 20 max HP, and 6% heal and shield bonus.',
    gifts: [bonus({ vit: 2, hpMax: 20, healPower: 6 })],
  },
  a4y: {
    name: 'Unshaken Will',
    desc: 'Gain 3 Discipline, 4 tenacity, and 3 Will.',
    gifts: [bonus({ dis: 3, tenacity: 4, will: 3 })],
  },
  // Branch B: Frontline / Vanguard (Aegis Bash, taunt, threat, stagger)
  b2: {
    name: 'Hold the Front',
    desc: 'Gain 2 Discipline and 5% threat.',
    gifts: [bonus({ dis: 2, threat: 5 })],
  },
  b3x: {
    name: 'Provoking Presence',
    desc: 'Gain 6% threat and 12 max HP.',
    gifts: [bonus({ threat: 6, hpMax: 12 })],
  },
  b3y: {
    name: 'Shield Tempo',
    desc: 'Gain 1 Vitality and 6 ability haste.',
    gifts: [bonus({ vit: 1, haste: 6 })],
  },
  b4x: {
    name: 'Shield Breaker',
    desc: 'Upgrade Aegis Bash to Shield Breaker for higher armor-scaled physical damage and 25% stagger.',
    gifts: [replaceActive(ID_BASH, UP_BASH)],
  },
  b4y: {
    name: 'Lineholder',
    desc: 'Gain 2 Vitality, 2 Discipline, and 8% threat.',
    gifts: [bonus({ vit: 2, dis: 2, threat: 8 })],
  },
  cap: {
    name: 'Unbreakable Bulwark',
    desc: 'Upgrade Iron Guard to Unbreakable Bulwark and gain 2 Vitality and 2 Discipline.',
    gifts: [
      replaceWorn(KEY_GUARD, UNBREAKABLE_BULWARK),
      bonus({ vit: 2, dis: 2 }),
    ],
  },
});
