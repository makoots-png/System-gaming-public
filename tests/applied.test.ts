import { describe, expect, test } from 'bun:test';
import { APPLIED_MAX, HELD_MAX, appliedOnce, hold, parseApplied, parseHeld, recordApplied } from '../src/core/applied.ts';
import { parseEvent } from '../src/core/protocol.ts';
import type { EventId, RoomEvent } from '../src/core/protocol.ts';
import { freshSave } from '../src/core/save.ts';
import { setLevel } from '../src/core/hunter/progress.ts';
import type { Hunter, Rules, Save } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { SheetStatus, Source } from '../src/core/combat/effect-ops.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { RULES } from '../src/core/rules.ts';
import { applyAll, applyRoomEvent } from '../src/edge/room-events.ts';
import type { ApplyDeps } from '../src/edge/room-events.ts';
import { day, dev } from './fixtures/ids.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import type { WaitingRun } from '../src/core/gates/solo-wait.ts';

const e = (n: number): EventId => `d-gm1-e${n}` as EventId;
const ids = (from: number, to: number): EventId[] => Array.from({ length: to - from + 1 }, (_, i) => e(from + i));

describe('the event ids a phone has applied', () => {
  test('a new event is recorded, newest last', () => {
    expect(recordApplied([], e(1))).toEqual([e(1)]);
    expect(recordApplied([e(1)], e(2))).toEqual([e(1), e(2)]);
  });

  test('a phone with no ring yet records the first event', () => {
    expect(recordApplied(undefined, e(1))).toEqual([e(1)]);
  });

  test('an event already applied is not applied again', () => {
    expect(recordApplied([e(1), e(2)], e(1))).toBeNull();
    expect(recordApplied([e(1), e(2)], e(2))).toBeNull();
  });

  test('the ring keeps the newest 200 ids: the oldest is forgotten when the 201st arrives', () => {
    expect(APPLIED_MAX).toBe(200);
    const full = ids(1, 200);
    expect(recordApplied(full, e(201))).toEqual(ids(2, 201));
    expect(recordApplied(ids(2, 201), e(201))).toBeNull();
    expect(recordApplied(ids(2, 201), e(1))).toEqual([...ids(3, 201), e(1)]);
  });

  test('recording leaves the ring it was given as it was', () => {
    const ring = [e(1)];
    recordApplied(ring, e(2));
    expect(ring).toEqual([e(1)]);
  });
});

describe('the ring as a save holds it', () => {
  test('event ids are kept in order', () => {
    expect(parseApplied(['d-gm1-e1', 'd-gm1-e2'])).toEqual([e(1), e(2)]);
  });

  test('an entry that is not an event id is dropped and the rest kept', () => {
    expect(parseApplied(['d-gm1-e1', 5, null, 'has space', 'x'.repeat(41), { eid: 'd-gm1-e2' }, 'd-gm1-e3'])).toEqual([e(1), e(3)]);
  });

  test('a list longer than 200 keeps its newest 200', () => {
    expect(parseApplied(ids(1, 10_000))).toEqual(ids(9801, 10_000));
  });

  test('anything that is not a list is an empty ring', () => {
    for (const v of [undefined, null, 'd-gm1-e1', { 0: 'd-gm1-e1' }, 7]) expect(parseApplied(v)).toEqual([]);
  });
});


/** The toast a player's phone shows when the GM's fight holds the hunter's vitals (hunter.js `gmHolds`). */
const HELD = 'held by the GM\'s fight';
/**
 * A player's phone on device `d-player1` with one hunter, `h1`, as sync.ts hands it to the appliers: a real save, and
 * `once` as sync.ts runs it (`store.apply` of `appliedOnce`: the step is worked out first, then written whole, so a step
 * that throws writes nothing). `fight`: the GM's fight holds the hunter's vitals (`fightOf` answers `gm`).
 */
