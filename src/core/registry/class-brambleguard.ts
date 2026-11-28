// class-brambleguard.ts: Rare Brambleguard (Tanker branch, vit+dis) signature kit and full 18-node / 16-buyable tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
//
// Plant-themed selfish retaliation tank (living briars, vines, thornbark, canopy — leaving steel to Ironclad).
// Root budget at rank C (`RULES.rarities.rare.rank = 'C'`, level 20, settled.md ~12-point Rare unspecialized root):
// - Sheet bonus `{ vit: 1, dis: 1 }` spends 2.00 pts (1 pt per stat point, item-budget.ts `BONUS_COST`).
// - Worn `Thornhide` reflects `0.045 * armor` arcane damage on `struck` (priced on heavy tank armor at rank C, 1 strike/round)
//   and slows attackers by 15% for 1 round (unweighed utility). Exact root spend verified inside <= 12.0 pts by tests/rare-classes.test.ts.
// - Actives (`Vine Lash`, `Bramble Shell`) are priced in SA at rank C by worth.ts `abilityWorth` within their action-speed budgets.
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { Op, StatusDef, StatusKey, Tiers } from '../combat/effect-ops.ts';
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
  if (!id) throw new Error(`Invalid Brambleguard node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Brambleguard formula "${text}"`);
  return p.formula;
};
const tiered = (e: string, d: string, c: string, b: string, a: string, s: string): Tiers<Formula> =>
  [f(e), f(d), f(c), f(b), f(a), f(s)];
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };

const KEY_THORNHIDE = statusKey('bramble-thornhide');
const KEY_THORNHIDE_UP = statusKey('bramble-thornhide-ii');
const KEY_SNARE = statusKey('bramble-snare');
const KEY_SNARE_UP = statusKey('bramble-snare-ii');
const KEY_TAUNT = statusKey('bramble-taunt');
const KEY_BARK = statusKey('bramble-thornbark');
const KEY_BARK_UP = statusKey('bramble-thornbark-ii');
const KEY_BARK_PATCH = statusKey('bramble-patch-bark');

const ID_LASH = abilityId('bramble-vine-lash');
const ID_SHELL = abilityId('bramble-shell');

// ── statuses ──

const BRAMBLE_SNARE: StatusDef = {
  label: 'Bramble Snare',
  desc: 'Speed reduced by 15%.',
  ops: [{ op: 'speed', pct: -15 }],
};

const BRAMBLE_SNARE_UP: StatusDef = {
  label: 'Bramble Snare II',
  desc: 'Speed reduced by 25%.',
  ops: [{ op: 'speed', pct: -25 }],
};

const BRAMBLE_TAUNT: StatusDef = {
  label: 'Bramble Taunt',
  desc: 'Must target the Brambleguard while they are up and in reach.',
  ops: [{ op: 'taunt' }],
};

const THORN_BARK: StatusDef = {
  label: 'Thornbark',
  desc: 'Armor increased by 20.',
  ops: [{ op: 'sheet', key: 'armor', amount: { kind: 'number', value: 20 } }],
};

const THORN_BARK_UP: StatusDef = {
  label: 'Overgrown Bark',
  desc: 'Armor increased by 30 and magic resist increased by 15.',
  ops: [
    { op: 'sheet', key: 'armor', amount: { kind: 'number', value: 30 } },
    { op: 'sheet', key: 'resist', amount: { kind: 'number', value: 15 } },
  ],
};

const PATCH_BARK: StatusDef = {
  label: 'Briar Bark',
  desc: 'Armor increased by 14 while surrounded by a moving briar aura.',
  ops: [{ op: 'sheet', key: 'armor', amount: { kind: 'number', value: 14 } }],
};

function makeThornhide(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly reflectFormula: string;
  readonly snareKey: StatusKey;
  readonly snareDef: StatusDef;
  readonly extraOps?: readonly Op[];
  readonly extraTriggers?: readonly Trigger[];
}): ClassWorn {
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [...(o.extraOps ?? [])],
      triggers: [
        {
          on: 'struck',
          tag: null,
          to: 'other',
          limit: EACH,
          ops: [
            { op: 'damage', type: 'arcane', when: 'use', amount: f(o.reflectFormula) },
            { op: 'applyStatus', key: o.snareKey, def: o.snareDef, duration: rounds(1) },
          ],
        },
        ...(o.extraTriggers ?? []),
      ],
    },
  };
}

