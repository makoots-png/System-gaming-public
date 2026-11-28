// class-rifthunter.ts: Mythic Rifthunter (ins+ctl) signature kit and full 38-node / 32-buyable skill tree.
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
import type { Op, StackDef, StatusDef, StatusKey } from '../combat/effect-ops.ts';
import type { Limit } from '../combat/triggers.ts';
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
  if (!id) throw new Error(`Invalid Rifthunter node id: ${s}`);
  return id;
};
const f = (text: string): Formula => {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid Rifthunter formula "${text}"`);
  return p.formula;
};
const rounds = (n: number): Tick => tick(Math.round(n * R.fight.round));
const EACH: Limit = { kind: 'each' };
const ROUND: Limit = { kind: 'round' };
const SHOT = KIND_TAG.shot;

const KEY_CADENCE_WORN = statusKey('rh-cadence-worn');
const KEY_CADENCE_MONARCH = statusKey('rh-cadence-monarch');
const KEY_CADENCE = statusKey('rh-cadence');
const KEY_FOURTH_CRIT = statusKey('rh-fourth-crit');
const KEY_FOURTH_ECHO = statusKey('rh-fourth-echo');
const KEY_STRIDE = statusKey('rh-rift-stride');
const KEY_STRIDE_UP = statusKey('rh-rift-stride-ii');
const KEY_STEP_EDGE = statusKey('rh-step-edge');
const KEY_STEP_EDGE_UP = statusKey('rh-step-edge-ii');
const KEY_TETHERED = statusKey('rh-tethered');
const KEY_TETHERED_UP = statusKey('rh-tethered-ii');
const KEY_VERDICT_MARK = statusKey('rh-verdict-mark');

const ID_BOLT = abilityId('rh-rift-bolt');
const ID_STEP = abilityId('rh-rift-step');
const ID_TETHER = abilityId('rh-rift-tether');
const ID_VERDICT = abilityId('rh-fourth-verdict');

// ── statuses ──

// Guaranteed crit on the 4th shot: lowers the target's reaction d20 by 20 (clamping to face 1, always <= critFaces).
// Automatically spent by resolve.ts `spendEdges` as the 4th shot resolves.
const FOURTH_CRIT: StatusDef = {
  label: 'Fourth Chamber',
  desc: 'Your next shot forces a natural 1 defense roll for a guaranteed critical hit.',
  ops: [{ op: 'boost', side: 'attack', die: { kind: 'face', n: R.fight.kit.boostSides } }],
};

// Companion marker that survives `spendEdges` into `triggers.fire` so the 4th shot deals Instinct-capped % max HP true damage and resets cadence cleanly to 0.
const FOURTH_ECHO: StatusDef = {
  label: 'Fourth Echo',
  desc: 'Your next shot deals bonus Instinct-capped true damage based on target max HP and resets your cadence.',
  ops: [],
};

const CADENCE_STACK: StackDef = {
  label: 'Cadence',
  desc: 'At 3 stacks, spend all stacks to arm Fourth Chamber and Fourth Echo for your 4th shot.',
  ops: [],
  stack: {
    cap: 3,
    leave: { kind: 'never' },
    keep: 'fight',
    threshold: {
      at: { kind: 'count', n: 3 },
      to: { kind: 'bearer' },
      then: 'spend',
      ops: [
        { op: 'applyStatus', key: KEY_FOURTH_CRIT, def: FOURTH_CRIT, duration: null },
        { op: 'applyStatus', key: KEY_FOURTH_ECHO, def: FOURTH_ECHO, duration: null },
      ],
    },
  },
};

const VERDICT_MARK: StatusDef = {
  label: 'Rift Marked',
  desc: 'Takes 6% more damage and attacks against this target crit on 1 more die face for 2 rounds.',
  ops: [
    { op: 'sheet', key: 'exposed', amount: 1 },
    { op: 'share', on: 'taken', pct: 6 },
  ],
};

function makeCadenceWorn(o: {
  readonly key: StatusKey;
  readonly label: string;
  readonly desc: string;
  readonly fourthTrueFormula: string;
  readonly strideKey: StatusKey;
  readonly strideSpeedPct: number;
  readonly critRefundPct?: number;
  readonly extraOps?: readonly Op[];
}): ClassWorn {
  const stride: StatusDef = {
    label: 'Rift Stride',
    desc: `Speed increased by ${o.strideSpeedPct}% for 1 round.`,
    ops: [{ op: 'speed', pct: o.strideSpeedPct }],
  };
  return {
    key: o.key,
    def: {
      label: o.label,
      desc: o.desc,
      ops: [...(o.extraOps ?? [])],
      // Exact 1-2-3-FOUR cadence order (triggers read pre-batch snapshot `b` for `need`, max 4 triggers per StatusDef):
      // Shot 1..2: T2 builds Cadence (1 -> 2). Shot 3: T2 hits 3 -> arms Fourth Chamber + Fourth Echo.
      // Shot 4: Fourth Chamber guarantees crit; T1 deals Instinct-capped % max HP true damage; T2 adds 1 Cadence; T3 cures Echo + Cadence -> clean 0.
      triggers: [
        { on: 'hitDealt', tag: SHOT, need: { kind: 'holds', key: KEY_FOURTH_ECHO }, to: 'other', limit: EACH, ops: [{ op: 'damage', type: 'true', when: 'use', amount: f(o.fourthTrueFormula) }] },
        { on: 'hitDealt', tag: SHOT, to: 'self', limit: EACH, ops: [{ op: 'applyStatus', key: KEY_CADENCE, def: CADENCE_STACK, duration: null }] },
        { on: 'hitDealt', tag: SHOT, need: { kind: 'holds', key: KEY_FOURTH_ECHO }, to: 'self', limit: EACH, ops: [{ op: 'cureStatus', key: KEY_FOURTH_ECHO }, { op: 'cureStatus', key: KEY_CADENCE }] },
        {
          on: 'critDealt',
          tag: null,
          to: 'self',
          limit: ROUND,
          ops: [
            { op: 'applyStatus', key: o.strideKey, def: stride, duration: rounds(1) },
            ...(o.critRefundPct ? [{ op: 'refund' as const, pct: o.critRefundPct }] : []),
          ],
        },
      ],
    },
  };
}

const BASE_CADENCE: ClassWorn = makeCadenceWorn({
  key: KEY_CADENCE_WORN,
  label: 'Four-Beat Cadence',
  desc: 'Every 4th shot is a guaranteed crit dealing 5% of target max HP as true damage, capped by your Instinct. Crits grant Rift Stride speed once per round.',
  fourthTrueFormula: 'min(0.05 * target.hpmax, 14 * (ins / 10)^0.8)',
  strideKey: KEY_STRIDE,
  strideSpeedPct: 10,
});

const MONARCH_CADENCE: ClassWorn = makeCadenceWorn({
  key: KEY_CADENCE_MONARCH,
  label: 'Four-Beat Cadence: Rift Monarch',
  desc: 'Every 4th shot deals 5% of target max HP as true damage, capped by your Instinct, and grants faster Rift Stride on crits once per round.',
  fourthTrueFormula: 'min(0.05 * target.hpmax, 14 * (ins / 10)^0.8)',
  strideKey: KEY_STRIDE_UP,
  strideSpeedPct: 12,
});

// ── active ability builders ──
// Rifthunter scales off Instinct (`(ins / 10)^0.8`) and Control (`aim = eff(ctl)`), spending mana on rift skills.
// Shots use `travel` with `speed: 'instant'` so reaction/crit rolls fire and face 1 from Fourth Chamber is 100% undodgeable.

const INSTANT_SHOT = { kind: 'travel', windup: tick(R.fight.abilityKinds.shot.windup), speed: 'instant' } as const;

function makeRiftBolt(o: { readonly name: string; readonly formula: string }): Ability {
  const base = abilityOf('shot', {
    id: ID_BOLT,
    name: o.name,
    desc: 'Fire an instant shot up to 8 tiles for physical damage scaling with Instinct and Accuracy.',
    range: tiles(8),
    shape: { kind: 'touch', reach: tiles(8) },
    delivery: INSTANT_SHOT,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 0, fatigue: 5, time: cost(R.fight.cost.standard), cooldown: rounds(0) },
  };
}

function makeRiftStep(o: {
  readonly name: string;
  readonly edgeKey: StatusKey;
  readonly speedPct: number;
  readonly dealtPct: number;
  readonly cooldownRounds: number;
}): Ability {
  const phaseEdge: StatusDef = {
    label: 'Phase Edge',
    desc: `Speed +${o.speedPct}%, advantage on your next attack, and ${o.dealtPct}% more damage dealt for 1 round.`,
    ops: [
      { op: 'speed', pct: o.speedPct },
      { op: 'edge', side: 'attack', keep: 'better', tag: null, spend: true },
      { op: 'share', on: 'dealt', pct: o.dealtPct },
    ],
  };
  const base = abilityOf('support', {
    id: ID_STEP,
    name: o.name,
    desc: `Blink up to 5 tiles and gain Phase Edge (${o.speedPct}% speed, ${o.dealtPct}% damage dealt, and attack advantage) for 1 round.`,
    aim: 'place',
    shape: { kind: 'self' },
    range: tiles(5),
    delivery: { kind: 'sure' },
    foesOnly: false,
    effect: null,
    // Genuine rift teleport: blinks up to 5 visible tiles (within blinkMax = 8) and empowers the next shot.
    // No untargetable ward and no max-HP shield: Rifthunter survives through distance and repositioning.
    ops: [
      { op: 'applyStatus', key: o.edgeKey, def: phaseEdge, duration: rounds(1) },
    ],
  }, R);
  return {
    ...base,
    move: { kind: 'blink' },
    cost: { ...base.cost, mana: 3, fatigue: 4, time: cost(R.fight.cost.quick), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeRiftTether(o: {
  readonly name: string;
  readonly formula: string;
  readonly tetherKey: StatusKey;
  readonly exposed: number;
  readonly takenPct: number;
  readonly cooldownRounds: number;
}): Ability {
  const tethered: StatusDef = {
    label: 'Rift Tethered',
    desc: `Rooted for 1 round. Attacks against this target crit on ${o.exposed} more die face${o.exposed === 1 ? '' : 's'} and deal ${o.takenPct}% more damage.`,
    ops: [
      { op: 'root' },
      { op: 'sheet', key: 'exposed', amount: o.exposed },
      { op: 'share', on: 'taken', pct: o.takenPct },
    ],
  };
  const base = abilityOf('shot', {
    id: ID_TETHER,
    name: o.name,
    desc: `Fire a shot up to 8 tiles that roots the target for 1 round, exposes ${o.exposed} crit ${o.exposed === 1 ? 'face' : 'faces'}, and increases damage taken by ${o.takenPct}%.`,
    range: tiles(8),
    shape: { kind: 'touch', reach: tiles(8) },
    delivery: INSTANT_SHOT,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [{ op: 'applyStatus', key: o.tetherKey, def: tethered, duration: rounds(1) }],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 4, fatigue: 5, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

function makeFourthVerdict(o: {
  readonly name: string;
  readonly formula: string;
  readonly staggerShare: number;
  readonly cooldownRounds: number;
}): Ability {
  const base = abilityOf('shot', {
    id: ID_VERDICT,
    name: o.name,
    desc: `Fire a heavy shot up to 10 tiles that fills ${Math.round(o.staggerShare * 100)}% stagger and applies Rift Rupture for 2 rounds.`,
    range: tiles(10),
    shape: { kind: 'touch', reach: tiles(10) },
    delivery: INSTANT_SHOT,
    effect: { type: 'physical', by: 'hand', formula: f(o.formula) },
    ops: [
      { op: 'stagger', share: o.staggerShare },
      { op: 'applyStatus', key: KEY_VERDICT_MARK, def: VERDICT_MARK, duration: rounds(2) },
    ],
  }, R);
  return {
    ...base,
    cost: { ...base.cost, mana: 5, fatigue: 7, time: cost(R.fight.cost.standard), cooldown: rounds(o.cooldownRounds) },
  };
}

const BASE_BOLT = makeRiftBolt({
  name: 'Rift Bolt',
  formula: '1d8 + 1.9 * (ins / 10)^0.8 + 0.08 * aim',
});

const UP_BOLT = makeRiftBolt({
  name: 'Rift Bolt: Piercing Round',
  formula: '1d8 + 2.25 * (ins / 10)^0.8 + 0.09 * aim',
});

const BASE_STEP = makeRiftStep({
  name: 'Rift Step',
  edgeKey: KEY_STEP_EDGE,
  speedPct: 14,
  dealtPct: 10,
  cooldownRounds: 6,
});

const UP_STEP = makeRiftStep({
  name: 'Rift Step: Phase Slip',
  edgeKey: KEY_STEP_EDGE_UP,
  speedPct: 18,
  dealtPct: 14,
  cooldownRounds: 5,
});

const BASE_TETHER = makeRiftTether({
  name: 'Rift Tether',
  formula: '1d8 + 2.1 * (ins / 10)^0.8',
  tetherKey: KEY_TETHERED,
  exposed: 1,
  takenPct: 6,
  cooldownRounds: 5,
});

const UP_TETHER = makeRiftTether({
  name: 'Rift Tether: Void Anchor',
  formula: '1d8 + 2.5 * (ins / 10)^0.8 + 0.09 * aim',
  tetherKey: KEY_TETHERED_UP,
  exposed: 2,
  takenPct: 8,
  cooldownRounds: 4,
});

const BASE_VERDICT = makeFourthVerdict({
  name: 'Fourth Verdict',
  formula: '2d6 + 3.0 * (ins / 10)^0.8 + 0.14 * aim',
  staggerShare: 0.16,
  cooldownRounds: 5,
});

const UP_VERDICT = makeFourthVerdict({
  name: 'Fourth Verdict: Rift Piercer',
  formula: '2d8 + 3.5 * (ins / 10)^0.8 + 0.18 * aim',
  staggerShare: 0.2,
  cooldownRounds: 4,
});

/** Base Rifthunter signature (before skill-tree nodes are folded on top). No redundant critFaces (ins already approaches cap 6). */
export const RIFTHUNTER_SIGNATURE: ClassSignature = {
  className: 'Rifthunter',
  bonus: { critSize: 12, armorPen: 6, aim: 4 },
  worn: BASE_CADENCE,
  actives: [BASE_BOLT, BASE_STEP, BASE_TETHER, BASE_VERDICT],
};

// ── 38-node / 32-buyable Mythic skill tree ──
// Zero drain, zero shieldDrain, zero wasted critFaces: scales crit multiplier, aim, potency, armor pen, speed, and control.

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

/** Full 9-depth, 3-branch, 32-buyable (38-node) Mythic Rifthunter skill tree. */
export const RIFTHUNTER_TREE: ClassTree = {
  className: 'Rifthunter',
  rarity: 'mythic',
  nodes: [
    // Depth 1: Root (1)
    node('rh-root', 1, 'Rift Sight', 'Gain 2 Instinct, 2 Control, and 2 Accuracy.', [], [
      bonus({ ins: 2, ctl: 2, aim: 2 }),
    ]),

    // Depth 2: Three branches (3)
    node('rh-a2', 2, 'Rift Cadence', 'Gain 3 Instinct and 3 Accuracy.', ['rh-root'], [
      bonus({ ins: 3, aim: 3 }),
    ]),
    node('rh-b2', 2, 'Phase Stride', 'Gain 2 speed and 2 ability haste.', ['rh-root'], [
      bonus({ speed: 2, haste: 2 }),
    ]),
    node('rh-c2', 2, 'Kill Box', 'Gain 3 Control and 3% armor penetration.', ['rh-root'], [
      bonus({ ctl: 3, armorPen: 3 }),
    ]),

    // Depth 3: Branch splits (6)
    node('rh-a3x', 3, 'True Sight', 'Gain 3 Instinct and 0.05 crit multiplier.', ['rh-a2'], [
      bonus({ ins: 3, critSize: 5 }),
    ]),
    node('rh-a3y', 3, 'Keen Sight', 'Gain 2 Instinct and 10 max HP.', ['rh-a2'], [
      bonus({ ins: 2, hpMax: 10 }),
    ]),
    node('rh-b3x', 3, 'Phase Step', 'Gain 3 speed and 2 ability haste.', ['rh-b2'], [
      bonus({ speed: 3, haste: 2 }),
    ]),
    node('rh-b3y', 3, 'Rift Shell', 'Gain 10 max HP, 5 Discipline, and 4 Will.', ['rh-b2'], [
      bonus({ hpMax: 10, dis: 5, will: 4 }),
    ]),
    node('rh-c3x', 3, 'Rift Bore', 'Gain 3% armor penetration and 3 flat armor penetration.', ['rh-c2'], [
      bonus({ armorPen: 3, armorPenFlat: 3 }),
    ]),
    node('rh-c3y', 3, 'Steady Barrel', 'Gain 3 Control and 4 Accuracy.', ['rh-c2'], [
      bonus({ ctl: 3, aim: 4 }),
    ]),

    // Depth 4: Deepening (6)
    node('rh-a4x', 4, 'Heartseeker', 'Gain 3 Instinct and 0.06 crit multiplier.', ['rh-a3x'], [
      bonus({ ins: 3, critSize: 6 }),
    ]),
    node('rh-a4y', 4, 'Measured Breath', 'Gain 3 Instinct and 4 Reaction.', ['rh-a3y'], [
      bonus({ ins: 3, react: 4 }),
    ]),
    node('rh-b4x', 4, 'Ghost Stride', 'Gain 3 speed and 3 ability haste.', ['rh-b3x'], [
      bonus({ speed: 3, haste: 3 }),
    ]),
    node('rh-b4y', 4, 'Clear Nerves', 'Gain 12 max HP, 5 Discipline, 5 tenacity, and 5 Will.', ['rh-b3y'], [
      bonus({ hpMax: 12, dis: 5, tenacity: 5, will: 5 }),
    ]),
    node('rh-c4x', 4, 'Piercing Chamber', 'Gain 3% armor penetration and 4 flat armor penetration.', ['rh-c3x'], [
      bonus({ armorPen: 3, armorPenFlat: 4 }),
    ]),
    node('rh-c4y', 4, 'Zero Error', 'Gain 3 Control, 5 Accuracy, and 4 potency.', ['rh-c3y'], [
      bonus({ ctl: 3, aim: 5, potency: 4 }),
    ]),

    // Depth 5: Exclusive Fork Pairs (6 nodes, 3 buyable)
    node('rh-a5-l', 5, 'Piercing Round', 'Upgrade Rift Bolt with higher Instinct and Accuracy damage scaling.', ['rh-a4x', 'rh-a4y'], [
      replaceActive(ID_BOLT, UP_BOLT),
    ], { forkGroup: 'rh-a5' }),
    node('rh-a5-r', 5, 'Rift Stalker', 'Gain 5 Instinct, 6 Reaction, and 25 max HP.', ['rh-a4x', 'rh-a4y'], [
      bonus({ ins: 5, react: 6, hpMax: 25 }),
    ], { forkGroup: 'rh-a5' }),

    node('rh-b5-l', 5, 'Phase Slip', 'Upgrade Rift Step to a 5-round cooldown with 18% speed and 14% damage dealt on Phase Edge.', ['rh-b4x', 'rh-b4y'], [
      replaceActive(ID_STEP, UP_STEP),
    ], { forkGroup: 'rh-b5' }),
    node('rh-b5-r', 5, 'Void Anchor', 'Upgrade Rift Tether to a 4-round cooldown with 2 exposed faces, 8% bonus damage taken, and stronger scaling.', ['rh-b4x', 'rh-b4y'], [
      replaceActive(ID_TETHER, UP_TETHER),
    ], { forkGroup: 'rh-b5' }),

    node('rh-c5-l', 5, 'Rift Piercer', 'Upgrade Fourth Verdict to a 4-round cooldown with 20% stagger and stronger damage.', ['rh-c4x', 'rh-c4y'], [
      replaceActive(ID_VERDICT, UP_VERDICT),
    ], { forkGroup: 'rh-c5' }),
    node('rh-c5-r', 5, 'Long Precision', 'Gain 6 Control, 6 Accuracy, and 0.09 crit multiplier.', ['rh-c4x', 'rh-c4y'], [
      bonus({ ctl: 6, aim: 6, critSize: 9 }),
    ], { forkGroup: 'rh-c5' }),

    // Depth 6: Post-fork convergence (6)
    node('rh-a6x', 6, 'Cold Focus', 'Gain 3 Instinct and 4 Accuracy.', ['rh-a5-l', 'rh-a5-r'], [
      bonus({ ins: 3, aim: 4 }),
    ], { parentMode: 'any' }),
    node('rh-a6y', 6, 'Elusive Frame', 'Gain 10 max HP and 4 Reaction.', ['rh-a5-l', 'rh-a5-r'], [
      bonus({ hpMax: 10, react: 4 }),
    ], { parentMode: 'any' }),
    node('rh-b6x', 6, 'Slipstream', 'Gain 3 speed and 3 ability haste.', ['rh-b5-l', 'rh-b5-r'], [
      bonus({ speed: 3, haste: 3 }),
    ], { parentMode: 'any' }),
    node('rh-b6y', 6, 'Anchored Mind', 'Gain 12 max HP, 6 Discipline, 6 tenacity, and 5 Will.', ['rh-b5-l', 'rh-b5-r'], [
      bonus({ hpMax: 12, dis: 6, tenacity: 6, will: 5 }),
    ], { parentMode: 'any' }),
    node('rh-c6x', 6, 'Armor Rupture', 'Gain 3% armor penetration and 4 flat armor penetration.', ['rh-c5-l', 'rh-c5-r'], [
      bonus({ armorPen: 3, armorPenFlat: 4 }),
    ], { parentMode: 'any' }),
    node('rh-c6y', 6, 'Pinpoint Shot', 'Gain 3 Control, 5 Accuracy, and 0.06 crit multiplier.', ['rh-c5-l', 'rh-c5-r'], [
      bonus({ ctl: 3, aim: 5, critSize: 6 }),
    ], { parentMode: 'any' }),

    // Depth 7: Second Exclusive Fork Pairs (6 nodes, 3 buyable; at most 2 scalers across any path: opener + giantSlayer)
    node('rh-a7-l', 7, 'Opening Volley', 'Gain 3 Instinct and deal up to 12% more damage to foes above half HP.', ['rh-a6x', 'rh-a6y'], [
      bonus({ ins: 3 }),
      scaler({ measure: 'target', dir: 'over', start: 0.5, scale: 0.12 }),
    ], { forkGroup: 'rh-a7' }),
    node('rh-a7-r', 7, 'Phantom Coat', 'Gain 5 Vitality, 30 max HP, and 5 Reaction.', ['rh-a6x', 'rh-a6y'], [
      bonus({ vit: 5, hpMax: 30, react: 5 }),
    ], { forkGroup: 'rh-a7' }),

    node('rh-b7-l', 7, 'Rift Velocity', 'Gain 4 speed, 3 ability haste, and 4 Reaction.', ['rh-b6x', 'rh-b6y'], [
      bonus({ speed: 4, haste: 3, react: 4 }),
    ], { forkGroup: 'rh-b7' }),
    node('rh-b7-r', 7, 'Steadfast Aim', 'Gain 8 tenacity, 6 Will, and 25 max HP.', ['rh-b6x', 'rh-b6y'], [
      bonus({ tenacity: 8, will: 6, hpMax: 25 }),
    ], { forkGroup: 'rh-b7' }),

    node('rh-c7-l', 7, 'Behemoth Hunter', 'Gain 4 Control and deal up to 14% more damage to foes with higher max HP than you.', ['rh-c6x', 'rh-c6y'], [
      bonus({ ctl: 4 }),
      scaler({ measure: 'maxPair', dir: 'over', start: 0.5, scale: 0.14 }),
    ], { forkGroup: 'rh-c7' }),
    node('rh-c7-r', 7, 'Shredding Bolt', 'Gain 5% armor penetration, 6 flat armor penetration, and 0.09 crit multiplier.', ['rh-c6x', 'rh-c6y'], [
      bonus({ armorPen: 5, armorPenFlat: 6, critSize: 9 }),
    ], { forkGroup: 'rh-c7' }),

    // Depth 8: Branch Capstones (3)
    node('rh-a8', 8, 'Rift Execution', 'Gain 4 Instinct, 4 Accuracy, and 10 max HP.', ['rh-a7-l', 'rh-a7-r'], [
      bonus({ ins: 4, aim: 4, hpMax: 10 }),
    ], { parentMode: 'any' }),
    node('rh-b8', 8, 'Untouched Stride', 'Gain 4 speed, 3 ability haste, 15 max HP, 6 Discipline, and 5 Will.', ['rh-b7-l', 'rh-b7-r'], [
      bonus({ speed: 4, haste: 3, hpMax: 15, dis: 6, will: 5 }),
    ], { parentMode: 'any' }),
    node('rh-c8', 8, 'Deadly Measure', 'Gain 4 Control, 5 flat armor penetration, and 0.06 crit multiplier.', ['rh-c7-l', 'rh-c7-r'], [
      bonus({ ctl: 4, armorPenFlat: 5, critSize: 6 }),
    ], { parentMode: 'any' }),

    // Depth 9: Monarch Capstone (1)
    node('rh-cap', 9, 'Rift Monarch', 'Upgrade Four-Beat Cadence to Rift Monarch and gain 4 Instinct, 4 Control, and 0.06 crit multiplier.', ['rh-a8', 'rh-b8', 'rh-c8'], [
      replaceWorn(KEY_CADENCE_WORN, MONARCH_CADENCE),
      bonus({ ins: 4, ctl: 4, critSize: 6 }),
    ], { parentMode: 'any', capstone: true }),
  ],
};
