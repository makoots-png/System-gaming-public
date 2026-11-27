// What one fight command writes (src/core/combat/fight-save.ts `fought`) and what the fight still waits for (`owed` in
// fight.ts): one step each, so the GM's page reloaded between any two parts of a command loses nothing and does nothing
// twice. The GM's phone below follows send() in src/views/combat.js step by step: the write, the outbox's send, the
// news, the dice owed.
import { fightId } from '../src/core/ids.ts';
import { describe, expect, test } from 'bun:test';
import { fightHold, fought, heldCommands, itemSpent, playerHeld } from '../src/core/combat/fight-save.ts';
import type { HeldParts } from '../src/core/combat/fight-save.ts';
import { gateFought } from '../src/core/gates/world.ts';
import { gmAward } from '../src/core/award.ts';
import { gmSource } from '../src/core/effects.ts';
import { newRewards } from '../src/core/rewards.ts';
import type { Rewards } from '../src/core/rewards.ts';
import { itemAbility, itemAbilityId } from '../src/core/registry/abilities.ts';
import { zoneId } from '../src/core/combat/zones.ts';
import { SHOP_ITEMS, itemOf } from '../src/core/registry/items.ts';
import { putItem } from '../src/core/hunter/inventory.ts';
import type { Beside } from '../src/core/combat/fight-save.ts';
import { owed, reduce, reduceAll } from '../src/core/combat/fight.ts';
import { MAX_STATUSES } from '../src/core/combat/fight-types.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import type { Command, Ctx, Fight, NewRow, Result, Running } from '../src/core/combat/fight-types.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import type { CombatantId } from '../src/core/combat/ability-types.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { hunterRow, remoteRow, shadowRow } from '../src/core/combat/rows.ts';
import { statusGrant } from '../src/core/combat/fight-view.ts';
import { freshSave, loadSave, newHunter } from '../src/core/save.ts';
import type { ParseEnv, Save } from '../src/core/save.ts';
import { newEvent, parseSheetKey } from '../src/core/protocol.ts';
import type { RoomCode } from '../src/core/protocol.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { RULES } from '../src/core/rules.ts';
import { den } from './models/gate-events.ts';
import { cid, day, dev, gid, iid, mid, shid } from './fixtures/ids.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { adhocOf } from './fixtures/items.ts';

const AT = '2026-11-15T10:00:00.000Z', STAMP = { at: AT, cap: RULES.logCap };
const ROOM = 'ABCD23' as RoomCode, KAI = parseSheetKey('d-p1:h1')!;
const ENV: ParseEnv = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-gm') };
const id = (s: string): CombatantId => combatantId(s);
const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };
const ctxOf = (s: Save): Ctx => ({ rules: RULES });

/** The GM's save before a fight: this phone's hunter with a shadow, Kai on a player's phone in the room, the Goblin Den. */
function gmSave(): Save {
  const s = freshSave(ENV, { onboarded: true }), h = s.hunters[0]!;
  const shadow = { id: shid('sh1'), name: 'Igris', monster: null, rank: 'E' as const, archetype: 'brute' as const, grade: 'Normal' as const, hp: 30, summoned: true, notes: '' };
  return { ...s, hunters: [{ ...h, shadows: [shadow] }], gates: [den('detected')] };
}
/** The rows of the fight: this phone's hunter (c1), Kai (c2), the shadow (c4) and a goblin (c3). */
/** A goblin foe worth 60 XP, a monster's row on a fresh hunter's build (its numbers a fresh hunter's). */
function goblin(): NewRow {
  const g = hunterRow({ ...newHunter(RULES), id: 'x', name: 'Goblin' }, id('c3'), RULES);
  if (g.kind !== 'hunter') throw new Error('a hunter\'s row');
  const { moved: _m, extractBonus: _eb, ...base } = g;
  return { ...base, kind: 'monster', life: { at: 'up', hp: rowHp(g) }, side: 'foe', holder: null, name: 'Goblin', threat: {}, xp: 60 };
}
function rowsOf(s: Save): NewRow[] {
  const h = s.hunters[0]!;
  return [hunterRow(h, id('c1'), RULES), remoteRow({ ...newHunter(RULES), id: 'h1', name: 'Kai' }, KAI, id('c2'), RULES), goblin(), shadowRow(h.shadows[0]!, h.id, id('c1'), id('c4'), RULES)];
}

/**
 * The GM's phone, as send() in combat.js runs a command: (1) the reducer's answer written by `fought` in one step, with
 * each player's totals as a room event made here (a counter stands in for the event id's random part); (2) the outbox
 * sent (`flushed` keeps what the room took, once an id); (3) the news, which writes nothing; (4) the dice the fight still
 * owes, paid one at a time with the dice `roll` gives. `crash` stops it after a part, as a reload there would.
 */
