// class-common.ts: shared 12-node / 12-buyable Common skill-tree builder (`1, 2, 4, 4, 1`, 2 branches, 0 forks)
// and gift/formula helpers used by the six Common starter class modules. Pure static registry leaf module: imports
// only types from class-trees.ts so there is zero value-import cycle. No gold literals.
import { RULES } from '../rules.ts';
import type { Perk } from '../rules.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import type { Reach, StatusDef, StatusKey, Tiers } from '../combat/effect-ops.ts';
import type { Limit } from '../combat/triggers.ts';
import { tiles } from '../combat/space.ts';
import { tick } from '../combat/timeline.ts';
import type { Tick } from '../combat/timeline.ts';
import type { CommonClassName } from './jobs.ts';
import type { Scaler } from './scalers.ts';
import type { ClassNodeDef, ClassTree, ClassWorn, NodeGift, TreeDepth } from './class-trees.ts';

const R = RULES;

/** Parses a static formula against shipped rules, throwing immediately at load on any typo. */
export function commonFormula(text: string, owner: string): Formula {
  const p = parseFormula(text, R);
  if (!p.ok) throw new Error(`Invalid ${owner} formula "${text}"`);
  return p.formula;
}

/** Builds a 6-rank tiered formula tuple (E through S) for per-round DoTs or HoTs. */
export const commonTiered = (
  owner: string,
  e: string,
  d: string,
  c: string,
  b: string,
  a: string,
  s: string,
): Tiers<Formula> => [
  commonFormula(e, owner),
  commonFormula(d, owner),
  commonFormula(c, owner),
  commonFormula(b, owner),
  commonFormula(a, owner),
  commonFormula(s, owner),
];

/** Converts whole fight rounds into fight ticks under shipped rules. */
export const commonRounds = (n: number): Tick => tick(Math.round(n * R.fight.round));

export const EACH: Limit = { kind: 'each' };
export const ROUND: Limit = { kind: 'round' };
export const ONCE: Limit = { kind: 'fight', n: 1 };

export const commonArea = (radius: number, on: 'allies' | 'foes'): Reach => ({
  kind: 'area',
  radius: tiles(radius),
  on,
});

export const bonus = (p: Perk): NodeGift => ({ kind: 'bonus', bonus: p });
export const scaler = (s: Scaler): NodeGift => ({ kind: 'scaler', scaler: s });
export const replaceActive = (targetId: AbilityId, active: Ability): NodeGift => ({
  kind: 'replace-active',
  targetId,
  active,
});
export const replaceWorn = (targetKey: StatusKey, worn: ClassWorn): NodeGift => ({
  kind: 'replace-worn',
  targetKey,
  worn,
});
export const upgradeStatus = (targetKey: StatusKey, key: StatusKey, def: StatusDef): NodeGift => ({
  kind: 'upgrade-status',
  targetKey,
  key,
  def,
});

/** One node's authored name, plain-English description, and gifts for the shared Common builder. */
export type CommonNodeSpec = {
  readonly name: string;
  readonly desc: string;
  readonly gifts: readonly NodeGift[];
};

/** Full specification for a 5-depth, 2-branch, 12-node Common skill tree (`1, 2, 4, 4, 1`, 0 forks). */
export type CommonTreeSpec = {
  readonly className: CommonClassName;
  readonly prefix: string;
  readonly root: CommonNodeSpec;
  readonly a2: CommonNodeSpec;
  readonly b2: CommonNodeSpec;
  readonly a3x: CommonNodeSpec;
  readonly a3y: CommonNodeSpec;
  readonly b3x: CommonNodeSpec;
  readonly b3y: CommonNodeSpec;
  readonly a4x: CommonNodeSpec;
  readonly a4y: CommonNodeSpec;
  readonly b4x: CommonNodeSpec;
  readonly b4y: CommonNodeSpec;
  readonly cap: CommonNodeSpec;
};

/**
 * Builds a validated `1, 2, 4, 4, 1` Common skill tree (12 total / 12 buyable nodes, 2 branches, 0 forks).
 * Reaching any Depth 4 node unlocks the Depth 5 Capstone (`parentMode: 'any'`).
 */
export function buildCommonTree(spec: CommonTreeSpec): ClassTree {
  const nid = (suffix: string): ClassNodeId => {
    const raw = `${spec.prefix}-${suffix}`;
    const id = parseClassNodeId(raw);
    if (!id) throw new Error(`Invalid ${spec.className} node id: ${raw}`);
    return id;
  };
  const mk = (
    suffix: string,
    depth: TreeDepth,
    nodeSpec: CommonNodeSpec,
    parents: readonly string[],
    extra?: Partial<Pick<ClassNodeDef, 'parentMode' | 'capstone'>>,
  ): ClassNodeDef => ({
    id: nid(suffix),
    depth,
    name: nodeSpec.name,
    desc: nodeSpec.desc,
    parents: parents.map(nid),
    gifts: nodeSpec.gifts,
    ...extra,
  });

  return {
    className: spec.className,
    rarity: 'common',
    nodes: [
      // Depth 1: Root (1)
      mk('root', 1, spec.root, []),

      // Depth 2: Two branches (2)
      mk('a2', 2, spec.a2, ['root']),
      mk('b2', 2, spec.b2, ['root']),

      // Depth 3: Branch splits (4)
      mk('a3x', 3, spec.a3x, ['a2']),
      mk('a3y', 3, spec.a3y, ['a2']),
      mk('b3x', 3, spec.b3x, ['b2']),
      mk('b3y', 3, spec.b3y, ['b2']),

      // Depth 4: Branch peaks (4)
      mk('a4x', 4, spec.a4x, ['a3x']),
      mk('a4y', 4, spec.a4y, ['a3y']),
      mk('b4x', 4, spec.b4x, ['b3x']),
      mk('b4y', 4, spec.b4y, ['b3y']),

      // Depth 5: Common Capstone (1)
      mk('cap', 5, spec.cap, ['a4x', 'a4y', 'b4x', 'b4y'], { parentMode: 'any', capstone: true }),
    ],
  };
}
