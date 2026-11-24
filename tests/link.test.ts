// The room link machine (src/core/sync/link.ts): what a player or GM sees as the phone finds the server, opens, joins,
// leaves and loses a room. Each test plays taps, timers and server replies and reads the state and the effects.
import { describe, expect, test } from 'bun:test';
import { boot, hiddenWait, paceOf, reduce } from '../src/core/sync/link.ts';
import type { Gen, GmKey, Link, LinkCall, LinkEffect, LinkEvent, LinkResult, LinkNotice } from '../src/core/sync/link.ts';
import type { FightDoc, RoomCode } from '../src/core/protocol.ts';

export const ROOM_A = 'ABC234' as RoomCode;
export const ROOM_B = 'XYZ789' as RoomCode;
export const KEY_A = 'key-a' as GmKey;

type Reply = Extract<LinkEvent, { gen: Gen }>;
type NoGen<T> = T extends unknown ? Omit<T, 'gen'> : never;

/** Plays events one at a time. `fx` holds the effects of the last event only. */
export function run(first: LinkResult) {
  let state: Link = first.state, fx: LinkEffect[] = first.effects;
  const api = {
    get state(): Link { return state; },
    get fx(): LinkEffect[] { return fx; },
    tap(e: LinkEvent) { const r = reduce(state, e); state = r.state; fx = r.effects; return api; },
    /** A reply to the request the link has out now: it carries the current gen. */
    reply(e: NoGen<Reply>) { return api.tap({ ...e, gen: state.gen } as Reply); },
    /** The same reply, but for a request of an earlier gen. */
    late(e: NoGen<Reply>, gen: Gen) { return api.tap({ ...e, gen } as Reply); },
  };
  return api;
}
export const calls = (fx: LinkEffect[]): LinkCall[] => fx.flatMap(x => (x.type === 'request' ? [x.call] : []));
export const timers = (fx: LinkEffect[]): number[] => fx.flatMap(x => (x.type === 'setTimer' ? [x.ms] : []));
export const notices = (fx: LinkEffect[]): LinkNotice[] => fx.flatMap(x => (x.type === 'notify' ? [x.id] : []));
export const news = (fx: LinkEffect[]): string[] => fx.flatMap(x => (x.type === 'push' ? [x.event.type] : []));
export const saved = (fx: LinkEffect[]) => Object.assign({}, ...fx.flatMap(x => (x.type === 'save' ? [x.fields] : [])));

const fresh = () => run(boot({ server: true, room: null, last: null })).reply({ type: 'healthOk' });
/** A player live in room A, its first poll answered. */
export const playerInA = () => fresh().tap({ type: 'join', code: ROOM_A, key: null, from: null }).reply({ type: 'peeked', exists: true })
  .reply({ type: 'headed', cursor: 40, gm: false, kicked: false }).reply({ type: 'polled', cursor: 40, more: false, pace: 'table', fightAt: null });
const gmInA = () => fresh().tap({ type: 'create' }).reply({ type: 'created', code: ROOM_A, key: KEY_A })
  .reply({ type: 'polled', cursor: 0, more: false, pace: 'table', fightAt: null });

describe('finding the server', () => {
  test('a phone with no room server shows nothing and asks the network nothing', () => {
    const r = run(boot({ server: false, room: null, last: null }));
    expect(r.state.at).toBe('off');
    expect(calls(r.fx)).toEqual([]);
  });

  test('a phone with a server checks it at once, shows ready when it answers, and checks again every 5 s', () => {
    const r = run(boot({ server: true, room: null, last: null }));
    expect(calls(r.fx)).toEqual([{ req: 'health' }]);
    r.reply({ type: 'healthOk' });
    expect(r.state).toMatchObject({ at: 'idle', server: 'ok' });
    expect(timers(r.fx)).toEqual([5000]);
    r.tap({ type: 'timerFired', name: 'poll' });
    expect(calls(r.fx)).toEqual([{ req: 'health' }]);
  });

  test('a phone that comes back with a remembered room shows connecting and asks the room at once', () => {
    const r = run(boot({ server: true, room: { code: ROOM_A, key: null, cursor: 12 }, last: null }));
    expect(r.state).toMatchObject({ at: 'live', code: ROOM_A, health: 'connecting' });
    expect(calls(r.fx)).toEqual([{ req: 'poll', code: ROOM_A, cursor: 12, key: null }]);
    expect(news(r.fx)).toEqual(['linkLive']);
  });
});

