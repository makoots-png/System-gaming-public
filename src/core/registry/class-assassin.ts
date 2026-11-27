// class-assassin.ts: Common Assassin (agi+ins) signature kit and 12-node / 12-buyable skill tree.
// Pure static registry data. No gold literals: node prices come solely from RULES via classes.ts.
//
// Themes: Shadowstep (dodge/riposte) and Lethality (`Viper Fang`, crits/`opener`).
// Root budget at rank D (~6 to 8 pts): small pair bonus `{ agi: 1, ins: 1 }` + `Shadow Footwork` worn passive + `Viper Fang`.
import { RULES } from '../rules.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { LandOp, StatusDef, StatusKey } from '../combat/effect-ops.ts';
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
  commonTiered,
  replaceActive,
  replaceWorn,
  scaler,
} from './class-common.ts';

const R = RULES;
const f = (text: string) => commonFormula(text, 'Assassin');

const KEY_FOOTWORK = statusKey('asn-footwork');
const KEY_FOOTWORK_UP = statusKey('asn-footwork-ii');
const KEY_EDGE = statusKey('asn-shadow-edge');
const KEY_VENOM = statusKey('asn-viper-venom');
const KEY_VENOM_UP = statusKey('asn-viper-venom-ii');

const ID_FANG = abilityId('asn-viper-fang');

// ── statuses ──

const SHADOW_EDGE: StatusDef = {
  label: 'Shadow Edge',
  desc: 'Advantage on your next attack roll for 1 round.',
  ops: [{ op: 'edge', side: 'attack', keep: 'better', tag: null, spend: true }],
};

const VIPER_VENOM: StatusDef = {
  label: 'Viper Venom',
  desc: 'Attacks against this target crit on 1 more die face for 2 rounds.',
  ops: [{ op: 'sheet', key: 'exposed', amount: 1 }],
};

const VIPER_VENOM_UP: StatusDef = {
  label: 'Viper Venom II',
  desc: 'Attacks against this target crit on 1 more die face and takes physical venom damage each round for 2 rounds.',
  ops: [
    { op: 'sheet', key: 'exposed', amount: 1 },
    { op: 'damage', type: 'physical', when: 'turn', amount: commonTiered('Assassin', '1d4', '1d4', '1d6', '1d8', '2d6', '2d8') },
  ],
};

function makeFootwork(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly counterFormula: string;
  readonly extraSelfOps?: readonly LandOp[];
}): ClassWorn {
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [],
      triggers: [
        {
          on: 'avoided',
          tag: null,
          to: 'other',
          limit: ROUND,
          ops: [{ op: 'damage', type: 'physical', when: 'use', amount: f(o.counterFormula) }],
        },
        {
          on: 'avoided',
          tag: null,
          to: 'self',
          limit: ROUND,
          ops: [
            { op: 'applyStatus', key: KEY_EDGE, def: SHADOW_EDGE, duration: commonRounds(1) },
            ...(o.extraSelfOps ?? []),
          ],
        },
      ],
    },
  };
}

const BASE_FOOTWORK: ClassWorn = makeFootwork({
  key: KEY_FOOTWORK,
  label: 'Shadow Footwork',
  desc: "Once a round when a foe's attack misses you, strike back for physical damage equal to 22% of your finesse power and gain Shadow Edge (advantage on your next attack).",
  counterFormula: '0.22 * finesse',
});

const SHADOW_REPRISAL: ClassWorn = makeFootwork({
  key: KEY_FOOTWORK_UP,
  label: 'Shadow Reprisal',
  desc: "Once a round when a foe's attack misses you, strike back for physical damage equal to 35% of your finesse power, gain Shadow Edge, and hasten your next turn by 15%.",
  counterFormula: '0.35 * finesse',
  extraSelfOps: [{ op: 'hasten', share: 0.15 }],
});

// ── active ability ──