function phone(o: { conditions?: SheetStatus[]; fight?: boolean; level?: number; runs?: WaitingRun[] } = {}) {
  const fresh = freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-player1') }, { onboarded: true });
  let save: Save = { ...fresh, hunters: fresh.hunters.map(h => ({ ...h, ...setLevel(h, o.level ?? 1, 0, RULES).progress, conditions: [...(o.conditions ?? [])] })) };
  if (o.runs) save = { ...save, settings: { ...save.settings, sync: { ...save.settings.sync, runs: o.runs } } };
  let rules: Rules = RULES;
  const windows: { title: string; lines?: string[] }[] = [], toasts: string[] = [], shown: string[][] = [], completed: string[] = [], said: { title: string | undefined; body: string | undefined }[] = [];
  const deps: ApplyDeps = {
    store: { get: () => save },
    once: (eid, step) => { const next = appliedOnce(eid, step)(save); if (isRefused(next)) return false; save = next; return true; },
    rules: () => rules, now: () => AT, today: () => day(AT.slice(0, 10)),
    toast: (_tag, text) => { toasts.push(text); }, system: w => { windows.push(w); },
    hunter: {
      fightOf: () => (o.fight ? { at: 'gm' } : null),
      granted: (_hid, g, opts) => { shown.push(g.lines); said.push({ title: opts?.title, body: opts?.body }); return { lines: g.lines, levelup: g.levelup, popup: null }; },
      gmHolds: () => { toasts.push(HELD); return false; },
    },
    stepsDone: (_hid, done) => { completed.push(...done.map(d => d.quest.title)); },
    coinLanded: () => {},
  };
  const receive = (eid: number, type: string, payload: Raw): void => {
    const ev = parseEvent(type, { eid: e(eid), ...payload });
    if (!ev) throw new Error(`the ${type} event did not parse`);
    applyRoomEvent(ev, deps);
  };
  const status = (eid: number, grant: Raw): void => receive(eid, 'status', { to: ['d-player1:h1'], add: [grant], reason: '' });
  return {
    get hunter(): Hunter { return save.hunters[0]!; },
    get applied(): readonly EventId[] { return save.settings.sync.applied ?? []; },
    get runs(): readonly WaitingRun[] { return save.settings.sync.runs ?? []; },
    useRules: (R: Rules) => { rules = R; },
    windows, toasts, shown, completed, said, receive, status, deps,
  };
}
type Raw = Record<string, unknown>;
const AT = '2026-11-14T12:00:00.000Z';
const monster = (tier: number): Source => ({ id: combatantId(`c-${tier}`), tier });
const BURNING = BUILT_IN_STATUSES.burning;
const burning = (tier: number, rounds: number | null): SheetStatus => ({ key: 'burning' as SheetStatus['key'], def: BURNING, source: monster(tier), rounds });

describe('a status the GM sends to a player\'s phone', () => {
  test('a weaker Burning does not replace a stronger one: the hunter keeps the C-rank source', () => {
    const p = phone({ conditions: [burning(2, 2)] });
    p.status(1, burning(0, 2));
    expect(p.hunter.conditions).toEqual([burning(2, 2)]);
  });

  test('a stronger Burning takes the place of a weaker one, and keeps the longer of the two', () => {
    const p = phone({ conditions: [burning(0, 4)] });
    p.status(1, burning(5, 1));
    expect(p.hunter.conditions).toEqual([burning(5, 4)]);
  });

  test('a Burning that lasts until removed outlasts any count of rounds', () => {
    const p = phone({ conditions: [burning(0, 5)] });
    p.status(1, burning(0, null));
    expect(p.hunter.conditions.map(c => c.rounds)).toEqual([null]);
  });

  test('the player is told in a toast, not a window, with the numbers of the Burning the hunter now has: the C-rank 3d8 and 3 rounds', () => {
    const p = phone({ conditions: [burning(2, 2)] });
    p.status(1, burning(0, 3));
    expect(p.windows).toEqual([]);
    expect(p.toasts).toEqual(['Burning: 3d8 magical damage a round · 3 rounds']);
  });

  test('the same event arriving twice is applied once', () => {
    const p = phone();
    p.status(1, burning(1, 2));
    p.status(1, burning(1, 2));
    expect(p.toasts).toHaveLength(1);
    expect(p.hunter.conditions).toEqual([burning(1, 2)]);
  });

  test('while the GM\'s fight holds the hunter, a status is refused with the toast that says so, and is not tried again', () => {
    const p = phone({ fight: true });
    p.status(1, burning(1, 2));
    p.status(1, burning(1, 2));
    expect([p.hunter.conditions, p.toasts, p.applied]).toEqual([[], [HELD], [e(1)]]);
  });
});

