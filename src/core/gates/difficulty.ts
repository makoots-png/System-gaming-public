// difficulty.ts: gate and boss difficulty (1 to 10, default 5), its two-region state machine, multiplicative monster
// scaling, and plain words. Pure.
//
// One writer for `Gate.difficulty`: every change moves through `difficultyStep` (`GATE_TABLE` and `BOSS_TABLE`), applied
// via `withDifficulty` (spawn and edit) or `gateDifficulty` (standalone save step). `gate.ts` only initializes
// `DEFAULT_DIFFICULTY` in `newGate`, reads it with `parseGateDifficulty` in `parseGate`, and copies it in `fieldsOf`.
import type { GateId } from '../ids.ts';
import type { Archetype, MonsterKind } from '../hunter/derive.ts';
import type { Rank, Rules } from '../rules.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import type { RowMonster } from '../combat/rows.ts';

export const DIFFICULTY_MIN = 1;
export const DIFFICULTY_MAX = 10;
export const DIFFICULTY_DEFAULT = 5;

export const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

export const GATE_DIFFICULTY_STATES = ['default', 'set'] as const;
export type GateDifficultyState = (typeof GATE_DIFFICULTY_STATES)[number];

export const BOSS_DIFFICULTY_STATES = ['follows', 'own'] as const;
export type BossDifficultyState = (typeof BOSS_DIFFICULTY_STATES)[number];

/** Whether a gate uses the rule's default difficulty or a level explicitly set by the GM. */
export type GateTrack =
  | { readonly at: 'default' }
  | { readonly at: 'set'; readonly level: DifficultyLevel };

/** Whether a gate's boss follows the gate's difficulty or carries its own override. */
export type BossTrack =
  | { readonly at: 'follows' }
  | { readonly at: 'own'; readonly level: DifficultyLevel };

/** Explicit two-region state stored on `GateFields.difficulty`. */
export type GateDifficulty = {
  readonly gate: GateTrack;
  readonly boss: BossTrack;
};

export const DEFAULT_DIFFICULTY: GateDifficulty = {
  gate: { at: 'default' },
  boss: { at: 'follows' },
};

/** Multiplicative HP and outgoing-damage factors applied to a monster row entering a fight. */
export type DifficultyScale = {
  readonly hp: number;
  readonly dealt: number;
};

export const DIFFICULTY_EVENTS = ['setGate', 'resetGate', 'setBoss', 'followGate', 'bossRemoved'] as const;
export type DifficultyEventType = (typeof DIFFICULTY_EVENTS)[number];

/** What can move a gate's difficulty state. */
export type DifficultyEvent =
  | { readonly type: 'setGate'; readonly level: DifficultyLevel }
  | { readonly type: 'resetGate' }
  | { readonly type: 'setBoss'; readonly level: DifficultyLevel }
  | { readonly type: 'followGate' }
  | { readonly type: 'bossRemoved' };

/** Why a standalone save step on a gate's difficulty refused to write. */
export type DifficultyRefusal = 'missing' | 'gate-done' | 'refused';

/** Reads a whole difficulty level in 1..10, or null for anything outside it. */
export function parseDifficultyLevel(v: unknown): DifficultyLevel | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < DIFFICULTY_MIN || v > DIFFICULTY_MAX) return null;
  return v as DifficultyLevel;
}

// ── transition tables (two independent regions) ──
type GateFn<E extends DifficultyEventType> = (g: GateTrack, e: Extract<DifficultyEvent, { type: E }>) => GateTrack | null;
type BossFn<E extends DifficultyEventType> = (b: BossTrack, e: Extract<DifficultyEvent, { type: E }>) => BossTrack | null;

const setGateFn: GateFn<'setGate'> = (g, e) => {
  const level = parseDifficultyLevel(e.level);
  if (level === null) return null;
  if (g.at === 'set' && g.level === level) return null;
  return { at: 'set', level };
};
const resetGateFn: GateFn<'resetGate'> = g => (g.at === 'set' ? { at: 'default' } : null);
const keepGate = (g: GateTrack): GateTrack => g;

/** Region 1: gate difficulty (`default` vs `set`). `null` refuses the event. */
export const GATE_TABLE: { readonly [S in GateDifficultyState]: { readonly [E in DifficultyEventType]: GateFn<E> | null } } = {
  default: { setGate: setGateFn, resetGate: null, setBoss: keepGate, followGate: keepGate, bossRemoved: keepGate },
  set: { setGate: setGateFn, resetGate: resetGateFn, setBoss: keepGate, followGate: keepGate, bossRemoved: keepGate },
};

const setBossFn: BossFn<'setBoss'> = (b, e) => {
  const level = parseDifficultyLevel(e.level);
  if (level === null) return null;
  if (b.at === 'own' && b.level === level) return null;
  return { at: 'own', level };
};
const toFollows = (b: BossTrack): BossTrack | null => (b.at === 'own' ? { at: 'follows' } : null);
const keepBoss = (b: BossTrack): BossTrack => b;

