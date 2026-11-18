// A thing used on its user outside a fight (src/core/hunter/use.ts) and how the GM is told of it in the same write
// (src/core/use-told.ts). Each use is one answer: what it did and the item gone, or a refusal that changes nothing.
import { describe, expect, test } from 'bun:test';
import { USE_WORDS, spendItem, useDice, useItem, useOn } from '../src/core/hunter/use.ts';
import { toldStep } from '../src/core/use-told.ts';
import { SHOP_ITEMS, itemOf } from '../src/core/registry/items.ts';
import type { ItemTemplate } from '../src/core/registry/items.ts';
import { putItem } from '../src/core/hunter/inventory.ts';
import { sheetEdit } from '../src/core/hunter/grant.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { REVIVE_HP, hpOf, lifeAfter } from '../src/core/hunter/vitals.ts';
import type { Life } from '../src/core/hunter/vitals.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import { RULES } from '../src/core/rules.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import type { Hunter, ParseEnv } from '../src/core/save.ts';
import { newEvent, useRoute } from '../src/core/protocol.ts';
import { logLine } from '../src/core/session-log.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { dev, hid as hidOf, iid, lid, room } from './fixtures/ids.ts';

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
  const CRYSTAL = shop('Resurrection Crystal');
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
