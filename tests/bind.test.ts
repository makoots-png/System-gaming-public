// What the room link writes in the save (src/core/sync/bind.ts): the room fields, the ring of GM keys, the server seen,
// and a player's hunter bound to the room. Each is one step; the room model runs the same ones. Then the two small
// machines of a player's bind: the answer of the "Play as" window, and the REMOVED FROM ROOM notice.
import { describe, expect, test } from 'bun:test';
import { KEYS_MAX, NOT_BACK_YET, NO_REMOVAL, REMOVED_EVENTS, REMOVED_STATES, boundTo, joinedAt, linkSaved, playAs, playAsAnswered, removedStep, ringDrop, ringGone, ringKeep, serverSeen } from '../src/core/sync/bind.ts';
import type { BindAnswer, BindAsked, BindSwitch, RemovedEvent, RemovedNotice } from '../src/core/sync/bind.ts';
import { keepPhone } from '../src/core/save.ts';
import { atSync } from '../src/core/save-step.ts';
import { TAP_KINDS, tapWords } from '../src/core/sync/taps.ts';
import type { TapKind } from '../src/core/sync/taps.ts';
import { SEEN_MAX, parseSeen, seenFrom, seenKept } from '../src/core/sync/seen.ts';
import { ROOM_TTL_MS } from '../src/core/room-server.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import type { ParseEnv, Save, SyncSettings } from '../src/core/save.ts';
import { RULES } from '../src/core/rules.ts';
import { post } from '../src/core/sync/outbox.ts';
import { dev, gmKey, hid, room } from './fixtures/ids.ts';

const AT = '2026-11-15T10:00:00.000Z';
const ENV: ParseEnv = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-p1') };
const A = room('AAAA22'), B = room('BBBB33'), KA = gmKey('key-a'), KB = gmKey('key-b');
const sync = (o: Partial<SyncSettings> = {}): SyncSettings => ({ ...freshSave(ENV, { onboarded: true }).settings.sync, ...o });
const code = (n: number) => room(`RMMM${'ABCDEFGHJKLMNPQRSTUVWXYZ'[n]}2`);

describe('the ring of GM keys', () => {
  test('a key kept is the newest; past the cap the oldest goes', () => {
    let g: Record<string, ReturnType<typeof gmKey>> = {};
    for (let i = 0; i <= KEYS_MAX; i++) g = ringKeep(g, code(i), gmKey(`k${i}`));
    expect(Object.keys(g)).toHaveLength(KEYS_MAX);
    expect(Object.keys(g)[0]).toBe(code(1));
    expect(Object.keys(ringKeep(g, code(1), gmKey('again'))).at(-1), 'a key kept again moves to the newest').toBe(code(1));
  });

  test('a refused key goes; a wrong key typed by hand leaves the good stored one', () => {
    const s = sync({ gmKeys: { [A]: KA }, gmKey: KA });
    expect(ringDrop(s, A, KA)).toMatchObject({ gmKeys: {}, gmKey: null });
    expect(ringDrop(s, A, null).gmKeys, 'the stored one was the one tried').toEqual({});
    expect(ringDrop(s, A, gmKey('typo'))).toMatchObject({ gmKeys: { [A]: KA }, gmKey: KA });
  });

  test('a room gone, or its key forgotten, takes its key and the room\'s key when it is that one; the others stay', () => {
    const s = sync({ gmKeys: { [A]: KA, [B]: KB }, gmKey: KA });
    expect(ringGone(s, A)).toMatchObject({ gmKeys: { [B]: KB }, gmKey: null });
    expect(ringGone(s, B)).toMatchObject({ gmKeys: { [A]: KA }, gmKey: KA });
  });
});

