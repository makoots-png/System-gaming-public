import { parseSheetKey } from '../src/core/ids.ts';
import { describe, expect, test } from 'bun:test';
import {
  COINS_MAX, COIN_STATES, RULINGS, SIDES, VERDICT_WORDS, addCoin, can, coinOf, coinWords, decider, inAir, isCoinRoll, landing, landingOf, newRollId,
  parseCoin, parseCoins, rollId, sideOf, stepCoin, takeCall, transition, verdict, callRuled, callTaken, coinCalled, coinLanded, coinRolled,
  COIN_PROMPT_EVENTS, COIN_PROMPT_IDLE, COIN_PROMPT_STATES, coinPromptPutOff, coinPromptStep,
} from '../src/core/coin.ts';
import { isRefused } from '../src/core/save-step.ts';
import { newHunter } from '../src/core/save.ts';
import type { Hunter, LogEntry } from '../src/core/save.ts';
import { hid } from './fixtures/ids.ts';
import type { Coin, CoinEvent, CoinEventType, CoinPrompt, CoinPromptEvent, CoinState, RollFacts, CoinSide } from '../src/core/coin.ts';
import { CALL_A, CALL_B, PROMPT_WALK, WALK_EVENTS, coinIn, fields } from './models/coin-events.ts';

describe('the life of a coin', () => {
  // Every state and event pair: the coin it leads to, or 'no change' when the event does not apply there.
  const rows: [CoinState, CoinEvent, Coin | 'no change'][] = [
    ['uncalled', { type: 'call', side: 'heads' }, { ...fields(), at: 'called', call: 'heads' }],
    ['uncalled', { type: 'call', side: 'tails' }, { ...fields(), at: 'called', call: 'tails' }],
    ['uncalled', { type: 'land', side: 'heads' }, 'no change'],
    ['called', { type: 'call', side: 'tails' }, 'no change'],
    ['called', { type: 'land', side: 'heads' }, { ...fields(), at: 'landed', call: 'heads', side: 'heads' }],
    ['called', { type: 'land', side: 'tails' }, { ...fields(), at: 'landed', call: 'heads', side: 'tails' }],
    ['landed', { type: 'call', side: 'heads' }, 'no change'],
    ['landed', { type: 'land', side: 'heads' }, 'no change'],
  ];
  for (const [from, event, to] of rows) {
    test(`${from} + ${event.type} ${event.side}: ${to === 'no change' ? to : to.at}`, () => {
      const before = coinIn(from), after = transition(before, event);
      if (to === 'no change') expect(after).toBe(before);
      else expect(after).toEqual(to);
      expect(can(before, event.type)).toBe(to !== 'no change');
    });
  }

  test('every state and event pair has a row above', () => {
    const types: CoinEventType[] = ['call', 'land'];
    const covered = new Set(rows.map(([from, e]) => `${from} ${e.type}`));
    expect(COIN_STATES.flatMap(s => types.map(t => `${s} ${t}`)).filter(k => !covered.has(k))).toEqual([]);
  });

  test('a landed coin keeps its first side whatever arrives after it', () => {
    let c = coinIn('called', 'tails');
    for (const e of [{ type: 'land', side: 'heads' }, ...WALK_EVENTS] as CoinEvent[]) c = transition(c, e);
    expect(c).toEqual({ ...fields(), at: 'landed', call: 'tails', side: 'heads' });
  });

  test('a transition never changes the coin it was given', () => {
    const before = coinIn('called'), copy = JSON.parse(JSON.stringify(before));
    transition(before, { type: 'land', side: 'tails' });
    expect(before).toEqual(copy);
  });
});

describe('which roll calls the coin', () => {
  const roll = (o: Partial<RollFacts>): RollFacts => ({ kind: 'check', expr: '1d20+3', natural: 20, inFight: false, ...o });
  const rows: [string, RollFacts, boolean][] = [
    ['a stat check that shows a natural 20', roll({}), true],
    ['a stat check that shows a natural 1', roll({ natural: 1 }), true],
    ['a stat check that shows a 19', roll({ natural: 19 }), false],
    ['a stat check that shows a 2', roll({ natural: 2 }), false],
    ['a stat check of a hunter in a running fight', roll({ inFight: true }), false],
    ['a d20 from the Dice view', roll({ kind: 'die', expr: '1d20' }), true],
    ['a d20 with a modifier from the Dice view', roll({ kind: 'die', expr: 'd20-1+2', natural: 1 }), true],
    ['a d20 with two dice beside it', roll({ kind: 'die', expr: '1d20+2d6' }), false],
    ['two d6 with no d20', roll({ kind: 'die', expr: '2d6', natural: null }), false],
    ['a death save, an extraction or the fight\'s d20', roll({ kind: 'other', expr: '1d20' }), false],
    ['a d20 from the Dice view in a running fight', roll({ kind: 'die', expr: '1d20', inFight: true }), false],
  ];
  for (const [name, facts, calls] of rows) test(`${name}: ${calls ? 'the coin' : 'the true roll'}`, () => expect(isCoinRoll(facts)).toBe(calls));

  test('a player\'s phone in a room waits for the GM; alone, or on the GM\'s phone, the coin flips', () => {
    expect(decider('player')).toBe('gm');
    expect(decider('alone')).toBe('flip');
    expect(decider('gm')).toBe('flip');
  });
});

