// class-powers.ts: class signatures and the sole reader of `Hunter.classes[job].nodes` for combat and the sheet. Pure.
// Populated starting in PR 2 (Hemomancer and Necromancer). Empty in PR 1 while exposing the full folding seam and
// fight-doc worn status lookup (`classStatusDef`).
import { BONUS_KEYS } from '../rules.ts';
import type { BonusKey, Perk, Rules } from '../rules.ts';
import type { Scaler } from './scalers.ts';
import type { StatusDef } from '../combat/effect-ops.ts';
import type { Ability } from '../combat/ability-types.ts';
import { isClassName } from './jobs.ts';
import type { ClassName } from './jobs.ts';
import { CLASS_ACTIVES_MAX, CLASS_TREES, repairNodes } from './class-trees.ts';
import type { ClassTreeMap, ClassWorn } from './class-trees.ts';
import type { ClassLocker } from '../hunter/class-locker.ts';

/** Hunter slice read by `classPowers`. */
export type ClassPowersHunter = {
  readonly job: string | null;
  readonly jobDone: string | null;
  readonly classes: ClassLocker;
};

/** Base combat and sheet powers of one built-in class before skill-tree nodes are folded on top. */
export type ClassSignature = {
  readonly className: ClassName;
  readonly bonus?: Perk;
  readonly scalers?: readonly Scaler[];
  readonly worn?: ClassWorn;
  /** At most `CLASS_ACTIVES_MAX` (4) active abilities. */
  readonly actives?: readonly Ability[];
};

/** Folded class powers for the hunter's active awakened class. */
export type ClassPowersResult = {
  readonly bonus: Perk;
  readonly scalers: readonly Scaler[];
  readonly worn: ClassWorn | null;
  readonly actives: readonly Ability[];
};

export type ClassSignatureMap = Readonly<Partial<Record<ClassName, ClassSignature>>>;

/** Shipped class signatures. Empty in PR 1; populated starting in PR 2. */
export const CLASS_SIGNATURES: ClassSignatureMap = {};

const EMPTY_CLASS_POWERS: ClassPowersResult = { bonus: {}, scalers: [], worn: null, actives: [] };

/**
 * Folds the hunter's active class signature with bought tree nodes in **tree order** (not purchase order), only when
 * `h.jobDone === h.job` and `h.job` is earned in `h.classes`. Never yields more than `CLASS_ACTIVES_MAX` (4) actives
 * or more than 1 worn status. Sole reader of `nodes` for combat and the sheet.
 */
export function classPowers(
  h: ClassPowersHunter,
  _R: Rules,
  opts?: { readonly signatures?: ClassSignatureMap; readonly trees?: ClassTreeMap },
): ClassPowersResult {
  if (!h.job || h.jobDone !== h.job || !isClassName(h.job)) return EMPTY_CLASS_POWERS;
  const entry = h.classes[h.job];
  if (!entry) return EMPTY_CLASS_POWERS;

  const signatures = opts?.signatures ?? CLASS_SIGNATURES;
  const trees = opts?.trees ?? CLASS_TREES;
  const sig = signatures[h.job];
  const tree = trees[h.job] ?? null;
  if (!sig && !tree) return EMPTY_CLASS_POWERS;

  const bonus: Partial<Record<BonusKey, number>> = {};
  const addBonus = (p: Perk | undefined): void => {
    if (!p) return;
    for (const k of BONUS_KEYS) {
      const n = p[k];
      if (typeof n === 'number' && Number.isFinite(n) && n !== 0) {
        bonus[k] = (bonus[k] ?? 0) + n;
      }
    }
  };

  addBonus(sig?.bonus);
  const scalers: Scaler[] = sig?.scalers ? [...sig.scalers] : [];
  let worn: ClassWorn | null = sig?.worn ?? null;
  const actives: Ability[] = sig?.actives ? sig.actives.slice(0, CLASS_ACTIVES_MAX) : [];

  if (tree && entry.nodes.length > 0) {
    const owned = new Set(repairNodes(tree, entry.nodes));
    // Fold in tree order (not purchase order) so replacements and bonuses compose deterministically.
    for (const node of tree.nodes) {
      if (!owned.has(node.id)) continue;
      for (const gift of node.gifts) {
        switch (gift.kind) {
          case 'bonus':
            addBonus(gift.bonus);
            break;
          case 'scaler':
            scalers.push(gift.scaler);
            break;
          case 'replace-worn':
            if (worn && worn.key === gift.targetKey) worn = gift.worn;
            break;
          case 'replace-active': {
            const idx = actives.findIndex(a => a.id === gift.targetId);
            if (idx >= 0) actives[idx] = gift.active;
            break;
          }
        }
      }
    }
  }

  return { bonus, scalers, worn, actives };
}

/**
 * Looks up a registry class worn `StatusDef` by status key (either a base signature worn status or a tree node's
 * `replace-worn` upgrade), so fight docs can reference class worn defs by key instead of copying them in full.
 */
export function classStatusDef(
  key: string,
  signatures: ClassSignatureMap = CLASS_SIGNATURES,
  trees: ClassTreeMap = CLASS_TREES,
): StatusDef | null {
  for (const sig of Object.values(signatures)) {
    if (sig?.worn?.key === key) return sig.worn.def;
  }
  for (const tree of Object.values(trees)) {
    if (!tree) continue;
    for (const node of tree.nodes) {
      for (const gift of node.gifts) {
        if (gift.kind === 'replace-worn' && gift.worn.key === key) return gift.worn.def;
      }
    }
  }
  return null;
}
