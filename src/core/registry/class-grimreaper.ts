// class-grimreaper.ts: Epic Grimreaper (str+ins) signature kit and full 26-node / 23-buyable skill tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
// Zero new combat hooks: all damaging abilities are physical-scaled so Executioner (str+ins) fires on strikes.
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { Op, Reach, StackDef, StatusDef, StatusKey, UseOp } from '../combat/effect-ops.ts';
import type { Limit, Trigger } from '../combat/triggers.ts';
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
  if (!id) throw new Error(`Invalid Grimreaper node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Grimreaper formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };
const area = (radius: number, on: 'allies' | 'foes'): Reach => ({ kind: 'area', radius: tiles(radius), on });

const KEY_LEDGER = statusKey('reaper-ledger');
const KEY_LEDGER_APEX = statusKey('reaper-ledger-apex');
const KEY_MARK = statusKey('reaper-mark');
const KEY_HARVEST = statusKey('reaper-harvest');
const KEY_HARVEST_APEX = statusKey('reaper-harvest-apex');
const KEY_PHANTOM = statusKey('reaper-phantom');
const KEY_PHANTOM_SHROUD = statusKey('reaper-phantom-shroud');
const KEY_PHANTOM_VEIL = statusKey('reaper-phantom-veil');
const KEY_SHROUD_WARD = statusKey('reaper-shroud-ward');
const KEY_VEIL = statusKey('reaper-veil');

const ID_REAP = abilityId('reaper-reap');
const ID_SWEEP = abilityId('reaper-scythe-sweep');
const ID_STEP = abilityId('reaper-shadowstep');
const ID_GUILLOTINE = abilityId('reaper-guillotine');

// ── statuses ──

const REAPER_MARK: StackDef = {
  label: "Reaper's Mark",
  desc: 'Speed reduced by 5% and attacks against this target crit on 0.5 more die faces per stack (up to 3 stacks). Guillotine spends all stacks for bonus true damage.',
  ops: [
    { op: 'speed', pct: -5 },
    { op: 'sheet', key: 'exposed', amount: 0.5 },
  ],
  stack: {
    cap: 3,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: null,
  },
};

const HARVEST_DEF: StackDef = {
  label: 'Harvest',
  desc: 'Deals 8% more damage per stack (up to 5 stacks) for the rest of the fight.',
  ops: [{ op: 'share', on: 'dealt', pct: 8 }],
  stack: {
    cap: 5,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: null,
  },
};

// Apex Reaper keeps cap 5 at +10% dealt (+50% exact shareCap, zero waste) and adds +3% speed per stack.
const HARVEST_APEX_DEF: StackDef = {
  label: 'Harvest',
  desc: 'Deals 10% more damage and adds 3% speed per stack (up to 5 stacks) for the rest of the fight.',
  ops: [
    { op: 'share', on: 'dealt', pct: 10 },
    { op: 'speed', pct: 3 },
  ],
  stack: {
    cap: 5,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: null,
  },
};

const PHANTOM_STRIDE: StatusDef = {
  label: 'Phantom Stride',
  desc: 'Speed increased by 20% and advantage on your next defense roll for 1 round.',
  ops: [
    { op: 'speed', pct: 20 },
    { op: 'edge', side: 'defend', keep: 'better', tag: null, spend: true },
  ],
};

const SHROUD_WARD: StatusDef = {
  label: 'Death Shroud',
  desc: 'Untargetable for 1 round (once per fight). Acting against a foe ends this early.',
  ops: [{ op: 'untargetable' }],
};

// Applied via statusGained trigger so Shadowstep's place-aim post-use unwarded step does not strip the ward on arrival.
const PHANTOM_STRIDE_SHROUD: StatusDef = {
  label: 'Phantom Stride II',
  desc: 'Speed increased by 25% and advantage on your next defense roll for 1 round. Grants Death Shroud on arrival once per fight.',
  ops: [
    { op: 'speed', pct: 25 },
    { op: 'edge', side: 'defend', keep: 'better', tag: null, spend: true },
  ],
  triggers: [
    {
      on: 'statusGained',
      key: KEY_PHANTOM_SHROUD,
      to: 'self',
      limit: EACH,
      ops: [{ op: 'applyStatus', key: KEY_SHROUD_WARD, def: SHROUD_WARD, duration: rounds(1) }],
    },
  ],
};

const PHANTOM_STRIDE_VEIL: StatusDef = {
  label: 'Phantom Stride II',
  desc: 'Speed increased by 25% and advantage on your next defense roll for 1 round.',
  ops: [
    { op: 'speed', pct: 25 },
    { op: 'edge', side: 'defend', keep: 'better', tag: null, spend: true },
  ],
};

const PHANTOM_VEIL: StatusDef = {
  label: 'Phantom Veil',
  desc: 'Hidden in plain sight for 1 round. Taking HP damage, being revealed, or dealing HP damage ends it.',
  ops: [{ op: 'hidden', level: [0, 0, 1, 2, 3, 4], start: 'anywhere', ends: { hurt: true, revealed: true, dealt: true } }],
};

function makeLedger(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly killHeal: string;
  readonly harvestKey: StatusKey;
  readonly harvestDef: StackDef;
  readonly splashRadius: number;
  readonly extraOps?: readonly Op[];
}): ClassWorn {
  const triggers: Trigger[] = [
    {
      on: 'kill',
      tag: null,
      to: 'self',
      limit: ROUND,
      ops: [
        { op: 'heal', when: 'use', amount: f(o.killHeal) },
        { op: 'refund', pct: 100 },
        { op: 'applyStatus', key: o.harvestKey, def: o.harvestDef, duration: null },
      ],
    },
    {
      on: 'kill',
      tag: null,
      to: area(o.splashRadius, 'foes'),
      limit: EACH,
      ops: [
        { op: 'applyStatus', key: KEY_MARK, def: REAPER_MARK, duration: rounds(3) },
      ],
    },
  ];
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [...(o.extraOps ?? [])],
      triggers,
    },
  };
}

const BASE_LEDGER: ClassWorn = makeLedger({
  key: KEY_LEDGER,
  label: "Death's Ledger",
  desc: "Once a round when you defeat a foe, heal 12% of max HP, refund 100% of your turn, and gain 1 Harvest stack (8% more damage dealt, up to 5). Every kill also applies Reaper's Mark to foes within 2 tiles for 3 rounds.",
  killHeal: '0.12 * hpmax',
  harvestKey: KEY_HARVEST,
  harvestDef: HARVEST_DEF,
  splashRadius: 2,
});

const APEX_LEDGER: ClassWorn = makeLedger({
  key: KEY_LEDGER_APEX,
  label: 'Apex Reaper',
  desc: "Once a round when you defeat a foe, heal 18% of max HP, refund 100% of your turn, and gain 1 Harvest stack (10% more damage dealt and 3% speed, up to 5). Every kill also applies Reaper's Mark to foes within 3 tiles for 3 rounds.",
  killHeal: '0.18 * hpmax',
  harvestKey: KEY_HARVEST_APEX,
  harvestDef: HARVEST_APEX_DEF,
  splashRadius: 3,
});

// ── active ability builders ──

function makeReap(o: {
  readonly name: string;
  readonly formula: string;
  readonly markStacks: number;
}): Ability {
  const base = abilityOf('strike', {
    id: ID_REAP,
    name: o.name,
    desc: o.markStacks > 1
      ? `Strike a melee foe for physical damage and apply ${o.markStacks} stacks of Reaper's Mark for 3 rounds.`
      : `Strike a melee foe for physical damage and apply Reaper's Mark for 3 rounds.`,
    aim: 'foe',
    range: tiles(1),
    shape: { kind: 'touch', reach: tiles(1) },
    delivery: { kind: 'travel', windup: tick(R.fight.abilityKinds.strike.windup), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [
      {
        op: 'applyStatus',
        key: KEY_MARK,
        def: REAPER_MARK,
        duration: rounds(3),
        ...(o.markStacks > 1 ? { stacks: o.markStacks } : {}),
      },
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(0) },
  };
}