describe('the GM\'s ruling and what the landing means', () => {
  test('Right lands on the called side, Wrong on the other, the coin on the flip\'s side', () => {
    expect(landing('heads', 'right', 'tails')).toBe('heads');
    expect(landing('tails', 'right', 'heads')).toBe('tails');
    expect(landing('heads', 'wrong', 'heads')).toBe('tails');
    expect(landing('tails', 'wrong', 'tails')).toBe('heads');
    expect(landing('heads', 'coin', 'tails')).toBe('tails');
    expect(landing('heads', 'coin', 'heads')).toBe('heads');
  });

  test('a true flip is heads below one half and tails from one half', () => {
    expect([0, 0.4999, 0.5, 0.9999].map(sideOf)).toEqual(['heads', 'heads', 'tails', 'tails']);
  });

  test('on a 20 a right call is a critical success and a wrong one a success; on a 1 right is saved and wrong a critical failure', () => {
    const words = (face: 1 | 20, call: CoinSide, side: CoinSide): string => VERDICT_WORDS[verdict(face, call, side)];
    expect(words(20, 'heads', 'heads')).toBe('Critical success');
    expect(words(20, 'heads', 'tails')).toBe('Success');
    expect(words(1, 'tails', 'tails')).toBe('Saved');
    expect(words(1, 'tails', 'heads')).toBe('Critical failure');
  });

  test('a phone asks "Heads or tails?" before the call, says "In the air" until the coin lands, then what the landing means', () => {
    expect(coinWords(coinIn('uncalled'))).toBe('Heads or tails?');
    expect(coinWords(coinIn('called'))).toBe('In the air');
    expect(coinWords({ ...fields(), face: 20, at: 'landed', call: 'heads', side: 'heads' })).toBe('Critical success');
    expect(coinWords({ ...fields(), face: 1, at: 'landed', call: 'heads', side: 'tails' })).toBe('Critical failure');
  });

  test('a landing never reveals the ruling: for each call, the messages a ruling can send are the messages a true flip can send', () => {
    for (const call of SIDES) {
      const coin = { ...fields(), call };
      const sent = (rulings: readonly ('right' | 'wrong' | 'coin')[]): string[] =>
        [...new Set(rulings.flatMap(r => SIDES.map(flip => JSON.stringify(landingOf(coin, r, flip)))))].sort();
      const ruled = sent(['right', 'wrong']), flipped = sent(['coin']);
      expect(ruled).toEqual(flipped);
      expect(flipped).toEqual([JSON.stringify({ roll: coin.id, side: 'heads' }), JSON.stringify({ roll: coin.id, side: 'tails' })]);
    }
  });

  test('a landing holds the roll and the side and no other field, whatever the ruling', () => {
    for (const r of RULINGS) expect(Object.keys(landingOf({ ...fields(), call: 'heads' }, r, 'tails')).sort()).toEqual(['roll', 'side']);
  });
});

