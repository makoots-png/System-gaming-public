// A thing used on its user outside a fight (src/core/hunter/use.ts) and how the GM is told of it in the same write
// (src/core/use-told.ts). Each use is one answer: what it did and the item gone, or a refusal that changes nothing.
import { describe, expect, test } from 'bun:test';
import { USE_WORDS, revives, spendItem, tooLowLine, useDice, useItem, useOn } from '../src/core/hunter/use.ts';
import { toldStep } from '../src/core/use-told.ts';
import { RARITIES, SHOP_ITEMS, itemOf } from '../src/core/registry/items.ts';
import type { ItemTemplate, Rarity } from '../src/core/registry/items.ts';
import { putItem } from '../src/core/hunter/inventory.ts';
import { sheetEdit } from '../src/core/hunter/grant.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { REVIVE_HP, hpOf, lifeAfter } from '../src/core/hunter/vitals.ts';
import type { Life } from '../src/core/hunter/vitals.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import { RANKS, RULES } from '../src/core/rules.ts';
import type { Rank } from '../src/core/rules.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import type { Hunter, ParseEnv } from '../src/core/save.ts';
import { newEvent, useRoute } from '../src/core/protocol.ts';
import { logLine } from '../src/core/session-log.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { chained } from '../src/core/hunter/quests.ts';
import { dev, hid as hidOf, iid, jcid, lid, qid, room } from './fixtures/ids.ts';

const ok = <T extends object>(v: T | Refused): T => { if (isRefused(v)) throw new Error(`refused: ${v.why}`); return v as T; };
const shop = (name: string): ItemTemplate => itemOf(RULES, SHOP_ITEMS.find(d => d.name === name)!);
const POTION = shop('Health Potion'), MANA = shop('Mana Potion');
const hpMax = (h: Hunter): number => hunterSheet(h, RULES).sheet.hpMax;
/** A hunter with `n` of `item` (id i1) in the bag, `hp` below its maximum. */
function holding(item: ItemTemplate, n: number, down = 0): Hunter {
  const h = putItem({ ...newHunter(RULES), id: hidOf('h1') }, { ...item, qty: n }, iid('i1'));
  return down ? { ...h, life: { at: 'up', hp: hpMax(h) - down } } : h;
}
const qty = (h: Hunter): number => h.items.find(i => i.id === 'i1')?.qty ?? 0;

describe('a consumable used on oneself outside a fight', () => {
  test('a Health Potion heals what is missing, says what it healed, and one leaves the bag, in one answer', () => {
    const h = holding(POTION, 2, 10), u = ok(useItem(h, 'i1', [[]], RULES));
    expect(hpOf(u.hunter.life, hpMax(h))).toBe(hpMax(h));
    expect(u.lines).toEqual(['+10 HP']);
    expect(qty(u.hunter)).toBe(1);
  });

  test('the last one leaves the bag', () => {
    expect(ok(useItem(holding(POTION, 1, 10), 'i1', [[]], RULES)).hunter.items).toEqual([]);
  });

  test('a potion that would change nothing is refused and kept: full HP, full mana, a dead hunter', () => {
    const full = holding(POTION, 1);
    expect(useItem(full, 'i1', [[]], RULES)).toEqual({ ok: false, why: 'nothing' });
    expect(useItem(holding(MANA, 1), 'i1', [[]], RULES)).toEqual({ ok: false, why: 'nothing' });
    const dead: Hunter = { ...holding(POTION, 1), life: { at: 'dead' } };
    expect(useItem(dead, 'i1', [[]], RULES)).toEqual({ ok: false, why: 'nothing' });
  });

  test('a dying hunter is healed up', () => {
    const dying: Hunter = { ...holding(POTION, 1), life: { at: 'dying', successes: 0, failures: 1 } };
    const u = ok(useItem(dying, 'i1', [[]], RULES));
    expect(u.hunter.life).toEqual({ at: 'up', hp: 30 });
    expect(u.lines).toEqual(['+30 HP']);
  });

  test('a cure takes only a status the hunter holds, and says its name', () => {
    const cure: ItemTemplate = { ...POTION, name: 'Antidote', effects: [{ op: 'cureStatus', key: statusKey('poisoned') }] };
    expect(useItem(holding(cure, 1), 'i1', [[]], RULES)).toEqual({ ok: false, why: 'nothing' });
    const sick = ok(sheetEdit(holding(cure, 1), { type: 'put', status: { key: 'poisoned' } }, RULES));
    const u = ok(useItem(sick, 'i1', [[]], RULES));
    expect(u.hunter.conditions).toEqual([]);
    expect(u.lines).toEqual([`Cured: ${RULES.conditions.poisoned!.label}`]);
  });

  test('an item that is not held, or not a consumable, or none is left, is refused', () => {
    expect(useItem(holding(POTION, 1, 10), 'i9', [[]], RULES)).toEqual({ ok: false, why: 'no-item' });
    const gear = putItem(newHunter(RULES), { ...POTION, type: 'weapon' }, iid('i1'));
    expect(useItem(gear, 'i1', [[]], RULES)).toEqual({ ok: false, why: 'no-item' });
  });

  test('the dice an amount asks for are read: a 2d6 heal heals what the dice came to', () => {
    const roll: ItemTemplate = { ...POTION, effects: [{ op: 'heal', amount: { kind: 'dice', count: 2, sides: 6 } }] };
    expect(useDice(roll.effects!, 0)).toEqual([[{ count: 2, sides: 6 }]]);
    expect(ok(useItem(holding(roll, 1, 20), 'i1', [[11]], RULES)).lines, 'one number per dice term, as the edge rolls it').toEqual(['+11 HP']);
  });
});