function makeScytheSweep(o: {
  readonly name: string;
  readonly radiusTiles: number;
  readonly cooldownRounds: number;
  readonly formula: string;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('blast', {
    id: ID_SWEEP,
    name: o.name,
    desc: o.extraOps?.length
      ? `Sweep foes within ${o.radiusTiles} tiles for physical damage, apply Reaper's Mark for 3 rounds, and fill 20% stagger.`
      : `Sweep foes within ${o.radiusTiles} tiles for physical damage and apply Reaper's Mark for 3 rounds.`,
    aim: 'place',
    range: tiles(0),
    shape: { kind: 'radius', radius: tiles(o.radiusTiles), ring: null },
    delivery: { kind: 'travel', windup: tick(100), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'applyStatus', key: KEY_MARK, def: REAPER_MARK, duration: rounds(3) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 6, fatigue: 8, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeShadowstep(o: {
  readonly name: string;
  readonly desc: string;
  readonly rangeTiles: number;
  readonly cooldownRounds: number;
  readonly strideKey: StatusKey;
  readonly strideDef: StatusDef;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('support', {
    id: ID_STEP,
    name: o.name,
    desc: o.desc,
    aim: 'place',
    shape: { kind: 'self' },
    range: tiles(o.rangeTiles),
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: null,
    ops: [
      { op: 'applyStatus', key: o.strideKey, def: o.strideDef, duration: rounds(1) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    move: { kind: 'blink' },
    cost: { ...base.cost, mana: 4, fatigue: 6, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeGuillotine(o: {
  readonly name: string;
  readonly mana: number;
  readonly fatigue: number;
  readonly formula: string;
}): Ability {
  const base = abilityOf('strike', {
    id: ID_GUILLOTINE,
    name: o.name,
    desc: "Melee finisher that requires and consumes all Reaper's Mark stacks on the target to deal true damage that scales with missing HP.",
    aim: 'foe',
    range: tiles(1),
    shape: { kind: 'touch', reach: tiles(1) },
    delivery: { kind: 'travel', windup: tick(R.fight.abilityKinds.strike.windup), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'true', by: 'hand', formula: f(o.formula) },
    ops: [],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: o.mana, fatigue: o.fatigue, time: cost(R.fight.cost.standard), cooldown: rounds(0) },
    gates: [{ kind: 'holds', key: KEY_MARK, on: 'target', atLeast: 1 }],
    prices: [{ kind: 'stacks', key: KEY_MARK, from: 'target', take: { kind: 'all' } }],
  };
}

const BASE_REAP = makeReap({
  name: 'Reap',
  formula: '1d8 + 1.0 * phys',
  markStacks: 1,
});

const UP_REAP = makeReap({
  name: 'Reap: Twin Cut',
  formula: '1d10 + 1.15 * phys',
  markStacks: 2,
});

const BASE_SWEEP = makeScytheSweep({
  name: 'Scythe Sweep',
  radiusTiles: 2,
  cooldownRounds: 2,
  formula: '1d10 + 0.85 * phys',
});

const UP_SWEEP = makeScytheSweep({
  name: 'Scythe Sweep: Wide Reaping',
  radiusTiles: 3,
  cooldownRounds: 1,
  formula: '2d6 + 1.0 * phys',
  extraOps: [{ op: 'stagger', share: 0.2 }],
});

const BASE_STEP = makeShadowstep({
  name: 'Shadowstep',
  desc: 'Blink up to 5 tiles and gain Phantom Stride for 1 round.',
  rangeTiles: 5,
  cooldownRounds: 3,
  strideKey: KEY_PHANTOM,
  strideDef: PHANTOM_STRIDE,
});

const UP_STEP_SHROUD = makeShadowstep({
  name: 'Shadowstep: Death Shroud',
  desc: 'Blink up to 6 tiles and gain Phantom Stride II and Death Shroud for 1 round.',
  rangeTiles: 6,
  cooldownRounds: 2,
  strideKey: KEY_PHANTOM_SHROUD,
  strideDef: PHANTOM_STRIDE_SHROUD,
});

const UP_STEP_VEIL = makeShadowstep({
  name: 'Shadowstep: Phantom Veil',
  desc: 'Blink up to 6 tiles and gain Phantom Stride II and Phantom Veil for 1 round.',
  rangeTiles: 6,
  cooldownRounds: 2,
  strideKey: KEY_PHANTOM_VEIL,
  strideDef: PHANTOM_STRIDE_VEIL,
  extraOps: [{ op: 'applyStatus', key: KEY_VEIL, def: PHANTOM_VEIL, duration: rounds(1) }],
});

// 0.15 * target.hpmax cap stays safe after critSize x shareCap multipliers and still finishes targets under 30% HP.
const BASE_GUILLOTINE = makeGuillotine({
  name: 'Guillotine',
  mana: 6,
  fatigue: 10,
  formula: 'min(0.15 * target.hpmax, (1d10 + 0.9 * phys + 0.25 * phys * spent) * (1 + 1.2 * max(0, min(1, (target.missing - 0.5) / 0.5))))',
});

const UP_GUILLOTINE = makeGuillotine({
  name: 'Guillotine: Final Verdict',
  mana: 5,
  fatigue: 8,
  formula: 'min(0.15 * target.hpmax, (2d8 + 1.05 * phys + 0.35 * phys * spent) * (1 + 1.35 * max(0, min(1, (target.missing - 0.5) / 0.5))))',
});

/** Base Grimreaper signature (before skill-tree nodes are folded on top). */
export const GRIMREAPER_SIGNATURE: ClassSignature = {
  className: 'Grimreaper',
  bonus: { str: 2, ins: 2 },
  worn: BASE_LEDGER,
  actives: [BASE_REAP, BASE_SWEEP, BASE_STEP, BASE_GUILLOTINE],
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

/** Full 7-depth, 3-branch, 23-buyable (26-node) Epic Grimreaper skill tree. */
export const GRIMREAPER_TREE: ClassTree = {
  className: 'Grimreaper',
  rarity: 'epic',
  nodes: [
    // Depth 1: Root (1)
    node('reaper-root', 1, 'First Toll', 'Gain 4 Strength, 3 Instinct, and 5 speed.', [], [
      bonus({ str: 4, ins: 3, speed: 5 }),
    ]),

    // Depth 2: Three branches (3) — Execution (A), Pursuit (B), Harvest (C)
    node('reaper-a2', 2, "Executioner's Edge", 'Gain 4 Strength and 5% armor penetration.', ['reaper-root'], [
      bonus({ str: 4, armorPen: 5 }),
    ]),
    node('reaper-b2', 2, "Stalker's Pace", 'Gain 4 Instinct and 6 speed.', ['reaper-root'], [
      bonus({ ins: 4, speed: 6 }),
    ]),
    node('reaper-c2', 2, 'Blood Ledger', 'Gain 25 max HP and 5% heal and shield bonus.', ['reaper-root'], [
      bonus({ hpMax: 25, healPower: 5 }),
    ]),

    // Depth 3: Branch splits (6)
    node('reaper-a3x', 3, 'Severing Blow', 'Gain 5% armor penetration and 5 flat armor penetration.', ['reaper-a2'], [
      bonus({ armorPen: 5, armorPenFlat: 5 }),
    ]),
    node('reaper-a3y', 3, 'Lethal Poise', 'Gain 4 Strength and 0.08 crit multiplier.', ['reaper-a2'], [
      bonus({ str: 4, critSize: 8 }),
    ]),
    node('reaper-b3x', 3, 'Phantom Sprint', 'Gain 8 speed and 6 ability haste.', ['reaper-b2'], [
      bonus({ speed: 8, haste: 6 }),
    ]),
    node('reaper-b3y', 3, 'Keen Instinct', 'Gain 4 Instinct and 5 Reaction.', ['reaper-b2'], [
      bonus({ ins: 4, react: 5 }),
    ]),
    node('reaper-c3x', 3, "Reaper's Vitality", 'Gain 30 max HP and 5 tenacity.', ['reaper-c2'], [
      bonus({ hpMax: 30, tenacity: 5 }),
    ]),
    node('reaper-c3y', 3, 'Deep Cut', 'Gain 5 potency and 4 accuracy.', ['reaper-c2'], [
      bonus({ potency: 5, aim: 4 }),
    ]),

    // Depth 4: Deepening (6)
    node('reaper-a4x', 4, 'Bone Cleave', 'Gain 6% armor penetration and 6 flat armor penetration.', ['reaper-a3x'], [
      bonus({ armorPen: 6, armorPenFlat: 6 }),
    ]),
    node('reaper-a4y', 4, 'Killing Edge', 'Gain 5 Strength and 0.1 crit multiplier.', ['reaper-a3y'], [
      bonus({ str: 5, critSize: 10 }),
    ]),
    node('reaper-b4x', 4, 'Shadow Stride', 'Gain 8 speed and 1 move tile.', ['reaper-b3x'], [
      bonus({ speed: 8, move: 1 }),
    ]),
    node('reaper-b4y', 4, "Predator's Eye", 'Gain 5 Instinct and 1 extra crit face.', ['reaper-b3y'], [
      bonus({ ins: 5, critFaces: 1 }),
    ]),
    node('reaper-c4x', 4, 'Soul Siphon', 'Gain 35 max HP and 8% heal and shield bonus.', ['reaper-c3x'], [
      bonus({ hpMax: 35, healPower: 8 }),
    ]),
    node('reaper-c4y', 4, 'Marked for Death', 'Gain 6 potency and 6 ability haste.', ['reaper-c3y'], [
      bonus({ potency: 6, haste: 6 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('reaper-a5-l', 5, 'Final Verdict', 'Upgrade Guillotine to 5 mana, 8 fatigue, and higher physical and execute scaling within the 15% max HP cap.', ['reaper-a4x', 'reaper-a4y'], [
      replaceActive(ID_GUILLOTINE, UP_GUILLOTINE),
    ], { forkGroup: 'reaper-a5' }),
    node('reaper-a5-r', 5, 'Twin Cut', "Upgrade Reap to deal higher physical damage and apply 2 stacks of Reaper's Mark.", ['reaper-a4x', 'reaper-a4y'], [
      replaceActive(ID_REAP, UP_REAP),
    ], { forkGroup: 'reaper-a5' }),

    node('reaper-b5-l', 5, 'Death Shroud', 'Upgrade Shadowstep to 6-tile range, 2-round cooldown, 25% speed on Phantom Stride, and once-per-fight untargetable for 1 round.', ['reaper-b4x', 'reaper-b4y'], [
      replaceActive(ID_STEP, UP_STEP_SHROUD),
    ], { forkGroup: 'reaper-b5' }),
    node('reaper-b5-r', 5, 'Phantom Veil', 'Upgrade Shadowstep to 6-tile range, 2-round cooldown, 25% speed on Phantom Stride, and stealth in plain sight for 1 round.', ['reaper-b4x', 'reaper-b4y'], [
      replaceActive(ID_STEP, UP_STEP_VEIL),
    ], { forkGroup: 'reaper-b5' }),

    node('reaper-c5-l', 5, 'Wide Reaping', 'Upgrade Scythe Sweep to 3-tile radius, 1-round cooldown, higher physical damage, and 20% stagger on foes hit.', ['reaper-c4x', 'reaper-c4y'], [
      replaceActive(ID_SWEEP, UP_SWEEP),
    ], { forkGroup: 'reaper-c5' }),
    node('reaper-c5-r', 5, 'Merciless Toll', 'Gain 6 Strength and 8% armor penetration. Your damaging attacks and spells deal up to 18% more damage to foes below half HP.', ['reaper-c4x', 'reaper-c4y'], [
      bonus({ str: 6, armorPen: 8 }),
      scaler({ measure: 'target', dir: 'under', start: 0.5, scale: 0.18 }),
    ], { forkGroup: 'reaper-c5' }),

    // Depth 6: Branch Capstones (3)
    node('reaper-a6', 6, 'Execution Master', 'Gain 6 Strength, 8 flat armor penetration, and 0.1 crit multiplier.', ['reaper-a5-l', 'reaper-a5-r'], [
      bonus({ str: 6, armorPenFlat: 8, critSize: 10 }),
    ], { parentMode: 'any' }),
    node('reaper-b6', 6, 'Relentless Chase', 'Gain 6 Instinct, 8 speed, and 8 ability haste.', ['reaper-b5-l', 'reaper-b5-r'], [
      bonus({ ins: 6, speed: 8, haste: 8 }),
    ], { parentMode: 'any' }),
    node('reaper-c6', 6, 'Full Ledger', 'Gain 5 Strength, 40 max HP, and 6% heal and shield bonus.', ['reaper-c5-l', 'reaper-c5-r'], [
      bonus({ str: 5, hpMax: 40, healPower: 6 }),
    ], { parentMode: 'any' }),

    // Depth 7: Epic Capstone (1)
    node('reaper-cap', 7, 'Apex Reaper', "Upgrade Death's Ledger to Apex Reaper and gain 6 Strength, 6 Instinct, and 0.1 crit multiplier.", ['reaper-a6', 'reaper-b6', 'reaper-c6'], [
      replaceWorn(KEY_LEDGER, APEX_LEDGER),
      bonus({ str: 6, ins: 6, critSize: 10 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
