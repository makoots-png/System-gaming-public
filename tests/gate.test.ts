import { describe, expect, test } from 'bun:test';
import { GATE_STATUSES, GATE_TYPES, SPAWN_TYPES, activeGateWave, can, countdown, fightAward, gateXp, hasGateWaves, hasWaveFoes, npcDeleteConfirmBody, parseGate, shownOf, transition, waveRoster, xpDue } from '../src/core/gates/gate.ts';
import { DEFAULT_DIFFICULTY, withDifficulty } from '../src/core/gates/difficulty.ts';
import type { Gate, GateEvent, GateEventType, GateStatus, MonsterId, NpcId } from '../src/core/gates/gate.ts';
import { worldDoc } from '../src/core/gates/world.ts';
import { soloDoc, soloFight, soloReady, soloTargets } from '../src/core/gates/solo.ts';
import { DOCS, DOC_MAX } from '../src/core/protocol.ts';
import { gateFoeScale } from '../src/core/gates/party-scale.ts';
import { newNpc, npcSheet, npcTierPreset, npcXp } from '../src/core/registry/npcs.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import { RULES } from '../src/core/rules.ts';
import { newHunter, newSave } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import { seedId } from '../src/core/ids.ts';
import { WALK_EVENTS, den, fields, mid } from './models/gate-events.ts';
import { dev } from './fixtures/ids.ts';

const nid = (s: string): NpcId => s as NpcId;

/** The bestiary for these tests: a goblin is worth 25 XP, the hobgoblin boss 75. Anything else is unknown and worth 0. */
const XP: Record<string, number> = { 'm-goblin': 25, 'm-hob': 75 };
const xpOf = (id: MonsterId | NpcId): number => XP[id] ?? 0;

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

  test('old saves without difficulty migrate to DEFAULT_DIFFICULTY, corrupted difficulty falls back cleanly, and shownOf hides difficulty', () => {
    const { difficulty: _gone, ...old } = copy(den('detected'));
    expect(parseGate(old)!.difficulty).toEqual(DEFAULT_DIFFICULTY);
    expect(parseGate({ ...old, difficulty: { gate: { at: 'set', level: 8 }, boss: { at: 'own', level: 99 } } })!.difficulty)
      .toEqual({ gate: { at: 'set', level: 8 }, boss: { at: 'follows' } });
    const hard = withDifficulty(den('detected'), [{ type: 'setGate', level: 9 }, { type: 'setBoss', level: 10 }]);
    const shown = shownOf(hard, 60);
    expect('difficulty' in shown).toBe(false);
  });

  test('parseGate round-trips wave tags and bossFell, drops invalid wave values, and shownOf strips bossFell', () => {
    const wavy: Gate = {
      ...den('raiding'),
      monsters: [
        { monsterId: mid('m-goblin'), count: 3, wave: 1 },
        { monsterId: mid('m-usher'), count: 2, wave: 2 },
        { monsterId: mid('m-rat'), count: 1 },
      ],
      bossId: mid('m-head-usher'),
      bossFell: true,
    };
    const parsed = parseGate(copy(wavy));
    expect(parsed).toEqual(wavy);
    expect('wave' in parsed!.monsters[2]!).toBe(false);
    expect('bossFell' in shownOf(parsed!, 60)).toBe(false);

    const messy = parseGate({
      ...copy(den('detected')),
      bossFell: 'yes',
      monsters: [
        { monsterId: 'm1', count: 2, wave: 1 },
        { monsterId: 'm2', count: 1, wave: 2 },
        { monsterId: 'm3', count: 1, wave: 3 },
        { monsterId: 'm4', count: 1, wave: '1' },
      ],
    })!;
    expect(messy.bossFell).toBe(false);
    expect(messy.monsters).toEqual([
      { monsterId: mid('m1'), count: 2, wave: 1 },
      { monsterId: mid('m2'), count: 1, wave: 2 },
      { monsterId: mid('m3'), count: 1 },
      { monsterId: mid('m4'), count: 1 },
    ]);

    // transition preserves bossFell across status changes
    expect(transition(wavy, { type: 'clear', day: 4 }).bossFell).toBe(true);
    expect(transition(wavy, { type: 'gmSet', status: 'detected', day: 4 }).bossFell).toBe(true);
  });
});