describe('a phone\'s coins', () => {
  const a = coinIn('uncalled'), b: Coin = { ...fields(), id: rollId('d-asha:r13')!, at: 'uncalled' };

  test('a coin of a roll already held is not added again, and the rest keep their order', () => {
    const one = addCoin([], a), two = addCoin(one, b);
    expect(addCoin(two, { ...a, who: 'Someone else' })).toBe(two);
    expect(two.map(c => c.id)).toEqual([a.id, b.id]);
  });

  test(`a phone keeps its newest ${COINS_MAX} coins`, () => {
    let list: readonly Coin[] = [];
    for (let i = 0; i < COINS_MAX + 5; i++) list = addCoin(list, { ...a, id: rollId(`d-asha:r${i}`)! });
    expect(list).toHaveLength(COINS_MAX);
    expect(list[0]!.id).toBe(rollId('d-asha:r5')!);
  });

  test('a replayed call or landing leaves the list as it is', () => {
    const called = stepCoin([a, b], a.id, { type: 'call', side: 'tails' });
    expect(stepCoin(called, a.id, { type: 'call', side: 'heads' })).toBe(called);
    const landed = stepCoin(called, a.id, { type: 'land', side: 'heads' });
    expect(stepCoin(landed, a.id, { type: 'land', side: 'tails' })).toBe(landed);
    expect(landed[0]).toEqual({ ...fields(), at: 'landed', call: 'tails', side: 'heads' });
    expect(stepCoin(landed, rollId('d-other:r1')!, { type: 'land', side: 'tails' })).toBe(landed);
  });

  test('the GM\'s phone holds a call once: a replayed call, even with the other side, changes nothing', () => {
    const once = takeCall([], { ...fields(), call: 'tails' });
    expect(once).toEqual([{ ...fields(), at: 'called', call: 'tails' }]);
    expect(takeCall(once, { ...fields(), call: 'tails' })).toBe(once);
    expect(takeCall(once, { ...fields(), call: 'heads' })).toBe(once);
    const landed = stepCoin(once, a.id, { type: 'land', side: 'heads' });
    expect(takeCall(landed, { ...fields(), call: 'tails' })).toBe(landed);
    expect(coinOf(landed, a.id)).toEqual({ ...fields(), at: 'landed', call: 'tails', side: 'heads' });
    expect(coinOf(landed, b.id)).toBeNull();
  });

  test('a coin keeps the hunter who rolled through its life: the GM\'s call holds the caller\'s sheet key, a player\'s coin its hunter id', () => {
    const caller = { kind: 'remote', remote: parseSheetKey('d-asha:h1')! } as const;
    const held = takeCall([], { ...fields(), hunter: caller, call: 'tails' });
    expect(held[0]!.hunter).toEqual(caller);
    expect(stepCoin(held, a.id, { type: 'land', side: 'heads' })[0]!.hunter).toEqual(caller);
    expect(transition(coinIn('called'), { type: 'land', side: 'heads' }).hunter).toEqual(fields().hunter);
  });

  test('the coins in the air are the ones not landed, oldest first', () => {
    const list = [coinIn('landed'), { ...b, at: 'called', call: 'heads' } as Coin, { ...a, id: rollId('d-asha:r14')! }];
    expect(inAir(list).map(c => c.id)).toEqual([b.id, rollId('d-asha:r14')!]);
  });
});

describe('a stored coin', () => {
  test('a coin in each state reads back as it was', () => {
    for (const s of COIN_STATES) expect(parseCoin(JSON.parse(JSON.stringify(coinIn(s))))).toEqual(coinIn(s));
  });

  test('a coin without a roll id, with a face other than 1 or 20, or with a call or side that is not one is dropped', () => {
    expect(parseCoin({ ...coinIn('called'), id: '' })).toBeNull();
    expect(parseCoin({ ...coinIn('called'), id: 'has space' })).toBeNull();
    expect(parseCoin({ ...coinIn('called'), id: 'x'.repeat(81) })).toBeNull();
    expect(parseCoin({ ...coinIn('called'), face: 19 })).toBeNull();
    expect(parseCoin({ ...coinIn('called'), call: 'edge' })).toBeNull();
    expect(parseCoin({ ...coinIn('landed'), side: undefined })).toBeNull();
    expect(parseCoin({ ...coinIn('called'), at: 'spinning' })).toBeNull();
  });

  test('a long name or label is cut to 60 characters', () => {
    expect(parseCoin({ ...coinIn('uncalled'), who: 'a'.repeat(90), what: 'b'.repeat(90) })).toEqual({ ...coinIn('uncalled'), who: 'a'.repeat(60), what: 'b'.repeat(60) });
  });

  test('a stored list drops what is not a coin and keeps a roll once', () => {
    expect(parseCoins([coinIn('called'), 7, null, { ...coinIn('landed') }])).toEqual([coinIn('called')]);
    expect(parseCoins('junk')).toEqual([]);
  });

  test('the roll id of a phone\'s roll is its device id and the roll log id', () => {
    expect(newRollId('d-asha', 'r12')).toBe(rollId('d-asha:r12')!);
    expect(newRollId('d asha', 'r12')).toBeNull();
  });
});

