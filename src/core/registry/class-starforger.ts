// class-starforger.ts: Mythic Starforger (pow+ctl) signature kit and full 38-node / 32-buyable skill tree.
// Pure static registry data. No gold literals: node and fork-flip prices come solely from RULES via classes.ts.
// Per-round Star zone burn uses rank-tiered formulas because payDue evaluates per-round ops on the victim's sheet via
// atTier, while Starforge impact, Star zone end detonation, and Supernova read Starforger's own mag (plus Hook 1 spent).
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { abilityId, tag } from '../combat/ability-types.ts';
import type { Ability, AbilityId, ZoneAct } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { Op, StatusDef, StatusKey, Tiers, UseOp } from '../combat/effect-ops.ts';
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
  if (!id) throw new Error(`Invalid Starforger node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Starforger formula "${text}"`);
  return p.formula;
};
const tiered = (e: string, d: string, c: string, b: string, a: string, s: string): Tiers<Formula> =>
  [f(e), f(d), f(c), f(b), f(a), f(s)];
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };

const TAG_SUPERNOVA = tag('supernova');

const KEY_LOOM = statusKey('star-loom');
const KEY_ARCHITECT = statusKey('star-architect');
const KEY_BIND = statusKey('star-gravity-bind');
const KEY_STARLIT = statusKey('star-starlit');
const KEY_STARWARD = statusKey('star-starward');
const KEY_STARWARD_CONDUIT = statusKey('star-starward-conduit');

const ID_STARFORGE = abilityId('star-starforge');
const ID_SNARE = abilityId('star-gravity-snare');
const ID_AEGIS = abilityId('star-astral-aegis');
const ID_SUPERNOVA = abilityId('star-supernova');

// ── statuses ──

const GRAVITY_BIND: StatusDef = {
  label: 'Gravity Bind',
  desc: 'Rooted in place for 1 round.',
  ops: [{ op: 'root' }],
};

const STARLIT: StatusDef = {
  label: 'Starlit',
  desc: 'Takes 12% more damage and attacks against this target crit on 1 more die face for 2 rounds.',
  ops: [
    { op: 'share', on: 'taken', pct: 12 },
    { op: 'sheet', key: 'exposed', amount: 1 },
  ],
};

const STARWARD: StatusDef = {
  label: 'Starward',
  desc: 'Blocks harmful statuses from foes and increases damage dealt by 15% for 1 round.',
  ops: [
    { op: 'safeguard' },
    { op: 'share', on: 'dealt', pct: 15 },
  ],
};

const STARWARD_CONDUIT: StatusDef = {
  label: 'Starward Conduit',
  desc: 'Blocks harmful statuses from foes, increases damage dealt by 15%, and increases speed by 15% for 1 round.',
  ops: [
    { op: 'safeguard' },
    { op: 'share', on: 'dealt', pct: 15 },
    { op: 'speed', pct: 15 },
  ],
};

function makeStellarLoom(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly dealtPct: number;
  readonly resistPenPct: number;
  readonly coronaShield: string;
  readonly siphonMana: string;
  readonly siphonHeal: string;
  readonly killMana: string;
  readonly novaEcho?: { readonly shield: string; readonly mana: string };
}): ClassWorn {
  const ops: Op[] = [
    { op: 'share', on: 'dealt', pct: o.dealtPct },
    ...(o.resistPenPct > 0 ? [{ op: 'sheet' as const, key: 'resistPen' as const, amount: { kind: 'number' as const, value: o.resistPenPct } }] : []),
  ];
  const triggers: Trigger[] = [
    // 1. Corona Ward: using a blast shields self once per round.
    { on: 'used', tag: KIND_TAG.blast, to: 'self', limit: ROUND, ops: [{ op: 'shield', amount: f(o.coronaShield) }] },
    // 2. Starlight Siphon: turn start restores mana and HP.
    {
      on: 'turnStart',
      to: 'self',
      limit: EACH,
      ops: [
        { op: 'mana', when: 'use', amount: f(o.siphonMana) },
        { op: 'heal', when: 'use', amount: f(o.siphonHeal) },
      ],
    },
    // 3. Gravity Well: defeating a foe restores mana once per round.
    { on: 'kill', tag: null, to: 'self', limit: ROUND, ops: [{ op: 'mana', when: 'use', amount: f(o.killMana) }] },
    // 4. Nova Echo (Capstone): casting Supernova shields self and restores mana.
    ...(o.novaEcho
      ? [{
        on: 'used' as const,
        tag: TAG_SUPERNOVA,
        to: 'self' as const,
        limit: EACH,
        ops: [
          { op: 'shield' as const, amount: f(o.novaEcho.shield) },
          { op: 'mana' as const, when: 'use' as const, amount: f(o.novaEcho.mana) },
        ],
      }]
      : []),
  ];
  return { key: o.key, def: { label: o.label, desc: o.desc, ops, triggers } };
}

