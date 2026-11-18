// The outcomes of an extraction attempt on a fallen monster (src/core/combat/extraction.ts), shared by tests/fight.test.ts
// ("a fallen monster's extraction") and the state chart (scripts/charts/extraction.ts), so both walk the same events.
import { EXTRACTION_OUTCOMES } from '../../src/core/combat/extraction.ts';
import type { ExtractionOutcome } from '../../src/core/combat/extraction.ts';

/** Every outcome, from every state. */
export const EXTRACTION_WALK: readonly ExtractionOutcome[] = EXTRACTION_OUTCOMES;
