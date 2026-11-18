// The chart of a fallen monster's extraction (src/core/combat/extraction.ts `extractionStep`, implicit audit row 39),
// walked with the outcomes of tests/models/extraction-events.ts under the rules' attempts.
import { EXTRACTION_STATES, UNTRIED, extractionStep } from '../../src/core/combat/extraction.ts';
import type { Extraction, ExtractionOutcome } from '../../src/core/combat/extraction.ts';
import { RULES } from '../../src/core/rules.ts';
import { EXTRACTION_WALK } from '../../tests/models/extraction-events.ts';
import { bfs, machine } from '../statecharts.ts';

const MAX = RULES.shadow.maxAttempts;
// TODO(copy): the words of a corpse's extraction
const GONE: { readonly [W in Extract<Extraction, { at: 'gone' }>['why']]: string } = { risen: 'Risen as a shadow', crumbled: 'Crumbled to dust', spent: 'No attempts left' };

function step(e: ExtractionOutcome): string {
  switch (e) {
    case 'failed': return 'the roll misses the DC';
    case 'crumbled': return 'a natural 1';
    case 'risen': return 'the roll meets the DC, or a natural 20: the shadow joins the army in the same write';
  }
}

export const extraction = machine<Extraction, ExtractionOutcome>({
  name: 'A fallen monster\'s extraction',
  walked: `Every state reachable from a corpse with no attempt made, at the rules' ${MAX} attempts, under the ${EXTRACTION_WALK.length} outcomes of tests/models/extraction-events.ts, breadth first.`,
  walk: () => bfs([UNTRIED], e => EXTRACTION_WALK.flatMap(event => { const to = extractionStep(e, event, MAX); return to ? [{ event, to }] : []; }), e => JSON.stringify(e)),
  kinds: EXTRACTION_STATES,
  kindsOf: e => [e.at],
  views: [{
    title: 'The attempts on one corpse',
    note: 'The fight\'s `extract` command moves it, on a monster at 0 HP, while the fight is set up, running or over; nothing else changes it, and no time passes. A corpse with no attempt left is refused (`noAttempts`). The DC and the roll are src/views/shadows.js and `extractDc` in src/core/hunter/shadows.ts.',
    hides: '',
    state: e => (e.at === 'open' ? `${MAX - e.tried} of ${MAX} attempts left` : GONE[e.why]),
    step,
  }],
  where: [
    ['The union', '`Extraction`, `ExtractionOutcome`, `EXTRACTION_STATES` and `EXTRACTION_OUTCOMES` in `src/core/combat/extraction.ts`; the row\'s is `Body.extraction`'],
    ['What changes it', '`extractionStep(extraction, outcome, max)` and its `TABLE`, through the fight\'s `extract` (`src/core/combat/fight.ts`)'],
    ['Who calls it', '`app.api.combat.extracted` (`src/views/combat.js`), from the extraction roll in `src/views/shadows.js`'],
    ['The test to copy', '`tests/fight.test.ts` ("a fallen monster\'s extraction"); the walk\'s outcomes are in `tests/models/extraction-events.ts`'],
    ['The recipe', 'AGENTS.md, "A combat command"'],
  ],
});
