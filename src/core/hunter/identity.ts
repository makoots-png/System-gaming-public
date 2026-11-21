// identity.ts: how a hunter looks to the table, the emblem and the colour, and the canon seed made neutral at
// onboarding. The emblem picker (custom.js) and onboarding (onboard.js) change these only here, as `atHunter` steps
// (save-step.ts). Pure. The save's repair checks an emblem against the icons (registry/icons.ts) and a colour against the table in rules.ts. A name is
// `rename` (record.ts).
import { newEquipped } from '../save.ts';
import type { Hunter } from '../save.ts';

/** How long a hunter's name may be. */
const NAME_MAX = 60;

/** The hunter with the emblem and colour picked ('' for each: the initial and the rank's colour). */
export const withBadge = (h: Hunter, emblem: string, color: string): Hunter => ({ ...h, emblem, color });

/**
 * The never-touched canon seed hunter as a neutral one: the name given (or "Hunter"), no titles, items or skills,
 * nothing worn, only the daily quests, and the job when one is given.
 */
export function neutralSeed(h: Hunter, name: string, job?: string): Hunter {
  const { seed: _seed, ...rest } = h;
  return {
    ...rest, name: name.slice(0, NAME_MAX) || 'Hunter', titles: [], titleId: null, items: [], skills: [], equipped: newEquipped(),
    quests: h.quests.filter(q => q.kind === 'daily'), ...(job ? { job } : {}),
  };
}
