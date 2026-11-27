// class-view.ts: pure view-models and voice.md-compliant copy builders for the player class locker, skill tree buyer,
// fork flip modal, and GM unique-class registry (PR 3). Pure: no DOM, no storage, no network.
import type { Rank, Rules } from '../rules.ts';
import type { Role } from '../role.ts';
import type { Hunter, Save } from '../save.ts';
import { STAT_LABELS, STAT_SHORT } from '../stats.ts';
import type { StatKey } from '../stats.ts';
import { isRefused } from '../save-step.ts';
import type { ClassNodeId, HunterId, SheetKey } from '../ids.ts';
import type { HoldersDoc } from '../protocol.ts';
import { FAMILY, nameOf as scalerNameOf } from '../registry/scalers.ts';
import { CLASS_SIGNATURES, classExtractOf } from '../registry/class-powers.ts';
import type { ClassSignatureMap } from '../registry/class-powers.ts';
import { VESSEL_CAP, vesselBonus, vesselPower, vesselTotalPower } from './blood-vessels.ts';
import type { VesselKind } from './blood-vessels.ts';
import {
  BUILT_IN_CLASSES,
  UNIQUE_CLASS_NAMES,
  classDefOf,
  isUniqueClass,
} from '../registry/jobs.ts';
import type { ClassRarity, UniqueClassName } from '../registry/jobs.ts';
import {
  CLASS_BONUS_KEYS,
  CLASS_BONUS_LABELS,
  CLASS_TREES,
  TREE_SHAPE,
  canBuyNode,
  capstoneUnlocked,
  classTreeOf,
  forkTwinOf,
} from '../registry/class-trees.ts';
import type { ClassNodeDef, ClassPerk, ClassTree, ClassTreeMap, NodeGift, TreeDepth } from '../registry/class-trees.ts';
import { activeClass } from './class-locker.ts';
import type { ActiveClass, ClassHolder } from './class-locker.ts';
import { CLASS_REFUSAL_WORDS, forkFlipCost, nodeCost, planForkFlip, swapCost } from './classes.ts';
import type { ClassCostPlan } from './classes.ts';
import { holderOf } from './class-holders.ts';
import type { StatPair } from './keystones.ts';

const gp = (n: number): string => `${n.toLocaleString('en-US')} gold`;
const num = (n: number): string => n.toLocaleString('en-US');
const sgn = (n: number): string => (n >= 0 ? `+${n}` : `-${Math.abs(n)}`);
const nodeWord = (n: number): string => (n === 1 ? '1 node' : `${n} nodes`);

/** Display names for each class rarity tier. */
export const CLASS_RARITY_LABEL: Readonly<Record<ClassRarity, string>> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  mythic: 'Mythic',
};

const RARITY_ORDER: Readonly<Record<ClassRarity, number>> = {
  mythic: 0,
  epic: 1,
  rare: 2,
  common: 3,
};

/** Formats a stat pair such as `vit+pow` as `VIT + POW`. */
export function pairShortLabel(pair: StatPair): string {
  const [a, b] = pair.split('+') as [StatKey, StatKey];
  return `${STAT_SHORT[a]} + ${STAT_SHORT[b]}`;
}

/** Formats a stat pair such as `vit+pow` as `Vitality and Power`. */
export function pairLongLabel(pair: StatPair): string {
  const [a, b] = pair.split('+') as [StatKey, StatKey];
  return `${STAT_LABELS[a]} and ${STAT_LABELS[b]}`;
}

