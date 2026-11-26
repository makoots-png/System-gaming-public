// class-trees.ts: per-class skill tree schema, DAG rules, fork flips, and node repair. Pure static registry module.
// Trees live here in the registry (never in GM rules, and never carrying gold literals; prices live in classes.ts
// from RULES). Locker parsing and holder parsing live in src/core/hunter/class-locker.ts so this module stays pure tables.
import { parseClassNodeId } from '../ids.ts';
import type { ClassNodeId } from '../ids.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import type { Perk } from '../rules.ts';
import type { Scaler } from './scalers.ts';
import type { StatusDef, StatusKey } from '../combat/effect-ops.ts';
import type { Ability, AbilityId } from '../combat/ability-types.ts';
import { isClassName } from './jobs.ts';
import type { ClassName, ClassRarity } from './jobs.ts';
import { HEMOMANCER_TREE } from './class-hemomancer.ts';
import { BLADEFIEND_TREE } from './class-bladefiend.ts';
import { RIFTHUNTER_TREE } from './class-rifthunter.ts';
import { IRONCLAD_TREE } from './class-ironclad.ts';
import { SERAPH_TREE } from './class-seraph.ts';
import { STORMCALLER_TREE } from './class-stormcaller.ts';

/** A class worn passive stored with its registry status key for fight-doc references. */
export type ClassWorn = { readonly key: StatusKey; readonly def: StatusDef };

/** Valid depth indices of a class skill tree (Depth 1 Root through Depth 9 Mythic Capstone). */
export type TreeDepth = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Maximum classes a hunter's locker can store (36 built-in classes plus 12 custom GM classes). */
export const CLASS_LOCKER_CAP = 48;
/** Maximum nodes allowed in any single class skill tree. */
export const CLASS_TREE_NODE_CAP = 64;
/** Maximum class active abilities a class signature and its tree may fold to. */
export const CLASS_ACTIVES_MAX = 4;
/** Maximum class worn statuses a class signature and its tree may fold to. */
export const CLASS_WORN_MAX = 1;

/** Structural targets for each class rarity's skill tree (settled.md). */
export type TreeShape = {
  readonly depths: TreeDepth;
  readonly branches: number;
  readonly buyable: number;
  readonly total: number;
  readonly forkDepths: readonly TreeDepth[];
};

export const TREE_SHAPE: Readonly<Record<ClassRarity, TreeShape>> = {
  common: { depths: 5, branches: 2, buyable: 12, total: 12, forkDepths: [] },
  rare:   { depths: 7, branches: 2, buyable: 16, total: 18, forkDepths: [5] },
  epic:   { depths: 7, branches: 3, buyable: 23, total: 26, forkDepths: [5] },
  mythic: { depths: 9, branches: 3, buyable: 32, total: 38, forkDepths: [5, 7] },
};

/**
 * What one skill-tree node grants when bought. Nodes may add a sheet bonus or conditional scaler, or replace an
 * existing worn status or active ability by id. Nodes never add a fifth active.
 */
export type NodeGift =
  | { readonly kind: 'bonus'; readonly bonus: Perk }
  | { readonly kind: 'scaler'; readonly scaler: Scaler }
  | { readonly kind: 'replace-worn'; readonly targetKey: StatusKey; readonly worn: ClassWorn }
  | { readonly kind: 'replace-active'; readonly targetId: AbilityId; readonly active: Ability };

/** One node in a class skill tree. */
export type ClassNodeDef = {
  readonly id: ClassNodeId;
  readonly depth: TreeDepth;
  readonly name: string;
  readonly desc: string;
  /** Parent node ids (empty only for the Depth 1 Root). */
  readonly parents: readonly ClassNodeId[];
  /**
   * 'all' (default): every parent in `parents` must be owned.
   * 'any': at least one parent in `parents` must be owned (post-fork convergence at D6/D8 and Capstone).
   */
  readonly parentMode?: 'all' | 'any';
  /** Shared label for an exclusive 1-of-2 fork pair at the same depth. */
  readonly forkGroup?: string;
  /** Marks the final-depth Capstone node. */
  readonly capstone?: true;
  readonly gifts: readonly NodeGift[];
};

/** A built-in class's full skill tree definition. */
export type ClassTree = {
  readonly className: ClassName;
  readonly rarity: ClassRarity;
  readonly nodes: readonly ClassNodeDef[];
};

