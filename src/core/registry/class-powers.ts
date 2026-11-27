// class-powers.ts: class signatures and the sole reader of `Hunter.classes[job].nodes` for combat and the sheet. Pure.
// Exposes the folding seam (`classPowers`) and fight-doc status lookup (`classStatusDef`).
import type { Rules } from '../rules.ts';
import type { Scaler } from './scalers.ts';
import type { LandOp, Op, StatusDef } from '../combat/effect-ops.ts';
import type { Ability } from '../combat/ability-types.ts';
import { isClassName } from './jobs.ts';
import type { ClassName } from './jobs.ts';
import { CLASS_ACTIVES_MAX, CLASS_BONUS_KEYS, CLASS_TREES, repairNodes } from './class-trees.ts';
import type { ClassBonusKey, ClassPerk, ClassTreeMap, ClassWorn, NodeGift } from './class-trees.ts';
import { HEMOMANCER_SIGNATURE } from './class-hemomancer.ts';
import { STARFORGER_SIGNATURE } from './class-starforger.ts';
import { NECROMANCER_SIGNATURE } from './class-necromancer.ts';
import { BLADEFIEND_SIGNATURE } from './class-bladefiend.ts';
import { RIFTHUNTER_SIGNATURE } from './class-rifthunter.ts';
import { NULLWEAVER_SIGNATURE } from './class-nullweaver.ts';
import { IRONCLAD_SIGNATURE } from './class-ironclad.ts';
import { PACKLORD_SIGNATURE } from './class-packlord.ts';
import { SERAPH_SIGNATURE } from './class-seraph.ts';
import { STORMCALLER_SIGNATURE } from './class-stormcaller.ts';
import { GRIMREAPER_SIGNATURE } from './class-grimreaper.ts';
import { CHRONOKEEPER_SIGNATURE } from './class-chronokeeper.ts';
import { VOIDSTALKER_SIGNATURE } from './class-voidstalker.ts';
import { BRAMBLEGUARD_SIGNATURE } from './class-brambleguard.ts';
import { PYROMANCER_SIGNATURE } from './class-pyromancer.ts';
import { SNIPER_SIGNATURE } from './class-sniper.ts';
import { BERSERKER_SIGNATURE } from './class-berserker.ts';
import { CLERIC_SIGNATURE } from './class-cleric.ts';
import { NIGHTBLADE_SIGNATURE } from './class-nightblade.ts';
import { BASTION_SIGNATURE } from './class-bastion.ts';
import { FIGHTER_SIGNATURE } from './class-fighter.ts';
import { ASSASSIN_SIGNATURE } from './class-assassin.ts';
import { MAGE_SIGNATURE } from './class-mage.ts';
import { TANKER_SIGNATURE } from './class-tanker.ts';
import { HEALER_SIGNATURE } from './class-healer.ts';
import { RANGER_SIGNATURE } from './class-ranger.ts';
import type { ClassLocker } from '../hunter/class-locker.ts';
import { vesselBonus } from '../hunter/blood-vessels.ts';
import type { StatKey } from '../stats.ts';

/** Declarative predatory-mythic corpse extraction aspect hook carried on `ClassSignature.extract`. */
export type ClassExtractSpec = {
  readonly kind: 'blood';
  /** Stat whose check bonus is rolled (`1d20 + checkBonus(h, stat, R) + adjust`). */
  readonly stat: StatKey;
  /** Maximum vessels stored on `ClassEntry.vessels`. */
  readonly cap: number;
  /** Fight phase required to extract (`'ended'` for post-fight-only blood extraction). */
  readonly phase: 'ended';
  /** Player-facing button label shown on defeated monster cards and the extraction modal confirm button. */
  readonly label: string;
};

/** Rule slice accepted by `classPowers` (satisfied by `Rules`, `SheetRules`, and `RowRules`). */
export type ClassPowersRules = Pick<Rules, 'fight' | 'dice'>;

/** Hunter slice read by `classPowers`. */
export type ClassPowersHunter = {
  readonly job: string | null;
  readonly jobDone: string | null;
  readonly classes: ClassLocker;
};

