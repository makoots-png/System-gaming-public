// class-pyromancer.ts: Rare Pyromancer (Mage branch, pow+ctl) signature kit and full 18-node / 16-buyable tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
//
// Pure burn-setup -> mag-scaling detonation identity (no borrowed crit theme, per w1p7-neon-on-fable.md):
// - Root budget at rank C (`RULES.rarities.rare.rank = 'C'`, level 20, settled.md ~12-point Rare unspecialized root):
//   - Sheet bonus `{ pow: 1, ctl: 1 }` spends 2.00 pts (1 pt per stat point, item-budget.ts `BONUS_COST`).
//   - Worn `Cinder Wake` applies 1 stack of `Cinder` (cap 2, 2-round duration, light tiered ember tick) on every spell hit;
//     at 2 stacks (hitting a burning foe), the threshold spends both stacks and flares for `0.12 * mag` arcane damage
//     (evaluated on Pyromancer's own `mag` via `landThreshold`, scaling with `pow`, gear, and tree!).
//   - All per-round victim DoTs (`Cinder` tick, `Magma Floor` zone, `Ember Mark` tick, `Wildfire`) use rank-tiered formulas
//     because `payDue` evaluates per-round ops on the victim's sheet via `atTier`; all pops (`Cinder` threshold, `Ember Mark`
//     end, and `Cinder Pit` `zone.end`) read Pyromancer's own `mag`. Exact root spend verified <= 12.0 pts by tests/rare-classes.test.ts.
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { LandOp, Op, Reach, StackDef, StatusDef, StatusKey, Tiers } from '../combat/effect-ops.ts';
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
  if (!id) throw new Error(`Invalid Pyromancer node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Pyromancer formula "${text}"`);
  return p.formula;
};
const tiered = (e: string, d: string, c: string, b: string, a: string, s: string): Tiers<Formula> =>
  [f(e), f(d), f(c), f(b), f(a), f(s)];
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const area = (radius: number, on: 'allies' | 'foes'): Reach => ({ kind: 'area', radius: tiles(radius), on });

const KEY_WAKE = statusKey('pyro-cinder-wake');
const KEY_WAKE_UP = statusKey('pyro-cinder-wake-ii');
const KEY_CINDER = statusKey('pyro-cinder');
const KEY_CINDER_UP = statusKey('pyro-cinder-ii');
const KEY_WILDFIRE = statusKey('pyro-wildfire');
const KEY_EMBER = statusKey('pyro-ember-mark');
const KEY_EMBER_UP = statusKey('pyro-ember-mark-ii');

const ID_MAGMA = abilityId('pyro-magma-floor');
const ID_LANCE = abilityId('pyro-ignition-lance');

// ── statuses ──

const PYRO_WILDFIRE: StatusDef = {
  label: 'Wildfire',
  desc: 'Takes arcane fire damage every round and spreads to adjacent foes once per fight.',
  ops: [
    { op: 'damage', type: 'arcane', when: 'turn', amount: tiered('1d6', '1d8', '2d6', '2d8', '3d8', '4d8') },
    { op: 'spread', range: 1 },
  ],
};

// Shared Cinder stack def (used by Cinder Wake and Kindle Burst): light rank-tiered ember burn, flares off Pyromancer's `mag` at 2 stacks.
const PYRO_CINDER: StackDef = {
  label: 'Cinder',
  desc: 'Takes light arcane fire damage each round. At 2 stacks, spends all stacks to deal arcane damage equal to 12% of the caster\'s magic power.',
  ops: [{ op: 'damage', type: 'arcane', when: 'turn', amount: tiered('1', '1', '1', '1d2', '1d4', '1d6') }],
  stack: {
    cap: 2,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: {
      at: { kind: 'count', n: 2 },
      to: { kind: 'bearer' },
      then: 'spend',
      ops: [{ op: 'damage', type: 'arcane', when: 'use', amount: f('0.12 * mag') }],
    },
  },
};

// Capstone Cinder II: at 2 stacks, detonates in a 2-tile radius around the victim (victim's side = foes of Pyromancer) for 45% of mag and ignites Wildfire.
const PYRO_CINDER_UP: StackDef = {
  label: 'Cinder II',
  desc: 'Takes arcane fire damage each round. At 2 stacks, spends all stacks to blast foes within 2 tiles for 45% of the caster\'s magic power and ignite Wildfire.',
  ops: [{ op: 'damage', type: 'arcane', when: 'turn', amount: tiered('1d2', '1d3', '1d4', '1d6', '1d8', '2d6') }],
  stack: {
    cap: 2,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: {
      at: { kind: 'count', n: 2 },
      to: area(2, 'allies'),
      then: 'spend',
      ops: [
        { op: 'damage', type: 'arcane', when: 'use', amount: f('0.45 * mag') },
        { op: 'applyStatus', key: KEY_WILDFIRE, def: PYRO_WILDFIRE, duration: rounds(2) },
      ],
    },
  },
};