const BASE_LOOM: ClassWorn = makeStellarLoom({
  key: KEY_LOOM,
  label: 'Stellar Loom',
  desc: 'Increases damage dealt by 8%. Using a blast shields you for 4% of max HP once a round. At the start of each turn, recover 6 mana and 2% of max HP. Defeating a foe restores 15 mana once a round.',
  dealtPct: 8,
  resistPenPct: 0,
  coronaShield: '0.04 * hpmax',
  siphonMana: '6',
  siphonHeal: '0.02 * hpmax',
  killMana: '15',
});

const ARCHITECT_LOOM: ClassWorn = makeStellarLoom({
  key: KEY_ARCHITECT,
  label: 'Celestial Architect',
  desc: 'Increases damage dealt by 10% and magic penetration by 10%. Using a blast shields you for 6% of max HP once a round. Turn start restores 8 mana and 2% of max HP. Kills restore 20 mana once a round. Supernova shields you for 10% of max HP and restores 12 mana.',
  dealtPct: 10,
  resistPenPct: 10,
  coronaShield: '0.06 * hpmax',
  siphonMana: '8',
  siphonHeal: '0.02 * hpmax',
  killMana: '20',
  novaEcho: { shield: '0.10 * hpmax', mana: '12' },
});

// ── active ability builders ──
// Every Starforge fork keeps zone.name = 'Star' so Supernova's zone price matches it.

const STAR_BURN_BASE = tiered('1d6', '1d8', '2d6', '3d6', '4d8', '5d10');
const STAR_BURN_PULSAR = tiered('1d8', '2d6', '2d8', '3d8', '5d8', '7d10');

function makeStarforge(o: {
  readonly name: string;
  readonly radius: number;
  readonly impactFormula: string;
  readonly zoneBurn: Tiers<Formula>;
  readonly endFormula: string;
  readonly endStagger: number;
}): Ability {
  const base = abilityOf('blast', {
    id: ID_STARFORGE,
    name: o.name,
    aim: 'place',
    range: tiles(8),
    shape: { kind: 'radius', radius: tiles(o.radius), ring: null },
    delivery: { kind: 'travel', windup: tick(300), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.impactFormula) },
    zone: {
      name: 'Star',
      duration: rounds(4),
      around: null,
      endsWithOwner: true,
      grow: null,
      ops: [
        { op: 'damage', type: 'arcane', when: 'turn', amount: o.zoneBurn },
        { op: 'speed', pct: -15 },
      ],
      end: [
        { op: 'damage', type: 'arcane', when: 'use', amount: f(o.endFormula) },
        { op: 'stagger', share: o.endStagger },
      ],
    },
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 10, fatigue: 6, time: cost(R.fight.cost.standard), cooldown: rounds(1) },
  };
}

