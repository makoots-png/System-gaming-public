// A hunter with one resting shadow and the events of a shadow's life. Shared by tests/shadows.test.ts and the state
// chart (scripts/charts/shadow.ts), so both walk the same events.
import { SHADOW_EVENTS, addShadow, newShadowOf } from '../../src/core/hunter/shadows.ts';
import type { ShadowEvent } from '../../src/core/hunter/shadows.ts';
import { RULES } from '../../src/core/rules.ts';
import { newHunter } from '../../src/core/save.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { shid } from '../fixtures/ids.ts';

/** Igris, a D-rank Elite, resting in a new hunter's army under `sh1`. */
export const ARMY = () => {
  const h = addShadow(newHunter(RULES), newShadowOf({ rank: 'D', archetype: 'brute', grade: 'Elite', monster: null, name: 'Igris' }, shid('sh1'), RULES), RULES);
  if (isRefused(h)) throw new Error(`a new hunter's army refused Igris: ${h.why}`);
  return h;
};
/** Every event, from every state. */
export const WALK_EVENTS: readonly ShadowEvent[] = SHADOW_EVENTS;
