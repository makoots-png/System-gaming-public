import { describe, expect, test } from 'bun:test';
import { ICON_KEYS, ICON_KEY_MAX } from '../src/core/registry/icons.ts';
import { API_ERRORS, DOCS, DOC_MAX, NOTED_MAX, STASH_LINES, EVENTS, EVENT_TYPES, apiError, newEvent, newEventId, onDodge, onTurn, parseApiError, parseDocName, parseEvent, parseRoomState, parseSheet, SHEET_MAX, sentAgain, speaksFor, stampTime, standsFor, useRoute } from '../src/core/protocol.ts';
import { endEvent, isSealed } from '../src/core/protocol.ts';
import { FACE_LINES, WORD_MAX, hunterFace, parseDeviceId, parseServedSheet, servedPage, servedTo, sheetFor } from '../src/core/protocol.ts';
import type { EventAudience, PayloadOf, RoomEvent, RoomViewer } from '../src/core/protocol.ts';
import { GOODS_GOLD_MAX, GOODS_LINES, OFFER_MAX, goodsSize } from '../src/core/trade/goods.ts';
import { stashDoc, stashFits } from '../src/core/trade/stash.ts';
import type { Item } from '../src/core/registry/items.ts';
import { ITEM_BOUNDS, LOOT_ITEMS, itemOf } from '../src/core/registry/items.ts';
import { BONUS_KEYS } from '../src/core/rules.ts';
import type { EventType, SheetKey } from '../src/core/protocol.ts';
import { newHunter } from '../src/core/save.ts';
import { RULES, domainOf } from '../src/core/rules.ts';
import { MYTHIC_IDS, mythicScriptOf, omensOf } from '../src/core/registry/mythics.ts';
import { roomRulesOf, withRoomRules } from '../src/core/hunter/build.ts';
import type { Rules } from '../src/core/rules.ts';
import { RARITIES } from '../src/core/registry/items.ts';
import { SHOP_ITEMS, parseItem } from '../src/core/registry/items.ts';
import { parseMonster, seedMonsters } from '../src/core/registry/monsters.ts';
import { soloDoc } from '../src/core/gates/solo.ts';
import { worldDoc } from '../src/core/gates/world.ts';
import { newGate } from '../src/core/gates/gate.ts';
import type { Gate, GateId } from '../src/core/gates/gate.ts';
import type { Monster } from '../src/core/registry/monsters.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { keystoneOf } from '../src/core/registry/keystones.ts';
import { freeStatusKey } from '../src/core/combat/effect-ops.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
import { STAT_KEYS } from '../src/core/stats.ts';
import { STAT_PAIRS } from '../src/core/hunter/keystones.ts';
import type { KeystoneKey } from '../src/core/hunter/keystones.ts';
import { DOC_AHEAD, DOC_DEFS_MAX, DOC_DODGE_RUNS, DOC_MYTHICS, DOC_LOG, DOC_ROWS, DOC_STATUSES, DOC_TILES_MAX, DOC_ZONE_RUNS, fightWire, packBits } from '../src/core/combat/fight-doc.ts';
import { MAX_ZONES } from '../src/core/combat/zones.ts';
import { LOG_LINE_MAX, MAX_STATUSES } from '../src/core/combat/fight-types.ts';
import type { Fight } from '../src/core/combat/fight-types.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { FORMULA_PARTS, parseFormula, partsOf } from '../src/core/formula.ts';
import type { Formula } from '../src/core/formula.ts';
import { parseAbility, parseOp, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { THING_MAX } from '../src/core/size.ts';
import { pushedSheet } from '../src/core/hunter/chronicle.ts';
import { REWARD_BOUNDS } from '../src/core/rewards.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { abilityId } from '../src/core/combat/ability-types.ts';
import { NAME_MAX } from '../src/core/combat/fight-types.ts';
import { BURN, BURNING, EID, END, KEY, OFFER, OTHER, POTION, SOURCE, VALID, WOLF } from './fixtures/payloads.ts';
import { worstBody, worstChapter } from './fixtures/worst-chapter.ts';
import { CHAPTER_MAX, chapterSize } from '../src/core/story/story.ts';
import { WEIGHT_MAX } from '../src/core/table-weight.ts';

type Raw = Record<string, any>;

const BIG = 'x'.repeat(10 * 1024 * 1024);
const many = <T>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
/** The payload of `type` as the parser reads it, or null. */
const payload = (type: string, p: unknown): Raw | null => (parseEvent(type, p)?.payload as Raw | undefined) ?? null;
/** A sheet key, as a test may make one. */
const sk = (s: string): SheetKey => s as SheetKey;

const valid = (type: EventType): Raw => copy(VALID[type][0]);
/** A sheet as a player's phone pushes it (sync.ts `sendSheet`), and what the parser makes of it. */
const VALID_SHEET: [Raw, Raw] = [
  { hunter: { ...copy(newHunter()), id: 'h1', name: 'Kai' } },
  { hunter: { ...copy(newHunter()), id: 'h1', name: 'Kai' } },
];

describe('what each phone gets of the room (notes-5-trade.md 4.1)', () => {
  const KAI = 'd-kai:h1' as SheetKey, MIRA = 'd-mira:h3' as SheetKey;
  const GM: RoomViewer = { kind: 'gm' }, ANYONE: RoomViewer = { kind: 'anyone' };
  const phone = (device: string): RoomViewer => ({ kind: 'phone', device: device as never });
  const event = (type: EventType, payload: Raw): RoomEvent => parseEvent(type, payload)!;
  const offer = event('offer', { eid: 'd-kai-mo1', by: KAI, to: [MIRA], names: { by: 'Kai', to: 'Mira' }, gives: { gold: 5, items: [] }, asks: { gold: 0, items: [] } });
  const stop = event('offerStop', { eid: 'd-kai-mo1-e', to: [KAI, MIRA], offer: 'd-kai-mo1' });
  const award = event('award', { eid: 'd-gm-a1', to: [MIRA], rewards: { xp: 5 } });
  const coinLand = event('coinLand', { eid: 'd-gm-cl1', roll: 'd-mira:r1' });

  test('a sealed message reaches the GM and the phones of the hunters it names, and a room-audience message reaches every phone', () => {
    for (const ev of [offer, stop]) {
      expect([GM, phone('d-kai'), phone('d-mira'), phone('d-eldrin'), ANYONE].map(v => servedTo(ev, v))).toEqual([true, true, true, false, false]);
    }
    expect([GM, phone('d-kai'), phone('d-mira'), phone('d-eldrin'), ANYONE].map(v => servedTo(award, v))).toEqual([true, false, true, false, false]);
    expect([GM, phone('d-kai'), phone('d-mira'), phone('d-eldrin'), ANYONE].map(v => servedTo(coinLand, v))).toEqual([true, true, true, true, true]);
  });

  test('a System whisper to one hunter reaches the GM and that hunter\'s phone only; a System message to the room reaches every phone (SMX-sync-5.2)', () => {
    const whisper = event('system', { eid: 'd-gm-s1', to: [MIRA], tag: '! Notification', title: 'You are watched', body: '', kind: 'info' });
    const broadcast = event('system', { eid: 'd-gm-s2', tag: '! Notification', title: 'A gate opens', body: '', kind: 'info' });
    expect([GM, phone('d-kai'), phone('d-mira'), phone('d-eldrin'), ANYONE].map(v => servedTo(whisper, v))).toEqual([true, false, true, false, false]);
    expect([GM, phone('d-kai'), phone('d-mira'), phone('d-eldrin'), ANYONE].map(v => servedTo(broadcast, v))).toEqual([true, true, true, true, true]);
  });

  test('a quest and its progress reach the GM and its hunter\'s phone only, secret or not', () => {
    const quest = (secret: boolean) => event('quest', { eid: 'd-gm-q1', to: [MIRA], quest: { kind: 'side', title: 'The traitor', secret } });
    const update = (secret: boolean) => event('questUpdate', { eid: 'd-mira-qu1', by: MIRA, name: 'Mira', questId: 'q4', title: 'The traitor', kind: 'side', status: 'active', objectives: [], secret });
    for (const ev of [quest(true), update(true), quest(false), update(false)]) {
      expect([GM, phone('d-kai'), phone('d-mira'), phone('d-eldrin'), ANYONE].map(v => servedTo(ev, v))).toEqual([true, false, true, false, false]);
    }
  });

  test('EventAudience enforces that a named audience requires by or to at compile time', () => {
    const okAward: EventAudience<PayloadOf<'award'>> = 'named';
    const okRoll: EventAudience<PayloadOf<'roll'>> = 'named';
    const okStash: EventAudience<PayloadOf<'stashAnswer'>> = 'named';
    const okSystem: EventAudience<PayloadOf<'system'>> = p => (p.to === undefined ? 'room' : 'named');
    const okCoin: EventAudience<PayloadOf<'coinLand'>> = 'room';
    // @ts-expect-error coinLand has neither by nor to, so 'named' must not compile
    const badCoin: EventAudience<PayloadOf<'coinLand'>> = 'named';
    // @ts-expect-error system has optional to, so bare 'named' must not compile
    const badSystem: EventAudience<PayloadOf<'system'>> = 'named';
    expect([okAward, okRoll, okStash, typeof okSystem, okCoin, badCoin, badSystem].length).toBe(7);
  });

  test('servedPage never moves next past an unread sealed event naming the claimed device, including a by event (44c014b6)', () => {
    const devs = ['d-kai', 'd-mira', 'd-eldrin'] as const;
    const keys = { 'd-kai': KAI, 'd-mira': MIRA, 'd-eldrin': 'd-eldrin:h1' as SheetKey };
    const mk = (seq: number, kind: number): RoomEvent & { seq: number } => {
      const eid = `d-t-e${seq}`;
      switch (kind) {
        case 0: return { ...event('system', { eid, title: `Open ${seq}` }), seq };
        case 1: return { ...event('coinLand', { eid, roll: `d-mira:r${seq}` }), seq };
        case 2: return { ...event('award', { eid, to: [MIRA], rewards: { xp: 1 } }), seq };
        case 3: return { ...event('roll', { eid, by: MIRA, name: 'Mira', total: 14 }), seq };
        case 4: return { ...event('step', { eid, by: MIRA, place: { x: 1, y: 1 }, at: seq }), seq };
        case 5: return { ...event('award', { eid, to: [KAI], rewards: { xp: 1 } }), seq };
        default: return { ...event('used', { eid, by: keys['d-eldrin'], who: 'Eldrin', what: 'boon', name: 'B', text: '', target: 'self', tell: true }), seq };
      }
    };
    const miraDev = parseDeviceId('d-mira')!;

    // Explicit by-event stopping point: Mira's own roll stops an unproven catch-up poll, then proven polls catch up completely.
    const byStream = [mk(1, 0), mk(2, 5), mk(3, 3), mk(4, 2), mk(5, 0)];
    const unproven = servedPage({ events: byStream, next: 5, more: false }, ANYONE, miraDev);
    expect([unproven.events.map(e => e.seq), unproven.next, unproven.more]).toEqual([[1], 2, false]);
    const rest = servedPage({ events: byStream.filter(e => e.seq > unproven.next), next: 5, more: false }, phone('d-mira'), miraDev);
    expect([rest.events.map(e => e.seq), rest.next, rest.more]).toEqual([[3, 4, 5], 5, false]);

    // Property test over 200 deterministic random streams, page sizes, and unproven -> proven handoffs.
    let seed = 0x51a7c0de;
    const nextInt = (n: number): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    for (let trial = 0; trial < 200; trial++) {
      const len = 1 + nextInt(25);
      const pageSize = 1 + nextInt(10);
      const stream = Array.from({ length: len }, (_, i) => mk(i + 1, nextInt(7)));
      const claim = parseDeviceId(devs[nextInt(devs.length)]!)!;
      const provenViewer = phone(claim);
      const seenSeqs: number[] = [];
      let cursor = 0;
      const unprovenPolls = 1 + nextInt(4);
      // Phase 1: poll unproven (rejoining before sheet push binds slot).
      for (let p = 0; p < unprovenPolls; p++) {
        const slice = stream.filter(e => e.seq > cursor).slice(0, pageSize);
        const rawNext = slice.length ? slice.at(-1)!.seq : cursor;
        const more = slice.length > 0 && rawNext < len;
        const ans = servedPage({ events: slice, next: rawNext, more }, ANYONE, claim);
        for (const ev of ans.events) seenSeqs.push(ev.seq);
        // Invariant: cursor never passes any sealed event addressed to claim that was not returned.
        const skippedMine = stream.filter(e => e.seq > cursor && e.seq <= ans.next && isSealed(e) && servedTo(e, provenViewer));
        expect(skippedMine).toEqual([]);
        cursor = ans.next;
        if (!ans.more) break;
      }
      // Phase 2: sheet push succeeds and phone is proven. Paging to completion delivers every event visible to claim with zero gaps or duplicates.
      for (let guard = 0; guard < len + 5; guard++) {
        const slice = stream.filter(e => e.seq > cursor).slice(0, pageSize);
        if (!slice.length) break;
        const rawNext = slice.at(-1)!.seq;
        const more = rawNext < len;
        const ans = servedPage({ events: slice, next: rawNext, more }, provenViewer, claim);
        for (const ev of ans.events) seenSeqs.push(ev.seq);
        cursor = ans.next;
        if (!ans.more) break;
      }
      const expected = stream.filter(e => servedTo(e, provenViewer)).map(e => e.seq);
      expect(seenSeqs).toEqual(expected);
      expect(cursor).toBe(len);
    }
  });

  const items = Array.from({ length: FACE_LINES + 2 }, (_, i) => ({ ...itemOf(RULES, SHOP_ITEMS[0]!), id: `i${i + 1}` as never, name: `Thing ${i + 1}`, qty: i + 1 }));
  const mira = { ...newHunter(), id: 'h3' as never, name: 'Mira', level: 4, job: 'Healer', items, equipped: { ...newHunter().equipped, weapon: 'i1' as never } };

  test('a sheet goes whole to the GM and to its own phone, as a face to any other, and a tombstone stays a tombstone', () => {
    const sheet = { hunter: mira }, face = hunterFace(mira, { bags: true });
    expect([GM, phone('d-mira'), phone('d-kai'), ANYONE].map(v => sheetFor(MIRA, sheet, v, { bags: true }))).toEqual([sheet, sheet, face, face]);
    expect(sheetFor(MIRA, { deleted: true }, ANYONE, { bags: true })).toEqual({ deleted: true });
  });

  test('a face holds the name, level, job and at most 40 unworn bag lines in bag order, or no bag lines when the caller leaves them out', () => {
    const face = hunterFace(mira, { bags: true }).face;
    expect([face.name, face.level, face.job]).toEqual(['Mira', 4, 'Healer']);
    expect(face.bag).toHaveLength(FACE_LINES);
    expect(face.bag![0]).toEqual({ id: 'i2', name: 'Thing 2', qty: 2, rar: items[1]!.rar });
    expect(String(face.bag!.at(-1)!.id)).toBe(`i${FACE_LINES + 1}`);
    expect(hunterFace(mira, { bags: false })).toEqual({ face: { name: 'Mira', level: 4, job: 'Healer', bag: null } });
    expect(hunterFace({ ...mira, items: [] }, { bags: true }).face.bag).toEqual([]);
  });

  test('a phone reads a face of the poll answer: a line that does not read is dropped, more than 40 are cut, and a bag of null stays null', () => {
    const line = { id: 'i9', name: 'Healing Potion', qty: 3, rar: 'common' };
    const read = (bag: unknown) => parseServedSheet(MIRA, { face: { name: 'Mira', level: 4, job: null, bag } });
    expect(read([line, { id: 'nope', name: 'x', qty: 1, rar: 'common' }, { ...line, rar: 'golden' }])).toEqual({ face: { name: 'Mira', level: 4, job: null, bag: [line] } });
    expect((read(Array(FACE_LINES + 5).fill(line)) as { face: { bag: unknown[] } }).face.bag).toHaveLength(FACE_LINES);
    expect(read(null)).toEqual({ face: { name: 'Mira', level: 4, job: null, bag: null } });
    expect(parseServedSheet(MIRA, { face: { level: 4, job: null, bag: [] } })).toBeNull();
    expect(parseSheet(MIRA, { face: { name: 'Mira', level: 4, job: null, bag: [] } })).toBeNull();
  });
});

describe('every event type', () => {
  test('the table has an entry for each room message, and for nothing else', () => {
    expect([...EVENT_TYPES].sort()).toEqual(['arm', 'award', 'cast', 'chain', 'chapter', 'coinCall', 'coinLand', 'dodge', 'guild', 'hp', 'noted', 'offer', 'offerEnd', 'offerStop', 'pass', 'quest', 'questUpdate', 'respec', 'revive', 'rewardAsk', 'roll', 'shadow', 'soloAnswer', 'soloRun', 'spent', 'stashAnswer', 'stashAsk', 'status', 'step', 'system', 'systemRaise', 'used', 'vitals', 'weigh', 'word', 'wordBack']);
  });

  test('only the GM may send what changes a hunter, speaks for the System, lands a coin or weighs a hunter\'s dice; a player sends rolls, quest progress, uses, steps, casts, passes and coin calls', () => {
    const gmOnly = EVENT_TYPES.filter(t => EVENTS[t].gmOnly).sort();
    expect(gmOnly).toEqual(['award', 'chain', 'chapter', 'coinLand', 'guild', 'hp', 'noted', 'offerStop', 'quest', 'revive', 'shadow', 'soloAnswer', 'spent', 'stashAnswer', 'status', 'system', 'vitals', 'weigh', 'wordBack']);
  });

  test('what a player sends speaks for one hunter: only that hunter\'s phone may send it', () => {
    expect(EVENT_TYPES.filter(t => EVENTS[t].ownSheet).sort()).toEqual(['arm', 'cast', 'coinCall', 'dodge', 'offer', 'offerEnd', 'pass', 'questUpdate', 'respec', 'rewardAsk', 'roll', 'soloRun', 'stashAsk', 'step', 'systemRaise', 'used', 'word']);
    for (const t of ['roll', 'questUpdate', 'used', 'step', 'cast', 'pass', 'dodge', 'coinCall', 'arm', 'soloRun', 'offer', 'offerEnd', 'systemRaise', 'respec'] as const) expect(speaksFor(parseEvent(t, valid(t))!)).toBe(KEY as SheetKey);
    expect(speaksFor(parseEvent('award', valid('award'))!)).toBeNull();
  });

  for (const type of Object.keys(VALID) as EventType[]) {
    describe(type, () => {
      test('a payload a sender writes comes through with its values', () => {
        expect(parseEvent(type, valid(type))).toEqual({ type, payload: VALID[type][1] } as never);
      });

      test('a payload without an event id, or with a bad one, is refused', () => {
        const { eid: _, ...without } = valid(type);
        expect(parseEvent(type, without)).toBeNull();
        expect(parseEvent(type, { ...valid(type), eid: 12 })).toBeNull();
        expect(parseEvent(type, { ...valid(type), eid: 'e'.repeat(41) })).toBeNull();
        expect(parseEvent(type, { ...valid(type), eid: 'has space' })).toBeNull();
      });

      test('a payload that is not an object is refused', () => {
        for (const p of [null, undefined, 'award', 5, [valid(type)]]) expect(parseEvent(type, p)).toBeNull();
      });

      test('a __proto__ key is dropped and changes no prototype', () => {
        const p = JSON.parse(`{"__proto__": {"polluted": 1, "xp": 9999}, ${JSON.stringify(valid(type)).slice(1)}`);
        expect(payload(type, p)).toEqual(VALID[type][1]);
        expect(({} as Raw).polluted).toBeUndefined();
      });

      test('a field the type does not have is dropped, and the old v: 2 marker with it', () => {
        expect(payload(type, { ...valid(type), v: 2, stray: BIG })).toEqual(VALID[type][1]);
      });
    });
  }

  test('an unknown type, or a name Object.prototype has, is refused', () => {
    for (const type of ['nuke', '__proto__', 'toString', 'constructor', '', 7, null]) expect(parseEvent(type, valid('system'))).toBeNull();
  });
});

describe('a new event, as a phone sends one', () => {
  const stamp = { device: 'd-gm1', now: Date.parse('2026-11-12T12:00:00.000Z'), rand: 0.5 };
  const body = (type: EventType): Raw => { const { eid: _, ...rest } = VALID[type][1]; return rest; };

  for (const type of (Object.keys(VALID) as EventType[]).filter(t => t !== 'offerEnd' && t !== 'offerStop')) {
    test(`a ${type} is what the server's parser reads it as, with an id made from the phone, the time and a random part`, () => {
      const ev = newEvent(type, body(type) as never, stamp)!;
      expect(ev.type).toBe(type);
      expect(ev.payload.eid).toMatch(/^d-gm1-[0-9a-z]+$/);
      expect(parseEvent(type, ev.payload)).toEqual(ev);
      expect(ev.payload).toEqual({ ...VALID[type][1], eid: ev.payload.eid } as never);
    });
  }

  test('two events from one phone in the same millisecond get different ids', () => {
    const a = newEvent('hp', body('hp') as never, { ...stamp, rand: 0.1 })!, b = newEvent('hp', body('hp') as never, { ...stamp, rand: 0.2 })!;
    expect(a.payload.eid).not.toBe(b.payload.eid);
  });

  test('a page whose clock stands still and whose random part is fixed (a test\'s dice) still makes a new id each time: each is stamped after its last', () => {
    const made: string[] = [];
    let last = 0;
    for (let i = 0; i < 3; i++) { last = stampTime(last, stamp.now); made.push(newEvent(i === 1 ? 'pass' : 'roll', body(i === 1 ? 'pass' : 'roll') as never, { ...stamp, now: last, rand: 0 })!.payload.eid); }
    expect(new Set(made).size).toBe(3);
    expect(stampTime(stamp.now + 5, stamp.now), 'a clock that went back is passed by the last stamp too').toBe(stamp.now + 6);
    expect(stampTime(stamp.now, stamp.now + 40), 'a clock that moved on is used as it reads').toBe(stamp.now + 40);
  });

  test('a message under an id already held is that message again only when it is the same, or an offer\'s end; anything else is another message', () => {
    const pass = newEvent('pass', body('pass') as never, stamp)!, roll = parseEvent('roll', { ...VALID.roll[1], eid: pass.payload.eid })!;
    const reordered = parseEvent('pass', Object.fromEntries(Object.entries(pass.payload).reverse()))!;
    expect(sentAgain(pass, reordered), 'the same message, its keys in another order (as a store may keep them)').toBe(true);
    expect(sentAgain(roll, pass), 'a pass under its roll\'s id').toBe(false);
    expect(sentAgain(pass, parseEvent('pass', { ...pass.payload, at: 9999 })!), 'the same type with another time').toBe(false);
    const accept = parseEvent('offerEnd', VALID.offerEnd[1])!, stop = parseEvent('offerStop', VALID.offerStop[1])!;
    expect(sentAgain(accept, stop), 'an offer\'s later end: its first end is its one end').toBe(true);
  });

  test('an id the sender wrote is replaced by a new one', () => {
    expect(newEvent('hp', { ...body('hp'), eid: 'mine' } as never, stamp)!.payload.eid).not.toBe('mine' as never);
  });

  test('a phone with the longest device id still makes an id the server accepts, with room for an offer\'s end', () => {
    const ev = newEvent('hp', body('hp') as never, { ...stamp, device: 'd'.repeat(40), rand: 0.999999 })!;
    expect(ev.payload.eid.length).toBeLessThanOrEqual(38);
    expect(parseEvent('hp', ev.payload)).toEqual(ev);
    const offer = newEvent('offer', body('offer') as never, { ...stamp, device: 'd'.repeat(40), rand: 0.999999 })!;
    expect(parseEvent('offerStop', { eid: `${offer.payload.eid}-e`, to: [KEY, OTHER], offer: offer.payload.eid })).not.toBeNull();
  });

  test('an offer\'s end is made under the offer\'s end id; newEvent, which makes a new id, cannot make one', () => {
    expect(endEvent('offerEnd', body('offerEnd') as never)!.payload.eid).toBe(END as never);
    expect(endEvent('offerStop', body('offerStop') as never)!.payload.eid).toBe(END as never);
    expect(newEvent('offerEnd', body('offerEnd') as never, stamp)).toBeNull();
  });

  test('a body the server would refuse makes no event', () => {
    expect(newEvent('award', { to: [KEY], rewards: 'lots' } as never, stamp)).toBeNull();
    expect(newEvent('nuke' as EventType, {} as never, stamp)).toBeNull();
  });
});

describe('where a use goes', () => {
  const told = { tell: true, target: 'self' as const }, onOther = { tell: false, target: 'other' as const }, quiet = { tell: false, target: 'self' as const };
  test('a player\'s phone in a room sends the GM a told use and a use on another, and keeps a quiet use on oneself', () => {
    expect([told, onOther, quiet].map(u => useRoute('player', u))).toEqual(['post', 'post', 'none']);
  });
  test('a phone alone and the GM\'s own write a told use to their session log and send nothing', () => {
    for (const seat of ['alone', 'gm'] as const) expect([told, onOther, quiet].map(u => useRoute(seat, u))).toEqual(['log', 'none', 'none']);
  });
});

describe('a System window', () => {
  test('without a to list it is for every player; with one it is for those hunters', () => {
    expect(payload('system', valid('system'))!.to).toBeUndefined();
    expect(payload('system', { ...valid('system'), to: [KEY] })!.to).toEqual([KEY]);
  });

  test('a title is required and cut to 120 characters, the body to 1000', () => {
    expect(payload('system', { ...valid('system'), title: '' })).toBeNull();
    expect(payload('system', { ...valid('system'), title: 42 })).toBeNull();
    const p = payload('system', { ...valid('system'), title: BIG, body: BIG })!;
    expect([p.title.length, p.body.length]).toEqual([120, 1000]);
  });

  test('a style the app does not have is refused', () => {
    expect(payload('system', { ...valid('system'), kind: 'evil' })).toBeNull();
  });

  test('a to list keeps at most 24 sheet keys, drops a bad one, and an empty list is refused', () => {
    expect(payload('system', { ...valid('system'), to: many(10_000, i => `d-p${i}:h1`) })!.to).toHaveLength(24);
    expect(payload('system', { ...valid('system'), to: ['no colon', 5, KEY] })!.to).toEqual([KEY]);
    expect(payload('system', { ...valid('system'), to: [] })).toBeNull();
    expect(payload('system', { ...valid('system'), to: KEY })).toBeNull();
  });
});

describe('a revive', () => {
  test('names the hunters it raises: a revive for nobody, or for everyone without a to list, is refused', () => {
    const { to: _, ...without } = valid('revive');
    expect(payload('revive', without)).toBeNull();
    expect(payload('revive', { ...valid('revive'), to: [] })).toBeNull();
  });
});

describe('an award', () => {
  const award =(rewards: Raw) => payload('award', { ...valid('award'), rewards });

  test('XP and gold are clamped to a billion either way, ability points to 999', () => {
    expect(award({ xp: 1e12, gold: -1e12, points: 5000 })).toMatchObject({ rewards: { xp: 1e9, gold: -1e9, points: 999 } });
  });

  test('an amount that is not a number reads as 0, as parseRewards reads any wrong field', () => {
    expect(award({ xp: '50', gold: null, points: 2 })!.rewards).toMatchObject({ xp: 0, gold: 0, points: 2 });
  });

  test('missing amounts are 0 and missing lists are empty', () => {
    expect(award({})!.rewards).toEqual({ xp: 0, points: 0, gold: 0, crystal: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] });
  });

  test('at most 20 items; an item is read by parseItem: a wrong field takes its default, and one without a name is dropped', () => {
    expect(award({ items: many(10_000, () => POTION) })!.rewards.items).toHaveLength(20);
    expect(award({ items: [{ ...POTION, rar: 5 }, { ...POTION, qty: 'two' }, { name: '' }, POTION] })!.rewards.items)
      .toEqual([{ ...POTION, rar: 'common' }, { ...POTION, qty: 1 }, POTION]);
  });

  test('a skill it gives keeps an ability typed with advantage dice and a floor', () => {
    const p = parseFormula('2d20kh1 + floor(phys / 2)', RULES);
    if (!p.ok) throw new Error(p.error);
    const ability = abilityOf('strike', { id: abilityId('lucky'), name: 'Lucky Swing', effect: { type: 'physical', by: 'hand', formula: p.formula } }, RULES);
    expect(award({ skills: [{ name: 'Lucky Swing', type: 'active', ability: copy(ability) }] })!.rewards.skills[0].ability).toEqual(ability);
  });

  test('an item sent with only a name gets an item\'s defaults, and a huge name is cut to 60', () => {
    const plain = parseItem({ name: 'x' })!;
    expect(award({ items: [{ name: BIG }] })!.rewards.items).toEqual([{ ...plain, name: 'x'.repeat(60) }]);
  });

  test('an item bonus keeps the eight stats, max HP and max mana with numbers, clamped to 999, and drops an old key and a __proto__ key', () => {
    const bonus = JSON.parse('{"__proto__": 5, "str": 2, "vit": 5000, "agi": "3", "ac": 4, "dex": 1, "bad key": 1}');
    expect(award({ items: [{ ...POTION, bonus }] })!.rewards.items[0].bonus).toEqual({ str: 2, vit: 999 });
  });

  test('a legacy award carrying a build change drops build cleanly and preserves sibling rewards', () => {
    const empty = { xp: 0, points: 0, gold: 0, crystal: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] };
    expect(award({ build: 'respec', xp: 50 })!.rewards).toEqual({ ...empty, xp: 50 });
    expect(award({ build: { path: 'vanguard' } })!.rewards).toEqual(empty);
    expect(award({ build: { tier: 1, pick: 0 } })!.rewards).toEqual(empty);
  });

  test('an award without rewards, or for no one, is refused', () => {
    const { rewards: _, ...without } = valid('award');
    expect(payload('award', without)).toBeNull();
    const { to: __, ...noOne } = valid('award');
    expect(payload('award', noOne)).toBeNull();
  });

  test('an award given from a bundle names it: a key and a name, and its window\'s words or none', () => {
    const given = (bundle: Raw) => payload('award', { ...valid('award'), bundle });
    expect(given({ key: 'rb12', name: 'In character', window: null })).toMatchObject({ bundle: { key: 'rb12', name: 'In character', window: null } });
    expect(given({ key: 'rb12', name: 'In character' })).toMatchObject({ bundle: { window: null } });
    expect(given({ key: '', name: 'In character' }), 'no key').toBeNull();
    expect(given({ key: 'rb12', name: ' ' }), 'no name').toBeNull();
    expect(given({ key: 'rb12', name: 'x', window: { title: '' } }), 'a window with no title').toBeNull();
    expect(given({ key: 'k'.repeat(200), name: 'x'.repeat(200) })).toMatchObject({ bundle: { key: 'k'.repeat(80), name: 'x'.repeat(60) } });
    const { bundle: _, ...plain } = valid('award');
    expect(payload('award', plain)).not.toHaveProperty('bundle');
  });
});

