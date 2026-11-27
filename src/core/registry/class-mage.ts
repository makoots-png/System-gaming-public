// class-mage.ts: Common Mage (pow+ctl) signature kit and 12-node / 12-buyable skill tree.
// Pure static registry data. No gold literals: node prices come solely from RULES via classes.ts.
//
// Themes: Arcane Pierce (`Arcane Nova`, resist penetration) and Spellflow (cost cut, kill turn refund).
// Root budget at rank D (~6 to 8 pts): small pair bonus `{ pow: 1, ctl: 1 }` + `Spellflow` worn passive + `Arcane Nova`.
import { RULES } from '../rules.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { LandOp, StatusDef, StatusKey, UseOp } from '../combat/effect-ops.ts';
import { tiles } from '../combat/space.ts';
import { cost, tick } from '../combat/timeline.ts';
import { abilityOf, SPELL_TAG } from './ability-kinds.ts';
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
const f = (text: string) => commonFormula(text, 'Mage');

const KEY_SPELLFLOW = statusKey('mag-spellflow');
const KEY_SPELLFLOW_UP = statusKey('mag-spellflow-ii');
const KEY_SHATTER = statusKey('mag-shattered-ward');
const KEY_SHATTER_UP = statusKey('mag-shattered-ward-ii');

const ID_NOVA = abilityId('mag-arcane-nova');

// ── statuses ──

const SHATTERED_WARD: StatusDef = {
  label: 'Shattered Ward',
  desc: 'Magic resist reduced by 10 for 2 rounds.',
  ops: [{ op: 'sheet', key: 'resist', amount: f('-10') }],
};

const SHATTERED_WARD_UP: StatusDef = {
  label: 'Shattered Ward II',
  desc: 'Magic resist reduced by 18 for 2 rounds.',
  ops: [{ op: 'sheet', key: 'resist', amount: f('-18') }],
};

function makeSpellflow(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly resistPen: string;
  readonly costCut: string;
  readonly refundPct: number;
  readonly extraKillOps?: readonly LandOp[];
}): ClassWorn {
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [
        { op: 'sheet', key: 'resistPen', amount: f(o.resistPen) },
        { op: 'sheet', key: 'costCut', amount: f(o.costCut) },
      ],
      triggers: [
        {
          on: 'kill',
          tag: SPELL_TAG,
          to: 'self',
          limit: ROUND,
          ops: [
            { op: 'refund', pct: o.refundPct },
            ...(o.extraKillOps ?? []),
          ],
        },
      ],
    },
  };
}

const BASE_SPELLFLOW: ClassWorn = makeSpellflow({
  key: KEY_SPELLFLOW,
  label: 'Spellflow',
  desc: 'Your spells ignore 4% of magic resist and cost 1% less mana and fatigue. Once a round when your spell defeats a foe, refund 12% of your turn.',
  resistPen: '4',
  costCut: '0.01',
  refundPct: 12,
});

const MASTER_SPELLFLOW: ClassWorn = makeSpellflow({
  key: KEY_SPELLFLOW_UP,
  label: 'Master of Spellflow',
  desc: 'Your spells ignore 10% of magic resist and cost 5% less mana and fatigue. Once a round when your spell defeats a foe, refund 35% of your turn and restore 2 mana.',
  resistPen: '10',
  costCut: '0.05',
  refundPct: 35,
  extraKillOps: [{ op: 'mana', when: 'use', amount: f('2') }],
});

// ── active ability ──

