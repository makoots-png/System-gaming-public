import { describe, expect, test } from 'bun:test';
import { APPLIED_MAX, HELD_MAX, appliedOnce, hold, parseApplied, parseHeld, recordApplied } from '../src/core/applied.ts';
import { parseEvent, standsFor } from '../src/core/protocol.ts';
import type { EventId, RoomCode, RoomEvent } from '../src/core/protocol.ts';
import { post } from '../src/core/sync/outbox.ts';
import type { Outbox } from '../src/core/sync/outbox.ts';
import { freshSave } from '../src/core/save.ts';
import { setLevel } from '../src/core/hunter/progress.ts';
import { raisedLine } from '../src/core/hunter/grant.ts';
import type { Hunter, Rules, Save } from '../src/core/save.ts';
import { TOLD, isRefused, refuse } from '../src/core/save-step.ts';
import type { SheetStatus, Source } from '../src/core/combat/effect-ops.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { RULES } from '../src/core/rules.ts';
import { applyRoomEvent, awayDeps, landAll } from '../src/edge/room-events.ts';
import type { ApplyDeps } from '../src/edge/room-events.ts';
import { day, dev, hid } from './fixtures/ids.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import type { Asked, StashAsk } from '../src/core/sync/asked.ts';
import { owedAnswer, wordsOf } from '../src/core/sync/word.ts';
import type { MineWord } from '../src/core/sync/word.ts';
import { parseItem } from '../src/core/registry/items.ts';
import { REVIVE_HP } from '../src/core/hunter/vitals.ts';
import type { Life } from '../src/core/hunter/vitals.ts';
import { useItem } from '../src/core/hunter/use.ts';
import { soloAnswerBody, soloPlan, soloTaken } from '../src/core/gates/solo.ts';
import type { SoloRunPayload } from '../src/core/protocol.ts';
import { noticed } from '../src/core/hunter/noticed.ts';
import { den } from './models/gate-events.ts';
import { heldWeight, weightSpent } from '../src/core/table-weight.ts';

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
function phone(o: { conditions?: SheetStatus[]; fight?: boolean; level?: number; asked?: Asked[]; life?: Life; sheet?: Partial<Hunter>; room?: RoomCode } = {}) {
  const fresh = freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-player1') }, { onboarded: true });
  let save: Save = { ...fresh, hunters: fresh.hunters.map(h => ({ ...h, ...setLevel(h, o.level ?? 1, 0, RULES).progress, conditions: [...(o.conditions ?? [])], life: o.life ?? h.life, ...o.sheet })) };
  if (o.asked) save = { ...save, settings: { ...save.settings, sync: { ...save.settings.sync, asked: o.asked } } };
  if (o.room) save = { ...save, settings: { ...save.settings, sync: { ...save.settings.sync, room: o.room } } };
  let rules: Rules = RULES;
  const windows: { title: string; lines?: string[] }[] = [], toasts: string[] = [], shown: string[][] = [], completed: string[] = [], said: { title: string | undefined; body: string | undefined }[] = [];
  const deps: ApplyDeps = {
    store: { get: () => save },
    once: (eid, step) => { const next = appliedOnce(eid, step)(save); if (isRefused(next)) return false; save = next; return true; },
    rules: () => rules, now: () => AT, today: () => day(AT.slice(0, 10)),
    toast: (_tag, text) => { toasts.push(text); }, system: w => { windows.push(w); },
    hunter: {
      fightOf: () => (o.fight ? { at: 'gm' } : null),
      // hunter.js `granted`: its window is not opened when the caller asks for none (`popup: false`); the lines are answered either way
      granted: (_hid, g, opts) => { if (opts?.popup !== false) { shown.push(g.lines); said.push({ title: opts?.title, body: opts?.body }); } return { lines: g.lines, levelup: g.levelup, popup: null }; },
      gmHolds: () => { toasts.push(HELD); return refuse(TOLD); },
    },
    stepsDone: (_hid, done) => { completed.push(...done.map(d => d.quest.title)); },
    coinRuled: () => {},
  };
  const receive = (eid: number, type: string, payload: Raw): void => {
    const ev = parseEvent(type, { eid: e(eid), ...payload });
    if (!ev) throw new Error(`the ${type} event did not parse`);
    applyRoomEvent(ev, deps);
  };
  const status = (eid: number, grant: Raw): void => receive(eid, 'status', { to: ['d-player1:h1'], add: [grant], reason: '' });
  /** A poll page as sync.ts lands it (`landPage`): the held events and the page's in one write, then what it tells. */
  const page = (held: readonly RoomEvent[], events: readonly RoomEvent[], appOf?: (ev: RoomEvent) => ApplyDeps, app: ApplyDeps = deps): { held: RoomEvent[]; fresh: RoomEvent[] } => {
    const out = landAll(save, held, events, app, appOf);
    save = out.save;
    for (const tell of out.tells) tell();
    return { held: out.held, fresh: out.fresh };
  };
  return {
    page,
    get save(): Save { return save; },
    write: (step: (s: Save) => Save) => { save = step(save); },
    get hunter(): Hunter { return save.hunters[0]!; },
    get applied(): readonly EventId[] { return save.settings.sync.applied ?? []; },
    get asked(): readonly Asked[] { return save.settings.sync.asked ?? []; },
    useRules: (R: Rules) => { rules = R; },
    windows, toasts, shown, completed, said, receive, status, deps,
  };
}
type Raw = Record<string, unknown>;
const AT = '2026-11-14T12:00:00.000Z';
const monster = (tier: number): Source => ({ id: combatantId(`c-${tier}`), tier });
const BURNING = BUILT_IN_STATUSES.burning;
const burning = (tier: number, rounds: number | null): SheetStatus => ({ key: 'burning' as SheetStatus['key'], def: BURNING, source: monster(tier), rounds });

