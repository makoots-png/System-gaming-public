// One room doc the GM's phone publishes (src/core/sync/publish.ts), from nothing due, and every event of its life, walked
// by the state chart (scripts/charts/publish.ts); tests/statecharts.test.ts checks the walk reaches every state.
// tests/publish.test.ts checks each cell and walks random events with the edge's puts.
import { PUBLISH_IDLE, PUTS } from '../../src/core/sync/publish.ts';
import type { Publish, PublishEvent } from '../../src/core/sync/publish.ts';
import type { Gen } from '../../src/core/sync/link.ts';

export const START: Publish = PUBLISH_IDLE;
/** The stretch of the link the walk's answers come in. */
export const WALK_GEN = 1 as Gen;
/** One of each event, and an answer of each kind, in the walk's stretch; and the link leaving it. */
export const WALK_EVENTS: readonly PublishEvent[] = [
  { type: 'changed', gen: WALK_GEN }, { type: 'due', gen: WALK_GEN }, ...PUTS.map(put => ({ type: 'answered', gen: WALK_GEN, put }) as const), { type: 'left' },
];
