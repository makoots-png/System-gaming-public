// class-runeknight.ts: Rare Runeknight (Fighter branch, str+pow) signature kit and full 18-node / 16-buyable tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
//
// Spellblade weaving ranged arcane sigils into melee detonations: shields on spell casts, marks foes with Runemark,
// and consumes all Runemark stacks on Runeblade Slash for bonus arcane-scaled physical impact.
// Root budget at rank C (`RULES.rarities.rare.rank = 'C'`, level 20, settled.md ~12-point Rare unspecialized root):
// - Sheet bonus `{ str: 1, pow: 1 }` spends 2.00 pts.
// - Worn `Runic Edge` shields `0.03 * hpmax` once a round on spell use and adds 1 Runemark stack on spell hit.
// - Actives (`Sigil Bolt`, `Runeblade Slash`) stay inside worth.ts C-rank budgets; `from: 'target'` stack prices
//   consume 0..N stacks cleanly so Runeblade Slash is always castable even before a spell lands.
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityId, Price } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { LandOp, StackDef, StatusDef, StatusKey, UseOp } from '../combat/effect-ops.ts';
import type { Limit } from '../combat/triggers.ts';
import { tiles } from '../combat/space.ts';
import { cost, tick } from '../combat/timeline.ts';
import type { Tick } from '../combat/timeline.ts';
import { abilityOf, SPELL_TAG } from './ability-kinds.ts';
import type { Scaler } from './scalers.ts';
import type { ClassNodeDef, ClassTree, ClassWorn, NodeGift, TreeDepth } from './class-trees.ts';
import type { ClassSignature } from './class-powers.ts';

