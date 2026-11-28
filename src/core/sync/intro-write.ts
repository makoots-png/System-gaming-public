// intro-write.ts: the GM phone's serialized `_intro` room-doc writer, as a pure machine.
// At most one PUT is out at a time in a stretch of the link (`Gen`). A newer write while a PUT is out waits in
// `sendingQueued` and goes out next; a failed PUT stays pending in `retrying` and retries on `INTRO_RETRY_DELAYS_MS`.
// Every `write` caller carries a reply handle `R` that resolves ONLY with the outcome of the PUT carrying (or
// superseding) its value — never optimistically while a PUT is still in flight.
//
// `introPollStamp` and `keepLocalIntro` close the stale-poll hole: a poll sent while a PUT is already in flight (or
// before a newer write starts) must keep the GM's locally written `_intro` doc even if the poll arrives after the PUT
// finishes and returns to `idle`.
import type { IntroDoc } from '../protocol.ts';
import type { Gen } from './link.ts';

/** Delays before retrying a failed `_intro` PUT (2 retries after the initial try: 3 attempts total). */
export const INTRO_RETRY_DELAYS_MS: readonly number[] = [400, 1000];

/** Warning toast copy shown to the GM when an `_intro` write fails after retries are exhausted (docs/guide/voice.md). */
export const INTRO_WRITE_WORDS = {
  failedToast: 'Could not update the intro for the table. Check your connection and try again.',
} as const;

export const INTRO_WRITE_STATES = ['idle', 'sending', 'sendingQueued', 'retrying'] as const;
export type IntroWriteAt = (typeof INTRO_WRITE_STATES)[number];

export const INTRO_WRITE_PUTS = ['stored', 'failed', 'tooBig'] as const;
export type IntroWritePut = (typeof INTRO_WRITE_PUTS)[number];

export const INTRO_WRITE_EVENTS = ['write', 'answered', 'due', 'left'] as const;
export type IntroWriteEventType = (typeof INTRO_WRITE_EVENTS)[number];

/**
 * `idle`: no PUT out and no retry waiting (`seq` stays monotonic so earlier polls stay stale).
 * `sending`: one PUT of `doc` is out in `gen` for `waiters`, with `retriesLeft` retries remaining on failure.
 * `sendingQueued`: one PUT of `doc` is out for `waiters`, and a newer `queued` doc for `queuedWaiters` goes out next.
 * `retrying`: a PUT of `doc` failed with `retriesLeft` retries left; a retry timer is running in `gen`.
 */
export type IntroWrite<R> =
  | { readonly at: 'idle'; readonly seq: number }
  | { readonly at: 'sending'; readonly seq: number; readonly gen: Gen; readonly doc: IntroDoc; readonly waiters: readonly R[]; readonly retriesLeft: number }
  | { readonly at: 'sendingQueued'; readonly seq: number; readonly gen: Gen; readonly doc: IntroDoc; readonly waiters: readonly R[]; readonly queued: IntroDoc; readonly queuedWaiters: readonly R[] }
  | { readonly at: 'retrying'; readonly seq: number; readonly gen: Gen; readonly doc: IntroDoc; readonly waiters: readonly R[]; readonly retriesLeft: number };

export const INTRO_WRITE_IDLE: IntroWrite<never> = { at: 'idle', seq: 0 };

/** Events handled by `introWriteStep`. */
export type IntroWriteEvent<R> =
  | { readonly type: 'write'; readonly gen: Gen; readonly doc: IntroDoc; readonly reply: R }
  | { readonly type: 'answered'; readonly gen: Gen; readonly put: IntroWritePut }
  | { readonly type: 'due'; readonly gen: Gen }
  | { readonly type: 'left' };

/** Effects the edge (`src/edge/sync.ts`) carries out after a step. */
export type IntroWriteEffect<R> =
  | { readonly type: 'put'; readonly gen: Gen; readonly doc: IntroDoc }
  | { readonly type: 'setTimer'; readonly gen: Gen; readonly ms: number }
  | { readonly type: 'clearTimer' }
  | { readonly type: 'stored'; readonly gen: Gen; readonly doc: IntroDoc }
  | { readonly type: 'answer'; readonly waiters: readonly R[]; readonly ok: boolean };

export type IntroWriteResult<R> = {
  readonly state: IntroWrite<R>;
  readonly effects: readonly IntroWriteEffect<R>[];
};

/** The state each event can lead to from each state, or null where it does not apply. */
export const INTRO_WRITE_TABLE: { readonly [S in IntroWriteAt]: { readonly [E in IntroWriteEventType]: readonly IntroWriteAt[] | null } } = {
  idle: { write: ['sending'], answered: null, due: null, left: ['idle'] },
  sending: { write: ['sendingQueued', 'sending'], answered: ['idle', 'retrying'], due: null, left: ['idle'] },
  sendingQueued: { write: ['sendingQueued', 'sending'], answered: ['sending'], due: null, left: ['idle'] },
  retrying: { write: ['sending'], answered: null, due: ['sending'], left: ['idle'] },
};

const MAX_RETRIES = INTRO_RETRY_DELAYS_MS.length;
const retryDelayFor = (retriesLeft: number): number =>
  INTRO_RETRY_DELAYS_MS[Math.max(0, Math.min(INTRO_RETRY_DELAYS_MS.length - 1, MAX_RETRIES - retriesLeft))] ?? 400;

/** Snapshot taken when a room poll GET is sent, so `keepLocalIntro` knows whether a PUT overlapped it. */
export type IntroPollStamp = { readonly seq: number; readonly inFlight: boolean };