describe('what the GM\'s fight sends a player\'s phone', () => {
  const VITALS = { to: ['d-player1:h1'], hp: 12, mana: 3, fatigue: 20, statuses: [burning(2, 1.5)] };

  test('the fight\'s totals are set on the hunter once, with its statuses as the fight holds them', () => {
    const p = phone({ conditions: [burning(0, 9)] });
    p.receive(1, 'vitals', VITALS);
    const once = p.hunter;
    p.receive(1, 'vitals', VITALS);
    expect(p.hunter).toBe(once);
    expect([p.hunter.life, p.hunter.mana, p.hunter.fatigue]).toEqual([{ at: 'up', hp: 12 }, 3, 20]);
    expect(p.hunter.conditions).toEqual([burning(2, 1.5)]);
  });

  test('a status the fight put on the hunter since its last totals is told in a toast with its numbers; one it held already is not', () => {
    const p = phone({ conditions: [burning(0, 9)] });
    // Bleeding at C (tier 2) is 2d6 physical damage a round (statuses.ts); Burning was held already
    const bleeding: SheetStatus = { key: 'bleeding' as SheetStatus['key'], def: BUILT_IN_STATUSES.bleeding, source: monster(2), rounds: 2 };
    p.receive(1, 'vitals', { ...VITALS, statuses: [burning(2, 1.5), bleeding] });
    expect(p.windows).toEqual([]);
    expect(p.toasts).toEqual(['Bleeding: 2d6 physical damage a round · 2 rounds']);
  });

  test('a board change of mana reaches the hunter as mana, and HP and fatigue stay', () => {
    const p = phone(), before = p.hunter;
    p.receive(1, 'hp', { to: ['d-player1:h1'], hp: 0, mana: -4, fatigue: 0 });
    expect([p.hunter.mana, p.hunter.life, p.hunter.fatigue]).toEqual([before.mana - 4, before.life, before.fatigue]);
    expect(p.toasts).toEqual(['-4 mana']);
  });

  test('another player\'s step or cast changes nothing on this phone', () => {
    const p = phone(), before = p.hunter;
    p.receive(1, 'step', { by: 'd-player2:h4', place: { x: 1, y: 1 }, at: 0 });
    p.receive(2, 'cast', { by: 'd-player2:h4', ability: 'strike', aim: 'c1', at: 0 });
    expect([p.hunter, p.toasts, p.applied]).toEqual([before, [], []]);
  });
});

