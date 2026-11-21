// A maker's form from open to close (src/core/draft.ts `draftStep`), and what stops a story from saving
// (`storyProblem`), read for every chapter whether the maker has it open or folded.
import { describe, expect, test } from 'bun:test';
import { DRAFTS, DRAFT_EVENTS, draftStep, storyProblem } from '../src/core/draft.ts';
import type { ChapterDraft, Draft, DraftEvent, DraftStep, StoryDraft } from '../src/core/draft.ts';
import type { QuestFormDraft } from '../src/core/api.ts';
import { newRewards } from '../src/core/rewards.ts';
import { parseStory } from '../src/core/story/story.ts';

const stay = (draft: Draft): DraftStep => ({ draft, then: 'nothing' });
const close: DraftStep = { draft: 'closed', then: 'close' };

/**
 * Every state against every event. A change marks the form edited, a painted tile as much as a typed field; leaving an
 * untouched form closes it, leaving an edited one asks; the answer comes only while asking; Cancel and Save close from
 * any open form without asking; a closed form takes nothing more, so its window closes once.
 */
const TABLE: Record<Draft, Record<DraftEvent, DraftStep>> = {
  clean: { changed: stay('edited'), painted: stay('edited'), leave: close, kept: stay('clean'), dropped: stay('clean'), closed: close },
  edited: { changed: stay('edited'), painted: stay('edited'), leave: { draft: 'asking', then: 'ask' }, kept: stay('edited'), dropped: stay('edited'), closed: close },
  asking: { changed: stay('asking'), painted: stay('asking'), leave: stay('asking'), kept: stay('edited'), dropped: close, closed: close },
  closed: { changed: stay('closed'), painted: stay('closed'), leave: stay('closed'), kept: stay('closed'), dropped: stay('closed'), closed: stay('closed') },
};

describe('a maker\'s form', () => {
  for (const d of DRAFTS) {
    for (const e of DRAFT_EVENTS) {
      test(`${d}, then ${e}: ${TABLE[d][e].draft}${TABLE[d][e].then === 'nothing' ? '' : `, and the shell ${TABLE[d][e].then === 'ask' ? 'asks "Discard changes?"' : 'closes the window'}`}`, () => {
        expect(draftStep(d, e)).toEqual(TABLE[d][e]);
      });
    }
  }

  test('walls painted on a new map and nothing else, then Escape: the GM is asked before the map is lost (SMX-views-2.1)', () => {
    const painted = draftStep('clean', 'painted').draft;
    expect(draftStep(painted, 'leave')).toEqual({ draft: 'asking', then: 'ask' });
  });

  test('Escape twice on an edited form asks once; Keep editing leaves the form as it was, and a press beside it then asks again', () => {
    const asking = draftStep('edited', 'leave').draft;
    expect(draftStep(asking, 'leave').then).toBe('nothing');
    const kept = draftStep(asking, 'kept').draft;
    expect(draftStep(kept, 'leave')).toEqual({ draft: 'asking', then: 'ask' });
  });
});

const quest = (over: Partial<QuestFormDraft> = {}): QuestFormDraft => ({
  kind: 'side', title: 'Clear a gate', desc: '', objectives: [], rewards: newRewards(), onFail: newRewards(), penaltyText: '', dueHours: null, dueAt: null, ...over,
});
const chapter = (title: string, q: QuestFormDraft | null = null): ChapterDraft => ({ name: '', words: { title, line: '' }, rewards: newRewards(), quest: q, note: '' });
const story = (...chapters: ChapterDraft[]): StoryDraft => ({ name: 'The debt', when: '', for: 'table', chapters });

describe('what stops a story from saving', () => {
  test('a story of two finished chapters saves', () => {
    expect(storyProblem(story(chapter('The offer'), chapter('The price', quest())))).toBeNull();
  });

  test('a story with no name: the story\'s own fields', () => {
    expect(storyProblem({ ...story(chapter('The offer')), name: '  ' })).toEqual({ why: 'Name the story.', at: -1, inQuest: false });
  });

  test('a second chapter with no window title: chapter 2', () => {
    expect(storyProblem(story(chapter('The offer'), chapter(' ')))).toEqual({ why: 'Give chapter 2 a window title.', at: 1, inQuest: false });
  });

  test('a quest with no title in chapter 2: chapter 2', () => {
    expect(storyProblem(story(chapter('The offer'), chapter('The price', quest({ title: '' }))))).toEqual({ why: 'Give chapter 2\'s quest a title.', at: 1, inQuest: true });
  });

  test('a Job Change quest with no job in chapter 1, folded while chapter 2 is open: chapter 1 says to choose a job (SMX-gates-9.2)', () => {
    const folded = chapter('The offer', quest({ kind: 'job' }));
    expect(storyProblem(story(folded, chapter('The price')))).toEqual({ why: 'Chapter 1\'s quest: Choose a job for a job quest.', at: 0, inQuest: true });
  });

  test('a Job Change quest that gives a job saves', () => {
    expect(storyProblem(story(chapter('The offer', quest({ kind: 'job', rewards: { ...newRewards(), job: 'Necromancer' } }))))).toBeNull();
  });

  test('the first chapter at fault is the one named, whatever its kind of fault', () => {
    expect(storyProblem(story(chapter('One', quest({ kind: 'job' })), chapter('')))).toEqual({ why: 'Chapter 1\'s quest: Choose a job for a job quest.', at: 0, inQuest: true });
  });

  test('a chapter quest\'s "If it fails" cost is in what the parser reads from the draft (SMX-gates-9.1)', () => {
    const costly = quest({ onFail: { ...newRewards(), gold: -50 } });
    const read = parseStory(story(chapter('The price', costly)));
    expect(read?.chapters[0]?.quest?.onFail.gold).toBe(-50);
  });
});