/** Static labels, headings, and dynamic builders for player and GM class screens (voice.md compliant). */
export const CLASS_UI_WORDS = {
  panelTitle: 'Classes',
  activeLabel: 'Active class',
  noActive: 'No active class.',
  awakenedBadge: 'Awakened',
  labelBadge: 'Starter job',
  uniqueBadge: 'Unique',
  parkedBadge: 'Parked',
  inFightBadge: 'In fight',
  syncedBadge: 'Sent to room',
  syncingBadge: 'Sending',
  noKitBadge: 'No kit yet',
  noKitNote: 'This class has no fight powers yet.',
  removedSuffix: ' (removed)',
  lockerHeading: 'Class locker',
  lockerEmpty: 'No earned classes yet. Complete a Job Change or receive a unique class from the GM.',
  statPairPrefix: 'Stat pair: ',
  recRankPrefix: 'Recommended rank: ',
  inFightSuffix: ' (in fight)',
  nodesProgress: (bought: number, cap: number | null): string => (cap ? `${bought}/${cap} nodes` : nodeWord(bought)),
  depthHeading: (depth: number, capstone: boolean): string =>
    `Depth ${depth}${depth === 1 ? ' (Root)' : capstone ? ' (Capstone)' : ''}`,
  starterFieldLabel: 'Starter or custom job',
  starterApply: 'Set job',
  starterClear: 'Clear job',
  starterHint: 'Pick a Common starter job or type a custom label. Earned classes are swapped from your locker, and unique classes come from the GM.',
  swapAction: 'Swap',
  activeAction: 'Active',
  treeHeading: 'Skill tree',
  treeEmpty: 'No skill tree is available for this class yet.',
  treeNoActive: 'Activate an earned class from your locker to view its skill tree.',
  capstoneReady: 'Capstone unlocked.',
  forkPickOne: 'Pick one',
  needsAllPrefix: 'Needs: ',
  needsAnyPrefix: 'Needs any: ',
  nodeOwned: 'Owned',
  nodeLocked: 'Locked',
  nodeOtherFork: 'Other fork chosen',
  nodeBuy: 'Buy',
  flipForkAction: 'Flip fork',
  swapWarnTag: 'Class swap',
  swapWarnTitle: (cls: string): string => `Swap to ${cls}?`,
  swapWarnBody: (cls: string, cost: number, gold: number): string =>
    `Swap active class to ${cls} for ${gp(cost)}? You have ${gp(gold)}.`,
  swapPairNote: (pair: StatPair): string =>
    `${pairLongLabel(pair)} is this class's stat pair. Your ability points stay as they are. You can reset them separately under Attributes.`,
  payAction: (cost: number): string => `Pay ${gp(cost)}`,
  nodeWarnTag: 'Skill tree',
  nodeWarnTitle: (nodeName: string): string => `Buy ${nodeName}?`,
  nodeWarnBody: (nodeName: string, className: string, cost: number, gold: number): string =>
    `Buy ${nodeName} on ${className} for ${gp(cost)}? You have ${gp(gold)}. Node purchases are permanent.`,
  flipWarnTag: 'Fork flip',
  flipWarnTitle: (toName: string): string => `Flip fork to ${toName}?`,
  flipWarnBody: (fromName: string, toName: string, plan: ClassCostPlan, gold: number): string => {
    const pricePart = plan.cost > 0
      ? `Flipping from ${fromName} to ${toName} costs ${gp(plan.cost)}. You have ${gp(gold)}.`
      : `Flipping from ${fromName} to ${toName} is free (${freeWhyText(plan.freeWhy)}).`;
    return `${pricePart} No gold is refunded for ${fromName}.`;
  },
  flipDroppedLine: (names: readonly string[]): string =>
    names.length === 1
      ? `This also drops 1 dependent node with no refund: ${names[0]}.`
      : `This also drops ${names.length} dependent nodes with no refund: ${names.join(', ')}.`,
  flipConfirmFree: 'Flip fork',
  swappedToast: (cls: string, cost: number, pairChanged: boolean): string => {
    const base = cost > 0 ? `Swapped to ${cls} for ${gp(cost)}.` : `Swapped to ${cls} for free.`;
    return pairChanged
      ? `${base} Its stat pair differs from your previous class. Use Take all back under Attributes if you want to reset ability points.`
      : base;
  },
  boughtToast: (nodeName: string, cost: number): string =>
    cost > 0 ? `Bought ${nodeName} for ${gp(cost)}.` : `Bought ${nodeName} for free.`,
  flippedToast: (toName: string, cost: number, droppedCount: number): string => {
    const base = cost > 0 ? `Switched fork to ${toName} for ${gp(cost)}.` : `Switched fork to ${toName} for free.`;
    return droppedCount > 0 ? `${base} Dropped ${nodeWord(droppedCount)}.` : base;
  },
  jobSetToast: (job: string | null): string => (job ? `Job set to ${job}.` : 'Job cleared.'),
  // GM Unique-Class Registry
  gmSummary: (held: number, total: number): string => `${held} of ${total} held`,
  gmHint: 'Only one hunter or NPC can hold each Epic or Mythic class in a campaign. Death or leaving does not free a class. Release or Reassign frees it outside a fight.',
  gmFilterAria: 'Filter unique classes',
  gmSearchLabel: 'Search classes',
  gmListAria: 'Unique classes',
  gmFilterAll: 'All',
  gmFilterMythic: 'Mythic',
  gmFilterEpic: 'Epic',
  gmFilterHeld: 'Held',
  gmFilterOpen: 'Open',
  gmGrantAction: 'Grant',
  gmReleaseAction: 'Release',
  gmReassignAction: 'Reassign',
  gmUnclaimed: 'Open',
  gmHeldBy: (name: string, kindLabel: string): string => `Held by ${name} (${kindLabel})`,
  gmGrantTitle: (cls: string): string => `Grant ${cls}`,
  gmGrantConfirm: 'Grant class',
  gmReassignTitle: (cls: string): string => `Reassign ${cls}`,
  gmReassignConfirm: 'Reassign class',
  gmReleaseTitle: (cls: string): string => `Release ${cls}?`,
  gmReleaseConfirm: 'Release class',
  gmReleaseBody: (cls: string, holderName: string): string =>
    `Release ${cls} from ${holderName}? Their skill-tree progress on ${cls} is cleared with no gold refund.`,
  gmReassignBody: (cls: string, holderName: string): string =>
    `${holderName} currently holds ${cls}. Reassigning moves ${cls} to the new target in one step and clears ${holderName}'s tree progress with no gold refund.`,
  gmTargetKindLabel: 'Recipient',
  gmTargetHunter: 'Hunter',
  gmTargetNpc: 'NPC',
  gmSelectHunterLabel: 'Select hunter',
  gmNpcNameLabel: 'NPC name',
  gmNpcMonsterLabel: 'Bestiary entry (optional)',
  gmNpcMonsterNone: 'None (named NPC only)',
  gmNoHunters: 'No hunters available.',
  gmHeldWarning: 'This hunter is in a fight. Finish the fight before changing their unique class.',
  gmClaimedToast: (cls: string, name: string): string => `Granted ${cls} to ${name}.`,
  gmReleasedToast: (cls: string, name: string): string => `Released ${cls} from ${name}.`,
  gmReassignedToast: (cls: string, fromName: string, toName: string): string =>
    `Reassigned ${cls} from ${fromName} to ${toName}.`,
  gmLocalKind: 'This phone',
  gmRemoteKind: 'Player phone',
  gmNpcKind: 'NPC',
  // Crimson Vessels (blood extraction aspect)
  vesselsHeading: (count: number, cap: number): string => `Crimson Vessels (${count} / ${cap})`,
  vesselsHint: (className: string): string =>
    `Extract blood from defeated monsters after a fight to raise your Power, Flat magic penetration, and Ability haste while ${className} is active.`,
  vesselsEmpty: 'No Crimson Vessels yet. Defeat a monster, end the fight, then tap Extract blood.',
  vesselsBonusLine: (b: ClassPerk, totalPower: number): string => {
    const parts = [
      b.pow ? `+${b.pow} Power` : '',
      b.resistPenFlat ? `+${b.resistPenFlat} Flat magic penetration` : '',
      b.haste ? `+${b.haste} Ability haste` : '',
    ].filter(Boolean);
    return parts.length ? `Active bonus: ${parts.join(', ')} (power ${totalPower}).` : '';
  },
  vesselRemoveAction: 'Remove',
  vesselRemoveTitle: 'Remove Crimson Vessel?',
  vesselRemoveConfirm: 'Remove vessel',
  vesselRemoveBody: (name: string, rank: Rank, kind: VesselKind): string =>
    `Remove ${name} (${rank}-rank${kind === 'normal' ? '' : ` ${kind}`}) from your Crimson Vessels? You cannot undo this.`,
  vesselRemovedToast: (name: string): string => `Removed ${name} from Crimson Vessels.`,
} as const;

