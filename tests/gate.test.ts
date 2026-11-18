import { describe, expect, test } from 'bun:test';
import { GATE_STATUSES, GATE_TYPES, SPAWN_TYPES, can, countdown, fightAward, gateXp, parseGate, transition, xpDue } from '../src/core/gates/gate.ts';
import type { Gate, GateEvent, GateEventType, GateStatus, MonsterId } from '../src/core/gates/gate.ts';
import { WALK_EVENTS, den, fields, mid } from './models/gate-events.ts';

/** The bestiary for these tests: a goblin is worth 25 XP, the hobgoblin boss 75. Anything else is unknown and worth 0. */
const XP: Record<string, number> = { 'm-goblin': 25, 'm-hob': 75 };
const xpOf = (id: MonsterId): number => XP[id] ?? 0;

/** The den of tests/models/gate-events.ts: 3 x 25 + 75 = 150 XP. It breaks on day 5. */
const DEN_XP = 150;
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('the life of a gate', () => {
  // Every status and event pair: the status it leads to, or 'no change' when the event does not apply there (or applies
  // and changes nothing, such as a day before the break day). `fightStarted` in raiding or broken keeps the status.
  const day3: GateEvent = { type: 'dayAdvanced', day: 3 }, day5: GateEvent = { type: 'dayAdvanced', day: 5 };
  const rows: [GateStatus, string, GateEvent, GateStatus | 'no change'][] = [
    ['detected', 'enter', { type: 'enter' }, 'raiding'],
    ['detected', 'fightStarted', { type: 'fightStarted' }, 'raiding'],
    ['detected', 'dayAdvanced to day 3, before the break day', day3, 'no change'],
    ['detected', 'dayAdvanced to day 5, the break day', day5, 'broken'],
    ['detected', 'clear', { type: 'clear', day: 4 }, 'cleared'],
    ['detected', 'close', { type: 'close' }, 'closed'],
    ['raiding', 'enter', { type: 'enter' }, 'no change'],
    ['raiding', 'fightStarted', { type: 'fightStarted' }, 'no change'],
    ['raiding', 'dayAdvanced to day 3, before the break day', day3, 'no change'],
    ['raiding', 'dayAdvanced to day 5, the break day', day5, 'broken'],
    ['raiding', 'clear', { type: 'clear', day: 4 }, 'cleared'],
    ['raiding', 'close', { type: 'close' }, 'closed'],
    ['broken', 'enter', { type: 'enter' }, 'no change'],
    ['broken', 'fightStarted', { type: 'fightStarted' }, 'no change'],
    ['broken', 'dayAdvanced', { type: 'dayAdvanced', day: 9 }, 'no change'],
    ['broken', 'clear', { type: 'clear', day: 4 }, 'cleared'],
    ['broken', 'close', { type: 'close' }, 'closed'],
    ['cleared', 'enter', { type: 'enter' }, 'no change'],
    ['cleared', 'fightStarted', { type: 'fightStarted' }, 'no change'],
    ['cleared', 'dayAdvanced', { type: 'dayAdvanced', day: 9 }, 'no change'],
    ['cleared', 'clear', { type: 'clear', day: 4 }, 'no change'],
    ['cleared', 'close', { type: 'close' }, 'no change'],
    ['closed', 'enter', { type: 'enter' }, 'no change'],
    ['closed', 'fightStarted', { type: 'fightStarted' }, 'no change'],
    ['closed', 'dayAdvanced', { type: 'dayAdvanced', day: 9 }, 'no change'],
    ['closed', 'clear', { type: 'clear', day: 4 }, 'no change'],
    ['closed', 'close', { type: 'close' }, 'no change'],
    ...GATE_STATUSES.flatMap((from): [GateStatus, string, GateEvent, GateStatus | 'no change'][] => [
      ...GATE_STATUSES.map((to): [GateStatus, string, GateEvent, GateStatus | 'no change'] =>
        [from, `gmSet ${to}`, { type: 'gmSet', status: to, day: 4 }, to === from ? 'no change' : to]),
      [from, 'paid', { type: 'paid', xp: 30 }, 'no change'],
    ]),
  ];

  for (const [from, label, event, to] of rows) {
    test(`${from} + ${label}: ${to}`, () => {
      const before = den(from), after = transition(before, event);
      expect(after.status).toBe(to === 'no change' ? from : to);
      if (to === 'no change' && event.type !== 'paid') expect(after).toBe(before);
    });
  }

  test('every status and event pair has a row above', () => {
    const types: GateEventType[] = ['enter', 'fightStarted', 'dayAdvanced', 'clear', 'close', 'gmSet', 'paid'];
    const covered = new Set(rows.map(([from, , e]) => `${from} ${e.type}`));
    expect(GATE_STATUSES.flatMap(s => types.map(t => `${s} ${t}`)).filter(k => !covered.has(k))).toEqual([]);
  });

  test('clearing stamps the day it happened and changes nothing else', () => {
    expect(transition(den('raiding'), { type: 'clear', day: 4 })).toEqual({ ...fields(), status: 'cleared', clearedDay: 4 });
  });

  test('the GM setting cleared stamps that day, and setting cleared on a cleared gate keeps its day', () => {
    expect(transition(den('detected'), { type: 'gmSet', status: 'cleared', day: 4 })).toEqual({ ...fields(), status: 'cleared', clearedDay: 4 });
    expect(transition(den('cleared'), { type: 'gmSet', status: 'cleared', day: 4 })).toEqual(den('cleared'));
  });

  test('the GM moving a cleared gate to any other status drops its cleared day', () => {
    for (const status of GATE_STATUSES.filter(s => s !== 'cleared')) {
      const after = transition(den('cleared'), { type: 'gmSet', status, day: 4 });
      expect(after).toEqual({ ...fields(), status });
      expect('clearedDay' in after).toBe(false);
    }
  });

  test('a gate cleared, set back to detected and set cleared again carries the second day', () => {
    const once = transition(den('detected'), { type: 'gmSet', status: 'cleared', day: 1 });
    const back = transition(once, { type: 'gmSet', status: 'detected', day: 1 });
    expect(transition(back, { type: 'gmSet', status: 'cleared', day: 3 })).toMatchObject({ status: 'cleared', clearedDay: 3 });
  });

  test('a payment adds to what the gate has paid, in every status, and a negative or broken one adds nothing', () => {
    for (const status of GATE_STATUSES) {
      expect(transition(den(status, 40), { type: 'paid', xp: 30 }).xpPaid).toBe(70);
      expect(transition(den(status, 40), { type: 'paid', xp: -30 }).xpPaid).toBe(40);
      expect(transition(den(status, 40), { type: 'paid', xp: Number.NaN }).xpPaid).toBe(40);
    }
  });

  test('transition never changes the gate it is given', () => {
    const before = den('detected'), snapshot = copy(before);
    transition(before, { type: 'clear', day: 4 });
    transition(before, { type: 'paid', xp: 30 });
    expect(before).toEqual(snapshot);
  });
});

