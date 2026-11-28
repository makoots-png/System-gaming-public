// class-fighter.ts: Common Fighter (str+vit) signature kit and 12-node / 12-buyable skill tree.
// Pure static registry data. No gold literals: node prices come solely from RULES via classes.ts.
//
// Themes: Grit (`desperate` scaler, low-HP toughness) and Momentum (`Iron Cleave`, kill-heal).
// Root budget at rank D (~6 to 8 pts): small pair bonus `{ str: 1, vit: 1 }` + `Battle Grit` worn passive + `Iron Cleave`.
import { RULES } from '../rules.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { StatusDef, StatusKey, UseOp } from '../combat/effect-ops.ts';
import { tiles } from '../combat/space.ts';
import { cost, tick } from '../combat/timeline.ts';
import { abilityOf } from './ability-kinds.ts';
import type { ClassTree, ClassWorn } from './class-trees.ts';
import type { ClassSignature } from './class-powers.ts';
import {
  ONCE,
  ROUND,
  bonus,
  buildCommonTree,
  commonFormula,
  commonRounds,
  replaceActive,
  replaceWorn,
  scaler,
} from './class-common.ts';

const R = RULES;
const f = (text: string) => commonFormula(text, 'Fighter');
const LOW_HP_PCT = Math.round(R.fight.kit.lowHpAt * 100);

const KEY_GRIT = statusKey('ftr-battle-grit');
const KEY_GRIT_UP = statusKey('ftr-battle-grit-ii');
const KEY_STAND = statusKey('ftr-battle-stand');
const KEY_STAND_UP = statusKey('ftr-battle-stand-ii');
const KEY_SUNDER = statusKey('ftr-sundered-guard');

const ID_CLEAVE = abilityId('ftr-iron-cleave');

// ── statuses ──

const BATTLE_STAND: StatusDef = {
  label: 'Battle Stand',
  desc: 'Armor increased by 8 and magic resist increased by 6 for 2 rounds.',
  ops: [
    { op: 'sheet', key: 'armor', amount: f('8') },
    { op: 'sheet', key: 'resist', amount: f('6') },
  ],
};

const BATTLE_STAND_UP: StatusDef = {
  label: 'Battle Stand II',
  desc: 'Armor increased by 14 and magic resist increased by 10 for 2 rounds.',
  ops: [
    { op: 'sheet', key: 'armor', amount: f('14') },
    { op: 'sheet', key: 'resist', amount: f('10') },
  ],
};

const SUNDERED_GUARD: StatusDef = {
  label: 'Sundered Guard',
  desc: 'Armor reduced by 8 for 2 rounds.',
  ops: [{ op: 'sheet', key: 'armor', amount: f('-8') }],
};

function makeGrit(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly killHeal: string;
  readonly lowHpShield: string;
  readonly standKey: StatusKey;
  readonly standDef: StatusDef;
}): ClassWorn {
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [],
      triggers: [
        {
          on: 'kill',
          tag: null,
          to: 'self',
          limit: ROUND,
          ops: [{ op: 'heal', when: 'use', amount: f(o.killHeal) }],
        },
        {
          on: 'lowHp',
          to: 'self',
          limit: ONCE,
          ops: [
            { op: 'shield', amount: f(o.lowHpShield) },
            { op: 'applyStatus', key: o.standKey, def: o.standDef, duration: commonRounds(2) },
          ],
        },
      ],
    },
  };
}

const BASE_GRIT: ClassWorn = makeGrit({
  key: KEY_GRIT,
  label: 'Battle Grit',
  desc: `Once a round when you defeat a foe, heal 4% of max HP. Once a fight below ${LOW_HP_PCT}% HP, gain a 9% max HP shield and Battle Stand (+8 armor and +6 magic resist for 2 rounds).`,
  killHeal: '0.04 * hpmax',
  lowHpShield: '0.09 * hpmax',
  standKey: KEY_STAND,
  standDef: BATTLE_STAND,
});

const UNBROKEN_GRIT: ClassWorn = makeGrit({
  key: KEY_GRIT_UP,
  label: 'Unbroken Grit',
  desc: `Once a round when you defeat a foe, heal 10% of max HP. Once a fight below ${LOW_HP_PCT}% HP, gain an 18% max HP shield and Battle Stand II (+14 armor and +10 magic resist for 2 rounds).`,
  killHeal: '0.1 * hpmax',
  lowHpShield: '0.18 * hpmax',
  standKey: KEY_STAND_UP,
  standDef: BATTLE_STAND_UP,
});

// ── active ability ──

