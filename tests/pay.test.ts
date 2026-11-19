// What a fight's end and a gate's Clear pay (src/core/gates/pay.ts): each one step, all of it or nothing.
import { describe, expect, test } from 'bun:test';
import { clearShares, dropDealt, encounterAwards, gateFact, planEncounter, settleClear, settleEncounter, splitAward } from '../src/core/gates/pay.ts';
import { remoteFacts } from '../src/core/combat/fight-facts.ts';
import { loadSave } from '../src/core/save.ts';
import type { Payee } from '../src/core/gates/pay.ts';
import { reduce, fightId } from '../src/core/combat/fight.ts';
import type { Ended } from '../src/core/combat/fight-types.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { hunterRow, remoteRow } from '../src/core/combat/rows.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import type { Save } from '../src/core/save.ts';
import { newEvent, parseSheetKey } from '../src/core/protocol.ts';
import type { RoomCode, RoomEvent } from '../src/core/protocol.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { RULES } from '../src/core/rules.ts';
import { newRewards } from '../src/core/rewards.ts';
import { den } from './models/gate-events.ts';
import { day, dev, gid } from './fixtures/ids.ts';

const AT = '2026-11-14T10:00:00.000Z', DAY = { at: AT, today: day('2026-11-14'), R: RULES };
const ROOM = 'ABCD23' as RoomCode, KAI = parseSheetKey('d-p1:h1')!;
const NONE = { gold: 0, items: [] }, HOARD = { gold: 75, items: [] };
/** The Goblin Den's roster: three goblins of 25 XP and a hobgoblin of 75. */
const xpOf = (id: string): number => (id === 'm-goblin' ? 25 : id === 'm-hob' ? 75 : 0);
const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };

/**
 * A GM's save in the Goblin Den's fight, ended: this phone's hunter, Kai on a player's phone, and a goblin that went
 * down for 60 XP. The fight's rows are real rows; only its summary is set, as `end` would after the goblin fell.
 */
function inDen(xpPaid = 0): Save {
  const s = freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-gm') }, { onboarded: true }), h = s.hunters[0]!;
  const ctx = { rules: RULES, life: () => h.life };
  const rows = [hunterRow(h, combatantId('c1'), RULES), remoteRow({ ...newHunter(RULES), id: 'h1', name: 'Kai' }, KAI, combatantId('c2'), RULES),
    { ...hunterRow({ ...newHunter(RULES), id: 'x', name: 'Goblin' }, combatantId('c3'), RULES), side: 'foe' as const, holder: null, name: 'Goblin', xp: 60 }];
  const added = reduce(null, { type: 'add', fightId: fightId('f-den'), rows, openings: [] }, ctx).fight;
  const run = reduce(added, { type: 'start', openings: rows.map(r => ({ id: r.id, d20: 10, tie: 0 })) }, ctx).fight;
  const ended = reduce(run, { type: 'end' }, ctx).fight as Ended;
  const fight: Ended = { ...ended, summary: { ...ended.summary, xp: 60, down: [combatantId('c3')] } };
  return { ...s, fight, fightRefs: { gate: gid('g-den'), monsters: {} }, gates: [den('detected', xpPaid)] };
}
const award = (xp: number, to = KAI): RoomEvent => newEvent('award', { to: [to], rewards: { ...newRewards(), xp } }, { device: 'd-gm', now: 1, rand: 0.25 })!;
/** The outbox's messages: each award's type, whom it is for and its XP. */
const events = (s: Save) => (s.settings.sync.outbox ?? []).map(e => (e.letter.kind === 'event' && e.letter.event.type === 'award' ? [e.room, e.letter.event.payload.to, e.letter.event.payload.rewards.xp] : e.letter));

describe('one award over the payees', () => {
  test('split evenly and rounded down when the rules split, all of it to each when not, nothing for nobody', () => {
    expect([splitAward(60, 2, true), splitAward(61, 2, true), splitAward(60, 2, false), splitAward(60, 0, true), splitAward(7, 1, true)]).toEqual([30, 30, 60, 0, 7]);
  });
});