/** Region 2: boss difficulty (`follows` vs `own`). `null` refuses the event. */
export const BOSS_TABLE: { readonly [S in BossDifficultyState]: { readonly [E in DifficultyEventType]: BossFn<E> | null } } = {
  follows: { setGate: keepBoss, resetGate: keepBoss, setBoss: setBossFn, followGate: null, bossRemoved: null },
  own: { setGate: keepBoss, resetGate: keepBoss, setBoss: setBossFn, followGate: toFollows, bossRemoved: toFollows },
};

/** `state` after `event`, or null when the event is refused or changes nothing. */
export function difficultyStep(state: GateDifficulty, event: DifficultyEvent): GateDifficulty | null {
  const gStep = GATE_TABLE[state.gate.at][event.type] as GateFn<DifficultyEventType> | null;
  const bStep = BOSS_TABLE[state.boss.at][event.type] as BossFn<DifficultyEventType> | null;
  if (!gStep || !bStep) return null;
  const gate = gStep(state.gate, event);
  const boss = bStep(state.boss, event);
  if (!gate || !boss) return null;
  return { gate, boss };
}

// ── the one writer of Gate.difficulty ──
/** Applies `events` sequentially to `gate.difficulty`, skipping refused/no-op events. */
export function withDifficulty<G extends { readonly difficulty: GateDifficulty }>(
  gate: G,
  events: readonly DifficultyEvent[],
): G {
  let cur = gate.difficulty;
  for (const event of events) {
    const next = difficultyStep(cur, event);
    if (next) cur = next;
  }
  return cur === gate.difficulty ? gate : { ...gate, difficulty: cur };
}

/**
 * Applies standalone difficulty event `event` to gate `gateId` in `save`.
 * Refuses `missing` when the gate is absent, `gate-done` when cleared or closed, and `refused` when `difficultyStep` refuses.
 */
export function gateDifficulty<
  G extends { readonly id: GateId; readonly status: string; readonly difficulty: GateDifficulty },
  S extends { readonly gates: readonly G[] },
>(save: S, gateId: GateId, event: DifficultyEvent): S | Refused<DifficultyRefusal> {
  const at = save.gates.findIndex(g => g.id === gateId);
  if (at < 0) return refuse('missing');
  const g = save.gates[at]!;
  if (g.status === 'cleared' || g.status === 'closed') return refuse('gate-done');
  const next = difficultyStep(g.difficulty, event);
  if (!next) return refuse('refused');
  return { ...save, gates: save.gates.map((x, i) => (i === at ? { ...x, difficulty: next } : x)) };
}

// ── effective levels and scaling math ──
const ruleDefault = (R: Pick<Rules, 'fight'>): DifficultyLevel =>
  parseDifficultyLevel(R.fight.difficulty.default) ?? DIFFICULTY_DEFAULT;

/** The gate's effective difficulty level (1..10): its pinned level, or the rule's default. */
export const effectiveGateLevel = (d: GateDifficulty, R: Pick<Rules, 'fight'>): DifficultyLevel =>
  (d.gate.at === 'set' ? d.gate.level : ruleDefault(R));

/** The boss's effective difficulty level (1..10): its own override, or the gate's effective level. */
export const effectiveBossLevel = (d: GateDifficulty, R: Pick<Rules, 'fight'>): DifficultyLevel =>
  (d.boss.at === 'own' ? d.boss.level : effectiveGateLevel(d, R));

/** Displayed expected three-hunter win chance (%) for `level`, read from `R.fight.difficulty.targets`. */
export const targetWinPct = (level: DifficultyLevel, R: Pick<Rules, 'fight'>): number =>
  R.fight.difficulty.targets[level - 1] ?? R.fight.difficulty.targets[DIFFICULTY_DEFAULT - 1]!;

/**
 * Multiplicative HP and outgoing-damage factors for a monster of `kind`, `rank`, and `archetype` at `level`.
 * Bosses read `boss[level - 1] * rankScale[rank] * archetypeScale[archetype]` for levels 1..5 and compress the upper
 * ratio `(boss[level - 1] / boss[4])^rankSpread[rank]` above default level 5; normals, elites, and mythics read `pack[level - 1]`.
 */
export function difficultyFactor(
  kind: MonsterKind,
  rank: Rank,
  level: DifficultyLevel,
  R: Pick<Rules, 'fight'>,
  archetype: Archetype = 'brute',
): DifficultyScale {
  const cfg = R.fight.difficulty;
  let k: number;
  if (kind === 'boss') {
    const base = cfg.rankScale[rank] * cfg.archetypeScale[archetype];
    const step = level <= DIFFICULTY_DEFAULT
      ? cfg.boss[level - 1]!
      : Math.pow(cfg.boss[DIFFICULTY_DEFAULT - 1]!, 1 - cfg.rankSpread[rank]) * Math.pow(cfg.boss[level - 1]!, cfg.rankSpread[rank]);
    k = base * step;
  } else {
    k = cfg.pack[level - 1]!;
  }
  if (k === 1) return { hp: 1, dealt: 1 };
  return { hp: Math.pow(k, cfg.hpExponent), dealt: Math.pow(k, 1 - cfg.hpExponent) };
}