/** Captures the write machine's stamp at the moment a poll GET goes out. */
export const introPollStamp = (s: IntroWrite<unknown>): IntroPollStamp => ({
  seq: s.seq,
  inFlight: s.at !== 'idle',
});

/**
 * Whether a poll started at `stamp` must keep the GM's local `_intro` doc instead of overwriting it with the poll's
 * doc. True when a write was already active when the poll went out, when a newer write started since, or when a write
 * is active now.
 */
export const keepLocalIntro = (s: IntroWrite<unknown>, stamp: IntroPollStamp): boolean =>
  stamp.inFlight || stamp.seq !== s.seq || s.at !== 'idle';

/** Steps the GM `_intro` write machine on `e`, returning the next state and edge effects. */
export function introWriteStep<R>(s: IntroWrite<R>, e: IntroWriteEvent<R>): IntroWriteResult<R> {
  if (e.type === 'left') {
    if (s.at === 'idle') return { state: s, effects: [] };
    const waiters = s.at === 'sendingQueued' ? [...s.waiters, ...s.queuedWaiters] : s.waiters;
    const fx: IntroWriteEffect<R>[] = [];
    if (s.at === 'retrying') fx.push({ type: 'clearTimer' });
    if (waiters.length) fx.push({ type: 'answer', waiters, ok: false });
    return { state: { at: 'idle', seq: s.seq }, effects: fx };
  }

  if (e.type === 'write') {
    const seq = s.seq + 1;
    if (s.at === 'idle') {
      return {
        state: { at: 'sending', seq, gen: e.gen, doc: e.doc, waiters: [e.reply], retriesLeft: MAX_RETRIES },
        effects: [{ type: 'put', gen: e.gen, doc: e.doc }],
      };
    }
    if (s.gen !== e.gen) {
      // Defensive: a write in a newer link stretch drops the old stretch's waiters and timer.
      const oldWaiters = s.at === 'sendingQueued' ? [...s.waiters, ...s.queuedWaiters] : s.waiters;
      const fx: IntroWriteEffect<R>[] = [];
      if (s.at === 'retrying') fx.push({ type: 'clearTimer' });
      if (oldWaiters.length) fx.push({ type: 'answer', waiters: oldWaiters, ok: false });
      fx.push({ type: 'put', gen: e.gen, doc: e.doc });
      return {
        state: { at: 'sending', seq, gen: e.gen, doc: e.doc, waiters: [e.reply], retriesLeft: MAX_RETRIES },
        effects: fx,
      };
    }
    if (s.at === 'sending') {
      return {
        state: { at: 'sendingQueued', seq, gen: s.gen, doc: s.doc, waiters: s.waiters, queued: e.doc, queuedWaiters: [e.reply] },
        effects: [],
      };
    }
    if (s.at === 'sendingQueued') {
      return {
        state: { ...s, seq, queued: e.doc, queuedWaiters: [...s.queuedWaiters, e.reply] },
        effects: [],
      };
    }
    // `retrying`: cancel backoff and immediately send the latest value, carrying both old and new waiters.
    return {
      state: { at: 'sending', seq, gen: s.gen, doc: e.doc, waiters: [...s.waiters, e.reply], retriesLeft: MAX_RETRIES },
      effects: [{ type: 'clearTimer' }, { type: 'put', gen: s.gen, doc: e.doc }],
    };
  }

  if (e.type === 'due') {
    if (s.at !== 'retrying' || e.gen !== s.gen) return { state: s, effects: [] };
    return {
      state: { at: 'sending', seq: s.seq, gen: s.gen, doc: s.doc, waiters: s.waiters, retriesLeft: Math.max(0, s.retriesLeft - 1) },
      effects: [{ type: 'put', gen: s.gen, doc: s.doc }],
    };
  }

  // `answered`
  if ((s.at !== 'sending' && s.at !== 'sendingQueued') || e.gen !== s.gen) {
    return { state: s, effects: [] };
  }
  const ok = e.put === 'stored';
  if (s.at === 'sendingQueued') {
    const fx: IntroWriteEffect<R>[] = [];
    if (ok) fx.push({ type: 'stored', gen: s.gen, doc: s.doc });
    if (s.waiters.length) fx.push({ type: 'answer', waiters: s.waiters, ok });
    fx.push({ type: 'put', gen: s.gen, doc: s.queued });
    return {
      state: { at: 'sending', seq: s.seq, gen: s.gen, doc: s.queued, waiters: s.queuedWaiters, retriesLeft: MAX_RETRIES },
      effects: fx,
    };
  }
  if (ok) {
    const fx: IntroWriteEffect<R>[] = [{ type: 'stored', gen: s.gen, doc: s.doc }];
    if (s.waiters.length) fx.push({ type: 'answer', waiters: s.waiters, ok: true });
    return { state: { at: 'idle', seq: s.seq }, effects: fx };
  }
  if (e.put === 'failed' && s.retriesLeft > 0) {
    return {
      state: { at: 'retrying', seq: s.seq, gen: s.gen, doc: s.doc, waiters: s.waiters, retriesLeft: s.retriesLeft },
      effects: [{ type: 'setTimer', gen: s.gen, ms: retryDelayFor(s.retriesLeft) }],
    };
  }
  return {
    state: { at: 'idle', seq: s.seq },
    effects: s.waiters.length ? [{ type: 'answer', waiters: s.waiters, ok: false }] : [],
  };
}
