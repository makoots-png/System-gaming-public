// class-soulforger.ts: Epic Soulforger (dis+pow) signature kit and full 26-node / 23-buyable skill tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
// Zero new combat hooks: pairs Channeler (dis+pow unbreakable channels) with Soul Embers, Hammerfall, Soul Anvil, and Soulbound Blade.
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { Op, Reach, StackDef, StatusDef, StatusKey, Tiers, UseOp } from '../combat/effect-ops.ts';
import type { Limit, Trigger } from '../combat/triggers.ts';
import { tiles } from '../combat/space.ts';
import { cost, tick } from '../combat/timeline.ts';
import type { Tick } from '../combat/timeline.ts';
import { abilityOf, CHANNEL_TAG } from './ability-kinds.ts';
import type { Scaler } from './scalers.ts';
import type { ClassNodeDef, ClassTree, ClassWorn, NodeGift, TreeDepth } from './class-trees.ts';
import type { ClassSignature } from './class-powers.ts';

const R = RULES;
const nid = (s: string): ClassNodeId => {
  const id = parseClassNodeId(s);
  if (!id) throw new Error(`Invalid Soulforger node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Soulforger formula "${text}"`);
  return p.formula;
};
const tiered = (e: string, d: string, c: string, b: string, a: string, s: string): Tiers<Formula> =>
  [f(e), f(d), f(c), f(b), f(a), f(s)];
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };
const area = (radius: number, on: 'allies' | 'foes'): Reach => ({ kind: 'area', radius: tiles(radius), on });

const KEY_FORGE = statusKey('soul-forge');
const KEY_FORGE_GRAND = statusKey('soul-forge-grand');
const KEY_EMBER = statusKey('soul-ember');
const KEY_FRAY = statusKey('soul-fray');
const KEY_TEMPERED = statusKey('soul-tempered');
const KEY_SAFEGUARD = statusKey('soul-safeguard');
const KEY_AEGIS_PULSE = statusKey('soul-aegis-pulse');
const KEY_SENTINEL_WARD = statusKey('soul-sentinel-ward');

const ID_HAMMERFALL = abilityId('soul-hammerfall');
const ID_TEMPER = abilityId('soul-temper');
const ID_ANVIL = abilityId('soul-anvil');
const ID_BLADE = abilityId('soul-blade');

// ── statuses ──

// Neutral resource stack (ops: [] so neither harmful nor helpful dispels touch it).
const SOUL_EMBER: StackDef = {
  label: 'Soul Ember',
  desc: 'Forged fuel stacked up to 5. Spend 3 stacks to call Soulbound Blade.',
  ops: [],
  stack: {
    cap: 5,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: null,
  },
};

const SOUL_FRAY: StatusDef = {
  label: 'Soul Fray',
  desc: 'Takes 12% more damage and loses 12 magic resist for 2 rounds.',
  ops: [
    { op: 'share', on: 'taken', pct: 12 },
    { op: 'sheet', key: 'resist', amount: f('-12') },
  ],
};

// Non-shield ops keep Tempered helpful so dispels recognize it as a buff.
const TEMPERED_DEF: StatusDef = {
  label: 'Tempered',
  desc: 'Adds 12 armor and deals 15% more damage for 2 rounds.',
  ops: [
    { op: 'sheet', key: 'armor', amount: f('12') },
    { op: 'share', on: 'dealt', pct: 15 },
  ],
};

// Separate 1-round safeguard status so Aegis Temper never clamps 2-round Tempered to kit.wardRounds (1).
const SAFEGUARD_DEF: StatusDef = {
  label: 'Aegis Ward',
  desc: 'Blocks harmful statuses from foes for 1 round.',
  ops: [{ op: 'safeguard' }],
};

// Self-curing ally-area pulse so Aegis Temper shields and wards nearby allies within 2 tiles while sparing foes.
const AEGIS_PULSE_DEF: StatusDef = {
  label: 'Aegis Pulse',
  desc: "Shields the bearer and allies within 2 tiles for 12% of the bearer's max HP, and grants Tempered for 2 rounds and Aegis Ward for 1 round.",
  ops: [],
  triggers: [
    {
      on: 'statusGained',
      key: KEY_AEGIS_PULSE,
      to: area(2, 'allies'),
      limit: EACH,
      ops: [
        { op: 'shield', amount: f('0.12 * hpmax') },
        { op: 'applyStatus', key: KEY_TEMPERED, def: TEMPERED_DEF, duration: rounds(2) },
        { op: 'applyStatus', key: KEY_SAFEGUARD, def: SAFEGUARD_DEF, duration: rounds(1) },
        { op: 'cureStatus', key: KEY_AEGIS_PULSE },
      ],
    },
  ],
};

