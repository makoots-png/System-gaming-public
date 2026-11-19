// A story as content (src/core/story/story.ts): its one reader, its bounds, its size against the room's body, its words.
import { describe, expect, test } from 'bun:test';
import { CHAPTERS_MAX, CHAPTER_MAX, chapterSize, chapterWindow, parseChapterQuest, parseStory, storyLines } from '../src/core/story/story.ts';
import type { Chapter, StoryTemplate } from '../src/core/story/story.ts';
import { grantLines, newRewards } from '../src/core/rewards.ts';
import { RULES } from '../src/core/rules.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const many = <T>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));
const BIG = 'x'.repeat(100_000);
const OFFER: Chapter = {
  name: 'The offer', words: { title: 'THE DEEP HAS NOTICED YOU', line: 'A voice offers strength for a debt.' },
  rewards: { ...newRewards(), title: { name: 'Owed to the Deep', desc: 'Strong, and owing.', bonus: { str: 4, pre: -2 } } }, quest: null,
  note: 'Ask whether the hunter takes the offer.',
};
const ASK: Chapter = {
  name: '', words: { title: 'THE DEEP ASKS FOR A GATE', line: '' }, rewards: { ...newRewards(), points: -1, statuses: [{ key: statusKey('hasted'), rounds: 3 }] },
  quest: { kind: 'urgent', title: 'Clear a gate for the Deep', desc: 'Any gate of your rank.', objectives: [{ label: 'Gate cleared', target: 1, progress: 0 }],
    rewards: { ...newRewards(), gold: 100 }, dueHours: 48, penaltyText: 'The Deep collects.' },
  note: '',
};
/** A story that uses every field, as a GM would write one. */
const DEEP: StoryTemplate = { name: 'The deep keeps accounts', when: 'When a hunter is close to death and alone.', for: 'hunters', chapters: [OFFER, ASK] };
const read = (fields: Record<string, unknown>) => parseStory({ ...copy(DEEP), ...fields });
const chapter = (fields: Record<string, unknown>) => read({ chapters: [{ ...copy(OFFER), ...fields }] })!.chapters[0]!;
const quest = (fields: Record<string, unknown>) => parseChapterQuest({ ...copy(ASK.quest), ...fields });