describe('a Resurrection Crystal used from the bag', () => {
  // a new hunter is rank E, so the E crystal raises it
  const CRYSTAL = shop('Resurrection Crystal (E)');
  const as = (life: Life, n = 1): Hunter => ({ ...holding(CRYSTAL, n), life });

  test('a dead hunter stands at the life machine\'s revive HP, the crystal gone, in one answer that says so', () => {
    const u = ok(useItem(as({ at: 'dead' }), 'i1', [], RULES));
    expect(u.hunter.life).toEqual({ at: 'up', hp: REVIVE_HP });
    expect(u.hunter.life).toEqual(lifeAfter({ at: 'dead' }, { type: 'revive' }, hpMax(u.hunter)));
    expect(u.lines).toEqual([`Up at ${REVIVE_HP} HP`]);
    expect(u.hunter.items).toEqual([]);
  });

  test('it works once: the hunter it raised is not dead, so a second crystal is refused and kept', () => {
    const once = ok(useItem(as({ at: 'dead' }, 2), 'i1', [], RULES)).hunter;
    expect(qty(once)).toBe(1);
    expect(useItem(once, 'i1', [], RULES)).toEqual({ ok: false, why: 'not-dead' });
  });

  test('a hunter who is up, down or stable is refused and keeps the crystal: it brings back only the dead', () => {
    for (const life of [{ at: 'up', hp: 5 }, { at: 'dying', successes: 1, failures: 2 }, { at: 'stable' }] as Life[]) {
      expect([life.at, useItem(as(life), 'i1', [], RULES)]).toEqual([life.at, { ok: false, why: 'not-dead' }]);
    }
    expect(USE_WORDS['not-dead']('Resurrection Crystal')).toBe('Resurrection Crystal only brings back a dead hunter. You still have it.');
    expect(USE_WORDS.fight('Resurrection Crystal')).toBe('Use Resurrection Crystal after the fight.');
  });

  test('its use is told to the GM: posted from a player\'s phone in a room, logged on a phone alone or the GM\'s', () => {
    const told = { tell: CRYSTAL.tell === true, target: 'self' as const };
    expect([useRoute('player', told), useRoute('alone', told), useRoute('gm', told)]).toEqual(['post', 'log', 'log']);
  });

  test('a GM\'s own reviving item that also heals does both, the heal on the hunter it raised', () => {
    const phoenix: ItemTemplate = { ...CRYSTAL, name: 'Phoenix Feather', effects: [{ op: 'heal', amount: { kind: 'number', value: 9 } }] };
    const u = ok(useItem({ ...holding(phoenix, 1), life: { at: 'dead' } }, 'i1', [[]], RULES));
    expect(u.hunter.life).toEqual({ at: 'up', hp: REVIVE_HP + 9 });
    expect(u.lines).toEqual([`Up at ${REVIVE_HP} HP`, '+9 HP']);
  });
});

