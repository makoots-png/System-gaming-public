// class-duelist.ts: Rare Duelist (Assassin branch, str+agi) signature kit and full 18-node / 16-buyable tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
//
// Mobile blade fencer pairing movement-triggered Poised stance with 2-tile Lunge Thrust and Counterguard guard reactions.
// Root budget at rank C (`RULES.rarities.rare.rank = 'C'`, level 20, settled.md ~12-point Rare unspecialized root):
// - Sheet bonus `{ agi: 1, str: 1 }` spends 2.00 pts.
// - Worn `Measured Step` grants 1 round of `Poised` (attack advantage and 10% speed) once a round after moving.
// - Actives (`Lunge Thrust`, `Counterguard`) stay inside worth.ts C-rank budgets; `Counterguard` uses `reach: 0`
//   because `before` reactions land on the body they protect.
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
  if (!id) throw new Error(`Invalid Duelist node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Duelist formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const ROUND: Limit = { kind: 'round' };

const KEY_STEP = statusKey('duel-step');
const KEY_GRAND = statusKey('duel-grand-fencer');
const KEY_POISED = statusKey('duel-poised');
const KEY_POISED_UP = statusKey('duel-poised-ii');
const KEY_OFF_BALANCE = statusKey('duel-off-balance');
const KEY_REPRISAL = statusKey('duel-reprisal');

const ID_LUNGE = abilityId('duel-lunge-thrust');
const ID_GUARD = abilityId('duel-counterguard');

// ── statuses ──

const POISED: StatusDef = {
  label: 'Poised',
  desc: 'Advantage on your next attack roll and 10% more speed until that attack or for 1 round.',
  ops: [
    { op: 'edge', side: 'attack', keep: 'better', tag: null, spend: true },
    { op: 'speed', pct: 10 },
  ],
};

const POISED_UP: StatusDef = {
  label: 'Poised Mastery',
  desc: 'Advantage on your next attack roll, defense advantage, and 15% more speed until you attack or for 1 round.',
  ops: [
    { op: 'edge', side: 'attack', keep: 'better', tag: null, spend: true },
    { op: 'speed', pct: 15 },
    { op: 'edge', side: 'defend', keep: 'better', tag: null, spend: false },
  ],
};

const OFF_BALANCE: StatusDef = {
  label: 'Off-Balance',
  desc: 'Speed reduced by 12% and attacks against this target crit on 1 more die face for 2 rounds.',
  ops: [
    { op: 'speed', pct: -12 },
    { op: 'sheet', key: 'exposed', amount: 1 },
  ],
};

const REPRISAL_STANCE: StatusDef = {
  label: 'Reprisal Stance',
  desc: 'Once a round when struck for 1 round, strike the attacker back for physical damage equal to 45% of your finesse power.',
  ops: [],
  triggers: [
    {
      on: 'struck',
      tag: null,
      to: 'other',
      limit: ROUND,
      ops: [{ op: 'damage', type: 'physical', when: 'use', amount: f('0.45 * finesse') }],
    },
  ],
};

function makeMeasuredStep(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly poisedKey: StatusKey;
  readonly poisedDef: StatusDef;
  readonly extraOps?: readonly Op[];
}): ClassWorn {
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [...(o.extraOps ?? [])],
      triggers: [
        {
          on: 'moved',
          to: 'self',
          limit: ROUND,
          ops: [{ op: 'applyStatus', key: o.poisedKey, def: o.poisedDef, duration: rounds(1) }],
        },
      ],
    },
  };
}

const BASE_STEP: ClassWorn = makeMeasuredStep({
  key: KEY_STEP,
  label: 'Measured Step',
  desc: 'Once a round after you walk or dash, gain Poised (attack advantage and 10% speed) for 1 round.',
  poisedKey: KEY_POISED,
  poisedDef: POISED,
});

const GRAND_FENCER: ClassWorn = makeMeasuredStep({
  key: KEY_GRAND,
  label: 'Grand Fencer',
  desc: 'Deal 10% more damage. Once a round after you walk or dash, gain Poised Mastery (attack advantage, defense advantage, and 15% speed) for 1 round.',
  poisedKey: KEY_POISED_UP,
  poisedDef: POISED_UP,
  extraOps: [{ op: 'share', on: 'dealt', pct: 10 }],
});

// ── active ability builders ──

function makeLungeThrust(o: {
  readonly name: string;
  readonly formula: string;
  readonly pace?: 'quick' | 'standard';
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('strike', {
    id: ID_LUNGE,
    name: o.name,
    aim: 'foe',
    range: tiles(2),
    shape: { kind: 'touch', reach: tiles(2) },
    delivery: { kind: 'travel', windup: tick(R.fight.abilityKinds.strike.windup), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'applyStatus', key: KEY_OFF_BALANCE, def: OFF_BALANCE, duration: rounds(2) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 6, time: cost(R.fight.cost[o.pace ?? 'standard']), cooldown: rounds(1) },
  };
}

function makeCounterguard(o: {
  readonly name: string;
  readonly guardShare: number;
  readonly shieldFormula: string;
  readonly cooldownRounds: number;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('support', {
    id: ID_GUARD,
    name: o.name,
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'shield', by: 'hand', formula: f(o.shieldFormula) },
    ops: [
      { op: 'guard', share: o.guardShare },
      { op: 'applyStatus', key: KEY_POISED, def: POISED, duration: rounds(1) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 5, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds) },
    react: { when: 'before', reach: tiles(0) },
  };
}

const BASE_LUNGE = makeLungeThrust({
  name: 'Lunge Thrust',
  formula: '1d8 + 0.8 * finesse',
});

// Uses quick pace for faster turn recovery alongside the 1-tile shove without adding a self-rider on a foe-aimed strike.
const UP_LUNGE_FEINT = makeLungeThrust({
  name: 'Lunge Thrust: Feint Lunge',
  formula: '1d8 + 0.65 * finesse',
  pace: 'quick',
  extraOps: [{ op: 'shove', dir: 'away', from: 'user', tiles: 1 }],
});

const UP_LUNGE_HEART = makeLungeThrust({
  name: 'Lunge Thrust: Heartseeker Thrust',
  formula: '1d10 + 0.85 * finesse',
});

const BASE_GUARD = makeCounterguard({
  name: 'Counterguard',
  guardShare: 0.3,
  shieldFormula: '0.1 * hpmax',
  cooldownRounds: 2,
});

const UP_GUARD_REPRISAL = makeCounterguard({
  name: 'Counterguard: Reprisal Guard',
  guardShare: 0.3,
  shieldFormula: '0.1 * hpmax',
  cooldownRounds: 2,
  extraOps: [{ op: 'applyStatus', key: KEY_REPRISAL, def: REPRISAL_STANCE, duration: rounds(1) }],
});

const UP_GUARD_TEMPO = makeCounterguard({
  name: 'Counterguard: Fencing Tempo',
  guardShare: 0.35,
  shieldFormula: '0.12 * hpmax',
  cooldownRounds: 1,
});

/** Base Duelist signature (before skill-tree nodes are folded on top). */
export const DUELIST_SIGNATURE: ClassSignature = {
  className: 'Duelist',
  bonus: { agi: 1, str: 1 },
  worn: BASE_STEP,
  actives: [BASE_LUNGE, BASE_GUARD],
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

/** Full 7-depth, 2-branch, 16-buyable (18-node) Rare Duelist skill tree (Footwork / Guard). */
export const DUELIST_TREE: ClassTree = {
  className: 'Duelist',
  rarity: 'rare',
  nodes: [
    // Depth 1: Root (1)
    node('duel-root', 1, 'Ring Footwork', 'Gain 2 Agility and 1 Strength.', [], [
      bonus({ agi: 2, str: 1 }),
    ]),

    // Depth 2: Two branches (2)
    node('duel-a2', 2, 'Fleche Step', 'Gain 2 Agility and 4 speed.', ['duel-root'], [
      bonus({ agi: 2, speed: 4 }),
    ]),
    node('duel-b2', 2, 'Balanced Hilt', 'Gain 2 Strength and 4 Reaction.', ['duel-root'], [
      bonus({ str: 2, react: 4 }),
    ]),

    // Depth 3: Branch splits (4)
    node('duel-a3x', 3, 'Needle Point', 'Gain 2 Agility and 4% armor penetration.', ['duel-a2'], [
      bonus({ agi: 2, armorPen: 4 }),
    ]),
    node('duel-a3y', 3, 'Light Footing', 'Gain 5 speed and 1 move tile.', ['duel-a2'], [
      bonus({ speed: 5, move: 1 }),
    ]),
    node('duel-b3x', 3, 'Deflecting Wrist', 'Gain 2 Strength and 4 flat armor penetration.', ['duel-b2'], [
      bonus({ str: 2, armorPenFlat: 4 }),
    ]),
    node('duel-b3y', 3, 'Fencing Rhythm', 'Gain 6 ability haste and 12 max HP.', ['duel-b2'], [
      bonus({ haste: 6, hpMax: 12 }),
    ]),

    // Depth 4: Deepening (4)
    node('duel-a4x', 4, 'Keen Bladework', 'Gain 3 Agility, 0.08 crit multiplier, and 4% armor penetration.', ['duel-a3x'], [
      bonus({ agi: 3, critSize: 8, armorPen: 4 }),
    ]),
    node('duel-a4y', 4, 'Quick Engagement', 'Gain 6 speed and 4 opening.', ['duel-a3y'], [
      bonus({ speed: 6, opening: 4 }),
    ]),
    node('duel-b4x', 4, 'Steel Stance', 'Gain 3 Strength, 5 Reaction, and 4 flat armor penetration.', ['duel-b3x'], [
      bonus({ str: 3, react: 5, armorPenFlat: 4 }),
    ]),
    node('duel-b4y', 4, 'Duelist Poise', 'Gain 8 ability haste and 15 max HP.', ['duel-b3y'], [
      bonus({ haste: 8, hpMax: 15 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (4 nodes, 2 buyable)
    node('duel-a5-l', 5, 'Feint Lunge', 'Change Lunge Thrust to a quick strike with lower finesse scaling that pushes foes 1 tile away.', ['duel-a4x', 'duel-a4y'], [
      replaceActive(ID_LUNGE, UP_LUNGE_FEINT),
    ], { forkGroup: 'duel-a5' }),
    node('duel-a5-r', 5, 'Heartseeker Thrust', 'Upgrade Lunge Thrust with higher physical damage and deal up to 18% more damage against foes with more current HP than you.', ['duel-a4x', 'duel-a4y'], [
      replaceActive(ID_LUNGE, UP_LUNGE_HEART),
      scaler({ measure: 'hpPair', dir: 'over', start: 0.5, scale: 0.18 }),
    ], { forkGroup: 'duel-a5' }),

    node('duel-b5-l', 5, 'Reprisal Guard', 'Upgrade Counterguard to grant 1 round of Reprisal Stance, striking attackers back once a round for 45% of your finesse power.', ['duel-b4x', 'duel-b4y'], [
      replaceActive(ID_GUARD, UP_GUARD_REPRISAL),
    ], { forkGroup: 'duel-b5' }),
    node('duel-b5-r', 5, 'Fencing Tempo', 'Upgrade Counterguard to a 1-round cooldown with 35% strike guard and a 12% max HP shield.', ['duel-b4x', 'duel-b4y'], [
      replaceActive(ID_GUARD, UP_GUARD_TEMPO),
    ], { forkGroup: 'duel-b5' }),

    // Depth 6: Branch Capstones (2)
    node('duel-a6', 6, 'Blade Momentum', 'Gain 4 Agility, 6 speed, and 1 extra crit face.', ['duel-a5-l', 'duel-a5-r'], [
      bonus({ agi: 4, speed: 6, critFaces: 1 }),
    ], { parentMode: 'any' }),
    node('duel-b6', 6, 'Ring Arbiter', 'Gain 4 Strength, 6 ability haste, and 5 Reaction.', ['duel-b5-l', 'duel-b5-r'], [
      bonus({ str: 4, haste: 6, react: 5 }),
    ], { parentMode: 'any' }),

    // Depth 7: Rare Capstone (1)
    node('duel-cap', 7, 'Grand Fencer', 'Upgrade Measured Step to Grand Fencer, upgrade Poised to Poised Mastery, and gain 4 Agility, 4 Strength, and 6 speed.', ['duel-a6', 'duel-b6'], [
      replaceWorn(KEY_STEP, GRAND_FENCER),
      upgradeStatus(KEY_POISED, KEY_POISED_UP, POISED_UP),
      bonus({ agi: 4, str: 4, speed: 6 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
