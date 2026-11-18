// The events of first-run setup, every one. Shared by tests/onboarding.test.ts and the state chart
// (scripts/charts/onboarding.ts), so both walk the same events.
import { ONBOARD_EVENTS } from '../../src/core/onboarding.ts';
import type { OnboardEvent, OnboardStep } from '../../src/core/onboarding.ts';

export const WALK_EVENTS: readonly OnboardEvent[] = ONBOARD_EVENTS;
/** The two ways setup opens: a plain new install, and one opened from a room's invite link. */
export const STARTS: readonly OnboardStep[] = ['welcome', 'invite'];