type Phone = { save: Save; room: string[]; events: number };
const PARTS = ['write', 'flush', 'news', 'owed'] as const;
type Part = (typeof PARTS)[number];
/** (1), and (2) when it posted: send() in combat.js without the dice owed (`command`). */
function write(p: Phone, cmd: Command, links: Beside['links'] = null): Result {
  const r = reduce(p.save.fight, cmd, ctxOf(p.save));
  const totals = r.effects.flatMap(fx => fx.type === 'sendRemote'
    ? [newEvent('vitals', { to: [parseSheetKey(fx.remote)!], fight: r.fight!.id, life: fx.life, mana: fx.mana, fatigue: fx.fatigue, statuses: [...fx.statuses], reason: 'Fight' }, { device: 'd-gm', now: 1, rand: ++p.events / 1000 })!] : []);
  const next = gateFought(p.save, r, { links, room: ROOM, totals, stamp: STAMP }, RULES);
  if (!isRefused(next)) p.save = next;
  return r;
}
function command(p: Phone, cmd: Command): Result {
  const r = write(p, cmd);
  if (r.effects.some(x => x.type === 'sendRemote')) flush(p);
  return r;
}
function flush(p: Phone): void {
  for (const e of p.save.settings.sync.outbox ?? []) if (!p.room.includes(e.id)) p.room.push(e.id);
}
const DICE = [3, 2, 4, 1];
function payOwed(p: Phone): void {
  for (let o = owed(p.save.fight)[0], i = 0; o; o = owed(p.save.fight)[0], i++) {
    if (o.kind !== 'settle') throw new Error('this fight breaks no channel');
    if (command(p, { type: 'settle', id: o.id, key: o.key, dice: o.dice.map(() => DICE[i % DICE.length]!) }).effects.some(x => x.type === 'refused')) return;
  }
}
function send(p: Phone, cmd: Command, crash: Part | null = null): void {
  write(p, cmd);
  if (crash === 'write') return;
  flush(p);
  if (crash === 'flush' || crash === 'news') return;
  payOwed(p);
}
/** The page loaded again from what storage holds, then its first look: the dice owed paid, the outbox sent. */
function reload(p: Phone): void {
  p.save = loadSave(JSON.stringify(p.save), ENV).save;
  payOwed(p);
  flush(p);
}

/** Kai bleeding at the goblin's turn: the goblin passes, Kai's turn starts and its Bleeding (1d4 at rank E) waits for dice. */
function bleedingKai(): Phone {
  const p: Phone = { save: gmSave(), room: [], events: 0 }, rows = rowsOf(p.save);
  write(p, { type: 'add', fightId: fightId('f1'), rows, openings: [] }, { gate: gid('g-den'), monsters: { [cid('c3')]: mid('m-goblin') } });
  write(p, { type: 'start', openings: [{ id: id('c3'), d20: 20, tie: 0 }, { id: id('c2'), d20: 15, tie: 0 }, { id: id('c1'), d20: 10, tie: 0 }, { id: id('c4'), d20: 5, tie: 0 }] });
  write(p, { type: 'status', id: id('c2'), add: statusGrant('bleeding', RULES.conditions.bleeding!, 3, 0, RULES) });
  flush(p);
  return p;
}
const kai = (s: Save) => (s.fight as Running).rows.find(r => r.id === id('c2'))!;
const settled = (s: Save) => (s.fight as Fight).log.filter(l => l.text.includes('Kai: Bleeding takes effect')).length;
const vitalsFor = (s: Save) => (s.settings.sync.outbox ?? []).filter(e => e.key === `vitals ${KAI}`);

describe('one fight command is one write', () => {
  test('a gate\'s fight starting writes the fight, its links and the gate\'s mark with its log line together, before `also`', () => {
    const p: Phone = { save: gmSave(), room: [], events: 0 };
    write(p, { type: 'add', fightId: fightId('f1'), rows: rowsOf(p.save), openings: [] }, { gate: gid('g-den'), monsters: { [cid('c3')]: mid('m-goblin') } });
    expect(p.save.fight?.phase).toBe('setup');
    expect(p.save.fightRefs).toEqual({ gate: gid('g-den'), monsters: { [cid('c3')]: mid('m-goblin') } });
    expect(p.save.gates[0]!.status).toBe('raiding');
    expect(p.save.log.map(l => l.title)).toContain('Fight started');
    // `also` sees the marked gate and its refusal aborts the whole write
    const s0 = gmSave(), r = reduce(s0.fight, { type: 'add', fightId: fightId('f2'), rows: rowsOf(s0), openings: [] }, ctxOf(s0));
    let seenStatus = '';
    const res = gateFought(s0, r, { links: { gate: gid('g-den') }, room: ROOM, totals: [], stamp: STAMP, also: s => { seenStatus = s.gates[0]!.status; return { ok: false, why: 'blocked' }; } }, RULES);
    expect(seenStatus).toBe('raiding');
    expect(res).toEqual({ ok: false, why: 'blocked' });
  });

  test('a GM\'s hand edit writes the row, this phone\'s hunter\'s totals, the shadow\'s HP and Kai\'s totals in the outbox, in the same step', () => {
    const p = bleedingKai(), row = (s: Save, c: string) => (s.fight as Running).rows.find(r => r.id === id(c))!, was = rowHp(row(p.save, 'c1'));
    write(p, { type: 'adjust', id: id('c1'), hp: -5 });
    expect([rowHp(row(p.save, 'c1')), p.save.hunters[0]!.life]).toEqual([was - 5, { at: 'up', hp: was - 5 }]);
    const igris = rowHp(row(p.save, 'c4'));
    write(p, { type: 'adjust', id: id('c4'), hp: -7 });
    expect([rowHp(row(p.save, 'c4')), p.save.hunters[0]!.shadows[0]!.hp]).toEqual([igris - 7, igris - 7]);
    write(p, { type: 'adjust', id: id('c2'), hp: -4 });
    expect(rowHp(kai(p.save))).toBe(kai(p.save).sheet.hpMax - 4);
    const sent = vitalsFor(p.save);
    expect(sent, 'one message under Kai\'s key: the latest totals').toHaveLength(1);
    const ev = sent.at(-1)!.letter;
    expect(ev.kind === 'event' && ev.event.type === 'vitals' && ev.event.payload.life).toEqual({ at: 'up', hp: rowHp(kai(p.save)) });
  });

  test('a refused command writes nothing', () => {
    const p = bleedingKai(), was = JSON.stringify(p.save);
    const r = reduce(p.save.fight, { type: 'endTurn', by: id('c1') }, ctxOf(p.save));
    expect(r.effects).toEqual([{ type: 'refused', reason: 'notYourTurn' }]);
    expect(gateFought(p.save, r, { links: { gate: gid('g-den') }, room: ROOM, totals: [], stamp: STAMP }, RULES)).toEqual({ ok: false, why: 'refused' });
    expect(JSON.stringify(p.save)).toBe(was);
  });

  test('a cleared fight takes what it came from with it', () => {
    const p = bleedingKai();
    write(p, { type: 'clear' });
    expect([p.save.fight, p.save.fightRefs]).toEqual([null, undefined]);
  });
});

