// The events of the windows (src/core/windows.ts) over two System windows, the first-run window and the dice roller's
// sheet, shared by tests/windows.test.ts and the state chart (scripts/charts/windows.ts), so both walk the same events.
import { windowId } from '../../src/core/windows.ts';
import type { WindowEvent } from '../../src/core/windows.ts';

/** Two System windows, asked one after the other. */
export const SYSTEM_WINDOWS = [windowId(1), windowId(2)] as const;
/** The first-run window (or its quick start guide), which a System window waits behind. */
export const FIRST_RUN = windowId(3);
/** The dice roller's sheet over the page (Quick Roll). */
export const QUICK_ROLL = windowId(4);
const ALL = [...SYSTEM_WINDOWS, FIRST_RUN, QUICK_ROLL];
/** Every event on each window, from every state. */
export const WINDOW_WALK: readonly WindowEvent[] = [
  ...SYSTEM_WINDOWS.map(id => ({ kind: 'ask', id }) as const),
  { kind: 'next' },
  { kind: 'open', id: FIRST_RUN, of: 'onboard' },
  { kind: 'open', id: QUICK_ROLL, of: 'sheet', sheet: 'quickRoll' },
  ...ALL.map(id => ({ kind: 'close', id }) as const),
  ...ALL.map(id => ({ kind: 'gone', id }) as const),
  ...SYSTEM_WINDOWS.map(id => ({ kind: 'answered', id }) as const),
  ...ALL.map(id => ({ kind: 'escape', id }) as const),
  { kind: 'went' },
];
