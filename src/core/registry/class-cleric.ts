// class-cleric.ts: Rare Cleric (Healer branch, dis+pre) signature kit and full 18-node / 16-buyable tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
//
// Disciplined ward-and-censure priest: shields allies with Consecrated safeguard, weakens foes with arcane censure,
// and sustains mana and HP whenever using a support ability.
// Root budget at rank C (`RULES.rarities.rare.rank = 'C'`, level 20, settled.md ~12-point Rare unspecialized root):
// - Sheet bonus `{ dis: 1, pre: 1 }` spends 2.00 pts.
// - Worn `Devoted Light` restores 4 mana and heals `0.02 * hpmax` once a round on any support ability use.
// - Actives (`Votive Ward`, `Radiant Censure`) fit worth.ts C-rank budgets (`arcane` damage, never draft `'radiant'`).
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { Reach, StatusDef, StatusKey, Tiers, UseOp } from '../combat/effect-ops.ts';
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
  if (!id) throw new Error(`Invalid Cleric node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Cleric formula "${text}"`);
  return p.formula;
};
const tiered = (e: string, d: string, c: string, b: string, a: string, s: string): Tiers<Formula> =>
  [f(e), f(d), f(c), f(b), f(a), f(s)];
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };
const area = (radius: number, on: 'allies' | 'foes'): Reach => ({ kind: 'area', radius: tiles(radius), on });

const KEY_DEVOTED = statusKey('cleric-devoted-light');
const KEY_DEVOTED_UP = statusKey('cleric-high-votive');
const KEY_CONSECRATED = statusKey('cleric-consecrated');
const KEY_CONSECRATED_UP = statusKey('cleric-consecrated-ii');
const KEY_AEGIS_PRAYER = statusKey('cleric-aegis-prayer');
const KEY_HUMBLED = statusKey('cleric-humbled');
const KEY_HUMBLED_UP = statusKey('cleric-humbled-ii');
const KEY_SEARING = statusKey('cleric-searing-censure');

const ID_WARD = abilityId('cleric-votive-ward');
const ID_CENSURE = abilityId('cleric-radiant-censure');

// ── statuses ──

const CONSECRATED: StatusDef = {
  label: 'Consecrated',
  desc: 'Blocks harmful statuses from foes and adds 8 armor and 8 magic resist for 1 round.',
  ops: [
    { op: 'safeguard' },
    { op: 'sheet', key: 'armor', amount: f('8') },
    { op: 'sheet', key: 'resist', amount: f('8') },
  ],
};

const CONSECRATED_UP: StatusDef = {
  label: 'Consecrated Vow',
  desc: 'Blocks harmful statuses from foes and adds 12 armor and 12 magic resist for 1 round.',
  ops: [
    { op: 'safeguard' },
    { op: 'sheet', key: 'armor', amount: f('12') },
    { op: 'sheet', key: 'resist', amount: f('12') },
  ],
};

const AEGIS_PRAYER_PULSE: StatusDef = {
  label: 'Aegis Prayer',
  desc: 'Shields you and allies within 2 tiles and grants Consecrated for 1 round.',
  ops: [],
  triggers: [
    {
      on: 'statusGained',
      key: KEY_AEGIS_PRAYER,
      to: area(2, 'allies'),
      limit: EACH,
      ops: [
        { op: 'shield', amount: f('1d8 + 0.9 * sup') },
        { op: 'applyStatus', key: KEY_CONSECRATED, def: CONSECRATED, duration: rounds(1) },
      ],
    },
  ],
};

const HUMBLED: StatusDef = {
  label: 'Humbled',
  desc: 'Deals 12% less damage and attacks against this target crit on 1 more die face for 2 rounds.',
  ops: [
    { op: 'share', on: 'dealt', pct: -12 },
    { op: 'sheet', key: 'exposed', amount: 1 },
  ],
};