describe('the GM\'s table weight reaches a player\'s phone', () => {
  const AB = 'ABCD23' as RoomCode, H1 = hid('h1');
  const weigh = (total: number, force: 20 | 1 | null) => ({ to: ['d-player1:h1'], total, force });

  test('a weigh sets the hunter\'s weight for the room it came in, and tells nothing', () => {
    const p = phone({ room: AB });
    p.receive(1, 'weigh', weigh(2, 20));
    p.receive(2, 'weigh', weigh(-1, null));
    expect(heldWeight(p.save.settings.sync.weights, AB, H1)).toEqual({ total: -1, force: null });
    expect([p.windows, p.toasts]).toEqual([[], []]);
  });

  test('a weigh read again after a roll spent its force puts no force back: it lands once by its id', () => {
    const p = phone({ room: AB });
    p.receive(1, 'weigh', weigh(2, 20));
    p.write(s => weightSpent(s, AB, H1, '1d20+3'));
    p.receive(1, 'weigh', weigh(2, 20));
    expect(heldWeight(p.save.settings.sync.weights, AB, H1)).toEqual({ total: 2, force: null });
    expect(p.applied).toEqual([e(1)]);
  });

  test('a weigh for another phone\'s hunter writes nothing here', () => {
    const p = phone({ room: AB });
    p.receive(1, 'weigh', { to: ['d-player2:h1'], total: 3, force: null });
    expect([p.save.settings.sync.weights, p.applied]).toEqual([undefined, []]);
  });
});

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
  const VITALS = { to: ['d-player1:h1'], fight: 'f1', life: { at: 'up', hp: 12 }, mana: 3, fatigue: 20, statuses: [burning(2, 1.5)] };

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

  describe('totals that threw on this phone and are held (notes-5-trade.md 13, ruling 3)', () => {
    const totals = (n: number, hp: number) => parseEvent('vitals', { eid: e(n), ...VITALS, life: { at: 'up', hp }, statuses: [] })!;
    /** The phone's app as it is while this phone cannot apply a total: its rules break, so the total's applier throws. */
    const broken = (p: ReturnType<typeof phone>): ApplyDeps => ({ ...p.deps, rules: () => { throw new Error('this phone cannot apply it yet'); } });
    const quietly = <T>(f: () => T): T => { const warn = console.warn; console.warn = () => {}; try { return f(); } finally { console.warn = warn; } };

    test('an older total held on this phone is let go once a newer one for the hunter lands, so the hunter keeps the newer numbers', () => {
      const p = phone(), bad = broken(p);
      const first = quietly(() => p.page([], [totals(1, 12)], () => bad));
      expect(first.held.map(x => x.payload.eid), 'the first total threw and is held').toEqual([e(1)]);
      // the older total still cannot be applied when the newer one comes, and the newer one can
      const second = quietly(() => p.page(first.held, [totals(2, 30)], () => p.deps, bad));
      expect([p.hunter.life, second.held], 'the newer total landed, and the held older one is gone').toEqual([{ at: 'up', hp: 30 }, []]);
      p.page(second.held, []);
      expect([p.hunter.life, p.applied], 'once the phone could apply the older one, the hunter still has the newer total').toEqual([{ at: 'up', hp: 30 }, [e(2)]]);
    });

    test('a newer total that throws too takes the held older one\'s place, and lands alone with the next page', () => {
      const p = phone(), bad = broken(p);
      const first = quietly(() => p.page([], [totals(1, 12)], () => bad));
      const second = quietly(() => p.page(first.held, [totals(2, 30)], () => bad, bad));
      expect(second.held.map(x => x.payload.eid)).toEqual([e(2)]);
      p.page(second.held, []);
      expect([p.hunter.life, p.applied]).toEqual([{ at: 'up', hp: 30 }, [e(2)]]);
    });

    test('totals for two hunters are two things: a newer total for one leaves the other\'s held total to land', () => {
      const other = parseEvent('vitals', { eid: e(1), ...VITALS, to: ['d-player1:h2'], life: { at: 'up', hp: 9 }, statuses: [] })!;
      expect(hold(hold([], other), totals(2, 30)).map(x => x.payload.eid)).toEqual([e(1), e(2)]);
    });
  });

  test('another player\'s step or cast changes nothing on this phone', () => {
    const p = phone(), before = p.hunter;
    p.receive(1, 'step', { by: 'd-player2:h4', place: { x: 1, y: 1 }, at: 0 });
    p.receive(2, 'cast', { by: 'd-player2:h4', ability: 'strike', aim: 'c1', at: 0 });
    expect([p.hunter, p.toasts, p.applied]).toEqual([before, [], []]);
  });
});