describe('a crystal of a rank (economy design 5, the owner\'s ruling 4: "You have to use one greater or equal to the rank you\'re trying to res")', () => {
  const RANK_OF: Readonly<Record<Rarity, Rank>> = { common: 'E', uncommon: 'D', rare: 'C', epic: 'B', legendary: 'A', mythic: 'S' };
  const crystal = (r: Rank): ItemTemplate => shop(`Resurrection Crystal (${r})`);
  const C = crystal('C');
  const dead = (item: ItemTemplate, rank: Rank): Hunter => ({ ...holding(item, 1), rank, life: { at: 'dead' } });

  test('a crystal revives a dead hunter of its rank or lower and refuses a higher one, spending nothing', () => {
    for (const rank of ['E', 'D', 'C'] as const) {
      const u = ok(useItem(dead(C, rank), 'i1', [], RULES));
      expect([rank, u.hunter.life, qty(u.hunter)]).toEqual([rank, { at: 'up', hp: REVIVE_HP }, 0]);
    }
    for (const rank of ['B', 'A', 'S'] as const) {
      const h = dead(C, rank), before = structuredClone(h);
      expect([rank, useItem(h, 'i1', [], RULES)]).toEqual([rank, { ok: false, why: 'too-low' }]);
      expect(h).toEqual(before);
    }
  });

  test('`revives` is true for each rank at or below its rarity\'s rank, and never for an item that does not revive', () => {
    for (const rar of RARITIES) {
      const item = { rar, revive: true as const };
      expect([rar, RANKS.filter(rank => revives(item, rank, RULES))]).toEqual([rar, RANKS.slice(0, RANKS.indexOf(RANK_OF[rar]) + 1)]);
    }
    expect(RANKS.some(rank => revives(shop('Health Potion'), rank, RULES))).toBe(false);
  });

  test('the rank a crystal reaches is its rarity\'s rank as the GM\'s rules have it: a rare crystal read as B raises a B', () => {
    const R = { ...RULES, rarities: { ...RULES.rarities, rare: { ...RULES.rarities.rare, rank: 'B' as const } } };
    expect([revives(C, 'B', R), revives(C, 'A', R)]).toEqual([true, false]);
    expect(ok(useItem(dead(C, 'B'), 'i1', [], R)).hunter.life).toEqual({ at: 'up', hp: REVIVE_HP });
  });

  test('a living hunter with a crystal below its rank is told the crystal brings back only the dead', () => {
    expect(useItem({ ...holding(C, 1), rank: 'S' }, 'i1', [], RULES)).toEqual({ ok: false, why: 'not-dead' });
  });

  test('a refused use says why and the way out, naming the crystal\'s rank and the hunter\'s', () => {
    expect(USE_WORDS['too-low']('Resurrection Crystal (C)', { upTo: 'C', name: 'Mina', rank: 'B' }))
      .toBe('Resurrection Crystal (C) brings back a hunter of rank C or lower. Mina is rank B. You still have it. A B-rank crystal or higher, or the GM\'s Revive, brings Mina back.');
    expect(USE_WORDS['too-low']('Resurrection Crystal (C)'), 'said with the name alone')
      .toBe('Resurrection Crystal (C) does not reach this hunter\'s rank. You still have it. A crystal of the hunter\'s rank or higher, or the GM\'s Revive, brings the hunter back.');
  });

  test('a crystal given to a hunter above its rank is told to the giver, never refused: "Resurrection Crystal (C) cannot bring back Mina (rank B)."', () => {
    expect(tooLowLine(C, { name: 'Mina', rank: 'B' }, RULES)).toBe('Resurrection Crystal (C) cannot bring back Mina (rank B).');
    expect(tooLowLine(C, { name: 'Mina', rank: 'C' }, RULES), 'it reaches her').toBeNull();
    expect(tooLowLine(shop('Health Potion'), { name: 'Mina', rank: 'S' }, RULES), 'not a crystal').toBeNull();
  });
});