// Root passive: reflects 4.5% of armor as arcane thorn damage and slows attackers 15% for 1 round.
const BASE_THORNHIDE: ClassWorn = makeThornhide({
  key: KEY_THORNHIDE,
  label: 'Thornhide',
  desc: 'Foes that strike you take arcane damage equal to 4.5% of your armor and are slowed by 15% for 1 round.',
  reflectFormula: '0.045 * armor',
  snareKey: KEY_SNARE,
  snareDef: BRAMBLE_SNARE,
});

// Depth 7 Capstone passive: adds 3% of max HP as armor, reflects 8% of armor + 25% slow, and grants a 4% max HP shield once per round when struck.
const HEART_OF_BRAMBLE: ClassWorn = makeThornhide({
  key: KEY_THORNHIDE_UP,
  label: 'Heart of the Bramble',
  desc: 'Gain armor equal to 3% of max HP. Attackers take 8% of your armor as arcane damage and are slowed by 25%. Gain a 4% max HP shield once a round when struck.',
  reflectFormula: '0.08 * armor',
  snareKey: KEY_SNARE_UP,
  snareDef: BRAMBLE_SNARE_UP,
  extraOps: [{ op: 'sheet', key: 'armor', amount: f('0.03 * hpmax') }],
  extraTriggers: [
    { on: 'struck', tag: null, to: 'self', limit: ROUND, ops: [{ op: 'shield', amount: f('0.04 * hpmax') }] },
  ],
});

// ── active ability builders ──