/** Lookup table of shipped skill trees. */
export type ClassTreeMap = Readonly<Partial<Record<ClassName, ClassTree>>>;
export const CLASS_TREES: ClassTreeMap = {
  Hemomancer: HEMOMANCER_TREE,
  Bladefiend: BLADEFIEND_TREE,
  Rifthunter: RIFTHUNTER_TREE,
  Seraph: SERAPH_TREE,
  Ironclad: IRONCLAD_TREE,
  Stormcaller: STORMCALLER_TREE,
};

/** Returns the skill tree for `name`, or null for custom GM jobs and classes without a tree yet. */
export function classTreeOf(name: string | null | undefined, trees: ClassTreeMap = CLASS_TREES): ClassTree | null {
  if (!isClassName(name)) return null;
  return trees[name] ?? null;
}

/** Whether `owned` satisfies `node`'s parent prerequisites. */
export function parentsSatisfied(node: ClassNodeDef, owned: ReadonlySet<ClassNodeId>): boolean {
  if (node.parents.length === 0) return true;
  return node.parentMode === 'any'
    ? node.parents.some(p => owned.has(p))
    : node.parents.every(p => owned.has(p));
}

/** Returns the exclusive fork twin of `nodeId` in `tree`, or null if `nodeId` is not part of a fork pair. */
export function forkTwinOf(tree: ClassTree, nodeId: ClassNodeId): ClassNodeDef | null {
  const node = tree.nodes.find(n => n.id === nodeId);
  if (!node?.forkGroup) return null;
  return tree.nodes.find(n => n.forkGroup === node.forkGroup && n.id !== nodeId) ?? null;
}

/** Whether the tree's Capstone node is unlocked (any branch has reached the penultimate depth). */
export function capstoneUnlocked(tree: ClassTree, owned: readonly ClassNodeId[]): boolean {
  const cap = tree.nodes.find(n => n.capstone);
  if (!cap) return false;
  return parentsSatisfied(cap, new Set(owned));
}

/** Validates a tree definition against `TREE_SHAPE[tree.rarity]` and structural invariants. Empty array means valid. */
export function validateTree(tree: ClassTree): string[] {
  const errs: string[] = [];
  const shape = TREE_SHAPE[tree.rarity];
  if (tree.nodes.length > CLASS_TREE_NODE_CAP) errs.push(`node count ${tree.nodes.length} exceeds cap ${CLASS_TREE_NODE_CAP}`);
  if (tree.nodes.length !== shape.total) errs.push(`node count ${tree.nodes.length} does not match ${tree.rarity} total ${shape.total}`);

  const byId = new Map<ClassNodeId, ClassNodeDef>();
  const forkGroups = new Map<string, ClassNodeDef[]>();
  let roots = 0;
  let capstones = 0;

  for (const n of tree.nodes) {
    if (!parseClassNodeId(n.id)) errs.push(`invalid node id "${String(n.id)}"`);
    if (byId.has(n.id)) errs.push(`duplicate node id "${n.id}"`);
    byId.set(n.id, n);
    if (n.depth < 1 || n.depth > shape.depths) errs.push(`node "${n.id}" depth ${n.depth} outside 1..${shape.depths}`);
    if (n.depth === 1) {
      roots++;
      if (n.parents.length !== 0) errs.push(`root "${n.id}" must have no parents`);
    } else if (n.parents.length === 0) {
      errs.push(`non-root "${n.id}" at depth ${n.depth} must name at least one parent`);
    }
    if (n.capstone) {
      capstones++;
      if (n.depth !== shape.depths) errs.push(`capstone "${n.id}" must sit at depth ${shape.depths}`);
      if (n.parentMode !== 'any') errs.push(`capstone "${n.id}" must use parentMode 'any'`);
    }
    if (n.forkGroup) {
      const grp = forkGroups.get(n.forkGroup) ?? [];
      grp.push(n);
      forkGroups.set(n.forkGroup, grp);
    }
    if (n.gifts.length === 0) errs.push(`node "${n.id}" must declare at least one gift`);
  }

  if (roots !== 1) errs.push(`expected exactly 1 Depth 1 root, found ${roots}`);
  if (capstones !== 1) errs.push(`expected exactly 1 Capstone, found ${capstones}`);

  for (const [group, members] of forkGroups) {
    if (members.length !== 2) {
      errs.push(`fork group "${group}" must have exactly 2 nodes, found ${members.length}`);
      continue;
    }
    const [a, b] = [members[0]!, members[1]!];
    if (a.depth !== b.depth) errs.push(`fork group "${group}" members must share depth`);
    if (!shape.forkDepths.includes(a.depth)) errs.push(`fork group "${group}" depth ${a.depth} is not a fork depth for ${tree.rarity}`);
    const pa = [...a.parents].sort().join(',');
    const pb = [...b.parents].sort().join(',');
    if (pa !== pb) errs.push(`fork group "${group}" members must share identical parents`);
  }

  for (const n of tree.nodes) {
    for (const pid of n.parents) {
      const parent = byId.get(pid);
      if (!parent) {
        errs.push(`node "${n.id}" references missing parent "${pid}"`);
      } else if (parent.depth >= n.depth) {
        errs.push(`node "${n.id}" (depth ${n.depth}) must sit deeper than parent "${pid}" (depth ${parent.depth})`);
      }
    }
    for (const [group, members] of forkGroups) {
      if (members.length === 2 && n.parents.includes(members[0]!.id) && n.parents.includes(members[1]!.id) && n.parentMode !== 'any') {
        errs.push(`node "${n.id}" lists both halves of fork "${group}" and must use parentMode 'any'`);
      }
    }
    if (n.capstone) {
      const penDepth = shape.depths - 1;
      const penNodes = tree.nodes.filter(x => x.depth === penDepth).map(x => x.id);
      for (const pid of penNodes) {
        if (!n.parents.includes(pid)) errs.push(`capstone "${n.id}" is missing penultimate-depth parent "${pid}"`);
      }
    }
  }

  const buyable = tree.nodes.length - forkGroups.size;
  if (buyable !== shape.buyable) errs.push(`buyable count ${buyable} does not match ${tree.rarity} target ${shape.buyable}`);

  return errs;
}