describe('a raising costs levels (economy design 7.1 `reviveLevelShare`, the owner\'s ruling 9: "maybe 3.33% of your total level")', () => {
  const S = shop('Resurrection Crystal (S)');
  /** A dead hunter at `level` holding an S crystal; its rank is kept as it was (record.ts `RANK_TABLE`, `levelMoved`). */
  const deadAt = (level: number): Hunter => ({ ...holding(S, 1), rank: 'A', level, peakLevel: level, life: { at: 'dead' } });
  const levelFacts = (h: Hunter) => h.chronicle.inbox.filter(f => f.kind === 'level');

  test('a raising at level 31 by a crystal leaves level 29, and the use says so', () => {
    const u = ok(useItem(deadAt(31), 'i1', [], RULES));
    expect([u.hunter.level, u.hunter.rank, u.hunter.life]).toEqual([29, 'A', { at: 'up', hp: REVIVE_HP }]);
    expect(u.lines).toEqual([`Up at ${REVIVE_HP} HP at level 29, 2 levels lost`]);
    expect(levelFacts(u.hunter), 'the level\'s fact, as every level change records').toEqual([{ kind: 'level', level: 29 }]);
  });

  test('a raising at level 31 by the GM\'s Revive leaves level 29 too', () => {
    const h = ok(sheetEdit(deadAt(31), { type: 'life', event: { type: 'revive' } }, RULES));
    expect([h.level, h.life]).toEqual([29, { at: 'up', hp: REVIVE_HP }]);
  });

  test('a raising inside a fight, written back with the fight\'s totals, costs the same once: a second write of the same totals takes nothing', () => {
    const totals = { type: 'totals' as const, life: { at: 'up' as const, hp: REVIVE_HP }, mana: 0, fatigue: 0, statuses: [] };
    const once = ok(sheetEdit(deadAt(31), totals, RULES));
    expect(once.level).toBe(29);
    expect(ok(sheetEdit(once, totals, RULES)).level).toBe(29);
  });

  test('a hunter at level 1 is raised at level 1, and the use says only that it is up', () => {
    const u = ok(useItem(deadAt(1), 'i1', [], RULES));
    expect([u.hunter.level, u.lines]).toEqual([1, [`Up at ${REVIVE_HP} HP`]]);
  });

  test('only a raising from death costs levels: a heal that stands a dying hunter up, or a natural 20, takes none', () => {
    const dying: Hunter = { ...deadAt(31), life: { at: 'dying', successes: 0, failures: 0 } };
    expect(ok(sheetEdit(dying, { type: 'life', event: { type: 'heal', amount: 5 } }, RULES)).level).toBe(31);
    expect(ok(sheetEdit(dying, { type: 'life', event: { type: 'deathSave', roll: 20 } }, RULES)).level).toBe(31);
  });

  test('a GM\'s share is read: a tenth of level 31, rounded up, takes 4', () => {
    expect(ok(sheetEdit(deadAt(31), { type: 'life', event: { type: 'revive' } }, { ...RULES, reviveLevelShare: 0.1 })).level).toBe(27);
  });

  test('the Job Change chain\'s level step hears the level lost in the same step', () => {
    const h0 = deadAt(9);
    const h = chained(h0, { type: 'issued', id: jcid('jc1'), job: 'Ranger', questId: qid('q1'), level: 9, at: '2026-11-21T12:00:00.000Z' }).hunter;
    expect(h.quests.find(q => q.id === 'q1')?.objectives[0]?.progress).toBe(9);
    const up = ok(sheetEdit(h, { type: 'life', event: { type: 'revive' } }, RULES));
    expect([up.level, up.quests.find(q => q.id === 'q1')?.objectives[0]?.progress]).toEqual([8, 8]);
  });
});

describe('a skill used on oneself outside a fight', () => {
  test('its ops land in one answer; a skill that changes nothing is refused', () => {
    const h = { ...holding(POTION, 0, 5), items: [] };
    const u = ok(useOn(h, [{ op: 'heal', amount: { kind: 'number', value: 30 } }, { op: 'note', text: 'A glow.' }], { id: null, tier: 0 }, [[], []], RULES));
    expect(u.lines).toEqual(['+5 HP', 'A glow.']);
    expect(useOn({ ...h, life: { at: 'up', hp: hpMax(h) } }, [{ op: 'cureStatus', key: statusKey('poisoned') }], { id: null, tier: 0 }, [[]], RULES)).toEqual({ ok: false, why: 'nothing' });
  });
});

describe('an item used up in a fight', () => {
  test('one leaves the bag; one not held is refused', () => {
    expect(qty(ok(spendItem(holding(POTION, 3), 'i1', RULES)))).toBe(2);
    expect(spendItem(holding(POTION, 3), 'i2', RULES)).toEqual({ ok: false, why: 'no-item' });
  });
});

describe('a use told in the same write', () => {
  const ENV: ParseEnv = { now: new Date('2026-11-15T10:00:00.000Z'), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-p1') };
  const save = () => freshSave(ENV, { onboarded: true });

  test('a player\'s report is queued in the outbox for its room, once', () => {
    const ev = newEvent('used', { by: 'd-p1:h1', who: 'Mira', what: 'boon', name: 'Second Wind', text: '', target: 'self', tell: true } as never, { device: 'd-p1', now: 1, rand: 0.5 })!;
    const s = ok(toldStep({ kind: 'post', room: room('ABCD23'), event: ev }, RULES)(save()));
    expect((s.settings.sync.outbox ?? []).map(e => [e.room, e.id])).toEqual([['ABCD23', ev.payload.eid]]);
    expect(ok(toldStep({ kind: 'post', room: room('ABCD23'), event: ev }, RULES)(s)).settings.sync.outbox, 'a post repeated is one entry').toHaveLength(1);
  });

  test('a GM\'s or solo phone logs it; told to nobody changes nothing', () => {
    const line = logLine(lid('l9'), '2026-11-15T10:00:00.000Z', 'use', hidOf('h1'), 'Mira used Boon: Second Wind', '');
    expect(ok(toldStep({ kind: 'log', line }, RULES)(save())).log[0]).toEqual(line);
    const s = save();
    expect(toldStep({ kind: 'none' }, RULES)(s)).toBe(s);
  });
});
