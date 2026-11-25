// classes.ts: sole writer of `Hunter.classes`, `Hunter.job`, and `Hunter.jobDone` (besides hunter.ts defaults/repair).
// Owns swap, node-buy, and fork-flip pricing (modeled on respec.ts), atomic save steps, outbox reporting, and wire
// trimming (`pushedClasses`). Pure.
import { priceBaseOf } from '../rules.ts';
import type { Rules } from '../rules.ts';
import type { Role } from '../role.ts';
import type { Hunter, Save } from '../save.ts';
import { refuse, isRefused } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { newEvent } from '../protocol.ts';
import type { EventStamp } from '../protocol.ts';
import { atOutbox, post } from '../sync/outbox.ts';
import { told } from '../session-log.ts';
import type { Said } from '../session-log.ts';
import { sheetKeyOf } from '../ids.ts';
import type { ClassNodeId, RoomCode, SheetKey } from '../ids.ts';
import { canonicalUniqueClass, classDefOf, isClassName, isUniqueClass } from '../registry/jobs.ts';
import type { ClassName } from '../registry/jobs.ts';
import {
  CLASS_LOCKER_CAP,
  CLASS_TREES,
  canBuyNode,
  canFlipFork,
  classTreeOf,
  repairNodes,
} from '../registry/class-trees.ts';
import type { ClassNodeDef, ClassTree, ClassTreeMap } from '../registry/class-trees.ts';
import { activeClass } from './class-locker.ts';
import type { ActiveClass, ClassEntry, ClassHolders, ClassLocker } from './class-locker.ts';
import { hasFought } from './chronicle.ts';
import type { Tally } from './chronicle.ts';
import { jobOf } from './hunter.ts';
import { addGold } from './inventory.ts';
import { fitted } from './sheet.ts';

export { activeClass };
export type { ActiveClass };

/** Why a class swap, fork flip, or tree node purchase costs 0 gold. */
export type ClassFreeWhy = 'gm' | 'before-first-fight' | 'rules';

/** Cost summary for a class swap, fork flip, or tree node purchase. */
export type ClassCostPlan = {
  readonly cost: number;
  readonly freeWhy: ClassFreeWhy | null;
};

/** Context for atomic player/GM class steps (`swapClass`, `buyClassNode`, `flipClassFork`). */
export type ClassStepCtx = {
  readonly role: Role;
  readonly held: boolean;
  readonly at: string;
  readonly room: RoomCode | null;
  readonly stamp: EventStamp | null;
  readonly R: Rules;
  /** Active campaign registry id when in a room (or null when alone); blocks swapping into foreign-campaign unique classes. */
  readonly activeRegistryId: string | null;
  /** Optional tree lookup override for unit tests before PR 2 populates `CLASS_TREES`. */
  readonly trees?: ClassTreeMap;
};

type CostHunter = Pick<Hunter, 'rank'> & { readonly chronicle: { readonly tally: Tally } };

const gp = (n: number): string => `${n.toLocaleString('en-US')} gold`;

/**
 * Sole owner of class swap pricing. Free in GM mode, free before the hunter's first fight (`!hasFought`),
 * and free when `RULES.classSwapPrices <= 0`. Otherwise `round(classSwapPrices * priceBase[rank])`.
 */
export function swapCost(
  h: CostHunter,
  role: Role,
  R: Pick<Rules, 'priceBase' | 'classSwapPrices'>,
): ClassCostPlan {
  if (role === 'gm') return { cost: 0, freeWhy: 'gm' };
  if (!hasFought(h.chronicle.tally)) return { cost: 0, freeWhy: 'before-first-fight' };
  const cost = Math.round(R.classSwapPrices * priceBaseOf(R, h.rank));
  if (cost <= 0) return { cost: 0, freeWhy: 'rules' };
  return { cost, freeWhy: null };
}

/** Sole owner of fork-flip pricing: same fee and free rules as a class swap. */
export function forkFlipCost(
  h: CostHunter,
  role: Role,
  R: Pick<Rules, 'priceBase' | 'classSwapPrices'>,
): ClassCostPlan {
  return swapCost(h, role, R);
}

