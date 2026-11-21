// The Room view's lobby (src/core/sync/lobby.ts): a code check from the pause after typing to the server's answer, and
// a GM's seat action from the tap to the answer, tied to its room (audit SMX-sync-11, SMX-views-10).
import { describe, expect, test } from 'bun:test';
import {
  LOBBY_CHECK_EVENTS, LOBBY_CHECK_STATES, LOBBY_NOT_FOUND, LOBBY_PAUSE_MS, LOBBY_SEAT_EVENTS, LOBBY_SEAT_STATES, LOBBY_START, checkAnswer, checkStep, lobbyStep, seatBusy, seatStep,
} from '../src/core/sync/lobby.ts';
import type { Lobby, LobbyAnswer, LobbyCheck, LobbyCheckEffect, LobbyCheckEvent, LobbyEffect, LobbyEvent, LobbySeat, LobbySeatEvent, LobbySeats } from '../src/core/sync/lobby.ts';
import type { Call } from '../src/core/sync/outbox.ts';
import { room } from './fixtures/ids.ts';

const A = room('ABC234'), B = room('XYZ789');
const FOUND: LobbyAnswer = { ok: true, exists: true, gm: false };
const NO_SERVER: LobbyAnswer = { ok: false };
const OK: Call = { ok: true, data: null };
const OFFLINE: Call = { ok: false, why: 'offline' };

const idle: LobbyCheck = { at: 'idle' };
const waiting: LobbyCheck = { at: 'waiting', code: A };
const asking: LobbyCheck = { at: 'asking', code: A };
const known: LobbyCheck = { at: 'known', code: A, answer: FOUND };
const unknown: LobbyCheck = { at: 'known', code: A, answer: NO_SERVER };
const CHECKS: Record<string, LobbyCheck> = { idle, waiting, asking, known, unknown };

const clear: LobbyCheckEffect = { type: 'clearTimer' };
const timer = (code = A): LobbyCheckEffect => ({ type: 'setTimer', code, ms: LOBBY_PAUSE_MS });
const ask = (code = A): LobbyCheckEffect => ({ type: 'ask', code });