/** Base combat and sheet powers of one built-in class before skill-tree nodes are folded on top. */
export type ClassSignature = {
  readonly className: ClassName;
  readonly bonus?: ClassPerk;
  readonly scalers?: readonly Scaler[];
  readonly worn?: ClassWorn;
  /** At most `CLASS_ACTIVES_MAX` (4) active abilities. */
  readonly actives?: readonly Ability[];
  /** Extra class-defined statuses referenced by key (such as summon starting statuses) for `classStatusDef` and fight-doc lookup. */
  readonly statuses?: readonly ClassWorn[];
  /** Optional declarative corpse extraction aspect for predatory Mythics (e.g. Blood Extraction into Crimson Vessels). */
  readonly extract?: ClassExtractSpec;
};

/** Folded class powers for the hunter's active awakened class. */
export type ClassPowersResult = {
  readonly bonus: ClassPerk;
  readonly scalers: readonly Scaler[];
  readonly worn: ClassWorn | null;
  readonly actives: readonly Ability[];
};

export type ClassSignatureMap = Readonly<Partial<Record<ClassName, ClassSignature>>>;

/** Shipped class signatures. */
export const CLASS_SIGNATURES: ClassSignatureMap = {
  Hemomancer: HEMOMANCER_SIGNATURE,
  Starforger: STARFORGER_SIGNATURE,
  Necromancer: NECROMANCER_SIGNATURE,
  Bladefiend: BLADEFIEND_SIGNATURE,
  Rifthunter: RIFTHUNTER_SIGNATURE,
  Nullweaver: NULLWEAVER_SIGNATURE,
  Seraph: SERAPH_SIGNATURE,
  Ironclad: IRONCLAD_SIGNATURE,
  Packlord: PACKLORD_SIGNATURE,
  Stormcaller: STORMCALLER_SIGNATURE,
  Grimreaper: GRIMREAPER_SIGNATURE,
  Chronokeeper: CHRONOKEEPER_SIGNATURE,
  Voidstalker: VOIDSTALKER_SIGNATURE,
  Brambleguard: BRAMBLEGUARD_SIGNATURE,
  Pyromancer: PYROMANCER_SIGNATURE,
  Sniper: SNIPER_SIGNATURE,
  Berserker: BERSERKER_SIGNATURE,
  Cleric: CLERIC_SIGNATURE,
  Nightblade: NIGHTBLADE_SIGNATURE,
  Bastion: BASTION_SIGNATURE,
  Fighter: FIGHTER_SIGNATURE,
  Assassin: ASSASSIN_SIGNATURE,
  Mage: MAGE_SIGNATURE,
  Tanker: TANKER_SIGNATURE,
  Healer: HEALER_SIGNATURE,
  Ranger: RANGER_SIGNATURE,
};

const EMPTY_CLASS_POWERS: ClassPowersResult = { bonus: {}, scalers: [], worn: null, actives: [] };

/**
 * Folds the hunter's active class signature with bought tree nodes in **tree order** (not purchase order), only when
 * `h.jobDone === h.job` and `h.job` is earned in `h.classes`. Never yields more than `CLASS_ACTIVES_MAX` (4) actives
 * or more than 1 worn status. Sole reader of `nodes` for combat and the sheet.
 */
export function classPowers(
  h: ClassPowersHunter,
  _R: ClassPowersRules,
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

  const bonus: Partial<Record<ClassBonusKey, number>> = {};
  const addBonus = (p: ClassPerk | undefined): void => {
    if (!p) return;
    for (const k of CLASS_BONUS_KEYS) {
      const n = p[k];
      if (typeof n === 'number' && Number.isFinite(n) && n !== 0) {
        bonus[k] = (bonus[k] ?? 0) + n;
      }
    }
  };

  addBonus(sig?.bonus);
  if (sig?.extract?.kind === 'blood' && entry.vessels?.length) {
    addBonus(vesselBonus(entry.vessels, sig.extract.cap));
  }
  const scalers: Scaler[] = sig?.scalers ? [...sig.scalers] : [];
  let worn: ClassWorn | null = sig?.worn ?? null;
  const actives: Ability[] = sig?.actives ? sig.actives.slice(0, CLASS_ACTIVES_MAX) : [];
  const upgrades: Extract<NodeGift, { kind: 'upgrade-status' }>[] = [];

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
          case 'upgrade-status':
            upgrades.push(gift);
            break;
        }
      }
    }
  }

  // Status upgrades apply after every replacement, rewriting top-level `applyStatus` ops on folded `actives` only
  // (never recursing into `zone.ops`, `zone.end`, or nested status triggers).
  for (const up of upgrades) {
    for (let i = 0; i < actives.length; i++) {
      const a = actives[i]!;
      if (!a.ops.some(op => op.op === 'applyStatus' && op.key === up.targetKey)) continue;
      actives[i] = {
        ...a,
        ops: a.ops.map(op => (op.op === 'applyStatus' && op.key === up.targetKey ? { ...op, key: up.key, def: up.def } : op)),
      };
    }
  }

  return { bonus, scalers, worn, actives };
}