function makeCinderWake(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly cinderKey: StatusKey;
  readonly cinderDef: StackDef;
  readonly extraOps?: readonly Op[];
}): ClassWorn {
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [...(o.extraOps ?? [])],
      triggers: [
        {
          on: 'hitDealt',
          tag: SPELL_TAG,
          to: 'other',
          limit: EACH,
          ops: [{ op: 'applyStatus', key: o.cinderKey, def: o.cinderDef, duration: rounds(2) }],
        },
      ],
    },
  };
}

// Root passive: spell hits stack Cinder; hitting a burning foe for stack 2 flares off Pyromancer's mag (<= 12.0 pts at C with bonus).
const BASE_WAKE: ClassWorn = makeCinderWake({
  key: KEY_WAKE,
  label: 'Cinder Wake',
  desc: 'Your spell hits apply 1 stack of Cinder for 2 rounds. At 2 stacks, Cinder deals arcane damage equal to 12% of your magic power.',
  cinderKey: KEY_CINDER,
  cinderDef: PYRO_CINDER,
});

// Depth 7 Capstone passive: adds 8% magic penetration and upgrades Cinder to a 2-tile area blast (45% mag) + spreading Wildfire.
const LIVING_FURNACE: ClassWorn = makeCinderWake({
  key: KEY_WAKE_UP,
  label: 'Living Furnace',
  desc: 'Ignore 8% of magic resist. Your spell hits apply Cinder II. At 2 stacks, Cinder II blasts foes within 2 tiles for 45% of your magic power and ignites Wildfire.',
  cinderKey: KEY_CINDER_UP,
  cinderDef: PYRO_CINDER_UP,
  extraOps: [{ op: 'sheet', key: 'resistPen', amount: { kind: 'number', value: 8 } }],
});

// ── active ability builders ──