describe('opening a room as GM', () => {
  test('Create shows creating, then the GM is live in the new room with its key saved', () => {
    const r = fresh().tap({ type: 'create' });
    expect(r.state.at).toBe('creating');
    expect(calls(r.fx)).toEqual([{ req: 'create' }]);
    r.reply({ type: 'created', code: ROOM_A, key: KEY_A });
    expect(r.state).toMatchObject({ at: 'live', code: ROOM_A, key: KEY_A, cursor: 0 });
    expect(saved(r.fx)).toEqual({ room: ROOM_A, gmKey: KEY_A, ring: { keep: ROOM_A, key: KEY_A } });
    expect(calls(r.fx)).toEqual([{ req: 'poll', code: ROOM_A, cursor: 0, key: KEY_A }]);
    expect(news(r.fx)).toEqual([]);
  });

  test('a second tap on Create while the first is out makes no second room', () => {
    const r = fresh().tap({ type: 'create' });
    const before = r.state;
    r.tap({ type: 'create' });
    expect(r.state).toBe(before);
    expect(r.fx).toEqual([]);
  });

  test('a Create the server cannot be reached for leaves the GM where they were, told the server is unreachable', () => {
    const r = fresh().tap({ type: 'create' }).reply({ type: 'failed', kind: 'net' });
    expect(r.state).toMatchObject({ at: 'idle', server: { unreachable: 1 } });
    expect(notices(r.fx)).toEqual(['unreachable']);
  });

  test('a GM reopens a room with its key and is live as GM', () => {
    const r = fresh().tap({ type: 'join', code: ROOM_A, key: KEY_A, from: null });
    expect(r.state).toMatchObject({ at: 'joining', step: 'peek' });
    expect(calls(r.fx)).toEqual([{ req: 'peek', code: ROOM_A }]);
    r.reply({ type: 'peeked', exists: true });
    expect(calls(r.fx)).toEqual([{ req: 'head', code: ROOM_A, key: KEY_A }]);
    r.reply({ type: 'headed', cursor: 77, gm: true, kicked: false });
    expect(r.state).toMatchObject({ at: 'live', code: ROOM_A, key: KEY_A, cursor: 77 });
    expect(saved(r.fx)).toMatchObject({ room: ROOM_A, cursor: 77, gmKey: KEY_A });
  });

  test('a key the room refuses is told as a refused key, drops that key and does not join as a player', () => {
    const r = fresh().tap({ type: 'join', code: ROOM_A, key: KEY_A, from: null }).reply({ type: 'peeked', exists: true })
      .reply({ type: 'headed', cursor: 77, gm: false, kicked: false });
    expect(r.state).toMatchObject({ at: 'idle', server: 'ok' });
    expect(notices(r.fx)).toEqual(['keyRefused']);
    expect(saved(r.fx)).toEqual({ ring: { drop: ROOM_A } });
    expect(news(r.fx)).toEqual([]);
  });
});

describe('joining as a player', () => {
  test('a join back into a room the phone was in reads on from where it stopped, so what came meanwhile is polled next; a room it was never in starts at its end', () => {
    const back = fresh().tap({ type: 'join', code: ROOM_A, key: null, from: 12 }).reply({ type: 'peeked', exists: true }).reply({ type: 'headed', cursor: 40, gm: false, kicked: false });
    expect(back.state).toMatchObject({ at: 'live', code: ROOM_A, cursor: 12 });
    expect(saved(back.fx)).toMatchObject({ room: ROOM_A, cursor: 12 });
    expect(calls(back.fx)).toEqual([{ req: 'poll', code: ROOM_A, cursor: 12, key: null }]);
    const first = fresh().tap({ type: 'join', code: ROOM_A, key: null, from: null }).reply({ type: 'peeked', exists: true }).reply({ type: 'headed', cursor: 40, gm: false, kicked: false });
    expect(first.state).toMatchObject({ at: 'live', cursor: 40 });
  });

  test('a place past the room\'s end is another room\'s: the join starts at the end', () => {
    const r = fresh().tap({ type: 'join', code: ROOM_A, key: null, from: 90 }).reply({ type: 'peeked', exists: true }).reply({ type: 'headed', cursor: 40, gm: false, kicked: false });
    expect(r.state).toMatchObject({ at: 'live', cursor: 40 });
  });

  test('a GM who reopens a room reads on from where its phone stopped, so players\' messages sent meanwhile are polled', () => {
    const r = fresh().tap({ type: 'join', code: ROOM_A, key: KEY_A, from: 12 }).reply({ type: 'peeked', exists: true }).reply({ type: 'headed', cursor: 40, gm: true, kicked: false });
    expect(calls(r.fx)).toEqual([{ req: 'poll', code: ROOM_A, cursor: 12, key: KEY_A }]);
  });

  test('Join shows joining, then the player is live at the head of the room and the sheet push starts', () => {
    const r = fresh().tap({ type: 'join', code: ROOM_A, key: null, from: null });
    expect(r.state.at).toBe('joining');
    r.reply({ type: 'peeked', exists: true });
    expect(calls(r.fx)).toEqual([{ req: 'head', code: ROOM_A, key: null }]);
    r.reply({ type: 'headed', cursor: 40, gm: false, kicked: false });
    expect(r.state).toMatchObject({ at: 'live', code: ROOM_A, key: null, cursor: 40, health: 'ok' });
    expect(saved(r.fx)).toMatchObject({ room: ROOM_A, cursor: 40, gmKey: null });
    expect(news(r.fx)).toEqual(['linkLive']);
    expect(calls(r.fx)).toEqual([{ req: 'poll', code: ROOM_A, cursor: 40, key: null }]);
  });

  test('a second Join while one is out is ignored', () => {
    const r = fresh().tap({ type: 'join', code: ROOM_A, key: null, from: null });
    const before = r.state;
    r.tap({ type: 'join', code: ROOM_B, key: null, from: null });
    expect(r.state).toBe(before);
  });

  test('a player who rejoins their room as its GM opens it as GM', () => {
    const r = playerInA().tap({ type: 'join', code: ROOM_A, key: KEY_A, from: null });
    expect(r.state).toMatchObject({ at: 'joining', step: 'peek' });
    expect(calls(r.fx)).toHaveLength(1);
  });

  test('a join of the room the phone is in, as the same role, changes nothing', () => {
    const player = playerInA(), before = player.state;
    player.tap({ type: 'join', code: ROOM_A, key: null, from: null });
    expect(player.state).toBe(before);
    const gm = gmInA(), gmBefore = gm.state;
    gm.tap({ type: 'join', code: ROOM_A, key: KEY_A, from: null });
    expect(gm.state).toBe(gmBefore);
  });

  test('a room that is gone says so, and marks the last room gone when it was that room', () => {
    const r = playerInA().tap({ type: 'leave' }).tap({ type: 'join', code: ROOM_A, key: null, from: null }).reply({ type: 'peeked', exists: false });
    expect(r.state).toMatchObject({ at: 'idle', last: { code: ROOM_A, why: 'gone' } });
    expect(notices(r.fx)).toEqual(['notFound']);
  });

  test('a GM reopening a room the server no longer has loses that room\'s key, so it is not offered again', () => {
    const r = gmInA().tap({ type: 'leave' }).tap({ type: 'join', code: ROOM_A, key: KEY_A, from: null }).reply({ type: 'peeked', exists: false });
    expect(r.state).toMatchObject({ at: 'idle', last: { code: ROOM_A, why: 'gone' } });
    expect(notices(r.fx)).toEqual(['notFound']);
    expect(saved(r.fx)).toMatchObject({ last: { code: ROOM_A, why: 'gone' }, ring: { gone: ROOM_A } });
    const head = gmInA().tap({ type: 'leave' }).tap({ type: 'join', code: ROOM_B, key: KEY_A, from: null }).reply({ type: 'peeked', exists: true }).reply({ type: 'gone' });
    expect(saved(head.fx)).toEqual({ ring: { gone: ROOM_B } });
  });
});