/** Collects every class worn status, active-applied status, and nested child status def keyed by status key. */
function buildClassStatusDefs(signatures: ClassSignatureMap, trees: ClassTreeMap): ReadonlyMap<string, StatusDef> {
  const out = new Map<string, StatusDef>();
  const recordOps = (ops: readonly (Op | LandOp)[]): void => {
    for (const op of ops) if (op.op === 'applyStatus') record(op.key, op.def);
  };
  const record = (key: string, def: StatusDef): void => {
    const prev = out.get(key);
    if (prev) {
      if (JSON.stringify(prev) !== JSON.stringify(def)) {
        throw new Error(`Duplicate class status key "${key}" with conflicting definitions`);
      }
      return;
    }
    out.set(key, def);
    for (const tr of def.triggers ?? []) recordOps(tr.ops);
    if ('stack' in def && def.stack?.threshold) recordOps(def.stack.threshold.ops);
    if (def.end) recordOps(def.end.ops);
  };
  for (const sig of Object.values(signatures)) {
    if (!sig) continue;
    if (sig.worn) record(sig.worn.key, sig.worn.def);
    for (const st of sig.statuses ?? []) record(st.key, st.def);
    for (const active of sig.actives ?? []) recordOps(active.ops);
  }
  for (const tree of Object.values(trees)) {
    if (!tree) continue;
    for (const node of tree.nodes) {
      for (const gift of node.gifts) {
        if (gift.kind === 'replace-worn') record(gift.worn.key, gift.worn.def);
        else if (gift.kind === 'replace-active') recordOps(gift.active.ops);
        else if (gift.kind === 'upgrade-status') record(gift.key, gift.def);
      }
    }
  }
  return out;
}

const DEFAULT_CLASS_STATUS_DEFS: ReadonlyMap<string, StatusDef> = buildClassStatusDefs(CLASS_SIGNATURES, CLASS_TREES);

/**
 * Looks up a registry class `StatusDef` by status key (a base signature worn status, a tree node's `replace-worn`
 * upgrade, an active's applied status, or any nested child status), so fight docs can reference shipped class defs by
 * key instead of copying them in full.
 */
export function classStatusDef(
  key: string,
  signatures: ClassSignatureMap = CLASS_SIGNATURES,
  trees: ClassTreeMap = CLASS_TREES,
): StatusDef | null {
  if (signatures === CLASS_SIGNATURES && trees === CLASS_TREES) {
    return DEFAULT_CLASS_STATUS_DEFS.get(key) ?? null;
  }
  return buildClassStatusDefs(signatures, trees).get(key) ?? null;
}

/** Looks up a built-in class's declarative `ClassExtractSpec` by class name, or null when that class has none. */
export function classExtractByName(
  name: string | null | undefined,
  signatures: ClassSignatureMap = CLASS_SIGNATURES,
): ClassExtractSpec | null {
  if (!name || !isClassName(name)) return null;
  return signatures[name]?.extract ?? null;
}

/**
 * Returns the declarative `ClassExtractSpec` of `h`'s active awakened class, or null when `h` has no active earned
 * class or its active class defines no extraction aspect.
 */
export function classExtractOf(
  h: ClassPowersHunter | null | undefined,
  signatures: ClassSignatureMap = CLASS_SIGNATURES,
): ClassExtractSpec | null {
  if (!h || !h.job || h.jobDone !== h.job || !isClassName(h.job)) return null;
  if (!Object.hasOwn(h.classes, h.job)) return null;
  return signatures[h.job]?.extract ?? null;
}
