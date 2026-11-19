// The chart of a story on the table (src/core/story/run.ts `runStep`, notes-1-stories.md section 2), walked with the
// events of tests/models/story-events.ts on a story of three chapters.
import { RUN_STATES, runStep } from '../../src/core/story/run.ts';
import type { RunEvent, StoryRun } from '../../src/core/story/run.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { STORY_WALK, WALK_STORY } from '../../tests/models/story-events.ts';
import { bfs, machine } from '../statecharts.ts';

type S = StoryRun | null;
const label = (s: S): string => (!s ? 'No run' : s.state.at === 'running' ? `Running at chapter ${s.state.chapter + 1}` : `Ended at chapter ${s.state.chapter + 1}`);

function step(e: RunEvent): string {
  switch (e.type) {
    case 'turnOn': return 'the GM turns it on (chapter 1 opens)';
    case 'open': return 'the GM opens a chapter';
    case 'end': return 'the GM ends it';
  }
}

export const story = machine<S, RunEvent>({
  name: 'A story on the table',
  walked: `Every run reachable from no run, for a story of three chapters, under the ${STORY_WALK.length} events of tests/models/story-events.ts, breadth first; a run is the same state at the same chapter whatever its count of opens.`,
  walk: () => bfs<S, RunEvent>([null], s => STORY_WALK.flatMap(make => { const event = make(s), r = runStep(s, event, WALK_STORY); return isRefused(r) ? [] : [{ event, to: r.run }]; }),
    s => (s ? `${s.state.at}:${s.state.chapter}` : 'none')),
  kinds: RUN_STATES,
  kindsOf: s => [s ? s.state.at : 'none'],
  views: [{
    title: 'A story on the table, by the GM\'s taps',
    note: 'Every arrow is a tap of the GM\'s on the GM\'s phone; no clock, count, fact, quest\'s end or room message moves a run. An open goes to the next chapter, an earlier one or the same one again, for the hunters the GM ticks. A stale tap (a window drawn before the last open, an End held under Undo while the story was opened again) and an open for nobody are refused and stay in their state, so they are not drawn. Ended is final: turning the story on again makes a new run.',
    hides: '',
    state: label,
    step,
  }],
  where: [
    ['The union', '`StoryRun`, `RunState`, `RunEvent` and `RUN_STATES` in `src/core/story/run.ts`'],
    ['What changes it', '`runStep(run, event, story)` and its `TABLE`; `storyMove`, the one write of a move'],
    ['Who calls it', 'the taps of `src/views/stories.js` (the GM view\'s Stories section, its turn-on and open windows, End\'s held toast)'],
    ['The test to copy', '`tests/run.test.ts`; the walk\'s events are in `tests/models/story-events.ts`'],
    ['The recipe', 'AGENTS.md, "A state or event of the ... machine"'],
  ],
});
