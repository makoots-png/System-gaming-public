// class-bladefiend.ts: Mythic Bladefiend (str+agi) signature kit and full 38-node / 32-buyable skill tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { Op, StackDef, StatusDef, StatusKey, Tiers } from '../combat/effect-ops.ts';
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
  if (!id) throw new Error(`Invalid Bladefiend node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Bladefiend formula "${text}"`);
  return p.formula;
};
const tiered = (e: string, d: string, c: string, b: string, a: string, s: string): Tiers<Formula> =>
  [f(e), f(d), f(c), f(b), f(a), f(s)];
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };

const KEY_FLOW = statusKey('bf-blade-flow');
const KEY_FLOW_SAINT = statusKey('bf-blade-flow-saint');
const KEY_PARRY_EDGE = statusKey('bf-parry-edge');
const KEY_PARRY_EDGE_UP = statusKey('bf-parry-edge-ii');
const KEY_TEMPEST = statusKey('bf-tempest');
const KEY_TEMPEST_UP = statusKey('bf-tempest-ii');
const KEY_WIND_EXPOSED = statusKey('bf-wind-exposed');
const KEY_WIND_EXPOSED_UP = statusKey('bf-wind-exposed-ii');
const KEY_GALE_SLOW = statusKey('bf-gale-slow');
const KEY_CUTS_BLEED = statusKey('bf-cuts-bleed');
const KEY_CUTS_BLEED_UP = statusKey('bf-cuts-bleed-ii');

const ID_SLASH = abilityId('bf-keen-slash');
const ID_PARRY = abilityId('bf-deflecting-edge');
const ID_GALE = abilityId('bf-rending-gale');
const ID_CUTS = abilityId('bf-hundred-cuts');

// ── statuses ──

const WIND_EXPOSED: StatusDef = {
  label: 'Split Guard',
  desc: 'Attacks against this target crit on 1 more die face.',
  ops: [{ op: 'sheet', key: 'exposed', amount: 1 }],
};

const WIND_EXPOSED_UP: StatusDef = {
  label: 'Shattered Guard',
  desc: 'Attacks against this target crit on 2 more die faces and deal 6% more damage.',
  ops: [
    { op: 'sheet', key: 'exposed', amount: 2 },
    { op: 'share', on: 'taken', pct: 6 },
  ],
};

const GALE_SLOW: StatusDef = {
  label: 'Gale Drag',
  desc: 'Speed reduced by 20% for 1 round.',
  ops: [{ op: 'speed', pct: -20 }],
};

const CUTS_BLEED: StatusDef = {
  label: 'Severed',
  desc: 'Takes physical bleed damage each round for 2 rounds.',
  ops: [{ op: 'damage', type: 'physical', when: 'turn', amount: tiered('1d4', '1d6', '2d4', '2d6', '3d6', '3d10') }],
};

const CUTS_BLEED_UP: StatusDef = {
  label: 'Deep Sever',
  desc: 'Takes physical bleed damage each round and 8% more damage for 2 rounds.',
  ops: [
    { op: 'damage', type: 'physical', when: 'turn', amount: tiered('1d6', '1d8', '2d6', '3d6', '4d6', '5d8') },
    { op: 'share', on: 'taken', pct: 8 },
  ],
};

function makeBladeFlow(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly counterFormula: string;
  readonly refundPct: number;
  readonly tempestKey: StatusKey;
  readonly tempestSpeedPct: number;
  readonly tempestDealtPct: number;
  readonly extraOps?: readonly Op[];
}): ClassWorn {
  // Tempest Flow drops all stacks whenever Bladefiend is struck, tying flow directly to parry/avoidance mastery.
  const tempest: StackDef = {
    label: 'Tempest Flow',
    desc: `Each stack adds ${o.tempestSpeedPct}% speed and ${o.tempestDealtPct}% damage dealt (up to 5 stacks). Lost when struck.`,
    ops: [
      { op: 'speed', pct: o.tempestSpeedPct },
      { op: 'share', on: 'dealt', pct: o.tempestDealtPct },
    ],
    stack: { cap: 5, leave: { kind: 'event', event: 'struck' }, keep: 'fight', threshold: null },
  };
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [...(o.extraOps ?? [])],
      triggers: [
        // 1. Parrying or dodging any foe attack or mythic omen fires a counter-slash.
        { on: 'avoided', tag: null, to: 'other', limit: EACH, ops: [{ op: 'damage', type: 'physical', when: 'use', amount: f(o.counterFormula) }] },
        // 2. Parrying or dodging refunds turn time (once per round). The bigger Parry Edge payoff requires Deflecting Edge.
        { on: 'avoided', tag: null, to: 'self', limit: ROUND, ops: [{ op: 'refund', pct: o.refundPct }] },
        // 3. Crits build Tempest Flow speed and damage dealt, lost if struck.
        { on: 'critDealt', tag: null, to: 'self', limit: ROUND, ops: [{ op: 'applyStatus', key: o.tempestKey, def: tempest, duration: null }] },
      ],
    },
  };
}

