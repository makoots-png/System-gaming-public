// The enemy types (src/core/registry/monster-types.ts) and the one thing a type means: whether a fallen monster of it
// may be extracted (balance plan sections 5 and 8; the enemy README's item 5 names Construct, Ooze and Spirit).
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { MONSTER_TYPES, monsterTypeOf, typeExtractable } from '../src/core/registry/monster-types.ts';
import { parseMonster, seedMonsters, statBlock } from '../src/core/registry/monsters.ts';
import { monsterIcon } from '../src/core/registry/icon-defaults.ts';

describe('the enemy types', () => {
  test('the sixteen types of the enemy draft; a construct, an ooze and a spirit leave no corpse to extract, every other type does', () => {
    expect(Object.keys(MONSTER_TYPES).sort()).toEqual(['aberration', 'aquatic', 'beast', 'celestial', 'construct', 'demon', 'dragon', 'elemental', 'fey', 'giant', 'humanoid', 'insect', 'ooze', 'plant', 'spirit', 'undead']);
    expect(Object.entries(MONSTER_TYPES).filter(([, t]) => !t.extractable).map(([k]) => k).sort()).toEqual(['construct', 'ooze', 'spirit']);
  });

  test('a typed type is read in any case with spaces around it; a blank or the GM\'s own type is none of them and may be extracted', () => {
    expect([monsterTypeOf('  Construct '), monsterTypeOf('OOZE'), monsterTypeOf('Shadowkin'), monsterTypeOf('')]).toEqual(['construct', 'ooze', null, null]);
    expect([typeExtractable(' spirit'), typeExtractable('Beast'), typeExtractable('Shadowkin'), typeExtractable('')]).toEqual([false, true, true, true]);
  });

  test('a monster is extractable by its own yes or no, else by its type: a seed, a new stat block and a monster read from a save', () => {
    const seeds = seedMonsters(RULES), of = (name: string) => seeds.find(m => m.name === name)!;
    expect([of('Stone Golem').type, of('Stone Golem').extractable]).toEqual(['Construct', false]);
    expect([of('Igris the Bloodred').type, of('Igris the Bloodred').extractable]).toEqual(['Undead', true]);
    expect([statBlock(RULES, 'C', { type: 'Spirit' }).extractable, statBlock(RULES, 'C', { type: 'Beast' }).extractable, statBlock(RULES, 'C').extractable]).toEqual([false, true, true]);
    expect([parseMonster({ type: 'Ooze' })!.extractable, parseMonster({ type: 'Ooze', extractable: true })!.extractable, parseMonster({ type: 'Beast', extractable: false })!.extractable]).toEqual([false, true, false]);
  });

  test('a type\'s picture is its own, a type of the GM\'s own takes its archetype\'s', () => {
    expect([monsterIcon({ type: ' Construct', archetype: 'caster' }), monsterIcon({ type: 'Shadowkin', archetype: 'caster' })]).toEqual(['golem', 'orb']);
  });
});