function makeArcaneNova(o: {
  readonly name: string;
  readonly radiusTiles: number;
  readonly formula: string;
  readonly wardKey: StatusKey;
  readonly wardDef: StatusDef;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('blast', {
    id: ID_NOVA,
    name: o.name,
    aim: 'place',
    range: tiles(0),
    shape: { kind: 'radius', radius: tiles(o.radiusTiles), ring: null },
    delivery: { kind: 'travel', windup: tick(200), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'applyStatus', key: o.wardKey, def: o.wardDef, duration: commonRounds(2) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 6, fatigue: 4, time: cost(R.fight.cost.standard), cooldown: commonRounds(2) },
  };
}

const BASE_NOVA = makeArcaneNova({
  name: 'Arcane Nova',
  radiusTiles: 2,
  formula: '1d10 + 0.85 * mag',
  wardKey: KEY_SHATTER,
  wardDef: SHATTERED_WARD,
});

const UP_NOVA = makeArcaneNova({
  name: 'Arcane Nova: Starburst',
  radiusTiles: 3,
  formula: '2d6 + 1.0 * mag',
  wardKey: KEY_SHATTER_UP,
  wardDef: SHATTERED_WARD_UP,
  extraOps: [{ op: 'shove', dir: 'away', from: 'user', tiles: 1 }],
});

/** Base Common Mage signature (before skill-tree nodes are folded on top). */
export const MAGE_SIGNATURE: ClassSignature = {
  className: 'Mage',
  bonus: { pow: 1, ctl: 1 },
  worn: BASE_SPELLFLOW,
  actives: [BASE_NOVA],
};

/** Full 5-depth, 2-branch, 12-buyable Common Mage skill tree (`1, 2, 4, 4, 1`, 0 forks). */
export const MAGE_TREE: ClassTree = buildCommonTree({
  className: 'Mage',
  prefix: 'mag',
  root: {
    name: 'Arcane Focus',
    desc: 'Gain 1 Power and 1 Control.',
    gifts: [bonus({ pow: 1, ctl: 1 })],
  },
  // Branch A: Arcane Pierce (Arcane Nova & resist penetration)
  a2: {
    name: 'Piercing Bolt',
    desc: 'Gain 2 Power and 3% magic penetration.',
    gifts: [bonus({ pow: 2, resistPen: 3 })],
  },
  a3x: {
    name: 'Ward Breaker',
    desc: 'Gain 4% magic penetration and 4 flat magic penetration.',
    gifts: [bonus({ resistPen: 4, resistPenFlat: 4 })],
  },
  a3y: {
    name: 'Focused Surge',
    desc: 'Gain 2 Power and 3 Accuracy.',
    gifts: [bonus({ pow: 2, aim: 3 })],
  },
  a4x: {
    name: 'Arcane Starburst',
    desc: 'Upgrade Arcane Nova to Starburst with a 3-tile radius, higher arcane damage, 18 magic resist shred, and a 1-tile push.',
    gifts: [replaceActive(ID_NOVA, UP_NOVA)],
  },
  a4y: {
    name: 'Deep Penetration',
    desc: 'Gain 3 Power, 5% magic penetration, and 4 flat magic penetration.',
    gifts: [bonus({ pow: 3, resistPen: 5, resistPenFlat: 4 })],
  },
  // Branch B: Spellflow (cost cut, mana & haste)
  b2: {
    name: 'Steady Channel',
    desc: 'Gain 2 Control and 2 max mana.',
    gifts: [bonus({ ctl: 2, manaMax: 2 })],
  },
  b3x: {
    name: 'Mana Conservation',
    desc: 'Gain 3% ability cost cut and 2 max mana.',
    gifts: [bonus({ costCut: 3, manaMax: 2 })],
  },
  b3y: {
    name: 'Fluid Casting',
    desc: 'Gain 2 Control and 6 ability haste.',
    gifts: [bonus({ ctl: 2, haste: 6 })],
  },
  b4x: {
    name: 'Ley Efficiency',
    desc: 'Gain 4% ability cost cut and 3 max mana.',
    gifts: [bonus({ costCut: 4, manaMax: 3 })],
  },
  b4y: {
    name: 'Cadence Mastery',
    desc: 'Gain 3 Control, 8 ability haste, and 3 Accuracy.',
    gifts: [bonus({ ctl: 3, haste: 8, aim: 3 })],
  },
  cap: {
    name: 'Master of Spellflow',
    desc: 'Upgrade Spellflow to Master of Spellflow and gain 2 Power and 2 Control.',
    gifts: [
      replaceWorn(KEY_SPELLFLOW, MASTER_SPELLFLOW),
      bonus({ pow: 2, ctl: 2 }),
    ],
  },
});