/**
 * Sole owner of skill-tree node pricing. Free in GM mode or when rarity/depth multipliers produce 0.
 * Never free before the first fight (settled.md).
 */
export function nodeCost(
  h: Pick<Hunter, 'rank'>,
  className: string | null | undefined,
  nodeId: ClassNodeId,
  role: Role,
  R: Pick<Rules, 'priceBase' | 'classTreeRarityMult' | 'classTreeDepthMult'>,
  trees: ClassTreeMap = CLASS_TREES,
): ClassCostPlan | Refused<'no-tree' | 'unknown-node'> {
  const tree = classTreeOf(className, trees);
  if (!tree) return refuse('no-tree');
  const node = tree.nodes.find(n => n.id === nodeId);
  if (!node) return refuse('unknown-node');
  if (role === 'gm') return { cost: 0, freeWhy: 'gm' };
  const rMult = R.classTreeRarityMult[tree.rarity];
  const dMult = R.classTreeDepthMult[node.depth - 1] ?? 0;
  const cost = Math.round(priceBaseOf(R, h.rank) * rMult * dMult);
  if (cost <= 0) return { cost: 0, freeWhy: 'rules' };
  return { cost, freeWhy: null };
}

/**
 * Sets a hunter's job from free text (pre-chain Common starter or custom GM job), or clears it with null/blank.
 * Refuses dead or fight-held hunters when `opts` supplies those guards, unique built-in names or aliases
 * (including Shadow Monarch), earned non-active classes (no free-swap loophole), and unearned Rare built-in
 * class names (so typing a Rare name never grants its keystone stat pair).
 */
export function setJob<H extends { job: string | null; jobDone: string | null; classes: ClassLocker }>(
  h: H,
  job: string | null,
  opts?: { readonly held?: boolean; readonly dead?: boolean },
): H | Refused<'dead' | 'held' | 'unique-class' | 'earned-class' | 'not-earned'> {
  if (opts?.dead) return refuse('dead');
  if (opts?.held) return refuse('held');
  const clean = jobOf(job);
  if (clean && canonicalUniqueClass(clean) !== null) return refuse('unique-class');
  if (clean === null) return { ...h, job: null, jobDone: null };
  if (Object.hasOwn(h.classes, clean)) {
    if (h.job === clean && h.jobDone === clean) return h;
    return refuse('earned-class');
  }
  const def = classDefOf(clean);
  if (def && def.rarity === 'rare') return refuse('not-earned');
  return { ...h, job: clean, jobDone: null };
}

/**
 * Adds `cls` to `h.classes` (or replaces/resets it when `resetNodes` is true for a fresh `grantId`) and optionally
 * activates and awakens it. Refuses `'locker-full'` when adding a new class at `CLASS_LOCKER_CAP` (48).
 */
export function earnClass(
  h: Hunter,
  cls: string,
  opts: {
    readonly at: string;
    readonly activate?: boolean;
    readonly awaken?: boolean;
    readonly registryId?: string;
    readonly grantId?: string;
    readonly resetNodes?: boolean;
    readonly R?: Rules;
  },
): Hunter | Refused<'locker-full'> {
  const clean = jobOf(cls);
  if (!clean) return h;
  const existing = Object.hasOwn(h.classes, clean) ? h.classes[clean] : undefined;
  if (!existing && Object.keys(h.classes).length >= CLASS_LOCKER_CAP) return refuse('locker-full');

  const meta = {
    ...(opts.registryId ? { registryId: opts.registryId } : {}),
    ...(opts.grantId ? { grantId: opts.grantId } : {}),
  };
  let nextEntry: ClassEntry;
  if (!existing || opts.resetNodes) {
    nextEntry = { unlockedAt: opts.at, nodes: [], ...meta };
  } else if (opts.registryId || opts.grantId) {
    nextEntry = { ...existing, ...meta };
  } else {
    nextEntry = existing;
  }

  const classes: ClassLocker = existing === nextEntry ? h.classes : { ...h.classes, [clean]: nextEntry };
  const activate = opts.activate !== false;
  const awaken = opts.awaken !== false;
  const next: Hunter = {
    ...h,
    classes,
    ...(activate ? { job: clean, jobDone: awaken ? clean : h.jobDone } : {}),
  };
  return opts.R ? fitted(next, opts.R) : next;
}

