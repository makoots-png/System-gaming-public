// intro.ts: pure state transitions for the world-primer intro room doc (`IntroDoc`) and client player UI (`IntroUiState`).
// This module is the single builder of IntroDoc values sent to `_intro`; sync.ts `setIntro` is the single room writer.
import { INTRO_CARD_COUNT, INTRO_STORY_COUNT } from './intro-cards.ts';
import type { IntroAnswered, IntroDoc } from './protocol.ts';
import type { Seat } from './role.ts';

/** Minimum ms between GM Next taps so accidental double-taps do not skip a card. */
export const INTRO_DOUBLE_TAP_MS = 450;
/** Maximum player answers stored on Card 16 for one intro run. */
export const INTRO_ANSWERED_CAP = 32;

export type IntroViewKind = 'off' | 'solo' | 'player' | 'gm';

export type IntroUiState = {
  readonly kind: IntroViewKind;
  readonly soloCard: number;
  readonly dismissedRun: string | null;
  readonly supersededRun: string | null;
  readonly localAnsweredRun: string | null;
  readonly lastGmTapAt: number;
  readonly renderedKey: string;
};

export const INITIAL_INTRO_UI: IntroUiState = {
  kind: 'off',
  soloCard: 0,
  dismissedRun: null,
  supersededRun: null,
  localAnsweredRun: null,
  lastGmTapAt: 0,
  renderedKey: '',
};

/** Clamps a card number to the valid intro range `0 .. INTRO_CARD_COUNT - 1`. */
export const clampIntroCard = (n: number): number =>
  Math.max(0, Math.min(INTRO_CARD_COUNT - 1, Math.trunc(Number.isFinite(n) ? n : 0)));

// ── Room IntroDoc builders (single writer in core) ──

/** Starts a new table intro run at card 0 (title) with an empty answered list. */
export const introStart = (run: string, now: string): IntroDoc => ({
  intro: { card: 0, run, answered: [] },
  at: now,
});

/** Ends the active table intro, clearing the room's intro value to null. */
export const introEnd = (now: string): IntroDoc => ({
  intro: null,
  at: now,
});

/** Sets an active intro doc to absolute card `card` (clamped to `0..16`). Returns null if inactive or unchanged. */
export function introSetCard(doc: IntroDoc | null, card: number, now: string): IntroDoc | null {
  if (!doc || !doc.intro) return null;
  const target = clampIntroCard(card);
  if (target === doc.intro.card) return null;
  return { intro: { ...doc.intro, card: target }, at: now };
}

/** Steps an active intro doc by `-1` or `+1` from its current card, sending an absolute card index. */
export function introStep(doc: IntroDoc | null, delta: -1 | 1, now: string): IntroDoc | null {
  if (!doc || !doc.intro) return null;
  return introSetCard(doc, doc.intro.card + delta, now);
}

/**
 * Merges a player's Card 16 Answer into `doc`. Refuses (returns null) unless the intro is active, currently on card 16
 * (`INTRO_STORY_COUNT`), matching `run`, not yet answered by `who.key`, and below `INTRO_ANSWERED_CAP`.
 */
export function introRecordAnswer(
  doc: IntroDoc | null,
  who: IntroAnswered,
  run: string,
  now: string,
): IntroDoc | null {
  if (!doc || !doc.intro) return null;
  if (doc.intro.card !== INTRO_STORY_COUNT) return null;
  if (doc.intro.run !== run) return null;
  if (doc.intro.answered.length >= INTRO_ANSWERED_CAP) return null;
  if (doc.intro.answered.some(a => a.key === who.key)) return null;
  return {
    intro: { ...doc.intro, answered: [...doc.intro.answered, who] },
    at: now,
  };
}