function makeIronCleave(o: {
  readonly name: string;
  readonly desc: string;
  readonly formula: string;
  readonly cooldownRounds: number;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('strike', {
    id: ID_CLEAVE,
    name: o.name,
    desc: o.desc,
    aim: 'foe',
    range: tiles(1),
    shape: { kind: 'touch', reach: tiles(1) },
    delivery: { kind: 'travel', windup: tick(R.fight.abilityKinds.strike.windup), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'applyStatus', key: KEY_SUNDER, def: SUNDERED_GUARD, duration: commonRounds(2) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 8, time: cost(R.fight.cost.standard), cooldown: commonRounds(o.cooldownRounds) },
  };
}

const BASE_CLEAVE = makeIronCleave({
  name: 'Iron Cleave',
  desc: 'Physical strike that applies Sundered Guard for 2 rounds, reducing target armor by 8.',
  formula: '1d10 + 1.0 * phys',
  cooldownRounds: 2,
});

const UP_CLEAVE = makeIronCleave({
  name: 'Iron Cleave: Heavy Cleave',
  desc: 'Physical strike that applies Sundered Guard for 2 rounds (armor -8) and fills 15% of an elite or boss stagger bar.',
  formula: '2d6 + 1.15 * phys',
  cooldownRounds: 2,
  extraOps: [{ op: 'stagger', share: 0.15 }],
});

/** Base Common Fighter signature (before skill-tree nodes are folded on top). */
export const FIGHTER_SIGNATURE: ClassSignature = {
  className: 'Fighter',
  bonus: { str: 1, vit: 1 },
  worn: BASE_GRIT,
  actives: [BASE_CLEAVE],
};

/** Full 5-depth, 2-branch, 12-buyable Common Fighter skill tree (`1, 2, 4, 4, 1`, 0 forks). */
export const FIGHTER_TREE: ClassTree = buildCommonTree({
  className: 'Fighter',
  prefix: 'ftr',
  root: {
    name: "Fighter's Stance",
    desc: 'Gain 1 Strength and 1 Vitality.',
    gifts: [bonus({ str: 1, vit: 1 })],
  },
  // Branch A: Grit (low-HP toughness & desperate scaler)
  a2: {
    name: 'Hardened Grit',
    desc: 'Gain 2 Vitality and 10 max HP.',
    gifts: [bonus({ vit: 2, hpMax: 10 })],
  },
  a3x: {
    name: 'Thick Skin',
    desc: 'Gain 2 Vitality and 3 tenacity.',
    gifts: [bonus({ vit: 2, tenacity: 3 })],
  },
  a3y: {
    name: 'Last Stand',
    desc: 'Deal up to 20% more damage as your HP drops below half.',
    gifts: [scaler({ measure: 'user', dir: 'under', start: 0.5, scale: 0.2 })],
  },
  a4x: {
    name: 'Iron Resolve',
    desc: 'Gain 2 Vitality, 20 max HP, and 3 tenacity.',
    gifts: [bonus({ vit: 2, hpMax: 20, tenacity: 3 })],
  },
  a4y: {
    name: 'Defiant Heart',
    desc: 'Gain 2 Vitality, 4 Will, and 5% heal and shield bonus.',
    gifts: [bonus({ vit: 2, will: 4, healPower: 5 })],
  },
  // Branch B: Momentum (Iron Cleave & kill-heal pressure)
  b2: {
    name: 'Forward Drive',
    desc: 'Gain 2 Strength and 3 speed.',
    gifts: [bonus({ str: 2, speed: 3 })],
  },
  b3x: {
    name: 'Splitting Edge',
    desc: 'Gain 2 Strength and 4% armor penetration.',
    gifts: [bonus({ str: 2, armorPen: 4 })],
  },
  b3y: {
    name: 'Press the Line',
    desc: 'Gain 1 Strength and 6 ability haste.',
    gifts: [bonus({ str: 1, haste: 6 })],
  },
  b4x: {
    name: 'Heavy Cleave',
    desc: 'Upgrade Iron Cleave to Heavy Cleave for higher physical damage and 15% stagger.',
    gifts: [replaceActive(ID_CLEAVE, UP_CLEAVE)],
  },
  b4y: {
    name: 'Crushing Pace',
    desc: 'Gain 3 Strength, 4 flat armor penetration, and 4 speed.',
    gifts: [bonus({ str: 3, armorPenFlat: 4, speed: 4 })],
  },
  cap: {
    name: 'Unbroken Grit',
    desc: 'Upgrade Battle Grit to Unbroken Grit and gain 2 Strength and 2 Vitality.',
    gifts: [
      replaceWorn(KEY_GRIT, UNBROKEN_GRIT),
      bonus({ str: 2, vit: 2 }),
    ],
  },
});
