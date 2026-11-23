// What a fight's end and a gate's Clear pay (src/core/gates/pay.ts): each one step, all of it or nothing.
import { describe, expect, test } from 'bun:test';
import { LOOT_EVENTS, LOOT_STATES, clearGoldEach, clearShares, dropDealt, dropLine, encounterAwards, gateFact, lootOffered, lootStep, planEncounter, settleClear, settleClearPreset, settleEncounter, shareEach } from '../src/core/gates/pay.ts';
import { gatePreset } from '../src/core/gates/preset.ts';
import { waitingIn } from '../src/core/hunter/pending.ts';
import { presetLineId } from '../src/core/ids.ts';
import { parseItem } from '../src/core/registry/items.ts';
import { STASH_LINES } from '../src/core/protocol.ts';
import type { LootEvent } from '../src/core/gates/pay.ts';
import { remoteFacts } from '../src/core/combat/fight-facts.ts';
import { loadSave } from '../src/core/save.ts';
import type { Payee } from '../src/core/gates/pay.ts';
import { reduce, fightId } from '../src/core/combat/fight.ts';
import type { Ended, NewRow } from '../src/core/combat/fight-types.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { hunterRow, remoteRow } from '../src/core/combat/rows.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import type { Dropped, FightLoot, Hunter, Save } from '../src/core/save.ts';
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
/** All the XP a hunter has gained: its levels' XP (`xpPerLevel` × level for each) and what it holds toward the next. */
const lifetimeXp = (h: Hunter): number => h.xp + Array.from({ length: h.level - 1 }, (_, i) => RULES.xpPerLevel * (i + 1)).reduce((a, b) => a + b, 0);
const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };

/**
 * A GM's save in the Goblin Den's fight, ended: this phone's hunter, Kai on a player's phone, and a goblin that went
 * down for 60 XP. The fight's rows are real rows; only its summary is set, as `end` would after the goblin fell.
 */
function inDen(xpPaid = 0, id = 'f-den'): Save {
  const s = freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-gm') }, { onboarded: true }), h = s.hunters[0]!;
  const ctx = { rules: RULES };
  const rows = [hunterRow(h, combatantId('c1'), RULES), remoteRow({ ...newHunter(RULES), id: 'h1', name: 'Kai' }, KAI, combatantId('c2'), RULES),
    { ...hunterRow({ ...newHunter(RULES), id: 'x', name: 'Goblin' }, combatantId('c3'), RULES), kind: 'monster', side: 'foe', holder: null, threat: {}, name: 'Goblin', xp: 60 } as NewRow];
  const added = reduce(null, { type: 'add', fightId: fightId(id), rows, openings: [] }, ctx).fight;
  const run = reduce(added, { type: 'start', openings: rows.map(r => ({ id: r.id, d20: 10, tie: 0 })) }, ctx).fight;
  const ended = reduce(run, { type: 'end' }, ctx).fight as Ended;
  const fight: Ended = { ...ended, summary: { ...ended.summary, xp: 60, down: [combatantId('c3')] } };
  return { ...s, fight, fightRefs: { gate: gid('g-den'), monsters: {} }, gates: [den('detected', xpPaid)] };
}
const award = (xp: number, to = KAI): RoomEvent => newEvent('award', { to: [to], rewards: { ...newRewards(), xp } }, { device: 'd-gm', now: 1, rand: 0.25 })!;
/** The outbox's messages: each award's type, whom it is for and its XP. */
/** The room of a Clear that paid Kai, whose sheet is not on this phone, an award of 75 XP. */
const KAI_PAID = { code: ROOM, stamp: { device: 'd-gm', now: 2, rand: 0.5 }, players: [{ key: KAI, rank: null, pays: award(75) }] };
const events = (s: Save) => (s.settings.sync.outbox ?? []).map(e => (e.letter.kind === 'event' && e.letter.event.type === 'award' ? [e.room, e.letter.event.payload.to, e.letter.event.payload.rewards.xp] : e.letter));

/** The party a world gate is made for (`RULES.gateParty`, design 4.1): the expected values below are worked out for 4. */
const PARTY = RULES.gateParty;
/** `n` hunters on this phone, for a Clear's payees. */
const many = (n: number): Payee[] => Array.from({ length: n }, (_, i): Payee => ({ kind: 'local', hid: `h${i}`, name: `Hunter ${i}` }));