describe('a reward the GM sends lands whole', () => {
  // A reward that touches every part a grant writes: points, a title, a status, gold, an item, a boon and XP.
  const AWARD = {
    to: ['d-player1:h1'],
    rewards: {
      xp: 40, points: 2, gold: 30, items: [{ name: 'Moon Shard', rar: 'rare', qty: 2 }], title: { name: 'Gatebreaker', desc: '', bonus: {} },
      statuses: [{ key: 'hasted', rounds: 3 }], boons: [{ name: 'A favour', text: 'The guild owes you.' }],
    },
  };
  const shards = (h: Hunter): number => h.items.filter(i => i.name === 'Moon Shard').reduce((n, i) => n + i.qty, 0);
  /** What a reward changes on the hunter, read back. */
  const parts = (h: Hunter) => ({ xp: h.xp, bonus: h.bonusPoints, gold: h.gold, shards: shards(h), titles: h.titles.map(t => t.name), statuses: h.conditions.map(c => c.key), boons: h.boons.map(b => b.name) });

  test('every part of the award is on the hunter, and its id is recorded, in the same write', () => {
    const p = phone(), before = parts(p.hunter);
    p.receive(1, 'award', AWARD);
    expect(parts(p.hunter)).toEqual({
      xp: before.xp + 40, bonus: before.bonus + 2, gold: before.gold + 30, shards: 2,
      titles: [...before.titles, 'Gatebreaker'], statuses: [...before.statuses, 'hasted'], boons: [...before.boons, 'A favour'],
    });
    expect(p.applied).toEqual([e(1)]);
    expect(p.shown).toEqual([['+40 XP', '+30 gold', '+2 ability points', 'Item acquired: Moon Shard ×2', 'Title acquired: Gatebreaker', 'Status: Hasted (3 rounds)', 'Boon: A favour']]);
  });

  test('a bundle the GM gave by hand opens in its own words and is a fact of the hunter\'s chronicle, once', () => {
    const p = phone(), bundle = { key: 'seed-held-the-mask', name: 'Held the Mask', window: { title: 'THE MASK HELD', line: 'You stayed who you are.' } };
    p.receive(1, 'award', { to: ['d-player1:h1'], rewards: { points: 1 }, bundle });
    p.receive(1, 'award', { to: ['d-player1:h1'], rewards: { points: 1 }, bundle });
    expect(p.said).toEqual([{ title: 'THE MASK HELD', body: 'You stayed who you are.' }]);
    expect(p.hunter.chronicle.inbox).toEqual([{ kind: 'given', key: 'seed-held-the-mask', name: 'Held the Mask' }]);
    p.receive(2, 'award', AWARD);
    expect(p.said.at(-1), 'a plain award').toEqual({ title: 'REWARD RECEIVED', body: 'The System has delivered a reward.' });
  });

  test('the same award delivered twice is given once', () => {
    const p = phone();
    p.receive(1, 'award', AWARD);
    const once = parts(p.hunter);
    p.receive(1, 'award', AWARD);
    expect([parts(p.hunter), p.shown.length]).toEqual([once, 1]);
  });

  test('an award that fails part way gives nothing and is not marked applied, so its next delivery gives it whole', () => {
    const p = phone(), before = parts(p.hunter);
    // the rules break after the points are worked out, before the title: the old applier had written the points by then
    p.useRules(new Proxy(RULES, { get: (t, k) => { if (k === 'titles') throw new Error('the rules broke'); return Reflect.get(t, k); } }));
    expect(() => p.receive(1, 'award', AWARD)).toThrow('the rules broke');
    expect([parts(p.hunter), p.applied, p.shown]).toEqual([before, [], []]);
    p.useRules(RULES);
    p.receive(1, 'award', AWARD);
    expect(parts(p.hunter).gold).toBe(before.gold + 30);
    expect(parts(p.hunter).bonus).toBe(before.bonus + 2);
    expect(p.applied).toEqual([e(1)]);
  });

  test('an award that throws on this phone is held while the next message lands, and lands whole after the next good poll', () => {
    const p = phone(), before = parts(p.hunter), warn = console.warn;
    const award = parseEvent('award', { eid: e(1), ...AWARD })!, hp = parseEvent('hp', { eid: e(2), to: ['d-player1:h1'], hp: 0, mana: 0, fatigue: 10, reason: '' })!;
    p.useRules(new Proxy(RULES, { get: (t, k) => { if (k === 'titles') throw new Error('the rules broke'); return Reflect.get(t, k); } }));
    console.warn = () => {};
    let polled: { held: RoomEvent[]; fresh: RoomEvent[] };
    try { polled = applyAll([], [award, hp], p.deps); } finally { console.warn = warn; }
    expect(polled.held.map(x => x.payload.eid)).toEqual([e(1)]);
    expect(polled.fresh.map(x => x.payload.eid)).toEqual([e(1)]);
    expect(p.applied).toEqual([e(2)]);
    expect(parts(p.hunter).gold).toBe(before.gold);
    p.useRules(RULES);
    const next = applyAll(polled.held, [], p.deps);
    expect(next).toEqual({ held: [], fresh: [] });
    expect([parts(p.hunter).gold, parts(p.hunter).bonus, p.applied]).toEqual([before.gold + 30, before.bonus + 2, [e(2), e(1)]]);
    expect(applyAll([award], [], p.deps)).toEqual({ held: [], fresh: [] });
    expect(parts(p.hunter).gold).toBe(before.gold + 30);
  });

  test('a held event is kept once, the newest at most HELD_MAX, and a save\'s list is read by the room\'s parser', () => {
    const award = (n: number) => parseEvent('award', { eid: e(n), ...AWARD })!;
    expect(hold(hold([], award(1)), award(1))).toEqual([award(1)]);
    const many = Array.from({ length: HELD_MAX + 1 }, (_, i) => award(i + 1)).reduce<RoomEvent[]>((h, ev) => hold(h, ev), []);
    expect(many.map(x => x.payload.eid)).toEqual(ids(2, HELD_MAX + 1));
    expect(parseHeld([JSON.parse(JSON.stringify(award(3))), { type: 'award', payload: {} }, 'x'])).toEqual([award(3)]);
    expect(parseHeld('x')).toEqual([]);
  });

  test('while the GM\'s fight holds the hunter, a reward\'s status is left for the fight and the rest lands', () => {
    const p = phone({ fight: true }), before = parts(p.hunter);
    p.receive(1, 'award', AWARD);
    expect(parts(p.hunter)).toMatchObject({ gold: before.gold + 30, statuses: before.statuses });
    expect(p.shown[0]).not.toContain('Status: Hasted (3 rounds)');
  });
});

