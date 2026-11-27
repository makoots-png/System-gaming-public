// rise.ts: raising a fallen monster mid-fight (Arise: Wave 2 PR 2). Pure.
// A dead normal or elite monster corpse moves through a two-state machine (`open` -> `risen`): a failed Presence check
// leaves it open and untouched (`extraction` never mutates); a passed check marks `corpse.rose = true` and adds a risen
// `summon` row (`until: null`, `rose: corpse.id`) that fights until unreformed death, owner down/removed, eviction past
// `maxRisen`, or fight end.

import { RANKS, rankIdx } from '../rules.ts';
import type { Rules } from '../rules.ts';
import { above } from '../stats.ts';
import { NO_TWEAK } from '../hunter/derive.ts';
import { fatiguePast } from '../hunter/vitals.ts';
import { ARCHETYPE_ATTACKS } from '../registry/abilities.ts';
import type { CombatantId, RiseSpec } from './ability-types.ts';
import { typed } from './damage-type.ts';
import { liveAbility } from './live-status.ts';
import { modified } from './effect-ops.ts';
import type { Body, MonsterRow, OpRules, Origin } from './effect-ops.ts';
import { isUp } from './row-hp.ts';
import { NAME_MAX } from './fight-types.ts';
import type { NewRow } from './fight-types.ts';

const NAT_FAIL = 1;
const NAT_SUCCESS = 20;

export const RISE_STATES = ['open', 'risen'] as const;
export type RiseState = (typeof RISE_STATES)[number];
export type RiseEvent = { readonly type: 'fail' } | { readonly type: 'succeed' };
export type RiseEventType = RiseEvent['type'];

const TABLE: { readonly [S in RiseState]: { readonly [E in RiseEventType]: RiseState | null } } = {
  open: { fail: 'open', succeed: 'risen' },
  risen: { fail: null, succeed: null },
};

/** A corpse's rise state (`open` until Arise succeeds on it once). */
export const riseState = (b: Pick<MonsterRow, 'rose'>): RiseState => (b.rose ? 'risen' : 'open');

/** Next rise state after `event`, or null when the corpse already rose. */
export const riseStep = (s: RiseState, event: RiseEvent): RiseState | null => TABLE[s][event.type];

/** Whether `b` is an unrisen dead normal or elite monster corpse (never boss, mythic, shadow, or summon). */
export function canRiseCorpse(b: Body): b is MonsterRow {
  return b.kind === 'monster' && !isUp(b) && riseState(b) === 'open'
    && b.origin.kind === 'monster'
    && (b.origin.monsterKind === 'normal' || b.origin.monsterKind === 'elite');
}

/** How many distinct elite corpses have already been raised in this fight (even if a risen elite later died or was evicted). */
export function elitesRisen(rows: readonly Body[]): number {
  const ids = new Set<CombatantId>();
  for (const r of rows) {
    if (r.kind === 'monster' && r.rose && r.origin.kind === 'monster' && r.origin.monsterKind === 'elite') ids.add(r.id);
    if (r.kind === 'summon' && r.rose !== undefined && r.origin.kind === 'monster' && r.origin.monsterKind === 'elite') ids.add(r.rose);
  }
  return ids.size;
}

/** Whether `b` can be raised right now by an ability carrying `raise`, respecting the per-fight elite cap. */
export function canRiseFor(b: Body, rows: readonly Body[], raise: RiseSpec): b is MonsterRow {
  if (!canRiseCorpse(b)) return false;
  if (b.origin.kind === 'monster' && b.origin.monsterKind === 'elite' && elitesRisen(rows) >= raise.elitePerFight) return false;
  return true;
}

/** Whether any ability in the fight can raise corpse `b` (for fight-doc `canRise` and row priority). */
export function canRiseInFight(b: Body, rows: readonly Body[]): boolean {
  if (!canRiseCorpse(b)) return false;
  if (b.origin.kind === 'monster' && b.origin.monsterKind === 'elite') {
    const limit = rows.reduce((hi, r) => r.abilities.reduce((m, a) => (a.raise ? Math.max(m, a.raise.elitePerFight) : m), hi), 1);
    return elitesRisen(rows) < limit;
  }
  return true;
}