describe('in a room', () => {
  test('a GM polls every 5 s, and every 3 s while a fight runs', () => {
    const r = gmInA();
    expect(timers(r.fx)).toEqual([5000]);
    r.tap({ type: 'timerFired', name: 'poll' }).reply({ type: 'polled', cursor: 3, more: false, pace: 'fight', fightAt: null });
    expect(timers(r.fx)).toEqual([3000]);
  });

  test('a full page is followed by the next page at once, and every page is applied', () => {
    const r = gmInA().tap({ type: 'timerFired', name: 'poll' }).reply({ type: 'polled', cursor: 200, more: true, pace: 'table', fightAt: null });
    expect(r.fx.some(x => x.type === 'apply')).toBe(true);
    expect(calls(r.fx)).toEqual([{ req: 'poll', code: ROOM_A, cursor: 200, key: KEY_A }]);
    expect(timers(r.fx)).toEqual([]);
    expect(saved(r.fx)).toEqual({ cursor: 200 });
  });

  test('a failing poll shows reconnecting and waits 5, 10, 20, then 30 s, and stays at 30 s', () => {
    const r = playerInA();
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      r.tap({ type: 'timerFired', name: 'poll' }).reply({ type: 'failed', kind: 'net' });
      waits.push(...timers(r.fx));
    }
    expect(waits).toEqual([5000, 10000, 20000, 30000, 30000, 30000]);
    expect(r.state).toMatchObject({ at: 'live', health: { failed: 6 } });
  });

  test('a poll that answers again shows live, says the server is back and polls every 5 s again', () => {
    const r = playerInA().tap({ type: 'timerFired', name: 'poll' }).reply({ type: 'failed', kind: 'net' })
      .tap({ type: 'timerFired', name: 'poll' }).reply({ type: 'polled', cursor: 41, more: false, pace: 'table', fightAt: null });
    expect(r.state).toMatchObject({ at: 'live', health: 'ok' });
    expect(r.fx).toContainEqual({ type: 'status', serverBack: true });
    expect(timers(r.fx)).toEqual([5000]);
    expect(news(r.fx)).toEqual(['pollOk']);
  });

  test('Try now polls at once instead of waiting out the 30 s, and tells the sheet push', () => {
    const r = playerInA();
    for (let i = 0; i < 4; i++) r.tap({ type: 'timerFired', name: 'poll' }).reply({ type: 'failed', kind: 'net' });
    r.tap({ type: 'retry' });
    expect(r.fx).toContainEqual({ type: 'clearTimer', name: 'poll' });
    expect(calls(r.fx)).toEqual([{ req: 'poll', code: ROOM_A, cursor: 40, key: null }]);
    expect(news(r.fx)).toEqual(['retry']);
  });

  test('Try now while a poll is out sends no second poll', () => {
    const r = playerInA().tap({ type: 'timerFired', name: 'poll' }).tap({ type: 'retry' });
    expect(calls(r.fx)).toEqual([]);
  });

  test('the phone going offline shows reconnecting at once', () => {
    const r = playerInA().tap({ type: 'offline' });
    expect(r.state).toMatchObject({ at: 'live', health: { failed: 1 } });
  });

  test('a room that is gone sends the player out with a notice, remembers it as gone and stops the push', () => {
    const r = playerInA().tap({ type: 'timerFired', name: 'poll' }).reply({ type: 'gone' });
    expect(r.state).toMatchObject({ at: 'idle', last: { code: ROOM_A, why: 'gone' } });
    expect(notices(r.fx)).toEqual(['gone']);
    expect(news(r.fx)).toEqual(['linkLost']);
    expect(saved(r.fx)).toMatchObject({ room: null, cursor: 0 });
  });

  test('a room that is gone under the GM takes its key out of the ring; a player has no key to lose', () => {
    const r = gmInA().tap({ type: 'timerFired', name: 'poll' }).reply({ type: 'gone' });
    expect(r.state).toMatchObject({ at: 'idle', last: { code: ROOM_A, why: 'gone' } });
    expect(saved(r.fx)).toMatchObject({ room: null, ring: { gone: ROOM_A } });
    expect(saved(playerInA().tap({ type: 'timerFired', name: 'poll' }).reply({ type: 'gone' }).fx).ring).toBeUndefined();
  });
});

