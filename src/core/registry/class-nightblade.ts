// class-nightblade.ts: Rare Nightblade (Assassin branch, agi+ins) signature kit and full 18-node / 16-buyable tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
//
// Classic ambush-and-bleed assassin: enters 2-round stealth that breaks on dealing damage, applies Dusk Bleed,
// and chains kill mobility through Night Step and Master of Dusk.
// Root budget at rank C (`RULES.rarities.rare.rank = 'C'`, level 20, settled.md ~12-point Rare unspecialized root):
// - Sheet bonus `{ agi: 1, ins: 1 }` spends 2.00 pts.
// - Worn `Shadow Craft` grants 4 flat armor penetration and 1 round of Night Step (+15% speed, defense advantage) on kill.
// - Actives (`Umbral Cloak`, `Dusk Strike`) stay inside worth.ts C-rank budgets.
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { LandOp, Op, StatusDef, StatusKey, Tiers, UseOp } from '../combat/effect-ops.ts';
import type { Level } from '../combat/sight-levels.ts';
import type { Limit } from '../combat/triggers.ts';
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
  if (!id) throw new Error(`Invalid Nightblade node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Nightblade formula "${text}"`);
  return p.formula;
};
const tiered = (e: string, d: string, c: string, b: string, a: string, s: string): Tiers<Formula> =>
  [f(e), f(d), f(c), f(b), f(a), f(s)];
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const ROUND: Limit = { kind: 'round' };
const SHROUD_LEVELS: readonly [Level, Level, Level, Level, Level, Level] = [0, 0, 1, 2, 3, 4];

const KEY_SHADOW_CRAFT = statusKey('night-shadow-craft');
const KEY_MASTER_DUSK = statusKey('night-master-of-dusk');
const KEY_NIGHT_STEP = statusKey('night-step');
const KEY_SHROUDED = statusKey('night-shrouded');
const KEY_GHOST_SHROUD = statusKey('night-ghost-shroud');
const KEY_DUSK_BLEED = statusKey('night-dusk-bleed');

const ID_CLOAK = abilityId('night-umbral-cloak');
const ID_STRIKE = abilityId('night-dusk-strike');

// ── statuses ──

const NIGHT_STEP: StatusDef = {
  label: 'Night Step',
  desc: 'Speed increased by 15% and advantage on your next defense roll for 1 round.',
  ops: [
    { op: 'speed', pct: 15 },
    { op: 'edge', side: 'defend', keep: 'better', tag: null, spend: true },
  ],
};

const SHROUDED: StatusDef = {
  label: 'Shrouded',
  desc: 'Hidden in shadow with 10% more speed. Taking damage, dealing damage, or being revealed ends this early.',
  ops: [
    { op: 'hidden', level: SHROUD_LEVELS, start: 'anywhere', ends: { hurt: true, revealed: true, dealt: true } },
    { op: 'speed', pct: 10 },
  ],
};

const GHOST_SHROUD: StatusDef = {
  label: 'Ghost Shroud',
  desc: 'Hidden in shadow with 15% more speed and advantage on your next attack. Taking damage, dealing damage, or being revealed ends this early.',
  ops: [
    { op: 'hidden', level: SHROUD_LEVELS, start: 'anywhere', ends: { hurt: true, revealed: true, dealt: true } },
    { op: 'speed', pct: 15 },
    { op: 'edge', side: 'attack', keep: 'better', tag: null, spend: true },
  ],
};

const DUSK_BLEED: StatusDef = {
  label: 'Dusk Bleed',
  desc: 'Takes physical bleed damage each round and attacks against this target crit on 1 more die face.',
  ops: [
    { op: 'damage', type: 'physical', when: 'turn', amount: tiered('1d4', '1d6', '1d8', '2d6', '2d8', '3d6') },
    { op: 'sheet', key: 'exposed', amount: 1 },
  ],
};

function makeShadowCraft(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly ops: readonly Op[];
  readonly killOps: readonly LandOp[];
}): ClassWorn {
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: o.ops,
      triggers: [
        {
          on: 'kill',
          tag: null,
          to: 'self',
          limit: ROUND,
          ops: o.killOps,
        },
      ],
    },
  };
}

const BASE_SHADOW_CRAFT: ClassWorn = makeShadowCraft({
  key: KEY_SHADOW_CRAFT,
  label: 'Shadow Craft',
  desc: 'Gain 4 flat armor penetration. Once a round when you defeat a foe, gain Night Step (+15% speed and defense advantage) for 1 round.',
  ops: [{ op: 'sheet', key: 'armorPenFlat', amount: { kind: 'number', value: 4 } }],
  killOps: [{ op: 'applyStatus', key: KEY_NIGHT_STEP, def: NIGHT_STEP, duration: rounds(1) }],
});