/**
 * Drops `cls` and all its tree progress from `h.classes` with no refund.
 * If `cls` was the active class, clears `job` and `jobDone` to null so the player can pick another earned class.
 */
export function dropClass(h: Hunter, cls: string, R: Rules): Hunter {
  const clean = jobOf(cls);
  if (!clean) return h;
  const hadEntry = Object.hasOwn(h.classes, clean);
  const wasActive = h.job === clean || h.jobDone === clean;
  if (!hadEntry && !wasActive) return h;
  const nextClasses: Record<string, ClassEntry> = {};
  for (const [k, v] of Object.entries(h.classes)) {
    if (k !== clean) nextClasses[k] = v;
  }
  const next: Hunter = {
    ...h,
    classes: nextClasses,
    job: h.job === clean ? null : h.job,
    jobDone: h.jobDone === clean ? null : h.jobDone,
  };
  return fitted(next, R);
}

/**
 * Parks a foreign-campaign unique class while playing in another GM's room: keeps the entry and its bought nodes
 * intact in `h.classes`, and clears `job`/`jobDone` only if that class was active.
 */
export function parkClass(h: Hunter, cls: string, R: Rules): Hunter {
  const clean = jobOf(cls);
  if (!clean || (h.job !== clean && h.jobDone !== clean)) return h;
  const next: Hunter = {
    ...h,
    job: h.job === clean ? null : h.job,
    jobDone: h.jobDone === clean ? null : h.jobDone,
  };
  return fitted(next, R);
}

/** Session log / GM report entry for a class swap. */
export function classSwapSaid(name: string, from: string | null, to: string, cost: number): Said {
  const fromPart = from ? ` from ${from}` : '';
  return {
    kind: 'system',
    hunterId: null,
    title: 'Class swapped',
    text: cost > 0 ? `${name} swapped${fromPart} to ${to} for ${gp(cost)}.` : `${name} swapped${fromPart} to ${to} for free.`,
  };
}

/** Session log / GM report entry for buying a tree node (takes human-readable node name). */
export function classNodeSaid(name: string, className: string, nodeName: string, cost: number): Said {
  return {
    kind: 'system',
    hunterId: null,
    title: 'Class node bought',
    text: cost > 0
      ? `${name} bought ${nodeName} on ${className} for ${gp(cost)}.`
      : `${name} bought ${nodeName} on ${className} for free.`,
  };
}

/** Session log / GM report entry for flipping an exclusive fork pair (takes human-readable node names). */
export function classForkSaid(name: string, className: string, fromName: string, toName: string, cost: number): Said {
  return {
    kind: 'system',
    hunterId: null,
    title: 'Class fork flipped',
    text: cost > 0
      ? `${name} switched ${className} fork from ${fromName} to ${toName} for ${gp(cost)}.`
      : `${name} switched ${className} fork from ${fromName} to ${toName} for free.`,
  };
}

/** Pure plan of flipping fork node `fromId` to its twin `toId`, shared by `flipClassFork` and UI preview. */
export type ForkFlipPlan = {
  readonly ok: true;
  readonly from: ClassNodeDef;
  readonly to: ClassNodeDef;
  readonly nextNodes: readonly ClassNodeId[];
  readonly dropped: readonly ClassNodeId[];
  readonly droppedDefs: readonly ClassNodeDef[];
};