describe('a quest', () => {
  const quest = (fields: Raw) => payload('quest', { ...valid('quest'), quest: { ...valid('quest').quest, ...fields } });

  test('a quest needs a title and one of the quest kinds', () => {
    expect(quest({ title: '  ' })).toBeNull();
    expect(quest({ kind: 'epic' })).toBeNull();
  });

  test('at most 10 objectives; progress is never past the target', () => {
    expect(quest({ objectives: many(10_000, i => ({ label: `o${i}`, target: 1 })) })!.quest.objectives).toHaveLength(10);
    expect(quest({ objectives: [{ label: 'Run', target: 3, progress: 50 }] })!.quest.objectives).toEqual([{ label: 'Run', target: 3, progress: 3 }]);
  });

  test('a due time that is not a time is refused; none is null', () => {
    expect(quest({ dueAt: 'tomorrow-ish' })).toBeNull();
    expect(quest({ dueAt: null })!.quest.dueAt).toBeNull();
  });

  test('an objective\'s count and the quest\'s cost travel; a count that does not read leaves the objective moved by taps', () => {
    const rule = { on: 'kill', where: [{ field: 'type', op: '=', value: 'Beast' }], measure: { of: 'facts' }, within: 'session' };
    const q = quest({ objectives: [{ label: 'Beasts', target: 10, progress: 0, count: { rule, mark: '' } }, { label: 'Junk', target: 1, count: { rule: { ...rule, on: 'nope' } } }] })!.quest;
    expect(q.objectives).toEqual([{ label: 'Beasts', target: 10, progress: 0, count: { rule, mark: '' } }, { label: 'Junk', target: 1, progress: 0 }]);
    expect(q.onFail.gold).toBe(-10);
    expect(quest({ onFail: 'junk' }), 'a cost that does not read refuses the quest, as a reward that does not read does').toBeNull();
    expect(quest({ rewards: 'junk' })).toBeNull();
  });

  test('a secret quest to two hunters is refused: a secret quest is one hunter\'s; to one it reads secret, and a quest that does not say reads not secret', () => {
    expect(quest({ secret: true }), 'the valid quest names two hunters').toBeNull();
    expect(payload('quest', { ...valid('quest'), to: [valid('quest').to[0]], quest: { ...valid('quest').quest, secret: true } })!.quest.secret).toBe(true);
    const { secret: _, ...unsaid } = valid('quest').quest;
    expect(payload('quest', { ...valid('quest'), quest: unsaid })!.quest.secret).toBe(false);
    expect(quest({ secret: 'yes' }), 'a secret that is not true or false refuses the quest').toBeNull();
  });

  test('a player\'s progress on a secret quest says so; progress that does not say is not secret', () => {
    expect(payload('questUpdate', { ...valid('questUpdate'), secret: true })!.secret).toBe(true);
    const { secret: _, ...unsaid } = valid('questUpdate');
    expect(payload('questUpdate', unsaid)!.secret).toBe(false);
  });

  test('the GM screen leaves out the penalty and the due time: they read as none', () => {
    const { penaltyText: _, dueAt: __, ...gmQuest } = valid('quest').quest;
    expect(payload('quest', { ...valid('quest'), quest: { ...gmQuest, from: 'gm' } })!.quest).toMatchObject({ penaltyText: '', dueAt: null });
  });
});

describe('a story\'s chapter', () => {
  const chapter = (fields: Raw) => payload('chapter', { ...valid('chapter'), ...fields });

  test('a chapter needs a window title; the title is upper-cased and cut to 60 characters, the line to 200', () => {
    expect(chapter({ words: { title: '  ', line: 'Nothing.' } })).toBeNull();
    expect(chapter({ words: 'THE DEEP' })).toBeNull();
    const { words: _, ...without } = valid('chapter');
    expect(payload('chapter', without)).toBeNull();
    expect(chapter({ words: { title: 'a'.repeat(100), line: 'b'.repeat(500) } })!.words).toEqual({ title: 'A'.repeat(60), line: 'b'.repeat(200) });
  });

  test('a chapter for no one, or without its reward, is refused; its to list keeps at most 24 sheet keys', () => {
    const { to: _, ...noOne } = valid('chapter'), { rewards: __, ...noReward } = valid('chapter');
    expect([payload('chapter', noOne), payload('chapter', noReward), chapter({ to: [] })]).toEqual([null, null, null]);
    expect(chapter({ to: many(30, i => `d-p${i}:h1`) })!.to).toHaveLength(24);
  });

  test('a chapter of words alone has no quest; a quest without a title refuses the whole chapter, and a quest keeps at most 10 objectives', () => {
    expect(chapter({ quest: null })!.quest).toBeNull();
    const { quest: _, ...words } = valid('chapter');
    expect(payload('chapter', words)!.quest).toBeNull();
    expect(chapter({ quest: { ...valid('chapter').quest, title: '' } })).toBeNull();
    expect(chapter({ quest: { ...valid('chapter').quest, objectives: many(50, i => ({ label: `o${i}`, target: 1 })) } })!.quest.objectives).toHaveLength(10);
  });

  test('a chapter whose quest is secret is refused when it names two hunters, as a quest is', () => {
    expect(chapter({ quest: { ...valid('chapter').quest, secret: true } })).toBeNull();
    expect(chapter({ to: [valid('chapter').to[0]], quest: { ...valid('chapter').quest, secret: true } })!.quest.secret).toBe(true);
  });

  test('a chapter names no story, run or chapter number: only what the GM wrote for players reaches their phones', () => {
    expect(Object.keys(chapter({ story: 'The wager', run: 'sr1', chapter: 2, note: 'Ask the table.' })!).sort()).toEqual(['eid', 'quest', 'rewards', 'to', 'words']);
  });

  /**
   * The measurement of notes-1-stories.md 4.2: the largest chapter a GM can save, `CHAPTER_MAX` bytes as the maker counts
   * them, sent to the room's 24 hunters with the longest keys, against the server's 65,536-byte body. Each part printed.
   */
  test('the worst chapter by part: at CHAPTER_MAX with 24 keys, the request is under the server\'s body bound and the chapter reads back whole', () => {
    const body = worstBody('2026-11-19T10:00:00.000Z'), ev = newEvent('chapter', body as never, { device: 'd'.repeat(40), now: Date.parse('2026-11-19T10:00:00.000Z'), rand: 0.5 })!;
    expect(ev, 'the room reads the worst chapter').not.toBeNull();
    const bytes = (v: unknown) => goodsSize(v), request = { from: 'd'.repeat(40), type: 'chapter', payload: ev.payload };
    const parts = { words: bytes(body.words), rewards: bytes(body.rewards), quest: bytes(body.quest), to: bytes(body.to), eid: bytes(ev.payload.eid) };
    console.info([
      `the worst chapter: ${chapterSize(worstChapter())} bytes by chapterSize (CHAPTER_MAX ${CHAPTER_MAX}); in the message ${bytes({ words: body.words, rewards: body.rewards, quest: body.quest })} (the quest's due time in place of its hours)`,
      `by part: words ${parts.words}, reward ${parts.rewards} (${body.rewards.items.length} items), quest ${parts.quest} (its reward ${bytes(body.quest!.rewards)}, ${body.quest!.rewards.items.length} items), to ${parts.to} (${body.to.length} keys of 40), the event id ${parts.eid}`,
      `the request as the outbox sends it: ${bytes(request)} bytes, of the server's 65,536 (${65_536 - bytes(request)} to spare)`,
    ].join('\n'));
    expect(bytes(request)).toBeLessThanOrEqual(64 * 1024);
    expect(ev.payload).toEqual({ ...body, eid: ev.payload.eid, words: body.words } as never);
  });
});