function freeWhyText(why: ClassCostPlan['freeWhy']): string {
  if (why === 'gm') return 'free in GM mode';
  if (why === 'before-first-fight') return 'free before your first fight';
  return 'free under current rules';
}

/** Cost preview label for a swap button or helper line. */
export function swapCostLabel(plan: ClassCostPlan): string {
  if (plan.cost <= 0) return 'Free';
  return gp(plan.cost);
}

/** Cost preview sentence for swapping classes. */
export function swapCostLine(plan: ClassCostPlan, gold: number): string {
  if (plan.freeWhy === 'gm') return 'Class swaps are free in GM mode.';
  if (plan.freeWhy === 'before-first-fight') return 'Class swaps are free before your first fight.';
  if (plan.freeWhy === 'rules') return 'Class swaps are free under current rules.';
  return `Swapping classes costs ${gp(plan.cost)}. You have ${num(gold)}.`;
}

/** Cost preview label for a node buy button. */
export function nodeCostLabel(plan: ClassCostPlan): string {
  if (plan.cost <= 0) return 'Free';
  return gp(plan.cost);
}

type ClassRefusalDict = { readonly [K in keyof typeof CLASS_REFUSAL_WORDS]: string };

/** Refusal toast dictionary for `swapClass`, substituting exact gold numbers. */
export function swapRefusalWords(cost: number, gold: number): ClassRefusalDict {
  return {
    ...CLASS_REFUSAL_WORDS,
    gold: `Swapping classes costs ${gp(cost)}. You have ${num(gold)}.`,
  };
}

