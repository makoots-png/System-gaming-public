// A Create or Join tap (src/core/sync/attempt.ts): one tap at a time, each answered once, and a new hunter of a typed
// name made only in the write that binds it.
import { describe, expect, test } from 'bun:test';
import { ATTEMPT_STATES, NOBODY, NO_ATTEMPT, attemptStep, joinBinds } from '../src/core/sync/attempt.ts';
import type { Attempt, AttemptEffect, AttemptEvent, TapAnswer } from '../src/core/sync/attempt.ts';
import type { HunterId } from '../src/core/ids.ts';
import type { LinkNotice } from '../src/core/sync/link.ts';
import type { TapKind } from '../src/core/sync/taps.ts';
import {
  CODE, CREATE, CREATING, GEN, HEAD, IDLE, JOIN_GM, JOIN_PLAYER, LIVE_GM, LIVE_PLAYER, MIRA, NAMED, PEEK, PEEK_GM, PICKED, REPLY, START, UPGRADING, WALK_EVENTS, linked, tap,
} from './models/attempt-events.ts';
import type { Asked } from './models/attempt-events.ts';
import { hid } from './fixtures/ids.ts';

type S = Attempt<Asked>;
/** Runs events from `s`, answering the final state and every effect on the way. */
function run(s: S, ...events: AttemptEvent<Asked>[]): { state: S; effects: AttemptEffect<Asked>[] } {
  const effects: AttemptEffect<Asked>[] = [];
  for (const e of events) { const r = attemptStep(s, e); s = r.state; effects.push(...r.effects); }
  return { state: s, effects };
}
const answers = (fx: readonly AttemptEffect<Asked>[]): [Asked, TapAnswer][] => fx.flatMap(x => (x.type === 'answer' ? [[x.reply, x.answer] as [Asked, TapAnswer]] : []));
const ok = (value: string): TapAnswer => ({ ok: true, value });
const no = (kind: TapKind): TapAnswer => ({ ok: false, kind });

const creating = run(START, tap(CREATE, NOBODY, 'create'), linked(CREATE, CREATING)).state;
const asGM = run(START, tap(JOIN_GM, NOBODY, 'gm'), linked(JOIN_GM, PEEK_GM)).state;
const asMira = run(START, tap(JOIN_PLAYER, PICKED, 'mira'), linked(JOIN_PLAYER, PEEK)).state;
const asRin = run(START, tap(JOIN_PLAYER, NAMED, 'rin'), linked(JOIN_PLAYER, PEEK)).state;