describe('the save\'s coins and calls (the steps coin.js applies)', () => {
  const stamp = { at: '2026-11-14T10:00:00.000Z', cap: 200 };
  const empty = () => ({ coins: [] as readonly Coin[], calls: [] as readonly Coin[], log: [] as LogEntry[], seq: 10, hunters: [{ ...newHunter(), id: hid('h1') }] as Hunter[] });
  const id = fields().id, uncalled = coinIn('uncalled');
  test('a roll that calls the coin adds it uncalled, once per roll', () => {
    const one = coinRolled(empty(), uncalled);
    expect(one.coins).toEqual([uncalled]);
    expect(coinRolled(one, uncalled).coins).toHaveLength(1);
  });
  test('alone, a call lands on the flip in the same step and the landing is logged', () => {
    const s = coinCalled(coinRolled(empty(), uncalled), id, 'heads', 'tails', stamp);
    if (isRefused(s)) throw new Error(s.why);
    expect(coinOf(s.coins, id)).toMatchObject({ at: 'landed', call: 'heads', side: 'tails' });
    expect(s.log[0]!.title).toBe(`Coin: ${fields().who} called Heads`);
    // heads called, tails landed: the hunter's chronicle holds a coin called wrong
    expect(s.hunters[0]!.chronicle.inbox).toEqual([{ kind: 'coin', won: false }]);
  });
  test('in a room, a call waits for the GM; the landing then lands it and logs it; a second landing is refused', () => {
    const called = coinCalled(coinRolled(empty(), uncalled), id, 'heads', null, stamp);
    if (isRefused(called)) throw new Error(called.why);
    expect(coinOf(called.coins, id)!.at).toBe('called');
    expect(called.log).toEqual([]);
    const landed = coinLanded(called, id, 'heads', stamp);
    if (isRefused(landed)) throw new Error(landed.why);
    expect(coinOf(landed.coins, id)).toMatchObject({ at: 'landed', side: 'heads' });
    expect(landed.log).toHaveLength(1);
    expect(called.hunters[0]!.chronicle.inbox).toEqual([]);
    expect(landed.hunters[0]!.chronicle.inbox).toEqual([{ kind: 'coin', won: true }]);
    expect(coinLanded(landed, id, 'tails', stamp)).toEqual({ ok: false, why: 'not-now' });
  });
  test('the GM holds a call once, rules it, and the ruling is logged with the side', () => {
    const call = { ...fields(), call: 'tails' as const };
    const held = callTaken(empty(), call);
    if (isRefused(held)) throw new Error(held.why);
    expect(callTaken(held, call)).toEqual({ ok: false, why: 'not-now' });
    const ruled = callRuled(held, id, 'right', 'tails', stamp);
    if (isRefused(ruled)) throw new Error(ruled.why);
    expect(coinOf(ruled.calls, id)).toMatchObject({ at: 'landed', side: 'tails' });
    expect(ruled.log[0]!.text).toBe(`Natural ${fields().face} for ${fields().what}. Ruled Right: the coin landed Tails.`);
    expect(callRuled(ruled, id, 'wrong', 'heads', stamp)).toEqual({ ok: false, why: 'not-now' });
  });
  test('a step on a roll nobody holds is refused', () => {
    expect(coinLanded(empty(), id, 'heads', stamp)).toEqual({ ok: false, why: 'missing' });
  });
});


