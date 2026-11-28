import { describe, expect, test } from 'bun:test';
import {
  INITIAL_INTRO_UI,
  INTRO_ANSWERED_CAP,
  INTRO_DOUBLE_TAP_MS,
  canTapNext,
  introDismiss,
  introEnd,
  introMarkGmTap,
  introMarkLocalAnswer,
  introRecordAnswer,
  introRejoin,
  introSetCard,
  introStart,
  introStep,
  introSupersede,
  introViewFor,
  sameIntroDoc,
  soloOpen,
} from '../src/core/intro.ts';
import { paceOf } from '../src/core/sync/link.ts';
import type { SheetKey } from '../src/core/protocol.ts';

const NOW = '2026-11-27T20:00:00.000Z';
const LATER = '2026-11-27T20:00:05.000Z';
const KAI = 'd-p1:h1' as SheetKey;
const MIRA = 'd-p2:h1' as SheetKey;

describe('IntroDoc room value transitions', () => {
  test('start, absolute Next/Back stepping, bounds, and end', () => {
    const started = introStart('run-1', NOW);
    expect(started).toEqual({ intro: { card: 0, run: 'run-1', answered: [] }, at: NOW });

    // Back at card 0 is a no-op
    expect(introStep(started, -1, LATER)).toBeNull();
    // Next moves to absolute card 1
    const c1 = introStep(started, 1, LATER)!;
    expect(c1.intro?.card).toBe(1);
    // Back returns to absolute card 0
    expect(introStep(c1, -1, LATER)?.intro?.card).toBe(0);

    // Setting card clamps to 0..16
    const c16 = introSetCard(started, 99, LATER)!;
    expect(c16.intro?.card).toBe(16);
    // Next at card 16 is a no-op
    expect(introStep(c16, 1, LATER)).toBeNull();
    // Setting same card is a no-op
    expect(introSetCard(c16, 16, LATER)).toBeNull();

    // End clears intro to null; stepping an ended doc returns null
    const ended = introEnd(LATER);
    expect(ended).toEqual({ intro: null, at: LATER });
    expect(introStep(ended, 1, LATER)).toBeNull();
    expect(introStep(null, 1, LATER)).toBeNull();
  });

  test('introRecordAnswer merges ONLY on card 16 with matching run, refusing wrong card and wrong run', () => {
    const c0 = introStart('run-1', NOW);
    const c15 = introSetCard(c0, 15, NOW)!;
    const c16 = introSetCard(c0, 16, NOW)!;

    // Refusal 1: wrong card (card 0 and card 15)
    expect(introRecordAnswer(c0, { key: KAI, name: 'Kai' }, 'run-1', LATER)).toBeNull();
    expect(introRecordAnswer(c15, { key: KAI, name: 'Kai' }, 'run-1', LATER)).toBeNull();

    // Refusal 2: wrong run even on card 16
    expect(introRecordAnswer(c16, { key: KAI, name: 'Kai' }, 'run-other', LATER)).toBeNull();

    // Refusal 3: ended or missing doc
    expect(introRecordAnswer(introEnd(NOW), { key: KAI, name: 'Kai' }, 'run-1', LATER)).toBeNull();
    expect(introRecordAnswer(null, { key: KAI, name: 'Kai' }, 'run-1', LATER)).toBeNull();

    // Accepted on card 16 + matching run
    const withKai = introRecordAnswer(c16, { key: KAI, name: 'Kai' }, 'run-1', LATER)!;
    expect(withKai.intro?.answered).toEqual([{ key: KAI, name: 'Kai' }]);

    // Duplicate key refused
    expect(introRecordAnswer(withKai, { key: KAI, name: 'Kai' }, 'run-1', LATER)).toBeNull();

    // Second player merges cleanly
    const withBoth = introRecordAnswer(withKai, { key: MIRA, name: 'Mira' }, 'run-1', LATER)!;
    expect(withBoth.intro?.answered).toEqual([
      { key: KAI, name: 'Kai' },
      { key: MIRA, name: 'Mira' },
    ]);

    // Cap enforcement
    let full = c16;
    for (let i = 0; i < INTRO_ANSWERED_CAP; i++) {
      full = introRecordAnswer(full, { key: `d-p${i}:h1` as SheetKey, name: `P${i}` }, 'run-1', LATER)!;
    }
    expect(full.intro?.answered).toHaveLength(INTRO_ANSWERED_CAP);
    expect(introRecordAnswer(full, { key: 'd-over:h1' as SheetKey, name: 'Over' }, 'run-1', LATER)).toBeNull();
  });

  test('sameIntroDoc ignores timestamp differences and detects card, run, or answer changes', () => {
    const a = introStart('run-1', NOW);
    const b = introStart('run-1', LATER);
    expect(sameIntroDoc(a, b)).toBe(true);
    expect(sameIntroDoc(introEnd(NOW), null)).toBe(true);
    expect(sameIntroDoc(a, introStep(a, 1, LATER))).toBe(false);
    expect(sameIntroDoc(a, introStart('run-2', NOW))).toBe(false);
  });

  test('GM Next double-tap guard blocks taps inside INTRO_DOUBLE_TAP_MS and allows after', () => {
    expect(canTapNext(0, 1000)).toBe(true);
    const s = introMarkGmTap(INITIAL_INTRO_UI, 1000);
    expect(canTapNext(s.lastGmTapAt, 1000 + INTRO_DOUBLE_TAP_MS - 1)).toBe(false);
    expect(canTapNext(s.lastGmTapAt, 1000 + INTRO_DOUBLE_TAP_MS)).toBe(true);
  });
});

