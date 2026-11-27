// usurp.ts: proactive ability copy (Wave 5 Hook H3). Copies a caught foe's standing mythic omen landing move (via
// `mythicMove`), or else its highest-average damaging ability evaluated on the user's body (ties broken by list order),
// sanitizes it to scaled damage plus non-`mythic-*` target-facing statuses hard-capped to `kit.wardRounds` (even after
// potency scaling on control statuses), and lands it on the foe at formula averages via `landOps` with zero dice rolls
// and zero row/doc state. Event ruling (`fight.ts:landed`): the copy raises `kill`, `armyKill`, `down`, `imposed`, and
// `statusGained` only; it raises no `hitDealt` or `struck`, sets off no reaction, adds no threat, and adds nothing to
// the tally's `dealt` (matching a trigger's damage).

import { average } from '../formula.ts';
import type { Formula, Scope } from '../formula.ts';
import { formulaOf } from '../registry/ability-kinds.ts';
import { mythicMove } from '../registry/mythic-moves.ts';
import type { MythicRules } from '../registry/mythic-moves.ts';
import { USURP_AMP_MIN } from './ability-types.ts';
import type { Ability, CombatantId } from './ability-types.ts';
export { USURP_AMP_MIN };
import { damageTypeOf, isDamage } from './damage-type.ts';
import { isControl, lasting } from './effect-ops.ts';
import type { Body, LandOp, OpRules, StatusKey } from './effect-ops.ts';
import { clamp, kitOf, landOps } from './land.ts';
import { landingMove } from './mythic.ts';
import { isMythicStatusKey } from './mythic-types.ts';
import { atTier } from './op-amount.ts';
import { tick } from './timeline.ts';
import type { Tick } from './timeline.ts';

/** The rule numbers `usurpCopy` reads: fight/kit rules for landing and mythic/kind rules for building omen moves. */
export type UsurpRules = OpRules & MythicRules;

/** What a proactive `usurpCopy` landed on `target`. */
export type UsurpResult = {
  readonly copied: Ability;
  readonly fromOmen: boolean;
  readonly target: Body;
  readonly dealt: number;
  readonly down: boolean;
  readonly gained: readonly StatusKey[];
};

/**
 * Selects the move `user` copies from `target`: the standing mythic omen's `landingMove` built via `mythicMove` when
 * `target` has an active omen, else `target`'s damaging ability with the highest formula average evaluated on `user`'s
 * body (ties broken by list order). Returns null when `target` has neither.
 */
function selectUsurpMove(user: Body, target: Body, R: UsurpRules): { readonly ability: Ability; readonly fromOmen: boolean } | null {
  const s = target.mythic;
  if (s && s.at !== 'calm' && target.origin.kind === 'monster') {
    const lm = landingMove(s);
    if (lm) {
      const o = target.origin;
      return {
        ability: mythicMove(lm.key, lm.move, { rank: o.rank, archetype: o.archetype, kind: o.monsterKind, tweak: o.tweak }, R),
        fromOmen: true,
      };
    }
  }
  const scope: Scope = {
    user: { stats: user.stats, sheet: user.sheet },
    target: { stats: target.stats, sheet: target.sheet },
    charge: 0,
    kit: kitOf(user, target, R),
  };
  let best: Ability | null = null;
  let bestAvg = -Infinity;
  for (const ability of target.abilities) {
    if (!ability.effect || !isDamage(ability.effect.type)) continue;
    const f = formulaOf(ability, R);
    if (!f) continue;
    const avg = average(f, scope);
    if (best === null || avg > bestAvg) {
      best = ability;
      bestAvg = avg;
    }
  }
  return best ? { ability: best, fromOmen: false } : null;
}

/**
 * Builds the sanitized `LandOp[]` for a copied move: scaled damage (using `amp` clamped to `USURP_AMP_MIN`..`kit.critSizeMax`)
 * plus non-`mythic-*` `applyStatus` ops whose final duration on `target` is hard-capped at `R.fight.kit.wardRounds`
 * rounds (scaling the base duration down for `isControl` defs when `user`'s potency would otherwise push `lasting` past
 * the cap). Strips zones, summons, movement, zone acts, corpse raises, non-status ops, and any `mythic-*` self or phase
 * statuses.
 */
function sanitizeCopiedOps(copied: Ability, user: Body, target: Body, amp: number, R: UsurpRules): LandOp[] {
  const ops: LandOp[] = [];
  const scale = Number.isFinite(amp) ? clamp(amp, USURP_AMP_MIN, R.fight.kit.critSizeMax) : USURP_AMP_MIN;
  if (copied.effect && isDamage(copied.effect.type)) {
    const f = formulaOf(copied, R);
    if (f) {
      const scaled: Formula = { kind: 'binary', op: '*', left: { kind: 'number', value: scale }, right: f };
      ops.push({ op: 'damage', type: damageTypeOf(copied.id, copied.effect.type, R), amount: scaled, when: 'use' });
    }
  }
  const maxDuration = tick(R.fight.kit.wardRounds * R.fight.round);
  if (maxDuration > 0) {
    for (const op of copied.ops) {
      if (op.op !== 'applyStatus' || isMythicStatusKey(op.key)) continue;
      const base = op.duration === null ? maxDuration : atTier(op.duration, user.tier);
      let duration = tick(Math.min(base, maxDuration));
      if (isControl(op.def, user.tier) && lasting(op.def, duration, user.tier, user.sheet.potency, target.sheet.tenacity) > maxDuration) {
        let scaled = Math.floor(maxDuration * (100 + target.sheet.tenacity) / (100 + user.sheet.potency));
        while (scaled > 0 && lasting(op.def, tick(scaled), user.tier, user.sheet.potency, target.sheet.tenacity) > maxDuration) scaled--;
        duration = tick(scaled);
      }
      if (duration <= 0) continue;
      ops.push({
        op: 'applyStatus',
        key: op.key,
        def: op.def,
        duration,
        ...(op.stacks === undefined ? {} : { stacks: op.stacks }),
        ...(op.follow ? { follow: true as const } : {}),
      });
    }
  }
  return ops;
}

/**
 * Copies `target`'s standing mythic omen move (or strongest damaging ability on `user`'s body), sanitizes it to scaled
 * damage and hard-capped target-facing statuses, and resolves it on `target` from `user` at formula averages via
 * `landOps`. Returns null if `target` has no copyable move.
 */
export function usurpCopy(user: Body, target: Body, amp: number, now: Tick, R: UsurpRules): UsurpResult | null {
  const picked = selectUsurpMove(user, target, R);
  if (!picked) return null;
  const ops = sanitizeCopiedOps(picked.ability, user, target, amp, R);
  if (!ops.length) return null;
  const rows = new Map<CombatantId, Body>([[user.id, user], [target.id, target]]);
  const res = landOps(rows, ops, user, [target.id], { id: user.id, tier: user.tier }, now, R);
  const landed = res.landed[0];
  return {
    copied: picked.ability,
    fromOmen: picked.fromOmen,
    target: rows.get(target.id)!,
    dealt: landed?.dealt ?? 0,
    down: landed?.down ?? false,
    gained: landed?.gained ?? [],
  };
}