function makeViperFang(o: {
  readonly name: string;
  readonly formula: string;
  readonly cooldownRounds: number;
  readonly venomKey: StatusKey;
  readonly venomDef: StatusDef;
}): Ability {
  const base = abilityOf('strike', {
    id: ID_FANG,
    name: o.name,
    aim: 'foe',
    range: tiles(1),
    shape: { kind: 'touch', reach: tiles(1) },
    delivery: { kind: 'travel', windup: tick(R.fight.abilityKinds.strike.windup), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [{ op: 'applyStatus', key: o.venomKey, def: o.venomDef, duration: commonRounds(2) }],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 6, time: cost(R.fight.cost.quick), cooldown: commonRounds(o.cooldownRounds) },
  };
}

const BASE_FANG = makeViperFang({
  name: 'Viper Fang',
  formula: '1d6 + 0.65 * finesse',
  cooldownRounds: 2,
  venomKey: KEY_VENOM,
  venomDef: VIPER_VENOM,
});

const UP_FANG = makeViperFang({
  name: 'Viper Fang: Fatal Fang',
  formula: '1d8 + 0.85 * finesse',
  cooldownRounds: 1,
  venomKey: KEY_VENOM_UP,
  venomDef: VIPER_VENOM_UP,
});

/** Base Common Assassin signature (before skill-tree nodes are folded on top). */
export const ASSASSIN_SIGNATURE: ClassSignature = {
  className: 'Assassin',
  bonus: { agi: 1, ins: 1 },
  worn: BASE_FOOTWORK,
  actives: [BASE_FANG],
};

/** Full 5-depth, 2-branch, 12-buyable Common Assassin skill tree (`1, 2, 4, 4, 1`, 0 forks). */
export const ASSASSIN_TREE: ClassTree = buildCommonTree({
  className: 'Assassin',
  prefix: 'asn',
  root: {
    name: 'Light Step',
    desc: 'Gain 1 Agility and 1 Instinct.',
    gifts: [bonus({ agi: 1, ins: 1 })],
  },
  // Branch A: Shadowstep (dodge & counter footwork)
  a2: {
    name: 'Slipstream',
    desc: 'Gain 2 Agility and 3 Reaction.',
    gifts: [bonus({ agi: 2, react: 3 })],
  },
  a3x: {
    name: 'Phantom Dodge',
    desc: 'Gain 4 Reaction and 4 speed.',
    gifts: [bonus({ react: 4, speed: 4 })],
  },
  a3y: {
    name: 'Quick Reflex',
    desc: 'Gain 2 Agility and 3 opening.',
    gifts: [bonus({ agi: 2, opening: 3 })],
  },
  a4x: {
    name: 'Silent Stride',
    desc: 'Gain 2 Agility, 6 speed, and 1 move tile.',
    gifts: [bonus({ agi: 2, speed: 6, move: 1 })],
  },
  a4y: {
    name: 'Counter Poise',
    desc: 'Gain 2 Instinct, 4 Reaction, and 6 ability haste.',
    gifts: [bonus({ ins: 2, react: 4, haste: 6 })],
  },
  // Branch B: Lethality (Viper Fang, crits & opener scaler)
  b2: {
    name: 'Keen Eye',
    desc: 'Gain 2 Instinct and 0.04 crit multiplier.',
    gifts: [bonus({ ins: 2, critSize: 4 })],
  },
  b3x: {
    name: 'First Blood',
    desc: 'Deal up to 20% more damage against foes above half HP.',
    gifts: [scaler({ measure: 'target', dir: 'over', start: 0.5, scale: 0.2 })],
  },
  b3y: {
    name: 'Lethal Edge',
    desc: 'Gain 4 flat armor penetration and 0.05 crit multiplier.',
    gifts: [bonus({ armorPenFlat: 4, critSize: 5 })],
  },
  b4x: {
    name: 'Fatal Fang',
    desc: 'Upgrade Viper Fang to Fatal Fang with a 1-round cooldown, higher finesse damage, and venom damage each round.',
    gifts: [replaceActive(ID_FANG, UP_FANG)],
  },
  b4y: {
    name: 'Heartseeker',
    desc: 'Gain 1 extra crit face and 5% armor penetration.',
    gifts: [bonus({ critFaces: 1, armorPen: 5 })],
  },
  cap: {
    name: 'Shadow Reprisal',
    desc: 'Upgrade Shadow Footwork to Shadow Reprisal and gain 2 Agility and 2 Instinct.',
    gifts: [
      replaceWorn(KEY_FOOTWORK, SHADOW_REPRISAL),
      bonus({ agi: 2, ins: 2 }),
    ],
  },
});