const BASE_FLOW: ClassWorn = makeBladeFlow({
  key: KEY_FLOW,
  label: 'Blade Flow',
  desc: 'Counter-slashes and refunds turn time when you parry or avoid a foe, and builds Tempest Flow on crits (lost when struck).',
  counterFormula: '1d6 + 0.35 * phys',
  refundPct: 15,
  tempestKey: KEY_TEMPEST,
  tempestSpeedPct: 3,
  tempestDealtPct: 2,
});

const SAINT_FLOW: ClassWorn = makeBladeFlow({
  key: KEY_FLOW_SAINT,
  label: 'Blade Flow: Sword Saint',
  desc: 'Increases counter-slash damage, turn refund, and Tempest Flow bonuses on crits (lost when struck), and adds 4% damage dealt.',
  counterFormula: '1d8 + 0.55 * phys',
  refundPct: 20,
  tempestKey: KEY_TEMPEST_UP,
  tempestSpeedPct: 4,
  tempestDealtPct: 3,
  extraOps: [
    { op: 'share', on: 'dealt', pct: 4 },
  ],
});

// ── active ability builders ──
// Pure martial: 0 mana, fatigue-driven. One signature omen answer: Deflecting Edge (before-reaction negate, self-only).

function makeKeenSlash(o: {
  readonly name: string;
  readonly formula: string;
  readonly exposedKey: StatusKey;
  readonly exposedDef: StatusDef;
}): Ability {
  const base = abilityOf('strike', {
    id: ID_SLASH,
    name: o.name,
    range: tiles(2),
    shape: { kind: 'touch', reach: tiles(2) },
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [{ op: 'applyStatus', key: o.exposedKey, def: o.exposedDef, duration: rounds(1) }],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 5, time: cost(R.fight.cost.quick), cooldown: rounds(0) },
  };
}

function makeDeflectingEdge(o: {
  readonly name: string;
  readonly edgeKey: StatusKey;
  readonly edgeDealtPct: number;
  readonly edgeSpeedPct: number;
  readonly cooldownRounds: number;
}): Ability {
  const parryEdge: StatusDef = {
    label: 'Parry Edge',
    desc: `Advantage on your next attack roll, ${o.edgeDealtPct}% more damage dealt, and ${o.edgeSpeedPct}% speed for 1 round.`,
    ops: [
      { op: 'edge', side: 'attack', keep: 'better', tag: null, spend: true },
      { op: 'share', on: 'dealt', pct: o.edgeDealtPct },
      { op: 'speed', pct: o.edgeSpeedPct },
    ],
  };
  const base = abilityOf('strike', {
    id: ID_PARRY,
    name: o.name,
    aim: 'self',
    shape: { kind: 'self' },
    range: tiles(0),
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: null,
    // Parry-only payoff: negates the incoming strike or omen on Bladefiend (never erasing it for party allies)
    // and grants Parry Edge without giving passive dodges the same reward.
    ops: [
      { op: 'negate' },
      { op: 'applyStatus', key: o.edgeKey, def: parryEdge, duration: rounds(1) },
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 5, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds) },
    react: { when: 'before', reach: tiles(0) },
  };
}