describe('an HP change', () => {
  test('HP, mana and fatigue changes are clamped to 99999 either way', () => {
    expect(payload('hp', { ...valid('hp'), hp: -1e9, mana: 1e9, fatigue: 1e300 })).toMatchObject({ hp: -99999, mana: 99999, fatigue: 99999 });
  });

  test('a change that is not a number is refused', () => {
    expect(payload('hp', { ...valid('hp'), hp: '-7' })).toBeNull();
    expect(payload('hp', { ...valid('hp'), mana: null })).toBeNull();
  });

  test('the old mp field is dropped: mana is 0', () => {
    expect(payload('hp', { ...valid('hp'), mp: 5 })).toMatchObject({ mana: 0 });
  });
});

describe('the fight\'s totals for a hunter', () => {
  const vitals = (fields: Raw) => payload('vitals', { ...valid('vitals'), ...fields });

  test('mana and fatigue are whole totals from 0 to a billion, clamped', () => {
    expect(vitals({ mana: 1e12, fatigue: 7.9 })).toMatchObject({ mana: 1e9, fatigue: 7 });
  });

  test('the row\'s life is carried whole in each of its states: up with its HP, dead', () => {
    for (const life of [{ at: 'up', hp: 20 }, { at: 'dead' }]) expect(vitals({ life })!.life).toEqual(life);
  });

  test('a life is read as a save reads one: up HP from 1 to a billion, clamped, and nothing else kept', () => {
    expect(vitals({ life: { at: 'up', hp: 2e9 } })!.life).toEqual({ at: 'up', hp: 1e9 });
    expect(vitals({ life: { at: 'dead', hp: 30 } })!.life).toEqual({ at: 'dead' });
  });

  test('a life that is not one of the two, or an up life with no HP, is refused: a life is never guessed', () => {
    for (const life of [{ at: 'down' }, { at: 'dying', successes: 0, failures: 0 }, { at: 'stable' }, { at: 'up' }, { at: 'up', hp: '20' }, 'dead', 0, null]) expect(vitals({ life })).toBeNull();
  });

  test('a total left out, or not a number, is refused: a total is never guessed', () => {
    for (const k of ['life', 'mana', 'fatigue', 'statuses']) {
      const { [k]: _, ...without } = valid('vitals');
      expect(payload('vitals', without)).toBeNull();
    }
    expect(vitals({ mana: '20' })).toBeNull();
  });

  test('the HP of the old totals is no life: a message with HP and no life is refused', () => {
    const { life: _, ...without } = valid('vitals');
    expect(payload('vitals', { ...without, hp: 20 })).toBeNull();
  });

  test('a later total for the same hunter stands for an earlier one, its life with it; another hunter\'s does not', () => {
    const at = (to: string, life: Raw) => parseEvent('vitals', { ...valid('vitals'), to: [to], life })!;
    expect(standsFor(at(KEY, { at: 'dead' }))).toBe(standsFor(at(KEY, { at: 'up', hp: 1 })));
    expect(standsFor(at(KEY, { at: 'dead' }))).not.toBe(standsFor(at(OTHER, { at: 'dead' })));
  });

  test('is for exactly one hunter', () => {
    expect(vitals({ to: [] })).toBeNull();
    expect(vitals({ to: [KEY, OTHER] })).toBeNull();
    expect(vitals({ to: [KEY, 'no colon'] })!.to).toEqual([KEY]);
  });

  test(`at most ${MAX_STATUSES} statuses, the fight row's own cap; one that does not read, or a chip the hunter's state draws, is dropped`, () => {
    expect(vitals({ statuses: many(100, i => ({ ...BURN, key: `s${i}` })) })!.statuses).toHaveLength(MAX_STATUSES);
    expect(vitals({ statuses: [{ ...BURN, def: null }, { ...BURN, key: 'dead' }, { ...BURN, rounds: -1 }, BURN] })!.statuses).toEqual([BURN]);
  });
});

describe('the GM\'s table weight on a player\'s hunter', () => {
  const weigh = (fields: Raw) => payload('weigh', { ...valid('weigh'), ...fields });

  test('a weight is a whole number of faces within one less than the largest die\'s sides, clamped; a fraction is cut', () => {
    expect(WEIGHT_MAX).toBe(RULES.dice.maxSides - 1);
    expect([weigh({ total: 5000 })!.total, weigh({ total: -5000 })!.total, weigh({ total: 2.7 })!.total, weigh({ total: -3 })!.total]).toEqual([WEIGHT_MAX, -WEIGHT_MAX, 2, -3]);
  });

  test('a weight left out, or not a number, is refused: a total is never guessed', () => {
    const { total: _, ...without } = valid('weigh');
    expect([payload('weigh', without), weigh({ total: '2' }), weigh({ total: null }), weigh({ total: Infinity })]).toEqual([null, null, null, null]);
  });

  test('a force is 20, 1 or none; any other face, or a force left out, is refused', () => {
    expect([weigh({ force: 20 })!.force, weigh({ force: 1 })!.force, weigh({ force: null })!.force]).toEqual([20, 1, null]);
    const { force: _, ...without } = valid('weigh');
    expect([payload('weigh', without), weigh({ force: 19 }), weigh({ force: '20' }), weigh({ force: 0 })]).toEqual([null, null, null, null]);
  });

  test('is for exactly one hunter', () => {
    expect([weigh({ to: [] }), weigh({ to: [KEY, OTHER] }), weigh({ to: KEY })]).toEqual([null, null, null]);
  });

  test('reaches only the GM and that hunter\'s phone, and a later weight for the same hunter stands for an earlier one; another hunter\'s does not', () => {
    const at = (to: string, total: number) => parseEvent('weigh', { ...valid('weigh'), to: [to], total })!;
    const phone = (key: string): RoomViewer => ({ kind: 'phone', device: key.split(':')[0] as never });
    expect([servedTo(at(KEY, 2), { kind: 'gm' }), servedTo(at(KEY, 2), phone(KEY)), servedTo(at(KEY, 2), phone(OTHER)), servedTo(at(KEY, 2), { kind: 'anyone' })]).toEqual([true, true, false, false]);
    expect(standsFor(at(KEY, 2))).toBe(standsFor(at(KEY, -1)));
    expect(standsFor(at(KEY, 2))).not.toBe(standsFor(at(OTHER, 2)));
  });
});

describe('a private word to the GM and its answer (notes-5-trade.md 4.2)', () => {
  const word = (fields: Raw) => payload('word', { ...valid('word'), ...fields });
  const back = (fields: Raw) => payload('wordBack', { ...valid('wordBack'), ...fields });

  test('a word or an answer holds at most WORD_MAX characters, a few sentences: a longer one is cut there', () => {
    expect(WORD_MAX).toBe(500);
    expect([word({ text: 'x'.repeat(WORD_MAX + 40) })!.text.length, back({ text: 'y'.repeat(WORD_MAX + 1) })!.text.length]).toEqual([WORD_MAX, WORD_MAX]);
  });

  test('a word or an answer with nothing written is refused', () => {
    expect([word({ text: '' }), word({ text: '   ' }), word({ text: 7 }), back({ text: '' }), back({ text: '\n' })]).toEqual([null, null, null, null, null]);
  });

  test('an answer is for exactly one hunter and names the word it answers by its id', () => {
    expect([back({ to: [] }), back({ to: [KEY, OTHER] }), back({ re: 'not an id!' }), back({ re: `${OFFER}-e` })]).toEqual([null, null, null, null]);
  });

  test('a word reaches the GM and the sender\'s phone, an answer the GM and the hunter it is for; no other phone gets either', () => {
    const phone = (key: string): RoomViewer => ({ kind: 'phone', device: key.split(':')[0] as never });
    for (const ev of [parseEvent('word', valid('word'))!, parseEvent('wordBack', valid('wordBack'))!]) {
      expect([servedTo(ev, { kind: 'gm' }), servedTo(ev, phone(KEY)), servedTo(ev, phone(OTHER)), servedTo(ev, { kind: 'anyone' })]).toEqual([true, true, false, false]);
    }
  });
});

describe('an item the GM\'s fight took from a player', () => {
  const spent = (fields: Raw) => payload('spent', { ...valid('spent'), ...fields });

  test('is for exactly one hunter', () => {
    expect(spent({ to: [] })).toBeNull();
    expect(spent({ to: [KEY, OTHER] })).toBeNull();
  });

  test('names an item by a save id: anything else is refused, never guessed', () => {
    for (const item of [undefined, '', 'item-i12', 'i', 12, 'seed:x y']) expect(spent({ item })).toBeNull();
    expect(spent({ item: 'i3' })!.item).toBe('i3');
  });
});

describe('a solo run and its answer', () => {
  test('a run names a gate, an outcome and a life the tables hold; rounds within the time cap; a name cut to the fight\'s bound', () => {
    for (const f of [{ gate: '' }, { gate: 7 }, { outcome: 'draw' }, { life: 'ghost' }, { rounds: 'x' }, { by: 'nobody' }]) expect(payload('soloRun', { ...valid('soloRun'), ...f })).toBeNull();
    expect(payload('soloRun', { ...valid('soloRun'), rounds: 999 })!.rounds).toBe(41);
    expect(payload('soloRun', { ...valid('soloRun'), name: BIG })!.name).toHaveLength(NAME_MAX);
  });

  test('an answer is for exactly one hunter, names its run, and is cleared (its reward waits for the GM, ruling 20) or refused with why', () => {
    expect(payload('soloAnswer', { ...valid('soloAnswer'), to: [KEY, OTHER] })).toBeNull();
    expect(payload('soloAnswer', { ...valid('soloAnswer'), run: 'has space' })).toBeNull();
    expect(payload('soloAnswer', { ...valid('soloAnswer'), verdict: 'maybe' })).toBeNull();
    const refused = { ...valid('soloAnswer'), verdict: 'refused', why: 'taken' };
    expect(payload('soloAnswer', refused)).toEqual({ eid: EID, to: [KEY], run: 'd-p1-run1', gate: 'g12', name: 'Goblin Den', verdict: 'refused', why: 'taken' });
    expect(payload('soloAnswer', { ...refused, why: 'bored' })).toBeNull();
    expect(payload('soloAnswer', { ...valid('soloAnswer'), verdict: 'paid' }), 'an answer no longer pays').toBeNull();
  });
  test('noted: facts for exactly one hunter, at most NOTED_MAX, each read by the fact parser and a fact that does not read left out', () => {
    expect(payload('noted', { ...valid('noted'), to: [KEY, OTHER] })).toBeNull();
    expect(payload('noted', { ...valid('noted'), facts: Array.from({ length: NOTED_MAX + 1 }, () => ({ kind: 'roll', natural: 1 })) })).toBeNull();
    expect(payload('noted', { ...valid('noted'), facts: 'x' })).toBeNull();
    expect(payload('noted', { ...valid('noted'), facts: [{ kind: 'kill', monster: 'Wolf' }] })!.facts).toEqual([]);
  });
});

describe('a shadow risen for a player\'s hunter', () => {
  const shadow = (fields: Raw) => payload('shadow', { ...valid('shadow'), shadow: { ...valid('shadow').shadow, ...fields } });

  test('is for exactly one hunter', () => {
    expect(payload('shadow', { ...valid('shadow'), to: [] })).toBeNull();
    expect(payload('shadow', { ...valid('shadow'), to: [KEY, OTHER] })).toBeNull();
  });

  test('names a rank, an archetype and a grade the tables hold, and a monster by its id or none; anything else is refused', () => {
    for (const f of [{ rank: 'Z' }, { archetype: 'dragon' }, { grade: 'King' }, { monster: '' }, { monster: 7 }, { rank: undefined }]) expect(shadow(f)).toBeNull();
    expect(shadow({ monster: null })!.shadow.monster).toBeNull();
  });

  test('a name is cut to the fight\'s name bound', () => {
    expect(shadow({ name: BIG })!.shadow.name).toHaveLength(NAME_MAX);
  });
});

describe('a status change', () => {
  const status = (fields: Raw) => payload('status', { ...valid('status'), ...fields });
  const grant = (fields: Raw) => ({ ...BURN, ...fields });

  test('at most 10 statuses added and 10 removed', () => {
    const p = status({ add: many(10_000, i => grant({ key: `s${i}` })), remove: many(10_000, i => `s${i}`) })!;
    expect([p.add.length, p.remove.length]).toEqual([10, 10]);
  });

  test('a status with a key that is empty or longer than 80 characters, rounds that are not a number, or no readable def is dropped', () => {
    const add = [grant({ key: '' }), grant({ key: 'k'.repeat(81) }), grant({ rounds: 'x' }), grant({ def: null }), grant({ def: { desc: 'no label', ops: [] } }), grant({})];
    expect(status({ add })!.add).toEqual([grant({})]);
    expect(status({ add: [grant({ key: 'k'.repeat(80) })] })!.add).toHaveLength(1);
  });

  test('Dead, Exhausted and Penalized are drawn from a hunter\'s state, so adding or removing one is dropped', () => {
    const p = status({ add: [grant({ key: 'dead' }), grant({ key: 'exhausted' }), grant({ key: 'penalized' }), grant({})],
      remove: ['exhausted', 'dead', 'penalized', 'burning'] })!;
    expect(p.add).toEqual([grant({})]);
    expect(p.remove).toEqual(['burning']);
  });

  test('rounds left are 0 or more with their decimals, and none means until removed', () => {
    expect(status({ add: [grant({ rounds: 2.5 }), grant({ key: 'b', rounds: null }), grant({ key: 'c', rounds: -1 })] })!.add.map((s: Raw) => s.rounds)).toEqual([2.5, null]);
  });

  test('a status without a readable source is dropped: who applied it decides its numbers', () => {
    const add = [grant({ source: undefined }), grant({ source: null }), grant({ source: { ...SOURCE, tier: 6 } }), grant({ source: { ...SOURCE, tier: -1 } }),
      grant({ source: { ...SOURCE, tier: 2.5 } }), grant({ source: { ...SOURCE, id: 7 } }), grant({})];
    expect(status({ add })!.add).toEqual([grant({})]);
  });

  test('a source\'s tier is 0 to 5, and a source with no id is the GM\'s', () => {
    const tiers = status({ add: [grant({ source: { id: null, tier: 0 } }), grant({ key: 'b', source: { id: 'c-1', tier: 5 } })] })!.add.map((s: Raw) => s.source);
    expect(tiers).toEqual([{ id: null, tier: 0 }, { id: 'c-1', tier: 5 }]);
  });

  test('a def with a dice count past the shipped rules\' limit does not read, as every room message is read before any GM\'s rules', () => {
    const dice = (count: number) => grant({ def: { ...BURNING, ops: [{ op: 'damage', type: 'arcane', amount: { kind: 'dice', count, sides: 6 } }] } });
    expect(status({ add: [dice(RULES.dice.maxDice)] })!.add).toHaveLength(1);
    expect(status({ add: [dice(RULES.dice.maxDice + 1)] })!.add).toEqual([]);
  });
});

describe('a roll', () => {
  test('a roll needs a numeric total and the sheet key of the hunter who rolled', () => {
    const { total: _, ...noTotal } = valid('roll');
    expect(payload('roll', noTotal)).toBeNull();
    expect(payload('roll', { ...valid('roll'), total: '17' })).toBeNull();
    expect(payload('roll', { ...valid('roll'), by: 'h1' })).toBeNull();
  });

  test('at most 50 dice; a flag that is not true or false is refused', () => {
    expect(payload('roll', { ...valid('roll'), rolls: many(10_000, () => 3) })!.rolls).toHaveLength(50);
    expect(payload('roll', { ...valid('roll'), crit: 'yes' })).toBeNull();
  });

  test('the old item and skill kinds are gone: a kind field is dropped (a use travels as used)', () => {
    expect(payload('roll', { ...valid('roll'), kind: 'skill' })).toEqual(VALID.roll[1]);
  });

  test('a total past a million either way is clamped', () => {
    expect(payload('roll', { ...valid('roll'), total: -1e15 })!.total).toBe(-1e6);
  });
});

describe('quest progress', () => {
  test('progress needs the quest id and a quest status', () => {
    const { questId: _, ...noId } = valid('questUpdate');
    expect(payload('questUpdate', noId)).toBeNull();
    expect(payload('questUpdate', { ...valid('questUpdate'), status: 'won' })).toBeNull();
  });

  test('the reader cuts a sent quest to its bounds, so the sender sends it as it is: a name to 60, a title to 120, 10 objectives, a label to 100', () => {
    const p = payload('questUpdate', { ...valid('questUpdate'), name: BIG, title: BIG, objectives: many(30, () => ({ label: BIG, progress: 1, target: 2 })) })!;
    expect([p.name.length, p.title.length, p.objectives.length, p.objectives[0]!.label.length]).toEqual([60, 120, 10, 100]);
  });
});

describe('a Job Change chain', () => {
  const chain = (fields: Raw) => payload('chain', { ...valid('chain'), ...fields });

  test('names a job the jobs table has, and one of issue, reissue or abandon', () => {
    expect(chain({ job: 'Pirate' })).toBeNull();
    expect(chain({ job: 'ranger' })).toBeNull();
    expect(chain({ job: 7 })).toBeNull();
    expect(chain({ kind: 'finish' })).toBeNull();
    for (const kind of ['issue', 'reissue', 'abandon']) expect(chain({ kind })!.kind).toBe(kind);
  });

  test('is for at least one hunter, at most 24', () => {
    expect(chain({ to: [] })).toBeNull();
    expect(chain({ to: many(100, i => `d-p${i}:h1`) })!.to).toHaveLength(24);
  });
});