describe('the dice the fight waits for', () => {
  test('a turn that starts with a per-round op owes its dice, by the fight as it stands; once paid it owes nothing', () => {
    const p = bleedingKai();
    write(p, { type: 'endTurn', by: id('c3') });
    expect(owed(p.save.fight)).toEqual([{ kind: 'settle', id: id('c2'), key: 'bleeding' as never, dice: [{ count: 1, sides: 4 }] }]);
    payOwed(p);
    expect(owed(p.save.fight)).toEqual([]);
    expect(kai(p.save).sheet.hpMax - rowHp(kai(p.save)), 'the 3 rolled, at its share of a round').toBeGreaterThan(0);
  });
});

describe('a reload between any two parts of a command', () => {
  const plain = (() => { const p = bleedingKai(); send(p, { type: 'endTurn', by: id('c3') }); return p; })();
  test('the command without a reload: Kai bled once, its totals wait once in the outbox and reached the room', () => {
    expect(settled(plain.save)).toBe(1);
    expect(vitalsFor(plain.save)).toHaveLength(1);
    expect(plain.room).toContain(vitalsFor(plain.save)[0]!.id);
    expect(owed(plain.save.fight)).toEqual([]);
  });

  for (const crash of PARTS) {
    test(`a reload after "${crash}" loses nothing and repeats nothing`, () => {
      const p = bleedingKai();
      send(p, { type: 'endTurn', by: id('c3') }, crash);
      reload(p);
      expect(rowHp(kai(p.save)), 'Kai bled what the same dice give').toBe(rowHp(kai(plain.save)));
      expect(settled(p.save), 'once').toBe(1);
      expect(vitalsFor(p.save).map(e => e.letter), 'its latest totals wait once').toEqual(vitalsFor(plain.save).map(e => e.letter));
      expect(p.room).toContain(vitalsFor(p.save)[0]!.id);
      expect(owed(p.save.fight)).toEqual([]);
      reload(p);
      expect(settled(p.save), 'and a second reload pays nothing more').toBe(1);
    });
  }
});

describe('who a fight holds (fightHold): one answer for the sheet, the gear, a respec and a coin', () => {
  const s = gmSave(), h = s.hunters[0]!;
  const setup = reduce(null, { type: 'add', fightId: fightId('f-1'), rows: rowsOf(s), openings: [] }, ctxOf(s)).fight!;
  const alone = { seat: 'gm' as const, code: null, doc: null, docAt: null, heard: null, key: null };
  test('a hunter of this phone with a row is held by that row, set up or running; a player\'s by its sheet key', () => {
    expect(fightHold(setup, { hid: h.id }, alone)).toEqual({ at: 'row', cid: id('c1') });
    expect(fightHold(setup, { key: KAI }, alone)).toEqual({ at: 'row', cid: id('c2') });
  });
  test('a hunter of this phone that no row holds is not in a fight, though this phone runs one for others', () => {
    expect(fightHold(setup, { hid: 'h-other' }, alone)).toBeNull();
  });
  test('on a player\'s phone the GM\'s running fight holds the hunter whose sheet key it has a row for, and no other', () => {
    const doc = { ended: false, active: true, id: fightId('f-1'), rows: [{ key: 'dev-a:h1' }] };
    const seen = (d: typeof doc, key: string) => ({ seat: 'player' as const, code: ROOM, doc: d, docAt: '2026-11-22T10:00:00.000Z', heard: null, key: parseSheetKey(key)! });
    expect(fightHold(null, { hid: 'h1' }, seen(doc, 'dev-a:h1'))).toEqual({ at: 'gm' });
    expect(fightHold(null, { hid: 'h2' }, seen(doc, 'dev-a:h2'))).toBeNull();
    expect(fightHold(null, { hid: 'h1' }, seen({ ...doc, active: false }, 'dev-a:h1'))).toBeNull();
  });
});