describe('the link\'s save effect', () => {
  test('each field it names is written, a room marks the server seen, and the ring changes with it', () => {
    const s = linkSaved(freshSave(ENV, { onboarded: true }), { room: A, cursor: 7, gmKey: KA, ring: { keep: A, key: KA } }, null, AT).settings.sync;
    expect(s).toMatchObject({ room: A, cursor: 7, gmKey: KA, serverOk: true, gmKeys: { [A]: KA } });
  });

  test('a field it does not name stays; leaving a room keeps the server seen', () => {
    const was = linkSaved(freshSave(ENV, { onboarded: true }), { room: A, cursor: 7 }, null, AT);
    expect(linkSaved(was, { room: null, last: { code: A, why: 'left' } }, null, AT).settings.sync).toMatchObject({ room: null, cursor: 7, serverOk: true, lastRoom: { code: A, why: 'left' } });
    expect(serverSeen(sync({ serverOk: true }))).toEqual(sync({ serverOk: true }));
  });
});

describe('a player\'s hunter bound to the room (SMX-sync-2)', () => {
  const T0 = '2026-11-15T09:00:00.000Z';
  /** A player's save with two hunters, h1 active, and a tombstone of h2 waiting in the outbox. */
  function player(): Save {
    const s = freshSave(ENV, { onboarded: true }), two = [{ ...s.hunters[0]!, id: hid('h1') }, { ...newHunter(RULES), id: hid('h2') }];
    const outbox = post([], A, { kind: 'tomb', hid: hid('h2') }).box;
    return { ...s, hunters: two, settings: { ...s.settings, activeHunterId: hid('h1'), sync: { ...s.settings.sync, outbox } } };
  }
  /** The same player in room A since T0 with h1 bound. */
  const joinedA = (): Save => boundTo(player(), hid('h1'), { room: A, at: T0 });

  test('a join makes the hunter active and bound, writes the join of its room at the server\'s time, and drops its tombstone', () => {
    const s = boundTo(player(), hid('h2'), { room: A, at: AT });
    expect([s.settings.activeHunterId, s.settings.sync.boundHunterId, s.settings.sync.joined]).toEqual(['h2', 'h2', { room: A, at: AT }]);
    expect(s.settings.sync.outbox?.map(e => e.at)).toEqual([]);
  });

  test('a join with a hunter this phone does not hold binds the active one', () => {
    const s = boundTo(player(), hid('h9'), { room: A, at: AT });
    expect([s.settings.activeHunterId, s.settings.sync.boundHunterId]).toEqual(['h1', 'h1']);
  });

  test('"Play as" binds and shows the hunter and drops its tombstone, and the join keeps its time, so a live award is never told as one sent while away (2.2)', () => {
    const s = playAs(joinedA(), hid('h2'));
    expect('ok' in s).toBe(false);
    const next = s as Save;
    expect([next.settings.activeHunterId, next.settings.sync.boundHunterId, next.settings.sync.joined]).toEqual(['h2', 'h2', { room: A, at: T0 }]);
    expect(next.settings.sync.outbox?.map(e => e.at)).toEqual([]);
    expect(joinedAt(next.settings.sync, A)).toBe(Date.parse(T0));
    expect(playAs(joinedA(), hid('h9'))).toEqual({ ok: false, why: 'no-hunter' });
  });

  test('a join\'s time answers only for its own room: a save swapped in with another room reads no join, so nothing of that room is told as sent while away (2.4)', () => {
    expect(joinedAt(joinedA().settings.sync, A)).toBe(Date.parse(T0));
    expect(joinedAt(joinedA().settings.sync, B)).toBeNull();
    expect(joinedAt(player().settings.sync, A), 'never joined').toBeNull();
    const file = { ...player(), settings: { ...player().settings, sync: { ...player().settings.sync, room: B, cursor: 0 } } };
    const swapped = keepPhone(file, joinedA());
    expect([swapped.settings.sync.room, joinedAt(swapped.settings.sync, B)]).toEqual([B, null]);
  });
});