describe('a use', () => {
  const used = (fields: Raw) => payload('used', { ...valid('used'), ...fields });

  test('a use needs the sheet key of the hunter, what was used and its name', () => {
    expect(used({ by: 'h1' })).toBeNull();
    expect(used({ what: 'spell' })).toBeNull();
    expect(used({ name: '   ' })).toBeNull();
  });

  test('a target that is not self or other, or a tell that is not true or false, is refused; left out they are self and false', () => {
    expect(used({ target: 'everyone' })).toBeNull();
    expect(used({ tell: 'yes' })).toBeNull();
    const { target: _, tell: __, ...plain } = valid('used');
    expect(payload('used', plain)).toMatchObject({ target: 'self', tell: false });
  });

  test('the hunter\'s and the thing\'s names are cut to 60 characters, the text to 200', () => {
    const p = used({ who: BIG, name: BIG, text: BIG })!;
    expect([p.who.length, p.name.length, p.text.length]).toEqual([60, 60, 200]);
  });

  test('a use is a report: the outcomes the old app rolled are dropped, a use in a fight is a cast', () => {
    expect(used({ outcomes: [{ kind: 'damage', n: 7 }] })).toEqual(VALID.used[1]);
  });
});

describe('a step', () => {
  const step = (fields: Raw) => payload('step', { ...valid('step'), ...fields });

  test('a tile is x and y, each a whole number from 0 to 63; anything else is refused, never moved to another tile', () => {
    expect(step({ place: { x: 0, y: 63 } })!.place).toEqual({ x: 0, y: 63 });
    for (const place of [{ x: 64, y: 0 }, { x: -1, y: 0 }, { x: 2.5, y: 0 }, { x: '3', y: 4 }, { x: 3 }, [3, 4], null]) expect(step({ place })).toBeNull();
  });

  test('the time the player saw is a whole tick from 0, clamped to a billion; without it the step is refused', () => {
    expect(step({ at: 1e12 })!.at).toBe(1e9);
    expect(step({ at: -5 })!.at).toBe(0);
    const { at: _, ...without } = valid('step');
    expect(payload('step', without)).toBeNull();
  });

  test('a dash is a yes or no, no by default; anything else refuses the step', () => {
    expect([step({ dash: true })!.dash, step({})!.dash]).toEqual([true, false]);
    expect(step({ dash: 'yes' })).toBeNull();
  });

  test('a step speaks for one hunter, by its sheet key', () => {
    expect(step({ by: 'h1' })).toBeNull();
  });
});

describe('a coin call', () => {
  const call = (fields: Raw) => payload('coinCall', { ...valid('coinCall'), ...fields });

  test('a call needs the hunter\'s sheet key, the roll\'s id, a natural 1 or 20 and heads or tails', () => {
    expect(call({ by: 'h1' })).toBeNull();
    for (const roll of ['', 'has space', 'r'.repeat(81), 12, null]) expect(call({ roll })).toBeNull();
    for (const face of [2, 19, '20', 0, null]) expect(call({ face })).toBeNull();
    expect(call({ face: 1 })!.face).toBe(1);
    for (const c of ['edge', 'Heads', '', null]) expect(call({ call: c })).toBeNull();
    expect(call({ call: 'tails' })!.call).toBe('tails');
  });

  test('a roll id of 80 characters comes through whole', () => {
    expect(call({ roll: 'r'.repeat(80) })!.roll).toBe('r'.repeat(80));
  });

  test('the hunter\'s name and what the roll was for are cut to 60 characters, and left out they are empty', () => {
    const p = call({ who: BIG, what: BIG })!;
    expect([p.who.length, p.what.length]).toEqual([60, 60]);
    const { who: _, what: __, ...plain } = valid('coinCall');
    expect(payload('coinCall', plain)).toMatchObject({ who: '', what: '' });
  });
});

describe('a coin\'s landing', () => {
  const land = (fields: Raw) => payload('coinLand', { ...valid('coinLand'), ...fields });

  test('a ruling needs the roll\'s id', () => {
    for (const roll of ['', 'has space', 'r'.repeat(81), 12, null]) expect(land({ roll })).toBeNull();
  });

  test('a ruling read off the wire holds the roll alone: a side, a ruling or a verdict sent beside it is dropped', () => {
    expect(land({ side: 'heads', ruling: 'right', won: true, verdict: 'critSuccess', flip: true, by: KEY, call: 'heads' })).toEqual(VALID.coinLand[1]);
    expect(Object.keys(VALID.coinLand[1]).sort()).toEqual(['eid', 'roll']);
  });
});

describe('a cast', () => {
  const cast = (fields: Raw) => payload('cast', { ...valid('cast'), ...fields });

  test('the ability is an id of 1 to 40 characters, never cut', () => {
    expect(cast({ ability: 'a'.repeat(40) })!.ability).toBe('a'.repeat(40));
    for (const ability of ['', 'a'.repeat(41), 7, null]) expect(cast({ ability })).toBeNull();
  });

  test('the aim is a row of the fight (an id of at most 80 characters) or a tile', () => {
    expect(cast({ aim: { x: 10, y: 5 } })!.aim).toEqual({ x: 10, y: 5 });
    expect(cast({ aim: 'c'.repeat(80) })!.aim).toBe('c'.repeat(80));
    for (const aim of ['', 'c'.repeat(81), { x: 64, y: 0 }, 5, null]) expect(cast({ aim })).toBeNull();
  });

  test('a cast carries no dice: a sent one is dropped, as the GM\'s phone rolls every die', () => {
    expect(cast({ dice: [4, 6] })).not.toHaveProperty('dice');
  });

  test('a cast without the time the player saw is refused', () => {
    const { at: _, ...without } = valid('cast');
    expect(payload('cast', without)).toBeNull();
  });
});

describe('a pass', () => {
  test('names the hunter and the time the player saw, and nothing else', () => {
    expect(Object.keys(payload('pass', { ...valid('pass'), dice: [3] })!).sort()).toEqual(['at', 'by', 'eid']);
  });

  test('a pass without the time the player saw is refused', () => {
    const { at: _, ...without } = valid('pass');
    expect(payload('pass', without)).toBeNull();
  });
});

describe('a player\'s step or cast on the GM\'s phone', () => {
  /** A running fight at `now`, the turn of row c1, held by the hunter of `KEY` on another phone; row c2 is a monster. */
  const fight = (o: { now?: number; currentId?: string; phase?: string; holder?: Raw | null } = {}): Fight => ({
    phase: o.phase ?? 'running', now: tick(o.now ?? 2500), currentId: o.currentId ?? 'c1',
    rows: [{ id: 'c1', holder: o.holder === undefined ? { kind: 'remote', remote: KEY } : o.holder }, { id: 'c2', holder: null }],
  }) as unknown as Fight;
  const sent = (at = 2500, by = KEY) => ({ by: by as SheetKey, at: tick(at) });

  test('moves the row of the sender\'s hunter on its turn, at the time the player saw', () => {
    expect(onTurn(fight(), sent())).toBe('c1' as never);
  });

  test('changes nothing once time has moved on: a replay, or a tap on a stale view', () => {
    expect(onTurn(fight({ now: 3700 }), sent())).toBeNull();
  });

  test('changes nothing on another row\'s turn, for another player\'s hunter, a hunter on the GM\'s phone, or outside a running fight', () => {
    expect(onTurn(fight({ currentId: 'c2' }), sent())).toBeNull();
    expect(onTurn(fight(), sent(2500, OTHER))).toBeNull();
    expect(onTurn(fight({ holder: { kind: 'local', hunterId: 'h1' } }), sent())).toBeNull();
    expect(onTurn(fight({ phase: 'setup' }), sent())).toBeNull();
    expect(onTurn(null, sent())).toBeNull();
  });

  test('moves a summon on its turn for the phone of the hunter that owns it, and for no other (kits design 1.9.2)', () => {
    const withSummon = (owner: string): Fight => ({
      phase: 'running', now: tick(2500), currentId: 's1',
      rows: [{ id: 'c1', holder: { kind: 'remote', remote: KEY } }, { id: 'c3', holder: { kind: 'remote', remote: OTHER } }, { id: 's1', kind: 'summon', owner, holder: null }],
    }) as unknown as Fight;
    expect(onTurn(withSummon('c1'), sent())).toBe('s1' as never);
    expect(onTurn(withSummon('c3'), sent())).toBeNull();
  });
});

