// class-godfist.ts: Mythic Godfist (str+dis) signature kit and full 38-node / 32-buyable skill tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
// Single neutral Grit definition (`god-grit`) is shared across base Fighting Spirit and capstone Shattering Fist,
// fed by Hook H1 (`lost` + `stacksBy`) and converted into damage and shield by Worldsplitter. Heavenly Suplex uses
// zero-hook `swap + shove` (pinned in A2) with no root status.
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId, tag } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { Op, StackDef, StatusDef, StatusKey, UseOp } from '../combat/effect-ops.ts';
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
  if (!id) throw new Error(`Invalid Godfist node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Godfist formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };

const TAG_SUPLEX = tag('god-suplex');
const TAG_HAYMAKER = tag('god-haymaker');

const KEY_SPIRIT = statusKey('god-spirit');
const KEY_SHATTERING_FIST = statusKey('god-shattering-fist');
const KEY_GRIT = statusKey('god-grit');
const KEY_CRUSHED = statusKey('god-crushed-stance');
const KEY_PINNED = statusKey('god-pinned-grip');
const KEY_CHI_BRACE = statusKey('god-chi-brace');
const KEY_COUNTER_STANCE = statusKey('god-counter-stance');
const KEY_SHATTER_EXPOSED = statusKey('god-shatter-exposed');
const KEY_FLURRY_EXPOSED = statusKey('god-flurry-exposed');

const ID_KNUCKLE = abilityId('god-knuckle-rush');
const ID_SUPLEX = abilityId('god-heavenly-suplex');
const ID_QI_GUARD = abilityId('god-qi-guard');
const ID_WORLDSPLITTER = abilityId('god-worldsplitter');

// ── statuses ──

// Neutral stacking status (`ops: []`) so neither helpful nor harmful dispels ever strip Grit.
const GRIT: StackDef = {
  label: 'Grit',
  desc: 'Stored fighting resolve built from HP damage past your shield (up to 20 stacks). Worldsplitter spends all stacks on hit for extra damage and a shield.',
  ops: [],
  stack: {
    cap: 20,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: null,
  },
};

const CRUSHED_STANCE: StatusDef = {
  label: 'Crushed Stance',
  desc: 'Speed reduced by 15% and deals 15% less damage for 2 rounds.',
  ops: [
    { op: 'speed', pct: -15 },
    { op: 'share', on: 'dealt', pct: -15 },
  ],
};

// Pinning Suplex adds a 1-round stun (`hold`), never `root`, so swap + shove movement stays intact.
const PINNED_GRIP: StatusDef = {
  label: 'Pinned Grip',
  desc: 'Stunned for 1 round.',
  ops: [{ op: 'hold' }],
};

// 1-round duration matches `RULES.fight.kit.wardRounds` so safeguard is never clamped.
const CHI_BRACE: StatusDef = {
  label: 'Chi Brace',
  desc: 'Blocks harmful statuses and increases damage dealt by 15% for 1 round.',
  ops: [
    { op: 'safeguard' },
    { op: 'share', on: 'dealt', pct: 15 },
  ],
};

// Self status applied by Counter Palm (D5 Qi Guard fork) so the retaliation fires on `struck` targeting `other`.
const COUNTER_STANCE: StatusDef = {
  label: 'Counter Stance',
  desc: 'Once a round for 1 round, being struck retaliates with physical damage equal to 90% of physical power.',
  ops: [],
  triggers: [
    {
      on: 'struck',
      tag: null,
      to: 'other',
      limit: ROUND,
      ops: [{ op: 'damage', type: 'physical', when: 'use', amount: f('0.9 * phys') }],
    },
  ],
};

const SHATTER_EXPOSED: StatusDef = {
  label: 'Shattered Defense',
  desc: 'Attacks against this target crit on 2 more die faces for 2 rounds.',
  ops: [{ op: 'sheet', key: 'exposed', amount: 2 }],
};

const FLURRY_EXPOSED: StatusDef = {
  label: 'Open Guard',
  desc: 'Attacks against this target crit on 1 more die face for 1 round.',
  ops: [{ op: 'sheet', key: 'exposed', amount: 1 }],
};

function makeFightingSpirit(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly armorFlat: number;
  readonly dealtPct: number;
  readonly gritDivisor: string;
  readonly kiBreath: string;
  readonly haymakerShield: string;
  readonly suplexEcho?: { readonly shield: string; readonly refundPct: number };
}): ClassWorn {
  const ops: Op[] = [
    { op: 'sheet', key: 'armor', amount: { kind: 'number', value: o.armorFlat } },
    ...(o.dealtPct > 0 ? [{ op: 'share' as const, on: 'dealt' as const, pct: o.dealtPct }] : []),
  ];
  const triggers: Trigger[] = [
    // 1. Grit: taking HP damage past shield adds stacks of neutral Grit (clamped to kit.stackAdd per hit).
    {
      on: 'struck',
      tag: null,
      to: 'self',
      limit: EACH,
      ops: [{ op: 'applyStatus', key: KEY_GRIT, def: GRIT, duration: null, stacksBy: f(`lost / (${o.gritDivisor})`) }],
    },
    // 2. Ki Breath: steady start-of-turn recovery.
    {
      on: 'turnStart',
      to: 'self',
      limit: EACH,
      ops: [{ op: 'heal', when: 'use', amount: f(o.kiBreath) }],
    },
    // 3. Worldsplitter release: hitting with Worldsplitter converts held Grit into a shield and clears Grit.
    {
      on: 'hitDealt',
      tag: TAG_HAYMAKER,
      to: 'self',
      limit: EACH,
      ops: [
        { op: 'shield', amount: f(o.haymakerShield) },
        { op: 'cureStatus', key: KEY_GRIT },
      ],
    },
    // 4. Grandmaster Echo (Capstone): using Heavenly Suplex grants a shield and refunds action time once a round.
    ...(o.suplexEcho
      ? [{
        on: 'used' as const,
        tag: TAG_SUPLEX,
        to: 'self' as const,
        limit: ROUND,
        ops: [
          { op: 'shield' as const, amount: f(o.suplexEcho.shield) },
          { op: 'refund' as const, pct: o.suplexEcho.refundPct },
        ],
      }]
      : []),
  ];
  return { key: o.key, def: { label: o.label, desc: o.desc, ops, triggers } };
}

const BASE_SPIRIT: ClassWorn = makeFightingSpirit({
  key: KEY_SPIRIT,
  label: 'Fighting Spirit',
  desc: 'Adds 22 armor and 4% damage dealt. Taking HP damage past your shield builds 1 stack of Grit per 2.5% of max HP lost. At the start of each turn, heal 1% of max HP. Hitting with Worldsplitter shields you for 1.5% of max HP per stack of Grit and clears Grit.',
  armorFlat: 22,
  dealtPct: 4,
  gritDivisor: '0.025 * hpmax',
  kiBreath: '0.01 * hpmax',
  haymakerShield: '0.015 * hpmax * stacks(god-grit)',
});

const SHATTERING_FIST: ClassWorn = makeFightingSpirit({
  key: KEY_SHATTERING_FIST,
  label: 'Shattering Fist',
  desc: 'Adds 34 armor and 6% damage dealt. Taking HP damage past your shield builds 1 stack of Grit per 2% of max HP lost. At the start of each turn, heal 1% of max HP. Hitting with Worldsplitter shields you for 2% of max HP per stack of Grit and clears Grit. Once a round when using Heavenly Suplex, gain a shield equal to 4% of max HP and refund 50% of its action time.',
  armorFlat: 34,
  dealtPct: 6,
  gritDivisor: '0.02 * hpmax',
  kiBreath: '0.01 * hpmax',
  haymakerShield: '0.02 * hpmax * stacks(god-grit)',
  suplexEcho: { shield: '0.04 * hpmax', refundPct: 50 },
});

// ── active ability builders ──
// Pure unarmed martial: 0 mana, fatigue-driven, physical damage.

function makeKnuckleRush(o: {
  readonly name: string;
  readonly formula: string;
  readonly cleave?: true;
  readonly expose?: true;
}): Ability {
  const ops: UseOp[] = [
    { op: 'stagger', share: 0.05 },
    ...(o.expose ? [{ op: 'applyStatus' as const, key: KEY_FLURRY_EXPOSED, def: FLURRY_EXPOSED, duration: rounds(1) }] : []),
  ];
  const base = o.cleave
    ? abilityOf('strike', {
      id: ID_KNUCKLE,
      name: o.name,
      desc: 'Quick strike hitting foes within 2 tiles for physical damage and filling 5% stagger.',
      aim: 'place',
      range: tiles(0),
      shape: { kind: 'radius', radius: tiles(2), ring: null },
      delivery: { kind: 'direct' },
      foesOnly: true,
      effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
      ops,
    }, R)
    : abilityOf('strike', {
      id: ID_KNUCKLE,
      name: o.name,
      desc: o.expose
        ? 'Quick melee punch for physical damage that fills 5% stagger and applies Flurry Exposed for 1 round.'
        : 'Quick melee punch for physical damage that fills 5% stagger.',
      aim: 'foe',
      range: tiles(1),
      shape: { kind: 'touch', reach: tiles(1) },
      delivery: { kind: 'direct' },
      foesOnly: true,
      effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
      ops,
    }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 4, time: cost(R.fight.cost.quick), cooldown: rounds(0) },
  };
}

function makeHeavenlySuplex(o: {
  readonly name: string;
  readonly shoveTiles: number;
  readonly staggerShare: number;
  readonly cooldownRounds: number;
  readonly pinHold?: true;
}): Ability {
  const ops: UseOp[] = [
    { op: 'shove', dir: 'away', from: 'user', tiles: tiles(o.shoveTiles) },
    { op: 'stagger', share: o.staggerShare },
    { op: 'applyStatus', key: KEY_CRUSHED, def: CRUSHED_STANCE, duration: rounds(2) },
    ...(o.pinHold ? [{ op: 'applyStatus' as const, key: KEY_PINNED, def: PINNED_GRIP, duration: rounds(1) }] : []),
  ];
  const base = abilityOf('strike', {
    id: ID_SUPLEX,
    name: o.name,
    desc: o.pinHold
      ? `Swap places with a melee foe, slam them for target-HP-scaled damage, shove them ${o.shoveTiles} tiles back, fill ${Math.round(o.staggerShare * 100)}% stagger, apply Crushed Stance for 2 rounds, and hold them for 1 round.`
      : `Swap places with a melee foe, slam them for target-HP-scaled damage, shove them ${o.shoveTiles} tiles back, fill ${Math.round(o.staggerShare * 100)}% stagger, and apply Crushed Stance for 2 rounds.`,
    aim: 'foe',
    range: tiles(1),
    shape: { kind: 'touch', reach: tiles(1) },
    delivery: { kind: 'direct' },
    foesOnly: true,
    move: { kind: 'swap' },
    effect: { type: 'physical', by: 'hand', formula: f('2d8 + 0.85 * phys + min(0.04 * target.hpmax, 1.05 * phys)') },
    ops,
  }, R);
  return {
    ...base,
    tags: [TAG_SUPLEX],
    cost: { ...base.cost, mana: 0, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeQiGuard(o: {
  readonly name: string;
  readonly guardShare: number;
  readonly shieldFormula: string;
  readonly counterStance?: true;
}): Ability {
  const ops: UseOp[] = [
    { op: 'guard', share: o.guardShare },
    { op: 'applyStatus', key: KEY_CHI_BRACE, def: CHI_BRACE, duration: rounds(1) },
    ...(o.counterStance ? [{ op: 'applyStatus' as const, key: KEY_COUNTER_STANCE, def: COUNTER_STANCE, duration: rounds(1) }] : []),
  ];
  const base = abilityOf('support', {
    id: ID_QI_GUARD,
    name: o.name,
    desc: o.counterStance
      ? `Reaction. Shield yourself, absorb ${Math.round(o.guardShare * 100)}% of an incoming hit, and gain Chi Brace and Counter Palm for 1 round.`
      : `Reaction. Shield yourself, absorb ${Math.round(o.guardShare * 100)}% of an incoming hit, and gain Chi Brace for 1 round.`,
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'shield', by: 'hand', formula: f(o.shieldFormula) },
    ops,
  }, R);
  return {
    ...base,
    react: { when: 'before', reach: tiles(0) },
    cost: { ...base.cost, mana: 0, fatigue: 3, time: cost(R.fight.cost.quick), cooldown: rounds(3) },
  };
}

function makeWorldsplitter(o: {
  readonly name: string;
  readonly formula: string;
  readonly cooldownRounds: number;
  readonly expose?: true;
}): Ability {
  const ops: UseOp[] = [
    { op: 'stagger', share: 0.15 },
    { op: 'shove', dir: 'away', from: 'user', tiles: tiles(2) },
    ...(o.expose ? [{ op: 'applyStatus' as const, key: KEY_SHATTER_EXPOSED, def: SHATTER_EXPOSED, duration: rounds(2) }] : []),
  ];
  const base = abilityOf('strike', {
    id: ID_WORLDSPLITTER,
    name: o.name,
    desc: o.expose
      ? 'Heavy melee blow that scales with Grit stacks, fills 15% stagger, shoves 2 tiles back, and applies Shattered Guard for 2 rounds.'
      : 'Heavy melee blow that scales with Grit stacks, fills 15% stagger, and shoves the target 2 tiles back.',
    aim: 'foe',
    range: tiles(1),
    shape: { kind: 'touch', reach: tiles(1) },
    delivery: { kind: 'direct' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops,
  }, R);
  return {
    ...base,
    tags: [TAG_HAYMAKER],
    cost: { ...base.cost, mana: 0, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

const BASE_KNUCKLE = makeKnuckleRush({
  name: 'Knuckle Rush',
  formula: '1d10 + 0.80 * phys',
});

const UP_KNUCKLE_FLURRY = makeKnuckleRush({
  name: 'Knuckle Rush: Flurry Rush',
  formula: '1d10 + 0.95 * phys',
  expose: true,
});

const UP_KNUCKLE_THUNDER = makeKnuckleRush({
  name: 'Knuckle Rush: Thunder Clap',
  formula: '1d10 + 0.80 * phys',
  cleave: true,
});

const BASE_SUPLEX = makeHeavenlySuplex({
  name: 'Heavenly Suplex',
  shoveTiles: 2,
  staggerShare: 0.35,
  cooldownRounds: 3,
});

const UP_SUPLEX_MOUNTAIN = makeHeavenlySuplex({
  name: 'Heavenly Suplex: Mountain Drop',
  shoveTiles: 3,
  staggerShare: 0.40,
  cooldownRounds: 3,
});

const UP_SUPLEX_PINNING = makeHeavenlySuplex({
  name: 'Heavenly Suplex: Pinning Suplex',
  shoveTiles: 2,
  staggerShare: 0.35,
  cooldownRounds: 4,
  pinHold: true,
});

const BASE_QI_GUARD = makeQiGuard({
  name: 'Qi Guard',
  guardShare: 0.25,
  shieldFormula: '0.06 * hpmax',
});

const UP_QI_DIAMOND = makeQiGuard({
  name: 'Qi Guard: Diamond Guard',
  guardShare: 0.35,
  shieldFormula: '0.09 * hpmax',
});

const UP_QI_COUNTER = makeQiGuard({
  name: 'Qi Guard: Counter Palm',
  guardShare: 0.25,
  shieldFormula: '0.06 * hpmax',
  counterStance: true,
});

const BASE_WORLDSPLITTER = makeWorldsplitter({
  name: 'Worldsplitter',
  formula: '2d10 + 0.95 * phys + 0.04 * hpmax * stacks(god-grit)',
  cooldownRounds: 3,
});

const UP_WORLDSPLITTER_SHATTER = makeWorldsplitter({
  name: 'Worldsplitter: Shatter Blow',
  formula: '2d10 + 0.95 * phys + 0.05 * hpmax * stacks(god-grit)',
  cooldownRounds: 3,
  expose: true,
});

const UP_WORLDSPLITTER_HUNDRED = makeWorldsplitter({
  name: 'Worldsplitter: Hundred-Ton Fist',
  formula: '2d10 + 0.95 * phys + 0.04 * hpmax * stacks(god-grit)',
  cooldownRounds: 2,
});

/** Base Godfist signature (before skill-tree nodes are folded on top). */
export const GODFIST_SIGNATURE: ClassSignature = {
  className: 'Godfist',
  bonus: { str: 3, dis: 2, hpMax: 5, speed: 10 },
  worn: BASE_SPIRIT,
  actives: [BASE_KNUCKLE, BASE_SUPLEX, BASE_QI_GUARD, BASE_WORLDSPLITTER],
};

// ── 38-node / 32-buyable Mythic skill tree ──

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

/** Full 9-depth, 3-branch, 32-buyable (38-node) Mythic Godfist skill tree. */
export const GODFIST_TREE: ClassTree = {
  className: 'Godfist',
  rarity: 'mythic',
  nodes: [
    // Depth 1: Root (1)
    node('god-root', 1, 'Awakened Palm', 'Gain 2 Strength and 1 Discipline.', [], [
      bonus({ str: 2, dis: 1 }),
    ]),

    // Depth 2: Three branches (3) — Grit (a), Fist (b), Throw (c)
    node('god-a2', 2, 'Hardened Meridian', 'Gain 4 tenacity and 2 speed.', ['god-root'], [
      bonus({ tenacity: 4, speed: 2 }),
    ]),
    node('god-b2', 2, 'Crushing Knuckle', 'Gain 3 Strength and 12% armor penetration.', ['god-root'], [
      bonus({ str: 3, armorPen: 12 }),
    ]),
    node('god-c2', 2, 'Iron Footwork', 'Gain 2 Strength, 6 speed, and 3 ability haste.', ['god-root'], [
      bonus({ str: 2, speed: 6, haste: 3 }),
    ]),

    // Depth 3: Branch splits (6)
    node('god-a3x', 3, 'Tempered Sinew', 'Gain 4 speed and 4 tenacity.', ['god-a2'], [
      bonus({ speed: 4, tenacity: 4 }),
    ]),
    node('god-a3y', 3, 'Deep Ki Breath', 'Gain 1 Discipline and 4 tenacity.', ['god-a2'], [
      bonus({ dis: 1, tenacity: 4 }),
    ]),
    node('god-b3x', 3, 'Bone Sunder', 'Gain 3 Strength, 12% armor penetration, and 8 flat armor penetration.', ['god-b2'], [
      bonus({ str: 3, armorPen: 12, armorPenFlat: 8 }),
    ]),
    node('god-b3y', 3, 'Heavy Stance', 'Gain 3 Strength and 1 extra crit face.', ['god-b2'], [
      bonus({ str: 3, critFaces: 1 }),
    ]),
    node('god-c3x', 3, 'Pivot Grip', 'Gain 3 Strength and 4 potency.', ['god-c2'], [
      bonus({ str: 3, potency: 4 }),
    ]),
    node('god-c3y', 3, 'Swift Closing', 'Gain 6 speed and 4 ability haste.', ['god-c2'], [
      bonus({ speed: 6, haste: 4 }),
    ]),

    // Depth 4: Deepening (6)
    node('god-a4x', 4, 'Unbending Spine', 'Gain 4 speed and 4 tenacity.', ['god-a3x'], [
      bonus({ speed: 4, tenacity: 4 }),
    ]),
    node('god-a4y', 4, 'Calm Pulse', 'Gain 1 Discipline and 4 potency.', ['god-a3y'], [
      bonus({ dis: 1, potency: 4 }),
    ]),
    node('god-b4x', 4, 'Hammer Knuckles', 'Gain 3 Strength, 12% armor penetration, and 9 flat armor penetration.', ['god-b3x'], [
      bonus({ str: 3, armorPen: 12, armorPenFlat: 9 }),
    ]),
    node('god-b4y', 4, 'Lethal Impact', 'Gain 3 Strength and 0.1 crit multiplier.', ['god-b3y'], [
      bonus({ str: 3, critSize: 10 }),
    ]),
    node('god-c4x', 4, 'Breaker Throw', 'Gain 3 Strength, 4 Accuracy, and 4 potency.', ['god-c3x'], [
      bonus({ str: 3, aim: 4, potency: 4 }),
    ]),
    node('god-c4y', 4, 'Relentless Tempo', 'Gain 6 speed, 4 ability haste, and 3 Reaction.', ['god-c3y'], [
      bonus({ speed: 6, haste: 4, react: 3 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('god-a5-l', 5, 'Diamond Guard', 'Upgrade Qi Guard to cut incoming strikes by 35% and grant a shield equal to 9% of max HP.', ['god-a4x', 'god-a4y'], [
      replaceActive(ID_QI_GUARD, UP_QI_DIAMOND),
    ], { forkGroup: 'god-a5' }),
    node('god-a5-r', 5, 'Counter Palm', 'Upgrade Qi Guard to grant 1 round of Counter Stance so being struck retaliates for 90% of physical power once a round.', ['god-a4x', 'god-a4y'], [
      replaceActive(ID_QI_GUARD, UP_QI_COUNTER),
    ], { forkGroup: 'god-a5' }),

    node('god-b5-l', 5, 'Shatter Blow', 'Upgrade Worldsplitter to deal 5% of max HP per Grit stack and apply Shattered Defense (+2 exposed for 2 rounds).', ['god-b4x', 'god-b4y'], [
      replaceActive(ID_WORLDSPLITTER, UP_WORLDSPLITTER_SHATTER),
    ], { forkGroup: 'god-b5' }),
    node('god-b5-r', 5, 'Hundred-Ton Fist', 'Upgrade Worldsplitter to a 2-round cooldown.', ['god-b4x', 'god-b4y'], [
      replaceActive(ID_WORLDSPLITTER, UP_WORLDSPLITTER_HUNDRED),
    ], { forkGroup: 'god-b5' }),

    node('god-c5-l', 5, 'Mountain Drop', 'Upgrade Heavenly Suplex to throw targets 3 tiles past your starting spot and deal 40% stagger.', ['god-c4x', 'god-c4y'], [
      replaceActive(ID_SUPLEX, UP_SUPLEX_MOUNTAIN),
    ], { forkGroup: 'god-c5' }),
    node('god-c5-r', 5, 'Pinning Suplex', 'Upgrade Heavenly Suplex to stun the target for 1 round with a 4-round cooldown.', ['god-c4x', 'god-c4y'], [
      replaceActive(ID_SUPLEX, UP_SUPLEX_PINNING),
    ], { forkGroup: 'god-c5' }),

    // Depth 6: Post-fork convergence (6)
    node('god-a6x', 6, 'Adamant Frame', 'Gain 4 speed and 4 tenacity.', ['god-a5-l', 'god-a5-r'], [
      bonus({ speed: 4, tenacity: 4 }),
    ], { parentMode: 'any' }),
    node('god-a6y', 6, 'Steady Meridian', 'Gain 1 Discipline and 4 tenacity.', ['god-a5-l', 'god-a5-r'], [
      bonus({ dis: 1, tenacity: 4 }),
    ], { parentMode: 'any' }),
    node('god-b6x', 6, 'Steel Strike', 'Gain 3 Strength, 12% armor penetration, and 9 flat armor penetration.', ['god-b5-l', 'god-b5-r'], [
      bonus({ str: 3, armorPen: 12, armorPenFlat: 9 }),
    ], { parentMode: 'any' }),
    node('god-b6y', 6, 'True Precision', 'Gain 3 Strength, 1 extra crit face, and 0.1 crit multiplier.', ['god-b5-l', 'god-b5-r'], [
      bonus({ str: 3, critFaces: 1, critSize: 10 }),
    ], { parentMode: 'any' }),
    node('god-c6x', 6, 'Earthshaker Grip', 'Gain 3 Strength and 5 potency.', ['god-c5-l', 'god-c5-r'], [
      bonus({ str: 3, potency: 5 }),
    ], { parentMode: 'any' }),
    node('god-c6y', 6, 'Driving Stride', 'Gain 6 speed, 4 ability haste, and 4 Reaction.', ['god-c5-l', 'god-c5-r'], [
      bonus({ speed: 6, haste: 4, react: 4 }),
    ], { parentMode: 'any' }),

    // Depth 7: Second Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('god-a7-l', 7, 'Mountain Stance', 'Gain 12 tenacity and 4 speed.', ['god-a6x', 'god-a6y'], [
      bonus({ tenacity: 12, speed: 4 }),
    ], { forkGroup: 'god-a7' }),
    node('god-a7-r', 7, 'Grandmaster Form', 'Gain 25 max HP, 12 Will, and 3 Vitality.', ['god-a6x', 'god-a6y'], [
      bonus({ hpMax: 25, will: 12, vit: 3 }),
    ], { forkGroup: 'god-a7' }),

    node('god-b7-l', 7, 'Flurry Rush', 'Upgrade Knuckle Rush to add 15% more physical power scaling and apply Open Guard (+1 exposed for 1 round).', ['god-b6x', 'god-b6y'], [
      replaceActive(ID_KNUCKLE, UP_KNUCKLE_FLURRY),
    ], { forkGroup: 'god-b7' }),
    node('god-b7-r', 7, 'Thunder Clap', 'Upgrade Knuckle Rush into a radius-2 shockwave hitting all foes around you.', ['god-b6x', 'god-b6y'], [
      replaceActive(ID_KNUCKLE, UP_KNUCKLE_THUNDER),
    ], { forkGroup: 'god-b7' }),

    node('god-c7-l', 7, 'Worldbreaker Edge', 'Gain 4 Strength and deal up to 18% more damage to foes with higher max HP than you.', ['god-c6x', 'god-c6y'], [
      bonus({ str: 4 }),
      scaler({ measure: 'maxPair', dir: 'over', start: 0.5, scale: 0.18 }),
    ], { forkGroup: 'god-c7' }),
    node('god-c7-r', 7, 'Execution Fist', 'Gain 4 Strength and deal up to 20% more damage to foes under half HP.', ['god-c6x', 'god-c6y'], [
      bonus({ str: 4 }),
      scaler({ measure: 'target', dir: 'under', start: 0.5, scale: 0.20 }),
    ], { forkGroup: 'god-c7' }),

    // Depth 8: Branch Capstones (3)
    node('god-a8', 8, 'Immortal Body', 'Gain 6 tenacity and 4 speed.', ['god-a7-l', 'god-a7-r'], [
      bonus({ tenacity: 6, speed: 4 }),
    ], { parentMode: 'any' }),
    node('god-b8', 8, 'Titan Knuckles', 'Gain 4 Strength, 12% armor penetration, and 9 flat armor penetration.', ['god-b7-l', 'god-b7-r'], [
      bonus({ str: 4, armorPen: 12, armorPenFlat: 9 }),
    ], { parentMode: 'any' }),
    node('god-c8', 8, 'Grandmaster Throw', 'Gain 4 Strength and 4 ability haste.', ['god-c7-l', 'god-c7-r'], [
      bonus({ str: 4, haste: 4 }),
    ], { parentMode: 'any' }),

    // Depth 9: Monarch Capstone (1)
    node('god-cap', 9, 'Shattering Fist', 'Upgrade Fighting Spirit to Shattering Fist and gain 5 Strength and 1 Discipline.', ['god-a8', 'god-b8', 'god-c8'], [
      replaceWorn(KEY_SPIRIT, SHATTERING_FIST),
      bonus({ str: 5, dis: 1 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