describe('multi-wave gate rosters and active wave selection', () => {
  const twoWave = (): Gate => ({
    ...den('detected'),
    monsters: [
      { monsterId: mid('m-goblin'), count: 3, wave: 1 },
      { monsterId: mid('m-chief'), count: 1, wave: 1 },
      { monsterId: mid('m-usher'), count: 2, wave: 2 },
    ],
    bossId: mid('m-head-usher'),
  });

  test('gates without wave tags report hasGateWaves false and activeGateWave all', () => {
    const g = den('detected');
    expect(hasGateWaves(g)).toBe(false);
    expect(activeGateWave(g)).toBe('all');
    expect(waveRoster(g, 'all')).toEqual({ monsters: g.monsters, bossId: g.bossId, npcs: [] });
  });

  test('wave-tagged gates separate Wave 1 (no boss) from Wave 2 (with boss) and switch active wave once Wave 1 settles', () => {
    const g = twoWave();
    expect(hasGateWaves(g)).toBe(true);
    expect(waveRoster(g, 1)).toEqual({
      monsters: [{ monsterId: mid('m-goblin'), count: 3, wave: 1 }, { monsterId: mid('m-chief'), count: 1, wave: 1 }],
      bossId: null,
      npcs: [],
    });
    expect(waveRoster(g, 2)).toEqual({
      monsters: [{ monsterId: mid('m-usher'), count: 2, wave: 2 }],
      bossId: mid('m-head-usher'),
      npcs: [],
    });
    expect(activeGateWave(g)).toBe(1);
    expect(activeGateWave({ ...g, fought: ['h1'] })).toBe(2);
    expect(activeGateWave({ ...g, xpPaid: 50 })).toBe(2);
    expect(activeGateWave({ ...g, bossFell: true })).toBe(2);
  });
});