describe('an item used in the fight leaves its bag in the write that takes the use', () => {
  const POTION = { ...itemOf(RULES, SHOP_ITEMS.find(d => d.name === 'Health Potion (E)')!), name: 'Red Draught' };
  /** This phone's hunter (c1) and Kai (c2), each with two Red Draughts (i5, a Health Potion of its own name) and 10 HP down, and a goblin (c3); c1 goes first, then Kai. */
  function potionFight(): Phone {
    const s0 = gmSave(), h = putItem({ ...s0.hunters[0]!, life: { at: 'up' as const, hp: 1 } }, adhocOf({ ...POTION, qty: 2 }), iid('i5'), RULES);
    const kaiH = putItem({ ...newHunter(RULES), id: 'h1', name: 'Kai', life: { at: 'up' as const, hp: 1 } }, adhocOf({ ...POTION, qty: 2 }), iid('i5'), RULES);
    const p: Phone = { save: { ...s0, hunters: [h] }, room: [], events: 0 };
    write(p, { type: 'add', fightId: fightId('f1'), rows: [hunterRow(h, id('c1'), RULES), remoteRow(kaiH, KAI, id('c2'), RULES), goblin()], openings: [] });
    write(p, { type: 'start', openings: [{ id: id('c1'), d20: 20, tie: 0 }, { id: id('c2'), d20: 15, tie: 0 }, { id: id('c3'), d20: 10, tie: 0 }] });
    return p;
  }
  /** combat.js `command` with the item it spends: this phone's hunter's taken in the write, a player's as the room's `spent`. */
  function act(p: Phone, by: string): Save | Refused {
    const cmd: Command = { type: 'act', by: id(by), ability: itemAbilityId('i5'), aim: id(by), rolls: { dice: {}, react: {} } };
    const r = reduce(p.save.fight, cmd, ctxOf(p.save)), sp = itemSpent(p.save.fight, cmd);
    const spent = !sp ? null : sp.kind === 'local' ? sp : { kind: 'remote' as const, event: newEvent('spent', { to: [sp.remote], item: sp.item }, { device: 'd-gm', now: 1, rand: ++p.events / 1000 })! };
    const next = fought(p.save, r, { links: null, room: ROOM, totals: [], spent }, RULES);
    if (!isRefused(next)) p.save = next;
    return next;
  }
  const potions = (s: Save) => s.hunters[0]!.items.find(i => i.id === 'i5')?.qty ?? 0;
  const spentPosts = (s: Save) => (s.settings.sync.outbox ?? []).flatMap(e => (e.letter.kind === 'event' && e.letter.event.type === 'spent' ? [{ key: e.key, payload: e.letter.event.payload }] : []));

  test('this phone\'s hunter drinks one: the row is healed and one potion leaves the bag, together', () => {
    const p = potionFight(), hpWas = rowHp((p.save.fight as Running).rows.find(r => r.id === id('c1'))!);
    ok(act(p, 'c1'));
    expect(rowHp((p.save.fight as Running).rows.find(r => r.id === id('c1'))!)).toBeGreaterThan(hpWas);
    expect(potions(p.save)).toBe(1);
  });

  test('a player\'s hunter drinks one: the room\'s spent for that one item is queued with the use, never replaced by later totals', () => {
    const p = potionFight();
    write(p, { type: 'endTurn', by: id('c1') });
    ok(act(p, 'c2'));
    expect(spentPosts(p.save).map(x => [x.key, x.payload.to, x.payload.item])).toEqual([[null, [KAI], 'i5']]);
  });

  test('a use the fight refuses (not that row\'s turn, or rank above the bottle\'s cap) writes nothing: no potion leaves and nothing is sent', () => {
    const p = potionFight(), was = JSON.stringify(p.save);
    expect(act(p, 'c2')).toEqual({ ok: false, why: 'refused' });
    expect(JSON.stringify(p.save)).toBe(was);
    expect(spentPosts(p.save)).toEqual([]);

    // Rank B hunter drinking a rank-E capped bottle is refused tooLow in core, spending no bottle
    const s0 = gmSave(), high = putItem({ ...s0.hunters[0]!, rank: 'B' as const, life: { at: 'up' as const, hp: 1 } }, adhocOf({ ...POTION, qty: 2 }), iid('i5'), RULES);
    const hp2: Phone = { save: { ...s0, hunters: [high] }, room: [], events: 0 };
    write(hp2, { type: 'add', fightId: fightId('f2'), rows: [hunterRow(high, id('c1'), RULES), goblin()], openings: [] });
    write(hp2, { type: 'start', openings: [{ id: id('c1'), d20: 20, tie: 0 }, { id: id('c3'), d20: 10, tie: 0 }] });
    const beforeHigh = JSON.stringify(hp2.save);
    expect(act(hp2, 'c1')).toEqual({ ok: false, why: 'refused' });
    expect(JSON.stringify(hp2.save)).toBe(beforeHigh);
    expect(potions(hp2.save)).toBe(2);
  });

  test('a potion this phone\'s hunter no longer holds is refused whole: the fight does not heal for free', () => {
    const p = potionFight();
    p.save = { ...p.save, hunters: [{ ...p.save.hunters[0]!, items: [] }] };
    const was = JSON.stringify(p.save);
    expect(act(p, 'c1')).toEqual({ ok: false, why: 'no-item' });
    expect(JSON.stringify(p.save)).toBe(was);
  });

  test('only an act of an item\'s ability by a hunter\'s row spends an item', () => {
    const p = potionFight(), f = p.save.fight;
    expect(itemSpent(f, { type: 'endTurn', by: id('c1') })).toBeNull();
    expect(itemSpent(f, { type: 'act', by: id('c1'), ability: (f as Running).rows[0]!.abilities[0]!.id, aim: id('c3'), rolls: { dice: {}, react: {} } })).toBeNull();
    expect(itemSpent(f, { type: 'act', by: id('c3'), ability: itemAbilityId('i5'), aim: id('c3'), rolls: { dice: {}, react: {} } })).toBeNull();
    expect(itemSpent(f, { type: 'act', by: id('c1'), ability: itemAbilityId('i5'), aim: id('c1'), rolls: { dice: {}, react: {} } })).toEqual({ kind: 'local', hunterId: p.save.hunters[0]!.id, item: 'i5' });
  });

  test('a shadow risen for a player\'s hunter is posted in the write that keeps the corpse\'s outcome; with no room nothing is written (implicit audit 3, C3)', () => {
    const p = potionFight(), r: Result = { fight: p.save.fight, effects: [] };
    const risen = newEvent('shadow', { to: [KAI], shadow: { rank: 'E', archetype: 'brute', grade: 'Normal', monster: null, name: 'Wolf' } }, { device: 'd-gm', now: 1, rand: 0.5 })!;
    const next = ok(fought(p.save, r, { links: null, room: ROOM, totals: [], risen }, RULES)), had = (p.save.settings.sync.outbox ?? []).length;
    expect((next.settings.sync.outbox ?? []).slice(had).map(e => e.letter.kind === 'event' ? [e.letter.event.type, e.key] : null)).toEqual([['shadow', null]]);
    expect(fought(p.save, r, { links: null, room: null, totals: [], risen }, RULES)).toEqual({ ok: false, why: 'no-room' });
  });

  test('a skill whose id happens to begin "item-" spends no item: an item\'s ability is told by the item it holds, not by its id (implicit audit 2, N16)', () => {
    const p = potionFight(), f = p.save.fight as Running, c1 = f.rows[0]!;
    const odd = { ...c1.abilities.find(a => !a.item)!, id: abilityId('item-i9') };
    const g: Running = { ...f, rows: f.rows.map(r => (r.id === c1.id ? { ...r, abilities: [...r.abilities, odd] } : r)) };
    expect(itemSpent(g, { type: 'act', by: id('c1'), ability: odd.id, aim: id('c3'), rolls: { dice: {}, react: {} } })).toBeNull();
  });
});