const HUMBLED_UP: StatusDef = {
  label: 'Blinded Censure',
  desc: 'Deals 18% less damage and attacks against this target crit on 1 more die face for 2 rounds.',
  ops: [
    { op: 'share', on: 'dealt', pct: -18 },
    { op: 'sheet', key: 'exposed', amount: 1 },
  ],
};

const SEARING_CENSURE: StatusDef = {
  label: 'Searing Censure',
  desc: 'Deals 12% less damage, exposes 1 more crit face, and takes arcane burn damage each round for 2 rounds.',
  ops: [
    { op: 'share', on: 'dealt', pct: -12 },
    { op: 'sheet', key: 'exposed', amount: 1 },
    { op: 'damage', type: 'arcane', when: 'turn', amount: tiered('1d4', '1d6', '1d8', '2d6', '2d8', '3d6') },
  ],
};

function makeDevotedLight(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly manaGain: string;
  readonly selfHeal: string;
  readonly extraTriggers?: readonly Trigger[];
}): ClassWorn {
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [],
      triggers: [
        {
          on: 'used',
          tag: KIND_TAG.support,
          to: 'self',
          limit: ROUND,
          ops: [
            { op: 'mana', when: 'use', amount: f(o.manaGain) },
            { op: 'heal', when: 'use', amount: f(o.selfHeal) },
          ],
        },
        ...(o.extraTriggers ?? []),
      ],
    },
  };
}

const BASE_DEVOTED: ClassWorn = makeDevotedLight({
  key: KEY_DEVOTED,
  label: 'Devoted Light',
  desc: 'Once a round when you use a support ability, restore 4 mana and heal 2% of your max HP.',
  manaGain: '4',
  selfHeal: '0.02 * hpmax',
});

const HIGH_VOTIVE: ClassWorn = makeDevotedLight({
  key: KEY_DEVOTED_UP,
  label: 'High Votive',
  desc: 'Once a round when you use a support ability, restore 6 mana, heal 3% of your max HP, and shield yourself and allies within 3 tiles for 8% of your max HP.',
  manaGain: '6',
  selfHeal: '0.03 * hpmax',
  extraTriggers: [
    {
      on: 'used',
      tag: KIND_TAG.support,
      to: area(3, 'allies'),
      limit: ROUND,
      ops: [{ op: 'shield', amount: f('0.08 * hpmax') }],
    },
  ],
});

// ── active ability builders ──