const R = RULES;
const nid = (s: string): ClassNodeId => {
  const id = parseClassNodeId(s);
  if (!id) throw new Error(`Invalid Runeknight node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Runeknight formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const ROUND: Limit = { kind: 'round' };

const KEY_EDGE = statusKey('rune-edge');
const KEY_MASTER = statusKey('rune-master');
const KEY_MARK = statusKey('rune-mark');
const KEY_MARK_UP = statusKey('rune-mark-ii');
const KEY_FROST = statusKey('rune-frost');

const ID_BOLT = abilityId('rune-sigil-bolt');
const ID_SLASH = abilityId('rune-runeblade-slash');

// ── statuses ──

const RUNEMARK: StackDef = {
  label: 'Runemark',
  desc: 'Each stack adds 8% damage taken and lowers magic resist by 8 (up to 3 stacks) for 2 rounds.',
  ops: [
    { op: 'share', on: 'taken', pct: 8 },
    { op: 'sheet', key: 'resist', amount: f('-8') },
  ],
  stack: {
    cap: 3,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: null,
  },
};

const RUNEMARK_UP: StackDef = {
  label: 'Runemark II',
  desc: 'Each stack adds 8% damage taken and lowers magic resist by 8 (up to 4 stacks) for 2 rounds.',
  ops: [
    { op: 'share', on: 'taken', pct: 8 },
    { op: 'sheet', key: 'resist', amount: f('-8') },
  ],
  stack: {
    cap: 4,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: null,
  },
};

const RUNE_FROST: StatusDef = {
  label: 'Rune Frost',
  desc: 'Speed reduced by 15% for 2 rounds.',
  ops: [{ op: 'speed', pct: -15 }],
};

function makeRunicEdge(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly spellSelfOps: readonly LandOp[];
  readonly markKey: StatusKey;
  readonly markDef: StackDef;
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
          tag: SPELL_TAG,
          to: 'self',
          limit: ROUND,
          ops: o.spellSelfOps,
        },
        {
          on: 'hitDealt',
          tag: SPELL_TAG,
          to: 'other',
          limit: ROUND,
          ops: [{ op: 'applyStatus', key: o.markKey, def: o.markDef, duration: rounds(2) }],
        },
      ],
    },
  };
}

const BASE_EDGE: ClassWorn = makeRunicEdge({
  key: KEY_EDGE,
  label: 'Runic Edge',
  desc: 'Once a round when you cast a spell, gain a shield equal to 3% of your max HP. Once a round when your spell hits a foe, apply 1 stack of Runemark for 2 rounds.',
  spellSelfOps: [{ op: 'shield', amount: f('0.03 * hpmax') }],
  markKey: KEY_MARK,
  markDef: RUNEMARK,
});

const MASTER_RUNEBLADE: ClassWorn = makeRunicEdge({
  key: KEY_MASTER,
  label: 'Master Runeblade',
  desc: 'Once a round when you cast a spell, gain a shield equal to 6% of your max HP and restore 4 mana. Once a round when your spell hits a foe, apply 1 stack of Runemark II (up to 4 stacks) for 2 rounds.',
  spellSelfOps: [
    { op: 'shield', amount: f('0.06 * hpmax') },
    { op: 'mana', when: 'use', amount: f('4') },
  ],
  markKey: KEY_MARK_UP,
  markDef: RUNEMARK_UP,
});

// ── active ability builders ──

function makeSigilBolt(o: {
  readonly name: string;
  readonly desc: string;
  readonly radiusTiles?: number;
  readonly extraOps?: readonly UseOp[];
}): Ability {
  const isArea = o.radiusTiles !== undefined;
  const base = abilityOf('curse', {
    id: ID_BOLT,
    name: o.name,
    desc: o.desc,
    aim: isArea ? 'place' : 'foe',
    range: tiles(6),
    shape: isArea ? { kind: 'radius', radius: tiles(o.radiusTiles!), ring: null } : { kind: 'touch', reach: tiles(6) },
    delivery: { kind: 'direct' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f('1d6 + 0.55 * mag + 0.25 * phys') },
    ops: [
      { op: 'applyStatus', key: KEY_MARK, def: RUNEMARK, duration: rounds(2) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 5, fatigue: 5, time: cost(R.fight.cost.quick), cooldown: rounds(1) },
  };
}

// `from: 'target'` stack prices take 0..N stacks per caught target (never refused at 0 stacks) and feed `spent`.
// Capstone `Master Runeblade` rewrites `rune-mark` to `rune-mark-ii` via `upgrade-status` in `classPowers`.
const RUNEMARK_PRICES: readonly Price[] = [
  { kind: 'stacks', key: KEY_MARK, from: 'target', take: { kind: 'all' } },
];

function makeRunebladeSlash(o: {
  readonly name: string;
  readonly desc: string;
  readonly formula: string;
  readonly staggerShare: number;
  readonly cleaveRadius?: number;
}): Ability {
  const isCleave = o.cleaveRadius !== undefined;
  const base = abilityOf('strike', {
    id: ID_SLASH,
    name: o.name,
    desc: o.desc,
    aim: isCleave ? 'place' : 'foe',
    range: tiles(1),
    shape: isCleave ? { kind: 'radius', radius: tiles(o.cleaveRadius!), ring: null } : { kind: 'touch', reach: tiles(1) },
    delivery: { kind: 'travel', windup: tick(R.fight.abilityKinds.strike.windup), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [{ op: 'stagger', share: o.staggerShare }],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 5, fatigue: 7, time: cost(R.fight.cost.standard), cooldown: rounds(1) },
    prices: RUNEMARK_PRICES,
  };
}

const BASE_BOLT = makeSigilBolt({
  name: 'Sigil Bolt',
  desc: 'Quick arcane strike on a foe within 6 tiles that applies Runemark for 2 rounds.',
});

const UP_BOLT_ARCING = makeSigilBolt({
  name: 'Sigil Bolt: Arcing Sigil',
  desc: 'Quick arcane blast in a 2-tile radius within 6 tiles that applies Runemark for 2 rounds.',
  radiusTiles: 2,
});

const UP_BOLT_FROST = makeSigilBolt({
  name: 'Sigil Bolt: Frost Sigil',
  desc: 'Quick arcane strike on a foe within 6 tiles that applies Runemark and Rune Frost for 2 rounds.',
  extraOps: [{ op: 'applyStatus', key: KEY_FROST, def: RUNE_FROST, duration: rounds(2) }],
});

const BASE_SLASH = makeRunebladeSlash({
  name: 'Runeblade Slash',
  desc: 'Melee slash that consumes all Runemark stacks on the target for bonus scaling and fills 12% of their stagger bar.',
  formula: '1d8 + 0.65 * phys + 0.3 * mag + 0.25 * mag * spent',
  staggerShare: 0.12,
});

const UP_SLASH_DETONATE = makeRunebladeSlash({
  name: 'Runeblade Slash: Detonating Edge',
  desc: 'Melee slash that consumes all Runemark stacks on the target for stronger bonus scaling and fills 15% of their stagger bar.',
  formula: '1d8 + 0.7 * phys + 0.35 * mag + 0.3 * mag * spent',
  staggerShare: 0.15,
});

const UP_SLASH_CLEAVE = makeRunebladeSlash({
  name: 'Runeblade Slash: Runic Cleave',
  desc: 'Cleave foes in a 1-tile radius, consuming all Runemark stacks for bonus scaling and filling 12% of their stagger bar.',
  formula: '1d8 + 0.65 * phys + 0.3 * mag + 0.25 * mag * spent',
  staggerShare: 0.12,
  cleaveRadius: 1,
});

/** Base Runeknight signature (before skill-tree nodes are folded on top). */
export const RUNEKNIGHT_SIGNATURE: ClassSignature = {
  className: 'Runeknight',
  bonus: { str: 1, pow: 1 },
  worn: BASE_EDGE,
  actives: [BASE_BOLT, BASE_SLASH],
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
const upgradeStatus = (targetKey: StatusKey, key: StatusKey, def: StatusDef): NodeGift => ({ kind: 'upgrade-status', targetKey, key, def });

/** Full 7-depth, 2-branch, 16-buyable (18-node) Rare Runeknight skill tree (Sigil / Blade). */
export const RUNEKNIGHT_TREE: ClassTree = {
  className: 'Runeknight',
  rarity: 'rare',
  nodes: [
    // Depth 1: Root (1)
    node('rune-root', 1, 'Inscribed Hilt', 'Gain 2 Strength and 1 Power.', [], [
      bonus({ str: 2, pow: 1 }),
    ]),

    // Depth 2: Two branches (2)
    node('rune-a2', 2, 'Glyph Channeling', 'Gain 2 Power and 3 max mana.', ['rune-root'], [
      bonus({ pow: 2, manaMax: 3 }),
    ]),
    node('rune-b2', 2, 'Forged Sigil Steel', 'Gain 2 Strength and 3% armor penetration.', ['rune-root'], [
      bonus({ str: 2, armorPen: 3 }),
    ]),

    // Depth 3: Branch splits (4)
    node('rune-a3x', 3, 'Etched Focus', 'Gain 2 Power and 4% magic penetration.', ['rune-a2'], [
      bonus({ pow: 2, resistPen: 4 }),
    ]),
    node('rune-a3y', 3, 'Vault Cadence', 'Gain 6 ability haste and 3 max mana.', ['rune-a2'], [
      bonus({ haste: 6, manaMax: 3 }),
    ]),
    node('rune-b3x', 3, 'Rune Tempered', 'Gain 3 Strength and 4 flat armor penetration.', ['rune-b2'], [
      bonus({ str: 3, armorPenFlat: 4 }),
    ]),
    node('rune-b3y', 3, 'Warded Frame', 'Gain 15 max HP and 4% heal and shield bonus.', ['rune-b2'], [
      bonus({ hpMax: 15, healPower: 4 }),
    ]),

    // Depth 4: Deepening (4)
    node('rune-a4x', 4, 'Sigil Resonance', 'Gain 3 Power, 5% magic penetration, and 4 potency.', ['rune-a3x'], [
      bonus({ pow: 3, resistPen: 5, potency: 4 }),
    ]),
    node('rune-a4y', 4, 'Arcane Weave', 'Gain 8 ability haste and 3% cost cut.', ['rune-a3y'], [
      bonus({ haste: 8, costCut: 3 }),
    ]),
    node('rune-b4x', 4, 'Cleaving Runes', 'Gain 3 Strength, 4% armor penetration, and 4 flat armor penetration.', ['rune-b3x'], [
      bonus({ str: 3, armorPen: 4, armorPenFlat: 4 }),
    ]),
    node('rune-b4y', 4, 'Aegis Carvings', 'Gain 20 max HP and 6% heal and shield bonus.', ['rune-b3y'], [
      bonus({ hpMax: 20, healPower: 6 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (4 nodes, 2 buyable)
    node('rune-a5-l', 5, 'Arcing Sigil', 'Change Sigil Bolt to blast foes in a 2-tile radius and apply Runemark to every foe caught.', ['rune-a4x', 'rune-a4y'], [
      replaceActive(ID_BOLT, UP_BOLT_ARCING),
    ], { forkGroup: 'rune-a5' }),
    node('rune-a5-r', 5, 'Frost Sigil', 'Upgrade Sigil Bolt to also apply 2 rounds of Rune Frost, reducing speed by 15%.', ['rune-a4x', 'rune-a4y'], [
      replaceActive(ID_BOLT, UP_BOLT_FROST),
    ], { forkGroup: 'rune-a5' }),

    node('rune-b5-l', 5, 'Detonating Edge', 'Upgrade Runeblade Slash with stronger physical and Runemark detonation scaling, 15% stagger, and up to 18% more damage against foes above half HP.', ['rune-b4x', 'rune-b4y'], [
      replaceActive(ID_SLASH, UP_SLASH_DETONATE),
      scaler({ measure: 'target', dir: 'over', start: 0.5, scale: 0.18 }),
    ], { forkGroup: 'rune-b5' }),
    node('rune-b5-r', 5, 'Runic Cleave', 'Change Runeblade Slash to cleave all foes in a 1-tile radius, spending each foe\'s Runemark stacks.', ['rune-b4x', 'rune-b4y'], [
      replaceActive(ID_SLASH, UP_SLASH_CLEAVE),
    ], { forkGroup: 'rune-b5' }),

    // Depth 6: Branch Capstones (2)
    node('rune-a6', 6, 'Glyph Mastery', 'Gain 4 Power, 5% magic penetration, and 6 ability haste.', ['rune-a5-l', 'rune-a5-r'], [
      bonus({ pow: 4, resistPen: 5, haste: 6 }),
    ], { parentMode: 'any' }),
    node('rune-b6', 6, 'Runeforged Might', 'Gain 4 Strength, 5% armor penetration, and 20 max HP.', ['rune-b5-l', 'rune-b5-r'], [
      bonus({ str: 4, armorPen: 5, hpMax: 20 }),
    ], { parentMode: 'any' }),

    // Depth 7: Rare Capstone (1)
    node('rune-cap', 7, 'Master Runeblade', 'Upgrade Runic Edge to Master Runeblade, raise Runemark cap to 4 stacks, and gain 4 Strength, 4 Power, and 4 max mana.', ['rune-a6', 'rune-b6'], [
      replaceWorn(KEY_EDGE, MASTER_RUNEBLADE),
      upgradeStatus(KEY_MARK, KEY_MARK_UP, RUNEMARK_UP),
      bonus({ str: 4, pow: 4, manaMax: 4 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