describe('an award to hunters this phone\'s fight holds is one write: the award, its log line and the statuses on their rows (close audit, V2\'s last row)', () => {
  /** The GM's running fight: this phone's hunter (c1, 10 HP down) and Kai (c2) on the party's side, a goblin (c3) and the shadow (c4). */
  function heldFight(): Phone {
    const p: Phone = { save: gmSave(), room: [], events: 0 };
    write(p, { type: 'add', fightId: fightId('f1'), rows: rowsOf(p.save), openings: [] });
    write(p, { type: 'start', openings: [{ id: id('c3'), d20: 20, tie: 0 }, { id: id('c2'), d20: 15, tie: 0 }, { id: id('c1'), d20: 10, tie: 0 }, { id: id('c4'), d20: 5, tie: 0 }] });
    write(p, { type: 'adjust', id: id('c1'), hp: -10 });
    flush(p);
    return p;
  }
  /** 1000 XP (a level-up, so a refill) and Bleeding for 3 rounds: what the GM sends to this phone's hunter and to Kai. */
  const REWARD: Rewards = { ...newRewards(), xp: 1000, statuses: [{ key: statusKey('bleeding'), rounds: 3 }] };
  const DAY = { at: AT, today: day('2026-11-15'), R: RULES };
  /**
   * gm.js `doAward` for this phone's hunter and Kai, both held by the fight: the award's step read first on the save as
   * it is (what each grant hands to the fight), then the rows' commands and the award written as one command batch by
   * `fought`, then the outbox sent. `crash` stops it after a part, as a reload there would.
   */
  function award(p: Phone, crash: 'write' | null = null, reward: Rewards = REWARD): Save | Refused {
    const hid = p.save.hunters[0]!.id, locals = [{ hid, vitals: 'fight' as const }];
    const kaiAward = newEvent('award', { to: [KAI], rewards: { ...reward, statuses: [] } }, { device: 'd-gm', now: 1, rand: ++p.events / 1000 })!;
    const sends = { room: ROOM, events: [kaiAward], said: [{ kind: 'award' as const, title: 'GM award', text: '+1000 XP, Bleeding → Hunter, Kai', hunterId: hid }] };
    const plan = gmAward(p.save, locals, reward, sends, DAY);
    const mine = plan.granted[0]!.g.fight;
    const parts: HeldParts[] = [
      { cid: id('c1'), statuses: mine.statuses, refill: mine.refill },
      { cid: id('c2'), statuses: reward.statuses.map(st => ({ key: st.key, rounds: st.rounds, source: gmSource('E') })), refill: false },
    ];
    const r = reduceAll(p.save.fight, heldCommands(parts, RULES), ctxOf(p.save));
    const totals = r.effects.flatMap(fx => fx.type === 'sendRemote'
      ? [newEvent('vitals', { to: [parseSheetKey(fx.remote)!], fight: r.fight!.id, life: fx.life, mana: fx.mana, fatigue: fx.fatigue, statuses: [...fx.statuses], reason: 'Fight' }, { device: 'd-gm', now: 1, rand: ++p.events / 1000 })!] : []);
    const next = fought(p.save, r, { links: null, room: ROOM, totals, also: sv => gmAward(sv, locals, reward, sends, DAY).save }, RULES);
    if (!isRefused(next)) p.save = next;
    if (crash !== 'write') flush(p);
    return next;
  }
  const row = (s: Save, c: string) => (s.fight as Running).rows.find(r => r.id === id(c))!;
  /** This phone's hunter's row at 0 HP is dead, and the write-back makes its sheet dead too. */
  const dies = (p: Phone): void => {
    expect(p.save.hunters[0]!.life, 'a row at 0 HP, written back to the sheet, is dead').toEqual({ at: 'dead' });
  };
  const bleeds = (s: Save, c: string) => row(s, c).statuses.some(x => x.key === 'bleeding');
  const awardLines = (s: Save) => s.log.filter(l => l.title === 'GM award').length;
  const posted = (s: Save, type: string) => (s.settings.sync.outbox ?? []).flatMap(e => (e.letter.kind === 'event' && e.letter.event.type === type ? [e.letter.event] : []));
  const awardsToKai = (s: Save) => posted(s, 'award').length;
  /** What a reload finds: none of the award (no XP, no line, no post, no status) or all of it. */
  const found = (s: Save) => ({ xp: s.hunters[0]!.xp > 0 || s.hunters[0]!.level > 1, line: awardLines(s) === 1, post: awardsToKai(s) === 1, mine: bleeds(s, 'c1'), kai: bleeds(s, 'c2') });
  const ALL = { xp: true, line: true, post: true, mine: true, kai: true }, NONE = { xp: false, line: false, post: false, mine: false, kai: false };

  test('one write holds the XP, the log line, Kai\'s award in the outbox, Bleeding on both rows, this phone\'s row refilled and Kai\'s totals queued', () => {
    const p = heldFight(), was = row(p.save, 'c1');
    expect(rowHp(was)).toBeLessThan(was.sheet.hpMax);
    ok(award(p));
    expect(found(p.save)).toEqual(ALL);
    expect(rowHp(row(p.save, 'c1')), 'the level-up refilled the row').toBe(row(p.save, 'c1').sheet.hpMax);
    expect(vitalsFor(p.save), 'Kai\'s row\'s totals, Bleeding with them, wait once').toHaveLength(1);
    const totals = posted(p.save, 'vitals')[0]!;
    expect(totals.type === 'vitals' && totals.payload.statuses.map(x => x.key)).toContain('bleeding');
    expect(p.room).toContain(vitalsFor(p.save)[0]!.id);
  });

  for (const crash of ['write', null] as const) {
    test(`a reload after "${crash ?? 'flush'}" finds all of the award and its statuses, and a second award is a second award, not a repair`, () => {
      const p = heldFight();
      award(p, crash);
      reload(p);
      expect(found(p.save)).toEqual(ALL);
    });
  }

  test('a level-up\'s refill fills the row to the maxima the reward\'s own statuses gave it', () => {
    const hardy = { label: 'Hardy', desc: '', ops: [{ op: 'stat', key: 'vit', amount: { kind: 'number', value: 20 } }] } as const;
    const p = heldFight(), before = row(p.save, 'c1').sheet;
    ok(award(p, null, { ...REWARD, statuses: [{ key: statusKey('hardy'), rounds: 3, def: hardy }] }));
    const c1 = row(p.save, 'c1');
    expect(c1.sheet.hpMax, 'Hardy raised the row\'s maximum HP').toBeGreaterThan(before.hpMax);
    expect([rowHp(c1), c1.mana]).toEqual([c1.sheet.hpMax, c1.sheet.manaMax]);
  });

  test('a level-up\'s refill is the sheet\'s refill: a dead hunter\'s row stays at 0 HP, as its sheet does, and its mana is filled', () => {
    const p = heldFight();
    write(p, { type: 'adjust', id: id('c1'), hp: -9999, mana: -5 });
    dies(p);
    ok(award(p));
    const c1 = row(p.save, 'c1');
    expect([rowHp(c1), c1.mana, p.save.hunters[0]!.life]).toEqual([0, c1.sheet.manaMax, { at: 'dead' }]);
  });

  // The same cause outside the refill (docs/agent-handoff/audit/notes-dead-row.md): every raise of a hunter's row goes
  // through its life (row-life.ts), so none lifts the dead; a revive stands the row up as its own command.
  /** This phone's hunter's row dead, and its sheet with it: its HP taken to 0. */
  const deadRow = (): Phone => {
    const p = heldFight();
    write(p, { type: 'adjust', id: id('c1'), hp: -9999 });
    dies(p);
    return p;
  };
  const num = (value: number) => ({ kind: 'number', value }) as const;
  const stillDead = (p: Phone) => expect([rowHp(row(p.save, 'c1')), p.save.hunters[0]!.life]).toEqual([0, { at: 'dead' }]);

  test('the GM\'s hand heal of a dead hunter\'s row leaves it at 0 HP, as the dead sheet refuses the heal', () => {
    const p = deadRow();
    write(p, { type: 'adjust', id: id('c1'), hp: 10 });
    stillDead(p);
  });

  test('an ally\'s healing salve thrown at a dead hunter\'s row is refused noTarget and leaves it at 0 HP', () => {
    const p = deadRow(), f = p.save.fight as Running;
    const salve = itemAbility({ id: iid('i8'), name: 'Salve', rar: 'common', target: 'other', effects: [{ op: 'heal', amount: num(20), when: 'use' }] }, RULES)!;
    p.save = { ...p.save, fight: { ...f, rows: f.rows.map(r => (r.id === id('c2') ? { ...r, abilities: [...r.abilities, salve] } : r)) } };
    const r = write(p, { type: 'act', by: id('c2'), ability: salve.id, aim: id('c1'), rolls: { dice: {}, react: {} }, force: true });
    expect(r.effects.filter(x => x.type === 'refused'), 'a dead body cannot be aimed at (row 18)').toEqual([{ type: 'refused', reason: 'noTarget' }]);
    stillDead(p);
  });

  test('a healing ground the GM lays under a dead hunter\'s row leaves it at 0 HP, as the dead sheet refuses the heal', () => {
    const p = deadRow(), at = row(p.save, 'c1').place;
    const r = write(p, { type: 'zoneAdd', zone: { id: zoneId('z1'), name: 'Spring', tiles: [at], spares: null, tier: 0, duration: null, ops: [{ op: 'heal', amount: num(10), when: 'use' }] } });
    expect(r.effects.filter(x => x.type === 'refused'), 'the fight takes the zone').toEqual([]);
    stillDead(p);
  });

  // A row at 0 HP takes no turn and its own statuses settle only at its turn start; this guards the gate on that path too
  // (fight-turn.ts `payDue`, which the healing ground above reaches through a zone's entry).
  test('Regenerating on a dead hunter\'s row leaves it at 0 HP through two rounds of turns, as the dead sheet refuses the heal', () => {
    const p = deadRow();
    write(p, { type: 'status', id: id('c1'), add: statusGrant('regenerating', RULES.conditions.regenerating!, 3, 5, RULES) });
    expect(row(p.save, 'c1').statuses.map(s => s.key), 'the row holds Regenerating').toContain(statusKey('regenerating'));
    for (let i = 0; i < 6; i++) { const f = p.save.fight as Running; write(p, { type: 'endTurn', by: f.currentId }); payOwed(p); }
    stillDead(p);
  });

  test('a level-up\'s refill of a row already at its maxima changes nothing and refuses nothing: the award is paid', () => {
    const p = heldFight();
    write(p, { type: 'adjust', id: id('c1'), hp: 9999 });
    ok(award(p));
    expect(found(p.save)).toEqual(ALL);
    expect(rowHp(row(p.save, 'c1'))).toBe(row(p.save, 'c1').sheet.hpMax);
  });

  test('a reload before the write finds none of it', () => {
    const p = heldFight();
    reload(p);
    expect(found(p.save)).toEqual(NONE);
  });

  test('a row that cannot take another status refuses the award whole: no XP, no log line, nothing posted, no status anywhere', () => {
    const p = heldFight();
    for (let i = 0; i < MAX_STATUSES; i++) write(p, { type: 'status', id: id('c2'), add: statusGrant(`x${i}`, { ...RULES.conditions.bleeding!, label: `X${i}` }, null, 0, RULES) });
    const before = JSON.stringify(p.save);
    const r = award(p);
    expect(isRefused(r) && r.why).toBe('refused');
    expect(JSON.stringify(p.save)).toBe(before);
    expect(found(p.save)).toEqual(NONE);
  });

  test('the commands put only what a row can hold: a status with no def anywhere, or a state chip, is left out', () => {
    const cmds = heldCommands([
      { cid: id('c2'), statuses: [{ key: 'bleeding', rounds: 2 }, { key: 'no-such-status', rounds: 2 }, { key: 'dead', rounds: null }], refill: false },
    ], RULES);
    expect(cmds.map(c => c.type === 'status' ? `status ${c.add?.key}` : c.type)).toEqual(['status bleeding']);
  });

  const GONE = parseSheetKey('d-p9:h1')!;
  const OWN = { ...RULES.conditions.bleeding!, label: 'Marked' };
  const statuses: Rewards['statuses'] = [{ key: statusKey('bleeding'), rounds: 2 }, { key: statusKey('marked'), rounds: null, def: OWN }];

  test('a reward\'s statuses for a player\'s hunter on a row come from the GM at that hunter\'s rank (A is the fifth rank, tier 4), at rank E when its sheet is not on this phone, with no refill', () => {
    expect(playerHeld([{ key: KAI, data: { rank: 'A' } }], [KAI, GONE], statuses)).toEqual([
      { who: { key: KAI }, statuses: [{ key: statusKey('bleeding'), rounds: 2, source: { id: null, tier: 4 } }, { key: statusKey('marked'), rounds: null, source: { id: null, tier: 4 }, def: OWN }], refill: false },
      { who: { key: GONE }, statuses: [{ key: statusKey('bleeding'), rounds: 2, source: { id: null, tier: 0 } }, { key: statusKey('marked'), rounds: null, source: { id: null, tier: 0 }, def: OWN }], refill: false },
    ]);
  });

  test('a player\'s row takes them at that tier: the commands carry the rank\'s tier and the reward\'s own def', () => {
    const [part] = playerHeld([{ key: KAI, data: { rank: 'A' } }], [KAI], statuses);
    const cmds = heldCommands([{ cid: id('c2'), statuses: part!.statuses, refill: part!.refill }], RULES);
    expect(cmds.map(c => (c.type === 'status' && c.add ? [c.add.key, c.add.tier, c.add.def.label] : c.type))).toEqual([['bleeding', 4, RULES.conditions.bleeding!.label], ['marked', 4, 'Marked']]);
  });

  test('a reward with no status hands a player\'s row nothing', () => {
    expect(playerHeld([{ key: KAI, data: { rank: 'A' } }], [KAI], [])).toEqual([{ who: { key: KAI }, statuses: [], refill: false }]);
  });
});

