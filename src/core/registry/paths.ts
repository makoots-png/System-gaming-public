// paths.ts: the build paths, one typed table. rules.ts serves it as RULES.paths, so a GM's rulesOverrides.paths still
// changes or adds to it. To add a path or change a perk: edit an entry here and run `bun run test` (tests/paths.test.ts
// checks every path against the tier budget).
import type { Perk } from '../rules.ts';
import type { StatKey } from '../stats.ts';

/** Two perks of equal value: the hunter picks one when the tier opens. */
export type Tier = readonly [Perk, Perk];
/**
 * A build path. Tier i opens at rank RANKS[i] (E, D, C, B, A, S = levels 1, 10, 20, 35, 50, 70), so a path has six,
 * a tuple: a path with five or seven does not compile. `alloc` weighs where Auto places free points.
 */
export type PathDef = { name: string; alloc: Partial<Record<StatKey, number>>; tiers: readonly [Tier, Tier, Tier, Tier, Tier, Tier] };

/**
 * What a perk is worth: 1 stat point = 1, 10 max HP = 1, 1 max mana = 1. A tier's two perks are each worth its budget:
 * 2, 2, 3, 3, 4, 4, one title's worth per tier. Max mana is a fifth of the old MP, so an old perk of N MP (worth N / 5) is
 * N / 5 mana at the same worth.
 */
export const PERK_VALUE = { stat: 1, hpMax: 1 / 10, manaMax: 1 } as const;
export const TIER_BUDGET = [2, 2, 3, 3, 4, 4] as const;

// Restated on the eight stats by docs/agent-handoff/rw/m2-plan.md section 3.4. Each alloc is the design's build where one
// exists (Vanguard the bruiser, Striker the speed build, Arcanist the cannon, Warden a tank that resists magic, Sovereign
// the support), and each perk maps its keys as its path's alloc did. An old AC perk of N (worth 2N) is the path's second
// stat at 2N, and an old MP perk of N is N / 5 mana, so every tier keeps its budget.
const PATHS = {
  vanguard: { name: 'Vanguard', alloc: { str: 2, vit: 1 }, tiers: [[{ str: 2 }, { hpMax: 20 }], [{ str: 1, vit: 1 }, { vit: 2 }], [{ str: 3 }, { hpMax: 30 }], [{ str: 2, vit: 1 }, { vit: 3 }], [{ str: 4 }, { hpMax: 40 }], [{ str: 2, vit: 2 }, { vit: 4 }]] },
  striker: { name: 'Striker', alloc: { agi: 2, str: 1 }, tiers: [[{ agi: 2 }, { str: 2 }], [{ agi: 1, str: 1 }, { hpMax: 20 }], [{ agi: 3 }, { agi: 1, str: 2 }], [{ agi: 2, str: 1 }, { hpMax: 30 }], [{ agi: 4 }, { str: 4 }], [{ agi: 2, str: 2 }, { hpMax: 40 }]] },
  arcanist: { name: 'Arcanist', alloc: { pow: 2, ctl: 1 }, tiers: [[{ pow: 2 }, { manaMax: 2 }], [{ pow: 1, ctl: 1 }, { hpMax: 20 }], [{ pow: 3 }, { manaMax: 3 }], [{ pow: 2, ctl: 1 }, { pow: 1, ctl: 2 }], [{ pow: 4 }, { manaMax: 4 }], [{ pow: 2, ctl: 2 }, { hpMax: 40 }]] },
  warden: { name: 'Warden', alloc: { vit: 2, dis: 1 }, tiers: [[{ vit: 2 }, { dis: 2 }], [{ vit: 1, dis: 1 }, { hpMax: 20 }], [{ vit: 3 }, { dis: 3 }], [{ vit: 2, dis: 1 }, { hpMax: 30 }], [{ vit: 4 }, { dis: 4 }], [{ vit: 2, dis: 2 }, { hpMax: 40 }]] },
  // No design build invests Instinct first: the plain stat map (wis Instinct, dex Agility).
  seeker: { name: 'Seeker', alloc: { ins: 2, agi: 1 }, tiers: [[{ ins: 2 }, { agi: 2 }], [{ ins: 1, agi: 1 }, { hpMax: 20 }], [{ ins: 3 }, { agi: 3 }], [{ ins: 2, agi: 1 }, { manaMax: 3 }], [{ ins: 4 }, { agi: 4 }], [{ ins: 2, agi: 2 }, { hpMax: 40 }]] },
  sovereign: { name: 'Sovereign', alloc: { pre: 2, dis: 1 }, tiers: [[{ pre: 2 }, { manaMax: 2 }], [{ pre: 1, dis: 1 }, { hpMax: 20 }], [{ pre: 3 }, { dis: 3 }], [{ pre: 2, dis: 1 }, { manaMax: 3 }], [{ pre: 4 }, { hpMax: 40 }], [{ pre: 2, dis: 2 }, { dis: 4 }]] },
} satisfies Record<string, PathDef>;

export type PathId = keyof typeof PATHS;
/** Every built-in path by id, in the order the build screen lists them. */
export const BUILT_IN_PATHS: Readonly<Record<PathId, PathDef>> = PATHS;