describe('what the GM may do to a gate', () => {
  // The buttons on a gate card: Enter on a detected gate; Start fight, Clear and Close on a gate still active
  // (detected, raiding or broken); Edit (gmSet) on every gate. A day passing breaks a detected or raiding gate.
  const accepts: Record<GateStatus, GateEventType[]> = {
    detected: ['enter', 'fightStarted', 'dayAdvanced', 'clear', 'close', 'gmSet', 'paid'],
    raiding: ['fightStarted', 'dayAdvanced', 'clear', 'close', 'gmSet', 'paid'],
    broken: ['fightStarted', 'clear', 'close', 'gmSet', 'paid'],
    cleared: ['gmSet', 'paid'],
    closed: ['gmSet', 'paid'],
  };
  for (const status of GATE_STATUSES) {
    test(`a ${status} gate accepts ${accepts[status].join(', ')}`, () => {
      const types: GateEventType[] = ['enter', 'fightStarted', 'dayAdvanced', 'clear', 'close', 'gmSet', 'paid'];
      expect(types.filter(t => can(den(status), t))).toEqual(accepts[status]);
    });
  }

  test('can reads only the status, so a player phone can ask it of a gate from the shared world', () => {
    expect(can({ status: 'broken' }, 'clear')).toBe(true);
    expect(can({ status: 'closed' }, 'clear')).toBe(false);
  });
});