describe('a story read back', () => {
  test('a story with every field comes through as it was written, its costs kept', () => {
    expect(parseStory(copy(DEEP))).toEqual(DEEP);
  });

  test('a story read twice is the same as read once', () => {
    const once = read({ name: BIG, chapters: many(40, () => ({ ...copy(ASK), note: BIG })) })!;
    expect(parseStory(copy(once))).toEqual(once);
  });

  test('every key a story does not have is dropped, and no prototype changes', () => {
    const r = parseStory(JSON.parse(`{"__proto__": {"polluted": 1}, "name": "Odd", "stray": 1, "chapters": [{"words": {"title": "Hi"}, "secret": 2}]}`))!;
    expect(r).toEqual({ name: 'Odd', when: '', for: 'table', chapters: [{ name: '', words: { title: 'HI', line: '' }, rewards: newRewards(), quest: null, note: '' }] });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('what is refused and what takes its default', () => {
  test('a value that is not an object, a story with no name and a story with no chapter are refused', () => {
    for (const v of [null, 'story', 5, [DEEP]]) expect(parseStory(v)).toBeNull();
    expect(read({ name: '   ' })).toBeNull();
    expect(read({ chapters: [] })).toBeNull();
    expect(read({ chapters: 'x' })).toBeNull();
  });

  test('a chapter without a window title is dropped; a story whose every chapter lacks one is refused', () => {
    expect(read({ chapters: [{ ...copy(OFFER), words: { title: '  ', line: 'No title' } }, copy(ASK), 'junk', { name: 'No words' }] })!.chapters).toEqual([ASK]);
    expect(read({ chapters: [{ name: 'No words' }, { words: { line: 'Only a line' } }] })).toBeNull();
  });

  test('a field of the wrong type takes its default: no "when", the whole table, no reward, no quest, no note, no name', () => {
    const r = read({ when: 7, for: 'everyone', chapters: [{ name: 3, words: { title: 'T', line: 9 }, rewards: 'lots', quest: 'go', note: {} }] })!;
    expect(r).toEqual({ name: DEEP.name, when: '', for: 'table', chapters: [{ name: '', words: { title: 'T', line: '' }, rewards: newRewards(), quest: null, note: '' }] });
  });

  test('a window title is in the System\'s voice: upper case', () => {
    expect(chapter({ words: { title: 'the deep is patient', line: 'Nothing is asked.' } }).words).toEqual({ title: 'THE DEEP IS PATIENT', line: 'Nothing is asked.' });
  });

  test('a chapter\'s quest without a title is no quest, and the chapter keeps its words and reward', () => {
    const c = chapter({ quest: { ...copy(ASK.quest), title: ' ' } });
    expect([c.quest, c.words, c.rewards]).toEqual([null, OFFER.words, OFFER.rewards]);
  });

  test('a quest kind the GM may not issue (a penalty, or none) is a side quest', () => {
    expect([quest({ kind: 'penalty' })!.kind, quest({ kind: 7 })!.kind, quest({ kind: 'main' })!.kind]).toEqual(['side', 'side', 'main']);
  });

  test('a quest written ahead starts with no progress on any objective, and an objective without a label is dropped', () => {
    expect(quest({ objectives: [{ label: 'Gate cleared', target: 3, progress: 2 }, { label: '', target: 1 }, 'x'] })!.objectives).toEqual([{ label: 'Gate cleared', target: 3, progress: 0 }]);
  });

  test('a due time is hours above 0, a fraction kept; 0, a negative or no number is none', () => {
    expect([1.5, 48, 0, -3, '12', null, Number.NaN].map(h => quest({ dueHours: h })!.dueHours)).toEqual([1.5, 48, null, null, null, null, null]);
  });
});

describe('the bounds', () => {
  test('a story\'s name is 60, its "when" line 200; a chapter\'s name 60, its window title 60 and line 200, its note 300', () => {
    const r = read({ name: BIG, when: BIG, chapters: [{ name: BIG, words: { title: BIG, line: BIG }, note: BIG }] })!, c = r.chapters[0]!;
    expect([r.name.length, r.when.length, c.name.length, c.words.title.length, c.words.line.length, c.note.length]).toEqual([60, 200, 60, 60, 200, 300]);
  });

  test(`at most ${CHAPTERS_MAX} chapters: the first that read are kept`, () => {
    const r = read({ chapters: [{ name: 'dropped' }, ...many(40, i => ({ name: `C${i}`, words: { title: `T${i}` } }))] })!;
    expect([r.chapters.length, r.chapters[0]!.name, r.chapters[15]!.name]).toEqual([16, 'C0', 'C15']);
  });

  test('a chapter\'s quest: its title 120, description 500, penalty text 300, at most 10 objectives, at most 999 hours', () => {
    const q = quest({ title: BIG, desc: BIG, penaltyText: BIG, objectives: many(30, i => ({ label: `O${i}`, target: 1 })), dueHours: 5000 })!;
    expect([q.title.length, q.desc.length, q.penaltyText.length, q.objectives.length, q.objectives[9]!.label, q.dueHours]).toEqual([120, 500, 300, 10, 'O9', 999]);
  });

  test('a chapter\'s reward and its quest\'s reward keep the bounds of every reward', () => {
    const c = chapter({ rewards: { xp: -1e12, items: many(30, i => ({ name: `P${i}`, type: 'misc' })) }, quest: { ...copy(ASK.quest), rewards: { points: 5000 } } });
    expect([c.rewards.xp, c.rewards.items.length, c.quest!.rewards.points]).toEqual([-1e9, 20, 999]);
  });
});

describe('a chapter\'s size against the room\'s body', () => {
  const sized = (line: string) => chapterSize({ words: { title: 'T', line }, rewards: newRewards(), quest: null });

  test('a chapter of plain letters is as many bytes as its JSON has characters', () => {
    const c = { words: { title: 'T', line: 'abc' }, rewards: newRewards(), quest: null };
    expect(chapterSize(c)).toBe(JSON.stringify({ words: c.words, rewards: c.rewards, quest: c.quest }).length);
  });

  test('a letter outside plain English counts its UTF-8 bytes: é two, 日 three, an emoji four', () => {
    const base = sized('e');
    expect([sized('é') - base, sized('日') - base, sized('😀') - base]).toEqual([1, 2, 3]);
  });

  test('the name and the note stay on the GM\'s phone and are not counted', () => {
    const named: Chapter = { ...OFFER, name: BIG, note: BIG };
    expect(chapterSize(named)).toBe(chapterSize(OFFER));
  });

  test(`the limit leaves 16 KiB of the server's 64 KiB body for the message's wrapper: ${CHAPTER_MAX} bytes`, () => {
    expect(CHAPTER_MAX).toBe(65_536 - 16 * 1024);
  });
});

describe('a story in words', () => {
  test('a chapter\'s window: its title, its line, what the reward gave, then the quest it issues', () => {
    expect(chapterWindow(ASK.words, grantLines(RULES, ASK.rewards), ASK.quest)).toEqual({
      tag: '! Story', title: 'THE DEEP ASKS FOR A GATE', body: '', lines: ['Loses 1 ability point', 'Status: Hasted (3 rounds)', 'Quest: Clear a gate for the Deep'],
    });
    expect(chapterWindow(OFFER.words, [], null)).toEqual({ tag: '! Story', title: OFFER.words.title, body: OFFER.words.line, lines: [] });
  });

  test('the maker\'s preview: a line a chapter with its number, name, window title, reward and quest', () => {
    expect(storyLines(DEEP, RULES)).toEqual([
      'Chapter 1, The offer: THE DEEP HAS NOTICED YOU. Title: Owed to the Deep.',
      'Chapter 2: THE DEEP ASKS FOR A GATE. -1 ability point. Status: Hasted (3 rounds). Quest: Clear a gate for the Deep.',
    ]);
  });

  test('a title that ends in its own question or exclamation mark takes no full stop after it', () => {
    expect(storyLines({ chapters: [{ ...OFFER, name: '', words: { title: 'WHAT DO YOU OWE?', line: '' }, rewards: newRewards() }] }, RULES)).toEqual(['Chapter 1: WHAT DO YOU OWE?']);
  });
});
