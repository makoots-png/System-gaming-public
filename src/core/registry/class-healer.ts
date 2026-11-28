// class-healer.ts: Common Healer (dis+pre) signature kit and 12-node / 12-buyable skill tree.
// Pure static registry data. No gold literals: node prices come solely from RULES via classes.ts.
//
// Themes: Sanctuary (ally Discipline aura, heal power) and Purify (`Mending Pulse`, AoE cleanse).
// Root budget at rank D (~6 to 8 pts): small pair bonus `{ dis: 1, pre: 1, healPower: 3 }` + `Sanctuary Aura` + `Mending Pulse`.
import { RULES } from '../rules.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { StatusDef, StatusKey } from '../combat/effect-ops.ts';
import type { Trigger } from '../combat/triggers.ts';
import { tiles } from '../combat/space.ts';
import { cost } from '../combat/timeline.ts';
import { abilityOf, KIND_TAG } from './ability-kinds.ts';
import type { ClassTree, ClassWorn } from './class-trees.ts';
import type { ClassSignature } from './class-powers.ts';
import {
  EACH,
  ROUND,
  bonus,
  buildCommonTree,
  commonArea,
  commonFormula,
  commonRounds,
  replaceActive,
  replaceWorn,
} from './class-common.ts';

const R = RULES;
const f = (text: string) => commonFormula(text, 'Healer');

const KEY_SANCTUARY = statusKey('hlr-sanctuary');
const KEY_SANCTUARY_UP = statusKey('hlr-sanctuary-ii');
const KEY_PULSE = statusKey('hlr-mending-pulse');
const KEY_PULSE_UP = statusKey('hlr-mending-pulse-ii');

const ID_PULSE = abilityId('hlr-mending-pulse');

// ── statuses ──

function makeSanctuary(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly radius: number;
  readonly disAdd: string;
  readonly supportHeal?: string;
}): ClassWorn {
  const triggers: Trigger[] = o.supportHeal
    ? [
      {
        on: 'used',
        tag: KIND_TAG.support,
        to: commonArea(o.radius, 'allies'),
        limit: ROUND,
        ops: [{ op: 'heal', when: 'use', amount: f(o.supportHeal) }],
      },
    ]
    : [];
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [
        { op: 'aura', radius: o.radius, on: 'allies' },
        { op: 'stat', key: 'dis', amount: f(o.disAdd) },
      ],
      ...(triggers.length ? { triggers } : {}),
    },
  };
}

const BASE_SANCTUARY: ClassWorn = makeSanctuary({
  key: KEY_SANCTUARY,
  label: 'Sanctuary Aura',
  desc: 'You and allies within 2 tiles gain 4 Discipline.',
  radius: 2,
  disAdd: '4',
});

const GRAND_SANCTUARY: ClassWorn = makeSanctuary({
  key: KEY_SANCTUARY_UP,
  label: 'Grand Sanctuary',
  desc: 'You and allies within 3 tiles gain 8 Discipline. Once a round when you use a support ability, heal yourself and allies within 3 tiles for 25% of your support power.',
  radius: 3,
  disAdd: '8',
  supportHeal: '0.25 * sup',
});

// ── active ability ──

function makeMendingPulse(o: {
  readonly name: string;
  readonly pulseKey: StatusKey;
  readonly radius: number;
  readonly healFormula: string;
  readonly dispel: 'first' | 'all';
  readonly cooldownRounds: number;
}): Ability {
  // Uses a 1-round self status with a `statusGained` ally-area trigger so Mending Pulse heals and cleanses
  // only the healer and nearby allies, never foes standing within the radius.
  const pulseDef: StatusDef = {
    label: o.name,
    desc: `Heals you and allies within ${o.radius} tiles and removes ${o.dispel === 'all' ? 'all harmful statuses' : 'the oldest harmful status'} from each.`,
    ops: [],
    triggers: [
      {
        on: 'statusGained',
        key: o.pulseKey,
        to: commonArea(o.radius, 'allies'),
        limit: EACH,
        ops: [
          { op: 'heal', when: 'use', amount: f(o.healFormula) },
          { op: 'dispel', which: o.dispel },
        ],
      },
    ],
  };
  const base = abilityOf('support', {
    id: ID_PULSE,
    name: o.name,
    desc: `Heal yourself and allies within ${o.radius} tiles and remove ${o.dispel === 'all' ? 'all harmful statuses' : 'the oldest harmful status'} from each.`,
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: null,
    ops: [{ op: 'applyStatus', key: o.pulseKey, def: pulseDef, duration: commonRounds(1) }],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 6, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: commonRounds(o.cooldownRounds) },
  };
}