/**
 * DC to raise `corpse` mid-fight: matches `extractDc` (hunter/shadows.ts) using `RULES.shadow` so mid-fight Arise and
 * post-fight extraction stay on one scale without an import cycle through rows.ts.
 */
export function riseDc(user: Pick<Body, 'tier'>, corpse: Pick<Body, 'origin'>, R: Pick<Rules, 'shadow'>): number {
  const userRank = RANKS[Math.max(0, Math.min(RANKS.length - 1, user.tier))]!;
  const foeRank = corpse.origin.kind === 'monster' ? corpse.origin.rank : userRank;
  const foeKind = corpse.origin.kind === 'monster' ? corpse.origin.monsterKind : 'normal';
  const S = R.shadow;
  const kindDc = foeKind === 'boss' ? S.bossDc : foeKind === 'elite' ? S.eliteDc : 0;
  return Math.max(S.dcMin, S.dcBase + S.dcRank[foeRank] + S.dcPerRank * (rankIdx(foeRank) - rankIdx(userRank)) + kindDc);
}

/**
 * Presence check bonus for `user` casting `raise`: matches `checksOf` (hunter/sheet.ts) on Presence plus `raise.bonus`.
 */
export function riseBonus(user: Pick<Body, 'tier' | 'stats' | 'sheet' | 'fatigue'>, raise: RiseSpec, R: Pick<Rules, 'fight' | 'rankBonus' | 'fatigue'>): number {
  const rank = RANKS[Math.max(0, Math.min(RANKS.length - 1, user.tier))]!;
  const tired = fatiguePast(user.fatigue, user.sheet, R.fatigue.penaltyAt) ? R.fatigue.penalty : 0;
  return Math.floor(above(user.stats.pre, R.fight) / 2) + R.rankBonus[rank] - tired + raise.bonus;
}

/** Whether a natural d20 roll with `bonus` (plus optional GM roll `adjust` or `force`) passes `dc` (nat 20 always passes, nat 1 always fails without crumbling). */
export const risePassed = (d20: number, bonus: number, dc: number, adjust = 0, force: 1 | 20 | null = null): boolean => {
  const natural = force ?? d20;
  const effAdjust = force !== null ? 0 : adjust;
  return natural === NAT_SUCCESS || (natural !== NAT_FAIL && natural + bonus + effAdjust >= dc);
};

/**
 * Builds the fresh risen summon row for `corpse` raised by `user`: copies the corpse's monster origin (normal or elite,
 * rank-scaled tweak `{ hp: rankHp, dealt: rankDealt }`, no kill `type`), full HP and mana, archetype basic attack,
 * `until: null`, and `rose: corpse.id`.
 */
export function risenRow(user: Pick<Body, 'id' | 'side'>, corpse: MonsterRow, id: CombatantId, R: OpRules & Pick<Rules, 'conditions' | 'dice' | 'shadow'>): NewRow {
  const mo = corpse.origin;
  if (mo.kind !== 'monster') throw new Error('risenRow expects a monster origin');
  const tweak = { ...NO_TWEAK, hp: R.shadow.rankHp[mo.rank], dealt: R.shadow.rankDealt[mo.rank] };
  const origin: Origin = {
    kind: 'monster', name: mo.name, rank: mo.rank, archetype: mo.archetype, monsterKind: mo.monsterKind, tweak,
    ...(mo.icon ? { icon: mo.icon } : {}),
  };
  const { sheet } = modified(origin, [], R);
  const attack = liveAbility(typed(ARCHETYPE_ATTACKS[mo.archetype](R), R), R.conditions);
  const name = `Risen ${corpse.name}`.slice(0, NAME_MAX);
  return {
    id, name, side: user.side, kind: 'summon', origin, tier: rankIdx(mo.rank), place: null,
    life: { at: 'up', hp: sheet.hpMax }, mana: sheet.manaMax, fatigue: 0,
    shield: null, stagger: null, channel: null, threat: user.side === 'foe' ? {} : null,
    statuses: [], readyAt: {}, abilities: [attack], intent: null, holder: null, xp: 0, mythic: null,
    owner: user.id, until: null, rose: corpse.id,
  };
}