/** Refusal toast dictionary for `buyClassNode`, substituting exact gold numbers. */
export function nodeRefusalWords(cost: number, gold: number): ClassRefusalDict {
  return {
    ...CLASS_REFUSAL_WORDS,
    gold: `Buying this node costs ${gp(cost)}. You have ${num(gold)}.`,
  };
}

/** Refusal toast dictionary for `flipClassFork`, substituting exact gold numbers. */
export function forkRefusalWords(cost: number, gold: number): ClassRefusalDict {
  return {
    ...CLASS_REFUSAL_WORDS,
    gold: `Flipping this fork costs ${gp(cost)}. You have ${num(gold)}.`,
  };
}

/** Plain-English summary lines for one node's gifts (`bonus`, `scaler`, `replace-worn`, `replace-active`, `upgrade-status`). */
export function nodeGiftLines(gifts: readonly NodeGift[]): string[] {
  const out: string[] = [];
  for (const g of gifts) {
    if (g.kind === 'bonus') {
      const parts = CLASS_BONUS_KEYS.filter(k => typeof g.bonus[k] === 'number' && g.bonus[k] !== 0)
        .map(k => `${sgn(g.bonus[k]!)} ${CLASS_BONUS_LABELS[k]}`);
      if (parts.length) out.push(parts.join(', '));
    } else if (g.kind === 'scaler') {
      const label = FAMILY[scalerNameOf(g.scaler)].label;
      out.push(`${label} (up to +${Math.round(g.scaler.scale * 100)}%)`);
    } else if (g.kind === 'replace-worn') {
      out.push(`Upgrades passive: ${g.worn.def.label}`);
    } else if (g.kind === 'replace-active') {
      out.push(`Upgrades ability: ${g.active.name}`);
    } else if (g.kind === 'upgrade-status') {
      out.push(`Upgrades status: ${g.def.label}`);
    }
  }
  return out;
}

/** Computes which owned nodes would be dropped if `fromId` is flipped to `toId`, via shared `planForkFlip`. */
export function forkFlipPreview(
  tree: ClassTree,
  owned: readonly ClassNodeId[],
  fromId: ClassNodeId,
  toId: ClassNodeId,
): { readonly ok: true; readonly from: ClassNodeDef; readonly to: ClassNodeDef; readonly dropped: readonly ClassNodeDef[] } | null {
  const plan = planForkFlip(tree, owned, fromId, toId);
  if (isRefused(plan)) return null;
  return { ok: true, from: plan.from, to: plan.to, dropped: plan.droppedDefs };
}

/** Presentation row for one earned class in a hunter's locker. */
export type LockerEntryView = {
  readonly name: string;
  readonly rarity: ClassRarity | null;
  readonly rarityLabel: string;
  readonly unique: boolean;
  readonly active: boolean;
  readonly parked: boolean;
  readonly pairLabel: string | null;
  readonly recRank: string | null;
  readonly nodesBought: number;
  readonly nodesCap: number | null;
};

