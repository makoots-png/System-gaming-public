// The words every screen shows for a life that is not up (row-life.ts `lifeWord`). Expected values are the owner's ruling
// (docs/agent-handoff/audit/notes-dead-row.md section 7: a hunter is Dying or Dead on every phone, never Down) and the
// word a defeated monster's card already had (combat.js before unit 3: "Defeated").
import { describe, expect, test } from 'bun:test';
import { lifeWord } from '../src/core/combat/row-life.ts';
import { chipDef } from '../src/core/hunter/chips.ts';

describe('the word for a life', () => {
  test('a hunter reads Dying while the saves run, Stable once stabilized, Dead after three failures, and nothing while up', () => {
    expect(lifeWord({ kind: 'hunter', life: { at: 'dying' } })).toBe('Dying');
    expect(lifeWord({ kind: 'hunter', life: { at: 'stable' } })).toBe('Stable');
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
    for (const at of ['dying', 'stable', 'dead'] as const) expect(lifeWord({ kind: 'hunter', life: { at } })).not.toMatch(/down/i);
    expect(chipDef('down', { at: 'dying', successes: 0, failures: 2 }).label).toBe(lifeWord({ kind: 'hunter', life: { at: 'dying' } })!);
    expect(chipDef('down', { at: 'stable' }).label).toBe(lifeWord({ kind: 'hunter', life: { at: 'stable' } })!);
  });
});
