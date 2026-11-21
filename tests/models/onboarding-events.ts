// The events of first-run setup and the quick start, every one, with each payload a step tells apart. Shared by
// tests/onboarding.test.ts and the state chart (scripts/charts/onboarding.ts), so both walk the same events.
import type { OnboardingAt, OnboardingEvent } from '../../src/core/onboarding.ts';

/** What had the focus as the ? guide opened: the chart's stand-in for the element. */
export const BACK = 'the ? button';

export const WALK_EVENTS: readonly OnboardingEvent<string>[] = [
  { type: 'start', invited: false }, { type: 'start', invited: true }, { type: 'help', back: BACK }, { type: 'gotIt' },
  { type: 'accept' }, { type: 'player' }, { type: 'gm' }, { type: 'back' }, { type: 'skip' }, { type: 'more' },
  { type: 'try' }, { type: 'missed', why: 'net' }, { type: 'missed', why: 'notfound' }, { type: 'joined' }, { type: 'begun' },
  { type: 'refused' }, { type: 'starter' }, { type: 'blank' }, { type: 'sheet' }, { type: 'join' },
  { type: 'create' }, { type: 'created' }, { type: 'createFailed', why: 'net' }, { type: 'later' },
];
/** Before the app is ready, and after: no window. */
export const STARTS: readonly OnboardingAt<string>[] = [{ at: 'shut' }];