describe('the GM\'s Job Change on a player\'s phone', () => {
  test('starting a chain issues step 1 in the same write as the chain, with its log line, and opens a window', () => {
    const p = phone();
    p.receive(1, 'chain', { to: ['d-player1:h1'], job: 'Ranger', kind: 'issue' });
    const q = p.hunter.quests.find(x => x.id === p.hunter.jobChain?.questId);
    expect([p.hunter.jobChain?.job, p.hunter.jobChain?.step, q?.title]).toEqual(['Ranger', 1, 'Job Change 1/3: Requirements']);
    expect(p.windows.map(w => w.title)).toEqual(['JOB CHANGE QUEST']);
    expect(p.applied).toEqual([e(1)]);
  });

  test('a chain started at level 10 completes step 1 in the same write and opens step 2, the dungeon', () => {
    const p = phone({ level: 10 });
    p.receive(1, 'chain', { to: ['d-player1:h1'], job: 'Ranger', kind: 'issue' });
    const step1 = p.hunter.quests.find(q => q.title === 'Job Change 1/3: Requirements');
    const open = p.hunter.quests.find(q => q.id === p.hunter.jobChain?.questId);
    expect([step1?.status, p.hunter.jobChain?.step, open?.title, p.completed]).toEqual(['done', 2, 'Job Change 2/3: The Job Change Dungeon', ['Job Change 1/3: Requirements']]);
    expect(p.applied).toEqual([e(1)]);
  });

  test('a second chain while one runs changes nothing and says nothing', () => {
    const p = phone();
    p.receive(1, 'chain', { to: ['d-player1:h1'], job: 'Ranger', kind: 'issue' });
    const once = p.hunter;
    p.receive(2, 'chain', { to: ['d-player1:h1'], job: 'Mage', kind: 'issue' });
    expect([p.hunter.jobChain, p.windows.length]).toEqual([once.jobChain, 1]);
  });
});

describe('an item the GM\'s fight took from a player\'s hunter', () => {
  const consumable = (h: Hunter) => h.items.find(i => i.type === 'consumable')!;

  test('one leaves the bag when the fight took it, once however often the message arrives, and the player is told', () => {
    const p = phone(), it = consumable(p.hunter), had = it.qty;
    p.receive(1, 'spent', { to: ['d-player1:h1'], item: it.id });
    p.receive(1, 'spent', { to: ['d-player1:h1'], item: it.id });
    expect(p.hunter.items.find(i => i.id === it.id)?.qty ?? 0).toBe(had - 1);
    expect(p.toasts).toEqual([`${it.name} used.`]);
  });

  test('an item the bag no longer holds takes nothing, and the message is still recorded', () => {
    const p = phone(), was = p.hunter.items;
    p.receive(2, 'spent', { to: ['d-player1:h1'], item: 'i999' });
    expect(p.hunter.items).toEqual(was);
    expect(p.applied).toContain(e(2));
    expect(p.toasts).toEqual([]);
  });
});

