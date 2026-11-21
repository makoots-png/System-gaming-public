// The powers a held thing gives (src/core/registry/powers.ts, item-stats 6.1): one shape on an item and a title, one
// parser. The expected values come from the status and ability parsers, which each part is read by, and from the sizes
// of size.ts: a part refused is dropped, a part past its size refuses the thing that holds it whole.
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { abilityId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { parseAbility, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { tiles } from '../src/core/combat/space.ts';
import { parseFormula } from '../src/core/formula.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { parseItem } from '../src/core/registry/items.ts';
import { parsePowers } from '../src/core/registry/powers.ts';
import { parseRewards } from '../src/core/rewards.ts';
import { newHunter, parseSheetHunter } from '../src/core/hunter/hunter.ts';
import { THING_MAX, bytesOf } from '../src/core/size.ts';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const formula = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
/** Bulwark: a shield of 10 + 20% of max HP on its user, ready again 3 rounds later. */
const BULWARK: Ability = abilityOf('support', {
  id: abilityId('bulwark'), name: 'Bulwark', aim: 'self', shape: { kind: 'self' }, range: tiles(0), delivery: { kind: 'sure' },
  effect: { type: 'shield', by: 'hand', formula: formula('10 + 0.2 * hpmax') },
  cost: { fatigue: 0, mana: 0, time: abilityOf('support', { id: abilityId('x'), name: 'x' }, RULES).cost.time, cooldown: tick(3 * RULES.fight.round) },
}, RULES);
const STEADY = { label: 'Steady', desc: 'Holds the line.', ops: [{ op: 'stat', key: 'dis', amount: 2 }] };
const wideNote = { op: 'note', text: 'ࠀ'.repeat(200) };
/** A status of `n` notes of 200 three-byte characters: 7 are under a status's size, 12 are over it (tests/size.test.ts). */
const heavyDef = (n: number) => ({ label: 'Heavy', desc: '', ops: Array(n).fill(wideNote) });
/** Bulwark applying `n` statuses of 7 such notes each: 1 is under an ability's size, 3 are over it. */
const heavyActive = (n: number) => ({ ...BULWARK, ops: Array.from({ length: n }, (_, i) => ({ op: 'applyStatus', key: `s${i}`, duration: null, def: heavyDef(7) })) });

const ring = (o: Record<string, unknown>) => ({ name: 'Bulwark Ring', type: 'accessory', slot: 'ring1', rar: 'rare', ...o });
const titled = (o: Record<string, unknown>) => parseRewards({ title: { name: 'Last Light', desc: '', ...o } })?.title ?? null;

describe('one shape on an item and a title', () => {
  test('an item and a title read the same powers: the worn status by the status parser, the active by the ability parser', () => {
    const raw = { worn: copy(STEADY), active: copy(BULWARK) };
    const expected = { worn: parseStatusDef(STEADY, RULES)!, active: parseAbility(BULWARK, RULES)! };
    expect(expected.active, 'Bulwark reads as an ability').toEqual(BULWARK);
    expect(parsePowers(copy(raw))).toEqual(expected);
    expect(parseItem(ring(copy(raw)))).toMatchObject(expected);
    expect(titled(copy(raw))).toMatchObject(expected);
  });

  test('a held title keeps its powers through the hunter\'s repair, read the same way', () => {
    const h = { ...newHunter(RULES), id: 'h1', titles: [{ id: 't1', name: 'Last Light', desc: '', bonus: {}, worn: copy(STEADY), active: copy(BULWARK) }] };
    const read = parseSheetHunter(copy(h))!;
    expect(read.titles[0]).toMatchObject({ worn: parseStatusDef(STEADY, RULES)!, active: BULWARK });
    const broken = parseSheetHunter(copy({ ...h, titles: [{ ...h.titles[0]!, active: { name: 'no kind' } }] }))!;
    expect(broken.titles[0], 'an active that does not read is dropped; the worn status stays').toMatchObject({ worn: { label: 'Steady' } });
    expect(broken.titles[0]).not.toHaveProperty('active');
  });

  test('a thing with no powers holds neither part', () => {
    expect(parsePowers({})).toEqual({});
    expect(parseItem(ring({}))).not.toHaveProperty('active');
    expect(titled({})).toEqual({ name: 'Last Light', desc: '', bonus: {} });
  });
});

describe('each part read on its own', () => {
  test('a malformed active is refused as the ability parser refuses it: dropped, and the worn status kept', () => {
    for (const bad of [{ name: 'no kind' }, { ...BULWARK, cost: null }, { ...BULWARK, id: '' }, 'Bulwark', 5]) {
      expect(parseAbility(bad, RULES), JSON.stringify(bad)).toBeNull();
      expect(parsePowers({ worn: STEADY, active: bad }), JSON.stringify(bad)).toEqual({ worn: parseStatusDef(STEADY, RULES)! });
      expect(parseItem(ring({ worn: STEADY, active: bad }))).not.toHaveProperty('active');
      expect(titled({ worn: STEADY, active: bad })).not.toHaveProperty('active');
    }
  });

  test('a malformed worn status is dropped, and the active kept', () => {
    expect(parsePowers({ worn: { label: 5 }, active: BULWARK })).toEqual({ active: BULWARK });
  });

  test('an active that claims a bag item spends none: the claim is dropped', () => {
    expect(parsePowers({ active: { ...BULWARK, item: 'i1' } })).toEqual({ active: BULWARK });
  });
});

describe('the size of the powers', () => {
  test('a part past its size refuses the powers, and the item or title that holds them whole', () => {
    expect(bytesOf(heavyDef(12))).toBeGreaterThan(THING_MAX.status);
    expect(bytesOf(heavyActive(3))).toBeGreaterThan(THING_MAX.ability);
    expect(parseAbility(heavyActive(3), RULES)).toBeNull();
    for (const over of [{ worn: heavyDef(12) }, { active: heavyActive(3) }, { worn: STEADY, active: heavyActive(3) }]) {
      expect(parsePowers(over)).toBeNull();
      expect(parseItem(ring(over))).toBeNull();
      expect(titled(over)).toBeNull();
    }
  });

  test('an item holds its powers inside an item\'s size: a worn status and an active each within theirs, past it together, refuse the item', () => {
    const worn = heavyDef(7), active = heavyActive(1);
    expect(parseStatusDef(worn, RULES), 'the worn status is within a status\'s size').not.toBeNull();
    expect(parseAbility(active, RULES), 'the active is within an ability\'s size').not.toBeNull();
    expect(bytesOf(ring({ worn, active }))).toBeGreaterThan(THING_MAX.item);
    expect(parseItem(ring({ worn, active }))).toBeNull();
    expect(parseItem(ring({ worn })), 'the worn status alone fits').not.toBeNull();
  });
});