describe('the fight doc', () => {
  const st = (key: string, label = key) => ({ key, label, left: 2.5, tier: 0 });
  const KAI_ROW = {
    id: 'c1', name: 'Kai', side: 'party', key: KEY, place: { x: 2, y: 3 }, at: 1500, speed: 100, band: 'wounded', statuses: [st('burning', 'Burning')],
    shield: 12, shieldLeft: 1.5, channel: null, taunt: null, icon: null, life: { at: 'up' }, kind: 'hunter', hp: 20, hpMax: 30, stride: 3, move: 6,
  };
  const GOBLIN_ROW = {
    id: 'c2', name: 'Goblin', side: 'foe', key: null, place: { x: 2, y: 11 }, at: 1800, speed: 110, band: 'bloodied', statuses: [], shield: null, shieldLeft: null,
    channel: { ability: 'hex-bolt', name: 'Hex Bolt', charge: 2, max: 5, state: 'holding', factor: 2.1 }, taunt: { by: 'c1', left: 1.2 }, icon: null, life: { at: 'up' },
    kind: 'monster', intent: { name: 'Shortbow', target: 'c1', reveal: null }, stagger: { fill: 3, max: 40, staggered: null }, suggest: 'c1',
  };
  /** A running fight as fightDoc (src/core/combat/fight-doc.ts) makes it; `parse` puts it on the wire (`fightWire`) and reads it back. */
  const LIVE = {
    ended: false, active: true, by: 'd-gm1', id: 'f5', at: '2026-11-12T12:00:00.000Z', now: 1500, currentId: 'c1', ahead: ['c1', 'c2'],
    grid: { w: 20, h: 14, tiles: null, lit: null }, zones: [], rows: [KAI_ROW, GOBLIN_ROW], log: ['Kai moves.'], refused: null, ready: {},
  };
  const parse = (fields: Raw = {}) => DOCS.fight(copy(fightWire({ ...copy(LIVE), ...fields } as never))) as Raw | null;
  const rowsOf = (rows: Raw[]) => parse({ rows })!.rows as Raw[];
  /** `LIVE` on the wire with top-level fields as given, for what only a broken wire can hold. */
  const onWire = (fields: Raw) => DOCS.fight({ ...fightWire(copy(LIVE) as never), ...fields }) as Raw | null;

  test('a running fight comes through as published', () => {
    expect(parse()).toEqual(LIVE);
  });

  test('an ended fight keeps only its id and when it ended', () => {
    expect(DOCS.fight({ id: 'f5', active: false, ended: true, at: '2026-11-12T12:00:00.000Z', rows: [KAI_ROW] })).toEqual({ ended: true, active: false, id: 'f5', at: '2026-11-12T12:00:00.000Z' });
  });

  test('players never get a monster\'s HP, and a hunter\'s HP is never past its maximum', () => {
    expect(rowsOf([{ ...GOBLIN_ROW, hp: 7, hpMax: 9 }, { ...KAI_ROW, hp: 500 }])).toEqual([GOBLIN_ROW, { ...KAI_ROW, hp: 30 }]);
  });

  test('a hunter\'s stride is a whole number of tiles from 0 to 64, and a row without one is dropped', () => {
    expect(rowsOf([{ ...KAI_ROW, stride: 0 }, { ...KAI_ROW, id: 'c3', stride: 500 }, { ...KAI_ROW, id: 'c4', stride: -2 }]).map(r => r.stride)).toEqual([0, 64, 0]);
    const { stride: _, ...noStride } = KAI_ROW;
    expect(rowsOf([noStride, GOBLIN_ROW])).toEqual([GOBLIN_ROW]);
  });

  test('a hunter\'s move (how far a dash runs) is a whole number of tiles from 0 to 64, and a row without one is dropped', () => {
    expect(rowsOf([{ ...KAI_ROW, move: 0 }, { ...KAI_ROW, id: 'c3', move: 500 }, { ...KAI_ROW, id: 'c4', move: -2 }]).map(r => 'move' in r && r.move)).toEqual([0, 64, 0]);
    const { move: _, ...noMove } = KAI_ROW;
    expect(rowsOf([noMove, GOBLIN_ROW])).toEqual([GOBLIN_ROW]);
  });

  test(`at most ${DOC_ROWS} rows, ${DOC_STATUSES} statuses a row, ${DOC_AHEAD} turns ahead and ${DOC_LOG} log lines of at most ${LOG_LINE_MAX} characters`, () => {
    // Ten times the bound, not BIG: `parse` copies the doc through JSON, and 50 lines of 10 MB are half a gigabyte of it.
    const long = 'x'.repeat(LOG_LINE_MAX * 10);
    const doc = parse({ rows: many(100, i => ({ ...GOBLIN_ROW, id: `c${i}`, statuses: many(50, j => st(`s${j}`)) })), ahead: many(50, i => `c${i}`), log: many(50, () => long) })!;
    expect([doc.rows.length, doc.rows[0].statuses.length, doc.ahead.length, doc.log.length, doc.log[0].length]).toEqual([DOC_ROWS, DOC_STATUSES, DOC_AHEAD, DOC_LOG, LOG_LINE_MAX]);
  });

  test('a row with a band, side or kind the table does not have, or a place off the biggest grid, is dropped', () => {
    const bad = [{ ...GOBLIN_ROW, band: 'fine' }, { ...GOBLIN_ROW, side: 'neutral' }, { ...GOBLIN_ROW, kind: 'boss' }, { ...GOBLIN_ROW, place: { x: 64, y: 0 } }];
    expect(rowsOf([...bad, KAI_ROW])).toEqual([KAI_ROW]);
  });

  test('a row\'s life comes through by its kind\'s table: a hunter dead, a monster dead; a state off the table drops the row', () => {
    const lives = [{ ...KAI_ROW, id: 'c4', life: { at: 'dead' } }, { ...GOBLIN_ROW, life: { at: 'dead' } }];
    expect(rowsOf(lives)).toEqual(lives);
    const wire = fightWire({ ...copy(LIVE), rows: [KAI_ROW, GOBLIN_ROW] } as never) as Raw;
    const off = [{ ...wire.rows[1], d: 2 }, { ...wire.rows[0], d: 2 }, { ...wire.rows[0], d: 4 }, { ...wire.rows[0], d: 0 }, { ...wire.rows[0], d: 'dead' }, { ...wire.rows[0], d: true }];
    expect((DOCS.fight({ ...wire, rows: [...off, wire.rows[0]] }) as Raw).rows).toEqual([KAI_ROW]);
  });

  test('a monster\'s intent names a row or a tile, and none is null; stagger is whole numbers', () => {
    const [aimed, none] = rowsOf([{ ...GOBLIN_ROW, intent: { name: 'Fire Breath', target: { x: 4, y: 5 }, reveal: null }, stagger: { fill: 3.7, max: 40, staggered: 1.5 } }, { ...GOBLIN_ROW, id: 'c3', intent: null, stagger: null }]);
    expect([aimed!.intent, aimed!.stagger, none!.intent, none!.stagger]).toEqual([{ name: 'Fire Breath', target: { x: 4, y: 5 }, reveal: null }, { fill: 3, max: 40, staggered: 1.5 }, null, null]);
  });

  test('a revealed intent carries at most four lines of its numbers, each cut to 80 characters, and its area\'s radius and ring; an unrevealed one carries none', () => {
    const reveal = { lines: ['Arcane damage 2d8 + power', 'Radius 3 tiles, ring to 4 at 50%', 'Range 10 tiles', 'Slow to land: a quick body can move out', 'a fifth line'], radius: 3, outer: 4 };
    const [shown, hidden] = rowsOf([{ ...GOBLIN_ROW, intent: { name: 'Hellfire', target: 'c1', reveal: { ...reveal, lines: [...reveal.lines.slice(0, 4), 'x'.repeat(200)] } } }, { ...GOBLIN_ROW, id: 'c3' }]);
    expect(shown!.intent.reveal).toEqual({ lines: reveal.lines.slice(0, 4), radius: 3, outer: 4 });
    expect(rowsOf([{ ...GOBLIN_ROW, intent: { name: 'Hellfire', target: 'c1', reveal: { ...reveal, lines: ['x'.repeat(200)] } } }])[0]!.intent.reveal.lines).toEqual(['x'.repeat(80)]);
    expect(hidden!.intent.reveal).toBeNull();
  });

  test('a channel\'s charge and max are whole numbers up to 99 and a bad state drops the row; a taunt names its row; a missing extra is none', () => {
    const [c] = rowsOf([{ ...GOBLIN_ROW, channel: { ...GOBLIN_ROW.channel, charge: 2.6, max: 500 } }]);
    expect(c!.channel).toEqual({ ability: 'hex-bolt', name: 'Hex Bolt', charge: 2, max: 99, state: 'holding', factor: 2.1 });
    expect(rowsOf([{ ...GOBLIN_ROW, channel: { ...GOBLIN_ROW.channel, state: 'sleeping' } }, KAI_ROW])).toEqual([KAI_ROW]);
    const { channel: _c, taunt: _t, suggest: _s, shieldLeft: _l, ...bare } = GOBLIN_ROW;
    expect(rowsOf([bare])[0]).toMatchObject({ channel: null, taunt: null, suggest: null, shieldLeft: null });
  });

  test('the GM\'s refusal of a player\'s tap comes through with its row, time, reason and count; a bad one is dropped alone', () => {
    const refused = { id: 'c1', at: 1500, reason: 'cooldown', n: 3 };
    expect(parse({ refused })!.refused).toEqual(refused);
    expect(parse({ refused: undefined })!.refused).toBeNull();
    for (const bad of [{ ...refused, reason: 'needsRoll' }, { ...refused, reason: 'sleepy' }, { ...refused, id: '' }, { ...refused, n: 'many' }, 'cooldown']) {
      expect(parse({ refused: bad })).toMatchObject({ rows: LIVE.rows, refused: null });
    }
  });

  test('the current row\'s cooldowns come through; past 12, a bad id or a bad time, an entry is dropped alone', () => {
    expect(parse({ ready: { 'dagger-rush': 4500 } })!.ready).toEqual({ 'dagger-rush': 4500 });
    const many13 = Object.fromEntries(many(13, i => [`a${i}`, 100 + i]));
    expect(Object.keys(parse({ ready: many13 })!.ready as Raw)).toEqual(many(12, i => `a${i}`));
    expect(parse({ ready: { ['x'.repeat(41)]: 1, ok: 'soon', fine: 7 } })!.ready).toEqual({ fine: 7 });
    expect(parse({ ready: 'soon' })).toMatchObject({ rows: LIVE.rows, ready: {} });
  });

  test('a running fight without its GM phone, its rows or its grid is refused', () => {
    expect(onWire({ by: undefined })).toBeNull();
    expect(onWire({ rows: 'none' })).toBeNull();
    expect(onWire({ grid: undefined })).toBeNull();
  });

  test('a map comes as one character a tile and a lit line as long; a wrong length, an unknown character or past 1,600 tiles drops the doc', () => {
    const map = { w: 4, h: 2, tiles: '#.o?~_..', lit: '01100110' };
    expect(parse({ grid: map })!.grid).toEqual(map);
    expect(onWire({ grid: { w: 4, h: 2 } })!.grid).toEqual({ w: 4, h: 2, tiles: null, lit: null });
    for (const bad of [{ ...map, tiles: '#.o' }, { ...map, tiles: '#.o?~_.X' }]) expect(parse({ grid: bad })).toBeNull();
    const litOf = (lit: string) => onWire({ grid: { w: 4, h: 2, lit } });
    expect(litOf(packBits('01100110'))!.grid.lit).toBe('01100110');
    for (const bad of ['01100110', 'G', 'G!', '']) expect(litOf(bad), `a lit line packed as ${JSON.stringify(bad)}`).toBeNull();
    expect(parse({ grid: { w: 41, h: 40, tiles: '.'.repeat(1640), lit: null } })).toBeNull();
    expect(parse({ grid: { w: 40, h: 40, tiles: '.'.repeat(DOC_TILES_MAX), lit: '1'.repeat(DOC_TILES_MAX) } })!.grid).toMatchObject({ w: 40, h: 40 });
  });

  test('a stacking status comes with its count (one past the cap reads as the cap), a summon with the row that owns it, and the current row\'s uses left (kits design 1.11)', () => {
    const stacked = { ...KAI_ROW, statuses: [{ ...st('pain', 'Pain'), stacks: 7 }] };
    expect(parse({ rows: [stacked] })!.rows[0]!.statuses).toEqual([{ ...st('pain', 'Pain'), stacks: 7 }]);
    expect(parse({ rows: [{ ...KAI_ROW, statuses: [{ ...st('pain', 'Pain'), stacks: 21 }] }] })!.rows[0]!.statuses).toEqual([{ ...st('pain', 'Pain'), stacks: RULES.fight.kit.stackCap }]);
    const sprite = { ...KAI_ROW, id: 's1', key: null, kind: 'summon', owner: 'c1', left: 1.5 };
    expect(parse({ rows: [sprite] })!.rows).toEqual([sprite]);
    expect(parse({ rows: [{ ...sprite, left: undefined }] })!.rows).toEqual([{ ...sprite, left: null }]);
    expect(parse({ rows: [{ ...sprite, owner: undefined }] })!.rows).toEqual([]);
    expect(parse({ left: { daily: 1, twice: 0 } })!).toMatchObject({ left: { daily: 1, twice: 0 } });
    expect(parse({ left: { daily: 99, twice: 'x' } })!).toMatchObject({ left: { daily: RULES.fight.kit.fightUses } });
    expect('left' in parse({})!).toBe(false);
  });

  test('a zone comes with its id, name, runs of tiles, tone and rounds left; a bad one is dropped alone, and past 16 the rest are dropped', () => {
    const fire = { id: 'z1', name: 'Fire', tiles: '45+3,65+5', tone: 'harm', left: 1.5, anchor: null };
    expect(parse({ zones: [fire] })!.zones).toEqual([fire]);
    expect(parse({ zones: [{ ...fire, anchor: 'c-mira' }] })!.zones).toEqual([{ ...fire, anchor: 'c-mira' }]);
    expect(parse({ zones: [{ ...fire, anchor: undefined }] })!.zones).toEqual([fire]);
    expect(onWire({ zones: undefined })!.zones).toEqual([]);
    for (const bad of [{ ...fire, tiles: '45-3' }, { ...fire, tone: 'hot' }, { ...fire, id: '' }, { ...fire, tiles: 7 }, { ...fire, anchor: 7 }, { ...fire, anchor: 'a'.repeat(81) }]) expect(parse({ zones: [bad, fire] })!.zones).toEqual([fire]);
    expect(parse({ zones: many(20, i => ({ ...fire, id: `z${i}` })) })!.zones).toHaveLength(MAX_ZONES);
  });

  test('the party\'s rows with a ready reaction: at most 12 row ids; a bad one is dropped; absent is none (kits design 8.4.8)', () => {
    expect(parse({ armed: many(20, i => `c${i}`) })!.armed).toHaveLength(RULES.fight.kit.doArmed);
    expect(parse({ armed: ['c1', 7, '', 'c2'] })!.armed).toEqual(['c1', 'c2']);
    expect(parse({})!.armed).toBeUndefined();
  });

  test('the party\'s rows with a spent reaction read as the ready ones do (kits table 8.9.1)', () => {
    expect(parse({ spent: many(20, i => `c${i}`) })!.spent).toHaveLength(RULES.fight.kit.doArmed);
    expect(parse({ spent: ['c1', 7, '', 'c2'] })!.spent).toEqual(['c1', 'c2']);
    expect(parse({})!.spent).toBeUndefined();
  });

  test('the thresholds of the GM\'s last command that set any off: a count and at most 12 bearers; a bad burst is none', () => {
    expect(parse({ burst: { n: 3, ids: ['c1', 7, 'c2'] } })!.burst).toEqual({ n: 3, ids: ['c1', 'c2'] });
    expect(parse({ burst: { n: 3, ids: many(20, i => `c${i}`) } })!.burst!.ids).toHaveLength(RULES.fight.kit.doArmed);
    for (const bad of [undefined, null, 7, { n: 'x', ids: [] }, { ids: [] }]) expect(parse({ burst: bad })!.burst).toBeUndefined();
  });

  /**
   * The worst case of the doc on the wire (protocol.ts `DOC_MAX`'s arithmetic): 4 hunters with their largest awakened
   * keystone builds (5 worn keystones each), 4 hunter-like enemy rows (worst-case monster shape) with 4 longest-key
   * keystones each, and 22 worst-case monster rows (including `DOC_MYTHICS` mythics in an omen), totaling `DOC_ROWS`
   * rows. Each row also carries a 60-character name, the six longest built-in statuses at tier S with their counts, a
   * shield, a taunt, a channel, and the registry's longest icon; each monster row adds a stagger bar and a revealed
   * intent of four 80-character lines. `table` fills `wire.defs` to `DOC_DEFS_MAX` with row 0's GM defs so every other
   * row's built-ins travel inline while all shipped keystone defs reconstruct on read.
   */
  /** The longest key of the registry: an icon on every row is the worst the doc can carry (each row carries its picture, row-icon.ts `rowIcon`). */
  const LONGEST_ICON = [...ICON_KEYS].sort((a, b) => b.length - a.length)[0]!;
  const ksEntry = (def: StatusDef) => ({ key: freeStatusKey(def.label, () => false), label: def.label, left: null, tier: 5, def });
  const ksOf = (keys: readonly KeystoneKey[], awakened = false) => keys.flatMap(k => {
    const made = keystoneOf(k, RULES);
    return [...(made.worn ? [ksEntry(made.worn)] : []), ...(awakened && k.tier === 'confluence' && made.awakened?.worn ? [ksEntry(made.awakened.worn)] : [])];
  });
  /** Four valid awakened S-rank hunter builds that each hold 5 worn keystones (2 marks, confluence, awakened, apex). */
  const HUNTER_KEYSTONES = [
    ksOf([{ tier: 'mark', stat: 'agi' }, { tier: 'mark', stat: 'ins' }, { tier: 'confluence', pair: 'agi+ins' }, { tier: 'apex', stat: 'ins' }], true),
    ksOf([{ tier: 'mark', stat: 'agi' }, { tier: 'mark', stat: 'ctl' }, { tier: 'confluence', pair: 'agi+ctl' }, { tier: 'apex', stat: 'agi' }], true),
    ksOf([{ tier: 'mark', stat: 'vit' }, { tier: 'mark', stat: 'dis' }, { tier: 'confluence', pair: 'vit+dis' }, { tier: 'apex', stat: 'vit' }], true),
    ksOf([{ tier: 'mark', stat: 'dis' }, { tier: 'mark', stat: 'pre' }, { tier: 'confluence', pair: 'dis+pre' }, { tier: 'apex', stat: 'dis' }], true),
  ] as const;
  /** The four longest-key base keystones a hunter-like enemy row can carry on the wire. */
  const ENEMY_KEYSTONES = [
    ...STAT_KEYS.flatMap(stat => (['mark', 'apex'] as const).flatMap(tier => { const w = keystoneOf({ tier, stat }, RULES).worn; return w ? [ksEntry(w)] : []; })),
    ...STAT_PAIRS.flatMap(pair => { const w = keystoneOf({ tier: 'confluence', pair }, RULES).worn; return w ? [ksEntry(w)] : []; }),
  ].sort((a, b) => b.key.length - a.key.length).slice(0, 4);

  function worstDoc(table: boolean, allEnemyKeystones = false) {
    const six = Object.entries(BUILT_IN_STATUSES).sort((a, b) => b[1].label.length - a[1].label.length).slice(0, 6);
    const id = (i: number) => `m-${String(i).padStart(2, '0')}`;
    /** A GM's own def of about `n` characters under a built-in's name, so it fills the table: its longest description and ops of a damage of 1. */
    const op = { op: 'damage', type: 'arcane', amount: { kind: 'number', value: 1 } };
    const big = (label: string, n: number) => {
      const ops = many(Math.min(12, Math.floor((n - 100) / (JSON.stringify(op).length + 1))), () => op), bare = { label, desc: '', ops };
      return { label, desc: 'd'.repeat(Math.max(0, Math.min(500, n - JSON.stringify(bare).length))), ops };
    };
    const fill = Math.floor((DOC_DEFS_MAX - 2) / 6) - 16;
    const baseStatuses = (i: number, extra: readonly ReturnType<typeof ksEntry>[] = []) => [
      ...six.map(([key, def]) => ({ key, label: def.label, left: 12.3, stacks: RULES.fight.kit.stackCap, tier: 5, def: table && i === 0 ? big(def.label, fill) : def })),
      ...extra,
    ];
    const worstMonster = (i: number, extra: readonly ReturnType<typeof ksEntry>[] = []) => ({
      ...GOBLIN_ROW, id: id(i), name: 'n'.repeat(60), place: { x: 63, y: 63 }, at: 1234567, speed: 123.45, band: 'critical',
      statuses: baseStatuses(i, extra), shield: 99999, shieldLeft: 12.3, icon: LONGEST_ICON,
      channel: { ability: 'a'.repeat(40), name: 'c'.repeat(60), charge: 99, max: 99, state: 'holding', factor: 99999.99 }, taunt: { by: 'm-31', left: 12.3 },
      intent: { name: 'i'.repeat(60), target: { x: 63, y: 63 }, reveal: { lines: many(4, () => 'l'.repeat(80)), radius: 63, outer: 63 } },
      stagger: { fill: 12345, max: 99999, staggered: 1.5 }, suggest: 'm-31',
    });
    const worstHunter = (i: number, extra: readonly ReturnType<typeof ksEntry>[]) => ({
      id: id(i), name: 'n'.repeat(60), side: 'party', key: `d-${'a'.repeat(30)}:h${i}`, place: { x: 63, y: 63 }, at: 1234567, speed: 123.45, band: 'critical',
      statuses: baseStatuses(i, extra), shield: 99999, shieldLeft: 12.3, icon: LONGEST_ICON,
      channel: { ability: 'a'.repeat(40), name: 'c'.repeat(60), charge: 99, max: 99, state: 'holding', factor: 99999.99 }, taunt: { by: 'm-31', left: 12.3 },
      kind: 'hunter', life: { at: 'up' }, hp: 99999, hpMax: 99999, stride: 64, move: 64,
    });
    /** A mythic in an omen: the longest script id and omen key the registry holds, the phase it ends in, an aim at a tile, a beat and a time of seven digits. */
    const longest = MYTHIC_IDS.map(sid => omensOf(mythicScriptOf(sid)).map(([k]) => ({ sid, k }))).flat().sort((a, b) => b.sid.length + b.k.length - a.sid.length - a.k.length)[0]!;
    const standing = { state: 'omen', script: longest.sid, phase: mythicScriptOf(longest.sid).phases.length - 1, beat: 1234567, since: 1234567, omen: longest.k, aim: { x: 63, y: 63 }, band: 'critical' };
    const rows = allEnemyKeystones
      ? many(DOC_ROWS, i => worstMonster(i, ENEMY_KEYSTONES)).map((r, i) => i < DOC_MYTHICS ? { ...r, standing } : r)
      : many(DOC_ROWS, i => {
        if (i < DOC_MYTHICS) return { ...worstMonster(i), standing };
        if (i < DOC_MYTHICS + 4) return worstMonster(i, ENEMY_KEYSTONES);
        if (i < DOC_MYTHICS + 8) return worstHunter(i, HUNTER_KEYSTONES[i - DOC_MYTHICS - 4]!);
        return worstMonster(i);
      });
    return {
      ...LIVE, by: `d-${'a'.repeat(37)}`, id: `f-${'x'.repeat(20)}`, now: 1234567, currentId: 'm-00', ahead: many(DOC_AHEAD, id),
      grid: { w: 40, h: 40, tiles: '#'.repeat(DOC_TILES_MAX), lit: '1'.repeat(DOC_TILES_MAX) },
      zones: many(MAX_ZONES, i => ({ id: `z${String(i).padStart(39, '0')}`, name: 'z'.repeat(40), tiles: '1599+1,'.repeat(40).slice(0, DOC_ZONE_RUNS - 1) + '1', tone: 'hinder', left: 12345.6, anchor: id(i) })),
      rows, log: many(DOC_LOG, () => 'y'.repeat(LOG_LINE_MAX)),
      refused: { id: 'm-00', at: 1234567, reason: 'unknownAbility', n: 999999999 },
      ready: Object.fromEntries(many(12, i => [`${'r'.repeat(38)}${String(i).padStart(2, '0')}`, 1234567])),
      left: Object.fromEntries(many(12, i => [`${'r'.repeat(38)}${String(i).padStart(2, '0')}`, RULES.fight.kit.fightUses])),
      armed: many(RULES.fight.kit.doArmed, id), spent: many(RULES.fight.kit.doArmed, i => id(i + 12)),
      reacts: Object.fromEntries([...many(RULES.fight.kit.doArmed, id), ...many(RULES.fight.kit.doArmed, i => id(i + 12))].map(r => [r, 'a'.repeat(40)])),
      burst: { n: 999999999, ids: many(RULES.fight.kit.doArmed, id) },
      dodge: {
        n: 999999, who: 'm-08', by: 'm-00', ability: 'a'.repeat(NAME_MAX), mode: 'caught' as const,
        reach: 15, left: 15, auto: { x: 39, y: 39 },
        hit: '1599+1,'.repeat(40).slice(0, DOC_DODGE_RUNS - 1) + '1', ring: '1599+1,'.repeat(40).slice(0, DOC_DODGE_RUNS - 1) + '1',
      },
    };
  }
  /** The characters of each part of a doc on the wire, and of each part of its first row. */
  function byPart(wire: Raw): string {
    const len = (v: unknown) => JSON.stringify(v).length;
    const row = wire.rows[0] as Raw;
    return [`total ${len(wire)}`, ...Object.keys(wire).map(k => `  ${k} ${len(wire[k])}`), `  a row ${len(row)}:`, ...Object.keys(row).map(k => `    ${k} ${len(row[k])}`)].join('\n');
  }

  test(`the worst-case doc on the wire, in either shape, is at most eight ninths of the room's ${DOC_MAX}-character cap, and reads back whole`, () => {
    for (const table of [false, true]) {
      const doc = worstDoc(table), wire = copy(fightWire(doc as never)) as Raw;
      console.info(`the worst-case fight doc ${table ? 'with a full table of defs' : 'of built-in statuses'}, by part:\n${byPart(wire)}`);
      const read = DOCS.fight(wire) as Raw;
      if (table) {
        expect(read.rows[0].statuses.map((s: Raw) => s.def), 'the current row\'s defs are in the table').toEqual(doc.rows[0]!.statuses.map(s => s.def));
        expect(read.rows[1].statuses.every((s: Raw) => s.def === undefined), 'a status whose def is not the table\'s is named inline').toBe(true);
        const ksRows = read.rows.slice(DOC_MYTHICS, DOC_MYTHICS + 8) as Raw[];
        const ksDefs = ksRows.flatMap((r: Raw) => r.statuses.slice(6).map((s: Raw) => s.def));
        expect(ksDefs, 'every keystone chip on the 4 hunters and 4 hunter-like enemies reconstructs with its full def even when wire.defs is full').toHaveLength(36);
        expect(ksDefs.every(Boolean)).toBe(true);
      } else expect(read).toEqual(doc as never);
      expect(JSON.stringify(wire.defs ?? {}).length).toBeLessThanOrEqual(DOC_DEFS_MAX);
      expect(JSON.stringify(wire).length).toBeLessThanOrEqual(DOC_MAX * 8 / 9);
    }
    const mine = (read: Raw) => read.rows.filter((r: Raw) => r.standing).length;
    expect(mine(DOCS.fight(copy(fightWire(worstDoc(false) as never))) as Raw), 'the worst doc holds its mythics in an omen and they come back').toBe(DOC_MYTHICS);
    expect(LONGEST_ICON.length, 'the longest key the registry holds fits ICON_KEY_MAX').toBeLessThanOrEqual(ICON_KEY_MAX);
    const monsterRow = worstDoc(false).rows[0]!, hunterRow = worstDoc(false).rows[DOC_MYTHICS + 4]!;
    const wireRow = (r: Raw) => JSON.stringify((fightWire({ ...worstDoc(false), rows: [r] } as never) as Raw).rows[0]).length;
    expect(wireRow(hunterRow), 'a worst-case awakened hunter row with 5 keystones is no longer than the worst-case monster row').toBeLessThanOrEqual(wireRow(monsterRow));
    const summon = { ...hunterRow, kind: 'summon', key: null, life: { at: 'dead' }, owner: 'm-31', left: 12345.6, statuses: monsterRow.statuses };
    expect(wireRow(summon), 'a worst-case summon row is no longer than the worst-case monster row').toBeLessThanOrEqual(wireRow(monsterRow));
  });

  // Measured bytes for 30 worst-case monster rows all carrying 4 longest-key keystones (120 chips): 51,308 with built-in defs and 58,181 with a full defs table.
  test(`30 keystone-holding enemy rows fit under DOC_MAX (${DOC_MAX}) at 51,308 / 58,181 bytes with every keystone def reconstructed`, () => {
    for (const table of [false, true]) {
      const doc = worstDoc(table, true), wire = copy(fightWire(doc as never)) as Raw;
      const bytes = JSON.stringify(wire).length;
      console.info(`30 keystone-holding enemy rows (${table ? 'full defs table' : 'built-in defs'}): ${bytes} bytes of ${DOC_MAX}`);
      const read = DOCS.fight(wire) as Raw;
      expect(bytes).toBeLessThanOrEqual(DOC_MAX);
      expect(JSON.stringify(wire.defs ?? {}).length).toBeLessThanOrEqual(DOC_DEFS_MAX);
      const ksDefs = (read.rows as Raw[]).flatMap(r => r.statuses.slice(6).map((s: Raw) => s.def));
      expect(ksDefs).toHaveLength(DOC_ROWS * 4);
      expect(ksDefs.every(Boolean)).toBe(true);
    }
  });

  test('a dodge prompt reads all three modes (out, ring, caught) with reach and left, and drops malformed dodge cleanly', () => {
    for (const mode of ['out', 'ring', 'caught'] as const) {
      const dodge = { n: 2, who: 'c1', by: 'c2', ability: 'Blast', mode, reach: 3, left: 4, auto: { x: 1, y: 0 }, hit: '0+1', ring: '1+1' };
      expect(parse({ dodge })!.dodge).toEqual(dodge);
    }
    // Malformed wire dodge (unknown v, missing k or l, or old v1 shape with t instead of k/l) drops dodge cleanly while keeping the doc
    const baseWire = copy(fightWire(LIVE as never)) as Raw;
    for (const bad of [
      { n: 1, w: 'c1', b: 'c2', a: 'Blast', v: 3, k: 2, l: 2, d: [0, 0], h: '', r: '' },
      { n: 1, w: 'c1', b: 'c2', a: 'Blast', v: 0, t: '0+2', d: [0, 0], h: '', r: '' },
      { n: 1, w: 'c1', b: 'c2', a: 'Blast', v: 0, k: 0, l: 2, d: [0, 0], h: '', r: '' },
      { n: 1, w: 'c1', b: 'c2', a: 'Blast', v: 0, k: 2, l: 0, d: [0, 0], h: '', r: '' },
    ]) {
      const read = DOCS.fight({ ...baseWire, dodge: bad }) as Raw;
      expect(read, JSON.stringify(bad)).not.toBeNull();
      expect(read.dodge, JSON.stringify(bad)).toBeUndefined();
    }
  });

});