/** Presentation state of one node in a skill tree. */
export type TreeNodeStatus = 'owned' | 'buyable' | 'locked' | 'fork-taken';

export type TreeNodeView = {
  readonly id: ClassNodeId;
  readonly depth: TreeDepth;
  readonly name: string;
  readonly desc: string;
  readonly gifts: readonly string[];
  readonly status: TreeNodeStatus;
  readonly costPlan: ClassCostPlan | null;
  readonly forkGroup: string | null;
  readonly flipFromId: ClassNodeId | null;
  readonly flipCostPlan: ClassCostPlan | null;
  readonly capstone: boolean;
  readonly missingParents: readonly string[];
  readonly parentMode: 'all' | 'any';
};

export type TreeDepthGroup = {
  readonly depth: TreeDepth;
  readonly nodes: readonly TreeNodeView[];
};

/** Presentation row for one stored Crimson Vessel on the player's Classes panel. */
export type VesselItemView = {
  readonly index: number;
  readonly name: string;
  readonly rank: Rank;
  readonly kind: VesselKind;
  readonly power: number;
};

/** Presentation block for the active class's Crimson Vessels section on the player's Classes panel. */
export type VesselSectionView = {
  readonly className: string;
  readonly count: number;
  readonly cap: number;
  readonly totalPower: number;
  readonly bonus: ClassPerk;
  readonly items: readonly VesselItemView[];
};

/** Complete pure presentation model for the player's Classes panel. */
export type LockerViewModel = {
  readonly active: ActiveClass;
  readonly activeRarity: ClassRarity | null;
  readonly activeRarityLabel: string | null;
  readonly activePairLabel: string | null;
  readonly activeRecRank: string | null;
  readonly activeUnique: boolean;
  readonly swapPlan: ClassCostPlan;
  readonly swapLine: string;
  readonly entries: readonly LockerEntryView[];
  readonly vessels: VesselSectionView | null;
  readonly tree: {
    readonly className: string;
    readonly rarity: ClassRarity;
    readonly ownedCount: number;
    readonly buyableCap: number;
    readonly capstoneReady: boolean;
    readonly depths: readonly TreeDepthGroup[];
  } | null;
  readonly treeMissing: boolean;
  readonly held: boolean;
};