describe('removed by the GM', () => {
  test('a removed player is sent out with the removed window, and the room is remembered as removed', () => {
    const r = playerInA().reply({ type: 'removed' });
    expect(r.state).toMatchObject({ at: 'idle', last: { code: ROOM_A, why: 'removed' } });
    expect(notices(r.fx)).toEqual(['removed']);
    expect(news(r.fx)).toEqual(['linkLost']);
  });

  test('Rejoin before the GM allows it back is told not yet, and the player stays out', () => {
    const r = playerInA().reply({ type: 'removed' }).tap({ type: 'join', code: ROOM_A, key: null, from: null }).reply({ type: 'peeked', exists: true })
      .reply({ type: 'headed', cursor: 50, gm: false, kicked: true });
    expect(r.state).toMatchObject({ at: 'idle', last: { code: ROOM_A, why: 'removed' } });
    expect(notices(r.fx)).toEqual(['notAllowedBack']);
  });

  test('Rejoin after Allow back puts the player live in the room again', () => {
    const r = playerInA().reply({ type: 'removed' }).tap({ type: 'join', code: ROOM_A, key: null, from: null }).reply({ type: 'peeked', exists: true })
      .reply({ type: 'headed', cursor: 50, gm: false, kicked: false });
    expect(r.state).toMatchObject({ at: 'live', code: ROOM_A, cursor: 50, last: null });
  });

  test('a GM is never removed', () => {
    const r = gmInA();
    const before = r.state;
    r.reply({ type: 'removed' });
    expect(r.state).toBe(before);
  });
});

describe('a GM key the server stops taking', () => {
  test('a GM whose key no longer works is told, leaves the room and loses that key', () => {
    const r = gmInA();
    const old = r.state.gen;
    r.reply({ type: 'keyLost' });
    expect(r.state).toMatchObject({ at: 'idle', last: { code: ROOM_A, why: 'left' } });
    expect(notices(r.fx)).toEqual(['keyLost']);
    expect(saved(r.fx)).toMatchObject({ room: null, ring: { drop: ROOM_A } });
    expect(r.fx).toContainEqual({ type: 'abort', gen: old });
  });

  test('a player is never told about a GM key', () => {
    const r = playerInA();
    const before = r.state;
    r.reply({ type: 'keyLost' });
    expect(r.state).toBe(before);
  });

  test('a key lost answer from before a Leave changes nothing', () => {
    const r = gmInA();
    const old = r.state.gen;
    r.tap({ type: 'leave' });
    const before = r.state;
    r.late({ type: 'keyLost' }, old);
    expect(r.state).toBe(before);
  });
});

