// The words every screen shows for a life that is not up (row-life.ts `lifeWord`). Expected values are the owner's ruling
// (docs/agent-handoff/audit/notes-dead-row.md section 7: never Down; Nov 21: at 0 HP a hunter is dead) and the word a
// defeated monster's card already had (combat.js before unit 3: "Defeated").
import { describe, expect, test } from 'bun:test';
import { lifeWord } from '../src/core/combat/row-life.ts';
import { chipDef } from '../src/core/hunter/chips.ts';

describe('the word for a life', () => {
  test('a hunter at 0 HP reads Dead, and nothing while up', () => {
    expect(lifeWord({ kind: 'hunter', life: { at: 'dead' } })).toBe('Dead');
    expect(lifeWord({ kind: 'hunter', life: { at: 'up' } })).toBeNull();
  });

  test('a monster, a shadow and a summon at 0 HP read Defeated, and nothing while up', () => {
    for (const kind of ['monster', 'shadow', 'summon'] as const) {
      expect(lifeWord({ kind, life: { at: 'dead' } })).toBe('Defeated');
      expect(lifeWord({ kind, life: { at: 'up' } })).toBeNull();
    }
  });

  test('no word is Down: the sheet\'s chip at 0 HP reads the same word as every fight card', () => {
    expect(lifeWord({ kind: 'hunter', life: { at: 'dead' } })).not.toMatch(/down/i);
    expect(chipDef('dead').label).toBe(lifeWord({ kind: 'hunter', life: { at: 'dead' } })!);
  });
});
