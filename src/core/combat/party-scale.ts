// party-scale.ts: core party headcount and party-size scaling math read by the combat reducer (`fight.ts` at `start`
// and on mid-fight wave joins) and re-exported by `gates/party-scale.ts` for gate difficulty previews and solo runs.
// Pure.
import type { CombatantKind } from './effect-ops.ts';
import type { Side } from './space.ts';
import type { MonsterKind, Tweak } from '../hunter/derive.ts';
import { RULES } from '../rules.ts';
import type { Rank, Rules } from '../rules.ts';
import { npcPresetOf } from '../registry/npcs.ts';
import type { NpcTierPreset } from '../registry/npcs.ts';
import type { DifficultyScale } from '../gates/difficulty.ts';

/** Minimal combatant row shape read by `partyHeadcount`. Matches `Body`, `NewRow`, and preview rows. */
export type HeadcountRow = {
  readonly kind: CombatantKind;
  readonly side: Side;
  readonly npc?: unknown;
  readonly origin?: { readonly kind: string; readonly monsterKind?: MonsterKind; readonly tweak?: Tweak };
  readonly preset?: NpcTierPreset;
};

/** Preset of an ally NPC row (`preset` if explicit, else derived from its monster-shaped `origin`, else `standard`). */
function allyPresetOf(r: HeadcountRow, R: Pick<Rules, 'fight'>): NpcTierPreset {
  if (r.preset) return r.preset;
  const o = r.origin;
  if (o && o.kind === 'monster' && o.monsterKind && o.monsterKind !== 'mythic' && o.tweak) {
    return npcPresetOf({ tier: o.monsterKind, tweak: o.tweak }, R);
  }
  return 'standard';
}

/**
 * Weighted headcount fighting on the party's side: each player hunter (`kind === 'hunter'`, `side === 'party'`, not
 * an NPC) counts as 1, and each ally NPC counts as `R.fight.partyScale.allyWeight[preset]`. Excludes foe NPCs
 * (`side === 'foe'`), monsters, shadows, and timed or risen summons.
 */
export function partyHeadcount(rows: readonly HeadcountRow[], R: Pick<Rules, 'fight'> = RULES): number {
  let total = 0;
  const weights = R.fight.partyScale.allyWeight;
  for (const r of rows) {
    if (r.kind !== 'hunter' || r.side !== 'party') continue;
    total += r.npc || r.preset ? weights[allyPresetOf(r, R)] : 1;
  }
  return Math.round(total * 1000) / 1000;
}

/** Linearly interpolates `curve` (indexed 1..len) at `x >= 1`, extrapolating by `step` per unit past `len`. */
function interpCurve(curve: readonly number[], step: number, x: number): number {
  const len = curve.length;
  if (x >= len) return curve[len - 1]! + (x - len) * step;
  const lo = Math.floor(x);
  const frac = x - lo;
  const a = curve[lo - 1]!;
  return frac === 0 ? a : a + frac * (curve[lo]! - a);
}

/**
 * Multiplicative HP and outgoing-damage factors for a gate foe facing `headcount` weighted party members (`headcount`
 * clamped to at least 1, continuously interpolated between whole heads). Bosses read `partyScale.hp`/`dealt`; non-bosses
 * and foe NPCs read `packHp`/`packDealt`. Headcount 3 is pinned to exact `{ hp: 1, dealt: 1 }`. For `kind === 'boss'`
 * away from 3, smoothly unwinds the 3-hunter `difficulty.rankScale` so 1p, 2p, and 4-6p boss fights stay aligned across
 * ranks E through S.
 */
export function partyScaleFactor(
  headcount: number,
  kind: MonsterKind,
  rank: Rank,
  R: Pick<Rules, 'fight'>,
): DifficultyScale {
  const h = Math.max(1, Number.isFinite(headcount) ? headcount : 1);
  const cfg = R.fight.partyScale;
  const isBoss = kind === 'boss';
  const hp = interpCurve(isBoss ? cfg.hp : cfg.packHp, isBoss ? cfg.hpStep : cfg.packHpStep, h);
  const dealt = interpCurve(isBoss ? cfg.dealt : cfg.packDealt, isBoss ? cfg.dealtStep : cfg.packDealtStep, h);
  if (!isBoss || h === 3) return { hp, dealt };
  const rs = R.fight.difficulty.rankScale[rank];
  const weight = h < 3 ? Math.min(0.85, (3 - h) * 0.85) : Math.min(0.45, (h - 3) * 0.15);
  const undo = Math.pow(rs, -weight);
  const hpExp = R.fight.difficulty.hpExponent;
  return {
    hp: hp * Math.pow(undo, hpExp),
    dealt: dealt * Math.pow(undo, 1 - hpExp),
  };
}

/** Multiplies `scale` into a `Tweak`'s `hp` and `dealt`, preserving all other tweak fields. */
export function scaleTweak(tweak: Tweak, scale: DifficultyScale): Tweak {
  if (scale.hp === 1 && scale.dealt === 1) return tweak;
  return { ...tweak, hp: tweak.hp * scale.hp, dealt: tweak.dealt * scale.dealt };
}