/** Structural equality of two `IntroDoc` values, ignoring `at`. */
export function sameIntroDoc(a: IntroDoc | null, b: IntroDoc | null): boolean {
  const ai = a?.intro ?? null, bi = b?.intro ?? null;
  if (ai === null && bi === null) return true;
  if (ai === null || bi === null) return false;
  if (ai.card !== bi.card || ai.run !== bi.run || ai.answered.length !== bi.answered.length) return false;
  return ai.answered.every((x, i) => x.key === bi.answered[i]?.key && x.name === bi.answered[i]?.name);
}

/** Whether a GM Next tap at `nowMs` passes the double-tap guard. */
export const canTapNext = (lastTapAt: number, nowMs: number): boolean =>
  nowMs - lastTapAt >= INTRO_DOUBLE_TAP_MS;

// ── Client UI state transitions & view selector ──

/** Opens solo replay at card 0 (or `startCard` when specified). */
export const soloOpen = (s: IntroUiState, startCard = 0): IntroUiState => ({
  ...s,
  kind: 'solo',
  soloCard: clampIntroCard(startCard),
});

/** Steps solo replay by `-1` or `+1`. Advancing past the last card closes solo replay. */
export function soloStep(s: IntroUiState, delta: -1 | 1): IntroUiState {
  if (s.kind !== 'solo') return s;
  const next = s.soloCard + delta;
  if (delta > 0 && next >= INTRO_CARD_COUNT) return soloClose(s);
  return { ...s, soloCard: clampIntroCard(next) };
}

/** Closes solo replay. */
export const soloClose = (s: IntroUiState): IntroUiState => ({
  ...s,
  kind: 'off',
  soloCard: 0,
  renderedKey: '',
});

/** Player tapped Close during `run`: closes overlay on this phone only and shows the rejoin bar. */
export const introDismiss = (s: IntroUiState, run: string): IntroUiState => ({
  ...s,
  dismissedRun: run,
  renderedKey: '',
});

/** Player tapped Rejoin on the rejoin bar. */
export const introRejoin = (s: IntroUiState): IntroUiState => ({
  ...s,
  dismissedRun: null,
  renderedKey: '',
});

/** A story chapter arrived during `run`: closes the intro with no rejoin bar so the story card wins. */
export const introSupersede = (s: IntroUiState, run: string): IntroUiState => ({
  ...s,
  supersededRun: run,
  dismissedRun: null,
  renderedKey: '',
});

/** Records optimistic local confirmation that this player tapped Answer in `run`. */
export const introMarkLocalAnswer = (s: IntroUiState, run: string): IntroUiState => ({
  ...s,
  localAnsweredRun: run,
});

/** Records timestamp of an accepted GM Next tap for the double-tap guard. */
export const introMarkGmTap = (s: IntroUiState, nowMs: number): IntroUiState => ({
  ...s,
  lastGmTapAt: nowMs,
});

export type IntroView = {
  readonly kind: IntroViewKind;
  readonly card: number;
  readonly run: string | null;
  readonly showRejoin: boolean;
};

/** Derives what this phone should draw from its local UI state, room seat, and the room's `_intro` doc. */
export function introViewFor(s: IntroUiState, seat: Seat, doc: IntroDoc | null): IntroView {
  const active = doc?.intro ?? null;
  if (seat === 'gm' && active) {
    return { kind: 'gm', card: clampIntroCard(active.card), run: active.run, showRejoin: false };
  }
  if (seat === 'player' && active) {
    if (s.supersededRun === active.run) {
      return { kind: 'off', card: 0, run: null, showRejoin: false };
    }
    if (s.dismissedRun === active.run) {
      return { kind: 'off', card: clampIntroCard(active.card), run: active.run, showRejoin: true };
    }
    return { kind: 'player', card: clampIntroCard(active.card), run: active.run, showRejoin: false };
  }
  if (s.kind === 'solo') {
    return { kind: 'solo', card: clampIntroCard(s.soloCard), run: null, showRejoin: false };
  }
  return { kind: 'off', card: 0, run: null, showRejoin: false };
}
