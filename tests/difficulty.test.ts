import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY_EVENTS,
  DIFFICULTY_LEVELS,
  DIFFICULTY_WORDS,
  difficultyFactor,
  difficultyStep,
  effectiveBossLevel,
  effectiveGateLevel,
  gateDifficulty,
  parseDifficultyLevel,
  parseGateDifficulty,
  scaleMonsterForGate,
  scaleRowMonster,
  targetWinPct,
  withDifficulty,
} from '../src/core/gates/difficulty.ts';
import type { BossTrack, DifficultyEvent, DifficultyLevel, GateDifficulty, GateTrack } from '../src/core/gates/difficulty.ts';
import { RANKS, RULES, rulesOf } from '../src/core/rules.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { GateId } from '../src/core/ids.ts';

describe('difficultyStep exhaustive transition table', () => {
  const gateStates: readonly GateTrack[] = [
    { at: 'default' },
    { at: 'set', level: 5 },
    { at: 'set', level: 7 },
  ];
  const bossStates: readonly BossTrack[] = [
    { at: 'follows' },
    { at: 'own', level: 5 },
    { at: 'own', level: 9 },
  ];
  const events: readonly DifficultyEvent[] = [
    { type: 'setGate', level: 3 },
    { type: 'setGate', level: 5 },
    { type: 'setGate', level: 7 },
    { type: 'setGate', level: 0 as DifficultyLevel },
    { type: 'setGate', level: 11 as DifficultyLevel },
    { type: 'setGate', level: 5.5 as DifficultyLevel },
    { type: 'resetGate' },
    { type: 'setBoss', level: 9 },
    { type: 'setBoss', level: 8 },
    { type: 'setBoss', level: 0 as DifficultyLevel },
    { type: 'followGate' },
    { type: 'bossRemoved' },
  ];

  test('covers every event name in DIFFICULTY_EVENTS', () => {
    for (const type of DIFFICULTY_EVENTS) {
      expect(events.some(e => e.type === type)).toBe(true);
    }
  });

  test('every gate x boss state against every event matches the exact transition table', () => {
    for (const gate of gateStates) {
      for (const boss of bossStates) {
        const state: GateDifficulty = { gate, boss };
        for (const event of events) {
          const got = difficultyStep(state, event);
          let expected: GateDifficulty | null = null;
          if (event.type === 'setGate') {
            const valid = parseDifficultyLevel(event.level);
            if (valid !== null && !(gate.at === 'set' && gate.level === valid)) {
              expected = { gate: { at: 'set', level: valid }, boss };
            }
          } else if (event.type === 'resetGate') {
            if (gate.at === 'set') expected = { gate: { at: 'default' }, boss };
          } else if (event.type === 'setBoss') {
            const valid = parseDifficultyLevel(event.level);
            if (valid !== null && !(boss.at === 'own' && boss.level === valid)) {
              expected = { gate, boss: { at: 'own', level: valid } };
            }
          } else if (event.type === 'followGate' || event.type === 'bossRemoved') {
            if (boss.at === 'own') expected = { gate, boss: { at: 'follows' } };
          }
          expect(got, `${JSON.stringify(state)} + ${JSON.stringify(event)}`).toEqual(expected);
        }
      }
    }
  });
});

describe('parseGateDifficulty boundary parser', () => {
  test('migrates missing or non-object values to DEFAULT_DIFFICULTY', () => {
    for (const raw of [undefined, null, 5, 'hard', [], true]) {
      expect(parseGateDifficulty(raw)).toEqual(DEFAULT_DIFFICULTY);
    }
  });

  test('keeps valid shapes and falls back per track on junk', () => {
    expect(parseGateDifficulty({ gate: { at: 'set', level: 8 }, boss: { at: 'own', level: 10 } })).toEqual({
      gate: { at: 'set', level: 8 },
      boss: { at: 'own', level: 10 },
    });
    // valid gate + junk boss keeps gate, resets boss
    expect(parseGateDifficulty({ gate: { at: 'set', level: 3 }, boss: { at: 'own', level: 99 } })).toEqual({
      gate: { at: 'set', level: 3 },
      boss: { at: 'follows' },
    });
    // junk gate + valid boss resets gate, keeps boss
    expect(parseGateDifficulty({ gate: { at: 'unknown', level: 4 }, boss: { at: 'own', level: 6 } })).toEqual({
      gate: { at: 'default' },
      boss: { at: 'own', level: 6 },
    });
    for (const bad of [0, 11, -1, 5.5, NaN, Infinity, '7', null, undefined]) {
      expect(parseGateDifficulty({ gate: { at: 'set', level: bad }, boss: { at: 'own', level: bad } })).toEqual(DEFAULT_DIFFICULTY);
    }
  });
});