function makeVotiveWard(o: {
  readonly name: string;
  readonly shieldFormula: string;
  readonly wardKey: StatusKey;
  readonly wardDef: StatusDef;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('support', {
    id: ID_WARD,
    name: o.name,
    aim: 'ally',
    range: tiles(6),
    shape: { kind: 'touch', reach: tiles(6) },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'shield', by: 'hand', formula: f(o.shieldFormula) },
    ops: [
      { op: 'applyStatus', key: o.wardKey, def: o.wardDef, duration: rounds(1) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 7, fatigue: 5, time: cost(R.fight.cost.standard), cooldown: rounds(1) },
  };
}

function makeAegisPrayer(): Ability {
  // Uses a 1-round self status with a `statusGained` ally-area trigger so the Cleric's own `sup` and `healPower`
  // shield and consecrate every ally within 2 tiles while sparing foes.
  const base = abilityOf('support', {
    id: ID_WARD,
    name: 'Votive Ward: Aegis Prayer',
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: null,
    ops: [{ op: 'applyStatus', key: KEY_AEGIS_PRAYER, def: AEGIS_PRAYER_PULSE, duration: rounds(1) }],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 7, fatigue: 5, time: cost(R.fight.cost.standard), cooldown: rounds(1) },
  };
}

function makeRadiantCensure(o: {
  readonly name: string;
  readonly formula: string;
  readonly debuffKey: StatusKey;
  readonly debuffDef: StatusDef;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('curse', {
    id: ID_CENSURE,
    name: o.name,
    aim: 'foe',
    range: tiles(7),
    shape: { kind: 'touch', reach: tiles(7) },
    delivery: { kind: 'direct' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'applyStatus', key: o.debuffKey, def: o.debuffDef, duration: rounds(2) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 6, fatigue: 5, time: cost(R.fight.cost.standard), cooldown: rounds(1) },
  };
}

const BASE_WARD = makeVotiveWard({
  name: 'Votive Ward',
  shieldFormula: '1d8 + 1.0 * sup',
  wardKey: KEY_CONSECRATED,
  wardDef: CONSECRATED,
});

const UP_WARD_AEGIS = makeAegisPrayer();

const UP_WARD_SANCTUARY = makeVotiveWard({
  name: 'Votive Ward: Sanctuary Vow',
  shieldFormula: '1d10 + 1.15 * sup',
  wardKey: KEY_CONSECRATED_UP,
  wardDef: CONSECRATED_UP,
  extraOps: [{ op: 'dispel', which: 'first' }],
});

const BASE_CENSURE = makeRadiantCensure({
  name: 'Radiant Censure',
  formula: '1d8 + 0.7 * sup + 0.3 * mag',
  debuffKey: KEY_HUMBLED,
  debuffDef: HUMBLED,
});

const UP_CENSURE_BLIND = makeRadiantCensure({
  name: 'Radiant Censure: Blinding Light',
  formula: '1d10 + 0.8 * sup + 0.35 * mag',
  debuffKey: KEY_HUMBLED_UP,
  debuffDef: HUMBLED_UP,
  extraOps: [{ op: 'stagger', share: 0.25 }],
});

const UP_CENSURE_SEAR = makeRadiantCensure({
  name: 'Radiant Censure: Searing Hymn',
  formula: '1d8 + 0.75 * sup + 0.35 * mag',
  debuffKey: KEY_SEARING,
  debuffDef: SEARING_CENSURE,
});

/** Base Cleric signature (before skill-tree nodes are folded on top). */
export const CLERIC_SIGNATURE: ClassSignature = {
  className: 'Cleric',
  bonus: { dis: 1, pre: 1 },
  worn: BASE_DEVOTED,
  actives: [BASE_WARD, BASE_CENSURE],
};

// ── 18-node / 16-buyable Rare skill tree ──

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

/** Full 7-depth, 2-branch, 16-buyable (18-node) Rare Cleric skill tree (Ward / Censure). */
export const CLERIC_TREE: ClassTree = {
  className: 'Cleric',
  rarity: 'rare',
  nodes: [
    // Depth 1: Root (1)
    node('cleric-root', 1, 'Votive Discipline', 'Gain 2 Discipline and 1 Presence.', [], [
      bonus({ dis: 2, pre: 1 }),
    ]),

    // Depth 2: Two branches (2)
    node('cleric-a2', 2, 'Sacred Barrier', 'Gain 2 Discipline and 4% heal and shield bonus.', ['cleric-root'], [
      bonus({ dis: 2, healPower: 4 }),
    ]),
    node('cleric-b2', 2, 'Choral Conviction', 'Gain 2 Presence and 3 max mana.', ['cleric-root'], [
      bonus({ pre: 2, manaMax: 3 }),
    ]),

    // Depth 3: Branch splits (4)
    node('cleric-a3x', 3, 'Steadfast Prayer', 'Gain 2 Discipline and 4 Will.', ['cleric-a2'], [
      bonus({ dis: 2, will: 4 }),
    ]),
    node('cleric-a3y', 3, 'Blessed Hands', 'Gain 2 Presence and 5% heal and shield bonus.', ['cleric-a2'], [
      bonus({ pre: 2, healPower: 5 }),
    ]),
    node('cleric-b3x', 3, 'Rebuking Verse', 'Gain 2 Presence and 4 potency.', ['cleric-b2'], [
      bonus({ pre: 2, potency: 4 }),
    ]),
    node('cleric-b3y', 3, 'Clear Litany', 'Gain 6 ability haste and 3 max mana.', ['cleric-b2'], [
      bonus({ haste: 6, manaMax: 3 }),
    ]),

    // Depth 4: Deepening (4)
    node('cleric-a4x', 4, 'Firm Resolve', 'Gain 3 Discipline, 4 Will, and 4 tenacity.', ['cleric-a3x'], [
      bonus({ dis: 3, will: 4, tenacity: 4 }),
    ]),
    node('cleric-a4y', 4, 'Deep Devotion', 'Gain 3 Presence, 6% heal and shield bonus, and 15 max HP.', ['cleric-a3y'], [
      bonus({ pre: 3, healPower: 6, hpMax: 15 }),
    ]),
    node('cleric-b4x', 4, 'Stern Verdict', 'Gain 3 Presence, 5% magic penetration, and 4 potency.', ['cleric-b3x'], [
      bonus({ pre: 3, resistPen: 5, potency: 4 }),
    ]),
    node('cleric-b4y', 4, 'Measured Cadence', 'Gain 8 ability haste and 3% cost cut.', ['cleric-b3y'], [
      bonus({ haste: 8, costCut: 3 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (4 nodes, 2 buyable)
    node('cleric-a5-l', 5, 'Aegis Prayer', 'Change Votive Ward to shield and grant Consecrated to you and every ally within 2 tiles.', ['cleric-a4x', 'cleric-a4y'], [
      replaceActive(ID_WARD, UP_WARD_AEGIS),
    ], { forkGroup: 'cleric-a5' }),
    node('cleric-a5-r', 5, 'Sanctuary Vow', 'Upgrade Votive Ward with a stronger shield, 12 armor and 12 magic resist, and a dispel of the oldest harmful status.', ['cleric-a4x', 'cleric-a4y'], [
      replaceActive(ID_WARD, UP_WARD_SANCTUARY),
    ], { forkGroup: 'cleric-a5' }),

    node('cleric-b5-l', 5, 'Blinding Light', 'Upgrade Radiant Censure to add 25% stagger and reduce the foe\'s damage dealt by 18%.', ['cleric-b4x', 'cleric-b4y'], [
      replaceActive(ID_CENSURE, UP_CENSURE_BLIND),
    ], { forkGroup: 'cleric-b5' }),
    node('cleric-b5-r', 5, 'Searing Hymn', 'Upgrade Radiant Censure to add an arcane burn each round and deal up to 15% more damage while you are above half HP.', ['cleric-b4x', 'cleric-b4y'], [
      replaceActive(ID_CENSURE, UP_CENSURE_SEAR),
      scaler({ measure: 'user', dir: 'over', start: 0.5, scale: 0.15 }),
    ], { forkGroup: 'cleric-b5' }),

    // Depth 6: Branch Capstones (2)
    node('cleric-a6', 6, 'Sanctuary Keeper', 'Gain 4 Discipline, 6% heal and shield bonus, and 20 max HP.', ['cleric-a5-l', 'cleric-a5-r'], [
      bonus({ dis: 4, healPower: 6, hpMax: 20 }),
    ], { parentMode: 'any' }),
    node('cleric-b6', 6, 'Radiant Choir', 'Gain 4 Presence, 8 ability haste, and 4 max mana.', ['cleric-b5-l', 'cleric-b5-r'], [
      bonus({ pre: 4, haste: 8, manaMax: 4 }),
    ], { parentMode: 'any' }),

    // Depth 7: Rare Capstone (1)
    node('cleric-cap', 7, 'High Votive', 'Upgrade Devoted Light to High Votive and gain 15% heal and shield bonus, 4 Discipline, and 4 Presence.', ['cleric-a6', 'cleric-b6'], [
      replaceWorn(KEY_DEVOTED, HIGH_VOTIVE),
      bonus({ healPower: 15, dis: 4, pre: 4 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