describe('a fight\'s end is remembered', () => {
  test('the GM ends a gate\'s fight: this phone\'s hunter gets its fight fact in the same write, Kai\'s and the shadow\'s rows none', () => {
    const p = bleedingKai();
    write(p, { type: 'end' });
    expect(p.save.fight?.phase).toBe('ended');
    const inbox = p.save.hunters[0]!.chronicle.inbox;
    expect(inbox.map(f => f.kind)).toEqual(['fight']);
    expect(inbox[0]).toMatchObject({ kind: 'fight', outcome: 'ended', up: true, allies: 1, foes: 1, gate: den('detected').name, names: 'Goblin' });
  });
});

describe('post-fight fatigue recovery on local and remote sheets (A3)', () => {
  const REST = RULES.fight.fightRest;
  const postedVitals = (s: Save) => (s.settings.sync.outbox ?? []).flatMap(e => (e.letter.kind === 'event' && e.letter.event.type === 'vitals' ? [e.letter.event] : []));

  test('ending a running fight lowers local fatigue atomically, queues one vitals update for a fatigued remote hunter, and stays idempotent across reload', () => {
    const p = bleedingKai();
    write(p, { type: 'adjust', id: id('c1'), fatigue: 70 });
    write(p, { type: 'adjust', id: id('c2'), fatigue: 80 });
    expect([p.save.hunters[0]!.fatigue, postedVitals(p.save)[0]!.payload.fatigue]).toEqual([70, 80]);

    write(p, { type: 'end' });
    expect(p.save.fight?.phase).toBe('ended');
    expect(p.save.hunters[0]!.fatigue).toBe(70 - REST);
    expect(postedVitals(p.save)).toHaveLength(1);
    expect(postedVitals(p.save)[0]!.payload.fatigue).toBe(80 - REST);

    // Reloading an ended fight and clearing it never applies fightRest a second time
    reload(p);
    expect(p.save.hunters[0]!.fatigue).toBe(70 - REST);
    expect(reduce(p.save.fight, { type: 'end' }, ctxOf(p.save)).effects).toEqual([{ type: 'refused', reason: 'notNow' }]);
    write(p, { type: 'clear' });
    expect(p.save.fight).toBeNull();
    expect(p.save.hunters[0]!.fatigue).toBe(70 - REST);
  });

  test('a remote hunter at 0 fatigue queues no extra vitals on fight end, and a dead hunter recovers no fatigue', () => {
    const p = bleedingKai();
    p.save = { ...p.save, settings: { ...p.save.settings, sync: { ...p.save.settings.sync, outbox: [] } } };
    write(p, { type: 'adjust', id: id('c1'), hp: -9999, fatigue: 70 });
    p.save = { ...p.save, settings: { ...p.save.settings, sync: { ...p.save.settings.sync, outbox: [] } } };
    write(p, { type: 'end' });
    expect(p.save.hunters[0]!.fatigue).toBe(70);
    expect(postedVitals(p.save)).toEqual([]);
  });

  test('a hunter who collapsed during the fight lowers fatigue by fightRest on fight end while staying Exhausted', () => {
    const p = bleedingKai();
    write(p, { type: 'adjust', id: id('c1'), fatigue: 999 });
    expect([p.save.hunters[0]!.fatigue, p.save.hunters[0]!.collapsed]).toEqual([RULES.fight.fatigueBase, true]);
    write(p, { type: 'end' });
    expect([p.save.hunters[0]!.fatigue, p.save.hunters[0]!.collapsed]).toEqual([RULES.fight.fatigueBase - REST, true]);
  });
});
