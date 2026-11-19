// The events of a story on the table (src/core/story/run.ts `runStep`), shared by the state chart (scripts/charts/story.ts)
// and tests/run.test.ts's walk: a story of three chapters turned on for the table and for one hunter, the next chapter
// opened, an earlier one opened again, an open for nobody, a stale open, an end, and a stale end. An event is made from
// the run it meets, so its count of opens (`seen`) is the run's, or one behind for a stale tap.
import { newRewards } from '../../src/core/rewards.ts';
import type { RunEvent, StoryRun } from '../../src/core/story/run.ts';
import type { Story } from '../../src/core/story/story.ts';
import type { HunterRef } from '../../src/core/ids.ts';
import { hid, srid, stid } from '../fixtures/ids.ts';

const AT = '2026-11-19T10:00:00.000Z';
const chapter = (title: string) => ({ name: '', words: { title, line: '' }, rewards: newRewards(), quest: null, note: '' });
/** A story of three chapters. */
export const WALK_STORY: Story = { id: stid('st1'), name: 'The wager', when: '', for: 'hunters', chapters: [chapter('THE BET'), chapter('THE RUNS'), chapter('WON')] };
const MIRA: HunterRef = { kind: 'local', hunterId: hid('h1') }, BRAKK: HunterRef = { kind: 'local', hunterId: hid('h2') };
const seen = (run: StoryRun | null) => (run ? run.opens : 0);
const next = (run: StoryRun | null) => (run ? run.state.chapter + 1 : 1);

/** Each event as it is made against the run it meets. */
export const STORY_WALK: readonly ((run: StoryRun | null) => RunEvent)[] = [
  () => ({ type: 'turnOn', id: srid('sr1'), story: WALK_STORY.id, who: { at: 'table' }, to: [MIRA, BRAKK], at: AT, session: 1 }),
  () => ({ type: 'turnOn', id: srid('sr1'), story: WALK_STORY.id, who: { at: 'hunters', refs: [BRAKK] }, to: [BRAKK], at: AT, session: 1 }),
  run => ({ type: 'open', chapter: next(run), seen: seen(run), to: [BRAKK], at: AT, session: 2 }),
  run => ({ type: 'open', chapter: 0, seen: seen(run), to: [BRAKK], at: AT, session: 2 }),
  run => ({ type: 'open', chapter: next(run), seen: seen(run), to: [], at: AT, session: 2 }),
  run => ({ type: 'open', chapter: next(run), seen: seen(run) - 1, to: [BRAKK], at: AT, session: 2 }),
  run => ({ type: 'end', seen: seen(run), at: AT, session: 3 }),
  run => ({ type: 'end', seen: seen(run) - 1, at: AT, session: 3 }),
];