describe('introViewFor client mode decisions', () => {
  const c5 = introSetCard(introStart('run-1', NOW), 5, NOW)!;

  test('GM seat follows active room doc (including reload and second GM tab)', () => {
    expect(introViewFor(INITIAL_INTRO_UI, 'gm', c5)).toEqual({
      kind: 'gm',
      card: 5,
      run: 'run-1',
      showRejoin: false,
    });
    expect(introViewFor(INITIAL_INTRO_UI, 'gm', introEnd(NOW))).toEqual({
      kind: 'off',
      card: 0,
      run: null,
      showRejoin: false,
    });
  });

  test('player seat follows room doc, handles Close + Rejoin, and re-opens on new run', () => {
    expect(introViewFor(INITIAL_INTRO_UI, 'player', c5)).toEqual({
      kind: 'player',
      card: 5,
      run: 'run-1',
      showRejoin: false,
    });

    const dismissed = introDismiss(INITIAL_INTRO_UI, 'run-1');
    expect(introViewFor(dismissed, 'player', c5)).toEqual({
      kind: 'off',
      card: 5,
      run: 'run-1',
      showRejoin: true,
    });

    const rejoined = introRejoin(dismissed);
    expect(introViewFor(rejoined, 'player', c5)).toEqual({
      kind: 'player',
      card: 5,
      run: 'run-1',
      showRejoin: false,
    });

    // A brand-new run opens automatically even if the old run was dismissed
    const run2 = introStart('run-2', LATER);
    expect(introViewFor(dismissed, 'player', run2)).toEqual({
      kind: 'player',
      card: 0,
      run: 'run-2',
      showRejoin: false,
    });
  });

  test('story card winning supersedes the active run with no rejoin bar', () => {
    const sup = introSupersede(INITIAL_INTRO_UI, 'run-1');
    expect(introViewFor(sup, 'player', c5)).toEqual({
      kind: 'off',
      card: 0,
      run: null,
      showRejoin: false,
    });
    // Next fresh intro run still works
    expect(introViewFor(sup, 'player', introStart('run-2', LATER))).toEqual({
      kind: 'player',
      card: 0,
      run: 'run-2',
      showRejoin: false,
    });
  });

  test('solo mode works alone or when no room intro is active, and local answer tracks run', () => {
    const solo = soloOpen(INITIAL_INTRO_UI, 3);
    expect(introViewFor(solo, 'alone', null)).toEqual({
      kind: 'solo',
      card: 3,
      run: null,
      showRejoin: false,
    });
    expect(introMarkLocalAnswer(INITIAL_INTRO_UI, 'run-1').localAnsweredRun).toBe('run-1');
  });

  test('paceOf polls at turn pace (1 s) for both GM and players while intro is active', () => {
    expect(paceOf(null, false, 'd-p1', false, false)).toBe('table');
    expect(paceOf(null, true, 'd-gm', false, false)).toBe('table');
    expect(paceOf(null, false, 'd-p1', false, true)).toBe('turn');
    expect(paceOf(null, true, 'd-gm', false, true)).toBe('turn');
  });
});
