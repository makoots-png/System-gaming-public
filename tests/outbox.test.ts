import { describe, expect, test } from 'bun:test';
import {
  ENTRY_EVENTS, IdTaken, OUTBOX_MAX, REFUSED_KEEP, callOf, entryTransition, next, parseOutbox, post, rebound, reloaded, roomGone, sentEvent, step, waiting,
} from '../src/core/sync/outbox.ts';
import type { Entry, EntryEventType, KeptState, Letter, Outbox } from '../src/core/sync/outbox.ts';
import { newEvent, parseEvent } from '../src/core/protocol.ts';
import type { RoomCode, RoomEvent } from '../src/core/protocol.ts';
import { hid } from './fixtures/ids.ts';

const A = 'ABCD23' as RoomCode, B = 'EFGH45' as RoomCode;
let n = 0;
/** A player's told use, as uses.js posts it, with a fresh id. */
const used = (name = 'Potion'): Letter => {
  const event = newEvent('used', { by: 'd-p1:h1' as never, who: 'Kai', what: 'item', name, text: '', target: 'self', tell: true }, { device: 'd-p1', now: 1_000_000 + n++, rand: 0.5 });
  if (!event) throw new Error('not an event');
  return { kind: 'event', event };
};
const posted = (box: Outbox, room: RoomCode, l: Letter, key: string | null = null): Outbox => post(box, room, l, key).box;
const ids = (box: Outbox): string[] => box.map(e => e.id);
const states = (box: Outbox): string[] => box.map(e => e.at);
const eventOf = (e: Entry): RoomEvent => (e.letter.kind === 'event' ? e.letter.event : (() => { throw new Error('a tombstone'); })());

describe('a message to the room: one entry\'s machine', () => {
  // kits-style table of every cell: what the chart in docs/state-machines.md draws
  const CELLS: Record<KeptState, Partial<Record<EntryEventType, string>>> = {
    queued: { send: 'sending', refused: 'refused', drop: 'dropped' },
    sending: { sent: 'sent', failed: 'queued', refused: 'refused', reload: 'queued', drop: 'dropped' },
    refused: { drop: 'dropped' },
  };
  for (const [from, row] of Object.entries(CELLS) as [KeptState, Partial<Record<EntryEventType, string>>][]) {
    for (const e of ENTRY_EVENTS) {
      test(`${from} on ${e}: ${row[e] ?? 'stays'}`, () => { expect(entryTransition(from, e)).toBe((row[e] ?? null) as never); });
    }
  }

  test('a message is queued, goes out, and leaves the box when the room takes it', () => {
    const l = used(), box = posted([], A, l);
    expect(states(box)).toEqual(['queued']);
    const out = step(box, ids(box)[0]!, { type: 'send' });
    expect(states(out)).toEqual(['sending']);
    expect(step(out, ids(box)[0]!, { type: 'sent' })).toEqual([]);
  });

  test('a send with no answer puts it back in the queue, and a reload does the same to one on its way', () => {
    const box = posted([], A, used()), id = ids(box)[0]!;
    const out = step(box, id, { type: 'send' });
    expect(step(out, id, { type: 'failed' })).toEqual(box);
    expect(reloaded(out)).toEqual(box);
  });

  test('a refusal keeps the message with the room\'s reason; it never goes out again', () => {
    const box = posted([], A, used()), id = ids(box)[0]!;
    const refused = step(step(box, id, { type: 'send' }), id, { type: 'refused', why: 'not your sheet' });
    expect(refused).toMatchObject([{ id, at: 'refused', why: 'not your sheet' }]);
    expect(next(refused, A)).toBeNull();
    expect(waiting(refused, A)).toBe(0);
    expect(step(refused, id, { type: 'send' })).toBe(refused);
  });

  test(`at most ${REFUSED_KEEP} refusals are kept: a newer one lets the oldest go`, () => {
    let box: Outbox = [];
    for (let i = 0; i <= REFUSED_KEEP; i++) {
      box = posted(box, A, used(`r${i}`));
      const id = box[box.length - 1]!.id;
      box = step(step(box, id, { type: 'send' }), id, { type: 'refused', why: 'x' });
    }
    expect(box).toHaveLength(REFUSED_KEEP);
    expect(box.map(e => eventOf(e).type === 'used' && (eventOf(e).payload as { name: string }).name)).toEqual(Array.from({ length: REFUSED_KEEP }, (_, i) => `r${i + 1}`));
  });
});