describe('gate NPC placements (parse, waves, XP, secrecy, solo exclusion)', () => {
  test('parseGate round-trips npcs, clamps counts, drops invalid ids and bad waves, and migrates old saves to []', () => {
    const { npcs: _old, ...withoutNpcs } = copy(den('detected'));
    expect(parseGate(withoutNpcs)!.npcs).toEqual([]);

    const withNpcs: Gate = {
      ...den('raiding'),
      npcs: [
        { npcId: nid('npc_1'), count: 1, side: 'party' },
        { npcId: nid('npc_2'), count: 2, side: 'foe', wave: 1 },
        { npcId: nid('npc_3'), count: 4, side: 'foe', wave: 2 },
      ],
    };
    const parsed = parseGate(copy(withNpcs))!;
    expect(parsed).toEqual(withNpcs);
    expect('wave' in parsed.npcs[0]!).toBe(false);
    expect(transition(withNpcs, { type: 'clear', day: 4 }).npcs).toEqual(withNpcs.npcs);
    expect(transition(withNpcs, { type: 'gmSet', status: 'detected', day: 4 }).npcs).toEqual(withNpcs.npcs);

    const hostile = parseGate({
      ...copy(den('detected')),
      npcs: [
        { npcId: 'npc_10', count: 0, side: 'bad', wave: 3 },
        { npcId: 'npc_11', count: 99, side: 'foe', wave: 2 },
        { npcId: 'm1', count: 1, side: 'foe' },
        { npcId: '', count: 1, side: 'party' },
        null,
        ...Array.from({ length: 60 }, (_, i) => ({ npcId: `npc_${100 + i}`, count: 1, side: 'party' })),
      ],
    })!;
    expect(hostile.npcs).toHaveLength(50);
    expect(hostile.npcs.slice(0, 2)).toEqual([
      { npcId: nid('npc_10'), count: 1, side: 'party' },
      { npcId: nid('npc_11'), count: 4, side: 'foe', wave: 2 },
    ]);
  });

  test('waveRoster places Wave 1 NPCs in wave 1, Wave 2 NPCs in wave 2, and untagged All-waves NPCs in both waves', () => {
    const allyAll = { npcId: nid('npc_1'), count: 1, side: 'party' as const };
    const foeW1 = { npcId: nid('npc_2'), count: 2, side: 'foe' as const, wave: 1 as const };
    const foeW2 = { npcId: nid('npc_3'), count: 1, side: 'foe' as const, wave: 2 as const };
    const g: Gate = {
      ...den('detected'),
      monsters: [{ monsterId: mid('m-goblin'), count: 2, wave: 1 }],
      bossId: mid('m-hob'),
      npcs: [allyAll, foeW1, foeW2],
    };
    expect(hasGateWaves(g)).toBe(true);
    expect(waveRoster(g, 1).npcs).toEqual([allyAll, foeW1]);
    expect(waveRoster(g, 2).npcs).toEqual([allyAll, foeW2]);
    expect(waveRoster(g, 'all').npcs).toEqual([allyAll, foeW1, foeW2]);

    // An NPC wave tag alone (with no wave-tagged monsters) still splits a gate into two waves when both hold foes.
    const npcWaved: Gate = {
      ...den('detected'),
      monsters: [],
      bossId: null,
      npcs: [foeW1, foeW2],
    };
    expect(hasGateWaves(npcWaved)).toBe(true);
    expect(waveRoster(npcWaved, 1).npcs).toEqual([foeW1]);
    expect(waveRoster(npcWaved, 2).npcs).toEqual([foeW2]);

    // A wave holding only ally NPCs has no foes and does not turn a gate into two waves.
    const allyOnlyWave1: Gate = {
      ...den('detected'),
      monsters: [{ monsterId: mid('m-goblin'), count: 2, wave: 2 }],
      bossId: mid('m-hob'),
      npcs: [allyAll],
    };
    expect(hasWaveFoes(waveRoster(allyOnlyWave1, 1))).toBe(false);
    expect(hasWaveFoes(waveRoster(allyOnlyWave1, 2))).toBe(true);
    expect(hasGateWaves(allyOnlyWave1)).toBe(false);
    expect(activeGateWave(allyOnlyWave1)).toBe('all');

    const allyOnlyGate: Gate = {
      ...den('detected'),
      monsters: [],
      bossId: null,
      npcs: [
        { npcId: nid('npc_1'), count: 1, side: 'party', wave: 1 },
        { npcId: nid('npc_2'), count: 1, side: 'party', wave: 2 },
      ],
    };
    expect(hasWaveFoes(waveRoster(allyOnlyGate, 'all'))).toBe(false);
    expect(hasGateWaves(allyOnlyGate)).toBe(false);
  });

  test('gateXp counts an untagged All-waves foe NPC once per wave on a two-wave gate so running both waves matches gateXp', () => {
    const foeAll = { ...newNpc({ name: 'Stalker', rank: 'E', ...npcTierPreset('elite'), defaultSide: 'foe' }), id: nid('npc_5') };
    const allyAll = { ...newNpc({ name: 'Mira', rank: 'E', defaultSide: 'party' }), id: nid('npc_6') };
    const npcTable = new Map([foeAll, allyAll].map(n => [n.id, n]));
    const mixedXp = (id: MonsterId | NpcId): number => (id in XP ? XP[id]! : (npcTable.get(id as NpcId) ? npcXp(npcTable.get(id as NpcId)!, RULES) : 0));
    const stalkerXp = npcXp(foeAll, RULES);

    const g: Gate = {
      ...den('raiding'),
      monsters: [
        { monsterId: mid('m-goblin'), count: 2, wave: 1 },
        { monsterId: mid('m-goblin'), count: 1, wave: 2 },
      ],
      bossId: mid('m-hob'),
      npcs: [
        { npcId: allyAll.id, count: 1, side: 'party' },
        { npcId: foeAll.id, count: 1, side: 'foe' },
      ],
    };
    expect(hasGateWaves(g)).toBe(true);
    const wave1Xp = 2 * 25 + stalkerXp;
    const wave2Xp = 1 * 25 + 75 + stalkerXp;
    expect(gateXp(g, mixedXp)).toBe(wave1Xp + wave2Xp);

    // Run Wave 1, then Wave 2: total xpPaid matches gateXp exactly and xpDue reaches 0.
    const afterW1 = transition(g, { type: 'paid', xp: fightAward(g, wave1Xp, mixedXp) });
    expect(xpDue(afterW1, mixedXp), 'Clear after Wave 1 owes exactly Wave 2 XP').toBe(wave2Xp);
    const afterW2 = transition(afterW1, { type: 'paid', xp: fightAward(afterW1, wave2Xp, mixedXp) });
    expect(afterW2.xpPaid).toBe(gateXp(g, mixedXp));
    expect(xpDue(afterW2, mixedXp)).toBe(0);
    expect(fightAward(afterW2, wave2Xp, mixedXp)).toBe(0);

    // On a single-fight gate (no waves), the same untagged foe NPC is counted once.
    const single: Gate = { ...den('raiding'), npcs: [{ npcId: foeAll.id, count: 1, side: 'foe' }] };
    expect(hasGateWaves(single)).toBe(false);
    expect(gateXp(single, mixedXp)).toBe(DEN_XP + stalkerXp);
  });

  test('npcDeleteConfirmBody names every gate whose roster holds the NPC', () => {
    const id = nid('npc_7');
    const g1 = { name: 'Goblin Den', npcs: [{ npcId: id, count: 1, side: 'party' as const }, { npcId: id, count: 2, side: 'foe' as const, wave: 2 as const }] };
    const g2 = { name: 'Frost Hollow', npcs: [{ npcId: id, count: 1, side: 'foe' as const }] };
    const g3 = { name: '', npcs: [{ npcId: id, count: 1, side: 'party' as const }] };
    const other = { name: 'Empty Gate', npcs: [{ npcId: nid('npc_8'), count: 1, side: 'party' as const }] };

    expect(npcDeleteConfirmBody(id, [other])).toBe('Remove this NPC from your library. You can still finish any fight that already uses it.');
    expect(npcDeleteConfirmBody(id, [g1, other])).toContain('This NPC is in this gate: Goblin Den.');
    expect(npcDeleteConfirmBody(id, [g1, g2, other])).toContain('This NPC is in these gates: Goblin Den and Frost Hollow.');
    expect(npcDeleteConfirmBody(id, [g1, g2, g3])).toContain('This NPC is in these gates: Goblin Den, Frost Hollow, and Unnamed gate.');
  });

  test('gateXp counts foe NPC tier XP (normal 1x, elite 1.5x, boss 3x) and ignores ally NPCs', () => {
    const ally = { ...newNpc({ name: 'Mira', rank: 'C', defaultSide: 'party' }), id: nid('npc_1') };
    const foeNormal = { ...newNpc({ name: 'Scout', rank: 'C', ...npcTierPreset('standard'), defaultSide: 'foe' }), id: nid('npc_2') };
    const foeElite = { ...newNpc({ name: 'Captain', rank: 'C', ...npcTierPreset('elite'), defaultSide: 'foe' }), id: nid('npc_3') };
    const foeBoss = { ...newNpc({ name: 'Warlord', rank: 'C', ...npcTierPreset('boss'), defaultSide: 'foe' }), id: nid('npc_4') };
    const npcTable = new Map([ally, foeNormal, foeElite, foeBoss].map(n => [n.id, n]));
    const mixedXp = (id: MonsterId | NpcId): number => {
      if (id in XP) return XP[id]!;
      const n = npcTable.get(id as NpcId);
      return n ? npcXp(n, RULES) : 0;
    };

    const g: Gate = {
      ...den('detected'),
      npcs: [
        { npcId: ally.id, count: 2, side: 'party' },
        { npcId: foeNormal.id, count: 2, side: 'foe' },
        { npcId: foeElite.id, count: 1, side: 'foe' },
        { npcId: foeBoss.id, count: 1, side: 'foe' },
        { npcId: nid('npc_999'), count: 3, side: 'foe' },
      ],
    };
    const expectedFoeNpcXp = npcXp(foeNormal, RULES) * 2 + npcXp(foeElite, RULES) + npcXp(foeBoss, RULES);
    expect(npcXp(foeElite, RULES)).toBe(Math.round(npcXp(foeNormal, RULES) * RULES.fight.kinds.elite.xp));
    expect(npcXp(foeBoss, RULES)).toBe(Math.round(npcXp(foeNormal, RULES) * RULES.fight.kinds.boss.xp));
    expect(gateXp(g, mixedXp)).toBe(DEN_XP + expectedFoeNpcXp);
    expect(xpDue(g, mixedXp)).toBe(DEN_XP + expectedFoeNpcXp);
    expect(fightAward({ ...g, xpPaid: DEN_XP }, 100, mixedXp)).toBe(100);
    expect(fightAward({ ...g, xpPaid: DEN_XP + expectedFoeNpcXp }, 100, mixedXp)).toBe(0);
  });

  test('shownOf and worldDoc strip GateFields.npcs completely', () => {
    const g: Gate = {
      ...den('detected'),
      npcs: [{ npcId: nid('npc_42'), count: 2, side: 'foe', wave: 1 }],
    };
    const shown = shownOf(g, 60);
    expect('npcs' in shown).toBe(false);
    const doc = worldDoc({ gates: [g] }, 3, new Set(), 1);
    expect(JSON.stringify(doc)).not.toContain('npc_42');
    expect(JSON.stringify(doc)).not.toContain('npcs');
  });

  test('fork 5: gate NPCs join solo runs counted through partyHeadcount, scaling foes and keeping allies unscaled, carrying full fight bodies on soloDoc with GM notes stripped', () => {
    const h = { ...newHunter(RULES), id: 'h1' as never, name: 'Jin' };
    const sampleAbility = seedMonsters(RULES).find(m => m.abilities.length)!.abilities[0]!;
    const allyNpc = {
      ...newNpc({ name: 'Mira Guide', rank: 'E', archetype: 'skirmisher', defaultSide: 'party', skill: 4, abilities: [sampleAbility], statuses: [{ key: 'hasted', rounds: 2 }], notes: 'Secret ally note' }),
      id: nid('npc_1'),
    };
    const foeNpc = {
      ...newNpc({ name: 'Rival Raider', rank: 'E', archetype: 'brute', ...npcTierPreset('elite'), defaultSide: 'foe', skill: 2, abilities: [sampleAbility], statuses: [{ key: 'poisoned', rounds: 2 }], notes: 'Secret foe note' }),
      id: nid('npc_2'),
    };
    const withMonstersAndNpcs: Gate = {
      ...den('detected'),
      solo: true,
      monsters: [{ monsterId: seedId<'m'>('goblin'), count: 2 }],
      bossId: null,
      npcs: [
        { npcId: allyNpc.id, count: 1, side: 'party' },
        { npcId: foeNpc.id, count: 2, side: 'foe' },
      ],
    };
    const foeNpcOnlyGate: Gate = {
      ...den('detected'),
      id: 'g-npc-only' as never,
      solo: true,
      monsters: [],
      bossId: null,
      npcs: [{ npcId: foeNpc.id, count: 2, side: 'foe' }],
    };
    const allyOnlyGate: Gate = {
      ...den('detected'),
      id: 'g-ally-only' as never,
      solo: true,
      monsters: [],
      bossId: null,
      npcs: [{ npcId: allyNpc.id, count: 1, side: 'party' }],
    };
    const baseSave = newSave(dev('d'));
    const save = {
      ...baseSave,
      hunters: [h],
      gates: [withMonstersAndNpcs, foeNpcOnlyGate, allyOnlyGate],
      library: { ...baseSave.library, npcs: [allyNpc, foeNpc] },
    };
    const ctx = { R: RULES, route: 'local' as const, held: false, nowMs: Date.now() };

    // 1 hunter + 1 Support ally gate NPC = weighted headcount 1 + allyWeight.support (2 foe NPCs do NOT inflate headcount).
    const ready = soloReady(save, h.id, { kind: 'world', id: withMonstersAndNpcs.id }, ctx);
    expect(isRefused(ready)).toBe(false);
    const expectedHead = 1 + RULES.fight.partyScale.allyWeight.support;
    const scaleHead = gateFoeScale('normal', 'E', 5, expectedHead, RULES, 'brute');
    const gobScaleHead = gateFoeScale('normal', 'E', 5, expectedHead, RULES, 'skirmisher');
    if (!isRefused(ready)) {
      expect(ready.target.monsters).toHaveLength(1);
      expect(ready.target.monsters[0]!.monster.tweak.hp).toBeCloseTo(gobScaleHead.hp, 5);
      expect(ready.target.npcs).toHaveLength(2);
      const tAlly = ready.target.npcs!.find(n => n.side === 'party')!;
      const tFoe = ready.target.npcs!.find(n => n.side === 'foe')!;
      expect(tAlly.npc.tweak.hp).toBe(allyNpc.tweak.hp);
      expect(tAlly.npc.tweak.dealt).toBe(allyNpc.tweak.dealt);
      expect(tFoe.npc.tweak.hp).toBeCloseTo(foeNpc.tweak.hp * scaleHead.hp, 5);
      expect(tFoe.npc.tweak.dealt).toBeCloseTo(foeNpc.tweak.dealt * scaleHead.dealt, 5);

      const fight = soloFight(ready.h, ready.target, RULES)!;
      const allyRows = fight.fight.rows.filter(r => r.kind === 'hunter' && r.npc && r.side === 'party');
      const foeNpcRows = fight.fight.rows.filter(r => r.kind === 'hunter' && r.npc && r.side === 'foe');
      expect(allyRows).toHaveLength(1);
      expect(allyRows[0]!.sheet.hpMax).toBe(npcSheet(allyNpc, RULES).hpMax);
      expect(foeNpcRows).toHaveLength(2);
      expect(fight.fight.rows.filter(r => r.kind === 'monster')).toHaveLength(2);
    }

    // A gate with only foe NPCs has valid foes (headcount = 1); a gate with only ally NPCs refuses as empty.
    const foeOnlyReady = soloReady(save, h.id, { kind: 'world', id: foeNpcOnlyGate.id }, ctx);
    expect(isRefused(foeOnlyReady)).toBe(false);
    if (!isRefused(foeOnlyReady)) {
      const scale1 = gateFoeScale('normal', 'E', 5, 1, RULES, 'brute');
      expect(foeOnlyReady.target.npcs![0]!.npc.tweak.hp).toBeCloseTo(foeNpc.tweak.hp * scale1.hp, 5);
    }
    expect(soloReady(save, h.id, { kind: 'world', id: allyOnlyGate.id }, ctx)).toEqual({ ok: false, why: 'empty' });

    // soloDoc carries full NPC fight bodies (tier, tweak, abilities, statuses, line skill) so room solo matches local solo, while stripping GM notes.
    const published = soloDoc(save, RULES, DOC_MAX);
    const wireRaw = JSON.stringify(published.doc);
    expect(wireRaw).not.toContain('Secret ally note');
    expect(wireRaw).not.toContain('Secret foe note');
    expect(published.doc.monsters[foeNpc.id]!.kind).toBe('elite');
    expect(published.doc.monsters[foeNpc.id]!.abilities).toHaveLength(1);
    expect(published.doc.monsters[foeNpc.id]!.statuses).toEqual([{ key: 'poisoned', rounds: 2 }]);
    expect(published.doc.monsters[allyNpc.id]!.tweak.hp).toBeCloseTo(allyNpc.tweak.hp, 6);
    expect(published.doc.monsters[allyNpc.id]!.abilities).toHaveLength(1);
    expect(published.doc.statuses.poisoned).toBeDefined();
    expect(published.doc.statuses.hasted).toBeDefined();
    const parsedSolo = DOCS.solo(JSON.parse(wireRaw))!;
    expect(parsedSolo).not.toBeNull();

    const world = worldDoc(save, 1, new Set(published.doc.gates.map(g => g.id)), 0);
    const customSkillRules = { fight: { ...RULES.fight, npc: { ...RULES.fight.npc, defaultSkill: 5 } } };
    const targets = soloTargets(DOCS.world(JSON.parse(JSON.stringify(world))), parsedSolo, customSkillRules);
    const tMixed = targets.find(t => t.gate.id === withMonstersAndNpcs.id)!;
    expect(tMixed.monsters[0]!.monster.tweak.hp).toBeCloseTo(gobScaleHead.hp, 2);
    const remoteAlly = tMixed.npcs?.find(n => n.side === 'party')!;
    const remoteFoe = tMixed.npcs?.find(n => n.side === 'foe')!;
    expect(remoteAlly.npc.tier).toBe(allyNpc.tier);
    expect(remoteAlly.npc.tweak.hp).toBeCloseTo(allyNpc.tweak.hp, 6);
    expect(remoteAlly.npc.tweak.dealt).toBeCloseTo(allyNpc.tweak.dealt, 6);
    expect(remoteAlly.npc.abilities).toHaveLength(1);
    expect(remoteAlly.npc.statuses).toEqual([{ key: 'hasted', rounds: 2 }]);
    expect(remoteAlly.npc.skill as number).toBe(4);
    expect(remoteFoe.npc.tier).toBe('elite');
    expect(remoteFoe.npc.tweak.hp).toBeCloseTo(foeNpc.tweak.hp * scaleHead.hp, 2);
    expect(remoteFoe.npc.tweak.dealt).toBeCloseTo(foeNpc.tweak.dealt * scaleHead.dealt, 2);
    expect(remoteFoe.npc.abilities).toHaveLength(1);
    expect(remoteFoe.npc.statuses).toEqual([{ key: 'poisoned', rounds: 2 }]);
    expect(remoteFoe.npc.skill as number).toBe(2);

    // Older solo docs without line `skill` fall back to `R.fight.npc.defaultSkill`.
    const legacyDoc = {
      ...parsedSolo,
      gates: parsedSolo.gates.map(g => ({ ...g, lines: g.lines.map(({ skill: _s, ...rest }) => rest) })),
    };
    const legacyMixed = soloTargets(DOCS.world(JSON.parse(JSON.stringify(world))), legacyDoc, customSkillRules).find(t => t.gate.id === withMonstersAndNpcs.id)!;
    expect(legacyMixed.npcs?.find(n => n.side === 'party')!.npc.skill as number).toBe(5);
    expect(legacyMixed.npcs?.find(n => n.side === 'foe')!.npc.skill as number).toBe(5);
  });

  test('room solo preserves per-line scale when a non-boss monster sits in the boss slot with its own difficulty', () => {
    const h = { ...newHunter(RULES), id: 'h1' as never, name: 'Jin' };
    const goblin = seedMonsters(RULES).find(m => m.id === seedId<'m'>('goblin'))!;
    const eliteFoe = { ...seedMonsters(RULES).find(m => m.kind === 'elite')! };
    const gate: Gate = {
      ...den('detected'),
      id: 'g-own-nonboss' as never,
      rank: eliteFoe.rank,
      solo: true,
      difficulty: { gate: { at: 'set', level: 3 }, boss: { at: 'own', level: 9 } },
      monsters: [{ monsterId: goblin.id, count: 2 }],
      bossId: eliteFoe.id,
    };
    const baseSave = newSave(dev('d'));
    const save = { ...baseSave, hunters: [h], gates: [gate] };
    const local = soloReady(save, h.id, { kind: 'world', id: gate.id }, { R: RULES, route: 'local', held: false, nowMs: Date.now() });
    expect(isRefused(local)).toBe(false);
    if (isRefused(local)) return;

    const published = soloDoc(save, RULES, DOC_MAX);
    expect(published.left).toEqual([]);
    const wireGate = published.doc.gates[0]!;
    const packLine = wireGate.lines.find(l => l.m === goblin.id)!;
    const bossLine = wireGate.lines.find(l => l.m === eliteFoe.id)!;
    // Pack monster shares gate-level scale; non-boss monster in the boss slot carries its own diff-9 scale.
    expect(packLine.hp).toBeUndefined();
    expect(packLine.dealt).toBeUndefined();
    expect(bossLine.hp).toBeDefined();
    expect(bossLine.dealt).toBeDefined();

    const parsedSolo = DOCS.solo(JSON.parse(JSON.stringify(published.doc)))!;
    expect(parsedSolo).toEqual(published.doc);
    const world = worldDoc(save, 1, new Set([gate.id]), 0);
    const remote = soloTargets(DOCS.world(JSON.parse(JSON.stringify(world))), parsedSolo, RULES)[0]!;
    const expectedPack = gateFoeScale(goblin.kind, goblin.rank, 3, 1, RULES, goblin.archetype);
    const expectedBoss = gateFoeScale(eliteFoe.kind, eliteFoe.rank, 9, 1, RULES, eliteFoe.archetype);
    const remotePack = remote.monsters.find(m => m.id === goblin.id)!;
    const remoteBoss = remote.monsters.find(m => m.id === eliteFoe.id)!;
    expect(remotePack.monster.tweak.hp).toBeCloseTo((goblin.tweak.hp ?? 1) * expectedPack.hp, 2);
    expect(remotePack.monster.tweak.dealt).toBeCloseTo((goblin.tweak.dealt ?? 1) * expectedPack.dealt, 2);
    expect(remoteBoss.monster.tweak.hp).toBeCloseTo((eliteFoe.tweak.hp ?? 1) * expectedBoss.hp, 2);
    expect(remoteBoss.monster.tweak.dealt).toBeCloseTo((eliteFoe.tweak.dealt ?? 1) * expectedBoss.dealt, 2);
    expect(remoteBoss.monster.tweak.hp).toBeCloseTo(local.target.monsters.find(m => m.id === eliteFoe.id)!.monster.tweak.hp ?? 1, 2);
    expect(remoteBoss.monster.tweak.dealt).toBeCloseTo(local.target.monsters.find(m => m.id === eliteFoe.id)!.monster.tweak.dealt ?? 1, 2);
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
      { words: 'Cleared on day 4', tone: null }, { words: 'Gate closed', tone: null }, { words: 'Broke on day 5. Monsters are loose.', tone: 'over' },
    ]);
  });
  test('a spawn gives a gate any type but break, which comes from a story', () => {
    expect(SPAWN_TYPES).toEqual(GATE_TYPES.filter(t => t !== 'break'));
  });
});
