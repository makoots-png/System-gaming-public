// The sheet push machine (src/core/sync/push.ts) and what the pill shows from the link and the push together
// (src/core/sync/connection.ts). Each test plays changes, timers and server replies and reads the state and effects.
import { describe, expect, test } from 'bun:test';
import { PUSH_OFF, reduce } from '../src/core/sync/push.ts';
import type { Push, PushEffect, PushEvent } from '../src/core/sync/push.ts';
import { connection, postNews, reportWords } from '../src/core/sync/connection.ts';
import type { Connection } from '../src/core/sync/connection.ts';
import { boot, reduce as linkReduce } from '../src/core/sync/link.ts';
import type { Gen, Link } from '../src/core/sync/link.ts';
import type { RoomCode } from '../src/core/protocol.ts';

const G = 7 as Gen;
type Reply = Extract<PushEvent, { gen: Gen }>;
type NoGen<T> = T extends unknown ? Omit<T, 'gen'> : never;

export function runPush(state: Push = PUSH_OFF) {
  let fx: PushEffect[] = [];
  const api = {
    get state(): Push { return state; },
    get fx(): PushEffect[] { return fx; },
    tap(e: PushEvent) { const r = reduce(state, e); state = r.state; fx = r.effects; return api; },
    reply(e: NoGen<Reply>) { return api.tap({ ...e, gen: state.at === 'off' ? G : state.gen } as Reply); },
    fire() { return api.tap({ type: 'timerFired', name: 'push' }); },
  };
  return api;
}
const sends = (fx: PushEffect[]): number => fx.filter(x => x.type === 'request').length;
const timers = (fx: PushEffect[]): number[] => fx.flatMap(x => (x.type === 'setTimer' ? [x.ms] : []));
/** Joined, the first send done: the server has the sheet. */
const inSync = () => runPush().tap({ type: 'linkLive', gen: G }).fire().reply({ type: 'sent' });

describe('sending changes', () => {
  test('joining sends the sheet 200 ms later', () => {
    const r = runPush().tap({ type: 'linkLive', gen: G });
    expect(r.state.at).toBe('waiting');
    expect(timers(r.fx)).toEqual([200]);
    r.fire();
    expect(r.state.at).toBe('sending');
    expect(r.fx).toContainEqual({ type: 'request', gen: G, timeoutMs: 30000, call: { req: 'sheet' } });
  });

  test('a change is sent 3 s later, and more changes inside those 3 s go in the same send', () => {
    const r = inSync().tap({ type: 'changed' });
    expect(timers(r.fx)).toEqual([3000]);
    r.tap({ type: 'changed' }).tap({ type: 'changed' });
    expect(r.fx).toEqual([]);
    r.fire();
    expect(sends(r.fx)).toBe(1);
    r.reply({ type: 'sent' });
    expect(r.state.at).toBe('clean');
  });

  test('a change while a send is out is sent 3 s after it, and only one send is out at a time', () => {
    const r = inSync().tap({ type: 'changed' }).fire().tap({ type: 'changed' });
    expect(sends(r.fx)).toBe(0);
    expect(r.state).toMatchObject({ at: 'sending', changedSince: true });
    r.reply({ type: 'sent' });
    expect(r.state.at).toBe('waiting');
    expect(timers(r.fx)).toEqual([3000]);
  });

  test('"Play as" another hunter sends the new sheet 200 ms later', () => {
    const r = inSync().tap({ type: 'rebound' });
    expect(timers(r.fx)).toEqual([200]);
  });
});

describe('when a send fails', () => {
  test('a send the server keeps failing is tried again after 3, 6, 12, 24, 48, then 60 s, and stays at 60 s', () => {
    const r = inSync().tap({ type: 'changed' }).fire();
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) { r.reply({ type: 'failed', kind: 'server' }); waits.push(...timers(r.fx)); r.fire(); }
    expect(waits).toEqual([3000, 6000, 12000, 24000, 48000, 60000, 60000, 60000]);
  });

  test('a good poll after a network failure sends again 400 ms later', () => {
    const r = inSync().tap({ type: 'changed' }).fire().reply({ type: 'failed', kind: 'net' }).reply({ type: 'pollOk' });
    expect(r.fx).toContainEqual({ type: 'clearTimer', name: 'push' });
    expect(timers(r.fx)).toEqual([400]);
  });

  test('a good poll does not cut short the wait after the server answered the send with an error', () => {
    const r = inSync().tap({ type: 'changed' }).fire().reply({ type: 'failed', kind: 'server' });
    const before = r.state;
    r.reply({ type: 'pollOk' });
    expect(r.state).toBe(before);
  });

  test('Try now cuts any wait short and sends 200 ms later', () => {
    const r = inSync().tap({ type: 'changed' }).fire().reply({ type: 'failed', kind: 'server' }).tap({ type: 'retry' });
    expect(timers(r.fx)).toEqual([200]);
    r.fire();
    expect(sends(r.fx)).toBe(1);
  });

  for (const why of ['too-large', 'room-full', 'bad'] as const) {
    test(`a sheet refused as ${why} is not sent again until the player changes it`, () => {
      const r = inSync().tap({ type: 'changed' }).fire().reply({ type: 'refused', why });
      expect(r.state).toMatchObject({ at: 'rejected', why });
      expect(timers(r.fx)).toEqual([]);
      r.tap({ type: 'changed' });
      expect(timers(r.fx)).toEqual([3000]);
    });
  }

  test('a sheet refused while a newer change waited sends the newer change', () => {
    const r = inSync().tap({ type: 'changed' }).fire().tap({ type: 'changed' }).reply({ type: 'refused', why: 'too-large' });
    expect(r.state.at).toBe('waiting');
  });
});