/** Builds the pure view-model for a hunter's class locker and active class skill tree. */
export function lockerView(
  h: Hunter,
  opts: {
    readonly role: Role;
    readonly held: boolean;
    readonly R: Rules;
    readonly activeRegistryId: string | null;
    readonly trees?: ClassTreeMap;
    readonly signatures?: ClassSignatureMap;
  },
): LockerViewModel {
  const trees = opts.trees ?? CLASS_TREES;
  const active = activeClass(h);
  const activeDef = active.kind === 'none' ? null : classDefOf(active.name);
  const swapPlan = swapCost(h, opts.role, opts.R);
  const flipPlan = forkFlipCost(h, opts.role, opts.R);

  const entries: LockerEntryView[] = Object.entries(h.classes).map(([name, entry]) => {
    const def = classDefOf(name);
    const unique = isUniqueClass(name);
    const isAct = active.kind === 'earned' && active.name === name;
    const parked = unique && !!opts.activeRegistryId && !!entry.registryId && entry.registryId !== opts.activeRegistryId;
    const tree = classTreeOf(name, trees);
    const nodesCap = tree ? TREE_SHAPE[tree.rarity].buyable : (def ? TREE_SHAPE[def.rarity].buyable : null);
    return {
      name,
      rarity: def?.rarity ?? null,
      rarityLabel: def ? CLASS_RARITY_LABEL[def.rarity] : 'Custom',
      unique,
      active: isAct,
      parked,
      pairLabel: def ? pairShortLabel(def.pair) : null,
      recRank: def?.recRank ?? null,
      nodesBought: entry.nodes.length,
      nodesCap,
    };
  }).sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const ra = a.rarity ? RARITY_ORDER[a.rarity] : 4;
    const rb = b.rarity ? RARITY_ORDER[b.rarity] : 4;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });

  let treeView: LockerViewModel['tree'] = null;
  let treeMissing = false;
  if (active.kind === 'earned') {
    const tree = classTreeOf(active.name, trees);
    if (!tree) {
      treeMissing = true;
    } else {
      const owned = active.entry.nodes;
      const ownedSet = new Set(owned);
      const nodeById = new Map(tree.nodes.map(n => [n.id, n]));
      const byDepth = new Map<TreeDepth, TreeNodeView[]>();
      for (const n of tree.nodes) {
        let status: TreeNodeStatus;
        let costPlan: ClassCostPlan | null = null;
        let flipFromId: ClassNodeId | null = null;
        if (ownedSet.has(n.id)) {
          status = 'owned';
        } else {
          const check = canBuyNode(tree, owned, n.id);
          if (!isRefused(check)) {
            status = 'buyable';
            const priced = nodeCost(h, active.name, n.id, opts.role, opts.R, trees);
            costPlan = isRefused(priced) ? null : priced;
          } else if (check.why === 'fork-taken') {
            status = 'fork-taken';
            const twin = forkTwinOf(tree, n.id);
            if (twin && ownedSet.has(twin.id)) flipFromId = twin.id;
          } else {
            status = 'locked';
            const priced = nodeCost(h, active.name, n.id, opts.role, opts.R, trees);
            costPlan = isRefused(priced) ? null : priced;
          }
        }
        const missingParents = status === 'locked'
          ? n.parents.filter(pid => !ownedSet.has(pid)).map(pid => nodeById.get(pid)?.name ?? pid)
          : [];
        const row: TreeNodeView = {
          id: n.id,
          depth: n.depth,
          name: n.name,
          desc: n.desc,
          gifts: nodeGiftLines(n.gifts),
          status,
          costPlan,
          forkGroup: n.forkGroup ?? null,
          flipFromId,
          flipCostPlan: flipFromId ? flipPlan : null,
          capstone: n.capstone === true,
          missingParents,
          parentMode: n.parentMode ?? 'all',
        };
        const list = byDepth.get(n.depth) ?? [];
        list.push(row);
        byDepth.set(n.depth, list);
      }
      const depths: TreeDepthGroup[] = [...byDepth.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([depth, nodes]) => ({ depth, nodes }));
      treeView = {
        className: active.name,
        rarity: tree.rarity,
        ownedCount: owned.length,
        buyableCap: TREE_SHAPE[tree.rarity].buyable,
        capstoneReady: capstoneUnlocked(tree, owned),
        depths,
      };
    }
  }

  let vesselsView: VesselSectionView | null = null;
  if (active.kind === 'earned') {
    const ext = classExtractOf(h, opts.signatures);
    const list = active.entry.vessels ?? [];
    if (ext?.kind === 'blood' || list.length > 0) {
      const cap = ext?.kind === 'blood' ? ext.cap : VESSEL_CAP;
      vesselsView = {
        className: active.name,
        count: list.length,
        cap,
        totalPower: vesselTotalPower(list, cap),
        bonus: vesselBonus(list, cap),
        items: list.map((v, index) => ({
          index,
          name: v.name,
          rank: v.rank,
          kind: v.kind,
          power: vesselPower(v.rank, v.kind),
        })),
      };
    }
  }

  return {
    active,
    activeRarity: activeDef?.rarity ?? null,
    activeRarityLabel: activeDef ? CLASS_RARITY_LABEL[activeDef.rarity] : (active.kind === 'none' ? null : 'Custom'),
    activePairLabel: activeDef ? pairShortLabel(activeDef.pair) : null,
    activeRecRank: activeDef?.recRank ?? null,
    activeUnique: active.kind !== 'none' && isUniqueClass(active.name),
    swapPlan,
    swapLine: swapCostLine(swapPlan, h.gold),
    entries,
    vessels: vesselsView,
    tree: treeView,
    treeMissing,
    held: opts.held,
  };
}

/** One row in the GM unique-class registry UI. */
export type RegistryRowView = {
  readonly className: UniqueClassName;
  readonly rarity: 'epic' | 'mythic';
  readonly rarityLabel: string;
  readonly pairLabel: string;
  readonly recRank: string;
  readonly hasKit: boolean;
  readonly holder: ClassHolder | null;
  readonly holderName: string | null;
  readonly holderRemoved: boolean;
  readonly holderKindLabel: string | null;
  readonly inFight: boolean;
  /** In a room, whether `DOCS.holders` carries this class's local registry entry (`grantId` or absent). */
  readonly synced: boolean | null;
};