describe('the other room docs', () => {
  test('every doc the GM publishes has a parser, and no other name does', () => {
    expect(Object.keys(DOCS).sort()).toEqual(['codex', 'feats', 'fight', 'kicked', 'rules', 'solo', 'stash', 'world']);
    for (const name of ['nope', '__proto__', 'toString']) expect(parseDocName(name)).toBeNull();
  });

  test('the removed list keeps sheet keys with a time, and drops anything else', () => {
    const keys = JSON.parse(`{"__proto__": "2026-11-12T12:00:00.000Z", "${KEY}": "2026-11-12T12:00:00.000Z", "${OTHER}": "soon", "h1": "2026-11-12T12:00:00.000Z"}`);
    expect(DOCS.kicked({ v: 1, keys, names: { [KEY]: 'Kai' } })).toEqual({ keys: { [sk(KEY)]: '2026-11-12T12:00:00.000Z' }, names: { [sk(KEY)]: 'Kai' } });
  });

  test('the room\'s rules: the personal gates\' switch true or false, its hours whole within their bounds, and legacy build keys ignored', () => {
    const rules = { ...roomRulesOf(RULES), solo: { ...roomRulesOf(RULES).solo, personal: false, hours: 4 }, feats: { on: false } };
    expect(DOCS.rules(copy(rules))).toEqual(rules);
    expect(DOCS.rules(copy({ ...rules, build: { enabled: false, playerPick: true } })), 'legacy pre-R1 room rules doc parses cleanly').toEqual(rules);
    const { feats: _none, ...older } = rules;
    expect(DOCS.rules(older)!.feats, 'a doc without the feats switch reads as on').toEqual({ on: true });
    const { trade: _no, ...noTrade } = { ...rules, trade: { on: false } };
    expect(DOCS.rules(copy({ ...rules, trade: { on: false } }))!.trade, 'the trading switch comes through').toEqual({ on: false });
    expect(DOCS.rules(noTrade)!.trade, 'a doc without the trading switch reads as on').toEqual({ on: true });
    expect(DOCS.rules({ ...rules, solo: { ...rules.solo, personal: 'yes' } })).toBeNull();
    expect(DOCS.rules({ ...rules, solo: { ...rules.solo, hours: 0 } })!.solo.hours).toBe(1);
    expect(DOCS.rules({ ...rules, solo: { ...rules.solo, hours: 1e6 } })!.solo.hours).toBe(168);
    expect(DOCS.rules({ enabled: true, playerPick: true }), 'the old build doc is not read').toBeNull();
  });

  test('the room carries the mythic switch: a doc without it reads as off, and a player\'s rules follow the GM\'s', () => {
    const rules = roomRulesOf(RULES);
    expect(rules.mythic, 'the shipped switch is on').toEqual({ scripts: true });
    const off = { ...rules, mythic: { scripts: false } };
    expect(DOCS.rules(copy(rules))!.mythic).toEqual({ scripts: true });
    expect(DOCS.rules(copy(off))!.mythic).toEqual({ scripts: false });
    const { mythic: _none, ...older } = rules;
    expect(DOCS.rules(copy(older))!.mythic, 'a doc without the switch reads as off').toEqual({ scripts: false });
    for (const bad of [{ scripts: 'yes' }, { scripts: 1 }, {}]) expect(DOCS.rules(copy({ ...rules, mythic: bad }))!.mythic, JSON.stringify(bad)).toEqual({ scripts: false });
    for (const bad of [null, 'on']) expect(DOCS.rules(copy({ ...rules, mythic: bad })), `a switch that is ${JSON.stringify(bad)} is no room's rules, as the trading switch's`).toBeNull();
    const ownOff: Rules = { ...RULES, fight: { ...RULES.fight, mythic: { ...RULES.fight.mythic, scripts: false } } };
    expect(roomRulesOf(ownOff).mythic, 'the GM\'s phone publishes its own switch').toEqual({ scripts: false });
    expect(withRoomRules(ownOff, rules).fight.mythic.scripts, 'a player\'s phone plays by the room\'s switch').toBe(true);
    expect(withRoomRules(RULES, off).fight.mythic.scripts, 'and a room with it off turns the player\'s own off').toBe(false);
    expect(withRoomRules(ownOff, rules).fight.mythic.staggerTaken, 'the rest of the mythic rules stay the phone\'s').toBe(RULES.fight.mythic.staggerTaken);
  });

  test('the room carries the keystone switch', () => {
    const rules = roomRulesOf(RULES);
    const shippedKs = {
      on: false,
      markShare: RULES.fight.keystone.markShare,
      pairShare: RULES.fight.keystone.pairShare,
      apexShare: RULES.fight.keystone.apexShare,
      markRank: RULES.fight.keystone.markRank,
      pairRank: RULES.fight.keystone.pairRank,
      apexRank: RULES.fight.keystone.apexRank,
    };
    expect(rules.keystone, 'the shipped switch is off with shipped thresholds').toEqual(shippedKs);
    const custom = { ...rules, keystone: { on: true, markShare: 0.35, pairShare: 0.2, apexShare: 0.6, markRank: 'C' as const, pairRank: 'B' as const, apexRank: 'A' as const } };
    expect(DOCS.rules(copy(rules))!.keystone).toEqual(shippedKs);
    expect(DOCS.rules(copy(custom))!.keystone).toEqual(custom.keystone);

    const { keystone: _none, ...older } = rules;
    expect(DOCS.rules(copy(older))!.keystone, 'a doc without keystone reads as off with shipped thresholds').toEqual(shippedKs);
    for (const bad of [{ on: 'yes' }, { on: 1 }, {}]) expect(DOCS.rules(copy({ ...rules, keystone: bad }))!.keystone.on, JSON.stringify(bad)).toBe(false);
    for (const bad of [null, 'on']) expect(DOCS.rules(copy({ ...rules, keystone: bad })), JSON.stringify(bad)).toBeNull();
    expect(DOCS.rules(copy({ ...rules, keystone: { on: true, markShare: 0.05, apexShare: 0.99 } }))!.keystone).toMatchObject({
      on: true,
      markShare: domainOf('fight.keystone.markShare')!.least,
      apexShare: domainOf('fight.keystone.apexShare')!.most,
    });
    expect(DOCS.rules(copy({ ...rules, keystone: { on: true, markRank: 'Z' } }))).toBeNull();

    const gmOn: Rules = { ...RULES, fight: { ...RULES.fight, keystone: { ...RULES.fight.keystone, ...custom.keystone } } };
    expect(roomRulesOf(gmOn).keystone).toEqual(custom.keystone);
    const overlaid = withRoomRules(RULES, custom);
    expect(overlaid.fight.keystone).toMatchObject(custom.keystone);
    expect(overlaid.fight.keystone.budget, 'the rest of the keystone rules stay the phone\'s').toEqual(RULES.fight.keystone.budget);
    expect(withRoomRules(gmOn, rules).fight.keystone.on, 'a room with keystones off turns a player\'s own off').toBe(false);
  });

  describe('the room\'s rules carry the economy, each number read in its rule\'s domain', () => {
    const doc = roomRulesOf(RULES);
    /** The doc with `patch` over it, through JSON as the wire carries it: a field set to undefined is not there. */
    const read = (patch: Record<string, unknown>) => DOCS.rules(copy({ ...doc, ...patch }));
    /** The doc with `rank`'s loot replaced by `loot`. */
    const loot = (rank: 'E' | 'C', l: Record<string, unknown>) => read({ loot: { ...copy(doc.loot), [rank]: { ...copy(doc.loot[rank]), ...l } } });

    test('the shipped economy comes through as it went', () => {
      expect(DOCS.rules(copy(doc))).toEqual(doc);
      expect(Object.keys(doc).sort()).toEqual(['borrowCapPrices', 'crystal', 'damageTypes', 'elixirPrices', 'feats', 'gateParty', 'gradeStep', 'guilds', 'keystone', 'loot', 'mythic', 'priceBase', 'rarities', 'respecPrices', 'reviveDebtBurn', 'reviveDebtPrices', 'reviveDebtShare', 'reviveDebtXpRate', 'reviveLevelShare', 'revivePrices', 'saleShare', 'shadow', 'shareCap', 'solo', 'statuses', 'trade', 'usedUpShare']);
    });

    test('a rule number past its domain is read at the domain\'s end, and a whole rule whole', () => {
      const SHARES = ['saleShare', 'usedUpShare', 'reviveDebtXpRate', 'reviveLevelShare'] as const;
      for (const k of SHARES) expect([read({ [k]: -1 })![k], read({ [k]: 2 })![k]], k).toEqual([domainOf(k)!.least, domainOf(k)!.most]);
      expect([read({ elixirPrices: -1 })!.elixirPrices, read({ elixirPrices: 999 })!.elixirPrices]).toEqual([domainOf('elixirPrices')!.least, domainOf('elixirPrices')!.most]);
      expect([read({ borrowCapPrices: -1 })!.borrowCapPrices, read({ borrowCapPrices: 9 })!.borrowCapPrices]).toEqual([domainOf('borrowCapPrices')!.least, domainOf('borrowCapPrices')!.most]);
      expect([read({ reviveDebtShare: -1, reviveDebtBurn: 0 })!.reviveDebtShare, read({ reviveDebtShare: 2, reviveDebtBurn: 0 })!.reviveDebtShare]).toEqual([domainOf('reviveDebtShare')!.least, domainOf('reviveDebtShare')!.most]);
      expect([read({ reviveDebtBurn: -1, reviveDebtShare: 0 })!.reviveDebtBurn, read({ reviveDebtBurn: 2, reviveDebtShare: 0 })!.reviveDebtBurn]).toEqual([domainOf('reviveDebtBurn')!.least, domainOf('reviveDebtBurn')!.most]);
      expect(read({ reviveDebtShare: 0.7, reviveDebtBurn: 0.4 }), 'share + burn over 1 is refused').toBeNull();
      expect([read({ gradeStep: 0.5 })!.gradeStep, read({ gradeStep: 9 })!.gradeStep]).toEqual([domainOf('gradeStep')!.least, domainOf('gradeStep')!.most]);
      expect([read({ revivePrices: 0 })!.revivePrices, read({ revivePrices: 1e9 })!.revivePrices]).toEqual([domainOf('revivePrices')!.least, domainOf('revivePrices')!.most]);
      expect(read({ reviveDebtPrices: { ...doc.reviveDebtPrices, E: 0, S: 1e9, C: 5.9 } })!.reviveDebtPrices).toEqual({ ...doc.reviveDebtPrices, E: domainOf('reviveDebtPrices.E')!.least, S: domainOf('reviveDebtPrices.S')!.most, C: 5 });
      expect([read({ priceBase: { ...doc.priceBase, E: -5, S: 2e9, C: 1234.9 } })!.priceBase]).toEqual([{ ...doc.priceBase, E: domainOf('priceBase.E')!.least, S: domainOf('priceBase.S')!.most, C: 1234 }]);
      expect([read({ gateParty: 0 })!.gateParty, read({ gateParty: 99 })!.gateParty, read({ gateParty: 4.7 })!.gateParty]).toEqual([domainOf('gateParty')!.least, domainOf('gateParty')!.most, 4]);
      expect(read({ solo: { ...doc.solo, lootShare: 3 } })!.solo.lootShare).toBe(domainOf('solo.lootShare')!.most);
      expect(loot('C', { gold: [-5, 2e9] })!.loot.C.gold).toEqual([domainOf('loot.C.gold')!.least, domainOf('loot.C.gold')!.most]);
      expect(loot('E', { weights: { ...doc.loot.E.weights, rare: 5000 } })!.loot.E.weights.rare).toBe(domainOf('loot.E.weights.rare')!.most);
      expect(read({ shadow: { summonMp: { ...doc.shadow.summonMp, E: -5, S: 5000, C: 3.9 } } })!.shadow.summonMp)
        .toEqual({ ...doc.shadow.summonMp, E: domainOf('shadow.summonMp.E')!.least, S: domainOf('shadow.summonMp.S')!.most, C: 3 });
    });

    test('a doc whose economy is not the rules\' shape is refused whole', () => {
      const WRONG: ReadonlyArray<readonly [string, () => unknown]> = [
        ['a share that is text', () => read({ saleShare: '0.25' })],
        ['no grade step', () => read({ gradeStep: undefined })],
        ['no used-up share', () => read({ usedUpShare: undefined })],
        ['no elixirPrices', () => read({ elixirPrices: undefined })],
        ['no revivePrices', () => read({ revivePrices: undefined })],
        ['no reviveDebtPrices', () => read({ reviveDebtPrices: undefined })],
        ['a scalar reviveDebtPrices on the wire', () => read({ reviveDebtPrices: 6 })],
        ['a rank missing from reviveDebtPrices', () => { const { S: _gone, ...five } = copy(doc.reviveDebtPrices); return read({ reviveDebtPrices: five }); }],
        ['a reviveDebtPrices entry that is text', () => read({ reviveDebtPrices: { ...doc.reviveDebtPrices, E: '5' } })],
        ['no share of clear gold paid toward debt', () => read({ reviveDebtShare: undefined })],
        ['no debt burn share', () => read({ reviveDebtBurn: undefined })],
        ['no debt XP rate', () => read({ reviveDebtXpRate: undefined })],
        ['no shop borrow limit', () => read({ borrowCapPrices: undefined })],
        ['no priceBase', () => read({ priceBase: undefined })],
        ['a rank missing from priceBase', () => { const { S: _gone, ...five } = copy(doc.priceBase); return read({ priceBase: five }); }],
        ['a priceBase entry that is text', () => read({ priceBase: { ...doc.priceBase, E: '100' } })],
        ['debt share plus burn above 1', () => read({ reviveDebtShare: 0.8, reviveDebtBurn: 0.3 })],
        ['no level share of a raising', () => read({ reviveLevelShare: undefined })],
        ['no world gate party', () => read({ gateParty: undefined })],
        ['the solo rules without the loot share', () => read({ solo: { personal: true, hours: 8 } })],
        ['a rarity ranked past S', () => read({ rarities: { ...copy(doc.rarities), rare: { rank: 'Z' } } })],
        ['a rarity that is only its rank', () => read({ rarities: { ...copy(doc.rarities), rare: 'C' } })],
        ['a rarity missing', () => { const { mythic: _gone, ...five } = copy(doc.rarities); return read({ rarities: five }); }],
        ['no rarities', () => read({ rarities: undefined })],
        ['a rank\'s gold high to low', () => loot('C', { gold: [2000, 500] })],
        ['a rank\'s gold of three numbers', () => loot('C', { gold: [500, 1000, 2000] })],
        ['a rank\'s gold that is text', () => loot('C', { gold: ['500', 2000] })],
        ['a shipped weight missing', () => loot('E', { weights: { common: 70, uncommon: 25 } })],
        ['a weight that is text', () => loot('E', { weights: { ...doc.loot.E.weights, common: 'many' } })],
        ['a rank missing from the loot', () => { const { S: _gone, ...five } = copy(doc.loot); return read({ loot: five }); }],
        ['the rules doc before the economy', () => DOCS.rules({ solo: { personal: true, hours: 8 }, feats: doc.feats })],
      ];
      for (const [why, parsed] of WRONG) expect(parsed(), why).toBeNull();
    });

    test('a rarity carries only its rank, the six an item can carry; a loot table only its shipped weights', () => {
      const r = read({ rarities: { ...copy(doc.rarities), rare: { rank: 'B', color: '#000000' }, cursed: { rank: 'S' } } })!;
      expect(Object.keys(r.rarities).sort()).toEqual([...RARITIES].sort());
      expect(r.rarities.rare).toEqual({ rank: 'B' });
      expect(loot('E', { weights: { ...doc.loot.E.weights, mythic: 9 } })!.loot.E.weights).toEqual(doc.loot.E.weights);
    });
  });

  test('a world gate open to solo runs says so, and only then', () => {
    const gate = { id: 'g1', name: 'Den', rank: 'E', type: 'normal', status: 'detected', breakDay: 5 };
    expect(DOCS.world({ day: 3, gates: [{ ...gate, solo: true }, { ...gate, id: 'g2', solo: false }] })).toEqual({ day: 3, session: 0, gates: [{ ...gate, solo: true }, { ...gate, id: 'g2' }] });
    expect(DOCS.world({ day: 3, gates: [{ ...gate, solo: 'yes' }] })).toEqual({ day: 3, session: 0, gates: [] });
  });

  test('the solo doc reads each monster by the monster parser and each status by the status parser; a bad entry is dropped', () => {
    const goblin = parseMonster({ name: 'Goblin', rank: 'E', archetype: 'skirmisher' })!;
    const doc = { gates: [{ id: 'g1', name: 'Den', rank: 'E', boss: false, lines: [{ m: 'seed:goblin', n: 2 }] }], monsters: { 'seed:goblin': goblin }, statuses: { burning: BURNING } };
    const read = DOCS.solo(copy(doc))!;
    expect(read.gates).toEqual(doc.gates);
    expect(read.monsters['seed:goblin']).toEqual(goblin);
    expect(read.statuses.burning!.label).toBe('Burning');
    expect(DOCS.solo({ ...copy(doc), monsters: { 'seed:goblin': 'a goblin', ok: goblin } })!.monsters).toEqual({ ok: goblin });
    expect(DOCS.solo({ ...copy(doc), gates: [{ ...doc.gates[0], lines: [{ m: 'x', n: 0 }] }] })!.gates[0]!.lines).toEqual([{ m: 'x', n: 1 }]);
    expect(DOCS.solo({ ...copy(doc), gates: [{ ...doc.gates[0], lines: [
      { m: 'seed:goblin', n: 2, hp: 1.469, dealt: 2.042 },
      { m: 'seed:goblin', n: 1, hp: 0, dealt: 1 },
      { m: 'seed:goblin', n: 1, hp: 101, dealt: 1 },
      { m: 'seed:goblin', n: 1, hp: 'bad' },
    ] }] })!.gates[0]!.lines).toEqual([{ m: 'seed:goblin', n: 2, hp: 1.469, dealt: 2.042 }]);
    expect(DOCS.solo({ ...copy(doc), pad: 'x'.repeat(DOC_MAX) }), 'past the room\'s bound').toBeNull();
  });

  test('the world keeps at most 40 gates and drops a gate with a status gates do not have', () => {
    const gate = { id: 'g1', name: 'Den', rank: 'E', type: 'normal', status: 'detected', breakDay: 5 };
    expect(DOCS.world({ v: 1, day: 3, gates: [gate, { ...gate, status: 'gone' }] })).toEqual({ day: 3, session: 0, gates: [gate] });
    expect(DOCS.world({ day: 3, gates: many(10_000, i => ({ ...gate, id: `g${i}` })) })!.gates).toHaveLength(40);
  });

  test('a cleared gate in the world carries the day it was cleared; one without it does not read', () => {
    const cleared = { id: 'g1', name: 'Den', rank: 'E', type: 'normal', status: 'cleared', breakDay: 5, clearedDay: 4 };
    expect(DOCS.world({ day: 6, gates: [cleared] })).toEqual({ day: 6, session: 0, gates: [cleared] });
    const { clearedDay: _gone, ...bare } = cleared;
    expect(DOCS.world({ day: 6, gates: [bare] })).toEqual({ day: 6, session: 0, gates: [] });
  });

  // The solo doc's arithmetic is the comment above SOLO_DOC in protocol.ts: built within DOC_MAX, every built-in monster
  // fits with room to spare, and a gate of a GM's monsters at their bounds can pass DOC_MAX alone and is left out.
  test('the worst-case solo doc on the wire: every built-in monster in solo gates, read back whole; a gate past the bound left out and not marked', () => {
    const seeds = seedMonsters(RULES), gate = (i: number, lines: Gate['monsters'], boss: string | null = null): Gate =>
      ({ ...newGate(), id: `g${i + 1}` as GateId, name: 'N'.repeat(80), rank: 'E', monsters: lines, bossId: boss as never, solo: true });
    const gates = many(40, i => gate(i, [0, 1, 2].map(k => ({ monsterId: seeds[(3 * i + k) % seeds.length]!.id, count: 26 })), seeds[i % seeds.length]!.id));
    const built = soloDoc({ gates, monsters: [] }, RULES, DOC_MAX), wire = JSON.stringify(built.doc);
    console.log(`the worst-case solo doc of built-in monsters: ${wire.length} characters (gates ${JSON.stringify(built.doc.gates).length}, monsters ${JSON.stringify(built.doc.monsters).length}, ${Object.keys(built.doc.monsters).length} of them; the largest ${Math.max(...Object.values(built.doc.monsters).map(m => JSON.stringify(m).length))})`);
    expect(built.left).toEqual([]);
    expect(wire.length, 'the built-in monsters leave the GM\'s monsters most of the room: 60% of DOC_MAX at most (a stat op\'s amount is a formula since item-stats 6.2, 25 characters a value more than a number; the three mythic seeds of notes-11 B.6 add about 1,000 characters each)').toBeLessThanOrEqual(DOC_MAX * 0.6);
    expect(DOCS.solo(JSON.parse(wire))).toEqual(built.doc);
    const hex = seeds.find(m => m.abilities.length)!.abilities[0]!;
    const heavy = (i: number): Monster => ({ ...seeds[0]!, id: `m${i + 1}` as never, name: 'H'.repeat(60), abilities: many(11, k => ({ ...hex, id: `a${k}` as never, name: 'A'.repeat(60) })) });
    const custom = many(50, heavy), big = gate(40, custom.map(m => ({ monsterId: m.id, count: 1 })));
    const withBig = soloDoc({ gates: [big, ...gates.slice(0, 2)], monsters: custom }, RULES, DOC_MAX);
    expect(withBig.left).toEqual([big.id]);
    expect(withBig.doc.gates.map(g => g.id)).toEqual(['g1', 'g2']);
    const world = worldDoc({ gates: [big, ...gates.slice(0, 2)] }, 1, new Set(withBig.doc.gates.map(g => g.id)), 0);
    expect(world.gates.map(g => [g.id, g.solo ?? false])).toEqual([['g41', false], ['g1', true], ['g2', true]]);
  });

  test('the shared bestiary keeps at most 200 monsters', () => {
    const entry = { key: 'goblin|E', name: 'Goblin', rank: 'E', hpMax: 38, armor: 4, resist: 5, speed: 110, abilities: ['Shortbow'], kills: 2, firstAt: '2026-11-12T12:00:00.000Z' };
    expect(DOCS.codex({ v: 1, at: '2026-11-12T12:00:00.000Z', entries: [entry] })).toEqual({ at: '2026-11-12T12:00:00.000Z', entries: [entry] });
    expect(DOCS.codex({ at: '', entries: many(10_000, i => ({ ...entry, key: `m${i}|E` })) })!.entries).toHaveLength(200);
  });
});