/** Checks whether `nodeId` can be legally bought on `tree` given `owned`. */
export function canBuyNode(
  tree: ClassTree,
  owned: readonly ClassNodeId[],
  nodeId: ClassNodeId,
): { readonly ok: true; readonly node: ClassNodeDef } | Refused<'unknown-node' | 'owned' | 'locked' | 'fork-taken'> {
  const node = tree.nodes.find(n => n.id === nodeId);
  if (!node) return refuse('unknown-node');
  const set = new Set(owned);
  if (set.has(nodeId)) return refuse('owned');
  if (node.forkGroup) {
    const twin = forkTwinOf(tree, nodeId);
    if (twin && set.has(twin.id)) return refuse('fork-taken');
  }
  if (!parentsSatisfied(node, set)) return refuse('locked');
  return { ok: true, node };
}

/** Checks whether an owned fork node `fromId` can be flipped to its exclusive twin `toId`. */
export function canFlipFork(
  tree: ClassTree,
  owned: readonly ClassNodeId[],
  fromId: ClassNodeId,
  toId: ClassNodeId,
): { readonly ok: true; readonly from: ClassNodeDef; readonly to: ClassNodeDef } | Refused<'unknown-node' | 'not-fork-pair' | 'not-owned' | 'already-owned'> {
  const from = tree.nodes.find(n => n.id === fromId);
  const to = tree.nodes.find(n => n.id === toId);
  if (!from || !to) return refuse('unknown-node');
  if (!from.forkGroup || from.forkGroup !== to.forkGroup || from.id === to.id) return refuse('not-fork-pair');
  const set = new Set(owned);
  if (!set.has(fromId)) return refuse('not-owned');
  if (set.has(toId)) return refuse('already-owned');
  return { ok: true, from, to };
}

/**
 * Repairs a saved node list against `tree`: drops unknown ids, duplicates, second halves of fork collisions
 * (first owned wins), and unreachable/orphaned nodes with no refund, preserving original purchase order.
 * Returns `[]` when `tree` is null (custom GM jobs or unauthored trees).
 */
export function repairNodes(tree: ClassTree | null, raw: readonly ClassNodeId[]): ClassNodeId[] {
  if (!tree || raw.length === 0) return [];
  const byId = new Map<ClassNodeId, ClassNodeDef>(tree.nodes.map(n => [n.id, n]));
  const seen = new Set<ClassNodeId>();
  const forkWinner = new Map<string, ClassNodeId>();
  let kept: ClassNodeId[] = [];

  for (const id of raw) {
    const node = byId.get(id);
    if (!node || seen.has(id)) continue;
    if (node.forkGroup) {
      if (forkWinner.has(node.forkGroup)) continue;
      forkWinner.set(node.forkGroup, id);
    }
    seen.add(id);
    kept.push(id);
  }

  let changed = true;
  while (changed) {
    changed = false;
    const set = new Set(kept);
    const next = kept.filter(id => parentsSatisfied(byId.get(id)!, set));
    if (next.length !== kept.length) {
      kept = next;
      changed = true;
    }
  }
  return kept;
}