const MASTER_OF_DUSK: ClassWorn = makeShadowCraft({
  key: KEY_MASTER_DUSK,
  label: 'Master of Dusk',
  desc: 'Gain 10 flat armor penetration and 10% more damage dealt. Once a round when you defeat a foe, gain Shrouded for 1 round and refund 35% of your turn.',
  ops: [
    { op: 'sheet', key: 'armorPenFlat', amount: { kind: 'number', value: 10 } },
    { op: 'share', on: 'dealt', pct: 10 },
  ],
  killOps: [
    { op: 'applyStatus', key: KEY_SHROUDED, def: SHROUDED, duration: rounds(1) },
    { op: 'refund', pct: 35 },
  ],
});

// ── active ability builders ──

function makeUmbralCloak(o: {
  readonly name: string;
  readonly shroudKey: StatusKey;
  readonly shroudDef: StatusDef;
  readonly cooldownRounds: number;
  readonly smokeVeil?: boolean;
}): Ability {
  const base = abilityOf('support', {
    id: ID_CLOAK,
    name: o.name,
    aim: 'self',
    shape: { kind: 'self' },
    range: tiles(0),
    delivery: { kind: 'sure' },
    foesOnly: Boolean(o.smokeVeil),
    effect: null,
    ops: [{ op: 'applyStatus', key: o.shroudKey, def: o.shroudDef, duration: rounds(2) }],
    ...(o.smokeVeil ? {
      zone: {
        name: 'Smoke Veil',
        duration: rounds(1),
        around: tiles(2),
        endsWithOwner: true,
        grow: null,
        ops: [{ op: 'speed', pct: -25 }],
      },
    } : {}),
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 5, fatigue: 4, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeDuskStrike(o: {
  readonly name: string;
  readonly formula: string;
  readonly pace?: 'standard' | 'heavy';
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const base = abilityOf('strike', {
    id: ID_STRIKE,
    name: o.name,
    aim: 'foe',
    range: tiles(1),
    shape: { kind: 'touch', reach: tiles(1) },
    delivery: { kind: 'travel', windup: tick(R.fight.abilityKinds.strike.windup), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'applyStatus', key: KEY_DUSK_BLEED, def: DUSK_BLEED, duration: rounds(2) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 4, fatigue: 6, time: cost(R.fight.cost[o.pace ?? 'standard']), cooldown: rounds(1) },
  };
}

const BASE_CLOAK = makeUmbralCloak({
  name: 'Umbral Cloak',
  shroudKey: KEY_SHROUDED,
  shroudDef: SHROUDED,
  cooldownRounds: 3,
});

const UP_CLOAK_GHOST = makeUmbralCloak({
  name: 'Umbral Cloak: Ghost Cloak',
  shroudKey: KEY_GHOST_SHROUD,
  shroudDef: GHOST_SHROUD,
  cooldownRounds: 2,
});

const UP_CLOAK_SMOKE = makeUmbralCloak({
  name: 'Umbral Cloak: Smoke Veil',
  shroudKey: KEY_SHROUDED,
  shroudDef: SHROUDED,
  cooldownRounds: 3,
  smokeVeil: true,
});

const BASE_STRIKE = makeDuskStrike({
  name: 'Dusk Strike',
  formula: '1d6 + 0.65 * finesse',
});

const UP_STRIKE_THROAT = makeDuskStrike({
  name: 'Dusk Strike: Throat Cut',
  formula: '1d8 + 0.75 * finesse',
  pace: 'heavy',
  extraOps: [{ op: 'stagger', share: 0.25 }],
});

/** Base Nightblade signature (before skill-tree nodes are folded on top). */
export const NIGHTBLADE_SIGNATURE: ClassSignature = {
  className: 'Nightblade',
  bonus: { agi: 1, ins: 1 },
  worn: BASE_SHADOW_CRAFT,
  actives: [BASE_CLOAK, BASE_STRIKE],
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

/** Full 7-depth, 2-branch, 16-buyable (18-node) Rare Nightblade skill tree (Shroud / Blade). */
export const NIGHTBLADE_TREE: ClassTree = {
  className: 'Nightblade',
  rarity: 'rare',
  nodes: [
    // Depth 1: Root (1)
    node('night-root', 1, 'Alley Footing', 'Gain 2 Agility and 1 Instinct.', [], [
      bonus({ agi: 2, ins: 1 }),
    ]),

    // Depth 2: Two branches (2)
    node('night-a2', 2, 'Veiled Stride', 'Gain 2 Agility and 4 speed.', ['night-root'], [
      bonus({ agi: 2, speed: 4 }),
    ]),
    node('night-b2', 2, 'Darkened Steel', 'Gain 2 Instinct and 4 flat armor penetration.', ['night-root'], [
      bonus({ ins: 2, armorPenFlat: 4 }),
    ]),

    // Depth 3: Branch splits (4)
    node('night-a3x', 3, 'Silent Approach', 'Gain 2 Agility and 4 Reaction.', ['night-a2'], [
      bonus({ agi: 2, react: 4 }),
    ]),
    node('night-a3y', 3, 'Quick Vanish', 'Gain 6 ability haste and 3 opening.', ['night-a2'], [
      bonus({ haste: 6, opening: 3 }),
    ]),
    node('night-b3x', 3, 'Keen Edge', 'Gain 2 Instinct and 0.06 crit multiplier.', ['night-b2'], [
      bonus({ ins: 2, critSize: 6 }),
    ]),
    node('night-b3y', 3, 'Vicious Cut', 'Gain 4% armor penetration and 4 flat armor penetration.', ['night-b2'], [
      bonus({ armorPen: 4, armorPenFlat: 4 }),
    ]),

    // Depth 4: Deepening (4)
    node('night-a4x', 4, 'Night Reflex', 'Gain 3 Agility, 5 Reaction, and 1 move tile.', ['night-a3x'], [
      bonus({ agi: 3, react: 5, move: 1 }),
    ]),
    node('night-a4y', 4, 'Dusk Tempo', 'Gain 8 ability haste and 5 speed.', ['night-a3y'], [
      bonus({ haste: 8, speed: 5 }),
    ]),
    node('night-b4x', 4, 'Lethal Poise', 'Gain 3 Instinct, 0.08 crit multiplier, and 3 Accuracy.', ['night-b3x'], [
      bonus({ ins: 3, critSize: 8, aim: 3 }),
    ]),
    node('night-b4y', 4, 'Armor Seeker', 'Gain 5% armor penetration and 5 flat armor penetration.', ['night-b3y'], [
      bonus({ armorPen: 5, armorPenFlat: 5 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (4 nodes, 2 buyable)
    node('night-a5-l', 5, 'Ghost Cloak', 'Upgrade Umbral Cloak to a 2-round cooldown with Ghost Shroud (+15% speed and advantage on your next attack).', ['night-a4x', 'night-a4y'], [
      replaceActive(ID_CLOAK, UP_CLOAK_GHOST),
    ], { forkGroup: 'night-a5' }),
    node('night-a5-r', 5, 'Smoke Veil', 'Upgrade Umbral Cloak to leave a 1-round Smoke Veil around you that slows foes within 2 tiles by 25%.', ['night-a4x', 'night-a4y'], [
      replaceActive(ID_CLOAK, UP_CLOAK_SMOKE),
    ], { forkGroup: 'night-a5' }),

    node('night-b5-l', 5, 'Throat Cut', 'Upgrade Dusk Strike to a heavy strike with higher physical damage and 25% stagger.', ['night-b4x', 'night-b4y'], [
      replaceActive(ID_STRIKE, UP_STRIKE_THROAT),
    ], { forkGroup: 'night-b5' }),
    node('night-b5-r', 5, 'Night Edge', 'Gain 1 extra crit face, 3 Agility, 2 Instinct, and up to 18% more damage against foes above half HP.', ['night-b4x', 'night-b4y'], [
      bonus({ critFaces: 1, agi: 3, ins: 2 }),
      scaler({ measure: 'target', dir: 'over', start: 0.5, scale: 0.18 }),
    ], { forkGroup: 'night-b5' }),

    // Depth 6: Branch Capstones (2)
    node('night-a6', 6, 'Phantom Step', 'Gain 4 Agility, 6 speed, and 6 ability haste.', ['night-a5-l', 'night-a5-r'], [
      bonus({ agi: 4, speed: 6, haste: 6 }),
    ], { parentMode: 'any' }),
    node('night-b6', 6, 'Dusk Precision', 'Gain 4 Instinct, 5% armor penetration, and 0.06 crit multiplier.', ['night-b5-l', 'night-b5-r'], [
      bonus({ ins: 4, armorPen: 5, critSize: 6 }),
    ], { parentMode: 'any' }),

    // Depth 7: Rare Capstone (1)
    node('night-cap', 7, 'Master of Dusk', 'Upgrade Shadow Craft to Master of Dusk and gain 4 Agility, 4 Instinct, and 4 flat armor penetration.', ['night-a6', 'night-b6'], [
      replaceWorn(KEY_SHADOW_CRAFT, MASTER_OF_DUSK),
      bonus({ agi: 4, ins: 4, armorPenFlat: 4 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
