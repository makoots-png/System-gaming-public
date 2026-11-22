// fight-heard.ts: on a player's phone, whether the GM's fight holds its hunter, from the room's fight doc and the fight's
// `vitals` message, whichever reaches the phone first. The rule (notes-9-rulings-1122.md section 21): the System's raise
// is offered only once no fight holds the hunter; a fight's dead row is the GM's to revive.
import { describe, expect, test } from 'bun:test';
import { NO_TABLE, fightHeard, gmHolds, parseFightHeard } from '../src/core/sync/fight-heard.ts';
import type { FightHeard, TableDoc, TableSeen } from '../src/core/sync/fight-heard.ts';
import { fightHold } from '../src/core/combat/fight-save.ts';
import { fightId } from '../src/core/combat/fight-types.ts';
import { newEvent, parseSheetKey } from '../src/core/protocol.ts';
import type { RoomCode } from '../src/core/protocol.ts';
import { dev } from './fixtures/ids.ts';

const ROOM = 'ABC234' as RoomCode, OTHER_ROOM = 'XYZ789' as RoomCode;
const KEY = parseSheetKey('d-player1:h1')!, F = fightId('f9'), G = fightId('f4'), H = fightId('f12');
/** Server times, in order: an earlier fight's end, the message, a later doc. */
const T0 = '2026-11-22T10:00:00.000Z', T1 = '2026-11-22T10:00:01.000Z', T2 = '2026-11-22T10:00:02.000Z';
const running = (id = F, keys: string[] = [KEY]): TableDoc => ({ ended: false, active: true, id, rows: keys.map(key => ({ key })) });
const setup = (id = F): TableDoc => ({ ended: false, active: false, id, rows: [{ key: KEY }] });
const ended = (id = F): TableDoc => ({ ended: true, active: false, id });
const heard = (fight = F, at = T1, room = ROOM): FightHeard => ({ room, key: KEY, fight, at });
const seen = (doc: TableDoc | null, docAt: string | null, h: FightHeard | null): TableSeen => ({ code: ROOM, doc, docAt, heard: h });

describe('whether the GM\'s fight holds a player\'s hunter, whichever of its doc and its message arrives first', () => {
  test('the doc first: the running fight with the hunter\'s row holds it, its message changes nothing, and its end lets it go', () => {
    expect(gmHolds(seen(running(), T0, null), KEY)).toBe(true);
    expect(gmHolds(seen(running(), T0, heard()), KEY)).toBe(true);
    expect(gmHolds(seen(ended(), T2, heard()), KEY)).toBe(false);
  });

  test('the message first: the fight holds the hunter while the room shows no doc of it, then by its doc, until it ends', () => {
    expect(gmHolds(seen(null, null, heard()), KEY), 'no doc yet').toBe(true);
    expect(gmHolds(seen(ended(G), T0, heard()), KEY), 'an earlier fight\'s end, stored before the message').toBe(true);
    expect(gmHolds(seen(setup(), T2, heard()), KEY), 'the fight\'s doc from before it began, stored late').toBe(true);
    expect(gmHolds(seen(running(), T2, heard()), KEY)).toBe(true);
    expect(gmHolds(seen(ended(), T2, heard()), KEY)).toBe(false);
  });

  test('a message the room stored after the fight\'s end doc does not hold the hunter again', () => {
    expect(gmHolds(seen(ended(), T0, heard(F, T1)), KEY)).toBe(false);
  });

  test('a later fight\'s doc answers the message: it holds the hunter only with a row of it', () => {
    expect(gmHolds(seen(running(H, []), T2, heard()), KEY)).toBe(false);
    expect(gmHolds(seen(running(H), T2, heard()), KEY)).toBe(true);
    expect(gmHolds(seen(ended(H), T2, heard()), KEY)).toBe(false);
  });

  test('the fight drops the hunter\'s row: its doc lets the hunter go', () => {
    expect(gmHolds(seen(running(F, []), T2, heard()), KEY)).toBe(false);
  });

  test('a message of another room or another hunter holds nothing', () => {
    expect(gmHolds(seen(null, null, heard(F, T1, OTHER_ROOM)), KEY)).toBe(false);
    expect(gmHolds(seen(null, null, heard()), parseSheetKey('d-player1:h2')!)).toBe(false);
    expect(gmHolds(NO_TABLE, KEY)).toBe(false);
  });

  test('fightHold answers `gm` only on a player\'s phone, for its own hunter', () => {
    const t = seen(null, null, heard());
    expect(fightHold(null, { hid: 'h1' }, { seat: 'player', key: KEY, ...t })).toEqual({ at: 'gm' });
    expect(fightHold(null, { hid: 'h1' }, { seat: 'gm', key: KEY, ...t })).toBeNull();
    expect(fightHold(null, { hid: 'h1' }, { seat: 'alone', key: null, ...NO_TABLE })).toBeNull();
  });
});

describe('what a player\'s phone keeps of the GM\'s fight\'s messages', () => {
  const vitals = (to: string, fight: string, at: string, n: number) => {
    const ev = newEvent('vitals', { to: [parseSheetKey(to)!], fight: fightId(fight), life: { at: 'dead' }, mana: 0, fatigue: 0, statuses: [], reason: 'Cave Rat hits' }, { device: 'd-gm', now: n, rand: 0.5 })!;
    return { ...ev, at };
  };
  const ME = dev('d-player1');

  test('the last message of a page to a hunter of this phone is kept, with the room and the room\'s time of it', () => {
    expect(fightHeard(null, ROOM, [vitals(KEY, 'f4', T0, 1), vitals(KEY, 'f9', T1, 2)], ME)).toEqual(heard(F, T1));
  });

  test('a message to another phone\'s hunter, or none, keeps what was kept', () => {
    expect(fightHeard(heard(), ROOM, [vitals('d-player2:h1', 'f12', T2, 3)], ME)).toEqual(heard());
    expect(fightHeard(null, ROOM, [], ME)).toBeNull();
  });

  test('a save keeps it whole, and anything else is dropped', () => {
    expect(parseFightHeard(JSON.parse(JSON.stringify(heard())))).toEqual(heard());
    for (const junk of [null, 'f9', [], { ...heard(), room: 'nope' }, { ...heard(), key: 'h1' }, { ...heard(), fight: '' }, { ...heard(), at: 'soon' }]) expect(parseFightHeard(junk)).toBeNull();
  });
});