describe('leaving', () => {
  test('Leave puts the player out of the room, remembers it, stops its polls and its push, and checks the server', () => {
    const r = playerInA().tap({ type: 'timerFired', name: 'poll' });
    const old = r.state.gen;
    r.tap({ type: 'leave' });
    expect(r.state).toMatchObject({ at: 'idle', server: 'ok', last: { code: ROOM_A, why: 'left' } });
    expect(r.fx).toContainEqual({ type: 'abort', gen: old });
    expect(news(r.fx)).toEqual(['linkLost']);
    expect(saved(r.fx)).toEqual({ room: null, cursor: 0, last: { code: ROOM_A, why: 'left' }, gmKey: null });
    expect(timers(r.fx)).toEqual([5000]);
  });

  test('a GM who leaves keeps no GM key for the room it left: the key stays only in the ring (SMX-sync-12.1)', () => {
    const r = gmInA().tap({ type: 'leave' });
    expect(r.state).toMatchObject({ at: 'idle', last: { code: ROOM_A, why: 'left' } });
    expect(saved(r.fx)).toEqual({ room: null, last: { code: ROOM_A, why: 'left' }, gmKey: null });
  });

  test('a GM sent out of a room (gone, its key lost) keeps no GM key either', () => {
    expect(saved(gmInA().tap({ type: 'timerFired', name: 'poll' }).reply({ type: 'gone' }).fx)).toMatchObject({ room: null, gmKey: null });
    expect(saved(gmInA().reply({ type: 'keyLost' }).fx)).toMatchObject({ room: null, gmKey: null });
  });

  test('Leave while reconnecting shows the server as unreachable and keeps the wait', () => {
    const r = playerInA().tap({ type: 'timerFired', name: 'poll' }).reply({ type: 'failed', kind: 'net' })
      .tap({ type: 'timerFired', name: 'poll' }).reply({ type: 'failed', kind: 'net' }).tap({ type: 'leave' });
    expect(r.state).toMatchObject({ at: 'idle', server: { unreachable: 2 } });
    expect(timers(r.fx)).toEqual([10000]);
  });

  // the table: creating × leave. Later in first-run setup and Leave room both send `leave` while a Create is out
  test('a Create cancelled before the server answers opens no room: the phone is where it was, and the room\'s answer is dropped', () => {
    const r = fresh().tap({ type: 'create' });
    const old = r.state.gen;
    r.tap({ type: 'leave' });
    expect(r.state).toMatchObject({ at: 'idle', server: 'ok', last: null, next: 'timer' });
    expect(r.state.gen).not.toBe(old);
    expect(r.fx).toContainEqual({ type: 'abort', gen: old });
    expect(calls(r.fx)).toEqual([]);
    expect(timers(r.fx)).toEqual([5000]);
    expect(notices(r.fx)).toEqual([]);
    expect(saved(r.fx), 'the save held no room while the create was out, and holds none now').toEqual({});
    const out = r.state;
    r.late({ type: 'created', code: ROOM_A, key: KEY_A }, old);
    expect(r.state, 'the room the server made meanwhile is not entered').toBe(out);
    expect(r.fx, 'nor is its code or GM key kept').toEqual([]);
  });

  test('a GM in a room who starts a new room and taps Leave room is out of both: the room they were in is the last room, and the save keeps no key', () => {
    const r = gmInA().tap({ type: 'create' });
    const old = r.state.gen;
    r.tap({ type: 'leave' });
    expect(r.state).toMatchObject({ at: 'idle', server: 'ok', last: { code: ROOM_A, why: 'left' } });
    expect(r.fx).toContainEqual({ type: 'abort', gen: old });
    expect(saved(r.fx)).toEqual({ room: null, last: { code: ROOM_A, why: 'left' }, gmKey: null });
    expect(calls(r.fx)).toEqual([]);
    const out = r.state;
    r.late({ type: 'created', code: ROOM_B, key: KEY_A }, old);
    expect(r.state).toBe(out);
  });

  test('a Create cancelled on a page with no room server leaves the page with no room server', () => {
    const r = run(boot({ server: false, room: null, last: null })).tap({ type: 'create' });
    const old = r.state.gen;
    r.tap({ type: 'leave' });
    expect(r.state.at).toBe('off');
    expect(r.fx).toContainEqual({ type: 'abort', gen: old });
    expect(timers(r.fx)).toEqual([]);
  });

  // the table: joining × leave. Leave room while a Join is out (a player switching rooms from an invite) goes out of
  // every room on a new gen, as creating × leave does: the join's answers are stale, so its room is never entered
  test('a Join cancelled while the room is looked up lands in no room: the phone is where it was, and the room\'s answers are dropped', () => {
    const r = fresh().tap({ type: 'join', code: ROOM_A, key: null, from: null });
    const old = r.state.gen;
    r.tap({ type: 'leave' });
    expect(r.state).toMatchObject({ at: 'idle', server: 'ok', last: null, next: 'timer' });
    expect(r.state.gen).not.toBe(old);
    expect(r.fx).toContainEqual({ type: 'abort', gen: old });
    expect(calls(r.fx)).toEqual([]);
    expect(timers(r.fx)).toEqual([5000]);
    expect(notices(r.fx)).toEqual([]);
    expect(news(r.fx), 'no sheet push starts').toEqual([]);
    expect(saved(r.fx), 'the save held no room while the join was out, and holds none now').toEqual({});
    const out = r.state;
    r.late({ type: 'peeked', exists: true }, old);
    expect(r.state, 'the room found meanwhile is not asked for its head').toBe(out);
    expect(r.fx).toEqual([]);
  });

  test('a GM\'s Join cancelled while the room\'s head is out keeps no key and enters no room when the head answers', () => {
    const r = fresh().tap({ type: 'join', code: ROOM_A, key: KEY_A, from: null }).reply({ type: 'peeked', exists: true });
    const old = r.state.gen;
    r.tap({ type: 'leave' });
    expect(r.state).toMatchObject({ at: 'idle', last: null });
    expect(r.fx).toContainEqual({ type: 'abort', gen: old });
    expect(saved(r.fx)).toEqual({});
    const out = r.state;
    r.late({ type: 'headed', cursor: 40, gm: true, kicked: false }, old);
    expect(r.state, 'the room is not entered').toBe(out);
    expect(r.fx, 'nor is its key kept, nor its head applied').toEqual([]);
  });

  test('a player in a room who switches to another and taps Leave room is out of both: the room they were in is the last room', () => {
    const r = playerInA().tap({ type: 'join', code: ROOM_B, key: null, from: null });
    const old = r.state.gen;
    r.tap({ type: 'leave' });
    expect(r.state).toMatchObject({ at: 'idle', server: 'ok', last: { code: ROOM_A, why: 'left' } });
    expect(r.fx).toContainEqual({ type: 'abort', gen: old });
    expect(saved(r.fx)).toEqual({ room: null, cursor: 0, last: { code: ROOM_A, why: 'left' }, gmKey: null });
    expect(calls(r.fx)).toEqual([]);
    expect(notices(r.fx)).toEqual([]);
    const out = r.state;
    r.late({ type: 'peeked', exists: true }, old).late({ type: 'headed', cursor: 7, gm: false, kicked: false }, old);
    expect(r.state, 'room B is not entered').toBe(out);
  });

  test('a Join cancelled on a page with no room server leaves the page with no room server', () => {
    const r = run(boot({ server: false, room: null, last: null })).tap({ type: 'join', code: ROOM_A, key: null, from: null });
    const old = r.state.gen;
    r.tap({ type: 'leave' });
    expect(r.state.at).toBe('off');
    expect(r.fx).toContainEqual({ type: 'abort', gen: old });
    expect(timers(r.fx)).toEqual([]);
  });

  test('Forget clears the last room', () => {
    const r = playerInA().tap({ type: 'leave' }).tap({ type: 'forget' });
    expect(r.state).toMatchObject({ at: 'idle', last: null });
    expect(saved(r.fx)).toEqual({ last: null });
  });
});