describe('the outbox', () => {
  test('posting the same message twice keeps one entry', () => {
    const l = used(), box = posted([], A, l);
    expect(post(box, A, l)).toEqual({ box, dropped: [] });
  });

  test('another message under an id the box holds is not posted: the post throws IdTaken, naming the id and both messages, and the box stays', () => {
    const l = used(), box = posted([], A, l);
    if (l.kind !== 'event') throw new Error('an event');
    const roll = parseEvent('roll', { eid: l.event.payload.eid, by: 'd-p1:h1', name: 'Kai', label: 'Death save', expr: '1d20', total: 1, rolls: [1] });
    if (!roll) throw new Error('not an event');
    expect(() => post(box, A, { kind: 'event', event: roll })).toThrow(new IdTaken(l.event.payload.eid, l, { kind: 'event', event: roll }).message);
    expect(() => post(box, A, { kind: 'event', event: roll })).toThrow(/a used message under id .* this roll message was not posted/);
    expect(box).toEqual(posted([], A, l));
  });

  test('messages go one at a time per room, oldest first; another room\'s wait for that room', () => {
    let box = posted(posted(posted([], A, used('a1')), B, used('b1')), A, used('a2'));
    const first = next(box, A)!;
    expect((eventOf(first).payload as { name: string }).name).toBe('a1');
    box = step(box, first.id, { type: 'send' });
    expect(next(box, A)).toBeNull();
    expect((eventOf(next(box, B)!).payload as { name: string }).name).toBe('b1');
    box = step(box, first.id, { type: 'sent' });
    expect((eventOf(next(box, A)!).payload as { name: string }).name).toBe('a2');
    expect([waiting(box, A), waiting(box, B), waiting(box, null)]).toEqual([1, 1, 0]);
  });

  test('a newer message with the same key takes the place of a queued one, but not of one on its way', () => {
    let box = posted([], A, used('progress 1'), 'quest q1');
    box = posted(box, A, used('progress 2'), 'quest q1');
    expect(box.map(e => (eventOf(e).payload as { name: string }).name)).toEqual(['progress 2']);
    box = step(box, box[0]!.id, { type: 'send' });
    box = posted(box, A, used('progress 3'), 'quest q1');
    expect(box.map(e => [(eventOf(e).payload as { name: string }).name, e.at])).toEqual([['progress 2', 'sending'], ['progress 3', 'queued']]);
    expect(posted(box, B, used('other room'), 'quest q1')).toHaveLength(3);
  });

  test(`a full box (${OUTBOX_MAX}) lets the oldest refusal go first, then the oldest queued message, and says which`, () => {
    let box: Outbox = [];
    for (let i = 0; i < OUTBOX_MAX; i++) box = posted(box, A, used(`m${i}`));
    box = step(box, box[0]!.id, { type: 'send' });
    box = step(box, box[1]!.id, { type: 'send' });
    box = step(box, box[1]!.id, { type: 'refused', why: 'x' });
    const r1 = post(box, A, used('over 1'));
    expect(r1.dropped).toEqual([]);
    expect(r1.box.some(e => e.at === 'refused')).toBe(false);
    const r2 = post(r1.box, A, used('over 2'));
    expect(r2.dropped.map(e => (eventOf(e).payload as { name: string }).name)).toEqual(['m2']);
    expect(r2.box).toHaveLength(OUTBOX_MAX);
    expect(r2.box[0]!.at).toBe('sending');
  });

  test('a room that no longer exists refuses what waits for it; what is on its way is answered by its own request', () => {
    let box = posted(posted(posted([], A, used('a1')), A, used('a2')), B, used('b1'));
    box = step(box, box[0]!.id, { type: 'send' });
    expect(states(roomGone(box, A))).toEqual(['sending', 'refused', 'queued']);
  });

  test('a hunter bound again on this phone drops its tombstones, in every room', () => {
    const box = posted(posted(posted([], A, { kind: 'tomb', hid: hid('h1') }), B, { kind: 'tomb', hid: hid('h2') }), A, used());
    expect(ids(rebound(box, 'h1'))).toEqual(ids(box).slice(1));
  });

  test('the box a save holds is read again entry by entry: a wrong one is left out, an event through the room\'s parser', () => {
    const l = used(), box = posted(posted([], A, l), B, { kind: 'tomb', hid: hid('h9') });
    expect(parseOutbox(JSON.parse(JSON.stringify(box)))).toEqual(box);
    const raw = [
      { room: A, letter: l, at: 'sending', key: 7 }, { room: A, letter: l }, { room: 'nope', letter: l },
      { room: A, letter: { kind: 'event', event: { type: 'award', payload: { eid: 'x' } } } }, { room: B, letter: { kind: 'tomb', hid: '' } }, 'x',
      { room: B, letter: { kind: 'tomb', hid: 'h3' }, at: 'refused', why: 42 },
    ];
    expect(parseOutbox(raw)).toEqual([
      { id: ids(box)[0]!, room: A, letter: l, key: null, at: 'sending' },
      { id: 'tomb h3', room: B, letter: { kind: 'tomb', hid: 'h3' }, key: null, at: 'refused', why: '' },
    ]);
    expect(parseOutbox({})).toEqual([]);
  });
});

describe('how the room answered a request', () => {
  test('2xx is taken, 4xx refused with the reason, 426 and 5xx the server\'s; no answer is offline (the edge says so)', () => {
    expect(callOf(200, '', { seq: 3 })).toEqual({ ok: true, data: { seq: 3 } });
    expect(callOf(403, 'gm only', null)).toEqual({ ok: false, why: 'refused', reason: 'gm only' });
    expect(callOf(404, 'no such room', null)).toEqual({ ok: false, why: 'refused', reason: 'no such room' });
    expect(callOf(426, 'upgrade', null)).toEqual({ ok: false, why: 'server' });
    expect(callOf(503, 'no database', null)).toEqual({ ok: false, why: 'server' });
  });
  test('an entry hears it as sent, refused with the reason, or failed (it waits again)', () => {
    expect(sentEvent({ ok: true, data: null })).toEqual({ type: 'sent' });
    expect(sentEvent({ ok: false, why: 'refused', reason: 'too large' })).toEqual({ type: 'refused', why: 'too large' });
    expect(sentEvent({ ok: false, why: 'offline' })).toEqual({ type: 'failed' });
    expect(sentEvent({ ok: false, why: 'server' })).toEqual({ type: 'failed' });
  });
});