function makeRendingGale(o: {
  readonly name: string;
  readonly formula: string;
  readonly staggerShare: number;
  readonly cooldownRounds: number;
}): Ability {
  const base = abilityOf('strike', {
    id: ID_GALE,
    name: o.name,
    range: tiles(3),
    shape: { kind: 'touch', reach: tiles(3) },
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'stagger', share: o.staggerShare },
      { op: 'applyStatus', key: KEY_GALE_SLOW, def: GALE_SLOW, duration: rounds(1) },
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeHundredCuts(o: {
  readonly name: string;
  readonly formula: string;
  readonly bleedKey: StatusKey;
  readonly bleedDef: StatusDef;
  readonly cooldownRounds: number;
}): Ability {
  const base = abilityOf('strike', {
    id: ID_CUTS,
    name: o.name,
    range: tiles(4),
    shape: { kind: 'touch', reach: tiles(4) },
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'applyStatus', key: o.bleedKey, def: o.bleedDef, duration: rounds(2) },
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 8, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

const BASE_SLASH = makeKeenSlash({
  name: 'Keen Slash',
  formula: '1d8 + 0.42 * phys',
  exposedKey: KEY_WIND_EXPOSED,
  exposedDef: WIND_EXPOSED,
});

const UP_SLASH = makeKeenSlash({
  name: 'Keen Slash: Razor Wind',
  formula: '1d8 + 0.5 * phys',
  exposedKey: KEY_WIND_EXPOSED_UP,
  exposedDef: WIND_EXPOSED_UP,
});

const BASE_PARRY = makeDeflectingEdge({
  name: 'Deflecting Edge',
  edgeKey: KEY_PARRY_EDGE,
  edgeDealtPct: 14,
  edgeSpeedPct: 10,
  cooldownRounds: 5,
});

const UP_PARRY = makeDeflectingEdge({
  name: 'Deflecting Edge: Mirror Riposte',
  edgeKey: KEY_PARRY_EDGE_UP,
  edgeDealtPct: 18,
  edgeSpeedPct: 14,
  cooldownRounds: 4,
});

const BASE_GALE = makeRendingGale({
  name: 'Rending Gale',
  formula: '2d6 + 0.65 * phys',
  staggerShare: 0.16,
  cooldownRounds: 4,
});

const UP_GALE = makeRendingGale({
  name: 'Rending Gale: Cyclone Break',
  formula: '2d8 + 0.75 * phys',
  staggerShare: 0.24,
  cooldownRounds: 3,
});

const BASE_CUTS = makeHundredCuts({
  name: 'Hundred Cuts',
  formula: '2d8 + 0.8 * phys',
  bleedKey: KEY_CUTS_BLEED,
  bleedDef: CUTS_BLEED,
  cooldownRounds: 5,
});

const UP_CUTS = makeHundredCuts({
  name: 'Hundred Cuts: Severing Arc',
  formula: '3d6 + 0.92 * phys',
  bleedKey: KEY_CUTS_BLEED_UP,
  bleedDef: CUTS_BLEED_UP,
  cooldownRounds: 4,
});

/** Base Bladefiend signature (before skill-tree nodes are folded on top). */
export const BLADEFIEND_SIGNATURE: ClassSignature = {
  className: 'Bladefiend',
  bonus: { speed: 6, critFaces: 1, react: 3 },
  worn: BASE_FLOW,
  actives: [BASE_SLASH, BASE_PARRY, BASE_GALE, BASE_CUTS],
};

// ── 38-node / 32-buyable Mythic skill tree ──
// Zero drain, zero shieldDrain: survival comes from Deflecting Edge parries, high Reaction, speed, and armor/tenacity.

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

/** Full 9-depth, 3-branch, 32-buyable (38-node) Mythic Bladefiend skill tree. */
export const BLADEFIEND_TREE: ClassTree = {
  className: 'Bladefiend',
  rarity: 'mythic',
  nodes: [
    // Depth 1: Root (1)
    node('bf-root', 1, 'First Cut', 'Gain 2 Strength, 2 Agility, and 3 speed.', [], [
      bonus({ str: 2, agi: 2, speed: 3 }),
    ]),

    // Depth 2: Three branches (3)
    node('bf-a2', 2, 'Parrying Edge', 'Gain 2 Reaction and 2 Agility.', ['bf-root'], [
      bonus({ react: 2, agi: 2 }),
    ]),
    node('bf-b2', 2, 'Unbound Gale', 'Gain 3 Agility and 3 ability haste.', ['bf-root'], [
      bonus({ agi: 3, haste: 3 }),
    ]),
    node('bf-c2', 2, 'Severing Edge', 'Gain 3 Strength and 3% armor penetration.', ['bf-root'], [
      bonus({ str: 3, armorPen: 3 }),
    ]),

    // Depth 3: Branch splits (6)
    node('bf-a3x', 3, 'Riposte Stance', 'Gain 2 Reaction and 3 Strength.', ['bf-a2'], [
      bonus({ react: 2, str: 3 }),
    ]),
    node('bf-a3y', 3, 'Iron Guard', 'Gain 2 Vitality and 15 max HP.', ['bf-a2'], [
      bonus({ vit: 2, hpMax: 15 }),
    ]),
    node('bf-b3x', 3, 'Windstep', 'Gain 4 speed and 3 ability haste.', ['bf-b2'], [
      bonus({ speed: 4, haste: 3 }),
    ]),
    node('bf-b3y', 3, 'Calm Stance', 'Gain 5 tenacity, 4 Will, and 10 max HP.', ['bf-b2'], [
      bonus({ tenacity: 5, will: 4, hpMax: 10 }),
    ]),
    node('bf-c3x', 3, 'Armor Cleave', 'Gain 3% armor penetration and 3 flat armor penetration.', ['bf-c2'], [
      bonus({ armorPen: 3, armorPenFlat: 3 }),
    ]),
    node('bf-c3y', 3, 'Keen Eye', 'Gain 3 Strength and 1 extra crit face.', ['bf-c2'], [
      bonus({ str: 3, critFaces: 1 }),
    ]),

    // Depth 4: Deepening (6)
    node('bf-a4x', 4, 'Fleet Counter', 'Gain 2 Reaction and 4 speed.', ['bf-a3x'], [
      bonus({ react: 2, speed: 4 }),
    ]),
    node('bf-a4y', 4, 'Steel Poise', 'Gain 3 Vitality and 20 max HP.', ['bf-a3y'], [
      bonus({ vit: 3, hpMax: 20 }),
    ]),
    node('bf-b4x', 4, 'Flash Step', 'Gain 4 speed and 4 ability haste.', ['bf-b3x'], [
      bonus({ speed: 4, haste: 4 }),
    ]),
    node('bf-b4y', 4, 'Unshaken Mind', 'Gain 6 tenacity and 5 Will.', ['bf-b3y'], [
      bonus({ tenacity: 6, will: 5 }),
    ]),
    node('bf-c4x', 4, 'Sundered Plate', 'Gain 3% armor penetration and 4 flat armor penetration.', ['bf-c3x'], [
      bonus({ armorPen: 3, armorPenFlat: 4 }),
    ]),
    node('bf-c4y', 4, 'Fatal Arc', 'Gain 3 Strength and 0.08 crit multiplier.', ['bf-c3y'], [
      bonus({ str: 3, critSize: 8 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('bf-a5-l', 5, 'Mirror Riposte', 'Upgrade Deflecting Edge to a 4-round cooldown with 18% damage dealt and 14% speed on Parry Edge.', ['bf-a4x', 'bf-a4y'], [
      replaceActive(ID_PARRY, UP_PARRY),
    ], { forkGroup: 'bf-a5' }),
    node('bf-a5-r', 5, 'Untouched Duelist', 'Gain 4 Reaction, 4 Vitality, and 25 max HP.', ['bf-a4x', 'bf-a4y'], [
      bonus({ react: 4, vit: 4, hpMax: 25 }),
    ], { forkGroup: 'bf-a5' }),

    node('bf-b5-l', 5, 'Razor Wind', 'Upgrade Keen Slash with stronger damage and Shattered Guard (+2 exposed, +6% damage taken).', ['bf-b4x', 'bf-b4y'], [
      replaceActive(ID_SLASH, UP_SLASH),
    ], { forkGroup: 'bf-b5' }),
    node('bf-b5-r', 5, 'Cyclone Break', 'Upgrade Rending Gale to a 3-round cooldown with 24% stagger and stronger damage.', ['bf-b4x', 'bf-b4y'], [
      replaceActive(ID_GALE, UP_GALE),
    ], { forkGroup: 'bf-b5' }),

    node('bf-c5-l', 5, 'Severing Arc', 'Upgrade Hundred Cuts to a 4-round cooldown with higher damage and Deep Sever.', ['bf-c4x', 'bf-c4y'], [
      replaceActive(ID_CUTS, UP_CUTS),
    ], { forkGroup: 'bf-c5' }),
    node('bf-c5-r', 5, 'Edge Mastery', 'Gain 6 Strength, 1 extra crit face, and 0.1 crit multiplier.', ['bf-c4x', 'bf-c4y'], [
      bonus({ str: 6, critFaces: 1, critSize: 10 }),
    ], { forkGroup: 'bf-c5' }),

    // Depth 6: Post-fork convergence (6)
    node('bf-a6x', 6, 'Duelist Reflex', 'Gain 2 Reaction and 3 Strength.', ['bf-a5-l', 'bf-a5-r'], [
      bonus({ react: 2, str: 3 }),
    ], { parentMode: 'any' }),
    node('bf-a6y', 6, 'Tempered Frame', 'Gain 20 max HP and 3 Vitality.', ['bf-a5-l', 'bf-a5-r'], [
      bonus({ hpMax: 20, vit: 3 }),
    ], { parentMode: 'any' }),
    node('bf-b6x', 6, 'Gale Tempo', 'Gain 4 speed and 4 ability haste.', ['bf-b5-l', 'bf-b5-r'], [
      bonus({ speed: 4, haste: 4 }),
    ], { parentMode: 'any' }),
    node('bf-b6y', 6, 'Still Blade', 'Gain 15 max HP, 6 tenacity, and 5 Will.', ['bf-b5-l', 'bf-b5-r'], [
      bonus({ hpMax: 15, tenacity: 6, will: 5 }),
    ], { parentMode: 'any' }),
    node('bf-c6x', 6, 'Piercing Draw', 'Gain 3% armor penetration and 4 flat armor penetration.', ['bf-c5-l', 'bf-c5-r'], [
      bonus({ armorPen: 3, armorPenFlat: 4 }),
    ], { parentMode: 'any' }),
    node('bf-c6y', 6, 'Lethal Tempo', 'Gain 3 Strength, 1 extra crit face, and 0.08 crit multiplier.', ['bf-c5-l', 'bf-c5-r'], [
      bonus({ str: 3, critFaces: 1, critSize: 8 }),
    ], { parentMode: 'any' }),

    // Depth 7: Second Exclusive Fork Pairs (6 nodes, 3 buyable; at most 2 scalers across any path: steady + execute)
    node('bf-a7-l', 7, 'Unscathed Form', 'Gain 2 Reaction and deal up to 12% more damage while above half HP.', ['bf-a6x', 'bf-a6y'], [
      bonus({ react: 2 }),
      scaler({ measure: 'user', dir: 'over', start: 0.5, scale: 0.12 }),
    ], { forkGroup: 'bf-a7' }),
    node('bf-a7-r', 7, 'Aegis of Steel', 'Gain 6 Vitality, 30 max HP, and 6 tenacity.', ['bf-a6x', 'bf-a6y'], [
      bonus({ vit: 6, hpMax: 30, tenacity: 6 }),
    ], { forkGroup: 'bf-a7' }),

    node('bf-b7-l', 7, 'Phantom Footwork', 'Gain 5 speed, 4 ability haste, and 2 Reaction.', ['bf-b6x', 'bf-b6y'], [
      bonus({ speed: 5, haste: 4, react: 2 }),
    ], { forkGroup: 'bf-b7' }),
    node('bf-b7-r', 7, 'Iron Will', 'Gain 8 tenacity, 6 Will, and 25 max HP.', ['bf-b6x', 'bf-b6y'], [
      bonus({ tenacity: 8, will: 6, hpMax: 25 }),
    ], { forkGroup: 'bf-b7' }),

    node('bf-c7-l', 7, 'Finishing Stroke', 'Gain 4 Strength and deal up to 12% more damage to foes below half HP.', ['bf-c6x', 'bf-c6y'], [
      bonus({ str: 4 }),
      scaler({ measure: 'target', dir: 'under', start: 0.5, scale: 0.12 }),
    ], { forkGroup: 'bf-c7' }),
    node('bf-c7-r', 7, 'Execution Arc', 'Gain 5% armor penetration, 6 flat armor penetration, and 0.1 crit multiplier.', ['bf-c6x', 'bf-c6y'], [
      bonus({ armorPen: 5, armorPenFlat: 6, critSize: 10 }),
    ], { forkGroup: 'bf-c7' }),

    // Depth 8: Branch Capstones (3)
    node('bf-a8', 8, 'Untouched Edge', 'Gain 2 Reaction, 4 Strength, and 20 max HP.', ['bf-a7-l', 'bf-a7-r'], [
      bonus({ react: 2, str: 4, hpMax: 20 }),
    ], { parentMode: 'any' }),
    node('bf-b8', 8, 'Storm Stride', 'Gain 4 Agility, 5 speed, 4 ability haste, and 5 Will.', ['bf-b7-l', 'bf-b7-r'], [
      bonus({ agi: 4, speed: 5, haste: 4, will: 5 }),
    ], { parentMode: 'any' }),
    node('bf-c8', 8, 'Perfect Form', 'Gain 4 Strength, 5 flat armor penetration, and 0.08 crit multiplier.', ['bf-c7-l', 'bf-c7-r'], [
      bonus({ str: 4, armorPenFlat: 5, critSize: 8 }),
    ], { parentMode: 'any' }),

    // Depth 9: Monarch Capstone (1)
    node('bf-cap', 9, 'Sword Saint', 'Upgrade Blade Flow to Sword Saint and gain 4 Strength, 4 Agility, and 0.08 crit multiplier.', ['bf-a8', 'bf-b8', 'bf-c8'], [
      replaceWorn(KEY_FLOW, SAINT_FLOW),
      bonus({ str: 4, agi: 4, critSize: 8 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
