// party-scale.ts: scales gate monsters (and foe NPCs) to the weighted party headcount actually fighting on the
// party's side (each player hunter = 1, each ally NPC weighted by its preset in `RULES.fight.partyScale.allyWeight`,
// never foe NPCs, shadows, or summons). Pure.
//
// Core `partyHeadcount`, `partyScaleFactor`, and `scaleTweak` live in `src/core/combat/party-scale.ts` so the combat
// reducer sizes fights at `start` without a peer-directory import cycle; this module re-exports them alongside gate
// difficulty combination (`gateFoeScale`, `scaleMonsterForParty`, `scaleNpcForParty`) and plain UI copy.
import type { RowMonster, RowNpc } from '../combat/rows.ts';
import type { Side } from '../combat/space.ts';
import type { Archetype, MonsterKind, Tweak } from '../hunter/derive.ts';
import { RULES } from '../rules.ts';
import type { Rank, Rules } from '../rules.ts';
import { npcPresetOf } from '../registry/npcs.ts';
import type { NpcTier, NpcTierPreset } from '../registry/npcs.ts';
import type { GateNpc } from './gate.ts';
import {
  difficultyFactor,
  effectiveBossLevel,
  effectiveGateLevel,
  scaleRowMonster,
} from './difficulty.ts';
import type { DifficultyLevel, DifficultyScale, GateDifficulty } from './difficulty.ts';
import { partyHeadcount, partyScaleFactor, scaleTweak } from '../combat/party-scale.ts';
import type { HeadcountRow } from '../combat/party-scale.ts';

export { partyHeadcount, partyScaleFactor, scaleTweak };
export type { HeadcountRow };

/** Resolved gate NPC entry read by `gateNpcHeadcountRows`. */
export type GateNpcHeadcountInput = Pick<GateNpc, 'side' | 'count'> & {
  readonly preset?: NpcTierPreset;
  readonly tier?: NpcTier;
  readonly tweak?: Tweak;
};

/**
 * Converts resolved gate NPC roster entries into `HeadcountRow` entries so `partyHeadcount` weights gate ally NPCs
 * by preset identically across the GM card preview, Start fight dialog, fight start, and solo runs (never counting foe NPCs).
 */
export function gateNpcHeadcountRows(
  npcs: readonly GateNpcHeadcountInput[],
  R: Pick<Rules, 'fight'> = RULES,
): HeadcountRow[] {
  const out: HeadcountRow[] = [];
  for (const entry of npcs) {
    const preset: NpcTierPreset | undefined = entry.side === 'party'
      ? (entry.preset ?? (entry.tier && entry.tweak ? npcPresetOf({ tier: entry.tier, tweak: entry.tweak }, R) : 'standard'))
      : undefined;
    for (let i = 0; i < entry.count; i++) {
      out.push(preset ? { kind: 'hunter', side: entry.side, npc: true, preset } : { kind: 'hunter', side: entry.side, npc: true });
    }
  }
  return out;
}

/** Multiplies two `{ hp, dealt }` scaling factors together. */
export const combineScales = (a: DifficultyScale, b: DifficultyScale): DifficultyScale =>
  ({ hp: a.hp * b.hp, dealt: a.dealt * b.dealt });

/** Combined gate difficulty and party-size scaling factor for one gate foe. */
export function gateFoeScale(
  kind: MonsterKind,
  rank: Rank,
  level: DifficultyLevel,
  headcount: number,
  R: Pick<Rules, 'fight'>,
  archetype: Archetype = 'brute',
): DifficultyScale {
  return combineScales(
    difficultyFactor(kind, rank, level, R, archetype),
    partyScaleFactor(headcount, kind, rank, R),
  );
}

/** Scales monster `m` for `gate` (by `role`: pack or boss) and `headcount` people on the party's side. */
export function scaleMonsterForParty<
  M extends Pick<RowMonster, 'kind' | 'rank' | 'tweak'> & Partial<Pick<RowMonster, 'archetype'>>,
>(
  m: M,
  gate: { readonly difficulty: GateDifficulty },
  role: 'pack' | 'boss',
  headcount: number,
  R: Pick<Rules, 'fight'>,
): M & { readonly tweak: RowMonster['tweak'] } {
  const level = role === 'boss' ? effectiveBossLevel(gate.difficulty, R) : effectiveGateLevel(gate.difficulty, R);
  return scaleRowMonster(m, gateFoeScale(m.kind, m.rank, level, headcount, R, m.archetype ?? 'brute'));
}

/** Multiplies `scale` into a `RowNpc`'s `tweak.hp` and `tweak.dealt`, preserving all other tweak fields. */
export function scaleRowNpc<N extends Pick<RowNpc, 'tweak'>>(n: N, scale: DifficultyScale | undefined): N {
  if (!scale || (scale.hp === 1 && scale.dealt === 1)) return n;
  return { ...n, tweak: scaleTweak(n.tweak, scale) };
}

/**
 * Scales NPC `n` for `gate` on `side` facing `headcount` people on the party's side: only foe NPCs (`side === 'foe'`)
 * take gate difficulty and party-size scaling via `gateFoeScale('normal', ...)` (the pack curve, so Boss-tier foe NPCs
 * never stack the lone-boss `k = 4.08` multiplier alongside a gate's actual boss). Ally NPCs (`side === 'party'`) return
 * unchanged so raising gate difficulty or headcount never buffs the party's allies.
 */
export function scaleNpcForParty<N extends Pick<RowNpc, 'tier' | 'rank' | 'archetype' | 'tweak'>>(
  n: N,
  side: Side,
  gate: { readonly difficulty: GateDifficulty },
  headcount: number,
  R: Pick<Rules, 'fight'>,
): N {
  if (side !== 'foe') return n;
  const level = effectiveGateLevel(gate.difficulty, R);
  return scaleRowNpc(n, gateFoeScale('normal', n.rank, level, headcount, R, n.archetype));
}

/** Formats a clamped weighted headcount (`1`, `1.2`, `3`) for plain copy. */
function headWords(headcount: number): { readonly count: string; readonly noun: 'person' | 'people' } {
  const n = Math.max(1, Number.isFinite(headcount) ? Math.round(headcount * 100) / 100 : 1);
  return { count: String(n), noun: n === 1 ? 'person' : 'people' };
}

/** Plain words for the GM gate card and Start fight dialog (voice.md). */
export const PARTY_SCALE_WORDS = {
  cardSize: (headcount: number): string => {
    const { count, noun } = headWords(headcount);
    return `Sized for ${count} ${noun} (hunters and ally NPCs). Scales to who joins when you start the fight.`;
  },
  cardLocked: (headcount: number): string => {
    const { count, noun } = headWords(headcount);
    return `Fight sized for ${count} ${noun}. Late joins do not resize it.`;
  },
  dialogSize: (headcount: number): string => {
    const { count, noun } = headWords(headcount);
    return `Gate monsters scale for ${count} ${noun} when the fight starts.`;
  },
  dialogLocked: (headcount: number): string => {
    const { count, noun } = headWords(headcount);
    return `Fight stays sized for ${count} ${noun}. Joining now will not resize it.`;
  },
  alliesLegend: 'Ally NPCs',
} as const;
