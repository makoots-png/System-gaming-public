// story/story.ts: a story as content, the GM's arc of chapters (docs/agent-handoff/features/notes-1-stories.md, sections
// 1 and 6). Pure. A chapter holds only what the game already gives in one step: a System window's words, a reward that
// `grant` gives, a quest issued from the GM, and a note only the GM reads. `parseStory` is its one reader from outside
// data, run by the save's repair (`library.stories`), by a pack and by the maker. `chapterLanded` gives one chapter to
// one hunter, the step the GM's phone runs for its own hunters and a player's phone for its own. Nothing here decides
// when a chapter opens or moves a story: only the GM's tap does that, through the run's machine (run.ts).
// A new part of a chapter is the recipe "A part of a chapter" (notes section 9): a field of `Chapter`, its reader in
// `parseChapter`, its words in `chapterWindow` and `storyLines`, and a case in tests/story.test.ts.
import { dueAt } from '../day.ts';
import { grant, idsFrom } from '../hunter/grant.ts';
import type { Day, Granted, VitalsAt } from '../hunter/grant.ts';
import { record } from '../hunter/chronicle.ts';
import { cleanObjectives, issueQuest, withTold } from '../hunter/quests.ts';
import { GM_QUEST_KINDS } from '../hunter/quest-rights.ts';
import { newRewards, parseRewards, parseWords, rewardLines } from '../rewards.ts';
import type { RewardRules, Rewards, SystemWords } from '../rewards.ts';
import type { HunterId, StoryId } from '../ids.ts';
import { oneOf } from '../one-of.ts';
import type { Objective, Save } from '../save.ts';
import { isRefused } from '../save-step.ts';
import type { Refused } from '../save-step.ts';

/**
 * The bounds of a story. Names as a bundle's (60), the "when" line as a window's line (200), a note as a quest's penalty
 * text (300); a chapter's quest keeps the quest's own bounds, with at most 10 objectives (the room's) and a due time of at
 * most 999 hours (the quest form's "Due in hours").
 */
export const STORY_BOUNDS = { name: 60, when: 200, chapterName: 60, note: 300, questTitle: 120, questDesc: 500, penaltyText: 300, objectives: 10, dueHours: 999 } as const;
/** The most chapters a story holds. */
export const CHAPTERS_MAX = 16;
/**
 * The most bytes of a chapter a player's phone may be sent (`chapterSize`): 48 KiB, so the room's message with 24 sheet
 * keys and its wrapper stays under the server's 64 KiB body (notes 4.2).
 */
export const CHAPTER_MAX = 49_152;

/** Who a story is turned on for first: the whole table, or hunters the GM chooses. */
export const STORY_FOR = ['table', 'hunters'] as const;
export type StoryFor = (typeof STORY_FOR)[number];

/**
 * A chapter's quest as the GM writes it ahead: the quest form's fields, with its due time as hours from when the chapter
 * opens (`null`: none), since a time cannot be known until then.
 */