describe('a code check', () => {
  // [from, event, to, effects]: every state against every event, the ones that change nothing too. A state that
  // waits on the pause clears its timer whenever it leaves.
  const T: [string, LobbyCheckEvent, LobbyCheck, LobbyCheckEffect[]][] = [
    ['idle', { type: 'typed', code: A }, waiting, [timer()]],
    ['idle', { type: 'typed', code: null }, idle, []],
    ['idle', { type: 'paused', code: A }, idle, []],
    ['idle', { type: 'ask', code: A }, asking, [ask()]],
    ['idle', { type: 'answered', code: A, answer: FOUND }, idle, []],
    ['idle', { type: 'notFound', code: A }, { at: 'known', code: A, answer: LOBBY_NOT_FOUND }, []],
    ['idle', { type: 'cancel' }, idle, []],
    ['idle', { type: 'reset' }, idle, []],
    ['idle', { type: 'serverBack' }, idle, []],

    ['waiting', { type: 'typed', code: B }, { at: 'waiting', code: B }, [clear, timer(B)]],
    ['waiting', { type: 'typed', code: null }, idle, [clear]],
    ['waiting', { type: 'paused', code: A }, asking, [clear, ask()]],
    ['waiting', { type: 'paused', code: B }, waiting, []],
    ['waiting', { type: 'ask', code: B }, { at: 'asking', code: B }, [clear, ask(B)]],
    ['waiting', { type: 'answered', code: A, answer: FOUND }, waiting, []],
    ['waiting', { type: 'notFound', code: A }, { at: 'known', code: A, answer: LOBBY_NOT_FOUND }, [clear]],
    ['waiting', { type: 'cancel' }, idle, [clear]],
    ['waiting', { type: 'reset' }, idle, [clear]],
    ['waiting', { type: 'serverBack' }, waiting, []],

    ['asking', { type: 'typed', code: B }, { at: 'waiting', code: B }, [timer(B)]],
    ['asking', { type: 'typed', code: null }, idle, []],
    ['asking', { type: 'paused', code: A }, asking, []],
    ['asking', { type: 'ask', code: B }, { at: 'asking', code: B }, [ask(B)]],
    ['asking', { type: 'answered', code: A, answer: FOUND }, known, []],
    ['asking', { type: 'answered', code: B, answer: FOUND }, asking, []],
    ['asking', { type: 'notFound', code: A }, { at: 'known', code: A, answer: LOBBY_NOT_FOUND }, []],
    ['asking', { type: 'cancel' }, idle, []],
    ['asking', { type: 'reset' }, idle, []],
    ['asking', { type: 'serverBack' }, asking, []],

    ['known', { type: 'typed', code: B }, { at: 'waiting', code: B }, [timer(B)]],
    ['known', { type: 'typed', code: null }, idle, []],
    ['known', { type: 'paused', code: A }, known, []],
    ['known', { type: 'ask', code: B }, { at: 'asking', code: B }, [ask(B)]],
    ['known', { type: 'answered', code: A, answer: NO_SERVER }, known, []],
    ['known', { type: 'notFound', code: B }, { at: 'known', code: B, answer: LOBBY_NOT_FOUND }, []],
    ['known', { type: 'cancel' }, known, []],
    ['known', { type: 'reset' }, idle, []],
    ['known', { type: 'serverBack' }, known, []],
    ['unknown', { type: 'serverBack' }, asking, [ask()]],
  ];

  test('every state meets every event', () => {
    const seen = new Set(T.map(([from, e]) => `${CHECKS[from]!.at} ${e.type}`));
    expect(seen.size).toBe(LOBBY_CHECK_STATES.length * LOBBY_CHECK_EVENTS.length);
  });

  for (const [from, e, to, effects] of T) {
    test(`${from} + ${e.type}${'code' in e ? ` ${e.code === A ? 'its code' : e.code === null ? 'no code' : 'another code'}` : ''} -> ${to.at}`, () => {
      expect(checkStep(CHECKS[from]!, e)).toEqual({ state: to, effects });
    });
  }

  test('the answer is read only for the code it is for, and only once known', () => {
    expect(checkAnswer(known, A)).toEqual(FOUND);
    expect(checkAnswer(known, B)).toBeNull();
    expect(checkAnswer(asking, A)).toBeNull();
  });
});

describe('the lobby\'s code checks', () => {
  const run = (l: Lobby, ...events: LobbyEvent[]): { state: Lobby; effects: LobbyEffect[] } => {
    const effects: LobbyEffect[] = [];
    for (const e of events) { const r = lobbyStep(l, e); l = r.state; effects.push(...r.effects); }
    return { state: l, effects };
  };

  test('a code typed just before Join is never asked: the tap ends its pause, and the timer, if it still runs out, asks nothing', () => {
    const r = run(LOBBY_START, { type: 'typed', code: A }, { type: 'joinTapped' }, { type: 'paused', code: A });
    expect(r.state.join).toEqual(idle);
    expect(r.effects).toEqual([{ type: 'setTimer', code: A, ms: LOBBY_PAUSE_MS }, { type: 'clearTimer' }]);
  });

  test('a code typed just before the room changes is never asked', () => {
    const r = run(LOBBY_START, { type: 'typed', code: A }, { type: 'room', code: B }, { type: 'paused', code: A });
    expect(r.state.join).toEqual(idle);
    expect(r.effects.filter(x => x.type === 'ask')).toEqual([]);
  });

  test('a question out when Join is tapped is dropped: its answer comes back to nothing', () => {
    const r = run(LOBBY_START, { type: 'typed', code: A }, { type: 'paused', code: A }, { type: 'joinTapped' }, { type: 'answered', of: 'join', code: A, answer: FOUND });
    expect(r.state.join).toEqual(idle);
  });

  test('a typed code is asked once its pause runs out, and its answer is the line\'s', () => {
    const r = run(LOBBY_START, { type: 'typed', code: A }, { type: 'paused', code: A }, { type: 'answered', of: 'join', code: A, answer: FOUND });
    expect(r.effects).toContainEqual({ type: 'ask', of: 'join', code: A });
    expect(checkAnswer(r.state.join, A)).toEqual(FOUND);
    expect(r.state.invite).toEqual(idle);
  });

  test('an invite is asked at once, and a Join tap or a room change leaves its answer alone', () => {
    const r = run(LOBBY_START, { type: 'asked', code: B }, { type: 'answered', of: 'invite', code: B, answer: FOUND }, { type: 'joinTapped' }, { type: 'room', code: A });
    expect(r.effects).toEqual([{ type: 'ask', of: 'invite', code: B }]);
    expect(checkAnswer(r.state.invite, B)).toEqual(FOUND);
  });

  test('a join refused as no such room says so under its own check without asking again', () => {
    const r = run(LOBBY_START, { type: 'asked', code: B }, { type: 'notFound', of: 'invite', code: B });
    expect(checkAnswer(r.state.invite, B)).toEqual(LOBBY_NOT_FOUND);
    expect(r.state.join).toEqual(idle);
  });

  test('a join made ends both checks; Not this room ends only the invite\'s', () => {
    const both = run(LOBBY_START, { type: 'typed', code: A }, { type: 'asked', code: B });
    expect(run(both.state, { type: 'joined' }).state).toEqual(LOBBY_START);
    const dropped = run(both.state, { type: 'dropped' }).state;
    expect(dropped.invite).toEqual(idle);
    expect(dropped.join).toEqual(both.state.join);
  });

  test('the server back asks again the checks it could not answer, the invite\'s only while that invite is pending', () => {
    const failed = run(LOBBY_START,
      { type: 'typed', code: A }, { type: 'paused', code: A }, { type: 'answered', of: 'join', code: A, answer: NO_SERVER },
      { type: 'asked', code: B }, { type: 'answered', of: 'invite', code: B, answer: NO_SERVER }).state;
    expect(run(failed, { type: 'serverBack', invite: B }).effects).toEqual([{ type: 'ask', of: 'join', code: A }, { type: 'ask', of: 'invite', code: B }]);
    expect(run(failed, { type: 'serverBack', invite: null }).effects).toEqual([{ type: 'ask', of: 'join', code: A }]);
  });
});