describe('the "Play as" window\'s answer, read where the phone is when it comes (SMX-sync-2.3)', () => {
  const asked: BindAsked = { room: A, bound: hid('h1') };
  const WHERE: Record<string, BindAsked | null> = {
    'still there': asked, 'left the room': null, 'in another room': { room: B, bound: hid('h1') }, 'another hunter bound': { room: A, bound: hid('h3') },
  };
  /** By the rule: Cancel does nothing; in the room and bind it was asked in, View shows and says the bound one stays, Play as binds; anywhere else the answer only shows the hunter. */
  const EXPECTED: Record<string, Record<BindAnswer, BindSwitch>> = {
    'still there': { cancel: 'none', view: 'showKept', bind: 'playAs' },
    'left the room': { cancel: 'none', view: 'show', bind: 'show' },
    'in another room': { cancel: 'none', view: 'show', bind: 'show' },
    'another hunter bound': { cancel: 'none', view: 'show', bind: 'show' },
  };
  for (const [where, now] of Object.entries(WHERE)) {
    test(`answered after the phone is ${where}`, () => {
      for (const answer of ['cancel', 'view', 'bind'] as const) expect([answer, playAsAnswered(asked, now, answer)]).toEqual([answer, EXPECTED[where]![answer]]);
    });
  }
});

