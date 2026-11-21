// draft.ts: a maker's form from open to close (SMX-views-2), and a story as the story maker holds it until Save
// (SMX-gates-9, the story half). The maker shell (src/views/maker.js) holds a `Draft` and moves it only by `draftStep`:
// every way the form changes (a field, a button, a painted tile), leaves (Escape, a press beside it) or closes (Cancel,
// Save) is an event of the table, and only the step's answer asks "Discard changes?" or closes the window. The story
// maker keeps each chapter whole, open or folded, and `storyProblem` reads every chapter at Save. No DOM here.
import type { QuestFormDraft } from './api.ts';
import { newRewards } from './rewards.ts';
import type { Rewards, SystemWords } from './rewards.ts';
import { CHAPTER_MAX, chapterSize, parseStory } from './story/story.ts';
import type { ChapterQuest, StoryFor } from './story/story.ts';

/**
 * A maker's form: `clean` until the GM changes it, `edited` after, `asking` while "Discard changes?" is up, `closed`
 * once the window went (no event moves it again, so the window closes once).
 */
export type Draft = 'clean' | 'edited' | 'asking' | 'closed';
export const DRAFTS = ['clean', 'edited', 'asking', 'closed'] as const satisfies readonly Draft[];
/**
 * What happens to a maker's form: `changed` (a field typed, picked or ticked, a button of the form pressed), `painted` (a
 * tile painted on a surface that has no field, the map maker's grid), `leave` (Escape, or a press beside the window),
 * `kept` and `dropped` (the GM's answer to "Discard changes?"), `closed` (Cancel, Save, or the body closing it).
 */
export type DraftEvent = 'changed' | 'painted' | 'leave' | 'kept' | 'dropped' | 'closed';
export const DRAFT_EVENTS = ['changed', 'painted', 'leave', 'kept', 'dropped', 'closed'] as const satisfies readonly DraftEvent[];
/** What the shell does after a step: nothing, ask "Discard changes?", or close the window. */
export type DraftThen = 'nothing' | 'ask' | 'close';
export type DraftStep = { readonly draft: Draft; readonly then: DraftThen };

const go = (draft: Draft, then: DraftThen = 'nothing'): DraftStep => ({ draft, then });
/**
 * Each state's moves; an event a state does not list is refused (the form stays as it is, and nothing happens). Cancel
 * and Save are the GM's own choice and close without asking; an answer comes only while the question is up; a change
 * cannot arrive while the question covers the form, and a second Escape there is the question's own.
 */
const MOVES: { readonly [D in Draft]: Partial<Record<DraftEvent, DraftStep>> } = {
  clean: { changed: go('edited'), painted: go('edited'), leave: go('closed', 'close'), closed: go('closed', 'close') },
  edited: { changed: go('edited'), painted: go('edited'), leave: go('asking', 'ask'), closed: go('closed', 'close') },
  asking: { kept: go('edited'), dropped: go('closed', 'close'), closed: go('closed', 'close') },
  closed: {},
};

/** The form after `e`, and what the shell does. */
export function draftStep(d: Draft, e: DraftEvent): DraftStep {
  return MOVES[d][e] ?? go(d);
}

/**
 * A chapter's quest as the story maker holds it: as the quest form answered it, or as saved when its chapter has not been
 * opened since. Either is the whole quest, its "If it fails" cost included; the parser keeps what a chapter keeps.
 */
export type ChapterQuestDraft = QuestFormDraft | ChapterQuest;
/** A chapter as the story maker holds it, open or folded. */
export type ChapterDraft = { readonly name: string; readonly words: SystemWords; readonly rewards: Rewards; readonly quest: ChapterQuestDraft | null; readonly note: string };
/** A story as the story maker holds it: what `parseStory` reads at Save. */
export type StoryDraft = { readonly name: string; readonly when: string; readonly for: StoryFor; readonly chapters: readonly ChapterDraft[] };
/**
 * What stops a save, in the maker's words, the place of the chapter it is about (-1: the story's own fields), and whether
 * it is that chapter's quest (the maker then lets the quest form put the cursor where it is).
 */
export type StoryProblem = { readonly why: string; readonly at: number; readonly inQuest: boolean };

/** A new chapter: a window title to write and nothing else. */
export const newChapter = (): ChapterDraft => ({ name: '', words: { title: '', line: '' }, rewards: newRewards(), quest: null, note: '' });
/** A new chapter quest: every field of the quest form, empty. */
export const newChapterQuest = (): QuestFormDraft => ({
  kind: 'side', title: '', desc: '', objectives: [], rewards: newRewards(), onFail: newRewards(), penaltyText: '', dueHours: null, dueAt: null,
});

/** What stops chapter `i`'s quest from saving, or '' (a Job Change quest gives a job; a half-written row is the form's to say). */
function questProblem(q: ChapterQuestDraft, i: number): string {
  if (!q.title.trim()) return `Give chapter ${i + 1}'s quest a title.`;
  if (q.kind === 'job' && !q.rewards.job) return `Chapter ${i + 1}'s quest: Choose a job for a job quest.`;
  return '';
}

/**
 * The first thing that stops the story from saving, or null: a name, then each chapter in order, open or folded (a window
 * title, its quest's), then a chapter too large to send to the players' phones.
 */
export function storyProblem(d: StoryDraft): StoryProblem | null {
  if (!d.name.trim()) return { why: 'Name the story.', at: -1, inQuest: false };
  for (const [i, c] of d.chapters.entries()) {
    if (!c.words.title.trim()) return { why: `Give chapter ${i + 1} a window title.`, at: i, inQuest: false };
    const why = c.quest ? questProblem(c.quest, i) : '';
    if (why) return { why, at: i, inQuest: true };
  }
  const read = parseStory(d);
  const big = read ? read.chapters.findIndex(c => chapterSize(c) > CHAPTER_MAX) : -1;
  return big >= 0 ? { why: `Chapter ${big + 1} is too large to send to players' phones. Give it fewer items.`, at: big, inQuest: false } : null;
}