export type ChapterQuest = {
  readonly kind: (typeof GM_QUEST_KINDS)[number]; readonly title: string; readonly desc: string; readonly objectives: readonly Objective[];
  readonly rewards: Rewards; readonly dueHours: number | null; readonly penaltyText: string;
};
export type Chapter = {
  /** Only the GM reads it ("The offer"); blank reads as "Chapter 2". */
  readonly name: string;
  /** The window each hunter it opens for sees: a title in the System's voice and one plain line. A chapter needs a title. */
  readonly words: SystemWords;
  /** Given to each hunter it opens for, by `grant`. Empty gives nothing; a negative XP, gold or points takes away. */
  readonly rewards: Rewards;
  /** Issued to each hunter it opens for, from the GM, or none. Completing it opens nothing. */
  readonly quest: ChapterQuest | null;
  /** Only the GM reads it: what to ask the table, or when the GM thinks the chapter is done. */
  readonly note: string;
};
export type Story = {
  readonly id: StoryId; readonly name: string;
  /** Only the GM reads it: when to turn it on ("When a hunter spares a foe that can speak"). */
  readonly when: string;
  readonly for: StoryFor;
  /** 1 to `CHAPTERS_MAX`, in order. */
  readonly chapters: readonly Chapter[];
};
/** A story without its id: what the parser answers and a pack carries. The save's repair and the maker give it its id. */
export type StoryTemplate = Omit<Story, 'id'>;

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Trimmed text cut to `n`, or '' when it is not text. */
const text = (v: unknown, n: number): string => (typeof v === 'string' ? v.trim().slice(0, n) : '');
/** At most `n` entries of a list, each read by `read`; one it refuses (null) is dropped. Not a list: none. */
function listOf<T>(v: unknown, n: number, read: (x: unknown) => T | null): T[] {
  const out: T[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    if (out.length >= n) break;
    const x = read(raw);
    if (x !== null) out.push(x);
  }
  return out;
}

/** Hours above 0, cut to `STORY_BOUNDS.dueHours`; anything else is no due time, as `dueAt` in day.ts answers for it. */
const hours = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, STORY_BOUNDS.dueHours) : null);

/**
 * A chapter's quest from outside data, or null when it is not an object or has no title. A kind the GM may not issue is
 * a side quest; each objective is read by `cleanObjectives`, at most 10, its progress 0; the reward by `parseRewards`.
 */
export function parseChapterQuest(v: unknown): ChapterQuest | null {
  if (!isObj(v)) return null;
  const B = STORY_BOUNDS, title = text(v.title, B.questTitle);
  if (!title) return null;
  return {
    kind: oneOf(v.kind, GM_QUEST_KINDS, 'side'), title, desc: text(v.desc, B.questDesc),
    objectives: cleanObjectives(v.objectives).slice(0, B.objectives).map(o => ({ ...o, progress: 0 })),
    rewards: parseRewards(v.rewards) ?? newRewards(), dueHours: hours(v.dueHours), penaltyText: text(v.penaltyText, B.penaltyText),
  };
}

/** A chapter from outside data, or null when it has no window title (`parseWords`). */
function parseChapter(v: unknown): Chapter | null {
  if (!isObj(v)) return null;
  const words = parseWords(v.words);
  if (!words) return null;
  return {
    name: text(v.name, STORY_BOUNDS.chapterName), words, rewards: parseRewards(v.rewards) ?? newRewards(),
    quest: parseChapterQuest(v.quest), note: text(v.note, STORY_BOUNDS.note),
  };
}

/**
 * A story from outside data, without its id, or null when it is not an object, has no name, or has no chapter left. A
 * field of the wrong type takes its default; text is trimmed and cut to its bound; the first `CHAPTERS_MAX` chapters
 * that read are kept, a chapter without a window title dropped. Every other key is dropped.
 */
export function parseStory(v: unknown): StoryTemplate | null {
  if (!isObj(v)) return null;
  const name = text(v.name, STORY_BOUNDS.name), chapters = listOf(v.chapters, CHAPTERS_MAX, parseChapter);
  if (!name || !chapters.length) return null;
  return { name, when: text(v.when, STORY_BOUNDS.when), for: oneOf(v.for, STORY_FOR, 'table'), chapters };
}

/** The UTF-8 bytes of `s`: one for a code point below 128, two below 2,048, three below 65,536, four above. */
function utf8Bytes(s: string): number {
  let n = 0;
  for (const ch of s) { const c = ch.codePointAt(0)!; n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; }
  return n;
}
/**
 * The bytes a player's phone is sent of a chapter: the UTF-8 of the JSON of its words, reward and quest (its name and note
 * stay on the GM's phone). A chapter past `CHAPTER_MAX` cannot be sent.
 */
export const chapterSize = (c: Pick<Chapter, 'words' | 'rewards' | 'quest'>): number =>
  utf8Bytes(JSON.stringify({ words: c.words, rewards: c.rewards, quest: c.quest }));