describe('a tab that stops saving (SMX-sync-1)', () => {
  test('a player whose tab stops saving is out of the room and told; the save keeps the room and where it stopped reading, and no poll moves past it', () => {
    const r = playerInA().tap({ type: 'timerFired', name: 'poll' });
    const old = r.state.gen;
    r.tap({ type: 'readOnly' });
    expect(r.state).toMatchObject({ at: 'idle', server: 'ok', last: null });
    expect(notices(r.fx)).toEqual(['readOnly']);
    expect(saved(r.fx), 'nothing is written: the save still says room A at cursor 40').toEqual({});
    expect(r.fx).toContainEqual({ type: 'abort', gen: old });
    expect(news(r.fx)).toEqual(['linkLost']);
    expect(calls(r.fx)).toEqual([]);
    const page = r.state;
    r.late({ type: 'polled', cursor: 55, more: false, pace: 'table', fightAt: null }, old);
    expect(r.state, 'the poll that was out lands nowhere').toBe(page);
  });

  test('a GM whose tab stops saving leaves the room too, so it never puts the room\'s docs back to its own frozen save', () => {
    const r = gmInA().tap({ type: 'readOnly' });
    expect(r.state).toMatchObject({ at: 'idle' });
    expect(notices(r.fx)).toEqual(['readOnly']);
    expect(saved(r.fx)).toEqual({});
  });

  test('a create or a join under way ends where the tab was not in a room, and the tap is told', () => {
    const join = fresh().tap({ type: 'join', code: ROOM_B, key: null, from: null }).reply({ type: 'peeked', exists: true });
    const old = join.state.gen;
    join.tap({ type: 'readOnly' });
    expect(join.state).toMatchObject({ at: 'idle' });
    expect(notices(join.fx)).toEqual(['readOnly']);
    expect(join.fx).toContainEqual({ type: 'abort', gen: old });
    join.late({ type: 'headed', cursor: 9, gm: false, kicked: false }, old);
    expect(join.state.at, 'the room\'s late answer does not put the tab in it').toBe('idle');

    const create = gmInA().tap({ type: 'create' }).tap({ type: 'readOnly' });
    expect(create.state, 'from a room, the create ends out of every room').toMatchObject({ at: 'idle' });
    expect(notices(create.fx)).toEqual(['readOnly']);
    expect(saved(create.fx)).toEqual({});
  });

  test('a tab out of a room, with no server, or updating, has nothing to leave', () => {
    for (const r of [fresh(), run(boot({ server: false, room: null, last: null }))]) {
      const before = r.state;
      expect(r.tap({ type: 'readOnly' }).state).toBe(before);
      expect(r.fx).toEqual([]);
    }
    const up = playerInA().tap({ type: 'upgrade', stuck: false });
    const before = up.state;
    expect(up.tap({ type: 'readOnly' }).state).toBe(before);
  });

  test('a restore, an import or a reset makes the tab save again, and the link enters the room the save holds', () => {
    const r = playerInA().tap({ type: 'readOnly' }).tap({ type: 'replaced', room: { code: ROOM_A, key: null, cursor: 40 }, last: null });
    expect(r.state).toMatchObject({ at: 'live', code: ROOM_A, cursor: 40 });
    expect(calls(r.fx)).toEqual([{ req: 'poll', code: ROOM_A, cursor: 40, key: null }]);
  });
});