function makeMagmaFloor(o: {
  readonly name: string;
  readonly formula: string;
  readonly durationRounds: number;
  readonly zoneTick: Tiers<Formula>;
  readonly growCap: number | null;
  readonly slowPct: number | null;
  readonly zoneEnd?: readonly LandOp[];
}): Ability {
  const zoneOps: Op[] = [
    { op: 'damage', type: 'arcane', when: 'turn', amount: o.zoneTick },
    ...(o.slowPct !== null ? [{ op: 'speed' as const, pct: o.slowPct }] : []),
  ];
  const base = abilityOf('blast', {
    id: ID_MAGMA,
    name: o.name,
    aim: 'place',
    range: tiles(9),
    shape: { kind: 'radius', radius: tiles(2), ring: null },
    delivery: { kind: 'travel', windup: tick(800), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    zone: {
      name: o.name,
      duration: rounds(o.durationRounds),
      around: null,
      endsWithOwner: false,
      grow: o.growCap !== null ? { step: tiles(1), cap: tiles(o.growCap) } : null,
      ops: zoneOps,
      ...(o.zoneEnd ? { end: o.zoneEnd } : {}),
    },
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 8, fatigue: 4, time: cost(R.fight.cost.heavy), cooldown: rounds(3) },
  };
}

const BASE_EMBER_MARK: StatusDef = {
  label: 'Ember Mark',
  desc: 'Takes arcane fire damage each round and detonates when it ends. Curing cancels the blast.',
  ops: [{ op: 'damage', type: 'arcane', when: 'turn', amount: tiered('1d4', '1d4', '1d6', '2d4', '2d6', '2d8') }],
  end: {
    cleanse: 'cancel',
    ops: [{ op: 'damage', type: 'arcane', when: 'use', amount: f('1d6 + 0.35 * mag') }],
  },
};

const UP_EMBER_MARK: StatusDef = {
  label: 'Ember Mark II',
  desc: 'Takes arcane fire damage each round and detonates when it ends or is cured.',
  ops: [{ op: 'damage', type: 'arcane', when: 'turn', amount: tiered('1d4', '1d6', '1d6', '2d4', '2d6', '3d6') }],
  end: {
    cleanse: 'land',
    ops: [{ op: 'damage', type: 'arcane', when: 'use', amount: f('1d6 + 0.4 * mag') }],
  },
};

function makeIgnitionLance(o: {
  readonly name: string;
  readonly markKey: StatusKey;
  readonly markDef: StatusDef;
  readonly formula: string;
  readonly cooldownRounds: number;
  readonly extraOps?: readonly Ability['ops'][number][];
}): Ability {
  const base = abilityOf('curse', {
    id: ID_LANCE,
    name: o.name,
    aim: 'foe',
    range: tiles(8),
    delivery: { kind: 'direct' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'applyStatus', key: o.markKey, def: o.markDef, duration: rounds(2) },
      ...(o.extraOps ?? []),
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 4, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

// Heavy-pace blast (below 1.50 SA budget at rank C to pay for the 3-round tiered lava carpet zone).
const BASE_MAGMA = makeMagmaFloor({
  name: 'Magma Floor',
  formula: '2d8 + 0.9 * mag',
  durationRounds: 3,
  zoneTick: tiered('1d6', '1d8', '2d6', '3d6', '3d8', '4d10'),
  growCap: null,
  slowPct: null,
});

// D5 Fork A-Left (area denial): magma zone expands from radius 2 to radius 3 over 3 rounds, burns harder, and slows foes 15%.
const UP_MAGMA_BASIN = makeMagmaFloor({
  name: 'Magma Floor: Molten Basin',
  formula: '2d10 + mag',
  durationRounds: 3,
  zoneTick: tiered('1d8', '2d6', '2d8', '3d8', '4d8', '5d10'),
  growCap: 3,
  slowPct: -15,
});

// D5 Fork A-Right (zone-end detonation): 2-round magma pit whose `zone.end` detonates foes left inside off Pyromancer's `mag`.
const UP_MAGMA_PIT = makeMagmaFloor({
  name: 'Magma Floor: Cinder Pit',
  formula: '2d8 + 0.95 * mag',
  durationRounds: 2,
  zoneTick: tiered('1d6', '1d8', '2d6', '3d6', '3d8', '4d10'),
  growCap: null,
  slowPct: null,
  zoneEnd: [{ op: 'damage', type: 'arcane', when: 'use', amount: f('1d8 + 0.65 * mag') }],
});

// Standard-pace curse priced inside C-rank standard SA budget across upfront hit + 2-round burn + mag-scaling detonation.
const BASE_LANCE = makeIgnitionLance({
  name: 'Ignition Lance',
  markKey: KEY_EMBER,
  markDef: BASE_EMBER_MARK,
  formula: '1d8 + 0.58 * mag',
  cooldownRounds: 2,
});

// D5 Fork B-Left (sustained detonation): 1-round cooldown, higher blast damage, and curing detonates Ember Mark II early.
const UP_LANCE_FLASH = makeIgnitionLance({
  name: 'Ignition Lance: Flash Detonation',
  markKey: KEY_EMBER_UP,
  markDef: UP_EMBER_MARK,
  formula: '1d10 + 0.65 * mag',
  cooldownRounds: 1,
});

// D5 Fork B-Right (instant Cinder flare): keeps base lance hit and 2-round cooldown, adds 2 stacks of Cinder on hit for
// an immediate mag-scaled flare. Pre-capstone it cleanly upgrades base lance at every HP threshold while Flash Detonation
// stays ahead on sustained single-target; post-capstone (`upgrade-status` -> Cinder II) it leads clustered AoE burst.
const UP_LANCE_KINDLE = makeIgnitionLance({
  name: 'Ignition Lance: Kindle Burst',
  markKey: KEY_EMBER,
  markDef: BASE_EMBER_MARK,
  formula: '1d8 + 0.58 * mag',
  cooldownRounds: 2,
  extraOps: [{ op: 'applyStatus', key: KEY_CINDER, def: PYRO_CINDER, duration: rounds(2), stacks: 2 }],
});

/** Base Pyromancer signature (before skill-tree nodes are folded on top). */
export const PYROMANCER_SIGNATURE: ClassSignature = {
  className: 'Pyromancer',
  bonus: { pow: 1, ctl: 1 },
  worn: BASE_WAKE,
  actives: [BASE_MAGMA, BASE_LANCE],
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

/** Full 7-depth, 2-branch, 16-buyable (18-node) Rare Pyromancer skill tree. */
export const PYROMANCER_TREE: ClassTree = {
  className: 'Pyromancer',
  rarity: 'rare',
  nodes: [
    // Depth 1: Root (1)
    node('pyro-root', 1, 'Kindled Focus', 'Gain 2 Power and 1 Control.', [], [
      bonus({ pow: 2, ctl: 1 }),
    ]),

    // Depth 2: Two branches (2)
    node('pyro-a2', 2, 'Ash Mantle', 'Gain 2 Power and 3% magic penetration.', ['pyro-root'], [
      bonus({ pow: 2, resistPen: 3 }),
    ]),
    node('pyro-b2', 2, 'Stoked Embers', 'Gain 2 Control and 2 max mana.', ['pyro-root'], [
      bonus({ ctl: 2, manaMax: 2 }),
    ]),

    // Depth 3: Branch splits (4)
    node('pyro-a3x', 3, 'Slag Crust', 'Gain 3 Power and 4 flat magic penetration.', ['pyro-a2'], [
      bonus({ pow: 3, resistPenFlat: 4 }),
    ]),
    node('pyro-a3y', 3, 'Thermal Vent', 'Gain 4% magic penetration and 2 max mana.', ['pyro-a2'], [
      bonus({ resistPen: 4, manaMax: 2 }),
    ]),
    node('pyro-b3x', 3, 'Focused Blaze', 'Gain 2 Power and 3 Control.', ['pyro-b2'], [
      bonus({ pow: 2, ctl: 3 }),
    ]),
    node('pyro-b3y', 3, 'Rapid Ignition', 'Gain 6 ability haste and 2 max mana.', ['pyro-b2'], [
      bonus({ haste: 6, manaMax: 2 }),
    ]),

    // Depth 4: Deepening (4)
    node('pyro-a4x', 4, 'Scorched Earth', 'Gain 3 Power and 5 flat magic penetration.', ['pyro-a3x'], [
      bonus({ pow: 3, resistPenFlat: 5 }),
    ]),
    node('pyro-a4y', 4, 'Furnace Pressure', 'Gain 5% magic penetration and 3 Power.', ['pyro-a3y'], [
      bonus({ resistPen: 5, pow: 3 }),
    ]),
    node('pyro-b4x', 4, 'Fuel Efficiency', 'Gain 3 Control and 3% cost cut.', ['pyro-b3x'], [
      bonus({ ctl: 3, costCut: 3 }),
    ]),
    node('pyro-b4y', 4, 'Stoked Flame', 'Gain 8 ability haste and 3 max mana.', ['pyro-b3y'], [
      bonus({ haste: 8, manaMax: 3 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (4 nodes, 2 buyable — two-way active forks)
    node('pyro-a5-l', 5, 'Molten Basin', 'Upgrade Magma Floor to grow from radius 2 to 3, burn harder, and slow foes by 15%.', ['pyro-a4x', 'pyro-a4y'], [
      replaceActive(ID_MAGMA, UP_MAGMA_BASIN),
    ], { forkGroup: 'pyro-a5' }),
    node('pyro-a5-r', 5, 'Cinder Pit', 'Change Magma Floor to a 2-round pit that detonates foes left inside when it ends, and gain 6% magic penetration and 6 flat magic penetration.', ['pyro-a4x', 'pyro-a4y'], [
      replaceActive(ID_MAGMA, UP_MAGMA_PIT),
      bonus({ resistPen: 6, resistPenFlat: 6 }),
    ], { forkGroup: 'pyro-a5' }),

    node('pyro-b5-l', 5, 'Flash Detonation', 'Upgrade Ignition Lance to a 1-round cooldown, higher blast damage, and an Ember Mark that detonates if cured.', ['pyro-b4x', 'pyro-b4y'], [
      replaceActive(ID_LANCE, UP_LANCE_FLASH),
    ], { forkGroup: 'pyro-b5' }),
    node('pyro-b5-r', 5, 'Kindle Burst', 'Upgrade Ignition Lance to trigger an immediate Cinder burst on hit and deal up to 15% more damage against foes above half HP.', ['pyro-b4x', 'pyro-b4y'], [
      replaceActive(ID_LANCE, UP_LANCE_KINDLE),
      scaler({ measure: 'target', dir: 'over', start: 0.5, scale: 0.15 }),
    ], { forkGroup: 'pyro-b5' }),

    // Depth 6: Branch Capstones (2)
    node('pyro-a6', 6, 'Caldera Heart', 'Gain 4 Power, 5% magic penetration, and 5 flat magic penetration.', ['pyro-a5-l', 'pyro-a5-r'], [
      bonus({ pow: 4, resistPen: 5, resistPenFlat: 5 }),
    ], { parentMode: 'any' }),
    node('pyro-b6', 6, 'Ash Mastery', 'Gain 4 Power, 3 Control, and 8 ability haste.', ['pyro-b5-l', 'pyro-b5-r'], [
      bonus({ pow: 4, ctl: 3, haste: 8 }),
    ], { parentMode: 'any' }),

    // Depth 7: Rare Capstone (1)
    node('pyro-cap', 7, 'Living Furnace', 'Upgrade Cinder Wake to Living Furnace, make Kindle Burst apply Cinder II, and gain 5 Power, 3 Control, and 4 max mana.', ['pyro-a6', 'pyro-b6'], [
      replaceWorn(KEY_WAKE, LIVING_FURNACE),
      upgradeStatus(KEY_CINDER, KEY_CINDER_UP, PYRO_CINDER_UP),
      bonus({ pow: 5, ctl: 3, manaMax: 4 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