describe('the gate XP', () => {
  test('a gate is worth its monsters times their counts plus its boss', () => {
    expect(gateXp(den('detected'), xpOf)).toBe(DEN_XP);
    // A monster the bestiary no longer has is worth 0: 2 x 0 + 75.
    expect(gateXp({ ...den('detected'), monsters: [{ monsterId: mid('m-gone'), count: 2 }] }, xpOf)).toBe(75);
    // No boss: 3 x 25.
    expect(gateXp({ ...den('detected'), bossId: null }, xpOf)).toBe(75);
  });

  test('what a gate still owes is its XP less what it paid, and never below 0', () => {
    expect(xpDue(den('raiding'), xpOf)).toBe(150);
    expect(xpDue(den('raiding', 125), xpOf)).toBe(25);
    expect(xpDue(den('raiding', 150), xpOf)).toBe(0);
    expect(xpDue(den('raiding', 400), xpOf)).toBe(0);
  });

  test('a fight with no gate pays its own XP', () => {
    expect(fightAward(null, 90, xpOf)).toBe(90);
  });

  test('a fight in a gate that still owes anything pays its whole XP, and nothing once the gate owes nothing', () => {
    expect(fightAward(den('raiding'), 125, xpOf)).toBe(125);
    // The gate owes 150 - 140 = 10, still something, so the fight pays its own 125.
    expect(fightAward(den('raiding', 140), 125, xpOf)).toBe(125);
    expect(fightAward(den('raiding', 150), 125, xpOf)).toBe(0);
  });

  test('a gate cleared or set cleared with nobody paid still owes its XP, so its fight pays', () => {
    const clearedUnpaid = transition(den('raiding'), { type: 'clear', day: 4 });
    expect(fightAward(clearedUnpaid, 125, xpOf)).toBe(125);
    const setCleared = transition(den('raiding'), { type: 'gmSet', status: 'cleared', day: 4 });
    expect(fightAward(setCleared, 125, xpOf)).toBe(125);
  });

  test('a fight paid first leaves the Clear the rest, and a Clear paid first leaves the fight nothing', () => {
    const fought = transition(den('raiding'), { type: 'paid', xp: fightAward(den('raiding'), 125, xpOf) });
    expect(xpDue(fought, xpOf)).toBe(150 - 125);
    const cleared = transition(transition(den('raiding'), { type: 'clear', day: 4 }), { type: 'paid', xp: xpDue(den('raiding'), xpOf) });
    expect(fightAward(cleared, 125, xpOf)).toBe(0);
  });
});