describe('a hunter sheet', () => {
  const kai = (fields: Raw = {}): Raw => ({ ...copy(newHunter()), id: 'h1', name: 'Kai', ...fields });
  /** A sheet as a player's phone pushes it: the hunter. */
  const sheet = (fields: Raw = {}): Raw => ({ hunter: kai(fields) });
  const hunterOf = (s: unknown): Raw => (s as { hunter: Raw }).hunter;

  test('the sheet a phone pushes comes through as it is: its hunter', () => {
    expect(parseSheet(sk(KEY), copy(VALID_SHEET[0]))).toEqual(VALID_SHEET[1] as never);
  });

  test('a deleted hunter\'s tombstone comes through as a tombstone', () => {
    expect(parseSheet(sk(KEY), { deleted: true })).toEqual({ deleted: true });
  });

  test('a sheet stored under another hunter\'s key, or that is not a hunter, is refused', () => {
    expect(parseSheet(sk(KEY), sheet({ id: 'h2' }))).toBeNull();
    expect(parseSheet(sk(KEY), sheet({ id: undefined }))).toBeNull();
    expect(parseSheet(sk(KEY), { hunter: 'Kai' })).toBeNull();
    expect(parseSheet(sk(KEY), {})).toBeNull();
    expect(parseSheet(sk(KEY), kai())).toBeNull();
    expect(parseSheet(sk(KEY), 'Kai')).toBeNull();
    expect(parseSheet(sk(KEY), [sheet()])).toBeNull();
  });

  test('a sheet is repaired as a save repairs a hunter: a huge name is cut to 60, a level that is not a number is 1', () => {
    expect(hunterOf(parseSheet(sk(KEY), sheet({ name: BIG, level: 'max' })))).toMatchObject({ name: 'x'.repeat(60), level: 1 });
  });

  test('each list on a sheet keeps at most 100 entries', () => {
    const items = many(10_000, i => ({ ...parseItem({ name: 'Pebble' })!, id: `i${i + 1}` }));
    expect(hunterOf(parseSheet(sk(KEY), sheet({ items }))).items).toHaveLength(100);
  });

  test('a __proto__ key on a sheet or its hunter is dropped', () => {
    const raw = JSON.parse(`{"__proto__": {"admin": true}, "hunter": {"__proto__": {"admin": true}, ${JSON.stringify(kai()).slice(1)}}`);
    const parsed = parseSheet(sk(KEY), raw) as Raw;
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(parsed.hunter)).toBe(Object.prototype);
    expect(parsed.admin).toBeUndefined();
    expect(parsed.hunter.admin).toBeUndefined();
  });

  // A hunter's personal gates travel with its sheet (notes-2-solo.md 10): read with their bounds, at most 10 gates of at
  // most 3 roster lines each. The worst case, every field at its bound, is 5,105 characters, under a sixth of SHEET_MAX.
  test('a sheet\'s personal gates are read with their bounds: at most 10, the newest, each with at most 3 roster lines', () => {
    const gate = (i: number) => ({
      id: `pg${i + 1}`, name: 'N'.repeat(500), rank: 'Q', at: '2026-11-18T10:00:00.000Z', closesAt: '2026-11-19T10:00:00.000Z',
      monsters: many(9, k => ({ monsterId: `seed:monster-${k}`, count: 999 })),
    });
    const solo = hunterOf(parseSheet(sk(KEY), sheet({ solo: { clock: { at: 'on', next: 'soon' }, gates: many(15, gate) } }))).solo as { clock: unknown; gates: Raw[] };
    expect(solo.clock).toEqual({ at: 'off' });
    expect(solo.gates.map(g => g.id)).toEqual(many(10, i => `pg${i + 6}`));
    expect(solo.gates[0]).toMatchObject({ name: 'N'.repeat(60), rank: 'E' });
    expect(solo.gates[0]!.monsters).toEqual(many(3, k => ({ monsterId: `seed:monster-${k}`, count: 12 })));
  });

  test('the worst-case personal gates on a sheet are under a sixth of what the room takes', () => {
    const worst = { clock: { at: 'on', next: '2026-11-18T10:00:00.000Z' }, gates: many(10, i => ({
      id: `pg${1e15 + i}`, name: 'N'.repeat(60), rank: 'E', at: '2026-11-18T10:00:00.000Z', closesAt: '2026-11-19T10:00:00.000Z',
      monsters: many(3, k => ({ monsterId: `seed:${'m'.repeat(70)}${k}`, count: 12 })),
    })) };
    const read = hunterOf(parseSheet(sk(KEY), sheet({ solo: worst }))).solo;
    expect(read).toEqual(worst);
    expect(JSON.stringify(read).length).toBe(5105);
    expect(JSON.stringify(read).length).toBeLessThan(SHEET_MAX / 6);
  });

  test('an older phone\'s pushed sheet carrying a legacy build field parses cleanly and keeps the unknown field intact', () => {
    expect(hunterOf(parseSheet(sk(KEY), sheet({ build: { path: 'house-path', picks: [0, 1] } })))).toMatchObject({ build: { path: 'house-path', picks: [0, 1] } });
  });
});

describe('the poll answer', () => {
  const event = (seq: number, type: EventType = 'roll') => ({ seq, at: '2026-11-12T12:00:00.000Z', from: 'd-player1', type, payload: valid(type) });
  const ANSWER = {
    gm: false, now: '2026-11-12T12:00:00.000Z', events: [event(1), event(2, 'questUpdate')], next: 2, more: false,
    sheets: { [KEY]: { at: '2026-11-12T12:00:00.000Z', from: 'd-player1', data: copy(VALID_SHEET[1]) } },
    docs: { rules: { at: '2026-11-12T12:00:00.000Z', from: 'd-gm1', data: copy(roomRulesOf(RULES)) } },
  };
  const parse = (fields: Raw = {}) => parseRoomState({ ...copy(ANSWER), ...fields }) as Raw | null;

  test('an answer comes through with typed events, sheets and docs', () => {
    expect(parse()).toEqual({ ...ANSWER, events: [{ ...event(1), payload: VALID.roll[1] }, { ...event(2, 'questUpdate'), payload: VALID.questUpdate[1] }] } as never);
  });

  test('a bad event, sheet or doc is dropped and the cursor still moves past it', () => {
    const state = parse({
      events: [event(1), { ...event(2), payload: { eid: EID } }], next: 2,
      sheets: { ...ANSWER.sheets, [OTHER]: { at: '', from: 'd-player2', data: { hunter: { name: 'not h4' } } } },
      docs: { rules: { at: '', from: 'd-gm1', data: { solo: { personal: 'yes' } } }, nope: { at: '', from: 'd-gm1', data: {} } },
    })!;
    expect(state.events.map((e: Raw) => e.seq)).toEqual([1]);
    expect(state.next).toBe(2);
    expect(Object.keys(state.sheets)).toEqual([KEY]);
    expect(state.docs).toEqual({});
  });

  test('at most one page of 200 events', () => {
    expect(parse({ events: many(10_000, i => event(i + 1)) })!.events).toHaveLength(200);
  });

  test('presence is there only when the server sent it', () => {
    expect(parse()!.presence).toBeUndefined();
    expect(parse({ gm: true, presence: { 'd-player1': '2026-11-12T12:00:00.000Z', 'bad id!': 'x' } })!.presence).toEqual({ 'd-player1': '2026-11-12T12:00:00.000Z' });
  });

  test('an answer missing its cursor, or that is not an object, is refused', () => {
    expect(parse({ next: undefined })).toBeNull();
    expect(parseRoomState('{"gm":true}')).toBeNull();
  });
});

describe('an armed reaction (kits design 8.4.2)', () => {
  test('a player arms a reaction or disarms with null; a turn reaction names a row', () => {
    expect(payload('arm', { eid: EID, by: KEY, ability: null })).toEqual({ eid: EID, by: KEY, ability: null, on: null });
    expect(payload('arm', { eid: EID, by: KEY, ability: 'react', on: 'c4' })).toEqual({ eid: EID, by: KEY, ability: 'react', on: 'c4' });
  });

  test('an ability id past 40 characters, an empty one or a number is refused, and so is a row that is not an id', () => {
    for (const ability of ['x'.repeat(41), '', 7]) expect(payload('arm', { eid: EID, by: KEY, ability })).toBeNull();
    expect(payload('arm', { eid: EID, by: KEY, ability: 'parry', on: 5 })).toBeNull();
  });
});

describe('a dodge event and onDodge', () => {
  test('parses a player dodge pick and refuses invalid n or place', () => {
    expect(payload('dodge', { eid: EID, by: KEY, n: 2, place: { x: 4, y: 5 } })).toEqual({ eid: EID, by: KEY, n: 2, place: { x: 4, y: 5 } });
    expect(payload('dodge', { eid: EID, by: KEY, n: 'two', place: { x: 4, y: 5 } })).toBeNull();
    expect(payload('dodge', { eid: EID, by: KEY, n: 1, place: 'bad' })).toBeNull();
    expect([EVENTS.dodge.gmOnly, EVENTS.dodge.ownSheet]).toEqual([false, true]);
  });

  test('onDodge matches the remote hunter only when fight.dodge.n matches p.n', () => {
    const f = { phase: 'running', dodge: { n: 3 }, rows: [{ id: 'c-mira', holder: { kind: 'remote', remote: KEY } }] } as unknown as Fight;
    expect(onDodge(f, { by: sk(KEY), n: 3 })).toBe('c-mira' as never);
    expect(onDodge(f, { by: sk(KEY), n: 2 })).toBeNull();
    expect(onDodge(f, { by: sk(OTHER), n: 3 })).toBeNull();
    expect(onDodge(null, { by: sk(KEY), n: 3 })).toBeNull();
  });
});