describe('the end of a fight', () => {
  test('the plan: the gate still owes XP, so the fight pays its 60, 30 to each of the two hunters, this phone\'s first', () => {
    const s = inDen(), plan = planEncounter(s.fight as Ended, 'g-den', s, true, xpOf);
    expect([plan.xp, plan.award, plan.covered, plan.each]).toEqual([60, 60, false, 30]);
    expect(plan.payees).toEqual([{ kind: 'local', hid: s.hunters[0]!.id, name: s.hunters[0]!.name }, { kind: 'remote', key: KAI, name: 'Kai' }]);
    expect(plan.dead.map(d => [d.name, d.xp])).toEqual([['Goblin', 60]]);
    expect(encounterAwards(plan, 'award')).toEqual([{ to: [KAI], rewards: { ...newRewards(), xp: 30 } }]);
    expect(encounterAwards(plan, 'skip')).toEqual([]);
  });

  test('a gate that paid all its 150 XP already pays nothing more from the fight', () => {
    const s = inDen(150), plan = planEncounter(s.fight as Ended, 'g-den', s, true, xpOf);
    expect([plan.award, plan.covered, plan.each]).toEqual([0, true, 0]);
  });

  test('Award XP in one step: the gate paid 60, this phone\'s hunter +30 XP, Kai\'s award in the outbox, the log line, the fight gone', () => {
    const s = inDen(), plan = planEncounter(s.fight as Ended, 'g-den', s, true, xpOf), h = s.hunters[0]!;
    const out = ok(settleEncounter(s, plan, 'award', { room: ROOM, events: [award(30)] }, DAY, NONE));
    expect(out.save.gates[0]!.xpPaid).toBe(60);
    expect(out.save.gates[0]!.fought).toEqual([h.id, KAI]);
    expect(out.save.hunters[0]!.xp).toBe(h.xp + 30);
    expect(out.granted.map(g => g.hid)).toEqual([h.id]);
    expect(events(out.save)).toEqual([[ROOM, [KAI], 30]]);
    expect(out.save.fight).toBeNull();
    expect(out.save.fightRefs).toBeUndefined();
    expect(out.save.log.map(l => l.text)).toContain('1 defeated, 60 XP awarded (30 each).');
  });

  test('a fight settled is gone, so settling it again (a second tap, a stale window, a reload) is refused and changes nothing', () => {
    const s = inDen(), plan = planEncounter(s.fight as Ended, 'g-den', s, true, xpOf);
    const once = ok(settleEncounter(s, plan, 'award', { room: ROOM, events: [award(30)] }, DAY, NONE)).save;
    expect(settleEncounter(once, plan, 'award', { room: ROOM, events: [award(30)] }, DAY, NONE)).toEqual({ ok: false, why: 'no-fight' });
  });

  test('a fight still on is not settled: the view ends it first, so a reload between the end and the settle loses nothing', () => {
    const s = inDen(), running = { ...s, fight: { ...(s.fight as Ended), phase: 'running' } } as unknown as Save;
    expect(settleEncounter(running, planEncounter(s.fight as Ended, 'g-den', s, true, xpOf), 'award', { room: ROOM, events: [] }, DAY, NONE)).toEqual({ ok: false, why: 'no-fight' });
  });

  test('End without XP: nothing paid, nothing posted, the log says so, the fight gone', () => {
    const s = inDen(), plan = planEncounter(s.fight as Ended, 'g-den', s, true, xpOf), h = s.hunters[0]!;
    const out = ok(settleEncounter(s, plan, 'skip', { room: ROOM, events: [award(30)] }, DAY, NONE)).save;
    expect([out.gates[0]!.xpPaid, out.hunters[0]!.xp, events(out), out.fight]).toEqual([0, h.xp, [], null]);
    expect(out.log[0]!.text).toBe('1 defeated, 60 XP.');
  });

  test('what the fight dropped stays on the save after the settle, read back after a reload, until the GM gives it or sets it aside', () => {
    const s = inDen(), plan = planEncounter(s.fight as Ended, 'g-den', s, true, xpOf);
    const out = ok(settleEncounter(s, plan, 'skip', { room: ROOM, events: [] }, DAY, HOARD)).save;
    expect(out.dropped).toEqual(HOARD);
    const env = { now: new Date(AT), newDeviceId: () => 'd-x' as never, newDeviceToken: () => 't' };
    expect(loadSave({ v4: JSON.stringify(out), v3: null, v2: null, v1: null }, env).save.dropped).toEqual(HOARD);
    expect(dropDealt(out).dropped).toBeNull();
    expect(ok(settleEncounter(s, plan, 'skip', { room: ROOM, events: [] }, DAY, NONE)).save.dropped).toBeNull();
  });

  test('the step leaves the save it was given as it was', () => {
    const s = inDen(), copy = JSON.stringify(s), plan = planEncounter(s.fight as Ended, 'g-den', s, true, xpOf);
    settleEncounter(s, plan, 'award', { room: ROOM, events: [award(30)] }, DAY, NONE);
    expect(JSON.stringify(s)).toBe(copy);
  });
});