describe('the campaign is replaced (import, restore, reset)', () => {
  test('a player whose campaign is replaced by a file in another room moves to that room and its old requests are dropped', () => {
    const r = playerInA().tap({ type: 'timerFired', name: 'poll' });
    const old = r.state.gen;
    r.tap({ type: 'replaced', room: { code: ROOM_B, key: null, cursor: 3 }, last: null });
    expect(r.state).toMatchObject({ at: 'live', code: ROOM_B, key: null, cursor: 3, health: 'connecting' });
    expect(r.fx).toContainEqual({ type: 'abort', gen: old });
    expect(calls(r.fx)).toEqual([{ req: 'poll', code: ROOM_B, cursor: 3, key: null }]);
    expect(news(r.fx)).toEqual(['linkLost', 'linkLive']);
    const before = r.state;
    r.late({ type: 'polled', cursor: 41, more: false, pace: 'table', fightAt: null }, old);
    expect(r.state).toBe(before);
  });

  test('a GM whose campaign is replaced by a file with no room is out of the room, and the file\'s last room is offered', () => {
    const r = gmInA().tap({ type: 'replaced', room: null, last: { code: ROOM_B, why: 'left' } });
    expect(r.state).toMatchObject({ at: 'idle', server: 'ok', last: { code: ROOM_B, why: 'left' } });
    expect(r.fx).toContainEqual({ type: 'clearTimer', name: 'poll' });
    expect(timers(r.fx)).toEqual([5000]);
    expect(notices(r.fx)).toEqual([]);
  });

  test('a file in the same room starts the room again from the file\'s place in it', () => {
    const r = playerInA().tap({ type: 'replaced', room: { code: ROOM_A, key: null, cursor: 7 }, last: null });
    expect(r.state).toMatchObject({ at: 'live', code: ROOM_A, cursor: 7, health: 'connecting' });
    expect(calls(r.fx)).toEqual([{ req: 'poll', code: ROOM_A, cursor: 7, key: null }]);
  });

  test('a join in progress ends, the tap is told the campaign was replaced (not that the server is unreachable), and the link follows the file', () => {
    const r = fresh().tap({ type: 'join', code: ROOM_B, key: null, from: null });
    const old = r.state.gen;
    r.tap({ type: 'replaced', room: { code: ROOM_A, key: KEY_A, cursor: 0 }, last: null });
    expect(r.state).toMatchObject({ at: 'live', code: ROOM_A, key: KEY_A });
    expect(r.fx).toContainEqual({ type: 'abort', gen: old });
    expect(notices(r.fx)).toEqual(['replaced']);
  });

  test('a Create in progress ends the same way, and a replace with no tap running tells nobody', () => {
    const r = fresh().tap({ type: 'create' }).tap({ type: 'replaced', room: null, last: null });
    expect(r.state).toMatchObject({ at: 'idle' });
    expect(notices(r.fx)).toEqual(['replaced']);
    expect(notices(playerInA().tap({ type: 'replaced', room: null, last: null }).fx)).toEqual([]);
  });

  test('a phone with no room server or one that is updating ignores it', () => {
    const off = run(boot({ server: false, room: null, last: null }));
    const before = off.state;
    off.tap({ type: 'replaced', room: { code: ROOM_A, key: null, cursor: 0 }, last: null });
    expect(off.state).toBe(before);
    const up = playerInA().tap({ type: 'upgrade', stuck: false });
    const was = up.state;
    up.tap({ type: 'replaced', room: null, last: null });
    expect(up.state).toBe(was);
  });
});

describe('another build answered', () => {
  test('an upgrade answer stops the room, the push and the timers, and nothing moves it after', () => {
    const r = playerInA().tap({ type: 'upgrade', stuck: false });
    expect(r.state).toMatchObject({ at: 'upgrading', stuck: false });
    expect(r.fx).toContainEqual({ type: 'clearTimer', name: 'poll' });
    expect(news(r.fx)).toEqual(['linkLost']);
    const before = r.state;
    for (const e of [{ type: 'join', code: ROOM_B, key: null, from: null }, { type: 'create' }, { type: 'retry' }, { type: 'online' }] as LinkEvent[]) {
      r.tap(e);
      expect(r.state).toBe(before);
    }
  });

  test('when the reload did not help the player is told the app is stuck', () => {
    const r = playerInA().tap({ type: 'upgrade', stuck: false }).tap({ type: 'upgrade', stuck: true });
    expect(r.state).toMatchObject({ at: 'upgrading', stuck: true });
    expect(notices(r.fx)).toEqual(['upgradeStuck']);
  });
});

describe('late replies', () => {
  test('a poll answer from before a Leave and a rejoin of the same room changes nothing', () => {
    const r = playerInA().tap({ type: 'timerFired', name: 'poll' });
    const old = r.state.gen;
    r.tap({ type: 'leave' }).tap({ type: 'join', code: ROOM_A, key: null, from: null }).reply({ type: 'peeked', exists: true })
      .reply({ type: 'headed', cursor: 90, gm: false, kicked: false });
    const before = r.state;
    r.late({ type: 'polled', cursor: 41, more: false, pace: 'table', fightAt: null }, old).late({ type: 'gone' }, old).late({ type: 'removed' }, old);
    expect(r.state).toBe(before);
    expect(r.fx).toEqual([]);
  });

  test('a reply delivered twice is taken once', () => {
    const r = playerInA().tap({ type: 'timerFired', name: 'poll' }).reply({ type: 'polled', cursor: 41, more: false, pace: 'table', fightAt: null });
    const before = r.state;
    r.reply({ type: 'polled', cursor: 41, more: false, pace: 'table', fightAt: null });
    expect(r.state).toBe(before);
    expect(r.fx).toEqual([]);
  });
});