describe('a world gate\'s pot over the payees', () => {
  test('the gate is made for a party of 4', () => {
    expect(PARTY).toBe(4);
  });

  test('each of n takes floor(amount × party × min(1, party / n) / n): 400, 200, 133, 100, 64, 44 of 100 for 1 to 6, nothing for nobody', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(n => shareEach(100, n, PARTY))).toEqual([0, 400, 200, 133, 100, 64, 44]);
  });

  test('a party of the gate\'s size takes the amount each, one hunter the party times it, and past the party the total falls', () => {
    expect(shareEach(325, PARTY, PARTY)).toBe(325);
    expect(shareEach(325, 1, PARTY)).toBe(325 * PARTY);
    const total = (n: number) => n * shareEach(1300, n, PARTY);
    expect([1, 2, 3, 4].map(total)).toEqual([5200, 5200, 5199, 5200]);
    expect([5, 6].map(total)).toEqual([4160, 3462]);
  });

  test('the party is the rule\'s: a gate made for 2 pays one hunter twice the amount and a third hunter shrinks the pot', () => {
    expect([1, 2, 3].map(n => shareEach(90, n, 2))).toEqual([180, 90, 40]);
  });
});

describe('the end of a fight', () => {
  test('the plan: the gate still owes XP, so the fight pays its 60 as the gate\'s pot, 120 to each of the two hunters, this phone\'s first', () => {
    const s = inDen(), plan = planEncounter(s.fight as Ended, 'g-den', s, PARTY, xpOf);
    expect([plan.xp, plan.award, plan.covered, plan.shared, plan.each]).toEqual([60, 60, false, true, 120]);
    expect(plan.payees).toEqual([{ kind: 'local', hid: s.hunters[0]!.id, name: s.hunters[0]!.name }, { kind: 'remote', key: KAI, name: 'Kai' }]);
    expect(plan.dead.map(d => [d.name, d.xp])).toEqual([['Goblin', 60]]);
    expect(encounterAwards(plan, 'award')).toEqual([{ to: [KAI], rewards: { ...newRewards(), xp: 120 } }]);
    expect(encounterAwards(plan, 'skip')).toEqual([]);
  });

  test('a fight started from no gate is the GM\'s own scene: each hunter takes the whole 60 XP of what went down', () => {
    const s = { ...inDen(), fightRefs: undefined }, plan = planEncounter(s.fight as Ended, null, s, PARTY, xpOf);
    expect([plan.award, plan.shared, plan.each]).toEqual([60, false, 60]);
    expect(encounterAwards(plan, 'award')).toEqual([{ to: [KAI], rewards: { ...newRewards(), xp: 60 } }]);
  });

  test('a gate that paid all its 150 XP already pays nothing more from the fight', () => {
    const s = inDen(150), plan = planEncounter(s.fight as Ended, 'g-den', s, PARTY, xpOf);
    expect([plan.award, plan.covered, plan.each]).toEqual([0, true, 0]);
  });

  test('Award XP in one step: the gate paid 60, this phone\'s hunter +120 XP, Kai\'s award in the outbox, the log line, the fight gone', () => {
    const s = inDen(), plan = planEncounter(s.fight as Ended, 'g-den', s, PARTY, xpOf), h = s.hunters[0]!;
    const out = ok(settleEncounter(s, plan, 'award', { room: ROOM, events: [award(120)] }, DAY, NONE));
    expect(out.save.gates[0]!.xpPaid, 'the gate\'s XP counts what went down, not what was paid out of it').toBe(60);
    expect(out.save.gates[0]!.fought).toEqual([h.id, KAI]);
    expect(lifetimeXp(out.save.hunters[0]!)).toBe(lifetimeXp(h) + 120);
    expect(out.granted.map(g => g.hid)).toEqual([h.id]);
    expect(events(out.save)).toEqual([[ROOM, [KAI], 120]]);
    expect(out.save.fight).toBeNull();
    expect(out.save.fightRefs).toBeUndefined();
    expect(out.save.log.map(l => l.text)).toContain('1 foe defeated, 60 XP. Awarded 120 XP each.');
  });

  test('a fight settled is gone, so settling it again (a second tap, a stale window, a reload) is refused and changes nothing', () => {
    const s = inDen(), plan = planEncounter(s.fight as Ended, 'g-den', s, PARTY, xpOf);
    const once = ok(settleEncounter(s, plan, 'award', { room: ROOM, events: [award(30)] }, DAY, NONE)).save;
    expect(settleEncounter(once, plan, 'award', { room: ROOM, events: [award(30)] }, DAY, NONE)).toEqual({ ok: false, why: 'no-fight' });
  });

  test('a fight still on is not settled: the view ends it first, so a reload between the end and the settle loses nothing', () => {
    const s = inDen(), running = { ...s, fight: { ...(s.fight as Ended), phase: 'running' } } as unknown as Save;
    expect(settleEncounter(running, planEncounter(s.fight as Ended, 'g-den', s, PARTY, xpOf), 'award', { room: ROOM, events: [] }, DAY, NONE)).toEqual({ ok: false, why: 'no-fight' });
  });

  test('End without XP: nothing paid, nothing posted, the log says so, the fight gone', () => {
    const s = inDen(), plan = planEncounter(s.fight as Ended, 'g-den', s, PARTY, xpOf), h = s.hunters[0]!;
    const out = ok(settleEncounter(s, plan, 'skip', { room: ROOM, events: [award(30)] }, DAY, NONE)).save;
    expect([out.gates[0]!.xpPaid, out.hunters[0]!.xp, events(out), out.fight]).toEqual([0, h.xp, [], null]);
    expect(out.log[0]!.text).toBe('1 foe defeated, 60 XP.');
  });

  test('what the fight dropped waits on the save after the settle, read back after a reload, until the GM gives it or sets it aside', () => {
    const s = inDen(), plan = planEncounter(s.fight as Ended, 'g-den', s, PARTY, xpOf);
    const out = ok(settleEncounter(s, plan, 'skip', { room: ROOM, events: [] }, DAY, HOARD)).save;
    expect(out.loot).toEqual({ at: 'waiting', drops: [{ fight: 'f-den', ...HOARD }] });
    const env = { now: new Date(AT), newDeviceId: () => 'd-x' as never, newDeviceToken: () => 't' };
    expect(loadSave({ v4: JSON.stringify(out), v3: null, v2: null, v1: null }, env).save.loot).toEqual(out.loot);
    expect(ok(dropDealt(out, fightId('f-den'))).loot).toEqual({ at: 'none' });
    expect(ok(settleEncounter(s, plan, 'skip', { room: ROOM, events: [] }, DAY, NONE)).save.loot, 'a fight that dropped nothing leaves nothing waiting').toEqual({ at: 'none' });
  });

  test('the step leaves the save it was given as it was', () => {
    const s = inDen(), copy = JSON.stringify(s), plan = planEncounter(s.fight as Ended, 'g-den', s, PARTY, xpOf);
    settleEncounter(s, plan, 'award', { room: ROOM, events: [award(30)] }, DAY, NONE);
    expect(JSON.stringify(s)).toBe(copy);
  });
});