/** Computes the exact post-flip node list and dropped dependents using `canFlipFork` and `repairNodes`. */
export function planForkFlip(
  tree: ClassTree,
  owned: readonly ClassNodeId[],
  fromId: ClassNodeId,
  toId: ClassNodeId,
): ForkFlipPlan | Refused<'unknown-node' | 'not-fork-pair' | 'not-owned' | 'already-owned'> {
  const check = canFlipFork(tree, owned, fromId, toId);
  if (isRefused(check)) return check;
  const replaced = owned.map(id => (id === fromId ? toId : id));
  const nextNodes = repairNodes(tree, replaced);
  const keptSet = new Set(nextNodes);
  const dropped = owned.filter(id => id !== fromId && !keptSet.has(id));
  const byId = new Map(tree.nodes.map(n => [n.id, n]));
  const droppedDefs = dropped.map(id => byId.get(id)).filter((n): n is ClassNodeDef => !!n);
  return { ok: true, from: check.from, to: check.to, nextNodes, dropped, droppedDefs };
}

/** Outcome of `swapClass`. */
export type SwappedClass = {
  readonly save: Save;
  readonly from: string | null;
  readonly to: string;
  readonly cost: number;
};
export type SwapRefusal = Refused<'no-hunter' | 'dead' | 'held' | 'not-earned' | 'same-class' | 'foreign-class' | 'holders-pending' | 'gold'>;

/**
 * Swaps hunter `hid` to another earned class in their locker in one atomic save step.
 * Never touches `save.classHolders`, keeps all classes' node progress intact, and never borrows gold.
 */
export function swapClass(save: Save, hid: string, targetClass: string, ctx: ClassStepCtx): SwappedClass | SwapRefusal {
  const at = save.hunters.findIndex(h => h.id === hid);
  if (at < 0) return refuse('no-hunter');
  const h = save.hunters[at]!;
  if (h.life.at === 'dead') return refuse('dead');
  if (ctx.held) return refuse('held');
  const target = jobOf(targetClass);
  if (!target || !Object.hasOwn(h.classes, target)) return refuse('not-earned');
  const entry = h.classes[target]!;
  if (isUniqueClass(target) && entry.registryId) {
    if (ctx.role === 'player' && ctx.room && !ctx.activeRegistryId) return refuse('holders-pending');
    if (ctx.activeRegistryId && entry.registryId !== ctx.activeRegistryId) return refuse('foreign-class');
  }
  const active = activeClass(h);
  if (active.kind === 'earned' && active.name === target) return refuse('same-class');
  const { cost } = swapCost(h, ctx.role, ctx.R);
  if (cost > h.gold) return refuse('gold');

  const from = h.job;
  let next: Hunter = { ...h, job: target, jobDone: target };
  if (cost > 0) next = addGold(next, -cost);
  next = fitted(next, ctx.R);

  let s: Save = { ...save, hunters: save.hunters.map((x, i) => (i === at ? next : x)) };
  if (ctx.role === 'player' && ctx.room && ctx.stamp) {
    const ev = newEvent('classSwap', {
      by: sheetKeyOf(save.settings.deviceId, h.id),
      name: h.name,
      fromClass: from,
      toClass: target,
      cost,
    }, ctx.stamp);
    if (ev) s = atOutbox(box => post(box, ctx.room!, { kind: 'event', event: ev }, null).box)(s);
  } else {
    const said = classSwapSaid(h.name, from, target, cost);
    s = told(s, { at: ctx.at, cap: ctx.R.logCap }, { ...said, hunterId: h.id });
  }
  return { save: s, from, to: target, cost };
}

/** Outcome of `buyClassNode`. */
export type BoughtClassNode = {
  readonly save: Save;
  readonly className: ClassName;
  readonly nodeId: ClassNodeId;
  readonly cost: number;
};
export type BuyNodeRefusal = Refused<
  'no-hunter' | 'dead' | 'held' | 'no-class' | 'no-tree' | 'unknown-node' | 'owned' | 'locked' | 'fork-taken' | 'gold'
>;

/**
 * Buys skill-tree node `nodeId` on hunter `hid`'s active awakened class in one atomic save step.
 * Appends `nodeId` in purchase order, pays from carried gold (never borrowed), fits vitals, and reports to the room or log.
 */