describe('a gate\'s Clear', () => {
  const payees = (s: Save): Payee[] => [{ kind: 'local', hid: s.hunters[0]!.id, name: 'Mira' }, { kind: 'remote', key: KAI, name: 'Kai' }];
  test('the shares: the 150 XP due and 40 gold split over two, the items to the one picked', () => {
    const s = inDen(), sh = clearShares(s, 'g-den', xpOf, 40, ['Fang'], payees(s), KAI, true)!;
    expect(sh.due).toBe(150);
    expect(sh.shares.map(x => [x.payee.name, x.xp, x.gold, x.items])).toEqual([['Mira', 75, 20, []], ['Kai', 75, 20, ['Fang']]]);
    expect(clearShares(s, 'g-den', xpOf, 40, ['Fang'], payees(s).slice(0, 1), null, true)!.shares.map(x => [x.xp, x.gold, x.items])).toEqual([[150, 40, ['Fang']]]);
    expect(clearShares(s, 'nope', xpOf, 0, [], [], null, true)).toBeNull();
  });

  test('cleared in one step: the gate paid what it owed and cleared, this phone\'s hunter given its share, Kai\'s award posted', () => {
    const s = { ...inDen(), fight: null }, h = s.hunters[0]!;
    const out = ok(settleClear(s, 'g-den', { due: 150, xp: 75, gold: 20, items: [], payees: ['Mira', 'Kai'] },
      [{ hid: h.id, rewards: { ...newRewards(), xp: 75, gold: 20 } }], { room: ROOM, events: [award(75)] }, DAY));
    expect([out.save.gates[0]!.status, out.save.gates[0]!.xpPaid, out.save.hunters[0]!.xp, out.save.hunters[0]!.gold]).toEqual(['cleared', 150, h.xp + 75, h.gold + 20]);
    expect(events(out.save)).toEqual([[ROOM, [KAI], 75]]);
    const g = s.gates[0]!;
    expect(out.save.hunters[0]!.chronicle.inbox[0], 'the gate cleared is a fact of the payee\'s chronicle').toEqual({ kind: 'gate', name: g.name, rank: g.rank, above: 0, toBreak: Math.max(0, g.breakDay - s.world.day) });
  });
});

describe('a player\'s hunter whose sheet is not on the GM\'s phone', () => {
  test('its gate cleared and its fight are measured against the lowest rank, E, as a hunter of rank E would be', () => {
    const g = { ...den('detected'), rank: 'C' as const };
    expect(gateFact(g, null, 2)).toEqual(gateFact(g, 'E', 2));
    expect(gateFact(g, null, 2)).toMatchObject({ kind: 'gate', rank: 'C', above: 2 });
    expect(gateFact(g, 'C', 2)).toMatchObject({ above: 0 });
    const f = inDen().fight as Ended;
    expect(remoteFacts(f, () => null, 'Den')).toEqual(remoteFacts(f, () => 'E', 'Den'));
    expect(remoteFacts(f, () => null, 'Den').map(n => n.to)).toEqual([KAI]);
  });
});