/**
 * A chapter's window, as the hunter it opens for sees it: its title and line, the reward's lines (`grant`'s when it is
 * given, `grantLines` for the GM's preview), and the quest it issues.
 */
export const chapterWindow = (words: SystemWords, lines: readonly string[], quest: Pick<ChapterQuest, 'title'> | null): { readonly tag: string; readonly title: string; readonly body: string; readonly lines: string[] } =>
  ({ tag: '! Story', title: words.title, body: words.line, lines: [...lines, ...(quest ? [`Quest: ${quest.title}`] : [])] });

/** A chapter's window as a hunter sees it: `chapterWindow`'s answer. */
export type ChapterWindow = ReturnType<typeof chapterWindow>;
/** What a chapter did to one hunter: the grant of its reward (`grant`'s answer, the save after the whole chapter) and its window. */
export type ChapterGiven = Granted & { readonly window: ChapterWindow };

/**
 * Chapter `c` given to hunter `hid` at `o.at`, in one step, the one step that gives a chapter on any phone: its reward
 * by `grant` (the parts a fight holds handed back in `fight`, by `o.vitals`), its quest issued from the GM with its due
 * time `dueHours` after the open (`dueAt`), and its `chapter` fact, of which this is the one writer. The window shows the
 * grant's own lines, so it says what reached the sheet. A hunter that is not there is refused.
 */
export function chapterLanded(save: Save, hid: HunterId, c: Pick<Chapter, 'words' | 'rewards' | 'quest'>, o: Day & { vitals: VitalsAt }): ChapterGiven | Refused<'no-hunter'> {
  const g = grant(save, hid, c.rewards, null, o);
  if (isRefused(g)) return g;
  let next = g.save;
  if (c.quest) {
    const q = c.quest, ids = idsFrom(next.seq), id = ids.next('q');
    const draft = { kind: q.kind, title: q.title, desc: q.desc, objectives: q.objectives, rewards: q.rewards, penaltyText: q.penaltyText, dueAt: q.dueHours === null ? null : dueAt(q.dueHours, new Date(o.at)), from: 'gm' };
    const issued = withTold({ ...next, seq: ids.seq() }, hid, { at: o.at, cap: o.R.logCap }, h => issueQuest(h, draft, id, o.at));
    if (!isRefused(issued)) next = issued;
  }
  next = { ...next, hunters: next.hunters.map(h => (h.id === hid ? record(h, { kind: 'chapter', title: c.words.title, line: c.words.line }) : h)) };
  return { ...g, save: next, window: chapterWindow(c.words, g.lines, c.quest) };
}

/** `s` as a sentence: a full stop after it unless it ends in one, a question mark or an exclamation mark. */
const sentence = (s: string): string => (/[.!?]$/.test(s) ? s : `${s}.`);
/**
 * The maker's preview of a story: one line a chapter, its number and name, its window title, what its reward gives
 * (`rewardLines`) and its quest: "Chapter 1, The offer: THE DEEP HAS NOTICED YOU. Title: Owed to the Deep."
 */
export function storyLines(story: Pick<Story, 'chapters'>, R: RewardRules): string[] {
  return story.chapters.map((c, i) => [
    `Chapter ${i + 1}${c.name ? `, ${c.name}` : ''}: ${sentence(c.words.title)}`,
    ...rewardLines(R, c.rewards).map(sentence), ...(c.quest ? [sentence(`Quest: ${c.quest.title}`)] : []),
  ].join(' '));
}

/** A story's line in the Workshop: how many chapters, and who it is for. "4 chapters · for chosen hunters". */
export const storyMeta = (story: Pick<Story, 'chapters' | 'for'>): string =>
  `${story.chapters.length} chapter${story.chapters.length === 1 ? '' : 's'} · ${story.for === 'table' ? 'for the table' : 'for chosen hunters'}`;
