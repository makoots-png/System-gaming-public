import { describe, expect, test } from 'bun:test';
import { detailOf, statusGlance } from '../src/core/detail.ts';
import { describeStatus, opLines } from '../src/core/combat/effect-ops.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
import { describeAbility } from '../src/core/registry/ability-kinds.ts';
import { SKILL_ABILITIES } from '../src/core/registry/abilities.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { describeItem } from '../src/core/effects.ts';
import { newHunter } from '../src/core/save.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { RULES } from '../src/core/rules.ts';
import { readOdds } from '../src/core/combat/odds.ts';

// The detail of a thing is core's own sentences for it, with only the line that says what it is now before them.

const BURNING = BUILT_IN_STATUSES['burning' as keyof typeof BUILT_IN_STATUSES]!;
const PAIN: StatusDef = { label: 'Pain', desc: 'It builds.', ops: [], stack: { cap: 5, leave: { kind: 'round' }, keep: 'fight', threshold: null } } as unknown as StatusDef;

describe('detailOf', () => {
  test('a status says its rounds left, then what it does at its source\'s tier, under its description', () => {
    const d = detailOf({ kind: 'status', label: 'Burning', def: BURNING, tier: 2, left: 2 }, RULES);
    expect(d).toEqual({ title: 'Burning', about: BURNING.desc, lines: ['2 rounds left.', ...describeStatus(BURNING, 2, RULES)] });
  });

  test('a stacking status says its count of its cap first', () => {
    const d = detailOf({ kind: 'status', label: 'Pain', def: PAIN, tier: 0, stacks: 3, left: null }, RULES);
    expect(d.lines[0]).toBe('3 of 5 stacks.');
    expect(d.lines.slice(1)).toEqual(describeStatus(PAIN, 0, RULES));
  });

  test('a delayed effect says when it ends rather than the rounds it has left', () => {
    const bomb = { ...BURNING, label: 'Bomb', end: { ops: [], cleanse: 'cancel' } } as unknown as StatusDef;
    expect(detailOf({ kind: 'status', label: 'Bomb', def: bomb, tier: 0, left: 1 }, RULES).lines[0]).toBe('Ends in 1 round.');
  });

  test('a status known only by its name is its name', () => {
    expect(detailOf({ kind: 'status', label: 'Hex', def: null, tier: null, left: null }, RULES)).toEqual({ title: 'Hex', about: '', lines: [] });
  });

  test('an ability says what it does, its cost, and describeAbility\'s sentences', () => {
    const a = Object.values(SKILL_ABILITIES).map(f => f(RULES)).find(x => x && x.effect && x.cost.fatigue > 0)!;
    const d = detailOf({ kind: 'ability', ability: a }, RULES);
    expect(d.title).toBe(a.name);
    expect(d.lines).toContain(`Costs ${a.cost.fatigue} fatigue${a.cost.mana ? ` and ${a.cost.mana} mana` : ''}.`);
    for (const l of describeAbility(a, RULES)) expect(d.lines).toContain(l);
  });

  test('an item says its description and what its effects do at its rarity', () => {
    const item = { name: 'Ember Flask', rar: 'uncommon', desc: 'Throw it.', effects: BURNING.ops };
    expect(detailOf({ kind: 'item', item }, RULES)).toEqual({ title: 'Ember Flask', about: 'Throw it.', lines: describeItem(RULES, item, BURNING.ops) });
  });

  test('an item in a hunter\'s bag reads its amounts on that hunter: a shield of 10 + 20% of max HP says what it comes to now', () => {
    const h = newHunter(RULES), ops = [{ op: 'shield', amount: { kind: 'binary', op: '+', left: { kind: 'number', value: 10 }, right: { kind: 'binary', op: '*', left: { kind: 'number', value: 0.2 }, right: { kind: 'sheet', whose: 'user', key: 'hpMax' } } } }] as const;
    const item = { name: 'Bulwark', rar: 'rare', effects: ops }, now = Math.round(10 + 0.2 * hunterSheet(h, RULES).sheet.hpMax);
    expect(detailOf({ kind: 'item', item, hunter: h }, RULES).lines).toEqual([`Shield: 10 + 20% of max HP (now ${now})`]);
    expect(detailOf({ kind: 'item', item }, RULES).lines).toEqual(['Shield: 10 + 20% of max HP']);
  });

  test('a zone says what its tone does, its rounds left, and its ops where the phone knows them', () => {
    expect(detailOf({ kind: 'zone', name: 'Fire', tone: 'harm', left: 3, ops: null, tier: 0 }, RULES)).toEqual({ title: 'Fire', about: 'Hurts whoever stands in it.', lines: ['3 rounds left.'] });
    expect(detailOf({ kind: 'zone', name: 'Fire', tone: 'harm', left: null, ops: BURNING.ops, tier: 1 }, RULES).lines).toEqual(opLines(BURNING.ops, 1, RULES));
  });

  test('a sheet number names its total and each part that adds something', () => {
    const h = { ...newHunter(RULES), hpAdj: 5 };
    const d = detailOf({ kind: 'number', key: 'hpMax', hunter: h }, RULES);
    expect(d.title).toMatch(/^Max HP \d+$/);
    expect(d.lines[0]).toBe(`Base ${RULES.fight.hpBase}`);
    expect(d.lines).toContain('GM\'s change +5');
    expect(d.lines.every(l => !/ \+0$/.test(l))).toBe(true);
  });
});