function makeGravitySnare(o: {
  readonly name: string;
  readonly formula: string;
  readonly staggerShare: number;
  readonly root?: boolean;
  readonly shoveTiles?: number;
  readonly zoneAct?: ZoneAct;
}): Ability {
  const ops: UseOp[] = [
    { op: 'stagger', share: o.staggerShare },
    ...(o.root !== false ? [{ op: 'applyStatus' as const, key: KEY_BIND, def: GRAVITY_BIND, duration: rounds(1) }] : []),
    { op: 'applyStatus', key: KEY_STARLIT, def: STARLIT, duration: rounds(2) },
    ...(o.shoveTiles ? [{ op: 'shove' as const, dir: 'toward' as const, from: 'user' as const, tiles: o.shoveTiles }] : []),
  ];
  const base = abilityOf('curse', {
    id: ID_SNARE,
    name: o.name,
    aim: 'foe',
    range: tiles(8),
    shape: { kind: 'touch', reach: tiles(8) },
    delivery: { kind: 'direct' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops,
  }, R);
  return {
    ...base,
    ...(o.zoneAct ? { zoneAct: o.zoneAct } : {}),
    cost: { ...base.cost, mana: 8, fatigue: 6, time: cost(R.fight.cost.quick), cooldown: rounds(2) },
  };
}

function makeAstralAegis(o: {
  readonly name: string;
  readonly shieldFormula: string;
  readonly wardKey: StatusKey;
  readonly wardDef: StatusDef;
  readonly manaRestore?: number;
}): Ability {
  const ops: UseOp[] = [
    { op: 'applyStatus', key: o.wardKey, def: o.wardDef, duration: rounds(1) },
    ...(o.manaRestore ? [{ op: 'mana' as const, when: 'use' as const, amount: f(String(o.manaRestore)) }] : []),
  ];
  const base = abilityOf('support', {
    id: ID_AEGIS,
    name: o.name,
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
    cost: { ...base.cost, mana: 8, fatigue: 4, time: cost(R.fight.cost.quick), cooldown: rounds(2) },
  };
}

function makeSupernova(o: {
  readonly name: string;
  readonly formula: string;
  readonly cooldownRounds: number;
  readonly pace: 'quick' | 'standard';
}): Ability {
  const base = abilityOf('blast', {
    id: ID_SUPERNOVA,
    name: o.name,
    aim: 'place',
    range: tiles(8),
    shape: { kind: 'radius', radius: tiles(3), ring: null },
    delivery: { kind: 'travel', windup: tick(600), speed: 'instant' },
    foesOnly: true,
    effect: { type: 'arcane', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'stagger', share: 0.35 },
      { op: 'shove', dir: 'away', from: 'aim', tiles: 2 },
    ],
  }, R);
  return {
    ...base,
    tags: [TAG_SUPERNOVA],
    prices: [{ kind: 'zone', name: 'Star', take: 'all' }],
    cost: { ...base.cost, mana: 14, fatigue: 8, time: cost(R.fight.cost[o.pace]), cooldown: rounds(o.cooldownRounds) },
  };
}

const BASE_STARFORGE = makeStarforge({
  name: 'Starforge',
  radius: 2,
  impactFormula: '2d8 + 0.88 * mag',
  zoneBurn: STAR_BURN_BASE,
  endFormula: '2d10 + 0.96 * mag',
  endStagger: 0.25,
});

const UP_STARFORGE_BINARY = makeStarforge({
  name: 'Starforge: Binary Core',
  radius: 3,
  impactFormula: '2d8 + 0.96 * mag',
  zoneBurn: STAR_BURN_BASE,
  endFormula: '2d10 + 1.02 * mag',
  endStagger: 0.25,
});

const UP_STARFORGE_PULSAR = makeStarforge({
  name: 'Starforge: Pulsar Core',
  radius: 2,
  impactFormula: '2d8 + 0.88 * mag',
  zoneBurn: STAR_BURN_PULSAR,
  endFormula: '2d10 + 1.02 * mag',
  endStagger: 0.30,
});

const BASE_SNARE = makeGravitySnare({
  name: 'Gravity Snare',
  formula: '1d10 + 0.85 * mag',
  staggerShare: 0.30,
});

const UP_SNARE_PULL = makeGravitySnare({
  name: 'Gravity Snare: Orbital Pull',
  formula: '1d10 + 0.9 * mag',
  staggerShare: 0.35,
  root: false,
  shoveTiles: 2,
});

const UP_SNARE_DRIFT = makeGravitySnare({
  name: 'Gravity Snare: Stellar Drift',
  formula: '1d10 + 0.85 * mag',
  staggerShare: 0.30,
  zoneAct: { act: 'shift', name: 'Star', by: 4 },
});

const BASE_AEGIS = makeAstralAegis({
  name: 'Astral Aegis',
  shieldFormula: '0.20 * hpmax',
  wardKey: KEY_STARWARD,
  wardDef: STARWARD,
});

const UP_AEGIS_BASTION = makeAstralAegis({
  name: 'Astral Aegis: Radiant Bastion',
  shieldFormula: '0.24 * hpmax',
  wardKey: KEY_STARWARD,
  wardDef: STARWARD,
});

const UP_AEGIS_CONDUIT = makeAstralAegis({
  name: 'Astral Aegis: Solar Conduit',
  shieldFormula: '0.20 * hpmax',
  wardKey: KEY_STARWARD_CONDUIT,
  wardDef: STARWARD_CONDUIT,
  manaRestore: 10,
});

const BASE_SUPERNOVA = makeSupernova({
  name: 'Supernova',
  formula: '2d10 + 0.86 * mag + 0.50 * mag * spent',
  cooldownRounds: 3,
  pace: 'standard',
});

const UP_SUPERNOVA_SINGULARITY = makeSupernova({
  name: 'Supernova: Singularity',
  formula: '2d10 + 0.86 * mag + 0.68 * mag * spent',
  cooldownRounds: 3,
  pace: 'standard',
});

const UP_SUPERNOVA_CASCADE = makeSupernova({
  name: 'Supernova: Solar Cascade',
  formula: '2d10 + 0.86 * mag + 0.60 * mag * spent',
  cooldownRounds: 2,
  pace: 'quick',
});

/** Base Starforger signature (before skill-tree nodes are folded on top). */
export const STARFORGER_SIGNATURE: ClassSignature = {
  className: 'Starforger',
  bonus: { pow: 3, ctl: 3, manaMax: 35 },
  worn: BASE_LOOM,
  actives: [BASE_STARFORGE, BASE_SNARE, BASE_AEGIS, BASE_SUPERNOVA],
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

/** Full 9-depth, 3-branch, 32-buyable (38-node) Mythic Starforger skill tree. */
export const STARFORGER_TREE: ClassTree = {
  className: 'Starforger',
  rarity: 'mythic',
  nodes: [
    // Depth 1: Root (1)
    node('star-root', 1, 'Astral Awakening', 'Gain 2 Power, 2 Control, and 10 max mana.', [], [
      bonus({ pow: 2, ctl: 2, manaMax: 10 }),
    ]),

    // Depth 2: Three branches (3) — Forge (a), Orbit (b), Corona (c)
    node('star-a2', 2, 'Forge of Stars', 'Gain 3 Power and 5 max mana.', ['star-root'], [
      bonus({ pow: 3, manaMax: 5 }),
    ]),
    node('star-b2', 2, 'Orbital Mechanics', 'Gain 3 Control and 4 ability haste.', ['star-root'], [
      bonus({ ctl: 3, haste: 4 }),
    ]),
    node('star-c2', 2, 'Solar Corona', 'Gain 12 max HP and 4 tenacity.', ['star-root'], [
      bonus({ hpMax: 12, tenacity: 4 }),
    ]),

    // Depth 3: Branch splits (6)
    node('star-a3x', 3, 'Stellar Crucible', 'Gain 3 Power and 7 flat magic penetration.', ['star-a2'], [
      bonus({ pow: 3, resistPenFlat: 7 }),
    ]),
    node('star-a3y', 3, 'Radiant Fuel', 'Gain 10 max mana and 3 Power.', ['star-a2'], [
      bonus({ manaMax: 10, pow: 3 }),
    ]),
    node('star-b3x', 3, 'Gravity Lens', 'Gain 3 Control and 4 Accuracy.', ['star-b2'], [
      bonus({ ctl: 3, aim: 4 }),
    ]),
    node('star-b3y', 3, 'Tidal Pull', 'Gain 4 ability haste and 3 potency.', ['star-b2'], [
      bonus({ haste: 4, potency: 3 }),
    ]),
    node('star-c3x', 3, 'Corona Shell', 'Gain 12 max HP and 4 tenacity.', ['star-c2'], [
      bonus({ hpMax: 12, tenacity: 4 }),
    ]),
    node('star-c3y', 3, 'Astral Resolve', 'Gain 5 tenacity and 4 potency.', ['star-c2'], [
      bonus({ tenacity: 5, potency: 4 }),
    ]),

    // Depth 4: Deepening (6)
    node('star-a4x', 4, 'Superheated Core', 'Gain 4 Power and 9 flat magic penetration.', ['star-a3x'], [
      bonus({ pow: 4, resistPenFlat: 9 }),
    ]),
    node('star-a4y', 4, 'Starfire Reservoir', 'Gain 10 max mana and 0.06 crit multiplier.', ['star-a3y'], [
      bonus({ manaMax: 10, critSize: 6 }),
    ]),
    node('star-b4x', 4, 'Celestial Aim', 'Gain 3 Control and 4 Accuracy.', ['star-b3x'], [
      bonus({ ctl: 3, aim: 4 }),
    ]),
    node('star-b4y', 4, 'Orbit Acceleration', 'Gain 4 ability haste and 3 speed.', ['star-b3y'], [
      bonus({ haste: 4, speed: 3 }),
    ]),
    node('star-c4x', 4, 'Luminous Barrier', 'Gain 12 max HP and 5 tenacity.', ['star-c3x'], [
      bonus({ hpMax: 12, tenacity: 5 }),
    ]),
    node('star-c4y', 4, 'Unshaken Orbit', 'Gain 5 tenacity and 4 potency.', ['star-c3y'], [
      bonus({ tenacity: 5, potency: 4 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('star-a5-l', 5, 'Binary Core', 'Upgrade Starforge to a 3-tile blast that leaves a 3-tile Star field with higher impact and detonation damage.', ['star-a4x', 'star-a4y'], [
      replaceActive(ID_STARFORGE, UP_STARFORGE_BINARY),
    ], { forkGroup: 'star-a5' }),
    node('star-a5-r', 5, 'Pulsar Core', 'Upgrade Starforge so its Star field burns harder each round and deals 30% stagger on expiration.', ['star-a4x', 'star-a4y'], [
      replaceActive(ID_STARFORGE, UP_STARFORGE_PULSAR),
    ], { forkGroup: 'star-a5' }),

    node('star-b5-l', 5, 'Orbital Pull', 'Replace Gravity Bind on Gravity Snare with a 2-tile pull toward you, 35% stagger, and stronger damage.', ['star-b4x', 'star-b4y'], [
      replaceActive(ID_SNARE, UP_SNARE_PULL),
    ], { forkGroup: 'star-b5' }),
    node('star-b5-r', 5, 'Stellar Drift', 'Upgrade Gravity Snare to move your nearest Star field up to 4 tiles toward the target.', ['star-b4x', 'star-b4y'], [
      replaceActive(ID_SNARE, UP_SNARE_DRIFT),
    ], { forkGroup: 'star-b5' }),

    node('star-c5-l', 5, 'Radiant Bastion', 'Upgrade Astral Aegis to shield you for 24% of max HP.', ['star-c4x', 'star-c4y'], [
      replaceActive(ID_AEGIS, UP_AEGIS_BASTION),
    ], { forkGroup: 'star-c5' }),
    node('star-c5-r', 5, 'Solar Conduit', 'Upgrade Astral Aegis to restore 10 mana and add 15% speed to Starward.', ['star-c4x', 'star-c4y'], [
      replaceActive(ID_AEGIS, UP_AEGIS_CONDUIT),
    ], { forkGroup: 'star-c5' }),

    // Depth 6: Post-fork convergence (6)
    node('star-a6x', 6, 'White Dwarf', 'Gain 4 Power and 9 flat magic penetration.', ['star-a5-l', 'star-a5-r'], [
      bonus({ pow: 4, resistPenFlat: 9 }),
    ], { parentMode: 'any' }),
    node('star-a6y', 6, 'Stellar Well', 'Gain 3 Power and 1 extra crit face.', ['star-a5-l', 'star-a5-r'], [
      bonus({ pow: 3, critFaces: 1 }),
    ], { parentMode: 'any' }),
    node('star-b6x', 6, 'Parallax Lock', 'Gain 3 Control and 4 Accuracy.', ['star-b5-l', 'star-b5-r'], [
      bonus({ ctl: 3, aim: 4 }),
    ], { parentMode: 'any' }),
    node('star-b6y', 6, 'Perigee', 'Gain 4 ability haste and 3 speed.', ['star-b5-l', 'star-b5-r'], [
      bonus({ haste: 4, speed: 3 }),
    ], { parentMode: 'any' }),
    node('star-c6x', 6, 'Solar Mantle', 'Gain 10 max HP and 4% heal and shield bonus.', ['star-c5-l', 'star-c5-r'], [
      bonus({ hpMax: 10, healPower: 4 }),
    ], { parentMode: 'any' }),
    node('star-c6y', 6, 'Void Composure', 'Gain 5 tenacity and 4 potency.', ['star-c5-l', 'star-c5-r'], [
      bonus({ tenacity: 5, potency: 4 }),
    ], { parentMode: 'any' }),

    // Depth 7: Second Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('star-a7-l', 7, 'Singularity', 'Upgrade Supernova so each spent Star field adds 68% of magic power to the blast.', ['star-a6x', 'star-a6y'], [
      replaceActive(ID_SUPERNOVA, UP_SUPERNOVA_SINGULARITY),
    ], { forkGroup: 'star-a7' }),
    node('star-a7-r', 7, 'Solar Cascade', 'Upgrade Supernova to a quick action with a 2-round cooldown and 60% magic power per spent Star field.', ['star-a6x', 'star-a6y'], [
      replaceActive(ID_SUPERNOVA, UP_SUPERNOVA_CASCADE),
    ], { forkGroup: 'star-a7' }),

    node('star-b7-l', 7, 'Event Horizon', 'Gain 8% magic penetration and deal up to 8% more damage to foes above half HP.', ['star-b6x', 'star-b6y'], [
      bonus({ resistPen: 8 }),
      scaler({ measure: 'target', dir: 'over', start: 0.5, scale: 0.08 }),
    ], { forkGroup: 'star-b7' }),
    node('star-b7-r', 7, 'Quasar Lock', 'Gain 10 potency and deal up to 16% more damage to foes with higher max HP than you.', ['star-b6x', 'star-b6y'], [
      bonus({ potency: 10 }),
      scaler({ measure: 'maxPair', dir: 'over', start: 0.5, scale: 0.16 }),
    ], { forkGroup: 'star-b7' }),

    node('star-c7-l', 7, 'Dawn Renewal', 'Gain 30 max HP, 10% heal and shield bonus, and 10 max mana.', ['star-c6x', 'star-c6y'], [
      bonus({ hpMax: 30, healPower: 10, manaMax: 10 }),
    ], { forkGroup: 'star-c7' }),
    node('star-c7-r', 7, 'Eclipse Ward', 'Gain 20 max HP, 12 Will, and 12 tenacity.', ['star-c6x', 'star-c6y'], [
      bonus({ hpMax: 20, will: 12, tenacity: 12 }),
    ], { forkGroup: 'star-c7' }),

    // Depth 8: Branch Capstones (3)
    node('star-a8', 8, 'Red Giant', 'Gain 4 Power, 0.08 crit multiplier, and 9 flat magic penetration.', ['star-a7-l', 'star-a7-r'], [
      bonus({ pow: 4, critSize: 8, resistPenFlat: 9 }),
    ], { parentMode: 'any' }),
    node('star-b8', 8, 'Cosmic Alignment', 'Gain 4 Control, 4 ability haste, and 3 speed.', ['star-b7-l', 'star-b7-r'], [
      bonus({ ctl: 4, haste: 4, speed: 3 }),
    ], { parentMode: 'any' }),
    node('star-c8', 8, 'Heliosphere', 'Gain 6 tenacity and 4 potency.', ['star-c7-l', 'star-c7-r'], [
      bonus({ tenacity: 6, potency: 4 }),
    ], { parentMode: 'any' }),

    // Depth 9: Monarch Capstone (1)
    node('star-cap', 9, 'Celestial Architect', 'Upgrade Stellar Loom to Celestial Architect and gain 5 Power and 4 Control.', ['star-a8', 'star-b8', 'star-c8'], [
      replaceWorn(KEY_LOOM, ARCHITECT_LOOM),
      bonus({ pow: 5, ctl: 4 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