describe('a gate\'s Clear', () => {
  const payees = (s: Save): Payee[] => [{ kind: 'local', hid: s.hunters[0]!.id, name: 'Mira' }, { kind: 'remote', key: KAI, name: 'Kai' }];
  test('the shares: the 150 XP due and 40 gold the pot of two, 300 XP and 80 gold each, the items to the one picked', () => {
    const s = inDen(), sh = clearShares(s, 'g-den', xpOf, 40, ['Fang'], payees(s), KAI, PARTY)!;
    expect(sh.due).toBe(150);
    expect(sh.shares.map(x => [x.payee.name, x.xp, x.gold, x.items])).toEqual([['Mira', 300, 80, []], ['Kai', 300, 80, ['Fang']]]);
    expect(clearShares(s, 'nope', xpOf, 0, [], [], null, PARTY)).toBeNull();
  });

  test('the 150 XP due and 100 gold rolled, at 1, 4 and 6 hunters: 600 and 400 alone, 150 and 100 each at the party, 66 and 44 each in a crowd', () => {
    const s = inDen(), at = (n: number) => clearShares(s, 'g-den', xpOf, 100, ['Fang'], many(n), null, PARTY)!;
    expect(at(1).shares.map(x => [x.xp, x.gold, x.items])).toEqual([[600, 400, ['Fang']]]);
    expect(at(4).shares.map(x => [x.xp, x.gold])).toEqual(many(4).map(() => [150, 100]));
    expect(at(6).shares.map(x => [x.xp, x.gold])).toEqual(many(6).map(() => [66, 44]));
    expect([1, 4, 6].map(n => at(n).due), 'the gate owes its 150 XP whoever it pays').toEqual([150, 150, 150]);
  });

  test('the Clear panel\'s gold each: the rank\'s lowest and highest roll shared among the hunters ticked', () => {
    const [low = NaN, high = NaN] = RULES.loot.D.gold;
    expect(clearGoldEach(RULES, 'D', 2)).toEqual({ low: low * 2, high: high * 2 });
    expect(clearGoldEach(RULES, 'D', PARTY)).toEqual({ low, high });
    expect(clearGoldEach(RULES, 'D', 6)).toEqual({ low: Math.floor(low * 16 / 36), high: Math.floor(high * 16 / 36) });
    expect(clearGoldEach(RULES, 'D', 0)).toEqual({ low: 0, high: 0 });
  });

  test('cleared in one step: the gate paid what it owed and cleared, this phone\'s hunter given its share, Kai\'s award posted, each with the gate as a fact', () => {
    const s = { ...inDen(), fight: null }, h = s.hunters[0]!;
    const out = ok(settleClear(s, 'g-den', { due: 150, xp: 75, gold: 20, items: [], payees: ['Mira', 'Kai'] },
      [{ hid: h.id, rewards: { ...newRewards(), xp: 75, gold: 20 } }], KAI_PAID, DAY));
    expect([out.save.gates[0]!.status, out.save.gates[0]!.xpPaid, out.save.hunters[0]!.xp, out.save.hunters[0]!.gold]).toEqual(['cleared', 150, h.xp + 75, h.gold + 20]);
    const g = s.gates[0]!, fact = { kind: 'gate', name: g.name, rank: g.rank, above: 0, toBreak: Math.max(0, g.breakDay - s.world.day) };
    expect(events(out.save)[0]).toEqual([ROOM, [KAI], 75]);
    expect(out.save.hunters[0]!.chronicle.inbox[0], 'the gate cleared is a fact of the payee\'s chronicle').toEqual(fact);
    const noted = (out.save.settings.sync.outbox ?? []).flatMap(e => (e.letter.kind === 'event' && e.letter.event.type === 'noted' ? [e.letter.event.payload] : []));
    expect(noted.map(n => [n.to, n.facts]), 'and of Kai\'s, told after its award').toEqual([[[KAI], [fact]]]);
  });

  test('a gate cleared once is not cleared again: a second Clear (a stale panel, a second tap) is refused and pays nobody', () => {
    const s = { ...inDen(), fight: null }, h = s.hunters[0]!;
    const pay = { due: 150, xp: 75, gold: 20, items: [], payees: ['Mira', 'Kai'] };
    const clear = (from: Save) => settleClear(from, 'g-den', pay, [{ hid: h.id, rewards: { ...newRewards(), xp: 75, gold: 20 } }], KAI_PAID, DAY);
    const once = ok(clear(s)).save;
    expect(clear(once)).toEqual({ ok: false, why: 'unchanged' });
    // a gate the GM closed cannot be cleared either (gate.ts: Clear applies to detected, raiding and broken gates)
    expect(clear({ ...s, gates: [den('closed', 0)] })).toEqual({ ok: false, why: 'unchanged' });
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

describe('a fight\'s loot waiting for the GM (SMX-gates-1)', () => {
  const A: Dropped = { fight: fightId('f-a'), gold: 900, items: [] }, B: Dropped = { fight: fightId('f-b'), gold: 75, items: [] };
  const NO_LOOT: FightLoot = { at: 'none' };
  test('every state answers every event: a drop is added after the ones waiting, never over them; dealing a drop takes that one alone', () => {
    const states: { readonly [S in FightLoot['at']]: FightLoot } = { none: NO_LOOT, waiting: { at: 'waiting', drops: [A] } };
    const events: { readonly [E in LootEvent['type']]: readonly LootEvent[] } = {
      dropped: [{ type: 'dropped', drop: B }, { type: 'dropped', drop: A }],
      dealt: [{ type: 'dealt', fight: A.fight }, { type: 'dealt', fight: B.fight }],
    };
    const table = Object.fromEntries(LOOT_STATES.map(s => [s, Object.fromEntries(LOOT_EVENTS.map(e => [e, events[e].map(ev => lootStep(states[s], ev))]))]));
    expect(table).toEqual({
      none: { dropped: [{ at: 'waiting', drops: [B] }, { at: 'waiting', drops: [A] }], dealt: [null, null] },
      waiting: { dropped: [{ at: 'waiting', drops: [A, B] }, null], dealt: [NO_LOOT, null] },
    });
    expect(lootStep({ at: 'waiting', drops: [A, B] }, { type: 'dealt', fight: A.fight })).toEqual({ at: 'waiting', drops: [B] });
  });

  test('loot the GM put off with Later survives the next fight\'s settle, with no loot or with its own, and the oldest is offered first (SMX-gates-1.3)', () => {
    const first = inDen(0, 'f-1'), plan1 = planEncounter(first.fight as Ended, 'g-den', first, PARTY, xpOf);
    const later = ok(settleEncounter(first, plan1, 'skip', { room: ROOM, events: [] }, DAY, { gold: 900, items: [] })).save;
    const second = { ...later, fight: inDen(0, 'f-2').fight, fightRefs: { gate: gid('g-den'), monsters: {} } };
    const plan2 = planEncounter(second.fight as Ended, 'g-den', second, PARTY, xpOf);
    const empty = ok(settleEncounter(second, plan2, 'skip', { room: ROOM, events: [] }, DAY, NONE)).save;
    expect(empty.loot).toEqual({ at: 'waiting', drops: [{ fight: 'f-1', gold: 900, items: [] }] });
    const both = ok(settleEncounter(second, plan2, 'skip', { room: ROOM, events: [] }, DAY, HOARD)).save;
    expect(both.loot).toEqual({ at: 'waiting', drops: [{ fight: 'f-1', gold: 900, items: [] }, { fight: 'f-2', ...HOARD }] });
    expect(lootOffered(both.loot)).toEqual({ fight: 'f-1', gold: 900, items: [] });
    expect(lootOffered(ok(dropDealt(both, fightId('f-1'))).loot)).toEqual({ fight: 'f-2', ...HOARD });
  });

  test('a drop dealt is gone, so dealing it again (Set aside twice, a send after a Set aside) is refused and changes nothing', () => {
    const s: Save = { ...inDen(), loot: { at: 'waiting', drops: [A] } };
    const once = ok(dropDealt(s, A.fight));
    expect(dropDealt(once, A.fight)).toEqual({ ok: false, why: 'no-drop' });
    expect(lootOffered(once.loot)).toBeNull();
  });

  test('a drop in one line: its gold, then each item with its count past one', () => {
    const shard = { ...({} as Dropped['items'][number]), name: 'Frost Shard', qty: 2 }, rope = { ...shard, name: 'Rope', qty: 1 };
    expect(dropLine({ gold: 1500, items: [shard, rope] }, n => n.toLocaleString('en-US'))).toBe('1,500 gold, Frost Shard ×2, Rope');
    expect(dropLine({ gold: 0, items: [] }, String)).toBe('');
  });
});

describe('a gate\'s Clear with a preset (settleClearPreset)', () => {
  const POTION = parseItem({ name: 'Health Potion', type: 'consumable', rar: 'common' })!;
  const SWORD = parseItem({ name: 'Iron Blade', type: 'weapon', slot: 'weapon', dice: '1d8', rar: 'uncommon' })!;
  const DAGGER = parseItem({ name: 'Rusty Dagger', type: 'weapon', slot: 'weapon', dice: '1d4', rar: 'common' })!;

  const withPreset = (s: Save): Save => {
    const rec = ok(gatePreset(s, gid('g-den'), {
      type: 'recommend', xp: 220, gold: 90,
      items: [
        { id: presetLineId(1), item: SWORD, checked: true, to: { kind: 'remote', remote: KAI } },
        { id: presetLineId(2), item: POTION, checked: true, to: null },
        { id: presetLineId(3), item: DAGGER, checked: false, to: { kind: 'local', hunterId: s.hunters[0]!.id } },
      ],
    }));
    return ok(gatePreset(rec, gid('g-den'), { type: 'setGold', gold: 120 }));
  };

  test('in a room: clears the gate, locks preset paid, stashes unpicked checked items, omits unchecked, and queues pending clear rewards without sending award yet', () => {
    const s = withPreset({ ...inDen(), fight: null }), h = s.hunters[0]!;
    const payees: Payee[] = [{ kind: 'local', hid: h.id, name: h.name }, { kind: 'remote', key: KAI, name: 'Kai' }];
    const room = { code: ROOM, stamp: { device: 'd-gm', now: 1000, rand: 0.25 }, ranks: new Map([[KAI, 'E' as const]]) };
    const out = ok(settleClearPreset(s, gid('g-den'), xpOf, payees, room, DAY));

    expect([out.save.gates[0]!.status, out.save.gates[0]!.preset.at]).toEqual(['cleared', 'paid']);
    expect(out.granted).toEqual([]);
    expect([out.save.hunters[0]!.xp, out.save.hunters[0]!.gold], 'nothing granted directly in a room').toEqual([h.xp, h.gold]);
    expect(out.save.stash.items.map(i => i.name), 'unpicked checked item went to party stash').toEqual(['Health Potion']);
    expect(out.stashed.map(i => i.name)).toEqual(['Health Potion']);

    const waiting = waitingIn(out.save, ROOM);
    expect(waiting.map(w => [w.name, w.from, w.what, w.rewards.xp, w.rewards.gold, w.rewards.items.map(i => i.name)])).toEqual([
      [h.name, 'clear', 'Goblin Den', 220, 120, []],
      ['Kai', 'clear', 'Goblin Den', 220, 120, ['Iron Blade']],
    ]);
    const boxTypes = (out.save.settings.sync.outbox ?? []).map(e => (e.letter.kind === 'event' ? e.letter.event.type : e.letter.kind));
    expect(boxTypes, 'only noted is sent before GM approval, never award').toEqual(['noted']);
    // a second clear is refused
    expect(settleClearPreset(out.save, gid('g-den'), xpOf, payees, room, DAY)).toEqual({ ok: false, why: 'no-preset' });
  });

  test('playing alone: pays exact preset XP, gold, and assigned items immediately and deposits unpicked items in the stash', () => {
    const s0 = { ...inDen(), fight: null }, h = s0.hunters[0]!;
    const s = ok(gatePreset(s0, gid('g-den'), {
      type: 'recommend', xp: 180, gold: 75,
      items: [
        { id: presetLineId(1), item: SWORD, checked: true, to: { kind: 'local', hunterId: h.id } },
        { id: presetLineId(2), item: POTION, checked: true, to: null },
      ],
    }));
    const out = ok(settleClearPreset(s, gid('g-den'), xpOf, [{ kind: 'local', hid: h.id, name: h.name }], null, DAY));
    expect(out.granted).toHaveLength(1);
    expect(out.pending).toEqual([]);
    expect(lifetimeXp(out.save.hunters[0]!)).toBe(lifetimeXp(h) + 180);
    expect(out.save.hunters[0]!.gold).toBe(h.gold + 75);
    expect(out.save.hunters[0]!.items.map(i => i.name)).toContain('Iron Blade');
    expect(out.save.stash.items.map(i => i.name)).toEqual(['Health Potion']);
    expect(out.save.gates[0]!.preset.at).toBe('paid');
  });

  test('refuses no-preset on a gate without one, and refuses stash-full atomically without clearing the gate', () => {
    const s0 = { ...inDen(), fight: null }, h = s0.hunters[0]!;
    expect(settleClearPreset(s0, gid('g-den'), xpOf, [{ kind: 'local', hid: h.id, name: h.name }], null, DAY)).toEqual({ ok: false, why: 'no-preset' });

    const fullItems = Array.from({ length: STASH_LINES }, (_, i) => ({ ...parseItem({ name: `Token ${i}`, type: 'misc' })!, id: `i${900 + i}` as never, qty: 1 }));
    const fullSave: Save = { ...withPreset(s0), stash: { gold: 0, items: fullItems } };
    expect(settleClearPreset(fullSave, gid('g-den'), xpOf, [{ kind: 'local', hid: h.id, name: h.name }], null, DAY)).toEqual({ ok: false, why: 'stash-full' });
    expect(fullSave.gates[0]!.status).toBe('detected');
  });

  test('a reopened gate whose preset is already paid clears with no second reward in settleClear', () => {
    const s0 = { ...inDen(), fight: null }, h = s0.hunters[0]!;
    const s1 = ok(gatePreset(s0, gid('g-den'), { type: 'recommend', xp: 180, gold: 75, items: [] }));
    const first = ok(settleClearPreset(s1, gid('g-den'), xpOf, [{ kind: 'local', hid: h.id, name: h.name }], null, DAY));
    const reopened: Save = { ...first.save, gates: first.save.gates.map(g => ({ ...g, status: 'detected' as const })) };
    const before = { xp: lifetimeXp(reopened.hunters[0]!), gold: reopened.hunters[0]!.gold };
    const second = ok(settleClear(
      reopened,
      gid('g-den'),
      { due: 150, xp: 150, gold: 500, items: ['Health Potion'], payees: [h.name] },
      [{ hid: h.id, rewards: { ...newRewards(), xp: 150, gold: 500, items: [POTION] } }],
      null,
      DAY,
    ));
    expect(second.save.gates[0]!.status).toBe('cleared');
    expect(second.granted).toEqual([]);
    expect([lifetimeXp(second.save.hunters[0]!), second.save.hunters[0]!.gold]).toEqual([before.xp, before.gold]);
  });
});
