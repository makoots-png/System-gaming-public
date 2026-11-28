// class-nullweaver.ts: Mythic Nullweaver (ins+pow) signature kit and full 38-node / 32-buyable skill tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
// Single Unraveled definition (`null-unraveled`) is shared across all actives, worn triggers, Counter-Unravel's
// Unraveling Ward, and the capstone (Finding 5). Sever Magic uses Hook 2 helpful dispel; Erase Field uses Hook 3 zone erase.
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId, tag } from '../combat/ability-types.ts';
import type { Ability, AbilityId, ZoneAct } from '../combat/ability-types.ts';
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
  if (!id) throw new Error(`Invalid Nullweaver node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Nullweaver formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };

const TAG_ERASE_FIELD = tag('erase-field');

const KEY_THREAD = statusKey('null-thread');
const KEY_WEAVER = statusKey('null-weaver');
const KEY_UNRAVELED = statusKey('null-unraveled');
const KEY_SILENCED = statusKey('null-silenced-thread');
const KEY_SPELL_LOCK = statusKey('null-spell-lock');
const KEY_ERASE_DRAG = statusKey('null-erase-drag');
const KEY_COUNTER_WARD = statusKey('null-counter-ward');

const ID_UNRAVEL = abilityId('null-unravel');
const ID_SEVER = abilityId('null-sever-magic');
const ID_ERASE = abilityId('null-erase-field');
const ID_AEGIS = abilityId('null-aegis');

// ── statuses ──

// Single Unraveled def shared across Unravel, Erase Field, Void Reprisal, Unraveling Ward, and Weaver of the Null.
const UNRAVELED: StackDef = {
  label: 'Unraveled',
  desc: 'Each stack reduces damage dealt by 4%, increases damage taken by 5%, and lowers magic resist by 4 (up to 4 stacks). At 4 stacks, all stacks are spent for arcane damage and 20% stagger.',
  ops: [
    { op: 'share', on: 'dealt', pct: -4 },
    { op: 'share', on: 'taken', pct: 5 },
    { op: 'sheet', key: 'resist', amount: { kind: 'number', value: -4 } },
  ],
  stack: {
    cap: 4,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: {
      at: { kind: 'count', n: 4 },
      to: { kind: 'bearer' },
      then: 'spend',
      ops: [
        { op: 'damage', type: 'arcane', when: 'use', amount: f('2d8 + 0.75 * mag + 1.5 * (ins / 10)^0.8') },
        { op: 'stagger', share: 0.20 },
      ],
    },
  },
};

const SILENCED_THREAD: StatusDef = {
  label: 'Silenced Thread',
  desc: 'Rooted in place and deals 15% less damage for 1 round.',
  ops: [
    { op: 'root' },
    { op: 'share', on: 'dealt', pct: -15 },
  ],
};

const SPELL_LOCKED: StatusDef = {
  label: 'Spell-Locked',
  desc: 'Stunned and deals 15% less damage for 1 round.',
  ops: [
    { op: 'hold' },
    { op: 'share', on: 'dealt', pct: -15 },
  ],
};

const ERASE_DRAG: StatusDef = {
  label: 'Null Drag',
  desc: 'Speed reduced by 15% for 2 rounds.',
  ops: [{ op: 'speed', pct: -15 }],
};

// Applied to self by Counter-Unravel (D5 Null fork) so the retaliation fires on `avoided` targeting `other` (Finding 5).
const UNRAVELING_WARD: StatusDef = {
  label: 'Unraveling Ward',
  desc: 'Once a round for 1 round, avoiding a foe attack retaliates with arcane damage and applies 1 stack of Unraveled for 2 rounds.',
  ops: [],
  triggers: [
    {
      on: 'avoided',
      tag: null,
      to: 'other',
      limit: ROUND,
      ops: [
        { op: 'damage', type: 'arcane', when: 'use', amount: f('1.0 * mag + 2.0 * (ins / 10)^0.8') },
        { op: 'applyStatus', key: KEY_UNRAVELED, def: UNRAVELED, duration: rounds(2) },
      ],
    },
  ],
};

function makeThreadOfUnmaking(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly armorFlat: number;
  readonly resistFlat: number;
  readonly takenPct: number;
  readonly dealtPct: number;
  readonly siphonMana: string;
  readonly siphonHeal: string;
  readonly wardShield: string;
  readonly reprisalDamage: string;
  readonly nullEcho?: { readonly shield: string; readonly refundPct: number };
}): ClassWorn {
  const ops: Op[] = [
    ...(o.armorFlat > 0 ? [{ op: 'sheet' as const, key: 'armor' as const, amount: { kind: 'number' as const, value: o.armorFlat } }] : []),
    { op: 'sheet', key: 'resist', amount: { kind: 'number', value: o.resistFlat } },
    { op: 'share', on: 'taken', pct: o.takenPct },
    ...(o.dealtPct > 0 ? [{ op: 'share' as const, on: 'dealt' as const, pct: o.dealtPct }] : []),
  ];
  const triggers: Trigger[] = [
    // 1. Unravel Siphon: turn start restores mana and HP.
    {
      on: 'turnStart',
      to: 'self',
      limit: EACH,
      ops: [
        { op: 'mana', when: 'use', amount: f(o.siphonMana) },
        { op: 'heal', when: 'use', amount: f(o.siphonHeal) },
      ],
    },
    // 2. Spellbreak Ward: imposing a harmful status shields self once per round.
    {
      on: 'imposed',
      tag: null,
      to: 'self',
      limit: ROUND,
      ops: [{ op: 'shield', amount: f(o.wardShield) }],
    },
    // 3. Void Reprisal: avoiding a foe attack deals arcane damage and applies 1 stack of Unraveled.
    {
      on: 'avoided',
      tag: null,
      to: 'other',
      limit: ROUND,
      ops: [
        { op: 'damage', type: 'arcane', when: 'use', amount: f(o.reprisalDamage) },
        { op: 'applyStatus', key: KEY_UNRAVELED, def: UNRAVELED, duration: rounds(3) },
      ],
    },
    // 4. Null Echo (Capstone): casting Erase Field shields self and refunds action time once a round.
    ...(o.nullEcho
      ? [{
        on: 'used' as const,
        tag: TAG_ERASE_FIELD,
        to: 'self' as const,
        limit: ROUND,
        ops: [
          { op: 'shield' as const, amount: f(o.nullEcho.shield) },
          { op: 'refund' as const, pct: o.nullEcho.refundPct },
        ],
      }]
      : []),
  ];
  return { key: o.key, def: { label: o.label, desc: o.desc, ops, triggers } };
}

const BASE_THREAD: ClassWorn = makeThreadOfUnmaking({
  key: KEY_THREAD,
  label: 'Thread of Unmaking',
  desc: 'Adds 22 armor and 2 magic resist, and reduces damage taken by 2%. At the start of each turn, recover 6 mana and 1% of max HP. Imposing a harmful status shields you for 2% of max HP once a round. Avoiding a foe attack deals arcane damage and applies 1 stack of Unraveled once a round.',
  armorFlat: 22,
  resistFlat: 2,
  takenPct: -2,
  dealtPct: 0,
  siphonMana: '6',
  siphonHeal: '0.01 * hpmax',
  wardShield: '0.02 * hpmax',
  reprisalDamage: '0.6 * mag',
});

const WEAVER_THREAD: ClassWorn = makeThreadOfUnmaking({
  key: KEY_WEAVER,
  label: 'Weaver of the Null',
  desc: 'Adds 34 armor and 2 magic resist, reduces damage taken by 3%, and increases damage dealt by 6%. Turn start restores 8 mana and 1% of max HP. Imposing a harmful status shields you for 3% of max HP once a round. Avoiding a foe attack deals stronger arcane damage and applies Unraveled once a round. Casting Erase Field shields you for 4% of max HP and refunds 15% of its action time once a round.',
  armorFlat: 34,
  resistFlat: 2,
  takenPct: -3,
  dealtPct: 6,
  siphonMana: '8',
  siphonHeal: '0.01 * hpmax',
  wardShield: '0.03 * hpmax',
  reprisalDamage: '0.75 * mag',
  nullEcho: { shield: '0.04 * hpmax', refundPct: 15 },
});

// ── active ability builders ──

function makeUnravel(o: {
  readonly name: string;
  readonly formula: string;
  readonly stacks?: number;
}): Ability {
  const applyOp: UseOp = o.stacks && o.stacks > 1
    ? { op: 'applyStatus', key: KEY_UNRAVELED, def: UNRAVELED, duration: rounds(3), stacks: o.stacks }
    : { op: 'applyStatus', key: KEY_UNRAVELED, def: UNRAVELED, duration: rounds(3) };
  const base = abilityOf('curse', {
    id: ID_UNRAVEL,
    name: o.name,
    desc: o.stacks && o.stacks > 1
      ? `Deal arcane damage to a foe within 8 tiles and apply ${o.stacks} stacks of Unraveled for 3 rounds.`
      : 'Deal arcane damage to a foe within 8 tiles and apply Unraveled for 3 rounds.',
    aim: 'foe',
    range: tiles(8),
    shape: { kind: 'touch', reach: tiles(8) },
    delivery: { kind: 'direct' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops: [applyOp],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 6, fatigue: 5, time: cost(R.fight.cost.standard), cooldown: rounds(0) },
  };
}

function makeSeverMagic(o: {
  readonly name: string;
  readonly formula: string;
  readonly dispelWhich: 'first' | 'all';
  readonly controlKey: StatusKey;
  readonly controlDef: StatusDef;
  readonly cooldownRounds: number;
}): Ability {
  const base = abilityOf('curse', {
    id: ID_SEVER,
    name: o.name,
    desc: o.dispelWhich === 'all'
      ? `Quick arcane strike within 8 tiles that strips all helpful statuses, breaks channeling, fills 25% stagger, and applies ${o.controlDef.label} for 1 round.`
      : `Quick arcane strike within 8 tiles that strips one helpful status, breaks channeling, fills 25% stagger, and applies ${o.controlDef.label} for 1 round.`,
    aim: 'foe',
    range: tiles(8),
    shape: { kind: 'touch', reach: tiles(8) },
    delivery: { kind: 'direct' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'dispel', which: o.dispelWhich, kind: 'helpful' },
      { op: 'channel', mode: 'break' },
      { op: 'stagger', share: 0.25 },
      { op: 'applyStatus', key: o.controlKey, def: o.controlDef, duration: rounds(1) },
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 10, fatigue: 6, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeEraseField(o: {
  readonly name: string;
  readonly formula: string;
  readonly eraseCount: number;
  readonly staggerShare?: number;
}): Ability {
  const ops: UseOp[] = [
    { op: 'applyStatus', key: KEY_UNRAVELED, def: UNRAVELED, duration: rounds(3), stacks: 2 },
    { op: 'applyStatus', key: KEY_ERASE_DRAG, def: ERASE_DRAG, duration: rounds(2) },
    ...(o.staggerShare ? [{ op: 'stagger' as const, share: o.staggerShare }] : []),
  ];
  const zoneAct: ZoneAct = { act: 'erase', name: null, by: o.eraseCount };
  const base = abilityOf('blast', {
    id: ID_ERASE,
    name: o.name,
    desc: o.staggerShare
      ? `Blast a 3-tile area within 8 tiles for arcane damage, erase up to ${o.eraseCount} zones, apply 2 stacks of Unraveled and Arcane Drag, and fill ${Math.round(o.staggerShare * 100)}% stagger.`
      : `Blast a 3-tile area within 8 tiles for arcane damage, erase ${o.eraseCount} zone, and apply 2 stacks of Unraveled and Arcane Drag.`,
    aim: 'place',
    range: tiles(8),
    shape: { kind: 'radius', radius: tiles(3), ring: null },
    delivery: { kind: 'travel', windup: tick(300), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops,
  }, R);
  return {
    ...base,
    tags: [TAG_ERASE_FIELD],
    zoneAct,
    cost: { ...base.cost, mana: 12, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(2) },
  };
}

function makeNullAegis(o: {
  readonly name: string;
  readonly reachTiles: number;
  readonly shieldFormula: string;
  readonly manaRestore: number;
  readonly cooldownRounds: number;
  readonly counterWard?: true;
}): Ability {
  const ops: UseOp[] = [
    { op: 'negate' },
    { op: 'mana', when: 'use', amount: f(String(o.manaRestore)) },
    ...(o.counterWard ? [{ op: 'applyStatus' as const, key: KEY_COUNTER_WARD, def: UNRAVELING_WARD, duration: rounds(1) }] : []),
  ];
  const base = abilityOf('support', {
    id: ID_AEGIS,
    name: o.name,
    desc: o.counterWard
      ? `Reaction. Negate an incoming hit on yourself, shield yourself, restore ${o.manaRestore} mana, and gain Unraveling Ward for 1 round.`
      : `Reaction. Negate an incoming hit within ${o.reachTiles} tiles, shield yourself, and restore ${o.manaRestore} mana.`,
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
    react: { when: 'before', reach: tiles(o.reachTiles) },
    cost: { ...base.cost, mana: 10, fatigue: 4, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds) },
  };
}

const BASE_UNRAVEL = makeUnravel({
  name: 'Unravel',
  formula: '1d10 + 0.85 * mag + 2.0 * (ins / 10)^0.8',
});

const UP_UNRAVEL_FRAYING = makeUnravel({
  name: 'Unravel: Fraying Weave',
  formula: '1d10 + 0.85 * mag + 2.0 * (ins / 10)^0.8',
  stacks: 2,
});

const UP_UNRAVEL_SEVERED = makeUnravel({
  name: 'Unravel: Severed Thread',
  formula: '1d10 + 0.95 * mag + 2.5 * (ins / 10)^0.8',
});

const BASE_SEVER = makeSeverMagic({
  name: 'Sever Magic',
  formula: '1d8 + 0.75 * mag + 1.6 * (ins / 10)^0.8',
  dispelWhich: 'first',
  controlKey: KEY_SILENCED,
  controlDef: SILENCED_THREAD,
  cooldownRounds: 2,
});

const UP_SEVER_PURGE = makeSeverMagic({
  name: 'Sever Magic: Total Purge',
  formula: '1d8 + 0.75 * mag + 1.6 * (ins / 10)^0.8',
  dispelWhich: 'all',
  controlKey: KEY_SILENCED,
  controlDef: SILENCED_THREAD,
  cooldownRounds: 2,
});

const UP_SEVER_LOCK = makeSeverMagic({
  name: 'Sever Magic: Spell-Lock',
  formula: '1d8 + 0.75 * mag + 1.6 * (ins / 10)^0.8',
  dispelWhich: 'first',
  controlKey: KEY_SPELL_LOCK,
  controlDef: SPELL_LOCKED,
  cooldownRounds: 3,
});

const BASE_ERASE = makeEraseField({
  name: 'Erase Field',
  formula: '2d8 + 0.80 * mag + 1.8 * (ins / 10)^0.8',
  eraseCount: 1,
});

const UP_ERASE_HORIZON = makeEraseField({
  name: 'Erase Field: Null Horizon',
  formula: '2d8 + 0.80 * mag + 1.8 * (ins / 10)^0.8',
  eraseCount: 2,
  staggerShare: 0.28,
});

const UP_ERASE_COLLAPSE = makeEraseField({
  name: 'Erase Field: Rift Collapse',
  formula: '2d8 + 0.80 * mag + 1.8 * (ins / 10)^0.8 + 0.35 * mag * target.stacks(null-unraveled)',
  eraseCount: 1,
});

const BASE_AEGIS = makeNullAegis({
  name: 'Null Aegis',
  reachTiles: 4,
  shieldFormula: '0.10 * hpmax',
  manaRestore: 10,
  cooldownRounds: 5,
});

const UP_AEGIS_SANCTUARY = makeNullAegis({
  name: 'Null Aegis: Sanctuary Negate',
  reachTiles: 6,
  shieldFormula: '0.14 * hpmax',
  manaRestore: 12,
  cooldownRounds: 5,
});

const UP_AEGIS_COUNTER = makeNullAegis({
  name: 'Null Aegis: Counter-Unravel',
  reachTiles: 0,
  shieldFormula: '0.10 * hpmax',
  manaRestore: 10,
  cooldownRounds: 5,
  counterWard: true,
});

/** Base Nullweaver signature (before skill-tree nodes are folded on top). */
export const NULLWEAVER_SIGNATURE: ClassSignature = {
  className: 'Nullweaver',
  bonus: { ins: 3, pow: 3, manaMax: 35 },
  worn: BASE_THREAD,
  actives: [BASE_UNRAVEL, BASE_SEVER, BASE_ERASE, BASE_AEGIS],
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

/** Full 9-depth, 3-branch, 32-buyable (38-node) Mythic Nullweaver skill tree. */
export const NULLWEAVER_TREE: ClassTree = {
  className: 'Nullweaver',
  rarity: 'mythic',
  nodes: [
    // Depth 1: Root (1)
    node('null-root', 1, 'Null Awakening', 'Gain 2 Instinct, 2 Power, and 10 max mana.', [], [
      bonus({ ins: 2, pow: 2, manaMax: 10 }),
    ]),

    // Depth 2: Three branches (3) — Unravel (a), Sever (b), Null (c)
    node('null-a2', 2, 'Unmaking Eye', 'Gain 3 Instinct and 5 max mana.', ['null-root'], [
      bonus({ ins: 3, manaMax: 5 }),
    ]),
    node('null-b2', 2, 'Spellbreaker Edge', 'Gain 3 Power and 4 ability haste.', ['null-root'], [
      bonus({ pow: 3, haste: 4 }),
    ]),
    node('null-c2', 2, 'Blank Shroud', 'Gain 10 max HP and 4 Will.', ['null-root'], [
      bonus({ hpMax: 10, will: 4 }),
    ]),

    // Depth 3: Branch splits (6)
    node('null-a3x', 3, 'Frayed Seam', 'Gain 3 Instinct and 3 flat magic penetration.', ['null-a2'], [
      bonus({ ins: 3, resistPenFlat: 3 }),
    ]),
    node('null-a3y', 3, 'Null Reservoir', 'Gain 3 Power and 10 max mana.', ['null-a2'], [
      bonus({ pow: 3, manaMax: 10 }),
    ]),
    node('null-b3x', 3, 'Disrupting Cast', 'Gain 3 Power and 4 potency.', ['null-b2'], [
      bonus({ pow: 3, potency: 4 }),
    ]),
    node('null-b3y', 3, 'Quick Sever', 'Gain 4 ability haste and 3 speed.', ['null-b2'], [
      bonus({ haste: 4, speed: 3 }),
    ]),
    node('null-c3x', 3, 'Hollow Frame', 'Gain 10 max HP and 4 tenacity.', ['null-c2'], [
      bonus({ hpMax: 10, tenacity: 4 }),
    ]),
    node('null-c3y', 3, 'Clear Sense', 'Gain 4 Reaction and 4 Will.', ['null-c2'], [
      bonus({ react: 4, will: 4 }),
    ]),

    // Depth 4: Deepening (6)
    node('null-a4x', 4, 'Thread Rupture', 'Gain 3 Instinct and 4 flat magic penetration.', ['null-a3x'], [
      bonus({ ins: 3, resistPenFlat: 4 }),
    ]),
    node('null-a4y', 4, 'Arcane Dissolve', 'Gain 3 Power and 0.06 crit multiplier.', ['null-a3y'], [
      bonus({ pow: 3, critSize: 6 }),
    ]),
    node('null-b4x', 4, 'Silent Cut', 'Gain 3 Power and 4 Accuracy.', ['null-b3x'], [
      bonus({ pow: 3, aim: 4 }),
    ]),
    node('null-b4y', 4, 'Flow Break', 'Gain 4 ability haste and 4 potency.', ['null-b3y'], [
      bonus({ haste: 4, potency: 4 }),
    ]),
    node('null-c4x', 4, 'Null Shell', 'Gain 10 max HP and 5 Will.', ['null-c3x'], [
      bonus({ hpMax: 10, will: 5 }),
    ]),
    node('null-c4y', 4, 'Unshaken Mind', 'Gain 5 Reaction and 5 tenacity.', ['null-c3y'], [
      bonus({ react: 5, tenacity: 5 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('null-a5-l', 5, 'Fraying Weave', 'Upgrade Unravel to apply 2 stacks of Unraveled on each hit.', ['null-a4x', 'null-a4y'], [
      replaceActive(ID_UNRAVEL, UP_UNRAVEL_FRAYING),
    ], { forkGroup: 'null-a5' }),
    node('null-a5-r', 5, 'Severed Thread', 'Upgrade Unravel with stronger Power and Instinct scaling and gain 10% magic penetration.', ['null-a4x', 'null-a4y'], [
      replaceActive(ID_UNRAVEL, UP_UNRAVEL_SEVERED),
      bonus({ resistPen: 10 }),
    ], { forkGroup: 'null-a5' }),

    node('null-b5-l', 5, 'Total Purge', 'Upgrade Sever Magic to remove every helpful status on the target.', ['null-b4x', 'null-b4y'], [
      replaceActive(ID_SEVER, UP_SEVER_PURGE),
    ], { forkGroup: 'null-b5' }),
    node('null-b5-r', 5, 'Spell-Lock', 'Upgrade Sever Magic to stun the target for 1 round with a 3-round cooldown.', ['null-b4x', 'null-b4y'], [
      replaceActive(ID_SEVER, UP_SEVER_LOCK),
    ], { forkGroup: 'null-b5' }),

    node('null-c5-l', 5, 'Sanctuary Negate', 'Upgrade Null Aegis to reach 6 tiles, shield the protected target for 14% of max HP, and restore 12 mana to them.', ['null-c4x', 'null-c4y'], [
      replaceActive(ID_AEGIS, UP_AEGIS_SANCTUARY),
    ], { forkGroup: 'null-c5' }),
    node('null-c5-r', 5, 'Counter-Unravel', 'Upgrade Null Aegis to protect only you (reach 0) and grant 1 round of Unraveling Ward so avoiding a foe attack retaliates with arcane damage and Unraveled.', ['null-c4x', 'null-c4y'], [
      replaceActive(ID_AEGIS, UP_AEGIS_COUNTER),
    ], { forkGroup: 'null-c5' }),

    // Depth 6: Post-fork convergence (6)
    node('null-a6x', 6, 'Sundered Weave', 'Gain 3 Instinct and 4 flat magic penetration.', ['null-a5-l', 'null-a5-r'], [
      bonus({ ins: 3, resistPenFlat: 4 }),
    ], { parentMode: 'any' }),
    node('null-a6y', 6, 'Piercing Thread', 'Gain 3 Power and 1 extra crit face.', ['null-a5-l', 'null-a5-r'], [
      bonus({ pow: 3, critFaces: 1 }),
    ], { parentMode: 'any' }),
    node('null-b6x', 6, 'Field Sight', 'Gain 3 Power and 4 Accuracy.', ['null-b5-l', 'null-b5-r'], [
      bonus({ pow: 3, aim: 4 }),
    ], { parentMode: 'any' }),
    node('null-b6y', 6, 'Null Cadence', 'Gain 4 ability haste and 3 speed.', ['null-b5-l', 'null-b5-r'], [
      bonus({ haste: 4, speed: 3 }),
    ], { parentMode: 'any' }),
    node('null-c6x', 6, 'Woven Barrier', 'Gain 10 max HP and 5 tenacity.', ['null-c5-l', 'null-c5-r'], [
      bonus({ hpMax: 10, tenacity: 5 }),
    ], { parentMode: 'any' }),
    node('null-c6y', 6, 'Still Reflex', 'Gain 5 Reaction and 5 Will.', ['null-c5-l', 'null-c5-r'], [
      bonus({ react: 5, will: 5 }),
    ], { parentMode: 'any' }),

    // Depth 7: Second Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('null-a7-l', 7, 'Cascade Collapse', 'Gain 20 max mana, 4 Instinct, and deal up to 18% more damage to foes with higher max HP than you.', ['null-a6x', 'null-a6y'], [
      bonus({ manaMax: 20, ins: 4 }),
      scaler({ measure: 'maxPair', dir: 'over', start: 0.5, scale: 0.18 }),
    ], { forkGroup: 'null-a7' }),
    node('null-a7-r', 7, 'Abyssal Tear', 'Gain 4 Power, 10% magic penetration, and deal up to 20% more damage to foes under half HP.', ['null-a6x', 'null-a6y'], [
      bonus({ pow: 4, resistPen: 10 }),
      scaler({ measure: 'target', dir: 'under', start: 0.5, scale: 0.20 }),
    ], { forkGroup: 'null-a7' }),

    node('null-b7-l', 7, 'Null Horizon', 'Upgrade Erase Field to erase up to 2 foe fields and deal 28% stagger.', ['null-b6x', 'null-b6y'], [
      replaceActive(ID_ERASE, UP_ERASE_HORIZON),
    ], { forkGroup: 'null-b7' }),
    node('null-b7-r', 7, 'Rift Collapse', 'Upgrade Erase Field to deal extra arcane damage equal to 35% of magic power per stack of Unraveled on each target.', ['null-b6x', 'null-b6y'], [
      replaceActive(ID_ERASE, UP_ERASE_COLLAPSE),
    ], { forkGroup: 'null-b7' }),

    node('null-c7-l', 7, 'Void Bulwark', 'Gain 30 max HP, 12 Will, and 10 tenacity.', ['null-c6x', 'null-c6y'], [
      bonus({ hpMax: 30, will: 12, tenacity: 10 }),
    ], { forkGroup: 'null-c7' }),
    node('null-c7-r', 7, 'Phase Veil', 'Gain 20 max HP, 10 Reaction, and 6 speed.', ['null-c6x', 'null-c6y'], [
      bonus({ hpMax: 20, react: 10, speed: 6 }),
    ], { forkGroup: 'null-c7' }),

    // Depth 8: Branch Capstones (3)
    node('null-a8', 8, 'Final Unmaking', 'Gain 4 Instinct, 0.08 crit multiplier, and 5 flat magic penetration.', ['null-a7-l', 'null-a7-r'], [
      bonus({ ins: 4, critSize: 8, resistPenFlat: 5 }),
    ], { parentMode: 'any' }),
    node('null-b8', 8, 'Absolute Sever', 'Gain 4 Power, 4 ability haste, and 5 potency.', ['null-b7-l', 'null-b7-r'], [
      bonus({ pow: 4, haste: 4, potency: 5 }),
    ], { parentMode: 'any' }),
    node('null-c8', 8, 'Untouched Core', 'Gain 6 Will and 6 Reaction.', ['null-c7-l', 'null-c7-r'], [
      bonus({ will: 6, react: 6 }),
    ], { parentMode: 'any' }),

    // Depth 9: Monarch Capstone (1)
    node('null-cap', 9, 'Weaver of the Null', 'Upgrade Thread of Unmaking to Weaver of the Null and gain 5 Instinct and 4 Power.', ['null-a8', 'null-b8', 'null-c8'], [
      replaceWorn(KEY_THREAD, WEAVER_THREAD),
      bonus({ ins: 5, pow: 4 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
