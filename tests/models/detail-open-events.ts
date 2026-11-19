// The events of one list's open detail (src/core/detail-open.ts), over two keys, shared by tests/detail-open.test.ts and
// the state chart (scripts/charts/detail-open.ts), so both walk the same events.
import type { DetailEvent } from '../../src/core/detail-open.ts';

/** Two things of one list. */
export const DETAIL_KEYS = ['a', 'b'] as const;
/** Every event on either key, from every state. */
export const DETAIL_WALK: readonly DetailEvent[] = [
  ...DETAIL_KEYS.map(key => ({ kind: 'toggle', key }) as const),
  { kind: 'close' },
  ...DETAIL_KEYS.map(key => ({ kind: 'drop', key }) as const),
];