describe('the REMOVED FROM ROOM notice (SMX-sync-8)', () => {
  const H = hid('h1');
  const NOTICES: Record<RemovedNotice['at'], RemovedNotice> = { none: NO_REMOVAL, told: { at: 'told', room: A, hunter: H }, rejoining: { at: 'rejoining', room: A, hunter: H } };
  const failed = (kind: TapKind): RemovedEvent => ({ type: 'tapped', room: A, answer: { ok: false, kind } });
  const EVENTS: Record<string, RemovedEvent> = {
    'removed from B': { type: 'removed', room: B, hunter: hid('h2') },
    'OK': { type: 'answered', room: A, rejoin: false },
    'Rejoin': { type: 'answered', room: A, rejoin: true },
    'Rejoin of an old window of B': { type: 'answered', room: B, rejoin: true },
    'rejoined': { type: 'tapped', room: A, answer: { ok: true, value: 'player' } },
    ...Object.fromEntries(TAP_KINDS.map(k => [`rejoin failed: ${k}`, failed(k)])),
    'a join of B answered': { type: 'tapped', room: B, answer: { ok: true, value: 'player' } },
    'in room A': { type: 'entered', room: A },
    'in room B': { type: 'entered', room: B },
    'campaign replaced': { type: 'replaced' },
  };
  /** One row: the notice after, then the effects in order (show / rejoin / tell, with the words told). */
  type Row = [string, ...string[]];
  const showB: Row = ['told B', 'show B'];
  const again = (words: string): Row => ['told A', `tell ${words}`, 'show A'];
  const ends = (words: string | null): Row => (words ? ['none', `tell ${words}`] : ['none']);
  // every state against every event, the refused ones too: a removal always opens its window; anything else acts only on its own room's notice
  const TABLE: Record<RemovedNotice['at'], Record<string, Row>> = {
    none: Object.fromEntries(Object.keys(EVENTS).map(e => [e, e === 'removed from B' ? showB : ['none']])),
    told: {
      'removed from B': showB, 'OK': ['none'], 'Rejoin': ['rejoining A', 'rejoin A'], 'Rejoin of an old window of B': ['told A'], 'rejoined': ['told A'],
      ...Object.fromEntries(TAP_KINDS.map(k => [`rejoin failed: ${k}`, ['told A'] as Row])),
      'a join of B answered': ['told A'], 'in room A': ['none'], 'in room B': ['none'], 'campaign replaced': ['none'],
    },
    rejoining: {
      'removed from B': showB, 'OK': ['rejoining A'], 'Rejoin': ['rejoining A'], 'Rejoin of an old window of B': ['rejoining A'],
      'rejoined': ['none', `tell Rejoined room ${A}.`],
      // today's behaviour: the window comes back where a second try can work (not allowed back yet, the server not reached)
      'rejoin failed: removed': again(NOT_BACK_YET), 'rejoin failed: net': again(tapWords('net', A)!),
      'rejoin failed: notfound': ends(tapWords('notfound', A)), 'rejoin failed: busy': ends(tapWords('busy', A)), 'rejoin failed: replaced': ends(null), 'rejoin failed: left': ends(null),
      'rejoin failed: badcode': ends(tapWords('badcode', A)), 'rejoin failed: keyRefused': ends(tapWords('keyRefused', A)),
      'a join of B answered': ['rejoining A'], 'in room A': ['rejoining A'], 'in room B': ['rejoining A'], 'campaign replaced': ['none'],
    },
  };
  const rowOf = (n: RemovedNotice, fx: ReturnType<typeof removedStep>['effects']): Row =>
    [n.at === 'none' ? 'none' : `${n.at} ${n.room === A ? 'A' : 'B'}`,
      ...fx.map(x => (x.type === 'tell' ? `tell ${x.text}` : `${x.type} ${x.room === A ? 'A' : 'B'}`))];

  test('the table names every state and every event', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...REMOVED_STATES].sort());
    expect([...new Set(Object.values(EVENTS).map(e => e.type))].sort()).toEqual([...REMOVED_EVENTS].sort());
    for (const at of REMOVED_STATES) expect(Object.keys(TABLE[at]).sort()).toEqual(Object.keys(EVENTS).sort());
  });
  for (const at of REMOVED_STATES) {
    test(`from ${at}, each event moves the notice as the table says`, () => {
      for (const [name, e] of Object.entries(EVENTS)) {
        const r = removedStep(NOTICES[at], e);
        expect([name, ...rowOf(r.state, r.effects)]).toEqual([name, ...TABLE[at][name]!]);
      }
    });
  }

  test('a room deleted while the window is open: Rejoin says there is no such room and the window does not come back (8.1)', () => {
    const asked = removedStep(NOTICES.told, { type: 'answered', room: A, rejoin: true }).state;
    const r = removedStep(asked, failed('notfound'));
    expect([r.state, r.effects]).toEqual([NO_REMOVAL, [{ type: 'tell', text: `There is no room ${A}.`, kind: 'warning' }]]);
  });

  test('a player removed from A who has since joined B: the old window\'s Rejoin does nothing, so B is never left (8.2)', () => {
    const inB = removedStep(NOTICES.told, { type: 'entered', room: B }).state;
    expect(removedStep(inB, { type: 'answered', room: A, rejoin: true })).toEqual({ state: NO_REMOVAL, effects: [] });
    const replaced = removedStep(NOTICES.told, { type: 'replaced' }).state;
    expect(removedStep(replaced, { type: 'answered', room: A, rejoin: true })).toEqual({ state: NO_REMOVAL, effects: [] });
  });
});

