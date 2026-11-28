// Walk events for the GM `_intro` write machine (src/core/sync/intro-write.ts), walked by scripts/charts/intro-write.ts
// and verified by tests/statecharts.test.ts.
import { introStart, introStep } from '../../src/core/intro.ts';
import { INTRO_WRITE_IDLE, INTRO_WRITE_PUTS } from '../../src/core/sync/intro-write.ts';
import type { IntroWrite, IntroWriteEvent } from '../../src/core/sync/intro-write.ts';
import type { Gen } from '../../src/core/sync/link.ts';

export const START: IntroWrite<string> = INTRO_WRITE_IDLE;
export const WALK_GEN = 1 as Gen;

const DOC_0 = introStart('run-1', '2026-11-27T20:00:00.000Z');
const DOC_1 = introStep(DOC_0, 1, '2026-11-27T20:00:01.000Z')!;

export const WALK_EVENTS: readonly IntroWriteEvent<string>[] = [
  { type: 'write', gen: WALK_GEN, doc: DOC_0, reply: 'w1' },
  { type: 'write', gen: WALK_GEN, doc: DOC_1, reply: 'w2' },
  ...INTRO_WRITE_PUTS.map(put => ({ type: 'answered', gen: WALK_GEN, put }) as const),
  { type: 'due', gen: WALK_GEN },
  { type: 'left' },
];