describe('a shadow the GM\'s phone raised for a player\'s hunter (implicit audit 3, C3)', () => {
  const ICE_BEAR = { rank: 'C', archetype: 'brute', grade: 'Knight', monster: 'm7', name: 'Ice Bear' };

  test('it joins the army once, with its log line, however often the message arrives, and the player is told', () => {
    const p = phone(), had = p.hunter.shadows.length;
    p.receive(1, 'shadow', { to: ['d-player1:h1'], shadow: ICE_BEAR });
    p.receive(1, 'shadow', { to: ['d-player1:h1'], shadow: ICE_BEAR });
    expect(p.hunter.shadows.map(s => [s.name, s.grade, s.rank, s.monster])).toEqual([...p.hunter.shadows.slice(0, had).map(s => [s.name, s.grade, s.rank, s.monster]), ['Ice Bear', 'Knight', 'C', 'm7']]);
    expect(p.deps.store.get().log[0]).toMatchObject({ hunterId: 'h1', title: 'Shadow extraction', text: 'Ice Bear (Knight) joins the shadow army.' });
    expect(p.toasts).toHaveLength(1);
  });

  test('an army at its cap takes none: the player is told, and the message is recorded so a repeat changes nothing', () => {
    const p = phone(), cap = hunterSheet(p.hunter, RULES).sheet.shadows;
    for (let i = 0; i < cap; i++) p.receive(10 + i, 'shadow', { to: ['d-player1:h1'], shadow: ICE_BEAR });
    const full = p.hunter.shadows;
    p.receive(99, 'shadow', { to: ['d-player1:h1'], shadow: { ...ICE_BEAR, name: 'One Too Many' } });
    expect(p.hunter.shadows).toEqual(full);
    expect(p.applied).toContain(e(99));
    expect(p.toasts.at(-1)).toContain('full');
  });
});

describe('the GM\'s answer to a solo run lands whole, once a run (notes-2-solo.md section 5)', () => {
  const RUN = 'd-player1-run1' as EventId;
  const waiting = (): WaitingRun => ({ run: RUN, room: 'ABCD23' as never, hid: 'h1' as never, gate: 'g12' as never, name: 'Goblin Den', at: AT, state: 'taken' });
  const PAID = { to: ['d-player1:h1'], run: RUN, gate: 'g12', name: 'Goblin Den', verdict: 'paid', rewards: { xp: 50, gold: 120 } };

  test('a paid answer closes the waiting run and gives its reward in the same write, with the GATE CLEARED window', () => {
    const p = phone({ runs: [waiting()] }), before = p.hunter;
    p.receive(1, 'soloAnswer', PAID);
    expect([p.hunter.xp - before.xp, p.hunter.gold - before.gold]).toEqual([50, 120]);
    expect([p.runs, p.applied]).toEqual([[], [e(1)]]);
    expect(p.shown).toEqual([['+50 XP', '+120 gold']]);
  });

  test('a second answer to the same run (a second GM phone, or the same one again) gives nothing', () => {
    const p = phone({ runs: [waiting()] });
    p.receive(1, 'soloAnswer', PAID);
    const once = { xp: p.hunter.xp, gold: p.hunter.gold };
    p.receive(2, 'soloAnswer', PAID);
    p.receive(1, 'soloAnswer', PAID);
    expect([{ xp: p.hunter.xp, gold: p.hunter.gold }, p.shown.length, p.runs]).toEqual([once, 1, []]);
  });

  test('a refused answer closes the run with its words and gives nothing; an answer for no waiting run changes nothing', () => {
    const p = phone({ runs: [waiting()] }), xp = p.hunter.xp;
    p.receive(1, 'soloAnswer', { ...PAID, verdict: 'refused', why: 'taken', rewards: undefined });
    expect([p.runs, p.hunter.xp]).toEqual([[], xp]);
    expect(p.windows.map(w => [w.title, w.lines])).toEqual([['GATE TAKEN', ['Another hunter cleared this gate first. Your run\'s cost stays.']]]);
    const q = phone();
    q.receive(1, 'soloAnswer', PAID);
    expect([q.hunter.xp, q.shown, q.windows]).toEqual([xp, [], []]);
  });
});