describe('where a phone stopped reading a room it went out of (notes-5-trade.md 11)', () => {
  const NOW = Date.parse(AT), LATER = '2026-11-15T11:00:00.000Z';
  const inA = (cursor: number): Save => linkSaved(freshSave(ENV, { onboarded: true }), { room: A, cursor }, null, AT);
  const seen = (s: Save) => s.settings.sync.seen ?? {};

  test('a leave, a removal and another room each keep the room\'s cursor with the time, in the write that takes the phone out', () => {
    // the link's save of a leave names the room, a cursor of 0 and the last room together (link.ts `stored`)
    for (const why of ['left', 'removed'] as const) {
      const out = linkSaved(inA(41), { room: null, cursor: 0, last: { code: A, why } }, null, LATER);
      expect([out.settings.sync.room, out.settings.sync.cursor, seen(out)]).toEqual([null, 0, { [A]: { seq: 41, at: LATER } }]);
    }
    const moved = linkSaved(inA(41), { room: B, cursor: 9, last: { code: A, why: 'left' } }, null, LATER);
    expect([moved.settings.sync.room, seen(moved)]).toEqual([B, { [A]: { seq: 41, at: LATER } }]);
  });

  test('a page\'s cursor written while the phone stays in the room keeps no place', () => {
    expect(seen(linkSaved(inA(41), { cursor: 60 }, null, LATER))).toEqual({});
  });

  test('back in the room, its place goes: the cursor carries on from there', () => {
    const out = linkSaved(inA(41), { room: null, cursor: 0, last: { code: A, why: 'left' } }, null, LATER);
    expect(seenFrom(seen(out), A, NOW)).toBe(41);
    expect(seen(linkSaved(out, { room: A, cursor: 41, last: null }, null, LATER))).toEqual({});
  });

  test('a room that is gone keeps no place: nothing will be read from it', () => {
    expect(seen(linkSaved(inA(41), { room: null, cursor: 0, last: { code: A, why: 'gone' } }, null, LATER))).toEqual({});
    const out = linkSaved(inA(41), { room: null, cursor: 0, last: { code: A, why: 'left' } }, null, LATER);
    expect(seen(linkSaved(out, { last: { code: A, why: 'gone' } }, null, LATER)), 'a join that finds the room gone').toEqual({});
    expect(seen(linkSaved(out, { ring: { gone: A } }, KA, LATER)), 'a GM\'s room gone takes its place with its key').toEqual({});
  });

  test('a place is good for a room\'s life, 30 days from this phone\'s last read: a millisecond past it the code may name another room', () => {
    const kept = seenKept({}, A, 41, AT);
    expect(seenFrom(kept, A, NOW + ROOM_TTL_MS)).toBe(41);
    expect(seenFrom(kept, A, NOW + ROOM_TTL_MS + 1)).toBeNull();
    expect(seenFrom(kept, B, NOW), 'a room this phone was never in').toBeNull();
  });

  test('the newest places are kept, at most SEEN_MAX; a save\'s places are read: a bad code, seq or time and an old place are dropped', () => {
    let s = {};
    for (let i = 0; i < 24; i++) for (let j = 0; j < 5; j++) s = seenKept(s, room(`RM${'ABCDEFGHJKLMNPQRSTUVWXYZ'[i]}${'ABCDE'[j]}M2`), i * 5 + j, AT);
    expect([Object.keys(s).length, Object.values(s as Record<string, { seq: number }>)[0]?.seq]).toEqual([SEEN_MAX, 20]);
    const old = new Date(NOW - ROOM_TTL_MS - 1).toISOString();
    expect(parseSeen({ [A]: { seq: 41, at: AT }, [B]: { seq: 5, at: old }, nope: { seq: 1, at: AT }, GHJKLM: { seq: -1, at: AT }, HJKLMN: { seq: 2, at: 'soon' }, JKLMNP: 7 }, NOW)).toEqual({ [A]: { seq: 41, at: AT } });
    expect(parseSeen('x', NOW)).toEqual({});
  });
});

describe('atSync (one writer for settings.sync)', () => {
  test('updates a whole Save, updates a Pick<Save, "settings"> slice with extra fields intact, and keeps identity on a no-op', () => {
    const save = freshSave(ENV, { onboarded: true });
    const updated = atSync(sy => ({ ...sy, serverOk: true }))(save);
    expect(updated.settings.sync.serverOk).toBe(true);
    expect(save.settings.sync.serverOk).toBe(false);
    expect(atSync(serverSeen)(updated)).toBe(updated);

    const slice = { settings: save.settings, tag: 'keep' };
    const nextSlice = atSync(sy => ({ ...sy, cursor: 12 }))(slice);
    expect(nextSlice.tag).toBe('keep');
    expect(nextSlice.settings.sync.cursor).toBe(12);
    expect(slice.settings.sync.cursor).toBe(0);
  });
});