describe('a hunter\'s life in the GM\'s fight reaches its sheet in the fight\'s totals', () => {
  const totals = (life: Life) => ({ to: ['d-player1:h1'], fight: 'f1', life, mana: 3, fatigue: 0, statuses: [] });
  const fresh = phone().hunter;
  /** The life facts the sheet recorded (chronicle.ts), as the Chronicle reads them. */
  const lifeFacts = (h: Hunter) => h.chronicle.inbox.flatMap(f => (f.kind === 'life' ? [{ news: f.news, how: f.how }] : []));

  test('a hit to 0 HP in the fight leaves the sheet dead, as the row is, and the player is told the ways back', () => {
    const p = phone({ fight: true });
    p.receive(1, 'vitals', { ...totals({ at: 'dead' }), reason: 'Goblin hits Kai' });
    expect(p.hunter.life).toEqual({ at: 'dead' });
    expect(p.toasts).toEqual(['You are dead. Goblin hits Kai The GM\'s Revive or a Resurrection Crystal brings you back.']);
    expect(lifeFacts(p.hunter).at(-1)).toEqual({ news: 'died', how: 'fight' });
  });

  // Fails today, so it waits as a todo: the GM's outbox keeps one total a hunter (protocol.ts `standsFor`), so the death
  // is let go and the sheet reads up to up: no death, no revive and no levels lost. Keeping a total of
  // each life state apart is a design call (it undoes unit 2's "a later total stands for an earlier one" and lets an older
  // held total land after a newer one); notes-dead-row.md section 10 has both ways. `bun test --todo` runs it.
  test.todo('a death then the GM\'s Revive posted while the room is away reach the sheet as a death and the GM\'s revive (notes-dead-row.md section 10, leftover 2)', () => {
    const dead = parseEvent('vitals', { eid: e(1), ...totals({ at: 'dead' }) })!, up = parseEvent('vitals', { eid: e(2), ...totals({ at: 'up', hp: REVIVE_HP }) })!;
    const box = [dead, up].reduce((b: Outbox, ev) => post(b, 'ABCD23' as RoomCode, { kind: 'event', event: ev }, standsFor(ev)).box, []);
    const p = phone({ fight: true, life: { at: 'up', hp: 5 } });
    for (const x of box) if (x.letter.kind === 'event') applyRoomEvent(x.letter.event, p.deps);
    expect(lifeFacts(p.hunter).slice(-2)).toEqual([{ news: 'died', how: 'fight' }, { news: 'raised', how: 'gm' }]);
  });

  test('the GM\'s Revive in the fight stands a dead sheet up at the row\'s HP, recorded as the GM\'s revive', () => {
    const p = phone({ fight: true, life: { at: 'dead' } });
    p.receive(1, 'vitals', totals({ at: 'up', hp: REVIVE_HP }));
    expect(p.hunter.life).toEqual({ at: 'up', hp: REVIVE_HP });
    expect(p.toasts).toEqual([`You are revived. ${raisedLine(1, 1)}.`]);
    expect(lifeFacts(p.hunter).at(-1)).toEqual({ news: 'raised', how: 'gm' });
  });

  test('the GM\'s Revive in the fight costs levels on the sheet, and the toast says how many', () => {
    const p = phone({ fight: true, level: 30, life: { at: 'dead' } });
    p.receive(1, 'vitals', totals({ at: 'up', hp: REVIVE_HP }));
    expect(p.hunter.level).toBeLessThan(30);
    expect(p.toasts).toEqual([`You are revived. ${raisedLine(30, p.hunter.level)}.`]);
  });

  test('the row\'s HP is written within the sheet\'s own maximum', () => {
    const p = phone({ fight: true });
    p.receive(1, 'vitals', totals({ at: 'up', hp: 1_000_000 }));
    expect(p.hunter.life).toEqual(fresh.life);
  });

  test('the room\'s Revive, sent for a hunter no fight held, writes nothing once the GM\'s fight holds it: the row holds the life', () => {
    const p = phone({ fight: true, life: { at: 'dead' } });
    p.receive(1, 'revive', { to: ['d-player1:h1'] });
    expect([p.hunter.life, p.toasts, p.applied]).toEqual([{ at: 'dead' }, [], [e(1)]]);
  });

  test('with no fight holding the hunter, the room\'s Revive stands a dead hunter up', () => {
    const p = phone({ life: { at: 'dead' } });
    p.receive(1, 'revive', { to: ['d-player1:h1'] });
    expect(p.hunter.life).toEqual({ at: 'up', hp: REVIVE_HP });
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

  test('a Resurrection Crystal the GM gives a dead hunter lands in its bag, and the hunter uses it to come back (the owner, Nov 19)', () => {
    const p = phone({ life: { at: 'dead' } });
    p.receive(1, 'award', { to: ['d-player1:h1'], rewards: { items: [{ name: 'Resurrection Crystal', rar: 'mythic', type: 'consumable', effects: [], revive: true, tell: true, value: 100000, qty: 1 }] } });
    const got = p.hunter.items.find(i => i.name === 'Resurrection Crystal');
    expect([p.hunter.life, got?.revive, p.applied]).toEqual([{ at: 'dead' }, true, [e(1)]]);
    const used = useItem(p.hunter, got!.id, [], RULES);
    expect(isRefused(used) ? used : used.hunter.life).toEqual({ at: 'up', hp: REVIVE_HP });
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

  test('a fight\'s facts the GM\'s phone noted land whole, once: the second delivery of the same event records nothing', () => {
    const p = phone(), facts = [{ kind: 'gate', name: 'Goblin Den', rank: 'E', above: 0, toBreak: 3 }, { kind: 'roll', natural: 20 }];
    p.receive(1, 'noted', { to: ['d-player1:h1'], facts });
    p.receive(1, 'noted', { to: ['d-player1:h1'], facts });
    expect(p.hunter.chronicle.inbox).toEqual(facts);
    expect(p.applied).toEqual([e(1)]);
  });

  test('a gate\'s Clear the GM\'s phone noted gives the player\'s hunter everything back and its rests, once', () => {
    const tired = phone({ life: { at: 'up', hp: 1 }, sheet: { mana: 0, fatigue: 40, restsTaken: RULES.rest.perGate } }), max = hunterSheet(tired.hunter, RULES).sheet;
    const gate = { kind: 'gate', name: 'Goblin Den', rank: 'E', above: 0, toBreak: 3 };
    tired.receive(1, 'noted', { to: ['d-player1:h1'], facts: [gate] });
    const h = tired.hunter;
    expect([h.life, h.mana, h.fatigue, h.restsTaken]).toEqual([{ at: 'up', hp: max.hpMax }, max.manaMax, 0, 0]);
    const kills = phone({ sheet: { restsTaken: 1 } });
    kills.receive(1, 'noted', { to: ['d-player1:h1'], facts: [{ kind: 'roll', natural: 20 }] });
    expect(kills.hunter.restsTaken, 'facts with no gate cleared give nothing back').toBe(1);
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
    try { polled = p.page([], [award, hp]); } finally { console.warn = warn; }
    expect(polled.held.map(x => x.payload.eid)).toEqual([e(1)]);
    expect(polled.fresh.map(x => x.payload.eid)).toEqual([e(1)]);
    expect(p.applied).toEqual([e(2)]);
    expect(parts(p.hunter).gold).toBe(before.gold);
    p.useRules(RULES);
    const next = p.page(polled.held, []);
    expect(next).toEqual({ held: [], fresh: [] });
    expect([parts(p.hunter).gold, parts(p.hunter).bonus, p.applied]).toEqual([before.gold + 30, before.bonus + 2, [e(2), e(1)]]);
    expect(p.page([award], [])).toEqual({ held: [], fresh: [] });
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

describe('a page of the room lands as one change (notes-5-trade.md 11.5)', () => {
  const award = (n: number, gold: number) => parseEvent('award', { eid: e(n), to: ['d-player1:h1'], rewards: { gold } })!;
  const told = parseEvent('system', { eid: e(9), title: 'A storm is coming', body: 'Take cover.' })!;

  test('every message of the page is on the save landAll answers, with its id, before anything is told; the tells then run in the room\'s order', () => {
    const p = phone(), save = p.deps.store.get(), gold = p.hunter.gold;
    const out = landAll(save, [], [award(1, 10), told, award(2, 5)], p.deps);
    expect([out.save.hunters[0]!.gold, out.save.settings.sync.applied, out.held, out.fresh]).toEqual([gold + 15, [e(1), e(2)], [], []]);
    expect([save.hunters[0]!.gold, p.windows, p.shown], 'the save it was given is as it was, and nothing was told').toEqual([gold, [], []]);
    for (const tell of out.tells) tell();
    expect([p.shown, p.windows.map(w => w.title)]).toEqual([[['+10 gold'], ['+5 gold']], ['A storm is coming']]);
  });

  test('a page landed again on the save it left gives nothing twice: its ids are on that save', () => {
    const p = phone(), gold = p.hunter.gold, page = [award(1, 10), award(2, 5)];
    p.page([], page);
    p.page([], page);
    expect([p.hunter.gold, p.applied, p.shown.length]).toEqual([gold + 15, [e(1), e(2)], 2]);
  });

  test('messages sent while this phone was out of the room are told as lines of one window, not a window each; the hunter is given each as live', () => {
    const p = phone(), gold = p.hunter.gold, lines: string[] = [], away = awayDeps(p.deps, lines);
    const quest = parseEvent('quest', { eid: e(3), to: ['d-player1:h1'], quest: { kind: 'side', title: 'The Den', desc: 'Clear it.' } })!;
    const hp = parseEvent('hp', { eid: e(4), to: ['d-player1:h1'], hp: 0, mana: 0, fatigue: 10, reason: 'A long march' })!;
    p.page([], [award(1, 10), told, quest, hp, award(2, 5)], ev => (ev.payload.eid === e(2) ? p.deps : away));
    expect(lines, 'a title in the System\'s upper case stays in its window: a line leaves it out').toEqual(['Reward: +10 gold', 'Notification: A storm is coming. Take cover.', 'Quest: The Den. GOAL: Clear it.', '+10 fatigue · A long march']);
    expect([p.windows, p.toasts], 'none of them opened a window or a toast of its own').toEqual([[], []]);
    expect(p.said, 'the award sent after the phone was back opens its own window, as live').toEqual([{ title: 'REWARD RECEIVED', body: 'The System has delivered a reward.' }]);
    expect([p.hunter.gold, p.hunter.quests.some(q => q.title === 'The Den'), p.applied]).toEqual([gold + 15, true, [e(1), e(3), e(4), e(2)]]);
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

describe('a chapter the GM opened lands whole, once (notes-1-stories.md 4.2)', () => {
  const TITLE = 'THE DEEP ASKS FOR A GATE', LINE = 'Any gate of your rank.', DUE = '2026-11-16T12:00:00.000Z';
  const CHAPTER = {
    to: ['d-player1:h1'], words: { title: TITLE, line: LINE }, rewards: { gold: 30, statuses: [{ key: 'hasted', rounds: 3 }] },
    quest: { kind: 'urgent', title: 'Clear a gate for the Deep', desc: '', objectives: [{ label: 'Gate cleared', target: 1, progress: 0 }], rewards: { gold: 100 }, dueAt: DUE, penaltyText: '' },
  };
  const deepQuest = (h: Hunter) => h.quests.find(q => q.title === 'Clear a gate for the Deep');

  test('the reward, the quest from the GM due when the GM\'s phone said, and the chapter\'s fact, in one write; the chapter\'s own window; a second delivery writes nothing', () => {
    const p = phone(), before = p.hunter;
    p.receive(1, 'chapter', CHAPTER);
    p.receive(1, 'chapter', CHAPTER);
    const q = deepQuest(p.hunter)!;
    expect([p.hunter.gold, p.hunter.conditions.map(c => c.key), p.hunter.quests.length, q.from, q.status, q.dueAt]).toEqual([before.gold + 30, ['hasted'], before.quests.length + 1, 'gm', 'active', DUE]);
    expect(p.hunter.chronicle.inbox.filter(f => f.kind === 'chapter' || f.kind === 'given'), 'a chapter, never an award for roleplay').toEqual([{ kind: 'chapter', title: TITLE, line: LINE }]);
    expect([p.said, p.shown, p.applied]).toEqual([[{ title: TITLE, body: LINE }], [['+30 gold', 'Status: Hasted (3 rounds)', 'Quest: Clear a gate for the Deep']], [e(1)]]);
  });

  test('a chapter of words alone shows its window and records its fact, and issues no quest', () => {
    const p = phone(), quests = p.hunter.quests.length;
    p.receive(1, 'chapter', { to: ['d-player1:h1'], words: { title: TITLE, line: LINE }, rewards: {}, quest: null });
    expect([p.hunter.quests.length, p.said, p.shown]).toEqual([quests, [{ title: TITLE, body: LINE }], [[]]]);
  });

  test('while the GM\'s fight holds the hunter, the chapter\'s status is left for the fight and the rest lands', () => {
    const p = phone({ fight: true }), before = p.hunter;
    p.receive(1, 'chapter', CHAPTER);
    expect([p.hunter.gold, p.hunter.conditions, deepQuest(p.hunter)?.from]).toEqual([before.gold + 30, [], 'gm']);
    expect(p.shown[0]).not.toContain('Status: Hasted (3 rounds)');
  });
});

describe('the GM\'s answer to a stash ask lands once, only while its ask waits (notes-5-trade.md 3.3)', () => {
  const ASK = 'd-player1-ask1' as EventId;
  const potions = (n: number) => ({ gold: 0, items: [{ from: 'i3' as never, item: { ...parseItem({ name: 'Healing Potion', type: 'consumable' })!, qty: n } }] });
  const asked = (ask: StashAsk): Asked => ({ id: ASK, room: 'ABCD23' as never, hid: 'h1' as never, kind: 'stash', ask, at: AT, state: 'taken', sent: true });
  const count = (h: Hunter) => h.items.filter(i => i.name === 'Healing Potion').reduce((n, i) => n + i.qty, 0);

  test('a stash answer lands once, only while its ask waits: given goods reach the bag once; a replay or a second GM phone\'s answer gives nothing', () => {
    const p = phone({ asked: [asked({ kind: 'take', item: 'i50' as never, qty: 1, name: 'Healing Potion' })] }), before = count(p.hunter);
    const GIVEN = { to: ['d-player1:h1'], ask: ASK, verdict: 'given', goods: potions(1) };
    p.receive(1, 'stashAnswer', GIVEN);
    expect([count(p.hunter) - before, p.asked, p.toasts]).toEqual([1, [], ['From the stash: 1 Healing Potion.']]);
    p.receive(1, 'stashAnswer', GIVEN);
    p.receive(2, 'stashAnswer', GIVEN);
    expect([count(p.hunter) - before, p.toasts.length]).toEqual([1, 1]);
    const q = phone(), none = count(q.hunter);
    q.receive(1, 'stashAnswer', GIVEN);
    expect([count(q.hunter), q.toasts], 'no ask waits on this phone: nothing lands').toEqual([none, []]);
  });

  test('a kept put leaves the ask and moves nothing more; a refused put brings its goods back with why', () => {
    const p = phone({ asked: [asked({ kind: 'put', goods: potions(2) })] }), before = count(p.hunter);
    p.receive(1, 'stashAnswer', { to: ['d-player1:h1'], ask: ASK, verdict: 'kept' });
    expect([count(p.hunter), p.asked, p.toasts]).toEqual([before, [], ['In the stash: Healing Potion × 2.']]);
    const q = phone({ asked: [asked({ kind: 'put', goods: potions(2) })] });
    q.receive(1, 'stashAnswer', { to: ['d-player1:h1'], ask: ASK, verdict: 'refused', why: 'full', have: 40 });
    expect([count(q.hunter) - before, q.asked]).toEqual([2, []]);
    expect(q.toasts).toEqual(['The stash is full. Take something out of it first. Back in your bag: Healing Potion × 2.']);
  });
});

describe('the GM\'s answer to a word lands once in the thread (notes-5-trade.md 4.4)', () => {
  const WORD = 'd-player1-word1' as EventId;
  const sent: MineWord = { side: 'mine', id: WORD, room: 'ABCD23' as never, hid: 'h1' as never, at: AT, text: 'Can my shadow scout the gate?', state: { is: 'landed' } };
  const BACK = { to: ['d-player1:h1'], re: WORD, text: 'Yes. Roll Perception when it comes back.' };

  test('an answer lands once in the thread: a replay, a page read again or a second GM phone\'s answer adds nothing, and its window is owed once', () => {
    const p = phone();
    p.write(s => ({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, words: [sent] } } }));
    p.receive(1, 'wordBack', BACK);
    const thread = () => wordsOf(p.save).map(w => (w.side === 'mine' ? [w.text, w.state.is, 'answer' in w.state ? w.state.answer.text : null] : null));
    expect([thread(), p.applied, owedAnswer(p.save)?.id]).toEqual([[[sent.text, 'answered', BACK.text]], [e(1)], WORD]);
    p.receive(1, 'wordBack', BACK);
    p.page([], [parseEvent('wordBack', { eid: e(1), ...BACK })!]);
    p.receive(2, 'wordBack', { ...BACK, text: 'No.' });
    expect(thread()).toEqual([[sent.text, 'answered', BACK.text]]);
    expect([p.toasts, p.windows], 'the window is the Room view\'s, opened while the save owes it').toEqual([[], []]);
  });

  test('an answer to a word this phone never sent lands nothing', () => {
    const p = phone(), before = p.save;
    p.receive(1, 'wordBack', BACK);
    expect([wordsOf(p.save), p.save.hunters]).toEqual([[], before.hunters]);
  });
});

describe('the GM\'s answer to a solo run lands whole, once a run (notes-2-solo.md section 5)', () => {
  const RUN = 'd-player1-run1' as EventId;
  const waiting = (): Extract<Asked, { kind: 'solo' }> => ({ id: RUN, room: 'ABCD23' as never, hid: 'h1' as never, kind: 'solo', gate: 'g12' as never, name: 'Goblin Den', at: AT, state: 'taken', sent: true });
  const PAID = { to: ['d-player1:h1'], run: RUN, gate: 'g12', name: 'Goblin Den', verdict: 'cleared' };

  test('a cleared answer closes the waiting run in its write and tells GATE CLEARED at once; its reward waits for the GM and is not given here (ruling 20)', () => {
    const p = phone({ asked: [waiting()] }), before = p.hunter;
    p.receive(1, 'soloAnswer', PAID);
    expect([p.hunter.xp, p.hunter.gold]).toEqual([before.xp, before.gold]);
    expect([p.asked, p.applied]).toEqual([[], [e(1)]]);
    expect(p.windows.map(w => [w.title, w.lines])).toEqual([['GATE CLEARED', ['Waiting for the GM']]]);
  });

  test('a second answer to the same run (a second GM phone, or the same one again) gives nothing', () => {
    const p = phone({ asked: [waiting()] });
    p.receive(1, 'soloAnswer', PAID);
    p.receive(2, 'soloAnswer', PAID);
    p.receive(1, 'soloAnswer', PAID);
    expect([p.windows.length, p.asked]).toEqual([1, []]);
  });

  test('a refused answer closes the run with its words and gives nothing; an answer for no waiting run changes nothing', () => {
    const p = phone({ asked: [waiting()] }), xp = p.hunter.xp;
    p.receive(1, 'soloAnswer', { ...PAID, verdict: 'refused', why: 'taken' });
    expect([p.asked, p.hunter.xp]).toEqual([[], xp]);
    expect(p.windows.map(w => [w.title, w.lines])).toEqual([['GATE TAKEN', ['Another hunter cleared this gate first. Your run\'s cost stays.']]]);
    const q = phone();
    q.receive(1, 'soloAnswer', PAID);
    expect([q.hunter.xp, q.shown, q.windows]).toEqual([xp, [], []]);
  });

  // A won run the GM's phone pays is that gate's Clear for the player's hunter (gates/solo.ts `soloTaken`), so it counts
  // toward the gates a hunter cleared as the GM's Clear does: the fact is `{ kind: 'gate' }`, its rank the gate's, its
  // `above` against the lowest rank (the GM's phone has no pushed sheet of the hunter), `toBreak` the days to day 5.
  test('a run the GM\'s phone paid counts as a gate cleared on the player\'s phone, as the GM\'s Clear does', () => {
    const room = 'ABCD23' as never, fresh = freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-gm1') }, { onboarded: true });
    const gm: Save = { ...fresh, gates: [{ ...den('detected'), solo: true }] };
    const run: SoloRunPayload = { eid: RUN, by: 'd-player1:h1' as never, gate: 'g-den' as never, name: 'Mira', outcome: 'won', rounds: 4, life: 'up' };
    const plan = soloPlan(gm, run, RULES), loot = { gold: 0, items: [] }, body = soloAnswerBody(gm, RUN, run, plan)!;
    const at = { at: AT, today: day(AT.slice(0, 10)), R: RULES };
    const taken = soloTaken(gm, run, plan, parseEvent('soloAnswer', { ...body, eid: e(1) }), loot, { day: at, room: { code: room, stamp: { device: 'd-gm1', now: Date.parse(AT), rand: 0.5 } }, rank: null });
    if (isRefused(taken)) throw new Error(`refused: ${taken.why}`);
    const posted = (taken.settings.sync.outbox ?? []).flatMap(x => (x.letter.kind === 'event' ? [x.letter.event] : []));
    const p = phone({ asked: [{ ...waiting(), gate: 'g-den' as never }] });
    p.page([], posted);
    const after = noticed(p.deps.store.get(), () => ({ ...at, session: 1, held: () => false, feats: [] }));
    expect(after.hunters[0]!.chronicle.facts.filter(f => f.kind === 'gate')).toMatchObject([{ kind: 'gate', name: 'Goblin Den', rank: 'E', above: 0, toBreak: 4 }]);
    expect(after.hunters[0]!.chronicle.tally.gates).toBe(1);
  });
});
