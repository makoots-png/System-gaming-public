// A hunter with one resting shadow and the events of a shadow's life. Shared by tests/shadows.test.ts and the state
// chart (scripts/charts/shadow.ts), so both walk the same events.
import { addShadow, newShadowOf } from '../../src/core/hunter/shadows.ts';
import type { ShadowEvent, ShadowOrigin } from '../../src/core/hunter/shadows.ts';
import { shadowSheet } from '../../src/core/combat/rows.ts';
import { RULES } from '../../src/core/rules.ts';
import { newHunter } from '../../src/core/save.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { shid } from '../fixtures/ids.ts';

const IGRIS: ShadowOrigin = { rank: 'D', archetype: 'brute', grade: 'Elite', monster: null, name: 'Igris' };
/** Igris, a D-rank Elite, resting at full HP in a new hunter's army under `sh1`. */
export const ARMY = () => {
  const h = addShadow(newHunter(RULES), newShadowOf(IGRIS, shid('sh1'), RULES), RULES);
  if (isRefused(h)) throw new Error(`a new hunter's army refused Igris: ${h.why}`);
  return h;
};
/** Every event, from every state: a fight that leaves Igris at 1 HP and one that leaves it at 0, and Full HP. */
export const WALK_EVENTS: readonly ShadowEvent[] = [
  { kind: 'summon' }, { kind: 'dismiss' }, { kind: 'release' },
  { kind: 'fought', hp: 1 }, { kind: 'fought', hp: 0 }, { kind: 'heal', hpMax: shadowSheet(IGRIS, RULES).hpMax },
];