/** Multiplies `scale` into a `RowMonster`'s `tweak.hp` and `tweak.dealt`, preserving all other tweak fields. */
export function scaleRowMonster<M extends Pick<RowMonster, 'tweak'>>(m: M, scale: DifficultyScale | undefined): M & { readonly tweak: RowMonster['tweak'] } {
  if (!scale || (scale.hp === 1 && scale.dealt === 1)) return m;
  const hp = (m.tweak.hp ?? 1) * scale.hp;
  const dealt = (m.tweak.dealt ?? 1) * scale.dealt;
  return { ...m, tweak: { ...m.tweak, hp, dealt } };
}

/** Scales monster `m` for `gate` according to its role (`pack` uses gate level, `boss` uses boss level). */
export function scaleMonsterForGate<M extends Pick<RowMonster, 'kind' | 'rank' | 'tweak'> & Partial<Pick<RowMonster, 'archetype'>>>(
  m: M,
  gate: { readonly difficulty: GateDifficulty },
  role: 'pack' | 'boss',
  R: Pick<Rules, 'fight'>,
): M & { readonly tweak: RowMonster['tweak'] } {
  const level = role === 'boss' ? effectiveBossLevel(gate.difficulty, R) : effectiveGateLevel(gate.difficulty, R);
  return scaleRowMonster(m, difficultyFactor(m.kind, m.rank, level, R, m.archetype ?? 'brute'));
}

// ── boundary parser ──
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

function parseGateTrack(v: unknown): GateTrack {
  if (!isObj(v) || v.at !== 'set') return { at: 'default' };
  const level = parseDifficultyLevel(v.level);
  return level === null ? { at: 'default' } : { at: 'set', level };
}

function parseBossTrack(v: unknown): BossTrack {
  if (!isObj(v) || v.at !== 'own') return { at: 'follows' };
  const level = parseDifficultyLevel(v.level);
  return level === null ? { at: 'follows' } : { at: 'own', level };
}

/** Reads a stored `GateDifficulty` at the boundary. Missing or corrupted tracks fall back cleanly per region. */
export function parseGateDifficulty(v: unknown): GateDifficulty {
  if (!isObj(v)) return DEFAULT_DIFFICULTY;
  return { gate: parseGateTrack(v.gate), boss: parseBossTrack(v.boss) };
}

// ── plain words (every number read from RULES) ──
/** Plain, literal phrases for gate and boss difficulty controls, cards, and refusals. */
export const DIFFICULTY_WORDS = {
  gateLabel: 'Gate difficulty',
  bossToggle: 'This boss has its own difficulty',
  bossLabel: 'Boss difficulty',
  resetLabel: (R: Pick<Rules, 'fight'>): string =>
    `Reset to default, ${ruleDefault(R)} of ${DIFFICULTY_MAX}`,
  gateReadout: (level: DifficultyLevel, R: Pick<Rules, 'fight'>): string =>
    `Difficulty ${level} of ${DIFFICULTY_MAX}: three hunters of this rank win about ${targetWinPct(level, R)}% of the time.`,
  bossFollowReadout: (gateLevel: DifficultyLevel, R: Pick<Rules, 'fight'>): string =>
    `This boss follows the gate difficulty, ${gateLevel} of ${DIFFICULTY_MAX}: three hunters of this rank win about ${targetWinPct(gateLevel, R)}% of the time.`,
  bossOwnReadout: (level: DifficultyLevel, R: Pick<Rules, 'fight'>): string =>
    `Boss difficulty ${level} of ${DIFFICULTY_MAX}: three hunters of this rank win about ${targetWinPct(level, R)}% of the time.`,
  cardSummary: (d: GateDifficulty, hasBoss: boolean, R: Pick<Rules, 'fight'>): string => {
    const g = effectiveGateLevel(d, R);
    const gPct = targetWinPct(g, R);
    if (hasBoss && d.boss.at === 'own') {
      const b = d.boss.level;
      const bPct = targetWinPct(b, R);
      return `Gate difficulty ${g} of ${DIFFICULTY_MAX}: three hunters of this rank win about ${gPct}% of the time. This boss has its own difficulty, ${b} of ${DIFFICULTY_MAX}: three hunters of this rank win about ${bPct}% of the time.`;
    }
    if (d.gate.at === 'default') {
      return `Difficulty ${g} of ${DIFFICULTY_MAX}, default: three hunters of this rank win about ${gPct}% of the time.`;
    }
    return `Difficulty ${g} of ${DIFFICULTY_MAX}: three hunters of this rank win about ${gPct}% of the time.`;
  },
  refusals: {
    missing: 'That gate is no longer here.',
    'gate-done': 'This gate is cleared or closed, so you cannot change its difficulty.',
    refused: 'You cannot make this difficulty change right now.',
  },
} as const;
