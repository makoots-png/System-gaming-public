// The events of a feat on a hunter (src/core/hunter/feats.ts `featStep`), shared by tests/feats.test.ts and the state
// chart (scripts/charts/feat.ts), so both walk the same events: for a feat that earns at 2, a count of 1, a count of 2
// with its state tests holding and failing, a row broken, and the feat it waits on earned.
import type { FeatEvent } from '../../src/core/hunter/feats.ts';

export const FEAT_WALK: readonly FeatEvent[] = [
  { type: 'counted', count: { n: 1, mark: '' }, also: true },
  { type: 'counted', count: { n: 2, mark: '' }, also: true },
  { type: 'counted', count: { n: 2, mark: '' }, also: false },
  { type: 'broke', count: { n: 0, mark: '' } },
  { type: 'unlocked' },
];