describe('a GM\'s seat action', () => {
  const K = 'dev1:h_mira', NAME = 'Mira';
  const confirming: LobbySeat = { at: 'confirming', act: 'remove', room: A, key: K, name: NAME };
  const sent = (act: LobbySeat['act']): LobbySeat => ({ at: 'sent', act, room: A, key: K, name: NAME });
  const SEATS: Record<(typeof LOBBY_SEAT_STATES)[number], LobbySeats> = { none: [], confirming: [confirming], sent: [sent('release')] };

  // [key's state, event, state after, effects]: every state against every event, the refused ones too
  const T: [keyof typeof SEATS, LobbySeatEvent, LobbySeats, unknown[]][] = [
    ['none', { type: 'seatTapped', act: 'remove', key: K, name: NAME, room: A }, [confirming], [{ type: 'confirm', key: K, room: A, name: NAME }]],
    ['none', { type: 'seatTapped', act: 'release', key: K, name: NAME, room: A }, [sent('release')], [{ type: 'send', act: 'release', key: K, room: A }]],
    ['none', { type: 'seatTapped', act: 'allow', key: K, name: NAME, room: A }, [sent('allow')], [{ type: 'send', act: 'allow', key: K, room: A }]],
    ['none', { type: 'seatTapped', act: 'release', key: K, name: NAME, room: null }, [], []],
    ['none', { type: 'confirmed', key: K, room: A, yes: true }, [], []],
    ['none', { type: 'seatAnswered', act: 'release', key: K, room: A, call: OK }, [], []],
    ['none', { type: 'room', code: B }, [], []],

    ['confirming', { type: 'seatTapped', act: 'remove', key: K, name: NAME, room: A }, [confirming], []],
    ['confirming', { type: 'seatTapped', act: 'release', key: K, name: NAME, room: A }, [confirming], []],
    ['confirming', { type: 'confirmed', key: K, room: A, yes: true }, [sent('remove')], [{ type: 'send', act: 'remove', key: K, room: A }]],
    ['confirming', { type: 'confirmed', key: K, room: A, yes: false }, [], []],
    ['confirming', { type: 'confirmed', key: K, room: B, yes: true }, [confirming], []],
    ['confirming', { type: 'seatAnswered', act: 'remove', key: K, room: A, call: OK }, [confirming], []],
    ['confirming', { type: 'room', code: A }, [confirming], []],
    ['confirming', { type: 'room', code: B }, [], []],

    ['sent', { type: 'seatTapped', act: 'release', key: K, name: NAME, room: A }, [sent('release')], []],
    ['sent', { type: 'seatTapped', act: 'remove', key: K, name: NAME, room: A }, [sent('release')], []],
    ['sent', { type: 'confirmed', key: K, room: A, yes: true }, [sent('release')], []],
    ['sent', { type: 'seatAnswered', act: 'release', key: K, room: A, call: OK }, [], [{ type: 'told', act: 'release', key: K, name: NAME, call: OK }]],
    ['sent', { type: 'seatAnswered', act: 'release', key: K, room: A, call: OFFLINE }, [], [{ type: 'told', act: 'release', key: K, name: NAME, call: OFFLINE }]],
    ['sent', { type: 'seatAnswered', act: 'release', key: K, room: B, call: OK }, [sent('release')], []],
    ['sent', { type: 'seatAnswered', act: 'allow', key: K, room: A, call: OK }, [sent('release')], []],
    ['sent', { type: 'room', code: null }, [], []],
  ];

  test('every state meets every event', () => {
    const seen = new Set(T.map(([from, e]) => `${from} ${e.type}`));
    expect(seen.size).toBe(LOBBY_SEAT_STATES.length * LOBBY_SEAT_EVENTS.length);
  });

  for (const [from, e, to, effects] of T) {
    const what = e.type === 'seatTapped' ? `${e.act} in ${e.room ?? 'no room'}` : e.type === 'confirmed' ? `${e.yes ? 'yes' : 'no'} in ${e.room}` : e.type === 'seatAnswered' ? `${e.act} in ${e.room}` : `to ${e.code ?? 'no room'}`;
    test(`${from} + ${e.type} ${what}`, () => {
      expect(seatStep(SEATS[from], e)).toEqual({ state: to, effects: effects as never });
    });
  }

  test('a double tap on Release sends one request and tells one answer', () => {
    let s: LobbySeats = [];
    const fx: unknown[] = [];
    for (const e of [
      { type: 'seatTapped', act: 'release', key: K, name: NAME, room: A },
      { type: 'seatTapped', act: 'release', key: K, name: NAME, room: A },
      { type: 'seatAnswered', act: 'release', key: K, room: A, call: OK },
    ] as const) { const r = seatStep(s, e); s = r.state; fx.push(...r.effects); }
    expect(fx.map(x => (x as { type: string }).type)).toEqual(['send', 'told']);
  });

  test('Remove confirmed after the room changed under its window sends nothing, and an answer from the room left tells nothing', () => {
    const l = (es: LobbyEvent[]) => es.reduce<{ state: Lobby; effects: LobbyEffect[] }>((a, e) => { const r = lobbyStep(a.state, e); return { state: r.state, effects: [...a.effects, ...r.effects] }; }, { state: LOBBY_START, effects: [] });
    const confirmLate = l([{ type: 'seatTapped', act: 'remove', key: K, name: NAME, room: A }, { type: 'room', code: B }, { type: 'confirmed', key: K, room: A, yes: true }]);
    expect(confirmLate.effects.map(x => x.type)).toEqual(['confirm']);
    expect(confirmLate.state.seats).toEqual([]);
    const answerLate = l([{ type: 'seatTapped', act: 'allow', key: K, name: NAME, room: A }, { type: 'room', code: B }, { type: 'seatAnswered', act: 'allow', key: K, room: A, call: OK }]);
    expect(answerLate.effects.map(x => x.type)).toEqual(['send']);
  });

  test('each key has its own action: Release on one player waits while another player can be released', () => {
    const r = seatStep([sent('release')], { type: 'seatTapped', act: 'release', key: 'dev2:h_rin', name: 'Rin', room: A });
    expect(r.effects).toEqual([{ type: 'send', act: 'release', key: 'dev2:h_rin', room: A }]);
    expect(seatBusy(r.state, K, A)).toBe(true);
    expect(seatBusy(r.state, 'dev2:h_rin', A)).toBe(true);
    expect(seatBusy(r.state, K, B)).toBe(false);
    expect(seatBusy(r.state, K, null)).toBe(false);
  });
});