describe('a sheet another phone owns', () => {
  test('a locked sheet opens the locked window once and is tried again every 30 s until the GM releases it', () => {
    const r = inSync().tap({ type: 'changed' }).fire().reply({ type: 'notYours' });
    expect(r.state.at).toBe('locked');
    expect(r.fx).toContainEqual({ type: 'notify', id: 'locked' });
    expect(timers(r.fx)).toEqual([30000]);
    r.tap({ type: 'changed' });
    expect(r.fx).toEqual([]);
    r.fire().reply({ type: 'notYours' });
    expect(r.fx.some(x => x.type === 'notify')).toBe(false);
    expect(timers(r.fx)).toEqual([30000]);
    r.fire().reply({ type: 'sent' });
    expect(r.state.at).toBe('clean');
  });
});

describe('leaving the room', () => {
  test('leaving mid-send stops the push, and the send\'s late answer changes nothing', () => {
    const r = inSync().tap({ type: 'changed' }).fire().tap({ type: 'linkLost' });
    expect(r.state.at).toBe('off');
    for (const e of [{ type: 'sent', gen: G }, { type: 'failed', gen: G, kind: 'net' }, { type: 'notYours', gen: G }, { type: 'changed' }] as PushEvent[]) {
      r.tap(e);
      expect(r.state).toBe(PUSH_OFF);
      expect(r.fx).toEqual([]);
    }
  });

  test('leaving while a send waits clears its timer', () => {
    const r = inSync().tap({ type: 'changed' }).tap({ type: 'linkLost' });
    expect(r.fx).toContainEqual({ type: 'clearTimer', name: 'push' });
  });

  test('a send answered after a rejoin of the same room changes nothing', () => {
    const r = inSync().tap({ type: 'changed' }).fire().tap({ type: 'linkLost' }).tap({ type: 'linkLive', gen: (G + 2) as Gen });
    const before = r.state;
    r.tap({ type: 'failed', gen: G, kind: 'server' }).tap({ type: 'notYours', gen: G });
    expect(r.state).toBe(before);
  });
});

/** A player whose room poll answered, or failed when `failing`. */
function playerLink(failing = false): Link {
  const s = boot({ server: true, room: { code: 'ABC234' as RoomCode, key: null, cursor: 0 }, last: null }).state;
  return linkReduce(s, failing ? { type: 'failed', gen: s.gen, kind: 'net' } : { type: 'polled', gen: s.gen, cursor: 0, more: false, pace: 'table', fightAt: null }).state;
}

describe('what the pill shows', () => {
  const live = playerLink();
  test('a sheet the server would not take reads as not sent while the room polls fine', () => {
    expect(connection(live, inSync().tap({ type: 'changed' }).fire().reply({ type: 'refused', why: 'too-large' }).state), 'a sheet too large says so').toBe('sheetTooBig');
    expect(connection(live, inSync().tap({ type: 'changed' }).fire().reply({ type: 'refused', why: 'room-full' }).state)).toBe('notSent');
    expect(connection(live, inSync().tap({ type: 'changed' }).fire().reply({ type: 'failed', kind: 'server' }).state)).toBe('notSent');
  });
  test('a sheet in sync reads as live, a locked one as locked', () => {
    expect(connection(live, inSync().state)).toBe('live');
    expect(connection(live, inSync().tap({ type: 'changed' }).fire().reply({ type: 'notYours' }).state)).toBe('locked');
  });
  test('a failing poll reads as reconnecting whatever the push does', () => {
    const failing = playerLink(true);
    expect(connection(failing, inSync().state)).toBe('reconnecting');
    expect(connection(failing, inSync().state, true)).toBe('reconnecting');
  });
  test('a fight doc the room refused as too big reads as too big while the room polls fine, after a sheet not sent', () => {
    expect(connection(live, inSync().state, true)).toBe('tooBig');
    expect(connection(live, inSync().tap({ type: 'changed' }).fire().reply({ type: 'failed', kind: 'server' }).state, true)).toBe('notSent');
  });
});

describe('what a phone says of a message it just posted', () => {
  test('sent while the room answers this phone, even with its own sheet or doc held back; waiting in the outbox in every other state; nothing posted says why', () => {
    const goes: Connection[] = ['live', 'notSent', 'sheetTooBig', 'locked', 'tooBig'];
    const waits: Connection[] = ['waiting', 'reconnecting', 'connecting', 'upgrading', 'unreachable', 'ready', 'off', 'creating', 'joining'];
    for (const c of goes) expect(postNews({ ok: true }, c), c).toBe('sent');
    for (const c of waits) expect(postNews({ ok: true }, c), c).toBe('waits');
    for (const c of [...goes, ...waits]) {
      expect(postNews({ ok: false, why: 'noRoom' }, c)).toBe('noRoom');
      expect(postNews({ ok: false, why: 'notEvent' }, c)).toBe('refused');
    }
  });

  test('a use reported to the GM says it was sent only while the room answers, and that it reaches the GM later otherwise', () => {
    expect([reportWords('live'), reportWords('reconnecting'), reportWords('waiting')])
      .toEqual(['Sent to the GM.', 'Saved. The GM gets it when your phone reconnects to the room server.', 'Saved. The GM gets it once the room server confirms it.']);
  });
});