describe('effective levels and scaling math', () => {
  test('rule override of default moves default/follows tracks but never pinned tracks', () => {
    const R7 = rulesOf({ fight: { difficulty: { default: 7 } } });
    expect(effectiveGateLevel(DEFAULT_DIFFICULTY, R7)).toBe(7);
    expect(effectiveBossLevel(DEFAULT_DIFFICULTY, R7)).toBe(7);

    const pinned5: GateDifficulty = { gate: { at: 'set', level: 5 }, boss: { at: 'follows' } };
    expect(effectiveGateLevel(pinned5, R7)).toBe(5);
    expect(effectiveBossLevel(pinned5, R7)).toBe(5);

    const ownBoss: GateDifficulty = { gate: { at: 'default' }, boss: { at: 'own', level: 9 } };
    expect(effectiveGateLevel(ownBoss, R7)).toBe(7);
    expect(effectiveBossLevel(ownBoss, R7)).toBe(9);
  });

  test('normals, elites, and mythics stay 1.0x at level 5 and scale strictly monotonically', () => {
    for (const kind of ['normal', 'elite', 'mythic'] as const) {
      expect(difficultyFactor(kind, 'C', 5, RULES)).toEqual({ hp: 1, dealt: 1 });
      let prev = 0;
      for (const level of DIFFICULTY_LEVELS) {
        const s = difficultyFactor(kind, 'C', level, RULES);
        const k = s.hp * s.dealt;
        expect(k).toBeGreaterThan(prev);
        prev = k;
      }
    }
  });

  test('boss scaling is strictly monotonic across 1..10 for every rank E..S', () => {
    for (const rank of RANKS) {
      let prevHp = 0;
      let prevDealt = 0;
      for (const level of DIFFICULTY_LEVELS) {
        const s = difficultyFactor('boss', rank, level, RULES);
        expect(s.hp).toBeGreaterThan(prevHp);
        expect(s.dealt).toBeGreaterThan(prevDealt);
        prevHp = s.hp;
        prevDealt = s.dealt;
      }
    }
  });

  test('scales multiplicatively on top of GM Bestiary edits without losing stats or traits', () => {
    const editedBoss = {
      kind: 'boss' as const,
      rank: 'C' as const,
      tweak: { hp: 2, stats: { str: 6 }, traits: ['armored' as const] },
    };
    const gate = { difficulty: { gate: { at: 'set' as const, level: 3 as const }, boss: { at: 'own' as const, level: 8 as const } } };
    const scaled = scaleMonsterForGate(editedBoss, gate, 'boss', RULES);
    const factor = difficultyFactor('boss', 'C', 8, RULES);
    expect(scaled.tweak.hp).toBeCloseTo(2 * factor.hp, 6);
    expect(scaled.tweak.dealt).toBeCloseTo(factor.dealt, 6);
    expect(scaled.tweak.stats).toEqual({ str: 6 });
    expect(scaled.tweak.traits).toEqual(['armored']);

    // identity scale returns same object reference
    const same = scaleRowMonster(editedBoss, { hp: 1, dealt: 1 });
    expect(same).toBe(editedBoss);
  });
});

describe('withDifficulty and gateDifficulty writers', () => {
  test('withDifficulty skips refused events cleanly', () => {
    const base = { id: 'g1' as GateId, status: 'detected', difficulty: DEFAULT_DIFFICULTY };
    const next = withDifficulty(base, [
      { type: 'bossRemoved' },
      { type: 'setGate', level: 8 },
      { type: 'setBoss', level: 10 },
      { type: 'bossRemoved' },
    ]);
    expect(next.difficulty).toEqual({ gate: { at: 'set', level: 8 }, boss: { at: 'follows' } });
  });

  test('gateDifficulty writes open gates and refuses missing, cleared, closed, or no-op events', () => {
    const save = {
      gates: [
        { id: 'g1' as GateId, status: 'detected', difficulty: DEFAULT_DIFFICULTY },
        { id: 'g2' as GateId, status: 'cleared', difficulty: DEFAULT_DIFFICULTY },
        { id: 'g3' as GateId, status: 'closed', difficulty: DEFAULT_DIFFICULTY },
      ],
    };
    expect(gateDifficulty(save, 'missing' as GateId, { type: 'setGate', level: 7 })).toEqual({ ok: false, why: 'missing' });
    expect(gateDifficulty(save, 'g2' as GateId, { type: 'setGate', level: 7 })).toEqual({ ok: false, why: 'gate-done' });
    expect(gateDifficulty(save, 'g3' as GateId, { type: 'setGate', level: 7 })).toEqual({ ok: false, why: 'gate-done' });
    expect(gateDifficulty(save, 'g1' as GateId, { type: 'resetGate' })).toEqual({ ok: false, why: 'refused' });

    const updated = gateDifficulty(save, 'g1' as GateId, { type: 'setGate', level: 7 });
    expect(isRefused(updated)).toBe(false);
    if (!isRefused(updated)) {
      expect(updated.gates[0]!.difficulty).toEqual({ gate: { at: 'set', level: 7 }, boss: { at: 'follows' } });
    }
  });
});

describe('DIFFICULTY_WORDS plain copy', () => {
  test('every level 1..10 reads its exact win percentage from RULES and avoids banned punctuation', () => {
    for (const level of DIFFICULTY_LEVELS) {
      const pct = targetWinPct(level, RULES);
      const line = DIFFICULTY_WORDS.gateReadout(level, RULES);
      expect(line).toBe(`Difficulty ${level} of 10: three hunters of this rank win about ${pct}% of the time.`);
      const bossLine = DIFFICULTY_WORDS.bossOwnReadout(level, RULES);
      expect(bossLine).toBe(`Boss difficulty ${level} of 10: three hunters of this rank win about ${pct}% of the time.`);
      for (const s of [line, bossLine, DIFFICULTY_WORDS.bossFollowReadout(level, RULES)]) {
        expect(s).not.toMatch(/[—–;]|just\b/i);
      }
    }
    expect(DIFFICULTY_WORDS.bossToggle).toBe('This boss has its own difficulty');
    expect(DIFFICULTY_WORDS.cardSummary(DEFAULT_DIFFICULTY, true, RULES)).toContain('Difficulty 5 of 10, default');
    expect(DIFFICULTY_WORDS.cardSummary({ gate: { at: 'set', level: 7 }, boss: { at: 'own', level: 9 } }, true, RULES))
      .toContain('This boss has its own difficulty, 9 of 10');
    expect(DIFFICULTY_WORDS.cardSummary({ gate: { at: 'set', level: 7 }, boss: { at: 'own', level: 9 } }, false, RULES))
      .not.toContain('This boss has its own difficulty');
  });
});
