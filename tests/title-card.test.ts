// What a title's card says it gives in a fight (src/core/title-card.ts, item-stats 6.7): the active's name, its amount as
// the holder reads it, its wait and its gates, and the worn status. The expected amounts are worked from the rule here.
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { abilityId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { tiles } from '../src/core/combat/space.ts';
import { parseFormula } from '../src/core/formula.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { newHunter } from '../src/core/hunter/hunter.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { titlePowerLines } from '../src/core/title-card.ts';

const formula = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
const LAST_LIGHT: Ability = abilityOf('support', {
  id: abilityId('last-light'), name: 'Last Light', aim: 'self', shape: { kind: 'self' }, range: tiles(0), delivery: { kind: 'sure' },
  effect: { type: 'heal', by: 'hand', formula: formula('5 + 0.3 * hpmax') },
  cost: { fatigue: 0, mana: 0, time: abilityOf('support', { id: abilityId('x'), name: 'x' }, RULES).cost.time, cooldown: tick(3 * RULES.fight.round) },
}, RULES);
const GATED: Ability = { ...LAST_LIGHT, gates: [{ kind: 'uses', n: 1, per: 'fight' }] };

describe('a title card\'s powers', () => {
  test('an active heal reads its holder: the amount in words, what it comes to on them, its wait and its gate', () => {
    const body = hunterSheet(newHunter(RULES), RULES), now = Math.round(5 + 0.3 * body.sheet.hpMax);
    expect(titlePowerLines({ active: GATED }, 'C', body, RULES)).toEqual([
      'Can use in a fight: Last Light',
      `Heals: 5 + 30% of max HP (now ${now})`,
      'Ready again after 3 rounds. 1 use per fight.',
    ]);
  });

  test('with no holder the amount has no "now", and a title without powers says nothing', () => {
    expect(titlePowerLines({ active: LAST_LIGHT }, 'C', null, RULES)[1]).toBe('Heals: 5 + 30% of max HP');
    expect(titlePowerLines({}, 'E', null, RULES)).toEqual([]);
  });
});