const BASE_PULSE = makeMendingPulse({
  name: 'Mending Pulse',
  pulseKey: KEY_PULSE,
  radius: 2,
  healFormula: '1d6 + 0.85 * sup',
  dispel: 'first',
  cooldownRounds: 2,
});

const UP_PULSE = makeMendingPulse({
  name: 'Mending Pulse: Radiant Purify',
  pulseKey: KEY_PULSE_UP,
  radius: 3,
  healFormula: '1d8 + 1.05 * sup',
  dispel: 'all',
  cooldownRounds: 2,
});

/** Base Common Healer signature (before skill-tree nodes are folded on top). */
export const HEALER_SIGNATURE: ClassSignature = {
  className: 'Healer',
  bonus: { dis: 1, pre: 1, healPower: 3 },
  worn: BASE_SANCTUARY,
  actives: [BASE_PULSE],
};

/** Full 5-depth, 2-branch, 12-buyable Common Healer skill tree (`1, 2, 4, 4, 1`, 0 forks). */
export const HEALER_TREE: ClassTree = buildCommonTree({
  className: 'Healer',
  prefix: 'hlr',
  root: {
    name: "Healer's Vow",
    desc: 'Gain 1 Discipline and 1 Presence.',
    gifts: [bonus({ dis: 1, pre: 1 })],
  },
  // Branch A: Sanctuary (ally Discipline aura & heal power)
  a2: {
    name: 'Sanctuary Circle',
    desc: 'Gain 2 Discipline and 4% heal and shield bonus.',
    gifts: [bonus({ dis: 2, healPower: 4 })],
  },
  a3x: {
    name: 'Calm Mind',
    desc: 'Gain 2 Discipline and 4 Will.',
    gifts: [bonus({ dis: 2, will: 4 })],
  },
  a3y: {
    name: "Mercy's Touch",
    desc: 'Gain 2 Presence and 5% heal and shield bonus.',
    gifts: [bonus({ pre: 2, healPower: 5 })],
  },
  a4x: {
    name: 'Unshaken Sanctuary',
    desc: 'Gain 3 Discipline, 4 tenacity, and 3 Will.',
    gifts: [bonus({ dis: 3, tenacity: 4, will: 3 })],
  },
  a4y: {
    name: 'Generous Grace',
    desc: 'Gain 2 Presence, 6% heal and shield bonus, and 15 max HP.',
    gifts: [bonus({ pre: 2, healPower: 6, hpMax: 15 })],
  },
  // Branch B: Purify (Mending Pulse, AoE cleanse, mana & haste)
  b2: {
    name: 'Cleanse Focus',
    desc: 'Gain 2 Presence and 2 max mana.',
    gifts: [bonus({ pre: 2, manaMax: 2 })],
  },
  b3x: {
    name: 'Lightened Prayer',
    desc: 'Gain 3% ability cost cut and 2 max mana.',
    gifts: [bonus({ costCut: 3, manaMax: 2 })],
  },
  b3y: {
    name: 'Swift Aid',
    desc: 'Gain 1 Presence and 6 ability haste.',
    gifts: [bonus({ pre: 1, haste: 6 })],
  },
  b4x: {
    name: 'Radiant Purify',
    desc: 'Upgrade Mending Pulse to Radiant Purify with a 3-tile radius, stronger healing, and full dispel of all harmful statuses.',
    gifts: [replaceActive(ID_PULSE, UP_PULSE)],
  },
  b4y: {
    name: 'Tireless Mending',
    desc: 'Gain 2 Presence, 8 ability haste, and 3 max mana.',
    gifts: [bonus({ pre: 2, haste: 8, manaMax: 3 })],
  },
  cap: {
    name: 'Grand Sanctuary',
    desc: 'Upgrade Sanctuary Aura to Grand Sanctuary and gain 2 Discipline, 2 Presence, and 4% heal and shield bonus.',
    gifts: [
      replaceWorn(KEY_SANCTUARY, GRAND_SANCTUARY),
      bonus({ dis: 2, pre: 2, healPower: 4 }),
    ],
  },
});
