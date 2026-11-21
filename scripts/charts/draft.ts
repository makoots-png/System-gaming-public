// The chart of a maker's form from open to close (src/core/draft.ts `draftStep`, audit SMX-views-2), walked with every
// event of the form from a form just opened.
import { DRAFTS, DRAFT_EVENTS, draftStep } from '../../src/core/draft.ts';
import type { Draft, DraftEvent } from '../../src/core/draft.ts';
import { bfs, machine } from '../statecharts.ts';

const WORDS: { readonly [D in Draft]: string } = {
  clean: 'Open, unchanged',
  edited: 'Open, changed',
  asking: '"Discard changes?" up',
  closed: 'Closed',
};
const ARROWS: { readonly [E in DraftEvent]: string } = {
  changed: 'a field typed, picked or ticked, or a button of the form',
  painted: 'a tile painted (the map maker\'s grid)',
  leave: 'Escape, or a press beside the window',
  kept: 'the question cancelled',
  dropped: 'Discard tapped',
  closed: 'Cancel or Save',
};

export const draft = machine<Draft, DraftEvent>({
  name: 'A maker\'s form',
  walked: `Every state reachable from a form just opened, under the ${DRAFT_EVENTS.length} events of the form, breadth first.`,
  walk: () => bfs<Draft, DraftEvent>(['clean'], s => DRAFT_EVENTS.flatMap(event => { const to = draftStep(s, event).draft; return to === s ? [] : [{ event, to }]; }), s => s),
  kinds: DRAFTS,
  kindsOf: s => [s],
  views: [{
    title: 'A maker\'s form, from open to close',
    note: 'Every maker runs this one form in the maker shell (src/views/maker.js). Only the step\'s answer asks "Discard changes?" or closes the window, so a form closes once. Cancel and Save are the GM\'s own choice and close without asking; a change cannot arrive while the question covers the form, and a second Escape there is the question\'s own. At Save the story maker reads every chapter, open or folded (`storyProblem`), and puts the cursor on the first thing that stops it.',
    hides: '',
    state: s => WORDS[s],
    step: e => ARROWS[e],
  }],
  where: [
    ['The union', '`Draft`, `DraftEvent`, `DraftThen`, `DRAFTS` and `DRAFT_EVENTS` in `src/core/draft.ts`'],
    ['What changes it', '`draftStep(draft, event)` and its `MOVES`'],
    ['Who calls it', '`src/views/maker.js`, the maker shell, which holds the one `draft` of an open maker and moves it only by `draftStep`'],
    ['The test to copy', '`tests/draft.test.ts`'],
    ['The recipe', 'docs/guide/makers.md, the maker\'s form row'],
  ],
});
