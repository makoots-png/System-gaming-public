// class-packlord.ts: Epic Packlord (pre+ctl) signature kit and full 26-node / 23-buyable skill tree.
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
import type { Op, StatusDef, StatusKey, Tiers, UseOp } from '../combat/effect-ops.ts';
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
  if (!id) throw new Error(`Invalid Packlord node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Packlord formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };

const KEY_PACK_BOND = statusKey('pack-bond');
const KEY_PACK_BOND_APEX = statusKey('pack-bond-apex');
const KEY_VENGEANCE = statusKey('pack-vengeance');
const KEY_VENGEANCE_APEX = statusKey('pack-vengeance-apex');
const KEY_PACK_FANG = statusKey('pack-fang');
const KEY_PACK_FANG_UP = statusKey('pack-fang-ii');
const KEY_FANG_EXPOSED = statusKey('pack-exposed');
const KEY_PREY_MARKED = statusKey('pack-prey-marked');
const KEY_PREY_MARKED_UP = statusKey('pack-prey-marked-ii');
const KEY_ALPHA_HOWL = statusKey('pack-alpha-howl');
const KEY_ALPHA_HOWL_UP = statusKey('pack-alpha-howl-ii');

const ID_CALL = abilityId('pack-call');
const ID_MARK = abilityId('pack-mark-prey');
const ID_HOWL = abilityId('pack-alpha-howl');
const ID_RALLY = abilityId('pack-rally');

// ── statuses ──

const VENGEANCE_DEF: StatusDef = {
  label: 'Vengeance',
  desc: 'Deals 20% more damage, moves 20% faster, and gains a shield equal to 12% of max HP.',
  ops: [
    { op: 'share', on: 'dealt', pct: 20 },
    { op: 'speed', pct: 20 },
    { op: 'shield', amount: f('0.12 * hpmax') },
  ],
};

const VENGEANCE_APEX_DEF: StatusDef = {
  label: 'Apex Vengeance',
  desc: 'Deals 30% more damage, moves 20% faster, and gains a shield equal to 18% of max HP.',
  ops: [
    { op: 'share', on: 'dealt', pct: 30 },
    { op: 'speed', pct: 20 },
    { op: 'shield', amount: f('0.18 * hpmax') },
  ],
};

const FANG_EXPOSED_DEF: StatusDef = {
  label: 'Pack Bite',
  desc: 'Attacks against this target crit on 1 more die face.',
  ops: [{ op: 'sheet', key: 'exposed', amount: 1 }],
};

function makePackFang(o: {
  readonly label: string;
  readonly desc: string;
  readonly speedPct: number;
  readonly biteFormula: string;
}): StatusDef {
  return {
    label: o.label,
    desc: o.desc,
    ops: [{ op: 'speed', pct: o.speedPct }],
    triggers: [
      {
        on: 'hitDealt',
        tag: KIND_TAG.strike,
        to: 'other',
        limit: EACH,
        ops: [
          { op: 'damage', type: 'physical', when: 'use', amount: f(o.biteFormula) },
          { op: 'applyStatus', key: KEY_FANG_EXPOSED, def: FANG_EXPOSED_DEF, duration: rounds(1) },
        ],
      },
    ],
  };
}

const PACK_FANG_DEF: StatusDef = makePackFang({
  label: 'Pack Fang',
  desc: 'Moves 20% faster. Each strike deals 35% of physical power as bonus physical damage and adds 1 exposed crit face for 1 round.',
  speedPct: 20,
  biteFormula: '0.35 * phys',
});

const PACK_FANG_UP_DEF: StatusDef = makePackFang({
  label: 'Bloodfang',
  desc: 'Moves 25% faster. Each strike deals 50% of physical power as bonus physical damage and adds 1 exposed crit face for 1 round.',
  speedPct: 25,
  biteFormula: '0.5 * phys',
});

const TEAR_BASE: Tiers<Formula> = [f('1d4'), f('1d6'), f('1d8'), f('2d6'), f('2d8'), f('3d6')];
const TEAR_UP: Tiers<Formula> = [f('1d6'), f('1d8'), f('2d6'), f('2d8'), f('3d6'), f('3d8')];

function makePreyMarked(o: {
  readonly label: string;
  readonly desc: string;
  readonly slowPct: number;
  readonly takenPct: number;
  readonly tear: Tiers<Formula>;
}): StatusDef {
  // `-speed` marks this status harmful so Commander (`pre+ctl`) fires on Mark Prey.
  // `tag: KIND_TAG.strike` stops depth-2 self-recursion because trigger hits carry no tags.
  return {
    label: o.label,
    desc: o.desc,
    ops: [
      { op: 'speed', pct: o.slowPct },
      { op: 'share', on: 'taken', pct: o.takenPct },
    ],
    triggers: [
      {
        on: 'struck',
        tag: KIND_TAG.strike,
        to: 'self',
        limit: EACH,
        ops: [{ op: 'damage', type: 'physical', when: 'use', amount: o.tear }],
      },
    ],
  };
}

const PREY_MARKED_DEF: StatusDef = makePreyMarked({
  label: 'Prey Marked',
  desc: 'Speed reduced by 10% and takes 10% more damage. Each strike hit tears for rank-scaled physical damage.',
  slowPct: -10,
  takenPct: 10,
  tear: TEAR_BASE,
});

const PREY_MARKED_UP_DEF: StatusDef = makePreyMarked({
  label: 'Apex Quarry',
  desc: 'Speed reduced by 15% and takes 15% more damage. Each strike hit tears for higher rank-scaled physical damage.',
  slowPct: -15,
  takenPct: 15,
  tear: TEAR_UP,
});

function makeAlphaHowlStatus(o: {
  readonly label: string;
  readonly desc: string;
  readonly radius: number;
  readonly dealtPct: number;
  readonly speedPct: number;
}): StatusDef {
  return {
    label: o.label,
    desc: o.desc,
    ops: [
      { op: 'aura', radius: o.radius, on: 'allies' },
      { op: 'share', on: 'dealt', pct: o.dealtPct },
      { op: 'speed', pct: o.speedPct },
    ],
  };
}

const ALPHA_HOWL_DEF: StatusDef = makeAlphaHowlStatus({
  label: 'Alpha Howl',
  desc: 'You and allies within 4 tiles deal 15% more damage and move 15% faster.',
  radius: 4,
  dealtPct: 15,
  speedPct: 15,
});

const ALPHA_HOWL_UP_DEF: StatusDef = makeAlphaHowlStatus({
  label: 'Alpha Warcry',
  desc: 'You and allies within 5 tiles deal 20% more damage and move 20% faster.',
  radius: 5,
  dealtPct: 20,
  speedPct: 20,
});

const BASE_PACK_BOND: ClassWorn = {
  key: KEY_PACK_BOND,
  def: {
    label: 'Pack Bond',
    desc: 'Once a round when one of your minions falls, gain Vengeance for 2 rounds (20% more damage, 20% more speed, and a 12% max HP shield).',
    ops: [],
    triggers: [
      {
        on: 'minionDown',
        tag: null,
        to: 'self',
        limit: ROUND,
        ops: [{ op: 'applyStatus', key: KEY_VENGEANCE, def: VENGEANCE_DEF, duration: rounds(2) }],
      },
    ],
  },
};

const APEX_PACK_BOND: ClassWorn = {
  key: KEY_PACK_BOND_APEX,
  def: {
    label: 'Alpha Apex',
    desc: 'Your minions within 4 tiles deal 20% more damage and move 15% faster. Once a round when one of your minions falls, gain Apex Vengeance for 2 rounds (30% more damage, 20% more speed, and an 18% max HP shield). Once a round when you or your minions defeat a monster, heal 10% of max HP.',
    ops: [
      { op: 'aura', radius: 4, on: 'minions' },
      { op: 'share', on: 'dealt', pct: 20 },
      { op: 'speed', pct: 15 },
    ] satisfies readonly Op[],
    triggers: [
      {
        on: 'minionDown',
        tag: null,
        to: 'self',
        limit: ROUND,
        ops: [{ op: 'applyStatus', key: KEY_VENGEANCE_APEX, def: VENGEANCE_APEX_DEF, duration: rounds(2) }],
      },
      {
        on: 'armyKill',
        tag: null,
        to: 'self',
        limit: ROUND,
        ops: [{ op: 'heal', when: 'use', amount: f('0.10 * hpmax') }],
      },
    ] satisfies readonly Trigger[],
  },
};

// ── active ability builders ──

function makeCallPack(o: {
  readonly name: string;
  readonly pace: 'standard' | 'quick';
  readonly fangKey: StatusKey;
}): Ability {
  const base = abilityOf('support', {
    id: ID_CALL,
    name: o.name,
    desc: o.pace === 'quick'
      ? 'Quickly summon a Spirit Hound brute with Pack Fang to fight for 5 rounds.'
      : o.fangKey === KEY_PACK_FANG_UP
        ? 'Summon a Spirit Hound brute with Bloodfang to fight for 5 rounds.'
        : 'Summon a Spirit Hound brute with Pack Fang to fight for 5 rounds.',
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: null,
    ops: [],
  }, R);
  return {
    ...base,
    summon: {
      name: 'Spirit Hound',
      archetype: 'brute',
      rounds: 5,
      statuses: [{ key: o.fangKey, rounds: 5 }],
    },
    cost: { ...base.cost, mana: 6, fatigue: 6, time: cost(R.fight.cost[o.pace]), cooldown: rounds(1) },
  };
}

function makeMarkPrey(o: {
  readonly name: string;
  readonly cooldownRounds: number;
  readonly formula: string;
  readonly markKey: StatusKey;
  readonly markDef: StatusDef;
}): Ability {
  const base = abilityOf('curse', {
    id: ID_MARK,
    name: o.name,
    desc: `Strike a foe within 8 tiles for physical damage and apply ${o.markDef.label} for 3 rounds.`,
    aim: 'foe',
    range: tiles(8),
    shape: { kind: 'touch', reach: tiles(8) },
    delivery: { kind: 'direct' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [{ op: 'applyStatus', key: o.markKey, def: o.markDef, duration: rounds(3) }],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 6, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeAlphaHowl(o: {
  readonly name: string;
  readonly cooldownRounds: number;
  readonly howlKey: StatusKey;
  readonly howlDef: StatusDef;
}): Ability {
  const base = abilityOf('support', {
    id: ID_HOWL,
    name: o.name,
    desc: `Gain ${o.howlDef.label} for 2 rounds, boosting damage and speed for you and nearby allies.`,
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: null,
    ops: [{ op: 'applyStatus', key: o.howlKey, def: o.howlDef, duration: rounds(2) }],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 8, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

function makePackRally(o: {
  readonly name: string;
  readonly rangeTiles: number;
  readonly cooldownRounds: number;
  readonly healFormula: string;
  readonly hastenShare: number;
  readonly dispelFirst: boolean;
}): Ability {
  const ops: UseOp[] = [
    { op: 'hasten', share: o.hastenShare },
    ...(o.dispelFirst ? [{ op: 'dispel', which: 'first' } as const] : []),
  ];
  const base = abilityOf('support', {
    id: ID_RALLY,
    name: o.name,
    desc: o.dispelFirst
      ? `Heal an ally within ${o.rangeTiles} tiles, hasten them by ${Math.round(o.hastenShare * 100)}%, and cleanse one harmful status.`
      : `Heal an ally within ${o.rangeTiles} tiles and hasten them by ${Math.round(o.hastenShare * 100)}%.`,
    aim: 'ally',
    range: tiles(o.rangeTiles),
    shape: { kind: 'touch', reach: tiles(o.rangeTiles) },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'heal', by: 'hand', formula: f(o.healFormula) },
    ops,
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 6, fatigue: 6, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds) },
  };
}

const BASE_CALL = makeCallPack({
  name: 'Call the Pack',
  pace: 'standard',
  fangKey: KEY_PACK_FANG,
});

const UP_CALL_SWIFT = makeCallPack({
  name: 'Call the Pack: Swift Call',
  pace: 'quick',
  fangKey: KEY_PACK_FANG,
});

const UP_CALL_FANG = makeCallPack({
  name: 'Call the Pack: Bloodfang',
  pace: 'standard',
  fangKey: KEY_PACK_FANG_UP,
});

const BASE_MARK = makeMarkPrey({
  name: 'Mark Prey',
  cooldownRounds: 2,
  formula: '1d8 + 0.7 * sup',
  markKey: KEY_PREY_MARKED,
  markDef: PREY_MARKED_DEF,
});

const UP_MARK_QUARRY = makeMarkPrey({
  name: 'Mark Prey: Apex Quarry',
  cooldownRounds: 1,
  formula: '1d10 + 0.85 * sup',
  markKey: KEY_PREY_MARKED_UP,
  markDef: PREY_MARKED_UP_DEF,
});

const BASE_HOWL = makeAlphaHowl({
  name: 'Alpha Howl',
  cooldownRounds: 3,
  howlKey: KEY_ALPHA_HOWL,
  howlDef: ALPHA_HOWL_DEF,
});

const UP_HOWL_WARCRY = makeAlphaHowl({
  name: 'Alpha Howl: Warcry',
  cooldownRounds: 2,
  howlKey: KEY_ALPHA_HOWL_UP,
  howlDef: ALPHA_HOWL_UP_DEF,
});

const BASE_RALLY = makePackRally({
  name: 'Pack Rally',
  rangeTiles: 6,
  cooldownRounds: 2,
  healFormula: '1d8 + 1.1 * sup',
  hastenShare: 0.35,
  dispelFirst: false,
});

const UP_RALLY_SURGE = makePackRally({
  name: 'Pack Rally: Pack Surge',
  rangeTiles: 8,
  cooldownRounds: 1,
  healFormula: '2d6 + 1.35 * sup',
  hastenShare: 0.45,
  dispelFirst: true,
});

/** Base Packlord signature (before skill-tree nodes are folded on top). */
export const PACKLORD_SIGNATURE: ClassSignature = {
  className: 'Packlord',
  bonus: { pre: 2, ctl: 2, potency: 10 },
  worn: BASE_PACK_BOND,
  actives: [BASE_CALL, BASE_MARK, BASE_HOWL, BASE_RALLY],
  statuses: [
    { key: KEY_PACK_FANG, def: PACK_FANG_DEF },
    { key: KEY_PACK_FANG_UP, def: PACK_FANG_UP_DEF },
  ],
};

// ── 26-node / 23-buyable Epic skill tree ──

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

/** Full 7-depth, 3-branch (Pack, Hunt, Alpha), 23-buyable (26-node) Epic Packlord skill tree. */
export const PACKLORD_TREE: ClassTree = {
  className: 'Packlord',
  rarity: 'epic',
  nodes: [
    // Depth 1: Root (1)
    node('pack-root', 1, 'Call of the Wild', 'Gain 4 Presence, 3 Control, 5 potency, and 8 max mana.', [], [
      bonus({ pre: 4, ctl: 3, potency: 5, manaMax: 8 }),
    ]),

    // Depth 2: Three branches: Pack (a), Hunt (b), Alpha (c) (3)
    node('pack-a2', 2, 'Wild Bond', 'Gain 4 Presence and 6 ability haste.', ['pack-root'], [
      bonus({ pre: 4, haste: 6 }),
    ]),
    node('pack-b2', 2, 'Keen Scent', 'Gain 4 Control and 6 potency.', ['pack-root'], [
      bonus({ ctl: 4, potency: 6 }),
    ]),
    node('pack-c2', 2, 'Pack Leader', 'Gain 4 Presence and 5% heal and shield bonus.', ['pack-root'], [
      bonus({ pre: 4, healPower: 5 }),
    ]),

    // Depth 3: Branch splits (6)
    node('pack-a3x', 3, 'Deep Pack', 'Gain 6 max mana and 4% ability cost reduction.', ['pack-a2'], [
      bonus({ manaMax: 6, costCut: 4 }),
    ]),
    node('pack-a3y', 3, 'Feral Tempo', 'Gain 6 speed and 6 ability haste.', ['pack-a2'], [
      bonus({ speed: 6, haste: 6 }),
    ]),
    node('pack-b3x', 3, "Tracker's Aim", 'Gain 5 accuracy and 5% armor penetration.', ['pack-b2'], [
      bonus({ aim: 5, armorPen: 5 }),
    ]),
    node('pack-b3y', 3, 'Relentless Mark', 'Gain 6 potency and 3 Control.', ['pack-b2'], [
      bonus({ potency: 6, ctl: 3 }),
    ]),
    node('pack-c3x', 3, 'Steadfast Alpha', 'Gain 25 max HP and 5 tenacity.', ['pack-c2'], [
      bonus({ hpMax: 25, tenacity: 5 }),
    ]),
    node('pack-c3y', 3, 'Rallying Voice', 'Gain 6% heal and shield bonus and 6 ability haste.', ['pack-c2'], [
      bonus({ healPower: 6, haste: 6 }),
    ]),

    // Depth 4: Deepening (6)
    node('pack-a4x', 4, 'Spirit Well', 'Gain 8 max mana and 4 Presence.', ['pack-a3x'], [
      bonus({ manaMax: 8, pre: 4 }),
    ]),
    node('pack-a4y', 4, 'Pack Stride', 'Gain 8 speed and 1 move tile.', ['pack-a3y'], [
      bonus({ speed: 8, move: 1 }),
    ]),
    node('pack-b4x', 4, 'Rend Armor', 'Gain 6% armor penetration and 6 flat armor penetration.', ['pack-b3x'], [
      bonus({ armorPen: 6, armorPenFlat: 6 }),
    ]),
    node('pack-b4y', 4, 'Cunning Strike', 'Gain 5 Control and 1 extra crit face.', ['pack-b3y'], [
      bonus({ ctl: 5, critFaces: 1 }),
    ]),
    node('pack-c4x', 4, 'Pack Endurance', 'Gain 30 max HP and 5 Will.', ['pack-c3x'], [
      bonus({ hpMax: 30, will: 5 }),
    ]),
    node('pack-c4y', 4, 'Commanding Cadence', 'Gain 5 Presence and 6% heal and shield bonus.', ['pack-c3y'], [
      bonus({ pre: 5, healPower: 6 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('pack-a5-l', 5, 'Swift Call', 'Upgrade Call the Pack to a quick action so you summon a Spirit Hound faster.', ['pack-a4x', 'pack-a4y'], [
      replaceActive(ID_CALL, UP_CALL_SWIFT),
    ], { forkGroup: 'pack-a5' }),
    node('pack-a5-r', 5, 'Bloodfang Hounds', 'Upgrade Call the Pack so summoned Spirit Hounds gain Bloodfang (25% speed and 50% physical power bonus bites).', ['pack-a4x', 'pack-a4y'], [
      replaceActive(ID_CALL, UP_CALL_FANG),
    ], { forkGroup: 'pack-a5' }),

    node('pack-b5-l', 5, 'Apex Quarry', 'Upgrade Mark Prey to a 1-round cooldown, higher physical damage, 15% slow, 15% bonus damage taken, and stronger strike tears.', ['pack-b4x', 'pack-b4y'], [
      replaceActive(ID_MARK, UP_MARK_QUARRY),
    ], { forkGroup: 'pack-b5' }),
    node('pack-b5-r', 5, 'Pack Ambush', 'Gain 6 Control and 8% armor penetration. Your damaging attacks and spells deal up to 25% more damage to foes below half HP.', ['pack-b4x', 'pack-b4y'], [
      bonus({ ctl: 6, armorPen: 8 }),
      scaler({ measure: 'target', dir: 'under', start: 0.5, scale: 0.25 }),
    ], { forkGroup: 'pack-b5' }),

    node('pack-c5-l', 5, 'Alpha Warcry', 'Upgrade Alpha Howl to a 2-round cooldown and a 5-tile ally aura granting 20% more damage and 20% more speed.', ['pack-c4x', 'pack-c4y'], [
      replaceActive(ID_HOWL, UP_HOWL_WARCRY),
    ], { forkGroup: 'pack-c5' }),
    node('pack-c5-r', 5, 'Pack Surge', 'Upgrade Pack Rally to an 8-tile range, 1-round cooldown, stronger healing, 45% hasten, and a single harmful status dispel.', ['pack-c4x', 'pack-c4y'], [
      replaceActive(ID_RALLY, UP_RALLY_SURGE),
    ], { forkGroup: 'pack-c5' }),

    // Depth 6: Branch Capstones (3)
    node('pack-a6', 6, 'Twin Alphas', 'Gain 5 Presence, 8 ability haste, and 6 max mana.', ['pack-a5-l', 'pack-a5-r'], [
      bonus({ pre: 5, haste: 8, manaMax: 6 }),
    ], { parentMode: 'any' }),
    node('pack-b6', 6, 'Scent of Blood', 'Gain 6 Control, 8 flat armor penetration, and 0.1 crit multiplier.', ['pack-b5-l', 'pack-b5-r'], [
      bonus({ ctl: 6, armorPenFlat: 8, critSize: 10 }),
    ], { parentMode: 'any' }),
    node('pack-c6', 6, 'Heart of the Pack', 'Gain 5 Presence, 35 max HP, and 6% heal and shield bonus.', ['pack-c5-l', 'pack-c5-r'], [
      bonus({ pre: 5, hpMax: 35, healPower: 6 }),
    ], { parentMode: 'any' }),

    // Depth 7: Epic Capstone (1)
    node('pack-cap', 7, 'Alpha Apex', 'Upgrade Pack Bond to Alpha Apex and gain 6 Presence, 6 Control, and 30 max HP.', ['pack-a6', 'pack-b6', 'pack-c6'], [
      replaceWorn(KEY_PACK_BOND, APEX_PACK_BOND),
      bonus({ pre: 6, ctl: 6, hpMax: 30 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
