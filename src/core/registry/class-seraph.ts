// class-seraph.ts: Epic Seraph (dis+pre) signature kit and full 26-node / 23-buyable skill tree.
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
import type { Op, Reach, StatusDef, StatusKey, UseOp } from '../combat/effect-ops.ts';
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
  if (!id) throw new Error(`Invalid Seraph node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Seraph formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };
const ONCE: Limit = { kind: 'fight', n: 1 };
const area = (radius: number, on: 'allies' | 'foes'): Reach => ({ kind: 'area', radius: tiles(radius), on });
const LOW_HP_PCT = Math.round(R.fight.kit.lowHpAt * 100);

const KEY_GRACE = statusKey('seraph-grace');
const KEY_GRACE_ARCH = statusKey('seraph-grace-archangel');
const KEY_HALO_WARD = statusKey('seraph-halo-ward');
const KEY_HALO_SAFE = statusKey('seraph-halo-safe');
const KEY_HALO_BOON = statusKey('seraph-halo-boon');
const KEY_LIGHT = statusKey('seraph-light');
const KEY_LIGHT_UP = statusKey('seraph-light-ii');
const KEY_CHOIR = statusKey('seraph-choir');
const KEY_CHOIR_UP = statusKey('seraph-choir-ii');
const KEY_JUDGED = statusKey('seraph-judged');
const KEY_JUDGED_UP = statusKey('seraph-judged-ii');

const ID_HALO = abilityId('seraph-halo');
const ID_MEND = abilityId('seraph-mend');
const ID_SANCTUARY = abilityId('seraph-sanctuary');
const ID_JUDGMENT = abilityId('seraph-judgment');

// ── statuses ──

const HALO_WARD: StatusDef = {
  label: 'Deathless Halo',
  desc: 'Cannot drop below 1 HP for 1 round.',
  ops: [{ op: 'invulnerable' }],
};

const HALO_SAFE: StatusDef = {
  label: 'Hallowed Ward',
  desc: 'Blocks harmful statuses from foes for 1 round.',
  ops: [{ op: 'safeguard' }],
};

const HALO_BOON: StatusDef = {
  label: 'Miracle Vow',
  desc: 'Deals 15% more damage for 1 round.',
  ops: [{ op: 'share', on: 'dealt', pct: 15 }],
};

const LIGHT_DEF: StatusDef = {
  label: 'Seraphic Light',
  desc: 'Takes 10% less damage.',
  ops: [{ op: 'share', on: 'taken', pct: -10 }],
};

const LIGHT_UP_DEF: StatusDef = {
  label: 'Radiant Light',
  desc: 'Takes 15% less damage.',
  ops: [{ op: 'share', on: 'taken', pct: -15 }],
};

const JUDGED_DEF: StatusDef = {
  label: 'Judged',
  desc: 'Deals 15% less damage, and attacks against it crit on 1 more die face.',
  ops: [
    { op: 'share', on: 'dealt', pct: -15 },
    { op: 'sheet', key: 'exposed', amount: 1 },
  ],
};

const JUDGED_UP_DEF: StatusDef = {
  label: 'Searing Verdict',
  desc: 'Deals 20% less damage, and attacks against it crit on 1 more die face.',
  ops: [
    { op: 'share', on: 'dealt', pct: -20 },
    { op: 'sheet', key: 'exposed', amount: 1 },
  ],
};

function makeSeraphGrace(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly auraRadius: number;
  readonly healedPct: number;
  readonly takenPct: number;
  readonly supportShield: string;
  readonly lowHpHeal: string;
  readonly lowHpDispel: 'first' | 'all';
}): ClassWorn {
  const ops: Op[] = [
    { op: 'aura', radius: o.auraRadius, on: 'allies' },
    { op: 'share', on: 'healed', pct: o.healedPct },
    ...(o.takenPct !== 0 ? [{ op: 'share', on: 'taken', pct: o.takenPct } as const] : []),
  ];
  const triggers: Trigger[] = [
    { on: 'used', tag: KIND_TAG.support, to: area(o.auraRadius, 'allies'), limit: ROUND, ops: [{ op: 'shield', amount: f(o.supportShield) }] },
    {
      on: 'lowHp',
      to: 'self',
      limit: ONCE,
      ops: [
        { op: 'heal', when: 'use', amount: f(o.lowHpHeal) },
        { op: 'dispel', which: o.lowHpDispel },
      ],
    },
  ];
  return { key: o.key, def: { label: o.label, desc: o.desc, ops, triggers } };
}

const BASE_GRACE: ClassWorn = makeSeraphGrace({
  key: KEY_GRACE,
  label: 'Six-Winged Grace',
  desc: `You and allies within 3 tiles receive 15% more healing. Once a round when you use a support ability, shield yourself and allies within 3 tiles. Once a fight below ${LOW_HP_PCT}% HP, heal 15% of max HP and end your oldest harmful status.`,
  auraRadius: 3,
  healedPct: 15,
  takenPct: 0,
  supportShield: '0.12 * sup',
  lowHpHeal: '0.15 * hpmax',
  lowHpDispel: 'first',
});

const ARCHANGEL_GRACE: ClassWorn = makeSeraphGrace({
  key: KEY_GRACE_ARCH,
  label: 'Archangel of Mercy',
  desc: `You and allies within 4 tiles receive 20% more healing and take 10% less damage. Once a round when you use a support ability, shield yourself and allies within 4 tiles. Once a fight below ${LOW_HP_PCT}% HP, heal 25% of max HP and end all harmful statuses on you.`,
  auraRadius: 4,
  healedPct: 20,
  takenPct: -10,
  supportShield: '0.22 * sup',
  lowHpHeal: '0.25 * hpmax',
  lowHpDispel: 'all',
});

// ── active ability builders ──

function makeHalo(o: {
  readonly name: string;
  readonly reachTiles: number;
  readonly cooldownRounds: number;
  readonly healFormula: string;
  readonly withBoon: boolean;
}): Ability {
  const base = abilityOf('support', {
    id: ID_HALO,
    name: o.name,
    desc: o.withBoon
      ? `Lethal reaction. Heal an ally within ${o.reachTiles} tiles and grant Deathless Halo, Hallowed Ward, and Miracle Vow for 1 round.`
      : `Lethal reaction. Heal an ally within ${o.reachTiles} tiles and grant Deathless Halo and Hallowed Ward for 1 round.`,
    aim: 'ally',
    range: tiles(o.reachTiles),
    shape: { kind: 'touch', reach: tiles(o.reachTiles) },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'heal', by: 'hand', formula: f(o.healFormula) },
    ops: [
      { op: 'applyStatus', key: KEY_HALO_WARD, def: HALO_WARD, duration: rounds(1) },
      { op: 'applyStatus', key: KEY_HALO_SAFE, def: HALO_SAFE, duration: rounds(1) },
      ...(o.withBoon ? [{ op: 'applyStatus', key: KEY_HALO_BOON, def: HALO_BOON, duration: rounds(1) } as const] : []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 6, fatigue: 4, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds) },
    react: { when: 'lethal', reach: tiles(o.reachTiles) },
  };
}

function makeMend(o: {
  readonly name: string;
  readonly desc: string;
  readonly effectType: 'heal' | 'shield';
  readonly formula: string;
  readonly dispel: 'first' | 'all';
  readonly lightKey: StatusKey;
  readonly lightDef: StatusDef;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('support', {
    id: ID_MEND,
    name: o.name,
    desc: o.desc,
    aim: 'ally',
    range: tiles(6),
    shape: { kind: 'touch', reach: tiles(6) },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: o.effectType, by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'dispel', which: o.dispel },
      { op: 'applyStatus', key: o.lightKey, def: o.lightDef, duration: rounds(2) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 4, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(1) },
  };
}

function makeSanctuary(o: {
  readonly name: string;
  readonly choirKey: StatusKey;
  readonly shieldFormula: string;
  readonly pulseHealFormula: string;
  readonly hastenShare: number;
  readonly zoneRounds: number;
  readonly zoneTakenPct: number;
}): Ability {
  // Periodic heal runs via a turnStart trigger on Seraph so `sup` and `healPower` always read Seraph's own stats,
  // while the moving Sanctuary zone cuts incoming damage for allies standing inside it (sparing foes).
  const choirDef: StatusDef = {
    label: o.name,
    desc: `Shields you and allies within 3 tiles, hastens allies by ${Math.round(o.hastenShare * 100)}%, and heals you and allies within 3 tiles at the start of each of your turns.`,
    ops: [],
    triggers: [
      {
        on: 'statusGained',
        key: o.choirKey,
        to: area(3, 'allies'),
        limit: EACH,
        ops: [
          { op: 'shield', amount: f(o.shieldFormula) },
          { op: 'hasten', share: o.hastenShare },
        ],
      },
      {
        on: 'turnStart',
        to: area(3, 'allies'),
        limit: EACH,
        ops: [{ op: 'heal', when: 'use', amount: f(o.pulseHealFormula) }],
      },
    ],
  };
  const base = abilityOf('support', {
    id: ID_SANCTUARY,
    name: o.name,
    desc: `Create a 3-tile Sanctuary aura around you for ${o.zoneRounds} rounds that cuts ally damage taken by ${Math.abs(o.zoneTakenPct)}%, shields and hastens nearby allies, and heals them each turn.`,
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: null,
    ops: [{ op: 'applyStatus', key: o.choirKey, def: choirDef, duration: rounds(o.zoneRounds) }],
    zone: {
      name: 'Sanctuary',
      duration: rounds(o.zoneRounds),
      around: tiles(3),
      endsWithOwner: true,
      grow: null,
      ops: [{ op: 'share', on: 'taken', pct: o.zoneTakenPct }],
    },
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 8, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(4) },
  };
}

function makeJudgment(o: {
  readonly name: string;
  readonly cooldownRounds: number;
  readonly formula: string;
  readonly judgedKey: StatusKey;
  readonly judgedDef: StatusDef;
  readonly staggerShare: number;
}): Ability {
  const base = abilityOf('curse', {
    id: ID_JUDGMENT,
    name: o.name,
    desc: o.staggerShare > 0
      ? `Deal arcane damage to a foe within 7 tiles, apply ${o.judgedDef.label} for 2 rounds, and fill ${Math.round(o.staggerShare * 100)}% stagger.`
      : `Deal arcane damage to a foe within 7 tiles and apply ${o.judgedDef.label} for 2 rounds.`,
    aim: 'foe',
    range: tiles(7),
    shape: { kind: 'touch', reach: tiles(7) },
    delivery: { kind: 'direct' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'applyStatus', key: o.judgedKey, def: o.judgedDef, duration: rounds(2) },
      ...(o.staggerShare > 0 ? [{ op: 'stagger', share: o.staggerShare } as const] : []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 4, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

const BASE_HALO = makeHalo({
  name: 'Deathless Halo',
  reachTiles: 4,
  cooldownRounds: 4,
  healFormula: '1.2 * sup',
  withBoon: false,
});

const UP_HALO = makeHalo({
  name: 'Deathless Halo: Miracle',
  reachTiles: 6,
  cooldownRounds: 3,
  healFormula: '1.6 * sup',
  withBoon: true,
});

const BASE_MEND = makeMend({
  name: 'Radiant Mend',
  desc: 'Heal an ally within 6 tiles, cleanse one harmful status, and grant Seraphic Light for 2 rounds.',
  effectType: 'heal',
  formula: '1d8 + 1.5 * sup',
  dispel: 'first',
  lightKey: KEY_LIGHT,
  lightDef: LIGHT_DEF,
});

const UP_MEND_HALLOWED = makeMend({
  name: 'Radiant Mend: Hallowed',
  desc: 'Heal and shield an ally within 6 tiles, cleanse all harmful statuses, and grant Radiant Light for 2 rounds.',
  effectType: 'heal',
  formula: '1d8 + 1.5 * sup',
  dispel: 'all',
  lightKey: KEY_LIGHT_UP,
  lightDef: LIGHT_UP_DEF,
  extraOps: [{ op: 'shield', amount: f('0.6 * sup') }],
});

const UP_MEND_AEGIS = makeMend({
  name: 'Radiant Mend: Aegis of Dawn',
  desc: 'Shield an ally within 6 tiles, cleanse one harmful status, hasten them by 15%, and grant Seraphic Light for 2 rounds.',
  effectType: 'shield',
  formula: '1d8 + 1.65 * sup',
  dispel: 'first',
  lightKey: KEY_LIGHT,
  lightDef: LIGHT_DEF,
  extraOps: [{ op: 'hasten', share: 0.15 }],
});

const BASE_SANCTUARY = makeSanctuary({
  name: 'Sanctuary Choir',
  choirKey: KEY_CHOIR,
  shieldFormula: '0.45 * sup',
  pulseHealFormula: '0.25 * sup',
  hastenShare: 0.15,
  zoneRounds: 3,
  zoneTakenPct: -15,
});

const UP_SANCTUARY = makeSanctuary({
  name: 'Sanctuary Choir: Undying',
  choirKey: KEY_CHOIR_UP,
  shieldFormula: '0.65 * sup',
  pulseHealFormula: '0.35 * sup',
  hastenShare: 0.2,
  zoneRounds: 3,
  zoneTakenPct: -20,
});

const BASE_JUDGMENT = makeJudgment({
  name: 'Judgment Lance',
  cooldownRounds: 2,
  formula: '1d8 + 0.85 * sup',
  judgedKey: KEY_JUDGED,
  judgedDef: JUDGED_DEF,
  staggerShare: 0,
});

const UP_JUDGMENT = makeJudgment({
  name: 'Judgment Lance: Verdict',
  cooldownRounds: 1,
  formula: '2d6 + sup',
  judgedKey: KEY_JUDGED_UP,
  judgedDef: JUDGED_UP_DEF,
  staggerShare: 0.2,
});

/** Base Seraph signature (before skill-tree nodes are folded on top). */
export const SERAPH_SIGNATURE: ClassSignature = {
  className: 'Seraph',
  bonus: { dis: 2, pre: 2, healPower: 3 },
  worn: BASE_GRACE,
  actives: [BASE_HALO, BASE_MEND, BASE_SANCTUARY, BASE_JUDGMENT],
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

/** Full 7-depth, 3-branch, 23-buyable (26-node) Epic Seraph skill tree. */
export const SERAPH_TREE: ClassTree = {
  className: 'Seraph',
  rarity: 'epic',
  nodes: [
    // Depth 1: Root (1)
    node('seraph-root', 1, 'First Wing', 'Gain 3 Discipline, 3 Presence, and 4% heal and shield bonus.', [], [
      bonus({ dis: 3, pre: 3, healPower: 4 }),
    ]),

    // Depth 2: Three branches (3)
    node('seraph-a2', 2, 'Hymn of Mercy', 'Gain 5% heal and shield bonus and 3 Presence.', ['seraph-root'], [
      bonus({ healPower: 5, pre: 3 }),
    ]),
    node('seraph-b2', 2, 'Sacred Vigil', 'Gain 4 Discipline and 4 tenacity.', ['seraph-root'], [
      bonus({ dis: 4, tenacity: 4 }),
    ]),
    node('seraph-c2', 2, 'Spear of Dawn', 'Gain 4 Presence and 3 accuracy.', ['seraph-root'], [
      bonus({ pre: 4, aim: 3 }),
    ]),

    // Depth 3: Branch splits (6)
    node('seraph-a3x', 3, 'Devout Chalice', 'Gain 5% heal and shield bonus and 5 max mana.', ['seraph-a2'], [
      bonus({ healPower: 5, manaMax: 5 }),
    ]),
    node('seraph-a3y', 3, 'Swift Prayer', 'Gain 6 ability haste and 3 Presence.', ['seraph-a2'], [
      bonus({ haste: 6, pre: 3 }),
    ]),
    node('seraph-b3x', 3, 'Clear Mind', 'Gain 4 Discipline and 4 Will.', ['seraph-b2'], [
      bonus({ dis: 4, will: 4 }),
    ]),
    node('seraph-b3y', 3, 'Martyr Frame', 'Gain 25 max HP and 5 tenacity.', ['seraph-b2'], [
      bonus({ hpMax: 25, tenacity: 5 }),
    ]),
    node('seraph-c3x', 3, 'Radiant Pierce', 'Gain 5% magic penetration and 5 flat magic penetration.', ['seraph-c2'], [
      bonus({ resistPen: 5, resistPenFlat: 5 }),
    ]),
    node('seraph-c3y', 3, 'Zealous Cadence', 'Gain 4 Presence and 6 ability haste.', ['seraph-c2'], [
      bonus({ pre: 4, haste: 6 }),
    ]),

    // Depth 4: Deepening (6)
    node('seraph-a4x', 4, 'Overflowing Well', 'Gain 6% heal and shield bonus and 6 max mana.', ['seraph-a3x'], [
      bonus({ healPower: 6, manaMax: 6 }),
    ]),
    node('seraph-a4y', 4, 'Measured Vow', 'Gain 8 ability haste and 4% ability cost reduction.', ['seraph-a3y'], [
      bonus({ haste: 8, costCut: 4 }),
    ]),
    node('seraph-b4x', 4, 'Serene Resolve', 'Gain 5 Discipline and 5 Will.', ['seraph-b3x'], [
      bonus({ dis: 5, will: 5 }),
    ]),
    node('seraph-b4y', 4, 'Unshaken Choir', 'Gain 30 max HP and 5% channel break threshold.', ['seraph-b3y'], [
      bonus({ hpMax: 30, hold: 5 }),
    ]),
    node('seraph-c4x', 4, 'Shatter Shadow', 'Gain 6% magic penetration and 6 flat magic penetration.', ['seraph-c3x'], [
      bonus({ resistPen: 6, resistPenFlat: 6 }),
    ]),
    node('seraph-c4y', 4, 'Blinding Edge', 'Gain 5 Presence and 1 extra crit face.', ['seraph-c3y'], [
      bonus({ pre: 5, critFaces: 1 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('seraph-a5-l', 5, 'Hallowed Mend', 'Upgrade Radiant Mend to remove all harmful statuses, add a support-scaled shield, and cut damage taken by 15%.', ['seraph-a4x', 'seraph-a4y'], [
      replaceActive(ID_MEND, UP_MEND_HALLOWED),
    ], { forkGroup: 'seraph-a5' }),
    node('seraph-a5-r', 5, 'Aegis of Dawn', 'Convert Radiant Mend into a large preventive shield that dispels one harmful status and hastens the ally by 15%.', ['seraph-a4x', 'seraph-a4y'], [
      replaceActive(ID_MEND, UP_MEND_AEGIS),
    ], { forkGroup: 'seraph-a5' }),

    node('seraph-b5-l', 5, 'Undying Choir', 'Upgrade Sanctuary Choir to 20% damage reduction, stronger support-scaled turn healing, larger shields, and 20% hasten.', ['seraph-b4x', 'seraph-b4y'], [
      replaceActive(ID_SANCTUARY, UP_SANCTUARY),
    ], { forkGroup: 'seraph-b5' }),
    node('seraph-b5-r', 5, 'Miracle Halo', 'Upgrade Deathless Halo to 6-tile reach, 3-round cooldown, stronger healing, and 15% bonus damage for 1 round.', ['seraph-b4x', 'seraph-b4y'], [
      replaceActive(ID_HALO, UP_HALO),
    ], { forkGroup: 'seraph-b5' }),

    node('seraph-c5-l', 5, 'Searing Verdict', 'Upgrade Judgment Lance to a 1-round cooldown, higher arcane damage, 20% stagger, and 20% foe damage reduction.', ['seraph-c4x', 'seraph-c4y'], [
      replaceActive(ID_JUDGMENT, UP_JUDGMENT),
    ], { forkGroup: 'seraph-c5' }),
    node('seraph-c5-r', 5, 'Smite the Wicked', 'Gain 5 Presence and 8% magic penetration. Your damaging attacks and spells deal up to 25% more damage to foes above half HP.', ['seraph-c4x', 'seraph-c4y'], [
      bonus({ pre: 5, resistPen: 8 }),
      scaler({ measure: 'target', dir: 'over', start: 0.5, scale: 0.25 }),
    ], { forkGroup: 'seraph-c5' }),

    // Depth 6: Branch Capstones (3)
    node('seraph-a6', 6, 'Chalice of Dawn', 'Gain 8% heal and shield bonus, 8 ability haste, and 4 Presence.', ['seraph-a5-l', 'seraph-a5-r'], [
      bonus({ healPower: 8, haste: 8, pre: 4 }),
    ], { parentMode: 'any' }),
    node('seraph-b6', 6, 'Six-Winged Aegis', 'Gain 6 Discipline, 35 max HP, and 6 tenacity.', ['seraph-b5-l', 'seraph-b5-r'], [
      bonus({ dis: 6, hpMax: 35, tenacity: 6 }),
    ], { parentMode: 'any' }),
    node('seraph-c6', 6, 'Halo of Fire', 'Gain 6 Presence, 8 flat magic penetration, and 0.1 crit multiplier.', ['seraph-c5-l', 'seraph-c5-r'], [
      bonus({ pre: 6, resistPenFlat: 8, critSize: 10 }),
    ], { parentMode: 'any' }),

    // Depth 7: Epic Capstone (1)
    node('seraph-cap', 7, 'Archangel of Mercy', 'Upgrade Six-Winged Grace to Archangel of Mercy and gain 6 Discipline, 6 Presence, and 6% heal and shield bonus.', ['seraph-a6', 'seraph-b6', 'seraph-c6'], [
      replaceWorn(KEY_GRACE, ARCHANGEL_GRACE),
      bonus({ dis: 6, pre: 6, healPower: 6 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
