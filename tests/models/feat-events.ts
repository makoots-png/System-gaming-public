// The events of a feat on a hunter (src/core/hunter/feats.ts `featStep`), shared by tests/feats.test.ts and the state
// chart (scripts/charts/feat.ts), so both walk the same events: for a feat that earns at 2, a count of 1, a count of 2
// with its state tests holding and failing, a row broken, the feat it waits on earned, and a fact that leaves a full
// count as it was while its state tests now hold.
import type { FeatEvent } from '../../src/core/hunter/feats.ts';

export const FEAT_WALK: readonly FeatEvent[] = [
  { type: 'counted', count: { n: 1, mark: '' }, also: true },
  { type: 'counted', count: { n: 2, mark: '' }, also: true },
  { type: 'counted', count: { n: 2, mark: '' }, also: false },
  { type: 'broke', count: { n: 0, mark: '' } },
  { type: 'unlocked' },
  { type: 'again', count: { n: 2, mark: '' }, also: true },
];

/** A write, for a fact in a hunter's inbox (src/core/hunter/noticed.ts `INBOX`): whether it records a fact, and whether a fight holds the hunter as it ends. */
export type InboxWrite = { readonly records: boolean; readonly held: boolean };
export const INBOX_WALK: readonly InboxWrite[] = [
  { records: true, held: true },
  { records: false, held: true },
  { records: true, held: false },
  { records: false, held: false },
];
