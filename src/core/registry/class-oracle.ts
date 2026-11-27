// class-oracle.ts: Rare Oracle (Healer branch, ins+pre) signature kit and full 18-node / 16-buyable tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
//
// Diviner granting held defense boost dice with Foretell and delayed arcane bursts with Fated Bolt.
// Root budget at rank C (`RULES.rarities.rare.rank = 'C'`, level 20, settled.md ~12-point Rare unspecialized root):
// - Sheet bonus `{ pre: 1, ins: 1, manaMax: 3 }` spends 8.00 pts.
// - Worn `Second Sight` grants surprise immunity (`alert`) and restores 3 mana plus 1 round of Glimpse on support use.
// - Actives (`Foretell`, `Fated Bolt`) stay inside worth.ts C-rank budgets with zero mythic banner vocabulary.
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { Reach, StatusDef, StatusKey, UseOp } from '../combat/effect-ops.ts';
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
  if (!id) throw new Error(`Invalid Oracle node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Oracle formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };
const area = (radius: number, on: 'allies' | 'foes'): Reach => ({ kind: 'area', radius: tiles(radius), on });

const KEY_SIGHT = statusKey('oracle-sight');
const KEY_SEER = statusKey('oracle-seer');
const KEY_GLIMPSE = statusKey('oracle-glimpse');
const KEY_FAVOR = statusKey('oracle-favor');
const KEY_FORESEEN = statusKey('oracle-foreseen');
const KEY_TWIN_AUGURY = statusKey('oracle-twin-augury');
const KEY_CLOUDED = statusKey('oracle-clouded');
const KEY_DOOM = statusKey('oracle-doom');
const KEY_DOOM_UP = statusKey('oracle-doom-ii');
const KEY_DOOM_SHATTER = statusKey('oracle-doom-shattered');

const ID_FORETELL = abilityId('oracle-foretell');
const ID_BOLT = abilityId('oracle-fated-bolt');

// ── statuses ──

const GLIMPSE: StatusDef = {
  label: 'Glimpse',
  desc: 'Advantage on your next defense roll for 1 round.',
  ops: [{ op: 'edge', side: 'defend', keep: 'better', tag: null, spend: true }],
};

// Defense boost and attack advantage live in separate statuses so spending one never removes the other.
const FORETOLD_FAVOR: StatusDef = {
  label: 'Foretold Favor',
  desc: 'Adds a held d6 to your next defense roll for 2 rounds.',
  ops: [{ op: 'boost', side: 'defend', die: { kind: 'die', sides: 6 } }],
};

const FORESEEN_STRIKE: StatusDef = {
  label: 'Foreseen Strike',
  desc: 'Advantage on your next attack roll for 2 rounds.',
  ops: [{ op: 'edge', side: 'attack', keep: 'better', tag: null, spend: true }],
};

const TWIN_AUGURY_PULSE: StatusDef = {
  label: 'Twin Augury',
  desc: 'Shields you and allies within 2 tiles and grants Foretold Favor and Foreseen Strike for 2 rounds.',
  ops: [],
  triggers: [
    {
      on: 'statusGained',
      key: KEY_TWIN_AUGURY,
      to: area(2, 'allies'),
      limit: EACH,
      ops: [
        { op: 'shield', amount: f('1d6 + 0.85 * sup') },
        { op: 'applyStatus', key: KEY_FAVOR, def: FORETOLD_FAVOR, duration: rounds(2) },
        { op: 'applyStatus', key: KEY_FORESEEN, def: FORESEEN_STRIKE, duration: rounds(2) },
      ],
    },
  ],
};

// Kept separate from Fated Doom so spending the attack disadvantage never deletes the delayed detonation or exposed faces.
const CLOUDED_FATE: StatusDef = {
  label: 'Clouded Fate',
  desc: 'Disadvantage on the next attack roll for 2 rounds.',
  ops: [{ op: 'edge', side: 'attack', keep: 'worse', tag: null, spend: true }],
};

const FATED_DOOM: StatusDef = {
  label: 'Fated Doom',
  desc: 'Takes 5% more damage and detonates for arcane damage when it ends. Curing cancels the blast.',
  ops: [{ op: 'share', on: 'taken', pct: 5 }],
  end: {
    cleanse: 'cancel',
    ops: [{ op: 'damage', type: 'arcane', when: 'use', amount: f('1d6 + 0.45 * sup') }],
  },
};

const INEVITABLE_DOOM: StatusDef = {
  label: 'Inevitable Doom',
  desc: 'Takes 5% more damage and detonates for stronger arcane damage when it ends or is cured.',
  ops: [{ op: 'share', on: 'taken', pct: 5 }],
  end: {
    cleanse: 'land',
    ops: [{ op: 'damage', type: 'arcane', when: 'use', amount: f('1d8 + 0.55 * sup') }],
  },
};

const SHATTERED_DOOM: StatusDef = {
  label: 'Shattered Doom',
  desc: 'Takes 5% more damage, exposes 2 more crit faces, and detonates for arcane damage when it ends. Curing cancels the blast.',
  ops: [
    { op: 'share', on: 'taken', pct: 5 },
    { op: 'sheet', key: 'exposed', amount: 2 },
  ],
  end: {
    cleanse: 'cancel',
    ops: [{ op: 'damage', type: 'arcane', when: 'use', amount: f('1d6 + 0.45 * sup') }],
  },
};

function makeSecondSight(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly manaGain: string;
  readonly extraTriggers?: readonly Trigger[];
}): ClassWorn {
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [{ op: 'alert' }],
      triggers: [
        {
          on: 'used',
          tag: KIND_TAG.support,
          to: 'self',
          limit: ROUND,
          ops: [
            { op: 'mana', when: 'use', amount: f(o.manaGain) },
            { op: 'applyStatus', key: KEY_GLIMPSE, def: GLIMPSE, duration: rounds(1) },
          ],
        },
        ...(o.extraTriggers ?? []),
      ],
    },
  };
}

const BASE_SIGHT: ClassWorn = makeSecondSight({
  key: KEY_SIGHT,
  label: 'Second Sight',
  desc: 'You cannot be surprised. Once a round when you use a support ability, restore 3 mana and gain Glimpse (defense advantage) for 1 round.',
  manaGain: '3',
});

const SEER_OF_FATE: ClassWorn = makeSecondSight({
  key: KEY_SEER,
  label: 'Seer of Fate',
  desc: 'You cannot be surprised. Once a round when you use a support ability, restore 5 mana, gain Glimpse for 1 round, and shield yourself and allies within 3 tiles for 6% of your max HP.',
  manaGain: '5',
  extraTriggers: [
    {
      on: 'used',
      tag: KIND_TAG.support,
      to: area(3, 'allies'),
      limit: ROUND,
      ops: [{ op: 'shield', amount: f('0.06 * hpmax') }],
    },
  ],
});

// ── active ability builders ──

function makeForetell(o: {
  readonly name: string;
  readonly shieldFormula: string;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('support', {
    id: ID_FORETELL,
    name: o.name,
    aim: 'ally',
    range: tiles(7),
    shape: { kind: 'touch', reach: tiles(7) },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: { type: 'shield', by: 'hand', formula: f(o.shieldFormula) },
    ops: [
      { op: 'applyStatus', key: KEY_FAVOR, def: FORETOLD_FAVOR, duration: rounds(2) },
      { op: 'applyStatus', key: KEY_FORESEEN, def: FORESEEN_STRIKE, duration: rounds(2) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 5, fatigue: 5, time: cost(R.fight.cost.standard), cooldown: rounds(1) },
  };
}

function makeTwinAugury(): Ability {
  const base = abilityOf('support', {
    id: ID_FORETELL,
    name: 'Foretell: Twin Augury',
    aim: 'self',
    range: tiles(0),
    shape: { kind: 'self' },
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: null,
    ops: [{ op: 'applyStatus', key: KEY_TWIN_AUGURY, def: TWIN_AUGURY_PULSE, duration: rounds(1) }],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 5, fatigue: 5, time: cost(R.fight.cost.standard), cooldown: rounds(1) },
  };
}

function makeFatedBolt(o: {
  readonly name: string;
  readonly formula: string;
  readonly doomKey: StatusKey;
  readonly doomDef: StatusDef;
}): Ability {
  const base = abilityOf('curse', {
    id: ID_BOLT,
    name: o.name,
    aim: 'foe',
    range: tiles(8),
    shape: { kind: 'touch', reach: tiles(8) },
    delivery: { kind: 'direct' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'applyStatus', key: o.doomKey, def: o.doomDef, duration: rounds(2) },
      { op: 'applyStatus', key: KEY_CLOUDED, def: CLOUDED_FATE, duration: rounds(2) },
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 4, fatigue: 5, time: cost(R.fight.cost.standard), cooldown: rounds(1) },
  };
}

const BASE_FORETELL = makeForetell({
  name: 'Foretell',
  shieldFormula: '1d6 + 0.85 * sup',
});

const UP_FORETELL_WARD = makeForetell({
  name: 'Foretell: Prophetic Ward',
  shieldFormula: '1d8 + 0.95 * sup',
  extraOps: [{ op: 'dispel', which: 'first' }],
});

const UP_FORETELL_TWIN = makeTwinAugury();

const BASE_BOLT = makeFatedBolt({
  name: 'Fated Bolt',
  formula: '1d6 + 0.6 * sup',
  doomKey: KEY_DOOM,
  doomDef: FATED_DOOM,
});

const UP_BOLT_INEVITABLE = makeFatedBolt({
  name: 'Fated Bolt: Inevitable Doom',
  formula: '1d6 + 0.65 * sup',
  doomKey: KEY_DOOM_UP,
  doomDef: INEVITABLE_DOOM,
});

const UP_BOLT_SHATTERED = makeFatedBolt({
  name: 'Fated Bolt: Shattered Fate',
  formula: '1d6 + 0.6 * sup',
  doomKey: KEY_DOOM_SHATTER,
  doomDef: SHATTERED_DOOM,
});

/** Base Oracle signature (before skill-tree nodes are folded on top). */
export const ORACLE_SIGNATURE: ClassSignature = {
  className: 'Oracle',
  bonus: { pre: 1, ins: 1, manaMax: 3 },
  worn: BASE_SIGHT,
  actives: [BASE_FORETELL, BASE_BOLT],
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

/** Full 7-depth, 2-branch, 16-buyable (18-node) Rare Oracle skill tree (Augury / Fate). */
export const ORACLE_TREE: ClassTree = {
  className: 'Oracle',
  rarity: 'rare',
  nodes: [
    // Depth 1: Root (1)
    node('oracle-root', 1, 'Observatory Clarity', 'Gain 2 Presence and 1 Instinct.', [], [
      bonus({ pre: 2, ins: 1 }),
    ]),

    // Depth 2: Two branches (2)
    node('oracle-a2', 2, 'Foreseen Ward', 'Gain 2 Presence and 4% heal and shield bonus.', ['oracle-root'], [
      bonus({ pre: 2, healPower: 4 }),
    ]),
    node('oracle-b2', 2, 'Threaded Vision', 'Gain 2 Instinct and 3 opening.', ['oracle-root'], [
      bonus({ ins: 2, opening: 3 }),
    ]),

    // Depth 3: Branch splits (4)
    node('oracle-a3x', 3, 'Clear Portent', 'Gain 2 Presence and 5% heal and shield bonus.', ['oracle-a2'], [
      bonus({ pre: 2, healPower: 5 }),
    ]),
    node('oracle-a3y', 3, 'Still Breath', 'Gain 6 ability haste and 3 max mana.', ['oracle-a2'], [
      bonus({ haste: 6, manaMax: 3 }),
    ]),
    node('oracle-b3x', 3, 'Fatal Thread', 'Gain 2 Instinct and 4 potency.', ['oracle-b2'], [
      bonus({ ins: 2, potency: 4 }),
    ]),
    node('oracle-b3y', 3, 'Uncanny Reflex', 'Gain 4 Reaction and 3 max mana.', ['oracle-b2'], [
      bonus({ react: 4, manaMax: 3 }),
    ]),

    // Depth 4: Deepening (4)
    node('oracle-a4x', 4, 'Guiding Hand', 'Gain 3 Presence, 6% heal and shield bonus, and 15 max HP.', ['oracle-a3x'], [
      bonus({ pre: 3, healPower: 6, hpMax: 15 }),
    ]),
    node('oracle-a4y', 4, 'Quiet Cadence', 'Gain 8 ability haste and 3% cost cut.', ['oracle-a3y'], [
      bonus({ haste: 8, costCut: 3 }),
    ]),
    node('oracle-b4x', 4, 'Sealed Verdict', 'Gain 3 Instinct, 5% magic penetration, and 4 potency.', ['oracle-b3x'], [
      bonus({ ins: 3, resistPen: 5, potency: 4 }),
    ]),
    node('oracle-b4y', 4, 'First Glance', 'Gain 5 Reaction and 4 opening.', ['oracle-b3y'], [
      bonus({ react: 5, opening: 4 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (4 nodes, 2 buyable)
    node('oracle-a5-l', 5, 'Prophetic Ward', 'Upgrade Foretell with a stronger shield and a dispel of the oldest harmful status.', ['oracle-a4x', 'oracle-a4y'], [
      replaceActive(ID_FORETELL, UP_FORETELL_WARD),
    ], { forkGroup: 'oracle-a5' }),
    node('oracle-a5-r', 5, 'Twin Augury', 'Change Foretell to shield and grant Foretold Favor and Foreseen Strike to you and allies within 2 tiles.', ['oracle-a4x', 'oracle-a4y'], [
      replaceActive(ID_FORETELL, UP_FORETELL_TWIN),
    ], { forkGroup: 'oracle-a5' }),

    node('oracle-b5-l', 5, 'Inevitable Doom', 'Upgrade Fated Bolt so Inevitable Doom still detonates if cured and deal up to 18% more damage while you are above half HP.', ['oracle-b4x', 'oracle-b4y'], [
      replaceActive(ID_BOLT, UP_BOLT_INEVITABLE),
      scaler({ measure: 'user', dir: 'over', start: 0.5, scale: 0.18 }),
    ], { forkGroup: 'oracle-b5' }),
    node('oracle-b5-r', 5, 'Shattered Fate', 'Upgrade Fated Bolt so Shattered Doom also exposes 2 more crit faces on the target.', ['oracle-b4x', 'oracle-b4y'], [
      replaceActive(ID_BOLT, UP_BOLT_SHATTERED),
    ], { forkGroup: 'oracle-b5' }),

    // Depth 6: Branch Capstones (2)
    node('oracle-a6', 6, 'Augur Sanctuary', 'Gain 4 Presence, 6% heal and shield bonus, and 4 max mana.', ['oracle-a5-l', 'oracle-a5-r'], [
      bonus({ pre: 4, healPower: 6, manaMax: 4 }),
    ], { parentMode: 'any' }),
    node('oracle-b6', 6, 'Foresight Edge', 'Gain 4 Instinct, 8 ability haste, and 4 opening.', ['oracle-b5-l', 'oracle-b5-r'], [
      bonus({ ins: 4, haste: 8, opening: 4 }),
    ], { parentMode: 'any' }),

    // Depth 7: Rare Capstone (1)
    node('oracle-cap', 7, 'Seer of Fate', 'Upgrade Second Sight to Seer of Fate and gain 12% heal and shield bonus, 4 Presence, and 4 Instinct.', ['oracle-a6', 'oracle-b6'], [
      replaceWorn(KEY_SIGHT, SEER_OF_FATE),
      bonus({ healPower: 12, pre: 4, ins: 4 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