describe('a Create or Join tap', () => {
  test('a tap with none out is handed to the link, and nothing answers it yet', () => {
    const r = attemptStep(START, tap(CREATE, NOBODY, 'create'));
    expect(r.state.at).toBe('handed');
    expect(r.effects).toEqual([{ type: 'link', tap: CREATE }]);
  });

  test('a tap while another is out starts nothing and is answered at once as busy, whatever the first one was', () => {
    const handed = attemptStep(START, tap(JOIN_GM, NOBODY, 'gm')).state;
    for (const s of [handed, creating, asGM, asMira, asRin]) {
      for (const second of [tap(CREATE, NOBODY, 'second'), tap(JOIN_PLAYER, PICKED, 'second')]) {
        const r = attemptStep(s, second);
        expect(r.state).toBe(s);
        expect(r.effects).toEqual([{ type: 'answer', reply: 'second', answer: no('busy') }]);
      }
    }
  });

  test('a create the link takes answers the new room\'s code once the link is in it', () => {
    expect(creating).toEqual({ at: 'creating', gen: GEN, reply: 'create' });
    const r = run(creating, linked(REPLY, LIVE_GM));
    expect(r.state).toEqual(NO_ATTEMPT);
    expect(answers(r.effects)).toEqual([['create', ok(CODE)]]);
  });

  test('a join of the room the phone is in, as the same role, answers that role', () => {
    for (const [join, link, role] of [[JOIN_GM, LIVE_GM, 'gm'], [JOIN_PLAYER, LIVE_PLAYER, 'player']] as const) {
      const r = run(START, tap(join, NOBODY, role), linked(join, link));
      expect(r.state).toEqual(NO_ATTEMPT);
      expect(answers(r.effects)).toEqual([[role, ok(role)]]);
    }
  });

  test('a join with the GM key answers gm, a player\'s join answers player', () => {
    expect(answers(run(asGM, linked(REPLY, LIVE_GM)).effects)).toEqual([['gm', ok('gm')]]);
    expect(answers(run(asMira, linked(REPLY, LIVE_PLAYER)).effects)).toEqual([['mira', ok('player')]]);
  });

  test('a tap the link does not take fails at once: busy while the link holds another, net with an update coming', () => {
    const handed = attemptStep(START, tap(JOIN_PLAYER, PICKED, 'mira')).state;
    const held = run(handed, linked(JOIN_PLAYER, CREATING));
    expect(held.state).toEqual(NO_ATTEMPT);
    expect(answers(held.effects)).toEqual([['mira', no('busy')]]);
    expect(answers(run(handed, linked(JOIN_PLAYER, UPGRADING)).effects)).toEqual([['mira', no('net')]]);
  });

  test('a link step for an event queued before the tap does not count as the link taking the tap', () => {
    const handed = attemptStep(START, tap(CREATE, NOBODY, 'create')).state;
    expect(attemptStep(handed, linked(REPLY, IDLE)).state).toBe(handed);
  });

  test('while the link stays in the tap\'s stretch nothing answers; leaving it ends the tap as its notice says', () => {
    expect(run(asMira, linked(REPLY, PEEK), linked(REPLY, HEAD)).effects).toEqual([]);
    const cases: [LinkNotice, TapKind][] = [['notFound', 'notfound'], ['keyRefused', 'keyRefused'], ['notAllowedBack', 'removed'], ['unreachable', 'net'], ['serverError', 'net'], ['replaced', 'replaced']];
    for (const [notice, kind] of cases) {
      const r = run(asMira, linked(REPLY, IDLE, [notice]));
      expect(r.state).toEqual(NO_ATTEMPT);
      expect(answers(r.effects)).toEqual([['mira', no(kind)]]);
    }
    expect(answers(run(asMira, linked(REPLY, LIVE_PLAYER, ['replaced'])).effects), 'a campaign replaced into a room is no join').toEqual([['mira', no('replaced')]]);
    expect(answers(run(creating, linked(REPLY, UPGRADING)).effects), 'left with no word').toEqual([['create', no('net')]]);
  });

  test('a join for a typed name changes nothing until it ends: a failed one makes no hunter, a joined one binds a new hunter of that name', () => {
    expect(asRin.at === 'joining' && asRin.joins).toEqual({ as: 'named', name: 'Rin' });
    expect(run(asRin, linked(REPLY, HEAD)).effects).toEqual([]);
    for (const n of ['notFound', 'notAllowedBack', 'unreachable', 'replaced'] as const) {
      expect(run(asRin, linked(REPLY, HEAD), linked(REPLY, IDLE, [n])).effects.map(x => x.type), `ended by ${n}`).toEqual(['answer']);
    }
    expect(joinBinds(asRin, () => MIRA, hid('h3'))).toEqual({ make: 'Rin' });
    expect(answers(run(asRin, linked(REPLY, LIVE_PLAYER)).effects)).toEqual([['rin', ok('player')]]);
  });

  test('a join binds the hunter picked while it is in the party, or else the active one; a GM\'s join binds the active one', () => {
    const active = hid('h3'), inParty = (id: string): HunterId | null => (id === MIRA ? MIRA : null);
    expect(joinBinds(asMira, inParty, active)).toEqual({ hunter: MIRA });
    expect(joinBinds(asMira, () => null, active), 'the picked hunter was deleted meanwhile').toEqual({ hunter: active });
    expect(joinBinds(asGM, inParty, active)).toEqual({ hunter: active });
    expect(joinBinds(START, inParty, active), 'no join out').toEqual({ hunter: active });
  });

  test('over random taps and link steps, every tap is answered exactly once, and only while the machine is back to no tap or refuses it', () => {
    let seed = 7;
    const rand = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed >>> 16) % n; };
    const seen = new Set<string>(ATTEMPT_STATES.filter(a => a === 'none'));
    for (let walk = 0; walk < 200; walk++) {
      let s: S = START, n = 0;
      const asked: string[] = [], told = new Map<string, number>();
      for (let i = 0; i < 30; i++) {
        const pick = WALK_EVENTS[rand(WALK_EVENTS.length)]!;
        const e = pick.type === 'tap' ? { ...pick, reply: `t${n++}` } : pick;
        if (e.type === 'tap') asked.push(e.reply);
        const r = attemptStep(s, e);
        s = r.state; seen.add(s.at);
        for (const [reply] of answers(r.effects)) told.set(reply, (told.get(reply) ?? 0) + 1);
        const open = s.at === 'none' ? null : s.reply;
        for (const a of asked) expect(told.get(a) ?? 0, `tap ${a}`).toBe(a === open ? 0 : 1);
      }
    }
    expect([...seen].sort()).toEqual([...ATTEMPT_STATES].sort());
  });
});