describe('detailOf the odds', () => {
  test('the odds\' detail is titled and says the rounds, a loss and each hunter\'s end', () => {
    const odds = readOdds({ fudge: false,
      of: 2, rows: [{ id: 'a' as never, name: 'Brakk', hpMax: 50, manaMax: 10, fatigueMax: 100 }],
      ends: [
        { outcome: 'won', rounds: 4, commands: 20, spent: [], party: { ['a' as never]: { hp: 50, mana: 10, fatigue: 0, statuses: [], used: {}, life: 'up', lifeLeft: null, kills: [] } } },
        { outcome: 'lost', rounds: 4, commands: 20, spent: [], party: { ['a' as never]: { hp: 0, mana: 2, fatigue: 0, statuses: [], used: {}, life: 'dead', lifeLeft: null, kills: [] } } },
      ],
    });
    expect(detailOf({ kind: 'odds', odds, voice: 'party' }, RULES)).toEqual({
      title: 'The odds', about: '',
      lines: ['Rounds: 4, most often about 4.', 'The party loses 50%.', 'Brakk: dead in 50%. Ends with 0 to 50 of 50 HP, 2 to 10 of 10 mana, 0 of 100 fatigue.'],
    });
    expect(detailOf({ kind: 'odds', odds, voice: 'alone' }, RULES).lines[1]).toBe('The run fails in 50%.');
  });
});

describe('statusGlance', () => {
  test('a slow on the GM\'s card says its speed at its source\'s tier without a tap: Slowed at A (the fifth tier) is −40%', () => {
    const slowed = BUILT_IN_STATUSES['slowed' as keyof typeof BUILT_IN_STATUSES]!;
    expect(statusGlance(slowed, 4, RULES)).toEqual(['Speed −40%']);
  });

  test('a stacking status says what each stack does, and leaves its cap, threshold, triggers and end to the detail', () => {
    const rot = { ...PAIN, ops: BURNING.ops, triggers: [], end: { ops: BURNING.ops, cleanse: 'cancel' } } as unknown as StatusDef;
    expect(statusGlance(rot, 2, RULES)).toEqual(opLines(BURNING.ops, 2, RULES).map(l => `Each stack: ${l}`));
    expect(statusGlance(PAIN, 0, RULES)).toEqual([]);
  });
});
