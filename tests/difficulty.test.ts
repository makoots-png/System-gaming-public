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
  scaleNpcForGate,
  scaleRowMonster,
  targetWinPct,
  withDifficulty,
} from '../src/core/gates/difficulty.ts';
import type { BossTrack, DifficultyEvent, DifficultyLevel, GateDifficulty, GateTrack } from '../src/core/gates/difficulty.ts';
import { newNpc, npcTierPreset } from '../src/core/registry/npcs.ts';
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

  test('boss scaling is strictly monotonic across 1..10 for every rank E..S and archetype', () => {
    for (const rank of RANKS) {
      for (const arch of ['brute', 'skirmisher', 'caster'] as const) {
        let prevHp = 0;
        let prevDealt = 0;
        for (const level of DIFFICULTY_LEVELS) {
          const s = difficultyFactor('boss', rank, level, RULES, arch);
          expect(s.hp).toBeGreaterThan(prevHp);
          expect(s.dealt).toBeGreaterThan(prevDealt);
          prevHp = s.hp;
          prevDealt = s.dealt;
        }
      }
    }
  });

  test('rankSpread <= 1 never inverts boss[4] edits and keeps extreme valid overrides within the 100 wire cap', () => {
    const raised = rulesOf({ fight: { difficulty: { boss: [3.3, 3.52, 3.74, 3.92, 4.35, 4.55, 5.12, 5.72, 6.28, 7.14] } } });
    for (const rank of RANKS) {
      for (const level of [5, 6, 7, 8, 9, 10] as const) {
        const before = difficultyFactor('boss', rank, level, RULES);
        const after = difficultyFactor('boss', rank, level, raised);
        expect(after.hp * after.dealt, `${rank} d${level}`).toBeGreaterThanOrEqual(before.hp * before.dealt - 1e-9);
      }
    }
    const maxOv = rulesOf({
      fight: {
        difficulty: {
          boss: [0.1, 0.1, 0.1, 0.1, 0.1, 20, 20, 20, 20, 20],
          rankScale: { E: 20 },
          rankSpread: { E: 1 },
          archetypeScale: { brute: 2 },
        },
      },
    });
    const hi = difficultyFactor('boss', 'E', 10, maxOv, 'brute');
    expect(hi.hp).toBeLessThanOrEqual(100);
    expect(hi.dealt).toBeLessThanOrEqual(100);
    const minOv = rulesOf({
      fight: {
        difficulty: {
          boss: [0.1, 0.1, 0.1, 0.1, 20, 0.1, 0.1, 0.1, 0.1, 0.1],
          rankScale: { E: 0.1 },
          rankSpread: { E: 1 },
          archetypeScale: { brute: 0.1 },
        },
      },
    });
    const lo = difficultyFactor('boss', 'E', 10, minOv, 'brute');
    expect(Math.round(lo.hp * 1000) / 1000).toBeGreaterThan(0);
    expect(Math.round(lo.dealt * 1000) / 1000).toBeGreaterThan(0);
  });

  test('archetypeScale scales non-brute bosses down relative to brutes and flows through scaleMonsterForGate', () => {
    const gate = { difficulty: DEFAULT_DIFFICULTY };
    const brute = scaleMonsterForGate({ kind: 'boss' as const, rank: 'C' as const, archetype: 'brute' as const, tweak: {} }, gate, 'boss', RULES);
    const skirm = scaleMonsterForGate({ kind: 'boss' as const, rank: 'C' as const, archetype: 'skirmisher' as const, tweak: {} }, gate, 'boss', RULES);
    const caster = scaleMonsterForGate({ kind: 'boss' as const, rank: 'C' as const, archetype: 'caster' as const, tweak: {} }, gate, 'boss', RULES);
    expect(skirm.tweak.hp!).toBeLessThan(brute.tweak.hp!);
    expect(caster.tweak.hp!).toBeLessThan(skirm.tweak.hp!);
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

  test('scaleNpcForGate scales foe NPCs on the pack curve across all tiers (1x at default 5) and leaves ally NPCs untouched', () => {
    const baseNpc = newNpc({
      name: 'Vanguard',
      rank: 'C',
      archetype: 'skirmisher',
      ...npcTierPreset('elite'),
      tweak: { hp: 1.2, dealt: 0.9, stats: { agi: 4 }, traits: ['fast'] },
      defaultSide: 'foe',
    });
    const hardGate = { difficulty: { gate: { at: 'set' as const, level: 9 as const }, boss: { at: 'own' as const, level: 10 as const } } };
    const easyGate = { difficulty: { gate: { at: 'set' as const, level: 1 as const }, boss: { at: 'follows' as const } } };

    // Foe NPC scales multiplicatively with gate level on the pack curve (preserving custom stats and traits).
    const scaledHard = scaleNpcForGate(baseNpc, 'foe', hardGate, RULES);
    const factorHard = difficultyFactor('normal', 'C', 9, RULES, 'skirmisher');
    expect(scaledHard.tweak.hp).toBeCloseTo(1.2 * factorHard.hp, 6);
    expect(scaledHard.tweak.dealt).toBeCloseTo(0.9 * factorHard.dealt, 6);
    expect(scaledHard.tweak.stats).toEqual({ agi: 4 });
    expect(scaledHard.tweak.traits).toEqual(['fast']);

    const scaledEasy = scaleNpcForGate(baseNpc, 'foe', easyGate, RULES);
    expect(scaledEasy.tweak.hp).toBeLessThan(baseNpc.tweak.hp);
    expect(scaledEasy.tweak.dealt).toBeLessThan(baseNpc.tweak.dealt);

    // Every foe NPC tier (normal, elite, and boss) stays 1.0x at default difficulty 5 and follows the pack curve.
    for (const preset of ['standard', 'elite', 'boss'] as const) {
      const foe = newNpc({ name: `Foe ${preset}`, rank: 'C', archetype: 'brute', ...npcTierPreset(preset), defaultSide: 'foe' });
      expect(scaleNpcForGate(foe, 'foe', { difficulty: DEFAULT_DIFFICULTY }, RULES)).toBe(foe);
      const atHard = scaleNpcForGate(foe, 'foe', hardGate, RULES);
      const packHard = difficultyFactor('normal', 'C', 9, RULES, 'brute');
      expect(atHard.tweak.hp).toBeCloseTo(foe.tweak.hp * packHard.hp, 6);
      expect(atHard.tweak.dealt).toBeCloseTo(foe.tweak.dealt * packHard.dealt, 6);
    }

    // Ally NPCs (side === 'party') are never scaled at any difficulty level or tier.
    for (const tier of ['normal', 'elite', 'boss'] as const) {
      const ally = newNpc({ name: 'Ally', rank: 'C', tier, defaultSide: 'party' });
      for (const level of DIFFICULTY_LEVELS) {
        const g = { difficulty: { gate: { at: 'set' as const, level }, boss: { at: 'own' as const, level: 10 as const } } };
        expect(scaleNpcForGate(ally, 'party', g, RULES)).toBe(ally);
      }
    }
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
