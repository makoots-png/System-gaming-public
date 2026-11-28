// class-voidstalker.ts: Epic Voidstalker (agi+ins) signature kit and full 26-node / 23-buyable skill tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
// Zero new combat hooks: Void Shroud keeps ends.dealt false for a 1-round planar phase-ambush chain.
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
  if (!id) throw new Error(`Invalid Voidstalker node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Voidstalker formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const ROUND: Limit = { kind: 'round' };

const KEY_SHADOW = statusKey('void-rift-shadow');
const KEY_SHADOW_PHANTOM = statusKey('void-abyssal-phantom');
const KEY_VEIL_SLIP = statusKey('void-veil-slip');
const KEY_VEIL_SLIP_UP = statusKey('void-veil-slip-ii');
const KEY_BRAND = statusKey('void-brand');
const KEY_BRAND_IMPLOSION = statusKey('void-brand-implosion');
const KEY_BRAND_ECHO = statusKey('void-brand-echo');
const KEY_SHROUD = statusKey('void-shroud');
const KEY_SHROUD_GHOST = statusKey('void-shroud-ghost');
const KEY_UMBRAL_WARD = statusKey('void-umbral-ward');
const KEY_RIFT_GAP = statusKey('void-rift-gap');
const KEY_MARKED = statusKey('void-marked');
const KEY_PHASE_RUSH = statusKey('void-phase-rush');

const ID_REND = abilityId('void-rend');
const ID_BLINK = abilityId('void-phase-blink');
const ID_CUT = abilityId('void-phantom-cut');
const ID_SWAP = abilityId('void-abyssal-swap');

// ── statuses ──

const VEIL_SLIP: StatusDef = {
  label: 'Veil Slip',
  desc: 'Speed increased by 15% and advantage on your next attack roll for 1 round.',
  ops: [
    { op: 'speed', pct: 15 },
    { op: 'edge', side: 'attack', keep: 'better', tag: null, spend: true },
  ],
};

const VEIL_SLIP_UP: StatusDef = {
  label: 'Veil Slip II',
  desc: 'Speed increased by 15%, deals 15% more damage, and advantage on your next attack roll for 1 round.',
  ops: [
    { op: 'speed', pct: 15 },
    { op: 'share', on: 'dealt', pct: 15 },
    { op: 'edge', side: 'attack', keep: 'better', tag: null, spend: true },
  ],
};

// Planar phase-stealth: breaks on taking damage or reveal, persists through dealing damage for 1 round.
const VOID_SHROUD: StatusDef = {
  label: 'Void Shroud',
  desc: 'Phased out of sight for 1 round with 15% more speed. Taking HP damage or being revealed ends it, while dealing damage does not.',
  ops: [
    { op: 'hidden', level: [0, 0, 1, 2, 3, 4], start: 'anywhere', ends: { hurt: true, revealed: true, dealt: false } },
    { op: 'speed', pct: 15 },
  ],
};

const VOID_SHROUD_GHOST: StatusDef = {
  label: 'Ghost Step',
  desc: 'Phased out of sight for 1 round with 20% more speed and advantage on your next defense roll. Taking HP damage or being revealed ends it, while dealing damage does not.',
  ops: [
    { op: 'hidden', level: [0, 0, 1, 2, 3, 4], start: 'anywhere', ends: { hurt: true, revealed: true, dealt: false } },
    { op: 'speed', pct: 20 },
    { op: 'edge', side: 'defend', keep: 'better', tag: null, spend: true },
  ],
};

const UMBRAL_WARD: StatusDef = {
  label: 'Umbral Fade',
  desc: 'Untargetable for 1 round (once per fight). Acting against a foe ends this early.',
  ops: [{ op: 'untargetable' }],
};

const VOID_BRAND: StatusDef = {
  label: 'Void Brand',
  desc: 'Marked with void energy for 2 rounds. Deals arcane damage when it expires or is cured.',
  ops: [{ op: 'note', text: 'Void Brand primed.' }],
  end: {
    cleanse: 'land',
    ops: [{ op: 'damage', type: 'arcane', when: 'use', amount: f('1d8 + 0.7 * finesse') }],
  },
};

const VOID_BRAND_IMPLOSION: StatusDef = {
  label: 'Void Implosion',
  desc: 'Marked with unstable void energy for 2 rounds. Deals heavy arcane damage when it expires or is cured and heals the caster for 25% of damage dealt.',
  ops: [{ op: 'note', text: 'Void Implosion primed.' }],
  end: {
    cleanse: 'land',
    sourceHealShare: 0.25,
    ops: [{ op: 'damage', type: 'arcane', when: 'use', amount: f('2d8 + 0.9 * finesse') }],
  },
};

const VOID_BRAND_ECHO: StatusDef = {
  label: 'Echoing Brand',
  desc: 'Magic resist reduced by 15 for 2 rounds. Deals arcane damage when it expires or is cured.',
  ops: [{ op: 'sheet', key: 'resist', amount: { kind: 'number', value: -15 } }],
  end: {
    cleanse: 'land',
    ops: [{ op: 'damage', type: 'arcane', when: 'use', amount: f('1d8 + 0.7 * finesse') }],
  },
};

const RIFT_GAP: StatusDef = {
  label: 'Rift Gap',
  desc: 'Attacks against this target crit on 1 more die face for 2 rounds.',
  ops: [{ op: 'sheet', key: 'exposed', amount: 1 }],
};

const VOID_MARKED: StatusDef = {
  label: 'Void Marked',
  desc: 'Speed reduced by 15% and attacks against this target crit on 2 more die faces for 2 rounds.',
  ops: [
    { op: 'sheet', key: 'exposed', amount: 2 },
    { op: 'speed', pct: -15 },
  ],
};

// Self-curing arrival pulse so Phase Blink refunds 25% of its own quick action time without leaving a blank status behind.
const PHASE_RUSH: StatusDef = {
  label: 'Phase Rush',
  desc: 'Refunds 25% of your turn when you use Phase Blink.',
  ops: [],
  triggers: [
    {
      on: 'statusGained',
      key: KEY_PHASE_RUSH,
      to: 'self',
      limit: ROUND,
      ops: [
        { op: 'refund', pct: 25 },
        { op: 'cureStatus', key: KEY_PHASE_RUSH },
      ],
    },
  ],
};

function makeRiftShadow(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly dealtPct: number;
  readonly slipKey: StatusKey;
  readonly slipDef: StatusDef;
  readonly killRefundPct: number | null;
}): ClassWorn {
  const ops: Op[] = [{ op: 'share', on: 'dealt', pct: o.dealtPct }];
  const triggers: Trigger[] = [
    {
      on: 'avoided',
      tag: null,
      to: 'self',
      limit: ROUND,
      ops: [{ op: 'applyStatus', key: o.slipKey, def: o.slipDef, duration: rounds(1) }],
    },
    ...(o.killRefundPct !== null
      ? [
        {
          on: 'kill' as const,
          tag: null,
          to: 'self' as const,
          limit: ROUND,
          ops: [
            { op: 'applyStatus' as const, key: KEY_SHROUD, def: VOID_SHROUD, duration: rounds(1) },
            { op: 'refund' as const, pct: o.killRefundPct },
          ],
        },
      ]
      : []),
  ];
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops,
      triggers,
    },
  };
}

const BASE_SHADOW: ClassWorn = makeRiftShadow({
  key: KEY_SHADOW,
  label: 'Rift Shadow',
  desc: "Deals 10% more damage. Once a round when a foe's attack misses you, gain Veil Slip for 1 round (15% speed and advantage on your next attack).",
  dealtPct: 10,
  slipKey: KEY_VEIL_SLIP,
  slipDef: VEIL_SLIP,
  killRefundPct: null,
});

const ABYSSAL_PHANTOM: ClassWorn = makeRiftShadow({
  key: KEY_SHADOW_PHANTOM,
  label: 'Abyssal Phantom',
  desc: "Deals 18% more damage. Once a round when a foe's attack misses you, gain Veil Slip II for 1 round (15% speed, 15% damage dealt, and advantage on your next attack). Once a round when you defeat a foe, gain Void Shroud for 1 round and refund 40% of your turn.",
  dealtPct: 18,
  slipKey: KEY_VEIL_SLIP_UP,
  slipDef: VEIL_SLIP_UP,
  killRefundPct: 40,
});

// ── active ability builders ──

function makeVoidRend(o: {
  readonly name: string;
  readonly brandKey: StatusKey;
  readonly brandDef: StatusDef;
}): Ability {
  const base = abilityOf('strike', {
    id: ID_REND,
    name: o.name,
    desc: `Strike a melee foe for physical damage and apply ${o.brandDef.label} for 2 rounds.`,
    aim: 'foe',
    range: tiles(1),
    shape: { kind: 'touch', reach: tiles(1) },
    delivery: { kind: 'travel', windup: tick(R.fight.abilityKinds.strike.windup), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f('1d8 + 0.85 * finesse') },
    ops: [{ op: 'applyStatus', key: o.brandKey, def: o.brandDef, duration: rounds(2) }],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(0) },
  };
}

function makePhaseBlink(o: {
  readonly name: string;
  readonly shroudKey: StatusKey;
  readonly shroudDef: StatusDef;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('support', {
    id: ID_BLINK,
    name: o.name,
    desc: o.extraOps?.length
      ? `Blink up to 6 tiles, trigger Phase Rush, and gain ${o.shroudDef.label} and Umbral Fade for 1 round.`
      : `Blink up to 6 tiles, trigger Phase Rush, and gain ${o.shroudDef.label} for 1 round.`,
    aim: 'place',
    range: tiles(6),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: null,
    ops: [
      { op: 'applyStatus', key: KEY_PHASE_RUSH, def: PHASE_RUSH, duration: rounds(1) },
      { op: 'applyStatus', key: o.shroudKey, def: o.shroudDef, duration: rounds(1) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    move: { kind: 'blink' },
    cost: { ...base.cost, mana: 6, fatigue: 5, time: cost(R.fight.cost.quick), cooldown: rounds(2) },
  };
}

function makePhantomCut(o: {
  readonly name: string;
  readonly mana: number;
  readonly fatigue: number;
  readonly cooldownRounds: number;
  readonly formula: string;
}): Ability {
  const base = abilityOf('strike', {
    id: ID_CUT,
    name: o.name,
    desc: 'Quick strike on a foe within 2 tiles for physical damage that applies Rift Gap for 2 rounds.',
    aim: 'foe',
    range: tiles(2),
    shape: { kind: 'touch', reach: tiles(2) },
    delivery: { kind: 'travel', windup: tick(R.fight.abilityKinds.strike.windup), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [{ op: 'applyStatus', key: KEY_RIFT_GAP, def: RIFT_GAP, duration: rounds(2) }],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: o.mana, fatigue: o.fatigue, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeAbyssalSwap(): Ability {
  const base = abilityOf('curse', {
    id: ID_SWAP,
    name: 'Abyssal Swap',
    desc: 'Swap places with a foe within 6 tiles, dealing arcane damage and applying Void Marked for 2 rounds.',
    aim: 'foe',
    range: tiles(6),
    shape: { kind: 'touch', reach: tiles(6) },
    delivery: { kind: 'direct' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f('1d8 + 0.75 * finesse') },
    ops: [{ op: 'applyStatus', key: KEY_MARKED, def: VOID_MARKED, duration: rounds(2) }],
  }, R);
  return {
    ...base,
    move: { kind: 'swap' },
    cost: { ...base.cost, mana: 8, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(3) },
  };
}

const BASE_REND = makeVoidRend({
  name: 'Void Rend',
  brandKey: KEY_BRAND,
  brandDef: VOID_BRAND,
});

const UP_REND_IMPLOSION = makeVoidRend({
  name: 'Void Rend: Implosion',
  brandKey: KEY_BRAND_IMPLOSION,
  brandDef: VOID_BRAND_IMPLOSION,
});

const UP_REND_ECHO = makeVoidRend({
  name: 'Void Rend: Echoing Brand',
  brandKey: KEY_BRAND_ECHO,
  brandDef: VOID_BRAND_ECHO,
});

const BASE_BLINK = makePhaseBlink({
  name: 'Phase Blink',
  shroudKey: KEY_SHROUD,
  shroudDef: VOID_SHROUD,
});

const UP_BLINK_GHOST = makePhaseBlink({
  name: 'Phase Blink: Ghost Step',
  shroudKey: KEY_SHROUD_GHOST,
  shroudDef: VOID_SHROUD_GHOST,
});

// Because Phase Blink applies Void Shroud (hides === true), fight.ts keeps Umbral Fade untargetable intact on arrival.
const UP_BLINK_UMBRAL = makePhaseBlink({
  name: 'Phase Blink: Umbral Fade',
  shroudKey: KEY_SHROUD,
  shroudDef: VOID_SHROUD,
  extraOps: [{ op: 'applyStatus', key: KEY_UMBRAL_WARD, def: UMBRAL_WARD, duration: rounds(1) }],
});

const BASE_CUT = makePhantomCut({
  name: 'Phantom Cut',
  mana: 6,
  fatigue: 6,
  cooldownRounds: 2,
  formula: '1d6 + 0.65 * finesse',
});

const UP_CUT_FLURRY = makePhantomCut({
  name: 'Phantom Cut: Unseen Flurry',
  mana: 4,
  fatigue: 4,
  cooldownRounds: 1,
  formula: '1d8 + 0.8 * finesse',
});

const BASE_SWAP = makeAbyssalSwap();

/** Base Voidstalker signature (before skill-tree nodes are folded on top). */
export const VOIDSTALKER_SIGNATURE: ClassSignature = {
  className: 'Voidstalker',
  bonus: { agi: 2, ins: 2, critFaces: 1, speed: 4 },
  worn: BASE_SHADOW,
  actives: [BASE_REND, BASE_BLINK, BASE_CUT, BASE_SWAP],
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

/** Full 7-depth, 3-branch, 23-buyable (26-node) Epic Voidstalker skill tree. */
export const VOIDSTALKER_TREE: ClassTree = {
  className: 'Voidstalker',
  rarity: 'epic',
  nodes: [
    // Depth 1: Root (1)
    node('void-root', 1, 'First Rift', 'Gain 4 Agility, 3 Instinct, and 5 speed.', [], [
      bonus({ agi: 4, ins: 3, speed: 5 }),
    ]),

    // Depth 2: Three branches (3) — Rift (A), Brand (B), Veil (C)
    node('void-a2', 2, 'Phase Footing', 'Gain 4 Agility and 6 speed.', ['void-root'], [
      bonus({ agi: 4, speed: 6 }),
    ]),
    node('void-b2', 2, 'Void Etching', 'Gain 4 Instinct and 5 potency.', ['void-root'], [
      bonus({ ins: 4, potency: 5 }),
    ]),
    node('void-c2', 2, 'Veiled Edge', 'Gain 4 Agility and 5% armor penetration.', ['void-root'], [
      bonus({ agi: 4, armorPen: 5 }),
    ]),

    // Depth 3: Branch splits (6)
    node('void-a3x', 3, 'Slipthrough', 'Gain 8 speed and 5 Reaction.', ['void-a2'], [
      bonus({ speed: 8, react: 5 }),
    ]),
    node('void-a3y', 3, 'Rift Cadence', 'Gain 8 ability haste and 5 max mana.', ['void-a2'], [
      bonus({ haste: 8, manaMax: 5 }),
    ]),
    node('void-b3x', 3, 'Hollow Sigil', 'Gain 5% magic penetration and 5 flat magic penetration.', ['void-b2'], [
      bonus({ resistPen: 5, resistPenFlat: 5 }),
    ]),
    node('void-b3y', 3, 'Keen Sight', 'Gain 4 accuracy and 5 potency.', ['void-b2'], [
      bonus({ aim: 4, potency: 5 }),
    ]),
    node('void-c3x', 3, 'Rift Fang', 'Gain 5% armor penetration and 5 flat armor penetration.', ['void-c2'], [
      bonus({ armorPen: 5, armorPenFlat: 5 }),
    ]),
    node('void-c3y', 3, 'Silent Focus', 'Gain 4 Instinct and 0.08 crit multiplier.', ['void-c2'], [
      bonus({ ins: 4, critSize: 8 }),
    ]),

    // Depth 4: Deepening (6)
    node('void-a4x', 4, 'Blink Momentum', 'Gain 8 speed and 1 move tile.', ['void-a3x'], [
      bonus({ speed: 8, move: 1 }),
    ]),
    node('void-a4y', 4, 'Phase Reflex', 'Gain 6 Reaction and 6 ability haste.', ['void-a3y'], [
      bonus({ react: 6, haste: 6 }),
    ]),
    node('void-b4x', 4, 'Abyssal Rupture', 'Gain 6% magic penetration and 6 flat magic penetration.', ['void-b3x'], [
      bonus({ resistPen: 6, resistPenFlat: 6 }),
    ]),
    node('void-b4y', 4, 'Deep Brand', 'Gain 30 max HP and 6 max mana.', ['void-b3y'], [
      bonus({ hpMax: 30, manaMax: 6 }),
    ]),
    node('void-c4x', 4, 'Phantom Blade', 'Gain 6% armor penetration and 6 flat armor penetration.', ['void-c3x'], [
      bonus({ armorPen: 6, armorPenFlat: 6 }),
    ]),
    node('void-c4y', 4, 'Sudden Ambush', 'Gain 5 Instinct and 0.1 crit multiplier.', ['void-c3y'], [
      bonus({ ins: 5, critSize: 10 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('void-a5-l', 5, 'Ghost Step', 'Upgrade Phase Blink to grant Ghost Step with 20% speed and advantage on your next defense roll.', ['void-a4x', 'void-a4y'], [
      replaceActive(ID_BLINK, UP_BLINK_GHOST),
    ], { forkGroup: 'void-a5' }),
    node('void-a5-r', 5, 'Umbral Fade', 'Upgrade Phase Blink to grant once-per-fight untargetable for 1 round on arrival.', ['void-a4x', 'void-a4y'], [
      replaceActive(ID_BLINK, UP_BLINK_UMBRAL),
    ], { forkGroup: 'void-a5' }),

    node('void-b5-l', 5, 'Implosion', 'Upgrade Void Rend to apply Void Implosion for heavier arcane detonation and 25% healing from detonation damage.', ['void-b4x', 'void-b4y'], [
      replaceActive(ID_REND, UP_REND_IMPLOSION),
    ], { forkGroup: 'void-b5' }),
    node('void-b5-r', 5, 'Echoing Brand', 'Upgrade Void Rend to apply Echoing Brand, cutting magic resist by 15 before detonation.', ['void-b4x', 'void-b4y'], [
      replaceActive(ID_REND, UP_REND_ECHO),
    ], { forkGroup: 'void-b5' }),

    node('void-c5-l', 5, 'Unseen Flurry', 'Upgrade Phantom Cut to a 1-round cooldown with lower cost and higher damage, and gain 8 speed and 8 ability haste.', ['void-c4x', 'void-c4y'], [
      replaceActive(ID_CUT, UP_CUT_FLURRY),
      bonus({ speed: 8, haste: 8 }),
    ], { forkGroup: 'void-c5' }),
    node('void-c5-r', 5, 'Shadow Execution', 'Gain 6 Agility and 8% armor penetration. Your damaging attacks and spells deal up to 18% more damage to foes above half HP.', ['void-c4x', 'void-c4y'], [
      bonus({ agi: 6, armorPen: 8 }),
      scaler({ measure: 'target', dir: 'over', start: 0.5, scale: 0.18 }),
    ], { forkGroup: 'void-c5' }),

    // Depth 6: Branch Capstones (3)
    node('void-a6', 6, 'Rift Walker', 'Gain 6 Agility, 8 speed, and 6 Reaction.', ['void-a5-l', 'void-a5-r'], [
      bonus({ agi: 6, speed: 8, react: 6 }),
    ], { parentMode: 'any' }),
    node('void-b6', 6, 'Void Herald', 'Gain 6 Instinct, 35 max HP, and 6 potency.', ['void-b5-l', 'void-b5-r'], [
      bonus({ ins: 6, hpMax: 35, potency: 6 }),
    ], { parentMode: 'any' }),
    node('void-c6', 6, 'Night Stalker', 'Gain 6 Agility, 8 flat armor penetration, and 0.1 crit multiplier.', ['void-c5-l', 'void-c5-r'], [
      bonus({ agi: 6, armorPenFlat: 8, critSize: 10 }),
    ], { parentMode: 'any' }),

    // Depth 7: Epic Capstone (1)
    node('void-cap', 7, 'Abyssal Phantom', 'Upgrade Rift Shadow to Abyssal Phantom and gain 6 Agility, 6 Instinct, and 1 extra crit face.', ['void-a6', 'void-b6', 'void-c6'], [
      replaceWorn(KEY_SHADOW, ABYSSAL_PHANTOM),
      bonus({ agi: 6, ins: 6, critFaces: 1 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