describe('reading a stored gate', () => {
  test('a gate in each status comes back exactly as it was stored', () => {
    for (const status of GATE_STATUSES) expect(parseGate(copy(den(status, 40)))).toEqual(den(status, 40));
  });

  test('who fought it is kept, each a hunter id or a sheet key; anything else is dropped, and a gate without it fought nobody', () => {
    expect(parseGate({ ...copy(den('detected')), fought: ['h1', 'd-p1:h1', 3, '', 'x'.repeat(81)] })!.fought).toEqual(['h1', 'd-p1:h1']);
    expect(parseGate({ ...copy(den('detected')), fought: 'h1' })!.fought).toEqual([]);
    const { fought: _, ...old } = copy(den('detected'));
    expect(parseGate(old)!.fought).toEqual([]);
  });

  test('things that are not a gate are null', () => {
    for (const v of [null, undefined, 3, 'gate', [], {}, { id: '' }, { id: 7 }, { id: 'x'.repeat(81) }]) expect(parseGate(v)).toBeNull();
  });

  test('a cleared gate without a day takes the day it was created, and another status drops a stored day', () => {
    expect(parseGate({ ...fields(), createdDay: 6, status: 'cleared', clearedDay: 'today' })).toMatchObject({ status: 'cleared', clearedDay: 6 });
    const detected = parseGate({ ...fields(), status: 'detected', clearedDay: 3 });
    expect(detected).toEqual(den('detected'));
    expect(detected && 'clearedDay' in detected).toBe(false);
  });

  test('hostile values come out bounded, and keys the gate does not have are dropped', () => {
    const g = parseGate({ id: 'g1', name: 'N'.repeat(500), rank: 'SSS', type: 'blue', status: 'open', breakDay: -4, createdDay: 'x', xpPaid: -50,
      notes: 'n'.repeat(5000), bossId: 4, mood: 'grim', clearedDay: 2,
      monsters: [{ monsterId: 'm1', count: 0 }, { monsterId: 'm2', count: 1e9 }, { monsterId: 'm3', count: 2.7, extra: 1 }, { count: 2 }, 5, null,
        ...Array.from({ length: 80 }, (_, i) => ({ monsterId: `x${i}`, count: 1 }))] });
    if (!g) throw new Error('expected a gate');
    expect(g.name).toHaveLength(60);
    expect(g.notes).toHaveLength(500);
    expect([g.rank, g.type, g.status, g.breakDay, g.createdDay, g.xpPaid, g.bossId]).toEqual(['E', 'normal', 'detected', 0, 1, 0, null]);
    expect(Object.keys(g).sort()).toEqual(Object.keys(den('detected')).sort());
    expect(g.monsters.slice(0, 3)).toEqual([{ monsterId: 'm1', count: 1 }, { monsterId: 'm2', count: 999 }, { monsterId: 'm3', count: 2 }]);
    expect(g.monsters).toHaveLength(50);
  });

  test('__proto__ keys in a stored gate change no prototype', () => {
    const g = parseGate(JSON.parse('{"id":"g1","__proto__":{"status":"cleared","polluted":true},"monsters":[{"monsterId":"m1","__proto__":{"count":9}}]}'));
    expect(g).toMatchObject({ status: 'detected', monsters: [{ monsterId: 'm1', count: 1 }] });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('every short life of a gate', () => {
  // From every status, every sequence of up to 4 of these events: 13 events, so 5 x (1 + 13 + 13^2 + 13^3 + 13^4) gates.
  const events = WALK_EVENTS;

  test('leave a gate the parser accepts as it is, that has never paid less, and with a cleared day only when cleared', () => {
    let seen = 0;
    const problems: string[] = [];
    const walk = (g: Gate, path: string[], depth: number): void => {
      seen++;
      if (JSON.stringify(parseGate(copy(g))) !== JSON.stringify(g)) problems.push(`not read back: ${path.join(' > ')}`);
      if (('clearedDay' in g) !== (g.status === 'cleared')) problems.push(`cleared day on ${g.status}: ${path.join(' > ')}`);
      if (depth === 4) return;
      for (const e of events) {
        const next = transition(g, e);
        if (next.xpPaid < g.xpPaid) problems.push(`paid went down: ${path.join(' > ')} > ${e.type}`);
        walk(next, [...path, e.type === 'gmSet' ? `gmSet ${e.status}` : e.type], depth + 1);
      }
    };
    for (const status of GATE_STATUSES) walk(den(status, 10), [status], 0);
    expect(problems.slice(0, 5)).toEqual([]);
    expect(seen).toBe(5 * (1 + 13 + 13 ** 2 + 13 ** 3 + 13 ** 4));
  });
});

describe('the Gate type', () => {
  test('only a cleared gate has a cleared day, and a cleared gate must have one', () => {
    const base = fields();
    // @ts-expect-error a detected gate has no clearedDay
    const detected: Gate = { ...base, status: 'detected', clearedDay: 3 };
    // @ts-expect-error a cleared gate needs its clearedDay
    const cleared: Gate = { ...base, status: 'cleared' };
    expect([detected.status, cleared.status]).toEqual(['detected', 'cleared']);
  });
});

describe('a gate\'s countdown, one rule for the GM and a player (implicit audit 3, G2)', () => {
  const at = (status: GateStatus, breakDay: number) => ({ ...den(status), breakDay, ...(status === 'cleared' ? { clearedDay: 4 } : {}) }) as Gate;
  test('an open gate breaks in n days, soon within 2, over on its day; a cleared, closed or broken one says so whatever its day', () => {
    const rows = ([['detected', 9], ['raiding', 7], ['detected', 5], ['cleared', 5], ['closed', 5], ['broken', 5]] as const).map(([s, b]) => countdown(at(s, b), 5));
    expect(rows).toEqual([
      { words: 'Breaks in 4 days', tone: null }, { words: 'Breaks in 2 days', tone: 'soon' }, { words: 'Breaks today', tone: 'over' },
      { words: 'Cleared on day 4', tone: null }, { words: 'Gate closed', tone: null }, { words: 'Broke on day 5. Monsters are loose', tone: 'over' },
    ]);
  });
  test('a spawn gives a gate any type but break, which comes from a story', () => {
    expect(SPAWN_TYPES).toEqual(GATE_TYPES.filter(t => t !== 'break'));
  });
});