function makeVineLash(o: {
  readonly name: string;
  readonly reach: number;
  readonly pull: number;
  readonly cooldownRounds: number;
  readonly formula: string;
}): Ability {
  const reach = tiles(o.reach);
  const base = abilityOf('strike', {
    id: ID_LASH,
    name: o.name,
    desc: `Lash a foe within ${o.reach} tiles for physical damage, taunt them for 1 round, and pull them ${o.pull} ${o.pull === 1 ? 'tile' : 'tiles'} closer.`,
    range: reach,
    shape: { kind: 'touch', reach },
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'applyStatus', key: KEY_TAUNT, def: BRAMBLE_TAUNT, duration: rounds(1) },
      { op: 'shove', dir: 'toward', from: 'user', tiles: o.pull },
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 4, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeBrambleShell(o: {
  readonly name: string;
  readonly desc: string;
  readonly shieldFormula: string;
  readonly barkKey: StatusKey;
  readonly barkDef: StatusDef;
  readonly cooldownRounds: number;
  readonly aura?: { readonly name: string; readonly tick: Tiers<Formula>; readonly slowPct: number };
}): Ability {
  const base = abilityOf('support', {
    id: ID_SHELL,
    name: o.name,
    desc: o.desc,
    aim: 'self',
    shape: { kind: 'self' },
    range: tiles(0),
    delivery: { kind: 'sure' },
    foesOnly: Boolean(o.aura),
    effect: { type: 'shield', by: 'hand', formula: f(o.shieldFormula) },
    ops: [{ op: 'applyStatus', key: o.barkKey, def: o.barkDef, duration: rounds(2) }],
    ...(o.aura ? {
      zone: {
        name: o.aura.name,
        duration: rounds(2),
        around: tiles(2),
        endsWithOwner: true,
        grow: null,
        ops: [
          { op: 'speed', pct: o.aura.slowPct },
          { op: 'damage', type: 'arcane', when: 'turn', amount: o.aura.tick },
        ],
      },
    } : {}),
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 6, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

// Standard-pace 2-tile physical vine strike (~0.79 SA at rank C) leaving budget room for 1-round taunt + 1-tile pull.
const BASE_LASH = makeVineLash({
  name: 'Vine Lash',
  reach: 2,
  pull: 1,
  cooldownRounds: 2,
  formula: '1d8 + 0.5 * phys + 0.15 * armor',
});

// D5 Fork A-Left upgrade: 3-tile reach, 2-tile pull, 1-round cooldown, higher armor scaling.
const UP_LASH = makeVineLash({
  name: 'Vine Lash: Barbed Tendrils',
  reach: 3,
  pull: 2,
  cooldownRounds: 1,
  formula: '2d6 + 0.6 * phys + 0.22 * armor',
});

// Standard-pace self shield (22% max HP, ~0.85 SA at rank C, matching Shield Wall's 25% band) + 20 armor for 2 rounds.
const BASE_SHELL = makeBrambleShell({
  name: 'Bramble Shell',
  desc: 'Shield yourself and gain Thornbark for 2 rounds.',
  shieldFormula: '0.22 * hpmax',
  barkKey: KEY_BARK,
  barkDef: THORN_BARK,
  cooldownRounds: 3,
});

// D5 Fork B-Left (selfish juggernaut): 30% max HP shield + 30 armor and 15 magic resist for 2 rounds.
const UP_SHELL_OVERGROWN = makeBrambleShell({
  name: 'Bramble Shell: Overgrown',
  desc: 'Shield yourself and gain Overgrown Bark for 2 rounds.',
  shieldFormula: '0.3 * hpmax',
  barkKey: KEY_BARK_UP,
  barkDef: THORN_BARK_UP,
  cooldownRounds: 3,
});

// D5 Fork B-Right (area-denial bramble aura): 16% max HP shield + 14 armor + 2-tile moving aura slowing foes 20% and dealing tiered thorn damage.
const UP_SHELL_PATCH = makeBrambleShell({
  name: 'Bramble Shell: Briar Patch',
  desc: 'Shield yourself, gain Briar Bark, and surround yourself with a 2-tile Briar Patch aura for 2 rounds.',
  shieldFormula: '0.16 * hpmax',
  barkKey: KEY_BARK_PATCH,
  barkDef: PATCH_BARK,
  cooldownRounds: 3,
  aura: {
    name: 'Briar Patch',
    slowPct: -20,
    tick: tiered('1d4', '1d6', '1d8', '2d6', '2d8', '3d8'),
  },
});

/** Base Brambleguard signature (before skill-tree nodes are folded on top). */
export const BRAMBLEGUARD_SIGNATURE: ClassSignature = {
  className: 'Brambleguard',
  bonus: { vit: 1, dis: 1 },
  worn: BASE_THORNHIDE,
  actives: [BASE_LASH, BASE_SHELL],
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

/** Full 7-depth, 2-branch, 16-buyable (18-node) Rare Brambleguard skill tree. */
export const BRAMBLEGUARD_TREE: ClassTree = {
  className: 'Brambleguard',
  rarity: 'rare',
  nodes: [
    // Depth 1: Root (1)
    node('bramble-root', 1, 'Sprout Ward', 'Gain 2 Vitality and 1 Discipline.', [], [
      bonus({ vit: 2, dis: 1 }),
    ]),

    // Depth 2: Two branches (2)
    node('bramble-a2', 2, 'Clinging Thorns', 'Gain 2 Vitality and 10 max HP.', ['bramble-root'], [
      bonus({ vit: 2, hpMax: 10 }),
    ]),
    node('bramble-b2', 2, 'Deep Roots', 'Gain 2 Discipline and 3 tenacity.', ['bramble-root'], [
      bonus({ dis: 2, tenacity: 3 }),
    ]),

    // Depth 3: Branch splits (4)
    node('bramble-a3x', 3, 'Tangled Stalks', 'Gain 2 Vitality and 4% threat.', ['bramble-a2'], [
      bonus({ vit: 2, threat: 4 }),
    ]),
    node('bramble-a3y', 3, 'Venom Sap', 'Gain 15 max HP and 4% magic penetration.', ['bramble-a2'], [
      bonus({ hpMax: 15, resistPen: 4 }),
    ]),
    node('bramble-b3x', 3, 'Taproot', 'Gain 3 tenacity and 3 Will.', ['bramble-b2'], [
      bonus({ tenacity: 3, will: 3 }),
    ]),
    node('bramble-b3y', 3, 'Living Bark', 'Gain 2 Discipline and 4% heal and shield bonus.', ['bramble-b2'], [
      bonus({ dis: 2, healPower: 4 }),
    ]),

    // Depth 4: Deepening (4)
    node('bramble-a4x', 4, 'Barbed Vines', 'Gain 3 Vitality and 6 ability haste.', ['bramble-a3x'], [
      bonus({ vit: 3, haste: 6 }),
    ]),
    node('bramble-a4y', 4, 'Heartwood Spines', 'Gain 20 max HP and 5 flat magic penetration.', ['bramble-a3y'], [
      bonus({ hpMax: 20, resistPenFlat: 5 }),
    ]),
    node('bramble-b4x', 4, 'Unmoved Canopy', 'Gain 4 tenacity and 4 Will.', ['bramble-b3x'], [
      bonus({ tenacity: 4, will: 4 }),
    ]),
    node('bramble-b4y', 4, 'Thick Resin', 'Gain 3 Discipline and 5% heal and shield bonus.', ['bramble-b3y'], [
      bonus({ dis: 3, healPower: 5 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (4 nodes, 2 buyable)
    node('bramble-a5-l', 5, 'Barbed Tendrils', 'Upgrade Vine Lash to 3-tile reach, 2-tile pull, 1-round cooldown, and higher armor scaling.', ['bramble-a4x', 'bramble-a4y'], [
      replaceActive(ID_LASH, UP_LASH),
    ], { forkGroup: 'bramble-a5' }),
    node('bramble-a5-r', 5, 'Splintering Husk', 'Gain 4 Vitality, 20 max HP, and up to 15% more damage against foes with higher max HP than you.', ['bramble-a4x', 'bramble-a4y'], [
      bonus({ vit: 4, hpMax: 20 }),
      scaler({ measure: 'maxPair', dir: 'over', start: 0.5, scale: 0.15 }),
    ], { forkGroup: 'bramble-a5' }),

    node('bramble-b5-l', 5, 'Overgrown Shell', 'Upgrade Bramble Shell to a 30% max HP shield with 30 armor and 15 magic resist for 2 rounds.', ['bramble-b4x', 'bramble-b4y'], [
      replaceActive(ID_SHELL, UP_SHELL_OVERGROWN),
    ], { forkGroup: 'bramble-b5' }),
    node('bramble-b5-r', 5, 'Briar Patch', 'Change Bramble Shell to a 16% max HP shield, 14 armor, and a 2-tile moving briar aura that slows foes by 20% and deals thorn damage.', ['bramble-b4x', 'bramble-b4y'], [
      replaceActive(ID_SHELL, UP_SHELL_PATCH),
    ], { forkGroup: 'bramble-b5' }),

    // Depth 6: Branch Capstones (2)
    node('bramble-a6', 6, 'Brambleback', 'Gain 4 Vitality, 25 max HP, and 6 ability haste.', ['bramble-a5-l', 'bramble-a5-r'], [
      bonus({ vit: 4, hpMax: 25, haste: 6 }),
    ], { parentMode: 'any' }),
    node('bramble-b6', 6, 'Ancient Canopy', 'Gain 4 Discipline, 6 tenacity, and 6% heal and shield bonus.', ['bramble-b5-l', 'bramble-b5-r'], [
      bonus({ dis: 4, tenacity: 6, healPower: 6 }),
    ], { parentMode: 'any' }),

    // Depth 7: Rare Capstone (1)
    node('bramble-cap', 7, 'Heart of the Bramble', 'Upgrade Thornhide to Heart of the Bramble and gain 4 Vitality, 4 Discipline, and 20 max HP.', ['bramble-a6', 'bramble-b6'], [
      replaceWorn(KEY_THORNHIDE, HEART_OF_BRAMBLE),
      bonus({ vit: 4, dis: 4, hpMax: 20 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