export function buyClassNode(
  save: Save,
  hid: string,
  nodeId: ClassNodeId,
  ctx: ClassStepCtx,
): BoughtClassNode | BuyNodeRefusal {
  const at = save.hunters.findIndex(h => h.id === hid);
  if (at < 0) return refuse('no-hunter');
  const h = save.hunters[at]!;
  if (h.life.at === 'dead') return refuse('dead');
  if (ctx.held) return refuse('held');
  const active = activeClass(h);
  if (active.kind !== 'earned') return refuse('no-class');

  const trees = ctx.trees ?? CLASS_TREES;
  const tree = classTreeOf(active.name, trees);
  if (!tree || !isClassName(active.name)) return refuse('no-tree');
  const check = canBuyNode(tree, active.entry.nodes, nodeId);
  if (isRefused(check)) return check;

  const priced = nodeCost(h, active.name, nodeId, ctx.role, ctx.R, trees);
  if (isRefused(priced)) return priced;
  if (priced.cost > h.gold) return refuse('gold');

  const nextEntry: ClassEntry = { ...active.entry, nodes: [...active.entry.nodes, nodeId] };
  let next: Hunter = { ...h, classes: { ...h.classes, [active.name]: nextEntry } };
  if (priced.cost > 0) next = addGold(next, -priced.cost);
  next = fitted(next, ctx.R);

  let s: Save = { ...save, hunters: save.hunters.map((x, i) => (i === at ? next : x)) };
  if (ctx.role === 'player' && ctx.room && ctx.stamp) {
    const ev = newEvent('classNode', {
      by: sheetKeyOf(save.settings.deviceId, h.id),
      name: h.name,
      className: active.name,
      act: 'buy',
      nodeId,
      cost: priced.cost,
    }, ctx.stamp);
    if (ev) s = atOutbox(box => post(box, ctx.room!, { kind: 'event', event: ev }, null).box)(s);
  } else {
    const said = classNodeSaid(h.name, active.name, check.node.name, priced.cost);
    s = told(s, { at: ctx.at, cap: ctx.R.logCap }, { ...said, hunterId: h.id });
  }
  return { save: s, className: active.name, nodeId, cost: priced.cost };
}

/** Outcome of `flipClassFork`. */
export type FlippedClassFork = {
  readonly save: Save;
  readonly className: ClassName;
  readonly fromId: ClassNodeId;
  readonly toId: ClassNodeId;
  readonly cost: number;
  readonly dropped: readonly ClassNodeId[];
};
export type FlipForkRefusal = Refused<
  'no-hunter' | 'dead' | 'held' | 'no-class' | 'no-tree' | 'unknown-node' | 'not-fork-pair' | 'not-owned' | 'already-owned' | 'gold'
>;

/**
 * Flips an owned exclusive fork node `fromId` to its twin `toId` on the active class for the swap fee, with no refund.
 * Replaces `fromId` in place and runs `repairNodes` so post-fork convergence nodes survive while exclusive dependents drop.
 */
export function flipClassFork(
  save: Save,
  hid: string,
  fromId: ClassNodeId,
  toId: ClassNodeId,
  ctx: ClassStepCtx,
): FlippedClassFork | FlipForkRefusal {
  const at = save.hunters.findIndex(h => h.id === hid);
  if (at < 0) return refuse('no-hunter');
  const h = save.hunters[at]!;
  if (h.life.at === 'dead') return refuse('dead');
  if (ctx.held) return refuse('held');
  const active = activeClass(h);
  if (active.kind !== 'earned') return refuse('no-class');

  const trees = ctx.trees ?? CLASS_TREES;
  const tree = classTreeOf(active.name, trees);
  if (!tree || !isClassName(active.name)) return refuse('no-tree');
  const plan = planForkFlip(tree, active.entry.nodes, fromId, toId);
  if (isRefused(plan)) return plan;

  const { cost } = forkFlipCost(h, ctx.role, ctx.R);
  if (cost > h.gold) return refuse('gold');

  const nextEntry: ClassEntry = { ...active.entry, nodes: plan.nextNodes };
  let next: Hunter = { ...h, classes: { ...h.classes, [active.name]: nextEntry } };
  if (cost > 0) next = addGold(next, -cost);
  next = fitted(next, ctx.R);

  let s: Save = { ...save, hunters: save.hunters.map((x, i) => (i === at ? next : x)) };
  if (ctx.role === 'player' && ctx.room && ctx.stamp) {
    const ev = newEvent('classNode', {
      by: sheetKeyOf(save.settings.deviceId, h.id),
      name: h.name,
      className: active.name,
      act: 'flip',
      nodeId: toId,
      fromId,
      cost,
    }, ctx.stamp);
    if (ev) s = atOutbox(box => post(box, ctx.room!, { kind: 'event', event: ev }, null).box)(s);
  } else {
    const said = classForkSaid(h.name, active.name, plan.from.name, plan.to.name, cost);
    s = told(s, { at: ctx.at, cap: ctx.R.logCap }, { ...said, hunterId: h.id });
  }
  return { save: s, className: active.name, fromId, toId, cost, dropped: plan.dropped };
}

