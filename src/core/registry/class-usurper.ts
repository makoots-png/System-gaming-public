// class-usurper.ts: Mythic Usurper (agi+pow) signature kit and full 38-node / 32-buyable skill tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
// Hijack uses Wave 5 Hook H3 (`usurp: { amp }`) to copy a caught foe's standing omen or strongest damaging ability.
// Siphon Mandate uses Wave 3 Hook 2 helpful dispel. Will bonuses live on `bonus` gifts (`will` is a BonusKey, not a
// SheetOpKey); armor lives on worn statuses (`armor` is a SheetFormulaKey, not a BonusKey).
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId, tag } from '../combat/ability-types.ts';
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
  if (!id) throw new Error(`Invalid Usurper node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Usurper formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const ROUND: Limit = { kind: 'round' };

const TAG_HIJACK = tag('usurp-hijack');

const KEY_CROWN = statusKey('usurp-crown');
const KEY_SOVEREIGN_CROWN = statusKey('usurp-sovereign-crown');
const KEY_STOLEN_ARCANA = statusKey('usurp-stolen-arcana');
const KEY_USURPED = statusKey('usurp-usurped');
const KEY_PHANTOM_USURPED = statusKey('usurp-phantom-usurped');
const KEY_BROKEN_CROWN = statusKey('usurp-broken-crown');
const KEY_WARD = statusKey('usurp-safeguard');
const KEY_FALSE_THRONE = statusKey('usurp-false-throne');

const ID_COUP = abilityId('usurp-coup');
const ID_HIJACK = abilityId('usurp-hijack');
const ID_SIPHON = abilityId('usurp-siphon-mandate');
const ID_VIGOR = abilityId('usurp-stolen-vigor');

// ── statuses ──

const STOLEN_ARCANA: StatusDef = {
  label: 'Stolen Arcana',
  desc: 'Increases damage dealt by 12% for 2 rounds.',
  ops: [{ op: 'share', on: 'dealt', pct: 12 }],
};

const USURPED: StatusDef = {
  label: 'Usurped',
  desc: 'Deals 10% less damage and takes 10% more damage for 2 rounds.',
  ops: [
    { op: 'share', on: 'dealt', pct: -10 },
    { op: 'share', on: 'taken', pct: 10 },
  ],
};

const PHANTOM_USURPED: StatusDef = {
  label: 'Phantom Usurped',
  desc: 'Deals 10% less damage, takes 10% more damage, and attacks against this target crit on 2 more die faces for 2 rounds.',
  ops: [
    { op: 'share', on: 'dealt', pct: -10 },
    { op: 'share', on: 'taken', pct: 10 },
    { op: 'sheet', key: 'exposed', amount: 2 },
  ],
};

const BROKEN_CROWN: StatusDef = {
  label: 'Broken Crown',
  desc: 'Speed reduced by 15% and attacks against this target crit on 1 more die face for 2 rounds.',
  ops: [
    { op: 'speed', pct: -15 },
    { op: 'sheet', key: 'exposed', amount: 1 },
  ],
};

// Dedicated 1-round safeguard status matching R.fight.kit.wardRounds (1 round).
const USURPER_WARD: StatusDef = {
  label: 'Usurper Ward',
  desc: 'Blocks harmful statuses from foes and adds 12 armor for 1 round.',
  ops: [
    { op: 'safeguard' },
    { op: 'sheet', key: 'armor', amount: { kind: 'number', value: 12 } },
  ],
};

// Dedicated 1-round invulnerable status (once per fight via warded) kept separate from Usurper Ward so later casts still safeguard.
const FALSE_THRONE_WARD: StatusDef = {
  label: 'False Throne Ward',
  desc: 'Cannot drop below 1 HP for 1 round (once per fight).',
  ops: [{ op: 'invulnerable' }],
};

function makeStolenCrown(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly armorFlat: number;
  readonly dealtPct: number;
  readonly hijackHeal: string;
  readonly phantomFormula: string;
  readonly fourthTrigger: Trigger;
}): ClassWorn {
  const ops: Op[] = [
    { op: 'sheet', key: 'armor', amount: { kind: 'number', value: o.armorFlat } },
    ...(o.dealtPct > 0 ? [{ op: 'share' as const, on: 'dealt' as const, pct: o.dealtPct }] : []),
  ];
  const triggers: Trigger[] = [
    // 1. Kill payoff: refund 60% action time and heal 10% of max HP (once a round, matching refund parser cap).
    {
      on: 'kill',
      tag: null,
      to: 'self',
      limit: ROUND,
      ops: [
        { op: 'refund', pct: 60 },
        { op: 'heal', when: 'use', amount: f('0.10 * hpmax') },
      ],
    },
    // 2. Hijack hit payoff: landing Hijack refunds 60% action time, heals self, restores mana, and eases fatigue once a round.
    {
      on: 'hitDealt',
      tag: TAG_HIJACK,
      to: 'self',
      limit: ROUND,
      ops: [
        { op: 'refund', pct: 60 },
        { op: 'heal', when: 'use', amount: f(o.hijackHeal) },
        { op: 'mana', when: 'use', amount: f('14') },
        { op: 'fatigue', when: 'use', amount: f('-10') },
      ],
    },
    // 3. Phantom Theft: avoiding a foe attack retaliates with arcane damage once a round.
    {
      on: 'avoided',
      tag: null,
      to: 'other',
      limit: ROUND,
      ops: [
        { op: 'damage', type: 'arcane', when: 'use', amount: f(o.phantomFormula) },
      ],
    },
    // 4. Base grants 2r Stolen Arcana (+12% dealt) on avoid; Capstone moves +12% dealt into ops and adds Crown Strip.
    o.fourthTrigger,
  ];
  return { key: o.key, def: { label: o.label, desc: o.desc, ops, triggers } };
}

const BASE_CROWN: ClassWorn = makeStolenCrown({
  key: KEY_CROWN,
  label: 'Stolen Crown',
  desc: 'Adds 4 armor. Defeating a foe refunds 60% of action time and heals 10% of max HP once a round. Landing Hijack refunds 60% of action time, heals 1% of max HP, restores 14 mana, and clears 10 fatigue once a round. Avoiding a foe attack deals arcane damage to the attacker and grants Stolen Arcana (+12% damage dealt for 2 rounds) once a round.',
  armorFlat: 4,
  dealtPct: 0,
  hijackHeal: '0.01 * hpmax',
  phantomFormula: '0.35 * mag + 0.25 * finesse',
  fourthTrigger: {
    on: 'avoided',
    tag: null,
    to: 'self',
    limit: ROUND,
    ops: [
      { op: 'applyStatus', key: KEY_STOLEN_ARCANA, def: STOLEN_ARCANA, duration: rounds(2) },
    ],
  },
});

const SOVEREIGN_CROWN: ClassWorn = makeStolenCrown({
  key: KEY_SOVEREIGN_CROWN,
  label: 'Crown of Stolen Power',
  desc: 'Adds 6 armor and 12% damage dealt. Defeating a foe refunds 60% of action time and heals 10% of max HP once a round. Landing Hijack refunds 60% of action time, heals 2% of max HP, restores 14 mana, and clears 10 fatigue once a round. Avoiding a foe attack deals stronger arcane damage once a round. Imposing a harmful status restores 10 mana and clears 8 fatigue once a round.',
  armorFlat: 6,
  dealtPct: 12,
  hijackHeal: '0.02 * hpmax',
  phantomFormula: '0.45 * mag + 0.35 * finesse',
  fourthTrigger: {
    on: 'imposed',
    tag: null,
    to: 'self',
    limit: ROUND,
    ops: [
      { op: 'mana', when: 'use', amount: f('10') },
      { op: 'fatigue', when: 'use', amount: f('-8') },
    ],
  },
});

// ── active ability builders ──

function makeCoup(o: {
  readonly name: string;
  readonly rangeTiles: number;
  readonly formula: string;
  readonly statusKey: StatusKey;
  readonly statusDef: StatusDef;
  readonly actionCost: number;
}): Ability {
  const base = abilityOf('strike', {
    id: ID_COUP,
    name: o.name,
    aim: 'place',
    range: tiles(o.rangeTiles),
    shape: { kind: 'radius', radius: tiles(1), ring: null },
    delivery: { kind: 'travel', windup: tick(100), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'applyStatus', key: o.statusKey, def: o.statusDef, duration: rounds(2) },
    ],
  }, R);
  return {
    ...base,
    move: { kind: 'blink' },
    cost: { ...base.cost, mana: 5, fatigue: 2, time: cost(o.actionCost), cooldown: rounds(1) },
  };
}

function makeHijack(o: {
  readonly name: string;
  readonly amp: number;
  readonly cooldownRounds: number;
}): Ability {
  const base = abilityOf('curse', {
    id: ID_HIJACK,
    name: o.name,
    aim: 'foe',
    range: tiles(7),
    shape: { kind: 'touch', reach: tiles(7) },
    delivery: { kind: 'direct' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f('1d8 + 0.50 * mag + 0.40 * finesse') },
    ops: [
      { op: 'stagger', share: 0.10 },
    ],
  }, R);
  return {
    ...base,
    tags: [TAG_HIJACK],
    usurp: { amp: o.amp },
    cost: { ...base.cost, mana: 8, fatigue: 3, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeSiphonMandate(o: {
  readonly name: string;
  readonly dispelWhich: 'first' | 'all';
  readonly staggerShare: number;
  readonly breakChannel?: true;
}): Ability {
  const ops: UseOp[] = [
    { op: 'dispel', which: o.dispelWhich, kind: 'helpful' },
    ...(o.breakChannel ? [{ op: 'channel' as const, mode: 'break' as const }] : []),
    { op: 'stagger', share: o.staggerShare },
    { op: 'applyStatus', key: KEY_BROKEN_CROWN, def: BROKEN_CROWN, duration: rounds(2) },
  ];
  const base = abilityOf('curse', {
    id: ID_SIPHON,
    name: o.name,
    aim: 'foe',
    range: tiles(7),
    shape: { kind: 'touch', reach: tiles(7) },
    delivery: { kind: 'direct' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f('1d8 + 0.98 * mag + 0.78 * finesse') },
    ops,
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 5, fatigue: 2, time: cost(R.fight.cost.quick), cooldown: rounds(1) },
  };
}

function makeStolenVigor(o: {
  readonly name: string;
  readonly healFormula: string;
  readonly shieldFormula: string;
  readonly invulnerable?: true;
}): Ability {
  const ops: UseOp[] = [
    { op: 'shield', amount: f(o.shieldFormula) },
    { op: 'dispel', which: 'first' },
    { op: 'applyStatus', key: KEY_WARD, def: USURPER_WARD, duration: rounds(R.fight.kit.wardRounds) },
    ...(o.invulnerable
      ? [{ op: 'applyStatus' as const, key: KEY_FALSE_THRONE, def: FALSE_THRONE_WARD, duration: rounds(R.fight.kit.wardRounds) }]
      : []),
  ];
  const base = abilityOf('support', {
    id: ID_VIGOR,
    name: o.name,
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'heal', by: 'hand', formula: f(o.healFormula) },
    ops,
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 6, fatigue: 2, time: cost(R.fight.cost.quick), cooldown: rounds(4) },
  };
}

const BASE_COUP = makeCoup({
  name: 'Coup',
  rangeTiles: 5,
  formula: '1d8 + 0.42 * mag + 0.32 * finesse',
  statusKey: KEY_USURPED,
  statusDef: USURPED,
  actionCost: R.fight.cost.quick,
});

const UP_COUP_PHANTOM = makeCoup({
  name: 'Coup: Phantom Coup',
  rangeTiles: 6,
  formula: '1d8 + 0.42 * mag + 0.32 * finesse',
  statusKey: KEY_PHANTOM_USURPED,
  statusDef: PHANTOM_USURPED,
  actionCost: R.fight.cost.quick,
});

const UP_COUP_FLURRY = makeCoup({
  name: 'Coup: Flurry Coup',
  rangeTiles: 5,
  formula: '1d8 + 0.42 * mag + 0.62 * finesse',
  statusKey: KEY_USURPED,
  statusDef: USURPED,
  actionCost: Math.round(R.fight.cost.quick * 0.85),
});

const BASE_HIJACK = makeHijack({
  name: 'Hijack',
  amp: 1.25,
  cooldownRounds: 3,
});

const UP_HIJACK_GRAND = makeHijack({
  name: 'Hijack: Grand Hijack',
  amp: 1.50,
  cooldownRounds: 3,
});

const UP_HIJACK_ECHO = makeHijack({
  name: 'Hijack: Echo Hijack',
  amp: 1.25,
  cooldownRounds: 2,
});

const BASE_SIPHON = makeSiphonMandate({
  name: 'Siphon Mandate',
  dispelWhich: 'first',
  staggerShare: 0.08,
});

const UP_SIPHON_IMPERIAL = makeSiphonMandate({
  name: 'Siphon Mandate: Imperial Siphon',
  dispelWhich: 'all',
  staggerShare: 0.08,
});

const UP_SIPHON_NULL = makeSiphonMandate({
  name: 'Siphon Mandate: Null Mandate',
  dispelWhich: 'first',
  staggerShare: 0.25,
  breakChannel: true,
});

const BASE_VIGOR = makeStolenVigor({
  name: 'Stolen Vigor',
  healFormula: '0.14 * hpmax',
  shieldFormula: '0.18 * hpmax',
});

const UP_VIGOR_SOVEREIGN = makeStolenVigor({
  name: 'Stolen Vigor: Sovereign Vigor',
  healFormula: '0.20 * hpmax',
  shieldFormula: '0.24 * hpmax',
});

const UP_VIGOR_THRONE = makeStolenVigor({
  name: 'Stolen Vigor: False Throne',
  healFormula: '0.14 * hpmax',
  shieldFormula: '0.18 * hpmax',
  invulnerable: true,
});

/** Base Usurper signature (before skill-tree nodes are folded on top). */
export const USURPER_SIGNATURE: ClassSignature = {
  className: 'Usurper',
  bonus: { agi: 3, pow: 3, manaMax: 30, will: 15 },
  worn: BASE_CROWN,
  actives: [BASE_COUP, BASE_HIJACK, BASE_SIPHON, BASE_VIGOR],
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

/** Full 9-depth, 3-branch, 32-buyable (38-node) Mythic Usurper skill tree. */
export const USURPER_TREE: ClassTree = {
  className: 'Usurper',
  rarity: 'mythic',
  nodes: [
    // Depth 1: Root (1)
    node('usurp-root', 1, 'Usurper Awakening', 'Gain 2 Agility, 2 Power, and 10 max mana.', [], [
      bonus({ agi: 2, pow: 2, manaMax: 10 }),
    ]),

    // Depth 2: Three branches (3) — Coup (a), Hijack (b), Mandate (c)
    node('usurp-a2', 2, 'Vaulting Stride', 'Gain 3 Agility and 4 speed.', ['usurp-root'], [
      bonus({ agi: 3, speed: 4 }),
    ]),
    node('usurp-b2', 2, 'Arcane Larceny', 'Gain 3 Power and 10 max mana.', ['usurp-root'], [
      bonus({ pow: 3, manaMax: 10 }),
    ]),
    node('usurp-c2', 2, 'Mandate Frame', 'Gain 8 max HP and 4 tenacity.', ['usurp-root'], [
      bonus({ hpMax: 8, tenacity: 4 }),
    ]),

    // Depth 3: Branch splits (6)
    node('usurp-a3x', 3, 'Phantom Footing', 'Gain 3 Agility and 4 speed.', ['usurp-a2'], [
      bonus({ agi: 3, speed: 4 }),
    ]),
    node('usurp-a3y', 3, 'Lethal Lunge', 'Gain 3 Agility and 6 Accuracy.', ['usurp-a2'], [
      bonus({ agi: 3, aim: 6 }),
    ]),
    node('usurp-b3x', 3, 'Stolen Piercing', 'Gain 3 Power, 12% magic penetration, and 10 flat magic penetration.', ['usurp-b2'], [
      bonus({ pow: 3, resistPen: 12, resistPenFlat: 10 }),
    ]),
    node('usurp-b3y', 3, 'Siphoned Well', 'Gain 3 Power and 15 max mana.', ['usurp-b2'], [
      bonus({ pow: 3, manaMax: 15 }),
    ]),
    node('usurp-c3x', 3, 'Gilded Guard', 'Gain 8 max HP and 4 tenacity.', ['usurp-c2'], [
      bonus({ hpMax: 8, tenacity: 4 }),
    ]),
    node('usurp-c3y', 3, 'Usurping Decree', 'Gain 6 potency and 4 ability haste.', ['usurp-c2'], [
      bonus({ potency: 6, haste: 4 }),
    ]),

    // Depth 4: Deepening (6)
    node('usurp-a4x', 4, 'Mirage Step', 'Gain 3 Agility and 4 ability haste.', ['usurp-a3x'], [
      bonus({ agi: 3, haste: 4 }),
    ]),
    node('usurp-a4y', 4, 'Seized Opening', 'Gain 3 Agility and 0.06 crit multiplier.', ['usurp-a3y'], [
      bonus({ agi: 3, critSize: 6 }),
    ]),
    node('usurp-b4x', 4, 'Crown Breaker', 'Gain 3 Power, 12% magic penetration, and 10 flat magic penetration.', ['usurp-b3x'], [
      bonus({ pow: 3, resistPen: 12, resistPenFlat: 10 }),
    ]),
    node('usurp-b4y', 4, 'Borrowed Surge', 'Gain 3 Power and 4 ability haste.', ['usurp-b3y'], [
      bonus({ pow: 3, haste: 4 }),
    ]),
    node('usurp-c4x', 4, 'Stolen Resilience', 'Gain 8 max HP and 6 potency.', ['usurp-c3x'], [
      bonus({ hpMax: 8, potency: 6 }),
    ]),
    node('usurp-c4y', 4, 'Sovereign Focus', 'Gain 5 tenacity and 6 Accuracy.', ['usurp-c3y'], [
      bonus({ tenacity: 5, aim: 6 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('usurp-a5-l', 5, 'Phantom Coup', 'Upgrade Coup to range 6 and add 2 extra crit faces on caught foes for 2 rounds.', ['usurp-a4x', 'usurp-a4y'], [
      replaceActive(ID_COUP, UP_COUP_PHANTOM),
    ], { forkGroup: 'usurp-a5' }),
    node('usurp-a5-r', 5, 'Flurry Coup', 'Upgrade Coup to scale with 62% finesse and take 15% less action time.', ['usurp-a4x', 'usurp-a4y'], [
      replaceActive(ID_COUP, UP_COUP_FLURRY),
    ], { forkGroup: 'usurp-a5' }),

    node('usurp-b5-l', 5, 'Grand Hijack', 'Upgrade Hijack so the copied move deals 150% power.', ['usurp-b4x', 'usurp-b4y'], [
      replaceActive(ID_HIJACK, UP_HIJACK_GRAND),
    ], { forkGroup: 'usurp-b5' }),
    node('usurp-b5-r', 5, 'Echo Hijack', 'Upgrade Hijack to a 2-round cooldown.', ['usurp-b4x', 'usurp-b4y'], [
      replaceActive(ID_HIJACK, UP_HIJACK_ECHO),
    ], { forkGroup: 'usurp-b5' }),

    node('usurp-c5-l', 5, 'Imperial Siphon', 'Upgrade Siphon Mandate to remove every helpful status on the target.', ['usurp-c4x', 'usurp-c4y'], [
      replaceActive(ID_SIPHON, UP_SIPHON_IMPERIAL),
    ], { forkGroup: 'usurp-c5' }),
    node('usurp-c5-r', 5, 'Null Mandate', 'Upgrade Siphon Mandate to break enemy channels and deal 25% stagger.', ['usurp-c4x', 'usurp-c4y'], [
      replaceActive(ID_SIPHON, UP_SIPHON_NULL),
    ], { forkGroup: 'usurp-c5' }),

    // Depth 6: Post-fork convergence (6)
    node('usurp-a6x', 6, 'Wraith Agility', 'Gain 3 Agility and 4 speed.', ['usurp-a5-l', 'usurp-a5-r'], [
      bonus({ agi: 3, speed: 4 }),
    ], { parentMode: 'any' }),
    node('usurp-a6y', 6, 'Claimed Edge', 'Gain 3 Agility and 1 extra crit face.', ['usurp-a5-l', 'usurp-a5-r'], [
      bonus({ agi: 3, critFaces: 1 }),
    ], { parentMode: 'any' }),
    node('usurp-b6x', 6, 'Riven Ward', 'Gain 3 Power, 12% magic penetration, and 10 flat magic penetration.', ['usurp-b5-l', 'usurp-b5-r'], [
      bonus({ pow: 3, resistPen: 12, resistPenFlat: 10 }),
    ], { parentMode: 'any' }),
    node('usurp-b6y', 6, 'Stolen Cadence', 'Gain 4 ability haste and 4 speed.', ['usurp-b5-l', 'usurp-b5-r'], [
      bonus({ haste: 4, speed: 4 }),
    ], { parentMode: 'any' }),
    node('usurp-c6x', 6, 'Usurped Bastion', 'Gain 8 max HP and 5 tenacity.', ['usurp-c5-l', 'usurp-c5-r'], [
      bonus({ hpMax: 8, tenacity: 5 }),
    ], { parentMode: 'any' }),
    node('usurp-c6y', 6, 'Imperial Bearing', 'Gain 6 potency and 5 ability haste.', ['usurp-c5-l', 'usurp-c5-r'], [
      bonus({ potency: 6, haste: 5 }),
    ], { parentMode: 'any' }),

    // Depth 7: Second Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('usurp-a7-l', 7, 'Sovereign Vigor', 'Upgrade Stolen Vigor to heal 20% of max HP and shield for 24% of max HP.', ['usurp-a6x', 'usurp-a6y'], [
      replaceActive(ID_VIGOR, UP_VIGOR_SOVEREIGN),
    ], { forkGroup: 'usurp-a7' }),
    node('usurp-a7-r', 7, 'False Throne', 'Upgrade Stolen Vigor to also grant False Throne Ward so you cannot drop below 1 HP for 1 round (once per fight).', ['usurp-a6x', 'usurp-a6y'], [
      replaceActive(ID_VIGOR, UP_VIGOR_THRONE),
    ], { forkGroup: 'usurp-a7' }),

    node('usurp-b7-l', 7, 'Throne Seizer', 'Gain 4 Agility and deal up to 18% more damage to foes above half HP.', ['usurp-b6x', 'usurp-b6y'], [
      bonus({ agi: 4 }),
      scaler({ measure: 'target', dir: 'over', start: 0.5, scale: 0.18 }),
    ], { forkGroup: 'usurp-b7' }),
    node('usurp-b7-r', 7, 'Regicide Edge', 'Gain 4 Power and deal up to 18% more damage to foes with higher max HP than you.', ['usurp-b6x', 'usurp-b6y'], [
      bonus({ pow: 4 }),
      scaler({ measure: 'maxPair', dir: 'over', start: 0.5, scale: 0.18 }),
    ], { forkGroup: 'usurp-b7' }),

    node('usurp-c7-l', 7, 'Phantom Bulwark', 'Gain 8 max HP, 17 Will, and 4 tenacity.', ['usurp-c6x', 'usurp-c6y'], [
      bonus({ hpMax: 8, will: 17, tenacity: 4 }),
    ], { forkGroup: 'usurp-c7' }),
    node('usurp-c7-r', 7, 'Stolen Tempo', 'Gain 15 speed and 8 max HP.', ['usurp-c6x', 'usurp-c6y'], [
      bonus({ speed: 15, hpMax: 8 }),
    ], { forkGroup: 'usurp-c7' }),

    // Depth 8: Branch Capstones (3)
    node('usurp-a8', 8, 'Shadowed Coup', 'Gain 4 Agility, 0.08 crit multiplier, and 4 Accuracy.', ['usurp-a7-l', 'usurp-a7-r'], [
      bonus({ agi: 4, critSize: 8, aim: 4 }),
    ], { parentMode: 'any' }),
    node('usurp-b8', 8, 'Stolen Dominion', 'Gain 4 Power and 4 ability haste.', ['usurp-b7-l', 'usurp-b7-r'], [
      bonus({ pow: 4, haste: 4 }),
    ], { parentMode: 'any' }),
    node('usurp-c8', 8, 'Throne Poise', 'Gain 6 potency and 4 tenacity.', ['usurp-c7-l', 'usurp-c7-r'], [
      bonus({ potency: 6, tenacity: 4 }),
    ], { parentMode: 'any' }),

    // Depth 9: Monarch Capstone (1)
    node('usurp-cap', 9, 'Crown of Stolen Power', 'Upgrade Stolen Crown to Crown of Stolen Power and gain 5 Agility, 4 Power, and 20 Will.', ['usurp-a8', 'usurp-b8', 'usurp-c8'], [
      replaceWorn(KEY_CROWN, SOVEREIGN_CROWN),
      bonus({ agi: 5, pow: 4, will: 20 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