// Starting status for the Runic Sentinel brute summon: projects a 2-tile foe taunt aura.
const SENTINEL_WARD_DEF: StatusDef = {
  label: 'Runic Challenge',
  desc: 'Foes within 2 tiles must aim at the Runic Sentinel.',
  ops: [
    { op: 'aura', radius: 2, on: 'foes' },
    { op: 'taunt' },
  ],
};

function makeSoulforge(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly resist: string;
  readonly dealtPct: number | null;
  readonly channelEmbers: number;
  readonly channelShield: string;
  readonly channelMana: string;
  readonly channelRefundPct: number | null;
}): ClassWorn {
  const ops: Op[] = [
    { op: 'sheet', key: 'resist', amount: f(o.resist) },
    ...(o.dealtPct !== null ? [{ op: 'share' as const, on: 'dealt' as const, pct: o.dealtPct }] : []),
  ];
  const triggers: Trigger[] = [
    {
      on: 'used',
      tag: CHANNEL_TAG,
      to: 'self',
      limit: ROUND,
      ops: [
        { op: 'applyStatus', key: KEY_EMBER, def: SOUL_EMBER, duration: null, stacks: o.channelEmbers },
        { op: 'shield', amount: f(o.channelShield) },
        { op: 'mana', when: 'use', amount: f(o.channelMana) },
        ...(o.channelRefundPct !== null ? [{ op: 'refund' as const, pct: o.channelRefundPct }] : []),
      ],
    },
    {
      on: 'kill',
      tag: null,
      to: 'self',
      limit: EACH,
      ops: [{ op: 'applyStatus', key: KEY_EMBER, def: SOUL_EMBER, duration: null, stacks: 2 }],
    },
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

const BASE_SOULFORGE: ClassWorn = makeSoulforge({
  key: KEY_FORGE,
  label: 'Soulforge',
  desc: 'Adds 4 magic resist. Once a round when you release a channeled ability, gain 1 Soul Ember (up to 5), a 5% max HP shield, and 4 mana. Defeating a foe grants 2 Soul Embers.',
  resist: '4',
  dealtPct: null,
  channelEmbers: 1,
  channelShield: '0.05 * hpmax',
  channelMana: '4',
  channelRefundPct: null,
});

const GRAND_SOULSMITH: ClassWorn = makeSoulforge({
  key: KEY_FORGE_GRAND,
  label: 'Grand Soulsmith',
  desc: 'Adds 10 magic resist and 10% more damage dealt. Once a round when you release a channeled ability, gain 2 Soul Embers (up to 5), a 10% max HP shield, 8 mana, and 20% turn refund. Defeating a foe grants 2 Soul Embers.',
  resist: '10',
  dealtPct: 10,
  channelEmbers: 2,
  channelShield: '0.1 * hpmax',
  channelMana: '8',
  channelRefundPct: 20,
});

// ── active ability builders ──

function makeHammerfall(o: {
  readonly name: string;
  readonly radiusTiles: number;
  readonly cooldownRounds: number;
  readonly formula: string;
  readonly staggerShare: number;
}): Ability {
  const base = abilityOf('blast', {
    id: ID_HAMMERFALL,
    name: o.name,
    aim: 'place',
    range: tiles(8),
    shape: { kind: 'radius', radius: tiles(o.radiusTiles), ring: null },
    delivery: { kind: 'travel', windup: tick(400), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'stagger', share: o.staggerShare },
      { op: 'applyStatus', key: KEY_FRAY, def: SOUL_FRAY, duration: rounds(2) },
    ],
  }, R);
  return {
    ...base,
    channel: { growth: 'linear', max: 3 },
    cost: { ...base.cost, mana: 8, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeTemper(o: {
  readonly name: string;
  readonly cooldownRounds?: number;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('support', {
    id: ID_TEMPER,
    name: o.name,
    aim: 'ally',
    range: tiles(6),
    shape: { kind: 'touch', reach: tiles(6) },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'shield', by: 'hand', formula: f('0.18 * hpmax') },
    ops: [
      { op: 'applyStatus', key: KEY_TEMPERED, def: TEMPERED_DEF, duration: rounds(2) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 6, fatigue: 5, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds ?? 2) },
  };
}

function makeSoulAnvil(): Ability {
  // Rank-tiered zone damage uses dice only (no stat/sheet terms) so payDue evaluates cleanly on foe victims.
  const base = abilityOf('blast', {
    id: ID_ANVIL,
    name: 'Soul Anvil',
    aim: 'place',
    range: tiles(8),
    shape: { kind: 'radius', radius: tiles(2), ring: null },
    delivery: { kind: 'travel', windup: tick(400), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f('1d8 + 0.7 * mag') },
    ops: [],
    zone: {
      name: 'Soul Anvil',
      duration: rounds(3),
      around: null,
      endsWithOwner: true,
      grow: null,
      ops: [
        { op: 'damage', type: 'arcane', when: 'turn', amount: tiered('1d6', '1d8', '2d6', '2d8', '3d8', '4d8') },
      ],
    },
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 7, fatigue: 5, time: cost(R.fight.cost.standard), cooldown: rounds(2) },
  };
}

function makeSoulboundBlade(o: {
  readonly name: string;
  readonly summonName: string;
  readonly archetype: 'skirmisher' | 'brute';
  readonly statuses: readonly { readonly key: StatusKey; readonly rounds: number }[];
}): Ability {
  // Self-shield provides a weighed part so abilityWorth > 0 while timed summon stays unweighed.
  const base = abilityOf('support', {
    id: ID_BLADE,
    name: o.name,
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'shield', by: 'hand', formula: f('0.12 * hpmax') },
    ops: [],
  }, R);
  return {
    ...base,
    gates: [{ kind: 'holds', key: KEY_EMBER, on: 'self', atLeast: 3 }],
    prices: [{ kind: 'stacks', key: KEY_EMBER, from: 'self', take: { kind: 'n', n: 3 } }],
    summon: {
      name: o.summonName,
      archetype: o.archetype,
      rounds: 5,
      statuses: o.statuses,
    },
    cost: { ...base.cost, mana: 8, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(3) },
  };
}

const BASE_HAMMERFALL = makeHammerfall({
  name: 'Hammerfall',
  radiusTiles: 2,
  cooldownRounds: 2,
  formula: '(1d8 + 0.75 * mag) * (1 + 0.5 * charge)',
  staggerShare: 0.25,
});

const UP_HAMMERFALL_CRUCIBLE = makeHammerfall({
  name: 'Hammerfall: Crucible Fall',
  radiusTiles: 3,
  cooldownRounds: 2,
  formula: '(1d8 + 0.75 * mag) * (1 + 0.5 * charge)',
  staggerShare: 0.35,
});

const UP_HAMMERFALL_SHATTER = makeHammerfall({
  name: 'Hammerfall: Shatter Fall',
  radiusTiles: 2,
  cooldownRounds: 1,
  formula: '(1d8 + 0.75 * mag) * (1 + 0.65 * charge)',
  staggerShare: 0.25,
});

const BASE_TEMPER = makeTemper({
  name: 'Temper',
});

const UP_TEMPER_AEGIS = makeTemper({
  name: 'Temper: Aegis Temper',
  cooldownRounds: 3,
  extraOps: [
    { op: 'applyStatus', key: KEY_SAFEGUARD, def: SAFEGUARD_DEF, duration: rounds(1) },
    { op: 'applyStatus', key: KEY_AEGIS_PULSE, def: AEGIS_PULSE_DEF, duration: rounds(1) },
  ],
});

const UP_TEMPER_QUENCH = makeTemper({
  name: 'Temper: Quench Temper',
  extraOps: [
    { op: 'dispel', which: 'first' },
    { op: 'mana', when: 'use', amount: f('8') },
  ],
});

const BASE_ANVIL = makeSoulAnvil();

const BASE_BLADE = makeSoulboundBlade({
  name: 'Soulbound Blade',
  summonName: 'Soulbound Blade',
  archetype: 'skirmisher',
  statuses: [],
});

const UP_BLADE_SENTINEL = makeSoulboundBlade({
  name: 'Soulbound Blade: Runic Sentinel',
  summonName: 'Runic Sentinel',
  archetype: 'brute',
  statuses: [{ key: KEY_SENTINEL_WARD, rounds: 5 }],
});

/** Base Soulforger signature (before skill-tree nodes are folded on top). */
export const SOULFORGER_SIGNATURE: ClassSignature = {
  className: 'Soulforger',
  bonus: { pow: 2, dis: 2, haste: 4, manaMax: 3 },
  worn: BASE_SOULFORGE,
  actives: [BASE_HAMMERFALL, BASE_TEMPER, BASE_ANVIL, BASE_BLADE],
  statuses: [{ key: KEY_SENTINEL_WARD, def: SENTINEL_WARD_DEF }],
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

/** Full 7-depth, 3-branch (Hammer, Temper, Blade), 23-buyable (26-node) Epic Soulforger skill tree. */
export const SOULFORGER_TREE: ClassTree = {
  className: 'Soulforger',
  rarity: 'epic',
  nodes: [
    // Depth 1: Root (1)
    node('soul-root', 1, 'First Ember', 'Gain 4 Power, 3 Discipline, and 8 max mana.', [], [
      bonus({ pow: 4, dis: 3, manaMax: 8 }),
    ]),

    // Depth 2: Three branches (3) — Hammer (A), Temper (B), Blade (C)
    node('soul-a2', 2, 'Heavy Blow', 'Gain 4 Power and 5% magic penetration.', ['soul-root'], [
      bonus({ pow: 4, resistPen: 5 }),
    ]),
    node('soul-b2', 2, 'Quenched Resolve', 'Gain 4 Discipline and 6% heal and shield bonus.', ['soul-root'], [
      bonus({ dis: 4, healPower: 6 }),
    ]),
    node('soul-c2', 2, 'Ember Craft', 'Gain 4 Power and 6 ability haste.', ['soul-root'], [
      bonus({ pow: 4, haste: 6 }),
    ]),

    // Depth 3: Branch splits (6)
    node('soul-a3x', 3, 'Searing Strike', 'Gain 5% magic penetration and 5 flat magic penetration.', ['soul-a2'], [
      bonus({ resistPen: 5, resistPenFlat: 5 }),
    ]),
    node('soul-a3y', 3, 'Measured Swing', 'Gain 4 accuracy and 0.08 crit multiplier.', ['soul-a2'], [
      bonus({ aim: 4, critSize: 8 }),
    ]),
    node('soul-b3x', 3, 'Anvil Will', 'Gain 25 max HP and 5 Will.', ['soul-b2'], [
      bonus({ hpMax: 25, will: 5 }),
    ]),
    node('soul-b3y', 3, 'Steadfast Temper', 'Gain 6% heal and shield bonus and 5 tenacity.', ['soul-b2'], [
      bonus({ healPower: 6, tenacity: 5 }),
    ]),
    node('soul-c3x', 3, 'Deep Hearth', 'Gain 8 max mana and 4% ability cost reduction.', ['soul-c2'], [
      bonus({ manaMax: 8, costCut: 4 }),
    ]),
    node('soul-c3y', 3, 'Forge Rhythm', 'Gain 6 speed and 6 ability haste.', ['soul-c2'], [
      bonus({ speed: 6, haste: 6 }),
    ]),

    // Depth 4: Deepening (6)
    node('soul-a4x', 4, 'Molten Core', 'Gain 6% magic penetration and 6 flat magic penetration.', ['soul-a3x'], [
      bonus({ resistPen: 6, resistPenFlat: 6 }),
    ]),
    node('soul-a4y', 4, 'Cracking Blow', 'Gain 5 Power and 0.1 crit multiplier.', ['soul-a3y'], [
      bonus({ pow: 5, critSize: 10 }),
    ]),
    node('soul-b4x', 4, 'Unbroken Shell', 'Gain 35 max HP and 6 Will.', ['soul-b3x'], [
      bonus({ hpMax: 35, will: 6 }),
    ]),
    node('soul-b4y', 4, 'Tempered Ward', 'Gain 8% heal and shield bonus and 6 tenacity.', ['soul-b3y'], [
      bonus({ healPower: 8, tenacity: 6 }),
    ]),
    node('soul-c4x', 4, 'Cinder Well', 'Gain 8 max mana and 4% ability cost reduction.', ['soul-c3x'], [
      bonus({ manaMax: 8, costCut: 4 }),
    ]),
    node('soul-c4y', 4, 'Hammer Cadence', 'Gain 8 speed and 8 ability haste.', ['soul-c3y'], [
      bonus({ speed: 8, haste: 8 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('soul-a5-l', 5, 'Crucible Fall', 'Upgrade Hammerfall to a 3-tile radius and 35% stagger.', ['soul-a4x', 'soul-a4y'], [
      replaceActive(ID_HAMMERFALL, UP_HAMMERFALL_CRUCIBLE),
    ], { forkGroup: 'soul-a5' }),
    node('soul-a5-r', 5, 'Shatter Fall', 'Upgrade Hammerfall to a 1-round cooldown and 65% bonus damage per channel charge.', ['soul-a4x', 'soul-a4y'], [
      replaceActive(ID_HAMMERFALL, UP_HAMMERFALL_SHATTER),
    ], { forkGroup: 'soul-a5' }),

    node('soul-b5-l', 5, 'Aegis Temper', "Upgrade Temper to a 3-round cooldown. Allies within 2 tiles of the aimed ally gain a shield for 12% of the aimed ally's max HP, Tempered for 2 rounds, and Aegis Ward safeguard for 1 round.", ['soul-b4x', 'soul-b4y'], [
      replaceActive(ID_TEMPER, UP_TEMPER_AEGIS),
    ], { forkGroup: 'soul-b5' }),
    node('soul-b5-r', 5, 'Quench Temper', "Upgrade Temper to dispel the aimed ally's oldest harmful status and restore 8 mana to that ally.", ['soul-b4x', 'soul-b4y'], [
      replaceActive(ID_TEMPER, UP_TEMPER_QUENCH),
    ], { forkGroup: 'soul-b5' }),

    node('soul-c5-l', 5, 'Runic Sentinel', 'Upgrade Soulbound Blade to summon a Runic Sentinel brute with a 2-tile foe taunt aura for 5 rounds.', ['soul-c4x', 'soul-c4y'], [
      replaceActive(ID_BLADE, UP_BLADE_SENTINEL),
    ], { forkGroup: 'soul-c5' }),
    node('soul-c5-r', 5, 'Anvil Overcharge', 'Gain 6 Power and 8% magic penetration. Your damaging attacks and spells deal up to 18% more damage while you are above half HP.', ['soul-c4x', 'soul-c4y'], [
      bonus({ pow: 6, resistPen: 8 }),
      scaler({ measure: 'user', dir: 'over', start: 0.5, scale: 0.18 }),
    ], { forkGroup: 'soul-c5' }),

    // Depth 6: Branch Capstones (3)
    node('soul-a6', 6, 'Anvil Master', 'Gain 6 Power, 6 accuracy, and 8 flat magic penetration.', ['soul-a5-l', 'soul-a5-r'], [
      bonus({ pow: 6, aim: 6, resistPenFlat: 8 }),
    ], { parentMode: 'any' }),
    node('soul-b6', 6, 'Living Vessel', 'Gain 6 Discipline, 40 max HP, and 6% heal and shield bonus.', ['soul-b5-l', 'soul-b5-r'], [
      bonus({ dis: 6, hpMax: 40, healPower: 6 }),
    ], { parentMode: 'any' }),
    node('soul-c6', 6, 'Endless Kiln', 'Gain 5 Power, 8 ability haste, and 8 max mana.', ['soul-c5-l', 'soul-c5-r'], [
      bonus({ pow: 5, haste: 8, manaMax: 8 }),
    ], { parentMode: 'any' }),

    // Depth 7: Epic Capstone (1)
    node('soul-cap', 7, 'Grand Soulsmith', 'Upgrade Soulforge to Grand Soulsmith and gain 6 Power, 6 Discipline, and 10 max mana.', ['soul-a6', 'soul-b6', 'soul-c6'], [
      replaceWorn(KEY_FORGE, GRAND_SOULSMITH),
      bonus({ pow: 6, dis: 6, manaMax: 10 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