describe('a player\'s own move in a fight', () => {
  const polled = (fightAt: string | null) => ({ type: 'polled', cursor: 41, more: false, pace: 'fight', fightAt } as const);

  test('a player who sends a move polls at once, then every 300 ms until the fight doc moves on, then every 3 s again', () => {
    const r = playerInA().tap({ type: 'timerFired', name: 'poll' }).reply(polled('t1'));
    r.tap({ type: 'sent', from: 't1' });
    expect(r.fx).toContainEqual({ type: 'clearTimer', name: 'poll' });
    expect(calls(r.fx)).toEqual([{ req: 'poll', code: ROOM_A, cursor: 41, key: null }]);
    r.reply(polled('t1'));
    expect(timers(r.fx)).toEqual([300]);
    r.tap({ type: 'timerFired', name: 'poll' }).reply(polled('t2'));
    expect(timers(r.fx)).toEqual([3000]);
    expect(r.state).toMatchObject({ at: 'live', chase: null });
  });

  test('a move whose answer never comes is chased ten polls, three seconds, and then the phone polls at its pace', () => {
    const r = playerInA().tap({ type: 'sent', from: 't1' });
    const waits: number[] = [];
    for (let i = 0; i < 12; i++) { r.reply(polled('t1')); waits.push(...timers(r.fx)); r.tap({ type: 'timerFired', name: 'poll' }); }
    expect(waits).toEqual([300, 300, 300, 300, 300, 300, 300, 300, 300, 3000, 3000, 3000]);
  });

  test('a move sent while a poll is out is chased once that poll answers', () => {
    const r = playerInA().tap({ type: 'timerFired', name: 'poll' }).tap({ type: 'sent', from: 't1' });
    expect(calls(r.fx)).toEqual([]);
    r.reply(polled('t1'));
    expect(timers(r.fx)).toEqual([300]);
  });

  test('a GM\'s phone does not chase, and a failed poll ends the chase', () => {
    const gm = gmInA(), before = gm.state;
    gm.tap({ type: 'sent', from: 't1' });
    expect(gm.state).toBe(before);
    const r = playerInA().tap({ type: 'sent', from: 't1' }).reply({ type: 'failed', kind: 'net' });
    expect(r.state).toMatchObject({ chase: null });
    expect(timers(r.fx)).toEqual([5000]);
  });

  test('a GM whose fight doc goes out with a player\'s turn polls a second later, not at the old pace', () => {
    const r = gmInA().tap({ type: 'paced', pace: 'turn' });
    expect(timers(r.fx)).toEqual([1000]);
    r.tap({ type: 'paced', pace: 'turn' });
    expect(r.fx).toEqual([]);
    r.tap({ type: 'timerFired', name: 'poll' }).tap({ type: 'paced', pace: 'fight' });
    expect(timers(r.fx)).toEqual([]);
    r.reply({ type: 'polled', cursor: 3, more: false, pace: 'fight', fightAt: 't1' });
    expect(timers(r.fx)).toEqual([3000]);
  });

  test('a GM polls every second while a player\'s hunter has the turn, and every 3 s on any other turn', () => {
    const r = gmInA().tap({ type: 'timerFired', name: 'poll' }).reply({ type: 'polled', cursor: 3, more: false, pace: 'turn', fightAt: 't1' });
    expect(timers(r.fx)).toEqual([1000]);
    const doc = (key: string | null) => ({ ended: false, active: true, currentId: 'c1', rows: [{ id: 'c1', key }] }) as unknown as FightDoc;
    expect(paceOf(doc('d-player:h1'), true, 'd-gm')).toBe('turn');
    expect(paceOf(doc('d-gm:h2'), true, 'd-gm')).toBe('fight');
    expect(paceOf(doc(null), true, 'd-gm')).toBe('fight');
    expect(paceOf(doc('d-other:h1'), false, 'd-player')).toBe('fight');
    expect(paceOf(null, true, 'd-gm')).toBe('table');
    // GM polls every second while waiting on a remote hunter's dodge, even on a monster's turn
    const dodging = (whoKey: string | null) => ({
      ended: false, active: true, currentId: 'm1',
      rows: [{ id: 'm1', key: null }, { id: 'h1', key: whoKey }],
      dodge: { n: 1, who: 'h1', by: 'm1', ability: 'Blast', mode: 'out', tiles: '1+2', auto: { x: 1, y: 0 }, hit: '', ring: '' },
    }) as unknown as FightDoc;
    expect(paceOf(dodging('d-player:h1'), true, 'd-gm')).toBe('turn');
    expect(paceOf(dodging('d-gm:h1'), true, 'd-gm')).toBe('fight');
    expect(paceOf(dodging('d-player:h1'), false, 'd-player')).toBe('fight');
  });
});

describe('a hidden page', () => {
  test('a GM in a live room who allowed notifications polls every 30 s while the page is hidden, never more often', () => {
    const gm = gmInA();
    expect(hiddenWait(gm.state, 5000, true)).toBe(30000);
    expect(hiddenWait(gm.state, 3000, true)).toBe(30000);
    gm.tap({ type: 'offline' });
    expect(hiddenWait(gm.state, 60000, true)).toBe(60000);
  });

  test('without notifications, as a player, or out of a room, a hidden page does not poll until it is shown', () => {
    expect(hiddenWait(gmInA().state, 5000, false)).toBeNull();
    expect(hiddenWait(playerInA().state, 5000, true)).toBeNull();
    expect(hiddenWait(fresh().state, 5000, true)).toBeNull();
  });
});