/** Complete pure presentation model for the GM unique-class registry section. */
export type RegistryViewModel = {
  readonly total: number;
  readonly heldCount: number;
  readonly summary: string;
  readonly inRoom: boolean;
  readonly rows: readonly RegistryRowView[];
};

const holderKindLabelOf = (h: ClassHolder): string =>
  (h.kind === 'local' ? CLASS_UI_WORDS.gmLocalKind : h.kind === 'remote' ? CLASS_UI_WORDS.gmRemoteKind : CLASS_UI_WORDS.gmNpcKind);

/** Builds the pure view-model for the GM's 18-class Unique Classes registry, cross-checking `DOCS.holders` when in a room. */
export function registryView(
  save: Pick<Save, 'classHolders' | 'hunters'>,
  opts: {
    readonly inRoom: boolean;
    readonly holdersDoc: HoldersDoc | null;
    readonly heldLocal: (hid: HunterId) => boolean;
    readonly heldRemote: (key: SheetKey) => boolean;
    readonly remotes?: readonly { readonly key: SheetKey; readonly name: string }[];
    readonly signatures?: ClassSignatureMap;
    readonly trees?: ClassTreeMap;
  },
): RegistryViewModel {
  const signatures = opts.signatures ?? CLASS_SIGNATURES;
  const trees = opts.trees ?? CLASS_TREES;
  const localNames = new Map(save.hunters.map(h => [h.id, h.name]));
  const remoteNames = new Map((opts.remotes ?? []).map(r => [r.key, r.name]));

  // Mythics first, then Epics (preserving BUILT_IN_CLASSES order within each tier).
  const ordered = [...UNIQUE_CLASS_NAMES].sort((a, b) => {
    const da = BUILT_IN_CLASSES[a];
    const db = BUILT_IN_CLASSES[b];
    if (da.rarity !== db.rarity) return da.rarity === 'mythic' ? -1 : 1;
    return 0;
  });

  let heldCount = 0;
  const rows: RegistryRowView[] = ordered.map(cls => {
    const def = BUILT_IN_CLASSES[cls];
    const hasKit = Boolean(signatures[cls] || trees[cls]);
    const holder = holderOf(save, cls);
    if (holder) heldCount++;
    let holderName: string | null = null;
    let holderRemoved = false;
    if (holder) {
      if (holder.kind === 'local') {
        const live = localNames.get(holder.hunterId);
        if (live !== undefined) holderName = live;
        else { holderName = `${holder.name}${CLASS_UI_WORDS.removedSuffix}`; holderRemoved = true; }
      } else if (holder.kind === 'remote') {
        holderName = remoteNames.get(holder.sheetKey) ?? holder.name;
      } else {
        holderName = holder.name;
      }
    }
    const inFight = holder
      ? (holder.kind === 'local' ? opts.heldLocal(holder.hunterId) : holder.kind === 'remote' ? opts.heldRemote(holder.sheetKey) : false)
      : false;
    let synced: boolean | null = null;
    if (opts.inRoom) {
      const docEntry = opts.holdersDoc?.held[cls];
      if (holder) {
        const expectedWho = holder.kind === 'remote' ? holder.sheetKey : 'gm';
        synced = !!opts.holdersDoc
          && opts.holdersDoc.registryId === save.classHolders.registryId
          && !!docEntry
          && docEntry.who === expectedWho
          && docEntry.grantId === holder.grantId;
      } else {
        synced = !!opts.holdersDoc
          && opts.holdersDoc.registryId === save.classHolders.registryId
          && !docEntry;
      }
    }
    return {
      className: cls,
      rarity: def.rarity === 'mythic' ? 'mythic' : 'epic',
      rarityLabel: CLASS_RARITY_LABEL[def.rarity],
      pairLabel: pairShortLabel(def.pair),
      recRank: def.recRank ?? (def.rarity === 'mythic' ? 'S' : 'A'),
      hasKit,
      holder,
      holderName,
      holderRemoved,
      holderKindLabel: holder ? holderKindLabelOf(holder) : null,
      inFight,
      synced,
    };
  });

  return {
    total: ordered.length,
    heldCount,
    summary: CLASS_UI_WORDS.gmSummary(heldCount, ordered.length),
    inRoom: opts.inRoom,
    rows,
  };
}