describe('an offer between two hunters, and its one end', () => {
  const offer = (p: Raw = {}): Raw => ({ ...valid('offer'), ...p });
  const end = (p: Raw = {}): Raw => ({ ...valid('offerEnd'), ...p });
  const ITEM_LINE = { from: 'i3', item: POTION };

  test('an offer is for exactly one other hunter, and gives something', () => {
    expect(payload('offer', offer({ to: [KEY] }))).toBeNull();
    expect(payload('offer', offer({ to: [OTHER, 'd-x:h1'] }))).toBeNull();
    expect(payload('offer', offer({ to: [] }))).toBeNull();
    expect(payload('offer', offer({ gives: { gold: 0, items: [] } }))).toBeNull();
    expect(payload('offer', offer({ gives: { gold: 5, items: [] }, asks: { gold: 0, items: [] } }))).not.toBeNull();
  });

  test('an offer\'s names are cut to 60 characters; its goods and asks are read strictly, a bad line refusing the offer', () => {
    expect(payload('offer', offer({ names: { by: 'B'.repeat(80), to: 'Mira' } }))!.names.by).toBe('B'.repeat(60));
    expect(payload('offer', offer({ gives: { gold: 0, items: [ITEM_LINE, { from: 'bad id', item: POTION }] } }))).toBeNull();
    expect(payload('offer', offer({ asks: { gold: 0, items: [{ id: 'i7', qty: 0, name: 'Iron Shield' }] } }))).toBeNull();
    expect(payload('offer', offer({ gives: { gold: 1.5, items: [] } }))).toBeNull();
  });

  test('an offer\'s id leaves room for its end: one longer than 38 characters, or ending as an end id, is refused', () => {
    expect(payload('offer', offer({ eid: 'o'.repeat(38) }))).not.toBeNull();
    expect(payload('offer', offer({ eid: 'o'.repeat(39) }))).toBeNull();
    expect(payload('offer', offer({ eid: 'd-p1-abc-e' }))).toBeNull();
  });

  test('an end whose id is not its offer\'s end id is refused, so the room never stores a mismatched end', () => {
    expect(payload('offerEnd', end({ eid: EID }))).toBeNull();
    expect(payload('offerEnd', end({ eid: 'd-other-x-e' }))).toBeNull();
    expect(payload('offerStop', { ...valid('offerStop'), eid: `${EID}-e` })).toBeNull();
    expect(payload('offerEnd', end({ offer: END }))).toBeNull();
  });

  test('a message of any other type under an offer\'s end id is refused: it would take the offer\'s one end', () => {
    for (const type of EVENT_TYPES.filter(t => t !== 'offerEnd' && t !== 'offerStop')) expect(payload(type, { ...valid(type), eid: END }), type).toBeNull();
  });

  test('an accept carries goods; a refuse or a take back carries none; an end is for the offer\'s other hunter', () => {
    expect(payload('offerEnd', end({ how: 'accept', gives: { gold: 20, items: [ITEM_LINE] } }))!.gives.gold).toBe(20);
    expect(payload('offerEnd', end({ how: 'refuse', gives: { gold: 20, items: [] } }))).toBeNull();
    expect(payload('offerEnd', end({ how: 'withdraw', gives: { gold: 0, items: [ITEM_LINE] } }))).toBeNull();
    expect(payload('offerEnd', end({ how: 'stop' }))).toBeNull();
    expect(payload('offerEnd', end({ to: [KEY] }))).toBeNull();
  });

  test('a stop names exactly the offer\'s two hunters', () => {
    for (const to of [[KEY], [KEY, KEY], [KEY, OTHER, 'd-x:h1'], [KEY, 'bad key']]) expect(payload('offerStop', { ...valid('offerStop'), to })).toBeNull();
  });

  test('every addressed event type is sealed, only coinLand and a room-wide system broadcast are unsealed, and every sealed event names at least one phone', () => {
    const unsealed = EVENT_TYPES.filter(t => !isSealed(parseEvent(t, valid(t))!)).sort();
    expect(unsealed).toEqual(['coinLand', 'system']);
    const devs = [KEY, OTHER].map(k => ({ kind: 'phone' as const, device: parseDeviceId(k.split(':')[0]!)! }));
    for (const t of EVENT_TYPES) {
      const ev = parseEvent(t, valid(t))!;
      if (!isSealed(ev)) continue;
      expect(devs.some(v => servedTo(ev, v)), `${t} is sealed and must name at least one phone`).toBe(true);
    }
  });

  /**
   * The measurement of notes-5-trade.md 12.9: an item has a size (size.ts `THING_MAX.item`), so an offer's cap follows from
   * it: eight items at the size, with the worst rest of an offer, fit `OFFER_MAX`, and that fits the server's body.
   */
  test('the worst offer by part: eight items at an item\'s size, with full names and eight full asks, fit the offer\'s cap, and the reader takes it', () => {
    const bytes = (v: unknown) => goodsSize(v);
    const wide = (n: number) => 'ࠀ'.repeat(n);
    const note = (n: number) => ({ op: 'note', text: 'x'.repeat(n) });
    /** An item of exactly `THING_MAX.item` bytes: full three-byte texts, notes as effects and as worn ops, the last note cut to fit. */
    const atCap = Array.from({ length: 201 }, (_, pad) => parseItem({ name: wide(ITEM_BOUNDS.name), desc: wide(ITEM_BOUNDS.desc), rar: 'mythic', type: 'accessory', effects: [...Array(11).fill(note(200)), note(pad)], worn: { label: 'w', desc: 'x'.repeat(500), ops: Array(10).fill(note(200)) } }))
      .find(it => it !== null && bytes(it) === THING_MAX.item)!;
    expect(bytes(atCap), 'an item of exactly the cap reads').toBe(THING_MAX.item);
    const offerOf = (item: unknown, lines: number) => ({
      eid: 'o'.repeat(38), by: 'd-'.padEnd(29, 'p') + ':h99999', to: ['d-'.padEnd(29, 'q') + ':h99999'], names: { by: wide(60), to: wide(60) },
      gives: { gold: 1e9, items: Array.from({ length: lines }, (_, i) => ({ from: `i${900000 + i}`, item })) },
      asks: { gold: 1e9, items: Array.from({ length: GOODS_LINES }, (_, i) => ({ id: `i${800000 + i}`, qty: ITEM_BOUNDS.qty, name: wide(60) })) },
    });
    const wrapper = bytes({ from: 'd'.repeat(40), type: 'offerEnd', payload: {} }) - 2, worst = bytes(offerOf(atCap, GOODS_LINES)), rest = bytes(offerOf(atCap, 0));
    console.info([
      `an item's size: ${THING_MAX.item} bytes; a line's wrapper around it: ${(worst - rest) / GOODS_LINES - THING_MAX.item}`,
      `the rest of the worst offer (ids, names, gold, ${GOODS_LINES} asks of 60 three-byte characters): ${rest} bytes`,
      `the worst offer, ${GOODS_LINES} items at the size: ${worst} bytes, under OFFER_MAX ${OFFER_MAX}; with the request's wrapper (${wrapper}): ${OFFER_MAX + wrapper}, under the server's 65,536`,
    ].join('\n'));
    expect(worst).toBeLessThanOrEqual(OFFER_MAX);
    expect(OFFER_MAX - worst, 'the cap is the worst offer rounded up to a KiB').toBeLessThan(1024);
    expect(OFFER_MAX + wrapper).toBeLessThan(64 * 1024);
    expect(payload('offer', offerOf(atCap, GOODS_LINES)), 'the reader takes the worst offer').not.toBeNull();
    expect(payload('offer', offerOf({ ...atCap, worn: { ...atCap.worn!, ops: [...atCap.worn!.ops, note(200)] } }, 1)), 'a line whose item is over an item\'s size refuses the offer').toBeNull();
  });

  test('the largest status, ability and item the readers take, against what the app ships and what carries them (notes-5-trade.md 12.9)', () => {
    const bytes = (v: unknown) => goodsSize(v);
    const K = RULES.dice;
    // 12.4's largest formula: 100 dice terms at their largest under 99 additions and a floor, 200 parts
    const die: Formula = { kind: 'dice', count: K.maxDice, sides: K.maxSides, mods: { explode: { op: '<', n: K.maxSides }, cut: { how: 'kh', n: K.maxDice }, success: { op: '<', n: K.maxSides } } };
    const tree = (leaves: number): Formula => (leaves === 1 ? die : { kind: 'binary', op: '+', left: tree(Math.ceil(leaves / 2)), right: tree(Math.floor(leaves / 2)) });
    const formula: Formula = { kind: 'fn', fn: 'floor', arg: tree(FORMULA_PARTS / 2) };
    expect(partsOf(formula)).toBeLessThanOrEqual(FORMULA_PARTS);
    const leaf = { op: 'damage', type: 'physical', amount: Array.from({ length: 6 }, () => formula), when: 'turn' };
    expect(parseOp(leaf, RULES), 'one op reads alone, whatever its size: what holds it is sized').toEqual(leaf);
    const def = (ops: unknown[]) => ({ label: 'Big', desc: '', ops });
    expect(parseStatusDef(def([leaf]), RULES), 'a status of that one op is over a status\'s size: refused whole').toBeNull();
    expect(parseItem({ name: 'Big', effects: [leaf] }), 'and an item with it as an effect').toBeNull();
    expect(parseItem({ name: 'Big', type: 'accessory', worn: def([leaf]) }), 'an item whose worn status is too large is refused whole, never kept without it').toBeNull();
    expect(parseAbility({ ...abilityOf('strike', { id: abilityId('big'), name: 'Big' }, RULES), ops: [{ op: 'applyStatus', key: 'big', def: def([leaf]), duration: null }] }, RULES), 'an ability that applies it').toBeNull();
    // what the caps then bound, by arithmetic from the counts each holder reads
    const sheetRest = JSON.stringify({ hunter: pushedSheet(newHunter(RULES)) }).length;
    console.info([
      `the sizes: a status ${THING_MAX.status}, an item ${THING_MAX.item}, an ability ${THING_MAX.ability} bytes (before: one op of six tiers of the largest formula alone was ${bytes(leaf)})`,
      `a new hunter's pushed sheet: ${sheetRest} characters of SHEET_MAX ${SHEET_MAX}; items at the size it then holds: ${Math.floor((SHEET_MAX - sheetRest) / (THING_MAX.item + 20))}`,
      `a reward at its counts (${REWARD_BOUNDS.items} items, ${REWARD_BOUNDS.statuses} statuses, ${REWARD_BOUNDS.skills} skills): at most about ${REWARD_BOUNDS.items * THING_MAX.item + REWARD_BOUNDS.statuses * THING_MAX.status + REWARD_BOUNDS.skills * THING_MAX.ability} bytes, over the server's 65,536 body: an award that large is refused by the room (413) and the GM is told`,
      `the fight doc's table of defs holds DOC_DEFS_MAX ${DOC_DEFS_MAX} characters: one status at the size (${THING_MAX.status}) fits it`,
    ].join('\n'));
    expect(THING_MAX.status + 1024, 'an item holds one status at its size and a KiB of its own').toBeLessThanOrEqual(THING_MAX.item);
    expect(THING_MAX.status).toBeLessThanOrEqual(DOC_DEFS_MAX);
  });

  test('a hunter\'s sheet holds four items at an item\'s size and reads back whole; a fifth is over what the room takes', () => {
    const note = (n: number) => ({ op: 'note', text: 'x'.repeat(n) });
    const big = (i: number) => ({ ...Array.from({ length: 501 }, (_, n) => parseItem({ name: `Tome ${i}`, type: 'accessory', desc: 'ࠀ'.repeat(n) + 'x'.repeat(500 - n), effects: Array(12).fill(note(200)), worn: { label: 'w', desc: 'x'.repeat(500), ops: Array(12).fill(note(200)) } })).findLast(it => it !== null)!, id: `i${i}` });
    const withItems = (n: number) => ({ hunter: { ...pushedSheet(newHunter(RULES)), id: 'h1', items: Array.from({ length: n }, (_, i) => big(i + 1)) } });
    const four = withItems(4), five = withItems(5);
    expect(goodsSize(four.hunter.items[0])).toBeGreaterThan(THING_MAX.item - 3);
    expect(JSON.stringify(four).length).toBeLessThanOrEqual(SHEET_MAX);
    expect(JSON.stringify(five).length).toBeGreaterThan(SHEET_MAX);
    const read = parseSheet(sk(KEY), copy(four));
    expect(read && 'hunter' in read ? read.hunter.items : null, 'the four items read back as they were').toEqual(four.hunter.items as never);
  });
});

describe('the party stash on the wire (notes-5-trade.md 3.2)', () => {
  const ASK = 'd-player1-mabc13xyz';
  test('a stash ask reads a put\'s goods, a take\'s line and gold; nothing else, and no empty put', () => {
    expect(payload('stashAsk', { ...valid('stashAsk'), ask: { kind: 'take', item: 'i9', qty: 2, name: 'Health Potion' } })!.ask).toEqual({ kind: 'take', item: 'i9', qty: 2, name: 'Health Potion' });
    expect(payload('stashAsk', { ...valid('stashAsk'), ask: { kind: 'gold', gold: 30 } })!.ask).toEqual({ kind: 'gold', gold: 30 });
    for (const ask of [{ kind: 'put', goods: { gold: 0, items: [] } }, { kind: 'take', item: 'i9', qty: 0, name: 'x' }, { kind: 'gold', gold: 0 }, { kind: 'steal', gold: 5 }, null]) {
      expect(payload('stashAsk', { ...valid('stashAsk'), ask }), JSON.stringify(ask)).toBeNull();
    }
  });

  test('a stash answer is kept, given goods, or refused with why; a given answer with no goods is refused', () => {
    expect(payload('stashAnswer', { eid: EID, to: [KEY], ask: ASK, verdict: 'kept' })).toEqual({ eid: EID, to: [KEY], ask: ASK, verdict: 'kept' });
    const goods = { gold: 0, items: [{ from: 'i3', item: POTION }] };
    expect(payload('stashAnswer', { eid: EID, to: [KEY], ask: ASK, verdict: 'given', goods })).toEqual({ eid: EID, to: [KEY], ask: ASK, verdict: 'given', goods });
    expect(payload('stashAnswer', { eid: EID, to: [KEY], ask: ASK, verdict: 'given', goods: { gold: 0, items: [] } })).toBeNull();
    expect(payload('stashAnswer', { eid: EID, to: [KEY], ask: ASK, verdict: 'refused', why: 'lost' })).toBeNull();
    expect(payload('stashAnswer', { eid: EID, to: [KEY, OTHER], ask: ASK, verdict: 'kept' }), 'an answer is for one hunter').toBeNull();
  });

  /**
   * The measurement of notes-5-trade.md 3.2, before the cap is trusted: `STASH_LINES` lines of the largest item the readers
   * take do not fit `DOC_MAX`, so the count alone cannot bound the doc. A put is refused `full` when the doc would pass
   * `DOC_MAX` (stash.ts `stashFits`), so the worst doc is `DOC_MAX` by construction; the count bounds a stash of ordinary items.
   */
  test('the worst-case stash doc on the wire: forty lines of a large item are far over DOC_MAX, so a put is refused by the doc\'s size; forty of the largest shop or loot item fit', () => {
    const note = (n: number) => ({ op: 'note', text: 'x'.repeat(n) });
    /** A large item the reader takes: full names, twelve effects and ten worn ops of full notes, every character one byte. At most `THING_MAX.item` bytes, so no item has more characters. */
    const atCap = parseItem({ name: 'n'.repeat(ITEM_BOUNDS.name), desc: 'd'.repeat(ITEM_BOUNDS.desc), rar: 'mythic', type: 'accessory', effects: Array(12).fill(note(200)), worn: { label: 'w', desc: 'x'.repeat(500), ops: Array(10).fill(note(200)) } })!;
    expect(JSON.stringify(atCap).length, 'it reads, within an item\'s size').toBeLessThanOrEqual(THING_MAX.item);
    const doc = (item: object, lines: number) => stashDoc({ gold: GOODS_GOLD_MAX, items: Array.from({ length: lines }, (_, i) => ({ ...item, id: `i${900000 + i}` }) as Item) });
    const size = (d: unknown) => JSON.stringify(d).length;
    const rest = size(doc(atCap, 0)), line = (size(doc(atCap, 2)) - size(doc(atCap, 1)));
    const fit = Math.floor((DOC_MAX - rest + 1) / line);
    const ordinary = [...SHOP_ITEMS, ...LOOT_ITEMS.map(d => itemOf(RULES, d))].map(t => parseItem(t)!).sort((a, b) => size(b) - size(a))[0]!;
    const forty = size(doc(ordinary, STASH_LINES));
    console.info([
      `the stash doc's rest (gold ${GOODS_GOLD_MAX}, the list): ${rest} characters; a line of the large item (${JSON.stringify(atCap).length} characters; an item's size is ${THING_MAX.item} bytes) with its id: ${line}`,
      `${STASH_LINES} lines of it: ${size(doc(atCap, STASH_LINES))} characters, ${(size(doc(atCap, STASH_LINES)) / DOC_MAX).toFixed(1)} times DOC_MAX ${DOC_MAX}; lines of it that fit: ${fit}`,
      `the largest shop or loot item (${ordinary.name}): ${size(ordinary)} characters; ${STASH_LINES} lines of it: ${forty}, ${Math.round((100 * forty) / DOC_MAX)}% of DOC_MAX`,
    ].join('\n'));
    expect(size(doc(atCap, STASH_LINES)), 'the count alone does not bound the doc').toBeGreaterThan(DOC_MAX);
    expect(stashFits({ gold: GOODS_GOLD_MAX, items: doc(atCap, fit).items }), 'the most lines of it fit').toBe(true);
    expect(stashFits({ gold: GOODS_GOLD_MAX, items: doc(atCap, fit + 1).items }), 'one more does not: the put is refused full').toBe(false);
    expect(DOCS.stash(doc(atCap, fit)), 'the reader takes the worst doc a put allows').not.toBeNull();
    expect(DOCS.stash(doc(atCap, fit + 1)), 'and refuses a longer one').toBeNull();
    expect(forty, 'forty lines of the largest item the game ships fit').toBeLessThanOrEqual(DOC_MAX);
    expect(stashFits({ gold: 0, items: doc(ordinary, STASH_LINES + 1).items }), 'past STASH_LINES lines the stash is full').toBe(false);
  });

  test('award.earned accepts from: clear and newEventId mints a valid event id', () => {
    const eid = newEventId({ device: 'd-gm', now: 1700000000000, rand: 0.25 });
    expect(eid).not.toBeNull();
    const ev = newEvent('award', { to: ['d-p1:h1' as never], rewards: { xp: 100, points: 0, gold: 50, crystal: 12, items: [], title: null, job: null, skills: [], statuses: [], boons: [] }, earned: { from: 'clear', what: 'Goblin Den' } }, { device: 'd-gm', now: 1700000000001, rand: 0.5 });
    expect(ev?.type).toBe('award');
    expect(ev?.type === 'award' && ev.payload.earned).toEqual({ from: 'clear', what: 'Goblin Den' });
  });
});

describe('wire error codes (API_ERRORS, apiError, parseApiError)', () => {
  test('every error has a unique UPPER_SNAKE_CASE code and unique legacy wire string', () => {
    const entries = Object.values(API_ERRORS);
    const codes = entries.map(e => e.code);
    const legacies = entries.map(e => e.legacy);
    expect(new Set(codes).size).toBe(entries.length);
    expect(new Set(legacies).size).toBe(entries.length);
    for (const c of codes) expect(c).toMatch(/^[A-Z]+(?:_[A-Z]+)*$/);
  });

  test('apiError keeps the legacy error field beside code so older phones still match during a deploy', () => {
    expect(apiError('upgrade', { build: 'b-1' })).toEqual({ code: 'UPGRADE', error: 'upgrade', build: 'b-1' });
    expect(apiError('badEvent', { reason: 'payload' })).toEqual({ code: 'BAD_EVENT', error: 'bad event', reason: 'payload' });
    expect(apiError('noSuchRoom')).toEqual({ code: 'NO_SUCH_ROOM', error: 'no such room' });
    expect(apiError('notYourSheet')).toEqual({ code: 'NOT_YOUR_SHEET', error: 'not your sheet' });
    expect(apiError('roomFull')).toEqual({ code: 'ROOM_FULL', error: 'room full' });
    expect(apiError('tooLarge')).toEqual({ code: 'TOO_LARGE', error: 'too large' });
    expect(apiError('gmOnly')).toEqual({ code: 'GM_ONLY', error: 'gm only' });
    expect(apiError('removed')).toEqual({ code: 'REMOVED', error: 'removed' });
  });

  test('parseApiError reads both newer server bodies (code + error) and older server bodies (error only)', () => {
    for (const [key, entry] of Object.entries(API_ERRORS) as [keyof typeof API_ERRORS, (typeof API_ERRORS)[keyof typeof API_ERRORS]][]) {
      expect(parseApiError(apiError(key)), `newer server ${key}`).toEqual({ code: entry.code, text: entry.text });
      expect(parseApiError({ error: entry.legacy }), `older server ${key}`).toEqual({ code: entry.code, text: entry.text });
    }
  });

  test('code takes precedence over error prose when a newer server rewords error', () => {
    expect(parseApiError({ code: 'NO_SUCH_ROOM', error: 'This room has expired.' })).toEqual({
      code: 'NO_SUCH_ROOM',
      text: API_ERRORS.noSuchRoom.text,
    });
    expect(parseApiError({ code: 'UPGRADE', error: 'App update required.' })).toEqual({
      code: 'UPGRADE',
      text: API_ERRORS.upgrade.text,
    });
  });

  test('unknown, malformed, and prototype-named inputs never invent a code and bound text to 60 characters', () => {
    expect(parseApiError(null)).toEqual({ code: null, text: '' });
    expect(parseApiError(undefined)).toEqual({ code: null, text: '' });
    expect(parseApiError(42)).toEqual({ code: null, text: '' });
    expect(parseApiError([])).toEqual({ code: null, text: '' });
    expect(parseApiError({})).toEqual({ code: null, text: '' });
    expect(parseApiError({ code: 'FUTURE_CODE', error: 'x'.repeat(80) })).toEqual({ code: null, text: 'x'.repeat(60) });
    expect(parseApiError({ code: 'toString', error: 'constructor' })).toEqual({ code: null, text: 'constructor' });
  });

  test('/api/health diagnostic codes are distinct from API_ERRORS and never parse as room API error codes', () => {
    for (const healthCode of ['opening', 'closed', 'unreachable', 'ERR_POSTGRES_CONNECTION_REFUSED', 'ECONNREFUSED']) {
      expect(parseApiError({ ok: false, db: 'postgres', error: healthCode })).toEqual({ code: null, text: healthCode });
    }
  });
});