describe('the GM\'s window for the calls (SMX-views-7)', () => {
  const A = CALL_A, B = CALL_B;
  const idle: CoinPrompt = COIN_PROMPT_IDLE;
  const asking = (id: typeof A, later: (typeof A)[] = []): CoinPrompt => ({ at: 'asking', id, later });
  const deferred = (first: typeof A, ...rest: (typeof A)[]): CoinPrompt => ({ at: 'deferred', ids: [first, ...rest] });
  const seen = (...open: (typeof A)[]): CoinPromptEvent => ({ type: 'seen', open });
  const ruled: CoinPromptEvent = { type: 'ruled' }, putOff: CoinPromptEvent = { type: 'putOff' };
  const reopen = (id: typeof A): CoinPromptEvent => ({ type: 'reopen', id });
  const name = (p: CoinPrompt): string => (p.at === 'idle' ? 'idle' : p.at === 'asking' ? `asking ${p.id} (later ${p.later.join(' ') || 'none'})` : `put off ${p.ids.join(' ')}`);
  const eventName = (e: CoinPromptEvent): string => (e.type === 'seen' ? `seen [${e.open.join(' ')}]` : e.type === 'reopen' ? `reopen ${e.id}` : e.type);

  // Every state against every event: the prompt it leads to, or 'no change'. A is the older call, B the newer.
  const rows: [CoinPrompt, CoinPromptEvent, CoinPrompt | 'no change'][] = [
    [idle, seen(), 'no change'],
    [idle, seen(A), asking(A)],
    [idle, seen(B), asking(B)],
    [idle, seen(A, B), asking(A)],
    [idle, ruled, 'no change'],
    [idle, putOff, 'no change'],
    [idle, reopen(A), 'no change'],
    [idle, reopen(B), 'no change'],

    // the window stays on screen whatever the save does; a newer call waits its turn
    [asking(A), seen(), 'no change'],
    [asking(A), seen(A), 'no change'],
    [asking(A), seen(B), 'no change'],
    [asking(A), seen(A, B), 'no change'],
    [asking(A), ruled, idle],
    [asking(A), putOff, deferred(A)],
    [asking(A), reopen(A), 'no change'],
    [asking(A), reopen(B), 'no change'],

    [asking(A, [B]), seen(), asking(A)],
    [asking(A, [B]), seen(A), asking(A)],
    [asking(A, [B]), seen(B), 'no change'],
    [asking(A, [B]), seen(A, B), 'no change'],
    [asking(A, [B]), ruled, deferred(B)],
    [asking(A, [B]), putOff, deferred(B, A)],
    [asking(A, [B]), reopen(A), 'no change'],
    [asking(A, [B]), reopen(B), 'no change'],

    // a call put off is not asked again by a change; a newer call is
    [deferred(A), seen(), idle],
    [deferred(A), seen(A), 'no change'],
    [deferred(A), seen(B), asking(B)],
    [deferred(A), seen(A, B), asking(B, [A])],
    [deferred(A), ruled, 'no change'],
    [deferred(A), putOff, 'no change'],
    [deferred(A), reopen(A), asking(A)],
    [deferred(A), reopen(B), 'no change'],

    [deferred(A, B), seen(), idle],
    [deferred(A, B), seen(A), deferred(A)],
    [deferred(A, B), seen(B), deferred(B)],
    [deferred(A, B), seen(A, B), 'no change'],
    [deferred(A, B), ruled, 'no change'],
    [deferred(A, B), putOff, 'no change'],
    [deferred(A, B), reopen(A), asking(A, [B])],
    [deferred(A, B), reopen(B), asking(B, [A])],
  ];
  for (const [from, event, to] of rows) {
    test(`${name(from)} + ${eventName(event)}: ${to === 'no change' ? to : name(to)}`, () => {
      const after = coinPromptStep(from, event);
      if (to === 'no change') expect(after).toBe(from);
      else expect(after).toEqual(to);
    });
  }

  test('every state and event pair has a row above', () => {
    const covered = new Set(rows.map(([from, e]) => `${from.at} ${e.type}`));
    expect(COIN_PROMPT_STATES.flatMap(s => COIN_PROMPT_EVENTS.map(t => `${s} ${t}`)).filter(k => !covered.has(k))).toEqual([]);
  });

  test('a GM who closes the window is not asked that call again, however often the save changes, until they tap it', () => {
    let p = coinPromptStep(idle, seen(A));
    expect(p).toEqual(asking(A));
    p = coinPromptStep(p, putOff);
    for (let i = 0; i < 5; i++) p = coinPromptStep(p, seen(A));
    expect(p).toEqual(deferred(A));
    expect(coinPromptPutOff(p)).toEqual([A]);
    p = coinPromptStep(p, reopen(A));
    expect(p).toEqual(asking(A));
    p = coinPromptStep(coinPromptStep(p, seen()), ruled);
    expect(p).toEqual(idle);
  });

  test('a call that arrives while another is put off opens its own window, and the put-off one stays offered', () => {
    const p = coinPromptStep(deferred(A), seen(A, B));
    expect(p).toEqual(asking(B, [A]));
    expect(coinPromptPutOff(p)).toEqual([A]);
    expect(coinPromptStep(p, ruled)).toEqual(deferred(A));
  });

  test('the calls offered as put off are those of the prompt, in the order the GM put them off', () => {
    expect(coinPromptPutOff(idle)).toEqual([]);
    expect(coinPromptPutOff(asking(A, [B]))).toEqual([B]);
    expect(coinPromptPutOff(coinPromptStep(asking(A, [B]), putOff))).toEqual([B, A]);
  });

  test('a step never changes the prompt it was given', () => {
    for (const [from] of rows) {
      const copy = JSON.parse(JSON.stringify(from));
      for (const e of PROMPT_WALK) coinPromptStep(from, e);
      expect(from).toEqual(copy);
    }
  });
});
