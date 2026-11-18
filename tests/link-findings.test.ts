// The sync findings deferred to the link and push machines (sync-state-inventory.md section 6, from lead-report.md
// section 9). Each test is named for its finding and fails on the behaviour the old sync.js had. Findings 1, 10, 11,
// 12 and 14 are outside the machines: notes-link.md says why.
import { describe, expect, test } from 'bun:test';
import { boot, reduce } from '../src/core/sync/link.ts';
import type { Gen, GmKey, Link, LinkEffect, LinkEvent } from '../src/core/sync/link.ts';
import { PUSH_OFF, reduce as pushReduce } from '../src/core/sync/push.ts';
import type { Push, PushEvent } from '../src/core/sync/push.ts';
import type { RoomCode } from '../src/core/protocol.ts';

const A = 'ABC234' as RoomCode, B = 'XYZ789' as RoomCode;
type NoGen<T> = T extends unknown ? Omit<T, 'gen'> : never;
type Step = NoGen<LinkEvent> | ((l: Link) => NoGen<LinkEvent>);
/** Plays events; a reply gets the current gen. Answers the final link and the effects of the last event. */
function play(start: Link, ...events: Step[]): { state: Link; fx: LinkEffect[] } {
  let state = start, fx: LinkEffect[] = [];
  for (const s of events) {
    const e = typeof s === 'function' ? s(state) : s;
    const r = reduce(state, { ...e, gen: state.gen } as LinkEvent);
    state = r.state; fx = r.effects;
  }
  return { state, fx };
}
const ready = (): Link => play(boot({ server: true, room: null, last: null }).state, { type: 'healthOk' }).state;
const inRoom = (code: RoomCode): Link => play(ready(), { type: 'join', code, key: null }, { type: 'peeked', exists: true },
  { type: 'headed', cursor: 5, gm: false, kicked: false }, { type: 'polled', cursor: 5, more: false, pace: 'table', fightAt: null }).state;
const backs = (fx: LinkEffect[]): boolean[] => fx.flatMap(x => (x.type === 'status' ? [x.serverBack] : []));

describe('deferred sync findings', () => {
  test('finding 2: a join whose peek the server answers with an error leaves the pill ready, not offline', () => {
    const r = play(ready(), { type: 'join', code: A, key: null }, { type: 'failed', kind: 'server' });
    expect(r.state).toMatchObject({ at: 'idle', server: 'ok' });
    expect(r.fx).toContainEqual({ type: 'notify', id: 'serverError', code: A });
  });

  test('finding 3: a poll error that is not "no such room" keeps the player in the room as reconnecting', () => {
    const r = play(inRoom(A), { type: 'timerFired', name: 'poll' }, { type: 'failed', kind: 'server' });
    expect(r.state).toMatchObject({ at: 'live', code: A, health: { failed: 1 } });
    const gone = play(inRoom(A), { type: 'timerFired', name: 'poll' }, { type: 'gone' });
    expect(gone.state).toMatchObject({ at: 'idle', last: { code: A, why: 'gone' } });
  });

  test('finding 4: a refused GM key ends the join as a refused key, never as a player join', () => {
    const r = play(ready(), { type: 'join', code: A, key: 'old-key' as GmKey }, { type: 'peeked', exists: true },
      { type: 'headed', cursor: 9, gm: false, kicked: false });
    expect(r.state.at).toBe('idle');
    expect(r.fx).toContainEqual({ type: 'notify', id: 'keyRefused', code: A });
    expect(r.fx.some(x => x.type === 'push')).toBe(false);
  });

  test('finding 5: a join that cannot reach the server out of a room shows the same as a failed health check, until the next good one', () => {
    const viaJoin = play(ready(), { type: 'join', code: A, key: null }, { type: 'failed', kind: 'net' }).state;
    const viaHealth = play(ready(), { type: 'timerFired', name: 'poll' }, { type: 'failed', kind: 'net' }).state;
    expect({ ...viaJoin, gen: 0 }).toEqual({ ...viaHealth, gen: 0 });
    expect(play(viaJoin, { type: 'timerFired', name: 'poll' }, { type: 'healthOk' }).state).toMatchObject({ at: 'idle', server: 'ok' });
  });

  test('finding 6: each request has its own time limit, and a sheet send that timed out keeps backing off through a good poll', () => {
    const limits = new Map<string, number>();
    const note = (fx: LinkEffect[]) => { for (const x of fx) if (x.type === 'request') limits.set(x.call.req, x.timeoutMs); };
    note(boot({ server: true, room: null, last: null }).effects);
    note(play(ready(), { type: 'join', code: A, key: null }).fx);
    note(play(inRoom(A), { type: 'timerFired', name: 'poll' }).fx);
    expect(limits.get('health')).toBeLessThan(limits.get('poll')!);
    expect(limits.get('peek')).toBeLessThan(limits.get('poll')!);
    let push: Push = PUSH_OFF;
    const g = 3 as Gen;
    for (const e of [{ type: 'linkLive', gen: g }, { type: 'timerFired', name: 'push' }, { type: 'failed', gen: g, kind: 'timeout' }, { type: 'pollOk', gen: g }] as PushEvent[]) {
      push = pushReduce(push, e).state;
    }
    expect(push).toMatchObject({ at: 'backoff', fails: 1, kind: 'timeout' });
  });

  test('finding 7: coming back from reconnecting says the server is back, as coming back from offline does', () => {
    const fromIdle = play(ready(), { type: 'timerFired', name: 'poll' }, { type: 'failed', kind: 'net' }, { type: 'timerFired', name: 'poll' }, { type: 'healthOk' });
    const fromRoom = play(inRoom(A), { type: 'timerFired', name: 'poll' }, { type: 'failed', kind: 'net' }, { type: 'timerFired', name: 'poll' },
      { type: 'polled', cursor: 5, more: false, pace: 'table', fightAt: null });
    expect(backs(fromIdle.fx)).toEqual([true]);
    expect(backs(fromRoom.fx)).toEqual([true]);
  });

  test('finding 8: joining room B from room A remembers A as the last room', () => {
    const r = play(inRoom(A), { type: 'join', code: B, key: null }, { type: 'peeked', exists: true }, { type: 'headed', cursor: 1, gm: false, kicked: false });
    expect(r.state).toMatchObject({ at: 'live', code: B, last: { code: A, why: 'left' } });
    expect(r.fx).toContainEqual({ type: 'save', fields: { room: B, cursor: 1, last: { code: A, why: 'left' } } });
  });

  test('finding 9: Leave sends nothing to the room, so the GM board keeps the card as away', () => {
    const r = play(inRoom(A), { type: 'leave' });
    expect(r.fx.filter(x => x.type === 'request')).toEqual([]);
    expect(r.fx.some(x => x.type === 'save')).toBe(true);
  });

  test('finding 13: an answer from another build moves the link to upgrading from every state', () => {
    const states: Link[] = [
      boot({ server: false, room: null, last: null }).state,
      ready(),
      play(ready(), { type: 'create' }).state,
      play(ready(), { type: 'join', code: A, key: null }).state,
      play(ready(), { type: 'join', code: A, key: null }, { type: 'peeked', exists: true }).state,
      boot({ server: true, room: { code: A, key: null, cursor: 0 }, last: null }).state,
      inRoom(A),
      play(inRoom(A), { type: 'offline' }).state,
    ];
    for (const s of states) expect(reduce(s, { type: 'upgrade', stuck: false }).state.at).toBe('upgrading');
  });
});
