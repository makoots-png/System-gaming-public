// extraction.ts: a fallen monster's shadow extraction (implicit audit row 39): the attempts made on its corpse, kept on
// its fight row (`Body.extraction`), so a reload of the GM's page gives no corpse its tries back. A small machine: the
// corpse is open with the attempts made so far, or gone (risen as a shadow, crumbled to dust on a natural 1, or out of
// attempts). The fight's `extract` command (fight.ts) is the one way it moves; the roll and the DC are src/views/shadows.js
// and src/core/hunter/shadows.ts `extractDc`.

/** A corpse's extraction: open with `tried` attempts made, or gone and why. A row with none is open with none made. */
export type Extraction = { readonly at: 'open'; readonly tried: number } | { readonly at: 'gone'; readonly why: 'risen' | 'crumbled' | 'spent' };
export const EXTRACTION_STATES = ['open', 'gone'] as const satisfies readonly Extraction['at'][];
/** What one attempt came to: under the DC, a natural 1, or the shadow rose. */
export const EXTRACTION_OUTCOMES = ['failed', 'crumbled', 'risen'] as const;
export type ExtractionOutcome = (typeof EXTRACTION_OUTCOMES)[number];
/** No attempt made yet. */
export const UNTRIED: Extraction = { at: 'open', tried: 0 };

type Cell = ((e: Extract<Extraction, { at: 'open' }>, max: number) => Extraction) | null;
/** What each outcome does from each state; null where it does not apply. An attempt that fails the last time spends the corpse. */
const TABLE: { readonly [S in Extraction['at']]: { readonly [O in ExtractionOutcome]: Cell } } = {
  open: {
    failed: (e, max) => (e.tried + 1 >= max ? { at: 'gone', why: 'spent' } : { at: 'open', tried: e.tried + 1 }),
    crumbled: () => ({ at: 'gone', why: 'crumbled' }),
    risen: () => ({ at: 'gone', why: 'risen' }),
  },
  gone: { failed: null, crumbled: null, risen: null },
};

/** The attempts left on a corpse when each may make `max` (the rules' `shadow.maxAttempts`). */
export const attemptsLeft = (e: Extraction, max: number): number => (e.at === 'open' ? Math.max(0, max - e.tried) : 0);

/** The extraction after an attempt's `outcome`, or null when the corpse takes no attempt (gone, or none left). */
export function extractionStep(e: Extraction, outcome: ExtractionOutcome, max: number): Extraction | null {
  const cell = TABLE[e.at][outcome];
  return cell && e.at === 'open' && attemptsLeft(e, max) > 0 ? cell(e, max) : null;
}
