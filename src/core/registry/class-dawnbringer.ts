// class-dawnbringer.ts: Mythic Dawnbringer (dis+pre, awakens Oathkeeper) signature kit and full 38-node / 32-buyable skill tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
// Solar paragon ascending through 3 Ascension forms while surplus healing turns into solar fire via Hook H2 (`overhealed` + `over`).
// All heals and solar attacks scale on `sup + 0.45 * will` so 2:1 dis+pre builds match offensive Mythic power curves.
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
import { abilityOf, KIND_TAG } from './ability-kinds.ts';
import type { Scaler } from './scalers.ts';
import type { ClassNodeDef, ClassTree, ClassWorn, NodeGift, TreeDepth } from './class-trees.ts';
import type { ClassSignature } from './class-powers.ts';

const R = RULES;
const nid = (s: string): ClassNodeId => {
  const id = parseClassNodeId(s);
  if (!id) throw new Error(`Invalid Dawnbringer node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Dawnbringer formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };
const area = (radius: number, on: 'allies' | 'foes'): Reach => ({ kind: 'area', radius: tiles(radius), on });
const mostHpFoe = (radius: number): Reach => ({ kind: 'most', of: 'hp', radius: tiles(radius), on: 'foes' });

const KEY_RISING = statusKey('dawn-rising');
const KEY_AVATAR = statusKey('dawn-avatar');
const KEY_ZEAL = statusKey('dawn-zeal');
const KEY_ASCENSION = statusKey('dawn-ascension');
const KEY_SUNBLIND = statusKey('dawn-sunblind');
const KEY_JUDGMENT_HOLD = statusKey('dawn-judgment-hold');
const KEY_SAFEGUARD = statusKey('dawn-safeguard');
const KEY_LAST_WARD = statusKey('dawn-last-ward');
const KEY_HYMN = statusKey('dawn-radiant-hymn');
const KEY_AEGIS = statusKey('dawn-sunlit-aegis');

const ID_SUNLANCE = abilityId('dawn-sunlance');
const ID_BENEDICTION = abilityId('dawn-benediction');
const ID_WARD = abilityId('dawn-daybreak-ward');
const ID_LAST_LIGHT = abilityId('dawn-last-light');

// ── statuses ──

const ASCENSION: StackDef = {
  label: 'Ascension',
  desc: 'Each stack adds 1 tile of range and 8% damage dealt (up to 3 stacks).',
  ops: [
    { op: 'sheet', key: 'range', amount: 1 },
    { op: 'share', on: 'dealt', pct: 8 },
  ],
  stack: { cap: 3, leave: { kind: 'never' }, keep: 'fight', threshold: null },
};

// Neutral counter status: spends 2 stacks to grant 1 stack of Ascension.
const ZEAL: StackDef = {
  label: 'Zeal',
  desc: 'At 2 stacks, spends all stacks to grant 1 stack of Ascension.',
  ops: [],
  stack: {
    cap: 2,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: {
      at: { kind: 'count', n: 2 },
      to: { kind: 'bearer' },
      then: 'spend',
      ops: [{ op: 'applyStatus', key: KEY_ASCENSION, def: ASCENSION, duration: null }],
    },
  },
};

const SUNBLIND: StatusDef = {
  label: 'Sunblind',
  desc: 'Deals 10% less damage and attacks against this target crit on 1 more die face for 2 rounds.',
  ops: [
    { op: 'share', on: 'dealt', pct: -10 },
    { op: 'sheet', key: 'exposed', amount: 1 },
  ],
};

const SOLAR_VERDICT: StatusDef = {
  label: 'Solar Verdict',
  desc: 'Stunned for 1 round.',
  ops: [{ op: 'hold' }],
};

// Dedicated 1-round safeguard status matching RULES.fight.kit.wardRounds (1 round).
const DAWN_SAFEGUARD: StatusDef = {
  label: 'Dawn Safeguard',
  desc: 'Blocks harmful statuses from foes and adds 12 armor for 1 round.',
  ops: [
    { op: 'safeguard' },
    { op: 'sheet', key: 'armor', amount: f('12') },
  ],
};

// Dedicated 1-round lethal ward status matching RULES.fight.kit.wardRounds (invulnerable applies once per fight via warded).
const LAST_LIGHT_WARD: StatusDef = {
  label: 'Last Light Ward',
  desc: 'Cannot drop below 1 HP and blocks harmful statuses from foes for 1 round.',
  ops: [
    { op: 'invulnerable' },
    { op: 'safeguard' },
  ],
};

function makeRisingDawn(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly armor: number;
  readonly dealtPct: number;
  readonly supportMana: string;
  readonly ascendHitFormula: string;
  readonly overhealFormula: string;
}): ClassWorn {
  const ops: Op[] = [
    { op: 'sheet', key: 'armor', amount: f(String(o.armor)) },
    ...(o.dealtPct > 0 ? [{ op: 'share' as const, on: 'dealt' as const, pct: o.dealtPct }] : []),
  ];
  // Strictly 4 triggers (<= RULES.fight.kit.triggers):
  // 1. Dealing a hit builds Zeal once a round.
  // 2. Using a support ability builds Zeal and restores mana once a round.
  // 3. While holding Ascension, dealing a hit adds solar arcane damage scaling with Ascension stacks once a round.
  // 4. Excess healing past max HP smites the highest-HP foe within 6 tiles once a round (Hook H2).
  const triggers: Trigger[] = [
    {
      on: 'hitDealt',
      tag: null,
      to: 'self',
      limit: ROUND,
      ops: [{ op: 'applyStatus', key: KEY_ZEAL, def: ZEAL, duration: null }],
    },
    {
      on: 'used',
      tag: KIND_TAG.support,
      to: 'self',
      limit: ROUND,
      ops: [
        { op: 'applyStatus', key: KEY_ZEAL, def: ZEAL, duration: null },
        { op: 'mana', when: 'use', amount: f(o.supportMana) },
      ],
    },
    {
      on: 'hitDealt',
      tag: null,
      to: 'other',
      limit: ROUND,
      need: { kind: 'holds', key: KEY_ASCENSION },
      ops: [{ op: 'damage', type: 'arcane', when: 'use', amount: f(o.ascendHitFormula) }],
    },
    {
      on: 'overhealed',
      to: mostHpFoe(6),
      limit: ROUND,
      ops: [{ op: 'damage', type: 'arcane', when: 'use', amount: f(o.overhealFormula) }],
    },
  ];
  return { key: o.key, def: { label: o.label, desc: o.desc, ops, triggers } };
}

const BASE_RISING: ClassWorn = makeRisingDawn({
  key: KEY_RISING,
  label: 'Rising Dawn',
  desc: 'Adds 6 armor. Once a round on hit, gain 1 Zeal (2 Zeal becomes 1 Ascension, up to 3 stacks). Once a round when you use a support ability, gain 1 Zeal and 4 mana. While ascended, your hits deal bonus solar arcane damage once a round. Once a round when healed past max HP, smite the highest-HP foe within 6 tiles for 75% of the excess healing as arcane damage.',
  armor: 6,
  dealtPct: 0,
  supportMana: '4',
  ascendHitFormula: '0.22 * (sup + 0.45 * will) * stacks(dawn-ascension)',
  overhealFormula: '0.75 * over',
});

const AVATAR_RISING: ClassWorn = makeRisingDawn({
  key: KEY_AVATAR,
  label: 'Avatar of Dawn',
  desc: 'Adds 8 armor and 12% damage dealt. Once a round on hit, gain 1 Zeal (2 Zeal becomes 1 Ascension, up to 3 stacks). Once a round when you use a support ability, gain 1 Zeal and 8 mana. While ascended, your hits deal stronger solar arcane damage once a round. Once a round when healed past max HP, smite the highest-HP foe within 6 tiles for 100% of the excess healing as arcane damage.',
  armor: 8,
  dealtPct: 12,
  supportMana: '8',
  ascendHitFormula: '0.39 * (sup + 0.45 * will) * stacks(dawn-ascension)',
  overhealFormula: '1.0 * over',
});

// ── active ability builders ──
// Zero self-riders on foe-aimed actives. Every ward/safeguard status lasts 1 round.

function makeSunlance(o: {
  readonly name: string;
  readonly formula: string;
  readonly staggerShare: number;
  readonly cooldownRounds: number;
  readonly hold?: boolean;
}): Ability {
  const ops: UseOp[] = [
    { op: 'stagger', share: o.staggerShare },
    { op: 'applyStatus', key: KEY_SUNBLIND, def: SUNBLIND, duration: rounds(2) },
    ...(o.hold ? [{ op: 'applyStatus' as const, key: KEY_JUDGMENT_HOLD, def: SOLAR_VERDICT, duration: rounds(1) }] : []),
  ];
  const base = abilityOf('curse', {
    id: ID_SUNLANCE,
    name: o.name,
    aim: 'foe',
    range: tiles(4),
    shape: { kind: 'touch', reach: tiles(4) },
    delivery: { kind: 'direct' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops,
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 5, fatigue: 5, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeBenediction(o: {
  readonly name: string;
  readonly healFormula: string;
}): Ability {
  const base = abilityOf('support', {
    id: ID_BENEDICTION,
    name: o.name,
    aim: 'ally',
    range: tiles(6),
    shape: { kind: 'touch', reach: tiles(6) },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'heal', by: 'hand', formula: f(o.healFormula) },
    ops: [{ op: 'dispel', which: 'first' }],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 6, fatigue: 4, time: cost(R.fight.cost.quick), cooldown: rounds(2) },
  };
}

function makeRadiantHymn(): Ability {
  // Uses a 1-round neutral self status with a `statusGained` ally-area trigger so Radiant Hymn heals and cleanses
  // only Dawnbringer and allies within 2 tiles (sparing foes) and still feeds `overhealed` at chain depth 2.
  const pulseDef: StatusDef = {
    label: 'Radiant Hymn',
    desc: 'Heals you and allies within 2 tiles and ends the oldest harmful status on each.',
    ops: [],
    triggers: [
      {
        on: 'statusGained',
        key: KEY_HYMN,
        to: area(2, 'allies'),
        limit: EACH,
        ops: [
          { op: 'heal', when: 'use', amount: f('1d10 + 0.72 * sup + 0.30 * will') },
          { op: 'dispel', which: 'first' },
        ],
      },
    ],
  };
  const base = abilityOf('support', {
    id: ID_BENEDICTION,
    name: 'Benediction: Radiant Hymn',
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: null,
    ops: [{ op: 'applyStatus', key: KEY_HYMN, def: pulseDef, duration: rounds(1) }],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 6, fatigue: 4, time: cost(R.fight.cost.quick), cooldown: rounds(2) },
  };
}

function makeDaybreakWard(o: {
  readonly name: string;
  readonly shieldFormula: string;
  readonly allyHasten?: number;
}): Ability {
  const ops: UseOp[] = [
    { op: 'applyStatus', key: KEY_SAFEGUARD, def: DAWN_SAFEGUARD, duration: rounds(1) },
    ...(o.allyHasten ? [{ op: 'hasten' as const, share: o.allyHasten }] : []),
  ];
  const base = abilityOf('support', {
    id: ID_WARD,
    name: o.name,
    aim: 'ally',
    range: tiles(6),
    shape: { kind: 'touch', reach: tiles(6) },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'shield', by: 'hand', formula: f(o.shieldFormula) },
    ops,
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 7, fatigue: 4, time: cost(R.fight.cost.quick), cooldown: rounds(2) },
  };
}

function makeSunlitAegis(): Ability {
  // Uses a 1-round neutral self status with a `statusGained` ally-area trigger to shield and safeguard allies within 2 tiles.
  const pulseDef: StatusDef = {
    label: 'Sunlit Aegis',
    desc: 'Shields you and allies within 2 tiles and grants Dawn Safeguard for 1 round.',
    ops: [],
    triggers: [
      {
        on: 'statusGained',
        key: KEY_AEGIS,
        to: area(2, 'allies'),
        limit: EACH,
        ops: [
          { op: 'shield', amount: f('0.14 * hpmax') },
          { op: 'applyStatus', key: KEY_SAFEGUARD, def: DAWN_SAFEGUARD, duration: rounds(1) },
        ],
      },
    ],
  };
  const base = abilityOf('support', {
    id: ID_WARD,
    name: 'Daybreak Ward: Sunlit Aegis',
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: null,
    ops: [{ op: 'applyStatus', key: KEY_AEGIS, def: pulseDef, duration: rounds(1) }],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 7, fatigue: 4, time: cost(R.fight.cost.quick), cooldown: rounds(2) },
  };
}

function makeLastLight(o: {
  readonly name: string;
  readonly healFormula: string;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const ops: UseOp[] = [
    { op: 'applyStatus', key: KEY_LAST_WARD, def: LAST_LIGHT_WARD, duration: rounds(1) },
    ...(o.extraOps ?? []),
  ];
  const base = abilityOf('support', {
    id: ID_LAST_LIGHT,
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
    cost: { ...base.cost, mana: 10, fatigue: 4, time: cost(R.fight.cost.quick), cooldown: rounds(4) },
    react: { when: 'lethal', reach: tiles(0) },
  };
}

const BASE_SUNLANCE = makeSunlance({
  name: 'Sunlance',
  formula: '1d10 + 1.05 * sup + 0.42 * will',
  staggerShare: 0.25,
  cooldownRounds: 0,
});

const UP_SUNLANCE_BLAZING = makeSunlance({
  name: 'Sunlance: Blazing Lance',
  formula: '1d10 + 1.62 * sup + 0.58 * will',
  staggerShare: 0.50,
  cooldownRounds: 0,
});

const UP_SUNLANCE_JUDGMENT = makeSunlance({
  name: 'Sunlance: Solar Judgment',
  formula: '1d10 + 1.05 * sup + 0.42 * will',
  staggerShare: 0.25,
  cooldownRounds: 3,
  hold: true,
});

const BASE_BENEDICTION = makeBenediction({
  name: 'Benediction',
  healFormula: '1d10 + 0.72 * sup + 0.30 * will',
});

const UP_BENEDICTION_GRACE = makeBenediction({
  name: 'Benediction: Overflowing Grace',
  healFormula: '1d10 + 0.82 * sup + 0.36 * will',
});

const UP_BENEDICTION_HYMN = makeRadiantHymn();

const BASE_WARD = makeDaybreakWard({
  name: 'Daybreak Ward',
  shieldFormula: '0.14 * hpmax',
});

const UP_WARD_SOLSTICE = makeDaybreakWard({
  name: 'Daybreak Ward: Solstice Ward',
  shieldFormula: '0.16 * hpmax',
  allyHasten: 0.25,
});

const UP_WARD_AEGIS = makeSunlitAegis();

const BASE_LAST_LIGHT = makeLastLight({
  name: 'Last Light',
  healFormula: '0.28 * hpmax',
});

const UP_LAST_LIGHT_ETERNAL = makeLastLight({
  name: 'Last Light: Eternal Dawn',
  healFormula: '0.36 * hpmax',
  extraOps: [{ op: 'shield', amount: f('0.15 * hpmax') }],
});

const UP_LAST_LIGHT_PHOENIX = makeLastLight({
  name: 'Last Light: Phoenix Rebuke',
  healFormula: '0.28 * hpmax',
  extraOps: [{ op: 'mana', when: 'use', amount: f('15') }],
});

/** Base Dawnbringer signature (before skill-tree nodes are folded on top). */
export const DAWNBRINGER_SIGNATURE: ClassSignature = {
  className: 'Dawnbringer',
  bonus: { dis: 3, pre: 3, manaMax: 35 },
  worn: BASE_RISING,
  actives: [BASE_SUNLANCE, BASE_BENEDICTION, BASE_WARD, BASE_LAST_LIGHT],
};

// ── 38-node / 32-buyable Mythic skill tree ──
// Three branches: Ascent (a: solar offense, penetration, Ascension scalers), Mercy (b: healing, mana, haste, Last Light),
// Light (c: HP, defense, wards, Will and tenacity).

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

/** Full 9-depth, 3-branch, 32-buyable (38-node) Mythic Dawnbringer skill tree. */
export const DAWNBRINGER_TREE: ClassTree = {
  className: 'Dawnbringer',
  rarity: 'mythic',
  nodes: [
    // Depth 1: Root (1)
    node('dawn-root', 1, 'First Dawn', 'Gain 2 Discipline, 2 Presence, and 10 max mana.', [], [
      bonus({ dis: 2, pre: 2, manaMax: 10 }),
    ]),

    // Depth 2: Three branches (3) — Ascent (a), Mercy (b), Light (c)
    node('dawn-a2', 2, 'Solar Ascent', 'Gain 3 Presence and 3 Accuracy.', ['dawn-root'], [
      bonus({ pre: 3, aim: 3 }),
    ]),
    node('dawn-b2', 2, "Mercy's Well", 'Gain 10 max mana and 3% heal and shield bonus.', ['dawn-root'], [
      bonus({ manaMax: 10, healPower: 3 }),
    ]),
    node('dawn-c2', 2, 'Daybreak Vigil', 'Gain 3 max HP and 3 Discipline.', ['dawn-root'], [
      bonus({ hpMax: 3, dis: 3 }),
    ]),

    // Depth 3: Branch splits (6)
    node('dawn-a3x', 3, 'Sunfire Reach', 'Gain 14% magic penetration and 12 flat magic penetration.', ['dawn-a2'], [
      bonus({ resistPen: 14, resistPenFlat: 12 }),
    ]),
    node('dawn-a3y', 3, 'Zenith Spark', 'Gain 3 Presence and 1 extra crit face.', ['dawn-a2'], [
      bonus({ pre: 3, critFaces: 1 }),
    ]),
    node('dawn-b3x', 3, 'Healing Chalice', 'Gain 2% heal and shield bonus and 5 max mana.', ['dawn-b2'], [
      bonus({ healPower: 2, manaMax: 5 }),
    ]),
    node('dawn-b3y', 3, 'Dawn Cadence', 'Gain 4 ability haste and 2 speed.', ['dawn-b2'], [
      bonus({ haste: 4, speed: 2 }),
    ]),
    node('dawn-c3x', 3, 'Sunlit Frame', 'Gain 3 max HP and 4 tenacity.', ['dawn-c2'], [
      bonus({ hpMax: 3, tenacity: 4 }),
    ]),
    node('dawn-c3y', 3, 'Sanctified Will', 'Gain 3 Discipline and 4 Will.', ['dawn-c2'], [
      bonus({ dis: 3, will: 4 }),
    ]),

    // Depth 4: Deepening (6)
    node('dawn-a4x', 4, 'Noon Pierce', 'Gain 14% magic penetration and 12 flat magic penetration.', ['dawn-a3x'], [
      bonus({ resistPen: 14, resistPenFlat: 12 }),
    ]),
    node('dawn-a4y', 4, 'Helios Focus', 'Gain 3 Accuracy and 0.06 crit multiplier.', ['dawn-a3y'], [
      bonus({ aim: 3, critSize: 6 }),
    ]),
    node('dawn-b4x', 4, 'Bountiful Grace', 'Gain 2% heal and shield bonus and 10 max mana.', ['dawn-b3x'], [
      bonus({ healPower: 2, manaMax: 10 }),
    ]),
    node('dawn-b4y', 4, 'Lightbringer Haste', 'Gain 4 ability haste and 3% ability cost reduction.', ['dawn-b3y'], [
      bonus({ haste: 4, costCut: 3 }),
    ]),
    node('dawn-c4x', 4, 'Golden Bastion', 'Gain 3 max HP and 4 tenacity.', ['dawn-c3x'], [
      bonus({ hpMax: 3, tenacity: 4 }),
    ]),
    node('dawn-c4y', 4, 'Unwavering Dawn', 'Gain 3 Discipline and 4 Will.', ['dawn-c3y'], [
      bonus({ dis: 3, will: 4 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('dawn-a5-l', 5, 'Blazing Lance', 'Upgrade Sunlance to deal stronger support and Will damage with 50% stagger.', ['dawn-a4x', 'dawn-a4y'], [
      replaceActive(ID_SUNLANCE, UP_SUNLANCE_BLAZING),
    ], { forkGroup: 'dawn-a5' }),
    node('dawn-a5-r', 5, 'Solar Judgment', 'Upgrade Sunlance with a 3-round cooldown that also stuns the target for 1 round.', ['dawn-a4x', 'dawn-a4y'], [
      replaceActive(ID_SUNLANCE, UP_SUNLANCE_JUDGMENT),
    ], { forkGroup: 'dawn-a5' }),

    node('dawn-b5-l', 5, 'Overflowing Grace', 'Upgrade Benediction to heal for much more support and Will power.', ['dawn-b4x', 'dawn-b4y'], [
      replaceActive(ID_BENEDICTION, UP_BENEDICTION_GRACE),
    ], { forkGroup: 'dawn-b5' }),
    node('dawn-b5-r', 5, 'Radiant Hymn', 'Upgrade Benediction to heal and cleanse you and all allies within 2 tiles.', ['dawn-b4x', 'dawn-b4y'], [
      replaceActive(ID_BENEDICTION, UP_BENEDICTION_HYMN),
    ], { forkGroup: 'dawn-b5' }),

    node('dawn-c5-l', 5, 'Solstice Ward', 'Upgrade Daybreak Ward to shield for 16% of max HP and hasten another ally by 25%.', ['dawn-c4x', 'dawn-c4y'], [
      replaceActive(ID_WARD, UP_WARD_SOLSTICE),
    ], { forkGroup: 'dawn-c5' }),
    node('dawn-c5-r', 5, 'Sunlit Aegis', 'Upgrade Daybreak Ward to shield you and all allies within 2 tiles and grant Dawn Safeguard for 1 round.', ['dawn-c4x', 'dawn-c4y'], [
      replaceActive(ID_WARD, UP_WARD_AEGIS),
    ], { forkGroup: 'dawn-c5' }),

    // Depth 6: Post-fork convergence (6)
    node('dawn-a6x', 6, 'Corona Piercer', 'Gain 14% magic penetration and 14 flat magic penetration.', ['dawn-a5-l', 'dawn-a5-r'], [
      bonus({ resistPen: 14, resistPenFlat: 14 }),
    ], { parentMode: 'any' }),
    node('dawn-a6y', 6, 'Solar Apex', 'Gain 3 Presence and 3 Accuracy.', ['dawn-a5-l', 'dawn-a5-r'], [
      bonus({ pre: 3, aim: 3 }),
    ], { parentMode: 'any' }),
    node('dawn-b6x', 6, 'Deep Mercy', 'Gain 10 max mana and 2% heal and shield bonus.', ['dawn-b5-l', 'dawn-b5-r'], [
      bonus({ manaMax: 10, healPower: 2 }),
    ], { parentMode: 'any' }),
    node('dawn-b6y', 6, 'Quickened Hymn', 'Gain 4 ability haste and 3 speed.', ['dawn-b5-l', 'dawn-b5-r'], [
      bonus({ haste: 4, speed: 3 }),
    ], { parentMode: 'any' }),
    node('dawn-c6x', 6, 'Radiant Plate', 'Gain 3 max HP and 4 tenacity.', ['dawn-c5-l', 'dawn-c5-r'], [
      bonus({ hpMax: 3, tenacity: 4 }),
    ], { parentMode: 'any' }),
    node('dawn-c6y', 6, 'Hallowed Tenacity', 'Gain 5 tenacity and 4 Will.', ['dawn-c5-l', 'dawn-c5-r'], [
      bonus({ tenacity: 5, will: 4 }),
    ], { parentMode: 'any' }),

    // Depth 7: Second Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('dawn-a7-l', 7, 'High Noon', 'Gain 3 Accuracy and deal up to 18% more damage while above half HP.', ['dawn-a6x', 'dawn-a6y'], [
      bonus({ aim: 3 }),
      scaler({ measure: 'user', dir: 'over', start: 0.5, scale: 0.18 }),
    ], { forkGroup: 'dawn-a7' }),
    node('dawn-a7-r', 7, 'Radiant Breaker', 'Gain 6 potency and deal up to 18% more damage to foes with higher max HP than you.', ['dawn-a6x', 'dawn-a6y'], [
      bonus({ potency: 6 }),
      scaler({ measure: 'maxPair', dir: 'over', start: 0.5, scale: 0.18 }),
    ], { forkGroup: 'dawn-a7' }),

    node('dawn-b7-l', 7, 'Eternal Dawn', 'Upgrade Last Light to heal 36% of max HP and grant a 15% max HP shield.', ['dawn-b6x', 'dawn-b6y'], [
      replaceActive(ID_LAST_LIGHT, UP_LAST_LIGHT_ETERNAL),
    ], { forkGroup: 'dawn-b7' }),
    node('dawn-b7-r', 7, 'Phoenix Rebuke', 'Upgrade Last Light to also restore 15 mana when it fires.', ['dawn-b6x', 'dawn-b6y'], [
      replaceActive(ID_LAST_LIGHT, UP_LAST_LIGHT_PHOENIX),
    ], { forkGroup: 'dawn-b7' }),

    node('dawn-c7-l', 7, 'Sunlit Bulwark', 'Gain 3 max HP, 3% heal and shield bonus, and 5 tenacity.', ['dawn-c6x', 'dawn-c6y'], [
      bonus({ hpMax: 3, healPower: 3, tenacity: 5 }),
    ], { forkGroup: 'dawn-c7' }),
    node('dawn-c7-r', 7, 'Hallowed Focus', 'Gain 3 max HP, 12 Will, and 12 tenacity.', ['dawn-c6x', 'dawn-c6y'], [
      bonus({ hpMax: 3, will: 12, tenacity: 12 }),
    ], { forkGroup: 'dawn-c7' }),

    // Depth 8: Branch Capstones (3)
    node('dawn-a8', 8, 'Zenith Mastery', 'Gain 3 Presence, 12 flat magic penetration, and 0.06 crit multiplier.', ['dawn-a7-l', 'dawn-a7-r'], [
      bonus({ pre: 3, resistPenFlat: 12, critSize: 6 }),
    ], { parentMode: 'any' }),
    node('dawn-b8', 8, 'Merciful Tide', 'Gain 4 ability haste, 3 speed, and 2% heal and shield bonus.', ['dawn-b7-l', 'dawn-b7-r'], [
      bonus({ haste: 4, speed: 3, healPower: 2 }),
    ], { parentMode: 'any' }),
    node('dawn-c8', 8, 'Dawn Sanctuary', 'Gain 4 Discipline, 5 Will, and 5 tenacity.', ['dawn-c7-l', 'dawn-c7-r'], [
      bonus({ dis: 4, will: 5, tenacity: 5 }),
    ], { parentMode: 'any' }),

    // Depth 9: Monarch Capstone (1)
    node('dawn-cap', 9, 'Avatar of Dawn', 'Upgrade Rising Dawn to Avatar of Dawn and gain 4 Discipline and 4 Presence.', ['dawn-a8', 'dawn-b8', 'dawn-c8'], [
      replaceWorn(KEY_RISING, AVATAR_RISING),
      bonus({ dis: 4, pre: 4 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