/**
 * Trims `hunter.classes` to the active entry only before a sheet goes on the wire (sync.ts),
 * keeping 48-class lockers well below `SHEET_MAX` (32,768 bytes).
 */
export function pushedClasses(h: Hunter): Hunter {
  if (!h.job || !Object.hasOwn(h.classes, h.job)) {
    return Object.keys(h.classes).length === 0 ? h : { ...h, classes: {} };
  }
  if (Object.keys(h.classes).length === 1) return h;
  return { ...h, classes: { [h.job]: h.classes[h.job]! } };
}

/**
 * Verifies a remote player's pushed sheet against the GM's `classHolders` before GM views or combat consume it.
 * Strips any unique class entry not backed by `holders.held[cls]` for `sheetKey`, and clears unbacked unique `job`/`jobDone`.
 */
export function backedRemoteHunter(
  h: Hunter,
  sheetKey: SheetKey,
  holders: ClassHolders,
): Hunter {
  let changed = false;
  let classes: Record<string, ClassEntry> | null = null;
  for (const [cls, entry] of Object.entries(h.classes)) {
    if (!isUniqueClass(cls)) continue;
    const holder = holders.held[cls];
    if (holder && holder.kind === 'remote' && holder.sheetKey === sheetKey) continue;
    if (!classes) classes = { ...h.classes };
    delete classes[cls];
    changed = true;
  }

  let job = h.job;
  let jobDone = h.jobDone;
  if (job) {
    const canon = canonicalUniqueClass(job);
    if (canon !== null) {
      const holder = holders.held[canon];
      const backed = !!holder && holder.kind === 'remote' && holder.sheetKey === sheetKey;
      if (!backed) {
        job = null;
        jobDone = null;
        changed = true;
      }
    }
  }
  if (jobDone && jobDone !== job) {
    jobDone = null;
    changed = true;
  }

  return changed ? { ...h, classes: classes ?? h.classes, job, jobDone } : h;
}

/** Plain-English refusal messages shared by PR 3 UI and tests (voice.md compliant). */
export const CLASS_REFUSAL_WORDS = {
  'no-hunter': 'Hunter not found.',
  dead: 'You cannot change classes or buy nodes while dead.',
  held: 'You cannot change classes or buy nodes during a fight.',
  'not-earned': 'You have not earned that class yet.',
  'same-class': 'You are already using that class.',
  'earned-class': 'Swap to earned classes from your class locker.',
  'foreign-class': 'That unique class belongs to another campaign and is parked in this room.',
  'holders-pending': 'Waiting for the room\'s class registry. Try again in a moment.',
  'no-class': 'You do not have an active awakened class.',
  'no-tree': 'This class has no skill tree.',
  'unknown-node': 'That skill tree node does not exist.',
  owned: 'You already own that node.',
  locked: 'Buy a parent node first.',
  'fork-taken': 'You already picked the other fork. Flip the fork outside combat to switch.',
  'not-fork-pair': 'Those two nodes are not an exclusive fork pair.',
  'not-owned': 'You do not own that fork node.',
  'already-owned': 'You already own that fork choice.',
  'unique-class': 'Only the GM can grant a unique class.',
  'locker-full': `Your class locker is full (${CLASS_LOCKER_CAP} classes).`,
  gold: 'You do not have enough carried gold.',
} as const;
