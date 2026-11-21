// The events of the app update, every kind, on a shell of two files. Shared by tests/upgrade.test.ts and the state
// chart (scripts/charts/upgrade.ts), so both walk the same events.
import { NO_UPDATE } from '../../src/core/upgrade.ts';
import type { Count, Update, UpdateEvent } from '../../src/core/upgrade.ts';

export const BUILD = 'next-build';
const OF = 2;

/** Every count a worker of two files can post: each number of files cached and failed. */
export const COUNTS: readonly Count[] = Array.from({ length: OF + 1 }, (_, done) => Array.from({ length: OF + 1 - done }, (_, failed) => ({ done, failed, of: OF }))).flat();

export const WALK_EVENTS: readonly UpdateEvent[] = [
  { type: 'refused', decision: { to: 'reload', build: BUILD } },
  { type: 'refused', decision: { to: 'stuck' } },
  { type: 'noted', kept: true },
  { type: 'noted', kept: false },
  { type: 'looked', worker: 'installing' },
  { type: 'looked', worker: 'waiting' },
  { type: 'looked', worker: 'none' },
  ...COUNTS.map(count => ({ type: 'caching' as const, count })),
  { type: 'controlled' },
  { type: 'quiet' },
];

export const STARTS: readonly Update[] = [NO_UPDATE];
