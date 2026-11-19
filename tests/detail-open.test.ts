import { describe, expect, test } from 'bun:test';
import { CLOSED, DETAIL_EVENTS, DETAIL_OPEN_STATES, detailStep } from '../src/core/detail-open.ts';
import type { DetailOpen } from '../src/core/detail-open.ts';
import { DETAIL_WALK } from './models/detail-open-events.ts';

const on = (key: string): DetailOpen => ({ at: 'open', key });

describe('which detail of a list is open', () => {
  test('a tap opens a closed list\'s detail, a second tap on it closes it, and a third opens it again', () => {
    const one = detailStep(CLOSED, { kind: 'toggle', key: 'a' });
    expect(one).toEqual(on('a'));
    const two = detailStep(one, { kind: 'toggle', key: 'a' });
    expect(two).toEqual(CLOSED);
    expect(detailStep(two, { kind: 'toggle', key: 'a' })).toEqual(on('a'));
  });

  test('a tap on another thing of the list opens its detail in place of the open one', () => {
    expect(detailStep(on('a'), { kind: 'toggle', key: 'b' })).toEqual(on('b'));
  });

  test('a close closes whatever is open, and changes nothing on a closed list', () => {
    expect(detailStep(on('a'), { kind: 'close' })).toEqual(CLOSED);
    expect(detailStep(CLOSED, { kind: 'close' })).toBe(CLOSED);
  });

  test('a drop closes its key only when it is the open one, and answers the same value otherwise', () => {
    expect(detailStep(on('a'), { kind: 'drop', key: 'a' })).toEqual(CLOSED);
    const b = on('b');
    expect(detailStep(b, { kind: 'drop', key: 'a' })).toBe(b);
    expect(detailStep(CLOSED, { kind: 'drop', key: 'a' })).toBe(CLOSED);
  });

  test('the walk\'s events are every kind, and every state answers each of them with a state', () => {
    expect([...new Set(DETAIL_WALK.map(e => e.kind))].sort()).toEqual([...DETAIL_EVENTS].sort());
    for (const s of [CLOSED, on('a'), on('b')]) for (const e of DETAIL_WALK) expect(DETAIL_OPEN_STATES).toContain(detailStep(s, e).at);
  });
});
